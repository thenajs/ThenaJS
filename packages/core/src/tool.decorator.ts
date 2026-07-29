import { setToolMetadata } from "./metadata.js";
import type { ToolClass, ToolConfig } from "./types.js";

/**
 * Decorator de tool, no estilo `@Agent`/`@Workflow`.
 *
 * Registra `name`, `description` e `schema` da classe; a lógica fica no método
 * `execute(input)`. O framework monta a `ToolType` do engine a partir disso e
 * injeta as dependências do construtor (ex.: `WorkflowRuntime`) ao instanciar.
 *
 * O `target` é restrito a `ToolClass`: uma classe sem `execute(input)` já não
 * compila na declaração — o TypeScript infere o genérico a partir do construtor
 * decorado, então o erro aponta a classe, não uma chamada três camadas depois.
 */
export function Tool<T extends ToolClass>(config: ToolConfig): (target: T) => void {
  return (target) => {
    setToolMetadata(target, config);
  };
}
