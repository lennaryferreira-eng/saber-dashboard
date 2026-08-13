# Changelog — ajuste dimensão por dimensão (meeting-eval-skill.js)

Registro das decisões tomadas por dimensão, pra não perder o histórico entre sessões. Caso de referência fixo: `casos-referencia/2026-08-10-f2solution-diagnostico-vendas.md`. Baseline (prompt original, sem ajustes): `casos-referencia/baseline-2026-08-12.md`.

## D1 — Controle Narrativo — ajustado em 12/08/2026

**O que mudou:**
- Substituída a régua de 4 faixas (85–100/70–84/55–69/<55, com listas "Boa entrega"/"Má entrega" por critério) por 4 âncoras de nota (0/50/75/100), cada uma descrevendo o estado dos 3 critérios juntos, com regra de interpolação entre âncoras.
- Formato de saída da D1 mudou: a `Análise:` agora nomeia os 3 critérios em ordem fixa (Tese central / Progressão lógica / Reencadramento do negativo), cada um com o gap e evidência (ou confirmação curta se já está no nível esperado). O `Plano de ação:` lista os mesmos 3 critérios na mesma ordem, com "manter — já está no padrão esperado, sem ação necessária" pro(s) critério(s) sem gap.

**Por quê:** a régua antiga de faixas ficava vaga sobre quanto cada um dos 3 critérios pesava na nota final — dava pra justificar notas bem diferentes pro mesmo caso dependendo de qual dos 3 critérios o avaliador priorizasse mentalmente. As âncoras fixam o que cada nota exige dos 3 critérios juntos. O formato de saída por critério também torna a Análise/Plano de ação diagnosticável — a coordenadora vê exatamente qual dos 3 critérios está falhando, não uma prosa genérica sobre "condução".

**Teste no caso de referência:** nota mudou de **72** (régua antiga) para **60** (régua nova, âncoras 0/50/75/100) — confirmado como correto pela coordenadora. A queda reflete que vários blocos da reunião (pirâmide de gestão, funil MQL/SQL, lista de ferramentas) são lista solta sem reconexão à tese, o que a régua antiga não penalizava com peso suficiente.

**Exemplo de saída aprovado** (caso F2 Solution, nota 60):
```
d1: 60 (7%)
Análise: Tese central: forte — fica explícita já no bloco de estrutura ("a F2 não precisa contratar mais vendedores, precisa transformar relacionamento... em sistema comercial previsível") e é retomada quase palavra por palavra no fechamento ("transformar relacionamento em processo, processo em previsibilidade e previsibilidade em escala"). Progressão lógica: falha — vários blocos extensos (pirâmide de níveis de gestão, funil MQL/SQL, lista de ferramentas) são apresentados em sequência de slide, sem transição que os amarre de volta à tese; a reunião alterna entre "conduzido pela tese" e "lista de conteúdo solto" várias vezes. Reencadramento do negativo: parcial — o achado mais grave (falta de segurança na passagem de bastão / follow-up fraco) é nomeado e reenquadrado dentro da tese ("F2 sabe entregar, mas precisa diagnosticar antes de apresentar"), mas outros negativos citados (prova comercial fraca, descoberta tardia) ficam apenas mencionados no scorecard, sem reenquadramento explícito de volta à narrativa.
Plano de ação:
- Tese central: manter — já está no padrão esperado, sem ação necessária.
- Progressão lógica: cortar ou reconectar explicitamente os blocos de conteúdo genérico (pirâmide de gestão, funil de marketing, lista de ferramentas) à tese central antes de apresentá-los — uma frase de transição por bloco resolve.
- Reencadramento do negativo: reenquadrar cada negativo citado no scorecard (não só o principal), fechando com "isso confirma [tese]" em vez de deixá-lo só como item da lista.
```

**Status:** aplicado em `api/_lib/meeting-eval-skill.js`.

## Modelo geral (D1–D8) — definido em 12/08/2026
Decisão: o padrão de âncoras 0/50/75/100 + Análise/Plano de ação por critério nomeado (usado na D1) vira o modelo padrão pras 8 dimensões qualitativas (D1–D8). D9 mantém sistema próprio (checklist por tipo de entrega, não muda). Regra geral documentada na skill logo antes da seção da D1 ("Modelo de calibração — D1 a D8") e a regra de formato de saída no bloco "Regras do template" foi generalizada de "D1 específico" pra "D1–D8".

## D2 — Escuta Ativa e Equilíbrio — ajustado em 12/08/2026
**Critérios (já existiam, só ganharam âncoras):** checkpoints, incorporação do cliente, didática preventiva.
**Teste no caso de referência:** 58 (baseline) → **52** — confirmado pela coordenadora. Critério mais fraco: incorporação real do cliente (só 1 caso em 80min, a troca com a Amanda sobre taxa de conversão de MQL).

## D3 — Gestão de Objeções — ajustado em 12/08/2026
**Critérios:** validar antes de redirecionar, resolução ao vivo, autoridade sob pressão.
**Mudança estrutural:** adicionada regra pra call sem nenhuma objeção do cliente — nota parte de um piso neutro de **70** em vez de ser penalizada por "ausência de evidência" como se fosse objeção malconduzida (resolve a lacuna identificada no baseline).
**Teste no caso de referência:** não houve objeção nenhuma na call → 50 (baseline, penalizado por ausência de evidência) → **70** (nova regra neutra, com a Análise declarando explicitamente que não houve objeção pra avaliar).

