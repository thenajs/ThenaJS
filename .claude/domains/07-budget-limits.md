# Domain: Budget & limits

Counters and a stop signal. Not behavioural heuristics.

## Responsibility

Measure what a run spends (wall time, model calls, tool calls, tokens, cost),
decide when it must stop, and make that decision hold across nesting.

## Key files

| File | What |
|---|---|
| `packages/core/src/budget.ts` | `RunBudget`, `BudgetUsage`, `BudgetExceeded`, `BudgetExceededError`, `BudgetTracker` |
| `packages/core/src/middleware/tool.ts` | `countTool` |
| `packages/core/src/middleware/chat.ts` | `countChat` |
| `packages/core/src/runtime/compile.ts` | The loop brakes (`maxIterations`, `maxFails`) |
| `packages/core/src/steps.ts` | The defaults: 10 iterations, 5 consecutive failures |

## Public API

`RunBudget`, `BudgetUsage`, `BudgetExceeded`, `BudgetExceededError`,
`DEFAULT_MAX_ITERATIONS`, `DEFAULT_MAX_FAILS`; `ctx.usage()` and `ctx.budget`.

## Depends on

01 (the tracker lives in `RunContext`), 06 (counting middleware).

## Invariants

- **R-09 — `openChat()` on the way in, `closeChat(usage)` on the way out.**
  Because tools run inside `provider.chat` (ADR-003), a call counted only on
  return reads zero while a sub-workflow launched by it runs, and recursion
  never hits a ceiling. A throw in between leaves the call counted and the
  consumption not — erring high, the correct direction.
- **R-10 — a nested run without its own budget shares the parent's tracker.**
  With one, it gets a tracker *chained* to the parent: it counts in both, and
  the tighter one cuts.
- **Spending propagates up the whole chain** — `openChat`, `closeChat` and
  `addTool` all call the parent.
- **`checkpoint()` is the single decision point.** It checks the local level
  first, then the parent, so the reported reason belongs to the nearest ceiling
  and the `mode` that decides stop-vs-throw is the one that actually breached.
- **R-11 — `onExceeded` fires once**, memoized on first breach, at *detection*
  time, so it works via any observing path including a loop's `until`.
- **`enabled` is false when no limit is configured** — nothing is measured or
  checked. That is the zero-cost path.
- **Ceilings are checked between units of work.** A run may exceed by one call
  before stopping, plus one per nesting level: a known constant upper bound,
  documented in `budget.ts`, not a proportional leak. Do not "fix" this into
  mid-generation cutting.
- **`mode: "stop"` (default) ends gracefully**, returning the output already
  produced; `"throw"` raises `BudgetExceededError`, which crosses
  `toolErrorPolicy` untouched (R-08).
- **Loop brakes (ADR-008):** `maxIterations` default 10, `maxFails` default 5
  and **consecutive** — only a tool that worked resets it; `Infinity` disables.
  `Math.max(1, …)` and `?? Infinity` exist so `0` means neither unlimited nor
  never.
- `costUsd` only exists when the provider was configured with
  `costPer1kTokens` (ADR-018).

## Dangerous

- Moving where `openChat` is called relative to `next()`. This is the single
  subtlest thing in the repo and it has a dedicated recursion test.
- The `evaluate()` check order determines which `reason` is reported.
- `exceeded()` is for reporting, `checkpoint()` for control flow. They are not
  interchangeable — `checkpoint()` can throw.
- A nested run's report node records the **delta**, not cumulative usage (02).

## Tests

`budget.test.ts` (3) · `nested-budget.test.ts` (9, incl. recursion) ·
`loop-with-broken-tool.test.ts` (8) · `middleware.test.ts` (short-circuit does
not bill) · `tool-failures.test.ts` (budget error does not become an
observation)

## Safe to change

Adding a new *counter* dimension — provided it flows through `checkpoint` and
`evaluate` consistently and propagates to the parent.

## Needs care

Everything about counting order and nesting.

## Relations

Counted by **06**, checked by **02**, reported by **08**. ADR-008, ADR-009,
ADR-018.
