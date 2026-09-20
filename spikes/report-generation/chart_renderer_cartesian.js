import { metricUnit } from './chart_renderer_runtime.js';
import {
  standardChartBase,
  standardChartCategoryAxis,
  standardChartCategoryOrientation,
  standardChartCategoryWidth,
  standardChartDisplayLabel,
  standardChartFormat,
  standardChartGrid,
  standardChartLabel,
  standardChartNumber,
  standardChartPalette,
  standardChartTooltipFormatter,
  standardChartUnit,
  standardChartValueAxis,
} from './chart_renderer_core.js';

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
  const displayResult = {
    ...result,
    columns: [result.columns[0], ...result.columns.slice(1).map(standardChartDisplayLabel)],
  };
  const option = standardLineOption(displayResult, 'line');
  option.series = option.series.map((series, index) => index === 0 ? {
    ...series, type: 'bar', showSymbol: false, barMaxWidth: 36,
  } : series);
  option.yAxis.forEach((axis, index) => {
    const values = result.rows
      .map((row) => standardChartNumber(row[index + 1]))
      .filter((value) => value !== null);
    if (values.length && values.every((value) => value >= 0)) axis.min = 0;
    delete axis.max;
    axis.name = metricUnit(displayResult.columns[index + 1]) || '';
    axis.axisLabel = {
      ...axis.axisLabel,
      color: standardChartPalette[index % standardChartPalette.length],
    };
    axis.axisLine = {
      show: true,
      lineStyle: { color: standardChartPalette[index % standardChartPalette.length] },
    };
  });
  const months = result.rows.map((row) => String(row[0] ?? '').match(/^(\d{4})-(\d{2})-01$/));
  if (months.length > 1 && months.every(Boolean) && new Set(months.map((match) => match[1])).size === 1) {
    option.xAxis.axisLabel = {
      ...option.xAxis.axisLabel,
      interval: 0,
      rotate: 0,
      formatter: (value) => `${Number(String(value).slice(5, 7))}月`,
    };
  }
  return option;
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

export {
  standardAnnotatedLineOption,
  standardBarOption,
  standardBoxPlotOption,
  standardCalendarOption,
  standardHeatmapOption,
  standardHistogramOption,
  standardLineOption,
  standardMixedOption,
  standardReferenceAreaOption,
  standardReferenceLineOption,
  standardScatterOption,
  standardSparklineOption,
};
