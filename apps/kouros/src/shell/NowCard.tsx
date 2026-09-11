import { nowHref } from '../hooks/useHashRoute';
import { usePlayer } from '../player/PlayerProvider';
import './now-card.css';

/**
 * What is playing, at the top of Home.
 *
 * It carries two jobs. The obvious one is the mockup's: state the current item in
 * whichever of the two languages it belongs to. The quieter one is that the phone
 * no longer has a mini player — the beacon replaced the whole bottom dock — so
 * this is where "what is playing, and a way back to it" now lives.
 *
 * ⭐ **THE TREATMENT IS DERIVED FROM THE PLAYER SPEC, NOT FROM A KIND FLAG.**
 * `composition.spec.kind` comes from `@jkos/player/factory`, the same object the
 * rune bindings read, so the card and the gestures can never disagree about what
 * kind of thing is playing. A local `isBook` boolean would be a second answer to
 * a question that already has one.
 *
 * The two languages, and why they differ at all:
 *
 *   SHAPE   music is a square; a book is a 2:3 spine with a bone gutter down its
 *           left edge. The shape says which world you are in before a word is
 *           read — which matters most exactly when you are not reading, because
 *           the phone is at arm's length.
 *   UNIT    music counts elapsed against total on a continuous bar. A book counts
 *           CHAPTERS on a discrete ladder, and its time is always phrased as time
 *           LEFT. Nobody has ever wanted to know they are 41% through a book.
 */
export default function NowCard() {
  const p = usePlayer();
  const item = p.item;
  if (!item || !p.composition) return null;

  const book = p.composition.spec.kind === 'audiobook';
  const remain = Math.max(0, p.total - p.globalPos);

  return (
    <a className={`kr-nowcard${book ? ' is-book' : ''}`} href={nowHref()}>
      <div
        className="kr-nowcard-art"
        style={item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : undefined}
      >
        {book && <span className="kr-nowcard-gutter" aria-hidden="true" />}
      </div>

      <div className="kr-nowcard-body">
        <div className="kr-nowcard-kind">
          <span className="kr-nowcard-pill">{book ? 'AUDIOBOOK' : 'MUSIC'}</span>
          <span className="kr-nowcard-state">{p.playing ? 'PLAYING' : 'PAUSED'}</span>
        </div>

        <span className="kr-nowcard-title">{item.title}</span>
        <span className="kr-nowcard-byline">{item.byline}</span>

        {book ? (
          <>
            {/* The ladder: past chapters dim, the current one full height. A
                discrete count, because that is the unit a book is actually
                navigated in. */}
            <div className="kr-nowcard-ladder" aria-hidden="true">
              {p.points.map((_, i) => (
                <span
                  key={i}
                  className={
                    'kr-nowcard-rung' +
                    (i < p.segmentIndex ? ' is-done' : '') +
                    (i === p.segmentIndex ? ' is-now' : '')
                  }
                />
              ))}
            </div>
            <div className="kr-nowcard-foot">
              <span>{p.segmentLabel ?? `CH ${String(p.segmentIndex + 1).padStart(2, '0')}`}</span>
              <span>{span(remain)} LEFT</span>
            </div>
          </>
        ) : (
          <>
            <div className="kr-nowcard-bar" aria-hidden="true">
              <span
                className="kr-nowcard-fill"
                style={{ width: `${p.total > 0 ? (p.globalPos / p.total) * 100 : 0}%` }}
              />
            </div>
            <div className="kr-nowcard-foot">
              <span>{clock(p.globalPos)}</span>
              <span>{clock(p.total)}</span>
            </div>
          </>
        )}
      </div>
    </a>
  );
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Hours and minutes — a book's remaining time is never usefully seconds. */
function span(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}H ${String(m % 60).padStart(2, '0')}M` : `${m}M`;
}
