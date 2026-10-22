// Сглобява цялото приложение в един HTML файл за claude.ai (линк без собствен сървър).
// Данните там се пазят в базата на страницата (capability `db`), не в SQLite.
//   node scripts/build-artifact.js [изходен файл]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...p) => path.join(ROOT, 'public', ...p);
const read = (...p) => fs.readFileSync(P(...p), 'utf8');
const out = process.argv[2] || path.join(ROOT, 'dist', 'grand-artifact.html');

const img = fs.readFileSync(P('img', 'grand-facade.jpg')).toString('base64');
const css = read('css', 'app.css').replace('url("../img/grand-facade.jpg")', `url("data:image/jpeg;base64,${img}")`);
if (css.includes('../img/')) throw new Error('Картинката не е вградена');

const html = read('index.html');
const body = html.split('<body>')[1].split('<!--GRAND:SCRIPTS-->')[0];
const scripts = ['js/format.js', 'js/calc.js', 'js/libs.js', 'js/store-artifact.js', 'js/pdf.js', 'js/excel.js', 'js/app.js']
  .map((f) => `<script>\n${read(...f.split('/'))}\n</script>`).join('\n');
// шрифтът за PDF е вграден, защото страницата не може да зарежда свои файлове
const fonts = `<script>\n${read('vendor', 'onest-fonts.js')}\n</script>`;

const page = `<title>Сметки ТАЦ Гранд</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap">
<style>
${css}
</style>
${body.trim()}
${fonts}
${scripts}
`;
const bad = /<(html|head|body)[\s>]|<!doctype/i.exec(page);
if (bad) throw new Error('Забранен таг в страницата: ' + bad[0]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out} — ${(page.length / 1024).toFixed(0)} KB`);
