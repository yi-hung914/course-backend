/**
 * 將原始課程資料寫入 rawCourse 暫存表。
 * 作為資料清洗與 migrate 前的第一步。
 */
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(k) {
  return String(k || "").trim();
}

/**
 * 用「包含字」找欄位（避免全形括號/空白差異）
 */
function pickKey(obj, contains) {
  const keys = Object.keys(obj);
  return keys.find((k) => k && String(k).includes(contains));
}

/**
 * 將節次字串轉成 range 陣列
 * 支援：
 * - "1-3" / "1~3"
 * - "1,2,3" / "1、2、3" / "1 2 3"
 * - "第1節" / "1節"
 */
function parsePeriodsToRanges(periodStr) {
  if (!periodStr) return [];

  let s = String(periodStr).trim();
  if (!s) return [];

  // 把一些常見字去掉
  s = s
    .replace(/第/g, "")
    .replace(/節/g, "")
    .replace(/　/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 先用分隔符切（逗號/頓號/空白/分號）
  const parts = s.split(/[,\s、;；]+/).filter(Boolean);

  const nums = new Set();
  const ranges = [];

  for (const p0 of parts) {
    const p = String(p0).trim();
    if (!p) continue;

    // range: 1-3 或 1~3
    const m = p.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        ranges.push({ start, end });
        continue;
      }
    }

    // 單一數字
    const n = Number(p);
    if (Number.isFinite(n)) nums.add(n);
  }

  // 把離散節次合併成 range
  if (nums.size > 0) {
    const arr = Array.from(nums).sort((a, b) => a - b);
    let start = arr[0];
    let prev = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const cur = arr[i];
      if (cur === prev + 1) {
        prev = cur;
      } else {
        ranges.push({ start, end: prev });
        start = cur;
        prev = cur;
      }
    }
    ranges.push({ start, end: prev });
  }

  // 去重 & 排序
  const uniq = new Map();
  for (const r of ranges) {
    if (!r || !r.start || !r.end) continue;
    const key = `${r.start}-${r.end}`;
    uniq.set(key, r);
  }
  return Array.from(uniq.values()).sort((a, b) => a.start - b.start);
}

/**
 * 把「上課星期」轉成 1~7（如果 Excel 用文字：一/二/三... 也處理）
 */
function normalizeDay(v) {
  if (v === null || v === undefined || v === "") return null;
  const raw = String(v).trim();

  // 直接數字
  const n = Number(raw);
  if (Number.isFinite(n)) return n;

  // 文字星期
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  // 可能是 "星期一" / "週一"
  const m = raw.match(/(一|二|三|四|五|六|日|天)/);
  if (m && map[m[1]]) return map[m[1]];

  return null;
}

/**
 * 依 raw row 抽出課程資訊（名稱/老師/學分）
 * 你 Excel 欄位可能不同，這裡用「包含字」盡量相容。
 */
function extractCourseMeta(rawRow) {
  const kName =
    pickKey(rawRow, "科目中文名稱") ||
    pickKey(rawRow, "課程名稱") ||
    pickKey(rawRow, "科目名稱");

  const kTeacher =
    pickKey(rawRow, "授課教師") ||
    pickKey(rawRow, "教師") ||
    pickKey(rawRow, "任課老師");

  const kCredits =
    pickKey(rawRow, "學分") ||
    pickKey(rawRow, "學分數");

  const name = String((kName ? rawRow[kName] : "") || "").trim() || "未命名";
  const teacher = String((kTeacher ? rawRow[kTeacher] : "") || "").trim() || "未提供";
  const credits = (() => {
    const v = kCredits ? rawRow[kCredits] : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  })();

  return { name, teacher, credits };
}

/**
 * 把 RawCourse(同一科目代碼) 彙整成 Course -> Section -> Schedule
 *
 * ⚠️ 重要假設：
 * - 你的 Prisma schema 至少有：
 *   course: { id, name, teacher, credits }
 *   section: { id, courseId, code, rawCourseId? }
 *   schedule: { id, sectionId, day, start, end }
 * - RawCourse 有：semester, subjectCode, classGroup, dayOfWeek, periods, location, raw(JSON)
 */
