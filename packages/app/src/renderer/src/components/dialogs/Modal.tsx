import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../../store';

export interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Simple centred modal; Escape and the backdrop close it via the store. */
export function Modal({ title, children, footer, width = 560 }: ModalProps) {
  const close = useStore((s) => s.closeDialog);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>(
      'input, select, button:not(.modal-close)',
    );
    first?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width }} ref={box} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="ghost small modal-close" onClick={close} title="Close (Esc)">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
