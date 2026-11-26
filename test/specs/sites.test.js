/** 各站台配接器：選對貼文容器、巢狀不重複、逐站規則、例外清單 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = '站台配接器：Facebook / Instagram / Threads / Pornhub';

exports.run = async function (t) {
  const server = await serve({
    'www.facebook.com': 'facebook.html',
    'www.instagram.com': 'instagram.html',
    'www.threads.com': 'threads.html',
    'www.pornhub.com': 'pornhub.html'
  });
  const app = await launch({
    hosts: ['www.facebook.com', 'www.instagram.com', 'www.threads.com', 'www.pornhub.com'],
    viewport: { width: 1000, height: 900 }
  });
  try {
    await app.setSettings({
      rules: [
        { pattern: '雷', sites: ['*'] },
        { pattern: '選舉', sites: ['*'] },
        { pattern: '劇透', sites: ['*'] },
        { pattern: 'compilation', sites: ['pornhub'] },
        { pattern: '咖啡', sites: ['facebook'] }   // IG 上也有咖啡貼文，不該被遮
      ],
      allow: [{ pattern: '九份' }]
    });

    const look = async host => {
      const page = await app.open('https://' + host + '/');
      const info = await page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll('.pb-host'));
        return {
          count: hosts.length,
          tags: hosts.map(h => h.tagName.toLowerCase() +
            (h.dataset.pagelet ? '[data-pagelet]' : '') +
            (h.hasAttribute('data-pressable-container') ? '[data-pressable]' : '') +
            (h.className.replace(/pb-[\w-]+/g, '').trim()
              ? '.' + h.className.replace(/pb-[\w-]+/g, '').trim().split(/\s+/)[0] : '')),
          nested: hosts.filter(h => h.parentElement && h.parentElement.closest('.pb-host')).length,
          reasons: hosts.map(h => (h.querySelector('.pb-label b') || {}).textContent || '')
        };
      });
      await page.close();
      return info;
    };

    const fb = await look('www.facebook.com');
    t.equal('Facebook：遮住一則貼文', fb.count, 1);
    t.equal('Facebook：遮在最外層的貼文容器上', fb.tags[0], 'div[data-pagelet]');
    t.equal('Facebook：命中的是「選舉」', fb.reasons[0], '選舉');
    t.equal('Facebook：貼文與底下留言不會各遮一層', fb.nested, 0);

    const ig = await look('www.instagram.com');
    t.equal('Instagram：主頁貼文與探索縮圖各遮一塊', ig.count, 2);
    t.deepEqual('Instagram：命中的關鍵字', ig.reasons.sort(), ['劇透', '雷']);
    t.ok('Instagram：縮圖格遮在格子本身', ig.tags.includes('div.cell'));
    t.notOk('只給 Facebook 的規則不會誤傷 Instagram 的咖啡貼文',
      ig.reasons.includes('咖啡'));

    const th = await look('www.threads.com');
    t.equal('Threads：遮住兩則串文', th.count, 2);
    t.ok('Threads：遮在串文容器上', th.tags.every(x => x.includes('data-pressable')));

    const ph = await look('www.pornhub.com');
    t.equal('Pornhub：遮住一支影片', ph.count, 1);
    t.equal('Pornhub：遮在整個列表項目上', ph.tags[0], 'li.pcVideoListItem');
    t.equal('Pornhub：逐站規則生效', ph.reasons[0], 'compilation');

    t.notOk('例外關鍵字「九份」讓該則免於被遮', fb.reasons.includes('九份'));
  } finally {
    await app.close();
    await server.close();
  }
};
