const standardChartInstances = new WeakMap();
const standardChartPalette = [
  '#3973c6',
  '#d39b2a',
  '#2f855a',
  '#b45f86',
  '#4e79a7',
  '#f28e2b',
  '#59a14f',
  '#e15759',
  '#76b7b2',
  '#edc948',
];

function standardChartLabel(value, length = 24) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}…` : text;
}

function standardChartNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function standardChartFormat(value, column = '') {
  return chartValue(value, column);
}

function standardChartUnit(column) {
  return metricAxisTitle(column);
}

function standardChartGrid(horizontal = false) {
  return horizontal
    ? { left: 156, right: 34, top: 56, bottom: 58, containLabel: true }
    : { left: 76, right: 28, top: 56, bottom: 70, containLabel: true };
}

function standardChartTooltipFormatter(params) {
  const items = Array.isArray(params) ? params : [params];
  const title = items[0]?.axisValueLabel ?? items[0]?.name ?? '';
  const lines = items.map((item) => {
    const value = Array.isArray(item.value) ? item.value.at(-1) : item.value;
    return `${item.marker ?? ''}${item.seriesName ?? ''}: ${standardChartFormat(value, item.seriesName)}`;
  });
  return [title, ...lines].join('<br>');
}

function standardChartAxisLabel(column) {
  return (value) => standardChartFormat(value, column);
}

function standardChartCategoryAxis(data, axisLabel = {}) {
  return {
    type: 'category',
    data,
    axisTick: { alignWithLabel: true },
    axisLabel: { hideOverlap: true, ...axisLabel },
  };
}

function standardChartValueAxis(column, position = 'left', offset = 0) {
  return {
    type: 'value',
    name: standardChartUnit(column),
    nameLocation: 'middle',
    nameGap: position === 'left' || position === 'right' ? 48 : 34,
    nameTextStyle: { fontSize: 11, color: '#475467' },
    position,
    offset,
    axisLabel: { formatter: standardChartAxisLabel(column), hideOverlap: true },
    axisLine: { show: true, lineStyle: { color: '#98a2b3' } },
    splitLine: { show: position === 'left' && offset === 0, lineStyle: { color: '#e4e7ec' } },
  };
}

function standardChartBase({ horizontal = false, legend = false, tooltip = true } = {}) {
  return {
    animation: false,
    aria: { enabled: true },
    color: standardChartPalette,
    grid: standardChartGrid(horizontal),
    legend: legend ? { top: 8, type: 'scroll' } : undefined,
    tooltip: tooltip
      ? { trigger: horizontal ? 'axis' : 'axis', axisPointer: { type: 'shadow' }, formatter: standardChartTooltipFormatter }
      : undefined,
  };
}

function standardBarOption(result, mode) {
  const metricColumns = result.columns.slice(1);
  const categories = result.rows.map((row) => String(row[0] ?? ''));
  const units = metricColumns.map((column) => metricUnit(column) || column);
  const unitIndexes = new Map();
  units.forEach((unit) => {
    if (!unitIndexes.has(unit)) unitIndexes.set(unit, unitIndexes.size);
  });
  const multipleUnits = mode === 'grouped' && unitIndexes.size > 1;
  const axes = multipleUnits
    ? metricColumns.map((column, index) =>
        standardChartValueAxis(column, index % 2 === 0 ? 'bottom' : 'top', Math.floor(index / 2) * 24),
      )
    : [standardChartValueAxis(metricColumns[0])];
  const series = metricColumns.map((column, seriesIndex) => {
    const axisIndex = multipleUnits ? unitIndexes.get(units[seriesIndex]) : 0;
    const values = result.rows.map((row) => standardChartNumber(row[seriesIndex + 1]));
    return {
      name: column,
      type: 'bar',
      data: values,
      yAxisIndex: multipleUnits ? axisIndex : undefined,
      xAxisIndex: multipleUnits ? axisIndex : undefined,
      stack: mode === 'stacked' ? 'total' : undefined,
      barMaxWidth: mode === 'grouped' ? 24 : 34,
      emphasis: { focus: 'series' },
      label: {
        show: true,
        position: mode === 'stacked' ? 'inside' : 'right',
        formatter: (params) => standardChartFormat(params.value, column),
        color: mode === 'stacked' ? '#fff' : '#344054',
        textBorderColor: mode === 'stacked' ? '#344054' : undefined,
        textBorderWidth: mode === 'stacked' ? 2 : 0,
      },
    };
  });
  const option = standardChartBase({ horizontal: true, legend: metricColumns.length > 1 });
  option.grid = standardChartGrid(true);
  option.xAxis = multipleUnits
    ? axes.map((axis, index) => ({ ...axis, gridIndex: 0, position: index % 2 === 0 ? 'bottom' : 'top' }))
    : axes;
  option.yAxis = standardChartCategoryAxis(categories, {
    width: 132,
    overflow: 'truncate',
    formatter: (value) => standardChartLabel(value, 30),
  });
  if (multipleUnits) {
    option.xAxis = metricColumns.map((column, index) => ({
      ...standardChartValueAxis(column, index % 2 === 0 ? 'bottom' : 'top', Math.floor(index / 2) * 24),
      gridIndex: 0,
    }));
  }
  option.series = series.map((item, index) => ({
    ...item,
    xAxisIndex: multipleUnits ? index : 0,
    yAxisIndex: 0,
  }));
  return option;
}

function standardLineOption(result, mode) {
  const metricColumns = result.columns.slice(1);
  const categories = result.rows.map((row) => String(row[0]));
  const option = standardChartBase({ legend: metricColumns.length > 1 });
  option.grid = standardChartGrid(false);
  option.xAxis = standardChartCategoryAxis(categories, {
    formatter: (value) => standardChartLabel(value, 12),
  });
  option.yAxis = metricColumns.map((column, index) => ({
    ...standardChartValueAxis(column, index % 2 === 0 ? 'left' : 'right', Math.floor(index / 2) * 58),
    min: 'dataMin',
    max: 'dataMax',
  }));
  option.series = metricColumns.map((column, index) => ({
    name: column,
    type: 'line',
    yAxisIndex: index,
    data: result.rows.map((row) => standardChartNumber(row[index + 1])),
    showSymbol: true,
    symbol: 'circle',
    symbolSize: 7,
    connectNulls: false,
    smooth: false,
    areaStyle: mode === 'area' || mode === 'stacked_area' ? { opacity: mode === 'stacked_area' ? 0.45 : 0.18 } : undefined,
    stack: mode === 'stacked_area' ? 'total' : undefined,
    emphasis: { focus: 'series' },
  }));
  return option;
}

function standardHistogramOption(result) {
  const option = standardChartBase();
  option.grid = standardChartGrid(false);
  option.xAxis = standardChartCategoryAxis(result.rows.map((row) => standardChartFormat(row[0], result.columns[0])), {
    rotate: result.rows.length > 12 ? 35 : 0,
  });
  option.yAxis = standardChartValueAxis(result.columns[1]);
  option.series = [{
    name: result.columns[1],
    type: 'bar',
    data: result.rows.map((row) => standardChartNumber(row[1])),
    barMaxWidth: 48,
    label: { show: true, position: 'top', formatter: (params) => standardChartFormat(params.value, result.columns[1]) },
  }];
  return option;
}

function standardDonutOption(result) {
  return {
    ...standardChartBase({ legend: true, tooltip: true }),
    grid: undefined,
    legend: { type: 'scroll', orient: 'vertical', right: 10, top: 25, bottom: 25 },
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${params.name}: ${standardChartFormat(params.value, result.columns[1])} (${params.percent}%)`,
    },
    series: [{
      name: result.columns[1],
      type: 'pie',
      radius: ['42%', '72%'],
      center: ['35%', '52%'],
      avoidLabelOverlap: true,
      label: { show: true, formatter: (params) => `${standardChartLabel(params.name, 18)}\n${params.percent}%` },
      labelLine: { length: 12, length2: 8 },
      data: result.rows.map((row) => ({ name: String(row[0]), value: standardChartNumber(row[1]) })),
    }],
  };
}

