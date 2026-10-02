#!/usr/bin/env python3
"""Calendario de Pesca: backend de cuentas, sincronización, amigos y chat.

Solo usa la librería estándar de Python y SQLite. Escucha en 127.0.0.1 y va siempre detrás de un
proxy (Caddy) que pone el HTTPS, las cabeceras de seguridad y la cabecera X-Real-IP.

Endpoints. Todos salvo health, legal, register, login y recover piden "Authorization: Bearer <token>".

  GET  /api/health                         -> {ok, signup, version, policyVersion}
  GET  /api/legal                          -> datos del responsable de esta instalación
  POST /api/auth/register  {username, name, password, modalities, consent}  -> {token, user, recoveryCode}
  POST /api/auth/login     {username, password}                             -> {token, user}
  POST /api/auth/recover   {username, code, password}                       -> {token, user, recoveryCode}
  POST /api/auth/logout
  POST /api/auth/logout-others             cierra las demás sesiones del usuario
  GET  /api/me                             -> {user}
  POST /api/me             {name?, modalities?, shareLevel?}
  POST /api/me/consent     {version}
  POST /api/me/password    {current, password}
  POST /api/me/recovery    {password}      -> {recoveryCode}
  GET  /api/me/export                      -> todos los datos del usuario (JSON)
  POST /api/me/delete      {password}      borra la cuenta y todos sus datos
  POST /api/sync           {lastSyncAt, changes: {sessions: [...]}} -> {serverTime, changes}
  GET  /api/friends                        -> {friends, incoming, outgoing, blocked}
  POST /api/friends/request|accept|remove  {username}
  GET  /api/friends/<usuario>/sessions     -> jornadas que ese amigo comparte
  POST /api/blocks         {username}      bloquear (rompe la amistad y corta el chat)
  POST /api/blocks/remove  {username}
  GET  /api/chats                          -> conversaciones con último mensaje y no leídos
  GET  /api/chats/unread                   -> {count}
  GET  /api/chats/<usuario>?after=<id>     -> {messages, canSend}  (marca como leídos)
  POST /api/chats/<usuario>  {body}        -> {message}
  POST /api/reports        {username, messageId?, reason, details?}

Reglas de sincronización:
  - Last-write-wins por "updatedAt" (del cliente), siempre dentro de los datos del propio usuario.
  - Cada registro guardado recibe una marca del servidor (server_ts, ms); "changes" devuelve lo del
    usuario con server_ts > lastSyncAt, así no influye el reloj del móvil.
  - Los borrados se guardan como registros {"id", "updatedAt", "deleted": true}, sin el contenido.

Administración (dentro del servidor, mejor con el envoltorio pesca-admin):
  server.py users | adduser <usuario> [nombre] | passwd <usuario> | claim <usuario> | deluser <usuario>
            disable <usuario> | enable <usuario> | reports [--all] | resolve <id>
"""
import getpass
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import traceback
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

VERSION = "4.0.0"
# Sube este valor cuando cambien la política de privacidad o las condiciones de uso:
# los usuarios tendrán que aceptarlas de nuevo antes de seguir sincronizando.
POLICY_VERSION = "2026-10"

DB_PATH = os.environ.get("PESCA_DB", "/var/lib/pesca/pesca.db")
HOST = os.environ.get("PESCA_HOST", "127.0.0.1")
PORT = int(os.environ.get("PESCA_PORT") or os.environ.get("PESCA_API_PORT") or "8000")
ALLOW_SIGNUP = os.environ.get("PESCA_ALLOW_SIGNUP", "1") == "1"
OPERATOR_NAME = os.environ.get("PESCA_OPERATOR_NAME", "").strip()
OPERATOR_CONTACT = os.environ.get("PESCA_OPERATOR_CONTACT", "").strip()

PBKDF2_ITER = 600_000          # recomendación OWASP para PBKDF2-HMAC-SHA256
MIN_PASSWORD = 8
MAX_PASSWORD = 128
TOKEN_IDLE_DAYS = 90           # una sesión sin usarse 90 días caduca
TOKEN_MAX_DAYS = 365           # y ninguna dura más de un año
MAX_BODY = 64 * 1024
MAX_SYNC_BODY = 8 * 1024 * 1024
MAX_RECORD_BYTES = 32 * 1024
MAX_RECORDS_PER_SYNC = 5000
MAX_SESSIONS_PER_USER = 20000
MAX_USER_BYTES = 50 * 1024 * 1024    # cuota de almacenamiento por usuario
SYNC_PAGE = 2000                      # registros como máximo por respuesta de /api/sync
FRIEND_SESSIONS_MAX = 5000
REPORT_RETENTION_DAYS = 365
MAX_MESSAGE = 2000
MAX_PENDING_REQUESTS = 50

KINDS = ("sessions",)
TYPES = ("concurso", "campeonato", "entrenamiento")
MODALITIES = ("feeder", "coup", "carpfishing", "blackbass", "spinning", "mosca", "surfcasting", "embarcacion", "otra")
SHARE_LEVELS = ("results", "full")
REPORT_REASONS = ("spam", "acoso", "inapropiado", "otro")
# Campos que ven los amigos cuando el usuario comparte "solo resultados".
RESULT_FIELDS = {
    "id", "type", "modality", "date", "time", "title", "venue", "competition", "round", "sector", "peg",
    "weightG", "pieces", "biggestG", "species", "sectorRank", "overallRank", "updatedAt",
}

# Campos numéricos y de valores cerrados: si llegan con otro tipo, se descartan.
NUMERIC_FIELDS = {
    "weightG", "pieces", "biggestG", "sectorRank", "overallRank", "temp", "pressure",
    "distance", "groundbaitKg", "balls", "hours", "bites", "depth", "lead", "rodLength",
}
ENUM_FIELDS = {
    "sky": {"sol", "nubes-claros", "nublado", "lluvia", "tormenta", "niebla"},
    "wind": {"Calma", "Flojo", "Moderado", "Fuerte"},
    "windDir": {"N", "NE", "E", "SE", "S", "SO", "O", "NO"},
    "tide": {"Bajamar", "Subiendo", "Pleamar", "Bajando"},
}
USER_RE = re.compile(r"^[a-z0-9._-]{3,20}$")
ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,31}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_sync_lock = threading.Lock()
_last_ts = 0


class ApiError(Exception):
    def __init__(self, code, msg, **extra):
        super().__init__(msg)
        self.code, self.msg, self.extra = code, msg, extra


