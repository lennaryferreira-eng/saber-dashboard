// api/_lib/google.js
// Helper compartilhado pelos endpoints que falam com a Google Drive API.
// As credenciais (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN) ficam
// só aqui, no servidor — nunca chegam ao navegador.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

export async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive não configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN ausentes no Vercel)');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Falha ao renovar o token do Google: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

// Lista transcrições/notas de reunião (Google Docs gerados automaticamente pelo Meet)
// modificadas desde `sinceISO`. Cobre os dois nomes que o Meet usa pra esses arquivos:
// "Transcript" (padrão em inglês) e "Anotações do Gemini" (Workspace em português, que é
// o que a V4 usa — as notas do Gemini, não uma transcrição literal ao pé da letra).
// Opcionalmente restrito a uma pasta/Shared Drive via `folderId`.
export async function listMeetingFiles({ accessToken, sinceISO, folderId }) {
  let q = `mimeType='application/vnd.google-apps.document' and (name contains 'Transcript' or name contains 'Anotações do Gemini' or name contains 'Anotacoes do Gemini') and modifiedTime > '${sinceISO}' and trashed=false`;
  if (folderId) q += ` and '${folderId}' in parents`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,owners(displayName,emailAddress),modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    pageSize: '100',
  });
  const res = await fetch(DRIVE_FILES_URL + '?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Falha ao listar arquivos do Drive: ' + (data.error?.message || res.status));
  }
  return data.files || [];
}

// Exporta um Google Doc (transcrição) como texto puro.
export async function exportFileAsText({ accessToken, fileId }) {
  const res = await fetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId) + '/export?mimeType=text/plain', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error('Falha ao exportar transcrição: ' + (data.error?.message || res.status));
  }
  return res.text();
}
