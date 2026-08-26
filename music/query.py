#!/usr/bin/env python3
"""M4 — the similarity gate, and the search surface it is read through (ToDo §8.7).

    load the whole matrix → L2-normalise → `M @ q` → argpartition → top-k

⚠️ **TRAP 18: THERE IS NO ANN INDEX, AND THAT IS THE DESIGN.** The neural arm is
15,326 × 512 float32 = 31 MB; even §8.7's worst-case 2048-d sketch is 125 MB. One
matmul over that is milliseconds. FAISS, hnswlib and `sqlite-vec` all solve the
problem of a matrix that does not fit in memory or a query budget measured in
microseconds, and this library has neither. Reaching for one here would be
optimising a problem that does not exist — and paying for it in a dependency,
an index build step, and *approximate* answers to the one question the whole
project exists to answer correctly.

WHAT THIS MODULE IS FOR, in the order it matters:

  1. **The hand check** (`--hand`). §8.7 is explicit that the gate is a person
     reading neighbour lists for tracks they know cold, and that this judgement
     must NOT be automated. Everything here formats that sheet; nothing here
     grades it.
  2. **The objective proxies** (`--gate`), *alongside* the hand check and never
     instead of it: same-album and same-artist nearest-neighbour rates for both
     arms. The neural arm should beat the descriptor arm on both.
  3. **Search** (`query.py <fragment>`), which is what M5–M7 would build on if
     the gate passes.

⚠️ **THE TWO WAYS THE PROXY LIES, BOTH FOUND AT §8.6, BOTH ANSWERED HERE.**

  (a) **Exact duplicates.** ~20% of this library is a single that also appears on
      its album — AFI alone ships four copies of one track — and at §8.6's early
      read 22.9% of tracks had a duplicate as their nearest neighbour. "Shares an
      album" scores every one of those as a MISS while it is the most correct
      answer a similarity search can possibly give. So this module reports THREE
      numbers where §8.6 reported one, and never collapses them into a verdict:
      the raw rate, the rate crediting a duplicate as a hit, and the rate over
      only those tracks whose nearest neighbour is not a duplicate.

      ⚠️ **A duplicate is identified from the PATH, not from a cosine.** The
      tempting definition is "cosine ≥ 0.999", and it silently rigs the
      comparison: a 119-dimension z-scored descriptor space puts near-1 pairs
      within reach of two different masterings far more easily than a 512-d CLAP
      space does, so the arm with the coarser space would be handed free hits by
      the very measurement meant to judge it. `song_key()` reads the artist
      directory and the normalised filename — the same evidence for both arms.
      `duplicate_audit()` then checks that definition against the cosines rather
      than assuming it, and prints the agreement.

  (b) **The two arms must be read over the SAME tracks.** §8.4's 49.2% came from
      887 tracks chosen as complete albums spread over 39 artists; the neural
      backfill ran in path order and stopped inside artist six. Comparing those
      two numbers would be comparing two populations, not two arms — a library of
      6 artists has a far higher same-artist chance rate than one of 39, so the
      "worse" arm could win on population alone. `align()` intersects the two
      tables by `track_id` and every rate below is computed over that
      intersection only, with the chance baselines recomputed for it.

⚠️ **THE STOP CONDITION IS PART OF THE MODULE, NOT PART OF THE ETIQUETTE.** If
the descriptors win, something upstream is broken — extraction, a windowing
config mismatch, pooling, or normalisation — and nothing downstream of M4 gets
built until it is found. `gate()` prints that in the failing branch rather than
leaving it in a document, because the person reading a red gate at 1 a.m. is
reading the terminal.
"""
import base64
import os
import sys

import numpy as np

import descriptors
import index

# The two vector spaces, and the labels they are read under. `local_vectors` is
# the neural arm (§8.5's CLAP audio tower); `descriptors` is the classical arm
# (§8.4's 119 dimensions), which exists to be beaten and was built first on
# purpose — an arm built after the thing it judges never gets built.
ARMS = ('local_vectors', 'descriptors')
ARM_LABELS = {
    'local_vectors': 'neural (CLAP 512-d)',
    'descriptors': 'descriptor (119-d)',
}

# Cosine at or above which two vectors are treated as "the same recording" for
# the corroborating audit only — never for scoring. §8.6 measured two
# differently-encoded FLACs of one song landing BIT-IDENTICAL, so this is a
# generous floor for a phenomenon that in practice sits at 1.0.
NEAR_IDENTICAL = 0.999

DEFAULT_K = 10
PROXY_PAIRS = 200000


class QueryError(RuntimeError):
    """Raised for an empty arm, a query that matches nothing, or a mismatched pair."""


# ── Reading the shelf off the path ──────────────────────────────────────────────
# The library is `<root>/<artist>/<album>/<NN. title>.flac`, so the directory IS
# the grouping and no tags are read. §8.4 made that call for `album_of` and the
# reasoning carries: an ID3 pass would be a second source of truth about which
# tracks belong together, and the gate would then be testing the tags as much as
# the vectors. `album_of`/`artist_of` are imported rather than re-derived so the
# two arms cannot come to disagree about what an album is.
album_of = descriptors.album_of
artist_of = descriptors.artist_of

# Leading track numbers, in the three shapes this library actually uses:
# `04. Title`, `04 - Title`, `04 Title`. Stripped so that the same song filed as
# track 4 on the album and track 2 on the single collapses to one key.
_LEADING_NUMBER = ('0123456789')


