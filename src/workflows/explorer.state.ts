/**
 * O estado desta execução — o "arquivo de estado" do workflow.
 *
 * Os valores iniciais são as próprias inicializações de campo. O framework
 * instancia esta classe **uma vez por execução** e entrega a mesma instância a
 * quem pedir com `@state()`, e ao `until` dos loops como segundo parâmetro.
 */
export class ExplorerState {
  /** O revisor aprovou? É o que encerra o loop. */
  aprovado = false;

  /** Quantas rodadas de revisão já aconteceram. */
  rodadas = 0;

  /** O que o revisor apontou em cada rodada que reprovou. */
  apontamentos: string[] = [];

  /** Arquivos que a tool já leu — o revisor usa para saber o que foi olhado. */
  arquivosLidos: string[] = [];
}
