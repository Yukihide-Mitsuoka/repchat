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

function standardChartCategoryWidth(categories) {
  const longest = categories.reduce(
    (length, category) => Math.max(length, standardChartLabel(category, 30).length),
    0,
  );
  return Math.min(132, Math.max(72, longest * 7 + 12));
}

function standardChartCategoryOrientation(categories) {
  const labels = categories.map((category) => String(category ?? ''));
  if (labels.length < 9) return 'horizontal';
  const dateLike = labels.filter((label) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(label)).length;
  const compact = labels.every((label) => label.length <= 18);
  const denseDateLike = dateLike >= Math.max(3, Math.ceil(labels.length / 2));
  return denseDateLike || compact ? 'vertical' : 'horizontal';
}

function standardChartGrid(horizontal = false, spacing = {}) {
  const base = horizontal
    ? { left: 64, right: 40, top: 44, bottom: 42, containLabel: true }
    : { left: 52, right: 40, top: 44, bottom: 42, containLabel: true };
  return { ...base, ...spacing };
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

function standardChartValueAxis(column, position = 'left', offset = 0, nameOverride) {
  return {
    type: 'value',
    name: nameOverride ?? standardChartUnit(column),
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
  const vertical = standardChartCategoryOrientation(categories) === 'vertical';
  const percent = mode === 'percent';
  const units = metricColumns.map((column) => percent ? '%' : metricUnit(column) || column);
  const unitIndexes = new Map();
  const unitColumns = [];
  units.forEach((unit, index) => {
    if (!unitIndexes.has(unit)) {
      unitIndexes.set(unit, unitIndexes.size);
      unitColumns.push({ unit, column: metricColumns[index] });
    }
  });
  const multipleUnits = unitColumns.length > 1;
  const primaryAxisCount = multipleUnits ? Math.ceil(unitColumns.length / 2) : 1;
  const secondaryAxisCount = multipleUnits ? Math.floor(unitColumns.length / 2) : 0;
  const axes = unitColumns.map(({ unit, column }, index) =>
    standardChartValueAxis(
      column,
      vertical
        ? (index % 2 === 0 ? 'left' : 'right')
        : (index % 2 === 0 ? 'bottom' : 'top'),
      Math.floor(index / 2) * (vertical ? 58 : 28),
      unit || standardChartUnit(column),
    ),
  );
  const canStack = (mode === 'stacked' || percent) && !multipleUnits;
  const labelPosition = vertical ? (canStack ? 'insideTop' : 'top') : (canStack ? 'inside' : 'right');
  const series = metricColumns.map((column, seriesIndex) => {
    const axisIndex = multipleUnits ? unitIndexes.get(units[seriesIndex]) : 0;
    const values = result.rows.map((row) => {
      const value = standardChartNumber(row[seriesIndex + 1]);
      if (!percent || value === null) return value;
      const total = row.slice(1).reduce((sum, item) => sum + (standardChartNumber(item) ?? 0), 0);
      return total > 0 ? value / total * 100 : 0;
    });
    return {
      name: column,
      type: 'bar',
      data: values,
      yAxisIndex: multipleUnits ? axisIndex : undefined,
      xAxisIndex: multipleUnits ? axisIndex : undefined,
      stack: canStack ? (percent ? 'percent' : 'total') : undefined,
      barMaxWidth: mode === 'grouped' ? 24 : 34,
      barGap: '30%',
      barCategoryGap: '28%',
      emphasis: {
        focus: 'series',
        label: { show: true, position: labelPosition, distance: 8 },
      },
      label: {
        show: false,
        position: labelPosition,
        distance: 8,
        formatter: (params) => standardChartFormat(params.value, column),
        color: canStack ? '#fff' : '#344054',
        textBorderColor: canStack ? '#344054' : undefined,
        textBorderWidth: canStack ? 2 : 0,
      },
      labelLayout: { hideOverlap: true, moveOverlap: vertical ? 'shiftX' : 'shiftY' },
    };
  });
  const option = standardChartBase({ horizontal: !vertical, legend: metricColumns.length > 1 });
  if (percent) axes.forEach((axis) => {
    axis.min = 0;
    axis.max = 100;
    axis.axisLabel = { formatter: (value) => `${value}%`, hideOverlap: true };
  });
  if (vertical) {
    option.grid = standardChartGrid(false, {
      left: 52 + Math.max(0, primaryAxisCount - 1) * 58,
      right: 40 + Math.max(0, secondaryAxisCount - 1) * 58,
      top: 44,
      bottom: categories.length > 8 ? 64 : 42,
    });
    option.xAxis = standardChartCategoryAxis(categories, {
      rotate: categories.length > 8 ? 35 : 0,
      formatter: (value) => standardChartLabel(value, 12),
    });
    option.yAxis = axes.map((axis) => ({ ...axis, gridIndex: 0 }));
    option.series = series.map((item, index) => ({
      ...item,
      xAxisIndex: 0,
      yAxisIndex: multipleUnits ? unitIndexes.get(units[index]) : 0,
    }));
    return option;
  }
  const bottomAxisCount = primaryAxisCount;
  const topAxisCount = secondaryAxisCount;
  option.grid = standardChartGrid(true, {
    top: 44 + topAxisCount * 24,
    bottom: 36 + bottomAxisCount * 24,
  });
  option.xAxis = axes.map((axis) => ({ ...axis, gridIndex: 0 }));
  option.yAxis = standardChartCategoryAxis(categories, {
    width: standardChartCategoryWidth(categories),
    overflow: 'truncate',
    formatter: (value) => standardChartLabel(value, 30),
  });
  option.series = series.map((item, index) => ({
    ...item,
    xAxisIndex: multipleUnits ? unitIndexes.get(units[index]) : 0,
    yAxisIndex: 0,
  }));
  return option;
}

function standardLineOption(result, mode) {
  const metricColumns = result.columns.slice(1);
  const categories = result.rows.map((row) => String(row[0]));
  const percent = mode === 'percent_stacked_area';
  const stacked = mode === 'stacked_area' || percent;
  const option = standardChartBase({ legend: metricColumns.length > 1 });
  option.grid = standardChartGrid(false);
  option.xAxis = standardChartCategoryAxis(categories, {
    formatter: (value) => standardChartLabel(value, 12),
  });
  option.yAxis = (stacked ? [metricColumns[0]] : metricColumns).map((column, index) => ({
    ...standardChartValueAxis(column, index % 2 === 0 ? 'left' : 'right', Math.floor(index / 2) * 58),
    min: percent ? 0 : 'dataMin',
    max: percent ? 100 : 'dataMax',
    name: percent ? '%' : standardChartUnit(column),
    axisLabel: percent ? { formatter: (value) => `${value}%`, hideOverlap: true } : standardChartValueAxis(column).axisLabel,
  }));
  option.series = metricColumns.map((column, index) => ({
    name: column,
    type: 'line',
    yAxisIndex: stacked ? 0 : index,
    data: result.rows.map((row) => {
      const value = standardChartNumber(row[index + 1]);
      if (!percent || value === null) return value;
      const total = row.slice(1).reduce((sum, item) => sum + (standardChartNumber(item) ?? 0), 0);
      return total > 0 ? value / total * 100 : 0;
    }),
    showSymbol: true,
    symbol: 'circle',
    symbolSize: 7,
    connectNulls: false,
    smooth: false,
    areaStyle: mode === 'area' || stacked ? { opacity: stacked ? 0.45 : 0.18 } : undefined,
    stack: stacked ? (percent ? 'percent' : 'total') : undefined,
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
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];
  const calendars = years.map((year, index) => ({
    top: 52 + index * 150, left: 44, right: 22, height: 116, range: year,
    cellSize: ['auto', 16], splitLine: { show: true, lineStyle: { color: '#d9dee7' } },
    itemStyle: { borderWidth: 1, borderColor: '#fff' },
    dayLabel: { firstDay: 1, nameMap: 'ja' }, monthLabel: { nameMap: 'ja' },
    yearLabel: { show: true },
  }));
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { formatter: (params) => `${params.data?.[0] ?? ''}: ${standardChartFormat(params.data?.[1], result.columns[1])}` },
    visualMap: { min, max, calculable: true, orient: 'horizontal', left: 'center', top: 8, inRange: { color: ['#eaf2f8', '#3973c6'] } },
    calendar: calendars,
    series: years.map((year, calendarIndex) => ({
      type: 'heatmap', coordinateSystem: 'calendar', calendarIndex,
      data: dates.flatMap((date, index) => date.startsWith(year) ? [[date, values[index]]] : []),
    })),
  };
}

function standardScatterOption(result, bubble) {
  const multiple = result.columns.length === (bubble ? 5 : 4);
  const valueOffset = multiple ? 2 : 1;
  const xColumn = result.columns[valueOffset];
  const yColumn = result.columns[valueOffset + 1];
  const sizeColumn = result.columns[valueOffset + 2];
  const option = standardChartBase({ tooltip: true });
  option.grid = standardChartGrid(false);
  option.xAxis = { ...standardChartValueAxis(xColumn), nameLocation: 'middle', nameGap: 34 };
  option.yAxis = { ...standardChartValueAxis(yColumn), nameLocation: 'middle', nameGap: 52 };
  option.tooltip = { trigger: 'item', formatter: (params) => {
    const row = params.data.raw;
    const series = multiple ? `<br>${result.columns[1]}: ${row[1]}` : '';
    return `${row[0]}${series}<br>${xColumn}: ${standardChartFormat(row[valueOffset], xColumn)}<br>${yColumn}: ${standardChartFormat(row[valueOffset + 1], yColumn)}${bubble ? `<br>${sizeColumn}: ${standardChartFormat(row[valueOffset + 2], sizeColumn)}` : ''}`;
  } };
  const sizes = bubble ? result.rows.map((row) => Math.max(0, standardChartNumber(row[valueOffset + 2]) ?? 0)) : [];
  const maxSize = Math.max(...sizes, 1);
  const seriesNames = multiple ? [...new Set(result.rows.map((row) => String(row[1])))] : [''];
  option.legend = multiple ? { top: 8, type: 'scroll' } : undefined;
  option.series = seriesNames.map((seriesName) => ({
    name: seriesName || undefined,
    type: 'scatter',
    data: result.rows.flatMap((row, index) => !multiple || String(row[1]) === seriesName ? [{ value: [standardChartNumber(row[valueOffset]), standardChartNumber(row[valueOffset + 1])], symbolSize: bubble ? 8 + 34 * Math.sqrt(sizes[index] / maxSize) : 12, name: String(row[0]), raw: row }] : []),
    label: { show: true, formatter: (params) => standardChartLabel(params.data.name, 16), position: 'right' },
    emphasis: { focus: 'series', label: { show: true } },
  }));
  return option;
}

function standardFunnelOption(result, horizontal = false) {
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${standardChartFormat(params.value, result.columns[1])}` },
    series: [{
      type: 'funnel',
      orient: horizontal ? 'horizontal' : 'vertical',
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
  const cellCount = xValues.length * yValues.length;
  const dense = cellCount > 60 || yValues.length > 24;
  const zoomed = yValues.length > 24;
  const visibleCategories = Math.min(24, yValues.length);
  const visiblePercent = Math.min(100, Math.max(20, (visibleCategories / Math.max(yValues.length, 1)) * 100));
  const xLabelLength = xValues.length > 8 ? 14 : 20;
  const yLabelLength = 28;
  return {
    ...standardChartBase({ tooltip: true }),
    grid: { left: 190, right: zoomed ? 42 : 80, top: 48, bottom: 82, containLabel: true },
    tooltip: { position: 'top', formatter: (params) => `${xValues[params.value[0]]} / ${yValues[params.value[1]]}: ${standardChartFormat(params.value[2], result.columns[2])}` },
    xAxis: standardChartCategoryAxis(xValues, {
      rotate: xValues.length > 8 ? 35 : 0,
      formatter: (value) => standardChartLabel(value, xLabelLength),
    }),
    yAxis: standardChartCategoryAxis(yValues, {
      width: 176,
      overflow: 'truncate',
      formatter: (value) => standardChartLabel(value, yLabelLength),
      interval: zoomed ? 0 : 'auto',
    }),
    visualMap: { min: Math.min(...values, 0), max: Math.max(...values, 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 8, inRange: { color: ['#eaf2f8', '#3973c6'] } },
    dataZoom: zoomed ? [
      { type: 'slider', yAxisIndex: 0, right: 8, top: 48, bottom: 82, start: 0, end: visiblePercent, filterMode: 'none' },
      { type: 'inside', yAxisIndex: 0, start: 0, end: visiblePercent, filterMode: 'none' },
    ] : undefined,
    series: [{
      type: 'heatmap',
      data: result.rows.map((row) => [xValues.indexOf(String(row[0])), yValues.indexOf(String(row[1])), standardChartNumber(row[2]) ?? 0]),
      label: { show: !dense, formatter: (params) => standardChartFormat(params.value[2], result.columns[2]) },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' },
        label: { show: true, formatter: (params) => standardChartFormat(params.value[2], result.columns[2]) },
      },
    }],
  };
}

function standardSankeyOption(result, vertical = false, navigation = true) {
  const canonical = (value) => navigation ? String(value).replace(/^\d+\.\s*(入口:\s*)?/, '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] || '/' : String(value);
  const nodeNames = [...new Set(result.rows.flatMap((row) => [String(row[0]), String(row[1])]))];
  const nodes = nodeNames.map((name, index) => ({ name, itemStyle: { color: standardChartPalette[index % standardChartPalette.length] }, label: { formatter: () => canonical(name), overflow: 'truncate' } }));
  const links = result.rows.map((row) => ({ source: String(row[0]), target: String(row[1]), value: standardChartNumber(row[2]) ?? 0 }));
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => params.dataType === 'edge' ? `${canonical(params.data.source)} → ${canonical(params.data.target)}<br>${standardChartFormat(params.data.value, result.columns[2])}` : `${canonical(params.name)}` },
    series: [{ type: 'sankey', orient: vertical ? 'vertical' : 'horizontal', left: 24, right: vertical ? 24 : 150, top: 24, bottom: vertical ? 80 : 24, nodeWidth: 14, nodeGap: 12, draggable: false, layoutIterations: 32, nodeAlign: 'justify', emphasis: { focus: 'adjacency' }, data: nodes, links, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.55 }, label: { color: '#344054', fontSize: 11, position: vertical ? 'bottom' : 'right' } }],
  };
}

function standardAnnotatedLineOption(result) {
  const lineResult = {
    ...result,
    columns: [result.columns[0], result.columns[2]],
    rows: result.rows.map((row) => [row[0], row[2]]),
  };
  const option = standardLineOption(lineResult, 'line');
  option.series[0].markPoint = {
    symbol: 'pin',
    symbolSize: 46,
    data: result.rows.flatMap((row) => row[1] ? [{
      name: String(row[1]),
      coord: [String(row[0]).slice(0, 10), standardChartNumber(row[2])],
      value: String(row[1]),
    }] : []),
    label: { formatter: (params) => standardChartLabel(params.name, 16) },
  };
  return option;
}

function standardSparklineOption(result) {
  const values = result.rows.map((row) => standardChartNumber(row[1]));
  const latest = values.at(-1);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: { left: 8, right: 8, top: 18, bottom: 8 },
    xAxis: { type: 'category', show: false, data: result.rows.map((row) => String(row[0]).slice(0, 10)) },
    yAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
    tooltip: { trigger: 'axis', formatter: standardChartTooltipFormatter },
    graphic: latest === null || latest === undefined ? undefined : [{
      type: 'text', right: 12, top: 4,
      style: { text: standardChartFormat(latest, result.columns[1]), fontSize: 20, fontWeight: 600, fill: '#101828', textAlign: 'right' },
    }],
    series: [{
      name: result.columns[1], type: 'line', data: values, showSymbol: false,
      smooth: false, areaStyle: { opacity: 0.12 }, emphasis: { focus: 'series' },
    }],
  };
}

function standardMixedOption(result) {
  const option = standardLineOption(result, 'line');
  option.series = option.series.map((series, index) => index === 0 ? {
    ...series, type: 'bar', showSymbol: false, barMaxWidth: 36,
  } : series);
  return option;
}

function standardDeltaOption(result) {
  const current = standardChartNumber(result.rows[0][0]) ?? 0;
  const comparison = standardChartNumber(result.rows[0][1]) ?? 0;
  const delta = current - comparison;
  const signedDelta = `${delta > 0 ? '+' : ''}${standardChartFormat(delta, result.columns[0])}`;
  return {
    ...standardChartBase({ tooltip: false }),
    grid: undefined,
    xAxis: undefined,
    yAxis: undefined,
    series: [],
    graphic: [
      { type: 'text', left: '8%', top: '26%', style: { text: `${result.columns[0]}\n${standardChartFormat(current, result.columns[0])}`, fontSize: 22, fontWeight: 600, lineHeight: 32, fill: '#101828' } },
      { type: 'text', right: '8%', top: '26%', style: { text: `${result.columns[1]}\n${standardChartFormat(comparison, result.columns[1])}`, fontSize: 18, lineHeight: 30, fill: '#667085', textAlign: 'right' } },
      { type: 'text', left: 'center', top: '68%', style: { text: signedDelta, fontSize: 20, fontWeight: 600, fill: delta === 0 ? '#667085' : delta > 0 ? '#3973c6' : '#d49a21', textAlign: 'center' } },
    ],
  };
}

function standardChartOption(result) {
  switch (result.visualization) {
    case 'bar': return standardBarOption(result, 'single');
    case 'grouped_bar': return standardBarOption(result, 'grouped');
    case 'stacked_bar': return standardBarOption(result, 'stacked');
    case 'percent_stacked_bar': return standardBarOption(result, 'percent');
    case 'line': return standardLineOption(result, 'line');
    case 'multi_line': return standardLineOption(result, 'line');
    case 'trend': return standardLineOption(result, 'line');
    case 'area': return standardLineOption(result, 'area');
    case 'stacked_area': return standardLineOption(result, 'stacked_area');
    case 'percent_stacked_area': return standardLineOption(result, 'percent_stacked_area');
    case 'histogram': return standardHistogramOption(result);
    case 'donut': return standardDonutOption(result);
    case 'calendar_heatmap': return standardCalendarOption(result);
    case 'scatter': return standardScatterOption(result, false);
    case 'bubble': return standardScatterOption(result, true);
    case 'funnel': return standardFunnelOption(result);
    case 'funnel_horizontal': return standardFunnelOption(result, true);
    case 'heatmap': return standardHeatmapOption(result);
    case 'sankey': return standardSankeyOption(result);
    case 'sankey_vertical': return standardSankeyOption(result, true);
    case 'flow_sankey': return standardSankeyOption(result, false, false);
    case 'flow_sankey_vertical': return standardSankeyOption(result, true, false);
    case 'annotated_line': return standardAnnotatedLineOption(result);
    case 'sparkline': return standardSparklineOption(result);
    case 'mixed_bar_line': return standardMixedOption(result);
    case 'delta': return standardDeltaOption(result);
    default: throw new Error(`未対応のECharts可視化種別です: ${result.visualization}`);
  }
}

function standardChartHeight(result) {
  if (result.visualization === 'sparkline') return 180;
  if (result.visualization === 'delta') return 220;
  if (['bar', 'grouped_bar', 'stacked_bar', 'percent_stacked_bar'].includes(result.visualization)) {
    const units = new Set(result.columns.slice(1).map((column) => result.visualization === 'percent_stacked_bar' ? '%' : metricUnit(column) || column));
    const axisSpace = units.size > 1 ? 64 : 0;
    const categories = result.rows.map((row) => String(row[0] ?? ''));
    if (standardChartCategoryOrientation(categories) === 'vertical') return Math.max(340, 300 + axisSpace);
    return Math.max(300, result.rows.length * (result.visualization === 'grouped_bar' ? 48 : 38) + 120 + axisSpace);
  }
  if (['sankey', 'flow_sankey'].includes(result.visualization)) return 440;
  if (['sankey_vertical', 'flow_sankey_vertical'].includes(result.visualization)) return 560;
  if (result.visualization === 'calendar_heatmap') {
    const years = new Set(result.rows.map((row) => String(row[0]).slice(0, 4))).size;
    return Math.max(280, 90 + years * 150);
  }
  if (result.visualization === 'heatmap') {
    const yCount = new Set(result.rows.map((row) => String(row[1]))).size;
    return Math.max(380, Math.min(560, 140 + Math.min(yCount, 24) * 18));
  }
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