## D4 — Tradução Técnica → Negócio — ajustado em 12/08/2026
**Critérios:** personalização dos dados, consequência financeira em reais, continuidade.
**Teste no caso de referência:** 58 (baseline) → **52** — números reais do cliente existem (ticket médio, margem, fechamentos/mês) mas o achado central (falta de processo) nunca fecha em R$/mês perdido; a régua nova é mais estrita sobre "a maior parte fica qualitativa" cair no nível 50, não 55-69.

## D5 — Arquitetura de Urgência — ajustado em 12/08/2026
**Critérios:** custo da inação no presente, momentum, roadmap como âncora temporal.
**Teste no caso de referência:** 42 (baseline) → **38** — roadmap de 12 meses é cronograma administrativo, sazonalidade é estratégia de receita (não urgência), sem custo da inação hoje.

## D6 — Arquitetura de Conversão — ajustado em 12/08/2026
**Critérios:** solução como consequência, timing da proposta, posicionamento do preço.
**Mudança estrutural:** mesma lógica da D3 — adicionada regra pra call sem momento de proposta/preço (comum em Diagnósticos dentro de contrato em andamento). Nota parte de um piso neutro de **70**, ajustado só pelo critério aplicável (solução como consequência do diagnóstico, se houver recomendação técnica na call).
**Teste no caso de referência:** 45 (baseline, penalizado por falta de preço) → **72** (piso neutro 70 + a recomendação de CRM segue logicamente do diagnóstico de falta de processo, então soma um pouco acima do piso).

## D7 — Construção de Confiança — ajustado em 12/08/2026
**Critérios:** fonte da autoridade, consistência entre entregas, presença em tensão.
**Teste no caso de referência:** 68 (baseline) → **70** — autoridade via comparação agregada de outros projetos (não caso nomeável, mas também não é afirmação vazia), boa consistência com entregas anteriores, sem teste de tensão real na call. Bate na âncora dos 75 com uma leve puxada pra baixo pelo critério de autoridade agregada.

## D8 — Domínio do Negócio do Cliente — ajustado em 12/08/2026
**Critérios:** leitura do modelo, calibração ao setor, linguagem do cliente.
**Teste no caso de referência:** 74 (baseline) → **55** — maior queda entre as dimensões ajustadas hoje. A régua antiga dava crédito por "bom domínio geral"; a régua nova é mais estrita sobre jargão B2B genérico (MQL/SQL/ABM/Land&Expand/RevOps) explicado mas não traduzido pro vocabulário do setor de eventos do cliente — isso domina a maior parte da entrega, então cai no nível 50, não 70-84.

## Regras transversais da D9 — feedback e plano de ação, ajustadas em 12/08/2026
**O que mudou:**
- **Regra 2 (Feedback ao final):** virou 3 estados em vez de 2. Antes só checava "pediu feedback? sim/não". Agora: ✅ pediu feedback e o cliente validou a entrega (mesmo que simples, tipo "faz sentido"/"estamos no caminho certo"); ⚠️ pediu feedback mas a resposta foi hedged/adiada ("vamos ver nas próximas", "depois te falo") — sinal de que a entrega não gerou validação, mesmo sem crítica explícita; ❌ não pediu feedback nenhum. Também ficou explícito que o pedido precisa partir do consultor — comentário espontâneo do cliente sem ter sido solicitado não conta como ✅.
- **Regra 4 (Plano de ação):** passou a ser item explícito no checklist da D9 (igual à regra 2 e à regra 5), em vez de só um princípio narrativo. Mede separadamente da qualidade técnica das ações (que já é coberta pelos itens do apêndice, ex: "3.1 ações corretivas" na Vendas): ✅ terminou com plano de ação/encaminhamento prático executável; ⚠️ encaminhamento vago (sem responsável/prazo/próximo passo); ❌ terminou só no diagnóstico. Kickoff continua sendo a única exceção, sem esse item no checklist.

**Por quê:** a coordenadora pediu pra distinguir um cliente que valida a entrega de um cliente que só a recebe e adia o julgamento pra próxima ("vamos ver nas próximas") — isso não é uma reclamação explícita, mas também não é validação, e a régua antiga tratava os dois casos como ✅ igualmente. E o plano de ação, apesar de já coberto indiretamente pelos itens técnicos de cada tipo, não tinha um checkpoint estrutural separado (existir vs. ser bom), diferente do padrão já usado pra feedback e pessoas-chave.

**Teste no caso de referência:** ambos ✅ — Cleiton pede feedback explicitamente ("Vocês querem comentar alguma coisa?") e recebe validação real de Felipe, Guilherme e Sara (não hedged); fecha com 5 próximos passos nomeados e reforça "configurar o horizonte um e iniciar rotina de gestão". Não muda a nota da D9 deste caso (83), mas os 2 novos itens entram na lista de checkmarks — a % de cumprimento agora é sobre 17 itens em vez de 15 (ver nota abaixo).

**Nota sobre o cálculo:** com os 2 itens novos sempre presentes no checklist (exceto Kickoff pro item 4), a base de itens aplicáveis da D9 cresce em todos os tipos — reconferir a % de cumprimento na próxima avaliação real, não só nos casos de teste.

## Nota consolidada do caso de referência após todos os ajustes (D1-D8)
D1=60, D2=52, D3=70, D4=52, D5=38, D6=72, D7=70, D8=55, D9=83 (inalterado).
Consolidada = (60×7 + 52×7 + 70×7 + 52×14 + 38×14 + 72×7 + 70×7 + 55×7 + 83×30) ÷ 100
= (420+364+490+728+532+504+490+385+2490) ÷ 100 = 6403 ÷ 100 = **64,0** → ainda faixa Regular (55–69), praticamente igual ao baseline (64,6) — mas agora cada dimensão individual é mais defensável e diagnosticável, mesmo com o número consolidado quase igual.
