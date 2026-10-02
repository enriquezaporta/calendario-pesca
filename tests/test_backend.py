"""Pruebas del backend. Solo librería estándar:  python3 -m unittest discover -s tests -v"""
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="pesca-test-")
os.environ["PESCA_DB"] = os.path.join(TMP, "test.db")
os.environ["PESCA_OPERATOR_NAME"] = "Pruebas"
sys.path.insert(0, os.path.join(ROOT, "backend"))
import server  # noqa: E402

server.PBKDF2_ITER = 1000          # más rápido en pruebas
server.fail_slowly = lambda: None


def start_server():
    server.init_db()
    httpd = server.Server(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


HTTPD = start_server()
BASE = f"http://127.0.0.1:{HTTPD.server_address[1]}/api"
MODS = ["feeder", "carpfishing"]


def call(method, path, body=None, token=None, ctype="application/json", ip="10.0.0.1"):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    req.add_header("X-Real-IP", ip)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


_n = [0]


def register(name=None, password="pesca-1234", mods=MODS):
    _n[0] += 1
    username = name or f"user{_n[0]}"
    st, res = call("POST", "/auth/register", {
        "username": username, "name": username.title(), "password": password, "modalities": mods, "consent": True,
    }, ip=f"10.1.{_n[0] // 200}.{_n[0] % 200}")
    assert st == 200, res
    return res["token"], res


def session(sid, **kw):
    s = {"id": sid, "type": "concurso", "modality": "feeder", "date": "2026-09-27",
         "updatedAt": "2026-09-27T10:00:00Z", "weightG": 8450, "pieces": 37, "notes": "secreto", "groundbait": "mezcla"}
    s.update(kw)
    return s


def sync(token, sessions=(), last=0):
    return call("POST", "/sync", {"lastSyncAt": last, "changes": {"sessions": list(sessions)}}, token)


def befriend(ta, ua, tb, ub):
    assert call("POST", "/friends/request", {"username": ub}, ta)[0] == 200
    assert call("POST", "/friends/accept", {"username": ua}, tb)[0] == 200


class AuthTests(unittest.TestCase):
    def test_register_requires_consent_and_strong_password(self):
        st, res = call("POST", "/auth/register", {"username": "sinconsent", "password": "pesca-1234", "modalities": MODS})
        self.assertEqual(st, 400)
        st, res = call("POST", "/auth/register", {"username": "corta", "password": "123", "modalities": MODS, "consent": True})
        self.assertEqual(st, 400)
        st, res = call("POST", "/auth/register", {"username": "sinmod", "password": "pesca-1234", "modalities": [], "consent": True})
        self.assertEqual(st, 400)

    def test_register_returns_recovery_and_profile(self):
        token, res = register(mods=["coup", "nope", "mosca"])
        self.assertRegex(res["recoveryCode"], r"^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$")
        self.assertEqual(res["user"]["modalities"], ["coup", "mosca"])
        self.assertEqual(res["user"]["shareLevel"], "results")   # privacidad por defecto
        self.assertFalse(res["user"]["needsConsent"])

    def test_duplicate_username(self):
        register("repetido")
        st, _ = call("POST", "/auth/register", {"username": "repetido", "password": "pesca-1234", "modalities": MODS, "consent": True}, ip="10.9.9.9")
        self.assertEqual(st, 409)

    def test_login_and_rate_limit(self):
        register("bloqueo")
        for i in range(10):
            self.assertEqual(call("POST", "/auth/login", {"username": "bloqueo", "password": "mal"}, ip="10.2.0.1")[0], 401)
        st, _ = call("POST", "/auth/login", {"username": "bloqueo", "password": "pesca-1234"}, ip="10.2.0.1")
        self.assertEqual(st, 429, "tras 10 fallos desde la misma conexión, esa conexión queda frenada")
        st, _ = call("POST", "/auth/login", {"username": "bloqueo", "password": "pesca-1234"}, ip="10.2.9.9")
        self.assertEqual(st, 200, "un atacante no puede dejar fuera al dueño desde otra conexión")

    def test_ipv6_grouped_by_64(self):
        self.assertEqual(server.ip_key("2001:db8:1:2:aaaa::1"), server.ip_key("2001:db8:1:2:bbbb::9"))
        self.assertNotEqual(server.ip_key("2001:db8:1:2::1"), server.ip_key("2001:db8:1:3::1"))
        self.assertEqual(server.ip_key("no es una ip"), "invalid")

    def test_rate_limiter_forgets_expired_keys(self):
        rl = server.RateLimiter()
        rl.allow("a", 1, 0.01)
        import time as _t
        _t.sleep(0.02)
        rl._last_sweep -= 120
        rl.allow("b", 1, 60)
        self.assertNotIn("a", rl._hits)

    def test_bad_types_are_400_not_500(self):
        token, _ = register()
        self.assertEqual(call("POST", "/auth/login", {"username": ["x"], "password": ["y"]}, ip="10.8.0.1")[0], 401)
        self.assertEqual(call("POST", "/sync", {"lastSyncAt": 1e30, "changes": {}}, token)[0], 400)
        self.assertEqual(call("POST", "/sync", {"lastSyncAt": "x", "changes": {}}, token)[0], 400)
        self.assertEqual(call("GET", "/chats/nadie?after=" + "9" * 40, token=token)[0], 404)
        self.assertEqual(call("POST", "/me/password", {"current": ["x"], "password": "nueva-clave-1"}, token)[0], 401)

    def test_login_ok_and_logout(self):
        register("entra")
        st, res = call("POST", "/auth/login", {"username": "Entra ", "password": "pesca-1234"}, ip="10.3.0.1")
        self.assertEqual(st, 200)
        self.assertEqual(call("GET", "/me", token=res["token"])[0], 200)
        self.assertEqual(call("POST", "/auth/logout", {}, res["token"])[0], 200)
        self.assertEqual(call("GET", "/me", token=res["token"])[0], 401)

    def test_json_content_type_required(self):
        st, _ = call("POST", "/auth/login", {"username": "x", "password": "y"}, ctype="text/plain")
        self.assertEqual(st, 415)

    def test_recovery_code(self):
        token, res = register("recupera")
        code = res["recoveryCode"]
        st, _ = call("POST", "/auth/recover", {"username": "recupera", "code": "AAAA-BBBB-CCCC-DDDD", "password": "nueva-clave-1"}, ip="10.4.0.1")
        self.assertEqual(st, 401)
        st, rec = call("POST", "/auth/recover", {"username": "recupera", "code": code.lower().replace("-", " "), "password": "nueva-clave-1"}, ip="10.4.0.2")
        self.assertEqual(st, 200)
        self.assertNotEqual(rec["recoveryCode"], code)
        self.assertEqual(call("GET", "/me", token=token)[0], 401, "las sesiones antiguas se cierran")
        self.assertEqual(call("POST", "/auth/login", {"username": "recupera", "password": "nueva-clave-1"}, ip="10.4.0.3")[0], 200)
        # El código usado ya no vale.
        self.assertEqual(call("POST", "/auth/recover", {"username": "recupera", "code": code, "password": "otra-clave-22"}, ip="10.4.0.4")[0], 401)

    def test_change_password_closes_other_sessions(self):
        t1, _ = register("cambia")
        t2 = call("POST", "/auth/login", {"username": "cambia", "password": "pesca-1234"}, ip="10.5.0.1")[1]["token"]
        self.assertEqual(call("POST", "/me/password", {"current": "mal", "password": "nueva-clave-1"}, t1)[0], 401)
        self.assertEqual(call("POST", "/me/password", {"current": "pesca-1234", "password": "nueva-clave-1"}, t1)[0], 200)
        self.assertEqual(call("GET", "/me", token=t1)[0], 200)
        self.assertEqual(call("GET", "/me", token=t2)[0], 401)

    def test_logout_others(self):
        t1, _ = register("otras")
        t2 = call("POST", "/auth/login", {"username": "otras", "password": "pesca-1234"}, ip="10.6.0.1")[1]["token"]
        st, res = call("POST", "/auth/logout-others", {}, t1)
        self.assertEqual((st, res["closed"]), (200, 1))
        self.assertEqual(call("GET", "/me", token=t2)[0], 401)

    def test_token_expires_when_idle(self):
        token, _ = register("caduca")
        with sqlite3.connect(os.environ["PESCA_DB"]) as con:
            con.execute("UPDATE tokens SET last_used='2020-01-01T00:00:00Z' WHERE token_hash=?",
                        (hashlib.sha256(token.encode()).hexdigest(),))
        self.assertEqual(call("GET", "/me", token=token)[0], 401)

    def test_profile_update(self):
        token, _ = register("perfil")
        st, res = call("POST", "/me", {"name": " Nuevo\nNombre ", "modalities": ["surfcasting"], "shareLevel": "full"}, token)
        self.assertEqual(st, 200)
        self.assertEqual(res["user"]["name"], "Nuevo Nombre")
        self.assertEqual(res["user"]["modalities"], ["surfcasting"])
        self.assertEqual(res["user"]["shareLevel"], "full")
        self.assertEqual(call("POST", "/me", {"shareLevel": "todo"}, token)[0], 400)


class SyncTests(unittest.TestCase):
    def test_isolation_and_ownership(self):
        ta, _ = register()
        tb, _ = register()
        st, res = sync(ta, [session("aaaaaaaa-0001")])
        self.assertEqual(st, 200)
        # B intenta sobrescribir la jornada de A conociendo su id.
        st, res = sync(tb, [session("aaaaaaaa-0001", title="HACK", updatedAt="2099-01-01T00:00:00Z")])
        self.assertEqual(res["rejected"], 1)
        self.assertEqual(res["changes"]["sessions"], [])
        _, res = sync(ta)
        self.assertEqual(res["changes"]["sessions"][0].get("title"), None)

    def test_cleaning(self):
        token, _ = register()
        bad = [
            {"id": "x", "date": "2026-01-01"},                          # id corto
            {"id": "bbbbbbbb-0001", "date": "ayer"},                   # fecha mala
            "no es un objeto",
        ]
        good = session("bbbbbbbb-0002", _owner="otro", dirty=1, extra={"a": 1}, type="raro", modality="inventada",
                       notes="x" * 5000, **{"mal clave": 1})
        st, res = sync(token, bad + [good])
        self.assertEqual(res["rejected"], 3)
        rec = res["changes"]["sessions"][0]
        self.assertNotIn("_owner", rec)
        self.assertNotIn("dirty", rec)
        self.assertNotIn("extra", rec)
        self.assertNotIn("mal clave", rec)
        self.assertEqual(rec["type"], "concurso")
        self.assertEqual(rec["modality"], "otra")
        self.assertEqual(len(rec["notes"]), 4000)

    def test_old_records_default_to_feeder(self):
        token, _ = register()
        s = session("cccccccc-0001")
        del s["modality"]
        _, res = sync(token, [s])
        self.assertEqual(res["changes"]["sessions"][0]["modality"], "feeder")

    def test_delete_drops_content(self):
        token, _ = register()
        sync(token, [session("dddddddd-0001")])
        _, res = sync(token, [{"id": "dddddddd-0001", "updatedAt": "2026-09-28T00:00:00Z", "deleted": True, "notes": "x"}])
        self.assertEqual(res["changes"]["sessions"][-1], {"id": "dddddddd-0001", "updatedAt": "2026-09-28T00:00:00Z", "deleted": True})

    def test_last_write_wins_and_incremental(self):
        token, _ = register()
        _, r1 = sync(token, [session("eeeeeeee-0001", title="v1")])
        _, r2 = sync(token, [session("eeeeeeee-0001", title="viejo", updatedAt="2020-01-01T00:00:00Z")], r1["serverTime"])
        self.assertEqual(r2["changes"]["sessions"], [])
        _, r3 = sync(token, [session("eeeeeeee-0001", title="v2", updatedAt="2026-12-01T00:00:00Z")], r1["serverTime"])
        self.assertEqual([s["title"] for s in r3["changes"]["sessions"]], ["v2"])


    def test_numeric_and_enum_fields_validated(self):
        token, _ = register()
        _, res = sync(token, [session("abcdefab-0001", pieces="<meta http-equiv=refresh>", sectorRank="<a>",
                                      weightG=True, sky="<b>", tide="Subiendo", private="si")])
        rec = res["changes"]["sessions"][0]
        self.assertIsNone(rec["pieces"])
        self.assertIsNone(rec["sectorRank"])
        self.assertIsNone(rec["weightG"])
        self.assertIsNone(rec["sky"])
        self.assertEqual(rec["tide"], "Subiendo")
        self.assertIs(rec["private"], True)

    def test_sync_is_paged(self):
        token, _ = register()
        old = server.SYNC_PAGE
        server.SYNC_PAGE = 3
        try:
            sync(token, [session(f"fedcba98-{i:04d}") for i in range(7)])
            got, last, pages = [], 0, 0
            while True:
                _, res = sync(token, [], last)
                got += res["changes"]["sessions"]
                last, pages = res["serverTime"], pages + 1
                if not res["more"]:
                    break
            self.assertEqual((len(got), pages), (7, 3))
        finally:
            server.SYNC_PAGE = old

    def test_sync_requires_auth_before_body(self):
        st, _ = call("POST", "/sync", {"lastSyncAt": 0, "changes": {}})
        self.assertEqual(st, 401)


class FriendsAndChatTests(unittest.TestCase):
    def setUp(self):
        self.ta, ra = register()
        self.tb, rb = register()
        self.ua, self.ub = ra["user"]["username"], rb["user"]["username"]

    def test_non_friends_cannot_see_or_write(self):
        self.assertEqual(call("GET", f"/friends/{self.ub}/sessions", token=self.ta)[0], 403)
        self.assertEqual(call("POST", f"/chats/{self.ub}", {"body": "hola"}, self.ta)[0], 403)

    def test_share_levels_and_private(self):
        sync(self.tb, [session("ffffffff-0001"), session("ffffffff-0002", private=True)])
        befriend(self.ta, self.ua, self.tb, self.ub)
        st, res = call("GET", f"/friends/{self.ub}/sessions", token=self.ta)
        self.assertEqual(st, 200)
        self.assertEqual([s["id"] for s in res["sessions"]], ["ffffffff-0001"], "las privadas no se comparten")
        s = res["sessions"][0]
        self.assertNotIn("notes", s)          # "solo resultados" por defecto
        self.assertNotIn("groundbait", s)
        self.assertEqual(s["weightG"], 8450)
        self.assertNotIn("id", res["user"])   # no se expone el id interno
        call("POST", "/me", {"shareLevel": "full"}, self.tb)
        s = call("GET", f"/friends/{self.ub}/sessions", token=self.ta)[1]["sessions"][0]
        self.assertEqual(s["notes"], "secreto")
        self.assertNotIn("private", s)

    def test_chat_flow(self):
        befriend(self.ta, self.ua, self.tb, self.ub)
        st, res = call("POST", f"/chats/{self.ub}", {"body": "  ¿Vamos el domingo?\n<b>al embalse</b>  "}, self.ta)
        self.assertEqual(st, 200)
        self.assertEqual(res["message"]["body"], "¿Vamos el domingo?\n<b>al embalse</b>")  # se guarda tal cual; la app lo escapa
        self.assertEqual(call("GET", "/chats/unread", token=self.tb)[1]["count"], 1)
        chats = call("GET", "/chats", token=self.tb)[1]["chats"]
        self.assertEqual((chats[0]["user"]["username"], chats[0]["unread"]), (self.ua, 1))
        st, conv = call("GET", f"/chats/{self.ua}", token=self.tb)
        self.assertTrue(conv["canSend"])
        self.assertFalse(conv["messages"][0]["mine"])
        self.assertEqual(call("GET", "/chats/unread", token=self.tb)[1]["count"], 0)
        last = conv["messages"][-1]["id"]
        call("POST", f"/chats/{self.ua}", {"body": "Sí"}, self.tb)
        new = call("GET", f"/chats/{self.ub}?after={last}", token=self.ta)[1]
        self.assertEqual([m["body"] for m in new["messages"]], ["Sí"])
        self.assertEqual(new["seenUpTo"], last)
        self.assertEqual(call("POST", f"/chats/{self.ub}", {"body": "   "}, self.ta)[0], 400)
        self.assertEqual(call("POST", f"/chats/{self.ub}", {"body": "x" * 3000}, self.ta)[1]["message"]["body"], "x" * 2000)

    def test_block_and_report(self):
        befriend(self.ta, self.ua, self.tb, self.ub)
        mid = call("POST", f"/chats/{self.ua}", {"body": "spam"}, self.tb)[1]["message"]["id"]
        self.assertEqual(call("POST", "/reports", {"username": self.ub, "messageId": mid, "reason": "spam"}, self.ta)[0], 200)
        self.assertEqual(call("POST", "/reports", {"username": self.ub, "messageId": mid + 999, "reason": "spam"}, self.ta)[0], 400)
        st, res = call("POST", "/blocks", {"username": self.ub}, self.ta)
        self.assertEqual([u["username"] for u in res["blocked"]], [self.ub])
        self.assertEqual(res["friends"], [])
        self.assertEqual(call("POST", f"/chats/{self.ua}", {"body": "hola"}, self.tb)[0], 403)
        self.assertEqual(call("POST", "/friends/request", {"username": self.ua}, self.tb)[0], 403)
        # Si el denunciado borra su cuenta, la denuncia se conserva para el administrador.
        call("POST", "/me/delete", {"password": "pesca-1234"}, self.tb)
        with sqlite3.connect(os.environ["PESCA_DB"]) as con:
            self.assertEqual(con.execute("SELECT reported_name, message_body FROM reports WHERE reported_name=?", (self.ub,)).fetchone(), (self.ub, "spam"))

    def test_unblock(self):
        call("POST", "/blocks", {"username": self.ub}, self.ta)
        self.assertEqual(call("POST", "/friends/request", {"username": self.ua}, self.tb)[0], 403)
        call("POST", "/blocks/remove", {"username": self.ub}, self.ta)
        self.assertEqual(call("POST", "/friends/request", {"username": self.ua}, self.tb)[0], 200)


class PrivacyTests(unittest.TestCase):
    def test_export_and_delete(self):
        ta, ra = register()
        tb, rb = register()
        ua, ub = ra["user"]["username"], rb["user"]["username"]
        sync(ta, [session("99999999-0001")])
        befriend(ta, ua, tb, ub)
        call("POST", f"/chats/{ub}", {"body": "hola"}, ta)
        st, data = call("GET", "/me/export", token=ta)
        self.assertEqual(st, 200)
        self.assertEqual(data["account"]["username"], ua)
        self.assertEqual(len(data["sessions"]), 1)
        self.assertEqual(data["messages"][0]["body"], "hola")
        self.assertEqual(call("POST", "/me/delete", {"password": "mal"}, ta)[0], 401)
        self.assertEqual(call("POST", "/me/delete", {"password": "pesca-1234"}, ta)[0], 200)
        self.assertEqual(call("GET", "/me", token=ta)[0], 401)
        self.assertEqual(call("GET", f"/chats/{ua}", token=tb)[0], 404)
        self.assertEqual(call("GET", "/friends", token=tb)[1]["friends"], [])
        with sqlite3.connect(os.environ["PESCA_DB"]) as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM records WHERE id='99999999-0001'").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM messages WHERE body='hola'").fetchone()[0], 0)

    def test_consent_required_for_outdated_policy(self):
        token, res = register()
        with sqlite3.connect(os.environ["PESCA_DB"]) as con:
            con.execute("UPDATE users SET consent_version='2000-01' WHERE username=?", (res["user"]["username"],))
        st, body = sync(token)
        self.assertEqual((st, body.get("consentRequired")), (403, True))
        self.assertTrue(call("GET", "/me", token=token)[1]["user"]["needsConsent"])
        self.assertEqual(call("POST", "/me/consent", {"version": server.POLICY_VERSION}, token)[0], 200)
        self.assertEqual(sync(token)[0], 200)

    def test_public_endpoints_do_not_leak(self):
        self.assertNotEqual(call("GET", "/stats")[0], 200)   # ya no hay estadísticas públicas
        st, legal = call("GET", "/legal")
        self.assertEqual((st, legal["operator"]), (200, "Pruebas"))


