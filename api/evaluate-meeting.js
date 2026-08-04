// api/evaluate-meeting.js
// Função serverless do Vercel — roda no servidor, nunca no navegador.
// A chave da Anthropic fica só aqui, lida de uma variável de ambiente
// (Vercel > Project Settings > Environment Variables > ANTHROPIC_API_KEY),
// nunca aparece no código nem no HTML entregue ao navegador.
//
// Recebe a transcrição de uma reunião de entrega e devolve a avaliação em
// 9 dimensões (D1-D9) gerada pela skill "avaliacao-reunioes-v4", no mesmo
// formato de texto que o parser da Auditoria de Entregas (audParseScores /
// audParseObs / audParseD9 / audParseRec, em index.html) já sabe ler.

import { callClaudeStream } from './_lib/anthropic.js';
import { MEETING_EVAL_SKILL } from './_lib/meeting-eval-skill.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel (Settings > Environment Variables)' });
    return;
  }

  const { transcricao } = req.body || {};
  if (!transcricao || typeof transcricao !== 'string') {
    res.status(400).json({ error: 'Campo "transcricao" é obrigatório' });
    return;
  }

  try {
    const anthropicRes = await callClaudeStream({
      apiKey,
      system: MEETING_EVAL_SKILL,
      userText: transcricao,
      // `temperature` é parâmetro descontinuado pro claude-sonnet-5 (API rejeita com
      // invalid_request_error) — não dá pra reduzir variância por aí. Testei thinking:adaptive
      // pra dar espaço de raciocínio ao procedimento de pontuação mecânico da skill (3
      // componentes por dimensão), mas em teste real (3 rodadas na mesma transcrição) isso só
      // deixou a chamada ~3x mais lenta (110-180s vs ~50s) sem reduzir a variância de forma
      // clara — mantém thinking desativado, que já é mais rápido/barato, e deixa a redução de
      // variância por conta do procedimento mecânico da skill (menos espaço de números
      // possíveis + arredondamento pra múltiplo de 5 + resolver empate pro valor mais baixo).
      thinking: { type: 'disabled' },
      // 16000 dá espaço de sobra pra saída completa das 9 dimensões (texto real fica em
      // ~2500-3000 tokens) sem risco de truncar (bug antigo era com 4096 + thinking ligado).
      maxTokens: 16000,
    });

    if (!anthropicRes.ok) {
      const data = await anthropicRes.json().catch(() => ({}));
      res.status(anthropicRes.status).json({ error: 'Erro da API da Anthropic', details: data });
      return;
    }

    // Repassa o stream SSE da Anthropic direto pro frontend — audChamarClaude() (index.html)
    // interpreta os eventos content_block_delta pra mostrar progresso real (qual dimensão
    // D1-D9 está sendo escrita agora) em vez de ficar preso entre 0% e 100%.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const reader = anthropicRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Falha ao chamar a Anthropic: ' + err.message });
    } else {
      res.end();
    }
  }
}
