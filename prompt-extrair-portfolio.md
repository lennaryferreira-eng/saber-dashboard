# Prompt — Extração do Portfólio Oficial V4 para JSON

Cole o texto abaixo junto com as páginas do portfólio (PDFs, prints ou HTML).
Funciona em lote: quanto mais páginas de uma vez, melhor a consistência.

---

Você vai extrair um catálogo de produtos a partir de páginas do Portfólio de
Produtos e Serviços da V4. Sua saída é **exclusivamente um JSON válido** — sem
texto antes, sem texto depois, sem cercas de código.

## Como as páginas são estruturadas

Cada produto ocupa uma página com sete seções fixas, sempre nesta ordem:

1. Estrutura do Produto
2. Visão Geral
3. Aspectos Técnicos
4. Informações para Vender
5. Informações para Operar
6. Posições Alocadas
7. Materiais de Treinamentos

A seção "Estrutura do Produto" é um bloco de **duas colunas**. À esquerda vêm
`Título`, `Status` e `Duração`; à direita, `Categoria`, `Valor Base` e
`PMM Responsável`. Títulos longos quebram em duas ou mais linhas dentro da coluna
esquerda — junte os pedaços num único título antes de gravar.

## Esquema de saída

```json
{
  "extraido_em": "AAAA-MM-DD",
  "total": 0,
  "por_categoria": { "SABER": 0, "TER": 0, "EXECUTAR": 0, "POTENCIALIZAR": 0 },
  "produtos": [
    {
      "titulo": "string — exatamente como está na página, sem reescrever",
      "categoria": "SABER | TER | EXECUTAR | POTENCIALIZAR",
      "status": "string — ex: Disponível",
      "valor_base_brl": 0,
      "valor_base_texto": "string — como aparece, ex: R$ 20.286,05",
      "duracao": "string — ex: 5 Semanas",
      "pmm_responsavel": "string",
      "descricao": "string — a Descrição Completa da Visão Geral, na íntegra",
      "formato_de_entrega": "string",
      "escopo": ["string"],
      "entregaveis": ["string"],
      "posicoes_alocadas": ["string"],
      "para_vender": {
        "dores": ["string"],
        "gatilhos": ["string"],
        "diferenciais": ["string"],
        "objecoes": ["string"]
      },
      "fonte": "string — nome do arquivo ou identificação da página",
      "confianca": "alta | media | baixa"
    }
  ],
  "problemas": [
    { "fonte": "string", "o_que": "string — o que não deu pra ler e por quê" }
  ]
}
```

## Regras de extração

**Copie, não redija.** Todo valor textual sai da página palavra por palavra.
Não resuma a descrição, não melhore o título, não padronize nomenclatura. Se a
página escreve "Data Manegement", você escreve "Data Manegement".

**Campo ausente é `null`, nunca inventado.** Se a página não traz PMM
Responsável, o campo vai `null`. Listas sem conteúdo vão como `[]`. Nunca preencha
por analogia com outro produto parecido.

**`valor_base_brl` é número, não texto.** "R$ 20.286,05" vira `20286.05`. Mantenha
o original em `valor_base_texto`. Se o valor for "Sob consulta", variável, ou não
existir, use `null` no numérico e guarde o texto original.

**Categoria só pode ser um dos quatro valores.** Se a página trouxer algo fora
dessa lista, ou não trouxer categoria nenhuma, use `null`, marque
`"confianca": "baixa"` e registre a ocorrência em `problemas`.

**Marque o que você não tem certeza.** `confianca` é `alta` quando todos os campos
da Estrutura do Produto foram lidos sem ambiguidade; `media` quando algum campo
secundário ficou duvidoso; `baixa` quando título, categoria ou valor ficaram
incertos. Um produto com confiança baixa ainda entra no JSON — mas com o motivo
descrito em `problemas`.

**Um produto por página.** Se uma página listar variações (ex.: "Basic",
"Pro", "Advanced") como produtos independentes, com valor próprio, cada variação
vira um item. Se forem apenas níveis descritos dentro de um mesmo produto, é um
item só.

**Não deduplique entre páginas.** Se o mesmo título aparecer em dois arquivos,
gere os dois itens com suas respectivas `fonte`. A conferência de duplicidade é
feita depois, fora daqui.

**`total` e `por_categoria` têm que fechar** com o que está em `produtos`. Conte
antes de fechar a resposta; se não bater, corrija a contagem.

Não peça confirmação e não faça perguntas. Se algo estiver ilegível, registre em
`problemas` e siga com o resto.
