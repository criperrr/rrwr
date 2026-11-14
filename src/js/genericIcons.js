/**
 * Generic Keyword -> Inline SVG Icon Registry
 * Maps 150+ generic structural, media, and file-type tokens to 48 crisp SVG icons.
 */
(function (root) {
  'use strict';

  const ICON_PATHS = {
    // Audio / Music
    musicNote: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    albumDisc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 9 9"/>',
    waveform: '<path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3"/>',
    speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l9-5"/><circle cx="8.5" cy="14" r="2"/><path d="M14 12h4M14 16h4"/>',
    playlist: '<path d="M3 6h12M3 12h12M3 18h8"/><circle cx="17" cy="17" r="2.5"/><path d="M19.5 17V9l3-1"/>',
    mic: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5M8 22h8"/>',

    // Reading / Story / Structure
    bookOpen: '<path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v16H4.5A2.5 2.5 0 0 0 2 21V5.5z"/><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v16h6.5a2.5 2.5 0 0 1 2.5 2V5.5z"/>',
    bookClosed: '<path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2V4z"/><path d="M5 18h14"/>',
    pageDoc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h5"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
    comicGrid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M11 3v7M14 10v11"/>',
    timeline: '<circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h12M5 8v10h12"/>',
    sparkles: '<path d="M12 3l1.8 4.8L19 9.5l-5.2 1.7L12 16l-1.8-4.8L5 9.5l5.2-1.7z"/><path d="M5 19l.8 2 .8-2 2-.8-2-.8-.8-2-.8 2-2 .8z"/>',
    flag: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',

    // Text / Logs / Docs / Info
    chatBubble: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 8h8M8 12h5"/>',
    scrollText: '<path d="M8 3h10a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-1"/><path d="M6 3a2 2 0 0 0-2 2v11h4V3H6z"/><path d="M11 8h5M11 12h5"/>',
    helpCircle: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17.2" r=".8" fill="currentColor"/>',
    infoCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor"/>',
    newsPaper: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6v5H7zM15 8h2M15 12h2M7 16h10"/>',
    notePad: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3M15 3v3M8 10h8M8 14h8M8 18h4"/>',
    award: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L7 21l5-2.5L17 21l-2-7.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',

    // Images / Visuals
    imageFrame: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M21 16l-5-5-4 4-3-3-6 6"/>',
    galleryGrid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4.5A4.5 4.5 0 0 0 12 3z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor"/>',
    camera: '<path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/>',
    penNib: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"/><path d="M2 2l7.5 7.5"/>',
    userAvatar: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',

    // Video / Flash / Games / Interactive
    filmStrip: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    playCircle: '<circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8"/>',
    boltFlash: '<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>',
    gamepad: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4"/><circle cx="15.5" cy="11" r="1" fill="currentColor"/><circle cx="17.5" cy="13" r="1" fill="currentColor"/>',
    cubeSim: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7L12 2z"/><path d="M12 22V12M20.5 7L12 12 3.5 7"/>',

    // Data / Code / Files / Folders / Mods
    bracesJson: '<path d="M8 4H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',
    folderDir: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/>',
    packageBox: '<path d="M12 2l9 4.5v11L12 22l-9-4.5v-11L12 2z"/><path d="M3 6.5L12 11l9-4.5M12 11v11M7.5 4.2L16.5 8.7"/>',
    puzzleMod: '<path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4V8z"/>',
    codeTags: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><path d="M13.5 4l-3 16"/>',
    fontType: '<path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M8 20h8"/>',
    genericFile: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',

    // Tools / Navigation / Discovery
    searchGlass: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    compassMap: '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5"/>',
    gitTree: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="9" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7M8.5 6h3a3 3 0 0 1 3 3v0"/>',
    barChart: '<path d="M4 20h16"/><rect x="6" y="12" width="3" height="6"/><rect x="11" y="7" width="3" height="11"/><rect x="16" y="4" width="3" height="14"/>',
    lockKey: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    keyIcon: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l9-9M16 7l3 3"/>',
    wrenchTool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-2.2 2.5-2.5z"/>',
    homeHouse: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z"/>',
    bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
    starFav: '<polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.5 5.8 21 7 14 2 9.3 9 8.5 12 2"/>',
    download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 20h16"/>',
    uploadExport: '<path d="M12 15V3"/><polyline points="7 8 12 3 17 8"/><path d="M4 20h16"/>',

    // Community / Web
    globeWeb: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/>',
    linkChain: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    usersTeam: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 5 6"/>'
  };

  const KEYWORD_TO_ICON = {
    // Audio / Music
    music: 'musicNote', song: 'musicNote', songs: 'musicNote', melody: 'musicNote',
    audio: 'speaker', sound: 'speaker', sounds: 'speaker', sfx: 'speaker', volume: 'speaker',
    track: 'waveform', tracks: 'waveform', beat: 'waveform', ost: 'waveform',
    album: 'albumDisc', albums: 'albumDisc', disc: 'albumDisc', discography: 'albumDisc',
    playlist: 'playlist', radio: 'radio', voice: 'mic',

    // Reading / Story / Structure
    story: 'bookOpen', stories: 'bookOpen', novel: 'bookOpen', saga: 'bookOpen',
    book: 'bookClosed', books: 'bookClosed', volume: 'bookClosed', issue: 'bookClosed',
    chapter: 'layers', chapters: 'layers', act: 'layers', acts: 'layers',
    part: 'layers', parts: 'layers', arc: 'layers', collection: 'layers', series: 'layers',
    page: 'pageDoc', pages: 'pageDoc', episode: 'pageDoc',
    comic: 'comicGrid', webcomic: 'comicGrid', comics: 'comicGrid',
    timeline: 'timeline', prologue: 'flag', epilogue: 'flag', intermission: 'flag',
    extras: 'sparkles', extra: 'sparkles', bonus: 'sparkles',

    // Text / Logs / Docs / Info
    log: 'chatBubble', logs: 'chatBubble', chat: 'chatBubble', dialogue: 'chatBubble', dialog: 'chatBubble',
    transcript: 'scrollText', text: 'scrollText', txt: 'scrollText', md: 'scrollText', markdown: 'scrollText',
    note: 'notePad', notes: 'notePad', journal: 'notePad',
    faq: 'helpCircle', faqs: 'helpCircle', help: 'helpCircle', guide: 'helpCircle',
    readme: 'infoCircle', info: 'infoCircle', about: 'infoCircle', commentary: 'infoCircle',
    news: 'newsPaper', blog: 'newsPaper', post: 'newsPaper', posts: 'newsPaper',
    credits: 'award', history: 'clock',

    // Images / Visuals
    image: 'imageFrame', images: 'imageFrame', img: 'imageFrame', picture: 'imageFrame',
    wallpaper: 'imageFrame', banner: 'imageFrame', panel: 'imageFrame',
    gif: 'imageFrame', png: 'imageFrame', jpg: 'imageFrame', jpeg: 'imageFrame', webp: 'imageFrame', svg: 'imageFrame', bmp: 'imageFrame',
    gallery: 'galleryGrid', thumb: 'galleryGrid', thumbnail: 'galleryGrid',
    art: 'palette', artwork: 'palette', sprite: 'palette',
    photo: 'camera', sketch: 'penNib', icon: 'penNib',
    avatar: 'userAvatar',

    // Video / Flash / Games / Interactive
    video: 'filmStrip', movie: 'filmStrip', film: 'filmStrip', clip: 'filmStrip', cutscene: 'filmStrip',
    mp4: 'filmStrip', webm: 'filmStrip', ogv: 'filmStrip',
    animation: 'playCircle', anim: 'playCircle', play: 'playCircle', media: 'playCircle',
    flash: 'boltFlash', swf: 'boltFlash', ruffle: 'boltFlash',
    game: 'gamepad', games: 'gamepad', interactive: 'gamepad', mini: 'gamepad',
    sim: 'cubeSim',

    // Data / Code / Files / Folders / Mods
    json: 'bracesJson', schema: 'bracesJson', manifest: 'bracesJson', yaml: 'bracesJson', yml: 'bracesJson',
    data: 'database', index: 'database',
    config: 'sliders', settings: 'sliders', prefs: 'sliders',
    dir: 'folderDir', folder: 'folderDir', directory: 'folderDir', root: 'folderDir',
    assets: 'packageBox', resources: 'packageBox', archive: 'packageBox', pack: 'packageBox', bundle: 'packageBox',
    mod: 'puzzleMod', mods: 'puzzleMod', plugin: 'puzzleMod', patch: 'puzzleMod',
    added: 'puzzleMod', custom: 'puzzleMod', override: 'puzzleMod',
    script: 'codeTags', js: 'codeTags', code: 'codeTags', style: 'codeTags', css: 'codeTags', scss: 'codeTags', html: 'codeTags',
    font: 'fontType', fonts: 'fontType', woff: 'fontType', ttf: 'fontType',
    files: 'genericFile', file: 'genericFile',

    // Tools / Navigation / Discovery
    search: 'searchGlass', find: 'searchGlass', filter: 'searchGlass',
    map: 'compassMap',
    tree: 'gitTree', graph: 'gitTree',
    chart: 'barChart',
    secret: 'lockKey', hidden: 'lockKey', lock: 'lockKey',
    unlock: 'keyIcon', key: 'keyIcon', puzzle: 'keyIcon', decode: 'keyIcon',
    tool: 'wrenchTool', tools: 'wrenchTool',
    home: 'homeHouse', start: 'homeHouse', resume: 'homeHouse',
    bookmark: 'bookmark', save: 'bookmark',
    fav: 'starFav', favorite: 'starFav', star: 'starFav',
    download: 'download', import: 'download',
    export: 'uploadExport',

    // Community / Web
    web: 'globeWeb', site: 'globeWeb',
    link: 'linkChain', links: 'linkChain', external: 'linkChain',
    forum: 'usersTeam', community: 'usersTeam', social: 'usersTeam',
    user: 'userAvatar', author: 'userAvatar',
    team: 'usersTeam', fan: 'usersTeam', fans: 'usersTeam'
  };

  const KIND_FALLBACK = {
    BRANCH: 'gitTree',
    PAGE: 'pageDoc',
    ALBUM: 'albumDisc',
    TRACK: 'musicNote',
    DIR: 'folderDir',
    JSON: 'bracesJson',
    FILE: 'genericFile'
  };

  function tokenize(text) {
    return String(text || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function resolveNodeIcon(node) {
    const labelTokens = tokenize(node && node.label);
    const idTokens = tokenize(node && node.id);
    const subTokens = tokenize(node && node.subtitle);
    const candidates = labelTokens.concat(subTokens, idTokens);

    for (const tok of candidates) {
      if (Object.prototype.hasOwnProperty.call(KEYWORD_TO_ICON, tok)) {
        return KEYWORD_TO_ICON[tok];
      }
    }

    const kind = String((node && node.kind) || 'FILE').toUpperCase();
    return KIND_FALLBACK[kind] || 'genericFile';
  }

  function getIconSvg(iconName, size = 16, className = '') {
    const paths = ICON_PATHS[iconName] || ICON_PATHS.genericFile;
    const cls = className ? ` class="${className}"` : '';
    return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  root.RRWRGenericIcons = {
    ICON_PATHS,
    KEYWORD_TO_ICON,
    resolveNodeIcon,
    getIconSvg
  };
})(typeof window !== 'undefined' ? window : globalThis);
