/**
 * ai.ts — is a widget AI-backed?
 *
 * DERIVED from the apps it binds (@jkos/widgets appsOf: its dataset sources and every
 * command in its tree), against the suite directory's `ai` flag. It used to be a
 * hand-set `ai` on the def, which nothing checked against what the widget bound — a
 * widget binding LazurOS could simply omit it and ignore the suite's AI kill switch.
 * The validator now refuses a hand-set `ai`.
 */

import { suiteApp, type AppId } from '@jkos/weave';
import { appsOf } from '@jkos/widgets';
import type { WidgetDef } from './types';

export function usesAi(def: WidgetDef): boolean {
  for (const id of appsOf(def)) if (suiteApp(id as AppId)?.ai) return true;
  return false;
}
