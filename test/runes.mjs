// runes.mjs — the pure stroke recognizer under KourOS's rune layer.
//
// ⚠️ WHY THIS GATE EXISTS. A misread rune is SILENT and it is destructive. The
// four one-stroke commands sit next to each other in the same grammar, so a
// recognizer that reads a curl as a flick does not throw, does not log, and does
// not render anything wrong — it just fires NEXT TRACK when the hand asked for
// volume, and the only evidence is that the music changed. Worse, the live
// preview and the committed command come from the SAME function here precisely
// so they cannot disagree; a regression that split them would show the user one
// label and fire another.
//
// The property the whole grammar rests on, and the one most worth pinning:
// **a stroke is allowed to change its mind mid-draw.** A straight throw right is
// NEXT TRACK right up until it curls, at which point it is the volume dial and
// never was NEXT TRACK. That is only true while classification is a fold over the
// whole stroke; the first refactor to a latch-on-threshold state machine breaks
// it and passes every other test in this file.
//
// The module is authored in TypeScript with no runtime imports, so this
// transpiles it in-memory with the repo's own `typescript` dep and drives the
// REAL functions — the house pattern, test/lib/unit.mjs.
//
// Run:  node test/runes.mjs   (wired as `pnpm check:runes`, folded into
//                               `pnpm test:contracts`).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unit } from './lib/unit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const { check, importTs, done } = unit('runes');

const MODULE = 'apps/kouros/src/gestures/rune.ts';
const RADIAL = 'apps/kouros/src/gestures/radial.ts';
const BINDINGS = 'apps/kouros/src/shell/runeBindings.ts';
// The real factory, not a stand-in: the whole claim under test is that the rune
// table is DERIVED from what createPlayer() says an item can do.
const FACTORY = 'packages/player/src/factory/createPlayer.ts';

const rn = await importTs(MODULE, 'rune.mjs');
const rd = await importTs(RADIAL, 'radial.mjs');
const factory = await importTs(FACTORY, 'factory.mjs');
const rb = await importTs(BINDINGS, 'bindings.mjs', { '../gestures/rune': './rune.mjs' });
const {
  classify, runeKey,
  DIRECTION_PX, SAMPLE_PX, CURL_DEG, MAX_STEP_DEG, CORNER_PX,
} = rn;

/* ── Stroke builders ──────────────────────────────────────────────────────────
   Synthetic strokes, so every assertion below names a shape a hand could draw
   rather than a fixture nobody can read. */

/** A straight run of samples from (ax,ay) to (bx,by), inclusive of both ends. */
function line(ax, ay, bx, by, steps = 24) {
  const out = [];
  for (let k = 0; k <= steps; k++) {
    out.push({ x: ax + ((bx - ax) * k) / steps, y: ay + ((by - ay) * k) / steps });
  }
  return out;
}

/** An arc about (cx,cy). Screen coordinates (y down), so an INCREASING angle
 *  sweeps right → down → left → up, i.e. clockwise, i.e. positive turning. */
function arc(cx, cy, r, fromDeg, toDeg, steps = 120) {
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const d = ((fromDeg + ((toDeg - fromDeg) * k) / steps) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(d), y: cy + r * Math.sin(d) });
  }
  return out;
}

/** A throw right, then that same stroke continued into `sweep` degrees of circle.
 *  The arc is tangent to the throw, so the join is smooth — exactly the motion
 *  the grammar describes, not two glued gestures.
 *
 *  `r` is the curl's radius, and it sets how finely the recognizer can resolve
 *  the moment the curl engages: SAMPLE_PX of arc is SAMPLE_PX/r radians, so a
 *  tight 60px curl is only readable to ~9°, a wide 200px one to ~2.6°. The
 *  engagement assertions below need the finer one; everything else is drawn at
 *  the radius a thumb actually makes. */
function throwThenCurl(sweep, r = 60) {
  return [...line(0, 0, 100, 0, 24), ...arc(100, r, r, -90, -90 + sweep, 240)];
}

