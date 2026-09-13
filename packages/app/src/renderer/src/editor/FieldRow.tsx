import { useEffect, useRef, type ReactNode } from 'react';
import { useEditor } from './EditorContext';

export interface FieldRowProps {
  pointer: string;
  label: ReactNode;
  hint?: string;
  /** Representation badge (e.g. "str", "1.0") */
  badge?: string;
  children: ReactNode;
  /** Wide rows (objects, lists) put children below the label. */
  block?: boolean;
  actions?: ReactNode;
}

/** Label + control + per-field problems, with flash-on-focus for problem navigation. */
export function FieldRow({ pointer, label, hint, badge, children, block, actions }: FieldRowProps) {
  const { problems, focusPointer } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const mine = problems.get(pointer) ?? [];
  const worst = mine.find((d) => d.severity === 'error')
    ? 'error'
    : mine.find((d) => d.severity === 'warning')
      ? 'warning'
      : mine.length
        ? 'info'
        : '';
  const focused = focusPointer === pointer;

  useEffect(() => {
    if (focused && ref.current) ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={`frow ${block ? 'frow-block' : ''} ${worst ? `frow-${worst}` : ''} ${focused ? 'frow-focus' : ''}`}
    >
      <div className="frow-label" title={hint ?? pointer}>
        <span>{label}</span>
        {badge && <span className="fbadge">{badge}</span>}
        {actions && <span className="frow-actions">{actions}</span>}
      </div>
      <div className="frow-control">{children}</div>
      {mine.length > 0 && (
        <ul className="frow-problems">
          {mine.map((d, i) => (
            <li key={i} className={`sev-${d.severity}`}>
              <span className="pcode">{d.code}</span> {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
