import { Thena } from "@thenajs/core";
import { AssistantWorkflow } from "./workflows/assistant.workflow";
import { config } from "./config";
import type { DadosDaConta } from "./execucao";

async function bootstrap() {
  // O genérico vale para as duas pontas: aqui o `data` do `run()` é
  // **checado**, e lá dentro o `context<DadosDaConta>()` devolve os campos já
  // tipados.
  const app = Thena.create<string, DadosDaConta>(AssistantWorkflow, config);

  // `data` é o canal da execução: o framework transporta e propaga, sem
  // interpretar — e sem enviar ao modelo.
  //
  // Dois lugares o leem, pelo mesmo `context()`: a factory do provider (antes
  // do primeiro passo) e a tool (dentro dele).
  const pergunta = "Chame a tool quem_sou e repita a resposta dela.";

  const acme = await app.run({
    input: { message: pergunta },
    data: { tenantId: "acme" },
  });

  const globex = await app.run({
    input: { message: pergunta },
    data: { tenantId: "globex" },
  });

  console.log("\nacme   →", String(acme).trim());
  console.log("globex →", String(globex).trim());

  await app.dispose();
}

bootstrap();
