/**
 * Fields that only matter when a sibling boolean is set. Values under a gated
 * field are still indexed and editable, but not validated when the gate is off.
 */
import { propertyNode, type Node } from '../text/jsoncDoc.js';

interface Gate {
  /** Sibling boolean property that enables the fields. */
  when: string;
  /** Fields skipped when `when` is false. Empty list = skip the whole object. */
  fields: string[];
}

const GATES: Record<string, Gate[]> = {
  ExpeditionInTierData: [
    { when: 'Enabled', fields: [] },
    {
      when: 'SecondaryLayerEnabled',
      fields: ['SecondaryLayout', 'SecondaryLayerData', 'BuildSecondaryFrom'],
    },
    { when: 'ThirdLayerEnabled', fields: ['ThirdLayout', 'ThirdLayerData', 'BuildThirdFrom'] },
  ],
  ExpeditionZoneData: [{ when: 'EnemyRespawning', fields: ['EnemyRespawnExcludeList'] }],
};

function boolProp(node: Node, key: string): boolean | undefined {
  const p = propertyNode(node, key);
  return p && p.valueNode.type === 'boolean' ? (p.valueNode.value as boolean) : undefined;
}

/** Should validation skip property `key` of this object of class `className`? */
export function isGatedOff(className: string, node: Node, key: string): boolean {
  const gates = GATES[className];
  if (!gates) return false;
  for (const g of gates) {
    if (boolProp(node, g.when) !== false) continue;
    if (g.fields.length === 0) return key.toLowerCase() !== g.when.toLowerCase();
    if (g.fields.some((f) => f.toLowerCase() === key.toLowerCase())) return true;
  }
  return false;
}
