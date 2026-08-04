import { randomUUID } from "node:crypto";
import type { ExecutionEvent } from "@thenajs/core";
import type { FlowEvent, FlowRun, FlowSnapshot } from "../tipos.js";

/**
 * O histórico vive só na memória do processo, de propósito: o Flow é uma janela
 * para o que está acontecendo agora, não um banco de traces. Fechou o processo,
 * acabou o histórico.
 */
export class MemoriaDeRuns {
  private runs: FlowRun[] = [];
  private eventos = new Map<string, FlowEvent[]>();
  private atual?: string;
  private seq = 0;

  constructor(private maxRuns: number) {}

  /**
   * Absorve um evento do recorder e devolve a versão carimbada, mais a run se
   * ela mudou (para o navegador atualizar a lista sem recarregar).
   */
  registrar(evento: ExecutionEvent): { evento: FlowEvent; run?: FlowRun } {
    let runMudou = false;

    // Raiz da árvore (`depth === 0`) delimita uma execução.
    if (evento.depth === 0 && evento.phase === "start") {
      this.abrirRun(evento.name);
      runMudou = true;
      this.seq = 0;
    }

    // Um evento antes de qualquer raiz (agente rodado solto, via `run()`) ainda
    // precisa de uma run para pertencer.
    if (!this.atual) {
      this.abrirRun(evento.name);
      runMudou = true;
    }

    const runId = this.atual!;
    const carimbado: FlowEvent = { ...evento, runId, seq: this.seq++, at: Date.now() };
    this.eventos.get(runId)!.push(carimbado);

    const run = this.runs.find((r) => r.id === runId)!;
    if (evento.phase === "end") {
      run.passos++;
      runMudou = true;
      if (evento.depth === 0) {
        run.fimEm = carimbado.at;
        run.duracaoMs = evento.durationMs ?? run.fimEm - run.inicioEm;
        run.status = evento.status === "error" ? "error" : "ok";
        this.atual = undefined;
      } else if (evento.status === "error") {
        // Uma falha lá no fundo já deixa a run vermelha, sem esperar o fim.
        run.status = "error";
      }
    }

    return { evento: carimbado, run: runMudou ? run : undefined };
  }

  /** Estado inicial para quem acabou de abrir o navegador. */
  snapshot(): FlowSnapshot {
    const alvo = this.atual ?? this.runs[0]?.id;
    return {
      runs: this.runs,
      runAtual: alvo,
      eventos: alvo ? (this.eventos.get(alvo) ?? []) : [],
    };
  }

  /** Eventos de uma run específica (a lista lateral navega por aqui). */
  eventosDe(runId: string): FlowEvent[] | undefined {
    return this.eventos.get(runId);
  }

  private abrirRun(nome: string): void {
    const run: FlowRun = {
      id: randomUUID(),
      nome,
      inicioEm: Date.now(),
      status: "rodando",
      passos: 0,
    };
    // Mais recente primeiro — é a que interessa.
    this.runs.unshift(run);
    this.eventos.set(run.id, []);
    this.atual = run.id;

    while (this.runs.length > this.maxRuns) {
      const removida = this.runs.pop()!;
      this.eventos.delete(removida.id);
    }
  }
}