class MigrationTests(unittest.TestCase):
    def test_upgrade_from_v1_and_v3(self):
        path = os.path.join(TMP, "old.db")
        con = sqlite3.connect(path)
        # Esquema de la versión 3 (usuarios con contraseña de 200.000 iteraciones) + jornada huérfana de la v1.
        con.executescript("""
            CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, updated_at TEXT NOT NULL,
                server_ts INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, id));
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                pw_salt BLOB NOT NULL, pw_hash BLOB NOT NULL, created_at TEXT NOT NULL);
        """)
        salt = b"0123456789abcdef"
        con.execute("INSERT INTO users(username,name,pw_salt,pw_hash,created_at) VALUES(?,?,?,?,?)",
                    ("veterano", "Veterano", salt, hashlib.pbkdf2_hmac("sha256", b"vieja1", salt, 200000), "2026-10-01T00:00:00Z"))
        con.execute("INSERT INTO records VALUES('sessions','12345678-aaaa','2026-09-01T00:00:00Z',5,?)",
                    (json.dumps({"id": "12345678-aaaa", "date": "2026-09-01", "type": "concurso"}),))
        con.commit()
        con.close()
        old, old_iter = server.DB_PATH, server.PBKDF2_ITER
        try:
            server.DB_PATH = path
            server.PBKDF2_ITER = 250_000
            server.init_db()
            server.init_db()  # idempotente
            with server.db() as c:
                row = c.execute("SELECT pw_iter, modalities, share_level, consent_version FROM users").fetchone()
                self.assertEqual(row, (200000, '["feeder"]', "full", None))
                u = server.login(c, "10.7.0.1", "veterano", "vieja1")       # la contraseña de 6 letras sigue valiendo
                self.assertEqual(c.execute("SELECT pw_iter FROM users").fetchone()[0], server.PBKDF2_ITER)  # y se rehace
                self.assertTrue(server.me_json(server.user_row(c, "id", u[0]))["needsConsent"])
                res = server.do_sync(c, u[0], {"lastSyncAt": 0, "changes": {"sessions": [
                    {"id": "12345678-aaaa", "date": "2026-09-01", "updatedAt": "2026-09-01T00:00:00Z"}]}})
                self.assertEqual(res["changes"]["sessions"][0]["id"], "12345678-aaaa")  # la huérfana pasa a ser suya
        finally:
            server.DB_PATH, server.PBKDF2_ITER = old, old_iter


if __name__ == "__main__":
    unittest.main(verbosity=2)
