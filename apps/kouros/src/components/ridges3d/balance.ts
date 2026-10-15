// balance.ts — the library's own level and range in every band, MEASURED (ALGORITHMS.md §9).
// Pure data: test/pulsarmap.mjs imports it with stage.ts.
//
// Jag, 2026-10-15: "the highs are barely used and there's a huge plateau on the bass even
// with small bass hits. I'd like a more unified look throughout." Measured over two
// disjoint random samples of 400 stored meshes (~1.06 M rows each; they agree to 3 bytes
// in level and 7 % in range): every band MOVES about as much as every other — the 10th-
// to-90th-percentile swing within a track is 78–94 bytes at every frequency — but they
// REST at very different heights. The bass sits at byte ~200–214 and the top at ~104: a
// ~100-byte (~30 dB) tilt that is the plateau and the idle highs. These are the means of
// the two samples, per band:
//
//   BAND_LEVEL   the median byte, over every row of every sampled track
//   BAND_SPREAD  p90 − p10 of each byte's distance from its own track's median in that band
//
// ⚠️ **LIBRARY-WIDE, NEVER PER TRACK** — the same reason as the value range and X_WARP:
// a per-track level would make a quiet track's bass look as big as a loud one's, and two
// tracks would stop being comparable band for band. These numbers are the same for every
// picture; re-measure them only when the store's value range or mel recipe changes.

export const BAND_LEVEL: readonly number[] = [
  136.0, 174.0, 196.0, 211.5, 210.5, 213.0, 210.0, 206.5, 204.5, 203.5, 201.5, 200.5, 198.5, 195.5, 194.5, 192.0,
  191.5, 190.0, 186.5, 186.5, 185.0, 184.5, 182.5, 182.0, 182.0, 179.5, 179.0, 179.0, 175.0, 178.0, 178.0, 174.5,
  174.5, 176.0, 174.0, 169.5, 173.5, 172.5, 167.0, 170.5, 170.5, 168.0, 167.5, 167.0, 169.0, 167.5, 165.0, 168.5,
  167.5, 164.5, 164.5, 166.5, 165.5, 167.0, 165.0, 164.5, 165.5, 166.0, 163.0, 161.5, 164.5, 164.0, 163.5, 162.5,
  163.5, 162.5, 164.0, 163.0, 162.5, 161.0, 162.5, 163.5, 160.5, 159.5, 158.5, 159.0, 157.0, 158.5, 156.5, 157.5,
  155.5, 158.0, 156.5, 156.0, 154.5, 154.5, 154.5, 151.5, 151.0, 149.5, 149.5, 147.5, 148.0, 147.5, 146.0, 145.5,
  144.5, 145.5, 144.0, 144.0, 143.0, 142.5, 143.0, 141.5, 142.0, 141.0, 141.0, 140.0, 139.0, 139.0, 138.0, 137.5,
  137.0, 136.0, 136.0, 135.0, 134.0, 133.0, 133.0, 132.5, 131.0, 130.0, 129.0, 126.0, 123.0, 117.5, 111.0, 104.0,
];

export const BAND_SPREAD: readonly number[] = [
  88.5, 106.5, 106.8, 99.0, 94.0, 93.0, 88.8, 84.5, 82.5, 80.5, 78.5, 76.5, 75.5, 76.0, 74.8, 76.0,
  74.5, 77.5, 76.0, 78.0, 77.5, 79.0, 80.0, 79.5, 80.0, 81.5, 78.0, 80.8, 79.5, 82.5, 81.8, 81.0,
  80.0, 79.5, 80.0, 81.0, 80.5, 78.5, 80.0, 80.0, 78.0, 81.0, 79.0, 77.5, 80.0, 77.2, 79.8, 80.0,
  79.5, 80.0, 77.5, 79.5, 76.5, 79.5, 77.5, 78.5, 78.0, 78.5, 79.0, 77.0, 78.5, 77.0, 78.0, 77.5,
  78.5, 77.5, 78.5, 78.0, 78.5, 77.5, 78.5, 78.5, 78.0, 78.5, 78.5, 78.5, 77.0, 79.5, 78.0, 78.5,
  77.5, 80.0, 79.5, 79.5, 79.0, 79.5, 79.5, 79.0, 79.0, 79.5, 79.0, 79.0, 79.5, 79.5, 80.5, 80.5,
  81.0, 81.5, 81.8, 82.0, 83.0, 82.0, 82.5, 83.0, 82.5, 83.0, 84.5, 84.5, 84.5, 85.5, 85.5, 85.5,
  86.5, 86.5, 86.0, 86.8, 87.0, 86.5, 86.5, 86.5, 86.5, 87.5, 87.0, 87.5, 86.5, 85.5, 85.5, 85.0,
];
