export function hX(level: number, text: string): string {
  const depth = Math.min(Math.max(level, 1), 6);
  return `${"#".repeat(depth)} ${text}`;
}

export function h1(text: string): string {
  return hX(1, text);
}

export function h2(text: string): string {
  return hX(2, text);
}

export function h3(text: string): string {
  return hX(3, text);
}

export function h4(text: string): string {
  return hX(4, text);
}

export function h5(text: string): string {
  return hX(5, text);
}

export function h6(text: string): string {
  return hX(6, text);
}
