import asyncio, json, time, base64
from playwright.async_api import async_playwright
URL = "http://127.0.0.1:4173/"
ARGS = ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, channel="chromium")
        pg = await b.new_page(viewport={"width": 960, "height": 600}); logs = []
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}")); pg.on("pageerror", lambda e: logs.append(f"[PAGEERROR] {e}"))
        await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        cdp = await pg.context.new_cdp_session(pg)
        async def shot(name):
            await pg.evaluate("window.__patina.pause(true)"); await pg.wait_for_timeout(400)
            r = await cdp.send("Page.captureScreenshot", {"format": "png"}); open(f"/root/patina/shots/{name}.png", "wb").write(base64.b64decode(r["data"]))
            await pg.evaluate("window.__patina.pause(false)")
        t0 = time.time(); await pg.goto(URL)
        await pg.wait_for_function("window.__patina && window.__patina.loaded() === 6", timeout=300000)
        print(f"all 6 commits loaded in {time.time()-t0:.1f}s wall"); print("timings:", json.dumps(await pg.evaluate("window.__patina.timings")))
        print("first commit up", flush=True); await pg.wait_for_timeout(1500); await shot("01_head"); print("shot 01", flush=True)
        async def mode(label, js, name):
            await pg.evaluate(js); ms = await pg.evaluate("window.__patina.timings.lastModeMs"); await pg.wait_for_timeout(1500); await shot(name)
            d = await pg.evaluate("window.__patina.debug()"); print(f"{label:30s} recolor {ms:>3} ms   draw calls {d['info']['calls']}  tris {d['info']['triangles']:,}")
        await mode("checkout c0", "window.__patina.checkout(0)", "02_c0")
        await mode("checkout c2", "window.__patina.checkout(2)", "03_c2")
        await mode("diff c1..c3", "window.__patina.diff(1,3)", "04_diff_1_3")
        await mode("diff c4..c5 (car in)", "window.__patina.diff(4,5)", "05_diff_4_5")
        await mode("diff c0..c5 (whole story)", "window.__patina.diff(0,5)", "06_diff_0_5")
        await mode("onion skin", "window.__patina.checkout(5); window.__patina.onion()", "07_onion")
        car = await pg.evaluate("window.__patina.M.objects.find(o => o.added_in === 5).id")
        await mode("select the car", f"window.__patina.checkout(5); window.__patina.select({car})", "08_select_car")
        await pg.evaluate("window.__patina.select(null)"); await pg.keyboard.press("/"); await pg.wait_for_timeout(200)
        for cmd in ["git log", "git diff c2 c3", f"git blame \"object {car:02d}\"", "git bisect \"object 10\"", "git reset --hard c0", "git push"]:
            await pg.keyboard.type(cmd); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(300)
        await pg.wait_for_timeout(500); await shot("09_terminal")
        print("--- terminal ---\n" + await pg.evaluate("document.getElementById('term-out').innerText"))
        mem = await pg.evaluate("window.__patina.mem()"); print(f"JS heap: {mem/1e6:.0f} MB")
        errs = [l for l in logs if ("error" in l.lower() or "PAGEERROR" in l) and "ERR_FAILED" not in l]; print("console errors:", len(errs)); [print("  ", e[:200]) for e in errs[:8]]
        await b.close()
asyncio.run(main())
