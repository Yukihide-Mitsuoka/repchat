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

function standardBoxPlotOption(result, horizontal = false) {
  const categories = result.rows.map((row) => String(row[0]));
  const values = result.rows.map((row) => row.slice(1).map(standardChartNumber));
  const categoryAxis = standardChartCategoryAxis(categories, {
    formatter: (value) => standardChartLabel(value, 18),
  });
  const valueAxis = standardChartValueAxis(result.columns[3]);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: standardChartGrid(horizontal),
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${categories[params.dataIndex]}<br>${result.columns.slice(1).map((column, index) => `${column}: ${standardChartFormat(params.value[index], column)}`).join('<br>')}`,
    },
    series: [{ type: 'boxplot', data: values, itemStyle: { borderWidth: 2 }, emphasis: { focus: 'self' } }],
  };
}

function standardTreemapOption(result) {
  const dimensionCount = result.columns.length - 1;
  const roots = [];
  result.rows.forEach((row) => {
    let children = roots;
    row.slice(0, dimensionCount).forEach((rawName, index) => {
      const name = String(rawName);
      let node = children.find((item) => item.name === name);
      if (!node) {
        node = { name };
        children.push(node);
      }
      if (index === dimensionCount - 1) node.value = standardChartNumber(row.at(-1));
      else {
        node.children ??= [];
        children = node.children;
      }
    });
  });
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => `${params.treePathInfo.map((item) => item.name).filter(Boolean).join(' / ')}<br>${standardChartFormat(params.value, result.columns.at(-1))}` },
    series: [{
      type: 'treemap', data: roots, roam: false, nodeClick: false,
      breadcrumb: { show: dimensionCount > 1 },
      label: { show: true, formatter: '{b}' },
      upperLabel: { show: dimensionCount > 1, height: 24 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 2 } }, { itemStyle: { borderWidth: 2, gapWidth: 2 } }],
    }],
  };
}

function standardPieOption(result) {
  const option = standardDonutOption(result);
  option.series[0].radius = ['0%', '72%'];
  option.series[0].center = ['42%', '52%'];
  return option;
}

function standardReferenceLineOption(result) {
  const option = standardLineOption(result, 'line');
  option.yAxis = [standardChartValueAxis(result.columns[1])];
  option.series = option.series.map((series, index) => ({
    ...series,
    yAxisIndex: 0,
    showSymbol: index === 0,
    lineStyle: index === 0 ? series.lineStyle : { type: 'dashed', width: 2 },
  }));
  return option;
}

function standardReferenceAreaOption(result) {
  const categories = result.rows.map((row) => String(row[0]).slice(0, 10));
  const option = standardChartBase({ legend: true });
  option.grid = standardChartGrid(false);
  option.xAxis = standardChartCategoryAxis(categories);
  option.yAxis = standardChartValueAxis(result.columns[1]);
  option.series = [
    { name: result.columns[1], type: 'line', data: result.rows.map((row) => standardChartNumber(row[1])), showSymbol: true, z: 3 },
    { name: result.columns[2], type: 'line', data: result.rows.map((row) => standardChartNumber(row[2])), stack: 'reference-range', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, tooltip: { show: false } },
    { name: `${result.columns[2]}–${result.columns[3]}`, type: 'line', data: result.rows.map((row) => (standardChartNumber(row[3]) ?? 0) - (standardChartNumber(row[2]) ?? 0)), stack: 'reference-range', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: '#9dc0e8', opacity: 0.28 } },
  ];
  return option;
}
