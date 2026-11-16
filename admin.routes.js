/**
 * 【新增】課程管理者（後台）API ＋ 個人帳號 API
 *
 * 管理者（User.role = "admin"）才能使用 /api/admin/... 這些功能：
 *   課程：  GET    /api/admin/semesters              各學期課程數
 *           GET    /api/admin/courses                查詢（semester、q、page）
 *           GET    /api/admin/courses/:id            單一課程
 *           POST   /api/admin/courses                新增
 *           PUT    /api/admin/courses/:id            修改
 *           DELETE /api/admin/courses/:id            刪除
 *           POST   /api/admin/courses/import         匯入課程查詢系統 Excel（dryRun=true 只預覽）
 *   帳號：  GET    /api/admin/users                  查詢（q、role、page）
 *           POST   /api/admin/users                  新增帳號
 *           PUT    /api/admin/users/:id              修改學號/名稱/角色
 *           PUT    /api/admin/users/:id/password     重設密碼
 *           DELETE /api/admin/users/:id              刪除帳號
 *
 * 所有登入的人都能用（個人帳號）：
 *           GET    /api/auth/me                      我的帳號資料
 *           PUT    /api/auth/password                修改自己的密碼
 */
import express from "express";
import jwt from "jsonwebtoken";
import { parseCourseWorkbook, buildCourses, replaceSemesterCourses } from "./lib/courseImport.js";
import { invalidateSemesterCache } from "./course.controller.js";

const USER_PUBLIC = { id: true, email: true, username: true, role: true, createdAt: true };
const COURSE_TYPES = ["core", "elective", "general"];

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || null;
}

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, message, ...extra });
}

// 驗證 Authorization: Bearer <accessToken>，成功後 req.userId = 使用者 id
export function requireAuth(req, res, next) {
  const secret = getAccessSecret();
  const [type, token] = String(req.headers.authorization || "").split(" ");
  if (!secret || type !== "Bearer" || !token) {
    return fail(res, 401, "請先登入", { code: "ACCESS_INVALID" });
  }
  try {
    req.userId = jwt.verify(token, secret).sub;
    next();
  } catch {
    return fail(res, 401, "登入已過期，請重新登入", { code: "ACCESS_INVALID" });
  }
}

