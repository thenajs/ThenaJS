import { describe, expect, it } from "vitest";
import { Thena, loop, untilAnswered } from "@thenajs/core";
import { FakeProvider, criarAgente, criarWorkflow } from "./harness.js";

/**
 * O caminho do token, de ponta a ponta:
 *
 *   provider (emite) → ChatParams.onToken → RunContext → canal → RunHandle
 *
 * Nenhuma ponta conhece a outra. O canal de token é separado do de eventos
 * porque token não é um passo da execução: não tem início, fim nem status.
 */

function fluxo(...respostas: string[]) {
  const provider = new FakeProvider(respostas.map((content) => ({ content })));
  return { provider, Fluxo: criarWorkflow([criarAgente({ provider })]) };
}

describe("onToken", () => {
  it("entrega o texto em pedaços, na ordem", async () => {
    const { Fluxo } = fluxo("Olá mundo bonito");
    const app = Thena.create(Fluxo, {});

    const pedacos: string[] = [];
    const exec = app.run({ input: { message: "vai" }, observe: true });
    exec.onToken((t) => pedacos.push(t));
    const texto = await exec;
    await app.dispose();

    expect(pedacos.length).toBeGreaterThan(1);
    expect(pedacos.join("")).toBe("Olá mundo bonito");
    expect(texto).toBe("Olá mundo bonito");
  });

  it("quem assina atrasado recebe o texto que já saiu", async () => {
    const { Fluxo } = fluxo("um dois tres");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    await exec; // assina só depois de tudo pronto

    const pedacos: string[] = [];
    exec.onToken((t) => pedacos.push(t));
    await app.dispose();

    // Sem o buffer, um cliente que conecta tarde começaria do meio da frase.
    expect(pedacos.join("")).toBe("um dois tres");
  });

  it("acumula os turnos de um loop no mesmo stream", async () => {
    const provider = new FakeProvider([
      { content: "primeiro " },
      { content: "segundo" },
    ]);
    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider })],
        until: (ctx) => ctx.turn?.response === "segundo",
        maxIterations: 5,
      }),
    ]);
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const pedacos: string[] = [];
    exec.onToken((t) => pedacos.push(t));
    await exec;
    await app.dispose();

    expect(pedacos.join("")).toBe("primeiro segundo");
  });

  it("cancelar a assinatura impede os tokens seguintes", async () => {
    // Com delay, os tokens saem **depois** da assinatura — sem ele o fake
    // emite tudo de forma síncrona durante o `run()`, e o que se veria seria o
    // replay do buffer, não a entrega ao vivo.
    const provider = new FakeProvider([{ content: "a b c d e" }], { delayMs: 20 });
    const app = Thena.create(criarWorkflow([criarAgente({ provider })]), {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const pedacos: string[] = [];
    const parar = exec.onToken((t) => pedacos.push(t));
    parar();
    await exec;
    await app.dispose();

    expect(pedacos).toHaveLength(0);
  });

  it("um assinante que lança não derruba a execução", async () => {
    const { Fluxo } = fluxo("intacto");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    exec.onToken(() => {
      throw new Error("assinante ruim");
    });

    await expect(exec).resolves.toBe("intacto");
    await app.dispose();
  });
});

describe("textStream", () => {
  it("percorre o texto com for await e termina junto com a execução", async () => {
    const { Fluxo } = fluxo("um dois tres");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const pedacos: string[] = [];
    for await (const t of exec.textStream) pedacos.push(t);

    expect(pedacos.join("")).toBe("um dois tres");
    await app.dispose();
  });

  it("é um canal separado do eventStream", async () => {
    const { Fluxo } = fluxo("texto");
    const app = Thena.create(Fluxo, {});

    const exec = app.run({ input: { message: "vai" }, observe: true });
    const eventos: unknown[] = [];
    const tokens: string[] = [];
    exec.onEvent((e) => eventos.push(e));
    exec.onToken((t) => tokens.push(t));
    await exec;
    await app.dispose();

    // Token não polui a árvore de passos, e passo não polui o texto.
    expect(tokens.join("")).toBe("texto");
    expect(eventos.every((e) => typeof (e as any).kind === "string")).toBe(true);
  });
});

describe("o sink é o que liga o streaming", () => {
  it("com observe, o provider recebe o sink e transmite", async () => {
    const { provider, Fluxo } = fluxo("x");
    const app = Thena.create(Fluxo, {});
    await app.run({ input: { message: "vai" }, observe: true }).result;
    await app.dispose();

    expect(provider.chamadas[0].streaming).toBe(true);
  });

  it("SEM observador, o provider NÃO recebe sink — nada de stream à toa", async () => {
    const { provider, Fluxo } = fluxo("x");
    const app = Thena.create(Fluxo, {});
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    // O handle já ofereceu um sink em toda run, e isso fazia o provider pedir
    // resposta em stream — com parsing de SSE e um callback por pedaço — mesmo
    // sem ninguém ler um único token.
    expect(provider.chamadas[0].streaming).toBe(false);
  });

  it("um plugin que observa também liga o streaming", async () => {
    const { provider, Fluxo } = fluxo("x");
    const app = Thena.create(Fluxo, {});
    await app.use({ name: "olheiro", onEvent: () => {} });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(provider.chamadas[0].streaming).toBe(true);
  });

  it("runWorkflow direto, sem app, não transmite", async () => {
    const { runWorkflow } = await import("@thenajs/core");
    const { provider, Fluxo } = fluxo("x");

    await runWorkflow(Fluxo, "vai");

    // Sem `bootstrapWorkflow` não há canal — e sem canal o provider faz a
    // requisição normal, com uma resposta só.
    expect(provider.chamadas[0].streaming).toBe(false);
  });
});
