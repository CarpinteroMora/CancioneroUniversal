#!/usr/bin/env python3
"""Cancionero Universal — servidor local.

Sirve la app en http://127.0.0.1:8777/ y extrae el audio de enlaces de YouTube y de
cualquier plataforma que soporte yt-dlp, para reproducirlo en la barra de audio.

API:
  GET /api/estado                      -> estado del servidor y de las herramientas
  GET /api/preparar?url=URL&pref=webm  -> extrae el audio (queda en caché) y devuelve sus datos
  GET /api/audio?url=URL&pref=webm     -> entrega el audio (con soporte de "Range" para adelantar)
  GET /api/hoja?url=URL                -> descarga una partitura o tablatura de otra web (sin CORS)

La caché de audios no pasa de CACHE_MAX_MB: se borran los menos usados (se vuelven a
descargar solos si se reproducen otra vez).

Uso:
  python3 canciotras_servidor.py               abre Cancionero Universal en una ventana tipo app
  python3 canciotras_servidor.py --instalar    lo deja funcionando en segundo plano para siempre
                                               (se inicia solo al usar la app) y crea el acceso directo
  python3 canciotras_servidor.py --desinstalar quita lo anterior
  python3 canciotras_servidor.py --no-abrir    solo inicia el servidor
Solo usa la biblioteca estándar de Python (3.8+).
"""

import argparse
import hashlib
import http.server
import json
import mimetypes
import os
import platform
import re
import shutil
import socket
import socketserver
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile

VERSION = "1.0.0"
IS_WINDOWS = os.name == "nt"
# Empaquetado con PyInstaller (instalador de Windows): la app viaja dentro del ejecutable y lo
# que se descarga (yt-dlp, Deno) va a la carpeta de datos del usuario, junto a la copia instalada.
FROZEN = getattr(sys, "frozen", False)
if FROZEN:
    APP_DIR = sys._MEIPASS
    HERE = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share"), "Cancionero Universal")
    INSTALLED_EXE = os.path.join(HERE, "CancioneroUniversal.exe" if IS_WINDOWS else "CancioneroUniversal")
    RUNNING_INSTALLED = os.path.normcase(os.path.abspath(sys.executable)) == os.path.normcase(INSTALLED_EXE)
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
    APP_DIR = os.path.dirname(HERE)
BIN_DIR = os.path.join(HERE, "bin")
OLD_CACHE_DIR = os.path.join(HERE, "cache")
# En Windows, que yt-dlp no abra ventanas de consola al trabajar en segundo plano
NO_WINDOW = {"creationflags": 0x08000000} if IS_WINDOWS else {}
IDLE_SECONDS = 20 * 60
UPDATE_EVERY = 5 * 24 * 3600
CACHE_MAX_MB = 500          # los audios menos usados se borran al pasar de este tamaño
SHEET_MAX_BYTES = 30 * 1024 * 1024
LITE_KBPS = 48              # audio "liviano" para incrustar en páginas exportadas (AAC mono)
LITE_MAX_BYTES = 600 * 1024 * 1024
LITE_KEEP_DAYS = 30
MEDIA_EXTS = {"mp3", "ogg", "oga", "opus", "wav", "m4a", "aac", "flac", "weba", "wma", "amr",
              "mp4", "m4v", "webm", "mov", "mkv", "ogv", "3gp", "avi", "mpeg", "mpg"}
FFMPEG = shutil.which("ffmpeg")

# Sin Python a mano (empaquetado) se usa el yt-dlp autónomo de cada sistema
YTDLP_NAME = ("yt-dlp.exe" if IS_WINDOWS else "yt-dlp_macos" if sys.platform == "darwin" else "yt-dlp_linux") if FROZEN else "yt-dlp"
YTDLP_URL = f"https://github.com/yt-dlp/yt-dlp/releases/latest/download/{YTDLP_NAME}"
DENO_ASSETS = {
    ("linux", "x86_64"): "deno-x86_64-unknown-linux-gnu.zip",
    ("linux", "aarch64"): "deno-aarch64-unknown-linux-gnu.zip",
    ("darwin", "x86_64"): "deno-x86_64-apple-darwin.zip",
    ("darwin", "arm64"): "deno-aarch64-apple-darwin.zip",
    ("windows", "amd64"): "deno-x86_64-pc-windows-msvc.zip",
}
FORMATS = {
    "webm": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
    "m4a": "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best",
}

mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/webm", ".webm")
mimetypes.add_type("audio/ogg", ".opus")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def log(msg):
    print(f"[Cancionero Universal] {msg}", flush=True)


# ============ HERRAMIENTAS (yt-dlp y motor JavaScript) ============

def download(url, dest):
    log(f"Descargando {url} …")
    with urllib.request.urlopen(url, timeout=120) as r, open(dest + ".tmp", "wb") as f:
        shutil.copyfileobj(r, f)
    os.replace(dest + ".tmp", dest)


def make_executable(path):
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def ensure_ytdlp(update=False):
    """Usa una copia propia y actualizada de yt-dlp (la de los repositorios suele estar vieja)."""
    os.makedirs(BIN_DIR, exist_ok=True)
    local = os.path.join(BIN_DIR, YTDLP_NAME)
    if not os.path.exists(local):
        try:
            download(YTDLP_URL, local)
            make_executable(local)
        except (urllib.error.URLError, OSError) as e:
            log(f"No se pudo descargar yt-dlp: {e}")
    if os.path.exists(local):
        cmd = [local] if FROZEN else [sys.executable, local]
        if update:
            subprocess.run(cmd + ["-U"], check=False, **NO_WINDOW)
        return cmd
    if shutil.which("yt-dlp"):
        log("Usando el yt-dlp del sistema (puede estar desactualizado).")
        return [shutil.which("yt-dlp")]
    return None


