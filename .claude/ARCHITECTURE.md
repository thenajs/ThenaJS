# Architecture

What the system is made of, how a run flows through it, and where the walls
are. Implementation detail lives in `domains/` and in the source comments; this
file only covers what you need in order to make a decision.

---

## 1. Packages and the dependency graph

npm workspaces (`packages/*`), ESM only, TypeScript `strict`, decorators are
the **legacy** ones (`experimentalDecorators: true`), Node >= 20.19.

```
                        zod
                         ▲
                         │
              @thenajs/agentflow          ── the ENGINE
                         ▲
                         │
                 @thenajs/core            ── the FRAMEWORK
                    ▲         ▲
                    │         │
      @thenajs/flow │         │ @thenajs/qdrant-client
                              
                 @thenajs/cli             ── depends on nothing
```

| Package | Role | Published |
|---|---|---|
| `@thenajs/agentflow` | Pipeline, state, providers, HTTP transport, tool types, vector contracts, markdown helpers | yes |
| `@thenajs/core` | Decorators, DI, run context, runtime, middleware, budget, observability | yes |
| `@thenajs/qdrant-client` | `VectorStore` implementation over Qdrant's REST API | yes |
| `@thenajs/flow` | Live execution viewer: SSE server + React UI | yes |
| `@thenajs/cli` | `thena create`, `thena g agent` | yes |
| `src/` (repo root) | Demo application consuming the framework | no |
| `examples/multi-tenancy` | Standalone example, **outside the workspace** | no |

`tsconfig.build.json` declares the project references and therefore the build
order: `agentflow → core → qdrant-client → flow → cli`.

---

## 2. The central boundary: mechanism vs policy

This is the decision that shapes everything else (ADR-001).

**`@thenajs/agentflow` is mechanism.** It knows how to run steps, hold state,
speak HTTP to a model, parse a response, execute a tool. It has *no opinion*
about what should happen when things go wrong, what a run may cost, or what
gets recorded. It knows nothing about `AsyncLocalStorage`, decorators, budgets
or reports.

**`@thenajs/core` is policy.** Tool failure becomes an observation — decided
here. A loop stops after 10 iterations — decided here. A run has a ceiling —
here. What lands in the report — here.

Two concrete illustrations, worth internalising because they look like
arbitrary placement until you see the pattern:

- `Pipeline.loop` (engine) has **no** default `maxIterations`. `loop()` (core)
  supplies `10`. Changing the engine default would alter behaviour for anyone
  using the raw primitive.
- `Providers` (engine) lets whatever `tool.execute` throws propagate.
  `toolErrorPolicy` (core) converts it into an observation, with three named
  exceptions.

**Consequence you must respect:** `agentflow` may never import `core`. Nothing
in the toolchain enforces this today — the workspace symlink resolves fine.
See RULES.md R-01.

---

## 3. Execution flow

```
Thena.create(WorkflowClass, config)        synchronous — building an app awaits nothing
  │  instantiates ThenaConfig.stores ONCE, shared by every run
  │
  └─ app.run(options) ──────────────────▶ returns RunHandle synchronously
       │                                   (thenable; runId available immediately)
       │
       ├─ newRunContext({...})            the run's world, put into AsyncLocalStorage
       │    runId · settings · recorder · budget · signal · abort · stopRequest
       │    cleanups · onToken · data · middleware
       │
       └─ withRun(ctx, () => runWorkflow(...))
            │
            ├─ getWorkflowMetadata(WorkflowClass)      from the @Workflow WeakMap
            ├─ new StateManager()  +  new meta.state() one state instance per run
            │
            ├─ compileStep(...)  ── INSIDE the run scope, deliberately:
            │     │                 building an agent step instantiates the provider,
            │     │                 the tools and the agent, and resolves vector
            │     │                 memories by reading currentRun().settings
            │     │
            │     ├─ AgentClass      → buildAgentStep
            │     ├─ parallel([...]) → buildParallelStep, wrapped in a report node
            │     └─ loop({...})     → Pipeline.loop, wrapped + brakes + stoppedBy
            │
            └─ recorder.around("workflow", …)
                 └─ Pipeline.run(initial)
                      │   seeds history with { role: "user", content: initial }
                      │
                      └─ for each step:
                           ┌──────────────── agent step ────────────────┐
                           │ attachRunToStep(ctx, run)                  │
                           │ ── CHECKPOINT: abort throws / stop+budget skip
                           │ beforePrompt hook                          │
                           │ messages = [system] + state.toMessages()   │
                           │                                            │
                           │ CHAT CHAIN                                 │
                           │   recordChat → [user middleware] → countChat
                           │     └─ Providers.chat(...)                 │
                           │          ├─ chatInternal → the HTTP call   │
                           │          ├─ strip think tags               │
                           │          ├─ native tool call, else RESCUE  │
                           │          │  from the response text         │
                           │          ├─ validate args against the zod  │
                           │          │  schema (failure = observation)  │
                           │          └─ EXECUTES THE TOOL:             │
                           │               TOOL CHAIN                   │
                           │                 recordTool → toolHooks     │
                           │                   → [user] → countTool     │
                           │                     → toolErrorPolicy      │
                           │                       └─ tool.execute      │
                           │                                            │
                           │ append assistant turn, and tool turn if any│
                           │ afterResponse hook                         │
                           │ write ctx.turn (feeds the loop's `until`)  │
                           └────────────────────────────────────────────┘
```

