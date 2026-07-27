import { ToolType, toToolOutput } from "../tools/index.js";
import { normalizeToolCallEnvelope, parser } from "./utils/index.js";
import { Message, ToolCall } from "../state/index.js";
import { SamplingParams } from "./sampling.types.js";

/** Consumo de uma chamada ao modelo, quando o provider o reporta. */
export interface Usage {
    promptTokens?: number;
    completionTokens?: number;
    /** Só preenchido quando o provider tem `costPer1kTokens` configurado. */
    costUsd?: number;
}

/** Preço por 1k tokens, informado por quem configura o provider. */
export interface TokenCost {
    input?: number;
    output?: number;
}

/** O que `chatInternal` (cada subclasse) devolve: a resposta crua do modelo. */
export interface RawAssistant {
    content: string;
    toolCalls?: ToolCall[];
    usage?: Usage;
}

/** O que o loop anexa ao history: o turno do modelo e, se houve, o turno da tool. */
export interface ChatTurn {
    assistant: Message;
    tool?: Message;
    usage?: Usage;
}

export interface ChatParams {
    tools: ToolType[];
    messages: Message[];
    /** Sampling desta chamada; sobrescreve chave a chave o do provider. */
    sampling?: SamplingParams;
}

export class Providers {

    /** Sampling padrão do provider, vindo das credentials. */
    protected sampling: SamplingParams = {};

    /**
     * Escape hatch: chaves cruas mescladas no body do request, para o que o
     * shape neutro de `SamplingParams` não cobre (ex.: `keep_alive`, `format`).
     */
    protected raw: Record<string, unknown> = {};

    /**
     * Quando ligado (default), uma resposta em texto que contenha uma chamada de
     * tool é resgatada e executada. Desligue para diagnosticar: sem o resgate, o
     * texto permanece resposta final e fica evidente que o modelo não usou o
     * formato nativo.
     */
    protected rescueToolCalls = true;

    /**
     * Preço por 1k tokens. Fica a cargo de quem configura o provider — não há
     * tabela de preços embutida, que envelheceria em silêncio.
     */
    protected costPer1kTokens?: TokenCost;

    // Da estratégia mais específica para a mais permissiva: a extração por regex
    // é gananciosa (`{` … último `}`) e só deve entrar se nada antes casou.
    private extractors: ((input: string) => unknown)[] = [
        parser.parseAsTaggedJson,
        parser.parseAsJson,
        parser.parseAsMarkdownJson,
        parser.parseAsBalancedJson,
        parser.parseAsExtractedJson,
    ];

    public async chat({ tools, messages, sampling }: ChatParams): Promise<ChatTurn> {
        // O sampling da chamada (ex.: o do `@Agent`) vence o do provider, chave a chave.
        const merged = { ...this.sampling, ...sampling };
        const raw = await this.chatInternal(tools, messages, merged);
        const content = parser.stripThinkTags(raw.content);

        // tool call: usa o nativo quando o provider o trouxe; senão, tenta
        // extrair do texto (fallback p/ modelos locais que emitem JSON no content).
        const native = raw.toolCalls?.[0];
        const call: ToolCall | null = native
            ? { ...native, source: "native" }
            : this.rescueToolCalls
                ? this.extractToolCall(content, tools)
                : null;

        const usage = this.withCost(raw.usage);

        const assistant: Message = {
            role: "assistant",
            content,
            // 1 por turno (sem parallel tool calls): o assistant fica com o mesmo
            // call que respondemos, preservando o pareamento exigido pela API.
            toolCalls: call ? [call] : undefined,
        };

        if (!call) {
            return { assistant, usage };
        }

        // Execução da tool continua no provider (decisão estratégica: evita ifs no agente).
        const tool = tools.find(t => t.name === call.name);
        const result = tool
            ? toToolOutput(await tool.execute(this.parseArguments(tool, call)))
            : { content: `Tool '${call.name}' não encontrada.`, isError: true };

        const toolMessage: Message = {
            role: "tool",
            content: result.content,
            toolName: call.name,
            toolCallId: call.id,
            isError: result.isError,
        };

        return { assistant, tool: toolMessage, usage };
    }

    /** Acrescenta o custo ao usage quando há preço configurado. */
    private withCost(usage?: Usage): Usage | undefined {
        if (!usage || !this.costPer1kTokens) return usage;

        const { input = 0, output = 0 } = this.costPer1kTokens;
        const costUsd =
            ((usage.promptTokens ?? 0) / 1000) * input +
            ((usage.completionTokens ?? 0) / 1000) * output;

        return { ...usage, costUsd };
    }

    /**
     * Valida os argumentos contra o schema da tool. O erro é reescrito dizendo
     * de onde veio a chamada: um resgate cujos argumentos não passam no schema
     * era, antes, indistinguível de um bug da tool.
     */
    private parseArguments(tool: ToolType, call: ToolCall): unknown {
        try {
            return tool.schema.parse(call.arguments);
        } catch (error) {
            const origem = call.source === "rescued"
                ? " (chamada resgatada do texto da resposta)"
                : "";
            throw new Error(
                `Argumentos inválidos para a tool '${call.name}'${origem}: ` +
                ((error as Error)?.message ?? String(error)),
            );
        }
    }

    // Fallback: extrai uma tool call do texto do modelo (parsing separado da execução).
    private extractToolCall(content: string, tools: ToolType[]): ToolCall | null {
        for (const extract of this.extractors) {
            let payload: unknown;

            try {
                payload = extract(content);
            } catch {
                continue; // tenta a próxima estratégia
            }

            const base = normalizeToolCallEnvelope(payload);
            if (!base) continue;

            // O nome precisa ser de uma tool registrada — é o que impede um JSON
            // qualquer na resposta de virar chamada.
            if (!tools.some(t => t.name === base.name)) continue;

            return {
                id: `call_${Date.now()}`,
                name: base.name,
                arguments: base.arguments,
                source: "rescued",
            };
        }

        return null;
    }

    protected chatInternal(
        _tools: ToolType[],
        _messages: Message[],
        _sampling?: SamplingParams,
    ): Promise<RawAssistant> {
        return Promise.resolve({ content: "" });
    }

    protected embed(_input?: string): Promise<number[]> {
        return Promise.resolve([]);
    }

}
