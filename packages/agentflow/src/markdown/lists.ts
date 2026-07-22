export function ul(items: string[]): string {
    return items.map(item => `- ${item}`).join("\n");
}

export function ol(items: string[]): string {
    return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}
