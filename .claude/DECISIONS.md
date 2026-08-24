# Architectural decisions

Decisions already made, extracted from the code, its comments and the git
history. Their purpose is to stop a future agent from re-litigating or
accidentally reverting them.

**Status** is `accepted` unless stated. To change one, follow the anti-drift
protocol in TRUTH.md: identify → explain → propose a superseding ADR → wait.

---

## ADR-001 — Split the engine from the framework

**Status:** accepted · **Scope:** whole repo

**Context.** Orchestration, model I/O, decorators, dependency injection,
budgets and reporting all wanted to live in one package.

**Decision.** `@thenajs/agentflow` holds **mechanism** and no policy: pipeline,
state, providers, HTTP, tool types, vector contracts. `@thenajs/core` holds
**policy** and DX: decorators, DI, run context, middleware, budget,
observability.

**Consequences.** `agentflow` may never import `core` (RULES.md R-01). Defaults
that shape behaviour live in core, not the engine — `Pipeline.loop` has no
default `maxIterations`; `loop()` supplies 10, because the engine is also a raw
primitive someone may use directly. Anyone can consume the engine without the
framework's opinions.

---

## ADR-002 — All run state lives in an AsyncLocalStorage `RunContext`

**Status:** accepted · **Supersedes:** module-scope mutable state

**Context.** Settings, the recorder and a `WorkflowRuntime` singleton were three
mutable module-scope variables. Two concurrent runs overwrote each other's. An
HTTP server calling `app.run()` per request was broken, and a test suite could
not exist — the tests contaminated one another.

**Decision.** One `RunContext` per run, carried in `AsyncLocalStorage`
(`run-context.ts`). Nested runs inherit via `childRunContext`.

**Consequences.** Concurrency became safe and testable; no public signature had
to change. Everything now depends on staying inside the ALS scope — code that
escapes it loses the run and `currentRun()` throws. Workflow compilation was
moved *inside* the scope, because building an agent step reads
`currentRun().settings`; compiling outside made `ThenaConfig` silently ignored.

---

## ADR-003 — The provider executes the tool

**Status:** accepted · **Scope:** engine + core

**Context.** Either the agent loop dispatches tools, or the provider does.

**Decision.** `Providers.chat` resolves the call, validates arguments against
the zod schema and executes the tool, returning a `ChatTurn` with both the
assistant and tool messages.

**Consequences.** Keeps conditionals out of the agent. But: the tool chain runs
*nested inside* the chat node; a sub-workflow launched by a tool runs while the
parent chat call is still open; and budget must count a chat call on the way in
(ADR-009). Schema-invalid arguments come back as an observation, not an
exception — the most recoverable failure there is.

---

## ADR-004 — `app.run()` returns a thenable `RunHandle`

**Status:** accepted · **Breaking in 0.9.0**

**Context.** A `Promise` cannot express three real needs: cancel, observe
progress, and hold the execution to find it again later (answer `{ runId }` to
a POST, follow by SSE).

**Decision.** `run()` returns a `RunHandle` that is `PromiseLike` and also
carries `runId` (synchronously), `abort()`, `onEvent`/`eventStream`,
`onToken`/`textStream`, `result`.

**Consequences.** `await app.run(...)` still works; chained
`.then().catch()` returns a plain Promise and drops the handle, which is
correct. `catch`/`finally` had to be declared explicitly beyond `then`.
The handle attaches a no-op `.catch()` internally, otherwise the POST+SSE
pattern crashes the process with `unhandledRejection` before anyone awaits.

---

## ADR-005 — `app.run()` propagates errors instead of swallowing them

**Status:** accepted · **Breaking in 0.9.0**

**Decision.** A failing run rejects. The framework does not print, and does not
set `process.exitCode`.

**Consequences.** Callers must handle rejection. Previously a failure vanished
silently, which inside an HTTP handler hid the error completely.

---

## ADR-006 — Observation is opt-in, and costs nothing when off

**Status:** accepted · **Breaking in 0.9.0**

**Context.** The recorder ran on every run: the full tree was built, two
`ExecutionEvent`s per step were allocated and buffered, and the provider was
always handed a token sink so every run requested streaming — with no reader.
Measured: ~2x CPU per run, ~13 KB retained per live handle.

**Decision.** A run is observed only when something is watching — `report`,
`log`, a plugin with `onEvent`, or explicit `observe: true`.

