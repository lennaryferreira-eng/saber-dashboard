// api/_lib/anthropic.js
// Helper compartilhado pelas funções serverless que chamam a Anthropic API.
// A chave (ANTHROPIC_API_KEY) só é lida aqui, no servidor — nunca chega ao navegador.

export async function callClaude({ apiKey, system, userText, maxTokens }) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      system,
      messages: [
        { role: 'user', content: userText }
      ],
    }),
  });

  const data = await anthropicRes.json();
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}
