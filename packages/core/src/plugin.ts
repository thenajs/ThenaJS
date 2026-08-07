import type { ExecutionEvent } from "./observability/recorder.js";
import type { ChatMiddleware } from "./middleware/chat.js";
import type { ToolMiddleware } from "./middleware/tool.js";

/**
 * Um plugin acopla comportamento à execução. Vários podem coexistir, e nenhum
 * toma o lugar do outro.
 *
 * Há dois modos, combináveis no mesmo plugin:
 *
 * - **observar** — `onEvent` recebe o mesmo stream que o `log` do config;
 * - **interceptar** — `tool` e `chat` envolvem cada execução de tool e cada
 *   chamada ao modelo, podendo medir, transformar ou curto-circuitar.
 *
 * ```ts
 * const app = Thena.create(MeuWorkflow, config);
 *
 * await app.use(thenaFlow({ port: 4100 }));   // observa
 *
 * await app.use({                              // intercepta
 *   name: "cache",
 *   chat: async (inv, next) => {
 *     const guardado = cache.get(chave(inv.messages));
 *     if (guardado) {
 *       inv.meta({ cacheHit: true });          // aparece no report e no Flow
 *       return guardado;
 *     }
 *     return cache.set(chave(inv.messages), await next());
 *   },
 * });
 * ```
 */
export interface ThenaPlugin {
  /** Nome curto, usado em mensagens de erro. */
  name: string;

  /**
   * Chamado uma vez, no `use()`. É onde um plugin sobe servidor, abre arquivo
   * ou conecta em algo. Se lançar, o `use()` rejeita — falha na configuração
   * deve aparecer antes da execução, não no meio dela.
   */
  setup?(): void | Promise<void>;

  /**
   * Cada início e fim de passo. Chamado de forma isolada: se lançar, a exceção
   * é engolida e nem a execução nem os outros plugins são afetados.
   */
  onEvent?(event: ExecutionEvent): void;

  /**
   * Envolve cada execução de tool. Diferente do `onEvent`, este **participa**:
   * um `throw` daqui derruba a run, e devolver sem chamar `next()` substitui a
   * execução.
   *
   * Para negar de forma recuperável — o modelo lê e tenta outra coisa —
   * devolva `{ content, isError: true }` em vez de lançar.
   */
  tool?: ToolMiddleware;

  /** Envolve cada chamada ao modelo. Mesmas regras do `tool`. */
  chat?: ChatMiddleware;

  /** Chamado por `app.dispose()`. Feche aqui o que o `setup` abriu. */
  dispose?(): void | Promise<void>;
}
