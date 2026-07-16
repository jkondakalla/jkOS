import { useState, type FormEvent } from 'react';
import { AsyncView, Lab, Sheet, TButton } from '@jkos/ui';
import { createPlaylist, deletePlaylist, updatePlaylist, type Playlist } from '../../api';
import { usePlaylists } from '../../hooks/usePlaylists';
import { playlistHref } from '../../hooks/useHashRoute';
import './playlists.css';

/** Playlists (18.6): the user's own playlists — create (inline name form),
 *  rename (inline, in place), delete (inline confirm, no native `confirm()` —
 *  matches the suite's no-browser-dialog styling everywhere else), each row
 *  linking into PlaylistDetail (`#/playlist/<id>`). */
export default function Playlists() {
  const { playlists, loading, error, reload } = usePlaylists();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createPlaylist({ name });
      setNewName('');
      setCreating(false);
      reload();
    } finally {
      setBusy(false);
    }
  }

  function startRename(p: Playlist) {
    setConfirmingId(null);
    setRenamingId(p.id);
    setRenameValue(p.name);
  }

  async function submitRename(e: FormEvent, id: number) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await updatePlaylist(id, { name });
      setRenamingId(null);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: number) {
    setBusy(true);
    try {
      await deletePlaylist(id);
      setConfirmingId(null);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view-playlists">
      <div className="kr-heading">
        <Lab size="sm">Playlists</Lab>
        <TButton quiet onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New playlist'}
        </TButton>
      </div>

      {creating && (
        <form className="kr-picker-new kr-playlist-new" onSubmit={submitCreate}>
          <input
            autoFocus
            className="kr-picker-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name"
            aria-label="New playlist name"
          />
          <TButton type="submit" disabled={!newName.trim() || busy}>Create</TButton>
        </form>
      )}

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load your playlists. Try again shortly."
        empty={!loading && !error && playlists.length === 0}
        emptyText="No playlists yet — create one above."
      >
        <ul className="kr-playlist-list">
          {playlists.map((p) => (
            <li key={p.id}>
              <Sheet className="kr-playlist-row">
                {renamingId === p.id ? (
                  <form className="kr-playlist-rename" onSubmit={(e) => submitRename(e, p.id)}>
                    <input
                      autoFocus
                      className="kr-picker-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label="Playlist name"
                    />
                    <TButton type="submit" disabled={!renameValue.trim() || busy}>Save</TButton>
                    <TButton type="button" quiet onClick={() => setRenamingId(null)}>Cancel</TButton>
                  </form>
                ) : (
                  <>
                    <a href={playlistHref(p.id)} className="kr-playlist-link">
                      <span className="kr-playlist-name">{p.name}</span>
                      <span className="kr-playlist-count">
                        {p.track_refs.length} track{p.track_refs.length === 1 ? '' : 's'}
                      </span>
                    </a>
                    <div className="kr-playlist-actions">
                      {confirmingId === p.id ? (
                        <>
                          <TButton quiet onClick={() => confirmDelete(p.id)} disabled={busy}>Confirm delete</TButton>
                          <TButton quiet onClick={() => setConfirmingId(null)}>Cancel</TButton>
                        </>
                      ) : (
                        <>
                          <TButton quiet onClick={() => startRename(p)}>Rename</TButton>
                          <TButton quiet onClick={() => setConfirmingId(p.id)}>Delete</TButton>
                        </>
                      )}
                    </div>
                  </>
                )}
              </Sheet>
            </li>
          ))}
        </ul>
      </AsyncView>
    </section>
  );
}
