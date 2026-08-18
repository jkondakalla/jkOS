#!/usr/bin/env python3
"""Tests for ridge.py — M2, the ridgeline render.

A picture is checked by eye, which is exactly why the parts of it that CAN be
checked mechanically should be. Three groups here, and each closes a failure that
would otherwise only show up as "the picture looks a bit off":

  · **the palette gates** — the `dataviz` skill's ordinal checks (one hue, monotone
    lightness, the end nearest the surface still readable) re-run on every suite
    run, so an edit to the ramp months from now cannot quietly make the air bands
    invisible. Same habit as `config.signature()` guarding Trap 16.
  · **the shared-scale gates** — that a panel's geometry does not depend on what
    else is in the sheet. Per-panel normalisation is the one bug that would make
    every ridgeline look plausible and the comparison between them meaningless.
  · **the emission gates** — well-formed XML from hostile filenames, finite
    coordinates, back-to-front draw order, determinism.
"""
import colorsys
import os
import unittest
from xml.etree import ElementTree

import numpy as np

import config
import mel
import ridge

from . import helpers

SVG = 'http://www.w3.org/2000/svg'


def parse(svg_text):
    return ElementTree.fromstring(svg_text)


def band_polygons(root):
    """Every band polygon, in document order, across every panel."""
    return [el for g in root.iter(f'{{{SVG}}}g')
            if g.get('class') == 'bands'
            for el in g.findall(f'{{{SVG}}}polygon')]


def points_of(polygon):
    return [tuple(float(v) for v in pair.split(','))
            for pair in polygon.get('points').split()]


def flat_panel(value=0.0, bands=None, frames=40):
    bands = config.N_MELS if bands is None else bands
    return ridge.Panel(np.full((bands, frames), value, dtype=np.float32), 'flat')


class TestPalette(unittest.TestCase):
    """The `dataviz` gates, as code rather than as a memory of having run them."""

    def test_ramp_has_one_colour_per_band(self):
        for name, face in (('paper', ridge.PAPER), ('dark', ridge.DARK)):
            ramp = ridge.band_ramp(face)
            self.assertEqual(len(ramp), config.N_MELS, name)
            for colour in ramp:
                self.assertRegex(colour, r'^#[0-9a-f]{6}$', f'{name}: {colour}')

    def test_ramp_lightness_is_monotone(self):
        # A ramp that doubles back encodes two different frequencies in the same
        # shade — the reader cannot tell 40 Hz from 4 kHz. The DIRECTION differs
        # by face on purpose: bass is the heavy end, so on paper it is the
        # deepest ink and on the tube it is the brightest phosphor. Both are
        # monotone; only one of them is ascending.
        for name, face in (('paper', ridge.PAPER), ('dark', ridge.DARK)):
            lum = [ridge.relative_luminance(c) for c in ridge.band_ramp(face)]
            ordered = sorted(lum) if lum[0] < lum[-1] else sorted(lum, reverse=True)
            self.assertEqual(lum, ordered, f'{name} ramp is not monotone')
            self.assertGreater(abs(lum[-1] - lum[0]), 0.05, f'{name} ramp is nearly flat')

    def test_the_two_faces_run_in_opposite_directions(self):
        # Not cosmetic: an unflipped dark ramp would put the near-black bass rows
        # on a near-black surface, i.e. the loudest part of every track invisible.
        paper = [ridge.relative_luminance(c) for c in ridge.band_ramp(ridge.PAPER)]
        dark = [ridge.relative_luminance(c) for c in ridge.band_ramp(ridge.DARK)]
        self.assertLess(paper[0], paper[-1])
        self.assertGreater(dark[0], dark[-1])

    def test_ramp_end_nearest_the_surface_still_reads(self):
        # The skill's ordinal floor: 2:1 against the chart surface. Below it the
        # air bands dissolve into the paper and the top third of every panel is
        # blank for no reason a reader can see.
        for name, face in (('paper', ridge.PAPER), ('dark', ridge.DARK)):
            ramp = ridge.band_ramp(face)
            nearest = min(ramp, key=lambda c: ridge.contrast_ratio(c, face['surface']))
            ratio = ridge.contrast_ratio(nearest, face['surface'])
            self.assertGreaterEqual(ratio, 2.0, f'{name}: {nearest} at {ratio:.2f}:1')

    def test_ramp_is_one_hue(self):
        # Sequential means ONE hue, light→dark. A rainbow ramp is the named
        # anti-pattern: it invents ordering that the eye cannot rank.
        for name, face in (('paper', ridge.PAPER), ('dark', ridge.DARK)):
            hues = []
            for colour in ridge.band_ramp(face):
                r, g, b = (v / 255.0 for v in ridge._hex_to_rgb(colour))
                h, _, sat = colorsys.rgb_to_hls(r, g, b)
                if sat > 0.02:
                    hues.append(h * 360.0)
            self.assertLess(max(hues) - min(hues), 30.0, f'{name} ramp spans hues')

    def test_contrast_helper_matches_known_values(self):
        self.assertAlmostEqual(ridge.contrast_ratio('#ffffff', '#000000'), 21.0, places=2)
        self.assertAlmostEqual(ridge.contrast_ratio('#777777', '#777777'), 1.0, places=6)

    def test_both_faces_declare_the_same_tokens(self):
        # A token defined on one face and forgotten on the other is a line that
        # renders as `initial` — black on black, or invisible on paper.
        light = ridge._face_tokens(ridge.PAPER, config.N_MELS)
        dark = ridge._face_tokens(ridge.DARK, config.N_MELS)
        self.assertEqual(set(light), set(dark))
        self.assertIn('--b0', light)
        self.assertIn(f'--b{config.N_MELS - 1}', light)


