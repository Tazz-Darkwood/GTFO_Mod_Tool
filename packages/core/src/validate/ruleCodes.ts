import type { Severity } from '../model/types.js';

export const RULES = {
  P001: { severity: 'error', title: 'JSON parse error' },
  P002: { severity: 'warning', title: 'Unrecognised file shape' },
  P003: { severity: 'error', title: "Trailing comma (the game's JSON reader rejects it)" },
  B001: { severity: 'error', title: 'Block is missing its "datablock" type field' },
  B002: { severity: 'error', title: 'Block is missing "persistentID"' },
  B003: {
    severity: 'warning',
    title: 'Non-numeric persistentID (string GUIDs are not supported yet)',
  },
  B004: { severity: 'warning', title: 'Block is missing "name"' },
  B005: { severity: 'info', title: 'Block has an empty name' },
  B006: { severity: 'error', title: 'Unknown datablock type' },
  D001: { severity: 'error', title: 'Duplicate persistentID within the project' },
  D002: { severity: 'info', title: 'Block replaces a vanilla block with the same persistentID' },
  R001: { severity: 'error', title: 'Reference to a block that does not exist' },
  T001: { severity: 'warning', title: 'Value has the wrong type for this field' },
  T002: { severity: 'warning', title: 'Number written as a string' },
  T003: { severity: 'warning', title: 'Field is not known for this type' },
  T004: { severity: 'info', title: 'Field name differs from the schema only by letter case' },
  E001: { severity: 'error', title: 'Value is not a member of the enum' },
  E002: { severity: 'warning', title: 'Enum name differs from the schema only by letter case' },
  W001: { severity: 'info', title: 'LastPersistentID is lower than the highest block ID' },
  L001: { severity: 'error', title: 'LGTuner: tile overridden twice (X, Z)' },
  L002: { severity: 'error', title: 'LGTuner: LevelLayoutID is not a layout' },
  L003: { severity: 'warning', title: 'LGTuner: zone override for a zone the layout lacks' },
  L004: { severity: 'warning', title: 'LGTuner: two files target the same layout' },
  L005: { severity: 'error', title: 'LGTuner: value is not a valid option' },
} as const satisfies Record<string, { severity: Severity; title: string }>;

export type RuleCode = keyof typeof RULES;

export function severityOf(code: RuleCode): Severity {
  return RULES[code].severity;
}
