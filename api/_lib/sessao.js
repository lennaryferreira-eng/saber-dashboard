// api/_lib/sessao.js
// Sessão do painel: um cookie HttpOnly assinado (HMAC, mesmo esquema de crypto-state.js) com
// o e-mail que o Google confirmou no login. Substitui o antigo `saber_gsi_email` no
// localStorage, que qualquer um trocava pelo console e virava ADM — o cookie não é legível
// por JavaScript e não dá pra forjar sem o GOOGLE_CLIENT_SECRET.
//
// O token leva `typ: 'sessao'` de propósito: o mesmo segredo assina o `state` do OAuth e o
// `login_token` de 5 minutos, e sem esse campo um desses tokens poderia ser colado no cookie
// e aceito como sessão.

import { signState, verifyState } from './crypto-state.js';

export const NOME_COOKIE = 'gh_sessao';
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias, o "lembrar de mim" que já existia

function segredo() {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET não configurado no servidor');
  return s;
}

function lerCookie(req, nome) {
  const header = (req.headers && req.headers.cookie) || '';
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

export function cookieDeSessao(email) {
  const token = signState({ typ: 'sessao', email }, segredo());
  return NOME_COOKIE + '=' + encodeURIComponent(token)
    + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + Math.floor(DURACAO_MS / 1000);
}

export function cookieDeSaida() {
  return NOME_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

// E-mail da sessão, ou null se não há cookie, a assinatura não bate, expirou ou não é
// um token de sessão.
export function emailDaSessao(req) {
  const token = lerCookie(req, NOME_COOKIE);
  if (!token) return null;
  try {
    const payload = verifyState(token, segredo(), DURACAO_MS);
    if (payload.typ !== 'sessao' || typeof payload.email !== 'string') return null;
    return payload.email.toLowerCase();
  } catch (e) {
    return null;
  }
}
