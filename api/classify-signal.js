// api/classify-signal.js
// Função serverless do Vercel — roda no servidor, nunca no navegador.
// A chave do Gemini fica só aqui, lida de uma variável de ambiente
// (Vercel > Project Settings > Environment Variables > GEMINI_API_KEY),
// nunca aparece no código nem no HTML entregue ao navegador.

import { callGemini } from './_lib/gemini.js';

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

  const { descricao, rubric } = req.body || {};
  if (!descricao || typeof descricao !== 'string') {
    res.status(400).json({ error: 'Campo "descricao" é obrigatório' });
    return;
  }
  if (!rubric || typeof rubric !== 'string') {
    res.status(400).json({ error: 'Campo "rubric" é obrigatório' });
    return;
  }

  try {
    const { ok, status, data, outputText } = await callGemini({
      apiKey,
      system: rubric,
      userText: `Situação observada no squad:\n"""${descricao}"""\n\nClassifique conforme instruído.`,
      maxTokens: 1000,
    });

    if (!ok) {
      res.status(status).json({ error: 'Erro da API do Gemini', details: data });
      return;
    }

    // Traduz a resposta da Interactions API do Gemini pro mesmo formato que a Anthropic
    // devolvia ({content:[{type:'text', text:...}]}) — classificarSituacao() (index.html)
    // já sabe ler essa forma, então não precisa mudar nada no cliente.
    res.status(200).json({ content: [{ type: 'text', text: outputText }] });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao chamar o Gemini: ' + err.message });
  }
}
