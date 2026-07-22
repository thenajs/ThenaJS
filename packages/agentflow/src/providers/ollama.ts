import z from "zod";
import { ToolType } from "../tools/index.js";
import { Message, ToolCall } from "../state/index.js";
import { Providers, RawAssistant } from "./provider.js";

export type OllamaCredentials = {
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

    protected async chatInternal(tools: ToolType[], messages: Message[]): Promise<RawAssistant> {
        const body = {
            model: this.model,
            messages: messages.map((m) => this.toOllamaMessage(m)),
            tools: tools.length ? this.toTools(tools) : undefined,
            stream: false,
        };

        const response = await fetch(`${this.host}/api/chat`, {
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
        const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: any) => ({
            name: tc?.function?.name,
            arguments: tc?.function?.arguments,
        }));

        return {
            content: message?.content ?? "",
            toolCalls: toolCalls.length ? toolCalls : undefined,
        };
    }

    protected async embed(input?: string): Promise<number[]> {
        const response = await fetch(`${this.host}/api/embeddings`, {
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
