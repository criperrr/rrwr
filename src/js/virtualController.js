/**
 * RRWR Virtual Controller Subsystem
 *
 * Provides a customizable, multi-touch virtual game controller overlay for
 * interactive SWF (Ruffle) and HTML5 game embeds with 5 directional layouts,
 * full key remapping, drag-and-drop repositioning, and safe KeyboardEvent dispatch.
 */
(function (root) {
  'use strict';

  const LAYOUTS = [
    { id: 'joystick-round', label: 'Analog Stick', desc: '360-deg thumbstick with diagonals' },
    { id: 'dpad-8way', label: '8-Way Arcade', desc: 'Octagonal pad with N/NE/E/SE/S/SW/W/NW' },
    { id: 'dpad-4way', label: '4-Way Cross', desc: 'Classic cardinal D-Pad' },
    { id: 'wasd-slide', label: 'Slide Keys', desc: 'Tap or slide across directional keys' },
    { id: 'floating-zone', label: 'Floating Stick', desc: 'Anchors stick origin under your thumb' },
  ];

  const DIRECTION_PRESETS = {
    arrows: {
      up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    },
    wasd: {
      up: { key: 'w', code: 'KeyW', keyCode: 87 },
      down: { key: 's', code: 'KeyS', keyCode: 83 },
      left: { key: 'a', code: 'KeyA', keyCode: 65 },
      right: { key: 'd', code: 'KeyD', keyCode: 68 },
    },
  };

  function createDefaultConfig() {
    return {
      mode: 'auto', // 'auto' | 'always' | 'off'
      layout: 'joystick-round',
      opacity: 0.78,
      scale: 1.0,
      positions: {
        dpad: { x: 4, y: 62 },
        actions: { x: 72, y: 60 },
        toolbar: null,
      },
      minimized: {
        toolbar: false,
        dpad: false,
        actions: false,
      },
      bindings: {
        directionPreset: 'arrows',
        directions: {
          up: { ...DIRECTION_PRESETS.arrows.up },
          down: { ...DIRECTION_PRESETS.arrows.down },
          left: { ...DIRECTION_PRESETS.arrows.left },
          right: { ...DIRECTION_PRESETS.arrows.right },
        },
        actions: [
          { id: 'act-space', label: 'SPACE', key: ' ', code: 'Space', keyCode: 32, x: null, y: null },
          { id: 'act-enter', label: 'ENTER', key: 'Enter', code: 'Enter', keyCode: 13, x: null, y: null },
          { id: 'act-z', label: 'Z', key: 'z', code: 'KeyZ', keyCode: 90, x: null, y: null },
          { id: 'act-x', label: 'X', key: 'x', code: 'KeyX', keyCode: 88, x: null, y: null },
          { id: 'act-shift', label: 'SHIFT', key: 'Shift', code: 'ShiftLeft', keyCode: 16, x: null, y: null },
          { id: 'act-m', label: 'M', key: 'm', code: 'KeyM', keyCode: 77, x: null, y: null },
        ],
      },
    };
  }

  function cloneJson(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function normalizeKeyBinding(raw, fallback) {
    if (!raw || typeof raw !== 'object') return { ...fallback };
    return {
      key: typeof raw.key === 'string' && raw.key.length > 0 ? raw.key : fallback.key,
      code: typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : fallback.code,
      keyCode: Number.isFinite(Number(raw.keyCode)) ? Number(raw.keyCode) : fallback.keyCode,
    };
  }

  function normalizeConfig(raw) {
    const def = createDefaultConfig();
    if (!raw || typeof raw !== 'object') return def;

    const validMode = ['auto', 'always', 'off'].includes(raw.mode) ? raw.mode : def.mode;
    const validLayout = LAYOUTS.some((l) => l.id === raw.layout) ? raw.layout : def.layout;
    const opacity = Number.isFinite(Number(raw.opacity))
      ? Math.max(0.15, Math.min(1.0, Number(raw.opacity)))
      : def.opacity;
    const scale = Number.isFinite(Number(raw.scale))
      ? Math.max(0.5, Math.min(1.8, Number(raw.scale)))
      : def.scale;

    const posRaw = raw.positions || {};
    const dpadPos = posRaw.dpad || def.positions.dpad;
    const actPos = posRaw.actions || def.positions.actions;
    const tbPosRaw = posRaw.toolbar;
    const clampPct = (v, fb) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.min(92, Number(v))) : fb;
    const toolbarPos = tbPosRaw && typeof tbPosRaw === 'object'
      && Number.isFinite(Number(tbPosRaw.x)) && Number.isFinite(Number(tbPosRaw.y))
      ? { x: clampPct(tbPosRaw.x, 50), y: clampPct(tbPosRaw.y, 88) }
      : null;

    const bRaw = raw.bindings || {};
    const dirPreset = ['arrows', 'wasd', 'custom'].includes(bRaw.directionPreset)
      ? bRaw.directionPreset
      : def.bindings.directionPreset;
    const dRaw = bRaw.directions || {};
    const directions = {
      up: normalizeKeyBinding(dRaw.up, def.bindings.directions.up),
      down: normalizeKeyBinding(dRaw.down, def.bindings.directions.down),
      left: normalizeKeyBinding(dRaw.left, def.bindings.directions.left),
      right: normalizeKeyBinding(dRaw.right, def.bindings.directions.right),
    };

    let actions = def.bindings.actions;
    if (Array.isArray(bRaw.actions)) {
      actions = bRaw.actions
        .filter((a) => a && typeof a === 'object')
        .map((a, idx) => ({
          id: typeof a.id === 'string' && a.id ? a.id : `act-${Date.now()}-${idx}`,
          label: typeof a.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 12) : 'BTN',
          key: typeof a.key === 'string' && a.key.length > 0 ? a.key : ' ',
          code: typeof a.code === 'string' && a.code.length > 0 ? a.code : 'Space',
          keyCode: Number.isFinite(Number(a.keyCode)) ? Number(a.keyCode) : 32,
          x: Number.isFinite(Number(a.x)) ? Number(a.x) : null,
          y: Number.isFinite(Number(a.y)) ? Number(a.y) : null,
        }));
    }

    const minRaw = raw.minimized && typeof raw.minimized === 'object' ? raw.minimized : {};

    return {
      mode: validMode,
      layout: validLayout,
      opacity,
      scale,
      positions: {
        dpad: { x: clampPct(dpadPos.x, def.positions.dpad.x), y: clampPct(dpadPos.dpad_y ?? dpadPos.y, def.positions.dpad.y) },
        actions: { x: clampPct(actPos.x, def.positions.actions.x), y: clampPct(actPos.y, def.positions.actions.y) },
        toolbar: toolbarPos,
      },
      minimized: {
        toolbar: Boolean(minRaw.toolbar),
        dpad: Boolean(minRaw.dpad),
        actions: Boolean(minRaw.actions),
      },
      bindings: {
        directionPreset: dirPreset,
        directions,
        actions,
      },
    };
  }

  function formatKeyShort(binding) {
    if (!binding) return '?';
    const k = binding.key || '';
    const c = binding.code || '';
    if (k === 'ArrowUp' || c === 'ArrowUp') return '↑';
    if (k === 'ArrowDown' || c === 'ArrowDown') return '↓';
    if (k === 'ArrowLeft' || c === 'ArrowLeft') return '←';
    if (k === 'ArrowRight' || c === 'ArrowRight') return '→';
    if (k === ' ' || c === 'Space') return 'SPC';
    if (k === 'Enter' || c === 'Enter') return 'ENT';
    if (k === 'Shift' || c.startsWith('Shift')) return 'SHF';
    if (k === 'Escape' || c === 'Escape') return 'ESC';
    if (k === 'Tab' || c === 'Tab') return 'TAB';
    return k.length === 1 ? k.toUpperCase() : k.slice(0, 4).toUpperCase();
  }

  function createKeyboardEvent(eventType, keyInfo) {
    const opts = {
      key: String(keyInfo.key || ''),
      code: String(keyInfo.code || ''),
      keyCode: Number(keyInfo.keyCode || 0),
      which: Number(keyInfo.keyCode || 0),
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const ev = new KeyboardEvent(eventType, opts);
    try {
      Object.defineProperty(ev, 'keyCode', { get: () => opts.keyCode });
      Object.defineProperty(ev, 'which', { get: () => opts.keyCode });
    } catch (_) {}
    return ev;
  }

  function dispatchKeyToTargets(eventType, keyInfo) {
    const mediaEngine = root.RRWRMediaEngine;
    const activeIframes =
      mediaEngine && typeof mediaEngine.getActiveIframes === 'function'
        ? mediaEngine.getActiveIframes()
        : Array.from(document.querySelectorAll('iframe.ruffle-frame, iframe.html-game-frame'));

    let dispatchedToFrame = false;

    for (let i = 0; i < activeIframes.length; i++) {
      const iframe = activeIframes[i];
      if (!iframe) continue;
      if (iframe.classList.contains('ruffle-frame')) {
        try {
          if (iframe.contentWindow && typeof iframe.contentWindow.postMessage === 'function') {
            iframe.contentWindow.postMessage(
              { type: 'RRWR_VIRTUAL_KEY', eventType, keyInfo },
              '*'
            );
            dispatchedToFrame = true;
          }
        } catch (_) {}
      } else {
        try {
          const doc = iframe.contentDocument;
          const win = iframe.contentWindow;
          if (eventType === 'keydown' && win && typeof win.focus === 'function') {
            win.focus();
          }
          const target = (doc && (doc.activeElement || doc.body || doc)) || win;
          if (target && typeof target.dispatchEvent === 'function') {
            target.dispatchEvent(createKeyboardEvent(eventType, keyInfo));
            dispatchedToFrame = true;
          }
        } catch (_) {}
      }
    }

    // Fallback: direct <ruffle-player> in main document or document itself
    if (!dispatchedToFrame) {
      const player = document.querySelector('ruffle-player');
      if (player) {
        if (eventType === 'keydown' && typeof player.focus === 'function') {
          try {
            player.focus({ preventScroll: true });
          } catch (_) {}
        }
        const shadowCanvas =
          player.shadowRoot &&
          (player.shadowRoot.querySelector('canvas, [tabindex]') || player.shadowRoot.firstElementChild);
        const target = shadowCanvas || player;
        target.dispatchEvent(createKeyboardEvent(eventType, keyInfo));
      } else {
        const active = document.activeElement;
        const isTyping =
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' ||
            active.isContentEditable);
        if (!isTyping) {
          (active || document).dispatchEvent(createKeyboardEvent(eventType, keyInfo));
        }
      }
    }
  }

  class KeyDispatcher {
    constructor() {
      this.counts = new Map();
      this.infos = new Map();
      this.activeDirections = new Set();
    }

    pressKey(keyInfo) {
      if (!keyInfo || !keyInfo.code) return;
      const code = keyInfo.code;
      const prev = this.counts.get(code) || 0;
      this.counts.set(code, prev + 1);
      this.infos.set(code, keyInfo);
      if (prev === 0) {
        dispatchKeyToTargets('keydown', keyInfo);
      }
    }

    releaseKey(keyInfo) {
      if (!keyInfo || !keyInfo.code) return;
      const code = keyInfo.code;
      const prev = this.counts.get(code) || 0;
      if (prev <= 0) return;
      if (prev === 1) {
        this.counts.delete(code);
        const info = this.infos.get(code) || keyInfo;
        this.infos.delete(code);
        dispatchKeyToTargets('keyup', info);
      } else {
        this.counts.set(code, prev - 1);
      }
    }

    setDirections(nextDirs, dirBindings) {
      const dirs = ['up', 'down', 'left', 'right'];
      for (const d of dirs) {
        const was = this.activeDirections.has(d);
        const now = nextDirs.has(d);
        if (was && !now) {
          this.activeDirections.delete(d);
          this.releaseKey(dirBindings[d]);
        }
      }
      for (const d of dirs) {
        const was = this.activeDirections.has(d);
        const now = nextDirs.has(d);
        if (!was && now) {
          this.activeDirections.add(d);
          this.pressKey(dirBindings[d]);
        }
      }
    }

    releaseAll() {
      this.activeDirections.clear();
      for (const [code, info] of this.infos.entries()) {
        if ((this.counts.get(code) || 0) > 0) {
          dispatchKeyToTargets('keyup', info);
        }
      }
      this.counts.clear();
      this.infos.clear();
    }
  }

  class VirtualController {
    constructor() {
      this.config = createDefaultConfig();
      this.onSave = null;
      this.dispatcher = new KeyDispatcher();
      this.editMode = false;
      this.manualOverride = null; // null | true | false (session toggle on current page)
      this.hasInteractive = false;
      this.rootEl = null;
      this.dpadClusterEl = null;
      this.actionsClusterEl = null;
      this.toolbarEl = null;
      this.togglePillEl = null;
      this.modalEl = null;
      this.captureAbort = null;
      this.initialized = false;
    }

    isMobileDevice() {
      if (typeof window === 'undefined') return false;
      if (window.RRWRAndroidNative) return true;
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
      return Boolean(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    }

    init(options = {}) {
      if (this.initialized) return;
      this.initialized = true;
      if (typeof options.onSave === 'function') {
        this.onSave = options.onSave;
      }
      if (options.config) {
        this.config = normalizeConfig(options.config);
      }

      if (!this.isMobileDevice()) {
        const addrBtn = document.getElementById('nav-controller-btn');
        if (addrBtn) addrBtn.classList.add('hidden');
        return;
      }

      this._mountDom();
      this._bindGlobalSafetyEvents();
      this.refreshInteractiveState();
      this.render();
    }

    setConfig(newConfig) {
      this.dispatcher.releaseAll();
      this.config = normalizeConfig(newConfig);
      this.render();
    }

    getConfig() {
      return cloneJson(this.config);
    }

    setOnSave(fn) {
      this.onSave = typeof fn === 'function' ? fn : null;
    }

    _commitConfig() {
      if (this.onSave) {
        this.onSave(this.getConfig());
      }
    }

    refreshInteractiveState() {
      const me = root.RRWRMediaEngine;
      const detected = me && typeof me.hasInteractiveEmbed === 'function'
        ? me.hasInteractiveEmbed()
        : Boolean(document.querySelector('iframe.ruffle-frame, iframe.html-game-frame, ruffle-player'));
      this.hasInteractive = detected;
      this._updateVisibility();
    }

    isVisible() {
      if (!this.isMobileDevice()) return false;
      if (this.manualOverride === true) return true;
      if (this.manualOverride === false) return false;
      if (this.config.mode === 'always') return true;
      if (this.config.mode === 'off') return false;
      return this.hasInteractive && document.body.classList.contains('rrwr-swf-fullscreen');
    }

    toggleOverlay() {
      const currentlyVisible = this.isVisible();
      this.manualOverride = !currentlyVisible;
      if (!this.manualOverride) {
        this.dispatcher.releaseAll();
        this.editMode = false;
      }
      this._updateVisibility();
      this.render();
    }

    _updateVisibility() {
      if (!this.rootEl) return;
      const visible = this.isVisible();
      this.rootEl.classList.toggle('hidden', !visible);
      if (this.togglePillEl) {
        const inSwfFullscreen = document.body.classList.contains('rrwr-swf-fullscreen');
        this.togglePillEl.classList.toggle('hidden', visible || !inSwfFullscreen || this.config.mode === 'off');
      }
      const addrBtn = document.getElementById('nav-controller-btn');
      if (addrBtn) {
        addrBtn.classList.toggle('active', visible);
        addrBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
      }
    }

    _bindGlobalSafetyEvents() {
      root.addEventListener('blur', () => this.dispatcher.releaseAll());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.dispatcher.releaseAll();
      });
      root.addEventListener('rrwr:media-updated', (e) => {
        this.dispatcher.releaseAll();
        this.manualOverride = null;
        this.hasInteractive = Boolean(e && e.detail && e.detail.interactive);
        this._updateVisibility();
      });
      root.addEventListener('rrwr:asset-fullscreen-change', (e) => {
        if (!e || !e.detail || !e.detail.isSwf) {
          this.manualOverride = null;
          this.dispatcher.releaseAll();
          this.editMode = false;
        }
        this._updateVisibility();
        if (this.isVisible()) {
          this._clampAllClusters();
        }
      });
      const reclamp = () => {
        if (this.isVisible()) {
          this._clampAllClusters();
        }
      };
      root.addEventListener('resize', reclamp);
      root.addEventListener('orientationchange', reclamp);
    }

    _mountDom() {
      const appEl = document.getElementById('app') || document.body;

      this.rootEl = document.createElement('div');
      this.rootEl.id = 'virtual-controller-overlay';
      this.rootEl.className = 'vcOverlay hidden';
      this.rootEl.setAttribute('aria-label', 'Virtual Game Controller');

      this.toolbarEl = document.createElement('div');
      this.toolbarEl.className = 'vcToolbar';
      this.toolbarEl.innerHTML = `
        <button type="button" class="vcToolBtn" data-vc-action="edit" title="Reposition Controls">Move</button>
        <button type="button" class="vcToolBtn" data-vc-action="customize" title="Layouts &amp; Keybindings">Config</button>
        <button type="button" class="vcToolBtn vcMinBtn" data-vc-action="min-toolbar" title="Minimize Toolbar">&minus;</button>
        <button type="button" class="vcToolBtn" data-vc-action="hide" title="Hide Controller">&times;</button>
        <button type="button" class="vcToolBtn vcToolbarRestoreBtn" data-vc-action="min-toolbar" title="Expand Toolbar">MENU</button>
        <div class="vcToolbarDragHandle" title="Drag Toolbar" aria-label="Drag Toolbar"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.3"/><circle cx="11" cy="4" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="11" cy="12" r="1.3"/></svg></div>
      `;
      let tbDragging = false;
      let tbStartX = 0;
      let tbStartY = 0;
      let tbOrigLeft = 0;
      let tbOrigTop = 0;

      const tbHandle = this.toolbarEl.querySelector('.vcToolbarDragHandle');
      this.toolbarEl.addEventListener('pointerdown', (e) => e.stopPropagation());
      if (tbHandle) {
        tbHandle.addEventListener('pointerdown', (e) => {
          if (!this.editMode) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = this.toolbarEl.getBoundingClientRect();
          tbDragging = true;
          tbStartX = e.clientX;
          tbStartY = e.clientY;
          tbOrigLeft = rect.left;
          tbOrigTop = rect.top;
          try { tbHandle.setPointerCapture(e.pointerId); } catch (_) {}
        });
        tbHandle.addEventListener('pointermove', (e) => {
          if (!tbDragging) return;
          e.preventDefault();
          const vw = window.innerWidth || document.documentElement.clientWidth || 360;
          const vh = window.innerHeight || document.documentElement.clientHeight || 640;
          const w = this.toolbarEl.offsetWidth || 180;
          const h = this.toolbarEl.offsetHeight || 36;
          const nextLeft = Math.max(6, Math.min(vw - w - 6, tbOrigLeft + (e.clientX - tbStartX)));
          const nextTop = Math.max(6, Math.min(vh - h - 6, tbOrigTop + (e.clientY - tbStartY)));
          this.config.positions.toolbar = {
            x: Number(((nextLeft / Math.max(1, vw)) * 100).toFixed(2)),
            y: Number(((nextTop / Math.max(1, vh)) * 100).toFixed(2)),
          };
          this._positionToolbar();
        });
        const finishToolbarDrag = (e) => {
          if (!tbDragging) return;
          tbDragging = false;
          try { tbHandle.releasePointerCapture(e.pointerId); } catch (_) {}
          this._commitConfig();
        };
        tbHandle.addEventListener('pointerup', finishToolbarDrag);
        tbHandle.addEventListener('pointercancel', finishToolbarDrag);
      }
      this.toolbarEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-vc-action]');
        if (!btn) return;
        const act = btn.getAttribute('data-vc-action');
        if (act === 'edit') {
          this.editMode = !this.editMode;
          this.dispatcher.releaseAll();
          this.render();
        } else if (act === 'customize') {
          this.openCustomizerModal();
        } else if (act === 'min-toolbar') {
          this.config.minimized.toolbar = !this.config.minimized.toolbar;
          this._commitConfig();
          this.render();
        } else if (act === 'hide') {
          this.manualOverride = false;
          this.editMode = false;
          this.dispatcher.releaseAll();
          this._updateVisibility();
        }
      });

      this.dpadClusterEl = document.createElement('div');
      this.dpadClusterEl.className = 'vcCluster vcCluster--dpad';

      this.actionsClusterEl = document.createElement('div');
      this.actionsClusterEl.className = 'vcCluster vcCluster--actions';

      this.rootEl.appendChild(this.toolbarEl);
      this.rootEl.appendChild(this.dpadClusterEl);
      this.rootEl.appendChild(this.actionsClusterEl);
      appEl.appendChild(this.rootEl);

      this.togglePillEl = document.createElement('button');
      this.togglePillEl.id = 'vc-restore-pill';
      this.togglePillEl.type = 'button';
      this.togglePillEl.className = 'vcRestorePill hidden';
      this.togglePillEl.textContent = 'PAD';
      this.togglePillEl.title = 'Show Virtual Controller';
      this.togglePillEl.setAttribute('aria-label', 'Show Virtual Controller');
      this.togglePillEl.addEventListener('click', () => {
        if (!this.isVisible()) {
          this.toggleOverlay();
        }
      });
      appEl.appendChild(this.togglePillEl);
    }

    render() {
      if (!this.rootEl) return;
      this._updateVisibility();
      this.rootEl.classList.toggle('vcOverlay--edit', this.editMode);
      this.toolbarEl.classList.toggle('vcToolbar--minimized', Boolean(this.config.minimized.toolbar));
      this.rootEl.style.setProperty('--vc-opacity', String(this.config.opacity));
      this.rootEl.style.setProperty('--vc-scale', String(this.config.scale));

      const editBtn = this.toolbarEl.querySelector('[data-vc-action="edit"]');
      if (editBtn) {
        editBtn.classList.toggle('active', this.editMode);
        editBtn.textContent = this.editMode ? 'Done' : 'Move';
      }

      this._positionCluster(this.dpadClusterEl, this.config.positions.dpad);
      this._positionCluster(this.actionsClusterEl, this.config.positions.actions);
      this._positionToolbar();

      this._renderDpadCluster();
      this._renderActionsCluster();

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this._clampAllClusters());
      } else {
        this._clampAllClusters();
      }
    }

    _positionToolbar() {
      if (!this.toolbarEl) return;
      const pos = this.config.positions.toolbar;
      if (!pos) {
        this.toolbarEl.style.left = '';
        this.toolbarEl.style.top = '';
        this.toolbarEl.style.bottom = '';
        this.toolbarEl.style.transform = '';
        return;
      }
      const vw = window.innerWidth || document.documentElement.clientWidth || 360;
      const vh = window.innerHeight || document.documentElement.clientHeight || 640;
      const w = this.toolbarEl.offsetWidth || 180;
      const h = this.toolbarEl.offsetHeight || 36;
      const left = Math.max(6, Math.min(vw - w - 6, (pos.x / 100) * vw));
      const top = Math.max(6, Math.min(vh - h - 6, (pos.y / 100) * vh));
      this.toolbarEl.style.bottom = 'auto';
      this.toolbarEl.style.transform = 'none';
      this.toolbarEl.style.left = `${Math.round(left)}px`;
      this.toolbarEl.style.top = `${Math.round(top)}px`;
    }

    _positionCluster(el, pos) {
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
    }

    _clampAllClusters() {
      if (!this.isVisible()) return;
      this._clampCluster(this.dpadClusterEl, this.config.positions.dpad);
      this._clampCluster(this.actionsClusterEl, this.config.positions.actions);
      this._positionToolbar();
    }

    _clampCluster(el, pos) {
      if (!el || !pos) return;
      const vw = window.innerWidth || document.documentElement.clientWidth || 360;
      const vh = window.innerHeight || document.documentElement.clientHeight || 640;
      const scale = Number(this.config.scale) || 1;
      const rawW = el.offsetWidth || 140;
      const rawH = el.offsetHeight || 120;
      const renderedW = rawW * scale;
      const renderedH = rawH * scale;
      const margin = 6;
      const maxLeft = Math.max(margin, vw - renderedW - margin);
      const maxTop = Math.max(margin, vh - renderedH - margin);
      const desiredLeft = (pos.x / 100) * vw;
      const desiredTop = (pos.y / 100) * vh;
      const clampedLeft = Math.max(margin, Math.min(maxLeft, desiredLeft));
      const clampedTop = Math.max(margin, Math.min(maxTop, desiredTop));
      el.style.left = `${Math.round(clampedLeft)}px`;
      el.style.top = `${Math.round(clampedTop)}px`;
    }

    _attachClusterDrag(clusterEl, posKey) {
      if (!this.editMode) return;
      const handle = document.createElement('div');
      handle.className = 'vcDragHandle';
      handle.textContent = posKey === 'dpad' ? 'DRAG D-PAD' : 'DRAG ACTIONS';
      clusterEl.appendChild(handle);

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let origPctX = 0;
      let origPctY = 0;

      const onDown = (e) => {
        if (!this.editMode) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origPctX = this.config.positions[posKey].x;
        origPctY = this.config.positions[posKey].y;
        try {
          clusterEl.setPointerCapture(e.pointerId);
        } catch (_) {}
      };

      const onMove = (e) => {
        if (!dragging) return;
        const vw = Math.max(320, window.innerWidth);
        const vh = Math.max(240, window.innerHeight);
        const dxPct = ((e.clientX - startX) / vw) * 100;
        const dyPct = ((e.clientY - startY) / vh) * 100;
        this.config.positions[posKey].x = Math.max(0, Math.min(88, origPctX + dxPct));
        this.config.positions[posKey].y = Math.max(8, Math.min(88, origPctY + dyPct));
        this._positionCluster(clusterEl, this.config.positions[posKey]);
      };

      const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        try {
          clusterEl.releasePointerCapture(e.pointerId);
        } catch (_) {}
        this._commitConfig();
      };

      clusterEl.addEventListener('pointerdown', onDown);
      clusterEl.addEventListener('pointermove', onMove);
      clusterEl.addEventListener('pointerup', onUp);
      clusterEl.addEventListener('pointercancel', onUp);
    }

    _renderClusterMinimized(fresh, posKey) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'vcClusterMinPill';
      pill.textContent = posKey === 'dpad' ? 'JOY' : 'PAD';
      pill.title = posKey === 'dpad' ? 'Restore D-Pad / Joystick' : 'Restore Action Pad';
      pill.addEventListener('pointerdown', (e) => {
        if (this.editMode) return;
        e.stopPropagation();
      });
      pill.addEventListener('click', (e) => {
        if (this.editMode) return;
        e.preventDefault();
        e.stopPropagation();
        this.config.minimized[posKey] = false;
        this._commitConfig();
        this.render();
      });
      fresh.appendChild(pill);
      if (this.editMode) {
        this._attachClusterDrag(fresh, posKey);
      }
    }

    _attachClusterMinimize(fresh, posKey) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vcClusterMinBtn';
      btn.innerHTML = '&minus;';
      btn.title = posKey === 'dpad' ? 'Minimize D-Pad / Joystick' : 'Minimize Action Pad';
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.config.minimized[posKey] = true;
        this.dispatcher.releaseAll();
        this._commitConfig();
        this.render();
      });
      fresh.appendChild(btn);
    }

    _renderDpadCluster() {
      const container = this.dpadClusterEl;
      const fresh = container.cloneNode(false);
      container.parentNode.replaceChild(fresh, container);
      this.dpadClusterEl = fresh;

      if (this.config.minimized.dpad) {
        this._renderClusterMinimized(fresh, 'dpad');
        return;
      }

      if (this.editMode) {
        const preview = document.createElement('div');
        preview.className = 'vcEditBox vcEditBox--dpad';
        preview.textContent = this.config.layout.toUpperCase();
        fresh.appendChild(preview);
        this._attachClusterMinimize(fresh, 'dpad');
        this._attachClusterDrag(fresh, 'dpad');
        return;
      }

      const layout = this.config.layout;
      if (layout === 'joystick-round') {
        this._buildRoundJoystick(fresh);
      } else if (layout === 'dpad-8way') {
        this._build8WayPad(fresh);
      } else if (layout === 'dpad-4way') {
        this._build4WayPad(fresh);
      } else if (layout === 'wasd-slide') {
        this._buildSlideKeys(fresh);
      } else if (layout === 'floating-zone') {
        this._buildFloatingZone(fresh);
      } else {
        this._buildRoundJoystick(fresh);
      }
      this._attachClusterMinimize(fresh, 'dpad');
    }

    _buildRoundJoystick(container) {
      const base = document.createElement('div');
      base.className = 'vcJoyBase';
      const nub = document.createElement('div');
      nub.className = 'vcJoyNub';
      base.appendChild(nub);
      container.appendChild(base);

      let activePointer = null;
      const updateFromPoint = (clientX, clientY) => {
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const maxR = rect.width * 0.38;
        let dx = clientX - cx;
        let dy = clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR && dist > 0) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        nub.style.transform = `translate(${dx}px, ${dy}px)`;

        const nx = maxR > 0 ? dx / maxR : 0;
        const ny = maxR > 0 ? dy / maxR : 0;
        const deadzone = 0.24;
        const dirs = new Set();
        if (Math.hypot(nx, ny) >= deadzone) {
          if (nx < -0.35) dirs.add('left');
          if (nx > 0.35) dirs.add('right');
          if (ny < -0.35) dirs.add('up');
          if (ny > 0.35) dirs.add('down');
        }
        this.dispatcher.setDirections(dirs, this.config.bindings.directions);
      };

      const release = () => {
        activePointer = null;
        nub.style.transform = 'translate(0px, 0px)';
        base.classList.remove('active');
        this.dispatcher.setDirections(new Set(), this.config.bindings.directions);
      };

      base.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (activePointer !== null) return;
        activePointer = e.pointerId;
        base.classList.add('active');
        try { base.setPointerCapture(e.pointerId); } catch (_) {}
        updateFromPoint(e.clientX, e.clientY);
      });
      base.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointer) return;
        updateFromPoint(e.clientX, e.clientY);
      });
      base.addEventListener('pointerup', (e) => {
        if (e.pointerId === activePointer) release();
      });
      base.addEventListener('pointercancel', (e) => {
        if (e.pointerId === activePointer) release();
      });
      base.addEventListener('lostpointercapture', release);
    }

    _build8WayPad(container) {
      const pad = document.createElement('div');
      pad.className = 'vcOctPad';
      const labels = [
        { dir: 'nw', text: '↖', cls: 'vcOctBtn--nw' },
        { dir: 'n', text: '↑', cls: 'vcOctBtn--n' },
        { dir: 'ne', text: '↗', cls: 'vcOctBtn--ne' },
        { dir: 'w', text: '←', cls: 'vcOctBtn--w' },
        { dir: 'center', text: '●', cls: 'vcOctBtn--c' },
        { dir: 'e', text: '→', cls: 'vcOctBtn--e' },
        { dir: 'sw', text: '↙', cls: 'vcOctBtn--sw' },
        { dir: 's', text: '↓', cls: 'vcOctBtn--s' },
        { dir: 'se', text: '↘', cls: 'vcOctBtn--se' },
      ];
      const cellMap = {};
      for (const item of labels) {
        const cell = document.createElement('div');
        cell.className = `vcOctBtn ${item.cls}`;
        cell.textContent = item.text;
        pad.appendChild(cell);
        cellMap[item.dir] = cell;
      }
      container.appendChild(pad);

      let activePointer = null;
      const updateFromPoint = (clientX, clientY) => {
        const rect = pad.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        Object.values(cellMap).forEach((el) => el.classList.remove('active'));
        if (dist < rect.width * 0.14) {
          this.dispatcher.setDirections(new Set(), this.config.bindings.directions);
          return;
        }
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0=E, 90=S, -90=N
        const sector = Math.round(angle / 45);
        const dirs = new Set();
        let activeCell = 'center';
        if (sector === 0) { dirs.add('right'); activeCell = 'e'; }
        else if (sector === 1) { dirs.add('right'); dirs.add('down'); activeCell = 'se'; }
        else if (sector === 2) { dirs.add('down'); activeCell = 's'; }
        else if (sector === 3) { dirs.add('left'); dirs.add('down'); activeCell = 'sw'; }
        else if (sector === 4 || sector === -4) { dirs.add('left'); activeCell = 'w'; }
        else if (sector === -3) { dirs.add('left'); dirs.add('up'); activeCell = 'nw'; }
        else if (sector === -2) { dirs.add('up'); activeCell = 'n'; }
        else if (sector === -1) { dirs.add('right'); dirs.add('up'); activeCell = 'ne'; }

        if (cellMap[activeCell]) cellMap[activeCell].classList.add('active');
        this.dispatcher.setDirections(dirs, this.config.bindings.directions);
      };

      const release = () => {
        activePointer = null;
        Object.values(cellMap).forEach((el) => el.classList.remove('active'));
        this.dispatcher.setDirections(new Set(), this.config.bindings.directions);
      };

      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (activePointer !== null) return;
        activePointer = e.pointerId;
        try { pad.setPointerCapture(e.pointerId); } catch (_) {}
        updateFromPoint(e.clientX, e.clientY);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId === activePointer) updateFromPoint(e.clientX, e.clientY);
      });
      pad.addEventListener('pointerup', (e) => {
        if (e.pointerId === activePointer) release();
      });
      pad.addEventListener('pointercancel', (e) => {
        if (e.pointerId === activePointer) release();
      });
      pad.addEventListener('lostpointercapture', release);
    }

    _build4WayPad(container) {
      const cross = document.createElement('div');
      cross.className = 'vcCrossPad';
      const arms = {
        up: document.createElement('div'),
        down: document.createElement('div'),
        left: document.createElement('div'),
        right: document.createElement('div'),
      };
      arms.up.className = 'vcCrossArm vcCrossArm--up';
      arms.up.textContent = '▲';
      arms.down.className = 'vcCrossArm vcCrossArm--down';
      arms.down.textContent = '▼';
      arms.left.className = 'vcCrossArm vcCrossArm--left';
      arms.left.textContent = '◀';
      arms.right.className = 'vcCrossArm vcCrossArm--right';
      arms.right.textContent = '▶';
      const center = document.createElement('div');
      center.className = 'vcCrossCenter';
      cross.append(arms.up, arms.left, center, arms.right, arms.down);
      container.appendChild(cross);

      let activePointer = null;
      const updateFromPoint = (clientX, clientY) => {
        const rect = cross.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        Object.values(arms).forEach((el) => el.classList.remove('active'));
        const dirs = new Set();
        if (Math.hypot(dx, dy) >= rect.width * 0.14) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            const d = dx < 0 ? 'left' : 'right';
            dirs.add(d);
            arms[d].classList.add('active');
          } else {
            const d = dy < 0 ? 'up' : 'down';
            dirs.add(d);
            arms[d].classList.add('active');
          }
        }
        this.dispatcher.setDirections(dirs, this.config.bindings.directions);
      };

      const release = () => {
        activePointer = null;
        Object.values(arms).forEach((el) => el.classList.remove('active'));
        this.dispatcher.setDirections(new Set(), this.config.bindings.directions);
      };

      cross.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (activePointer !== null) return;
        activePointer = e.pointerId;
        try { cross.setPointerCapture(e.pointerId); } catch (_) {}
        updateFromPoint(e.clientX, e.clientY);
      });
      cross.addEventListener('pointermove', (e) => {
        if (e.pointerId === activePointer) updateFromPoint(e.clientX, e.clientY);
      });
      cross.addEventListener('pointerup', (e) => {
        if (e.pointerId === activePointer) release();
      });
      cross.addEventListener('pointercancel', (e) => {
        if (e.pointerId === activePointer) release();
      });
      cross.addEventListener('lostpointercapture', release);
    }

    _buildSlideKeys(container) {
      const grid = document.createElement('div');
      grid.className = 'vcSlideGrid';
      const db = this.config.bindings.directions;
      const keys = [
        { dir: 'up', label: formatKeyShort(db.up), cls: 'vcSlideKey--up' },
        { dir: 'left', label: formatKeyShort(db.left), cls: 'vcSlideKey--left' },
        { dir: 'down', label: formatKeyShort(db.down), cls: 'vcSlideKey--down' },
        { dir: 'right', label: formatKeyShort(db.right), cls: 'vcSlideKey--right' },
      ];
      const keyEls = {};
      for (const k of keys) {
        const el = document.createElement('div');
        el.className = `vcSlideKey ${k.cls}`;
        el.setAttribute('data-dir', k.dir);
        el.textContent = k.label;
        grid.appendChild(el);
        keyEls[k.dir] = el;
      }
      container.appendChild(grid);

      const pointerDirs = new Map();
      const syncPointers = () => {
        const merged = new Set();
        for (const d of pointerDirs.values()) {
          if (d) merged.add(d);
        }
        Object.entries(keyEls).forEach(([d, el]) => {
          el.classList.toggle('active', merged.has(d));
        });
        this.dispatcher.setDirections(merged, this.config.bindings.directions);
      };

      const dirAtPoint = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        const keyEl = hit && hit.closest ? hit.closest('.vcSlideKey') : null;
        return keyEl && grid.contains(keyEl) ? keyEl.getAttribute('data-dir') : null;
      };

      grid.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { grid.setPointerCapture(e.pointerId); } catch (_) {}
        pointerDirs.set(e.pointerId, dirAtPoint(e.clientX, e.clientY));
        syncPointers();
      });
      grid.addEventListener('pointermove', (e) => {
        if (!pointerDirs.has(e.pointerId)) return;
        const next = dirAtPoint(e.clientX, e.clientY);
        if (pointerDirs.get(e.pointerId) !== next) {
          pointerDirs.set(e.pointerId, next);
          syncPointers();
        }
      });
      const endPointer = (e) => {
        if (!pointerDirs.has(e.pointerId)) return;
        pointerDirs.delete(e.pointerId);
        syncPointers();
      };
      grid.addEventListener('pointerup', endPointer);
      grid.addEventListener('pointercancel', endPointer);
      grid.addEventListener('lostpointercapture', (e) => endPointer(e));
    }

    _buildFloatingZone(container) {
      const zone = document.createElement('div');
      zone.className = 'vcFloatZone';
      const hint = document.createElement('span');
      hint.className = 'vcFloatHint';
      hint.textContent = 'TOUCH & DRAG';
      const ring = document.createElement('div');
      ring.className = 'vcFloatRing hidden';
      const nub = document.createElement('div');
      nub.className = 'vcJoyNub';
      ring.appendChild(nub);
      zone.append(hint, ring);
      container.appendChild(zone);

      let activePointer = null;
      let originX = 0;
      let originY = 0;

      const updateMove = (clientX, clientY) => {
        const maxR = 46;
        let dx = clientX - originX;
        let dy = clientY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR && dist > 0) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        nub.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / maxR;
        const ny = dy / maxR;
        const dirs = new Set();
        if (Math.hypot(nx, ny) >= 0.22) {
          if (nx < -0.35) dirs.add('left');
          if (nx > 0.35) dirs.add('right');
          if (ny < -0.35) dirs.add('up');
          if (ny > 0.35) dirs.add('down');
        }
        this.dispatcher.setDirections(dirs, this.config.bindings.directions);
      };

      const release = () => {
        activePointer = null;
        ring.classList.add('hidden');
        hint.classList.remove('hidden');
        nub.style.transform = 'translate(0px, 0px)';
        this.dispatcher.setDirections(new Set(), this.config.bindings.directions);
      };

      zone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (activePointer !== null) return;
        activePointer = e.pointerId;
        try { zone.setPointerCapture(e.pointerId); } catch (_) {}
        const rect = zone.getBoundingClientRect();
        originX = e.clientX;
        originY = e.clientY;
        ring.style.left = `${originX - rect.left}px`;
        ring.style.top = `${originY - rect.top}px`;
        ring.classList.remove('hidden');
        hint.classList.add('hidden');
        updateMove(e.clientX, e.clientY);
      });
      zone.addEventListener('pointermove', (e) => {
        if (e.pointerId === activePointer) updateMove(e.clientX, e.clientY);
      });
      zone.addEventListener('pointerup', (e) => {
        if (e.pointerId === activePointer) release();
      });
      zone.addEventListener('pointercancel', (e) => {
        if (e.pointerId === activePointer) release();
      });
      zone.addEventListener('lostpointercapture', release);
    }

    _renderActionsCluster() {
      const container = this.actionsClusterEl;
      const fresh = container.cloneNode(false);
      container.parentNode.replaceChild(fresh, container);
      this.actionsClusterEl = fresh;

      if (this.config.minimized.actions) {
        this._renderClusterMinimized(fresh, 'actions');
        return;
      }

      if (this.editMode) {
        const preview = document.createElement('div');
        preview.className = 'vcEditBox vcEditBox--actions';
        preview.textContent = `${this.config.bindings.actions.length} ACTIONS`;
        fresh.appendChild(preview);
        this._attachClusterMinimize(fresh, 'actions');
        this._attachClusterDrag(fresh, 'actions');
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'vcActionsGrid';
      for (const act of this.config.bindings.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vcActionBtn';
        btn.setAttribute('data-action-id', act.id);
        btn.textContent = act.label;

        let activePtr = null;
        const press = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (activePtr !== null) return;
          activePtr = e.pointerId;
          btn.classList.add('active');
          try { btn.setPointerCapture(e.pointerId); } catch (_) {}
          this.dispatcher.pressKey(act);
        };
        const release = (e) => {
          if (e && e.pointerId !== undefined && e.pointerId !== activePtr) return;
          if (activePtr === null) return;
          activePtr = null;
          btn.classList.remove('active');
          this.dispatcher.releaseKey(act);
        };

        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('lostpointercapture', () => release());
        grid.appendChild(btn);
      }
      fresh.appendChild(grid);
      this._attachClusterMinimize(fresh, 'actions');
    }

    openCustomizerModal() {
      if (this.modalEl) {
        this.modalEl.remove();
        this.modalEl = null;
      }
      this.dispatcher.releaseAll();

      const modal = document.createElement('div');
      modal.id = 'vc-customizer-modal';
      modal.className = 'vcModalBackdrop rrwrImageLightbox hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Virtual Controller Settings');

      const draft = cloneJson(this.config);

      const closeModal = () => {
        if (this.captureAbort) {
          this.captureAbort.abort();
          this.captureAbort = null;
        }
        window.removeEventListener('keydown', onEscClose);
        const finalize = () => {
          modal.remove();
          if (this.modalEl === modal) {
            this.modalEl = null;
          }
        };
        if (root.RRWRAnimations && typeof root.RRWRAnimations.closeLightbox === 'function') {
          root.RRWRAnimations.closeLightbox(modal, finalize);
        } else {
          finalize();
        }
      };

      const onEscClose = (e) => {
        if (e.key === 'Escape' && !this.captureAbort && !modal.classList.contains('hidden')) {
          e.preventDefault();
          closeModal();
        }
      };
      window.addEventListener('keydown', onEscClose);

      const renderModalBody = () => {
        const dirs = draft.bindings.directions;
        modal.innerHTML = `
          <div class="vcModalCard vc-customizer-dialog">
            <div class="vcModalHeader">
              <h3>VIRTUAL CONTROLLER // DECK</h3>
              <button type="button" class="vcModalClose" data-vc-modal="close" aria-label="Close">&times;</button>
            </div>
            <div class="vcModalBody">
              <div class="vcModalSection">
                <label class="vcFieldLabel">Visibility Mode</label>
                <div class="vcSegmented">
                  ${['auto', 'always', 'off']
                    .map(
                      (m) =>
                        `<button type="button" class="vcSegBtn ${draft.mode === m ? 'active' : ''}" data-vc-mode="${m}">${
                          m === 'auto' ? 'Auto (Games)' : m === 'always' ? 'Always On' : 'Off'
                        }</button>`
                    )
                    .join('')}
                </div>
              </div>

              <div class="vcModalSection">
                <label class="vcFieldLabel">Directional Layout</label>
                <div class="vcLayoutGrid">
                  ${LAYOUTS.map(
                    (l) => `
                    <button type="button" class="vcLayoutOption ${draft.layout === l.id ? 'active' : ''}" data-vc-layout="${l.id}">
                      <strong>${l.label}</strong>
                      <span>${l.desc}</span>
                    </button>`
                  ).join('')}
                </div>
              </div>

              <div class="vcModalSection vcSlidersRow">
                <div>
                  <label class="vcFieldLabel">Scale: <span id="vc-scale-val">${Math.round(draft.scale * 100)}%</span></label>
                  <input type="range" id="vc-scale-range" min="50" max="180" step="5" value="${Math.round(draft.scale * 100)}" />
                </div>
                <div>
                  <label class="vcFieldLabel">Opacity: <span id="vc-opacity-val">${Math.round(draft.opacity * 100)}%</span></label>
                  <input type="range" id="vc-opacity-range" min="15" max="100" step="5" value="${Math.round(draft.opacity * 100)}" />
                </div>
              </div>

              <div class="vcModalSection">
                <div class="vcSectionRow">
                  <label class="vcFieldLabel">Directional Keys</label>
                  <div class="vcSegmented">
                    <button type="button" class="vcSegBtn ${draft.bindings.directionPreset === 'arrows' ? 'active' : ''}" data-vc-preset="arrows">Arrows</button>
                    <button type="button" class="vcSegBtn ${draft.bindings.directionPreset === 'wasd' ? 'active' : ''}" data-vc-preset="wasd">WASD</button>
                  </div>
                </div>
                <div class="vcDirBindRow">
                  ${['up', 'down', 'left', 'right']
                    .map(
                      (d) => `
                    <div class="vcDirBindItem">
                      <span>${d.toUpperCase()}</span>
                      <button type="button" class="vcCaptureBtn" data-vc-capture-dir="${d}">${formatKeyShort(dirs[d])} (${dirs[d].code})</button>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>

              <div class="vcModalSection">
                <div class="vcSectionRow">
                  <label class="vcFieldLabel">Action Buttons</label>
                  <button type="button" class="vcSmallBtn" data-vc-add-action>+ Add Button</button>
                </div>
                <div class="vcActionList">
                  ${draft.bindings.actions
                    .map(
                      (a, idx) => `
                    <div class="vcActionRow" data-act-idx="${idx}">
                      <input type="text" class="vcActionLabelInput" maxlength="12" value="${a.label.replace(/"/g, '&quot;')}" data-vc-act-label="${idx}" />
                      <button type="button" class="vcCaptureBtn" data-vc-capture-act="${idx}">${formatKeyShort(a)} (${a.code})</button>
                      <button type="button" class="vcRemoveBtn" data-vc-remove-act="${idx}" title="Remove">&times;</button>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>
            </div>
            <div class="vcModalFooter">
              <button type="button" class="vcSecondaryBtn" data-vc-modal="reset">Reset Defaults</button>
              <button type="button" class="vcSecondaryBtn" data-vc-modal="edit-pos">Reposition on Screen</button>
              <button type="button" class="vcPrimaryBtn" data-vc-modal="save">Save &amp; Close</button>
            </div>
          </div>
        `;
      };

      const startKeyCapture = (btn, onCaptured) => {
        if (this.captureAbort) this.captureAbort.abort();
        const ctrl = new AbortController();
        this.captureAbort = ctrl;
        btn.textContent = 'Press any key...';
        btn.classList.add('capturing');

        const handler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ctrl.abort();
          this.captureAbort = null;
          onCaptured({
            key: e.key || e.code,
            code: e.code || e.key,
            keyCode: e.keyCode || e.which || 0,
          });
          renderModalBody();
        };
        window.addEventListener('keydown', handler, { capture: true, signal: ctrl.signal });
      };

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal();
          return;
        }
        const t = e.target.closest('button');
        if (!t) return;

        if (t.dataset.vcMode) {
          draft.mode = t.dataset.vcMode;
          renderModalBody();
        } else if (t.dataset.vcLayout) {
          draft.layout = t.dataset.vcLayout;
          renderModalBody();
        } else if (t.dataset.vcPreset) {
          const p = t.dataset.vcPreset;
          draft.bindings.directionPreset = p;
          if (DIRECTION_PRESETS[p]) {
            draft.bindings.directions = cloneJson(DIRECTION_PRESETS[p]);
          }
          renderModalBody();
        } else if (t.dataset.vcCaptureDir) {
          const d = t.dataset.vcCaptureDir;
          startKeyCapture(t, (info) => {
            draft.bindings.directionPreset = 'custom';
            draft.bindings.directions[d] = info;
          });
        } else if (t.dataset.vcCaptureAct !== undefined) {
          const idx = Number(t.dataset.vcCaptureAct);
          startKeyCapture(t, (info) => {
            if (draft.bindings.actions[idx]) {
              draft.bindings.actions[idx].key = info.key;
              draft.bindings.actions[idx].code = info.code;
              draft.bindings.actions[idx].keyCode = info.keyCode;
            }
          });
        } else if (t.dataset.vcRemoveAct !== undefined) {
          const idx = Number(t.dataset.vcRemoveAct);
          draft.bindings.actions.splice(idx, 1);
          renderModalBody();
        } else if (t.hasAttribute('data-vc-add-action')) {
          draft.bindings.actions.push({
            id: `act-${Date.now()}`,
            label: 'BTN',
            key: ' ',
            code: 'Space',
            keyCode: 32,
            x: null,
            y: null,
          });
          renderModalBody();
        } else if (t.dataset.vcModal === 'reset') {
          Object.assign(draft, createDefaultConfig());
          renderModalBody();
        } else if (t.dataset.vcModal === 'edit-pos') {
          this.setConfig(draft);
          this._commitConfig();
          this.manualOverride = true;
          this.editMode = true;
          closeModal();
          this.render();
        } else if (t.dataset.vcModal === 'save') {
          this.manualOverride = null;
          this.setConfig(draft);
          this._commitConfig();
          closeModal();
        } else if (t.dataset.vcModal === 'close') {
          closeModal();
        }
      });

      modal.addEventListener('input', (e) => {
        if (e.target.id === 'vc-scale-range') {
          draft.scale = Number(e.target.value) / 100;
          const lbl = modal.querySelector('#vc-scale-val');
          if (lbl) lbl.textContent = `${e.target.value}%`;
        } else if (e.target.id === 'vc-opacity-range') {
          draft.opacity = Number(e.target.value) / 100;
          const lbl = modal.querySelector('#vc-opacity-val');
          if (lbl) lbl.textContent = `${e.target.value}%`;
        } else if (e.target.dataset.vcActLabel !== undefined) {
          const idx = Number(e.target.dataset.vcActLabel);
          if (draft.bindings.actions[idx]) {
            draft.bindings.actions[idx].label = e.target.value.slice(0, 12) || 'BTN';
          }
        }
      });

      renderModalBody();
      document.body.appendChild(modal);
      this.modalEl = modal;
      if (root.RRWRAnimations && typeof root.RRWRAnimations.openLightbox === 'function') {
        root.RRWRAnimations.openLightbox(modal);
      } else {
        modal.classList.remove('hidden');
      }
    }
  }

  const instance = new VirtualController();
  root.RRWRVirtualController = instance;
  root.RRWRVirtualControllerUtils = {
    LAYOUTS,
    DIRECTION_PRESETS,
    createDefaultConfig,
    normalizeConfig,
    formatKeyShort,
  };
})(typeof window !== 'undefined' ? window : globalThis);
