// api/_lib/rota-ferramentas.js — atende /api/conta?r=ferramentas&f=... (ver api/conta.js)
// As ferramentas que o consultor usa dentro do painel:
//
//   GET  ?f=dossies[&busca=]   lista os dossiês do Notion (criados pela automação do comercial)
//   POST ?f=contexto           acha a pasta do cliente no Drive e os links de entrega/gravação
//   POST ?f=redigir            a IA escreve os campos de texto do dossiê a partir das reuniões
//   POST ?f=gravar             escreve o dossiê dentro do "Fechamento Expansão" no Notion
//   POST ?f=agenda             cria os convites das etapas na agenda do próprio consultor
//
// Regra que vale pra todas: quem fala com o Google é o token da PESSOA logada (login por
// pessoa, api/google/login-callback.js). O consultor só encontra no Drive o que já podia
// abrir, e o convite sai no nome dele. O token da conta compartilhada não é usado aqui.

import { emailDaSessao } from './sessao.js';
import { listarUsuarios } from './usuarios.js';
import { getGoogleConnection } from './supabase.js';
import { getAccessToken, buscarPastas, listarConteudoDaPasta, listCalendarEvents, criarEventoNaAgenda, exportFileAsText, lerArquivoDoDrive } from './google.js';
import { listarDossies, acharSecaoExpansao, blocosDoDossie, escreverNaSecao, limparSecao, ErroNotion, TITULO_EXPANSAO } from './notion.js';
import { callClaude } from './anthropic.js';

// Quem entra como obrigatório em todo convite, além do designer do projeto. Definido com a
// coordenação em 23/09/2026: a coordenadora da SABER acompanha todas as etapas.
const SEMPRE_OBRIGATORIO = ['lennary.ferreira@v4company.com'];

class ErroDeUso extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

async function quemEsta(req) {
  const email = emailDaSessao(req);
  if (!email) throw new ErroDeUso(401, 'Entre com Google para continuar');
  const todos = await listarUsuarios();
  const eu = todos.find((u) => u.email === email);
  if (!eu || eu.acesso === 'nenhum') throw new ErroDeUso(403, 'Sua conta não tem acesso a este painel.');
  // As ferramentas escrevem fora do painel (Notion e Agenda), então acesso de visualização
  // não entra — nem chamando a rota na mão. Mesma regra que esconde a aba no navegador.
  if (eu.acesso === 'viewer') throw new ErroDeUso(403, 'Seu acesso é de visualização: as ferramentas são de consultor.');
  return { eu, todos };
}

// Token do Google da própria pessoa. Sem conexão, a ferramenta não tem o que fazer — e a
// mensagem precisa dizer o caminho, porque conectar é um clique no painel.
async function tokenDaPessoa(email) {
  const conn = await getGoogleConnection(email);
  if (!conn) {
    throw new ErroDeUso(409, 'Sua conta do Google ainda não está conectada ao painel. Saia e entre de novo para autorizar o Drive e a Agenda.');
  }
  return { accessToken: await getAccessToken({ refreshToken: conn.refresh_token }), escopos: conn.scopes || '' };
}

// ── Dossiês ──────────────────────────────────────────────────────────

async function rotaDossies(req, res) {
  await quemEsta(req);
  const dossies = await listarDossies({ busca: req.query.busca || '' });
  res.status(200).json({ dossies });
}

// ── Contexto no Drive e na Agenda ────────────────────────────────────

// Casa o nome de um arquivo/pasta com a etapa do projeto. Os nomes que as contas usam variam
// ("Kick-off", "Kickoff", "1ª Entrega", "Entrega 1", "Plano de Decolagem"), então cada etapa
// tem uma lista de pistas. Quem decide no fim é o consultor: tudo isso chega editável na tela.
const PISTAS_ETAPA = {
  kickoff: ['kick-off', 'kick off', 'kickoff'],
  entrega1: ['1ª entrega', '1a entrega', 'entrega 1', 'primeira entrega'],
  entrega2: ['2ª entrega', '2a entrega', 'entrega 2', 'segunda entrega'],
  entrega3: ['3ª entrega', '3a entrega', 'entrega 3', 'terceira entrega'],
  decolagem: ['decolagem', 'apresentação final', 'apresentacao final', 'plano de decolagem'],
};

