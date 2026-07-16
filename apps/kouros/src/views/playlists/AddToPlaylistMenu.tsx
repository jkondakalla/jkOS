import { useEffect, useState, type FormEvent } from 'react';
import { AsyncView, Lab, Scrim, Sheet, TButton, cx } from '@jkos/ui';
import { createPlaylist, updatePlaylist, type Playlist } from '../../api';
import { usePlaylists } from '../../hooks/usePlaylists';
import './playlists.css';

export interface AddToPlaylistMenuProps {
  trackId: number;
  className?: string;
}

/** The "add this track to a playlist" seam (18.6) — a small round "+" button that
 *  opens a centered picker (the user's playlists + "New playlist"). Deliberately a
 *  SIBLING of the row's own play button, never nested inside it — TrackRow's whole
 *  row IS a `<button>` (see that file), and a `<button>` inside a `<button>` is
 *  invalid HTML that also breaks click targeting, so this renders as a second
 *  top-level child of the row's `<li>`.
 *
 *  Fetches the playlist list lazily (`usePlaylists({ enabled: open })`) — a dense
 *  track list can render dozens of these per page, and each one mounting an
 *  eager GET /api/playlists would be dozens of redundant owner-scoped fetches for
 *  a menu the user may never open. */
export default function AddToPlaylistMenu({ trackId, className }: AddToPlaylistMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { playlists, loading, error, reload } = usePlaylists({ enabled: open });

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setNewName('');
    setNote(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function addTo(playlist: Playlist) {
    if (playlist.track_refs.includes(trackId)) {
      setNote(`Already in "${playlist.name}".`);
      return;
    }
    setBusyId(playlist.id);
    setNote(null);
    try {
      await updatePlaylist(playlist.id, { track_refs: [...playlist.track_refs, trackId] });
      setNote(`Added to "${playlist.name}".`);
      reload();
    } catch {
      setNote('Could not add — try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusyId('new');
    setNote(null);
    try {
      const created = await createPlaylist({ name, track_refs: [trackId] });
      setNote(`Created "${created.name}" and added the track.`);
      setCreating(false);
      setNewName('');
      reload();
    } catch {
      setNote('Could not create the playlist — try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={cx('kr-add-menu', className)}>
      <button
        type="button"
        className="kr-add-btn"
        title="Add to playlist"
        aria-label="Add to playlist"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        +
      </button>
      {open && (
        <>
          <Scrim className="kr-picker-scrim" onClick={() => setOpen(false)} />
          <Sheet className="kr-picker" role="dialog" aria-label="Add to playlist">
            <div className="kr-picker-head">
              <Lab size="sm">Add to playlist</Lab>
              <TButton quiet aria-label="Close" onClick={() => setOpen(false)}>&times;</TButton>
            </div>

            {note && <p className="kr-note">{note}</p>}

            <AsyncView
              loading={loading}
              error={error}
              errorText="Could not load your playlists."
              empty={!loading && !error && playlists.length === 0}
              emptyText="No playlists yet — create one below."
            >
              <ul className="kr-picker-list">
                {playlists.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="kr-picker-item"
                      disabled={busyId === p.id}
                      onClick={() => addTo(p)}
                    >
                      <span className="kr-picker-item-name">{p.name}</span>
                      <span className="kr-picker-count">{p.track_refs.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </AsyncView>

            {creating ? (
              <form className="kr-picker-new" onSubmit={submitNew}>
                <input
                  autoFocus
                  className="kr-picker-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Playlist name"
                  aria-label="New playlist name"
                />
                <TButton type="submit" disabled={!newName.trim() || busyId === 'new'}>Create</TButton>
                <TButton type="button" quiet onClick={() => setCreating(false)}>Cancel</TButton>
              </form>
            ) : (
              <TButton quiet className="kr-picker-new-btn" onClick={() => setCreating(true)}>+ New playlist</TButton>
            )}
          </Sheet>
        </>
      )}
    </div>
  );
}
