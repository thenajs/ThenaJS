# Working procedure

The loop to run for any change to this repository. Each stage has an exit
condition; do not advance without meeting it.

```
INVESTIGATE ──▶ PLAN ──▶ IMPLEMENT ──▶ TEST ──▶ AUDIT ──▶ UPDATE MEMORY
     ▲                                            │
     └────────── contradiction found ─────────────┘
```

---

## 1. INVESTIGATE

**Goal:** know what exists before proposing what should exist.

```bash
npm test                                   # ground truth, ~1s
grep -rn "<symbol>" packages/*/src packages/*/test
```

- Read `CURRENT_STATE.md` — is this area broken, frozen, or untested?
- Identify the domain(s) via the map in `CLAUDE.md`; read those files.
- Read the **header comment** of every file you intend to change. This codebase
  records the rejected alternative at the point of decision.
- Check `DECISIONS.md` for the area.
- Determine whether the symbol is in `packages/core/src/index.ts` (public).

**Exit condition:** you can name (a) the affected domains, (b) the tests that
pin the current behaviour, (c) any rule or ADR in the way.

**Do not** start editing during this stage, no matter how obvious the fix is.

---

## 2. PLAN

**Goal:** a plan that survives contact with the invariants.

- Walk RULES.md for your domain. For each rule that touches the change, state
  how it still holds.
- Determine blast radius. Change one of `RunContext`, `Providers.chat`, the
  chain builders, or `resolveCallerFile` and assume everything is affected.
- Decide whether behaviour changes. If yes: it needs a `CHANGELOG.md` entry,
  possibly a minor bump, and it is not a refactor (R-22).
- **If the plan contradicts a recorded decision, stop.** Run the anti-drift
  protocol in TRUTH.md and wait for approval.

**Exit condition:** you can state, in one sentence each, what changes, what
must not change, and how you will prove the second part.

---

## 3. IMPLEMENT

**Goal:** the smallest change that does the whole job.

- Match surrounding style: comments explain *why* and name the rejected
  alternative; error messages name the class, the parameter and the fix; errors
  are `Error`s prefixed `[thena]`.
- Do not touch anything the task did not ask for. A tempting adjacent fix is a
  separate report, not a separate edit.
- Do not add dependencies.
- If a test blocks you, that is a signal to re-enter INVESTIGATE, not to edit
  the assertion.

**Exit condition:** the change is complete — not "the easy part is done".

---

## 4. TEST

**Goal:** evidence, not confidence.

```bash
npx vitest run packages/<pkg>/test/<file>.test.ts    # fast loop
npm test                                             # full, ~1s
```

- New behaviour needs a test. Test through the public API, using the
  `FakeProvider` harness at `packages/core/test/harness.ts` (R-23).
- Fixed a bug? Write the test that fails before the fix and passes after. Run
  it against the old code to confirm it actually catches the bug.
- Never build in order to test (R-21).

**Exit condition:** full suite green, and you can point at the specific test
that would have caught the bug you fixed.

---

## 5. AUDIT

**Goal:** catch what tests cannot.

```bash
npm run lint && npm run format:check && npm test && npm run typecheck
```

Lint must be **0 errors**. `typecheck` is slow — run it once, here.

Then check by hand the things no tool checks:

- [ ] Did an unenforced rule get broken? **R-22** and **R-23** are the two no
      tool can check. (R-01, R-02, R-04 and R-18 are covered by
      `architecture.test.ts` — if you tripped one, the suite already told you.)
- [ ] Did the public surface of `packages/core/src/index.ts` change?
- [ ] Did any existing test assertion change? If yes, behaviour changed.
- [ ] Did middleware order change?
- [ ] Is `git status` still showing only the changes you intended — and is
      ` M docs` still untouched?
- [ ] Anything you left undone or deliberately skipped?

**Exit condition:** all four commands clean, every box checked, and you are
ready to say plainly what you did and did not do.

---

## 6. UPDATE MEMORY

**Goal:** keep the next session from re-deriving what you just learned —
without bloating these files.

Default is **update nothing**. Triggers only:

| What happened | Update |
|---|---|
| A decision was made that constrains future work | `DECISIONS.md` — new ADR, and mark what it supersedes |
| An invariant was created or removed | `RULES.md` — with its *Guarded by* status |
| Something on the broken list got fixed, or something new broke | `CURRENT_STATE.md` |
| A domain's API, dangers or dependencies changed | that domain file |
| The layering, execution flow or a boundary moved | `ARCHITECTURE.md` |

Rules for editing these files:

- **Edit in place.** Never append a session log.
- Keep `CURRENT_STATE.md` a snapshot, not a history. Delete what is no longer
  current.
- Do not restate framework documentation. Link to `docs/` instead (ADR-020).
- Every rule needs a *how to verify*. A rule that cannot be checked is prose.

---

## Reporting back

State plainly:

1. What changed, by file.
2. The verification you actually ran, with results. If you did not run
   something, say so — do not imply it.
3. What you found but did not fix, and why.
4. Which memory files you updated, and which you deliberately did not.

If a check failed, lead with that. A green report that hides a red check is the
most expensive thing you can produce here, because it is the one the user
cannot cheaply detect.
