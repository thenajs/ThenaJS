import type { Edge, Node } from "@xyflow/react";
import type { FlowEvent } from "../tipos.js";

export interface NodeData extends Record<string, unknown> {
  rotulo: string;
  kind: FlowEvent["kind"];
  workflowState: "rodando" | "ok" | "error";
  duracaoMs?: number;
  fail?: string;
  payload?: Record<string, unknown>;
}

export type FlowNode = Node<NodeData>;

interface Bruto {
  id: string;
  parentId?: string;
  dados: NodeData;
  filhos: string[];
}

const WIDTH = 200;
const HEIGHT = 52;
const GAP_X = 96;
const GAP_Y = 22;

/**
 * Reduz o stream de eventos à árvore da execução. O recorder já emite `id` e
 * `parentId`, então não há nada a inferir: `start` cria o nó, `end` o fecha.
 */
export function buildTree(events: FlowEvent[]): Map<string, Bruto> {
  const nos = new Map<string, Bruto>();

  for (const evento of events) {
    if (evento.phase === "start") {
      if (nos.has(evento.id)) continue;
      nos.set(evento.id, {
        id: evento.id,
        parentId: evento.parentId,
        filhos: [],
        dados: { rotulo: evento.name, kind: evento.kind, workflowState: "rodando" },
      });
      const parent = evento.parentId ? nos.get(evento.parentId) : undefined;
      if (parent) parent.filhos.push(evento.id);
      continue;
    }

    const no = nos.get(evento.id);
    if (!no) continue;
    no.dados = {
      ...no.dados,
      workflowState: evento.status === "error" ? "error" : "ok",
      duracaoMs: evento.durationMs,
      fail: evento.error,
      payload: evento.data,
    };
  }

  return nos;
}

/**
 * Posiciona a árvore da esquerda para a direita: a profundidade dá o `x`, e o
 * `y` vem de empilhar as folhas na ordem em que aconteceram — cada pai fica
 * centrado nos seus filhos. É determinístico, então um nó não pula de lugar
 * quando o irmão seguinte chega.
 */
export function posicionar(nos: Map<string, Bruto>): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  const raizes = [...nos.values()].filter((n) => !n.parentId || !nos.has(n.parentId));
  const y = new Map<string, number>();
  let proximaLinha = 0;

  const medir = (id: string): number => {
    const no = nos.get(id)!;
    if (!no.filhos.length) {
      const linha = proximaLinha++;
      y.set(id, linha * (HEIGHT + GAP_Y));
      return y.get(id)!;
    }
    const filhos = no.filhos.map(medir);
    const centro = (filhos[0] + filhos[filhos.length - 1]) / 2;
    y.set(id, centro);
    return centro;
  };
  raizes.forEach((raiz) => medir(raiz.id));

  const profundidade = (no: Bruto): number => {
    let d = 0;
    let current = no;
    while (current.parentId && nos.has(current.parentId)) {
      current = nos.get(current.parentId)!;
      d++;
    }
    return d;
  };

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const no of nos.values()) {
    nodes.push({
      id: no.id,
      type: "passo",
      position: { x: profundidade(no) * (WIDTH + GAP_X), y: y.get(no.id) ?? 0 },
      data: no.dados,
    });
    if (no.parentId && nos.has(no.parentId)) {
      edges.push({
        id: `${no.parentId}->${no.id}`,
        source: no.parentId,
        target: no.id,
        animated: no.dados.workflowState === "rodando",
        style: { stroke: no.dados.workflowState === "error" ? "#f87171" : "#4b5563" },
      });
    }
  }

  return { nodes, edges };
}
