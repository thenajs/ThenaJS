# Domain: Providers & transport

Everything that speaks to a model or to any HTTP service.

## Responsibility

Translate neutral `Message[]`/`ToolType[]` into a vendor API and back; run the
HTTP call with retry and timeout; decide native vs rescued tool call; validate
arguments; execute the tool; compute cost.

## Key files

| File | What |
|---|---|
| `packages/agentflow/src/providers/provider.ts` | `Providers` base — `chat`, `withCost`, `executarTool`, `extractToolCall`, `chatInternal`, `embed` |
| `packages/agentflow/src/providers/openai.ts` | OpenAI Chat Completions + SSE streaming |
| `packages/agentflow/src/providers/ollama.ts` | Ollama `/api/chat` + NDJSON streaming |
| `packages/agentflow/src/providers/retry.ts` | Policy, backoff with full jitter, `Retry-After`, `sleep` |
| `packages/agentflow/src/providers/sampling.types.ts` | `SamplingParams` (neutral), `pruneUndefined` |
| `packages/agentflow/src/providers/utils/parsers.ts` | JSON extraction strategies, `stripThinkTags` |
| `packages/agentflow/src/providers/utils/tool-call.ts` | `normalizeToolCallEnvelope` |
| `packages/agentflow/src/http/transport.ts` | `HttpTransport.request` — the shared retry/timeout base |
| `packages/agentflow/src/http/stream.ts` | `readLines` (NDJSON), `readSse` |
| `packages/agentflow/src/tools/json-schema.ts` | Memoized `z.toJSONSchema`, `toFunctionTools` |
| `packages/agentflow/src/tools/tools.types.ts` | `ToolType`, `ToolOutput`, `toToolOutput` |

## Public API

`Providers`, `OllamaProvider`, `OpenAIProvider`, `HttpTransport`,
`toToolOutput`, `parser`, `normalizeToolCallEnvelope`, `pruneUndefined`, and
types `ChatParams`, `RawAssistant`, `ChatTurn`, `Usage`, `TokenCost`,
`ProviderCredentials`, `TransportCredentials`, `RetryPolicy`, `RetryAttempt`,
`SamplingParams`, `ToolType`, `ToolOutput`, `ProviderToolCall`.

## Depends on

03 (`Message`), nothing in core. **R-01 applies.**

## Invariants

- **`chatInternal` is the only method a subclass must implement.** The base
  handles think-tag stripping, native-vs-rescued decision, schema validation,
  tool execution and cost. Its last two parameters (`signal`, `onToken`) are
  optional and additive — a provider ignoring them still compiles and works.
- **R-03 — the provider executes the tool** (ADR-003).
- **The presence of `onToken` is what enables streaming.** No sink, no stream.
  This is how R-14's zero-cost path reaches the network layer.
- **Call sampling overrides provider sampling key by key**
  (`{ ...this.sampling, ...sampling }`).
- **Schema-invalid arguments become an observation, never an exception** — the
  most recoverable failure there is. The message states when the call was
  rescued from text, because otherwise a bad rescue is indistinguishable from a
  tool bug.
- **Whatever `tool.execute` throws propagates.** The engine has no policy about
  it; core decides (ADR-007).
- **Tool-call rescue only accepts a name matching a registered tool** — that is
  what stops arbitrary JSON in a response from becoming a call. Extractors run
  most-specific → most-permissive; the greedy regex is last.
- **At most one tool call per turn.**
- `toJsonSchema` is memoized in a `WeakMap` keyed by the **schema object**, not
  the tool: the tool object is rebuilt every turn to inject context, but its
  `schema` is the same instance. Keying by tool would cache nothing.
- **Retry (ADR-019):** on by default, 3 attempts, exponential backoff with full
  jitter, honours `Retry-After`. `timeoutMs` has **no** default. Contract errors
  (400/401/403/404) are not retried. **Aborts are never retried.**
- **Abort errors propagate as-is** from `request()`, never wrapped — that
  preserves `TimeoutError` vs `AbortError` vs a custom `abort(reason)`.
- **The attempt counter is returned, not stored on the instance** — one provider
  instance is shared by the agents of a `parallel` block, so mutable `this`
  would race.
- Caller `signal` and policy timeout are **composed** (`AbortSignal.any`), not
  `??`-ed. The backoff `sleep` is abortable.
- `readLines` handles both split lines and split multi-byte characters
  (`TextDecoder({ stream: true })` plus a remainder buffer).
- Cost: cached tokens are billed at the normal input rate unless `cachedInput`
  is configured — erring high on purpose (ADR-018).

## Dangerous

- `stripThinkTags` once erased whole responses on similar-prefix tags
  (`<thinker>`, `<thoughts>`). That is a real past bug with a regression test —
  read `parsers.test.ts` before touching it.
- OpenAI streaming reassembles fragmented tool calls; **`index` is what binds
  fragments, not arrival order**. Pinned by test.
- A corrupt line in a stream must not kill generation. Pinned by test.
- OpenAI requires `tool_call_id` pairing assistant and tool messages.
- With `stream: true` OpenAI only sends usage if `stream_options:
  { include_usage: true }` is set — without it, token budgeting goes blind.
- `provider.ts:190,249` still emit Portuguese, and those strings reach the model
  (CURRENT_STATE.md).
- `topK`, `numCtx`, `repeatPenalty` are silently dropped by OpenAI. Documented,
  not enforced.

## Tests

`parsers.test.ts` · `tool-call.test.ts` · `retry.test.ts` · `stream.test.ts` ·
`streaming.test.ts` (both vendors) · `json-schema.test.ts` ·
`resolucao.test.ts` · `tool-failures.test.ts`

## Safe to change

Parser strategies (well tested), retry constants, adding a new provider
subclass.

## Needs care

`Providers.chat` control flow, the rescue path, streaming reassembly,
`request()` retry loop.

## Relations

Called by **02** through the chat chain in **06**; counted by **07**; recorded
by **08**; `HttpTransport` shared with **09**. ADR-003, ADR-018, ADR-019.
