# 台股開盤前全球訊號卡

以 Astro 建立的純靜態市場儀表板。GitHub Actions 每天在台灣時間 07:30、08:30、08:55 抓取全球市場收盤資料，經過有限重試、驗證與規則評分後，更新靜態 JSON 並部署到 GitHub Pages。

> 本專案只在資料更新工作流程中存取外部資料；瀏覽器端不會直接呼叫 Yahoo Finance 或其他市場 API。

## 指標

| 分類 | 指標（Yahoo symbol） |
| --- | --- |
| 美國指數 | S&P 500 (`^GSPC`)、Nasdaq (`^IXIC`)、Dow Jones (`^DJI`) |
| 半導體 | SOX 費半 (`^SOX`)、TSM ADR (`TSM`)、NVIDIA (`NVDA`)、AMD (`AMD`)、ASML (`ASML`) |
| 風險與總經 | VIX (`^VIX`)、美國 10 年期殖利率 (`^TNX`)、USD/TWD (`TWD=X`) |
| 商品 | WTI 原油 (`CL=F`)、黃金 (`GC=F`) |
| 亞洲指數 | 日經 225 (`^N225`)、香港恆生 (`^HSI`) |

第一版所有指標都經由 `scripts/utils/yahoo.ts` 封裝的 Yahoo Finance chart endpoint 取得。`fred.ts` 與 `twse.ts` 已保留為未來替換或交叉驗證資料源的介面。

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
4. 超過 96 小時的市場時間戳標記為 `stale`。
5. 產生資料後執行 schema 與計數一致性驗證。
6. 以暫存檔加 rename 原子寫入：
   - `public/data/latest.json`
   - `public/data/status.json`
   - `public/data/history/YYYY-MM-DD.json`
7. 工作流程再執行驗證與 Astro build；通過後才 commit `public/data`。

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
npm run validate:data
npm run build
```

## GitHub Actions 排程

`.github/workflows/update-data.yml` 支援手動執行，並使用 GitHub Actions 的 timezone-aware schedule：

- 07:30 `Asia/Taipei`
- 08:30 `Asia/Taipei`
- 08:55 `Asia/Taipei`

若執行環境不支援 `timezone`，UTC 對應為前一日 23:30、當日 00:30、當日 00:55。GitHub 排程可能因平台負載而略有延遲。

資料有變更時，workflow 使用 `chore(data): update market signal YYYY-MM-DD HH:mm` 格式 commit 回 `main`，並主動 dispatch Pages 部署。這是因為由 `GITHUB_TOKEN` push 的 commit 不會再次自動觸發另一個 workflow。

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
public/data/             # 最新、狀態與每日歷史 JSON
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
