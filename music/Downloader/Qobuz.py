#!/usr/bin/env python3
import os
import re
import sys
import glob
import time
import shutil
import logging
import unicodedata
import hashlib
import random
import getpass
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass

# ==========================================
# PRODUCTION CONFIGURATION
# ==========================================
QOBUZ_EMAIL = "jaaggruthos@gmail.com"
QOBUZ_PASSWORD = "2r59Jw-N75F^C?m"

BATCH_FOLDER = "/media/jag/The Forge/FLAC Downloader/"
OUTPUT_FOLDER = "/mnt/Luna/Plex/Music/"

# Download Settings
FORMAT_ID = 27 # 27 = Hi-Res, 7 = 24-bit/<96kHz, 6 = CD, 5 = MP3
API_DELAY_MIN = 2.0
API_DELAY_MAX = 5.0
# ==========================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("RobustDL")

try:
    import requests
except ImportError:
    logger.error("Missing dependency: requests. Run `pip install requests`")
    sys.exit(1)

try:
    from mutagen.flac import FLAC, Picture
    from mutagen.id3 import ID3, TIT2, TPE1, TALB, TRCK, TPOS, TDRC, APIC, error as ID3Error
    MUTAGEN_AVAILABLE = True
except ImportError:
    logger.warning("Missing dependency: mutagen. Tagging disabled. Run `pip install mutagen`")
    MUTAGEN_AVAILABLE = False

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

# Known web secrets to pair with the dynamically scraped App ID
KNOWN_APPS = {
    "715974052": "b4ef551d0728c3101dccabf8b8a78bf9", # Standard Web Player
    "798273057": "806331c3b0b641da923b890aed01d04a", # Desktop App
}

class TokenExtractor:
    """Automates a browser to intercept secure web tokens directly from Qobuz network traffic."""
    @staticmethod
    def get_credentials(email: str, password: str) -> Tuple[Optional[str], Optional[str]]:
        if not PLAYWRIGHT_AVAILABLE:
            logger.error("Playwright is missing. Run: pip install playwright && playwright install chromium")
            return None, None

        print("\n[INFO] Launching automated browser to grab fresh tokens...")
        print("[INFO] (If you see a Captcha, please solve it. The script is watching the network invisibly!)")

        app_id = None
        auth_token = None

        with sync_playwright() as p:
            # headless=False allows the user to see the login and solve captchas if needed
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={'width': 1280, 'height': 800})
            page = context.new_page()

            def handle_request(request):
                nonlocal app_id, auth_token
                # Listen for the exact API calls Qobuz makes
                if "api.json" in request.url:
                    headers = request.headers
                    if 'x-app-id' in headers and 'x-user-auth-token' in headers:
                        app_id = headers['x-app-id']
                        auth_token = headers['x-user-auth-token']

            # Attach the network listener
            page.on("request", handle_request)

            try:
                page.goto("https://play.qobuz.com/login")
                page.wait_for_load_state("networkidle")

                try:
                    page.fill('input[type="email"]', email, timeout=3000)
                    page.fill('input[type="password"]', password, timeout=3000)
                    page.click('button[type="submit"]', timeout=3000)
                except Exception:
                    print("[WARNING] Could not auto-fill. Please log in manually in the browser window.")

                print("[INFO] Waiting for authentication...")

                for _ in range(120): # Wait up to 2 minutes for user to potentially solve captchas
                    if auth_token and app_id:
                        print(f"\n[SUCCESS] Intercepted Live App ID: {app_id}")
                        print(f"[SUCCESS] Intercepted Auth Token: {auth_token[:10]}...{auth_token[-5:]}\n")
                        break
                    page.wait_for_timeout(1000)
            except Exception as e:
                print(f"[ERROR] Browser automation error: {e}")
            finally:
                browser.close()

        return app_id, auth_token

