# 台股開盤前全球訊號卡

以 Astro 建立的純靜態市場儀表板。GitHub Actions 每天在台灣時間 07:30、08:30、08:55 抓取全球市場資料，經過有限重試、來源驗證、語意檢查與規則評分後，更新靜態 JSON 並部署到 GitHub Pages。平日 14:30 再由 TWSE 官方資料回收當日台股結果，建立可驗證的成效閉環。

> 本專案只在資料更新工作流程中存取外部資料；瀏覽器端不會直接呼叫 Yahoo Finance 或其他市場 API。

## 指標

| 分類 | 指標（Yahoo symbol） |
| --- | --- |
| 美國指數 | S&P 500 (`^GSPC`)、Nasdaq (`^IXIC`)、Dow Jones (`^DJI`) |
| 半導體 | SOX 費半 (`^SOX`)、TSM ADR (`TSM`)、NVIDIA (`NVDA`)、AMD (`AMD`)、ASML (`ASML`) |
| 風險與總經 | VIX (`^VIX`)、美國 10 年期殖利率 (`^TNX`)、USD/TWD (`TWD=X`) |
| 商品 | WTI 原油 (`CL=F`)、黃金 (`GC=F`) |
| 亞洲指數 | 日經 225 (`^N225`)、香港恆生 (`^HSI`) |

Yahoo Finance chart endpoint 是 15 項指標的主要資料源。若設定 `FRED_API_KEY`，流程會額外抓取 FRED `DGS10`，與 Yahoo TNX 水準進行交叉驗證；FRED 不會取代 Yahoo 的計分值。

FRED 驗證規則：觀測值不得超過 3 日，且與 Yahoo 的差距不得超過 0.20 個百分點。超出門檻會標記 `mismatch` 並將資料品質降為 `degraded`；未設定 key 時顯示 `not_configured`，不會中斷更新。

## 評分邏輯

只有狀態為 `ok` 的核心指標會計分；`failed` 或 `stale` 一律為 0 分。

| 指標 | 正向 | 中性區間 | 負向 |
| --- | --- | --- | --- |
| Nasdaq | `> +1%` +2；`+0.3% ~ +1%` +1 | `-0.3% ~ +0.3%` 0 | `-1% ~ -0.3%` -1；`< -1%` -2 |
| SOX | `> +1.5%` +3；`+0.5% ~ +1.5%` +1 | `-0.5% ~ +0.5%` 0 | `-1.5% ~ -0.5%` -1；`< -1.5%` -3 |
| TSM ADR | `> +1%` +2 | 其餘 0 | `< -1%` -2 |
| NVIDIA | `> +1.5%` +1 | 其餘 0 | `< -1.5%` -1 |
| VIX | `< -5%` +1 | 其餘 0 | `> +5%` -2 |
| TNX | `< -2%` +1 | 其餘 0 | `> +2%` -1 |
| USD/TWD | `< -0.3%` +1 | 其餘 0 | `> +0.3%` -1 |

總分分級：

- `>= 6`：明顯偏多
- `2 ~ 5`：偏多
- `-1 ~ 1`：震盪
- `-5 ~ -2`：偏空
- `<= -6`：明顯偏空

核心指標定義為 Nasdaq、SOX、TSM ADR、NVIDIA、VIX、TNX、USD/TWD。核心指標 `ok` 比例低於 70% 時標記 `degraded`；全部核心指標不可用時標記 `failed`。不論單一指標或所有核心指標失敗，流程仍會產生可供前端顯示的 `latest.json`。

## 資料閉環

1. 15 個指標平行抓取，單項錯誤互不影響。
2. 每項資料最多重試 3 次（加上首次請求最多 4 次嘗試）。
3. 重試間隔固定為 1、3、9 秒的 exponential backoff，不存在無窮迴圈。
4. 新鮮度依市場類型判斷：美股 96 小時、FX／商品 24 小時、亞洲市場 48 小時；未來超過 15 分鐘的資料視為無效。
5. failed／stale 指標保留最多 7 日的 `lastGood` 供參考，但不拿 last-good 值計分。
6. 產生資料後檢查 schema、分數加總、訊號分級、品質計數、時間戳與來源狀態。
7. 以暫存檔加 rename 原子寫入：
   - `public/data/latest.json`
   - `public/data/status.json`
   - `public/data/history/YYYY-MM-DD.json`
   - `public/data/history/index.json`（去重、倒序、最多 30 日）
8. 工作流程再執行語意驗證、45 項單元測試與 Astro build；通過後才 commit `public/data`。

## 成效驗證閉環

平日 14:30 的 `Collect TAIEX outcome` workflow 從 TWSE 官方 `MI_5MINS_HIST` 取得加權指數開高低收。若當日是月份第一個交易日，會自動讀取前一月份最後一筆資料作為前收；民國日期與含千分號數字均由解析器正規化。

