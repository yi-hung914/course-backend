/* =========================================================
   【新增】收藏課程
   - 收藏跟著帳號存在資料庫，換裝置登入也看得到
   - 收藏不會進課表、不計學分、不檢查衝堂；確定要修再按「加入課表」

   GET    /api/favorites            讀取我的收藏（含課程資料）
   POST   /api/favorites            收藏一門課 { courseId }
   DELETE /api/favorites/:courseId  取消收藏
========================================================= */
import { Router } from "express";
import { requireAuth } from "./admin.routes.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createFavoriteRouter({ prisma }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", wrap(async (req, res) => {
    const favs = await prisma.favorite.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      select: { courseId: true },
    });
    const ids = favs.map(f => f.courseId);
    const courses = ids.length
      ? await prisma.course.findMany({
          where: { id: { in: ids } },
          include: { sections: { include: { schedules: true } } },
        })
      : [];

    // 課程已被刪除的收藏順手清掉
    const exist = new Set(courses.map(c => c.id));
    const gone = ids.filter(id => !exist.has(id));
    if (gone.length) {
      await prisma.favorite.deleteMany({ where: { userId: req.userId, courseId: { in: gone } } });
    }

    const byId = new Map(courses.map(c => [c.id, c]));
    const items = ids.filter(id => byId.has(id)).map(id => byId.get(id));   // 依收藏時間，新的在前
    res.json({ ok: true, ids: items.map(c => c.id), items });
  }));

  router.post("/", wrap(async (req, res) => {
    const courseId = String(req.body?.courseId || "").trim();
    if (!courseId) return res.status(400).json({ ok: false, message: "缺少 courseId" });

    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) return res.status(404).json({ ok: false, message: "找不到這門課程" });

    await prisma.favorite.createMany({ data: [{ userId: req.userId, courseId }], skipDuplicates: true });
    res.json({ ok: true, courseId });
  }));

  router.delete("/:courseId", wrap(async (req, res) => {
    await prisma.favorite.deleteMany({ where: { userId: req.userId, courseId: req.params.courseId } });
    res.json({ ok: true, courseId: req.params.courseId });
  }));

  router.use((err, req, res, next) => {
    console.error("[favorites]", err);
    res.status(500).json({ ok: false, message: "收藏功能發生錯誤，請稍後再試" });
  });

  return router;
}

// 啟動時確保收藏資料表存在（雲端資料庫不用另外手動跑 migration）
export async function ensureFavoriteTable(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Favorite" (
      "id"        TEXT         NOT NULL,
      "userId"    TEXT         NOT NULL,
      "courseId"  TEXT         NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
    )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_courseId_key" ON "Favorite"("userId", "courseId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Favorite_userId_idx" ON "Favorite"("userId")`);
}
