// diff.mjs — did a change move any widget's pixels? (`pnpm widget diff`)
//
// The rescope's review rule (TODO §6): every VISIBLE change goes on the running review
// page with its before/after contact sheets, and a change that moves nothing is logged as
// "proven unchanged". This is that proof, made one command:
//
//   1. check out `against` (default HEAD) into a scratch git worktree and install it from
//      the lockfile (--prefer-offline: only what this machine's store lacks is fetched);
//   2. shoot every widget both trees ship, in both faces, there and here (`widget shot`,
//      each tree with its own renderer, CSS and preview);
//   3. compare the PNGs byte for byte.
//
// Identical sheets are the ledger's proof. A sheet that differs is kept as a before/after
// pair in `out` — what the review page shows. The worktree is removed either way.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO_ROOT, widgetFiles } from './catalog.mjs';

/**
 * @param {{ against?: string, ids?: string[], out: string }} opts
 * @returns {{ against: string, identical: string[], differ: string[], added: string[], removed: string[] }}
 */
export function diffWidgets({ against = 'HEAD', ids = [], out }) {
  const git = (args, cwd = REPO_ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const rev = git(['rev-parse', '--short', against]);
  const scratch = mkdtempSync(join(tmpdir(), 'jkos-widget-diff-'));
  const tree = join(scratch, 'before');
  try {
    git(['worktree', 'add', '--detach', '--quiet', tree, rev]);
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--silent'], { cwd: tree, stdio: ['ignore', 'ignore', 'inherit'] });

    // Which widgets each tree ships, by id — read from that tree's own files.
    const idsIn = (root) => {
      const found = [];
      for (const app of readdirSync(join(root, 'apps'))) {
        const dir = join(root, 'apps', app, 'widgets');
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) {
          if (f.endsWith('.json') && !f.endsWith('.fixtures.json')) {
            try { found.push(JSON.parse(readFileSync(join(dir, f), 'utf8')).id); } catch { /* not JSON there: not comparable */ }
          }
        }
      }
      return new Set(found);
    };
    const before = idsIn(tree);
    const after = new Set(widgetFiles().filter((w) => w.def).map((w) => w.def.id));
    const wanted = ids.length ? ids : [...after];
    const both = wanted.filter((id) => before.has(id) && after.has(id));

    const shoot = (root, dir) => {
      if (!both.length) return;
      execFileSync('node', [join(root, 'scripts/widget.mjs'), 'shot', ...both, '--out', dir], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    };
    const b = join(scratch, 'shots-before'), a = join(scratch, 'shots-after');
    shoot(tree, b);
    shoot(REPO_ROOT, a);

    const identical = [], differ = [];
    mkdirSync(out, { recursive: true });
    for (const id of both) {
      for (const mode of ['paper', 'dark']) {
        const f = `${id}-${mode}.png`;
        const same = existsSync(join(b, f)) && existsSync(join(a, f)) && readFileSync(join(b, f)).equals(readFileSync(join(a, f)));
        if (same) { identical.push(`${id} · ${mode}`); continue; }
        differ.push(`${id} · ${mode}`);
        if (existsSync(join(b, f))) renameSync(join(b, f), join(out, `${id}-${mode}-before.png`));
        if (existsSync(join(a, f))) renameSync(join(a, f), join(out, `${id}-${mode}-after.png`));
      }
    }
    return {
      against: rev, identical, differ,
      added: wanted.filter((id) => after.has(id) && !before.has(id)),
      removed: [...before].filter((id) => !after.has(id) && (!ids.length || ids.includes(id))),
    };
  } finally {
    try { git(['worktree', 'remove', '--force', tree]); } catch { /* never created */ }
    rmSync(scratch, { recursive: true, force: true });
  }
}
