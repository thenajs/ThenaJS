import { HttpTransport } from "../http/index.js";
import type {
  CollectionOptions,
  VectorDocument,
  VectorMatch,
  VectorSearch,
  VectorSelector,
} from "./vector.types.js";

/**
 * Contrato de um banco vetorial. Estenda para trazer o seu — é o mesmo modelo
 * de `Providers`: a classe base cuida do transporte (retry, timeout) e você
 * implementa a tradução para a API do seu backend.
 *
 * Todas as operações são sobre **uma** collection, definida nas credentials.
 * A separação por contexto é o `dataset`, um campo do payload — bancos
 * vetoriais costumam recomendar partição em vez de muitas collections.
 *
 * ```ts
 * export class PgVectorStore extends VectorStore {
 *     constructor(credentials: VectorStoreCredentials) {
 *         super();
 *         this.configureTransport(credentials);
 *     }
 *     // …
 * }
 * ```
 */
export abstract class VectorStore extends HttpTransport {
  /** Memoização do `ensureCollectionOnce` — uma vez por instância de store. */
  private preparada?: Promise<void>;
  /** Dimensão com que a collection foi preparada, para detectar conflito. */
  private preparedWith?: number;

  /** Cria a collection se ainda não existir. Deve ser idempotente. */
  abstract ensureCollection(options: CollectionOptions): Promise<void>;

  /**
   * `ensureCollection` memoizado. Como o store é registrado uma vez e
   * compartilhado por todos os agentes, a criação da collection acontece
   * **uma vez por run**, não uma vez por agente.
   *
   * Se um segundo agente pedir uma dimensão diferente, falha aqui — antes de
   * gastar o embedding e antes do erro cru do banco, que aponta o `upsert` em
   * vez da causa. Uma collection guarda um tamanho só.
   */
  ensureCollectionOnce(options: CollectionOptions): Promise<void> {
    if (this.preparedWith !== undefined && this.preparedWith !== options.size) {
      throw new Error(
        `[thena] This store was already prepared with ${this.preparedWith} ` +
          `dimensions, but now received embeddings of ${options.size}. A ` +
          `collection accepts a single vector size — different embedding models ` +
          `need different stores (each with its own collection).`,
      );
    }

    this.preparedWith = options.size;
    this.preparada ??= this.ensureCollection(options);
    return this.preparada;
  }

  abstract collectionExists(): Promise<boolean>;

  abstract dropCollection(): Promise<void>;

  /** Insere ou substitui pontos (o id manda). */
  abstract upsert(docs: VectorDocument[]): Promise<void>;

  /** Busca por similaridade, já ordenada do mais próximo ao mais distante. */
  abstract search(params: VectorSearch): Promise<VectorMatch[]>;

  abstract remove(selector: VectorSelector): Promise<void>;
}

/** Classe de store, instanciada pelo framework ao registrar no `ThenaConfig`. */
export type VectorStoreCtor = new () => VectorStore;
