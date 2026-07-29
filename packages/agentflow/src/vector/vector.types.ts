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
    /**
     * Nomes de dataset válidos. **Não cria nada** no banco — datasets são um
     * campo do payload, não collections.
     *
     * Serve para o runtime recusar um nome que você não declarou, com mensagem
     * clara, em vez de devolver zero resultados em silêncio. Omitido, qualquer
     * string é aceita.
     */
    datasets?: readonly string[];
    /** Campo do payload que particiona os datasets. Default: `"dataset"`. */
    datasetField?: string;
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
