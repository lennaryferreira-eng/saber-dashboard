// api/_lib/anthropic.js
// Helper compartilhado pelas funções serverless que chamam a Anthropic API.
// A chave (ANTHROPIC_API_KEY) só é lida aqui, no servidor — nunca chega ao navegador.

export async function callClaude({ apiKey, system, userText, maxTokens, temperature, thinking }) {
  const body = {
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    system,
    messages: [
      { role: 'user', content: userText }
    ],
  };
  // A API exige temperature=1 quando "thinking" está ativo — só inclui temperature quando
  // thinking foi explicitamente desativado pelo chamador (ou nunca foi passado).
  if (thinking !== undefined) body.thinking = thinking;
  if (temperature !== undefined) body.temperature = temperature;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await anthropicRes.json();
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}