def node_version(path):
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10, **NO_WINDOW).stdout
        return int(re.match(r"v?(\d+)", out.strip()).group(1))
    except Exception:
        return 0


def ensure_js_runtime():
    """YouTube necesita un motor JavaScript: Deno (recomendado) o Node 22+."""
    exe = "deno.exe" if IS_WINDOWS else "deno"
    local = os.path.join(BIN_DIR, exe)
    if os.path.exists(local):
        return ["--js-runtimes", f"deno:{local}"], "deno (incluido)"
    if shutil.which("deno"):
        return ["--js-runtimes", f"deno:{shutil.which('deno')}"], "deno (sistema)"
    node = shutil.which("node")
    if node and node_version(node) >= 22:
        return ["--js-runtimes", f"node:{node}"], "node (sistema)"
    system = platform.system().lower()
    machine = platform.machine().lower()
    asset = DENO_ASSETS.get((system, machine))
    if asset:
        try:
            zpath = local + ".zip"
            download(f"https://github.com/denoland/deno/releases/latest/download/{asset}", zpath)
            with zipfile.ZipFile(zpath) as z:
                z.extract(exe, BIN_DIR)
            os.remove(zpath)
            make_executable(local)
            return ["--js-runtimes", f"deno:{local}"], "deno (incluido)"
        except (urllib.error.URLError, OSError, KeyError) as e:
            log(f"No se pudo descargar Deno: {e}")
    log("Sin motor JavaScript: YouTube puede fallar o tener menos formatos.")
    return [], "ninguno"


# ============ EXTRACCIÓN CON CACHÉ ============

