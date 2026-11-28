(function () {
  'use strict';
  const PB = globalThis.PB;
  const $ = sel => document.querySelector(sel);

  let settings = null;
  let siteId = null;

  const els = {
    master: $('#masterToggle'),
    siteName: $('#siteName'),
    siteCard: $('#siteCard'),
    siteToggle: $('#siteToggle'),
    count: $('#count'),
    form: $('#quickForm'),
    input: $('#quickInput'),
    onlyThis: $('#onlyThisSite'),
    msg: $('#quickMsg'),
    chips: $('#effectChips'),
    revealAll: $('#revealAll'),
    openOptions: $('#openOptions'),
    permWarn: $('#permWarn'),
    permGo: $('#permGo')
  };

  function activeTab() {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs && tabs[0]));
    });
  }

  function ask(tabId, msg) {
    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, msg, res => {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function flash(text) {
    els.msg.textContent = text;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { els.msg.textContent = ''; }, 2200);
  }

  function renderChips() {
    els.chips.textContent = '';
    PB.EFFECTS.forEach(e => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = e.label;
      b.title = e.desc;
      b.setAttribute('aria-pressed', String(settings.effect.type === e.id));
      b.addEventListener('click', async () => {
        settings.effect.type = e.id;
        await PB.saveSettings(settings);
        renderChips();
      });
      els.chips.appendChild(b);
    });
  }

  function renderSite(status) {
    if (!siteId) {
      els.siteName.textContent = '這個網站尚未支援';
      els.siteCard.classList.add('dim');
      els.siteToggle.checked = false;
      return;
    }
    els.siteName.textContent = PB.siteLabel(siteId);
    els.siteToggle.checked = settings.sites[siteId] !== false;
    els.count.textContent = status ? String(status.count || 0) : '0';
    els.siteCard.classList.toggle('dim', !settings.enabled);
  }

  async function init() {
    settings = await PB.loadSettings();
    const tab = await activeTab();
    let host = '';
    try { host = new URL(tab && tab.url ? tab.url : '').hostname; } catch (e) { /* noop */ }
    siteId = PB.siteIdFromHost(host);

    let status = null;
    if (siteId && tab) status = await ask(tab.id, { type: 'pb:getStatus' });

    els.master.checked = settings.enabled;
    els.onlyThis.disabled = !siteId;
    renderSite(status);
    renderChips();

    els.master.addEventListener('change', async () => {
      settings.enabled = els.master.checked;
      await PB.saveSettings(settings);
      renderSite(status);
    });

    els.siteToggle.addEventListener('change', async () => {
      if (!siteId) return;
      settings.sites[siteId] = els.siteToggle.checked;
      await PB.saveSettings(settings);
    });

    els.form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const text = els.input.value.trim();
      if (!text) return;
      const scope = (els.onlyThis.checked && siteId) ? [siteId] : ['*'];
      const dup = settings.rules.find(
        r => r.pattern.toLowerCase() === text.toLowerCase() && r.mode === 'plain'
      );
      if (dup) {
        flash('這個關鍵字已經在清單裡了');
      } else {
        settings.rules.push(PB.normalizeRule({ pattern: text, mode: 'plain', sites: scope }));
        await PB.saveSettings(settings);
        flash('已加入「' + text + '」');
      }
      els.input.value = '';
      if (tab) ask(tab.id, { type: 'pb:rescan' });
    });

    els.revealAll.addEventListener('click', async () => {
      if (!tab) return;
      await ask(tab.id, { type: 'pb:revealAll' });
      window.close();
    });

    els.openOptions.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    // Firefox 的 MV3 不會在安裝時給網站授權；Chrome 這裡永遠是空的
    PB.missingOrigins().then(miss => { els.permWarn.hidden = !miss.length; });
    els.permGo.addEventListener('click', () => {
      // 授權視窗會把 popup 關掉，所以帶到設定頁去按，按完畫面還在
      const url = chrome.runtime.getURL('src/options/options.html#sites');
      chrome.tabs.create({ url });
      window.close();
    });

    els.input.focus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
