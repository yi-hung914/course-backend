/**
 * 從 1141 學期的 Excel 索引檔讀取課程資料並匯入系統。
 * 將檔案資料轉換為 rawCourse 或中間格式。
 */
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 上課節次解析：支援 3-4 / 3~4 / 3,4 / 3 4 / 3
function parsePeriods(periodStr) {
  const s = String(periodStr ?? "").trim();
  if (!s) return null;

  const normalized = s
    .replace(/~/g, "-")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.includes("-")) {
    const [a, b] = normalized.split("-").map(x => Number(String(x).trim()));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  const nums = normalized.split(" ").map(x => Number(x)).filter(Number.isFinite);
  if (nums.length === 0) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

// 把 0/1/2... 轉成字串（避免 undefined）
function cell(row, i) {
  const v = row?.[i];
  return v === undefined || v === null ? "" : String(v).trim();
}

async function main() {
  const semester = "1141";
  const filePath = path.resolve("data", "raw", semester, "課程查詢_1141.xls");
  if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}`);

  const wb = xlsx.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // 直接把整張表轉成「二維陣列」
  const table = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!table.length) throw new Error("Excel 是空的");

  // 找到真正的表頭列（那一列第一格會是「編號」）
  const headerRowIndex = table.findIndex(r => cell(r, 0) === "編號");
  if (headerRowIndex === -1) {
    throw new Error("找不到表頭列（第一欄不是『編號』）。請確認檔案內容。");
  }

  // 從表頭下一列開始才是資料
  const dataRows = table.slice(headerRowIndex + 1);

  // 你給的欄位順序，對應索引（0-based）
  const IDX = {
    no: 0,                 // 編號
    term: 1,               // 學期
    mainTeacher: 2,        // 主開課教師姓名
    subjectCode: 3,        // 科目代碼(新碼全碼)
    deptCode: 4,           // 系所代碼
    core4: 5,              // 核心四碼
    group: 6,              // 科目組別
    grade: 7,              // 年級
    classGroup: 8,         // 上課班組
    nameZh: 9,             // 科目中文名稱
    nameEn: 10,            // 科目英文名稱
    teacher: 11,           // 授課教師姓名
    quota: 12,             // 上課人數
    male: 13,              // 男學生上課人數
    female: 14,            // 女學生上課人數
    credits: 15,           // 學分數
    weeks: 16,             // 上課週次
    hoursPerWeek: 17,      // 上課時數/週
    reqCode: 18,           // 課別代碼
    reqName: 19,           // 課別名稱
    location: 20,          // 上課地點
    day: 21,               // 上課星期
    period: 22,            // 上課節次
    note: 23,              // 課表備註
    summaryZh: 24,         // 課程中文摘要
    summaryEn: 25,         // 課程英文摘要
    oldMainTeacherCode: 26,
    oldSubjectCode: 27,
    oldTableCode: 28,
    oldTableName: 29,
    oldTeacherCode: 30
  };

  // 【修改】原本會清空「整個資料庫」的課程，現在資料庫可以放多個學期，
  //   改成只刪除 1141 這個學期的課程（以及存在課表裡的這些課），其他學期不受影響
  //   ※ 建議改用 scripts/importSemesters.js 1141，功能一樣而且會處理不連續節次
  const oldCourseIds = (await prisma.course.findMany({ where: { semester }, select: { id: true } })).map(c => c.id);
  if (oldCourseIds.length > 0) {
    await prisma.$transaction([
      prisma.planner.deleteMany({ where: { courseId: { in: oldCourseIds } } }),
      prisma.schedule.deleteMany({ where: { section: { courseId: { in: oldCourseIds } } } }),
      prisma.plannerItem.deleteMany({ where: { section: { courseId: { in: oldCourseIds } } } }),
      prisma.section.deleteMany({ where: { courseId: { in: oldCourseIds } } }),
      prisma.course.deleteMany({ where: { id: { in: oldCourseIds } } }),
    ]);
  }

  const courseMap = new Map();   // subjectCode -> courseId
  const sectionMap = new Map();  // subjectCode::classGroup -> sectionId
  const scheduleSeen = new Set();

  let createdCourses = 0, createdSections = 0, createdSchedules = 0, skipped = 0;

  for (const r of dataRows) {
    const subjectCode = cell(r, IDX.subjectCode);
    const courseName = cell(r, IDX.nameZh);
    const teacher = cell(r, IDX.teacher);
    const credits = Number(cell(r, IDX.credits) || 0);

    const department = cell(r, IDX.deptCode) || null;
    const grade = (() => {
      const g = Number(cell(r, IDX.grade));
      return Number.isFinite(g) ? g : null;
    })();

    const sectionCode = cell(r, IDX.classGroup);
    const quota = Number(cell(r, IDX.quota) || 0);

    const location = cell(r, IDX.location) || null;

    const day = Number(cell(r, IDX.day) || 0);
    const pe = parsePeriods(cell(r, IDX.period));

    if (!subjectCode || !courseName || !sectionCode || !day || !pe) {
      skipped++;
      continue;
    }

    // required：用課別名稱猜（必修=true, 選修=false）
    const reqName = cell(r, IDX.reqName);
    const required =
      reqName.includes("必修") ? true :
      reqName.includes("選修") ? false :
      null;

    // 【新增】分類：課別名稱有「通識」→ general；否則依必修/選修 → core / elective
    //   例：通識必修(通識)、通識選修(通識) → general；專業必修(系所) → core；專業選修(系所) → elective
    const courseType =
      reqName.includes("通識") ? "general" :
      required === true ? "core" : "elective";

    // 1) Course（你的 schema: code 是 unique，所以用 subjectCode）
    let courseId = courseMap.get(subjectCode);
    if (!courseId) {
      const course = await prisma.course.create({
        data: {
          code: subjectCode,
          name: courseName,
          teacher: teacher || "",
          credits: Number.isFinite(credits) ? credits : 0,
          required,
          department,
          grade,
          type: courseType,   // 【新增】
          semester,           // 【新增】學期
        },
      });
      courseId = course.id;
      courseMap.set(subjectCode, courseId);
      createdCourses++;
    }

    // 2) Section（同一課號 + 班組）
    const sectionKey = `${subjectCode}::${sectionCode}`;
    let sectionId = sectionMap.get(sectionKey);
    if (!sectionId) {
      const sec = await prisma.section.create({
        data: {
          courseId,
          code: sectionCode,
          quota: Number.isFinite(quota) ? quota : 0,
          // 你有 Section.location：先放第一個看到的地點當摘要
          location,
          rawCourseId: null,
        },
      });
      sectionId = sec.id;
      sectionMap.set(sectionKey, sectionId);
      createdSections++;
    } else {
      // 如果已存在但 location 還空，而這列有 location，就補上
      if (location) {
        const sec = await prisma.section.findUnique({ where: { id: sectionId } });
        if (sec && !sec.location) {
          await prisma.section.update({ where: { id: sectionId }, data: { location } });
        }
      }
    }

    // 3) Schedule（去重）
    const schedKey = `${sectionId}::${day}::${pe.start}-${pe.end}::${location || ""}`;
    if (!scheduleSeen.has(schedKey)) {
      await prisma.schedule.create({
        data: {
          sectionId,
          day,
          start: pe.start,
          end: pe.end,
          location,
        },
      });
      scheduleSeen.add(schedKey);
      createdSchedules++;
    }
  }

  console.log("✅ 1141 匯入完成");
  console.log("Courses:", createdCourses, "Sections:", createdSections, "Schedules:", createdSchedules);
  console.log("Skipped rows (缺欄位/格式不合法):", skipped);
}

main()
  .catch((e) => {
    console.error("❌ 匯入失敗：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
