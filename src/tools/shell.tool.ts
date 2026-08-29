import { Tool, input } from "@thenajs/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/**
 * Subcomandos `git` recusados: os que escrevem no repositório, no remoto ou na
 * configuração. Tudo o que não está aqui é permitido.
 *
 * Uma blocklist erra por omissão — um subcomando novo no git entra liberado —,
 * então ela **não** é a defesa principal. Quem segura de verdade são as duas
 * regras abaixo: `execFile` sem shell, e a recusa de opções globais.
 */
const BLOCKED = new Set([
  // escrevem no repositório
  "commit",
  "reset",
  "checkout",
  "switch",
  "restore",
  "clean",
  "rm",
  "mv",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "apply",
  "am",
  "stash",
  "update-ref",
  "filter-branch",
  "gc",
  "prune",
  "repack",
  "replace",
  "notes",
  // falam com o remoto
  "push",
  "pull",
  "fetch",
  "clone",
  "remote",
  "submodule",
  "daemon",
  // mudam configuração ou estado do checkout
  "config",
  "init",
  "worktree",
  "bisect",
  "tag",
  "branch",
  "credential",
  // executam coisas
  "hook",
  "filter-repo",
]);

/** Teto do que volta ao modelo. Um `git diff` grande entope o contexto. */
const MAX_CHARS = 4000;

/** Um comando travado não pode segurar a execução inteira. */
const TIMEOUT_MS = 15_000;

@Tool({
  name: "shell",
  description:
    "Run a read-only git command in this repository and return its output. " +
    "Use it to inspect what changed: status, diff, log, show, blame, ls-files. " +
    "Commands that write to the repository, the remote or the config are refused.",
  schema: z.object({
    args: z
      .array(z.string())
      .min(1)
      .describe('the git arguments, one per item — e.g. ["diff", "--stat"]'),
  }),
})
export class ShellTool {
  async execute(@input() { args }: { args: string[] }) {
    const [subcommand, ...rest] = args;

    // Opção global antes do subcomando é recusada em bloco, e esta é a regra
    // que a blocklist sozinha não daria: `git -c alias.x='!sh -c …' x` executa
    // shell arbitrário sem que nenhum subcomando proibido apareça. O mesmo vale
    // para `-C`, `--git-dir` e `--work-tree`, que apontam o git para fora deste
    // projeto, e para `--exec-path`, que troca de onde os binários vêm.
    if (subcommand.startsWith("-")) {
      return {
        content:
          `Refused: '${subcommand}' is a global git option, not a subcommand. ` +
          `Pass the subcommand first, e.g. ["diff", "--stat"].`,
        isError: true,
      };
    }

    if (BLOCKED.has(subcommand)) {
      // Observação, não exceção: o modelo lê, entende o limite e escolhe outro
      // comando no turno seguinte, em vez de a execução morrer.
      return {
        content:
          `Refused: 'git ${subcommand}' can modify the repository, the remote ` +
          `or the config. Only read-only inspection is allowed here.`,
        isError: true,
      };
    }

    try {
      // `execFile`, e **não** `exec`: sem shell no meio, `;`, `&&`, `|` e crases
      // chegam ao git como texto literal em vez de virarem comando. É isto que
      // torna as recusas acima uma garantia, e não uma sugestão.
      const { stdout } = await run("git", ["--no-pager", subcommand, ...rest], {
        cwd: process.cwd(),
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });

      const output = stdout.trim() || "(no output)";
      return output.length <= MAX_CHARS
        ? output
        : `${output.slice(0, MAX_CHARS)}\n… [truncated]`;
    } catch (err) {
      // git sai com código != 0 em situações normais (ex.: `diff --quiet` com
      // mudanças). Devolver como observação deixa o modelo interpretar.
      return {
        content: `git ${args.join(" ")} failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
