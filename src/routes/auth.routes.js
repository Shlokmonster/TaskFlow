'use strict';

const express = require('express');

const controller = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { registerBody, loginBody, firebaseBody, updateMeBody, logoutBody } = require('../validators/auth.validator');

const router = express.Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Create an account
 *     description: |
 *       Registers a new user with email and password. The account is always created
 *       with the `member` role — promoting a user is an admin action, so a `role`
 *       field in the body is ignored.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Ada Lovelace }
 *               email: { type: string, format: email, example: ada@taskflow.dev }
 *               password: { type: string, format: password, minLength: 8, example: Passw0rd! }
 *               fcmToken: { type: string, description: Device token registered for push notifications }
 *               avatarUrl: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Account created — returns a JWT and the user profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessEnvelope' }
 *       409: { description: Email already registered }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Rate limited }
 */
router.post('/register', authLimiter, validate({ body: registerBody }), controller.register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in with a password or a Firebase ID token
 *     description: |
 *       Send `email` + `password`, **or** a `firebaseToken`. When a Firebase token
 *       is supplied the account is looked up by `firebaseUid` (falling back to
 *       email) and created on first sign-in.
 *
 *       Optionally include `fcmToken` to register the device for push
 *       notifications; it is stored on the user and used for task pushes.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string, format: email, example: lead@taskflow.dev }
 *               password: { type: string, format: password, example: Passw0rd! }
 *               firebaseToken: { type: string, description: Firebase ID token, alternative to email/password }
 *               fcmToken: { type: string }
 *           examples:
 *             password:
 *               summary: Email + password
 *               value: { email: lead@taskflow.dev, password: Passw0rd!, fcmToken: "dEv1c3Tok3n" }
 *             firebase:
 *               summary: Firebase ID token
 *               value: { firebaseToken: "eyJhbGciOiJSUzI1NiIs..." }
 *     responses:
 *       200:
 *         description: Logged in — returns a JWT and the user profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessEnvelope' }
 *       401: { description: Invalid credentials or Firebase token }
 *       403: { description: Account deactivated }
 *       503: { description: Firebase login requested but Firebase is not configured }
 */
router.post('/login', authLimiter, validate({ body: loginBody }), controller.login);

/**
 * @swagger
 * /api/auth/firebase:
 *   post:
 *     summary: Exchange a Firebase ID token for an app JWT
 *     description: Explicit Firebase-only entry point. Returns 503 when the server has no Firebase credentials.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firebaseToken]
 *             properties:
 *               firebaseToken: { type: string }
 *               fcmToken: { type: string }
 *               name: { type: string, description: Used only when creating the account }
 *     responses:
 *       200: { description: Logged in }
 *       401: { description: Invalid or expired Firebase ID token }
 *       503: { description: Firebase is not configured on this server }
 */
router.post('/firebase', authLimiter, validate({ body: firebaseBody }), controller.loginWithFirebase);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the current user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: The authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessEnvelope'
 *                 - type: object
 *                   properties: { data: { $ref: '#/components/schemas/User' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   patch:
 *     summary: Update the current user's profile
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               avatarUrl: { type: string, nullable: true }
 *               fcmToken: { type: string, description: Registers this device for push }
 *     responses:
 *       200: { description: Updated user }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate({ body: updateMeBody }), controller.updateMe);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out (unregister a device from push)
 *     description: stateless JWTs are not revoked server-side; this endpoint only removes the supplied `fcmToken` so the device stops receiving push notifications.
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fcmToken: { type: string }
 *     responses:
 *       200: { description: Logged out }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/logout', authenticate, validate({ body: logoutBody }), controller.logout);

module.exports = router;
