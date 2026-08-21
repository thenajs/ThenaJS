# Domain: Engine — pipeline & state

The raw primitives. Mechanism with no policy (ADR-001).

## Responsibility

Run an ordered list of steps over a shared context; hold conversation state in
three buckets and project it into messages a model understands.

## Key files

| File | What |
|---|---|
| `packages/agentflow/src/pipeline/pipeline.ts` | `Pipeline` — `new`, `run`, `parallel`, `loop` |
| `packages/agentflow/src/pipeline/pipeline.types.ts` | `PipelineContext`, `Step`, `LoopInfo`, options |
| `packages/agentflow/src/state/state.ts` | `StateManager` — buckets, `toMessages`, `compile` |
| `packages/agentflow/src/state/state.types.ts` | `Message`, `Role`, `State`, `ProviderToolCall` |
| `packages/agentflow/src/markdown/` | Tiny markdown helpers used by `compile` |

## Public API

Re-exported through core: `Pipeline`, `StateManager`, `md`, and the types
`PipelineContext`, `Step`, `State`, `Message`, `Role`, `LoopInfo`.

## Depends on

Nothing but `zod` (indirectly, via tools). **Must never import `@thenajs/core`
(R-01).**

## Invariants

- **Three state buckets, fixed meaning.** `history` = the conversation
  (user/assistant/tool turns, where action↔observation lives); `tasks` =
  tracked items; `memory` = durable content. All three are arrays.
- **`toMessages()` projection is the contract:** `memory` + `tasks` collapse
  into **one** `system` message, then `history` verbatim. An author may ignore
  this and build messages by hand.
- **`Pipeline.loop` has no default `maxIterations`** — `?? Infinity`, so
  `maxIterations: 0` does not mean unlimited. Defaults belong to core
  (ADR-001, ADR-008). Do not add one here.
- **`ctx.loop` is written by the most recent loop to finish.** With nested
  loops the innermost/last wins. For reliable nested data, read the report tree
  (08).
- `parallel` runs `Promise.all` over the same ctx — shared state is the point.
- `Pipeline.run` seeds `history` with `{ role: "user", content: initial }`
  before any step.
- `Message.toolCalls` holds **at most one** call per turn (no parallel tool
  calls), which preserves the assistant/tool pairing the OpenAI API requires.
- `ProviderToolCall` (`{ id, name, arguments, source }`) is **not** the hooks'
  `ToolCall` (`{ name, args }`). The old name `ToolCall` is a deprecated alias
  here — keep it (R-18).

## Dangerous

- `StateManager.append` throws a bare `"State is not an array."` — one of the
  few messages without the `[thena]` prefix or a fix hint.
- `toMessages()` emits the literal `"Tarefas:"` in the system message
  (Portuguese, reaches the model — see CURRENT_STATE.md).
- Changing the bucket projection changes every prompt every agent sends.
- `Pipeline` is generic over `C extends PipelineContext`; core widens it to
  `AgentContext`. Narrowing it breaks core.

## Tests

No direct test file. Covered indirectly and heavily through core:
`parallel.test.ts`, `loop-with-broken-tool.test.ts`, `steps-helpers.test.ts`,
`run-options.test.ts`. **A change here that breaks nothing in `packages/core/test`
is probably untested** — check before assuming safety.

## Safe to change

`markdown/` helpers, `compile()` rendering.

## Needs care

`toMessages()`, bucket semantics, `Pipeline.loop` control flow, `Message` shape.

## Relations

Consumed by **02** (compiles into `Step`s) and **05** (providers consume
`Message[]`). Upward dependency on core is forbidden (R-01).
