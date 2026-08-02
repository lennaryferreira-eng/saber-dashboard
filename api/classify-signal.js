// api/classify-signal.js
// Função serverless do Vercel — roda no servidor, nunca no navegador.
// A chave da Anthropic fica só aqui, lida de uma variável de ambiente
// (Vercel > Project Settings > Environment Variables > ANTHROPIC_API_KEY),
// nunca aparece no código nem no HTML entregue ao navegador.

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
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: rubric,
        messages: [
          { role: 'user', content: `Situação observada no squad:\n"""${descricao}"""\n\nClassifique conforme instruído.` }
        ],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: 'Erro da API da Anthropic', details: data });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Falha ao chamar a Anthropic: ' + err.message });
  }
}
