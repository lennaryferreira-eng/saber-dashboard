// api/evaluate-meeting.js
// Função serverless do Vercel — roda no servidor, nunca no navegador.
// As chaves (GEMINI_API_KEY e ANTHROPIC_API_KEY) ficam só aqui, lidas de variáveis de
// ambiente (Vercel > Project Settings > Environment Variables), nunca aparecem no código
// nem no HTML entregue ao navegador.
//
// Recebe a transcrição de uma reunião de entrega e devolve a avaliação em
// 9 dimensões (D1-D9) gerada pela skill "avaliacao-reunioes-v4", no mesmo
// formato de texto que o parser da Auditoria de Entregas (audParseScores /
// audParseObs / audParseD9 / audParseRec, em index.html) já sabe ler.
//
// DOIS MODELOS, escolhidos por avaliação no seletor da aba Auditoria:
//   'claude' (PADRÃO) -> claude-sonnet-4-6. Avalia component a componente e penaliza o que
//                        faltou; o Gemini avalia o que aconteceu e premia o conjunto. Na
//                        mesma transcrição e mesma rubrica, deu média 49 contra 76.
//   'gemini'          -> gemini-2.5-pro. ~40% mais barato e ~2x mais rápido, mas mais
//                        leniente. Três tentativas de endurecer por prompt (trava de
//                        componentes, trava de citação literal, nota calculada por fora)
//                        falharam — duas subiram a nota, a terceira foi ignorada.
// A tradução de eventos SSE só existe no caminho do Gemini: o cliente já fala o formato da
// Anthropic (content_block_delta/message_delta), então o stream do Claude é repassado cru.

import { callGeminiStream } from './_lib/gemini.js';
import { callClaudeStream } from './_lib/anthropic.js';
import { MEETING_EVAL_SKILL } from './_lib/meeting-eval-skill.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { transcricao, tipoFoco, modelo } = req.body || {};
  if (!transcricao || typeof transcricao !== 'string') {
    res.status(400).json({ error: 'Campo "transcricao" é obrigatório' });
    return;
  }

  // Lista fechada de propósito: `modelo` vem do navegador, e sem allowlist alguém poderia
  // mandar qualquer identificador e faturar num modelo caro que a gente não escolheu.
  const MODELOS_CLAUDE = {
    claude: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5',
  };
  // Default no Claude: quem não manda `modelo` (chamada antiga, integração externa) cai no
  // que avalia com mais rigor, não no mais barato.
  const modeloClaude = modelo === 'gemini' ? null : (MODELOS_CLAUDE[modelo] || MODELOS_CLAUDE.claude);
  const usarClaude = !!modeloClaude;
  const apiKey = usarClaude ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const nome = usarClaude ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
    res.status(500).json({ error: nome + ' não configurada no Vercel (Settings > Environment Variables)' });
    return;
  }

  // Quando a mesma call cobre duas entregas diferentes (ex: Diagnóstico de Vendas +
  // Diagnóstico de Mídia Paga na mesma reunião), o painel manda a mesma transcrição duas
  // vezes, uma pra cada tipo — tipoFoco diz qual das duas avaliar aqui. Sem isso, a skill
  // (Passo 2) tentaria identificar sozinha o tipo, sem saber que precisa escolher uma das
  // duas partes e ignorar a outra.
  const userText = tipoFoco
    ? `ATENÇÃO: esta transcrição cobre duas entregas diferentes na mesma call. Avalie SOMENTE a parte conduzida como "${tipoFoco}" (é esse o tipo de entrega desta avaliação — não precisa identificá-lo sozinho no Passo 2, use este). Trate o trecho conduzido para a outra entrega/tipo como fora de escopo desta avaliação — não conta a favor nem contra em nenhuma das 9 dimensões, mesma lógica da regra de ignorar apresentação comercial do time de Expansão.\n\n${transcricao}`
    : transcricao;

  try {
    // 16000 dá espaço de sobra pra saída completa das 9 dimensões (texto real fica em
    // ~2500-3000 tokens) sem risco de truncar.
    const maxTokens = 16000;

    if (usarClaude) {
      const claudeRes = await callClaudeStream({
        apiKey,
        model: modeloClaude,
        system: MEETING_EVAL_SKILL,
        userText,
        maxTokens,
        // NÃO troque por `adaptive` sem medir de novo: já foi testado duas vezes neste
        // projeto e reprovado. Em 3 rodadas na mesma transcrição, deixou a chamada ~3x mais
        // lenta (110-180s vs ~50s) sem reduzir a variância da nota de forma clara. Ao
        // reintroduzir em 10/08/2026, a chamada passou de 2 minutos ainda sem emitir uma
        // linha de texto (só deltas de raciocínio) — o que estoura o tempo limite da função
        // serverless e deixa a tela parada. A redução de variância fica por conta do
        // procedimento mecânico da própria skill.
        thinking: { type: 'disabled' },
      });

      if (!claudeRes.ok) {
        const data = await claudeRes.json().catch(() => ({}));
        res.status(claudeRes.status).json({ error: 'Erro da API da Anthropic', details: data });
        return;
      }

      // O cliente já interpreta o formato SSE da Anthropic — repassa os bytes sem traduzir.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      const r = claudeRes.body.getReader();
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      return;
    }

    const geminiRes = await callGeminiStream({
      apiKey,
      system: MEETING_EVAL_SKILL,
      userText,
      maxTokens,
    });

    if (!geminiRes.ok) {
      const data = await geminiRes.json().catch(() => ({}));
      res.status(geminiRes.status).json({ error: 'Erro da API do Gemini', details: data });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Traduz o stream SSE da Interactions API do Gemini (event_type: step.delta /
    // interaction.completed / error) pro formato SSE da Anthropic que audChamarClaude()
    // (index.html) já sabe interpretar (content_block_delta/text_delta,
    // message_delta/stop_reason, error) — assim o parser do cliente não precisa saber
    // que a IA por trás mudou.
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // última linha pode estar incompleta — guarda pro próximo chunk

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        if (evt.event_type === 'step.delta' && evt.delta?.type === 'text') {
          send({ type: 'content_block_delta', delta: { type: 'text_delta', text: evt.delta.text } });
        } else if (evt.event_type === 'interaction.completed') {
          const stopReason = evt.interaction?.status === 'incomplete' ? 'max_tokens' : 'end_turn';
          send({ type: 'message_delta', delta: { stop_reason: stopReason } });
        } else if (evt.event_type === 'error') {
          send({ type: 'error', error: { message: evt.error?.message || 'Erro desconhecido do Gemini' } });
        }
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Falha ao chamar ' + (usarClaude ? 'a Anthropic' : 'o Gemini') + ': ' + err.message });
    } else {
      res.end();
    }
  }
}
