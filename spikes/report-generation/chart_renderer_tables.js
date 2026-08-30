function standardTableRows(rows, query, sortIndex, sortDirection) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP');
  const filtered = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !normalizedQuery || row.some((value) => String(value ?? '').toLocaleLowerCase('ja-JP').includes(normalizedQuery)));
  if (sortIndex === null) return filtered;
  return filtered.sort((left, right) => {
    const a = left.row[sortIndex];
    const b = right.row[sortIndex];
    const numeric = Number.isFinite(Number(a)) && Number.isFinite(Number(b));
    const comparison = numeric
      ? Number(a) - Number(b)
      : String(a ?? '').localeCompare(String(b ?? ''), 'ja-JP', { numeric: true });
    return comparison === 0 ? left.index - right.index : comparison * sortDirection;
  });
}

function standardTableNumericColumns(rows, width) {
  return Array.from({ length: width }, (_, index) => index).filter((index) => {
    const values = rows.map((row) => row[index]).filter((value) => value !== null && value !== undefined && value !== '');
    return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
  });
}

function standardTableCsv(columns, rows) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

function downloadStandardTable(result, rows) {
  const blob = new Blob([`\ufeff${standardTableCsv(result.columns, rows)}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'repchat-result.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderAdvancedResultTable(result, box, options = {}) {
  const shell = Object.assign(document.createElement('div'), { className: 'advanced-table' });
  const toolbar = Object.assign(document.createElement('div'), { className: 'advanced-table-toolbar' });
  const search = Object.assign(document.createElement('input'), {
    className: 'advanced-table-search', type: 'search', placeholder: '表を検索', ariaLabel: '表を検索',
  });
  const summary = Object.assign(document.createElement('output'), { className: 'advanced-table-summary' });
  const download = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: 'CSV' });
  const fullscreen = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: '全画面' });
  const scroll = Object.assign(document.createElement('div'), { className: 'chart-table-scroll advanced-table-scroll' });
  const pager = Object.assign(document.createElement('nav'), { className: 'advanced-table-pager', ariaLabel: '表のページ送り' });
  const previous = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: '前へ' });
  const pageLabel = document.createElement('span');
  const next = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: '次へ' });
  const numericColumns = standardTableNumericColumns(result.rows, result.columns.length);
  const maxima = new Map(numericColumns.map((index) => [index, Math.max(...result.rows.map((row) => Number(row[index]) || 0))]));
  const pageSize = 10;
  let query = '';
  let sortIndex = null;
  let sortDirection = 1;
  let page = 0;

  function render() {
    options.beforeRender?.();
    const rows = standardTableRows(result.rows, query, sortIndex, sortDirection);
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pageCount - 1);
    const visible = rows.slice(page * pageSize, (page + 1) * pageSize).map(({ row }) => row);
    const tableElement = document.createElement('table');
    const header = tableElement.createTHead().insertRow();
    result.columns.forEach((column, index) => {
      const cell = document.createElement('th');
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: column });
      cell.setAttribute('aria-sort', sortIndex !== index ? 'none' : sortDirection === 1 ? 'ascending' : 'descending');
      button.onclick = () => {
        sortDirection = sortIndex === index ? -sortDirection : 1;
        sortIndex = index;
        page = 0;
        render();
      };
      cell.appendChild(button);
      header.appendChild(cell);
    });
    const body = tableElement.createTBody();
    visible.forEach((row) => {
      const tableRow = body.insertRow();
      row.forEach((value, index) => {
        const cell = tableRow.insertCell();
        if (options.renderCell?.(cell, value, row, index)) return;
        const delta = options.deltaIndex === index && Number.isFinite(Number(value));
        const formatted = numericColumns.includes(index) ? chartValue(value, result.columns[index]) : value ?? '';
        cell.textContent = delta ? `${Number(value) > 0 ? '↑' : Number(value) < 0 ? '↓' : '→'} ${formatted}` : formatted;
        if (delta) cell.classList.add('advanced-table-delta');
        const maximum = maxima.get(index);
        if (maximum > 0 && Number(value) >= 0) {
          cell.className = 'advanced-table-number';
          cell.style.setProperty('--table-bar-width', `${Math.min(100, Number(value) / maximum * 100)}%`);
        }
      });
    });
    scroll.replaceChildren(tableElement);
    const first = rows.length ? page * pageSize + 1 : 0;
    const last = Math.min((page + 1) * pageSize, rows.length);
    summary.textContent = `${rows.length}行中 ${first}–${last}行`;
    pageLabel.textContent = `${page + 1} / ${pageCount}`;
    previous.disabled = page === 0;
    next.disabled = page >= pageCount - 1;
    download.onclick = () => downloadStandardTable(result, rows.map(({ row }) => row));
  }

  search.oninput = () => { query = search.value; page = 0; render(); };
  previous.onclick = () => { page -= 1; render(); };
  next.onclick = () => { page += 1; render(); };
  fullscreen.onclick = () => shell.requestFullscreen?.();
  toolbar.append(search, summary, download, fullscreen);
  pager.append(previous, pageLabel, next);
  shell.append(toolbar, scroll, pager);
  box.appendChild(shell);
  render();
}

function standardPivotTableResult(result) {
  const rowValues = [...new Set(result.rows.map((row) => String(row[0])))];
  const pivotValues = [...new Set(result.rows.map((row) => String(row[1])))];
  const measureColumns = result.columns.slice(2);
  const lookup = new Map(result.rows.map((row) => [`${String(row[0])}\u0000${String(row[1])}`, row.slice(2)]));
  const columns = [
    result.columns[0],
    ...pivotValues.flatMap((pivot) => measureColumns.map((measure) => `${pivot} / ${measure}`)),
  ];
  const rows = rowValues.map((rowValue) => [
    rowValue,
    ...pivotValues.flatMap((pivot) => lookup.get(`${rowValue}\u0000${pivot}`) ?? measureColumns.map(() => null)),
  ]);
  return { ...result, visualization: 'table', columns, rows };
}

function renderPivotResultTable(result, box) {
  renderAdvancedResultTable(standardPivotTableResult(result), box);
}

function renderComparisonResultTable(result, box) {
  renderAdvancedResultTable(result, box, { deltaIndex: result.columns.length - 1 });
}

function standardSparklineTableResult(result) {
  const groups = new Map();
  result.rows.forEach(([category, eventDate, value]) => {
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push([String(eventDate), value]);
  });
  const rows = [...groups].map(([category, values]) => {
    values.sort((left, right) => left[0].localeCompare(right[0]));
    const latest = [...values].reverse().find((item) => item[1] !== null)?.[1] ?? null;
    const row = [category, latest, `${values.length}点`];
    row.sparklineValues = values;
    return row;
  });
  return { ...result, visualization: 'table', columns: [result.columns[0], result.columns[2], '推移'], rows };
}

function renderSparklineResultTable(result, box) {
  const transformed = standardSparklineTableResult(result);
  let instances = [];
  renderAdvancedResultTable(transformed, box, {
    beforeRender: () => {
      instances.forEach((instance) => instance.dispose());
      instances = [];
    },
    renderCell: (cell, _value, row, index) => {
      if (index !== 2) return false;
      const host = Object.assign(document.createElement('div'), { className: 'advanced-table-sparkline' });
      host.setAttribute('role', 'img');
      host.setAttribute('aria-label', `${row[0]}の推移`);
      cell.replaceChildren(host);
      try {
        const instance = chartLibrary.init(host, null, { renderer: 'svg' });
        instance.setOption({
          animation: false,
          grid: { left: 2, right: 2, top: 3, bottom: 3 },
          xAxis: { type: 'category', show: false, data: row.sparklineValues.map((item) => item[0]) },
          yAxis: { type: 'value', show: false, scale: true },
          series: [{ type: 'line', showSymbol: false, connectNulls: false, data: row.sparklineValues.map((item) => item[1]), lineStyle: { color: standardChartPalette[0], width: 2 }, areaStyle: { color: '#dbeafe', opacity: 0.45 } }],
        });
        instances.push(instance);
      } catch (_error) {
        host.textContent = '描画失敗';
      }
      return true;
    },
  });
}

