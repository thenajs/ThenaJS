/** Deriva um PascalCase a partir de um nome: `my-agent` -> `MyAgent`. */
export function pascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

/** Nome da classe do agente: `explorer` -> `ExplorerAgent`. */
export function classNameFromAgent(name: string): string {
  return `${pascal(name)}Agent`;
}

// --------------------------------------------------------------------------
// `mimir generate agent <nome>` — arquivos de um agente (dentro de um projeto)
// --------------------------------------------------------------------------

/** Conteúdo inicial do `<name>.agent.ts` — a classe decorada com @Agent. */
export function agentTsTemplate(name: string): string {
  const className = classNameFromAgent(name);
  return `import { Agent } from "@mimir-js/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
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

// --------------------------------------------------------------------------
// `mimir create <nome>` — projeto novo completo
// --------------------------------------------------------------------------

export interface ScaffoldFile {
  path: string;
  content: string;
}

/** Versões dos pacotes @mimir-js referenciadas pelo projeto gerado. */
const MIMIR_VERSION = "^0.1.0";

/** Todos os arquivos de um projeto MimirJs novo. */
export function projectFiles(name: string): ScaffoldFile[] {
  const pkg = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      start: "tsx src/main.ts",
      build: "tsc",
    },
    dependencies: {
      "@mimir-js/core": MIMIR_VERSION,
      "@mimir-js/tools": MIMIR_VERSION,
      zod: "^4.0.0",
    },
    devDependencies: {
      "@types/node": "^20.19.0",
      tsx: "^4.7.0",
      typescript: "^5.4.0",
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      types: ["node"],
      strict: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "dist",
      rootDir: "src",
    },
    include: ["src"],
  };

  return [
    { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
    { path: "tsconfig.json", content: JSON.stringify(tsconfig, null, 2) + "\n" },
    {
      path: ".gitignore",
      content: `node_modules/\ndist/\nreport/\n*.tsbuildinfo\n.DS_Store\n`,
    },
    {
      path: "README.md",
      content: `# ${name}

Projeto MimirJs. Um assistente pronto para editar.

## Rodando

Requer um modelo local (ex.: [Ollama](https://ollama.com)) — ajuste o provider
em \`src/providers/ollama.provider.ts\`.

\`\`\`bash
npm install
npm start                 # usa a mensagem padrão
npm start -- "Sua pergunta aqui"
\`\`\`

## Estrutura

\`\`\`
src/
  agents/assistant/       # a lógica (.ts) + o prompt (.md)
  providers/              # como falar com o modelo
  workflows/              # orquestração dos agentes
  config.ts               # log / report
  main.ts                 # ponto de entrada
\`\`\`

Gere mais agentes com \`mimir g agent <nome>\`.
`,
    },
    {
      path: "src/main.ts",
      content: `import { bootstrapWorkflow } from "@mimir-js/core";
import { AssistantWorkflow } from "./workflows/assistant.workflow.js";
import { config } from "./config.js";

const message = process.argv.slice(2).join(" ") || "Olá! O que você faz?";

const app = await bootstrapWorkflow(AssistantWorkflow, config);

await app.run({ input: { message } });
`,
    },
    {
      path: "src/config.ts",
      content: `import type { MimirConfig } from "@mimir-js/core";

export const config: MimirConfig = {
  // Loga ao vivo o que está sendo executado. Use "verbose" para incluir o
  // conteúdo, ou uma função (event) => void como sink customizado.
  log: true,
  // Gera um report da execução (HTML + JSON) em \`report/\` ao final da run.
  report: true,
};
`,
    },
    {
      path: "src/providers/ollama.provider.ts",
      content: `import { OllamaProvider } from "@mimir-js/core";

/** Ajuste o host/model para o seu ambiente. */
export class LocalOllamaProvider extends OllamaProvider {
  constructor() {
    super({ host: "http://localhost:11434", model: "llama3" });
  }
}
`,
    },
    {
      path: "src/agents/assistant/assistant.agent.ts",
      content: `import { Agent } from "@mimir-js/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [],
  prompt: "./assistant.agent.md",
})
export class AssistantAgent {}
`,
    },
    {
      path: "src/agents/assistant/assistant.agent.md",
      content: `# Assistente

Você é um assistente prestativo e direto. Responda **em português**, de forma
concisa e objetiva.
`,
    },
    {
      path: "src/workflows/assistant.workflow.ts",
      content: `import { Workflow } from "@mimir-js/core";
import { AssistantAgent } from "../agents/assistant/assistant.agent.js";

@Workflow({
  steps: [AssistantAgent],
})
export class AssistantWorkflow {}
`,
    },
  ];
}
