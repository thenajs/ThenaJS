# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Em `0.x`, mudanças que quebram compatibilidade sobem o **minor** — é o que impede
que `^0.x.y` as instale sozinho.

## [0.12.0] — não lançado

### ⚠️ Quebras

| O quê | O que fazer |
| --- | --- |
| `run({ input: { message } })` virou `run({ prompt })` | tire o embrulho: `app.run({ prompt: "…" })` |
| O tipo `WorkflowInput` foi **removido** do pacote | ninguém precisava dele; `WorkflowRunOptions` continua exportado |
| Um `input` sem `message` não é mais serializado como prompt | serialize você: `prompt: JSON.stringify(payload)` |
| `state.set()` e `state.append()` são tipados pela chave | `"tasks"`/`"memory"` só aceitam `string`, `"history"` só `Message` |

### `run({ prompt })` — o embrulho saiu

```ts
- await app.run({ input: { message: "Revise src/" } });
+ await app.run({ prompt: "Revise src/" });
```

O `input` era um saco aberto (`{ message?: string; [key: string]: unknown }`) que
ninguém abria. Nada no framework injetava aquele objeto — `@input()` é outra
coisa, os argumentos validados de uma **tool**. O único consumidor reduzia o
objeto a uma string antes de entrar no pipeline, e era só isso. Sobrava um
wrapper de uma chave, com nome que sugeria o par input/output de IO num método
que, por definição, só recebe entrada.

Junto foi o fallback de serialização: sem `message`, o objeto inteiro virava o
prompt em JSON. Era a única razão de o tipo ser aberto, e escondia um erro comum
— um campo com o nome errado não falhava, virava prompt. Quem quer mandar
estrutura para o modelo agora diz isso explicitamente.

Payload estruturado tem duas portas melhores, e a escolha entre elas é o que o
modelo pode ver: `data` para o que ele **não** deve ler, `state.memory` para o
que ele deve.

**Atenção ao nome:** `prompt` agora significa duas coisas, e a documentação
sempre diz qual. O `@Agent({ prompt })` é o markdown de sistema, fixo por classe;
o `run({ prompt })` é a fala do usuário, um por execução.

### O que chega ao modelo agora está em inglês

**Leia este item mesmo que nada no seu código mude** — é o único da lista que não
quebra compilação nem lança erro, e mesmo assim altera comportamento.

O framework injetava português no prompt e nas observações que o modelo lê:

```diff
- "Tarefas:\n"                                    → state.tasks no system
+ "Tasks:\n"
- "Tool 'x' não encontrada."                       → observação de tool
+ "Tool 'x' not found."
- "Argumentos inválidos para a tool 'x'"           → schema recusou os args
+ "Invalid arguments for tool 'x'"
- " (chamada resgatada do texto da resposta)"      → sufixo da chamada resgatada
+ " (call rescued from the response text)"
- "[…histórico anterior omitido…]"                 → nota do contextWindow
+ "[…previous history omitted to fit the window…]"
- "\n… [truncado]"                                 → corte por maxCharsPerTool
+ "\n… [truncated]"
```

Os prompts que o `thena create` e o `thena g agent` geram também passaram a ser
em inglês. Projetos já gerados não mudam — o markdown está no seu repositório.

Três efeitos que valem atenção:

- **O idioma da resposta pode mudar.** Se o seu agente respondia em português em
  parte porque o `system` dizia `Tarefas:`, ele agora vê `Tasks:`. Modelos
  pequenos são sensíveis a isso: o idioma do contexto puxa o da resposta. Se
  você quer resposta em português, diga isso no `.agent.md` — que é onde essa
  decisão sempre deveria ter morado, e não num literal do framework.
- **O cache de prefixo do provider é invalidado uma vez.** O `system` mudou, e
  ele é o prefixo estável que compra o desconto em tokens já vistos. A primeira
  chamada depois de atualizar paga preço cheio; da segunda em diante normaliza.
- **Parsing da saída pode parar de casar.** Se você procurava `"não encontrada"`
  num `afterTool`, num `until` ou em teste, troque pelo texto novo.

Ficaram em português, de propósito, as mensagens que **não** vão ao modelo: a
interface do CLI, os rótulos do report HTML, o logger e os erros de configuração
dirigidos a quem desenvolve.

### `StateManager` tipado pela chave

```ts
- set(key: keyof State, value: any)
- append(key: keyof State, value: any)
+ set<K extends keyof State>(key: K, value: State[K]): void
+ append<K extends keyof State>(key: K, value: State[K][number]): void
```

O tipo do valor não tinha nenhuma relação com a chave, então isto compilava:

```ts
ctx.state.append("tasks", { id: 1, texto: "x" });   // agora: erro de tipo
```

E o resultado era `[object Object]` na mensagem `system` — o modelo recebia lixo
e nada avisava. O erro só aparecia como comportamento estranho, longe da causa.

**Quebra em compilação, nunca em runtime.** Quem escreve JavaScript não vê
diferença. E quem for atingido quase certamente tinha um defeito: os três
padrões que deixaram de compilar (objeto em `tasks`, string solta em `memory`,
texto cru em `history`) já produziam prompt errado.

O padrão documentado de manter um ramo fora do transcript continua igual:

```ts
ctx.state.set("history", ctx.state.history.slice(0, -1));   // Message[] ✓
```

A mensagem de erro do `append` também ficou útil: prefixo `[thena]`, o nome do
método, a chave recebida e a causa provável — antes era `State is not an array.`

### `contextWindow({ notice })` — `warnIndexFailure` virou alias

Não é quebra: o nome antigo continua aceito e funcionando.

```ts
- contextWindow({ maxTurns: 12, warnIndexFailure: "…cortado…" })
+ contextWindow({ maxTurns: 12, notice: "…cortado…" })
```

`warnIndexFailure` é o tratador de falha ao gravar o índice do report, em
`observability/report.ts`. O nome chegou aqui por um rename automatizado que
atravessou arquivos e ficou exportado como API pública, descrevendo uma coisa e
significando outra — a nota que substitui o histórico cortado.

O alias fica marcado `@deprecated`. Quando os dois vierem, `notice` vence. A
remoção é uma versão futura, com entrada própria aqui.

### `@thenajs/core` declara o peer de `zod`

Correção de empacotamento. **Quem já usa `zod` 4 não sente nada** — não há
mudança de API nem de comportamento.

```diff
  "dependencies": { "@thenajs/agentflow": "^0.11.0" },
+ "peerDependencies": { "zod": "^4.0.0" }
```

O `core` exige `zod` na própria API pública — `@Tool({ schema })` é tipado como
`z.ZodType` — mas não o declarava em lugar nenhum do manifesto. Herdava o peer
do `agentflow` por transitividade, e era isso que deixava o npm resolver um
conflito **aninhando** em vez de reclamar.

O estrago, medido num projeto limpo com `zod` 3 já instalado:

```
node_modules/zod                            3.25.76   ← o do seu projeto
node_modules/@thenajs/core/node_modules/zod 4.4.3     ← instalado sem aviso
```

Você escrevia o schema com uma cópia e o framework o convertia com a outra. A
primeira chamada ao modelo morria assim, sem nada apontando para cá:

```
TypeError: Cannot read properties of undefined (reading 'def')
    at zod/v4/core/to-json-schema.js
```

Com o peer declarado, o npm deixa de aninhar: fica uma cópia só, e a instalação
avisa. Se a sua for a 3, o erro passa a ser `z.toJSONSchema is not a function` —
que nomeia o que falta (`toJSONSchema` chegou no `zod` 4) em vez de estourar
dentro do conversor.

