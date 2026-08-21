# Domain: Decorators & dependency injection

Declaration → metadata → instance.

## Responsibility

Register agents, workflows and tools; load an agent's markdown prompt; resolve
constructor and `execute` parameters; turn a provider declaration into an
instance.

## Key files

| File | What |
|---|---|
| `packages/core/src/decorators/agent.decorator.ts` | `@Agent` — resolves and reads the `.agent.md` |
| `packages/core/src/decorators/workflow.decorator.ts` | `@Workflow` |
| `packages/core/src/decorators/tool.decorator.ts` | `@Tool` |
| `packages/core/src/decorators/metadata.ts` | Three `WeakMap` registries + getters that throw by class name |
| `packages/core/src/decorators/inject.ts` | `@input`, `@context`, `@state`, `@memory`, `pointsOf` |
| `packages/core/src/decorators/resolve-caller.ts` | Stack-trace based discovery of the caller's file |
| `packages/core/src/di/resolve.ts` | `resolveProvider`, `resolveMemory` |
| `packages/core/src/di/tool.ts` | `resolveTool`, the `PLAN` symbol |
| `packages/core/src/di/params.ts` | `resolvePoint` — one parameter at a time |

## Public API

`Agent`, `Workflow`, `Tool`, `input`, `context`, `state`, `memory`,
`getAgentMetadata`, `getWorkflowMetadata`, and the config/metadata types.

## Depends on

01 (`context()` resolves through the run view), 09 (`@memory` needs stores).
Must **not** depend on 02 (R-02).

## Invariants

- **R-04 — `agent.decorator.ts` and `resolve-caller.ts` filenames are contract.**
  The `INTERNAL` regex skips frames by *filename*, deliberately not by
  directory: source maps rewrite `dist/` paths back to `src/`. Renaming either
  breaks every relative `prompt` path. This has broken once already.
- **ADR-010 — never `reflect-metadata` or `design:paramtypes`.** esbuild
  (used by `tsx`) does not emit them; DI would work compiled and silently break
  in dev. Parameter decorator *calls* are emitted by both toolchains.
- **`@Agent` reads the markdown synchronously at decoration time**, i.e. at
  module load. A missing file fails at import, not at run.
- `prompt` accepts a relative string (resolved against the agent file, needs the
  stack trace), an absolute string, or a `URL` (no stack trace — this is what
  tests use).
- **Injection never silently yields `undefined`.** Every unresolvable point
  throws naming the class, the parameter index and the fix. This is the domain's
  defining choice.
- `@context()` in a **constructor** always fails — the context does not exist
  when the class is built. The message says to use it in a tool's `execute` or
  take `ctx` as a hook parameter.
- **`@context()` is a `Proxy` that is both decorator and object** (ADR-011). It
  must not resolve the context for symbols or for the function's own properties,
  or `console.log(context())` explodes outside a run.
- **Without parameter decorators the historical positional contract applies**:
  the agent constructor receives the vector memories in registration order
  (R-19).
- **`resolveProvider` distinguishes class from factory via the prototype chain**
  (ADR-012), never by trying `new`. A class not extending `Providers` is
  detected by source inspection and told so.
- **One tool instance per tool**, not a module singleton — the class is
  stateless (context comes from `RunContext`), so the cost is one allocation
  and the module keeps zero global state.
- `resolveTool` receives `createRuntime` as a callback instead of importing
  `WorkflowRuntime` — that is what keeps R-02 true.
- A `@Tool` class without `execute` fails at resolution naming the class, even
  though TypeScript already blocks it at declaration.
- Metadata registries are `WeakMap`s keyed by the class.

## Dangerous

- `resolveCallerFile` parses `new Error().stack` with a regex. Fragile by
  nature; the guardrails are the filename contract and one test.
- The `PLAN` symbol smuggles the injection plan from `resolveTool` to
  `tool-step.ts`, which is the first place that has the ctx. It is not public.
- `resolveMemory` reads `currentRun().settings` — so it only works inside the
  run scope, which is why compilation happens there (02).
- `resolve-caller.ts:48` still throws in Portuguese.

## Tests

`decorators.test.ts` · `inject.test.ts` · `resolucao.test.ts` ·
`context-duas-portas.test.ts` · `vector-memory.test.ts`

## Safe to change

Error message wording (keep the class/parameter/fix shape).

## Needs care

The two filenames, the `INTERNAL` regex, the Proxy traps, `resolveProvider`'s
branch order.

## Relations

Feeds **02**, which consumes the metadata. ADR-010, ADR-011, ADR-012.
