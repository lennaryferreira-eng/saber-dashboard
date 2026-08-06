// api/google/calendar-events.js
// Lista os eventos da Agenda de uma pessoa conectada (login novo) numa semana — alimenta a
// visualização de agenda/lista da fila de auditoria (index.html, audAbrirModalDrivePessoa).

import { getAccessToken, listCalendarEvents } from '../_lib/google.js';
import { getGoogleConnection } from '../_lib/supabase.js';
import { ehReuniaoInterna } from '../_lib/meeting-filters.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { email, weekStartISO } = req.body || {};
  if (!email || !weekStartISO) {
    res.status(400).json({ error: 'Campos "email" e "weekStartISO" são obrigatórios' });
    return;
  }

  try {
    const conn = await getGoogleConnection(email);
    if (!conn) {
      res.status(404).json({ error: 'Essa pessoa ainda não conectou a Agenda/Drive (login novo).' });
      return;
    }
    const accessToken = await getAccessToken({ refreshToken: conn.refresh_token });
    const timeMin = new Date(weekStartISO + 'T00:00:00');
    const timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
    const items = await listCalendarEvents({
      accessToken,
      timeMinISO: timeMin.toISOString(),
      timeMaxISO: timeMax.toISOString(),
    });

    const events = items
      .filter((ev) => ev.start && (ev.start.dateTime || ev.start.date)) // ignora eventos sem data (raro, mas acontece)
      .map((ev) => {
        const anexoDoc = (ev.attachments || []).find((a) => a.mimeType === 'application/vnd.google-apps.document');
        return {
          id: ev.id,
          summary: ev.summary || '(sem título)',
          start: ev.start.dateTime || ev.start.date,
          end: (ev.end && (ev.end.dateTime || ev.end.date)) || null,
          driveFileId: anexoDoc ? anexoDoc.fileId : null,
          hangoutLink: ev.hangoutLink || null,
        };
      })
      // Só reuniões que já têm a transcrição anexada pelo Meet — a agenda de uma pessoa tem
      // muito evento pessoal/rotina misturado (ex.: "Leitura", "Ritual+Banho"), então mostrar
      // só o que já está pronto pra auditar evita ruído. Mesmo filtro de "reunião interna" da
      // conta compartilhada (Daily/Comitê/Weekly/Alinhamento/Check-in/etc.) por cima.
      .filter((ev) => !!ev.driveFileId)
      .filter((ev) => !ehReuniaoInterna(ev.summary));

    res.status(200).json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