/* ── Nothing at all ───────────────────────────────────────────────────────── */
check(classify([]).kind === 'cancel', 'classify: an empty stroke is cancel, not a crash');
check(classify([{ x: 5, y: 5 }]).kind === 'cancel', 'classify: a single point is cancel');
check(classify(line(0, 0, DIRECTION_PX - 4, 0, 12)).kind === 'cancel',
  `classify: travel under DIRECTION_PX (${DIRECTION_PX}) is a TAP, not a direction — below ` +
  'it the heading is jitter, and a tap that fired a transport command would be unusable');

/* ── One stroke: the flicks ───────────────────────────────────────────────── */
for (const [dir, bx, by] of [['r', 200, 0], ['l', -200, 0], ['d', 0, 200], ['u', 0, -200]]) {
  const r = classify(line(0, 0, bx, by, 24));
  check(r.kind === 'flick' && r.dir === dir,
    `classify: a straight throw ${dir === 'r' ? 'right' : dir === 'l' ? 'left' : dir === 'd' ? 'down' : 'up'} is flick:${dir}`);
}
{
  // A throw is read on its DOMINANT axis, so an off-axis hand still lands on the
  // command it aimed at rather than falling through to cancel.
  const r = classify(line(0, 0, 200, 70, 24));
  check(r.kind === 'flick' && r.dir === 'r',
    'classify: a sloppy right-and-slightly-down throw is still flick:r — the grammar reads ' +
    'the dominant axis, it does not demand a ruler');
}

/* ── Stroke + curl: the dials ─────────────────────────────────────────────── */
{
  const r = classify(throwThenCurl(360));
  check(r.kind === 'dial' && r.dir === 'r',
    'classify: a throw right continued into a circle is the dial that throw selects (dial:r)');
}
{
  // ⭐ THE SAFETY PROPERTY. The same stroke, read at two lengths.
  const stroke = throwThenCurl(360);
  const early = classify(stroke.slice(0, 25));   // the straight leg only
  const whole = classify(stroke);
  check(early.kind === 'flick' && early.dir === 'r',
    'classify: mid-draw, the straight leg alone previews as flick:r — what the user is told ' +
    'would fire');
  check(whole.kind === 'dial',
    'classify: …and the SAME stroke, once curled, is a dial and never was a flick. This is ' +
    'lift-to-commit: a wrong start is free, because nothing latched when the throw began');
  check(runeKey(early) !== runeKey(whole),
    'runeKey: the preview and the commit are distinguishable, so a caller can notice the ' +
    'gesture changed its mind rather than re-firing the old command');
}
{
  // Sign. Clockwise on screen is positive — the direction the dial hints say
  // turns a value UP.
  const cw = classify(throwThenCurl(360));
  const ccwStroke = [...line(0, 0, 100, 0, 24), ...arc(100, -60, 60, 90, 90 - 360, 120)];
  const ccw = classify(ccwStroke);
  check(cw.kind === 'dial' && cw.turns > 0, 'classify: a clockwise curl turns POSITIVE');
  check(ccw.kind === 'dial' && ccw.turns < 0, 'classify: a counter-clockwise curl turns NEGATIVE');
}
{
  // ⚠️ THE DIAL'S ZERO. `turns` is measured from the moment the curl was
  // recognised, not from the start of the stroke — otherwise engaging the dial
  // would itself jog the value by CURL_DEG/360 ≈ a quarter turn before the user
  // had asked for anything. A dial that jumps on contact is the single most
  // obvious way this feature feels broken, and nothing would throw.
  // Drawn wide so the engagement point is resolvable to a couple of degrees.
  const past = 30;
  const justLatched = classify(throwThenCurl(CURL_DEG + past, 200));
  const naive = (CURL_DEG + past) / 360;
  check(justLatched.kind === 'dial' && justLatched.turns > 0 && justLatched.turns < naive / 2,
    `classify: a curl taken ${past}° past CURL_DEG (${CURL_DEG}°) reads ~${(past / 360).toFixed(2)} ` +
    `turns, NOT the ${naive.toFixed(2)} the whole arc would give — the arc spent PROVING it was ` +
    'a curl is not also a value change, or every dial would jog a quarter turn on contact');

  const full = classify(throwThenCurl(360));
  const expected = (360 - CURL_DEG) / 360;
  check(Math.abs(full.turns - expected) < 0.08,
    `classify: a full 360° circle is ~${expected.toFixed(2)} turns of value, not 1.0 — the ` +
    'first ~95° were the engagement');

  // Monotonic: more sweep is always more value, never less.
  const sweeps = [140, 200, 280, 360, 480].map((s) => classify(throwThenCurl(s)).turns);
  check(sweeps.every((v, k) => k === 0 || v > sweeps[k - 1]),
    'classify: turning further always yields more turns — the dial cannot run backwards ' +
    'while the hand runs forwards');
}

