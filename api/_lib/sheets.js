// api/_lib/sheets.js
// Helper compartilhado pro endpoint que escreve na Planilha Google via conta de serviço
// (Google Sheets API v4) — substitui o antigo Apps Script Web App (script.google.com).
// As credenciais (GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY) ficam só aqui,
// no servidor — nunca chegam ao navegador. Zero dependências (sem googleapis/jsonwebtoken):
// o JWT de autenticação é assinado à mão com o módulo crypto nativo do Node, no mesmo
// espírito sem-npm-package do resto de api/_lib.

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Constrói e assina um JWT de conta de serviço (RS256) e troca por um access_token —
// o mesmo fluxo que a lib oficial google-auth-library faz por baixo dos panos.
export async function getServiceAccountToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  // Env vars costumam guardar a chave privada com \n literal em vez de quebra de linha real.
  const key = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key);
  const jwt = `${signingInput}.${base64url(signature).replace(/\+/g, '-').replace(/\//g, '_')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Falha ao autenticar a conta de serviço do Google: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

// Garante que a aba `title` existe na planilha, criando se preciso — equivalente ao
// getOrCreateSheet() do Apps Script antigo.
export async function ensureSheetExists({ accessToken, spreadsheetId, title }) {
  const metaRes = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json();
  if (!metaRes.ok) throw new Error('Falha ao ler a planilha: ' + (meta.error?.message || metaRes.status));

  const exists = (meta.sheets || []).some(s => s.properties?.title === title);
  if (exists) return;

  const addRes = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!addRes.ok) {
    const err = await addRes.json().catch(() => ({}));
    throw new Error('Falha ao criar a aba "' + title + '": ' + (err.error?.message || addRes.status));
  }
}

// Limpa e reescreve um intervalo inteiro (equivalente a clearContents() + setValues() do
// Apps Script antigo) — sempre a partir de A1, então uma planilha que encolheu (menos
// projetos que antes) não deixa linhas velhas sobrando.
export async function writeSheetValues({ accessToken, spreadsheetId, title, values }) {
  await ensureSheetExists({ accessToken, spreadsheetId, title });

  const clearRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(title)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!clearRes.ok) {
    const err = await clearRes.json().catch(() => ({}));
    throw new Error('Falha ao limpar a aba "' + title + '": ' + (err.error?.message || clearRes.status));
  }

  if (!values.length) return;

  const range = `${title}!A1`;
  const updateRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    throw new Error('Falha ao escrever na aba "' + title + '": ' + (err.error?.message || updateRes.status));
  }
}

// Lê um intervalo inteiro de uma aba. Devolve [] se a aba não existir (em vez de erro) —
// quem chama trata "ainda não tem snapshot" como estado normal, não como falha.
export async function readSheetValues({ accessToken, spreadsheetId, title }) {
  const res = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(title)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 400 || res.status === 404) return []; // aba inexistente
  const data = await res.json();
  if (!res.ok) throw new Error('Falha ao ler a aba "' + title + '": ' + (data.error?.message || res.status));
  return data.values || [];
}
