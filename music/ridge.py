#!/usr/bin/env python3
"""M2 — the ridgeline render. A correctness check disguised as a picture.

128 stacked polylines, one per mel band, emitted as **SVG text**. No matplotlib,
no plotting library, no dependency at all beyond the numpy already required —
the whole renderer is string formatting over the matrix `mel.py` produces.

WHAT THIS IS FOR. Everything downstream — the descriptor baseline (§8.4), the
encoder (§8.5), the backfill (§8.6), the similarity gate (§8.7) — is built on the
assumption that `logmelspectrogram()` returns something that is actually a
description of music. §8.2 checked that numerically: spectral tilt in the right
direction, energy in the kick/bass region, a real beat in the low-band
autocorrelation. This checks it the other way, with an eye. Render tracks that
are *obviously* unalike — a metalcore wall of sound, a piano ballad, a spoken-word
stand-up cut — and the pictures must be obviously unalike too.

⚠️ **If it does not look like music, stop and fix §8.2.** That is the whole
instruction. A ridgeline that reads as noise, or three that read as each other,
means the transform is wrong, and nothing built on top of it will be right.

THE ONE DECISION THAT MAKES OR BREAKS THE CHECK: **every panel is drawn against
one shared absolute value range** (`VALUE_RANGE` below). Per-track normalisation
would rescale each picture to fill its own frame, and a quiet acoustic track and a
brickwalled metalcore track would come out looking equally loud — which is
precisely the comparison the check exists to make. It is the same mistake §8.4
warns about for the descriptor z-score, one step earlier and in pixels. The API
enforces it: a value range belongs to a *sheet*, never to a panel.

DESIGN. Charts in this repo go through the `dataviz` skill; the parameters it
consumes come from the suite's own design factory (`packages/design/tokens/hub.css`),
copied here as literal hex because `music/` has zero jkOS imports by design. The
frequency axis is an ORDERED dimension, so its colour job is **sequential — one
hue, light→dark, never a rainbow**. Both faces' ramps were run through the
skill's validator (`--ordinal`) against their own surfaces and pass; `test_ridge.py`
re-checks the computable half of that on every run, so the palette cannot rot.
"""
import math
import os
from xml.sax.saxutils import escape, quoteattr

import numpy as np

import config
import mel

# ── The shared value scale ──────────────────────────────────────────────────────
# In LOG_MODE='ln' units. Measured 2026-08-18 across four deliberately unalike
# library tracks (metalcore / hip-hop / solo piano / stand-up): p5 ran -0.9 to
# -7.5, p99 ran 6.9 to 10.8. This range therefore holds real musical detail in
# the middle of the frame while letting genuinely quiet material sit flat on its
# baseline, which is exactly what "quiet intros actually quiet" needs to be
# legible. The floor is deliberately well ABOVE mel.log_floor_value() (-23.03):
# spending a third of the vertical space on digital silence would compress the
# part that carries the music.
VALUE_RANGE_LN = (-8.0, 10.0)

# 10·log10(x) / ln(x) — the constant between the two LOG_MODEs config.py offers.
# Without this a config edit at §8.5 would silently produce a flat picture rather
# than an error, since 'db' values are ~4.3× larger and would all clip to the top.
_DB_PER_NEPER = 10.0 / math.log(10.0)


def default_value_range():
    """The shared scale, in whatever units config.LOG_MODE is currently producing."""
    lo, hi = VALUE_RANGE_LN
    if config.LOG_MODE == 'db':
        return (lo * _DB_PER_NEPER, hi * _DB_PER_NEPER)
    return (lo, hi)


# ── The palette ─────────────────────────────────────────────────────────────────
# jkOS design-factory values (hub.css), copied not imported. Each face is a
# SELECTED pair, not an automatic flip: the dark ramp is its own set of steps
# stepped for the dark surface, and both were validated against their own surface.
#
# The band ramp is ORDINAL: one hue, monotone lightness, and the end nearest the
# surface still clears 2:1 against it. Direction is semantic — the bass end is the
# heavy end, so on paper it is the deepest ink and on the tube it is the brightest
# phosphor; the air bands recede toward the surface in both.
PAPER = {
    'surface':  '#ede2c8',   # --hub-bg-0, kraft stock
    'ink':      '#1c1408',   # --hub-cream-bright
    'ink_2':    '#6b5038',   # --hub-cream
    'ink_3':    '#9c8060',   # --hub-cream-dim
    'rule':     '#c8ae88',   # --hub-line
    # bass → air. Validated: ordinal PASS, light end 2.61:1 vs surface, hue spread 6°.
    'ramp':    ('#1c1408', '#38290e', '#55401c', '#705630', '#8c6f40', '#a68851'),
}
DARK = {
    'surface':  '#11100d',
    'ink':      '#efe6c9',
    'ink_2':    '#d6cba8',
    'ink_3':    '#8a8067',
    'rule':     '#3a3528',
    # bass → air. Validated: ordinal PASS, dim end 2.25:1 vs surface, hue spread 12°.
    'ramp':    ('#efe6c9', '#d6cba8', '#b8a373', '#9a8250', '#7c6438', '#5e4a26'),
}


