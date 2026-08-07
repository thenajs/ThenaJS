/**
 * O que cada execução desta aplicação carrega.
 *
 * O ThenaJS não conhece este tipo — `run({ data })` é um canal aberto, e o
 * framework só transporta. Declarar a forma aqui é o que dispensa o cast a cada
 * leitura: em vez de `String(context().data.tenantId)`, fica
 * `context<DadosDaConta>().data.tenantId`, já `string`.
 *
 * **`type`, e não `interface extends DadosDaRun`.** Os dois compilam, mas uma
 * interface que estende `Record<string, unknown>` herda o índice livre, e aí
 * `ctx.data.campoQueNaoExiste` passa como `unknown` em vez de dar erro. Com
 * `type`, o typo é pego na compilação.
 */
export type DadosDaConta = {
  tenantId: string;
};
