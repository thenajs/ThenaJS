import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thena } from "@thenajs/core";
import type { ExecutionEvent, ExecutionNode } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

/**
 * O objetivo do `RunContext`: execuções concorrentes não se contaminam.
 * Todos estes testes falham contra os globais de módulo.
 */

/** Workflow de três agentes, para o orçamento ter onde cortar. */
function fluxoDeTresPassos(provider: FakeProvider) {
  return criarWorkflow([
    criarAgente({ provider }),
    criarAgente({ provider }),
    criarAgente({ provider }),
  ]);
}

/** Agente que espera `ms` antes de responder, para forçar a intercalação. */
function fluxoLento(ms: number, resposta: string) {
  const provider = new FakeProvider([{ content: resposta }], { delayMs: ms });
  return criarWorkflow([criarAgente({ provider })]);
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("isolamento entre execuções", () => {
  it("runs concorrentes contam o próprio orçamento", async () => {
    const providerCurto = new FakeProvider([
      { content: "c1" },
      { content: "c2" },
      { content: "c3" },
    ]);
    const providerLongo = new FakeProvider([
      { content: "l1" },
      { content: "l2" },
      { content: "l3" },
    ]);

    const curto = Thena.create(fluxoDeTresPassos(providerCurto), {});
    const longo = Thena.create(fluxoDeTresPassos(providerLongo), {});

    const [saidaCurto, saidaLongo] = await Promise.all([
      curto.run({ input: { message: "a" }, budget: { maxChatCalls: 1 } }),
      longo.run({ input: { message: "b" } }),
    ]);

    // O teto de um não pode cortar o outro: o `curto` para no 1º passo, o
    // `longo` roda os 3. Com um tracker de processo, um zeraria o outro.
    expect(saidaCurto).toBe("c1");
    expect(providerCurto.chamadas).toHaveLength(1);
    expect(saidaLongo).toBe("l3");
    expect(providerLongo.chamadas).toHaveLength(3);

    await Promise.all([curto.dispose(), longo.dispose()]);
  });

  it("dois apps concorrentes mantêm cada um o seu sink de log", async () => {
    const eventosA: ExecutionEvent[] = [];
    const eventosB: ExecutionEvent[] = [];

    const appA = Thena.create(fluxoLento(30, "A"), {
      log: (e) => eventosA.push(e),
    });
    const appB = Thena.create(fluxoLento(5, "B"), {
      log: (e) => eventosB.push(e),
    });

    await Promise.all([
      appA.run({ input: { message: "a" } }),
      appB.run({ input: { message: "b" } }),
    ]);

    // Nenhum evento cruzou: cada recorder é da sua execução.
    expect(eventosA.length).toBeGreaterThan(0);
    expect(eventosB.length).toBeGreaterThan(0);
    expect(new Set(eventosA.map((e) => e.runId)).size).toBe(1);
    expect(new Set(eventosB.map((e) => e.runId)).size).toBe(1);
    expect(eventosA[0].runId).not.toBe(eventosB[0].runId);

    await Promise.all([appA.dispose(), appB.dispose()]);
  });

  it("runs concorrentes produzem árvores de report separadas", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const dirA = mkdtempSync(join(tmpdir(), "thena-iso-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "thena-iso-b-"));

    const appA = Thena.create(fluxoLento(30, "resposta A"), {
      report: { dir: dirA },
    });
    const appB = Thena.create(fluxoLento(10, "resposta B"), {
      report: { dir: dirB },
    });

    await Promise.all([
      appA.run({ input: { message: "a" } }),
      appB.run({ input: { message: "b" } }),
    ]);
    await Promise.all([appA.dispose(), appB.dispose()]);

    const arvore = (dir: string): ExecutionNode => {
      const sub = readdirSync(dir, { withFileTypes: true }).find((e) =>
        e.isDirectory(),
      );
      const alvo = sub ? join(dir, sub.name) : dir;
      return JSON.parse(readFileSync(join(alvo, "report.json"), "utf-8"));
    };

    // Cada report tem exatamente uma árvore, com um único agente dentro.
    for (const dir of [dirA, dirB]) {
      const raiz = arvore(dir);
      expect(raiz.kind).toBe("workflow");
      expect(raiz.children).toHaveLength(1);
      expect(raiz.children[0].kind).toBe("agent");
    }
  });

  it("o dispose de um app não desliga a observação do outro", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const eventosB: ExecutionEvent[] = [];
    const appA = Thena.create(fluxoLento(0, "a"), { log: () => {} });
    const appB = Thena.create(fluxoLento(0, "b"), {
      log: (e) => eventosB.push(e),
    });

    await appA.dispose();
    await appB.run({ input: { message: "b" } });

    expect(eventosB.length).toBeGreaterThan(0);
    await appB.dispose();
  });

  it("cada run recebe o seu próprio runId nos eventos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const eventos: ExecutionEvent[] = [];
    const app = Thena.create(fluxoLento(0, "x"), {
      log: (e) => eventos.push(e),
    });

    await app.run({ input: { message: "1" } });
    await app.run({ input: { message: "2" } });
    await app.dispose();

    const ids = new Set(eventos.map((e) => e.runId));
    expect(ids.size).toBe(2);
    expect([...ids].every(Boolean)).toBe(true);
  });
});