O `README` também estava errado: dizia `npm i @thenajs/core`, sem o `zod`. Agora
diz `npm i @thenajs/core zod`. O `thena create` já gerava `zod: "^4.0.0"` no
projeto novo, e `docs/get-started/installation` já mandava instalar os dois — o
caminho quebrado era o de quem copiava a linha do README.

### `@thenajs/qdrant-client` depende do engine, não do core

```diff
- "dependencies": { "@thenajs/core": "^0.11.0" }
+ "dependencies": { "@thenajs/agentflow": "^0.11.0" }
```

`VectorStore` mora em `@thenajs/agentflow`; o `core` apenas o reexportava. Quem
instalava só o cliente Qdrant baixava junto decorators, DI, bootstrap, recorder e
report — nada disso usado.

A superfície pública do pacote é a mesma (`QdrantStore`, `QdrantCredentials`), e
`import { QdrantStore } from "@thenajs/qdrant-client"` não muda. O único jeito de
sentir é dependência fantasma: importar `@thenajs/core` sem tê-lo no seu
`package.json`, contando com o hoisting para achá-lo por baixo do Qdrant. Se for
o seu caso, declare o `core` como dependência direta — que é o que ele sempre
foi, para qualquer projeto que use os decorators.

Uma regra de arquitetura (`RULES.md` R-26) e um teste passam a impedir a volta:
nenhum satélite pode importar o `core`, nem declará-lo no manifesto.

---

## [0.11.0] — 2026-08-22

### `@tools()` — uma tool alcança as irmãs

Ponto de injeção novo, no mesmo padrão de `@input()`, `@context()` e `@state()`.
Ele entrega as **outras tools do mesmo agente, já embrulhadas** na cadeia de
middleware:

```ts
async execute(@input() args: Args, @tools() siblings: ToolType[]) { … }
```

"Já embrulhadas" é o ponto inteiro. Uma tool que despacha as irmãs por esta porta
mantém, **por chamada**, o nó no report, os hooks do agente, os middlewares de
`app.use({ tool })` — onde mora a autorização —, a contagem de orçamento e a
política de erro. Uma lista passada por fora perderia as cinco.

Só funciona no `execute`: no construtor a lista ainda não existe, porque as tools
são embrulhadas por invocação do passo. Usar no construtor dá erro dizendo isso.

### `@thenajs/tools` está de volta, com a `ParallelTool`

O pacote foi removido na `0.10.0` por dois motivos. O principal era
posicionamento: ele existia para publicar uma tool de shell, e entregar execução
de comando arbitrário ao modelo é decisão da aplicação, não do framework. Esse
motivo continua valendo — **a `ShellTool` não voltou e não volta**.

O que voltou é outra coisa:

```ts
import { ParallelTool } from "@thenajs/tools";

@Agent({ tools: [ReadFileTool, ListDirTool, ParallelTool], … })
export class ExplorerAgent {}
```

Ela empacota N chamadas num turno só. O provider honra uma tool call por turno,
então ler três arquivos custava três idas ao modelo; agora custa uma. O ganho é
**round-trip**, não CPU.

Não recebe tool nenhuma — o `@tools()` resolve isso. E é **opt-in**: basta não
registrá-la para o agente voltar ao comportamento anterior, que é o que se faz
com um modelo fraco demais para montar o lote.

Uma chamada que falha não derruba as outras, e o lote só é marcado como erro se
**tudo** falhar — senão o `maxFails` do loop contaria uma falha que não houve.

### Licença nos pacotes

Os seis `package.json` declaravam `"license": "MIT"`, mas **não existia arquivo de
licença em lugar nenhum** — nem na raiz, nem nos pacotes. O campo é uma
declaração SPDX; a licença exige que o aviso de copyright viaje em toda cópia, e
o npm só embala o `LICENSE` que estiver no diretório do pacote.

Agora são sete arquivos, e um teste em `architecture.test.ts` varre `packages/*`
exigindo `LICENSE` presente e `MIT` declarado — o próximo pacote não nasce sem.

Quem instalou a `0.10.0` recebeu tarball sem aviso; a `0.11.0` corrige.

### README

De 1.324 para 149 linhas, em inglês. O manual já vivia no site (71 páginas por
idioma) e o README o duplicava — agora ele é a primeira tela: o que é, o GIF do
quickstart, o teto de custo em código, por que existe, e os links.

O que era de repositório e não tinha destino — monorepo, scripts, publicação —
foi para o `CONTRIBUTING.md`.

---

## [0.10.0] — 2026-08-21

### ⚠️ Quebras