- 開盤缺口：`今日開盤 / 前一交易日收盤 - 1`
- 收盤報酬：`今日收盤 / 前一交易日收盤 - 1`
- 開盤缺口 `> +0.3%` 為 bullish，`< -0.3%` 為 bearish，邊界及其間為 neutral
- 中性訊號、中性開盤或盤前資料品質非 `ok` 的紀錄會保留，但排除於命中率
- 非交易日、TWSE 尚未發布或當日沒有盤前 history 時安全 no-op，不產生假資料
- 重跑同一天會覆核同一個日期檔；內容未變時不改檔、不 commit

資料介面：

- `public/data/outcomes/YYYY-MM-DD.json`：每日 signal、TWSE OHLC、開盤缺口、收盤報酬、排除原因與 hit
- `public/data/evaluation.json`：eligible／excluded 樣本、整體與多空命中率、各訊號級別平均開盤缺口及評估期間

首頁在累積 20 個 eligible 交易日前只顯示進度，不公布命中率。達門檻後才顯示整體與多空拆分；收盤報酬只供資料檢查，不作主要績效，也不會自動調整權重。

資料狀態：

- `ok`：本次取得且在新鮮度門檻內，可依規則計分。
- `stale`：本次取得但已超過門檻，不計分。
- `failed`：本次無法取得有效資料，不計分。
- `lastGood`：failed／stale 列的上次可用參考值，畫面會明確標示，不冒充目前報價。

## 本機執行

需求：Node.js 22 與 npm。

```bash
npm install
npm run dev
```

開啟 `http://localhost:4321`。

手動更新並驗證資料：

```bash
npm run fetch:data
npm run collect:outcome
npm run validate:data
npm test
npm run build
```

啟用 FRED 交叉驗證：

```bash
FRED_API_KEY=your_key npm run fetch:data
```

GitHub 上請到 **Settings → Secrets and variables → Actions** 新增 repository secret `FRED_API_KEY`。未設定時仍可正常使用 Yahoo 主流程。

## GitHub Actions 排程

`.github/workflows/update-data.yml` 支援手動執行，並使用 GitHub Actions 的 timezone-aware schedule：

- 07:30 `Asia/Taipei`
- 08:30 `Asia/Taipei`
- 08:55 `Asia/Taipei`

若執行環境不支援 `timezone`，UTC 對應為前一日 23:30、當日 00:30、當日 00:55。GitHub 排程可能因平台負載而略有延遲。

`.github/workflows/collect-outcome.yml` 支援手動執行，並於平日 14:30 `Asia/Taipei`（06:30 UTC）回收台股結果。兩個資料 workflow 都會依序完成資料產生、語意驗證、單元測試與 Astro build，通過後才 commit；無資料或內容未變時不 commit。

資料有變更時，workflow 使用 `chore(data): update market signal YYYY-MM-DD HH:mm` 格式 commit 回 `main`，並主動 dispatch Pages 部署。結構有效的 `degraded`／`failed` 快照仍會部署；只有抓取程式崩潰、語意驗證、單元測試或 build 失敗才會阻止 commit。

## GitHub Pages 部署

1. 將 repository 預設分支設為 `main`。
2. 到 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
3. push 到 `main`，或在 Actions 頁手動執行 **Deploy GitHub Pages**。
4. `astro.config.mjs` 在 GitHub Actions 中會自動使用 `/taiwan-market-open-signal/` base path。

部署網址預期為：`https://junyuo.github.io/taiwan-market-open-signal/`。

工作流程使用官方 `actions/configure-pages`、`actions/upload-pages-artifact` 與 `actions/deploy-pages`。Repository 的 Actions workflow permissions 必須允許讀寫，資料更新工作流程才能 commit 並 dispatch 部署。

## 專案結構

```text
.github/workflows/       # 資料更新與 Pages 部署
public/data/             # 最新、狀態、訊號歷史、每日 outcome 與評估 JSON
scripts/                 # 抓取、驗證、評分與資料源介面
src/components/          # 訊號卡、指標表格、品質 badge、摘要
src/lib/                 # 型別、格式與規則評分
src/pages/index.astro    # 靜態首頁
```

## 已知限制

- Yahoo Finance 是非正式 SLA 資料源，可能限流、延遲、變更格式或暫時不可用。
- 指標只供市場觀察，不構成投資建議。
- 台股開盤仍受突發新聞、外資下單、期貨盤與匯率影響，模型不能保證準確。
- 本模型比較最近兩個可取得的日線收盤點，不等於即時盤前報價。
- 30 日趨勢需逐日累積；不足 2 日時首頁會顯示「資料累積中」。
