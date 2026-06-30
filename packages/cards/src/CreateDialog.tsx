/**
 * CreateDialog — the "name this new block" modal shared by the Week and Day time
 * grids. A drag-to-create gesture resolves to a `pending` descriptor (day + time
 * range, or all-day); this collects the title and hands it back. Extracted so the
 * Week grid and the single-day grid share one dialog instead of two copies.
 */

import { useEffect, useRef, useState } from 'react';
import { FONT_HEAD, FONT_BODY } from './theme';
import { fmtTime, fmtWeekday } from './datetime';

/** What a drag-to-create resolved to: the target day, a time range or all-day. */
export interface CreatePending {
  startDay: string;
  scheduled_time?: string | null;
  scheduled_end?: string | null;
  allDay?: boolean;
}

export interface CreateDialogProps {
  pending: CreatePending;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function CreateDialog({ pending, onSubmit, onCancel }: CreateDialogProps) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handle = () => {
    if (title.trim()) onSubmit(title.trim());
    else onCancel();
  };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,8,6,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
      <div onClick={(e) => e.stopPropagation()} className="modal-in" style={{ width: 'min(460px, 90vw)', background: 'var(--color-paper-2)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-lg)', boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent)', padding: '22px 26px 24px' }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-accent)', textShadow: 'var(--accent-halo-text)', marginBottom: 10 }}>
          {pending.allDay ? `${fmtWeekday(pending.startDay)} · all‑day event` : `${fmtWeekday(pending.startDay)} · ${fmtTime(pending.scheduled_time)} – ${fmtTime(pending.scheduled_end)}`}
        </div>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handle();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="What needs to happen…"
          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)', fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 22, color: 'var(--color-ink)', outline: 'none', padding: '4px 0 10px' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid var(--color-line)', fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', padding: '8px 16px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handle} className="btn-action" style={{ background: 'var(--color-accent)', border: 'none', color: 'var(--color-paper)', fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '8px 20px', cursor: 'pointer', boxShadow: 'var(--accent-halo)' }}>
            Add →
          </button>
        </div>
      </div>
    </div>
  );
}
