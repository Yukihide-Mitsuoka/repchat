import {
  standardChartBase,
  standardChartFormat,
  standardChartNumber,
} from './chart_renderer_core.js';

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

export { standardDeltaOption };
