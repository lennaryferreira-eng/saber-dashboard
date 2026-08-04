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

import { callClaude } from './_lib/anthropic.js';
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
    const { ok, status, data } = await callClaude({
      apiKey,
      system: MEETING_EVAL_SKILL,
      userText: transcricao,
      maxTokens: 4096,
    });

    if (!ok) {
      res.status(status).json({ error: 'Erro da API da Anthropic', details: data });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Falha ao chamar a Anthropic: ' + err.message });
  }
}
