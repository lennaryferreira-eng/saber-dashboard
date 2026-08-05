// api/google/verify-login-token.js
// Mesmo contrato do antigo api/google/verify-login.js (token opaco entra, e-mail verificado
// sai) — só que valida o `login_token` de curta duração emitido por login-callback.js em vez
// de um ID token do Google direto. O front-end chama isso assim que volta do redirect de
// login (?login_token=...) pra confirmar que o token é genuíno antes de aplicar a sessão.

import { verifyState } from '../_lib/crypto-state.js';

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutos — só precisa sobreviver ao próprio redirect

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Campo "token" é obrigatório' });
    return;
  }

  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) {
    res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET não configurado no Vercel' });
    return;
  }

  try {
    const payload = verifyState(token, clientSecret, MAX_AGE_MS);
    if (!payload.email) {
      res.status(401).json({ error: 'Token sem e-mail' });
      return;
    }
    res.status(200).json({ email: payload.email });
  } catch (err) {
    res.status(401).json({ error: 'Token de login inválido ou expirado' });
  }
}
