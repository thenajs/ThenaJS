import z from "zod";
import { ToolType } from "../tools/index.js";
import { Message, ProviderToolCall } from "../state/index.js";
import { Providers, ProviderCredentials, RawAssistant } from "./provider.js";
import { SamplingParams, pruneUndefined } from "./sampling.types.js";

/**
 * Além dos campos abaixo, aceita tudo de `ProviderCredentials`: `sampling`
 * (vira `options` no /api/chat), `raw` (ex.: `keep_alive`, `format`,
 * `mirostat`), `rescueToolCalls` e `costPer1kTokens`.
 */
export type OllamaCredentials = ProviderCredentials & {
  host: string;
  model: string;
  embedModel?: string;
};

export class OllamaProvider extends Providers {
  private readonly host: string;
  private readonly model: string;
  private readonly embedModel: string;

  constructor(credentials: OllamaCredentials) {
    super();
    this.host = credentials.host.replace(/\/$/, "");
    this.model = credentials.model;
    this.embedModel = credentials.embedModel ?? credentials.model;
    this.configure(credentials);
  }

  // Traduz o shape neutro para as chaves de `options` do Ollama.
  private toOllamaOptions(sampling: SamplingParams = {}): Record<string, unknown> {
    return pruneUndefined({
      temperature: sampling.temperature,
      top_p: sampling.topP,
      top_k: sampling.topK,
      seed: sampling.seed,
      num_predict: sampling.maxTokens,
      num_ctx: sampling.numCtx,
      stop: sampling.stop,
      repeat_penalty: sampling.repeatPenalty,
    });
  }

  // Formato de tools nativo do Ollama (/api/chat), igual ao da OpenAI.
  private toTools(tools: ToolType[]) {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema),
      },
    }));
  }

  // Traduz um Message neutro para o formato de mensagem do Ollama.
  private toOllamaMessage(message: Message): Record<string, unknown> {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (message.role === "tool") {
      return { role: "tool", content: message.content, tool_name: message.toolName };
    }
    return { role: message.role, content: message.content };
  }

  protected async chatInternal(
    tools: ToolType[],
    messages: Message[],
    sampling?: SamplingParams,
  ): Promise<RawAssistant> {
    const options = this.toOllamaOptions(sampling);
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toOllamaMessage(m)),
      tools: tools.length ? this.toTools(tools) : undefined,
      stream: false,
      // Sem sampling configurado, a chave nem existe — body idêntico ao default.
      options: Object.keys(options).length ? options : undefined,
      ...this.raw,
    };

    const { response, attempts } = await this.request(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama chat falhou (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as any;
    const message = data?.message;

    // Normaliza eventuais tool calls nativas para { name, arguments }.
    const toolCalls: ProviderToolCall[] = (message?.tool_calls ?? []).map(
      (tc: any) => ({
        name: tc?.function?.name,
        arguments: tc?.function?.arguments,
      }),
    );

    return {
      content: message?.content ?? "",
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: {
        promptTokens: data?.prompt_eval_count,
        completionTokens: data?.eval_count,
      },
      attempts,
    };
  }

  public async embed(input?: string): Promise<number[]> {
    const { response } = await this.request(`${this.host}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.embedModel,
        prompt: input ?? "",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama embed falhou (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as any;
    return data?.embedding ?? [];
  }
}
