(function (root) {
  'use strict';

  var SAMPLE_SIZE = 40;
  var MONO_FALLBACK_SEED = null;

  function clamp(val, min, max) {
    return val < min ? min : (val > max ? max : val);
  }

  function rgbToHsl(r, g, b) {
    var rn = r / 255;
    var gn = g / 255;
    var bn = b / 255;
    var max = Math.max(rn, gn, bn);
    var min = Math.min(rn, gn, bn);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;

    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) {
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
      } else if (max === gn) {
        h = (bn - rn) / d + 2;
      } else {
        h = (rn - gn) / d + 4;
      }
      h /= 6;
    }

    return {
      h: Math.round(h * 360) % 360,
      s: s,
      l: l
    };
  }

  function hslToRgb(h, s, l) {
    var hn = (((h % 360) + 360) % 360) / 360;
    if (s <= 0) {
      var v = Math.round(clamp(l, 0, 1) * 255);
      return [v, v, v];
    }
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, hn) * 255),
      Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)
    ];
  }

  function relativeLuminance(rgb) {
    var ch = [rgb[0], rgb[1], rgb[2]].map(function (c) {
      var s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function hslCss(h, sPct, lPct) {
    var hn = Math.round(((h % 360) + 360) % 360);
    var sn = Math.round(clamp(sPct, 0, 100));
    var ln = Math.round(clamp(lPct, 0, 100));
    return 'hsl(' + hn + ', ' + sn + '%, ' + ln + '%)';
  }

  function hslaCss(h, sPct, lPct, alpha) {
    var hn = Math.round(((h % 360) + 360) % 360);
    var sn = Math.round(clamp(sPct, 0, 100));
    var ln = Math.round(clamp(lPct, 0, 100));
    var an = clamp(alpha, 0, 1).toFixed(2);
    return 'hsla(' + hn + ', ' + sn + '%, ' + ln + '%, ' + an + ')';
  }

  function angularDistance(a, b) {
    var diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  function analyzePixelData(data) {
    if (!data || data.length < 4) return null;

    var bins = new Array(36).fill(0);
    var binSatSum = new Array(36).fill(0);
    var validCount = 0;
    var chromaticScoreSum = 0;
    var rSum = 0;
    var gSum = 0;
    var bSum = 0;
    var lumaMin = 1;
    var lumaMax = 0;

    for (var i = 0; i < data.length; i += 4) {
      var alpha = data[i + 3];
      if (alpha < 96) continue;

      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      validCount += 1;
      rSum += r;
      gSum += g;
      bSum += b;

      var hsl = rgbToHsl(r, g, b);
      if (hsl.l < lumaMin) lumaMin = hsl.l;
      if (hsl.l > lumaMax) lumaMax = hsl.l;

      if (hsl.s >= 0.14 && hsl.l >= 0.06 && hsl.l <= 0.94) {
        var bucket = Math.floor(hsl.h / 10) % 36;
        var midtoneWeight = 1 - Math.min(0.75, Math.abs(hsl.l - 0.5) * 1.45);
        var weight = (0.25 + hsl.s * 1.55) * midtoneWeight;
        bins[bucket] += weight;
        binSatSum[bucket] += hsl.s * weight;
        chromaticScoreSum += weight;
      }
    }

    if (validCount < 8) return null;

    var avgR = Math.round(rSum / validCount);
    var avgG = Math.round(gSum / validCount);
    var avgB = Math.round(bSum / validCount);
    var avgHsl = rgbToHsl(avgR, avgG, avgB);
    var lumaRange = lumaMax - lumaMin;

    // Require actual visual detail if extracting from a live canvas
    if (lumaRange < 0.02 && chromaticScoreSum < 0.5 && avgHsl.l < 0.04) {
      return null;
    }

    var smoothed = new Array(36).fill(0);
    for (var bIdx = 0; bIdx < 36; bIdx++) {
      var prev = bins[(bIdx + 35) % 36];
      var next = bins[(bIdx + 1) % 36];
      smoothed[bIdx] = bins[bIdx] + 0.28 * (prev + next);
    }

    var bestBin = 0;
    var bestScore = -1;
    for (var k = 0; k < 36; k++) {
      if (smoothed[k] > bestScore) {
        bestScore = smoothed[k];
        bestBin = k;
      }
    }

    var chromaticRatio = chromaticScoreSum / validCount;
    var isMonochrome = bestScore <= 0 || chromaticRatio < 0.05;

    if (isMonochrome) {
      return {
        isMonochrome: true,
        avgLuma: avgHsl.l,
        primaryHue: avgHsl.s > 0.05 ? avgHsl.h : 215,
        primarySat: 0.08,
        secondaryHue: avgHsl.s > 0.05 ? (avgHsl.h + 25) % 360 : 215
      };
    }

    var h1 = bestBin * 10 + 5;
    var s1 = bins[bestBin] > 0 ? clamp(binSatSum[bestBin] / bins[bestBin], 0.25, 0.98) : 0.65;

    var secondBin = (bestBin + 3) % 36;
    var secondScore = -1;
    for (var j = 0; j < 36; j++) {
      var candHue = j * 10 + 5;
      if (angularDistance(h1, candHue) >= 35 && smoothed[j] > secondScore) {
        secondScore = smoothed[j];
        secondBin = j;
      }
    }

    var h2 = (secondScore > bestScore * 0.2) ? (secondBin * 10 + 5) : ((h1 + 34) % 360);

    return {
      isMonochrome: false,
      avgLuma: avgHsl.l,
      primaryHue: h1,
      primarySat: s1,
      secondaryHue: h2
    };
  }

  function buildMonetTokens(seed) {
    if (!seed || seed.isMonochrome) {
      var monoHue = seed ? seed.primaryHue : 212;
      var brightPanel = seed && seed.avgLuma > 0.55;
      var monoSat = seed ? 8 : 6;
      return {
        '--mp-shell-bg': hslCss(monoHue, monoSat, brightPanel ? 16 : 13),
        '--mp-shell-surface': hslCss(monoHue, monoSat, brightPanel ? 23 : 20),
        '--mp-shell-surface-hover': hslCss(monoHue, monoSat, brightPanel ? 30 : 27),
        '--mp-shell-border': hslCss(monoHue, 10, brightPanel ? 48 : 42),
        '--mp-shell-bevel': 'rgba(255, 255, 255, 0.16)',
        '--mp-shell-shadow': 'rgba(0, 0, 0, 0.58)',
        '--mp-lcd-bg': hslCss(monoHue, 12, 8),
        '--mp-lcd-border': hslCss(monoHue, 12, 34),
        '--mp-lcd-text': hslCss(monoHue, 14, 91),
        '--mp-lcd-subtext': hslCss(monoHue, 10, 68),
        '--mp-accent': hslCss(monoHue, 14, 84),
        '--mp-accent-on': '#111316',
        '--mp-accent-soft': 'rgba(220, 226, 234, 0.2)',
        '--mp-track-inactive': 'rgba(200, 208, 218, 0.28)',
        '--mp-text': '#eef1f5',
        '--mp-text-muted': '#aeb6c2'
      };
    }

    var h1 = seed.primaryHue;
    var h2 = seed.secondaryHue;
    var sPct = clamp(seed.primarySat * 100, 26, 94);

    // Perceptual lightness tuning: blues/violets need higher lightness to read sharply
    var accentLightness = 64;
    if (h1 >= 210 && h1 <= 285) accentLightness = 71;
    else if (h1 >= 42 && h1 <= 170) accentLightness = 60;

    var accentSat = clamp(sPct * 0.92, 48, 92);
    var accentRgb = hslToRgb(h1, accentSat / 100, accentLightness / 100);
    var accentLum = relativeLuminance(accentRgb);
    var accentOn = accentLum > 0.34 ? '#101215' : '#f7f8fa';

    return {
      '--mp-shell-bg': hslCss(h1, clamp(sPct * 0.34, 14, 30), 14),
      '--mp-shell-surface': hslCss(h1, clamp(sPct * 0.30, 12, 26), 21),
      '--mp-shell-surface-hover': hslCss(h1, clamp(sPct * 0.36, 16, 32), 27),
      '--mp-shell-border': hslCss(h2, clamp(sPct * 0.55, 22, 54), 45),
      '--mp-shell-bevel': hslaCss(h1, clamp(sPct * 0.48, 20, 50), 78, 0.22),
      '--mp-shell-shadow': hslaCss(h1, 36, 4, 0.62),
      '--mp-lcd-bg': hslCss(h1, clamp(sPct * 0.48, 18, 42), 8),
      '--mp-lcd-border': hslCss(h2, clamp(sPct * 0.44, 18, 46), 34),
      '--mp-lcd-text': hslCss(h1, clamp(sPct * 0.85, 42, 92), 86),
      '--mp-lcd-subtext': hslCss(h2, clamp(sPct * 0.50, 22, 58), 70),
      '--mp-accent': hslCss(h1, accentSat, accentLightness),
      '--mp-accent-on': accentOn,
      '--mp-accent-soft': hslaCss(h1, accentSat, 62, 0.22),
      '--mp-track-inactive': hslaCss(h2, 26, 74, 0.28),
      '--mp-text': hslCss(h1, 22, 93),
      '--mp-text-muted': hslCss(h2, 20, 70)
    };
  }

  function applyMonetTokensToElements(elements, seed) {
    var tokens = buildMonetTokens(seed);
    var list = Array.isArray(elements) ? elements : [elements];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || !el.style) continue;
      var keys = Object.keys(tokens);
      for (var j = 0; j < keys.length; j++) {
        el.style.setProperty(keys[j], tokens[keys[j]]);
      }
    }
    return tokens;
  }

  function sampleDrawablePixels(drawable) {
    if (!drawable || typeof document === 'undefined') return null;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      ctx.drawImage(drawable, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      var imgData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      return analyzePixelData(imgData.data);
    } catch (_) {
      return null;
    }
  }

  function createMonetController(getTargetElements, onPaletteApplied) {
    var requestToken = 0;
    var currentArtUrl = '';

    function applySeed(seed) {
      var targets = typeof getTargetElements === 'function' ? getTargetElements() : [];
      var tokens = applyMonetTokensToElements(targets, seed || MONO_FALLBACK_SEED);
      if (typeof onPaletteApplied === 'function') onPaletteApplied(tokens);
    }

    function applyNeutralFallback() {
      currentArtUrl = '';
      applySeed(MONO_FALLBACK_SEED);
    }

    function extractFromUrl(url, onResolved) {
      var token = ++requestToken;
      if (!url || typeof Image === 'undefined') {
        applyNeutralFallback();
        if (typeof onResolved === 'function') onResolved('');
        return;
      }

      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (token !== requestToken) return;
        var seed = sampleDrawablePixels(img);
        applySeed(seed || MONO_FALLBACK_SEED);
        currentArtUrl = url;
        if (typeof onResolved === 'function') onResolved(url);
      };
      img.onerror = function () {
        if (token !== requestToken) return;
        applyNeutralFallback();
        if (typeof onResolved === 'function') onResolved('');
      };
      img.src = url;
    }

    function extractFromPageMedia(opts) {
      var options = opts || {};
      var token = ++requestToken;
      var mediaContainer = typeof document !== 'undefined'
        ? (document.getElementById('page-media-container') || document.getElementById('page-container'))
        : null;

      if (options.coverUrl) {
        extractFromUrl(options.coverUrl, options.onArtwork);
        return;
      }

      // 1. Visible HTML5 <img.panel-media> or any <img> inside media container (supports animated GIFs)
      if (mediaContainer) {
        var imgs = mediaContainer.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var im = imgs[i];
          if (!im.src) continue;
          if (im.complete && im.naturalWidth > 0) {
            var imgSeed = sampleDrawablePixels(im);
            if (imgSeed) {
              applySeed(imgSeed);
              currentArtUrl = im.src;
              if (typeof options.onArtwork === 'function') options.onArtwork(im.src);
              return;
            }
          } else {
            extractFromUrl(im.src, options.onArtwork);
            return;
          }
        }

        // 2. HTML5 <video> current frame
        var videos = mediaContainer.querySelectorAll('video');
        for (var v = 0; v < videos.length; v++) {
          var vid = videos[v];
          if (vid.readyState >= 2) {
            var vidSeed = sampleDrawablePixels(vid);
            if (vidSeed) {
              applySeed(vidSeed);
              currentArtUrl = '';
              if (typeof options.onArtwork === 'function') options.onArtwork('');
              return;
            }
          }
        }

        // 3. Canvas inside page or same-origin iframe (best-effort; WebGL backbuffers may return null)
        var canvases = mediaContainer.querySelectorAll('canvas');
        for (var c = 0; c < canvases.length; c++) {
          var cSeed = sampleDrawablePixels(canvases[c]);
          if (cSeed) {
            applySeed(cSeed);
            if (typeof options.onArtwork === 'function') options.onArtwork('');
            return;
          }
        }

        var iframe = options.iframe || mediaContainer.querySelector('iframe.ruffle-frame, iframe');
        if (iframe) {
          try {
            var doc = iframe.contentDocument;
            if (doc) {
              var rp = doc.getElementById('player') || doc.querySelector('ruffle-player');
              var innerCanvas = (rp && rp.shadowRoot && rp.shadowRoot.querySelector('canvas'))
                || doc.querySelector('canvas');
              if (innerCanvas) {
                var rSeed = sampleDrawablePixels(innerCanvas);
                if (rSeed) {
                  applySeed(rSeed);
                  if (typeof options.onArtwork === 'function') options.onArtwork('');
                  return;
                }
              }
            }
          } catch (_) {}

          // Retry once slightly later after Ruffle paints its first frame
          if (!options._retriedRuffle) {
            setTimeout(function () {
              if (token !== requestToken) return;
              extractFromPageMedia({
                iframe: iframe,
                coverUrl: options.coverUrl,
                onArtwork: options.onArtwork,
                _retriedRuffle: true
              });
            }, 650);
          }
        }
      }

      // 4. Banner image fallback if page has a banner
      var bannerImg = typeof document !== 'undefined'
        ? document.querySelector('#page-banner-container img')
        : null;
      if (bannerImg && bannerImg.complete && bannerImg.naturalWidth > 0) {
        var bSeed = sampleDrawablePixels(bannerImg);
        if (bSeed) {
          applySeed(bSeed);
          if (typeof options.onArtwork === 'function') options.onArtwork('');
          return;
        }
      }

      applyNeutralFallback();
      if (typeof options.onArtwork === 'function') options.onArtwork('');
    }

    return {
      extractFromUrl: extractFromUrl,
      extractFromPageMedia: extractFromPageMedia,
      reset: applyNeutralFallback,
      getCurrentArtUrl: function () { return currentArtUrl; }
    };
  }

  var cachedWidgetAppEl = null;
  var cachedWidgetReducedMql = null;
  var cachedHeaderEl = null;

  function getCachedAppEl() {
    if (typeof document === 'undefined') return null;
    if (!cachedWidgetAppEl || !cachedWidgetAppEl.isConnected) {
      cachedWidgetAppEl = document.getElementById('app');
    }
    return cachedWidgetAppEl;
  }

  function isWidgetReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    if (!cachedWidgetReducedMql) {
      cachedWidgetReducedMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    }
    return Boolean(cachedWidgetReducedMql && cachedWidgetReducedMql.matches);
  }

  function isTwelveFpsMode() {
    var app = getCachedAppEl();
    return Boolean(app && app.getAttribute('data-anim-fps') === '12');
  }

  function areWidgetMotionEffectsAllowed() {
    if (isWidgetReducedMotion()) {
      return false;
    }
    var app = getCachedAppEl();
    if (app) {
      if (app.getAttribute('data-animations-enabled') === 'false') return false;
      if (app.getAttribute('data-anim-uimicro') === 'false') return false;
    }
    return true;
  }

  function getSafeViewportMargins() {
    var margin = window.innerWidth <= 480 ? 10 : 14;
    if (!cachedHeaderEl || !cachedHeaderEl.isConnected) {
      cachedHeaderEl = typeof document !== 'undefined' ? document.getElementById('appHeader') : null;
    }
    var topSafe = margin;
    if (cachedHeaderEl) {
      var hRect = cachedHeaderEl.getBoundingClientRect();
      if (hRect.height > 0 && hRect.bottom > 0) {
        topSafe = Math.max(margin, Math.round(hRect.bottom) + 10);
      }
    }
    return {
      left: margin,
      right: margin,
      bottom: margin,
      top: topSafe
    };
  }

  /**
   * Android AOSP SquigglyProgress canvas controller.
   * Renders an animated horizontal cubic-Bezier wave on the active portion of
   * the seekbar when playing, smoothly springing amplitude to 0 when paused
   * or scrubbing, with elastic thumb bounce and seek-release crest ripple.
   */
  function createSquigglyController(options) {
    var canvas = options && options.canvas;
    var containerEl = options && options.themeElement;
    var onSeekFraction = options && options.onSeekFraction;
    var onScrubStateChange = options && options.onScrubStateChange;
    var getLiveFraction = options && options.getLiveFraction;

    if (!canvas) {
      return {
        setPlaying: function () {},
        setProgress: function () {},
        setIndeterminate: function () {},
        setSeekable: function () {},
        setVisible: function () {},
        redraw: function () {},
        destroy: function () {}
      };
    }

    var WAVE_LENGTH = 26;
    var LINE_AMPLITUDE = 2.7;
    var PHASE_SPEED = 16; // CSS px / sec
    var STROKE_WIDTH = 2.6;
    var THUMB_W = 4;
    var THUMB_H = 13;
    var H_PAD = 7;
    var AMP_STIFFNESS = 220;
    var AMP_DAMPING = 15;
    var THUMB_POP_STIFFNESS = 360;
    var THUMB_POP_DAMPING = 19;
    var SEEK_RIPPLE_DURATION = 0.28;

    var fraction = 0;
    var isPlaying = false;
    var isIndeterminate = false;
    var isSeekable = true;
    var isVisible = false;
    var isDragging = false;
    var phaseOffset = 0;
    var ampPos = 0;
    var ampVel = 0;
    var thumbPopPos = 1;
    var thumbPopVel = 0;
    var seekRippleRemaining = 0;
    var seekRippleCenterFrac = 0;
    var rafId = 0;
    var lastTs = 0;
    var lastDrawTs = 0;
    var resizeObserver = null;
    var resizeRafId = 0;
    var cachedCtx = canvas.getContext('2d');
    var cachedColors = { active: '#29ff4a', inactive: 'rgba(255,255,255,0.28)' };
    var cachedDims = { w: 260, h: 22, dpr: 1 };

    function areWaveAnimationsAllowed() {
      return areWidgetMotionEffectsAllowed();
    }

    function readColors() {
      if (!containerEl || typeof getComputedStyle !== 'function') {
        return { active: '#29ff4a', inactive: 'rgba(255,255,255,0.28)' };
      }
      var cs = getComputedStyle(containerEl);
      var active = (cs.getPropertyValue('--mp-accent') || '').trim() || '#29ff4a';
      var inactive = (cs.getPropertyValue('--mp-track-inactive') || '').trim() || 'rgba(255,255,255,0.28)';
      return { active: active, inactive: inactive };
    }

    function ensureCanvasResolution() {
      var rect = canvas.getBoundingClientRect();
      var cssW = Math.max(40, Math.round(rect.width || canvas.clientWidth || cachedDims.w || 260));
      var cssH = Math.max(14, Math.round(rect.height || canvas.clientHeight || cachedDims.h || 22));
      var dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      var targetW = Math.round(cssW * dpr);
      var targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      cachedDims = { w: cssW, h: cssH, dpr: dpr };
      return cachedDims;
    }

    function refreshMetrics() {
      cachedColors = readColors();
      return ensureCanvasResolution();
    }

    function drawFrame() {
      if (!isVisible) return;
      var ctx = cachedCtx || (cachedCtx = canvas.getContext('2d'));
      if (!ctx) return;
      var dims = (cachedDims && cachedDims.w >= 40) ? cachedDims : refreshMetrics();

      ctx.save();
      ctx.scale(dims.dpr, dims.dpr);
      ctx.clearRect(0, 0, dims.w, dims.h);

      var colors = cachedColors;
      var startX = H_PAD;
      var endX = dims.w - H_PAD;
      var trackWidth = Math.max(12, endX - startX);
      var centerY = dims.h / 2;
      var activeFraction = isIndeterminate ? 1.0 : clamp(fraction, 0, 1);
      var activeEndX = startX + trackWidth * activeFraction;

      var animAllowed = areWaveAnimationsAllowed();
      var waveAmplitude = animAllowed ? (LINE_AMPLITUDE * ampPos) : 0;
      var hasRipple = animAllowed && seekRippleRemaining > 0 && !isIndeterminate;

      // 1. Inactive remaining straight track
      var gap = isIndeterminate ? 0 : 6;
      var inactiveStart = Math.min(endX, activeEndX + (activeFraction > 0.01 ? gap : 0));
      if (!isIndeterminate && inactiveStart < endX) {
        ctx.beginPath();
        ctx.strokeStyle = colors.inactive;
        ctx.lineWidth = STROKE_WIDTH;
        ctx.lineCap = 'round';
        ctx.moveTo(inactiveStart, centerY);
        ctx.lineTo(endX, centerY);
        ctx.stroke();
      }

      // 2. Active squiggly path using AOSP half-wavelength cubic Bezier segments
      if (activeEndX > startX + 0.5) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX - 1, 0, Math.max(1, activeEndX - startX + 1.5), dims.h);
        ctx.clip();

        ctx.beginPath();
        ctx.strokeStyle = colors.active;
        ctx.lineWidth = STROKE_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (Math.abs(waveAmplitude) <= 0.12 && !hasRipple) {
          ctx.moveTo(startX, centerY);
          ctx.lineTo(activeEndX, centerY);
        } else if (hasRipple) {
          var rippleNorm = seekRippleRemaining / SEEK_RIPPLE_DURATION;
          var rippleOriginX = startX + trackWidth * clamp(seekRippleCenterFrac, 0, 1);
          var waveK = (Math.PI * 2) / WAVE_LENGTH;
          var rippleTravel = (1 - rippleNorm) * 14;
          var xCur = startX;
          var firstPt = true;
          while (xCur <= activeEndX + 3) {
            var px = Math.min(xCur, activeEndX);
            var distTip = activeEndX - px;
            var tFactor = isIndeterminate ? 1 : clamp(distTip / 14, 0, 1);
            var baseY = Math.abs(waveAmplitude) > 0.12
              ? waveAmplitude * tFactor * Math.sin((px - startX + phaseOffset) * waveK)
              : 0;
            var dxR = px - rippleOriginX;
            var gauss = Math.exp(-(dxR * dxR) / 484);
            var ripY = 3.2 * rippleNorm * gauss * Math.sin(dxR * 0.28 - rippleTravel);
            if (firstPt) {
              ctx.moveTo(px, centerY + baseY + ripY);
              firstPt = false;
            } else {
              ctx.lineTo(px, centerY + baseY + ripY);
            }
            if (px >= activeEndX) break;
            xCur += 3;
          }
        } else {
          var halfWave = WAVE_LENGTH / 2;
          var x = startX - (phaseOffset % WAVE_LENGTH) - WAVE_LENGTH;
          var sign = 1;
          ctx.moveTo(x, centerY);

          while (x < activeEndX + WAVE_LENGTH) {
            var nextX = x + halfWave;
            // Amplitude modulation toward active tip for seamless join with thumb
            var distToTip = activeEndX - ((x + nextX) * 0.5);
            var tipFactor = isIndeterminate
              ? 1
              : clamp(distToTip / 14, 0, 1);
            var amp = waveAmplitude * tipFactor * sign;
            var cpOffset = halfWave * 0.48;
            ctx.bezierCurveTo(
              x + cpOffset, centerY + amp * 1.35,
              nextX - cpOffset, centerY + amp * 1.35,
              nextX, centerY
            );
            x = nextX;
            sign = -sign;
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 3. Vertical pill thumb with squash-and-stretch pop spring (hidden when indeterminate)
      if (!isIndeterminate) {
        var curThumbScaleY = animAllowed ? clamp(thumbPopPos, 0.72, 1.38) : 1;
        var curThumbScaleX = animAllowed ? clamp(1 - (curThumbScaleY - 1) * 0.58, 0.78, 1.25) : 1;
        var tW = THUMB_W * curThumbScaleX;
        var tH = THUMB_H * curThumbScaleY;
        var thumbX = clamp(activeEndX, startX, endX) - tW / 2;
        var thumbY = centerY - tH / 2;
        var radius = Math.min(tW, tH) / 2;
        ctx.fillStyle = colors.active;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(thumbX, thumbY, tW, tH, radius);
        } else {
          ctx.rect(thumbX, thumbY, tW, tH);
        }
        ctx.fill();
      }

      ctx.restore();
    }

    function step(ts) {
      rafId = 0;
      if (!isVisible) return;

      if (!lastTs) lastTs = ts;
      var dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;

      if (!isDragging && !isIndeterminate && typeof getLiveFraction === 'function') {
        var liveFrac = getLiveFraction();
        if (typeof liveFrac === 'number' && Number.isFinite(liveFrac)) {
          fraction = clamp(liveFrac, 0, 1);
        }
      }

      var animAllowed = areWaveAnimationsAllowed();
      if (!animAllowed) {
        ampPos = 0;
        ampVel = 0;
        thumbPopPos = 1;
        thumbPopVel = 0;
        seekRippleRemaining = 0;
        lastTs = 0;
        lastDrawTs = 0;
        drawFrame();
        return;
      }

      var targetAmp = (isPlaying && !isDragging) ? 1 : 0;
      var ampAccel = -AMP_STIFFNESS * (ampPos - targetAmp) - AMP_DAMPING * ampVel;
      ampVel += ampAccel * dt;
      ampPos += ampVel * dt;
      if (targetAmp === 0 && ampPos < -0.1) {
        ampPos = -0.1;
      }

      var targetThumbY = isDragging ? 1.24 : 1.0;
      var thumbAccel = -THUMB_POP_STIFFNESS * (thumbPopPos - targetThumbY) - THUMB_POP_DAMPING * thumbPopVel;
      thumbPopVel += thumbAccel * dt;
      thumbPopPos += thumbPopVel * dt;

      if (seekRippleRemaining > 0) {
        seekRippleRemaining = Math.max(0, seekRippleRemaining - dt);
      }

      if (isPlaying) {
        phaseOffset = (phaseOffset + PHASE_SPEED * dt) % (WAVE_LENGTH * 100);
      }

      var ampSettled = Math.abs(ampPos - targetAmp) < 0.004 && Math.abs(ampVel) < 0.01;
      var thumbSettled = Math.abs(thumbPopPos - targetThumbY) < 0.004 && Math.abs(thumbPopVel) < 0.01;
      var needsNextFrame = isPlaying || !ampSettled || !thumbSettled || seekRippleRemaining > 0;

      if (!needsNextFrame) {
        ampPos = targetAmp;
        ampVel = 0;
        thumbPopPos = targetThumbY;
        thumbPopVel = 0;
        seekRippleRemaining = 0;
        lastTs = 0;
        lastDrawTs = ts;
        drawFrame();
        return;
      }

      var fps12 = isTwelveFpsMode();
      if (!fps12 || !lastDrawTs || (ts - lastDrawTs) >= 82) {
        lastDrawTs = ts;
        drawFrame();
      }

      rafId = requestAnimationFrame(step);
    }

    function scheduleAnimation() {
      if (!isVisible || rafId) return;
      var animAllowed = areWaveAnimationsAllowed();
      if (!animAllowed) {
        ampPos = 0;
        ampVel = 0;
        thumbPopPos = 1;
        thumbPopVel = 0;
        seekRippleRemaining = 0;
        drawFrame();
        return;
      }
      var targetAmp = (isPlaying && !isDragging) ? 1 : 0;
      var targetThumbY = isDragging ? 1.24 : 1.0;
      var ampSettled = Math.abs(ampPos - targetAmp) < 0.004 && Math.abs(ampVel) < 0.01;
      var thumbSettled = Math.abs(thumbPopPos - targetThumbY) < 0.004 && Math.abs(thumbPopVel) < 0.01;
      if (isPlaying || !ampSettled || !thumbSettled || seekRippleRemaining > 0) {
        lastTs = 0;
        lastDrawTs = 0;
        rafId = requestAnimationFrame(step);
      } else {
        drawFrame();
      }
    }

    function stopAnimation() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      lastTs = 0;
      lastDrawTs = 0;
    }

    function pointerToFraction(clientX) {
      var rect = canvas.getBoundingClientRect();
      var startX = rect.left + H_PAD;
      var trackWidth = Math.max(12, rect.width - H_PAD * 2);
      return clamp((clientX - startX) / trackWidth, 0, 1);
    }

    function onPointerDown(e) {
      if (isIndeterminate || !isSeekable || e.button > 0) return;
      isDragging = true;
      seekRippleRemaining = 0;
      if (typeof canvas.setPointerCapture === 'function') {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      if (typeof onScrubStateChange === 'function') onScrubStateChange(true);
      fraction = pointerToFraction(e.clientX);
      if (typeof onSeekFraction === 'function') onSeekFraction(fraction);
      scheduleAnimation();
      drawFrame();
    }

    function onPointerMove(e) {
      if (!isDragging || isIndeterminate || !isSeekable) return;
      fraction = pointerToFraction(e.clientX);
      if (typeof onSeekFraction === 'function') onSeekFraction(fraction);
      drawFrame();
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;
      if (typeof canvas.releasePointerCapture === 'function') {
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      if (typeof onScrubStateChange === 'function') onScrubStateChange(false);
      if (areWaveAnimationsAllowed()) {
        thumbPopVel = -5.5;
        seekRippleRemaining = SEEK_RIPPLE_DURATION;
        seekRippleCenterFrac = fraction;
      }
      scheduleAnimation();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    var observeTarget = canvas.parentElement || containerEl || canvas;
    if (typeof ResizeObserver === 'function' && observeTarget) {
      resizeObserver = new ResizeObserver(function () {
        if (!isVisible || resizeRafId) return;
        resizeRafId = requestAnimationFrame(function () {
          resizeRafId = 0;
          if (isVisible) {
            refreshMetrics();
            drawFrame();
          }
        });
      });
      resizeObserver.observe(observeTarget);
    }

    return {
      setPlaying: function (playing) {
        var next = Boolean(playing);
        if (isPlaying === next) return;
        isPlaying = next;
        scheduleAnimation();
      },
      setProgress: function (nextFraction) {
        if (isDragging) return;
        fraction = clamp(Number(nextFraction) || 0, 0, 1);
        if (!rafId && isVisible) drawFrame();
      },
      setIndeterminate: function (indet) {
        var next = Boolean(indet);
        if (isIndeterminate === next) return;
        isIndeterminate = next;
        canvas.classList.toggle('is-indeterminate', isIndeterminate || !isSeekable);
        if (!rafId && isVisible) drawFrame();
      },
      setSeekable: function (seekable) {
        var next = Boolean(seekable);
        if (isSeekable === next) return;
        isSeekable = next;
        canvas.classList.toggle('is-indeterminate', isIndeterminate || !isSeekable);
      },
      setVisible: function (vis) {
        var next = Boolean(vis);
        isVisible = next;
        if (!next) {
          ampPos = 0;
          ampVel = 0;
          thumbPopPos = 1;
          thumbPopVel = 0;
          seekRippleRemaining = 0;
          stopAnimation();
          return;
        }
        refreshMetrics();
        drawFrame();
        scheduleAnimation();
      },
      isScrubbing: function () {
        return isDragging;
      },
      redraw: function () {
        refreshMetrics();
        if (isVisible) {
          if (!areWaveAnimationsAllowed()) {
            ampPos = 0;
            ampVel = 0;
            thumbPopPos = 1;
            thumbPopVel = 0;
            seekRippleRemaining = 0;
            stopAnimation();
          }
          drawFrame();
          scheduleAnimation();
        }
      },
      destroy: function () {
        stopAnimation();
        if (resizeRafId) {
          cancelAnimationFrame(resizeRafId);
          resizeRafId = 0;
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
      }
    };
  }

  function normalizeCornerName(corner) {
    var raw = String(corner || '').trim().toLowerCase();
    if (raw === 'top-left' || raw === 'top-right' || raw === 'bottom-left' || raw === 'bottom-right') {
      return raw;
    }
    if (raw === 'left') return 'bottom-left';
    return 'bottom-right';
  }

  /**
   * Floating miniplayer drag + elastic spring corner snap + plucked tether controller.
   */
  function createCornerDragController(options) {
    var barEl = options && options.barEl;
    var overlayEl = options && options.overlayEl;
    var dockTargetEl = options && options.dockTargetEl;
    var tetherMainEl = options && options.tetherMainEl;
    var tetherSub1El = options && options.tetherSub1El;
    var tetherSub2El = options && options.tetherSub2El;
    var tetherCrossEl = options && options.tetherCrossEl;
    var tetherNodeEl = options && options.tetherNodeEl;
    var cornerRippleEl = options && options.cornerRippleEl;
    var onCornerCommit = options && options.onCornerCommit;

    if (!barEl) {
      return {
        syncSafeInset: function () {},
        cancelMotion: function () {},
        destroy: function () {}
      };
    }

    var DRAG_THRESHOLD_PX = 5;
    var STIFFNESS = 290;
    var DAMPING = 22;
    var PLUCK_DURATION_MS = 380;
    var activePointerId = null;
    var pointerDown = false;
    var isDragging = false;
    var springRafId = 0;
    var pluckRafId = 0;
    var pluckToken = 0;
    var snapClearTimer = 0;
    var rippleTimer = 0;
    var cornerLockTimer = 0;
    var startClientX = 0;
    var startClientY = 0;
    var startRectLeft = 0;
    var startRectTop = 0;
    var curX = 0;
    var curY = 0;
    var curTilt = 0;
    var boxW = 312;
    var boxH = 160;
    var velSamples = [];
    var currentTargetCorner = 'bottom-right';
    var lastCandidateCorner = '';
    var lastFlowFast = null;
    var cachedSafe = { left: 14, right: 14, bottom: 14, top: 84 };

    function areMotionEffectsAllowed() {
      return areWidgetMotionEffectsAllowed();
    }

    function syncSafeInset() {
      var safe = getSafeViewportMargins();
      cachedSafe = safe;
      barEl.style.setProperty('--mp-top-safe', safe.top + 'px');
      var reopenBtn = typeof document !== 'undefined' ? document.getElementById('sound-test-reopen-btn') : null;
      if (reopenBtn) {
        reopenBtn.style.setProperty('--mp-top-safe', safe.top + 'px');
      }
      return safe;
    }

    function getCornerTargets(w, h) {
      var safe = cachedSafe;
      var vw = window.innerWidth || 1024;
      var vh = window.innerHeight || 768;
      var minX = safe.left;
      var maxX = Math.max(safe.left, vw - w - safe.right);
      var minY = safe.top;
      var maxY = Math.max(safe.top, vh - h - safe.bottom);
      return {
        'top-left': { x: minX, y: minY },
        'top-right': { x: maxX, y: minY },
        'bottom-left': { x: minX, y: maxY },
        'bottom-right': { x: maxX, y: maxY }
      };
    }

    function pickNearestCorner(px, py, vx, vy, w, h) {
      var targets = getCornerTargets(w, h);
      var projX = px + clamp(vx, -1600, 1600) * 0.14;
      var projY = py + clamp(vy, -1600, 1600) * 0.14;
      var bestCorner = 'bottom-right';
      var bestDist = Infinity;
      var names = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      for (var i = 0; i < names.length; i++) {
        var c = names[i];
        var t = targets[c];
        var dx = projX - t.x;
        var dy = projY - t.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          bestCorner = c;
        }
      }
      return { corner: bestCorner, target: targets[bestCorner], all: targets };
    }

    function rubberBandClamp(val, min, max) {
      if (val < min) return min - (min - val) * 0.28;
      if (val > max) return max + (val - max) * 0.28;
      return val;
    }

    function clearTetherPaths() {
      if (tetherMainEl) tetherMainEl.setAttribute('d', '');
      if (tetherSub1El) tetherSub1El.setAttribute('d', '');
      if (tetherSub2El) tetherSub2El.setAttribute('d', '');
      if (tetherCrossEl) {
        tetherCrossEl.setAttribute('d', '');
        tetherCrossEl.classList.remove('is-tense');
      }
      if (tetherNodeEl) {
        tetherNodeEl.setAttribute('cx', '-20');
        tetherNodeEl.setAttribute('cy', '-20');
      }
    }

    function triggerCornerLockFlash() {
      if (!dockTargetEl || !areMotionEffectsAllowed()) return;
      dockTargetEl.classList.remove('is-corner-locked');
      void dockTargetEl.offsetWidth;
      dockTargetEl.classList.add('is-corner-locked');
      if (cornerLockTimer) clearTimeout(cornerLockTimer);
      cornerLockTimer = setTimeout(function () {
        if (dockTargetEl) dockTargetEl.classList.remove('is-corner-locked');
        cornerLockTimer = 0;
      }, 180);
    }

    function updateVisualTether(x, y, cornerName, target, vel) {
      if (dockTargetEl && target) {
        dockTargetEl.style.left = Math.round(target.x) + 'px';
        dockTargetEl.style.top = Math.round(target.y) + 'px';
        dockTargetEl.style.width = Math.round(boxW) + 'px';
        dockTargetEl.style.height = Math.round(boxH) + 'px';
      }

      if (!tetherMainEl || !target) return;

      var isRight = cornerName.indexOf('right') !== -1;
      var isBottom = cornerName.indexOf('bottom') !== -1;

      var anchorX = target.x + (isRight ? boxW : 0);
      var anchorY = target.y + (isBottom ? boxH : 0);
      var playerEdgeX = x + (isRight ? boxW - 6 : 6);
      var playerEdgeY = y + (isBottom ? boxH - 6 : 6);
      var playerCx = x + boxW * 0.5;
      var playerCy = y + boxH * 0.5;

      var midX = (playerCx + anchorX) * 0.5;
      var midY = (playerCy + anchorY) * 0.5;
      var dist = Math.hypot(anchorX - playerCx, anchorY - playerCy);
      var sag = Math.min(30, dist * 0.085);
      var vx = vel ? vel.vx : 0;
      var vy = vel ? vel.vy : 0;
      var whip = clamp(-vx * 0.035, -18, 18);
      var speed = Math.hypot(vx, vy);
      var tensionW = clamp(2.8 - dist / 650, 1.35, 2.8);
      if (overlayEl) {
        overlayEl.style.setProperty('--mp-tether-w', tensionW.toFixed(2));
        var isFast = speed > 450;
        if (isFast !== lastFlowFast) {
          lastFlowFast = isFast;
          overlayEl.style.setProperty('--mp-tether-flow-ms', isFast ? '260ms' : '420ms');
        }
      }

      tetherMainEl.setAttribute(
        'd',
        'M ' + playerCx.toFixed(1) + ' ' + playerCy.toFixed(1) +
        ' Q ' + (midX + whip).toFixed(1) + ' ' + (midY + sag).toFixed(1) +
        ' ' + anchorX.toFixed(1) + ' ' + anchorY.toFixed(1)
      );

      var wingAx = target.x + (isRight ? boxW * 0.32 : boxW * 0.68);
      var wingAy = target.y + (isBottom ? boxH : 0);
      var wingBx = target.x + (isRight ? boxW : 0);
      var wingBy = target.y + (isBottom ? boxH * 0.32 : boxH * 0.68);

      if (tetherSub1El) {
        tetherSub1El.setAttribute(
          'd',
          'M ' + playerEdgeX.toFixed(1) + ' ' + playerCy.toFixed(1) +
          ' Q ' + ((playerEdgeX + wingAx) * 0.5 + whip * 0.5).toFixed(1) + ' ' + ((playerCy + wingAy) * 0.5 + sag * 0.5).toFixed(1) +
          ' ' + wingAx.toFixed(1) + ' ' + wingAy.toFixed(1)
        );
      }

      if (tetherSub2El) {
        tetherSub2El.setAttribute(
          'd',
          'M ' + playerCx.toFixed(1) + ' ' + playerEdgeY.toFixed(1) +
          ' Q ' + ((playerCx + wingBx) * 0.5 - whip * 0.4).toFixed(1) + ' ' + ((playerEdgeY + wingBy) * 0.5 - sag * 0.35).toFixed(1) +
          ' ' + wingBx.toFixed(1) + ' ' + wingBy.toFixed(1)
        );
      }

      if (tetherCrossEl) {
        var r1x = wingAx + (playerEdgeX - wingAx) * 0.28;
        var r1y = wingAy + (playerCy - wingAy) * 0.28;
        var r2x = wingBx + (playerCx - wingBx) * 0.28;
        var r2y = wingBy + (playerEdgeY - wingBy) * 0.28;
        var ctrlX = anchorX + (playerCx - anchorX) * 0.14;
        var ctrlY = anchorY + (playerCy - anchorY) * 0.14;
        tetherCrossEl.setAttribute(
          'd',
          'M ' + r1x.toFixed(1) + ' ' + r1y.toFixed(1) +
          ' Q ' + ctrlX.toFixed(1) + ' ' + ctrlY.toFixed(1) +
          ' ' + r2x.toFixed(1) + ' ' + r2y.toFixed(1)
        );
        tetherCrossEl.classList.toggle('is-tense', dist > 180);
      }

      if (tetherNodeEl) {
        tetherNodeEl.setAttribute('cx', anchorX.toFixed(1));
        tetherNodeEl.setAttribute('cy', anchorY.toFixed(1));
      }
    }

    function applyFreePosition(x, y, tiltDeg) {
      barEl.style.left = x.toFixed(2) + 'px';
      barEl.style.top = y.toFixed(2) + 'px';
      barEl.style.right = 'auto';
      barEl.style.bottom = 'auto';
      if (typeof tiltDeg === 'number') {
        barEl.style.setProperty('--mp-drag-tilt', tiltDeg.toFixed(2) + 'deg');
      }
    }

    function cancelPluck() {
      pluckToken += 1;
      if (pluckRafId) {
        cancelAnimationFrame(pluckRafId);
        pluckRafId = 0;
      }
      if (overlayEl) {
        overlayEl.classList.remove('is-plucking');
        overlayEl.style.opacity = '';
      }
    }

    function hideOverlayIfIdle() {
      if (!overlayEl || isDragging || springRafId || pluckRafId || rippleTimer) return;
      overlayEl.classList.add('hidden');
      if (dockTargetEl) dockTargetEl.style.opacity = '';
    }

    function triggerCornerRipple(cornerName, target) {
      if (!cornerRippleEl || !overlayEl || !target || !areMotionEffectsAllowed()) return;
      var isRight = cornerName.indexOf('right') !== -1;
      var isBottom = cornerName.indexOf('bottom') !== -1;
      var rx = target.x + (isRight ? boxW : 0);
      var ry = target.y + (isBottom ? boxH : 0);

      if (dockTargetEl) dockTargetEl.style.opacity = '0';
      cornerRippleEl.style.left = Math.round(rx) + 'px';
      cornerRippleEl.style.top = Math.round(ry) + 'px';
      cornerRippleEl.classList.remove('hidden');
      void cornerRippleEl.offsetWidth;

      if (rippleTimer) clearTimeout(rippleTimer);
      rippleTimer = setTimeout(function () {
        rippleTimer = 0;
        cornerRippleEl.classList.add('hidden');
        hideOverlayIfIdle();
      }, 340);
    }

    function buildPluckCubic(px, py, ax, ay, nx, ny, a1, a2) {
      var dx = ax - px;
      var dy = ay - py;
      var c1x = px + dx * 0.25 + nx * a1;
      var c1y = py + dy * 0.25 + ny * a1;
      var c2x = px + dx * 0.75 + nx * a2;
      var c2y = py + dy * 0.75 + ny * a2;
      return 'M ' + px.toFixed(1) + ' ' + py.toFixed(1) +
        ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) +
        ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) +
        ' ' + ax.toFixed(1) + ' ' + ay.toFixed(1);
    }

    function triggerTetherPluckDecay(cornerName, targetPos, impactSpeed) {
      cancelPluck();
      if (!overlayEl || !tetherMainEl || !targetPos || !areMotionEffectsAllowed()) {
        clearTetherPaths();
        hideOverlayIfIdle();
        return;
      }

      var myToken = ++pluckToken;
      var isRight = cornerName.indexOf('right') !== -1;
      var isBottom = cornerName.indexOf('bottom') !== -1;
      var dirX = isRight ? 1 : -1;
      var dirY = isBottom ? 1 : -1;
      var ax = targetPos.x + (isRight ? boxW : 0) + dirX * 12;
      var ay = targetPos.y + (isBottom ? boxH : 0) + dirY * 12;

      var pxMain = targetPos.x + (isRight ? boxW * 0.22 : boxW * 0.78);
      var pyMain = targetPos.y + (isBottom ? boxH : 0);
      var pxSub1 = targetPos.x + (isRight ? boxW : 0);
      var pySub1 = targetPos.y + (isBottom ? boxH * 0.22 : boxH * 0.78);
      var pxSub2 = targetPos.x + (isRight ? boxW * 0.55 : boxW * 0.45);
      var pySub2 = pyMain;

      function unitNormal(px, py) {
        var dx = ax - px;
        var dy = ay - py;
        var len = Math.hypot(dx, dy) || 1;
        return { nx: -dy / len, ny: dx / len };
      }

      var nMain = unitNormal(pxMain, pyMain);
      var nSub1 = unitNormal(pxSub1, pySub1);
      var nSub2 = unitNormal(pxSub2, pySub2);
      var peakAmp = clamp((Number(impactSpeed) || 350) * 0.022, 6, 20);
      var fps12 = isTwelveFpsMode();
      var startTs = 0;
      var lastQuantStep = -1;

      overlayEl.classList.remove('hidden');
      overlayEl.classList.add('is-plucking');
      overlayEl.style.opacity = '1';
      if (dockTargetEl) dockTargetEl.style.opacity = '0';
      if (tetherCrossEl) {
        tetherCrossEl.setAttribute('d', '');
        tetherCrossEl.classList.remove('is-tense');
      }
      if (tetherNodeEl) {
        tetherNodeEl.setAttribute('cx', ax.toFixed(1));
        tetherNodeEl.setAttribute('cy', ay.toFixed(1));
      }

      function pluckTick(ts) {
        pluckRafId = 0;
        if (myToken !== pluckToken || isDragging || springRafId || barEl.classList.contains('hidden')) {
          return;
        }
        if (!startTs) startTs = ts;
        var elapsedMs = ts - startTs;

        if (elapsedMs >= PLUCK_DURATION_MS) {
          cancelPluck();
          clearTetherPaths();
          if (dockTargetEl) dockTargetEl.style.opacity = '';
          hideOverlayIfIdle();
          return;
        }

        var elapsedSec = elapsedMs / 1000;
        if (fps12) {
          var qStep = Math.floor(elapsedSec * 12);
          if (qStep === lastQuantStep) {
            pluckRafId = requestAnimationFrame(pluckTick);
            return;
          }
          lastQuantStep = qStep;
          elapsedSec = qStep / 12;
        }

        var amp = peakAmp * Math.exp(-7.5 * elapsedSec) * Math.cos(38 * elapsedSec);
        tetherMainEl.setAttribute('d', buildPluckCubic(pxMain, pyMain, ax, ay, nMain.nx, nMain.ny, amp * 1.33, amp * 1.33));
        if (tetherSub1El) {
          var a1 = -0.55 * amp * 1.33;
          tetherSub1El.setAttribute('d', buildPluckCubic(pxSub1, pySub1, ax, ay, nSub1.nx, nSub1.ny, a1, a1));
        }
        if (tetherSub2El) {
          var a2 = 0.35 * amp * 1.33;
          tetherSub2El.setAttribute('d', buildPluckCubic(pxSub2, pySub2, ax, ay, nSub2.nx, nSub2.ny, a2, -a2));
        }

        if (elapsedMs >= 290) {
          var fadeStep = Math.floor(((elapsedMs - 290) / 90) * 3) / 3;
          overlayEl.style.opacity = String(Math.max(0, 1 - clamp(fadeStep, 0, 1)));
        }

        pluckRafId = requestAnimationFrame(pluckTick);
      }

      pluckRafId = requestAnimationFrame(pluckTick);
    }

    function clearInlinePositionAndDock(cornerName, target, impactSpeed) {
      var normalized = normalizeCornerName(cornerName);
      curTilt = 0;
      barEl.style.left = '';
      barEl.style.top = '';
      barEl.style.right = '';
      barEl.style.bottom = '';
      barEl.style.setProperty('--mp-drag-tilt', '0deg');
      barEl.classList.remove('is-dragging', 'is-snapping');
      barEl.setAttribute('data-corner', normalized);
      syncSafeInset();

      if (areMotionEffectsAllowed()) {
        barEl.classList.remove('is-snapped');
        void barEl.offsetWidth;
        barEl.classList.add('is-snapped');
        if (snapClearTimer) clearTimeout(snapClearTimer);
        snapClearTimer = setTimeout(function () {
          barEl.classList.remove('is-snapped');
          snapClearTimer = 0;
        }, 295);
        triggerCornerRipple(normalized, target);
        if (impactSpeed > 0) {
          triggerTetherPluckDecay(normalized, target, impactSpeed);
        } else {
          clearTetherPaths();
          hideOverlayIfIdle();
        }
      } else {
        cancelPluck();
        clearTetherPaths();
        if (overlayEl) overlayEl.classList.add('hidden');
      }

      if (typeof onCornerCommit === 'function') {
        onCornerCommit(normalized);
      }
    }

    function cancelSpring() {
      if (springRafId) {
        cancelAnimationFrame(springRafId);
        springRafId = 0;
      }
    }

    function computeVelocity() {
      if (velSamples.length < 2) return { vx: 0, vy: 0 };
      var newest = velSamples[velSamples.length - 1];
      var oldest = velSamples[0];
      var dtSec = (newest.t - oldest.t) / 1000;
      if (dtSec < 0.008) return { vx: 0, vy: 0 };
      return {
        vx: (newest.x - oldest.x) / dtSec,
        vy: (newest.y - oldest.y) / dtSec
      };
    }

    function pushVelSample(x, y, t) {
      velSamples.push({ x: x, y: y, t: t });
      var cutoff = t - 90;
      while (velSamples.length > 2 && velSamples[0].t < cutoff) {
        velSamples.shift();
      }
    }

    function snapWithSpring(targetCorner, targetPos, initVx, initVy) {
      cancelSpring();
      cancelPluck();
      if (!areMotionEffectsAllowed()) {
        clearInlinePositionAndDock(targetCorner, targetPos, 0);
        return;
      }

      barEl.classList.remove('is-dragging');
      barEl.classList.add('is-snapping');
      if (overlayEl) overlayEl.classList.remove('hidden');
      if (dockTargetEl) dockTargetEl.style.opacity = '';

      var x = curX;
      var y = curY;
      var vx = clamp(initVx, -1800, 1800);
      var vy = clamp(initVy, -1800, 1800);
      var lastTs = 0;
      var lastRenderTs = 0;
      var fps12 = isTwelveFpsMode();

      function tick(ts) {
        springRafId = 0;
        if (!lastTs) lastTs = ts;
        var dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000));
        lastTs = ts;

        var ax = -STIFFNESS * (x - targetPos.x) - DAMPING * vx;
        var ay = -STIFFNESS * (y - targetPos.y) - DAMPING * vy;
        vx += ax * dt;
        vy += ay * dt;
        x += vx * dt;
        y += vy * dt;
        curTilt = curTilt * Math.pow(0.05, dt);

        var dist = Math.hypot(targetPos.x - x, targetPos.y - y);
        var speed = Math.hypot(vx, vy);
        if (dist < 0.7 && speed < 10) {
          curX = targetPos.x;
          curY = targetPos.y;
          var impactSpeed = Math.max(speed, Math.hypot(initVx, initVy) * 0.45, 280);
          clearInlinePositionAndDock(targetCorner, targetPos, impactSpeed);
          return;
        }

        if (!fps12 || !lastRenderTs || (ts - lastRenderTs) >= 82) {
          lastRenderTs = ts;
          applyFreePosition(x, y, curTilt);
          updateVisualTether(x, y, targetCorner, targetPos, { vx: vx, vy: vy });
        }

        springRafId = requestAnimationFrame(tick);
      }

      springRafId = requestAnimationFrame(tick);
    }

    function onPointerDown(e) {
      if (e.button > 0) return;
      if (barEl.classList.contains('is-resizing')) return;
      if (e.target && typeof e.target.closest === 'function') {
        if (e.target.closest('button, input, canvas, a, select, label, .soundTestResizeGrip, [role="separator"]')) return;
      }

      cancelSpring();
      cancelPluck();
      syncSafeInset();
      var rect = barEl.getBoundingClientRect();
      boxW = rect.width || 312;
      boxH = rect.height || 160;
      startRectLeft = rect.left;
      startRectTop = rect.top;
      curX = rect.left;
      curY = rect.top;
      startClientX = e.clientX;
      startClientY = e.clientY;
      activePointerId = e.pointerId;
      pointerDown = true;
      isDragging = false;
      lastCandidateCorner = normalizeCornerName(barEl.getAttribute('data-corner'));
      lastFlowFast = null;
      velSamples = [];
      pushVelSample(curX, curY, performance.now());

      if (typeof barEl.setPointerCapture === 'function') {
        try { barEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }

    function onPointerMove(e) {
      if (!pointerDown || e.pointerId !== activePointerId) return;
      var dx = e.clientX - startClientX;
      var dy = e.clientY - startClientY;

      if (!isDragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        isDragging = true;
        if (rippleTimer) {
          clearTimeout(rippleTimer);
          rippleTimer = 0;
        }
        if (cornerRippleEl) cornerRippleEl.classList.add('hidden');
        if (dockTargetEl) dockTargetEl.style.opacity = '';
        barEl.classList.remove('is-snapped', 'is-snapping');
        barEl.classList.add('is-dragging');
        if (overlayEl) {
          overlayEl.classList.remove('hidden', 'is-plucking');
          overlayEl.style.opacity = '';
        }
      }

      var safe = cachedSafe;
      var vw = window.innerWidth || 1024;
      var vh = window.innerHeight || 768;
      var maxX = Math.max(safe.left, vw - boxW - safe.right);
      var maxY = Math.max(safe.top, vh - boxH - safe.bottom);

      curX = rubberBandClamp(startRectLeft + dx, safe.left, maxX);
      curY = rubberBandClamp(startRectTop + dy, safe.top, maxY);
      pushVelSample(curX, curY, performance.now());

      var vel = computeVelocity();
      var targetTilt = areMotionEffectsAllowed() ? clamp(vel.vx * 0.0045, -4.5, 4.5) : 0;
      curTilt = curTilt * 0.68 + targetTilt * 0.32;
      var picked = pickNearestCorner(curX, curY, vel.vx * 0.45, vel.vy * 0.45, boxW, boxH);
      currentTargetCorner = picked.corner;
      if (picked.corner !== lastCandidateCorner) {
        lastCandidateCorner = picked.corner;
        triggerCornerLockFlash();
      }

      applyFreePosition(curX, curY, curTilt);
      updateVisualTether(curX, curY, picked.corner, picked.target, vel);
    }

    function finishDrag(e) {
      if (!pointerDown || (e && e.pointerId !== activePointerId)) return;
      pointerDown = false;
      if (typeof barEl.releasePointerCapture === 'function' && activePointerId !== null) {
        try { barEl.releasePointerCapture(activePointerId); } catch (_) {}
      }
      activePointerId = null;

      if (!isDragging) return;
      isDragging = false;

      var vel = computeVelocity();
      var picked = pickNearestCorner(curX, curY, vel.vx, vel.vy, boxW, boxH);
      currentTargetCorner = picked.corner;
      snapWithSpring(picked.corner, picked.target, vel.vx, vel.vy);
    }

    function onResize() {
      syncSafeInset();
      hideOverlayIfIdle();
    }

    barEl.addEventListener('pointerdown', onPointerDown);
    barEl.addEventListener('pointermove', onPointerMove);
    barEl.addEventListener('pointerup', finishDrag);
    barEl.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', onResize);
    syncSafeInset();

    return {
      syncSafeInset: syncSafeInset,
      cancelMotion: function () {
        isDragging = false;
        pointerDown = false;
        activePointerId = null;
        cancelSpring();
        cancelPluck();
        if (snapClearTimer) {
          clearTimeout(snapClearTimer);
          snapClearTimer = 0;
        }
        if (rippleTimer) {
          clearTimeout(rippleTimer);
          rippleTimer = 0;
        }
        if (cornerLockTimer) {
          clearTimeout(cornerLockTimer);
          cornerLockTimer = 0;
        }
        if (cornerRippleEl) cornerRippleEl.classList.add('hidden');
        if (dockTargetEl) {
          dockTargetEl.classList.remove('is-corner-locked');
          dockTargetEl.style.opacity = '';
        }
        clearTetherPaths();
        if (overlayEl) overlayEl.classList.add('hidden');
        barEl.style.left = '';
        barEl.style.top = '';
        barEl.style.right = '';
        barEl.style.bottom = '';
        barEl.style.setProperty('--mp-drag-tilt', '0deg');
        barEl.classList.remove('is-dragging', 'is-snapping', 'is-snapped');
      },
      destroy: function () {
        cancelSpring();
        cancelPluck();
        if (snapClearTimer) clearTimeout(snapClearTimer);
        if (rippleTimer) clearTimeout(rippleTimer);
        if (cornerLockTimer) clearTimeout(cornerLockTimer);
        barEl.removeEventListener('pointerdown', onPointerDown);
        barEl.removeEventListener('pointermove', onPointerMove);
        barEl.removeEventListener('pointerup', finishDrag);
        barEl.removeEventListener('pointercancel', finishDrag);
        window.removeEventListener('resize', onResize);
      }
    };
  }

  var PLAYER_SIZE_DEFAULT_W = 312;
  var PLAYER_SIZE_DEFAULT_H = 160;
  var PLAYER_SIZE_MIN_W = 204;
  var PLAYER_SIZE_MAX_W = 520;
  var PLAYER_SIZE_MIN_H = 96;
  var PLAYER_SIZE_MAX_H = 290;

  /**
   * Maps floating player box dimensions into one of four layout tiers
   * with hysteresis to avoid visual flicker on boundary drags.
   */
  function resolveSizeTier(width, height, prevTier) {
    var w = Number(width) || PLAYER_SIZE_DEFAULT_W;
    var h = Number(height) || PLAYER_SIZE_DEFAULT_H;
    var hys = 8;

    var microWMax = prevTier === 'micro' ? 264 : 252;
    var microHMax = prevTier === 'micro' ? 128 : 118;
    if (w < microWMax || h < microHMax) {
      return 'micro';
    }

    var compactWMax = prevTier === 'compact' ? 304 : 292;
    var compactHMax = prevTier === 'compact' ? 156 : 146;
    if (w < compactWMax || h < compactHMax) {
      return 'compact';
    }

    var studioWMin = prevTier === 'studio' ? (380 - hys) : (380 + 4);
    var studioHMin = prevTier === 'studio' ? (200 - hys) : (200 + 4);
    if (w >= studioWMin && h >= studioHMin) {
      return 'studio';
    }

    return 'standard';
  }

  /**
   * Corner-anchored resize controller that pulls outward from the diagonal
   * opposite grip while keeping the widget pinned inside its docked corner.
   */
  function createCornerResizeController(options) {
    var barEl = options && options.barEl;
    var gripEl = options && options.gripEl;
    var onResizeStart = options && options.onResizeStart;
    var onSizeChange = options && options.onSizeChange;
    var onSizeCommit = options && options.onSizeCommit;
    var onTierChange = options && options.onTierChange;

    if (!barEl) {
      return {
        setSize: function () {},
        getSize: function () { return { width: PLAYER_SIZE_DEFAULT_W, height: PLAYER_SIZE_DEFAULT_H }; },
        getTier: function () { return 'standard'; },
        syncViewportClamp: function () {},
        resetToDefault: function () {},
        destroy: function () {}
      };
    }

    var RESIZE_STIFFNESS = 340;
    var RESIZE_DAMPING = 22;
    var OVERSCROLL_FACTOR = 0.24;
    var MAX_OVERSCROLL = 26;

    var curW = clamp(Number(options && options.initialWidth) || PLAYER_SIZE_DEFAULT_W, PLAYER_SIZE_MIN_W, PLAYER_SIZE_MAX_W);
    var curH = clamp(Number(options && options.initialHeight) || PLAYER_SIZE_DEFAULT_H, PLAYER_SIZE_MIN_H, PLAYER_SIZE_MAX_H);
    var curTier = resolveSizeTier(curW, curH, null);
    var dispW = curW;
    var dispH = curH;

    var activePointerId = null;
    var isResizing = false;
    var startClientX = 0;
    var startClientY = 0;
    var startW = curW;
    var startH = curH;
    var dirX = 1;
    var dirY = 1;
    var springRafId = 0;
    var settleTimer = 0;
    var tierTimer = 0;
    var cachedBounds = null;
    var TIER_RANK = { micro: 0, compact: 1, standard: 2, studio: 3 };

    function computeViewportBounds() {
      var safe = getSafeViewportMargins();
      var vw = window.innerWidth || 1024;
      var vh = window.innerHeight || 768;
      var maxW = clamp(vw - safe.left - safe.right, PLAYER_SIZE_MIN_W, PLAYER_SIZE_MAX_W);
      var maxH = clamp(vh - safe.top - safe.bottom, PLAYER_SIZE_MIN_H, PLAYER_SIZE_MAX_H);
      cachedBounds = {
        minW: PLAYER_SIZE_MIN_W,
        maxW: Math.max(PLAYER_SIZE_MIN_W, maxW),
        minH: PLAYER_SIZE_MIN_H,
        maxH: Math.max(PLAYER_SIZE_MIN_H, maxH)
      };
      return cachedBounds;
    }

    function getViewportBounds() {
      return cachedBounds || computeViewportBounds();
    }

    function applyOverscroll(raw, min, max) {
      if (raw < min) {
        return min - Math.min(MAX_OVERSCROLL, (min - raw) * OVERSCROLL_FACTOR);
      }
      if (raw > max) {
        return max + Math.min(MAX_OVERSCROLL, (raw - max) * OVERSCROLL_FACTOR);
      }
      return raw;
    }

    function cancelSpring() {
      if (springRafId) {
        cancelAnimationFrame(springRafId);
        springRafId = 0;
      }
    }

    function triggerTierKick(prevTier, nextTier) {
      if (typeof onTierChange === 'function') {
        onTierChange(nextTier, prevTier);
      }
      if (!areWidgetMotionEffectsAllowed()) return;
      var prevRank = Object.prototype.hasOwnProperty.call(TIER_RANK, prevTier) ? TIER_RANK[prevTier] : 2;
      var nextRank = Object.prototype.hasOwnProperty.call(TIER_RANK, nextTier) ? TIER_RANK[nextTier] : 2;
      barEl.setAttribute('data-tier-dir', nextRank >= prevRank ? 'up' : 'down');
      barEl.classList.remove('is-tier-transitioning');
      void barEl.offsetWidth;
      barEl.classList.add('is-tier-transitioning');
      if (tierTimer) clearTimeout(tierTimer);
      tierTimer = setTimeout(function () {
        barEl.classList.remove('is-tier-transitioning');
        barEl.removeAttribute('data-tier-dir');
        tierTimer = 0;
      }, 240);
    }

    function triggerSettleBounce() {
      if (!areWidgetMotionEffectsAllowed()) return;
      barEl.classList.remove('is-resize-settling');
      void barEl.offsetWidth;
      barEl.classList.add('is-resize-settling');
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        barEl.classList.remove('is-resize-settling');
        settleTimer = 0;
      }, 240);
    }

    function applyBoxDimensions(w, h, strain, notify) {
      dispW = w;
      dispH = h;
      barEl.style.setProperty('--mp-player-w', Math.round(w * 10) / 10 + 'px');
      barEl.style.setProperty('--mp-player-h', Math.round(h * 10) / 10 + 'px');
      barEl.style.setProperty('--mp-resize-strain', clamp(strain || 0, 0, 1).toFixed(3));

      var nextTier = resolveSizeTier(w, h, curTier);
      if (nextTier !== curTier) {
        var prevTier = curTier;
        curTier = nextTier;
        barEl.setAttribute('data-size-tier', nextTier);
        if (notify) {
          triggerTierKick(prevTier, nextTier);
        } else if (typeof onTierChange === 'function') {
          onTierChange(nextTier, prevTier);
        }
      } else if (barEl.getAttribute('data-size-tier') !== curTier) {
        barEl.setAttribute('data-size-tier', curTier);
      }

      if (notify && typeof onSizeChange === 'function') {
        onSizeChange(Math.round(w), Math.round(h), curTier);
      }
    }

    function commitDimensions(w, h) {
      var b = getViewportBounds();
      curW = Math.round(clamp(w, b.minW, b.maxW));
      curH = Math.round(clamp(h, b.minH, b.maxH));
      applyBoxDimensions(curW, curH, 0, true);
      if (typeof onSizeCommit === 'function') {
        onSizeCommit(curW, curH, curTier);
      }
    }

    function springBackToBounds(targetW, targetH) {
      cancelSpring();
      if (!areWidgetMotionEffectsAllowed()) {
        commitDimensions(targetW, targetH);
        return;
      }

      var w = dispW;
      var h = dispH;
      var vw = 0;
      var vh = 0;
      var lastTs = 0;
      var lastRenderTs = 0;
      var fps12 = isTwelveFpsMode();

      function tick(ts) {
        springRafId = 0;
        if (!lastTs) lastTs = ts;
        var dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000));
        lastTs = ts;

        var aw = -RESIZE_STIFFNESS * (w - targetW) - RESIZE_DAMPING * vw;
        var ah = -RESIZE_STIFFNESS * (h - targetH) - RESIZE_DAMPING * vh;
        vw += aw * dt;
        vh += ah * dt;
        w += vw * dt;
        h += vh * dt;

        var dist = Math.hypot(targetW - w, targetH - h);
        var speed = Math.hypot(vw, vh);
        if (dist < 0.5 && speed < 8) {
          commitDimensions(targetW, targetH);
          triggerSettleBounce();
          return;
        }

        if (!fps12 || !lastRenderTs || (ts - lastRenderTs) >= 82) {
          lastRenderTs = ts;
          var strain = clamp(dist / MAX_OVERSCROLL, 0, 1);
          applyBoxDimensions(w, h, strain, true);
        }

        springRafId = requestAnimationFrame(tick);
      }

      springRafId = requestAnimationFrame(tick);
    }

    function onGripPointerDown(e) {
      if (e.button > 0) return;
      if (barEl.classList.contains('is-minimized')) return;
      e.preventDefault();
      e.stopPropagation();

      cancelSpring();
      computeViewportBounds();
      if (typeof onResizeStart === 'function') {
        onResizeStart();
      }

      var corner = normalizeCornerName(barEl.getAttribute('data-corner'));
      dirX = corner.indexOf('right') !== -1 ? 1 : -1;
      dirY = corner.indexOf('bottom') !== -1 ? 1 : -1;

      var rect = barEl.getBoundingClientRect();
      startW = rect.width || curW;
      startH = rect.height || curH;
      startClientX = e.clientX;
      startClientY = e.clientY;
      activePointerId = e.pointerId;
      isResizing = true;

      barEl.classList.remove('is-resize-settling', 'is-dragging', 'is-snapping');
      barEl.classList.add('is-resizing');

      if (gripEl && typeof gripEl.setPointerCapture === 'function') {
        try { gripEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }

    function onGripPointerMove(e) {
      if (!isResizing || e.pointerId !== activePointerId) return;
      var rawW = startW + (startClientX - e.clientX) * dirX;
      var rawH = startH + (startClientY - e.clientY) * dirY;
      var b = getViewportBounds();
      var nextW = applyOverscroll(rawW, b.minW, b.maxW);
      var nextH = applyOverscroll(rawH, b.minH, b.maxH);
      var clampedW = clamp(rawW, b.minW, b.maxW);
      var clampedH = clamp(rawH, b.minH, b.maxH);
      var overX = Math.abs(nextW - clampedW);
      var overY = Math.abs(nextH - clampedH);
      var strain = clamp(Math.max(overX, overY) / MAX_OVERSCROLL, 0, 1);

      curW = clampedW;
      curH = clampedH;
      applyBoxDimensions(nextW, nextH, strain, true);
    }

    function finishResize(e) {
      if (!isResizing || (e && e.pointerId !== activePointerId)) return;
      isResizing = false;
      if (gripEl && typeof gripEl.releasePointerCapture === 'function' && activePointerId !== null) {
        try { gripEl.releasePointerCapture(activePointerId); } catch (_) {}
      }
      activePointerId = null;
      barEl.classList.remove('is-resizing');

      var b = getViewportBounds();
      var targetW = Math.round(clamp(curW, b.minW, b.maxW));
      var targetH = Math.round(clamp(curH, b.minH, b.maxH));
      var overshoot = Math.hypot(dispW - targetW, dispH - targetH);

      if (overshoot > 0.75) {
        springBackToBounds(targetW, targetH);
      } else {
        commitDimensions(targetW, targetH);
        triggerSettleBounce();
      }
    }

    function onGripDblClick(e) {
      e.preventDefault();
      e.stopPropagation();
      cancelSpring();
      computeViewportBounds();
      commitDimensions(PLAYER_SIZE_DEFAULT_W, PLAYER_SIZE_DEFAULT_H);
      triggerSettleBounce();
    }

    function onGripKeyDown(e) {
      if (!e || barEl.classList.contains('is-minimized')) return;
      var step = e.shiftKey ? 32 : 16;
      var corner = normalizeCornerName(barEl.getAttribute('data-corner'));
      var kx = corner.indexOf('right') !== -1 ? 1 : -1;
      var ky = corner.indexOf('bottom') !== -1 ? 1 : -1;
      var handled = true;
      var targetW = curW;
      var targetH = curH;

      if (e.key === 'ArrowLeft') {
        targetW += step * kx;
      } else if (e.key === 'ArrowRight') {
        targetW -= step * kx;
      } else if (e.key === 'ArrowUp') {
        targetH += step * ky;
      } else if (e.key === 'ArrowDown') {
        targetH -= step * ky;
      } else if (e.key === 'Home' || e.key === 'Enter') {
        targetW = PLAYER_SIZE_DEFAULT_W;
        targetH = PLAYER_SIZE_DEFAULT_H;
      } else {
        handled = false;
      }

      if (!handled) return;
      e.preventDefault();
      computeViewportBounds();
      commitDimensions(targetW, targetH);
      triggerSettleBounce();
    }

    function syncViewportClamp() {
      var b = computeViewportBounds();
      var clampedW = clamp(curW, b.minW, b.maxW);
      var clampedH = clamp(curH, b.minH, b.maxH);
      applyBoxDimensions(clampedW, clampedH, 0, false);
    }

    if (gripEl) {
      gripEl.addEventListener('pointerdown', onGripPointerDown);
      gripEl.addEventListener('pointermove', onGripPointerMove);
      gripEl.addEventListener('pointerup', finishResize);
      gripEl.addEventListener('pointercancel', finishResize);
      gripEl.addEventListener('dblclick', onGripDblClick);
      gripEl.addEventListener('keydown', onGripKeyDown);
    }
    window.addEventListener('resize', syncViewportClamp);
    syncViewportClamp();

    return {
      setSize: function (w, h, opts) {
        cancelSpring();
        var b = computeViewportBounds();
        var targetW = clamp(Number(w) || PLAYER_SIZE_DEFAULT_W, b.minW, b.maxW);
        var targetH = clamp(Number(h) || PLAYER_SIZE_DEFAULT_H, b.minH, b.maxH);
        curW = Math.round(targetW);
        curH = Math.round(targetH);
        applyBoxDimensions(curW, curH, 0, Boolean(opts && opts.notify));
        if (opts && opts.commit && typeof onSizeCommit === 'function') {
          onSizeCommit(curW, curH, curTier);
        }
      },
      getSize: function () {
        return { width: curW, height: curH };
      },
      getTier: function () {
        return curTier;
      },
      syncViewportClamp: syncViewportClamp,
      cancelMotion: function () {
        isResizing = false;
        activePointerId = null;
        cancelSpring();
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = 0;
        }
        if (tierTimer) {
          clearTimeout(tierTimer);
          tierTimer = 0;
        }
        barEl.classList.remove('is-resizing', 'is-resize-settling', 'is-tier-transitioning');
        barEl.removeAttribute('data-tier-dir');
        barEl.style.setProperty('--mp-resize-strain', '0');
      },
      resetToDefault: function () {
        cancelSpring();
        computeViewportBounds();
        commitDimensions(PLAYER_SIZE_DEFAULT_W, PLAYER_SIZE_DEFAULT_H);
        triggerSettleBounce();
      },
      destroy: function () {
        cancelSpring();
        if (settleTimer) clearTimeout(settleTimer);
        if (tierTimer) clearTimeout(tierTimer);
        if (gripEl) {
          gripEl.removeEventListener('pointerdown', onGripPointerDown);
          gripEl.removeEventListener('pointermove', onGripPointerMove);
          gripEl.removeEventListener('pointerup', finishResize);
          gripEl.removeEventListener('pointercancel', finishResize);
          gripEl.removeEventListener('dblclick', onGripDblClick);
          gripEl.removeEventListener('keydown', onGripKeyDown);
        }
        window.removeEventListener('resize', syncViewportClamp);
      }
    };
  }

  root.RRWRAudioWidget = {
    createMonetController: createMonetController,
    createSquigglyController: createSquigglyController,
    createCornerDragController: createCornerDragController,
    createCornerResizeController: createCornerResizeController,
    resolveSizeTier: resolveSizeTier,
    normalizeCornerName: normalizeCornerName,
    buildMonetTokens: buildMonetTokens
  };
})(window);
