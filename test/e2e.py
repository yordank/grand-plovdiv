"""Проверка в истински браузър (Playwright). Стартира сървъра с празна база и минава целия път.

    pip install playwright && playwright install chromium
    python3 test/e2e.py            # снимки в test/screens/
"""
import os, re, sys, json, time, socket, signal, subprocess, tempfile, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = pathlib.Path(os.environ.get('SHOTS', ROOT / 'test' / 'screens'))
SHOTS.mkdir(parents=True, exist_ok=True)
NM = ROOT / 'node_modules'
LOCAL = {  # без интернет: CDN адресите се обслужват от node_modules
    'jspdf.umd.min.js': NM / 'jspdf' / 'dist' / 'jspdf.umd.min.js',
    'jszip.min.js': NM / 'jszip' / 'dist' / 'jszip.min.js',
    'xlsx.full.min.js': NM / 'xlsx' / 'dist' / 'xlsx.full.min.js',
}

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

errors, problems = [], []
def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: problems.append(msg)

def route_cdn(page):
    def handle(route):
        url = route.request.url
        if 'fonts.g' in url: return route.abort()
        for name, path in LOCAL.items():
            if url.endswith(name):
                return route.fulfill(path=str(path), content_type='application/javascript')
        route.continue_()
    page.route(re.compile(r'https://(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/.*'), handle)

def no_overflow(page, name):
    w = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
    check(w[0] <= w[1] + 1, f'{name}: няма хоризонтален скрол ({w[0]}≤{w[1]})')

