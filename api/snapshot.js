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

import {
  getServiceAccountToken, writeSheetValues, readSheetValues,
  garantirAbas, escreverVariasAbas, lerVariasAbas, listarAbas,
} from './_lib/sheets.js';
import { paraTabela, deTabela } from './_lib/linear.js';

const CHUNK = 40000; // folga confortável abaixo do limite de 50k por célula
const TABELAS_OK = ['saber_data', 'ter_data'];

// Colunas do painel que viram uma aba cada no formato linear. `sinais_culturais` só existe
// na SABER, mas gravar uma aba vazia na TER não atrapalha — a reconstrução ignora ausente.
const COLUNAS = [
  'projects', 'nps_data', 'csp_manual', 'cap_data', 'cap_manual', 'mon_metas', 'aql_metas',
  'pdi_data', 'conv_base', 'fotos', 'auditorias', 'sinais_culturais', 'consultores',
];

function tabName(table) {
  return '_snapshot_' + table;
}

// Uma aba por coluna: L_saber_data_projects, L_saber_data_auditorias, ...
function tabLinear(table, coluna) {
  return 'L_' + table + '_' + coluna;
}

function credenciais(res) {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  // Planilha-espelho opcional (GOOGLE_SHEETS_MIRROR_ID): toda gravação vai pras duas, e a
  // leitura cai na segunda se a primeira falhar. Serve pro caso de a planilha principal ser
  // apagada, corrompida (alguém editando a aba _snapshot na mão) ou ficar indisponível.
  // Precisa estar compartilhada como Editor com a MESMA conta de serviço.
  const mirrorId = process.env.GOOGLE_SHEETS_MIRROR_ID || null;
  if (!clientEmail || !privateKey || !spreadsheetId) {
    res.status(500).json({ error: 'Conta de serviço da planilha não configurada no Vercel' });
    return null;
  }
  return { clientEmail, privateKey, spreadsheetId, mirrorId };
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
      // Lê da principal e, se ela falhar/vier vazia/corrompida, tenta a espelho. É a razão de
      // existir da segunda planilha: uma cobre a outra sem ninguém precisar intervir.
      const fontes = [
        { id: cred.spreadsheetId, nome: 'principal' },
        ...(cred.mirrorId ? [{ id: cred.mirrorId, nome: 'espelho' }] : []),
      ];

      if (req.query?.meta) {
        for (const f of fontes) {
          try {
            const so = await readSheetValues({ accessToken, spreadsheetId: f.id, title: tabName(table) + '!A1' });
            if (!so.length) continue;
            res.status(200).json({ meta: JSON.parse(so[0][0] || '{}'), fonte: f.nome });
            return;
          } catch { /* tenta a próxima fonte */ }
        }
        res.status(404).json({ error: 'sem snapshot' });
        return;
      }

      const problemas = [];

      // ?formato=linear reconstrói a partir das abas-tabela em vez do JSON fatiado. Tenta em
      // cada planilha, e só depois cai pro JSON — que continua ali como segunda linha de
      // defesa (os dois formatos são gravados sempre, do mesmo dado).
      if (req.query?.formato === 'linear') {
        for (const f of fontes) {
          try {
            const existentes = new Set(await listarAbas({ accessToken, spreadsheetId: f.id }));
            const querer = COLUNAS.map(c => tabLinear(table, c)).filter(t => existentes.has(t));
            if (!querer.length) { problemas.push(f.nome + ': sem abas lineares'); continue; }
            const mapa = await lerVariasAbas({ accessToken, spreadsheetId: f.id, titulos: querer });
            const dados = {};
            let updatedAt = null;
            const ruins = [];
            for (const c of COLUNAS) {
              const linhas = mapa.get(tabLinear(table, c));
              if (!linhas || !linhas.length) continue;
              try {
                dados[c] = deTabela(linhas);
                if (!updatedAt && linhas[0] && linhas[0][2]) updatedAt = linhas[0][2];
              } catch (err) {
                // Isolamento de falha — a razão de ser do formato linear: uma coluna
                // corrompida não impede as outras de carregar.
                ruins.push(c + ' (' + err.message + ')');
              }
            }
            if (!Array.isArray(dados.projects) || !dados.projects.length) {
              problemas.push(f.nome + ': projects vazio/ilegível');
              continue;
            }
            res.status(200).json({
              meta: { updated_at: updatedAt, projects: dados.projects.length, table, formato: 'linear' },
              dados, fonte: f.nome,
              ...(ruins.length ? { colunas_com_problema: ruins } : {}),
            });
            return;
          } catch (err) {
            problemas.push(f.nome + ' (linear): ' + err.message);
          }
        }
        // nenhuma planilha entregou o linear — segue pro JSON abaixo
      }

      for (const f of fontes) {
        try {
          const linhas = await readSheetValues({ accessToken, spreadsheetId: f.id, title: tabName(table) });
          if (!linhas.length) { problemas.push(f.nome + ': vazia'); continue; }
          let meta = {};
          try { meta = JSON.parse(linhas[0][0] || '{}'); } catch { /* metadados ilegíveis, segue */ }
          const payloadStr = linhas.slice(1).map(l => (l && l[0]) || '').join('');
          if (!payloadStr) { problemas.push(f.nome + ': sem conteúdo'); continue; }
          const dados = JSON.parse(payloadStr); // se estiver corrompida, cai no catch e tenta a outra
          res.status(200).json({ meta, dados, fonte: f.nome });
          return;
        } catch (err) {
          problemas.push(f.nome + ': ' + err.message);
        }
      }
      res.status(404).json({ error: 'Nenhum snapshot legível para ' + table + ' (' + problemas.join(' | ') + ')' });
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
      const values = [[JSON.stringify(meta)], ...pedacos];

      // Formato linear: uma aba por coluna, uma linha por registro (ver api/_lib/linear.js).
      // Vai junto com o JSON fatiado de propósito — são dois formatos independentes do mesmo
      // dado, então uma corrupção que derrube um ainda deixa o outro de pé.
      const blocos = COLUNAS
        .filter(c => dados[c] !== undefined)
        .map(c => ({ title: tabLinear(table, c), values: paraTabela(dados[c], meta.updated_at) }));
      const specs = blocos.map(b => ({
        title: b.title,
        rows: b.values.length + 10,
        cols: Math.max(...b.values.map(l => l.length), 1) + 2,
      }));

      // A principal é obrigatória: se ela falhar, a requisição falha e o painel avisa.
      await writeSheetValues({ accessToken, spreadsheetId: cred.spreadsheetId, title: tabName(table), values });
      await garantirAbas({ accessToken, spreadsheetId: cred.spreadsheetId, specs });
      await escreverVariasAbas({ accessToken, spreadsheetId: cred.spreadsheetId, blocos });

      // O espelho é redundância: uma falha nele não pode derrubar um save que já foi gravado
      // com sucesso na principal. Reporta no retorno pra não falhar em silêncio.
      let espelho = cred.mirrorId ? 'ok' : 'nao-configurado';
      if (cred.mirrorId) {
        try {
          await writeSheetValues({ accessToken, spreadsheetId: cred.mirrorId, title: tabName(table), values });
          await garantirAbas({ accessToken, spreadsheetId: cred.mirrorId, specs });
          await escreverVariasAbas({ accessToken, spreadsheetId: cred.mirrorId, blocos });
        } catch (err) {
          espelho = 'FALHOU: ' + err.message;
          console.error('snapshot: espelho falhou —', err.message);
        }
      }
      res.status(200).json({
        ok: true, ...meta, bytes: payloadStr.length, espelho,
        linear: { abas: blocos.length, linhas: blocos.reduce((s, b) => s + Math.max(0, b.values.length - 2), 0) },
      });
      return;
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Falha no snapshot: ' + err.message });
  }
}
