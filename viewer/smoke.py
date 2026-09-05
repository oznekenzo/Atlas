"""
Headless end-to-end check of the built viewer against the garage set, and the switch to the Bellevue set.

    cd viewer && npm run build && npx vite preview --port 4173 &
    python3 smoke.py [http://127.0.0.1:4173]

Drives the ?debug hooks (window.__patina) in a software-GL Chromium; asserts state, does not eyeball. Every check
reads the store or the DOM rather than waiting on render frames: the software renderer drops to zero fps once two
captures are loaded, so anything that needs a frame to land is done inside one evaluate.
"""

import asyncio
import json
import sys
import time

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"]
N = 4  # garage states; the Bellevue set has one

FAILURES = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg, flush=True)
    if not cond:
        FAILURES.append(msg)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, channel="chromium")
        pg = await b.new_page(viewport={"width": 1600, "height": 900})
        logs = []
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"[PAGEERROR] {e}"))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ev = pg.evaluate
        S = lambda expr: ev(f"window.__patina.S.{expr}")

        # --- the deck: the field, the name, the captures loading behind it ---------------------------
        t0 = time.time()
        await pg.goto(f"{BASE}/?debug")
        await pg.wait_for_function("window.__patina && window.__patina.S.loaded.some(Boolean)", timeout=120000)
        print(f"first capture in {time.time() - t0:.1f}s")
        check(await S("page") == "title", "opens on the title")
        check(await S("slide") == 0, "the name first")
        check(await ev("!!document.querySelector('#title canvas.field')"), "the point field runs behind the name")
        check(await ev("document.getElementById('chrome').hidden"), "the room's chrome waits behind the deck")
        check("loading" in await ev("document.querySelector('#title .foot-l').innerText"), "the deck says what is still loading")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(120)
        check(await S("slide") == 1, "Enter turns to the first slide")
        check("Gaussian splatting" in await ev("document.querySelector('#title .slide.on .lead').innerText"), "slide 1 is the tech")
        await pg.keyboard.press("ArrowLeft")
        await pg.wait_for_timeout(60)
        check(await S("slide") == 0, "← turns back")
        for _ in range(5):
            await pg.keyboard.press("ArrowRight")
        await pg.wait_for_timeout(120)
        check(await S("slide") == 5, "five slides")
        await pg.wait_for_function(f"window.__patina.loaded() === {N}", timeout=300000)
        print(f"all {N} captures in {time.time() - t0:.1f}s; timings {json.dumps(await ev('window.__patina.timings'))}")
        check(await S("status") == "ready", "status ready")
        check("ENTER THE FLOOR" in await ev("document.querySelector('#title .enter').innerText"), "the last slide offers the floor")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(100)
        check(await S("leaving"), "the deck leaves")
        await pg.wait_for_function("window.__patina.S.page === 'room'", timeout=10000)
        check(await S("head") == 1, "arrives on the second state, June")
        check(await S("history[0].verb") == "begin", "the log starts with begin")
        await pg.wait_for_function("!window.__patina.S.curtain", timeout=5000)
        check(not await ev("document.getElementById('chrome').hidden"), "the chrome is up")
        check(await S("tour") == 0, "the tour starts on arrival")
        check(await S("orbit") and not await S("moving"), "the arrival's slow orbit is on, and it is not the user moving")
        check(await ev("!!document.querySelector('#chrome .ring')"), "the spotlight is on its first target")
        for _ in range(7):
            await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(40)
        check(await S("tour") == -1 and await S("goals.ui"), "Enter walks the seven-stop tour; Understand the UI is ticked")
        n0 = await S("history.length")
        await pg.mouse.move(770, 392)  # the middle cell's centre at 1600 × 900: the scene
        await pg.mouse.down()
        await pg.wait_for_timeout(300)  # longer than a click, without motion: not a selection, not a gesture
        await pg.mouse.up()
        check(not await S("orbit") and await S("history.length") == n0, "the first press on the scene ends the orbit, and logs nothing")
        await pg.mouse.move(100, 120)

        # --- the rail and the month ----------------------------------------------------------------------
        check(await ev("document.querySelectorAll('#timeline .cell').length") == N, "four timeline cells")
        check((await ev("document.querySelector('#timeline .cell.std').innerText")).startswith("Jul"), "July's cell is the standard")
        check("First stations in" in await ev("document.querySelector('#details .doc').innerText"), "June's entry is written")
        await pg.keyboard.press("ArrowRight")
        await pg.keyboard.press("ArrowRight")
        await pg.keyboard.press("ArrowRight")
        await pg.wait_for_timeout(120)
        check(await S("head") == 3, "→ moves through the states")
        check(await S("goals.move"), "Move through states is ticked")
        month = await ev("document.getElementById('details').innerText")
        check("OFF STANDARD" in month and "No entry." in month and "44 MIN" in month, "August: off standard, no entry, its numbers")
        check((await ev("document.querySelector('#timeline .cell.lit .m').innerText")).startswith("Aug"), "the timeline lights August")
        check(await ev("!!document.querySelector('#timeline .cell.lit .tab')"), "the current cell offers Make this the standard")

        # --- diff ----------------------------------------------------------------------------------------
        await pg.keyboard.press("d")
        await pg.wait_for_timeout(120)
        mode = await S("mode")
        check(mode["kind"] == "compare" and mode["a"] == 2 and mode["b"] == 3, f"D diffs the standard against August: {mode}")
        check(await S("goals.diff"), "Diff spatial states is ticked")
        panel = await ev("document.getElementById('panel').innerText")
        check("Jul → Aug" in panel and "MOVED" in panel and "2.6 m" in panel, "the diff panel groups the change with distances")
        check("night shift" in panel, "the diff's entry is written")
        check("DIFF MODE" in await ev("document.getElementById('modehud').innerText"), "the mode readout says diff")
        stats = await ev("window.__patina.stats()")
        check(stats[3]["visible"] and stats[2]["drawn"] > 0, "August drawn whole, July lends its objects")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(60)
        check(await S("mode.kind") == "normal" and await S("head") == 3, "esc leaves the diff where it was")

        # --- compare to standard -------------------------------------------------------------------------
        g = await ev(
            """(async () => { const P = window.__patina; P.ghosts(); const on = P.S.ghosts;
                 const parts = [...P.engine.layers[2].parts.values()]; await Promise.all(parts.map((p) => p.mesh.initialized));
                 const shown = parts.filter((p) => p.mesh.visible && p.mesh.parent).length;
                 const panel = document.getElementById('panel').innerText;
                 return { on, parts: parts.length, shown, panel, goal: !!P.S.goals.std }; })()"""
        )
        check(g["on"] and g["goal"], "C compares to the standard and ticks the goal")
        check(g["parts"] >= 2 and g["shown"] == g["parts"], f"{g['shown']} of the standard's ghosts drawn from its own capture")
        check("must move 2.6 m" in g["panel"] and "must add" in g["panel"], "the panel says what August must do")
        await pg.keyboard.press("Escape")
        check(not await S("ghosts"), "esc clears the comparison")

        # --- a draft -------------------------------------------------------------------------------------
        await pg.keyboard.press("n")
        await pg.wait_for_timeout(120)
        check(await S("mode.kind") == "draft" and await S("draft.base") == 3, "N drafts from this state")
        check(await S("draft.placements.length") == 4, "the state's four things start as placements")
        check(await S("goals.draft"), "Draft a layout proposal is ticked")
        await ev("window.__patina.place(0, -1.0, 1.5); window.__patina.place(0, 0.8, 1.8)")
        check(await S("draft.placements.length") == 6, "two copies of the tall plant placed")
        await pg.keyboard.press("m")
        await pg.wait_for_timeout(60)
        check(await S("draft.attempts[0].text") == "6 placed", "M measures: 6 placed")
        await ev("window.__patina.S.setDraftBase(null)")
        check(await S("draft.placements.length") == 0, "from scratch starts bare")
        stats = await ev("window.__patina.stats()")
        check(stats[0]["visible"] and not stats[3]["visible"], "a draft stands on the empty capture")
        await pg.keyboard.press("Escape")
        check(await S("mode.kind") == "normal" and await S("draft") is None, "esc leaves the draft")

        # --- an object -----------------------------------------------------------------------------------
        await ev("window.__patina.select(7)")
        card = await ev("document.getElementById('card').innerText")
        check("Monstera" in card and "moved 2.6 m" in card and "cart A" in card, "the card: name, its months, its entry")
        await ev("window.__patina.select(7)")
        check(await S("selected") is None, "the same thing again deselects")

        # --- the pages, the sites, the log -------------------------------------------------------------
        await pg.keyboard.press("?")
        await pg.wait_for_timeout(60)
        check(await S("page") == "how" and "Register" in await ev("document.getElementById('how').innerText"), "? opens How it works")
        await pg.keyboard.press("Escape")
        await pg.keyboard.press("f")
        await pg.wait_for_timeout(60)
        foot = await ev("document.getElementById('footnotes').innerText")
        check("60 cm" in foot and "build" in foot, "F opens Footnotes with the pipeline's numbers and the build")
        await pg.keyboard.press("Escape")
        check(await S("page") == "room", "esc returns to the room")
        did = await ev("window.__patina.S.history.find((a) => a.verb === 'diff').id")
        check(await ev(f"window.__patina.S.restore({did})"), "a log entry restores")
        check(await S("mode.kind") == "compare", "restore returns to the diff")
        check(await ev("document.querySelectorAll('#actions .row').length") > 3, "the actions log lists the past")
        await ev("window.__patina.S.esc()")
        # --- the map: a footprint picks, bare floor moves the camera there facing the centre ------------
        mv = await ev(
            """(() => { const P = window.__patina; P.mapGo(-1.2, 1.8); const a = P.S.history.at(-1);
                 return { verb: a.verb, pos: a.snap.cam.pos, target: a.snap.cam.target }; })()"""
        )
        check(mv["verb"] == "move" and abs(mv["pos"][0] + 1.2) < 0.2 and abs(mv["pos"][2] - 1.8) < 0.2, f"a click on the map's floor puts the camera there: {mv['pos']}")
        check(abs(mv["target"][0]) < 0.3 and abs(mv["target"][2]) < 0.3, "facing the room's centre")
        check(await ev("document.getElementById('map-slot').querySelector('canvas.map') !== null"), "the map is a canvas in the frame")

        # --- the menu and the confirm -------------------------------------------------------------------------
        await ev("window.__patina.S.toggleMenu()")
        check(await ev("document.querySelectorAll('#menu .list .row').length") == 3, "the ATLAS menu: How it works, Notes, Restart demo")
        await ev("window.__patina.S.closeMenus()")
        await ev("window.__patina.go(3); window.__patina.S.askStandard()")
        check(await ev("!!document.getElementById('confirm')"), "the tab asks before a state becomes the standard")
        await pg.keyboard.press("Escape")
        check(await S("standard") == 2 and not await S("confirmStd"), "esc keeps the old standard")
        await ev("window.__patina.S.askStandard()")
        await pg.keyboard.press("Enter")
        check(await S("standard") == 3, "Enter makes August the standard")
        await ev("window.__patina.S.setStandard ? null : null")
        rid = await ev("window.__patina.S.history.find((a) => a.verb === 'go to').id")
        await ev(f"window.__patina.S.restore({rid})")
        check(await S("standard") == 2, "a restore returns the standard with the rest of the state")

        # --- the HUD's attention: full on it, lighter in the room, nearly gone after four still seconds ---------
        hud = lambda: ev("window.__patina.hud()")
        await pg.mouse.move(100, 120)  # on the checklist
        check(await hud() == "hud", "pointer on the HUD: full")
        await pg.mouse.move(770, 392)  # the middle cell's centre at 1600 × 900
        await pg.wait_for_timeout(60)
        check(await hud() == "room", "pointer in the room: the middle level")
        quiet = False
        for _ in range(8):
            await pg.wait_for_timeout(300)
            if await hud() == "quiet":
                quiet = True
                break
        check(quiet, f"one still second in the room: quiet (hud={await hud()}, moving={await S('moving')})")
        await pg.mouse.move(100, 120)
        await pg.wait_for_timeout(60)
        check(await hud() == "quiet", "hovering over a gone HUD does not bring it back")
        await pg.mouse.move(770, 392)
        await ev("window.__patina.select(7)")
        await pg.wait_for_timeout(60)
        check(await hud() == "room", "a click on a thing wakes it to the middle level")
        await ev("window.__patina.select(null)")
        await pg.mouse.move(100, 120)
        await pg.wait_for_timeout(60)
        check(await hud() == "hud", "back on the HUD: full")
        await pg.mouse.move(770, 392)
        await ev("window.__patina.S.toggleMenu()")
        await pg.wait_for_timeout(60)
        check(await hud() == "hud", "an open menu pins it in full")
        await ev("window.__patina.S.closeMenus()")
        await pg.mouse.move(100, 120)

        # --- the other site: its set opens in place of this one --------------------------------------------
        await ev("window.__patina.S.pickSite('bellevue')")
        check(await S("goals.tour"), "picking the remote site ticks the tour goal")
        check(await ev("Object.keys(window.__patina.S.goals).length") == 6, "all six goals done")
        check(await S("set") == "bellevue" and await S("curtain") and await S("history.length") == 0, "the room empties under the curtain; the log starts over")
        await pg.wait_for_function("window.__patina.S.status === 'ready' && window.__patina.S.set === 'bellevue'", timeout=120000)
        check(await ev("window.__patina.M.commits.length") == 1 and await ev("document.querySelectorAll('#timeline .cell').length") == 1, "Bellevue: one timeline cell")
        check("Bellevue" in await ev("document.querySelector('#sites .site').innerText"), "the picker names the floor")
        check(await S("history[0].verb") == "open", "the log opens with the floor")
        check(await S("standard") == 0 and "Standard" in await ev("document.getElementById('details').innerText"), "its one state is the standard")
        check(await ev("window.__patina.stats()[0].labelled") > 0, "its objects are labelled from their boxes")
        await ev("window.__patina.select(2)")
        check("Tool chest" in await ev("document.getElementById('card').innerText"), "an object opens its card")
        await ev("window.__patina.select(null)")

        # --- restart: back to the deck, the first floor loading behind it again --------------------------
        await ev("window.__patina.S.restartDemo()")
        check(await S("page") == "title" and await S("history.length") == 0 and await S("tour") == 0, "Restart demo returns to a clean deck")
        check(await S("set") == "garage" and await S("site") == "torrance", "and to the first floor")

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
