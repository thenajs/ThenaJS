import { OllamaProvider, context } from "@thenajs/core";
import type { DadosDaConta } from "../execucao";

/** O modelo de cada tenant. */
const MODELO: Record<string, string> = {
  acme: "qwen2.5:3b",
  globex: "qwen2.5-coder:1.5b",
};

/**
 * Provider como **factory** em vez de classe.
 *
 * A factory é chamada uma vez por execução, já dentro do escopo da run — e é
 * por isso que ela consegue ler, com `context()`, o `data` que veio no
 * `app.run({ data })`.
 *
 * O genérico é o que faz `tenantId` já chegar como `string`: sem ele, `data` é
 * `Record<string, unknown>` e todo acesso precisaria de `String(...)`.
 */
export const providerDoTenant = () => {
  const { tenantId } = context<DadosDaConta>().data;
  const model = MODELO[tenantId];

  console.log(`[provider] tenantId=${tenantId} → model=${model}`);

  return new OllamaProvider({ host: "http://localhost:11434", model });
};
