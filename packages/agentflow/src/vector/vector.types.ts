import type { TransportCredentials } from "../http/index.js";

/** Métrica de comparação entre vetores. */
export type VectorDistance = "cosine" | "euclid" | "dot" | "manhattan";

/**
 * Credentials de um banco vetorial. Estenda no seu tipo, como
 * `ProviderCredentials` faz para os providers.
 */
export interface VectorStoreCredentials extends TransportCredentials {
    url: string;
    apiKey?: string;
    /**
     * A collection onde tudo é gravado. Uma só por store — bancos vetoriais
     * costumam recomendar partição por campo em vez de muitas collections.
     * Default: `"thena_memory"`.
     */
    collection?: string;
    /** Campo do payload que particiona os datasets. Default: `"dataset"`. */
    datasetField?: string;
    /**
     * @deprecated Não é mais usado — o campo é aceito e ignorado, e será
     * removido na 0.5.0.
     *
     * Validava, em runtime, se o `dataset` informado em
     * `remember`/`recall`/`forget` estava nesta lista. Era rede de segurança
     * opcional que não justificava o campo a mais na configuração: um dataset
     * inexistente simplesmente devolve zero resultados, como qualquer filtro
     * que não casa.
     *
     * Pode remover da sua config — nada muda no comportamento.
     */
    datasets?: readonly string[];
}

/** Um ponto a gravar: vetor mais o payload que volta na busca. */
export interface VectorDocument {
    id: string | number;
    vector: number[];
    payload?: Record<string, unknown>;
}

/** Um resultado de busca, já ordenado por similaridade. */
export interface VectorMatch {
    id: string | number;
    score: number;
    payload?: Record<string, unknown>;
}

/** Parâmetros de uma busca por similaridade. */
export interface VectorSearch {
    vector: number[];
    limit?: number;
    /**
     * Igualdade simples em campos do payload — cobre a maioria dos casos.
     * Cada store traduz para o formato nativo dele.
     */
    where?: Record<string, unknown>;
    /**
     * Escape hatch: filtro no formato nativo do store. **Vence o `where`**
     * quando presente, para o que o shape neutro não cobre (ranges, geo…).
     */
    rawFilter?: unknown;
    /** Descarta resultados abaixo deste score. */
    scoreThreshold?: number;
    /** Trazer o payload junto (default: `true` — é onde o texto vive). */
    withPayload?: boolean;
}

/** Como criar a collection. `size` precisa bater com o modelo de embedding. */
export interface CollectionOptions {
    size: number;
    distance?: VectorDistance;
}

/** O que remover: por id, ou por igualdade em campos do payload. */
export interface VectorSelector {
    ids?: (string | number)[];
    where?: Record<string, unknown>;
}
