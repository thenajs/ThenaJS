# Design — `RunHandle`: `app.run()` devolvendo a execução

> Status: **aprovado, não implementado**. É a Fase C do [ROADMAP.md](./ROADMAP.md).
>
> A dependência que este documento citava — o refactor do `@thenajs/core` e a
> cadeia de middleware de chat — **já foi entregue**. As três fases abaixo estão
> desbloqueadas.

## Problema

`app.run()` devolve `Promise<T>`. No instante em que se dá `await`, a execução
deixa de existir como coisa — sobra só o resultado. Isso impede três usos:

1. **Cancelar.** Não há para onde mandar "pare". Cliente fecha a aba, a run
   continua gastando chamadas ao modelo até o `maxIterations`.
2. **Acompanhar.** Não dá para transmitir tokens nem passos de uma `Promise`
   que só resolve no fim.
3. **Endereçar.** Não dá para guardar a execução num `Map` e reencontrá-la —
   o padrão "POST responde com um id, cliente acompanha por SSE".

## Solução

`app.run()` devolve, **de forma síncrona**, um handle que também é *thenable*.

```ts
export interface RunHandle<T> extends PromiseLike<T> {
  /** Disponível já; hoje só dá para saber depois que a run acaba. */
  readonly runId: string;
  /** A saída final. Promise comum — compõe com Promise.all, .then, tudo. */
  readonly result: Promise<T>;
  /** O signal efetivo: o do usuário combinado com o `abort()` deste handle. */
  readonly signal: AbortSignal;

  /** Cancela. Atalho para o AbortController interno. */
  abort(reason?: unknown): void;

  /**
   * Observa a execução. Quem assina depois do início **recebe o que já
   * passou** antes dos eventos novos. Devolve como cancelar a assinatura.
   */
  onEvent(cb: (e: ExecutionEvent) => void): () => void;
  /** O mesmo, como AsyncIterable — dá backpressure de graça. */
  readonly eventStream: AsyncIterable<ExecutionEvent>;

  // --- dependem do streaming no provider (fase posterior) ---
  onToken(cb: (token: string) => void): () => void;
  readonly textStream: AsyncIterable<string>;
}
```

**A regra:** com `await`, você pede o resultado; sem `await`, você pede a
execução.

```ts
const texto = await app.run({ input });   // resultado
const exec = app.run({ input });          // execução
```

## Por que não as alternativas

**Por que não `Promise` + método `app.abort()`?** O `app` é longevo e atende N
execuções concorrentes — não há como ele saber qual delas abortar.

**Por que não duas portas (`run` + `stream`), como Anthropic/OpenAI/Vercel?**
Porque nenhum dos três resolve o caso 3. Eles modelam *uma chamada*; aqui
modelamos *uma execução longa que várias pessoas acompanham*. O handle
endereçável é o que a `Promise` não expressa.

**Por que não `await app.run()` devolvendo o handle?** Porque `await` espera a
execução terminar — o handle chegaria morto. Devolvendo síncrono e thenable,
os dois usos convivem sem armadilha.

## Uso

### Request HTTP simples

```ts
server.post("/chat", async (req, res) => {
  try {
    res.json({ texto: await app.run({ input: req.body, signal: req.signal }) });
  } catch (err) {
    if (req.signal.aborted) return;      // cliente sumiu, ninguém para responder
    res.status(500).json({ erro: String(err) });
  }
});
```

### Cancelamento

```ts
await app.run({ input, signal: AbortSignal.timeout(30_000) });   // timeout de graça

const exec = app.run({ input });
process.on("SIGINT", () => exec.abort());
const texto = await exec;

exec.abort(new Error("usuário desistiu"));   // a razão chega inteira no catch
```

### WebSocket

```ts
ws.on("message", (msg) => {
  const exec = app.run({ input: JSON.parse(msg) });

  exec.onEvent((e) => {
    if (e.phase === "end" && e.kind === "tool") {
      ws.send(JSON.stringify({ tipo: "tool", nome: e.name, ok: e.status === "ok" }));
    }
  });

  exec.result
    .then((texto) => ws.send(JSON.stringify({ tipo: "fim", texto })))
    .catch((err) => ws.send(JSON.stringify({ tipo: "erro", erro: String(err) })));

  ws.on("close", () => exec.abort());
});
```

### POST responde na hora, cliente acompanha por SSE

```ts
const execucoes = new Map<string, RunHandle<string>>();

server.post("/chat", (req, res) => {
  const exec = app.run({ input: req.body });          // ← sem await
  execucoes.set(exec.runId, exec);
  exec.result.finally(() =>
    setTimeout(() => execucoes.delete(exec.runId), 60_000),
  );
  res.status(202).json({ runId: exec.runId });
});

server.get("/chat/:id/events", (req, res) => {
  const exec = execucoes.get(req.params.id);
  if (!exec) return res.status(404).end();

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  });

  // Conectou 3s depois? Recebe os 3s que já passaram, e só então os novos.
  const parar = exec.onEvent((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));

  exec.result
    .then((texto) => res.write(`event: fim\ndata: ${JSON.stringify({ texto })}\n\n`))
    .catch((err) => res.write(`event: erro\ndata: ${JSON.stringify(String(err))}\n\n`))
    .finally(() => { parar(); res.end(); });

  req.on("close", parar);
});

server.delete("/chat/:id", (req, res) => {
  execucoes.get(req.params.id)?.abort();
  res.status(204).end();
});
```

### Encerramento limpo