def _hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    return '#%02x%02x%02x' % tuple(int(round(max(0, min(255, c)))) for c in rgb)


def band_ramp(face, n=None):
    """`n` colours interpolated across a face's anchor stops, one per mel band.

    Linear in sRGB between anchors, which for a set of anchors that are already
    monotone in lightness stays monotone — `test_ridge.py` asserts that over all
    128 entries rather than trusting it, because a non-monotone ramp would encode
    frequency ambiguously (two different bands the same shade).
    """
    n = config.N_MELS if n is None else n
    stops = [_hex_to_rgb(c) for c in face['ramp']]
    if n == 1:
        return [_rgb_to_hex(stops[0])]
    out = []
    span = len(stops) - 1
    for i in range(n):
        pos = i / (n - 1) * span
        k = min(int(pos), span - 1)
        t = pos - k
        a, b = stops[k], stops[k + 1]
        out.append(_rgb_to_hex(tuple(a[c] + (b[c] - a[c]) * t for c in range(3))))
    return out


def relative_luminance(hex_colour):
    """WCAG relative luminance. Here so the palette gate is a TEST, not a memory.

    The `dataviz` skill's rule is that the ramp end nearest the surface must still
    read as a mark. Recording that as a number the suite checks means the ramp
    cannot be edited into invisibility months from now without something going
    red — the same habit as `config.signature()` guarding Trap 16.
    """
    def channel(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(v) for v in _hex_to_rgb(hex_colour))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b):
    """WCAG contrast between two hex colours, 1.0 → 21.0."""
    la, lb = relative_luminance(a), relative_luminance(b)
    lo, hi = sorted((la, lb))
    return (hi + 0.05) / (lo + 0.05)


# ── Geometry ────────────────────────────────────────────────────────────────────
# ⚠️ BOTH NUMBERS BELOW WERE TUNED AGAINST REAL TRACKS, and the picture is
# worthless outside a narrow band of them. Recorded because they look arbitrary
# and are not.
#
# ROW_PITCH_MIN — 128 rows is far more than a ridgeline normally carries (the form
# is usually 10–40), and at 620 px of plot height the pitch is 4.8 px: every row's
# excursion crosses two neighbours and the whole panel collapses into a uniform
# hatch. It is not that the transform is wrong — it is that the picture is
# under-resolved, which is the failure most likely to be misread as "8.2 is
# broken". At ~9 px of pitch the rows separate and a beat grid is plainly visible.
# So the DEFAULT PLOT IS TALL, and panels go side by side rather than in a grid.
#
# OVERSHOOT — how many row-pitches a full-scale band rises above its own baseline.
# Rendered at 1.4 the bands barely lift off their rules and a hip-hop track reads
# as ruled paper; at 2.2–2.4 the same track shows its kick pattern across the whole
# spectrum. Higher still and loud material smears over three rows at once. Bounded
# excursion is what keeps a stack of 128 curves a picture instead of a texture.
ROW_PITCH_MIN = 9.0
OVERSHOOT = 2.4

PAD_L, PAD_R, PAD_T, PAD_B = 66, 16, 58, 40
RAIL_W, RAIL_GAP = 9, 10
LINE_W = 0.9

# Side by side, full height: the comparison the check makes is across panels at
# the SAME vertical position, i.e. the same frequency, so a row of panels reads
# better than a grid of them — and every panel keeps all 128 rows.
# PLOT_H is set so the default clears ROW_PITCH_MIN with the default OVERSHOOT:
# 1170 / (127 + 2.4) = 9.04 px. `test_ridge.py` asserts that, because a default
# that silently sits under its own readability floor is how this ends up back at
# a hatch after some future tidy-up.
SHEET_PLOT_W, SOLO_PLOT_W, PLOT_H = 440, 900, 1170


def _fmt(v):
    """One decimal, but without the trailing '.0' — this string is emitted a
    hundred thousand times per panel, so the two bytes matter."""
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


