/* 關鍵字比對引擎 */
(function (g) {
  'use strict';
  const PB = (g.PB = g.PB || {});

  // 零寬字元 / 軟連字號：常被用來躲避關鍵字過濾
  const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿­]/g;

  /** 正規化：NFKC（全形→半形）、去零寬、合併空白、轉小寫 */
  function norm(s) {
    if (!s) return '';
    try { s = s.normalize('NFKC'); } catch (e) { /* noop */ }
    return s.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  PB.norm = norm;

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** 把一條使用者規則編譯成可執行的比對器；失敗回傳 null */
  function compileRule(rule) {
    const r = PB.normalizeRule(rule);
    if (!r || !r.enabled) return null;

    let test = null;
    if (r.mode === 'regex') {
      try {
        const re = new RegExp(r.pattern, r.caseSensitive ? '' : 'i');
        // 同時比對原文與正規化後的文字（全形→半形、去零寬）
        test = (raw, lower) => re.test(raw) || (!r.caseSensitive && re.test(lower));
      } catch (e) {
        return null; // 無效的正規表示式，直接忽略這條
      }
    } else if (r.mode === 'word') {
      // 「完整單字」只對拉丁字母/數字做邊界判斷；中日韓文字視為邊界，
      // 這樣「的SPOILER」會命中，而「spoilers」不會。
      const W = 'A-Za-z0-9_\\u00C0-\\u024F';
      const body = escapeRe(r.pattern);
      const re = new RegExp('(?:^|[^' + W + '])' + body + '(?:$|[^' + W + '])',
        r.caseSensitive ? '' : 'i');
      test = (raw, lower) => re.test(raw) || (!r.caseSensitive && re.test(lower));
    } else {
      if (r.caseSensitive) {
        const p = r.pattern.replace(ZERO_WIDTH, '');
        test = raw => raw.indexOf(p) !== -1;
      } else {
        const p = norm(r.pattern);
        if (!p) return null;
        test = (raw, lower) => lower.indexOf(p) !== -1;
      }
    }

    const anySite = r.sites.indexOf('*') !== -1;
    return {
      id: r.id,
      label: r.pattern.length > 40 ? r.pattern.slice(0, 40) + '…' : r.pattern,
      effect: r.effect,
      test,
      applies: siteId => anySite || r.sites.indexOf(siteId) !== -1
    };
  }

  /** 編譯整份設定 */
  PB.compile = function (settings) {
    const rules = [], allow = [];
    (settings.rules || []).forEach(r => { const c = compileRule(r); if (c) rules.push(c); });
    (settings.allow || []).forEach(r => { const c = compileRule(r); if (c) allow.push(c); });
    return {
      rules, allow,
      active: rules.length > 0,
      scope: (settings.effect && settings.effect.scope) || 'all',
      // 設定指紋：變動時所有節點重新判定
      version: JSON.stringify([
        settings.enabled, settings.effect, settings.reveal, settings.sites,
        settings.rules, settings.allow
      ]).length + ':' + Date.now()
    };
  };

  /**
   * 判定一段文字是否該屏蔽
   * @returns {null|{id,label,effect}} 命中的規則
   */
  PB.evaluate = function (raw, compiled, siteId) {
    if (!raw || !compiled || !compiled.active) return null;
    const lower = norm(raw);
    if (!lower) return null;

    for (let i = 0; i < compiled.allow.length; i++) {
      const a = compiled.allow[i];
      if (a.applies(siteId) && a.test(raw, lower)) return null;
    }
    for (let i = 0; i < compiled.rules.length; i++) {
      const r = compiled.rules[i];
      if (r.applies(siteId) && r.test(raw, lower)) return r;
    }
    return null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
