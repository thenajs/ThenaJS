import { randomUUID } from "node:crypto";
import type { ExecutionEvent } from "@thenajs/core";
import type { FlowEvent, FlowRun, FlowSnapshot } from "../tipos.js";

/**
 * O histórico vive só na memória do processo, de propósito: o Flow é uma janela
 * para o que está acontecendo agora, não um banco de traces. Fechou o processo,
 * acabou o histórico.
 *
 * A atribuição é feita pelo `runId` que vem no evento. Antes era um cursor
 * único (`this.atual`) com a fronteira inferida por `depth === 0` — o que
 * funcionava com uma execução por vez e embaralhava tudo com duas.
 */
export class RunHistory {
  private runs: FlowRun[] = [];
  private events = new Map<string, FlowEvent[]>();
  /** Ordem de chegada **por run** — duas runs concorrentes não compartilham. */
  private seqs = new Map<string, number>();

  constructor(private maxRuns: number) {}

  /**
   * Absorve um evento do recorder e devolve a versão carimbada, mais a run se
   * ela mudou (para o navegador atualizar a lista sem recarregar).
   */
  record(evento: ExecutionEvent): { evento: FlowEvent; run?: FlowRun } {
    // Um evento sem `runId` viria de um recorder montado à mão; damos um id
    // sintético para ele não derrubar a atribuição das runs de verdade.
    const runId = evento.runId || `sem-id-${randomUUID()}`;

    let run = this.runs.find((r) => r.id === runId);
    let runChanged = false;

    if (!run) {
      run = this.openRun(runId, evento.name);
      runChanged = true;
    }

    const seq = this.seqs.get(runId) ?? 0;
    this.seqs.set(runId, seq + 1);

    const stamped: FlowEvent = { ...evento, runId, seq, at: Date.now() };
    this.events.get(runId)!.push(stamped);

    if (evento.phase === "end") {
      run.steps++;
      runChanged = true;
      if (evento.depth === 0) {
        run.fimEm = stamped.at;
        run.duracaoMs = evento.durationMs ?? run.fimEm - run.inicioEm;
        run.status = evento.status === "error" ? "error" : "ok";
      } else if (evento.status === "error") {
        // Uma falha lá no fundo já deixa a run vermelha, sem esperar o fim.
        run.status = "error";
      }
    }

    return { evento: stamped, run: runChanged ? run : undefined };
  }

  /** Estado inicial para quem acabou de abrir o navegador. */
  snapshot(): FlowSnapshot {
    // A run em andamento mais recente; sem nenhuma rodando, a última que houve.
    const target =
      this.runs.find((r) => r.status === "rodando")?.id ?? this.runs[0]?.id;
    return {
      runs: this.runs,
      runAtual: target,
      events: target ? (this.events.get(target) ?? []) : [],
    };
  }

  /** Eventos de uma run específica (a lista lateral navega por aqui). */
  eventsOf(runId: string): FlowEvent[] | undefined {
    return this.events.get(runId);
  }

  private openRun(id: string, name: string): FlowRun {
    const run: FlowRun = {
      id,
      name,
      inicioEm: Date.now(),
      status: "rodando",
      steps: 0,
    };
    // Mais recente primeiro — é a que interessa.
    this.runs.unshift(run);
    this.events.set(id, []);
    this.seqs.set(id, 0);

    while (this.runs.length > this.maxRuns) {
      const removida = this.runs.pop()!;
      this.events.delete(removida.id);
      this.seqs.delete(removida.id);
    }

    return run;
  }
}