def mmss(seconds):
    seconds = int(round(seconds))
    return f'{seconds // 60}:{seconds % 60:02d}'


# ── Reducing the time axis ──────────────────────────────────────────────────────
def reduce_columns(matrix, width, reducer='max'):
    """(n_mels, T) → (n_mels, min(T, width)), bucketing frames into pixel columns.

    ⚠️ **max, not mean.** A four-minute track is ~10,000 frames against ~600
    pixels, so ~17 frames collapse into each column. Averaging them smears
    exactly the thing the picture exists to show: a kick drum is one loud frame in
    a bucket of quiet ones, and the mean erases it. The max keeps the transient,
    at the honest cost of reading a little hotter than the audio is.

    A track shorter than the frame budget is returned at its own resolution rather
    than interpolated up — inventing columns would draw detail that is not there.
    """
    matrix = np.asarray(matrix)
    if matrix.ndim != 2:
        raise ValueError(f'expected a 2-D matrix, got shape {matrix.shape}')
    if width < 1:
        raise ValueError(f'width must be >= 1, got {width}')
    n_frames = matrix.shape[1]
    if n_frames == 0:
        return matrix
    if n_frames <= width:
        return matrix

    # Bucket edges spread the remainder evenly instead of dropping the tail: the
    # last column must end ON the last frame or the time ruler lies.
    edges = np.linspace(0, n_frames, width + 1).astype(np.int64)
    edges[1:] = np.maximum(edges[1:], edges[:-1] + 1)
    edges = np.minimum(edges, n_frames)
    out = np.empty((matrix.shape[0], width), dtype=matrix.dtype)
    op = np.max if reducer == 'max' else np.mean
    for i in range(width):
        lo, hi = edges[i], max(edges[i + 1], edges[i] + 1)
        out[:, i] = op(matrix[:, lo:hi], axis=1)
    return out


def excerpt(signal, start=None, seconds=0.0, sr=None):
    """A slice of a decoded signal, plus the offset it starts at.

    `seconds=0` means the whole track — the default, because the full arrangement
    (quiet intro, loud chorus, outro) is half of what the check reads. A shorter
    window is the other half: at full length a 130 BPM beat lands ~1.5 px apart and
    aliases away, while a 20-second window puts it ~8 px apart and the grid is
    plainly visible. Render both.

    With no `start`, the window is centred: the middle of a track is the most
    representative part of it, and intros are the least.
    """
    sr = config.SR if sr is None else sr
    total = len(signal) / float(sr)
    if not seconds or seconds <= 0 or seconds >= total:
        return signal, 0.0
    if start is None:
        start = max(0.0, (total - seconds) / 2.0)
    start = max(0.0, min(start, max(0.0, total - seconds)))
    lo = int(round(start * sr))
    return signal[lo:lo + int(round(seconds * sr))], start


# ── A panel ─────────────────────────────────────────────────────────────────────
class Panel:
    """One track's matrix plus the labels that go around it.

    Deliberately holds NO value range. The scale belongs to the sheet, so that two
    panels cannot end up normalised against different scales — see the module
    docstring.
    """

    def __init__(self, matrix, title, subtitle='', t0=0.0, seconds=None):
        self.matrix = np.asarray(matrix)
        self.title = title
        self.subtitle = subtitle
        self.t0 = float(t0)
        self.seconds = (
            float(seconds) if seconds is not None
            else self.matrix.shape[1] * config.frame_seconds()
        )

    @property
    def t1(self):
        return self.t0 + self.seconds


def labels_from_path(path):
    """(title, subtitle) from `…/<Artist>/<Album folder>/<NN. Title>.flac`.

    Purely cosmetic and purely positional — no tag reading, no metadata library.
    A path that does not match the library's layout degrades to the filename,
    which is the right failure for a diagnostic picture.

    The library's album folders are named `<Artist> - <Album> (<year>) [<format>]`,
    so the artist otherwise appears twice in a row in every subtitle; the leading
    copy is dropped when it matches the parent folder.
    """
    path = os.fspath(path)
    stem = os.path.splitext(os.path.basename(path))[0]
    title = stem
    if '. ' in stem[:4]:
        head, _, tail = stem.partition('. ')
        if head.strip().isdigit():
            title = tail
    parts = os.path.normpath(os.path.dirname(path)).split(os.sep)
    artist = parts[-2] if len(parts) >= 2 else ''
    album = parts[-1] if parts else ''
    if artist and album.startswith(f'{artist} - '):
        album = album[len(artist) + 3:]
    return title, (f'{artist} — {album}'.strip(' —') if (artist or album) else '')


