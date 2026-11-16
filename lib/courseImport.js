/**
 * 【新增】課程查詢系統 Excel 匯入（管理者後台用）
 *
 * 讀「課程查詢系統」匯出的 .xls / .xlsx（表頭第一欄是「編號」），整理成
 *   課程 Course → 開課班別 Section → 上課時間 Schedule
 * 再整批寫進資料庫。規則跟 scripts/importSemesters.js 一樣：
 *   - 欄位用表頭文字找，不寫死欄位編號
 *   - 課別名稱有「通識」→ type = general；必修 → core；其他 → elective
 *   - 節次不連續（例如 1,2,3,4,6,7,8,9）會拆成兩段時間（1-4、6-9）
 */
import crypto from "crypto";
import xlsx from "xlsx";

function cell(row, i) {
  if (i < 0) return "";
  const v = row?.[i];
  return v === undefined || v === null ? "" : String(v).trim();
}

// "1,2,3,4,6,7,8,9" → [{start:1,end:4},{start:6,end:9}]；也支援 "3-4"、"3~4"
export function parsePeriodRanges(periodStr) {
  const s = String(periodStr ?? "").trim();
  if (!s) return [];
  const normalized = s.replace(/[~–—]/g, "-").replace(/，/g, ",");

  let nums = [];
  for (const part of normalized.split(/[,\s]+/).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let n = Math.min(a, b); n <= Math.max(a, b); n++) nums.push(n);
      }
    } else if (Number.isFinite(Number(part))) {
      nums.push(Number(part));
    }
  }
  nums = [...new Set(nums)].sort((a, b) => a - b);

  const ranges = [];
  for (const n of nums) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges;
}

const REQUIRED_COLUMNS = {
  subjectCode: "科目代碼(新碼全碼)",
  deptCode: "系所代碼",
  grade: "年級",
  classGroup: "上課班組",
  nameZh: "科目中文名稱",
  teacher: "授課教師姓名",
  quota: "上課人數",
  credits: "學分數",
  reqName: "課別名稱",
  location: "上課地點",
  day: "上課星期",
  period: "上課節次",
};

/**
 * 讀 Excel（Buffer）→ { rows, IDX, detectedSemester }
 * 格式不對會丟出中文錯誤訊息
 */
