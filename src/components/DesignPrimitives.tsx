import {useEffect, useId, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';

export function MightyMark({className = ''}: {className?: string}) {
  return <span className={`mighty-mark ${className}`} aria-hidden="true"><span/><span/></span>;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '·';
}

export function Avatar({name, size = 'regular', tone = 0}: {name: string; size?: 'small' | 'regular' | 'large'; tone?: number}) {
  return <span className={`avatar avatar-${size} avatar-tone-${tone % 5}`} aria-hidden="true">{initials(name)}</span>;
}

export function Tabs<T extends string>({label, items, value, onChange}: {label: string; items: readonly T[]; value: T; onChange: (value: T) => void}) {
  const id = useId();
  return <div className="tabs" role="group" aria-label={label}>
    {items.map(item => <button type="button" key={item} aria-pressed={value === item} className={value === item ? 'active' : ''} onClick={() => onChange(item)} id={`${id}-${item}`}>{item}</button>)}
  </div>;
}

export function Dialog({title, onClose, children, className = ''}: {title: string; onClose: () => void; children: ReactNode; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={id} onCancel={event => {event.preventDefault(); close.current();}} onClick={event => {if (event.target === event.currentTarget) close.current();}}>
    <div className="dialog-body">
      <div className="dialog-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19}/></button></div>
      {children}
    </div>
  </dialog>;
}

export function EmptyState({title, children, action}: {title: string; children: ReactNode; action?: ReactNode}) {
  return <div className="empty-state"><span className="empty-mark"><MightyMark/></span><h2>{title}</h2><p>{children}</p>{action}</div>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

export const stageLabels: Record<string, string> = {saved: 'Saved', contacted: 'Contacted', in_conversation: 'In conversation', staying_in_touch: 'Staying in touch'};
export function StagePill({stage}: {stage: string}) {
  return <span className={`pill stage-${stage}`}><span className="status-dot"/>{stageLabels[stage] || stage.replaceAll('_', ' ')}</span>;
}