def title_of(path):
    """The filename with its extension and any leading track number removed.

    ⚠️ A bare number is only stripped when a SEPARATOR follows it. `04 Title`
    loses the 4; `1979` — a real song on this shelf — keeps all of it, because
    nothing separates the digits from a title that is entirely digits.
    """
    name = os.path.splitext(os.path.basename(path))[0]
    i = 0
    while i < len(name) and name[i] in _LEADING_NUMBER:
        i += 1
    if not i:
        return name
    rest = name[i:]
    for sep in ('.', '-', '_', ' '):
        if rest.startswith(sep):
            stripped = rest.lstrip('.-_ ')
            return stripped or name
    return name


def song_key(path):
    """`(artist, folded title)` — the arm-independent identity of a recording.

    ⚠️ **Qualifiers are deliberately KEPT.** `Totalimmortal` and
    `Totalimmortal (Live)` are two different recordings and crediting a search
    for confusing them would be crediting it for being wrong. Only punctuation,
    case and whitespace are folded away, because `Girl's Not Grey` and
    `Girls Not Grey` across two rips are the same audio and differ only in how
    the ripper handled an apostrophe.
    """
    title = ''.join(c.lower() for c in title_of(path) if c.isalnum())
    return (artist_of(path).lower(), title)


# How much of the column the artist may take before the title starts losing
# characters. The two fields are not equally informative and the layout should
# not pretend they are.
ARTIST_BUDGET = 16


def short(path, width=46):
    """`Artist · Title`, fitted to `width`. **The album is deliberately dropped.**

    ⚠️ The first version of this printed `Artist · Album · Title` trimmed from
    the left, and it was unreadable in exactly the case the sheet exists for. A
    directory on this shelf is `Bowling For Soup - I've Never Done Anything Like
    This (2011) [16B-44.1kHz]` — sixty characters of which four matter — so the
    album ate the column and the trim then removed the ARTIST, which is the one
    field you need to see when a neighbour comes from somewhere else. The album
    is already reported losslessly by the `A` mark; the artist is not.

    The artist is capped rather than given half the column, because artist names
    are short and titles are not.
    """
    artist = artist_of(path)
    title = title_of(path)
    if len(artist) > ARTIST_BUDGET:
        artist = artist[:ARTIST_BUDGET - 1] + '…'
    room = width - len(artist) - 3
    if room < 1:
        return f'{artist} · {title}'[:width].ljust(width)
    if len(title) > room:
        title = title[:room - 1] + '…'
    return f'{artist} · {title}'.ljust(width)


# ── An arm ──────────────────────────────────────────────────────────────────────
class Arm:
    """One loaded vector space: an L2-normalised (N, dim) matrix and its paths.

    ⚠️ **L2 IS RE-APPLIED HERE EVEN THOUGH BOTH PRODUCERS ALREADY DO IT.** The
    encoder normalises in `pool()` and the descriptor arm normalises in
    `load_normalised()`, so this is redundant — and it is the redundancy that
    makes `M @ q` *mean* cosine rather than merely happen to. A future arm that
    forgets would not raise; it would return a ranking quietly biased toward
    whichever tracks have the longest vectors, which is precisely the class of
    failure this whole project is built to refuse.
    """

    def __init__(self, name, matrix, paths, ids):
        matrix = np.asarray(matrix, dtype=np.float32)
        if matrix.ndim != 2 or not matrix.size:
            raise QueryError(f'{name}: no vectors to search — run the backfill first')
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        self.name = name
        self.label = ARM_LABELS.get(name, name)
        self.matrix = (matrix / np.where(norms > 0, norms, 1.0)).astype(np.float32)
        self.paths = list(paths)
        self.ids = list(ids)
        if not (len(self.paths) == len(self.ids) == self.matrix.shape[0]):
            raise QueryError(
                f'{name}: {self.matrix.shape[0]} vectors against {len(self.paths)} paths '
                f'and {len(self.ids)} ids — the three are read positionally by every '
                f'rate below, so a mismatch would label neighbours with other tracks.')
        # `nearest()` is O(N²) and three of the four things `gate()` prints ask
        # for it. Memoised per arm because the matrix is immutable after this
        # point: at 15,326 × 512 one pass is ~120 GFLOP, and the first version
        # ran it three times for one report.
        self._nearest = None
        self._position = {tid: i for i, tid in enumerate(self.ids)}

    def __len__(self):
        return len(self.paths)

    @property
    def dim(self):
        return int(self.matrix.shape[1])

    def index_of(self, track_id):
        try:
            return self._position[track_id]
        except KeyError:
            raise QueryError(f'{self.name}: track {track_id} is not in this arm') from None

    def search(self, row, k=DEFAULT_K):
        """Top-`k` neighbours of `row` (an int index or a vector), self excluded.

        `argpartition` rather than a full sort: the whole point of Trap 18 is
        that the matmul is cheap, and sorting 15,326 scores to read ten of them
        is the one place the naive version would actually cost something.
        """
        if isinstance(row, (int, np.integer)):
            i = int(row)
            if not -len(self) <= i < len(self):
                raise QueryError(f'{self.name}: row {i} is outside 0…{len(self) - 1}')
            i, q = i % len(self), self.matrix[i]
        else:
            i, q = -1, np.asarray(row, dtype=np.float32)
            if q.shape != (self.dim,):
                raise QueryError(
                    f'{self.name}: a query vector must be {self.dim}-d, got {q.shape}')
            norm = float(np.linalg.norm(q))
            q = q / norm if norm else q
        # ⚠️ k is clamped, not trusted. `argpartition(-scores, k - 1)` with k ≤ 0
        # passes a NEGATIVE kth, which numpy reads from the end and answers
        # without complaint — so `-k 0` returned an empty list and `-k -3`
        # returned four arbitrary rows presented as the four nearest.
        if int(k) < 1:
            raise QueryError(f'k must be at least 1, got {k}')
        scores = self.matrix @ q
        if i >= 0:
            scores[i] = -np.inf
        available = len(scores) - (1 if i >= 0 else 0)
        if available < 1:
            return []                       # a one-track arm has no neighbours
        k = min(int(k), available)
        top = np.argpartition(-scores, k - 1)[:k] if k < len(scores) else np.arange(len(scores))
        top = top[np.argsort(-scores[top])]
        return [(int(j), self.ids[j], self.paths[j], float(scores[j])) for j in top]

    def nearest(self):
        """The index of every track's single nearest neighbour, self excluded.

        Chunked at 512 rows: the full N² score matrix for the whole library would
        be 940 MB of float32 for a result that is one column wide. Same
        brute-force-is-fine argument as `search`, one order of magnitude up
        because it is every query at once.
        """
        if self._nearest is not None:
            return self._nearest
        n = len(self)
        if n < 2:
            raise QueryError(
                f'{self.name}: {n} track(s) — a nearest neighbour needs a second one')
        out = np.empty(n, dtype=np.int64)
        for start in range(0, n, 512):
            block = self.matrix[start:start + 512] @ self.matrix.T
            np.fill_diagonal(block[:, start:start + block.shape[0]], -np.inf)
            out[start:start + block.shape[0]] = block.argmax(axis=1)
        out.flags.writeable = False          # memoised and shared: nobody edits it
        self._nearest = out
        return out


