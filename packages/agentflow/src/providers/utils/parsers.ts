export function parseAsJson(output: string): unknown {
    return JSON.parse(output);
}

export function parseAsMarkdownJson(output: string): unknown {
    const json = output
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

    return JSON.parse(json);
}

export function parseAsExtractedJson(output: string): unknown {
    const match = output.match(/\{[\s\S]*\}/);

    if (!match) {
        throw new Error("No JSON object found");
    }

    return JSON.parse(match[0]);
}

export function parseAsBalancedJson(output: string): unknown {
    const start = output.indexOf("{");

    if (start === -1) {
        throw new Error("No JSON found");
    }

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < output.length; i++) {
        const ch = output[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (ch === "\\" && inString) {
            escape = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (ch === "{") {
            depth++;
        }

        if (ch === "}") {
            depth--;

            if (depth === 0) {
                return JSON.parse(output.slice(start, i + 1));
            }
        }
    }

    throw new Error("Unbalanced JSON");
}


/**
 * Extrai o JSON de dentro de uma marcação de tool call — `<tool_call>`,
 * `<function_call>`, `<tool_use>` ou `[TOOL_CALL]`. Qwen e vários modelos
 * instruct usam esse formato quando o servidor não faz o parsing nativo.
 *
 * Não exige a tag de fechamento: respostas truncadas ainda são recuperáveis,
 * porque a leitura balanceada para no `}` que fecha o objeto.
 */
export function parseAsTaggedJson(output: string): unknown {
    const open = output.match(
        /<(?:tool_call|function_call|tool_use)>|\[TOOL_CALL\]/i,
    );

    if (!open || open.index === undefined) {
        throw new Error("No tool call tag found");
    }

    return parseAsBalancedJson(output.slice(open.index + open[0].length));
}


export function stripThinkTags(text: string): string {

    const TAG_PATTERN =
        "think|thinking|reasoning|thought|reasoning_scratchpad";

    // O nome da tag precisa **terminar** aqui — `(?=[\s>])`. Sem isso,
    // `<thinker>` casava como `<think` mais o "atributo" `er`, e a segunda
    // regex (que vai até o fim do texto) apagava a resposta inteira. Qualquer
    // tag com um desses prefixos — `<thoughts>`, `<reasoningEngine>` — tinha o
    // mesmo efeito, sem erro nenhum: só uma resposta vazia.
    const ABRE = `(${TAG_PATTERN})(?=[\\s>])`;

    text = text.replace(
        new RegExp(`<${ABRE}[\\s\\S]*?<\\/\\1>`, "gi"),
        ""
    );

    // Bloco que abriu e não fechou — resposta truncada no meio do raciocínio.
    text = text.replace(
        new RegExp(
            `(?:^|\\n)\\s*<(?:${TAG_PATTERN})(?=[\\s>])[^>]*>[\\s\\S]*$`,
            "i"
        ),
        ""
    );

    return text.trim();
}