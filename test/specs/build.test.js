/** 打包：Chrome 與 Firefox 兩版 manifest，以及 Firefox 專屬 UI 在 Chrome 上要隱形 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, REPO } = require('../lib/harness');

exports.title = '打包：Chrome / Firefox 兩版 manifest';

exports.run = async function (t) {
  const chrome = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.json'), 'utf8'));
  const { toFirefox } = await import('file://' + path.join(REPO, 'tools/build.mjs'));
  const ff = toFirefox(chrome);

  /* ── Chrome 版 ── */
  t.ok('Chrome 走 service worker', !!chrome.background.service_worker);
  t.notOk('Chrome 的 service worker 不是 module（要能用 importScripts）',
    chrome.background.type === 'module');
  t.notOk('Chrome 版不帶 Firefox 專屬欄位', !!chrome.browser_specific_settings);

  /* ── service-worker.js 必須兩邊都載得動 ── */
  const sw = fs.readFileSync(path.join(REPO, 'src/background/service-worker.js'), 'utf8');
  t.notOk('背景腳本沒有頂層 import（Firefox 的事件頁面吃不下）',
    /^\s*import\s/m.test(sw));
  t.ok('背景腳本自己有條件地載入共用設定', /importScripts\(/.test(sw));

  /* ── Firefox 版 ── */
  t.notOk('Firefox 版沒有 background.service_worker', !!ff.background.service_worker);
  t.deepEqual('Firefox 版改用事件頁面，共用設定排在前面',
    ff.background.scripts,
    ['src/common/defaults.js', 'src/background/service-worker.js']);
  t.notOk('拿掉 Firefox 認不得的 minimum_chrome_version', 'minimum_chrome_version' in ff);

  const gecko = (ff.browser_specific_settings || {}).gecko || {};
  t.match('有附加元件識別碼', gecko.id, /@/);
  t.ok('版本底線至少 140（data_collection_permissions 才認得）',
    parseInt(gecko.strict_min_version, 10) >= 140);
  t.deepEqual('聲明不收集任何資料',
    (gecko.data_collection_permissions || {}).required, ['none']);

  /* 兩版除了上面那幾項，其餘必須一模一樣——src/ 是共用的 */
  t.deepEqual('兩版的網站權限一致', ff.host_permissions, chrome.host_permissions);
  t.deepEqual('兩版的 content script 設定一致', ff.content_scripts, chrome.content_scripts);
  t.equal('兩版版號一致', ff.version, chrome.version);

  /* ── Firefox 專屬 UI 不該出現在 Chrome ──
     順便確認加了授權邏輯之後設定頁還是正常開得起來（這裡只要丟出例外就全毀）。 */
  const app = await launch({ hosts: [] });
  try {
    // importScripts 真的把共用設定載進 service worker 了嗎
    t.ok('Chrome 的 service worker 載到了共用設定',
      await app.sw.evaluate(() => !!globalThis.PB && typeof PB.loadSettings === 'function'));

    const missing = await app.control.evaluate(() => PB.missingOrigins());
    t.deepEqual('Chrome 查不到缺少的網站授權', missing, []);
    t.ok('設定頁的授權提示是隱藏的',
      await app.control.evaluate(() => document.querySelector('#permNotice').hidden));
    t.ok('設定頁沒有壞掉（規則清單仍渲染得出來）',
      await app.control.evaluate(() => !!document.querySelector('#ruleList')));

    const popup = await app.ctx.newPage();
    const errors = [];
    popup.on('pageerror', e => errors.push(String(e && e.message || e)));
    await popup.goto(`chrome-extension://${app.extId}/src/popup/popup.html`);
    await popup.waitForTimeout(700);
    t.deepEqual('彈出視窗沒有拋出例外', errors, []);
    t.ok('彈出視窗的授權提示是隱藏的',
      await popup.evaluate(() => document.querySelector('#permWarn').hidden));
    t.ok('彈出視窗的效果按鈕仍畫得出來',
      await popup.evaluate(() => document.querySelectorAll('#effectChips .chip').length >= 5));
  } finally {
    await app.close();
  }
};
