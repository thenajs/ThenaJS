# Política de segurança

## Reportar uma vulnerabilidade

Não abra issue pública. Use
[Security Advisories](https://github.com/thenajs/ThenaJS/security/advisories/new)
no GitHub, ou escreva para o mantenedor.

Resposta esperada em até 7 dias. O ThenaJS está em `0.x`: correções saem na
próxima versão, sem backport para versões anteriores.

## O que você precisa saber antes de usar em produção

Estes não são bugs — são características do estado atual do framework, e você
deve conhecê-las antes de expor um agente a entrada não confiável.

### O report grava a conversa em disco

Com `report: true`, o `report/<runId>/report.json` contém o que foi enviado ao
modelo e recebido dele: o que o usuário digitou, o que as tools devolveram e as
mensagens de erro.

**Segredos conhecidos são mascarados por padrão** — `Bearer`, `Basic`,
connection string com senha, `sk-`/`ghp_`/`xoxb-`/`AKIA`, JWT e campos nomeados
(`api_key`, `password`, `senha`, `token`). Acrescente os seus sem perder os de
fábrica:

```ts
import { redactSecrets } from "@thenajs/core";

export const config: ThenaConfig = {
  redact: (_campo, valor) =>
    redactSecrets(valor).replace(/CPF \d{11}/g, "CPF [REDACTED]"),
};
```

⚠️ **O que a redação NÃO cobre é PII.** Não existe regex para nome, endereço ou
número de conta. Se a sua aplicação trata dado pessoal, desligue a captura de
conteúdo:

```ts
report: { content: false }   // mantém árvore, durações e telemetria
```

Mesmo com o mascaramento, trate a pasta `report/` como dado sensível: não
commite, não empacote em imagem, não sirva estaticamente. O `log: "verbose"`
imprime o mesmo conteúdo no stdout, e daí para o seu agregador de logs.

### `ShellTool` executa comando arbitrário

O `@thenajs/tools` dá ao modelo **execução de comando** com as permissões do seu
processo. Um agente que leia conteúdo malicioso — um README, uma issue, um
arquivo do repositório — pode ser induzido a executar o que estiver escrito lá.

Use `allow` sempre que o agente puder ver entrada não confiável:

```ts
import { shellTool } from "@thenajs/tools";

tools: [shellTool({ allow: ["git", "ls", "cat"], timeoutMs: 10_000 })]
```

Com a allowlist ligada, encadeamento (`;`, `&&`, `|`, `$(…)`, `>`) é recusado —
sem isso `echo ok; rm -rf /` passaria pela lista.

A classe `ShellTool`, sem argumentos, **não tem allowlist**: ela tem timeout e
teto de saída, mas executa qualquer comando. É para ambiente controlado — sua
máquina, um container descartável —, nunca para um serviço exposto.

### Prompt injection

O framework não tem defesa embutida. Conteúdo lido por uma tool entra no
contexto do modelo com o mesmo peso do seu prompt de sistema. Se o agente lê
dado de terceiro **e** tem tools com efeito colateral, trate a combinação como
superfície de ataque.

`beforeTool` e os middlewares de tool são os pontos onde se implementa
autorização — a checagem enxerga os argumentos finais, já processados pelos
hooks do agente.

### Credenciais

**Não commite chave de API.** Leia de variável de ambiente:

```ts
export class MeuProvider extends OpenAIProvider {
  constructor() {
    super({ apiKey: process.env.OPENAI_API_KEY! });
  }
}
```

Para chave **por tenant**, o `provider` do `@Agent` aceita uma factory chamada
por execução:

```ts
@Agent({
  provider: () => new OpenAIProvider({
    apiKey: chaveDe(currentRun().data.tenant as string),
  }),
  prompt: "./a.agent.md",
})
```

E use `run({ data })` — **não** `run({ memory })` — para passar tenant, id de
usuário ou credencial. O `memory` é serializado direto na mensagem `system`:
tudo que vai nele o modelo lê e o report grava. O `data` não sai do processo.

Uma ressalva: os `VectorStore` continuam instanciados **uma vez por app**, no
bootstrap. Um store por tenant exige memoização em user-land.

### Custo é uma superfície de risco

Uma tool quebrada dentro de um loop não derruba a execução — ela repete, e cada
volta é uma chamada paga. Os defaults (`maxIterations: 10`, `maxFails: 5`)
seguram o pior caso, mas configure `budget` quando o provider for pago:

```ts
await app.run({ input, budget: { maxCostUsd: 0.5, maxChatCalls: 20 } });
```

### Cancelamento não é limite de gasto

`app.run({ signal })` e `exec.abort()` cortam a geração em andamento, o que
evita pagar por resposta que ninguém vai ler. Mas o que **limita** gasto é o
`budget` — um cliente que não desconecta continua consumindo até o teto.

## Versões suportadas

Apenas a última `0.x` publicada.
