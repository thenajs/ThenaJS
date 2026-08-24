# Current state

**Snapshot taken:** 2026-08-24 · branch `main` · last commit `9cfe7a8` plus
uncommitted work (see below)

Where the project is *right now*. Not a history — `CHANGELOG.md` is for that.
If something here is out of date, the measured facts below are re-derivable in
about a minute; do that rather than trusting this file blindly.

---

## Health

| Check | Result |
|---|---|
| `npm test` | **501 passing**, 46 files, ~1.0 s |
| `npm run lint` | **0 errors**, 40 warnings (declared debt, see below) |
| `npm run typecheck` | clean (build + app typecheck + test typecheck) |
| `npm run test:coverage` | **90.0% lines**, 89.7% statements, 84.6% functions, 79.4% branches |
| `npm run format:check` | clean |

All seven CI steps pass. The seventh is new: `typecheck:ui` runs `tsc` over the
Flow UI, which has its own `tsconfig` and is not covered by the root `tsc -b`.

---

## ⚠️ Uncommitted work — do not destroy

`git status` shows ` M docs`. **`docs/` is a git submodule**
(`git@github.com:thenajs/thenajs.github.io.git`), and that `M` is the pointer
moved forward:

```
recorded in HEAD:  4333c98  docs: ThenaConfig.memory passa a ser ThenaConfig.stores
checked out now:   646bb3b  docs: conserta o que só aparecia lendo a página renderizada
                   44a8e80  docs: exemplos mínimos primeiro, endurecimento depois
```

Two documentation commits exist inside the submodule and have not yet been
registered in the parent repo. The submodule's own working tree is clean.

**Forbidden:** `git reset`, `git checkout -- docs`, `git submodule update`,
`git stash`. Any of those discards real work. If the user wants it committed,
that is `git add docs` in the parent — and only when asked.

---

## Broken right now

Nothing in the verification chain. The two entries that stood here — the
`format:check` failure on `packages/agentflow/test/stream.test.ts` and the
`publish.yml` loop iterating over the removed `tools` package — were both fixed
on 2026-08-21 and are described in CHANGELOG.md.

The publish loop no longer carries a hardcoded list: it reads the `PACOTES` job
env, and a step before any `npm publish` fails if that list and `packages/` do
not hold exactly the same names, in either direction. The order stays hand
written because it is dependency order, not alphabetical.

## Stale documentation (proven, not suspected)

These are why `README.md`/`ROADMAP.md`/`CONTRIBUTING.md` sit at rank 6 in
TRUTH.md.

| File | Claim | Reality |
|---|---|---|
| `README.md:35` | dependency graph includes `tools` | package removed |
| `README.md` "Publicação" | publish order `agentflow → core → tools → cli` | `tools` gone |
| `CONTRIBUTING.md` | "246 testes" | 501 |
| `CONTRIBUTING.md` "Onde as coisas ficam" | lists `tools/ tools prontas` | removed |
| `ROADMAP.md` | "367 testes" | 501 |
| `ROADMAP.md:21,58,189` | `ShellTool` shipped | removed with the package |
| `SECURITY.md:51` | says the shell tool was removed | **correct** — this one is current |

`docs/` (the submodule) **is** up to date, including the
`ThenaConfig.memory → stores` rename.

---

## Incomplete work

### The English identifier sweep did not finish

Commit `eae2f32` is titled "termina a varredura de identificadores para o
inglês". It did not reach everything.

**Wire protocol — done** (2026-08-21, ADR-021). `FlowRun` and `FlowSnapshot`
now speak the core's vocabulary (`startedAt`, `endedAt`, `durationMs`,
`"running"`, `currentRunId`); the route is `/api/events` and the SSE names are
`snapshot` / `run` / `event`. `packages/flow/test/protocol.test.ts` pins all of
it, verified by mutation.

**Local identifiers in `flow` are still Portuguese** — `fonte`, `conectado`,
`dados`, `seguindo`, `runVisivel`, `formatarHora` in `ui/App.tsx`, and
`removida` / `evento` as parameter names in the server. These are not on the
wire; the sweep stopped at the protocol on purpose.

**User-facing strings still in Portuguese**, despite commit `fa49651`:

**Everything that reached the model was translated in `0.12.0`** — the
`system` projection of `state.tasks`, the tool observations, the rescued-call
suffix and both trim notices, plus the prompts the CLI generates. What is left
is Portuguese that a **developer** reads, never the model:

