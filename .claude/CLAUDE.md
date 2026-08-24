# Agent operating manual — ThenaJS

You are working on a TypeScript agent framework. This file tells you **how to
work here**. It is not documentation of the framework; that lives elsewhere and
is linked below.

Read this file completely before your first tool call in a session.

---

## The four-line summary

npm workspaces monorepo, ESM, TS `strict`, Node >= 20.19. Two layers:
`@thenajs/agentflow` is the engine (mechanism, no policy); `@thenajs/core` is
the framework (decorators, DI, run context, middleware, observability).
`flow`, `qdrant-client` and `cli` are satellites. Everything a run needs
travels in an `AsyncLocalStorage`-backed `RunContext`.

---

## Starting a task

**1. Establish ground truth before reading prose.**

```bash
npm test          # 501 tests, ~1s. If this is not green, stop and say so.
```

Do not skip this. It takes one second and it is the only statement about this
repository that cannot be out of date.

**2. Read, in this order:**

| Read | When |
|---|---|
| [TRUTH.md](TRUTH.md) | Always. It is short and it governs every conflict you will hit. |
| [CURRENT_STATE.md](CURRENT_STATE.md) | Always. Tells you what is broken and what not to touch. |
| [RULES.md](RULES.md) | Always. Invariants. Breaking one is the most expensive mistake available here. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | When the task crosses more than one module. |
| [DECISIONS.md](DECISIONS.md) | Before proposing anything structural, and whenever something looks "obviously wrong". |
| `domains/<n>-*.md` | For every domain the task touches. |
| [WORKFLOW.md](WORKFLOW.md) | When you are about to change code. |

**3. Identify the affected domain(s)** using the table below, then read those
domain files. A task that touches two domains needs both files — the
cross-domain sections are where regressions come from.

---

## Domain map

Find your task in the left column.

| If the task involves… | Domain file |
|---|---|
| `app.run()`, cancellation, `stop()`, `onDispose`, `RunHandle`, streaming channels, concurrency between runs | [01-run-context-lifecycle](domains/01-run-context-lifecycle.md) |
| Workflow steps, `loop`/`parallel`, `until`, compiling a workflow, agent turns, nested runs | [02-runtime-workflow](domains/02-runtime-workflow.md) |
| `Pipeline`, `StateManager`, history/tasks/memory buckets, message projection | [03-engine-pipeline-state](domains/03-engine-pipeline-state.md) |
| `@Agent` / `@Workflow` / `@Tool`, `@input`/`@context`/`@state`/`@memory`, prompt file resolution | [04-decorators-di](domains/04-decorators-di.md) |
| Providers, OpenAI/Ollama, HTTP, retry, streaming parsing, tool-call rescue, sampling, cost | [05-providers-transport](domains/05-providers-transport.md) |
| Middleware chains, `app.use()`, plugins, `contextWindow` | [06-middleware-plugins](domains/06-middleware-plugins.md) |
| `RunBudget`, token/cost accounting, `maxIterations`, `maxFails` | [07-budget-limits](domains/07-budget-limits.md) |
| Report, `ExecutionEvent`, recorder tree, logger, redaction, the run ledger | [08-observability-report](domains/08-observability-report.md) |
| `VectorMemory`, `VectorStore`, Qdrant, embeddings, `ThenaConfig.stores` | [09-vector-memory](domains/09-vector-memory.md) |
| The live execution viewer, its SSE server or its React UI | [10-flow-devtool](domains/10-flow-devtool.md) |
| `thena create`, `thena g agent`, generated project templates | [11-cli-scaffolding](domains/11-cli-scaffolding.md) |

If you cannot place the task, search for the symbol and read the file's header
comment — this codebase documents *why* at the point of decision, and those
comments are a primary source (see TRUTH.md).

---

## Investigating before you modify

This repository rewards reading and punishes guessing. Before changing a
symbol:

1. `grep -rn "<symbol>" packages/*/src packages/*/test` — find every caller and
   every test that pins it.
2. Read the **header comment** of the file you are about to change. It usually
   names the rejected alternative. If your plan is that alternative, you need
   an ADR, not an edit.
3. Check whether the symbol is exported from `packages/core/src/index.ts`. If
   it is, it is public API — see RULES.md R-18.
4. Check `DECISIONS.md` for the area.

---

## Checking impact

Cheap, mechanical checks that catch most cross-domain breakage:

```bash
# Who imports this file?
grep -rn "from \".*<basename>.js\"" packages/*/src

# Is this name public?
grep -n "<name>" packages/core/src/index.ts

# Which tests pin this behaviour?
grep -rln "<name>" packages/*/test
```

The four highest-reverb symbols in the repo — change these and assume
everything is affected: `RunContext`, `Providers.chat`, `compose`/the chain
builders, and `resolveCallerFile`.

---

## Running tests

