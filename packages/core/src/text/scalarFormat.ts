/**
 * Render a new scalar value as JSON text while keeping the style of the token
 * it replaces: `1.0` stays a decimal, enum strings stay strings, ints stay ints.
 */
import type { EnumSchema, FieldSchema } from '../model/types.js';
import { enumValueOf, parseEnumValue } from '../schema/enumUtil.js';

/** Marker the UI sends for enum edits so the engine can pick the representation. */
export interface EnumValue {
  $enum: string;
}
export function isEnumValue(v: unknown): v is EnumValue {
  return !!v && typeof v === 'object' && typeof (v as EnumValue).$enum === 'string';
}

export function isScalarLike(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    isEnumValue(v)
  );
}

export interface ScalarFormatContext {
  field?: FieldSchema;
  enums?: Record<string, EnumSchema>;
}

const DECIMAL_TOKEN = /^-?\d+\.\d+(e[+-]?\d+)?$/i;

export function formatScalar(
  value: unknown,
  originalToken: string | undefined,
  ctx: ScalarFormatContext = {},
): string {
  const orig = originalToken?.trim();

  if (isEnumValue(value)) {
    const e = ctx.field?.kind === 'enum' ? ctx.enums?.[ctx.field.enumName] : undefined;
    const origWasString = orig !== undefined && orig.startsWith('"');
    if (origWasString || !e) return JSON.stringify(value.$enum);
    const n = enumValueOf(e, value.$enum);
    return n === undefined ? JSON.stringify(value.$enum) : String(n);
  }

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    // A numeric string aimed at a numeric field becomes a number (fixes T002 the natural way).
    if (
      ctx.field?.kind === 'scalar' &&
      ctx.field.scalar !== 'String' &&
      ctx.field.scalar !== 'Boolean' &&
      /^-?\d+(\.\d+)?$/.test(value.trim())
    ) {
      return formatScalar(Number(value), originalToken, ctx);
    }
    // An enum name typed into an int-represented enum keeps the int representation.
    if (ctx.field?.kind === 'enum' && orig !== undefined && !orig.startsWith('"')) {
      const e = ctx.enums?.[ctx.field.enumName];
      if (e && parseEnumValue(e, value).ok) return String(enumValueOf(e, value));
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    const isSingle = ctx.field?.kind === 'scalar' && ctx.field.scalar === 'Single';
    const origWasDecimal = orig !== undefined && DECIMAL_TOKEN.test(orig);
    if (Number.isInteger(value) && (origWasDecimal || (isSingle && orig === undefined)))
      return `${value}.0`;
    return String(value);
  }
  return JSON.stringify(value);
}

/** Pretty-print a non-scalar value with the given indent unit, then indent every line after the first by `baseIndent`. */
export function formatValueBlock(value: unknown, unit: string, baseIndent: string): string {
  const raw = JSON.stringify(value, null, unit || 2);
  return raw
    .split('\n')
    .map((line, i) => (i === 0 ? line : baseIndent + line))
    .join('\n');
}
