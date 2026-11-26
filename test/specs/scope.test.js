/** 遮蔽範圍：整則貼文／只遮文字／只遮圖片與影片，以及多塊遮罩的連動 */
'use strict';
const { serve, launch, clickMask } = require('../lib/harness');

exports.title = '遮蔽範圍：整則／只遮文字／只遮圖片影片';

exports.run = async function (t) {
  const server = await serve({ 'www.facebook.com': 'post-with-media.html' });
  const app = await launch({ hosts: ['www.facebook.com'], viewport: { width: 600, height: 1000 } });
  try {
    const rules = [{ pattern: '北市' }];
    await app.setSettings({ rules });
    const page = await app.open('https://www.facebook.com/', 2500);

    const probe = () => page.evaluate(() => {
      const fx = el => {
        const host = el && el.closest('.pb-host');
        return !!(host && /pb-fx-/.test(host.className));
      };
      const v = document.getElementById('vid');
      return {
        blocks: document.querySelectorAll('.pb-host').length,
        text: fx(document.querySelector('.body')),
        image: fx(document.querySelector('.shot')),
        video: fx(v),
        chips: document.querySelectorAll('.pb-chip').length,
        videoPaused: v ? v.paused : null,
        videoMuted: v ? v.muted : null
      };
    });

    const use = async scope => {
      await app.setSettings({ rules, effect: { scope } });
      await page.waitForTimeout(1600);
      return probe();
    };

    let r = await use('all');
    t.equal('整則：只有一塊遮罩', r.blocks, 1);
    t.ok('整則：文字被遮', r.text);
    t.ok('整則：圖片被遮', r.image);
    t.ok('整則：影片被遮', r.video);
    t.ok('整則：影片被暫停', r.videoPaused);
    t.ok('整則：影片被靜音', r.videoMuted);

    r = await use('text');
    t.ok('只遮文字：拆成多塊', r.blocks > 1);
    t.ok('只遮文字：文字被遮', r.text);
    t.notOk('只遮文字：圖片保持清晰', r.image);
    t.notOk('只遮文字：影片保持清晰', r.video);
    t.notOk('只遮文字：影片繼續播放', r.videoPaused);
    t.equal('只遮文字：提示膠囊只有一個', r.chips, 1);

    r = await use('media');
    t.notOk('只遮圖片影片：文字可讀', r.text);
    t.ok('只遮圖片影片：圖片被遮', r.image);
    t.ok('只遮圖片影片：影片被遮', r.video);
    t.ok('只遮圖片影片：影片被暫停', r.videoPaused);
    t.ok('只遮圖片影片：影片被靜音', r.videoMuted);
    t.equal('只遮圖片影片：提示膠囊只有一個', r.chips, 1);

    // 同一則貼文拆成多塊時，點任何一塊都該整則一起顯示
    const before = await page.evaluate(() => document.querySelectorAll('.pb-host').length);
    await clickMask(page, '.pb-chip');
    const revealed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pb-host')).filter(h => h.classList.contains('pb-revealed')).length);
    t.equal('點一塊，同一則的所有遮罩一起顯示', revealed, before);
  } finally {
    await app.close();
    await server.close();
  }
};