function standardCalendarOption(result) {
  const dates = result.rows.map((row) => String(row[0]).slice(0, 10));
  const values = result.rows.map((row) => standardChartNumber(row[1]) ?? 0);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { formatter: (params) => `${params.data?.[0] ?? ''}: ${standardChartFormat(params.data?.[1], result.columns[1])}` },
    visualMap: { min, max, calculable: true, orient: 'horizontal', left: 'center', top: 8, inRange: { color: ['#eaf2f8', '#3973c6'] } },
    calendar: { top: 52, left: 44, right: 22, bottom: 26, range: [dates[0], dates.at(-1)], cellSize: ['auto', 22], splitLine: { show: true, lineStyle: { color: '#d9dee7' } }, itemStyle: { borderWidth: 1, borderColor: '#fff' }, dayLabel: { firstDay: 1, nameMap: 'ja' }, monthLabel: { nameMap: 'ja' } },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: 0, data: dates.map((date, index) => [date, values[index]]) }],
  };
}

function standardScatterOption(result, bubble) {
  const xColumn = result.columns[1];
  const yColumn = result.columns[2];
  const sizeColumn = result.columns[3];
  const option = standardChartBase({ tooltip: true });
  option.grid = standardChartGrid(false);
  option.xAxis = { ...standardChartValueAxis(xColumn), nameLocation: 'middle', nameGap: 34 };
  option.yAxis = { ...standardChartValueAxis(yColumn), nameLocation: 'middle', nameGap: 52 };
  option.tooltip = { trigger: 'item', formatter: (params) => {
    const row = result.rows[params.dataIndex];
    return `${row[0]}<br>${xColumn}: ${standardChartFormat(row[1], xColumn)}<br>${yColumn}: ${standardChartFormat(row[2], yColumn)}${bubble ? `<br>${sizeColumn}: ${standardChartFormat(row[3], sizeColumn)}` : ''}`;
  } };
  const sizes = bubble ? result.rows.map((row) => Math.max(0, standardChartNumber(row[3]) ?? 0)) : [];
  const maxSize = Math.max(...sizes, 1);
  option.series = [{
    type: 'scatter',
    data: result.rows.map((row, index) => ({ value: [standardChartNumber(row[1]), standardChartNumber(row[2])], symbolSize: bubble ? 8 + 34 * Math.sqrt(sizes[index] / maxSize) : 12, name: String(row[0]) })),
    label: { show: true, formatter: (params) => standardChartLabel(params.data.name, 16), position: 'right' },
    emphasis: { focus: 'series', label: { show: true } },
  }];
  return option;
}