| O quê | O que fazer |
| --- | --- |
| O pacote `@thenajs/tools` foi **removido** | copie a tool que você usava das [Receitas de tools](https://thenajs.github.io/pt/techniques/tool-recipes) para `src/tools/` |
| `ThenaConfig.memory` virou `ThenaConfig.stores` | renomeie o campo; o array e o resto continuam iguais |
| O protocolo SSE do `@thenajs/flow` passou a inglês | nada a fazer se você só usa `thenaFlow()`; se você importa `FlowRun`/`FlowSnapshot`, veja a tabela abaixo |
| `parallel` passou a anexar na ordem de declaração | nada a fazer, a não ser que você dependesse da ordem de conclusão — que variava a cada execução |
| `ctx.output` depois de um `parallel` é o do último ramo **declarado** | se você lia `ctx.output` esperando um ramo específico, leia `ctx.state` |

O pacote tinha uma tool — a de shell — em 139 linhas. Um pacote publicado carrega
versionamento, CI e uma promessa de compatibilidade; para algo que o usuário
escreve em dez minutos, o custo não se paga. Pior, punha o nome do projeto por
trás da escolha de dar execução arbitrária de comando a um modelo, que é decisão
da aplicação e não do framework.

O `thena create` deixa de instalar o pacote, e o exemplo da documentação passa a
usar uma tool de ler arquivo.

### `parallel` virou determinístico

Um combinador cuja saída muda entre execuções idênticas não é uma limitação
aceitável: é contrato incompleto numa primitiva que o framework possui. Três
mudanças (ADR-022, ADR-023):

| | Antes | Agora |
| --- | --- | --- |
| Ordem no `history` | de conclusão — variava com a latência do modelo | de **declaração**, estável |
| `ctx.output` / `ctx.turn` | do ramo que terminasse por último | do último ramo **declarado** |
| Leitura do histórico | cada ramo lia o estado do momento | todos leem um snapshot do início do bloco |
| Ramo irmão após uma falha | seguia rodando e escrevendo | cancelado; o bloco inteiro é descartado |

O isolamento entre ramos era **acidental**: funcionava só porque todo ramo lia
antes do primeiro `await`. Um `beforePrompt` que consultasse um cache já fazia o
segundo ramo enxergar a resposta do primeiro. Agora é garantido.

```ts
@Workflow({ steps: [parallel([Seguranca, Performance, Estilo]), Resumidor] })
export class RevisaoWorkflow {}
```

O `Resumidor` passa a ver os três pareceres sempre na mesma ordem. Um prompt que
diga "o primeiro parecer é o de segurança" deixa de quebrar sozinho.

O que **não** mudou: `tasks`, `memory` e o `state` do `@Workflow` continuam
compartilhados entre os ramos — são o ponto de coleta, e o padrão recomendado
segue sendo cada agente escrever no seu próprio campo. O bloco também continua
concorrente: ordenar a anexação não serializa a execução.

### `contextWindow` não quebra mais o par de tool

O corte olhava para o índice e não para o par. Quando a fronteira caía entre um
`assistant` com `toolCalls` e o `tool` que respondia a ela, o que seguia para o
modelo era um `tool` órfão — e a OpenAI recusa isso com `400`, que o retry **não**
retenta por ser erro de contrato.

O middleware existe para evitar um 400 de janela estourada, e estava produzindo
um 400 de mensagem inválida. Agora o corte recua até a fronteira do par.

`maxTurns` passa a ser um **teto, não uma cota**: se o corte cair no meio de um
par, chega uma mensagem a menos. O `report` ganhou `windowOrphansDropped`,
separado de `windowTrimmed`, para "cortei pelo teto" e "cortei para salvar um
par" não parecerem a mesma coisa.

### O protocolo do Flow passou a inglês

O fio entre o `FlowServer` e o navegador falava português — `inicioEm`,
`duracaoMs`, `runAtual`, o status `"rodando"`, a rota `/api/eventos` e o evento
SSE `evento` — enquanto o resto do framework já tinha migrado. O mesmo conceito
viajava no mesmo JSON com dois nomes: a duração era `durationMs` no evento e
`duracaoMs` na run.

| Antes | Agora |
| --- | --- |
| `FlowRun.inicioEm` | `FlowRun.startedAt` |
| `FlowRun.fimEm` | `FlowRun.endedAt` |
| `FlowRun.duracaoMs` | `FlowRun.durationMs` |
| `FlowRun.status: "rodando"` | `FlowRun.status: "running"` |
| `FlowSnapshot.runAtual` | `FlowSnapshot.currentRunId` |
| `GET /api/eventos` | `GET /api/events` |
| evento SSE `evento` | evento SSE `event` |

O protocolo é **interno ao pacote** (ADR-021): servidor e interface são
publicados juntos, e a forma documentada de consumir o stream de fora é
`ThenaPlugin.onEvent`, que entrega o `ExecutionEvent` do core — esse não muda.
Quem só chama `thenaFlow()` não faz nada.

O `packages/flow/test/protocol.test.ts` passa a fixar rotas, nomes de evento e
formato de frame. Era a única fronteira de rede do repositório sem verificação:
`memory.test.ts` cobria o formato dos dados, e um rename de rota atravessava
lint, typecheck e suíte inteiros para só quebrar no navegador.

### Correções

- **O grafo do Flow não desenhava.** `graph.ts` chamava `nodes.has(...)` num
  array, o que lança `TypeError` na primeira aresta — ou seja, em qualquer
  execução com mais de um nó.
- **O nó customizado nunca era usado.** Os nós saíam com `type: "passo"` e o
  `App.tsx` registrava `{ step: StepNode }`; o React Flow caía no renderizador
  padrão.
- **O painel de detalhe nunca abria.** O `App.tsx` lia `?.dados` de um objeto
  que tem `data`.

Os três são resíduo do rename automático para inglês. Dois eram erro de tipo, e
passaram porque nada no repositório roda o typecheck da UI — o
`packages/flow/src/ui/tsconfig.json` existe e ninguém o executa.

- **O CI voltou a rodar.** O `format:check` reprovava em
  `packages/agentflow/test/stream.test.ts` e é a segunda etapa do workflow, então
  build, os dois typechecks e a suíte não chegavam a executar.
- **A publicação deixou de ter uma lista cravada.** O laço do `publish.yml`
  ainda iterava sobre `tools`, removido nesta versão; sob `bash -e` isso
  abortava a release depois de `agentflow` e `core` já terem ido ao npm, e a
  idempotência do laço não ajudava porque a falha acontecia antes da checagem.
  Agora a lista é a env `PACOTES` e um passo anterior a qualquer `npm publish`
  reprova se ela e `packages/` divergirem, nos dois sentidos.

### `ThenaConfig.memory` → `ThenaConfig.stores`

O campo guarda `VectorStoreCtor[]` — uma lista de **bancos**, não de memórias. O
nome antigo colidia com o `run({ memory })`, que é outra coisa: o contexto que o
modelo lê em todo turno da execução. Duas configs vizinhas, o mesmo nome,
sentidos diferentes.

Renomear o lado do banco custa uma linha para quem usa RAG e não toca no
`run({ memory })`, que é a API que todo mundo usa. `VectorMemory` e `@memory()`
ficam como estão: os métodos deles são `remember`, `recall` e `forget` — memória
de verdade.

O que sobra deixa de ser colisão e vira a distinção clássica: memória de trabalho
(`run({ memory })`, dura a execução) e memória de longo prazo (`@memory()`, a
vetorial).

### Documentação

Site reorganizado em inglês e português, com 70 páginas por idioma em nove
seções, e paridade entre os idiomas validada no CI. As URLs anteriores
(`/guias/*`, `/referencia/*`, `/comecar/*`, `/concepts/*`) passam a dar 404.

---

## [0.9.0] — 2026-08-07

Isolamento por execução, cancelamento, streaming, custo e configuração por
execução. É a release que torna o ThenaJS utilizável em processo de longa
duração: antes, o framework guardava três estados mutáveis no escopo de módulo,
e duas runs concorrentes se sobrescreviam — um servidor HTTP que chamasse
`app.run()` por request estava quebrado, e uma suíte de testes não tinha como
existir sem os testes se contaminarem.

Consolida o que ficou em três marcos de desenvolvimento (`0.7.0`, `0.8.0` e o
trabalho seguinte) e nunca chegou ao npm: quem instalou até aqui está na
`0.6.0`, então esta é a primeira release que vê tudo isso.

### ⚠️ Quebras desde a 0.6.0

São cinco. Nenhuma atinge quem tem `^0.6.0` no `package.json` — em `0.x` o
caret não sobe minor —, mas todas atingem quem instalar novo ou subir de versão
de propósito.

| O quê | O que fazer |
| --- | --- |
| `app.run()` **rejeita** em vez de engolir o erro | trate a rejeição; antes a falha sumia |
| `app.run()` devolve `RunHandle`, não `Promise` | `await` continua funcionando; `.then().catch()` encadeado não |
| O report vai para `<dir>/<runId>/`, não `<dir>/` | ajuste caminho em script/CI que lia `report/index.html` |
| O orçamento vale **dentro** das runs aninhadas | passe `budget` explícito ao `runtime.run()` se quiser teto próprio |
| A execução só é observada quando alguém observa | use `run({ observe: true })` se usa `onEvent`/`onToken` sem `report`, `log` nem plugin |

Continuam funcionando, como alias: `bootstrapWorkflow` (use `Thena.create`) e
`AgentContext` (use `Context`).

O `thena create` passa a gerar projeto CommonJS, no padrão do `nest new` — o que
muda só projeto novo. E o `engines` de todos os pacotes pede **Node ≥ 20.19**,
versão em que `require()` de ESM a partir de CommonJS entrou.

### Adicionado

- **O `ctx` de uma tool traz a execução, não só o passo.** O `@context()` —
  a porta documentada — entregava `state`, `output` e `turn`, e mais nada. Quem
  quisesse cancelar um `fetch`, correlacionar um log ou soltar um recurso
  precisava descobrir sozinho o `currentRun()`. Agora o mesmo objeto traz:

  ```ts
  @Tool({ name: "buscar", description: "…", schema })
  class BuscarTool {
    async execute(@input() args: { url: string }, @context() ctx: Context) {
      const conn = await pool.acquire();
      ctx.onDispose(() => conn.release());        // solta no fim da run

      const r = await fetch(args.url, { signal: ctx.signal });   // cancelável
      ctx.meta({ status: r.status });             // vai para o report e o Flow

      if (ctx.usage().costUsd > 5) ctx.stop();    // encerra com o que já tem
      return r.text();
    }
  }
  ```

  | | |
  | --- | --- |
  | `ctx.runId` | o mesmo id que aparece em todo `ExecutionEvent` |
  | `ctx.signal` | cancelamento da run — repasse ao seu `fetch` |
  | `ctx.usage()` | consumo acumulado da execução até aqui |
  | `ctx.abort(reason)` | cancela a execução inteira, de dentro |
  | `ctx.stop()` | encerra **graciosamente**: pula o resto, devolve o output atual, sem lançar |
  | `ctx.onDispose(fn)` | limpeza ao fim da run — sucesso, erro ou abort; ordem inversa, como um `defer` |
  | `ctx.meta(dados)` | telemetria no nó deste passo |

  **É aditivo**: nada do que o `ctx` já tinha mudou de lugar, e os hooks
  (`beforePrompt`, `beforeTool`, `afterTool`, `onError`) recebem o mesmo objeto
  enriquecido. O tipo `Context` é o nome preferido daqui em diante;
  `AgentContext` continua válido e é o mesmo tipo.

  Duas notas de ciclo de vida: `abort` e `stop` valem para a **execução
  inteira** — pedir de dentro de um sub-workflow encerra tudo, como já
  acontecia com o `signal`. Já o `onDispose` é de **cada run**: o fim de um
  sub-workflow não solta recurso que ainda pertence a quem o chamou.

- ⚠️ **`context` virou a porta única — como decorator e como função.** O mesmo
  símbolo serve às duas, e devolve o mesmo objeto:

  ```ts
  // como decorator, dentro de uma tool
  async execute(@input() args: Args, @context() ctx: Context) { … }

  // como função, de qualquer lugar da execução
  provider: () => new OpenAIProvider({ apiKey: minhaChave(context().data) }),
  ```

  **`currentRun()` deixou de ser exportado.** Ele nunca foi publicado (o npm
  está no 0.6.0), então nenhuma aplicação existente quebra; quem seguiu a branch
  troca `currentRun()` por `context()`.

  Dentro de um passo, `context()` devolve o ctx do passo — com `state` e `turn`.
  Fora dele — numa factory de provider, que roda na compilação do workflow —
  devolve o da execução, e ler `state` lança dizendo por que ainda não existe.
  O ciclo de vida vira mensagem de erro em vez de `undefined` silencioso.

  Duas consequências registradas em teste:

  - **`context()` sozinho não lança mais.** A resolução é preguiçosa, porque
    `@context()` é avaliado no load do módulo, fora de qualquer execução, e não
    pode explodir ali. A falha sai no primeiro acesso a um campo.
  - **`ctx.data` deixou de ser opcional.** Sempre existe (objeto vazio quando
    não informado), então o `?.` sumiu do acesso mais frequente da API.

- ⚠️ **O `thena create` passa a gerar um projeto CommonJS**, como o `nest new`.

  Em ESM nativo o Node não completa extensão, então todo import relativo tinha
  que apontar para o arquivo **de saída**: `from "./config.js"` dentro de um
  arquivo `.ts`. Em CommonJS a resolução completa sozinha:

  ```ts
  import { config } from "./config";   // era "./config.js"
  ```

  A troca cobra o `await` de topo, que não existe em CommonJS. O `main.ts`
  gerado embrulha a inicialização numa função — o mesmo `bootstrap()` do Nest:

  ```ts
  async function bootstrap() {
    const app = Thena.create(AssistantWorkflow, config);
    console.log(await app.run({ input: { message } }));
    await app.dispose();
  }

  bootstrap();
  ```

  Os pacotes `@thenajs/*` **continuam ESM** — muda só o projeto gerado. O Node
  moderno permite `require()` de ESM a partir de CommonJS, e é por isso que o
  `engines` subiu para **`>=20.19`**, versão em que esse suporte entrou.

  Projetos existentes não precisam mudar: ESM continua funcionando, com as
  extensões `.js` de sempre.


- ⚠️ **`app.run()` devolve um `RunHandle`**, de forma síncrona. Com `await`
  você pede o resultado; sem `await`, a execução:

  ```ts
  const texto = await app.run({ input });   // como antes

  const exec = app.run({ input });          // a execução
  exec.runId;                                // disponível já, antes do 1º turno
  exec.abort(razão);
  exec.onEvent((e) => sse(e));
  await exec.result;
  ```

  Uma `Promise` não expressa três usos reais: cancelar, observar, e **guardar**
  a execução para reencontrá-la — o padrão de responder `{ runId }` num POST e
  o cliente acompanhar por SSE. Quem assina depois do início recebe o que já
  passou (buffer de 500 eventos por run).

- **Streaming.** `exec.onToken(cb)` e `exec.textStream` entregam o texto à
  medida que o modelo o produz, em vez de esperar a resposta inteira.

  ```ts
  const exec = app.run({ input });
  for await (const pedaco of exec.textStream) process.stdout.write(pedaco);
  const texto = await exec.result;
  ```

  O caminho do token é `provider → ChatParams.onToken → RunContext → canal →
  RunHandle`, e nenhuma ponta conhece a outra. O canal é **separado** do de
  eventos de propósito: token não é um passo da execução — não tem início, fim,
  duração nem status —, e misturá-lo no `ExecutionEvent` poluiria o tipo e
  quebraria quem monta a árvore a partir dele. Quem assina atrasado recebe o
  texto que já saiu.

  Implementado no Ollama (NDJSON) e na OpenAI (SSE). O que **liga** o streaming
  é a presença do sink: sem ninguém ouvindo, o provider faz a requisição normal.
  Um provider de terceiro que ignore o `onToken` continua funcionando — só não
  transmite.

  Na OpenAI a parte delicada é a tool call, que chega **fragmentada**: o `name`
  num chunk e o `arguments` em vários, caractere a caractere. O que amarra os
  pedaços é o `index`, não a ordem de chegada — com duas tool calls no mesmo
  turno, concatenar por ordem misturaria os argumentos das duas.

- **Cancelamento.** `run({ signal })` e `exec.abort()` valem os dois; o que
  disparar primeiro vence. O signal viaja até o `fetch`, então abortar corta a
  geração **em andamento**, não só a próxima chamada. Runs aninhadas herdam.

  ```ts
  app.run({ input, signal: req.signal });                  // cliente desconectou
  app.run({ input, signal: AbortSignal.timeout(30_000) }); // timeout de graça
  ```

  Usa o erro **nativo** em vez de um tipo próprio, o que preserva `TimeoutError`
  × `AbortError` × a razão que você passar. Atenção: `signal.reason` é uma
  `DOMException`, que no Node **não** é `instanceof Error`.

  Cancelamento não passa pelo `onError` do agente: o hook existe para o agente
  se recuperar de falha, e "alguém mandou parar" não é falha.

- **`ThenaConfig.redact` — mascaramento de segredo, ligado por padrão.** O
  report grava a conversa inteira em disco; mensagem de erro é o lugar clássico
  de vazar credencial. Padrões de fábrica: `Bearer`, `Basic`, connection string
  com senha, `sk-`/`ghp_`/`xoxb-`/`AKIA`, JWT e campos nomeados (`api_key`,
  `password`, `senha`, `token`). `redact: false` desliga; uma função substitui
  o default, e `redactSecrets` é exportada para compor sem perder os de fábrica.

- **`report: { content: false }`** — mantém árvore, durações e telemetria,
  descartando o texto. Para quem trata dado pessoal: não existe regex para nome
  ou endereço.

- **`shellTool(options)`** com `timeoutMs` (default 30s), `cwd`, `maxChars` e
  `allow`. Com allowlist ligada, encadeamento (`;`, `&&`, `|`, `$(…)`, `>`) é
  recusado — sem isso a lista não valeria nada. A classe `ShellTool` continua,
  com os defaults seguros e um aviso no JSDoc.

- **Configuração por execução.** `@Agent({ provider })` passa a aceitar uma
  **factory chamada por run**, além de instância e classe:

  ```ts
  @Agent({
    provider: () => new OpenAIProvider({ apiKey: minhaChave(currentRun().data) }),
    prompt: "./a.agent.md",
  })
  ```

  Antes o provider era instanciado **sem argumentos**, com as credenciais fixas
  na subclasse: duas execuções batiam no mesmo endpoint com a mesma chave, sem
  como variar.

  `run({ data })` é o canal de dados da execução que **não passa pelo modelo** —
  a diferença para o `run({ memory })`, que é serializado na mensagem `system` e
  portanto lido pelo modelo e gravado no report. Disponível em
  `currentRun().data` e em `ctx.data`, e herdado pelas runs aninhadas.

  O framework **não interpreta** o `data` e não define campo nomeado nenhum
  dentro dele: as três formas do `provider` são o mecanismo de escopo, e o eixo
  — conta, ambiente, região, usuário — é do seu domínio.

  `currentRun()` passou a ser exportado.

  Os `VectorStore` continuam instanciados uma vez por app, sem resolução por
  execução; separá-los por algum critério fica em user-land.

- **`janelaDeContexto()`** — middleware que corta o histórico antes de enviá-lo.

  ```ts
  await app.use({ name: "janela", chat: janelaDeContexto({ maxTurnos: 12 }) });
  ```

  O `history` cresce sem teto e cada turno reenvia tudo: dez turnos custam mais
  de 30× o primeiro, e quando a janela do modelo estoura a falha chega como um
  `400` não-retentável, tarde e depois de pago.

  O bloco `system` do topo é intocável, e o corte deixa um aviso no lugar — um
  salto silencioso faria o modelo repetir trabalho já feito.

  **Não vem ligado**, diferente do `maxIterations` e do `maxFails`: aqueles só
  impedem desperdício, este **muda o comportamento do agente**. Um default
  trocaria uma falha ruidosa e cara por uma degradação muda.

- **`Usage.cachedTokens` e `TokenCost.cachedInput`** — quantos tokens do prompt
  vieram do cache do provider, e quanto eles custam. Na OpenAI o caching é
  automático; o que faltava era **medir**. Sem `cachedInput`, token cacheado é
  cobrado como entrada normal: erra para mais, nunca para menos.

- **`toJsonSchema` / `toFunctionTools`** no engine, para quem escreve provider.
- **`lerLinhas` / `lerSse`** no engine — leitura de resposta em stream, para
  quem escreve um provider com streaming. Resolvem o que é chato: um chunk da
  rede não respeita fronteira de linha nem de caractere UTF-8.


- **Middlewares em `ThenaPlugin`.** Além de observar com `onEvent`, um plugin
  agora **intercepta**: `tool` envolve cada execução de tool e `chat` cada
  chamada ao modelo, podendo medir, transformar ou curto-circuitar.

  ```ts
  await app.use({
    name: "cache",
    chat: async (inv, next) => {
      const guardado = cache.get(chave(inv.messages));
      if (guardado) {
        inv.meta({ cacheHit: true });   // aparece no report e no grafo do Flow
        return guardado;                 // o modelo não é chamado
      }
      const turno = await next();
      cache.set(chave(inv.messages), turno);
      return turno;
    },
  });
  ```

  A posição da camada é contrato: **abaixo** da observação do framework (senão o
  passo desaparece do report e do grafo) e **acima** da contabilidade (senão um
  cache que acerta soma tokens já pagos e fura o `maxCostUsd`). Extensão
  aditiva — plugins existentes seguem funcionando sem mudança.

  Com isso, cache, RBAC, rate limiting, redação de segredo e spans de
  OpenTelemetry deixam de exigir mudança no core.

- **Freios no `loop()`, ligados por padrão.** Com falha de tool virando
  observação, um agente preso não morre — ele repete, e cada volta custa uma
  chamada. Um loop sem teto gasta o cartão de quem usa o framework, então
  ilimitado deixou de ser o default:

  - **`maxFails` (default `5`)** — falhas de tool **consecutivas** que encerram
    o loop. Consecutivas, e não totais, porque o sinal de "preso" é a
    repetição: um agente que erra, corrige e avança tem total alto e
    consecutivas baixo, e não deve ser punido. Uma tool que funciona zera a
    contagem.
  - **`onFail(ctx, { consecutive, total, toolName, message })`** — chamado a
    **cada** falha, não só no corte, para dar tempo de alertar antes.
  - **`maxIterations` passou a ter default `10`.** Era `Infinity`.

  `Infinity` desliga qualquer um dos dois. Os defaults ficam no `loop()` do
  `@thenajs/core`; o `Pipeline.loop` do engine continua sendo a primitiva crua,
  sem teto.

- **`stoppedBy` no nó `loop` do report** — `"until"`, `"exhausted"`, `"fails"`
  ou `"budget"`. Um loop cortado por `maxFails` tem `exhausted: false`, então
  sem isso "convergiu" e "desistiu" ficariam indistinguíveis.

- **`FatalToolError`** — a tool declarando que a falha **não** é recuperável
  pelo modelo (bug no código, credencial expirada, banco fora). Ela atravessa o
  agente e encerra a run; o erro original vai em `cause`, fora do contexto do
  modelo e fora do report.

  ```ts
  throw new FatalToolError("banco indisponível", { cause: err });
  ```

- **`RunContext`** — todo o estado de uma execução (id, config, recorder,
  orçamento) passa por um `AsyncLocalStorage`, o mesmo mecanismo que o `budget`
  já usava. Com isso:
  - `app.run()` pode ser chamado de forma **concorrente**, inclusive dentro de
    um handler HTTP;
  - **vários apps** coexistem no mesmo processo, e o `dispose()` de um não
    afeta o outro;
  - testes rodam em paralelo sem interferência.
- **Overrides por execução** em `app.run({ ... })`: `report`, `log` e
  `toolErrors` sobrescrevem o `ThenaConfig` só naquela run.
- **`runId` em `ExecutionEvent`** — todo evento diz a qual execução pertence.
  Sem isso, um consumidor que recebe eventos de runs concorrentes não tinha como
  separá-los.
- **Suíte de testes (Vitest)**, rodando no CI. `npm test` executa contra o
  código-fonte, sem build. Inclui um `FakeProvider` para testar agentes sem
  falar com um modelo. `npm run test:types` faz o typecheck dos testes, que o
  `tsc -b` não cobria.

### Alterado

- **`app.dispose()` drena**: aborta as execuções em voo e espera elas soltarem
  antes de encerrar os plugins.
- **`z.toJSONSchema` é memoizada** por schema, num WeakMap. Rodava a cada
  requisição: com 10 tools e 20 turnos, 200 conversões onde bastavam 10.
- Ids dos nós do report viraram contador em vez de `randomUUID()` por nó. O
  `runId` segue UUID.
- `engines: { node: ">=20" }` declarado em todos os pacotes.


- ⚠️ **Falha de tool virou observação por padrão, e `toolErrors` deixou de
  existir.** Antes, um `throw` do `execute` derrubava a run a menos que você
  descobrisse o flag `toolErrors: "observe"`.

  O framework tinha três comportamentos para quatro falhas parecidas: tool
  inexistente já era observação **incondicionalmente**, `throw` no `execute`
  era configurável, e argumento fora do schema derrubava a run **mesmo com
  `"observe"`** — porque a validação rodava no provider, antes do `try/catch`
  que aplicava a política. Agora as quatro são observação:

  | Como a tool falha | Antes (`throw`, o default) | Agora |
  | --- | --- | --- |
  | `execute` lança | derrubava a run | observação |
  | `execute` devolve `isError` | observação | observação |
  | tool inexistente | observação | observação |
  | argumentos fora do schema | derrubava a run | observação |

  É o que o protocolo já modelava (`ToolOutput.isError`, `is_error` no
  `tool_result`) e o que faz um loop ReAct funcionar. Para a falha que o modelo
  não conserta, use `FatalToolError`. Para escolher o texto que ele lê, devolva
  `{ content, isError: true }` — que continua sendo o caminho preferível.

  **Migração:** remova `toolErrors` do seu `ThenaConfig`. Se você dependia do
  `"throw"` para falhar rápido, lance `FatalToolError` nas tools onde isso
  importa.

- ⚠️ **`app.run()` devolve `Promise<T>` e propaga o erro.** Antes ele engolia a
  exceção, imprimia a saída com `console.log` e marcava `process.exitCode = 1`.
  Uma biblioteca não deve escrever o output do usuário no stdout nem decidir o
  código de saída do processo — e, num handler HTTP, o erro engolido virava um
  `undefined` silencioso.

  ```ts
  // antes
  await app.run({ input });                 // imprimia sozinho

  // agora
  console.log(await app.run({ input }));    // quem imprime é a aplicação
  ```

- ⚠️ **O report grava em `report/<runId>/`.** O caminho era fixo, então duas
  execuções concorrentes sobrescreviam o report uma da outra. O
  `report/index.html` da raiz passa a ser o índice das runs.

- **`MemoriaDeRuns` (`@thenajs/flow`) atribui por `runId`.** Usava um cursor
  único com a fronteira inferida por `depth === 0` — o que funcionava com uma
  execução por vez e embaralhava duas.

### Corrigido

- **O erro do seu construtor de provider chega inteiro.** Para distinguir uma
  classe de uma factory, o framework tentava `new SeuProvider()` e tratava
  qualquer `TypeError` como "não dava para chamar com `new`". Só que o corpo do
  construtor rodava dentro desse `try` — então o `TypeError` mais comum que
  existe, o de uma variável de ambiente faltando, era confundido com o outro:

  ```
  antes:   Class constructor OpenAIProvider cannot be invoked without 'new'
  agora:   Cannot read properties of undefined (reading 'apiKey')
  ```

  O erro de verdade era descartado, e o que sobrava mandava você depurar
  semântica de `new` em vez de olhar o `.env`. Agora a distinção sai da cadeia de
  protótipo (`fn.prototype instanceof Providers`), sem executar nada para
  descobrir: o erro do construtor sobe intacto.

  Duas consequências: uma factory declarada como `function` (e não como arrow)
  **deixa de ser executada duas vezes** quando o provider dentro dela falha — o
  `catch` a chamava de novo, e todo efeito colateral acontecia em dobro, por
  passo de agente. E uma classe que não estende `Providers` passa a dizer isso,
  em vez de ser instanciada em silêncio e falhar mais adiante.

- **O report deixa de travar o event loop a cada run concluída.** O
  `<dir>/index.html` era regenerado do zero toda vez: `readdirSync` da pasta e
  `JSON.parse` de **todo** `report.json` histórico — árvores completas, com
  prompts e respostas — para extrair cinco escalares por run. Síncrono, e antes
  de a promise da run resolver, então toda requisição em voo do processo
  atravessava a barreira. Medido, com 5.000 runs de ~40 KB na pasta:

  ```
  antes:   632 ms de event loop travado por run concluída
  agora:   1,1 ms
  ```

  E era O(N²) ao longo da vida do processo: a run 5.000 lia 5.000 arquivos, a
  10.000 lia 10.000. Num servidor de longa duração isso só piorava.

  Agora a pasta de report ganha um **`runs.jsonl`** — um ledger append-only com
  uma linha por run. O caminho crítico é um append dessa linha; o índice é
  renderizado a partir do ledger, de forma assíncrona e coalescida (uma rajada
  de runs vira um render só). Nenhuma árvore é reaberta.

  Junto vieram três correções que caíram no mesmo lugar:

  - **runs concorrentes não se apagam mais do índice.** Era um
    read-modify-write sem coordenação — duas runs terminando juntas liam a
    pasta e escreviam `index.html`, last-writer-wins. O append de uma linha
    curta é atômico até entre processos;
  - **o índice não pode mais ser lido pela metade.** A escrita é em arquivo
    temporário e `rename`, em vez de um `writeFileSync` por cima do arquivo
    vivo;
  - **`format: "json"` entra no índice.** Ele só era atualizado no ramo de HTML,
    então uma run sem HTML nunca aparecia. Agora aparece, linkando o
    `report.json`.

  Uma pasta de report que já existe não perde histórico: na primeira run do
  formato novo ela é varrida uma vez para semear o ledger. Quem versiona ou
  limpa essa pasta agora tem o `runs.jsonl` para considerar — apagá-lo só custa
  uma nova varredura.

- **Cancelamento no último passo deixava de ser notado.** O `signal` é checado
  *entre* passos, então um `abort()` durante o passo final não tinha mais
  ninguém para percebê-lo e a run resolvia normalmente. Agora há uma checagem
  ao fim do workflow — cancelamento ignorado em silêncio é pior do que não ter
  cancelamento.

- ⚠️ **O orçamento de uma run vale dentro das runs aninhadas.** Um sub-workflow
  disparado por uma tool recebia um `BudgetTracker` **novo e vazio**, ou seja,
  ficava sem teto nenhum. Na prática `maxCostUsd`/`maxTokens`/`maxChatCalls`
  eram contornáveis por qualquer agente com uma tool que disparasse workflow, e
  o gasto de dentro não aparecia em lugar nenhum. Uma recursão (workflow → tool
  → o mesmo workflow) não tinha freio algum.

  Agora, sem `budget` próprio, a run aninhada **usa o tracker do pai**; com
  `budget` próprio, ganha um encadeado — conta nos dois, e corta quem estourar
  primeiro. O `mode` que decide entre parar e lançar é o de quem estourou.

  Junto vieram duas mudanças necessárias para o teto funcionar de fato:

  - a chamada ao modelo passa a ser contada **na ida**, e só o consumo
    (tokens/custo) na volta. Uma tool executa *dentro* de `provider.chat`, e
    contar só na volta deixava o contador em zero durante toda a descida de uma
    recursão;
  - `BudgetExceededError` e **cancelamento** deixam de virar observação de tool.
    Uma tool que dispara sub-workflow fazia o aviso de "acabou o orçamento" (ou
    o abort) voltar para o modelo **como texto**, e a run seguia.

  Se você dependia de um sub-workflow com orçamento ilimitado, passe um `budget`
  explícito para ele em `runtime.run(Fluxo, { budget })`.

- ⚠️ **A execução só é observada quando alguém observa.** O `RunHandle` era
  ligado ao recorder em toda run, o que mantinha o recorder sempre ativo: a
  árvore inteira construída, dois `ExecutionEvent` por passo alocados e
  bufferizados, e o provider recebendo um sink de token — logo pedindo resposta
  em **streaming** — mesmo sem ninguém ler nada. Medido: ~2,2× o tempo de CPU
  por run, e ~13 KB retidos por handle vivo.

  Agora a observação liga sozinha com `report`, `log` ou um plugin com
  `onEvent`. Sem nenhum deles, a run não constrói árvore, não emite evento e não
  transmite — o caminho de custo zero que a documentação promete.

  **Quem usa `exec.onEvent`/`eventStream`/`onToken`/`textStream` sem `report`,
  `log` nem plugin precisa pedir a observação:**

  ```ts
  const exec = app.run({ input, observe: true });
  for await (const e of exec.eventStream) sse(e);
  ```

  Um handle mudo avisa uma vez no console dizendo exatamente isso, em vez de
  ficar em silêncio.


- **`stripThinkTags` apagava a resposta inteira** quando o texto continha uma
  tag de prefixo parecido — `<thinker>`, `<thoughts>`, `<reasoningEngine>`. O
  padrão casava `<think` e tratava o resto como atributo; a segunda regex, que
  vai até o fim do texto, comia tudo. Sem erro, sem aviso: só resposta vazia.
- **`transport.ts` descartava o timeout** quando um `signal` vinha de fora
  (`init.signal ?? timeout`). Agora é `AbortSignal.any`.
- **Um abort era retentado** — `isRetryableByDefault` tratava qualquer erro sem
  status como transitório. Novo `isAbortError`.
- **O backoff não era cancelável**: um abort no meio esperava os 8s antes de
  perceber.
- **`zod` era `dependencies`** em `agentflow` e `tools`, em vez de
  `peerDependencies`. O usuário criava o schema com um zod e o framework
  chamava `z.toJSONSchema()` com outro.


- O `memory` do `ThenaConfig` era resolvido na **compilação** dos passos, que
  acontecia fora do escopo da execução. Com o `RunContext`, a compilação passou
  para dentro do escopo; fora dele, o runtime agora falha alto em vez de cair
  nos defaults em silêncio.
- O exemplo de `@Agent` no README omitia o campo obrigatório `prompt` e por isso
  não rodava.

### Removido

- `setRecorder` / `resetRecorder` / `recorder()` e `setRuntimeSettings` /
  `resetRuntimeSettings` / `settings()` — eram internos, nunca exportados pelo
  `@thenajs/core`. Idem `budget()` / `withBudget()`, absorvidos pelo
  `RunContext`, e `ReportRecorder.capturarConteudo()`, que existia só para
  mutar um recorder compartilhado depois do fato.

### Infraestrutura

- **367 testes** (eram 143), incluindo os módulos do engine que eram pura
  heurística sem verificação — os 5 parsers de JSON, a normalização de envelope
  de tool call e o retry.
- **Régua de performance**: 14 testes que medem contagem de round-trips, tokens
  enviados, estabilidade do prefixo do prompt e trabalho repetido. Protegem o
  que regride em silêncio.
- ESLint, Prettier e `.editorconfig`, rodando no CI.
- `README.md` em `@thenajs/core` e `@thenajs/agentflow`, mais `SECURITY.md` e
  `CONTRIBUTING.md`.

## [0.6.0] — 2026-08-04

Observabilidade ao vivo. O report já contava a história depois que ela acabava;
faltava ver enquanto acontece.

**Release aditiva** — nada do que existia mudou de forma.

### Adicionado

- **`@thenajs/flow`** — pacote novo. Sobe um site local que desenha a árvore da
  execução em tempo real, com ReactFlow: workflow, loops, agentes, chamadas ao
  modelo e tools aparecendo conforme acontecem. Clicar num nó abre o prompt
  enviado, a resposta, o I/O da tool, os tokens e o erro.

  ```ts
  const app = await bootstrapWorkflow(MeuWorkflow, { log: true });
  await app.use(thenaFlow());
  await app.run({ input: { message: "Olá" } });
  ```

  Escuta só em `127.0.0.1` e não persiste nada — é uma janela para o que está
  acontecendo agora, não um banco de traces. A interface já vem buildada no
  pacote; não há passo de build no seu projeto. Sem dependência de runtime: o
  transporte é SSE em cima do `node:http`.

- **`app.use(plugin)` e `app.dispose()`** — a interface `ThenaPlugin` abre o
  stream de execução para qualquer destino, não só para o Flow:

  ```ts
  export function meuPlugin(): ThenaPlugin {
      return {
          name: "meu-plugin",
          setup: () => conectar(),      // se lançar, o `use()` rejeita
          onEvent: (evento) => enviar(evento),
          dispose: () => fechar(),
      };
  }
  ```

  Vários plugins convivem e **nenhum toma o lugar do `log`** do config — antes
  havia um único ouvinte do stream, e quem chegasse por último deslocava o
  outro. Um plugin que lança no `onEvent` é isolado: nem a execução nem os
  outros plugins são afetados.

### Corrigido

- **Um segundo `app.run(...)` no mesmo app não era mais instrumentado.** O reset
  do recorder acontecia no `finally` do `run`, então da segunda execução em
  diante o `log` e o `report` ficavam mudos. O reset passou para o `dispose()`.

### Documentação

- Guia novo: [Ver a execução ao vivo](https://thenajs.github.io/guias/flow),
  com a interface do `ThenaPlugin` para quem quiser escrever o seu.

## [0.5.0] — 2026-07-30

Vem de feedback de uso real: *"achei muito complexo mexer no contexto dentro dos
agents"* e *"sinto uma carência de um arquivo de estado"*.

**Release aditiva**, com uma remoção anunciada (`datasets`, deprecado na 0.4.1).

### Adicionado

- **Estado do workflow.** Uma classe declara o formato e os valores iniciais; o
  framework instancia **uma por execução** e entrega a mesma instância a todos os
  passos. Substitui o padrão de `ctx.campo` solto com `as unknown as`, que era
  boilerplate documentado em vez de API.

  ```ts
  export class RevisaoState {
      aprovado = false;
      rodadas = 0;
  }

  @Workflow({ state: RevisaoState, steps: [ /* … */ ] })
  ```

- **Injeção por decorator de parâmetro** — `@input()`, `@context()`, `@state()` e
  `@memory(Store)`. Cada parâmetro diz o que quer, então a ordem deixa de ser
  contrato:

  ```ts
  // agente
  constructor(
      @state() private readonly s: RevisaoState,
      @memory(QdrantOpenAI) private readonly vetor: VectorMemory,
  ) {}

  // tool
  async execute(@input() args: { path: string }, @context() ctx: AgentContext) {}
  ```

  Resolve a fragilidade da injeção posicional: antes, alcançar o segundo store
  exigia um parâmetro morto, e reordenar o array trocava o comportamento sem erro
  de compilação — os parâmetros têm o mesmo tipo.

  Diferente de `reflect-metadata`, que lê os **tipos** dos parâmetros, aqui cada
  um se declara. Isso importa porque o esbuild (que o `tsx` usa em dev) não emite
  `design:paramtypes`, mas **emite** as chamadas dos decorators — verificado nos
  dois caminhos.

- **`until` recebe o estado** como segundo parâmetro:

  ```ts
  until: (ctx, s: RevisaoState) => s.aprovado
  ```

  Aditivo — `until: untilAnswered` e condições que só usam `ctx` seguem iguais.

### Alterado

- **`ToolClass` aceita `execute` com vários parâmetros.** A restrição da 0.4.1
  declarava um parâmetro só e bloquearia o `execute` decorado. Continua garantindo
  que o método **existe**, que é o erro que ela foi criada para pegar.
- `VectorMemory.store` passou a ser público, para o `@memory(Store)` identificar
  qual memória é qual.

### Removido

- **`VectorStoreCredentials.datasets`**, deprecado na 0.4.1. Não era usado desde
  então; pode sair da sua config sem mudar nada.

### Notas

Declarar `state` é opcional. Quem pede sem ter declarado recebe erro apontando a
causa — inclusive no `until`, cuja falta de estado é detectada **antes de rodar**
pela quantidade de parâmetros que ele declara. Sem essa checagem o estado chegaria
`undefined` e o erro sairia como um `TypeError` na primeira leitura de campo.

`@context()` **não funciona no construtor** de um agente — o contexto ainda não
existe quando a classe é construída. O runtime falha com mensagem explicando isso,
em vez de injetar `undefined` em silêncio. Use no `execute` de uma tool, ou receba
o `ctx` como parâmetro do hook.

## [0.4.1] — 2026-07-30

### Depreciado

- **`VectorStoreCredentials.datasets`** — o campo continua aceito, agora
  **ignorado**, e será removido na 0.5.0.

  Ele validava em runtime se o `dataset` passado em `remember`/`recall`/`forget`
  estava na lista declarada. Era rede de segurança opcional que não justificava o
  campo a mais na configuração: um dataset inexistente devolve zero resultados,
  como qualquer filtro que não casa.

  Pode remover da sua config sem mudar nada no comportamento. O `dataset` de cada
  chamada continua igual — é ele que particiona.

## [0.4.0] — 2026-07-29

Memória vetorial. O `embed()` virou público na 0.3.0 e devolvia o vetor, mas não
havia o outro lado — onde guardar e como buscar. Esta release fecha o par, no
mesmo modelo dos providers: um contrato abstrato que você pode implementar, mais
uma implementação pronta.

**Release aditiva.** Nada do que existia muda de comportamento.

### Adicionado

- **`@thenajs/qdrant-client`** (pacote novo) — cliente Qdrant nativo sobre a API
  REST, sem SDK. Requer **Qdrant ≥ 1.10** (o endpoint `/points/query` estreou nessa
  versão). Herda retry e timeout do transporte do framework.
- **`VectorStore`** — o contrato de um banco vetorial: `ensureCollection`,
  `upsert`, `search`, `remove`, `collectionExists`, `dropCollection`. Estenda para
  trazer o seu; tudo o que precisa sai do `@thenajs/core`.
- **`VectorMemory`** — junta o `embed()` de um provider com um store:
  `remember`, `rememberMany`, `recall`, `forget`. As dimensões da collection são
  **descobertas sozinhas** no primeiro `remember`, pelo tamanho do vetor.
- **`ThenaConfig.memory`** — o store é registrado **uma vez** para a aplicação, e
  todo agente que declarar `VectorMemory` no construtor recebe uma memória sobre
  ele. Uma conexão e um `ensureCollection` por run, independente de quantos
  agentes existem:

  ```ts
  export const config: ThenaConfig = { memory: [MeuQdrant] };

  @Agent({ provider: LocalOllama, prompt: "./a.agent.md" })
  export class MeuAgente {
      constructor(private readonly memory: VectorMemory) {}
  }
  ```

  Vários stores fazem sentido quando são incompatíveis entre si (tipicamente
  dimensões de embedding diferentes, que não cabem na mesma collection): basta
  acrescentar ao array. A ordem é a ordem dos parâmetros do construtor — e é
  contrato: reordenar troca qual store cada agente usa sem erro de compilação.

  Misturar dimensões num store só falha com mensagem clara, antes de gastar o
  embedding, em vez do erro cru do banco apontando o `upsert`.

  Os embeddings saem do `provider` de cada agente. A injeção é **posicional**,
  não por tipo: `reflect-metadata` foi evitado porque o esbuild (que o `tsx` usa
  no `npm start`) não emite `design:paramtypes`, então DI por tipo compilaria e
  quebraria em silêncio no dev. Agentes sem construtor ignoram o argumento extra;
  sem `memory` no config, o parâmetro chega `undefined`.
- **Datasets como partição.** `remember(texto, { dataset })` e
  `recall(query, { dataset })`, com `dataset` opcional (default `"default"`) e
  `dataset: null` para buscar em todos. São um campo do payload com índice
  dedicado, não collections separadas — que é a recomendação do Qdrant.
- **`HttpTransport`** — o `request()` com retry/timeout saiu de `Providers` para
  uma base compartilhada, que `Providers` e `VectorStore` estendem. Refactor puro:
  a superfície de `Providers` não mudou.
- Filtros no shape neutro (`where`, igualdade) com `rawFilter` de escape hatch,
  mesmo padrão de `sampling` + `raw` nos providers.

### Corrigido

- **`@Tool` não garantia o método `execute`.** O decorator era tipado como
  `ClassDecorator`, que aceita qualquer classe, então esquecer o `execute`
  compilava e só quebrava em runtime com um `TypeError` genérico — e, com
  `toolErrors: "observe"`, virava uma observação de erro comum no report,
  indistinguível de falha legítima. Agora o decorator é genérico
  (`Tool<T extends ToolClass>`), o erro aparece na declaração da classe, e há uma
  guarda em runtime para quem não passa pelo `tsc`.

### Notas para quem escreve provider próprio

Nada obrigatório. Se quiser, `this.configure()` continua igual — internamente ele
agora delega a parte de transporte para `configureTransport()`, herdado da base.

## [0.3.0] — 2026-07-28

Release sobre autoria de provider: escrever um provider próprio era possível na
teoria e impossível na prática, porque os tipos necessários não saíam do
`@thenajs/core` — e o projeto gerado pelo `thena create` não depende do
`@thenajs/agentflow`.

Traz também retry e timeout nas chamadas HTTP dos providers.

**Um único item muda comportamento por padrão: o retry** (ver abaixo). O resto é
aditivo — o `ToolCall` antigo continua funcionando por alias.

### Adicionado

- **Retry automático nas chamadas HTTP**, com política configurável em
  `ProviderCredentials.retry`: `maxAttempts`, `timeoutMs`, backoff exponencial
  com *full jitter* (`initialDelayMs`, `maxDelayMs`, `factor`), `Retry-After` do
  servidor respeitado, e os ganchos `isRetryable` e `onRetry`.
  - Vive na classe base, no método protegido `Providers.request()` — Ollama,
    OpenAI e qualquer provider de terceiro herdam trocando `fetch` por
    `this.request()`.
  - Retenta `408`, `425`, `429` e `5xx`, mais erro de rede e abort por timeout.
    **Nunca** os demais `4xx`: erro de contrato não melhora repetindo.
  - `timeoutMs` **não tem default**, de propósito — é o único parâmetro capaz de
    quebrar um setup que funcionava (abortar modelo local lento). Sem ele, uma
    requisição pendurada só falha no limite do runtime.
  - Quando houve retry, o nó `chat` do report registra `attempts`.
  - As tentativas **não** inflam `maxChatCalls` de um `RunBudget` (são uma
    chamada lógica só), mas as esperas contam no `maxDurationMs`.

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

- **O retry vem ligado por padrão.** Um `429` ou `503` que antes derrubava a run
  agora é reexecutado até 3 vezes. É a única mudança de comportamento automático
  desta release; `retry: false` nas credentials restaura o comportamento anterior.
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

Três pontos de atenção, nenhum obrigatório:

1. **Retry ligado.** Se o seu fluxo é sensível a custo ou latência, ou se você já
   trata `429`/`5xx` por fora, use `retry: false` — ou `maxAttempts` menor.
2. Se você tem uma subclasse de `Providers` que redeclara `embed` como
   `protected`, o TypeScript vai reclamar da visibilidade — troque para `public`.
3. Se você importa `ToolCall` do `@thenajs/agentflow`, continua compilando; para
   silenciar o aviso de depreciação, troque para `ProviderToolCall`.

Provider próprio: troque `fetch` por `this.request()` para herdar retry e
timeout. O método devolve `{ response, attempts }`.

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