/* ── Corner: the destinations ─────────────────────────────────────────────── */
{
  const r = classify([...line(0, 0, 100, 0, 24), ...line(100, 0, 100, 120, 24)]);
  check(r.kind === 'corner' && r.dir === 'r' && r.dir2 === 'd',
    'classify: right, then a hard 90° down, is corner r→d');
}
{
  const r = classify([...line(0, 0, 0, -100, 24), ...line(0, -100, 120, -100, 24)]);
  check(r.kind === 'corner' && r.dir === 'u' && r.dir2 === 'r',
    'classify: up, then right, is corner u→r');
}
{
  // ⚠️ THE DISCRIMINATION THAT MATTERS. A corner and a circle both turn ~90° and
  // both travel perpendicular. The ONLY thing separating them is whether the
  // turning stops there. If this ever collapses, every corner destination starts
  // firing a dial instead — a navigation that silently becomes a volume change.
  const corner = classify([...line(0, 0, 100, 0, 24), ...line(100, 0, 100, 120, 24)]);
  const circle = classify(throwThenCurl(360));
  check(corner.kind === 'corner' && circle.kind === 'dial',
    'classify: a stroke that turns 90° and STOPS is a corner; one that keeps turning is a ' +
    'dial — the same first 90° either way');
}
{
  // A corner needs real perpendicular travel, not just a turn. A right throw that
  // drifts a few px off-axis at the end is still a flick.
  const r = classify([...line(0, 0, 150, 0, 24), ...line(150, 0, 170, CORNER_PX - 12, 8)]);
  check(r.kind === 'flick' && r.dir === 'r',
    `classify: a drift of less than CORNER_PX (${CORNER_PX}) off the first leg stays a flick — ` +
    'a corner is a deliberate break, not a wobble');
}

/* ── Noise ────────────────────────────────────────────────────────────────── */
{
  // ⚠️ THE ACCUMULATOR'S FAILURE MODE. Successive points a pixel apart have an
  // angle dominated by quantisation, and summing that noise over a long stroke
  // walks the accumulator past CURL_DEG without the hand ever having curled —
  // a straight throw that fires the dial. SAMPLE_PX is what prevents it, so a
  // dense jittery line must still read as a flick.
  const jittery = [];
  for (let k = 0; k <= 300; k++) {
    jittery.push({ x: k, y: Math.sin(k * 1.7) * 0.9 });
  }
  const r = classify(jittery);
  check(r.kind === 'flick' && r.dir === 'r',
    `classify: 300 dense samples with sub-pixel jitter stay flick:r — SAMPLE_PX (${SAMPLE_PX}) ` +
    'keeps quantisation noise out of the turning accumulator');
}
{
  // A dropped frame makes the pointer appear to jump and reverse in one step.
  // MAX_STEP_DEG discards that pair rather than banking a spurious ~180°.
  const glitched = [
    ...line(0, 0, 120, 0, 24),
    { x: 60, y: 0 },          // one impossible backwards sample
    ...line(130, 0, 240, 0, 20),
  ];
  const r = classify(glitched);
  check(r.kind === 'flick' && r.dir === 'r',
    `classify: a single reversed sample is discarded (MAX_STEP_DEG ${MAX_STEP_DEG}°) rather ` +
    'than banked as half a turn — a dropped frame must not fire a dial');
}

