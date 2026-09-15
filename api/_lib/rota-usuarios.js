// api/_lib/rota-usuarios.js — atende /api/conta?r=usuarios (ver api/conta.js)
// POST            → cadastra (só ADM)
// PATCH  &id=...  → altera (ADM altera tudo; a própria pessoa só nome de exibição, telefone e foto)
// DELETE &id=...  → remove (só ADM)
// A leitura da lista vem junto de GET /api/conta?r=sessao. As regras ficam em _lib/usuarios.js.

import { emailDaSessao } from './sessao.js';
import {
  ErroDeRegra, listarUsuarios, visaoDaLista,
  planejarCriacao, planejarAlteracao, planejarRemocao,
  criarUsuario, alterarUsuario, removerUsuario,
} from './usuarios.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) throw new ErroDeRegra(405, 'Método não permitido');

    const email = emailDaSessao(req);
    if (!email) throw new ErroDeRegra(401, 'Sua sessão expirou. Entre com Google de novo.');

    const todos = await listarUsuarios();
    const ator = todos.find(u => u.email === email);
    if (!ator || ator.acesso === 'nenhum') throw new ErroDeRegra(403, 'Sua conta não tem acesso a este painel');

    const id = req.query && req.query.id;
    if (req.method !== 'POST' && !(typeof id === 'string' && UUID.test(id))) throw new ErroDeRegra(400, 'Informe o id do usuário');
    const alvo = id ? todos.find(u => u.id === id) : null;

    if (req.method === 'POST') {
      await criarUsuario(planejarCriacao(ator, req.body), email);
    } else if (req.method === 'PATCH') {
      await alterarUsuario(id, planejarAlteracao(ator, alvo, req.body, todos), email);
    } else {
      planejarRemocao(ator, alvo, todos);
      await removerUsuario(id);
    }

    // Devolve a lista já atualizada, no recorte que essa pessoa pode ver
    const atualizados = await listarUsuarios();
    const eu = atualizados.find(u => u.email === email) || ator;
    res.status(200).json({ usuario: eu, usuarios: visaoDaLista(eu, atualizados) });
  } catch (err) {
    const status = err instanceof ErroDeRegra ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
}
