'use strict';

const db = require('./setup/db');
const { api, createUser, auth, PASSWORD, User } = require('./setup/helpers');

beforeAll(async () => {
  await db.connect();
});
afterEach(async () => {
  await db.clear();
});
afterAll(async () => {
  await db.disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates an account and returns a JWT without leaking the password', async () => {
    const res = await api().post('/api/auth/register').send({
      name: 'Ada Lovelace',
      email: 'ada@test.dev',
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('ada@test.dev');
    expect(res.body.data.user.role).toBe('member');
    expect(res.body.data.user.password).toBeUndefined();

    // The hash exists in the database but never in a response.
    const stored = await User.findOne({ email: 'ada@test.dev' }).select('+password');
    expect(stored.password).toBeDefined();
    expect(stored.password).not.toBe(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain(stored.password);
  });

  it('ignores a role supplied by the client', async () => {
    const res = await api().post('/api/auth/register').send({
      name: 'Sneaky',
      email: 'sneaky@test.dev',
      password: PASSWORD,
      role: 'admin',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('member');
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: 'dupe@test.dev' });
    const res = await api().post('/api/auth/register').send({ name: 'Dupe', email: 'dupe@test.dev', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid payload with 422 and field details', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'x', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(
      expect.arrayContaining(['name', 'email', 'password'])
    );
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with a valid email and password', async () => {
    const user = await createUser({ email: 'login@test.dev' });

    const res = await api().post('/api/auth/login').send({ email: 'login@test.dev', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.id).toBe(String(user._id));

    const refreshed = await User.findById(user._id);
    expect(refreshed.lastLoginAt).toBeInstanceOf(Date);
  });

  it('stores the fcmToken supplied at login', async () => {
    await createUser({ email: 'push@test.dev' });

    const res = await api()
      .post('/api/auth/login')
      .send({ email: 'push@test.dev', password: PASSWORD, fcmToken: 'device-token-abc' });

    expect(res.status).toBe(200);

    const stored = await User.findOne({ email: 'push@test.dev' });
    expect(stored.fcmTokens).toContain('device-token-abc');
  });

  it('answers 401 for a wrong password and for an unknown email alike', async () => {
    await createUser({ email: 'real@test.dev' });

    const wrongPassword = await api().post('/api/auth/login').send({ email: 'real@test.dev', password: 'WrongPass1!' });
    const unknownEmail = await api().post('/api/auth/login').send({ email: 'ghost@test.dev', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identical messages so the endpoint cannot be used to enumerate accounts.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('refuses a deactivated account with 403', async () => {
    await createUser({ email: 'off@test.dev', isActive: false });

    const res = await api().post('/api/auth/login').send({ email: 'off@test.dev', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('requires a password or a Firebase token', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'someone@test.dev' });
    expect(res.status).toBe(422);
  });

  it('returns 503 when Firebase login is used but Firebase is not configured', async () => {
    const res = await api().post('/api/auth/login').send({ firebaseToken: 'a-firebase-id-token' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('authenticated profile routes', () => {
  it('rejects a missing, malformed and expired token with 401', async () => {
    const noToken = await api().get('/api/auth/me');
    const badToken = await api().get('/api/auth/me').set({ Authorization: 'Bearer not.a.jwt' });

    expect(noToken.status).toBe(401);
    expect(badToken.status).toBe(401);
    expect(noToken.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user for a valid token', async () => {
    const user = await createUser({ email: 'me@test.dev' });

    const res = await api().get('/api/auth/me').set(auth(user));

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('me@test.dev');
    expect(res.body.data.password).toBeUndefined();
  });

  it('updates the profile and registers a device token', async () => {
    const user = await createUser({ email: 'patch@test.dev' });

    const res = await api()
      .patch('/api/auth/me')
      .set(auth(user))
      .send({ name: 'Renamed User', fcmToken: 'token-from-patch' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed User');

    const stored = await User.findById(user._id);
    expect(stored.fcmTokens).toContain('token-from-patch');
  });

  it('removes the device token on logout', async () => {
    const user = await createUser({ email: 'bye@test.dev', fcmTokens: ['token-to-remove'] });

    const res = await api().post('/api/auth/logout').set(auth(user)).send({ fcmToken: 'token-to-remove' });

    expect(res.status).toBe(200);
    const stored = await User.findById(user._id);
    expect(stored.fcmTokens).not.toContain('token-to-remove');
  });

  it('rejects a token whose account has since been deactivated', async () => {
    const user = await createUser({ email: 'later-off@test.dev' });
    const header = auth(user);

    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    const res = await api().get('/api/auth/me').set(header);
    expect(res.status).toBe(403);
  });
});

describe('error contract', () => {
  it('reports a malformed body as 400 BAD_REQUEST, not 422', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns an error envelope for an unknown route', async () => {
    const res = await api().get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.message).toMatch(/does not exist/);
  });

  it('reports database and firebase state on /health', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'connected', firebase: false });
    expect(res.body.data.timestamp).toBeTruthy();
  });
});
