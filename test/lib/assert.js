/** 極簡斷言收集器：每支測試拿一個 t，最後由 run.js 彙總 */
'use strict';

class Collector {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failures = [];
  }
  _fail(label, detail) {
    this.failures.push({ label, detail });
    console.log('    ✗ ' + label + '\n        ' + detail);
  }
  _pass(label) {
    this.passed++;
    console.log('    ✓ ' + label);
  }
  ok(label, value) {
    if (value) this._pass(label);
    else this._fail(label, '預期為真，實際為 ' + JSON.stringify(value));
  }
  notOk(label, value) {
    if (!value) this._pass(label);
    else this._fail(label, '預期為假，實際為 ' + JSON.stringify(value));
  }
  equal(label, actual, expected) {
    if (actual === expected) this._pass(label);
    else this._fail(label, '預期 ' + JSON.stringify(expected) + '，實際 ' + JSON.stringify(actual));
  }
  deepEqual(label, actual, expected) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a === b) this._pass(label);
    else this._fail(label, '預期 ' + b + '\n        實際 ' + a);
  }
  match(label, actual, re) {
    if (re.test(String(actual))) this._pass(label);
    else this._fail(label, '預期符合 ' + re + '，實際 ' + JSON.stringify(actual));
  }
}

module.exports = { Collector };
