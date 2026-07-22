import { OllamaProvider } from "@mimir/core";

/**
 * Exemplo de provider. Um provider é uma classe (aqui, subclasse de um
 * provider do engine) com as credenciais já configuradas — o framework a
 * instancia via `new LocalOllamaProvider()` ao executar o agente.
 */
export class LocalOllamaProvider extends OllamaProvider {
  constructor() {
    super({ host: "http://localhost:11434", model: "qwen2.5-coder:7b" });
  }
}
