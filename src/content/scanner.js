/* 掃描器：找出貼文、取文字、交給比對引擎，並在動態載入時持續運作 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  const DEBOUNCE = 180;      // 連續 DOM 變動後多久才掃一次
  const MAX_WAIT = 900;      // 變動不停時最長等待
  const SWEEP_EVERY = 4000;  // 定期全頁補掃（處理延遲載入的文字）
  const BULK_THRESHOLD = 25; // 新增節點超過這個數量就改成全頁掃描

  function create(adapter, getCompiled, onCount) {
    let observer = null;
    let timer = null, maxTimer = null, sweepTimer = null;
    let pending = [];
    let fullScanQueued = false;
    let running = false;
    let writing = false; // 自己改 DOM 時，忽略由此產生的 mutation

    const idle = g.requestIdleCallback
      ? cb => g.requestIdleCallback(cb, { timeout: 500 })
      : cb => setTimeout(cb, 0);

    function matchesAny(el) {
      for (let i = 0; i < adapter.selectors.length; i++) {
        try { if (el.matches(adapter.selectors[i])) return true; } catch (e) { /* noop */ }
      }
      return false;
    }

    function collectInto(root, out) {
      for (let i = 0; i < adapter.selectors.length; i++) {
        let found;
        try { found = root.querySelectorAll(adapter.selectors[i]); } catch (e) { continue; }
        for (let j = 0; j < found.length; j++) out.add(found[j]);
      }
    }

    /** 這個元素是否已經被某個「別人的」遮罩包住了 */
    function coveredByOther(el) {
      const parent = el.parentElement;
      if (!parent) return false;
      const host = parent.closest('.pb-host');
      if (!host) return false;
      // 自己的遮罩套在外層容器上 → 不算被別人蓋住
      const mine = el.__pbTargets;
      return !(mine && mine.indexOf(host) !== -1);
    }

    function clearTargets(el) {
      if (!el.__pbTargets) return;
      for (let i = 0; i < el.__pbTargets.length; i++) PB.Masker.unmask(el.__pbTargets[i]);
      el.__pbTargets = null;
    }

    function processOne(el, compiled) {
      if (!el || !el.isConnected) return;
      if (el.closest('[data-pb-ui]')) return;
      if (coveredByOther(el)) return;

      let raw;
      try { raw = adapter.text(el) || ''; } catch (e) { return; }
      if (raw.length < 2) return;

      const st = el.__pbState;
      if (st && st.v === compiled.version && st.len === raw.length) return;
      el.__pbState = { v: compiled.version, len: raw.length };

      const rule = PB.evaluate(raw, compiled, adapter.id);

      if (!rule) { clearTargets(el); return; }

      let container = el;
      if (adapter.container) {
        try { container = adapter.container(el) || el; } catch (e) { container = el; }
      }

      // 依「遮蔽範圍」決定要蓋住貼文的哪些部分
      clearTargets(el);
      const applied = PB.Masker.maskPost(container, rule, compiled.scope);
      el.__pbTargets = applied.length ? applied : null;
    }

    function run(nodes) {
      const compiled = getCompiled();
      if (!compiled || !compiled.active) return;
      writing = true;
      try {
        // 由外而內處理，讓外層貼文先被判定，內層留言才不會重複蓋一層。
        // 用「DOM 深度」排序而不是 compareDocumentPosition：後者對非巢狀的
        // 兩個元素只能回傳 0，是個不完整的比較器，排序結果會隨陣列長度而變，
        // 導致內層元素有時會排到外層前面、同一則貼文被遮兩次。
        const list = Array.from(nodes);
        const depth = new Map();
        for (let i = 0; i < list.length; i++) {
          let d = 0, p = list[i].parentElement;
          while (p) { d++; p = p.parentElement; }
          depth.set(list[i], d);
        }
        list.sort((a, b) => depth.get(a) - depth.get(b));
        for (let i = 0; i < list.length; i++) processOne(list[i], compiled);
      } finally {
        writing = false;
      }
      if (onCount) onCount(PB.Masker.count);
    }

    function fullScan() {
      if (!document.body) return;
      const set = new Set();
      collectInto(document.body, set);
      run(set);
    }

    function flush() {
      timer = null;
      if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
      const queued = fullScanQueued;
      const nodes = pending;
      pending = [];
      fullScanQueued = false;
      idle(() => {
        if (!running) return;
        if (queued) { fullScan(); return; }
        const set = new Set();
        for (const n of nodes) {
          if (!n.isConnected) continue;
          if (matchesAny(n)) set.add(n);
          collectInto(n, set);
        }
        if (set.size) run(set);
      });
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE);
      if (!maxTimer) maxTimer = setTimeout(flush, MAX_WAIT);
    }

    function onMutations(records) {
      if (writing) return;
      let textChanged = false;
      for (let i = 0; i < records.length; i++) {
        const m = records[i];
        if (m.target && m.target.nodeType === 1 && m.target.closest &&
            m.target.closest('[data-pb-ui]')) continue;

        if (m.type === 'characterData') { textChanged = true; continue; }
        for (let j = 0; j < m.addedNodes.length; j++) {
          const n = m.addedNodes[j];
          if (n.nodeType === 1) pending.push(n);
          else if (n.nodeType === 3) textChanged = true;
        }
      }
      if (textChanged || pending.length > BULK_THRESHOLD) {
        fullScanQueued = true;
        pending = [];
      }
      if (fullScanQueued || pending.length) schedule();
    }

    function start() {
      if (running) return;
      running = true;
      const begin = () => {
        if (!running) return;
        fullScan();
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement, {
          childList: true, subtree: true, characterData: true
        });
        sweepTimer = setInterval(() => {
          if (!running || document.hidden) return;
          PB.Masker.sweep();
          fullScanQueued = true;
          schedule();
        }, SWEEP_EVERY);
      };
      if (document.body) begin();
      else document.addEventListener('DOMContentLoaded', begin, { once: true });
    }

    function stop() {
      running = false;
      if (observer) { observer.disconnect(); observer = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
      if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
      pending = [];
      fullScanQueued = false;
    }

    function rescan() {
      if (!running) return;
      fullScanQueued = true;
      schedule();
    }

    return { start, stop, rescan, fullScan };
  }

  PB.createScanner = create;
})(typeof globalThis !== 'undefined' ? globalThis : self);
