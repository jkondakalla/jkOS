// Hardware primitives still used by the auth/login chrome (Led). The richer
// deck pieces (screws, vents, gauges, seg displays, knobs, tapes, panels, mode
// hooks) went out with the legacy canvas + the 2026-07-17 v0.1 chrome cull;
// reintroduce from git history only if a future view has a job for them.
export * from './primitives';