/* ── runeKey ──────────────────────────────────────────────────────────────── */
{
  const a = classify(throwThenCurl(200));
  const b = classify(throwThenCurl(400));
  check(runeKey(a) === runeKey(b),
    'runeKey: the same dial at two turn amounts is the same COMMAND — identity ignores value, ' +
    'so a caller can hold one live dial open instead of re-firing it every frame');
  check(runeKey({ kind: 'cancel' }) === 'cancel',
    'runeKey: cancel has a key of its own — released-on-nothing is a real outcome, not a null');
}

/* ── The radial's geometry ───────────────────────────────────────────────── */
{
  const { fanAngles, angleDelta, sectorAt, fanOffset, DEAD_ZONE_PX, FAN_CENTRE_DEG, FAN_SPREAD_DEG } = rd;

  const three = fanAngles(3);
  check(three.length === 3 && three[1] === FAN_CENTRE_DEG,
    'fanAngles: an odd fan puts its middle destination straight up, where the thumb already is');
  check(three[0] > three[1] && three[1] > three[2],
    'fanAngles: index 0 is the LEFTMOST on screen — the order the labels read in');
  check(Math.abs((three[0] - three[2]) - FAN_SPREAD_DEG) < 1e-9,
    `fanAngles: the outer two span the whole ${FAN_SPREAD_DEG}° spread`);
  check(fanAngles(1)[0] === FAN_CENTRE_DEG && fanAngles(0).length === 0,
    'fanAngles: one item sits at the centre; none is an empty fan, not a crash');

  // ⚠️ THE WRAP. 179° and -179° are 2° apart, not 358°.
  check(angleDelta(179, -179) === -2 && angleDelta(-179, 179) === 2,
    'angleDelta: wraps — the naive subtraction calls these 358° apart and picks the far sector');
  check(angleDelta(90, 90) === 0 && angleDelta(0, 90) === -90,
    'angleDelta: and is plain subtraction away from the seam');

  // Straight up must select the middle item. `dy` is NEGATIVE for up on screen;
  // a version that forgot the flip selects nothing here or picks the mirror.
  check(sectorAt(0, -100, three) === 1,
    'sectorAt: sliding straight UP the screen (negative dy) selects the middle destination — ' +
    'the math↔screen flip lives in one place so a mirrored menu is impossible');
  check(sectorAt(-100, -40, three) === 0 && sectorAt(100, -40, three) === 2,
    'sectorAt: up-and-left is the leftmost, up-and-right is the rightmost');

  // ⭐ THE ESCAPE HATCH. Summoning the menu by accident has to be free.
  check(sectorAt(0, 0, three) === -1 && sectorAt(DEAD_ZONE_PX - 2, 0, three) === -1,
    `sectorAt: inside DEAD_ZONE_PX (${DEAD_ZONE_PX}) nothing is selected — press, look, release, ` +
    'and you are still where you were');
  check(sectorAt(0, -(DEAD_ZONE_PX + 8), three) !== -1,
    'sectorAt: …and just past it, the menu is live');

  // No dead angles outside the fan: a thumb that overshoots still picks the
  // nearest destination rather than falling into a gap.
  let unselected = 0;
  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    if (sectorAt(Math.cos(rad) * 90, -Math.sin(rad) * 90, three) === -1) unselected++;
  }
  check(unselected === 0,
    'sectorAt: every direction outside the dead zone selects SOMETHING — overshooting the fan ' +
    'lands on the nearest destination instead of a gap');

  // Round trip: an item drawn at its own angle must select itself.
  for (let i = 0; i < three.length; i++) {
    const o = fanOffset(three[i], 118);
    check(sectorAt(o.x, o.y, three) === i,
      `fanOffset/sectorAt: destination ${i} drawn at its own angle selects itself — the drawing ` +
      'and the hit-testing read the same geometry');
  }
}

