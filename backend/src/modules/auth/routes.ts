import { Router } from 'express';
import type { Response } from 'express';
import { env } from '../../lib/env.js';
import { validate } from '../../lib/http.js';
import { limit } from '../../lib/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as s from './service.js';
import { emailOnlySchema, loginSchema, registerSchema, resetSchema, verifyEmailSchema } from './schemas.js';

const COOKIE = 'refresh_token';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/api/auth', maxAge: 7 * 86_400_000 } as const;
const setRefresh = (res: Response, t: string) => res.cookie(COOKIE, t, cookieOpts);

const strict = limit(10, 60); // registro, reenvío y recuperación
// Login: por IP y además por cuenta (frena la fuerza bruta repartida entre muchas IPs). Los accesos correctos no cuentan.
// El contador por email no depende de que la cuenta exista, así que no permite enumerar usuarios.
const loginByIp = limit(20, 15, { skipSuccessful: true });
const loginByEmail = limit(10, 15, { skipSuccessful: true, key: (req) => 'email:' + String(req.body?.email ?? '') });
const verifyLimit = limit(20, 15);
const refreshLimit = limit(120, 15);

export const authRouter = Router();

authRouter.post('/register', strict, validate(registerSchema), async (req, res) => {
  await s.register(req.body, req.ip);
  res.status(202).json({ message: 'Si el email es válido, recibirás un correo para activar tu cuenta.' });
});

authRouter.post('/verify-email', verifyLimit, validate(verifyEmailSchema), async (req, res) => {
  await s.verifyEmail(req.body.token, req.body.password);
  res.json({ message: 'Cuenta activada. Ya puedes iniciar sesión.' });
});

authRouter.post('/resend-verification', strict, validate(emailOnlySchema), async (req, res) => {
  await s.resendVerification(req.body.email);
  res.status(202).json({ message: 'Si la cuenta está pendiente de activación, recibirás un nuevo correo.' });
});

authRouter.post('/login', loginByIp, validate(loginSchema), loginByEmail, async (req, res) => {
  const { accessToken, refresh, user } = await s.login(req.body.email, req.body.password, req.ip);
  setRefresh(res, refresh);
  res.json({ accessToken, user });
});

authRouter.post('/refresh', refreshLimit, async (req, res) => {
  const { accessToken, refresh, user } = await s.refresh(req.cookies?.[COOKIE]);
  setRefresh(res, refresh);
  res.json({ accessToken, user });
});

authRouter.post('/logout', async (req, res) => {
  await s.logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  res.status(204).end();
});

authRouter.post('/forgot-password', strict, validate(emailOnlySchema), async (req, res) => {
  await s.forgotPassword(req.body.email, req.ip);
  res.status(202).json({ message: 'Si existe una cuenta asociada a este email, recibirás instrucciones para recuperar tu contraseña.' });
});

authRouter.post('/reset-password', strict, validate(resetSchema), async (req, res) => {
  await s.resetPassword(req.body.token, req.body.password, req.ip);
  res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await s.me(req.user!.id));
});
