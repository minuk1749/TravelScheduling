import type { ReactNode } from 'react';

/** Shared visual primitives for input screens (docs/design.md §3). Presentation only: no state, no I/O. */
const ICONS = {
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  calendar: 'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM4 10h16M9 3v4M15 3v4',
  clock: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8v4.5l3 1.5',
  plane: 'M3 13.5l7-1.5V5.5a1.5 1.5 0 0 1 3 0V12l8 1.5v2l-8-1V19l2.5 1.5V22L12 21l-3.5 1v-1.5L11 19v-4.5l-8 1z',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  meal: 'M6 3v7a2 2 0 0 0 4 0V3M8 10v11M16 21V3c-2 1.5-3 4-3 7h3',
  car: 'M5 16v-4l2-5h10l2 5v4zM5 16v3M19 16v3',
  bag: 'M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0',
  globe: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 4L2.5 20h19zM12 10v4.5M12 17.2v.1',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICONS[name]} /></svg>;
}

/** White section card with a title. */
export function FormCard({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className="form-card" id={id} aria-label={title}><h3>{title}</h3>{children}</section>;
}

/** Props that connect an input to its inline error message. */
export function errorProps(message: string | undefined, id: string) {
  return message ? { 'aria-invalid': true as const, 'aria-describedby': id } : {};
}

/**
 * One editable row: icon tile, value (the control) above its label, optional value-side note and inline error.
 * The visible label text is the control's accessible name, so it must stay identical to the field name.
 */
export function FieldRow({ icon, label, note, error, errorId, children }: {
  icon: IconName; label: string; note?: ReactNode; error?: string; errorId?: string; children: ReactNode;
}) {
  return <div className="field-row" data-invalid={error ? 'true' : undefined}>
    <span className="field-icon"><Icon name={error ? 'alert' : icon} /></span>
    <label className="field-body"><span className="field-label">{label}</span>{children}</label>
    {note && <span className="field-note">{note}</span>}
    {error && <FieldError id={errorId} message={error} />}
  </div>;
}

export function FieldError({ id, message }: { id?: string; message: string }) {
  return <p className="field-error" id={id}><Icon name="alert" size={13} />{message}</p>;
}

/** Text-style add action with a tinted tile. */
export function AddRowButton({ label, onClick, disabled }: { label: string; onClick(): void; disabled?: boolean }) {
  return <button type="button" className="add-row" disabled={disabled} onClick={onClick}><span className="field-icon"><Icon name="plus" /></span>{label}</button>;
}
