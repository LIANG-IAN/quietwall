#!/usr/bin/env node
/**
 * 測試執行器。
 *   node test/run.js            跑全部
 *   node test/run.js youtube    只跑名稱含 youtube 的
 *
 * 每支測試會自己啟動一個瀏覽器，所以是循序執行。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Collector } = require('./lib/assert');

const SPEC_DIR = path.join(__dirname, 'specs');

async function main() {
  const filter = process.argv[2];
  const specs = fs.readdirSync(SPEC_DIR)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !filter || f.includes(filter))
    .sort();

  if (!specs.length) {
    console.error('找不到符合的測試：' + (filter || '(全部)'));
    process.exit(1);
  }

  const results = [];
  const started = Date.now();

  for (const file of specs) {
    const spec = require(path.join(SPEC_DIR, file));
    const t = new Collector(spec.title || file);
    console.log('\n▶ ' + t.name);
    try {
      await spec.run(t);
    } catch (err) {
      t.failures.push({ label: '測試本身拋出例外', detail: err && err.stack || String(err) });
      console.log('    ✗ 測試本身拋出例外\n        ' + (err && err.message));
    }
    results.push(t);
  }

  const pass = results.reduce((n, r) => n + r.passed, 0);
  const fails = results.reduce((a, r) => a.concat(r.failures.map(f => ({ spec: r.name, ...f }))), []);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log('\n' + '─'.repeat(60));
  if (!fails.length) {
    console.log(`全部通過：${pass} 項斷言，${results.length} 支測試，${secs} 秒`);
    process.exit(0);
  }
  console.log(`失敗 ${fails.length} 項（通過 ${pass} 項），${secs} 秒\n`);
  fails.forEach(f => console.log(`  [${f.spec}] ${f.label}\n      ${f.detail}`));
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
