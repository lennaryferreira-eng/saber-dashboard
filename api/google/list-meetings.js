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
    const janelaDias = Number(days) > 0 ? Number(days) : 30;
    const sinceISO = new Date(Date.now() - janelaDias * 24 * 60 * 60 * 1000).toISOString();
    const scopeFolderId = folderId || process.env.GOOGLE_DRIVE_MEETINGS_FOLDER_ID || null;

    const files = await listMeetingFiles({ accessToken, sinceISO, folderId: scopeFolderId });
    const excluir = new Set(Array.isArray(excludeIds) ? excludeIds : []);

    // Só reuniões com cliente (entrega, kick-off, plano de decolagem, proposta, etc.) — sem
    // padrão fixo de nome (cada consultor nomeia do seu jeito), então em vez de exigir uma
    // palavra específica (o que só pegava quem usava aquele termo exato e escondia por
    // completo as reuniões de outros consultores) a lista exclui os padrões que são sempre
    // reunião interna ou título genérico sem informação nenhuma. Prefere mostrar ruído demais
    // (o ADM ignora/pula na hora de montar a fila) a esconder reunião de cliente de verdade.
    const PADROES_INTERNOS = [
      /daily growthunters/i,
      /comit[eê]/i,
      /all hands/i,
      /\bweekly\b/i,
      /alinhamento interno/i,
      /^\s*\[cancelado\]/i,
      /^\s*reuni[aã]o iniciada [aà]s/i, // título automático do Meet sem evento de calendário — sem nenhuma informação
      /^\s*anota[cç][oõ]es feitas presencialmente/i, // idem — genérico, sem cliente identificável
      /treinamentos?\s*\|/i, // "Treinamentos | TF&Co: ..." — formato fixo de treinamento interno
      /treinamento.*para consultores/i,
      /treinamento.*copy por ia/i,
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
