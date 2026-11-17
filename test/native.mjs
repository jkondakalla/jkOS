// Native-shell conformance — the Android apps and the desktop app stay as locked-down as
// they were built.
//
// The native shells (native/) are the one place in this suite where a CONFIGURATION line is
// the security control: a WebView flag, a manifest attribute, an Electron fuse. Each is a
// single token an agent can flip while fixing something else — `allowBackup="true"` to
// "make restore work", `nodeIntegration: true` to "reach the filesystem", `--no-sandbox` to
// "make it start" — and nothing in either build would object. The worst defect class in this
// repo is a control that exists in configuration but not in code; this is the code.
//
// It asserts:
//
//   1. The desktop shell's navigation policy returns what native/origin-cases.json declares
//      — the same vectors the Android launcher's OriginPolicy.kt passes in its own JVM test.
//      Two implementations, one declared behaviour (they cannot share code: Kotlin vs JS).
//   2. The desktop shell's hardening values (webPreferences, granted permissions, external
//      schemes) and that main.js APPLIES them rather than re-deciding: one window, built from
//      policy.WEB_PREFERENCES; every navigation, redirect and window.open guarded; no preload,
//      no --no-sandbox, bad certificates refused. And the packaging: Electron fuses flipped,
//      .deb only (see dist.mjs for why never an AppImage), one version with native/shells.js.
//   3. Android least privilege, read from the manifests themselves: backups and device
//      transfer off, HOME only in the home launcher, package visibility limited to launcher
//      apps (never QUERY_ALL_PACKAGES), INTERNET the home launcher's only permission, the TWAs
//      none, https + system CAs only.
//   4. Android WebView source: no addJavascriptInterface (the bridge is origin-scoped
//      addWebMessageListener), no SSL proceed(), no file access, no mixed content, debugging
//      only on debug builds.
//   5. Supply chain + signing: release signing only from the environment, no key tracked,
//      Gradle's wrapper and every dependency pinned by checksum, the build image by digest.
//   6. Every staging URL a debug build opens is actually routed by the staging server.
//   7. The NATIVE app (jkOS Alpha, native/android/ordeck): exactly four permissions; only the
//      launcher, the sign-in redirect and the media service exported; the redirect filter's
//      scheme is the applicationId placeholder; no WebView at all; tokens reach storage only
//      sealed by the Keystore helper, a Bearer token only reaches apiBase, redirects are not
//      followed, refreshes are serialised; and its play-context encoder agrees with the
//      server's grammar on native/play-context-cases.json.
//   8. A native app signs in where it should and nowhere else: staging jkAuth serves the
//      staging clients, production none until it is set, and the staging edge gate
//      hands jkAuth the app's Bearer token.
//
// The generated files (per-variant origins, shells.json) are held by
// `node native/gen-native.mjs --check`, which runs first in the same check:native script.
//
// Run:  node test/native.mjs        (wired as `pnpm check:native`, folded into
//                                    `pnpm test:contracts`)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const require = createRequire(import.meta.url);

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, good, bad) => (cond ? ok(good) : fail(bad));

/** Drop comments so a scan sees code, not the prose that explains what not to do. A `//`
 *  only starts a comment at line start or after whitespace, so `https://…` survives. */
const stripCode = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const stripXml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/** Every file under `dir` whose name matches `re`. */
function walk(dir, re, out = []) {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = join(dir, e.name);
    if (e.isDirectory()) walk(rel, re, out);
    else if (re.test(e.name)) out.push(rel);
  }
  return out;
}

const shells = require(resolve(root, 'native/shells.js'));
const policy = require(resolve(root, 'native/desktop/src/policy.js'));

// ── 1. One declared navigation rule ──────────────────────────────────────────
{
  const doc = JSON.parse(read('native/origin-cases.json'));
  const wrong = doc.cases.filter((c) => policy.allows(c.url, doc.origins) !== c.allow);
  check(wrong.length === 0 && doc.cases.length >= 20,
    `desktop policy.allows agrees with all ${doc.cases.length} origin-cases.json vectors`,
    wrong.length
      ? `desktop policy.allows disagrees with origin-cases.json:\n    ${wrong.map((c) => `${c.url} (expected ${c.allow}: ${c.why})`).join('\n    ')}`
      : `origin-cases.json holds ${doc.cases.length} cases — too few to mean anything (≥20)`);
  // The Kotlin half exists and reads the same file (its assertions run under Gradle).
  const kt = read('native/android/home/src/test/java/net/jkos/home/OriginPolicyTest.kt');
  const gradle = read('native/android/home/build.gradle.kts');
  check(/jkos\.originCases/.test(kt) && /origin-cases\.json/.test(gradle),
    'the Android OriginPolicy test reads the same origin-cases.json',
    'OriginPolicyTest.kt no longer reads native/origin-cases.json — the two policies can now drift apart');
}

