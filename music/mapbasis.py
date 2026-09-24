#!/usr/bin/env python3
"""M6 — the vibe space's basis: 512-d → (x, y, z, energy), fitted once, stored in `meta`.

    python mapbasis.py --fit       # fit against the calibration already in `meta`
    python mapbasis.py --gate      # recompute G1–G4 for the stored basis and print them
    python mapbasis.py --status    # what is stored, per arm

KourOS draws the library as a 3-D cloud you scrub through a 4th dimension, and
that 4th dimension has a NAME — energy, "calm → intense". The basis that makes it
so is four orthonormal directions in the calibrated space:

    u        the ENERGY PROBE — a ridge regression from the centred vectors onto
             the energy percentile rank (descriptor `logrms_mean`), normalised
    e1…e3    the top three principal axes of what is left once `u` is removed

    B = [e1, e2, e3, u]            coordinates  c = (v − μ) · Bᵀ

⚠️ **WHY NOT PLAIN PCA-4.** PC4 is the weakest axis of the four, it has no name,
and its order and sign flip as the library grows — a swipe through it would mean
something different next month and nothing today. **WHY NOT ENERGY AS A RAW
DESCRIPTOR COLUMN.** Energy is not orthogonal to the rest of the sound, so the
3-D cloud would carry energy too and the slices would drift ACROSS the cloud
instead of cutting through it. Removing `u` before the PCA is what makes the
cloud show everything about the sound except the thing the swipe already shows.
**WHY NOT UMAP / t-SNE.** Outside the dependency budget, no stable coordinate (a
pin must mean the same place tomorrow), and no ordered 4th axis to swipe.

⚠️ **FITTED HERE, NEVER IN KOUROS.** The same reason as `calib_*`: a track that
arrives months later projects against the SAME basis, the fit has provenance, and
KourOS pays ~100 ms at load instead of seconds of JavaScript PCA per rebuild. The
basis is keyed to the calibration it was fitted in (`map_calib:<arm>` is a hash of
`calib_mean:<arm>`), and a basis from before a refit is REFUSED, never used — on
this side by `stale()`, on KourOS's by the same hash AND by five golden tracks
whose stored coordinates it must reproduce within 1e-4.

⚠️ **THE GATE IS PART OF THE FIT, BECAUSE NOBODY IS WATCHING THE FIT.** The watcher
refits whenever the calibration moves. A basis that fails its pre-declared gate
(G1–G4, thresholds fixed below BEFORE the first real fit) is not stored; the
anchored-rotation fallback is tried, and if that fails too the arm is HELD —
`map_held:<arm>` records why, the rest of the index still ships, and KourOS says
"held" out loud. Never an unnamed rail. (Jag, 2026-09-16.)

numpy only. Reads `index.db`'s vectors and descriptors; writes only `map_*` meta
keys. Imports none of the four files that invalidate the index (CLAUDE.md).
"""
import argparse
import base64
import hashlib
import json
import sys
import time

import numpy as np

import descriptors
import index
import query

# Only the neural arm gets a map. ⚠️ KourOS reads the DESCRIPTOR arm raw and centres
# it by a mean fitted in the z-scored space (vectors.js `loadArm`), so a basis fitted
# here over `query.load_arm('descriptors')` would describe a space KourOS never
# builds — the golden check would refuse it on every load. The neural arm is the
# similarity space the gate chose; a descriptor-only index has no map.
ARMS = ('local_vectors',)

ANCHOR = 'energy'
# KourOS's readable features, by descriptor NAME rather than column index — the
# names are what `descriptors.feature_names()` guarantees; the indices are what
# `space.js` has to hope for.
READABLE = {
    'energy': 'logrms_mean',
    'brightness': 'centroid_mean',
    'fuzz': 'flatness_mean',
    'tempo': 'tempo_log2bpm',
    'drive': 'tempo_strength',
    'density': 'onset_rate',
}
AXIS_POLES = {                      # the same poles `map.js` names axes with
    'energy': ('calm', 'intense'),
    'tempo': ('slow', 'fast'),
    'fuzz': ('clean', 'fuzzy'),
    'brightness': ('dark', 'bright'),
    'drive': ('loose', 'driving'),
    'density': ('sparse', 'busy'),
}

