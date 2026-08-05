// api/_lib/google.js
// Helper compartilhado pelos endpoints que falam com a Google Drive API.
// As credenciais (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN) ficam
// só aqui, no servidor — nunca chegam ao navegador.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// `refreshToken` opcional: sem ele, cai no GOOGLE_REFRESH_TOKEN de sempre (conta única
// compartilhada, usada pela fila admin antiga). Com ele, renova o token de uma pessoa
// específica (fluxo novo de login por pessoa — ver api/google/login-callback.js).
export async function getAccessToken({ refreshToken } = {}) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const token = refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !token) {
    throw new Error('Google não configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / refresh token ausentes)');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Falha ao renovar o token do Google: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

// Valida um ID token do Google (assinatura/expiração via endpoint tokeninfo do próprio
// Google) e confirma que foi emitido pra este app e por uma conta @v4company.com.
// Extraído de api/google/verify-login.js pra ser reusado também no fluxo de login novo
// (api/google/login-callback.js).
export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID não configurado no Vercel (Settings > Environment Variables)');
  }
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || 'Token inválido ou expirado');
  }
  if (data.aud !== clientId) {
    throw new Error('Token não foi emitido para este app');
  }
  if (data.email_verified !== 'true' && data.email_verified !== true) {
    throw new Error('E-mail não verificado pelo Google');
  }
  if (data.hd !== 'v4company.com') {
    throw new Error('Só contas @v4company.com têm acesso a este painel');
  }
  return { email: String(data.email || '').toLowerCase() };
}

// Lista os eventos da Agenda (Calendar) de uma pessoa numa janela de tempo — usado pela
// visualização semanal da fila de auditoria (api/google/calendar-events.js).
export async function listCalendarEvents({ accessToken, timeMinISO, timeMaxISO }) {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    fields: 'items(id,summary,start,end,attachments,hangoutLink)',
  });
  const res = await fetch(CALENDAR_EVENTS_URL + '?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Falha ao listar eventos da Agenda: ' + (data.error?.message || res.status));
  }
  return data.items || [];
}

// Lista transcrições/notas de reunião (Google Docs gerados automaticamente pelo Meet)
// modificadas desde `sinceISO`. Cobre os dois nomes que o Meet usa pra esses arquivos:
// "Transcript" (padrão em inglês) e "Anotações do Gemini" (Workspace em português, que é
// o que a V4 usa — as notas do Gemini, não uma transcrição literal ao pé da letra).
// Opcionalmente restrito a uma pasta/Shared Drive via `folderId`.
export async function listMeetingFiles({ accessToken, sinceISO, folderId }) {
  let q = `mimeType='application/vnd.google-apps.document' and (name contains 'Transcript' or name contains 'Anotações do Gemini' or name contains 'Anotacoes do Gemini') and modifiedTime > '${sinceISO}' and trashed=false`;
  if (folderId) q += ` and '${folderId}' in parents`;

  // Pagina até esgotar o Drive ou bater um teto de segurança — sem isso, qualquer período
  // com mais de 100 arquivos (o pageSize de uma página só) descartava o resto em silêncio,
  // escondendo reuniões sem nenhum aviso de que a lista estava incompleta.
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,owners(displayName,emailAddress),modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(DRIVE_FILES_URL + '?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error('Falha ao listar arquivos do Drive: ' + (data.error?.message || res.status));
    }
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken && files.length < 1000); // teto de segurança — 1000 reuniões no período já é um cenário absurdo

  return files;
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