def main():
    port = free_port()
    db = tempfile.mktemp(suffix='.json')
    env = {**os.environ, 'PORT': str(port), 'DB_FILE': db, 'ADMIN_USER': 'upravitel', 'ADMIN_PASSWORD': 'proba-12345'}
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f'http://127.0.0.1:{port}'
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', port), 0.2).close(); break
        except OSError: time.sleep(0.1)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--no-proxy-server'])
            ctx = b.new_context(viewport={'width': 1360, 'height': 900}, accept_downloads=True)
            page = ctx.new_page()
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: r.status >= 400 and '/api/login' not in r.url and 'fonts.g' not in r.url and errors.append(f'{r.status} {r.url}'))
            route_cdn(page)
            page.set_default_timeout(15000)

            print('Вход')
            page.goto(base + '/', wait_until='domcontentloaded')
            page.fill('#login-user', 'upravitel'); page.fill('#login-pass', 'greshna')
            page.click('button[type=submit]')
            expect(page.locator('.form-error')).to_contain_text('Грешен')
            check(True, 'грешна парола се отказва')
            page.screenshot(path=str(SHOTS / '01-login.png'))
            page.fill('#login-user', 'upravitel'); page.fill('#login-pass', 'proba-12345')
            page.click('button[type=submit]')
            expect(page.locator('.hero__title')).to_be_visible()
            check(page.locator('text=Няма месеци').count() == 1, 'празно табло показва „Няма месеци“')
            page.screenshot(path=str(SHOTS / '02-dashboard-empty.png'))

            print('Нов месец')
            page.click('[data-action=new-month] >> nth=0')
            expect(page.locator('#nm-month')).to_have_value('2027-01')
            page.click('#new-month-form button[type=submit]')
            expect(page.locator('h1.h1')).to_contain_text('Януари 2027')
            check(page.locator('input[data-list=fixedItems][data-k=name]').count() == 13, '13 реда постоянни разходи по методиката')
            amt = lambda lst, i: f'input[data-list={lst}][data-i="{i}"][data-k=amount]'
            page.fill(amt('fixedItems', 1), '12 000'); page.fill(amt('fixedItems', 2), '13000,00')
            page.fill('input[data-f=water]', '800'); page.fill('input[data-f=power]', '6000'); page.fill('input[data-f=chillers]', '9000')
            page.fill(amt('revenueItems', 0), '3000')
            expect(page.locator('#save-state')).to_have_text('Запазено', timeout=8000)
            check(True, 'автоматичен запис')
            total = page.locator('.pool--total .pool__sum').inner_text()
            check(total.replace(' ', ' ') == '37 800,00 €', f'общо за разпределяне = 37 800,00 € ({total!r})')
            check('сборът съвпада' in page.locator('.pool--total').inner_text(), 'сборът съвпада')
            check(page.locator('#rows-table tbody tr').count() == 257, '257 реда в таблицата')
            page.screenshot(path=str(SHOTS / '03-month-draft.png'), full_page=True)

            print('Частично приспадане')
            page.check('input[name=deductMode][value=partial]')
            page.fill('input[data-f=deductPct]', '50')
            page.select_option('select[data-f=deductReason]', 'Решение на Общото събрание')
            expect(page.locator('.pool--total .pool__sum')).to_have_text(re.compile('39\\s300,00'))
            check(True, 'приспадане 50% → общо 39 300,00 €')
            page.check('input[name=deductMode][value=full]')
            expect(page.locator('.pool--total .pool__sum')).to_have_text(re.compile('37\\s800,00'))
            expect(page.locator('#save-state')).to_have_text('Запазено', timeout=8000)

            print('Бележка и файлове')
            page.fill('#rows-q', '1-1')
            page.locator('#rows-table tbody tr', has_text='1-1').first.click()
            expect(page.locator('.slip')).to_be_visible()
            page.screenshot(path=str(SHOTS / '04-slip.png'))
            with page.expect_download() as d: page.click('[data-action=pdf-one]')
            f = d.value; check(f.suggested_filename == 'Belezhka_2027-01_1-1.pdf', 'PDF на една бележка: ' + f.suggested_filename)
            page.keyboard.press('Escape')
            page.fill('#rows-q', '')
            for action, name in [('pdf-all', 'Belezhki_2027-01.pdf'), ('pdf-report', 'Spravka_2027-01.pdf'), ('xlsx-month', 'Smetki_2027-01.xlsx'), ('pdf-zip', 'Belezhki_2027-01.zip')]:
                with page.expect_download(timeout=180000) as d: page.click(f'[data-action={action}]')
                path = d.value.path(); size = os.path.getsize(path)
                check(d.value.suggested_filename == name and size > 1000, f'{name} ({size // 1024} KB)')
                if name.endswith('.pdf'):
                    pages = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout).group(1))
                    check(pages == (248 if 'Belezhki' in name else pages), f'  страници: {pages}')

            print('Заключване')
            page.click('[data-action=confirm][data-what=lock]')
            page.click('[data-action=do-lock]')
            expect(page.locator('h1 .pill--locked')).to_be_visible()
            check(page.locator('input[data-f=water]').is_disabled(), 'полетата са заключени')
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('h1 .pill--locked')).to_be_visible()
            check(page.locator('input[data-f=water]').input_value().replace('\u00a0', ' ') == '800,00', 'данните са запазени след презареждане')
            page.screenshot(path=str(SHOTS / '05-month-locked.png'))

            print('Обекти')
            page.click('a.nav__link[href="#objects"]')
            expect(page.locator('h1.h1')).to_have_text('Обекти')
            check(page.locator('.tbl--edit tbody tr').count() == 257, '257 обекта')
            page.locator('.tbl--edit tbody tr').nth(1).locator('input[data-k=chillers]').check()
            page.click('[data-action=obj-save]')
            expect(page.locator('#toast')).to_contain_text('запазени')
            page.set_input_files('#import-file', str(ROOT / 'data' / 'source' / 'obekti-idealni-chasti.xlsx'))
            expect(page.locator('.import')).to_be_visible()
            imp = page.locator('.import').inner_text()
            check('257 обекта' in imp and '0 с промени' in imp.replace('\n', ' '), 'внасяне на оригиналния Excel: 0 промени')
            page.screenshot(path=str(SHOTS / '06-objects.png'))
            page.click('[data-action=import-cancel]')
            page.locator('.tbl--edit tbody tr').nth(1).locator('input[data-k=chillers]').uncheck()
            page.click('[data-action=obj-save]')

            print('Месеци и табло')
            page.click('a.nav__link[href="#months"]')
            check(page.locator('.tbl--click tbody tr').count() == 1, 'един месец в списъка')
            page.fill('#hist-obj', '2-15'); page.press('#hist-obj', 'Enter'); page.locator('#hist-obj').blur()
            expect(page.locator('text=Общо за 1 мес.')).to_be_visible()
            page.screenshot(path=str(SHOTS / '07-months.png'), full_page=True)
            page.click('a.nav__link[href="#dashboard"]')
            page.wait_for_selector('svg.chart')
            check(page.locator('svg.chart rect').count() >= 4, 'графиката има стълбове')
            page.screenshot(path=str(SHOTS / '08-dashboard.png'), full_page=True)

            print('Телефон')
            m = ctx.new_page(); route_cdn(m)
            m.on('pageerror', lambda e: errors.append(str(e)))
            m.set_viewport_size({'width': 390, 'height': 844})
            for token in ['dashboard', 'month-2027-01', 'months', 'objects']:
                m.goto(base + '/#' + token, wait_until='domcontentloaded')
                m.wait_for_selector('.page')
                m.wait_for_timeout(400)
                no_overflow(m, token)
                m.screenshot(path=str(SHOTS / f'09-mobile-{token}.png'))

            print('Тъмна тема')
            dk = b.new_context(viewport={'width': 1360, 'height': 900}, color_scheme='dark', storage_state=ctx.storage_state())
            dp = dk.new_page(); route_cdn(dp)
            dp.goto(base + '/#month-2027-01', wait_until='domcontentloaded'); dp.wait_for_selector('.pool--total')
            dp.screenshot(path=str(SHOTS / '10-dark.png'))
            bg = dp.evaluate('getComputedStyle(document.body).backgroundColor')
            check(bg != 'rgb(241, 244, 246)', f'тъмен фон ({bg})')

            print('Изход')
            page.click('[data-action=logout]')
            expect(page.locator('#login-form')).to_be_visible()
            b.close()
    finally:
        srv.send_signal(signal.SIGTERM); srv.wait(5)
        for ext in ('', '-wal', '-shm'):
            try: os.remove(db + ext)
            except OSError: pass

    real = [e for e in errors if 'fonts.g' not in e and 'ERR_FAILED' not in e and 'Failed to load resource' not in e]
    check(not real, 'няма грешки в конзолата' + ('' if not real else ': ' + ' | '.join(real[:5])))
    print('\nРЕЗУЛТАТ:', 'ВСИЧКО Е ОК' if not problems else f'{len(problems)} проблема')
    sys.exit(1 if problems else 0)

main()
