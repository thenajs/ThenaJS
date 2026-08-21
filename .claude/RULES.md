# Rules and invariants

Each rule states something that must hold, how to verify it, and whether a test
currently protects it. **Rules with no test are the dangerous ones** — nothing
will stop you from breaking them.

Legend for *Guarded by*:
`test` = a test fails if you break it · `toolchain` = build/lint fails ·
`nothing` = only this document and code comments.

---

## Layering

### R-01 — `@thenajs/agentflow` must never import `@thenajs/core`
The engine is mechanism; core is policy (ADR-001). The reverse direction is
the whole architecture.

*Verify:* `grep -rn "@thenajs/core" packages/agentflow/src` must return nothing.
*Guarded by:* **test** — `packages/core/test/architecture.test.ts`. Added
deliberately, because nothing else stops it: the workspace symlink resolves
`@thenajs/core` from inside `agentflow` and `tsc` accepts it. The test matches
*imports*, not mentions — `state.types.ts` names the package in a comment on
purpose.

### R-02 — `core/src/di/**` must never import `core/src/runtime/**`
A tool can launch a workflow, and a workflow contains tools; a direct import
creates a cycle. `resolveTool` therefore receives a `createRuntime` callback
from its caller instead of importing `WorkflowRuntime`.

*Verify:* `grep -rn "runtime/" packages/core/src/di` must return nothing.
*Guarded by:* **test** — `architecture.test.ts`. Documented at `di/tool.ts:23`.

### R-03 — The provider executes tools, not the agent
`Providers.chat` finds the tool and calls it. The agent step never dispatches a
tool itself. Budget accounting, report nesting and chain order all depend on
this (ADR-003).
*Guarded by:* test (`report.test.ts` asserts the tool node nests under chat).

---

## Naming and files that are contracts

### R-04 — `agent.decorator.ts` and `resolve-caller.ts` may not be renamed
`resolve-caller.ts` finds the user's `.agent.ts` by parsing the stack trace and
skipping internal frames, matched by **filename** regex (`INTERNAL`). Rename
either file and `resolveCallerFile` starts returning the framework's own file —
every `@Agent({ prompt: "./x.agent.md" })` with a relative path breaks.

The filter is by filename and not by directory on purpose: source maps rewrite
`dist/` paths back to `src/` in stack traces, so any folder-based check is
fragile.

