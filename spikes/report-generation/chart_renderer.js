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