def fit_text(text, px_width, px_per_char):
    """Truncate to what fits, with an ellipsis. Chrome must never leave its panel.

    SVG has no text wrapping and no overflow rule, so a long album folder silently
    runs across the neighbouring panel's axis — which in a four-panel comparison
    sheet is the one thing guaranteed to make the reader distrust the picture.
    Advance widths are approximate on purpose: the fonts are a stack ending in the
    platform default, so an exact measurement is not available and not worth
    embedding a font to get.
    """
    budget = max(4, int(px_width / px_per_char))
    if len(text) <= budget:
        return text
    return text[:budget - 1].rstrip() + '…'


def panel_from_file(path, seconds=0.0, start=None):
    """decode → excerpt → log-mel → Panel. The whole pipeline for one picture."""
    import audio
    signal = audio.decode(path)
    clip, t0 = excerpt(signal, start=start, seconds=seconds)
    matrix = mel.logmelspectrogram(clip)
    title, subtitle = labels_from_path(path)
    return Panel(matrix, title, subtitle, t0=t0,
                 seconds=len(clip) / float(config.SR))


def auto_value_range(panels, low=2.0, high=99.5):
    """One percentile range over EVERY panel's data at once.

    The escape hatch for material the fixed range does not suit — and it takes the
    whole list on purpose. There is no per-panel variant of this function, because
    a per-panel range is the bug this module is built to prevent.
    """
    stacked = np.concatenate([np.asarray(p.matrix).ravel() for p in panels])
    lo, hi = np.percentile(stacked, [low, high])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        return default_value_range()
    return (float(lo), float(hi))


# ── The SVG ─────────────────────────────────────────────────────────────────────
# Emitted as text, because that is all an SVG is. The whole "plotting library" is
# the four functions below.
#
# BOTH FACES SHIP IN ONE FILE. Every colour is a custom property declared twice —
# once on :root and once under prefers-color-scheme: dark — so the same picture
# reads on kraft paper and on the tube without a second render. A token declared
# in one block and forgotten in the other is a line that vanishes on that face,
# so `test_ridge.py` asserts the two blocks define exactly the same names.

_HZ_TICKS = (50, 100, 200, 400, 800, 1600, 3200, 6400, 10000)
_TIME_STEPS = (1, 2, 5, 10, 15, 30, 60, 120, 300, 600)

FONT_SERIF = "Fraunces, 'Iowan Old Style', Georgia, serif"
FONT_MONO = "'IBM Plex Mono', ui-monospace, 'DejaVu Sans Mono', monospace"


def _esc(s):
    return escape(str(s))


def _face_tokens(face, n_bands):
    """A face's complete token set: chrome plus one property per band."""
    tokens = {
        '--sheet': face['surface'],
        '--ink': face['ink'],
        '--ink-2': face['ink_2'],
        '--ink-3': face['ink_3'],
        '--rule': face['rule'],
    }
    for i, colour in enumerate(band_ramp(face, n_bands)):
        tokens[f'--b{i}'] = colour
    return tokens


def _tokens_css(tokens, indent='    '):
    return '\n'.join(f'{indent}{k}: {v};' for k, v in tokens.items())


def _hz_tick_bands():
    """(band index, label) for each round frequency that lands inside the bank."""
    centres = mel.mel_edges()[1:-1]
    out, used = [], set()
    for target in _HZ_TICKS:
        if target < centres[0] or target > centres[-1]:
            continue
        b = int(np.argmin(np.abs(centres - target)))
        if b in used:
            continue
        used.add(b)
        label = f'{target // 1000}k' if target >= 1000 else str(target)
        out.append((b, label))
    return out


def _time_ticks(t0, seconds):
    """(offset seconds from t0, mm:ss label) — ~6 ticks, on a round step."""
    if seconds <= 0:
        return []
    step = next((s for s in _TIME_STEPS if seconds / s <= 8), _TIME_STEPS[-1])
    ticks, t = [], math.ceil(t0 / step) * step
    while t <= t0 + seconds + 1e-9:
        ticks.append((t - t0, mmss(t)))
        t += step
    return ticks