*Guarded by:* **test, directly** — `architecture.test.ts` asserts both files
exist and re-derives the `INTERNAL` regex from source to check it still matches
them. Also caught indirectly by `decorators.test.ts` ("aceita caminho relativo
ao arquivo do agente"). This regression has happened once before.

### R-05 — Middleware chain order is semantic
Tool chain: `recordTool → toolHooks → [user] → countTool → toolErrorPolicy`.
Chat chain: `recordChat → [user] → countChat`.

Each position encodes a decision:
- **User middleware above `countTool`/`countChat`** — a middleware that
  short-circuits (a cache) spent nothing and must not add to the budget,
  otherwise `maxCostUsd` leaks.
- **Below `recordTool`/`recordChat`** — a step that never opens its node
  disappears from the report and the Flow graph.
- **Below `toolHooks`** — so a check sees the arguments that will actually
  execute; a `beforeTool` rewriting them afterwards would make authorization
  bypassable.

*Guarded by:* test — `middleware.test.ts` has one test per reason.

---

## Cancellation, stop and failure

### R-06 — Cancellation always throws; budget and `stop()` only skip
An abort must never be turned into an answer. Specifically it must not:
pass through the agent's `onError`; become a tool observation; be retried by
the HTTP layer.

`ctx.stop()` and a budget breach in `"stop"` mode do the opposite — remaining
steps are skipped and the run returns the output it already had, without
throwing.

*Guarded by:* test (`run-handle.test.ts`, `tool-failures.test.ts`).

### R-07 — There are exactly two checkpoints
Before each agent turn (`agent-step.ts`) and inside each loop's `until`
(`compile.ts`), plus one final `throwIfAborted` after the pipeline so an abort
in the last step is not silently ignored. A turn is one model call plus at most
one tool.

Adding a checkpoint elsewhere changes cost semantics; removing one makes a
ceiling stop being a ceiling.
*Guarded by:* test.

### R-08 — Three error types cross `toolErrorPolicy` untouched
`FatalToolError`, `BudgetExceededError`, and any error while
`run.signal.aborted` is true. Everything else a tool throws becomes an
observation the model reads.

Budget in particular must not become an observation: that would hand the model,
as text, the news that there is no budget left, and let it try again.
*Guarded by:* test.

---

## Budget

### R-09 — A chat call is counted on the way in, consumption on the way out
`openChat()` before `next()`, `closeChat(usage)` after. Because a tool runs
*inside* `provider.chat`, a call counted only on return still reads zero while
the sub-workflow it launched is running — and a recursion (workflow → tool →
same workflow) would descend forever without hitting any ceiling.

A throw in between leaves the call counted and the consumption not: erring
high, which is the correct direction for a budget.
*Guarded by:* test (`nested-budget.test.ts`, incl. the recursion case).

### R-10 — A nested run without its own budget reuses the parent's tracker
Nesting is not an escape hatch. With its own budget it gets a tracker *chained*
to the parent: it counts in both, and the tighter one cuts.
*Guarded by:* test (9 tests).

### R-11 — `onExceeded` fires exactly once per tracker
Memoized on first breach, so a loop re-evaluating the condition does not spam it.
*Guarded by:* test.

---

## Isolation and concurrency

### R-12 — Recorder, settings and budget are per-run, never module singletons
This is the bug the `RunContext` refactor existed to kill. Any module-scope
mutable state that a run writes to is a regression.

*Verify:* a `let`/mutable object at module scope in `packages/core/src` that a
run mutates. (The legitimate ones: the node-id counter in `recorder.ts`, the
`WeakMap` metadata registries, the report's index workers.)
*Guarded by:* test (`isolation.test.ts`, 5 tests).

### R-13 — Concurrent runs must not contaminate each other
Budgets, log sinks, report trees, `runId`s and `context()` reads are all
per-run. `app.dispose()` on one app must not affect another.
*Guarded by:* test.

---

## Observation

### R-14 — No observer means no cost
With no `report`, no `log`, no plugin with `onEvent` and no `observe: true`:
the recorder stays inactive, no tree is built, no `ExecutionEvent` is
allocated, and **the provider receives no `onToken` sink** — so it does not
request streaming. Measured at ~2x CPU per run and ~13 KB retained per live
handle.

Turning observation on by default would silently undo this.
*Guarded by:* test (`observation.test.ts`, 13 tests).

### R-15 — Telemetry must not make two different things look the same
`stoppedBy`, `exhausted`, `toolCallSource`, `isError`, `attempts` each separate
a pair that would otherwise be indistinguishable ("converged" vs "gave up",
native tool call vs rescued from text). When adding a new exit path, ask how a
report reader will tell it apart.
*Guarded by:* test, per field.

---

## Data flow

### R-16 — `run({ data })` never reaches the model; `run({ memory })` does
`memory` is serialized into the `system` message, so the model reads it and it
lands in the report on disk. `data` is transported, propagated to nested runs,
and kept out of the model. The framework interprets nothing inside `data`.
*Guarded by:* test.

### R-17 — `contextWindow` never trims the leading `system` block
Those messages are the agent's prompt and the state projection; cutting them
breaks the agent instead of saving anything. Preserving the head is also what
keeps the prefix stable for the provider's prompt cache.
*Guarded by:* test.

---

## Public API

### R-18 — `packages/core/src/index.ts` is the compatibility boundary
Anything exported there is public. Removing or changing the shape of an export
is a breaking change; in `0.x` that means a **minor** bump plus a `CHANGELOG.md`
migration entry.

Deprecated aliases that must keep working: `bootstrapWorkflow`, `AgentContext`,
`EventQueue`, `ToolCall` (engine). Do not delete them as cleanup.
*Guarded by:* **test** — `architecture.test.ts` pins the full list of runtime
value exports against a hand-written array. The list is hand-written, not a
snapshot, on purpose: a snapshot gets updated without anyone reading the diff,
which is the exact oversight this guards against. Type-only exports are not
reachable via `import *`; only `AgentContext` is checked, by source scan.

### R-19 — `ThenaConfig.stores` order is a positional contract
Without `@memory(Store)`, vector memories are injected into agent constructors
in array order. Reordering the array silently changes which store an agent
gets, and TypeScript cannot see it — the parameters have the same type. Append
at the end, never in the middle.
*Guarded by:* test (injection order), not the "never reorder" part.

### R-20 — One `VectorStore` instance per app, shared by every agent
One connection and one `ensureCollection` per store regardless of agent count.
`ensureCollectionOnce` is memoized on the store; a second agent asking for a
different embedding dimension fails loudly there, before spending an embedding.
*Guarded by:* test.

---

## Testing

### R-21 — Tests run against `src/`, never `dist/`
The aliases in `vitest.config.ts` and the `paths` in `tsconfig.test.json` exist
so a test can never pass against a stale build. Never add a build step to the
test path.
*Guarded by:* toolchain (config), not by a test.

### R-22 — A refactor that requires editing a test assertion is not a refactor
If the assertion has to change, behaviour changed. That is a different task,
with a different name and a `CHANGELOG.md` entry.
*Guarded by:* nothing. This is a discipline rule and it is the one most likely
to be quietly violated.

### R-23 — Test through the public API
Use `Thena.create` / `runWorkflow` and the `FakeProvider` harness at
`packages/core/test/harness.ts`. Tests of internal functions break on the first
file move and remove the safety net exactly when it is needed.
*Guarded by:* nothing.

### R-24 — A combinator's output may not depend on latency
`parallel` reads a frozen `history` and appends its branches' deltas in
declaration order; `ctx.output` and `ctx.turn` are the last **declared**
branch's. Two identical runs must produce an identical `history`. Ordering the
append must never serialise execution — the branches still start together
(ADR-022).
*Guarded by:* `packages/core/test/parallel.test.ts`, including the concurrency
test, which is what catches an "ordering" fix that accidentally awaits in a
loop.

### R-25 — Trimming history may not split a tool pair
An `assistant` carrying `toolCalls` and the `tool` message answering it are one
unit. `contextWindow` walks forward past any leading orphan `tool` after
trimming: the provider rejects a split pair with `400`, and `400` is not in
`RETRYABLE_STATUS`. `maxTurns` is a ceiling, not a quota — honouring the pair
may send one message fewer.
*Guarded by:* `packages/core/test/context-window.test.ts`.

---

## Style rules that are enforced

- `no-throw-literal` is an **error**: always throw an `Error`.
- Framework-originated errors are prefixed `[thena]`.
- Error messages name the class, the parameter, and the fix (`di/params.ts`).
- `eqeqeq` is an error (`null` excepted).
- `printWidth: 88`, Prettier. Markdown is hand-formatted and ignored.
- Lint must be **0 errors**. The 42 warnings are declared debt — see
  CURRENT_STATE.md before "fixing" any of them.
