// PDF: бележка за обект, всички бележки, справка по чл. 11
(function () {
  const F = window.GrandFmt;
  const C = window.GrandCalc;
  const BRICK = [165, 69, 43];
  const INK = [22, 33, 43];
  const MUTED = [93, 107, 119];
  const LINE = [215, 222, 228];
  const ADDRESS = 'Търговски административен център · гр. Пловдив, ул. „Капитан Райчо“ № 56';
  const METHOD = 'Разпределено по Методиката за разпределение на месечните разходи, Приложение № 8 към Протокол от ОС на ЕС – ТАЦ „Гранд“ от 06.10.2026 г.';
  const DEDUCT = {
    full: 'Приспаднати изцяло (чл. 10, ал. 1)',
    partial: 'Приспаднати частично (чл. 10, ал. 2)',
    none: 'Не са приспаднати (чл. 10, ал. 2)',
  };

  async function ready() {
    await window.GrandLibs.load('jspdf', 'fonts');
  }

  function newDoc(format) {
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format, compress: true });
    doc.addFileToVFS('Onest-Regular.ttf', window.GRAND_FONTS.regular);
    doc.addFileToVFS('Onest-Bold.ttf', window.GRAND_FONTS.bold);
    doc.addFont('Onest-Regular.ttf', 'Onest', 'normal');
    doc.addFont('Onest-Bold.ttf', 'Onest', 'bold');
    doc.setFont('Onest', 'normal');
    doc.setLineHeightFactor(1.25);
    return doc;
  }

  const set = (doc, size, style = 'normal', color = INK) => {
    doc.setFont('Onest', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const hr = (doc, x1, y, x2, color = LINE, w = 0.3) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
    doc.line(x1, y, x2, y);
  };

  function brand(doc, x, y, right, subtitle) {
    set(doc, 18, 'bold', BRICK);
    doc.text('GRAND', x, y, { charSpace: 1.2 });
    set(doc, 7.5, 'normal', MUTED);
    doc.text(ADDRESS, x, y + 5);
    if (subtitle) {
      set(doc, 9, 'bold', INK);
      doc.text(subtitle, right, y, { align: 'right' });
    }
    hr(doc, x, y + 8, right, BRICK, 0.8);
    return y + 8;
  }

  function basisText(part, ctx) {
    const b = ctx.result.bases;
    if (part === 'fixed') return `поравно между ${b.fixed} обекта`;
    if (part === 'water') return `поравно между ${b.water} обекта`;
    if (part === 'power') return `по идеални части, база ${F.pct(b.power)}%`;
    return `по идеални части, база ${F.pct(b.chillers)}% (етажи 1–3)`;
  }

  const SLIP_LABEL = {
    fixed: 'Равен дял от постоянните разходи',
    water: 'Равен дял от водата за общите части',
    power: 'Дял от електроенергията за общите части',
    chillers: 'Дял от електроенергията за чилърите',
  };

  // Една бележка на текущата страница (A5)
  function drawSlip(doc, ctx, row) {
    const W = doc.internal.pageSize.getWidth();
    const L = 14, R = W - 14;
    let y = brand(doc, L, 18, R, 'МЕСЕЧНА БЕЛЕЖКА');

    y += 10;
    set(doc, 9, 'normal', MUTED);
    doc.text(`Отчетен период: ${F.monthName(ctx.monthId)}`, L, y);
    y += 8;
    set(doc, 17, 'bold', INK);
    doc.text(`Обект ${row.id}`, L, y);
    set(doc, 9, 'normal', MUTED);
    doc.text(`Идеална част ${F.pct(row.share)}%`, R, y, { align: 'right' });

    y += 9;
    hr(doc, L, y, R);
    for (const p of C.PARTS) {
      y += 7;
      const on = row[p];
      set(doc, 10, 'normal', INK);
      doc.text(SLIP_LABEL[p], L, y);
      set(doc, 10, on ? 'bold' : 'normal', on ? INK : MUTED);
      doc.text(on ? F.eurPdf(row.parts[p]) : 'не участва', R, y, { align: 'right' });
      y += 4.2;
      set(doc, 7.5, 'normal', MUTED);
      doc.text(on ? basisText(p, ctx) : 'обектът не участва в това перо', L, y);
      y += 3;
      hr(doc, L, y, R);
    }

    y += 5;
    doc.setFillColor(243, 236, 233);
    doc.roundedRect(L, y, R - L, 16, 2, 2, 'F');
    set(doc, 10, 'bold', INK);
    doc.text('ЗА ПЛАЩАНЕ', L + 5, y + 10);
    set(doc, 17, 'bold', BRICK);
    doc.text(F.eurPdf(row.total), R - 5, y + 10.5, { align: 'right' });

    y += 26;
    set(doc, 8.5, 'bold', INK);
    doc.text('Общи суми за месеца (чл. 11)', L, y);
    const r = ctx.result;
    const lines = [
      ['Постоянни текущи разходи', C.sumItems(ctx.month.fixedItems)],
      ['Приходи от общите части', C.sumItems(ctx.month.revenueItems)],
      ['  от тях приспаднати', r.deducted],
      ['Вода за общите части', r.pools.water],
      ['Ток за общите части', r.pools.power],
      ['Ток за чилърите', r.pools.chillers],
      ['Общо за разпределяне', r.totalPool],
    ];
    set(doc, 8, 'normal', MUTED);
    for (const [label, v] of lines) {
      y += 4.4;
      doc.text(label, L, y);
      doc.text(F.eurPdf(v), R, y, { align: 'right' });
    }
    if (row.note) {
      y += 7;
      set(doc, 7.5, 'normal', BRICK);
      doc.text(doc.splitTextToSize('Бележка: ' + row.note, R - L), L, y);
    }

    const H = doc.internal.pageSize.getHeight();
    set(doc, 6.8, 'normal', MUTED);
    doc.text(doc.splitTextToSize(METHOD, R - L), L, H - 14);
    doc.text(`Всички суми са в евро. Изготвено: ${new Date().toLocaleDateString('bg-BG')}`, L, H - 7.5);
  }

  async function slip(ctx, row) {
    await ready();
    const doc = newDoc('a5');
    drawSlip(doc, ctx, row);
    return doc.output('blob');
  }

  // Всички бележки в един файл, по една на страница (за печат)
  async function allSlips(ctx) {
    await ready();
    const rows = ctx.result.rows.filter((r) => r.total !== 0);
    const doc = newDoc('a5');
    rows.forEach((row, i) => {
      if (i) doc.addPage('a5');
      drawSlip(doc, ctx, row);
    });
    return doc.output('blob');
  }

  // ZIP с отделен PDF за всеки обект (за изпращане по имейл)
  async function zip(ctx, onProgress) {
    await ready();
    await window.GrandLibs.load('jszip');
    const z = new window.JSZip();
    const rows = ctx.result.rows.filter((r) => r.total !== 0);
    for (let i = 0; i < rows.length; i++) {
      const doc = newDoc('a5');
      drawSlip(doc, ctx, rows[i]);
      z.file(`Belezhka_${ctx.monthId}_${F.file(rows[i].id)}.pdf`, doc.output('arraybuffer'));
      if (onProgress && i % 10 === 0) { onProgress(i, rows.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // Справка по чл. 11 (A4)
  async function report(ctx) {
    await ready();
    const doc = newDoc('a4');
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const L = 16, R = W - 16;
    const r = ctx.result, m = ctx.month;
    let y = brand(doc, L, 18, R, ctx.locked ? 'ЗАКЛЮЧЕН МЕСЕЦ' : 'ЧЕРНОВА');

    const need = (h) => { if (y + h > H - 18) { doc.addPage('a4'); y = 20; return true; } return false; };
    const section = (t) => { need(14); y += 10; set(doc, 11, 'bold', INK); doc.text(t, L, y); y += 2; hr(doc, L, y, R); };
    const line = (label, v, bold, color) => {
      need(6); y += 5.6;
      set(doc, 9.5, bold ? 'bold' : 'normal', color || INK);
      doc.text(label, L, y);
      doc.text(typeof v === 'string' ? v : F.eurPdf(v), R, y, { align: 'right' });
    };

    y += 11;
    set(doc, 15, 'bold', INK);
    doc.text(`Справка за ${F.monthName(ctx.monthId)}`, L, y);
    y += 6;
    set(doc, 9, 'normal', MUTED);
    doc.text('Разходи за управление и поддръжка на общите части и приходи от тях (чл. 11 от Методиката)', L, y);

    section('1. Извършени разходи по видове');
    const fixedItems = (m.fixedItems || []).filter((it) => Number(it.amount));
    fixedItems.forEach((it) => line('   ' + (it.name || 'Без име'), Number(it.amount)));
    line('Постоянни текущи разходи — общо', C.sumItems(m.fixedItems), true);
    line('Вода (ВиК) за общите части', Number(m.water) || 0, true);
    line('Електроенергия за общите части', Number(m.power) || 0, true);
    line('Електроенергия за ОВК системата (чилъри)', Number(m.chillers) || 0, true);
    y += 1.5; hr(doc, L, y, R, INK, 0.5);
    line('Разходи общо', C.sumItems(m.fixedItems) + (Number(m.water) || 0) + (Number(m.power) || 0) + (Number(m.chillers) || 0), true);

    section('2. Постъпили общи приходи и третиране по чл. 10');
    const revItems = (m.revenueItems || []).filter((it) => Number(it.amount));
    if (!revItems.length) line('Няма постъпили приходи', '');
    revItems.forEach((it) => line('   ' + (it.name || 'Без име'), Number(it.amount)));
    line('Приходи общо', C.sumItems(m.revenueItems), true);
    line(DEDUCT[m.deductMode || 'full'] + (m.deductMode === 'partial' ? ` — ${F.n2(m.deductPct, 0)}%` : ''), r.deducted, true, BRICK);
    if (m.deductReason && m.deductMode !== 'full') line('   Основание: ' + m.deductReason, '');
    line('Приспаднатите приходи намаляват постоянните разходи', '', false, MUTED);

    section('3. Разпределение между обектите');
    const cols3 = [L, L + 72, L + 112, R];
    need(8); y += 6;
    set(doc, 8, 'bold', MUTED);
    doc.text('Перо', cols3[0], y); doc.text('Как се дели', cols3[1], y);
    doc.text('База', cols3[2], y); doc.text('Сума', cols3[3], y, { align: 'right' });
    const how = { fixed: 'поравно (чл. 5)', water: 'поравно (чл. 6)', power: 'по ид. части (чл. 7)', chillers: 'по ид. части (чл. 8)' };
    const base = { fixed: `${r.bases.fixed} обекта`, water: `${r.bases.water} обекта`, power: `${F.pct(r.bases.power)}%`, chillers: `${F.pct(r.bases.chillers)}%` };
    for (const p of C.PARTS) {
      need(6); y += 5.6;
      set(doc, 9.5, 'normal', INK);
      doc.text(C.LABELS[p], cols3[0], y);
      set(doc, 9, 'normal', MUTED);
      doc.text(how[p], cols3[1], y); doc.text(base[p], cols3[2], y);
      set(doc, 9.5, 'bold', INK);
      doc.text(F.eurPdf(r.pools[p]), cols3[3], y, { align: 'right' });
    }
    y += 1.5; hr(doc, L, y, R, INK, 0.5);
    line(`За разпределяне между ${r.payers} обекта`, r.totalPool, true);
    if (m.note) {
      need(12); y += 8;
      set(doc, 9, 'normal', MUTED);
      const t = doc.splitTextToSize('Бележка: ' + m.note, R - L);
      need(t.length * 4.5); doc.text(t, L, y); y += t.length * 4.5;
    }

    section('4. Сметки по обекти');
    const cols = [L, L + 50, L + 78, L + 103, L + 124, L + 150, R];
    const header = () => {
      y += 6;
      set(doc, 7.5, 'bold', MUTED);
      doc.text('Обект', cols[0], y);
      ['Ид. част %', 'Постоянни', 'Вода', 'Ток общи', 'Чилъри', 'Общо €'].forEach((h, i) => doc.text(h, cols[i + 1], y, { align: 'right' }));
      y += 1.6; hr(doc, L, y, R);
    };
    need(14); header();
    for (const row of r.rows) {
      if (need(5)) header();
      y += 4.6;
      set(doc, 8, row.total ? 'normal' : 'normal', row.total ? INK : MUTED);
      doc.text(String(row.id), cols[0], y);
      doc.text(F.pct(row.share), cols[1], y, { align: 'right' });
      C.PARTS.forEach((p, i) => doc.text(F.dash(row.parts[p]).replace(/ /g, ' '), cols[i + 2], y, { align: 'right' }));
      set(doc, 8, 'bold', row.total ? INK : MUTED);
      doc.text(F.dash(row.total).replace(/ /g, ' '), cols[6], y, { align: 'right' });
    }
    need(8); y += 2; hr(doc, L, y, R, INK, 0.5); y += 5;
    set(doc, 8.5, 'bold', INK);
    doc.text(`Общо (${r.rows.length})`, cols[0], y);
    doc.text(F.pct(r.rows.reduce((s, x) => s + x.share, 0)), cols[1], y, { align: 'right' });
    C.PARTS.forEach((p, i) => doc.text(F.n2(r.rows.reduce((s, x) => s + x.parts[p], 0), 2, ' '), cols[i + 2], y, { align: 'right' }));
    doc.text(F.n2(r.rows.reduce((s, x) => s + x.total, 0), 2, ' '), cols[6], y, { align: 'right' });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      set(doc, 7, 'normal', MUTED);
      doc.text(`ТАЦ „Гранд“ · Справка за ${F.monthName(ctx.monthId)} · всички суми са в евро`, L, H - 9);
      doc.text(`стр. ${i} от ${pages}`, R, H - 9, { align: 'right' });
    }
    return doc.output('blob');
  }

  window.GrandPDF = { slip, allSlips, zip, report };
})();