def _panel_svg(panel, index, x, y, plot_w, plot_h, vrange, n_bands):
    """One track's ridgeline, chrome included, positioned at (x, y).

    (x, y) is the top-left of the PLOT BOX; the labels and the frequency rail hang
    off it to the left and above, inside the padding the caller has already
    reserved.
    """
    vmin, vmax = vrange
    span = (vmax - vmin) or 1.0
    bottom = y + plot_h
    pitch = plot_h / (n_bands - 1 + OVERSHOOT)
    excursion = pitch * OVERSHOOT
    clip_id = f'ridge-clip-{index}'
    parts = []

    parts.append(f'<g class="panel">')
    parts.append(
        f'<clipPath id="{clip_id}">'
        f'<rect x="{_fmt(x - 0.5)}" y="{_fmt(y - 1)}" '
        f'width="{_fmt(plot_w + 1)}" height="{_fmt(plot_h + 2)}"/></clipPath>'
    )

    # Titles. The serif is the suite's voice for anything a human reads; the mono
    # carries the machine-side facts (artist, window, length).
    parts.append(
        f'<text class="t-title" x="{_fmt(x)}" y="{_fmt(y - 30)}">'
        f'{_esc(fit_text(panel.title, plot_w, 8.6))}</text>'
    )
    if panel.subtitle:
        parts.append(
            f'<text class="t-sub" x="{_fmt(x)}" y="{_fmt(y - 14)}">'
            f'{_esc(fit_text(panel.subtitle, plot_w - 16, 6.7))}</text>'
        )

    # The plot floor and ceiling — two hairlines, solid, one shade off the surface.
    parts.append(
        f'<line class="rule" x1="{_fmt(x)}" y1="{_fmt(bottom + 0.5)}" '
        f'x2="{_fmt(x + plot_w)}" y2="{_fmt(bottom + 0.5)}"/>'
    )

    # The frequency rail: one rect per band, in that band's own colour. It IS the
    # colour key — no separate legend box, and the Hz labels beside it mean the
    # mapping is never carried by colour alone.
    rail_x = x - RAIL_GAP - RAIL_W
    for b in range(n_bands):
        base = bottom - b * pitch
        parts.append(
            f'<rect x="{_fmt(rail_x)}" y="{_fmt(base - pitch)}" width="{RAIL_W}" '
            f'height="{_fmt(pitch + 0.6)}" fill="var(--b{b})"/>'
        )

    for b, label in _hz_tick_bands():
        base = bottom - b * pitch
        parts.append(
            f'<text class="t-axis" x="{_fmt(rail_x - 6)}" y="{_fmt(base + 3)}" '
            f'text-anchor="end">{_esc(label)}</text>'
        )
    parts.append(
        f'<text class="t-axis t-unit" x="{_fmt(rail_x - 6)}" '
        f'y="{_fmt(y - 14)}" text-anchor="end">Hz</text>'
    )

    # The bands themselves, BACK TO FRONT: the top (air) band is drawn first so the
    # bass rows in front of it paint over it. Each band is ONE polygon — filled
    # with the surface colour so it occludes what is behind, stroked in its own
    # ramp colour so the line reads. The closing vertices sit outside the clip, so
    # the vertical returns to the baseline are clipped away and only the
    # horizontal baseline survives.
    reduced = reduce_columns(panel.matrix, max(2, int(round(plot_w))))
    cols = reduced.shape[1]
    if cols:
        norm = np.clip((reduced.astype(np.float64) - vmin) / span, 0.0, 1.0)
        xs = (x + np.arange(cols) * (plot_w / (cols - 1))) if cols > 1 else np.array([x])
        xs_txt = [_fmt(v) for v in xs]
        parts.append(f'<g clip-path="url(#{clip_id})" class="bands">')
        for b in range(n_bands - 1, -1, -1):
            base = bottom - b * pitch
            ys = base - norm[b] * excursion
            pts = ' '.join(f'{sx},{_fmt(sy)}' for sx, sy in zip(xs_txt, ys))
            parts.append(
                f'<polygon points="{pts} {_fmt(x + plot_w + 6)},{_fmt(base)} '
                f'{_fmt(x - 6)},{_fmt(base)}" stroke="var(--b{b})"/>'
            )
        parts.append('</g>')

    # Time ruler.
    for offset, label in _time_ticks(panel.t0, panel.seconds):
        tx = x + plot_w * (offset / panel.seconds if panel.seconds else 0)
        parts.append(
            f'<line class="rule" x1="{_fmt(tx)}" y1="{_fmt(bottom + 1)}" '
            f'x2="{_fmt(tx)}" y2="{_fmt(bottom + 5)}"/>'
        )
        parts.append(
            f'<text class="t-axis" x="{_fmt(tx)}" y="{_fmt(bottom + 17)}" '
            f'text-anchor="middle">{_esc(label)}</text>'
        )

    parts.append('</g>')
    return '\n'.join(parts)


