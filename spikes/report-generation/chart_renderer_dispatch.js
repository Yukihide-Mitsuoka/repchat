
import { chartValue, kpiGroup, metricUnit } from './chart_renderer_runtime.js';
import {
  standardChartCategoryOrientation,
  standardChartInstances,
} from './chart_renderer_core.js';
import {
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
} from './chart_renderer_cartesian.js';
import {
  standardDonutOption,
  standardFunnelOption,
  standardPieOption,
  standardSankeyOption,
  standardTreemapOption,
} from './chart_renderer_composition.js';
import {
  standardAreaMapOption,
  standardBaseMapOption,
  standardMapGeoJson,
  standardMapName,
  standardPointMapOption,
} from './chart_renderer_maps.js';
import { standardDeltaOption } from './chart_renderer_indicators.js';
import {
  renderAdvancedResultTable,
  renderComparisonResultTable,
  renderPivotResultTable,
  renderSparklineResultTable,
} from './chart_renderer_tables.js';

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
    case 'flow_sankey': return standardSankeyOption(result);
    case 'flow_sankey_vertical': return standardSankeyOption(result, true);
    case 'annotated_line': return standardAnnotatedLineOption(result);
    case 'sparkline': return standardSparklineOption(result);
    case 'mixed_bar_line': return standardMixedOption(result);
    case 'delta': return standardDeltaOption(result);
    case 'box_plot': return standardBoxPlotOption(result);
    case 'box_plot_horizontal': return standardBoxPlotOption(result, true);
    case 'treemap': return standardTreemapOption(result);
    case 'pie': return standardPieOption(result);
    case 'area_map': return standardAreaMapOption(result);
    case 'us_map': return standardAreaMapOption(result);
    case 'point_map': return standardPointMapOption(result);
    case 'bubble_map': return standardPointMapOption(result, true);
    case 'base_map': return standardBaseMapOption(result);
    case 'reference_line': return standardReferenceLineOption(result);
    case 'reference_area': return standardReferenceAreaOption(result);
    default: throw new Error(`未対応のECharts可視化種別です: ${result.visualization}`);
  }
}

function standardChartHeight(result) {
  if (['area_map', 'us_map', 'point_map', 'bubble_map', 'base_map'].includes(result.visualization)) return 440;
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
  if (['sankey_vertical', 'flow_sankey_vertical'].includes(result.visualization)) return 440;
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

function renderStandardChart(result, box, chartLibrary) {
  if (!chartLibrary) {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'notice error', textContent: 'チャートライブラリを読み込めないため描画できません。' }));
    return false;
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
    if (['area_map', 'us_map', 'point_map', 'bubble_map', 'base_map'].includes(result.visualization)) {
      chartLibrary.registerMap(standardMapName(result), standardMapGeoJson(result));
    }
    instance.setOption(standardChartOption(result), { notMerge: true, lazyUpdate: false });
    instance.resize();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => instance.resize());
    standardChartInstances.set(box, { instance, resizeObserver });
    return true;
  } catch (error) {
    resizeObserver?.disconnect();
    instance?.dispose();
    box.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'notice error',
      textContent: `チャートの描画に失敗しました。結果データは「データ」タブで確認できます。${error instanceof Error ? ` (${error.message})` : ''}`,
    }));
    return false;
  }
}

function graph(result, box = $('chart'), chartLibrary = globalThis.echarts) {
  box.replaceChildren();
  if (!result.rows.length) {
    if (!['scalar', 'kpi_group', 'kpi_pair', 'table', 'pivot_table', 'comparison_table', 'sparkline_table'].includes(result.visualization)) {
      try {
        standardChartOption(result);
      } catch (_error) {
        return false;
      }
    }
    box.appendChild(Object.assign(document.createElement('p'), { className: 'notice warning', textContent: '該当する行はありませんでした。' }));
    return true;
  }
  if (result.visualization === 'scalar') {
    box.appendChild(Object.assign(document.createElement('div'), { className: 'metric', textContent: chartValue(result.rows[0][0], result.columns[0], true) }));
    return true;
  }
  if (['kpi_group', 'kpi_pair'].includes(result.visualization)) {
    return kpiGroup(result, box);
  }
  if (result.visualization === 'table') {
    return renderAdvancedResultTable(result, box);
  }
  if (result.visualization === 'pivot_table') {
    return renderPivotResultTable(result, box);
  }
  if (result.visualization === 'comparison_table') {
    return renderComparisonResultTable(result, box);
  }
  if (result.visualization === 'sparkline_table') {
    return renderSparklineResultTable(result, box, chartLibrary);
  }
  return renderStandardChart(result, box, chartLibrary);
}

export { graph };
