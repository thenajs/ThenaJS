# Branding e voz do ThenaJS

Como o ThenaJS se apresenta — nome, posicionamento, voz, cor, vocabulário — e
como a documentação é escrita.

Documento interno, em português. Tudo que é **artefato público** (tagline,
descrição de pacote, título de página, mensagem de CLI) aparece aqui já em
inglês, que é a língua da superfície do projeto.

---

## 1. O nome já conta a história — e ninguém a contou

**Thena** vem de **Athena**. E a escolha é melhor do que parece à primeira
vista, porque Atena não é a deusa da guerra — essa é Ares.

Atena é a deusa da **guerra estratégica**, da **sabedoria** e do **ofício**
(_techne_). Ela é a que planeja antes de agir, a que empresta ferramentas ao
herói, a conselheira que aparece quando Odisseu está prestes a fazer besteira.
Ares é força bruta; Atena é força **governada**.

Isso descreve exatamente o que este framework faz, e o que ele **não** faz:

| Atena | ThenaJS |
| --- | --- |
| Planeja antes de agir | `@Workflow` — os passos são declarados, não improvisados |
| Empresta ferramentas ao herói | `@Tool` — o modelo age através do que você dá a ele |
| Sabe quando parar | `budget`, `maxIterations`, `maxFails`, `ctx.stop()` |
| Conselheira, não executora | O framework não deixa seu agente mais inteligente. Deixa-o **governado** |

O logo já é ela: elmo alado, perfil, `#FE374C`. Está no repositório desde o
começo e nunca foi explicada em lugar nenhum. **Essa é a maior oportunidade de
marca desperdiçada hoje** — é uma metáfora que se sustenta técnica e
narrativamente, de graça.

> **Regra:** a metáfora aparece no **posicionamento e na narrativa**, nunca nos
> identificadores. Não existe `AthenaContext` nem `spear`. O código continua
> literal — `run`, `step`, `budget`. Marca é como você fala do produto, não
> como você nomeia variável.

---

## 2. Posicionamento

### O que está errado hoje

> "A lógica no `.ts`, o prompt no `.md`. O framework une os dois."

É verdade, é bonito, e é a **menor** coisa que o framework faz. Descreve uma
convenção de organização de arquivo — não uma promessa. Depois da `0.9.0` o
diferencial real é outro: isolamento por execução, orçamento, cancelamento e
observabilidade. É o único framework de agente em TypeScript que assume que
você vai rodar isso **num processo que não morre no fim da requisição**.

### O posicionamento proposto

**Categoria:** TypeScript framework for LLM agents.

**A promessa em uma linha:**

> **Agents that hold up in production.**

**A expansão (hero do site, README):**

> Declare your agent as a class, its prompt as markdown. ThenaJS runs it with
> per-run isolation, budgets, cancellation and a full execution report — so the
> same code survives one script and a thousand concurrent requests.

**Descrições de pacote** (npm, hoje em português):

| Pacote | Descrição |
| --- | --- |
| `@thenajs/core` | Declarative TypeScript agents: `@Agent`, `@Workflow`, `@Tool`, with per-run isolation, budgets and cancellation. |
| `@thenajs/agentflow` | Execution engine behind ThenaJS: pipeline, providers, state and tools. |
| `@thenajs/cli` | Scaffold ThenaJS projects and generate agents. |
| `@thenajs/flow` | Watch a ThenaJS run unfold — live execution graph in your browser. |
| `@thenajs/tools` | Ready-made tools for ThenaJS agents. |
| `@thenajs/qdrant-client` | Qdrant vector store for ThenaJS, over the REST API — no SDK. |

### O que NÃO dizemos

Sem "blazing fast", sem "production-ready" como adjetivo solto, sem
"revolutionary", sem comparação com concorrente pelo nome. Se é rápido,
mostramos o número; se é seguro, dizemos contra o quê.

---

## 3. Voz

O projeto **já tem** uma voz, e ela é o ativo mais subestimado aqui. Está nos
comentários de código e no CHANGELOG, e é incomum: explica o **porquê**, admite
o custo, e traz número medido em vez de adjetivo.

Exemplo, do `budget.ts` — nenhuma linha disso é marketing, e todas vendem o
framework melhor que uma landing page:

