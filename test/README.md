# 測試

把擴充功能真的載進 Chromium，用自簽憑證把 `facebook.com`、`youtube.com` 等網域
映射到本機的模擬頁，再對實際的 DOM 與套用後的樣式做斷言。

## 為什麼要這樣測

這個擴充功能的錯誤幾乎都不在邏輯層，而在「瀏覽器實際怎麼套用樣式」這一層：

- 網站用特異性更高的 CSS 把遮罩濾鏡蓋掉，遮罩提示出現了但內容清晰可見
- `pointer-events` 是可繼承屬性，網站在外層設成 `none` 會讓遮罩被點穿
- Chrome 不會因為 SVG 濾鏡內容改變就重繪參照它的元素
- 圖片載入前高度是 0，載入後才撐開，期間貼文文字完全沒變

這些用單元測試看不出來，只有真的跑起來才會現形。上面每一項都是實際發生過、
修好之後留在 `specs/robustness.test.js` 等檔案裡設防的。

## 跑不到的部分：Firefox

Playwright 無法在 Firefox 載入擴充套件，所以這套測試只跑得了 Chromium。
`specs/build.test.js` 只能驗到 Firefox 版 manifest 的內容是否正確，
真正的 Firefox 行為得靠 Mozilla 的 `web-ext lint` 加手動驗證：

```bash
node tools/build.mjs firefox
npx web-ext lint --source-dir dist/firefox
```

接著在 `about:debugging#/runtime/this-firefox` 臨時載入 `dist/firefox/`，
手動確認遮罩、馬賽克格子大小、影片靜音與授權流程。

## 怎麼跑

```bash
npm install playwright
```

```bash
node test/run.js
```

只跑某幾支：

```bash
node test/run.js youtube
```

MV3 擴充功能不支援 headless shell，所以會開啟完整的瀏覽器視窗。
在沒有螢幕的環境（CI、容器）請用 xvfb：

```bash
xvfb-run -a --server-args="-screen 0 1400x1600x24" node test/run.js
```

### 環境變數

| 變數 | 用途 |
|---|---|
| `QW_CHROMIUM` | 指定 Chromium 執行檔。沒設的話會找 `/opt/pw-browsers/chromium`，再沒有就交給 Playwright 自己找 |
| `QW_PORT` | 模擬站台的連接埠，預設 8443 |

測試憑證會在第一次執行時用 `openssl` 自動產生在 `test/.cert/`（不進版控，
過期會自動重做）。

## 結構

```
test/
  run.js              執行器，彙總結果並以離開碼表示成敗
  lib/harness.js      啟動模擬站台與載入擴充功能的瀏覽器
  lib/assert.js       斷言收集器
  fixtures/pages/     各站台的模擬頁
  fixtures/           測試用的圖片與影片
  specs/*.test.js     測試本體
```

模擬頁是照各站台真實的 DOM 結構寫的——選擇器、巢狀深度、延遲載入的時機都盡量貼近，
因為這些正是會出問題的地方。例如 `threads-deep.html` 在貼文容器與圖片之間
刻意包了九層，`facebook-hostile.html` 則刻意用 ID 選擇器壓過擴充功能的樣式。

## 每支測試在測什麼

| 檔案 | 內容 |
|---|---|
| `matcher.test.js` | 關鍵字比對引擎。純邏輯，不開瀏覽器 |
| `feed.test.js` | 無限捲動、延遲填入的文字、徽章計數、點擊顯示原文 |
| `sites.test.js` | FB / IG / Threads / Pornhub 的選擇器、巢狀去重、逐站規則、例外清單 |
| `youtube.test.js` | 影片磚、Shorts、搜尋結果、留言，以及三種遮蔽範圍 |
| `effects.test.js` | 五種遮蔽效果，以及馬賽克格子大小可調 |
| `scope.test.js` | 整則／只遮文字／只遮圖片影片，多塊遮罩的連動 |
| `threads-deep.test.js` | 深層巢狀與延遲載入的圖片 |
| `watchpage.test.js` | 自己點進去的影片頁不被遮，推薦區塊照遮 |
| `robustness.test.js` | 網站與擴充功能互相干擾的各種情況 |
| `a11y.test.js` | 鍵盤操作與焦點防護 |
| `build.test.js` | Chrome / Firefox 兩版 manifest 的差異，以及 Firefox 專屬 UI 在 Chrome 上要隱形 |

## 加新站台時

1. 在 `fixtures/pages/` 放一份模擬頁，DOM 結構照真實站台寫
2. 在 `specs/` 加一支測試，或擴充 `sites.test.js`
3. 跑 `node test/run.js` 確認既有站台沒被影響——
   所有站台共用同一包 content script，改一處就可能壞一片
