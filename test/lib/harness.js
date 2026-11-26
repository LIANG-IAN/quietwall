/**
 * 測試底座：把擴充功能真的載進 Chromium，用自簽憑證把各社群網站的網域
 * 映射到本機的模擬頁，再對真實的 DOM 與樣式做斷言。
 *
 * 之所以不用單元測試替代：這個擴充功能的錯誤幾乎都發生在
 * 「瀏覽器實際怎麼套用樣式」這一層（濾鏡被網站蓋掉、pointer-events 繼承、
 * SVG 濾鏡不重繪……），這些只有真的跑起來才看得到。
 */
'use strict';
const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TEST_DIR = path.join(__dirname, '..');
const REPO = path.join(TEST_DIR, '..');
const FIXTURES = path.join(TEST_DIR, 'fixtures');
const CERT_DIR = path.join(TEST_DIR, '.cert');
const PORT = Number(process.env.QW_PORT || 8443);

/** 測試憑證：不進版控，過期或不存在就重新產生 */
function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  let ok = fs.existsSync(key) && fs.existsSync(cert);
  if (ok) {
    try {
      execFileSync('openssl', ['x509', '-checkend', '3600', '-noout', '-in', cert],
        { stdio: 'ignore' });
    } catch (e) { ok = false; }
  }
  if (!ok) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '30',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png'
};

/**
 * 啟動模擬站台。
 * @param {Object} routes hostname → fixtures/pages 底下的檔名；
 *                 值也可以是函式 (url) => 檔名，用來區分同一站的不同頁面
 */
function serve(routes) {
  const { key, cert } = ensureCert();
  const server = https.createServer({ key, cert }, (req, res) => {
    const asset = path.join(FIXTURES, path.basename(req.url.split('?')[0]));
    if (fs.existsSync(asset) && fs.statSync(asset).isFile()) {
      const body = fs.readFileSync(asset);
      res.writeHead(200, {
        'content-type': MIME[path.extname(asset)] || 'application/octet-stream',
        'content-length': body.length
      });
      return res.end(body);
    }
    const host = (req.headers.host || '').split(':')[0];
    let page = routes[host] || routes['*'];
    if (typeof page === 'function') page = page(req.url);
    if (!page) { res.writeHead(404); return res.end('no route'); }
    const body = fs.readFileSync(path.join(FIXTURES, 'pages', page));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(body);
  });
  return new Promise(resolve => {
    server.listen(PORT, '127.0.0.1', () => resolve({
      close: () => new Promise(r => server.close(r))
    }));
  });
}

/** 載入擴充功能的 Chromium。MV3 擴充功能不支援 headless shell，必須用完整版瀏覽器 */
function chromiumPath() {
  if (process.env.QW_CHROMIUM) return process.env.QW_CHROMIUM;
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined; // 交給 Playwright 自己找
}

async function launch(opts) {
  opts = opts || {};
  const hosts = opts.hosts || [];
  // 模擬站台是本機的，別讓系統代理把請求攔走
  ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].forEach(k => delete process.env[k]);

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quietwall-test-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,                 // 擴充功能需要完整瀏覽器
    executablePath: chromiumPath(),
    args: [
      `--disable-extensions-except=${REPO}`,
      `--load-extension=${REPO}`,
      `--host-resolver-rules=${hosts.map(h => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`,
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--no-proxy-server',
      '--autoplay-policy=no-user-gesture-required'
    ],
    ignoreHTTPSErrors: true,
    viewport: opts.viewport || { width: 1100, height: 900 }
  });

  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;

  // 設定頁是唯一能寫 chrome.storage 的地方，開著它當作設定用的控制台
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${extId}/src/options/options.html`);

  return {
    ctx, sw, extId, control,
    async setSettings(partial) {
      const full = Object.assign(defaultSettings(), partial);
      if (partial && partial.effect) full.effect = Object.assign(defaultSettings().effect, partial.effect);
      if (partial && partial.reveal) full.reveal = Object.assign(defaultSettings().reveal, partial.reveal);
      if (partial && partial.sites) full.sites = Object.assign(defaultSettings().sites, partial.sites);
      await control.evaluate(v => new Promise(r => chrome.storage.local.set({ settings: v }, r)), full);
      return full;
    },
    async open(url, settleMs) {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(settleMs == null ? 2500 : settleMs);
      return page;
    },
    async badge(urlPart) {
      return sw.evaluate(async part => {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find(x => (x.url || '').includes(part));
        return t ? await chrome.action.getBadgeText({ tabId: t.id }) : null;
      }, urlPart);
    },
    close: () => ctx.close()
  };
}

function defaultSettings() {
  return {
    enabled: true,
    effect: { type: 'blur', scope: 'all', blur: 14, mosaic: 10, darkness: 0.96, collapseHeight: 44 },
    reveal: { trigger: 'click', showReason: true },
    sites: { facebook: true, instagram: true, threads: true, x: true, pornhub: true, youtube: true },
    rules: [],
    allow: [],
    stats: { total: 0, since: 0 }
  };
}

/** 點擊遮罩：每次重新量位置，因為顯示後覆蓋層會縮到右上角 */
async function clickMask(page, selector) {
  const box = await page.locator(selector || '.pb-ui').first().boundingBox();
  if (!box) throw new Error('找不到遮罩：' + (selector || '.pb-ui'));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
}

module.exports = { serve, launch, defaultSettings, clickMask, FIXTURES, REPO, PORT };
