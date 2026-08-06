import { Providers, VectorMemory } from "@thenajs/agentflow";
import { currentRun } from "../run-context.js";
import type { ProviderCtor, ProviderInput } from "../types.js";

/** Instância já configurada é usada direto; classe é instanciada. */
export function resolveProvider(input: ProviderInput): Providers {
  return input instanceof Providers ? input : new (input as ProviderCtor)();
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
