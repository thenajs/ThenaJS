import { randomUUID } from "node:crypto";
import type { Providers } from "../providers/index.js";
import type { VectorStore } from "./vector-store.js";
import type { VectorDistance } from "./vector.types.js";

/** Dataset padrão quando nenhum é informado. */
export const DEFAULT_DATASET = "default";

export interface VectorMemoryOptions {
    store: VectorStore;
    /** Quem gera os embeddings — usa o `embed()` público do provider. */
    provider: Providers;
    /** Dataset usado quando a chamada não informa um. Default: `"default"`. */
    defaultDataset?: string;
    /** Métrica da collection, na criação. Default: `"cosine"`. */
    distance?: VectorDistance;
}

/** Um item lembrado, como volta do `recall`. */
export interface RecallHit {
    text: string;
    score: number;
    dataset: string;
    id: string | number;
    payload?: Record<string, unknown>;
}

export interface RememberOptions {
    dataset?: string;
    /** Campos extras gravados junto — voltam no `payload` do `recall`. */
    payload?: Record<string, unknown>;
    /** Id próprio, para sobrescrever um item existente. */
    id?: string | number;
}

export interface RecallOptions {
    limit?: number;
    /**
     * Dataset a buscar. Omitido usa o default; **`null` busca em todos**.
     */
    dataset?: string | null;
    scoreThreshold?: number;
    /** Filtro adicional por igualdade em campos do payload. */
    where?: Record<string, unknown>;
}

export interface ForgetSelector {
    ids?: (string | number)[];
    dataset?: string;
    where?: Record<string, unknown>;
}

/**
 * Memória vetorial: junta o `embed()` de um provider com um `VectorStore`.
 * É o que o runtime coloca em `ctx.memory` quando o agente declara `memory`.
 *
 * Não confunda com `ctx.state.memory`, que é outra coisa — o bucket `string[]`
 * de contexto durável que vira mensagem `system` no prompt. Este aqui é busca
 * semântica: você grava e recupera por similaridade, não por ordem.
 */
export class VectorMemory {

    private readonly store: VectorStore;
    private readonly provider: Providers;
    private readonly defaultDataset: string;
    private readonly distance: VectorDistance;
    private readonly campoDataset: string;

    constructor(options: VectorMemoryOptions) {
        this.store = options.store;
        this.provider = options.provider;
        this.defaultDataset = options.defaultDataset ?? DEFAULT_DATASET;
        this.distance = options.distance ?? "cosine";
        this.campoDataset =
            (options.store as { datasetField?: string }).datasetField ?? "dataset";
    }

    /** Grava um texto. Devolve o id, para você poder sobrescrever ou remover depois. */
    async remember(text: string, options: RememberOptions = {}): Promise<string | number> {
        const [id] = await this.rememberMany([{ text, ...options }]);
        return id;
    }

    /** Grava vários de uma vez — um embed por item, um upsert só. */
    async rememberMany(
        items: ({ text: string } & RememberOptions)[],
    ): Promise<(string | number)[]> {
        if (!items.length) return [];

        for (const item of items) this.validarDataset(item.dataset);

        const vetores = await Promise.all(
            items.map((item) => this.provider.embed(item.text)),
        );

        // As dimensões saem do próprio vetor: ninguém deveria precisar saber de
        // cabeça que nomic-embed-text é 768 e text-embedding-3-small é 1536.
        await this.preparar(vetores[0].length);

        const docs = items.map((item, i) => ({
            id: item.id ?? randomUUID(),
            vector: vetores[i],
            payload: {
                ...item.payload,
                text: item.text,
                [this.campoDataset]: item.dataset ?? this.defaultDataset,
            },
        }));

        await this.store.upsert(docs);
        return docs.map((d) => d.id);
    }

    /** Busca por similaridade e devolve os textos mais próximos. */
    async recall(query: string, options: RecallOptions = {}): Promise<RecallHit[]> {
        if (options.dataset !== null) this.validarDataset(options.dataset);

        const vector = await this.provider.embed(query);

        // `null` explícito busca em todos os datasets; ausente usa o default.
        const dataset =
            options.dataset === null
                ? undefined
                : (options.dataset ?? this.defaultDataset);

        const where = {
            ...options.where,
            ...(dataset !== undefined ? { [this.campoDataset]: dataset } : {}),
        };

        const matches = await this.store.search({
            vector,
            limit: options.limit ?? 5,
            scoreThreshold: options.scoreThreshold,
            where: Object.keys(where).length ? where : undefined,
            withPayload: true,
        });

        return matches.map((m) => ({
            id: m.id,
            score: m.score,
            text: String(m.payload?.text ?? ""),
            dataset: String(m.payload?.[this.campoDataset] ?? this.defaultDataset),
            payload: m.payload,
        }));
    }

    /** Remove por id, por dataset inteiro, ou por igualdade no payload. */
    async forget(selector: ForgetSelector = {}): Promise<void> {
        this.validarDataset(selector.dataset);

        const where = {
            ...selector.where,
            ...(selector.dataset !== undefined
                ? { [this.campoDataset]: selector.dataset }
                : {}),
        };

        await this.store.remove({
            ids: selector.ids,
            where: Object.keys(where).length ? where : undefined,
        });
    }

    /**
     * Recusa um dataset que não foi declarado. O TypeScript já pega isso quando
     * o store declara `datasets`, mas só para quem passa pelo `tsc` — aqui pega
     * JS puro, `any` e valor vindo de variável. Sem `datasets` declarados, tudo
     * é aceito (o comportamento aberto continua sendo o default).
     */
    private validarDataset(dataset: string | undefined): void {
        const conhecidos = this.store.datasets;
        if (!conhecidos.length || dataset === undefined) return;
        if (dataset === this.defaultDataset) return;
        if (conhecidos.includes(dataset)) return;

        throw new Error(
            `[thena] Dataset "${dataset}" não declarado. ` +
            `Conhecidos: ${conhecidos.join(", ")}.`,
        );
    }

    /**
     * Cria a collection se preciso. A memoização vive no **store**, que é
     * compartilhado — então isso acontece uma vez por run, não por agente.
     */
    private preparar(size: number): Promise<void> {
        return this.store.ensureCollectionOnce({ size, distance: this.distance });
    }
}
