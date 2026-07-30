import { useState } from 'react';
import { Check, Lab, Sub, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };

/** Controlled square checkbox — a real `<button role="checkbox">` showing a ✓
 *  mark when checked. */
export const States = () => (
  <Faces height={200}>
    <div style={{ ...pad, flexDirection: 'row', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Check checked={false} />
        <Sub>unchecked</Sub>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Check checked />
        <Sub>checked</Sub>
      </div>
    </div>
  </Faces>
);
/* NOTE: `disabled` is a real prop, but hub.css gives `.jk-check` no disabled
   styling (only `.jk-slider:disabled` has any), so a disabled check is pixel-
   identical to an enabled one. Showing it here would assert a state the DS does
   not actually render — the prop stays documented in Check.d.ts instead. */

/** A task list — where the check does its real work. */
export const TaskList = () => {
  const [done, setDone] = useState<Record<string, boolean>>({
    a: true,
    b: false,
    c: false,
  });
  const rows: Array<[string, string, string]> = [
    ['a', 'Wire the accent chain', '#4ecdc4'],
    ['b', 'Draft the rollout dossier', '#b8860b'],
    ['c', 'Cut the staging release', '#2a7040'],
  ];
  return (
    <Faces height={200}>
      <div style={{ ...pad, maxWidth: 380 }}>
        <Lab size="xs">Today</Lab>
        <Rule />
        {rows.map(([k, label, tint]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Check
              checked={!!done[k]}
              tint={tint}
              onChange={(next) => setDone((s) => ({ ...s, [k]: next }))}
            />
            <span
              style={{
                fontFamily: 'var(--hub-font-serif)',
                fontSize: 14,
                textDecoration: done[k] ? 'line-through' : 'none',
                color: done[k] ? 'var(--color-faint)' : 'var(--color-ink)',
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </Faces>
  );
};
