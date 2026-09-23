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

function paragrafo(rotulo, valor) {
  const v = String(valor == null ? '' : valor).trim();
  const ehLink = /^https?:\/\//i.test(v);
  const partes = [{ type: 'text', text: { content: rotulo + ' ' }, annotations: { bold: true } }];
  if (v && ehLink) partes.push({ type: 'text', text: { content: v.slice(0, 2000), link: { url: v.slice(0, 2000) } } });
  else if (v) partes.push({ type: 'text', text: { content: v.slice(0, 2000) } });
  return { type: 'paragraph', paragraph: { rich_text: partes } };
}

// Texto longo virando um parágrafo por linha — o Notion tem limite de 2000 caracteres por
// trecho de texto, e um bloco só com tudo junto fica ilegível na página.
function paragrafosDeTextoLongo(rotulo, valor) {
  const v = String(valor == null ? '' : valor).trim();
  if (!v) return [paragrafo(rotulo, '')];
  const linhas = v.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocos = [paragrafo(rotulo, '')];
  for (const linha of linhas) {
    for (let i = 0; i < linha.length; i += 1900) {
      blocos.push({ type: 'paragraph', paragraph: { rich_text: rico(linha.slice(i, i + 1900)) } });
    }
  }
  return blocos;
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
    ...paragrafosDeTextoLongo('O que motivou a contratação:', d.motivacao),
    ...paragrafosDeTextoLongo('Objeções levantadas e como foram tratadas:', d.objecoes),
    ...paragrafosDeTextoLongo('Promessas e expectativas geradas:', d.promessas),
    paragrafo('Link do contrato assinado:', d.contrato),

    { type: 'heading_3', heading_3: { rich_text: rico('4. Informações importantes sobre o projeto:') } },
    ...paragrafosDeTextoLongo('', d.informacoes).slice(1),

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
