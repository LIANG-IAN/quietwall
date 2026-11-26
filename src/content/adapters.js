/* 各社群網站的 DOM 配接器：負責「哪些元素算一則貼文」與「怎麼取出它的文字」 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  const MAX_TEXT = 6000; // 單則取字上限，避免超長貼文拖慢比對

  /** 預設取字：內文 + 圖片 alt + aria-label + 連結 title */
  function defaultText(el) {
    let t = el.textContent || '';
    if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT);
    const extra = [];
    const nodes = el.querySelectorAll('[alt],[aria-label],[title]');
    for (let i = 0; i < nodes.length && i < 40; i++) {
      const n = nodes[i];
      const a = n.getAttribute('alt'), b = n.getAttribute('aria-label'), c = n.getAttribute('title');
      if (a) extra.push(a);
      if (b) extra.push(b);
      if (c) extra.push(c);
    }
    return extra.length ? t + '\n' + extra.join('\n') : t;
  }

  /** 連結網址也納入比對（影片站的片名常在網址裡） */
  function withHrefs(el, base) {
    const links = el.querySelectorAll('a[href]');
    const out = [];
    for (let i = 0; i < links.length && i < 12; i++) {
      const h = links[i].getAttribute('href') || '';
      if (h && h.length < 300) out.push(decodeURIComponent(h).replace(/[-_/+?=&]+/g, ' '));
    }
    return out.length ? base + '\n' + out.join('\n') : base;
  }

  PB.ADAPTERS = [
    {
      id: 'facebook',
      selectors: [
        'div[role="article"]',
        'div[data-pagelet^="FeedUnit"]',
        'div[aria-posinset]'
      ],
      text: defaultText
    },
    {
      id: 'instagram',
      selectors: [
        'article',
        'main a[href*="/p/"]',
        'main a[href*="/reel/"]',
        'div[role="dialog"] article'
      ],
      container(el) {
        // 探索頁 / 個人檔案的縮圖：往上包到格子本身，避免只遮到圖片內框
        if (el.tagName === 'A') return el.closest('div[style*="flex"]') || el;
        return el;
      },
      text: defaultText
    },
    {
      id: 'threads',
      selectors: [
        'div[data-pressable-container="true"]',
        'div[role="article"]'
      ],
      text: defaultText
    },
    {
      id: 'x',
      selectors: [
        'article[data-testid="tweet"]',
        'article[role="article"]'
      ],
      container(el) {
        return el.closest('div[data-testid="cellInnerDiv"]') || el;
      },
      text: defaultText
    },
    {
      id: 'pornhub',
      selectors: [
        'li.pcVideoListItem',
        'li.videoblock',
        'div.phimage',
        'li.videoBox',
        'div.video-wrapper > div.title',
        '#player'
      ],
      container(el) {
        if (el.id === 'player') return el;
        return el.closest('li') || el.closest('div.wrap') || el;
      },
      text(el) {
        // 影片播放頁：沒有自己的文字，改用頁面標題與標籤判斷
        if (el.id === 'player') {
          const parts = [];
          const h1 = document.querySelector('h1.title, h1 .inlineFree');
          if (h1) parts.push(h1.textContent || '');
          document.querySelectorAll(
            '.categoriesWrapper a, .tagsWrapper a, .pornstarsWrapper a'
          ).forEach(a => parts.push(a.textContent || ''));
          if (!parts.length) parts.push(document.title || '');
          return parts.join('\n');
        }
        return withHrefs(el, defaultText(el));
      }
    }
  ];

  PB.getAdapter = function (siteId) {
    return PB.ADAPTERS.find(a => a.id === siteId) || null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
