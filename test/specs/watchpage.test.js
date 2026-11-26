/** 自己點進去的影片頁不該被遮，但同頁的推薦區塊照遮 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = '影片頁：點進去就是想看';

exports.run = async function (t) {
  const server = await serve({
    'www.youtube.com': url => url.startsWith('/watch') ? 'youtube-watch.html' : 'youtube.html',
    'www.pornhub.com': 'pornhub-watch.html'
  });
  const app = await launch({
    hosts: ['www.youtube.com', 'www.pornhub.com'],
    viewport: { width: 1100, height: 900 }
  });
  try {
    await app.setSettings({ rules: [{ pattern: 'GTA6' }, { pattern: 'compilation' }] });

    const yt = await app.open('https://www.youtube.com/watch?v=v0', 3000);
    const y = await yt.evaluate(() => {
      const v = document.querySelector('video');
      return {
        player: !!document.getElementById('movie_player').closest('.pb-host'),
        title: !!document.querySelector('h1').closest('.pb-host'),
        masks: document.querySelectorAll('.pb-host').length,
        playing: !v.paused, audible: !v.muted
      };
    });
    t.notOk('YouTube 觀看頁：播放器不被遮', y.player);
    t.notOk('YouTube 觀看頁：標題不被遮', y.title);
    t.equal('YouTube 觀看頁：整頁沒有任何遮罩', y.masks, 0);
    t.ok('YouTube 觀看頁：影片正常播放', y.playing);
    t.ok('YouTube 觀看頁：聲音沒有被靜音', y.audible);

    const ph = await app.open('https://www.pornhub.com/view_video.php?viewkey=abc', 3000);
    const p = await ph.evaluate(() => {
      const v = document.querySelector('#player video');
      const items = Array.from(document.querySelectorAll('li.pcVideoListItem'));
      return {
        player: !!document.getElementById('player').closest('.pb-host'),
        title: !!document.querySelector('h1.title').closest('.pb-host'),
        playing: !v.paused,
        relatedMasked: items.filter(e => e.closest('.pb-host')).length,
        relatedTotal: items.length
      };
    });
    t.notOk('Pornhub 播放頁：播放器不被遮', p.player);
    t.notOk('Pornhub 播放頁：標題不被遮', p.title);
    t.ok('Pornhub 播放頁：影片正常播放', p.playing);
    t.equal('Pornhub 播放頁：推薦區塊照常屏蔽', p.relatedMasked, 1);
    t.equal('Pornhub 播放頁：推薦區塊沒有全部被遮', p.relatedTotal, 2);
  } finally {
    await app.close();
    await server.close();
  }
};
