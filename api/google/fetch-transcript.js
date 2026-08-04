// api/google/fetch-transcript.js
// Exporta o texto puro de uma transcrição específica do Drive (Google Doc), pra virar o
// insumo de /api/evaluate-meeting no frontend.

import { getAccessToken, exportFileAsText } from '../_lib/google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { fileId } = req.body || {};
  if (!fileId || typeof fileId !== 'string') {
    res.status(400).json({ error: 'Campo "fileId" é obrigatório' });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const texto = await exportFileAsText({ accessToken, fileId });
    res.status(200).json({ texto });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
