# Domain: Runtime & workflow

Turns decorator metadata into executable pipeline steps, and runs them.

## Responsibility

Compile a `@Workflow` into engine `Step`s; execute an agent turn end to end;
build the tool objects the provider will call; run nested workflows.

## Key files

| File | What |
|---|---|
| `packages/core/src/runtime/run-workflow.ts` | `runWorkflow`, `run` (single agent), `toInitial` |
| `packages/core/src/runtime/compile.ts` | `compileStep` — agent / `parallel` / `loop`, loop brakes, `stoppedBy` |
| `packages/core/src/runtime/parallel-step.ts` | `buildParallelStep` — frozen read, per-branch scope, ordered merge, sibling cancel |
| `packages/core/src/runtime/agent-step.ts` | The agent turn: hooks, messages, chat chain, `ctx.turn` |
| `packages/core/src/runtime/tool-step.ts` | Wraps a `ToolType` in the tool chain + parameter injection |
| `packages/core/src/runtime/workflow-runtime.ts` | `WorkflowRuntime`, injectable, launches nested runs |
| `packages/core/src/steps.ts` | `parallel`, `loop`, `untilAnswered`, `turnOf`, `calledTool`, `wasExhausted`, defaults |

## Public API

`run`, `runWorkflow`, `buildAgentStep`, `WorkflowRuntime`, `parallel`, `loop`,
`untilAnswered`, `calledTool`, `turnOf`, `wasExhausted`,
`DEFAULT_MAX_ITERATIONS` (10), `DEFAULT_MAX_FAILS` (5).

## Depends on

01 (run context), 03 (Pipeline/StateManager), 04 (metadata + DI), 05 (provider),
06 (chains), 07 (budget), 08 (recorder). This is the crossroads domain — almost
any change here touches something else.

## Invariants

- **Compilation happens inside the run scope.** `buildAgentStep` instantiates
  the provider, the tools and the agent, and resolves vector memories by reading
  `currentRun().settings`. Compiling outside made `ThenaConfig` silently
  ignored. Do not hoist it.
- **R-07** — checkpoints: start of each agent step, inside each loop's `until`,
  and one final `throwIfAborted` after the pipeline. Without the last one, an
  abort in the final step resolves normally.
- **One state instance per run** (`new meta.state()`), shared by every step and
  handed to `until` as its second parameter.
- **An `until` declaring a 2nd parameter without `state` on the `@Workflow`
  fails at compile time**, with a message saying what to add — rather than a
  raw `TypeError` on first field read.
- **Loop failure counters live in the closure, not `ctx.loop`** — `ctx.loop` is
  last-writer-wins across nested loops. They reset on each invocation, so an
  inner loop restarts its count on every outer turn.
- **Only a tool that *worked* resets `consecutive`.** A turn with no tool is
  neither progress nor failure.
- **Failures are counted before any stop check** — it happened, even if another
  brake ends the loop.
- **`ctx.turn` is the loop's window into the last turn.** The escape hatch sets
  `calledTool: false` so `untilAnswered` terminates.
- The escape hatch `run(input, ctx)` takes full control: **automatic hooks are
  not called**.
- **`parallel` is composed here, not by `Pipeline.parallel`** (ADR-022). Every
  branch reads one frozen `history` snapshot; each writes into its own and the
  deltas are appended in **declaration order**; `ctx.output`/`ctx.turn` are the
  last **declared** branch's. `tasks`, `memory` and the `@Workflow` state stay
  shared by reference — they are the collection point.
- Each branch runs in its own `withRun` scope. This is load-bearing: `run.step`
  is a single field, so without it the `context()` function returns the sibling's
  ctx (R-24).
- A branch that throws aborts its siblings and the whole block is discarded
  (ADR-023).
- Nested runs: `runWorkflow` inherits the parent context via `childRunContext`;
  `run()` (single agent) reuses the current context if there is one, so a bare
  agent counts against the same budget.
- `runWorkflow` records the **delta** of budget usage on its node, not the
  cumulative — a nested run shares the parent tracker, so reading cumulative
  would bill the sub-workflow for what the caller already spent.
- Cleanups run **before** the node's telemetry is written, because a cleanup can
  itself spend.

## Dangerous

- `attachRunToStep` uses `Object.assign` on purpose: `runId`/`signal` are
  `readonly` for *consumers*, not for the runtime building the ctx. Do not
  "fix" this into a cast.
- Reordering the checks in the loop's `until` changes which `stoppedBy` is
  reported. Order is: count failure → abort → stop → budget → maxFails → user
  `until`.
- The agent step catches, then calls `throwIfAborted` **before** `onError` — so
  cancellation never becomes a fallback answer.
- `toInitial`: `input.message` becomes the first user message; otherwise the
  whole object is JSON-serialized.

## Tests

`parallel.test.ts` · `loop-with-broken-tool.test.ts` · `nested-run.test.ts` ·
`nested-budget.test.ts` · `steps-helpers.test.ts` · `hooks.test.ts` ·
`smoke.test.ts` · `run-options.test.ts` · `performance.test.ts`

## Safe to change

Wording of compile-time error messages; adding a new read-only helper alongside
`turnOf`/`calledTool`.

## Needs care

Everything else. This is the highest-coupling domain in the repo.

## Relations

ADR-001 (defaults live here, not the engine), ADR-003, ADR-008, ADR-009.
