import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thena } from "@thenajs/core";
// `currentRun` não é API pública: o teste sonda o recorder, que é interno.
import { currentRun } from "../src/run-context.js";
import type { ExecutionEvent } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

/**
 * Quem observa uma execução — e quanto custa não ser observado.
 *
 * O handle era ligado ao recorder em **toda** run, o que mantinha o recorder
 * sempre ativo: a árvore inteira era construída, dois `ExecutionEvent` por
 * passo eram alocados e bufferizados, e o provider recebia um sink de token e
 * por isso pedia resposta em streaming. Nada disso tinha leitor, e custava ~2×
 * o tempo de CPU de uma run. O caminho de custo zero que o framework promete
 * existia só para quem chamava `runWorkflow` direto.
 */

/** Um workflow de um agente, e o provider por trás dele. */
function fluxo(resposta = "ok") {
  const provider = new FakeProvider([{ content: resposta }]);
  return { provider, Fluxo: criarWorkflow([criarAgente({ provider })]) };
}

/** Lê `recorder.active` de dentro da execução. */
function fluxoQueEspia(onde: { ativo?: boolean }) {
  const provider = new FakeProvider([{ content: "ok" }]);
  return {
    provider,
    Fluxo: criarWorkflow([
      criarAgente(
        { provider },
        { beforePrompt: () => void (onde.ativo = currentRun().recorder.active) },
      ),
    ]),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("sem ninguém observando", () => {
  it("o recorder fica INATIVO — nenhuma árvore é construída", async () => {
    const espiado: { ativo?: boolean } = {};
    const { Fluxo } = fluxoQueEspia(espiado);
    const app = Thena.create(Fluxo, {}); // sem report, log ou plugin

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(espiado.ativo).toBe(false);
  });

  it("o provider NÃO recebe sink de token, e por isso não transmite", async () => {
    const { provider, Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(provider.chamadas[0].streaming).toBe(false);
  });

  it("o resultado da execução é exatamente o mesmo", async () => {
    // O que muda é só a observação. A saída, não.
    const { Fluxo } = fluxo("a resposta");
    const app = Thena.create(Fluxo, {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("a resposta");
    await app.dispose();
  });

  it("onEvent avisa em vez de ficar mudo em silêncio", async () => {
    const avisos: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void avisos.push(String(m)));

    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});
    const exec = app.run({ input: { message: "vai" } });

    const vistos: ExecutionEvent[] = [];
    exec.onEvent((e) => vistos.push(e));
    await exec;
    await app.dispose();

    expect(vistos).toHaveLength(0);
    expect(avisos[0]).toMatch(/onEvent\(\)/);
    expect(avisos[0]).toMatch(/observe: true/);
  });

  it("o aviso sai uma vez por execução, não por assinatura", async () => {
    const avisos: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void avisos.push(String(m)));

    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});
    const exec = app.run({ input: { message: "vai" } });

    exec.onEvent(() => {});
    exec.onToken(() => {});
    exec.onEvent(() => {});
    await exec;
    await app.dispose();

    expect(avisos).toHaveLength(1);
  });
});

describe("quem liga a observação", () => {
  it("observe: true liga, mesmo sem report, log nem plugin", async () => {
    const espiado: { ativo?: boolean } = {};
    const { provider, Fluxo } = fluxoQueEspia(espiado);
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const vistos: ExecutionEvent[] = [];
    exec.onEvent((e) => vistos.push(e));
    await exec;
    await app.dispose();

    expect(espiado.ativo).toBe(true);
    expect(vistos.length).toBeGreaterThan(0);
    expect(provider.chamadas[0].streaming).toBe(true);
  });

  it("report liga sozinho", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-obs-"));

    const espiado: { ativo?: boolean } = {};
    const { Fluxo } = fluxoQueEspia(espiado);
    const app = Thena.create(Fluxo, { report: { dir } });

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(espiado.ativo).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  it("log liga sozinho", async () => {
    const espiado: { ativo?: boolean } = {};
    const { Fluxo } = fluxoQueEspia(espiado);
    const eventos: ExecutionEvent[] = [];
    const app = Thena.create(Fluxo, { log: (e) => eventos.push(e) });

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(espiado.ativo).toBe(true);
    expect(eventos.length).toBeGreaterThan(0);
  });

  it("um plugin com onEvent liga sozinho", async () => {
    const espiado: { ativo?: boolean } = {};
    const { Fluxo } = fluxoQueEspia(espiado);
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "olheiro", onEvent: () => {} });

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(espiado.ativo).toBe(true);
  });

  it("um plugin SÓ com middleware não liga — ele não lê eventos", async () => {
    const espiado: { ativo?: boolean } = {};
    const { Fluxo } = fluxoQueEspia(espiado);
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "cache", chat: (_inv, next) => next() });

    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // Interceptar não é observar: o middleware roda de qualquer jeito, e o
    // recorder continua sem motivo para construir a árvore.
    expect(espiado.ativo).toBe(false);
  });

  it("a decisão é por execução — uma observada, a seguinte não", async () => {
    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, {});

    const comObs = app.run({ input: { message: "1" }, observe: true });
    const vistos: ExecutionEvent[] = [];
    comObs.onEvent((e) => vistos.push(e));
    await comObs;

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const semObs = app.run({ input: { message: "2" } });
    const vistos2: ExecutionEvent[] = [];
    semObs.onEvent((e) => vistos2.push(e));
    await semObs;
    await app.dispose();

    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos2).toHaveLength(0);
  });

  it("observe: false não desliga o report — só o canal do handle", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-obs-off-"));

    const { Fluxo } = fluxo();
    const app = Thena.create(Fluxo, { report: { dir } });

    const exec = app.run({ input: { message: "vai" }, observe: false });
    const vistos: ExecutionEvent[] = [];
    exec.onEvent((e) => vistos.push(e));
    await exec;
    await app.dispose();

    // O report continua saindo; quem pediu para não observar foi o handle.
    expect(readdirSync(dir).length).toBeGreaterThan(0);
    expect(vistos).toHaveLength(0);
  });
});

describe("runs concorrentes com observação diferente", () => {
  it("uma observada e uma não não se contaminam", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const lento = new FakeProvider([{ content: "lento" }], { delayMs: 25 });
    const rapido = new FakeProvider([{ content: "rápido" }], { delayMs: 5 });
    const appA = Thena.create(criarWorkflow([criarAgente({ provider: lento })]), {});
    const appB = Thena.create(criarWorkflow([criarAgente({ provider: rapido })]), {});

    const a = appA.run({ input: { message: "a" }, observe: true });
    const b = appB.run({ input: { message: "b" } });
    const deA: ExecutionEvent[] = [];
    const deB: ExecutionEvent[] = [];
    a.onEvent((e) => deA.push(e));
    b.onEvent((e) => deB.push(e));

    const [ra, rb] = await Promise.all([a.result, b.result]);
    await Promise.all([appA.dispose(), appB.dispose()]);

    expect(ra).toBe("lento");
    expect(rb).toBe("rápido");
    expect(deA.length).toBeGreaterThan(0);
    expect(new Set(deA.map((e) => e.runId)).size).toBe(1);
    expect(deA[0].runId).toBe(a.runId);
    // A run não observada não emitiu nada — nem o seu, nem o da outra.
    expect(deB).toHaveLength(0);
  });
});
