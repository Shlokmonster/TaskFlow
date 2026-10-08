'use strict';

/**
 * Guards the docs page.
 *
 * The guide under Swagger UI is generated from the live OpenAPI document, but two
 * things are typed by hand and can silently drift: the ready-to-send request
 * examples, and the access labels in the guide's ACCESS map. Both are checked
 * against the spec here, so adding an endpoint and forgetting one of them fails
 * the suite rather than confusing whoever is being shown the demo.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');

const app = require('../src/app');
const { swaggerSpec } = require('../src/config/swagger');
const { documentedWriteOperations, REQUEST_EXAMPLES } = require('../src/config/swaggerExamples');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const GUIDE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'docs', 'swagger-guide.js'), 'utf8');

/** Every operation in the spec as `GET /api/tasks/{id}`. */
function operations() {
  const list = [];
  for (const [pathKey, pathItem] of Object.entries(swaggerSpec.paths)) {
    for (const method of METHODS) {
      if (pathItem[method]) list.push({ method, pathKey, op: pathItem[method] });
    }
  }
  return list;
}

/** The keys of the guide's ACCESS map, keyed the same way. */
function guideAccessKeys() {
  const keys = new Set();
  const re = /'([A-Z]+) (\/[^']*)':/g;
  let match;
  while ((match = re.exec(GUIDE_SOURCE)) !== null) keys.add(`${match[1]} ${match[2]}`);
  return keys;
}

describe('OpenAPI document', () => {
  it('gives every operation a unique operationId', () => {
    const ids = operations().map((entry) => entry.op.operationId);

    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents at least the full surface', () => {
    // A guard against an `apis:` glob quietly stopping matching, which would
    // leave the docs page nearly empty without failing anything else.
    expect(operations().length).toBeGreaterThanOrEqual(40);
  });

  it('prefills an example for every path parameter', () => {
    const bare = [];

    for (const { method, pathKey, op } of operations()) {
      for (const parameter of op.parameters || []) {
        if (parameter.in === 'path' && !parameter.example) {
          bare.push(`${method.toUpperCase()} ${pathKey} → {${parameter.name}}`);
        }
      }
    }

    expect(bare).toEqual([]);
  });

  it('prefills a ready-to-send body for every operation that takes one', () => {
    const bare = operations()
      .filter(({ op }) => op.requestBody)
      .filter(({ op }) => {
        const json = op.requestBody.content && op.requestBody.content['application/json'];
        // A body may legitimately be optional with no fields — but a write that
        // needs fields must not leave Swagger UI to invent `"project": "string"`.
        if (!json || !json.schema || !json.schema.required || json.schema.required.length === 0) return false;
        return !json.example;
      })
      .map(({ method, pathKey }) => `${method.toUpperCase()} ${pathKey}`);

    expect(bare).toEqual([]);
  });

  it('has no stale entries in the example map', () => {
    const live = new Set(operations().map(({ method, pathKey }) => `${method.toUpperCase()} ${pathKey}`));
    const stale = documentedWriteOperations().filter((key) => !live.has(key));

    expect(stale).toEqual([]);
    expect(Object.keys(REQUEST_EXAMPLES).length).toBe(documentedWriteOperations().length);
  });

  it('keeps the prefilled create bodies clear of the seeded rows', () => {
    // POST /api/projects and POST /api/teams used to carry 'Apollo Redesign'/
    // 'APO' and 'Platform'. Executing them against the seeded database returned
    // 409, which is exactly the first-click failure these examples exist to stop.
    // (Only the existence of an example is checkable here; the collision needs a
    // database, so it is pinned by name.)
    expect(['Apollo Redesign', 'Atlas Migration']).not.toContain(REQUEST_EXAMPLES['POST /api/projects'].name);
    expect(['APO', 'ATL']).not.toContain(REQUEST_EXAMPLES['POST /api/projects'].key);
    expect(['Platform']).not.toContain(REQUEST_EXAMPLES['POST /api/teams'].name);
  });

  it('labels every operation in the guide with who may call it', () => {
    const unlabelled = [...new Set(operations().map(({ method, pathKey }) => `${method.toUpperCase()} ${pathKey}`))]
      .filter((key) => !guideAccessKeys().has(key));

    expect(unlabelled).toEqual([]);
  });

  it('does not label operations that no longer exist', () => {
    const live = new Set(operations().map(({ method, pathKey }) => `${method.toUpperCase()} ${pathKey}`));
    const stale = [...guideAccessKeys()].filter((key) => !live.has(key));

    expect(stale).toEqual([]);
  });
});

