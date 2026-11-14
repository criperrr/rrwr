/*
 * RRWR Performance & Animation Monitor (src/js/perfMonitor.js)
 * Zero-idle-overhead telemetry for route switches, tab lifecycle,
 * render phases, rAF burst frame spikes, long tasks, and active
 * CSS/WAAPI/GIF/compositor animations.
 */
(function (root) {
  'use strict';

  const MAX_HISTORY = 200;
  const MAX_LONGTASKS = 100;
  const PHASE_WARN_MS = 12;
  const DEFAULT_BURST_MS = 1200;

  const hasWindow = typeof window !== 'undefined';
  const hasDoc = typeof document !== 'undefined';
  const nowFn = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

  const state = {
    phases: new Map(), // name -> { count, totalMs, maxMs, minMs, lastMs, over12ms }
    history: [],       // ring buffer of recent events
    longTasks: [],     // ring buffer of PerformanceObserver longtask entries
    bursts: [],        // ring buffer of completed rAF burst summaries
    activeIntervals: new Map(), // id -> { delay, createdAt, route }
    burst: {
      active: false,
      rafId: 0,
      reason: '',
      route: '',
      startTime: 0,
      endTime: 0,
      lastFrameTime: 0,
      frameCount: 0,
      firstFrameMs: null,
      secondFrameMs: null,
      maxFrameMs: 0,
      totalActiveMs: 0,
      framesOver16_7: 0,
      framesOver50: 0,
      histogram: {
        le8: 0,
        le16_7: 0,
        le33_3: 0,
        le50: 0,
        gt50: 0
      }
    },
    auditTimerId: 0,
    lastRoute: '/'
  };

  function pushRing(arr, item, maxLen) {
    arr.push(item);
    if (arr.length > maxLen) {
      arr.splice(0, arr.length - maxLen);
    }
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function currentRouteLabel() {
    if (state.lastRoute) return state.lastRoute;
    if (hasWindow && window.location) {
      return window.location.pathname || '/';
    }
    return '/';
  }

  function setCurrentRoute(routeLabel) {
    if (typeof routeLabel === 'string' && routeLabel.length > 0) {
      state.lastRoute = routeLabel;
    }
  }

  function emitLog(tag, payload) {
    if (typeof console === 'undefined' || typeof console.info !== 'function') return;
    try {
      const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
      console.info(`[RRWR-PERF] ${tag} ${serialized}`);
    } catch (_err) {
      console.info(`[RRWR-PERF] ${tag}`);
    }
  }

  function recordPhaseStat(name, durationMs, meta) {
    let entry = state.phases.get(name);
    if (!entry) {
      entry = {
        name,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        minMs: Infinity,
        lastMs: 0,
        over12ms: 0
      };
      state.phases.set(name, entry);
    }
    entry.count += 1;
    entry.totalMs += durationMs;
    if (durationMs > entry.maxMs) entry.maxMs = durationMs;
    if (durationMs < entry.minMs) entry.minMs = durationMs;
    entry.lastMs = durationMs;
    if (durationMs > PHASE_WARN_MS) entry.over12ms += 1;

    const event = {
      type: 'phase',
      name,
      durationMs: round2(durationMs),
      route: (meta && meta.route) || currentRouteLabel(),
      ts: round2(nowFn()),
      meta: meta || null
    };
    pushRing(state.history, event, MAX_HISTORY);

    const alwaysLog = Boolean(meta && meta.alwaysLog);
    if (alwaysLog || durationMs > PHASE_WARN_MS) {
      emitLog(durationMs > PHASE_WARN_MS ? 'slow-phase' : 'phase', {
        name,
        ms: round2(durationMs),
        route: event.route,
        ...(meta ? { meta } : {})
      });
    }
    return event;
  }

  function beginPhase(name, meta) {
    return {
      name,
      start: nowFn(),
      meta: meta || null
    };
  }

  function endPhase(token, extraMeta) {
    if (!token || typeof token.start !== 'number') return null;
    const durationMs = nowFn() - token.start;
    const mergedMeta = (token.meta || extraMeta)
      ? Object.assign({}, token.meta || {}, extraMeta || {})
      : null;
    return recordPhaseStat(token.name, durationMs, mergedMeta);
  }

  function measureSync(name, fn, meta) {
    const start = nowFn();
    try {
      return fn();
    } finally {
      recordPhaseStat(name, nowFn() - start, meta);
    }
  }

  async function measureAsync(name, fn, meta) {
    const start = nowFn();
    try {
      return await fn();
    } finally {
      recordPhaseStat(name, nowFn() - start, meta);
    }
  }

  /* ==========================================================================
     Bounded rAF Burst Sampler (Zero idle power burn)
     ========================================================================== */

  function finishBurst() {
    const b = state.burst;
    if (!b.active) return;
    b.active = false;
    if (b.rafId && hasWindow && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(b.rafId);
    }
    b.rafId = 0;

    const summary = {
      type: 'raf-burst',
      reason: b.reason,
      route: b.route,
      durationMs: round2(nowFn() - b.startTime),
      frames: b.frameCount,
      firstFrameMs: b.firstFrameMs !== null ? round2(b.firstFrameMs) : null,
      secondFrameMs: b.secondFrameMs !== null ? round2(b.secondFrameMs) : null,
      maxFrameMs: round2(b.maxFrameMs),
      avgFrameMs: b.frameCount > 1 ? round2(b.totalActiveMs / (b.frameCount - 1)) : 0,
      totalActiveMs: round2(b.totalActiveMs),
      framesOver16_7: b.framesOver16_7,
      framesOver50: b.framesOver50,
      histogram: Object.assign({}, b.histogram)
    };
    pushRing(state.bursts, summary, MAX_HISTORY);
    pushRing(state.history, summary, MAX_HISTORY);
    emitLog('raf-burst', summary);
  }

  function burstTick(rafTs) {
    const b = state.burst;
    if (!b.active) return;
    const now = typeof rafTs === 'number' ? rafTs : nowFn();
    b.frameCount += 1;
    const elapsed = now - b.startTime;

    if (b.frameCount === 1) {
      b.firstFrameMs = elapsed;
    } else {
      const delta = now - b.lastFrameTime;
      if (b.frameCount === 2) {
        b.secondFrameMs = elapsed;
      }
      b.totalActiveMs += delta;
      if (delta > b.maxFrameMs) b.maxFrameMs = delta;
      if (delta > 16.7) b.framesOver16_7 += 1;
      if (delta > 50) b.framesOver50 += 1;

      if (delta <= 8) b.histogram.le8 += 1;
      else if (delta <= 16.7) b.histogram.le16_7 += 1;
      else if (delta <= 33.3) b.histogram.le33_3 += 1;
      else if (delta <= 50) b.histogram.le50 += 1;
      else b.histogram.gt50 += 1;
    }

    b.lastFrameTime = now;

    if (now >= b.endTime) {
      finishBurst();
      return;
    }
    b.rafId = window.requestAnimationFrame(burstTick);
  }

  function startBurst(reason, durationMs = DEFAULT_BURST_MS, routeOverride) {
    if (!hasWindow || typeof window.requestAnimationFrame !== 'function') return;
    const now = nowFn();
    const b = state.burst;
    const targetEnd = now + Math.max(100, durationMs);
    const route = routeOverride || currentRouteLabel();

    if (b.active) {
      // Extend active burst without spawning a second rAF loop
      b.reason = `${b.reason}+${reason}`;
      b.route = route;
      if (targetEnd > b.endTime) b.endTime = targetEnd;
      return;
    }

    b.active = true;
    b.reason = String(reason || 'manual');
    b.route = route;
    b.startTime = now;
    b.endTime = targetEnd;
    b.lastFrameTime = now;
    b.frameCount = 0;
    b.firstFrameMs = null;
    b.secondFrameMs = null;
    b.maxFrameMs = 0;
    b.totalActiveMs = 0;
    b.framesOver16_7 = 0;
    b.framesOver50 = 0;
    b.histogram = { le8: 0, le16_7: 0, le33_3: 0, le50: 0, gt50: 0 };

    b.rafId = window.requestAnimationFrame(burstTick);
  }

  /* ==========================================================================
     LongTask PerformanceObserver + Interval Tracking
     ========================================================================== */

  function initObservers() {
    if (hasWindow && typeof window.PerformanceObserver === 'function') {
      try {
        const supported = window.PerformanceObserver.supportedEntryTypes || [];
        if (supported.includes('longtask')) {
          const obs = new window.PerformanceObserver((list) => {
            const entries = list.getEntries();
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              const item = {
                type: 'longtask',
                name: e.name || 'self',
                durationMs: round2(e.duration),
                startTime: round2(e.startTime),
                route: currentRouteLabel()
              };
              pushRing(state.longTasks, item, MAX_LONGTASKS);
              pushRing(state.history, item, MAX_HISTORY);
              emitLog('longtask', item);
            }
          });
          obs.observe({ entryTypes: ['longtask'] });
        }
      } catch (_err) {
        // Ignore if longtask observer is not supported in this engine
      }
    }

    if (hasWindow && typeof window.setInterval === 'function' && !window.__rrwrIntervalWrapped) {
      const origSetInterval = window.setInterval.bind(window);
      const origClearInterval = window.clearInterval.bind(window);
      window.__rrwrIntervalWrapped = true;

      window.setInterval = function wrappedSetInterval(fn, delay) {
        const args = Array.prototype.slice.call(arguments, 2);
        const id = origSetInterval.apply(window, [fn, delay].concat(args));
        state.activeIntervals.set(id, {
          delay: Number(delay) || 0,
          createdAt: round2(nowFn()),
          route: currentRouteLabel()
        });
        return id;
      };

      window.clearInterval = function wrappedClearInterval(id) {
        state.activeIntervals.delete(id);
        return origClearInterval(id);
      };
    }
  }

  /* ==========================================================================
     Live Animation & Compositor Audit
     ========================================================================== */

  function describeElement(el) {
    if (!el || !el.tagName) return 'unknown';
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += `#${el.id}`;
    if (el.classList && el.classList.length > 0) {
      const classes = Array.from(el.classList).slice(0, 3).join('.');
      if (classes) sel += `.${classes}`;
    }
    return sel;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent === null) {
      const cs = hasWindow && window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (!cs || cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') {
        return false;
      }
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function auditActiveAnimations(reason = 'manual') {
    if (!hasDoc) return null;
    const auditStart = nowFn();

    const waapiList = [];
    let infiniteCount = 0;

    if (typeof document.getAnimations === 'function') {
      const anims = document.getAnimations();
      for (let i = 0; i < anims.length; i++) {
        const anim = anims[i];
        const target = anim.effect && anim.effect.target ? anim.effect.target : null;
        const timing = anim.effect && typeof anim.effect.getTiming === 'function'
          ? anim.effect.getTiming()
          : {};
        const isInfinite = timing.iterations === Infinity;
        if (isInfinite && anim.playState === 'running') {
          infiniteCount += 1;
        }
        waapiList.push({
          animationName: anim.animationName || anim.id || 'waapi',
          target: describeElement(target),
          playState: anim.playState,
          iterations: isInfinite ? 'Infinity' : timing.iterations,
          duration: timing.duration,
          easing: timing.easing,
          delay: timing.delay
        });
      }
    }

    const visibleGifs = [];
    const imgs = document.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (/\.gif(\?|#|$)/i.test(src) && isElementVisible(img)) {
        const rect = img.getBoundingClientRect();
        visibleGifs.push({
          target: describeElement(img),
          src: src.length > 100 ? src.slice(-100) : src,
          renderSize: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          naturalSize: `${img.naturalWidth || 0}x${img.naturalHeight || 0}`
        });
      }
    }

    const visibleSvgs = [];
    const svgs = document.querySelectorAll('svg');
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (isElementVisible(svg)) {
        const rect = svg.getBoundingClientRect();
        visibleSvgs.push({
          target: describeElement(svg),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`
        });
      }
    }

    let willChangeCount = 0;
    let backdropFilterCount = 0;
    let filterCount = 0;
    let heavyBoxShadowCount = 0;
    let cssInfiniteCount = 0;
    const compositorSample = [];

    if (hasWindow && typeof window.getComputedStyle === 'function') {
      const allEls = document.querySelectorAll('body *');
      for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;

        const wc = cs.willChange;
        const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
        const flt = cs.filter || 'none';
        const bs = cs.boxShadow || 'none';
        const animName = cs.animationName || 'none';
        const animIter = cs.animationIterationCount || '';

        const hasWc = wc && wc !== 'auto';
        const hasBf = bf && bf !== 'none';
        const hasFlt = flt && flt !== 'none';
        const hasHeavyShadow = bs && bs !== 'none' && (bs.includes('px') && (bs.match(/,/g) || []).length >= 1 || /2\dpx|3\dpx|4\dpx/.test(bs));
        const hasCssInf = animName !== 'none' && animIter.includes('infinite');

        if (hasWc) willChangeCount += 1;
        if (hasBf) backdropFilterCount += 1;
        if (hasFlt) filterCount += 1;
        if (hasHeavyShadow) heavyBoxShadowCount += 1;
        if (hasCssInf) cssInfiniteCount += 1;

        if ((hasWc || hasBf || hasFlt || hasCssInf) && compositorSample.length < 25) {
          compositorSample.push({
            target: describeElement(el),
            willChange: hasWc ? wc : undefined,
            backdropFilter: hasBf ? bf : undefined,
            filter: hasFlt ? flt : undefined,
            cssAnimation: hasCssInf ? `${animName} (infinite)` : undefined
          });
        }
      }
    }

    const report = {
      reason,
      route: currentRouteLabel(),
      auditMs: round2(nowFn() - auditStart),
      waapiCount: waapiList.length,
      infiniteWaapiCount: infiniteCount,
      cssInfiniteCount,
      activeIntervals: state.activeIntervals.size,
      intervalDetails: Array.from(state.activeIntervals.values()),
      visibleGifCount: visibleGifs.length,
      visibleSvgCount: visibleSvgs.length,
      compositor: {
        willChangeCount,
        backdropFilterCount,
        filterCount,
        heavyBoxShadowCount
      },
      waapiAnimations: waapiList,
      visibleGifs,
      visibleSvgs,
      compositorSample
    };

    if (
      infiniteCount > 0 ||
      cssInfiniteCount > 0 ||
      waapiList.length > 10 ||
      reason === 'manual'
    ) {
      emitLog('audit', {
        reason: report.reason,
        route: report.route,
        waapi: report.waapiCount,
        infiniteWaapi: report.infiniteWaapiCount,
        cssInfinite: report.cssInfiniteCount,
        intervals: report.activeIntervals,
        gifs: report.visibleGifCount,
        svgs: report.visibleSvgCount,
        compositor: report.compositor,
        waapiNames: waapiList.map((a) => `${a.animationName}@${a.target}(${a.iterations},${a.playState})`),
        gifList: visibleGifs.map((g) => `${g.src}[${g.renderSize}/${g.naturalSize}]`)
      });
    }

    return report;
  }

  function scheduleAudit(reason, delayMs = 150) {
    if (!hasWindow) return;
    if (state.auditTimerId) {
      window.clearTimeout(state.auditTimerId);
    }
    state.auditTimerId = window.setTimeout(() => {
      state.auditTimerId = 0;
      auditActiveAnimations(reason);
    }, delayMs);
  }

  /* ==========================================================================
     Public Inspection API (window.__rrwrPerf)
     ========================================================================== */

  function getSummary() {
    const phasesObj = {};
    for (const [k, v] of state.phases.entries()) {
      phasesObj[k] = {
        count: v.count,
        avgMs: v.count > 0 ? round2(v.totalMs / v.count) : 0,
        maxMs: round2(v.maxMs),
        minMs: v.minMs === Infinity ? 0 : round2(v.minMs),
        lastMs: round2(v.lastMs),
        over12ms: v.over12ms
      };
    }
    return {
      route: currentRouteLabel(),
      phases: phasesObj,
      recentBursts: state.bursts.slice(-10),
      longTaskCount: state.longTasks.length,
      recentLongTasks: state.longTasks.slice(-10),
      activeIntervals: state.activeIntervals.size,
      audit: auditActiveAnimations('summary')
    };
  }

  function getHistory(limit = 50) {
    const n = Math.max(1, Math.min(MAX_HISTORY, Number(limit) || 50));
    return state.history.slice(-n);
  }

  function reset() {
    state.phases.clear();
    state.history.length = 0;
    state.longTasks.length = 0;
    state.bursts.length = 0;
  }

  initObservers();

  const RRWRPerf = {
    beginPhase,
    endPhase,
    measureSync,
    measureAsync,
    recordPhase: recordPhaseStat,
    setCurrentRoute,
    startBurst,
    scheduleAudit,
    auditActiveAnimations,
    emitLog,
    summary: getSummary,
    audit: (reason) => auditActiveAnimations(reason || 'manual'),
    history: getHistory,
    reset,
    triggerBurst: startBurst
  };

  root.RRWRPerf = RRWRPerf;
  if (hasWindow) {
    window.__rrwrPerf = RRWRPerf;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRPerf;
  }
})(typeof window !== 'undefined' ? window : globalThis);