class TestReduceColumns(unittest.TestCase):

    def test_max_keeps_a_transient_that_mean_would_erase(self):
        # The reducer choice IS the beat grid. One loud frame in a bucket of 50
        # quiet ones is a kick drum; averaging deletes it.
        M = np.zeros((1, 500), dtype=np.float32)
        M[0, 123] = 9.0
        by_max = ridge.reduce_columns(M, 10)
        by_mean = ridge.reduce_columns(M, 10, reducer='mean')
        self.assertEqual(float(by_max.max()), 9.0)
        self.assertLess(float(by_mean.max()), 1.0)

    def test_short_input_is_not_upsampled(self):
        # Interpolating up would draw detail the audio does not contain.
        M = np.zeros((4, 17), dtype=np.float32)
        self.assertEqual(ridge.reduce_columns(M, 900).shape, (4, 17))

    def test_a_burst_lands_in_the_right_column(self):
        M = np.zeros((1, 1000), dtype=np.float32)
        M[0, 750] = 5.0
        reduced = ridge.reduce_columns(M, 100)
        self.assertEqual(int(np.argmax(reduced[0])), 75)

    def test_every_frame_falls_in_exactly_one_bucket(self):
        # Column maxima of a strictly increasing signal must themselves be
        # strictly increasing: a repeat means a bucket was empty, and a gap at the
        # end means the tail was dropped and the time ruler lies.
        T = 1003
        M = np.arange(T, dtype=np.float32)[None, :]
        reduced = ridge.reduce_columns(M, 100)[0]
        self.assertEqual(reduced.shape, (100,))
        self.assertTrue(np.all(np.diff(reduced) > 0))
        self.assertEqual(float(reduced[-1]), float(T - 1))

    def test_rejects_bad_shapes(self):
        with self.assertRaises(ValueError):
            ridge.reduce_columns(np.zeros(10), 5)
        with self.assertRaises(ValueError):
            ridge.reduce_columns(np.zeros((2, 10)), 0)


class TestExcerpt(unittest.TestCase):

    def test_zero_seconds_is_the_whole_track(self):
        x = np.zeros(config.SR * 10, dtype=np.float32)
        clip, t0 = ridge.excerpt(x, seconds=0)
        self.assertEqual(len(clip), len(x))
        self.assertEqual(t0, 0.0)

    def test_window_is_centred_by_default(self):
        x = np.zeros(config.SR * 100, dtype=np.float32)
        clip, t0 = ridge.excerpt(x, seconds=20)
        self.assertAlmostEqual(t0, 40.0, places=3)
        self.assertEqual(len(clip), config.SR * 20)

    def test_start_is_clamped_inside_the_track(self):
        x = np.zeros(config.SR * 30, dtype=np.float32)
        _, t0 = ridge.excerpt(x, start=900.0, seconds=10)
        self.assertAlmostEqual(t0, 20.0, places=3)

    def test_window_longer_than_the_track_is_the_track(self):
        x = np.zeros(config.SR * 5, dtype=np.float32)
        clip, t0 = ridge.excerpt(x, seconds=60)
        self.assertEqual(len(clip), len(x))
        self.assertEqual(t0, 0.0)


