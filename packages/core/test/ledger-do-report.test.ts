import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thena } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * A escala do índice do report.
 *
 * O índice deixou de ser reconstruído lendo as árvores de todas as runs — o que
 * custava 632 ms de event loop por run concluída com 5.000 runs na pasta — e
 * passou a sair de um ledger `runs.jsonl` append-only, renderizado fora do
 * caminho crítico. O ganho é real e está medido em `report.test.ts`.
 *
 * O que **estes** testes fixam é o que sobrou: o ledger não tem teto, e cada
 * render o relê inteiro. O custo por run saiu do caminho crítico, mas o custo
 * do render continua **linear no número de runs que a pasta já viu** — só que
 * com constante muito menor (uma linha de ~150 B em vez de uma árvore de 40 KB).
 *
 * Nada aqui é bug: é a característica do desenho, e ela é aceitável na escala
 * que o framework mira hoje. Estão aqui para o dia em que alguém acrescentar
 * rotação, compactação ou teto — aí estes testes falham, e é isso que se quer.
 *
 * Sem rede: o provider é o `FakeProvider` do harness.
 */

const LEDGER = "runs.jsonl";

/** Uma pasta de report vazia. */
function pasta(): string {
  return mkdtempSync(join(tmpdir(), "thena-ledger-"));
}

/** Escreve `n` linhas de ledger, como se `n` runs já tivessem acontecido. */
function seedFromDisk(dir: string, n: number): void {
  let bruto = "";
  for (let i = 0; i < n; i++) {
    bruto += `${JSON.stringify({
      runId: `antiga-${i}`,
      name: "FluxoAntigo",
      status: "ok",
      durationMs: 10,
      startedAt: 1_700_000_000_000 + i,
      html: true,
    })}\n`;
  }
  writeFileSync(join(dir, LEDGER), bruto);
}

/** Roda uma vez com report ligado e espera o índice ser renderizado. */
async function rodarComReport(dir: string, mensagem = "vai"): Promise<void> {
  const app = Thena.create(
    makeWorkflow([makeAgent({ provider: new FakeProvider() })]),
    { report: { dir } },
  );
  await app.run({ input: { message: mensagem } });
  // `dispose` drena os renders agendados — sem isso o índice pode não ter saído.
  await app.dispose();
}

const lines = (dir: string) =>
  readFileSync(join(dir, LEDGER), "utf-8").split("\n").filter(Boolean);

afterEach(() => vi.restoreAllMocks());

describe("o ledger cresce sem teto", () => {
  it("uma linha por run, e nada as remove", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = pasta();

    for (let i = 0; i < 5; i++) await rodarComReport(dir, `run ${i}`);

    // Exatamente uma linha por run: sem dedup, sem rotação, sem teto.
    expect(lines(dir)).toHaveLength(5);
  });

  it("uma run já registrada continua no ledger depois de outras 5", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = pasta();

    await rodarComReport(dir, "a primeira");
    const primeira = JSON.parse(lines(dir)[0]).runId;

    for (let i = 0; i < 5; i++) await rodarComReport(dir, `run ${i}`);

    // Nada envelhece e sai. É isso que faz o arquivo crescer para sempre.
    expect(lines(dir).map((l) => JSON.parse(l).runId)).toContain(primeira);
    expect(lines(dir)).toHaveLength(6);
  });
});

describe("cada render relê o ledger inteiro", () => {
  it("uma run nova faz o índice listar as 5.000 antigas de novo", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = pasta();
    seedFromDisk(dir, 5000);

    const antes = statSync(join(dir, LEDGER)).size;
    await rodarComReport(dir);

    const indice = readFileSync(join(dir, "index.html"), "utf-8");

    // A prova de que o render leu tudo: o índice cita a primeira e a última das
    // semeadas, mais a run nova. Nenhuma delas está em memória — só no arquivo.
    expect(indice).toContain("antiga-0");
    expect(indice).toContain("antiga-4999");
    expect(indice).toContain(JSON.parse(lines(dir).at(-1)!).runId);

    // O que o próximo render vai reler, em bytes. Uma run acrescenta ~150 B, e
    // esse total é relido **por completo** a cada render seguinte.
    const depois = statSync(join(dir, LEDGER)).size;
    const porRun = depois - antes;
    process.stdout.write(
      `\n  ledger: ${(depois / 1024).toFixed(0)} KB relidos por render` +
        ` · ~${porRun} B por run` +
        ` · projeção com 100k runs: ${((porRun * 100_000) / 1024 / 1024).toFixed(1)} MB\n`,
    );

    expect(porRun).toBeLessThan(400); // a linha é escalar, não a árvore
  }, 60_000);

  it("o índice fica correto mesmo com o ledger grande — ordenado do mais novo", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = pasta();
    seedFromDisk(dir, 2000);

    await rodarComReport(dir);

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    const nova = JSON.parse(lines(dir).at(-1)!).runId;

    // A run nova tem `startedAt` de agora, então vem antes de todas as
    // semeadas, cujo `startedAt` é de 2023.
    expect(indice.indexOf(nova)).toBeLessThan(indice.indexOf("antiga-1999"));
  }, 60_000);

  it("linha corrompida no meio não derruba o render", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = pasta();
    seedFromDisk(dir, 10);
    // Simula uma queda no meio de um append.
    writeFileSync(
      join(dir, LEDGER),
      readFileSync(join(dir, LEDGER), "utf-8") + '{"runId":"trunca',
    );

    await rodarComReport(dir);

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    expect(indice).toContain("antiga-0");
    expect(indice).toContain("antiga-9");
  });
});
