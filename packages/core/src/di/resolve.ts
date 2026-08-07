import { Providers, VectorMemory } from "@thenajs/agentflow";
import { currentRun } from "../run-context.js";
import type { ProviderCtor, ProviderFactory, ProviderInput } from "../types.js";

/**
 * Instância já configurada é usada direto; classe é instanciada; factory é
 * chamada.
 *
 * Distinguir classe de factory sem `new.target` exige heurística: uma classe
 * tem `prototype` com métodos próprios, uma arrow function não tem `prototype`
 * nenhum. Chamar uma classe sem `new` lança `TypeError`, então na dúvida o
 * `try` resolve — e o custo é uma vez por execução.
 */
export function resolveProvider(input: ProviderInput): Providers {
  if (input instanceof Providers) return input;

  const fn = input as ProviderCtor | ProviderFactory;

  // Arrow function não tem `prototype` — só pode ser factory.
  if (!Object.prototype.hasOwnProperty.call(fn, "prototype")) {
    return (fn as ProviderFactory)();
  }

  try {
    return new (fn as ProviderCtor)();
  } catch (err) {
    // `function () { return new X() }` tem prototype mas não é construtor de
    // provider; e uma factory comum chamada com `new` devolveria o objeto errado.
    if (err instanceof TypeError) return (fn as ProviderFactory)();
    throw err;
  }
}

/**
 * Monta as memórias vetoriais injetadas no construtor do agente, **na ordem em
 * que os stores foram registrados** no `ThenaConfig`.
 *
 * Os stores são compartilhados por toda a aplicação — uma conexão e um
 * `ensureCollection` cada, independente de quantos agentes existem. O `embed()`
 * sai do provider do próprio agente, que já é público e aceita `embedModel`
 * para apontar um modelo dedicado.
 */
export function resolveMemory(provider: Providers): VectorMemory[] {
  return currentRun().settings.memory.map(
    (store) => new VectorMemory({ store, provider }),
  );
}
