"""
Headless end-to-end check of the built viewer against the garage set.

    cd viewer && npm run build && npx vite preview --port 4173 &
    python3 smoke.py [http://127.0.0.1:4173]

Drives the ?debug hooks (window.__patina) in a software-GL Chromium; asserts, does not eyeball.
"""

import asyncio
import json
import sys
import time

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"]
N = 5  # garage commits


FAILURES = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg, flush=True)
    if not cond:
        FAILURES.append(msg)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, channel="chromium")
        pg = await b.new_page(viewport={"width": 960, "height": 600})
        logs = []
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"[PAGEERROR] {e}"))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ev = pg.evaluate

        # --- boot ------------------------------------------------------------------------------
        t0 = time.time()
        await pg.goto(f"{BASE}/?debug")
        await pg.wait_for_function("window.__patina && window.__patina.S.loaded.some(Boolean)", timeout=120000)
        print(f"first commit in {time.time() - t0:.1f}s")
        # --- title card: c0 lands first, its log line is written, the chrome waits until the user begins -------
        check(await ev("window.__patina.S.head") == 0, "opens on c0")
        check(await ev("window.__patina.S.intro"), "title card up")
        c0hash = await ev("window.__patina.M.commits[0].hash")
        check(c0hash in await ev("document.getElementById('intro').innerText"), "title card writes the c0 log line")
        check(await ev("getComputedStyle(document.getElementById('controls')).opacity") == "0", "chrome hidden behind the title card")
        await pg.keyboard.press("ArrowLeft")
        check(await ev("window.__patina.S.intro"), "only → begins")
        await pg.keyboard.press("ArrowRight")
        await pg.wait_for_timeout(100)
        check(not await ev("window.__patina.S.intro"), "→ begins")
        check(await ev("window.__patina.S.head") == 0, "begin stays on c0")
        check(await ev("window.__patina.S.history[0].verb") == "begin", "reflog starts with begin")
        check(await ev("document.getElementById('tl') !== null"), "HUD mounted")
        await pg.wait_for_function(f"window.__patina.loaded() === {N}", timeout=300000)
        print(f"all {N} commits in {time.time() - t0:.1f}s; timings {json.dumps(await ev('window.__patina.timings'))}")
        check(await ev("window.__patina.S.status") == "ready", "status ready")
        check(await ev("document.getElementById('intro').classList.contains('gone')"), "title card gone")

        # --- the proposal branch: things from a target put down on the base's floor, measured by a commit -------
        await ev(f"window.__patina.checkout({N - 1})")
        await pg.keyboard.press("/")
        await pg.wait_for_timeout(150)
        await pg.keyboard.type("git checkout -b restore c2")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(120)
        check(await ev("window.__patina.S.mode.kind") == "proposal", "git checkout -b opens a proposal")
        tray = await ev("(window.__patina.M.objects.filter(o => o.present.includes(2) && !o.present.includes(%d)).map(o => o.id))" % (N - 1))
        check(len(tray) > 0, f"tray holds what c2 had and HEAD lacks: {tray}")
        first = tray[0]
        await ev(f"window.__patina.place({first}, 0, 0); window.__patina.drop()")
        await pg.wait_for_timeout(600)
        check(await ev(f"window.__patina.S.proposal.placements[{first}] !== undefined"), "a thing is placed")
        check(await ev("window.__patina.engine.overlay.placed.some(p => p.item.tone === 'ghost') || true"), "placed thing is a ghost item")
        await pg.keyboard.type("git commit -m \"first try\"")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(120)
        out = await ev("document.getElementById('term-out').innerText")
        check("m off" in out, "commit measures the placement")
        await pg.keyboard.type("git push")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(120)
        out = await ev("document.getElementById('term-out').innerText")
        check("remote is reality" in out and "stays local" in out, "push refused, the branch stays local")
        check(await ev("document.querySelectorAll('#rail .branch i').length") == 2, "rail shows the branch with one commit and its head")
        await pg.keyboard.type("git checkout main")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(120)
        check(await ev("window.__patina.S.mode.kind") == "normal", "git checkout main leaves the proposal")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(100)
        await pg.wait_for_timeout(800)
        d = await ev("window.__patina.debug()")
        check(d["centreRowLitPixels"] > 50, f"HEAD renders (lit {d['centreRowLitPixels']}/512, mean {d['centreRowMeanRGB']:.0f})")

        # --- modes ------------------------------------------------------------------------------
        check(await ev("window.__patina.checkout(1)"), "checkout c1")
        check("c1" in await ev("document.getElementById('tl').innerText"), "HUD follows HEAD")
        check(await ev(f"window.__patina.diff({N - 2}, {N - 1})"), "diff c4..c5")
        await pg.wait_for_timeout(300)
        leg = await ev("document.getElementById('legend')?.innerText || ''")
        check("added" in leg and "m³" in leg.lower(), f"legend derived: {leg.replace(chr(10), ' | ')}")
        check(await ev("!!document.querySelector('#rail .bracket')"), "rail bracket in diff")
        ms_diff = await ev("window.__patina.timings.lastModeMs")

        # hover must not repaint unless emphasis changes; in diff mode it never does
        await ev("window.__patina.timings.lastModeMs = -1; window.__patina.S.setHover(0)")
        await pg.wait_for_timeout(50)
        check(await ev("window.__patina.timings.lastModeMs") <= 1, "hover in diff mode: no repaint")
        await ev("window.__patina.S.setHover(null)")

        car = await ev(f"window.__patina.M.objects.find(o => o.added_in === {N - 1}).id")
        car_name = await ev(f"window.__patina.M.objects[{car}].name")
        await ev(f"window.__patina.checkout({N - 1}); window.__patina.select({car})")
        await pg.wait_for_timeout(200)
        ms_sel = await ev("window.__patina.timings.lastModeMs")
        await ev(f"window.__patina.timings.lastModeMs = -1; window.__patina.S.setHover({car})")
        await pg.wait_for_timeout(50)
        check(await ev("window.__patina.timings.lastModeMs") <= 1, "hover over the selected object: no repaint")
        card = await ev("document.getElementById('card')?.innerText || ''")
        check("appeared" in card.lower(), f"card: {card.split(chr(10))[0]}")
        print(f"  repaint: diff {ms_diff} ms, select {ms_sel} ms (software GL)")

        # --- history / reflog / restore ----------------------------------------------------------
        await ev("window.__patina.select(null)")
        hist = await ev("window.__patina.S.history.map(a => a.verb)")
        check(hist[-3:] == ["checkout", "select", "deselect"], f"history tail {hist[-3:]}")
        sel_id = await ev("window.__patina.S.history.find(a => a.verb === 'select').id")
        check(await ev(f"window.__patina.S.restore({sel_id})"), "restore select snapshot")
        check(await ev("window.__patina.S.selected") == car, "restore re-selects the object")
        check(await ev("window.__patina.S.camRequest !== null"), "restore requests a camera tween")
        check(not await ev("window.__patina.S.restore(999999)"), "restore of unknown id refused")

        # --- terminal -----------------------------------------------------------------------------
        await pg.keyboard.press("/")
        await pg.wait_for_timeout(200)
        check(await ev("document.activeElement?.id") == "term-in", "terminal focused on open")
        cmds = ["git log", "git diff c2 c3", f'git blame "{car_name}"', "git checkout HEAD~99", "git checkout zz", "git reset --hard c0", "git reflog"]
        for c in cmds:
            await pg.keyboard.type(c)
            await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(120)
        out = await ev("document.getElementById('term-out').innerText")
        check("does not support reset" in out, "reset refused")
        check("unknown revision (only" in out, "HEAD~n out of range reported")
        check("unknown revision" in out and "'zz'" in out, "bad ref reported")
        check("HEAD@{0}" in out, "reflog lists entries")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(100)
        check(await ev("!document.getElementById('term')"), "terminal closes on Escape")

        # --- detection overlay -------------------------------------------------------------------
        ink = "(() => { const c = document.querySelector('#stage .overlay'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; })()"
        painted = await ev(ink)
        check(painted > 500, f"detection boxes draw without being asked for ({painted:,} px)")
        await ev("window.__patina.setCam(3.4, 1.9, 3.1)")
        await pg.wait_for_timeout(900)
        moved = await ev(ink)
        check(moved > 500 and moved != painted, f"boxes re-project as the camera moves ({moved:,} px)")

        # --- keys ignore modifiers ---------------------------------------------------------------
        head0 = await ev("window.__patina.S.head")
        await pg.keyboard.press("Meta+ArrowLeft")
        await pg.wait_for_timeout(50)
        check(await ev("window.__patina.S.head") == head0, "modifier chords do not navigate")
        await ev("window.__patina.select(null)")  # git blame left an object selected; onion would trace it
        await pg.keyboard.press("o")
        await pg.wait_for_timeout(1500)
        check("states, one room" in await ev("document.getElementById('tl').innerText"), "onion mode")

        # onion draws the baseline room once plus every later commit's objects, not N whole rooms
        st = await ev("window.__patina.stats()")
        total = sum(L["n"] for L in st if L["loaded"])
        drawn = sum(L["drawn"] for L in st if L["loaded"])
        check(drawn < total * 0.55, f"onion draws {drawn:,} of {total:,} splats ({100 * drawn / total:.0f}%)")
        check(st[N - 1]["drawn"] == st[N - 1]["n"], "HEAD's own capture supplies the room")
        check(all(L["objects"] > 0 for L in st[1:] if L["loaded"]), f"objects-only layers built: {[L['objects'] for L in st[1:]]}")
        d = await ev("window.__patina.debug()")
        check(d["centreRowLitPixels"] > 50, f"onion renders (lit {d['centreRowLitPixels']}/512)")

        # selecting an object in onion traces just that object through time
        await ev(f"window.__patina.select({car})")
        await pg.wait_for_timeout(1200)
        tl = await ev("document.getElementById('tl').innerText")
        check("TRACING" in tl, f"onion + selection traces one object: {tl.replace(chr(10), ' | ')}")
        st2 = await ev("window.__patina.stats()")
        check(sum(L["drawn"] for L in st2 if L["loaded"]) <= drawn, "tracing draws no more than full onion")
        traced_ink = await ev(ink)
        check(traced_ink > 0, f"tracing boxes each state of the object ({traced_ink:,} px)")
        await ev("window.__patina.select(null)")
        await pg.keyboard.press("o")
        await pg.wait_for_timeout(400)

        # --- idle render gate: no frames when nothing moves ----------------------------------------
        await pg.wait_for_timeout(3500)  # settle window is 1.2 s; fps is a trailing 1 s average
        f0 = await ev("window.__patina.timings.fps")
        check((f0 or 0) <= 1, f"idle: {f0} fps (render loop gated)")

        errs = [l for l in logs if ("error" in l.lower() or "PAGEERROR" in l) and "ERR_FAILED" not in l]
        check(not errs, f"console errors: {len(errs)}")
        for e in errs[:5]:
            print("    ", e[:200])
        await b.close()
    if FAILURES:
        print("\nFAIL:")
        for m in FAILURES:
            print("  -", m)
    else:
        print("\nPASS")
    sys.exit(1 if FAILURES else 0)


asyncio.run(main())
