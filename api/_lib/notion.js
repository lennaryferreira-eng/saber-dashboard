// api/_lib/notion.js
// Acesso ao Notion onde vivem os dossiês dos clientes. Quem CRIA a página é a automação do
// comercial (repo v4-call-insights, supabase/functions/dossie-generator): ela nasce com uma
// série de títulos recolhíveis vazios, e um deles é "💰 Fechamento Expansão". É esse, e só
// esse, que a ferramenta do consultor preenche aqui — nada mais da página é tocado.
//
// O token é de uma integração do Notion e precisa estar compartilhado com a base. Ele só é
// lido aqui, no servidor.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Mesma base da automação do comercial. Dá pra trocar por variável de ambiente sem mexer no
// código se um dia a base mudar.
const BASE_PADRAO = 'c3ba735123af4618a1bebde6328db17e';

// O texto do título recolhível que a ferramenta preenche. Comparação por "contém", porque o
// emoji e o espaçamento variam conforme quem editou a página por último.
export const TITULO_EXPANSAO = 'Fechamento Expansão';

export class ErroNotion extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function token() {
  const t = process.env.NOTION_TOKEN;
  if (!t) {
    throw new ErroNotion(503, 'O painel ainda não tem acesso ao Notion. Um ADM precisa configurar NOTION_TOKEN no Vercel.');
  }
  return t;
}

function baseId() {
  return process.env.NOTION_DATABASE_ID || BASE_PADRAO;
}

async function notion(metodo, caminho, corpo) {
  const res = await fetch(NOTION_API + caminho, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + token(),
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (dados && dados.message) || ('HTTP ' + res.status);
    // 404 aqui quase sempre é a integração sem acesso à página/base, não página inexistente.
    if (res.status === 404) throw new ErroNotion(404, 'O Notion respondeu "não encontrado". Confira se a integração está compartilhada com a base do dossiê. (' + msg + ')');
    if (res.status === 401) throw new ErroNotion(401, 'O Notion recusou o token da integração (NOTION_TOKEN).');
    throw new ErroNotion(502, 'Notion: ' + msg);
  }
  return dados;
}

// ── Leitura ──────────────────────────────────────────────────────────

function textoDoRico(lista) {
  return (lista || []).map((t) => t.plain_text || (t.text && t.text.content) || '').join('').trim();
}

function resumoDaPagina(pagina) {
  const props = pagina.properties || {};
  const propTitulo = Object.values(props).find((p) => p && p.type === 'title');
  const nome = textoDoRico(propTitulo && propTitulo.title);
  const valorSimples = (chave) => {
    const p = props[chave];
    if (!p) return '';
    if (p.type === 'select') return (p.select && p.select.name) || '';
    if (p.type === 'multi_select') return (p.multi_select || []).map((s) => s.name).join(', ');
    if (p.type === 'rich_text') return textoDoRico(p.rich_text);
    if (p.type === 'date') return (p.date && p.date.start) || '';
    if (p.type === 'people') return (p.people || []).map((x) => x.name).filter(Boolean).join(', ');
    return '';
  };
  return {
    id: String(pagina.id),
    nome,
    url: String(pagina.url || ''),
    closer: valorSimples('Closer'),
    sdr: valorSimples('SDR'),
    tags: valorSimples('Tags'),
    dataFechamento: valorSimples('Data'),
    editadoEm: String(pagina.last_edited_time || ''),
    criadoEm: String(pagina.created_time || ''),
  };
}

