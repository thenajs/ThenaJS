import { Thena } from "@thenajs/core";
import { SmokeWorkflow } from "./workflows/smoke.workflow.js";

/**
 * Smoke test contra um modelo de verdade.
 *
 * Os 501 testes da suíte usam um provider falso: eles provam o framework, não
 * a conversa com a API. Isto cobre o que falta — HTTP real, tradução para o
 * formato do provider, a tool call que o modelo de fato emite, e o prompt em
 * inglês sendo lido por um modelo.
 *
 * Roda em `push` para `main`, nunca em pull request: o repositório é público,
 * e um workflow com segredo disparado por PR de fork é o vetor de exfiltração
 * mais explorado do GitHub Actions.
 */
/** O agente inspeciona o próprio repositório — é o que torna o teste real. */

async function main() {
  const app = Thena.create(SmokeWorkflow, { log: true });

  // Um plugin conta o que realmente aconteceu. Asserção sobre **efeito**: a
  // resposta de um modelo não é determinística, mas "chamou a tool" é.
  const toolsCalled: string[] = [];
  // Como o loop terminou. Sem isto, uma execução que só leu arquivos até bater
  // no teto passava no teste: `output` era o conteúdo cru da última tool, e
  // "tem texto" dava verdadeiro. O agente nunca tinha respondido.
  let stoppedBy: unknown;

  await app.use({
    name: "smoke-probe",
    tool: async (inv, next) => {
      toolsCalled.push(inv.name);
      return next();
    },
    onEvent: (e) => {
      if (e.kind === "loop" && e.phase === "end") stoppedBy = e.data?.stoppedBy;
    },
  });

  const answer = await app.run({
    prompt: "What changed in this repository? Summarise the uncommitted work.",
    // O teto é do próprio framework — usá-lo aqui também é dogfooding. Um loop
    // com bug esvazia crédito enquanto ninguém olha; `throw` faz o job falhar
    // em vez de terminar verde com resposta pela metade.
    budget: { maxChatCalls: 6, maxCostUsd: 0.05, mode: "throw" },
  });

  await app.dispose();

  // O que precisa ser verdade para o framework estar vivo de ponta a ponta.
  check(toolsCalled.includes("shell"), "o modelo não chamou a tool `shell`");
  check(answer.trim().length > 0, "a execução terminou sem resposta");
  // `until` significa que o agente respondeu sem chamar tool — convergiu.
  // Qualquer outro motivo (`exhausted`, `fails`, `budget`) é o teto cortando.
  check(stoppedBy === "until", `o loop parou por "${stoppedBy}", não por convergência`);

  console.log(`\n[smoke] ok — tools: ${toolsCalled.join(", ")}`);
  console.log(`[smoke] resposta: ${answer.trim().slice(0, 200)}`);
}

/** Falha com código != 0, que é o que o CI lê. */
function check(condition: boolean, whatWentWrong: string): void {
  if (!condition) {
    console.error(`[smoke] FALHOU: ${whatWentWrong}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke] FALHOU:", err instanceof Error ? err.message : err);
  process.exit(1);
});
