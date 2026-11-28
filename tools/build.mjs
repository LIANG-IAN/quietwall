#!/usr/bin/env node
/* 打包兩個瀏覽器的版本。
 *
 *   node tools/build.mjs            兩個都打
 *   node tools/build.mjs firefox    只打 Firefox
 *
 * src/ 是兩邊共用的，差異只在 manifest，所以這裡以 Chrome 的 manifest.json
 * 為唯一來源，Firefox 版用程式轉出來——不另外維護第二份，免得改一邊忘一邊。
 *
 * 產出：
 *   dist/chrome/   dist/quietwall-chrome-<版本>.zip
 *   dist/firefox/  dist/quietwall-firefox-<版本>.zip
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

/** 兩邊都要帶上的檔案 */
const PAYLOAD = ['src', 'icons'];

/** Firefox 附加元件的識別碼，上架與簽章都靠它，不要隨意改 */
const GECKO_ID = 'quietwall@liang-ian.github.io';

/* 功能本身只需要 Firefox 121（MV3 事件頁面能正常啟動），但 AMO 必填的
   data_collection_permissions 要到 140 才認得，所以底線訂在 140 這個 ESR 版本。 */
const GECKO_MIN = '140.0';

export function toFirefox(chromeManifest) {
  const m = structuredClone(chromeManifest);

  // Firefox 不支援 background.service_worker，載入時會直接報錯；
  // 改成事件頁面，並把共用設定排在前面先載好。
  m.background = {
    scripts: ['src/common/defaults.js', 'src/background/service-worker.js']
  };

  delete m.minimum_chrome_version;

  m.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN,
      // 靜音牆不收集任何資料，設定只存在本機瀏覽器裡。
      // 這個欄位是 AMO 的必填項，用來在安裝畫面上向使用者說明。
      data_collection_permissions: { required: ['none'] }
    },
    // Android 版的同一個欄位晚了兩個版本才支援。沒在手機上實測過，
    // 這裡只是標出版本底線，避免裝在認不得這個欄位的舊版上。
    gecko_android: { strict_min_version: '142.0' }
  };

  return m;
}

async function build(target, manifest) {
  const out = join(dist, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const item of PAYLOAD) {
    await cp(join(root, item), join(out, item), { recursive: true });
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const zip = `quietwall-${target}-${manifest.version}.zip`;
  await rm(join(dist, zip), { force: true });
  // 從資料夾內打包，壓縮檔裡才不會多一層目錄（兩邊的商店都要求這樣）
  execFileSync('zip', ['-rq', join(dist, zip), '.', '-x', '.*'], { cwd: out });

  console.log(`${target.padEnd(8)} dist/${target}/  →  dist/${zip}`);
}

/* 直接執行才打包；被 import 時只提供 toFirefox 給測試用 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const want = process.argv.slice(2);
  const targets = want.length ? want : ['chrome', 'firefox'];

  const chromeManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));

  for (const t of targets) {
    if (t === 'chrome') await build('chrome', chromeManifest);
    else if (t === 'firefox') await build('firefox', toFirefox(chromeManifest));
    else {
      console.error(`不認得的目標：${t}（可用 chrome、firefox）`);
      process.exit(1);
    }
  }
}
