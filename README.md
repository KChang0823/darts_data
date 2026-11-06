# 🎯 Home Darts Arcade Tracker

專為軟式電子飛鏢（Dartman Ultra / 家用軟靶）打造的極速計分與雙向數據分析 Web App（PWA）。
支援 **301 (10R)**、**501 (10R)**、**701 (15R)**、**Count-Up (8R)**、**Cricket 單人關門練習 (15R)**，搭配 **Google Sheets + Google Apps Script (GAS)** 作為永久免費雲端資料庫，隨時可將試算表直接交給 **Google Gemini** 進行深度對局與弱點分析。

---

## 📁 專案目錄結構

```text
Darts/
├── index.html             # 主應用程式（計分看板、極速鍵盤、內建數據分析頁、設定視窗）
├── manifest.webmanifest   # PWA 設定檔（支援 iPhone / iPad「加入主畫面」全螢幕獨立執行）
├── sw.js                  # 離線快取 Service Worker（斷網也能開、連網自動補傳）
├── assets/
│   └── icon.svg           # 飛鏢靶 App 圖示
├── css/
│   └── styles.css         # 街機深色霓虹風 UI + 直式/橫式 100dvh 零捲軸響應式佈局
├── js/
│   ├── engine.js          # 純計分引擎（Fat Bull、Bust 退回、Cricket 模式 B、Checkout 建議、Awards）
│   ├── storage.js         # LocalStorage 離線優先儲存、待傳佇列、GAS text/plain 免預檢同步、CSV 匯出
│   ├── stats.js           # DARTSLIVE 官方 Rating/Flight 換算、第 1/2/3 鏢穩定度、SVG 走勢圖
│   └── app.js             # UI 狀態控制器、Screen Wake Lock 防螢幕休眠、平滑轉場動畫
├── gas/
│   └── Code.gs            # 貼入 Google Sheets 擴充功能的完整 Apps Script 後端程式碼
└── tests/
    ├── engine.test.mjs    # 計分引擎單元測試
    └── stats.test.mjs     # 統計、Rating 與 CSV 匯出單元測試
```

---

## 📊 Google Sheets 儲存層設置教學（3 分鐘完成）

本系統採用 **離線優先（Offline-First）** 架構：就算還沒綁定 Google Sheets，所有對局也會自動儲存在瀏覽器本機並繪製圖表；綁定後則會在每場完賽時自動同步寫入雲端試算表。