// 每次都到資料庫確認角色，管理者被取消權限後立刻生效
function requireAdmin(prisma) {
  return async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true } });
      if (!user) return fail(res, 401, "帳號不存在，請重新登入", { code: "ACCESS_INVALID" });
      if (user.role !== "admin") return fail(res, 403, "只有課程管理者可以使用這個功能", { code: "FORBIDDEN" });
      next();
    } catch (e) {
      next(e);
    }
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- 課程資料驗證 ---------- */
function toInt(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

// 前端送來的課程 → 檢查並整理成資料庫格式；有錯回傳 { error }
function parseCourseInput(body) {
  const b = body || {};
  const semester = String(b.semester ?? "").trim();
  const code = String(b.code ?? "").trim();
  const name = String(b.name ?? "").trim();
  const teacher = String(b.teacher ?? "").trim();
  const department = String(b.department ?? "").trim();
  const type = String(b.type ?? "").trim();
  const credits = toInt(b.credits);
  const grade = toInt(b.grade);

  if (!/^\d{4}$/.test(semester)) return { error: "學期格式錯誤（例如 1151）" };
  if (!code) return { error: "請輸入課程代碼" };
  if (!name) return { error: "請輸入課程名稱" };
  if (!COURSE_TYPES.includes(type)) return { error: "請選擇課程類別" };
  if (credits === null || Number.isNaN(credits) || credits < 0 || credits > 20) return { error: "學分數要是 0～20 的整數" };
  if (Number.isNaN(grade) || (grade !== null && (grade < 1 || grade > 7))) return { error: "年級要是 1～7（可留空）" };

  let required = b.required;
  if (type === "core") required = true;
  else if (type === "elective") required = false;
  else required = required === true || required === "true" ? true : required === false || required === "false" ? false : null;

  const sectionsIn = Array.isArray(b.sections) ? b.sections : [];
  if (sectionsIn.length === 0) return { error: "至少要有一個開課班別" };

  const codes = new Set();
  const sections = [];
  let scheduleCount = 0;
  for (const [i, s] of sectionsIn.entries()) {
    const sCode = String(s?.code ?? "").trim();
    const quota = toInt(s?.quota) ?? 0;
    const location = String(s?.location ?? "").trim() || null;
    if (!sCode) return { error: `第 ${i + 1} 個班別沒有班組代碼` };
    if (codes.has(sCode)) return { error: `班組代碼「${sCode}」重複了` };
    codes.add(sCode);
    if (Number.isNaN(quota) || quota < 0) return { error: `班別「${sCode}」的人數要是 0 以上的整數` };

    const schedules = [];
    for (const t of Array.isArray(s?.schedules) ? s.schedules : []) {
      const day = toInt(t?.day), start = toInt(t?.start), end = toInt(t?.end);
      if (![day, start, end].every(n => Number.isInteger(n))) return { error: `班別「${sCode}」的上課時間沒填完整` };
      if (day < 1 || day > 7) return { error: `班別「${sCode}」的星期要是 1～7` };
      if (start < 1 || end > 14 || start > end) return { error: `班別「${sCode}」的節次要在 1～14 之間，且開始節次不能大於結束節次` };
      schedules.push({ day, start, end, location: String(t?.location ?? "").trim() || location });
    }
    scheduleCount += schedules.length;
    sections.push({ code: sCode, quota, location, schedules });
  }
  if (scheduleCount === 0) return { error: "至少要有一個上課時間（星期、節次）" };

  return {
    data: { semester, code, name, teacher, credits, grade, department: department || null, type, required },
    sections,
  };
}

function sectionsCreate(sections) {
  return {
    create: sections.map(s => ({
      code: s.code, quota: s.quota, location: s.location,
      schedules: { create: s.schedules },
    })),
  };
}

const COURSE_INCLUDE = {
  sections: { orderBy: { code: "asc" }, include: { schedules: { orderBy: [{ day: "asc" }, { start: "asc" }] } } },
};

/* =========================================================
   管理者 API
========================================================= */
export function createAdminRouter({ prisma, bcrypt }) {
  const router = express.Router();
  router.use(requireAuth, requireAdmin(prisma));

  /* ---------- 學期 ---------- */
  router.get("/semesters", wrap(async (req, res) => {
    const groups = await prisma.course.groupBy({ by: ["semester"], _count: { _all: true } });
    const items = groups
      .map(g => ({ semester: g.semester, count: g._count._all }))
      .sort((a, b) => b.semester.localeCompare(a.semester));
    res.json({ ok: true, dataSemester: String(process.env.COURSE_DATA_SEMESTER || "1101").trim(), items });
  }));

  /* ---------- 課程查詢 ---------- */
  router.get("/courses", wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const semester = String(req.query.semester || "").trim();
    const q = String(req.query.q || "").trim();

    const where = {};
    if (semester) where.semester = semester;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { teacher: { contains: q, mode: "insensitive" } },
        { department: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: COURSE_INCLUDE,
      }),
    ]);
    res.json({ ok: true, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items });
  }));

  router.get("/courses/:id", wrap(async (req, res) => {
    const item = await prisma.course.findUnique({ where: { id: req.params.id }, include: COURSE_INCLUDE });
    if (!item) return fail(res, 404, "找不到這門課程");
    res.json({ ok: true, item });
  }));

  /* ---------- 新增課程 ---------- */
  router.post("/courses", wrap(async (req, res) => {
    const parsed = parseCourseInput(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);

    const dup = await prisma.course.findFirst({ where: { code: parsed.data.code, semester: parsed.data.semester }, select: { id: true } });
    if (dup) return fail(res, 409, `${parsed.data.semester} 學期已經有課程代碼「${parsed.data.code}」`);

    const item = await prisma.course.create({
      data: { ...parsed.data, sections: sectionsCreate(parsed.sections) },
      include: COURSE_INCLUDE,
    });
    invalidateSemesterCache();
    res.status(201).json({ ok: true, item });
  }));

  /* ---------- 修改課程（班別、上課時間整組換成新的） ---------- */
  router.put("/courses/:id", wrap(async (req, res) => {
    const id = req.params.id;
    const parsed = parseCourseInput(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);

    const existing = await prisma.course.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail(res, 404, "找不到這門課程");

    const dup = await prisma.course.findFirst({
      where: { code: parsed.data.code, semester: parsed.data.semester, NOT: { id } },
      select: { id: true },
    });
    if (dup) return fail(res, 409, `${parsed.data.semester} 學期已經有課程代碼「${parsed.data.code}」`);

    const item = await prisma.$transaction(async (tx) => {
      await tx.plannerItem.deleteMany({ where: { section: { courseId: id } } });
      await tx.schedule.deleteMany({ where: { section: { courseId: id } } });
      await tx.section.deleteMany({ where: { courseId: id } });
      return tx.course.update({
        where: { id },
        data: { ...parsed.data, sections: sectionsCreate(parsed.sections) },
        include: COURSE_INCLUDE,
      });
    });
    invalidateSemesterCache();
    res.json({ ok: true, item });
  }));

  /* ---------- 刪除課程（學生課表裡的這門課也會一起移除） ---------- */
  router.delete("/courses/:id", wrap(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.course.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return fail(res, 404, "找不到這門課程");

    const [planner] = await prisma.$transaction([
      prisma.planner.deleteMany({ where: { courseId: id } }),
      prisma.plannerItem.deleteMany({ where: { section: { courseId: id } } }),
      prisma.schedule.deleteMany({ where: { section: { courseId: id } } }),
      prisma.section.deleteMany({ where: { courseId: id } }),
      prisma.course.delete({ where: { id } }),
    ]);
    invalidateSemesterCache();
    res.json({ ok: true, deleted: existing.name, removedFromPlanners: planner.count });
  }));

  /* ---------- 匯入課程查詢系統 Excel ---------- */
  // body: { fileBase64, filename, semester?（不填就用檔案裡的學期）, dryRun? }
  router.post("/courses/import", wrap(async (req, res) => {
    const { fileBase64, filename = "", dryRun = false } = req.body || {};
    if (!fileBase64) return fail(res, 400, "請選擇要匯入的 Excel 檔");

    let buffer;
    try {
      buffer = Buffer.from(String(fileBase64).replace(/^data:[^,]*,/, ""), "base64");
    } catch {
      return fail(res, 400, "檔案內容讀取失敗");
    }
    if (buffer.length === 0) return fail(res, 400, "檔案是空的");

    let parsed;
    try {
      parsed = parseCourseWorkbook(buffer);
    } catch (e) {
      return fail(res, 400, e.message);
    }

    const semester = String(req.body?.semester || parsed.detectedSemester || "").trim();
    if (!/^\d{4}$/.test(semester)) {
      return fail(res, 400, "看不出這個檔案是哪個學期，請手動選擇學期");
    }

    const { courses, stats } = buildCourses(semester, parsed.rows, parsed.IDX);
    if (courses.length === 0) return fail(res, 400, "檔案裡沒有可以匯入的課程");

    const existingCount = await prisma.course.count({ where: { semester } });
    const preview = {
      filename, semester, detectedSemester: parsed.detectedSemester, existingCount, ...stats,
      sample: courses.slice(0, 5).map(c => ({ code: c.code, name: c.name, teacher: c.teacher, credits: c.credits, type: c.type })),
    };
    if (dryRun) return res.json({ ok: true, dryRun: true, preview });

    const result = await replaceSemesterCourses(prisma, semester, courses);
    invalidateSemesterCache();
    res.json({ ok: true, preview, result });
  }));

  /* ---------- 帳號管理 ---------- */
  router.get("/users", wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const q = String(req.query.q || "").trim();
    const role = String(req.query.role || "").trim();

    const where = {};
    if (q) where.OR = [{ email: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }];
    if (role === "admin" || role === "student") where.role = role;

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: USER_PUBLIC }),
    ]);

    // 每個人課表裡有幾門課
    const counts = users.length
      ? await prisma.planner.groupBy({ by: ["userId"], where: { userId: { in: users.map(u => u.id) } }, _count: { _all: true } })
      : [];
    const countOf = new Map(counts.map(c => [c.userId, c._count._all]));
    const items = users.map(u => ({ ...u, plannerCount: countOf.get(u.id) || 0, isMe: u.id === req.userId }));

    res.json({ ok: true, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items });
  }));

  router.post("/users", wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim();
    const username = String(req.body?.username || "").trim() || email;
    const password = String(req.body?.password || "");
    const role = req.body?.role === "admin" ? "admin" : "student";
    if (!email) return fail(res, 400, "請輸入帳號（學號）");
    if (password.length < 6) return fail(res, 400, "密碼至少要 6 個字");

    const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) return fail(res, 409, "這個帳號已經存在");

    const item = await prisma.user.create({
      data: { email, username, role, passwordHash: await bcrypt.hash(password, 10) },
      select: USER_PUBLIC,
    });
    res.status(201).json({ ok: true, item });
  }));

  router.put("/users/:id", wrap(async (req, res) => {
    const id = req.params.id;
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!user) return fail(res, 404, "找不到這個帳號");

    const data = {};
    if (req.body?.email !== undefined) {
      const email = String(req.body.email).trim();
      if (!email) return fail(res, 400, "帳號（學號）不能空白");
      if (email !== user.email) {
        const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (exists) return fail(res, 409, "這個帳號已經存在");
      }
      data.email = email;
    }
    if (req.body?.username !== undefined) data.username = String(req.body.username).trim() || null;
    if (req.body?.role !== undefined) {
      const role = req.body.role === "admin" ? "admin" : "student";
      if (id === req.userId && role !== "admin") return fail(res, 400, "不能取消自己的管理者權限");
      data.role = role;
    }

    const item = await prisma.user.update({ where: { id }, data, select: USER_PUBLIC });
    res.json({ ok: true, item });
  }));

  router.put("/users/:id/password", wrap(async (req, res) => {
    const id = req.params.id;
    const password = String(req.body?.password || "");
    if (password.length < 6) return fail(res, 400, "密碼至少要 6 個字");
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) return fail(res, 404, "找不到這個帳號");

    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
      prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  }));

  router.delete("/users/:id", wrap(async (req, res) => {
    const id = req.params.id;
    if (id === req.userId) return fail(res, 400, "不能刪除自己的帳號");
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) return fail(res, 404, "找不到這個帳號");

    await prisma.$transaction([
      prisma.planner.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),   // 登入憑證、PlannerItem 會跟著刪除（onDelete: Cascade）
    ]);
    res.json({ ok: true, deleted: user.email });
  }));

  // 管理者 API 的錯誤統一回中文訊息
  router.use((err, req, res, next) => {
    console.error("[admin] ERROR", err);
    if (err?.type === "entity.too.large") return fail(res, 413, "檔案太大了");
    return fail(res, 500, "伺服器發生錯誤，請稍後再試");
  });

  return router;
}

