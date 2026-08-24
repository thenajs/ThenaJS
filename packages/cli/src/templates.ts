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
// `thena generate agent <nome>` — arquivos de um agente (dentro de um projeto)
// --------------------------------------------------------------------------

/** Conteúdo inicial do `<name>.agent.ts` — a classe decorada com @Agent. */
export function agentTsTemplate(name: string): string {
  const className = classNameFromAgent(name);
  return `import { Agent } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider";

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
  return `# Agent ${name}

You are the **${name}** agent.

Describe here, in natural language, this agent's goal and behaviour.
`;
}

// --------------------------------------------------------------------------
// `thena create <nome>` — projeto novo completo
// --------------------------------------------------------------------------

export interface ScaffoldFile {
  path: string;
  content: string;
}

/** Versões dos pacotes @thenajs referenciadas pelo projeto gerado. */
const THENA_VERSION = "0.11.0";

/** Todos os arquivos de um projeto ThenaJS novo. */
export function projectFiles(name: string): ScaffoldFile[] {
  const pkg = {
    name,
    version: "0.1.0",
    private: true,
    // Sem `type: "module"`: o projeto é **CommonJS**, como o de um `nest new`.
    // É o que permite escrever `from "./config"` sem extensão — a resolução do
    // CJS completa `.js`/`/index.js`, coisa que o ESM nativo não faz.
    scripts: {
      start: "tsx src/main.ts",
      // tsc transpila só os .ts; os prompts .md são copiados para o dist/
      // preservando a estrutura, senão o @Agent não acha o .md em produção.
      build: 'tsc && copyfiles -u 1 "src/**/*.md" dist',
      "start:prod": "node dist/main",
    },
    dependencies: {
      "@thenajs/core": THENA_VERSION,
      zod: "^4.0.0",
    },
    devDependencies: {
      "@types/node": "^20.19.0",
      copyfiles: "^2.4.1",
      tsx: "^4.7.0",
      typescript: "^5.4.0",
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "nodenext",
      moduleResolution: "nodenext",
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

Projeto ThenaJS. Um assistente pronto para editar.

## Rodando

Requer um modelo local (ex.: [Ollama](https://ollama.com)) — ajuste o provider
em \`src/providers/ollama.provider.ts\`.

\`\`\`bash
npm install
npm start                 # usa a mensagem padrão
npm start -- "Sua pergunta aqui"
\`\`\`

## Build de produção

\`\`\`bash
npm run build             # tsc + copia os .md dos prompts para dist/
npm run start:prod        # node dist/main
\`\`\`

O \`build\` copia os \`*.agent.md\` para o \`dist/\` ao lado dos \`.js\`, para o
\`@Agent\` encontrar o prompt quando roda a partir do compilado.

## Estrutura

\`\`\`
src/
  agents/assistant/       # a lógica (.ts) + o prompt (.md)
  providers/              # como falar com o modelo
  workflows/              # orquestração dos agentes
  config.ts               # log / report
  main.ts                 # ponto de entrada
\`\`\`

Gere mais agentes com \`thena g agent <nome>\`.
`,
    },
    {
      path: "src/main.ts",
      content: `import { Thena } from "@thenajs/core";
import { AssistantWorkflow } from "./workflows/assistant.workflow";
import { config } from "./config";

const prompt = process.argv.slice(2).join(" ") || "Hello! What do you do?";

async function bootstrap() {
  // \`create\` não é async — quem espera é o \`run\`.
  const app = Thena.create(AssistantWorkflow, config);

  // O \`run\` devolve a saída e propaga o erro — quem imprime é a aplicação.
  console.log(await app.run({ prompt }));

  await app.dispose();
}

bootstrap();
`,
    },
    {
      path: "src/config.ts",
      content: `import type { ThenaConfig } from "@thenajs/core";

export const config: ThenaConfig = {
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
      content: `import { OllamaProvider } from "@thenajs/core";

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
      content: `import { Agent } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider";

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
      content: `# Assistant

You are a helpful, direct assistant. Answer concisely and to the point.
`,
    },
    {
      path: "src/workflows/assistant.workflow.ts",
      content: `import { Workflow } from "@thenajs/core";
import { AssistantAgent } from "../agents/assistant/assistant.agent";

@Workflow({
  steps: [AssistantAgent],
})
export class AssistantWorkflow {}
`,
    },
  ];
}