function standardFunnelOption(result) {
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${standardChartFormat(params.value, result.columns[1])}` },
    series: [{
      type: 'funnel',
      left: '10%',
      top: 30,
      bottom: 20,
      width: '80%',
      min: 0,
      max: Math.max(...result.rows.map((row) => standardChartNumber(row[1]) ?? 0), 1),
      minSize: '12%',
      maxSize: '95%',
      sort: 'none',
      gap: 4,
      label: { show: true, position: 'inside', formatter: (params) => `${standardChartLabel(params.name, 20)}\n${standardChartFormat(params.value, result.columns[1])}` },
      data: result.rows.map((row) => ({ name: String(row[0]), value: standardChartNumber(row[1]) })),
    }],
  };
}

function standardHeatmapOption(result) {
  const xValues = [...new Set(result.rows.map((row) => String(row[0])))];
  const yValues = [...new Set(result.rows.map((row) => String(row[1])))];
  const values = result.rows.map((row) => standardChartNumber(row[2]) ?? 0);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: { left: 130, right: 80, top: 48, bottom: 70, containLabel: true },
    tooltip: { position: 'top', formatter: (params) => `${xValues[params.value[0]]} / ${yValues[params.value[1]]}: ${standardChartFormat(params.value[2], result.columns[2])}` },
    xAxis: standardChartCategoryAxis(xValues, { rotate: xValues.length > 8 ? 35 : 0 }),
    yAxis: standardChartCategoryAxis(yValues),
    visualMap: { min: Math.min(...values, 0), max: Math.max(...values, 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 8, inRange: { color: ['#eaf2f8', '#3973c6'] } },
    series: [{ type: 'heatmap', data: result.rows.map((row) => [xValues.indexOf(String(row[0])), yValues.indexOf(String(row[1])), standardChartNumber(row[2]) ?? 0]), label: { show: true, formatter: (params) => standardChartFormat(params.value[2], result.columns[2]) }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' } } }],
  };
}

function standardSankeyOption(result) {
  const canonical = (value) => String(value).replace(/^\d+\.\s*(入口:\s*)?/, '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] || '/';
  const nodeNames = [...new Set(result.rows.flatMap((row) => [String(row[0]), String(row[1])]))];
  const nodes = nodeNames.map((name, index) => ({ name, itemStyle: { color: standardChartPalette[index % standardChartPalette.length] }, label: { formatter: () => canonical(name), overflow: 'truncate' } }));
  const links = result.rows.map((row) => ({ source: String(row[0]), target: String(row[1]), value: standardChartNumber(row[2]) ?? 0 }));
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => params.dataType === 'edge' ? `${canonical(params.data.source)} → ${canonical(params.data.target)}<br>${standardChartFormat(params.data.value, result.columns[2])}` : `${canonical(params.name)}` },
    series: [{ type: 'sankey', left: 10, right: 150, top: 24, bottom: 24, nodeWidth: 14, nodeGap: 12, draggable: false, layoutIterations: 32, nodeAlign: 'justify', emphasis: { focus: 'adjacency' }, data: nodes, links, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.55 }, label: { color: '#344054', fontSize: 11 } }],
  };
}

function standardChartOption(result) {
  switch (result.visualization) {
    case 'bar': return standardBarOption(result, 'single');
    case 'grouped_bar': return standardBarOption(result, 'grouped');
    case 'stacked_bar': return standardBarOption(result, 'stacked');
    case 'line': return standardLineOption(result, 'line');
    case 'multi_line': return standardLineOption(result, 'line');
    case 'trend': return standardLineOption(result, 'line');
    case 'area': return standardLineOption(result, 'area');
    case 'stacked_area': return standardLineOption(result, 'stacked_area');
    case 'histogram': return standardHistogramOption(result);
    case 'donut': return standardDonutOption(result);
    case 'calendar_heatmap': return standardCalendarOption(result);
    case 'scatter': return standardScatterOption(result, false);
    case 'bubble': return standardScatterOption(result, true);
    case 'funnel': return standardFunnelOption(result);
    case 'heatmap': return standardHeatmapOption(result);
    case 'sankey': return standardSankeyOption(result);
    default: throw new Error(`未対応のECharts可視化種別です: ${result.visualization}`);
  }
}

function standardChartHeight(result) {
  if (result.visualization === 'bar' || result.visualization === 'grouped_bar' || result.visualization === 'stacked_bar') {
    return Math.max(300, result.rows.length * (result.visualization === 'grouped_bar' ? 48 : 38) + 120);
  }
  if (result.visualization === 'sankey') return 440;
  if (result.visualization === 'calendar_heatmap') return 280;
  return 380;
}

function renderStandardChart(result, box) {
  const chartLibrary = typeof globalThis !== 'undefined' ? globalThis.echarts : undefined;
  if (!chartLibrary) {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'notice error', textContent: 'チャートライブラリを読み込めないため描画できません。' }));
    return;
  }
  const previous = standardChartInstances.get(box);
  if (previous) {
    previous.resizeObserver?.disconnect();
    previous.instance.dispose();
    standardChartInstances.delete(box);
  }
  box.replaceChildren();
  const host = document.createElement('div');
  host.className = 'echart-root';
  host.style.height = `${standardChartHeight(result)}px`;
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', `${result.columns?.[0] ?? ''} ${result.visualization} chart`);
  box.append(host);
  let instance;
  let resizeObserver;
  try {
    instance = chartLibrary.init(host, null, { renderer: 'svg' });
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => instance.resize()) : null;
    resizeObserver?.observe(host);
    instance.setOption(standardChartOption(result), { notMerge: true, lazyUpdate: false });
    instance.resize();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => instance.resize());
    standardChartInstances.set(box, { instance, resizeObserver });
  } catch (error) {
    resizeObserver?.disconnect();
    instance?.dispose();
    box.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'notice error',
      textContent: `チャートの描画に失敗しました。結果データは「データ」タブで確認できます。${error instanceof Error ? ` (${error.message})` : ''}`,
    }));
  }
}

function graph(result, box = $('chart')) {
  box.replaceChildren();
  if (!result.rows.length) {
    box.appendChild(Object.assign(document.createElement('p'), { className: 'notice warning', textContent: '該当する行はありませんでした。' }));
    return;
  }
  if (result.visualization === 'scalar') {
    box.appendChild(Object.assign(document.createElement('div'), { className: 'metric', textContent: chartValue(result.rows[0][0], result.columns[0], true) }));
    return;
  }
  if (['kpi_group', 'kpi_pair'].includes(result.visualization)) {
    kpiGroup(result, box);
    return;
  }
  if (result.visualization === 'table') {
    renderResultTable(result, box);
    return;
  }
  renderStandardChart(result, box);
}