> A parada é checada **entre** unidades de trabalho (…) Na prática o teto é uma
> barreira, não um corte no meio da frase: a run pode gastar mais uma chamada
> além do limite antes de parar. É limite superior conhecido e constante, não
> vazamento proporcional.

### As cinco regras

1. **Comece pelo problema, não pelo conceito.** "Your agent can talk, but it
   can't do anything" antes de "Tools are classes decorated with `@Tool`".
2. **Mostre o número.** "~2.2× CPU per run" vale mais que "significantly
   faster". Se não mediu, não afirme.
3. **Diga o custo.** Toda escolha tem contrapartida; a documentação que esconde
   isso é descoberta em produção.
4. **Uma ideia por parágrafo.** Frases curtas. Sem "simplesmente", "apenas",
   "basta" — se fosse simples, não precisaria de documentação.
5. **Segunda pessoa, presente.** "You declare", não "one may declare".

### Tom por superfície

| Superfície | Tom |
| --- | --- |
| Site / README | Direto, orientado a problema. Zero hype. |
| Mensagem de erro | Diz **o que fazer**, não só o que houve. Prefixo `[thena]`. |
| CLI | Curto, com o próximo passo explícito. |
| CHANGELOG | Já está certo. Manter. |
| Comentário de código | Português, explicando o porquê. Já está certo. |

---

## 4. Cor

### O problema

Hoje existem **três identidades** que ninguém reconheceria como o mesmo produto:

| Onde | Cor |
| --- | --- |
| Logo | `#FE374C` carmesim |
| `theme-color` do site | `#5B8DEF` azul |
| Acentos do Flow | `#60A5FA` azul, `#A78BFA` roxo |

### A paleta

O carmesim do logo é a única cor com equidade construída. Ele manda.

```
Marca
  Crimson       #FE374C   ação, links, destaque, o herói
  Crimson dark  #D92A3E   hover, texto sobre claro

Superfície  (já é a do Flow — só passa a ser oficial)
  Ink          #0B0F17    fundo
  Surface      #111726    cartão, bloco de código
  Line         #172033    borda
  Muted        #8B98AD    texto secundário
  Text         #E5E7EB    texto

Semântica  (nunca carmesim — erro e marca não podem ser a mesma cor)
  Success      #34D399
  Warning      #FBBF24
  Error        #F87171    vermelho suave, distinto do carmesim
  Info         #60A5FA
```

**A regra que resolve o conflito:** carmesim é **ação**; `#F87171` é **erro**.
Nunca use carmesim para estado negativo, nunca use o vermelho de erro num botão.

**Ação imediata:** trocar `theme-color` de `#5B8DEF` para `#FE374C`.

### Tipografia

- Interface e texto: **Inter**
- Código: **JetBrains Mono** (a distinção `0/O` e `1/l/I` importa em nome de
  variável)

---

## 5. Léxico

Uma palavra por conceito, em todo lugar — código, docs, erro, CLI.

| Use | Nunca | Por quê |
| --- | --- | --- |
| **run** | execution, invocation | Uma execução do começo ao fim. `runId`, `RunContext`, `run()`. |
| **step** | stage, phase | Uma unidade dentro da run: agent, tool, chat, loop, parallel. |
| **agent** | bot, assistant, AI | Uma classe com prompt e tools. |
| **tool** | function, action, skill | O que o modelo pode acionar. |
| **workflow** | chain, flow, graph | A sequência declarada de steps. |
| **provider** | model, LLM, backend | Quem fala com o modelo. |
| **budget** | limit, quota | O teto de uma run. |
| **context** | ctx (na prosa) | O que a execução carrega. Na prosa: "the context". No código: `ctx`. |

Nota: `ExecutionEvent` / `ExecutionNode` ainda usam "execution" onde o léxico
pede "step" — são os nós da árvore, não a run. Renomear para `StepEvent` /
`StepNode` está no ROADMAP e alinharia o vocabulário de vez.

---

## 6. Documentação: da referência para a jornada

### O diagnóstico

A documentação de hoje é organizada por **conceito** — Tools, Providers,
Workflows, Hooks, Memória, Report, Flow, Orçamento. Está correta e é útil para
quem já sabe o que procura.

