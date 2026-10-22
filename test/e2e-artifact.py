"""Проверка на версията за claude.ai с имитация на window.claude (db, user, downloads).

    node scripts/build-artifact.js dist/grand-artifact.html
    python3 test/e2e-artifact.py
"""
import os, re, sys, json, pathlib, tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(os.environ.get('PAGE', ROOT / 'dist' / 'grand-artifact.html'))
NM = ROOT / 'node_modules'
LOCAL = {'jspdf.umd.min.js': NM / 'jspdf/dist/jspdf.umd.min.js', 'jszip.min.js': NM / 'jszip/dist/jszip.min.js', 'xlsx.full.min.js': NM / 'xlsx/dist/xlsx.full.min.js'}
OBJECTS = json.loads((ROOT / 'data' / 'objects.json').read_text())

MOCK = """
<script>
(function(){
  const store = new Map();
  const seed = window.__SEED__;
  if (seed) store.set('config/objects', { list: seed });
  window.__saved = [];
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, data: () => data && JSON.parse(JSON.stringify(data)), metadata: {} });
  const docRef = (path) => ({ id: path.split('/').pop(), path,
    get: async () => snap(path, store.get(path)),
    set: async (d) => { if (!window.__canEdit) throw { code: 'invalid_argument' }; store.set(path, JSON.parse(JSON.stringify(d))); },
    update: async (d) => { store.set(path, { ...store.get(path), ...d }); },
    delete: async () => { if (!window.__canEdit) throw { code: 'invalid_argument' }; store.delete(path); } });
  const db = { doc: docRef, collection: (c) => ({ path: c, doc: (id) => docRef(c + '/' + id),
    get: async () => { const docs = [...store.keys()].filter(k => k.startsWith(c + '/') && k.split('/').length === 2).sort().map(k => snap(k, store.get(k))); return { docs, size: docs.length, empty: !docs.length }; } }) };
  const user = { canEdit: async () => window.__canEdit, me: async () => ({ id: 'u1', name: '' }), isOwner: async () => true };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size || data.length }); } };
  window.claude = { use: async (n) => ({ db, user, downloads }[n] || null) };
  window.__store = store;
})();
</script>"""

problems = []
def check(c, m):
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: problems.append(m)

def build(seed, can_edit):
    html = PAGE.read_text()
    full = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
            f'<script>window.__SEED__={json.dumps(seed, ensure_ascii=False) if seed else "null"};window.__canEdit={str(can_edit).lower()};</script>'
            + MOCK + html + '</body></html>')
    f = tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8'); f.write(full); f.close()
    return 'file://' + f.name

def route(page):
    def h(r):
        u = r.request.url
        for n, p in LOCAL.items():
            if u.endswith(n): return r.fulfill(path=str(p), content_type='application/javascript')
        r.abort()
    page.route(re.compile(r'https://.*'), h)

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-proxy-server'])
    page = b.new_page(viewport={'width': 1300, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    route(page); page.set_default_timeout(15000)

    print('Без обекти')
    page.goto(build(None, True)); page.wait_for_selector('.page')
    check(page.locator('text=Списъкът с обекти още не е зареден').count() == 1, 'показва празно състояние')
    page.click('a.nav__link[href="#objects"]')
    page.set_input_files('#import-file', str(ROOT / 'data' / 'source' / 'obekti-idealni-chasti.xlsx'))
    expect(page.locator('.import')).to_be_visible()
    page.click('[data-action=import-apply]')
    page.click('[data-action=obj-save]')
    expect(page.locator('#toast')).to_contain_text('запазени')
    n = page.evaluate("window.__store.get('config/objects').list.length")
    check(n == 257, f'внесени 257 обекта от Excel ({n})')

    print('С обекти, редактор')
    page.goto(build(OBJECTS, True)); page.wait_for_selector('.hero')
    page.click('[data-action=new-month] >> nth=0'); page.click('#new-month-form button[type=submit]')
    expect(page.locator('h1.h1')).to_contain_text('Януари 2027')
    page.fill('input[data-list=fixedItems][data-i="1"][data-k=amount]', '25000')
    page.fill('input[data-f=water]', '800'); page.fill('input[data-f=power]', '6000'); page.fill('input[data-f=chillers]', '9000')
    page.fill('input[data-list=revenueItems][data-i="0"][data-k=amount]', '3000')
    expect(page.locator('#save-state')).to_have_text('Запазено', timeout=8000)
    check('37 800,00' in page.locator('.pool--total .pool__sum').inner_text(), 'общо 37 800,00 €')
    page.click('[data-action=pdf-report]')
    page.wait_for_function('window.__saved.length >= 1', timeout=60000)
    page.click('[data-action=xlsx-month]')
    page.wait_for_function('window.__saved.length >= 2', timeout=60000)
    saved = page.evaluate('window.__saved')
    check([s['filename'] for s in saved] == ['Spravka_2027-01.pdf', 'Smetki_2027-01.xlsx'], 'файлове през downloads: ' + ', '.join(s['filename'] for s in saved))
    page.click('[data-action=confirm][data-what=lock]'); page.click('[data-action=do-lock]')
    expect(page.locator('h1 .pill--locked')).to_be_visible()
    snap = page.evaluate("(() => { const m = window.__store.get('months/2027-01'); return [m.status, m.snapshot.rows.length, m.snapshot.totalPool]; })()")
    check(snap == ['locked', 257, 37800], f'заключен месец в базата {snap}')
    page.click('a.nav__link[href="#months"]')
    check(page.locator('.tbl--click tbody tr').count() == 1, 'месецът е в списъка')
    page.click('a.nav__link[href="#dashboard"]'); page.wait_for_selector('svg.chart')
    check(True, 'таблото показва графика')

    print('Само преглед')
    page.goto(build(OBJECTS, False)); page.wait_for_selector('.page')
    check(page.locator('text=Само преглед').count() == 1, 'значка „Само преглед“')
    check(page.locator('[data-action=new-month]').count() == 0, 'няма бутон „Нов месец“')
    page.click('a.nav__link[href="#objects"]')
    check(page.locator('[data-action=obj-save]').count() == 0, 'обектите не се редактират')
    b.close()

check(not errors, 'няма грешки в страницата' + ('' if not errors else ': ' + ' | '.join(errors[:3])))
print('\nРЕЗУЛТАТ:', 'ВСИЧКО Е ОК' if not problems else f'{len(problems)} проблема')
sys.exit(1 if problems else 0)
