/** YouTube：首頁影片磚、Shorts、搜尋結果、留言，以及三種遮蔽範圍 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = 'YouTube：各版面與遮蔽範圍';

exports.run = async function (t) {
  const server = await serve({ 'www.youtube.com': 'youtube.html' });
  const app = await launch({ hosts: ['www.youtube.com'], viewport: { width: 1280, height: 1000 } });
  try {
    const rules = [{ pattern: 'GTA6' }, { pattern: '雷' }];
    await app.setSettings({ rules });
    const page = await app.open('https://www.youtube.com/', 3000);

    const items = await page.evaluate(() => Array.from(document.querySelectorAll(
      'ytd-rich-item-renderer, ytm-shorts-lockup-view-model, ytd-video-renderer, ytd-comment-thread-renderer'
    )).map(e => {
      const title = e.querySelector('#video-title, h3');
      return {
        tag: e.tagName.toLowerCase(),
        title: ((title ? title.textContent : e.textContent) || '').trim().slice(0, 20),
        masked: !!e.closest('.pb-host')
      };
    }));

    const maskedTags = items.filter(i => i.masked).map(i => i.tag);
    t.equal('首頁影片磚被遮', maskedTags.filter(x => x === 'ytd-rich-item-renderer').length, 2);
    t.equal('Shorts 被遮', maskedTags.filter(x => x === 'ytm-shorts-lockup-view-model').length, 1);
    t.equal('搜尋結果被遮', maskedTags.filter(x => x === 'ytd-video-renderer').length, 1);
    t.equal('留言被遮', maskedTags.filter(x => x === 'ytd-comment-thread-renderer').length, 1);
    t.equal('沒命中的全部保持原樣', items.filter(i => !i.masked).length, 5);
    t.ok('沒被遮的確實不含關鍵字',
      items.filter(i => !i.masked).every(i => !/GTA6|雷/.test(i.title)));
    t.equal('徽章計數等於被遮的則數', await app.badge('youtube.com'), '5');

    const tileProbe = () => page.evaluate(() => {
      const tile = document.querySelector('ytd-rich-item-renderer');
      const inFx = el => {
        const h = el && el.closest('.pb-host');
        return !!(h && /pb-fx-/.test(h.className));
      };
      return {
        blocks: document.querySelectorAll('.pb-host').length,
        title: inFx(tile.querySelector('#video-title')),
        thumb: inFx(tile.querySelector('img'))
      };
    });

    await app.setSettings({ rules, effect: { scope: 'text' } });
    await page.waitForTimeout(1800);
    let r = await tileProbe();
    t.ok('只遮文字：標題被遮', r.title);
    t.notOk('只遮文字：縮圖保持清晰', r.thumb);

    await app.setSettings({ rules, effect: { scope: 'media' } });
    await page.waitForTimeout(1800);
    r = await tileProbe();
    t.notOk('只遮圖片影片：標題可讀', r.title);
    t.ok('只遮圖片影片：縮圖被遮', r.thumb);
    const mediaBlocks = r.blocks;

    // 同樣的設定重跑一次，結果必須一致（曾經因為遮罩自身文字被算進內容而漂移）
    await app.setSettings({ rules, effect: { scope: 'text' } });
    await page.waitForTimeout(1600);
    await app.setSettings({ rules, effect: { scope: 'media' } });
    await page.waitForTimeout(1800);
    r = await tileProbe();
    t.equal('切換範圍再切回來，結果一致', r.blocks, mediaBlocks);

    // 改一個與範圍無關的設定，遮罩不該消失
    await app.setSettings({ rules, effect: { scope: 'media', blur: 30 } });
    await page.waitForTimeout(1800);
    r = await tileProbe();
    t.equal('只改模糊強度，遮罩仍在', r.blocks, mediaBlocks);
    t.ok('只改模糊強度，縮圖仍被遮', r.thumb);
  } finally {
    await app.close();
    await server.close();
  }
};
