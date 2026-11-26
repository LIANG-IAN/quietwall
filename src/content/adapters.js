/* 各社群網站的 DOM 配接器：負責「哪些元素算一則貼文」與「怎麼取出它的文字」 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  const MAX_TEXT = 6000; // 單則取字上限，避免超長貼文拖慢比對

  /** 預設取字：內文 + 圖片 alt + aria-label + 連結 title */
  function defaultText(el) {
    let t = PB.ownText(el);
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
        'li.videoBox'
      ],
      // 只處理列表與推薦區塊。自己點進去的影片頁不遮——點進去就是想看。
      container(el) {
        return el.closest('li') || el.closest('div.wrap') || el;
      },
      text(el) {
        return withHrefs(el, defaultText(el));
      }
    },
    {
      id: 'youtube',
      selectors: [
        'ytd-rich-item-renderer',        // 首頁／訂閱內容的影片磚
        'ytd-video-renderer',            // 搜尋結果
        'ytd-compact-video-renderer',    // 觀看頁右側的推薦
        'ytd-grid-video-renderer',       // 頻道頁
        'ytd-playlist-video-renderer',   // 播放清單
        'ytd-reel-item-renderer',        // Shorts
        'ytm-shorts-lockup-view-model',
        'ytm-shorts-lockup-view-model-v2',
        'yt-lockup-view-model',          // 新版版面的影片磚
        'ytd-playlist-renderer',
        'ytd-radio-renderer',
        'ytd-comment-thread-renderer'    // 留言
      ],
      // 只處理清單、推薦與留言。自己點進去的影片頁不遮——點進去就是想看。
      text: defaultText
    }
  ];

  PB.getAdapter = function (siteId) {
    return PB.ADAPTERS.find(a => a.id === siteId) || null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