SEED = 0
HOLDOUT = 0.2
# The ridge penalty grid, DECLARED UP FRONT and scaled by the mean eigenvalue of
# XᵀX so one grid means the same thing at 500 tracks and at 47,000.
RIDGE_ALPHAS = (1e-4, 1e-3, 1e-2, 1e-1, 1.0, 10.0)
# ⚠️ λ is the LARGEST penalty scoring within this of the best held-out Spearman, not
# the argmax. Measured on the synthetic shelf: the argmax hops between neighbouring
# grid points on a 90% refit and swings `u` by cos 0.91 — the rail would re-aim every
# time the library grew. The one-standard-error rule's shape, at a declared width.
RIDGE_TOLERANCE = 0.01
SIGN_MIN_R = 0.15                   # below this a feature does not name an axis
QUANTILES = 1001                    # the w percentile table
RADIUS_PERCENTILE = 98.0            # the display radius R, isotropic
GOLDEN = 5
GOLDEN_TOLERANCE = 1e-4             # KourOS refuses the basis beyond this
MIN_PROBE_ROWS = 64                 # tracks with BOTH a vector and a descriptor

# ── The pre-declared gate. Confirmed by Jag 2026-09-16, before the first real fit ──
G1_RECALL_RATIO = 0.85              # recall@10 of 512-d neighbours vs PCA-4's
G1_QUERIES = 1000
G1_K = 10
G2_SPEARMAN = 0.6                   # held-out Spearman(w, energy)
G3_ALBUM_IQR = 0.25                 # median within-album IQR of the w percentile
G3_MIN_TRACKS = 6
G4_SUBSAMPLE = 0.9
G4_MIN_COS = (0.95, 0.90, 0.90, 0.95)   # e1, e2, e3, u — signed: a flip is a fail


class MapError(RuntimeError):
    """The basis cannot be fitted or read — the message says what to run."""


def _jsonable(value):
    """NaN and inf become null. ⚠️ `json.dumps` writes a bare `NaN` by default, which
    Python reads back happily and `JSON.parse` in KourOS throws on — so an
    unmeasurable gate number would take the whole map down on the far side."""
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    return value


def _b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr, dtype='<f4').tobytes()).decode('ascii')


def _unb64(text, shape=None):
    arr = np.frombuffer(base64.b64decode(text.encode('ascii')), dtype='<f4').astype(np.float32)
    return arr.reshape(shape) if shape is not None else arr


def calibration_hash(conn, arm):
    """The identity of the calibration a basis is read through. KourOS computes the
    same thing: sha256 of the stored `calib_mean:<arm>` text, first 16 hex."""
    mean = index.get_meta(conn, f'calib_mean:{arm}')
    return hashlib.sha256(mean.encode('ascii')).hexdigest()[:16] if mean else None


# ── Statistics, numpy only ──────────────────────────────────────────────────────
def ranks(x):
    """0…1 ranks, ties averaged. The percentile KourOS uses for features, and the
    input to every Spearman below."""
    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n < 2:
        return np.full(n, 0.5)
    order = np.argsort(x, kind='mergesort')
    r = np.empty(n, dtype=np.float64)
    r[order] = np.arange(n, dtype=np.float64)
    xs = x[order]
    # average the rank over each run of equal values
    starts = np.flatnonzero(np.r_[True, xs[1:] != xs[:-1]])
    ends = np.r_[starts[1:], n]
    for s, e in zip(starts, ends):
        if e - s > 1:
            r[order[s:e]] = (s + e - 1) / 2.0
    return r / (n - 1)


def pearson(a, b):
    a = np.asarray(a, dtype=np.float64) - np.mean(a)
    b = np.asarray(b, dtype=np.float64) - np.mean(b)
    den = np.sqrt((a @ a) * (b @ b))
    return float(a @ b / den) if den > 1e-18 else 0.0


def spearman(a, b):
    return pearson(ranks(a), ranks(b))


def top_eigvecs(cov, k):
    """The top-k eigenvectors of a symmetric matrix, largest first, as (k, D)."""
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1][:k]
    return vecs[:, order].T.copy(), vals[order].copy(), float(np.sum(np.clip(vals, 0, None)))


def orthonormalise(rows):
    """Gram-Schmidt over the rows, in order. The residual axes are ⟂ u by
    construction; this makes it true to the last bit rather than to rounding."""
    out = []
    for v in np.asarray(rows, dtype=np.float64):
        w = v.copy()
        for b in out:
            w -= (w @ b) * b
        n = np.linalg.norm(w)
        if not n > 1e-12:
            raise MapError('the basis is degenerate — two axes are the same direction')
        out.append(w / n)
    return np.stack(out)


# ── The fit set ─────────────────────────────────────────────────────────────────
class FitSet:
    """What KourOS loads, exactly: every neural vector, centred on `calib_mean` and
    re-normalised (`Calibration.centre`), plus the readable features for the rows
    that have a descriptor. `features[name]` is NaN where there is none."""

    def __init__(self, arm, X, ids, paths, features):
        self.arm = arm
        self.X = np.asarray(X, dtype=np.float32)
        self.ids = list(ids)
        self.paths = list(paths)
        self.features = features

    def __len__(self):
        return len(self.ids)

    def subset(self, rows):
        rows = np.asarray(rows)
        return FitSet(self.arm, self.X[rows], [self.ids[i] for i in rows],
                      [self.paths[i] for i in rows],
                      {k: v[rows] for k, v in self.features.items()})