class Sanitizer:
    """Handles aggressive sanitization of hostile metadata for safe file system operations."""
    @staticmethod
    def sanitize_filename(name: str, max_length: int = 50) -> str:
        if not name: return "Unknown"
        name = unicodedata.normalize('NFKD', str(name))
        replacements = {'/': '-', '\\': '-', ':': ' -', '*': 'x', '?': '', '"': "'", '<': '[', '>': ']', '|': '-'}
        for bad, good in replacements.items(): name = name.replace(bad, good)
        name = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', name)

        reserved_names = {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "LPT1"}
        base_name = name.split('.')[0].upper()
        if base_name in reserved_names: name = f"_{name}"
        if len(name) > max_length: name = name[:max_length].strip(' .')
        return name.strip(' .') or "Unknown"

    @staticmethod
    def build_safe_path(base_dir: str, artist: str, album: str, filename: str) -> str:
        return os.path.join(
            base_dir,
            Sanitizer.sanitize_filename(artist),
            Sanitizer.sanitize_filename(album),
            Sanitizer.sanitize_filename(filename, max_length=80)
        )

@dataclass
class SafeTrackMeta:
    """A bulletproof data model for track metadata with guaranteed fallbacks."""
    id: str
    title: str
    artist: str
    album: str
    track_number: int
    total_tracks: int
    disc_number: int
    duration: int
    release_year: str
    cover_url: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any], album_data: Dict[str, Any] = None, fallback_track_num: int = 1):
        if album_data is None: album_data = {}

        try: track_num = int(data.get("track_number") or fallback_track_num)
        except (ValueError, TypeError): track_num = fallback_track_num

        try: disc_num = int(data.get("media_number") or 1)
        except (ValueError, TypeError): disc_num = 1

        title = data.get("title") or "Unknown Title"
        artist = (data.get("performer") or {}).get("name") or (album_data.get("artist") or {}).get("name") or "Unknown Artist"
        album_title = album_data.get("title") or "Unknown Album"

        release_date = album_data.get("release_date_original") or album_data.get("release_date") or "0000"
        year = str(release_date)[:4]

        return cls(
            id=str(data.get("id", "00000")),
            title=title, artist=artist, album=album_title,
            track_number=track_num, total_tracks=int(album_data.get("tracks_count") or 1),
            disc_number=disc_num, duration=int(data.get("duration") or 0),
            release_year=year, cover_url=(album_data.get("image") or {}).get("large", "")
        )

class QobuzAPI:
    """Handles authentication bypass, metadata fetching, and track URLs."""
    BASE_URL = "https://www.qobuz.com/api.json/0.2"

    def __init__(self, app_id: str, app_secret: str, auth_token: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.session = requests.Session()
        self.session.headers.update({
            "x-app-id": self.app_id,
            "x-user-auth-token": auth_token,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        })

    def _make_request(self, endpoint: str, params: Dict[str, Any], max_retries: int = 3) -> Dict[str, Any]:
        url = f"{self.BASE_URL}/{endpoint}"

        # Critical Fix: Qobuz now requires app_id in the URL parameters for EVERY request
        params['app_id'] = self.app_id

        for attempt in range(max_retries):
            try:
                resp = self.session.get(url, params=params, timeout=(10, 30))

                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 15))
                    logger.warning(f"Rate limited. Sleeping for {retry_after}s...")
                    time.sleep(retry_after)
                    continue

                if resp.status_code in (401, 403):
                    logger.error(f"HTTP {resp.status_code}: Your Auth Token was rejected. It may be expired.")
                    return {}

                if not resp.ok:
                    if 400 <= resp.status_code < 500:
                        logger.error(f"API HTTP {resp.status_code}: {resp.text}")
                        return {}
                    resp.raise_for_status()

                try: return resp.json()
                except ValueError: pass

            except requests.RequestException: pass
            time.sleep(2 ** attempt)

        logger.error(f"API request failed: {endpoint}")
        return {}

    def search_album(self, artist: str, album: str) -> Optional[str]:
        # Qobuz search can be overly literal, try exact album+artist, then just album
        queries = [f"{album} {artist}", album]

        for query in queries:
            logger.info(f"Searching Qobuz for: {query}")
            data = self._make_request("catalog/search", params={"query": query, "type": "albums", "limit": 1})

            items = data.get("albums", {}).get("items", [])
            if items:
                album_id = items[0].get("id")
                matched_title = items[0].get("title", "")
                matched_artist = (items[0].get("artist") or {}).get("name", "")
                logger.info(f" -> Found Match: '{matched_artist} - {matched_title}' (ID: {album_id})")
                return album_id

            time.sleep(1.0) # brief pause before fallback search

        logger.warning(f" -> No results found for: {artist} - {album}")
        return None

    def get_album(self, album_id: str) -> Dict[str, Any]:
        return self._make_request("album/get", params={"album_id": album_id})

    def _sign_request(self, method_name: str, params: Dict[str, Any]) -> str:
        sig_str = method_name.replace("/", "")
        for key in sorted(params.keys()): sig_str += f"{key}{params[key]}"
        sig_str += self.app_secret
        return hashlib.md5(sig_str.encode('utf-8')).hexdigest()

    def get_track_url(self, track_id: str, format_id: int) -> str:
        params = {
            "track_id": track_id,
            "format_id": format_id,
            "intent": "stream",
            "request_ts": str(int(time.time()))
        }
        # App ID must be in the params BEFORE signing
        params["app_id"] = self.app_id
        params["request_sig"] = self._sign_request("track/getFileUrl", params)
        data = self._make_request("track/getFileUrl", params=params)
        return data.get("url", "")