class TestSharedScale(unittest.TestCase):
    """The bug this module exists to prevent."""

    def test_a_panel_carries_no_scale_of_its_own(self):
        # Structural, not cosmetic: if a Panel could hold a range, two panels
        # could hold different ones, and the comparison between them would be
        # meaningless while still looking entirely reasonable.
        panel = flat_panel()
        self.assertFalse(hasattr(panel, 'vmin'))
        self.assertFalse(hasattr(panel, 'vmax'))

    def test_geometry_does_not_depend_on_the_other_panels(self):
        loud = ridge.Panel(np.full((config.N_MELS, 40), 9.0, np.float32), 'loud')
        quiet = ridge.Panel(np.full((config.N_MELS, 40), -6.0, np.float32), 'quiet')
        alone = band_polygons(parse(ridge.render([quiet], plot_w=60, plot_h=ridge.PLOT_H)))
        beside = band_polygons(parse(ridge.render([quiet, loud], plot_w=60, plot_h=ridge.PLOT_H)))
        self.assertEqual([p.get('points') for p in alone],
                         [p.get('points') for p in beside[:len(alone)]])

    def test_louder_material_draws_higher(self):
        loud = ridge.Panel(np.full((config.N_MELS, 40), 9.0, np.float32), 'loud')
        quiet = ridge.Panel(np.full((config.N_MELS, 40), -6.0, np.float32), 'quiet')
        polys = band_polygons(parse(ridge.render([quiet, loud], plot_w=60, plot_h=ridge.PLOT_H)))
        # Last band drawn in each panel is band 0, at the bottom of its own plot.
        y_quiet = points_of(polys[config.N_MELS - 1])[0][1]
        y_loud = points_of(polys[-1])[0][1]
        self.assertLess(y_loud, y_quiet, 'the louder panel did not rise higher')

    def test_auto_range_is_computed_over_every_panel_at_once(self):
        a = ridge.Panel(np.linspace(-10, 0, 400, dtype=np.float32).reshape(4, 100), 'a')
        b = ridge.Panel(np.linspace(0, 10, 400, dtype=np.float32).reshape(4, 100), 'b')
        both = np.concatenate([a.matrix.ravel(), b.matrix.ravel()])
        expected = tuple(float(v) for v in np.percentile(both, [2.0, 99.5]))
        self.assertEqual(ridge.auto_value_range([a, b]), expected)

    def test_default_range_follows_the_log_mode(self):
        # config.py may switch to decibels at §8.5 to match an encoder. A range
        # left in nepers would put every value above the top of the frame and the
        # picture would be a flat block — no error, just a wrong picture.
        ln_range = ridge.default_value_range()
        original = config.LOG_MODE
        try:
            config.LOG_MODE = 'db'
            db_range = ridge.default_value_range()
        finally:
            config.LOG_MODE = original
        for a, b in zip(ln_range, db_range):
            self.assertAlmostEqual(b / a, 10.0 / np.log(10.0), places=6)

    def test_values_outside_the_range_clamp_rather_than_escape(self):
        wild = ridge.Panel(np.full((config.N_MELS, 20), 1e6, np.float32), 'wild')
        svg = ridge.render([wild], plot_w=40, plot_h=ridge.PLOT_H, value_range=(-8.0, 10.0))
        for polygon in band_polygons(parse(svg)):
            for _, y in points_of(polygon):
                self.assertTrue(np.isfinite(y))


