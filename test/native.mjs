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
//
// The generated files (per-variant origins, shells.json) are held by
// `node native/gen-native.mjs --check`, which runs first in the same check:native script.
//
// Run:  node test/native.mjs        (wired as `pnpm check:native`, folded into
//                                    `pnpm test:contracts`)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
  const MANIFESTS = { twa: 'native/android/twa/src/main/AndroidManifest.xml', home: 'native/android/home/src/main/AndroidManifest.xml' };
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
  check(/android:networkSecurityConfig="@xml\/network_security_config"/.test(m.home),
    'jkOS Home carries a network security config', 'jkOS Home lost its networkSecurityConfig');
  const nsc = stripXml(read('native/android/home/src/main/res/xml/network_security_config.xml'));
  check(/<base-config cleartextTrafficPermitted="false">/.test(nsc) && /<certificates src="system" \/>/.test(nsc)
      && !/src="user"/.test(nsc) && !/<domain-config|<debug-overrides/.test(nsc),
    'network security: https only, system CAs only, no per-domain or debug exceptions',
    'network_security_config.xml allows cleartext, trusts user CAs, or carves out an exception');
  check(/<activity\s+android:name="\.DrawerActivity"[^>]*android:exported="false"/.test(m.home),
    'the app drawer is not exported (no other app can open it)', 'DrawerActivity is exported');
  check(/FALLBACK_STRATEGY"\s+android:value="customtabs"/.test(m.twa),
    'TWA fallback is a Custom Tab, never an in-app WebView the APK would own',
    'TWA FALLBACK_STRATEGY is no longer customtabs');
}

// ── 4. Android WebView source ────────────────────────────────────────────────
{
  const src = walk('native/android', /\.(kt|java)$/).filter((p) => !/\/src\/test\//.test(p)).map((p) => [p, stripCode(read(p))]);
  check(src.length >= 5, `scanned ${src.length} Android source files`, `found only ${src.length} Android source files — the walk is not seeing the code`);
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

if (failed) {
  console.error(`\nnative: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nnative: all shells conform');