class RobustDownloader:
    @staticmethod
    def download_file(url: str, final_path: str, max_retries: int = 3) -> bool:
        if not url: return False
        temp_path = f"{final_path}.part"
        os.makedirs(os.path.dirname(final_path), exist_ok=True)

        if os.path.exists(final_path): return True

        for attempt in range(max_retries):
            try:
                with requests.get(url, stream=True, timeout=(15, 60)) as r:
                    r.raise_for_status()
                    total_size = int(r.headers.get('content-length', 0))

                    with open(temp_path, 'wb') as f:
                        downloaded = 0
                        last_printed = 0

                        for chunk in r.iter_content(chunk_size=8192):
                            if chunk:
                                f.write(chunk)
                                downloaded += len(chunk)
                                if total_size > 0 and (downloaded - last_printed) >= 8192 * 150:
                                    pct = (downloaded / total_size) * 100
                                    sys.stdout.write(f"\r    Downloading... {pct:.1f}%")
                                    sys.stdout.flush()
                                    last_printed = downloaded

                sys.stdout.write("\r    Downloading... 100%   \n")
                os.replace(temp_path, final_path)
                return True
            except Exception as e:
                logger.warning(f"Download failed (Attempt {attempt + 1}): {e}")
                if os.path.exists(temp_path): os.remove(temp_path)
                time.sleep(2 ** attempt)

        return False

class Tagger:
    @staticmethod
    def tag_file(filepath: str, meta: SafeTrackMeta, cover_path: Optional[str] = None):
        if not MUTAGEN_AVAILABLE or not os.path.exists(filepath): return
        ext = filepath.lower().rsplit('.', 1)[-1]

        try:
            if ext == "flac":
                audio = FLAC(filepath)
                audio.delete()
                audio["TITLE"] = meta.title
                audio["ARTIST"] = meta.artist
                audio["ALBUM"] = meta.album
                audio["TRACKNUMBER"] = str(meta.track_number)
                audio["TRACKTOTAL"] = str(meta.total_tracks)
                audio["DISCNUMBER"] = str(meta.disc_number)
                audio["DATE"] = meta.release_year

                if cover_path and os.path.exists(cover_path):
                    try:
                        pic = Picture()
                        with open(cover_path, "rb") as f: pic.data = f.read()
                        pic.type = 3
                        pic.mime = "image/jpeg" if cover_path.lower().endswith(".jpg") else "image/png"
                        audio.add_picture(pic)
                    except Exception: pass
                audio.save()
        except Exception as e:
            logger.error(f"Failed to tag {filepath}: {e}")

