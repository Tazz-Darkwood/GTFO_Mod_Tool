import type { EnumMember, EnumSchema } from '../model/types.js';

export interface EnumParse {
  ok: boolean;
  /** Matched member(s); several for flag combinations. */
  members: EnumMember[];
  /** String matched a member only when ignoring case. */
  caseMismatch: boolean;
  /** Canonical string form ("A" or "A, B" for flags) when ok. */
  canonical?: string;
}

const NOT: EnumParse = { ok: false, members: [], caseMismatch: false };

/** Interpret a JSON token (number or string) against an enum. */
export function parseEnumValue(e: EnumSchema, value: unknown): EnumParse {
  if (typeof value === 'number') {
    const exact = e.members.find((m) => m.value === value);
    if (exact) return { ok: true, members: [exact], caseMismatch: false, canonical: exact.name };
    if (e.isFlags && Number.isInteger(value)) {
      // Bit masks routinely hold 0, "all bits" (-1) or layer bits beyond the named members; accept any integer.
      const parts = value > 0 ? decomposeFlags(e, value) : undefined;
      return {
        ok: true,
        members: parts ?? [],
        caseMismatch: false,
        canonical: parts ? parts.map((m) => m.name).join(', ') : String(value),
      };
    }
    return NOT;
  }
  if (typeof value === 'string') {
    const names = e.isFlags
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [value.trim()];
    if (names.length === 0) return NOT;
    const members: EnumMember[] = [];
    let caseMismatch = false;
    for (const n of names) {
      const exact = e.members.find((m) => m.name === n);
      if (exact) {
        members.push(exact);
        continue;
      }
      const loose = e.members.find((m) => m.name.toLowerCase() === n.toLowerCase());
      if (!loose) return NOT;
      members.push(loose);
      caseMismatch = true;
    }
    return { ok: true, members, caseMismatch, canonical: members.map((m) => m.name).join(', ') };
  }
  return NOT;
}

/** Split a flags value into member bits; undefined if any bit is unnamed. */
export function decomposeFlags(e: EnumSchema, value: number): EnumMember[] | undefined {
  const parts: EnumMember[] = [];
  let rest = value;
  const sorted = [...e.members].filter((m) => m.value > 0).sort((a, b) => b.value - a.value);
  for (const m of sorted) {
    if ((rest & m.value) === m.value) {
      parts.push(m);
      rest &= ~m.value;
    }
  }
  return rest === 0 && parts.length ? parts.reverse() : undefined;
}

/** Numeric value for a member name (or combined flags string); undefined if unknown. */
export function enumValueOf(e: EnumSchema, name: string): number | undefined {
  const r = parseEnumValue(e, name);
  if (!r.ok) return undefined;
  return r.members.reduce((acc, m) => acc | m.value, 0);
}