def load_arm(conn, table):
    """Load one arm from the index, normalised the way that arm requires."""
    if table == 'descriptors':
        # The z-score is part of the descriptor space's definition, not a display
        # choice — an un-normalised MFCC dimension spanning hundreds swamps a
        # flatness dimension spanning fractions, and the cosine becomes a
        # measurement of which features happen to have large units.
        matrix, paths, ids, _stats = descriptors.load_normalised(conn)
    else:
        matrix, paths, ids = index.load_matrix(conn, table)
    return Arm(table, matrix, paths, ids)


def align(*arms):
    """Restrict every arm to the track ids all of them hold, in one shared order.

    ⚠️ **THIS IS THE SECOND OF §8.7'S TWO PROXY LIES, AND IT IS THE ONE THAT
    LOOKS LIKE NOTHING.** The descriptor table was filled by §8.4 with 887 tracks
    picked as complete albums spread across 39 artists; the neural backfill ran
    in path order and stopped part-way through artist six. Both arms would happily
    report a nearest-neighbour rate over their own rows, the numbers would be
    directly comparable in appearance, and they would be measuring two different
    libraries — the six-artist population has a same-artist chance rate an order
    of magnitude higher, so the WORSE arm could win on population alone.

    Returns new `Arm`s; the originals are untouched.
    """
    if len(arms) < 2:
        return list(arms)
    shared = set(arms[0].ids)
    for arm in arms[1:]:
        shared &= set(arm.ids)
    if not shared:
        raise QueryError(
            'the arms share no tracks — build the descriptor arm over the encoded '
            'tracks first: `descriptors.py --build --encoded`')
    order = sorted(shared)
    out = []
    for arm in arms:
        pos = {tid: i for i, tid in enumerate(arm.ids)}
        rows = [pos[t] for t in order]
        out.append(Arm(arm.name, arm.matrix[rows], [arm.paths[i] for i in rows], order))
    return out


