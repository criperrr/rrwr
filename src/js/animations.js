/**
 * RRWR UI Animation Engine & Tab/Scroll State Manager
 *
 * Provides:
 * - Uncapped native display refresh rate rAF interpolation and easing curves
 * - Master + granular per-category animation settings management
 * - Keyed tab bar reconciliation, FLIP motion, enter/close animations & pointer drag-reorder
 * - Per-tab & per-history-entry scroll and UI micro-state capture/restoration
 * - Boot splash, mod loader feedback, drawer/modal/collapsible/chatlog & reload icon motion
 */
(function (root) {
  'use strict';

  const CATEGORY_KEYS = [
    'tabs',
    'menus',
    'bootSplash',
    'modLoading',
    'reloadIcon',
    'uiMicro',
    'pageTransitions'
  ];

  const CORE_CATEGORIES = [
    'tabs',
    'menus',
    'bootSplash',
    'modLoading',
    'reloadIcon',
    'uiMicro'
  ];

  const DEFAULT_CATEGORIES = {
    tabs: true,
    menus: true,
    bootSplash: true,
    modLoading: true,
    reloadIcon: true,
    uiMicro: true,
    pageTransitions: false
  };

  const SNAKE_CATEGORY_ALIASES = {
    tabs: 'tabs',
    menus: 'menus',
    boot_splash: 'bootSplash',
    mod_loading: 'modLoading',
    reload_icon: 'reloadIcon',
    ui_micro: 'uiMicro',
    page_transitions: 'pageTransitions'
  };

  const MAX_SCROLL_ENTRIES = 200;

  let currentSettingsRef = null;
  let viewportBound = false;
  let scrollCaptureTimer = null;
  let restoreGeneration = 0;
  let activeRestoreUntil = 0;

  const entryScrollMap = new Map();
  const tabLatestScrollMap = new Map();
  const elementTokens = new WeakMap();
  const activeFlipCancels = new WeakMap();

  function hasDom() {
    return typeof document !== 'undefined' && typeof window !== 'undefined';
  }

  function getPerf() {
    return (typeof window !== 'undefined' && window.__rrwrPerf) || root.RRWRPerf || null;
  }

  function raf(cb) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(cb);
    }
    return setTimeout(() => cb(Date.now()), 16);
  }

  function cancelRaf(id) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(id);
    } else {
      clearTimeout(id);
    }
  }

  function nextPaintFrame() {
    return new Promise((resolve) => {
      raf(() => {
        raf(() => resolve());
      });
    });
  }

  function nextToken(el) {
    if (!el) return 0;
    const next = (elementTokens.get(el) || 0) + 1;
    elementTokens.set(el, next);
    return next;
  }

  function isCurrentToken(el, token) {
    return Boolean(el) && elementTokens.get(el) === token;
  }

  /* ==========================================================================
     1. Settings Normalization & Root Cadence Attributes
     ========================================================================== */

  function normalizeFps(_raw) {
    return 'native';
  }

  function normalizeSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      return {
        animationsEnabled: true,
        animationFps: 'native',
        animationCategories: Object.assign({}, DEFAULT_CATEGORIES)
      };
    }

    if (typeof settings.animationsEnabled !== 'boolean') {
      if (typeof settings.animations_enabled === 'boolean') {
        settings.animationsEnabled = settings.animations_enabled;
      } else {
        settings.animationsEnabled = true;
      }
    }
    delete settings.animations_enabled;

    const rawFps = settings.animationFps !== undefined ? settings.animationFps : settings.animation_fps;
    settings.animationFps = normalizeFps(rawFps);
    delete settings.animation_fps;

    const rawCats = settings.animationCategories || settings.animation_categories;
    const hasExplicitCats = Boolean(rawCats && typeof rawCats === 'object');
    const normalizedCats = Object.assign({}, DEFAULT_CATEGORIES);

    if (!hasExplicitCats && settings.animationsEnabled === false) {
      for (const k of CATEGORY_KEYS) {
        normalizedCats[k] = false;
      }
    } else if (hasExplicitCats) {
      for (const [rawKey, val] of Object.entries(rawCats)) {
        const camelKey = SNAKE_CATEGORY_ALIASES[rawKey] || rawKey;
        if (CATEGORY_KEYS.includes(camelKey) && typeof val === 'boolean') {
          normalizedCats[camelKey] = val;
        }
      }
    }

    settings.animationCategories = normalizedCats;
    delete settings.animation_categories;
    return settings;
  }

  function getActiveSettings(settingsOverride) {
    if (settingsOverride) {
      return normalizeSettings(settingsOverride);
    }
    if (currentSettingsRef) {
      return normalizeSettings(currentSettingsRef);
    }
    return normalizeSettings(null);
  }

  function isCategoryEnabled(category, settingsOverride) {
    const s = getActiveSettings(settingsOverride);
    const cats = s.animationCategories || DEFAULT_CATEGORIES;
    if (!Object.prototype.hasOwnProperty.call(cats, category)) {
      return false;
    }
    return Boolean(cats[category]);
  }

  function hasAnyActiveAnimation(settingsOverride) {
    const s = getActiveSettings(settingsOverride);
    const cats = s.animationCategories || DEFAULT_CATEGORIES;
    return CATEGORY_KEYS.some((k) => Boolean(cats[k]));
  }

  function getFpsMode(settingsOverride) {
    const s = getActiveSettings(settingsOverride);
    return normalizeFps(s.animationFps);
  }

  function applySettings(settings) {
    const s = normalizeSettings(settings);
    currentSettingsRef = s;

    if (!hasDom()) return s;

    const anyEnabled = hasAnyActiveAnimation(s);
    const fpsMode = normalizeFps(s.animationFps);
    const cats = s.animationCategories;

    const targets = [document.documentElement, document.getElementById('app')];
    for (const el of targets) {
      if (!el) continue;
      el.setAttribute('data-animations-enabled', anyEnabled ? 'true' : 'false');
      el.setAttribute('data-anim-fps', fpsMode);
      el.setAttribute('data-anim-tabs', cats.tabs ? 'true' : 'false');
      el.setAttribute('data-anim-menus', cats.menus ? 'true' : 'false');
      el.setAttribute('data-anim-bootsplash', cats.bootSplash ? 'true' : 'false');
      el.setAttribute('data-anim-modloading', cats.modLoading ? 'true' : 'false');
      el.setAttribute('data-anim-reloadicon', cats.reloadIcon ? 'true' : 'false');
      el.setAttribute('data-anim-uimicro', cats.uiMicro ? 'true' : 'false');
      el.setAttribute('data-anim-pagetransitions', cats.pageTransitions ? 'true' : 'false');
    }

    return s;
  }

  function setMasterEnabled(settings, enabled) {
    const s = normalizeSettings(settings);
    const on = Boolean(enabled);
    s.animationsEnabled = on;
    for (const key of CATEGORY_KEYS) {
      if (on) {
        s.animationCategories[key] = key === 'pageTransitions' ? false : true;
      } else {
        s.animationCategories[key] = false;
      }
    }
    return applySettings(s);
  }

  function setCategoryEnabled(settings, category, enabled) {
    const s = normalizeSettings(settings);
    if (!CATEGORY_KEYS.includes(category)) return s;
    s.animationCategories[category] = Boolean(enabled);

    const allCoreOn = CORE_CATEGORIES.every((k) => Boolean(s.animationCategories[k]));
    const allOff = CATEGORY_KEYS.every((k) => !s.animationCategories[k]);

    if (allCoreOn) {
      s.animationsEnabled = true;
    } else if (allOff) {
      s.animationsEnabled = false;
    }

    return applySettings(s);
  }

  function getMasterUiState(settings) {
    const s = normalizeSettings(settings);
    const activeCount = CATEGORY_KEYS.filter((k) => Boolean(s.animationCategories[k])).length;
    const allCoreOn = CORE_CATEGORIES.every((k) => Boolean(s.animationCategories[k]));
    return {
      checked: Boolean(s.animationsEnabled && allCoreOn),
      indeterminate: !allCoreOn && activeCount > 0,
      activeCount
    };
  }

  /* ==========================================================================
     2. Native Refresh-Rate rAF Timing & FLIP Engine
     ========================================================================== */

  function easeOutCubic(t) {
    if (t >= 1) return 1;
    const inv = 1 - t;
    return 1 - inv * inv * inv;
  }

  function easeInOutQuad(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function easeCartoonOutBack(t) {
    if (t >= 1) return 1;
    const c1 = 1.65;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }

  function easeCartoonSnap(t) {
    return easeOutCubic(t);
  }

  function animateStepped({ durationMs = 200, ease = easeOutCubic, onFrame, onComplete }) {
    let stopped = false;
    let rafId = null;
    let startTime = null;

    function tick(now) {
      if (stopped) return;
      if (startTime === null) startTime = now;
      const elapsed = Math.max(0, now - startTime);
      const rawT = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
      const eased = rawT >= 1 ? 1 : ease(rawT);

      if (onFrame) onFrame(eased, rawT);

      if (rawT >= 1) {
        stopped = true;
        if (onComplete) onComplete();
        return;
      }

      rafId = raf(tick);
    }

    rafId = raf(tick);

    return () => {
      stopped = true;
      if (rafId !== null) {
        cancelRaf(rafId);
        rafId = null;
      }
    };
  }

  function flipElements(entries, options = {}) {
    if (!hasDom() || !Array.isArray(entries) || entries.length === 0) return;
    const durationMs = options.durationMs || 210;
    const ease = options.ease || easeCartoonOutBack;

    for (const item of entries) {
      const el = item && item.element;
      const first = item && item.firstRect;
      if (!el || !first || !el.isConnected) continue;

      const prevCancel = activeFlipCancels.get(el);
      if (prevCancel) {
        prevCancel();
        activeFlipCancels.delete(el);
      }

      el.style.transform = '';
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;

      const cancel = animateStepped({
        durationMs,
        ease,
        onFrame(progress) {
          if (!el.isConnected) return;
          const curX = dx * (1 - progress);
          const curY = dy * (1 - progress);
          el.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0)`;
        },
        onComplete() {
          activeFlipCancels.delete(el);
          if (el.isConnected) {
            el.style.transform = '';
          }
        }
      });

      activeFlipCancels.set(el, cancel);
    }
  }

  /* ==========================================================================
     3. Boot Splash Overlay Controller
     ========================================================================== */

  let bootSplashDismissed = false;

  function updateBootSplash(progressPct, statusText) {
    if (!hasDom() || bootSplashDismissed) return;
    const splash = document.getElementById('boot-splash');
    if (!splash) return;

    const fill = document.getElementById('boot-splash-bar-fill');
    if (fill && typeof progressPct === 'number') {
      const clamped = Math.max(0, Math.min(100, progressPct));
      fill.style.width = `${clamped}%`;
    }

    const status = document.getElementById('boot-splash-status');
    if (status && typeof statusText === 'string' && statusText.trim()) {
      status.textContent = statusText;
    }
  }

  function dismissBootSplash(settings) {
    if (!hasDom() || bootSplashDismissed) return Promise.resolve();
    bootSplashDismissed = true;

    const splash = document.getElementById('boot-splash');
    if (!splash) return Promise.resolve();

    updateBootSplash(100, '> COLLECTION READY.');

    if (!isCategoryEnabled('bootSplash', settings)) {
      splash.remove();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let cleaned = false;
      const finish = () => {
        if (cleaned) return;
        cleaned = true;
        if (splash.isConnected) splash.remove();
        resolve();
      };

      splash.classList.add('bootSplash--exit');
      const fallbackTimer = setTimeout(finish, 320);
      splash.addEventListener('animationend', () => {
        clearTimeout(fallbackTimer);
        finish();
      }, { once: true });
    });
  }

  /* ==========================================================================
     4. Scroll & UI Micro-State Persistence per Tab & History Entry
     ========================================================================== */

  function makeEntryKey(tabKey, historyLen, url) {
    return `${String(tabKey || '000')}::${Number(historyLen) || 0}::${String(url || '/')}`;
  }

  function touchScrollEntry(key, snapshot) {
    if (entryScrollMap.has(key)) {
      entryScrollMap.delete(key);
    }
    entryScrollMap.set(key, snapshot);
    while (entryScrollMap.size > MAX_SCROLL_ENTRIES) {
      const oldestKey = entryScrollMap.keys().next().value;
      if (oldestKey === undefined) break;
      entryScrollMap.delete(oldestKey);
    }
  }

  function readOpenLogIndices() {
    if (!hasDom()) return null;
    const logs = document.querySelectorAll('#text-container .log');
    if (!logs || logs.length === 0) return null;
    const openIndices = [];
    logs.forEach((logBox, idx) => {
      const content = logBox.querySelector('.logContent');
      if (content && content.style.display === 'block') {
        openIndices.push(idx);
      }
    });
    return openIndices;
  }

  function readRouteMicroState() {
    if (!hasDom()) return {};
    const micro = {};
    const musicInput = document.getElementById('music-filter-input');
    if (musicInput && musicInput.value) {
      micro.musicFilter = musicInput.value;
    }
    const searchInput = document.getElementById('story-search-input');
    if (searchInput && searchInput.value) {
      micro.searchQuery = searchInput.value;
    }
    const openLogs = readOpenLogIndices();
    if (openLogs !== null) {
      micro.openLogs = openLogs;
    }
    return micro;
  }

  function captureScrollState(tab) {
    if (!hasDom() || !tab || !tab.key) return null;
    const viewport = document.getElementById('tab-viewport');
    const hscrollFrame = document.querySelector('#page-frame.hscrollFrame');
    const docScroll = document.scrollingElement || document.documentElement;

    const scrollTop = viewport
      ? viewport.scrollTop
      : (docScroll ? docScroll.scrollTop : 0);
    const scrollLeft = hscrollFrame
      ? hscrollFrame.scrollLeft
      : (viewport ? viewport.scrollLeft : 0);

    const historyLen = Array.isArray(tab.history) ? tab.history.length : 0;
    const entryKey = makeEntryKey(tab.key, historyLen, tab.url || '/');

    const snapshot = {
      scrollTop: Math.max(0, Number(scrollTop) || 0),
      scrollLeft: Math.max(0, Number(scrollLeft) || 0),
      hscrollLeft: hscrollFrame ? Math.max(0, Number(hscrollFrame.scrollLeft) || 0) : 0,
      micro: readRouteMicroState(),
      updatedAt: Date.now()
    };

    touchScrollEntry(entryKey, snapshot);
    tabLatestScrollMap.set(tab.key, snapshot);
    tab._scrollTop = snapshot.scrollTop;
    tab._scrollLeft = snapshot.scrollLeft;
    return snapshot;
  }

  function pruneForwardScrollStates(tabKey, fromHistoryLen) {
    if (!tabKey) return;
    const prefix = `${tabKey}::`;
    for (const k of Array.from(entryScrollMap.keys())) {
      if (!k.startsWith(prefix)) continue;
      const parts = k.split('::');
      const idx = parseInt(parts[1], 10);
      if (!Number.isNaN(idx) && idx >= fromHistoryLen) {
        entryScrollMap.delete(k);
      }
    }
  }

  function clearTabScrollStates(tabKey) {
    if (!tabKey) return;
    const prefix = `${tabKey}::`;
    for (const k of Array.from(entryScrollMap.keys())) {
      if (k.startsWith(prefix)) {
        entryScrollMap.delete(k);
      }
    }
    tabLatestScrollMap.delete(tabKey);
  }

  function applyScrollCoordinates(snapshot) {
    if (!hasDom()) return;
    const viewport = document.getElementById('tab-viewport');
    const hscrollFrame = document.querySelector('#page-frame.hscrollFrame');
    const topVal = snapshot ? (Number(snapshot.scrollTop) || 0) : 0;
    const leftVal = snapshot ? (Number(snapshot.scrollLeft) || 0) : 0;
    const hscrollVal = snapshot ? (Number(snapshot.hscrollLeft) || 0) : 0;

    if (viewport) {
      viewport.scrollTop = topVal;
      if (!hscrollFrame) {
        viewport.scrollLeft = leftVal;
      }
    }
    if (hscrollFrame) {
      hscrollFrame.scrollLeft = hscrollVal || leftVal;
    }
  }

  function applyRouteMicroState(micro) {
    if (!hasDom() || !micro || typeof micro !== 'object') return;

    if (typeof micro.musicFilter === 'string') {
      const musicInput = document.getElementById('music-filter-input');
      if (musicInput && musicInput.value !== micro.musicFilter) {
        musicInput.value = micro.musicFilter;
        musicInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (typeof micro.searchQuery === 'string') {
      const searchInput = document.getElementById('story-search-input');
      if (searchInput && searchInput.value !== micro.searchQuery) {
        searchInput.value = micro.searchQuery;
      }
    }

    if (Array.isArray(micro.openLogs) && micro.openLogs.length > 0) {
      const logBoxes = document.querySelectorAll('#text-container .log');
      micro.openLogs.forEach((idx) => {
        const box = logBoxes[idx];
        if (!box) return;
        const btn = box.querySelector('.logButton');
        const content = box.querySelector('.logContent');
        if (btn && content && content.style.display === 'none') {
          btn.click();
        }
      });
    }
  }

  function restoreScrollState(tab, options = {}) {
    if (!hasDom()) return;
    const myGen = ++restoreGeneration;
    const preserveScroll = Boolean(options.preserveScroll);

    let snapshot = null;
    if (tab && tab.key) {
      const historyLen = Array.isArray(tab.history) ? tab.history.length : 0;
      const entryKey = makeEntryKey(tab.key, historyLen, tab.url || '/');
      snapshot = entryScrollMap.get(entryKey) || (preserveScroll ? tabLatestScrollMap.get(tab.key) : null);
      if (!snapshot && typeof tab._scrollTop === 'number' && preserveScroll) {
        snapshot = { scrollTop: tab._scrollTop, scrollLeft: tab._scrollLeft || 0 };
      }
    }

    if (!snapshot) {
      applyScrollCoordinates({ scrollTop: 0, scrollLeft: 0, hscrollLeft: 0 });
      return;
    }

    applyRouteMicroState(snapshot.micro);

    const targetTop = Number(snapshot.scrollTop) || 0;
    const targetLeft = Number(snapshot.scrollLeft) || 0;
    if (targetTop === 0 && targetLeft === 0 && !(snapshot.hscrollLeft > 0)) {
      applyScrollCoordinates(snapshot);
      return;
    }

    const viewport = document.getElementById('tab-viewport');
    let userInteracted = false;
    const cancelWatchers = [];

    const markUserInteracted = () => {
      userInteracted = true;
      activeRestoreUntil = 0;
      cleanupWatchers();
    };

    const cleanupWatchers = () => {
      while (cancelWatchers.length > 0) {
        const fn = cancelWatchers.pop();
        try {
          fn();
        } catch (_) {}
      }
    };

    activeRestoreUntil = Date.now() + 250;

    if (viewport) {
      viewport.addEventListener('wheel', markUserInteracted, { passive: true, once: true });
      viewport.addEventListener('touchstart', markUserInteracted, { passive: true, once: true });
      viewport.addEventListener('pointerdown', markUserInteracted, { passive: true, once: true });
      cancelWatchers.push(() => {
        viewport.removeEventListener('wheel', markUserInteracted);
        viewport.removeEventListener('touchstart', markUserInteracted);
        viewport.removeEventListener('pointerdown', markUserInteracted);
      });
    }

    const tryApply = () => {
      if (myGen !== restoreGeneration || userInteracted) return;
      applyScrollCoordinates(snapshot);
    };

    tryApply();
    raf(() => {
      tryApply();
      raf(() => {
        tryApply();
      });
    });

    const pageContent = document.getElementById('page-content');
    if (pageContent) {
      const imgs = pageContent.querySelectorAll('img');
      imgs.forEach((img) => {
        if (!img.complete) {
          const onImgLoad = () => tryApply();
          img.addEventListener('load', onImgLoad, { once: true });
          img.addEventListener('error', onImgLoad, { once: true });
          cancelWatchers.push(() => {
            img.removeEventListener('load', onImgLoad);
            img.removeEventListener('error', onImgLoad);
          });
        }
      });
    }

    const expireTimer = setTimeout(cleanupWatchers, 750);
    cancelWatchers.push(() => clearTimeout(expireTimer));
  }

  function bindViewportScrollTracker(getActiveTabFn) {
    if (!hasDom() || viewportBound) return;
    const viewport = document.getElementById('tab-viewport');
    if (!viewport) return;
    viewportBound = true;

    viewport.addEventListener('scroll', () => {
      if (Date.now() < activeRestoreUntil) return;
      if (scrollCaptureTimer !== null) return;
      scrollCaptureTimer = setTimeout(() => {
        scrollCaptureTimer = null;
        if (Date.now() < activeRestoreUntil) return;
        const tab = typeof getActiveTabFn === 'function' ? getActiveTabFn() : null;
        if (tab) {
          captureScrollState(tab);
        }
      }, 60);
    }, { passive: true });
  }

  /* ==========================================================================
     5. Tab Bar Keyed Reconciler, FLIP, Closing Guards & Drag Reorder
     ========================================================================== */

  const closingShellTimers = new Map();
  let pendingEnterTabKey = null;
  let pendingActivatedTabKey = null;
  let lastRenderedActiveKey = null;
  let suppressTabClickUntil = 0;
  let tabSyncContext = {
    tabData: null,
    activeTabKey: null,
    onSelectTab: null,
    onCloseTab: null,
    onReorder: null
  };

  function markTabEntering(key) {
    pendingEnterTabKey = key;
  }

  function markTabActivated(key) {
    pendingActivatedTabKey = key;
  }

  function animateTabClose(key) {
    if (!hasDom() || !key) return;
    if (!isCategoryEnabled('tabs')) return;
    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('animateTabClose', { key }) : null;
    const tabListEl = document.getElementById('tabs') || document.getElementById('tab-list');
    if (!tabListEl) {
      if (perf) perf.endPhase(perfTok);
      return;
    }

    const shell = tabListEl.querySelector(`.tabShell[data-tab-key="${CSS.escape ? CSS.escape(key) : key}"]:not([data-closing="true"])`);
    if (!shell) {
      if (perf) perf.endPhase(perfTok);
      return;
    }

    if (closingShellTimers.has(key)) {
      clearTimeout(closingShellTimers.get(key));
      closingShellTimers.delete(key);
    }

    shell.setAttribute('data-closing', 'true');
    shell.classList.remove('activeTabShell', 'tab-entering');
    shell.classList.add('tab-closing');
    shell.style.pointerEvents = 'none';

    const innerTab = shell.querySelector('.tab');
    if (innerTab) {
      innerTab.classList.remove('tab', 'activeTab');
      innerTab.classList.add('tabClosingGhost');
      innerTab.removeAttribute('data-tab-key');
    }

    const removeTimer = setTimeout(() => {
      closingShellTimers.delete(key);
      if (shell.isConnected) {
        shell.remove();
      }
    }, 190);
    closingShellTimers.set(key, removeTimer);
    if (perf) perf.endPhase(perfTok);
  }

  function attachTabDragHandlers(tabEl, key, context) {
    if (!tabEl || tabEl.dataset.dragBound === 'true') return;
    tabEl.dataset.dragBound = 'true';

    tabEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.closeTabButton')) return;

      const tabData = context.getTabData ? context.getTabData() : null;
      if (!tabData || !Array.isArray(tabData.tabList) || tabData.tabList.length <= 1) return;

      const tabListEl = tabEl.closest('#tabs, #tab-list');
      const shell = tabEl.closest('.tabShell');
      if (!tabListEl || !shell || shell.getAttribute('data-closing') === 'true') return;

      const isTouch = e.pointerType === 'touch';
      const startX = e.clientX;
      const startY = e.clientY;
      let dragOriginX = startX;
      let dragActive = false;
      let touchHoldReady = !isTouch;
      let touchHoldTimer = null;
      let dragRafPending = false;
      let latestClientX = startX;
      let reordered = false;

      if (isTouch) {
        touchHoldTimer = setTimeout(() => {
          touchHoldReady = true;
        }, 180);
      }

      const cleanupListeners = () => {
        if (touchHoldTimer) {
          clearTimeout(touchHoldTimer);
          touchHoldTimer = null;
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
      };

      const applyDragFrame = () => {
        dragRafPending = false;
        if (!dragActive || !shell.isConnected) return;

        const dx = latestClientX - dragOriginX;
        shell.style.transform = `translate3d(${dx}px, -1px, 0)`;

        const draggedRect = shell.getBoundingClientRect();
        const draggedCenter = draggedRect.left + draggedRect.width / 2;

        const siblingShells = Array.from(tabListEl.children).filter(
          (node) => node.classList.contains('tabShell') && node.getAttribute('data-closing') !== 'true'
        );
        const curIdx = siblingShells.indexOf(shell);
        if (curIdx === -1) return;

        let targetIdx = curIdx;
        if (curIdx > 0) {
          const leftRect = siblingShells[curIdx - 1].getBoundingClientRect();
          if (draggedCenter < leftRect.left + leftRect.width * 0.52) {
            targetIdx = curIdx - 1;
          }
        }
        if (targetIdx === curIdx && curIdx < siblingShells.length - 1) {
          const rightRect = siblingShells[curIdx + 1].getBoundingClientRect();
          if (draggedCenter > rightRect.left + rightRect.width * 0.48) {
            targetIdx = curIdx + 1;
          }
        }

        if (targetIdx !== curIdx) {
          const firstSiblings = siblingShells
            .filter((s) => s !== shell)
            .map((s) => ({ element: s, firstRect: s.getBoundingClientRect() }));

          const beforeShellLeft = shell.getBoundingClientRect().left;
          const targetSibling = siblingShells[targetIdx];
          if (targetIdx < curIdx) {
            tabListEl.insertBefore(shell, targetSibling);
          } else {
            tabListEl.insertBefore(shell, targetSibling.nextSibling);
          }

          const listArr = tabData.tabList;
          const modelCur = listArr.indexOf(key);
          const targetKey = targetSibling.getAttribute('data-tab-key');
          const modelTarget = listArr.indexOf(targetKey);
          if (modelCur !== -1 && modelTarget !== -1) {
            listArr.splice(modelCur, 1);
            listArr.splice(modelTarget, 0, key);
            reordered = true;
          }

          shell.style.transform = '';
          const afterShellLeft = shell.getBoundingClientRect().left;
          const shiftCompensation = afterShellLeft - beforeShellLeft;
          dragOriginX += shiftCompensation;
          const newDx = latestClientX - dragOriginX;
          shell.style.transform = `translate3d(${newDx}px, -1px, 0)`;

          if (isCategoryEnabled('tabs')) {
            flipElements(firstSiblings, { durationMs: 185, ease: easeCartoonOutBack });
          }
        }
      };

      const onPointerMove = (moveEvt) => {
        const dx = moveEvt.clientX - startX;
        const dy = moveEvt.clientY - startY;

        if (!dragActive) {
          if (!touchHoldReady) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
              cleanupListeners();
            }
            return;
          }
          if (Math.abs(dx) < 6) {
            if (Math.abs(dy) > 12) cleanupListeners();
            return;
          }
          dragActive = true;
          suppressTabClickUntil = Date.now() + 250;
          shell.classList.add('tab-dragging');
          tabListEl.classList.add('tabs-reordering');
          if (context.onSelectTab && context.getActiveKey && context.getActiveKey() !== key) {
            context.onSelectTab(key);
          }
        }

        latestClientX = moveEvt.clientX;
        if (!dragRafPending) {
          dragRafPending = true;
          raf(applyDragFrame);
        }
      };

      const finishDrag = () => {
        cleanupListeners();
        if (!dragActive) return;

        suppressTabClickUntil = Date.now() + 180;
        const startRect = shell.getBoundingClientRect();
        shell.classList.remove('tab-dragging');
        tabListEl.classList.remove('tabs-reordering');
        shell.style.transform = '';

        if (isCategoryEnabled('tabs')) {
          flipElements([{ element: shell, firstRect: startRect }], {
            durationMs: 180,
            ease: easeCartoonOutBack
          });
        }

        if (reordered && typeof context.onReorder === 'function') {
          context.onReorder(tabData.tabList);
        }
      };

      const onPointerUp = () => finishDrag();
      const onPointerCancel = () => finishDrag();

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp, { passive: true });
      window.addEventListener('pointercancel', onPointerCancel, { passive: true });
    });
  }

  function syncTabBar(options) {
    if (!hasDom()) return;
    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('syncTabBar') : null;
    const {
      tabListEl,
      tabData,
      activeTabKey,
      onSelectTab,
      onCloseTab,
      onReorder
    } = options;

    if (!tabListEl || !tabData || !Array.isArray(tabData.tabList)) {
      if (perf) perf.endPhase(perfTok);
      return;
    }

    tabSyncContext.tabData = tabData;
    tabSyncContext.activeTabKey = activeTabKey;
    tabSyncContext.onSelectTab = onSelectTab;
    tabSyncContext.onCloseTab = onCloseTab;
    tabSyncContext.onReorder = onReorder;

    const tabsEnabled = isCategoryEnabled('tabs');
    const existingByKey = new Map();
    const firstRects = [];

    for (const child of Array.from(tabListEl.children)) {
      if (!child.classList.contains('tabShell')) continue;
      if (child.getAttribute('data-closing') === 'true') {
        const closingKey = child.getAttribute('data-tab-key');
        if (closingKey && tabData.tabList.includes(closingKey)) {
          if (closingShellTimers.has(closingKey)) {
            clearTimeout(closingShellTimers.get(closingKey));
            closingShellTimers.delete(closingKey);
          }
          child.remove();
        }
        continue;
      }
      const k = child.getAttribute('data-tab-key') || (child.querySelector('.tab') && child.querySelector('.tab').getAttribute('data-tab-key'));
      if (k) {
        existingByKey.set(k, child);
        firstRects.push({ element: child, firstRect: child.getBoundingClientRect() });
      }
    }

    const activeSet = new Set(tabData.tabList);
    for (const [k, node] of existingByKey.entries()) {
      if (!activeSet.has(k)) {
        node.remove();
        existingByKey.delete(k);
      }
    }

    const showClose = tabData.tabList.length > 1;
    let insertAnchor = null;

    for (let i = 0; i < tabData.tabList.length; i++) {
      const key = tabData.tabList[i];
      const tab = tabData.tabs[key];
      if (!tab) continue;

      let shell = existingByKey.get(key);
      let tabEl;
      let textSpan;
      let isNewNode = false;

      if (!shell) {
        isNewNode = true;
        shell = document.createElement('li');
        shell.className = 'tabShell';
        shell.setAttribute('data-tab-key', key);

        tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.setAttribute('data-tab-key', key);
        tabEl.setAttribute('role', 'tab');

        const titleDiv = document.createElement('div');
        titleDiv.className = 'tabTitle';
        textSpan = document.createElement('span');
        titleDiv.appendChild(textSpan);
        tabEl.appendChild(titleDiv);

        shell.appendChild(tabEl);
      } else {
        shell.setAttribute('data-tab-key', key);
        tabEl = shell.querySelector('.tab');
        if (tabEl) {
          tabEl.setAttribute('data-tab-key', key);
        }
        textSpan = shell.querySelector('.tabTitle span');
      }

      if (tabEl && tabEl.dataset.tabBound !== 'true') {
        tabEl.dataset.tabBound = 'true';
        tabEl.addEventListener('click', () => {
          if (Date.now() < suppressTabClickUntil) return;
          const curKey = tabEl.getAttribute('data-tab-key') || key;
          if (typeof tabSyncContext.onSelectTab === 'function') {
            tabSyncContext.onSelectTab(curKey);
          }
        });

        attachTabDragHandlers(tabEl, key, {
          getTabData: () => tabSyncContext.tabData,
          getActiveKey: () => tabSyncContext.activeTabKey,
          onSelectTab: (targetKey) => {
            if (typeof tabSyncContext.onSelectTab === 'function') {
              tabSyncContext.onSelectTab(targetKey);
            }
          },
          onReorder: (list) => {
            if (typeof tabSyncContext.onReorder === 'function') {
              tabSyncContext.onReorder(list);
            }
          }
        });
      }

      const isActive = key === activeTabKey;
      shell.classList.toggle('activeTabShell', isActive);
      if (tabEl) {
        tabEl.classList.toggle('activeTab', isActive);
        tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      if (textSpan) {
        textSpan.textContent = tab.title || 'RRWR';
      }

      let closeBtn = tabEl ? tabEl.querySelector('.closeTabButton') : null;
      if (showClose && tabEl) {
        if (!closeBtn) {
          closeBtn = document.createElement('div');
          closeBtn.className = 'systemButton closeTabButton';
          closeBtn.title = 'Close Tab (Ctrl+W)';
          closeBtn.textContent = '\u00D7';
          tabEl.appendChild(closeBtn);
        }
        if (closeBtn.dataset.closeBound !== 'true') {
          closeBtn.dataset.closeBound = 'true';
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const curKey = (tabEl && tabEl.getAttribute('data-tab-key')) || key;
            if (typeof tabSyncContext.onCloseTab === 'function') {
              tabSyncContext.onCloseTab(curKey);
            }
          });
        }
      } else if (!showClose && closeBtn) {
        closeBtn.remove();
      }

      const refNode = insertAnchor ? insertAnchor.nextSibling : tabListEl.firstChild;
      if (shell !== refNode) {
        tabListEl.insertBefore(shell, refNode);
      }
      insertAnchor = shell;

      const isEnteringTab = isNewNode || pendingEnterTabKey === key;
      if (tabsEnabled && isEnteringTab) {
        const enterTok = perf ? perf.beginPhase('animateTabEnter', { key }) : null;
        if (!isNewNode) {
          shell.classList.remove('tab-entering');
          void shell.offsetWidth;
        }
        shell.classList.add('tab-entering');
        setTimeout(() => {
          if (shell.isConnected) shell.classList.remove('tab-entering');
        }, 235);
        if (perf) perf.endPhase(enterTok);
      }

      if (tabsEnabled && isActive && !isEnteringTab && (pendingActivatedTabKey === key || (lastRenderedActiveKey && lastRenderedActiveKey !== activeTabKey))) {
        if (tabEl) {
          tabEl.classList.remove('tab-activate-pop');
          void tabEl.offsetWidth;
          tabEl.classList.add('tab-activate-pop');
          setTimeout(() => {
            if (tabEl.isConnected) tabEl.classList.remove('tab-activate-pop');
          }, 190);
        }
      }
    }

    if (tabsEnabled && firstRects.length > 0 && !tabListEl.classList.contains('tabs-reordering')) {
      const movedEntries = firstRects.filter((item) => item.element.isConnected);
      flipElements(movedEntries, { durationMs: 200, ease: easeCartoonOutBack });
    }

    pendingEnterTabKey = null;
    pendingActivatedTabKey = null;
    lastRenderedActiveKey = activeTabKey;
    if (perf) perf.endPhase(perfTok, { tabCount: tabData.tabList.length });
  }

  function pulseNewTabButton() {
    if (!hasDom() || !isCategoryEnabled('tabs')) return;
    const btn = document.getElementById('new-tab-btn');
    if (!btn) return;
    btn.classList.remove('newTabButton--pop');
    void btn.offsetWidth;
    btn.classList.add('newTabButton--pop');
    setTimeout(() => {
      if (btn.isConnected) btn.classList.remove('newTabButton--pop');
    }, 190);
  }

  /* ==========================================================================
     6. Drawers, Lightbox, Collapsibles & Chatlogs
     ========================================================================== */

  function setDrawerOpen(drawerEl, shouldOpen) {
    if (!hasDom() || !drawerEl) return false;

    const currentlyHidden = drawerEl.classList.contains('hidden') || drawerEl.classList.contains('drawer-closing');
    const open = shouldOpen === null || shouldOpen === undefined ? currentlyHidden : Boolean(shouldOpen);
    const token = nextToken(drawerEl);

    if (open) {
      drawerEl.classList.remove('hidden', 'drawer-closing');
      if (isCategoryEnabled('menus')) {
        drawerEl.classList.remove('drawer-open');
        void drawerEl.offsetWidth;
        drawerEl.classList.add('drawer-open');
      } else {
        drawerEl.classList.remove('drawer-open');
      }
      return true;
    }

    drawerEl.classList.remove('drawer-open');
    if (!isCategoryEnabled('menus') || drawerEl.classList.contains('hidden')) {
      drawerEl.classList.remove('drawer-closing');
      drawerEl.classList.add('hidden');
      return false;
    }

    drawerEl.classList.add('drawer-closing');
    setTimeout(() => {
      if (!isCurrentToken(drawerEl, token)) return;
      drawerEl.classList.remove('drawer-closing');
      drawerEl.classList.add('hidden');
    }, 185);

    return false;
  }

  function openLightbox(modalEl) {
    if (!hasDom() || !modalEl) return;
    nextToken(modalEl);
    modalEl.classList.remove('hidden', 'lightbox-closing');
    if (isCategoryEnabled('menus')) {
      modalEl.classList.remove('lightbox-open');
      void modalEl.offsetWidth;
      modalEl.classList.add('lightbox-open');
    } else {
      modalEl.classList.add('lightbox-open');
    }
  }

  function closeLightbox(modalEl, onClosed) {
    if (!hasDom() || !modalEl) return;
    const token = nextToken(modalEl);
    modalEl.classList.remove('lightbox-open');

    if (!isCategoryEnabled('menus') || modalEl.classList.contains('hidden')) {
      modalEl.classList.remove('lightbox-closing');
      modalEl.classList.add('hidden');
      if (onClosed) onClosed();
      return;
    }

    modalEl.classList.add('lightbox-closing');
    setTimeout(() => {
      if (!isCurrentToken(modalEl, token)) return;
      modalEl.classList.remove('lightbox-closing');
      modalEl.classList.add('hidden');
      if (onClosed) onClosed();
    }, 185);
  }

  function setSoundTestVisible(barEl, visible) {
    if (!hasDom() || !barEl) return;
    const token = nextToken(barEl);

    if (visible) {
      barEl.classList.remove('hidden', 'soundbar-closing');
      if (isCategoryEnabled('uiMicro') || isCategoryEnabled('menus')) {
        barEl.classList.remove('soundbar-open');
        void barEl.offsetWidth;
        barEl.classList.add('soundbar-open');
      } else {
        barEl.classList.add('soundbar-open');
      }
      return;
    }

    barEl.classList.remove('soundbar-open', 'is-playing');
    if ((!isCategoryEnabled('uiMicro') && !isCategoryEnabled('menus')) || barEl.classList.contains('hidden')) {
      barEl.classList.remove('soundbar-closing');
      barEl.classList.add('hidden');
      return;
    }

    barEl.classList.add('soundbar-closing');
    setTimeout(() => {
      if (!isCurrentToken(barEl, token)) return;
      barEl.classList.remove('soundbar-closing');
      barEl.classList.add('hidden');
    }, 185);
  }

  function setSoundTestPlaying(barEl, playing) {
    if (!hasDom() || !barEl) return;
    barEl.classList.toggle('is-playing', Boolean(playing));
  }

  function animateCollapsible(bodyEl, expand, options = {}) {
    if (!hasDom() || !bodyEl) return;
    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('animateCollapsible', { expand: Boolean(expand) }) : null;
    const category = options.category || 'menus';
    const displayMode = options.displayMode || 'block';
    const durationMs = options.durationMs || 210;
    const token = nextToken(bodyEl);

    if (!isCategoryEnabled(category)) {
      bodyEl.style.maxHeight = '';
      bodyEl.style.overflow = '';
      bodyEl.style.opacity = '';
      bodyEl.style.transform = '';
      bodyEl.style.willChange = '';
      bodyEl.style.display = expand ? displayMode : 'none';
      if (options.onDone) options.onDone();
      if (perf) perf.endPhase(perfTok);
      return;
    }

    if (expand) {
      bodyEl.style.display = displayMode;
      bodyEl.style.overflow = 'hidden';
      const targetHeight = Math.max(24, bodyEl.scrollHeight || 0);
      bodyEl.style.transformOrigin = 'top center';
      bodyEl.style.willChange = 'max-height, transform, opacity';
      if (perf) perf.endPhase(perfTok, { targetHeight });

      animateStepped({
        durationMs: Math.max(160, durationMs),
        ease: easeOutCubic,
        onFrame(progress, tNorm) {
          if (!isCurrentToken(bodyEl, token) || !bodyEl.isConnected) return;
          const heightRatio = Math.min(1, Math.max(0.05, progress));
          const h = Math.round(targetHeight * heightRatio);
          const pulse = tNorm >= 1 ? 0 : Math.sin(tNorm * Math.PI * 1.8) * (1 - tNorm) * 0.015;
          const sx = (1 - pulse).toFixed(4);
          const sy = (1 + pulse * 1.15).toFixed(4);
          bodyEl.style.maxHeight = `${h}px`;
          bodyEl.style.opacity = String(Math.min(1, 0.25 + 0.75 * easeInOutQuad(tNorm)));
          bodyEl.style.transform = `scaleX(${sx}) scaleY(${sy})`;
        },
        onComplete() {
          if (!isCurrentToken(bodyEl, token) || !bodyEl.isConnected) return;
          bodyEl.style.maxHeight = '';
          bodyEl.style.overflow = '';
          bodyEl.style.opacity = '';
          bodyEl.style.transform = '';
          bodyEl.style.transformOrigin = '';
          bodyEl.style.willChange = '';
          if (options.onDone) options.onDone();
        }
      });
      return;
    }

    const startHeight = Math.max(0, bodyEl.scrollHeight || bodyEl.offsetHeight || 0);
    if (perf) perf.endPhase(perfTok, { startHeight });
    if (startHeight <= 0) {
      bodyEl.style.display = 'none';
      bodyEl.style.willChange = '';
      if (options.onDone) options.onDone();
      return;
    }

    bodyEl.style.overflow = 'hidden';
    bodyEl.style.maxHeight = `${startHeight}px`;
    bodyEl.style.opacity = '1';
    bodyEl.style.transformOrigin = 'top center';
    bodyEl.style.willChange = 'max-height, transform, opacity';

    animateStepped({
      durationMs: Math.max(140, durationMs - 35),
      ease: easeInOutQuad,
      onFrame(progress, tNorm) {
        if (!isCurrentToken(bodyEl, token) || !bodyEl.isConnected) return;
        const remain = tNorm >= 1 ? 0 : Math.max(0, 1 - progress);
        const pulse = tNorm >= 1 ? 0 : Math.sin(tNorm * Math.PI * 1.4) * (1 - tNorm) * 0.012;
        const sx = (1 + pulse).toFixed(4);
        const sy = (1 - pulse).toFixed(4);
        bodyEl.style.maxHeight = `${Math.round(startHeight * remain)}px`;
        bodyEl.style.opacity = String(Math.max(0.1, 1 - tNorm * 0.9));
        bodyEl.style.transform = `scaleX(${sx}) scaleY(${sy})`;
      },
      onComplete() {
        if (!isCurrentToken(bodyEl, token) || !bodyEl.isConnected) return;
        bodyEl.style.display = 'none';
        bodyEl.style.maxHeight = '';
        bodyEl.style.overflow = '';
        bodyEl.style.opacity = '';
        bodyEl.style.transform = '';
        bodyEl.style.transformOrigin = '';
        bodyEl.style.willChange = '';
        if (options.onDone) options.onDone();
      }
    });
  }

  /* ==========================================================================
     7. Mod Loading Overlay, Reload Spin & Optional Page Transitions
     ========================================================================== */

  function showStatusToast(message, variant = 'info', durationMs = 1300) {
    if (!hasDom()) return null;
    const existing = document.getElementById('rrwr-cartoon-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'rrwr-cartoon-toast';
    toast.className = `rrwrCartoonToast rrwrCartoonToast--${variant}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'rrwrCartoonToastIcon';
    icon.textContent = variant === 'error' ? '[!]' : '[OK]';

    const label = document.createElement('span');
    label.className = 'rrwrCartoonToastText';
    label.textContent = String(message || '');

    toast.appendChild(icon);
    toast.appendChild(label);
    document.body.appendChild(toast);

    if (durationMs > 0) {
      setTimeout(() => {
        if (!toast.isConnected) return;
        toast.classList.add('rrwrCartoonToast--exit');
        setTimeout(() => {
          if (toast.isConnected) toast.remove();
        }, 180);
      }, durationMs);
    }
    return toast;
  }

  async function beginModLoading(modTitle, enabling, options = {}) {
    if (!hasDom()) return null;

    const animEnabled = isCategoryEnabled('modLoading');
    const modsList = document.getElementById('mods-list');
    const titleStr = String(modTitle || 'COMMUNITY MODS');
    const isBatch = Boolean(options.batch);
    const headlineText = options.headline
      ? String(options.headline)
      : (isBatch ? titleStr.toUpperCase() : `${enabling ? 'ENABLING' : 'DISABLING'}: ${titleStr}`);
    const statusText = options.statusText
      ? String(options.statusText)
      : '> RECALIBRATING VFS & STORY HOOKS...';
    const progressPct = typeof options.progressPct === 'number' ? options.progressPct : 24;

    if (modsList) {
      modsList.classList.add('mods-busy');
    }

    let overlay = document.getElementById('rrwr-mod-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rrwr-mod-loading-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-label', 'Applying Community Mods');

      overlay.innerHTML = `
        <div class="bootSplashBackdrop"></div>
        <div class="bootSplashCard">
          <div class="bootSplashTopRule">
            <span class="bootSplashTag">RRWR // MOD ENGINE REBUILD</span>
            <span class="bootSplashTag">APPLYING MODS</span>
          </div>
          <div class="bootSplashHero">
            <div class="bootSplashEmblemWrap" aria-hidden="true">
              <svg class="bootSplashEmblemSvg" viewBox="0 0 64 64" width="60" height="60">
                <rect x="14" y="10" width="40" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2" opacity="0.45" />
                <rect x="10" y="14" width="40" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2.5" />
                <polygon points="24,25 41,34 24,43" fill="currentColor" />
              </svg>
            </div>
            <div class="bootSplashTitleGroup">
              <div id="rrwr-mod-loading-headline" class="bootSplashHeadline"></div>
            </div>
          </div>
          <div class="bootSplashProgressTrack">
            <div id="rrwr-mod-loading-bar-fill" class="bootSplashProgressFill" style="width: 24%;"></div>
          </div>
          <div id="rrwr-mod-loading-status" class="bootSplashStatus"></div>
        </div>
      `;

      document.body.appendChild(overlay);
    }

    nextToken(overlay);
    overlay.className = animEnabled
      ? 'bootSplash modSplash'
      : 'bootSplash modSplash modSplash--static';

    updateModLoading(progressPct, statusText, headlineText);

    if (!document.hidden) {
      await nextPaintFrame();
    }
    return overlay;
  }

  function updateModLoading(progressPct, statusText, headlineText) {
    if (!hasDom()) return;
    const overlay = document.getElementById('rrwr-mod-loading-overlay');
    if (!overlay) return;

    if (typeof headlineText === 'string' && headlineText.trim()) {
      const headEl = overlay.querySelector('#rrwr-mod-loading-headline');
      if (headEl) headEl.textContent = headlineText;
    }

    if (typeof progressPct === 'number') {
      const fill = overlay.querySelector('#rrwr-mod-loading-bar-fill');
      if (fill) {
        fill.style.width = `${Math.max(0, Math.min(100, progressPct))}%`;
      }
    }

    if (typeof statusText === 'string' && statusText.trim()) {
      const statusEl = overlay.querySelector('#rrwr-mod-loading-status');
      if (statusEl) statusEl.textContent = statusText;
    }
  }

  function endModLoading(overlay, success = true, message = '') {
    if (!hasDom()) return;
    const modsList = document.getElementById('mods-list');
    if (modsList) {
      modsList.classList.remove('mods-busy');
    }

    const target = (overlay && overlay.isConnected)
      ? overlay
      : document.getElementById('rrwr-mod-loading-overlay');
    const animEnabled = isCategoryEnabled('modLoading');

    if (target) {
      const token = nextToken(target);
      updateModLoading(100, success ? '> MOD ENGINE READY.' : '> MOD UPDATE FAILED.');

      if (!animEnabled) {
        target.remove();
        if (message) {
          showStatusToast(message, success ? 'success' : 'error', 1400);
        }
        return;
      }

      let removed = false;
      const cleanup = () => {
        if (removed) return;
        removed = true;
        if (isCurrentToken(target, token) && target.isConnected) {
          target.remove();
        }
        if (message) {
          showStatusToast(message, success ? 'success' : 'error', 1500);
        }
      };

      setTimeout(() => {
        if (!isCurrentToken(target, token) || !target.isConnected) return;
        target.classList.add('bootSplash--exit');
        target.addEventListener('animationend', cleanup, { once: true });
        setTimeout(cleanup, 190);
      }, 80);
      return;
    }

    if (message && animEnabled) {
      showStatusToast(message, success ? 'success' : 'error', 1400);
    }
  }

  function triggerReloadSpin() {
    if (!hasDom() || !isCategoryEnabled('reloadIcon')) return;
    const btn = document.getElementById('nav-reload-btn');
    if (!btn) return;
    btn.classList.remove('is-reload-done', 'is-reloading');
    void btn.offsetWidth;
    btn.classList.add('is-reloading');
  }

  function finishReloadSpin() {
    if (!hasDom()) return;
    const btn = document.getElementById('nav-reload-btn');
    if (!btn) return;
    btn.classList.remove('is-reloading');
    if (!isCategoryEnabled('reloadIcon')) return;
    btn.classList.remove('is-reload-done');
    void btn.offsetWidth;
    btn.classList.add('is-reload-done');
    setTimeout(() => {
      if (btn.isConnected) btn.classList.remove('is-reload-done');
    }, 190);
  }

  function triggerPageTransition(options = {}) {
    if (!hasDom() || !isCategoryEnabled('pageTransitions')) return;
    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('animatePageEnter') : null;
    const pageContent = document.getElementById('page-content');
    if (!pageContent) {
      if (perf) perf.endPhase(perfTok);
      return;
    }

    const token = nextToken(pageContent);
    const isIncrementalStory = Boolean(
      options && options.isStoryPage && options.shellWasMounted && pageContent.dataset.storyShell === '1'
    );

    if (isIncrementalStory) {
      pageContent.classList.remove('page-comic-enter');
      const slotIds = ['page-title', 'media-container', 'text-container', 'command-container'];
      const slotEls = [];
      for (let i = 0; i < slotIds.length; i++) {
        const el = document.getElementById(slotIds[i]);
        if (el) {
          el.classList.remove('page-slot-enter');
          slotEls.push(el);
        }
      }
      requestAnimationFrame(() => {
        if (!isCurrentToken(pageContent, token) || !pageContent.isConnected) return;
        for (let i = 0; i < slotEls.length; i++) {
          if (slotEls[i].isConnected) {
            slotEls[i].classList.add('page-slot-enter');
          }
        }
        setTimeout(() => {
          if (!isCurrentToken(pageContent, token)) return;
          for (let i = 0; i < slotEls.length; i++) {
            if (slotEls[i].isConnected) {
              slotEls[i].classList.remove('page-slot-enter');
            }
          }
        }, 240);
      });
    } else {
      pageContent.classList.remove('page-comic-enter');
      requestAnimationFrame(() => {
        if (!isCurrentToken(pageContent, token) || !pageContent.isConnected) return;
        pageContent.classList.add('page-comic-enter');
        setTimeout(() => {
          if (!isCurrentToken(pageContent, token)) return;
          if (pageContent.isConnected) {
            pageContent.classList.remove('page-comic-enter');
          }
        }, 240);
      });
    }
    if (perf) perf.endPhase(perfTok);
  }

  function animateBookmarkItemEnter(listEl) {
    if (!hasDom() || !listEl || !isCategoryEnabled('menus')) return;
    const items = listEl.querySelectorAll('.bookmarkItem');
    const target = items[0];
    if (!target) return;
    target.classList.add('bookmark-item-enter');
    setTimeout(() => {
      if (target.isConnected) target.classList.remove('bookmark-item-enter');
    }, 150);
  }

  function animateBookmarkItemExit(itemEl) {
    if (!hasDom() || !itemEl || !isCategoryEnabled('menus')) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      itemEl.classList.remove('bookmark-item-enter');
      itemEl.classList.add('bookmark-item-exit');
      itemEl.style.pointerEvents = 'none';
      const timer = setTimeout(() => {
        resolve();
      }, 145);
      itemEl.addEventListener('animationend', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  /* ==========================================================================
     8. Export Public API
     ========================================================================== */

  const RRWRAnimations = {
    CATEGORY_KEYS,
    CORE_CATEGORIES,
    DEFAULT_CATEGORIES,
    normalizeSettings,
    applySettings,
    setMasterEnabled,
    setCategoryEnabled,
    getMasterUiState,
    isCategoryEnabled,
    hasAnyActiveAnimation,
    getFpsMode,
    nextPaintFrame,
    animateStepped,
    flipElements,
    updateBootSplash,
    dismissBootSplash,
    captureScrollState,
    pruneForwardScrollStates,
    clearTabScrollStates,
    restoreScrollState,
    bindViewportScrollTracker,
    markTabEntering,
    markTabActivated,
    animateTabClose,
    syncTabBar,
    pulseNewTabButton,
    setDrawerOpen,
    openLightbox,
    closeLightbox,
    setSoundTestVisible,
    setSoundTestPlaying,
    animateCollapsible,
    beginModLoading,
    updateModLoading,
    endModLoading,
    showStatusToast,
    triggerReloadSpin,
    finishReloadSpin,
    triggerPageTransition,
    animateBookmarkItemEnter,
    animateBookmarkItemExit
  };

  root.RRWRAnimations = RRWRAnimations;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRAnimations;
  }
})(typeof window !== 'undefined' ? window : globalThis);