// Lista os dossiês da base, mais recentes primeiro. `busca` é opcional e filtra pelo nome
// (feito aqui, não no Notion: o filtro do Notion exige saber o nome exato da propriedade de
// título, que varia, e a base é pequena o bastante pra filtrar em memória).
export async function listarDossies({ busca } = {}) {
  const paginas = [];
  let cursor;
  do {
    const dados = await notion('POST', '/databases/' + baseId() + '/query', {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    paginas.push(...(dados.results || []));
    cursor = dados.has_more ? dados.next_cursor : undefined;
  } while (cursor && paginas.length < 600); // teto de segurança

  const alvo = (busca || '').trim().toLowerCase();
  return paginas
    .map(resumoDaPagina)
    .filter((d) => d.nome)
    .filter((d) => !alvo || d.nome.toLowerCase().includes(alvo));
}

// Acha o bloco do título recolhível que a ferramenta preenche, e diz se ele já tem conteúdo.
// Devolve null quando a página não tem esse título (dossiê de um modelo antigo, por exemplo).
export async function acharSecaoExpansao(pageId) {
  const dados = await notion('GET', '/blocks/' + encodeURIComponent(pageId) + '/children?page_size=100');
  const blocos = dados.results || [];
  const bloco = blocos.find((b) => {
    const rico = (b.heading_3 && b.heading_3.rich_text) || (b.heading_2 && b.heading_2.rich_text)
      || (b.heading_1 && b.heading_1.rich_text) || (b.toggle && b.toggle.rich_text);
    return rico && textoDoRico(rico).includes(TITULO_EXPANSAO);
  });
  if (!bloco) return null;
  const filhos = await notion('GET', '/blocks/' + encodeURIComponent(bloco.id) + '/children?page_size=10');
  return { id: bloco.id, jaTemConteudo: (filhos.results || []).length > 0 };
}

// ── Escrita ──────────────────────────────────────────────────────────

function rico(texto) {
  return [{ type: 'text', text: { content: String(texto == null ? '' : texto).slice(0, 2000) } }];
}

// Marcação inline: **negrito**, __negrito__, *itálico*, _itálico_, `código`, ~~riscado~~ e
// [texto](url). O itálico com um marcador só exige que ele não esteja encostado em letra ou
// número, senão nome_de_variavel e 3*4 viravam itálico no meio do texto.
const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])|`([^`]+)`|~~([^~]+)~~/gu;

// Um texto vira a lista de trechos que o Notion chama de rich_text. Dois limites da API
// moram aqui: 2000 caracteres por trecho e 100 trechos por bloco.
function richTexto(texto) {
  const t = String(texto == null ? '' : texto);
  const partes = [];
  const empurrar = (conteudo, anotacoes, url) => {
    if (!conteudo) return;
    for (let i = 0; i < conteudo.length && partes.length < 95; i += 1900) {
      partes.push({
        type: 'text',
        text: { content: conteudo.slice(i, i + 1900), ...(url ? { link: { url: url.slice(0, 2000) } } : {}) },
        ...(anotacoes ? { annotations: anotacoes } : {}),
      });
    }
  };
  let ultimo = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(t)) !== null) {
    empurrar(t.slice(ultimo, m.index));
    if (m[1]) empurrar(m[1], null, m[2]);
    else if (m[3] || m[4]) empurrar(m[3] || m[4], { bold: true });
    else if (m[5] || m[6]) empurrar(m[5] || m[6], { italic: true });
    else if (m[7]) empurrar(m[7], { code: true });
    else if (m[8]) empurrar(m[8], { strikethrough: true });
    ultimo = m.index + m[0].length;
  }
  empurrar(t.slice(ultimo));
  return partes;
}

// URL solta no meio do texto o Notion não transforma em link quando vem pela API, só quando
// alguém cola na mão. Então quem escreve um link sem marcação também sai clicável.
function richTextoComLinksSoltos(texto) {
  const t = String(texto == null ? '' : texto);
  if (!/https?:\/\//i.test(t) || /\]\(https?:/i.test(t)) return richTexto(t);
  const partes = [];
  let ultimo = 0;
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    partes.push(...richTexto(t.slice(ultimo, m.index)));
    partes.push({ type: 'text', text: { content: m[0].slice(0, 2000), link: { url: m[0].slice(0, 2000) } } });
    ultimo = m.index + m[0].length;
  }
  partes.push(...richTexto(t.slice(ultimo)));
  return partes.slice(0, 95);
}

// Marcação de bloco, linha por linha: título, lista com marcador, lista numerada, citação,
// linha divisória — e parágrafo pro resto. `comoLista` transforma linha comum em item de
// lista, pros campos que o modelo escreve como "um por linha" (objeções, promessas).
function blocosDeTexto(valor, opcoes) {
  const o = opcoes || {};
  const blocos = [];
  for (const linhaCrua of String(valor == null ? '' : valor).split('\n')) {
    const linha = linhaCrua.trim();
    if (!linha) continue;
    if (/^([-*_]\s*){3,}$/.test(linha)) { blocos.push({ type: 'divider', divider: {} }); continue; }
    let m;
    if ((m = linha.match(/^#{1,6}\s+(.*)$/))) {
      blocos.push({ type: 'heading_3', heading_3: { rich_text: richTexto(m[1]) } });
    } else if ((m = linha.match(/^[-*•–]\s+(.*)$/))) {
      blocos.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: richTextoComLinksSoltos(m[1]) } });
    } else if ((m = linha.match(/^\d+[.)]\s+(.*)$/))) {
      blocos.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: richTextoComLinksSoltos(m[1]) } });
    } else if ((m = linha.match(/^>\s*(.*)$/))) {
      blocos.push({ type: 'quote', quote: { rich_text: richTextoComLinksSoltos(m[1]) } });
    } else if (o.comoLista) {
      blocos.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: richTextoComLinksSoltos(linha) } });
    } else {
      blocos.push({ type: 'paragraph', paragraph: { rich_text: richTextoComLinksSoltos(linha) } });
    }
  }
  return blocos;
}

function rotuloEmNegrito(rotulo) {
  return { type: 'text', text: { content: rotulo + ' ' }, annotations: { bold: true } };
}

// Campo de uma linha: rótulo em negrito e o valor na mesma linha (link vira clicável).
function paragrafo(rotulo, valor) {
  const v = String(valor == null ? '' : valor).trim();
  return { type: 'paragraph', paragraph: { rich_text: [rotuloEmNegrito(rotulo), ...richTextoComLinksSoltos(v)] } };
}

// Campo de texto longo. Valor de uma linha fica junto do rótulo; valor com várias linhas ou
// com lista ganha o rótulo numa linha e os blocos embaixo.
function campoLongo(rotulo, valor, opcoes) {
  const v = String(valor == null ? '' : valor).trim();
  if (!v) return [paragrafo(rotulo, '')];
  const blocos = blocosDeTexto(v, opcoes);
  if (!blocos.length) return [paragrafo(rotulo, '')];
  if (blocos.length === 1 && blocos[0].type === 'paragraph') {
    return [{ type: 'paragraph', paragraph: { rich_text: [rotuloEmNegrito(rotulo), ...blocos[0].paragraph.rich_text] } }];
  }
  return [paragrafo(rotulo, ''), ...blocos];
}

// Uma etapa pode ter dois links: a gravação/transcrição da reunião e o arquivo da entrega
// na pasta do cliente. Os dois viram link clicável no mesmo parágrafo, com rótulo — nada de
// URL crua no meio do texto, que o Notion não transforma em link quando vem pela API.
function paragrafoDaEtapa(rotulo, etapa) {
  const e = etapa || {};
  const partes = [{ type: 'text', text: { content: rotulo + ': ' }, annotations: { bold: true } }];
  const link = (texto, url) => ({ type: 'text', text: { content: texto, link: { url: String(url).slice(0, 2000) } } });
  const ehUrl = (v) => /^https?:\/\//i.test(String(v || '').trim());
  if (ehUrl(e.gravacao)) partes.push(link('gravação/transcrição', e.gravacao.trim()));
  else if (e.gravacao) partes.push({ type: 'text', text: { content: String(e.gravacao).slice(0, 2000) } });
  if (ehUrl(e.entrega)) {
    if (partes.length > 1) partes.push({ type: 'text', text: { content: ' · ' } });
    partes.push(link('arquivo da entrega', e.entrega.trim()));
  }
  if (e.nota) partes.push({ type: 'text', text: { content: (partes.length > 1 ? ' — ' : '') + String(e.nota).slice(0, 1000) } });
  return { type: 'paragraph', paragraph: { rich_text: partes } };
}

// Monta os blocos do "Dossiê de Transição — Estruturação Estratégica V4" na ordem e com os
// rótulos do modelo que a coordenação usa (inclusive a numeração 1, 2, 4 — é assim no modelo).
export function blocosDoDossie(d) {
  const etapas = d.gravacoes || {};
  const rotuloEtapa = (k, rotulo) => paragrafoDaEtapa(rotulo, etapas[k]);
  return [
    { type: 'heading_2', heading_2: { rich_text: rico('Dossiê de Transição — Estruturação Estratégica V4') } },

    { type: 'heading_3', heading_3: { rich_text: rico('1. Entregas do projeto') } },
    paragrafo('Consultor:', d.consultor),
    paragrafo('Closer:', d.closer),
    paragrafo('Pasta do projeto (Drive):', d.pastaDrive),
    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Gravações das reuniões/Transcrição' }, annotations: { bold: true } }] } },
    rotuloEtapa('kickoff', 'Kick-off'),
    rotuloEtapa('entrega1', '1ª Entrega'),
    rotuloEtapa('entrega2', '2ª Entrega'),
    rotuloEtapa('entrega3', '3ª Entrega'),
    rotuloEtapa('decolagem', 'Decolagem'),

    { type: 'heading_3', heading_3: { rich_text: rico('2. Negociação e contrato') } },
    paragrafo('Produto contratado:', d.produto),
    paragrafo('Valor:', d.valor),
    paragrafo('Forma de pagamento:', d.formaPagamento),
    paragrafo('Data de início do novo serviço:', d.inicioServico),
    ...campoLongo('O que motivou a contratação:', d.motivacao),
    ...campoLongo('Objeções levantadas e como foram tratadas:', d.objecoes, { comoLista: true }),
    ...campoLongo('Promessas e expectativas geradas:', d.promessas, { comoLista: true }),
    paragrafo('Link do contrato assinado:', d.contrato),

    { type: 'heading_3', heading_3: { rich_text: rico('4. Informações importantes sobre o projeto:') } },
    ...(blocosDeTexto(d.informacoes).length ? blocosDeTexto(d.informacoes)
      : [{ type: 'paragraph', paragraph: { rich_text: [] } }]),

    {
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: 'Preenchido pelo Painel Growth Hunters em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + (d.porQuem ? ' por ' + d.porQuem : '') + '.' },
          annotations: { italic: true, color: 'gray' },
        }],
      },
    },
  ];
}

// Escreve os blocos dentro do título recolhível. O Notion aceita no máximo 100 blocos por
// chamada; o dossiê é bem menor que isso, mas o laço fica aqui pra não virar bug silencioso
// se o modelo crescer.
export async function escreverNaSecao(blockId, blocos) {
  for (let i = 0; i < blocos.length; i += 90) {
    await notion('PATCH', '/blocks/' + encodeURIComponent(blockId) + '/children', {
      children: blocos.slice(i, i + 90),
    });
  }
}

// Apaga o que estiver dentro da seção — usado quando o consultor escolhe regravar um dossiê
// que já foi preenchido, pra não duplicar o conteúdo.
export async function limparSecao(blockId) {
  const dados = await notion('GET', '/blocks/' + encodeURIComponent(blockId) + '/children?page_size=100');
  for (const b of dados.results || []) {
    await notion('DELETE', '/blocks/' + encodeURIComponent(b.id));
  }
}