# ── The corpus geometry: what a cosine in this arm MEANS ────────────────────────
# ⚠️ **A COSINE IS NOT A SIMILARITY UNTIL YOU KNOW WHERE ZERO IS, AND FOR CLAP IT
# IS NOWHERE NEAR ZERO.** `report()` above already had to learn this the hard way:
# the descriptor arm is z-scored, so it is centred and strangers sit at -0.017,
# while CLAP's space is a narrow anisotropic cone in which every pair of tracks in
# the library scores at least +0.03 and two STRANGERS average +0.480 with a spread
# of 0.219. The gate handles that by standardising before it compares the arms —
# but the gate is not the only reader. Anything downstream that ranks, thresholds,
# blends a cosine with another quantity, or shows a number to a person inherits the
# raw cone and is wrong in a way that looks plausible: a stranger presents as "0.48
# similar", every score lands in a compressed 0.4-0.9 band, and a similarity term
# multiplied against anything else contributes a near-constant.
#
# So the geometry is FITTED ONCE, over the corpus, and STORED — exactly as §8.4
# already does for the descriptor z-score (`descriptors.CorpusStats`). This is that
# class's twin for a space whose dimensions are already commensurate and whose
# problem is therefore not scale per dimension but OFFSET and SPREAD overall:
#
#   mean            the cone's axis. Subtract it and the space is centred, which is
#                   the condition under which cosine ordering stops being dominated
#                   by the one direction every track shares.
#   stranger_mean   where "unrelated" actually sits AFTER centring — the zero point.
#   stranger_spread the unit. Dividing by it is what makes a score comparable with
#                   the other arm, and it is the same divisor `report()` uses.
#
# ⚠️ **THE STATISTICS ARE MEASURED IN THE SPACE THE READER WILL USE, NOT THE SPACE
# THEY WERE LOADED IN.** Centring changes every cosine, so a spread measured on the
# raw cone and then applied to centred vectors is the wrong divisor — the numbers
# would look calibrated and be off by the amount centring moved them. `fit` centres
# and re-normalises FIRST and samples afterwards.
#
# A "stranger" is a pair by different artists, read off the path by `artist_of` —
# the same definition, from the same function, as the gate's. If the two ever
# disagreed, the divisor would stop matching the statistic it is meant to scale.
class Calibration:
    """The fitted offset and scale for one arm, stored in `meta` and read by
    every consumer that needs a cosine to mean something.

    ⚠️ There is deliberately no way to build one from a handful of tracks:
    `fit` refuses below `descriptors.MIN_FIT_ROWS`, and a corpus with no
    cross-artist pair at all is refused outright rather than fitted with a nan
    divisor — the same nan-category trap §8.4's gate fell into, where an
    unmeasurable statistic silently became a verdict.
    """

    def __init__(self, arm, mean, stranger_mean, stranger_spread, n_fit=0, pairs=0):
        self.arm = str(arm)
        self.mean = np.asarray(mean, dtype=np.float32)
        self.stranger_mean = float(stranger_mean)
        self.stranger_spread = float(stranger_spread)
        self.n_fit = int(n_fit)
        self.pairs = int(pairs)
        if self.mean.ndim != 1 or not self.mean.size:
            raise QueryError(f'{arm}: the calibration mean must be one 1-D vector, '
                             f'got shape {self.mean.shape}')
        if not self.stranger_spread > 0:
            raise QueryError(
                f'{arm}: a stranger spread of {self.stranger_spread} cannot be a '
                f'divisor. Every pair in the corpus scored identically, which means '
                f'the arm is degenerate — not that the space is tight.')

    @property
    def dim(self):
        return int(self.mean.size)

    def centre(self, matrix):
        """Subtract the axis and re-normalise, so `M @ q` is a CENTRED cosine.

        Returns the matrix the statistics below were actually measured over.
        A row landing exactly on the mean has no direction left and is returned
        as zeros rather than as nan — it drops out of every ranking instead of
        poisoning one.
        """
        arr = np.asarray(matrix, dtype=np.float32)
        if arr.shape[-1] != self.dim:
            raise QueryError(f'{self.arm}: calibration is {self.dim}-d, got {arr.shape[-1]}')
        out = arr - self.mean
        norms = np.linalg.norm(out, axis=-1, keepdims=True)
        return np.divide(out, np.where(norms > 0, norms, 1.0)).astype(np.float32)

    def standardise(self, cosine):
        """A centred cosine in stranger units: 0 is unrelated, 1 is one spread above."""
        return (np.asarray(cosine, dtype=np.float64) - self.stranger_mean) / self.stranger_spread

    @classmethod
    def fit(cls, arm, pairs=PROXY_PAIRS, seed=0):
        """Fit over a loaded `Arm`, in the centred space its readers will use."""
        n = len(arm)
        if n < descriptors.MIN_FIT_ROWS:
            raise QueryError(
                f'refusing to calibrate {arm.name} over {n} track(s); '
                f'{descriptors.MIN_FIT_ROWS} is the floor. Statistics fitted on a '
                f'handful of tracks are a per-track normalisation wearing a corpus '
                f'costume — §8.4 made that refusal mechanical and it carries here.')
        mean = arm.matrix.mean(axis=0)
        centred = cls(arm.name, mean, 0.0, 1.0).centre(arm.matrix)

        artists = np.array([artist_of(p) for p in arm.paths])
        rng = np.random.RandomState(seed)
        i = rng.randint(0, n, size=pairs)
        j = rng.randint(0, n, size=pairs)
        keep = i != j
        i, j = i[keep], j[keep]
        stranger = artists[i] != artists[j]
        if not stranger.any():
            raise QueryError(
                f'{arm.name}: every sampled pair shares an artist, so there is no '
                f'"unrelated" to measure and no zero point to calibrate against. '
                f'A one-artist corpus cannot be calibrated — build more first.')
        cosine = np.einsum('ij,ij->i', centred[i[stranger]], centred[j[stranger]])
        return cls(arm.name, mean, float(cosine.mean()), float(cosine.std()),
                   n_fit=n, pairs=int(stranger.sum()))

    # ── persistence, in `meta` ──────────────────────────────────────────────────
    # Keyed `<name>:<table>`, the convention `config_sig:local_vectors` and
    # `recipe:local_vectors` already established — so this generalises to the
    # descriptor arm for free, and a reader can normalise EITHER arm the same way
    # without knowing which one it got. That is the point: §8.7's two arms are on
    # incompatible scales, and a consumer that silently falls back from one to the
    # other changes behaviour without changing code.
    def save(self, conn):
        index.set_meta(conn, f'calib_mean:{self.arm}', _b64(self.mean))
        index.set_meta(conn, f'calib_stranger_mean:{self.arm}', repr(self.stranger_mean))
        index.set_meta(conn, f'calib_stranger_spread:{self.arm}', repr(self.stranger_spread))
        index.set_meta(conn, f'calib_n_fit:{self.arm}', self.n_fit)
        index.set_meta(conn, f'calib_pairs:{self.arm}', self.pairs)
        # The signature the fit was taken against. A backfill that continues after
        # a config edit leaves a calibration describing a space that no longer
        # exists, and nothing else would notice.
        sig = index.get_meta(conn, f'config_sig:{self.arm}')
        if sig:
            index.set_meta(conn, f'calib_sig:{self.arm}', sig)

    @classmethod
    def load(cls, conn, arm):
        mean = index.get_meta(conn, f'calib_mean:{arm}')
        centre = index.get_meta(conn, f'calib_stranger_mean:{arm}')
        spread = index.get_meta(conn, f'calib_stranger_spread:{arm}')
        if mean is None or centre is None or spread is None:
            return None
        return cls(arm, _unb64(mean), float(centre), float(spread),
                   n_fit=int(index.get_meta(conn, f'calib_n_fit:{arm}', 0)),
                   pairs=int(index.get_meta(conn, f'calib_pairs:{arm}', 0)))

    @classmethod
    def stale(cls, conn, arm):
        """True when the arm has been rebuilt under a different config since the fit."""
        fitted = index.get_meta(conn, f'calib_sig:{arm}')
        current = index.get_meta(conn, f'config_sig:{arm}')
        return bool(fitted and current and fitted != current)


