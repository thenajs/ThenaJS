# Truth hierarchy and anti-drift protocol

Two things live here: **how to resolve a contradiction** between sources, and
**how to change an architectural decision**. Both exist because the failure they
prevent is silent.

---

## 1. The hierarchy

When two sources disagree about what this system does, they rank like this:

| # | Source | Why it ranks here |
|---|---|---|
| 1 | **The passing test suite** | Executable. Cannot rot. 501 tests, ~1s. |
| 2 | **Source code in `packages/*/src`** | What actually ships. |
| 3 | **`DECISIONS.md`** | The *why*, which code cannot carry. Ranks above comments because it is curated and dated. |
| 4 | **Header comments in source files** | In this repo they are unusually good — they name rejected alternatives. Rank below code only because code can be edited without them. |
| 5 | **`docs/` (the VitePress site)** | Reviewed, CI-validated for parity and links. Can lag the code. |
| 6 | **`README.md`, `ROADMAP.md`, `CONTRIBUTING.md`** | **Demonstrably stale.** See CURRENT_STATE.md for the specific proven errors. Treat as historical. |
| 7 | **The current conversation** | Including your own earlier statements in this session. |

Note the gap between 5 and 6. `docs/` is maintained; the root markdown files
are not. This is measured, not assumed — CURRENT_STATE.md lists the exact
falsehoods.

---

## 2. Resolving a conflict

**You may not pick a source and move on.** That is how a wrong belief gets
written into code.

```
Found a contradiction
        │
        ├─ Can a test settle it?  ──yes──▶  Write the test. Run it.
        │                                    The result is now truth (rank 1).
        │                                    Then fix whichever source was wrong.
        │
        ├─ Is it about intent, not behaviour?
        │       (e.g. "should this be public?")
        │       ──▶ Check DECISIONS.md. If silent, ASK. Do not infer intent
        │           from code shape.
        │
        └─ Is the lower-ranked source simply stale?
                ──▶ Say so explicitly in your response. Fix it only if it is
                    in scope; otherwise report it.
```

Always **state the contradiction out loud** in your response, even after
resolving it. A conflict you silently resolved is a conflict the user never
learns about.

---

## 3. Anti-drift

Architecture drift here does not arrive as a bad decision. It arrives as a
small, locally reasonable convenience. The specific sentence to distrust in
your own reasoning:

> "It would be simpler / easier / cleaner to do it this way."

Simplicity is a real argument, but not against a decision that was made *for a
reason you have not yet read*. This codebase is dense with choices that look
wrong until you read the comment two lines above them.

### The protocol

If your plan contradicts a recorded decision, a documented invariant, or an
explicit code comment:

1. **Identify it.** Name the decision (ADR id) or the invariant (rule id) or
   quote the comment. If you cannot name what you are contradicting, you have
   not finished investigating.
2. **Explain the contradiction.** What the existing decision buys, and what
   your change would cost. Be specific: which test, which behaviour, which
   caller.
3. **Propose a new decision.** Draft the ADR — context, decision, consequences,
   and what it supersedes.
4. **Wait for approval.** Only then change the architecture.

You may not skip to step 4 because the change is small. Small changes are how
drift happens; large ones get reviewed.

### Signals you are drifting

- You are about to reorder something and the order "doesn't look meaningful".
  In this repo, **middleware order is semantic** (RULES.md R-05).
- You are about to rename something whose name looks wrong. Some names *are*
  wrong (CURRENT_STATE.md lists them) — and they are public API.
- You are about to delete something marked `@deprecated`.
- You are about to move a file to a "better" location. Two filenames in
  `decorators/` are load-bearing (RULES.md R-04).
- You are about to make a default "more helpful". Several defaults here are
  deliberately off (`contextWindow`, `retry.timeoutMs`, observation) and the
  reasons are recorded.
- A test is in your way and you are considering editing its assertion.

---

## 4. What counts as done

A change is done when all four hold:

1. `npm run lint && npm run format:check && npm test && npm run typecheck` is
   clean.
2. No existing test assertion was edited (or, if one was, you flagged that
   behaviour changed and got agreement).
3. Every invariant in RULES.md that touches your domain still holds — you
   checked, you did not assume.
4. Memory was updated **only** where CLAUDE.md's trigger table says it should
   be.

Reporting "done" without (1) actually run is the single worst failure mode
available to you here, because it is the one the user cannot cheaply detect.
