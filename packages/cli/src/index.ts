#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { agentMdTemplate, agentTsTemplate } from "./templates.js";

function usage(): void {
  console.log(`Mimir CLI

Uso:
  mimir g agent <nome>       Gera um agente em src/agents/<nome>/

Exemplo:
  mimir g agent explorer
`);
}

function generateAgent(name: string): void {
  const dir = join(process.cwd(), "src", "agents", name);
  if (existsSync(dir)) {
    console.error(`Erro: o agente já existe em ${relative(process.cwd(), dir)}`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  const tsFile = join(dir, `${name}.agent.ts`);
  const mdFile = join(dir, `${name}.agent.md`);
  writeFileSync(tsFile, agentTsTemplate(name));
  writeFileSync(mdFile, agentMdTemplate(name));

  console.log(`CREATE ${relative(process.cwd(), tsFile)}`);
  console.log(`CREATE ${relative(process.cwd(), mdFile)}`);
}

function main(): void {
  const [command, type, name] = process.argv.slice(2);

  if (command === "g" || command === "generate") {
    if (type === "agent" && name) {
      generateAgent(name);
      return;
    }
  }

  usage();
  process.exit(command ? 1 : 0);
}

main();