/**
 * Run the guide the way the browser does — the real script, a stubbed DOM — and
 * hand back the harness. No jsdom dependency: the guide only touches a handful
 * of DOM methods, and stubbing them keeps this a render test, not a browser test.
 */
async function harness(environment, options = {}) {
  // Mirrors the server's default: the demo is on everywhere except production,
  // where a deployment has to opt in with DOCS_DEMO_MODE=true.
  const docsDemo = options.docsDemo === undefined ? environment !== 'production' : options.docsDemo;
  const handlers = [];
  const elements = new Map();

  const stub = (id) => ({
    className: '',
    id: id || '',
    innerHTML: '',
    children: [],
    style: {},
    textContent: '',
    disabled: false,
    parentNode: null,
    insertBefore(node) {
      this.children.push(node);
      node.parentNode = this;
    },
    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
    },
    // The guide delegates its clicks, so the one listener it registers is how
    // the sign-in path gets exercised below.
    addEventListener(type, fn) {
      handlers.push({ target: this, type, fn });
    },
    // Memoized by selector so a test can read back the node the guide wrote to
    // (the sign-in status line is looked up this way).
    querySelector: (selector) => element(`sel:${selector}`),
    setAttribute() {},
    getAttribute: () => null,
  });

  const element = (id) => {
    if (!elements.has(id)) elements.set(id, stub(id));
    return elements.get(id);
  };

  const target = element('swagger-ui');
  const parent = stub();
  parent.appendChild(target);

  const document = {
    readyState: 'complete',
    body: stub(),
    getElementById: element,
    createElement: stub,
    addEventListener() {},
  };

  const requests = [];
  const fetch = (url, init) => {
    requests.push({ url, init });
    const login = url.endsWith('/api/auth/login');
    const body = () => {
      if (url.endsWith('/api/docs.json')) return swaggerSpec;
      if (login) {
        if (options.loginFails) return { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } };
        return { success: true, data: { token: 'jwt-from-the-button', user: { email: 'lead@taskflow.dev', role: 'lead' } } };
      }
      if (url.endsWith('/api/projects')) return { success: true, data: [{ id: 'project-1', name: 'Orion Rollout', key: 'ORI' }] };
      if (url.endsWith('/api/tasks')) return { success: true, data: [{ id: 'task-1', title: 'Ship the demo' }] };
      if (options.healthFails) throw new Error('health probe unavailable');
      return { data: { environment, docsDemo, firebase: false } };
    };
    return Promise.resolve({ ok: true, status: login && options.loginFails ? 401 : 200, json: () => Promise.resolve(body()) });
  };

  const sandbox = {
    document,
    location: { origin: 'http://localhost:5055' },
    navigator: {},
    console,
    setTimeout,
    fetch,
  };
  if (options.window) sandbox.window = options.window;

  vm.runInNewContext(GUIDE_SOURCE, sandbox);
  await new Promise((resolve) => setImmediate(resolve));

  const guide = parent.children[1];

  return {
    guide,
    element,
    requests,
    /** Click the guide's sign-in button for `email`, as a browser would. */
    async clickSignIn(email) {
      const button = {
        disabled: false,
        textContent: '',
        hasAttribute: () => false,
        getAttribute: (name) => (name === 'data-signin' ? email : null),
      };
      const event = { target: { closest: (selector) => (selector === '[data-signin]' ? button : null) } };

      for (const handler of handlers) await handler.fn(event);
      // Let the login promise and the ids fetch settle.
      for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
      return button;
    },
  };
}

async function renderGuide(environment) {
  return (await harness(environment)).guide;
}

