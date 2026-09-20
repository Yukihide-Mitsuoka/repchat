function metricUnit(column) {
  const label = String(column ?? '');
  const parenthesized = label.match(/\(([^()]*)\)\s*$/);
  if (parenthesized?.[1]) return parenthesized[1];
  return /[%％]\s*$/.test(label) ? '%' : '';
}

function metricAxisTitle(column) {
  return String(column ?? '');
}

function chartValue(value, _column = '', forceInteger = false) {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: forceInteger ? 0 : 2,
  }).format(number);
}

function kpiGroup(result, box) {
  const group = Object.assign(document.createElement('div'), { className: 'kpi-pair' });
  result.columns.forEach((column, index) => {
    const item = document.createElement('div');
    const value = document.createElement('strong');
    const label = document.createElement('span');
    value.textContent = chartValue(result.rows[0][index], column);
    label.textContent = column;
    item.append(value, label);
    group.append(item);
  });
  box.append(group);
  return true;
}

export { chartValue, kpiGroup, metricAxisTitle, metricUnit };