/* ── The bindings: the table is DERIVED ──────────────────────────────────── */
{
  const { createPlayer, musicPlayer, audiobookPlayer } = factory;
  const { bindRune, CORNER_DESTINATIONS } = rb;

  const music = createPlayer(musicPlayer());
  const book = createPlayer(audiobookPlayer());

  // Every verb an app could supply, each recording that it was the one called.
  const fired = [];
  const verbs = {
    toggle: () => fired.push('toggle'),
    trackPrev: () => fired.push('trackPrev'),
    trackNext: () => fired.push('trackNext'),
    segmentPrev: () => fired.push('segmentPrev'),
    segmentNext: () => fired.push('segmentNext'),
    addBookmark: () => fired.push('addBookmark'),
    setVolume: (v) => fired.push(`vol:${v.toFixed(2)}`),
    volume: 0.4,
    seekTo: (s) => fired.push(`seek:${Math.round(s)}`),
    position: 100,
    duration: 600,
    cycleRate: () => fired.push('rate'),
    seekSegment: (i) => fired.push(`seg:${i}`),
    segmentIndex: 6,
    segmentCount: 24,
    navigate: (h) => fired.push(`go:${h}`),
  };
  const run = (rune, comp, turns = 0) => {
    fired.length = 0;
    const a = bindRune(rune, comp, verbs);
    if (a) a.run(turns);
    return { action: a, fired: [...fired] };
  };

  // ⭐ THE RETARGET. One rune, two meanings, and NOTHING in runeBindings.ts
  // mentions music or audiobooks to get there — it reads createPlayer's `nav`
  // capability. This is the assertion the whole design rests on.
  const flickR = { kind: 'flick', dir: 'r' };
  check(run(flickR, music).fired[0] === 'trackNext',
    'bindRune: flick right walks the QUEUE when the composition says nav:track');
  check(run(flickR, book).fired[0] === 'segmentNext',
    'bindRune: …and the SAME flick walks CHAPTERS when it says nav:segment — the grammar ' +
    'retargets off the player spec, not off a second table that could drift from it');
  check(run(flickR, music).action.label !== run(flickR, book).action.label,
    'bindRune: …and the live label retargets with it, so the preview never names the wrong verb');

  const dialL = { kind: 'dial', dir: 'l', turns: 0 };
  check(bindRune(dialL, music, verbs) === null,
    'bindRune: the chapter dial is UNBOUND on music — a track has no chapters, so the rune ' +
    'stays in the grammar and fires nothing rather than guessing');
  check(run(dialL, book, 1 / 6).fired[0] === 'seg:7',
    'bindRune: …and on a book one sixth of a turn is one chapter forward');

  // Capability-gated, in both directions.
  check(bindRune({ kind: 'flick', dir: 'd' }, music, verbs) === null,
    'bindRune: DROP MARK is unbound on music — musicPlayer() turns bookmarks off');
  check(run({ kind: 'flick', dir: 'd' }, book).fired[0] === 'addBookmark',
    'bindRune: …and bound on a book, which has them');
  check(bindRune({ kind: 'dial', dir: 'r' }, book, verbs) === null,
    'bindRune: the volume dial is unbound on the audiobook preset, which renders no volume ' +
    'control — the rune set is exactly as wide as the player is');
  check(bindRune({ kind: 'dial', dir: 'u' }, music, verbs) === null &&
        run({ kind: 'dial', dir: 'u' }, book, 0.5).fired[0] === 'rate',
    'bindRune: the speed dial follows the rate capability the same way');

  // Scrub needs no capability — seeking is universal — but it does need a duration.
  check(run({ kind: 'dial', dir: 'd' }, music, 0.5).fired[0] === 'seek:220',
    'bindRune: half a turn of the scrub dial is two minutes, on either kind');
  check(bindRune({ kind: 'dial', dir: 'd' }, music, { ...verbs, duration: null }) === null,
    'bindRune: …and is unbound when nothing knows how long the item is, rather than seeking ' +
    'into a NaN');

  // Dials clamp rather than running off the end.
  check(run({ kind: 'dial', dir: 'r' }, music, 9).fired[0] === 'vol:1.00' &&
        run({ kind: 'dial', dir: 'r' }, music, -9).fired[0] === 'vol:0.00',
    'bindRune: the volume dial clamps at both ends — spinning past the top is not an error');
  check(run({ kind: 'dial', dir: 'd' }, music, -9).fired[0] === 'seek:0',
    'bindRune: and the scrub dial cannot seek before the start');

  // A dial's readout must agree with what its run() will do — they are shown and
  // fired from the same stroke, and a disagreement is the lying-preview bug one
  // level down from the recognizer.
  {
    const a = bindRune({ kind: 'dial', dir: 'r' }, music, verbs);
    check(a.readout(0.25) === '65%', 'bindRune: the dial readout reflects the turn');
    fired.length = 0;
    a.run(0.25);
    check(fired[0] === 'vol:0.65',
      'bindRune: …and firing it sets exactly the value the readout showed — the hub cannot ' +
      'promise one number and commit another');
  }

  // Corners are navigation and are answerable with no player at all.
  check(run({ kind: 'corner', dir: 'u', dir2: 'l' }, null).fired[0] === 'go:#/browse',
    'bindRune: a corner navigates even with nothing playing — the secondary destinations are ' +
    'the shell\'s, not the player\'s');
  check(bindRune({ kind: 'corner', dir: 'd', dir2: 'l' }, music, verbs) === null,
    'bindRune: an unbound corner returns null — the grammar stays inspectable without ' +
    'pretending the command exists');
  check(bindRune({ kind: 'cancel' }, music, verbs) === null,
    'bindRune: cancel is bound to nothing, always — it is how a draw is called off');

  // ⚠️ Every corner the shell advertises must actually resolve. A destination in
  // the table with no binding is a rune that teaches itself and then does nothing.
  for (const [key, d] of Object.entries(CORNER_DESTINATIONS)) {
    const [, pair] = key.split(':');
    const a = bindRune({ kind: 'corner', dir: pair[0], dir2: pair[1] }, music, verbs);
    check(a != null && a.label === d.label,
      `bindRune: the advertised corner ${key} (${d.label}) resolves — every destination in ` +
      'CORNER_DESTINATIONS is reachable, which is what makes retiring the tab bar safe');
  }
}

