import { usePlayerSession } from './PlayerProvider';
import { openDevicePicker } from '../components/DevicePicker';
import { IconDevices } from '../components/icons';

/**
 * "Playing on Laptop" — shown wherever the player is, whenever the music is coming out
 * of ANOTHER device (the listening session's remote mode). Without it, a phone whose
 * play button starts a song in the next room reads as a phone that is broken: the
 * whole point of Spotify's routing (Jag, 2026-09-23) is that you can see where the
 * sound is, and move it with one tap — so the strip IS the picker's button.
 *
 * Renders nothing while this tab is the output, idle, or solo.
 */
export default function PlayingOn({ className = '' }: { className?: string }) {
  const { mode, output } = usePlayerSession();
  if (mode !== 'remote' || !output) return null;
  return (
    <button type="button" className={`kr-playing-on ${className}`.trim()} onClick={openDevicePicker}>
      <IconDevices size={15} />
      <span>Playing on <b>{output.name}</b></span>
    </button>
  );
}

/** The speaker button: opens the picker from a transport. Marked while the output is
 *  elsewhere, so it reads as "somewhere else" before the strip is even read. */
export function DevicesButton({ className = '' }: { className?: string }) {
  const { mode } = usePlayerSession();
  if (mode === 'solo') return null;   // one device: nothing to choose between
  return (
    <button
      type="button"
      className={`kr-ghost kr-devices-button${mode === 'remote' ? ' is-remote' : ''} ${className}`.trim()}
      onClick={openDevicePicker}
      aria-label="Choose where to listen"
    >
      <IconDevices />
    </button>
  );
}
