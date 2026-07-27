/**
 * Normalização de envelopes de tool call emitidos como texto.
 *
 * Modelos locais raramente acertam o formato nativo: uns mandam
 * `{"name":…,"parameters":…}`, outros embrulham em `{"function":{…}}`, outros
 * ainda serializam os argumentos como string JSON. Aqui tudo isso vira o mesmo
 * `{ name, arguments }` — sem isso, o resgate falha em silêncio e o JSON acaba
 * virando a resposta final do agente.
 */

/** Chaves em que os modelos costumam colocar o nome da tool. */
const NAME_KEYS = [
    "name",
    "tool",
    "tool_name",
    "toolName",
    "function_name",
    "function",
];

/** Chaves em que os modelos costumam colocar os argumentos. */
const ARG_KEYS = ["arguments", "parameters", "args", "input", "params"];

/** Envelopes que embrulham a chamada de verdade num nível abaixo. */
const WRAPPER_KEYS = ["function", "tool_call", "toolCall", "tool_use"];

const MAX_DEPTH = 3;

export interface NormalizedToolCall {
    name: string;
    arguments: unknown;
}

/**
 * Reduz um payload qualquer a `{ name, arguments }`, ou `null` se ele não se
 * parecer com uma chamada de tool.
 *
 * Quem chama ainda deve conferir se `name` é uma tool registrada — este helper
 * é deliberadamente permissivo, a validação fica no schema da tool.
 */
export function normalizeToolCallEnvelope(
    payload: unknown,
    depth = 0,
): NormalizedToolCall | null {
    if (depth > MAX_DEPTH) return null;

    // Alguns modelos emitem uma lista de chamadas; honramos a primeira, igual
    // ao caminho nativo (`raw.toolCalls?.[0]`).
    if (Array.isArray(payload)) {
        return payload.length
            ? normalizeToolCallEnvelope(payload[0], depth + 1)
            : null;
    }

    if (!payload || typeof payload !== "object") return null;

    const obj = payload as Record<string, unknown>;

    for (const key of WRAPPER_KEYS) {
        const inner = obj[key];
        if (inner && typeof inner === "object") {
            const nested = normalizeToolCallEnvelope(inner, depth + 1);
            if (nested) return nested;
        }
    }

    const name = firstString(obj, NAME_KEYS);
    if (!name) return null;

    return { name, arguments: coerceArguments(pick(obj, ARG_KEYS)) };
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (obj[key] !== undefined) return obj[key];
    }
    return undefined;
}

function firstString(
    obj: Record<string, unknown>,
    keys: string[],
): string | null {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

/**
 * Argumentos podem vir como objeto ou como string JSON (comum em modelos que
 * imitam o formato da OpenAI). Ausentes viram `{}` — tools sem parâmetros
 * obrigatórios continuam chamáveis.
 */
function coerceArguments(value: unknown): unknown {
    if (value === undefined || value === null) return {};

    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    return value;
}
