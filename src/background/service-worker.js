/* 背景服務：徽章計數、右鍵選單、初始化 */
import '../common/defaults.js';

const PB = globalThis.PB;
const BADGE_BG = '#4b5563';

chrome.runtime.onInstalled.addListener(async details => {
  const settings = await PB.loadSettings();
  if (!settings.stats.since) settings.stats.since = Date.now();
  await PB.saveSettings(settings);
  buildMenus();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(buildMenus);

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pb-add-selection',
      title: '加入屏蔽關鍵字：「%s」',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'pb-open-options',
      title: '開啟靜音牆設定…',
      contexts: ['action', 'selection']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pb-open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (info.menuItemId !== 'pb-add-selection') return;

  const text = (info.selectionText || '').trim().slice(0, 80);
  if (!text) return;

  const settings = await PB.loadSettings();
  const exists = settings.rules.some(
    r => r.pattern.toLowerCase() === text.toLowerCase() && r.mode === 'plain'
  );
  if (!exists) {
    settings.rules.push(PB.normalizeRule({ pattern: text, mode: 'plain', note: '由右鍵選單新增' }));
    await PB.saveSettings(settings);
  }
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'pb:rescan' }, () => void chrome.runtime.lastError);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'pb:count') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  const n = Number(msg.count) || 0;
  chrome.action.setBadgeText({ tabId, text: n > 0 ? (n > 999 ? '999+' : String(n)) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG });
  sendResponse && sendResponse({ ok: true });
});

chrome.tabs.onRemoved.addListener(() => { /* 徽章隨分頁消失，無需處理 */ });
