# Roadmap — o que falta

> Atualizado em 2026-08-07 (todas as sete fases concluídas).

## Onde estamos

Score de maturidade: **~89%** · Classificação: **(D) Framework Sênior** · Maturidade: **Beta**

Concluído (branch `feat/run-context`):

| | O quê |
| --- | --- |
| ✅ | `RunContext` via `AsyncLocalStorage` — execuções concorrentes isoladas |
| ✅ | `app.run()` propaga erro, não imprime, aceita overrides por execução |
| ✅ | `runId` em `ExecutionEvent`, report por run, atribuição correta no Flow |
| ✅ | Falha de tool virou observação; `toolErrors` eliminado; `FatalToolError` |
| ✅ | `maxFails` (consecutivas) e `maxIterations` com default; `stoppedBy` no report |
| ✅ | `runner.ts` (639 linhas, 5 responsabilidades) quebrado em `di/` + `runtime/` |
| ✅ | Cadeias de middleware de **tool** e **chat**; `ThenaPlugin.tool` / `.chat` |
| ✅ | 246 testes em CI (core + engine), com lint e typecheck próprios |
| ✅ | Mascaramento de segredo ligado por padrão; `ShellTool` com timeout e allowlist |
| ✅ | `RunHandle`: cancelamento, `runId` síncrono, stream de eventos, `dispose` drenando |
| ✅ | Régua de performance + `z.toJSONSchema` memoizada |
| ✅ | Streaming de token no Ollama e na OpenAI |
| ✅ | Janela de contexto, cache de prompt medido, config por execução — **367 testes** |

## Princípios que valeram até aqui

Foram testados na prática e devem continuar valendo:

1. **Teste antes de refatorar.** As Fases 0→3 provaram o valor: a única regressão
   real (o `resolveCallerFile` quebrando por causa de um rename) foi capturada
   por um teste escrito "por completude".
2. **Um refactor que exige editar teste não é refactor.** Se a asserção precisa
   mudar, o comportamento mudou — e aí é outra coisa, com outro nome.
3. **Teste pela API pública.** Teste de função interna quebra no primeiro
   movimento de arquivo e some com a rede justamente quando ela é necessária.
4. **Sem medição não existe número.** Vale para performance e para segurança.

---

## ~~Fase A~~ — Higiene e cobertura do engine ✅

**Concluída.** 246 testes (eram 143). CI roda lint, formatação, build, dois
typechecks e a suíte.

O que ela rendeu além do previsto:

- **Um bug real**, encontrado na primeira execução dos testes novos:
  `stripThinkTags` apagava a resposta inteira quando o texto tinha uma tag de
  prefixo parecido (`<thinker>`, `<thoughts>`, `<reasoningEngine>`). Sem erro,
  sem aviso — só uma resposta vazia.
- **Duas dívidas ficaram visíveis** como aviso do ESLint, com o motivo no
  config: `no-explicit-any` (24) e `no-unsafe-function-type` (19). A segunda
  merece tarefa própria — introduzir um `ClassLike` e trocar 19 assinaturas,
  várias públicas, porque hoje `Thena.create(() => {})` compila.
- **`SECURITY.md`** virou mais que canal de reporte: documenta o report gravando
  a conversa em disco, a `ShellTool` sem sandbox, a ausência de defesa contra
  prompt injection e o custo como superfície de risco.

<details>
<summary>Escopo original</summary>

**~1,5 dia · sem dependências · pode começar hoje**

O que um revisor externo checa antes de ler código, mais o maior buraco de
teste que sobrou.

| # | Item | Esforço |
| --- | --- | --- |
| A1 | `zod` de `dependencies` para `peerDependencies` em `agentflow` e `tools`; `engines: { node: ">=20" }` em todos os manifests | 10 min |
| A2 | ESLint + Prettier + `.editorconfig`, rodando no CI | ~2h |
| A3 | `README.md` em `@thenajs/core` e `@thenajs/agentflow`; `SECURITY.md`; `CONTRIBUTING.md` | ~3h |
| A4 | **Testes do engine**: `parsers.ts`, `tool-call.ts`, `retry.ts` | ~1 dia |
| A5 | README + CHANGELOG da seção de middlewares | ~2h |

