/* 靜音牆 QuietWall － 共用設定與工具（content / popup / options / background 皆可載入） */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  /** 支援的網站（階段性擴充） */
  PB.SITES = [
    { id: 'facebook',  label: 'Facebook',    host: 'facebook.com',  stage: 1 },
    { id: 'instagram', label: 'Instagram',   host: 'instagram.com', stage: 1 },
    { id: 'threads',   label: 'Threads',     host: 'threads.com',   stage: 1 },
    { id: 'x',         label: 'X / Twitter', host: 'x.com',         stage: 1 },
    { id: 'pornhub',   label: 'Pornhub',     host: 'pornhub.com',   stage: 1 }
  ];

  /** 屏蔽效果 */
  PB.EFFECTS = [
    { id: 'blur',     label: '模糊',     desc: '內容仍在，但看不清楚' },
    { id: 'mosaic',   label: '馬賽克',   desc: '像素化，像打了格子' },
    { id: 'black',    label: '黑條',     desc: '整塊塗黑，像機密文件' },
    { id: 'collapse', label: '收合',     desc: '壓成一條細長提示列' },
    { id: 'hide',     label: '完全隱藏', desc: '整則從版面上消失（無法點開）' }
  ];

  /** 比對模式 */
  PB.MODES = [
    { id: 'plain', label: '包含文字', desc: '只要內文出現這段字就屏蔽（推薦）' },
    { id: 'word',  label: '完整單字', desc: '英數單字需完整符合，適合縮寫' },
    { id: 'regex', label: '正規表示式', desc: '進階：例如 (選舉|罷免).*結果' }
  ];

  PB.TRIGGERS = [
    { id: 'click', label: '點一下顯示' },
    { id: 'hover', label: '滑鼠移過去顯示' },
    { id: 'never', label: '不可顯示（鎖死）' }
  ];

  PB.DEFAULTS = {
    schema: 1,
    enabled: true,
    effect: {
      type: 'blur',
      blur: 14,          // px
      mosaic: 10,        // px 馬賽克格子大小
      darkness: 0.96,    // 黑條不透明度
      collapseHeight: 44 // px
    },
    reveal: {
      trigger: 'click',  // click | hover | never
      showReason: true   // 顯示命中的關鍵字
    },
    sites: { facebook: true, instagram: true, threads: true, x: true, pornhub: true },
    /** rule: { id, pattern, mode, caseSensitive, enabled, sites:['*'|siteId...], effect:'inherit'|effectId, note } */
    rules: [],
    /** 例外關鍵字：命中就一定不屏蔽 */
    allow: [],
    stats: { total: 0, since: 0 }
  };

  PB.uid = function () {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  PB.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /** 深層合併預設值，確保舊版設定升級後不缺欄位 */
  PB.normalizeSettings = function (raw) {
    const d = PB.clone(PB.DEFAULTS);
    if (!raw || typeof raw !== 'object') return d;
    const s = d;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (raw.effect && typeof raw.effect === 'object') Object.assign(s.effect, raw.effect);
    if (raw.reveal && typeof raw.reveal === 'object') Object.assign(s.reveal, raw.reveal);
    if (raw.sites && typeof raw.sites === 'object') Object.assign(s.sites, raw.sites);
    if (raw.stats && typeof raw.stats === 'object') Object.assign(s.stats, raw.stats);
    s.rules = Array.isArray(raw.rules) ? raw.rules.map(PB.normalizeRule).filter(Boolean) : [];
    s.allow = Array.isArray(raw.allow) ? raw.allow.map(PB.normalizeRule).filter(Boolean) : [];
    // 防呆
    s.effect.blur = clamp(s.effect.blur, 2, 40);
    s.effect.mosaic = clamp(s.effect.mosaic, 2, 40);
    s.effect.darkness = clamp(s.effect.darkness, 0.3, 1);
    s.effect.collapseHeight = clamp(s.effect.collapseHeight, 24, 160);
    if (!PB.EFFECTS.some(e => e.id === s.effect.type)) s.effect.type = 'blur';
    if (!PB.TRIGGERS.some(t => t.id === s.reveal.trigger)) s.reveal.trigger = 'click';
    return s;
  };

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }
  PB.clamp = clamp;

  PB.normalizeRule = function (r) {
    if (typeof r === 'string') r = { pattern: r };
    if (!r || typeof r !== 'object') return null;
    const pattern = String(r.pattern == null ? '' : r.pattern).trim();
    if (!pattern) return null;
    const mode = PB.MODES.some(m => m.id === r.mode) ? r.mode : 'plain';
    let sites = Array.isArray(r.sites) && r.sites.length ? r.sites.slice() : ['*'];
    sites = sites.filter(x => x === '*' || PB.SITES.some(s => s.id === x));
    if (!sites.length) sites = ['*'];
    const effect = (r.effect && (r.effect === 'inherit' || PB.EFFECTS.some(e => e.id === r.effect)))
      ? r.effect : 'inherit';
    return {
      id: r.id || PB.uid(),
      pattern,
      mode,
      caseSensitive: !!r.caseSensitive,
      enabled: r.enabled !== false,
      sites,
      effect,
      note: String(r.note || '').slice(0, 200)
    };
  };

  /** 由 hostname 判斷站台 id */
  PB.siteIdFromHost = function (host) {
    host = String(host || '').toLowerCase();
    if (/(^|\.)facebook\.com$/.test(host) || /(^|\.)fb\.com$/.test(host)) return 'facebook';
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
    if (/(^|\.)threads\.(net|com)$/.test(host)) return 'threads';
    if (/(^|\.)(x|twitter)\.com$/.test(host)) return 'x';
    if (/(^|\.)pornhub\.com$/.test(host)) return 'pornhub';
    return null;
  };

  PB.siteLabel = function (id) {
    const s = PB.SITES.find(x => x.id === id);
    return s ? s.label : id;
  };

  PB.loadSettings = function () {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get('settings', data => {
          if (chrome.runtime.lastError) return resolve(PB.normalizeSettings(null));
          resolve(PB.normalizeSettings(data && data.settings));
        });
      } catch (e) { resolve(PB.normalizeSettings(null)); }
    });
  };

  PB.saveSettings = function (settings) {
    return new Promise(resolve => {
      chrome.storage.local.set({ settings: PB.normalizeSettings(settings) }, () => resolve());
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
