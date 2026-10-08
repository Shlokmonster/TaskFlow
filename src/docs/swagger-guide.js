/*
 * Appends a "How to test this API" guide below the Swagger UI.
 *
 * Loaded as Swagger UI's customJs, so it runs on the docs page itself. The
 * endpoint list is built from /api/docs.json at load time rather than being
 * typed out here, so the guide can never drift from the API it documents.
 * The sign-in buttons are shown only when /health reports docsDemo — an
 * explicit opt-in, so a production deployment never publishes working
 * credentials unless whoever runs it asked for that.
 */
(function () {
  'use strict';

  var DEMO_PASSWORD = 'Passw0rd!';

  var DEMO_ACCOUNTS = [
    { role: 'admin', email: 'admin@taskflow.dev', can: 'Everything, including /api/admin and role changes' },
    { role: 'lead', email: 'lead@taskflow.dev', can: 'Create projects, tasks and teams; manage their own projects' },
    { role: 'lead', email: 'lead2@taskflow.dev', can: 'A second lead — owns the Atlas Migration project' },
    { role: 'member', email: 'member@taskflow.dev', can: 'Work on assigned tasks, comment, track time' },
    { role: 'member', email: 'member2@taskflow.dev', can: 'Second member on Apollo — three tasks, one of them overdue' },
    { role: 'member', email: 'member3@taskflow.dev', can: 'Only on the Atlas project — sees a different, smaller task list' },
  ];

  /* What each endpoint demands. Display only — the server is the authority. */
  var ACCESS = {
    'POST /api/auth/register': ['public', 'public'],
    'POST /api/auth/login': ['public', 'public'],
    'POST /api/auth/firebase': ['public', 'public'],
    'GET /api/auth/me': ['any', 'signed in'],
    'PATCH /api/auth/me': ['any', 'signed in'],
    'POST /api/auth/logout': ['any', 'signed in'],
    'GET /api/health': ['public', 'public'],

    'GET /api/projects': ['member', 'any — scoped to you'],
    'POST /api/projects': ['admin', 'lead or admin'],
    'GET /api/projects/{id}': ['member', 'project member'],
    'PUT /api/projects/{id}': ['admin', 'owner or admin'],
    'DELETE /api/projects/{id}': ['admin', 'owner or admin'],
    'POST /api/projects/{id}/members': ['admin', 'owner or admin'],
    'DELETE /api/projects/{id}/members/{userId}': ['admin', 'owner or admin'],
    'GET /api/projects/{id}/progress': ['member', 'project member'],
    'GET /api/projects/{id}/gantt': ['member', 'project member'],

    'GET /api/tasks': ['member', 'any — scoped to you'],
    'POST /api/tasks': ['admin', 'lead or admin'],
    'GET /api/tasks/{id}': ['member', 'project member'],
    'PUT /api/tasks/{id}': ['member', 'lead/admin, or assignee'],
    'DELETE /api/tasks/{id}': ['admin', 'lead or admin'],
    'POST /api/tasks/{id}/time/start': ['member', 'assignee'],
    'POST /api/tasks/{id}/time/stop': ['member', 'whoever started it'],
    'GET /api/tasks/{id}/time': ['member', 'project member'],

    'POST /api/comments': ['member', 'project member'],
    'GET /api/comments': ['member', 'any — scoped to you'],
    'GET /api/comments/task/{id}': ['member', 'project member'],
    'GET /api/comments/{id}': ['member', 'project member'],
    'PUT /api/comments/{id}': ['member', 'author or admin'],
    'DELETE /api/comments/{id}': ['member', 'author, project lead or admin'],

    'GET /api/teams': ['member', 'any — scoped to you'],
    'POST /api/teams': ['admin', 'lead or admin'],
    'GET /api/teams/{id}': ['member', 'team member'],
    'PUT /api/teams/{id}': ['admin', 'team lead or admin'],
    'DELETE /api/teams/{id}': ['admin', 'admin only'],

    'GET /api/admin/users': ['admin', 'admin only'],
    'GET /api/admin/users/{id}': ['admin', 'admin only'],
    'PATCH /api/admin/users/{id}/role': ['admin', 'admin only'],
    'PATCH /api/admin/users/{id}/status': ['admin', 'admin only'],
    'GET /api/admin/projects': ['admin', 'admin only'],
    'GET /api/admin/stats': ['admin', 'admin only'],

    'GET /api/time/summary': ['member', 'any — scoped to you'],
  };

  var SOCKET_EVENTS = [
    ['connected', 'Handshake accepted — carries your user and the rooms you joined'],
    ['task:created', '{ task, actorId } — a task was created in a project you are in'],
    ['task:updated', '{ task, changes, previousStatus, actorId } — including every status change'],
    ['task:assigned', '{ task, to, from, actorId } — a task was assigned or reassigned to you'],
    ['task:deleted', '{ taskId, projectId, actorId }'],
    ['comment:added', '{ comment, taskId, actorId } — a comment on a task you can see'],
    ['comment:updated / comment:deleted', 'The comment thread changed'],
    ['project:updated / project:deleted', 'A project you belong to changed'],
    ['team:updated / team:deleted', 'Your team changed'],
    ['notification', 'The same event as the push notification that was sent'],
  ];

  var ERROR_CODES = [
    ['200 / 201', 'OK', 'Success. The body is `{ success, message, data }`'],
    ['400', 'BAD_REQUEST', 'Malformed request — bad JSON, an uncastable id, a broken business rule'],
    ['401', 'UNAUTHORIZED', 'No token, an invalid token, or an expired one'],
    ['403', 'FORBIDDEN', 'Authenticated but not allowed — wrong role, or not an owner/member'],
    ['404', 'NOT_FOUND', 'No such resource (or one you may not know exists)'],
    ['409', 'CONFLICT', 'Duplicate key, or a second timer already running'],
    ['422', 'VALIDATION_ERROR', 'A field failed validation. `error.details` lists each field'],
    ['429', 'RATE_LIMITED', 'Too many requests — 100 per 15 min, 10 per 15 min on /api/auth'],
    ['503', 'SERVICE_UNAVAILABLE', 'Firebase login attempted while Firebase is not configured'],
    ['500', 'INTERNAL_ERROR', 'A bug. In development the response includes a stack trace'],
  ];

  /* The scripted demo: do these in order and every feature is exercised. */
  var DEMO_STEPS = [
    {
      title: 'Sign in as the lead',
      body: 'Use the button above, or <code>POST /api/auth/login</code> with the lead account, then click <b>Authorize</b> and paste <code>data.token</code>.',
      expect: '200 with a JWT and your user object. No password hash comes back — ever.',
    },
    {
      title: 'Collect two ids you will need',
      body: '<code>GET /api/projects</code> → copy the <code>id</code> of <b>Apollo Redesign</b> (<code>APO</code>). Then <code>GET /api/tasks?project=&lt;that id&gt;</code> → copy an <code>assignedTo.id</code> to use as a member id.',
      expect: 'Every project carries a <code>progress</code> block: totals, overdue count, completion %.',
    },
    {
      title: 'Create a project',
      body: '<code>POST /api/projects</code> — the example body is already filled in. Hit <b>Execute</b>.',
      expect: '201. You are the owner and the first member, and a <code>project:updated</code> event fires.',
    },
    {
      title: 'Add a member to it',
      body: '<code>POST /api/projects/{id}/members</code> with <code>{ "members": ["&lt;member id&gt;"] }</code>, using the new project id.',
      expect: '200 with <code>added</code> listing the id. That user is pushed and joins the live socket room.',
    },
    {
      title: 'Create an assigned task',
      body: '<code>POST /api/tasks</code> — set <code>project</code> and <code>assignedTo</code> to your two ids and Execute.',
      expect: '201, and the assignee receives <code>task:created</code>, <code>task:assigned</code> and <code>notification</code> if the watch script below is running.',
    },
    {
      title: 'Move the task along',
      body: '<code>PUT /api/tasks/{id}</code> with <code>{ "status": "in-progress", "progress": 35 }</code>. Try it again signed in as the assigned member — a member may only send <code>status</code> and <code>progress</code>.',
      expect: '200 plus a <code>task:updated</code> broadcast carrying <code>changes</code>. Send <code>title</code> as a member and you get 403.',
    },
    {
      title: 'Comment with a mention',
      body: '<code>POST /api/comments</code> with the task id and a body containing <code>@lead@taskflow.dev</code>.',
      expect: '201, <code>mentions</code> resolved to that project member only, and <code>comment:added</code> broadcast.',
    },
    {
      title: 'Read the progress report',
      body: '<code>GET /api/projects/{id}/progress</code>, then <code>GET /api/projects/{id}/gantt</code>.',
      expect: 'Counts by status and priority, completion %, and Gantt bars with their dependency edges.',
    },
    {
      title: 'Track time',
      body: '<code>POST /api/tasks/{id}/time/start</code>, then <code>/stop</code>, then <code>GET /api/tasks/{id}/time</code>. Start it twice.',
      expect: 'The second start is refused with 409 — one running timer per user.',
    },
    {
      title: 'Prove the permissions are real',
      body: 'Sign in as <b>member</b> and try <code>GET /api/admin/users</code>, or <code>POST /api/projects</code>. Then sign in as <b>admin</b> and read <code>GET /api/admin/stats</code>.',
      expect: '403 for the member, 200 for the admin — role is checked alongside ownership on every route.',
    },
  ];

  /* The script blocks embed credentials. On a production deployment the demo
     accounts may exist (npm run seed runs anywhere) and their password is in
     this file, so outside development the samples carry placeholders instead. */
  function creds(hideDemo) {
    return hideDemo
      ? { email: 'you@example.com', password: 'your-password' }
      : { email: 'lead@taskflow.dev', password: DEMO_PASSWORD };
  }

  /* Template literal, not an array of strings — the shell quoting is unreadable
     otherwise. The only escape needed is the `\${1:-…}` default-value expansion. */
  function curlFlow(hideDemo) {
    var c = creds(hideDemo);
    return `#!/usr/bin/env bash
# The same ten steps from a terminal. Needs jq.  Usage: bash demo.sh http://localhost:5001
set -euo pipefail
BASE="\${1:-http://localhost:5001}"

TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \\
  -d '{"email":"${c.email}","password":"${c.password}"}' | jq -r .data.token)
echo "signed in"

PID=$(curl -s -X POST "$BASE/api/projects" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"CLI Demo","key":"CLI","description":"Created by demo.sh","status":"active"}' \\
  | jq -r .data.id)
echo "project $PID"

TID=$(curl -s -X POST "$BASE/api/tasks" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"title\\":\\"Ship the demo\\",\\"project\\":\\"$PID\\",\\"priority\\":\\"high\\"}" \\
  | jq -r .data.id)
echo "task $TID"

curl -s -X PUT "$BASE/api/tasks/$TID" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"in-progress","progress":40}' > /dev/null
echo "status moved to in-progress"

curl -s -X POST "$BASE/api/comments" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"task\\":\\"$TID\\",\\"body\\":\\"Nice work\\"}" > /dev/null
echo "commented"

# The payoff: the progress report for the project we just built.
curl -s "$BASE/api/projects/$PID/progress" -H "Authorization: Bearer $TOKEN" | jq .
`;
  }

  function socketScript(hideDemo) {
    var c = creds(hideDemo);
    // The socket watcher connects as a member, so it sees the events that the
    // lead's actions on Swagger UI produce for someone else.
    var email = hideDemo ? c.email : 'member@taskflow.dev';
    return [
      '// Watch the live events while you click through Swagger UI.',
      '// Run from the project folder: node watch-sockets.js',
      'const { io } = require("socket.io-client");',
      '',
      'const BASE = process.argv[2] || "' + location.origin + '";',
      'const EMAIL = ' + JSON.stringify(email) + ';',
      'const PASSWORD = ' + JSON.stringify(c.password) + ';',
      '',
      '(async () => {',
      '  const res = await fetch(BASE + "/api/auth/login", {',
      '    method: "POST",',
      '    headers: { "Content-Type": "application/json" },',
      '    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),',
      '  });',
      '  const { data } = await res.json();',
      '',
      '  const socket = io(BASE, { auth: { token: data.token } });',
      '',
      '  socket.on("connected", (p) => console.log("joined:", p.rooms.join(", ")));',
      '',
      '  for (const event of [',
      '    "task:created", "task:updated", "task:assigned", "task:deleted",',
      '    "comment:added", "project:updated", "notification",',
      '  ]) {',
      '    socket.on(event, (payload) => console.log("\\n" + event, JSON.stringify(payload, null, 2)));',
      '  }',
      '  console.log("listening as " + EMAIL + " — now click through Swagger UI");',
      '})();',
    ].join('\n');
  }

  /* ------------------------------------------------------------ helpers -- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function codeBlock(code, label) {
    return (
      '<div class="tf-code">' +
      '<button class="tf-copy" type="button" data-copy>' + esc(label || 'copy') + '</button>' +
      '<pre><code>' + esc(code) + '</code></pre>' +
      '</div>'
    );
  }

  function roleBadge(access) {
    if (!access) return '<span class="tf-role">signed in</span>';
    var kind = access[0];
    var cls = kind === 'public' ? 'tf-role--public' : kind === 'admin' ? 'tf-role--admin' : kind === 'member' ? 'tf-role--member' : '';
    return '<span class="tf-role ' + cls + '">' + esc(access[1]) + '</span>';
  }

  /* ----------------------------------------------------------- sections -- */

  function heroSection(hideDemo) {
    return (
      '<div class="tf-guide__hero">' +
      '<h2>How to test everything on this page</h2>' +
      '<p>Every endpoint below is live and clickable. Sign in once, and the whole API is open to you — ' +
      'this guide walks the exact order to test it in, and what each step should give back.</p>' +
      '</div>' +
      '<h3>%N%. Sign in</h3>' +
      (hideDemo
        ? '<div class="tf-note tf-note--warn"><strong>Demo sign-in is off on this deployment</strong>' +
          'The seeded demo accounts are not published here. Call <code>POST /api/auth/login</code> with a real account, ' +
          'copy <code>data.token</code>, then click <b>Authorize</b> and paste it. ' +
          '(Presenting this API? Seed the database with <code>npm run seed</code> and start the server with ' +
          '<code>DOCS_DEMO_MODE=true</code> to bring the demo back.)</div>'
        : '<p>Click a role — the token is fetched and handed to Swagger UI for you, so every ' +
          '<b>Try it out</b> below is already authorized.</p>' +
          '<div class="tf-signin">' +
          '<button class="tf-btn tf-btn--primary" type="button" data-signin="lead@taskflow.dev">Sign in as lead</button>' +
          '<button class="tf-btn" type="button" data-signin="member@taskflow.dev">Sign in as member</button>' +
          '<button class="tf-btn" type="button" data-signin="admin@taskflow.dev">Sign in as admin</button>' +
          '</div>' +
          '<p class="tf-status tf-status--info" data-signin-status>Not signed in — requests will return 401 until you sign in or click Authorize.</p>') +
      '<h4>Or do it by hand</h4>' +
      codeBlock(
        'curl -s -X POST ' + location.origin + '/api/auth/login \\\n' +
          '  -H "Content-Type: application/json" \\\n' +
          '  -d \'{"email":"' + creds(hideDemo).email + '","password":"' + creds(hideDemo).password + '"}\''
      )
    );
  }

  function accountsSection(hideDemo) {
    var rows = DEMO_ACCOUNTS.map(function (a) {
      return (
        '<tr><td><span class="tf-role ' + (a.role === 'admin' ? 'tf-role--admin' : a.role === 'lead' ? 'tf-role--member' : 'tf-role--public') + '">' +
        esc(a.role) + '</span></td>' +
        (hideDemo ? '' : '<td><code>' + esc(a.email) + '</code></td>') +
        '<td>' + esc(a.can) + '</td></tr>'
      );
    }).join('');

    return (
      '<h3>%N%. Demo accounts</h3>' +
      (hideDemo
        ? '<div class="tf-note tf-note--warn"><strong>Demo accounts are hidden on this deployment</strong>' +
          'This server has not opted in to publishing the seeded logins and their shared password. ' +
          'Sign in with a real account from your own user list. <code>npm run seed</code> creates the set below ' +
          'on a development database.</div>'
        : '<p>Created by <code>npm run seed</code>. All of them use the password <code>' + DEMO_PASSWORD + '</code>.</p>') +
      '<table class="tf-table"><thead><tr><th>Role</th>' + (hideDemo ? '' : '<th>Email</th>') +
      '<th>What they can do</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<div class="tf-note"><strong>Why the role matters when testing</strong>' +
      'Role alone is never enough. A lead cannot edit a project they do not own, and a member cannot edit a task ' +
      'that is not assigned to them even though their token is perfectly valid — that is the ownership check on top of the role check.</div>'
    );
  }

  function flowSection(hideDemo) {
    if (hideDemo) {
      // The ten steps assume the seeded dataset (Apollo/Atlas, the demo users),
      // so walking through them on a production database would just 404.
      return (
        '<h3>%N%. The scripted demo</h3>' +
        '<div class="tf-note tf-note--warn"><strong>Guided demo hidden on this deployment</strong>' +
        'The walkthrough below this line normally drives the seeded Apollo/Atlas dataset, which does not exist in ' +
        'this database. Run the server locally with <code>npm run seed</code> to follow it step by step — the endpoint ' +
        'tables, event reference and error contract further down describe this deployment exactly as they are.</div>' +
        '<h4>The same thing from a terminal</h4>' +
        codeBlock(curlFlow(hideDemo), 'copy script')
      );
    }

    var items = DEMO_STEPS.map(function (step) {
      return (
        '<li><strong>' + esc(step.title) + '</strong>' +
        '<div>' + step.body + '</div>' +
        '<div class="tf-hint"><b>Expect:</b> ' + step.expect + '</div>' +
        '</li>'
      );
    }).join('');

    return (
      '<h3>%N%. The scripted demo — do these ten in order</h3>' +
      '<p>This is the whole product: projects, tasks, permissions, live updates, comments, reporting and time tracking.</p>' +
      '<ol class="tf-steps">' + items + '</ol>' +
      '<h4>The same thing from a terminal</h4>' +
      codeBlock(curlFlow(hideDemo), 'copy script')
    );
  }

  /**
   * The examples carry placeholder ids, which is the one thing that makes a
   * first click fail. Rather than send the reader off to run a list call and
   * scroll through JSON, sign-in loads their real ids here, ready to copy.
   */
  function idsSection(hideDemo) {
    if (hideDemo) return '';
    return (
      '<h3>%N%. Your real ids</h3>' +
      '<p id="tf-ids-hint">Sign in above and your projects and tasks load here — copy an id straight into any ' +
      'example that has a <code>665f1c2a…</code> placeholder.</p>' +
      '<div id="tf-ids-body"></div>'
    );
  }

  function idsTable(label, rows, describe) {
    if (!rows.length) {
      return '<h4>' + esc(label) + '</h4><p class="tf-status tf-status--info">None visible to this account.</p>';
    }
    var body = rows
      .slice(0, 8)
      .map(function (row) {
        return (
          '<tr><td>' + esc(describe(row)) + '</td>' +
          '<td><code>' + esc(row.id) + '</code></td>' +
          '<td style="width:70px"><button class="tf-copy tf-copy--inline" type="button" data-copy-code>copy</button></td></tr>'
        );
      })
      .join('');
    return (
      '<h4>' + esc(label) + '</h4>' +
      '<table class="tf-table"><tbody>' + body + '</tbody></table>'
    );
  }

  function loadIds(token) {
    var box = document.getElementById('tf-ids-body');
    if (!box) return;
    box.innerHTML = '<p class="tf-status tf-status--info">Loading your ids…</p>';

    var get = function (path) {
      return fetch(location.origin + path, { headers: { Authorization: 'Bearer ' + token } }).then(function (res) {
        if (!res.ok) throw new Error(path + ' returned ' + res.status);
        return res.json();
      });
    };

    Promise.all([get('/api/projects'), get('/api/tasks')])
      .then(function (results) {
        var hint = document.getElementById('tf-ids-hint');
        if (hint) hint.textContent = 'Live from this server, as the account you signed in with.';

        box.innerHTML =
          idsTable('Projects', results[0].data || [], function (p) { return p.name + ' (' + p.key + ')'; }) +
          idsTable('Tasks', results[1].data || [], function (t) { return t.title; }) +
          '<div class="tf-note">A <b>project id</b> goes in <code>"project"</code>; a <b>task id</b> goes in the ' +
          '<code>{id}</code> of a task path or in <code>"task"</code> for a comment. To assign someone, use a ' +
          '<code>user</code> id from <code>GET /api/admin/users</code> (admin) or from ' +
          '<code>GET /api/projects/{id}</code>, where members come back populated.</div>';
      })
      .catch(function (err) {
        box.innerHTML = '<p class="tf-status tf-status--error">Could not load ids: ' + esc(err.message) + '</p>';
      });
  }

  function endpointsSection(spec) {
    var paths = spec.paths || {};
    var tagOrder = (spec.tags || []).map(function (t) { return t.name; });
    var groups = {};
    var methods = ['get', 'post', 'put', 'patch', 'delete'];

    Object.keys(paths).forEach(function (pathKey) {
      methods.forEach(function (method) {
        var op = paths[pathKey][method];
        if (!op) return;
        var tag = (op.tags && op.tags[0]) || 'Other';
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push({ method: method, path: pathKey, op: op, access: ACCESS[method.toUpperCase() + ' ' + pathKey] });
      });
    });

    var count = 0;
    var html = Object.keys(groups)
      .sort(function (a, b) {
        var ia = tagOrder.indexOf(a);
        var ib = tagOrder.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(function (tag) {
        var rows = groups[tag]
          .map(function (e) {
            count += 1;
            var anchor = '#/' + encodeURIComponent(tag) + '/' + encodeURIComponent(e.op.operationId);
            return (
              '<tr>' +
              '<td><span class="tf-method tf-method--' + e.method + '">' + e.method + '</span></td>' +
              '<td><a class="tf-endpoint-link" href="' + anchor + '" title="Jump to this operation">' +
              '<code>' + esc(e.path) + '</code></a></td>' +
              '<td>' + roleBadge(e.access) + '</td>' +
              '<td>' + esc(e.op.summary || '') + '</td>' +
              '</tr>'
            );
          })
          .join('');

        return (
          '<h4>' + esc(tag) + '</h4>' +
          '<table class="tf-table"><thead><tr><th style="width:76px">Method</th><th>Path</th><th>Who can call it</th><th>What it does</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>'
        );
      })
      .join('');

    return (
      '<h3>%N%. Every endpoint (' + Object.keys(paths).length + ' paths, ' + count + ' operations)</h3>' +
      '<p>Click a path to jump to it. Blue is a read, green creates, orange replaces, purple patches, red deletes.</p>' +
      html +
      '<div class="tf-note"><strong>Ids in the examples</strong>' +
      'Every <b>Try it out</b> body is prefilled, but the ids are placeholders in the right shape. ' +
      'Swap them for real ones from a list call — <code>GET /api/projects</code>, <code>GET /api/tasks</code>, ' +
      '<code>GET /api/admin/users</code> — otherwise you get a 404 or 400.</div>'
    );
  }

  function realtimeSection(hideDemo) {
    var rows = SOCKET_EVENTS.map(function (e) {
      return '<tr><td><code>' + esc(e[0]) + '</code></td><td>' + esc(e[1]) + '</td></tr>';
    }).join('');

    return (
      '<h3>%N%. Real-time events</h3>' +
      '<p>The REST calls on this page broadcast to Socket.io rooms. Connect a socket and every write you make ' +
      'from Swagger UI shows up there — that is the part worth showing someone.</p>' +
      '<p>Rooms: <code>user:&lt;id&gt;</code> (your devices), <code>project:&lt;id&gt;</code> (owner + members), ' +
      '<code>team:&lt;id&gt;</code> (team members). A client joins the first two automatically at handshake; ' +
      'a bad token is refused at the handshake, so a socket never sits in a room it is not entitled to.</p>' +
      '<table class="tf-table"><thead><tr><th>Event</th><th>Payload</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      codeBlock(socketScript(hideDemo), 'copy script') +
      '<div class="tf-note"><strong>What you should see</strong>' +
      'Save that as <code>watch-sockets.js</code> in the project folder and run it, then use Swagger UI as the lead: ' +
      'creating or updating a task, or commenting, prints the payload live.</div>'
    );
  }

  function referenceSection(base) {
    var rows = ERROR_CODES.map(function (e) {
      return '<tr><td><code>' + esc(e[0]) + '</code></td><td><code>' + esc(e[1]) + '</code></td><td>' + esc(e[2]) + '</td></tr>';
    }).join('');

    return (
      '<h3>%N%. Responses, errors and limits</h3>' +
      '<p>Success is always <code>{ success: true, message, data, meta? }</code>. ' +
      'Errors are always <code>{ success: false, error: { code, message, details? } }</code> — the code is stable, ' +
      'so a client can branch on it instead of parsing prose.</p>' +
      '<table class="tf-table"><thead><tr><th style="width:90px">Status</th><th style="width:170px">Code</th><th>Meaning</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<div class="tf-grid">' +
      '<div class="tf-card"><h5>Rate limits</h5><p>100 requests per 15 minutes per IP, and 10 per 15 minutes on ' +
      '<code>/api/auth</code>. Hammer the login endpoint and you will meet 429.</p></div>' +
      '<div class="tf-card"><h5>Firebase is optional</h5><p>With no Firebase credentials the server logs one warning and ' +
      'skips push notifications entirely. <code>GET /health</code> reports <code>firebase: false</code>. ' +
      'Attempting a Firebase login returns 503 rather than crashing.</p></div>' +
      '<div class="tf-card"><h5>Passwords never leak</h5><p>Hashes and device tokens are stripped from every response. ' +
      'Check any user payload — there is no <code>password</code> field.</p></div>' +
      '<div class="tf-card"><h5>Reset the data</h5><p><code>npm run seed</code> wipes and recreates the demo set, ' +
      'so you can run the guided demo again from a clean state.</p></div>' +
      '</div>' +
      '<div class="tf-footer">' +
      '<span><a href="' + esc(base) + '/api/docs.json">OpenAPI document</a></span>' +
      '<span><a href="' + esc(base) + '/health">Health</a></span>' +
      '<span>TaskFlow API v1.0.0 · MIT</span>' +
      '</div>'
    );
  }

  /* -------------------------------------------------------------- init -- */

  /* Section headings carry a %N% placeholder that is replaced here, in DOM
     order. Sections are dropped whole when the environment hides them (the ids
     panel, the guided demo), so numbering them by hand drifted as soon as one
     was conditional — and left a gap in the sequence. */
  function numberSections(html) {
    var n = 0;
    return html.replace(/%N%/g, function () {
      n += 1;
      return String(n);
    });
  }

  function mount() {
    var base = location.origin;
    var target = document.getElementById('swagger-ui');
    if (!target) return;

    var holder = document.createElement('div');
    holder.className = 'tf-guide';
    holder.id = 'tf-guide';
    target.parentNode.insertBefore(holder, target.nextSibling);

    Promise.all([
      fetch(base + '/api/docs.json').then(function (r) { return r.json(); }),
      fetch(base + '/health').then(function (r) { return r.json(); }).catch(function () { return { data: {} }; }),
    ])
      .then(function (results) {
        var spec = results[0];
        var health = (results[1] && results[1].data) || {};
        // Explicit opt-in from the server, not an environment guess: a host can
        // run with NODE_ENV=production and still want the demo dataset shown.
        // Fails closed — if the probe never answered, assume the demo is private.
        var hideDemo = health.docsDemo !== true;

        holder.innerHTML = numberSections(
          heroSection(hideDemo) +
            accountsSection(hideDemo) +
            idsSection(hideDemo) +
            flowSection(hideDemo) +
            endpointsSection(spec) +
            realtimeSection(hideDemo) +
            referenceSection(base)
        );

        wireCopyButtons(holder);
        wireSignIn(holder, base);
      })
      .catch(function (err) {
        holder.innerHTML = '<div class="tf-note tf-note--warn"><strong>The guide could not load</strong>' +
          esc(err.message) + '. The API itself is unaffected — reload the page to try again.</div>';
      });
  }

  /** Delegated, so it also covers the id rows that load in after sign-in. */
  function wireCopyButtons(root) {
    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-copy], [data-copy-code]');
      if (!button) return;

      var isCode = button.hasAttribute('data-copy-code');
      // For a script block the sibling is a <pre>; for an id row it is a <code>.
      var source = button.parentNode.querySelector(isCode ? 'code' : 'pre');
      if (!source) return;
      var text = isCode ? source.textContent : source.innerText;

      copyText(text.trim()).then(function (ok) {
        var original = button.textContent;
        button.textContent = ok ? 'copied' : 'press ⌘C';
        button.classList.toggle('tf-copy--done', ok);
        setTimeout(function () {
          button.textContent = original;
          button.classList.remove('tf-copy--done');
        }, 1600);
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return Promise.resolve(ok);
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  function wireSignIn(root, base) {
    var status = root.querySelector('[data-signin-status]');

    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-signin]');
      if (!button || !status) return;

      var email = button.getAttribute('data-signin');
      button.disabled = true;
      status.className = 'tf-status tf-status--info';
      status.textContent = 'Signing in as ' + email + '…';

      fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: DEMO_PASSWORD }),
      })
        .then(function (res) {
          return res.json().then(function (body) { return { status: res.status, body: body }; });
        })
        .then(function (result) {
          if (result.status !== 200) {
            throw new Error((result.body.error && result.body.error.message) || 'login failed');
          }
          var token = result.body.data.token;
          applyAuthorization(token);
          loadIds(token);
          status.className = 'tf-status tf-status--ok';
          status.textContent = '✓ Signed in as ' + result.body.data.user.email +
            ' (' + result.body.data.user.role + ') — Swagger UI is authorized.';
        })
        .catch(function (err) {
          status.className = 'tf-status tf-status--error';
          status.textContent = '✗ ' + err.message + unseededHint(err);
        })
        .then(function () {
          button.disabled = false;
        });
    });
  }

  /**
   * The usual reason a demo sign-in fails on an otherwise healthy deployment is
   * an empty database: the app serves this guide, but the accounts it names only
   * exist once `npm run seed` has run against *that* server's database.
   */
  function unseededHint(err) {
    var message = String((err && err.message) || '').toLowerCase();
    if (message.indexOf('invalid email or password') === -1) return '';
    return ' — the demo accounts do not exist on this server yet. Run `npm run seed` against ' +
      'its database, or click Authorize and paste a token from an account you made yourself.';
  }

  /** Hand the token to Swagger UI so "Try it out" is authorized. */
  function applyAuthorization(token, attempt) {
    attempt = attempt || 0;
    if (window.ui && typeof window.ui.preauthorizeApiKey === 'function') {
      window.ui.preauthorizeApiKey('bearerAuth', token);
      return;
    }
    if (attempt < 20) setTimeout(function () { applyAuthorization(token, attempt + 1); }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
