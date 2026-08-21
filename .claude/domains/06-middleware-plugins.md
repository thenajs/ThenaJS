# Domain: Middleware & plugins

The extension seam. Two onion chains and the plugin interface.

## Responsibility

Wrap every tool execution and every model call in an ordered, removable stack of
concerns; let user code participate in both.

## Key files

| File | What |
|---|---|
| `packages/core/src/middleware/compose.ts` | `compose` — koa-style onion, double-`next()` guard |
| `packages/core/src/middleware/tool.ts` | `recordTool`, `toolHooks`, `countTool`, `toolErrorPolicy`, `toolChain` |
| `packages/core/src/middleware/chat.ts` | `recordChat`, `countChat`, `chatChain` |
| `packages/core/src/middleware/context-window.ts` | `contextWindow` — history trimming |
| `packages/core/src/plugin.ts` | `ThenaPlugin` |

## Public API

Types `Middleware`, `ToolMiddleware`, `ToolInvocation`, `ChatMiddleware`,
`ChatInvocation`, `ThenaPlugin`, `ContextWindowOptions`; function
`contextWindow`.

## Depends on

01 (invocations carry the `RunContext`), 07 (counting), 08 (recording).

## Invariants

- **R-05 — chain order is semantic, not cosmetic.**

  ```
  recordTool          always runs; without it the step vanishes from report + Flow
    toolHooks         the agent's beforeTool has the last word on args
      [ user ]        ← plugins land here
        countTool     only counts what was actually spent
          toolErrorPolicy
            [ execute ]
  ```

  ```
  recordChat
    [ user ]
      countChat
        [ provider.chat ]
  ```

  Three reasons, each with a test: above `count*` so a short-circuiting cache
  does not bill the budget; below `record*` so nothing disappears from the
  graph; below `toolHooks` so an authorization check sees the arguments that
  will actually run.

- **`compose` rejects a second `next()`** in the same middleware — otherwise the
  rest of the chain, including the model call, would execute twice.
- **`inv.args` is read after `next()`**, so `recordTool` logs the arguments a
  `beforeTool` rewrote, not the originals.
- **A `throw` from a plugin middleware kills the run** — it participates, unlike
  `onEvent`. To deny recoverably, return `{ content, isError: true }`.
- **A `throw` in `beforeTool` cancels the tool**: `next()` is never called, so
  neither the counter nor the tool runs.
- **`afterTool` returning a string replaces only the text and preserves
  `isError`**; to change the error flag, return a full `ToolOutput`.
- **All hooks: returning a value replaces, returning `undefined` keeps.**
- **`inv.node` is filled by `record*` when the node opens**; `inv.meta()` is a
  no-op before that and whenever observation is off.
- **`toolErrorPolicy` wraps only the centre**, so a throw from a hook still
  propagates.
- **Plugin middleware lists are read per run, not at bootstrap** — a plugin
  registered later applies to later runs.
- **`app.use()` rejects if `setup()` throws.** Configuration failure must
  surface before execution, not during.
- **`onEvent` is isolated**: a throwing listener affects neither the run nor
  other listeners.
- **`contextWindow` never trims the leading `system` block** (R-17), and is
  **off by default** (ADR-013) because trimming silently changes agent
  behaviour.

## Dangerous

- Reordering anything in `toolChain`/`chatChain`. Each position has a test
  naming its reason.
- `ContextWindowOptions.warnIndexFailure` is a **public, badly named** option
  (holds the notice text). Renaming is breaking — see CURRENT_STATE.md.
- `contextWindow`'s default notice is in Portuguese and goes into the prompt.
- `ToolInvocation.args` is mutable on purpose.

## Tests

`compose.test.ts` (8) · `middleware.test.ts` (13) · `context-window.test.ts` (11)
· `hooks.test.ts` (16)

## Safe to change

Adding a *new* built-in middleware — as long as you justify its position in the
chain and add a test for that position.

## Needs care

Chain order, `compose`, the hook contract.

## Relations

Wraps **05**; feeds **07** and **08**; hooks come from agent instances built in
**04**. ADR-013.