def load_fit_set(conn, arm='local_vectors'):
    calibration = query.Calibration.load(conn, arm)
    if calibration is None:
        raise MapError(f'{arm} has no fitted calibration — run `python query.py --fit` first; '
                       f'the basis lives in the calibrated space KourOS reads')
    if query.Calibration.stale(conn, arm):
        raise MapError(f'{arm}\'s calibration is stale (config changed) — `python query.py --fit`')
    matrix, paths, ids = index.load_matrix(conn, arm)
    if not len(ids):
        raise MapError(f'{arm} holds no vectors')
    X = calibration.centre(matrix)
    names = descriptors.feature_names()
    columns = {k: names.index(v) for k, v in READABLE.items()}
    raw, _dpaths, dids = index.load_matrix(conn, 'descriptors')
    features = {k: np.full(len(ids), np.nan) for k in READABLE}
    if len(dids):
        if raw.shape[1] != len(names):
            raise MapError(f'descriptors are {raw.shape[1]}-d but LAYOUT names {len(names)} — '
                           f'the readable columns cannot be trusted')
        pos = {tid: i for i, tid in enumerate(dids)}
        rows = np.array([pos.get(t, -1) for t in ids])
        have = rows >= 0
        for k, c in columns.items():
            col = np.full(len(ids), np.nan)
            col[have] = raw[rows[have], c]
            features[k] = col
    return FitSet(arm, X, ids, paths, features)


# ── The probe ───────────────────────────────────────────────────────────────────
def split(n, seed=SEED, holdout=HOLDOUT):
    rng = np.random.RandomState(seed)
    order = rng.permutation(n)
    cut = int(round(n * (1.0 - holdout)))
    return order[:cut], order[cut:]


def ridge_direction(Xc, y, lam):
    """β for (XᵀX + λI)β = Xᵀ(y − ȳ), via one eigendecomposition per call site."""
    y = np.asarray(y, dtype=np.float64)
    G = Xc.T @ Xc
    return np.linalg.solve(G + lam * np.eye(G.shape[0]), Xc.T @ (y - y.mean()))


def probe(fs, mu, seed=SEED):
    """The energy direction `u`, the λ chosen for it, and its HELD-OUT Spearman.

    λ is chosen on a seeded 80/20 split from `RIDGE_ALPHAS`; the reported Spearman
    is the split model's on the 20% it never saw (that is G2's number). The stored
    direction is then refitted on every row at that λ, and its sign set so that
    Spearman(Xc·u, energy) > 0 — "up" means more intense, always.
    """
    energy = fs.features[ANCHOR]
    have = np.flatnonzero(np.isfinite(energy))
    if have.size < MIN_PROBE_ROWS:
        raise MapError(
            f'{have.size} of {len(fs)} tracks have a descriptor, and the energy probe needs '
            f'{MIN_PROBE_ROWS}. Build them first: `python analyze.py --stages baseline` '
            f'(or `python descriptors.py --build --encoded`).')
    Xc = fs.X[have].astype(np.float64) - mu
    y = ranks(energy[have])
    train, test = split(have.size, seed)
    Xt = Xc[train]
    G = Xt.T @ Xt
    scale = float(np.trace(G)) / G.shape[0]
    rhs = Xt.T @ (y[train] - y[train].mean())
    scored = []
    for alpha in RIDGE_ALPHAS:
        beta = np.linalg.solve(G + alpha * scale * np.eye(G.shape[0]), rhs)
        scored.append((alpha, spearman(Xc[test] @ beta, y[test]), beta))
    top = max(rho for _a, rho, _b in scored)
    alpha, heldout, beta_split = max((s for s in scored if s[1] >= top - RIDGE_TOLERANCE),
                                     key=lambda s: s[0])
    lam_all = alpha * float(np.trace(Xc.T @ Xc)) / Xc.shape[1]
    beta = ridge_direction(Xc, y, lam_all)
    u = beta / np.linalg.norm(beta)
    if spearman(Xc @ u, y) < 0:
        u = -u
    split_u = beta_split / np.linalg.norm(beta_split)
    return {'u': u, 'alpha': alpha, 'lambda': lam_all, 'heldout': float(heldout),
            'full': float(spearman(Xc @ u, y)), 'n_probe': int(have.size),
            'train': have[train], 'test': have[test], 'split_u': split_u}