function semAcento(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function acharPorPistas(itens, chave) {
  const pistas = PISTAS_ETAPA[chave] || [];
  for (const pista of pistas) {
    const alvo = semAcento(pista);
    const achado = itens.find((i) => semAcento(i.caminho + '/' + i.nome).includes(alvo));
    if (achado) return achado;
  }
  return null;
}

function dataMaisDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Procura, na agenda da pessoa, a reunião daquela etapa: mesma data (com um dia de folga pra
// cada lado) e o nome do cliente no título. Devolve o link da transcrição/anotações do Meet
// quando o evento tem o documento anexado, senão o link do próprio evento.
async function gravacaoDaEtapa({ accessToken, cliente, dataISO }) {
  if (!dataISO) return null;
  const inicio = new Date(dataMaisDias(dataISO, -1) + 'T00:00:00-03:00').toISOString();
  const fim = new Date(dataMaisDias(dataISO, 2) + 'T00:00:00-03:00').toISOString();
  let eventos;
  try {
    eventos = await listCalendarEvents({ accessToken, timeMinISO: inicio, timeMaxISO: fim });
  } catch (e) {
    return null; // agenda indisponível não pode derrubar o resto do contexto
  }
  const alvo = semAcento(cliente);
  const candidatos = eventos.filter((ev) => semAcento(ev.summary).includes(alvo));
  const comDoc = candidatos.find((ev) => (ev.attachments || []).some((a) => a.mimeType === 'application/vnd.google-apps.document'));
  const escolhido = comDoc || candidatos[0];
  if (!escolhido) return null;
  const anexo = (escolhido.attachments || []).find((a) => a.mimeType === 'application/vnd.google-apps.document');
  return {
    titulo: escolhido.summary || '',
    quando: (escolhido.start && (escolhido.start.dateTime || escolhido.start.date)) || '',
    link: (anexo && anexo.fileUrl) || escolhido.hangoutLink || '',
    docId: (anexo && anexo.fileId) || null,
  };
}

async function rotaContexto(req, res) {
  const { eu } = await quemEsta(req);
  const { cliente, etapas, pastaId } = req.body || {};
  if (!cliente || typeof cliente !== 'string') throw new ErroDeUso(400, 'Informe o cliente');
  const { accessToken } = await tokenDaPessoa(eu.email);

  // 1) pasta do cliente: as candidatas vão todas pra tela; a primeira (mais recente) é a
  //    que já vem escolhida, ou a que o consultor fixou numa busca anterior.
  const candidatas = await buscarPastas({ accessToken, termo: cliente });
  const pasta = pastaId ? (candidatas.find((c) => c.id === pastaId) || { id: pastaId, name: '', webViewLink: '' }) : candidatas[0] || null;

  // 2) o que tem dentro dela, pra achar o arquivo de cada entrega
  const conteudo = pasta ? await listarConteudoDaPasta({ accessToken, folderId: pasta.id }) : [];
  const entregas = {};
  for (const chave of Object.keys(PISTAS_ETAPA)) {
    const achado = acharPorPistas(conteudo, chave);
    entregas[chave] = achado ? { nome: achado.nome, link: achado.link } : null;
  }

  // 3) a gravação/transcrição de cada etapa, pela data que o painel já tem
  const gravacoes = {};
  const listaEtapas = Array.isArray(etapas) ? etapas : [];
  for (const chave of Object.keys(PISTAS_ETAPA)) {
    const etapa = listaEtapas.find((e) => e && e.chave === chave);
    gravacoes[chave] = etapa && etapa.data ? await gravacaoDaEtapa({ accessToken, cliente, dataISO: etapa.data }) : null;
  }

  res.status(200).json({
    pasta: pasta ? { id: pasta.id, nome: pasta.name || '', link: pasta.webViewLink || '' } : null,
    candidatas: candidatas.map((c) => ({ id: c.id, nome: c.name, link: c.webViewLink || '' })),
    entregas,
    gravacoes,
    arquivos: conteudo.filter((i) => !i.pasta).slice(0, 60).map((i) => ({ nome: i.nome, caminho: i.caminho, link: i.link })),
  });
}

// ── Redação com a IA ────────────────────────────────────────────────

const SISTEMA_REDACAO = `Você escreve o dossiê de transição de um projeto de Estruturação Estratégica da V4 Company, que passa o bastão do consultor para quem vai operar a conta.

Você recebe, em qualquer combinação: o contrato assinado (PDF ou texto), as anotações da call de expansão (a reunião em que a venda foi fechada) e as anotações das reuniões de entrega do projeto. Devolve APENAS um JSON válido, sem markdown e sem texto em volta:

{
  "produto": "O serviço contratado, exatamente como está escrito no contrato",
  "valor": "O valor, com a moeda e o número como aparecem no contrato",
  "formaPagamento": "Forma de pagamento e parcelamento como está no contrato",
  "inicioServico": "Data de início do novo serviço no formato AAAA-MM-DD, se estiver clara",
  "motivacao": "O que pesou na decisão de contratar e qual argumento fechou. 2 a 4 frases.",
  "objecoes": "As objeções que o cliente levantou e como foram tratadas. Uma por linha, no formato 'Objeção — como foi tratada'.",
  "promessas": "O que foi dito que o cliente espera receber e em qual prazo. Uma por linha.",
  "informacoes": "O que quem for operar a conta precisa saber e não está em nenhum outro campo: contexto do negócio, quem decide, jeito de trabalhar, riscos e combinados. 3 a 6 linhas."
}

Regras:
- Os quatro primeiros campos são cópia fiel do contrato. Não arredonde valor, não converta data por dedução, não complete parcelamento que não está escrito. Se o contrato não disser, devolva string vazia — quem preenche à mão é o consultor.
- Os quatro últimos vêm das reuniões, principalmente da call de expansão. Só afirme o que estiver nas anotações. Sem base, escreva exatamente "Não identificado nas reuniões — preencher à mão".
- Nada de elogio, adjetivo de vendedor ou frase de efeito. Quem lê precisa operar a conta amanhã.
- Português do Brasil, direto, sem jargão de IA.
- Pode usar marcação simples nos campos de texto, que o dossiê renderiza: **negrito**, listas começando a linha com "- ", listas numeradas com "1. " e "### " pra um subtítulo. Não use tabela nem bloco de código.
- Nome de pessoa, valor e prazo: copie como está na fonte.`;

async function rotaRedigir(req, res) {
  const { eu } = await quemEsta(req);
  const { cliente, gravacoes, negociacao, contrato, callExpansao } = req.body || {};
  if (!cliente) throw new ErroDeUso(400, 'Informe o cliente');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ErroDeUso(503, 'ANTHROPIC_API_KEY não configurada no servidor');
  const { accessToken } = await tokenDaPessoa(eu.email);

  const blocos = [];   // conteúdo da mensagem pro Claude, PDF incluído
  const lidas = [];    // o que deu pra ler, pra dizer na tela
  const avisos = [];   // o que não deu, com o motivo

  // 1) contrato assinado — PDF vai como documento (o Claude lê PDF nativo), Doc vai como texto
  if (contrato) {
    try {
      const arq = await lerArquivoDoDrive({ accessToken, link: contrato });
      if (arq.pdfBase64) {
        blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arq.pdfBase64 } });
        lidas.push('contrato (PDF' + (arq.nome ? ': ' + arq.nome : '') + ')');
      } else {
        blocos.push({ type: 'text', text: '### Contrato assinado' + (arq.nome ? ' — ' + arq.nome : '') + '\n' + String(arq.texto || '').slice(0, 60000) });
        lidas.push('contrato' + (arq.nome ? ' (' + arq.nome + ')' : ''));
      }
    } catch (e) {
      avisos.push('contrato: ' + e.message);
    }
  }

  // 2) call de expansão — é dela que saem motivação, objeções e promessas
  if (callExpansao) {
    try {
      const arq = await lerArquivoDoDrive({ accessToken, link: callExpansao });
      if (arq.pdfBase64) {
        blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arq.pdfBase64 } });
        lidas.push('call de expansão (PDF)');
      } else {
        blocos.push({ type: 'text', text: '### Call de expansão (onde a venda foi fechada)\n' + String(arq.texto || '').slice(0, 60000) });
        lidas.push('call de expansão');
      }
    } catch (e) {
      avisos.push('call de expansão: ' + e.message);
    }
  }

  // 3) reuniões de entrega que já têm anotação anexada no evento da agenda, na ordem em que
  //    ajudam mais a entender a conta (kick-off e decolagem contam o começo e o fim)
  const ordem = ['kickoff', 'decolagem', 'entrega3', 'entrega2', 'entrega1'];
  let reunioes = 0;
  for (const chave of ordem) {
    const g = gravacoes && gravacoes[chave];
    if (!g || !g.docId) continue;
    try {
      const texto = await exportFileAsText({ accessToken, fileId: g.docId });
      blocos.push({ type: 'text', text: '### Reunião ' + chave + (g.titulo ? ' — ' + g.titulo : '') + '\n' + texto.slice(0, 18000) });
      reunioes++;
    } catch (e) { /* sem permissão de leitura nessa: segue sem ela */ }
    if (reunioes >= 3) break; // três reuniões já dão o retrato; mais que isso estoura o tempo
  }
  if (reunioes) lidas.push(reunioes + ' reunião(ões) de entrega');

  if (!blocos.length) {
    throw new ErroDeUso(422, 'Não achei nada pra ler. Cole o link do contrato e o da call de expansão'
      + (avisos.length ? ' — ' + avisos.join('; ') : '') + '.');
  }

  // O texto do pedido vai por último: o modelo lê melhor quando os documentos vêm antes.
  blocos.push({ type: 'text', text: 'Cliente: ' + cliente
    + '\n\nCampos que o consultor já preencheu (não contradiga sem base no contrato): '
    + JSON.stringify(negociacao || {})
    + '\n\nPreencha o JSON pedido a partir dos documentos acima.' });

  // Sem `temperature`: o callClaude compartilhado aponta pro claude-sonnet-5, que recusa o
  // parâmetro (a justificativa está no comentário do anthropic.js).
  const resposta = await callClaude({
    apiKey,
    system: SISTEMA_REDACAO,
    conteudo: blocos,
    maxTokens: 2500,
  });
  if (!resposta.ok) {
    const msg = (resposta.data && resposta.data.error && resposta.data.error.message) || ('HTTP ' + resposta.status);
    throw new ErroDeUso(502, 'A IA não respondeu: ' + msg);
  }
  const texto = ((resposta.data && resposta.data.content) || [])
    .filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const bruto = String(texto || '').trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch (e) {
    throw new ErroDeUso(502, 'A IA respondeu fora do formato esperado. Tente de novo ou escreva os campos à mão.');
  }
  res.status(200).json({ campos: dados, lidas, avisos, reunioesLidas: reunioes });
}

