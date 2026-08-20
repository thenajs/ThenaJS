import { ToolType, toFunctionTools } from "../tools/index.js";
import { Message, ProviderToolCall } from "../state/index.js";
import { Providers, ProviderCredentials, RawAssistant } from "./provider.js";
import { readLines } from "../http/index.js";
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
    signal?: AbortSignal,
    onToken?: (token: string) => void,
  ): Promise<RawAssistant> {
    const options = this.toOllamaOptions(sampling);
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toOllamaMessage(m)),
      tools: tools.length ? toFunctionTools(tools) : undefined,
      // O sink é o que liga o streaming: sem ninguém ouvindo, uma resposta só.
      stream: Boolean(onToken),
      // Sem sampling configurado, a chave nem existe — body idêntico ao default.
      options: Object.keys(options).length ? options : undefined,
      ...this.raw,
    };

    const { response, attempts } = await this.request(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama chat failed (${response.status}): ${detail}`);
    }

    const data = onToken
      ? await lerStreamOllama(response, onToken)
      : ((await response.json()) as OllamaChatResponse);

    const message = data?.message;

    // Normaliza eventuais tool calls nativas para { name, arguments }.
    const toolCalls: ProviderToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => typeof tc?.function?.name === "string")
      .map((tc) => ({
        name: tc.function!.name as string,
        arguments: tc.function?.arguments,
      }));

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
      throw new Error(`Ollama embed failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as any;
    return data?.embedding ?? [];
  }
}

/** O que o `/api/chat` do Ollama devolve, nos dois modos. */
interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
}

/**
 * Consome o NDJSON do Ollama, emitindo cada pedaço de text e juntando o turno.
 *
 * Cada line é um `OllamaChatResponse` parcial; a última traz `done: true` com
 * as contagens de token. As tool calls chegam inteiras numa line só — o Ollama
 * não as fragmenta, diferente da OpenAI.
 */
async function lerStreamOllama(
  response: Response,
  onToken: (token: string) => void,
): Promise<OllamaChatResponse> {
  type ToolCalls = NonNullable<OllamaChatResponse["message"]>["tool_calls"];

  let content = "";
  let toolCalls: ToolCalls;
  let final: OllamaChatResponse = {};

  for await (const line of readLines(response)) {
    let chunk: OllamaChatResponse;
    try {
      chunk = JSON.parse(line) as OllamaChatResponse;
    } catch {
      // Linha que não é JSON não deve derrubar a geração inteira.
      continue;
    }

    const text = chunk.message?.content;
    if (text) {
      content += text;
      onToken(text);
    }

    if (chunk.message?.tool_calls?.length) {
      toolCalls = chunk.message.tool_calls;
    }

    if (chunk.done) final = chunk;
  }

  return {
    ...final,
    message: { content: content, tool_calls: toolCalls },
  };
}