def sign_axes(axes, coords, fs, exclude=(ANCHOR,)):
    """Orient each spatial axis so it correlates POSITIVELY with its strongest
    remaining readable feature, and name it after that feature. An axis no feature
    explains (|r| < 0.15) is left unnamed and oriented so the sum of its CUBED
    loadings is positive.

    ⚠️ The plan said "largest-magnitude loading positive", and a 90% refit flipped
    e3 with it (cos −0.998) — the argmax is discontinuous, so two loadings of nearly
    equal size trade places and the axis turns inside out. Σa³ is dominated by the
    same large loadings but moves continuously with the axis: it flips only if the
    axis itself moves, which G4 already measures."""
    axes = np.array(axes, dtype=np.float64)
    coords = np.array(coords, dtype=np.float64)
    used = set(exclude)
    names = []
    for k in range(axes.shape[0]):
        best, best_r = None, 0.0
        for feature, col in fs.features.items():
            if feature in used:
                continue
            have = np.isfinite(col)
            if have.sum() < 3:
                continue
            r = spearman(coords[have, k], col[have])
            if abs(r) > abs(best_r):
                best, best_r = feature, r
        if best is not None and abs(best_r) >= SIGN_MIN_R:
            if best_r < 0:
                axes[k] = -axes[k]
                coords[:, k] = -coords[:, k]
                best_r = -best_r
            used.add(best)
            low, high = AXIS_POLES[best]
            names.append({'feature': best, 'r': round(best_r, 4), 'low': low, 'high': high})
        else:
            if np.sum(axes[k] ** 3) < 0:
                axes[k] = -axes[k]
                coords[:, k] = -coords[:, k]
            names.append(None)
    return axes, coords, names


# ── The two constructions ───────────────────────────────────────────────────────
def construct_primary(cov, u):
    """[e1, e2, e3, u]: residual PCA-3 after removing the probe."""
    P = np.eye(cov.shape[0]) - np.outer(u, u)
    residual = P @ cov @ P
    E, vals, _total = top_eigvecs(residual, 3)
    return orthonormalise(np.vstack([u[None, :], E]))[[1, 2, 3, 0]], vals


def construct_fallback(cov, u):
    """[e1, e2, e3, u′] spanning EXACTLY PCA-4's subspace, rotated so the 4th axis is
    the probe's projection into it. Every distance is PCA-4's; the name is weaker."""
    P4, _vals, _total = top_eigvecs(cov, 4)
    u_in = P4.T @ (P4 @ u)
    norm = np.linalg.norm(u_in)
    if not norm > 1e-9:
        raise MapError('the energy probe is orthogonal to PCA-4 — no anchored rotation exists')
    u_in /= norm
    Q = P4.T @ P4                                   # projector onto span(P4)
    R = np.eye(cov.shape[0]) - np.outer(u_in, u_in)
    restricted = R @ Q @ cov @ Q @ R
    E, vals, _total = top_eigvecs(restricted, 3)
    return orthonormalise(np.vstack([u_in[None, :], E]))[[1, 2, 3, 0]], vals


def covariance(X, mu):
    Xc = np.asarray(X, dtype=np.float64) - mu
    return (Xc.T @ Xc) / max(1, Xc.shape[0])


