# CLAUDE.md

The agent context system for this repository lives in **[`.claude/`](.claude/)**.

**Start here: [`.claude/CLAUDE.md`](.claude/CLAUDE.md)** — the operating manual.
Read it before your first tool call.

| File | What |
|---|---|
| [`.claude/CLAUDE.md`](.claude/CLAUDE.md) | How to work here: domain map, investigation, verification, what is forbidden |
| [`.claude/TRUTH.md`](.claude/TRUTH.md) | Source-of-truth hierarchy and the anti-drift protocol |
| [`.claude/RULES.md`](.claude/RULES.md) | Invariants, how to verify each, and which have no test |
| [`.claude/ARCHITECTURE.md`](.claude/ARCHITECTURE.md) | Layers, execution flow, boundaries, extension points |
| [`.claude/DECISIONS.md`](.claude/DECISIONS.md) | 20 ADRs — do not revert one without following the protocol |
| [`.claude/CURRENT_STATE.md`](.claude/CURRENT_STATE.md) | What is green, what is broken, what must not be touched |
| [`.claude/WORKFLOW.md`](.claude/WORKFLOW.md) | INVESTIGATE → PLAN → IMPLEMENT → TEST → AUDIT → UPDATE MEMORY |
| [`.claude/domains/`](.claude/domains/) | 11 domain files — responsibility, invariants, dangers, tests |

Framework documentation for **users** is not here: it is the VitePress site in
the `docs/` submodule (bilingual, 71 pages per language). See ADR-020.

Two things to know before touching anything:

1. `npm test` is 501 tests in about a second. Run it first — it is the only
   claim about this repo that cannot be out of date.
2. `git status` shows ` M docs`. That is a **git submodule pointer with
   uncommitted work**. Never reset, checkout or `submodule update` it.
