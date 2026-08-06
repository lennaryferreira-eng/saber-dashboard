// api/google/login-url.js
// Ponto de entrada do login: o clique em "Entrar com Google" cai aqui, que redireciona
// direto pro consentimento do Google já pedindo Agenda + Drive (ver README pra escopo e
// setup). Diferente de api/google/auth-url.js (que é um setup manual único do admin e
// devolve a URL como JSON pra copiar) — este aqui É o fluxo de login de todo mundo, então
// já responde com um redirect 302 de verdade.

import { signState } from '../_lib/crypto-state.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI_LOGIN;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI_LOGIN não configurados no Vercel (Settings > Environment Variables)' });
    return;
  }

  let state;
  try {
    state = signState({ nonce: Math.random().toString(36).slice(2) }, clientSecret);
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar state: ' + err.message });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    // "consent" força a tela de permissão em TODO login — necessário porque o Google só
    // reemite um refresh_token quando mostra essa tela. Com "select_account" (tentativa
    // anterior), qualquer conta que já tivesse autorizado este client antes (ex.: quem fez o
    // setup da fila antiga com escopo de Drive) logava normalmente mas sem token novo — o
    // "quem conectou" ficava vazio pra sempre pra essa pessoa, mesmo logando certinho.
    prompt: 'consent',
    scope: [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ].join(' '),
    state,
  });

  res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
  res.end();
}
