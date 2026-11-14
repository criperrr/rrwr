/**
 * RRWR (Rust-Ruffle WebComic Reader)
 * Milestone 4 & 3: Community Mod Engine, CommonJS Sandbox, ArchiveProxy,
 * editPage(page) Pipeline, VueHooks & Chatlog Localization (F17, F21)
 *
 * Exports window.RRWRModHooks (browser global) and CommonJS module.exports (Node/test environment).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Lightweight YAML & Path Helpers for Mod Sandbox
  // ---------------------------------------------------------------------------

  function cleanRelPath(relPath) {
    if (!relPath || typeof relPath !== 'string') return '';
    return relPath.replace(/^\.\//, '').replace(/^\/+/, '').trim();
  }

  function parseScalarYamlValue(rawVal) {
    const val = rawVal.replace(/\s+#.*$/, '').trim();
    if (val === '' || val === '~' || val === 'null' || val === 'Null' || val === 'NULL') return null;
    if (val === 'true' || val === 'True' || val === 'TRUE') return true;
    if (val === 'false' || val === 'False' || val === 'FALSE') return false;
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1);
    }
    if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
      try {
        return JSON.parse(val);
      } catch (_) {}
    }
    return val;
  }

  function yamlLineIndent(line) {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
  }

  function yamlIsIgnorable(line) {
    const t = line.trim();
    return t === '' || t.startsWith('#') || t === '---' || t === '...';
  }

  function splitYamlKeyVal(trimmed) {
    if (!trimmed) return null;
    if (trimmed[0] === '"' || trimmed[0] === "'") {
      const q = trimmed[0];
      let i = 1;
      while (i < trimmed.length) {
        if (trimmed[i] === '\\' && q === '"' && i + 1 < trimmed.length) {
          i += 2;
          continue;
        }
        if (trimmed[i] === q) {
          i++;
          break;
        }
        i++;
      }
      const rest = trimmed.slice(i).trimStart();
      if (rest.startsWith(':') && (rest.length === 1 || /\s/.test(rest[1]))) {
        return [trimmed.slice(1, i - 1), rest.slice(1).trim()];
      }
      return null;
    }
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === ':' && (i + 1 === trimmed.length || /\s/.test(trimmed[i + 1]))) {
        return [trimmed.slice(0, i).trim(), trimmed.slice(i + 1).trim()];
      }
    }
    return null;
  }

  function endsWithUnescapedQuote(str) {
    if (!str || str[str.length - 1] !== '"') return false;
    let bs = 0;
    let i = str.length - 1;
    while (i > 0 && str[i - 1] === '\\') {
      bs++;
      i--;
    }
    return bs % 2 === 0;
  }

  function unescapeYamlDoubleQuoted(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\\' && i + 1 < str.length) {
        const next = str[i + 1];
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === '"') out += '"';
        else if (next === '\\') out += '\\';
        else if (next === '/') out += '/';
        else out += '\\' + next;
        i++;
      } else {
        out += str[i];
      }
    }
    return out;
  }

  /**
   * Parses JSON-compatible YAML or standard flat/nested key-value & fancomic story.yaml used by mods.
   */
  function parseSimpleYaml(text) {
    if (!text || typeof text !== 'string') return {};
    const trimmed = text.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch (_) {}

    const lines = text.split(/\r?\n/);
    const cursor = { idx: 0 };

    function skipIgnorable() {
      while (cursor.idx < lines.length && yamlIsIgnorable(lines[cursor.idx])) {
        cursor.idx++;
      }
    }

    function parseNode(minIndent) {
      skipIgnorable();
      if (cursor.idx >= lines.length) return null;
      const indent = yamlLineIndent(lines[cursor.idx]);
      if (indent < minIndent) return null;
      const t = lines[cursor.idx].trimStart();
      if (t === '-' || t.startsWith('- ')) {
        return parseSeq(indent);
      }
      return parseMap(indent);
    }

    function parseMap(baseIndent) {
      const map = {};
      while (cursor.idx < lines.length) {
        skipIgnorable();
        if (cursor.idx >= lines.length) break;
        const line = lines[cursor.idx];
        const indent = yamlLineIndent(line);
        const t = line.trimStart();
        if (indent < baseIndent || t === '-' || t.startsWith('- ')) break;
        const kv = splitYamlKeyVal(t);
        if (kv) {
          cursor.idx++;
          map[kv[0]] = parseValue(kv[1], indent);
        } else {
          cursor.idx++;
        }
      }
      return map;
    }

    function parseSeq(seqIndent) {
      const arr = [];
      while (cursor.idx < lines.length) {
        skipIgnorable();
        if (cursor.idx >= lines.length) break;
        const line = lines[cursor.idx];
        const indent = yamlLineIndent(line);
        const t = line.trimStart();
        if (indent !== seqIndent || !(t === '-' || t.startsWith('- '))) break;
        const rest = t.slice(1).trimStart();
        const itemIndent = indent + 2;
        if (!rest) {
          cursor.idx++;
          arr.push(parseNode(indent + 1));
        } else {
          const kv = splitYamlKeyVal(rest);
          if (kv) {
            const itemMap = {};
            cursor.idx++;
            itemMap[kv[0]] = parseValue(kv[1], itemIndent);
            while (cursor.idx < lines.length) {
              skipIgnorable();
              if (cursor.idx >= lines.length) break;
              const subLine = lines[cursor.idx];
              const subIndent = yamlLineIndent(subLine);
              const subT = subLine.trimStart();
              if (subIndent < itemIndent || subT === '-' || subT.startsWith('- ')) break;
              const skv = splitYamlKeyVal(subT);
              if (skv) {
                cursor.idx++;
                itemMap[skv[0]] = parseValue(skv[1], subIndent);
              } else {
                cursor.idx++;
              }
            }
            arr.push(itemMap);
          } else {
            cursor.idx++;
            arr.push(parseValue(rest, itemIndent));
          }
        }
      }
      return arr;
    }

    function parseValue(valStr, keyIndent) {
      const v = valStr.trim();
      if (!v) {
        let peek = cursor.idx;
        while (peek < lines.length && yamlIsIgnorable(lines[peek])) peek++;
        if (peek < lines.length) {
          const nextIndent = yamlLineIndent(lines[peek]);
          const nextT = lines[peek].trimStart();
          if (nextIndent > keyIndent) {
            cursor.idx = peek;
            return parseNode(nextIndent);
          }
          if (nextIndent === keyIndent && (nextT === '-' || nextT.startsWith('- '))) {
            cursor.idx = peek;
            return parseSeq(nextIndent);
          }
        }
        return null;
      }

      if (v === '|' || v === '|-' || v === '|+' || v === '>' || v === '>-' || v === '>+') {
        const chompStrip = v.endsWith('-');
        const blockLines = [];
        let blockIndent = null;
        while (cursor.idx < lines.length) {
          const line = lines[cursor.idx];
          if (line.trim() === '') {
            blockLines.push('');
            cursor.idx++;
            continue;
          }
          const ind = yamlLineIndent(line);
          if (blockIndent !== null) {
            if (ind < blockIndent && ind <= keyIndent) break;
          } else if (ind <= keyIndent) {
            break;
          } else {
            blockIndent = ind;
          }
          blockLines.push(line.slice(blockIndent));
          cursor.idx++;
        }
        if (chompStrip) {
          while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
            blockLines.pop();
          }
        }
        return blockLines.join('\n');
      }

      if (v.startsWith('"')) {
        let combined = v.slice(1);
        while (!endsWithUnescapedQuote(combined) && cursor.idx < lines.length) {
          const nextLine = lines[cursor.idx].trim();
          cursor.idx++;
          if (!combined.endsWith(' ') && nextLine) combined += ' ';
          combined += nextLine;
        }
        if (combined.endsWith('"')) combined = combined.slice(0, -1);
        return unescapeYamlDoubleQuoted(combined);
      }

      if (v.startsWith("'")) {
        let combined = v.slice(1);
        while (!combined.endsWith("'") && cursor.idx < lines.length) {
          const nextLine = lines[cursor.idx].trim();
          cursor.idx++;
          if (!combined.endsWith(' ') && nextLine) combined += ' ';
          combined += nextLine;
        }
        if (combined.endsWith("'")) combined = combined.slice(0, -1);
        return combined.replace(/''/g, "'");
      }

      return parseScalarYamlValue(v);
    }

    skipIgnorable();
    if (cursor.idx >= lines.length) return {};
    const parsed = parseNode(yamlLineIndent(lines[cursor.idx]));
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function createSafePathShim() {
    function normalize(p) {
      if (typeof p !== 'string') return '';
      const isAbs = p.startsWith('/');
      const parts = p.split('/');
      const stack = [];
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        if (!seg || seg === '.') continue;
        if (seg === '..') {
          if (stack.length > 0 && stack[stack.length - 1] !== '..') {
            stack.pop();
          } else if (!isAbs) {
            stack.push('..');
          }
        } else {
          stack.push(seg);
        }
      }
      const joined = stack.join('/');
      return isAbs ? '/' + joined : (joined || '.');
    }

    function join(...segments) {
      const filtered = segments.filter((s) => typeof s === 'string' && s.length > 0);
      if (filtered.length === 0) return '.';
      return normalize(filtered.join('/'));
    }

    function dirname(p) {
      if (typeof p !== 'string' || !p) return '.';
      const norm = normalize(p);
      const idx = norm.lastIndexOf('/');
      if (idx === -1) return '.';
      if (idx === 0) return '/';
      return norm.slice(0, idx);
    }

    function basename(p, ext) {
      if (typeof p !== 'string' || !p) return '';
      const norm = normalize(p);
      const idx = norm.lastIndexOf('/');
      let base = idx === -1 ? norm : norm.slice(idx + 1);
      if (ext && base.endsWith(ext)) {
        base = base.slice(0, base.length - ext.length);
      }
      return base;
    }

    function extname(p) {
      const base = basename(p);
      const idx = base.lastIndexOf('.');
      return idx <= 0 ? '' : base.slice(idx);
    }

    const posixShim = {
      sep: '/',
      delimiter: ':',
      normalize,
      join,
      resolve: (...args) => join(...args),
      dirname,
      basename,
      extname
    };
    posixShim.posix = posixShim;
    return posixShim;
  }

  const SAFE_PATH_SHIM = createSafePathShim();

  // ---------------------------------------------------------------------------
  // Mod API Sandbox & Throttled Logger Guard (F17)
  // ---------------------------------------------------------------------------

  /**
   * Creates a safe sandbox `api` object conforming to the RRWR mod standard,
   * with a rate-limited/no-op logger, scoped `store`, sync/async file readers,
   * and `Resources` protocol helper.
   *
   * @param {object} [options={}] - Optional sandbox configuration
   * @param {string} [options.modId='unknown_mod'] - Mod identifier
   * @param {number} [options.maxLogs=25] - Maximum number of logs before silencing
   * @param {object} [options.jsonStore={}] - Pre-loaded JSON files keyed by relative path
   * @param {object} [options.textStore={}] - Pre-loaded text files keyed by relative path
   * @param {object} [options.fileCache={}] - Pre-loaded raw file cache keyed by relative path
   * @param {object} [options.storeData] - Initial mod store key-values
   * @param {object} [options.modSettings] - Map of modSettings[modId] or direct store map
   * @param {Function} [options.onStoreWrite] - Callback `(modId, key, value)` when store mutates
   * @param {Function} [options.ipcInvoke] - Optional IPC invoker `(cmd, args) => Promise`
   * @param {string} [options.assetBase=''] - Base URL for `assets://` resolution
   * @returns {object} Sandbox environment with { api, installConsoleThrottle, runWithThrottledConsole, fileCache, storeData }
   */
  function createModApiSandbox(options) {
    const opts = options || {};
    const modId = opts.modId || opts.id || 'unknown_mod';
    const maxLogs = typeof opts.maxLogs === 'number' ? opts.maxLogs : 25;
    const jsonStore = Object.assign({}, opts.jsonStore || {});
    const textStore = Object.assign({}, opts.textStore || {});
    const fileCache = Object.assign({}, textStore, opts.fileCache || {});
    const ipcInvoke = typeof opts.ipcInvoke === 'function' ? opts.ipcInvoke : null;
    const assetBase = typeof opts.assetBase === 'string' ? opts.assetBase.replace(/\/+$/, '') : '';

    // Initialize storeData from opts.storeData or opts.modSettings[modId]
    let initialStore = {};
    if (opts.storeData && typeof opts.storeData === 'object') {
      initialStore = Object.assign({}, opts.storeData);
    } else if (opts.modSettings && typeof opts.modSettings === 'object') {
      if (opts.modId && opts.modSettings[opts.modId] && typeof opts.modSettings[opts.modId] === 'object') {
        initialStore = Object.assign({}, opts.modSettings[opts.modId]);
      } else if (!opts.modId) {
        initialStore = Object.assign({}, opts.modSettings);
      }
    }

    // Default hideOriginalLink to true for timeline/POV mods to prevent duplicate advance buttons
    const normalizedModId = String(modId).toLowerCase();
    if (normalizedModId.includes('timeline') && initialStore.hideOriginalLink === undefined) {
      initialStore.hideOriginalLink = true;
    }
    const storeData = initialStore;
    const storeListeners = {};

    const onStoreWrite = typeof opts.onStoreWrite === 'function'
      ? opts.onStoreWrite
      : (mId, k, v) => {
          if (ipcInvoke) {
            try {
              Promise.resolve(ipcInvoke('save_mod_setting', { modId: mId, mod_id: mId, key: k, value: v })).catch(() => {});
            } catch (_) {}
          }
        };

    let callCount = 0;
    let suppressedCount = 0;

    function safeLog(level, ...args) {
      callCount += 1;
      if (callCount <= maxLogs) {
        if (typeof console !== 'undefined' && typeof console[level] === 'function') {
          console[level](...args);
        }
      } else {
        suppressedCount += 1;
        if (callCount === maxLogs + 1) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(`[RRWRModHooks] Rate-limiting excessive mod logs (> ${maxLogs} calls). Further logs suppressed.`);
          }
        }
      }
    }

    const logger = {
      info: (...args) => safeLog('info', ...args),
      log: (...args) => safeLog('log', ...args),
      warn: (...args) => safeLog('warn', ...args),
      error: (...args) => safeLog('error', ...args),
      debug: (...args) => safeLog('debug', ...args),
      getStats: () => ({ totalCalls: callCount, suppressedCalls: suppressedCount }),
      resetStats: () => {
        callCount = 0;
        suppressedCount = 0;
      }
    };

    function notifyStoreListeners(key, newVal, oldVal) {
      const cbs = storeListeners[key];
      if (Array.isArray(cbs)) {
        for (let i = 0; i < cbs.length; i++) {
          try {
            cbs[i](newVal, oldVal);
          } catch (_) {}
        }
      }
    }

    const store = {
      set(k, v) {
        const key = String(k);
        const oldVal = storeData[key];
        storeData[key] = v;
        notifyStoreListeners(key, v, oldVal);
        try {
          onStoreWrite(modId, key, v);
        } catch (_) {}
        return v;
      },
      get(k, default_) {
        const key = String(k);
        if (Object.prototype.hasOwnProperty.call(storeData, key) && storeData[key] !== undefined) {
          return storeData[key];
        }
        if (key === 'hideOriginalLink') {
          return true;
        }
        return default_;
      },
      has(k) {
        const key = String(k);
        return Object.prototype.hasOwnProperty.call(storeData, key) && storeData[key] !== undefined;
      },
      delete(k) {
        const key = String(k);
        const oldVal = storeData[key];
        delete storeData[key];
        notifyStoreListeners(key, undefined, oldVal);
        try {
          onStoreWrite(modId, key, null);
        } catch (_) {}
      },
      onDidChange(k, cb) {
        const key = String(k);
        if (typeof cb !== 'function') return () => {};
        if (!Array.isArray(storeListeners[key])) {
          storeListeners[key] = [];
        }
        storeListeners[key].push(cb);
        return function unsubscribe() {
          const idx = storeListeners[key].indexOf(cb);
          if (idx !== -1) storeListeners[key].splice(idx, 1);
        };
      },
      clear() {
        const keys = Object.keys(storeData);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const oldVal = storeData[k];
          delete storeData[k];
          notifyStoreListeners(k, undefined, oldVal);
        }
      }
    };

    function readText(relPath) {
      if (!relPath || typeof relPath !== 'string') return '';
      const clean = cleanRelPath(relPath);
      if (Object.prototype.hasOwnProperty.call(fileCache, clean) && typeof fileCache[clean] === 'string') {
        return fileCache[clean];
      }
      if (Object.prototype.hasOwnProperty.call(fileCache, relPath) && typeof fileCache[relPath] === 'string') {
        return fileCache[relPath];
      }
      if (Object.prototype.hasOwnProperty.call(textStore, clean) && typeof textStore[clean] === 'string') {
        return textStore[clean];
      }
      if (Object.prototype.hasOwnProperty.call(textStore, relPath) && typeof textStore[relPath] === 'string') {
        return textStore[relPath];
      }
      if (Object.prototype.hasOwnProperty.call(jsonStore, clean)) {
        return typeof jsonStore[clean] === 'string' ? jsonStore[clean] : JSON.stringify(jsonStore[clean]);
      }
      if (Object.prototype.hasOwnProperty.call(jsonStore, relPath)) {
        return typeof jsonStore[relPath] === 'string' ? jsonStore[relPath] : JSON.stringify(jsonStore[relPath]);
      }
      return '';
    }

    function readFile(relPath) {
      return readText(relPath);
    }

    function readJson(relPath) {
      if (!relPath || typeof relPath !== 'string') return {};
      const clean = cleanRelPath(relPath);
      if (jsonStore[clean] && typeof jsonStore[clean] === 'object') return jsonStore[clean];
      if (jsonStore[relPath] && typeof jsonStore[relPath] === 'object') return jsonStore[relPath];
      const txt = readText(relPath);
      if (txt) {
        try {
          const parsed = JSON.parse(txt);
          jsonStore[clean] = parsed;
          return parsed;
        } catch (_) {}
      }
      return {};
    }

    function readYaml(relPath) {
      if (!relPath || typeof relPath !== 'string') return {};
      const clean = cleanRelPath(relPath);
      if (jsonStore[clean] && typeof jsonStore[clean] === 'object') return jsonStore[clean];
      if (jsonStore[relPath] && typeof jsonStore[relPath] === 'object') return jsonStore[relPath];
      const txt = readText(relPath);
      if (txt) {
        const parsed = parseSimpleYaml(txt);
        jsonStore[clean] = parsed;
        return parsed;
      }
      return {};
    }

    async function ensureFileCached(relPath) {
      if (!relPath || typeof relPath !== 'string') return;
      const clean = cleanRelPath(relPath);
      const alreadyPresent =
        Object.prototype.hasOwnProperty.call(fileCache, clean) ||
        Object.prototype.hasOwnProperty.call(fileCache, relPath) ||
        Object.prototype.hasOwnProperty.call(textStore, clean) ||
        Object.prototype.hasOwnProperty.call(textStore, relPath) ||
        Object.prototype.hasOwnProperty.call(jsonStore, clean) ||
        Object.prototype.hasOwnProperty.call(jsonStore, relPath);

      if (!alreadyPresent && ipcInvoke) {
        try {
          const fetched = await ipcInvoke('read_mod_file', {
            modId: modId,
            mod_id: modId,
            path: relPath,
            relPath: relPath
          });
          if (typeof fetched === 'string') {
            fileCache[clean] = fetched;
            textStore[clean] = fetched;
          } else if (fetched && typeof fetched === 'object') {
            if (fetched.json && typeof fetched.json === 'object') {
              jsonStore[clean] = fetched.json;
            }
            if (typeof fetched.content === 'string') {
              fileCache[clean] = fetched.content;
              textStore[clean] = fetched.content;
            } else if (typeof fetched.data === 'string') {
              fileCache[clean] = fetched.data;
              textStore[clean] = fetched.data;
            } else if (!fetched.json) {
              jsonStore[clean] = fetched;
            }
          }
        } catch (_) {}
      }
    }

    async function readFileAsync(relPath, cb) {
      await ensureFileCached(relPath);
      const res = readFile(relPath);
      if (typeof cb === 'function') cb(res);
      return res;
    }

    async function readTextAsync(relPath, cb) {
      await ensureFileCached(relPath);
      const res = readText(relPath);
      if (typeof cb === 'function') cb(res);
      return res;
    }

    async function readJsonAsync(relPath, cb) {
      await ensureFileCached(relPath);
      const res = readJson(relPath);
      if (typeof cb === 'function') cb(res);
      return res;
    }

    async function readYamlAsync(relPath, cb) {
      await ensureFileCached(relPath);
      const res = readYaml(relPath);
      if (typeof cb === 'function') cb(res);
      return res;
    }

    function resolveAssetsProtocol(url) {
      if (!url || typeof url !== 'string') return '';
      const trimmed = url.trim();
      if (trimmed.startsWith('assets://')) {
        const rest = trimmed.slice('assets://'.length).replace(/^\/+/, '');
        return `${assetBase}/assets/${rest}`;
      }
      return trimmed;
    }

    const Resources = {
      resolveAssetsProtocol,
      resolveURL: resolveAssetsProtocol
    };

    const api = {
      logger,
      store,
      readFile,
      readText,
      readJson,
      readYaml,
      readFileAsync,
      readTextAsync,
      readJsonAsync,
      readYamlAsync,
      Resources
    };

    /**
     * Temporarily throttles global console methods.
     * Returns a restore function that reinstates the original console methods.
     */
    function installConsoleThrottle(customLimit = maxLogs) {
      if (typeof console === 'undefined') return () => {};
      const origLog = console.log;
      const origInfo = console.info;
      const origWarn = console.warn;
      const origError = console.error;
      const origDebug = console.debug;

      let loopCount = 0;

      function throttledMethod(orig, ...args) {
        loopCount += 1;
        if (loopCount <= customLimit) {
          orig.apply(console, args);
        } else if (loopCount === customLimit + 1) {
          origWarn.call(console, `[RRWRModHooks] Suppressing console output (> ${customLimit} statements in loop)...`);
        }
      }

      console.log = (...args) => throttledMethod(origLog, ...args);
      console.info = (...args) => throttledMethod(origInfo, ...args);
      console.debug = (...args) => throttledMethod(origDebug, ...args);
      console.warn = (...args) => throttledMethod(origWarn, ...args);
      console.error = (...args) => throttledMethod(origError, ...args);

      return function restore() {
        console.log = origLog;
        console.info = origInfo;
        console.debug = origDebug;
        console.warn = origWarn;
        console.error = origError;
      };
    }

    /**
     * Runs a function while protecting the runtime from console flooding.
     */
    function runWithThrottledConsole(fn, customLimit) {
      const restore = installConsoleThrottle(customLimit);
      try {
        return fn(api);
      } finally {
        restore();
      }
    }

    return {
      api,
      storeData,
      fileCache,
      installConsoleThrottle,
      runWithThrottledConsole
    };
  }

  // ---------------------------------------------------------------------------
  // CommonJS Mod Evaluator with Shadowed Tauri Globals (F17)
  // ---------------------------------------------------------------------------

  const FallbackAudioMock = class AudioMock {
    constructor(src) {
      this.src = src || '';
      this.currentTime = 0;
      this.duration = 0;
      this.paused = true;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };

  const FallbackImageMock = class ImageMock {
    constructor(width, height) {
      this.src = '';
      this.width = width || 0;
      this.height = height || 0;
      this.complete = true;
    }
    addEventListener() {}
    removeEventListener() {}
  };

  const FallbackDocumentMock = {
    implementation: {
      createHTMLDocument(title) {
        return {
          title: title || '',
          body: { innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; } },
          createElement(tag) {
            return {
              tagName: String(tag).toUpperCase(),
              style: {},
              children: [],
              childNodes: [],
              appendChild() {},
              setAttribute() {},
              getAttribute() { return null; },
              querySelector() { return null; },
              querySelectorAll() { return []; },
              innerHTML: ''
            };
          }
        };
      }
    },
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        style: {},
        children: [],
        childNodes: [],
        appendChild() {},
        setAttribute() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        innerHTML: ''
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  function getAudioConstructor() {
    if (typeof root !== 'undefined' && root && root.Audio) return root.Audio;
    if (typeof globalThis !== 'undefined' && globalThis && globalThis.Audio) return globalThis.Audio;
    return FallbackAudioMock;
  }

  function getImageConstructor() {
    if (typeof root !== 'undefined' && root && root.Image) return root.Image;
    if (typeof globalThis !== 'undefined' && globalThis && globalThis.Image) return globalThis.Image;
    return FallbackImageMock;
  }

  function getDocumentConstructor() {
    if (typeof root !== 'undefined' && root && root.document) return root.document;
    if (typeof globalThis !== 'undefined' && globalThis && globalThis.document) return globalThis.document;
    if (typeof document !== 'undefined') return document;
    return FallbackDocumentMock;
  }

  function createSafeWindowProxy() {
    const baseTarget = typeof root !== 'undefined' && root ? root : {};
    let proxyRef = null;

    proxyRef = new Proxy(baseTarget, {
      get(target, prop) {
        if (prop === '__TAURI__' || prop === '__TAURI_INTERNALS__') {
          return undefined;
        }
        if (prop === 'window' || prop === 'globalThis' || prop === 'self') {
          return proxyRef;
        }
        if (prop === 'document') {
          return getDocumentConstructor();
        }
        if (prop === 'Audio') {
          return getAudioConstructor();
        }
        if (prop === 'Image') {
          return getImageConstructor();
        }
        const val = target[prop];
        if (typeof val === 'function') {
          // Preserve constructors like DOMParser, MutationObserver, Element, etc.
          if (val.prototype && (Object.getOwnPropertyNames(val.prototype).length > 1 || /^[A-Z]/.test(String(prop)))) {
            return val;
          }
          return val.bind(target);
        }
        return val;
      },
      has(target, prop) {
        if (prop === '__TAURI__' || prop === '__TAURI_INTERNALS__') {
          return false;
        }
        if (prop === 'Audio' || prop === 'Image' || prop === 'document') {
          return true;
        }
        return prop in target;
      }
    });

    return proxyRef;
  }

  function safeModRequire(modName) {
    if (modName === 'path' || modName === 'node:path') {
      return SAFE_PATH_SHIM;
    }
    return {};
  }

  /**
   * Evaluates a community mod's CommonJS code inside an isolated scope with
   * `__TAURI__` and `__TAURI_INTERNALS__` shadowed as `undefined` while preserving
   * `document` (including `document.implementation.createHTMLDocument` and `DOMParser`).
   *
   * @param {string} modId - Mod identifier
   * @param {string} rawCode - Raw JavaScript code of mod.js
   * @param {object} [sandboxOpts={}] - Options passed to createModApiSandbox (or existing sandbox)
   * @returns {Promise<object>} Resolved modExports object
   */
  async function evaluateModModule(modId, rawCode, sandboxOpts) {
    const opts = Object.assign({}, sandboxOpts || {}, { modId: modId || (sandboxOpts && sandboxOpts.modId) || 'unknown_mod' });
    const sandbox = (opts.api && typeof opts.runWithThrottledConsole === 'function')
      ? opts
      : createModApiSandbox(opts);

    const moduleObj = { exports: {} };
    const exportsObj = moduleObj.exports;
    const safeWindow = createSafeWindowProxy();

    if (typeof rawCode === 'string' && rawCode.trim() !== '') {
      // Pre-warm synchronous api.readFile / readText / readJson / readYaml calls
      // (skipping translation2.json which is loaded natively by Rust StoryStore)
      if (sandbox.api && typeof sandbox.api.readFileAsync === 'function') {
        const syncReadRe = /\b(?:api\s*\.\s*)?read(?:File|Text|Json|Yaml)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
        let match;
        while ((match = syncReadRe.exec(rawCode)) !== null) {
          const rel = match[1];
          if (rel && !rel.endsWith('translation2.json')) {
            try {
              await sandbox.api.readFileAsync(rel);
            } catch (_) {}
          }
        }
      }

      const factory = new Function(
        'module',
        'exports',
        'require',
        'api',
        'window',
        'globalThis',
        'Audio',
        'Image',
        'document',
        '__TAURI__',
        '__TAURI_INTERNALS__',
        `{\n${rawCode}\n}`
      );

      sandbox.runWithThrottledConsole(() => {
        factory(
          moduleObj,
          exportsObj,
          safeModRequire,
          sandbox.api,
          safeWindow,
          safeWindow,
          getAudioConstructor(),
          getImageConstructor(),
          getDocumentConstructor(),
          undefined,
          undefined
        );
      });
    }

    const modExports = (moduleObj.exports && typeof moduleObj.exports === 'object')
      ? moduleObj.exports
      : exportsObj;

    // 1. Synchronous computed(api)
    if (typeof modExports.computed === 'function') {
      const computedResult = sandbox.runWithThrottledConsole(() => modExports.computed(sandbox.api));
      if (computedResult && typeof computedResult === 'object') {
        Object.assign(modExports, computedResult);
      }
    }

    // 2. Asynchronous asyncComputed(api)
    if (typeof modExports.asyncComputed === 'function') {
      const asyncResult = await modExports.asyncComputed(sandbox.api);
      if (asyncResult && typeof asyncResult === 'object') {
        Object.assign(modExports, asyncResult);
      }
    }

    // 3. Warn and gracefully ignore unsupported V1 keys
    const unsupportedV1Keys = ['browserPages', 'browserActions', 'browserToolbars'];
    for (let i = 0; i < unsupportedV1Keys.length; i++) {
      const key = unsupportedV1Keys[i];
      if (Object.prototype.hasOwnProperty.call(modExports, key) && modExports[key] !== undefined) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[RRWRModHooks] Unsupported V1 key ignored in mod ' + modId + ':', key);
        }
      }
    }

    Object.defineProperty(modExports, '_sandbox', {
      value: sandbox,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(modExports, '_api', {
      value: sandbox.api,
      enumerable: false,
      configurable: true
    });

    return modExports;
  }

  // ---------------------------------------------------------------------------
  // Memory-Bounded ArchiveProxy & Diff Extractor (<150MB RSS SLA)
  // ---------------------------------------------------------------------------

  const IS_PERMISSIVE_PROXY = Symbol('isPermissiveProxy');

  function createPermissiveTreeProxy(initialTarget) {
    if (initialTarget && initialTarget[IS_PERMISSIVE_PROXY]) {
      return initialTarget;
    }

    const isArray = Array.isArray(initialTarget);
    const targetObj = initialTarget && typeof initialTarget === 'object' ? initialTarget : (isArray ? [] : {});

    const proxy = new Proxy(targetObj, {
      get(target, prop) {
        if (prop === IS_PERMISSIVE_PROXY) return true;
        if (typeof prop === 'symbol') return target[prop];
        if (prop === 'toJSON') return () => target;

        // Array methods fallback if called on an auto-vivified or array container
        if (prop === 'push') {
          return function (...items) {
            if (Array.isArray(target)) return target.push(...items);
            if (!Array.isArray(target.items)) target.items = [];
            return target.items.push(...items);
          };
        }
        if (prop === 'unshift') {
          return function (...items) {
            if (Array.isArray(target)) return target.unshift(...items);
            if (!Array.isArray(target.items)) target.items = [];
            return target.items.unshift(...items);
          };
        }
        if (prop === 'shift') {
          return function () {
            if (Array.isArray(target)) return target.shift();
            return createPermissiveTreeProxy({});
          };
        }
        if (prop === 'pop') {
          return function () {
            if (Array.isArray(target)) return target.pop();
            return createPermissiveTreeProxy({});
          };
        }
        if (prop === 'splice') {
          return function (start, deleteCount, ...items) {
            if (Array.isArray(target)) return target.splice(start, deleteCount, ...items);
            return [createPermissiveTreeProxy({})];
          };
        }
        if (prop === 'find') {
          return function (predicate) {
            if (Array.isArray(target)) {
              const found = target.find(predicate);
              if (found !== undefined) return (typeof found === 'object' && found !== null) ? createPermissiveTreeProxy(found) : found;
            }
            // Return a safe auto-vivifying object with .html fallback
            return createPermissiveTreeProxy({ id: '', html: '' });
          };
        }
        if (prop === 'filter') {
          return function (predicate) {
            if (Array.isArray(target)) return target.filter(predicate).map(x => (typeof x === 'object' && x !== null) ? createPermissiveTreeProxy(x) : x);
            return [];
          };
        }
        if (prop === 'forEach') {
          return function (fn) {
            if (Array.isArray(target)) target.forEach(fn);
          };
        }
        if (prop === 'map') {
          return function (fn) {
            if (Array.isArray(target)) return target.map(fn);
            return [];
          };
        }
        if (prop === 'includes') {
          return function (val) {
            if (Array.isArray(target)) return target.includes(val);
            return false;
          };
        }
        if (prop === 'length') {
          if (Array.isArray(target)) return target.length;
          return Object.keys(target).length;
        }

        // Auto-vivify or ensure child is wrapped in permissive proxy
        if (!(prop in target) || target[prop] === undefined) {
          if (prop === 'html' || prop === 'content' || prop === 'title' || prop === 'text' || prop === 'src' || prop === 'body' || prop === 'url') {
            target[prop] = '';
          } else if (prop === 'urls') {
            target[prop] = new Proxy([''], {
              get(arrTarget, arrProp) {
                if (typeof arrProp === 'symbol') return arrTarget[arrProp];
                if (arrProp in arrTarget) return arrTarget[arrProp];
                if (/^\d+$/.test(String(arrProp))) return '';
                return arrTarget[arrProp];
              }
            });
          } else {
            target[prop] = createPermissiveTreeProxy({});
          }
        } else if (typeof target[prop] === 'object' && target[prop] !== null && !target[prop][IS_PERMISSIVE_PROXY]) {
          target[prop] = createPermissiveTreeProxy(target[prop]);
        }
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });

    return proxy;
  }

  function mergeFootnotesInto(targetFootnotes, rawFootnotes, defaultAuthor) {
    if (!rawFootnotes) return targetFootnotes;

    const addNote = (pageId, noteObj, fallbackAuthor, fallbackPreface, fallbackClass) => {
      if (!pageId || noteObj == null) return;
      const pid = String(pageId).trim();
      if (!pid) return;
      if (!Array.isArray(targetFootnotes[pid])) {
        targetFootnotes[pid] = [];
      }
      if (typeof noteObj === 'string') {
        const item = {
          content: noteObj,
          author: fallbackAuthor || defaultAuthor || '',
          preface: Boolean(fallbackPreface)
        };
        if (fallbackClass) item.class = String(fallbackClass);
        targetFootnotes[pid].push(item);
      } else if (typeof noteObj === 'object') {
        const item = {
          content: String(noteObj.content ?? noteObj.text ?? noteObj.note ?? ''),
          author: String(noteObj.author ?? fallbackAuthor ?? defaultAuthor ?? ''),
          preface: Boolean(noteObj.preface ?? fallbackPreface)
        };
        const noteClass = noteObj.class || fallbackClass;
        if (noteClass) item.class = String(noteClass);
        targetFootnotes[pid].push(item);
      }
    };

    const mergeStoryMap = (storyMap, groupAuthor, groupPreface, groupClass) => {
      if (!storyMap || typeof storyMap !== 'object') return;
      const pageIds = Object.keys(storyMap);
      for (let i = 0; i < pageIds.length; i++) {
        const pid = pageIds[i];
        const entry = storyMap[pid];
        if (Array.isArray(entry)) {
          for (let j = 0; j < entry.length; j++) {
            addNote(pid, entry[j], groupAuthor, groupPreface, groupClass);
          }
        } else if (entry) {
          addNote(pid, entry, groupAuthor, groupPreface, groupClass);
        }
      }
    };

    if (Array.isArray(rawFootnotes)) {
      for (let i = 0; i < rawFootnotes.length; i++) {
        const item = rawFootnotes[i];
        if (!item || typeof item !== 'object') continue;
        const groupAuthor = item.author !== undefined ? item.author : (defaultAuthor || '');
        const groupPreface = Boolean(item.preface);
        const groupClass = item.class || undefined;
        if (item.story && typeof item.story === 'object') {
          mergeStoryMap(item.story, groupAuthor, groupPreface, groupClass);
        } else {
          mergeStoryMap(item, groupAuthor, groupPreface, groupClass);
        }
      }
    } else if (typeof rawFootnotes === 'object') {
      if (rawFootnotes.story && typeof rawFootnotes.story === 'object') {
        const groupAuthor = rawFootnotes.author !== undefined ? rawFootnotes.author : defaultAuthor;
        mergeStoryMap(rawFootnotes.story, groupAuthor, rawFootnotes.preface, rawFootnotes.class);
      } else {
        mergeStoryMap(rawFootnotes, defaultAuthor, false, undefined);
      }
    }

    return targetFootnotes;
  }

  function createDefaultNewsArchive() {
    return {};
  }

  function createDefaultSocialArchive() {
    return {
      news: createDefaultNewsArchive(),
      blogspot: [],
      formspring: {},
      tumblr: []
    };
  }

  // Copy only mod-derived data or the current page, preserving shared references.
  function cloneEditState(value, seen = new Map()) {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = Array.isArray(value) ? new Array(value.length) : {};
    seen.set(value, copy);
    Object.keys(value).forEach((key) => {
      copy[key] = cloneEditState(value[key], seen);
    });
    return copy;
  }

  /**
   * Creates a lightweight `archive` Proxy that intercepts reads and writes to
   * `archive.story.story[pageId]` without holding all pages in Webview memory.
   *
   * @param {object} [baseSummary={}] - Optional lightweight summary of pages
   * @param {object} [options={}] - Optional proxy behavior flags
   * @returns {object} Archive proxy object ready for `mod.edit(archive)` and `extractArchiveDiffs(archive)`
   */
  function createArchiveProxy(baseSummary, options) {
    let summaryRef = (baseSummary && typeof baseSummary === 'object') ? baseSummary : {};
    const unseededReadOnly = Boolean(options && options.unseededReadOnly);
    let dirtyPages = {};
    let addedPages = {};
    const pageProxyCache = new Map();

    const dummyMediaArray = new Proxy([], {
      get(target, arrProp) {
        if (typeof arrProp === 'symbol') return target[arrProp];
        if (arrProp in target) return target[arrProp];
        if (/^\d+$/.test(String(arrProp))) {
          return '/storyfiles/placeholder.gif';
        }
        return target[arrProp];
      }
    });

    const unseededDummyPage = {
      title: '',
      content: '',
      media: dummyMediaArray,
      next: [],
      flag: [],
      previous: '',
      theme: ''
    };

    function wrapMutableArray(pageId, prop, initialArr, targetContainer, allowDirtyWrite) {
      const arrCopy = Array.isArray(initialArr) ? [...initialArr] : [];
      return new Proxy(arrCopy, {
        get(target, arrProp) {
          const val = target[arrProp];
          if (typeof val === 'function') {
            return function (...args) {
              const res = Array.prototype[arrProp].apply(target, args);
              if (allowDirtyWrite) {
                if (!targetContainer[pageId]) targetContainer[pageId] = {};
                targetContainer[pageId][prop] = [...target];
              }
              return res;
            };
          }
          if (val === undefined && prop === 'media' && /^\d+$/.test(String(arrProp))) {
            return '/storyfiles/placeholder.gif';
          }
          return val;
        },
        set(target, arrProp, value) {
          target[arrProp] = value;
          if (allowDirtyWrite) {
            if (!targetContainer[pageId]) targetContainer[pageId] = {};
            targetContainer[pageId][prop] = [...target];
          }
          return true;
        }
      });
    }

    function getOrCreatePageProxy(pageId) {
      if (pageProxyCache.has(pageId)) {
        return pageProxyCache.get(pageId);
      }

      const taintedReadProps = new Set();

      const pageProxy = new Proxy({}, {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'pageId' || prop === 'page_id') return pageId;

          // Check if page was newly added wholesale
          if (Object.prototype.hasOwnProperty.call(addedPages, pageId)) {
            const added = addedPages[pageId];
            if (prop === 'media' || prop === 'next' || prop === 'flag') {
              return wrapMutableArray(pageId, prop, added[prop] || [], addedPages, true);
            }
            return added[prop];
          }

          const dirty = dirtyPages[pageId];
          const isSeeded = Boolean(summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId));
          const base = isSeeded ? summaryRef[pageId] : {};

          if (dirty && Object.prototype.hasOwnProperty.call(dirty, prop)) {
            if (prop === 'media' || prop === 'next' || prop === 'flag') {
              return wrapMutableArray(pageId, prop, dirty[prop], dirtyPages, true);
            }
            return dirty[prop];
          }

          if (prop === 'media' || prop === 'next' || prop === 'flag') {
            return wrapMutableArray(pageId, prop, base[prop] || [], dirtyPages, isSeeded || !unseededReadOnly);
          }

          if (Object.prototype.hasOwnProperty.call(base, prop)) {
            return base[prop];
          }

          if (prop === 'title' || prop === 'content' || prop === 'theme' || prop === 'previous') {
            if (!isSeeded && unseededReadOnly) {
              taintedReadProps.add(String(prop));
            }
            return '';
          }
          return undefined;
        },
        set(_target, prop, value) {
          if (Object.prototype.hasOwnProperty.call(addedPages, pageId)) {
            addedPages[pageId][prop] = value;
            return true;
          }
          const isSeeded = Boolean(summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId));
          if (!isSeeded && unseededReadOnly && taintedReadProps.has(String(prop))) {
            return true;
          }
          // Ignore no-op empty-string writes to pages not in summaryRef and not yet dirty
          if (
            value === '' &&
            !isSeeded &&
            (!dirtyPages[pageId] || !Object.prototype.hasOwnProperty.call(dirtyPages[pageId], prop))
          ) {
            return true;
          }
          if (!dirtyPages[pageId]) {
            dirtyPages[pageId] = {};
          }
          dirtyPages[pageId][prop] = Array.isArray(value) ? [...value] : value;
          return true;
        },
        has(_target, prop) {
          if (Object.prototype.hasOwnProperty.call(addedPages, pageId)) {
            return prop in addedPages[pageId];
          }
          if (dirtyPages[pageId] && prop in dirtyPages[pageId]) return true;
          if (summaryRef && summaryRef[pageId] && prop in summaryRef[pageId]) return true;
          return ['pageId', 'title', 'content', 'media', 'next', 'previous', 'theme', 'flag'].includes(String(prop));
        },
        ownKeys() {
          const keys = new Set(['pageId']);
          const base = (summaryRef && summaryRef[pageId]) || {};
          Object.keys(base).forEach((k) => keys.add(k));
          if (dirtyPages[pageId]) Object.keys(dirtyPages[pageId]).forEach((k) => keys.add(k));
          if (addedPages[pageId]) Object.keys(addedPages[pageId]).forEach((k) => keys.add(k));
          return Array.from(keys);
        },
        getOwnPropertyDescriptor(_target, prop) {
          if (typeof prop === 'symbol') return undefined;
          const k = String(prop);
          const base = (summaryRef && summaryRef[pageId]) || {};
          const exists =
            k === 'pageId' ||
            (addedPages[pageId] && Object.prototype.hasOwnProperty.call(addedPages[pageId], k)) ||
            (dirtyPages[pageId] && Object.prototype.hasOwnProperty.call(dirtyPages[pageId], k)) ||
            Object.prototype.hasOwnProperty.call(base, k);
          if (!exists) return undefined;
          return {
            enumerable: true,
            configurable: true,
            writable: true,
            value: pageProxy[prop]
          };
        }
      });

      pageProxyCache.set(pageId, pageProxy);
      return pageProxy;
    }

    let unseededProxyCount = 0;
    let currentHookHasIfGuard = false;

    const storyProxy = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'toJSON') return () => ({});
        const pageId = String(prop);
        if (
          pageProxyCache.has(pageId) ||
          Object.prototype.hasOwnProperty.call(addedPages, pageId) ||
          Object.prototype.hasOwnProperty.call(dirtyPages, pageId) ||
          (summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId))
        ) {
          return getOrCreatePageProxy(pageId);
        }
        if (unseededReadOnly) {
          if (currentHookHasIfGuard) {
            return undefined;
          }
          unseededDummyPage.title = '';
          unseededDummyPage.content = '';
          unseededDummyPage.media.length = 0;
          unseededDummyPage.next.length = 0;
          unseededDummyPage.flag.length = 0;
          return unseededDummyPage;
        }
        if (!currentHookHasIfGuard || unseededProxyCount < 16) {
          unseededProxyCount += 1;
          return getOrCreatePageProxy(pageId);
        }
        return undefined;
      },
      set(_target, prop, value) {
        if (typeof prop === 'symbol') return false;
        const pageId = String(prop);
        if (value && typeof value === 'object') {
          const cloned = {
            pageId: value.pageId || value.page_id || pageId,
            title: value.title !== undefined ? String(value.title) : '',
            content: value.content !== undefined ? String(value.content) : '',
            media: Array.isArray(value.media) ? [...value.media] : [],
            next: Array.isArray(value.next) ? [...value.next] : [],
            previous: value.previous !== undefined ? String(value.previous) : undefined,
            theme: value.theme !== undefined ? String(value.theme) : undefined,
            flag: Array.isArray(value.flag) ? [...value.flag] : []
          };
          // Preserve any extra custom fields
          const extraKeys = Object.keys(value);
          for (let i = 0; i < extraKeys.length; i++) {
            const k = extraKeys[i];
            if (!(k in cloned)) cloned[k] = value[k];
          }
          addedPages[pageId] = cloned;
          // Also record in dirtyPages if it patches an existing page
          if (summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId)) {
            dirtyPages[pageId] = Object.assign({}, dirtyPages[pageId] || {}, cloned);
          }
        }
        return true;
      },
      has(_target, prop) {
        const pageId = String(prop);
        return Boolean(
          Object.prototype.hasOwnProperty.call(addedPages, pageId) ||
          Object.prototype.hasOwnProperty.call(dirtyPages, pageId) ||
          (summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId))
        );
      },
      ownKeys() {
        const keys = new Set();
        if (summaryRef && typeof summaryRef === 'object') {
          Object.keys(summaryRef).forEach((k) => keys.add(k));
        }
        Object.keys(dirtyPages).forEach((k) => keys.add(k));
        Object.keys(addedPages).forEach((k) => keys.add(k));
        return Array.from(keys);
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        const pageId = String(prop);
        const exists = Boolean(
          Object.prototype.hasOwnProperty.call(addedPages, pageId) ||
          Object.prototype.hasOwnProperty.call(dirtyPages, pageId) ||
          (summaryRef && Object.prototype.hasOwnProperty.call(summaryRef, pageId))
        );
        if (!exists) return undefined;
        return {
          enumerable: true,
          configurable: true,
          writable: true,
          value: getOrCreatePageProxy(pageId)
        };
      }
    });

    const footnotesObj = { story: {} };
    const tweaksObj = { modHomeRowItems: [] };
    const fancomicsObj = {};
    const flagsObj = {};
    const newsObj = createDefaultNewsArchive();
    const socialObj = createDefaultSocialArchive();
    const musicProxy = createPermissiveTreeProxy({
      albums: {},
      tracks: {},
      artists: {},
      flashes: {}
    });

    const archive = {
      story: {
        story: storyProxy,
        footnotes: footnotesObj.story,
        faqs: createPermissiveTreeProxy({
          new: { content: '' },
          classic: { content: '' }
        })
      },
      music: musicProxy,
      fancomics: createPermissiveTreeProxy(fancomicsObj),
      tweaks: createPermissiveTreeProxy(tweaksObj),
      flags: createPermissiveTreeProxy(flagsObj),
      footnotes: footnotesObj,
      audioData: createPermissiveTreeProxy({}),
      extras: createPermissiveTreeProxy({}),
      news: newsObj,
      social: createPermissiveTreeProxy(socialObj),
      sideComics: createPermissiveTreeProxy({})
    };

    // Snapshot only mod-derived state. The immutable archive summary and the
    // lazy story/page proxies must never be duplicated for an edit checkpoint.
    function checkpoint() {
      const derived = {};
      Object.keys(archive).forEach((key) => {
        derived[key] = key === 'story'
          ? Object.fromEntries(Object.entries(archive.story).filter(([name]) => name !== 'story'))
          : archive[key];
      });
      return cloneEditState({ dirtyPages, addedPages, derived, unseededProxyCount });
    }

    function rollback(saved) {
      dirtyPages = saved.dirtyPages;
      addedPages = saved.addedPages;
      unseededProxyCount = saved.unseededProxyCount;
      pageProxyCache.clear();
      Object.keys(archive).forEach((key) => { delete archive[key]; });
      Object.assign(archive, saved.derived);
      archive.story.story = storyProxy;
      archive.story.faqs = createPermissiveTreeProxy(archive.story.faqs);
      for (const key of ['music', 'fancomics', 'tweaks', 'flags', 'audioData', 'extras', 'social', 'sideComics']) {
        archive[key] = createPermissiveTreeProxy(archive[key]);
      }
    }

    const internalState = {
      getDirtyPages: () => dirtyPages,
      getAddedPages: () => addedPages,
      getFancomics: () => archive.fancomics,
      getModHomeRowItems: () => archive.tweaks.modHomeRowItems,
      getFootnotes: () => archive.footnotes,
      getStoryFootnotes: () => archive.story.footnotes,
      checkpoint,
      rollback,
      setGuardMode: (flag) => {
        currentHookHasIfGuard = Boolean(flag);
      },
      dispose: () => {
        dirtyPages = {};
        addedPages = {};
        summaryRef = null;
        pageProxyCache.clear();
      }
    };

    Object.defineProperty(archive, '_proxyState', {
      value: internalState,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(archive, 'dirtyPages', {
      get: () => dirtyPages,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(archive, 'addedPages', {
      get: () => addedPages,
      enumerable: false,
      configurable: true
    });

    return archive;
  }

  /**
   * Extracts all accumulated diffs (`patches`, `addedPages`, `fancomics`, `modHomeRowItems`, `footnotes`)
   * from an `ArchiveProxy` instance and immediately releases temporary references for GC.
   *
   * @param {object} proxyState - ArchiveProxy returned by `createArchiveProxy`
   * @returns {object} `{ patches, addedPages, fancomics, modHomeRowItems, footnotes }`
   */
  function extractArchiveDiffs(proxyState) {
    if (!proxyState || typeof proxyState !== 'object') {
      return {
        patches: {},
        addedPages: {},
        fancomics: {},
        modHomeRowItems: [],
        footnotes: {}
      };
    }

    const internal = proxyState._proxyState;
    const rawDirty = internal ? internal.getDirtyPages() : (proxyState.dirtyPages || proxyState.patches || {});
    const rawAdded = internal ? internal.getAddedPages() : (proxyState.addedPages || {});
    const rawFancomics = internal ? internal.getFancomics() : (proxyState.fancomics || {});
    const rawHomeRows = internal
      ? internal.getModHomeRowItems()
      : ((proxyState.tweaks && proxyState.tweaks.modHomeRowItems) || proxyState.modHomeRowItems || []);

    const patches = {};
    const dirtyKeys = Object.keys(rawDirty);
    for (let i = 0; i < dirtyKeys.length; i++) {
      const pid = dirtyKeys[i];
      patches[pid] = Object.assign({}, rawDirty[pid]);
    }

    const addedPages = {};
    const addedKeys = Object.keys(rawAdded);
    for (let i = 0; i < addedKeys.length; i++) {
      const pid = addedKeys[i];
      addedPages[pid] = Object.assign({}, rawAdded[pid]);
    }

    const fancomics = Object.assign({}, rawFancomics);
    const modHomeRowItems = Array.isArray(rawHomeRows) ? [...rawHomeRows] : [];

    const footnotes = {};
    if (proxyState.footnotes) {
      mergeFootnotesInto(footnotes, proxyState.footnotes);
    }
    if (proxyState.story && proxyState.story.footnotes) {
      mergeFootnotesInto(footnotes, proxyState.story.footnotes);
    }

    if (internal && typeof internal.dispose === 'function') {
      internal.dispose();
    }

    return {
      patches,
      addedPages,
      fancomics,
      modHomeRowItems,
      footnotes
    };
  }

  // ---------------------------------------------------------------------------
  // ModRuntime Manager: loadActiveMods & applyEditPageHooks
  // ---------------------------------------------------------------------------

  const runtimeState = {
    editArchiveHooks: [],
    editPageHooks: [],
    seededPageIds: new Set(),
    vueHooks: [],
    styles: [],
    themes: [],
    settings: {},
    footnotes: {},
    fancomics: {},
    modHomeRowItems: [],
    routes: {},
    browserPages: {}
  };

  function hasIfStoryGuardInFn(fn) {
    if (typeof fn !== 'function') return false;
    try {
      const src = Function.prototype.toString.call(fn);
      return /if\s*\(\s*[a-zA-Z0-9_$.]+\.story\s*\[/.test(src);
    } catch (_) {
      return false;
    }
  }

  /**
   * Creates a lightweight single-page `archive` Proxy for on-read `edit(archive)`
   * replay when `baseSummary` did not pre-load all pages in memory.
   */
  function createSinglePageArchiveProxy(pageClone, hasIfGuard) {
    const rawPid = String(pageClone.pageId || pageClone.page_id || '');
    const paddedPid = /^\d+$/.test(rawPid) ? rawPid.padStart(6, '0') : rawPid;
    const seenMissPageIds = new Set();

    function isTargetKey(prop) {
      const s = String(prop);
      return s === rawPid || s === paddedPid;
    }

    const dummyMediaArray = new Proxy([], {
      get(target, arrProp) {
        if (typeof arrProp === 'symbol') return target[arrProp];
        if (arrProp in target) return target[arrProp];
        if (/^\d+$/.test(String(arrProp))) {
          return '/storyfiles/placeholder.gif';
        }
        return target[arrProp];
      }
    });

    const dummyPage = {
      title: '',
      content: '',
      media: dummyMediaArray,
      next: [],
      flag: [],
      previous: '',
      theme: ''
    };

    const storyProxy = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'toJSON') return () => ({ [paddedPid]: pageClone });
        if (isTargetKey(prop)) {
          return pageClone;
        }
        const keyStr = String(prop);
        if (hasIfGuard) {
          return undefined;
        }
        seenMissPageIds.add(keyStr);
        dummyPage.title = '';
        dummyPage.content = '';
        dummyPage.media.length = 0;
        dummyPage.next.length = 0;
        dummyPage.flag.length = 0;
        return dummyPage;
      },
      set(_target, prop, value) {
        if (typeof prop === 'symbol') return false;
        if (isTargetKey(prop) && value && typeof value === 'object') {
          Object.assign(pageClone, value);
        }
        return true;
      },
      has(_target, prop) {
        return isTargetKey(prop);
      },
      ownKeys() {
        return paddedPid ? [paddedPid] : [];
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (isTargetKey(prop)) {
          return {
            enumerable: true,
            configurable: true,
            writable: true,
            value: pageClone
          };
        }
        return undefined;
      }
    });

    const footnotesObj = { story: {} };
    if (paddedPid && Array.isArray(pageClone.footnotes) && pageClone.footnotes.length > 0) {
      footnotesObj.story[paddedPid] = pageClone.footnotes.map((n) => Object.assign({}, n));
    }
    const newsObj = createDefaultNewsArchive();
    const socialObj = createDefaultSocialArchive();
    const musicProxy = createPermissiveTreeProxy({
      albums: {},
      tracks: {},
      artists: {},
      flashes: {}
    });

    return {
      story: {
        story: storyProxy,
        footnotes: footnotesObj.story,
        faqs: createPermissiveTreeProxy({
          new: { content: '' },
          classic: { content: '' }
        })
      },
      music: musicProxy,
      fancomics: createPermissiveTreeProxy({}),
      tweaks: createPermissiveTreeProxy({ modHomeRowItems: [] }),
      flags: createPermissiveTreeProxy({}),
      footnotes: footnotesObj,
      audioData: createPermissiveTreeProxy({}),
      extras: createPermissiveTreeProxy({}),
      news: newsObj,
      social: createPermissiveTreeProxy(socialObj),
      sideComics: createPermissiveTreeProxy({})
    };
  }

  /**
   * Evaluates all active mods in reverse priority order (lowest priority first so
   * top-of-list highest priority wins), runs `computed`/`asyncComputed`, merges `footnotes`,
   * executes `edit(archiveProxy)`, sends diffs via `ipcInvoke('apply_mod_diffs', diffs)`,
   * and registers active `editPage(page)` hooks.
   *
   * @param {object|Array} bundle - Mod bundle returned by `get_mod_bundle`
   * @param {Function} [ipcInvoke] - IPC invoke function
   * @param {string} [assetBase=''] - Loopback server base URL
   * @returns {Promise<object>} Active runtime descriptors & diffs
   */
  async function loadActiveMods(bundle, ipcInvoke, assetBase) {
    runtimeState.editArchiveHooks = [];
    runtimeState.editPageHooks = [];
    runtimeState.seededPageIds = new Set();
    runtimeState.vueHooks = [];
    runtimeState.styles = [];
    runtimeState.themes = [];
    runtimeState.settings = {};
    runtimeState.footnotes = {};
    runtimeState.fancomics = {};
    runtimeState.modHomeRowItems = [];
    runtimeState.routes = {};
    runtimeState.browserPages = {};

    const activeMods = Array.isArray(bundle)
      ? bundle
      : ((bundle && (bundle.activeMods || bundle.active_mods || bundle.mods)) || []);
    const modSettings = (!Array.isArray(bundle) && bundle && (bundle.modSettings || bundle.mod_settings))
      ? Object.assign({}, bundle.modSettings || bundle.mod_settings)
      : {};
    const baseSummary = (!Array.isArray(bundle) && bundle && (bundle.baseSummary || bundle.base_summary)) || {};
    if (baseSummary && typeof baseSummary === 'object') {
      Object.keys(baseSummary).forEach((k) => runtimeState.seededPageIds.add(k));
    }

    const archiveProxy = createArchiveProxy(baseSummary, {
      unseededReadOnly: runtimeState.seededPageIds.size === 0
    });
    const collectedFootnotes = {};
    const collectedRoutes = {};
    const errors = [];

    // Evaluate from lowest priority (end of list) to highest priority (index 0)
    for (let i = activeMods.length - 1; i >= 0; i--) {
      const modEntry = activeMods[i];
      if (!modEntry) continue;

      const modId = modEntry.id || modEntry.modId || modEntry.mod_id || `mod_${i}`;
      const rawCode = modEntry.rawCode ?? modEntry.raw_code ?? modEntry.code ?? modEntry.modJs ?? modEntry.source ?? '';
      const entryStoreData = Object.assign(
        {},
        modSettings[modId] || {},
        modEntry.storeData || modEntry.storeSettings || modEntry.settingsData || {}
      );
      modSettings[modId] = entryStoreData;

      let suppressStoreWrites = false;
      const sandbox = createModApiSandbox({
        modId,
        jsonStore: modEntry.jsonStore || modEntry.json_store || {},
        textStore: modEntry.textStore || modEntry.text_store || {},
        fileCache: modEntry.fileCache || modEntry.file_cache || {},
        storeData: entryStoreData,
        modSettings,
        ipcInvoke,
        assetBase,
        onStoreWrite: (mId, key, value) => {
          if (suppressStoreWrites) return;
          if (!modSettings[mId]) modSettings[mId] = {};
          if (value === null || value === undefined) {
            delete modSettings[mId][key];
          } else {
            modSettings[mId][key] = value;
          }
          if (typeof ipcInvoke === 'function') {
            try {
              Promise.resolve(
                ipcInvoke('save_mod_setting', { modId: mId, mod_id: mId, key, value })
              ).catch(() => {});
            } catch (_) {}
          }
        }
      });
      sandbox.setSuppressStoreWrites = (flag) => {
        suppressStoreWrites = Boolean(flag);
      };

      let modExports = null;
      try {
        if (typeof rawCode === 'string' && rawCode.trim() !== '') {
          modExports = await evaluateModModule(modId, rawCode, sandbox);
        } else if (modEntry.exports && typeof modEntry.exports === 'object') {
          modExports = modEntry.exports;
          if (typeof modExports.computed === 'function') {
            const cRes = sandbox.runWithThrottledConsole(() => modExports.computed(sandbox.api));
            if (cRes && typeof cRes === 'object') Object.assign(modExports, cRes);
          }
          if (typeof modExports.asyncComputed === 'function') {
            const aRes = await modExports.asyncComputed(sandbox.api);
            if (aRes && typeof aRes === 'object') Object.assign(modExports, aRes);
          }
        } else {
          modExports = Object.assign({}, modEntry);
        }
      } catch (err) {
        errors.push({ modId, phase: 'evaluate', message: String((err && err.message) || err) });
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error(`[RRWRModHooks] Failed to evaluate mod '${modId}':`, err);
        }
        continue;
      }

      if (!modExports || typeof modExports !== 'object') continue;

      // 1. Collect mod settings descriptor (boolean / radio) and seed default values
      const settingsDesc = modExports.settings || modEntry.settings;
      if (settingsDesc && typeof settingsDesc === 'object') {
        runtimeState.settings[modId] = settingsDesc;
        if (Array.isArray(settingsDesc.boolean)) {
          for (let b = 0; b < settingsDesc.boolean.length; b++) {
            const opt = settingsDesc.boolean[b];
            if (opt && opt.model && modSettings[modId][opt.model] === undefined) {
              if (opt.model === 'hideOriginalLink') {
                modSettings[modId][opt.model] = true;
              } else if (opt.value !== undefined) {
                modSettings[modId][opt.model] = Boolean(opt.value);
              }
            }
          }
        }
        if (Array.isArray(settingsDesc.radio)) {
          for (let r = 0; r < settingsDesc.radio.length; r++) {
            const opt = settingsDesc.radio[r];
            if (opt && opt.model && modSettings[modId][opt.model] === undefined && opt.value !== undefined) {
              modSettings[modId][opt.model] = opt.value;
            }
          }
        }
      }

      // 1b. Collect dynamic routes (supports both plain objects and Arrays with string keys)
      if (modExports.routes && typeof modExports.routes === 'object') {
        const routeKeys = Object.keys(modExports.routes);
        for (let r = 0; r < routeKeys.length; r++) {
          const rk = routeKeys[r];
          const rv = modExports.routes[rk];
          if (typeof rv === 'string' && !/^\d+$/.test(rk)) {
            if (!collectedRoutes[modId]) collectedRoutes[modId] = {};
            collectedRoutes[modId][rk] = rv;
          }
        }
      }

      // 1c. Collect browserPages
      if (modExports.browserPages && typeof modExports.browserPages === 'object') {
        const bpKeys = Object.keys(modExports.browserPages);
        for (let bp = 0; bp < bpKeys.length; bp++) {
          const rawKey = bpKeys[bp];
          const pageDef = modExports.browserPages[rawKey];
          const comp = (pageDef && pageDef.component) || pageDef || {};
          let bpTitle = rawKey;
          if (typeof comp.title === 'function') {
            try {
              bpTitle = comp.title();
            } catch (_) {}
          } else if (typeof comp.title === 'string') {
            bpTitle = comp.title;
          }
          const template = typeof comp.template === 'string' ? comp.template : '';
          if (template) {
            runtimeState.browserPages[rawKey.toUpperCase()] = {
              modId,
              key: rawKey.toUpperCase(),
              title: bpTitle || rawKey,
              template
            };
          }
        }
      }

      // 2. Merge static footnotes exported by the mod
      if (modExports.footnotes) {
        mergeFootnotesInto(collectedFootnotes, modExports.footnotes, modExports.author || modEntry.author || modId);
      }

      // 3. Run edit(archiveProxy) and register per-page replay hook
      if (typeof modExports.edit === 'function') {
        const hasIfGuard = hasIfStoryGuardInFn(modExports.edit);
        let editSucceeded = false;
        let checkpoint = archiveProxy._proxyState.checkpoint();
        if (archiveProxy._proxyState && typeof archiveProxy._proxyState.setGuardMode === 'function') {
          archiveProxy._proxyState.setGuardMode(hasIfGuard);
        }
        try {
          await sandbox.runWithThrottledConsole(() => modExports.edit(archiveProxy));
          editSucceeded = true;
        } catch (err) {
          archiveProxy._proxyState.rollback(checkpoint);
          errors.push({ modId, phase: 'edit', message: String((err && err.message) || err) });
          if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error(`[RRWRModHooks] Error in edit(archive) for mod '${modId}':`, err);
          }
        }
        checkpoint = null;
        if (editSucceeded) {
          runtimeState.editArchiveHooks.push({
            modId,
            fn: modExports.edit.bind(modExports),
            hasIfGuard,
            sandbox
          });
        }
      }

      // 4. Register editPage(page) hook
      if (typeof modExports.editPage === 'function') {
        runtimeState.editPageHooks.push({
          modId,
          fn: modExports.editPage.bind(modExports)
        });
      }

      // 5. Collect styles
      const entryStyles = Array.isArray(modEntry.styles) ? modEntry.styles : [];
      const rawStyles = Array.isArray(modExports.styles)
        ? modExports.styles
        : entryStyles;
      for (let s = 0; s < rawStyles.length; s++) {
        const item = rawStyles[s];
        if (!item) continue;
        let cssBody = '';
        let styleId = `style-${modId}-${s}`;
        if (typeof item === 'string') {
          cssBody = item;
        } else if (typeof item === 'object') {
          if (item.id) styleId = item.id;
          cssBody = item.body || item.css || '';
          if (!cssBody && entryStyles[s] && (entryStyles[s].body || entryStyles[s].css)) {
            cssBody = entryStyles[s].body || entryStyles[s].css;
          }
          if (!cssBody && item.source) {
            cssBody = await sandbox.api.readTextAsync(item.source);
          }
        }
        if (cssBody) {
          runtimeState.styles.push({
            id: styleId,
            modId,
            body: cssBody,
            css: cssBody
          });
        }
      }

      // 6. Collect custom themes
      const entryThemes = Array.isArray(modEntry.themes) ? modEntry.themes : [];
      const rawThemes = Array.isArray(modExports.themes)
        ? modExports.themes
        : entryThemes;
      const sanitizedModId = String(modId).replace(/[^a-zA-Z0-9]/g, '-');
      for (let t = 0; t < rawThemes.length; t++) {
        const themeItem = rawThemes[t];
        if (!themeItem || typeof themeItem !== 'object') continue;
        const preResolved = entryThemes[t] || {};
        const themeId = themeItem.id || themeItem.value || preResolved.value || preResolved.id || `theme-${sanitizedModId}-${t}`;
        const label = themeItem.label || themeItem.name || preResolved.label || `${modExports.title || modId} (${t + 1})`;
        let cssBody = themeItem.body || themeItem.css || preResolved.css || preResolved.body || '';
        if (!cssBody && themeItem.source) {
          cssBody = await sandbox.api.readTextAsync(themeItem.source);
        }
        if (cssBody) {
          const scopeCls = themeId.startsWith('theme-') ? themeId : `theme-${themeId}`;
          const scopePrefix = `#app.${scopeCls}`;
          if (!cssBody.includes(scopePrefix)) {
            cssBody = `${scopePrefix} {\n${cssBody}\n}`;
          }
        }
        runtimeState.themes.push({
          id: themeId,
          value: themeId,
          label,
          modId,
          body: cssBody,
          css: cssBody
        });
      }

      // 7. Collect vueHooks if any
      if (Array.isArray(modExports.vueHooks)) {
        for (let v = 0; v < modExports.vueHooks.length; v++) {
          runtimeState.vueHooks.push(modExports.vueHooks[v]);
        }
      }
    }

    // Extract diffs and free temporary proxy state immediately
    const diffs = extractArchiveDiffs(archiveProxy);
    mergeFootnotesInto(diffs.footnotes, collectedFootnotes);
    diffs.routes = collectedRoutes;

    // Also include any pre-extracted bundle styles/themes/staticFootnotes/fancomics if provided by backend
    if (!Array.isArray(bundle) && bundle) {
      if (Array.isArray(bundle.styles)) {
        for (let i = 0; i < bundle.styles.length; i++) {
          const st = bundle.styles[i];
          if (st && (st.body || st.css) && !runtimeState.styles.some((x) => x.id === st.id)) {
            runtimeState.styles.push({
              id: st.id || `bundle-style-${i}`,
              modId: st.modId || st.mod_id || 'bundle',
              body: st.body || st.css,
              css: st.body || st.css
            });
          }
        }
      }
      if (Array.isArray(bundle.themes)) {
        for (let i = 0; i < bundle.themes.length; i++) {
          const th = bundle.themes[i];
          if (th && !runtimeState.themes.some((x) => x.id === (th.id || th.value))) {
            const tid = th.id || th.value || `theme-bundle-${i}`;
            runtimeState.themes.push({
              id: tid,
              value: tid,
              label: th.label || th.name || tid,
              modId: th.modId || th.mod_id || 'bundle',
              body: th.body || th.css || '',
              css: th.body || th.css || ''
            });
          }
        }
      }
      const bundleStaticFootnotes = bundle.staticFootnotes !== undefined
        ? bundle.staticFootnotes
        : bundle.footnotes;
      if (bundleStaticFootnotes && typeof bundleStaticFootnotes === 'object') {
        mergeFootnotesInto(diffs.footnotes, bundleStaticFootnotes);
      }
      if (bundle.fancomics && typeof bundle.fancomics === 'object') {
        Object.assign(diffs.fancomics, bundle.fancomics);
      }
      if (Array.isArray(bundle.modHomeRowItems || bundle.mod_home_row_items)) {
        const extraRows = bundle.modHomeRowItems || bundle.mod_home_row_items;
        for (let i = 0; i < extraRows.length; i++) {
          diffs.modHomeRowItems.push(extraRows[i]);
        }
      }
    }

    runtimeState.footnotes = diffs.footnotes;
    runtimeState.fancomics = diffs.fancomics;
    runtimeState.modHomeRowItems = diffs.modHomeRowItems;
    runtimeState.routes = collectedRoutes;

    if (typeof ipcInvoke === 'function') {
      try {
        await ipcInvoke('apply_mod_diffs', {
          replace: true,
          diff: Object.assign({ replace: true }, diffs),
          patches: diffs.patches,
          addedPages: diffs.addedPages,
          fancomics: diffs.fancomics,
          modHomeRowItems: diffs.modHomeRowItems,
          footnotes: diffs.footnotes,
          routes: collectedRoutes
        });
      } catch (err) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[RRWRModHooks] apply_mod_diffs IPC notice:', err);
        }
      }
    }

    return {
      styles: runtimeState.styles,
      themes: runtimeState.themes,
      settings: runtimeState.settings,
      footnotes: runtimeState.footnotes,
      fancomics: runtimeState.fancomics,
      modHomeRowItems: runtimeState.modHomeRowItems,
      routes: runtimeState.routes,
      browserPages: runtimeState.browserPages,
      patches: diffs.patches,
      addedPages: diffs.addedPages,
      vueHooks: runtimeState.vueHooks,
      modSettings,
      errors,
      editPageHooksCount: runtimeState.editPageHooks.length
    };
  }

  /**
   * Shallowly clones `page` and executes all active on-read `edit(archive)` hooks
   * (for pages not pre-seeded in `baseSummary`) followed by `editPage(pageClone)` hooks,
   * with per-mod `try/catch` isolation so a faulty mod never breaks page rendering.
   *
   * @param {object} page - StoryPage object
   * @returns {object} Transformed shallow clone of `page`
   */
  function applyEditPageHooks(page) {
    if (!page || typeof page !== 'object') return page;

    let pageClone = Object.assign({}, page);
    if (Array.isArray(page.media)) pageClone.media = [...page.media];
    if (Array.isArray(page.next)) pageClone.next = [...page.next];
    if (Array.isArray(page.flag)) pageClone.flag = [...page.flag];

    const pid = String(pageClone.pageId || pageClone.page_id || '');
    const paddedPid = /^\d+$/.test(pid) ? pid.padStart(6, '0') : pid;
    const archiveHooks = runtimeState.editArchiveHooks;
    if (archiveHooks.length > 0 && (!pid || !runtimeState.seededPageIds.has(pid))) {
      for (let i = 0; i < archiveHooks.length; i++) {
        const aHook = archiveHooks[i];
        if (!aHook || typeof aHook.fn !== 'function') continue;
        const priorPage = pageClone;
        pageClone = cloneEditState(priorPage);
        try {
          const singleArchive = createSinglePageArchiveProxy(pageClone, Boolean(aHook.hasIfGuard));
          if (aHook.sandbox && typeof aHook.sandbox.setSuppressStoreWrites === 'function') {
            aHook.sandbox.setSuppressStoreWrites(true);
          }
          try {
            if (aHook.sandbox && typeof aHook.sandbox.runWithThrottledConsole === 'function') {
              aHook.sandbox.runWithThrottledConsole(() => aHook.fn(singleArchive));
            } else {
              aHook.fn(singleArchive);
            }
          } finally {
            if (aHook.sandbox && typeof aHook.sandbox.setSuppressStoreWrites === 'function') {
              aHook.sandbox.setSuppressStoreWrites(false);
            }
          }
          if (singleArchive.footnotes && singleArchive.footnotes.story) {
            const pageFnMap = {};
            mergeFootnotesInto(pageFnMap, singleArchive.footnotes, aHook.modId);
            const extraNotes = pageFnMap[paddedPid] || pageFnMap[pid];
            if (Array.isArray(extraNotes) && extraNotes.length > 0) {
              if (!Array.isArray(pageClone.footnotes)) {
                pageClone.footnotes = [];
              }
              for (let n = 0; n < extraNotes.length; n++) {
                const candidate = extraNotes[n];
                const dup = pageClone.footnotes.some((existing) => existing && existing.content === candidate.content);
                if (!dup) {
                  pageClone.footnotes.push(candidate);
                }
              }
            }
          }
        } catch (err) {
          pageClone = priorPage;
          if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error(`[RRWRModHooks] Error in per-page edit(archive) for mod '${aHook.modId}':`, err);
          }
        }
      }
    }

    const hooks = runtimeState.editPageHooks;
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i];
      if (!hook || typeof hook.fn !== 'function') continue;
      const priorPage = pageClone;
      pageClone = cloneEditState(priorPage);
      try {
        const res = hook.fn(pageClone);
        if (res && typeof res === 'object') {
          pageClone = res;
        }
      } catch (err) {
        pageClone = priorPage;
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error(`[RRWRModHooks] Error in editPage(page) for mod '${hook.modId}':`, err);
        }
      }
    }

    return pageClone;
  }

  const ModRuntime = {
    loadActiveMods,
    applyEditPageHooks,
    getState: () => runtimeState,
    reset: () => {
      runtimeState.editArchiveHooks = [];
      runtimeState.editPageHooks = [];
      runtimeState.seededPageIds = new Set();
      runtimeState.vueHooks = [];
      runtimeState.styles = [];
      runtimeState.themes = [];
      runtimeState.settings = {};
      runtimeState.footnotes = {};
      runtimeState.fancomics = {};
      runtimeState.modHomeRowItems = [];
      runtimeState.routes = {};
      runtimeState.browserPages = {};
    }
  };

  // ---------------------------------------------------------------------------
  // Chatlog Button Text & VueHooks Localization (F21)
  // ---------------------------------------------------------------------------

  /**
   * Computes the reactive chatlog toggle button text according to active mods and vueHooks.
   *
   * Canonical English:
   *   "Show chatlog" / "Hide chatlog"
   *   "Show styledlog" / "Hide styledlog"
   *   "Show specialnote" / "Hide specialnote"
   *
   * @param {string} rawContent - Raw story page text content containing `|...|` header
   * @param {boolean} logHidden - True if log is currently collapsed/hidden, false if expanded
   * @param {Array|Set|object|boolean} [enabledMods] - List of enabled mod IDs/descriptors, or boolean flag
   * @param {Array} [modHooksList] - Structured VueHook descriptors from backend
   * @returns {string} Formatted button label
   */
  function getLogButtonText(rawContent, logHidden, enabledMods, modHooksList) {
    const contentStr = typeof rawContent === 'string' ? rawContent : '';
    const isHidden = Boolean(logHidden);

    let customOpenPrefix = null;
    let customClosePrefix = null;

    const hooksToInspect = Array.isArray(modHooksList)
      ? modHooksList
      : runtimeState.vueHooks;

    // Inspect modHooksList for explicit pageText prefixes or computed hooks
    if (Array.isArray(hooksToInspect)) {
      for (let i = 0; i < hooksToInspect.length; i++) {
        const hook = hooksToInspect[i];
        if (!hook) continue;
        const matchName = hook.matchName || hook.match_name;
        if (matchName === 'pageText') {
          const open = hook.logButtonOpenPrefix || hook.log_button_open_prefix;
          const close = hook.logButtonClosePrefix || hook.log_button_close_prefix;
          if (open && close) {
            customOpenPrefix = open;
            customClosePrefix = close;
            break;
          }
          if (typeof hook.logButtonText === 'function') {
            try {
              const res = hook.logButtonText.call({ content: contentStr, logHidden: isHidden });
              if (typeof res === 'string' && res) return res;
            } catch (e) {}
          }
          if (hook.computed && typeof hook.computed.logButtonText === 'function') {
            try {
              const res = hook.computed.logButtonText.call({ content: contentStr, logHidden: isHidden });
              if (typeof res === 'string' && res) return res;
            } catch (e) {}
          }
        }
      }
    }

    const open = customOpenPrefix || 'Show ';
    const close = customClosePrefix || 'Hide ';
    const statePrefix = isHidden ? open : close;

    // Extract log delimiter tag (e.g. |CHATLOG|, |STYLEDLOG|, |SPECIALNOTE|)
    const match = contentStr.match(/\|(.*?)\|/);
    let text = match ? match[1].trim() : 'LOG';

    if (/PASSCODE HINT/i.test(text)) {
      return text;
    }
    if (/styledlog/i.test(text)) {
      text = 'styledlog';
    } else if (/specialnote/i.test(text)) {
      text = 'specialnote';
    }

    return statePrefix + text.toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Helper Utilities
  // ---------------------------------------------------------------------------

  /**
   * Strips the leading `|...|` log header delimiter from story page content.
   *
   * @param {string} content - Raw page text
   * @returns {string} Clean page text without the header tag
   */
  function stripLogHeader(content) {
    if (!content || typeof content !== 'string') return '';
    return content.replace(/^\s*\|.*?\|\s*(?:<br\s*\/?>)?/i, '');
  }

  /**
   * Returns true if the page content starts with a log delimiter.
   *
   * @param {string} content - Raw page text
   * @returns {boolean}
   */
  function isLogContent(content) {
    if (!content || typeof content !== 'string') return false;
    return /\|.*?\|/.test(content);
  }

  /**
   * Extracts the raw tag name from a log delimiter (e.g. 'CHATLOG', 'DIALOGLOG').
   *
   * @param {string} content - Raw page text
   * @returns {string} Tag name or empty string
   */
  function extractLogType(content) {
    if (!content || typeof content !== 'string') return '';
    const match = content.match(/\|(.*?)\|/);
    return match ? match[1].trim() : '';
  }

  // ---------------------------------------------------------------------------
  // Public API Export
  // ---------------------------------------------------------------------------

  const RRWRModHooks = {
    createModApiSandbox,
    evaluateModModule,
    createArchiveProxy,
    extractArchiveDiffs,
    ModRuntime,
    loadActiveMods,
    applyEditPageHooks,
    parseSimpleYaml,
    getLogButtonText,
    stripLogHeader,
    isLogContent,
    extractLogType
  };

  if (typeof root !== 'undefined') {
    root.RRWRModHooks = RRWRModHooks;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRModHooks;
  }
})(typeof window !== 'undefined' ? window : globalThis);