/* ── End to end: a real stroke reaching a real verb ──────────────────────────
   Everything above tests one half. This drives the SAME synthetic strokes the
   recognizer section uses through `classify` and then through `bindRune`,
   because the two halves composing is the thing a user actually experiences —
   and a seam that each side satisfies alone is exactly where a feature goes
   quietly wrong. */
{
  const { createPlayer, musicPlayer, audiobookPlayer } = factory;
  const { bindRune } = rb;
  const music = createPlayer(musicPlayer());
  const book = createPlayer(audiobookPlayer());

  const fired = [];
  const verbs = {
    toggle: () => fired.push('toggle'),
    trackNext: () => fired.push('trackNext'),
    trackPrev: () => fired.push('trackPrev'),
    segmentNext: () => fired.push('segmentNext'),
    addBookmark: () => fired.push('addBookmark'),
    setVolume: (v) => fired.push(`vol:${v.toFixed(2)}`),
    volume: 0.4,
    seekTo: (x) => fired.push(`seek:${Math.round(x)}`),
    position: 100,
    duration: 600,
    seekSegment: (i) => fired.push(`seg:${i}`),
    segmentIndex: 6,
    segmentCount: 24,
    navigate: (h) => fired.push(`go:${h}`),
  };
  /** Draw it, read it, bind it, fire it — the whole path in one call. */
  const draw = (points, comp) => {
    fired.length = 0;
    const rune = classify(points);
    const action = bindRune(rune, comp, verbs);
    if (action) action.run(rune.kind === 'dial' ? rune.turns : 0);
    return { rune, action, fired: [...fired] };
  };

  check(draw(line(0, 0, 0, -200, 24), music).fired[0] === 'toggle',
    'end to end: a throw UP drawn on a music player pauses it');
  check(draw(line(0, 0, 200, 0, 24), music).fired[0] === 'trackNext',
    'end to end: a throw RIGHT skips the track');
  check(draw(line(0, 0, 200, 0, 24), book).fired[0] === 'segmentNext',
    'end to end: …and the identical points on a BOOK move a chapter instead. Nothing between ' +
    'the two calls differs except the composition');

  {
    // ⭐ The safety property, all the way through: the throw that becomes a curl
    // must fire the DIAL and never the flick it previewed.
    const stroke = throwThenCurl(360);
    const r = draw(stroke, music);
    check(r.rune.kind === 'dial' && r.fired.length === 1 && r.fired[0].startsWith('vol:'),
      'end to end: a throw right that curls sets the VOLUME — it fires once, and it does not ' +
      'also skip the track it previewed on the way');
    check(!r.fired.includes('trackNext'),
      'end to end: …NEXT TRACK never fired. Lift-to-commit means the preview was never a ' +
      'commitment, and a stroke that changed its mind costs nothing');
  }
  {
    const r = draw(throwThenCurl(360), book);
    check(r.action === null && r.fired.length === 0,
      'end to end: the same curl on a BOOK fires nothing — the audiobook preset renders no ' +
      'volume control, so the rune is unbound rather than guessing at another verb');
  }
  {
    const corner = [...line(0, 0, 0, -120, 24), ...line(0, -120, -140, -120, 24)];
    check(draw(corner, music).fired[0] === 'go:#/browse',
      'end to end: up, then a hard left, opens the library — the corner that makes retiring ' +
      'the tab bar survivable');
  }
  check(draw(line(0, 0, 6, 6, 4), music).fired.length === 0,
    'end to end: a tap fires NOTHING. It is the most common thing a thumb does on this ' +
    'surface, and the grammar has to be safe under it before it is useful');
}

