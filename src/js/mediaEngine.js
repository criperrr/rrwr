/**
 * RRWR (Rust-Ruffle WebComic Reader)
 * Milestone 3: Multimedia Engine, Ruffle WASM Player & Frag IPC Audio Sync (F12, F14, F15, F16)
 *
 * Exports window.RRWRMediaEngine (browser global) and CommonJS module.exports (Node/test environment).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal State
  // ---------------------------------------------------------------------------

  /** @type {HTMLAudioElement[]} Active HTML5 Audio elements for HQ Flash soundtrack playback */
  let activeAudioTracks = [];

  /** @type {number[]} Base Flash-commanded volume per active audio track (0.0..1.0) */
  let activeAudioBaseVolumes = [];

  /** @type {HTMLVideoElement|null} Active HTML5 Video element */
  let activeVideo = null;

  /** @type {number} Global application master volume (0.0..1.0) */
  let masterVolume = 1.0;

  /** @type {boolean} Global application master mute state */
  let masterMuted = false;

  /** @type {HTMLIFrameElement[]} Active <iframe> elements to blank upon cleanup */
  let activeIframes = [];

  /** @type {number[]} Active setTimeout identifiers */
  let activeTimeouts = [];

  /** @type {number[]} Pending audio start/resume setTimeout identifiers */
  let pendingAudioTimers = [];

  /** @type {number[]} Active setInterval identifiers */
  let activeIntervals = [];

  /** @type {HTMLIFrameElement|null} The active Flash Ruffle iframe element */
  let activeIframeElement = null;

  /** @type {object|null} Resolved metadata for the current Flash animation */
  let currentFlashProps = null;

  /** @type {number} 0-based index of the last started audio track */
  let lastStartedAudio = 0;

  /** @type {object|null} Reference to current application context */
  let currentAppContext = null;

  /**
   * Drift-compensated viewport timer for dynamic Flash height expansions.
   */
  const viewportTimer = {
    interval: null,
    callback: null,
    start: 0,
    delay: 0
  };

  /**
   * Multi-step sequence state for interactive stage progressions.
   */
  const stageProgressState = {
    interval: null,
    timeout: null,
    count: 0,
    steps: []
  };

  // ---------------------------------------------------------------------------
  // Timer Management (Drift-Compensated)
  // ---------------------------------------------------------------------------

  function startViewportTimer(callback, delay) {
    clearViewportTimer();
    viewportTimer.callback = callback;
    viewportTimer.delay = delay;
    resumeViewportTimer();
  }

  function pauseViewportTimer() {
    if (viewportTimer.interval) {
      clearInterval(viewportTimer.interval);
      viewportTimer.interval = null;
      viewportTimer.delay -= Date.now() - viewportTimer.start;
    }
  }

  function resumeViewportTimer() {
    if (viewportTimer.callback && viewportTimer.delay > 0) {
      viewportTimer.start = Date.now();
      if (viewportTimer.interval) clearInterval(viewportTimer.interval);
      viewportTimer.interval = setInterval(() => {
        if (Date.now() - viewportTimer.start >= viewportTimer.delay) {
          clearViewportTimer();
          const cb = viewportTimer.callback;
          viewportTimer.callback = null;
          if (typeof cb === 'function') {
            cb();
          }
        }
      }, 20);
      activeIntervals.push(viewportTimer.interval);
    }
  }

  function clearViewportTimer() {
    if (viewportTimer.interval) {
      clearInterval(viewportTimer.interval);
      viewportTimer.interval = null;
    }
    viewportTimer.callback = null;
    viewportTimer.delay = 0;
  }

  // ---------------------------------------------------------------------------
  // Memory Hygiene & Media Cleanup (Memory RSS < 150MB SLA)
  // ---------------------------------------------------------------------------

  /**
   * Stops and tears down active HTML5 <audio> instances, removes video listeners,
   * clears all setTimeout and setInterval timers, and blanks any active <iframe>
   * before page navigation or tab close to guarantee WebKitGTK / Ruffle WASM
   * memory consumption stays strictly under the 150MB RSS budget.
   */
  function cleanupActiveMedia() {
    // 1. Pause and tear down all active audio tracks
    for (let i = 0; i < activeAudioTracks.length; i++) {
      try {
        const audio = activeAudioTracks[i];
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
          if (typeof audio.load === 'function') audio.load();
        }
      } catch (e) {
        // Ignore tear down errors
      }
    }
    activeAudioTracks = [];
    activeAudioBaseVolumes = [];

    // 2. Pause and tear down active video element if any
    if (activeVideo) {
      try {
        activeVideo.pause();
        activeVideo.removeAttribute('src');
        if (typeof activeVideo.load === 'function') activeVideo.load();
      } catch (e) {
        // Ignore tear down errors
      }
      activeVideo = null;
    }

    // 3. Clear all pending setTimeout handles
    clearPendingAudioTimers();
    for (let i = 0; i < activeTimeouts.length; i++) {
      clearTimeout(activeTimeouts[i]);
    }
    activeTimeouts = [];

    // 4. Clear all pending setInterval handles
    for (let i = 0; i < activeIntervals.length; i++) {
      clearInterval(activeIntervals[i]);
    }
    activeIntervals = [];

    // 5. Clear viewport height transition timer
    clearViewportTimer();

    // 6. Clear stage progression timer
    if (stageProgressState.interval) {
      clearInterval(stageProgressState.interval);
      stageProgressState.interval = null;
    }
    if (stageProgressState.timeout) {
      clearTimeout(stageProgressState.timeout);
      stageProgressState.timeout = null;
    }
    stageProgressState.count = 0;

    // 7. Blank and tear down active iframes to reclaim WebKitGTK WebProcess memory
    for (let i = 0; i < activeIframes.length; i++) {
      try {
        const iframe = activeIframes[i];
        if (iframe) {
          iframe.srcdoc = '';
          iframe.src = 'about:blank';
          if (iframe.contentWindow) {
            try {
              iframe.contentWindow.location.replace('about:blank');
            } catch (ignore) {}
          }
          if (typeof iframe.remove === 'function') {
            iframe.remove();
          }
        }
      } catch (e) {
        // Ignore cross-origin / destroyed iframe access errors
      }
    }
    activeIframes = [];
    activeIframeElement = null;
    currentFlashProps = null;
    lastStartedAudio = 0;
    if (typeof root !== 'undefined' && typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      root.dispatchEvent(new CustomEvent('rrwr:media-updated', { detail: { interactive: false } }));
    }
    emitPageAudioEvent({ active: false });
  }

  /**
   * Emits a page-audio lifecycle event for the persistent audio player bar.
   */
  function emitPageAudioEvent(detail) {
    if (typeof root !== 'undefined' && typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      root.dispatchEvent(new CustomEvent('rrwr:page-audio', { detail: detail || { active: false } }));
    }
  }

  // ---------------------------------------------------------------------------
  // Ruffle WASM Player Srcdoc Template Generator (F12, F14)
  // ---------------------------------------------------------------------------

  /**
   * Generates the self-hosted Ruffle WASM player srcdoc HTML string containing:
   * - window.RufflePlayer configuration (autoplay, unmuteOverlay, letterbox)
   * - Self-hosted Ruffle bundle script from Asset Pack V2
   * - Triple-hook Frag IPC bridge (onhashchange, navigation API, window.open & anchor clicks)
   * - Flash <object> element embedding the target SWF
   *
   * @param {object} options
   * @param {string} options.swfUrl - Full HTTP URL to the .swf asset
   * @param {number} [options.width=650] - Flash canvas width
   * @param {number} [options.height=450] - Flash canvas height
   * @param {string} [options.bgColor='#ffffff'] - Canvas background color
   * @param {string} [options.assetBase=''] - Base loopback server URL
   * @param {string} [options.flashId=''] - Canonical flash identifier
   * @returns {string} Fully self-contained HTML srcdoc string
   */
  function buildRuffleSrcdoc(options) {
    const opts = options || {};
    const swfUrl = opts.swfUrl || '';
    const width = opts.width || 650;
    const height = opts.height || 450;
    const bgColor = opts.bgColor || '#ffffff';
    const initialMasterVolume = clampVolume(opts.masterVolume !== undefined ? opts.masterVolume : masterVolume);
    const initialMasterMuted = Boolean(opts.masterMuted !== undefined ? opts.masterMuted : masterMuted);
    let cleanBase = (opts.assetBase || '').replace(/\/+$/, '');
    if (!cleanBase && typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('null')) {
      cleanBase = window.location.origin;
    }
    const gameKey = String(opts.gameKey || opts.flashId || swfUrl);
    const storageSeed = JSON.stringify(opts.flashStorage || {})
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    const gameKeyLiteral = JSON.stringify(gameKey)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    // Canonical self-hosted Ruffle bundle path (resolved by VFS fallback across imods/custom-assets)
    const ruffleJsUrl = cleanBase
      ? `${cleanBase}/assets/js/ruffle/ruffle.js`
      : '/assets/js/ruffle/ruffle.js';

    const ruffleDirUrl = ruffleJsUrl.replace(/\/[^\/]*$/, '/');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ruffle Player</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${bgColor};
      display: flex;
      justify-content: center;
      align-items: center;
    }
    #ruffle-container {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }
    ruffle-player, ruffle-embed, ruffle-object, object, embed {
      width: 100% !important;
      height: 100% !important;
      display: block;
    }
  </style>
  <script>
    (function () {
      var gameKey = ${gameKeyLiteral};
      var values = Object.assign(Object.create(null), ${storageSeed});

      function snapshot() {
        var result = Object.create(null);
        Object.keys(values).forEach(function (key) { result[key] = String(values[key]); });
        return result;
      }

      function notifyParent() {
        try {
          if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage({
              type: 'RRWR_RUFFLE_STORAGE',
              gameKey: gameKey,
              storage: snapshot()
            }, '*');
          }
        } catch (e) {}
      }

      try {
        window.addEventListener('message', function (event) {
          if (event.source === window.parent && event.data && event.data.type === 'RRWR_RUFFLE_STORAGE_REQUEST') {
            notifyParent();
          }
        });
        window.addEventListener('pagehide', notifyParent);
      } catch (_) {}

      var storageMethods = {
        getItem: function (key) {
          var k = String(key);
          return Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : null;
        },
        setItem: function (key, value) {
          values[String(key)] = String(value);
          notifyParent();
        },
        removeItem: function (key) {
          delete values[String(key)];
          notifyParent();
        },
        clear: function () {
          var keys = Object.keys(values);
          for (var i = 0; i < keys.length; i++) delete values[keys[i]];
          notifyParent();
        },
        key: function (index) {
          return Object.keys(values)[index] || null;
        }
      };

      var storageTarget = typeof window.Storage !== 'undefined'
        ? Object.create(window.Storage.prototype)
        : Object.create(null);

      var storageProxy = new Proxy(storageTarget, {
        get: function (target, prop) {
          if (typeof prop === 'string') {
            if (Object.prototype.hasOwnProperty.call(storageMethods, prop)) {
              return storageMethods[prop];
            }
            if (prop === 'length') {
              return Object.keys(values).length;
            }
            if (Object.prototype.hasOwnProperty.call(values, prop)) {
              return String(values[prop]);
            }
          }
          return target[prop];
        },
        set: function (target, prop, value) {
          if (typeof prop === 'string' && !Object.prototype.hasOwnProperty.call(storageMethods, prop) && prop !== 'length') {
            values[prop] = String(value);
            notifyParent();
            return true;
          }
          target[prop] = value;
          return true;
        },
        deleteProperty: function (target, prop) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(values, prop)) {
            delete values[prop];
            notifyParent();
            return true;
          }
          delete target[prop];
          return true;
        },
        has: function (target, prop) {
          if (typeof prop === 'string') {
            if (Object.prototype.hasOwnProperty.call(storageMethods, prop) || prop === 'length') return true;
            if (Object.prototype.hasOwnProperty.call(values, prop)) return true;
          }
          return prop in target;
        },
        ownKeys: function () {
          return Object.keys(values);
        },
        getOwnPropertyDescriptor: function (target, prop) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(values, prop)) {
            return {
              value: String(values[prop]),
              writable: true,
              enumerable: true,
              configurable: true
            };
          }
          return Object.getOwnPropertyDescriptor(target, prop);
        }
      });

      var overridden = false;
      try {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          enumerable: true,
          get: function () { return storageProxy; },
          set: function () {}
        });
        overridden = true;
      } catch (_) {
        try {
          window.localStorage = storageProxy;
          overridden = true;
        } catch (_) {}
      }

      if (!overridden) {
        try {
          var nativeStorage = window.localStorage;
          if (nativeStorage) {
            var storageProto = Object.getPrototypeOf(nativeStorage);
            if (storageProto) {
              storageProto.getItem = storageMethods.getItem;
              storageProto.setItem = storageMethods.setItem;
              storageProto.removeItem = storageMethods.removeItem;
              storageProto.clear = storageMethods.clear;
              storageProto.key = storageMethods.key;
            }
          }
        } catch (e) {
          console.warn('[RRWR-Ruffle] Save bridge fallback notice:', e);
        }
      }

      notifyParent();
    })();
  </script>
  <script>
    (function () {
      window.addEventListener('error', function (e) {
        try {
          if (window.parent && typeof window.parent.logRrwr === 'function') {
            window.parent.logRrwr('error', '[Ruffle-Iframe] ' + e.message + ' at ' + e.filename + ':' + e.lineno);
          }
        } catch (_) {}
      });
      window.addEventListener('unhandledrejection', function (e) {
        try {
          if (window.parent && typeof window.parent.logRrwr === 'function') {
            window.parent.logRrwr('error', '[Ruffle-Iframe Unhandled] ' + e.reason);
          }
        } catch (_) {}
      });
    })();
  </script>
  <script>
    (function () {
      var assetBase = ${JSON.stringify(cleanBase)};
      var swfUrlStr = ${JSON.stringify(swfUrl)};
      var swfDir = swfUrlStr.split('?')[0].split('#')[0].replace(/[^/]+$/, '');
      function rewriteSwfUrl(u) {
        if (!u || typeof u !== 'string') return u;
        if (/^https?:\\/\\//i.test(u) && (!assetBase || u.indexOf(assetBase) !== 0)) {
          var cleanUrl = u.split('?')[0].split('#')[0];
          var fileName = cleanUrl.slice(cleanUrl.lastIndexOf('/') + 1);
          if (fileName && swfDir) {
            return swfDir + fileName;
          }
        }
        return u;
      }

      var OrigRequest = window.Request;
      if (typeof OrigRequest === 'function') {
        window.Request = function (input, init) {
          if (typeof input === 'string') {
            input = rewriteSwfUrl(input);
          } else if (input && typeof input.url === 'string') {
            var rewritten = rewriteSwfUrl(input.url);
            if (rewritten !== input.url) {
              return new OrigRequest(rewritten, init || input);
            }
          }
          return new OrigRequest(input, init);
        };
        window.Request.prototype = OrigRequest.prototype;
      }

      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          if (typeof input === 'string') {
            input = rewriteSwfUrl(input);
          } else if (input && typeof input.url === 'string') {
            var newUrl = rewriteSwfUrl(input.url);
            if (newUrl !== input.url) {
              input = new (window.Request || OrigRequest)(newUrl, input);
            }
          }
          return origFetch.call(this, input, init);
        };
      }
      var origXhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string') {
          url = rewriteSwfUrl(url);
        }
        var args = Array.prototype.slice.call(arguments);
        args[1] = url;
        return origXhrOpen.apply(this, args);
      };
    })();
  </script>
  <script>
    (function () {
      var rrwrMasterVolume = ${JSON.stringify(initialMasterVolume)};
      var rrwrMasterMuted = ${JSON.stringify(initialMasterMuted)};

      function effectiveVol() {
        if (rrwrMasterMuted) return 0;
        var v = Number(rrwrMasterVolume);
        return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
      }

      function applyRuffleVolume() {
        var eff = effectiveVol();
        var rawVol = Number(rrwrMasterVolume);
        var pctVol = Math.round((Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 1) * 100);
        try {
          var media = document.querySelectorAll('audio, video');
          for (var j = 0; j < media.length; j++) {
            media[j].volume = eff;
            media[j].muted = rrwrMasterMuted;
          }
        } catch (_) {}
        try {
          var player = document.getElementById('player') || document.querySelector('ruffle-player');
          if (player) {
            if (player.volumeSettings) {
              player.volumeSettings.isMuted = Boolean(rrwrMasterMuted);
              player.volumeSettings.volume = pctVol;
            }
            if (player.shadowRoot) {
              var shadowMedia = player.shadowRoot.querySelectorAll('audio, video');
              for (var k = 0; k < shadowMedia.length; k++) {
                shadowMedia[k].volume = eff;
                shadowMedia[k].muted = rrwrMasterMuted;
              }
              var muteBox = player.shadowRoot.getElementById('mute-checkbox');
              var volSlider = player.shadowRoot.getElementById('volume-slider');
              var volText = player.shadowRoot.getElementById('volume-slider-text');
              if (muteBox) muteBox.checked = Boolean(rrwrMasterMuted);
              if (volSlider) {
                volSlider.disabled = Boolean(rrwrMasterMuted);
                volSlider.valueAsNumber = pctVol;
              }
              if (volText) volText.textContent = pctVol + '%';
            }
            if ('volume' in player) {
              player.volume = eff;
            }
            if ('muted' in player) {
              player.muted = rrwrMasterMuted;
            }
          }
        } catch (_) {}
      }

      window.__rrwrApplyRuffleVolume = applyRuffleVolume;

      function dispatchVirtualKey(eventType, keyInfo) {
        if (!keyInfo || (eventType !== 'keydown' && eventType !== 'keyup')) return;
        var player = document.getElementById('player') || document.querySelector('ruffle-player');
        if (eventType === 'keydown' && player && typeof player.focus === 'function') {
          try {
            if (document.activeElement !== player) {
              player.focus({ preventScroll: true });
            }
          } catch (_) {}
        }
        var opts = {
          key: String(keyInfo.key || ''),
          code: String(keyInfo.code || ''),
          keyCode: Number(keyInfo.keyCode || 0),
          which: Number(keyInfo.keyCode || 0),
          bubbles: true,
          cancelable: true,
          composed: true
        };
        var targets = [];
        if (player) {
          if (player.shadowRoot) {
            var canvas = player.shadowRoot.querySelector('canvas, [tabindex]') || player.shadowRoot.firstElementChild;
            if (canvas) targets.push(canvas);
          }
          targets.push(player);
        }
        if (document.activeElement && targets.indexOf(document.activeElement) === -1) {
          targets.push(document.activeElement);
        }
        targets.push(document);
        for (var i = 0; i < targets.length; i++) {
          var t = targets[i];
          if (!t || typeof t.dispatchEvent !== 'function') continue;
          try {
            var ev = new KeyboardEvent(eventType, opts);
            try {
              Object.defineProperty(ev, 'keyCode', { get: function () { return opts.keyCode; } });
              Object.defineProperty(ev, 'which', { get: function () { return opts.keyCode; } });
            } catch (_) {}
            t.dispatchEvent(ev);
            break;
          } catch (_) {}
        }
      }

      window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'RRWR_MASTER_VOLUME') {
          rrwrMasterVolume = Number.isFinite(Number(event.data.volume))
            ? Math.max(0, Math.min(1, Number(event.data.volume)))
            : rrwrMasterVolume;
          if (event.data.muted !== undefined) {
            rrwrMasterMuted = Boolean(event.data.muted);
          }
          applyRuffleVolume();
        } else if (event.data && event.data.type === 'RRWR_VIRTUAL_KEY') {
          dispatchVirtualKey(event.data.eventType, event.data.keyInfo);
        } else if (event.data && event.data.type === 'RRWR_RUFFLE_PLAYBACK') {
          try {
            var rp = document.getElementById('player') || document.querySelector('ruffle-player');
            var st = window.__rrwrRuffleState;
            if (st && event.data.seq !== undefined && Number.isFinite(Number(event.data.seq))) {
              st.lastPlaybackSeq = Math.max(st.lastPlaybackSeq || 0, Number(event.data.seq));
            }
            if (rp) {
              if (event.data.action === 'pause') {
                if (st) {
                  st.desiredPlaying = false;
                  st.pausedByUser = true;
                }
                if (typeof rp.pause === 'function') rp.pause();
                if (typeof window.__rrwrTickRuffleTime === 'function') window.__rrwrTickRuffleTime();
              } else if (event.data.action === 'play') {
                if (st) {
                  st.desiredPlaying = true;
                  st.pausedByUser = false;
                  st.lastTs = performance.now();
                  if (st.duration > 0 && st.elapsed >= st.duration && typeof window.__rrwrReloadRuffle === 'function') {
                    window.__rrwrReloadRuffle(true);
                    return;
                  }
                }
                if (st && st.contextMenuTimelinePaused && typeof window.__rrwrResumeContextTimeline === 'function') {
                  window.__rrwrResumeContextTimeline();
                }
                if (typeof rp.play === 'function') rp.play();
                if (typeof window.__rrwrTickRuffleTime === 'function') window.__rrwrTickRuffleTime();
              } else if (event.data.action === 'stop') {
                if (st) {
                  st.desiredPlaying = false;
                  st.pausedByUser = true;
                  st.contextMenuTimelinePaused = false;
                  st.elapsed = 0;
                }
                if (typeof window.__rrwrReloadRuffle === 'function') {
                  window.__rrwrReloadRuffle(false);
                } else {
                  if (typeof rp.pause === 'function') rp.pause();
                  if (typeof window.__rrwrTickRuffleTime === 'function') window.__rrwrTickRuffleTime();
                }
              }
            }
          } catch (_) {}
        }
      });
    })();
  </script>
  <script>
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      publicPath: ${JSON.stringify(ruffleDirUrl)},
      autoplay: "on",
      unmuteOverlay: "visible",
      letterbox: "on",
      warnOnUnsupportedContent: false,
      allowScriptAccess: true,
      splashScreen: false,
      scale: "showAll",
      quality: "high"
    };
  </script>
  <script src="${ruffleJsUrl}" onload="if (window.__rrwrBootRuffle) window.__rrwrBootRuffle();"></script>
  <script>
    (function () {
      function dispatchFragIpc(urlOrHash) {
        if (!urlOrHash || typeof urlOrHash !== 'string') return false;
        var idx = urlOrHash.indexOf('about:srcdoc#');
        var hashIdx = idx !== -1 ? idx + 'about:srcdoc#'.length : (urlOrHash.startsWith('#') ? 1 : -1);
        if (hashIdx === -1) {
          var altIdx = urlOrHash.indexOf('#');
          if (altIdx !== -1) hashIdx = altIdx + 1;
        }
        if (hashIdx === -1) return false;
        var cmdString = urlOrHash.slice(hashIdx);
        if (!cmdString) return false;

        var handled = false;
        try {
          if (window.parent && typeof window.parent.__rrwrInvokeFromFlash === 'function') {
            window.parent.__rrwrInvokeFromFlash(cmdString);
            handled = true;
          }
        } catch (e) {}

        try {
          if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage({ type: 'RRWR_FLASH_CMD', cmd: cmdString }, '*');
            window.parent.postMessage({ type: 'RRWR_FRAG_IPC', cmd: cmdString, hash: cmdString }, '*');
            handled = true;
          }
        } catch (e) {}

        return handled;
      }

      // 1. Hashchange listener (Standard ActionScript getURL("about:srcdoc#..."))
      window.addEventListener('hashchange', function () {
        if (location.hash && location.hash.length > 1) {
          var h = location.hash.slice(1);
          try {
            history.replaceState(null, '', location.pathname + location.search);
          } catch (e) {}
          dispatchFragIpc('#' + h);
        }
      });

      // 2. Modern Navigation API interceptor (Chromium/WebKit Navigation API)
      if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigate', function (event) {
          if (event.destination && event.destination.url && event.destination.url.indexOf('about:srcdoc#') !== -1) {
            event.preventDefault();
            dispatchFragIpc(event.destination.url);
          }
        });
      }

      // 3. window.open interceptor
      var origOpen = window.open;
      window.open = function (url, target, features) {
        if (typeof url === 'string') {
          if (url.indexOf('about:srcdoc#') !== -1) {
            dispatchFragIpc(url);
            return null;
          }
          if (window.parent && typeof window.parent.__rrwrInvokeFromFlash === 'function') {
            window.parent.__rrwrInvokeFromFlash('link?' + url);
            return null;
          }
          try {
            if (window.parent && typeof window.parent.postMessage === 'function') {
              window.parent.postMessage({ type: 'RRWR_FLASH_CMD', cmd: 'link?' + url }, '*');
              return null;
            }
          } catch (e) {}
        }
        return origOpen ? origOpen.call(window, url, target, features) : null;
      };

      // 4. Anchor click capture
      document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (a && a.href && a.href.indexOf('about:srcdoc#') !== -1) {
          e.preventDefault();
          dispatchFragIpc(a.href);
        }
      }, true);
    })();
  </script>
