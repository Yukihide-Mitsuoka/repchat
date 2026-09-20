import { chartValue, metricAxisTitle } from './chart_renderer_runtime.js';

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

function standardChartAxisFormat(value, column = '') {
  const number = standardChartNumber(value);
  if (number === null || Math.abs(number) < 10000) return standardChartFormat(value, column);
  const [divisor, suffix] = Math.abs(number) >= 1e12
    ? [1e12, '兆']
    : Math.abs(number) >= 1e8
      ? [1e8, '億']
      : [1e4, '万'];
  const scaled = number / divisor;
  const maximumFractionDigits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits }).format(scaled)}${suffix}`;
}

function standardChartDisplayLabel(column) {
  const label = String(column ?? '');
  const aggregate = label.match(/^\s*(SUM|AVG|MIN|MAX|COUNT)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)\s*$/i);
  if (!aggregate) return label;
  const operation = {
    SUM: '合計', AVG: '平均', MIN: '最小', MAX: '最大', COUNT: '件数',
  }[aggregate[1].toUpperCase()];
  const identifier = aggregate[2].split('.').at(-1).replaceAll('_', ' ');
  return `${identifier}（${operation}）`;
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
  return (value) => standardChartAxisFormat(value, column);
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

export {
  standardChartBase,
  standardChartCategoryAxis,
  standardChartCategoryOrientation,
  standardChartCategoryWidth,
  standardChartDisplayLabel,
  standardChartFormat,
  standardChartGrid,
  standardChartInstances,
  standardChartLabel,
  standardChartNumber,
  standardChartPalette,
  standardChartTooltipFormatter,
  standardChartUnit,
  standardChartValueAxis,
};
