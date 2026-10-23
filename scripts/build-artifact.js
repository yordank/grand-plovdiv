// Сглобява цялото приложение в един HTML файл за claude.ai (линк без собствен сървър).
// Данните там се пазят в базата на страницата (capability `db`), не на сървъра.
//   node scripts/build-artifact.js [изходен файл]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...p) => path.join(ROOT, 'public', ...p);
const read = (...p) => fs.readFileSync(P(...p), 'utf8');
// node scripts/build-artifact.js [изход]          → версия за claude.ai
// node scripts/build-artifact.js --pages          → демо за GitHub Pages (docs/index.html)
const PAGES = process.argv.includes('--pages');
const args = process.argv.slice(2).filter((a) => a !== '--pages');
const out = args[0] || (PAGES ? path.join(ROOT, 'docs', 'index.html') : path.join(ROOT, 'dist', 'grand-artifact.html'));

const img = fs.readFileSync(P('img', 'grand-facade.jpg')).toString('base64');
const css = read('css', 'app.css').replace('url("../img/grand-facade.jpg")', `url("data:image/jpeg;base64,${img}")`);
if (css.includes('../img/')) throw new Error('Картинката не е вградена');

const html = read('index.html');
const body = html.split('<body>')[1].split('<!--GRAND:SCRIPTS-->')[0];
const store = PAGES ? 'js/store-local.js' : 'js/store-artifact.js';
const objects = PAGES ? `<script>window.GRAND_OBJECTS = ${fs.readFileSync(path.join(ROOT, 'data', 'objects.json'), 'utf8')};</script>\n` : '';
const scripts = objects + ['js/format.js', 'js/calc.js', 'js/libs.js', store, 'js/pdf.js', 'js/excel.js', 'js/app.js']
  .map((f) => `<script>\n${read(...f.split('/'))}\n</script>`).join('\n');
// шрифтът за PDF е вграден, защото страницата не може да зарежда свои файлове
const fonts = `<script>\n${read('vendor', 'onest-fonts.js')}\n</script>`;

const head = PAGES ? '<!doctype html>\n<html lang="bg">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' : '';
const page = `${head}<title>Сметки ТАЦ Гранд</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap">
<style>
${css}
</style>
${PAGES ? '</head>\n<body>\n' : ''}${body.trim()}
${fonts}
${scripts}
${PAGES ? '</body>\n</html>\n' : ''}`;
const bad = !PAGES && /<(html|head|body)[\s>]|<!doctype/i.exec(page);
if (bad) throw new Error('Забранен таг в страницата: ' + bad[0]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out} — ${(page.length / 1024).toFixed(0)} KB`);