# ── The basis ───────────────────────────────────────────────────────────────────
class Basis:
    """A fitted basis for one arm: 4 × D rows [e1, e2, e3, u], the fit mean, the
    display radius, the w quantile table, and what it was fitted against."""

    def __init__(self, arm, basis, mean, radius, wq, stats, calib, golden, anchor=ANCHOR):
        self.arm = arm
        self.basis = np.asarray(basis, dtype=np.float32)
        self.mean = np.asarray(mean, dtype=np.float32)
        self.radius = float(radius)
        self.wq = np.asarray(wq, dtype=np.float32)
        self.stats = dict(stats)
        self.calib = calib
        self.golden = list(golden)
        self.anchor = anchor
        if self.basis.shape != (4, self.mean.size):
            raise MapError(f'basis is {self.basis.shape}, mean is {self.mean.size}-d')
        if self.wq.size != QUANTILES:
            raise MapError(f'w quantile table has {self.wq.size} points, expected {QUANTILES}')
        if not self.radius > 0:
            raise MapError(f'display radius {self.radius} cannot be a divisor')

    @property
    def dim(self):
        return int(self.mean.size)

    def project(self, X):
        """Raw 4-D coordinates, computed from the STORED float32 values in float64 —
        the same arithmetic KourOS does, so the golden check compares like with like."""
        X = np.asarray(X, dtype=np.float32).astype(np.float64)
        return (X - self.mean.astype(np.float64)) @ self.basis.astype(np.float64).T

    def w_percentile(self, w):
        return np.interp(np.asarray(w, dtype=np.float64), self.wq.astype(np.float64),
                         np.linspace(0.0, 1.0, QUANTILES))

    def w_raw(self, p):
        return np.interp(np.clip(np.asarray(p, dtype=np.float64), 0, 1),
                         np.linspace(0.0, 1.0, QUANTILES), self.wq.astype(np.float64))

    def display(self, coords):
        """xyz / R clamped to the unit cube, and w as a percentile."""
        coords = np.asarray(coords, dtype=np.float64)
        xyz = np.clip(coords[:, :3] / self.radius, -1.0, 1.0)
        return xyz, self.w_percentile(coords[:, 3])

    # ── persistence ───────────────────────────────────────────────────────────
    def save(self, conn):
        arm = self.arm
        index.set_meta(conn, f'map_basis:{arm}', _b64(self.basis))
        index.set_meta(conn, f'map_mean:{arm}', _b64(self.mean))
        index.set_meta(conn, f'map_radius:{arm}', repr(self.radius))
        index.set_meta(conn, f'map_wq:{arm}', _b64(self.wq))
        index.set_meta(conn, f'map_anchor:{arm}', self.anchor)
        index.set_meta(conn, f'map_stats:{arm}', json.dumps(_jsonable(self.stats), sort_keys=True))
        index.set_meta(conn, f'map_calib:{arm}', self.calib)
        index.set_meta(conn, f'map_golden:{arm}', json.dumps(_jsonable(self.golden)))
        conn.execute('DELETE FROM meta WHERE key = ?', (f'map_held:{arm}',))

    @classmethod
    def load(cls, conn, arm):
        raw = {k: index.get_meta(conn, f'{k}:{arm}') for k in
               ('map_basis', 'map_mean', 'map_radius', 'map_wq', 'map_anchor', 'map_stats',
                'map_calib', 'map_golden')}
        if raw['map_basis'] is None or raw['map_mean'] is None:
            return None
        mean = _unb64(raw['map_mean'])
        return cls(arm, _unb64(raw['map_basis'], (4, mean.size)), mean,
                   float(raw['map_radius']), _unb64(raw['map_wq']),
                   json.loads(raw['map_stats'] or '{}'), raw['map_calib'],
                   json.loads(raw['map_golden'] or '[]'), raw['map_anchor'] or ANCHOR)


def clear(conn, arm):
    conn.execute("DELETE FROM meta WHERE key LIKE ? ESCAPE '\\'", (f'map\\_%:{arm}',))


def stale(conn, arm):
    """True when a basis is stored but was fitted in a different calibration."""
    stored = index.get_meta(conn, f'map_calib:{arm}')
    return bool(stored) and stored != calibration_hash(conn, arm)


def held(conn, arm):
    """The recorded hold for THIS calibration, or None. A hold from an older
    calibration is not a hold — the new geometry deserves a fresh attempt."""
    raw = index.get_meta(conn, f'map_held:{arm}')
    if not raw:
        return None
    try:
        record = json.loads(raw)
    except ValueError:
        return None
    if record.get('calib') != calibration_hash(conn, arm):
        return None
    # A hold for a MISSING PREREQUISITE lapses as soon as the prerequisite moves —
    # descriptors arrive without the calibration refitting, and the next cycle
    # should try again rather than wait for the library to grow 10%.
    if record.get('kind') == 'prerequisite' and record.get('descriptors') != _descriptor_count(conn):
        return None
    return record


def _descriptor_count(conn):
    return conn.execute('SELECT COUNT(*) AS n FROM descriptors').fetchone()['n']


def needs_fit(conn, arm):
    """Why the basis should be (re)fitted, or None when it is current or held."""
    n = conn.execute(f'SELECT COUNT(*) AS n FROM {arm}').fetchone()['n']
    if not n or query.Calibration.load(conn, arm) is None:
        return None                     # nothing to map, or the calibration is owed first
    if held(conn, arm) is not None:
        return None
    if Basis.load(conn, arm) is None:
        return f'{arm} has no map basis'
    if stale(conn, arm):
        return f'{arm}\'s map basis was fitted in a different calibration'
    return None


# ── The gate ────────────────────────────────────────────────────────────────────
def recall_at_k(X, coords, queries, k=G1_K, truth=None):
    """Mean recall@k of each query's 512-d cosine neighbours among its 4-D Euclidean
    neighbours (self excluded). `truth` is reused across candidates."""
    X = np.asarray(X, dtype=np.float32)
    coords = np.asarray(coords, dtype=np.float64)
    if truth is None:
        truth = []
        for start in range(0, len(queries), 256):
            q = queries[start:start + 256]
            scores = X[q] @ X.T
            scores[np.arange(len(q)), q] = -np.inf
            truth.extend(np.argpartition(-scores, k, axis=1)[:, :k])
    hits = 0
    for qi, t in zip(queries, truth):
        d = np.sum((coords - coords[qi]) ** 2, axis=1)
        d[qi] = np.inf
        near = np.argpartition(d, k)[:k]
        hits += len(set(near.tolist()) & set(np.asarray(t).tolist()))
    return hits / (k * len(queries)), truth


