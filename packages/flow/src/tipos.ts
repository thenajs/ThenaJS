import type { ExecutionEvent } from "@thenajs/core";

/** Um evento da execução, já carimbado com a run a que pertence. */
export interface FlowEvent extends ExecutionEvent {
  /** Execução (`app.run`) a que este evento pertence. */
  runId: string;
  /** Ordem de chegada dentro da run — o navegador usa para não reordenar. */
  seq: number;
  /** Epoch ms em que o servidor recebeu o evento. */
  at: number;
}

/** Resumo de uma execução, para a lista lateral. */
export interface FlowRun {
  id: string;
  nome: string;
  inicioEm: number;
  fimEm?: number;
  duracaoMs?: number;
  status: "rodando" | "ok" | "error";
  /** Quantidade de passos concluídos. */
  passos: number;
}

/** O que o navegador recebe ao conectar. */
export interface FlowSnapshot {
  runs: FlowRun[];
  runAtual?: string;
  eventos: FlowEvent[];
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
