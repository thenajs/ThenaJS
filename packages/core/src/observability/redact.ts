/**
 * Mascaramento de segredo no que é capturado para o report, para o log e para
 * os plugins.
 *
 * O report grava o prompt inteiro, a resposta e o I/O das tools em
 * `report/<runId>/report.json`. Vai para lá tudo que o usuário digitou, tudo
 * que as tools devolveram e — desde que falha de tool virou observação — as
 * mensagens de erro cruas, que num driver de banco costumam trazer a
 * connection string com senha.
 *
 * Por isso o mascaramento vem **ligado por padrão**: um arquivo em disco, sem
 * política de retenção nem controle de acesso, é o pior lugar para um segredo
 * aparecer por descuido.
 *
 * O que ele **não** faz: PII. Não há regex para nome ou endereço. Se a sua
 * aplicação trata dado pessoal, avalie desligar a captura de conteúdo
 * (`report: { content: false }`) em vez de confiar nos padrões daqui.
 */

/** Substituto padrão. Mantém o formato reconhecível para quem lê o report. */
const MARCA = "[REDACTED]";

/**
 * Padrões conhecidos. Cada um é deliberadamente específico: um padrão
 * ganancioso mascararia texto legítimo e tornaria o report inútil, que é o
 * modo mais fácil de fazer as pessoas desligarem a proteção.
 */
const PADROES: { re: RegExp; substituir: (m: string, ...g: string[]) => string }[] = [
  // Authorization: Bearer <token>
  {
    re: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]{8,}=*/gi,
    substituir: (_m, prefixo) => `${prefixo}${MARCA}`,
  },
  // Basic <base64>
  {
    re: /\b(Basic\s+)[A-Za-z0-9+/]{8,}=*/gi,
    substituir: (_m, prefixo) => `${prefixo}${MARCA}`,
  },
  // URL de conexão com credencial: postgres://user:senha@host
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@\s]+)@/gi,
    substituir: (_m, esquema, usuario) => `${esquema}${usuario}:${MARCA}@`,
  },
  // Chaves de provider com prefixo reconhecível
  {
    re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
    substituir: (m) => `${m.slice(0, m.indexOf("-") + 1)}${MARCA}`,
  },
  { re: /\bghp_[A-Za-z0-9]{16,}/g, substituir: () => `ghp_${MARCA}` },
  { re: /\bgho_[A-Za-z0-9]{16,}/g, substituir: () => `gho_${MARCA}` },
  {
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    substituir: (m) => `${m.slice(0, 5)}${MARCA}`,
  },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, substituir: () => MARCA },
  // JWT
  {
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    substituir: () => MARCA,
  },
  // campo nomeado: "api_key": "…", password=…, secret: '…'
  //
  // O lookahead evita mascarar duas vezes: `Authorization: Bearer …` já passou
  // pelo padrão do esquema acima, e sem isto o `Bearer` viraria `[REDACTED]`
  // também — perder qual era o esquema não protege nada e atrapalha quem lê.
  {
    re: /\b(api[_-]?key|apikey|secret|password|passwd|senha|token|authorization)(["']?\s*[:=]\s*["']?)(?!\[REDACTED\]|Bearer\b|Basic\b)([^"',\s}]{4,})/gi,
    substituir: (_m, chave, meio) => `${chave}${meio}${MARCA}`,
  },
];

/**
 * Mascara os padrões conhecidos. Idempotente: rodar duas vezes dá o mesmo
 * resultado, porque `[REDACTED]` não casa com nenhum dos padrões.
 */
export function redactSecrets(valor: string): string {
  let saida = valor;
  for (const { re, substituir } of PADROES) {
    // `re` tem flag `g` e é reutilizada entre chamadas — zerar o lastIndex
    // evita que uma chamada comece do meio da anterior.
    re.lastIndex = 0;
    saida = saida.replace(re, substituir as (...args: string[]) => string);
  }
  return saida;
}

/**
 * Como o conteúdo capturado é mascarado.
 *
 * - ausente — usa `redactSecrets`, o conjunto de padrões conhecidos;
 * - `false` — **desliga**. Só faça isso se o report não sair da sua máquina;
 * - função — substitui o default. Receba `campo` (`"prompt"`, `"response"`,
 *   `"input"`, `"output"`, `"error"`) e devolva o valor a gravar.
 *
 * ```ts
 * // acrescenta um padrão seu, sem perder os de fábrica
 * redact: (_campo, valor) =>
 *   redactSecrets(valor).replace(/CPF \d{11}/g, "CPF [REDACTED]"),
 * ```
 */
export type RedactConfig = false | ((campo: string, valor: string) => string);

/** Resolve a config num redator sempre chamável. */
export function resolveRedact(
  config: RedactConfig | undefined,
): (campo: string, valor: string) => string {
  if (config === false) return (_campo, valor) => valor;
  if (typeof config === "function") return config;
  return (_campo, valor) => redactSecrets(valor);
}