def album_iqr(fs, wp, min_tracks=G3_MIN_TRACKS):
    albums = {}
    for i, path in enumerate(fs.paths):
        albums.setdefault(descriptors.album_of(path), []).append(i)
    iqrs = [float(np.subtract(*np.percentile(wp[rows], [75, 25])))
            for rows in albums.values() if len(rows) >= min_tracks]
    return (float(np.median(iqrs)) if iqrs else float('nan')), len(iqrs)


def _construct(kind, cov, u):
    return construct_primary(cov, u) if kind == 'primary' else construct_fallback(cov, u)


def described_floor(subsample=True):
    """How many described tracks a fit needs. With G4 it is the probe's floor over the
    90% refit's share, so the refit can ALWAYS fit its own probe — see `g4_rows`."""
    return int(np.ceil(MIN_PROBE_ROWS / G4_SUBSAMPLE)) if subsample else MIN_PROBE_ROWS


def g4_rows(fs, seed=SEED):
    """The 90% refit's rows, STRATIFIED: 90% of the described tracks and 90% of the rest.

    ⚠️ A plain 90% of all rows can leave the refit with fewer described tracks than its
    probe needs even when the full fit had enough — 64 to 71 described tracks raised
    inside G4, and the arm was HELD as a missing prerequisite over a gate that never ran.
    Stratified, the refit holds round(0.9 × described) of them, which `described_floor`
    guarantees is enough."""
    rng = np.random.RandomState(seed + 2)
    described = np.isfinite(fs.features[ANCHOR])
    rows = []
    for group in (np.flatnonzero(described), np.flatnonzero(~described)):
        if group.size:
            rows.append(rng.choice(group, size=int(round(group.size * G4_SUBSAMPLE)), replace=False))
    return np.sort(np.concatenate(rows)) if rows else np.array([], int)