**Consequences.** The zero-cost path exists (RULES.md R-14). The price: an
unobserved `onEvent`/`textStream` would be silently empty, so the handle warns
once per run explaining how to turn observation on. Do not "helpfully" default
this to on.

---

## ADR-007 — Tool failure is an observation, with three exceptions

**Status:** accepted

**Context.** A ReAct loop needs the model to see "file not found" and try
something else. But a code bug, an expired credential or a dead database do not
improve with retries, and driver error messages leak connection strings into
the model's context and the on-disk report.

**Decision.** By default anything a tool throws becomes the tool's observation.
`FatalToolError` (thrown by the tool author), `BudgetExceededError`, and
cancellation propagate instead. To deny recoverably, return
`{ content, isError: true }` rather than throwing.

**Consequences.** RULES.md R-08. The last two only surface here when a tool
launches a sub-workflow, since that is where those checkpoints run.

---

## ADR-008 — Loops ship with brakes on

**Status:** accepted

**Decision.** `loop()` defaults to `maxIterations: 10` and `maxFails: 5`.
`maxFails` counts **consecutive** tool failures — a working tool resets the
counter, so an agent that errs and corrects is not punished. `Infinity`
disables either. The `loop` report node records `stoppedBy`.

**Consequences.** An unbounded loop spends the user's money, so unlimited
cannot be the default. `Math.max(1, …)` on `maxFails` and `?? Infinity` on
`maxIterations` exist so `0` means neither "unlimited" nor "stop immediately".
The defaults live in core, not the engine (ADR-001).

---

## ADR-009 — Budget counts the chat call on the way in

**Status:** accepted

**Context.** Tools execute inside `provider.chat` (ADR-003). A call counted
only on return reads zero while the sub-workflow it launched runs; a recursion
never hit any ceiling.

**Decision.** `openChat()` before the call, `closeChat(usage)` after. Nested
runs without their own budget share the parent's tracker; with one, they get a
tracker chained to the parent.

**Consequences.** RULES.md R-09, R-10. Ceilings are checked *between* units of
work, so a run may exceed by one call before stopping, plus one per nesting
level — a known constant upper bound, documented in `budget.ts`, not a
proportional leak.

---

## ADR-010 — Parameter decorators for DI, never `reflect-metadata`

**Status:** accepted

**Context.** Type-based DI needs `design:paramtypes`, which **esbuild does not
emit** — and `tsx` (the dev path) uses esbuild. DI would have worked when
compiled with `tsc` and silently broken in development.

**Decision.** Each parameter declares what it wants: `@input()`, `@context()`,
`@state()`, `@memory(Store?)`. Decorator *calls* are emitted by both toolchains.

**Consequences.** Order stops being a contract — two parameters of the same type
(two `VectorMemory`) are distinguishable. Without decorators the historical
positional contract still applies. Unresolvable injections throw naming the
class, the parameter index and the fix, because silently injecting `undefined`
is the worst possible failure here.

---

## ADR-011 — `context()` is one name with two doors

**Status:** accepted

**Decision.** `context()` returns a `Proxy` that is both callable (the
parameter decorator) and readable (the context object). Inside a step it
resolves to the step ctx; outside one — a provider factory, which runs at
compile time — to a run-only view that **throws with an explanation** on
`state`/`output`/`turn`/`loop`/`logs`.

**Consequences.** The alternative was marking `state` optional, making every
tool pay a `?.` for a failure that happens in one place. The Proxy must not
resolve the context for symbols or for the function's own properties, or
`console.log(context())` would probe dozens of them and explode outside a run.

---

## ADR-012 — Provider resolution by prototype chain, not by trying `new`

**Status:** accepted · **Supersedes:** a `try { new fn() } catch (TypeError)` heuristic

**Context.** The old heuristic ran the user's constructor body inside the
`try`. A `TypeError` from *their* code — a missing env var, destructuring an
`undefined` config — was read as "not callable with `new`". The real error
vanished and what surfaced was `Class constructor X cannot be invoked without
'new'`: a message about `new` semantics for a `.env` problem. A factory written
as `function` (which has a `prototype`) also ran twice.

**Decision.** Every provider extends `Providers`, so
`fn.prototype instanceof Providers` answers without executing anything. A class
that does *not* extend `Providers` is detected by source inspection and gets a
message saying exactly that.

**Consequences.** Constructor errors propagate intact; factories run once.

---

## ADR-013 — Redaction on by default; context window off by default

**Status:** accepted

