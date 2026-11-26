/* content script 進入點 */
(function (g) {
  'use strict';
  const PB = g.PB;
  if (!PB || g.__pbBooted) return;
  g.__pbBooted = true;

  const siteId = PB.siteIdFromHost(location.hostname);
  if (!siteId) return;
  const adapter = PB.getAdapter(siteId);
  if (!adapter) return;

  let settings = null;
  let compiled = { rules: [], allow: [], active: false, version: '0' };
  let scanner = null;
  let lastReported = -1;
  let reportTimer = null;

  function shouldRun() {
    return !!settings && settings.enabled && settings.sites[siteId] !== false && compiled.active;
  }

  function reportCount(n) {
    if (n === lastReported) return;
    lastReported = n;
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      try {
        chrome.runtime.sendMessage({ type: 'pb:count', count: lastReported, site: siteId },
          () => void chrome.runtime.lastError);
      } catch (e) { /* 擴充功能已重新載入 */ }
    }, 400);
  }

  function apply(newSettings) {
    settings = newSettings;
    compiled = PB.compile(settings);
    PB.Masker.setConfig(settings);

    if (!shouldRun()) {
      if (scanner) { scanner.stop(); scanner = null; }
      PB.Masker.resetAll();
      reportCount(0);
      return;
    }
    // 設定變了，先全部清掉再重判，避免殘留舊效果
    PB.Masker.resetAll();
    if (!scanner) scanner = PB.createScanner(adapter, () => compiled, reportCount);
    scanner.start();
    scanner.rescan();
  }

  PB.loadSettings().then(apply);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    apply(PB.normalizeSettings(changes.settings.newValue));
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'pb:getStatus':
        sendResponse({
          site: siteId,
          siteLabel: PB.siteLabel(siteId),
          count: PB.Masker.count,
          running: shouldRun()
        });
        return true;
      case 'pb:revealAll':
        document.querySelectorAll('.pb-host').forEach(h => PB.Masker.reveal(h));
        sendResponse({ ok: true });
        return true;
      case 'pb:rescan':
        if (scanner) scanner.rescan();
        sendResponse({ ok: true });
        return true;
    }
  });

  // 單頁應用換頁（FB/IG/X 都是 SPA）時主動補掃
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (scanner) scanner.rescan();
  }, 700);
})(typeof globalThis !== 'undefined' ? globalThis : self);
