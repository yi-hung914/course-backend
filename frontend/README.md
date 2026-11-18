# 課程規劃助手 — 學生端前端（React + Vite）

## 第一次使用
```bash
cd frontend
npm install
```

## 本機開發
1. 先在專案最外層啟動後端：`node server.js`（http://localhost:3000）
2. 另開一個終端機：
   ```bash
   cd frontend
   npm run dev
   ```
3. 瀏覽器會自動打開 http://localhost:5173/course-backend/ ，改程式存檔後畫面會自動更新。

## 部署
推上 GitHub 的 main 分支後，GitHub Actions 會自動打包並發佈到
https://yi-hung914.github.io/course-backend/ （不用自己打包）。

## 資料夾說明
| 位置 | 內容 |
|---|---|
| `src/App.jsx` | 整體畫面：登入 → 主畫面（三個分頁） |
| `src/AppContext.jsx` | 共用狀態與動作：學期、課表、收藏、系所、搜尋條件 |
| `src/api.js` | 呼叫後端 API、登入 token |
| `src/components/` | 各畫面元件（登入、導覽列、系所選擇、課程搜尋、課表、學分分析、彈窗） |
| `src/lib/course.js` | 課程資料整理、衝堂判斷等小工具 |
| `src/lib/assistant.js` | 智慧選課助理（規則式解析、排課、興趣推薦） |
| `src/data/departments.js` | 系所代碼與學制對照表 |
| `src/styles.css` | 樣式 |
