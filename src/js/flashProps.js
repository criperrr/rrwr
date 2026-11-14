/**
 * RRWR (Rust-Ruffle WebComic Reader)
 * Flash Metadata, Audio Calibration & Viewport Timing Tables
 *
 * Exports window.RRWRFlashProps (browser global) and CommonJS module.exports (Node/test environment).
 */
(function (root) {
  'use strict';

  /**
   * Flash viewport dimension and background color overrides keyed by flashId.
   * Default dimensions when not present: width = 650, height = 450, bgcolor = '#fff'.
   */
  const INDEXED_FLASH_PROPS = {};

  /**
   * Initial cropped CSS heights for Flashes that dynamically expand during playback.
   */
  const CROP_HEIGHT = {};

  /**
   * Viewport height transition parameters triggered by `heightStart?<mode>`.
   */
  const HEIGHT_TRANSITIONS = {};

  /**
   * Multi-step stage progression timestamps (in ms) for interactive sequences.
   */
  const STAGE_PROGRESS_STEPS = [];

  const STAGE_PROGRESS = {
    steps: STAGE_PROGRESS_STEPS
  };

  /**
   * Video pause thresholds (in seconds).
   */
  const PAUSE_AT = {};

  /**
   * Calibrated audio sync offsets in milliseconds.
   * Positive value -> delay audio.play() via setTimeout(delay).
   * Negative value -> advance audio.currentTime = -delay / 1000 and play immediately.
   */
  const AUDIO_DELAYS = {};

  /**
   * Page IDs that use `_hq.swf` + external MP3 audio tracks.
   */
  const HQ_PAGE_LIST = [];

  /**
   * Page IDs that use `*_hqbaked.swf` (high-quality audio baked into the SWF).
   */
  const BAKED_PAGE_LIST = [];

  /**
   * Flash IDs (placeholder set for pack-supplied overrides).
   */
  const HQ_FLASH_IDS = new Set([]);
  const BAKED_FLASH_IDS = new Set([]);
  const HQ_PAGES = new Set([...HQ_PAGE_LIST, ...HQ_FLASH_IDS]);
  const BAKED_PAGES = new Set([...BAKED_PAGE_LIST, ...BAKED_FLASH_IDS]);
  const TWO_TRACK_FLASHES = new Set([]);

  /**
   * Extract canonical Flash ID from a media URL and optional pageId,
   * stripping `_hq` and `_hqbaked` suffixes.
   *
   * @param {string} url - Media URL (e.g., `/storyfiles/00100/00100_hq.swf`)
   * @param {string} [_pageId] - Optional 6-digit story page ID
   * @returns {string} Flash ID
   */
  function getFlashIdFromUrl(url, _pageId) {
    if (!url || typeof url !== 'string') return '';
    const cleanUrl = url.split('?')[0].split('#')[0];
    const parts = cleanUrl.split('/');
    const lastPart = parts[parts.length - 1] || '';
    const dotIdx = lastPart.lastIndexOf('.');
    const stem = dotIdx !== -1 ? lastPart.slice(0, dotIdx) : lastPart;
    return stem.replace(/_hqbaked$/i, '').replace(/_hq$/i, '');
  }

  /**
   * Compute the calibrated audio delay in milliseconds for a given Flash ID and track specifier.
   *
   * @param {string} flashId - Flash ID
   * @param {number|string} [trackIndex=1] - 1-based track index or half-segment scrub string (e.g. `'1.5'`)
   * @param {boolean} [isReplay=false] - True when a track is replaying
   * @param {boolean} [isHalfSegmentScrub=false] - True if scrubbing to a `.5` half-segment
   * @returns {number} Calibrated offset in milliseconds
   */
  function getAudioDelay(flashId, trackIndex = 1, isReplay = false, isHalfSegmentScrub = false) {
    if (!flashId) return 0;
    const rawId = String(flashId);
    const trackStr = String(trackIndex ?? 1);

    if (trackStr.endsWith('.5') || isHalfSegmentScrub) {
      const segNum = trackStr.charAt(0);
      const halfKey = `${rawId}_${segNum}.5`;
      if (halfKey in AUDIO_DELAYS) return AUDIO_DELAYS[halfKey];
    }

    const parsedTrack = parseInt(trackStr, 10);
    const trackNum = Number.isNaN(parsedTrack) || parsedTrack < 1 ? 1 : parsedTrack;

    if (isReplay && `${rawId}_replay` in AUDIO_DELAYS) {
      return AUDIO_DELAYS[`${rawId}_replay`];
    }

    const indexedKey = `${rawId}_${trackNum}`;
    if (indexedKey in AUDIO_DELAYS) {
      return AUDIO_DELAYS[indexedKey];
    }

    if (rawId in AUDIO_DELAYS) {
      return AUDIO_DELAYS[rawId];
    }

    return 0;
  }

  /**
   * Build a full HTTP asset URL from an archive-relative path.
   */
  function formatAssetUrl(relPath, assetBase, cacheBuster) {
    if (!relPath || typeof relPath !== 'string') return '';
    if (/^https?:\/\//i.test(relPath)) {
      return relPath;
    }
    let clean = relPath
      .replace(/^assets:\/\//i, '/')
      .replace(/^\/+/, '');
    if (clean.startsWith('assets/')) {
      clean = clean.slice('assets/'.length);
    }
    const base = (assetBase || '').replace(/\/+$/, '');
    const prefix = base ? `${base}/assets/${clean}` : `/assets/${clean}`;
    if (cacheBuster && !prefix.includes('?')) {
      return `${prefix}?v=${encodeURIComponent(cacheBuster)}`;
    }
    return prefix;
  }

  /**
   * Resolve a raw media URL (and optional page context) according to user settings (`hqAudio`, `jsFlashes`)
   * into its effective SWF/image/video/HTML URL, external HQ MP3 tracks, and Flash viewport dimensions/crop properties.
   *
   * @param {string} url - Raw media URL from `story.json`
   * @param {object} [settings={}] - Active user settings (`hqAudio`, `jsFlashes`, etc.)
   * @param {string} [assetBase=''] - Base URL for the Axum asset server
   * @param {string|number} [cacheBuster=''] - Optional VFS overlay generation counter for cache busting
   * @param {string} [pageId=''] - Optional 6-digit story page ID
   * @param {string[]} [pageFlags=[]] - Optional page flags
   * @returns {object} Resolved media descriptor
   */
  function resolveMediaAssets(url, settings = {}, assetBase = '', cacheBuster = '', pageId = '', pageFlags = []) {
    const cfg = settings || {};
    const hqAudio = cfg.hqAudio !== false; // Default true
    const jsFlashes = cfg.jsFlashes !== false; // Default true

    const effectivePath = String(url || '').trim();
    const cleanNoQuery = effectivePath.split('?')[0].split('#')[0];
    const extMatch = cleanNoQuery.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';

    const rawFlashId = getFlashIdFromUrl(cleanNoQuery, '');
    const audioTracks = [];
    let resolvedPath = effectivePath;

    if (ext === 'swf') {
      const baseNoExt = cleanNoQuery.slice(0, -4).replace(/_hqbaked$/i, '').replace(/_hq$/i, '');
      const isHqEligible = hqAudio && (HQ_PAGES.has(pageId) || HQ_PAGES.has(rawFlashId));
      const isBakedEligible = hqAudio && (BAKED_PAGES.has(pageId) || BAKED_PAGES.has(rawFlashId));

      if (isHqEligible) {
        resolvedPath = `${baseNoExt}_hq.swf`;
        audioTracks.push(`${baseNoExt}.mp3`);
      } else if (isBakedEligible) {
        resolvedPath = `${baseNoExt}_hqbaked.swf`;
      }
    }

    const effectiveFlashId = getFlashIdFromUrl(resolvedPath, pageId);
    const rawLookupId = getFlashIdFromUrl(resolvedPath, '');
    const baseDims = INDEXED_FLASH_PROPS[effectiveFlashId] || INDEXED_FLASH_PROPS[rawLookupId] || INDEXED_FLASH_PROPS[rawFlashId] || {};

    const width = baseDims.width || 650;
    const height = baseDims.height || 450;
    const bgcolor = baseDims.bgcolor || '#fff';
    const croppedCssHeight = (jsFlashes && (CROP_HEIGHT[effectiveFlashId] || CROP_HEIGHT[rawLookupId])) || `${height}px`;

    return {
      originalUrl: url,
      effectivePath: resolvedPath,
      resolvedUrl: formatAssetUrl(resolvedPath, assetBase, cacheBuster),
      audioTracks: audioTracks.map((t) => formatAssetUrl(t, assetBase, cacheBuster)),
      rawAudioTracks: audioTracks,
      ext,
      flashId: effectiveFlashId,
      rawFlashId: rawLookupId || rawFlashId,
      width,
      height,
      bgcolor,
      cropHeight: croppedCssHeight,
      isCropped: Boolean(jsFlashes && (CROP_HEIGHT[effectiveFlashId] || CROP_HEIGHT[rawLookupId])),
      pauseAt: PAUSE_AT[rawLookupId] || PAUSE_AT[rawFlashId] || null
    };
  }

  const RRWRFlashProps = {
    // Canonical uppercase constants
    INDEXED_FLASH_PROPS,
    AUDIO_DELAYS,
    HQ_PAGES,
    BAKED_PAGES,
    TWO_TRACK_FLASHES,
    CROP_HEIGHT,
    HEIGHT_TRANSITIONS,
    STAGE_PROGRESS_STEPS,
    STAGE_PROGRESS,
    PAUSE_AT,

    // Lowercase aliases for test and component compatibility
    indexedFlashProps: INDEXED_FLASH_PROPS,
    audioDelay: AUDIO_DELAYS,
    cropHeight: CROP_HEIGHT,
    heightTransitions: HEIGHT_TRANSITIONS,
    stageProgress: STAGE_PROGRESS,
    pauseAt: PAUSE_AT,

    // Helper functions
    getFlashIdFromUrl,
    getAudioDelay,
    formatAssetUrl,
    resolveMediaAssets
  };

  if (typeof root !== 'undefined') {
    root.RRWRFlashProps = RRWRFlashProps;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWRFlashProps;
  }
})(typeof window !== 'undefined' ? window : globalThis);
