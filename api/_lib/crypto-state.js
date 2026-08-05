// api/_lib/crypto-state.js
// Tokens assinados (HMAC-SHA256) sem estado no servidor — usados pro `state` do OAuth (CSRF)
// e pro token de prova de login de curta duração que volta pro cliente depois do callback.
// Reaproveita GOOGLE_CLIENT_SECRET como chave de assinatura (segredo já existente no servidor,
// sem precisar de infra nova de sessão).

import crypto from 'crypto';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

export function signState(payload, secret) {
  if (!secret) throw new Error('signState: secret ausente');
  const body = { ...payload, ts: payload.ts || Date.now() };
  const encoded = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  return encoded + '.' + sig;
}

export function verifyState(token, secret, maxAgeMs) {
  if (!secret) throw new Error('verifyState: secret ausente');
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) {
    throw new Error('Token inválido');
  }
  const dot = token.indexOf('.');
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Assinatura inválida');
  }
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded).toString('utf8'));
  } catch (e) {
    throw new Error('Payload inválido');
  }
  if (!payload.ts || Date.now() - payload.ts > maxAgeMs) {
    throw new Error('Token expirado');
  }
  return payload;
}
