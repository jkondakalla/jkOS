/**
 * preview/clock.ts — the sheet's Date, pinned to the sample's instant. Imported FIRST by
 * main.tsx, so it runs before any module that reads the time (@jkos/widget-render's
 * preview/clock says why).
 */
import { pinDate } from '@jkos/widget-render/preview-clock';
import { PINNED_MS } from '../src/hud/pinned';

pinDate(PINNED_MS);
