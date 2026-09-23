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

// ── Ferramentas do consultor (pasta do cliente e criação de agenda) ──────────
// Usadas por api/_lib/rota-ferramentas.js, sempre com o token da pessoa logada: o consultor
// só acha no Drive o que ele já podia abrir, e o convite sai no nome dele.

// Aspas simples quebram a sintaxe do parâmetro `q` do Drive — precisa escapar.
function escaparQ(texto) {
  return String(texto || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Procura pastas cujo nome contém o termo. O Drive não tem busca "começa com", então quem
// decide qual é a pasta certa é o consultor: a rota devolve as candidatas.
export async function buscarPastas({ accessToken, termo, limite = 10 }) {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '" + escaparQ(termo) + "'",
    fields: 'files(id,name,webViewLink,modifiedTime,driveId)',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    pageSize: String(Math.min(limite, 50)),
  });
  const res = await fetch(DRIVE_FILES_URL + '?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Falha ao buscar a pasta no Drive: ' + (data.error?.message || res.status));
  return data.files || [];
}

// Conteúdo de uma pasta. `profundidade` 2 desce um nível nas subpastas, que é como as contas
// costumam guardar as entregas (uma subpasta por entrega).
export async function listarConteudoDaPasta({ accessToken, folderId, profundidade = 2 }) {
  const itens = [];
  const fila = [{ id: folderId, caminho: '' }];
  while (fila.length) {
    const atual = fila.shift();
    const params = new URLSearchParams({
      q: "'" + escaparQ(atual.id) + "' in parents and trashed=false",
      fields: 'files(id,name,mimeType,webViewLink,modifiedTime)',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '200',
    });
    const res = await fetch(DRIVE_FILES_URL + '?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Falha ao listar a pasta do Drive: ' + (data.error?.message || res.status));
    for (const f of data.files || []) {
      const ehPasta = f.mimeType === 'application/vnd.google-apps.folder';
      itens.push({ id: f.id, nome: f.name, pasta: ehPasta, caminho: atual.caminho, link: f.webViewLink || '', modificadoEm: f.modifiedTime || '' });
      if (ehPasta && atual.caminho.split('/').filter(Boolean).length + 1 < profundidade) {
        fila.push({ id: f.id, caminho: atual.caminho ? atual.caminho + '/' + f.name : f.name });
      }
    }
    if (itens.length > 400) break; // teto de segurança: pasta de conta não passa disso
  }
  return itens;
}

// Cria um evento na agenda da pessoa (calendário "primary"), com Meet e convites enviados.
// `convidados` é [{ email, obrigatorio, aceito }] — no Google, "obrigatório" é a ausência de
// optional:true, e `aceito` marca a presença já confirmada (o caso de quem está criando).
export async function criarEventoNaAgenda({ accessToken, titulo, descricao, inicioISO, fimISO, convidados, comMeet = true }) {
  const idPedido = 'gh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const corpo = {
    summary: titulo,
    description: descricao || undefined,
    start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' },
    // `aceito` só é usado pra quem está criando: o Google trata esse participante como
    // organizador e não faz sentido pedir confirmação pra pessoa no próprio evento dela.
    attendees: (convidados || []).map((c) => ({
      email: c.email,
      optional: !c.obrigatorio,
      ...(c.aceito ? { responseStatus: 'accepted' } : {}),
    })),
    guestsCanModify: false,
    ...(comMeet ? { conferenceData: { createRequest: { requestId: idPedido, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  };
  const params = new URLSearchParams({ sendUpdates: 'all', conferenceDataVersion: comMeet ? '1' : '0' });
  const res = await fetch(CALENDAR_EVENTS_URL + '?' + params.toString(), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || ('HTTP ' + res.status);
    // 403 com "insufficient" = o token da pessoa só tem leitura da agenda (escopo antigo).
    if (res.status === 403 && /insufficient|scope/i.test(msg)) {
      const e = new Error('Sua conexão com o Google só tem permissão de leitura da agenda. Saia e entre de novo no painel para liberar a criação de convites.');
      e.precisaReconectar = true;
      throw e;
    }
    throw new Error('Falha ao criar o convite: ' + msg);
  }
  return { id: data.id, link: data.htmlLink || '', meet: data.hangoutLink || '' };
}

// ── Leitura de arquivo do Drive por link (contrato, anotações de reunião) ────
// O consultor cola o link; quem lê é o token dele. Google Doc sai como texto; PDF sai em
// base64 pra ir como documento na chamada do Claude (que lê PDF nativo, sem conversão).

// Aceita as formas que o Drive/Docs usam: /file/d/<id>/, /document/d/<id>/, ?id=<id>,
// /open?id=<id>, e o próprio id colado sozinho.
export function idDoLinkDoDrive(link) {
  const t = String(link || '').trim();
  if (!t) return null;
  const porCaminho = t.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{10,})/);
  if (porCaminho) return porCaminho[1];
  const porParam = t.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (porParam) return porParam[1];
  const porD = t.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (porD) return porD[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(t)) return t;
  return null;
}

const LIMITE_PDF = 12 * 1024 * 1024; // 12 MB — contrato assinado não passa disso; acima é outra coisa

export async function lerArquivoDoDrive({ accessToken, link }) {
  const fileId = idDoLinkDoDrive(link);
  if (!fileId) throw new Error('Não reconheci esse link do Drive. Cole o link do arquivo (o que tem /d/… no meio).');

  const meta = await fetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId)
    + '?fields=id,name,mimeType,size&supportsAllDrives=true', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const dados = await meta.json();
  if (!meta.ok) {
    const msg = dados.error?.message || ('HTTP ' + meta.status);
    if (meta.status === 404 || meta.status === 403) {
      throw new Error('Não consegui abrir esse arquivo com a sua conta do Google. Confira se ele está compartilhado com você. (' + msg + ')');
    }
    throw new Error('Falha ao abrir o arquivo do Drive: ' + msg);
  }

  const tipo = dados.mimeType || '';
  if (tipo.startsWith('application/vnd.google-apps.')) {
    // Doc/Planilha/Apresentação do Google: exporta como texto puro
    if (tipo === 'application/vnd.google-apps.folder') throw new Error('Esse link é de uma pasta, não de um arquivo.');
    const texto = await exportFileAsText({ accessToken, fileId });
    return { nome: dados.name || '', tipo, texto };
  }
  if (tipo === 'application/pdf') {
    if (dados.size && Number(dados.size) > LIMITE_PDF) {
      throw new Error('O PDF tem ' + Math.round(Number(dados.size) / 1048576) + ' MB e o limite aqui é 12 MB.');
    }
    const res = await fetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) throw new Error('Falha ao baixar o PDF do Drive: HTTP ' + res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > LIMITE_PDF) throw new Error('O PDF passa de 12 MB.');
    return { nome: dados.name || '', tipo, pdfBase64: bytes.toString('base64') };
  }
  if (tipo.startsWith('text/')) {
    const res = await fetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) throw new Error('Falha ao baixar o arquivo: HTTP ' + res.status);
    return { nome: dados.name || '', tipo, texto: await res.text() };
  }
  // Vídeo/áudio da gravação, .docx, imagem: a IA não lê aqui
  throw new Error('Esse arquivo é ' + tipo + ', que eu não consigo ler. Para o contrato use PDF ou Google Doc; para a call use as anotações/transcrição (Google Doc).');
}