Mas ela responde "o que é X" antes de o leitor ter perguntado. Quem chega novo
não sabe que precisa de um `loop`, então nunca clica em "Decidir quando o loop
para".

### A estrutura proposta

Duas trilhas, dois leitores:

```
BUILD  — "quero construir algo"        CONCEPTS — "quero entender como funciona"
  narrativa, uma jornada só              referência, entrada direta
```

**A jornada.** Cada passo nasce de um problema que o passo anterior criou:

```
 1. Your first agent           → @Agent, prompt em .md
      "it answers, but it can't do anything"
 2. Give it tools              → @Tool
      "the tool failed and everything stopped"
 3. When a tool fails          → falha vira observação (ReAct)
      "one agent isn't enough"
 4. Orchestrate agents         → @Workflow, steps
      "it needs to try until it gets there"
 5. Repeat until done          → loop, until
      "these two don't depend on each other"
 6. Run steps in parallel      → parallel
      "it's been going in circles for ten turns"
 7. Stop the runaway           → maxIterations, maxFails
      "this is costing real money"
 8. Put a ceiling on it        → budget
      "what actually happened in there?"
 9. See what happened          → report
      "I want to watch it live"
10. Watch it run               → log, Flow
      "the client disconnected and it's still burning tokens"
11. Cancel a run               → RunHandle, abort, signal
      "I want to show the text as it arrives"
12. Stream the answer          → onToken, textStream
      "each customer needs their own key and model"
13. Configure per run          → provider factory, run({ data })
      "my tool needs to know which run it's in"
14. Reach the run from a tool  → @context(), ctx.signal, ctx.stop()
      "I need to log/cache/authorize everything"
15. Intercept the flow         → middleware, plugins
      "it forgets everything between runs"
16. Give it memory             → vector memory
      "now put it behind an HTTP server"
17. Go to production           → concorrência, isolamento, o que observar
```

**A regra dos ganchos.** Toda página termina criando a tensão da seguinte — a
frase entre aspas acima. Não é enfeite: é o que transforma 17 páginas soltas
numa leitura só.

**A referência continua existindo**, e não é reescrita em forma de história.
`@Agent`, `@Tool`, `ThenaConfig`, `Context`, hooks — tabela de opções, tipos,
defaults. Quem já sabe o que quer não deve ler narrativa.

### Antes e depois

**Como está hoje** (`guias/tools`):

> Uma tool é uma classe decorada com `@Tool({ name, description, schema })`; a
> lógica fica no método `execute(input)`.

**Como fica:**

> ### Your agent can talk. It can't do anything.
>
> Ask it what's in `README.md` and it will guess — it has no way to read a file.
> A model produces text; to touch the world it needs something you hand it.
>
> That something is a tool.
>
> ```ts
> @Tool({ name: "read_file", description: "Reads a file.", schema: z.object({ path: z.string() }) })
> export class ReadFileTool {
>   async execute({ path }: { path: string }) {
>     return readFile(path, "utf8");
>   }
> }
> ```
>
> Hand it to the agent and ask again — it reads the file and answers from it.
>
> **But what happens when the file doesn't exist?**

O conteúdo técnico é o mesmo. O que muda é a ordem: **problema, solução,
próxima tensão** — em vez de definição, sintaxe, exemplo.

---

## 7. Ordem de execução

| | O quê | Onde |
| --- | --- | --- |
| 1 | `theme-color` → `#FE374C`; paleta oficial | site |
| 2 | Descrições de pacote para inglês | 6 `package.json` |
| 3 | Hero e README com o posicionamento novo | site, repo |
| 4 | Traduzir a documentação existente | submódulo |
| 5 | Reescrever `Começar` como jornada narrativa | submódulo |
| 6 | Separar `Build` de `Concepts` no menu | submódulo |
| 7 | Página contando a origem do nome | submódulo |
| 8 | `ExecutionEvent`/`Node` → `Step*` | código (quebra) |

**O que fica em português:** comentário de código e CHANGELOG.

**A decisão em aberto:** mensagem de erro. `"[thena] Nenhuma execução em curso"`
é vista pelo usuário final. Se o alvo é público internacional, ela precisa ir
para o inglês junto com a documentação — e aí é quebra de comportamento
observável para quem casa string de erro em teste.
