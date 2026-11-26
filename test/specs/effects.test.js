/** 五種遮蔽效果，以及馬賽克格子大小可調 */
'use strict';
const { serve, launch } = require('../lib/harness');

exports.title = '遮蔽效果：模糊／馬賽克／黑條／收合／隱藏';

exports.run = async function (t) {
  const server = await serve({ 'x.com': 'x-timeline.html' });
  const app = await launch({ hosts: ['x.com'], viewport: { width: 700, height: 900 } });
  try {
    const rules = [{ pattern: '雷' }];
    await app.setSettings({ rules });
    const page = await app.open('https://x.com/home', 3000);

    const probe = () => page.evaluate(() => {
      const h = document.querySelector('.pb-host');
      if (!h) return null;
      const kid = h.querySelector('article');
      const kc = getComputedStyle(kid), hc = getComputedStyle(h);
      return {
        cls: Array.from(h.classList).filter(c => c.startsWith('pb-fx-'))[0] || null,
        filter: kc.filter, visibility: kc.visibility, childDisplay: kc.display,
        hostDisplay: hc.display, height: Math.round(h.getBoundingClientRect().height)
      };
    });

    const apply = async effect => {
      await app.setSettings({ rules, effect });
      await page.waitForTimeout(1300);
      return probe();
    };

    let r = await apply({ type: 'blur', blur: 16 });
    t.equal('模糊：套上 pb-fx-blur', r.cls, 'pb-fx-blur');
    t.equal('模糊：濾鏡強度等於設定值', r.filter, 'blur(16px)');

    r = await apply({ type: 'mosaic', mosaic: 9 });
    t.equal('馬賽克：套上 pb-fx-mosaic', r.cls, 'pb-fx-mosaic');
    t.match('馬賽克：使用 SVG 像素化濾鏡', r.filter, /url\("#pb-pixelate-9"\)/);

    // Chrome 不會因為 SVG 濾鏡內容改變就重繪，必須換 id 才會重新套用
    for (const size of [6, 14, 28]) {
      await app.setSettings({ rules, effect: { type: 'mosaic', mosaic: size } });
      await page.waitForTimeout(1100);
      const f = await page.evaluate(() => {
        const el = document.querySelector('#pb-svg-defs filter');
        return { id: el && el.id, radius: el && el.querySelector('feMorphology').getAttribute('radius'),
                 applied: getComputedStyle(document.querySelector('.pb-host article')).filter };
      });
      t.equal(`馬賽克 ${size}px：濾鏡 id 跟著改變`, f.id, 'pb-pixelate-' + size);
      t.equal(`馬賽克 ${size}px：格子半徑正確`, f.radius, String(Math.round(size / 2)));
      t.match(`馬賽克 ${size}px：實際套用新濾鏡`, f.applied, new RegExp('pb-pixelate-' + size));
    }

    r = await apply({ type: 'black' });
    t.equal('黑條：套上 pb-fx-black', r.cls, 'pb-fx-black');
    t.equal('黑條：底下內容整個隱形', r.visibility, 'hidden');

    r = await apply({ type: 'collapse', collapseHeight: 44 });
    t.equal('收合：底下內容不佔版面', r.childDisplay, 'none');
    t.ok('收合：壓成一條細列', r.height > 0 && r.height <= 60);

    r = await apply({ type: 'hide' });
    t.equal('完全隱藏：整則從版面消失', r.hostDisplay, 'none');
  } finally {
    await app.close();
    await server.close();
  }
};
