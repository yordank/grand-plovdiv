// Формати за числа, суми и месеци (български)
(function (root) {
  const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

  // 1234567.8 → "1 234 567,80" (обикновен интервал, за да го има във всеки шрифт)
  function n2(v, dec = 2, sep = ' ') {
    const x = Number(v) || 0;
    const neg = x < 0;
    const s = Math.abs(x).toFixed(dec);
    const [i, d] = s.split('.');
    const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (neg && Number(s) !== 0 ? '−' : '') + grouped + (d ? ',' + d : '');
  }

  const F = {
    MONTHS,
    n2,
    eur: (v) => n2(v) + ' €',
    eurPdf: (v) => n2(v, 2, ' ') + ' €',
    pct: (v) => n2(v, 3),
    dash: (v) => (Math.abs(Number(v) || 0) < 0.005 ? '–' : n2(v)),
    monthName(id) {
      if (!id) return '';
      const [y, m] = id.split('-');
      return `${MONTHS[Number(m) - 1]} ${y}`;
    },
    monthTitle(id) {
      const s = F.monthName(id);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    nextMonth(id) {
      let [y, m] = id.split('-').map(Number);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      return `${y}-${String(m).padStart(2, '0')}`;
    },
    prevMonth(id) {
      let [y, m] = id.split('-').map(Number);
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      return `${y}-${String(m).padStart(2, '0')}`;
    },
    // Безопасен текст в HTML
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    // Име на файл без странни знаци
    file: (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_'),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  else root.GrandFmt = F;
})(typeof window !== 'undefined' ? window : globalThis);