```ts
process.on("SIGTERM", async () => {
  server.close();
  await app.dispose();   // aborta as runs em voo e espera elas soltarem
  process.exit(0);
});
```

## Implementação

### O miolo, em `bootstrap.ts`

```ts
run(options): RunHandle<T> {
  const runId = randomUUID();

  // O signal do usuário e o do `abort()` deste handle valem os dois.
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  // Buffer + assinantes: é o que faz quem chega atrasado ver o começo.
  const passados: ExecutionEvent[] = [];
  const ouvintes = new Set<(e: ExecutionEvent) => void>();
  const publicar = (e: ExecutionEvent) => {
    passados.push(e);
    for (const cb of ouvintes) { try { cb(e); } catch { /* isolado */ } }
  };

  const execucao = newRunContext({
    runId,
    settings: { memory },
    recorder: recorderDaRun(runId, options, publicar),
    signal,
  });

  const result = withRun(execucao, () =>
    runWorkflow<T>(WorkflowClass, toInitial(options.input), options.memory, options.budget),
  );

  // Sem isto, o caso do SSE derruba o processo: ninguém deu `await` ainda, e
  // uma falha vira `unhandledRejection`. O erro segue disponível em `.result`.
  result.catch(() => {});

  return {
    runId,
    result,
    signal,
    abort: (reason) => controller.abort(reason),
    onEvent(cb) {
      for (const e of passados) cb(e);   // reproduz o histórico primeiro
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    get eventStream() { return fila(this.onEvent.bind(this)); },
    then: (ok, err) => result.then(ok, err),
  };
}
```

### Onde o `signal` é consultado

Nos mesmos dois pontos que o `budget` já ocupa:

```ts
// passo de agente, antes do turno
execucao.signal?.throwIfAborted();
if (execucao.budget.checkpoint()) return ctx;

// until do loop
execucao.signal?.throwIfAborted();
if (currentRun().budget.checkpoint()) { stoppedBy = "budget"; return true; }
```

Mais a passagem até o `fetch`: `ChatParams.signal` → `chatInternal(…, signal)`
→ `request()`.

### Dois defeitos a consertar junto

1. **`transport.ts`** — hoje `init.signal ?? AbortSignal.timeout(...)`: se vier
   um signal **e** houver `timeoutMs`, o timeout é descartado em silêncio. Vira
   `AbortSignal.any([...])`.
2. **`retry.ts`** — `isRetryableByDefault` devolve `true` para qualquer erro sem
   status, então um abort seria **retentado**. Precisa excluir `AbortError`.
   E o `sleep()` do backoff precisa ser abortável, senão um cancelamento espera
   os 8s antes de perceber.

### Erro de cancelamento

Usar o erro nativo (`signal.throwIfAborted()` lança `signal.reason`), **não** um
`RunAbortedError` próprio. Isso preserva a distinção que o wrapper destruiria:

| origem | erro |
| --- | --- |
| `AbortSignal.timeout(n)` | `TimeoutError` |
| `controller.abort()` | `AbortError` |
| `controller.abort(new X())` | `X` |

Orçamento é conceito do framework e merece erro próprio (`BudgetExceededError`).
Cancelamento é conceito da plataforma, com protocolo estabelecido.

## Fases

| # | O quê | Esforço | Depende de | Onde |
| --- | --- | --- | --- | --- |
| 1 | `signal`, `abort`, `runId`, `result`, `onEvent`/`eventStream`, buffer, `dispose` drenando | ~1,5 dia | — (desbloqueado) | Fase C do roadmap |
| 2 | `chatStream()` no provider + evento de token | ~2 dias | item 1 | Fase E |
| 3 | `onToken` / `textStream` ligados ao item 2 | ~0,5 dia | 1 e 2 | Fase E |

A fase 1 já entrega os casos 1 (request simples) e 3 (POST + SSE) inteiros,
porque os dois dependem de `eventStream`, que existe hoje. Só o `onToken` espera
o streaming de verdade no provider — emitir um token único no fim seria pior que
não ter.

**O caminho do token, depois do refactor:**

```
provider (emite) → middleware de chat → recorder → RunHandle → usuário
```

Nenhuma ponta conhece a outra: o middleware traduz, e o `ReportRecorder` já sabe
distribuir para N ouvintes. Enquanto as tool calls paralelas estiverem adiadas,
a fase 2 é mais simples do que parecia — com no máximo uma tool por turno não há
interleaving a resolver: transmite o texto, detecta a chamada, para, executa,
encerra o turno.

## Decisões em aberto

1. **Teto no buffer de eventos.** Com `report: true` cada evento carrega prompt e
   resposta (até 20 KB por nó); uma run de 50 passos guarda ~1 MB, e o caso do
   SSE mantém N handles vivos. Descartar os mais antigos (o assinante atrasado
   perde o começo) ou deixar crescer?
2. **`abort()` no meio de um loop.** Lançar — `result` rejeita — ou parar
   graciosamente preservando o `output` da última volta, como o `budget` no modo
   `"stop"`? A inclinação é lançar: quem cancelou não quer meia resposta.

## Impacto em quem já usa

Quase nenhum: `await app.run({...})` continua devolvendo a saída, porque o
handle é thenable. `src/main.ts` e o template do CLI não mudam.

O que muda no tipo: `WorkflowApp.run` deixa de ser `Promise<T>` e vira
`RunHandle<T>`. Só quebra quem tiver anotado uma variável como `Promise<string>`
explicitamente.
