/**
 * Clipboard helpers for the form editor. Copies carry the source text (so
 * comments survive a paste); pastes are parsed as JSONC and sanity-checked
 * against the target class before they are applied.
 */
import { getNodeValue, parseTree, type ParseError } from 'jsonc-parser';
import type { ClassSchema } from '@shared/ipc';

export interface ClipboardJson {
  text: string;
  kind: 'object' | 'array' | 'scalar';
  value: unknown;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Read and parse the clipboard as JSONC; null when it is not valid JSON. */
export async function readClipboardJson(): Promise<ClipboardJson | null> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  const errors: ParseError[] = [];
  const tree = parseTree(trimmed, errors, { allowTrailingComma: true, disallowComments: false });
  if (!tree || errors.length) return null;
  const kind = tree.type === 'object' ? 'object' : tree.type === 'array' ? 'array' : 'scalar';
  return { text: trimmed, kind, value: getNodeValue(tree) };
}

/** Share of an object's keys that the class knows. 1 when there is no class to compare with. */
export function keyMatchRatio(value: unknown, cls: ClassSchema | undefined): number {
  if (!cls || !value || typeof value !== 'object' || Array.isArray(value)) return 1;
  const keys = Object.keys(value as object);
  if (keys.length === 0) return 1;
  const hits = keys.filter((k) => cls.fieldsByLowerName[k.toLowerCase()] !== undefined).length;
  return hits / keys.length;
}

/** Ask before pasting something that does not look like the expected class. */
export function confirmPaste(value: unknown, cls: ClassSchema | undefined): boolean {
  const ratio = keyMatchRatio(value, cls);
  if (ratio >= 0.5) return true;
  return confirm(
    `Only ${Math.round(ratio * 100)}% of the pasted fields belong to ${cls?.name ?? 'this type'}. Paste anyway?`,
  );
}
