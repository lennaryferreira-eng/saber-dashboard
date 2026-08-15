// api/_lib/anthropic.js
// Helper compartilhado pelas funções serverless que chamam a Anthropic API.
// A chave (ANTHROPIC_API_KEY) só é lida aqui, no servidor — nunca chega ao navegador.

// Mesma intenção do TEMPERATURA_ANALISE do Gemini: a nota de uma reunião não pode mudar
// porque o modelo sorteou diferente. A mesma transcrição avaliada duas vezes tem que dar
// a mesma leitura, senão a coordenadora não consegue confiar na nota nem comparar consultores.
//
// Isto estava faltando no caminho do Claude. Quando o determinismo foi fixado no Gemini, o
// Claude apontava pro claude-sonnet-5, que REJEITA `temperature` — então ficou de fora, com
// essa justificativa registrada no comentário do gemini.js. Depois o caminho do Claude passou
// pro claude-sonnet-4-6 e pro claude-haiku-4-5, que aceitam `temperature` normalmente, e a
// justificativa expirou junto com a troca sem ninguém reabrir a decisão. Como o Haiku virou o
// padrão da aba, quase toda avaliação estava rodando no temperature padrão (1.0), ou seja,
// sorteando a cada chamada.
//
// Diferença honesta em relação ao Gemini: a Anthropic não expõe `seed`, e temperature 0 nunca
// garantiu saída idêntica byte a byte. Isto reduz muito a variância, não a zera.
const TEMPERATURA_ANALISE = 0;

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
// `model` é parâmetro porque a Auditoria deixa a coordenadora escolher entre Claude e Gemini
// por avaliação (ver api/evaluate-meeting.js). Default no Sonnet 4.6, que é o que a aba oferece.
export async function callClaudeStream({ apiKey, system, userText, maxTokens, thinking, model = 'claude-sonnet-4-6', temperature = TEMPERATURA_ANALISE }) {
  const body = {
    model,
    max_tokens: maxTokens,
    // O `system` vai como bloco (não como string) só pra poder carregar o cache_control.
    // A rubrica da avaliação tem ~11.000 tokens e é byte a byte idêntica em toda chamada,
    // enquanto a transcrição — que muda sempre — fica no `messages`, depois do ponto de
    // cache. Assim a parte fixa é reprocessada barata (0,1x) e rápida a partir da segunda
    // avaliação de uma mesma rodada.
    //
    // Não existe risco de servir uma rubrica velha: a chave do cache é o hash dos bytes do
    // prefixo. Se a Lennary editar um caractere da skill, o hash muda, não acha nada no
    // cache e a versão nova é processada do zero — o custo de uma edição é pagar a gravação
    // de novo, nunca uma resposta desatualizada.
    //
    // ATENÇÃO ao mexer na skill: o claude-haiku-4-5 (o padrão da aba) só cacheia prefixos a
    // partir de 4.096 tokens. Se a rubrica algum dia encolher abaixo disso, o cache PARA DE
    // FUNCIONAR EM SILÊNCIO — sem erro, sem aviso, só volta a custar o preço cheio. O log
    // de cache em evaluate-meeting.js é o que denuncia isso.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    stream: true,
    messages: [
      { role: 'user', content: userText }
    ],
  };
  if (thinking !== undefined) body.thinking = thinking;
  // A API rejeita temperature != 1 enquanto o thinking está ativo, então só manda quando ele
  // está desligado — que é o caso da Auditoria (ver o comentário em evaluate-meeting.js).
  const thinkingAtivo = !!(thinking && thinking.type && thinking.type !== 'disabled');
  if (!thinkingAtivo) body.temperature = temperature;

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