// ── 2. Desktop hardening: decided in policy.js, applied by main.js ───────────
{
  const W = policy.WEB_PREFERENCES;
  const want = {
    contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false,
    webviewTag: false,
  };
  const off = Object.entries(want).filter(([k, v]) => W[k] !== v);
  check(off.length === 0 && !('preload' in W),
    'WEB_PREFERENCES: context isolation + sandbox on, no Node anywhere, web security on, no <webview>, no preload',
    `WEB_PREFERENCES weakened: ${off.map(([k, v]) => `${k} should be ${v}, is ${W[k]}`).join('; ')}${'preload' in W ? '; a preload is exposed' : ''}`);

  // ⚠️ PINNED EXACTLY. Granting a permission is a decision someone should have to make here,
  // in the gate, on purpose — not a line that slides into policy.js with a feature.
  check(JSON.stringify(policy.GRANTED_PERMISSIONS) === JSON.stringify(['clipboard-sanitized-write']),
    'the page is granted exactly one permission (clipboard-sanitized-write), and only on a shell origin',
    `GRANTED_PERMISSIONS changed to ${JSON.stringify(policy.GRANTED_PERMISSIONS)} — if a frontend now needs it, update this pin deliberately`);
  const origins = ['https://jkos.net'];
  check(!policy.permissionAllowed('clipboard-sanitized-write', 'https://evil.example/', origins)
      && !policy.permissionAllowed('media', 'https://jkos.net/', origins)
      && policy.permissionAllowed('clipboard-sanitized-write', 'https://jkos.net/', origins),
    'permissionAllowed: granted permission on a shell origin only; anything else refused',
    'permissionAllowed grants off a shell origin, or grants an unlisted permission');
  const ext = { 'https://x.example/': true, 'http://x.example/': true, 'mailto:a@b.c': true,
    'file:///etc/passwd': false, 'javascript:alert(1)': false, 'smb://nas/share': false, 'vscode://x': false, 'nonsense': false };
  const extWrong = Object.entries(ext).filter(([u, v]) => policy.externalAllowed(u) !== v);
  check(extWrong.length === 0,
    'externalAllowed hands only web and mail URLs to the OS (never file:, smb:, a custom scheme)',
    `externalAllowed wrong for: ${extWrong.map(([u]) => u).join(', ')}`);

  const main = stripCode(read('native/desktop/src/main.js'));
  const wins = [...main.matchAll(/new BrowserWindow\(/g)].length;
  check(wins === 1 && /webPreferences:\s*\{\s*\.\.\.policy\.WEB_PREFERENCES\s*\}/.test(main),
    'main.js builds its one window from policy.WEB_PREFERENCES, unmodified',
    `main.js must build exactly one BrowserWindow with webPreferences: { ...policy.WEB_PREFERENCES } (found ${wins} window(s))`);
  for (const [what, re] of [
    ['a will-navigate guard', /on\('will-navigate',\s*guard\)/],
    ['a will-redirect guard', /on\('will-redirect',\s*guard\)/],
    ['the guard deciding by policy.allows', /const guard = [\s\S]{0,80}policy\.allows\(url, cfg\.origins\)/],
    ['window.open always denied', /setWindowOpenHandler\([\s\S]{0,300}return \{ action: 'deny' \}/],
    ['<webview> attachment refused', /on\('will-attach-webview',\s*\(e\) => e\.preventDefault\(\)\)/],
    ['permission requests decided by policy', /setPermissionRequestHandler\([\s\S]{0,160}policy\.permissionAllowed/],
    ['permission checks decided by policy', /setPermissionCheckHandler\([\s\S]{0,160}policy\.permissionAllowed/],
    ['bad certificates refused', /on\('certificate-error',[^\n]*callback\(false\)/],
    ['a profile per shell × environment', /setPath\('userData',[^\n]*cfg\.applicationId/],
  ]) check(re.test(main), `main.js: ${what}`, `main.js lost ${what}`);
  const opens = [...main.matchAll(/shell\.openExternal\(/g)].length;
  check(opens === 1 && /function openExternal\(url\) \{\s*if \(policy\.externalAllowed\(url\)\) shell\.openExternal\(url\)/.test(main),
    'shell.openExternal is reached only through policy.externalAllowed',
    `shell.openExternal is called ${opens} time(s) — every call must go through openExternal()/policy.externalAllowed`);
  const anywhere = ['native/desktop/package.json', ...walk('native/desktop/src', /\.(js|html|json)$/), ...walk('native/desktop/scripts', /\.m?js$/)]
    .map((p) => [p, stripCode(read(p))]);
  const loosened = anywhere.filter(([, s]) =>
    /no-sandbox|nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webviewTag:\s*true|webSecurity:\s*false|preload\s*:/.test(s));
  check(loosened.length === 0,
    'no --no-sandbox, no re-enabled Node, no preload anywhere in the desktop package',
    `the desktop package loosens its own sandbox in: ${loosened.map(([p]) => p).join(', ')}`);

  const dist = stripCode(read('native/desktop/scripts/dist.mjs'));
  const fuses = (/electronFuses:\s*\{([^}]*)\}/.exec(dist) || [])[1] || '';
  const fuseWant = { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false };
  const fuseWrong = Object.entries(fuseWant).filter(([k, v]) => !new RegExp(`\\b${k}:\\s*${v}\\b`).test(fuses));
  check(fuseWrong.length === 0,
    'Electron fuses: no run-as-Node, no NODE_OPTIONS/--inspect, asar-only with integrity, cookies encrypted at rest',
    `dist.mjs fuses wrong or missing: ${fuseWrong.map(([k, v]) => `${k} should be ${v}`).join('; ')}`);
  check(/createTarget\(\['deb'\]\)/.test(dist) && !/AppImage'/.test(dist),
    'desktop packages as .deb only (its AppArmor profile keeps the sandbox on under Ubuntu 24.04)',
    "dist.mjs targets something other than ['deb'] — an AppImage cannot keep the renderer sandbox on Ubuntu 24.04+");
  const deskPkg = JSON.parse(read('native/desktop/package.json'));
  check(deskPkg.version === shells.VERSION,
    `desktop package version = native/shells.js VERSION (${shells.VERSION})`,
    `native/desktop/package.json version ${deskPkg.version} ≠ native/shells.js VERSION ${shells.VERSION}`);
}

// ── 3. Android manifests: least privilege, read from the files themselves ────
{
  const MANIFESTS = {
    twa: 'native/android/twa/src/main/AndroidManifest.xml',
    home: 'native/android/home/src/main/AndroidManifest.xml',
    ordeck: 'native/android/ordeck/src/main/AndroidManifest.xml',
  };
  const m = Object.fromEntries(Object.entries(MANIFESTS).map(([k, p]) => [k, stripXml(read(p))]));
  const all = walk('native/android', /^AndroidManifest\.xml$/).map((p) => [p, stripXml(read(p))]);

  for (const [k, s] of Object.entries(m)) {
    check(/android:allowBackup="false"/.test(s) && /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(s),
      `${k}: backups off and data-extraction rules set`,
      `${k} manifest allows backup or has no dataExtractionRules — a live session could leave the device`);
    const rules = stripXml(read(`native/android/${k}/src/main/res/xml/data_extraction_rules.xml`));
    check(/<cloud-backup>[\s\S]*<exclude domain="root" path="\."[\s\S]*<\/cloud-backup>/.test(rules)
        && /<device-transfer>[\s\S]*<exclude domain="root" path="\."[\s\S]*<\/device-transfer>/.test(rules)
        && !/<include\b/.test(rules),
      `${k}: nothing leaves by cloud backup OR device transfer`,
      `${k} data_extraction_rules.xml no longer excludes the data root from both cloud backup and device transfer`);
  }
  check(all.every(([, s]) => !/QUERY_ALL_PACKAGES/.test(s)),
    'no manifest asks for QUERY_ALL_PACKAGES',
    `QUERY_ALL_PACKAGES requested in ${all.filter(([, s]) => /QUERY_ALL_PACKAGES/.test(s)).map(([p]) => p).join(', ')}`);
  const homes = all.filter(([, s]) => /android\.intent\.category\.HOME/.test(s)).map(([p]) => p);
  check(homes.length === 1 && homes[0] === MANIFESTS.home,
    'only jkOS Home declares the HOME intent (a TWA can never take over the home screen)',
    `HOME intent declared in: ${homes.join(', ') || 'nothing'} — expected exactly ${MANIFESTS.home}`);

  const perms = [...m.home.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((x) => x[1]);
  check(JSON.stringify(perms) === JSON.stringify(['android.permission.INTERNET']),
    'jkOS Home asks for INTERNET and nothing else',
    `jkOS Home permissions are ${JSON.stringify(perms)} — expected only INTERNET`);
  check(!/<uses-permission/.test(m.twa),
    'the TWAs ask for no permissions (Chrome holds the network)',
    'the TWA manifest now asks for a permission');
  const queries = (/<queries>([\s\S]*?)<\/queries>/.exec(m.home) || [])[1] || '';
  check(/<intent>\s*<action android:name="android\.intent\.action\.MAIN" \/>\s*<category android:name="android\.intent\.category\.LAUNCHER" \/>\s*<\/intent>/.test(queries)
      && [...queries.matchAll(/<(intent|package|provider)\b/g)].length === 1,
    'jkOS Home sees only launcher apps (<queries> is exactly MAIN/LAUNCHER)',
    'jkOS Home <queries> is not exactly one MAIN/LAUNCHER intent — its package visibility widened');
  for (const k of ['home', 'ordeck']) {
    check(/android:networkSecurityConfig="@xml\/network_security_config"/.test(m[k]),
      `${k}: carries a network security config`, `${k} lost its networkSecurityConfig`);
    const nsc = stripXml(read(`native/android/${k}/src/main/res/xml/network_security_config.xml`));
    check(/<base-config cleartextTrafficPermitted="false">/.test(nsc) && /<certificates src="system" \/>/.test(nsc)
        && !/src="user"/.test(nsc) && !/<domain-config|<debug-overrides/.test(nsc),
      `${k}: network security is https only, system CAs only, no per-domain or debug exceptions`,
      `${k} network_security_config.xml allows cleartext, trusts user CAs, or carves out an exception`);
  }
  check(/<activity\s+android:name="\.DrawerActivity"[^>]*android:exported="false"/.test(m.home),
    'the app drawer is not exported (no other app can open it)', 'DrawerActivity is exported');
  check(/FALLBACK_STRATEGY"\s+android:value="customtabs"/.test(m.twa),
    'TWA fallback is a Custom Tab, never an in-app WebView the APK would own',
    'TWA FALLBACK_STRATEGY is no longer customtabs');

}

// ── 4. Android WebView source ────────────────────────────────────────────────
{
  const src = walk('native/android', /\.(kt|java)$/).filter((p) => !/\/src\/test\//.test(p)).map((p) => [p, stripCode(read(p))]);
  const inModule = (mod) => src.filter(([p]) => p.startsWith(`native/android/${mod}/`)).length;
  check(src.length >= 15 && inModule('home') >= 5 && inModule('ordeck') >= 10,
    `scanned ${src.length} Android source files (home ${inModule('home')}, ordeck ${inModule('ordeck')})`,
    `found only ${src.length} Android source files (home ${inModule('home')}, ordeck ${inModule('ordeck')}) — the walk is not seeing the code`);
  const banned = [
    ['addJavascriptInterface (the bridge must be origin-scoped)', /addJavascriptInterface\s*\(/],
    ['SslErrorHandler.proceed()', /\.proceed\s*\(/],
    ['file access switched on', /allowFileAccess\s*=\s*true|setAllowFileAccess\(\s*true/],
    ['file-URL universal access', /AllowUniversalAccessFromFileURLs|allowUniversalAccessFromFileURLs\s*=\s*true|AllowFileAccessFromFileURLs\(\s*true|allowFileAccessFromFileURLs\s*=\s*true/],
    ['mixed content allowed', /MIXED_CONTENT_(ALWAYS_ALLOW|COMPATIBILITY_MODE)/],
    ['WebView debugging forced on', /setWebContentsDebuggingEnabled\(\s*true\s*\)/],
  ];
  for (const [what, re] of banned) {
    const hits = src.filter(([, s]) => re.test(s)).map(([p]) => p);
    check(hits.length === 0, `no ${what}`, `${what} in ${hits.join(', ')}`);
  }
  const bridge = src.find(([p]) => p.endsWith('/Bridge.kt'))?.[1] || '';
  check(/addWebMessageListener\(web, NAME, setOf\(expected\)\)/.test(bridge) && /if \(!isMainFrame \|\|/.test(bridge),
    'the bridge is addWebMessageListener scoped to the one start origin, main frame only',
    'Bridge.kt no longer scopes addWebMessageListener to setOf(expected) with a main-frame check');
  const home = src.find(([p]) => p.endsWith('/HomeActivity.kt'))?.[1] || '';
  check(/onReceivedSslError[\s\S]{0,200}handler\.cancel\(\)/.test(home),
    'certificate errors are cancelled, never waved through', 'HomeActivity.onReceivedSslError no longer calls handler.cancel()');
  check(/shouldOverrideUrlLoading[\s\S]{0,300}policy\.allows/.test(home) && /onPageStarted[\s\S]{0,300}policy\.allows/.test(home),
    'every main-frame navigation (and a POST that skips shouldOverrideUrlLoading) is decided by OriginPolicy',
    'HomeActivity no longer checks OriginPolicy in both shouldOverrideUrlLoading and onPageStarted');
  check(/onPermissionRequest\(request: PermissionRequest\) = request\.deny\(\)/.test(home),
    'page permission requests are denied', 'HomeActivity no longer denies WebView permission requests');
}

// ── 5. Supply chain + signing ────────────────────────────────────────────────
{
  const gradle = read('native/android/build.gradle.kts');
  check(/providers\.environmentVariable\("JKOS_ANDROID_KEYSTORE"\)/.test(gradle)
      && !/(storePassword|keyPassword)\s*=\s*"/.test(gradle),
    'release signing comes from the environment only (no password literal)',
    'build.gradle.kts has a literal signing password, or no longer reads JKOS_ANDROID_KEYSTORE');
  const keys = execFileSync('git', ['ls-files', '--', '*.keystore', '*.jks', '*.p12'], { cwd: root, encoding: 'utf8' }).trim();
  const ignore = read('.gitignore');
  check(!keys && /^\*\.keystore$/m.test(ignore) && /^\*\.jks$/m.test(ignore),
    'no signing key is tracked, and .gitignore keeps it that way',
    keys ? `signing key(s) tracked: ${keys}` : '.gitignore no longer ignores *.keystore / *.jks');
  const wrapper = read('native/android/gradle/wrapper/gradle-wrapper.properties');
  check(/^distributionSha256Sum=[0-9a-f]{64}$/m.test(wrapper),
    'the Gradle distribution is pinned by sha256', 'gradle-wrapper.properties has no distributionSha256Sum');
  const vm = existsSync(resolve(root, 'native/android/gradle/verification-metadata.xml'))
    ? read('native/android/gradle/verification-metadata.xml') : '';
  const pinned = [...vm.matchAll(/<sha256 value="[0-9a-f]{64}"/g)].length;
  check(/<verify-metadata>true<\/verify-metadata>/.test(vm) && pinned > 100,
    `every Gradle dependency is checksum-verified (${pinned} sha256 pins)`,
    'gradle/verification-metadata.xml is missing, off, or nearly empty — dependencies would resolve unverified');
  const tc = JSON.parse(read('native/android/toolchain.json'));
  check([tc.jdk, tc.cmdlineTools].every((x) => /^[0-9a-f]{64}$/.test(x?.sha256 || '') && /^https:\/\//.test(x?.url || '')),
    'the JDK and Android command-line tools are pinned by sha256 over https',
    'toolchain.json has an unpinned or non-https download');
  check(/^FROM [^\s]+@sha256:[0-9a-f]{64}\s*$/m.test(read('native/android/Dockerfile')),
    'the Android build image is pinned by digest', 'native/android/Dockerfile FROM is not pinned by @sha256 digest');
}

// ── 6. Every staging URL a debug build opens is routed ───────────────────────
{
  const staging = read('infra/nginx/standalone.conf') + read('infra/nginx/apps-generated-staging.conf');
  const urls = new Set();
  for (const s of shells.SHELLS) {
    const c = shells.shellConfig(s, 'debug');
    urls.add(c.startUrl);
    for (const sc of c.shortcuts) urls.add(sc.url);
  }
  const unrouted = [...urls].filter((u) => {
    const path = new URL(u).pathname;
    return path !== '/' && !new RegExp(`location\\s+${path.replace(/\//g, '\\/')}\\s*\\{`).test(staging);
  });
  check(unrouted.length === 0,
    `every debug-build URL is routed on staging (${[...urls].map((u) => new URL(u).pathname).join(' ')})`,
    `a debug build would open a path staging does not route: ${unrouted.join(', ')}`);
}

// ── 7. The native app: jkOS Alpha ────────────────────────────────────────────
{
  const MOD = 'native/android/ordeck';
  const man = stripXml(read(`${MOD}/src/main/AndroidManifest.xml`));
  // A `tools:node="remove"` entry is a removal of what a library merges in, not a request.
  const permEntries = [...man.matchAll(/<uses-permission\b([^>]*)\/>/g)].map((x) => ({
    name: (/android:name="([^"]+)"/.exec(x[1]) || [])[1], removed: /tools:node="remove"/.test(x[1]),
  }));
  const perms = permEntries.filter((p) => !p.removed).map((p) => p.name).sort();
  const want = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.INTERNET', 'android.permission.WAKE_LOCK'];
  check(JSON.stringify(perms) === JSON.stringify(want),
    'jkOS Alpha asks for exactly INTERNET, FOREGROUND_SERVICE(+_MEDIA_PLAYBACK) and WAKE_LOCK',
    `jkOS Alpha permissions are ${JSON.stringify(perms)} — expected exactly ${JSON.stringify(want)}`);
  // The APK carries the MERGED manifest. Media3 merges in ACCESS_NETWORK_STATE, and the removal
  // that keeps it out is pinned, so it can't quietly go away in a manifest tidy.
  const removed = permEntries.filter((p) => p.removed).map((p) => p.name).sort();
  check(JSON.stringify(removed) === JSON.stringify(['android.permission.ACCESS_NETWORK_STATE']),
    "jkOS Alpha removes Media3's merged-in ACCESS_NETWORK_STATE (tools:node=\"remove\")",
    `jkOS Alpha's permission removals are ${JSON.stringify(removed)} — expected exactly ACCESS_NETWORK_STATE`);
  // The build holds the merged manifest to ALLOWED_PERMISSIONS, and assemble depends on that
  // check. Its list must be this manifest's, so the source and the artifact can't drift apart.
  const gradle = read(`${MOD}/build.gradle.kts`);
  const allowed = [...((/val ALLOWED_PERMISSIONS = listOf\(([\s\S]*?)\)/.exec(gradle) || [])[1] || '')
    .matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  check(JSON.stringify(allowed) === JSON.stringify(want)
      && /SingleArtifact\.MERGED_MANIFEST/.test(gradle)
      && /tasks\.matching \{ it\.name == "assemble\$cap" \}\.configureEach \{ dependsOn\(check\) \}/.test(gradle),
    "the build refuses an APK whose merged manifest asks for more than the source manifest's four",
    `${MOD}/build.gradle.kts: ALLOWED_PERMISSIONS is ${JSON.stringify(allowed)}, or assemble no longer depends on the merged-manifest check`);

  // Every component, and which are exported. A component with an intent filter and no explicit
  // android:exported is refused by the build for targetSdk ≥ 31 — but an explicit "true" on the
  // wrong one is silent, so the exported set is pinned by name.
  const comps = [...man.matchAll(/<(activity|service|receiver|provider)\b([^>]*)>/g)].map(([, kind, attrs]) => ({
    kind, name: (/android:name="([^"]+)"/.exec(attrs) || [])[1], exported: /android:exported="true"/.test(attrs),
  }));
  const exported = comps.filter((c) => c.exported).map((c) => c.name).sort();
  check(JSON.stringify(exported) === JSON.stringify(['.MainActivity', '.RedirectActivity', '.kouros.PlaybackService']),
    'jkOS Alpha exports only the launcher, the sign-in redirect and the media service',
    `jkOS Alpha exports ${JSON.stringify(exported)} — expected exactly .MainActivity, .RedirectActivity, .kouros.PlaybackService`);
  const block = (name) => (new RegExp(`<(?:activity|service)\\s+android:name="${name.replace(/\./g, '\\.')}"[\\s\\S]*?</(?:activity|service)>`).exec(man) || [''])[0];
  const redirect = block('.RedirectActivity');
  const datas = [...redirect.matchAll(/<data\b[^>]*>/g)].map((x) => x[0]);
  check(/android\.intent\.action\.VIEW/.test(redirect) && /android\.intent\.category\.BROWSABLE/.test(redirect)
      && datas.length === 1 && /^<data android:scheme="\$\{applicationId\}" \/>$/.test(datas[0]),
    "the sign-in redirect's only filter is VIEW/BROWSABLE on the scheme ${applicationId} (the client id jkAuth knows)",
    `the RedirectActivity filter changed: ${datas.join(' ') || 'no <data>'} — it must be exactly the applicationId scheme`);
  const service = block('.kouros.PlaybackService');
  check(/android:foregroundServiceType="mediaPlayback"/.test(service)
      && /<action android:name="androidx\.media3\.session\.MediaSessionService" \/>/.test(service)
      && [...service.matchAll(/<action\b/g)].length === 1,
    'the media service is a mediaPlayback foreground service answering only the MediaSessionService action',
    'PlaybackService lost foregroundServiceType="mediaPlayback" or answers an action besides MediaSessionService');
  check(/<activity\s+android:name="\.MainActivity"[\s\S]*?android\.intent\.category\.LAUNCHER[\s\S]*?<\/activity>/.test(man)
      && !/android\.intent\.category\.LAUNCHER/.test(redirect),
    'MainActivity is the launcher (and the redirect is not)', 'the launcher intent moved off MainActivity');
  check(/applicationId = shell\["package"\] as String/.test(gradle) && /versionNameSuffix = shell\["versionSuffix"\] as String/.test(gradle),
    'the applicationId (= the redirect scheme = the jkAuth client id) comes from shells.json, not a literal',
    `${MOD}/build.gradle.kts no longer reads applicationId / versionNameSuffix from shells.json`);

  // The source itself.
  const kt = Object.fromEntries(walk(`${MOD}/src/main`, /\.kt$/).map((p) => [p.split('/').pop(), stripCode(read(p))]));
  const all = Object.entries(kt);
  const hits = (re) => all.filter(([, s]) => re.test(s)).map(([f]) => f);
  check(hits(/\bWebView\b|android\.webkit|addJavascriptInterface|evaluateJavascript/).length === 0,
    'jkOS Alpha contains no WebView (no page, no bridge)',
    `WebView / android.webkit in ${hits(/\bWebView\b|android\.webkit|addJavascriptInterface|evaluateJavascript/).join(', ')}`);
  const prefs = hits(/SharedPreferences|getSharedPreferences|PreferenceManager|DataStore|openFileOutput|getExternal/);
  check(prefs.length === 0,
    'no SharedPreferences, DataStore or external storage anywhere in the app',
    `token-capable storage outside SessionStore: ${prefs.join(', ')}`);
  const writers = hits(/FileOutputStream|\.writeText\(|\.writeBytes\(|startWrite\(|Files\.write/);
  check(writers.length === 1 && writers[0] === 'SessionStore.kt',
    'only SessionStore.kt writes files', `files are written from ${writers.join(', ') || 'nowhere'} — only SessionStore.kt may`);
  const store = kt['SessionStore.kt'] || '';
  const writes = [...store.matchAll(/out\.write\(([^\n]*)\)/g)].map((x) => x[1]);
  check(writes.length >= 1 && writes.every((w) => /^box\.seal\(/.test(w))
      && /KeyStore\.getInstance\(KEYSTORE\)/.test(store) && /KEYSTORE = "AndroidKeyStore"/.test(store)
      && /TRANSFORM = "AES\/GCM\/NoPadding"/.test(store) && /setRandomizedEncryptionRequired\(true\)/.test(store)
      && /context\.noBackupFilesDir/.test(store),
    'every byte SessionStore writes is sealed by the Android Keystore (AES-GCM) into noBackupFilesDir',
    'SessionStore writes something not passed through box.seal, or its key is no longer a Keystore AES-GCM key, or it left noBackupFilesDir');
  const tokenMentions = hits(/refresh_token|refreshToken/).sort();
  check(JSON.stringify(tokenMentions) === JSON.stringify(['Auth.kt', 'AuthModels.kt', 'SessionStore.kt']),
    'the refresh token is handled in Auth.kt, AuthModels.kt and SessionStore.kt only',
    `the refresh token is touched in ${JSON.stringify(tokenMentions)} — a new place that holds it needs review here`);

  const auth = kt['Auth.kt'] || '';
  const calls = [...auth.matchAll(/refreshLocked\(\)/g)].length - 1; // minus the definition
  const locked = [...auth.matchAll(/mutex\.withLock \{[^}]*?refreshLocked\(\)/g)].length;
  check(calls >= 2 && calls === locked && !/private val mutex = Mutex\(\)[\s\S]*private val mutex/.test(auth),
    `every token refresh runs under the one Mutex (${locked} call site(s)) — a rotated token is never spent twice`,
    `refreshLocked() is called ${calls} time(s) but only ${locked} under mutex.withLock`);
  check(/private fun adopt\(grant: TokenGrant\): String \{\s*val aud = Claims\.audOf\(grant\.accessToken\)\s*store\.writeSession\(/.test(auth),
    'a new refresh token is stored before the new access token is used',
    'Auth.adopt no longer writes the session first — a crash after a refresh would leave only the spent token');
  check(/constantTimeEquals\(state, pending\.state\)/.test(auth) && /store\.clearPending\(\)/.test(auth),
    'sign-in checks the state against the pending attempt (and spends it)', 'Auth.completeSignIn no longer checks the state');
  const http = kt['Http.kt'] || '';
  check(/instanceFollowRedirects = false/.test(http) && /startsWith\("https:\/\/"\)/.test(http),
    'HTTP never follows a redirect and refuses http:', 'Http.kt follows redirects or accepts non-https URLs');
  // ── The Bearer token goes only to a derived base ──────────────────────────────────────
  // One transport (BearerClient) attaches it, to URLs under the root it was built for and
  // nowhere else. Two clients build one: AppApi, for `${an app's derived base}/api/`, and
  // AccountApi, for `${the derived auth origin}/auth/`. The player's data source asks KourOS's
  // client the same question. A base comes from shell.xml's generated list, so an app outside
  // native/shells.js's derivation has no base to call.
  const bearer = kt['BearerClient.kt'] || '';
  const appApi = kt['AppApi.kt'] || '';
  const accountApi = kt['AccountApi.kt'] || '';
  const svc = kt['PlaybackService.kt'] || '';
  const built = all.flatMap(([f, src]) => [...src.matchAll(/BearerClient\(([^)]*)\) \{ ([^}]*) \}/g)].map((m) => `${f}: ${m[2].trim()}`)).sort();
  check(/fun authorized\(url: String\): Boolean = url\.startsWith\(root\(\)\)/.test(bearer)
      && /internal suspend fun call\(method: String, target: String, json: String\? = null\): HttpResult = withContext\(Dispatchers\.IO\) \{\s*check\(authorized\(target\)\)/.test(bearer)
      && /val base: String get\(\) = Auth\.config\.apiBases\.getValue\(app\)/.test(appApi)
      && /private val origin: String get\(\) = Auth\.config\.authOrigin/.test(accountApi)
      && JSON.stringify(built) === JSON.stringify(['AccountApi.kt: "$origin/auth/"', 'AppApi.kt: "$base/api/"'])
      && [...all.map(([, src]) => [...src.matchAll(/BearerClient\(/g)].length)].reduce((a, b) => a + b, 0) === 3 // the class + two clients
      && /fun authorized\(url: String\): Boolean = client\.authorized\(url\)/.test(appApi)
      && /fun authorized\(url: String\): Boolean = api\.authorized\(url\)/.test(kt['KourosApi.kt'] || '')
      && /if \(!KourosApi\.authorized\(spec\.uri\.toString\(\)\)\) return spec/.test(svc),
    "a Bearer token is attached only to URLs under a derived base — an app's /api/ or jkAuth's /auth/ — by the two clients and the player alike",
    `BearerClient.authorized changed, a client is built for another root (${JSON.stringify(built)}), or the player data source attaches the token without asking`);
  const bearerFiles = hits(/"Bearer /).sort();
  check(JSON.stringify(bearerFiles) === JSON.stringify(['BearerClient.kt', 'PlaybackService.kt']),
    'the Authorization header is built in exactly two places (the transport and the player)',
    `"Bearer " appears in ${JSON.stringify(bearerFiles)}`);
  // jkAuth has no discovery doc; its declaration is the route catalog the prober reads
  // (packages/suite-prober/src/pathways.mjs). Every /auth/ path typed in the app's auth
  // package is a route in it, and the ones the app sends its TOKEN to are routes whose
  // jkAuth handler reads a Bearer user token (resolveCaller) — derived from jkAuth's source.
  const { PATHWAYS } = await import(resolve(root, 'packages/suite-prober/src/pathways.mjs'));
  const catalog = new Set(PATHWAYS.filter((p) => p.system === 'jkauth').map((p) => `${p.method} ${p.path}`));
  const catalogPaths = new Set([...catalog].map((r) => r.split(' ')[1]));
  const takesBearer = new Set(walk('apps/jkauth/src/routes', /\.js$/).flatMap((f) =>
    [...read(f).matchAll(/router\.(get|post|patch|delete)\('([^']+)', \(req, res\) => \{\s*(?:const isJson = isJsonReq\(req\)\s*)?const \w+ = resolveCaller\(req\)/g)]
      .map((m) => `${m[1].toUpperCase()} ${m[2]}`)));
  const authLiterals = walk(`${MOD}/src/main/java/net/jkos/app/alpha/auth`, /\.kt$/)
    .flatMap((f) => [...stripCode(read(f)).matchAll(/"(?:\$\{?[\w.]+\}?)?(\/auth\/[a-z0-9/_-]+)"/g)].map((m) => m[1]));
  const sent = [...accountApi.matchAll(/client\.call\("([A-Z]+)", "\$origin(\/auth\/[a-z/]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  const offCatalog = authLiterals.filter((p) => p !== '/auth/' && !catalogPaths.has(p));
  check(takesBearer.size >= 5 && sent.length >= 4 && sent.every((r) => takesBearer.has(r)) && sent.every((r) => catalog.has(r))
      && authLiterals.length >= 7 && offCatalog.length === 0
      && [...accountApi.matchAll(/client\.call\(/g)].length === sent.length,
    `the app sends its token to jkAuth only on routes that read a Bearer user token (${[...new Set(sent)].join(', ')}), and every /auth/ path it types is in jkAuth's route catalog`,
    `the app calls jkAuth outside what jkAuth offers a Bearer caller: sends to ${JSON.stringify(sent.filter((r) => !takesBearer.has(r) || !catalog.has(r)))}, off-catalog paths ${JSON.stringify(offCatalog)} (jkAuth reads a Bearer user token on ${JSON.stringify([...takesBearer])})`);
  const shellXml = read(`${MOD}/src/debug/res/values/shell.xml`);
  check(/apiBases = context\.resources\.getStringArray\(R\.array\.api_apps\)\s*\.zip\(context\.resources\.getStringArray\(R\.array\.api_bases\)\)\.toMap\(\)/.test(auth)
      && /<string-array name="api_apps">/.test(shellXml) && /<string-array name="api_bases">/.test(shellXml)
      && hits(/https?:\/\/[a-z0-9.-]*jkos\.net/i).length === 0,
    'every base the app calls comes from the generated shell.xml (no jkos.net URL is typed in the Kotlin)',
    `the app's API bases no longer come from shell.xml alone, or a jkos.net URL is typed in ${hits(/https?:\/\/[a-z0-9.-]*jkos\.net/i).join(', ')}`);

  // ── The app calls only declared routes ────────────────────────────────────────────────
  // Each app's client lives in its own Kotlin package, named after the app. Every "/api/…"
  // literal there is a dataset or capability that app declares (its discovery.js, by the same
  // rule the surface-coverage probe holds the backend to), or is on the short list below of
  // routes the app's own web client also uses undeclared. A route the native app needs that
  // isn't declared gets declared first.
  const { declaredPaths, pathMatches } = await import(resolve(root, 'packages/suite-prober/src/probes/98-surface-coverage.mjs'));
  const UNDECLARED_BY_DESIGN = {
    kouros: [
      { path: '/stream', web: 'apps/kouros/src/api.ts', why: 'the track stream: bytes, mounted by the @jkos/weave media brick' },
      { path: '/cover', web: 'apps/kouros/src/api.ts', why: 'a track\'s cover art: bytes, from the same brick' },
      { path: '/books/stream', web: 'apps/kouros/src/books/api.ts', why: 'a book file\'s stream: the same brick, mounted under /api/books (books/media.js)' },
      { path: '/books/cover', web: 'apps/kouros/src/books/api.ts', why: 'a book\'s cover art: the same brick, under /api/books' },
    ],
    beigeboard: [],
  };
  const DISCOVERY = { kouros: 'apps/kouros/backend/discovery.js', beigeboard: 'apps/beigeboard/backend/discovery.js' };
  const SRC = `${MOD}/src/main/java/net/jkos/app/alpha`;
  const nativeShell = shells.SHELLS.find((s) => s.android === 'native');
  const apiApps = shells.nativeConfig(nativeShell, 'debug').apiBases.map((b) => b.app);
  check(JSON.stringify(apiApps.slice().sort()) === JSON.stringify(Object.keys(DISCOVERY).sort())
      && apiApps.every((a) => Array.isArray(UNDECLARED_BY_DESIGN[a])),
    `the app reaches ${apiApps.join(' and ')}, and each has a declaration to be held to`,
    `the native app's derived API list is ${JSON.stringify(apiApps)} but this check knows ${JSON.stringify(Object.keys(DISCOVERY))} — add the app's discovery module here`);
  /** "/api/albums/tracks?album=${enc(a)}" → "/albums/tracks"; "/api/cover/$id" → "/cover/:p". */
  const routeOf = (literal) => {
    const path = literal.split('?')[0].replace(/\$qs\b/g, '').replace(/^\/api/, '');
    const segs = path.split('/').filter(Boolean).map((seg) => (/^\$(\w+|\{[^}]*\})$/.test(seg) ? ':p' : seg));
    return segs.some((seg) => seg.includes('$')) ? null : '/' + segs.join('/');
  };
  const problems = [];
  // For each exemption, the routes the app actually reaches through it.
  const used = Object.fromEntries(apiApps.map((a) => [a, new Map()]));
  let literalCount = 0;
  for (const app of apiApps) {
    const declared = [...declaredPaths(DISCOVERY[app])];
    for (const file of walk(`${SRC}/${app}`, /\.kt$/)) {
      for (const [, literal] of stripCode(read(file)).matchAll(/"(\/api\/[^"]*)"/g)) {
        literalCount++;
        const route = routeOf(literal);
        if (!route) { problems.push(`${file}: "${literal}" can't be read as a route — make each segment a literal or one variable`); continue; }
        const exempt = UNDECLARED_BY_DESIGN[app].find((e) => route === e.path || route.startsWith(e.path + '/'));
        if (exempt) { (used[app].get(exempt.path) ?? used[app].set(exempt.path, new Set()).get(exempt.path)).add(route); continue; }
        if (!declared.some((d) => pathMatches(route, d))) problems.push(`${file}: "${literal}" (${route}) is not declared in ${DISCOVERY[app]}`);
      }
    }
    for (const e of UNDECLARED_BY_DESIGN[app]) {
      if (!used[app].has(e.path)) problems.push(`the named list exempts ${app} ${e.path}, which the app no longer calls — remove it`);
      if (!read(e.web).includes(`/api${e.path}/`)) problems.push(`the named list exempts ${app} ${e.path} as a route its web client uses, but ${e.web} has no /api${e.path}/`);
      // Stale only when what the app calls through it is declared: the bare prefix can be covered
      // by a shallower declaration (/books covers /books/stream) while /books/stream/:id/:file isn't.
      const through = [...(used[app].get(e.path) ?? [])];
      if (through.length && through.every((r) => declared.some((d) => pathMatches(r, d)))) problems.push(`${app} ${e.path} is declared now (${through.join(', ')}) — take it off the named list`);
    }
  }
  // A reader by id asks in pieces no bigger than the server reads: a larger piece would be
  // cut short by the server, and those rows would be missing with nothing saying so.
  const { IN_MAX } = require(resolve(root, 'packages/weave/src/server/filters.js'));
  const idsMax = Number(/const val IDS_MAX = (\d+)/.exec(read(`${SRC}/kouros/KourosApi.kt`))?.[1]);
  check(idsMax === IN_MAX,
    `KourosApi asks for tracks by id ${IN_MAX} at a time, the most Weave's 'in' filter reads (IN_MAX)`,
    `KourosApi.IDS_MAX is ${idsMax} but Weave's IN_MAX is ${IN_MAX}: rows past ${IN_MAX} in a piece would be silently missing`);
  check(literalCount >= 8 && problems.length === 0,
    `every /api/… path in an app's Kotlin client is declared by that app or on the named list (${literalCount} literals; undeclared by design: ${apiApps.flatMap((a) => UNDECLARED_BY_DESIGN[a].map((e) => `${a} ${e.path}`)).join(', ')})`,
    `the native app calls a route its app doesn't declare:\n    ${problems.join('\n    ') || `only ${literalCount} /api/ literals found — the scan is not seeing the clients`}`);
  // A client is built for one app, inside that app's package, and no path is typed anywhere else.
  const stray = walk(SRC, /\.kt$/).filter((f) => !apiApps.some((a) => f.startsWith(`${SRC}/${a}/`)))
    .filter((f) => /"[^"]*\/api\/[a-z]/.test(stripCode(read(f))));
  const strayAuth = walk(SRC, /\.kt$/).filter((f) => !f.startsWith(`${SRC}/auth/`)).filter((f) => /"[^"]*\/auth\//.test(stripCode(read(f))));
  const clients = walk(SRC, /\.kt$/).flatMap((f) => [...stripCode(read(f)).matchAll(/AppApi\("([^"]*)"\)/g)].map((m) => ({ f, app: m[1] })));
  const misplaced = clients.filter((c) => !apiApps.includes(c.app) || !c.f.startsWith(`${SRC}/${c.app}/`));
  check(stray.length === 0 && strayAuth.length === 0 && clients.length >= 1 && misplaced.length === 0
      && walk(SRC, /\.kt$/).every((f) => !/AppApi\((?!")/.test(stripCode(read(f)).replace(/class AppApi\(/, ''))),
    `an app's client is built in that app's own package (${clients.map((c) => c.app).join(', ')}), and no API path is typed outside one`,
    `an API path or client is in the wrong place: ${[...stray, ...strayAuth, ...misplaced.map((c) => `${c.f} builds AppApi("${c.app}")`)].join(', ') || 'AppApi is built from a non-literal app id'}`);

  // ── A tab exists only for an app in the token's `aud` ─────────────────────────────────
  const tabs = kt['Tabs.kt'] || '';
  const shellKt = kt['Shell.kt'] || '';
  check(/fun forAud\(aud: Set<String>, apiApps: List<String>\): List<Tab> =\s*\(listOf\(Tab\.Home\) \+ apiApps\.map \{ Tab\.App\(it\) \} \+ Tab\.Account\)\.filter \{ it\.app in aud \}/.test(tabs)
      && /val tabs = remember\(aud\) \{ Tabs\.forAud\(aud, Auth\.config\.apiBases\.keys\.toList\(\)\)/.test(shellKt)
      && [...shellKt.matchAll(/Tabs\.forAud\(/g)].length === 1 && !/Tab\.App\("/.test(shellKt)
      && /val aud = Claims\.audOf\(grant\.accessToken\)/.test(auth),
    "the tabs are the token's aud: the shell draws only what Tabs.forAud returns, from the audience Auth read out of the access token",
    'Tabs.forAud no longer filters by aud, or Shell.kt builds a tab without it, or Auth no longer reads the audience from the token');

  // One play-context grammar: the Kotlin encoder's vectors pass the SERVER's parser here,
  // with JavaScript's own encodeURIComponent; the Kotlin test runs the same file under Gradle.
  const pc = JSON.parse(read('native/play-context-cases.json'));
  const { parsePlayContext, PLAY_CONTEXT_MAX } = require(resolve(root, 'apps/kouros/backend/src/playContext.js'));
  const enc = (v) => { try { return encodeURIComponent(v); } catch { return null; } };
  const wrong = pc.cases.filter((c) => {
    switch (c.kind) {
      case 'encode': return enc(c.input) !== c.expect;
      case 'album': { if (c.expect === null) return parsePlayContext(`album/${enc(c.artist)}/${enc(c.album)}`) !== null && c.artist !== '';
        const p = parsePlayContext(c.expect); return !p || p.artist !== c.artist || p.album !== c.album; }
      case 'artist': { if (c.expect === null) return c.artist !== '';
        const p = parsePlayContext(c.expect); return !p || p.artist !== c.artist; }
      case 'station': case 'playlist': case 'book': { if (c.expect === null) return parsePlayContext(`${c.kind}/${c.id}`) !== null;
        const p = parsePlayContext(c.expect); return !p || p.kind !== c.kind || p.id !== c.id; }
      default: return true;
    }
  });
  check(pc.maxLen === PLAY_CONTEXT_MAX && pc.cases.length >= 20 && wrong.length === 0,
    `play contexts: all ${pc.cases.length} vectors agree with encodeURIComponent and the server's parsePlayContext`,
    `play-context-cases.json disagrees with the server (maxLen ${pc.maxLen} vs ${PLAY_CONTEXT_MAX}):\n    ${wrong.map((c) => JSON.stringify(c).slice(0, 140)).join('\n    ')}`);
  const pcTest = read(`${MOD}/src/test/java/net/jkos/app/alpha/CoreTest.kt`);
  check(/System\.getProperty\("jkos\.playContextCases"\)/.test(pcTest) && /systemProperty\("jkos\.playContextCases", playContextCases\.absolutePath\)/.test(gradle)
      && /rootProject\.file\("\.\.\/play-context-cases\.json"\)/.test(gradle),
    'the Kotlin PlayContext test reads the same play-context-cases.json',
    'CoreTest.kt no longer reads native/play-context-cases.json — the encoder and the server can now drift apart');

  // The listening session: the role decision is the web's route.ts, run here on the shared
  // vectors (the JVM test runs the Kotlin on the same file); every state body the app would
  // report is one the server's validate.js accepts.
  const { transpile } = await import(resolve(root, 'test/lib/unit.mjs'));
  const routeJs = transpile(read('apps/kouros/src/session/route.ts'), 'route.ts');
  const { modeOf } = await import(`data:text/javascript;base64,${Buffer.from(routeJs).toString('base64')}`);
  const modes = JSON.parse(read('native/session-mode-cases.json')).cases;
  const modeWrong = modes.filter((c) => modeOf(c.facts) !== c.expect);
  check(modes.length >= 8 && modeWrong.length === 0,
    `session roles: all ${modes.length} vectors agree with the web's route.ts modeOf`,
    `session-mode-cases.json disagrees with route.ts:\n    ${modeWrong.map((c) => `${JSON.stringify(c.facts)} → ${modeOf(c.facts)}, expected ${c.expect}`).join('\n    ')}`);
  const V = require(resolve(root, 'apps/kouros/backend/src/session/validate.js'));
  const states = JSON.parse(read('native/session-state-cases.json'));
  const refused = states.cases.map((c) => [c.name, V.stateReport(c.expect)]).filter(([, r]) => !r.ok || V.deviceId(states.deviceId) == null);
  check(states.cases.length >= 6 && refused.length === 0,
    `session reports: all ${states.cases.length} bodies the app builds are accepted by validate.js stateReport`,
    `validate.js refuses a body the app would report:\n    ${refused.map(([n, r]) => `${n}: ${r.error}`).join('\n    ')}`);
  const cmds = JSON.parse(read('native/session-command-cases.json'));
  const cmdRefused = cmds.cases.map((c) => [c.name, V.command({ op: c.op, args: c.args, from: cmds.from })])
    .filter(([, r]) => !r.ok);
  check(cmds.cases.length >= 10 && cmdRefused.length === 0,
    `session commands: all ${cmds.cases.length} the app sends are accepted by validate.js command`,
    `validate.js refuses a command the app would send:\n    ${cmdRefused.map(([n, r]) => `${n}: ${r.error}`).join('\n    ')}`);
  check(/System\.getProperty\(prop\)/.test(pcTest) && ['sessionModeCases', 'sessionStateCases', 'sessionCommandCases'].every((k) => pcTest.includes(`cases("jkos.${k}")`)
      && new RegExp(`systemProperty\\("jkos\\.${k}", ${k}\\.absolutePath\\)`).test(gradle)),
    'the Kotlin session tests read the same three case files',
    'CoreTest.kt or the Gradle wiring no longer reads native/session-{mode,state,command}-cases.json — the app and the server can drift apart');
}

// ── 8. Native sign-in reaches the right jkAuth, through the edge ─────────────
{
  const stagingCompose = read('apps/jkauth/docker-compose.staging.yml');
  const prodCompose = read('apps/jkauth/docker-compose.yml');
  check(/^\s*JKOS_NATIVE_ENV:\s*"?staging"?\s*$/m.test(stagingCompose) && !/JKOS_NATIVE_ENV/.test(prodCompose),
    'staging jkAuth signs in the staging native clients; production none (JKOS_NATIVE_ENV unset)',
    'JKOS_NATIVE_ENV is missing from staging jkAuth, or set on production — a debug-signed build could sign in against prod');
  const gate = (/location = \/_auth_admin_check \{([\s\S]*?)\n\s*\}/.exec(read('infra/nginx/standalone.conf')) || [])[1] || '';
  check(/proxy_set_header\s+Authorization\s+\$http_authorization;/.test(gate),
    'the staging edge gate forwards Authorization (a native app\'s Bearer token) to jkAuth',
    '/_auth_admin_check no longer forwards Authorization — every staging native app request would 401 at the edge');
  const native = shells.SHELLS.filter((s) => s.android === 'native');
  const stagingRoutes = read('infra/nginx/standalone.conf') + read('infra/nginx/apps-generated-staging.conf');
  const bases = native.flatMap((s) => shells.nativeConfig(s, 'debug').apiBases.map((b) => b.base));
  const unrouted = bases
    .filter((b) => !new RegExp(`location\\s+${new URL(b + '/').pathname.replace(/\//g, '\\/')}\\s*\\{`).test(stagingRoutes));
  check(native.length > 0 && bases.length > 0 && unrouted.length === 0,
    `every native app's staging API base is routed (${bases.join(', ')})`,
    native.length ? `a native app's staging API base is not routed: ${unrouted.join(', ') || 'it has none'}` : 'no native shell declared');
}

if (failed) {
  console.error(`\nnative: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nnative: all shells conform');
