/** 動態時間軸：無限捲動、延遲填入的文字、徽章計數、點擊顯示原文 */
'use strict';
const { serve, launch, clickMask } = require('../lib/harness');

exports.title = 'X 時間軸：動態載入與點擊顯示';

exports.run = async function (t) {
  const server = await serve({ 'x.com': 'x-timeline.html' });
  const app = await launch({ hosts: ['x.com'], viewport: { width: 700, height: 900 } });
  try {
    await app.setSettings({
      rules: [
        { pattern: '雷', mode: 'plain', sites: ['*'] },
        { pattern: '選舉', mode: 'plain', sites: ['*'] },
        { pattern: 'spoiler', mode: 'word', sites: ['x'] },
        { pattern: '劇透', mode: 'plain', sites: ['*'] }
      ]
    });
    // 模擬頁會在 0.6 秒後追加貼文，1.7 秒後才把文字填進最後一則
    const page = await app.open('https://x.com/home', 3500);

    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-testid="cellInnerDiv"]')
    ).map(c => ({
      text: ((c.querySelector('.text') || {}).textContent || '').slice(0, 14),
      masked: c.classList.contains('pb-host'),
      filter: (() => {
        const kid = c.querySelector('article');
        return kid ? getComputedStyle(kid).filter : null;
      })()
    })));

    const masked = rows.filter(r => r.masked);
    const clean = rows.filter(r => !r.masked);
    t.equal('命中的貼文被遮住', masked.length, 4);
    t.equal('沒命中的貼文保持原樣', clean.length, 2);
    t.ok('乾淨的貼文確實沒命中關鍵字',
      clean.every(r => !/雷|選舉|劇透|spoiler/.test(r.text)));
    t.ok('捲動後才載入的貼文也會被遮',
      masked.some(r => r.text.includes('spoiler')));
    t.ok('文字延遲填入的貼文也會被遮',
      masked.some(r => r.text.includes('後來才補上')));
    t.ok('遮住的貼文都套上了模糊', masked.every(r => /blur\(\d/.test(r.filter)));

    t.equal('工具列徽章顯示屏蔽數量', await app.badge('x.com'), '4');

    // 點一下 → 顯示原文；再點一下 → 重新屏蔽
    await clickMask(page);
    let state = await page.evaluate(() => {
      const h = document.querySelector('.pb-host');
      return { revealed: h.classList.contains('pb-revealed'),
               filter: getComputedStyle(h.querySelector('article')).filter };
    });
    t.ok('點一下會顯示原文', state.revealed);
    t.equal('顯示後濾鏡移除', state.filter, 'none');

    await clickMask(page);
    state = await page.evaluate(() => {
      const h = document.querySelector('.pb-host');
      return { revealed: h.classList.contains('pb-revealed'),
               filter: getComputedStyle(h.querySelector('article')).filter };
    });
    t.notOk('再點一下會重新屏蔽', state.revealed);
    t.match('重新屏蔽後濾鏡回來', state.filter, /blur\(\d/);
  } finally {
    await app.close();
    await server.close();
  }
};
