import { Providers, VectorMemory } from "@thenajs/agentflow";
import { currentRun } from "../run-context.js";
import type { ProviderCtor, ProviderFactory, ProviderInput } from "../types.js";

/**
 * Instância já configurada é usada direto; classe é instanciada; factory é
 * chamada.
 *
 * Classe e factory se distinguem pela **cadeia de protótipo**, não por tentar
 * `new` e ver o que acontece: todo provider estende `Providers`, então
 * `fn.prototype instanceof Providers` responde sem executar nada. Arrow
 * function e `async function` têm `prototype === undefined`, e `undefined
 * instanceof` é `false` sem lançar.
 *
 * A heurística anterior era um `try { new fn() } catch (TypeError)`, e o corpo
 * do construtor rodava dentro do `try`. Um `TypeError` do construtor do usuário
 * — variável de ambiente faltando, config `undefined` desestruturada — era lido
 * como "não dava para chamar com `new`", o erro real sumia, e o que subia era
 * `Class constructor X cannot be invoked without 'new'`: uma mensagem sobre
 * semântica de `new` para um problema de `.env`. Uma factory declarada como
 * `function` (tem `prototype`) ainda por cima rodava duas vezes.
 */
export function resolveProvider(input: ProviderInput): Providers {
  if (input instanceof Providers) return input;

  const fn = input as ProviderCtor | ProviderFactory;
  if (fn.prototype instanceof Providers) return new (fn as ProviderCtor)();

  // Sem esta checagem, uma classe que não estende `Providers` cairia na branch
  // de factory e morreria com a mesma mensagem enganosa de antes.
  if (/^class[\s{]/.test(Function.prototype.toString.call(fn))) {
    throw new Error(
      `[thena] ${fn.name || "The provider"} looks like a provider class but does ` +
        `not extend Providers. Extend the base class, or pass an instance.`,
    );
  }

  return (fn as ProviderFactory)();
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
