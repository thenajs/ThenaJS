import type { VectorStore } from "@thenajs/agentflow";

/**
 * Ajustes de runtime de uma execução, definidos pelo `Thena.create` e
 * transportados no `RunContext`.
 */
export interface RuntimeSettings {
  /** Stores vetoriais da aplicação, na ordem em que são injetados. */
  memory: VectorStore[];
}

export const DEFAULTS: RuntimeSettings = { memory: [] };
