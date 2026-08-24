# Domain: Vector memory

Long-term, semantic memory. Distinct from the two other things called "memory".

## Three different "memory"s — get this right first

| Thing | What it is | Lifetime |
|---|---|---|
| `ThenaConfig.stores` | The **databases** (`VectorStoreCtor[]`). Renamed from `memory` precisely because of this collision. | app |
| `VectorMemory` (`@memory()`) | Semantic search: `remember` / `recall` / `forget`. | app |
| `run({ state })` | Seeds the three buckets. `tasks` and `memory` are projected into the `system` message. **The model reads them.** | run |
| `ctx.state.memory` | The `string[]` bucket behind the above. | run |

Working memory is `run({ state }).memory`; long-term memory is `@memory()`.

## Key files

| File | What |
|---|---|
| `packages/agentflow/src/vector/vector-store.ts` | `VectorStore` abstract base, `ensureCollectionOnce` |
| `packages/agentflow/src/vector/memory.ts` | `VectorMemory` — `remember`, `rememberMany`, `recall`, `forget` |
| `packages/agentflow/src/vector/vector.types.ts` | Credentials, document, match, search, selector types |
| `packages/qdrant-client/src/qdrant.store.ts` | The Qdrant implementation |
| `packages/core/src/di/resolve.ts` | `resolveMemory` — builds one `VectorMemory` per store |
| `packages/core/src/settings.ts` | Where the store instances live in `RunContext` |

## Public API

`VectorStore`, `VectorMemory`, `QdrantStore`, and the types `VectorStoreCtor`,
`VectorStoreCredentials`, `VectorDocument`, `VectorMatch`, `VectorSearch`,
`VectorSelector`, `VectorDistance`, `CollectionOptions`, `RecallHit`,
`RecallOptions`, `RememberOptions`, `ForgetSelector`, `VectorMemoryOptions`.

## Depends on

05 (`HttpTransport`, and `provider.embed()`), 04 (`@memory` injection), 01
(stores live in `RunContext.settings`).

## Invariants

- **R-20 — one store instance per app**, created in `Thena.create` and shared by
  every agent: one connection and one `ensureCollection` per store regardless of
  agent count.
- **`ensureCollectionOnce` is memoized on the store instance.** A second agent
  asking for a different dimension **fails there**, before spending an embedding
  and before the database's own opaque error pointing at the `upsert`. One
  collection holds one vector size.
- **R-19 — `ThenaConfig.stores` order is a positional contract.** Without
  `@memory(Store)`, memories are injected in array order, and TypeScript cannot
  catch a reorder — the parameters have the same type. **Append at the end,
  never in the middle.**
- **Embeddings come from the agent's own provider** (`provider.embed()`), which
  is public and accepts `embedModel`. There is no separate embedding config.
- **Dimensions are derived from the produced vector**, not configured — nobody
  should have to know that `nomic-embed-text` is 768.
- **`dataset` partitions contexts** via a payload field, not via collections
  (ADR-016). `recall({ dataset: null })` searches all; omitted uses the default;
  a string filters.
- **The dataset field name is read off the store** (`store.datasetField`), so an
  implementation may rename it.
- `rememberMany` does one embed per item and a single `upsert`.
- `VectorStore` extends `HttpTransport`, so a custom store inherits retry and
  timeout for free — call `configureTransport(credentials)` in the constructor.
- Providers that cannot embed return `[]` (the base-class default).
- Qdrant: floor is **1.10** (unified `/points/query`); the partition index uses
  the abbreviated `field_schema` form because the object form does not exist in
  1.10.

## Dangerous

- Reordering `ThenaConfig.stores` silently rewires every agent.
- `resolveMemory` reads `currentRun().settings` — only valid inside the run
  scope.
- `@memory(Store)` matches by `instanceof`, so a store subclass matches its
  parent's selector. `FakeVectorStoreB extends FakeVectorStore` in the test
  harness exists for exactly this.
- `packages/qdrant-client` has **zero tests**.

## Tests

`vector-memory.test.ts` (7). `FakeVectorStore` / `FakeVectorStoreB` live in
`packages/core/test/harness.ts`. Nothing covers Qdrant itself.

## Safe to change

Adding a new `VectorStore` implementation; `RecallOptions` additions that
default to today's behaviour.

## Needs care

`ensureCollectionOnce` memoization, injection order, the `dataset` filter
composition in `recall`/`forget`.

## Relations

**04** injects it; **05** supplies embeddings and transport. ADR-016.
