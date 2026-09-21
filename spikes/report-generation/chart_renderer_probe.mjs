#!/usr/bin/env node
import { createRequire } from 'node:module';
import { graph } from './chart_renderer_dispatch.js';

const require = createRequire(import.meta.url);
const echarts = require('./assets/echarts.min.js');
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_COLUMNS = 64;
const MAX_ROWS = 10_001;

class ElementStub {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.className = '';
    this.classList = { add: (...names) => { this.className += ` ${names.join(' ')}`; } };
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    this.textContent = '';
    this.value = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  createTHead() {
    return this.appended('thead');
  }

  createTBody() {
    return this.appended('tbody');
  }

  insertRow() {
    return this.appended('tr');
  }

  insertCell() {
    return this.appended('td');
  }

  requestFullscreen() {}

  appended(tag) {
    const child = new ElementStub(tag);
    this.append(child);
    return child;
  }
}

function validPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join(',') !== 'columns,rows,visualization') return false;
  if (typeof value.visualization !== 'string' || !value.visualization) return false;
  if (
    !Array.isArray(value.columns)
    || value.columns.length < 1
    || value.columns.length > MAX_COLUMNS
    || value.columns.some((column) => typeof column !== 'string' || !column)
  ) return false;
  return Array.isArray(value.rows)
    && value.rows.length <= MAX_ROWS
    && value.rows.every((row) =>
      Array.isArray(row)
      && row.length === value.columns.length
      && row.every((cell) => cell === null || ['boolean', 'number', 'string'].includes(typeof cell))
    );
}

function withoutDocument(callback) {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const documentStub = globalThis.document;
  globalThis.document = undefined;
  try {
    return callback();
  } finally {
    if (hadDocument) globalThis.document = documentStub;
    else delete globalThis.document;
  }
}

function svgChartLibrary(instances) {
  return new Proxy(echarts, {
    get(target, property) {
      if (property === 'init') {
        return (_host, theme, options = {}) => {
          const instance = withoutDocument(() => target.init(null, theme, {
            ...options,
            height: 480,
            renderer: 'svg',
            ssr: true,
            width: 800,
          }));
          instances.push(instance);
          return {
            dispose: () => instance.dispose(),
            resize() {},
            setOption(option, settings) {
              const svg = withoutDocument(() => {
                instance.setOption(option, settings);
                return instance.renderToSVGString();
              });
              if (typeof svg !== 'string' || !svg.startsWith('<svg')) {
                throw new Error('SVG rendering failed');
              }
            },
          };
        };
      }
      const member = Reflect.get(target, property);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function withoutConsole(callback) {
  const methods = ['error', 'log', 'warn'];
  const previous = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) console[method] = () => {};
  try {
    return callback();
  } finally {
    for (const method of methods) console[method] = previous[method];
  }
}

function render(result) {
  const instances = [];
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new ElementStub(tag),
    createTextNode: (value) => Object.assign(new ElementStub('#text'), { textContent: value }),
  };
  try {
    return withoutConsole(() =>
      graph(result, new ElementStub('div'), svgChartLibrary(instances)) === true
    );
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
    for (const instance of instances) {
      if (!instance.isDisposed?.()) instance.dispose();
    }
  }
}

async function readInput() {
  let bytes = 0;
  let input = '';
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_INPUT_BYTES) throw new Error('input too large');
    input += chunk;
  }
  return input;
}

try {
  const result = JSON.parse(await readInput());
  process.exitCode = validPayload(result) && render(result) ? 0 : 1;
} catch (_error) {
  process.exitCode = 2;
}
