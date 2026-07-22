import { setToolMetadata } from "./metadata.js";
import type { ToolConfig } from "./types.js";

/**
 * Decorator de tool, no estilo `@Agent`/`@Workflow`.
 *
 * Registra `name`, `description` e `schema` da classe; a lógica fica no método
 * `execute(input)`. O framework monta a `ToolType` do engine a partir disso e
 * injeta as dependências do construtor (ex.: `WorkflowRuntime`) ao instanciar.
 */
export function Tool(config: ToolConfig): ClassDecorator {
  return (target) => {
    setToolMetadata(target, config);
  };
}
