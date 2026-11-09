/* dsh-file-link — static self-check.
 *
 * Loads lib/client.js in a stub environment shaped like the Harness browser
 * boot: `window.__ModuleLoader__.load`, a fake React, a fake `ctx` with the
 * services the plugin injects. It verifies the factory runs, `apply` registers
 * the settings section and the theme layer, and the click router resolves a
 * path without throwing.
 *
 * Run: node test/self-check.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../lib/client.js'), 'utf8');

// ── 最小 DOM stub ────────────────────────────────────────────────────
class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.nodeType = 1;
    this.attrs = new Map();
    this.style = {};
    this._text = '';
  }
  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  closest(selector) {
    let node = this;
    const cls = selector.replace(/^\./, '');
    while (node !== null) {
      if (node.className && String(node.className).split(/\s+/).includes(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll() {
    return [];
  }
  set textContent(value) {
    this._text = String(value);
  }
  get textContent() {
    return this._text;
  }
}

class StubText extends StubNode {
  constructor(text) {
    super('#text');
    this.nodeType = 3;
    this.nodeValue = String(text);
    this._text = String(text);
  }
}

const head = new StubNode('head');
const bodyEl = new StubNode('body');
const document = {
  head,
  body: bodyEl,
  createElement: (tag) => new StubNode(tag),
  createTextNode: (text) => new StubText(text),
  createDocumentFragment: () => new StubNode('#fragment'),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};

const loaded = [];
const window = {
  __ModuleLoader__: {
    load(entry) {
      loaded.push(entry);
    },
  },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
  },
  getSelection: () => ({ toString: () => '' }),
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id),
  document,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  document,
};

// React 只用到 createElement / useState / useEffect
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
};

globalThis.window = window;
globalThis.document = document;
globalThis.NodeFilter = window.NodeFilter;
globalThis.MutationObserver = window.MutationObserver;
globalThis.setTimeout = setTimeout;
globalThis.clearTimeout = clearTimeout;

// 执行 bundle
const factory = new Function('window', 'document', 'NodeFilter', 'MutationObserver', 'setTimeout', 'clearTimeout', source);
factory(window, document, window.NodeFilter, window.MutationObserver, setTimeout, clearTimeout);

assert.equal(loaded.length, 1, 'exactly one module registered');
assert.equal(loaded[0].id, 'dsh-file-link');

const mod = loaded[0].factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error(`unexpected require: ${name}`);
});

assert.equal(mod.name, 'dsh-file-link');
assert.ok(Array.isArray(mod.inject), 'inject is an array');
for (const needed of ['slots', 'sessions', 'remote.session', 'sidebarRight']) {
  assert.ok(mod.inject.includes(needed), `inject declares ${needed}`);
}

// ── ctx stub ─────────────────────────────────────────────────────────
const calls = { slots: [], theme: [], previews: [], opened: [] };

const ctx = {
  effect(fn) {
    const dispose = fn();
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  },
  // theme 是硬依赖：插件读 ctx.theme，不走 ctx.get('theme')
  theme: {
    overrideTokens(source, tokens) {
      calls.theme.push({ source, tokens });
      return () => {};
    },
  },
  get(name) {
    return undefined;
  },
  slots: {
    inject(owner, callback) {
      calls.slots.push(owner);
      callback();
    },
    register(options, component) {
      calls.slots.push(options);
      return () => {};
    },
  },
  sessions: {
    list: {
      getSnapshot() {
        return { byId: { s1: { cwd: 'X:\\proj', retainedBy: { mainView: 1 } } } };
      },
    },
  },
  remote: {
    session: {
      openWorkspacePath(request) {
        calls.opened.push(request);
        return Promise.resolve({ ok: true, value: { opened: true } });
      },
    },
  },
  sidebarRight: {
    openResource(url, options) {
      calls.previews.push({ url, options });
    },
  },
};

const dispose = ctx.effect(() => mod.apply(ctx));

assert.ok(calls.slots.includes('settings.section'), 'registers a settings section');
assert.ok(calls.slots.includes('conversation.composer.dock') === false, 'no stray slot');

// 强调色覆盖层：默认配置不覆盖，选预设后才覆盖
assert.equal(calls.theme.length, 0, 'default accent leaves the theme untouched');

// 触发一次配置变更（通过暴露的调试入口）
const api = window.__dshFileLink;
assert.ok(api && typeof api.match === 'function', 'debug entry exposed');
assert.equal(api.match('see src/a.ts here').length, 1, 'recognizer reachable from bundle');

api.update({ accentPreset: 'green' });
assert.equal(calls.theme.length, 1, 'accent preset applies a theme layer');
assert.equal(calls.theme[0].source, 'dsh-file-link');
assert.equal(
  calls.theme[0].tokens['--dsw-alias-state-business-primary'].light,
  '#0f9d6e',
  'the real accent token carries the preset light value',
);
assert.equal(
  calls.theme[0].tokens['--dsw-alias-brand-primary'].light,
  '#0f9d6e',
  'brand-primary is covered too so filled primary buttons follow',
);
// 静态色板也要覆盖，否则直接引用 --dsw-static-deepseek-* 的组件不变色
assert.equal(
  calls.theme[0].tokens['--dsw-static-deepseek-500'].light,
  '#0f9d6e',
  'static palette backing the accent is overridden as well',
);
assert.equal(
  calls.theme[0].tokens['--dsw-static-deepseek-400'].dark,
  '#34d399',
  'static dark entry follows the preset dark value',
);
// 每个 token 都必须是 {light, dark} 对，裸字符串会被 overrideTokens 拒绝
for (const [name, modes] of Object.entries(calls.theme[0].tokens)) {
  assert.equal(typeof modes.light, 'string', `${name} light is a string`);
  assert.equal(typeof modes.dark, 'string', `${name} dark is a string`);
}

// 自定义色
api.update({ accentPreset: 'custom', accentCustom: '#ff8800' });
assert.equal(calls.theme.length, 2, 'custom accent re-applies the layer');
assert.equal(calls.theme[1].tokens['--dsw-alias-state-business-primary'].dark, '#ff8800');
assert.equal(calls.theme[1].tokens['--dsw-static-deepseek-500'].light, '#ff8800');

// 非法自定义色回落到不覆盖
api.update({ accentPreset: 'custom', accentCustom: 'not-a-colour' });
assert.equal(calls.theme.length, 2, 'invalid custom colour does not stack a layer');

// 恢复默认
api.update({ accentPreset: 'default', accentCustom: '' });

dispose();
console.log('self-check ok');
