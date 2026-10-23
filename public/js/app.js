(function () {
  const F = window.GrandFmt, C = window.GrandCalc, S = window.GrandStore, E = window.GrandExcel, P = window.GrandPDF;
  const esc = F.esc;
  const app = document.getElementById('app');

  const KIND = { unit: 'обект', terrace: 'тераса', garage: 'гараж', hypermarket: 'хипермаркет' };
  const PART_SHORT = { fixed: 'Постоянни', water: 'Вода', power: 'Ток общи', chillers: 'Чилъри' };
  const DEFAULT_FIXED = [
    'Наем и разходи за трафопост', 'Охрана — физическа и техническа', 'Почистване', 'Поддръжка на асансьори и ескалатори',
    'Видеонаблюдение, интернет и комуникации', 'Дезинсекция и дератизация', 'Противопожарни системи',
    'Възнаграждение на управителя', 'Юридическо и счетоводно обслужване', 'Заплати и осигуровки', 'Банкови такси',
    'Административни услуги', 'Консумативи и материали',
  ];
  const DEFAULT_REVENUE = ['Рекламни площи', 'LED екран', 'Санитарни помещения', 'Автомати'];
  const REASONS = ['Решение на Общото събрание', 'Несъбираемост на вземания', 'Просрочени задължения към доставчици'];

  const state = {
    me: null, objects: null, months: [],
    view: 'dashboard', monthId: null,
    month: null, monthStatus: null, saveState: '', saveTimer: null, saving: null, saveAgain: false,
    rowsQ: '', rowsFloor: 'all', confirm: null, busy: {},
    objDraft: null, objDirty: false, objQ: '', objKind: 'all', importInfo: null,
    historyObj: '',
  };

  // ---------- помощни ----------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let toastTimer = null;
  function toast(msg, kind = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + kind;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 7000 : 3500);
  }
  const canEdit = () => !!(state.me && state.me.canEdit);
  const pill = (status) => status === 'locked'
    ? '<span class="pill pill--locked">Заключен</span>'
    : '<span class="pill pill--draft">Чернова</span>';

  function resultFor(m) {
    if (m.status === 'locked' && m.snapshot) return C.fromSnapshot(m.snapshot);
    return C.calculate(state.objects || [], C.monthInput(m));
  }
  function ctxFor(m) {
    return { monthId: m.id, month: m, result: resultFor(m), locked: m.status === 'locked' };
  }

  async function download(name, makeBlob, key) {
    if (state.busy[key]) return;
    state.busy[key] = true;
    renderBusy();
    try {
      const blob = await makeBlob();
      const ok = await S.download(name, blob);
      if (ok) toast('Файлът е готов: ' + name, 'ok');
    } catch (e) {
      toast(e.message || 'Файлът не можа да се направи.', 'bad');
    } finally {
      state.busy[key] = false;
      renderBusy();
    }
  }
  function renderBusy() {
    document.querySelectorAll('[data-busy]').forEach((b) => {
      const on = !!state.busy[b.dataset.busy];
      b.disabled = on;
      b.classList.toggle('is-busy', on);
    });
  }

  // ---------- навигация ----------
  // Навигацията пази текущия екран в паметта; адресът (#months и т.н.) се обновява, когато е възможно
  let current = (location.hash || '').replace(/^#/, '');
  function parseHash() {
    const h = current;
    const m = /^month-(\d{4}-\d{2})$/.exec(h);
    if (m) return { view: 'month', monthId: m[1] };
    if (['dashboard', 'months', 'objects', 'settings'].includes(h)) return { view: h };
    return { view: 'dashboard' };
  }
  function go(token) {
    current = token;
    try { if (location.hash.replace(/^#/, '') !== token) history.pushState(null, '', '#' + token); } catch { /* адресът не може да се смени тук */ }
    route();
  }
  async function route() {
    await flushMonth();
    if (state.view === 'objects' && state.objDirty) {
      toast('Промените по обектите не са запазени — върни се в „Обекти“ и натисни „Запази“.', 'bad');
    }
    const r = parseHash();
    state.view = r.view;
    state.confirm = null;
    if (r.view === 'month') await openMonth(r.monthId);
    else render();
    window.scrollTo(0, 0);
  }

  // ---------- зареждане ----------
  async function boot() {
    try {
      state.me = await S.init();
    } catch (e) {
      return renderMessage('Сървърът не отговаря', e.message || 'Опитай отново след малко.');
    }
    if (!state.me.signedIn) {
      if (state.me.canLogin) return renderLogin();
      return renderMessage('Няма достъп до данните', state.me.reason || '');
    }
    await loadData();
    route();
  }
  async function loadData() {
    const [objects, months] = await Promise.all([S.getObjects(), S.listMonths()]);
    state.objects = objects;
    state.months = months || [];
  }

  // ---------- общи части от екрана ----------
  function shell(content, opts = {}) {
    const nav = [['dashboard', 'Табло'], ['months', 'Месеци'], ['objects', 'Обекти']];
    if (S.mode === 'server') nav.push(['settings', 'Настройки']);
    const active = state.view === 'month' ? 'months' : state.view;
    app.innerHTML = `
      <header class="topbar">
        <div class="wrap topbar__in">
          <a class="logo" href="#dashboard" aria-label="Табло"><span class="brand-mark">GRAND</span><span class="logo__sub">сметки</span></a>
          <nav class="nav" aria-label="Основно меню">
            ${nav.map(([k, l]) => `<a href="#${k}" class="nav__link${active === k ? ' is-on' : ''}"${active === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
          </nav>
          <div class="who">
            ${S.mode === 'local' ? '<span class="pill pill--draft" title="Данните се пазят само в този браузър">Демо</span>' : ''}
            ${canEdit() ? '' : '<span class="pill pill--muted">Само преглед</span>'}
            ${state.me.user ? `<span class="who__name">${esc(state.me.user)}</span>` : ''}
            ${S.mode === 'server' ? '<button type="button" class="btn btn--ghost btn--sm" data-action="logout">Изход</button>' : ''}
          </div>
        </div>
      </header>
      ${opts.hero || ''}
      ${S.mode === 'local' ? '<div class="wrap"><p class="demo-note">Демо версия: данните се пазят само в този браузър. Числата са твои — никой друг не ги вижда.</p></div>' : ''}
      <main class="wrap page">${content}</main>
      <footer class="wrap foot">ТАЦ „Гранд“ · гр. Пловдив, ул. „Капитан Райчо“ № 56 · Методика от 06.10.2026 г., в сила от 01.01.2027 г.</footer>`;
  }

  function renderMessage(title, text) {
    app.innerHTML = `<div class="center-screen"><div class="card card--narrow"><span class="brand-mark brand-mark--brick">GRAND</span><h1 class="h2">${esc(title)}</h1><p class="muted">${esc(text)}</p></div></div>`;
  }

  function renderLogin(error = '') {
    app.innerHTML = `
      <div class="login">
        <form class="card login__card" id="login-form">
          <span class="brand-mark brand-mark--brick">GRAND</span>
          <h1 class="h2">Месечни сметки</h1>
          <p class="muted">Вход за управителя на ТАЦ „Гранд“</p>
          <label class="field"><span>Потребител</span><input id="login-user" name="user" autocomplete="username" required></label>
          <label class="field"><span>Парола</span><input id="login-pass" name="password" type="password" autocomplete="current-password" required></label>
          ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">Влез</button>
        </form>
      </div>`;
    document.getElementById('login-user').focus();
  }

  function noObjects() {
    return `<section class="card empty">
      <h2 class="h3">Списъкът с обекти още не е зареден</h2>
      <p class="muted">Внеси Excel файла с номерата на обектите и идеалните части. Отметките за участие се попълват по методиката и после могат да се променят.</p>
      ${canEdit() ? '<a class="btn btn--primary" href="#objects">Към „Обекти“</a>' : '<p class="muted">Само редактор може да зареди списъка.</p>'}
    </section>`;
  }

  // ---------- табло ----------
  function chartSVG(items) {
    if (!items.length) return '';
    const W = 640, H = 240, padL = 56, padB = 28, padT = 12, padR = 8;
    const max = Math.max(...items.map((x) => x.total), 1);
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const bw = Math.min(46, ((W - padL - padR) / items.length) * 0.6);
    const gap = (W - padL - padR) / items.length;
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
      g += `<text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${F.n2(v, 0)}</text>`;
    }
    items.forEach((it, i) => {
      const x = padL + gap * i + (gap - bw) / 2;
      let acc = 0;
      C.PARTS.forEach((p) => {
        const v = Math.max(it.parts[p], 0);
        if (!v) return;
        const y1 = y(acc + v), y0 = y(acc);
        g += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(y0 - y1, 0.5).toFixed(1)}" class="s-${p}${it.status === 'draft' ? ' is-draft' : ''}"><title>${esc(F.monthTitle(it.id))} · ${PART_SHORT[p]}: ${F.eur(v)}</title></rect>`;
        acc += v;
      });
      g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="tick">${esc(F.MONTHS[Number(it.id.slice(5)) - 1].slice(0, 3))} ${it.id.slice(2, 4)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Разходи по месеци">${g}</svg>`;
  }
  function niceStep(max) {
    const raw = max / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function renderDashboard() {
    if (!state.objects) return shell(noObjects());
    const months = [...state.months].sort((a, b) => a.id.localeCompare(b.id));
    const data = months.map((m) => {
      const r = resultFor(m);
      return { id: m.id, status: m.status, total: r.totalPool, parts: r.pools, payers: r.payers, result: r };
    });
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const payers = C.calculate(state.objects, { fixed: 1 }).bases.fixed;
    const toCheck = state.objects.filter((o) => o.note).length;
    const change = last && prev && prev.total ? ((last.total - prev.total) / prev.total) * 100 : null;

    const hero = `
      <section class="hero">
        <div class="wrap hero__in">
          <div>
            <p class="eyebrow">ТАЦ „Гранд“ · Пловдив</p>
            <h1 class="hero__title">Разходи за общите части</h1>
            <p class="hero__lead">${last ? `Последен месец: ${esc(F.monthName(last.id))} — ${last.status === 'locked' ? 'заключен' : 'чернова'}.` : 'Още няма въведен месец. Методиката важи от януари 2027 г.'}</p>
          </div>
          ${canEdit() ? '<button type="button" class="btn btn--primary btn--lg" data-action="new-month">Нов месец</button>' : ''}
        </div>
      </section>`;

    const kpis = `
      <div class="kpis">
        <div class="kpi"><span class="kpi__label">${last ? esc(F.monthTitle(last.id)) : 'Последен месец'}</span><span class="kpi__value">${last ? F.eur(last.total) : '–'}</span><span class="kpi__sub">${change == null ? 'за разпределяне' : `${change >= 0 ? '+' : '−'}${F.n2(Math.abs(change), 1)}% спрямо ${esc(F.monthName(prev.id))}`}</span></div>
        <div class="kpi"><span class="kpi__label">Средна сметка</span><span class="kpi__value">${last && last.payers ? F.eur(last.total / last.payers) : '–'}</span><span class="kpi__sub">на обект за месеца</span></div>
        <div class="kpi"><span class="kpi__label">Обекти</span><span class="kpi__value">${state.objects.length}</span><span class="kpi__sub">${payers} плащат · ${state.objects.length - payers} тераси</span></div>
        <a class="kpi kpi--link" href="#objects"><span class="kpi__label">За проверка</span><span class="kpi__value${toCheck ? ' is-warn' : ''}">${toCheck}</span><span class="kpi__sub">обекта с бележка</span></a>
      </div>`;

    const legend = C.PARTS.map((p) => `<span class="legend__item"><i class="sw s-${p}"></i>${PART_SHORT[p]}</span>`).join('');
    const chart = data.length
      ? `<section class="card">
          <div class="card__head"><h2 class="h3">Разходи по месеци</h2><div class="legend">${legend}<span class="legend__item"><i class="sw sw--draft"></i>чернова</span></div></div>
          <div class="chart-wrap">${chartSVG(data.slice(-12))}</div>
        </section>`
      : `<section class="card empty">
          <h2 class="h3">Няма месеци</h2>
          <p class="muted">Създай първия месец, въведи разходите и приходите и сметките на всички ${state.objects.length} обекта ще се изчислят веднага.</p>
          ${canEdit() ? '<button type="button" class="btn btn--primary" data-action="new-month">Създай първия месец</button>' : ''}
        </section>`;

    const recent = [...data].reverse().slice(0, 6);
    const list = recent.length ? `
      <section class="card">
        <div class="card__head"><h2 class="h3">Последни месеци</h2><a href="#months" class="link">Всички</a></div>
        <ul class="month-list">
          ${recent.map((m) => `<li><a href="#month-${m.id}" class="month-list__row">
            <span class="month-list__name">${esc(F.monthTitle(m.id))}</span>${pill(m.status)}
            <span class="month-list__sum">${F.eur(m.total)}</span></a></li>`).join('')}
        </ul>
      </section>` : '';

    shell(`${kpis}<div class="dash-grid">${chart}${list}</div>`, { hero });
  }

  // ---------- нов месец ----------
  function newMonthDialog() {
    const ids = state.months.map((m) => m.id).sort();
    const suggest = ids.length ? F.nextMonth(ids[ids.length - 1]) : '2027-01';
    openSheet(`
      <form id="new-month-form" class="sheet__body">
        <h2 class="h3">Нов месец</h2>
        <label class="field"><span>Отчетен месец</span><input id="nm-month" type="month" value="${suggest}" required></label>
        ${ids.length ? `<label class="check"><input type="checkbox" id="nm-copy" checked> Копирай разходите и приходите от ${esc(F.monthName(ids[ids.length - 1]))}</label>` : ''}
        <p class="form-error" id="nm-error" hidden></p>
        <div class="row-actions"><button type="button" class="btn btn--ghost" data-action="close-sheet">Откажи</button><button class="btn btn--primary" type="submit">Създай</button></div>
      </form>`);
  }
  async function createMonth(id, copy) {
    if (state.months.some((m) => m.id === id)) throw new Error(`${F.monthTitle(id)} вече съществува.`);
    let data = {
      fixedItems: DEFAULT_FIXED.map((name) => ({ name, amount: 0 })),
      water: 0, power: 0, chillers: 0,
      revenueItems: DEFAULT_REVENUE.map((name) => ({ name, amount: 0 })),
      deductMode: 'full', deductPct: 100, deductReason: '', note: '',
    };
    if (copy) {
      const src = [...state.months].sort((a, b) => b.id.localeCompare(a.id))[0];
      if (src) data = { ...clone(src), note: '' };
      delete data.snapshot; delete data.status; delete data.lockedAt; delete data.updatedAt; delete data.id;
    }
    const saved = await S.saveMonth(id, data);
    state.months = [...state.months.filter((m) => m.id !== id), { ...saved, id }];
    return saved;
  }

  // ---------- месец ----------
  async function openMonth(id) {
    if (!state.objects) { shell(noObjects()); return; }
    let m = state.months.find((x) => x.id === id);
    if (!m) {
      try { m = await S.getMonth(id); } catch (e) { toast(e.message, 'bad'); }
    }
    if (!m) {
      shell(`<section class="card empty"><h2 class="h3">${esc(F.monthTitle(id))} не е създаден</h2>
        ${canEdit() ? `<button type="button" class="btn btn--primary" data-action="create-month" data-id="${id}">Създай го</button>` : ''}
        <a class="btn btn--ghost" href="#dashboard">Към таблото</a></section>`);
      return;
    }
    state.monthId = id;
    state.month = clone(m);
    state.month.fixedItems = state.month.fixedItems || [];
    state.month.revenueItems = state.month.revenueItems || [];
    state.saveState = '';
    state.rowsQ = '';
    state.rowsFloor = 'all';
    renderMonth();
  }

  function itemRows(list, key, locked) {
    return `<div class="items" data-list="${key}">
      ${list.map((it, i) => `<div class="item">
        <input class="item__name" aria-label="Описание" data-list="${key}" data-i="${i}" data-k="name" value="${esc(it.name)}" ${locked ? 'disabled' : ''} placeholder="Описание">
        <input class="item__amount num-input" aria-label="Сума в евро" inputmode="decimal" data-list="${key}" data-i="${i}" data-k="amount" value="${C.num(it.amount) ? esc(typeof it.amount === 'number' ? F.n2(it.amount) : it.amount) : ''}" ${locked ? 'disabled' : ''} placeholder="0,00">
        ${locked ? '' : `<button type="button" class="icon-btn" data-action="del-item" data-list="${key}" data-i="${i}" aria-label="Премахни ред">×</button>`}
      </div>`).join('')}
      ${locked ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-action="add-item" data-list="${key}">+ Добави ред</button>`}
    </div>`;
  }
  const amountField = (key, label, hint, locked) => `
    <label class="field field--amount"><span>${label}<em>${hint}</em></span>
      <input class="num-input" inputmode="decimal" data-f="${key}" value="${C.num(state.month[key]) ? esc(typeof state.month[key] === 'number' ? F.n2(state.month[key]) : state.month[key]) : ''}" ${locked ? 'disabled' : ''} placeholder="0,00"></label>`;

  function renderMonth() {
    const m = state.month;
    const locked = m.status === 'locked' || !canEdit();
    const isLocked = m.status === 'locked';
    const conf = state.confirm;
    const confirmBar = conf ? `<div class="confirm" role="alertdialog" aria-label="Потвърждение">
        <p>${conf === 'lock' ? 'Заключването записва сметките на всички обекти. След това месецът не може да се променя, докато не се отключи.' : conf === 'unlock' ? 'Отключването изтрива записаните сметки. Те ще се изчислят наново при следващото заключване.' : 'Черновата ще бъде изтрита завинаги.'}</p>
        <div class="row-actions"><button type="button" class="btn btn--ghost" data-action="cancel-confirm">Откажи</button>
        <button type="button" class="btn ${conf === 'delete' ? 'btn--danger' : 'btn--primary'}" data-action="do-${conf}">${conf === 'lock' ? 'Заключи' : conf === 'unlock' ? 'Отключи' : 'Изтрий'}</button></div>
      </div>` : '';

    const actions = canEdit() ? (isLocked
      ? '<button type="button" class="btn btn--ghost" data-action="confirm" data-what="unlock">Отключи</button>'
      : '<button type="button" class="btn btn--ghost btn--danger-text" data-action="confirm" data-what="delete">Изтрий</button><button type="button" class="btn btn--primary" data-action="confirm" data-what="lock">Изчисли и заключи</button>') : '';

    shell(`
      <div class="page-head">
        <div>
          <a href="#months" class="back">← Месеци</a>
          <h1 class="h1">${esc(F.monthTitle(m.id))} ${pill(m.status)}</h1>
          <p class="muted save-state" id="save-state">${isLocked && m.lockedAt ? 'Заключен на ' + new Date(m.lockedAt).toLocaleString('bg-BG') : ''}</p>
        </div>
        <div class="row-actions">${actions}</div>
      </div>
      ${confirmBar}
      <div class="exports" aria-label="Файлове">
        <button type="button" class="btn btn--soft btn--sm" data-action="pdf-all" data-busy="pdf-all">Всички бележки (PDF)</button>
        <button type="button" class="btn btn--soft btn--sm" data-action="pdf-zip" data-busy="pdf-zip">Бележки поотделно (ZIP)</button>
        <button type="button" class="btn btn--soft btn--sm" data-action="pdf-report" data-busy="pdf-report">Справка по чл. 11 (PDF)</button>
        <button type="button" class="btn btn--soft btn--sm" data-action="xlsx-month" data-busy="xlsx-month">Excel</button>
      </div>
      <div class="month-grid">
        <form class="card month-form" id="month-form" autocomplete="off">
          <fieldset ${locked ? 'disabled' : ''}>
            <legend class="section-title">Постоянни текущи разходи <em>чл. 5 · поравно</em></legend>
            ${itemRows(m.fixedItems, 'fixedItems', locked)}
            <p class="subtotal">Общо: <strong id="fixed-total">${F.eur(C.sumItems(m.fixedItems))}</strong></p>
          </fieldset>
          <fieldset ${locked ? 'disabled' : ''}>
            <legend class="section-title">Комунални за общите части</legend>
            ${amountField('water', 'Вода (ВиК) за общите части', 'чл. 6 · поравно, без гараж и хипермаркет', locked)}
            ${amountField('power', 'Ток за общите части', 'чл. 7 · по идеални части без терасите', locked)}
            ${amountField('chillers', 'Ток за чилърите (ОВК)', 'чл. 8 · по идеални части, етажи 1–3', locked)}
          </fieldset>
          <fieldset ${locked ? 'disabled' : ''}>
            <legend class="section-title">Приходи от общите части <em>чл. 10</em></legend>
            ${itemRows(m.revenueItems, 'revenueItems', locked)}
            <p class="subtotal">Общо: <strong id="rev-total">${F.eur(C.sumItems(m.revenueItems))}</strong></p>
            <div class="radios" role="radiogroup" aria-label="Приспадане на приходите">
              ${[['full', 'Приспадат се изцяло', 'основно правило, ал. 1'], ['partial', 'Приспадат се частично', 'ал. 2'], ['none', 'Не се приспадат', 'ал. 2']].map(([v, l, h]) => `
                <label class="radio"><input type="radio" name="deductMode" value="${v}" ${m.deductMode === v || (!m.deductMode && v === 'full') ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${l}<em>${h}</em></span></label>`).join('')}
            </div>
            <div class="deduct-extra" ${m.deductMode && m.deductMode !== 'full' ? '' : 'hidden'} id="deduct-extra">
              <label class="field field--amount" ${m.deductMode === 'partial' ? '' : 'hidden'} id="pct-field"><span>Приспада се, %</span>
                <input class="num-input" inputmode="decimal" data-f="deductPct" value="${m.deductMode === 'partial' ? esc(String(m.deductPct)) : ''}" ${locked ? 'disabled' : ''}></label>
              <label class="field"><span>Основание</span>
                <select data-f="deductReason" ${locked ? 'disabled' : ''}>
                  <option value="">— избери —</option>
                  ${REASONS.map((r) => `<option ${m.deductReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select></label>
            </div>
          </fieldset>
          <fieldset ${locked ? 'disabled' : ''}>
            <legend class="section-title">Бележка към справката</legend>
            <textarea data-f="note" rows="3" ${locked ? 'disabled' : ''} placeholder="По желание">${esc(m.note || '')}</textarea>
          </fieldset>
        </form>
        <section class="results" id="results" aria-label="Сметки"></section>
      </div>`);
    renderResults();
    renderBusy();
    updateSaveState();
  }

  function renderResults() {
    const box = document.getElementById('results');
    if (!box) return;
    const r = resultFor(state.month);
    state.result = r;
    const ff = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    ff('fixed-total', F.eur(C.sumItems(state.month.fixedItems)));
    ff('rev-total', F.eur(C.sumItems(state.month.revenueItems)));
    const cards = [
      ['fixed', `${r.bases.fixed} обекта${r.deducted ? ` · −${F.eur(r.deducted)} приходи` : ''}`],
      ['water', `${r.bases.water} обекта`],
      ['power', `база ${F.pct(r.bases.power)}%`],
      ['chillers', `база ${F.pct(r.bases.chillers)}%`],
    ];
    box.innerHTML = `
      ${r.warnings.length ? `<div class="alert" role="alert">${r.warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="pools">
        ${cards.map(([p, b]) => `<div class="pool"><span class="pool__name"><i class="sw s-${p}"></i>${PART_SHORT[p]}</span><span class="pool__sum">${F.eur(r.pools[p])}</span><span class="pool__base">${b}</span></div>`).join('')}
        <div class="pool pool--total"><span class="pool__name">За разпределяне</span><span class="pool__sum">${F.eur(r.totalPool)}</span><span class="pool__base">${r.balanced ? `между ${r.payers} обекта · сборът съвпада` : 'сборът не съвпада'}</span></div>
      </div>
      <div class="tablebar">
        <label class="search"><span class="sr">Търси обект</span><input type="search" id="rows-q" placeholder="Търси обект, напр. 2-15" value="${esc(state.rowsQ)}"></label>
        <div class="chips" role="group" aria-label="Етаж">
          ${[['all', 'Всички'], ['1', '1 ет.'], ['2', '2 ет.'], ['3', '3 ет.'], ['4', '4 ет.'], ['other', 'Други']].map(([v, l]) => `<button type="button" class="chip${state.rowsFloor === v ? ' is-on' : ''}" data-action="floor" data-v="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="table-wrap" id="rows-table"></div>
      <p class="muted small">Натисни ред, за да видиш бележката на обекта.</p>`;
    renderRowsTable();
  }

  function floorMatch(o, f) {
    if (f === 'all') return true;
    if (f === 'other') return o.kind !== 'unit' || !(o.floor >= 1 && o.floor <= 4);
    return o.kind === 'unit' && String(o.floor) === f;
  }

  function renderRowsTable() {
    const el = document.getElementById('rows-table');
    if (!el || !state.result) return;
    const q = state.rowsQ.trim().toLowerCase();
    const list = state.result.rows.filter((o) => floorMatch(o, state.rowsFloor) && (!q || o.id.toLowerCase().includes(q)));
    const sum = (k) => list.reduce((s, o) => s + (k ? o.parts[k] : o.total), 0);
    el.innerHTML = `<table class="tbl">
      <thead><tr><th>Обект</th><th class="num">Ид. част %</th>${C.PARTS.map((p) => `<th class="num">${PART_SHORT[p]}</th>`).join('')}<th class="num">Общо, €</th></tr></thead>
      <tbody>${list.map((o) => `<tr data-row="${esc(o.id)}" tabindex="0" class="${o.total ? '' : 'is-zero'}">
        <td>${esc(o.id)}${KIND[o.kind] && o.kind !== 'unit' ? `<span class="tag">${KIND[o.kind]}</span>` : ''}${o.note ? `<span class="tag tag--warn" title="${esc(o.note)}">провери</span>` : ''}</td>
        <td class="num">${F.pct(o.share)}</td>
        ${C.PARTS.map((p) => `<td class="num">${F.dash(o.parts[p])}</td>`).join('')}
        <td class="num strong">${F.dash(o.total)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Няма обекти по този филтър.</td></tr>'}</tbody>
      <tfoot><tr><td>Общо (${list.length})</td><td class="num">${F.pct(list.reduce((s, o) => s + o.share, 0))}</td>
        ${C.PARTS.map((p) => `<td class="num">${F.n2(sum(p))}</td>`).join('')}<td class="num">${F.n2(sum())}</td></tr></tfoot>
    </table>`;
  }

  function openSlip(id) {
    const r = state.result;
    const o = r && r.rows.find((x) => x.id === id);
    if (!o) return;
    const line = (p, label) => `<dt>${label}</dt><dd>${o[p] ? F.eur(o.parts[p]) : '<span class="muted">не участва</span>'}</dd>`;
    openSheet(`<div class="slip sheet__body">
      <span class="brand-mark brand-mark--brick">GRAND</span>
      <p class="muted small">ТАЦ „Гранд“ · гр. Пловдив, ул. „Капитан Райчо“ № 56</p>
      <h2 class="h3">Обект ${esc(o.id)}</h2>
      <p class="muted small">Бележка за ${esc(F.monthName(state.month.id))} · идеална част ${F.pct(o.share)}%${state.month.status === 'locked' ? '' : ' · чернова'}</p>
      <dl class="slip__lines">
        ${line('fixed', 'Равен дял от постоянните разходи')}
        ${line('water', 'Равен дял от водата за общите части')}
        ${line('power', 'Дял от тока за общите части')}
        ${line('chillers', 'Дял от тока за чилърите')}
      </dl>
      <div class="slip__due"><span>За плащане</span><strong>${F.eur(o.total)}</strong></div>
      ${o.note ? `<p class="small warn-text">Бележка: ${esc(o.note)}</p>` : ''}
      <div class="row-actions"><button type="button" class="btn btn--ghost" data-action="close-sheet">Затвори</button>
      <button type="button" class="btn btn--primary" data-action="pdf-one" data-id="${esc(o.id)}" data-busy="pdf-one">Свали PDF</button></div>
    </div>`);
  }

  // запис на черновата: на пауза в писането и при излизане от екрана
  function normalizedMonth() {
    const m = state.month;
    const items = (arr) => arr.map((it) => ({ name: String(it.name || '').trim(), amount: C.num(it.amount) }));
    return {
      fixedItems: items(m.fixedItems), water: C.num(m.water), power: C.num(m.power), chillers: C.num(m.chillers),
      revenueItems: items(m.revenueItems), deductMode: m.deductMode || 'full',
      deductPct: m.deductMode === 'partial' ? C.num(m.deductPct) : m.deductMode === 'none' ? 0 : 100,
      deductReason: m.deductReason || '', note: m.note || '',
    };
  }
  function changed() {
    if (!canEdit() || !state.month || state.month.status === 'locked') return;
    state.saveState = 'dirty';
    updateSaveState();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveMonth, 900);
    renderResults();
  }
  async function saveMonth() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.month || state.saveState !== 'dirty') return;
    if (state.saving) { state.saveAgain = true; return state.saving; }
    const id = state.month.id;
    state.saveState = 'saving';
    updateSaveState();
    state.saving = (async () => {
      try {
        const saved = await S.saveMonth(id, normalizedMonth());
        state.months = state.months.map((x) => (x.id === id ? { ...saved, id } : x));
        if (state.month && state.month.id === id && state.saveState === 'saving') state.saveState = 'saved';
      } catch (e) {
        state.saveState = 'error';
        toast(e.message || 'Записът не успя.', 'bad');
      } finally {
        state.saving = null;
        updateSaveState();
        if (state.saveAgain) { state.saveAgain = false; state.saveState = 'dirty'; await saveMonth(); }
      }
    })();
    return state.saving;
  }
  async function flushMonth() {
    if (state.saveTimer || state.saveState === 'dirty') await saveMonth();
    if (state.saving) await state.saving;
  }
  function updateSaveState() {
    const el = document.getElementById('save-state');
    if (!el || !state.month || state.month.status === 'locked') return;
    const t = { dirty: 'Незапазени промени…', saving: 'Записване…', saved: 'Запазено', error: 'Записът не успя — опитай отново' }[state.saveState];
    el.textContent = t || (canEdit() ? 'Промените се записват автоматично' : '');
    el.className = 'muted save-state' + (state.saveState === 'error' ? ' is-bad' : '');
  }

  // ---------- месеци / история ----------
  function renderMonths() {
    if (!state.objects) return shell(noObjects());
    const months = [...state.months].sort((a, b) => b.id.localeCompare(a.id));
    const rows = months.map((m) => ({ m, r: resultFor(m) }));
    const table = rows.length ? `<div class="table-wrap"><table class="tbl tbl--click">
      <thead><tr><th>Месец</th><th>Статус</th>${C.PARTS.map((p) => `<th class="num">${PART_SHORT[p]}</th>`).join('')}<th class="num">Приспаднати приходи</th><th class="num">Общо, €</th><th class="num">Промяна</th></tr></thead>
      <tbody>${rows.map(({ m, r }, i) => {
        const prev = rows[i + 1];
        const ch = prev && prev.r.totalPool ? ((r.totalPool - prev.r.totalPool) / prev.r.totalPool) * 100 : null;
        return `<tr data-href="#month-${m.id}" tabindex="0"><td><a href="#month-${m.id}">${esc(F.monthTitle(m.id))}</a></td><td>${pill(m.status)}</td>
          ${C.PARTS.map((p) => `<td class="num">${F.n2(r.pools[p])}</td>`).join('')}
          <td class="num">${F.dash(r.deducted)}</td><td class="num strong">${F.n2(r.totalPool)}</td>
          <td class="num ${ch == null ? '' : ch > 0 ? 'is-up' : 'is-down'}">${ch == null ? '–' : `${ch >= 0 ? '+' : '−'}${F.n2(Math.abs(ch), 1)}%`}</td></tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="empty"><p class="muted">Още няма месеци.</p>${canEdit() ? '<button type="button" class="btn btn--primary" data-action="new-month">Нов месец</button>' : ''}</div>`;

    const obj = state.historyObj;
    let objBlock = '';
    if (obj && rows.length) {
      const per = rows.map(({ m, r }) => ({ m, row: r.rows.find((x) => x.id === obj) })).filter((x) => x.row);
      objBlock = per.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Месец</th>${C.PARTS.map((p) => `<th class="num">${PART_SHORT[p]}</th>`).join('')}<th class="num">Общо, €</th></tr></thead>
        <tbody>${per.map(({ m, row }) => `<tr><td>${esc(F.monthTitle(m.id))}${m.status === 'locked' ? '' : ' <span class="tag">чернова</span>'}</td>${C.PARTS.map((p) => `<td class="num">${F.dash(row.parts[p])}</td>`).join('')}<td class="num strong">${F.n2(row.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Общо за ${per.length} мес.</td>${C.PARTS.map((p) => `<td class="num">${F.n2(per.reduce((s, x) => s + x.row.parts[p], 0))}</td>`).join('')}<td class="num">${F.n2(per.reduce((s, x) => s + x.row.total, 0))}</td></tr></tfoot>
      </table></div>` : '<p class="muted">Няма данни за този обект.</p>';
    }

    shell(`
      <div class="page-head"><div><h1 class="h1">Месеци</h1><p class="muted">Всички месеци и промяната спрямо предишния.</p></div>
        <div class="row-actions">${canEdit() ? '<button type="button" class="btn btn--primary" data-action="new-month">Нов месец</button>' : ''}</div></div>
      <section class="card card--flush">${table}</section>
      <section class="card">
        <div class="card__head"><h2 class="h3">Обект по месеци</h2></div>
        <label class="field field--inline"><span>Обект</span>
          <input id="hist-obj" list="obj-list" value="${esc(obj)}" placeholder="напр. 2-15"></label>
        <datalist id="obj-list">${state.objects.map((o) => `<option value="${esc(o.id)}">`).join('')}</datalist>
        ${objBlock}
      </section>`);
  }

  // ---------- обекти ----------
  function renderObjects() {
    if (!state.objDraft) state.objDraft = clone(state.objects || []);
    const list = state.objDraft;
    const ro = !canEdit();
    const total = list.reduce((s, o) => s + C.num(o.share), 0);
    const ids = list.map((o) => String(o.id).trim());
    const dup = ids.filter((id, i) => id && ids.indexOf(id) !== i);
    const count = (p) => list.filter((o) => o[p]).length;
    const q = state.objQ.trim().toLowerCase();
    const shown = list.map((o, i) => ({ o, i })).filter(({ o }) => (state.objKind === 'all' || (state.objKind === 'note' ? !!o.note : o.kind === state.objKind)) && (!q || String(o.id).toLowerCase().includes(q)));

    const imp = state.importInfo;
    const importBox = imp ? `<section class="card import">
        <div class="card__head"><h2 class="h3">Внасяне от „${esc(imp.fileName)}“</h2></div>
        <p>${imp.rows.length} обекта в файла, сбор ${F.pct(imp.rows.reduce((s, o) => s + o.share, 0))}%.</p>
        <ul class="import__list">
          <li><strong>${imp.diff.changed.length}</strong> с промени${imp.diff.changed.length ? ': ' + imp.diff.changed.slice(0, 8).map((c) => esc(c.to.id)).join(', ') + (imp.diff.changed.length > 8 ? '…' : '') : ''}</li>
          <li><strong>${imp.diff.added.length}</strong> нови${imp.diff.added.length ? ': ' + imp.diff.added.slice(0, 8).map((c) => esc(c.id)).join(', ') + (imp.diff.added.length > 8 ? '…' : '') : ''}</li>
          <li><strong>${imp.diff.missing.length}</strong> липсват във файла${imp.diff.missing.length ? ': ' + imp.diff.missing.slice(0, 8).map((c) => esc(c.id)).join(', ') + (imp.diff.missing.length > 8 ? '…' : '') : ''}</li>
        </ul>
        ${imp.diff.missing.length ? '<label class="check"><input type="checkbox" id="imp-remove"> Премахни липсващите обекти</label>' : ''}
        ${imp.hasFlags ? '' : '<p class="muted small">Файлът няма отметки за участие — познатите обекти запазват своите, новите получават правилата по подразбиране.</p>'}
        <div class="row-actions"><button type="button" class="btn btn--ghost" data-action="import-cancel">Откажи</button><button type="button" class="btn btn--primary" data-action="import-apply">Приложи</button></div>
      </section>` : '';

    shell(`
      <div class="page-head">
        <div><h1 class="h1">Обекти</h1><p class="muted">Идеални части и участие във всяко перо. Промените важат за черновите; заключените месеци пазят своите данни.</p></div>
        <div class="row-actions">
          <button type="button" class="btn btn--soft" data-action="xlsx-objects" data-busy="xlsx-objects">Свали Excel</button>
          ${ro ? '' : `<label class="btn btn--soft file-btn">Внеси от Excel<input type="file" id="import-file" accept=".xlsx,.xls,.csv" hidden></label>
          <button type="button" class="btn btn--ghost" data-action="obj-reset" ${state.objDirty ? '' : 'disabled'}>Откажи промените</button>
          <button type="button" class="btn btn--primary" data-action="obj-save" ${state.objDirty ? '' : 'disabled'}>Запази</button>`}
        </div>
      </div>
      ${importBox}
      <div class="kpis kpis--small">
        <div class="kpi"><span class="kpi__label">Сбор идеални части</span><span class="kpi__value ${Math.abs(total - 100) < 1e-6 ? '' : 'is-warn'}">${F.pct(total)}%</span><span class="kpi__sub">${Math.abs(total - 100) < 1e-6 ? 'точно 100%' : 'трябва да е 100%'}</span></div>
        ${C.PARTS.map((p) => `<div class="kpi"><span class="kpi__label">${PART_SHORT[p]}</span><span class="kpi__value">${count(p)}</span><span class="kpi__sub">участващи обекта</span></div>`).join('')}
      </div>
      ${dup.length ? `<div class="alert">Повтарящи се номера: ${dup.map(esc).join(', ')}</div>` : ''}
      ${list.length ? '' : '<div class="alert">Списъкът е празен. Внеси Excel файла с обектите.</div>'}
      <div class="tablebar">
        <label class="search"><span class="sr">Търси обект</span><input type="search" id="obj-q" placeholder="Търси обект" value="${esc(state.objQ)}"></label>
        <div class="chips" role="group" aria-label="Вид">
          ${[['all', 'Всички'], ['unit', 'Обекти'], ['terrace', 'Тераси'], ['garage', 'Гараж'], ['hypermarket', 'Хипермаркет'], ['note', 'За проверка']].map(([v, l]) => `<button type="button" class="chip${state.objKind === v ? ' is-on' : ''}" data-action="obj-kind" data-v="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="table-wrap table-wrap--tall">
        <table class="tbl tbl--edit">
          <thead><tr><th>Обект</th><th class="num">Ид. част %</th><th>Вид</th><th class="num">Етаж</th>${C.PARTS.map((p) => `<th class="center">${PART_SHORT[p]}</th>`).join('')}<th>Бележка</th>${ro ? '' : '<th></th>'}</tr></thead>
          <tbody>${shown.map(({ o, i }) => `<tr>
            <td><input class="cell cell--id" aria-label="Номер на обект" data-o="${i}" data-k="id" value="${esc(o.id)}" ${ro ? 'disabled' : ''}></td>
            <td class="num"><input class="cell cell--num num-input" aria-label="Идеална част" inputmode="decimal" data-o="${i}" data-k="share" value="${esc(String(o.share).replace('.', ','))}" ${ro ? 'disabled' : ''}></td>
            <td><select class="cell" aria-label="Вид" data-o="${i}" data-k="kind" ${ro ? 'disabled' : ''}>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
            <td class="num"><input class="cell cell--floor" aria-label="Етаж" inputmode="numeric" data-o="${i}" data-k="floor" value="${o.floor == null ? '' : o.floor}" ${ro ? 'disabled' : ''}></td>
            ${C.PARTS.map((p) => `<td class="center"><input type="checkbox" aria-label="${PART_SHORT[p]}" data-o="${i}" data-k="${p}" ${o[p] ? 'checked' : ''} ${ro ? 'disabled' : ''}></td>`).join('')}
            <td><input class="cell cell--note${o.note ? ' has-note' : ''}" aria-label="Бележка" data-o="${i}" data-k="note" value="${esc(o.note || '')}" ${ro ? 'disabled' : ''}></td>
            ${ro ? '' : `<td><button type="button" class="icon-btn" data-action="obj-del" data-o="${i}" aria-label="Премахни ${esc(o.id)}">×</button></td>`}
          </tr>`).join('')}</tbody>
        </table>
      </div>
      ${ro ? '' : '<button type="button" class="btn btn--ghost btn--sm add-row" data-action="obj-add">+ Добави обект</button>'}
      <p class="muted small">Показани ${shown.length} от ${list.length}. Отметка = обектът участва в перото.</p>`);
    renderBusy();
  }

  async function saveObjects() {
    const list = state.objDraft.map((o) => ({
      ...o, id: String(o.id).trim(), share: C.num(o.share),
      floor: o.floor === '' || o.floor == null || isNaN(Number(o.floor)) ? null : Number(o.floor),
    }));
    const ids = list.map((o) => o.id);
    if (ids.some((id) => !id)) throw new Error('Има обект без номер.');
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw new Error(`Обект „${dup}“ се повтаря.`);
    const saved = await S.saveObjects(list);
    state.objects = saved;
    state.objDraft = clone(saved);
    state.objDirty = false;
  }

  // ---------- настройки ----------
  function renderSettings() {
    shell(`
      <div class="page-head"><div><h1 class="h1">Настройки</h1></div></div>
      <form class="card card--narrow" id="pw-form">
        <h2 class="h3">Смяна на паролата</h2>
        <label class="field"><span>Сегашна парола</span><input type="password" id="pw-cur" autocomplete="current-password" required></label>
        <label class="field"><span>Нова парола (поне 8 знака)</span><input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
        <button class="btn btn--primary" type="submit">Смени паролата</button>
      </form>`);
  }

  // ---------- прозорец ----------
  function openSheet(html) {
    closeSheet();
    const d = document.createElement('div');
    d.className = 'sheet';
    d.id = 'sheet';
    d.innerHTML = `<div class="sheet__card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(d);
    const f = d.querySelector('input, button.btn--primary, button');
    if (f) f.focus();
  }
  function closeSheet() { const s = document.getElementById('sheet'); if (s) s.remove(); }

  // ---------- изобразяване ----------
  function render() {
    closeSheet();
    if (state.view !== 'objects' && !state.objDirty) state.objDraft = null;
    if (state.view === 'months') renderMonths();
    else if (state.view === 'objects') renderObjects();
    else if (state.view === 'settings' && S.mode === 'server') renderSettings();
    else renderDashboard();
  }

  // ---------- събития ----------
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.id === 'login-form') {
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        state.me = await S.login(f.user.value, f.password.value);
        await loadData();
        route();
      } catch (err) {
        renderLogin(err.message);
      }
    } else if (f.id === 'new-month-form') {
      const id = document.getElementById('nm-month').value;
      const copy = document.getElementById('nm-copy');
      const errEl = document.getElementById('nm-error');
      if (!/^\d{4}-\d{2}$/.test(id)) { errEl.textContent = 'Избери месец.'; errEl.hidden = false; return; }
      try {
        await createMonth(id, copy && copy.checked);
        closeSheet();
        go('month-' + id);
      } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
    } else if (f.id === 'pw-form') {
      try {
        await S.changePassword(document.getElementById('pw-cur').value, document.getElementById('pw-new').value);
        f.reset();
        toast('Паролата е сменена.', 'ok');
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  document.addEventListener('click', async (e) => {
    const sheet = document.getElementById('sheet');
    if (sheet && e.target === sheet) return closeSheet();
    const anchor = e.target.closest('a[href^="#"]');
    if (anchor) { e.preventDefault(); closeSheet(); return go(anchor.getAttribute('href').slice(1)); }
    const row = e.target.closest('tr[data-row]');
    if (row && !e.target.closest('button, input, a')) return openSlip(row.dataset.row);
    const link = e.target.closest('tr[data-href]');
    if (link && !e.target.closest('a, button')) return go(link.dataset.href.slice(1));
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    try {
      switch (a) {
        case 'logout': await S.logout(); state.me = null; renderLogin(); break;
        case 'new-month': newMonthDialog(); break;
        case 'close-sheet': closeSheet(); break;
        case 'create-month': await createMonth(b.dataset.id, false); route(); break;
        case 'add-item': state.month[b.dataset.list].push({ name: '', amount: '' }); renderMonth(); focusLast(b.dataset.list); changed(); break;
        case 'del-item': state.month[b.dataset.list].splice(Number(b.dataset.i), 1); renderMonth(); changed(); break;
        case 'floor': state.rowsFloor = b.dataset.v; document.querySelectorAll('[data-action=floor]').forEach((c) => c.classList.toggle('is-on', c === b)); renderRowsTable(); break;
        case 'confirm': await flushMonth(); state.confirm = b.dataset.what; renderMonth(); break;
        case 'cancel-confirm': state.confirm = null; renderMonth(); break;
        case 'do-lock': {
          await flushMonth();
          const m = await S.lockMonth(state.month.id, state.objects);
          state.months = state.months.map((x) => (x.id === m.id ? m : x));
          state.confirm = null; state.month = clone(m); renderMonth();
          toast(`${F.monthTitle(m.id)} е заключен. Сметките са записани.`, 'ok');
          break;
        }
        case 'do-unlock': {
          const m = await S.unlockMonth(state.month.id);
          state.months = state.months.map((x) => (x.id === m.id ? m : x));
          state.confirm = null; state.month = clone(m); renderMonth();
          toast('Месецът е отключен.', 'ok');
          break;
        }
        case 'do-delete': {
          clearTimeout(state.saveTimer); state.saveState = '';
          await S.deleteMonth(state.month.id);
          state.months = state.months.filter((x) => x.id !== state.month.id);
          state.month = null; state.confirm = null;
          toast('Черновата е изтрита.', 'ok');
          go('months');
          break;
        }
        case 'pdf-one': {
          const o = state.result.rows.find((x) => x.id === b.dataset.id);
          const ctx = { monthId: state.month.id, month: normalizedMonth(), result: state.result, locked: state.month.status === 'locked' };
          download(`Belezhka_${state.month.id}_${F.file(o.id)}.pdf`, () => P.slip(ctx, o), 'pdf-one');
          break;
        }
        case 'pdf-all': download(`Belezhki_${state.month.id}.pdf`, () => P.allSlips(monthCtx()), 'pdf-all'); break;
        case 'pdf-zip': download(`Belezhki_${state.month.id}.zip`, () => P.zip(monthCtx()), 'pdf-zip'); break;
        case 'pdf-report': download(`Spravka_${state.month.id}.pdf`, () => P.report(monthCtx()), 'pdf-report'); break;
        case 'xlsx-month': download(`Smetki_${state.month.id}.xlsx`, () => E.exportMonth(monthCtx()), 'xlsx-month'); break;
        case 'xlsx-objects': download('Obekti_TAC_Grand.xlsx', () => E.exportObjects(state.objDraft || state.objects || []), 'xlsx-objects'); break;
        case 'obj-kind': state.objKind = b.dataset.v; renderObjects(); break;
        case 'obj-add': state.objDraft.unshift({ id: '', share: 0, kind: 'unit', floor: null, fixed: true, water: true, power: true, chillers: false, note: 'нов обект' }); state.objDirty = true; state.objQ = ''; state.objKind = 'all'; renderObjects(); document.querySelector('[data-o="0"][data-k="id"]').focus(); break;
        case 'obj-del': state.objDraft.splice(Number(b.dataset.o), 1); state.objDirty = true; renderObjects(); break;
        case 'obj-reset': state.objDraft = clone(state.objects || []); state.objDirty = false; renderObjects(); break;
        case 'obj-save': await saveObjects(); renderObjects(); toast('Обектите са запазени.', 'ok'); break;
        case 'import-cancel': state.importInfo = null; renderObjects(); break;
        case 'import-apply': {
          const rm = document.getElementById('imp-remove');
          state.objDraft = E.applyImport(state.objDraft, state.importInfo.rows, !!(rm && rm.checked));
          state.importInfo = null; state.objDirty = true; renderObjects();
          toast('Списъкът е обновен. Провери и натисни „Запази“.', 'ok');
          break;
        }
        default: break;
      }
    } catch (err) {
      toast(err.message || 'Нещо се обърка.', 'bad');
    }
  });

  function monthCtx() {
    return { monthId: state.month.id, month: state.month.status === 'locked' ? state.month : normalizedMonth(), result: state.result, locked: state.month.status === 'locked' };
  }
  function focusLast(list) {
    const els = document.querySelectorAll(`input[data-list="${list}"][data-k="name"]`);
    if (els.length) els[els.length - 1].focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' && e.target.matches('tr[data-row]')) openSlip(e.target.dataset.row);
    if (e.key === 'Enter' && e.target.matches('tr[data-href]')) go(e.target.dataset.href.slice(1));
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'rows-q') { state.rowsQ = t.value; renderRowsTable(); return; }
    if (t.id === 'obj-q') { state.objQ = t.value; const pos = t.selectionStart; renderObjects(); const n = document.getElementById('obj-q'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (t.dataset.list && state.month) {
      const it = state.month[t.dataset.list][Number(t.dataset.i)];
      it[t.dataset.k] = t.value;
      changed();
      return;
    }
    if (t.dataset.f && state.month) { state.month[t.dataset.f] = t.value; changed(); return; }
    if (t.dataset.o !== undefined && state.objDraft) {
      const o = state.objDraft[Number(t.dataset.o)];
      const k = t.dataset.k;
      if (t.type === 'checkbox') o[k] = t.checked;
      else o[k] = t.value;
      if (!state.objDirty) {
        state.objDirty = true;
        document.querySelectorAll('[data-action=obj-save],[data-action=obj-reset]').forEach((x) => { x.disabled = false; });
      }
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    // сумите се показват подредени, щом полето се напусне: 12000 → 12 000,00
    if (t.classList.contains('num-input') && state.month && state.view === 'month' && t.value.trim() && t.dataset.f !== 'deductPct') {
      const v = F.n2(C.num(t.value));
      if (t.value !== v) {
        t.value = v;
        if (t.dataset.list) state.month[t.dataset.list][Number(t.dataset.i)][t.dataset.k] = v;
        else if (t.dataset.f) state.month[t.dataset.f] = v;
      }
    }
    if (t.name === 'deductMode' && state.month) {
      state.month.deductMode = t.value;
      if (t.value === 'partial' && !C.num(state.month.deductPct)) state.month.deductPct = 50;
      if (t.value === 'full') state.month.deductReason = '';
      renderMonth();
      changed();
      return;
    }
    if (t.dataset.f === 'deductReason' && state.month) { state.month.deductReason = t.value; changed(); return; }
    if (t.dataset.o !== undefined && t.tagName === 'SELECT' && state.objDraft) {
      state.objDraft[Number(t.dataset.o)][t.dataset.k] = t.value;
      state.objDirty = true;
      renderObjects();
      return;
    }
    if (t.id === 'hist-obj') { state.historyObj = t.value.trim(); renderMonths(); return; }
    if (t.id === 'import-file' && t.files && t.files[0]) {
      const file = t.files[0];
      try {
        const parsed = await E.parseObjectsFile(file);
        state.importInfo = { ...parsed, fileName: file.name, diff: E.diffObjects(state.objDraft || [], parsed.rows) };
        renderObjects();
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  const fromAddress = () => { const h = (location.hash || '').replace(/^#/, ''); if (h !== current) { current = h; route(); } };
  window.addEventListener('hashchange', fromAddress);
  window.addEventListener('popstate', fromAddress);
  window.addEventListener('beforeunload', (e) => {
    if (state.saveState === 'dirty' || state.saving || state.objDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMonth(); });

  // за тестовете
  window.GrandApp = { state, flushMonth };
  boot();
})();