class Extractor:
    def __init__(self, cache_dir, ytdlp_cmd, js_args, js_name, cache_max_mb=CACHE_MAX_MB):
        self.cache_dir = cache_dir
        self.ytdlp = ytdlp_cmd
        self.js_args = js_args
        self.js_name = js_name
        self.cache_max = cache_max_mb * 1024 * 1024
        self.jobs = {}
        self.jobs_lock = threading.Lock()
        self.in_use = {}          # archivo -> cuántas reproducciones lo están leyendo
        self._version = None
        self.lite_lock = threading.Lock()
        self.lite_dir = os.path.join(cache_dir, "liviano")
        os.makedirs(cache_dir, exist_ok=True)
        self.trim_lite()

    def trim_lite(self):
        """Los audios livianos se borran si no se usan en un mes (se rehacen solos)."""
        if not os.path.isdir(self.lite_dir):
            return
        limit = time.time() - LITE_KEEP_DAYS * 86400
        for name in os.listdir(self.lite_dir):
            path = os.path.join(self.lite_dir, name)
            try:
                if os.path.getmtime(path) < limit or ".tmp" in name:
                    os.remove(path)
            except OSError:
                pass

    def lite_path(self, key):
        return os.path.join(self.lite_dir, key + ".m4a")

    def make_lite(self, src, key):
        """Comprime un audio o video a AAC mono liviano (.m4a), que suena en cualquier celular."""
        out = self.lite_path(key)
        with self.lite_lock:
            if os.path.exists(out):
                os.utime(out)
                return out
            if not FFMPEG:
                raise RuntimeError("Falta ffmpeg para comprimir el audio.")
            os.makedirs(self.lite_dir, exist_ok=True)
            tmp = out + ".tmp.m4a"
            r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-map_metadata", "-1",
                                "-ac", "1", "-c:a", "aac", "-b:a", f"{LITE_KBPS}k", "-movflags", "+faststart", tmp],
                               capture_output=True, text=True, timeout=900, **NO_WINDOW)
            if r.returncode != 0 or not os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                log(f"ffmpeg: {(r.stderr or '').strip()[-300:]}")
                raise RuntimeError("No se pudo comprimir el audio.")
            os.replace(tmp, out)
            log(f"Audio liviano: {os.path.getsize(out) // 1024} KB")
            return out

    def use(self, name, delta):
        with self.jobs_lock:
            n = self.in_use.get(name, 0) + delta
            if n > 0:
                self.in_use[name] = n
            else:
                self.in_use.pop(name, None)

    def trim_cache(self):
        """Borra los audios usados hace más tiempo hasta que la caché quede bajo el límite.
        Nunca borra uno que se esté descargando o reproduciendo."""
        entries, total = [], 0
        for name in os.listdir(self.cache_dir):
            if not name.endswith(".json"):
                continue
            meta_path = os.path.join(self.cache_dir, name)
            try:
                with open(meta_path, encoding="utf-8") as f:
                    audio = json.load(f).get("archivo", "")
                size = os.path.getsize(os.path.join(self.cache_dir, audio))
                used = os.path.getmtime(meta_path)
            except (OSError, ValueError):
                continue
            entries.append((used, name[:-5], audio, size))
            total += size
        if total <= self.cache_max:
            return
        with self.jobs_lock:
            busy = set(self.jobs) | {n.split(".")[0] for n in self.in_use}
        for used, key, audio, size in sorted(entries):
            if total <= self.cache_max:
                break
            if key in busy:
                continue
            for path in (os.path.join(self.cache_dir, audio), os.path.join(self.cache_dir, key + ".json")):
                try:
                    os.remove(path)
                except OSError:
                    pass
            total -= size
            log(f"Caché llena: borrado {audio} ({size // 1024} KB)")

    def version(self):
        if not self.ytdlp:
            return None
        if not self._version:
            try:
                self._version = subprocess.run(self.ytdlp + ["--version"], capture_output=True, text=True,
                                               timeout=30, **NO_WINDOW).stdout.strip() or None
            except Exception:
                return None
        return self._version

    def update_if_old(self):
        """YouTube cambia a menudo: actualiza yt-dlp en silencio cada pocos días."""
        local = os.path.join(BIN_DIR, YTDLP_NAME)
        if not os.path.exists(local) or time.time() - os.path.getmtime(local) < UPDATE_EVERY:
            return
        try:
            subprocess.run(self.ytdlp + ["-U"], capture_output=True, timeout=300, **NO_WINDOW)
            os.utime(local)
            self._version = None
            log(f"yt-dlp revisado: {self.version()}")
        except Exception as e:
            log(f"No se pudo actualizar yt-dlp: {e}")

    def key(self, url, pref):
        return hashlib.sha1(f"{pref}|{url.strip()}".encode("utf-8")).hexdigest()[:20]

    def cached(self, key):
        meta_path = os.path.join(self.cache_dir, key + ".json")
        if not os.path.exists(meta_path):
            return None
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        if os.path.exists(os.path.join(self.cache_dir, meta.get("archivo", ""))):
            try:
                os.utime(meta_path)   # la fecha del .json marca el último uso
            except OSError:
                pass
            return meta
        return None

    def lookup(self, url, pref="webm"):
        """Devuelve (metadatos, None) si el audio ya está en caché, o (None, trabajo) mientras se descarga.
        La descarga ocurre en segundo plano: el audio puede empezar a sonar antes de que termine."""
        if not self.ytdlp:
            raise RuntimeError("Falta un componente de audio. Conéctate a Internet y vuelve a intentarlo.")
        pref = pref if pref in FORMATS else "webm"
        url = canonical_url(url)
        key = self.key(url, pref)
        with self.jobs_lock:
            meta = self.cached(key)
            if meta:
                return meta, None
            job = self.jobs.get(key)
            if not job:
                job = Job(key, url, pref)
                self.jobs[key] = job
                threading.Thread(target=self.run_job, args=(job,), daemon=True).start()
            return None, job

    def run_job(self, job):
        log(f"Extrayendo audio: {job.url}")
        try:
            error = self.run_ytdlp(job)
            if error and needs_login(error) and not job.info:
                # Sitios que piden cuenta: se reintenta con la sesión abierta en los navegadores del equipo
                for browser in self.cookie_browsers:
                    error = self.run_ytdlp(job, ["--cookies-from-browser", browser])
                    if not error:
                        log(f"Usada la sesión de {browser}")
                        break
            if error:
                log(f"Error: {error}")
                job.error = clean_error(error)
            else:
                job.meta = self.save_meta(job)
                log(f"Listo: {job.meta['titulo']} ({job.meta['ext']}, {job.meta['tamano'] // 1024} KB)")
        except Exception as e:
            log(f"Error: {e}")
            job.error = "No se pudo obtener el audio de esa página."
        finally:
            job.started.set()
            job.finished.set()
            with self.jobs_lock:
                self.jobs.pop(job.key, None)
        try:
            self.trim_cache()
        except Exception as e:
            log(f"No se pudo ordenar la caché: {e}")

    def save_meta(self, job):
        name = os.path.basename(job.path)
        meta = describe(job.info, job.url, name)
        meta.update(archivo=name, tamano=os.path.getsize(job.path), fecha=time.strftime("%Y-%m-%dT%H:%M:%S"))
        with open(os.path.join(self.cache_dir, job.key + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        return meta

    @property
    def cookie_browsers(self):
        home = os.path.expanduser("~")
        appdata = os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", "")
        profiles = {
            "firefox": [os.path.join(home, ".mozilla", "firefox"), os.path.join(home, "snap", "firefox"),
                        os.path.join(appdata[0], "Mozilla", "Firefox"),
                        os.path.join(home, "Library", "Application Support", "Firefox")],
            "chrome": [os.path.join(home, ".config", "google-chrome"), os.path.join(appdata[1], "Google", "Chrome"),
                       os.path.join(home, "Library", "Application Support", "Google", "Chrome")],
            "chromium": [os.path.join(home, ".config", "chromium"), os.path.join(home, "snap", "chromium")],
            "edge": [os.path.join(home, ".config", "microsoft-edge"), os.path.join(appdata[1], "Microsoft", "Edge")],
            "brave": [os.path.join(home, ".config", "BraveSoftware"), os.path.join(appdata[1], "BraveSoftware")],
        }
        return [b for b, paths in profiles.items() if any(p and os.path.isdir(p) for p in paths)]

    def run_ytdlp(self, job, extra=()):
        """Descarga el audio escribiendo directamente el archivo final. Devuelve el error o None."""
        for old in os.listdir(self.cache_dir):
            if old.startswith(job.key + ".") and not old.endswith(".json"):
                os.remove(os.path.join(self.cache_dir, old))
        cmd = self.ytdlp + self.js_args + list(extra) + [
            "--no-playlist", "--no-progress", "--no-colors", "--no-simulate", "--no-part",
            "-f", FORMATS[job.pref],
            "-o", os.path.join(self.cache_dir, job.key + ".%(ext)s"),
            "--print", "video:META:%(.{title,duration,extractor_key,uploader,ext})j",
            "--print", "after_move:FILE:%(filepath)s",
            "--", job.url,
        ]
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", env=env, **NO_WINDOW)
        stderr = []
        reader = threading.Thread(target=lambda: stderr.extend(proc.stderr), daemon=True)
        reader.start()
        timed_out = []
        watchdog = threading.Timer(900, lambda: (timed_out.append(1), proc.kill()))
        watchdog.start()
        filepath = None
        for line in proc.stdout:
            if line.startswith("META:"):
                try:
                    job.info = json.loads(line[5:])
                except ValueError:
                    continue
                job.path = os.path.join(self.cache_dir, f"{job.key}.{job.info.get('ext') or 'webm'}")
                job.started.set()
            elif line.startswith("FILE:"):
                filepath = line[5:].strip()
        proc.wait()
        watchdog.cancel()
        reader.join(5)
        if timed_out:
            return "Tardó demasiado"
        if proc.returncode != 0 or not filepath or not os.path.exists(filepath):
            errors = [l for l in stderr if "ERROR" in l]
            return (errors[-1] if errors else "".join(stderr)[-400:] or "Error desconocido").strip()
        job.path = filepath
        return None


class Job:
    """Una descarga en curso."""

    def __init__(self, key, url, pref):
        self.key, self.url, self.pref = key, url, pref
        self.info = None      # título, duración… (se conoce antes de descargar)
        self.path = None      # archivo que se va escribiendo
        self.meta = None      # metadatos definitivos al terminar
        self.error = None
        self.started = threading.Event()   # ya hay información (o un error)
        self.finished = threading.Event()


def describe(info, url, name=""):
    ext = (info or {}).get("ext") or os.path.splitext(name)[1].lstrip(".") or "webm"
    return {
        "ok": True,
        "url": url,
        "titulo": (info or {}).get("title") or name,
        "duracion": (info or {}).get("duration"),
        "plataforma": (info or {}).get("extractor_key"),
        "autor": (info or {}).get("uploader"),
        "ext": ext,
        "tipo": mimetypes.guess_type("a." + ext)[0] or "application/octet-stream",
    }


YT_ID_RE = re.compile(
    r"^https?://(?:[\w-]+\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)/"
    r"(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/|v/)?([\w-]{11})(?=$|[?&#/])", re.I)


def canonical_url(url):
    """El mismo video de YouTube con enlaces distintos (youtu.be, &pp=, &list=…) se descarga una sola vez."""
    m = YT_ID_RE.match(url.strip())
    return f"https://www.youtube.com/watch?v={m.group(1)}" if m else url.strip()


def needs_login(msg):
    return any(s in msg for s in ("Sign in", "logged-in", "--cookies", "login required", "Login required"))


def clean_error(msg):
    msg = re.sub(r"^ERROR:\s*", "", msg.strip())
    if "Unsupported URL" in msg:
        return "No se encontró audio en esa página."
    if "DRM" in msg:
        return "Ese sitio protege su música (DRM) y no deja escucharla fuera de su app."
    if "Private video" in msg:
        return "El video es privado."
    if needs_login(msg):
        return "Ese sitio pide iniciar sesión. Entra con tu cuenta en Firefox o Chrome y vuelve a intentarlo."
    if "Video unavailable" in msg or "video is unavailable" in msg:
        return "El video no está disponible."
    if "Unable to download" in msg or "getaddrinfo" in msg or "Network is unreachable" in msg:
        return "No hay conexión a Internet."
    if msg == "Tardó demasiado":
        return "El audio tardó demasiado en descargarse. Vuelve a intentarlo."
    return "No se pudo obtener el audio de esa página."


# ============ SERVIDOR HTTP ============

class Handler(http.server.SimpleHTTPRequestHandler):
    extractor = None
    port = 8777
    active = 0
    last_activity = time.time()
    activity_lock = threading.Lock()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def handle(self):
        with Handler.activity_lock:
            Handler.active += 1
        try:
            super().handle()
        finally:
            with Handler.activity_lock:
                Handler.active -= 1
                Handler.last_activity = time.time()

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Type")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def host_ok(self):
        # Evita que otras páginas usen el servidor mediante "DNS rebinding"
        host = self.headers.get("Host") or ""
        host = host.split("]")[0] + "]" if host.startswith("[") else host.split(":")[0]
        return host in ("127.0.0.1", "localhost", "[::1]")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.end_headers()

    def do_GET(self):
        if not self.host_ok():
            self.send_error(403)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            params = urllib.parse.parse_qs(parsed.query)
            try:
                self.api(parsed.path, params)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if parsed.path.startswith("/servidor/"):
            self.send_error(404)
            return
        super().do_GET()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api(self, path, params):
        ex = self.extractor
        if path == "/api/estado":
            self.send_json({
                "ok": True, "app": "CancioTras", "servidor": VERSION,
                "ytdlp": ex.version(), "js": ex.js_name, "cache": ex.cache_dir,
                "liviano": bool(FFMPEG),
            })
            return
        if path == "/api/carpeta-exportar":
            folder = export_dir()
            self.send_json({"ok": bool(folder), "ruta": folder or ""})
            return
        url = (params.get("url") or [""])[0].strip()
        pref = (params.get("pref") or ["webm"])[0]
        if not re.match(r"^https?://", url, re.I):
            self.send_json({"ok": False, "error": "La dirección debe empezar por http:// o https://"}, 400)
            return
        if path == "/api/hoja":
            self.send_sheet(url)
            return
        if path == "/api/liviano":
            self.send_lite_url(url)
            return
        if path not in ("/api/preparar", "/api/audio"):
            self.send_error(404)
            return
        try:
            meta, job = ex.lookup(url, pref)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 502)
            return
        if job:
            job.started.wait(900)
            if job.error or not job.info:
                self.send_json({"ok": False, "error": job.error or "No se pudo obtener el audio de esa página."}, 502)
                return
            if job.meta:
                meta = job.meta
        if path == "/api/preparar":
            self.send_json(meta or dict(describe(job.info, job.url), listo=False))
        elif meta:
            ex.use(meta["archivo"], 1)
            try:
                self.send_file(os.path.join(ex.cache_dir, meta["archivo"]), meta["tipo"])
            finally:
                ex.use(meta["archivo"], -1)
        else:
            self.send_growing(job)

    def send_lite_url(self, url):
        """Audio liviano de una página (YouTube…) o de un archivo de audio en internet."""
        ex = self.extractor
        if not FFMPEG:
            self.send_json({"ok": False, "error": "Falta ffmpeg para comprimir el audio."}, 501)
            return
        url = canonical_url(url)
        key = "u" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
        out = ex.lite_path(key)
        try:
            if not os.path.exists(out):
                ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lstrip(".").lower()
                if ext in MEDIA_EXTS:
                    os.makedirs(ex.lite_dir, exist_ok=True)
                    tmp = os.path.join(ex.lite_dir, key + ".tmp.src")
                    req = urllib.request.Request(url, headers={"User-Agent": f"CancioTras/{VERSION}"})
                    try:
                        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                            shutil.copyfileobj(r, f)
                        ex.make_lite(tmp, key)
                    finally:
                        try:
                            os.remove(tmp)
                        except OSError:
                            pass
                else:
                    meta, job = ex.lookup(url, "webm")
                    if job:
                        job.finished.wait(900)
                        if job.error or not job.meta:
                            raise RuntimeError(job.error or "No se pudo obtener el audio de esa página.")
                        meta = job.meta
                    ex.use(meta["archivo"], 1)
                    try:
                        ex.make_lite(os.path.join(ex.cache_dir, meta["archivo"]), key)
                    finally:
                        ex.use(meta["archivo"], -1)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e) or "No se pudo preparar el audio."}, 502)
            return
        self.send_file(out, "audio/mp4")

    def do_POST(self):
        """Audio liviano de un archivo del equipo (lo envía la app)."""
        if not self.host_ok():
            self.send_error(403)
            return
        if urllib.parse.urlparse(self.path).path != "/api/liviano":
            self.send_error(404)
            return
        ex = self.extractor
        length = int(self.headers.get("Content-Length") or 0)
        if not FFMPEG:
            self.send_json({"ok": False, "error": "Falta ffmpeg para comprimir el audio."}, 501)
            return
        if not 0 < length <= LITE_MAX_BYTES:
            self.send_json({"ok": False, "error": "El archivo es demasiado grande."}, 413)
            return
        os.makedirs(ex.lite_dir, exist_ok=True)
        tmp = os.path.join(ex.lite_dir, f"subida-{threading.get_ident()}-{time.time_ns()}.tmp.src")
        digest = hashlib.sha1()
        try:
            with open(tmp, "wb") as f:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    digest.update(chunk)
                    f.write(chunk)
                    remaining -= len(chunk)
            out = ex.make_lite(tmp, "f" + digest.hexdigest()[:20])
        except Exception as e:
            self.send_json({"ok": False, "error": str(e) or "No se pudo comprimir el audio."}, 502)
            return
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        self.send_file(out, "audio/mp4")

    def send_sheet(self, url):
        """Partituras de otras webs que no permiten leerlas desde el navegador (CORS)."""
        req = urllib.request.Request(url, headers={"User-Agent": f"CancioTras/{VERSION}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read(SHEET_MAX_BYTES + 1)
                mime = r.headers.get_content_type() or "application/octet-stream"
        except Exception:
            self.send_json({"ok": False, "error": "No se pudo descargar la partitura de esa dirección."}, 502)
            return
        if len(data) > SHEET_MAX_BYTES:
            self.send_json({"ok": False, "error": "La partitura es demasiado grande (más de 30 MB)."}, 413)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_growing(self, job):
        """Envía el audio mientras yt-dlp lo sigue descargando (empieza a sonar enseguida)."""
        self.send_response(200)
        self.send_header("Content-Type", describe(job.info, job.url)["tipo"])
        self.end_headers()
        f = None
        try:
            while True:
                if f is None:
                    if job.path and os.path.exists(job.path):
                        f = open(job.path, "rb")
                    elif job.finished.is_set():
                        return
                    else:
                        time.sleep(0.2)
                        continue
                chunk = f.read(256 * 1024)
                if chunk:
                    self.wfile.write(chunk)
                elif job.finished.is_set():
                    rest = f.read()
                    if rest:
                        self.wfile.write(rest)
                    return
                else:
                    time.sleep(0.2)
        finally:
            if f:
                f.close()

    def send_file(self, path, mime):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        length = end - start + 1
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# ============ INICIO ============

def already_running(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/estado", timeout=2) as r:
            return json.load(r).get("app") == "CancioTras"
    except Exception:
        return False


def profile_dir():
    if IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "CancioTras", "ventana")


def default_cache_dir():
    """Fuera de la carpeta de la app: el servidor toca estos archivos en cada reproducción y un
    editor con recarga automática (Live Server…) recargaría la página sin parar."""
    if IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "CancioTras", "cache")
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Caches/CancioTras")
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "CancioTras", "audio")