# ---------- utilidades ----------
def now_dt():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now_dt()).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_text(value, limit, multiline=False):
    s = str(value or "")
    if not multiline:
        s = s.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    s = CTRL_RE.sub("", s.replace("\r\n", "\n")).strip()
    return s[:limit]


def as_str(v):
    """Las entradas de texto que no son texto se tratan como vacías (evita errores con listas, números…)."""
    return v if isinstance(v, str) else ""


def as_int(v, lo=0, hi=2**62):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ApiError(400, "Número no válido")
    v = int(v)
    if not lo <= v <= hi:
        raise ApiError(400, "Número fuera de rango")
    return v


def ip_key(ip):
    """IPv6 se agrupa por /64: rotar direcciones dentro de una misma conexión no evita los límites."""
    try:
        addr = ipaddress.ip_address(ip)
        if addr.version == 6:
            return str(ipaddress.ip_network(f"{ip}/64", strict=False))
        return str(addr)
    except ValueError:
        return "invalid"


def next_ts():
    """Marca de tiempo del servidor estrictamente creciente (ms). Llamar con _sync_lock cogido."""
    global _last_ts
    _last_ts = max(int(time.time() * 1000), _last_ts + 1)
    return _last_ts


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA secure_delete=ON")  # lo borrado se sobrescribe en el fichero
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


# ---------- límites de peticiones (en memoria) ----------
class RateLimiter:
    """Límites por ventana deslizante, en memoria. Las claves caducadas se eliminan solas
    (así las IPs no se guardan más que la ventana de su límite, como mucho 1 hora)."""

    MAX_KEYS = 200_000

    def __init__(self):
        self._hits = {}          # clave -> (ventana, deque de instantes)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def _sweep(self, now):
        for key in [k for k, (w, q) in self._hits.items() if not q or q[-1] <= now - w]:
            del self._hits[key]
        if len(self._hits) > self.MAX_KEYS:
            # Último recurso: se olvidan las claves menos recientes, nunca todas de golpe.
            for key, _ in sorted(self._hits.items(), key=lambda kv: kv[1][1][-1])[: len(self._hits) - self.MAX_KEYS]:
                del self._hits[key]
        self._last_sweep = now

    def _queue(self, key, window, now):
        if now - self._last_sweep > 60 or len(self._hits) > self.MAX_KEYS:
            self._sweep(now)
        w, q = self._hits.setdefault(key, (window, deque()))
        while q and q[0] <= now - w:
            q.popleft()
        return q

    def allow(self, key, limit, window):
        """Cuenta un intento y dice si está dentro del límite."""
        now = time.monotonic()
        with self._lock:
            q = self._queue(key, window, now)
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def exceeded(self, key, limit, window):
        """Dice si ya se ha pasado el límite, sin contar un intento."""
        now = time.monotonic()
        with self._lock:
            return len(self._queue(key, window, now)) >= limit

    def add(self, key, window):
        now = time.monotonic()
        with self._lock:
            self._queue(key, window, now).append(now)

    def reset(self, key):
        with self._lock:
            self._hits.pop(key, None)


limiter = RateLimiter()


def limit(key, count, window, msg="Demasiadas peticiones. Espera unos minutos."):
    if not limiter.allow(key, count, window):
        raise ApiError(429, msg)


