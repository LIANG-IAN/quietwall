/**
 * 真實站台造成過的問題，全部在這裡設防：
 *  - 網站用特異性更高的 CSS 把子元素濾鏡蓋掉（Facebook）
 *  - 網站在外層設 pointer-events: none，讓遮罩被點穿
 *  - 被遮住的影片繼續播放發出聲音
 *  - 同一則貼文被遮兩層
 */
'use strict';
const { serve, launch, clickMask } = require('../lib/harness');

exports.title = '健壯性：網站與擴充功能互相干擾的情況';

exports.run = async function (t) {
  const server = await serve({ 'www.facebook.com': 'facebook-hostile.html' });
  const app = await launch({ hosts: ['www.facebook.com'], viewport: { width: 640, height: 900 } });
  try {
    await app.setSettings({ rules: [{ pattern: '北市' }], effect: { type: 'blur', blur: 16 } });
    const page = await app.open('https://www.facebook.com/', 3000);

    const r = await page.evaluate(() => {
      const h = document.querySelector('.pb-host');
      const ui = h.querySelector('.pb-ui');
      const kid = h.firstElementChild;
      const cu = getComputedStyle(ui);
      const v = document.getElementById('vid');
      const rect = ui.getBoundingClientRect();
      const hitAt = (fx, fy) => {
        const el = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
        return !!(el && (el === ui || ui.contains(el)));
      };
      return {
        childFilter: getComputedStyle(kid).filter,
        backdrop: cu.backdropFilter || cu.webkitBackdropFilter,
        pointerEvents: cu.pointerEvents,
        hitsOverlay: hitAt(0.5, 0.15) && hitAt(0.5, 0.85),
        videoPaused: v.paused,
        videoMuted: v.muted,
        hostCount: document.querySelectorAll('.pb-host').length,
        nested: Array.from(document.querySelectorAll('.pb-host'))
          .filter(x => x.parentElement && x.parentElement.closest('.pb-host')).length
      };
    });

    // 模擬頁刻意用 `#feed > div > *` 把子元素濾鏡蓋掉，等同 Facebook 的情況
    t.equal('網站成功蓋掉子元素濾鏡（這正是要模擬的狀況）', r.childFilter, 'none');
    t.match('覆蓋層的 backdrop-filter 仍然擋住內容', r.backdrop, /blur\(\d/);
    t.equal('遮罩自己搶回 pointer-events，不會被點穿', r.pointerEvents, 'auto');
    t.ok('遮罩確實是滑鼠點得到的那一層', r.hitsOverlay);
    t.ok('被遮住的影片已暫停', r.videoPaused);
    t.ok('被遮住的影片已靜音', r.videoMuted);
    t.equal('同一則貼文只遮一層', r.hostCount, 1);
    t.equal('沒有巢狀重複的遮罩', r.nested, 0);

    // 顯示原文 → 還原音量；重新屏蔽 → 再次靜音
    await clickMask(page);
    let v = await page.evaluate(() => {
      const el = document.getElementById('vid');
      return { revealed: document.querySelector('.pb-host').classList.contains('pb-revealed'),
               muted: el.muted };
    });
    t.ok('點一下顯示原文', v.revealed);
    t.notOk('顯示後還原原本的音量設定', v.muted);

    await clickMask(page);
    v = await page.evaluate(() => {
      const el = document.getElementById('vid');
      return { revealed: document.querySelector('.pb-host').classList.contains('pb-revealed'),
               muted: el.muted, paused: el.paused };
    });
    t.notOk('再點一下重新屏蔽', v.revealed);
    t.ok('重新屏蔽後再次靜音', v.muted);
    t.ok('重新屏蔽後再次暫停', v.paused);
  } finally {
    await app.close();
    await server.close();
  }
};