**Decision.** Secret masking (`redactSecrets`) is **on** for everything captured
into the report, the log and plugins. `contextWindow` is **off** and must be
enabled explicitly.

**Rationale for the asymmetry.** A file on disk with no retention policy or
access control is the worst place for a secret to appear by accident — and the
report writes prompts, responses, tool I/O and raw error messages. Whereas
trimming history **changes agent behaviour**: it can silently drop what the
agent needed. A default there would trade a loud, expensive failure for a mute
degradation, which is harder to diagnose. Measure first (`promptTokens` on the
`chat` node), then enable.

**Consequences.** Redaction does not cover PII — there is no regex for a name
or an address. For personal data, `report: { content: false }` keeps the tree
and drops the text.

---

## ADR-014 — Report per run, with an append-only ledger

**Status:** accepted · **Breaking in 0.9.0** (path moved to `<dir>/<runId>/`)

**Context.** A fixed path meant two concurrent runs overwrote each other's
report. Rebuilding the index read and `JSON.parse`d every historical
`report.json` — full trees, prompts included — to extract five scalars per run:
measured at 632 ms of blocked event loop per completed run with 5,000 reports.
Synchronous, on the critical path.

**Decision.** Each run gets `<dir>/<runId>/`. Summaries append one line to
`runs.jsonl`. Index rendering happens off the critical path, one worker per
folder, written to a temp file and `rename`d atomically.

**Consequences.** The append is short enough to be atomic between processes.
`app.dispose()` drains pending index writes. The ledger grows without bound —
known, measured, and covered by tests (`ledger-do-report.test.ts`).

---

## ADR-015 — Flow keeps history in memory only, over SSE

**Status:** accepted

**Decision.** The viewer is a window onto what is happening now, not a trace
store. History dies with the process, capped at `maxRuns` (default 20). SSE
rather than WebSocket — the flow is one-way, it is free on `node:http`, the
browser reconnects on its own, and it adds no runtime dependency. Binds to
`127.0.0.1` by default.

**Consequences.** Run attribution is by the `runId` on each event. It used to
be a single cursor with the boundary inferred from `depth === 0`, which worked
with one run at a time and scrambled two.

---

## ADR-016 — Qdrant: one collection, partitioned by a payload field

**Status:** accepted

**Decision.** Everything goes in one collection; contexts are separated by a
`dataset` payload field carrying a `keyword` index with `is_tenant`. Floor is
Qdrant 1.10 (the unified `/points/query` endpoint).

**Consequences.** Matches Qdrant's own guidance — many collections cost
resources and Qdrant Cloud caps at 1000 per cluster. Different embedding
dimensions genuinely need different stores, which is why
`ensureCollectionOnce` fails loudly on a dimension conflict.

---

## ADR-017 — `thena create` generates a CommonJS project

**Status:** accepted · **Changed in 0.9.0**

**Decision.** The scaffolded project has no `"type": "module"`, matching what
`nest new` produces.

**Consequences.** Lets users write `from "./config"` without an extension —
CJS resolution completes `.js`/`/index.js`, which native ESM does not. Note the
framework itself is ESM-only; only generated projects are CJS. The build script
must copy `.md` prompts into `dist/`, or `@Agent` cannot find them in
production.

---

## ADR-018 — Cost tables are the user's responsibility

**Status:** accepted

**Decision.** No price table is embedded. `costUsd` appears only when the
provider was configured with `costPer1kTokens`. Cached input tokens are billed
at the normal input price unless `cachedInput` is given.

**Consequences.** An embedded table would rot silently. The fallback errs
high — the correct direction.

---

## ADR-019 — Retry on by default; `timeoutMs` deliberately without a default

**Status:** accepted

**Decision.** HTTP retry is on (3 attempts, exponential backoff with full
jitter, honouring `Retry-After`). `timeoutMs` has **no** default.

**Rationale.** A transient 429 or 503 should not kill a run. But a timeout is
the one parameter that can break a working setup — aborting a slow local model
that currently answers in 200s — so it stays opt-in. Contract errors (400, 401,
403, 404) are not retried; retrying only costs time and money. Aborts are never
retried: whoever cancelled does not want another attempt.

---

## ADR-020 — The `docs/` site is the documentation; the root README is not

**Status:** accepted · **Enforcement:** incomplete — see CURRENT_STATE.md

**Decision.** Documentation lives in the `docs/` git submodule (VitePress,
bilingual EN/PT, 71 pages per language, parity and links validated in its own
CI). The root `README.md` is a repository overview.

