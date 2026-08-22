# Contribuindo

## Começando

```bash
npm install          # instala e cria os symlinks dos @thenajs/*
npm run build        # tsc -b, na ordem correta
npm test             # 246 testes, contra o código-fonte (não precisa de build)
```

Node ≥ 20.

| Script | O quê |
| --- | --- |
| `npm test` | Roda a suíte |
| `npm run test:watch` | Idem, em watch |
| `npm run test:types` | Typecheck dos testes (o `tsc -b` não os cobre) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run build` | Compila todos os pacotes |
| `npm start` | Executa o app de exemplo em `src/` |

O CI roda, nesta ordem: lint, formatação, build, typecheck do app, typecheck dos
testes, testes.

## Como o projeto pensa

Quatro princípios que apareceram na prática e valem para qualquer PR.

### 1. Teste antes de mudar comportamento

A suíte não é burocracia — ela já pegou regressões reais. Um rename de arquivo
quebrou todo `@Agent` com caminho relativo, e um teste escrito "por
completude" foi o que capturou.

### 2. Um refactor que exige editar teste não é refactor

Se a asserção precisa mudar, o comportamento mudou. Aí é outra coisa, com outro
nome e outra discussão.

### 3. Teste pela API pública

Use `bootstrapWorkflow` / `runWorkflow`, não as funções internas. Teste de
função interna quebra no primeiro movimento de arquivo e some com a rede
justamente quando ela é necessária.

Há um `FakeProvider` em `packages/core/test/harness.ts`: um provider
roteirizado que registra mensagens, tools e sampling, para testar agente,
hooks, loop e report sem falar com um modelo.

### 4. Telemetria não pode mentir

Duas coisas diferentes não podem parecer iguais. É por isso que existem
`stoppedBy`, `exhausted`, `toolCallSource` e `isError` — cada um separa um par
que, sem ele, ficaria indistinguível. Ao acrescentar um caminho de saída novo,
pergunte como quem lê o report vai distingui-lo dos outros.

## Comentário explica o *porquê*

O padrão do repositório é registrar a decisão e a alternativa rejeitada, não
repetir o que o código já diz:

```ts
// `?? Infinity` em vez de guard de truthiness: `maxIterations: 0`
// deixa de significar "ilimitado".
```

Isso já se pagou mais de uma vez: quando uma heurística quebrou, o comentário ao
lado dela decidiu o conserto em minutos.

## Mensagem de erro

Nomeie a classe, o parâmetro **e o conserto**:

```ts
throw new Error(
  `[thena] @state() em ${onde} (parâmetro ${indice}): nenhum estado ` +
  `declarado. Acrescente \`state: MinhaClasse\` no @Workflow.`,
);
```

## Commits

Convencionais, em português, no imperativo:

```
feat: freios do loop com maxFails e maxIterations
fix: stripThinkTags apagava a resposta em tags de prefixo parecido
test: cobre os parsers do engine
docs: seção de middlewares no README
```

**A mensagem é uma afirmação sobre o repositório — confira antes de escrever.**
Não use trailer de co-autoria.

Mudança que quebra compatibilidade sobe o **minor** enquanto estamos em `0.x`, e
entra no `CHANGELOG.md` com a migração.

## Onde as coisas ficam

```
packages/
  agentflow/   engine: pipeline, providers, estado, tools, vetorial — sem política
  core/        decorators + runtime + middlewares — é aqui que a política mora
    decorators/    @Agent, @Workflow, @Tool, injeção, metadados
    di/            declaração → instância
    middleware/    as cadeias de tool e chat
    runtime/       compilação e execução
    observability/ recorder, logger, report
  tools/       tools prontas
  flow/        visualizador ao vivo
  qdrant-client/
src/           o app de exemplo que consome tudo
```

## O que está planejado

O [ROADMAP.md](./ROADMAP.md) tem as fases, o esforço estimado e — importante —
o que foi **adiado com o motivo**. Antes de propor algo grande, vale conferir se
já está lá e por quê.

## Publicação

Os pacotes vão para o **npm público** (scope `@thenajs`, org npm `thenajs`) pela
Action [`publish.yml`](.github/workflows/publish.yml), disparada por uma tag
`v*`:

```bash
# bump da versão em todos os lugares, então:
git tag -a v0.11.0 -m "v0.11.0 — ..." && git push origin v0.11.0
```

A Action roda `npm ci` → `npm run build:clean` → `npm publish` de cada pacote,
com provenance, **na ordem de dependência**: `agentflow → core → tools →
qdrant-client → flow → cli`. Um passo anterior confere que a lista `PACOTES` e
`packages/` têm exatamente os mesmos nomes — sem isso, remover um pacote
derrubava a release no meio, com metade já publicada e sem republicação
possível.

Num push de tag não existe `inputs.dist_tag`, então o default é `latest`. Para
validar antes, dispare pela aba _Actions_ com `dist_tag: next` e promova depois
com `npm dist-tag add`.

### A versão vive em dez lugares

Todos precisam se mover juntos, e três não ocorrem a ninguém:

| | Onde |
| --- | --- |
| 1–6 | o `version` dos seis pacotes |
| **7–9** | os **ranges internos**: `core → agentflow`, `tools → core`, `qdrant-client → core`, `flow → core` |
| 10 | `package-lock.json` (o CI roda `npm ci`, que reprova se divergir) |

Em `0.x`, `^0.10.0` significa `>=0.10.0 <0.11.0` — subir só os campos `version`
faz o `core` publicado **recusar** o próprio irmão, e o npm instala o anterior ao
lado. O workspace continua verde porque resolve para o irmão local: o defeito só
existe no pacote publicado.

Pré-requisito: secret **`NPM_TOKEN`** (npm automation token com acesso à org
`thenajs`) no repositório.
