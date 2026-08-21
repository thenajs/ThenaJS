# Domain: Run context & lifecycle

The spine. Every other domain runs inside what this one sets up.

## Responsibility

Create the world a single execution lives in, keep concurrent executions from
touching each other, and expose that execution to the outside (cancel, observe,
await) and to the inside (`ctx`).

## Key files

| File | What |
|---|---|
| `packages/core/src/run-context.ts` | `RunContext`, the `AsyncLocalStorage`, `newRunContext`, `childRunContext`, `withRun`, `currentRun`, `throwIfAborted`, `requestStop`, `runCleanups` |
| `packages/core/src/run-view.ts` | The run-only view used when there is no step yet |
| `packages/core/src/run-handle.ts` | `RunHandle`, `Channel`, `createRunHandle` |
| `packages/core/src/bootstrap.ts` | `Thena.create`, per-run wiring, `use()`, `dispose()` |
| `packages/core/src/settings.ts` | `RuntimeSettings` (just the vector stores) |
| `packages/core/src/config.ts` | `ThenaConfig`, `ReportOptions`, `LogConfig` |

## Public API

`Thena.create(WorkflowClass, config)` → `WorkflowApp` with `run`, `use`,
`dispose`. `RunHandle` with `runId`, `result`, `signal`, `abort`, `onEvent`,
`eventStream`, `onToken`, `textStream`, plus `then`/`catch`/`finally`.
`WorkflowRunOptions`: `input`, `memory`, `budget`, `report`, `log`, `observe`,
`signal`, `data`. Deprecated but supported: `bootstrapWorkflow`, `EventQueue`.

Internal, do not export: `currentRun`, `peekRun`, `withRun`, `childRunContext`,
`resolveContext`, `peekContext`, `requestStop`, `runCleanups`.

## Depends on

Recorder (08), budget (07), middleware (06) — it assembles them. Depends on no
other domain's behaviour, only their constructors.

## Invariants

- **R-12/R-13** — recorder, settings and budget are per run; concurrent runs
  never contaminate each other.
- **R-06** — cancellation always throws; `stop()` and budget in `"stop"` mode
  skip and return the output already produced.
- **R-14** — no observer means no tree, no events, no token sink.
- **R-16** — `data` never reaches the model; `memory` does.
- `cleanups` is the **only** field a nested run does not inherit. Everything
  else — `runId`, recorder, settings, signal, `abort`, `stopRequest`, `onToken`,
  `data`, middleware — is shared, and `budget` is shared *by identity* unless
  the child declares its own.
- `abort` and `stopRequest` are the **same objects** in parent and child, so
  stopping from inside a sub-workflow ends the whole execution.
- `currentRun()` **throws** outside a run. That is deliberate: returning
  defaults made `ThenaConfig` silently vanish.
- Cleanups run in reverse registration order, like `defer`, and a throwing
  cleanup is reported and swallowed — the run already finished.
- The `AbortController` is created in `newRunContext`, not by the caller, so
  `abort()` exists even for a bare `runWorkflow` with no app. An external
  `signal` is composed with it via `AbortSignal.any`; first to fire wins.
- `Channel` replays its buffer to late subscribers (capped at
  `MAX_BUFFERED_EVENTS = 500`) — this is what makes POST-then-SSE work.
- `createRunHandle` attaches an internal no-op `.catch()`. Removing it crashes
  the process with `unhandledRejection` in the POST+SSE pattern.

## Dangerous

- **Anything that escapes the ALS scope loses the run.** A `setTimeout` or a
  worker in user code, or a framework path that forgets `withRun`, and
  `currentRun()` throws.
- Reordering fields in `childRunContext` — each line is a decision about
  sharing vs isolating. Read the comments before touching.
- `Channel.subscribe` replays history *before* subscribing; changing that order
  either duplicates or drops events.
- `dispose()` order matters: abort in-flight runs → await them → drain index
  writes → dispose plugins. A plugin that closes a server cannot vanish while a
  run still writes to it.
- The "not observed" warning fires once per run, not per subscription. Making
  it noisier or silent both have been considered.

## Tests

`isolation.test.ts` · `run-context.test.ts` · `run-handle.test.ts` ·
`app-run.test.ts` · `observation.test.ts` · `thena-create.test.ts` ·
`context-duas-portas.test.ts` · `streaming.test.ts` · `per-run-config.test.ts`

## Safe to change

Warning message wording, `MAX_BUFFERED_EVENTS`, the `Channel` iterator
internals (behaviour pinned by tests).

## Needs care

`RunContext` shape, inheritance rules, checkpoint placement, the handle's
public surface.

## Relations

Feeds **02** (runtime reads `currentRun()` everywhere), **07** (budget lives
here), **08** (recorder lives here), **06** (middleware list read per run so a
plugin registered later applies to later runs). ADR-002, ADR-004, ADR-005,
ADR-006.