**Consequences.** In practice the README is 1,324 lines duplicating the site,
and it is the stale copy. When documenting something, write it in `docs/`.

---

## ADR-021 — The Flow SSE protocol is internal to the package

**Status:** accepted · **Enforcement:** `packages/flow/test/protocol.test.ts`

**Decision.** The wire between `FlowServer` and its browser UI — the
`/api/events` and `/api/runs/:id` routes, the `snapshot` / `run` / `event` SSE
names, and the `FlowRun` / `FlowSnapshot` payload shapes — is **internal to
`@thenajs/flow`**. Server and UI are built and published together
(`prepack: build:ui`), and the documented way to consume the stream from outside
is `ThenaPlugin.onEvent`, which hands over the core's `ExecutionEvent`. The
protocol is therefore free to change with the package, and its field names now
follow the core's vocabulary: `startedAt`, `endedAt`, `durationMs`, `running`.

The rejected alternative was to treat the SSE endpoint as public API and version
it. Nothing in `docs/` describes it, no example consumes it, and paying for a
compatibility promise nobody asked for would freeze a vocabulary that was
already inconsistent — the same duration travelled the same JSON as
`durationMs` on the event and `duracaoMs` on the run.

**Consequences.** `FlowRun`, `FlowSnapshot` and `FlowEvent` stay exported for
typing a `FlowServer` consumer, but their fields are not a compatibility
boundary — R-18 covers `core`, not this. Renaming one is a minor bump in `0.x`,
recorded in the CHANGELOG, not an ADR-level event.

Because no test looked at the HTTP layer, the two sides could drift silently:
`memory.test.ts` pinned the data shape, and lint, typecheck and the suite all
passed while the browser broke. `protocol.test.ts` closes that — it asserts the
routes, the event names and the frame format, and it was verified by mutation
(rename the route, rename the event; watch it go red).

---

## ADR-022 — `parallel` appends in declaration order, over a frozen read

**Status:** accepted · **Breaking in 0.10.0** · **Enforcement:**
`packages/core/test/parallel.test.ts`

**Decision.** A `parallel` block takes one snapshot of `history` at entry and
gives it to every branch; each branch writes into its own history, and the
deltas are appended to the parent in **array order** once all branches settle.
`ctx.output` and `ctx.turn` become those of the **last declared** branch. Each
branch runs inside its own `withRun` scope with its own ctx.

The `core` therefore stops using `Pipeline.parallel`. The engine combinator is
`Promise.all` over one ctx — mechanism, no policy — and ordering and isolation
are policy (ADR-001). `Pipeline.parallel` stays exported for anyone composing a
pipeline by hand.

**Why.** Two measured defects, both in `ROADMAP.md`. Append order was completion
order, so `parallel([slow, fast])` produced `fast, slow` and the result moved
with model latency — a combinator whose output changes between identical runs.
And isolation was accidental: it held only because every branch read before its
first `await`, so a `beforePrompt` hitting a cache made the second branch read
the first one's answer.

The rejected alternative was forking the whole state and merging. It is not
needed: `tasks`, `memory` and the `@Workflow` state stay shared by reference —
they are the documented collection point, and isolating them would break the
fan-out → collect pattern that already works. Only `history` is per-branch.

**Consequences.** The per-branch `withRun` is load-bearing, not tidiness:
`run.step` is a single mutable field, so without an async scope per branch the
`context()` function returns whichever branch attached last. Verified by
mutation — drop the `withRun` and the `context()` test goes red.

Ordering the append must not serialise execution. The concurrency test in
`parallel.test.ts` is the guard, and it is the one to watch on any change here.

---

## ADR-023 — A failing `parallel` branch cancels its siblings

**Status:** accepted · **Breaking in 0.10.0** · **Enforcement:**
`packages/core/test/parallel.test.ts`

**Decision.** Each block owns an `AbortController` whose signal is composed with
the run's. The first branch to reject aborts it, and nothing from the block is
appended to the parent.

**Why.** `Promise.all` rejects on the first error but leaves the siblings
running. They kept spending tokens and writing into the state of a run that had
already rejected — writes that could land after the report was closed. The
first error is rethrown, not an `AbortError`: the siblings' aborts are the
consequence, and reporting one of them would name the symptom.

**Consequences.** A branch that must not take the block down still catches
inside the agent, via `onError` — that path is unchanged. Discarding the whole
block on failure is deliberate: merging what the survivors reached would leave
the history holding half of a block that did not happen.

