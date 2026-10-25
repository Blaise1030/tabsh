// A model's vendor mark, inferred from what the agent advertises. The
// chip falls back to the card agent's own mark when nothing matches.

export type ModelBrand = 'claude' | 'openai' | 'gemini' | 'cursor' | null;

const brands: [ModelBrand, RegExp][] = [
  ['claude', /claude|sonnet|opus|haiku/],
  ['openai', /\b(gpt|openai|codex|o[134]|davinci)\b/],
  ['gemini', /\b(gemini|palm)\b/],
  ['cursor', /\b(cursor|composer)\b/],
];

export function modelBrand(id: string, name: string): ModelBrand {
  const text = `${id} ${name}`.toLowerCase();
  for (const [brand, pattern] of brands) {
    if (pattern.test(text)) return brand;
  }
  return null;
}
