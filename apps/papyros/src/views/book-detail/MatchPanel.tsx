import { MatchPanel as GenericMatchPanel } from '@jkos/ui';
import { matchBook, searchMetadata, type Candidate, type MatchResult } from '../../api';

// The "Fix metadata" match flow (task 5.3's brief) — generalized by git history
// item 20.4 into @jkos/ui's <MatchPanel> (packages/ui/src/MatchPanel.tsx), a
// presentational search→candidates→apply shell fed by an injected {search, apply}
// pair instead of a hardcoded API import. This file is now a THIN BINDING of that
// generic panel to papyros's own EXISTING searchMetadata/matchBook calls (api.ts)
// — same requests on the wire, same UX, zero visual change (20.4's brief).
//
// Deliberately NOT routed through @jkos/weave's connectorPair() helper
// (packages/weave/src/connectorPair.ts), even though META's metadataSearch read +
// matchBook capability (backend/discovery.js) are exactly the connector+capability
// pair that helper targets: searchMetadata/matchBook are same-app direct fetches
// (apiJson) that THROW on a non-2xx response — that's what lets the generic panel
// below tell "search failed" apart from "no results" (a caught rejection vs. an
// empty resolved array). connectorPair's underlying weaveClient.list() instead
// resolves [] silently on ANY miss (its documented cross-app-read contract), which
// would collapse that distinction. connectorPair is for a genuinely cross-app
// consumer; this app's own routes don't need the discovery hop.
export interface MatchPanelProps {
  bookId: number;
  /** Prefilled search term — book.title. */
  initialTerm: string;
  /** Fired after a successful POST /api/match (whether or not the cover download
   *  itself succeeded — that distinction is surfaced inline, not via this callback). */
  onApplied: (result: MatchResult) => void;
  onClose: () => void;
}

export default function MatchPanel({ bookId, initialTerm, onApplied, onClose }: MatchPanelProps) {
  return (
    <GenericMatchPanel<Candidate, MatchResult>
      title="Fix metadata"
      initialTerm={initialTerm}
      search={searchMetadata}
      apply={(candidate) => matchBook(bookId, candidate)}
      onApplied={(_candidate, result) => onApplied(result)}
      resultNote={(result) => (result.cover === 'failed'
        ? ' Metadata updated, but the cover art download failed.'
        : null)}
      onClose={onClose}
    />
  );
}
