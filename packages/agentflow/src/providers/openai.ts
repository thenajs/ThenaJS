import { ToolType, toFunctionTools } from "../tools/index.js";
import { Message, ProviderToolCall } from "../state/index.js";
import { Providers, ProviderCredentials, RawAssistant } from "./provider.js";
import { readSse } from "../http/index.js";
import { SamplingParams, pruneUndefined } from "./sampling.types.js";

/**
 * Além dos campos abaixo, aceita tudo de `ProviderCredentials`. Note que
 * `sampling.topK`, `sampling.numCtx` e `sampling.repeatPenalty` não têm
 * equivalente nesta API e são ignorados — use `raw` se precisar
 * (ex.: `response_format`, `user`).
 */
export type OpenAICredentials = ProviderCredentials & {
  apiKey: string;
  host?: string;
  model?: string;
  embedModel?: string;
};

export class OpenAIProvider extends Providers {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly model: string;
  private readonly embedModel: string;

  constructor(credentials: OpenAICredentials) {
    super();
    this.apiKey = credentials.apiKey;
    this.host = (credentials.host ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = credentials.model ?? "gpt-4o-mini";
    this.embedModel = credentials.embedModel ?? "text-embedding-3-small";
    this.configure(credentials);
  }

  // Traduz o shape neutro para os campos top-level da Chat Completions.
  private toOpenAIParams(sampling: SamplingParams = {}): Record<string, unknown> {
    return pruneUndefined({
      temperature: sampling.temperature,
      top_p: sampling.topP,
      seed: sampling.seed,
      max_tokens: sampling.maxTokens,
      stop: sampling.stop,
    });
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  // Traduz um Message neutro para o formato de mensagem da OpenAI.
  private toOpenAIMessage(message: Message): Record<string, unknown> {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id ?? `call_${Date.now()}`,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }
    if (message.role === "tool") {
      // OpenAI exige tool_call_id ligando o resultado ao tool_call.
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  }

  protected async chatInternal(
    tools: ToolType[],
    messages: Message[],
    sampling?: SamplingParams,
    signal?: AbortSignal,
    onToken?: (token: string) => void,
  ): Promise<RawAssistant> {
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toOpenAIMessage(m)),
      tools: tools.length ? toFunctionTools(tools) : undefined,
      tool_choice: tools.length ? "auto" : undefined,
      ...this.toOpenAIParams(sampling),
      // O sink é o que liga o streaming. `include_usage` é necessário porque,
      // com `stream: true`, a OpenAI só manda o usage se pedirem — e sem ele o
      // orçamento por tokens ficaria cego.
      ...(onToken ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...this.raw,
    };

    const { response, attempts } = await this.request(`${this.host}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI chat failed (${response.status}): ${detail}`);
    }

    const bruto = onToken
      ? await lerStreamOpenAI(response, onToken)
      : reduzirResposta((await response.json()) as OpenAIChatResponse);

    return {
      content: bruto.content,
      toolCalls: bruto.toolCalls.length ? bruto.toolCalls : undefined,
      usage: bruto.usage,
      attempts,
    };
  }

  public async embed(input?: string): Promise<number[]> {
    const { response } = await this.request(`${this.host}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.embedModel,
        input: input ?? "",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI embed failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as any;
    return data?.data?.[0]?.embedding ?? [];
  }
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------- leitura da resposta ----------

interface RawOpenAIToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIChatResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: RawOpenAIToolCall[] };
    delta?: { content?: string | null; tool_calls?: RawOpenAIToolCall[] };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface Assistente {
  content: string;
  toolCalls: ProviderToolCall[];
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
  };
}

/** Normaliza a resposta completa (sem streaming). */
function reduzirResposta(data: OpenAIChatResponse): Assistente {
  const message = data?.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    toolCalls: normalizarToolCalls(message?.tool_calls ?? []),
    usage: lerUsage(data?.usage),
  };
}

/** O usage da OpenAI, no shape neutro. */
function lerUsage(u: OpenAIChatResponse["usage"]): Assistente["usage"] {
  return {
    promptTokens: u?.prompt_tokens,
    completionTokens: u?.completion_tokens,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens,
  };
}

function normalizarToolCalls(brutas: RawOpenAIToolCall[]): ProviderToolCall[] {
  return brutas
    .filter((tc) => typeof tc.function?.name === "string")
    .map((tc) => ({
      id: tc.id,
      name: tc.function!.name as string,
      arguments: safeParse(tc.function?.arguments),
    }));
}

/**
 * Consome o SSE da OpenAI, emitindo cada pedaço de texto e remontando o turno.
 *
 * A parte delicada são as tool calls: diferente do Ollama, elas chegam
 * **fragmentadas**. O `name` vem num chunk e o `arguments` em vários,
 * caractere a caractere, e o que amarra os pedaços é o `index` — o `id` só
 * aparece no primeiro. Concatenar por ordem de chegada quebraria com mais de
 * uma tool call no mesmo turno.
 */
async function lerStreamOpenAI(
  response: Response,
  onToken: (token: string) => void,
): Promise<Assistente> {
  let content = "";
  let usage: Assistente["usage"] = {};
  const porIndice = new Map<number, RawOpenAIToolCall>();

  for await (const payload of readSse(response)) {
    let pedaco: OpenAIChatResponse;
    try {
      pedaco = JSON.parse(payload) as OpenAIChatResponse;
    } catch {
      // Payload que não é JSON não deve derrubar a geração inteira.
      continue;
    }

    if (pedaco.usage) usage = lerUsage(pedaco.usage);

    const delta = pedaco.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      onToken(delta.content);
    }

    for (const fragmento of delta.tool_calls ?? []) {
      const i = fragmento.index ?? 0;
      const acumulado = porIndice.get(i) ?? { index: i, function: {} };

      if (fragmento.id) acumulado.id = fragmento.id;
      if (fragmento.function?.name) {
        acumulado.function!.name = fragmento.function.name;
      }
      if (fragmento.function?.arguments) {
        acumulado.function!.arguments =
          (acumulado.function!.arguments ?? "") + fragmento.function.arguments;
      }

      porIndice.set(i, acumulado);
    }
  }

  return {
    content,
    toolCalls: normalizarToolCalls(
      [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc),
    ),
    usage,
  };
}