### Step 1：建立試算表並貼上 `gas/Code.gs`
1. 前往 [Google Sheets](https://sheets.new) 新增一份空白試算表，命名為 `Darts_Database`（或任意名稱）。
2. 點選頂部選單 **「擴充功能 (Extensions)」➔「Apps Script」**。
3. 將編輯器內預設的 `function myFunction() {}` 刪除，把本專案 [`gas/Code.gs`](./gas/Code.gs) 的全部內容複製貼上，按 `Cmd + S`（或點擊磁碟片圖示）儲存。
4. *(選用)* 在上方函式下拉選單選擇 `setup`，點擊 **「執行 (Run)」**，並在跳出的權限視窗點選「審查權限 ➔ 選擇你的 Google 帳號 ➔ 進階 ➔ 前往專案（不安全）➔ 允許」。執行後試算表會立刻自動建立好 **`Games`** 與 **`Darts`** 兩張深色標題列的工作表！（若略過此步，第一次從網頁上傳時也會自動建立）。

### Step 2：部署為網頁應用程式 (Web App)
1. 在 Apps Script 右上角點擊 **「部署 (Deploy)」➔「新增部署作業 (New deployment)」**。
2. 點擊左上角齒輪圖示「選取類型」➔ 勾選 **「網頁應用程式 (Web app)」**。
3. 設定如下：
   - **說明**：`Darts API v1`
   - **執行身分 (Execute as)**：**「我 (Me)」**
   - **誰可以存取 (Who has access)**：**「任何人 (Anyone)」** *(重要：必須選任何人，前端跨域直連才不會被擋重新導向登入)*
4. 點擊 **「部署 (Deploy)」**，複製產生的 **網頁應用程式網址 (`https://script.google.com/macros/s/.../exec`)**。

### Step 3：在打鏢網頁中綁定網址
1. 打開你的打鏢網頁 App，點擊右上角 **「⚙️ 設定雲端」**。
2. 將剛剛複製的 `https://script.google.com/macros/s/.../exec` 貼入 **「Google Apps Script 網頁應用程式網址」**。
3. 點擊 **「💾 儲存設定並測試連線」**，看到綠色「✓ 連線成功！」即代表大功告成！
4. 若你在綁定前已經在本機打過幾場，可點擊 **「☁️ 上傳本機所有紀錄至試算表」** 一次同步上去；未來換手機或 iPad 時，則可點 **「📥 從試算表拉取歷史紀錄」** 將雲端資料抓回新裝置。

> **💡 選用安全通行碼（Passcode）**：
> 如果你擔心公開在 GitHub Pages 的網址被別人拿到亂塞資料，可以在 Apps Script 左側點選「⚙️ 專案設定 (Project Settings)」➔ 滑到最下方「指令碼屬性 (Script Properties)」➔ 新增屬性名稱 `PASSCODE`、值填你自己設的密碼（例如 `my-darts-2026`），並在網頁設定中也填入相同通行碼即可。

---

## 🤖 如何把 Google Sheets 交給 Gemini 分析你的打鏢數據？

試算表內會自動維護兩張結構化工作表：
- **`Games` 表（一場一列）**：包含 `Mode`、`Finished`、`Rounds_Played`、`Total_Darts`、`PPD`、`PPR`、`MPR`、`Effective_Marks`、`Raw_Marks`、`S_Bull_Hits`、`D_Bull_Hits`、`Bust_Rounds`、`Awards_JSON` 與 `Round_By_Round`（每輪三鏢濃縮軌跡）。
- **`Darts` 表（一鏢一列）**：包含每一鏢是第幾輪 (`Round`)、手裡第幾支鏢 (`Dart_No`: 1/2/3)、落點代碼 (`Code`)、靶位 (`Segment`)、倍率 (`Multiplier`)。

你可以直接在 Gemini 對話框附加這份 Google Sheets（或從網頁分析頁點「匯出 Games.csv / Darts.csv」上傳給 Gemini），並這樣問 Gemini：
- *「幫我從 `Darts` 表分析我在 501 模式下，手裡的第 1 鏢、第 2 鏢、第 3 鏢哪一支最容易失常或脫靶？」*
- *「幫我看 `Games` 表最近 20 場 Count-Up 跟 501，我的內紅心 (D-Bull) 佔總紅心的比例有沒有提升？」*
- *「在 Cricket 模式下，根據 `Darts` 表，15 到 20 哪一個數字我需要花最多鏢才能關門？」*

---

## 🚀 部署至 GitHub Pages 並加入手機 / iPad 主畫面

1. 在此資料夾初始化 Git 並推送到你的 GitHub 儲存庫：
   ```bash
   git init
   git add .
   git commit -m "feat: Home Darts Arcade Tracker PWA"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<你的Repo名稱>.git
   git push -u origin main
   ```
2. 到 GitHub Repo 頁面點選 **Settings ➔ Pages**，在 **Build and deployment ➔ Source** 選擇 `Deploy from a branch`，Branch 選 `main` / `/ (root)` 並按 **Save**。
3. 等待約 1 分鐘後，用 iPhone 或 iPad 的 **Safari** 打開 `https://<你的帳號>.github.io/<你的Repo名稱>/`。
4. 點擊 Safari 分享按鈕 ➔ **「加入主畫面 (Add to Home Screen)」**，從桌面點開即可享受 **100% 全螢幕無網址列、螢幕自動常亮不休眠** 的街機計分體驗！

