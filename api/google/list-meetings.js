// api/google/list-meetings.js
// Lista transcrições de reunião recentes no Drive da conta conectada (ver GOOGLE_REFRESH_TOKEN
// no README), excluindo as que já têm avaliação salva (driveFileId já usado em `auditorias`).

import { getAccessToken, listMeetingFiles } from '../_lib/google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { excludeIds, days, folderId } = req.body || {};

  try {
    const accessToken = await getAccessToken();
    // 21 dias (não 7) — uma reunião de 8 dias atrás (ex: Clínica Auryon, 27/07) já sumia da
    // fila sem nenhum aviso com a janela antiga, mesmo nunca tendo sido avaliada.
    const janelaDias = Number(days) > 0 ? Number(days) : 21;
    const sinceISO = new Date(Date.now() - janelaDias * 24 * 60 * 60 * 1000).toISOString();
    const scopeFolderId = folderId || process.env.GOOGLE_DRIVE_MEETINGS_FOLDER_ID || null;

    const files = await listMeetingFiles({ accessToken, sinceISO, folderId: scopeFolderId });
    const excluir = new Set(Array.isArray(excludeIds) ? excludeIds : []);

    const pendentes = files
      .filter((f) => !excluir.has(f.id))
      .map((f) => ({
        id: f.id,
        nome: f.name,
        donoNome: f.owners?.[0]?.displayName || null,
        donoEmail: f.owners?.[0]?.emailAddress || null,
        modificadoEm: f.modifiedTime,
        link: f.webViewLink,
      }));

    res.status(200).json({ files: pendentes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