**Por que A4 importa:** ~1.150 das 1.805 linhas do engine não têm teste direto,
e as três mais críticas são heurísticas puras — 5 estratégias de extração de
JSON, 6 chaves de nome + 5 de argumento + 4 de wrapper na normalização de
envelope, e backoff com jitter e `Retry-After`. São funções determinísticas:
os testes mais baratos e de maior retorno do repositório.

**O bug do `zod`:** o usuário cria o schema com o **zod dele**;
[openai.ts:63](packages/agentflow/src/providers/openai.ts#L63) chama
`z.toJSONSchema()` com o **zod do agentflow**. Duas instâncias na árvore quebram
em runtime, de forma difícil de diagnosticar.

**Aceite:** CI verde com lint; cobertura direta dos três módulos do engine.

</details>

---

## ~~Fase B~~ — Régua de performance ✅

**~1 dia · a infra de teste da Fase A já está pronta**

Hoje há 246 testes de correção e **zero** de performance. Sem número em CI,
qualquer melhoria é opinião — e as otimizações desta área regridem em silêncio:
ninguém quebra, a conta é que triplica.

### B1 — A régua primeiro

Escrever os testes **antes** das correções, para vê-los falhar:

```ts
it("não recomputa o JSON Schema entre turnos", …);
it("dez turnos enviam no máximo N tokens", …);        // pega a regressão quadrática
it("uma tool no turno = uma chamada ao modelo", …);
it("o prefixo do prompt é estável entre turnos", …);  // pega quebra de prompt cache
```

O `FakeProvider` já registra `chamadas`, `messages` e `tools` — dá para medir
round-trips e tokens sem tocar em rede.

### B2 — Os micros

| Onde | O quê |
| --- | --- |
| [openai.ts:63](packages/agentflow/src/providers/openai.ts#L63), [ollama.ts:54](packages/agentflow/src/providers/ollama.ts#L54) | `z.toJSONSchema` recomputado a cada chamada — memoizar na resolução da tool |
| [tool-step.ts](packages/core/src/runtime/tool-step.ts) | `compose()` montado a cada `execute` — hoistar para o build |
| [recorder.ts](packages/core/src/observability/recorder.ts) | `randomUUID()` por nó — contador basta para id local |
| `registrarChat` | `JSON.stringify(messages)` completo antes de truncar em 20 KB |

**Aceite:** os testes de B1 falham antes de B2 e passam depois.

---

## ~~Fase C~~ — `RunHandle`: cancelamento e endereçamento ✅

**~1,5 dia · depende de nada**

`app.run()` passa a devolver, de forma síncrona, um handle *thenable*:

```ts
const texto = await app.run({ input });   // resultado  (não muda para ninguém)
const exec = app.run({ input });          // execução: .abort(), .onEvent(), .runId
```

Escopo desta fase: `signal`, `abort()`, `runId` síncrono, `result`, `onEvent` /
`eventStream` com buffer para quem chega atrasado, e `dispose()` drenando as
runs em voo. O `onToken` fica para a Fase E.

**Três defeitos a corrigir junto:**

1. [transport.ts:60-67](packages/agentflow/src/http/transport.ts#L60-L67) —
   `init.signal ?? timeout` descarta o timeout em silêncio quando ambos existem.
   Vira `AbortSignal.any([...])`.
2. `isRetryableByDefault` trata qualquer erro sem status como transitório, então
   um abort seria **retentado**.
3. `sleep()` do backoff precisa ser abortável, senão um cancelamento espera os
   8s antes de perceber.

**Duas decisões pendentes** (registradas no design doc):
teto do buffer de eventos, e se `abort()` no meio de um loop lança ou para
graciosamente.

**Aceite:** abort antes da run → zero chamadas ao modelo; abort no meio → para na
próxima checagem; `AbortSignal.timeout` funciona; run aninhada herda o signal.

---

## ~~Fase D~~ — Segurança ✅

**~1 dia · depende de C (o middleware de redação usa a cadeia)**

### D1 — Redação de segredo (~meio dia)

Hoje [agent-step.ts](packages/core/src/runtime/agent-step.ts) captura
`JSON.stringify(messages)` inteiro e o `writeReport` grava em
`report/<runId>/report.json`. Sem filtro, sem allowlist, sem opção.

Vai para lá: o que o usuário digitou (PII), o que as tools devolveram, e —
desde que falha de tool virou observação — mensagens de erro cruas, que num
driver de banco costumam trazer connection string.

Com a cadeia de middleware isso deixou de exigir mudança no core:

```ts
await app.use({ name: "redact", chat: mascarar(/Bearer \S+|postgres:\/\/[^@]+@/g) });
```

Mas o **default** continua vazando. Escopo:

- hook `redact` no `ReportRecorder`, aplicado no `capture()`;
- padrões conhecidos mascarados de fábrica (`Bearer`, connection string, chave em query string);
- `captureContent` desligado por default quando `report` roda sem `log: "verbose"`.

### D2 — `ShellTool` (~meio dia)

[shell.tool.ts](packages/tools/src/shell.tool.ts) roda `exec()` irrestrito, sem
allowlist, sandbox, timeout ou `cwd` — e é publicado como pacote oficial sem
uma linha de aviso. Um agente que leia um README malicioso executa o que
mandarem. Mínimo: aviso agressivo no JSDoc e no README, `timeout`, e
allowlist opcional.

---

## ~~Fase E~~ — Streaming ✅

**~2,5 dias · depende de C**

O caminho do token, sem que nenhuma ponta conheça a outra:

```
provider (emite) → middleware de chat → recorder → RunHandle → usuário
```

| # | Item |
| --- | --- |
| E1 | `ChatParams.onToken?` + `chatStream()` no `Providers`; `stream: true` no Ollama e no OpenAI |
| E2 | Middleware de chat encaminhando os tokens ao recorder (que já distribui para N ouvintes) |
| E3 | `onToken` / `textStream` no `RunHandle` |

**Fica mais simples por causa do adiamento.** Com no máximo uma tool call por
turno, não há interleaving a resolver: transmite o texto, detecta a chamada,
para, executa, encerra o turno. Quando as tool calls paralelas entrarem, esta é
a parte que precisará voltar.

---

## ~~Fase F~~ — Custo ✅

**~3 dias · depende de B (a régua)**

### F1 — Prompt caching (~1 dia)

Anthropic e OpenAI cobram ~10% por token de prefixo já visto. O histórico de um
agente é exatamente isso: prefixo estável que cresce por append. Nenhum provider
marca cache hoje.

⚠️ Armadilha a documentar: um `beforePrompt` que reescreve o system a cada turno
**quebra o prefixo** e anula o cache inteiro. É o que o teste
"o prefixo do prompt é estável entre turnos" (B1) protege.

### F2 — Janela de contexto (~2 dias)

[state.ts:39](packages/agentflow/src/state/state.ts#L39) é `list.push` sem teto
e `toMessages()` devolve tudo, então o custo é **quadrático**: dez turnos não
custam 10× o primeiro, custam ~33×. Com `maxIterations: 10` de default, esse é
o caso comum.

Escopo: janela deslizante (system + N últimos turnos), truncamento de saída de
tool, sumarização do que foi cortado. A necessidade já aparece resolvida na mão
em [read-file.tool.ts:9](src/tools/read-file.tool.ts#L9) — quando cada autor de
tool reinventa o mesmo corte, é sinal de que falta no framework.

---

## ~~Fase G~~ — Configuração por execução ✅

**~2 dias · depende de C**

O provider é resolvido do decorator, e `new ProviderCtor()` é chamado **sem
argumentos** — com credenciais fixas na subclasse. `VectorStoreCtor` tem o mesmo
problema. Não há como injetar chave de secret manager, variar o modelo conforme
a execução, ou mockar provider no teste do usuário.

> **Escopo, não multi-tenancy.** O que a fase entrega é o mecanismo — resolver
> configuração dentro do escopo da run. Multi-tenancy é *uma* aplicação dele,
> ao lado de dev/prod, região e usuário. O framework não nomeia nenhuma: ver
> "Sobre conceitos de domínio", no fim deste documento.

Escopo:

- `@Agent({ provider })` aceitando factory além de classe/instância;
- `VectorStoreCtor` aceitando credenciais;
- `run({ context })` — um canal de dados de execução que **não** passe pelo
  modelo (hoje `run({ memory })` é serializado direto no system prompt);
- expor o contexto da execução (hoje `context()`).

**Nota:** a Fase 1 do `RunContext` encurtou muito este caminho — a compilação
dos passos agora acontece dentro do escopo da execução, então um provider
construído por factory já consegue ler o contexto da run.

---

## Adiado, com motivo

| Item | Por quê |
| --- | --- |
| **Tool calls paralelas** | Decisão do time. Cabe na estrutura atual (a costura de middleware existe), mas exige tirar a execução de tool do provider. Maior ganho isolado de custo e latência quando for a hora. |
| **Ordem e isolamento no `parallel`** | Ver a seção abaixo — a descrição anterior ("corrida de dados", fork/merge, 2 dias) estava **errada**, e a medição corrigiu. |
| **`WorkflowStep` aberto** | União fechada + `if/else` em `compileStep`. Adicionar `branch`/`race` exige editar o core. Violação de OCP que sobrevive ao refactor. |
| **Decorators TC39** | Decorator de parâmetro **não existe** no padrão. Toda a DI de `@input`/`@state`/`@context`/`@memory` depende de um recurso legado sem caminho de migração. Maior risco de longo prazo; precisa de um plano B (API funcional `defineAgent({...})`) antes de virar urgência. |
| **Tradução para inglês** | API, comentários e docs em português limitam a adoção. Trabalho grande e mecânico; melhor depois que a API parar de mudar. |
| **`ClassLike` no lugar de `Function`** | 19 assinaturas, várias públicas (`runWorkflow`, `Thena.create`, `getAgentMetadata`). Hoje `Thena.create(() => {})` compila. Visível como aviso do ESLint desde a Fase A. |

---

## Sequência sugerida e projeção

| Ordem | Fase | Esforço | Score projetado |
| --- | --- | --- | --- |
| ~~1~~ | ~~**A** — higiene + engine testado~~ | ✅ feito | **~75%** |
| ~~2~~ | ~~**B** — régua + micros~~ | ✅ feito | |
| ~~3~~ | ~~**C** — RunHandle e cancelamento~~ | ✅ feito | |
| ~~4~~ | ~~**D** — segurança~~ | ✅ feito | **~82%** |
| ~~5~~ | ~~**E** — streaming~~ | ✅ feito | |
| ~~6~~ | ~~**F** — custo~~ | ✅ feito | |
| ~~7~~ | ~~**G** — configuração por execução~~ | ✅ feito | **~89%** |

**As sete fases foram entregues.** O que ficou de fora está na tabela abaixo,
com o motivo — e agora ela é o roadmap.

O que move mais daqui em diante, em ordem de impacto:

1. **Tool calls paralelas** (~3 dias) — maior ganho isolado de custo e latência.
   Ler 5 arquivos são 5 round-trips hoje; seriam 1. Exige tirar a execução de
   tool do provider, e a cadeia de middleware já é a costura.
2. **Ordem e isolamento no `parallel`** (~4 horas) — ver abaixo.
3. **Escopo de execução para os stores vetoriais** (~1 dia) — o que faltou da
   Fase G. Hoje `config.memory` só aceita classe, resolvida **uma vez** no
   bootstrap; o `provider` já aceita as três formas (instância, classe,
   factory). Aplicar a mesma tríade ao `memory` fecha a assimetria — e quem
   decide o eixo (conta, ambiente, usuário) continua sendo quem usa. Cuidado
   com a contrapartida: factory por execução joga fora o "uma conexão e um
   `ensureCollection` por store", então provavelmente precisa de memoização
   por chave fornecida pelo usuário.
4. **`ClassLike` no lugar de `Function`** (~1 dia) — 19 assinaturas; hoje
   `Thena.create(() => {})` compila.
5. **Decorators TC39** — o maior risco de longo prazo, sem urgência imediata.

---

## `parallel`: o que medimos

A descrição anterior deste item dizia "corrida de dados" e estimava 2 dias de
fork/merge. **Estava errada.** A medição mostrou outra coisa.

Três agentes em `parallel` (40ms, 20ms, 5ms) mais um depois:

```
lento  => "pergunta"                              ← não viu os irmãos
medio  => "pergunta"                              ← não viu os irmãos
rapido => "pergunta"                              ← não viu os irmãos
DEPOIS => "pergunta | RAPIDO | MEDIO | LENTO"     ← viu os três
```

O padrão fan-out → coleta **funciona**: cada ramo dispara isolado, e o agente
seguinte enxerga os três. O isolamento se sustenta porque o `map` invoca todos
sincronamente, cada um roda até o `await` do `provider.chat`, e o
`toMessages()` acontece antes desse await enquanto o `append` acontece depois —
todas as leituras precedem todas as escritas.

Sobram dois problemas, e são menores do que "corrida de dados":

**1. A ordem é a de conclusão, não a de declaração.** Declarar
`[lento, medio, rapido]` produz `RAPIDO | MEDIO | LENTO`, e isso muda a cada
execução conforme a latência do modelo. Um prompt que diga "o primeiro parecer
é do especialista em segurança" quebra sem aviso.

**2. O isolamento é acidental, não garantido.** Basta um ramo esperar antes de
ler o estado. Medido com um `beforePrompt` que espera 15ms:

```
A viu => "pergunta"
B viu => "pergunta | RESPOSTA-DE-A"    ← contaminado
```

Um `beforePrompt` que consulta um banco, um cache que responde na hora, ou uma
diferença de latência suficiente entre providers reproduzem isso. Nada no
código impede nem documenta.

### O conserto (~4 horas)

Não precisa de fork/merge de estado. Precisa de duas coisas:

1. **Congelar a leitura** — tirar um snapshot do `history` no início do bloco e
   dar o mesmo a todos os ramos. Elimina o problema 2.
2. **Anexar em ordem de declaração** — coletar o resultado de cada ramo e fazer
   o `append` ao final, na ordem do array, em vez de cada um escrever quando
   termina. Elimina o problema 1.

`ctx.output` e `ctx.turn` continuariam last-writer-wins, ou passariam a ser o do
último ramo declarado — decisão de API, não de implementação.

A ordem não é por tamanho: **A e B primeiro porque criam a régua**. Sem
cobertura do engine e sem teste de performance, as fases E e F são impossíveis
de defender — e F em particular é o tipo de otimização que regride sem quebrar
nada.

---

## Sobre conceitos de domínio

Uma regra de projeto, para as decisões seguintes não precisarem ser
redebatidas:

> **O framework pode nomear o que ele possui. Não pode nomear o que a aplicação
> possui.**

`runId`, `budget`, `signal`, `recorder`, a profundidade de aninhamento — o
framework os cria, os incrementa e age sobre eles. Ninguém inventaria
"profundidade de aninhamento" se o framework não aninhasse.

`tenant`, `usuário`, `sessão`, `organização`, `ambiente` — a aplicação tem esses
conceitos **com ou sem** ThenaJS. Nomeá-los num tipo público os transformaria em
contrato, e o framework passaria a ter que responder o que faz com eles no
report, no cache e na coleção vetorial. Cada resposta seria uma opinião sobre o
domínio de outra pessoa.

O teste, quando houver dúvida: *existe alguém construindo sobre isto que não
teria esse conceito?* Para `tenantId`, sim — a maioria. Para `runId`, não.

**O que o framework oferece no lugar** é o mecanismo:

| Mecanismo | O que o framework garante | O que fica com você |
| --- | --- | --- |
| `run({ data })` | transporta, propaga para runs aninhadas, mantém fora do modelo | o que tem dentro |
| `provider: instância \| classe \| factory` | quando cada forma é resolvida | o eixo do escopo |
| `context()` / `@context()` | o contexto certo, em qualquer profundidade | como interpretá-lo |

**Onde a opinião é bem-vinda:** na documentação. Uma página de receita
mostrando como montar multi-tenancy sobre esses mecanismos é útil e deve
existir — desde que fique claro que ela descreve **uma composição possível**, e
não uma feature do framework. É a separação entre referência de API e guia.
