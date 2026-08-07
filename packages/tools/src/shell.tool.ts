import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "@thenajs/core";
import type { ToolType } from "@thenajs/core";
import { z } from "zod";

const run = promisify(exec);

const schema = z.object({ command: z.string() });

/** Teto de tempo padrão. Sem ele, um comando pendurado trava a run para sempre. */
const TIMEOUT_PADRAO = 30_000;

/** Teto de saída devolvida ao modelo, para não entupir a janela de contexto. */
const MAX_CHARS = 8_000;

export interface ShellToolOptions {
  /** Teto de tempo do comando, em ms. Default: 30s. */
  timeoutMs?: number;
  /** Diretório de trabalho. Default: o do processo. */
  cwd?: string;
  /**
   * Só executa comandos cujo **primeiro token** esteja nesta lista.
   *
   * É a única proteção real contra prompt injection nesta tool. Sem allowlist,
   * qualquer coisa que o modelo escrever é executada com as permissões do
   * processo.
   *
   * ```ts
   * shellTool({ allow: ["ls", "cat", "grep", "git"] })
   * ```
   */
  allow?: string[];
  /** Teto de caracteres devolvidos ao modelo. Default: 8000. */
  maxChars?: number;
}

/**
 * Executa um comando shell.
 *
 * ## ⚠️ Leia antes de usar
 *
 * Esta tool dá ao modelo **execução arbitrária de comando** com as permissões
 * do seu processo. Um agente que leia conteúdo de terceiro — um README, uma
 * issue, um arquivo do repositório — pode ser induzido a executar o que
 * estiver escrito lá. O framework não tem defesa contra prompt injection.
 *
 * Use `allow` sempre que o agente puder ver entrada não confiável:
 *
 * ```ts
 * @Agent({ provider, prompt: "./a.agent.md", tools: [shellTool({ allow: ["git", "ls"] })] })
 * ```
 *
 * Sem `allow`, restrinja o uso a ambiente controlado — sua máquina, um
 * container descartável — e nunca a um serviço exposto.
 */
export function shellTool(options: ShellToolOptions = {}): ToolType {
  const timeout = options.timeoutMs ?? TIMEOUT_PADRAO;
  const maxChars = options.maxChars ?? MAX_CHARS;
  const allow = options.allow?.map((c) => c.trim()).filter(Boolean);

  return {
    name: "shell",
    description: allow
      ? `Executa um comando shell. Permitidos: ${allow.join(", ")}.`
      : "Executa um comando shell e retorna a saída.",
    schema,

    async execute({ command }: { command: string }) {
      if (allow) {
        // O primeiro token decide. Não tenta interpretar a linha inteira: um
        // parser de shell parcial dá falsa sensação de segurança, e `;`, `&&`,
        // `$(…)` e pipes contornariam qualquer coisa mais esperta que isto.
        const programa = command.trim().split(/\s+/)[0] ?? "";
        if (!allow.includes(programa)) {
          return {
            content:
              `Comando "${programa}" não permitido. ` +
              `Disponíveis: ${allow.join(", ")}.`,
            isError: true,
          };
        }
        if (/[;&|`$><]/.test(command)) {
          // Com allowlist ligada, encadeamento anularia a lista.
          return {
            content:
              "Encadeamento e redirecionamento não são permitidos " +
              "(`;`, `&&`, `|`, `$(…)`, `>`). Rode um comando por vez.",
            isError: true,
          };
        }
      }

      try {
        const { stdout, stderr } = await run(command, {
          timeout,
          cwd: options.cwd,
          maxBuffer: 10 * 1024 * 1024,
        });
        const saida = stdout || stderr || "(sem saída)";
        return saida.length > maxChars
          ? `${saida.slice(0, maxChars)}\n… [truncado]`
          : saida;
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
        if (e.killed) {
          return {
            content: `O comando excedeu ${timeout}ms e foi encerrado.`,
            isError: true,
          };
        }
        // Erro vira observação: o modelo lê e tenta outra coisa.
        return { content: e.stderr || e.message, isError: true };
      }
    },
  };
}

/**
 * Versão sem configuração, para uso rápido em ambiente controlado.
 *
 * ⚠️ **Sem allowlist** — o modelo executa qualquer comando. Leia o aviso de
 * `shellTool` antes de usar; para agente que vê entrada não confiável, prefira
 * `shellTool({ allow: [...] })`.
 */
@Tool({
  name: "shell",
  description: "Executa um comando shell e retorna a saída.",
  schema,
})
export class ShellTool {
  private readonly impl = shellTool();

  execute(args: { command: string }) {
    return this.impl.execute(args);
  }
}