| Location | String |
|---|---|
| `packages/core/src/decorators/resolve-caller.ts:48` | `[@Agent] Não foi possível descobrir…` |
| `packages/core/src/observability/report.ts` | HTML report labels |
| `packages/core/src/observability/logger.ts` | verbose log labels |
| `packages/flow/src/server/server.ts:123,183` | 404 strings |
| `packages/cli/src/**` | the CLI interface (the generated prompts are English now) |

`packages/core/test/**` describes/its are also in Portuguese — that is a
deliberate house style, not drift.

`examples/multi-tenancy` has Portuguese filenames (`execucao.ts`,
`quem-sou.tool.ts`) and is **outside the npm workspace**, so CI never builds
or typechecks it.

### Collateral damage from an automated rename

These look intentional and are not. Do **not** "fix" them without reading the
note.

- **`ContextWindowOptions.warnIndexFailure`** — **resolved in `0.12.0`.**
  Renamed to `notice`, with the old name kept as a `@deprecated` alias, so it is
  not a breaking change. `docs/{en,pt}/techniques/context-management.md` still
  teach the old name and still carry the note promising the rename — **the
  submodule has not been updated yet**, and it must be before publishing.
- **`NodeData.workflowState`** (`packages/flow/src/ui/graph.ts`) — holds a
  node's status, not any workflow state. Still misnamed; its *values* were
  renamed to `"running"` with the protocol, the field was not.

Three more casualties of the same rename were found on 2026-08-21 by running the
UI typecheck by hand, and fixed. They had been shipping broken: `graph.ts`
called `nodes.has(...)` on an array (`TypeError` on the first edge — no graph
rendered), it emitted `type: "passo"` while `App.tsx` registered
`{ step: StepNode }` (so the custom node never rendered), and `App.tsx` read
`?.dados` from a `RawNode` that has `data` (the detail panel never opened).
Two of the three were type errors that nothing in the repo was running.

The `nodes.has` one is worth remembering as a shape. `nos` (the Map) and `nodes`
(the output array) were distinct identifiers until the sweep translated `nos`
into its literal English — `nodes` — which already existed in that scope. Two of
the three call sites were correctly renamed to `raw`; the third bound to the
wrong variable, and it *resolved*, so only the type was wrong. Both bugs are now
pinned by `test/graph.test.ts`, including the `type: "step"` string: it has to
match `NODE_TYPES` in `App.tsx` by hand, and no compiler checks that pair.
- **`run-handle.ts:159`** — the `@deprecated` note says "Use
  `Canal<ExecutionEvent>`". No such class exists; it is `Channel`.

---

## Untested surface

Ranked by risk.

Coverage is measured since 2026-08-22 and the thresholds in `vitest.config.ts`
are the **measured baseline**, not a target: they exist to fail a regression, and
raising them is a deliberate decision. `packages/flow/src/ui/**` is excluded —
it has its own build and would drag the number down without saying anything.

| Area | LOC | State |
|---|---|---|
| `packages/flow/src/ui/**` | ~350 | **Typechecked since 2026-08-21, still no lint and no tests.** `npm run typecheck:ui --workspace @thenajs/flow` is now the 7th CI step — before it, `ui/tsconfig.json` existed and nothing ran it, which is how three runtime bugs shipped (see above). `graph.ts` — the pure part — is now covered by `test/graph.test.ts`. Still excluded in `eslint.config.js`, and no test renders a React component. |
| `packages/cli` | 333 | 10 tests on `templates.ts` since 2026-08-22, including the one that pins `THENA_VERSION` to the CLI's own version — the drift that would make `thena create` generate a project asking for a version that is not on npm. `index.ts` (the command wiring) is still untested. |
| `packages/qdrant-client` | 192 | 14 tests since 2026-08-22, with `fetch` stubbed. They pin what goes out (route, body, auth header) and what is done with what comes back — including the guard that `remove({})` calls nothing, because deleting everything must not be implicit. |
| `examples/` | — | Outside the workspace; CI never compiles it. |

Architectural invariants with **no** enforcement: **R-22** (a refactor that
edits an assertion is not a refactor) and **R-23** (test through the public
API). Both are discipline rules; no tool can check them.

The Flow wire protocol was equally unenforced and is now covered by
`packages/flow/test/protocol.test.ts` (5 tests, ADR-021).

R-24 (`parallel` order and isolation) and R-25 (`contextWindow` never splits a
tool pair) are new, and both are enforced — see `parallel.test.ts` and
`context-window.test.ts`. Each guarantee was verified by mutation; the one to
keep an eye on is the concurrency test, which is what catches an "ordering" fix
that accidentally serialises the branches.

