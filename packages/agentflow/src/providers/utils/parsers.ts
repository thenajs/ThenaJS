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


export function stripThinkTags(text: string): string {

    const TAG_PATTERN =
        "think|thinking|reasoning|thought|reasoning_scratchpad";

    text = text.replace(
        new RegExp(`<(${TAG_PATTERN})[\\s\\S]*?<\\/\\1>`, "gi"),
        ""
    );

    text = text.replace(
        new RegExp(
            `(?:^|\\n)\\s*<(?:${TAG_PATTERN})[^>]*>[\\s\\S]*$`,
            "i"
        ),
        ""
    );

    return text.trim();
}