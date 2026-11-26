(function () {
  'use strict';
  const PB = globalThis.PB;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  let settings = null;
  let saveTimer = null;
  const expanded = new Set();

  /* ── 存檔（去抖動）────────────────────────────── */
  function save(immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    const run = () => { saveTimer = null; PB.saveSettings(settings); };
    if (immediate) run(); else saveTimer = setTimeout(run, 250);
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ── 分頁切換 ──────────────────────────────── */
  function initNav() {
    $$('.navbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.panel;
        $$('.navbtn').forEach(b => b.setAttribute('aria-current', String(b === btn)));
        $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
        if (name === 'effect') refreshPreview();
        if (name === 'data') renderFacts();
        location.hash = name;
      });
    });
    const openFromHash = () => {
      const hash = location.hash.replace('#', '');
      const target = $$('.navbtn').find(b => b.dataset.panel === hash);
      if (target && target.getAttribute('aria-current') !== 'true') target.click();
    };
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
  }

  /* ── 規則清單 ──────────────────────────────── */
  function fillModeSelect(sel, value) {
    sel.textContent = '';
    PB.MODES.forEach(m => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      o.title = m.desc;
      sel.appendChild(o);
    });
    if (value) sel.value = value;
  }

  function regexError(rule) {
    if (rule.mode !== 'regex') return '';
    try { new RegExp(rule.pattern); return ''; }
    catch (e) { return '正規表示式無效：' + e.message; }
  }

  function scopeSummary(rule) {
    if (rule.sites.indexOf('*') !== -1) return '全部網站';
    return rule.sites.map(PB.siteLabel).join('、');
  }

  function buildRuleCard(rule, listKey) {
    const card = document.createElement('div');
    card.className = 'rule' + (rule.enabled ? '' : ' off');
    card.dataset.id = rule.id;

    /* 第一行 */
    const top = document.createElement('div');
    top.className = 'rule-top';

    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = rule.enabled;
    on.title = '啟用這條規則';
    on.addEventListener('change', () => {
      rule.enabled = on.checked;
      card.classList.toggle('off', !on.checked);
      save();
    });
    top.appendChild(on);

    const pattern = document.createElement('input');
    pattern.type = 'text';
    pattern.className = 'rule-pattern';
    pattern.value = rule.pattern;
    pattern.setAttribute('aria-label', '關鍵字');
    pattern.addEventListener('input', () => {
      rule.pattern = pattern.value;
      updateHint();
      save();
    });
    top.appendChild(pattern);

    const badge = document.createElement('span');
    badge.className = 'badge';
    top.appendChild(badge);

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'iconbtn';
    expandBtn.title = '更多設定';
    expandBtn.textContent = '⋯';
    top.appendChild(expandBtn);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'iconbtn del';
    del.title = '刪除';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const arr = settings[listKey];
      const i = arr.findIndex(r => r.id === rule.id);
      if (i >= 0) arr.splice(i, 1);
      save(true);
      render();
      toast('已刪除「' + rule.pattern + '」');
    });
    top.appendChild(del);

    card.appendChild(top);

    /* 展開區 */
    const body = document.createElement('div');
    body.className = 'rule-body';
    body.hidden = !expanded.has(rule.id);

    const modeWrap = document.createElement('div');
    const modeLabel = document.createElement('label');
    modeLabel.className = 'f';
    modeLabel.textContent = '比對模式';
    const modeSel = document.createElement('select');
    fillModeSelect(modeSel, rule.mode);
    modeSel.addEventListener('change', () => {
      rule.mode = modeSel.value;
      updateHint();
      save();
    });
    modeLabel.appendChild(modeSel);
    modeWrap.appendChild(modeLabel);

    const csLabel = document.createElement('label');
    csLabel.className = 'check';
    const cs = document.createElement('input');
    cs.type = 'checkbox';
    cs.checked = rule.caseSensitive;
    cs.addEventListener('change', () => { rule.caseSensitive = cs.checked; save(); });
    csLabel.appendChild(cs);
    csLabel.appendChild(document.createTextNode('區分大小寫'));
    modeWrap.appendChild(csLabel);
    body.appendChild(modeWrap);

    if (listKey === 'rules') {
      const fxWrap = document.createElement('div');
      const fxLabel = document.createElement('label');
      fxLabel.className = 'f';
      fxLabel.textContent = '這條規則的效果';
      const fxSel = document.createElement('select');
      const inherit = document.createElement('option');
      inherit.value = 'inherit';
      inherit.textContent = '跟隨全域設定';
      fxSel.appendChild(inherit);
      PB.EFFECTS.forEach(e => {
        const o = document.createElement('option');
        o.value = e.id; o.textContent = e.label;
        fxSel.appendChild(o);
      });
      fxSel.value = rule.effect;
      fxSel.addEventListener('change', () => { rule.effect = fxSel.value; save(); updateBadge(); });
      fxLabel.appendChild(fxSel);
      fxWrap.appendChild(fxLabel);
      body.appendChild(fxWrap);
    }

    const scopeWrap = document.createElement('div');
    const scopeLabel = document.createElement('span');
    scopeLabel.className = 'f';
    scopeLabel.textContent = '套用網站';
    scopeWrap.appendChild(scopeLabel);
    const scopes = document.createElement('div');
    scopes.className = 'scopes';

    function renderScopes() {
      scopes.textContent = '';
      const all = rule.sites.indexOf('*') !== -1;
      const mk = (id, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'scope';
        b.textContent = label;
        const pressed = id === '*' ? all : (!all && rule.sites.indexOf(id) !== -1);
        b.setAttribute('aria-pressed', String(pressed));
        b.addEventListener('click', () => {
          if (id === '*') {
            rule.sites = ['*'];
          } else {
            let list = all ? [] : rule.sites.filter(x => x !== '*');
            const i = list.indexOf(id);
            if (i >= 0) list.splice(i, 1); else list.push(id);
            rule.sites = list.length ? list : ['*'];
          }
          renderScopes();
          updateBadge();
          save();
        });
        return b;
      };
      scopes.appendChild(mk('*', '全部網站'));
      PB.SITES.forEach(s => scopes.appendChild(mk(s.id, s.label)));
    }
    renderScopes();
    scopeWrap.appendChild(scopes);
    body.appendChild(scopeWrap);

    card.appendChild(body);

    const hint = document.createElement('p');
    hint.className = 'hinttext';
    card.appendChild(hint);

    function updateBadge() {
      const parts = [PB.MODES.find(m => m.id === rule.mode).label, scopeSummary(rule)];
      if (listKey === 'rules' && rule.effect !== 'inherit') {
        const e = PB.EFFECTS.find(x => x.id === rule.effect);
        if (e) parts.push(e.label);
      }
      badge.textContent = parts.join(' · ');
    }
    function updateHint() {
      const err = regexError(rule);
      hint.textContent = err;
      hint.classList.toggle('bad', !!err);
      hint.hidden = !err;
      updateBadge();
    }
    updateHint();

    expandBtn.addEventListener('click', () => {
      body.hidden = !body.hidden;
      if (body.hidden) expanded.delete(rule.id); else expanded.add(rule.id);
    });

    return card;
  }

  function renderList(listKey, containerSel, emptySel, filter) {
    const box = $(containerSel);
    box.textContent = '';
    const q = (filter || '').trim().toLowerCase();
    const items = settings[listKey].filter(r => !q || r.pattern.toLowerCase().includes(q));
    items.forEach(r => box.appendChild(buildRuleCard(r, listKey)));
    const empty = $(emptySel);
    if (empty) empty.hidden = settings[listKey].length > 0;
    return items.length;
  }

  function render() {
    const shown = renderList('rules', '#ruleList', '#ruleEmpty', $('#ruleSearch').value);
    const total = settings.rules.length;
    $('#ruleCount').textContent = shown === total
      ? total + ' 條規則'
      : shown + ' / ' + total + ' 條';
    renderList('allow', '#allowList', '#allowEmpty', '');
  }

  function addRule(listKey, pattern, mode) {
    pattern = String(pattern || '').trim();
    if (!pattern) return false;
    const dup = settings[listKey].some(
      r => r.pattern.toLowerCase() === pattern.toLowerCase() && r.mode === mode
    );
    if (dup) { toast('「' + pattern + '」已經在清單裡'); return false; }
    settings[listKey].unshift(PB.normalizeRule({ pattern, mode }));
    save(true);
    render();
    return true;
  }

  /* ── 效果面板 ──────────────────────────────── */
  function buildRadios(container, items, name, current, onPick) {
    container.textContent = '';
    items.forEach(it => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = it.id;
      input.checked = it.id === current;
      input.addEventListener('change', () => { if (input.checked) onPick(it.id); });
      label.appendChild(input);
      const text = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = it.label;
      text.appendChild(b);
      if (it.desc) {
        const em = document.createElement('em');
        em.textContent = it.desc;
        text.appendChild(em);
      }
      label.appendChild(text);
      container.appendChild(label);
    });
  }

  function syncRangeVisibility() {
    const t = settings.effect.type;
    $('#rangeBlur').hidden = t !== 'blur';
    $('#rangeMosaic').hidden = t !== 'mosaic';
    $('#rangeDark').hidden = t !== 'black';
    $('#rangeCollapse').hidden = t !== 'collapse';
  }

  function refreshPreview() {
    const post = $('#previewPost');
    PB.Masker.unmask(post);
    PB.Masker.setConfig(settings);
    if (settings.effect.type === 'hide') {
      // 預覽不真的隱藏，否則畫面上什麼都看不到
      PB.Masker.mask(post, { id: 'preview', label: '劇透', effect: 'collapse' });
    } else {
      PB.Masker.mask(post, { id: 'preview', label: '劇透', effect: 'inherit' });
    }
  }

  function bindRange(inputSel, outSel, key, format) {
    const input = $(inputSel), out = $(outSel);
    const read = () => (key === 'darkness'
      ? Math.round(settings.effect.darkness * 100)
      : settings.effect[key]);
    input.value = read();
    out.textContent = format(read());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      settings.effect[key] = key === 'darkness' ? v / 100 : v;
      out.textContent = format(v);
      save();
      refreshPreview();
    });
  }

  function initEffectPanel() {
    buildRadios($('#effectOptions'), PB.EFFECTS, 'fx', settings.effect.type, id => {
      settings.effect.type = id;
      syncRangeVisibility();
      save();
      refreshPreview();
    });
    buildRadios($('#triggerOptions'), PB.TRIGGERS, 'trig', settings.reveal.trigger, id => {
      settings.reveal.trigger = id;
      save();
      refreshPreview();
    });
    const showReason = $('#showReason');
    showReason.checked = settings.reveal.showReason;
    showReason.addEventListener('change', () => {
      settings.reveal.showReason = showReason.checked;
      save();
      refreshPreview();
    });

    bindRange('#blurRange', '#blurOut', 'blur', v => v + ' px');
    bindRange('#mosaicRange', '#mosaicOut', 'mosaic', v => v + ' px');
    bindRange('#darkRange', '#darkOut', 'darkness', v => v + '%');
    bindRange('#collapseRange', '#collapseOut', 'collapseHeight', v => v + ' px');

    syncRangeVisibility();
    refreshPreview();
  }

  /* ── 網站面板 ──────────────────────────────── */
  function initSites() {
    const box = $('#siteList');
    box.textContent = '';
    PB.SITES.forEach(s => {
      const row = document.createElement('label');
      row.className = 'siterow';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = settings.sites[s.id] !== false;
      cb.addEventListener('change', () => { settings.sites[s.id] = cb.checked; save(); });
      const b = document.createElement('b');
      b.textContent = s.label;
      const small = document.createElement('small');
      small.textContent = s.host;
      row.append(cb, b, small);
      box.appendChild(row);
    });
  }

  /* ── 備份面板 ──────────────────────────────── */
  function renderFacts() {
    const ul = $('#facts');
    ul.textContent = '';
    const on = settings.rules.filter(r => r.enabled).length;
    const facts = [
      '屏蔽規則：' + settings.rules.length + ' 條（啟用中 ' + on + ' 條）',
      '例外關鍵字：' + settings.allow.length + ' 條',
      '啟用的網站：' + (PB.SITES.filter(s => settings.sites[s.id] !== false)
        .map(s => s.label).join('、') || '無'),
      '目前效果：' + (PB.EFFECTS.find(e => e.id === settings.effect.type) || {}).label
    ];
    facts.forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  function initData() {
    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'quietwall-settings-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#dataMsg').textContent = '已匯出設定檔。';
    });

    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          settings = PB.normalizeSettings(JSON.parse(String(reader.result)));
          save(true);
          boot(true);
          $('#dataMsg').textContent = '匯入完成，共 ' + settings.rules.length + ' 條規則。';
          toast('匯入完成');
        } catch (e) {
          $('#dataMsg').textContent = '匯入失敗：檔案格式不正確。';
        }
      };
      reader.readAsText(file);
      ev.target.value = '';
    });

    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('確定要清除所有關鍵字與設定嗎？這個動作無法復原。')) return;
      settings = PB.normalizeSettings(null);
      save(true);
      boot(true);
      $('#dataMsg').textContent = '已重設為預設值。';
      toast('已重設');
    });
  }

  /* ── 啟動 ──────────────────────────────────── */
  function bindOnce() {
    initNav();
    initData();

    fillModeSelect($('#newMode'), 'plain');
    fillModeSelect($('#newAllowMode'), 'plain');

    $('#addRuleForm').addEventListener('submit', ev => {
      ev.preventDefault();
      if (addRule('rules', $('#newRule').value, $('#newMode').value)) {
        $('#newRule').value = '';
        toast('已新增規則');
      }
      $('#newRule').focus();
    });

    $('#addAllowForm').addEventListener('submit', ev => {
      ev.preventDefault();
      if (addRule('allow', $('#newAllow').value, $('#newAllowMode').value)) {
        $('#newAllow').value = '';
        toast('已新增例外');
      }
      $('#newAllow').focus();
    });

    $('#bulkAdd').addEventListener('click', () => {
      const lines = $('#bulkText').value.split('\n').map(s => s.trim()).filter(Boolean);
      let added = 0;
      lines.forEach(line => {
        const dup = settings.rules.some(
          r => r.pattern.toLowerCase() === line.toLowerCase() && r.mode === 'plain'
        );
        if (!dup) { settings.rules.unshift(PB.normalizeRule({ pattern: line })); added++; }
      });
      save(true);
      render();
      $('#bulkText').value = '';
      toast(added ? '已加入 ' + added + ' 個關鍵字' : '沒有新的關鍵字可加入');
    });

    $('#ruleSearch').addEventListener('input', render);

    $('#masterToggle').addEventListener('change', () => {
      settings.enabled = $('#masterToggle').checked;
      save();
    });
  }

  function boot(isReload) {
    $('#masterToggle').checked = settings.enabled;
    render();
    initSites();
    initEffectPanel();
    renderFacts();
    if (!isReload) bindOnce();
  }

  PB.loadSettings().then(s => { settings = s; boot(false); });

  // 其他頁面（popup / 右鍵選單）改了設定時同步畫面
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings || saveTimer) return;
    settings = PB.normalizeSettings(changes.settings.newValue);
    boot(true);
  });
})();
