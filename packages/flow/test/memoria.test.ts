import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@thenajs/core";
import { RunHistory } from "../src/server/memoria.js";

/**
 * A atribuição por `runId`. Com o cursor único que existia antes, os eventos
 * intercalados de duas execuções caíam todos na mesma run.
 */

function evento(over: Partial<ExecutionEvent> & { runId: string }): ExecutionEvent {
  return {
    phase: "start",
    kind: "workflow",
    name: "Fluxo",
    depth: 0,
    id: `${over.runId}-${over.depth ?? 0}-${over.phase ?? "start"}`,
    ...over,
  };
}

describe("MemoriaDeRuns", () => {
  it("separa eventos intercalados de duas execuções", () => {
    const history = new RunHistory(20);

    // A e B começam, trocam de vez, e terminam fora de ordem.
    history.record(evento({ runId: "A", name: "FluxoA" }));
    history.record(evento({ runId: "B", name: "FluxoB" }));
    history.record(evento({ runId: "A", depth: 1, kind: "agent", name: "AgenteA" }));
    history.record(evento({ runId: "B", depth: 1, kind: "agent", name: "AgenteB" }));
    history.record(
      evento({
        runId: "B",
        depth: 1,
        kind: "agent",
        name: "AgenteB",
        phase: "end",
        status: "ok",
      }),
    );
    history.record(
      evento({
        runId: "A",
        depth: 1,
        kind: "agent",
        name: "AgenteA",
        phase: "end",
        status: "ok",
      }),
    );

    expect(history.eventsOf("A")).toHaveLength(3);
    expect(history.eventsOf("B")).toHaveLength(3);
    expect(history.eventsOf("A")!.every((e) => e.runId === "A")).toBe(true);
    expect(history.eventsOf("B")!.every((e) => e.runId === "B")).toBe(true);
  });

  it("numera a sequência por run, não globalmente", () => {
    const history = new RunHistory(20);

    history.record(evento({ runId: "A" }));
    history.record(evento({ runId: "B" }));
    history.record(evento({ runId: "A", depth: 1 }));

    expect(history.eventsOf("A")!.map((e) => e.seq)).toEqual([0, 1]);
    expect(history.eventsOf("B")!.map((e) => e.seq)).toEqual([0]);
  });

  it("fecha cada run no seu próprio evento raiz de fim", () => {
    const history = new RunHistory(20);

    history.record(evento({ runId: "A", name: "FluxoA" }));
    history.record(evento({ runId: "B", name: "FluxoB" }));
    // Só B termina.
    history.record(evento({ runId: "B", phase: "end", status: "ok", durationMs: 42 }));

    const { runs } = history.snapshot();
    const a = runs.find((r) => r.id === "A")!;
    const b = runs.find((r) => r.id === "B")!;

    expect(a.status).toBe("rodando");
    expect(b.status).toBe("ok");
    expect(b.duracaoMs).toBe(42);
  });

  it("um erro no fundo já deixa a run vermelha antes do fim", () => {
    const history = new RunHistory(20);

    history.record(evento({ runId: "A" }));
    history.record(
      evento({ runId: "A", depth: 2, kind: "tool", phase: "end", status: "error" }),
    );

    expect(history.snapshot().runs[0].status).toBe("error");
  });

  it("o snapshot aponta para a run em andamento mais recente", () => {
    const history = new RunHistory(20);

    history.record(evento({ runId: "A" }));
    history.record(evento({ runId: "A", phase: "end", status: "ok" }));
    history.record(evento({ runId: "B" }));

    expect(history.snapshot().runAtual).toBe("B");
  });

  it("descarta as runs mais antigas ao passar do teto", () => {
    const history = new RunHistory(2);

    history.record(evento({ runId: "A" }));
    history.record(evento({ runId: "B" }));
    history.record(evento({ runId: "C" }));

    expect(history.snapshot().runs.map((r) => r.id)).toEqual(["C", "B"]);
    expect(history.eventsOf("A")).toBeUndefined();
  });
});
