import type { ThenaConfig } from "@thenajs/core";

export const config: ThenaConfig = {
  // Loga ao vivo o que está sendo executado (agentes, chats, tools).
  // Use "verbose" para incluir o conteúdo, ou uma função como sink customizado.
  log: true,
  // Gera um report da execução (HTML + JSON) em `report/` ao final da run.
  report: true,
};
