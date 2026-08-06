import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@thenajs/core";
import { MemoriaDeRuns } from "../src/server/memoria.js";

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
    const memoria = new MemoriaDeRuns(20);

    // A e B começam, trocam de vez, e terminam fora de ordem.
    memoria.registrar(evento({ runId: "A", name: "FluxoA" }));
    memoria.registrar(evento({ runId: "B", name: "FluxoB" }));
    memoria.registrar(evento({ runId: "A", depth: 1, kind: "agent", name: "AgenteA" }));
    memoria.registrar(evento({ runId: "B", depth: 1, kind: "agent", name: "AgenteB" }));
    memoria.registrar(
      evento({ runId: "B", depth: 1, kind: "agent", name: "AgenteB", phase: "end", status: "ok" }),
    );
    memoria.registrar(
      evento({ runId: "A", depth: 1, kind: "agent", name: "AgenteA", phase: "end", status: "ok" }),
    );

    expect(memoria.eventosDe("A")).toHaveLength(3);
    expect(memoria.eventosDe("B")).toHaveLength(3);
    expect(memoria.eventosDe("A")!.every((e) => e.runId === "A")).toBe(true);
    expect(memoria.eventosDe("B")!.every((e) => e.runId === "B")).toBe(true);
  });

  it("numera a sequência por run, não globalmente", () => {
    const memoria = new MemoriaDeRuns(20);

    memoria.registrar(evento({ runId: "A" }));
    memoria.registrar(evento({ runId: "B" }));
    memoria.registrar(evento({ runId: "A", depth: 1 }));

    expect(memoria.eventosDe("A")!.map((e) => e.seq)).toEqual([0, 1]);
    expect(memoria.eventosDe("B")!.map((e) => e.seq)).toEqual([0]);
  });

  it("fecha cada run no seu próprio evento raiz de fim", () => {
    const memoria = new MemoriaDeRuns(20);

    memoria.registrar(evento({ runId: "A", name: "FluxoA" }));
    memoria.registrar(evento({ runId: "B", name: "FluxoB" }));
    // Só B termina.
    memoria.registrar(
      evento({ runId: "B", phase: "end", status: "ok", durationMs: 42 }),
    );

    const { runs } = memoria.snapshot();
    const a = runs.find((r) => r.id === "A")!;
    const b = runs.find((r) => r.id === "B")!;

    expect(a.status).toBe("rodando");
    expect(b.status).toBe("ok");
    expect(b.duracaoMs).toBe(42);
  });

  it("um erro no fundo já deixa a run vermelha antes do fim", () => {
    const memoria = new MemoriaDeRuns(20);

    memoria.registrar(evento({ runId: "A" }));
    memoria.registrar(
      evento({ runId: "A", depth: 2, kind: "tool", phase: "end", status: "error" }),
    );

    expect(memoria.snapshot().runs[0].status).toBe("error");
  });

  it("o snapshot aponta para a run em andamento mais recente", () => {
    const memoria = new MemoriaDeRuns(20);

    memoria.registrar(evento({ runId: "A" }));
    memoria.registrar(evento({ runId: "A", phase: "end", status: "ok" }));
    memoria.registrar(evento({ runId: "B" }));

    expect(memoria.snapshot().runAtual).toBe("B");
  });

  it("descarta as runs mais antigas ao passar do teto", () => {
    const memoria = new MemoriaDeRuns(2);

    memoria.registrar(evento({ runId: "A" }));
    memoria.registrar(evento({ runId: "B" }));
    memoria.registrar(evento({ runId: "C" }));

    expect(memoria.snapshot().runs.map((r) => r.id)).toEqual(["C", "B"]);
    expect(memoria.eventosDe("A")).toBeUndefined();
  });
});
