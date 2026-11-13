/**
 * 匯入多個學期的課程（data/raw/<學期>/課程查詢_<學期>.xls）
 *
 * 用法（在 course-backend 資料夾執行）：
 *   node scripts/importSemesters.js
 *       → 匯入 data/raw 底下所有「資料庫還沒有」的學期（已經有的學期會跳過，不會動到）
 *   node scripts/importSemesters.js 1132 1131
 *       → 只處理指定學期；如果資料庫已經有這個學期，會先刪掉該學期的課程再重新匯入
 *         （注意：該學期被存進課表的課程會一起被移除）
 *
 * 跟 import1141FromXlsIndex.js 的差別：
 *   - 只會刪除「要匯入的那個學期」的資料，不會清空整個資料庫
 *   - 欄位用表頭文字找，不寫死欄位編號
 *   - 課別名稱有「通識」→ type = general（通識課篩選用）
 *   - 節次不連續（例如 1,2,3,4,6,7,8,9）會拆成兩段時間（1-4、6-9），不會把中午第 5 節也算進去
 */
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RAW_DIR = path.resolve("data", "raw");

function cell(row, i) {
  if (i < 0) return "";
  const v = row?.[i];
  return v === undefined || v === null ? "" : String(v).trim();
}

// "1,2,3,4,6,7,8,9" → [{start:1,end:4},{start:6,end:9}]；也支援 "3-4"、"3~4"
function parsePeriodRanges(periodStr) {
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

function readSemesterRows(semester) {
  const filePath = path.join(RAW_DIR, semester, `課程查詢_${semester}.xls`);
  if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}`);

  const wb = xlsx.readFile(filePath);
  const table = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const headerRowIndex = table.findIndex(r => cell(r, 0) === "編號");
  if (headerRowIndex === -1) throw new Error(`${semester}：找不到表頭列（第一欄不是『編號』）`);

  const header = table[headerRowIndex].map(v => String(v).trim());
  const col = (name) => header.indexOf(name);
  const IDX = {
    subjectCode: col("科目代碼(新碼全碼)"),
    deptCode: col("系所代碼"),
    grade: col("年級"),
    classGroup: col("上課班組"),
    nameZh: col("科目中文名稱"),
    teacher: col("授課教師姓名"),
    quota: col("上課人數"),
    credits: col("學分數"),
    reqName: col("課別名稱"),
    location: col("上課地點"),
    day: col("上課星期"),
    period: col("上課節次"),
  };
  for (const [k, v] of Object.entries(IDX)) {
    if (v === -1) throw new Error(`${semester}：Excel 找不到欄位 ${k}`);
  }
  return { rows: table.slice(headerRowIndex + 1), IDX };
}

// 把 Excel 一列一列整理成「課程 → 班別 → 上課時間」的結構
function buildCourses(semester, rows, IDX) {
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
        credits: Number.isFinite(credits) ? credits : 0,
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
      section = { code: sectionCode, quota: Number.isFinite(quota) ? quota : 0, location, schedules: new Map() };
      course.sections.set(sectionCode, section);
    } else if (!section.location && location) {
      section.location = location;
    }

    for (const { start, end } of ranges) {
      const key = `${day}-${start}-${end}-${location || ""}`;
      if (!section.schedules.has(key)) section.schedules.set(key, { day, start, end, location });
    }
  }
  return { courses: [...courses.values()], skipped };
}

// 只刪除某個學期的課程（連同班別、上課時間、存在課表裡的這些課）
async function deleteSemester(semester) {
  const courseIds = (await prisma.course.findMany({ where: { semester }, select: { id: true } })).map(c => c.id);
  if (courseIds.length === 0) return 0;
  await prisma.$transaction([
    prisma.planner.deleteMany({ where: { courseId: { in: courseIds } } }),
    prisma.schedule.deleteMany({ where: { section: { courseId: { in: courseIds } } } }),
    prisma.plannerItem.deleteMany({ where: { section: { courseId: { in: courseIds } } } }),
    prisma.section.deleteMany({ where: { courseId: { in: courseIds } } }),
    prisma.course.deleteMany({ where: { id: { in: courseIds } } }),
  ]);
  return courseIds.length;
}

async function importSemester(semester) {
  const { rows, IDX } = readSemesterRows(semester);
  const { courses, skipped } = buildCourses(semester, rows, IDX);

  let sections = 0, schedules = 0;
  for (const [i, c] of courses.entries()) {
    await prisma.course.create({
      data: {
        code: c.code, name: c.name, teacher: c.teacher, credits: c.credits,
        required: c.required, type: c.type, department: c.department, grade: c.grade, semester: c.semester,
        sections: {
          create: [...c.sections.values()].map(s => {
            sections++;
            schedules += s.schedules.size;
            return {
              code: s.code, quota: s.quota, location: s.location,
              schedules: { create: [...s.schedules.values()] },
            };
          }),
        },
      },
    });
    if ((i + 1) % 500 === 0) console.log(`  ${semester}：已匯入 ${i + 1} / ${courses.length} 門課...`);
  }
  console.log(`✅ ${semester} 匯入完成　課程 ${courses.length}　班別 ${sections}　上課時間 ${schedules}　略過 ${skipped} 列`);
}

async function main() {
  const args = process.argv.slice(2);
  const available = fs.existsSync(RAW_DIR)
    ? fs.readdirSync(RAW_DIR).filter(d => /^\d{4}$/.test(d)).sort()
    : [];
  if (available.length === 0) throw new Error(`找不到 ${RAW_DIR}（請在 course-backend 資料夾執行）`);

  const existing = new Set(
    (await prisma.course.groupBy({ by: ["semester"] })).map(g => g.semester)
  );

  let targets;
  if (args.length > 0) {
    targets = args;   // 指定學期：已存在的會先刪掉再匯入
  } else {
    targets = available.filter(s => !existing.has(s));
    const skippedExisting = available.filter(s => existing.has(s));
    if (skippedExisting.length) console.log(`已經有資料、這次跳過的學期：${skippedExisting.join("、")}`);
  }

  if (targets.length === 0) {
    console.log("沒有需要匯入的學期。");
    return;
  }

  console.log(`準備匯入：${targets.join("、")}`);
  for (const semester of targets) {
    try {
      if (existing.has(semester)) {
        const n = await deleteSemester(semester);
        console.log(`  ${semester}：先刪除原本的 ${n} 門課`);
      }
      await importSemester(semester);
    } catch (e) {
      console.error(`❌ ${semester} 匯入失敗：${e.message || e}`);
      console.error(`   可以修正後再執行：node scripts/importSemesters.js ${semester}`);
    }
  }
}

main()
  .catch(e => {
    console.error("❌ 失敗：", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
