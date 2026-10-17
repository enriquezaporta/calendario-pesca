#!/usr/bin/env python3
"""Genera las capturas de docs/img con datos de ejemplo (necesita Playwright con Chromium):

    pip install playwright && playwright install chromium
    python3 tools/screenshots.py

Levanta la app con tools/dev.py en una base de datos temporal, crea dos pescadores de ejemplo con su
temporada, amistad y chat, y fotografía las pantallas en móvil y escritorio.
"""
import asyncio
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "img")
PORT, API_PORT = 8765, 8766
BASE = f"http://127.0.0.1:{PORT}"


def api(path, body=None, token=None):
    req = urllib.request.Request(BASE + "/api" + path, method="POST" if body is not None else "GET",
                                 data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def season(rnd, mods, venues, comps, skill):
    """Una temporada inventada pero creíble."""
    out = []
    today = time.strftime("%Y-%m-%d")
    dates = sorted({f"2026-{m:02d}-{d:02d}" for m in range(2, 11) for d in (4, 11, 18, 25) if rnd.random() < 0.45})
    dates = [d for d in dates if d < today] or dates
    for i, date in enumerate(dates):
        mod = mods[i % len(mods)]
        kind = rnd.choice(["concurso", "campeonato", "entrenamiento", "concurso"])
        w = int(rnd.gauss(7500, 2500) * skill)
        s = {"id": str(uuid.uuid4()), "date": date, "time": "08:00", "type": kind, "modality": mod,
             **dict(zip(("town", "venue"), rnd.choice(venues))), "weightG": max(w, 600), "pieces": max(3, int(w / rnd.randint(180, 320))),
             "updatedAt": f"{date}T18:00:00Z", "sky": rnd.choice(["sol", "nubes-claros", "nublado", "lluvia"]),
             "temp": rnd.randint(9, 27), "wind": rnd.choice(["Calma", "Flojo", "Moderado"]), "windDir": rnd.choice(["N", "NO", "SE", "O"])}
        if kind != "entrenamiento":
            comp = rnd.choice(comps)
            s.update(title=comp[0], competition=comp[1], round=str(rnd.randint(1, 6)), sector=rnd.choice("ABCD"),
                     peg=str(rnd.randint(1, 30)), sectorRank=max(1, int(rnd.gauss(4, 2) / skill)), overallRank=rnd.randint(3, 40))
        else:
            s["title"] = "Entreno"
        if mod == "feeder":
            s.update(distance=rnd.choice([30, 35, 40, 45]), feeder="Open 30 g", baits="Asticot y pinkie",
                     groundbait="2 kg Sensas 3000 Gros Gardons + 1 kg tierra de río", groundbaitKg=3)
        elif mod == "coup":
            s.update(rodLength=13, float="1,5 g", line="0,10 / 0,08", hook="nº 18", baits="Fouillis y asticot",
                     groundbait="Van den Eynde Supercup + tierra de Somme", groundbaitKg=4, balls=12)
        elif mod == "carpfishing":
            s.update(distance=110, hours=48, rig="Ronnie", bites=rnd.randint(3, 9), baits="Boilies 20 mm",
                     groundbait="Spod con partículas y boilies", groundbaitKg=6, biggestG=rnd.randint(7000, 16000), species="Carpa común")
        out.append(s)
    return out


async def shoot():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()

        async def page(desktop):
            ctx = await b.new_context(viewport={"width": 1440, "height": 900} if desktop else {"width": 390, "height": 844},
                                      device_scale_factor=1 if desktop else 2, locale="es-ES")
            pg = await ctx.new_page()
            await pg.goto(BASE)
            await pg.wait_for_timeout(400)
            await pg.fill("#l-user", "marta")
            await pg.fill("#l-pw", "demo-marta-2026")
            await pg.click("#lf button[type=submit]")
            await pg.wait_for_timeout(2500)
            return pg

        async def snap(pg, name, full=False):
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=full)
            print("  ", name)

        async def tab(pg, t):
            await pg.click(f".tabbar [data-tab={t}]")
            await pg.wait_for_timeout(900)

        for desktop in (False, True):
            pg = await page(desktop)
            pre = "escritorio" if desktop else "movil"
            await pg.click("#prev"); await pg.wait_for_timeout(400)
            await snap(pg, f"{pre}-calendario")
            await pg.click("#pp-input"); await pg.fill("#pp-input", "caspe"); await pg.wait_for_timeout(400)
            await snap(pg, f"{pre}-buscar-lugar")
            await pg.click(".pp-town"); await pg.wait_for_timeout(600)
            await snap(pg, f"{pre}-filtro-lugar")
            await pg.click("#placeClear"); await pg.wait_for_timeout(400)
            await pg.locator(".item[data-open]").first.click(); await pg.wait_for_timeout(500)
            await snap(pg, f"{pre}-jornada", full=False)
            await pg.click("#back"); await pg.wait_for_timeout(300)
            await pg.click("#fab"); await pg.wait_for_timeout(500)
            await snap(pg, f"{pre}-formulario", full=False)
            await pg.click("#back")
            await tab(pg, "season")
            await snap(pg, f"{pre}-temporada", full=False)
            await tab(pg, "friends")
            await pg.click("[data-f=javi]"); await pg.wait_for_timeout(1200)
            await snap(pg, f"{pre}-comparar", full=False)
            await pg.click("#ftab [data-t=chat]"); await pg.wait_for_timeout(1200)
            await snap(pg, f"{pre}-chat")
            await tab(pg, "settings")
            await snap(pg, f"{pre}-ajustes", full=False)
            if not desktop:
                await pg.evaluate("localStorage.clear()")
                await pg.goto(BASE); await pg.wait_for_timeout(500)
                await pg.click("#mode [data-m=register]"); await pg.wait_for_timeout(300)
                await snap(pg, "movil-registro", full=True)
            await pg.context.close()
        await b.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="pesca-capturas-")
    env = dict(os.environ, PESCA_OPERATOR_NAME="Demo", PESCA_OPERATOR_CONTACT="demo@ejemplo.com")
    dev = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "dev.py"), "--port", str(PORT), "--api-port", str(API_PORT),
                            "--db", os.path.join(tmp, "demo.db"), "--fast-hash"], env=env)
    try:
        time.sleep(2)
        rnd = random.Random(7)
        users = {}
        for u, name, mods, pw in (("marta", "Marta", ["feeder", "coup"], "demo-marta-2026"),
                                  ("javi", "Javi", ["feeder", "carpfishing"], "demo-javi-2026")):
            users[u] = api("/auth/register", {"username": u, "name": name, "password": pw, "modalities": mods, "consent": True})["token"]
        venues = [("Calanda", "Embalse de Calanda"), ("Caspe", "Río Ebro"), ("Caspe", "Embalse de Mequinenza"),
                  ("Zaragoza", "Canal Imperial"), ("Alcañiz", "Río Guadalope")]
        comps = [("Liga provincial", "Liga provincial de feeder"), ("Open de primavera", "Open de primavera"), ("Campeonato autonómico", "Campeonato autonómico")]
        marta = season(rnd, ["feeder", "coup", "feeder"], venues, comps, 1.1)
        javi = season(rnd, ["feeder", "carpfishing"], venues, comps, 0.95)
        # Algunas competiciones juntos, para el cara a cara.
        for s in marta:
            if s["type"] != "entrenamiento" and s["modality"] == "feeder" and rnd.random() < 0.7:
                j = dict(s, id=str(uuid.uuid4()), weightG=int(s["weightG"] * rnd.uniform(0.7, 1.25)),
                         sectorRank=rnd.randint(1, 8), peg=str(rnd.randint(1, 30)))
                javi.append(j)
        marta.append({"id": str(uuid.uuid4()), "date": "2026-10-18", "type": "campeonato", "modality": "feeder",
                      "title": "Campeonato autonómico", "competition": "Campeonato autonómico", "round": "1",
                      "town": "Calanda", "venue": "Embalse de Calanda", "updatedAt": "2026-10-01T10:00:00Z"})
        for u, data in (("marta", marta), ("javi", javi)):
            api("/sync", {"lastSyncAt": 0, "changes": {"sessions": data}}, users[u])
        api("/me", {"shareLevel": "full"}, users["javi"])
        api("/friends/request", {"username": "javi"}, users["marta"])
        api("/friends/accept", {"username": "marta"}, users["javi"])
        for who, text in (("javi", "¿Vas el domingo a Calanda?"), ("marta", "Sí, a 35 m con cestillo open. ¿Tú?"),
                          ("javi", "Voy con carpfishing el sábado y el domingo me paso a verte"), ("marta", "¡Perfecto! Llevo café ☕")):
            other = "marta" if who == "javi" else "javi"
            api(f"/chats/{other}", {"body": text}, users[who])
        api("/chats/javi", None, users["marta"])  # marcar como leído
        asyncio.run(shoot())
    finally:
        dev.terminate()
        dev.wait(timeout=10)


if __name__ == "__main__":
    main()
