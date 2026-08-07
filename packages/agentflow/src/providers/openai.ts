import { ToolType, toFunctionTools } from "../tools/index.js";
import { Message, ProviderToolCall } from "../state/index.js";
import { Providers, ProviderCredentials, RawAssistant } from "./provider.js";
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
  ): Promise<RawAssistant> {
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toOpenAIMessage(m)),
      tools: tools.length ? toFunctionTools(tools) : undefined,
      tool_choice: tools.length ? "auto" : undefined,
      ...this.toOpenAIParams(sampling),
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
      throw new Error(`OpenAI chat falhou (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as any;
    const message = data?.choices?.[0]?.message;

    // Normaliza eventuais tool calls nativas para { id, name, arguments }.
    const toolCalls: ProviderToolCall[] = (message?.tool_calls ?? []).map(
      (tc: any) => ({
        id: tc?.id,
        name: tc?.function?.name,
        arguments: safeParse(tc?.function?.arguments),
      }),
    );

    return {
      content: message?.content ?? "",
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
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
      throw new Error(`OpenAI embed falhou (${response.status}): ${detail}`);
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
