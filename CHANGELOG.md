# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Em `0.x`, mudanças que quebram compatibilidade sobem o **minor** — é o que impede
que `^0.x.y` as instale sozinho.

## [0.3.0] — 2026-07-28

Release sobre autoria de provider: escrever um provider próprio era possível na
teoria e impossível na prática, porque os tipos necessários não saíam do
`@thenajs/core` — e o projeto gerado pelo `thena create` não depende do
`@thenajs/agentflow`.

**Esta release é aditiva.** O `ToolCall` antigo continua funcionando por alias.

### Adicionado

- **`ProviderCredentials`** — os campos que todo provider aceita (`sampling`,
  `raw`, `rescueToolCalls`, `costPer1kTokens`). Estenda no seu tipo de
  credentials para que um campo novo na base chegue ao seu provider de graça.
- **`Providers.configure(credentials)`** — método protegido que absorve esses
  campos de uma vez, no lugar de quatro atribuições manuais que era fácil
  esquecer. `OllamaProvider` e `OpenAIProvider` passaram a usá-lo.
- **`ProviderToolCall`** — a chamada no formato do provider
  (`{ id, name, arguments, source }`), agora com nome próprio.
- Novos exports em `@thenajs/core`, todos necessários para escrever um provider
  sem dependência extra: os tipos `RawAssistant`, `ChatParams`,
  `ProviderCredentials`, `ProviderToolCall`, `NormalizedToolCall`; e os valores
  `parser`, `normalizeToolCallEnvelope`, `pruneUndefined`.
- Documentação: seção "Escrevendo um provider próprio" com exemplo completo e a
  tabela do contrato (o que a base garante × o que a subclasse devolve), no
  README e em `docs/concepts/providers.html`.

### Alterado

- **`Providers.embed()` passou de `protected` para `public`.** O método existia
  e funcionava nos dois providers, mas era inalcançável de fora — nenhum código
  do repositório o chamava. Agora dá para usar embeddings em user-land.
- O `ToolCall` do `@thenajs/agentflow` virou alias de `ProviderToolCall`. O nome
  colidia com o `ToolCall` dos hooks (`{ name, args }`), que tem formato
  diferente, e quem importava do `@thenajs/core` pegava o errado.

### Depreciado

- `ToolCall` (em `@thenajs/agentflow`) — use `ProviderToolCall`. O alias segue
  funcionando e será removido numa versão futura.

### Notas de migração

Nada é obrigatório. Dois pontos de atenção:

1. Se você tem uma subclasse de `Providers` que redeclara `embed` como
   `protected`, o TypeScript vai reclamar da visibilidade — troque para `public`.
2. Se você importa `ToolCall` do `@thenajs/agentflow`, continua compilando; para
   silenciar o aviso de depreciação, troque para `ProviderToolCall`.

## [0.2.0] — 2026-07-27

### Adicionado

- **Parâmetros de amostragem** (`SamplingParams`) nas credentials dos providers,
  com `raw` para chaves específicas do backend e override por agente em
  `@Agent({ sampling })`. Sem `sampling`, o body do request sai idêntico ao
  anterior.
- **`ToolOutput` / `isError`** — uma tool pode sinalizar falha sem lançar; o nó
  do report vira `status: "error"` e `tool_error_rate` deixa de exigir regex.
  A política de erro é configurável em `ThenaConfig.toolErrors`, com default
  `"throw"` (o comportamento anterior).
- **Exaustão do loop** — `onExhausted`, `ctx.loop`, helper `wasExhausted()` e
  `exhausted` no report: parar por `maxIterations` deixa de ser indistinguível
  de convergir.
- **`usage` dos providers** (tokens do Ollama e da OpenAI) e **`RunBudget`**:
  teto de tempo, chamadas, tokens e custo para a execução inteira, com modo
  `"stop"` ou `"throw"` e o consumo legível em `ctx.budget`.
- **`toolCallSource`** (`"native"` | `"rescued"`) — mede o quanto um modelo
  depende do resgate de tool call.

### Corrigido

- O resgate de tool call em texto só aceitava o envelope `{ name, arguments }`.
  Passou a reconhecer `{ name, parameters }`, `{ tool, args }`,
  `{ function: {…} }`, `<tool_call>…</tool_call>`, arrays e argumentos como
  string JSON — os formatos que modelos locais realmente emitem.
- A ordem dos extractors: o de regex é ganancioso (`{` até o último `}`) e
  corrompia respostas com dois blocos JSON; agora vem depois do balanceado.
- `maxIterations: 0` caía num guard de truthiness e valia como "ilimitado".
- O `until` do loop era avaliado antes do teto de iterações.
- O label de iterações no report contava nós filhos, o que dava
  `iterações × passos`.

## [0.1.2] — 2026-07-26

- `ctx.turn` e `untilAnswered` para condição de loop sem boilerplate.