EXPORT_FOLDER = "Cancionero Universal"


def desktop_dir():
    """El Escritorio del usuario («Escritorio», «Desktop», el de OneDrive…), o None si no hay."""
    home = os.path.expanduser("~")
    if IS_WINDOWS:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
                path = os.path.expandvars(winreg.QueryValueEx(key, "Desktop")[0])
            if os.path.isdir(path):
                return path
        except OSError:
            pass
    elif sys.platform != "darwin":
        try:
            out = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, timeout=3).stdout.strip()
            if out and os.path.abspath(out) != home and os.path.isdir(out):
                return out
        except (OSError, subprocess.SubprocessError):
            pass
    for name in ("Escritorio", "Desktop", os.path.join("OneDrive", "Escritorio"), os.path.join("OneDrive", "Desktop")):
        path = os.path.join(home, name)
        if os.path.isdir(path):
            return path
    return None


def export_dir():
    """Carpeta «Cancionero Universal» del Escritorio, donde la app propone guardar lo exportado."""
    desk = desktop_dir()
    if not desk:
        return None
    path = os.path.join(desk, EXPORT_FOLDER)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        return None
    return path


def move_old_cache(new_dir):
    """Los audios que quedaron en servidor/cache (versiones anteriores) pasan a la caché nueva."""
    if not os.path.isdir(OLD_CACHE_DIR) or os.path.abspath(OLD_CACHE_DIR) == os.path.abspath(new_dir):
        return
    os.makedirs(new_dir, exist_ok=True)
    moved = 0
    for name in os.listdir(OLD_CACHE_DIR):
        src, dst = os.path.join(OLD_CACHE_DIR, name), os.path.join(new_dir, name)
        try:
            if name.endswith(".part") or os.path.exists(dst):
                os.remove(src)
            else:
                shutil.move(src, dst)
                moved += 1
        except OSError:
            pass
    try:
        os.rmdir(OLD_CACHE_DIR)
    except OSError:
        pass
    if moved:
        log(f"Caché de audios trasladada a {new_dir} ({moved} archivos)")


