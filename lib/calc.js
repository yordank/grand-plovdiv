// Разпределение на месечните разходи по Методиката на ТАЦ „Гранд“ (ОС 06.10.2026).
// Работи и в браузъра, и в Node.js.

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * @param {Array} objects  обекти от data/objects.json
 * @param {Object} input   { fixed, water, power, chillers, revenue, deductPct }
 *   fixed     – постоянни текущи разходи (чл. 5), делят се поравно
 *   water     – вода за общите части (чл. 6), поравно между участващите
 *   power     – ток за общите части (чл. 7), по идеални части без терасите
 *   chillers  – ток за чилърите (чл. 8), по идеални части на обслужваните обекти
 *   revenue   – приходи от общите части (чл. 10)
 *   deductPct – каква част от приходите се приспада (0–100)
 * Допускане: приспаднатите приходи намаляват постоянните разходи.
 */
function calculate(objects, input) {
  const n = (v) => Number(v) || 0;
  const deducted = n(input.revenue) * Math.min(Math.max(n(input.deductPct), 0), 100) / 100;
  const pools = {
    fixed: n(input.fixed) - deducted,
    water: n(input.water),
    power: n(input.power),
    chillers: n(input.chillers),
  };

  const bases = {
    fixed: objects.filter((o) => o.fixed).length,
    water: objects.filter((o) => o.water).length,
    power: objects.reduce((s, o) => s + (o.power ? o.share : 0), 0),
    chillers: objects.reduce((s, o) => s + (o.chillers ? o.share : 0), 0),
  };

  const rows = objects.map((o) => {
    const fixed = o.fixed && bases.fixed ? pools.fixed / bases.fixed : 0;
    const water = o.water && bases.water ? pools.water / bases.water : 0;
    const power = o.power && bases.power ? (pools.power * o.share) / bases.power : 0;
    const chillers = o.chillers && bases.chillers ? (pools.chillers * o.share) / bases.chillers : 0;
    return { ...o, parts: { fixed, water, power, chillers }, total: fixed + water + power + chillers };
  });

  const distributed = rows.reduce((s, r) => s + r.total, 0);
  const totalPool = pools.fixed + pools.water + pools.power + pools.chillers;

  return {
    deducted,
    pools,
    bases,
    rows,
    distributed,
    totalPool,
    balanced: Math.abs(distributed - totalPool) < 0.01,
  };
}

if (typeof module !== 'undefined') module.exports = { calculate, round2 };
if (typeof window !== 'undefined') window.GrandCalc = { calculate, round2 };