---

## ADR-024 — `run({ prompt })` is a flat string; there is no structured input bag

**Status:** accepted · **Breaking in 0.12.0** · **Enforcement:**
`packages/core/test/steps-helpers.test.ts` ("o prompt vira a primeira mensagem
user")

**Decision.** `WorkflowRunOptions.prompt: string` replaces
`input: WorkflowInput`. The `WorkflowInput` type is deleted, along with the
`toInitial()` helper and its fallback of serialising the whole object when
`message` was absent.

**Why.** The bag was never opened. `WorkflowInput` declared
`[key: string]: unknown`, but nothing in the framework injected that object —
`@input()` is a different thing entirely, the schema-validated arguments of a
**tool** (`di/params.ts`), and `buildAgentStep` never populates `args` for an
agent constructor. The only consumer was `toInitial()`, which reduced it to a
string before the pipeline. So the open shape bought nothing and cost the
reader a level of nesting plus a name — `input` — that suggests the input/output
pair of IO, on a method that only ever takes input.

The `JSON.stringify` fallback went with it because it turned a typo into a
silent success: `{ mesage: "..." }` did not fail, it became the prompt.

**Consequences.** Structured payloads have two better doors, and which one you
want is decided by what the model may see: `data` for what it must **not** read,
`state.memory` for what it must. Sending a structure as the prompt is still
possible and now has to be said out loud — `prompt: JSON.stringify(payload)`.

The cost accepted here is a name collision: `prompt` already means the agent's
system markdown in `@Agent({ prompt })`. The two are distinguished everywhere by
qualifier — *the agent's prompt* versus *the run's prompt* — and the docs
glossary carries the entry. Reviving `message` as the field name would avoid the
collision but reintroduces the wrapper, since `message` alone at the top level
would read as a config option rather than the user's turn.

---

## ADR-025 — `ParallelTool` is the concurrency strategy, not native parallel tool calls

**Status:** accepted · **Enforcement:** `packages/tools/test/parallel.test.ts`,
`packages/core/test/performance.test.ts` ("N tools em sequência custam N turnos")

**Decision.** `Providers.chat` honours **one** tool call per turn —
`raw.toolCalls?.[0]` — and concurrent tool execution is offered through
`@thenajs/tools`' `ParallelTool`, which takes a list of sibling calls in its
schema and runs them under `Promise.all`. Native `tool_calls[n]` support is
**not** planned. This is a design choice, not a pending gap.

**Why.** The framework's target is mixing weak local models with paid frontier
ones in the same workflow, unchanged. That goal makes native parallel tool calls
the worst available bet:

- They require the model to emit a well-formed `tool_calls` **array**. Small
  local models frequently have no reliable native tool calling at all — which is
  precisely why `rescueToolCalls` exists and ships **on by default**, and why
  `extractToolCall` parses a call out of free text.
- The rescue path extracts **one** call from loose JSON in prose. Extending it
  to N would be markedly more fragile, and it is the path the weak models
  actually take.
- Supporting native N would make behaviour **diverge by provider**: the same
  workflow would batch on GPT and serialise on llama. Parity across models is
  the product, so a faster path that only strong models reach is a regression in
  the thing being sold.

`ParallelTool` turns "emit N native tool calls" into "fill one Zod schema with a
list" — a much easier problem for a weak model, and one that fails the
recoverable way the framework already handles: an invalid schema comes back as
an observation and the model corrects on the next turn. Cost is identical where
it matters: one round-trip either way.

**Consequences.** Round-trip economy depends on the **prompt** telling the model
that `parallel` exists and when to reach for it (see
`src/agents/explorer/explorer.agent.md`). A workflow that registers the tool but
never mentions it in the prompt pays N round-trips — the tool is available, not
automatic.

Two costs accepted:

- Strong models are trained to emit parallel tool calls natively; routing them
  through the indirection spends a slot in the tool catalogue and prompt
  attention that could go to the task.
- `ParallelTool` validates its sub-calls itself (`target.schema.parse`), because
  on the normal path the provider is what validates. That is a second
  implementation of the same contract, and it has to stay in step with
  `Providers.executarTool`.

**Do not "fix" this.** A reviewer reading `toolCalls?.[0]` will read it as a
limitation — that has already happened once, in an external code review. The
comments at `provider.ts` and in `performance.test.ts` point here.
