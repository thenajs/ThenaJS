import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@thenajs/core";
import { FlowServer } from "../src/server/server.js";

/**
 * O contrato do fio entre o servidor e o navegador: rotas, nomes de evento SSE
 * e formato do frame.
 *
 * Este arquivo existe porque o protocolo era a única fronteira de rede do repo
 * sem verificação nenhuma — `memory.test.ts` fixa o **formato dos dados**, mas
 * nada olhava a camada HTTP. Renomear uma rota ou um nome de evento passava por
 * lint, typecheck e suíte, e só quebrava no navegador, que não é testado.
 *
 * O protocolo é interno ao pacote (ADR-021): servidor e UI são publicados
 * juntos. Isto aqui não é promessa a terceiros — é o que impede os dois lados
 * de divergirem em silêncio.
 */

function evento(over: Partial<ExecutionEvent> & { runId: string }): ExecutionEvent {
  return {
    phase: "start",
    kind: "workflow",
    name: "Fluxo",
    depth: 0,
    id: `${over.runId}-${over.depth ?? 0}-${over.phase ?? "start"}`,
    ...over,
  };
}

/** Porta efêmera: o FlowServer monta a `url` a partir dela, então 0 não serve. */
function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Lê frames SSE um a um, respeitando a linha em branco que os separa. */
function leitorDeFrames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async proximo(): Promise<{ event: string; data: unknown }> {
      while (!buffer.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("o stream fechou antes do frame");
        buffer += decoder.decode(value, { stream: true });
      }
      const bruto = buffer.slice(0, buffer.indexOf("\n\n"));
      buffer = buffer.slice(buffer.indexOf("\n\n") + 2);

      const event = /^event: (.+)$/m.exec(bruto)?.[1] ?? "";
      const data = /^data: (.+)$/m.exec(bruto)?.[1] ?? "";
      return { event, data: data ? JSON.parse(data) : undefined };
    },
    cancel: () => reader.cancel(),
  };
}

let server: FlowServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function subir(): Promise<FlowServer> {
  server = new FlowServer({ port: await portaLivre(), log: false });
  await server.start();
  return server;
}

describe("protocolo do Flow", () => {
  it("a rota do stream é /api/events e abre com o frame `snapshot`", async () => {
    const flow = await subir();
    flow.publish(evento({ runId: "A", name: "FluxoA" }));

    const res = await fetch(`${flow.url}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const frames = leitorDeFrames(res.body!);
    const primeiro = await frames.proximo();

    expect(primeiro.event).toBe("snapshot");
    const snapshot = primeiro.data as Record<string, unknown>;
    // As três chaves do FlowSnapshot, com o id da run em `currentRunId`.
    expect(Object.keys(snapshot).sort()).toEqual(["currentRunId", "events", "runs"]);
    expect(snapshot.currentRunId).toBe("A");

    await frames.cancel();
  });

  it("um evento publicado vira os frames `run` e `event`, nessa ordem", async () => {
    const flow = await subir();

    const res = await fetch(`${flow.url}/api/events`);
    const frames = leitorDeFrames(res.body!);
    await frames.proximo(); // o snapshot de abertura

    flow.publish(evento({ runId: "B", name: "FluxoB" }));

    const run = await frames.proximo();
    expect(run.event).toBe("run");
    // O vocabulário do FlowRun, em inglês e alinhado ao ExecutionEvent do core.
    expect(run.data).toMatchObject({ id: "B", name: "FluxoB", status: "running" });
    expect(typeof (run.data as { startedAt: number }).startedAt).toBe("number");

    const single = await frames.proximo();
    expect(single.event).toBe("event");
    expect(single.data).toMatchObject({ runId: "B", seq: 0 });

    await frames.cancel();
  });

  it("uma run terminada reporta `durationMs` e status `ok`", async () => {
    const flow = await subir();

    const res = await fetch(`${flow.url}/api/events`);
    const frames = leitorDeFrames(res.body!);
    await frames.proximo();

    flow.publish(evento({ runId: "C", name: "FluxoC" }));
    await frames.proximo();
    await frames.proximo();

    flow.publish(evento({ runId: "C", phase: "end", status: "ok", durationMs: 42 }));
    const run = await frames.proximo();

    expect(run.event).toBe("run");
    expect(run.data).toMatchObject({ status: "ok", durationMs: 42 });

    await frames.cancel();
  });

  it("/api/runs/:id devolve os eventos da run, e 404 em inglês quando não há", async () => {
    const flow = await subir();
    flow.publish(evento({ runId: "D", name: "FluxoD" }));

    const achou = await fetch(`${flow.url}/api/runs/D`);
    expect(achou.status).toBe(200);
    expect(await achou.json()).toMatchObject({ events: [{ runId: "D", seq: 0 }] });

    const nao = await fetch(`${flow.url}/api/runs/nao-existe`);
    expect(nao.status).toBe(404);
    expect(await nao.json()).toEqual({ error: "run not found" });
  });

  it("a rota antiga /api/eventos não responde mais como stream", async () => {
    const flow = await subir();

    // Sem isto, um rename pela metade — servidor novo, navegador velho — passaria
    // despercebido: a rota antiga cairia no servidor de arquivos e devolveria
    // algo, em vez de falhar.
    const res = await fetch(`${flow.url}/api/eventos`);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    await res.body?.cancel();
  });
});
