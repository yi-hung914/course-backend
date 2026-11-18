// ===== 課程相關的共用小工具（沒有畫面，純計算） =====
import { DEPT_MAP } from "../data/departments.js";

function pickLocation(obj) {
  return (
    obj?.location || obj?.place || obj?.room || obj?.classroom || obj?.classRoom ||
    obj?.classroomName || obj?.loc || obj?.locName || obj?.["上課地點"] || ""
  );
}

// 後端回傳的課程 → 前端統一格式
//   time：[{ day: 1, session: [3, 4] }, ...]（每段上課時間的星期和節次）
export function normalizeCourseFromApi(c) {
  const sections = Array.isArray(c.sections) ? c.sections : [];
  const time = [];
  for (const sec of sections) {
    for (const s of Array.isArray(sec.schedules) ? sec.schedules : []) {
      const day = Number(s.day), start = Number(s.start), end = Number(s.end);
      if (!day || !start || !end) continue;
      const sessions = [];
      for (let k = start; k <= end; k++) sessions.push(k);
      time.push({ day, session: sessions });
    }
  }

  let foundLoc = "";
  for (const sec of sections) {
    const secLoc = (pickLocation(sec) || "").trim();
    if (secLoc) { foundLoc = secLoc; break; }
    for (const s of Array.isArray(sec.schedules) ? sec.schedules : []) {
      const schLoc = (pickLocation(s) || "").trim();
      if (schLoc) { foundLoc = schLoc; break; }
    }
    if (foundLoc) break;
  }

  const deptCode = String(c.department ?? "");
  return {
    id: c.id || c._id,
    code: c.code || c.id,
    name: c.name || "未命名課程",
    credit: Number(c.credits ?? c.credit ?? 0),
    teacher: c.teacher || "未提供",
    deptCode,
    dept: DEPT_MAP[deptCode] || deptCode || "未分類",
    location: foundLoc || (pickLocation(c) || "").trim() || "",
    desc: c.desc || "",
    type: c.required === true ? "core" : "elective",
    grade: String(c.grade ?? "1"),
    category: c.type === "general" ? "general" : (c.category || "major"),   // 後端 type=general = 通識課
    time,
    sections,
    semester: c.semester || "",   // 開課學期
  };
}

const DAY_NAMES = ["", "週一", "週二", "週三", "週四", "週五", "週六", "週日"];

// 例：「週二 第2,3,4節; 週四 第5,6節」
export function formatCourseTime(timeArray) {
  return (timeArray || []).map(t => {
    const sessions = Array.isArray(t.session) ? t.session.join(",") : t.session;
    return `${DAY_NAMES[t.day] || ""} 第${sessions}節`;
  }).join("; ");
}

// 完整類型文字，例如「通識必修」「專業選修」
export function courseTypeLabel(course) {
  const req = course.type === "core" ? "必修" : course.type === "elective" ? "選修" : "";
  return (course.category === "general" ? "通識" : "專業") + req;
}

// "1141" → "114 學年度 第 1 學期"
export function semesterLabel(sem) {
  const s = String(sem || "");
  return /^\d{4}$/.test(s) ? `${s.slice(0, 3)} 學年度 第 ${s.slice(3)} 學期` : s;
}

// 兩門課有沒有時間重疊
export function coursesOverlap(a, b) {
  return a.time.some(x => b.time.some(y => x.day === y.day && x.session.some(s => y.session.includes(s))));
}

// 新的課跟已選課程有沒有衝堂
export function hasTimeConflict(course, selected) {
  return selected.some(s => coursesOverlap(course, s));
}

// 兩門課重疊在哪些時間，例：「週二 第3,4節」
export function overlapText(a, b) {
  const parts = [];
  for (const x of a.time) {
    for (const y of b.time) {
      if (x.day !== y.day) continue;
      const both = x.session.filter(s => y.session.includes(s));
      if (both.length) parts.push(`${DAY_NAMES[x.day] || "週" + x.day} 第${both.join(",")}節`);
    }
  }
  return parts.join("、");
}

// 課表內容的指紋（判斷有沒有沒存的變更）
export function scheduleKey(list) {
  return list.map(c => c.id).sort().join(",");
}

export const totalCredits = list => list.reduce((sum, c) => sum + (Number(c.credit) || 0), 0);