def build(fs, kind='primary', seed=SEED, truth=None, queries=None, subsample=True):
    """Fit one construction and measure G1–G4 on it. Returns (Basis, gate dict, truth)."""
    have = int(np.isfinite(fs.features[ANCHOR]).sum())
    if have < described_floor(subsample):
        raise MapError(
            f'{have} of {len(fs)} tracks have a descriptor, and the energy probe needs '
            f'{described_floor(subsample)} (its floor of {MIN_PROBE_ROWS}, kept through the 90% '
            f'stability refit). Build them first: `python analyze.py --stages baseline` '
            f'(or `python descriptors.py --build --encoded`).')
    mu = np.asarray(fs.X, dtype=np.float64).mean(axis=0)
    cov = covariance(fs.X, mu)
    pr = probe(fs, mu, seed)
    B, vals = _construct(kind, cov, pr['u'])
    Xc = np.asarray(fs.X, dtype=np.float64) - mu
    coords = Xc @ B.T
    spatial, coords3, names = sign_axes(B[:3], coords[:, :3], fs)
    B = np.vstack([spatial, B[3:]])
    coords = np.hstack([coords3, coords[:, 3:]])

    # G2: held-out Spearman of the rail. For the fallback, the split direction is
    # carried into PCA-4 the same way the full one is, so the number stays honest.
    energy = fs.features[ANCHOR]
    test = pr['test']
    split_u = pr['split_u'] if kind == 'primary' else _construct('fallback', cov, pr['split_u'])[0][3]
    # No abs(): u′ = P4ᵀP4·u keeps u's orientation (u·u′ = ‖P4·u‖ > 0), so a negative
    # number here is a real failure of the rail, not a sign convention.
    g2 = spearman(Xc[test] @ split_u, ranks(energy[test])) if len(test) > 2 else float('nan')

    radius = float(np.percentile(np.linalg.norm(coords[:, :3], axis=1), RADIUS_PERCENTILE))
    wq = np.quantile(coords[:, 3], np.linspace(0.0, 1.0, QUANTILES))
    wq = np.maximum.accumulate(wq)

    n = len(fs)
    rng = np.random.RandomState(seed + 1)
    if queries is None:
        queries = rng.choice(n, size=min(G1_QUERIES, n), replace=False) if n > G1_K + 1 else np.array([], int)
    g1 = g1_pca = float('nan')
    if len(queries):
        g1, truth = recall_at_k(fs.X, coords, queries, truth=truth)
        P4, _v, _t = top_eigvecs(cov, 4)
        g1_pca, truth = recall_at_k(fs.X, Xc @ P4.T, queries, truth=truth)
    ratio = g1 / g1_pca if g1_pca > 0 else float('nan')

    wp = np.interp(coords[:, 3], wq, np.linspace(0.0, 1.0, QUANTILES))
    g3, g3_albums = album_iqr(fs, wp)

    g4 = None
    if subsample:
        sub, _g, _t = build(fs.subset(g4_rows(fs, seed)), kind, seed, subsample=False,
                            queries=np.array([], int))
        cos = [float(np.dot(sub.basis[i].astype(np.float64), B[i])) for i in range(4)]
        g4 = cos

    total = float(np.trace(cov))
    variance = [float(B[i] @ cov @ B[i] / total) if total > 0 else 0.0 for i in range(4)]
    gate = {
        'kind': kind,
        'G1': {'recall': g1, 'pca4': g1_pca, 'ratio': ratio,
               'pass': bool(kind == 'fallback' or ratio >= G1_RECALL_RATIO)},
        'G2': {'spearman': g2, 'pass': bool(g2 >= G2_SPEARMAN)},
        'G3': {'median_iqr': g3, 'albums': g3_albums,
               'pass': bool(g3_albums == 0 or g3 <= G3_ALBUM_IQR)},
        'G4': None if g4 is None else {
            'cos': g4,
            'pass': bool(all(c >= t for c, t in zip(g4, G4_MIN_COS))),
        },
    }
    # ⚠️ Fallback's G1 is PCA-4's own subspace, so its ratio is 1 by construction —
    # measured anyway, and a ratio that is NOT ~1 there means the construction is wrong.
    stats = {
        'mode': kind, 'alpha': pr['alpha'], 'lambda': pr['lambda'],
        'spearman_heldout': g2, 'spearman_full': pr['full'], 'n_probe': pr['n_probe'],
        'n_fit': n, 'variance': variance, 'axes': names, 'seed': seed,
        'gate': gate, 'fitted_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
    basis = Basis(fs.arm, B.astype(np.float32), mu.astype(np.float32), radius, wq.astype(np.float32),
                  stats, None, [])
    return basis, gate, truth


def passed(gate):
    return all(gate[g] is None or gate[g]['pass'] for g in ('G1', 'G2', 'G3', 'G4'))


def golden(basis, fs, seed=SEED):
    rng = np.random.RandomState(seed + 3)
    rows = rng.choice(len(fs), size=min(GOLDEN, len(fs)), replace=False)
    coords = basis.project(fs.X[rows])
    return [{'path': fs.paths[i], 'coords': [float(c) for c in coords[j]]}
            for j, i in enumerate(rows)]


def fit(conn, arm='local_vectors', stream=None, seed=SEED):
    """Fit, gate, and store — or hold — the basis for one arm. Returns the decision:
    `{'arm', 'mode': 'primary'|'fallback'|'held', 'reason'?, 'gate': [...]}`.
    Commits."""
    out = stream or sys.stdout
    calib = calibration_hash(conn, arm)
    try:
        fs = load_fit_set(conn, arm)
        primary, g_primary, truth = build(fs, 'primary', seed)
    except MapError as exc:
        return _hold(conn, arm, calib, 'prerequisite', str(exc), [], out)
    print_gate(g_primary, out)
    gates = [g_primary]
    chosen = primary if passed(g_primary) else None
    if chosen is None:
        try:
            fallback, g_fallback, _t = build(fs, 'fallback', seed, truth=truth)
        except MapError as exc:
            return _hold(conn, arm, calib, 'gate', f'primary failed; fallback impossible: {exc}',
                         gates, out)
        print_gate(g_fallback, out)
        gates.append(g_fallback)
        if passed(g_fallback):
            chosen = fallback
    if chosen is None:
        failing = [g for g in ('G1', 'G2', 'G3', 'G4')
                   if g_primary[g] is not None and not g_primary[g]['pass']]
        return _hold(conn, arm, calib, 'gate',
                     f'the pre-declared gate failed ({", ".join(failing)} on the primary; '
                     f'the fallback failed too) — the rail decision is Jag\'s', gates, out)
    chosen.calib = calib
    chosen.golden = golden(chosen, fs, seed)
    clear(conn, arm)
    chosen.save(conn)
    conn.commit()
    print(f'  {arm}: stored the {chosen.stats["mode"]} basis over {len(fs)} tracks '
          f'(energy probe on {chosen.stats["n_probe"]}), R = {chosen.radius:.4f}', file=out)
    return {'arm': arm, 'mode': chosen.stats['mode'], 'gate': gates}


def _hold(conn, arm, calib, kind, reason, gates, out):
    clear(conn, arm)
    index.set_meta(conn, f'map_held:{arm}', json.dumps(_jsonable({
        'calib': calib, 'kind': kind, 'reason': reason, 'gate': gates,
        'descriptors': _descriptor_count(conn),
        'at': time.strftime('%Y-%m-%dT%H:%M:%S')})))
    conn.commit()
    print(f'  ⚠️ {arm}: map basis HELD ({kind}) — {reason}', file=out)
    return {'arm': arm, 'mode': 'held', 'reason': reason, 'kind': kind, 'gate': gates}


def fit_all(conn, stream=None):
    out = stream or sys.stdout
    results = []
    for arm in ARMS:
        n = conn.execute(f'SELECT COUNT(*) AS n FROM {arm}').fetchone()['n']
        if not n:
            continue
        results.append(fit(conn, arm, stream=out))
    return results


def _fmt(x, spec):
    return 'n/a' if x is None or (isinstance(x, float) and np.isnan(x)) else format(x, spec)


def print_gate(gate, out=None):
    out = out or sys.stdout
    g1, g2, g3, g4 = gate['G1'], gate['G2'], gate['G3'], gate['G4']
    mark = lambda g: '—' if g is None else ('pass' if g['pass'] else 'FAIL')
    print(f'  {gate["kind"]} basis', file=out)
    print(f'    G1 recall@{G1_K} {_fmt(g1["recall"], ".3f")} vs PCA-4 {_fmt(g1["pca4"], ".3f")} '
          f'= {_fmt(g1["ratio"], ".3f")}× (≥ {G1_RECALL_RATIO})   {mark(g1)}', file=out)
    print(f'    G2 held-out Spearman(w, energy) {_fmt(g2["spearman"], "+.3f")} '
          f'(≥ {G2_SPEARMAN})   {mark(g2)}', file=out)
    print(f'    G3 median album IQR of w {_fmt(g3["median_iqr"], ".3f")} over {g3["albums"]} albums '
          f'(≤ {G3_ALBUM_IQR})   {mark(g3)}', file=out)
    if g4 is not None:
        print(f'    G4 90% refit cos e1 {g4["cos"][0]:+.3f} e2 {g4["cos"][1]:+.3f} '
              f'e3 {g4["cos"][2]:+.3f} u {g4["cos"][3]:+.3f}   {mark(g4)}', file=out)
    print(f'    → {"PASSED" if passed(gate) else "FAILED"}', file=out)


def report(conn, stream=None):
    """Every arm's stored state and its gate numbers, without refitting."""
    out = stream or sys.stdout
    for arm in ARMS:
        basis = Basis.load(conn, arm)
        hold = held(conn, arm)
        if basis is not None:
            state = 'STALE — refit' if stale(conn, arm) else 'current'
            print(f'  {arm}: {basis.stats.get("mode")} basis, {state}, n_fit '
                  f'{basis.stats.get("n_fit")}, fitted {basis.stats.get("fitted_at")}', file=out)
            if basis.stats.get('gate'):
                print_gate(basis.stats['gate'], out)
            for k, name in enumerate(basis.stats.get('axes') or []):
                label = f'{name["low"]} → {name["high"]} (r {name["r"]:+.2f})' if name else 'unnamed'
                print(f'    axis {"xyz"[k]}: {label}', file=out)
        elif hold is not None:
            print(f'  {arm}: HELD ({hold["kind"]}) at {hold["at"]} — {hold["reason"]}', file=out)
            for gate in hold.get('gate') or []:
                print_gate(gate, out)
        else:
            reason = needs_fit(conn, arm)
            print(f'  {arm}: no basis{" — " + reason if reason else ""}', file=out)


def _main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--fit', action='store_true', help='fit (or hold) the basis and store it')
    parser.add_argument('--gate', action='store_true',
                        help='refit in memory and print G1–G4 without storing anything')
    parser.add_argument('--status', action='store_true', help='what is stored, per arm')
    parser.add_argument('--db', default=None, help='index (default music/index.db)')
    args = parser.parse_args(argv)
    conn = index.connect(args.db)
    try:
        if args.fit:
            import runlock
            try:
                with runlock.hold('mapbasis.py --fit'):
                    results = fit_all(conn)
            except runlock.Busy as exc:
                print(f'refused: {exc}', file=sys.stderr)
                return 2
            return 0 if all(r['mode'] != 'held' for r in results) else 1
        if args.gate:
            for arm in ARMS:
                fs = load_fit_set(conn, arm)
                _b, gate, truth = build(fs, 'primary')
                print_gate(gate)
                if not passed(gate):
                    print_gate(build(fs, 'fallback', truth=truth)[1])
            return 0
        report(conn)
        return 0
    except MapError as exc:
        print(f'refused: {exc}', file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    raise SystemExit(_main())
