"""
Headless end-to-end check of the built viewer against the synthetic set.

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
N = 6  # synthetic commits


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

        # --- error path: unknown set fails loudly, not silently -------------------------------
        await pg.goto(f"{BASE}/?set=does-not-exist&debug")
        await pg.wait_for_function("document.getElementById('status')?.innerText.toLowerCase().includes('could not open')", timeout=20000)
        check(True, "unknown set → error overlay")

        # --- boot ------------------------------------------------------------------------------
        t0 = time.time()
        await pg.goto(f"{BASE}/?set=synthetic&debug")
        await pg.wait_for_function("window.__patina && window.__patina.S.loaded.some(Boolean)", timeout=120000)
        print(f"first commit in {time.time() - t0:.1f}s")
        check(await ev("document.getElementById('tl') !== null"), "HUD mounted after first commit")
        await pg.wait_for_function(f"window.__patina.loaded() === {N}", timeout=300000)
        print(f"all {N} commits in {time.time() - t0:.1f}s; timings {json.dumps(await ev('window.__patina.timings'))}")
        check(await ev("window.__patina.S.status") == "ready", "status ready")
        check(await ev("window.__patina.S.head") == N - 1, "HEAD is newest commit")
        await pg.wait_for_timeout(800)
        d = await ev("window.__patina.debug()")
        check(d["centreRowLitPixels"] > 50, f"HEAD renders (lit {d['centreRowLitPixels']}/512, mean {d['centreRowMeanRGB']:.0f})")

        # --- modes ------------------------------------------------------------------------------
        check(await ev("window.__patina.checkout(0)"), "checkout c0")
        check("c0" in await ev("document.getElementById('tl').innerText"), "HUD follows HEAD")
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
        cmds = ["git log", "git diff c2 c3", f'git blame "object {car:02d}"', "git checkout HEAD~99", "git checkout zz", "git reset --hard c0", "git reflog"]
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
        await ev("window.__patina.select(null)")
        await pg.keyboard.press("o")
        await pg.wait_for_timeout(400)

        # --- idle render gate: no frames when nothing moves ----------------------------------------
        await pg.wait_for_timeout(3500)  # settle window is 1.2 s; fps is a trailing 1 s average
        f0 = await ev("window.__patina.timings.fps")
        check((f0 or 0) <= 1, f"idle: {f0} fps (render loop gated)")

        errs = [l for l in logs if ("error" in l.lower() or "PAGEERROR" in l) and "ERR_FAILED" not in l and "does-not-exist" not in l]
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