def _b64(vec):
    return base64.b64encode(index.to_blob(np.asarray(vec, dtype=np.float32))).decode('ascii')


def _unb64(text):
    return index.from_blob(base64.b64decode(text.encode('ascii')))


def fit_calibration(conn, tables=ARMS, stream=None):
    """Fit and store the corpus geometry for every arm that holds vectors.

    Run after a backfill: the mean of a half-filled library is the mean of
    whatever the run reached in path order, which on this shelf is alphabetical
    by artist. That is a real bias, not a rounding error, and it is why this is
    a separate step rather than something the backfill does per commit.
    """
    out = stream or sys.stdout
    fitted = []
    for table in tables:
        try:
            arm = load_arm(conn, table)
        except (QueryError, descriptors.DescriptorError):
            print(f'  {ARM_LABELS.get(table, table):<22} no vectors — skipped', file=out)
            continue
        calibration = Calibration.fit(arm)
        calibration.save(conn)
        fitted.append(calibration)
        print(f'  {ARM_LABELS.get(table, table):<22} {calibration.n_fit:>6} tracks   '
              f'strangers {calibration.stranger_mean:+.4f} ± {calibration.stranger_spread:.4f}   '
              f'({calibration.pairs} pairs)', file=out)
    if not fitted:
        raise QueryError('no arm holds vectors — run the backfill first')
    conn.commit()
    print('  stored in `meta` as calib_*:<arm> — KourOS reads these rather than '
          'assuming a zero point.', file=out)
    return fitted


# ── The objective proxies ───────────────────────────────────────────────────────
def _duplicate_share(songs):
    """The fraction of tracks that have at least one other copy in this set.

    §8.6 measured 20% over the first ~1,000 tracks by path, which is why the
    three-rate report above exists at all.
    """
    _values, inverse, counts = np.unique(songs, return_inverse=True, return_counts=True)
    return float(np.mean(counts[inverse] > 1))


def report(arm, pairs=PROXY_PAIRS, seed=0):
    """Nearest-neighbour and mean-cosine statistics for one arm.

    Every rate is accompanied by what chance would score on THIS population, via
    `descriptors.chance_rate` — shared with §8.4's gate so the two cannot drift.
    Without it "62% of neighbours share an album" is a number with no scale.
    """
    paths = arm.paths
    n = len(paths)
    if n < 4:
        raise QueryError(f'{n} tracks is not enough to compare — build more first')
    albums = np.array([album_of(p) for p in paths])
    artists = np.array([artist_of(p) for p in paths])
    songs = np.array(['\x00'.join(song_key(p)) for p in paths])

    nn = arm.nearest()
    nn_cos = np.einsum('ij,ij->i', arm.matrix, arm.matrix[nn])
    nn_album = albums[nn] == albums
    nn_artist = artists[nn] == artists
    nn_dup = songs[nn] == songs

    rng = np.random.RandomState(seed)
    i = rng.randint(0, n, size=pairs)
    j = rng.randint(0, n, size=pairs)
    keep = i != j
    i, j = i[keep], j[keep]
    cosine = np.einsum('ij,ij->i', arm.matrix[i], arm.matrix[j])
    same_album = albums[i] == albums[j]
    same_artist = (artists[i] == artists[j]) & ~same_album
    stranger = artists[i] != artists[j]

    def summarise(mask):
        values = cosine[mask]
        if not values.size:
            return (float('nan'), float('nan'), 0)
        return (float(values.mean()), float(values.std()), int(values.size))

    # ⚠️ **THE RAW COSINE GAP IS NOT COMPARABLE BETWEEN TWO SPACES, AND READING
    # IT AS IF IT WERE IS HOW THIS GATE FIRST REPORTED THE BASELINE WINNING.**
    # The descriptor arm is z-scored across the corpus, so it is CENTRED: strangers
    # sit at -0.017 with a spread of 0.309, and the space uses its whole range.
    # CLAP's space is a narrow anisotropic cone — every pair of tracks in the
    # library scores at least +0.03 and strangers average +0.480 with a spread of
    # 0.219. Subtracting one mean from the other therefore measures how WIDE each
    # space is, not how well either separates music, and the wider space wins by
    # construction. Dividing by the stranger spread removes both the offset and
    # the scale, which is the only form of the statistic that can be put in one
    # table with the other arm. Measured here: the raw gap says descriptors
    # (+0.4125 vs +0.3161) and the standardised gap says neural (1.45 vs 1.34) —
    # agreeing with all three ranking measures, which are what a search reads.
    def effect(mask):
        # A one-album corpus has no stranger pairs at all, and `nan > x` is False —
        # the same shape that once made §8.4's gate report FAILED on descriptors
        # that were working. An unmeasurable category returns nan and is EXCLUDED
        # from the comparison rather than counted as a loss.
        mean, _std, count = summarise(mask)
        if not count or not stranger.any():
            return float('nan')
        spread = float(cosine[stranger].std())
        if not spread:
            return float('nan')
        return (mean - float(cosine[stranger].mean())) / spread

    # ⚠️ The three album rates, never collapsed into one. `raw` is what §8.6
    # reported and what a reader will assume; `credited` counts a duplicate as
    # the hit it is; `clean` throws the duplicates out of the population
    # entirely and asks the original question of what remains. They disagree by
    # 20 points on this library and a single number would be a lie whichever one
    # it was.
    clean = ~nn_dup
    return {
        'arm': arm.name,
        'label': arm.label,
        'n_tracks': n,
        'dim': arm.dim,
        'n_albums': int(len(set(albums))),
        'n_artists': int(len(set(artists))),
        'n_songs': int(len(set(songs))),
        'dup_tracks': _duplicate_share(songs),
        'same_album': summarise(same_album),
        'same_artist': summarise(same_artist),
        'different': summarise(stranger),
        'nn_album_raw': float(nn_album.mean()),
        'nn_album_credited': float((nn_album | nn_dup).mean()),
        'nn_album_clean': float(nn_album[clean].mean()) if clean.any() else float('nan'),
        'nn_artist': float(nn_artist.mean()),
        'nn_dup': float(nn_dup.mean()),
        'nn_clean_n': int(clean.sum()),
        'chance_album': descriptors.chance_rate(albums),
        'chance_artist': descriptors.chance_rate(artists),
        'chance_song': descriptors.chance_rate(songs),
        'nn_cos_mean': float(nn_cos.mean()),
        'd_album': effect(same_album),
        'd_artist': effect(same_artist),
    }