def render(panels, plot_w=SHEET_PLOT_W, plot_h=PLOT_H, columns=None, value_range=None,
           title='mel ridgelines', caption=None):
    """Panels → one SVG document, as a string. The only entry point that draws.

    `value_range` is taken ONCE and applied to every panel. Passing None takes the
    fixed shared scale; passing 'auto' derives one range from all panels together.
    There is no way to ask for a per-panel scale, which is the point.
    """
    panels = list(panels)
    if not panels:
        raise ValueError('nothing to render — pass at least one Panel')
    if value_range is None:
        value_range = default_value_range()
    elif value_range == 'auto':
        value_range = auto_value_range(panels)
    vmin, vmax = value_range
    bands = {int(p.matrix.shape[0]) for p in panels}
    if len(bands) != 1:
        # One sheet is one comparison, so one band count. `max()` over a mixed
        # set drew the taller panels' extra rows out of the shorter ones' arrays
        # and died on an index, several hundred lines from the mistake — which
        # would have been rendering panels computed under two profiles.
        raise ValueError(
            f'panels carry different band counts {sorted(bands)} — a sheet is one '
            f'comparison against one scale, and mixing profiles makes it meaningless')
    n_bands = bands.pop()
    if plot_h / (n_bands - 1 + OVERSHOOT) < ROW_PITCH_MIN:
        import sys
        print(f'note: {n_bands} rows in {plot_h}px is '
              f'{plot_h / (n_bands - 1 + OVERSHOOT):.1f}px of pitch — below the '
              f'{ROW_PITCH_MIN:.0f}px the rows need to separate; expect a hatch, '
              f'not a ridgeline', file=sys.stderr)

    columns = len(panels) if columns is None else max(1, min(columns, len(panels)))
    rows = math.ceil(len(panels) / columns)
    cell_w = PAD_L + plot_w + PAD_R
    cell_h = PAD_T + plot_h + PAD_B
    head_h = 78
    width = cell_w * columns
    height = head_h + cell_h * rows + 26

    if caption is None:
        caption = (
            f'{n_bands} mel bands · {config.SR} Hz · n_fft {config.N_FFT} · hop {config.HOP} '
            f'· level {vmin:+.1f}…{vmax:+.1f} {config.LOG_MODE}, SHARED across panels '
            f'· column = max over frames · full scale = {OVERSHOOT:.1f} rows'
        )
    desc = ('Stacked mel-band energy over time, one polyline per band, low '
            'frequencies at the bottom. All panels share one absolute level scale.')

    light = _face_tokens(PAPER, n_bands)
    dark = _face_tokens(DARK, n_bands)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label={quoteattr(title)}>',
        f'<title>{_esc(title)}</title>',
        f'<desc>{_esc(desc)}</desc>',
        '<style>',
        ':root {',
        _tokens_css(light),
        '}',
        '@media (prefers-color-scheme: dark) {',
        '  :root {',
        _tokens_css(dark, indent='    '),
        '  }',
        '}',
        f'.bg {{ fill: var(--sheet); }}',
        f'.bands polygon {{ fill: var(--sheet); stroke-width: {LINE_W}; '
        'stroke-linejoin: round; }',
        '.rule { stroke: var(--rule); stroke-width: 1; }',
        f'.t-head {{ font: 600 20px {FONT_SERIF}; fill: var(--ink); }}',
        f'.t-cap {{ font: 400 11px {FONT_MONO}; fill: var(--ink-3); }}',
        f'.t-title {{ font: 600 16px {FONT_SERIF}; fill: var(--ink); }}',
        f'.t-sub {{ font: 400 11px {FONT_MONO}; fill: var(--ink-2); }}',
        f'.t-axis {{ font: 400 10px {FONT_MONO}; fill: var(--ink-3); }}',
        '.t-unit { letter-spacing: 0.08em; }',
        '</style>',
        f'<rect class="bg" x="0" y="0" width="{width}" height="{height}"/>',
        f'<text class="t-head" x="{PAD_L}" y="34">{_esc(title)}</text>',
        f'<text class="t-cap" x="{PAD_L}" y="54">{_esc(caption)}</text>',
    ]

    for i, panel in enumerate(panels):
        col, row = i % columns, i // columns
        out.append(_panel_svg(
            panel, i,
            x=col * cell_w + PAD_L,
            y=head_h + row * cell_h + PAD_T,
            plot_w=plot_w, plot_h=plot_h,
            vrange=(vmin, vmax), n_bands=n_bands,
        ))

    out.append('</svg>')
    return '\n'.join(out) + '\n'


