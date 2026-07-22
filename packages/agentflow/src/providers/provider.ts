import z from "zod";
import { ToolType } from "../tools/index.js";
import { parser } from "./utils/index.js";
import { Message, ToolCall } from "../state/index.js";

/** O que `chatInternal` (cada subclasse) devolve: a resposta crua do modelo. */
export interface RawAssistant {
    content: string;
    toolCalls?: ToolCall[];
}

/** O que o loop anexa ao history: o turno do modelo e, se houve, o turno da tool. */
export interface ChatTurn {
    assistant: Message;
    tool?: Message;
}

export interface ChatParams {
    tools: ToolType[];
    messages: Message[];
}

export class Providers {

    private extractors: ((input: string) => unknown)[] = [
        parser.parseAsJson,
        parser.parseAsMarkdownJson,
        parser.parseAsExtractedJson,
        parser.parseAsBalancedJson,
    ];

    private tool_call = z.object({
        name: z.string(),
        arguments: z.unknown(),
    });

    public async chat({ tools, messages }: ChatParams): Promise<ChatTurn> {
        const raw = await this.chatInternal(tools, messages);
        const content = parser.stripThinkTags(raw.content);

        // tool call: usa o nativo quando o provider o trouxe; senão, tenta
        // extrair do texto (fallback p/ modelos locais que emitem JSON no content).
        const call = raw.toolCalls?.[0] ?? this.extractToolCall(content, tools);

        const assistant: Message = {
            role: "assistant",
            content,
            // 1 por turno (sem parallel tool calls): o assistant fica com o mesmo
            // call que respondemos, preservando o pareamento exigido pela API.
            toolCalls: call ? [call] : undefined,
        };

        if (!call) {
            return { assistant };
        }

        // Execução da tool continua no provider (decisão estratégica: evita ifs no agente).
        const tool = tools.find(t => t.name === call.name);
        const result = tool
            ? await tool.execute(tool.schema.parse(call.arguments))
            : `Tool '${call.name}' não encontrada.`;

        const toolMessage: Message = {
            role: "tool",
            content: result,
            toolName: call.name,
            toolCallId: call.id,
        };

        return { assistant, tool: toolMessage };
    }

    // Fallback: extrai uma tool call do texto do modelo (parsing separado da execução).
    private extractToolCall(content: string, tools: ToolType[]): ToolCall | null {
        for (const extract of this.extractors) {
            try {
                const payload = extract(content);
                const base = this.tool_call.parse(payload);

                const tool = tools.find(t => t.name === base.name);
                if (!tool) continue;

                return { id: `call_${Date.now()}`, name: base.name, arguments: base.arguments };
            } catch {
                // tenta a próxima estratégia
            }
        }
        return null;
    }

    protected chatInternal(_tools: ToolType[], _messages: Message[]): Promise<RawAssistant> {
        return Promise.resolve({ content: "" });
    }

    protected embed(_input?: string): Promise<number[]> {
        return Promise.resolve([]);
    }

}
