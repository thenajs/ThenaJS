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

### O report grava a conversa inteira em disco

Com `report: true`, o `report/<runId>/report.json` contém **tudo** que foi
enviado ao modelo e recebido dele: o que o usuário digitou, o que as tools
devolveram, e as mensagens de erro cruas — que num driver de banco costumam
trazer connection string.

Não há redação nem allowlist. Trate a pasta `report/` como dado sensível:
não commite, não empacote em imagem, não sirva estaticamente.

Mitigação disponível hoje — um middleware que mascara antes de gravar:

```ts
await app.use({ name: "redact", chat: mascarar(/Bearer \S+|postgres:\/\/[^@]+@/g) });
```

O mesmo vale para `log: "verbose"`, que imprime conteúdo no stdout.

### `ShellTool` executa comando arbitrário

O `@thenajs/tools` traz uma `ShellTool` que roda `exec()` **sem allowlist,
sandbox ou restrição de diretório**. Um agente que leia conteúdo malicioso —
um README, uma issue, um arquivo do repositório — pode ser induzido a executar
o que estiver escrito lá.

Use apenas em ambiente controlado. Para agente exposto a entrada de terceiro,
escreva uma tool com allowlist explícita.

### Prompt injection

O framework não tem defesa embutida. Conteúdo lido por uma tool entra no
contexto do modelo com o mesmo peso do seu prompt de sistema. Se o agente lê
dado de terceiro **e** tem tools com efeito colateral, trate a combinação como
superfície de ataque.

`beforeTool` e os middlewares de tool são os pontos onde se implementa
autorização — a checagem enxerga os argumentos finais, já processados pelos
hooks do agente.

### Credenciais ficam no código

O provider é resolvido do decorator e instanciado sem argumentos, então as
credenciais vivem na subclasse. **Não commite chave de API**: leia de variável
de ambiente dentro do construtor.

```ts
export class MeuProvider extends OpenAIProvider {
  constructor() {
    super({ apiKey: process.env.OPENAI_API_KEY! });
  }
}
```

Injeção de configuração em runtime está no
[roadmap](./ROADMAP.md#fase-g--configuração-injetável-multi-tenant).

### Custo é uma superfície de risco

Uma tool quebrada dentro de um loop não derruba a execução — ela repete, e cada
volta é uma chamada paga. Os defaults (`maxIterations: 10`, `maxFails: 5`)
seguram o pior caso, mas configure `budget` quando o provider for pago:

```ts
await app.run({ input, budget: { maxCostUsd: 0.5, maxChatCalls: 20 } });
```

## Versões suportadas

Apenas a última `0.x` publicada.
