// api/google/fetch-transcript.js
// Exporta o texto puro de uma transcrição específica do Drive (Google Doc), pra virar o
// insumo de /api/evaluate-meeting no frontend.
//
// Dois jeitos de chamar:
// - { fileId } — comportamento de sempre (fila da conta única compartilhada).
// - { email, fileId?, eventId?, eventSummary?, eventStart? } — fila por pessoa (login novo):
//   usa o token daquela pessoa; se o evento da Agenda já veio com o Doc anexado (`fileId`),
//   exporta direto; senão busca no Drive dela por proximidade de horário com `eventStart`
//   (fallback pros casos em que o Meet ainda não anexou a transcrição no próprio evento).

import { getAccessToken, exportFileAsText, listMeetingFiles } from '../_lib/google.js';
import { getGoogleConnection } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { fileId, email, eventStart } = req.body || {};
  if (!fileId && !(email && eventStart)) {
    res.status(400).json({ error: 'Informe "fileId", ou "email" + "eventStart" pra buscar por proximidade de horário.' });
    return;
  }

  try {
    let accessToken;
    if (email) {
      const conn = await getGoogleConnection(email);
      if (!conn) {
        res.status(404).json({ error: 'Essa pessoa ainda não conectou a Agenda/Drive (login novo).' });
        return;
      }
      accessToken = await getAccessToken({ refreshToken: conn.refresh_token });
    } else {
      accessToken = await getAccessToken();
    }

    let resolvedFileId = fileId;
    if (!resolvedFileId) {
      const inicio = new Date(eventStart);
      const sinceISO = new Date(inicio.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const candidatos = await listMeetingFiles({ accessToken, sinceISO });
      if (!candidatos.length) {
        res.status(404).json({ error: 'Nenhuma transcrição encontrada no Drive dessa pessoa perto do horário da reunião — pode ainda não ter sido gerada pelo Meet.' });
        return;
      }
      // Mais próxima do horário do evento primeiro — não exige nome igual (cada um nomeia diferente).
      const alvo = inicio.getTime();
      candidatos.sort((a, b) => Math.abs(new Date(a.modifiedTime).getTime() - alvo) - Math.abs(new Date(b.modifiedTime).getTime() - alvo));
      resolvedFileId = candidatos[0].id;
    }

    const texto = await exportFileAsText({ accessToken, fileId: resolvedFileId });
    res.status(200).json({ texto, fileId: resolvedFileId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