The non-obvious structural fact, from which several invariants follow:
**the provider executes the tool, from inside `provider.chat`.** So the tool
chain runs *nested inside* the chat node, a sub-workflow launched by a tool
runs while the parent chat call is still open, and budget must count a chat
call on the way *in* (ADR-009, RULES.md R-03).

---

## 4. `RunContext` — the spine

Everything a run carries lives in one object in an `AsyncLocalStorage`
(`run-context.ts`). Before this existed, three mutable module-scope variables
held the same state, two concurrent runs overwrote each other, an HTTP server
calling `app.run()` per request was broken, and a test suite could not exist
without cross-contamination (ADR-002).

| Field | Inherited by a nested run? |
|---|---|
| `runId` | yes — a sub-workflow is part of the same execution |
| `settings` (vector stores) | yes |
| `recorder` | yes — keeps sub-workflow nodes hanging under the tool's node |
| `budget` | **the same tracker**, unless the nested run declares its own |
| `middleware` | yes |
| `signal` / `abort` | yes — the same object |
| `stopRequest` | yes — the same object |
| `onToken` | yes |
| `data` | yes |
| `cleanups` | **no** — each run owns its own |
| `step` | n/a — points at the currently executing step's ctx |

`cleanups` is the one exception, and deliberately: a sub-workflow finishing
must not release resources still owned by its caller.

### Two doors to the same object

`context()` is both a parameter decorator and a readable object (a `Proxy`).
Inside a step it yields the step ctx (with `state`, `turn`, `output`); outside
one — in a provider factory, which runs during workflow compilation — it yields
a run-only view that **throws with an explanation** on step-only fields rather
than returning `undefined` (`run-view.ts`).

---

## 5. Extension points

Ranked by how much the framework expects you to use them.

| Point | How | Notes |
|---|---|---|
| `@Tool` class | `execute(...)`, params via `@input`/`@context`/`@state`/`@memory` | The main one. |
| Agent hooks | `beforePrompt`, `beforeTool`, `afterTool`, `afterResponse`, `onError` on the agent class | Return a value to replace, `undefined` to keep. |
| Agent escape hatch | define `run(input, ctx)` on the agent class | Takes full control; automatic hooks are **not** called. |
| `ThenaPlugin` | `app.use({ name, setup, onEvent, tool, chat, dispose })` | `onEvent` observes; `tool`/`chat` participate. |
| Custom provider | `extends Providers`, implement `chatInternal` | Base class handles rescue, validation, tool execution, cost. |
| Custom vector store | `extends VectorStore` | Inherits retry/timeout from `HttpTransport`. |
| Provider as factory | `provider: () => new X(...)` in `@Agent` | Called **per run**, inside run scope — can read `context().data`. |

`HttpTransport` is the shared base of both `Providers` and `VectorStore`, which
is why retry and timeout policy come for free in either.

---

## 6. Public API surface

`packages/core/src/index.ts` is the compatibility boundary — 32 export
statements, including re-exports of engine types for convenience. Anything
there is public. Anything not there is internal, regardless of whether it is
`export`ed from its own module (`peekContext`, `resolveContext`, `PLAN`,
`childRunContext` are all internal).

Deprecated aliases that must keep working: `bootstrapWorkflow`,
`AgentContext`, `EventQueue`, and `ToolCall` in the engine (renamed
`ProviderToolCall`).

---

## 7. Where things may and may not change

| Freely changeable | Change with care | Do not touch without approval |
|---|---|---|
| `markdown/`, parsers, `redact` patterns, report HTML rendering, `retry` internals, logger formatting | Provider implementations, vector layer, Flow server, CLI templates | `core/src/index.ts`, middleware chain order, `RunContext` shape, `resolve-caller.ts`, `agent.decorator.ts` filename |

`packages/flow/src/ui/**` is its own category: it has **no lint, no typecheck
and no tests**. See CURRENT_STATE.md.