class TestSvgEmission(unittest.TestCase):

    def test_output_is_well_formed_xml(self):
        root = parse(ridge.render([flat_panel()], plot_w=40, plot_h=ridge.PLOT_H))
        self.assertEqual(root.tag, f'{{{SVG}}}svg')
        self.assertEqual(root.get('role'), 'img')

    def test_one_polygon_per_band_per_panel(self):
        svg = ridge.render([flat_panel(), flat_panel()], plot_w=40, plot_h=ridge.PLOT_H)
        self.assertEqual(len(band_polygons(parse(svg))), 2 * config.N_MELS)

    def test_bands_are_drawn_back_to_front(self):
        # The near (bass) rows must paint over the far ones or the fill occlusion
        # that makes a ridgeline readable happens in the wrong direction.
        polys = band_polygons(parse(ridge.render([flat_panel()], plot_w=40, plot_h=ridge.PLOT_H)))
        self.assertEqual(polys[0].get('stroke'), f'var(--b{config.N_MELS - 1})')
        self.assertEqual(polys[-1].get('stroke'), 'var(--b0)')

    def test_curve_points_stay_inside_the_plot_box(self):
        rng = np.random.default_rng(7)
        noisy = ridge.Panel(rng.uniform(-20, 15, (config.N_MELS, 200)).astype(np.float32), 'n')
        svg = ridge.render([noisy], plot_w=200, plot_h=ridge.PLOT_H)
        root = parse(svg)
        height = float(root.get('height'))
        for polygon in band_polygons(root):
            # The final two vertices close the shape outside the clip on purpose.
            for x, y in points_of(polygon)[:-2]:
                self.assertTrue(0.0 <= x <= float(root.get('width')), x)
                self.assertTrue(0.0 <= y <= height, y)

    def test_a_hostile_filename_survives_as_xml(self):
        # Trap 20's rendering cousin. `again&again` written raw into a <text>
        # element is not an escaping nicety — it is malformed XML, and the whole
        # picture fails to open.
        panel = ridge.Panel(np.zeros((config.N_MELS, 10), np.float32),
                            helpers.HOSTILE_NAME, '<not a tag> & more')
        root = parse(ridge.render([panel], plot_w=600, plot_h=ridge.PLOT_H))
        texts = [el.text for el in root.iter(f'{{{SVG}}}text')]
        self.assertIn(helpers.HOSTILE_NAME, texts)
        self.assertIn('<not a tag> & more', texts)

    def test_both_faces_ship_in_the_one_file(self):
        svg = ridge.render([flat_panel()], plot_w=40, plot_h=ridge.PLOT_H)
        self.assertIn('prefers-color-scheme: dark', svg)
        self.assertIn(ridge.PAPER['surface'], svg)
        self.assertIn(ridge.DARK['surface'], svg)

    def test_render_is_deterministic(self):
        panel = flat_panel(2.0)
        first = ridge.render([panel], plot_w=80, plot_h=ridge.PLOT_H)
        second = ridge.render([panel], plot_w=80, plot_h=ridge.PLOT_H)
        self.assertEqual(first, second)

    def test_the_default_geometry_clears_its_own_readability_floor(self):
        # ⚠️ The one number that decides whether the picture is a ridgeline or a
        # hatch. 128 rows is far more than the form usually carries, and under
        # ~9 px of pitch every row's excursion crosses two neighbours and the
        # panel turns to texture — which reads as "the transform is broken" when
        # it is only "the picture is too small". Measured, then pinned.
        pitch = ridge.PLOT_H / (config.N_MELS - 1 + ridge.OVERSHOOT)
        self.assertGreaterEqual(pitch, ridge.ROW_PITCH_MIN)

    def test_render_needs_at_least_one_panel(self):
        with self.assertRaises(ValueError):
            ridge.render([])

    def test_write_creates_its_directory(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, 'nested', 'deep', 'ridge.svg')
            ridge.write([flat_panel()], target, plot_w=40, plot_h=ridge.PLOT_H)
            self.assertGreater(os.path.getsize(target), 1000)


