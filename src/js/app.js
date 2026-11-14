/**
 * RRWR - Rust-Ruffle WebComic Reader
 * Frontend Webview Engine
 *
 * Provides:
 * - Dual-Mode IPC Client & Asset URL Resolver (?v=${overlayGeneration} cache busting)
 * - Tabbed Browser State Machine, Router, History & Bookmarks Drawer
 * - Story Page Renderer, Themes, Logs & Mod Hooks
 * - Music Player, Discography & Sound Test Audio
 * - Settings UI, Community Mod Toggles & Discord RPC Toggle
 */

(function (root) {
  'use strict';

  /* ==========================================================================
     1. Global Application State
     ========================================================================== */
  const state = {
    assetBase: (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('null'))
      ? window.location.origin
      : 'http://127.0.0.1:0',
    overlayGeneration: 0,
    isTauri: false,
    appInfo: null,
    activeTabKey: '000',
    currentRoute: { mode: 'HOMEPAGE' },
    currentPageData: null,
    pageCache: new Map(),
    musicData: null,
    availableMods: [],
    modFootnotes: {},
    modFancomics: {},
    modBrowserPages: {},
    modHomeRowItems: [],
    modSettings: {},
    modSettingsDescriptors: {},
    modThemes: [],
    modStyles: [],
    expandedMods: new Set(),
    collapsedModGroups: new Set(),
    expandedTreeNodes: new Set(),
    treeSearchQuery: '',
    uiPrefs: {
      animationsExpanded: false
    },
    modToggleBusy: false,
    pendingEnabledMods: null,
    saveDebounceTimer: null,
    flashSaveRestore: null,
    flashFrameGames: new WeakMap(),
    config: {
      assetPackPath: '',
      locale: 'en-US',
      enabledMods: [],
      tabData: {
        activeTabKey: '000',
        tabs: {
          '000': {
            key: '000',
            url: '/',
            title: 'RRWR',
            hasEmbed: false,
            history: [],
            future: []
          }
        },
        tabList: ['000'],
        sortedTabList: ['000'],
        closedTabList: []
      },
      saveData: {
        saves: {},
        saveList: [],
        flashStorage: {}
      },
      settings: {
        themeOverride: 'default',
        forceThemeOverride: false,
        hqAudio: true,
        masterVolume: 1.0,
        masterMuted: false,
        jsFlashes: true,
        ruffleFallback: true,
        cursedHistory: false,
        storyMode: false,
        switchToNewTabs: false,
        forceScrollBar: true,
        urlTooltip: true,
        openLogs: false,
        enableDiscordRpc: true,
        discordClientId: '',
        animationsEnabled: true,
        animationFps: 'native',
        animationCategories: {
          tabs: true,
          menus: true,
          bootSplash: true,
          modLoading: true,
          reloadIcon: true,
          uiMicro: true,
          pageTransitions: false
        },
        textOverride: {
          fontFamily: '',
          bold: false,
          fontSize: 0,
          lineHeight: 0,
          paragraphSpacing: false,
          highContrast: false
        }
      }
    },
    soundTest: {
      isPlaying: false,
      currentTrack: null,
      currentAlbum: null,
      audioEl: null
    }
  };

  /* ==========================================================================
     2. Dual-Mode IPC Client & Asset URL Resolver (F07)
     ========================================================================== */

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeModHtml(raw) {
    if (raw == null) return '';
    let str = String(raw);
    // Strip script and iframe tags
    str = str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/on\w+\s*=/gi, 'data-blocked=');
    // Ensure anchor tags are safe and open externally or trigger image preview
    str = str.replace(/<a\b([^>]*)>(.*?)<\/a>/gi, (match, attrs, innerText) => {
      const hrefMatch = attrs.match(/href=(['"])(.*?)\1/i);
      let href = hrefMatch ? hrefMatch[2].trim() : '#';
      if (href.startsWith('javascript:')) href = '#';
      const resolvedHref = resolveAssetUrl(href);
      const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(href);
      if (isImage) {
        return `<a href="${escapeHtml(resolvedHref)}" data-preview-img="${escapeHtml(resolvedHref)}" data-preview-title="${escapeHtml(innerText.trim())}" class="modLink modImagePreviewLink" title="Click to view image preview">${innerText}</a>`;
      }
      return `<a href="${escapeHtml(resolvedHref)}" target="_blank" rel="noopener noreferrer" class="modLink">${innerText}</a>`;
    });
    return str;
  }

  function extractModImagePreviews(descriptionHtml) {
    if (!descriptionHtml || typeof descriptionHtml !== 'string') return [];
    const regex = /<a\b[^>]*href=(['"])(.*?)\1[^>]*>(.*?)<\/a>/gi;
    const previews = [];
    let match;
    while ((match = regex.exec(descriptionHtml)) !== null) {
      const href = match[2].trim();
      const label = match[3].replace(/<[^>]+>/g, '').trim() || 'Preview';
      if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(href)) {
        previews.push({
          url: resolveAssetUrl(href),
          label: label
        });
      }
    }
    return previews;
  }

  function renderModPreviewsHtml(mod) {
    const previews = extractModImagePreviews(mod.description || '');
    if (previews.length === 0) return '';
    return `
      <div class="modPreviewSection">
        <div class="modPreviewHeader">
          <span class="modPreviewTitle">Previews (${previews.length}):</span>
        </div>
        <div class="modPreviewThumbnails">
          ${previews.map((p) => `
            <div class="modPreviewThumbCard" data-img-url="${escapeHtml(p.url)}" data-title="${escapeHtml(mod.title || mod.name || 'Mod')} — ${escapeHtml(p.label)}" title="Click to view full preview of ${escapeHtml(p.label)}">
              <div class="modPreviewThumbImgWrap">
                <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.label)}" class="modPreviewImg" loading="lazy" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='block';" />
                <span class="modPreviewFallback">[Image: ${escapeHtml(p.label)}]</span>
              </div>
              <span class="modPreviewThumbLabel">${escapeHtml(p.label)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function openImageLightbox(imgUrl, title = 'Image Preview') {
    let modal = document.getElementById('rrwr-image-lightbox');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'rrwr-image-lightbox';
      modal.className = 'rrwrImageLightbox hidden';
      modal.innerHTML = `
        <div class="lightboxBackdrop"></div>
        <div class="lightboxContainer">
          <div class="lightboxHeader">
            <span class="lightboxTitle"></span>
            <button class="lightboxCloseBtn" title="Close (Esc)">✕</button>
          </div>
          <div class="lightboxContent">
            <img class="lightboxImg" src="" alt="Preview" />
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = () => {
        if (window.RRWRAnimations) {
          window.RRWRAnimations.closeLightbox(modal, () => {
            const img = modal.querySelector('.lightboxImg');
            if (img) img.src = '';
          });
        } else {
          modal.classList.add('hidden');
          const img = modal.querySelector('.lightboxImg');
          if (img) img.src = '';
        }
      };

      modal.querySelector('.lightboxCloseBtn').addEventListener('click', close);
      modal.querySelector('.lightboxBackdrop').addEventListener('click', close);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
          close();
        }
      });
    }

    const titleEl = modal.querySelector('.lightboxTitle');
    const imgEl = modal.querySelector('.lightboxImg');
    if (titleEl) titleEl.textContent = title;
    if (imgEl) imgEl.src = imgUrl;
    if (window.RRWRAnimations) {
      window.RRWRAnimations.openLightbox(modal);
    } else {
      modal.classList.remove('hidden');
    }
  }

  /**
   * Universal IPC Invoker. Automatically uses Tauri IPC internals when available,
   * otherwise posts JSON to the Axum loopback /ipc HTTP mirror.
   */
  async function ipcInvoke(cmd, args = {}) {
    const tauriInvoke = (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function')
      ? window.__TAURI_INTERNALS__.invoke
      : (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke);

    // Map common aliases for complete backward/forward compatibility
    let command = cmd;
    let payload = Object.assign({}, args);

    if (command === 'get_config') {
      command = 'load_config';
    } else if (command === 'list_mods') {
      command = 'get_available_mods';
    }

    if (command === 'save_config') {
      const cfgObj = payload.config || payload.new_config || payload.newConfig || payload;
      payload = {
        config: cfgObj,
        new_config: cfgObj,
        newConfig: cfgObj
      };
    }

    if (command === 'get_story_page') {
      const pid = payload.page_id || payload.pageId || payload.id;
      if (pid) {
        payload.page_id = pid;
        payload.pageId = pid;
      }
    }

    if (command === 'save_mod_setting' || command === 'read_mod_file') {
      const mid = payload.mod_id || payload.modId;
      if (mid) {
        payload.mod_id = mid;
        payload.modId = mid;
      }
    }

    if (command === 'set_discord_presence') {
      const pid = payload.page_id || payload.pageId || payload.id;
      const title = payload.page_title || payload.pageTitle || payload.title;
      if (pid) {
        payload.page_id = pid;
        payload.pageId = pid;
      }
      if (title) {
        payload.page_title = title;
        payload.pageTitle = title;
        payload.title = title;
      }
      if (!payload.mode) {
        payload.mode = pid ? 'reading' : 'browsing';
      }
    }

    if (command === 'set_discord_music_presence') {
      const trk = payload.track || payload.track_title || payload.trackTitle || payload.track_name || payload.trackName;
      const alb = payload.album || payload.album_name || payload.albumName;
      if (trk) {
        payload.track = trk;
        payload.track_title = trk;
        payload.trackTitle = trk;
      }
      if (alb) {
        payload.album = alb;
        payload.album_name = alb;
        payload.albumName = alb;
      }
    }

    if (tauriInvoke) {
      try {
        return await tauriInvoke(command, payload);
      } catch (err) {
        // Fall back to HTTP if Tauri invoke fails in development or hybrid mode
        console.warn(`[RRWR-IPC] Tauri invoke failed for '${command}', falling back to HTTP:`, err);
      }
    }

    // HTTP /ipc loopback fallback
    try {
      const resp = await fetch(`${state.assetBase}/ipc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ cmd: command, args: payload })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`IPC '${command}' error [${resp.status}]: ${errorText}`);
      }

      return await resp.json();
    } catch (e) {
      // Graceful fallback for non-critical telemetry or presence endpoints
      if (command.includes('discord')) {
        console.debug(`[RRWR-IPC] Discord RPC non-fatal notice:`, e.message);
        return { status: 'unsupported', enabled: false, connected: false };
      }
      throw e;
    }
  }

  /**
   * Transforms logical or relative asset references into full HTTP/VFS paths.
   * Injects cache-busting `?v=${overlayGeneration}` when community mods change.
   */
  function resolveAssetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let url = rawUrl.trim();

    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return url;
    }

    // Bundled frontend web assets (served directly by webview origin on mobile or desktop)
    const isBundledAsset =
      url.startsWith('/styles/') ||
      url.startsWith('/js/') ||
      url.startsWith('/fonts/') ||
      url === '/' ||
      url === '/index.html';

    if (isBundledAsset) {
      return url;
    }

    let resolved = '';
    if (url.startsWith('assets://')) {
      const rest = url.slice('assets://'.length).replace(/^\/+/, '');
      resolved = `${state.assetBase}/assets/${rest}`;
    } else if (url.startsWith('/assets/')) {
      resolved = `${state.assetBase}${url}`;
    } else if (url.startsWith('/')) {
      resolved = `${state.assetBase}/assets${url}`;
    } else {
      resolved = `${state.assetBase}/assets/${url}`;
    }

    // Append cache-busting token if community mod overlay has updated
    if (state.overlayGeneration > 0 && !resolved.startsWith('data:') && !resolved.startsWith('blob:')) {
      const separator = resolved.includes('?') ? '&' : '?';
      resolved = `${resolved}${separator}v=${state.overlayGeneration}`;
    }
    return resolved;
  }

  /* ==========================================================================
     3. Configuration Persistence & Debouncing (F08)
     ========================================================================== */

  function persistConfig(immediate = false) {
    if (state.saveDebounceTimer) {
      clearTimeout(state.saveDebounceTimer);
      state.saveDebounceTimer = null;
    }

    const saveAction = async () => {
      try {
        if (!state.config.settings) state.config.settings = {};
        if (Array.isArray(state.config.enabledMods)) {
          state.config.settings.modListEnabled = [...state.config.enabledMods];
        } else if (Array.isArray(state.config.settings.modListEnabled)) {
          state.config.enabledMods = [...state.config.settings.modListEnabled];
        }
        await ipcInvoke('save_config', {
          config: state.config,
          new_config: state.config,
          newConfig: state.config
        });
      } catch (err) {
        console.error('[RRWR-Config] Failed to persist config:', err);
      }
    };

    if (immediate) {
      return saveAction();
    } else {
      state.saveDebounceTimer = setTimeout(saveAction, 150);
    }
  }

  async function loadConfig() {
    try {
      const cfg = await ipcInvoke('load_config');
      if (cfg && typeof cfg === 'object') {
        state.config = Object.assign(state.config, cfg);
        const list = (cfg.settings && Array.isArray(cfg.settings.modListEnabled))
          ? cfg.settings.modListEnabled
          : (Array.isArray(cfg.enabledMods) ? cfg.enabledMods : []);
        state.config.enabledMods = [...list];
        if (!state.config.settings) state.config.settings = {};
        state.config.settings.modListEnabled = [...list];

        if (cfg.tabData && cfg.tabData.activeTabKey) {
          state.activeTabKey = cfg.tabData.activeTabKey;
        }
        if (window.RRWRAnimations) {
          window.RRWRAnimations.normalizeSettings(state.config.settings);
        }
        applyGlobalSettings(state.config.settings);

        const initialTheme = computeActiveTheme(null, state.config.settings);
        applyTheme(initialTheme);
      }
    } catch (err) {
      console.warn('[RRWR-Config] load_config failed, using defaults:', err);
    }
  }

  function applyGlobalSettings(settings) {
    if (!settings) return;
    if (window.RRWRAnimations) {
      window.RRWRAnimations.applySettings(settings);
    }
    const body = document.body;
    if (body) {
      if (settings.forceScrollBar) {
        body.classList.add('force-scrollbar');
      } else {
        body.classList.remove('force-scrollbar');
      }
    }
  }

  /* ==========================================================================
     4. Tabbed Browser State Machine & Chrome (F08)
     ========================================================================== */

  let tabCounter = 1;

  function generateTabKey() {
    return 'tab_' + String(++tabCounter).padStart(3, '0') + '_' + Math.random().toString(36).substr(2, 4);
  }

  function getActiveTab() {
    const tabs = state.config.tabData.tabs;
    return tabs[state.activeTabKey] || tabs[state.config.tabData.tabList[0]];
  }

  function getPerf() {
    return (typeof window !== 'undefined' && window.__rrwrPerf) || root.RRWRPerf || null;
  }

  let lastNewTabCall = { url: '', time: 0 };

  function newTab(url = '/', adjacent = false, switchTo = true) {
    const now = Date.now();
    if (lastNewTabCall.url === url && now - lastNewTabCall.time < 200) {
      return state.activeTabKey;
    }
    lastNewTabCall = { url, time: now };

    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('newTab', { url, alwaysLog: true }) : null;

    const tabData = state.config.tabData;
    const key = generateTabKey();
    const newTabObj = {
      key: key,
      url: url,
      title: 'RRWR',
      hasEmbed: false,
      history: [],
      future: []
    };

    tabData.tabs[key] = newTabObj;

    if (adjacent && tabData.tabList.includes(state.activeTabKey)) {
      const idx = tabData.tabList.indexOf(state.activeTabKey);
      tabData.tabList.splice(idx + 1, 0, key);
    } else {
      tabData.tabList.push(key);
    }

    if (!tabData.sortedTabList) tabData.sortedTabList = [];
    tabData.sortedTabList.unshift(key);

    if (window.RRWRAnimations) {
      window.RRWRAnimations.pulseNewTabButton();
      window.RRWRAnimations.markTabEntering(key);
    }

    if (switchTo || state.config.settings.switchToNewTabs) {
      switchTab(key, { deferRoute: true, fromNewTab: true });
    } else {
      renderTabBar();
      setTimeout(() => persistConfig(), 0);
    }
    if (perf) perf.endPhase(perfTok, { key });
    return key;
  }

  function closeTab(key = state.activeTabKey) {
    const perf = getPerf();
    const tabData = state.config.tabData;
    const list = tabData.tabList;
    const closedUrl = tabData.tabs[key]?.url || '/';
    const perfTok = perf ? perf.beginPhase('closeTab', { key, closedUrl, alwaysLog: true }) : null;
    if (perf) perf.startBurst('closeTab', 1200);

    if (list.length <= 1) {
      // Don't close last remaining tab; reset it to homepage
      const onlyTab = tabData.tabs[list[0]];
      if (onlyTab) {
        onlyTab.url = '/';
        onlyTab.title = 'RRWR';
        onlyTab.history = [];
        onlyTab.future = [];
        pushUrl('/', true);
      }
      renderTabBar();
      persistConfig();
      if (perf) perf.endPhase(perfTok, { resetToHome: true });
      return;
    }

    if (window.RRWRAnimations) {
      window.RRWRAnimations.animateTabClose(key);
      window.RRWRAnimations.clearTabScrollStates(key);
    }

    const idx = list.indexOf(key);
    if (idx !== -1) {
      list.splice(idx, 1);
    }

    if (tabData.sortedTabList) {
      const sIdx = tabData.sortedTabList.indexOf(key);
      if (sIdx !== -1) tabData.sortedTabList.splice(sIdx, 1);
    }

    if (!tabData.closedTabList) tabData.closedTabList = [];
    const closedTab = tabData.tabs[key];
    if (closedTab) {
      tabData.closedTabList.push({ key, index: idx, tab: closedTab });
      if (tabData.closedTabList.length > 25) tabData.closedTabList.shift();
      delete tabData.tabs[key];
    }

    if (state.activeTabKey === key) {
      // Find candidate in sortedTabList or adjacent tab
      let nextKey = null;
      if (tabData.sortedTabList && tabData.sortedTabList.length > 0) {
        for (const candidate of tabData.sortedTabList) {
          if (list.includes(candidate)) {
            nextKey = candidate;
            break;
          }
        }
      }
      if (!nextKey) {
        nextKey = list[Math.min(idx, list.length - 1)];
      }
      switchTab(nextKey);
    } else {
      renderTabBar();
      persistConfig();
    }
    if (perf) perf.endPhase(perfTok, { nextActive: state.activeTabKey });
  }

  function switchTab(key, options = {}) {
    const tabData = state.config.tabData;
    if (!tabData.tabs[key]) return;
    if (state.activeTabKey === key) return;

    const perf = getPerf();
    const targetUrl = tabData.tabs[key]?.url || '/';
    const perfTok = perf ? perf.beginPhase('switchTab', { key, targetUrl, defer: Boolean(options.deferRoute), alwaysLog: true }) : null;
    if (perf) {
      perf.setCurrentRoute(targetUrl);
      perf.startBurst('switchTab', 1200, targetUrl);
    }

    if (window.RRWRAnimations) {
      const prevTab = getActiveTab();
      if (prevTab && prevTab.key !== key) {
        window.RRWRAnimations.captureScrollState(prevTab);
      }
      if (!options.fromNewTab) {
        window.RRWRAnimations.markTabActivated(key);
      }
    }

    state.activeTabKey = key;
    tabData.activeTabKey = key;

    if (!tabData.sortedTabList) tabData.sortedTabList = [];
    const sIdx = tabData.sortedTabList.indexOf(key);
    if (sIdx !== -1) tabData.sortedTabList.splice(sIdx, 1);
    tabData.sortedTabList.unshift(key);

    const activeTab = tabData.tabs[key];
    renderTabBar();
    updateAddressBar(activeTab.url);
    updateNavControls();

    const finishTabSwitch = () => {
      if (state.activeTabKey !== key) return;
      const finishTok = perf ? perf.beginPhase('switchTab:finish', { key, targetUrl }) : null;
      renderRoute(resolveRoute(activeTab.url), { transition: false });
      persistConfig();
      if (perf) perf.endPhase(finishTok);
    };

    if (options.deferRoute && typeof requestAnimationFrame === 'function' && !document.hidden) {
      requestAnimationFrame(() => {
        setTimeout(finishTabSwitch, 18);
      });
    } else {
      finishTabSwitch();
    }
    if (perf) perf.endPhase(perfTok);
  }

  function restoreClosedTab() {
    const tabData = state.config.tabData;
    if (!tabData.closedTabList || tabData.closedTabList.length === 0) return;

    const restored = tabData.closedTabList.pop();
    const key = restored.key;
    tabData.tabs[key] = restored.tab;

    const insertIdx = Math.min(restored.index, tabData.tabList.length);
    tabData.tabList.splice(insertIdx, 0, key);

    if (window.RRWRAnimations) {
      window.RRWRAnimations.markTabEntering(key);
    }
    switchTab(key);
  }

  function duplicateTab(key = state.activeTabKey) {
    const active = state.config.tabData.tabs[key];
    if (!active) return;
    newTab(active.url, true, true);
  }

  function pushUrl(rawUrl, replace = false, targetKey = state.activeTabKey) {
    if (typeof replace === 'string') {
      const actualTarget = replace;
      replace = !!targetKey;
      targetKey = actualTarget;
    }
    if (!targetKey || typeof targetKey !== 'string') {
      targetKey = state.activeTabKey;
    }

    const tab = state.config.tabData.tabs[targetKey] || getActiveTab();
    if (!tab) return;

    let url = (rawUrl || '/').trim();
    if (!url.startsWith('/') && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = '/' + url;
    }

    if (url === tab.url && !replace) {
      return;
    }

    if (window.RRWRAnimations && targetKey === state.activeTabKey) {
      window.RRWRAnimations.captureScrollState(tab);
    }

    if (!replace && tab.url) {
      if (!tab.history) tab.history = [];
      tab.history.push(tab.url);
      tab.future = [];
      if (window.RRWRAnimations) {
        window.RRWRAnimations.pruneForwardScrollStates(targetKey, tab.history.length);
      }
    }

    tab.url = url;

    // Synchronize HTML5 Browser History API (for Back / Forward / Refresh support)
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
      try {
        const formatted = formatAddressUrl(url);
        if (replace) {
          window.history.replaceState({ tabKey: targetKey, url }, '', formatted);
        } else if (window.location.pathname !== formatted) {
          window.history.pushState({ tabKey: targetKey, url }, '', formatted);
        }
      } catch (_) {}
    }

    persistConfig();
    if (targetKey === state.activeTabKey) {
      updateAddressBar(url);
      updateNavControls();
      return renderRoute(resolveRoute(url), { transition: true });
    }
  }

  function historyBack(targetKey = state.activeTabKey) {
    if (!targetKey || typeof targetKey !== 'string') targetKey = state.activeTabKey;
    const tab = state.config.tabData.tabs[targetKey] || getActiveTab();
    if (!tab || !tab.history || tab.history.length === 0) return;

    if (window.RRWRAnimations && targetKey === state.activeTabKey) {
      window.RRWRAnimations.captureScrollState(tab);
    }

    if (!tab.future) tab.future = [];
    tab.future.unshift(tab.url);

    const prevUrl = tab.history.pop();
    tab.url = prevUrl;

    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      try {
        window.history.replaceState({ tabKey: targetKey, url: prevUrl }, '', formatAddressUrl(prevUrl));
      } catch (_) {}
    }

    if (targetKey === state.activeTabKey) {
      updateAddressBar(prevUrl);
      updateNavControls();
      renderRoute(resolveRoute(prevUrl), { transition: true });
    }
    persistConfig();
  }

  function historyForward(targetKey = state.activeTabKey) {
    if (!targetKey || typeof targetKey !== 'string') targetKey = state.activeTabKey;
    const tab = state.config.tabData.tabs[targetKey] || getActiveTab();
    if (!tab || !tab.future || tab.future.length === 0) return;

    if (window.RRWRAnimations && targetKey === state.activeTabKey) {
      window.RRWRAnimations.captureScrollState(tab);
    }

    if (!tab.history) tab.history = [];
    tab.history.push(tab.url);

    const nextUrl = tab.future.shift();
    tab.url = nextUrl;

    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      try {
        window.history.replaceState({ tabKey: targetKey, url: nextUrl }, '', formatAddressUrl(nextUrl));
      } catch (_) {}
    }

    if (targetKey === state.activeTabKey) {
      updateAddressBar(nextUrl);
      updateNavControls();
      renderRoute(resolveRoute(nextUrl), { transition: true });
    }
    persistConfig();
  }

  async function refreshActivePage() {
    const tab = getActiveTab();
    if (!tab) return;
    if (window.RRWRAnimations) {
      window.RRWRAnimations.captureScrollState(tab);
      window.RRWRAnimations.triggerReloadSpin();
    }
    const route = resolveRoute(tab.url);
    if (route.mode === 'PAGE' && state.pageCache) {
      state.pageCache.delete(route.pageId);
    }
    try {
      await renderRoute(route, { preserveScroll: true });
    } finally {
      if (window.RRWRAnimations) {
        window.RRWRAnimations.finishReloadSpin();
      }
    }
  }

  function renderTabBar() {
    if (typeof document === 'undefined') return;
    const perf = getPerf();
    const perfTok = perf ? perf.beginPhase('renderTabs') : null;
    const tabListEl = document.getElementById('tabs') || document.getElementById('tab-list');
    if (!tabListEl) {
      if (perf) perf.endPhase(perfTok);
      return;
    }

    const tabData = state.config.tabData;
    if (window.RRWRAnimations) {
      window.RRWRAnimations.syncTabBar({
        tabListEl,
        tabData,
        activeTabKey: state.activeTabKey,
        onSelectTab: switchTab,
        onCloseTab: closeTab,
        onReorder: () => persistConfig()
      });
    } else {
      tabListEl.innerHTML = '';

      for (const key of tabData.tabList) {
        const tab = tabData.tabs[key];
        if (!tab) continue;

        const shell = document.createElement('li');
        shell.className = 'tabShell' + (key === state.activeTabKey ? ' activeTabShell' : '');

        const tabEl = document.createElement('div');
        tabEl.className = 'tab' + (key === state.activeTabKey ? ' activeTab' : '');
        tabEl.setAttribute('data-tab-key', key);
        tabEl.setAttribute('role', 'tab');
        tabEl.setAttribute('aria-selected', key === state.activeTabKey ? 'true' : 'false');

        const titleSpan = document.createElement('div');
        titleSpan.className = 'tabTitle';
        const textSpan = document.createElement('span');
        textSpan.textContent = tab.title || 'RRWR';
        titleSpan.appendChild(textSpan);
        tabEl.appendChild(titleSpan);

        if (tabData.tabList.length > 1) {
          const closeBtn = document.createElement('div');
          closeBtn.className = 'systemButton closeTabButton';
          closeBtn.title = 'Close Tab (Ctrl+W)';
          closeBtn.textContent = 'x';
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(key);
          });
          tabEl.appendChild(closeBtn);
        }

        tabEl.addEventListener('click', () => switchTab(key));
        shell.appendChild(tabEl);
        tabListEl.appendChild(shell);
      }
    }

    const titleTextEl = document.getElementById('titleBarText');
    if (titleTextEl) {
      const activeTab = getActiveTab();
      titleTextEl.textContent = activeTab ? (activeTab.title || 'RRWR') : 'RRWR';
    }
    if (perf) perf.endPhase(perfTok);
  }

  function updateAddressBar(url) {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('address-bar-input');
    if (!input) return;
    input.value = formatAddressUrl(url);
  }

  function updateNavControls() {
    if (typeof document === 'undefined') return;
    const tab = getActiveTab();
    const backBtn = document.getElementById('nav-back-btn');
    const fwdBtn = document.getElementById('nav-forward-btn');

    if (backBtn) {
      backBtn.disabled = !tab || !tab.history || tab.history.length === 0;
    }
    if (fwdBtn) {
      fwdBtn.disabled = !tab || !tab.future || tab.future.length === 0;
    }
  }

  /* ==========================================================================
     5. URL Routing & Page ID Helpers
     ========================================================================== */

  function formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const date = new Date(Number(ts) * 1000);
      const options = {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      };
      return new Intl.DateTimeFormat('en-US', {
        ...options,
        timeZoneName: 'short'
      }).format(date);
    } catch (_) {
      return '';
    }
  }

  function formatAddressUrl(url) {
    if (!url) return '/';
    const route = resolveRoute(url);
    if (route.mode === 'PAGE') {
      return `/page/${route.pageId}`;
    }
    if (route.mode === 'BROWSE') {
      return route.nodeId ? `/browse/${encodeURIComponent(route.nodeId)}` : '/';
    }
    return url;
  }

  function resolveRoute(rawUrl) {
    if (!rawUrl || rawUrl === '' || rawUrl === '/' || rawUrl === '/home' || rawUrl === '/index.html') {
      return { mode: 'HOMEPAGE' };
    }

    let url = rawUrl.trim();

    // Fancomic routes (/page/fanventure:<storyId>:<pageNum>)
    if (url.startsWith('/page/fanventure:')) {
      const rest = url.slice('/page/fanventure:'.length);
      const parts = rest.split(':');
      const storyId = parts[0] ? decodeURIComponent(parts[0]) : null;
      const pageNum = parseInt(parts[1], 10) || 1;
      return { mode: 'FANCOMIC', storyId, pageNum };
    }

    // Classic query string format `?s=1&p=000001`
    if (url.includes('?')) {
      const parts = url.split('?');
      const queryParams = new URLSearchParams(parts[1]);
      if (queryParams.has('p')) {
        let p = queryParams.get('p');
        if (/^\d+$/.test(p) && p.length < 6) p = p.padStart(6, '0');
        return { mode: 'PAGE', pageId: p };
      }
    }

    // Extract clean path without query string or trailing slashes
    let cleanPath = url.split('?')[0].trim();
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.replace(/\/+$/, '');
    }

    if (cleanPath === '' || cleanPath === '/' || cleanPath === '/home' || cleanPath === '/index.html') {
      return { mode: 'HOMEPAGE' };
    }

    // Direct system routes
    if (cleanPath === '/settings') return { mode: 'SETTINGS' };
    if (cleanPath === '/browse') return { mode: 'BROWSE', nodeId: null };
    if (cleanPath.startsWith('/browse/')) {
      const encoded = cleanPath.slice('/browse/'.length);
      let nodeId = encoded;
      try { nodeId = decodeURIComponent(encoded); } catch (_) {}
      return { mode: 'BROWSE', nodeId: nodeId || null };
    }
    if (cleanPath.startsWith('/search')) {
      const parts = cleanPath.split('/').filter(Boolean);
      return { mode: 'SEARCH', query: decodeURIComponent(parts[1] || '') };
    }

    // Music routes
    if (cleanPath === '/music' || cleanPath === '/music/discography') {
      return { mode: 'MUSIC', view: 'discography' };
    }
    if (cleanPath === '/music/tracks') {
      return { mode: 'MUSIC', view: 'tracks' };
    }
    if (cleanPath === '/music/artists') {
      return { mode: 'MUSIC', view: 'artists' };
    }
    if (cleanPath === '/music/features') {
      return { mode: 'MUSIC', view: 'features' };
    }
    if (cleanPath.startsWith('/music/album/')) {
      return { mode: 'MUSIC', view: 'album', id: cleanPath.slice('/music/album/'.length) };
    }
    if (cleanPath.startsWith('/music/track/')) {
      return { mode: 'MUSIC', view: 'track', id: cleanPath.slice('/music/track/'.length) };
    }
    if (cleanPath.startsWith('/music/artist/')) {
      return { mode: 'MUSIC', view: 'artist', id: cleanPath.slice('/music/artist/'.length) };
    }

    // Story Page routes (/page/<id>)
    if (cleanPath.startsWith('/page/')) {
      const rawPid = cleanPath.slice('/page/'.length).trim();
      let pid = rawPid;
      if (/^\d+$/.test(rawPid) && rawPid.length < 6) {
        pid = rawPid.padStart(6, '0');
      }
      return { mode: 'PAGE', pageId: pid };
    }

    // Numeric shorthand fallback
    const numericMatch = cleanPath.match(/^\/(\d+)$/);
    if (numericMatch) {
      const n = numericMatch[1];
      return { mode: 'PAGE', pageId: n.padStart(6, '0') };
    }

    // Custom mod browserPages routes (e.g. /povmap -> POVMAP)
    const cleanRouteKey = cleanPath.replace(/^\/+|\/+$/g, '').toUpperCase();
    const browserPages = (state.modBrowserPages && Object.keys(state.modBrowserPages).length > 0)
      ? state.modBrowserPages
      : (root.RRWRModHooks && root.RRWRModHooks.ModRuntime && typeof root.RRWRModHooks.ModRuntime.getState === 'function'
          ? (root.RRWRModHooks.ModRuntime.getState().browserPages || {})
          : {});
    if (cleanRouteKey) {
      const matchedKey = Object.keys(browserPages).find((k) => k.toUpperCase() === cleanRouteKey);
      if (matchedKey) {
        return { mode: 'BROWSER_PAGE', pageKey: matchedKey };
      }
    }

    return { mode: 'HOMEPAGE' };
  }

  /* ==========================================================================
     6. Story Page Renderer & Chatlogs (F09 & F10)
     ========================================================================== */

  function computeActiveTheme(pageTheme, settings) {
    const s = settings || (state && state.config && state.config.settings) || {};
    // 1. Force override takes precedence over everything
    if (s.forceThemeOverride && s.themeOverride && s.themeOverride !== 'default') {
      return s.themeOverride;
    }
    // 2. Canonical story theme from story.json if present (e.g. dark, retro, high-contrast, neon, glitch, pastel, wide, finale, mono, classic)
    if (pageTheme && typeof pageTheme === 'string' && pageTheme.trim() !== '') {
      return pageTheme.trim();
    }
    // 3. User theme override takes precedence for all standard story & system pages
    if (s.themeOverride && s.themeOverride !== 'default') {
      return s.themeOverride;
    }
    // 4. Default theme
    return 'default';
  }

  function applyTheme(theme) {
    if (typeof document === 'undefined') return;
    const validTheme = theme || 'default';
    const themeClass = validTheme.startsWith('theme-') ? validTheme : ('theme-' + validTheme);
    const appEl = document.getElementById('app');
    const pageContainer = document.getElementById('page-container');
    const body = document.body;
    const docEl = document.documentElement;

    if (
      pageContainer &&
      pageContainer.getAttribute('data-theme') === validTheme &&
      pageContainer.dataset.legacyTheme === validTheme &&
      pageContainer.classList.contains('customStyles') &&
      (!appEl || appEl.getAttribute('data-theme') === validTheme) &&
      (!docEl || docEl.getAttribute('data-theme') === validTheme)
    ) {
      return;
    }

    if (docEl) {
      docEl.setAttribute('data-theme', validTheme);
    }

    if (body) {
      body.setAttribute('data-theme', validTheme);
      const toRemove = [];
      body.classList.forEach((cls) => {
        if (cls.startsWith('theme-')) toRemove.push(cls);
      });
      toRemove.forEach((cls) => body.classList.remove(cls));
      body.classList.add(themeClass);
    }

    if (appEl) {
      appEl.setAttribute('data-theme', validTheme);
      const toRemove = [];
      appEl.classList.forEach((cls) => {
        if (cls.startsWith('theme-')) toRemove.push(cls);
      });
      toRemove.forEach((cls) => appEl.classList.remove(cls));
      appEl.classList.add(themeClass);
    }

    if (pageContainer) {
      pageContainer.setAttribute('data-theme', validTheme);
      const toRemove = [];
      pageContainer.classList.forEach((cls) => {
        if (cls.startsWith('theme-')) toRemove.push(cls);
      });
      toRemove.forEach((cls) => pageContainer.classList.remove(cls));
      pageContainer.classList.add('pageBody');
      pageContainer.classList.add(themeClass);
    }

    // Legacy mods target the unprefixed theme on both reader surfaces.
    for (const surface of [document.getElementById('tab-viewport'), pageContainer]) {
      if (!surface) continue;
      const previousTheme = surface.dataset.legacyTheme;
      if (previousTheme) surface.classList.remove(previousTheme);
      surface.classList.add(validTheme);
      surface.dataset.legacyTheme = validTheme;
    }
    if (pageContainer) pageContainer.classList.add('customStyles');
  }

  function evaluateFallbackLogButtonText(rawContent, isHidden, enabledMods, locale) {
    const match = rawContent.match(/\|(.*?)\|/);
    const rawTag = match ? match[1] : 'LOG';
    const statePrefix = isHidden ? 'Show ' : 'Hide ';

    if (/PASSCODE HINT/i.test(rawTag)) {
      return rawTag;
    }
    let tag = rawTag.toLowerCase();
    if (/styledlog/i.test(rawTag)) {
      tag = 'styledlog';
    } else if (/specialnote/i.test(rawTag)) {
      tag = 'specialnote';
    }
    return statePrefix + tag;
  }

  function getLogButtonLabel(rawContent, isHidden) {
    if (root.RRWRModHooks && typeof root.RRWRModHooks.getLogButtonText === 'function') {
      try {
        const text = root.RRWRModHooks.getLogButtonText(rawContent, isHidden, state.config.enabledMods);
        if (text && typeof text === 'string') return text;
      } catch (e) {
        console.warn('[RRWR-ModHooks] getLogButtonText error:', e);
      }
    }
    return evaluateFallbackLogButtonText(
      rawContent,
      isHidden,
      state.config.enabledMods,
      state.config.locale
    );
  }

  function rewriteHtmlContent(html) {
    if (!html) return '';
    let processed = html;

    // Rewrite internal images
    processed = processed.replace(/<img([^>]+)src=["']([^"']+)["']/gi, (match, prefix, src) => {
      const resolved = resolveAssetUrl(src);
      return `<img${prefix}src="${resolved}"`;
    });

    // Rewrite remaining assets:// URLs in inline style="background-image:url(assets://...)" or <style> blocks
    processed = processed.replace(/assets:\/\/[^\s"'()<>]+/gi, (match) => {
      return resolveAssetUrl(match);
    });

    return processed;
  }

  function updateReadingProgress(pageId) {
    if (!pageId) return;
    const n = parseInt(pageId, 10);
    if (isNaN(n)) return;

    if (n >= 1) {
      if (!state.config) state.config = {};
      if (!state.config.settings) state.config.settings = {};
      if (!state.config.settings.readingProgress) {
        state.config.settings.readingProgress = { current: '000001', limit: '000002' };
      }
      const padded = String(n).padStart(6, '0');
      state.config.settings.readingProgress.current = padded;

      const prevLimit = parseInt(state.config.settings.readingProgress.limit, 10) || 2;
      if (n >= prevLimit - 1) {
        state.config.settings.readingProgress.limit = String(n + 1).padStart(6, '0');
      }

      state.hasReadStory = true;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('rrwr_reading_active', '1');
        }
      } catch (_) {}

      // Persist automatically to config.json
      persistConfig(false);
    }
  }

  let storyRenderGeneration = 0;

  function isInternalHref(href) {
    return Boolean(
      href && (
        href.startsWith('/') ||
        href.startsWith('?s=')
      )
    );
  }

  function attachDelegatedInternalLinks(container) {
    if (!container || container.dataset.rrwrDelegated === 'true') return;
    container.dataset.rrwrDelegated = 'true';
    container.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link || !container.contains(link)) return;
      const href = link.getAttribute('href');
      if (!isInternalHref(href)) return;
      e.preventDefault();
      e.stopPropagation();
      pushUrl(href);
    });
  }

  function cleanupMediaSlot(mediaContainer) {
    if (root.RRWRMediaEngine && typeof root.RRWRMediaEngine.cleanupActiveMedia === 'function') {
      root.RRWRMediaEngine.cleanupActiveMedia();
    }
    if (!mediaContainer) return;
    const mediaEls = mediaContainer.querySelectorAll('audio, video');
    for (let i = 0; i < mediaEls.length; i++) {
      try {
        const el = mediaEls[i];
        el.pause();
        el.removeAttribute('src');
        if (typeof el.load === 'function') el.load();
      } catch (_) {}
    }
    const iframes = mediaContainer.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      try {
        const iframe = iframes[i];
        iframe.srcdoc = '';
        iframe.src = 'about:blank';
        iframe.remove();
      } catch (_) {}
    }
    mediaContainer.style.transition = '';
    mediaContainer.style.width = '';
    if (mediaContainer.childElementCount > 0 || mediaContainer.textContent !== '') {
      mediaContainer.textContent = '';
    }
  }

  function isStoryShellMounted(pageContent) {
    if (!pageContent || pageContent.dataset.storyShell !== '1') return false;
    const shell = pageContent._storyShell;
    if (!shell) return false;
    return Boolean(
      shell.prefaceNotesEl && shell.prefaceNotesEl.parentNode === pageContent &&
      shell.titleEl && shell.titleEl.parentNode === pageContent &&
      shell.mediaContainer && shell.mediaContainer.parentNode === pageContent &&
      shell.textContainer && shell.textContainer.parentNode === pageContent &&
      shell.commandContainer && shell.commandContainer.parentNode === pageContent &&
      shell.footerNav && shell.footerNav.parentNode === pageContent &&
      shell.footerNotesEl && shell.footerNotesEl.parentNode === pageContent
    );
  }

  function buildFooterNavShell(footerNav) {
    footerNav.textContent = '';

    const navOptions = document.createElement('ul');
    navOptions.className = 'navOptions';

    const liStart = document.createElement('li');
    const startOverLink = document.createElement('a');
    startOverLink.className = 'startOver';
    startOverLink.textContent = 'Start Over';
    liStart.appendChild(startOverLink);
    navOptions.appendChild(liStart);

    const liBack = document.createElement('li');
    const backLink = document.createElement('a');
    backLink.className = 'goBack';
    backLink.textContent = 'Go Back';
    liBack.appendChild(backLink);
    navOptions.appendChild(liBack);

    footerNav.appendChild(navOptions);

    const metaUl = document.createElement('ul');
    metaUl.className = 'meta';

    const liTime = document.createElement('li');
    const timeDiv = document.createElement('div');
    timeDiv.className = 'timestamp';
    liTime.appendChild(timeDiv);
    metaUl.appendChild(liTime);

    const liSource = document.createElement('li');
    const sourceLink = document.createElement('a');
    sourceLink.className = 'sourceLink';
    liSource.appendChild(sourceLink);
    metaUl.appendChild(liSource);

    footerNav.appendChild(metaUl);
    attachDelegatedInternalLinks(footerNav);

    footerNav._navRefs = {
      liStart,
      startOverLink,
      liBack,
      backLink,
      liTime,
      timeDiv,
      sourceLink
    };
    return footerNav._navRefs;
  }

  function ensureStoryShell(pageContent) {
    if (isStoryShellMounted(pageContent)) {
      return { shell: pageContent._storyShell, wasMounted: true };
    }

    pageContent.innerHTML = `
      <div id="footnotes-preface-container" class="modFootnotes modFootnotesPreface" style="display:none;"></div>
      <h1 id="page-title" class="pageTitle">Loading...</h1>
      <div id="media-container" class="mediaContent"></div>
      <div id="text-container" class="textContent"><p class="storyParagraph">Fetching story page data...</p></div>
      <div id="command-container" class="commandContent"></div>
      <div id="footer-nav" class="footerNav"></div>
      <div id="footnotes-footer-container" class="modFootnotes modFootnotesFooter" style="display:none;"></div>
    `;

    const prefaceNotesEl = document.getElementById('footnotes-preface-container');
    const titleEl = document.getElementById('page-title');
    const mediaContainer = document.getElementById('media-container');
    const textContainer = document.getElementById('text-container');
    const commandContainer = document.getElementById('command-container');
    const footerNav = document.getElementById('footer-nav');
    const footerNotesEl = document.getElementById('footnotes-footer-container');

    attachDelegatedInternalLinks(commandContainer);
    buildFooterNavShell(footerNav);

    const shell = {
      prefaceNotesEl,
      titleEl,
      mediaContainer,
      textContainer,
      commandContainer,
      footerNav,
      footerNotesEl
    };
    pageContent._storyShell = shell;
    pageContent.dataset.storyShell = '1';
    return { shell, wasMounted: false };
  }

  function patchBannerSlot(bannerContainer, bannerSrc) {
    if (!bannerContainer) return;
    let img = bannerContainer.querySelector('img.bannerImage');
    if (bannerSrc) {
      if (!img) {
        bannerContainer.textContent = '';
        img = document.createElement('img');
        img.className = 'bannerImage';
        img.alt = 'Act Header Banner';
        bannerContainer.appendChild(img);
      }
      if (img.getAttribute('src') !== bannerSrc) {
        img.src = bannerSrc;
      }
      if (bannerContainer.style.display !== 'flex') {
        bannerContainer.style.display = 'flex';
      }
    } else {
      if (bannerContainer.style.display !== 'none') {
        bannerContainer.style.display = 'none';
      }
      if (img && img.hasAttribute('src')) {
        img.removeAttribute('src');
      }
    }
  }

  function patchTextSlot(textContainer, rawContent, settings) {
    if (!textContainer) return;
    const logMatch = rawContent.match(/^\|(.*?)\|\s*(?:<br\s*\/?>)?\s*/i);

    if (logMatch) {
      const logType = logMatch[1].trim().toUpperCase();
      const bodyHtml = rawContent.slice(logMatch[0].length);

      if (logType === 'AUTHORNOTE') {
        let authorBox = textContainer.firstElementChild;
        let authorContent = authorBox && authorBox.classList.contains('authorNote')
          ? authorBox.querySelector('.authorNoteContent')
          : null;
        if (!authorBox || !authorContent || textContainer.childElementCount !== 1) {
          textContainer.textContent = '';
          authorBox = document.createElement('div');
          authorBox.className = 'authorNote';
          authorContent = document.createElement('p');
          authorContent.className = 'authorNoteContent';
          authorBox.appendChild(authorContent);
          textContainer.appendChild(authorBox);
        }
        authorContent.innerHTML = rewriteHtmlContent(bodyHtml);
        bindInternalLinks(authorContent);
      } else {
        let logBox = textContainer.firstElementChild;
        let logBtn = logBox && logBox.classList.contains('log') ? logBox.querySelector('.logButton') : null;
        let logContent = logBox && logBox.classList.contains('log') ? logBox.querySelector('.logContent') : null;
        if (!logBox || !logBtn || !logContent || textContainer.childElementCount !== 1) {
          textContainer.textContent = '';
          logBox = document.createElement('div');
          logBox.className = 'log';

          logBtn = document.createElement('button');
          logBtn.className = 'logButton';

          logContent = document.createElement('div');
          logContent.className = 'logContent';

          logBtn.addEventListener('click', () => {
            const st = logBox._logState;
            if (!st) return;
            st.isHidden = !st.isHidden;
            logBtn.textContent = getLogButtonLabel(st.rawContent, st.isHidden);
            if (window.RRWRAnimations) {
              window.RRWRAnimations.animateCollapsible(logContent, !st.isHidden, {
                category: 'uiMicro',
                displayMode: 'block',
                durationMs: 185
              });
            } else {
              logContent.style.display = st.isHidden ? 'none' : 'block';
            }
          });

          logBox.appendChild(logBtn);
          logBox.appendChild(logContent);
          textContainer.appendChild(logBox);
        }

        const isHidden = !settings.openLogs;
        logBox._logState = { rawContent, isHidden };
        logBtn.textContent = getLogButtonLabel(rawContent, isHidden);
        logContent.style.display = isHidden ? 'none' : 'block';
        logContent.innerHTML = rewriteHtmlContent(bodyHtml);
        bindInternalLinks(logContent);
      }
    } else if (rawContent.trim() !== '') {
      let storyParagraph = textContainer.firstElementChild;
      if (!storyParagraph || !storyParagraph.classList.contains('storyParagraph') || textContainer.childElementCount !== 1) {
        textContainer.textContent = '';
        storyParagraph = document.createElement('p');
        storyParagraph.className = 'storyParagraph';
        textContainer.appendChild(storyParagraph);
      }
      storyParagraph.innerHTML = rewriteHtmlContent(rawContent);
      bindInternalLinks(storyParagraph);
    } else if (textContainer.childElementCount > 0 || textContainer.textContent !== '') {
      textContainer.textContent = '';
    }
  }

  function patchCommandSlot(commandContainer, nextList, renderGeneration) {
    if (!commandContainer) return;
    attachDelegatedInternalLinks(commandContainer);

    if (nextList.length === 0) {
      if (commandContainer.childElementCount > 0 || commandContainer.textContent !== '') {
        commandContainer.textContent = '';
      }
      return;
    }

    let nextArrow = commandContainer.firstElementChild;
    if (!nextArrow || !nextArrow.classList.contains('nextArrow') || commandContainer.childElementCount !== 1) {
      commandContainer.textContent = '';
      nextArrow = document.createElement('div');
      nextArrow.className = 'nextArrow';
      commandContainer.appendChild(nextArrow);
    }

    while (nextArrow.children.length > nextList.length) {
      nextArrow.removeChild(nextArrow.lastElementChild);
    }

    for (let i = 0; i < nextList.length; i++) {
      const nextId = nextList[i];
      let itemDiv = nextArrow.children[i];
      let link = itemDiv ? itemDiv.querySelector('a.nextArrowLink') : null;
      if (!itemDiv || !link) {
        itemDiv = document.createElement('div');
        const p = document.createElement('p');
        p.appendChild(document.createTextNode('> '));
        link = document.createElement('a');
        link.className = 'nextArrowLink';
        p.appendChild(link);
        itemDiv.appendChild(p);
        nextArrow.appendChild(itemDiv);
      }

      let initialTitle = '==>';
      if (state.pageCache && state.pageCache.has(nextId)) {
        const cachedNext = state.pageCache.get(nextId);
        const hookedNext = (root.RRWRModHooks && typeof root.RRWRModHooks.applyEditPageHooks === 'function')
          ? root.RRWRModHooks.applyEditPageHooks(cachedNext)
          : cachedNext;
        initialTitle = (hookedNext && hookedNext.title) || cachedNext.title || '==>';
      }

      const targetHref = `/page/${nextId}`;
      if (link.getAttribute('href') !== targetHref) {
        link.setAttribute('href', targetHref);
      }
      if (link.getAttribute('data-page-id') !== nextId) {
        link.setAttribute('data-page-id', nextId);
      }
      if (link.textContent !== initialTitle) {
        link.textContent = initialTitle;
      }

      if (!state.pageCache || !state.pageCache.has(nextId)) {
        const targetLink = link;
        ipcInvoke('get_story_page', { page_id: nextId }).then((rawNextPage) => {
          if (renderGeneration !== storyRenderGeneration) return;
          if (rawNextPage) {
            if (state.pageCache) state.pageCache.set(nextId, rawNextPage);
            const nextPage = (root.RRWRModHooks && typeof root.RRWRModHooks.applyEditPageHooks === 'function')
              ? root.RRWRModHooks.applyEditPageHooks(rawNextPage)
              : rawNextPage;
            if (nextPage && nextPage.title && targetLink.isConnected && targetLink.getAttribute('data-page-id') === nextId) {
              targetLink.textContent = nextPage.title;
            }
          }
        }).catch(() => {});
      }
    }
  }

  function patchFooterNavSlot(footerNav, pageId, _storyMeta, page) {
    if (!footerNav) return;
    const refs = footerNav._navRefs || buildFooterNavShell(footerNav);

    const firstPageId = (state.appInfo && state.appInfo.first_page_id)
      ? String(state.appInfo.first_page_id)
      : null;
    if (firstPageId && pageId !== firstPageId) {
      const startHref = `/page/${encodeURIComponent(firstPageId)}`;
      if (refs.startOverLink.getAttribute('href') !== startHref) {
        refs.startOverLink.setAttribute('href', startHref);
      }
      refs.liStart.style.display = '';
    } else if (page.previous) {
      const startHref = '/';
      if (refs.startOverLink.getAttribute('href') !== startHref) {
        refs.startOverLink.setAttribute('href', startHref);
      }
      refs.liStart.style.display = '';
    } else {
      refs.liStart.style.display = 'none';
    }

    if (page.previous) {
      const backHref = `/page/${page.previous}`;
      if (refs.backLink.getAttribute('href') !== backHref) {
        refs.backLink.setAttribute('href', backHref);
      }
      refs.liBack.style.display = '';
    } else {
      refs.liBack.style.display = 'none';
    }

    if (page.timestamp) {
      const tsStr = String(page.timestamp);
      if (refs.timeDiv.getAttribute('data-timestamp') !== tsStr) {
        refs.timeDiv.setAttribute('data-timestamp', tsStr);
        refs.timeDiv.textContent = formatTimestamp(page.timestamp);
      }
      refs.liTime.style.display = '';
    } else {
      refs.liTime.style.display = 'none';
    }

    const sourceHref = `/page/${pageId}`;
    const sourceText = `/page/${pageId}`;
    if (refs.sourceLink.getAttribute('href') !== sourceHref) {
      refs.sourceLink.setAttribute('href', sourceHref);
    }
    if (refs.sourceLink.textContent !== sourceText) {
      refs.sourceLink.textContent = sourceText;
    }
  }

  function patchFootnotesSlot(el, notes) {
    if (!el) return;
    if (notes && notes.length > 0) {
      el.innerHTML = notes.map((note) => {
        const contentHtml = rewriteHtmlContent(String(note.content || note.text || ''));
        const authorText = note.author ? escapeHtml(String(note.author)) : '';
        const extraClass = note.class ? ' ' + escapeHtml(String(note.class)) : '';
        return `
          <div class="modFootnoteItem footnote${extraClass}">
            <div class="modFootnoteContent">${contentHtml}</div>
            ${authorText ? `<div class="modFootnoteAuthor">— ${authorText}</div>` : ''}
          </div>
        `;
      }).join('');
      el.style.display = 'block';
      bindInternalLinks(el);
    } else {
      if (el.childElementCount > 0 || el.textContent !== '') {
        el.textContent = '';
      }
      if (el.style.display !== 'none') {
        el.style.display = 'none';
      }
    }
  }

  async function renderStoryPage(pageId) {
    const renderGeneration = ++storyRenderGeneration;
    const pageContent = document.getElementById('page-content');
    if (!pageContent) return;

    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      pageContainer.classList.remove('homepage');
    }

    const { shell, wasMounted } = ensureStoryShell(pageContent);
    const {
      prefaceNotesEl,
      titleEl,
      mediaContainer,
      textContainer,
      commandContainer,
      footerNav,
      footerNotesEl
    } = shell;

    const isCached = Boolean(state.pageCache && state.pageCache.has(pageId));
    if (!isCached && wasMounted) {
      // Stop any playing audio/Flash immediately before async IPC fetch, while keeping text/shell steady.
      if (root.RRWRMediaEngine && typeof root.RRWRMediaEngine.cleanupActiveMedia === 'function') {
        root.RRWRMediaEngine.cleanupActiveMedia();
      }
    }

    try {
      const rawPage = isCached
        ? state.pageCache.get(pageId)
        : await ipcInvoke('get_story_page', { page_id: pageId });
      if (renderGeneration !== storyRenderGeneration) return;
      if (state.pageCache) state.pageCache.set(pageId, rawPage);

      const page = (root.RRWRModHooks && typeof root.RRWRModHooks.applyEditPageHooks === 'function')
        ? root.RRWRModHooks.applyEditPageHooks(rawPage)
        : Object.assign({}, rawPage);
      if (!page.pageId) page.pageId = page.page_id || pageId;
      state.currentPageData = page;

      const canonicalPid = page.pageId || page.page_id || pageId;
      if (pageContent.getAttribute('data-pageid') !== canonicalPid) {
        pageContent.setAttribute('data-pageid', canonicalPid);
      }

      // Update tab title, document title, and TitleBar text
      const pageTitle = page.title || `Page ${canonicalPid}`;
      const fullTitle = `${pageTitle} - RRWR`;

      const activeTab = getActiveTab();
      if (activeTab && activeTab.title !== fullTitle) {
        activeTab.title = fullTitle;
        renderTabBar();
      }
      if (document.title !== fullTitle) {
        document.title = fullTitle;
      }
      const titleBarTextEl = document.getElementById('titleBarText');
      if (titleBarTextEl && titleBarTextEl.textContent !== fullTitle) {
        titleBarTextEl.textContent = fullTitle;
      }

      // Apply theme
      const theme = computeActiveTheme(page.theme, state.config.settings);
      applyTheme(theme);

      // Story Page Number
      const num = parseInt(pageId, 10);

      // Apply story page frame flags (widePage, wideMedia, hscroll)
      const pageFrame = document.getElementById('page-frame');
      if (pageFrame) {
        const isWidePage = Boolean(page.flag && page.flag.includes('S'));
        const isHscroll = Boolean(page.flag && page.flag.includes('HSCROLL'));
        const isWideTheme = page.theme === 'wide' || page.theme === 'finale';
        pageFrame.classList.toggle('widePageFrame', isWidePage);
        pageFrame.classList.toggle('hscrollFrame', isHscroll);
        pageFrame.classList.toggle('wideMediaFrame', isWidePage || isWideTheme);
      }

      // Top Story Banner (if provided on page)
      const bannerContainer = document.getElementById('page-banner-container');
      const bannerSrc = page.banner ? resolveAssetUrl(page.banner) : null;
      patchBannerSlot(bannerContainer, bannerSrc);

      // Auto-save reading progress
      updateReadingProgress(pageId);

      // Discord RPC Reading Notification
      if (state.config.settings.enableDiscordRpc) {
        ipcInvoke('set_discord_presence', {
          mode: 'reading',
          page_id: pageId,
          page_title: pageTitle
        }).catch(() => {});
      }

      // Title
      if (titleEl) {
        if (titleEl.textContent !== pageTitle) {
          titleEl.textContent = pageTitle;
        }
        const expectedTitleDisplay = (page.flag && page.flag.includes('S')) ? 'none' : 'block';
        if (titleEl.style.display !== expectedTitleDisplay) {
          titleEl.style.display = expectedTitleDisplay;
        }
      }

      // Media Rendering (RRWRMediaEngine or fallback)
      if (mediaContainer) {
        cleanupMediaSlot(mediaContainer);

        let mediaList = Array.isArray(page.media) ? [...page.media] : [];
        autoSaveStoryPage(pageId, fullTitle, page, mediaList);

        // Delegate to RRWRMediaEngine if available
        let engineHandled = false;
        if (root.RRWRMediaEngine && typeof root.RRWRMediaEngine.renderMedia === 'function') {
          try {
            engineHandled = root.RRWRMediaEngine.renderMedia(
              mediaContainer,
              mediaList,
              page,
              {
                settings,
                assetBase: state.assetBase,
                cacheBuster: state.overlayGeneration,
                navigate: pushUrl,
                flashStorage: ensureSaveData().flashStorage,
                flashRestore: state.flashSaveRestore
              },
              resolveAssetUrl
            );
          } catch (e) {
            console.warn('[RRWR-MediaEngine] renderMedia threw:', e);
          }
        }
        state.flashSaveRestore = null;

        if (!engineHandled) {
          for (const item of mediaList) {
            const url = resolveAssetUrl(item);
            const lower = item.toLowerCase();

            if (lower.endsWith('.gif') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
              const img = document.createElement('img');
              img.className = 'panel-media';
              img.src = url;
              img.alt = pageTitle;
              mediaContainer.appendChild(img);
            } else if (lower.endsWith('.mp4') || lower.endsWith('.webm')) {
              const video = document.createElement('video');
              video.className = 'panel-media';
              video.controls = true;
              video.autoplay = true;
              video.src = url;
              mediaContainer.appendChild(video);
            } else if (lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.wav')) {
              const audio = document.createElement('audio');
              audio.controls = true;
              audio.src = url;
              mediaContainer.appendChild(audio);
            } else if (lower.endsWith('.swf')) {
              const flashProps = (root.RRWRFlashProps && root.RRWRFlashProps.INDEXED_FLASH_PROPS && root.RRWRFlashProps.INDEXED_FLASH_PROPS[pageId]) || {};
              const width = flashProps.width || 650;
              const height = flashProps.height || 450;

              const swfBox = document.createElement('div');
              swfBox.className = 'swf-embed-container';
              swfBox.style.width = width + 'px';
              swfBox.style.height = height + 'px';
              swfBox.style.margin = '0 auto';

              if (root.RRWRMediaEngine && typeof root.RRWRMediaEngine.buildRuffleSrcdoc === 'function') {
                const iframe = document.createElement('iframe');
                iframe.className = 'page-media-flash ruffle-frame';
                iframe.setAttribute('data-media-type', 'ruffle-flash');
                iframe.setAttribute('data-swf-src', url);
                iframe.setAttribute('allow', 'autoplay; fullscreen');
                iframe.setAttribute('tabindex', '0');
                iframe.style.width = width + 'px';
                iframe.style.height = height + 'px';
                iframe.style.border = 'none';
                iframe.style.overflow = 'hidden';
                iframe.style.display = 'block';
                iframe.style.margin = '0 auto';
                iframe.srcdoc = root.RRWRMediaEngine.buildRuffleSrcdoc({
                  swfUrl: url,
                  width: width,
                  height: height,
                  assetBase: state.assetBase,
                  gameKey: pageId
                });
                swfBox.appendChild(iframe);
              } else if (window.RufflePlayer && typeof window.RufflePlayer.newest === 'function') {
                const ruffle = window.RufflePlayer.newest();
                const player = ruffle.createPlayer();
                swfBox.appendChild(player);
                player.load({ url: url });
              } else {
                const obj = document.createElement('object');
                obj.setAttribute('data', url);
                obj.setAttribute('type', 'application/x-shockwave-flash');
                obj.setAttribute('width', String(width));
                obj.setAttribute('height', String(height));
                swfBox.appendChild(obj);
              }
              mediaContainer.appendChild(swfBox);
            } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
              const iframe = document.createElement('iframe');
              iframe.src = url;
              iframe.className = 'panel-iframe';
              iframe.width = '650';
              iframe.height = '450';
              iframe.frameBorder = '0';
              mediaContainer.appendChild(iframe);
            }
          }
        }
      }

      // Text Content Rendering (Chatlogs, Author Notes, Paragraphs)
      patchTextSlot(textContainer, page.content || '', state.config.settings);

      // Next Command Links
      let nextList = Array.isArray(page.next) ? [...page.next] : [];
      patchCommandSlot(commandContainer, nextList, renderGeneration);

      // Render Mod Footnotes (Preface above title & Standard below footer)
      const combinedNotes = [];
      if (state.modFootnotes && Array.isArray(state.modFootnotes[canonicalPid])) {
        combinedNotes.push(...state.modFootnotes[canonicalPid]);
      } else if (state.modFootnotes && canonicalPid !== pageId && Array.isArray(state.modFootnotes[pageId])) {
        combinedNotes.push(...state.modFootnotes[pageId]);
      }
      if (Array.isArray(page.footnotes)) {
        for (const fnItem of page.footnotes) {
          if (fnItem && !combinedNotes.some((n) => n.content === fnItem.content && n.author === fnItem.author)) {
            combinedNotes.push(fnItem);
          }
        }
      }

      const prefaceNotes = combinedNotes.filter((n) => Boolean(n && n.preface));
      const footerNotes = combinedNotes.filter((n) => Boolean(n && !n.preface));
      patchFootnotesSlot(prefaceNotesEl, prefaceNotes);
      patchFootnotesSlot(footerNotesEl, footerNotes);

      // Footer Navigation (Authentic Legacy Structure)
      patchFooterNavSlot(footerNav, pageId, null, page);

      // Execute active vueHooks matching "page"
      if (root.RRWRModHooks && root.RRWRModHooks.ModRuntime && pageContent) {
        const runtimeHooks = root.RRWRModHooks.ModRuntime.getState().vueHooks || [];
        for (let i = 0; i < runtimeHooks.length; i++) {
          const vh = runtimeHooks[i];
          if (vh && vh.matchName === 'page') {
            const lifecycleFn = vh.updated || vh.mounted;
            if (typeof lifecycleFn === 'function') {
              try {
                const elProxy = {
                  querySelectorAll(sel) {
                    const nodeList = pageContent.querySelectorAll(sel);
                    return Array.from(nodeList).map((el) => new Proxy(el, {
                      get(target, prop) {
                        if (prop === 'src' && typeof target.src === 'string') {
                          return target.src.replace(/[?&]v=\d+$/, '');
                        }
                        const val = target[prop];
                        return typeof val === 'function' ? val.bind(target) : val;
                      },
                      set(target, prop, value) {
                        target[prop] = value;
                        return true;
                      }
                    }));
                  },
                  querySelector(sel) {
                    return pageContent.querySelector(sel);
                  }
                };
                lifecycleFn.call({ $el: elProxy, pageId: canonicalPid, page });
              } catch (hookErr) {
                console.warn('[RRWR-Page] vueHook page.updated notice:', hookErr);
              }
            }
          }
        }
      }

    } catch (err) {
      console.error('[RRWR-Page] Failed to render story page:', err);
      cleanupMediaSlot(mediaContainer);
      if (titleEl) {
        titleEl.textContent = 'Page Not Found';
        titleEl.style.display = 'block';
      }
      if (textContainer) {
        textContainer.innerHTML = `<p class="storyParagraph" style="color: #ff3333;">Could not load page ${pageId}: ${err.message}</p>`;
      }
      if (commandContainer) commandContainer.textContent = '';
      if (prefaceNotesEl) {
        prefaceNotesEl.textContent = '';
        prefaceNotesEl.style.display = 'none';
      }
      if (footerNotesEl) {
        footerNotesEl.textContent = '';
        footerNotesEl.style.display = 'none';
      }
    }
  }

  function bindInternalLinks(container) {
    if (!container) return;
    const links = container.querySelectorAll('a[href]');
    for (const link of links) {
      if (link.dataset.rrwrBound) continue;
      const href = link.getAttribute('href');
      if (isInternalHref(href)) {
        link.dataset.rrwrBound = 'true';
        link.addEventListener('click', (e) => {
          const currentHref = link.getAttribute('href');
          if (!isInternalHref(currentHref)) return;
          e.preventDefault();
          pushUrl(currentHref);
        });
      }
    }
  }

  /* ==========================================================================
     7. Music Player, Discography & Sound Test (F11)
     ========================================================================== */

  async function ensureMusicDataLoaded() {
    if (state.musicData) return state.musicData;
    try {
      const data = await ipcInvoke('get_music_data');
      state.musicData = data;
      return data;
    } catch (err) {
      console.error('[RRWR-Music] Failed to load music data:', err);
      return { albums: {}, tracks: {}, artists: {}, flashes: {} };
    }
  }

  function formatDuration(sec) {
    if (typeof sec !== 'number' || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function renderMusicNavHeader(activeView = 'discography') {
    return `
      <div class="musicHeaderNav">
        <div class="musicNavLinks">
          <a href="/music" class="${activeView === 'discography' ? 'activeMusicNavLink' : ''}">Albums</a> |
          <a href="/music/tracks" class="${activeView === 'tracks' ? 'activeMusicNavLink' : ''}">Tracks</a> |
          <a href="/music/artists" class="${activeView === 'artists' ? 'activeMusicNavLink' : ''}">Artists</a> |
          <a href="/music/features" class="${activeView === 'features' ? 'activeMusicNavLink' : ''}">Features</a> |
          <a href="#random" id="music-random-track-btn">Random Track</a>
        </div>
        <input id="music-filter-input" class="musicSearchInput" type="text" placeholder="Filter albums or tracks..." aria-label="Music Search" />
      </div>
    `;
  }

  async function renderMusicDiscographyView(container) {
    const data = await ensureMusicDataLoaded();
    const albums = data.albums || {};
    const albumKeys = Object.keys(albums);

    container.innerHTML = `
      <div class="musicContainer">
        ${renderMusicNavHeader('discography')}
        <h2 style="font-family: 'Courier Prime', 'Courier New', monospace; text-align: left; margin-bottom: 12px;">DISCOGRAPHY (${albumKeys.length} ALBUMS)</h2>
        <div id="album-grid" class="albumGrid">
          ${albumKeys.map((slug) => {
            const alb = albums[slug];
            const coverUrl = resolveAssetUrl(`/archive/music/${alb.directory}/cover.jpg`);
            return `
              <div class="albumCard" data-slug="${slug}">
                <a href="/music/album/${slug}">
                  <img class="albumCover" src="${coverUrl}" alt="${alb.name}" loading="lazy" />
                </a>
                <div class="albumCardTitle">
                  <a href="/music/album/${slug}">${alb.name}</a>
                </div>
                <div class="albumCardDate">${alb.date || ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    bindInternalLinks(container);

    // Search filter
    const filterInput = container.querySelector('#music-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const cards = container.querySelectorAll('.albumCard');
        cards.forEach((card) => {
          const title = (card.querySelector('.albumCardTitle')?.textContent || '').toLowerCase();
          card.style.display = title.includes(query) ? 'flex' : 'none';
        });
      });
    }

    // Random track button
    const randomBtn = container.querySelector('#music-random-track-btn');
    if (randomBtn) {
      randomBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const trackKeys = Object.keys(data.tracks || {});
        if (trackKeys.length > 0) {
          const randKey = trackKeys[Math.floor(Math.random() * trackKeys.length)];
          pushUrl(`/music/track/${randKey}`);
        }
      });
    }
  }

  async function renderMusicTracksView(container) {
    const data = await ensureMusicDataLoaded();
    const tracks = data.tracks || {};
    const trackKeys = Object.keys(tracks);

    container.innerHTML = `
      <div class="musicContainer">
        ${renderMusicNavHeader('tracks')}
        <h2 style="font-family: 'Courier Prime', 'Courier New', monospace; text-align: left; margin-bottom: 12px;">ALL TRACKS (${trackKeys.length})</h2>
        <table class="musicTrackTable">
          <thead>
            <tr>
              <th style="width: 40px;">Play</th>
              <th>Track Title</th>
              <th>Album</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody id="track-rows">
            ${trackKeys.map((slug, idx) => {
              const trk = tracks[slug];
              return `
                <tr class="trackRow" data-slug="${slug}">
                  <td>
                    <button class="playTrackBtn" data-slug="${slug}" title="Play in Sound Test">&#9654;</button>
                  </td>
                  <td>
                    <a href="/music/track/${slug}"><strong>${trk.name}</strong></a>
                  </td>
                  <td>${trk.album || ''}</td>
                  <td>${formatDuration(trk.duration)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindInternalLinks(container);

    // Wire up Play buttons
    const playBtns = container.querySelectorAll('.playTrackBtn');
    playBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        loadTrackIntoSoundTest(slug, true);
      });
    });

    // Search filter
    const filterInput = container.querySelector('#music-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const rows = container.querySelectorAll('.trackRow');
        rows.forEach((row) => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }
  }

  async function renderAlbumDetailView(container, albumSlug) {
    const data = await ensureMusicDataLoaded();
    const album = data.albums ? data.albums[albumSlug] : null;

    if (!album) {
      container.innerHTML = `
        <div class="musicContainer">
          ${renderMusicNavHeader('discography')}
          <p class="storyParagraph" style="color: #ff3333;">Album '${albumSlug}' not found in collection.</p>
        </div>
      `;
      return;
    }

    const coverUrl = resolveAssetUrl(`/archive/music/${album.directory}/cover.jpg`);
    let trackList = [];
    if (Array.isArray(album.tracks)) {
      trackList = album.tracks.flat();
    }

    container.innerHTML = `
      <div class="musicContainer">
        ${renderMusicNavHeader('discography')}
        <div class="musicDetailLayout" style="display: flex; gap: 20px; flex-wrap: wrap;">
          <div style="width: 220px; text-align: center;">
            <img class="albumCover" src="${coverUrl}" alt="${album.name}" style="width: 200px; height: 200px; border-radius: 4px;" />
            <div style="font-size: 11px; margin-top: 8px;">
              <strong>Released:</strong> ${album.date || 'Unknown'}<br />
              ${album.urls && album.urls.bandcamp ? `<a href="${album.urls.bandcamp}" target="_blank">Bandcamp Page</a>` : ''}
            </div>
          </div>
          <div style="flex: 1; min-width: 300px;">
            <h2 style="font-family: 'Courier Prime', 'Courier New', monospace; margin-top: 0;">${album.name}</h2>
            <table class="musicTrackTable" style="margin-top: 12px;">
              <thead>
                <tr>
                  <th style="width: 40px;">Play</th>
                  <th style="width: 30px;">#</th>
                  <th>Title</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                ${trackList.map((slug, idx) => {
                  const trk = data.tracks ? data.tracks[slug] : null;
                  const title = trk ? trk.name : slug;
                  const dur = trk ? formatDuration(trk.duration) : '';
                  return `
                    <tr>
                      <td>
                        <button class="playTrackBtn" data-slug="${slug}" title="Play">&#9654;</button>
                      </td>
                      <td>${idx + 1}</td>
                      <td><a href="/music/track/${slug}"><strong>${title}</strong></a></td>
                      <td>${dur}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            ${album.commentary ? `
              <div class="settingsSectionCard" style="margin-top: 18px;">
                <h3>Album Commentary</h3>
                <div style="font-size: 12px; line-height: 1.4;">${album.commentary}</div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    bindInternalLinks(container);

    const playBtns = container.querySelectorAll('.playTrackBtn');
    playBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        loadTrackIntoSoundTest(slug, true);
      });
    });
  }

  async function renderTrackDetailView(container, trackSlug) {
    const data = await ensureMusicDataLoaded();
    const track = data.tracks ? data.tracks[trackSlug] : null;

    if (!track) {
      container.innerHTML = `
        <div class="musicContainer">
          ${renderMusicNavHeader('tracks')}
          <p class="storyParagraph" style="color: #ff3333;">Track '${trackSlug}' not found.</p>
        </div>
      `;
      return;
    }

    const albumKey = Array.isArray(track.album) ? track.album[0] : track.album;
    const album = data.albums ? data.albums[albumKey] : null;
    const coverDir = album ? album.directory : albumKey;
    const coverUrl = resolveAssetUrl(`/archive/music/${coverDir}/cover.jpg`);
    const formattedArtists = Array.isArray(track.artists)
      ? track.artists.map((a) => {
          if (typeof a === 'string') return a;
          if (!a || typeof a !== 'object') return '';
          const who = String(a.who || a.name || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          return a.what ? `${who} (${a.what})` : who;
        }).filter(Boolean).join(', ')
      : String(track.artists || '');

    container.innerHTML = `
      <div class="musicContainer">
        ${renderMusicNavHeader('tracks')}
        <div class="musicDetailLayout musicTrackDetailLayout">
          <div class="musicTrackCoverCol">
            <img class="albumCover" src="${coverUrl}" alt="${track.name}" style="width: 200px; height: 200px; border-radius: 4px;" />
            <div style="font-size: 11px; margin-top: 8px;">
              <strong>Album:</strong> <a href="/music/album/${albumKey}">${album ? album.name : albumKey}</a><br />
              <strong>Duration:</strong> ${formatDuration(track.duration)}
            </div>
          </div>
          <div class="musicTrackInfoCol">
            <h2 style="font-family: 'Courier Prime', 'Courier New', monospace; margin-top: 0; text-align: center;">${track.name}</h2>
            <div class="soundTestPlayerBox">
              <h4 style="margin: 0 0 8px 0;">Sound Test Audio Player</h4>
              <button id="direct-play-btn" class="playTrackBtn" style="padding: 6px 14px; font-size: 13px;">&#9654; Play Track</button>
            </div>
            ${formattedArtists ? `
              <div style="margin: 10px 0; font-size: 12px; text-align: center;">
                <strong>Artists:</strong> ${formattedArtists}
              </div>
            ` : ''}
            ${track.featured && track.featured.length > 0 ? `
              <div style="margin: 10px 0; font-size: 12px; text-align: center;">
                <strong>Featured in:</strong>
                ${track.featured.map((pid) => `<a href="/page/${pid}">Page ${pid}</a>`).join(', ')}
              </div>
            ` : ''}
            ${Array.isArray(track.urls) && track.urls.length > 0 ? `
              <div style="margin: 10px 0; font-size: 12px; text-align: center;">
                <strong>External Links:</strong>
                ${track.urls.map((u, idx) => `<a href="${u}" target="_blank" rel="noopener noreferrer">Link ${idx + 1}</a>`).join(' | ')}
              </div>
            ` : ''}
            ${track.commentary ? `
              <div class="settingsSectionCard" style="margin-top: 14px; text-align: left;">
                <h3>Track Commentary</h3>
                <div style="font-size: 12px; line-height: 1.4;">${track.commentary}</div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    bindInternalLinks(container);

    const directBtn = container.querySelector('#direct-play-btn');
    if (directBtn) {
      directBtn.addEventListener('click', () => {
        loadTrackIntoSoundTest(trackSlug, true);
      });
    }
  }

  async function loadTrackIntoSoundTest(trackSlug, autoplay = true) {
    const data = await ensureMusicDataLoaded();
    const track = data.tracks ? data.tracks[trackSlug] : null;
    if (!track) return;

    const albumKey = Array.isArray(track.album) ? track.album[0] : track.album;
    const album = data.albums ? data.albums[albumKey] : null;
    const albumDir = album ? album.directory : albumKey;

    // Track audio resolution
    const candidatePath = `/archive/music/${albumDir}/${track.directory || trackSlug}.mp3`;

    const audioUrl = resolveAssetUrl(candidatePath);
    const bar = document.getElementById('sound-test-bar');
    const titleEl = document.getElementById('sound-test-title');
    const metaEl = document.getElementById('sound-test-meta');
    const audioEl = document.getElementById('sound-test-audio');
    const seekEl = document.getElementById('sound-test-seek');
    const curTimeEl = document.getElementById('sound-test-current-time');
    const durTimeEl = document.getElementById('sound-test-duration');

    if (titleEl) titleEl.textContent = track.name;
    if (metaEl) metaEl.textContent = `${album ? album.name : ''} — ${formatDuration(track.duration)}`;
    if (seekEl) {
      seekEl.value = '0';
      seekEl.max = String(Number(track.duration) > 0 ? Number(track.duration) : 100);
    }
    if (curTimeEl) curTimeEl.textContent = '0:00';
    if (durTimeEl) durTimeEl.textContent = formatDuration(track.duration || 0);

    if (audioEl) {
      const settings = (state.config && state.config.settings) || {};
      const vol = normalizeMasterVolume(settings.masterVolume ?? settings.master_volume ?? 1.0);
      const muted = Boolean(settings.masterMuted ?? settings.master_muted ?? false);
      audioEl.volume = muted ? 0 : vol;
      audioEl.muted = muted;
      audioEl.src = audioUrl;
      if (autoplay) {
        audioEl.play().catch((e) => console.debug('Sound test autoplay blocked:', e));
      }
    }

    if (bar) {
      if (window.RRWRAnimations) {
        window.RRWRAnimations.setSoundTestVisible(bar, true);
        window.RRWRAnimations.setSoundTestPlaying(bar, autoplay);
      } else {
        bar.classList.remove('hidden');
      }
    }

    state.soundTest.isPlaying = autoplay;
    state.soundTest.currentTrack = track;
    state.soundTest.currentAlbum = album;
    state.soundTest.currentCandidatePath = candidatePath;

    // Discord RPC Music presence
    if (state.config.settings.enableDiscordRpc) {
      ipcInvoke('set_discord_music_presence', {
        track: track.name,
        album: album ? album.name : '',
        duration: track.duration
      }).catch(() => {});
    }
  }

  function showAudioErrorOverlay(track, candidatePath) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('rrwr-error-splash');
    if (existing) existing.remove();

    const trackName = (track && track.name) ? track.name : 'Unknown Track';
    const pathText = candidatePath || '/archive/music/...';
    const urls = (track && Array.isArray(track.urls)) ? track.urls : [];

    const overlay = document.createElement('div');
    overlay.id = 'rrwr-error-splash';
    overlay.className = 'bootSplash errorSplash';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Audio playback error');

    overlay.innerHTML = `
      <div class="bootSplashBackdrop"></div>
      <div class="bootSplashCard">
        <div class="bootSplashTopRule">
          <span class="bootSplashTag">RRWR // AUDIO PLAYBACK ERROR</span>
          <span class="bootSplashTag">404 NOT FOUND</span>
        </div>
        <div class="bootSplashHero">
          <div class="bootSplashEmblemWrap" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="54" height="54">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#cc2222" stroke-width="3" />
              <line x1="32" y1="16" x2="32" y2="38" stroke="#cc2222" stroke-width="4" stroke-linecap="round" />
              <circle cx="32" cy="47" r="3" fill="#cc2222" />
            </svg>
          </div>
          <div class="bootSplashTitleGroup">
            <div class="bootSplashHeadline" style="font-size: 20px;">${escapeHtml(trackName)}</div>
            <div class="bootSplashTag">LOCAL AUDIO FILE NOT FOUND IN ASSET PACK</div>
          </div>
        </div>
        <div class="bootSplashErrorDetail">
          Could not load audio file:<br />
          <strong>${escapeHtml(pathText)}</strong><br /><br />
          Asset Pack V2 only includes album cover art and external links for album tracks, unless a music mod provides the .mp3 files locally.
        </div>
        <div class="bootSplashErrorActions">
          ${urls.map((u, idx) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="treeOpenBtn">External Link ${idx + 1}</a>`).join('')}
          <button type="button" id="rrwr-error-splash-close" class="primaryActionBtn">Close</button>
        </div>
        <div class="bootSplashStatus">&gt; HTTP 404: ${escapeHtml(pathText)}</div>
      </div>
    `;

    const dismiss = () => {
      overlay.classList.add('bootSplash--exit');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 190);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') dismiss();
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('bootSplashBackdrop')) {
        dismiss();
      }
    });

    const closeBtn = overlay.querySelector('#rrwr-error-splash-close');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
    if (closeBtn) closeBtn.focus();
  }

  function setupSoundTestBar() {
    if (typeof document === 'undefined') return;
    const bar = document.getElementById('sound-test-bar');
    const playBtn = document.getElementById('sound-test-play-btn');
    const stopBtn = document.getElementById('sound-test-stop-btn');
    const closeBtn = document.getElementById('sound-test-close-btn');
    const audioEl = document.getElementById('sound-test-audio');
    const seekEl = document.getElementById('sound-test-seek');
    const curTimeEl = document.getElementById('sound-test-current-time');
    const durTimeEl = document.getElementById('sound-test-duration');
    const muteBtn = document.getElementById('sound-test-mute-btn');
    const volumeSlider = document.getElementById('sound-test-volume');
    const muteIcon = document.getElementById('sound-test-mute-icon');
    const volPctEl = document.getElementById('sound-test-volume-pct');

    if (playBtn && audioEl) {
      const settings = (state.config && state.config.settings) || {};
      const vol = normalizeMasterVolume(settings.masterVolume ?? settings.master_volume ?? 1.0);
      const muted = Boolean(settings.masterMuted ?? settings.master_muted ?? false);
      audioEl.volume = muted ? 0 : vol;
      audioEl.muted = muted;

      if (volumeSlider) volumeSlider.value = String(Math.round(vol * 100));
      if (volPctEl) volPctEl.textContent = muted ? 'MUTED' : `${Math.round(vol * 100)}%`;
      if (muteIcon) updateVolumeSvgIcon(muteIcon, vol, muted);

      playBtn.addEventListener('click', () => {
        if (audioEl.paused) {
          audioEl.play().catch(() => {});
          playBtn.innerHTML = '&#10074;&#10074;';
        } else {
          audioEl.pause();
          playBtn.innerHTML = '&#9654;';
        }
      });

      audioEl.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
          if (seekEl) seekEl.max = String(audioEl.duration);
          if (durTimeEl) durTimeEl.textContent = formatDuration(Math.floor(audioEl.duration));
        }
      });

      audioEl.addEventListener('timeupdate', () => {
        if (seekEl && !seekEl.matches(':active')) {
          seekEl.value = String(audioEl.currentTime || 0);
        }
        if (curTimeEl) curTimeEl.textContent = formatDuration(Math.floor(audioEl.currentTime || 0));
      });

      if (seekEl) {
        seekEl.addEventListener('input', () => {
          const target = Number(seekEl.value);
          if (Number.isFinite(target) && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
            audioEl.currentTime = target;
            if (curTimeEl) curTimeEl.textContent = formatDuration(Math.floor(target));
          }
        });
      }

      audioEl.addEventListener('play', () => {
        playBtn.innerHTML = '&#10074;&#10074;';
        if (window.RRWRAnimations && bar) {
          window.RRWRAnimations.setSoundTestPlaying(bar, true);
        }
      });
      audioEl.addEventListener('pause', () => {
        playBtn.innerHTML = '&#9654;';
        if (window.RRWRAnimations && bar) {
          window.RRWRAnimations.setSoundTestPlaying(bar, false);
        }
      });
      audioEl.addEventListener('ended', () => {
        playBtn.innerHTML = '&#9654;';
        if (seekEl) seekEl.value = '0';
        if (curTimeEl) curTimeEl.textContent = '0:00';
        if (window.RRWRAnimations && bar) {
          window.RRWRAnimations.setSoundTestPlaying(bar, false);
        }
      });
      audioEl.addEventListener('error', () => {
        playBtn.innerHTML = '&#9654;';
        state.soundTest.isPlaying = false;
        if (window.RRWRAnimations && bar) {
          window.RRWRAnimations.setSoundTestPlaying(bar, false);
        }
        const metaEl = document.getElementById('sound-test-meta');
        if (metaEl && audioEl.src) {
          metaEl.textContent = 'Local audio file not included in Asset Pack (404)';
        }
        showAudioErrorOverlay(state.soundTest.currentTrack, state.soundTest.currentCandidatePath);
      });
    }

    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        const nextVol = normalizeMasterVolume(Number(volumeSlider.value) / 100);
        applyMasterVolume(nextVol, false, { persist: false });
      });
      volumeSlider.addEventListener('change', () => {
        const nextVol = normalizeMasterVolume(Number(volumeSlider.value) / 100);
        applyMasterVolume(nextVol, false, { persist: true, immediate: true });
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const s = (state.config && state.config.settings) || {};
        const curVol = normalizeMasterVolume(s.masterVolume ?? s.master_volume ?? 1.0);
        const curMuted = Boolean(s.masterMuted ?? s.master_muted ?? false);
        if (curMuted) {
          const restored = curVol <= 0 ? 0.5 : curVol;
          applyMasterVolume(restored, false, { persist: true, immediate: true });
        } else {
          applyMasterVolume(curVol, true, { persist: true, immediate: true });
        }
      });
    }

    if (stopBtn && audioEl) {
      stopBtn.addEventListener('click', () => {
        audioEl.pause();
        audioEl.currentTime = 0;
        if (window.RRWRAnimations && bar) {
          window.RRWRAnimations.setSoundTestPlaying(bar, false);
        }
      });
    }

    if (closeBtn && bar && audioEl) {
      closeBtn.addEventListener('click', () => {
        audioEl.pause();
        if (window.RRWRAnimations) {
          window.RRWRAnimations.setSoundTestPlaying(bar, false);
          window.RRWRAnimations.setSoundTestVisible(bar, false);
        } else {
          bar.classList.add('hidden');
        }
      });
    }
  }

  function normalizeMasterVolume(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 1.0;
    return Math.max(0, Math.min(1, n));
  }

  function updateVolumeSvgIcon(svgEl, vol, muted) {
    if (!svgEl) return;
    const isMuted = Boolean(muted) || vol <= 0;
    const waveLow = svgEl.querySelector('.vol-wave-low');
    const waveHigh = svgEl.querySelector('.vol-wave-high');
    const muteXs = svgEl.querySelectorAll('.vol-mute-x');

    if (waveLow) waveLow.classList.toggle('hidden', isMuted);
    if (waveHigh) waveHigh.classList.toggle('hidden', isMuted || vol <= 0.5);
    muteXs.forEach((el) => el.classList.toggle('hidden', !isMuted));
  }

  function applyMasterVolume(volume, muted, { persist = false, immediate = false } = {}) {
    if (!state.config) state.config = {};
    if (!state.config.settings) state.config.settings = {};
    const settings = state.config.settings;

    const clamped = normalizeMasterVolume(volume !== undefined ? volume : (settings.masterVolume ?? settings.master_volume ?? 1.0));
    const isMuted = muted !== undefined ? Boolean(muted) : Boolean(settings.masterMuted ?? settings.master_muted ?? false);

    settings.masterVolume = clamped;
    settings.masterMuted = isMuted;
    delete settings.master_volume;
    delete settings.master_muted;

    if (typeof window !== 'undefined' && window.RRWRMediaEngine && typeof window.RRWRMediaEngine.setMasterVolume === 'function') {
      window.RRWRMediaEngine.setMasterVolume(clamped, isMuted);
    }

    const soundTestAudio = typeof document !== 'undefined' ? document.getElementById('sound-test-audio') : null;
    if (soundTestAudio) {
      soundTestAudio.volume = isMuted ? 0 : clamped;
      soundTestAudio.muted = isMuted;
    }

    if (typeof document !== 'undefined') {
      const pct = Math.round(clamped * 100);
      const label = isMuted ? 'MUTED' : `${pct}%`;

      const navBtn = document.getElementById('nav-volume-btn');
      const navIcon = document.getElementById('nav-volume-icon');
      const muteBtn = document.getElementById('volume-mute-btn');
      const muteIcon = document.getElementById('volume-mute-icon');
      const popSlider = document.getElementById('volume-popover-slider');
      const popVal = document.getElementById('volume-popover-value');

      if (navBtn) {
        navBtn.classList.toggle('is-muted', isMuted || pct === 0);
        navBtn.title = `Master Output Volume (${label})`;
      }
      updateVolumeSvgIcon(navIcon, clamped, isMuted);
      updateVolumeSvgIcon(muteIcon, clamped, isMuted);

      if (muteBtn) {
        muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
      }
      if (popSlider && Number(popSlider.value) !== pct) {
        popSlider.value = String(pct);
      }
      if (popVal) {
        popVal.textContent = label;
      }

      const settingSlider = document.getElementById('setting-master-volume');
      const settingVal = document.getElementById('setting-master-volume-value');
      const settingMute = document.getElementById('setting-master-muted');
      if (settingSlider && Number(settingSlider.value) !== pct) {
        settingSlider.value = String(pct);
      }

      const barVolSlider = document.getElementById('sound-test-volume');
      const barMuteIcon = document.getElementById('sound-test-mute-icon');
      const barVolPct = document.getElementById('sound-test-volume-pct');
      if (barVolSlider && Number(barVolSlider.value) !== pct) {
        barVolSlider.value = String(pct);
      }
      updateVolumeSvgIcon(barMuteIcon, clamped, isMuted);
      if (barVolPct) {
        barVolPct.textContent = label;
      }
      if (settingVal) {
        settingVal.textContent = label;
      }
      if (settingMute) {
        settingMute.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
        settingMute.textContent = isMuted ? 'UNMUTE' : 'MUTE';
      }
    }

    if (persist) {
      persistConfig(immediate);
    }
  }

  let volumeWheelPersistTimer = null;

  function setupVolumeControls() {
    if (typeof document === 'undefined') return;
    const wrap = document.getElementById('volume-control-wrap');
    const navBtn = document.getElementById('nav-volume-btn');
    const popover = document.getElementById('volume-popover');
    const muteBtn = document.getElementById('volume-mute-btn');
    const slider = document.getElementById('volume-popover-slider');
    if (!wrap || !navBtn || !popover || wrap.__volumeBound) return;
    wrap.__volumeBound = true;

    const setPopoverOpen = (open) => {
      popover.classList.toggle('hidden', !open);
      navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    navBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains('hidden');
      setPopoverOpen(isHidden);
    });

    if (muteBtn) {
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const settings = (state.config && state.config.settings) || {};
        const curVol = normalizeMasterVolume(settings.masterVolume ?? 1.0);
        const nextMuted = !Boolean(settings.masterMuted);
        applyMasterVolume(curVol, nextMuted, { persist: true, immediate: true });
      });
    }

    if (slider) {
      slider.addEventListener('input', (e) => {
        const vol = normalizeMasterVolume(Number(e.target.value) / 100);
        const muted = vol === 0;
        applyMasterVolume(vol, muted, { persist: false });
      });
      slider.addEventListener('change', (e) => {
        const vol = normalizeMasterVolume(Number(e.target.value) / 100);
        const muted = vol === 0;
        applyMasterVolume(vol, muted, { persist: true, immediate: true });
      });
    }

    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const settings = (state.config && state.config.settings) || {};
      const curVol = normalizeMasterVolume(settings.masterVolume ?? 1.0);
      const step = e.shiftKey ? 0.01 : 0.02;
      const delta = e.deltaY < 0 ? step : -step;
      const nextVol = Math.round(normalizeMasterVolume(curVol + delta) * 100) / 100;
      const nextMuted = nextVol === 0 ? true : (delta > 0 ? false : Boolean(settings.masterMuted));
      applyMasterVolume(nextVol, nextMuted, { persist: false });
      clearTimeout(volumeWheelPersistTimer);
      volumeWheelPersistTimer = setTimeout(() => {
        persistConfig(false);
      }, 250);
    }, { passive: false });

    document.addEventListener('click', (e) => {
      if (!popover.classList.contains('hidden') && !wrap.contains(e.target)) {
        setPopoverOpen(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popover.classList.contains('hidden')) {
        setPopoverOpen(false);
        navBtn.focus();
      }
    });
  }

  /* ==========================================================================
     8. Settings, Mod Runtime Synchronization & Community Mod Toggles (F20 & F25)
     ========================================================================== */

  function rewriteModCssAssets(cssText) {
    if (!cssText || typeof cssText !== 'string') return '';
    const base = String(state.assetBase || '').replace(/\/+$/, '');
    // Strip SCSS single-line // comments (without touching :// inside URLs) and Vue scoped [data-v-...]
    let strippedComments = cssText
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      .replace(/\[data-v-[a-zA-Z0-9_-]*\]/g, '')
      .replace(/,\s*\)/g, ')');
    return strippedComments.replace(/assets:\/\/\/?/gi, `${base}/assets/`);
  }

  function injectActiveModStyles(stylesList, themesList) {
    if (typeof document === 'undefined' || !document.head) return;

    const existing = document.head.querySelectorAll('style[data-mod-style]');
    existing.forEach((el) => el.remove());

    const allStyles = [];
    if (Array.isArray(stylesList)) {
      for (let i = 0; i < stylesList.length; i++) {
        const s = stylesList[i];
        if (s && (s.body || s.css)) {
          allStyles.push({
            id: s.id || `style-mod-${i}`,
            css: rewriteModCssAssets(s.body || s.css)
          });
        }
      }
    }
    if (Array.isArray(themesList)) {
      for (let i = 0; i < themesList.length; i++) {
        const t = themesList[i];
        if (t && (t.body || t.css)) {
          const themeId = t.id || t.value || `theme-${t.modId || 'mod'}-${i}`;
          allStyles.push({
            id: themeId,
            css: rewriteModCssAssets(t.body || t.css)
          });
        }
      }
    }

    for (let i = 0; i < allStyles.length; i++) {
      const item = allStyles[i];
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-mod-style', String(item.id));
      styleEl.textContent = item.css;
      document.head.appendChild(styleEl);
    }
  }

  async function syncModRuntime(options = {}) {
    const shouldReRender = options.reRender !== false;
    try {
      const bundle = await ipcInvoke('get_mod_bundle').catch(() => null);
      if (bundle && root.RRWRModHooks && typeof root.RRWRModHooks.loadActiveMods === 'function') {
        const runtimeRes = await root.RRWRModHooks.loadActiveMods(bundle, ipcInvoke, state.assetBase);
        state.modStyles = Array.isArray(runtimeRes.styles) ? runtimeRes.styles : [];
        state.modThemes = Array.isArray(runtimeRes.themes) ? runtimeRes.themes : [];
        state.modSettingsDescriptors = runtimeRes.settings || {};
        state.modFootnotes = runtimeRes.footnotes || {};
        state.modFancomics = runtimeRes.fancomics || {};
        state.modBrowserPages = runtimeRes.browserPages || {};
        state.modHomeRowItems = Array.isArray(runtimeRes.modHomeRowItems) ? runtimeRes.modHomeRowItems : [];
        state.modSettings = Object.assign(
          {},
          (state.config && state.config.settings && state.config.settings.modSettings) || {},
          bundle.modSettings || bundle.mod_settings || {},
          runtimeRes.modSettings || {}
        );
        if (bundle.overlayGeneration !== undefined || bundle.overlay_generation !== undefined) {
          state.overlayGeneration = bundle.overlayGeneration ?? bundle.overlay_generation ?? state.overlayGeneration;
        }
      } else {
        state.modStyles = [];
        state.modThemes = [];
        state.modFootnotes = {};
        state.modFancomics = {};
        state.modBrowserPages = {};
        state.modHomeRowItems = [];
      }

      injectActiveModStyles(state.modStyles, state.modThemes);

      if (state.pageCache) {
        state.pageCache.clear();
      }

      const activeTheme = computeActiveTheme(
        state.currentPageData ? state.currentPageData.theme : null,
        state.config ? state.config.settings : null
      );
      applyTheme(activeTheme);

      if (shouldReRender) {
        const activeTab = getActiveTab();
        if (activeTab && activeTab.url) {
          await renderRoute(resolveRoute(activeTab.url), { preserveScroll: true });
        }
      }
    } catch (err) {
      console.warn('[RRWR-ModRuntime] syncModRuntime notice:', err);
    }
  }

  async function saveModSetting(modId, key, value) {
    if (!modId || !key) return;
    if (!state.modSettings) state.modSettings = {};
    if (!state.modSettings[modId]) state.modSettings[modId] = {};
    state.modSettings[modId][key] = value;

    if (state.config && state.config.settings) {
      if (!state.config.settings.modSettings) state.config.settings.modSettings = {};
      if (!state.config.settings.modSettings[modId]) state.config.settings.modSettings[modId] = {};
      state.config.settings.modSettings[modId][key] = value;
    }

    const activeTab = getActiveTab();
    if (window.RRWRAnimations && activeTab) {
      window.RRWRAnimations.captureScrollState(activeTab);
    }
    const modMeta = (state.availableMods || []).find((m) => m.id === modId);
    const modTitle = (modMeta && (modMeta.title || modMeta.name)) || modId;
    const loaderOverlay = window.RRWRAnimations
      ? await window.RRWRAnimations.beginModLoading(modTitle, true)
      : null;

    let ok = true;
    try {
      await ipcInvoke('save_mod_setting', {
        modId,
        mod_id: modId,
        key,
        value
      });
      await syncModRuntime({ reRender: true });
    } catch (err) {
      ok = false;
      console.warn('[RRWR-ModRuntime] save_mod_setting failed:', err);
    } finally {
      if (window.RRWRAnimations) {
        window.RRWRAnimations.endModLoading(loaderOverlay, ok, ok ? `${modTitle} settings updated` : `Failed updating ${modTitle}`);
      }
    }
  }

  function renderModSubSettingsHtml(mod) {
    const modId = mod.id;
    const desc = (state.modSettingsDescriptors && state.modSettingsDescriptors[modId]) || mod.settings;
    if (!desc || typeof desc !== 'object') return '';

    const boolList = Array.isArray(desc.boolean) ? desc.boolean : [];
    const radioList = Array.isArray(desc.radio) ? desc.radio : [];
    if (boolList.length === 0 && radioList.length === 0) return '';

    const currentModStore = (state.modSettings && state.modSettings[modId]) || {};

    const boolHtml = boolList.map((opt) => {
      if (!opt || !opt.model) return '';
      const rawVal = Object.prototype.hasOwnProperty.call(currentModStore, opt.model)
        ? currentModStore[opt.model]
        : opt.value;
      const checked = Boolean(rawVal);
      return `
        <div class="modSubSettingRow modBooleanRow">
          <label class="modSubSettingLabel">
            <input
              type="checkbox"
              class="modSettingBoolean"
              data-mod-id="${escapeHtml(modId)}"
              data-model="${escapeHtml(opt.model)}"
              ${checked ? 'checked' : ''}
            />
            <span>${escapeHtml(opt.label || opt.model)}</span>
          </label>
          ${opt.desc ? `<div class="modSubSettingDesc">${escapeHtml(opt.desc)}</div>` : ''}
        </div>
      `;
    }).join('');

    const radioHtml = radioList.map((group) => {
      if (!group || !group.model) return '';
      const currentVal = Object.prototype.hasOwnProperty.call(currentModStore, group.model)
        ? currentModStore[group.model]
        : group.value;
      const options = Array.isArray(group.options) ? group.options : [];
      return `
        <div class="modSubSettingRow modRadioGroup">
          <div class="modRadioHeader"><strong>${escapeHtml(group.label || group.model)}</strong></div>
          ${group.desc ? `<div class="modSubSettingDesc">${escapeHtml(group.desc)}</div>` : ''}
          <div class="modRadioOptions">
            ${options.map((opt) => {
              if (!opt) return '';
              const isObjVal = opt.value !== null && typeof opt.value === 'object';
              const serializedOptVal = isObjVal ? JSON.stringify(opt.value) : String(opt.value);
              const serializedCurVal = (currentVal !== null && typeof currentVal === 'object')
                ? JSON.stringify(currentVal)
                : String(currentVal);
              const isChecked = serializedCurVal === serializedOptVal;
              return `
                <label class="modRadioOptionLabel">
                  <input
                    type="radio"
                    class="modSettingRadio"
                    name="mod-radio-${escapeHtml(modId)}-${escapeHtml(group.model)}"
                    data-mod-id="${escapeHtml(modId)}"
                    data-model="${escapeHtml(group.model)}"
                    data-is-json="${isObjVal ? 'true' : 'false'}"
                    value="${escapeHtml(serializedOptVal)}"
                    ${isChecked ? 'checked' : ''}
                  />
                  <span>${escapeHtml(opt.label || serializedOptVal)}</span>
                  ${opt.desc ? `<small class="modRadioOptionDesc"> — ${escapeHtml(opt.desc)}</small>` : ''}
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="modSubSettings" data-mod-id="${escapeHtml(modId)}">
        ${boolHtml}
        ${radioHtml}
      </div>
    `;
  }

  const ANDROID_ASSET_PACK_PATHS = [
    '/storage/emulated/0/Asset Pack V2',
    '/sdcard/Asset Pack V2',
    '/storage/emulated/0/Download/Asset Pack V2',
    '/sdcard/Download/Asset Pack V2',
    '/sdcard/Android/data/com.rrwr.app/files/Asset Pack V2',
    '/data/user/0/com.rrwr.app/files/Asset Pack V2'
  ];

  function normalizeAndroidPath(p) {
    if (typeof p !== 'string') return '';
    let norm = p.trim().replace(/\/+$/, '');
    if (norm.startsWith('/sdcard/')) {
      norm = '/storage/emulated/0/' + norm.slice(8);
    } else if (norm === '/sdcard') {
      norm = '/storage/emulated/0';
    }
    return norm;
  }

  function isAndroidPlatform() {
    return Boolean(
      (state.appInfo && state.appInfo.platform === 'android') ||
      (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent))
    );
  }

  function renderAndroidAssetSectionHtml(currentAssetDir) {
    const rawCandidates = [
      currentAssetDir,
      ...ANDROID_ASSET_PACK_PATHS
    ];
    const candidates = [];
    const seenNormalized = new Set();
    for (const p of rawCandidates) {
      if (typeof p === 'string' && p.trim().length > 0) {
        const norm = normalizeAndroidPath(p);
        if (!seenNormalized.has(norm)) {
          seenNormalized.add(norm);
          candidates.push(p.trim());
        }
      }
    }

    return `
      <div class="androidAssetSection">
        <h3>Detected Asset Pack Paths</h3>
        <p class="assetSetupHelp">Check standard Android storage locations or enter the path to your extracted Asset Pack V2:</p>
        <div class="androidAssetPathList" id="android-asset-path-list">
          ${candidates.map(p => `
            <div class="androidAssetPathItem" data-path="${escapeHtml(p)}" style="display:none;">
              <div class="androidAssetPathHeader">
                <span class="androidAssetPathText">${escapeHtml(p)}</span>
                <span class="androidAssetBadge found">Found</span>
              </div>
              <button type="button" class="androidAssetSelectBtn">Select this folder</button>
            </div>
          `).join('')}
          <div class="androidAssetNoneFound" id="android-asset-none-found" style="display:none; font-size: 13px; color: #888; padding: 6px 0;">
            No asset pack detected automatically in standard locations.
          </div>
        </div>
        <div class="androidManualInputBox">
          <label for="manual-asset-pack-input">Custom Asset Pack Path:</label>
          <div class="androidManualInputRow">
            <input type="text" id="manual-asset-pack-input" value="${escapeHtml(currentAssetDir || '')}" placeholder="/storage/emulated/0/Asset Pack V2" autocomplete="off" />
            <button type="button" id="browse-asset-pack-btn" class="androidBrowseBtn">Browse Folder</button>
            <button type="button" id="apply-manual-asset-pack">Select Path</button>
          </div>
        </div>
      </div>
    `;
  }

  async function renderSettingsView(container) {
    let mods = [];
    try {
      mods = await ipcInvoke('get_available_mods');
      state.availableMods = Array.isArray(mods) ? mods : [];
    } catch (e) {
      console.warn('[RRWR-Settings] Could not fetch mods:', e);
    }

    const cfg = state.config;
    const settings = cfg.settings;
    const animEngine = window.RRWRAnimations;
    if (animEngine) {
      animEngine.normalizeSettings(settings);
    }
    const animUiState = animEngine
      ? animEngine.getMasterUiState(settings)
      : { checked: settings.animationsEnabled !== false, indeterminate: false, activeCount: 6 };
    const animCats = settings.animationCategories || {};
    const savedEnabledMods = getSavedEnabledMods();
    const savedModSet = new Set(savedEnabledMods);
    const effectiveEnabledMods = getEffectiveEnabledMods();
    const effectiveModSet = new Set(effectiveEnabledMods);
    const pendingModInfo = getPendingModChanges();
    const pendingModSummary = formatPendingModSummary(pendingModInfo);

    const enabledModsList = [];
    const disabledModsList = [];
    mods.forEach((mod) => {
      if (savedModSet.has(mod.id)) {
        enabledModsList.push(mod);
      } else {
        disabledModsList.push(mod);
      }
    });

    // Rank enabled mods by their active load order, and sort disabled mods alphabetically
    enabledModsList.sort((a, b) => {
      const idxA = savedEnabledMods.indexOf(a.id);
      const idxB = savedEnabledMods.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return String(a.title || a.name || a.id).localeCompare(String(b.title || b.name || b.id));
    });
    disabledModsList.sort((a, b) =>
      String(a.title || a.name || a.id).localeCompare(String(b.title || b.name || b.id))
    );

    const renderModCardHtml = (mod) => {
      const isSaved = savedModSet.has(mod.id);
      const isEffective = effectiveModSet.has(mod.id);
      const stagedClass = (!isSaved && isEffective)
        ? 'modCard--staged-enable'
        : ((isSaved && !isEffective) ? 'modCard--staged-disable' : '');
      const stagedLabel = (!isSaved && isEffective)
        ? '<span class="modStagedBadge modStagedBadge--enable">PENDING ON</span>'
        : ((isSaved && !isEffective) ? '<span class="modStagedBadge modStagedBadge--disable">PENDING OFF</span>' : '<span class="modStagedBadge hidden"></span>');
      const isExpanded = state.expandedMods && state.expandedMods.has(mod.id);
      return `
        <div class="modCard ${isExpanded ? 'expanded' : 'collapsed'} ${stagedClass}" data-mod-id="${escapeHtml(mod.id)}">
          <div class="modCardHeader" data-mod-id="${escapeHtml(mod.id)}" role="button" tabindex="0" title="Click to expand/collapse details and settings">
            <div class="modCardTitleGroup">
              <span class="modExpandIcon">▶</span>
              <span class="modCardTitle">${escapeHtml(mod.title || mod.name || mod.id)}</span>
              <span class="modBadgeCompact">v${escapeHtml(mod.version || '1.0.0')}</span>
              ${stagedLabel}
            </div>
            <button class="toggleModBtn ${isEffective ? 'enabled' : 'disabled'}" data-mod-id="${escapeHtml(mod.id)}" title="Click to stage enabling or disabling this mod">
              ${isEffective ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>
          <div class="modCardBody">
            <div class="modCardDescription">${sanitizeModHtml(mod.description || 'Community expansion mod.')}</div>
            ${renderModPreviewsHtml(mod)}
            <div class="modBadges">
              ${mod.author ? `<span class="modBadge modBadgeAuthor">by ${sanitizeModHtml(mod.author)}</span>` : ''}
            </div>
            ${renderModSubSettingsHtml(mod)}
          </div>
        </div>
      `;
    };

    const renderModSupergroupHtml = (groupKey, title, list, emptyText) => {
      const isGroupCollapsed = state.collapsedModGroups && state.collapsedModGroups.has(groupKey);
      return `
        <div class="modSupergroup ${isGroupCollapsed ? 'collapsed' : 'expanded'} modSupergroup--${groupKey}" data-group-key="${groupKey}">
          <div class="modSupergroupHeader" data-group-key="${groupKey}" role="button" tabindex="0" aria-expanded="${!isGroupCollapsed}" title="Click to expand/collapse ${escapeHtml(title)}">
            <div class="modSupergroupTitleGroup">
              <span class="modGroupExpandIcon">▶</span>
              <span class="modSupergroupTitle">${escapeHtml(title)}</span>
            </div>
            <span class="modGroupCount">${list.length}</span>
          </div>
          <div class="modSupergroupBody">
            ${list.length === 0
              ? `<p class="modGroupEmpty">${escapeHtml(emptyText)}</p>`
              : list.map((mod) => renderModCardHtml(mod)).join('')}
          </div>
        </div>
      `;
    };

    const animPanelExpanded = Boolean(state.uiPrefs && state.uiPrefs.animationsExpanded);
    const animBadgeClass = animUiState.indeterminate
      ? 'animStatusPill animStatusPill--custom'
      : (animUiState.checked ? 'animStatusPill' : 'animStatusPill animStatusPill--off');
    const animBadgeText = animUiState.indeterminate
      ? `CUSTOM (${animUiState.activeCount}/7)`
      : (animUiState.checked ? 'ON' : (animUiState.activeCount > 0 ? `CUSTOM (${animUiState.activeCount}/7)` : 'OFF'));
    const customModThemes = Array.isArray(state.modThemes) ? state.modThemes : [];
    const assetPackReady = Boolean(state.appInfo && state.appInfo.asset_pack_ready);
    const isAndroid = isAndroidPlatform();

    container.innerHTML = `
      <div class="systemPageContainer">
        <h1 style="font-family: 'Courier Prime', 'Courier New', monospace;">SETTINGS &amp; PREFERENCES</h1>

        <div class="settingsSectionCard assetSetupCard">
          <h2>Asset Pack, Mods &amp; Custom Assets</h2>
          <p>${assetPackReady ? 'Asset Pack V2 is connected.' : 'The app needs the extracted Asset Pack V2 folder before the collection can load.'}</p>
          <p class="assetLocation"><strong>Asset Pack:</strong> ${escapeHtml((state.appInfo && state.appInfo.asset_dir) || 'not selected')}<br><strong>Custom asset overlay:</strong> ${escapeHtml((state.appInfo && state.appInfo.custom_asset_dir) || 'available after import')}</p>
          <div class="assetSetupActions">
            ${isAndroid ? `
              <button type="button" id="import-mod-zip" ${assetPackReady ? '' : 'disabled'}>Import mod ZIP</button>
              <button type="button" id="import-assets-zip">Import assets ZIP</button>
            ` : `
              <button type="button" id="choose-asset-pack">${assetPackReady ? 'Change Asset Pack folder' : 'Choose Asset Pack V2 folder'}</button>
              <button type="button" id="import-mod-folder" ${assetPackReady ? '' : 'disabled'}>Import mod folder</button>
              <button type="button" id="import-mod-zip" ${assetPackReady ? '' : 'disabled'}>Import mod ZIP</button>
              <button type="button" id="import-assets-folder">Import assets folder</button>
              <button type="button" id="import-assets-zip">Import assets ZIP</button>
            `}
          </div>
          ${isAndroid ? renderAndroidAssetSectionHtml((state.appInfo && state.appInfo.asset_dir) || '') : ''}
          <p id="asset-import-status" class="assetImportStatus" role="status" aria-live="polite"></p>
          <p class="assetSetupHelp">${isAndroid ? 'Select or enter the extracted Asset Pack V2 folder. Mods and custom assets can be imported from ZIP archives.' : 'Choose the already extracted Asset Pack V2 folder. The app keeps it untouched; imported replacement files live in a separate overlay. Mods can be imported from a folder or a ZIP archive.'}</p>
        </div>

        <!-- Section 1: Themes & Appearance -->
        <div class="settingsSectionCard">
          <h2>Themes &amp; Visuals</h2>
          <div class="settingRow">
            <label for="theme-select"><strong>Reader Theme:</strong></label>
            <select id="theme-select" style="padding: 6px 10px; font-size: 14px;">
              <option value="default" ${settings.themeOverride === 'default' ? 'selected' : ''}>Default</option>
              <option value="dark" ${settings.themeOverride === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="retro" ${settings.themeOverride === 'retro' ? 'selected' : ''}>Retro</option>
              ${customModThemes.map((th, idx) => {
                const themeVal = th.value || th.id || `theme-${th.modId || 'mod'}-${idx}`;
                const themeLabel = th.label || th.name || themeVal;
                return `<option value="${escapeHtml(themeVal)}" ${settings.themeOverride === themeVal ? 'selected' : ''}>${escapeHtml(themeLabel)}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="settingRow">
            <label for="setting-force-theme">Force Theme Override across all pages:</label>
            <input type="checkbox" id="setting-force-theme" ${settings.forceThemeOverride ? 'checked' : ''} />
          </div>
          <div class="settingRow">
            <label for="setting-high-contrast">High Contrast text mode:</label>
            <input type="checkbox" id="setting-high-contrast" ${settings.textOverride?.highContrast ? 'checked' : ''} />
          </div>
          <div class="settingRow">
            <label for="setting-force-scrollbar">Always display vertical scrollbar:</label>
            <input type="checkbox" id="setting-force-scrollbar" ${settings.forceScrollBar ? 'checked' : ''} />
          </div>
        </div>

        <!-- Section 2: Reading Options -->
        <div class="settingsSectionCard">
          <h2>Reading Experience</h2>
          <div class="settingRow">
            <label for="setting-open-logs">Expand dialogue logs automatically:</label>
            <input type="checkbox" id="setting-open-logs" ${settings.openLogs ? 'checked' : ''} />
          </div>
          <div class="settingRow">
            <label for="setting-story-mode">Use archive page IDs:</label>
            <input type="checkbox" id="setting-story-mode" ${settings.storyMode ? 'checked' : ''} />
          </div>
          <div class="settingRow">
            <label for="setting-switch-tabs">Switch to new tabs immediately when opened:</label>
            <input type="checkbox" id="setting-switch-tabs" ${settings.switchToNewTabs ? 'checked' : ''} />
          </div>
        </div>

        <!-- Section 2B: Animations -->
        <div class="settingsSectionCard" id="settings-animations-card">
          <h2>Animations</h2>
          <div class="animSettingsHeaderRow">
            <div class="animSettingsControlCluster">
              <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                <input type="checkbox" id="setting-animations-master" ${animUiState.checked ? 'checked' : ''} />
                <span>Enable Animations</span>
              </label>
              <span id="anim-master-status-pill" class="${animBadgeClass}">${animBadgeText}</span>
            </div>
          </div>

          <button type="button" id="anim-categories-toggle" class="animExpandBtn" aria-expanded="${animPanelExpanded ? 'true' : 'false'}" aria-controls="anim-categories-panel">
            <span class="animExpandBtnLeft">
              <span class="animExpandIcon">&gt;</span>
              <span>Customize Individual Animations</span>
            </span>
            <span id="anim-categories-count" style="font-size: 11px; opacity: 0.78;">${animUiState.activeCount}/7 active</span>
          </button>

          <div id="anim-categories-panel" class="animCategoriesPanel" style="display: ${animPanelExpanded ? 'block' : 'none'};">
            <div class="animCategoryGrid">
              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-tabs" class="animCategoryCheckbox" data-anim-category="tabs" ${animCats.tabs ? 'checked' : ''} />
                  <span>Tabs (Create / Close / Reorder)</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-menus" class="animCategoryCheckbox" data-anim-category="menus" ${animCats.menus ? 'checked' : ''} />
                  <span>Menus, Bookmarks &amp; Modals</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-bootSplash" class="animCategoryCheckbox" data-anim-category="bootSplash" ${animCats.bootSplash ? 'checked' : ''} />
                  <span>Boot Loading Screen</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-modLoading" class="animCategoryCheckbox" data-anim-category="modLoading" ${animCats.modLoading ? 'checked' : ''} />
                  <span>Mod Loading Screen</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-reloadIcon" class="animCategoryCheckbox" data-anim-category="reloadIcon" ${animCats.reloadIcon ? 'checked' : ''} />
                  <span>Reload Button</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-uiMicro" class="animCategoryCheckbox" data-anim-category="uiMicro" ${animCats.uiMicro ? 'checked' : ''} />
                  <span>Page Controls &amp; Logs</span>
                </label>
              </div>

              <div class="animCategoryRow">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;">
                  <input type="checkbox" id="setting-anim-cat-pageTransitions" class="animCategoryCheckbox" data-anim-category="pageTransitions" ${animCats.pageTransitions ? 'checked' : ''} />
                  <span>Page Transitions</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 3: Audio & Playback -->
        <div class="settingsSectionCard">
          <h2>Audio &amp; Playback</h2>
          <div class="settingRow">
            <label for="setting-master-volume">Master Output Volume:</label>
            <div class="settingsVolumeControl">
              <button type="button" id="setting-master-muted" class="systemButton volumeMuteBtn" title="Mute / Unmute" aria-label="Toggle Master Mute" aria-pressed="${settings.masterMuted ? 'true' : 'false'}" style="width: auto; padding: 0 8px; font-size: 11px; font-weight: bold;">${settings.masterMuted ? 'UNMUTE' : 'MUTE'}</button>
              <input type="range" id="setting-master-volume" class="volumeSlider" min="0" max="100" step="1" value="${Math.round(normalizeMasterVolume(settings.masterVolume ?? settings.master_volume ?? 1.0) * 100)}" />
              <span id="setting-master-volume-value" class="settingsVolumeValue">${settings.masterMuted ? 'MUTED' : `${Math.round(normalizeMasterVolume(settings.masterVolume ?? settings.master_volume ?? 1.0) * 100)}%`}</span>
            </div>
          </div>
          <div class="settingRow">
            <label for="setting-hq-audio">High Quality (HQ) Audio:</label>
            <input type="checkbox" id="setting-hq-audio" ${settings.hqAudio ? 'checked' : ''} />
          </div>
        </div>

        <!-- Section 4: Discord Rich Presence (RPC) -->
        ${isAndroid ? '' : `
        <div class="settingsSectionCard">
          <h2>Discord Rich Presence</h2>
          <div class="settingRow">
            <label for="setting-discord-rpc">Enable Discord Rich Presence (RPC):</label>
            <input type="checkbox" id="setting-discord-rpc" ${settings.enableDiscordRpc ? 'checked' : ''} />
          </div>
          <div class="settingRow" style="margin-top: 8px;">
            <label for="setting-discord-client-id" style="font-size: 14px;">Custom Application ID (optional):</label>
            <input type="text" id="setting-discord-client-id" value="${escapeHtml(settings.discordClientId || settings.discord_client_id || '')}" placeholder="Leave empty to use the built-in application" autocomplete="off" style="width: 320px; max-width: 100%; padding: 6px 10px; font-family: monospace; font-size: 13px;" />
            <button type="button" id="setting-discord-client-id-reset" style="padding: 6px 10px;">Use built-in ID</button>
          </div>
        </div>
        `}

        <!-- Section 5: Community Mods -->
        <div class="settingsSectionCard" id="settings-mods-card">
          <div class="modsSectionHeader">
            <h2>Community Mods (${mods.length})</h2>
            <span class="modsHintTag">Toggle mods below, then Apply &amp; Save to reload</span>
          </div>
          <div id="mod-pending-bar" class="modPendingBar ${pendingModInfo.totalCount > 0 ? '' : 'hidden'}">
            <div class="modPendingSummary">
              <span class="modPendingBadge">${pendingModInfo.totalCount} PENDING</span>
              <span id="mod-pending-detail">${escapeHtml(pendingModSummary)}</span>
            </div>
            <div class="modPendingActions">
              <button type="button" id="discard-mod-changes-btn" class="modDiscardBtn">Discard</button>
              <button type="button" id="apply-mod-changes-btn" class="modApplyBtn">Apply &amp; Save Mod Changes (${pendingModInfo.totalCount} pending)</button>
            </div>
          </div>
          <div id="mods-list">
            ${mods.length === 0
              ? '<p style="font-size: 12px; color: #888;">No community mods found in mod directory.</p>'
              : renderModSupergroupHtml('enabled', 'Enabled Mods', enabledModsList, 'No enabled mods.') +
                renderModSupergroupHtml('disabled', 'Disabled Mods', disabledModsList, 'All mods are enabled.')}
          </div>
        </div>
      </div>
    `;

    bindAssetSetupActions(container);

    // Bind settings event listeners
    const themeSelect = container.querySelector('#theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        settings.themeOverride = e.target.value;
        const newTheme = computeActiveTheme(null, settings);
        applyTheme(newTheme);
        persistConfig();
      });
    }

    const forceThemeBox = container.querySelector('#setting-force-theme');
    if (forceThemeBox) {
      forceThemeBox.addEventListener('change', (e) => {
        settings.forceThemeOverride = e.target.checked;
        const newTheme = computeActiveTheme(null, settings);
        applyTheme(newTheme);
        persistConfig();
      });
    }

    const highContrastBox = container.querySelector('#setting-high-contrast');
    if (highContrastBox) {
      highContrastBox.addEventListener('change', (e) => {
        if (!settings.textOverride) settings.textOverride = {};
        settings.textOverride.highContrast = e.target.checked;
        persistConfig();
      });
    }

    const scrollbarBox = container.querySelector('#setting-force-scrollbar');
    if (scrollbarBox) {
      scrollbarBox.addEventListener('change', (e) => {
        settings.forceScrollBar = e.target.checked;
        applyGlobalSettings(settings);
        persistConfig();
      });
    }

    const openLogsBox = container.querySelector('#setting-open-logs');
    if (openLogsBox) {
      openLogsBox.addEventListener('change', (e) => {
        settings.openLogs = e.target.checked;
        persistConfig();
      });
    }

    const storyModeBox = container.querySelector('#setting-story-mode');
    if (storyModeBox) {
      storyModeBox.addEventListener('change', (e) => {
        settings.storyMode = e.target.checked;
        updateAddressBar(getActiveTab().url);
        persistConfig();
      });
    }

    const switchTabsBox = container.querySelector('#setting-switch-tabs');
    if (switchTabsBox) {
      switchTabsBox.addEventListener('change', (e) => {
        settings.switchToNewTabs = e.target.checked;
        persistConfig();
      });
    }

    // Animations & Motion settings bindings
    const animMasterBox = container.querySelector('#setting-animations-master');
    const animToggleBtn = container.querySelector('#anim-categories-toggle');
    const animPanel = container.querySelector('#anim-categories-panel');
    const animStatusPill = container.querySelector('#anim-master-status-pill');
    const animCountSpan = container.querySelector('#anim-categories-count');
    const animCategoryBoxes = container.querySelectorAll('.animCategoryCheckbox');

    const syncAnimControlsUi = () => {
      if (!animEngine) return;
      const uiState = animEngine.getMasterUiState(settings);
      if (animMasterBox) {
        animMasterBox.checked = uiState.checked;
        animMasterBox.indeterminate = uiState.indeterminate;
      }
      if (animStatusPill) {
        animStatusPill.className = uiState.indeterminate
          ? 'animStatusPill animStatusPill--custom'
          : (uiState.checked ? 'animStatusPill' : 'animStatusPill animStatusPill--off');
        animStatusPill.textContent = uiState.indeterminate
          ? `CUSTOM (${uiState.activeCount}/7)`
          : (uiState.checked ? 'ON' : (uiState.activeCount > 0 ? `CUSTOM (${uiState.activeCount}/7)` : 'OFF'));
      }
      if (animCountSpan) {
        animCountSpan.textContent = `${uiState.activeCount}/7 active`;
      }
      const cats = settings.animationCategories || {};
      animCategoryBoxes.forEach((box) => {
        const catKey = box.getAttribute('data-anim-category');
        if (catKey) {
          box.checked = Boolean(cats[catKey]);
        }
      });
    };

    if (animMasterBox && animEngine) {
      animMasterBox.indeterminate = animUiState.indeterminate;
      animMasterBox.addEventListener('change', (e) => {
        animEngine.setMasterEnabled(settings, e.target.checked);
        syncAnimControlsUi();
        persistConfig();
      });
    }

    if (animToggleBtn && animPanel) {
      animToggleBtn.addEventListener('click', () => {
        if (!state.uiPrefs) state.uiPrefs = {};
        const nextExpanded = !Boolean(state.uiPrefs.animationsExpanded);
        state.uiPrefs.animationsExpanded = nextExpanded;
        animToggleBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        if (animEngine) {
          animEngine.animateCollapsible(animPanel, nextExpanded, {
            category: 'menus',
            displayMode: 'block',
            durationMs: 210
          });
        } else {
          animPanel.style.display = nextExpanded ? 'block' : 'none';
        }
      });
    }

    if (animEngine) {
      animCategoryBoxes.forEach((box) => {
        box.addEventListener('change', (e) => {
          const catKey = box.getAttribute('data-anim-category');
          if (!catKey) return;
          animEngine.setCategoryEnabled(settings, catKey, e.target.checked);
          syncAnimControlsUi();
          persistConfig();
        });
      });
    }

    const discordBox = container.querySelector('#setting-discord-rpc');
    if (discordBox) {
      discordBox.addEventListener('change', (e) => {
        settings.enableDiscordRpc = e.target.checked;
        ipcInvoke('toggle_discord_rpc', { enabled: e.target.checked }).catch(() => {});
        persistConfig();
      });
    }

    const discordClientIdInput = container.querySelector('#setting-discord-client-id');
    if (discordClientIdInput) {
      discordClientIdInput.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        settings.discordClientId = val;
        delete settings.discord_client_id;
        persistConfig(true);
      });
    }
    const discordClientIdReset = container.querySelector('#setting-discord-client-id-reset');
    if (discordClientIdReset && discordClientIdInput) {
      discordClientIdReset.addEventListener('click', () => {
        discordClientIdInput.value = '';
        settings.discordClientId = '';
        delete settings.discord_client_id;
        persistConfig(true);
      });
    }

    // Master Output Volume mirror controls
    const masterVolSlider = container.querySelector('#setting-master-volume');
    const masterMuteBtn = container.querySelector('#setting-master-muted');
    if (masterVolSlider) {
      masterVolSlider.addEventListener('input', (e) => {
        const vol = normalizeMasterVolume(Number(e.target.value) / 100);
        const muted = vol === 0 ? true : false;
        applyMasterVolume(vol, muted, { persist: false });
      });
      masterVolSlider.addEventListener('change', (e) => {
        const vol = normalizeMasterVolume(Number(e.target.value) / 100);
        const muted = vol === 0 ? true : false;
        applyMasterVolume(vol, muted, { persist: true, immediate: true });
      });
    }
    if (masterMuteBtn) {
      masterMuteBtn.addEventListener('click', () => {
        const curVol = normalizeMasterVolume(settings.masterVolume ?? 1.0);
        const nextMuted = !Boolean(settings.masterMuted);
        applyMasterVolume(curVol, nextMuted, { persist: true, immediate: true });
      });
    }

    const hqBox = container.querySelector('#setting-hq-audio');
    if (hqBox) hqBox.addEventListener('change', (e) => { settings.hqAudio = e.target.checked; persistConfig(); });

    // Community mod supergroups -> expand/collapse Enabled and Disabled sections
    const modGroupHeaders = container.querySelectorAll('.modSupergroupHeader');
    modGroupHeaders.forEach((groupHeader) => {
      const toggleGroup = () => {
        const groupKey = groupHeader.getAttribute('data-group-key');
        const group = groupHeader.closest('.modSupergroup');
        if (!group) return;
        if (!state.collapsedModGroups) state.collapsedModGroups = new Set();
        const isNowExpanded = group.classList.contains('collapsed');
        const bodyEl = group.querySelector('.modSupergroupBody');

        if (!isNowExpanded && bodyEl && window.RRWRAnimations) {
          bodyEl.style.display = 'block';
        }

        group.classList.toggle('expanded', isNowExpanded);
        group.classList.toggle('collapsed', !isNowExpanded);
        groupHeader.setAttribute('aria-expanded', String(isNowExpanded));
        if (isNowExpanded) {
          state.collapsedModGroups.delete(groupKey);
        } else {
          state.collapsedModGroups.add(groupKey);
        }

        if (bodyEl && window.RRWRAnimations) {
          window.RRWRAnimations.animateCollapsible(bodyEl, isNowExpanded, {
            category: 'menus',
            displayMode: 'block',
            durationMs: 210,
            onDone() {
              if (bodyEl.isConnected && !isNowExpanded) {
                bodyEl.style.display = '';
              }
            }
          });
        }
      };

      groupHeader.addEventListener('click', toggleGroup);
      groupHeader.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleGroup();
        }
      });
    });

    // Community mod header click -> expand/collapse details and settings
    const modHeaders = container.querySelectorAll('.modCardHeader');
    modHeaders.forEach((header) => {
      const toggleExpand = () => {
        const modId = header.getAttribute('data-mod-id');
        const card = header.closest('.modCard');
        if (!card) return;
        if (!state.expandedMods) state.expandedMods = new Set();
        const wasExpanded = card.classList.contains('expanded');
        const isNowExpanded = !wasExpanded;
        const bodyEl = card.querySelector('.modCardBody');

        if (!isNowExpanded && bodyEl && window.RRWRAnimations) {
          // Keep flex layout active long enough for collapse animation measurement
          bodyEl.style.display = 'flex';
        }

        card.classList.toggle('expanded', isNowExpanded);
        card.classList.toggle('collapsed', !isNowExpanded);
        if (isNowExpanded) {
          state.expandedMods.add(modId);
        } else {
          state.expandedMods.delete(modId);
        }

        if (bodyEl && window.RRWRAnimations) {
          window.RRWRAnimations.animateCollapsible(bodyEl, isNowExpanded, {
            category: 'menus',
            displayMode: 'flex',
            durationMs: 210,
            onDone() {
              if (bodyEl.isConnected && !isNowExpanded) {
                bodyEl.style.display = '';
              }
            }
          });
        }
      };

      header.addEventListener('click', (e) => {
        if (e.target.closest('.toggleModBtn')) return;
        toggleExpand();
      });

      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('.toggleModBtn')) return;
          e.preventDefault();
          toggleExpand();
        }
      });
    });

    // Community mod toggle buttons (stage into pending selection before Apply & Save)
    const modBtns = container.querySelectorAll('.toggleModBtn');
    modBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modId = btn.getAttribute('data-mod-id');
        if (!modId || state.modToggleBusy) return;
        const currentlyEnabled = getEffectiveEnabledMods().includes(modId);
        stageModToggle(modId, !currentlyEnabled, container);
      });
    });

    const applyModChangesBtn = container.querySelector('#apply-mod-changes-btn');
    if (applyModChangesBtn) {
      applyModChangesBtn.addEventListener('click', async () => {
        await applyPendingModChanges();
      });
    }

    const discardModChangesBtn = container.querySelector('#discard-mod-changes-btn');
    if (discardModChangesBtn) {
      discardModChangesBtn.addEventListener('click', () => {
        discardPendingModChanges(container);
      });
    }

    // Community mod preview thumbnail cards -> open lightbox
    const previewCards = container.querySelectorAll('.modPreviewThumbCard');
    previewCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const imgUrl = card.getAttribute('data-img-url');
        const title = card.getAttribute('data-title') || 'Image Preview';
        if (imgUrl) openImageLightbox(imgUrl, title);
      });
    });

    // Community mod sub-settings (boolean checkboxes & radio buttons)
    const modBoolInputs = container.querySelectorAll('.modSettingBoolean');
    modBoolInputs.forEach((input) => {
      input.addEventListener('change', async (e) => {
        const modId = input.getAttribute('data-mod-id');
        const model = input.getAttribute('data-model');
        const value = Boolean(e.target.checked);
        await saveModSetting(modId, model, value);
      });
    });

    const modRadioInputs = container.querySelectorAll('.modSettingRadio');
    modRadioInputs.forEach((input) => {
      input.addEventListener('change', async (e) => {
        if (!e.target.checked) return;
        const modId = input.getAttribute('data-mod-id');
        const model = input.getAttribute('data-model');
        const isJson = input.getAttribute('data-is-json') === 'true';
        let value = e.target.value;
        if (isJson) {
          try {
            value = JSON.parse(value);
          } catch (_) {}
        }
        await saveModSetting(modId, model, value);
      });
    });
  }

  function setAssetImportStatus(container, message, isError = false) {
    const status = container.querySelector('#asset-import-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function bindAssetSetupActions(container) {
    const choosePack = container.querySelector('#choose-asset-pack');
    if (choosePack) {
      choosePack.addEventListener('click', async () => {
        try {
          const selected = await ipcInvoke('pick_asset_pack');
          if (!selected) return;
          setAssetImportStatus(container, 'Checking the Asset Pack and reloading…');
          await ipcInvoke('configure_asset_pack', { path: selected });
          state.appInfo = await ipcInvoke('get_app_info');
          if (state.appInfo && state.appInfo.asset_pack_ready) {
            await initApp();
          }
        } catch (error) {
          setAssetImportStatus(container, String(error), true);
        }
      });
    }

    const importButton = (selector, kind, command, resultLabel) => {
      const button = container.querySelector(selector);
      if (!button) return;
      button.addEventListener('click', async () => {
        button.disabled = true;
        setAssetImportStatus(container, `Choose ${resultLabel} to import…`);
        try {
          const selected = await ipcInvoke('pick_import_path', { kind });
          if (!selected) {
            setAssetImportStatus(container, 'Import cancelled.');
            return;
          }
          setAssetImportStatus(container, 'Importing…');
          const result = await ipcInvoke(command, { path: selected });
          if (command === 'import_community_mod') {
            const names = Array.isArray(result) ? result : [];
            await renderSettingsView(container);
            setAssetImportStatus(container, `Imported ${names.length} mod${names.length === 1 ? '' : 's'}: ${names.join(', ')}. They are disabled until you enable them below.`);
          } else {
            const copied = Number(result) || 0;
            setAssetImportStatus(container, `Imported ${copied} asset file${copied === 1 ? '' : 's'} into the separate custom overlay.`);
            state.appInfo = await ipcInvoke('get_app_info').catch(() => state.appInfo);
          }
        } catch (error) {
          setAssetImportStatus(container, String(error), true);
        } finally {
          const current = container.querySelector(selector);
          if (current) current.disabled = false;
        }
      });
    };

    importButton('#import-mod-folder', 'mod_folder', 'import_community_mod', 'a mod folder');
    importButton('#import-mod-zip', 'mod_archive', 'import_community_mod', 'a mod ZIP');
    importButton('#import-assets-folder', 'assets_folder', 'import_custom_assets', 'an assets folder');
    importButton('#import-assets-zip', 'assets_archive', 'import_custom_assets', 'an assets ZIP');

    // Android Asset Pack path detection and selection handlers
    const pathItems = container.querySelectorAll('.androidAssetPathItem');
    const noneFoundMsg = container.querySelector('#android-asset-none-found');
    let anyFound = false;

    // Query backend to detect valid, physical deduplicated paths
    ipcInvoke('detect_asset_pack_paths')
      .then((validPaths) => {
        const validSet = new Set(Array.isArray(validPaths) ? validPaths.map(p => normalizeAndroidPath(p)) : []);
        pathItems.forEach((item) => {
          const path = item.getAttribute('data-path');
          const norm = normalizeAndroidPath(path);
          if (validSet.has(norm)) {
            item.style.display = 'flex';
            anyFound = true;
          } else {
            item.remove();
          }
        });
        if (!anyFound && noneFoundMsg) {
          noneFoundMsg.style.display = 'block';
        }
      })
      .catch(() => {
        // Fallback to check_asset_pack_path per item
        let checkedCount = 0;
        pathItems.forEach((item) => {
          const path = item.getAttribute('data-path');
          if (path) {
            ipcInvoke('check_asset_pack_path', { path })
              .then((isValid) => {
                if (isValid) {
                  item.style.display = 'flex';
                  anyFound = true;
                } else {
                  item.remove();
                }
              })
              .catch(() => {
                item.remove();
              })
              .finally(() => {
                checkedCount++;
                if (checkedCount >= pathItems.length && !anyFound && noneFoundMsg) {
                  noneFoundMsg.style.display = 'block';
                }
              });
          } else {
            item.remove();
          }
        });
      });

    pathItems.forEach((item) => {
      const path = item.getAttribute('data-path');
      const btn = item.querySelector('.androidAssetSelectBtn');

      if (btn && path) {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          setAssetImportStatus(container, `Connecting to ${path} and reloading…`);
          try {
            await ipcInvoke('configure_asset_pack', { path });
            state.appInfo = await ipcInvoke('get_app_info');
            if (state.appInfo && state.appInfo.asset_pack_ready) {
              setAssetImportStatus(container, 'Asset Pack connected successfully. Initializing…');
              await initApp();
            }
          } catch (error) {
            setAssetImportStatus(container, String(error), true);
            btn.disabled = false;
          }
        });
      }
    });

    const manualInput = container.querySelector('#manual-asset-pack-input');
    const applyManual = container.querySelector('#apply-manual-asset-pack');
    const browseBtn = container.querySelector('#browse-asset-pack-btn');

    if (browseBtn) {
      browseBtn.addEventListener('click', async () => {
        browseBtn.disabled = true;
        setAssetImportStatus(container, 'Choose Asset Pack V2 folder…');
        try {
          const selected = await ipcInvoke('pick_asset_pack');
          if (selected) {
            if (manualInput) manualInput.value = selected;
            setAssetImportStatus(container, `Connecting to ${selected} and reloading…`);
            await ipcInvoke('configure_asset_pack', { path: selected });
            state.appInfo = await ipcInvoke('get_app_info');
            if (state.appInfo && state.appInfo.asset_pack_ready) {
              setAssetImportStatus(container, 'Asset Pack connected successfully. Initializing…');
              await initApp();
            }
          } else {
            setAssetImportStatus(container, 'Folder selection cancelled.');
          }
        } catch (error) {
          setAssetImportStatus(container, String(error), true);
        } finally {
          browseBtn.disabled = false;
        }
      });
    }

    if (applyManual && manualInput) {
      applyManual.addEventListener('click', async () => {
        const path = manualInput.value.trim();
        if (!path) {
          setAssetImportStatus(container, 'Please enter a path to the Asset Pack folder.', true);
          return;
        }
        applyManual.disabled = true;
        setAssetImportStatus(container, `Validating ${path} and reloading…`);
        try {
          await ipcInvoke('configure_asset_pack', { path });
          state.appInfo = await ipcInvoke('get_app_info');
          if (state.appInfo && state.appInfo.asset_pack_ready) {
            setAssetImportStatus(container, 'Asset Pack connected successfully. Initializing…');
            await initApp();
          }
        } catch (error) {
          setAssetImportStatus(container, String(error), true);
          applyManual.disabled = false;
        }
      });
    }
  }

  function renderAssetSetupView(container) {
    const isAndroid = isAndroidPlatform();
    container.innerHTML = `
      <section class="assetSetupWelcome">
        <div class="assetSetupWelcomeCard">
          <p class="assetSetupEyebrow">FIRST-RUN SETUP</p>
          <h1>Connect Content Pack</h1>
          <p>Select the folder containing your content pack. The app will validate it, save the location, and load your reader.</p>
          ${isAndroid ? renderAndroidAssetSectionHtml((state.appInfo && state.appInfo.asset_dir) || '') : `
            <button type="button" id="choose-asset-pack" class="assetSetupPrimary">Select Content Pack Folder</button>
          `}
          <p id="asset-import-status" class="assetImportStatus" role="status" aria-live="polite"></p>
          <p class="assetSetupHelp">The selected folder must contain <code>archive/data/story.json</code> and <code>archive/data/music.json</code>.</p>
          <hr />
          <h2>Optional imports</h2>
          <p>Once the Asset Pack is connected, you can import community mods and asset overlays from Settings. Imported files are stored separately from the original pack.</p>
        </div>
      </section>
    `;
    bindAssetSetupActions(container);
  }

  const renderSettingsPage = renderSettingsView;

  function getSavedEnabledMods() {
    const cfg = state.config || {};
    const fromCfg = (cfg.settings && Array.isArray(cfg.settings.modListEnabled))
      ? cfg.settings.modListEnabled
      : (Array.isArray(cfg.enabledMods) ? cfg.enabledMods : []);
    const merged = new Set(fromCfg);
    if (Array.isArray(state.availableMods)) {
      for (const m of state.availableMods) {
        if (m && m.id && m.enabled) {
          merged.add(m.id);
        }
      }
    }
    return Array.from(merged);
  }

  function getEffectiveEnabledMods() {
    return Array.isArray(state.pendingEnabledMods)
      ? state.pendingEnabledMods
      : getSavedEnabledMods();
  }

  function getModTitleById(modId) {
    const modMeta = (state.availableMods || []).find((m) => m.id === modId);
    return (modMeta && (modMeta.title || modMeta.name)) || modId;
  }

  function getPendingModChanges() {
    const saved = getSavedEnabledMods();
    if (!Array.isArray(state.pendingEnabledMods)) {
      return { changes: [], addedCount: 0, removedCount: 0, totalCount: 0 };
    }
    const savedSet = new Set(saved);
    const pendingSet = new Set(state.pendingEnabledMods);
    const changes = [];
    let addedCount = 0;
    let removedCount = 0;

    for (const id of saved) {
      if (!pendingSet.has(id)) {
        removedCount++;
        changes.push({ modId: id, enabled: false, title: getModTitleById(id) });
      }
    }
    for (const id of state.pendingEnabledMods) {
      if (!savedSet.has(id)) {
        addedCount++;
        changes.push({ modId: id, enabled: true, title: getModTitleById(id) });
      }
    }
    return {
      changes,
      addedCount,
      removedCount,
      totalCount: changes.length
    };
  }

  function formatPendingModSummary(pendingInfo) {
    if (!pendingInfo || pendingInfo.totalCount === 0) return 'No pending changes';
    const parts = [];
    if (pendingInfo.addedCount > 0) parts.push(`+${pendingInfo.addedCount} enable`);
    if (pendingInfo.removedCount > 0) parts.push(`-${pendingInfo.removedCount} disable`);
    return parts.join(', ');
  }

  function updateModStagingUi(containerEl) {
    const scope = containerEl || document.getElementById('page-content');
    if (!scope) return;

    const savedSet = new Set(getSavedEnabledMods());
    const effectiveSet = new Set(getEffectiveEnabledMods());
    const pending = getPendingModChanges();

    const bar = scope.querySelector('#mod-pending-bar');
    if (bar) {
      bar.classList.toggle('hidden', pending.totalCount === 0);
      const badge = bar.querySelector('.modPendingBadge');
      if (badge) badge.textContent = `${pending.totalCount} PENDING`;
      const detail = bar.querySelector('#mod-pending-detail');
      if (detail) detail.textContent = formatPendingModSummary(pending);
      const applyBtn = bar.querySelector('#apply-mod-changes-btn');
      if (applyBtn) {
        applyBtn.textContent = `Apply & Save Mod Changes (${pending.totalCount} pending)`;
        applyBtn.disabled = state.modToggleBusy;
      }
      const discardBtn = bar.querySelector('#discard-mod-changes-btn');
      if (discardBtn) {
        discardBtn.disabled = state.modToggleBusy;
      }
    }

    const cards = scope.querySelectorAll('#mods-list .modCard');
    cards.forEach((card) => {
      const modId = card.getAttribute('data-mod-id');
      if (!modId) return;
      const isSaved = savedSet.has(modId);
      const isEffective = effectiveSet.has(modId);

      card.classList.toggle('modCard--staged-enable', !isSaved && isEffective);
      card.classList.toggle('modCard--staged-disable', isSaved && !isEffective);

      const stagedBadge = card.querySelector('.modStagedBadge');
      if (stagedBadge) {
        stagedBadge.classList.remove('modStagedBadge--enable', 'modStagedBadge--disable', 'hidden');
        if (!isSaved && isEffective) {
          stagedBadge.classList.add('modStagedBadge--enable');
          stagedBadge.textContent = 'PENDING ON';
        } else if (isSaved && !isEffective) {
          stagedBadge.classList.add('modStagedBadge--disable');
          stagedBadge.textContent = 'PENDING OFF';
        } else {
          stagedBadge.classList.add('hidden');
          stagedBadge.textContent = '';
        }
      }

      const btn = card.querySelector('.toggleModBtn');
      if (btn) {
        btn.classList.toggle('enabled', isEffective);
        btn.classList.toggle('disabled', !isEffective);
        btn.textContent = isEffective ? 'ENABLED' : 'DISABLED';
      }
    });
  }

  function stageModToggle(modId, enabled, containerEl) {
    if (!modId) return;
    const base = Array.isArray(state.pendingEnabledMods)
      ? [...state.pendingEnabledMods]
      : [...getSavedEnabledMods()];
    const idx = base.indexOf(modId);
    if (enabled && idx === -1) {
      base.push(modId);
    } else if (!enabled && idx !== -1) {
      base.splice(idx, 1);
    }

    state.pendingEnabledMods = base;
    const diff = getPendingModChanges();
    if (diff.totalCount === 0) {
      state.pendingEnabledMods = null;
    }

    updateModStagingUi(containerEl);
  }

  function discardPendingModChanges(containerEl) {
    if (state.modToggleBusy) return;
    state.pendingEnabledMods = null;
    updateModStagingUi(containerEl);
  }

  async function applyPendingModChanges() {
    if (state.modToggleBusy) return;
    const pending = getPendingModChanges();
    if (pending.totalCount === 0) {
      state.pendingEnabledMods = null;
      updateModStagingUi();
      return;
    }

    state.modToggleBusy = true;
    updateModStagingUi();

    const activeTab = getActiveTab();
    if (window.RRWRAnimations && activeTab) {
      window.RRWRAnimations.captureScrollState(activeTab);
    }

    const changes = pending.changes;
    const targetEnabledList = Array.from(new Set(state.pendingEnabledMods || []));
    const headline = changes.length === 1
      ? `${changes[0].enabled ? 'ENABLING' : 'DISABLING'}: ${changes[0].title}`
      : `APPLYING ${changes.length} COMMUNITY MODS`;
    const loaderOverlay = window.RRWRAnimations
      ? await window.RRWRAnimations.beginModLoading(headline, true, { batch: true, headline })
      : null;

    let ok = true;
    try {
      for (let i = 0; i < changes.length; i++) {
        const item = changes[i];
        if (window.RRWRAnimations && window.RRWRAnimations.updateModLoading) {
          const pct = 24 + Math.round(((i + 0.5) / Math.max(changes.length, 1)) * 52);
          window.RRWRAnimations.updateModLoading(
            pct,
            `> [${i + 1}/${changes.length}] ${item.enabled ? 'ENABLING' : 'DISABLING'} ${item.title}...`
          );
        }
        await ipcInvoke('toggle_mod', { mod_id: item.modId, enabled: item.enabled });
      }

      if (!state.config.settings) state.config.settings = {};
      state.config.enabledMods = [...targetEnabledList];
      state.config.settings.modListEnabled = [...targetEnabledList];
      state.pendingEnabledMods = null;

      state.overlayGeneration++;
      if (state.pageCache) state.pageCache.clear();
      persistConfig(true);

      if (window.RRWRAnimations && window.RRWRAnimations.updateModLoading) {
        window.RRWRAnimations.updateModLoading(82, '> RELOADING MOD HOOKS, STYLES & VFS...');
      }

      state.availableMods = await ipcInvoke('get_available_mods').catch(() => state.availableMods);
      await syncModRuntime({ reRender: true });
    } catch (err) {
      ok = false;
      console.error('[RRWR-Mods] Failed to apply pending mod changes:', err);
      await loadConfig().catch(() => {});
      state.availableMods = await ipcInvoke('get_available_mods').catch(() => state.availableMods);
      state.pendingEnabledMods = null;
      updateModStagingUi();
    } finally {
      state.modToggleBusy = false;
      if (window.RRWRAnimations) {
        const doneMsg = ok
          ? `Saved & applied ${changes.length} mod change${changes.length === 1 ? '' : 's'}`
          : 'Failed to apply mod changes';
        window.RRWRAnimations.endModLoading(loaderOverlay, ok, doneMsg);
      }
    }
  }

  async function toggleMod(modId, enabled) {
    if (state.modToggleBusy) return;
    state.modToggleBusy = true;

    const activeTab = getActiveTab();
    if (window.RRWRAnimations && activeTab) {
      window.RRWRAnimations.captureScrollState(activeTab);
    }

    const modTitle = getModTitleById(modId);
    const loaderOverlay = window.RRWRAnimations
      ? await window.RRWRAnimations.beginModLoading(modTitle, enabled)
      : null;

    let ok = true;
    try {
      if (window.RRWRAnimations && window.RRWRAnimations.updateModLoading) {
        window.RRWRAnimations.updateModLoading(48, `> ${enabled ? 'ENABLING' : 'DISABLING'} ${modTitle}...`);
      }
      await ipcInvoke('toggle_mod', { mod_id: modId, enabled: enabled });

      if (!state.config.enabledMods) state.config.enabledMods = [];
      if (!state.config.settings) state.config.settings = {};
      if (!state.config.settings.modListEnabled) state.config.settings.modListEnabled = [];

      const idx1 = state.config.enabledMods.indexOf(modId);
      if (enabled && idx1 === -1) {
        state.config.enabledMods.push(modId);
      } else if (!enabled && idx1 !== -1) {
        state.config.enabledMods.splice(idx1, 1);
      }

      const idx2 = state.config.settings.modListEnabled.indexOf(modId);
      if (enabled && idx2 === -1) {
        state.config.settings.modListEnabled.push(modId);
      } else if (!enabled && idx2 !== -1) {
        state.config.settings.modListEnabled.splice(idx2, 1);
      }

      if (Array.isArray(state.pendingEnabledMods)) {
        const pIdx = state.pendingEnabledMods.indexOf(modId);
        if (enabled && pIdx === -1) state.pendingEnabledMods.push(modId);
        if (!enabled && pIdx !== -1) state.pendingEnabledMods.splice(pIdx, 1);
        if (getPendingModChanges().totalCount === 0) {
          state.pendingEnabledMods = null;
        }
      }

      state.overlayGeneration++;
      if (state.pageCache) state.pageCache.clear();
      persistConfig(true);

      if (window.RRWRAnimations && window.RRWRAnimations.updateModLoading) {
        window.RRWRAnimations.updateModLoading(82, '> RELOADING MOD HOOKS, STYLES & VFS...');
      }

      // Refresh available mods list
      state.availableMods = await ipcInvoke('get_available_mods').catch(() => state.availableMods);

      // Synchronize ModRuntime (evaluates active mods, injects styles/themes, applies diffs, hot-reloads active route)
      await syncModRuntime({ reRender: true });
    } catch (err) {
      ok = false;
      console.error(`[RRWR-Mods] Failed to toggle mod '${modId}':`, err);
    } finally {
      state.modToggleBusy = false;
      if (window.RRWRAnimations) {
        window.RRWRAnimations.endModLoading(
          loaderOverlay,
          ok,
          ok ? `${modTitle} ${enabled ? 'enabled' : 'disabled'}` : `Failed toggling ${modTitle}`
        );
      }
    }
  }

  function updateQuickPtBrButton() {
    // No-op: hardcoded mod quick buttons removed
  }

  /* ==========================================================================
     9. Bookmarks & Saved Games Drawer (saveData)
     ========================================================================== */

  function toggleBookmarksDrawer(forceOpen = null) {
    if (typeof document === 'undefined') return;
    const drawer = document.getElementById('bookmarks-drawer');
    if (!drawer) return;

    let isOpen;
    if (window.RRWRAnimations) {
      isOpen = window.RRWRAnimations.setDrawerOpen(drawer, forceOpen);
    } else if (forceOpen === true) {
      drawer.classList.remove('hidden');
      isOpen = true;
    } else if (forceOpen === false) {
      drawer.classList.add('hidden');
      isOpen = false;
    } else {
      drawer.classList.toggle('hidden');
      isOpen = !drawer.classList.contains('hidden');
    }

    if (isOpen) {
      renderBookmarksList();
    }
  }

  function ensureSaveData() {
    if (!state.config.saveData || typeof state.config.saveData !== 'object') {
      state.config.saveData = { saves: {}, saveList: [], flashStorage: {} };
    }
    const data = state.config.saveData;
    if (!data.saves || typeof data.saves !== 'object') data.saves = {};
    if (!Array.isArray(data.saveList)) data.saveList = [];
    if (!data.flashStorage || typeof data.flashStorage !== 'object') data.flashStorage = {};
    return data;
  }

  function getFlashGameKey(pageId, page, mediaList) {
    const flashUrl = (Array.isArray(mediaList) ? mediaList : (page && page.media) || [])
      .find((url) => typeof url === 'string' && /\.swf(?:$|\?)/i.test(url));
    if (!flashUrl) return '';
    try {
      const resolver = root.RRWRFlashProps && root.RRWRFlashProps.resolveMediaAssets;
      if (typeof resolver === 'function') {
        const result = resolver(
          flashUrl,
          state.config.settings || {},
          state.assetBase,
          state.overlayGeneration,
          String(pageId || ''),
          (page && page.flags) || []
        );
        return result.flashId || result.rawFlashId || result.resolvedUrl || flashUrl;
      }
    } catch (_) {}
    return flashUrl;
  }

  function copyFlashStorage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const encoded = JSON.stringify(value);
      if (encoded.length > 512000) return {};
      return JSON.parse(encoded);
    } catch (_) {
      return {};
    }
  }

  function autoSaveStoryPage(pageId, title, page, mediaList) {
    const id = String(pageId || '');
    const tab = getActiveTab();
    const gameKey = getFlashGameKey(id, page, mediaList);
    const data = ensureSaveData();
    const previous = data.saves.autosave || {};
    const pending = state.flashSaveRestore;
    const flashStorage = gameKey
      ? copyFlashStorage(pending && pending.gameKey === gameKey
        ? pending.storage
        : (data.flashStorage[gameKey] || (previous.gameKey === gameKey && previous.flashStorage)))
      : undefined;
    const item = {
      id: 'autosave',
      kind: 'autosave',
      name: 'AUTOSAVE',
      title: title || 'Story',
      url: (tab && tab.url) || `/page/${id}`,
      pageId: id,
      gameKey,
      date: new Date().toLocaleString(),
      ...(gameKey ? { flashStorage } : {})
    };
    data.saves.autosave = item;
    data.saveList = ['autosave', ...data.saveList.filter((key) => key !== 'autosave')];
    if (gameKey) {
      data.flashStorage[gameKey] = flashStorage;
    }
    persistConfig(false);
    renderBookmarksList();
  }

  function bindFlashSaveEvents() {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'RRWR_RUFFLE_STORAGE' || typeof message.gameKey !== 'string') return;
      const frames = Array.from(document.querySelectorAll('iframe.ruffle-frame'));
      const frame = frames.find((item) => item.contentWindow === event.source);
      if (frame && frame.dataset.flashId === message.gameKey) {
        state.flashFrameGames.set(event.source, message.gameKey);
      } else if (state.flashFrameGames.get(event.source) !== message.gameKey) {
        return;
      }
      const storage = copyFlashStorage(message.storage);
      const data = ensureSaveData();
      data.flashStorage[message.gameKey] = storage;
      const auto = data.saves.autosave;
      if (auto && auto.gameKey === message.gameKey) auto.flashStorage = storage;
      persistConfig(false);
      renderBookmarksList();
    });
  }

  async function newSave() {
    const active = getActiveTab();
    const page = state.currentRoute && state.currentRoute.mode === 'PAGE' ? state.currentPageData : null;
    const pageId = page && (page.page_id || page.pageId);
    const activeFlash = document.querySelector('iframe.ruffle-frame');
    const gameKey = pageId
      ? ((activeFlash || {}).dataset || {}).flashId || getFlashGameKey(pageId, page)
      : '';
    if (activeFlash && activeFlash.contentWindow) {
      try {
        activeFlash.contentWindow.postMessage({ type: 'RRWR_RUFFLE_STORAGE_REQUEST' }, '*');
        await new Promise((resolve) => setTimeout(resolve, 60));
      } catch (_) {}
    }
    const id = `save_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const data = ensureSaveData();
    const saveObj = {
      id: id,
      kind: 'manual',
      name: active.title || 'Saved Page',
      url: active.url || '/',
      pageId: pageId ? String(pageId) : '',
      gameKey,
      date: new Date().toLocaleString(),
      ...(gameKey ? { flashStorage: copyFlashStorage(data.flashStorage[gameKey]) } : {})
    };

    data.saves[id] = saveObj;
    data.saveList.unshift(id);

    renderBookmarksList();
    if (window.RRWRAnimations) {
      window.RRWRAnimations.animateBookmarkItemEnter(document.getElementById('bookmarks-list'));
    }
    await persistConfig(true);
  }

  async function deleteSave(id) {
    if (id === 'autosave') return;
    const sd = ensureSaveData();

    delete sd.saves[id];
    const idx = sd.saveList.indexOf(id);
    if (idx !== -1) sd.saveList.splice(idx, 1);

    persistConfig();

    const listEl = typeof document !== 'undefined' ? document.getElementById('bookmarks-list') : null;
    const rowEl = listEl
      ? Array.from(listEl.querySelectorAll('.bookmarkItem')).find((item) => item.getAttribute('data-save-id') === id)
      : null;

    if (rowEl && window.RRWRAnimations) {
      await window.RRWRAnimations.animateBookmarkItemExit(rowEl);
    }

    renderBookmarksList();
  }

  function renderBookmarksList() {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('bookmarks-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    const sd = ensureSaveData();
    if (!sd.saveList.length) {
      listEl.innerHTML = '<p style="padding: 12px; font-size: 11px; color: var(--font-default); opacity: 0.7;">No saved bookmarks yet.</p>';
      return;
    }

    for (const id of sd.saveList) {
      const item = sd.saves[id];
      if (!item) continue;

      const card = document.createElement('div');
      const isAuto = id === 'autosave' || item.kind === 'autosave';
      card.className = 'bookmarkItem';
      card.setAttribute('data-save-id', id);
      card.innerHTML = `
        <div class="bookmarkItemHeader">
          <span class="bookmarkName">${escapeHtml(item.name || item.title || (isAuto ? 'Autosave' : 'Saved Page'))}</span>
          <div class="bookmarkBtnGroup">
            <button class="primaryActionBtn bookmarkSmallBtn loadSaveBtn" data-id="${escapeHtml(id)}">Load</button>
            ${isAuto ? '' : `<button class="navBtn bookmarkSmallBtn deleteSaveBtn" data-id="${escapeHtml(id)}" aria-label="Delete">&times;</button>`}
          </div>
        </div>
        <div class="bookmarkUrl">${escapeHtml(item.url || '/')} • <span>${escapeHtml(item.date || '')}</span></div>
      `;

      card.querySelector('.loadSaveBtn').addEventListener('click', () => {
        const storage = item.flashStorage || {};
        state.flashSaveRestore = item.gameKey && Object.prototype.hasOwnProperty.call(item, 'flashStorage')
          ? { gameKey: item.gameKey, storage: copyFlashStorage(storage) }
          : null;
        pushUrl(item.url || '/', true);
        toggleBookmarksDrawer(false);
      });

      const deleteButton = card.querySelector('.deleteSaveBtn');
      if (deleteButton) deleteButton.addEventListener('click', () => deleteSave(id));

      listEl.appendChild(card);
    }
  }

  /* ==========================================================================
     10. System & Utility Pages (Homepage, Log, Map, Search, Credits)
     ========================================================================== */

  function renderModRowItem({ href, thumbsrc, title, date, htmlContent, description }) {
    const descHtml = htmlContent !== undefined
      ? htmlContent
      : (description ? `<p>${rewriteHtmlContent(String(description))}</p>` : "");
    const thumbHtml = thumbsrc
      ? `<a class="thumbnail" href="${href || "/"}"><img class="mediaembed" src="${resolveAssetUrl(thumbsrc)}" alt="${escapeHtml(title || "")}" /></a>`
      : "";
    return `
      <div class="rowItem homeRowItem">
        ${thumbHtml}
        <div class="description">
          <h2><a href="${href || "/"}">${title || ""}</a></h2>
          ${date ? `<p class="date">${date}</p>` : ""}
          ${descHtml}
        </div>
      </div>
    `;
  }

  async function renderStartView(container) {
    applyTheme(computeActiveTheme(null, state.config.settings));
    document.title = "RRWR - Rust-Ruffle WebComic Reader";

    const pageContainer = document.getElementById("page-container");
    if (pageContainer) {
      pageContainer.classList.add("homepage");
    }

    if (state.appInfo && state.appInfo.asset_pack_ready === false) {
      renderAssetSetupView(container);
      return;
    }

    await renderTreeBrowser(container, null);
  }

  function buildTreeBreadcrumbs(nodeId) {
    const crumbs = [{ label: "Home", route: "/" }];
    if (!nodeId) return crumbs;

    if (nodeId.startsWith("story:")) {
      const rest = nodeId.slice("story:".length);
      const colonIdx = rest.indexOf(":");
      const col = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
      const colLabel = col.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
      if (colonIdx === -1) {
        crumbs.push({ label: colLabel, route: null });
      } else {
        crumbs.push({ label: colLabel, route: `/browse/${encodeURIComponent("story:" + col)}` });
        const sub = rest.slice(colonIdx + 1);
        if (sub.startsWith("media:")) {
          const mediaBody = sub.slice("media:".length);
          const rangeIdx = mediaBody.indexOf(":range:");
          const encodedRoot = rangeIdx === -1 ? mediaBody : mediaBody.slice(0, rangeIdx);
          let rootLabel = encodedRoot;
          try { rootLabel = decodeURIComponent(encodedRoot); } catch (_) {}
          if (rangeIdx === -1) {
            crumbs.push({ label: rootLabel, route: null });
          } else {
            crumbs.push({ label: rootLabel, route: `/browse/${encodeURIComponent(`story:${col}:media:${encodedRoot}`)}` });
            const parts = mediaBody.slice(rangeIdx + ":range:".length).split(":");
            crumbs.push({ label: `Items ${parts[0]}..${parts[1]}`, route: null });
          }
        } else if (sub.startsWith("range:")) {
          const parts = sub.slice("range:".length).split(":");
          crumbs.push({ label: `Items ${parts[0]}..${parts[1]}`, route: null });
        } else if (sub.startsWith("meta:")) {
          const parts = sub.slice("meta:".length).split(":");
          let val = parts[1] || "";
          try { val = decodeURIComponent(val); } catch (_) {}
          crumbs.push({ label: `${parts[0]}: ${val}`, route: null });
        } else if (sub.startsWith("story:")) {
          crumbs.push({ label: sub.slice("story:".length), route: null });
        } else {
          crumbs.push({ label: sub, route: null });
        }
      }
      return crumbs;
    }

    if (nodeId === "music:root") {
      crumbs.push({ label: "Music", route: null });
      return crumbs;
    }
    if (nodeId.startsWith("music:album:")) {
      crumbs.push({ label: "Music", route: `/browse/${encodeURIComponent("music:root")}` });
      crumbs.push({ label: nodeId.slice("music:album:".length), route: null });
      return crumbs;
    }

    if (nodeId.startsWith("vfs:") || nodeId.startsWith("json:")) {
      const isJson = nodeId.startsWith("json:");
      const raw = isJson ? nodeId.slice("json:".length) : nodeId.slice("vfs:".length);
      const [vfsPart, pointer] = raw.split("#");
      const segs = vfsPart.split(":");
      let scope = segs[0];
      let rel = segs.slice(1).join(":");
      let scopeLabel = scope === "base" ? "Asset Files" : (scope === "custom" ? "Custom Assets" : scope);
      if (scope === "mod" && segs.length >= 2) {
        scope = `mod:${segs[1]}`;
        rel = segs.slice(2).join(":");
        scopeLabel = `Mod: ${segs[1]}`;
      }
      const rootId = `vfs:${scope}:`;
      if (!rel && !pointer) {
        crumbs.push({ label: scopeLabel, route: null });
      } else {
        crumbs.push({ label: scopeLabel, route: `/browse/${encodeURIComponent(rootId)}` });
        const pathParts = rel ? rel.split("/").filter(Boolean) : [];
        let acc = "";
        for (let i = 0; i < pathParts.length; i++) {
          acc = acc ? `${acc}/${pathParts[i]}` : pathParts[i];
          const isLastPath = i === pathParts.length - 1 && !pointer;
          const segId = (i === pathParts.length - 1 && isJson)
            ? `json:${scope}:${acc}`
            : `vfs:${scope}:${acc}`;
          crumbs.push({
            label: pathParts[i],
            route: isLastPath ? null : `/browse/${encodeURIComponent(segId)}`
          });
        }
        if (pointer) {
          const ptrParts = pointer.split("/").filter(Boolean);
          let ptrAcc = "";
          for (let i = 0; i < ptrParts.length; i++) {
            ptrAcc += "/" + ptrParts[i];
            const isLast = i === ptrParts.length - 1;
            const decoded = ptrParts[i].replace(/~1/g, "/").replace(/~0/g, "~");
            crumbs.push({
              label: decoded,
              route: isLast ? null : `/browse/${encodeURIComponent(`json:${scope}:${rel}#${ptrAcc}`)}`
            });
          }
        }
      }
      return crumbs;
    }

    crumbs.push({ label: nodeId, route: null });
    return crumbs;
  }

  function buildMonogramInfo(label, kind) {
    const clean = String(label || kind || "?").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    let glyph = "?";
    if (words.length >= 2) {
      glyph = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      glyph = words[0].slice(0, 2).toUpperCase();
    }
    let hash = 0;
    const seed = String(label || "node");
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    const theme = (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme')) || 'default';
    const isDark = theme === 'dark' || theme === 'retro' || theme === 'high-contrast' || theme === 'neon' || theme === 'wide' || theme === 'finale' || theme === 'mono';
    return {
      glyph,
      bg: `hsla(${hue}, 42%, 50%, 0.18)`,
      fg: isDark ? `hsl(${hue}, 70%, 74%)` : `hsl(${hue}, 46%, 32%)`
    };
  }

  async function renderTreeBrowser(container, nodeId = null) {
    applyTheme(computeActiveTheme(null, state.config.settings));
    const initialQuery = state.treeSearchQuery || "";
    const readingProgress = state.config?.settings?.readingProgress || {};
    const currentProgress = readingProgress.current;
    const hasProgress = !nodeId && Boolean(currentProgress && String(currentProgress).trim() !== "");
    const crumbs = buildTreeBreadcrumbs(nodeId);
    const breadcrumbHtml = nodeId ? `
      <nav class="treeBreadcrumb" aria-label="Breadcrumb">
        ${crumbs.map((c, idx) => {
          const sep = idx > 0 ? `<span class="treeBreadcrumbSep">/</span>` : "";
          if (c.route) {
            return `${sep}<a href="${escapeHtml(c.route)}" class="treeBreadcrumbLink">${escapeHtml(c.label)}</a>`;
          }
          return `${sep}<span class="treeBreadcrumbCurrent">${escapeHtml(c.label)}</span>`;
        }).join("")}
      </nav>
    ` : "";

    container.innerHTML = `
      <div class="treeBrowserContainer">
        ${hasProgress ? `
          <div class="treeResumeBar">
            <span class="treeNodeLabel">Continue where you left off</span>
            <a href="/page/${encodeURIComponent(String(currentProgress))}" id="resume-reading-btn" class="primaryActionBtn" style="text-decoration: none;">Resume Page ${escapeHtml(String(currentProgress))}</a>
          </div>
        ` : ""}
        <div class="card treeBrowserCard">
          <div class="cardContent" style="padding: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
              <h2 style="margin: 0; font-family: \"Courier Prime\", \"Courier New\", monospace; font-size: 18px;">ARCHIVE BROWSER</h2>
              <span id="tree-browser-count" class="modGroupCount">Loading...</span>
            </div>
            <form id="tree-search-form" class="treeBrowserControls">
              <input id="tree-search-input" class="addressInput" type="text" value="${escapeHtml(initialQuery)}" placeholder="Search pages, albums, tracks, or files..." />
              <button type="submit" class="primaryActionBtn">Search</button>
              <button type="button" id="tree-search-clear" class="treeOpenBtn">Clear</button>
            </form>
            <div id="tree-browser-status" class="treeBrowserStatus">Inspecting loaded archive structures...</div>
          </div>
        </div>
        ${breadcrumbHtml}
        <div id="tree-asset-preview" class="treeAssetPreview" style="display: none;"></div>
        <div id="tree-browser-root" class="treeCardGrid"></div>
        <div id="tree-load-more-wrap" class="treeLoadMoreWrap"></div>
      </div>
    `;

    bindInternalLinks(container);

    const rootEl = container.querySelector("#tree-browser-root");
    const statusEl = container.querySelector("#tree-browser-status");
    const countEl = container.querySelector("#tree-browser-count");
    const previewEl = container.querySelector("#tree-asset-preview");
    const loadMoreWrap = container.querySelector("#tree-load-more-wrap");
    const searchForm = container.querySelector("#tree-search-form");
    const searchInput = container.querySelector("#tree-search-input");
    const clearBtn = container.querySelector("#tree-search-clear");

    function resolvePreviewUrl(assetUrl) {
      if (!assetUrl) return "";
      if (assetUrl.startsWith("http://") || assetUrl.startsWith("https://")) return assetUrl;
      return `${state.assetBase}${assetUrl.startsWith("/") ? "" : "/"}${assetUrl}`;
    }

    function openAssetPreview(node) {
      if (!previewEl || !node || !node.assetUrl) return;
      const fullUrl = resolvePreviewUrl(node.assetUrl);
      const lower = node.label.toLowerCase();
      let mediaHtml = "";
      if (/\.(gif|png|jpe?g|webp|svg|bmp|ico)$/.test(lower)) {
        mediaHtml = `<img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(node.label)}" />`;
      } else if (/\.(mp3|ogg|wav|flac|m4a)$/.test(lower)) {
        mediaHtml = `<audio controls src="${escapeHtml(fullUrl)}"></audio>`;
      } else if (/\.(mp4|webm|ogv)$/.test(lower)) {
        mediaHtml = `<video controls src="${escapeHtml(fullUrl)}"></video>`;
      } else {
        mediaHtml = `<iframe src="${escapeHtml(fullUrl)}" style="width: 100%; height: 280px; border: 1px solid var(--card-border, #cccccc); background: #fff;"></iframe>`;
      }
      previewEl.style.display = "block";
      previewEl.innerHTML = `
        <div class="treeAssetPreviewHeader">
          <span class="treeNodeLabel">${escapeHtml(node.label)}</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <a href="${escapeHtml(fullUrl)}" target="_blank" rel="noopener noreferrer" class="treeOpenBtn">Open Raw</a>
            <button type="button" id="tree-preview-close" class="treeOpenBtn">Close</button>
          </div>
        </div>
        <div class="treeAssetPreviewMedia">${mediaHtml}</div>
      `;
      const closeBtn = previewEl.querySelector("#tree-preview-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          previewEl.style.display = "none";
          previewEl.innerHTML = "";
        });
      }
    }

    function bindCardRoute(cardEl, routePath) {
      cardEl.setAttribute("href", routePath);
      cardEl.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          newTab(routePath, false, false);
          return;
        }
        if (e.button === 0) {
          e.preventDefault();
          pushUrl(routePath);
        }
      });
      cardEl.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          newTab(routePath, false, false);
        }
      });
    }

    function createDrillCard(node) {
      const kind = String(node.kind || "FILE").toUpperCase();
      const hasChildren = Boolean(node.hasChildren);
      const targetRoute = hasChildren
        ? `/browse/${encodeURIComponent(node.id)}`
        : (node.route || null);

      const card = document.createElement(targetRoute ? "a" : "button");
      card.className = "treeDrillCard";
      card.dataset.nodeId = node.id;
      if (!targetRoute) {
        card.type = "button";
        card.style.textAlign = "left";
      }

      const mono = buildMonogramInfo(node.label, kind);
      const iconApi = root.RRWRGenericIcons;
      const iconName = iconApi ? iconApi.resolveNodeIcon(node) : null;
      const bigIconSvg = iconApi ? iconApi.getIconSvg(iconName, 44, "treeMonogramSvg") : "";
      const smallIconSvg = iconApi ? iconApi.getIconSvg(iconName, 15, "treeCardIconSvg") : "";
      const previewUrl = node.previewImage ? resolvePreviewUrl(node.previewImage) : "";

      const media = document.createElement("div");
      media.className = "treeDrillCardMedia";

      if (previewUrl) {
        const img = document.createElement("img");
        img.className = "treeDrillCardThumb";
        img.src = previewUrl;
        img.alt = node.label || node.id;
        img.loading = "lazy";
        img.decoding = "async";
        img.onerror = function () {
          this.style.display = "none";
          if (this.nextElementSibling) {
            this.nextElementSibling.style.display = "flex";
          }
        };
        media.appendChild(img);
      }

      const monogram = document.createElement("div");
      monogram.className = "treeMonogram";
      monogram.style.backgroundColor = mono.bg;
      monogram.style.color = mono.fg;
      if (previewUrl) {
        monogram.style.display = "none";
      }
      monogram.innerHTML = bigIconSvg
        ? `${bigIconSvg}<span class="treeMonogramKind">${escapeHtml(kind)}</span>`
        : `<span class="treeMonogramGlyph">${escapeHtml(mono.glyph)}</span><span class="treeMonogramKind">${escapeHtml(kind)}</span>`;
      media.appendChild(monogram);
      card.appendChild(media);

      const body = document.createElement("div");
      body.className = "treeDrillCardBody";

      const meta = document.createElement("div");
      meta.className = "treeDrillCardMeta";
      const metaLeft = document.createElement("div");
      metaLeft.className = "treeDrillCardMetaLeft";
      if (smallIconSvg) {
        metaLeft.insertAdjacentHTML("beforeend", smallIconSvg);
      }
      const badge = document.createElement("span");
      badge.className = `treeKindBadge treeKindBadge--${kind}`;
      badge.textContent = kind;
      metaLeft.appendChild(badge);
      meta.appendChild(metaLeft);
      if (typeof node.count === "number") {
        const cnt = document.createElement("span");
        cnt.className = "modGroupCount";
        cnt.textContent = String(node.count);
        meta.appendChild(cnt);
      }
      body.appendChild(meta);

      const title = document.createElement("div");
      title.className = "treeDrillCardTitle";
      title.textContent = node.label || node.id;
      body.appendChild(title);

      if (node.subtitle) {
        const sub = document.createElement("div");
        sub.className = "treeDrillCardSub";
        sub.textContent = node.subtitle;
        body.appendChild(sub);
      }

      card.appendChild(body);

      if (targetRoute) {
        bindCardRoute(card, targetRoute);
      } else if (node.assetUrl) {
        card.addEventListener("click", () => openAssetPreview(node));
      }

      return card;
    }

    async function loadLevel(offset = 0, append = false) {
      if (!append) {
        rootEl.innerHTML = "";
        loadMoreWrap.innerHTML = "";
        statusEl.textContent = nodeId ? "Loading branch..." : "Loading archive roots...";
      }
      try {
        if (!nodeId) {
          const roots = await ipcInvoke("get_archive_tree_roots");
          const list = Array.isArray(roots) ? roots : [];
          countEl.textContent = `${list.length} roots`;
          statusEl.textContent = list.length > 0
            ? "Select any collection or directory card to explore."
            : "No archive collections or asset directories found.";
          for (const item of list) {
            rootEl.appendChild(createDrillCard(item));
          }
          return;
        }

        const resp = await ipcInvoke("get_archive_tree_children", {
          nodeId,
          offset,
          limit: 60
        });
        const items = Array.isArray(resp && resp.items) ? resp.items : [];
        const total = typeof resp?.total === "number" ? resp.total : items.length;
        countEl.textContent = `${total} items`;
        statusEl.textContent = items.length > 0 || append
          ? `Showing ${Math.min(offset + items.length, total)} of ${total} items.`
          : "This branch is empty.";

        for (const item of items) {
          rootEl.appendChild(createDrillCard(item));
        }

        loadMoreWrap.innerHTML = "";
        if (resp && resp.hasMore) {
          const nextOffset = offset + items.length;
          const moreBtn = document.createElement("button");
          moreBtn.type = "button";
          moreBtn.className = "treeLoadMoreBtn";
          moreBtn.textContent = `Load more (${nextOffset} / ${total})...`;
          moreBtn.addEventListener("click", () => {
            moreBtn.disabled = true;
            moreBtn.textContent = "Loading...";
            loadLevel(nextOffset, true);
          });
          loadMoreWrap.appendChild(moreBtn);
        }
      } catch (err) {
        statusEl.textContent = `Failed to load level: ${err && err.message ? err.message : err}`;
        countEl.textContent = "0";
      }
    }

    async function runSearch(queryText) {
      const q = (queryText || "").trim();
      state.treeSearchQuery = q;
      if (!q) {
        await loadLevel(0, false);
        return;
      }
      loadMoreWrap.innerHTML = "";
      statusEl.textContent = `Searching "${q}"...`;
      try {
        const resp = await ipcInvoke("search_archive_tree", { query: q, limit: 80 });
        const items = Array.isArray(resp && resp.items) ? resp.items : [];
        rootEl.innerHTML = "";
        countEl.textContent = `${items.length} matches`;
        statusEl.textContent = items.length > 0
          ? `Showing ${items.length} matching entries for "${q}".`
          : `No entries matched "${q}".`;
        for (const item of items) {
          rootEl.appendChild(createDrillCard(item));
        }
      } catch (err) {
        statusEl.textContent = `Search failed: ${err && err.message ? err.message : err}`;
      }
    }

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        runSearch(searchInput.value);
      }, 220);
    });

    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (searchTimer) clearTimeout(searchTimer);
      runSearch(searchInput.value);
    });

    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      if (searchTimer) clearTimeout(searchTimer);
      runSearch("");
    });

    if (initialQuery) {
      await runSearch(initialQuery);
    } else {
      await loadLevel(0, false);
    }
  }

  function renderSearch(container, initialQuery = '') {
    applyTheme(computeActiveTheme(null, state.config.settings));
    container.innerHTML = `
      <div class="systemPageContainer">
        <div class="searchBannerHeader">
          <h1 style="font-family: 'Courier Prime', 'Courier New', monospace; margin: 0;">SEARCH ARCHIVE</h1>
        </div>
        <div class="settingsSectionCard">
          <form id="story-search-form" style="display: flex; gap: 8px; margin-bottom: 12px;">
            <input id="story-search-input" class="addressInput" type="text" value="${initialQuery}" placeholder="Enter page number or keyword..." style="flex: 1;" />
            <button type="submit" class="primaryActionBtn">Search</button>
          </form>
          <div id="search-results" style="font-size: 12px;">
            ${initialQuery ? `<p>Results for "<strong>${initialQuery}</strong>":</p>` : '<p>Enter a page number to jump directly, or search story logs.</p>'}
          </div>
        </div>
      </div>
    `;

    const form = container.querySelector('#story-search-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = container.querySelector('#story-search-input').value.trim();
        if (/^\d+$/.test(q)) {
          pushUrl('/page/' + q);
        } else if (q) {
          pushUrl('/search/' + encodeURIComponent(q));
        }
      });
    }
  }

  function renderFancomicBbcode(rawText) {
    if (!rawText) return '';
    let html = String(rawText);
    html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, url) => {
      const resolved = resolveAssetUrl(url.trim());
      return `<img class="panel-media fancomicImg" src="${resolved}" alt="Fancomic Panel" />`;
    });
    html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$2</a>');
    html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$1</a>');
    html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<b>$1</b>');
    html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<i>$1</i>');
    html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
    html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');
    html = html.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
    html = html.replace(/\[size=([^\]]+)\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:$1px">$2</span>');
    html = html.replace(/\r?\n/g, '<br />');
    return rewriteHtmlContent(html);
  }

  function renderModBrowserPage(container, route) {
    applyTheme(computeActiveTheme(null, state.config.settings));
    const pageKey = route && route.pageKey ? String(route.pageKey) : '';
    const browserPages = (state.modBrowserPages && Object.keys(state.modBrowserPages).length > 0)
      ? state.modBrowserPages
      : (root.RRWRModHooks && root.RRWRModHooks.ModRuntime && typeof root.RRWRModHooks.ModRuntime.getState === 'function'
          ? (root.RRWRModHooks.ModRuntime.getState().browserPages || {})
          : {});
    const bp = browserPages[pageKey];
    if (!bp) {
      renderStartView(container);
      return;
    }
    const titleStr = typeof bp.title === 'function' ? bp.title() : String(bp.title || pageKey);
    document.title = `${titleStr} — RRWR`;
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.title = titleStr;
      renderTabBar();
    }
    const rawTemplate = String(bp.template || '');
    container.innerHTML = rewriteHtmlContent(rawTemplate);
    bindInternalLinks(container);
  }

  function renderFancomicView(container, route) {
    applyTheme(computeActiveTheme('default', state.config.settings));
    const fancomicStore = state.modFancomics || {};
    const storyId = route && route.storyId ? String(route.storyId) : null;
    const pageNum = (route && parseInt(route.pageNum, 10)) || 1;

    if (!storyId) {
      document.title = 'Fan Comics — RRWR';
      const storyIds = Object.keys(fancomicStore);
      container.innerHTML = `
        <div class="systemPageContainer fancomicIndexContainer">
          <h1 style="font-family: 'Courier Prime', 'Courier New', monospace;">FAN COMICS</h1>
          <div class="settingsSectionCard">
            ${storyIds.length === 0 ? '<p>No fancomics loaded by active mods.</p>' : ''}
            <div class="cardContent cardRows">
              ${storyIds.map((sid) => {
                const adv = fancomicStore[sid] || {};
                const title = adv.n || adv.name || adv.title || sid;
                const author = adv.a || adv.author || '';
                const thumb = adv.o || adv.icon || adv.thumbsrc || '';
                const desc = adv.r || adv.description || 'Community Fan Comic';
                return renderModRowItem({
                  href: `/page/fanventure:${encodeURIComponent(sid)}:1`,
                  thumbsrc: thumb,
                  title: escapeHtml(title),
                  date: author ? `by ${escapeHtml(author)}` : 'FANCOMIC',
                  htmlContent: `<p>${desc}</p>`
                });
              }).join('')}
            </div>
          </div>
        </div>
      `;
      bindInternalLinks(container);
      return;
    }

    const story = fancomicStore[storyId];
    if (!story || typeof story !== 'object') {
      document.title = 'Fancomic Not Found — RRWR';
      container.innerHTML = `
        <div class="systemPageContainer">
          <h1 class="pageTitle">Adventure Not Found</h1>
          <p class="storyParagraph" style="color: #ff3333;">Fancomic '${escapeHtml(storyId)}' could not be found in active mods.</p>
          <p><a href="/">&gt; Return to Archive Browser</a></p>
        </div>
      `;
      bindInternalLinks(container);
      return;
    }

    const pagesArr = Array.isArray(story.p) ? story.p : (Array.isArray(story.pages) ? story.pages : []);
    const pageObj = pagesArr[pageNum - 1] || (story.pages && story.pages[pageNum]) || null;
    const storyTitle = story.n || story.name || story.title || storyId;

    if (!pageObj) {
      document.title = `${storyTitle} — Page Not Found`;
      container.innerHTML = `
        <div class="systemPageContainer">
          <h1 class="pageTitle">${escapeHtml(storyTitle)}</h1>
          <p class="storyParagraph">Page ${pageNum} not found in this adventure.</p>
          <p><a href="/page/fanventure:${encodeURIComponent(storyId)}:1">&gt; Start Over</a></p>
        </div>
      `;
      bindInternalLinks(container);
      return;
    }

    const cmdTitle = pageObj.c || pageObj.command || pageObj.title || storyTitle;
    const rawBody = String(pageObj.b ?? pageObj.body ?? pageObj.content ?? '');
    const mediaList = Array.isArray(pageObj.media) ? pageObj.media : [];
    const nextPages = Array.isArray(pageObj.n)
      ? pageObj.n
      : (Array.isArray(pageObj.next) ? pageObj.next : (pageNum < pagesArr.length ? [pageNum + 1] : []));

    const fullTitle = `${cmdTitle} - ${storyTitle}`;
    document.title = fullTitle;
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.title = fullTitle;
      renderTabBar();
    }

    const mediaHtml = mediaList.map((m) => {
      const resolved = resolveAssetUrl(m);
      return `<img class="panel-media" src="${resolved}" alt="${escapeHtml(cmdTitle)}" />`;
    }).join('');

    // Support log delimiter and BBCode inside fancomic body
    let bodyRenderedHtml = '';
    const logMatch = rawBody.match(/^\|(.*?)\|\s*(?:<br\s*\/?>)?\s*/i);
    if (logMatch) {
      const logBody = rawBody.slice(logMatch[0].length);
      const isHidden = !state.config.settings.openLogs;
      const btnText = getLogButtonLabel(rawBody, isHidden);
      bodyRenderedHtml = `
        <div class="log">
          <button class="logButton fancomicLogBtn">${escapeHtml(btnText)}</button>
          <div class="logContent" style="display: ${isHidden ? 'none' : 'block'};">${renderFancomicBbcode(logBody)}</div>
        </div>
      `;
    } else if (rawBody.trim() !== '') {
      bodyRenderedHtml = `<div class="storyParagraph fancomicBody">${renderFancomicBbcode(rawBody)}</div>`;
    }

    const nextLinksHtml = nextPages.map((nextNum) => {
      const nIdx = parseInt(nextNum, 10);
      const targetPageObj = !isNaN(nIdx) ? (pagesArr[nIdx - 1] || (story.pages && story.pages[nIdx])) : null;
      const nextLabel = (targetPageObj && (targetPageObj.c || targetPageObj.command || targetPageObj.title)) || '==>';
      return `
        <div class="nextArrow">
          &gt; <a href="/page/fanventure:${encodeURIComponent(storyId)}:${encodeURIComponent(String(nextNum))}" class="nextArrowLink" data-fancomic-page="${escapeHtml(String(nextNum))}">${escapeHtml(nextLabel)}</a>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <h1 id="page-title" class="pageTitle">${escapeHtml(cmdTitle)}</h1>
      <div id="media-container" class="mediaContent">${mediaHtml}</div>
      <div id="text-container" class="textContent">${bodyRenderedHtml}</div>
      <div id="command-container" class="commandContent">${nextLinksHtml}</div>
      <div id="footer-nav" class="footerNav">
        <ul class="navOptions">
          ${pageNum > 1 ? `<li><a href="/page/fanventure:${encodeURIComponent(storyId)}:1" class="startOver">Start Over</a></li>` : ''}
          ${pageNum > 1 ? `<li><a href="/page/fanventure:${encodeURIComponent(storyId)}:${pageNum - 1}" class="goBack">Go Back</a></li>` : ''}
        </ul>
      </div>
    `;

    const logBtn = container.querySelector('.fancomicLogBtn');
    if (logBtn) {
      let hiddenState = !state.config.settings.openLogs;
      const contentDiv = container.querySelector('.logContent');
      logBtn.addEventListener('click', () => {
        hiddenState = !hiddenState;
        logBtn.textContent = getLogButtonLabel(rawBody, hiddenState);
        if (contentDiv && window.RRWRAnimations) {
          window.RRWRAnimations.animateCollapsible(contentDiv, !hiddenState, {
            category: 'uiMicro',
            displayMode: 'block',
            durationMs: 210
          });
        } else if (contentDiv) {
          contentDiv.style.display = hiddenState ? 'none' : 'block';
        }
      });
    }

    bindInternalLinks(container);
  }

  /* ==========================================================================
     11. Master Route Dispatcher (renderRoute)
     ========================================================================== */

  let routeRenderGeneration = 0;

  async function renderRoute(route, options = {}) {
    const renderGen = ++routeRenderGeneration;
    const perf = getPerf();
    const activeTab = getActiveTab();
    const routeUrl = (activeTab && activeTab.url) || (route && route.mode) || '/';
    const routeTok = perf ? perf.beginPhase('renderRoute', { mode: route && route.mode, route: routeUrl, alwaysLog: true }) : null;
    if (perf) {
      perf.setCurrentRoute(routeUrl);
      perf.startBurst(`renderRoute:${(route && route.mode) || 'UNKNOWN'}`, 1200, routeUrl);
    }

    state.currentRoute = route;
    if (typeof document === 'undefined') {
      if (perf) perf.endPhase(routeTok);
      return;
    }
    const pageContent = document.getElementById('page-content');
    if (!pageContent) {
      if (perf) perf.endPhase(routeTok);
      return;
    }

    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      if (route.mode === 'HOMEPAGE' || route.mode === 'BROWSE') {
        pageContainer.classList.add('homepage');
      } else {
        pageContainer.classList.remove('homepage');
      }
    }

    // Reset default styling (preserve flex column alignment from .pageContent)
    pageContent.style.display = '';
    const storyShellWasMounted = isStoryShellMounted(pageContent);

    // Clear running Flash animations and audio when navigating away from story pages
    if (route.mode !== 'PAGE') {
      storyRenderGeneration++;
      cleanupMediaSlot(document.getElementById('media-container'));
      pageContent.removeAttribute('data-pageid');
      delete pageContent.dataset.storyShell;
      delete pageContent._storyShell;
      const bannerContainer = document.getElementById('page-banner-container');
      patchBannerSlot(bannerContainer, null);

      // Update Discord Browsing Presence if enabled and sound test is not actively playing
      if (state.config && state.config.settings && state.config.settings.enableDiscordRpc) {
        if (!state.soundTest || !state.soundTest.playing) {
          let browsingTitle = 'Main Menu';
          switch (route.mode) {
            case 'HOMEPAGE': browsingTitle = 'Main Menu'; break;
            case 'SETTINGS': browsingTitle = 'Settings'; break;
            case 'HELP': browsingTitle = 'Help & FAQ'; break;
            case 'NEWS': browsingTitle = 'News & Updates'; break;
            case 'UNLOCK': browsingTitle = 'Unlockable Content'; break;
            case 'DECODE': browsingTitle = 'Decoding Tools'; break;
            case 'MAP': browsingTitle = 'Adventure Map'; break;
            case 'LOG': browsingTitle = 'Adventure Log'; break;
            case 'SEARCH': browsingTitle = 'Search'; break;
            case 'BROWSE': browsingTitle = 'Archive Tree'; break;
            case 'CREDITS': browsingTitle = 'Credits'; break;
            case 'EVENMORE': browsingTitle = 'More Adventures'; break;
            case 'MUSIC': browsingTitle = 'Sound Test'; break;
            default: browsingTitle = 'Browsing Collection'; break;
          }
          ipcInvoke('set_discord_presence', {
            mode: 'browsing',
            title: browsingTitle,
            details: 'Browsing Collection'
          }).catch(() => {});
        }
      }
    }

    if (route.mode !== 'PAGE') {
      const pageFrame = document.getElementById('page-frame');
      if (pageFrame) {
        pageFrame.classList.remove('widePageFrame', 'hscrollFrame', 'wideMediaFrame');
      }
    }

    switch (route.mode) {
      case 'HOMEPAGE':
        await renderStartView(pageContent);
        break;
      case 'SETTINGS':
        applyTheme(computeActiveTheme(null, state.config.settings));
        document.title = 'Settings — RRWR';
        if (perf) {
          await perf.measureAsync('renderSettingsView', () => renderSettingsView(pageContent), { route: routeUrl, alwaysLog: true });
        } else {
          await renderSettingsView(pageContent);
        }
        break;
      case 'MUSIC':
        applyTheme(computeActiveTheme(null, state.config.settings));
        document.title = 'Music — RRWR';
        if (route.view === 'discography') {
          await renderMusicDiscographyView(pageContent);
        } else if (route.view === 'tracks') {
          await renderMusicTracksView(pageContent);
        } else if (route.view === 'album') {
          await renderAlbumDetailView(pageContent, route.id);
        } else if (route.view === 'track') {
          await renderTrackDetailView(pageContent, route.id);
        } else {
          await renderMusicDiscographyView(pageContent);
        }
        break;
      case 'PAGE':
        if (perf) {
          await perf.measureAsync('renderPageView', () => renderStoryPage(route.pageId), { route: routeUrl, pageId: route.pageId, alwaysLog: true });
        } else {
          await renderStoryPage(route.pageId);
        }
        break;
      case 'FANCOMIC':
        renderFancomicView(pageContent, route);
        break;
      case 'BROWSER_PAGE':
        renderModBrowserPage(pageContent, route);
        break;
      case 'SEARCH':
        renderSearch(pageContent, route.query);
        break;
      case 'BROWSE':
        applyTheme(computeActiveTheme(null, state.config.settings));
        document.title = 'Browse Archive Tree — RRWR';
        await renderTreeBrowser(pageContent, route.nodeId || null);
        break;
      default:
        await renderStartView(pageContent);
        break;
    }

    if (renderGen !== routeRenderGeneration) {
      if (perf) perf.endPhase(routeTok, { stale: true });
      return;
    }

    if (window.RRWRAnimations) {
      const scrollTok = perf ? perf.beginPhase('restoreScrollState', { route: routeUrl }) : null;
      window.RRWRAnimations.restoreScrollState(getActiveTab(), {
        preserveScroll: Boolean(options && options.preserveScroll)
      });
      if (perf) perf.endPhase(scrollTok);
      if (options && options.transition) {
        window.RRWRAnimations.triggerPageTransition({
          isStoryPage: route.mode === 'PAGE',
          shellWasMounted: storyShellWasMounted
        });
      }
    }

    if (typeof window !== 'undefined' && window.RRWRDebugHud && typeof window.RRWRDebugHud.updateDisplay === 'function') {
      window.RRWRDebugHud.updateDisplay();
    }

    if (perf) {
      perf.endPhase(routeTok);
      perf.scheduleAudit(`route:${(route && route.mode) || 'UNKNOWN'}`, 150);
    }
  }

  /* ==========================================================================
     12. Chrome Event Wiring & Shortcuts
     ========================================================================== */

  function setupTooltips() {
    const tooltip = document.getElementById('url-tooltip');
    if (!tooltip) return;

    if (isAndroidPlatform() || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches)) {
      tooltip.classList.add('hidden');
      return;
    }

    document.addEventListener('mouseover', (e) => {
      const a = e.target.closest('a[href]');
      if (a && state.config.settings.urlTooltip) {
        tooltip.textContent = a.getAttribute('href');
        tooltip.classList.remove('hidden');
      }
    });

    document.addEventListener('mouseout', (e) => {
      const a = e.target.closest('a[href]');
      if (a) {
        tooltip.classList.add('hidden');
      }
    });

    document.addEventListener('touchstart', () => {
      tooltip.classList.add('hidden');
    }, { passive: true });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isInput = target instanceof Element && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable
      );
      const hasPrimaryModifier = e.ctrlKey || e.metaKey;

      if (hasPrimaryModifier && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        restoreClosedTab();
        return;
      }

      if (hasPrimaryModifier && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        refreshActivePage();
        return;
      }

      if (hasPrimaryModifier) {
        const digitMatch = e.code.match(/^Digit([0-9])$/) || e.key.match(/^([0-9])$/);
        if (digitMatch) {
          const digit = digitMatch[1];
          const tabs = state.config.tabData.tabList;
          const index = digit === '0' || digit === '9'
            ? tabs.length - 1
            : Number(digit) - 1;
          if (tabs[index]) {
            e.preventDefault();
            switchTab(tabs[index]);
          }
          return;
        }
      }

      if (hasPrimaryModifier && e.key.toLowerCase() === 't') {
        e.preventDefault();
        newTab('/');
        return;
      }

      if (hasPrimaryModifier && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTab();
        return;
      }

      if (hasPrimaryModifier && e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault();
        const tabData = state.config.tabData;
        const list = tabData.tabList;
        const curIdx = list.indexOf(state.activeTabKey);
        if (curIdx !== -1 && list.length > 1) {
          const delta = e.key === 'PageUp' ? -1 : 1;
          const targetIdx = curIdx + delta;
          if (targetIdx >= 0 && targetIdx < list.length) {
            const movedKey = list.splice(curIdx, 1)[0];
            list.splice(targetIdx, 0, movedKey);
            renderTabBar();
            persistConfig();
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        const drawer = document.getElementById('bookmarks-drawer');
        if (drawer && !drawer.classList.contains('hidden')) {
          toggleBookmarksDrawer(false);
          return;
        }
      }

      if (hasPrimaryModifier && e.key === 'Tab') {
        e.preventDefault();
        const tabData = state.config.tabData;
        const list = tabData.tabList;
        const curIdx = list.indexOf(state.activeTabKey);
        const nextIdx = e.shiftKey
          ? (curIdx - 1 + list.length) % list.length
          : (curIdx + 1) % list.length;
        switchTab(list[nextIdx]);
        return;
      }

      if (hasPrimaryModifier && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const input = document.getElementById('address-bar-input');
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        historyBack();
        return;
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        historyForward();
        return;
      }

      if (e.altKey) {
        const digitMatch = e.code.match(/^Digit([0-9])$/) || e.key.match(/^([0-9])$/);
        if (digitMatch) {
          const digit = digitMatch[1];
          const tabs = state.config.tabData.tabList;
          const index = digit === '0' || digit === '9'
            ? tabs.length - 1
            : Number(digit) - 1;
          if (tabs[index]) {
            e.preventDefault();
            switchTab(tabs[index]);
          }
          return;
        }
      }

      // Story Page Keyboard Shortcuts (when not in an input box or active interactive game)
      const hasInteractiveFrame = Boolean(document.querySelector('iframe.page-media-flash, iframe.html-game-frame'));
      const isIframeFocused = document.activeElement && document.activeElement.tagName === 'IFRAME';
      const isSwfNav = Array.isArray(state.currentPageData?.flag) && state.currentPageData.flag.includes('SWFNAV');

      if (!isInput && !hasInteractiveFrame && !isIframeFocused && !isSwfNav && state.currentRoute.mode === 'PAGE' && state.currentPageData) {
        if (e.key === 'ArrowLeft') {
          if (state.currentPageData.previous) {
            pushUrl(`/page/${state.currentPageData.previous}`);
          }
        } else if (e.key === 'ArrowRight') {
          const nextList = state.currentPageData.next;
          if (nextList && nextList.length > 0) {
            pushUrl(`/page/${nextList[0]}`);
          }
        } else if (e.key === ' ') {
          const logBox = document.querySelector('.log');
          if (logBox) {
            const btn = logBox.querySelector('.logButton');
            if (btn) {
              e.preventDefault();
              btn.click();
            }
          }
        }
      }
    });

    let horizontalDistance = 0;
    let gestureConsumed = false;
    let gestureTimer = 0;
    const viewport = document.getElementById('tab-viewport');
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.4) return;
        if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], video, audio')) return;
        const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1;
        horizontalDistance += e.deltaX * scale;
        clearTimeout(gestureTimer);
        gestureTimer = setTimeout(() => {
          horizontalDistance = 0;
          gestureConsumed = false;
        }, 180);
        if (!gestureConsumed && Math.abs(horizontalDistance) >= 75) {
          gestureConsumed = true;
          if (horizontalDistance > 0) historyBack();
          else historyForward();
        }
      }, { passive: true });

      let touchStart = null;
      viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        else touchStart = null;
      }, { passive: true });
      viewport.addEventListener('touchend', (e) => {
        if (!touchStart || !e.changedTouches.length) return;
        const dx = e.changedTouches[0].clientX - touchStart.x;
        const dy = e.changedTouches[0].clientY - touchStart.y;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          if (dx > 0) historyBack();
          else historyForward();
        }
        touchStart = null;
      }, { passive: true });
    }
  }

  function bindChromeEvents() {
    if (window.__rrwrChromeEventsBound) return;
    window.__rrwrChromeEventsBound = true;

    // Window control buttons (TitleBar)
    const minBtn = document.getElementById('minButton');
    if (minBtn) minBtn.addEventListener('click', () => ipcInvoke('win_minimize').catch(() => {}));

    const maxBtn = document.getElementById('maxButton');
    if (maxBtn) maxBtn.addEventListener('click', () => ipcInvoke('win_maximize').catch(() => {}));

    const closeBtn = document.getElementById('closeButton');
    if (closeBtn) closeBtn.addEventListener('click', () => ipcInvoke('win_close').catch(() => {}));

    // New tab button
    const newTabBtn = document.getElementById('new-tab-btn');
    if (newTabBtn) {
      newTabBtn.addEventListener('click', () => newTab('/'));
    }

    // Bookmarks drawer toggle buttons
    const bmToggleBtn = document.getElementById('bookmarks-toggle-btn');
    if (bmToggleBtn) {
      bmToggleBtn.addEventListener('click', () => toggleBookmarksDrawer());
    }

    const bmCloseBtn = document.getElementById('bookmarks-close-btn');
    if (bmCloseBtn) {
      bmCloseBtn.addEventListener('click', () => toggleBookmarksDrawer(false));
    }

    const navSaveLoadLink = document.getElementById('nav-saveload-link');
    if (navSaveLoadLink) {
      navSaveLoadLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleBookmarksDrawer();
      });
    }

    const newSaveBtn = document.getElementById('new-save-btn');
    if (newSaveBtn) {
      newSaveBtn.addEventListener('click', () => newSave());
    }

    const starBtn = document.getElementById('bookmark-star-btn');
    if (starBtn) {
      starBtn.addEventListener('click', () => {
        newSave();
        starBtn.classList.add('active');
        if (window.RRWRAnimations && window.RRWRAnimations.isCategoryEnabled('uiMicro')) {
          starBtn.classList.remove('star-pop-anim');
          void starBtn.offsetWidth;
          starBtn.classList.add('star-pop-anim');
          setTimeout(() => { starBtn.classList.remove('star-pop-anim'); }, 260);
        }
        setTimeout(() => { starBtn.classList.remove('active'); }, 1500);
      });
    }

    // Address Bar & Nav Buttons
    const backBtn = document.getElementById('nav-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => historyBack());

    const fwdBtn = document.getElementById('nav-forward-btn');
    if (fwdBtn) fwdBtn.addEventListener('click', () => historyForward());

    const reloadBtn = document.getElementById('nav-reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        refreshActivePage();
      });
    }

    // Home & Settings Buttons
    const homeBtn = document.getElementById('nav-home-btn');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => pushUrl('/'));
    }

    const settingsBtn = document.getElementById('nav-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => pushUrl('/settings'));
    }

    setupVolumeControls();

    // Address input & Jumpbox prompt
    const addressInput = document.getElementById('address-bar-input');
    const jumpboxLink = document.getElementById('jumpbox-link');
    if (jumpboxLink && addressInput) {
      jumpboxLink.addEventListener('click', () => {
        pushUrl(addressInput.value);
      });
    }

    if (addressInput) {
      addressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          pushUrl(addressInput.value);
        } else if (e.key === 'Escape') {
          const tab = getActiveTab();
          if (tab) addressInput.value = formatAddressUrl(tab.url);
        }
      });
    }

    // Bind top navigation banner links
    const navBanner = document.getElementById('reader-nav-banner');
    if (navBanner) {
      bindInternalLinks(navBanner);
    }

    // Global Delegated Link Handler (Guarantees ALL internal links & buttons work everywhere)
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#') || href.startsWith('javascript:')) return;

      if (
        anchor.classList.contains('modImagePreviewLink') ||
        anchor.hasAttribute('data-preview-img') ||
        /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(href)
      ) {
        e.preventDefault();
        const imgUrl = anchor.getAttribute('data-preview-img') || anchor.getAttribute('href');
        const title = anchor.getAttribute('data-preview-title') || anchor.textContent.trim() || 'Image Preview';
        if (imgUrl) openImageLightbox(imgUrl, title);
        return;
      }

      if (
        href.startsWith('/') ||
        href.startsWith('?s=')
      ) {
        e.preventDefault();
        window.logRrwr('info', `[RRWR-Nav] Global click intercepted: ${href}`);
        pushUrl(href);
      } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        e.preventDefault();
        ipcInvoke('open_url', { url: href }).catch(() => {
          try {
            window.open(href, '_blank');
          } catch (_) {}
        });
      }
    });

    // Browser History PopState (Supports browser Back/Forward buttons and gestures)
    window.addEventListener('popstate', (e) => {
      window.logRrwr('info', `[RRWR-Nav] popstate event triggered: url=${e.state && e.state.url} pathname=${window.location.pathname}`);
      if (e.state && e.state.url) {
        pushUrl(e.state.url, true, state.activeTabKey);
      } else if (window.location.pathname) {
        pushUrl(window.location.pathname, true, state.activeTabKey);
      } else {
        historyBack();
      }
    });

    // ActionScript getURL Flash navigation bridge
    window.__rrwrNavigate = function(url) { pushUrl(url); };
    window.addEventListener('rrwr-navigate', (e) => {
      if (e && e.detail && e.detail.url) {
        pushUrl(e.detail.url);
      }
    });

    // Touch Hygiene: instant blur after touch release to avoid sticky hover / focus styles
    document.addEventListener('touchend', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], .systemButton, .tab, .androidAssetSelectBtn');
      if (btn) {
        setTimeout(() => {
          if (document.activeElement === btn) {
            btn.blur();
          }
        }, 80);
      }
    }, { passive: true });
  }

  /* ==========================================================================
     13. Application Bootstrapper
     ========================================================================== */

  // Global Diagnostic Logger (Captures all events and streams them to Rust backend stdout)
  root.__rrwrLogs = root.__rrwrLogs || [];
  root.logRrwr = function(level, ...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
    root.__rrwrLogs.push(line);
    if (root.__rrwrLogs.length > 500) root.__rrwrLogs.shift();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rrwr_last_logs', JSON.stringify(root.__rrwrLogs.slice(-100)));
      }
    } catch (_) {}
    if (console && typeof console[level] === 'function') {
      console[level](...args);
    } else {
      console.log(`[${level}]`, ...args);
    }
    // Stream directly to Rust backend so it is captured in background tasks & terminal!
    ipcInvoke('client_log', { level, message: msg }).catch(() => {});
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', (e) => {
      root.logRrwr('error', `Uncaught Error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
    });

    window.addEventListener('unhandledrejection', (e) => {
      root.logRrwr('error', `Unhandled Promise Rejection: ${e.reason}`);
    });
  }

  async function initApp() {
    const animEngine = typeof window !== 'undefined' ? window.RRWRAnimations : null;
    try {
      if (animEngine) {
        animEngine.updateBootSplash(20, '> CONNECTING TO LOCAL SERVER...');
      }

      // 1. Handshake with Rust Backend
      try {
        const appInfo = await ipcInvoke('get_app_info');
        state.appInfo = appInfo;
        if (appInfo && appInfo.asset_port) {
          state.assetBase = `http://127.0.0.1:${appInfo.asset_port}`;
        }
      } catch (err) {
        console.warn('[RRWR-Init] Backend handshake note:', err);
      }

      if (animEngine) {
        animEngine.updateBootSplash(52, '> LOADING CONFIG & COMMUNITY MODS...');
      }

      // 2. Load Config, Active Mod Runtime & Tab State
      await loadConfig();
      const loadedSettings = (state.config && state.config.settings) || {};
      applyMasterVolume(
        loadedSettings.masterVolume ?? loadedSettings.master_volume ?? 1.0,
        loadedSettings.masterMuted ?? loadedSettings.master_muted ?? false,
        { persist: false }
      );
      await syncModRuntime({ reRender: false });

      if (animEngine) {
        animEngine.applySettings(state.config.settings);
        animEngine.updateBootSplash(82, '> INITIALIZING READER INTERFACE...');
      }

      // 3. Setup UI Chromes & Event Listeners
      renderTabBar();
      updateNavControls();
      updateQuickPtBrButton();
      setupSoundTestBar();
      setupTooltips();
      setupKeyboardShortcuts();
      bindChromeEvents();
      bindFlashSaveEvents();
      if (animEngine) {
        animEngine.bindViewportScrollTracker(getActiveTab);
      }

      // 4. Render Active Tab Initial URL or Deep-Linked Route (R1)
      const activeTab = getActiveTab();
      if (state.appInfo && state.appInfo.asset_pack_ready === false) {
        const pageContainer = document.querySelector('#page-container');
        if (pageContainer) renderAssetSetupView(pageContainer);
      } else if (activeTab) {
        let initialUrl = null;
        if (typeof window !== 'undefined' && window.location) {
          const pathname = window.location.pathname || '';
          const search = window.location.search || '';
          const hash = window.location.hash || '';

          if (hash && (hash.startsWith('#/') || hash.startsWith('#?'))) {
            initialUrl = hash.slice(1);
          } else if (pathname && pathname !== '/' && pathname !== '/index.html') {
            initialUrl = pathname + search;
          } else if (search && search.length > 1) {
            initialUrl = (pathname || '/') + search;
          }
        }

        // If no deep link in window.location, fall back to active tab's saved URL or '/'
        if (!initialUrl) {
          initialUrl = activeTab.url || '/';
        }

        activeTab.url = initialUrl;
        updateAddressBar(initialUrl);
        updateNavControls();

        // Synchronize browser history so refresh and back/forward behave correctly
        if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
          try {
            const formatted = formatAddressUrl(initialUrl);
            window.history.replaceState({ tabKey: state.activeTabKey || activeTab.key || '000', url: initialUrl }, '', formatted);
          } catch (_) {}
        }

        await renderRoute(resolveRoute(initialUrl));
      }

      // 5. Initialize Debug HUD Diagnostics if available
      if (typeof window !== 'undefined' && window.RRWRDebugHud && typeof window.RRWRDebugHud.init === 'function') {
        window.RRWRDebugHud.init();
      }
    } finally {
      if (animEngine) {
        animEngine.updateBootSplash(100, '> READER SESSION READY.');
        await animEngine.dismissBootSplash(state.config ? state.config.settings : null);
      }
    }
  }

  // Export public API
  const parseRoute = resolveRoute;
  const RRWRApp = {
    state,
    ipcInvoke,
    resolveAssetUrl,
    resolveRoute,
    parseRoute,
    renderRoute,
    applyTheme,
    getLogButtonLabel,
    newTab,
    closeTab,
    switchTab,
    pushUrl,
    historyBack,
    historyForward,
    toggleMod,
    applyPendingModChanges,
    discardPendingModChanges,
    syncModRuntime,
    saveModSetting,
    renderSettingsPage,
    renderAssetSetupView,
    renderFancomicView,
    loadTrackIntoSoundTest,
    initApp
  };

  root.RRWRApp = RRWRApp;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRApp;
  }

  // Auto-init on page load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initApp);
    } else {
      initApp();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
