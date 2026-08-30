function standardMapName(result) {
  let hash = 2166136261;
  const geometryIndex = result.visualization === 'base_map' ? 2 : 1;
  result.rows.forEach((row) => {
    const value = String(row[geometryIndex] ?? '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  });
  return `repchat-map-${(hash >>> 0).toString(16)}`;
}

function standardMapGeoJson(result) {
  const geometryIndex = result.visualization === 'base_map' ? 2 : 1;
  const nameIndex = result.visualization === 'base_map' ? 1 : 0;
  const seen = new Set();
  const features = result.rows.flatMap((row) => {
    const source = row[geometryIndex];
    if (!source || seen.has(source)) return [];
    seen.add(source);
    const document = JSON.parse(source);
    if (document.type === 'FeatureCollection') return document.features;
    if (document.type === 'Feature') return [document];
    return [{ type: 'Feature', properties: { name: String(row[nameIndex]) }, geometry: document }];
  });
  return {
    type: 'FeatureCollection',
    features,
  };
}

function standardGeoComponent(map) {
  return {
    map, roam: true, scaleLimit: { min: 1, max: 12 },
    itemStyle: { areaColor: '#edf2f7', borderColor: '#fff', borderWidth: 1 },
    emphasis: { itemStyle: { areaColor: '#9dc0e8' }, label: { show: true } },
  };
}

function standardAreaMapOption(result) {
  const values = result.rows.map((row) => standardChartNumber(row[2]) ?? 0);
  const map = standardMapName(result);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    geo: standardGeoComponent(map),
    visualMap: {
      min: Math.min(...values, 0), max: Math.max(...values, 1), calculable: true,
      orient: 'horizontal', left: 'center', bottom: 8,
      inRange: { color: ['#eaf2f8', '#3973c6'] },
    },
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${standardChartFormat(params.value, result.columns[2])}` },
    series: [{
      name: result.columns[2], type: 'map', map, geoIndex: 0,
      data: result.rows.map((row) => ({ name: String(row[0]), value: standardChartNumber(row[2]) })),
    }],
  };
}

function standardPointMapOption(result, bubble = false) {
  const map = standardMapName(result);
  const sizeIndex = bubble ? 4 : null;
  const valueIndex = bubble ? 5 : 4;
  const sizes = bubble ? result.rows.map((row) => standardChartNumber(row[sizeIndex]) ?? 0) : [];
  const maxSize = Math.max(...sizes, 1);
  const values = result.rows.map((row) => standardChartNumber(row[valueIndex]) ?? 0);
  return {
    ...standardChartBase({ tooltip: true }),
    grid: undefined,
    geo: standardGeoComponent(map),
    visualMap: { min: Math.min(...values, 0), max: Math.max(...values, 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 8, inRange: { color: ['#9dc0e8', '#3973c6'] } },
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}<br>${result.columns[valueIndex]}: ${standardChartFormat(params.value[2], result.columns[valueIndex])}` },
    series: [{
      name: result.columns[valueIndex], type: bubble ? 'effectScatter' : 'scatter', coordinateSystem: 'geo',
      data: result.rows.map((row, index) => ({ name: String(row[0]), value: [standardChartNumber(row[3]), standardChartNumber(row[2]), standardChartNumber(row[valueIndex])], symbolSize: bubble ? 8 + 32 * Math.sqrt(sizes[index] / maxSize) : 10 })),
      emphasis: { focus: 'self', label: { show: true, formatter: '{b}', position: 'right' } },
    }],
  };
}

function standardBaseMapOption(result) {
  const map = standardMapName(result);
  const areaRows = result.rows.filter((row) => row[0] === 'area');
  const pointRows = result.rows.filter((row) => row[0] === 'point');
  const bubbleRows = result.rows.filter((row) => row[0] === 'bubble');
  const maxSize = Math.max(...bubbleRows.map((row) => standardChartNumber(row[5]) ?? 0), 1);
  const series = [];
  if (areaRows.length) series.push({ name: result.columns[6], type: 'map', map, geoIndex: 0, data: areaRows.map((row) => ({ name: String(row[1]), value: standardChartNumber(row[6]) })) });
  if (pointRows.length) series.push({ name: 'point', type: 'scatter', coordinateSystem: 'geo', data: pointRows.map((row) => ({ name: String(row[1]), value: [standardChartNumber(row[4]), standardChartNumber(row[3]), standardChartNumber(row[6])], symbolSize: 10 })) });
  if (bubbleRows.length) series.push({ name: 'bubble', type: 'effectScatter', coordinateSystem: 'geo', data: bubbleRows.map((row) => ({ name: String(row[1]), value: [standardChartNumber(row[4]), standardChartNumber(row[3]), standardChartNumber(row[6])], symbolSize: 8 + 32 * Math.sqrt((standardChartNumber(row[5]) ?? 0) / maxSize) })) });
  return {
    ...standardChartBase({ tooltip: true }), grid: undefined, geo: standardGeoComponent(map), series,
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${standardChartFormat(params.value?.[2] ?? params.value, result.columns[6])}` },
  };
}

