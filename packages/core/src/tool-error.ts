/**
 * A falha de uma tool que **não** é recuperável pelo modelo.
 *
 * Por padrão, tudo que uma tool lança vira observação: o texto do erro volta
 * como resultado da tool, o modelo lê e tem a chance de corrigir no turno
 * seguinte. É o que faz um loop ReAct funcionar — arquivo que não existe,
 * argumento fora do schema, 404, timeout.
 *
 * Só que nem toda falha é assim. Um bug no código da tool, uma credencial
 * expirada ou um banco fora do ar não melhoram com retentativa: o modelo não
 * tem como consertar, e cada volta custa uma chamada. Pior, a mensagem de erro
 * de um driver costuma trazer coisa que não deveria chegar ao modelo nem ao
 * report em disco — connection string, host interno.
 *
 * Lance `FatalToolError` nesses casos: ela atravessa o agente e encerra a run.
 *
 * ```ts
 * async execute({ query }: { query: string }) {
 *     try {
 *         return await db.query(query);
 *     } catch (err) {
 *         // O modelo não conserta um banco fora do ar — e a mensagem original
 *         // não vai para o contexto dele.
 *         throw new FatalToolError("banco indisponível", { cause: err });
 *     }
 * }
 * ```
 *
 * Para o caminho oposto — erro recuperável, com mensagem escrita por você —
 * devolva `{ content, isError: true }` em vez de lançar. É melhor que deixar
 * o `err.message` cru virar observação.
 */
export class FatalToolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FatalToolError";
  }
}
