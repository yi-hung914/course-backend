/**
 * 快速檢查 1141 學期資料檔的欄位標題。
 * 用於驗證匯入格式是否正確。
 */
import path from "path";
import xlsx from "xlsx";

const filePath = path.resolve("data", "raw", "1141", "課程查詢_1141.xls");
const wb = xlsx.readFile(filePath);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];

const rows = xlsx.utils.sheet_to_json(ws, { defval: "" });
console.log("sheet =", sheetName);
console.log("rows =", rows.length);
console.log("firstRowKeys =", rows[0] ? Object.keys(rows[0]) : []);
