// api/google/callback.js
// Endpoint de uso único (setup manual do admin, fora da navegação normal do app): recebe o
// "code" do redirect do Google, troca por tokens, e exibe o refresh_token UMA VEZ na tela
// pra ser copiado manualmente pra variável de ambiente GOOGLE_REFRESH_TOKEN no Vercel.
// Nada aqui é persistido em banco — mesmo modelo de confiança do ANTHROPIC_API_KEY (segredo
// só em env var de servidor, nunca no Supabase/frontend).

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function page(bodyHtml) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Conexão Google Drive</title></head>'
    + '<body style="font-family:monospace;background:#111;color:#eee;padding:24px;">' + bodyHtml + '</body></html>';
}

export default async function handler(req, res) {
  const code = req.query?.code;
  if (!code) {
    res.status(400).send(page('<p>Código de autorização ausente.</p>'));
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send(page('<p>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI não configurados no Vercel.</p>'));
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();

    if (!tokenRes.ok) {
      res.status(tokenRes.status).send(page('<p>Erro ao trocar o código por tokens:</p><pre>' + escapeHtml(data.error_description || data.error || tokenRes.status) + '</pre>'));
      return;
    }

    if (!data.refresh_token) {
      res.status(200).send(page(
        '<p>Autenticado, mas o Google não devolveu um refresh_token desta vez '
        + '(acontece quando essa conta já autorizou o app antes).</p>'
        + '<p>Revogue o acesso em <a style="color:#8cf" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> e repita o fluxo do zero.</p>'
      ));
      return;
    }

    res.status(200).send(page(
      '<p>Conectado com sucesso.</p>'
      + '<p>Copie o valor abaixo para a variável de ambiente <strong>GOOGLE_REFRESH_TOKEN</strong><br>'
      + 'em Vercel &gt; Project Settings &gt; Environment Variables, depois feche esta aba.</p>'
      + '<pre style="background:#000;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all;">GOOGLE_REFRESH_TOKEN=' + escapeHtml(data.refresh_token) + '</pre>'
    ));
  } catch (err) {
    res.status(500).send(page('<p>Falha na troca de tokens: ' + escapeHtml(err.message) + '</p>'));
  }
}
