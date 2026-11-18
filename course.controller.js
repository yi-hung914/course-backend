// course.controller.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 【新增】學期設定
//   COURSE_DATA_SEMESTER：課程資料實際從哪個學期讀（所有學期都顯示這一份）
//   FIRST_SEMESTER：學期選單從哪個學期開始
const COURSE_DATA_SEMESTER = String(process.env.COURSE_DATA_SEMESTER || "1101").trim();
const FIRST_SEMESTER = "1101";

// 【新增】哪些學期資料庫裡真的有課（管理者匯入或新增課程後會更新）
//   學生選的學期「有自己的課程資料」→ 顯示該學期的課
//   沒有資料 → 跟原本一樣，顯示 COURSE_DATA_SEMESTER（110-1）那一份
let semesterCache = { at: 0, counts: new Map() };
export function invalidateSemesterCache() {
  semesterCache = { at: 0, counts: new Map() };
}
async function semesterCounts() {
  if (Date.now() - semesterCache.at < 60 * 1000) return semesterCache.counts;
  const groups = await prisma.course.groupBy({ by: ["semester"], _count: { _all: true } });
  semesterCache = { at: Date.now(), counts: new Map(groups.map(g => [g.semester, g._count._all])) };
  return semesterCache.counts;
}
async function resolveSemester(requested) {
  const sem = String(requested || "").trim();
  const counts = await semesterCounts();
  return sem && counts.get(sem) ? sem : COURSE_DATA_SEMESTER;
}

// 依今天日期算出目前學期（民國學年度）
//   8 月～隔年 1 月 = 第 1 學期；2 月～7 月 = 第 2 學期
//   例：2026 年 11 月 → 115 學年度第 1 學期 → "1151"
function currentSemester(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  if (m >= 8) return `${y - 1911}1`;
  if (m === 1) return `${y - 1912}1`;
  return `${y - 1912}2`;
}

// 產生從 from 到 to 的學期清單（新的在前）：["1151", "1142", "1141", ..., "1101"]
function semesterRange(from, to) {
  const list = [];
  let year = Number(from.slice(0, 3)), term = Number(from.slice(3));
  const endYear = Number(to.slice(0, 3)), endTerm = Number(to.slice(3));
  while (year < endYear || (year === endYear && term <= endTerm)) {
    list.push(`${year}${term}`);
    if (term === 1) term = 2; else { term = 1; year++; }
  }
  return list.reverse();
}

/**
 * 共用：dept 條件
 * 例：dept=22140,33140 → 只找 department 剛好是 22140 或 33140 的課程
 *
 * 【修改】原本用前三碼比對（22140 → "221"），會把同系不同學制的課混在一起，
 *   例如選二技護理系(11120) 會連四技(11140)、碩士班(1116x)、博士班(11170) 都抓進來。
 *   系所代碼第 4 碼代表學制，所以改成精確比對整個代碼。
 */
async function buildDeptWhere(req) {
  const deptRaw = String(req.query.dept || "").trim();
  const deptList = deptRaw
    ? deptRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const where = {};
  if (deptList.length > 0) {
    where.department = { in: deptList };
  }

  // 【新增】必修/選修、年級篩選也交給後端，分頁才會正確（每頁固定筆數、不會出現空頁）
  //   required=true  → 只要必修；required=false → 只要選修；不帶 → 不篩
  //   grade=1,2      → 一年級或二年級
  const requiredRaw = String(req.query.required ?? "").trim().toLowerCase();
  if (requiredRaw === "true") where.required = true;
  else if (requiredRaw === "false") where.required = false;

  const gradeList = String(req.query.grade ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
  if (gradeList.length > 0) {
    where.grade = { in: gradeList };
  }

  // 【新增】category=general → 只要通識課（Course.type 由 scripts/backfill_course_type.js 依 Excel「課別名稱」填入）
  //   可以跟 required 一起用：category=general&required=true → 通識必修
  const category = String(req.query.category ?? "").trim().toLowerCase();
  if (category === "general") {
    where.type = "general";
  }

  // 【新增】kind=課程類別（可複選，同組是「或」），四種互不重疊：
  //   core = 必修（專業）、elective = 選修（專業）、gen-core = 通識必修、gen-elective = 通識選修
  //   例：kind=core,elective → 所有專業課；kind=core,gen-core → 所有必修課
  const KIND_WHERE = {
    "core":         { required: true,  type: { not: "general" } },
    "elective":     { required: false, type: { not: "general" } },
    "gen-core":     { required: true,  type: "general" },
    "gen-elective": { required: false, type: "general" },
  };
  const kinds = [...new Set(String(req.query.kind ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(k => KIND_WHERE[k]))];
  if (kinds.length > 0 && kinds.length < 4) {
    where.AND = [...(where.AND || []), { OR: kinds.map(k => KIND_WHERE[k]) }];
  }

  // 【修改】學期：沒有自己課程資料的學期，都顯示「課程資料來源學期」（預設 1101 = 110-1）
  //   管理者匯入某學期的課程後，選那個學期就會顯示它自己的課
  //   要換預設資料來源，在 .env 加上 COURSE_DATA_SEMESTER=學期代碼（例如 1141）再重啟後端
  where.semester = await resolveSemester(req.query.semester);

  // 【新增】day=1,3 → 週一或週三「有上課」的課（只要有任一個上課時間在這幾天就算）
  const dayList = String(req.query.day ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  // 【新增】slot=morning,afternoon,evening → 上午（第 1～4 節）、下午（第 5～9 節）、晚上（第 10～14 節）開始上課
  //   跟 day 一起用時，要「同一個上課時間」同時符合，例如 day=3&slot=afternoon = 週三下午有上課
  const SLOT_RANGE = { morning: [1, 4], afternoon: [5, 9], evening: [10, 14] };
  const slotList = [...new Set(String(req.query.slot ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => SLOT_RANGE[s]))];

  const scheduleWhere = {};
  if (dayList.length > 0) scheduleWhere.day = { in: dayList };
  if (slotList.length > 0) {
    scheduleWhere.OR = slotList.map(s => ({ start: { gte: SLOT_RANGE[s][0], lte: SLOT_RANGE[s][1] } }));
  }
  if (Object.keys(scheduleWhere).length > 0) {
    where.sections = { some: { schedules: { some: scheduleWhere } } };
  }

  // 【新增】noday=5 → 這幾天「完全沒有課」的課（智慧助理：「週五不想上課」）
  const noDayList = String(req.query.noday ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  if (noDayList.length > 0) {
    where.AND = [...(where.AND || []), {
      sections: { every: { schedules: { none: { day: { in: noDayList } } } } },
    }];
  }

  // 【新增】credits=2,3 → 2 學分或 3 學分的課（智慧助理用）
  const creditList = String(req.query.credits ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 20);
  if (creditList.length > 0) {
    where.credits = { in: creditList };
  }

  return { where, deptRaw, deptList };
}

/**
 * GET /api/courses
 */
export async function listCourses(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50)));

    const { where, deptRaw, deptList } = await buildDeptWhere(req);

    console.log("[listCourses]", { page, pageSize, deptRaw, deptList });

    const [total, items] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],   // 【修改】加上 id 當第二排序，避免同一時間建立的課在換頁時重複或漏掉
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sections: { include: { schedules: true } },
        },
      }),
    ]);

    res.json({
      ok: true,
      __apiVersion: "listCourses_2026-02-21",
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    });
  } catch (e) {
    console.error("[listCourses] ERROR", e);
    res.status(500).json({ ok: false, message: e?.message || "SERVER_ERROR" });
  }
}

