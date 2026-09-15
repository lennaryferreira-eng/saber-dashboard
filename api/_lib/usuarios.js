// api/_lib/usuarios.js
// Regras de quem pode ver e mudar o quê na tabela `usuarios`, e o acesso a ela via REST do
// Supabase com a service_role. A tabela tem RLS sem policy e nenhum grant para anon: a chave
// pública do index.html recebe "permission denied". Toda a autorização acontece aqui.
//
// As regras de permissão são funções puras (sem rede), para dar para testar isoladas.

const SB_URL = 'https://riawjqvezolgyldldyzi.supabase.co';

export const ACESSOS = ['adm', 'viewer', 'consultor', 'designer', 'nenhum'];
const TIPOS_SQUAD = ['consultor', 'designer'];
const COORDENACOES = ['saber', 'ter'];

// A própria pessoa muda só isso. Cargo fica de fora de propósito: quem define é o ADM.
export const CAMPOS_DA_PROPRIA_PESSOA = ['nome_exibicao', 'telefone', 'foto'];
export const CAMPOS_DO_ADM = [
  'email', 'nome_exibicao', 'cargo', 'telefone', 'foto', 'acesso',
  'squad_nome', 'squad_tipo', 'coordenacao', 'cor', 'squad_ativo',
];

const COLUNAS = 'id,email,nome_exibicao,cargo,telefone,foto,acesso,squad_nome,squad_tipo,coordenacao,cor,squad_ativo,updated_at,updated_by';

export class ErroDeRegra extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

export function ehAdm(u) { return !!u && u.acesso === 'adm'; }

// Nomes e cargo aparecem em muitos pontos antigos do painel que montam HTML por concatenação
// (filtros, cards, onclick="perfSelecionaConsultor('Nome')"). Escapar todos eles é inviável
// de uma vez, então a barreira fica aqui: sem < > nem caracteres de controle em texto livre,
// e o nome no squad só com letras, espaço, ponto e hífen (nada de aspas).
const SEM_MARCACAO = /^[^<>\u0000-\u001f\u007f]*$/;
const NOME_SQUAD = /^[\p{L}\p{M} .-]+$/u;

function textoOuNulo(v, max, nomeCampo) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ErroDeRegra(400, nomeCampo + ' precisa ser texto');
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw new ErroDeRegra(400, nomeCampo + ' passa de ' + max + ' caracteres');
  if (!SEM_MARCACAO.test(t)) throw new ErroDeRegra(400, nomeCampo + ' não pode ter < ou >');
  return t;
}

// Valida e normaliza só os campos presentes em `entrada`, limitado à lista `permitidos`.
// Campo fora da lista é erro explícito (403), não é ignorado em silêncio: quem mandou
// `acesso: 'adm'` pelo próprio perfil precisa saber que não passou.
export function limparCampos(entrada, permitidos) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new ErroDeRegra(400, 'Corpo da requisição inválido');
  }
  const proibidos = Object.keys(entrada).filter(k => !permitidos.includes(k));
  if (proibidos.length) {
    throw new ErroDeRegra(403, 'Você não pode alterar: ' + proibidos.join(', '));
  }
  const out = {};
  for (const k of Object.keys(entrada)) {
    const v = entrada[k];
    switch (k) {
      case 'email': {
        const e = textoOuNulo(v, 120, 'E-mail');
        if (e !== null && !/^[a-z0-9._%+-]+@v4company\.com$/.test(e.toLowerCase())) {
          throw new ErroDeRegra(400, 'O e-mail precisa ser @v4company.com');
        }
        out.email = e === null ? null : e.toLowerCase();
        break;
      }
      case 'nome_exibicao': {
        const n = textoOuNulo(v, 80, 'Nome de exibição');
        if (n === null) throw new ErroDeRegra(400, 'Nome de exibição não pode ficar vazio');
        out.nome_exibicao = n;
        break;
      }
      case 'cargo': out.cargo = textoOuNulo(v, 80, 'Cargo'); break;
      case 'telefone': {
        const t = textoOuNulo(v, 30, 'Telefone');
        if (t !== null && !/^[0-9+()\-\s]+$/.test(t)) throw new ErroDeRegra(400, 'Telefone só aceita números, espaço, +, ( ) e -');
        out.telefone = t;
        break;
      }
      case 'foto': {
        if (v === null || v === '') { out.foto = null; break; }
        if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) {
          throw new ErroDeRegra(400, 'Foto inválida');
        }
        if (v.length > 200000) throw new ErroDeRegra(400, 'Foto grande demais');
        out.foto = v;
        break;
      }
      case 'acesso':
        if (!ACESSOS.includes(v)) throw new ErroDeRegra(400, 'Acesso inválido');
        out.acesso = v;
        break;
      case 'squad_tipo':
        if (v !== null && !TIPOS_SQUAD.includes(v)) throw new ErroDeRegra(400, 'Tipo de squad inválido');
        out.squad_tipo = v;
        break;
      case 'squad_nome': {
        const s = textoOuNulo(v, 40, 'Nome no squad');
        if (s !== null && !NOME_SQUAD.test(s)) throw new ErroDeRegra(400, 'Nome no squad só aceita letras, espaço, ponto e hífen');
        out.squad_nome = s;
        break;
      }
      case 'coordenacao':
        if (!COORDENACOES.includes(v)) throw new ErroDeRegra(400, 'Coordenação inválida');
        out.coordenacao = v;
        break;
      case 'cor':
        if (v !== null && v !== '' && !/^var\(--[a-z-]+\)$/.test(v)) throw new ErroDeRegra(400, 'Cor inválida');
        out.cor = v || null;
        break;
      case 'squad_ativo':
        if (typeof v !== 'boolean') throw new ErroDeRegra(400, 'squad_ativo precisa ser verdadeiro ou falso');
        out.squad_ativo = v;
        break;
    }
  }
  return out;
}

