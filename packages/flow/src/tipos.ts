import type { ExecutionEvent } from "@thenajs/core";

/**
 * Um evento da execução, já carimbado pelo servidor. O `runId` vem do próprio
 * `ExecutionEvent` — é o core que decide a qual execução o evento pertence.
 */
export interface FlowEvent extends ExecutionEvent {
  /** Ordem de chegada dentro da run — o navegador usa para não reordenar. */
  seq: number;
  /** Epoch ms em que o servidor recebeu o evento. */
  at: number;
}

/** Resumo de uma execução, para a lista lateral. */
export interface FlowRun {
  id: string;
  name: string;
  inicioEm: number;
  fimEm?: number;
  duracaoMs?: number;
  status: "rodando" | "ok" | "error";
  /** Quantidade de passos concluídos. */
  steps: number;
}

/** O que o navegador recebe ao conectar. */
export interface FlowSnapshot {
  runs: FlowRun[];
  runAtual?: string;
  events: FlowEvent[];
}

/** Opções do `thenaFlow(...)`. */
export interface FlowOptions {
  /** Porta do site. Default: `4100`. */
  port?: number;
  /** Interface de escuta. Default: `127.0.0.1` — local, de propósito. */
  host?: string;
  /**
   * Quantas execuções manter na memória. Default: `20`. O Flow **não persiste
   * nada**: fechou o processo, acabou o histórico.
   */
  maxRuns?: number;
  /** Imprime a URL no console ao subir. Default: `true`. */
  log?: boolean;
}
