/** Deriva o nome da classe a partir do nome do agente: `explorer` -> `ExplorerAgent`. */
export function classNameFromAgent(name: string): string {
  const pascal = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Agent`;
}

/** Conteúdo inicial do `<name>.agent.ts` — a classe decorada com @Agent. */
export function agentTsTemplate(name: string): string {
  const className = classNameFromAgent(name);
  return `import { Agent, OllamaProvider } from "@mimir/core";

@Agent({
  provider: new OllamaProvider({
    host: "http://localhost:11434",
    model: "llama3",
  }),
  tools: [],
  prompt: "./${name}.agent.md",
})
export class ${className} {}
`;
}

/** Template inicial simples do `<name>.agent.md` — só o prompt. */
export function agentMdTemplate(name: string): string {
  return `# Agente ${name}

Você é o agente **${name}**.

Descreva aqui, em linguagem natural, o objetivo e o comportamento do agente.
`;
}
