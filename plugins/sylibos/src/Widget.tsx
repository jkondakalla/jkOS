import '@jkos/ui/tokens.css';
import { useEffect, useState } from 'react';

const COLOR = '#818cf8';
const SYLIBOS_API = (import.meta as unknown as { env: Record<string, string> }).env.VITE_SYLIBOS_API_URL ?? '/api/sylibos';
const SYLIBOS_APP = (import.meta as unknown as { env: Record<string, string> }).env.VITE_SYLIBOS_APP_URL ?? '#';

interface Summary {
  todayDone: number;
  dailyGoal: number;
  streak: number;
  activeCourse: { title: string; total: number; done: number; pct: number } | null;
  nextLesson: { segmentId: string; title: string } | null;
  courseCount: number;
}

function GoalArc({ done, goal }: { done: number; goal: number }) {
  const pct = goal > 0 ? Math.min(done / goal, 1) : 0;
  const r = 22;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
      <svg style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} width="56" height="56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--hub-line)" strokeWidth="5" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={pct >= 1 ? '#22c55e' : COLOR}
          strokeWidth="5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--hub-cream)', fontFamily: 'var(--hub-font-mono)', lineHeight: 1 }}>
          {done}
        </span>
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', fontFamily: 'var(--hub-font-mono)', lineHeight: 1 }}>
          /{goal}
        </span>
      </div>
    </div>
  );
}

export default function SylibOSWidget() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SYLIBOS_API}/api/summary`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--hub-bg-1)',
      fontFamily: 'var(--hub-font-mono)',
      padding: 'var(--hub-widget-pad)',
      gap: 10, boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--hub-line)',
        paddingBottom: 8, flexShrink: 0,
      }}>
        <span style={{ color: COLOR, fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>◈ SYB</span>
        <span style={{ fontSize: 9, color: `${COLOR}88`, letterSpacing: '0.14em' }}>COURSE STUDY</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.1em' }}>SYB-001</span>
      </div>

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--hub-cream-faint)' }}>LOADING…</div>
        </div>
      )}

      {error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 18, color: `${COLOR}44` }}>◈</div>
          <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em', textAlign: 'center' }}>
            SYB OFFLINE<br />
            <span style={{ fontSize: 8, opacity: 0.6 }}>check backend config</span>
          </div>
          <a href={SYLIBOS_APP} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: COLOR, letterSpacing: '0.12em', textDecoration: 'none', border: `1px solid ${COLOR}44`, padding: '3px 8px' }}>
            OPEN APP ↗
          </a>
        </div>
      )}

      {summary && !loading && !error && (
        <>
          {/* Today stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <GoalArc done={summary.todayDone} goal={summary.dailyGoal} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em', marginBottom: 3 }}>TODAY</div>
              <div style={{ fontSize: 11, color: 'var(--hub-cream)', letterSpacing: '0.06em' }}>
                {summary.todayDone}/{summary.dailyGoal} lessons
              </div>
              {summary.streak > 0 && (
                <div style={{ fontSize: 9, color: '#fb923c', letterSpacing: '0.08em', marginTop: 2 }}>
                  {summary.streak}d streak
                </div>
              )}
            </div>
            {summary.courseCount > 0 && (
              <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.08em', textAlign: 'right', flexShrink: 0 }}>
                {summary.courseCount}<br />
                <span style={{ opacity: 0.6 }}>course{summary.courseCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Active course */}
          {summary.activeCourse && (
            <div style={{
              background: 'var(--hub-bg-0)',
              border: '1px solid var(--hub-line)',
              padding: '8px 10px',
              flexShrink: 0,
            }}>
              <div style={{ fontSize: 9, color: `${COLOR}88`, letterSpacing: '0.12em', marginBottom: 4 }}>ACTIVE COURSE</div>
              <div style={{
                fontSize: 11, color: 'var(--hub-cream)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6,
              }}>
                {summary.activeCourse.title}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 2, background: 'var(--hub-line)' }}>
                  <div style={{ width: `${summary.activeCourse.pct}%`, height: '100%', background: COLOR }} />
                </div>
                <span style={{ fontSize: 9, color: 'var(--hub-cream-faint)', minWidth: 26, textAlign: 'right' }}>
                  {summary.activeCourse.pct}%
                </span>
              </div>
            </div>
          )}

          {/* Next lesson CTA */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {summary.nextLesson ? (
              <a
                href={`${SYLIBOS_APP}/lesson/${summary.nextLesson.segmentId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', textDecoration: 'none',
                  background: `${COLOR}18`, border: `1px solid ${COLOR}55`,
                  padding: '8px 10px',
                }}
              >
                <div style={{ fontSize: 9, color: `${COLOR}88`, letterSpacing: '0.12em', marginBottom: 3 }}>NEXT LESSON</div>
                <div style={{
                  fontSize: 10, color: COLOR, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em',
                }}>
                  {summary.nextLesson.title} →
                </div>
              </a>
            ) : summary.courseCount === 0 ? (
              <a
                href={`${SYLIBOS_APP}/import`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', textDecoration: 'none',
                  border: `1px dashed var(--hub-line)`,
                  padding: '10px', textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.14em' }}>
                  IMPORT A COURSE ↗
                </div>
              </a>
            ) : (
              <a
                href={SYLIBOS_APP}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', textDecoration: 'none',
                  border: '1px solid var(--hub-line)',
                  padding: '8px 10px', textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 9, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em' }}>
                  ALL LESSONS DONE · OPEN APP →
                </div>
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
