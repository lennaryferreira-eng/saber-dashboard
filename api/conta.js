// api/conta.js
// Uma função só para login, sessão e usuários. O plano Hobby da Vercel aceita no máximo 12
// funções por deploy e o projeto já estava no teto (ver .vercelignore), então as três rotas
// dividem este arquivo e a lógica de cada uma mora em api/_lib/ (que não conta como função).
//
//   POST   /api/conta?r=token              troca o login_token do Google pelo cookie de sessão
//   GET    /api/conta?r=sessao             quem está logado + lista de usuários
//   DELETE /api/conta?r=sessao             sair
//   POST   /api/conta?r=usuarios           cadastrar (ADM)
//   PATCH  /api/conta?r=usuarios&id=...    alterar
//   DELETE /api/conta?r=usuarios&id=...    remover (ADM)

import token from './_lib/rota-token.js';
import sessao from './_lib/rota-sessao.js';
import usuarios from './_lib/rota-usuarios.js';

const ROTAS = { token, sessao, usuarios };

export default async function handler(req, res) {
  const rota = ROTAS[req.query && req.query.r];
  if (!rota) {
    res.status(404).json({ error: 'Rota desconhecida' });
    return;
  }
  return rota(req, res);
}