describe('the guide under Swagger UI', () => {
  it('renders every endpoint, tagged with its method', async () => {
    const guide = await renderGuide('development');

    expect(guide).toBeDefined();
    expect(guide.id).toBe('tf-guide');
    expect(guide.innerHTML).toContain('How to test everything on this page');

    const methods = guide.innerHTML.match(/tf-method tf-method--/g) || [];
    expect(methods).toHaveLength(operations().length);
  });

  it('links each endpoint to its own operation on the page', async () => {
    const guide = await renderGuide('development');

    expect(guide.innerHTML).toContain('#/Tasks/put_api_tasks_id');
    expect(guide.innerHTML).toContain('#/Auth/post_api_auth_login');
    // Every operation id appears as a link target at least once.
    const missing = operations().filter(({ op }) => !guide.innerHTML.includes(`/${op.operationId}"`));
    expect(missing).toEqual([]);
  });

  it('numbers its sections consecutively', async () => {
    // The numbers are assigned at render time; typed-in ones left two sections
    // numbered 4, and a gap where the ids panel is hidden.
    const numbers = (html) => [...html.matchAll(/<h3>(\d+)\./g)].map((m) => Number(m[1]));

    expect(numbers((await renderGuide('development')).innerHTML)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(numbers((await renderGuide('production')).innerHTML)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('walks through the demo and the error contract', async () => {
    const guide = await renderGuide('development');

    expect(guide.innerHTML).toContain('Passw0rd!');
    expect(guide.innerHTML).toContain('RATE_LIMITED');
    expect(guide.innerHTML).toContain('task:assigned');
    expect(guide.innerHTML).toContain('npm run seed');
  });

  it('offers one-click sign-in outside production', async () => {
    const guide = await renderGuide('development');

    expect(guide.innerHTML).toContain('data-signin="lead@taskflow.dev"');
    expect(guide.innerHTML).toContain('data-signin="admin@taskflow.dev"');
    // The panel that swaps the placeholder ids for the reader's real ones.
    expect(guide.innerHTML).toContain('id="tf-ids-body"');
  });

  it('hides the demo credentials when the server has not opted in', async () => {
    const guide = await renderGuide('production');

    expect(guide.innerHTML).not.toContain('data-signin=');
    expect(guide.innerHTML).not.toContain('Passw0rd!');
    expect(guide.innerHTML).not.toContain('@taskflow.dev');
    expect(guide.innerHTML).toContain('Demo sign-in is off on this deployment');
    expect(guide.innerHTML).toContain('Guided demo hidden');
    expect(guide.innerHTML).not.toContain('tf-ids-body');
  });

  it('shows the demo on a production host that opted in with DOCS_DEMO_MODE', async () => {
    // Safety and demo-ability are separate decisions: a real deployment can run
    // NODE_ENV=production and still publish the seeded accounts deliberately.
    const guide = (await harness('production', { docsDemo: true })).guide;

    expect(guide.innerHTML).toContain('data-signin="lead@taskflow.dev"');
    expect(guide.innerHTML).toContain('Passw0rd!');
    expect(guide.innerHTML).not.toContain('Demo sign-in is off');
  });

  it('hides the demo when /health cannot be reached', async () => {
    // Fails closed: not knowing whether the demo is published is not a reason
    // to publish it.
    const guide = (await harness('development', { healthFails: true })).guide;

    expect(guide.innerHTML).not.toContain('Passw0rd!');
    expect(guide.innerHTML).not.toContain('data-signin=');
    // The endpoint reference is fetched separately and still renders.
    expect(guide.innerHTML).toContain('tf-method tf-method--');
  });

  it('still documents the whole API in production', async () => {
    const guide = await renderGuide('production');

    // The reference half is environment-independent — it must survive the gating.
    const methods = guide.innerHTML.match(/tf-method tf-method--/g) || [];
    expect(methods).toHaveLength(operations().length);
    expect(guide.innerHTML).toContain('task:assigned');
    expect(guide.innerHTML).toContain('RATE_LIMITED');
    expect(guide.innerHTML).toContain('your-password');
  });
});

describe('clicking "Sign in as lead"', () => {
  it('exchanges the demo credentials for a token and authorizes Swagger UI', async () => {
    const authorized = [];
    const test = await harness('development', { window: { ui: { preauthorizeApiKey: (scheme, token) => authorized.push([scheme, token]) } } });

    const button = await test.clickSignIn('lead@taskflow.dev');

    const login = test.requests.find((r) => r.url.endsWith('/api/auth/login'));
    expect(login.init.method).toBe('POST');
    expect(JSON.parse(login.init.body)).toEqual({ email: 'lead@taskflow.dev', password: 'Passw0rd!' });

    // The token has to reach Swagger UI's own auth store, or "Try it out" 401s.
    expect(authorized).toEqual([['bearerAuth', 'jwt-from-the-button']]);
    expect(button.disabled).toBe(false);
    expect(test.element('tf-ids-body').innerHTML).toContain('ORI');
  });

  it('explains an unseeded database when the demo sign-in is refused', async () => {
    // Exactly what the deployed server does before `npm run seed`: the account
    // does not exist, so "Invalid email or password" needs a next step.
    const test = await harness('development', { loginFails: true, window: { ui: { preauthorizeApiKey() {} } } });

    const button = await test.clickSignIn('lead@taskflow.dev');

    const status = test.element('sel:[data-signin-status]');
    expect(status.textContent).toContain('Invalid email or password');
    expect(status.textContent).toContain('npm run seed');
    expect(status.className).toBe('tf-status tf-status--error');
    expect(button.disabled).toBe(false);
  });

  it('fills the ids panel with real ids from the server', async () => {
    const test = await harness('development', { window: { ui: { preauthorizeApiKey() {} } } });

    expect(test.element('tf-ids-body').innerHTML).toBe('');

    await test.clickSignIn('member@taskflow.dev');

    const panel = test.element('tf-ids-body').innerHTML;
    expect(panel).toContain('project-1');
    expect(panel).toContain('task-1');
    expect(panel).toContain('Ship the demo');
    expect(panel).toContain('data-copy-code');
    // Sent with the token from the button, not anonymously.
    const projects = test.requests.find((r) => r.url.endsWith('/api/projects'));
    expect(projects.init.headers.Authorization).toBe('Bearer jwt-from-the-button');
  });
});

describe('GET /api/docs', () => {  it('serves the Swagger UI with the custom theme and guide loaded', async () => {
    const res = await request(app).get('/api/docs/').expect(200);

    expect(res.text).toContain('TaskFlow API');
    expect(res.text).toContain('/api/docs/guide.js');
    // The stylesheet is inlined, so the page carries its own tokens.
    expect(res.text).toContain('--tf-accent');
  });

  it('serves the guide script as JavaScript', async () => {
    const res = await request(app).get('/api/docs/guide.js').expect(200);

    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('preauthorizeApiKey');
  });

  it('serves the OpenAPI document the guide reads', async () => {
    const res = await request(app).get('/api/docs.json').expect(200);

    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/tasks/{id}'].put.operationId).toBe('put_api_tasks_id');
  });

  it('tells the guide whether the demo sign-in is published', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.body.data.environment).toEqual(expect.any(String));
    // In tests NODE_ENV is 'test', so the docs demo defaults on.
    expect(res.body.data.docsDemo).toBe(true);
    expect(res.body.data.firebase).toBe(false); // no credentials in tests
  });

  it('points the document at the host that asked for it', async () => {
    // The bug this guards: a spec built on a laptop carries localhost, so every
    // "Try it out" on the deployed page posts to the developer's machine.
    const res = await request(app)
      .get('/api/docs.json')
      .set('Host', 'taskflow-pqe9.onrender.com')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(res.body.servers).toEqual([{ url: 'https://taskflow-pqe9.onrender.com', description: 'This server' }]);
    // The document itself is untouched — same paths, same examples.
    expect(res.body.paths['/api/tasks/{id}'].put.operationId).toBe('put_api_tasks_id');
  });

  it('lets PUBLIC_URL override the request host', () => {
    jest.resetModules();
    process.env.PUBLIC_URL = 'https://api.taskflow.example/';
    try {
      // eslint-disable-next-line global-require
      const freshEnv = require('../src/config/env');

      expect(freshEnv.publicUrlFor({ protocol: 'http', get: () => 'internal-lb:5000' })).toBe('https://api.taskflow.example');
    } finally {
      delete process.env.PUBLIC_URL;
      jest.resetModules();
    }
  });
});