/* =========================================================
   個人帳號 API（學生、管理者都能用）
========================================================= */
export function createAccountRouter({ prisma, bcrypt }) {
  const router = express.Router();

  router.get("/me", requireAuth, wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: USER_PUBLIC });
    if (!user) return fail(res, 401, "帳號不存在，請重新登入", { code: "ACCESS_INVALID" });
    res.json({ ok: true, user });
  }));

  router.put("/password", requireAuth, wrap(async (req, res) => {
    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!oldPassword) return fail(res, 400, "請輸入目前的密碼");
    if (newPassword.length < 6) return fail(res, 400, "新密碼至少要 6 個字");
    if (newPassword === oldPassword) return fail(res, 400, "新密碼不能跟目前的密碼一樣");

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, passwordHash: true } });
    if (!user) return fail(res, 401, "帳號不存在，請重新登入", { code: "ACCESS_INVALID" });
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) return fail(res, 400, "目前的密碼不正確");

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  }));

  router.use((err, req, res, next) => {
    console.error("[account] ERROR", err);
    return fail(res, 500, "伺服器發生錯誤，請稍後再試");
  });

  return router;
}

/* =========================================================
   啟動時：確保 User 有 role 欄位，並建立預設管理者
   （雲端資料庫不用另外手動跑 migration）
   環境變數 ADMIN_EMAIL、ADMIN_PASSWORD 都有設定時：
     - 帳號不存在 → 建立管理者帳號
     - 帳號已存在 → 設成管理者（不會改密碼）
========================================================= */
export async function ensureAdminSetup({ prisma, bcrypt }) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'student'`);

  const email = String(process.env.ADMIN_EMAIL || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) {
    console.log("[admin] 沒有設定 ADMIN_EMAIL / ADMIN_PASSWORD，略過建立預設管理者");
    return;
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) {
    await prisma.user.create({
      data: { email, username: "課程管理者", role: "admin", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`[admin] 已建立預設管理者帳號 ${email}`);
  } else if (user.role !== "admin") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
    console.log(`[admin] 已將 ${email} 設為管理者`);
  }
}
