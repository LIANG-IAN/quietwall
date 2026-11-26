/**
 * Threads 的貼文容器到圖片之間包了十幾層，而且圖片是延遲載入的。
 * 這支測試是 0.2.1「只遮圖片與影片在 Threads 完全沒作用」的回歸測試。
 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = 'Threads：深層巢狀與延遲載入的圖片';

exports.run = async function (t) {
  const server = await serve({ 'www.threads.com': 'threads-deep.html' });
  const app = await launch({ hosts: ['www.threads.com'], viewport: { width: 620, height: 1000 } });
  try {
    await app.setSettings({
      effect: { scope: 'media' },
      rules: [{ pattern: '雷' }, { pattern: '選舉' }]
    });
    const page = await app.open('https://www.threads.com/', 2000);

    const probe = () => page.evaluate(() => {
      const masked = el => !!(el && el.closest('.pb-host'));
      const lazy = document.querySelector('img.lazy');
      const r = lazy ? lazy.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        blocks: document.querySelectorAll('.pb-host').length,
        photo: masked(document.querySelector('img.photo')),
        video: masked(document.querySelector('video')),
        textReadable: !masked(document.querySelectorAll('[data-pressable-container] div')[0]),
        lazyHeight: Math.round(r.height),
        lazyMasked: masked(lazy)
      };
    });

    let r = await probe();
    t.ok('包了九層仍找得到圖片並遮住', r.photo);
    t.ok('包了九層仍找得到影片並遮住', r.video);
    t.ok('只遮畫面，文字維持可讀', r.textReadable);
    t.ok('此時延遲圖還沒撐開（高度 ' + r.lazyHeight + 'px）', r.lazyHeight < 60);
    t.notOk('沒有尺寸的圖片不會被當成畫面', r.lazyMasked);

    // 圖片載入後高度才撐開，期間貼文文字完全沒變
    await page.waitForTimeout(7000);
    r = await probe();
    t.ok('延遲圖已載入並撐開（高度 ' + r.lazyHeight + 'px）', r.lazyHeight > 200);
    t.ok('載入後會自動補上遮罩', r.lazyMasked);
    t.equal('補遮後總共三塊', r.blocks, 3);
  } finally {
    await app.close();
    await server.close();
  }
};