async function buildCourseSectionScheduleFromRaw(semester) {
  const raws = await prisma.rawCourse.findMany({
    where: { semester },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[transform] rawCourses found for ${semester}:`, raws.length);
  if (raws.length === 0) return;

  // 以 subjectCode 做群組（同科目代碼視為同一門課）
  const bySubject = new Map();
  for (const r of raws) {
    if (!r.subjectCode) continue;
    if (!bySubject.has(r.subjectCode)) bySubject.set(r.subjectCode, []);
    bySubject.get(r.subjectCode).push(r);
  }

  let courseCreated = 0;
  let sectionCreated = 0;
  let scheduleCreated = 0;

  // cache：避免重複查 DB
  const courseCache = new Map();   // key: subjectCode -> course
  const sectionCache = new Map();  // key: courseId|sectionCode -> section

  for (const [subjectCode, list] of bySubject.entries()) {
    // 用第一筆 raw 的 raw(JSON) 抽出 name/teacher/credits
    const meta = extractCourseMeta(list[0].raw || {});
    const courseKey = subjectCode;

    // 1) 找/建 Course（用 name+teacher+credits 粗略去重）
    let course = courseCache.get(courseKey);
    if (!course) {
      course = await prisma.course.findFirst({
        where: {
          name: meta.name,
          teacher: meta.teacher,
          credits: meta.credits,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!course) {
        course = await prisma.course.create({
          data: {
            name: meta.name,
            teacher: meta.teacher,
            credits: meta.credits,
          },
        });
        courseCreated++;
      }
      courseCache.set(courseKey, course);
    }

    // 2) 依 classGroup 建 Section（同一 subjectCode 可能有不同班別）
    //   如果 classGroup 沒資料，就統一用 "A"
    const byGroup = new Map();
    for (const r of list) {
      const code = (r.classGroup && String(r.classGroup).trim()) ? String(r.classGroup).trim() : "A";
      if (!byGroup.has(code)) byGroup.set(code, []);
      byGroup.get(code).push(r);
    }

    for (const [secCode, secRaws] of byGroup.entries()) {
      const secKey = `${course.id}|${secCode}`;
      let section = sectionCache.get(secKey);

      if (!section) {
        section = await prisma.section.findFirst({
          where: { courseId: course.id, code: secCode },
          orderBy: { createdAt: "desc" },
        });

        if (!section) {
          // 用該 group 的第一筆 raw 當作 rawCourseId（可追溯）
          section = await prisma.section.create({
            data: {
              courseId: course.id,
              code: secCode,
              rawCourseId: secRaws[0].id,
              // quota 若你 raw 沒有，就不填
            },
          });
          sectionCreated++;
        }

        sectionCache.set(secKey, section);
      }

      // 3) 建 Schedule：day/start/end（從 raw 的 dayOfWeek + periods 解析）
      for (const rr of secRaws) {
        const day = normalizeDay(rr.dayOfWeek);
        const ranges = parsePeriodsToRanges(rr.periods);

        if (!day || ranges.length === 0) continue;

        for (const rg of ranges) {
          // 去重：同 section/day/start/end 不要重複建
          const exists = await prisma.schedule.findFirst({
            where: {
              sectionId: section.id,
              day,
              start: rg.start,
              end: rg.end,
            },
          });

const loc = String(row["上課地點"] || "").trim() || null;

if (!exists) {
  await prisma.schedule.create({
    data: {
      sectionId: section.id,
      day,
      start: rg.start,
      end: rg.end,
      location: loc,
    },
  });
  scheduleCreated++;
} else if (loc) {
  // ✅ 已存在就補 location（只在有值時更新）
  await prisma.schedule.update({
    where: { id: exists.id },
    data: { location: loc },
  });
  scheduleUpdated++;
}

        }
      }
    }
  }

  console.log(
    `[transform] done. courseCreated=${courseCreated}, sectionCreated=${sectionCreated}, scheduleCreated=${scheduleCreated}`
  );
}

async function main() {
  const semesterArg = process.argv[2]; // 例如 1141
  if (!semesterArg) {
    console.error("Usage: node scripts/importRawCourses.js 1141");
    process.exit(1);
  }

  const filePath = path.join(
    __dirname,
    "..",
    "data",
    "raw",
    semesterArg,
    `課程查詢_${semesterArg}.xls`
  );

  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const wb = xlsx.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  // 先讀成「二維陣列」
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // 找到真正表頭列：必須同時包含幾個關鍵欄位
  const mustHave = ["學期", "科目代碼", "科目中文名稱", "上課星期", "上課節次"];
  let headerRowIndex = -1;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map((x) => String(x).trim());
    const ok = mustHave.every((kw) => row.some((cell) => cell.includes(kw)));
    if (ok) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error("找不到表頭列（header row）。");
    console.log("前 20 列預覽：");
    console.log(matrix.slice(0, 20));
    process.exit(1);
  }

  const headers = matrix[headerRowIndex].map(normalizeKey);
  console.log("Detected header row index:", headerRowIndex);
  console.log("Headers sample:", headers.slice(0, 15));

  // 由表頭下一列開始，轉成物件陣列 rows
  const rows = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const arr = matrix[i];
    if (!arr || arr.every((v) => String(v).trim() === "")) continue;

    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = arr[c];
    }
    rows.push(obj);
  }

  console.log(`Loaded rows: ${rows.length} from ${filePath}`);

  let inserted = 0;
  let skipped = 0;
  const batchSize = 200;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const data = batch
      .map((r) => {
        const kSemester = pickKey(r, "學期");

        // ✅ 修正：你原本這行寫錯了
        // const kSubject = pickKey(r, "科目代碼") && pickKey(r, "新碼");
        // 正確做法：優先「科目代碼」，沒有就找「新碼」
        const kSubject = pickKey(r, "科目代碼(新碼全碼)") || pickKey(r, "科目代碼") || pickKey(r, "新碼");


        const kClassGroup = pickKey(r, "上課班組");
        const kDay = pickKey(r, "上課星期");
        const kPeriods = pickKey(r, "上課節次");
        const kLocation = pickKey(r, "上課地點");

        const semester = String((kSemester ? r[kSemester] : semesterArg) || semesterArg).trim();
        const subjectCode = String((kSubject ? r[kSubject] : "") || "").trim();
        const classGroup = String((kClassGroup ? r[kClassGroup] : "") || "").trim() || null;
        const dayOfWeek = toIntOrNull(kDay ? r[kDay] : null); // 你excel是4/5這種數字
        const periods = String((kPeriods ? r[kPeriods] : "") || "").trim() || null;
        const location = String((kLocation ? r[kLocation] : "") || "").trim() || null;

        return {
          semester,
          subjectCode,
          classGroup,
          dayOfWeek,
          periods,
          location,
          raw: r,
        };
      })
      .filter((d) => d.subjectCode); // 沒科目代碼的列丟掉

    const result = await prisma.rawCourse.createMany({
      data,
      skipDuplicates: true,
    });

    inserted += result.count;
    skipped += data.length - result.count;
    console.log(`Batch ${i / batchSize + 1}: +${result.count}, skipped ${data.length - result.count}`);
  }

  console.log(`RawCourse done. inserted=${inserted}, skipped=${skipped}`);
  await transformRawToCourseSectionSchedule(semesterArg);


  // ✅ 新增：把 RawCourse 轉成 Course/Section/Schedule（你要的星期幾+第幾節就在 Schedule）
  await buildCourseSectionScheduleFromRaw(semesterArg);

  console.log("ALL DONE.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
function parsePeriodsToRanges(periodStr) {
  if (!periodStr) return [];
  const s = String(periodStr).trim().replace(/第|節/g, "");
  const parts = s.split(/[,\s、;；]+/).filter(Boolean);
  const ranges = [];

  for (const p of parts) {
    const m = p.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      ranges.push({ start: Math.min(a, b), end: Math.max(a, b) });
    } else {
      const n = Number(p);
      if (Number.isFinite(n)) ranges.push({ start: n, end: n });
    }
  }

  // 合併連續節次（6,7 => 6-7）
  ranges.sort((a,b)=>a.start-b.start);
  const merged = [];
  for (const r of ranges) {
    if (merged.length === 0) merged.push({ ...r });
    else {
      const last = merged[merged.length - 1];
      if (r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
  }
  return merged;
}

async function transformRawToCourseSectionSchedule(semester) {
  const raws = await prisma.rawCourse.findMany({ where: { semester } });

  console.log("[transform] raws:", raws.length);
  if (raws.length === 0) return;

  // 依 subjectCode 分組
  const bySubject = new Map();
  for (const r of raws) {
    if (!r.subjectCode) continue;
    if (!bySubject.has(r.subjectCode)) bySubject.set(r.subjectCode, []);
    bySubject.get(r.subjectCode).push(r);
  }

  for (const [subjectCode, list] of bySubject.entries()) {
    // 從 raw(JSON) 抽 name/teacher/credits
    const raw0 = list[0].raw || {};
    const name = String(raw0["科目中文名稱"] || raw0["課程名稱"] || "").trim() || subjectCode;
    const teacher = String(raw0["授課教師姓名"] || raw0["教師"] || "").trim() || "未提供";
    const credits = Number(raw0["學分數"]);
    const creditNum = Number.isFinite(credits) ? credits : 0;

    // 建/找 Course（簡單去重）
    let course = await prisma.course.findFirst({
      where: { name, teacher, credits: creditNum },
      orderBy: { createdAt: "desc" },
    });
    if (!course) {
      course = await prisma.course.create({ data: { name, teacher, credits: creditNum } });
    }

    // 依上課班組分 Section（沒有就 A）
    const byGroup = new Map();
    for (const r of list) {
      const code = (r.classGroup && String(r.classGroup).trim()) ? String(r.classGroup).trim() : "A";
      if (!byGroup.has(code)) byGroup.set(code, []);
      byGroup.get(code).push(r);
    }

    for (const [secCode, secRaws] of byGroup.entries()) {
      let section = await prisma.section.findFirst({
        where: { courseId: course.id, code: secCode },
        orderBy: { createdAt: "desc" },
      });
      if (!section) {
        section = await prisma.section.create({
          data: { courseId: course.id, code: secCode, rawCourseId: secRaws[0].id },
        });
      }

      // 建 Schedule（day/start/end）
      for (const rr of secRaws) {
        const day = rr.dayOfWeek;          // 你excel是4
        const ranges = parsePeriodsToRanges(rr.periods); // "6,7" => [{start:6,end:7}]
        if (!day || ranges.length === 0) continue;

        for (const rg of ranges) {
          const exists = await prisma.schedule.findFirst({
            where: { sectionId: section.id, day, start: rg.start, end: rg.end },
          });
          if (!exists) {
            await prisma.schedule.create({
              data: { sectionId: section.id, day, start: rg.start, end: rg.end },
            });
          }
        }
      }
    }
  }

  console.log("[transform] done.");
}