def process_album(api: QobuzAPI, album_id: str, base_dir: str, failed_items: List[Dict[str, str]]):
    raw_album = api.get_album(album_id)
    if not raw_album:
        failed_items.append({"type": "Album Data", "name": f"ID {album_id}", "reason": "Failed to fetch metadata"})
        return

    tracks_raw = raw_album.get("tracks", {}).get("items", [])
    if not tracks_raw: return

    safe_artist = Sanitizer.sanitize_filename((raw_album.get("artist") or {}).get("name") or "Unknown Artist")
    safe_album_title = Sanitizer.sanitize_filename(raw_album.get("title", "Unknown Album"))

    cover_path = None
    cover_url = (raw_album.get("image") or {}).get("large")
    if cover_url:
        cover_path = Sanitizer.build_safe_path(base_dir, safe_artist, safe_album_title, "cover.jpg")
        RobustDownloader.download_file(cover_url, cover_path)

    ext = "mp3" if FORMAT_ID == 5 else "flac"

    for index, track_raw in enumerate(tracks_raw, start=1):
        meta = SafeTrackMeta.from_dict(track_raw, album_data=raw_album, fallback_track_num=index)
        filename = f"{meta.track_number:02d} - {meta.title}.{ext}"
        final_path = Sanitizer.build_safe_path(base_dir, safe_artist, safe_album_title, filename)

        logger.info(f"  -> Track {meta.track_number}: {meta.title}")
        if index > 1: time.sleep(random.uniform(0.5, 1.5))

        track_url = api.get_track_url(meta.id, format_id=FORMAT_ID)
        if not track_url:
            failed_items.append({"type": "Track Stream", "name": filename, "reason": "No stream URL available"})
            continue

        if RobustDownloader.download_file(track_url, final_path):
            Tagger.tag_file(final_path, meta, cover_path)
        else:
            failed_items.append({"type": "Download Error", "name": filename, "reason": "Failed after retries"})

def parse_batch_line(line: str) -> Tuple[Optional[str], Optional[str]]:
    main_part = line.split('|')[0].strip()
    if ' - ' in main_part:
        parts = main_part.rsplit(' - ', 1)
        album, artist_and_year = parts[0].strip(), parts[1].strip()
        artist = artist_and_year.rsplit(',', 1)[0].strip()
        return album, artist
    return None, None

def process_batch(api: QobuzAPI, batch_folder: str, output_folder: str) -> List[Dict[str, str]]:
    failed_items = []
    files = glob.glob(os.path.join(batch_folder, "*.md")) + glob.glob(os.path.join(batch_folder, "*.txt"))

    for file_path in files:
        logger.info(f"==== STARTING BATCH FILE: {os.path.basename(file_path)} ====")
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'): continue

                album, artist = parse_batch_line(line)
                if not album or not artist: continue

                album_id = api.search_album(artist, album)
                if album_id:
                    process_album(api, album_id, output_folder, failed_items)
                else:
                    failed_items.append({"type": "Search", "name": f"{artist} - {album}", "reason": "Not found"})

                time.sleep(random.uniform(API_DELAY_MIN, API_DELAY_MAX))

    return failed_items

def main():
    print("=========================================================")
    print(" Qobuz Native Batch Downloader (Automated Browser Edition) ")
    print("=========================================================\n")

    email = QOBUZ_EMAIL or input("Qobuz Email: ").strip()
    password = QOBUZ_PASSWORD or getpass.getpass("Qobuz Password: ").strip()

    # Let Playwright do the heavy lifting!
    app_id, auth_token = TokenExtractor.get_credentials(email, password)

    if not app_id or not auth_token:
        print("\n[!] Failed to extract authentication tokens. Exiting.")
        sys.exit(1)

    app_secret = KNOWN_APPS.get(app_id, "b4ef551d0728c3101dccabf8b8a78bf9")
    api = QobuzAPI(app_id=app_id, app_secret=app_secret, auth_token=auth_token)

    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    logger.info("Starting Native Batch Processor...")

    try:
        failed_items = process_batch(api, BATCH_FOLDER, OUTPUT_FOLDER)
    except KeyboardInterrupt:
        logger.warning("\n[!] Interrupted by user. Generating report...")
        failed_items = []

    logger.info("Batch Processing Complete!")

    if failed_items:
        print("\n=========================================")
        print(" ⚠️  DOWNLOAD ERRORS REPORT")
        print("=========================================")
        for item in failed_items:
            print(f"[{item['type']}] {item['name']}\n    Reason: {item['reason']}\n")
    else:
        print("\n=========================================")
        print(" 🎉 ALL DOWNLOADS COMPLETED SUCCESSFULLY!")
        print("=========================================\n")

if __name__ == "__main__":
    main()
