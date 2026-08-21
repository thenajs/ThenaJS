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

/**
 * Resumo de uma execução, para a lista lateral.
 *
 * Os nomes de campo seguem o `ExecutionEvent` do core (`startedAt`, `endedAt`,
 * `durationMs`) porque os dois viajam no mesmo stream: antes, a duração de um
 * evento era `durationMs` e a da run era `duracaoMs`, o mesmo conceito escrito
 * de duas formas no mesmo JSON. Ver ADR-021.
 */
export interface FlowRun {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "running" | "ok" | "error";
  /** Quantidade de passos concluídos. */
  steps: number;
}

/** O que o navegador recebe ao conectar. */
export interface FlowSnapshot {
  runs: FlowRun[];
  /**
   * Id da run que o navegador deve abrir — não a run inteira. `currentRun`
   * sugeria o objeto e fazia quem lia esperar um `FlowRun`.
   */
  currentRunId?: string;
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
