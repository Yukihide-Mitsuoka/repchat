import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { python } from './live-demo-test-helpers.ts';

test('live bar chart renders labels when DOM append returns undefined', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    onblur?: () => void;
    onfocus?: () => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const context = {
    document: { createElementNS: (_namespace: string, tag: string) => new ElementStub(tag) },
    $: () => chart,
    result: {
      rows: [
        ['organic', 120],
        ['cpc', 80],
      ],
      visualization: 'bar',
    },
  };
  assert.doesNotThrow(() =>
    vm.runInNewContext(`${functions}\ngraph(result); graph(result);`, context),
  );
  assert.equal(chart.children.length, 1);
  const svg = chart.children[0];
  assert.ok(svg);
  assert.deepEqual(
    svg.children.filter((child) => child.tag === 'text').map((child) => child.textContent),
    ['organic', '120', 'cpc', '80'],
  );
});
test('AI-planned Sankey result is validated and rendered as a diagram', () => {
  const classified = python(`
section={"title":"回遊","component":"sankey","planned_visualization":"sankey"}
print(m.dashboard_visualization(section,[("1. 入口: /", "2. /shop", 120), ("2. /shop", "3. /cart", 48)],["source", "target", "metric_value"]))
`);
  assert.equal(classified.status, 0, classified.stderr);
  assert.equal(classified.stdout.trim(), 'sankey');

  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    onblur?: () => void;
    onfocus?: () => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const secondChart = new ElementStub('div');
  const context = {
    document: {
      createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
      createElement: (tag: string) => new ElementStub(tag),
    },
    $: () => chart,
    result: {
      rows: [
        ['1. 入口: /', '2. /shop', 120],
        ['2. /shop', '3. /cart', 48],
        ['3. /cart', '4. /complete', 20],
      ],
      columns: ['source', 'target', 'sessions'],
      visualization: 'sankey',
      navigation_depth: 4,
    },
  };
  assert.doesNotThrow(() =>
    vm.runInNewContext(`${functions}\ngraph(result); graph(result, secondChart);`, {
      ...context,
      secondChart,
    }),
  );
  assert.equal(chart.children[0]?.tag, 'svg');
  assert.equal(secondChart.children[0]?.tag, 'svg');
  const tags = chart.children[0]?.children.map((child) => child.tag) ?? [];
  assert.ok(tags.includes('path'), 'Sankey links should be SVG paths');
  assert.ok(tags.includes('rect'), 'Sankey nodes should be SVG rectangles');
  const descendants = (element: ElementStub): ElementStub[] => [
    element,
    ...element.children.flatMap(descendants),
  ];
  const elements = descendants(chart.children[0]);
  const gradients = elements.filter((element) => element.tag === 'linearGradient');
  const links = elements.filter((element) => element.tag === 'path');
  const nodeColors = new Set(
    elements.filter((element) => element.tag === 'rect').map((element) => element.attributes.fill),
  );
  const linkStrokes = elements
    .filter((element) => element.tag === 'path')
    .map((element) => element.attributes.stroke);
  assert.equal(gradients.length, 3, 'each transition should have a color gradient');
  assert.ok(nodeColors.size >= 3, 'different page types should use different node colors');
  assert.ok(
    linkStrokes.every((stroke) => /^url\(#sankey-\d+-link-\d+\)$/.test(stroke ?? '')),
    'each transition should reference its own source-to-target gradient',
  );
  const sankeySvgs = [chart.children[0], secondChart.children[0]];
  const allGradientIds = sankeySvgs.flatMap((svg) =>
    descendants(svg)
      .filter((element) => element.tag === 'linearGradient')
      .map((element) => element.attributes.id),
  );
  assert.equal(
    new Set(allGradientIds).size,
    allGradientIds.length,
    'paint-server IDs must be unique across Sankey SVG instances in the same document',
  );
  for (const svg of sankeySvgs) {
    const localGradientIds = new Set(
      descendants(svg)
        .filter((element) => element.tag === 'linearGradient')
        .map((element) => element.attributes.id),
    );
    const localLinks = descendants(svg).filter((element) => element.tag === 'path');
    assert.ok(
      localLinks.every((link) => {
        const referencedId = link.attributes.stroke?.match(/^url\(#(.+)\)$/)?.[1];
        return referencedId !== undefined && localGradientIds.has(referencedId);
      }),
      'each link must reference a gradient defined in its own SVG',
    );
  }
  assert.deepEqual(
    elements
      .filter((element) => element.attributes.class === 'sankey-stage')
      .map((element) => element.textContent),
    ['入口', '2ページ目', '3ページ目', '4ページ目'],
  );
  assert.ok(links.every((link) => link.attributes.tabindex === '0'));
  assert.ok(links.every((link) => link.attributes['aria-label']?.includes('sessions')));
  assert.ok(
    links.every((link) => link.children.some((child) => child.tag === 'title')),
    'each transition should expose its value as an SVG tooltip',
  );
  const detail = chart.children.find((element) => element.className.includes('sankey-detail'));
  assert.ok(detail);
  links[0]?.onfocus?.();
  assert.match(detail.textContent, /\/ → \/shop: 120 sessions/);
  const terminal = chart.children.find((element) => element.className.includes('sankey-terminal'));
  assert.equal(terminal, undefined);
});

test('AI-authored Sankey keeps a bounded render contract without fixed navigation selection', () => {
  const result = python(`
panel={"id":"P1","title":"主要回遊","objective":"回遊を判断する","chart":"sankey","execution_prompt":"2021年1月のsourceからtargetへのsessionsを集計する","dimensions":["source","target"],"measures":["sessions"]}
section=m.planned_analysis_section(panel)
removed=["section_for_question","require_deterministic_navigation_order","require_complete_navigation_depth","validate_navigation_sankey"]
print(json.dumps({"component":section["component"],"planned":section["planned_visualization"],"verification":section["verification"],"rows":section["max_result_rows"],"pages":section["max_navigation_pages"],"requirements":" ".join(section["generation_requirements"]),"removed":all(not hasattr(m,name) for name in removed)},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(
    {
      component: value.component,
      planned: value.planned,
      verification: value.verification,
      rows: value.rows,
      pages: value.pages,
      removed: value.removed,
    },
    {
      component: 'sankey',
      planned: 'sankey',
      verification: 'execution',
      rows: 30,
      pages: 4,
      removed: true,
    },
  );
  assert.match(value.requirements, /source、target、metric_value/);
  assert.match(value.requirements, /最初の4ページ/);
  assert.match(value.requirements, /上位10経路/);
  assert.match(value.requirements, /LIMIT 30/);
});

test('multi-line charts always use one visible vertical scale per series', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /independent=seriesCount>1,/);
  assert.doesNotMatch(
    rendered.stdout,
    /Math\.max\(\.\.\.magnitudes\)\/Math\.min\(\.\.\.magnitudes\)>=100/,
  );
  assert.match(
    rendered.stdout,
    /系列ごとに独立した縦軸スケールで、各系列の期間内の変化を同じ高さに正規化しています。/,
  );
  assert.match(rendered.stdout, /class:"chart-axis-value"/);
  assert.match(rendered.stdout, /class:"chart-axis-title"/);
  assert.match(rendered.stdout, /metricAxisTitle\(r\.columns\[seriesIndex\+1\]\)/);
  assert.match(rendered.stdout, /購入金額.*USD/);
  assert.match(rendered.stdout, /購入件数.*件/);
  assert.match(rendered.stdout, /chartValue\(tickValue,r\.columns\[seriesIndex\+1\]\)/);
});
