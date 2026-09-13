import type { EnumSchema } from '@gtfo/core';

const LINE = /^(\S+) - (-?\d+)\s*$/;

export function parseEnumText(name: string, text: string, forceFlags = false): EnumSchema {
  const members: { name: string; value: number }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const m = LINE.exec(raw);
    if (!m) throw new Error(`Enums/${name}.txt:${i + 1}: cannot parse ${JSON.stringify(raw)}`);
    members.push({ name: m[1]!, value: Number(m[2]) });
  });
  return { name, members, isFlags: forceFlags || looksLikeFlags(members) };
}

/**
 * Conservative flags heuristic: at least three members, every non-zero value is
 * a distinct power of two, and the largest is at least 4 (so {0,1,2} is not flags).
 */
export function looksLikeFlags(members: { value: number }[]): boolean {
  if (members.length < 3) return false;
  const nonZero = members.map((m) => m.value).filter((v) => v !== 0);
  if (nonZero.length < 2) return false;
  const seen = new Set<number>();
  let max = 0;
  for (const v of nonZero) {
    if (v <= 0 || (v & (v - 1)) !== 0 || seen.has(v)) return false;
    seen.add(v);
    if (v > max) max = v;
  }
  return max >= 4;
}
