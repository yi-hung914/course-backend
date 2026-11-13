/**
 * 補上課程的「通識 / 專業」分類（只更新 Course.type，不刪資料、不重新匯入）
 *
 * 依據 Excel 的「課別名稱」欄位：
 *   專業必修(系所) → type = "core"
 *   專業選修(系所) → type = "elective"
 *   通識必修(通識) → type = "general"
 *   通識選修(通識) → type = "general"
 * （必修 / 選修本來就存在 Course.required，這支不會動它）
 *
 * 用法（在 course-backend 資料夾執行）：
 *   node scripts/backfill_course_type.js          ← 預設讀 1141 學期
 *   node scripts/backfill_course_type.js 1132     ← 指定學期
 */
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function cell(row, i) {
  const v = row?.[i];
  return v === undefined || v === null ? "" : String(v).trim();
}

function typeFromReqName(reqName) {
  if (reqName.includes("通識")) return "general";
  if (reqName.includes("必修")) return "core";
  if (reqName.includes("選修")) return "elective";
  return null;
}

async function main() {
  const semester = process.argv[2] || "1141";
  const filePath = path.resolve("data", "raw", semester, `課程查詢_${semester}.xls`);
  if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}（請在 course-backend 資料夾執行）`);

  const wb = xlsx.readFile(filePath);
  const table = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });

  const headerRowIndex = table.findIndex(r => cell(r, 0) === "編號");
  if (headerRowIndex === -1) throw new Error("找不到表頭列（第一欄不是『編號』）");

  // 用表頭文字找欄位，比寫死欄位編號安全
  const header = table[headerRowIndex].map(v => String(v).trim());
  const codeIdx = header.indexOf("科目代碼(新碼全碼)");
  const reqIdx = header.indexOf("課別名稱");
  if (codeIdx === -1 || reqIdx === -1) throw new Error("Excel 裡找不到「科目代碼(新碼全碼)」或「課別名稱」欄位");

  // 科目代碼 → 分類（同一門課每一列的課別都一樣，取第一個）
  const codesByType = { core: new Set(), elective: new Set(), general: new Set() };
  const seen = new Set();
  let unknown = 0;
  for (const r of table.slice(headerRowIndex + 1)) {
    const code = cell(r, codeIdx);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const type = typeFromReqName(cell(r, reqIdx));
    if (type) codesByType[type].add(code);
    else unknown++;
  }

  // 依分類批次更新（只會更新資料庫裡有的課程）
  const result = {};
  for (const [type, codes] of Object.entries(codesByType)) {
    const r = await prisma.course.updateMany({
      where: { code: { in: [...codes] }, semester },   // 只更新這個學期的課（不同學期可能有相同課號）
      data: { type },
    });
    result[type] = r.count;
  }

  console.log(`✅ ${semester} 學期課程分類完成`);
  console.log(`專業必修: ${result.core}  專業選修: ${result.elective}  通識: ${result.general}`);
  if (unknown) console.log(`（有 ${unknown} 門課的課別名稱無法判斷，維持原本的分類）`);
}

main()
  .catch(e => {
    console.error("❌ 失敗：", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
