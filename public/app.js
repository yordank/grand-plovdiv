(function () {
  const $ = (id) => document.getElementById(id);
  const eur = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });
  const num = new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fmt = (v) => (Math.abs(v) < 0.005 ? '–' : num.format(v));
  const KIND = { terrace: 'тераса', garage: 'гараж', hypermarket: 'хипермаркет' };
  const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

  let objects = [];
  let result = null;
  let floorFilter = 'all';

  function monthLabel() {
    const v = $('month').value;
    if (!v) return '';
    const [y, m] = v.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }

  function readInput() {
    const ids = ['fixed', 'water', 'power', 'chillers', 'revenue', 'deductPct'];
    return Object.fromEntries(ids.map((k) => [k, $(k).value]));
  }

  function renderPools() {
    const r = result;
    const cards = [
      ['Постоянни (поравно)', r.pools.fixed, `${r.bases.fixed} обекта` + (r.deducted ? ` · −${eur.format(r.deducted)} приходи` : '')],
      ['Вода общи (поравно)', r.pools.water, `${r.bases.water} обекта`],
      ['Ток общи (ид. части)', r.pools.power, `база ${pct.format(r.bases.power)}%`],
      ['Чилъри (ид. части)', r.pools.chillers, `база ${pct.format(r.bases.chillers)}%`],
    ];
    $('pools').innerHTML =
      cards.map(([n, s, b]) =>
        `<div class="pool"><span class="pool__name">${n}</span><span class="pool__sum">${eur.format(s)}</span><span class="pool__base">${b}</span></div>`
      ).join('') +
      `<div class="pool pool--total"><span class="pool__name">За разпределяне</span><span class="pool__sum">${eur.format(r.totalPool)}</span><span class="pool__base">между ${r.rows.filter((x) => x.total > 0).length} обекта</span></div>`;

    const st = $('status');
    st.textContent = r.balanced ? 'Сборът съвпада' : 'Сборът не съвпада';
    st.className = 'pill ' + (r.balanced ? 'ok' : 'bad');
  }

  function matchesFloor(o) {
    if (floorFilter === 'all') return true;
    if (floorFilter === 'other') return !(o.floor >= 1 && o.floor <= 4) || o.kind !== 'unit';
    return String(o.floor) === floorFilter && o.kind === 'unit';
  }

  function renderRows() {
    const q = $('q').value.trim().toLowerCase();
    const list = result.rows.filter((o) => matchesFloor(o) && (!q || o.id.toLowerCase().includes(q)));
    $('rows').innerHTML = list.map((o) => {
      const tags = [];
      if (KIND[o.kind]) tags.push(`<span class="tag">${KIND[o.kind]}</span>`);
      if (o.note) tags.push(`<span class="tag warn" title="${o.note}">провери</span>`);
      return `<tr data-id="${encodeURIComponent(o.id)}" class="${o.total ? '' : 'zero'}">
        <td>${o.id}${tags.join('')}</td>
        <td class="num">${pct.format(o.share)}</td>
        <td class="num">${fmt(o.parts.fixed)}</td>
        <td class="num">${fmt(o.parts.water)}</td>
        <td class="num">${fmt(o.parts.power)}</td>
        <td class="num">${fmt(o.parts.chillers)}</td>
        <td class="num total">${fmt(o.total)}</td></tr>`;
    }).join('');
    const sum = (k) => list.reduce((s, o) => s + (k ? o.parts[k] : o.total), 0);
    $('foot').innerHTML = `<tr><td>Общо (${list.length})</td>
      <td class="num">${pct.format(list.reduce((s, o) => s + o.share, 0))}</td>
      <td class="num">${fmt(sum('fixed'))}</td><td class="num">${fmt(sum('water'))}</td>
      <td class="num">${fmt(sum('power'))}</td><td class="num">${fmt(sum('chillers'))}</td>
      <td class="num">${fmt(sum())}</td></tr>`;
  }

  function update() {
    $('deductOut').textContent = $('deductPct').value + '%';
    $('monthLabel').textContent = monthLabel();
    result = window.GrandCalc.calculate(objects, readInput());
    renderPools();
    renderRows();
  }

  function openSlip(id) {
    const o = result.rows.find((x) => x.id === id);
    if (!o) return;
    const line = (label, v, on) => `<dt>${label}</dt><dd>${on ? eur.format(v) : 'не участва'}</dd>`;
    $('slip').innerHTML = `
      <div class="slip__brand">GRAND</div>
      <div class="slip__addr">ТАЦ „Гранд“ · гр. Пловдив, ул. „Капитан Райчо“ № 56</div>
      <h3 id="slipTitle">Обект ${o.id}</h3>
      <p class="small">Бележка за ${monthLabel()} · идеална част ${pct.format(o.share)}%</p>
      <dl>
        ${line('Равен дял от постоянните разходи', o.parts.fixed, o.fixed)}
        ${line('Равен дял от водата за общите части', o.parts.water, o.water)}
        ${line('Дял от тока за общите части', o.parts.power, o.power)}
        ${line('Дял от тока за чилърите', o.parts.chillers, o.chillers)}
      </dl>
      <div class="due"><span>За плащане</span><strong>${eur.format(o.total)}</strong></div>
      <p class="small">Разпределено по Методиката, Приложение № 8 към Протокол от ОС на ЕС от 06.10.2026 г.${o.note ? ' Бележка: ' + o.note + '.' : ''}</p>`;
    $('sheet').hidden = false;
    $('close').focus();
  }

  function closeSlip() { $('sheet').hidden = true; }

  $('form').addEventListener('input', update);
  $('form').addEventListener('submit', (e) => e.preventDefault());
  $('q').addEventListener('input', renderRows);
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    floorFilter = b.dataset.f;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === b));
    renderRows();
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr) openSlip(decodeURIComponent(tr.dataset.id));
  });
  $('close').addEventListener('click', closeSlip);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSlip(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSlip(); });

  fetch('/api/objects')
    .then((r) => r.json())
    .then((data) => { objects = data; update(); })
    .catch(() => { $('rows').innerHTML = '<tr><td colspan="7">Списъкът с обекти не се зареди. Провери дали сървърът работи.</td></tr>'; });
})();
