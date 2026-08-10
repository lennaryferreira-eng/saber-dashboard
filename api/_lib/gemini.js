// api/_lib/gemini.js
// Helper compartilhado pelas funções serverless que chamam a Gemini API (Google).
// A chave (GEMINI_API_KEY) só é lida aqui, no servidor — nunca chega ao navegador.
//
// Usa a Interactions API (POST /v1beta/interactions) via fetch puro, no mesmo padrão de
// api/_lib/anthropic.js e api/_lib/google.js — este projeto não tem package.json/npm
// dependencies, então evita-se de propósito o SDK @google/genai (exigiria criar um passo
// de build/instalação que não existe hoje em nenhuma outra função serverless daqui).

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODEL = 'gemini-3.6-flash';

// A REST crua da Interactions API NÃO devolve o campo `output_text` (isso é uma
// propriedade de conveniência calculada só pelos SDKs oficiais) — o texto de verdade vem
// dentro de `steps[]`, num step `type:"model_output"` com `content:[{type:"text",text}]`.
// Confirmado batendo direto na API antes de escrever isto (a doc não deixava claro).
function extractOutputText(data) {
  if (!Array.isArray(data.steps)) return '';
  let out = '';
  for (const step of data.steps) {
    if (step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block.type === 'text' && typeof block.text === 'string') out += block.text;
    }
  }
  return out;
}

export async function callGemini({ apiKey, system, userText, maxTokens }) {
  const body = {
    model: MODEL,
    system_instruction: system,
    input: userText,
    generation_config: {
      max_output_tokens: maxTokens,
      // "minimal" é o nível mais baixo de raciocínio da Interactions API — equivalente
      // mais próximo do thinking:{type:'disabled'} que a chamada à Anthropic usava.
      thinking_level: 'minimal',
    },
  };

  const geminiRes = await fetch(INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await geminiRes.json();
  return { ok: geminiRes.ok, status: geminiRes.status, data, outputText: geminiRes.ok ? extractOutputText(data) : '' };
}

// Mesma chamada, em modo streaming (stream:true, SSE via ?alt=sse) — devolve o fetch
// Response cru pra quem chamou traduzir os eventos e repassar pro cliente. Usado onde o
// frontend precisa de feedback de progresso real (ex.: avaliação de reunião).
export async function callGeminiStream({ apiKey, system, userText, maxTokens }) {
  const body = {
    model: MODEL,
    system_instruction: system,
    input: userText,
    stream: true,
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: 'minimal',
    },
  };

  return fetch(`${INTERACTIONS_URL}?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
}