def write(panels, path, **kwargs):
    """`render` to a file, creating the directory. Returns the path."""
    svg = render(panels, **kwargs)
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(svg)
    return path


# ── The numbers behind the picture ──────────────────────────────────────────────
# A figure that cannot be read as text is a figure that cannot be checked. These
# are printed beside every render, and they are also how the shared value range
# gets audited: if a panel is clipping hard at either end, the picture is lying
# about that track and VALUE_RANGE_LN is wrong for this library.
_REGISTERS = (('bass', 0, 16), ('low-mid', 16, 48), ('mid', 48, 80),
              ('high', 80, 112), ('air', 112, 128))


def summarise(panel, value_range=None):
    """One panel as numbers: level percentiles, register means, clipping."""
    vmin, vmax = value_range or default_value_range()
    M = np.asarray(panel.matrix, dtype=np.float64)
    band_mean = M.mean(axis=1) if M.size else np.zeros(M.shape[0])
    centres = mel.mel_edges()[1:-1]
    loudest = int(band_mean.argmax()) if M.size else 0
    p5, p50, p95 = (np.percentile(M, [5, 50, 95]) if M.size else (0.0, 0.0, 0.0))
    return {
        'title': panel.title,
        'seconds': panel.seconds,
        'frames': int(M.shape[1]),
        'p5': float(p5), 'p50': float(p50), 'p95': float(p95),
        'min': float(M.min()) if M.size else 0.0,
        'max': float(M.max()) if M.size else 0.0,
        'clip_lo': float((M < vmin).mean()) if M.size else 0.0,
        'clip_hi': float((M > vmax).mean()) if M.size else 0.0,
        'loudest_band': loudest,
        'loudest_hz': float(centres[loudest]) if M.size else 0.0,
        'registers': [(name, float(band_mean[lo:hi].mean())) for name, lo, hi in _REGISTERS],
    }


def print_summary(panels, value_range=None, stream=None):
    """The table view. Same facts as the picture, in a form that greps."""
    import sys
    stream = stream or sys.stderr
    vmin, vmax = value_range or default_value_range()
    rows = [summarise(p, (vmin, vmax)) for p in panels]
    head = (f'{"track":<34}{"len":>7}{"frames":>8}{"p5":>8}{"p50":>7}{"p95":>7}'
            f'{"clip↓":>7}{"clip↑":>7}{"peak band":>12}')
    print(f'\nlevel scale {vmin:+.1f}…{vmax:+.1f} {config.LOG_MODE}, shared by every panel',
          file=stream)
    print(head, file=stream)
    print('-' * len(head), file=stream)
    for r in rows:
        print(f'{r["title"][:33]:<34}{r["seconds"]:>6.0f}s{r["frames"]:>8}'
              f'{r["p5"]:>8.2f}{r["p50"]:>7.2f}{r["p95"]:>7.2f}'
              f'{r["clip_lo"] * 100:>6.1f}%{r["clip_hi"] * 100:>6.1f}%'
              f'{r["loudest_band"]:>5} ~{r["loudest_hz"]:>4.0f}Hz', file=stream)
    print(f'\n{"track":<34}' + ''.join(f'{n:>10}' for n, _, _ in _REGISTERS), file=stream)
    print('-' * (34 + 10 * len(_REGISTERS)), file=stream)
    for r in rows:
        print(f'{r["title"][:33]:<34}'
              + ''.join(f'{v:>10.2f}' for _, v in r['registers']), file=stream)
    return rows


# ── The check set ───────────────────────────────────────────────────────────────
# The four tracks §8.3 calls for: deliberately unalike, so that "they look
# unalike" is a real observation rather than a hopeful one. Missing files are
# skipped, since these paths are one person's library and the module has to stay
# runnable without it.
#
# ⚠️ **REPOINTED 2026-08-21, AND THE REASON IS THE INTERESTING PART.** These are
# relative paths into one person's library, and that library was re-downloaded
# into a FLAT album layout — so all four of the original paths stopped existing
# on the same day. Nothing failed: `check_set_paths` filtered them all out,
# `verify()` printed "library not mounted" and returned `all(checks)` over the
# five checks that need no audio, and the three that actually exercise the
# encoder on real music — SPREAD, STRUCTURE, SENSITIVITY — were skipped with a
# PASS-shaped summary. A verification gate that quietly stops verifying is worse
# than one that fails, which is why `check_set_missing()` exists below and why
# callers are expected to say so out loud.
CHECK_SET = (
    # hardcore: dense, distorted, fast, almost no tonal centre
    'Converge - All We Love We Leave Behind (2012) [FLAC] [24B-44.1kHz]/'
    '02. Converge - Trespasses.flac',
    # rap: speech-forward over a sampled beat
    'Aesop Rock - Labor Days (2001) [FLAC] [16B-44.1kHz]/02. Aesop Rock - Daylight.flac',
    # modern classical: sustained strings, no percussion, no beat grid at all
    'A Winged Victory For The Sullen - A Winged Victory for the Sullen (2011) [FLAC] [16B-44.1kHz]/'
    '02. A Winged Victory For The Sullen - Requiem for the Static King Part 1.flac',
    # sparse acoustic: one voice, one guitar, quiet
    'Elliott Smith - EitherOr (1997) [FLAC] [16B-44.1kHz]/02. Elliott Smith - Alameda.flac',
)


