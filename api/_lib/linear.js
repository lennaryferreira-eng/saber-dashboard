// api/_lib/linear.js
// Converte cada coluna do painel numa TABELA de verdade (uma linha por registro, uma coluna
// por campo) e reconstrói de volta sem perder nada. É a alternativa ao snapshot em JSON
// fatiado: como cada coluna vira uma aba independente, uma corrupção em `auditorias` não
// impede `projects` de carregar — o JSON fatiado é tudo-ou-nada.
//
// ─── O problema que obriga a codificar cada célula ──────────────────────────────────
// Célula de planilha não guarda tipo, e os dados reais têm tipo misto no MESMO campo:
//   id       -> número em 57 projetos, string em 170
//   gmv      -> string em 176, número em 51
//   entregas -> objeto em 199, array em 28
// Se gravasse o valor cru, na volta não daria pra saber se `1786124531621` era número ou
// string — e a reinjeção casa projeto por `id`. Por isso cada célula guarda
// JSON.stringify(valor): número vira `123`, string vira `"abc"`, objeto vira `{...}`.
// Célula vazia = campo ausente; a string `null` = campo presente valendo null.
//
// ─── Formato de cada aba ────────────────────────────────────────────────────────────
//   linha 1: ['#forma', <forma>, <updated_at>, <qtd registros>]   (auto-descritivo)
//   linha 2: nomes das colunas
//   linha 3+: os dados
//
// Três formas, escolhidas pela cara do dado (ver detectarForma):
//   'lista'    — array de objetos            -> 1 linha por item      (projects, auditorias)
//   'mapa'     — objeto cujos valores são objetos -> 1 linha por chave (nps_data, mon_metas)
//   'chave_valor' — qualquer outro caso      -> 1 linha por chave      (fotos, csp_manual)

export const MARCA_FORMA = '#forma';

function ehObjetoSimples(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function detectarForma(valor) {
  if (Array.isArray(valor)) return 'lista';
  if (ehObjetoSimples(valor)) {
    const vals = Object.values(valor);
    // só vira 'mapa' se TODOS os valores forem objetos — senão a tabela teria linhas com
    // formatos diferentes, e reconstruir viraria adivinhação.
    if (vals.length && vals.every(ehObjetoSimples)) return 'mapa';
    return 'chave_valor';
  }
  return 'chave_valor';
}

function cel(v) {
  return v === undefined ? '' : JSON.stringify(v);
}

function descel(s) {
  if (s === '' || s === undefined || s === null) return undefined; // campo ausente
  try { return JSON.parse(s); } catch { return s; } // tolera célula editada na mão
}

// União das chaves de todos os registros, preservando a ordem em que aparecem — assim a
// tabela fica estável entre gravações (nada de coluna pulando de lugar a cada save).
function colunasDe(registros) {
  const cols = [];
  const vistos = new Set();
  for (const r of registros) {
    for (const k of Object.keys(r || {})) {
      if (!vistos.has(k)) { vistos.add(k); cols.push(k); }
    }
  }
  return cols;
}

export function paraTabela(valor, updatedAt) {
  const forma = detectarForma(valor);

  if (forma === 'lista') {
    const itens = (valor || []).filter(ehObjetoSimples);
    // Array de não-objetos (ex: lista de strings) não vira tabela — guarda inteiro numa
    // célula, que é o comportamento correto e continua sem perda.
    if (itens.length !== (valor || []).length) {
      return [[MARCA_FORMA, 'bruto', updatedAt, 1], ['_valor'], [cel(valor)]];
    }
    // Coleção vazia não pode gerar linha de cabeçalho vazia: o Sheets descarta linha sem
    // nenhuma célula, a linha 2 some, e na leitura o índice das linhas seguintes anda —
    // foi assim que `sinais_culturais` (array vazio) voltou como ausente em vez de [].
    const cols = colunasDe(itens);
    return [
      [MARCA_FORMA, 'lista', updatedAt, itens.length],
      cols.length ? cols : ['_vazio'],
      ...itens.map(it => cols.map(c => cel(it[c]))),
    ];
  }

  if (forma === 'mapa') {
    const chaves = Object.keys(valor);
    const cols = colunasDe(chaves.map(k => valor[k]));
    return [
      [MARCA_FORMA, 'mapa', updatedAt, chaves.length],
      ['_chave', ...cols],
      ...chaves.map(k => [k, ...cols.map(c => cel(valor[k][c]))]),
    ];
  }

  // chave_valor: objeto de escalares/arrays soltos, ou um escalar puro.
  if (ehObjetoSimples(valor)) {
    const chaves = Object.keys(valor);
    return [
      [MARCA_FORMA, 'chave_valor', updatedAt, chaves.length],
      ['_chave', '_valor'],
      ...chaves.map(k => [k, cel(valor[k])]),
    ];
  }
  return [[MARCA_FORMA, 'bruto', updatedAt, 1], ['_valor'], [cel(valor)]];
}

export function deTabela(linhas) {
  if (!linhas || !linhas.length) return undefined;
  const cab = linhas[0] || [];
  if (cab[0] !== MARCA_FORMA) throw new Error('aba sem marcador de forma na linha 1');
  const forma = cab[1];
  const cols = linhas[1] || [];
  const dados = linhas.slice(2);

  // Coleção vazia é estado legítimo (nenhum sinal cultural ainda, TER sem auditoria…) e
  // precisa voltar como [] / {}, nunca como ausente — quem consome faz .filter/.length em
  // cima disso. Decidido pela FORMA da linha 1, que sempre existe.
  if (!dados.length) {
    if (forma === 'lista') return [];
    if (forma === 'mapa' || forma === 'chave_valor') return {};
  }

  if (forma === 'bruto') {
    return descel(dados[0] && dados[0][0]);
  }

  if (forma === 'lista') {
    return dados.map(l => {
      const o = {};
      cols.forEach((c, i) => {
        const v = descel(l[i]);
        if (v !== undefined) o[c] = v;
      });
      return o;
    });
  }

  if (forma === 'mapa') {
    const out = {};
    const subcols = cols.slice(1);
    for (const l of dados) {
      const chave = l[0];
      if (chave === undefined || chave === '') continue;
      const o = {};
      subcols.forEach((c, i) => {
        const v = descel(l[i + 1]);
        if (v !== undefined) o[c] = v;
      });
      out[String(chave)] = o;
    }
    return out;
  }

  if (forma === 'chave_valor') {
    const out = {};
    for (const l of dados) {
      const chave = l[0];
      if (chave === undefined || chave === '') continue;
      const v = descel(l[1]);
      out[String(chave)] = v === undefined ? null : v;
    }
    return out;
  }

  throw new Error('forma desconhecida: ' + forma);
}
