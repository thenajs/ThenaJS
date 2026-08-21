# Domain: Flow (live viewer)

A local site that shows an execution as it happens. A plugin, not a core
feature.

## ⚠️ Read this first

`packages/flow/src/ui/**` has **no lint, no typecheck and no tests**. It is
excluded in `eslint.config.js`, and the root build runs `vite build` — esbuild
strips types without checking them. It is the only code in the repo with no
safety net. Treat changes there as unverifiable by any check in this repository.

## Responsibility

Consume `ExecutionEvent`s via `ThenaPlugin.onEvent`, keep a short in-memory
history, serve a React graph, and push updates over SSE.

## Key files

| File | What |
|---|---|
| `packages/flow/src/plugin.ts` | `thenaFlow(options)` → `ThenaPlugin` |
| `packages/flow/src/server/server.ts` | `FlowServer` — `node:http`, SSE, static files |
| `packages/flow/src/server/memory.ts` | `RunHistory` — per-run attribution, sequencing, cap |
| `packages/flow/src/types.ts` | The wire contract: `FlowEvent`, `FlowRun`, `FlowSnapshot`, `FlowOptions` |
| `packages/flow/src/ui/` | React app (`App.tsx`, `graph.ts`, `main.tsx`) — **unchecked** |

## Public API

`thenaFlow(options?)` and the `FlowOptions` type (`port` 4100, `host`
127.0.0.1, `maxRuns` 20, `log` true).

## Depends on

`@thenajs/core` for `ExecutionEvent` and `ThenaPlugin` only. Nothing depends on
Flow.

## Invariants

- **Run attribution is by `runId` from the event** (ADR-015). It used to be a
  single cursor with the boundary inferred from `depth === 0`, which scrambled
  concurrent runs. Do not go back to inferring.
- **Sequence numbers are per run**, not global.
- **History is in-memory only**, capped at `maxRuns`. Process exits, history
  gone. It is a window, not a trace store.
- **An error at any depth turns the run red immediately**, without waiting for
  the root `end` event.
- **`127.0.0.1` by default** — deliberate; this exposes prompts and tool I/O.
- **Broadcast is best-effort**: a client that died mid-write must not bring
  down the run being observed.
- **Static file serving refuses to escape `UI_DIR`**, including via `..`.
- SSE, not WebSocket (ADR-015): one-way, free on `node:http`, browser
  reconnects, no runtime dependency. `x-accel-buffering: no` is required or a
  buffering proxy holds the whole stream.
- An event without `runId` gets a synthetic id so it cannot corrupt attribution
  of real runs.

## Dangerous

- **The wire contract is still in Portuguese** — `inicioEm`, `fimEm`,
  `duracaoMs`, `runAtual`, status `"rodando"`, route `/api/eventos`, event name
  `evento`. Server and UI ship together, so it is internal to the package, but
  changing one side without the other breaks the viewer **with nothing failing
  in CI**.
- `NodeData.workflowState` (`ui/graph.ts:7`) means node status, not workflow
  state — rename collateral (CURRENT_STATE.md).
- The UI build output goes to `packages/flow/dist/ui/`, resolved at runtime
  relative to the compiled server. Moving either breaks static serving silently.
- Root `npm run build` runs `build:ui` = `vite build` only; the package's own
  `build` script also runs `tsc -b`. They are not the same.

## Tests

`packages/flow/test/memory.test.ts` (6) and `concurrency.test.ts` (2). Both
cover `RunHistory` only. **Server routing, SSE framing and the entire UI are
untested.**

## Safe to change

`RunHistory` internals (tested), server error strings.

## Needs care

Anything touching the wire contract, and everything in `ui/`.

## Relations

Consumes **08**'s `ExecutionEvent`; registered via **06**'s plugin interface.
ADR-015.