def duplicate_audit(arm, threshold=NEAR_IDENTICAL):
    """Check `song_key`'s claim against the arm's own cosines instead of trusting it.

    `song_key` is a filename heuristic and heuristics are exactly the thing this
    project keeps refusing to assume. This measures it: of the nearest-neighbour
    pairs sitting at cosine ≥ `threshold` — vectors that ARE the same audio by
    any reading — how many does the path-based key agree are the same song, and
    how many pairs does the key claim that the cosines do not support.
    """
    songs = np.array(['\x00'.join(song_key(p)) for p in arm.paths])
    nn = arm.nearest()
    cos = np.einsum('ij,ij->i', arm.matrix, arm.matrix[nn])
    by_cosine = cos >= threshold
    by_name = songs[nn] == songs
    return {
        'threshold': float(threshold),
        'n': len(arm),
        'by_cosine': int(by_cosine.sum()),
        'by_name': int(by_name.sum()),
        'both': int((by_cosine & by_name).sum()),
        'cosine_not_name': int((by_cosine & ~by_name).sum()),
        'name_not_cosine': int((by_name & ~by_cosine).sum()),
        'agreement': float((by_cosine & by_name).sum() / max(int(by_cosine.sum()), 1)),
        'name_cos_median': float(np.median(cos[by_name])) if by_name.any() else float('nan'),
    }


# ── The sheets ──────────────────────────────────────────────────────────────────
def _marks(query_path, path, cosine):
    """A three-slot legend for one neighbour row: `= A a`."""
    same_song = song_key(query_path) == song_key(path)
    return ''.join((
        '=' if (same_song or cosine >= NEAR_IDENTICAL) else ' ',
        'A' if album_of(query_path) == album_of(path) else ' ',
        'a' if artist_of(query_path) == artist_of(path) else ' ',
    ))


def side_by_side(arms, row, k=DEFAULT_K, width=46, stream=None):
    """One query, both arms, as two columns — §8.7's hand-check sheet.

    ⚠️ **THIS FUNCTION FORMATS THE GATE; IT DOES NOT SCORE IT.** §8.7 says the
    judgement is a person reading these lists for tracks they know cold, and
    that it must not be automated. Nothing here prints a verdict, and that is
    deliberate rather than unfinished.
    """
    out = stream or sys.stdout
    query = arms[0].paths[row]
    print(f'\nQUERY  {artist_of(query)} · '
          f'{os.path.basename(album_of(query))} · {title_of(query)}', file=out)
    print(f'       {query}', file=out)
    results = [arm.search(row, k) for arm in arms]
    header = '  #  ' + '   '.join(f'{arm.label:<{width}}   cos' for arm in arms)
    print(header, file=out)
    print('  ' + '─' * (len(header) - 2), file=out)
    # `k` is what was asked for; `rows` is what exists. A small arm asked for the
    # top 20 used to print eleven blank numbered lines, which reads as eleven
    # neighbours the search could not name rather than as a corpus of nine.
    for rank in range(max((len(r) for r in results), default=0)):
        cells = []
        for res in results:
            if rank < len(res):
                _j, _tid, path, cos = res[rank]
                cells.append(f'{_marks(query, path, cos)}{short(path, width - 4)} {cos:+.3f}')
            else:
                cells.append(' ' * (width + 7))
        print(f'  {rank + 1:>2} ' + '   '.join(cells), file=out)
    return results