// ── Gravar no Notion ────────────────────────────────────────────────

async function rotaGravar(req, res) {
  const { eu } = await quemEsta(req);
  const { pageId, dados, substituir } = req.body || {};
  if (!pageId || typeof pageId !== 'string') throw new ErroDeUso(400, 'Escolha o dossiê no Notion');
  if (!dados || typeof dados !== 'object') throw new ErroDeUso(400, 'Nada para gravar');

  const secao = await acharSecaoExpansao(pageId);
  if (!secao) {
    throw new ErroDeUso(422, 'Esse dossiê não tem a seção "' + TITULO_EXPANSAO + '". Ele deve ser de um modelo antigo — crie a seção no Notion e tente de novo.');
  }
  if (secao.jaTemConteudo && !substituir) {
    res.status(409).json({ error: 'Essa seção já tem conteúdo.', jaTemConteudo: true });
    return;
  }
  if (secao.jaTemConteudo && substituir) await limparSecao(secao.id);

  await escreverNaSecao(secao.id, blocosDoDossie({ ...dados, porQuem: eu.nome_exibicao }));
  res.status(200).json({ ok: true });
}

// ── Agenda ──────────────────────────────────────────────────────────

const EMAIL_VALIDO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

async function rotaAgenda(req, res) {
  const { eu, todos } = await quemEsta(req);
  const { cliente, eventos, convidados, designer, comMeet } = req.body || {};
  if (!cliente) throw new ErroDeUso(400, 'Informe o cliente');
  if (!Array.isArray(eventos) || !eventos.length) throw new ErroDeUso(400, 'Escolha pelo menos uma etapa');
  if (eventos.length > 12) throw new ErroDeUso(400, 'São no máximo 12 convites por vez');

  // Obrigatórios: a coordenação e o designer do projeto. O e-mail do designer vem da tabela
  // de usuários pelo nome que ele usa nos projetos — não do navegador, pra ninguém trocar.
  const obrigatorios = new Set();
  for (const e of SEMPRE_OBRIGATORIO) {
    const pessoa = todos.find((u) => u.email === e);
    if (pessoa && pessoa.email) obrigatorios.add(pessoa.email);
  }
  if (designer) {
    const d = todos.find((u) => u.squad_nome === designer && u.squad_tipo === 'designer');
    if (d && d.email) obrigatorios.add(d.email);
  }
  // Quem cria entra na lista também. O Google já põe essa pessoa como organizadora por ser
  // dona do calendário, mas sem estar entre os participantes ela não aparece na lista de
  // convidados que o cliente vê — e era isso que estava faltando. Entra com a presença já
  // confirmada, porque não faz sentido pedir confirmação no próprio evento.
  obrigatorios.delete(eu.email);

  const opcionais = [...new Set((Array.isArray(convidados) ? convidados : [])
    .map((c) => String(c || '').trim().toLowerCase())
    .filter((c) => c && EMAIL_VALIDO.test(c)))]
    .filter((c) => !obrigatorios.has(c) && c !== eu.email);

  const lista = [
    { email: eu.email, obrigatorio: true, aceito: true, organizador: true },
    ...[...obrigatorios].map((email) => ({ email, obrigatorio: true })),
    ...opcionais.map((email) => ({ email, obrigatorio: false })),
  ];

  const { accessToken } = await tokenDaPessoa(eu.email);
  const criados = [];
  const falhas = [];
  for (const ev of eventos) {
    const titulo = String((ev && ev.titulo) || '').trim();
    const inicio = String((ev && ev.inicio) || '').trim();      // 'AAAA-MM-DDTHH:MM'
    const minutos = Math.min(Math.max(parseInt((ev && ev.minutos) || 60, 10) || 60, 15), 480);
    if (!titulo || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(inicio)) {
      falhas.push({ titulo: titulo || '(sem título)', erro: 'Data ou hora inválida' });
      continue;
    }
    const inicioISO = inicio + ':00-03:00';
    const fimISO = new Date(new Date(inicioISO).getTime() + minutos * 60000).toISOString();
    try {
      const criado = await criarEventoNaAgenda({
        accessToken, titulo,
        descricao: (ev && ev.descricao) || ('Etapa do projeto ' + cliente + ' — criado pelo Painel Growth Hunters.'),
        inicioISO, fimISO, convidados: lista, comMeet: comMeet !== false,
      });
      criados.push({ titulo, quando: inicio, link: criado.link, meet: criado.meet });
    } catch (e) {
      if (e.precisaReconectar) throw new ErroDeUso(409, e.message);
      falhas.push({ titulo, erro: e.message });
    }
  }
  res.status(criados.length ? 200 : 502).json({ criados, falhas, convidados: lista });
}

// ── Despacho ────────────────────────────────────────────────────────

const FERRAMENTAS = {
  dossies: { metodo: 'GET', fn: rotaDossies },
  contexto: { metodo: 'POST', fn: rotaContexto },
  redigir: { metodo: 'POST', fn: rotaRedigir },
  gravar: { metodo: 'POST', fn: rotaGravar },
  agenda: { metodo: 'POST', fn: rotaAgenda },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const alvo = FERRAMENTAS[(req.query && req.query.f) || ''];
  if (!alvo) {
    res.status(404).json({ error: 'Ferramenta desconhecida' });
    return;
  }
  if (req.method !== alvo.metodo) {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }
  try {
    await alvo.fn(req, res);
  } catch (err) {
    const status = err instanceof ErroDeUso || err instanceof ErroNotion ? err.status : 500;
    res.status(status || 500).json({ error: err.message, ...(err.precisaReconectar ? { precisaReconectar: true } : {}) });
  }
}