# ---------- base de datos ----------
def column_names(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info({table})")]


def add_column(con, table, definition):
    name = definition.split()[0]
    if name not in column_names(con, table):
        con.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def init_db():
    global _last_ts
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                server_ts INTEGER NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (kind, id));
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                pw_salt BLOB NOT NULL,
                pw_hash BLOB NOT NULL,
                created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tokens (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                last_used TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS friendships (
                requester INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                addressee INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
                created_at TEXT NOT NULL,
                PRIMARY KEY (requester, addressee));
            CREATE TABLE IF NOT EXISTS blocks (
                blocker INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                blocked INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (blocker, blocked));
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                recipient INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read_at TEXT);
            CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender, recipient, id);
            CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages(recipient, read_at);
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reporter INTEGER REFERENCES users(id) ON DELETE SET NULL,
                reported INTEGER REFERENCES users(id) ON DELETE SET NULL,
                reported_name TEXT NOT NULL DEFAULT '',
                message_id INTEGER,
                message_body TEXT,
                reason TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                resolved_at TEXT);
            """
        )
        # Migraciones desde versiones anteriores (todas idempotentes).
        add_column(con, "records", "user_id INTEGER")                         # v1 -> v2
        con.execute("CREATE INDEX IF NOT EXISTS idx_user_ts ON records(user_id, server_ts)")
        add_column(con, "users", "pw_iter INTEGER NOT NULL DEFAULT 200000")    # v2/v3 usaban 200.000
        add_column(con, "users", "modalities TEXT NOT NULL DEFAULT '[]'")
        # Las cuentas que ya existían conservan lo que tenían (sus amigos veían todo).
        # Las nuevas empiezan con "solo resultados" (privacidad por defecto).
        add_column(con, "users", "share_level TEXT NOT NULL DEFAULT 'full'")
        add_column(con, "users", "consent_version TEXT")
        add_column(con, "users", "consent_at TEXT")
        add_column(con, "users", "recovery_hash TEXT")
        add_column(con, "users", "disabled INTEGER NOT NULL DEFAULT 0")
        con.execute("UPDATE users SET modalities='[\"feeder\"]' WHERE modalities='[]'")
        purge_tokens(con)
        # Las denuncias revisadas se borran pasado un año.
        con.execute("DELETE FROM reports WHERE status='resolved' AND resolved_at < ?",
                    (iso(now_dt() - timedelta(days=REPORT_RETENTION_DAYS)),))
        con.commit()
        row = con.execute("SELECT MAX(server_ts) FROM records").fetchone()
        _last_ts = row[0] or 0
    finally:
        con.close()


def purge_tokens(con):
    con.execute(
        "DELETE FROM tokens WHERE last_used < ? OR created_at < ?",
        (iso(now_dt() - timedelta(days=TOKEN_IDLE_DAYS)), iso(now_dt() - timedelta(days=TOKEN_MAX_DAYS))),
    )


# ---------- usuarios ----------
def hash_pw(password, salt=None, iterations=None):
    password = as_str(password)
    salt = salt or secrets.token_bytes(16)
    return salt, hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations or PBKDF2_ITER)


def check_new_password(password):
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise ApiError(400, f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres")
    if len(password) > MAX_PASSWORD:
        raise ApiError(400, "La contraseña es demasiado larga")


def clean_modalities(value):
    if not isinstance(value, list):
        raise ApiError(400, "Elige al menos una modalidad")
    mods = [m for m in MODALITIES if m in value]
    if not mods:
        raise ApiError(400, "Elige al menos una modalidad")
    return mods


USER_COLS = "id,username,name,modalities,share_level,consent_version,recovery_hash,disabled"


def user_row(con, where, arg):
    return con.execute(f"SELECT {USER_COLS} FROM users WHERE {where}=?", (arg,)).fetchone()


def me_json(row):
    return {
        "id": row[0], "username": row[1], "name": row[2],
        "modalities": json.loads(row[3] or "[]"),
        "shareLevel": row[4],
        "needsConsent": row[5] != POLICY_VERSION,
        "hasRecovery": bool(row[6]),
    }


def public_json(row):
    """Lo que ven los demás usuarios: sin id interno."""
    return {"username": row[1], "name": row[2], "modalities": json.loads(row[3] or "[]")}


def new_recovery(con, uid):
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(16))
    con.execute("UPDATE users SET recovery_hash=? WHERE id=?", (hashlib.sha256(raw.encode()).hexdigest(), uid))
    return "-".join(raw[i:i + 4] for i in range(0, 16, 4))


def normalize_recovery(code):
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def create_user(con, username, name, password, modalities, share_level="results"):
    username = (username or "").strip().lower()
    name = clean_text(name, 40) or username
    if not USER_RE.match(username):
        raise ApiError(400, "Usuario no válido: 3-20 caracteres, letras minúsculas, números, punto, guion")
    check_new_password(password)
    mods = clean_modalities(modalities)
    if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        raise ApiError(409, "Ese usuario ya existe")
    salt, h = hash_pw(password)
    cur = con.execute(
        "INSERT INTO users(username,name,pw_salt,pw_hash,pw_iter,created_at,modalities,share_level) VALUES(?,?,?,?,?,?,?,?)",
        (username, name, salt, h, PBKDF2_ITER, iso(), json.dumps(mods), share_level),
    )
    return cur.lastrowid


def new_token(con, user_id):
    token = secrets.token_urlsafe(32)
    con.execute(
        "INSERT INTO tokens(token_hash,user_id,created_at,last_used) VALUES(?,?,?,?)",
        (hashlib.sha256(token.encode()).hexdigest(), user_id, iso(), iso()),
    )
    return token


def verify_password(con, uid, password):
    """Comprueba la contraseña y, si estaba guardada con menos iteraciones, la rehace."""
    salt, stored, iters = con.execute("SELECT pw_salt,pw_hash,pw_iter FROM users WHERE id=?", (uid,)).fetchone()
    if not isinstance(password, str) or not password:
        hash_pw("x", salt, iters)
        return False
    _, h = hash_pw(password, salt, iters)
    if not hmac.compare_digest(h, stored):
        return False
    if iters < PBKDF2_ITER and isinstance(password, str):
        salt, h = hash_pw(password)
        con.execute("UPDATE users SET pw_salt=?, pw_hash=?, pw_iter=? WHERE id=?", (salt, h, PBKDF2_ITER, uid))
    return True


def set_password(con, uid, password):
    check_new_password(password)
    salt, h = hash_pw(password)
    con.execute("UPDATE users SET pw_salt=?, pw_hash=?, pw_iter=? WHERE id=?", (salt, h, PBKDF2_ITER, uid))


def fail_slowly():
    time.sleep(0.4 + secrets.randbelow(400) / 1000)


def login(con, ip, username, password):
    ipk = ip_key(ip)
    limit(f"login-ip:{ipk}", 30, 900, "Demasiados intentos. Espera unos minutos.")
    uname = as_str(username).strip().lower()[:40]
    # El bloqueo duro es por usuario y conexión: un tercero no puede dejar fuera al dueño de la cuenta.
    if limiter.exceeded(f"login-fail:{uname}:{ipk}", 10, 900):
        raise ApiError(429, "Demasiados intentos fallidos. Espera 15 minutos.")
    # Muchos fallos desde muchas conexiones contra la misma cuenta: se frena, pero no se bloquea.
    if limiter.exceeded(f"login-fail-any:{uname}", 30, 900):
        time.sleep(2)
    row = user_row(con, "username", uname)
    if not row:
        hash_pw("x")  # mismo coste exista o no el usuario
    if not row or not verify_password(con, row[0], password):
        limiter.add(f"login-fail:{uname}:{ipk}", 900)
        limiter.add(f"login-fail-any:{uname}", 900)
        fail_slowly()
        raise ApiError(401, "Usuario o contraseña incorrectos")
    if row[7]:
        raise ApiError(403, "Esta cuenta está desactivada. Para descargar o borrar tus datos, contacta con el administrador.")
    limiter.reset(f"login-fail:{uname}:{ipk}")
    purge_tokens(con)
    return row


def auth_user(con, header):
    if not header or not header.startswith("Bearer "):
        raise ApiError(401, "Sin sesión")
    th = hashlib.sha256(header[7:].strip().encode()).hexdigest()
    t = con.execute("SELECT user_id, created_at, last_used FROM tokens WHERE token_hash=?", (th,)).fetchone()
    if not t:
        raise ApiError(401, "Sesión caducada")
    now = now_dt()
    if t[1] < iso(now - timedelta(days=TOKEN_MAX_DAYS)) or t[2] < iso(now - timedelta(days=TOKEN_IDLE_DAYS)):
        con.execute("DELETE FROM tokens WHERE token_hash=?", (th,))
        raise ApiError(401, "Sesión caducada")
    row = user_row(con, "id", t[0])
    if not row or row[7]:
        raise ApiError(401, "Sesión caducada")
    if t[2] < iso(now - timedelta(hours=1)):
        con.execute("UPDATE tokens SET last_used=? WHERE token_hash=?", (iso(now), th))
    return row, th


def find_user(con, username):
    row = user_row(con, "username", as_str(username).strip().lower()[:40])
    if not row or row[7]:
        raise ApiError(404, "No existe ese usuario")
    return row


# ---------- jornadas ----------
def clean_session(rec):
    """Valida y limpia una jornada recibida. Devuelve None si no es válida."""
    if not isinstance(rec, dict):
        return None
    rid = rec.get("id")
    if not isinstance(rid, str) or not ID_RE.match(rid):
        return None
    upd = rec.get("updatedAt")
    upd = upd[:40] if isinstance(upd, str) else ""
    if rec.get("deleted") is True:
        # Un borrado no guarda el contenido de la jornada.
        return {"id": rid, "updatedAt": upd, "deleted": True}
    out = {}
    for k, v in rec.items():
        if len(out) >= 80:
            break
        if not isinstance(k, str) or not KEY_RE.match(k) or k in ("dirty", "deleted"):
            continue
        if v is None or isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)):
            if math.isfinite(v) and abs(v) < 1e9:
                out[k] = v
        elif isinstance(v, str):
            out[k] = CTRL_RE.sub("", v)[:4000]
    for k in NUMERIC_FIELDS & out.keys():
        if not isinstance(out[k], (int, float)) or isinstance(out[k], bool):
            out[k] = None
    for k, allowed in ENUM_FIELDS.items():
        if k in out and out[k] not in allowed:
            out[k] = None
    if "private" in out and not isinstance(out["private"], bool):
        out["private"] = bool(out["private"])
    if not isinstance(out.get("date"), str) or not DATE_RE.match(out["date"]):
        return None
    if out.get("type") not in TYPES:
        out["type"] = "concurso"
    if out.get("modality") not in MODALITIES:
        out["modality"] = "feeder" if "modality" not in rec else "otra"
    out["id"], out["updatedAt"], out["deleted"] = rid, upd, False
    if len(json.dumps(out, ensure_ascii=False).encode()) > MAX_RECORD_BYTES:
        return None
    return out


def do_sync(con, uid, body):
    global _last_ts
    last = as_int(body.get("lastSyncAt") or 0)
    incoming = body.get("changes") or {}
    if not isinstance(incoming, dict):
        raise ApiError(400, "changes no válido")
    rejected = 0
    for kind in KINDS:
        items = incoming.get(kind) or []
        if not isinstance(items, list) or len(items) > MAX_RECORDS_PER_SYNC:
            raise ApiError(413, "Demasiados cambios en una sola sincronización")
        count, used = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data)),0) FROM records WHERE kind=? AND user_id=?", (kind, uid)
        ).fetchone()
        for raw in items:
            rec = clean_session(raw)
            if rec is None:
                rejected += 1
                continue
            rid, upd = rec["id"], rec["updatedAt"]
            cur = con.execute("SELECT updated_at,user_id FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
            if cur is not None and cur[1] is not None and cur[1] != uid:
                rejected += 1
                continue  # registro de otro usuario: no se toca
            data = json.dumps(rec, ensure_ascii=False)
            used += len(data)
            if used > MAX_USER_BYTES:
                raise ApiError(413, "Has llegado al máximo de espacio de tu cuenta")
            if cur is None:
                if count >= MAX_SESSIONS_PER_USER:
                    raise ApiError(413, "Has llegado al máximo de jornadas guardadas")
                count += 1
                con.execute(
                    "INSERT INTO records(kind,id,updated_at,server_ts,data,user_id) VALUES(?,?,?,?,?,?)",
                    (kind, rid, upd, next_ts(), data, uid),
                )
            elif cur[1] is None:
                # Jornada de la versión 1 (sin usuarios): pasa a ser de quien la sube desde su dispositivo.
                newer = upd > cur[0]
                con.execute(
                    "UPDATE records SET user_id=?, server_ts=?" + (", updated_at=?, data=?" if newer else "") + " WHERE kind=? AND id=?",
                    (uid, next_ts(), *((upd, data) if newer else ()), kind, rid),
                )
            elif upd > cur[0]:
                con.execute(
                    "UPDATE records SET updated_at=?, server_ts=?, data=? WHERE kind=? AND id=?",
                    (upd, next_ts(), data, kind, rid),
                )
    # Por si pesca-admin ha escrito marcas nuevas mientras el servicio estaba en marcha.
    _last_ts = max(_last_ts, con.execute("SELECT COALESCE(MAX(server_ts),0) FROM records").fetchone()[0])
    server_time = _last_ts
    out, more = {}, False
    for kind in KINDS:
        rows = con.execute(
            "SELECT data, server_ts FROM records WHERE kind=? AND user_id=? AND server_ts>? AND server_ts<=? ORDER BY server_ts LIMIT ?",
            (kind, uid, last, server_time, SYNC_PAGE + 1),
        ).fetchall()
        if len(rows) > SYNC_PAGE:
            # Respuesta por páginas: el cliente vuelve a pedir desde serverTime hasta que more=false.
            rows, more = rows[:SYNC_PAGE], True
            server_time = rows[-1][1]
        out[kind] = [json.loads(r[0]) for r in rows]
    return {"serverTime": server_time, "changes": out, "rejected": rejected, "more": more}


def live_sessions(con, uid):
    rows = con.execute("SELECT data FROM records WHERE kind='sessions' AND user_id=?", (uid,)).fetchall()
    return [s for s in (json.loads(r[0]) for r in rows) if not s.get("deleted")]


# ---------- amigos y bloqueos ----------
def friend_status(con, a, b):
    """'accepted', 'outgoing' (a pidió a b), 'incoming' (b pidió a a) o None."""
    r = con.execute("SELECT status FROM friendships WHERE requester=? AND addressee=?", (a, b)).fetchone()
    if r:
        return "accepted" if r[0] == "accepted" else "outgoing"
    r = con.execute("SELECT status FROM friendships WHERE requester=? AND addressee=?", (b, a)).fetchone()
    if r:
        return "accepted" if r[0] == "accepted" else "incoming"
    return None


def is_blocked(con, a, b):
    """True si cualquiera de los dos ha bloqueado al otro."""
    return con.execute(
        "SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)", (a, b, b, a)
    ).fetchone() is not None


def list_friends(con, uid):
    rows = con.execute(
        f"""SELECT f.requester, f.status, {', '.join('u.' + c for c in USER_COLS.split(','))}
            FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester=? THEN f.addressee ELSE f.requester END
            WHERE (f.requester=? OR f.addressee=?) AND u.disabled=0 ORDER BY u.name COLLATE NOCASE""",
        (uid, uid, uid),
    ).fetchall()
    res = {"friends": [], "incoming": [], "outgoing": [], "blocked": []}
    for req, status, *u in rows:
        key = "friends" if status == "accepted" else ("outgoing" if req == uid else "incoming")
        res[key].append(public_json(u))
    for u in con.execute(
        f"SELECT {', '.join('u.' + c for c in USER_COLS.split(','))} FROM blocks b JOIN users u ON u.id=b.blocked WHERE b.blocker=? ORDER BY u.name",
        (uid,),
    ):
        res["blocked"].append(public_json(u))
    return res


def friend_request(con, uid, username):
    other = find_user(con, username)
    if other[0] == uid:
        raise ApiError(400, "No puedes añadirte a ti mismo")
    if is_blocked(con, uid, other[0]):
        raise ApiError(403, "No es posible enviar la solicitud a este usuario")
    st = friend_status(con, uid, other[0])
    if st == "incoming":
        con.execute("UPDATE friendships SET status='accepted' WHERE requester=? AND addressee=?", (other[0], uid))
    elif st is None:
        pending = con.execute(
            "SELECT COUNT(*) FROM friendships WHERE requester=? AND status='pending'", (uid,)
        ).fetchone()[0]
        if pending >= MAX_PENDING_REQUESTS:
            raise ApiError(429, "Tienes demasiadas solicitudes pendientes")
        con.execute(
            "INSERT INTO friendships(requester,addressee,status,created_at) VALUES(?,?, 'pending', ?)",
            (uid, other[0], iso()),
        )


def friend_accept(con, uid, username):
    other = find_user(con, username)
    if friend_status(con, uid, other[0]) != "incoming":
        raise ApiError(400, "No hay solicitud de ese usuario")
    con.execute("UPDATE friendships SET status='accepted' WHERE requester=? AND addressee=?", (other[0], uid))


def unfriend(con, a, b):
    con.execute(
        "DELETE FROM friendships WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)", (a, b, b, a)
    )


def friend_sessions(con, uid, username):
    other = find_user(con, username)
    if friend_status(con, uid, other[0]) != "accepted":
        raise ApiError(403, "Solo puedes ver los datos de tus amigos")
    full = other[4] == "full"
    out = []
    sessions = sorted(live_sessions(con, other[0]), key=lambda s: s.get("date", ""), reverse=True)
    for s in sessions:
        if len(out) >= FRIEND_SESSIONS_MAX:
            break
        if s.get("private"):
            continue
        out.append(s if full else {k: v for k, v in s.items() if k in RESULT_FIELDS})
    for s in out:
        s.pop("private", None)
    return {"user": public_json(other), "shareLevel": other[4], "sessions": out}


def block(con, uid, username):
    other = find_user(con, username)
    if other[0] == uid:
        raise ApiError(400, "No puedes bloquearte a ti mismo")
    con.execute("INSERT OR IGNORE INTO blocks(blocker,blocked,created_at) VALUES(?,?,?)", (uid, other[0], iso()))
    unfriend(con, uid, other[0])


def unblock(con, uid, username):
    other = find_user(con, username)
    con.execute("DELETE FROM blocks WHERE blocker=? AND blocked=?", (uid, other[0]))


# ---------- chat ----------
def msg_json(r, uid):
    return {"id": r[0], "mine": r[1] == uid, "body": r[2], "createdAt": r[3], "read": r[4] is not None}


def chat_list(con, uid):
    rows = con.execute(
        """SELECT CASE WHEN sender=? THEN recipient ELSE sender END AS other, MAX(id)
           FROM messages WHERE sender=? OR recipient=? GROUP BY other""",
        (uid, uid, uid),
    ).fetchall()
    out = []
    for other, last_id in rows:
        u = user_row(con, "id", other)
        if not u or u[7]:
            continue
        m = con.execute("SELECT id,sender,body,created_at,read_at FROM messages WHERE id=?", (last_id,)).fetchone()
        unread = con.execute(
            "SELECT COUNT(*) FROM messages WHERE sender=? AND recipient=? AND read_at IS NULL", (other, uid)
        ).fetchone()[0]
        out.append({"user": public_json(u), "last": msg_json(m, uid), "unread": unread})
    out.sort(key=lambda c: c["last"]["id"], reverse=True)
    return {"chats": out}


def unread_count(con, uid):
    return con.execute(
        """SELECT COUNT(*) FROM messages m WHERE m.recipient=? AND m.read_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker=? AND b.blocked=m.sender)""",
        (uid, uid),
    ).fetchone()[0]


def chat_get(con, uid, username, after):
    other = find_user(con, username)
    if after > 0:
        rows = con.execute(
            """SELECT id,sender,body,created_at,read_at FROM messages
               WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND id>? ORDER BY id LIMIT 200""",
            (uid, other[0], other[0], uid, after),
        ).fetchall()
    else:
        rows = con.execute(
            """SELECT * FROM (SELECT id,sender,body,created_at,read_at FROM messages
               WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY id DESC LIMIT 200) ORDER BY id""",
            (uid, other[0], other[0], uid),
        ).fetchall()
    con.execute(
        "UPDATE messages SET read_at=? WHERE sender=? AND recipient=? AND read_at IS NULL", (iso(), other[0], uid)
    )
    can_send = friend_status(con, uid, other[0]) == "accepted" and not is_blocked(con, uid, other[0])
    # Hasta dónde ha leído el otro (para marcar "leído" en mis mensajes).
    seen = con.execute(
        "SELECT COALESCE(MAX(id),0) FROM messages WHERE sender=? AND recipient=? AND read_at IS NOT NULL",
        (uid, other[0]),
    ).fetchone()[0]
    return {"user": public_json(other), "messages": [msg_json(r, uid) for r in rows], "canSend": can_send, "seenUpTo": seen}


def chat_send(con, uid, username, body):
    other = find_user(con, username)
    text = clean_text(body, MAX_MESSAGE, multiline=True)
    if not text:
        raise ApiError(400, "El mensaje está vacío")
    if friend_status(con, uid, other[0]) != "accepted" or is_blocked(con, uid, other[0]):
        raise ApiError(403, "Solo puedes escribir a tus amigos")
    cur = con.execute(
        "INSERT INTO messages(sender,recipient,body,created_at) VALUES(?,?,?,?)", (uid, other[0], text, iso())
    )
    r = con.execute("SELECT id,sender,body,created_at,read_at FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    return {"message": msg_json(r, uid)}


def report(con, uid, body):
    other = find_user(con, body.get("username"))
    reason = body.get("reason")
    if reason not in REPORT_REASONS:
        raise ApiError(400, "Motivo no válido")
    msg_id, msg_body = body.get("messageId"), None
    if msg_id is not None:
        msg_id = as_int(msg_id)
        m = con.execute(
            "SELECT body FROM messages WHERE id=? AND sender=? AND recipient=?", (msg_id, other[0], uid)
        ).fetchone()
        if not m:
            raise ApiError(400, "Ese mensaje no existe")
        msg_body = m[0]
    con.execute(
        "INSERT INTO reports(reporter,reported,reported_name,message_id,message_body,reason,details,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (uid, other[0], other[1], msg_id, msg_body, reason, clean_text(body.get("details"), 500, multiline=True), iso()),
    )


# ---------- cuenta ----------
def update_profile(con, uid, body):
    if "name" in body:
        name = clean_text(body["name"], 40)
        if not name:
            raise ApiError(400, "El nombre no puede estar vacío")
        con.execute("UPDATE users SET name=? WHERE id=?", (name, uid))
    if "modalities" in body:
        con.execute("UPDATE users SET modalities=? WHERE id=?", (json.dumps(clean_modalities(body["modalities"])), uid))
    if "shareLevel" in body:
        if body["shareLevel"] not in SHARE_LEVELS:
            raise ApiError(400, "Opción no válida")
        con.execute("UPDATE users SET share_level=? WHERE id=?", (body["shareLevel"], uid))


def export_data(con, uid):
    u = con.execute(
        "SELECT username,name,modalities,share_level,created_at,consent_version,consent_at FROM users WHERE id=?", (uid,)
    ).fetchone()
    names = dict(con.execute("SELECT id, username FROM users"))
    msgs = con.execute(
        "SELECT id,sender,recipient,body,created_at,read_at FROM messages WHERE sender=? OR recipient=? ORDER BY id",
        (uid, uid),
    ).fetchall()
    return {
        "exportedAt": iso(),
        "app": "calendario-pesca",
        "version": VERSION,
        "account": {
            "username": u[0], "name": u[1], "modalities": json.loads(u[2]), "shareLevel": u[3],
            "createdAt": u[4], "consentVersion": u[5], "consentAt": u[6],
        },
        "sessions": live_sessions(con, uid),
        "friends": list_friends(con, uid),
        "messages": [
            {"from": names.get(m[1]), "to": names.get(m[2]), "body": m[3], "createdAt": m[4], "readAt": m[5]}
            for m in msgs
        ],
        "reportsFiled": [
            {"about": names.get(r[0]), "reason": r[1], "details": r[2], "createdAt": r[3], "status": r[4]}
            for r in con.execute(
                "SELECT reported,reason,details,created_at,status FROM reports WHERE reporter=?", (uid,)
            )
        ],
        "activeSessions": [
            {"createdAt": t[0], "lastUsed": t[1]}
            for t in con.execute("SELECT created_at, last_used FROM tokens WHERE user_id=? ORDER BY created_at", (uid,))
        ],
    }


def delete_account(con, uid):
    con.execute("DELETE FROM records WHERE user_id=?", (uid,))
    con.execute("DELETE FROM messages WHERE sender=? OR recipient=?", (uid, uid))
    con.execute("DELETE FROM users WHERE id=?", (uid,))  # tokens, amistades, bloqueos y denuncias en cascada


# ---------- HTTP ----------
def mask_path(path):
    """Para los registros: no guardar nombres de usuario."""
    return re.sub(r"^/api/(friends|chats)/[^/?]+", r"/api/\1/*", path.split("?", 1)[0])


# Rutas que se pueden usar sin haber aceptado la versión actual de la política.
CONSENT_FREE = {
    ("GET", "/api/me"), ("POST", "/api/me/consent"), ("GET", "/api/me/export"), ("POST", "/api/me/delete"),
    ("POST", "/api/auth/logout"), ("POST", "/api/auth/logout-others"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "pesca-api"
    sys_version = ""
    timeout = 30  # segundos por conexión, contra clientes lentos

    # -- respuesta --
    def _send(self, code, obj, extra_headers=None):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _ip(self):
        # Solo se fía de X-Real-IP porque el servicio escucha en 127.0.0.1 detrás de Caddy.
        return (self.headers.get("X-Real-IP") or self.client_address[0])[:64]

    def _body(self, max_len=MAX_BODY):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Content-Length no válido")
        if length <= 0:
            return {}
        if length > max_len:
            raise ApiError(413, "Petición demasiado grande")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise ApiError(415, "Se esperaba JSON")
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "JSON no válido")
        if not isinstance(body, dict):
            raise ApiError(400, "JSON no válido")
        return body

    def _handle(self, method):
        parts = urlsplit(self.path)
        path, query = parts.path, parse_qs(parts.query)
        try:
            if method == "GET" and path == "/api/health":
                return self._send(200, {"ok": True, "signup": ALLOW_SIGNUP, "version": VERSION, "policyVersion": POLICY_VERSION})
            if method == "GET" and path == "/api/legal":
                return self._send(200, {"operator": OPERATOR_NAME, "contact": OPERATOR_CONTACT, "policyVersion": POLICY_VERSION, "version": VERSION})
            if path == "/api/sync":
                # Antes de leer hasta 8 MB, se comprueba la sesión.
                with db() as con:
                    auth_user(con, self.headers.get("Authorization"))
            body = self._body(MAX_SYNC_BODY if path == "/api/sync" else MAX_BODY) if method == "POST" else {}
            ip = self._ip()

            if method == "POST" and path == "/api/auth/register":
                if not ALLOW_SIGNUP:
                    raise ApiError(403, "El registro está cerrado")
                if body.get("consent") is not True:
                    raise ApiError(400, "Tienes que aceptar la política de privacidad y las condiciones de uso")
                limit(f"register:{ip_key(ip)}", 5, 3600, "Demasiados registros desde esta conexión. Prueba más tarde.")
                limit("register-all", 60, 3600, "Ahora mismo no se pueden crear más cuentas. Prueba dentro de un rato.")
                with db() as con:
                    uid = create_user(con, body.get("username"), body.get("name"), body.get("password"), body.get("modalities"))
                    con.execute("UPDATE users SET consent_version=?, consent_at=? WHERE id=?", (POLICY_VERSION, iso(), uid))
                    code = new_recovery(con, uid)
                    token = new_token(con, uid)
                    row = user_row(con, "id", uid)
                return self._send(200, {"token": token, "user": me_json(row), "recoveryCode": code})

            if method == "POST" and path == "/api/auth/login":
                with db() as con:
                    row = login(con, ip, body.get("username"), body.get("password"))
                    token = new_token(con, row[0])
                    row = user_row(con, "id", row[0])
                return self._send(200, {"token": token, "user": me_json(row)})

            if method == "POST" and path == "/api/auth/recover":
                uname = as_str(body.get("username")).strip().lower()[:40]
                limit(f"recover-ip:{ip_key(ip)}", 10, 3600, "Demasiados intentos. Prueba más tarde.")
                limit(f"recover-user:{uname}:{ip_key(ip)}", 5, 3600, "Demasiados intentos con este usuario. Prueba más tarde.")
                limit(f"recover-any:{uname}", 30, 3600, "Demasiados intentos con este usuario. Prueba más tarde.")
                with db() as con:
                    row = user_row(con, "username", uname)
                    given = hashlib.sha256(normalize_recovery(body.get("code")).encode()).hexdigest()
                    if not row or not row[6] or not hmac.compare_digest(given, row[6]) or row[7]:
                        fail_slowly()
                        raise ApiError(401, "Usuario o código de recuperación incorrectos")
                    set_password(con, row[0], body.get("password"))
                    con.execute("DELETE FROM tokens WHERE user_id=?", (row[0],))
                    code = new_recovery(con, row[0])
                    token = new_token(con, row[0])
                    row = user_row(con, "id", row[0])
                return self._send(200, {"token": token, "user": me_json(row), "recoveryCode": code})

            with db() as con:
                resp = self._authed(con, method, path, query, body)
            # La respuesta sale después del commit: el cliente nunca ve un estado aún sin guardar.
            return self._send(*resp)
        except ApiError as e:
            self._send(e.code, {"error": e.msg, **e.extra})
        except Exception:
            traceback.print_exc()
            self._send(500, {"error": "Error interno"})

    def _authed(self, con, method, path, query, body):
        user, th = auth_user(con, self.headers.get("Authorization"))
        uid = user[0]
        route = (method, path)
        if user[5] != POLICY_VERSION and route not in CONSENT_FREE:
            raise ApiError(403, "Tienes que aceptar la política de privacidad actualizada", consentRequired=True)

        if route == ("POST", "/api/auth/logout"):
            con.execute("DELETE FROM tokens WHERE token_hash=?", (th,))
            return (200, {"ok": True})
        if route == ("POST", "/api/auth/logout-others"):
            n = con.execute("DELETE FROM tokens WHERE user_id=? AND token_hash<>?", (uid, th)).rowcount
            return (200, {"ok": True, "closed": n})

        if route == ("GET", "/api/me"):
            return (200, {"user": me_json(user)})
        if route == ("POST", "/api/me"):
            update_profile(con, uid, body)
            return (200, {"user": me_json(user_row(con, "id", uid))})
        if route == ("POST", "/api/me/consent"):
            if body.get("version") != POLICY_VERSION:
                raise ApiError(400, "Versión de la política no válida")
            con.execute("UPDATE users SET consent_version=?, consent_at=? WHERE id=?", (POLICY_VERSION, iso(), uid))
            return (200, {"user": me_json(user_row(con, "id", uid))})
        if route in (("POST", "/api/me/password"), ("POST", "/api/me/recovery"), ("POST", "/api/me/delete")):
            limit(f"pw-check:{uid}", 10, 900, "Demasiados intentos. Espera unos minutos.")
            if not verify_password(con, uid, body.get("current") if path.endswith("password") else body.get("password")):
                fail_slowly()
                raise ApiError(401, "La contraseña no es correcta")
            if path.endswith("/password"):
                set_password(con, uid, body.get("password"))
                con.execute("DELETE FROM tokens WHERE user_id=? AND token_hash<>?", (uid, th))
                return (200, {"ok": True})
            if path.endswith("/recovery"):
                return (200, {"recoveryCode": new_recovery(con, uid)})
            delete_account(con, uid)
            return (200, {"ok": True})
        if route == ("GET", "/api/me/export"):
            limit(f"export:{uid}", 10, 3600)
            return (200, export_data(con, uid), {
                "Content-Disposition": f'attachment; filename="calendario-pesca-{user[1]}.json"'})

        if route == ("POST", "/api/sync"):
            limit(f"sync:{uid}", 120, 60)
            con.commit()
            # La escritura y su commit van dentro del candado: así ningún cliente recibe un
            # serverTime que incluya marcas de cambios aún sin confirmar.
            with _sync_lock, db() as scon:
                result = do_sync(scon, uid, body)
            return (200, result)

        if route == ("GET", "/api/friends"):
            return (200, list_friends(con, uid))
        if method == "POST" and path in ("/api/friends/request", "/api/friends/accept", "/api/friends/remove"):
            limit(f"friends:{uid}", 60, 3600)
            action = path.rsplit("/", 1)[1]
            if action == "request":
                friend_request(con, uid, body.get("username"))
            elif action == "accept":
                friend_accept(con, uid, body.get("username"))
            else:
                unfriend(con, uid, find_user(con, body.get("username"))[0])
            return (200, list_friends(con, uid))
        if method == "POST" and path in ("/api/blocks", "/api/blocks/remove"):
            limit(f"friends:{uid}", 60, 3600)
            (block if path == "/api/blocks" else unblock)(con, uid, body.get("username"))
            return (200, list_friends(con, uid))
        m = re.match(r"^/api/friends/([^/]+)/sessions$", path)
        if method == "GET" and m:
            return (200, friend_sessions(con, uid, unquote(m.group(1))))

        if route == ("GET", "/api/chats"):
            return (200, chat_list(con, uid))
        if route == ("GET", "/api/chats/unread"):
            return (200, {"count": unread_count(con, uid)})
        m = re.match(r"^/api/chats/([^/]+)$", path)
        if m:
            other = unquote(m.group(1))
            if method == "GET":
                try:
                    after = min(max(0, int((query.get("after") or ["0"])[0][:18])), 2**62)
                except ValueError:
                    after = 0
                return (200, chat_get(con, uid, other, after))
            limit(f"msg:{uid}", 30, 60, "Estás enviando mensajes muy rápido. Espera un momento.")
            limit(f"msg-day:{uid}", 1000, 86400, "Has llegado al límite de mensajes de hoy.")
            return (200, chat_send(con, uid, other, body.get("body")))
        if route == ("POST", "/api/reports"):
            limit(f"report:{uid}", 20, 86400)
            report(con, uid, body)
            return (200, {"ok": True})
        raise ApiError(404, "No encontrado")

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    # Registros sin IPs ni nombres de usuario; solo errores.
    def log_request(self, code="-", size="-"):
        try:
            if int(code) >= 400:
                print(f"{self.command} {mask_path(self.path)} {code}", flush=True)
        except (TypeError, ValueError):
            pass

    def log_error(self, fmt, *args):
        code = args[0] if args and isinstance(args[0], int) else "-"
        print(f"error HTTP {code} (petición no válida)", flush=True)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


# ---------- administración ----------
def ask_password():
    p1 = getpass.getpass("Contraseña nueva: ")
    p2 = getpass.getpass("Repítela: ")
    if p1 != p2:
        sys.exit("No coinciden.")
    return p1


def admin(argv):
    init_db()
    cmd, args = argv[0], argv[1:]
    with db() as con:
        try:
            if cmd == "users":
                for r in con.execute(
                    """SELECT u.username, u.name, u.created_at, u.disabled, u.share_level,
                              (SELECT COUNT(*) FROM records r WHERE r.user_id=u.id AND json_extract(r.data,'$.deleted') IS NOT 1)
                       FROM users u ORDER BY u.id"""
                ):
                    flag = "  DESACTIVADA" if r[3] else ""
                    print(f"{r[0]:<20} {r[1]:<24} {r[5]:>5} jornadas   comparte: {r[4]:<7}  alta {r[2][:10]}{flag}")
                orphan = con.execute("SELECT COUNT(*) FROM records WHERE user_id IS NULL").fetchone()[0]
                if orphan:
                    print(f"\n{orphan} jornadas de la versión sin usuarios. Asígnalas con: pesca-admin claim <usuario>")
                open_reports = con.execute("SELECT COUNT(*) FROM reports WHERE status='open'").fetchone()[0]
                if open_reports:
                    print(f"\n{open_reports} denuncias pendientes. Míralas con: pesca-admin reports")
            elif cmd == "adduser" and args:
                uid = create_user(con, args[0], " ".join(args[1:]) or args[0], ask_password(), ["feeder"])
                print(f"Creado {args[0]}. Al entrar tendrá que aceptar la política de privacidad y elegir sus modalidades.")
            elif cmd == "passwd" and args:
                u = find_user(con, args[0])
                set_password(con, u[0], ask_password())
                con.execute("DELETE FROM tokens WHERE user_id=?", (u[0],))
                print(f"Contraseña de {u[1]} cambiada. Tendrá que volver a entrar en sus dispositivos.")
            elif cmd == "claim" and args:
                u = find_user(con, args[0])
                ids = [r[0] for r in con.execute("SELECT id FROM records WHERE user_id IS NULL ORDER BY server_ts")]
                with _sync_lock:
                    global _last_ts
                    _last_ts = con.execute("SELECT COALESCE(MAX(server_ts),0) FROM records").fetchone()[0]
                    for rid in ids:
                        con.execute("UPDATE records SET user_id=?, server_ts=? WHERE kind='sessions' AND id=?", (u[0], next_ts(), rid))
                print(f"{len(ids)} jornadas asignadas a {u[1]}. Aparecerán en su app al sincronizar.")
            elif cmd == "deluser" and args:
                u = user_row(con, "username", args[0].lower())
                if not u:
                    sys.exit("No existe ese usuario.")
                if input(f"¿Borrar {u[1]} y TODOS sus datos (jornadas y mensajes)? Escribe el usuario para confirmar: ").strip() != u[1]:
                    sys.exit("Cancelado.")
                delete_account(con, u[0])
                print("Borrado.")
            elif cmd in ("disable", "enable") and args:
                u = user_row(con, "username", args[0].lower())
                if not u:
                    sys.exit("No existe ese usuario.")
                con.execute("UPDATE users SET disabled=? WHERE id=?", (1 if cmd == "disable" else 0, u[0]))
                if cmd == "disable":
                    con.execute("DELETE FROM tokens WHERE user_id=?", (u[0],))
                print(f"{u[1]} {'desactivada: no puede entrar y no aparece a nadie' if cmd == 'disable' else 'activada'}.")
            elif cmd == "reports":
                one_line = lambda t: CTRL_RE.sub("", (t or "").replace("\n", " ⏎ "))
                where = "" if "--all" in args else "WHERE r.status='open'"
                rows = con.execute(
                    f"""SELECT r.id, r.created_at, COALESCE(a.username, '(cuenta eliminada)'),
                               COALESCE(b.username, r.reported_name || ' (cuenta eliminada)'),
                               r.reason, r.details, r.message_body, r.status
                        FROM reports r LEFT JOIN users a ON a.id=r.reporter LEFT JOIN users b ON b.id=r.reported
                        {where} ORDER BY r.id"""
                ).fetchall()
                if not rows:
                    print("No hay denuncias pendientes.")
                for r in rows:
                    print(f"#{r[0]}  {r[1][:16]}  {r[2]} denuncia a {r[3]}  motivo: {r[4]}  [{r[7]}]")
                    if r[5]:
                        print(f"     detalle: {one_line(r[5])!r}")
                    if r[6]:
                        print(f"     mensaje: {one_line(r[6])!r}")
                if rows:
                    print("\nMarcar como revisada: pesca-admin resolve <id>   ·   Desactivar cuenta: pesca-admin disable <usuario>")
            elif cmd == "resolve" and args:
                n = con.execute("UPDATE reports SET status='resolved', resolved_at=? WHERE id=?", (iso(), args[0].lstrip("#"))).rowcount
                print("Marcada como revisada." if n else "No existe esa denuncia.")
            else:
                sys.exit(__doc__.split("Administración")[1])
        except ApiError as e:
            sys.exit(e.msg)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        admin(sys.argv[1:])
        sys.exit(0)
    init_db()
    print(
        f"pesca-api {VERSION} escuchando en {HOST}:{PORT}, registro {'abierto' if ALLOW_SIGNUP else 'cerrado'}"
        + ("" if OPERATOR_NAME else " · AVISO: falta PESCA_OPERATOR_NAME para la política de privacidad"),
        flush=True,
    )
    Server((HOST, PORT), Handler).serve_forever()