class TestLabels(unittest.TestCase):

    def test_track_number_and_repeated_artist_are_dropped(self):
        path = ('/mnt/Luna/Plex/Music/Matt Maltese/'
                'Matt Maltese - As the World Caves In (2017) [16B-44.1kHz]/'
                '01. As the World Caves In.flac')
        title, subtitle = ridge.labels_from_path(path)
        self.assertEqual(title, 'As the World Caves In')
        self.assertEqual(subtitle,
                         'Matt Maltese — As the World Caves In (2017) [16B-44.1kHz]')

    def test_a_path_outside_the_library_layout_degrades_to_the_filename(self):
        title, _ = ridge.labels_from_path('/tmp/whatever.flac')
        self.assertEqual(title, 'whatever')

    def test_hostile_characters_pass_through_untouched(self):
        title, _ = ridge.labels_from_path(f'/x/y/{helpers.HOSTILE_NAME}.flac')
        self.assertEqual(title, helpers.HOSTILE_NAME)

    def test_fit_text_truncates_to_the_panel(self):
        self.assertEqual(ridge.fit_text('short', 400, 6.7), 'short')
        long = 'x' * 200
        fitted = ridge.fit_text(long, 400, 6.7)
        self.assertLess(len(fitted), len(long))
        self.assertTrue(fitted.endswith('…'))

    def test_mmss(self):
        self.assertEqual(ridge.mmss(0), '0:00')
        self.assertEqual(ridge.mmss(65), '1:05')
        self.assertEqual(ridge.mmss(3599), '59:59')

    def test_time_ticks_stay_inside_the_window(self):
        ticks = ridge._time_ticks(t0=130.0, seconds=16.0)
        self.assertTrue(ticks)
        for offset, _ in ticks:
            self.assertTrue(0.0 <= offset <= 16.0 + 1e-9)


class TestSummary(unittest.TestCase):

    def test_summary_reports_clipping_against_the_shared_range(self):
        M = np.concatenate([np.full((config.N_MELS, 50), -30.0, np.float32),
                            np.full((config.N_MELS, 50), 30.0, np.float32)], axis=1)
        row = ridge.summarise(ridge.Panel(M, 't'), (-8.0, 10.0))
        self.assertAlmostEqual(row['clip_lo'], 0.5, places=6)
        self.assertAlmostEqual(row['clip_hi'], 0.5, places=6)

    def test_summary_finds_the_loudest_register(self):
        M = np.full((config.N_MELS, 20), -5.0, np.float32)
        M[100, :] = 8.0
        row = ridge.summarise(ridge.Panel(M, 't'))
        self.assertEqual(row['loudest_band'], 100)
        self.assertGreater(row['loudest_hz'], 1000.0)


@unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg is not on PATH')
class TestEndToEnd(unittest.TestCase):
    """The whole path on real audio: decode → mel → SVG."""

    def test_a_generated_tone_renders(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.make_sine_flac(tmp, seconds=3.0, freq=440.0)
            panel = ridge.panel_from_file(path)
            self.assertEqual(panel.matrix.shape[0], config.N_MELS)
            self.assertAlmostEqual(panel.seconds, 3.0, places=1)
            root = parse(ridge.render([panel], plot_w=120, plot_h=ridge.PLOT_H))
            self.assertEqual(len(band_polygons(root)), config.N_MELS)

    def test_the_loud_row_is_the_row_holding_the_tone(self):
        # Ties the picture back to the audio: a 440 Hz sine must draw its peak in
        # a band whose own edges contain 440 Hz, or the frequency axis is a lie.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.make_sine_flac(tmp, seconds=2.0, freq=440.0)
            panel = ridge.panel_from_file(path)
            loudest = int(panel.matrix.mean(axis=1).argmax())
            edges = mel.mel_edges()
            self.assertLessEqual(edges[loudest], 440.0)
            self.assertGreaterEqual(edges[loudest + 2], 440.0)


@unittest.skipUnless(os.path.isdir(config.LIBRARY_ROOT), 'library mount is absent')
class TestLibrary(unittest.TestCase):

    def test_a_real_track_renders_to_a_readable_sheet(self):
        path = helpers.first_library_track()
        if path is None:
            self.skipTest('no audio found under the library root')
        panel = ridge.panel_from_file(path, seconds=8.0)
        svg = ridge.render([panel], plot_w=200, plot_h=ridge.PLOT_H)
        root = parse(svg)
        self.assertEqual(len(band_polygons(root)), config.N_MELS)


if __name__ == '__main__':
    unittest.main()
