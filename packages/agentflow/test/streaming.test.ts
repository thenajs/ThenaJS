import { describe, expect, it } from "vitest";
import z from "zod";
import { OllamaProvider, OpenAIProvider } from "../src/providers/index.js";
import type { ToolType } from "../src/tools/index.js";

/**
 * Streaming nos dois providers.
 *
 * O `request` é stubado: o que se testa é a leitura do corpo e a remontagem do
 * turno — nada aqui toca a rede.
 */

const enc = new TextEncoder();

function resposta(body: string, pedacos = 1): Response {
  const bytes = enc.encode(body);
  const tamanho = Math.ceil(bytes.length / pedacos);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += tamanho) {
        c.enqueue(bytes.slice(i, i + tamanho));
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const tool: ToolType = {
  name: "ler",
  description: "lê",
  schema: z.object({ path: z.string() }),
  execute: async () => "ok",
};

/** Provider com o transporte trocado por um corpo fixo. */
function comCorpo<P extends OllamaProvider | OpenAIProvider>(
  provider: P,
  body: string,
  pedacos = 1,
): { provider: P; body: () => any } {
  let enviado: any;
  (provider as any).request = async (_url: string, init: RequestInit) => {
    enviado = JSON.parse(String(init.body));
    return { response: resposta(body, pedacos), attempts: 1 };
  };
  return { provider, body: () => enviado };
}

describe("Ollama", () => {
  const ndjson = [
    '{"message":{"content":"Olá"},"done":false}',
    '{"message":{"content":", mundo"},"done":false}',
    '{"message":{"content":"!"},"done":false}',
    '{"done":true,"prompt_eval_count":12,"eval_count":3}',
  ].join("\n");

  it("sem onToken, não pede stream", async () => {
    const { provider, body } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      '{"message":{"content":"tudo de uma vez"}}',
    );
    const turno = await provider.chat({ tools: [], messages: [] });

    expect(body().stream).toBe(false);
    expect(turno.assistant.content).toBe("tudo de uma vez");
  });

  it("com onToken, transmite os pedaços e junta o texto", async () => {
    const { provider, body } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      ndjson,
    );

    const tokens: string[] = [];
    const turno = await provider.chat({
      tools: [],
      messages: [],
      onToken: (t) => tokens.push(t),
    });

    expect(body().stream).toBe(true);
    expect(tokens).toEqual(["Olá", ", mundo", "!"]);
    expect(turno.assistant.content).toBe("Olá, mundo!");
  });

  it("colhe o usage da última linha", async () => {
    const { provider } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      ndjson,
    );
    const turno = await provider.chat({ tools: [], messages: [], onToken: () => {} });

    expect(turno.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });

  it("funciona com o corpo partido em muitos pedaços de bytes", async () => {
    const { provider } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      ndjson,
      37, // parte no meio das linhas
    );
    const tokens: string[] = [];
    const turno = await provider.chat({
      tools: [],
      messages: [],
      onToken: (t) => tokens.push(t),
    });

    expect(turno.assistant.content).toBe("Olá, mundo!");
    expect(tokens.join("")).toBe("Olá, mundo!");
  });

  it("tool call chega inteira numa linha e é executada", async () => {
    const body = [
      '{"message":{"content":""},"done":false}',
      '{"message":{"tool_calls":[{"function":{"name":"ler","arguments":{"path":"a.ts"}}}]},"done":false}',
      '{"done":true}',
    ].join("\n");
    const { provider } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      body,
    );

    const turno = await provider.chat({
      tools: [tool],
      messages: [],
      onToken: () => {},
    });

    expect(turno.assistant.toolCalls?.[0]).toMatchObject({
      name: "ler",
      source: "native",
    });
    expect(turno.tool?.content).toBe("ok");
  });

  it("linha corrompida não derruba a geração", async () => {
    const body = [
      '{"message":{"content":"a"},"done":false}',
      "{ isto nao e json",
      '{"message":{"content":"b"},"done":true}',
    ].join("\n");
    const { provider } = comCorpo(
      new OllamaProvider({ host: "http://x", model: "m" }),
      body,
    );

    const turno = await provider.chat({ tools: [], messages: [], onToken: () => {} });
    expect(turno.assistant.content).toBe("ab");
  });
});

describe("OpenAI", () => {
  const sse = (...objs: unknown[]) =>
    objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n";

  it("sem onToken, não pede stream", async () => {
    const { provider, body } = comCorpo(
      new OpenAIProvider({ apiKey: "k" }),
      JSON.stringify({ choices: [{ message: { content: "inteiro" } }] }),
    );
    const turno = await provider.chat({ tools: [], messages: [] });

    expect(body().stream).toBeUndefined();
    expect(turno.assistant.content).toBe("inteiro");
  });

  it("com onToken, pede stream e usage, e transmite os deltas", async () => {
    const sseBody = sse(
      { choices: [{ delta: { content: "Olá" } }] },
      { choices: [{ delta: { content: " mundo" } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 9, completion_tokens: 2 } },
    );
    const { provider, body } = comCorpo(new OpenAIProvider({ apiKey: "k" }), sseBody);

    const tokens: string[] = [];
    const turno = await provider.chat({
      tools: [],
      messages: [],
      onToken: (t) => tokens.push(t),
    });

    expect(body().stream).toBe(true);
    expect(body().stream_options).toEqual({ include_usage: true });
    expect(tokens).toEqual(["Olá", " mundo"]);
    expect(turno.assistant.content).toBe("Olá mundo");
    expect(turno.usage).toEqual({ promptTokens: 9, completionTokens: 2 });
  });

  it("remonta a tool call fragmentada — nome num chunk, args em vários", async () => {
    const body = sse(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "ler", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] } },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a' } }] } },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '.ts"}' } }] } },
        ],
      },
    );
    const { provider } = comCorpo(new OpenAIProvider({ apiKey: "k" }), body);

    const turno = await provider.chat({
      tools: [tool],
      messages: [],
      onToken: () => {},
    });

    expect(turno.assistant.toolCalls?.[0]).toMatchObject({
      id: "call_1",
      name: "ler",
      arguments: { path: "a.ts" },
    });
    expect(turno.tool?.content).toBe("ok");
  });

  it("o `index` é o que amarra os fragmentos, não a ordem de chegada", async () => {
    // Duas tool calls no mesmo turno, com os fragmentos intercalados.
    const body = sse(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "a",
                  function: { name: "ler", arguments: '{"path":"' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "b",
                  function: { name: "ler", arguments: '{"path":"' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 1, function: { arguments: 'dois.ts"}' } }] },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'um.ts"}' } }] } },
        ],
      },
    );
    const { provider } = comCorpo(new OpenAIProvider({ apiKey: "k" }), body);

    // O framework só honra a primeira, mas a remontagem tem que estar certa
    // nas duas — concatenar por ordem de chegada daria "dois.tsum.ts".
    const turno = await provider.chat({
      tools: [tool],
      messages: [],
      onToken: () => {},
    });

    expect(turno.assistant.toolCalls?.[0]).toMatchObject({
      id: "a",
      arguments: { path: "um.ts" },
    });
  });

  it("payload corrompido não derruba a geração", async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n` +
      "data: { isto nao e json\n\n" +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}\n\n` +
      "data: [DONE]\n\n";
    const { provider } = comCorpo(new OpenAIProvider({ apiKey: "k" }), body);

    const turno = await provider.chat({ tools: [], messages: [], onToken: () => {} });
    expect(turno.assistant.content).toBe("ab");
  });
});
