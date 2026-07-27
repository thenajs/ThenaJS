/**
 * Ajustes de runtime do processo, definidos pelo `bootstrapWorkflow`.
 *
 * O engine (`@thenajs/agentflow`) não conhece política: ele só oferece o canal
 * (`ToolOutput.isError`). Quem decide o que fazer com um `throw` de tool é esta
 * camada — e o default preserva o comportamento histórico.
 */
export interface RuntimeSettings {
  /**
   * O que fazer quando o `execute` de uma tool lança:
   * - `"throw"` (default) — o erro sobe, passa por `onError` e pode derrubar a run;
   * - `"observe"` — vira observação `isError: true` de volta para o modelo, e o
   *   nó `tool` do report fica `status: "error"`.
   */
  toolErrors: "throw" | "observe";
}

const DEFAULTS: RuntimeSettings = { toolErrors: "throw" };

let current: RuntimeSettings = DEFAULTS;

export function setRuntimeSettings(overrides: Partial<RuntimeSettings>): void {
  current = { ...DEFAULTS, ...prune(overrides) };
}

export function resetRuntimeSettings(): void {
  current = DEFAULTS;
}

export function settings(): RuntimeSettings {
  return current;
}

/** Chaves `undefined` não devem sobrescrever o default. */
function prune(overrides: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