R-01, R-02, R-04 and R-18 *were* unenforced and are now covered by
`packages/core/test/architecture.test.ts` — added alongside this memory system,
6 tests, no behaviour change. Each was verified by mutation: break the
invariant, watch the test go red, restore.

---

## Declared technical debt

The 40 lint warnings are deliberate, with reasons in `eslint.config.js`:

- **`no-explicit-any` (~21)** — the DI boundaries (`instance`, the injection
  plan), middleware invocation, and parsing raw provider JSON. Typing these
  properly is its own piece of work.
- **`no-unsafe-function-type` (~19)** — `Function` is used where the framework
  accepts "the class" without constraining the signature
  (`runWorkflow(WorkflowClass: Function)`, the decorator `WeakMap`s). The
  critique is valid: `Thena.create(() => {})` compiles today. The fix means
  introducing a `ClassLike` and changing 19 signatures, several public — a task
  with its own risk, not a hygiene pass.

Other known, accepted debt:

- The report ledger grows without bound; every index render re-reads the whole
  file. Measured and covered by tests (`ledger-do-report.test.ts`) — projection
  is ~12.6 MB at 100k runs. Accepted for now.
- Version drift. `packages/cli/test/templates.test.ts` now fails if
  `THENA_VERSION` and the CLI's own version diverge, which closes the worst of
  it — the rest is still manual. The version lives in **twelve** places that must
  move together with nothing linking them: the **six** package `version` fields,
  the **four internal dependency ranges**, the `THENA_VERSION` literal in
  `packages/cli/src/templates.ts`, and `package-lock.json`.

  The four ranges, which is the half that gets missed:

  | From | To |
  |---|---|
  | `core` | `agentflow` |
  | `flow` | `core` |
  | `tools` | `core` |
  | `qdrant-client` | `agentflow` (was `core` until `0.12.0` — see R-26) | In `0.x`, `^0.10.0` means `>=0.10.0 <0.11.0`, so leaving a
  range at `^0.9.0` makes the published `core` refuse its own sibling and npm
  installs the previous `agentflow` beside it. The workspace stays green either
  way, because it resolves to the local sibling — the defect exists only in the
  published artifact. Root `package.json` is `0.1.0` and is `private`, so it
  never ships.
  Coherence is checkable in one command; see "Known next steps".
- `README.md` is 1,324 lines duplicating the docs site (ADR-020).

---

## Do not touch right now

1. **`docs/`** — uncommitted submodule pointer.
2. **`packages/flow/src/ui/**`** — no safety net; a change there is unverifiable
   by any check in this repo.
3. **Public API in `packages/core/src/index.ts`**, including the misnamed
   `warnIndexFailure` and the deprecated aliases.
4. **Middleware chain order** (RULES.md R-05).
5. **`decorators/agent.decorator.ts` and `decorators/resolve-caller.ts`
   filenames** (RULES.md R-04).

---

## Known next steps

Not commitments — what the code and history imply is pending.

- Take `packages/flow/src/ui/**` out of the ESLint `ignores`. The typecheck is
  wired now; lint is the half that is still missing, and it is what would have
  caught the Portuguese leftovers on the wire in the first place.
- Finish the `0.12.0` release. Measured on npm: **`latest` is on `0.11.0`** for
  all six packages and `next` is behind it, on `0.9.0`. The tree is still on
  `0.11.0` — the bump across the twelve places has not been done, nothing is
  committed, and `CHANGELOG.md` has `[0.12.0] — não lançado` written up.
  Open: the bump, the git tag (`git tag` stops at **v0.6.0** — `0.9.0`, `0.10.0`
  and `0.11.0` all shipped without one, via workflow dispatch), whether `next`
  gets pointed at `0.12.0` or abandoned, and updating the `docs/` submodule,
  which still teaches `warnIndexFailure`.
- Make the version drift mechanical: have the CLI read its own `package.json` at
  runtime instead of the `THENA_VERSION` literal, and add a CI check that every
  internal range equals `^<sibling version>`.
- Refresh `README.md`, `ROADMAP.md`, `CONTRIBUTING.md` against reality, or
  shrink the README and defer to `docs/` per ADR-020.
- The `ClassLike` refactor that would let `no-unsafe-function-type` become an
  error.
- Tests for `cli` and `qdrant-client`; some safety net for the Flow UI.
- `ROADMAP.md` declares all seven phases complete and maturity "Beta" at ~89%.
