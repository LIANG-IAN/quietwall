/** 關鍵字比對引擎：純邏輯，不需要瀏覽器 */
'use strict';
const path = require('path');

exports.title = '關鍵字比對引擎';

exports.run = async function (t) {
  // defaults.js / matcher.js 都掛在 globalThis.PB 上，直接載進來測
  global.chrome = {};
  const REPO = path.join(__dirname, '..', '..');
  require(path.join(REPO, 'src/common/defaults.js'));
  require(path.join(REPO, 'src/content/matcher.js'));
  const PB = globalThis.PB;

  const compile = raw => PB.compile(PB.normalizeSettings(raw));
  const hit = (c, text, site) => {
    const r = PB.evaluate(text, c, site || 'x');
    return r ? r.label : null;
  };

  // ── 包含文字 ──
  let c = compile({ rules: [{ pattern: '選舉' }] });
  t.equal('中文詞彙直接命中', hit(c, '明天要去投票，這次選舉很關鍵'), '選舉');
  t.equal('沒出現就不命中', hit(c, '今天天氣很好'), null);

  // ── 規避手法 ──
  c = compile({ rules: [{ pattern: 'spoiler', mode: 'word' }, { pattern: '選舉' }] });
  t.equal('全形字會被正規化', hit(c, '今天的ＳＰＯＩＬＥＲ'), 'spoiler');
  t.equal('零寬字元會被清掉', hit(c, '明天選​舉投票'), '選舉');

  // ── 完整單字的邊界 ──
  c = compile({ rules: [{ pattern: 'AI', mode: 'word' }] });
  t.equal('中文視為邊界，繪圖AI 會命中', hit(c, '繪圖AI很強'), 'AI');
  t.equal('英文單字要完整，SAID 不命中', hit(c, 'he SAID so'), null);
  c = compile({ rules: [{ pattern: 'spoiler', mode: 'word' }] });
  t.equal('複數形 spoilers 不命中', hit(c, 'spoilers ahead'), null);

  // ── 正規表示式 ──
  c = compile({ rules: [{ pattern: '(大甲|媽祖).*遶境', mode: 'regex' }] });
  t.equal('正規表示式命中', hit(c, '大甲媽祖今年遶境路線'), '(大甲|媽祖).*遶境');
  t.equal('順序不符不命中', hit(c, '遶境結束後大甲很熱鬧'), null);
  c = compile({ rules: [{ pattern: '([', mode: 'regex' }, { pattern: '備用' }] });
  t.equal('壞掉的正規表示式會被忽略，不影響其他規則', hit(c, '這是備用關鍵字'), '備用');

  // ── 例外清單 ──
  c = compile({ rules: [{ pattern: '蘋果' }], allow: [{ pattern: '蘋果派' }] });
  t.equal('一般情況仍命中', hit(c, '蘋果今天發表新機'), '蘋果');
  t.equal('例外優先於屏蔽規則', hit(c, '這個蘋果派食譜超好吃'), null);

  // ── 逐站生效 ──
  c = compile({ rules: [{ pattern: '咖啡', sites: ['facebook'] }] });
  t.equal('指定網站內命中', hit(c, '手沖咖啡教學', 'facebook'), '咖啡');
  t.equal('其他網站不受影響', hit(c, '手沖咖啡教學', 'instagram'), null);

  // ── 停用的規則 ──
  c = compile({ rules: [{ pattern: '雷', enabled: false }] });
  t.notOk('停用的規則不會生效', c.active);

  // ── 大小寫 ──
  c = compile({ rules: [{ pattern: 'Boss', caseSensitive: true }] });
  t.equal('區分大小寫時只認原樣', hit(c, 'the Boss fight'), 'Boss');
  t.equal('區分大小寫時不認小寫', hit(c, 'the boss fight'), null);

  // ── 設定正規化 ──
  const s = PB.normalizeSettings({ effect: { type: '亂填', scope: '亂填', blur: 999 } });
  t.equal('不合法的效果會回到預設', s.effect.type, 'blur');
  t.equal('不合法的範圍會回到預設', s.effect.scope, 'all');
  t.equal('超出範圍的數值會被夾住', s.effect.blur, 40);
  t.equal('舊設定升級後新站台預設開啟', s.sites.youtube, true);
};
