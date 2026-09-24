// session/device.ts — who THIS device is, to the listening session.
//
// The id is a UUID the device makes itself (crypto.randomUUID) and keeps in
// localStorage, so every tab of one browser is one device and a reload is the same
// device. It names nothing outside this listener: the server keys devices by
// (user, id), so a guessed id can at most name one of your own devices.
//
// The NAME is only a default ("Chrome on Android") — the listener renames a device
// in the picker, and the server keeps a chosen name over the default every boot
// re-sends. The naming and kind functions are PURE (the UA is a parameter) so the
// test drives them without a browser.

export type DeviceKind = 'desktop' | 'phone' | 'tablet';

export interface DeviceIdentity {
  id: string;
  name: string;
  kind: DeviceKind;
  platform: string;
}

const ID_KEY = 'kouros.device.id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The browser, as a person would say it. Order matters: Edge and Opera carry
 *  "Chrome/" too, and Chrome carries "Safari/". */
export function browserName(ua: string): string {
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

/** The platform. ⚠️ iPadOS asks for desktop sites, so an iPad's UA says
 *  "Macintosh" — only a touch screen (`touch`) tells it from a Mac. */
export function platformName(ua: string, touch = false): string {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'iPad';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

export function deviceKind(ua: string, touch = false): DeviceKind {
  const platform = platformName(ua, touch);
  if (platform === 'iPhone') return 'phone';
  if (platform === 'iPad') return 'tablet';
  // Android phones say "Mobile"; an Android tablet's browser does not.
  if (platform === 'Android') return /Mobile/.test(ua) ? 'phone' : 'tablet';
  return 'desktop';
}

/** "Chrome on Android" — at most 60 characters, the server's limit. */
export function defaultDeviceName(ua: string, touch = false): string {
  return `${browserName(ua)} on ${platformName(ua, touch)}`.slice(0, 60);
}

let memoryId: string | null = null;

/** This device's id — made once, then read back. Falls back to a per-page id when
 *  storage is unavailable (private mode): the device is then new every load, which
 *  is honest, if untidy in the device list (unseen devices are forgotten in 90 days). */
export function deviceId(): string {
  try {
    const kept = localStorage.getItem(ID_KEY);
    if (kept && UUID.test(kept)) return kept.toLowerCase();
    const made = crypto.randomUUID();
    localStorage.setItem(ID_KEY, made);
    return made;
  } catch {
    return (memoryId ??= crypto.randomUUID());
  }
}

export function deviceIdentity(): DeviceIdentity {
  const ua = navigator.userAgent;
  // maxTouchPoints > 1 separates an iPad (5) from a Mac with no touch screen (0).
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  return {
    id: deviceId(),
    name: defaultDeviceName(ua, touch),
    kind: deviceKind(ua, touch),
    platform: platformName(ua, touch),
  };
}
