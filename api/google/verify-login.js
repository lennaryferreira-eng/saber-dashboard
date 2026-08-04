// api/google/verify-login.js
// Verifica o ID token (JWT) devolvido pelo Google Identity Services no login do painel.
// Roda no servidor pra validar a assinatura/claims de verdade — o frontend nunca decide
// sozinho se um token é válido, só o servidor confirma antes de liberar acesso.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { credential } = req.body || {};
  if (!credential || typeof credential !== 'string') {
    res.status(400).json({ error: 'Campo "credential" é obrigatório' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'GOOGLE_CLIENT_ID não configurado no Vercel (Settings > Environment Variables)' });
    return;
  }

  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    const data = await r.json();

    if (!r.ok) {
      res.status(401).json({ error: data.error_description || 'Token inválido ou expirado' });
      return;
    }
    if (data.aud !== clientId) {
      res.status(401).json({ error: 'Token não foi emitido para este app' });
      return;
    }
    if (data.email_verified !== 'true' && data.email_verified !== true) {
      res.status(401).json({ error: 'E-mail não verificado pelo Google' });
      return;
    }
    if (data.hd !== 'v4company.com') {
      res.status(403).json({ error: 'Só contas @v4company.com têm acesso a este painel' });
      return;
    }

    res.status(200).json({ email: String(data.email || '').toLowerCase() });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao verificar login: ' + err.message });
  }
}
