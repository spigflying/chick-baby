# 本機端到端驗證（需 pnpm dev 執行中、Playwright + Chrome）：python3 scripts/e2e.py
# 截圖輸出到 /workspace/m1-*.png；會以 psql 直接調整資料（模擬死亡）。
import asyncio, re, time, subprocess
from playwright.async_api import async_playwright
B='http://localhost:5173'
def sql(q): return subprocess.run(['psql','-h','localhost','-U','chick','chick','-tAc',q],env={'PGPASSWORD':'chick','PATH':'/usr/bin:/bin'},capture_output=True,text=True).stdout.strip()
async def msg(p): return (await p.text_content('.msg')) or ''
async def login(br,name,vp={'width':1280,'height':800}):
    c=await br.new_context(viewport=vp); p=await c.new_page()
    p.on('console', lambda m: m.type=='error' and print(name,'console:',m.text))
    await p.goto(B); await p.fill('#devForm input',name); await p.click('#devForm button')
    await p.wait_for_selector('.device .labels .cell'); await p.wait_for_timeout(500); return c,p
async def cell(p,act): await p.click(f'.cell[data-act="{act}"]')
async def main():
    async with async_playwright() as pw:
        br=await pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        c0=await br.new_context(viewport={'width':1280,'height':800}); p0=await c0.new_page(); await p0.goto(B); await p0.wait_for_selector('#devForm'); await p0.wait_for_timeout(800)
        await p0.screenshot(path='/workspace/m1-login.png'); await c0.close()
        ca,a=await login(br,'alice'); cb,b=await login(br,'bob')
        await cell(a,'hatch'); await a.click('.sp[data-s="dino"]'); await a.wait_for_timeout(300)
        await a.screenshot(path='/workspace/m1-hatch-picker.png')
        await a.click('.menu [data-go]'); await a.fill('#dlgForm input','小龍'); await a.click('#dlgForm button[value=ok]')
        await a.wait_for_timeout(1500); await a.screenshot(path='/workspace/m1-egg.png'); print('alice:',await msg(a))
        await cell(b,'hatch'); await b.click('.sp[data-s="duck"]'); await b.click('.menu [data-go]'); await b.fill('#dlgForm input','呱呱'); await b.click('#dlgForm button[value=ok]')
        print('waiting for hatch...'); await a.wait_for_selector('.cell[data-act="feed"]',timeout=90000); await b.wait_for_selector('.cell[data-act="feed"]',timeout=30000); print('hatched:', await a.text_content('[data-k="stage"]'), await b.text_content('[data-k="stage"]'))
        await a.wait_for_timeout(1000); await a.screenshot(path='/workspace/m1-home-dino.png'); await b.screenshot(path='/workspace/m1-home-duck.png')
        # owner feeds free rice
        await cell(a,'feed'); await a.wait_for_timeout(300); await a.screenshot(path='/workspace/m1-owner-feed-menu.png')
        await a.click('.menu .mi[data-i="0"]'); await a.wait_for_timeout(2500); await a.screenshot(path='/workspace/m1-eat.png'); await a.wait_for_timeout(7000); print('alice feed:',await msg(a))
        code=sql("select share_code from users where display_name='alice'")
        # bob visits via share link
        await b.goto(f'{B}/h/{code}'); await b.wait_for_selector('.cell[data-act="home"]'); await b.wait_for_timeout(800)
        await b.screenshot(path='/workspace/m1-visit.png')
        await cell(b,'feed'); await b.wait_for_timeout(300); await b.screenshot(path='/workspace/m1-visitor-feed-menu.png')
        await b.click('.menu .mi[data-i="0"]'); await b.wait_for_timeout(500); print('bob rice:',await msg(b))
        for i in range(6):
            for _ in range(40):
                if await b.is_visible('.menu'): break
                await cell(b,'feed'); await b.wait_for_timeout(400)
            await b.click('.menu .mi[data-i="1"]'); await b.wait_for_timeout(1000)
            print('bob candy',i+1,':',await msg(b))
        await b.screenshot(path='/workspace/m1-visitor-limit.png')
        print('bob coins', await b.text_content('#barCoins'))
        await a.wait_for_timeout(500); await a.screenshot(path='/workspace/m1-live-feed-seen-by-owner.png')
        await a.reload(); await a.wait_for_selector('#fedList li'); await a.wait_for_timeout(1000); await a.screenshot(path='/workspace/m1-who-fed.png')
        # stairs
        before=await a.text_content('#barCoins')
        await cell(a,'play'); await a.wait_for_selector('.gamebar:not([hidden])',timeout=10000); await a.wait_for_timeout(1200)
        t0=time.time(); k='ArrowLeft'; shot=False
        while time.time()-t0<25 and not await a.is_visible('.menu'):
            await a.keyboard.down(k); await a.wait_for_timeout(350); await a.keyboard.up(k); k='ArrowRight' if k=='ArrowLeft' else 'ArrowLeft'
            if not shot and time.time()-t0>4: await a.screenshot(path='/workspace/m1-stairs.png'); shot=True
        if not await a.is_visible('.menu'): await a.keyboard.press('Escape')
        await a.wait_for_selector('.menu:not([hidden])',timeout=10000); await a.wait_for_timeout(500)
        st=await a.evaluate('JSON.stringify(window.__stairs && {floor: __stairs.state.players[0].floor, stats: __stairs.stats, N: __stairs.N})')
        print('stairs:',st,'| msg:',await msg(a),'| coins',before,'->',await a.text_content('#barCoins'))
        await a.screenshot(path='/workspace/m1-stairs-result.png'); await a.click('.menu')
        # settings: invite-only kicks bob
        await a.click('a[href="/settings"]'); await a.wait_for_selector('input[name=mode]'); await a.check('input[value=invite_only]'); await a.wait_for_timeout(1500)
        await a.screenshot(path='/workspace/m1-settings.png', full_page=True)
        await b.wait_for_timeout(1000); print('bob after invite_only:', b.url); await b.screenshot(path='/workspace/m1-kicked.png')
        await b.goto(f'{B}/h/{code}'); await b.wait_for_timeout(1500); await b.screenshot(path='/workspace/m1-forbidden.png')
        await a.check('input[value=open]'); await a.wait_for_timeout(500)
        # death + admin revive
        sql("update pets set hunger=0,happiness=0,energy=0,cleanliness=0,health=1,last_simulated_at=now()-interval '6 hours' where owner_id=(select id from users where display_name='bob')")
        await b.goto(B); await b.wait_for_selector('.cell[data-act="hatch"]'); await b.wait_for_timeout(800); await b.screenshot(path='/workspace/m1-dead.png')
        cz,z=await login(br,'dev-admin'); await z.click('a[href="/admin"]'); await z.wait_for_selector('[data-u]')
        bid=sql("select id from users where display_name='bob'"); await z.click(f'[data-u="{bid}"]'); await z.wait_for_selector('[data-revive]'); await z.wait_for_timeout(300)
        await z.screenshot(path='/workspace/m1-admin.png', full_page=True)
        await z.click('[data-revive]'); await z.wait_for_timeout(1500); await z.screenshot(path='/workspace/m1-admin-revived.png', full_page=True)
        await b.wait_for_selector('.cell[data-act="feed"]',timeout=10000); await b.wait_for_timeout(800); print('bob revived (live):', await b.text_content('[data-k="stage"]'))
        await b.screenshot(path='/workspace/m1-revived.png')
        cm,m=await login(br,'mia',{'width':390,'height':844}); await m.goto(f'{B}/h/{code}'); await m.wait_for_selector('.cell[data-act="home"]'); await m.wait_for_timeout(1000)
        await m.screenshot(path='/workspace/m1-mobile-visit.png', full_page=True)
        print('email leak check:', 'dev.local' in (await z.content()) or 'dev.local' in (await a.content()))
        await br.close()
asyncio.run(main())
