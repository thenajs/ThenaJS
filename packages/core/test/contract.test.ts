import { describe, expect, it } from "vitest";
import type { AgentContract, AgentContractContext, Message } from "@thenajs/core";
import { DefaultAgentContract, runWorkflow } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

describe("AgentContract", () => {
  it("serializa um formato arbitrário como o único contexto do modelo", async () => {
    const provider = new FakeProvider();

    class Contract implements AgentContract {
      build(ctx: AgentContractContext) {
        return {
          question: ctx.input,
          memory: ctx.memory,
          previousMessages: ctx.history,
        };
      }
    }

    const Agent = makeAgent({ provider, contract: Contract });
    await runWorkflow(makeWorkflow([Agent]), "pergunta", undefined, {
      seed: { memory: ["fato"] },
    });

    expect(provider.chamadas[0].messages).toEqual([
      {
        role: "user",
        content: JSON.stringify({
          question: "pergunta",
          memory: ["fato"],
          previousMessages: [{ role: "user", content: "pergunta" }],
        }),
      },
    ]);
  });

  it("aceita build assíncrono e Message[] sem reserializar", async () => {
    const provider = new FakeProvider();
    const messages: Message[] = [{ role: "system", content: "do banco vetorial" }];

    class Contract implements AgentContract<Message[]> {
      async build() {
        await Promise.resolve();
        return messages;
      }
    }

    await runWorkflow(
      makeWorkflow([makeAgent({ provider, contract: Contract })]),
      "pergunta",
    );

    expect(provider.chamadas[0].messages).toEqual(messages);
  });

  it("o contrato padrão explícito preserva prompt, memory, tasks e history", async () => {
    const provider = new FakeProvider();
    await runWorkflow(
      makeWorkflow([makeAgent({ provider, contract: DefaultAgentContract })]),
      "pergunta",
      undefined,
      { seed: { memory: ["fato"], tasks: ["agir"] } },
    );

    expect(provider.chamadas[0].messages).toEqual([
      { role: "system", content: "You are a test agent.\n" },
      { role: "system", content: "fato\n\nTasks:\n- agir" },
      { role: "user", content: "pergunta" },
    ]);
  });
});