def hand_sheet(conn, queries=None, k=DEFAULT_K, per_artist=1, stream=None):
    """The §8.7 hand check: a spread of tracks, both arms, side by side.

    With no `queries`, one track is taken from each artist present in the aligned
    population, deterministically and from the middle of the artist's run rather
    than the first file — track 1 of album 1 is an intro on a distressing number
    of records, and an intro is the least characteristic thing an artist records.
    """
    out = stream or sys.stdout
    arms = align(*(load_arm(conn, t) for t in ARMS))
    rows = _resolve(arms[0], queries, per_artist)
    print(f'{len(arms[0])} tracks in both arms · '
          f'{arms[0].dim}-d neural vs {arms[1].dim}-d descriptor · top {k}', file=out)
    print('marks:  =  same recording (a duplicate copy)   '
          'A  same album   a  same artist', file=out)
    for row in rows:
        side_by_side(arms, row, k=k, stream=out)
    print('\n⚠️ §8.7: this sheet is the gate and it is READ, not scored. '
          'The proxies are `--gate`.', file=out)
    return rows


def _resolve(arm, queries, per_artist=1):
    """Path fragments (or None) → row indices in `arm`. Deterministic."""
    if queries:
        rows = []
        for fragment in queries:
            needle = fragment.lower()
            hits = [i for i, p in enumerate(arm.paths) if needle in p.lower()]
            if not hits:
                raise QueryError(f'nothing in both arms matches {fragment!r}')
            rows.append(hits[len(hits) // 2] if len(hits) > 1 else hits[0])
        return rows
    by_artist = {}
    for i, path in enumerate(arm.paths):
        by_artist.setdefault(artist_of(path), []).append(i)
    rows = []
    for artist in sorted(by_artist):
        runs = by_artist[artist]
        for slot in range(max(1, per_artist)):
            pos = int(len(runs) * (slot + 1) / (max(1, per_artist) + 1))
            rows.append(runs[min(pos, len(runs) - 1)])
    return rows


def gate(conn, stream=None):
    """The §8.7 objective proxies for both arms over one population. True if the
    neural arm wins.

    ⚠️ **A PASS HERE IS NOT THE GATE.** The gate is the hand check. This is the
    corroborating half, and it is printed second for that reason.
    """
    out = stream or sys.stdout
    arms = align(*(load_arm(conn, t) for t in ARMS))
    reports = [report(arm) for arm in arms]
    neural, classical = reports

    print(f'{neural["n_tracks"]} tracks in BOTH arms · {neural["n_albums"]} albums · '
          f'{neural["n_artists"]} artists · {neural["n_songs"]} distinct recordings',
          file=out)
    print(f'chance: album {neural["chance_album"]:.1%} · '
          f'artist {neural["chance_artist"]:.1%} · '
          f'duplicate {neural["chance_song"]:.2%}', file=out)
    print('', file=out)

    label_w = max(len(r['label']) for r in reports)
    print(f'  {"":<{label_w}}   {"NN album":>9} {"credited":>9} {"clean":>9} '
          f'{"NN artist":>10} {"NN is dup":>10}', file=out)
    for r in reports:
        print(f'  {r["label"]:<{label_w}}   {r["nn_album_raw"]:8.1%} '
              f'{r["nn_album_credited"]:8.1%} {r["nn_album_clean"]:8.1%} '
              f'{r["nn_artist"]:9.1%} {r["nn_dup"]:9.1%}', file=out)
    print('', file=out)
    print('  raw = shares an album · credited = or is the same recording · '
          'clean = raw over the', file=out)
    print('  tracks whose neighbour is NOT a duplicate. §8.7: never one number.',
          file=out)
    print('', file=out)

    print('  mean cosine', file=out)
    print(f'  {"":<{label_w}}   {"same album":>12} {"same artist":>12} {"stranger":>12} '
          f'{"raw gap":>9} {"gap/σ":>7}', file=out)
    for r in reports:
        sep = r['same_album'][0] - r['different'][0]
        print(f'  {r["label"]:<{label_w}}   {r["same_album"][0]:+11.4f} '
              f'{r["same_artist"][0]:+11.4f} {r["different"][0]:+11.4f} '
              f'{sep:+8.4f} {r["d_album"]:7.2f}', file=out)
    print('', file=out)
    print('  ⚠️ raw gap is NOT comparable across the two arms — the descriptor space is', file=out)
    print('  z-scored and centred, CLAP\'s is an off-centre cone, so the wider space wins', file=out)
    print('  by construction. gap/σ divides out both offset and scale. It is the compared one.',
          file=out)
    print('', file=out)

    audit = duplicate_audit(arms[0])
    print(f'  duplicate audit (neural arm, cos ≥ {audit["threshold"]}): '
          f'{audit["by_cosine"]} pairs by cosine, {audit["by_name"]} by filename, '
          f'{audit["agreement"]:.1%} agree', file=out)
    print('', file=out)

    # ⚠️ Compared on the CLEAN rate, and on the credited rate, and on artist —
    # not on the raw rate. The raw rate is the one §8.6 showed is distorted by
    # the duplicate population, and it is distorted for both arms but not
    # necessarily by the same amount.
    # ⚠️ An unmeasurable criterion is dropped, not lost. `nan > x` is False, so
    # leaving a nan in here would report the neural arm beaten by a category
    # that has no pairs in it — §8.4 hit exactly that and read FAILED on a
    # baseline that was working.
    criteria = (
        ('album (clean)', neural['nn_album_clean'], classical['nn_album_clean']),
        ('album (credited)', neural['nn_album_credited'], classical['nn_album_credited']),
        ('artist', neural['nn_artist'], classical['nn_artist']),
        ('separation (gap/σ)', neural['d_album'], classical['d_album']),
    )
    wins = {name: a > b for name, a, b in criteria
            if not (np.isnan(a) or np.isnan(b))}
    passed = bool(wins) and all(wins.values())
    print('  ' + ' · '.join(f'{k}: {"neural" if v else "DESCRIPTOR"}'
                            for k, v in wins.items()), file=out)
    print(f'PROXIES {"PASSED" if passed else "FAILED"} — the neural arm '
          f'{"beats" if passed else "DOES NOT beat"} the descriptor baseline '
          f'on the aligned population.', file=out)
    if not passed:
        print('  ⚠️ §8.7 STOP CONDITION. If the descriptors win, something upstream is '
              'broken —\n     extraction, a windowing config mismatch, pooling, or '
              'normalisation. Fix it.\n     Nothing past this step on faith: everything '
              'downstream is decoration on a\n     broken foundation.', file=out)
    print('\n  ⚠️ These are the proxies, not the gate. The gate is `--hand`, read by a '
          'person.', file=out)
    return passed


# ── CLI ─────────────────────────────────────────────────────────────────────────
def _main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('queries', nargs='*',
                        help='path fragments to look up (case-insensitive)')
    parser.add_argument('--hand', action='store_true',
                        help='the §8.7 hand-check sheet: both arms, side by side')
    parser.add_argument('--gate', action='store_true',
                        help='the objective proxies for both arms, one population')
    parser.add_argument('--arm', choices=('neural', 'descriptor', 'both'), default='both')
    parser.add_argument('-k', type=int, default=DEFAULT_K, help='neighbours to show')
    parser.add_argument('--per-artist', type=int, default=1,
                        help='with --hand and no queries: tracks taken per artist')
    parser.add_argument('--aligned', action='store_true',
                        help='restrict a single-arm search to the shared population')
    parser.add_argument('--status', action='store_true', help='what each arm holds')
    parser.add_argument('--fit', action='store_true',
                        help='fit and store the corpus geometry each arm must be read '
                             'through (run after a backfill)')
    args = parser.parse_args(argv)

    if args.k < 1:
        parser.error(f'-k must be at least 1, got {args.k}')

    conn = index.connect()
    try:
        if args.fit:
            print(f'{index.DB_PATH}')
            fit_calibration(conn)
            if not (args.hand or args.gate or args.queries or args.status):
                return 0

        if args.status or not (args.hand or args.gate or args.queries or args.fit):
            stats = index.stats(conn)
            print(f'{index.DB_PATH}')
            for table in ARMS:
                n = conn.execute(f'SELECT COUNT(*) AS n FROM {table}').fetchone()['n']
                calibration = Calibration.load(conn, table)
                if calibration is None:
                    note = 'UNCALIBRATED — run --fit'
                elif Calibration.stale(conn, table):
                    note = 'calibration STALE (config changed since the fit) — run --fit'
                else:
                    note = (f'strangers {calibration.stranger_mean:+.4f} '
                            f'± {calibration.stranger_spread:.4f}')
                print(f'  {ARM_LABELS[table]:<22} {n:>6} vectors   '
                      f'sig {stats.get(f"sig:{table}")}   {note}')
            shared = conn.execute(
                'SELECT COUNT(*) AS n FROM local_vectors v '
                'JOIN descriptors d ON d.track_id = v.track_id').fetchone()['n']
            print(f'  {"in BOTH arms":<22} {shared:>6} tracks   ← what §8.7 may compare')
            print(f'  recipe  {stats.get("recipe:local_vectors")}')
            if not (args.hand or args.gate or args.queries):
                return 0

        if args.gate:
            ok = gate(conn)
            if not (args.hand or args.queries):
                return 0 if ok else 1

        if args.hand:
            hand_sheet(conn, args.queries or None, k=args.k, per_artist=args.per_artist)
            return 0

        if args.queries:
            if args.arm == 'both':
                arms = align(*(load_arm(conn, t) for t in ARMS))
                for row in _resolve(arms[0], args.queries):
                    side_by_side(arms, row, k=args.k)
            else:
                table = 'local_vectors' if args.arm == 'neural' else 'descriptors'
                arm = load_arm(conn, table)
                if args.aligned:
                    other = 'descriptors' if table == 'local_vectors' else 'local_vectors'
                    arm = align(arm, load_arm(conn, other))[0]
                for row in _resolve(arm, args.queries):
                    print(f'\nQUERY  {arm.paths[row]}')
                    for rank, (_j, _tid, path, cos) in enumerate(arm.search(row, args.k), 1):
                        print(f'  {rank:>2} {_marks(arm.paths[row], path, cos)}'
                              f'{short(path, 64)} {cos:+.4f}')
    except (QueryError, descriptors.DescriptorError, index.ConfigDriftError) as exc:
        # A typo in a search fragment, an arm nobody has filled yet, a corpus too
        # small to z-score, a config edit after a backfill: four ordinary states,
        # each of which used to arrive as a traceback. Every one of these
        # exceptions already says what to do; printing it is the whole job.
        print(f'\n{type(exc).__name__}: {exc}', file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
