# Domain: CLI & scaffolding

`thena create` and `thena g agent`. Small, and completely untested.

## ⚠️ Read this first

`packages/cli` has **zero tests** for 333 lines that generate whole projects. A
mistake here does not fail CI; it fails for a user running `thena create`
tomorrow. Verify by hand:

```bash
npm run build
cd /tmp && node <repo>/packages/cli/dist/index.js create smoke-test
cd smoke-test && npm install && npx tsc --noEmit
```

## Responsibility

Scaffold a new ThenaJS project, and generate an agent pair (`.agent.ts` +
`.agent.md`) inside one.

## Key files

| File | What |
|---|---|
| `packages/cli/src/index.ts` | Argument parsing, `create`, `generateAgent`, usage text |
| `packages/cli/src/templates.ts` | `pascal`, `classNameFromAgent`, `agentTsTemplate`, `agentMdTemplate`, `projectFiles` |

Run it in-repo with `npm run thena -- g agent explorer`.

## Public API

The command line itself: `thena create <name>` (alias `new`),
`thena g agent <name>`, `-v`, `-h`.

## Depends on

Nothing at runtime. It emits code that depends on `@thenajs/core`.

## Invariants

- **Generated projects are CommonJS** (ADR-017): no `"type": "module"`, matching
  `nest new`. This lets users write `from "./config"` without an extension. The
  framework itself is ESM-only — do not "align" them.
- **The build script must copy `.md` files into `dist/`**
  (`copyfiles -u 1 "src/**/*.md" dist`). Without it `@Agent` cannot find the
  prompt in production, and the failure appears only after a real deploy.
- **Generated agents use a relative `prompt` path**, which relies on
  `resolveCallerFile` (R-04).
- `create` refuses to overwrite an existing directory.
- `generateAgent` refuses to overwrite an existing agent.
- Agent class naming: `explorer` → `ExplorerAgent`; `my-agent` → `MyAgentAgent`.

## Dangerous

- **`THENA_VERSION = "0.10.0"` is hardcoded** at `templates.ts:54` and pins the
  `@thenajs/core` dependency of every generated project. It does not track the
  package versions. On a release bump, this must move too (CURRENT_STATE.md).
- The generated `tsconfig` sets `experimentalDecorators` and
  `emitDecoratorMetadata`; without the first, `@Agent` does not compile.
- The entire CLI interface is in Portuguese while the framework's messages are
  moving to English (CURRENT_STATE.md).
- `templates.ts` embeds a provider import path
  (`../../providers/ollama.provider`) that assumes the generated layout. Moving
  the scaffold's folders breaks generated agents.

## Tests

**None.** The `pascal` / `classNameFromAgent` helpers are pure functions and
would be trivial to test.

## Safe to change

Usage text, console wording.

## Needs care

`projectFiles` — every field is a promise to someone's future project. Anything
touching `THENA_VERSION`, the build script, or the tsconfig.

## Relations

Emits code consuming **04** (decorators) and **01** (`Thena.create`). ADR-017.
