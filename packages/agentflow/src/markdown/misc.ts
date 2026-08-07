export function hr(): string {
  return "---";
}

export function link(title: string, url: string): string {
  return `[${title}](${url})`;
}

export function image(alt: string, url: string): string {
  return `![${alt}](${url})`;
}

export function code(text: string): string {
  return `\`${text}\``;
}

export function codeBlock(text: string, lang: string = ""): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}
