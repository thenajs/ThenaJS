# Pendências

Coisas encontradas no código que valem correção, mas que não cabiam no trabalho
em que apareceram. Não é roadmap de funcionalidade — para isso existe o
[ROADMAP.md](ROADMAP.md). É o que já está no código e está errado, inconsistente
ou incompleto.

Os itens abaixo saíram da refatoração da documentação de agosto/2026: a
documentação foi escrita contra o código, e o que não batia ficou registrado
aqui em vez de virar página.

## Idioma

A 0.9 moveu identificadores e strings de usuário para o inglês, em dois commits
(`067fdf0` e `fa49651`). Sobrou coisa nos dois.

### 1. O CLI ainda fala português com o usuário

`packages/cli/src/index.ts` imprime `Uso:`, `Erro: o diretório "…" já existe.`,
`Criando o projeto ThenaJS "…"…` e `✔ Pronto! Próximos passos`.

É a superfície mais visível que sobrou: quem instala o `@thenajs/cli` e roda
`thena --help` vê português, enquanto a documentação e os identificadores estão
em inglês. Os comandos e as flags já estão em inglês.

### 2. As descrições dos pacotes no npm estão em português

Os seis `packages/*/package.json` têm `description` em português — e é esse
texto que aparece na página pública de cada pacote no npm:

```
"Engine de execução do ThenaJS: pipeline, providers (Ollama/OpenAI), estado e tools (Zod)."
"CLI do ThenaJS: cria projetos (thena create) e gera agentes (thena g agent)."
"Camada de DX do ThenaJS: decorators (@Agent/@Workflow/@Tool) e runtime sobre o @thenajs/agentflow."
"Visualizador ao vivo da execução de agentes ThenaJS — grafo em tempo real no navegador."
"Cliente Qdrant nativo para ThenaJS — implementação de VectorStore sobre a API REST, sem SDK."
"Tools prontas para agentes ThenaJS (ex.: ShellTool)."
```

### 3. Identificadores em português sobreviveram ao `067fdf0`

- o arquivo `packages/core/src/middleware/janela.ts` — o nome do módulo
- em `packages/core/src/run-handle.ts`, os locais `peças`, `observando`,
  `avisou`

Nenhum deles vaza para o `.d.ts` publicado, então não é quebra de contrato —
mas contradiz o commit que dizia ter feito a varredura.

## API pública

### 4. `ContextWindowOptions.warnIndexFailure` parece mal renomeado

Em `packages/core/src/middleware/janela.ts`, o campo guarda **o texto da nota
que substitui o histórico cortado** — default
`"[…histórico anterior omitido para caber na janela…]"`. O nome não tem relação
com o que ele faz: não há índice, e não há falha.

Parece resultado de um replace durante a renomeação de identificadores. É API
pública, então corrigir é quebra — provavelmente aceitar um nome novo e manter o
antigo como alias depreciado por uma versão.

A documentação usa o nome real e sinaliza que ele deve mudar.

### 5. A depreciação de `EventQueue` não protege nada

`packages/core/src/run-handle.ts` marca:

```ts
/** @deprecated Use `Canal<ExecutionEvent>`. Mantido para não quebrar imports. */
export class EventQueue extends Channel<ExecutionEvent> {}
```

Só que nem `EventQueue`, nem `Channel`, nem `MAX_BUFFERED_EVENTS` são
reexportados por `packages/core/src/index.ts` — de lá sai apenas o **tipo**
`RunHandle`. Ninguém consegue importar nenhum dos três de `@thenajs/core`,
então o shim de compatibilidade não tem o que compatibilizar.

Ou se exporta os três de verdade, ou se remove o `EventQueue`. Além disso o
texto do `@deprecated` ainda diz `Canal`, nome que não existe mais.

## Já resolvido

Registrado para não ser reinvestigado. Três divergências entre a documentação
antiga e o código eram erro da documentação, e as páginas novas já descrevem o
comportamento real:

- um `toolErrors: "observe"` no `ThenaConfig` que **nunca existiu** — e a
  afirmação, junto, de que erro de tool derruba a execução por padrão, quando é
  o contrário: vira observação, e o `FatalToolError` é o opt-out;
- o orçamento descrito como **não** atravessando execuções aninhadas, quando
  desde a 0.9 ele atravessa, justamente para um sub-workflow não ser rota de
  fuga do teto;
- o report apontado como `report/index.html`, que desde a 0.9 é o índice de
  todas as execuções — a de cada uma fica em `report/<runId>/`.
