// api/_lib/meeting-filters.js
// Filtro de "reunião interna/genérica, não entra na fila de auditoria" — compartilhado entre
// a fila da conta única (list-meetings.js) e a agenda por pessoa (calendar-events.js), pra
// nunca divergir entre as duas fontes.
//
// Sem padrão fixo de nome (cada consultor nomeia do seu jeito), então em vez de exigir uma
// palavra específica (o que só pegava quem usava aquele termo exato e escondia por completo
// as reuniões de outros consultores) a lista exclui os padrões que são sempre reunião interna
// ou título genérico sem informação nenhuma. Prefere mostrar ruído demais (o ADM ignora/pula
// na hora de montar a fila) a esconder reunião de cliente de verdade.
export const PADROES_INTERNOS = [
  /daily growthunters/i,
  /comit[eê]/i,
  /all hands/i,
  /\bweekly\b/i,
  /^\s*\[cancelado\]/i,
  /^\s*reuni[aã]o iniciada [aà]s/i, // título automático do Meet sem evento de calendário — sem nenhuma informação
  /^\s*anota[cç][oõ]es feitas presencialmente/i, // idem — genérico, sem cliente identificável
  /treinamentos?\s*\|/i, // "Treinamentos | TF&Co: ..." — formato fixo de treinamento interno
  /treinamento.*para consultores/i,
  /treinamento.*copy por ia/i,
  /guaravita/i, // cliente Guaravita não entra nessa fila — pedido explícito
  /viton\s?44/i, // idem — outro nome usado pra Guaravita/Viton 44
  /check[\s-]?in/i, // reunião de check-in (qualquer cliente) não entra nessa fila — pedido explícito
  /alinhamento/i, // qualquer alinhamento (interno ou não) não entra nessa fila — pedido explícito
  /\b1[:\-]1\b/i, // 1:1
  /nrr day/i,
];

export function ehReuniaoInterna(nome) {
  return PADROES_INTERNOS.some((re) => re.test(nome || ''));
}
