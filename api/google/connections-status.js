// api/google/connections-status.js
// Lista quem já autorizou Agenda+Drive no login novo — alimenta o painel ADM "quem
// conectou" (Auditoria de Entregas). Nunca devolve o refresh_token, só e-mail + quando
// conectou.

import { listGoogleConnections } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const rows = await listGoogleConnections();
    const connections = rows.map((r) => ({
      email: r.email,
      connectedAt: r.connected_at,
      updatedAt: r.updated_at,
      scopes: r.scopes,
    }));
    res.status(200).json({ connections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
