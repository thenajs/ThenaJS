#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentContractTsTemplate,
  agentMdTemplate,
  agentTsTemplate,
  projectFiles,
} from "./templates.js";

function version(): string {
  try {
    const pkg = fileURLToPath(new URL("../package.json", import.meta.url));
    return JSON.parse(readFileSync(pkg, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function usage(): void {
  console.log(`ThenaJS CLI

Uso:
  thena create <nome>        Cria um projeto novo em ./<nome>
  thena g agent <nome>       Gera um agente em src/agents/<nome>/ (dentro do projeto)

Opções:
  -v, --version              Mostra a versão
  -h, --help                 Mostra esta ajuda

Exemplos:
  thena create my-agent
  thena g agent explorer
`);
}

/** Escreve um arquivo criando as pastas necessárias e loga o caminho. */
function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log(`  CREATE ${relative(process.cwd(), full)}`);
}

function create(name: string): void {
  const dir = join(process.cwd(), name);
  if (existsSync(dir)) {
    console.error(`Erro: o diretório "${name}" já existe.`);
    process.exit(1);
  }
  console.log(`Criando o projeto ThenaJS "${name}"…\n`);
  for (const file of projectFiles(name)) {
    write(dir, file.path, file.content);
  }
  console.log(`\n✔ Pronto! Próximos passos:

  cd ${name}
  npm install
  npm start
`);
}

function generateAgent(name: string): void {
  const base = join(process.cwd(), "src", "agents", name);
  if (existsSync(base)) {
    console.error(`Erro: o agente já existe em ${relative(process.cwd(), base)}`);
    process.exit(1);
  }
  write(base, `${name}.agent.ts`, agentTsTemplate(name));
  write(base, `${name}.agent.md`, agentMdTemplate(name));
  write(
    join(process.cwd(), "src", "contracts"),
    `${name}.contract.ts`,
    agentContractTsTemplate(name),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const [command, ...rest] = args;

  if (command === "-v" || command === "--version") {
    console.log(version());
    return;
  }
  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "create" || command === "new") {
    const name = rest[0];
    if (!name) {
      console.error("Erro: informe o nome do projeto. Ex.: thena create my-agent");
      process.exit(1);
    }
    create(name);
    return;
  }

  if (command === "g" || command === "generate") {
    const [type, name] = rest;
    if (type === "agent" && name) {
      generateAgent(name);
      return;
    }
  }

  usage();
  process.exit(1);
}

main();
