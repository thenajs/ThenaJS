import type { Edge, Node } from "@xyflow/react";
import type { FlowEvent } from "../types.js";

export interface NodeData extends Record<string, unknown> {
  label: string;
  kind: FlowEvent["kind"];
  // `workflowState` guarda o estado **deste nó**, não do workflow — nome herdado
  // de um rename automático. Trocá-lo é item próprio; ver CURRENT_STATE.md.
  workflowState: "running" | "ok" | "error";
  durationMs?: number;
  fail?: string;
  payload?: Record<string, unknown>;
}

export type FlowNode = Node<NodeData>;

interface RawNode {
  id: string;
  parentId?: string;
  data: NodeData;
  children: string[];
}

const WIDTH = 200;
const HEIGHT = 52;
const GAP_X = 96;
const GAP_Y = 22;

/**
 * Reduz o stream de eventos à árvore da execução. O recorder já emite `id` e
 * `parentId`, então não há nada a inferir: `start` cria o nó, `end` o fecha.
 */
export function buildTree(events: FlowEvent[]): Map<string, RawNode> {
  const nodes = new Map<string, RawNode>();

  for (const evento of events) {
    if (evento.phase === "start") {
      if (nodes.has(evento.id)) continue;
      nodes.set(evento.id, {
        id: evento.id,
        parentId: evento.parentId,
        children: [],
        data: { label: evento.name, kind: evento.kind, workflowState: "running" },
      });
      const parent = evento.parentId ? nodes.get(evento.parentId) : undefined;
      if (parent) parent.children.push(evento.id);
      continue;
    }

    const node = nodes.get(evento.id);
    if (!node) continue;
    node.data = {
      ...node.data,
      workflowState: evento.status === "error" ? "error" : "ok",
      durationMs: evento.durationMs,
      fail: evento.error,
      payload: evento.data,
    };
  }

  return nodes;
}

/**
 * Posiciona a árvore da esquerda para a direita: a depth dá o `x`, e o
 * `y` vem de empilhar as folhas na ordem em que aconteceram — cada pai fica
 * centrado nodes seus children. É determinístico, então um nó não pula de lugar
 * quando o irmão seguinte chega.
 */
export function layout(raw: Map<string, RawNode>): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  const roots = [...raw.values()].filter((n) => !n.parentId || !raw.has(n.parentId));
  const y = new Map<string, number>();
  let nextRow = 0;

  const measure = (id: string): number => {
    const node = raw.get(id)!;
    if (!node.children.length) {
      const row = nextRow++;
      y.set(id, row * (HEIGHT + GAP_Y));
      return y.get(id)!;
    }
    const children = node.children.map(measure);
    const center = (children[0] + children[children.length - 1]) / 2;
    y.set(id, center);
    return center;
  };
  roots.forEach((root) => measure(root.id));

  const depth = (node: RawNode): number => {
    let d = 0;
    let current = node;
    while (current.parentId && raw.has(current.parentId)) {
      current = raw.get(current.parentId)!;
      d++;
    }
    return d;
  };

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const node of raw.values()) {
    nodes.push({
      id: node.id,
      type: "step",
      position: { x: depth(node) * (WIDTH + GAP_X), y: y.get(node.id) ?? 0 },
      data: node.data,
    });
    if (node.parentId && raw.has(node.parentId)) {
      edges.push({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        animated: node.data.workflowState === "running",
        style: { stroke: node.data.workflowState === "error" ? "#f87171" : "#4b5563" },
      });
    }
  }

  return { nodes, edges };
}
