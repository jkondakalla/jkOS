/**
 * useBreakpoint — the ONE JS breakpoint source for the suite.
 *
 * Reads the canonical tiers from @jkos/design (the same numbers hub.css's
 * `@media` blocks use), so app-level layout switching never hand-rolls a
 * matchMedia query or reads window.innerWidth against a magic number again.
 * Replaces BeigeBoard's `matchMedia('(max-width: 768px)')` and ORDECK's
 * `activeBreakpoint(window.innerWidth)` reads.
 *
 *   const bp = useBreakpoint();          // 'mobile' | 'tablet' | 'desktop'
 *   if (bp === 'mobile') return <MobileApp />;
 */
import { useEffect, useState } from 'react';
import { MEDIA, activeBreakpoint, type BreakpointName } from '@jkos/design';

/** SSR/first-paint guess; corrected on mount. Desktop is the safe default for
 *  the server-rendered apps (jkAuth) that never reach the effect. */
function readBreakpoint(): BreakpointName {
  if (typeof window === 'undefined') return 'desktop';
  return activeBreakpoint(window.innerWidth);
}

export function useBreakpoint(): BreakpointName {
  const [bp, setBp] = useState<BreakpointName>(readBreakpoint);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mobile = window.matchMedia(MEDIA.mobile);
    const tablet = window.matchMedia(MEDIA.tablet);
    const update = () => setBp(mobile.matches ? 'mobile' : tablet.matches ? 'tablet' : 'desktop');
    update();
    mobile.addEventListener('change', update);
    tablet.addEventListener('change', update);
    return () => {
      mobile.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
    };
  }, []);

  return bp;
}
