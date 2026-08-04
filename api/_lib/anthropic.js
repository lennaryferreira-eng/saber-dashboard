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

// Mesma chamada, mas em modo streaming (stream:true) — devolve o fetch Response cru pra quem
// chamou repassar os bytes SSE direto pro cliente. Usado onde o frontend precisa de feedback
// de progresso real (ex.: avaliação de reunião), em vez de esperar a resposta inteira.
export async function callClaudeStream({ apiKey, system, userText, maxTokens, thinking }) {
  const body = {
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    system,
    stream: true,
    messages: [
      { role: 'user', content: userText }
    ],
  };
  if (thinking !== undefined) body.thinking = thinking;

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}
