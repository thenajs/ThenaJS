import { ToolType, toToolOutput } from "../tools/index.js";
import { normalizeToolCallEnvelope, parser } from "./utils/index.js";
import { Message, ProviderToolCall } from "../state/index.js";
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
    toolCalls?: ProviderToolCall[];
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

/**
 * Campos que **todo** provider aceita, independente do backend. Estenda no seu
 * tipo de credentials e passe o objeto inteiro para `configure()` — assim um
 * campo novo na classe base chega ao seu provider sem você mexer em nada.
 *
 * ```ts
 * type MinhasCredentials = ProviderCredentials & { apiKey: string };
 * ```
 */
export interface ProviderCredentials {
    /** Parâmetros de amostragem padrão deste provider. */
    sampling?: SamplingParams;
    /** Chaves cruas mescladas no body do request, para o que `sampling` não cobre. */
    raw?: Record<string, unknown>;
    /** Resgatar tool calls emitidas como texto (default: `true`). */
    rescueToolCalls?: boolean;
    /** Preço por 1k tokens, para o `costUsd` do usage e o orçamento da run. */
    costPer1kTokens?: TokenCost;
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

    /**
     * Absorve os campos comuns das credentials. Chame no construtor da sua
     * subclasse, antes ou depois de guardar os campos próprios:
     *
     * ```ts
     * constructor(credentials: MinhasCredentials) {
     *     super();
     *     this.configure(credentials);
     *     this.apiKey = credentials.apiKey;
     * }
     * ```
     *
     * Existe para você não repetir (nem esquecer) uma dessas atribuições — e
     * para que um campo novo na classe base chegue ao seu provider de graça.
     */
    protected configure(credentials: ProviderCredentials = {}): void {
        this.sampling = credentials.sampling ?? {};
        this.raw = credentials.raw ?? {};
        this.rescueToolCalls = credentials.rescueToolCalls ?? true;
        this.costPer1kTokens = credentials.costPer1kTokens;
    }

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
        const call: ProviderToolCall | null = native
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
    private parseArguments(tool: ToolType, call: ProviderToolCall): unknown {
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
    private extractToolCall(content: string, tools: ToolType[]): ProviderToolCall | null {
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

    /**
     * A chamada crua ao modelo — **o único método que uma subclasse precisa
     * implementar**. Traduza `messages`/`tools` para o formato da API, mapeie o
     * `sampling` para as chaves nativas e devolva o conteúdo.
     *
     * A classe base cuida do resto: remove blocos de raciocínio, decide entre
     * tool call nativa e resgatada do texto, valida os argumentos contra o
     * schema, executa a tool e calcula o custo.
     */
    protected chatInternal(
        _tools: ToolType[],
        _messages: Message[],
        _sampling?: SamplingParams,
    ): Promise<RawAssistant> {
        return Promise.resolve({ content: "" });
    }

    /**
     * Vetor de embedding do texto. Providers que não suportam devolvem `[]`
     * (o default desta classe).
     */
    public embed(_input?: string): Promise<number[]> {
        return Promise.resolve([]);
    }

}
