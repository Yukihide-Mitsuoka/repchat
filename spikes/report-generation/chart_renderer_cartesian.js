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