</head>
<body>
  <div id="ruffle-container"></div>
  <script>
    (function () {
      function bootRuffle() {
        var container = document.getElementById('ruffle-container');
        if (!container) return;
        if (container.querySelector('ruffle-player, #player')) return;

        if (!window.RufflePlayer || typeof window.RufflePlayer.newest !== 'function') {
          if (!window.__rrwrRuffleRetries) window.__rrwrRuffleRetries = 0;
          if (window.__rrwrRuffleRetries < 50) {
            window.__rrwrRuffleRetries++;
            setTimeout(bootRuffle, 100);
          }
          return;
        }

        var ruffle = window.RufflePlayer.newest();
        if (ruffle && typeof ruffle.createPlayer === 'function') {
          var player = ruffle.createPlayer();
          player.id = 'player';
          player.style.width = '100%';
          player.style.height = '100%';
          container.appendChild(player);

          var ruffleState = window.__rrwrRuffleState = {
            loaded: false,
            elapsed: 0,
            lastTs: 0,
            duration: 0,
            pausedByUser: false,
            desiredPlaying: true,
            wasPlaying: false,
            contextMenuTimelinePaused: false,
            loadSeq: 0,
            lastPlaybackSeq: 0,
            timer: 0,
            audioCheckTimer: 0
          };

          var lastContextMenuItems = [];
          var REWIND_MENU_RE = /^(rewind|rebobinar|retroceder|zurückspulen|rembobiner|riavvolgi|terugspoelen|spola tillbaka|geri sar|przewiń|derulează|rebobina|vissza|mundur|pretočiť|späť)$/i;
          var PLAY_MENU_RE = /^(play|reproduzir|reproducir|lire|abspielen|riproduci|afspelen|spela|oynat|spustit|spustiť|mainkan|odtwórz|lejátszás|reprodueix|redă)$/i;

          function readMovieDuration() {
            try {
              var meta = player.metadata || (typeof player.ruffle === 'function' ? player.ruffle().metadata : null);
              if (meta && Number(meta.numFrames) > 2 && Number(meta.frameRate) > 0) {
                return Number(meta.numFrames) / Number(meta.frameRate);
              }
            } catch (_) {}
            return 0;
          }

          function isPlayerActivelyPlaying() {
            if (!ruffleState.loaded) return false;
            var vmPlaying = null;
            try {
              if (player.instance && typeof player.instance.is_playing === 'function') {
                vmPlaying = Boolean(player.instance.is_playing());
              } else if (typeof player.isPlaying === 'boolean') {
                vmPlaying = Boolean(player.isPlaying);
              }
            } catch (_) {}
            if (vmPlaying !== null) {
              ruffleState.pausedByUser = !vmPlaying;
              if (!vmPlaying) return false;
              return !ruffleState.contextMenuTimelinePaused;
            }
            return !ruffleState.pausedByUser && !ruffleState.contextMenuTimelinePaused;
          }

          function tickRuffleTime(forcePlayingFlag) {
            if (!ruffleState.loaded) return;
            var now = performance.now();
            if (!ruffleState.duration) {
              ruffleState.duration = readMovieDuration();
            }
            var playing = (forcePlayingFlag !== undefined)
              ? Boolean(forcePlayingFlag)
              : isPlayerActivelyPlaying();

            if (ruffleState.wasPlaying && ruffleState.lastTs > 0) {
              var dt = Math.max(0, (now - ruffleState.lastTs) / 1000);
              ruffleState.elapsed += dt;
            }
            ruffleState.lastTs = now;
            ruffleState.wasPlaying = playing;

            if (ruffleState.duration > 0 && ruffleState.elapsed >= ruffleState.duration) {
              ruffleState.elapsed = ruffleState.duration;
            }
            try {
              if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                  type: 'RRWR_RUFFLE_TIME',
                  currentTime: ruffleState.elapsed,
                  duration: ruffleState.duration,
                  playing: playing,
                  ackSeq: ruffleState.lastPlaybackSeq
                }, '*');
              }
            } catch (_) {}
          }

          window.__rrwrTickRuffleTime = tickRuffleTime;

          function wakeAudioContextIfActive() {
            if (!isPlayerActivelyPlaying() && !(ruffleState.desiredPlaying && !ruffleState.loaded)) return;
            try {
              if (typeof player.unmuteOverlayClicked === 'function') player.unmuteOverlayClicked();
              if (player.instance && typeof player.instance.audio_context === 'function') {
                var ctx = player.instance.audio_context();
                if (ctx && typeof ctx.resume === 'function' && ctx.state === 'suspended') {
                  ctx.resume();
                }
              }
            } catch (_) {}
          }

          function wrapInstanceMethods() {
            try {
              var inst = player.instance;
              if (!inst || inst.__rrwrInstanceWrapped) return;
              inst.__rrwrInstanceWrapped = true;

              if (typeof inst.play === 'function') {
                var origInstPlay = inst.play;
                inst.play = function () {
                  var res = origInstPlay.apply(this, arguments);
                  ruffleState.pausedByUser = false;
                  ruffleState.desiredPlaying = true;
                  ruffleState.lastTs = performance.now();
                  if (typeof window.__rrwrApplyRuffleVolume === 'function') {
                    window.__rrwrApplyRuffleVolume();
                  }
                  setTimeout(tickRuffleTime, 0);
                  return res;
                };
              }

              if (typeof inst.pause === 'function') {
                var origInstPause = inst.pause;
                inst.pause = function () {
                  var now = performance.now();
                  if (ruffleState.loaded && ruffleState.wasPlaying && ruffleState.lastTs > 0) {
                    ruffleState.elapsed += Math.max(0, (now - ruffleState.lastTs) / 1000);
                    if (ruffleState.duration > 0 && ruffleState.elapsed > ruffleState.duration) {
                      ruffleState.elapsed = ruffleState.duration;
                    }
                  }
                  ruffleState.lastTs = now;
                  ruffleState.wasPlaying = false;
                  var res = origInstPause.apply(this, arguments);
                  ruffleState.pausedByUser = true;
                  ruffleState.desiredPlaying = false;
                  setTimeout(tickRuffleTime, 0);
                  return res;
                };
              }

              if (typeof inst.prepare_context_menu === 'function') {
                var origPrepareMenu = inst.prepare_context_menu;
                inst.prepare_context_menu = function () {
                  var items = origPrepareMenu.apply(this, arguments);
                  lastContextMenuItems = Array.isArray(items) ? items.slice() : [];
                  return items;
                };
              }

              if (typeof inst.run_context_menu_callback === 'function') {
                var origRunMenu = inst.run_context_menu_callback;
                inst.run_context_menu_callback = function (idx) {
                  var item = lastContextMenuItems && lastContextMenuItems[idx];
                  var caption = item && item.caption ? String(item.caption).trim() : '';
                  if (caption && REWIND_MENU_RE.test(caption)) {
                    ruffleState.elapsed = 0;
                    ruffleState.lastTs = performance.now();
                    ruffleState.contextMenuTimelinePaused = false;
                  } else if (caption && PLAY_MENU_RE.test(caption) && typeof item.checked === 'boolean' && readMovieDuration() > 0) {
                    ruffleState.contextMenuTimelinePaused = Boolean(item.checked);
                  }
                  var res = origRunMenu.apply(this, arguments);
                  setTimeout(tickRuffleTime, 0);
                  return res;
                };
              }
            } catch (_) {}
          }

          window.__rrwrResumeContextTimeline = function () {
            try {
              var inst = player.instance;
              if (!inst || typeof inst.prepare_context_menu !== 'function' || typeof inst.run_context_menu_callback !== 'function') {
                ruffleState.contextMenuTimelinePaused = false;
                return;
              }
              var items = inst.prepare_context_menu();
              if (Array.isArray(items)) {
                for (var i = 0; i < items.length; i++) {
                  var it = items[i];
                  var cap = it && it.caption ? String(it.caption).trim() : '';
                  if (cap && PLAY_MENU_RE.test(cap) && it.enabled !== false && it.checked === false) {
                    inst.run_context_menu_callback(i);
                    break;
                  }
                }
              }
              if (typeof inst.clear_custom_menu_items === 'function') {
                inst.clear_custom_menu_items();
              }
              ruffleState.contextMenuTimelinePaused = false;
            } catch (_) {
              ruffleState.contextMenuTimelinePaused = false;
            }
          };

          if (typeof player.play === 'function' && !player.__rrwrPlayWrapped) {
            var origPlayerPlay = player.play;
            player.play = function () {
              ruffleState.pausedByUser = false;
              ruffleState.desiredPlaying = true;
              ruffleState.lastTs = performance.now();
              var res = origPlayerPlay.apply(this, arguments);
              if (typeof window.__rrwrApplyRuffleVolume === 'function') {
                window.__rrwrApplyRuffleVolume();
              }
              wakeAudioContextIfActive();
              tickRuffleTime();
              return res;
            };
            player.__rrwrPlayWrapped = true;
          }

          if (typeof player.pause === 'function' && !player.__rrwrPauseWrapped) {
            var origPlayerPause = player.pause;
            player.pause = function () {
              var now = performance.now();
              if (ruffleState.loaded && ruffleState.wasPlaying && ruffleState.lastTs > 0) {
                ruffleState.elapsed += Math.max(0, (now - ruffleState.lastTs) / 1000);
                if (ruffleState.duration > 0 && ruffleState.elapsed > ruffleState.duration) {
                  ruffleState.elapsed = ruffleState.duration;
                }
              }
              ruffleState.lastTs = now;
              ruffleState.wasPlaying = false;
              ruffleState.pausedByUser = true;
              ruffleState.desiredPlaying = false;
              var res = origPlayerPause.apply(this, arguments);
              tickRuffleTime();
              return res;
            };
            player.__rrwrPauseWrapped = true;
          }

          function onRuffleMetadata() {
            wrapInstanceMethods();
            ruffleState.duration = readMovieDuration();
            if (typeof window.__rrwrApplyRuffleVolume === 'function') {
              window.__rrwrApplyRuffleVolume();
            }
            tickRuffleTime();
          }
          player.addEventListener('loadedmetadata', onRuffleMetadata);
          player.addEventListener('loadeddata', onRuffleMetadata);

          if (player.shadowRoot) {
            var onShadowInteraction = function () {
              setTimeout(function () {
                wrapInstanceMethods();
                tickRuffleTime();
              }, 0);
            };
            player.shadowRoot.addEventListener('click', onShadowInteraction, true);
            player.shadowRoot.addEventListener('pointerup', onShadowInteraction, true);
          }

          function loadSwfMovie(autoplayAfterLoad) {
            var mySeq = ++ruffleState.loadSeq;
            ruffleState.loaded = false;
            ruffleState.elapsed = 0;
            ruffleState.lastTs = 0;
            ruffleState.wasPlaying = false;
            ruffleState.contextMenuTimelinePaused = false;
            ruffleState.desiredPlaying = Boolean(autoplayAfterLoad);
            ruffleState.pausedByUser = !autoplayAfterLoad;
            if (typeof window.__rrwrApplyRuffleVolume === 'function') {
              window.__rrwrApplyRuffleVolume();
            }
            return player.load({
              url: ${JSON.stringify(swfUrl)},
              autoplay: autoplayAfterLoad ? 'on' : 'off',
              allowScriptAccess: true,
              parameters: ''
            }).then(function () {
              if (mySeq !== ruffleState.loadSeq) return;
              wrapInstanceMethods();
              ruffleState.loaded = true;
              ruffleState.duration = readMovieDuration();
              ruffleState.elapsed = 0;
              ruffleState.lastTs = performance.now();
              var shouldPlay = Boolean(ruffleState.desiredPlaying);
              if (!shouldPlay && typeof player.pause === 'function') {
                try { player.pause(); } catch (_) {}
              } else if (shouldPlay && typeof player.play === 'function' && !isPlayerActivelyPlaying()) {
                try { player.play(); } catch (_) {}
              }
              try {
                if (typeof player.focus === 'function') player.focus();
                window.focus();
                if (shouldPlay) {
                  wakeAudioContextIfActive();
                }
                if (typeof window.__rrwrApplyRuffleVolume === 'function') {
                  window.__rrwrApplyRuffleVolume();
                }
              } catch (_) {}
              tickRuffleTime();
              if (!ruffleState.timer) {
                ruffleState.timer = setInterval(function () {
                  tickRuffleTime();
                }, 200);
              }
            });
          }

          window.__rrwrReloadRuffle = loadSwfMovie;

          document.addEventListener('visibilitychange', function () {
            setTimeout(tickRuffleTime, 0);
          });

          window.addEventListener('pagehide', function () {
            if (ruffleState.timer) {
              clearInterval(ruffleState.timer);
              ruffleState.timer = 0;
            }
            if (ruffleState.audioCheckTimer) {
              clearInterval(ruffleState.audioCheckTimer);
              ruffleState.audioCheckTimer = 0;
            }
          });

          loadSwfMovie(true).catch(function (err) {
            console.error('[RRWR-Ruffle] player.load failed:', err);
            try {
              if (window.parent && typeof window.parent.logRrwr === 'function') {
                window.parent.logRrwr('error', '[Ruffle-Player-Load-Error] ' + err);
              }
            } catch (_) {}
          });

          // Focus player so interactive Flash games capture arrow keys
          setTimeout(function () {
            try {
              if (typeof player.focus === 'function') player.focus();
              window.focus();
            } catch (_) {}
          }, 100);

          function resumeAudio() {
            try {
              if (typeof player.focus === 'function') player.focus();
              window.focus();
              if (typeof window.__rrwrApplyRuffleVolume === 'function') {
                window.__rrwrApplyRuffleVolume();
              }
              wakeAudioContextIfActive();
              setTimeout(tickRuffleTime, 0);
            } catch (_) {}
          }
          window.addEventListener('click', resumeAudio);
          window.addEventListener('keydown', resumeAudio);
          window.addEventListener('focus', resumeAudio);

          ruffleState.audioCheckTimer = setInterval(function () {
            try {
              if (!ruffleState.loaded || !isPlayerActivelyPlaying()) return;
              if (player && typeof player.audioState === 'function') {
                if (player.audioState() === 'running') {
                  clearInterval(ruffleState.audioCheckTimer);
                  ruffleState.audioCheckTimer = 0;
                } else {
                  wakeAudioContextIfActive();
                }
              }
            } catch (_) {}
          }, 150);
          return;
        }
      }

      window.__rrwrBootRuffle = bootRuffle;

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootRuffle);
      } else {
        bootRuffle();
      }

      window.addEventListener('load', bootRuffle);
    })();
  </script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Frag IPC Command Dispatch Engine (F13, F14, F15)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Master Volume Control & Routing
  // ---------------------------------------------------------------------------

  function clampVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1.0;
    return Math.max(0, Math.min(1, n));
  }

  function getEffectiveVolume(baseVolume = 1.0) {
    if (masterMuted) return 0;
    return clampVolume(baseVolume) * masterVolume;
  }

  function syncMasterVolumeFromSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (settings.masterVolume !== undefined) {
      masterVolume = clampVolume(settings.masterVolume);
    } else if (settings.master_volume !== undefined) {
      masterVolume = clampVolume(settings.master_volume);
    }
    if (settings.masterMuted !== undefined) {
      masterMuted = Boolean(settings.masterMuted);
    } else if (settings.master_muted !== undefined) {
      masterMuted = Boolean(settings.master_muted);
    }
  }

  function injectHtmlGameVolumeController(iframe) {
    if (!iframe) return;
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) return;

      if (!win.__rrwrVolumeControllerInstalled) {
        win.__rrwrVolumeControllerInstalled = true;
        const baseVolumes = new WeakMap();
        const gainEntries = [];
        let iframeVol = masterVolume;
        let iframeMuted = masterMuted;

        const getEff = () => (iframeMuted ? 0 : Math.max(0, Math.min(1, iframeVol)));

        const mediaProto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
        const volDesc = mediaProto ? Object.getOwnPropertyDescriptor(mediaProto, 'volume') : null;
        if (mediaProto && volDesc && volDesc.configurable && typeof volDesc.get === 'function' && typeof volDesc.set === 'function') {
          Object.defineProperty(mediaProto, 'volume', {
            configurable: true,
            enumerable: true,
            get() {
              return baseVolumes.has(this) ? baseVolumes.get(this) : volDesc.get.call(this);
            },
            set(v) {
              const clamped = Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 1));
              baseVolumes.set(this, clamped);
              volDesc.set.call(this, iframeMuted ? 0 : clamped * getEff());
            }
          });
        }

        const wrapCtx = (OrigCtx) => {
          if (typeof OrigCtx !== 'function' || OrigCtx.__rrwrWrapped) return OrigCtx;
          const Wrapped = function (...args) {
            const ctx = new OrigCtx(...args);
            try {
              const realDest = ctx.destination;
              if (realDest && typeof ctx.createGain === 'function') {
                const masterGain = ctx.createGain();
                masterGain.gain.value = getEff();
                masterGain.connect(realDest);
                Object.defineProperty(ctx, 'destination', {
                  configurable: true,
                  enumerable: true,
                  get() { return masterGain; }
                });
                gainEntries.push({ ctx, gain: masterGain });
              }
            } catch (_) {}
            return ctx;
          };
          Wrapped.prototype = OrigCtx.prototype;
          Wrapped.__rrwrWrapped = true;
          return Wrapped;
        };

        if (typeof win.AudioContext === 'function') {
          win.AudioContext = wrapCtx(win.AudioContext);
        }
        if (typeof win.webkitAudioContext === 'function') {
          win.webkitAudioContext = wrapCtx(win.webkitAudioContext);
        }

        const applyToHtmlGame = (vol, muted) => {
          iframeVol = clampVolume(vol);
          if (muted !== undefined) iframeMuted = Boolean(muted);
          const eff = getEff();

          for (let i = 0; i < gainEntries.length; i++) {
            try {
              if (gainEntries[i] && gainEntries[i].gain) {
                gainEntries[i].gain.gain.value = eff;
              }
            } catch (_) {}
          }

          try {
            const els = doc.querySelectorAll('audio, video');
            for (let i = 0; i < els.length; i++) {
              const el = els[i];
              const base = baseVolumes.has(el) ? baseVolumes.get(el) : (typeof el.volume === 'number' ? el.volume : 1);
              if (!baseVolumes.has(el)) baseVolumes.set(el, base);
              if (volDesc && typeof volDesc.set === 'function') {
                volDesc.set.call(el, iframeMuted ? 0 : base * eff);
              } else {
                el.volume = iframeMuted ? 0 : base * eff;
              }
              el.muted = iframeMuted;
            }
          } catch (_) {}
        };

        win.__rrwrSetMasterVolume = applyToHtmlGame;
        win.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'RRWR_MASTER_VOLUME') {
            applyToHtmlGame(event.data.volume, event.data.muted);
          }
        });
        win.addEventListener('pagehide', () => {
          for (let i = 0; i < gainEntries.length; i++) {
            try {
              if (gainEntries[i].gain) gainEntries[i].gain.disconnect();
              if (gainEntries[i].ctx && typeof gainEntries[i].ctx.close === 'function' && gainEntries[i].ctx.state !== 'closed') {
                gainEntries[i].ctx.close().catch(() => {});
              }
            } catch (_) {}
          }
          gainEntries.length = 0;
        });
      }

      if (typeof win.__rrwrSetMasterVolume === 'function') {
        win.__rrwrSetMasterVolume(masterVolume, masterMuted);
      }
    } catch (_) {
      // Ignore cross-origin or torn-down iframe errors
    }
  }

  function applyVolumeToAllMedia() {
    for (let i = 0; i < activeAudioTracks.length; i++) {
      try {
        const track = activeAudioTracks[i];
        if (track) {
          const base = activeAudioBaseVolumes[i] !== undefined ? activeAudioBaseVolumes[i] : 1.0;
          track.volume = getEffectiveVolume(base);
          track.muted = masterMuted;
        }
      } catch (_) {}
    }

    if (activeVideo) {
      try {
        const targetVol = getEffectiveVolume(1.0);
        activeVideo.__rrwrAppliedVol = targetVol;
        activeVideo.__rrwrAppliedMuted = Boolean(masterMuted);
        activeVideo.volume = targetVol;
        activeVideo.muted = masterMuted;
      } catch (_) {}
    }

    for (let i = 0; i < activeIframes.length; i++) {
      try {
        const iframe = activeIframes[i];
        if (!iframe || !iframe.contentWindow) continue;
        if (typeof iframe.contentWindow.postMessage === 'function') {
          iframe.contentWindow.postMessage({
            type: 'RRWR_MASTER_VOLUME',
            volume: masterVolume,
            muted: masterMuted
          }, '*');
        }
        if (typeof iframe.contentWindow.__rrwrSetMasterVolume === 'function') {
          iframe.contentWindow.__rrwrSetMasterVolume(masterVolume, masterMuted);
        }
      } catch (_) {}
    }
  }

  function setMasterVolume(volume, muted) {
    masterVolume = clampVolume(volume);
    if (muted !== undefined) {
      masterMuted = Boolean(muted);
    }
    if (currentAppContext && currentAppContext.settings) {
      currentAppContext.settings.masterVolume = masterVolume;
      currentAppContext.settings.masterMuted = masterMuted;
    }
    applyVolumeToAllMedia();
    return { volume: masterVolume, muted: masterMuted, effectiveVolume: getEffectiveVolume(1.0) };
  }

  function clearPendingAudioTimers() {
    for (let i = 0; i < pendingAudioTimers.length; i++) {
      clearTimeout(pendingAudioTimers[i]);
    }
    pendingAudioTimers = [];
  }

  function schedulePendingAudioTimer(fn, delayMs) {
    const tId = setTimeout(() => {
      pendingAudioTimers = pendingAudioTimers.filter((id) => id !== tId);
      fn();
    }, delayMs);
    pendingAudioTimers.push(tId);
    activeTimeouts.push(tId);
    return tId;
  }

  function emitTrackState(trackIndex) {
    const idx = Math.max(0, Math.min(activeAudioTracks.length - 1, trackIndex));
    const track = activeAudioTracks[idx];
    if (!track) return;
    emitPageAudioEvent({
      active: true,
      playing: Boolean(!track.paused && !track.ended),
      audio: track,
      trackIndex: idx,
      totalTracks: activeAudioTracks.length,
      flashId: currentFlashProps ? (currentFlashProps.flashId || currentFlashProps.rawFlashId || '') : '',
      src: track.src || ''
    });
  }

  function playTrackWithSync(track, trackIndex) {
    if (!track) return;
    try {
      const p = track.play();
      emitTrackState(trackIndex);
      if (p && typeof p.then === 'function') {
        p.then(
          () => {
            if (activeAudioTracks[trackIndex] === track) emitTrackState(trackIndex);
          },
          () => {
            if (activeAudioTracks[trackIndex] === track) emitTrackState(trackIndex);
          }
        );
      }
    } catch (e) {
      emitTrackState(trackIndex);
    }
  }

  /**
   * Initializes audio instances for the current Flash page if not already loaded.
   */
  function executeAudioInit() {
    if (activeAudioTracks.length > 0) return;
    const tracks = (currentFlashProps && currentFlashProps.audioTracks) || [];
    for (let i = 0; i < tracks.length; i++) {
      try {
        const audio = new Audio(tracks[i]);
        audio.preload = 'auto';
        audio.volume = getEffectiveVolume(1.0);
        audio.muted = masterMuted;
        if (typeof audio.load === 'function') audio.load();
        activeAudioTracks.push(audio);
        activeAudioBaseVolumes.push(1.0);
      } catch (e) {
        // Fallback for non-browser or test runner environments
        const mockTrack = {
          src: tracks[i],
          currentTime: 0,
          volume: getEffectiveVolume(1.0),
          muted: masterMuted,
          paused: true,
          ended: false,
          play() {
            this.paused = false;
            this.ended = false;
            return Promise.resolve();
          },
          pause() {
            this.paused = true;
          },
          load: () => {},
          removeAttribute: () => {}
        };
        activeAudioTracks.push(mockTrack);
        activeAudioBaseVolumes.push(1.0);
      }
    }
    if (activeAudioTracks.length > 0) {
      const idx = Math.min(lastStartedAudio, activeAudioTracks.length - 1);
      emitTrackState(idx);
    }
  }

  /**
   * Executes audioStart with positive setTimeout delay or negative currentTime pre-seek.
   *
   * @param {string|number} [trackParam='1'] - Track number or half-segment scrub ('1'..'5', '1.5', etc.)
   */
  function executeAudioStart(trackParam = '1') {
    executeAudioInit();
    clearPendingAudioTimers();
    let n = trackParam !== undefined && trackParam !== null && trackParam !== '' ? trackParam : '1';
    const nStr = String(n);
    const isHalfSegmentScrub = nStr.endsWith('.5');

    const flashId = currentFlashProps ? currentFlashProps.flashId : '';
    const rawFlashId = currentFlashProps ? currentFlashProps.rawFlashId : '';

    if (isHalfSegmentScrub) {
      n = nStr.charAt(0);
    }

    const trackIndex = Math.max(0, parseInt(String(n), 10) - 1);
    const audioTrack = activeAudioTracks[trackIndex];
    if (!audioTrack) return;

    const baseVol = activeAudioBaseVolumes[trackIndex] !== undefined ? activeAudioBaseVolumes[trackIndex] : 1.0;
    try {
      audioTrack.volume = getEffectiveVolume(baseVol);
      audioTrack.muted = masterMuted;
    } catch (_) {}

    lastStartedAudio = trackIndex;
    let replay = false;

    // Reset track if it has progressed past 30s
    if (audioTrack.currentTime > 30) {
      executeAudioReset();
      replay = true;
    }

    let delay = 0;
    if (root && root.RRWRFlashProps && typeof root.RRWRFlashProps.getAudioDelay === 'function') {
      delay = root.RRWRFlashProps.getAudioDelay(flashId || rawFlashId, isHalfSegmentScrub ? nStr : n, replay, isHalfSegmentScrub);
    }

    if (delay > 0) {
      emitTrackState(trackIndex);
      schedulePendingAudioTimer(() => {
        if (activeAudioTracks[trackIndex]) {
          playTrackWithSync(activeAudioTracks[trackIndex], trackIndex);
        }
      }, delay);
    } else {
      if (delay < 0) {
        try {
          audioTrack.currentTime = -delay / 1000;
        } catch (e) {}
      }
      playTrackWithSync(audioTrack, trackIndex);
    }
  }

  function executeAudioPause() {
    clearPendingAudioTimers();
    if (activeAudioTracks[lastStartedAudio]) {
      try {
        activeAudioTracks[lastStartedAudio].pause();
      } catch (e) {}
      emitTrackState(lastStartedAudio);
    }
  }

  function executeAudioResume() {
    clearPendingAudioTimers();
    schedulePendingAudioTimer(() => {
      if (activeAudioTracks[lastStartedAudio]) {
        playTrackWithSync(activeAudioTracks[lastStartedAudio], lastStartedAudio);
      }
    }, 30);
  }

  function executeAudioReset() {
    clearPendingAudioTimers();
    for (let i = 0; i < activeAudioTracks.length; i++) {
      try {
        const track = activeAudioTracks[i];
        if (track) {
          track.pause();
          track.currentTime = 0;
        }
      } catch (e) {}
    }
    if (activeAudioTracks[lastStartedAudio]) {
      emitTrackState(lastStartedAudio);
    }
  }

  function executeAudioSeek(secondsStr) {
    let sec = parseFloat(secondsStr);
    if (!Number.isNaN(sec) && activeAudioTracks[lastStartedAudio]) {
      if (sec >= 100) {
        sec = sec / 1000;
      }
      try {
        activeAudioTracks[lastStartedAudio].currentTime = sec;
      } catch (e) {}
      emitTrackState(lastStartedAudio);
    }
  }

  function executeVolume(volumeStr) {
    const v = parseFloat(volumeStr);
    if (!Number.isNaN(v)) {
      const clamped = Math.max(0, Math.min(1, v));
      for (let i = 0; i < activeAudioTracks.length; i++) {
        activeAudioBaseVolumes[i] = clamped;
        try {
          if (activeAudioTracks[i]) {
            activeAudioTracks[i].volume = getEffectiveVolume(clamped);
            activeAudioTracks[i].muted = masterMuted;
          }
        } catch (e) {}
      }
    }
  }

  /**
   * Executes heightStart viewport height transition with drift-compensated timer.
   *
   * @param {string} mode - Mode key defined in HEIGHT_TRANSITIONS
   */
  function executeHeightStart(mode) {
    const settings = (currentAppContext && currentAppContext.settings) || {};
    if (settings.jsFlashes === false) return;

    const flashPropsModule = (root && root.RRWRFlashProps) || {};
    const cropHeights = flashPropsModule.CROP_HEIGHT || flashPropsModule.cropHeight || {};
    const heightTransitions = flashPropsModule.HEIGHT_TRANSITIONS || flashPropsModule.heightTransitions || {};

    const flashId = currentFlashProps ? currentFlashProps.flashId : '';
    const initialCrop = cropHeights[flashId] || (currentFlashProps && currentFlashProps.cropHeight);

    if (activeIframeElement && initialCrop && activeIframeElement.style.height !== initialCrop) {
      activeIframeElement.style.transition = 'height 0.2s';
      activeIframeElement.style.height = initialCrop;
    }

    const transitionDef = heightTransitions[mode];
    if (!transitionDef) return;

    const time = transitionDef.time;
    const transitionCss = transitionDef.transition;
    const heightTo = transitionDef.heightTo;

    if (time < 1) {
      if (activeIframeElement) {
        activeIframeElement.style.transition = transitionCss;
        activeIframeElement.style.height = heightTo;
      }
    } else {
      startViewportTimer(() => {
        if (activeIframeElement) {
          activeIframeElement.style.transition = transitionCss;
          activeIframeElement.style.height = heightTo;
        }
      }, time);
    }
  }

  function executeHeightPause() {
    pauseViewportTimer();
  }

  function executeHeightResume() {
    resumeViewportTimer();
  }

  function executeHeightReset() {
    clearViewportTimer();
    const flashPropsModule = (root && root.RRWRFlashProps) || {};
    const cropHeights = flashPropsModule.CROP_HEIGHT || flashPropsModule.cropHeight || {};
    const flashId = currentFlashProps ? currentFlashProps.flashId : '';
    const initialCrop = cropHeights[flashId] || (currentFlashProps && currentFlashProps.cropHeight);

    if (activeIframeElement && initialCrop) {
      activeIframeElement.style.transition = 'height 0.2s';
      activeIframeElement.style.height = initialCrop;
    }
  }

  /**
   * Executes multi-step stage progression sequence.
   */
  function executeStageProgress() {
    const settings = (currentAppContext && currentAppContext.settings) || {};
    if (settings.jsFlashes === false) return;

    const flashPropsModule = (root && root.RRWRFlashProps) || {};
    const steps = (flashPropsModule.STAGE_PROGRESS && flashPropsModule.STAGE_PROGRESS.steps) || stageProgressState.steps;

    stageProgressState.count = 0;

    function triggerStep() {
      stageProgressState.count += 1;
      const currentStep = stageProgressState.count;

      // Notify appContext or dispatch custom DOM event
      if (currentAppContext && typeof currentAppContext.onStageStep === 'function') {
        currentAppContext.onStageStep(currentStep);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rrwr-stage-step', { detail: { step: currentStep } }));
        const appEl = document.getElementById('app') || document.getElementById('page-container');
        if (appEl) {
          appEl.setAttribute('data-stage-step', String(currentStep));
        }
      }

      if (stageProgressState.count < steps.length) {
        const nextDelay = steps[stageProgressState.count] - steps[stageProgressState.count - 1];
        stageProgressState.timeout = setTimeout(triggerStep, nextDelay);
        activeTimeouts.push(stageProgressState.timeout);
      }
    }

    if (steps.length > 0) {
      stageProgressState.timeout = setTimeout(triggerStep, steps[0]);
      activeTimeouts.push(stageProgressState.timeout);
    }
  }

  /**
   * Navigates the host router to a given story URL or route.
   */
  function executeLink(url) {
    if (!url || typeof url !== 'string' || url === 'about:srcdoc' || url === '#' || url === 'about:blank') {
      return;
    }
    if (currentAppContext && typeof currentAppContext.navigate === 'function') {
      currentAppContext.navigate(url);
      return;
    }
    if (typeof window !== 'undefined') {
      if (typeof window.__rrwrNavigate === 'function') {
        window.__rrwrNavigate(url);
        return;
      }
      window.dispatchEvent(new CustomEvent('rrwr-navigate', { detail: { url } }));
    }
  }

  /**
   * Parses and executes a Frag IPC command string from ActionScript (or test harness).
   * Supports compound commands joined with '&' (e.g. `heightStart?wide&audioStart?1`).
   *
   * @param {string} cmdStr - Command string (e.g. 'audioInit', 'audioStart?1', 'heightStart?wide')
   */
  function handleFlashCommand(cmdStr) {
    if (!cmdStr || typeof cmdStr !== 'string') return;
    let clean = cmdStr.trim();

    // Strip about:srcdoc# or # if present
    const hashIdx = clean.indexOf('#');
    if (hashIdx !== -1) {
      clean = clean.slice(hashIdx + 1);
    }

    // Normalize audioSeek&<val> -> audioSeek?<val>
    clean = clean.replace(/(?:^|&)(audioSeek)&([0-9.]+)/g, (match, cmd, val) => {
      return match.startsWith('&') ? `&${cmd}?${val}` : `${cmd}?${val}`;
    });

    // Split compound commands by '&'
    const commandList = clean.split('&');
    for (let i = 0; i < commandList.length; i++) {
      const singleCmd = commandList[i].trim();
      if (!singleCmd) continue;

      const qIdx = singleCmd.indexOf('?');
      const funcName = qIdx !== -1 ? singleCmd.slice(0, qIdx) : singleCmd;
      const param = qIdx !== -1 ? singleCmd.slice(qIdx + 1) : '';

      switch (funcName) {
        case 'audioInit':
          executeAudioInit();
          break;
        case 'audioStart':
          executeAudioStart(param || '1');
          break;
        case 'audioPause':
          executeAudioPause();
          break;
        case 'audioResume':
          executeAudioResume();
          break;
        case 'audioReset':
          executeAudioReset();
          break;
        case 'audioSeek':
          executeAudioSeek(param);
          break;
        case 'vol':
          executeVolume(param);
          break;
        case 'heightStart':
          executeHeightStart(param);
          break;
        case 'heightPause':
          executeHeightPause();
          break;
        case 'heightResume':
          executeHeightResume();
          break;
        case 'heightReset':
          executeHeightReset();
          break;
        case 'stageProgress':
          executeStageProgress();
          break;
        case 'audioStop':
          executeAudioPause();
          break;
        case 'nextPage':
          executeLink('next');
          break;
        case 'toggleNext': {
          const links = document.querySelector('.page-next-links, .nextLinks, .story-next-links');
          if (links) {
            if (param === 'show') links.style.display = '';
            else if (param === 'hide') links.style.display = 'none';
            else links.style.display = links.style.display === 'none' ? '' : 'none';
          }
          break;
        }
        case 'gameLoaded': {
          if (activeIframeElement && typeof activeIframeElement.focus === 'function') {
            try {
              activeIframeElement.focus();
              if (activeIframeElement.contentWindow) activeIframeElement.contentWindow.focus();
            } catch (_) {}
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('rrwr-game-loaded', { detail: { param } }));
          }
          break;
        }
        case 'link':
          executeLink(param);
          break;
        default:
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('rrwr-flash-command', { detail: { cmd: funcName, param } }));
          }
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Host Window Frag IPC Interceptor Installation (F14)
  // ---------------------------------------------------------------------------

  /**
   * Installs global __rrwrInvokeFromFlash and window 'message' listeners on the host.
   */
  function initFragIpc(targetWindow) {
    const win = targetWindow || (typeof window !== 'undefined' ? window : null);
    if (!win) return;

    win.__rrwrInvokeFromFlash = function (cmdStr) {
      handleFlashCommand(cmdStr);
    };

    win.addEventListener('message', (event) => {
      if (event && event.data) {
        if (event.data.type === 'RRWR_FLASH_CMD' || event.data.type === 'RRWR_FRAG_IPC') {
          handleFlashCommand(event.data.cmd || event.data.hash);
        }
      }
    });
  }

  // Auto-install on the current browser window
  if (typeof window !== 'undefined') {
    initFragIpc(window);
  }

  // ---------------------------------------------------------------------------
  // Unified Media Renderer (F12, F15, F16)
  // ---------------------------------------------------------------------------

  /**
   * Renders media items into containerEl based on format:
   * - Images (.gif, .png, .jpg, .jpeg, .webp)
   * - Flashes (.swf) via Ruffle WASM srcdoc iframe + calibrated external audio tracks
   * - Video (.mp4, .webm) with optional timed width expansion
   * - HTML5 Canvas games (.html) inside iframe
   *
   * @param {HTMLElement} containerEl - DOM container where media elements will be appended
   * @param {string[]|string} [mediaUrls] - Raw media URL(s) from page.media
   * @param {object} [pageObj] - Active story page descriptor ({ page_id, title, flags, media })
   * @param {object} [appContext] - Context ({ assetBase, cacheBuster, settings, navigate, onStageStep })
   */
  function renderMedia(containerEl, mediaUrls, pageObj, appContext, resolveAssetUrlFallback) {
    if (!containerEl || typeof containerEl.appendChild !== 'function') {
      return false;
    }

    cleanupActiveMedia();

    // Support both structured appContext and direct settings object
    const isContextObj = appContext && (appContext.settings !== undefined || appContext.assetBase !== undefined);
    const settings = isContextObj ? (appContext.settings || {}) : (appContext || {});
    const assetBase = (isContextObj && appContext.assetBase) || (appContext && appContext.assetBase) || '';
    const cacheBuster = (isContextObj && (appContext.cacheBuster || appContext.overlayGeneration)) || '';
    const navigate = isContextObj ? appContext.navigate : (appContext && appContext.navigate);

    currentAppContext = isContextObj ? appContext : { settings, assetBase, cacheBuster, navigate };
    if (!currentAppContext.settings) {
      currentAppContext.settings = settings;
    }
    syncMasterVolumeFromSettings(currentAppContext.settings);

    containerEl.innerHTML = '';

    const pObj = pageObj || {};
    const pageId = String(pObj.page_id || pObj.pageId || '');
    const pageFlags = Array.isArray(pObj.flags) ? pObj.flags : [];

    let items = [];
    if (Array.isArray(mediaUrls)) {
      items = mediaUrls;
    } else if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
      items = [mediaUrls];
    } else if (Array.isArray(pObj.media)) {
      items = pObj.media;
    }

    if (items.length === 0) return false;

    const flashPropsModule = (root && root.RRWRFlashProps) || {};
    const resolveFn = flashPropsModule.resolveMediaAssets;

    for (let i = 0; i < items.length; i++) {
      const rawUrl = items[i];
      if (!rawUrl || typeof rawUrl !== 'string') continue;

      let resolved;
      if (typeof resolveFn === 'function') {
        resolved = resolveFn(rawUrl, settings, assetBase, cacheBuster, pageId, pageFlags);
      } else {
        const fallbackUrl = typeof resolveAssetUrlFallback === 'function' ? resolveAssetUrlFallback(rawUrl) : rawUrl;
        resolved = {
          resolvedUrl: fallbackUrl,
          ext: (rawUrl.split('?')[0].match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase(),
          flashId: '',
          rawFlashId: '',
          width: 650,
          height: 450,
          bgcolor: '#fff',
          cropHeight: '450px',
          isCropped: false,
          audioTracks: []
        };
      }

      const ext = resolved.ext || '';

      // 1. Flash Animation (.swf) -> Ruffle WASM Player Iframe
      if (ext === 'swf') {
        currentFlashProps = resolved;
        const gameKey = resolved.flashId || resolved.rawFlashId || resolved.resolvedUrl;
        const restoredSave = currentAppContext.flashRestore;
        const flashStorage = restoredSave && restoredSave.gameKey === gameKey
          ? restoredSave.storage
          : ((currentAppContext.flashStorage && currentAppContext.flashStorage[gameKey]) || {});
        const initialHeight = (settings.jsFlashes !== false && resolved.isCropped)
          ? resolved.cropHeight
          : `${resolved.height}px`;

        const iframe = document.createElement('iframe');
        iframe.className = 'page-media-flash ruffle-frame';
        iframe.setAttribute('data-media-type', 'ruffle-flash');
        iframe.setAttribute('data-swf-src', resolved.resolvedUrl);
        iframe.setAttribute('data-flash-id', gameKey);
        iframe.setAttribute('allow', 'autoplay; fullscreen');
        iframe.setAttribute('tabindex', '0');
        const numericHeight = parseInt(initialHeight, 10) || resolved.height || 450;
        const numericWidth = resolved.width || 650;
        iframe.style.width = '100%';
        iframe.style.maxWidth = `${numericWidth}px`;
        iframe.style.aspectRatio = `${numericWidth} / ${numericHeight}`;
        iframe.style.height = 'auto';
        iframe.style.border = 'none';
        iframe.style.overflow = 'hidden';
        iframe.style.display = 'block';
        iframe.style.margin = '0 auto';
        iframe.style.backgroundColor = resolved.bgcolor || '#ffffff';

        iframe.addEventListener('load', () => {
          try {
            if (iframe.contentWindow) {
              iframe.contentWindow.focus();
            }
          } catch (_) {}
        });

        const srcdocHtml = buildRuffleSrcdoc({
          swfUrl: resolved.resolvedUrl,
          width: resolved.width,
          height: resolved.height,
          bgColor: resolved.bgcolor,
          assetBase,
          flashId: resolved.flashId,
          gameKey,
          flashStorage,
          masterVolume,
          masterMuted
        });
        iframe.srcdoc = srcdocHtml;

        activeIframeElement = iframe;
        activeIframes.push(iframe);
        containerEl.appendChild(iframe);

        // Preload external audio tracks if present so they are ready on audioStart
        if (resolved.audioTracks && resolved.audioTracks.length > 0) {
          executeAudioInit();
        } else {
          const pageTitleStr = String((pObj && pObj.title) || '');
          const pageFlags = Array.isArray(pObj && pObj.flag)
            ? pObj.flag
            : (Array.isArray(pObj && pObj.flags) ? pObj.flags : []);
          if (pageTitleStr.includes('[S]') || pageFlags.includes('S')) {
            emitPageAudioEvent({
              active: true,
              kind: 'ruffle',
              playing: true,
              iframe,
              flashId: gameKey,
              src: resolved.resolvedUrl
            });
          }
        }
      }
      // 2. HTML5 Canvas Game (.html)
      else if (ext === 'html') {
        const iframe = document.createElement('iframe');
        iframe.className = 'page-media-html html-game-frame';
        iframe.setAttribute('data-media-type', 'html-game-canvas');
        iframe.setAttribute('allow', 'autoplay; fullscreen');
        iframe.src = resolved.resolvedUrl;
        const htmlW = resolved.width || 650;
        const htmlH = resolved.height || 450;
        iframe.style.width = '100%';
        iframe.style.maxWidth = `${htmlW}px`;
        iframe.style.aspectRatio = `${htmlW} / ${htmlH}`;
        iframe.style.height = 'auto';
        iframe.style.border = 'none';
        iframe.style.overflow = 'hidden';
        iframe.style.display = 'block';
        iframe.style.margin = '0 auto';
        iframe.allowFullscreen = true;
        iframe.addEventListener('load', () => {
          injectHtmlGameVolumeController(iframe);
        });

        activeIframes.push(iframe);
        containerEl.appendChild(iframe);
      }
      // 3. HTML5 Video (.mp4, .webm, .ogg)
      else if (ext === 'mp4' || ext === 'webm' || ext === 'ogg') {
        const video = document.createElement('video');
        video.className = 'page-media-video';
        video.setAttribute('data-media-type', 'video');
        video.src = resolved.resolvedUrl;
        video.controls = true;
        video.autoplay = true;
        const initialVideoVol = getEffectiveVolume(1.0);
        video.__rrwrAppliedVol = initialVideoVol;
        video.__rrwrAppliedMuted = Boolean(masterMuted);
        video.volume = initialVideoVol;
        video.muted = masterMuted;
        emitPageAudioEvent({
          active: true,
          playing: !video.paused,
          audio: video,
          src: resolved.resolvedUrl
        });
        video.style.display = 'block';
        video.style.margin = '0 auto';
        video.style.width = `${resolved.width || 650}px`;
        video.style.height = `${resolved.height || 450}px`;

        // Optional timed curtain expansion if configured on resolved descriptor
        if (resolved.expandAt && resolved.expandWidth) {
          let widened = false;
          video.addEventListener('timeupdate', () => {
            if (!widened && video.currentTime > resolved.expandAt) {
              widened = true;
              video.style.transition = 'width 1.5s cubic-bezier(0, 0, 0, 1)';
              video.style.width = resolved.expandWidth;
              if (containerEl) {
                containerEl.style.transition = 'width 1.5s cubic-bezier(0, 0, 0, 1)';
              }
            }
          });
        }

        activeVideo = video;
        containerEl.appendChild(video);
      }
      // 4. Static / Animated Image (.gif, .png, .jpg, .jpeg, .webp)
      else {
        const img = document.createElement('img');
        img.className = 'page-media-img';
        img.setAttribute('data-media-type', 'image');
        img.src = resolved.resolvedUrl;
        img.alt = pObj.title || 'Story Media';
        img.style.display = 'block';
        img.style.margin = '0 auto';
        containerEl.appendChild(img);
      }
    }
    if (typeof root !== 'undefined' && typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      const hasInteractive = activeIframes.some((f) => f && (f.classList.contains('ruffle-frame') || f.classList.contains('html-game-frame')));
      root.dispatchEvent(new CustomEvent('rrwr:media-updated', { detail: { interactive: hasInteractive } }));
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API Export
  // ---------------------------------------------------------------------------

  const RRWRMediaEngine = {
    cleanupActiveMedia,
    buildRuffleSrcdoc,
    handleFlashCommand,
    renderMedia,
    initFragIpc,
    setMasterVolume,
    getMasterVolume: () => ({
      volume: masterVolume,
      muted: masterMuted,
      effectiveVolume: getEffectiveVolume(1.0)
    }),

    // Internal state inspectors for unit and E2E verification
    getActiveAudio: () => activeAudioTracks,
    getActiveIframes: () => activeIframes,
    hasInteractiveEmbed: () =>
      activeIframes.some(
        (f) => f && (f.classList.contains('ruffle-frame') || f.classList.contains('html-game-frame'))
      ),
    getLastStartedAudio: () => lastStartedAudio,
    getViewportTimer: () => viewportTimer,
    getStageProgressState: () => stageProgressState,
    getCurrentFlashProps: () => currentFlashProps
  };

  if (typeof root !== 'undefined') {
    root.RRWRMediaEngine = RRWRMediaEngine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRMediaEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
