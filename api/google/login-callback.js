// api/google/login-callback.js
// Volta do consentimento do Google (redirect_uri de api/google/login-url.js). Troca o code
// por tokens, confirma que é uma conta @v4company.com de verdade, guarda o refresh_token
// (só quando o Google manda um novo — login do dia a dia não manda de novo) e devolve o
// usuário pro app com um token de prova de login de curta duração — NUNCA um e-mail cru na
// URL (isso seria falsificável: qualquer um digitaria o e-mail de um ADM na barra de
// endereço e a checagem de perfil, que é só client-side, aceitaria sem questionar).

import { signState, verifyState } from '../_lib/crypto-state.js';
import { verifyGoogleIdToken } from '../_lib/google.js';
import { upsertGoogleConnection } from '../_lib/supabase.js';

const APP_URL = '/';

function redirectComErro(res, motivo) {
  res.writeHead(302, { Location: APP_URL + '?login_error=' + encodeURIComponent(motivo) });
  res.end();
}

export default async function handler(req, res) {
  const { code, state } = req.query || {};
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientSecret) {
    redirectComErro(res, 'GOOGLE_CLIENT_SECRET não configurado no servidor');
    return;
  }
  if (!code || !state) {
    redirectComErro(res, 'Resposta do Google incompleta (sem code/state)');
    return;
  }

  try {
    verifyState(state, clientSecret, 10 * 60 * 1000);
  } catch (err) {
    redirectComErro(res, 'Login expirado ou inválido, tente de novo');
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI_LOGIN;
  if (!clientId || !redirectUri) {
    redirectComErro(res, 'GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI_LOGIN não configurados no servidor');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      redirectComErro(res, data.error_description || data.error || 'Falha ao trocar o código por tokens');
      return;
    }

    const { email } = await verifyGoogleIdToken(data.id_token);

    // O Google só manda refresh_token na primeira autorização (ou depois de revogar) — em
    // logins normais do dia a dia, não vem, e o que já está salvo continua valendo.
    if (data.refresh_token) {
      await upsertGoogleConnection({ email, refreshToken: data.refresh_token, scopes: data.scope || '' });
    }

    const loginToken = signState({ email }, clientSecret);
    res.writeHead(302, { Location: APP_URL + '?login_token=' + encodeURIComponent(loginToken) });
    res.end();
  } catch (err) {
    redirectComErro(res, err.message || 'Falha inesperada no login');
  }
}
