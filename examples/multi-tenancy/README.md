# multi-tenancy

O `data` de uma execução chegando no provider.

O ThenaJS não tem o conceito de tenant — não existe `tenantId` na API dele. O
que existe é um canal de dados por execução, que o framework transporta sem
interpretar. O conceito é seu.

## Declare a forma do `data`

[`src/execucao.ts`](src/execucao.ts)

```ts
export type DadosDaConta = {
  tenantId: string;
};
```

O framework não conhece este tipo — `data` é um canal aberto, e ele só
transporta. Declarar a forma é o que dispensa o cast em toda leitura.

> Use `type`, não `interface X extends DadosDaRun`. Os dois compilam, mas a
> interface herda o índice livre de `Record<string, unknown>`, e aí
> `ctx.data.campoQueNaoExiste` passa como `unknown` em vez de dar erro.

## Manda no `run`

[`src/main.ts`](src/main.ts)

```ts
const app = Thena.create<string, DadosDaConta>(AssistantWorkflow, config);

await app.run({
  input: { message: "Chame a tool quem_sou e repita a resposta dela." },
  data: { tenantId: "acme" },   // checado: errar a chave não compila
});
```

`data` não vai para o modelo — essa é a diferença para o `run({ memory })`, que
é serializado na mensagem `system` e portanto lido pelo modelo e gravado no
report.

## Recupera com `context()` — duas portas, um objeto

**Como função**, na factory do provider — [`src/providers/ollama.provider.ts`](src/providers/ollama.provider.ts)

```ts
export const providerDoTenant = () => {
  const { tenantId } = context<DadosDaConta>().data;   // string, sem cast
  return new OllamaProvider({ host: "…", model: MODELO[tenantId] });
};
```

**Como decorator**, dentro de uma tool — [`src/tools/quem-sou.tool.ts`](src/tools/quem-sou.tool.ts)

```ts
execute(@input() _args: unknown, @context() ctx: Context<DadosDaConta>) {
  return `Esta execução é da conta ${ctx.data.tenantId}.`;
}
```

É o **mesmo objeto**, e ele é plano: `ctx.data`, `ctx.runId`, `ctx.signal`,
`ctx.state` — sem sub-níveis para navegar.

Os dois pontos rodam em momentos diferentes, e é aí que está o detalhe: a
factory roda na **compilação** do workflow, antes do primeiro passo, então lá
`ctx.state` ainda não existe e lê-lo lança explicando por quê. Dentro da tool
existe tudo.

Funciona porque `@Agent({ provider })` aceita uma **factory**, chamada por
execução dentro do escopo da run. Uma classe seria instanciada sem argumentos e
não teria como saber de quem é a execução.

## Rodar

Precisa de [Ollama](https://ollama.com) local:

```bash
ollama pull qwen2.5:3b
ollama pull qwen2.5-coder:1.5b

npm install
npm start
```

```
[provider] tenantId=acme → model=qwen2.5:3b
[tool]     runId=7bee6142 data={"tenantId":"acme"}
[provider] tenantId=globex → model=qwen2.5-coder:1.5b
[tool]     runId=e19b8888 data={"tenantId":"globex"}
acme   → Esta execução é da conta acme.
globex → Esta execução é da conta globex.
```

As linhas `[provider]` e `[tool]` são o ponto: cada execução resolveu o próprio
provider e a própria tool a partir do `data` que ela mesma mandou, sem uma
enxergar a da outra. As respostas finais vêm do modelo, então o texto exato
varia.

## Notas

**Dependência local.** Usa `file:../../packages/core` porque depende de
`context()` e de `run({ data })`, que ainda não foram publicados. Fora do
repositório, troque por `"@thenajs/core": "^0.9.0"` quando a versão sair.

**CommonJS, como um projeto NestJS.** O `package.json` não tem
`"type": "module"`, e é isso que permite escrever imports **sem extensão**:

```ts
import { config } from "./config";
```

A resolução do CommonJS completa `.js` sozinha; o ESM nativo do Node não
completa nada e exigiria `"./config.js"`. É a mesma escolha do `nest new`, pelo
mesmo motivo.

O que ela cobra é o `await` de topo: em CommonJS ele não existe, então o
`main.ts` embrulha tudo numa função — de novo, igual ao `bootstrap()` do Nest.

Os pacotes `@thenajs/*` continuam sendo ESM; o Node moderno permite
`require()` deles a partir de um projeto CommonJS. Por isso o `engines` pede
**Node ≥ 20.19**, que é quando esse suporte entrou.

> Não tente empacotar com bundler: o prompt de cada agente é um `.agent.md`
> **ao lado do arquivo do agente**, e o bundle achata tudo num arquivo só,
> deixando o markdown para trás. O `npm run build` copia os `.md` para o
> `dist/` justamente por isso.