/* ── The purity contract ──────────────────────────────────────────────────────
   The module is transpiled and imported in isolation above, so a runtime import
   would already have failed. This asserts the other half: that nothing in it
   reaches for a clock or the DOM. A recognizer that timed its own strokes could
   not be replayed from a point list, and every assertion above would become
   untestable in exactly the way that lets a misread ship. */
{
  const src = readFileSync(resolve(root, MODULE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const radialSrc = readFileSync(resolve(root, RADIAL), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['setInterval', 'setTimeout', 'Date.now', 'performance.now',
                        'requestAnimationFrame', 'window', 'document', 'PointerEvent']) {
    check(!src.includes(banned),
      `purity: rune.ts holds no ${banned} — a stroke is classified from its POINTS, so the ` +
      'same function serves the live preview, the commit, and this gate');
    check(!radialSrc.includes(banned),
      `purity: radial.ts holds no ${banned} — the fan is geometry, and geometry is replayable`);
  }
  for (const [name, text] of [['rune.ts', src], ['radial.ts', radialSrc]]) {
    check(!/^import\s/m.test(text) || /^import type\s/m.test(text),
      `purity: ${name} has no runtime imports, so this gate can transpile the one file in isolation`);
  }
  // The thresholds are exported so a tuning pass changes one line and this gate
  // reads the same number the recognizer does.
  for (const name of ['DIRECTION_PX', 'SAMPLE_PX', 'CURL_DEG', 'MAX_STEP_DEG', 'CORNER_PX']) {
    check(typeof rn[name] === 'number',
      `purity: ${name} is exported — the gate must read the same threshold the hand feels, ` +
      'not a copy of it');
  }
}

done();
