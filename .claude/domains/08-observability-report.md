# Domain: Observability & report

The execution tree, the live event stream, the on-disk report, and secret
masking.

## Responsibility

Build a tree of what happened, emit it live, write it to disk, index the runs,
and never leak a credential doing so.

## Key files

| File | What |
|---|---|
| `packages/core/src/observability/recorder.ts` | `ReportRecorder`, `ExecutionNode`, `ExecutionEvent`, `around`, `meta`, `currentMeta`, `capture`, `markError` |
| `packages/core/src/observability/report.ts` | `writeReport`, the `runs.jsonl` ledger, index rendering, HTML |
| `packages/core/src/observability/logger.ts` | `consoleLogger` — indented live tree |
| `packages/core/src/observability/redact.ts` | `redactSecrets`, `RedactConfig`, `resolveRedact` |

## Public API

`redactSecrets`, types `RedactConfig`, `ExecutionEvent`, `ExecutionNode`,
`ExecutionKind`, `ReportOptions`, `LogConfig`, plus `ctx.meta()` and
`inv.meta()`.

## Depends on

01 (one recorder per run). Everything else depends on *it*.

## Invariants

- **R-12 — one recorder per run.** It used to be a module singleton, which is
  why concurrent runs mixed their trees.
- **R-14 — inactive when nobody is watching**: `active` is false, `around` just
  runs the function with a hollow node, `meta`/`capture` are no-ops.
- **Parenthood comes from an `AsyncLocalStorage` frame**, which is what keeps
  nesting correct inside `parallel`.
- **`ExecutionEvent` carries `runId`.** Without it a consumer receiving events
  from concurrent runs cannot separate them — this is exactly how Flow used to
  scramble two runs.
- **`meta` vs `capture`:** `meta` is structured telemetry — never truncated,
  independent of `captureContent`. `capture` is content — truncated at 20 000
  chars and gated by `captureContent`. Keeping them separate is what makes
  telemetry measurable without regex.
- **R-15 — telemetry must not make two different things look the same.**
- **Content capture only happens when someone will read it**: report on, or
  `log: "verbose"`, or a plugin with `onEvent`. `report: { content: false }`
  turns it off even with report on.
- **Redaction is on by default** (ADR-013) and applied to prompt, response, tool
  I/O and **error messages** — a DB driver error carries the whole connection
  string. `redactSecrets` is idempotent: `[REDACTED]` matches no pattern.
- **Patterns are deliberately specific.** A greedy pattern would mask legitimate
  text and make the report useless, which is the easiest way to get people to
  turn the protection off.
- **Redaction does not cover PII.** No regex for a name or an address.
- **Listeners are isolated** — a throwing listener affects neither the run nor
  other listeners.
- **Report writing is synchronous** (it runs in the recorder's synchronous
  `onComplete`); **index rendering is not** (ADR-014). One worker per folder
  coalesces a burst of runs into a single render. Index writes go to a temp
  file then `rename` — atomic.
- **`app.dispose()` drains pending index writes**, otherwise reading
  `index.html` right after dispose shows the previous version.
- Node ids are a plain counter, not `randomUUID` — they are local to one tree.
  `runId` remains a UUID.

## Dangerous

- The ledger grows without bound and every render re-reads it. Known, measured,
  tested — do not "discover" it as a bug.
- A corrupt ledger line must not break rendering (tested).
- Reports go to `report/<runId>/` **relative to the process CWD** by default.
- `redact.ts` regexes carry the `g` flag and are reused — `lastIndex` is reset
  before each use. Removing that reset causes intermittent misses.
- The named-field pattern has a lookahead preventing double-masking of
  `Bearer`/`Basic`.
- Report HTML labels and verbose log labels are still Portuguese.

## Tests

`report.test.ts` (11) · `ledger-do-report.test.ts` (6) · `redact.test.ts` (9) ·
`observation.test.ts` (13) · `isolation.test.ts` · `performance.test.ts`
(truncation)

## Safe to change

HTML rendering, logger formatting, adding a redaction pattern (add a test that
it does not damage legitimate text).

## Needs care

`around` control flow, the meta/capture split, `ExecutionEvent` shape (Flow
consumes it), the ledger/index concurrency dance.

## Relations

Written to by **02**, **05**, **06**, **07**; consumed by **10**. ADR-006,
ADR-013, ADR-014.
