import z from "zod";
import { ToolType } from "../tools/index.js";
import { Message, ToolCall } from "../state/index.js";
import { Providers, RawAssistant, TokenCost } from "./provider.js";
import { SamplingParams, pruneUndefined } from "./sampling.types.js";

export type OpenAICredentials = {
    apiKey: string;
    host?: string;
    model?: string;
    embedModel?: string;
    /**
     * Parâmetros de amostragem padrão. `topK`, `numCtx` e `repeatPenalty` não
     * têm equivalente na API e são ignorados aqui — use `raw` se precisar.
     */
    sampling?: SamplingParams;
    /** Chaves cruas mescladas no body (ex.: `response_format`, `user`). */
    raw?: Record<string, unknown>;
    /**
     * Resgatar tool calls emitidas como texto (default: `true`). `false` deixa
     * o texto virar resposta final — útil para expor que o modelo não está
     * usando o formato nativo, em vez de mascarar.
     */
    rescueToolCalls?: boolean;
    /** Preço por 1k tokens, para o `costUsd` do usage e o orçamento da run. */
    costPer1kTokens?: TokenCost;
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
        this.sampling = credentials.sampling ?? {};
        this.raw = credentials.raw ?? {};
        this.rescueToolCalls = credentials.rescueToolCalls ?? true;
        this.costPer1kTokens = credentials.costPer1kTokens;
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
            "Authorization": `Bearer ${this.apiKey}`,
        };
    }

    // Formato de tools nativo da OpenAI (Chat Completions).
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

    // Traduz um Message neutro para o formato de mensagem da OpenAI.
    private toOpenAIMessage(message: Message): Record<string, unknown> {
        if (message.role === "assistant" && message.toolCalls?.length) {
            return {
                role: "assistant",
                content: message.content || null,
                tool_calls: message.toolCalls.map((call) => ({
                    id: call.id ?? `call_${Date.now()}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
                })),
            };
        }
        if (message.role === "tool") {
            // OpenAI exige tool_call_id ligando o resultado ao tool_call.
            return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
        }
        return { role: message.role, content: message.content };
    }

    protected async chatInternal(
        tools: ToolType[],
        messages: Message[],
        sampling?: SamplingParams,
    ): Promise<RawAssistant> {
        const body = {
            model: this.model,
            messages: messages.map((m) => this.toOpenAIMessage(m)),
            tools: tools.length ? this.toTools(tools) : undefined,
            tool_choice: tools.length ? "auto" : undefined,
            ...this.toOpenAIParams(sampling),
            ...this.raw,
        };

        const response = await fetch(`${this.host}/chat/completions`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`OpenAI chat falhou (${response.status}): ${detail}`);
        }

        const data = (await response.json()) as any;
        const message = data?.choices?.[0]?.message;

        // Normaliza eventuais tool calls nativas para { id, name, arguments }.
        const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: any) => ({
            id: tc?.id,
            name: tc?.function?.name,
            arguments: safeParse(tc?.function?.arguments),
        }));

        return {
            content: message?.content ?? "",
            toolCalls: toolCalls.length ? toolCalls : undefined,
            usage: {
                promptTokens: data?.usage?.prompt_tokens,
                completionTokens: data?.usage?.completion_tokens,
            },
        };
    }

    protected async embed(input?: string): Promise<number[]> {
        const response = await fetch(`${this.host}/embeddings`, {
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
