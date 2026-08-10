// api/evaluate-meeting.js
// Função serverless do Vercel — roda no servidor, nunca no navegador.
// A chave do Gemini fica só aqui, lida de uma variável de ambiente
// (Vercel > Project Settings > Environment Variables > GEMINI_API_KEY),
// nunca aparece no código nem no HTML entregue ao navegador.
//
// Recebe a transcrição de uma reunião de entrega e devolve a avaliação em
// 9 dimensões (D1-D9) gerada pela skill "avaliacao-reunioes-v4", no mesmo
// formato de texto que o parser da Auditoria de Entregas (audParseScores /
// audParseObs / audParseD9 / audParseRec, em index.html) já sabe ler.

import { callGeminiStream } from './_lib/gemini.js';
import { MEETING_EVAL_SKILL } from './_lib/meeting-eval-skill.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel (Settings > Environment Variables)' });
    return;
  }

  const { transcricao } = req.body || {};
  if (!transcricao || typeof transcricao !== 'string') {
    res.status(400).json({ error: 'Campo "transcricao" é obrigatório' });
    return;
  }

  try {
    const geminiRes = await callGeminiStream({
      apiKey,
      system: MEETING_EVAL_SKILL,
      userText: transcricao,
      // 16000 dá espaço de sobra pra saída completa das 9 dimensões (texto real fica em
      // ~2500-3000 tokens) sem risco de truncar.
      maxTokens: 16000,
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
      res.status(500).json({ error: 'Falha ao chamar o Gemini: ' + err.message });
    } else {
      res.end();
    }
  }
}