def check_set_paths(root=None):
    root = config.LIBRARY_ROOT if root is None else root
    return [p for p in (os.path.join(root, rel) for rel in CHECK_SET) if os.path.exists(p)]


def check_set_missing(root=None):
    """The check-set entries that are NOT on disk.

    Exists so "the library is not mounted" and "the library was reorganised and
    every pinned path is stale" stop being the same observation. The first is
    expected on any other machine; the second means the gate has silently stopped
    testing anything, and the only way to tell them apart is to notice that the
    mount is up while the files are gone.
    """
    root = config.LIBRARY_ROOT if root is None else root
    return [rel for rel in CHECK_SET if not os.path.exists(os.path.join(root, rel))]


def _main(argv=None):
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description='Render mel ridgelines as SVG. No arguments renders the §8.3 check set.')
    parser.add_argument('files', nargs='*', help='audio files; default is the check set')
    parser.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'ridge.svg'))
    parser.add_argument('--seconds', type=float, default=0.0,
                        help='length of the window to render; 0 (default) is the whole track')
    parser.add_argument('--start', type=float, default=None,
                        help='window start in seconds; default centres it')
    parser.add_argument('--range', dest='value_range', default=None,
                        help="'auto', or 'lo,hi'; default is the fixed shared scale")
    parser.add_argument('--width', type=int, default=None, help='plot width in px')
    parser.add_argument('--height', type=int, default=PLOT_H, help='plot height in px')
    parser.add_argument('--columns', type=int, default=None,
                        help='default is one row — panels side by side')
    parser.add_argument('--title', default=None)
    args = parser.parse_args(argv)

    paths = args.files or check_set_paths()
    if not paths:
        raise SystemExit(
            f'no files given and none of the check set found under {config.LIBRARY_ROOT}')

    value_range = args.value_range
    if value_range and value_range != 'auto':
        lo, comma, hi = value_range.partition(',')
        try:
            if not comma:
                raise ValueError('needs two numbers')
            value_range = (float(lo), float(hi))
        except ValueError as exc:
            raise SystemExit(
                f"--range wants 'auto' or 'lo,hi' (e.g. '-8,10'), got "
                f"{args.value_range!r}: {exc}") from None
        if value_range[1] <= value_range[0]:
            raise SystemExit(f'--range low must be below high, got {value_range}')

    panels = []
    for path in paths:
        print(f'· {os.path.basename(path)}', file=sys.stderr)
        try:
            panels.append(panel_from_file(path, seconds=args.seconds, start=args.start))
        except Exception as exc:
            # ⚠️ One unreadable file must not cost the whole sheet. The check set
            # is four tracks and a sheet of three is still a check; a traceback
            # after decoding two of them is nothing at all. Broad on purpose —
            # this is a renderer, and every failure here has the same answer.
            print(f'  skipped: {type(exc).__name__}: {exc}', file=sys.stderr)
    if not panels:
        raise SystemExit('nothing could be rendered — every file failed to decode')

    columns = args.columns
    width = args.width or (SHEET_PLOT_W if len(panels) > 1 else SOLO_PLOT_W)
    window = 'full track' if not args.seconds else f'{args.seconds:g}s window'
    title = args.title or f'mel ridgelines — {len(panels)} tracks, {window}'

    resolved = (default_value_range() if value_range is None
                else auto_value_range(panels) if value_range == 'auto' else value_range)
    out = write(panels, args.out, plot_w=width, plot_h=args.height, columns=columns,
                value_range=resolved, title=title)
    print_summary(panels, resolved)
    size = os.path.getsize(out)
    print(f'\nwrote {out} ({size / 1e6:.2f} MB)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