```bash
npm test                     # everything, ~1s
npx vitest run packages/core/test/budget.test.ts     # one file
npm run test:watch           # while iterating
```

Tests run **against `packages/*/src`**, never against `dist/` — the aliases in
`vitest.config.ts` and the `paths` in `tsconfig.test.json` do that. You never
need to build in order to test. If you find yourself running `npm run build`
to make a test pass, you have misunderstood something.

Before declaring any change done, the full gate:

```bash
npm run lint && npm run format:check && npm test && npm run typecheck
```

`typecheck` runs a full build plus two `tsc --noEmit` passes and takes a while.
Run it once at the end, not in a loop. Lint must have **0 errors**; warnings
are pre-existing, declared debt (see CURRENT_STATE.md) — do not "fix" them as
a side quest.

---

## Writing a test — and when not to

Default here is the same as everywhere else in this file: **do not add one
unless it holds something.** A test that walks a path another test already
walked does not protect the path twice; it duplicates the cost of every future
change to it (R-22).

The check is mechanical, costs two commands, and beats judgement:

```bash
npm run test:coverage      # note the numbers for the file you touched
# add the test
npm run test:coverage      # did they move?
```

**If the numbers do not move, the test is a duplicate.** Either say in a
comment what it holds that coverage cannot see — a semantic trap, a public
contract, a regression that already happened once — or delete it.

Three ways this repo has produced dead tests, all of them plausible-looking one
at a time:

- **Restating a unit test one level up.** `retry.test.ts` already pins
  `isRetryableByDefault` against a list of statuses; a transport test that
  asserts "503 retries" after one that asserts "429 retries" adds a number, not
  a path.
- **Symmetry for its own sake.** Writing the mirror of a test because the pair
  looks tidy. The bug happened in one direction; that is the direction worth
  guarding.
- **Testing the platform.** Asserting that `AbortSignal.timeout` fires is a
  test of Node, not of this code.

Coverage is the floor of this judgement, not the ceiling: a test can be worth
keeping while moving nothing. It just has to say so out loud.

---

## Writing code here

Match what is already there. Concretely:

- **Comments explain the *why* and name the rejected alternative.** That is the
  house style and it has paid for itself repeatedly. A comment restating the
  code is noise; a comment saying "`?? Infinity` rather than a truthiness guard,
  so `maxIterations: 0` stops meaning unlimited" is the standard.
- **Error messages name the class, the parameter, and the fix.** Look at
  `di/params.ts` for the model.
- **Never `throw` a string** (lint enforces it). Framework errors are prefixed
  `[thena]`.
- Prettier config is `printWidth: 88`. Run `npm run format` — do not hand-align.
- Markdown is formatted by hand and is in `.prettierignore`. Leave it alone.

---

## When to update memory

Default: **update nothing.** These files are load-bearing precisely because
they are short. Specific triggers only:

| Trigger | File |
|---|---|
| You made a decision that contradicts, supersedes or extends a recorded one | `DECISIONS.md` |
| You established or removed a real invariant | `RULES.md` |
| You fixed something listed as broken, or broke something new | `CURRENT_STATE.md` |
| A domain's public surface or danger set changed | that domain file |
| The layering, the execution flow or a boundary moved | `ARCHITECTURE.md` |

Never append a changelog of your session to these files. `CHANGELOG.md` is where
history goes.

---

## When to record a decision

Write an ADR in `DECISIONS.md` when a choice will still constrain someone in
three months. Signals: it closes off an alternative; it is non-obvious enough
that a future agent would "fix" it; it trades one property for another.

Do **not** write an ADR for a bug fix, a rename, or something the code already
makes evident.

---

## When to stop and ask

Stop and ask before:

- changing anything exported from `packages/core/src/index.ts`;
- changing the order of a middleware chain;
- removing a `@deprecated` alias;
- renaming a file in `packages/core/src/decorators/` (see RULES.md R-04);
- anything touching the `docs` submodule (it has uncommitted work — see
  CURRENT_STATE.md);
- a refactor that requires editing existing test assertions. If an assertion
  has to change, behaviour changed, and that is a different task with a
  different name.

---

## Forbidden

- **Do not `git reset`, `git checkout --`, `git stash`, or `git submodule update`
  anything.** There is uncommitted work in this tree. Read CURRENT_STATE.md.
- **Do not commit or push** unless asked.
- **Do not "improve" code you happened to read.** Scope is the task.
- Do not build to run tests.
- Do not add a runtime dependency. The whole framework depends on `zod` and
  nothing else; `flow`'s UI is the only place with a bundled dep tree.
- Do not update `README.md` when the fact belongs in `docs/`. See
  CURRENT_STATE.md for why the README is not the source of truth.
- Do not silence a lint warning, widen a type to `any`, or add
  `@ts-expect-error` to get past a failure. Understand it.
