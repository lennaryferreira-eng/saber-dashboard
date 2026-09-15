// api/_lib/rota-sessao.js — atende /api/conta?r=sessao (ver api/conta.js)
// GET    → quem está logado (lido do cookie assinado) + a lista de usuários que essa pessoa
//          pode ver. É a primeira coisa que o painel pergunta ao abrir.
// DELETE → sair: apaga o cookie.

import { emailDaSessao, cookieDeSaida } from './sessao.js';
import { listarUsuarios, visaoDaLista } from './usuarios.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieDeSaida());
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  let email;
  try {
    email = emailDaSessao(req);
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
  if (!email) {
    res.status(401).json({ error: 'Entre com Google para continuar' });
    return;
  }

  try {
    const todos = await listarUsuarios();
    const eu = todos.find(u => u.email === email);
    if (!eu || eu.acesso === 'nenhum') {
      // Login do Google válido, mas a pessoa não tem acesso: derruba a sessão para o painel
      // não ficar tentando de novo a cada abertura.
      res.setHeader('Set-Cookie', cookieDeSaida());
      res.status(403).json({ error: 'Sua conta (' + email + ') entrou pelo Google, mas não tem acesso a este painel. Peça para um ADM te cadastrar.' });
      return;
    }
    res.status(200).json({ usuario: eu, usuarios: visaoDaLista(eu, todos) });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao carregar a sessão: ' + err.message });
  }
}