// Coerência do registro final (o banco também confere, isto é para devolver uma mensagem clara).
export function conferirCoerencia(registro) {
  if ((registro.acesso === 'consultor' || registro.acesso === 'designer')
      && (registro.squad_tipo !== registro.acesso || !registro.squad_nome)) {
    throw new ErroDeRegra(400, 'Quem tem acesso de ' + registro.acesso + ' precisa do "Nome nos projetos" preenchido — é por ele que o painel acha os projetos dessa pessoa');
  }
  const temTipo = !!registro.squad_tipo, temNome = !!registro.squad_nome;
  if (temTipo !== temNome) throw new ErroDeRegra(400, 'Preencha a função e o nome nos projetos juntos, ou deixe os dois vazios');
  if (registro.acesso !== 'nenhum' && !registro.email) {
    throw new ErroDeRegra(400, 'Para ter acesso ao painel, informe o e-mail');
  }
}

// Decide o que um PATCH pode gravar. `todos` é a lista completa, usada para não deixar o
// painel sem nenhum ADM.
export function planejarAlteracao(ator, alvo, corpo, todos) {
  if (!ator) throw new ErroDeRegra(401, 'Entre com Google para continuar');
  if (!alvo) throw new ErroDeRegra(404, 'Usuário não encontrado');
  const ehProprio = ator.id === alvo.id;
  if (!ehAdm(ator) && !ehProprio) throw new ErroDeRegra(403, 'Só um ADM altera o perfil de outra pessoa');

  const campos = limparCampos(corpo, ehAdm(ator) ? CAMPOS_DO_ADM : CAMPOS_DA_PROPRIA_PESSOA);
  const final = { ...alvo, ...campos };
  conferirCoerencia(final);

  if (ehAdm(ator) && ehProprio) {
    // Evita um ADM se trancar para fora por engano
    if ('acesso' in campos && campos.acesso !== 'adm') throw new ErroDeRegra(409, 'Você não pode tirar o seu próprio acesso de ADM');
    if ('email' in campos && campos.email !== alvo.email) throw new ErroDeRegra(409, 'Você não pode trocar o seu próprio e-mail de login');
  }
  if (ehAdm(alvo) && final.acesso !== 'adm' && todos.filter(ehAdm).length <= 1) {
    throw new ErroDeRegra(409, 'O painel precisa de pelo menos um ADM');
  }
  return campos;
}

export function planejarCriacao(ator, corpo) {
  if (!ehAdm(ator)) throw new ErroDeRegra(403, 'Só um ADM cadastra usuários');
  const campos = limparCampos(corpo, CAMPOS_DO_ADM);
  const final = { acesso: 'nenhum', coordenacao: 'saber', squad_ativo: true, ...campos };
  if (!final.nome_exibicao) throw new ErroDeRegra(400, 'Informe o nome de exibição');
  conferirCoerencia(final);
  return final;
}

export function planejarRemocao(ator, alvo, todos) {
  if (!ehAdm(ator)) throw new ErroDeRegra(403, 'Só um ADM remove usuários');
  if (!alvo) throw new ErroDeRegra(404, 'Usuário não encontrado');
  if (ator.id === alvo.id) throw new ErroDeRegra(409, 'Você não pode remover o seu próprio usuário');
  if (ehAdm(alvo) && todos.filter(ehAdm).length <= 1) throw new ErroDeRegra(409, 'O painel precisa de pelo menos um ADM');
}

// O que cada pessoa enxerga da lista. Telefone é dado de contato pessoal: aparece para o
// ADM e para a própria pessoa, para mais ninguém.
export function visaoDaLista(ator, todos) {
  return todos.map(u => {
    if (ehAdm(ator) || u.id === ator.id) return u;
    const { telefone, ...resto } = u;
    return resto;
  });
}

// ── Supabase ─────────────────────────────────────────────────────────
function cabecalhos(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado no Vercel');
  return { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, ...(extra || {}) };
}

async function chamar(caminho, opcoes) {
  const res = await fetch(SB_URL + '/rest/v1/' + caminho, opcoes);
  const corpo = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (corpo && (corpo.message || corpo.details)) || ('HTTP ' + res.status);
    // 23505 = unique_violation (e-mail ou nome no squad repetido); 23514 = check do banco
    if (corpo && corpo.code === '23505') throw new ErroDeRegra(409, 'Já existe alguém com esse e-mail ou com esse nome no squad');
    if (corpo && corpo.code === '23514') throw new ErroDeRegra(400, 'Dados inconsistentes: ' + msg);
    throw new Error('Supabase: ' + msg);
  }
  return corpo;
}

export async function listarUsuarios() {
  return chamar('usuarios?select=' + COLUNAS + '&order=nome_exibicao.asc', { headers: cabecalhos() });
}

export async function criarUsuario(registro, porEmail) {
  const linhas = await chamar('usuarios?select=' + COLUNAS, {
    method: 'POST',
    headers: cabecalhos({ Prefer: 'return=representation' }),
    body: JSON.stringify([{ ...registro, updated_by: porEmail }]),
  });
  return linhas[0];
}

export async function alterarUsuario(id, campos, porEmail) {
  const linhas = await chamar('usuarios?id=eq.' + encodeURIComponent(id) + '&select=' + COLUNAS, {
    method: 'PATCH',
    headers: cabecalhos({ Prefer: 'return=representation' }),
    body: JSON.stringify({ ...campos, updated_at: new Date().toISOString(), updated_by: porEmail }),
  });
  return linhas[0];
}

export async function removerUsuario(id) {
  await chamar('usuarios?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: cabecalhos({ Prefer: 'return=minimal' }) });
}
