/* 遮罩器：負責把效果套上去 / 拿掉，以及「點一下看原文」的互動 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const masked = new Set();
  /* 同一則貼文在「只遮文字／只遮影片」模式下會拆成好幾塊遮罩，
     用群組把它們綁在一起，點任何一塊都一起顯示。 */
  const groups = new Map();
  let groupSeq = 0;
  let cfg = null;
  let filterSize = -1;

  /* ── 馬賽克用的 SVG filter（feTile 像素化）────────────── */
  function buildPixelateFilter(size) {
    const half = Math.max(1, Math.round(size / 2));
    const filter = document.createElementNS(SVG_NS, 'filter');
    // 每個格子大小用不同的 id：Chrome 不會在 SVG filter 內容改變時重繪
    // 參照它的元素，換 id 才能強制重新套用。
    filter.setAttribute('id', 'pb-pixelate-' + size);
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');

    const flood = document.createElementNS(SVG_NS, 'feFlood');
    flood.setAttribute('x', String(half));
    flood.setAttribute('y', String(half));
    flood.setAttribute('width', '1');
    flood.setAttribute('height', '1');

    const comp1 = document.createElementNS(SVG_NS, 'feComposite');
    comp1.setAttribute('width', String(size));
    comp1.setAttribute('height', String(size));

    const tile = document.createElementNS(SVG_NS, 'feTile');
    tile.setAttribute('result', 'a');

    const comp2 = document.createElementNS(SVG_NS, 'feComposite');
    comp2.setAttribute('in', 'SourceGraphic');
    comp2.setAttribute('in2', 'a');
    comp2.setAttribute('operator', 'in');

    const morph = document.createElementNS(SVG_NS, 'feMorphology');
    morph.setAttribute('operator', 'dilate');
    morph.setAttribute('radius', String(half));

    filter.append(flood, comp1, tile, comp2, morph);
    return filter;
  }

  function ensureFilter(size) {
    if (size === filterSize) return;
    const host = document.body || document.documentElement;
    if (!host) return;
    let svg = document.getElementById('pb-svg-defs');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.id = 'pb-svg-defs';
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.cssText = 'position:absolute!important;width:0!important;height:0!important;' +
                          'overflow:hidden!important;pointer-events:none!important';
      host.appendChild(svg);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.appendChild(buildPixelateFilter(size));
    filterSize = size;

    const root = document.documentElement;
    root.style.setProperty('--pb-mosaic', 'url(#pb-pixelate-' + size + ')');
    // 覆蓋層的保底效果：能用 SVG 濾鏡就用，不能就退回等效的模糊
    root.style.setProperty('--pb-mosaic-soft', supportsBackdropUrl()
      ? 'url(#pb-pixelate-' + size + ')'
      : 'blur(' + Math.max(2, Math.round(size * 0.7)) + 'px)');
  }

  let backdropUrlOk = null;
  function supportsBackdropUrl() {
    if (backdropUrlOk === null) {
      try {
        backdropUrlOk = !!(g.CSS && CSS.supports &&
          (CSS.supports('backdrop-filter', 'url(#a)') ||
           CSS.supports('-webkit-backdrop-filter', 'url(#a)')));
      } catch (e) { backdropUrlOk = false; }
    }
    return backdropUrlOk;
  }

  function whenBodyReady(fn) {
    if (document.body) return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  /* ── 設定 ─────────────────────────────────────────── */
  function setConfig(settings) {
    cfg = settings;
    const root = document.documentElement;
    const blur = PB.clamp(settings.effect.blur, 2, 40);
    root.style.setProperty('--pb-blur', blur + 'px');
    // 覆蓋層用稍弱的強度，讓兩段式疊加後的結果接近使用者設定的數值
    root.style.setProperty('--pb-blur-soft', Math.max(2, Math.round(blur * 0.7)) + 'px');
    root.style.setProperty('--pb-dark', String(PB.clamp(settings.effect.darkness, .3, 1)));
    root.style.setProperty('--pb-collapse-h',
      PB.clamp(settings.effect.collapseHeight, 24, 160) + 'px');
    whenBodyReady(() => ensureFilter(Math.round(PB.clamp(settings.effect.mosaic, 2, 40))));
  }

  /* ── 挑出貼文裡要遮住的區塊 ──────────────────────────
     「整則貼文」就是貼文本身；「只遮文字」「只遮圖片與影片」則要在貼文裡
     找出對應的區塊，各自蓋一塊遮罩。 */
  const MEDIA_SEL = 'img, video, canvas, picture, iframe';
  const MEDIA_TAGS = { IMG: 1, VIDEO: 1, CANVAS: 1, PICTURE: 1, IFRAME: 1 };

  let bgCache = null;
  const BG_BUDGET = 600; // 掃背景圖時最多看幾個節點，避免在超深的版面上拖慢

  /** 用 CSS background-image 呈現的圖片也算畫面（漸層不算） */
  function hasBgImage(el) {
    if (bgCache && bgCache.has(el)) return bgCache.get(el);
    let ok = false;
    try {
      const bg = getComputedStyle(el).backgroundImage;
      ok = !!bg && bg !== 'none' && bg.indexOf('url(') !== -1;
    } catch (e) { ok = false; }
    if (bgCache) bgCache.set(el, ok);
    return ok;
  }

  /** 夠大的圖片／影片才算「畫面」，頭像、icon、表情符號不算 */
  function isLargeMedia(el) {
    const r = el.getBoundingClientRect();           // 先量尺寸，比算樣式便宜
    if (r.width < 100 || r.height < 70) return false;
    return !!MEDIA_TAGS[el.tagName] || hasBgImage(el);
  }

  /** 以背景圖呈現的畫面；沒有選擇器查得到，只能走訪，但有節點預算 */
  function collectBgMedia(node, out, state) {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      if (state.n++ > BG_BUDGET) return;
      const el = kids[i];
      if (el.hasAttribute && el.hasAttribute('data-pb-ui')) continue;
      if (!MEDIA_TAGS[el.tagName] && isLargeMedia(el)) { out.push(el); continue; }
      if (el.children.length) collectBgMedia(el, out, state);
    }
  }

  /** 這塊裡面有沒有夠大的畫面（標籤用選擇器找，不受巢狀深度影響） */
  function hasLargeMedia(el) {
    if (isLargeMedia(el)) return true;
    let list;
    try { list = el.querySelectorAll(MEDIA_SEL); } catch (e) { list = null; }
    if (list) for (let i = 0; i < list.length; i++) if (isLargeMedia(list[i])) return true;
    const bg = [];
    collectBgMedia(el, bg, { n: 0 });
    return bg.length > 0;
  }

  /** 這塊裡面有沒有「自己的」文字（不算我們蓋上去的遮罩提示） */
  function hasOwnText(el) {
    const raw = el.textContent || '';
    if (!raw.replace(/\s+/g, '').length) return false;
    if (!masked.size) return true;              // 還沒有任何遮罩，不必扣
    return PB.ownText(el).replace(/\s+/g, '').length > 0;
  }

  /** 去掉被其他項目包住的重複項 */
  function dropNested(list) {
    return list.filter(el => !list.some(other => other !== el && other.contains(el)));
  }

  /**
   * 從一張圖片／影片往上爬，找出「整塊都只有畫面、沒有文字」的最外層容器。
   * 這樣不管網站把圖片包了幾層（Threads 可以包到十幾層）都找得到。
   */
  function pureMediaBlock(media, root) {
    let node = media, parent = media.parentElement;
    while (parent && parent !== root && root.contains(parent)) {
      if (hasOwnText(parent)) break;
      node = parent;
      parent = parent.parentElement;
    }
    return node;
  }

  function mediaTargets(root) {
    const found = [];
    let list;
    try { list = root.querySelectorAll(MEDIA_SEL); } catch (e) { list = null; }
    if (list) for (let i = 0; i < list.length; i++) {
      if (isLargeMedia(list[i])) found.push(list[i]);
    }
    collectBgMedia(root, found, { n: 0 });
    if (!found.length) return [];

    const blocks = [], seen = new Set();
    for (let i = 0; i < found.length; i++) {
      const b = pureMediaBlock(found[i], root);
      if (!seen.has(b)) { seen.add(b); blocks.push(b); }
    }
    return dropNested(blocks);
  }

  function textTargets(root) {
    const out = [];
    (function walk(node, depth) {
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (el.hasAttribute && el.hasAttribute('data-pb-ui')) continue;
        if (hasLargeMedia(el)) {
          // 這塊裡面有畫面，再往下找純文字的部分
          if (depth < 12) walk(el, depth + 1);
          continue;
        }
        if (hasOwnText(el)) out.push(el);
      }
    })(root, 0);
    return dropNested(out);
  }

  /** @returns {Element[]} 要蓋遮罩的區塊；空陣列代表這則貼文沒有需要遮的東西 */
  function pickTargets(container, scope) {
    bgCache = new WeakMap(); // 單次呼叫內共用，避免重複 getComputedStyle
    if (scope === 'media') return mediaTargets(container);
    if (scope === 'text') {
      const t = textTargets(container);
      return t.length ? t : [];
    }
    return [container];
  }

  /* ── 覆蓋層 ───────────────────────────────────────── */
  function buildOverlay(rule, showChip) {
    const ui = document.createElement('div');
    ui.className = showChip ? 'pb-ui' : 'pb-ui pb-plain';
    ui.setAttribute('data-pb-ui', '');
    if (cfg.reveal.trigger === 'never') {
      ui.setAttribute('aria-label', '這則內容已被靜音牆屏蔽');
      ui.classList.add('pb-locked');
    } else {
      ui.setAttribute('role', 'button');
      ui.setAttribute('tabindex', '0');
      ui.setAttribute('aria-label',
        '這則內容已被屏蔽（命中關鍵字：' + rule.label + '），按下以顯示原文');
    }

    // 同一則貼文拆成多塊時，只有其中一塊掛提示膠囊，其餘保持乾淨
    if (!showChip) return ui;

    const chip = document.createElement('span');
    chip.className = 'pb-chip';

    const dot = document.createElement('i');
    dot.className = 'pb-dot';
    chip.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'pb-label';
    if (cfg.reveal.showReason) {
      label.appendChild(document.createTextNode('已屏蔽 · '));
      const b = document.createElement('b');
      b.textContent = rule.label;
      label.appendChild(b);
    } else {
      label.textContent = '已屏蔽';
    }
    chip.appendChild(label);

    // 空間不足時改用的極短文字
    const short = document.createElement('span');
    short.className = 'pb-short';
    short.textContent = '已屏蔽';
    chip.appendChild(short);

    if (cfg.reveal.trigger !== 'never') {
      const hint = document.createElement('span');
      hint.className = 'pb-hint';
      hint.textContent = cfg.reveal.trigger === 'hover' ? '移過來顯示' : '點一下顯示';
      chip.appendChild(hint);
    }

    ui.appendChild(chip);
    return ui;
  }

  function setRevealedLabel(host, revealed) {
    const ui = host.__pbUi;
    if (!ui) return;
    const label = ui.querySelector('.pb-label');
    const hint = ui.querySelector('.pb-hint');
    if (label) {
      if (revealed) {
        label.textContent = '重新屏蔽';
      } else {
        label.textContent = '';
        if (cfg.reveal.showReason) {
          label.appendChild(document.createTextNode('已屏蔽 · '));
          const b = document.createElement('b');
          b.textContent = host.__pbRule ? host.__pbRule.label : '';
          label.appendChild(b);
        } else {
          label.textContent = '已屏蔽';
        }
      }
    }
    if (hint) hint.style.display = revealed ? 'none' : '';
  }

  /* ── 影片／音訊 ───────────────────────────────────
     被遮住的影片如果繼續播放，聲音還是會跑出來，而且使用者為了按暫停
     就得先點開遮罩、反而看到不想看的內容。所以遮起來的同時就靜音並暫停。 */
  function eachMedia(host, fn) {
    if (host.tagName === 'VIDEO' || host.tagName === 'AUDIO') fn(host);
    let list;
    try { list = host.querySelectorAll('video, audio'); } catch (e) { return; }
    for (let i = 0; i < list.length; i++) fn(list[i]);
  }

  function silence(media) {
    if (!media.__pbMedia) {
      media.__pbMedia = { muted: media.muted, autoplay: media.autoplay,
                          playing: !media.paused };
    }
    try {
      media.muted = true;
      media.autoplay = false;
      if (!media.paused) media.pause();
    } catch (e) { /* 某些播放器會擋 */ }
  }

  function restoreMedia(media) {
    if (!media.__pbMedia) return;
    const saved = media.__pbMedia;
    media.__pbMedia = null;
    try {
      media.muted = saved.muted;
      media.autoplay = saved.autoplay;
      // 是我們把它按停的，就接著播回去
      if ((saved.playing || saved.autoplay) && media.paused) {
        const r = media.play();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch (e) { /* noop */ }
  }

  function mediaOff(host) { eachMedia(host, silence); }
  function mediaOn(host) { eachMedia(host, restoreMedia); }

  /* 網站稍後才插入影片、或自己把它叫起來播，都靠這個攔下來。
     play 事件不會冒泡，但在捕獲階段仍會經過祖先節點。 */
  function onMediaPlay(e) {
    const host = e.currentTarget;
    if (host.classList.contains('pb-revealed')) return;
    const m = e.target;
    if (m && typeof m.pause === 'function') silence(m);
  }

  /** 同一則貼文的所有遮罩區塊 */
  function groupMembers(host) {
    const set = host.__pbGroup && groups.get(host.__pbGroup);
    if (!set) return [host];
    const out = [];
    set.forEach(h => { if (h.isConnected) out.push(h); });
    return out.length ? out : [host];
  }

  function revealOne(host) {
    if (!host.classList.contains('pb-host')) return;
    host.classList.add('pb-revealed');
    setRevealedLabel(host, true);
    mediaOn(host);
    if (host.__pbUi) host.__pbUi.setAttribute('aria-label', '重新屏蔽這則內容');
  }

  function concealOne(host) {
    host.classList.remove('pb-revealed');
    setRevealedLabel(host, false);
    if (!host.__pbDeco) mediaOff(host);
    if (host.__pbUi && host.__pbRule) {
      host.__pbUi.setAttribute('aria-label',
        '這則內容已被屏蔽（命中關鍵字：' + host.__pbRule.label + '），按下以顯示原文');
    }
  }

  function reveal(host) { groupMembers(host).forEach(revealOne); }
  function conceal(host) { groupMembers(host).forEach(concealOne); }

  function onOverlayClick(e) {
    if (cfg && cfg.reveal.trigger === 'never') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const t = e.currentTarget;
    const host = t.classList.contains('pb-host') ? t : t.parentElement;
    if (!host) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (host.classList.contains('pb-revealed')) conceal(host); else reveal(host);
  }

  function onOverlayKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    e.stopPropagation();
    onOverlayClick(e);
  }

  function onHoverIn(e) { reveal(e.currentTarget); }
  function onHoverOut(e) { conceal(e.currentTarget); }

  /* 被遮住的內容不該能用 Tab 鍵走進去（模糊／馬賽克下元素仍可聚焦） */
  function onFocusIn(e) {
    const host = e.currentTarget;
    if (host.classList.contains('pb-revealed')) return;
    if (e.target === host.__pbUi || (host.__pbUi && host.__pbUi.contains(e.target))) return;
    if (typeof e.target.blur === 'function') e.target.blur();
    if (host.__pbUi && host.__pbUi.hasAttribute('tabindex')) host.__pbUi.focus();
  }

  /* 小格子（例如 IG 探索縮圖）用精簡樣式 */
  function applyCompact(host, ui) {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    if (r.width < 260 || r.height < 110) ui.classList.add('pb-compact');
    if (r.width < 150 || r.height < 56) ui.classList.add('pb-tiny');
  }

  /* ── 主要 API ─────────────────────────────────────── */
  /**
   * @param {Element} host  要蓋遮罩的元素
   * @param {object}  rule  命中的規則
   * @param {object} [opts] { group: 群組 id, chip: 是否顯示提示膠囊 }
   */
  function mask(host, rule, opts) {
    if (!host || !cfg) return false;
    opts = opts || {};
    const chip = opts.chip !== false;
    if (masked.has(host)) {
      if (host.__pbRule && host.__pbRule.id === rule.id &&
          host.__pbGroup === (opts.group || null)) return false;
      unmask(host);
    }
    // 整則遮住時，先清掉裡面已經遮過的區塊，避免疊兩層遮罩。
    // 同一組（只遮文字／只遮影片拆出來的多塊）之間是刻意並存的，不能互相清掉。
    if (!opts.group) {
      let inner;
      try { inner = host.querySelectorAll('.pb-host'); } catch (e) { inner = []; }
      for (let i = 0; i < inner.length; i++) unmask(inner[i]);
    }

    // img / video 這類元素不能放子元素，效果只好直接套在它自己身上
    const solo = !!MEDIA_TAGS[host.tagName];
    // 徽章：只掛提示膠囊、不套任何效果（用在整則貼文只遮到圖片影片時）
    const deco = opts.badge === true;
    const fx = deco ? null
      : ((rule.effect && rule.effect !== 'inherit') ? rule.effect : cfg.effect.type);

    if (!solo) {
      try {
        if (getComputedStyle(host).position === 'static') host.classList.add('pb-rel');
      } catch (e) { host.classList.add('pb-rel'); }
    }

    host.classList.add('pb-host');
    if (solo) host.classList.add('pb-solo');
    if (deco) host.classList.add('pb-deco');
    if (fx) host.classList.add('pb-fx-' + fx);
    host.__pbRule = rule;
    host.__pbFx = fx;
    host.__pbSolo = solo;
    host.__pbDeco = deco;

    let ui = null;
    if (solo) {
      // 效果直接在元素上，點擊與鍵盤也掛在元素上
      host.addEventListener('click', onOverlayClick, true);
      host.addEventListener('keydown', onOverlayKey, true);
      if (cfg.reveal.trigger !== 'never' && !host.hasAttribute('tabindex')) {
        host.setAttribute('tabindex', '0');
        host.__pbTabindex = true;
      }
      host.setAttribute('aria-label', cfg.reveal.trigger === 'never'
        ? '這張圖片／影片已被靜音牆屏蔽'
        : '這張圖片／影片已被屏蔽（命中關鍵字：' + rule.label + '），按下以顯示');
    } else {
      ui = buildOverlay(rule, chip);
      if (deco) ui.classList.add('pb-badge');
      ui.addEventListener('click', onOverlayClick, true);
      ui.addEventListener('keydown', onOverlayKey, true);
      host.appendChild(ui);
    }
    host.__pbUi = ui;
    host.addEventListener('focusin', onFocusIn, true);
    host.addEventListener('play', onMediaPlay, true);
    host.addEventListener('playing', onMediaPlay, true);
    if (!deco) mediaOff(host);
    if (ui) applyCompact(host, ui);

    if (cfg.reveal.trigger === 'hover') {
      host.addEventListener('mouseenter', onHoverIn);
      host.addEventListener('mouseleave', onHoverOut);
      host.__pbHover = true;
    }

    masked.add(host);
    host.__pbGroup = opts.group || null;
    if (host.__pbGroup) {
      let set = groups.get(host.__pbGroup);
      if (!set) { set = new Set(); groups.set(host.__pbGroup, set); }
      set.add(host);
    }
    return true;
  }

  /** 產生一個新的群組 id，讓同一則貼文的多塊遮罩連動 */
  function newGroup() { return 'g' + (++groupSeq); }

  /**
   * 把一則貼文依「遮蔽範圍」遮起來。
   * 提示膠囊掛在最大的一塊；若所有區塊都是 img / video（放不下膠囊），
   * 就在貼文容器上另外掛一個只有膠囊的徽章。
   * @returns {Element[]} 實際被遮住的元素
   */
  function maskPost(container, rule, scope, precomputed) {
    const targets = precomputed || pickTargets(container, scope);
    if (!targets.length) return [];

    let chipOn = null, best = -1;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (MEDIA_TAGS[t.tagName]) continue;
      const r = t.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > best) { best = area; chipOn = t; }
    }

    const needBadge = !chipOn && targets.indexOf(container) === -1;
    const list = needBadge ? targets.concat([container]) : targets.slice();
    const group = list.length > 1 ? newGroup() : null;

    for (let i = 0; i < targets.length; i++) {
      mask(targets[i], rule, { group, chip: targets[i] === chipOn });
    }
    if (needBadge) mask(container, rule, { group, badge: true });
    return list;
  }

  function unmask(host) {
    if (!host) return;
    masked.delete(host);
    if (host.__pbGroup) {
      const set = groups.get(host.__pbGroup);
      if (set) {
        set.delete(host);
        if (!set.size) groups.delete(host.__pbGroup);
      }
      host.__pbGroup = null;
    }
    host.classList.remove('pb-host', 'pb-rel', 'pb-revealed', 'pb-solo', 'pb-deco');
    if (host.__pbFx) host.classList.remove('pb-fx-' + host.__pbFx);
    if (host.__pbSolo) {
      host.removeEventListener('click', onOverlayClick, true);
      host.removeEventListener('keydown', onOverlayKey, true);
      host.removeAttribute('aria-label');
      if (host.__pbTabindex) { host.removeAttribute('tabindex'); host.__pbTabindex = false; }
    }
    host.removeEventListener('focusin', onFocusIn, true);
    host.removeEventListener('play', onMediaPlay, true);
    host.removeEventListener('playing', onMediaPlay, true);
    mediaOn(host);
    if (host.__pbUi) {
      host.__pbUi.removeEventListener('click', onOverlayClick, true);
      host.__pbUi.removeEventListener('keydown', onOverlayKey, true);
      if (host.__pbUi.parentNode) host.__pbUi.parentNode.removeChild(host.__pbUi);
    }
    if (host.__pbHover) {
      host.removeEventListener('mouseenter', onHoverIn);
      host.removeEventListener('mouseleave', onHoverOut);
    }
    host.__pbUi = null;
    host.__pbRule = null;
    host.__pbFx = null;
    host.__pbHover = false;
    host.__pbSolo = false;
    host.__pbDeco = false;
  }

  function resetAll() {
    Array.from(masked).forEach(unmask);
    masked.clear();
  }

  /** 清掉已經脫離畫面（被網站移除）的紀錄，避免 Set 無限增長 */
  function sweep() {
    masked.forEach(host => { if (!host.isConnected) masked.delete(host); });
  }

  PB.Masker = {
    setConfig, mask, unmask, resetAll, reveal, conceal, sweep,
    pickTargets, newGroup, maskPost,
    get count() {
      const seen = new Set();
      let n = 0;
      masked.forEach(h => {
        if (h.__pbDeco) return;
        if (h.__pbGroup) { if (!seen.has(h.__pbGroup)) { seen.add(h.__pbGroup); n++; } }
        else n++;
      });
      return n;
    },
    isMasked: host => masked.has(host)
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
