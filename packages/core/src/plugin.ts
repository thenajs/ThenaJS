import type { ExecutionEvent } from "./report/recorder.js";

/**
 * Um plugin observa a execução sem participar dela. Ele recebe o mesmo stream
 * de eventos que o `log` do config — vários podem coexistir, e nenhum toma o
 * lugar do outro.
 *
 * ```ts
 * const app = await bootstrapWorkflow(MeuWorkflow, config);
 * await app.use(thenaFlow({ port: 4100 }));
 * await app.run({ input: { message: "olá" } });
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

  /** Chamado por `app.dispose()`. Feche aqui o que o `setup` abriu. */
  dispose?(): void | Promise<void>;
}
