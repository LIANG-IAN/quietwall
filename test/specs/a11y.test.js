/** 無障礙：遮罩是可操作元素，且不該能用 Tab 鍵走進被遮住的內容 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = '無障礙：鍵盤操作與焦點防護';

exports.run = async function (t) {
  const server = await serve({ 'x.com': 'x-timeline.html' });
  const app = await launch({ hosts: ['x.com'], viewport: { width: 700, height: 900 } });
  try {
    await app.setSettings({ rules: [{ pattern: '雷' }] });
    const page = await app.open('https://x.com/home', 3000);

    const meta = await page.evaluate(() => {
      const ui = document.querySelector('.pb-ui');
      return { role: ui.getAttribute('role'), tabindex: ui.getAttribute('tabindex'),
               aria: ui.getAttribute('aria-label'),
               shortHidden: getComputedStyle(ui.querySelector('.pb-short')).display };
    });
    t.equal('遮罩對輔助技術是一顆按鈕', meta.role, 'button');
    t.equal('遮罩可以用 Tab 聚焦', meta.tabindex, '0');
    t.match('說明文字講得出命中的關鍵字', meta.aria, /已被屏蔽.*雷.*按下以顯示/);
    t.equal('空間足夠時不顯示極短版文字', meta.shortHidden, 'none');

    await page.focus('.pb-ui');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    t.ok('按 Enter 顯示原文',
      await page.evaluate(() => document.querySelector('.pb-host').classList.contains('pb-revealed')));
    t.match('顯示後說明文字改成重新屏蔽',
      await page.evaluate(() => document.querySelector('.pb-ui').getAttribute('aria-label')),
      /重新屏蔽/);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    t.notOk('再按 Enter 重新屏蔽',
      await page.evaluate(() => document.querySelector('.pb-host').classList.contains('pb-revealed')));

    // 模糊只是看不清楚，底下的連結其實還能被 Tab 聚焦，必須擋下來
    const guard = await page.evaluate(() => {
      const h = document.querySelector('.pb-host');
      const link = document.createElement('a');
      link.href = '#'; link.id = 'trap'; link.textContent = '隱藏連結';
      h.querySelector('article').appendChild(link);
      link.focus();
      const active = document.activeElement;
      return { trapped: active.id === 'trap',
               onOverlay: !!(active.classList && active.classList.contains('pb-ui')) };
    });
    t.notOk('焦點不會停在被遮住的連結上', guard.trapped);
    t.ok('焦點被推回遮罩本身', guard.onOverlay);
  } finally {
    await app.close();
    await server.close();
  }
};
