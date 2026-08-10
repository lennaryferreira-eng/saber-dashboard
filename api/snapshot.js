// api/snapshot.js
// Espelho completo dos dados do painel dentro da própria Planilha Google, gravado/lido pela
// conta de serviço (api/_lib/sheets.js). Existe pra UM cenário: o Supabase fora do ar — seja
// queda, seja restrição de cota (402). Como esta rota não depende do Supabase pra nada, o
// painel continua lendo E gravando durante a indisponibilidade, e depois reinjeta tudo de
// volta no banco (ver sbReinjetarSnapshot() em index.html).
//
// Diferente da aba "Projetos" (que é um resumo legível, 15 colunas), aqui vai o payload
// INTEIRO e fiel — os 41 campos de cada projeto e todas as outras colunas (NPS, CSP, PDI,
// auditorias, cultura…). É backup de verdade, não relatório.
//
// Formato na aba `_snapshot_<tabela>` (fica oculta, não é pra leitura humana):
//   linha 1  -> metadados: {"updated_at","chunks","projects","table"}
//   linha 2+ -> pedaços do JSON (o Sheets trava em 50 mil caracteres por célula)

import { getServiceAccountToken, writeSheetValues, readSheetValues } from './_lib/sheets.js';

const CHUNK = 40000; // folga confortável abaixo do limite de 50k por célula
const TABELAS_OK = ['saber_data', 'ter_data'];

function tabName(table) {
  return '_snapshot_' + table;
}

function credenciais(res) {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!clientEmail || !privateKey || !spreadsheetId) {
    res.status(500).json({ error: 'Conta de serviço da planilha não configurada no Vercel' });
    return null;
  }
  return { clientEmail, privateKey, spreadsheetId };
}

export default async function handler(req, res) {
  const cred = credenciais(res);
  if (!cred) return;

  const table = (req.method === 'GET' ? req.query?.table : req.body?.table) || 'saber_data';
  if (!TABELAS_OK.includes(table)) {
    res.status(400).json({ error: 'tabela inválida: ' + table });
    return;
  }

  try {
    const accessToken = await getServiceAccountToken({
      clientEmail: cred.clientEmail,
      privateKey: cred.privateKey,
    });

    if (req.method === 'GET') {
      // ?meta=1 lê só a linha 1 (metadados). Usado no carregamento normal do painel pra saber
      // se existe snapshot mais novo que o banco esperando reinjeção — sem baixar o 1,4MB
      // inteiro só pra comparar uma data.
      if (req.query?.meta) {
        const so = await readSheetValues({
          accessToken,
          spreadsheetId: cred.spreadsheetId,
          title: tabName(table) + '!A1',
        });
        if (!so.length) { res.status(404).json({ error: 'sem snapshot' }); return; }
        let meta = {};
        try { meta = JSON.parse(so[0][0] || '{}'); } catch { /* ilegível */ }
        res.status(200).json({ meta });
        return;
      }
      const linhas = await readSheetValues({
        accessToken,
        spreadsheetId: cred.spreadsheetId,
        title: tabName(table),
      });
      if (!linhas.length) {
        res.status(404).json({ error: 'Nenhum snapshot gravado para ' + table });
        return;
      }
      let meta = {};
      try { meta = JSON.parse(linhas[0][0] || '{}'); } catch { /* metadados ilegíveis */ }
      const payloadStr = linhas.slice(1).map(l => (l && l[0]) || '').join('');
      if (!payloadStr) {
        res.status(404).json({ error: 'Snapshot vazio para ' + table });
        return;
      }
      let dados;
      try {
        dados = JSON.parse(payloadStr);
      } catch (err) {
        res.status(500).json({ error: 'Snapshot corrompido (JSON inválido) — ' + err.message });
        return;
      }
      res.status(200).json({ meta, dados });
      return;
    }

    if (req.method === 'POST') {
      const { dados } = req.body || {};
      if (!dados || typeof dados !== 'object') {
        res.status(400).json({ error: 'Campo "dados" é obrigatório' });
        return;
      }
      // TRAVA: nunca grava um snapshot sem projeto nenhum por cima de um que tem — é o mesmo
      // raciocínio da trava de sbSave() no Supabase (não sobrescrever com vazio).
      const qtd = Array.isArray(dados.projects) ? dados.projects.length : 0;
      if (!qtd) {
        res.status(400).json({ error: 'Snapshot sem projetos — recusado para não sobrescrever o backup válido' });
        return;
      }

      const payloadStr = JSON.stringify(dados);
      const pedacos = [];
      for (let i = 0; i < payloadStr.length; i += CHUNK) {
        pedacos.push([payloadStr.slice(i, i + CHUNK)]);
      }
      const meta = {
        updated_at: new Date().toISOString(),
        chunks: pedacos.length,
        projects: qtd,
        table,
      };
      await writeSheetValues({
        accessToken,
        spreadsheetId: cred.spreadsheetId,
        title: tabName(table),
        values: [[JSON.stringify(meta)], ...pedacos],
      });
      res.status(200).json({ ok: true, ...meta, bytes: payloadStr.length });
      return;
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Falha no snapshot: ' + err.message });
  }
}