export function parseCourseWorkbook(buffer) {
  let wb;
  try {
    wb = xlsx.read(buffer, { type: "buffer" });
  } catch {
    throw new Error("檔案無法讀取，請確認是課程查詢系統匯出的 Excel 檔（.xls 或 .xlsx）");
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Excel 裡沒有工作表");

  const table = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRowIndex = table.findIndex(r => cell(r, 0) === "編號");
  if (headerRowIndex === -1) {
    throw new Error("找不到表頭列（第一欄應該是「編號」），請確認是課程查詢系統匯出的檔案");
  }

  const header = table[headerRowIndex].map(v => String(v).trim());
  const IDX = {};
  const missing = [];
  for (const [key, name] of Object.entries(REQUIRED_COLUMNS)) {
    IDX[key] = header.indexOf(name);
    if (IDX[key] === -1) missing.push(name);
  }
  if (missing.length) throw new Error(`Excel 缺少欄位：${missing.join("、")}`);
  IDX.semester = header.indexOf("學期");

  const rows = table.slice(headerRowIndex + 1);

  // 學期：優先用「學期」欄位最多的值，其次用標題（例如「1101 全校修課資料表」）
  let detectedSemester = null;
  if (IDX.semester !== -1) {
    const count = new Map();
    for (const r of rows) {
      const s = cell(r, IDX.semester);
      if (/^\d{4}$/.test(s)) count.set(s, (count.get(s) || 0) + 1);
    }
    detectedSemester = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  if (!detectedSemester) {
    for (const r of table.slice(0, headerRowIndex)) {
      const m = cell(r, 0).match(/(\d{4})/);
      if (m) { detectedSemester = m[1]; break; }
    }
  }

  return { rows, IDX, detectedSemester };
}

// 把 Excel 一列一列整理成「課程 → 班別 → 上課時間」的結構
export function buildCourses(semester, rows, IDX) {
  const courses = new Map();   // 科目代碼 → course
  let skipped = 0;

  for (const r of rows) {
    const code = cell(r, IDX.subjectCode);
    const name = cell(r, IDX.nameZh);
    const sectionCode = cell(r, IDX.classGroup);
    const day = Number(cell(r, IDX.day) || 0);
    const ranges = parsePeriodRanges(cell(r, IDX.period));
    if (!code || !name || !sectionCode || !day || ranges.length === 0) { skipped++; continue; }

    let course = courses.get(code);
    if (!course) {
      const reqName = cell(r, IDX.reqName);
      const required = reqName.includes("必修") ? true : reqName.includes("選修") ? false : null;
      const g = Number(cell(r, IDX.grade));
      const credits = Number(cell(r, IDX.credits) || 0);
      course = {
        code,
        name,
        teacher: cell(r, IDX.teacher),
        credits: Number.isFinite(credits) ? Math.round(credits) : 0,
        required,
        type: reqName.includes("通識") ? "general" : required === true ? "core" : "elective",
        department: cell(r, IDX.deptCode) || null,
        grade: Number.isFinite(g) && g > 0 ? g : null,
        semester,
        sections: new Map(),
      };
      courses.set(code, course);
    }

    const location = cell(r, IDX.location) || null;
    let section = course.sections.get(sectionCode);
    if (!section) {
      const quota = Number(cell(r, IDX.quota) || 0);
      section = { code: sectionCode, quota: Number.isFinite(quota) ? Math.round(quota) : 0, location, schedules: new Map() };
      course.sections.set(sectionCode, section);
    } else if (!section.location && location) {
      section.location = location;
    }

    for (const { start, end } of ranges) {
      const key = `${day}-${start}-${end}-${location || ""}`;
      if (!section.schedules.has(key)) section.schedules.set(key, { day, start, end, location });
    }
  }

  const list = [...courses.values()];
  const stats = {
    courses: list.length,
    sections: list.reduce((n, c) => n + c.sections.size, 0),
    schedules: list.reduce((n, c) => n + [...c.sections.values()].reduce((m, s) => m + s.schedules.size, 0), 0),
    general: list.filter(c => c.type === "general").length,
    skipped,
  };
  return { courses: list, stats };
}

/**
 * 用匯入的課程「取代」某個學期的全部課程（一個交易內完成，失敗會整個還原）
 *   - 學生已儲存課表裡的課，會依「課號」對應到新匯入的課，課表不會因為重新匯入而消失
 *   - 用 createMany 整批寫入，一千多門課幾秒內完成
 */
export async function replaceSemesterCourses(prisma, semester, courses) {
  return prisma.$transaction(async (tx) => {
    const oldCourses = await tx.course.findMany({ where: { semester }, select: { id: true, code: true } });
    const oldIds = oldCourses.map(c => c.id);
    const codeOfOld = new Map(oldCourses.map(c => [c.id, c.code]));

    // 先記下學生課表裡有哪些「這個學期的課」
    const oldPlanners = oldIds.length
      ? await tx.planner.findMany({ where: { courseId: { in: oldIds } }, select: { userId: true, courseId: true } })
      : [];

    if (oldIds.length) {
      await tx.planner.deleteMany({ where: { courseId: { in: oldIds } } });
      await tx.plannerItem.deleteMany({ where: { section: { courseId: { in: oldIds } } } });
      await tx.schedule.deleteMany({ where: { section: { courseId: { in: oldIds } } } });
      await tx.section.deleteMany({ where: { courseId: { in: oldIds } } });
      await tx.course.deleteMany({ where: { id: { in: oldIds } } });
    }

    const courseRows = [], sectionRows = [], scheduleRows = [];
    const newIdByCode = new Map();
    for (const c of courses) {
      const courseId = crypto.randomUUID();
      newIdByCode.set(c.code, courseId);
      courseRows.push({
        id: courseId, code: c.code, name: c.name, teacher: c.teacher, credits: c.credits,
        required: c.required, type: c.type, department: c.department, grade: c.grade, semester,
      });
      for (const s of c.sections.values()) {
        const sectionId = crypto.randomUUID();
        sectionRows.push({ id: sectionId, courseId, code: s.code, quota: s.quota, location: s.location });
        for (const t of s.schedules.values()) {
          scheduleRows.push({ id: crypto.randomUUID(), sectionId, day: t.day, start: t.start, end: t.end, location: t.location });
        }
      }
    }

    const CHUNK = 2000;
    for (let i = 0; i < courseRows.length; i += CHUNK) await tx.course.createMany({ data: courseRows.slice(i, i + CHUNK) });
    for (let i = 0; i < sectionRows.length; i += CHUNK) await tx.section.createMany({ data: sectionRows.slice(i, i + CHUNK) });
    for (let i = 0; i < scheduleRows.length; i += CHUNK) await tx.schedule.createMany({ data: scheduleRows.slice(i, i + CHUNK) });

    // 學生課表：用課號對回新的課程
    const plannerRows = [];
    const seen = new Set();
    for (const p of oldPlanners) {
      const newId = newIdByCode.get(codeOfOld.get(p.courseId));
      const key = `${p.userId}|${newId}`;
      if (newId && !seen.has(key)) { seen.add(key); plannerRows.push({ userId: p.userId, courseId: newId }); }
    }
    if (plannerRows.length) await tx.planner.createMany({ data: plannerRows, skipDuplicates: true });

    return {
      deletedCourses: oldIds.length,
      keptPlannerItems: plannerRows.length,
      lostPlannerItems: oldPlanners.length - plannerRows.length,
    };
  }, { timeout: 120000, maxWait: 20000 });
}
