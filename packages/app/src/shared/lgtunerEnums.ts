/** LGTuner enum spellings (mirrors packages/core/src/plugins/lgtuner.ts; the renderer cannot import core). */
export const LGTUNER_ROTATIONS: readonly string[] = [
  'None',
  'Flip',
  'MoveTo_Left',
  'MoveTo_Right',
  'Towards_Random',
  'Towards_Forward',
  'Towards_Backward',
  'Towards_Left',
  'Towards_Right',
];
export const LGTUNER_DIRECTIONS: readonly string[] = [
  'Unchanged',
  'Random',
  'Forward',
  'Backward',
  'Left',
  'Right',
];
export const LGTUNER_COMPLEXES: readonly string[] = ['Mining', 'Tech', 'Service'];