def open_app_window(url):
    """Abre Cancionero Universal en una ventana propia (modo app de Chrome/Chromium/Edge) o en el navegador.
    Devuelve el proceso de la ventana si se pudo abrir con un perfil propio."""
    candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]
    if IS_WINDOWS:
        for base in (os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("LOCALAPPDATA", "")):
            candidates += [os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
                           os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")]
    elif sys.platform == "darwin":
        candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    for c in candidates:
        exe = c if os.path.isabs(c) and os.path.exists(c) else shutil.which(c)
        if exe:
            return subprocess.Popen(
                [exe, f"--app={url}", "--class=CancioTras", f"--user-data-dir={profile_dir()}",
                 "--no-first-run", "--no-default-browser-check", "--window-size=1200,900"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    webbrowser.open(url)
    return None


def stop_when_closed(proc, server):
    """Detiene el servidor al cerrar la ventana de la app."""
    started = time.time()
    proc.wait()
    # Si terminó enseguida, la ventana se entregó a otra instancia: seguimos sirviendo
    if time.time() - started > 5:
        log("Ventana cerrada: deteniendo el servidor.")
        server.shutdown()


def stop_when_idle(server):
    """Iniciado por el sistema bajo demanda: se apaga cuando nadie lo usa (el sistema lo vuelve a iniciar)."""
    while True:
        time.sleep(30)
        with Handler.activity_lock:
            idle = Handler.active == 0 and time.time() - Handler.last_activity > IDLE_SECONDS
        if idle:
            log("Sin uso: en pausa hasta la próxima vez.")
            server.shutdown()
            return


def inherited_socket():
    """Socket que entrega systemd (activación por socket)."""
    if os.environ.get("LISTEN_PID") == str(os.getpid()) and os.environ.get("LISTEN_FDS") == "1":
        return socket.socket(fileno=3)
    return None


# ============ INSTALACIÓN (una sola vez, luego todo ocurre solo) ============

SERVICE = "canciotras"
SCRIPT = os.path.abspath(__file__)
ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1a73e8"/>
<path d="M26 14v26.5a7 7 0 1 0 4 6.3V24l16-4v14.5a7 7 0 1 0 4 6.3V10z" fill="#fff"/></svg>
"""


def run_quiet(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30, **NO_WINDOW).returncode == 0
    except Exception:
        return False


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def linux_paths():
    config = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    data = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return {
        "socket": os.path.join(config, "systemd", "user", f"{SERVICE}.socket"),
        "service": os.path.join(config, "systemd", "user", f"{SERVICE}.service"),
        "autostart": os.path.join(config, "autostart", f"{SERVICE}-servidor.desktop"),
        "menu": os.path.join(data, "applications", f"{SERVICE}.desktop"),
        "icon": os.path.join(data, "icons", "hicolor", "scalable", "apps", f"{SERVICE}.svg"),
    }


def windows_paths():
    appdata = os.environ.get("APPDATA", os.path.expanduser("~"))
    programs = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs")
    return {"startup": os.path.join(programs, "Startup", "CancioTras servidor.vbs"),
            "menu": os.path.join(programs, "Cancionero Universal.lnk"),
            "old_menu": os.path.join(programs, "CancioTras.lnk")}


def mac_paths():
    return {"agent": os.path.expanduser(f"~/Library/LaunchAgents/com.{SERVICE}.servidor.plist")}


def pythonw():
    candidate = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return candidate if os.path.exists(candidate) else sys.executable


def server_cmd():
    """Cómo arrancar este servidor: la copia instalada del ejecutable, o Python con este script."""
    if FROZEN:
        return [INSTALLED_EXE]
    return [pythonw() if IS_WINDOWS else sys.executable, SCRIPT]


def install_frozen_copy():
    """El instalador descargado se copia a la carpeta de datos (y reemplaza una versión anterior)."""
    if not FROZEN or RUNNING_INSTALLED:
        return
    if IS_WINDOWS:
        run_quiet(["taskkill", "/F", "/IM", os.path.basename(INSTALLED_EXE)])
    else:
        run_quiet(["pkill", "-f", INSTALLED_EXE])
    os.makedirs(HERE, exist_ok=True)
    tmp = INSTALLED_EXE + ".nuevo"
    shutil.copy2(sys.executable, tmp)
    make_executable(tmp)
    # La copia anterior puede tardar un momento en cerrarse (Windows no deja reemplazarla mientras corre)
    for _ in range(20):
        try:
            os.replace(tmp, INSTALLED_EXE)
            return
        except OSError:
            time.sleep(0.5)
    os.replace(tmp, INSTALLED_EXE)


def is_installed():
    if IS_WINDOWS:
        return os.path.exists(windows_paths()["startup"])
    if sys.platform == "darwin":
        return os.path.exists(mac_paths()["agent"])
    p = linux_paths()
    return os.path.exists(p["socket"]) or os.path.exists(p["autostart"])


def systemd_user_available():
    return shutil.which("systemctl") and run_quiet(["systemctl", "--user", "show-environment"])


def start_detached(args):
    kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
    if IS_WINDOWS:
        kwargs["creationflags"] = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(args, **kwargs)


def install(port):
    """Deja el servidor funcionando en segundo plano (también tras reiniciar) y crea el acceso directo."""
    install_frozen_copy()
    cmd = server_cmd()
    background = cmd + ["--segundo-plano", "--puerto", str(port)]
    if IS_WINDOWS:
        p = windows_paths()
        vbs_args = " ".join(f'""{a}""' for a in cmd)
        write(p["startup"], f'CreateObject("WScript.Shell").Run "{vbs_args} --segundo-plano --puerto {port}", 0, False\n')
        args = " ".join(f'"{a}"' for a in cmd[1:])
        workdir = HERE if FROZEN else APP_DIR
        ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}');$s.TargetPath='{exe}';"
              "$s.Arguments='{args}';$s.WorkingDirectory='{dir}';$s.Description='Cancionero Universal';$s.Save()").format(
            lnk=p["menu"].replace("'", "''"), exe=cmd[0].replace("'", "''"),
            args=args.replace("'", "''"), dir=workdir.replace("'", "''"))
        run_quiet(["powershell", "-NoProfile", "-Command", ps])
        if os.path.exists(p["old_menu"]):
            os.remove(p["old_menu"])
        if not already_running(port):
            start_detached(background)
    elif sys.platform == "darwin":
        agent = mac_paths()["agent"]
        write(agent, f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.{SERVICE}.servidor</string>
  <key>ProgramArguments</key><array>
    {"".join(f"<string>{a}</string>" for a in background)}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
""")
        run_quiet(["launchctl", "unload", agent])
        run_quiet(["launchctl", "load", agent])
    else:
        p = linux_paths()
        launcher = INSTALLED_EXE if FROZEN else os.path.join(APP_DIR, "iniciar-canciotras.sh")
        write(p["icon"], ICON_SVG)
        write(p["menu"], f"""[Desktop Entry]
Type=Application
Name=Cancionero Universal
Comment=Editor y trasponedor de canciones con acordes
Exec="{launcher}"
Path={HERE if FROZEN else APP_DIR}
Icon={SERVICE}
Terminal=false
Categories=AudioVideo;Audio;Music;
StartupWMClass=CancioTras
""")
        run_quiet(["update-desktop-database", os.path.dirname(p["menu"])])
        if systemd_user_available():
            # El sistema escucha el puerto y enciende el servidor solo cuando la app lo necesita
            write(p["socket"], f"""[Unit]
Description=Cancionero Universal: audio de YouTube y otras plataformas

[Socket]
ListenStream=127.0.0.1:{port}

[Install]
WantedBy=sockets.target
""")
            write(p["service"], f"""[Unit]
Description=Cancionero Universal: servidor local
Requires={SERVICE}.socket

[Service]
ExecStart={" ".join(f'"{a}"' for a in background)}
WorkingDirectory={HERE if FROZEN else APP_DIR}
""")
            run_quiet(["systemctl", "--user", "daemon-reload"])
            # Si ya estaba instalado en otra carpeta, que la próxima conexión use esta
            run_quiet(["systemctl", "--user", "stop", f"{SERVICE}.service"])
            run_quiet(["systemctl", "--user", "enable", f"{SERVICE}.socket"])
            run_quiet(["systemctl", "--user", "restart", f"{SERVICE}.socket"])
        else:
            write(p["autostart"], f"""[Desktop Entry]
Type=Application
Name=Cancionero Universal (servidor)
Exec={" ".join(f'"{a}"' for a in background)}
NoDisplay=true
X-GNOME-Autostart-enabled=true
""")
            if not already_running(port):
                start_detached(background)
    log("Instalado: Cancionero Universal funcionará en segundo plano y está en el menú de aplicaciones.")


def uninstall():
    if IS_WINDOWS:
        paths = windows_paths().values()
    elif sys.platform == "darwin":
        run_quiet(["launchctl", "unload", mac_paths()["agent"]])
        paths = mac_paths().values()
    else:
        if shutil.which("systemctl"):
            run_quiet(["systemctl", "--user", "disable", "--now", f"{SERVICE}.socket"])
            run_quiet(["systemctl", "--user", "stop", f"{SERVICE}.service"])
        paths = linux_paths().values()
    for path in paths:
        if os.path.exists(path):
            os.remove(path)
    if not IS_WINDOWS and sys.platform != "darwin":
        run_quiet(["systemctl", "--user", "daemon-reload"])
    log("Desinstalado (tus canciones y la carpeta de la app no se tocan).")


def notify_installed():
    msg = ("Cancionero Universal quedó instalado y funcionando en segundo plano.\n\n"
           "Vuelve a la página y pulsa «Reproducir» (la primera vez puede tardar un par de minutos "
           "mientras descarga sus componentes).\n\nTambién está en el menú Inicio.")
    log(msg)
    if IS_WINDOWS:
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, msg, "Cancionero Universal", 0x40)
        except Exception:
            pass


def wait_until_running(port, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        if already_running(port):
            return True
        time.sleep(0.3)
    return False


def main():
    ap = argparse.ArgumentParser(description="Servidor local de Cancionero Universal (app + extracción de audio)")
    ap.add_argument("--puerto", type=int, default=8777)
    ap.add_argument("--instalar", action="store_true", help="dejarlo en segundo plano para siempre y crear el acceso directo")
    ap.add_argument("--desinstalar", action="store_true", help="quitar lo que hace --instalar")
    ap.add_argument("--segundo-plano", action="store_true", help="solo servidor, sin ventana (lo usa el sistema)")
    ap.add_argument("--no-abrir", action="store_true", help="no abrir la ventana de la app")
    ap.add_argument("--navegador", action="store_true", help="abrir en una pestaña normal del navegador")
    ap.add_argument("--cache", default=None, help="carpeta donde guardar los audios extraídos")
    ap.add_argument("--cache-max-mb", type=int, default=CACHE_MAX_MB, help="tamaño máximo de la caché de audios")
    ap.add_argument("--actualizar", action="store_true", help="actualizar yt-dlp antes de iniciar")
    args = ap.parse_args()
    url = f"http://127.0.0.1:{args.puerto}/"

    def show():
        if args.navegador:
            webbrowser.open(url)
            return None
        return open_app_window(url)

    if args.desinstalar:
        uninstall()
        return
    if args.instalar:
        install(args.puerto)
        return

    background = args.segundo_plano
    sock = inherited_socket() if background else None
    if FROZEN and not RUNNING_INSTALLED and not background:
        # Doble clic en el instalador descargado: se instala (o actualiza) y queda en segundo plano
        install(args.puerto)
        notify_installed()
        return
    if not sock:
        if already_running(args.puerto):
            if not (background or args.no_abrir):
                show()
            return
        # Primera vez que se abre desde el icono o el lanzador: queda instalado en segundo plano
        if not (background or args.no_abrir) and not is_installed():
            install(args.puerto)
            if wait_until_running(args.puerto):
                show()
                return

    ytdlp = ensure_ytdlp(update=args.actualizar)
    js_args, js_name = ensure_js_runtime()
    cache_dir = os.path.abspath(args.cache or default_cache_dir())
    if not args.cache:
        move_old_cache(cache_dir)
    export_dir()
    Handler.extractor = Extractor(cache_dir, ytdlp, js_args, js_name, args.cache_max_mb)
    Handler.port = args.puerto

    if sock:
        server = Server(("127.0.0.1", args.puerto), Handler, bind_and_activate=False)
        server.socket.close()
        server.socket = sock
        server.server_name, server.server_port = "127.0.0.1", args.puerto
        threading.Thread(target=stop_when_idle, args=(server,), daemon=True).start()
    else:
        server = Server(("127.0.0.1", args.puerto), Handler)
    log(f"Servidor en {url}  (yt-dlp {Handler.extractor.version() or 'no disponible'}, motor JS: {js_name})")
    if ytdlp:
        threading.Thread(target=Handler.extractor.update_if_old, daemon=True).start()

    if not (background or args.no_abrir):
        proc = show()
        if proc:
            threading.Thread(target=stop_when_closed, args=(proc, server), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
    log("Detenido.")


if __name__ == "__main__":
    main()
