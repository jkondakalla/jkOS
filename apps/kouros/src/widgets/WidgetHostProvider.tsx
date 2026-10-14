import { useState, type ReactNode } from 'react';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { startStation } from '../player/station';
import { SheetCtx } from './host';

/**
 * Around the routed content, inside PlayerProvider: what KourOS's widget host needs from
 * the shell — the one action sheet a widget's `sheet.open` raises (the shell's, like the
 * device picker). The host itself is widgets/host.tsx.
 */
export function WidgetHostProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  return (
    <SheetCtx.Provider value={setMenu}>
      {children}
      <ActionSheet target={menu} onClose={() => setMenu(null)} onRadio={startStation} />
    </SheetCtx.Provider>
  );
}
