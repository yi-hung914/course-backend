import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// 管理端頁面（admin.html）還是原本的純 HTML，放在專案最外層；
// 本機開發時讓 http://localhost:5173/course-backend/admin.html 也開得到
//（部署時由 GitHub Actions 把它複製進打包結果）
const ADMIN_HTML = fileURLToPath(new URL("../admin.html", import.meta.url));
function serveAdminPage() {
  return {
    name: "serve-admin-page",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split("?")[0].endsWith("/admin.html") && fs.existsSync(ADMIN_HTML)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(ADMIN_HTML));
          return;
        }
        next();
      });
    },
  };
}

// base：網站放在 https://yi-hung914.github.io/course-backend/ 底下，所以路徑要加上 /course-backend/
// 本機開發（npm run dev）會開在 http://localhost:5173/course-backend/
export default defineConfig({
  plugins: [react(), serveAdminPage()],
  base: "/course-backend/",
  server: { port: 5173, open: true },
});
