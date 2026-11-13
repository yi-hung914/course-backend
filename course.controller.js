// course.controller.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 【新增】學期設定
//   COURSE_DATA_SEMESTER：課程資料實際從哪個學期讀（所有學期都顯示這一份）
//   FIRST_SEMESTER：學期選單從哪個學期開始
const COURSE_DATA_SEMESTER = String(process.env.COURSE_DATA_SEMESTER || "1101").trim();
const FIRST_SEMESTER = "1101";

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
function buildDeptWhere(req) {
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

  // 【修改】學期：不管前端選哪個學期，課程都固定讀「課程資料來源學期」（預設 1101 = 110-1）
  //   需求：每個學期顯示的課程都跟 110-1 一樣
  //   要換資料來源，在 .env 加上 COURSE_DATA_SEMESTER=學期代碼（例如 1141）再重啟後端
  where.semester = COURSE_DATA_SEMESTER;

  // 【新增】day=1,3 → 週一或週三「有上課」的課（只要有任一個上課時間在這幾天就算）
  const dayList = String(req.query.day ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  if (dayList.length > 0) {
    where.sections = { some: { schedules: { some: { day: { in: dayList } } } } };
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

    const { where, deptRaw, deptList } = buildDeptWhere(req);

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

    const { where: deptWhere, deptRaw, deptList } = buildDeptWhere(req);

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
 *   每個學期的課程都是同一份（COURSE_DATA_SEMESTER），所以課程數都一樣。
 * 例：{ ok: true, current: "1151", items: [{ semester: "1151", year: 115, term: 1, count: 1194 }, ...] }
 */
export async function listSemesters(req, res) {
  try {
    const count = await prisma.course.count({ where: { semester: COURSE_DATA_SEMESTER } });
    const current = currentSemester();
    const items = semesterRange(FIRST_SEMESTER, current).map(sem => ({
      semester: sem,
      year: Number(sem.slice(0, 3)),
      term: Number(sem.slice(3)),
      count,
    }));
    res.json({ ok: true, current, dataSemester: COURSE_DATA_SEMESTER, items });
  } catch (e) {
    console.error("[listSemesters] ERROR", e);
    res.status(500).json({ ok: false, message: e?.message || "SERVER_ERROR" });
  }
}