/**
 * GET /api/courses/search
 */
export async function searchCourses(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50)));

    const { where: deptWhere, deptRaw, deptList } = await buildDeptWhere(req);

    const textWhere = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { teacher: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

    const where = { ...deptWhere };
    if (q) {
      if (where.OR) {
        where.AND = [{ OR: where.OR }, textWhere];
        delete where.OR;
      } else {
        Object.assign(where, textWhere);
      }
    }

    console.log("[searchCourses]", { q, page, pageSize, deptRaw, deptList });

    const [total, items] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],   // 【修改】加上 id 當第二排序，避免同一時間建立的課在換頁時重複或漏掉
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sections: { include: { schedules: true } },
        },
      }),
    ]);

    res.json({
      ok: true,
      __apiVersion: "searchCourses_2026-02-21",
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    });
  } catch (e) {
    console.error("[searchCourses] ERROR", e);
    res.status(500).json({ ok: false, message: e?.message || "SERVER_ERROR" });
  }
}

/**
 * GET /api/courses/:id
 */
export async function getCourseDetail(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ ok: false, message: "MISSING_ID" });
    }

    const item = await prisma.course.findUnique({
      where: { id },
      include: {
        sections: { include: { schedules: true } },
      },
    });

    if (!item) {
      return res.status(404).json({ ok: false, message: "NOT_FOUND" });
    }

    res.json({ ok: true, item });
  } catch (e) {
    console.error("[getCourseDetail] ERROR", e);
    res.status(500).json({ ok: false, message: e?.message || "SERVER_ERROR" });
  }
}
/**
 * GET /api/courses/:id/schedules
 * 只回傳課程的 sections + schedules（給前端表格 / 時段用）
 */
export async function getCourseSchedules(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "MISSING_ID",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        sections: {
          select: {
            id: true,
            teacher: true,
            schedules: {
              orderBy: [{ day: "asc" }, { start: "asc" }],
            },
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        ok: false,
        message: "NOT_FOUND",
      });
    }

    res.json({
      ok: true,
      courseId: course.id,
      name: course.name,
      code: course.code,
      sections: course.sections,
    });
  } catch (e) {
    console.error("[getCourseSchedules] ERROR =", e);
    res.status(500).json({
      ok: false,
      message: e?.message || "SERVER_ERROR",
    });
  }
}
/**
 * GET /api/courses/semesters
 * 【修改】學期清單改成自動產生：從 110-1 到「今天所在的學期」（新的在前），
 *   有自己課程資料的學期顯示自己的課程數，其他學期顯示 COURSE_DATA_SEMESTER 那一份。
 * 例：{ ok: true, current: "1151", items: [{ semester: "1151", year: 115, term: 1, count: 1194 }, ...] }
 */
export async function listSemesters(req, res) {
  try {
    const counts = await semesterCounts();
    const fallbackCount = counts.get(COURSE_DATA_SEMESTER) || 0;
    const current = currentSemester();
    // 管理者提早匯入下學期的課，選單也要列得出來
    const newest = [current, ...counts.keys()].filter(s => /^\d{4}$/.test(s)).sort().pop();
    const items = semesterRange(FIRST_SEMESTER, newest).map(sem => ({
      semester: sem,
      year: Number(sem.slice(0, 3)),
      term: Number(sem.slice(3)),
      count: counts.get(sem) || fallbackCount,
      hasOwnData: counts.has(sem),
    }));
    res.json({ ok: true, current, dataSemester: COURSE_DATA_SEMESTER, items });
  } catch (e) {
    console.error("[listSemesters] ERROR", e);
    res.status(500).json({ ok: false, message: e?.message || "SERVER_ERROR" });
  }
}
