/* 遮罩器：負責把效果套上去 / 拿掉，以及「點一下看原文」的互動 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const masked = new Set();
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

  /* ── 覆蓋層 ───────────────────────────────────────── */
  function buildOverlay(rule) {
    const ui = document.createElement('div');
    ui.className = 'pb-ui';
    ui.setAttribute('data-pb-ui', '');
    if (cfg.reveal.trigger === 'never') {
      ui.setAttribute('aria-label', '這則內容已被靜音牆屏蔽');
    } else {
      ui.setAttribute('role', 'button');
      ui.setAttribute('tabindex', '0');
      ui.setAttribute('aria-label',
        '這則內容已被屏蔽（命中關鍵字：' + rule.label + '），按下以顯示原文');
    }

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
    } else {
      ui.classList.add('pb-locked');
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
    let list;
    try { list = host.querySelectorAll('video, audio'); } catch (e) { return; }
    for (let i = 0; i < list.length; i++) fn(list[i]);
  }

  function silence(media) {
    if (!media.__pbMedia) {
      media.__pbMedia = { muted: media.muted, autoplay: media.autoplay };
    }
    try {
      media.muted = true;
      media.autoplay = false;
      if (!media.paused) media.pause();
    } catch (e) { /* 某些播放器會擋 */ }
  }

  function restoreMedia(media) {
    if (!media.__pbMedia) return;
    try {
      media.muted = media.__pbMedia.muted;
      media.autoplay = media.__pbMedia.autoplay;
    } catch (e) { /* noop */ }
    media.__pbMedia = null;
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

  function reveal(host) {
    if (!host.classList.contains('pb-host')) return;
    host.classList.add('pb-revealed');
    setRevealedLabel(host, true);
    mediaOn(host);
    if (host.__pbUi) host.__pbUi.setAttribute('aria-label', '重新屏蔽這則內容');
  }

  function conceal(host) {
    host.classList.remove('pb-revealed');
    setRevealedLabel(host, false);
    mediaOff(host);
    if (host.__pbUi && host.__pbRule) {
      host.__pbUi.setAttribute('aria-label',
        '這則內容已被屏蔽（命中關鍵字：' + host.__pbRule.label + '），按下以顯示原文');
    }
  }

  function onOverlayClick(e) {
    if (cfg && cfg.reveal.trigger === 'never') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const host = e.currentTarget.parentElement;
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
  function mask(host, rule) {
    if (!host || !cfg) return false;
    if (masked.has(host)) {
      if (host.__pbRule && host.__pbRule.id === rule.id) return false;
      unmask(host);
    }
    // 外層貼文被遮住時，先清掉裡面已經遮過的區塊，避免疊兩層遮罩
    let inner;
    try { inner = host.querySelectorAll('.pb-host'); } catch (e) { inner = []; }
    for (let i = 0; i < inner.length; i++) unmask(inner[i]);

    const fx = (rule.effect && rule.effect !== 'inherit') ? rule.effect : cfg.effect.type;

    try {
      if (getComputedStyle(host).position === 'static') host.classList.add('pb-rel');
    } catch (e) { host.classList.add('pb-rel'); }

    host.classList.add('pb-host', 'pb-fx-' + fx);
    host.__pbRule = rule;
    host.__pbFx = fx;

    const ui = buildOverlay(rule);
    ui.addEventListener('click', onOverlayClick, true);
    ui.addEventListener('keydown', onOverlayKey, true);
    host.__pbUi = ui;
    host.appendChild(ui);
    host.addEventListener('focusin', onFocusIn, true);
    host.addEventListener('play', onMediaPlay, true);
    host.addEventListener('playing', onMediaPlay, true);
    mediaOff(host);
    applyCompact(host, ui);

    if (cfg.reveal.trigger === 'hover') {
      host.addEventListener('mouseenter', onHoverIn);
      host.addEventListener('mouseleave', onHoverOut);
      host.__pbHover = true;
    }

    masked.add(host);
    return true;
  }

  function unmask(host) {
    if (!host) return;
    masked.delete(host);
    host.classList.remove('pb-host', 'pb-rel', 'pb-revealed');
    if (host.__pbFx) host.classList.remove('pb-fx-' + host.__pbFx);
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
    get count() { return masked.size; },
    isMasked: host => masked.has(host)
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
