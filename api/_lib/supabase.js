// api/_lib/supabase.js
// Wrapper fino sobre a REST API do Supabase, só pra tabela `google_connections`.
// Usa a service_role key (SUPABASE_SERVICE_ROLE_KEY) — segredo só de servidor, nunca chega
// no cliente. Essa tabela tem RLS habilitado e ZERO policies (default-deny): só a service_role
// (que ignora RLS) consegue ler/escrever nela. Nunca reusar SB_KEY (anon, pública) aqui.

const SB_URL = 'https://riawjqvezolgyldldyzi.supabase.co';

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado no Vercel (Settings > Environment Variables)');
  }
  return { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key };
}

export async function getGoogleConnection(email) {
  const url = SB_URL + '/rest/v1/google_connections?email=eq.' + encodeURIComponent(email) + '&select=refresh_token,scopes';
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error('Falha ao consultar conexão do Google: ' + (data.message || res.status));
  }
  const rows = await res.json();
  return rows[0] || null;
}

export async function upsertGoogleConnection({ email, refreshToken, scopes }) {
  const res = await fetch(SB_URL + '/rest/v1/google_connections', {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ email, refresh_token: refreshToken, scopes, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error('Falha ao salvar conexão do Google: ' + (data.message || res.status));
  }
}

export async function listGoogleConnections() {
  const url = SB_URL + '/rest/v1/google_connections?select=email,connected_at,updated_at,scopes&order=connected_at.desc';
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error('Falha ao listar conexões do Google: ' + (data.message || res.status));
  }
  return res.json();
}
