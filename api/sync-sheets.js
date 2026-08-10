// api/sync-sheets.js
// Recebe o payload que index.html já manda (syncSheets()/atualizarPlanilha()) e escreve
// direto na Planilha Google via conta de serviço (api/_lib/sheets.js) — substitui o antigo
// Apps Script Web App. Como agora é uma rota same-origin, não precisa mais do truque
// mode:'no-cors'/text/plain que o fetch pro script.google.com exigia; erros reais voltam
// pro cliente em vez de sumir silenciosamente.
//
// Auditorias (as transcrições/avaliações da IA) propositalmente NÃO são espelhadas aqui —
// são o maior payload de todos e uma planilha não é um bom lugar pra isso; quem precisa
// consultar auditoria já usa a aba "Auditoria de Entregas" do próprio painel.

import { getServiceAccountToken, writeSheetValues } from './_lib/sheets.js';

const COLUNAS_PROJETOS = [
  ['id', 'ID'],
  ['nome', 'Projeto'],
  ['consultor', 'Consultor'],
  ['designer', 'Designer'],
  ['copy', 'Copy'],
  ['modelo', 'Modelo'],
  ['status2', 'Status'],
  ['inicio', 'Início'],
  ['prevFim', 'Prev. Conclusão'],
  ['realFim', 'Conclusão Real'],
  ['valorOT', 'Valor One-time'],
  ['valorRec', 'Valor Recorrente'],
  ['oport', 'Oportunidade'],
  ['flag', 'Flag'],
  ['outrosEscopos', 'Outros Escopos'],
];

function safeParse(str, fallback) {
  if (str === undefined || str === null || str === '') return fallback;
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function formatCell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!clientEmail || !privateKey || !spreadsheetId) {
    res.status(500).json({
      error: 'Conta de serviço da planilha não configurada no Vercel (GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY / GOOGLE_SHEETS_SPREADSHEET_ID)',
    });
    return;
  }

  const payload = req.body || {};
  if (payload.tipo !== 'full') {
    res.status(400).json({ error: 'tipo de payload desconhecido: ' + payload.tipo });
    return;
  }

  try {
    const projects = safeParse(payload.projects, []);
    const consultores = safeParse(payload.consultores, { list: [], colors: {} });

    const accessToken = await getServiceAccountToken({ clientEmail, privateKey });

    const header = COLUNAS_PROJETOS.map(c => c[1]);
    const rows = projects.map(p => COLUNAS_PROJETOS.map(c => formatCell(p[c[0]])));
    await writeSheetValues({
      accessToken,
      spreadsheetId,
      title: 'Projetos',
      values: [header, ...rows],
    });

    await writeSheetValues({
      accessToken,
      spreadsheetId,
      title: 'Resumo',
      values: [
        ['Última atualização', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })],
        ['Total de projetos', String(projects.length)],
        ['Consultores', (consultores.list || []).join(', ')],
        ['Fonte', 'Painel Growth Hunters — sync automático após cada save + botão "Atualizar Planilha"'],
      ],
    });

    res.status(200).json({ ok: true, projetos: projects.length, atualizado_em: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao sincronizar a planilha: ' + err.message });
  }
}
