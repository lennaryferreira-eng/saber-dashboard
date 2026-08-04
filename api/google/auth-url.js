// api/google/auth-url.js
// Devolve a URL de consentimento do Google OAuth. Uso único, pelo admin, pra conectar a
// conta que vai fornecer acesso de leitura ao Drive (setup — ver README).

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI não configurados no Vercel (Settings > Environment Variables)' });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
  });

  res.status(200).json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
}
