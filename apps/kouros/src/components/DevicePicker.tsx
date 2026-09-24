// components/DevicePicker.tsx — where the music comes out: every device this listener
// is signed in on, which one is playing, and a tap to move it (the listening session,
// Jag 2026-09-23 — Spotify Connect's picker).
//
// ONE sheet for the whole app, opened from wherever a speaker button is (the mini
// player, Now Playing, the "Playing on …" strip) through a module-level seam — the
// same shape as player/controller.ts — so no surface has to own it, and two buttons
// can never open two pickers.
//
// Rows: the devices that are ONLINE, this one first, the output marked; each with its
// own volume (Jag: volume is per device, and the picker sets any of them) and an
// inline rename. Then the devices that are not, dimmed, each with "Forget" — for a
// phone that was sold, or a browser profile that is gone (an online device is never
// offered for forgetting: it would simply register again).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Field, Slider } from '@jkos/ui';
import { usePlayerSession } from '../player/PlayerProvider';
import {
  forgetSessionDevice, renameSessionDevice, sendSessionCommand, type SessionDevice,
} from '../session/client';
import { IconDeviceKind } from './icons';

/* ── The seam ──────────────────────────────────────────────────────────────────── */

let isOpen = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { isOpen = v; for (const f of subs) f(); };

/** Open the picker (any speaker button). */
export function openDevicePicker(): void { set(true); }
export function closeDevicePicker(): void { set(false); }

function useIsOpen(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => isOpen, () => false);
}

/** "seen 3 d ago" — how stale an offline row is, coarsely; a device list does not
 *  need seconds. */
function seenAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return 'offline';
  if (s < 90) return 'seen just now';
  if (s < 3600) return `seen ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `seen ${Math.round(s / 3600)} h ago`;
  return `seen ${Math.round(s / 86400)} d ago`;
}

/* ── One row ───────────────────────────────────────────────────────────────────── */

function DeviceRow({ device, me, output, playing, onPick }: {
  device: SessionDevice;
  me: boolean;
  output: boolean;
  playing: boolean;
  onPick(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!renaming) setName(device.name); }, [device.name, renaming]);
  useEffect(() => { if (renaming) input.current?.select(); }, [renaming]);

  // The fader moves under the finger at once; the device is told on release (one
  // command per gesture, not one per pixel — the session's rate limit is per listener).
  const [level, setLevel] = useState<number | null>(null);
  const shown = level ?? device.volume ?? 1;
  // ⚠️ Held until the DEVICE says it has arrived — not dropped on release. Dropping
  // it showed the last volume the device had reported, which the command has not
  // reached yet, so the fader sprang back and the next nudge started from there.
  useEffect(() => {
    if (level != null && device.volume != null && Math.abs(device.volume - level) < 0.005) setLevel(null);
  }, [device.volume]); // eslint-disable-line react-hooks/exhaustive-deps

  function commitName() {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== device.name) void renameSessionDevice(device.id, next);
    else setName(device.name);
  }

  const state = output
    ? (playing ? 'Playing' : 'Paused')
    : device.online ? null : seenAgo(device.last_seen_at);

  return (
    <li className={`kr-device${output ? ' is-output' : ''}${device.online ? '' : ' is-offline'}`}>
      <button
        type="button"
        className="kr-device-pick"
        onClick={onPick}
        disabled={!device.online || output}
        aria-label={output ? `${device.name} — the output` : `Play on ${device.name}`}
      >
        <IconDeviceKind kind={device.kind} />
        <span className="kr-device-body">
          {renaming ? null : <span className="kr-device-name">{device.name}</span>}
          <span className="kr-device-note">
            {[me ? 'This device' : device.platform, state].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>

      {renaming && (
        <form className="kr-device-rename" onSubmit={(e) => { e.preventDefault(); commitName(); }}>
          <Field
            ref={input}
            size="sm"
            value={name}
            maxLength={60}
            aria-label={`New name for ${device.name}`}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setName(device.name); setRenaming(false); } }}
          />
        </form>
      )}

      <div className="kr-device-tools">
        {!renaming && (
          <button type="button" className="kr-device-tool" onClick={() => setRenaming(true)}>Rename</button>
        )}
        {!device.online && (
          <button type="button" className="kr-device-tool" onClick={() => void forgetSessionDevice(device.id)}>Forget</button>
        )}
      </div>

      {device.online && (
        <Slider
          className="kr-device-volume"
          aria-label={`${device.name} volume`}
          min={0}
          max={1}
          step={0.01}
          value={shown}
          onChange={setLevel}
          onCommit={(v) => { void sendSessionCommand('volume', { device: device.id, level: v }); }}
        />
      )}
    </li>
  );
}

/* ── The sheet ─────────────────────────────────────────────────────────────────── */

export default function DevicePicker() {
  const open = useIsOpen();
  const info = usePlayerSession();
  const [allOffline, setAllOffline] = useState(false);
  useEffect(() => { if (!open) setAllOffline(false); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDevicePicker(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const { snapshot, output } = info;
  const meId = snapshot.me.id;
  const playing = !!snapshot.session?.playing;
  const byName = (a: SessionDevice, b: SessionDevice) => a.name.localeCompare(b.name);
  const online = snapshot.devices.filter((d) => d.online)
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : byName(a, b)));
  // Most recently seen first, and only a few: a private window is a new device every
  // time, and a pile of stale rows must not bury the ones that matter.
  const offline = snapshot.devices.filter((d) => !d.online)
    .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1));
  const OFFLINE_SHOWN = 4;
  const offlineShown = allOffline ? offline : offline.slice(0, OFFLINE_SHOWN);
  const solo = info.mode === 'solo';

  const row = (d: SessionDevice) => (
    <DeviceRow
      key={d.id}
      device={d}
      me={d.id === meId}
      output={d.id === output?.id}
      playing={playing}
      onPick={() => { info.transferTo(d.id); closeDevicePicker(); }}
    />
  );

  return (
    <div className="kr-sheet-host" role="dialog" aria-modal="true" aria-label="Choose where to listen">
      <button type="button" className="kr-sheet-scrim" aria-label="Close" onClick={closeDevicePicker} />
      <div className="kr-sheet kr-devices-sheet kr-glass kr-glass-deep kr-gloss">
        <div className="kr-sheet-grab" aria-hidden="true" />
        <header className="kr-sheet-head">
          <p className="kr-sheet-title">Listening on</p>
          <p className="kr-sheet-sub">
            {solo
              ? 'This device only — the listening session is not reachable right now.'
              : output ? `${output.name} is the one playing. Tap another device to move it there.`
                : 'Nothing is playing. Tap a device to play there.'}
          </p>
        </header>

        {!solo && (
          <>
            <ul className="kr-devices">{online.map(row)}</ul>
            {online.length < 2 && (
              <p className="kr-devices-hint">
                Open KourOS on a phone or another computer, signed in as you, and it appears here.
              </p>
            )}
            {offline.length > 0 && (
              <>
                <p className="kr-devices-label">Not connected</p>
                <ul className="kr-devices">{offlineShown.map(row)}</ul>
                {offline.length > offlineShown.length && (
                  <button type="button" className="kr-devices-more" onClick={() => setAllOffline(true)}>
                    Show {offline.length - offlineShown.length} more
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
