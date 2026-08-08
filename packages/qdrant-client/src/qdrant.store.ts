import { VectorStore } from "@thenajs/core";
import type {
  CollectionOptions,
  VectorDistance,
  VectorDocument,
  VectorMatch,
  VectorSearch,
  VectorSelector,
  VectorStoreCredentials,
} from "@thenajs/core";

export type QdrantCredentials = VectorStoreCredentials;

/** O shape neutro de distância → o nome que o Qdrant espera. */
const DISTANCES: Record<VectorDistance, string> = {
  cosine: "Cosine",
  euclid: "Euclid",
  dot: "Dot",
  manhattan: "Manhattan",
};

/**
 * Cliente Qdrant nativo, sobre a API REST — sem SDK, só `fetch`, herdando
 * retry e timeout do transporte do ThenaJS.
 *
 * Grava tudo numa **collection só** e separa contextos por um campo do payload
 * (`dataset`), que é a recomendação do próprio Qdrant: muitas collections
 * geram overhead de recursos, e o Qdrant Cloud limita a 1000 por cluster.
 * O campo ganha um índice `keyword` com `is_tenant`, que co-localiza os pontos
 * do mesmo dataset em disco.
 *
 * Requer **Qdrant 1.10 ou superior** — o endpoint unificado `/points/query`
 * estreou nessa versão.
 */
export class QdrantStore extends VectorStore {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly collection: string;
  /** Público para o `VectorMemory` saber qual campo particiona. */
  public readonly datasetField: string;

  constructor(credentials: QdrantCredentials) {
    super();
    this.configureTransport(credentials);
    this.url = credentials.url.replace(/\/$/, "");
    this.apiKey = credentials.apiKey;
    this.collection = credentials.collection ?? "thena_memory";
    this.datasetField = credentials.datasetField ?? "dataset";
  }

  async ensureCollection(options: CollectionOptions): Promise<void> {
    if (await this.collectionExists()) return;

    await this.chamar(`/collections/${this.collection}`, "PUT", {
      vectors: {
        size: options.size,
        distance: DISTANCES[options.distance ?? "cosine"],
      },
    });

    await this.createPartitionIndex();
  }

  /**
   * Índice no campo que particiona os datasets.
   *
   * `is_tenant` faz o Qdrant agrupar em disco os pontos do mesmo dataset,
   * trocando seeks aleatórios por leitura sequencial — mas a forma de objeto
   * do `field_schema` só existe em versões mais novas. No 1.10 (nosso piso)
   * apenas a forma abreviada é aceita, então caímos para ela: o índice sai
   * igual, só sem a otimização de co-locação.
   */
  private async createPartitionIndex(): Promise<void> {
    const rota = `/collections/${this.collection}/index?wait=true`;
    try {
      await this.chamar(rota, "PUT", {
        field_name: this.datasetField,
        field_schema: { type: "keyword", is_tenant: true },
      });
    } catch {
      // Se a forma abreviada também falhar, aí é problema de verdade e sobe.
      await this.chamar(rota, "PUT", {
        field_name: this.datasetField,
        field_schema: "keyword",
      });
    }
  }

  async collectionExists(): Promise<boolean> {
    const data = await this.chamar<{ result?: { exists?: boolean } }>(
      `/collections/${this.collection}/exists`,
      "GET",
    );
    return Boolean(data?.result?.exists);
  }

  async dropCollection(): Promise<void> {
    await this.chamar(`/collections/${this.collection}`, "DELETE");
  }

  async upsert(docs: VectorDocument[]): Promise<void> {
    if (!docs.length) return;

    await this.chamar(`/collections/${this.collection}/points?wait=true`, "PUT", {
      points: docs.map((d) => ({
        id: d.id,
        vector: d.vector,
        payload: d.payload ?? {},
      })),
    });
  }

  async search(params: VectorSearch): Promise<VectorMatch[]> {
    const data = await this.chamar<{
      result?: { points?: { id: string | number; score: number; payload?: any }[] };
    }>(`/collections/${this.collection}/points/query`, "POST", {
      query: params.vector,
      limit: params.limit ?? 5,
      filter: this.buildFilter(params.where, params.rawFilter),
      with_payload: params.withPayload ?? true,
      score_threshold: params.scoreThreshold,
    });

    return (data?.result?.points ?? []).map((p) => ({
      id: p.id,
      score: p.score,
      payload: p.payload ?? undefined,
    }));
  }

  async remove(selector: VectorSelector): Promise<void> {
    const filter = this.buildFilter(selector.where);
    const body = selector.ids?.length
      ? { points: selector.ids }
      : filter
        ? { filter }
        : undefined;

    // Sem seletor nenhum, apagar tudo seria destrutivo demais para ser implícito.
    if (!body) return;

    await this.chamar(
      `/collections/${this.collection}/points/delete?wait=true`,
      "POST",
      body,
    );
  }

  /**
   * Traduz o `where` neutro (igualdade) para o formato do Qdrant. O
   * `rawFilter` vence quando presente — é o escape hatch para o que a
   * igualdade não cobre (ranges, geo, aninhamento).
   */
  private buildFilter(where?: Record<string, unknown>, rawFilter?: unknown): unknown {
    if (rawFilter !== undefined) return rawFilter;
    if (!where || !Object.keys(where).length) return undefined;

    return {
      must: Object.entries(where).map(([key, value]) => ({
        key,
        match: { value },
      })),
    };
  }

  /** Uma chamada à API, já com auth, retry e a mensagem de erro do Qdrant. */
  private async chamar<T = unknown>(
    caminho: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    const { response } = await this.request(`${this.url}${caminho}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { "api-key": this.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detalhe = await response.text();
      throw new Error(
        `Qdrant ${method} ${caminho} falhou (${response.status}): ${detalhe}`,
      );
    }

    return (await response.json()) as T;
  }
}
