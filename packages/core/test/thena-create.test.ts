import { describe, expect, it } from "vitest";
import { Thena, bootstrapWorkflow } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/**
 * `Thena.create` é o ponto de entrada; `bootstrapWorkflow` é o nome antigo.
 *
 * A troca resolve duas coisas de uma vez. O nome colidia com o `bootstrap()`
 * que o próprio template do usuário declara — dois "bootstrap" em duas linhas.
 * E a função nunca precisou ser `async`: os `await` que existiam eram dos
 * métodos do objeto devolvido, não do corpo dela.
 */

function fluxo(resposta = "ok") {
  const provider = new FakeProvider([{ content: resposta }]);
  return { provider, Fluxo: makeWorkflow([makeAgent({ provider })]) };
}

describe("Thena.create", () => {
  it("devolve o app SEM precisar de await", async () => {
    const { Fluxo } = fluxo("pronto");

    // Sem `await` na criação: o valor já é o app, não uma Promise.
    const app = Thena.create(Fluxo, {});
    expect(typeof app.run).toBe("function");
    expect(app).not.toBeInstanceOf(Promise);

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("pronto");
    await app.dispose();
  });

  it("um `await` a mais continua funcionando — quem migrar sem pressa não quebra", async () => {
    const { Fluxo } = fluxo("pronto");

    // `await` sobre valor não-Promise resolve para o próprio valor.
    const app = await Thena.create(Fluxo, {});

    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("pronto");
    await app.dispose();
  });

  it("carrega os genéricos de saída e de `data`", async () => {
    type MinhaData = { conta: string };
    const { Fluxo } = fluxo("ok");

    const app = Thena.create<string, MinhaData>(Fluxo, {});
    await app.run({ input: { message: "x" }, data: { conta: "acme" } });
    await app.dispose();
  });
});

describe("bootstrapWorkflow (@deprecated)", () => {
  it("continua existindo e ainda é async — quem veio do 0.6 não quebra", async () => {
    const { Fluxo } = fluxo("do alias");

    const promessa = bootstrapWorkflow(Fluxo, {});
    // Diferente do `Thena.create`: o alias antigo devolve Promise, porque era
    // assim que estava publicado e `.then()` de alguém não pode parar de valer.
    expect(promessa).toBeInstanceOf(Promise);

    const app = await promessa;
    await expect(app.run({ input: { message: "vai" } })).resolves.toBe("do alias");
    await app.dispose();
  });

  it("produz um app equivalente ao do `Thena.create`", async () => {
    const a = fluxo("igual");
    const b = fluxo("igual");

    const antigo = await bootstrapWorkflow(a.Fluxo, {});
    const novo = Thena.create(b.Fluxo, {});

    const [x, y] = await Promise.all([
      antigo.run({ input: { message: "vai" } }),
      novo.run({ input: { message: "vai" } }),
    ]);
    await Promise.all([antigo.dispose(), novo.dispose()]);

    expect(x).toBe(y);
    expect(Object.keys(antigo).sort()).toEqual(Object.keys(novo).sort());
  });
});
