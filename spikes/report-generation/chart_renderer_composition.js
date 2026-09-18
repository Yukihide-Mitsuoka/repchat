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

function standardSankeyOption(result, vertical = false) {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const nodeNames = [...new Set(result.rows.flatMap((row) => [String(row[0]), String(row[1])]))];
  const nodes = nodeNames.map((name, index) => ({ name, itemStyle: { color: standardChartPalette[index % standardChartPalette.length] }, label: { formatter: () => name, overflow: 'truncate' } }));
  const links = result.rows.map((row) => ({ source: String(row[0]), target: String(row[1]), value: standardChartNumber(row[2]) ?? 0 }));
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    tooltip: { trigger: 'item', formatter: (params) => params.dataType === 'edge' ? `${escapeHtml(params.data.source)} → ${escapeHtml(params.data.target)}<br>${escapeHtml(standardChartFormat(params.data.value, result.columns[2]))}` : escapeHtml(params.name) },
    series: [{ type: 'sankey', orient: vertical ? 'vertical' : 'horizontal', left: 24, right: vertical ? 24 : 150, top: 24, bottom: vertical ? 80 : 24, nodeWidth: 14, nodeGap: 12, draggable: false, layoutIterations: 32, nodeAlign: 'justify', emphasis: { focus: 'adjacency' }, data: nodes, links, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.55 }, label: { color: '#344054', fontSize: 11, position: vertical ? 'bottom' : 'right' } }],
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
