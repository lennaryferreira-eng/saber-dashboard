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

    // Só reuniões de entrega com cliente — sem padrão fixo de nome (cada consultor nomeia
    // do seu jeito), então em vez de exigir a palavra "entrega" (o que só pegava quem
    // efetivamente escrevia isso — na prática só Leonam e Vinicius — e escondia por completo
    // as reuniões de outros consultores) a lista exclui os padrões que são sempre reunião
    // interna. Prefere mostrar ruído demais (o ADM ignora/pula na hora de montar a fila) a
    // esconder reunião de cliente de verdade.
    const PADROES_INTERNOS = [
      /daily growthunters/i,
      /comit[eê]/i,
      /all hands/i,
      /\bweekly\b/i,
      /alinhamento interno/i,
      /^\s*\[cancelado\]/i,
    ];
    const ehInterna = (nome) => PADROES_INTERNOS.some((re) => re.test(nome || ''));

    const pendentes = files
      .filter((f) => !excluir.has(f.id))
      .filter((f) => !ehInterna(f.name))
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
