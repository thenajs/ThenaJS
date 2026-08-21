import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@thenajs/core";
import { buildTree, layout } from "../src/ui/graph.js";
import type { FlowEvent } from "../src/types.js";

/**
 * As duas funções puras que transformam o stream de eventos no grafo.
 *
 * Existem testes aqui porque este arquivo já publicou dois bugs de runtime na
 * `0.9.0`: `layout` chamava `.has` num array (`TypeError` na primeira aresta) e
 * emitia `type: "passo"` enquanto o `App.tsx` registrava `{ step: StepNode }`.
 * O typecheck da UI, agora no CI, pega o primeiro; o segundo é um par de strings
 * que precisa combinar e nenhum compilador confere. Daí estas asserções.
 */

let n = 0;
function evento(over: Partial<FlowEvent> & { id: string }): FlowEvent {
  return {
    phase: "start",
    kind: "agent",
    name: "Passo",
    runId: "R",
    depth: 1,
    seq: n++,
    at: Date.now(),
    ...over,
  } as FlowEvent;
}

/** workflow → agent → chat: a árvore mínima que qualquer run produz. */
function arvoreDeUmaRun(): FlowEvent[] {
  return [
    evento({ id: "w", kind: "workflow", name: "Fluxo", depth: 0 }),
    evento({ id: "a", kind: "agent", name: "Agente", parentId: "w" }),
    evento({ id: "c", kind: "chat", name: "Chat", parentId: "a", depth: 2 }),
    evento({
      id: "c",
      phase: "end",
      status: "ok",
      durationMs: 12,
      parentId: "a",
      depth: 2,
    }),
    evento({ id: "a", phase: "end", status: "ok", durationMs: 20, parentId: "w" }),
    evento({ id: "w", phase: "end", status: "ok", durationMs: 25, depth: 0 }),
  ];
}

describe("buildTree", () => {
  it("reduz start/end a um nó por id, com o resultado do end", () => {
    const arvore = buildTree(arvoreDeUmaRun());

    expect([...arvore.keys()].sort()).toEqual(["a", "c", "w"]);
    expect(arvore.get("a")!.data).toMatchObject({
      label: "Agente",
      kind: "agent",
      workflowState: "ok",
      durationMs: 20,
    });
    expect(arvore.get("w")!.children).toEqual(["a"]);
  });

  it("um passo que ainda não terminou fica `running`", () => {
    const arvore = buildTree([evento({ id: "w", kind: "workflow", depth: 0 })]);
    expect(arvore.get("w")!.data.workflowState).toBe("running");
  });
});

describe("layout", () => {
  it("liga cada nó ao pai — uma aresta por relação", () => {
    // A regressão que este teste existe para pegar: a checagem de pai era feita
    // no array de saída em vez do mapa da árvore, e lançava antes de chegar aqui.
    const { nodes, edges } = layout(buildTree(arvoreDeUmaRun()));

    expect(nodes).toHaveLength(3);
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      "a->c",
      "w->a",
    ]);
  });

  it("o tipo do nó é o que o App registra em NODE_TYPES", () => {
    const { nodes } = layout(buildTree(arvoreDeUmaRun()));
    // `type` é uma string casada à mão com `NODE_TYPES = { step: StepNode }`.
    // Divergir não é erro de tipo: o React Flow silenciosamente usa o nó padrão.
    expect(new Set(nodes.map((no) => no.type))).toEqual(new Set(["step"]));
  });

  it("um nó órfão vira raiz, sem aresta pendurada", () => {
    const { nodes, edges } = layout(
      buildTree([evento({ id: "orfao", parentId: "quem-nao-existe" })]),
    );

    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });
});
