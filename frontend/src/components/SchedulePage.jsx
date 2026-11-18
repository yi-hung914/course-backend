// 我的擬排課表：週課表、衝堂標示、儲存、匯出 PDF
import React, { useRef, useState } from "react";
import { useApp } from "../AppContext.jsx";
import { courseTypeLabel, formatCourseTime, overlapText, semesterLabel, totalCredits } from "../lib/course.js";

const DAYS = [1, 2, 3, 4, 5];
const DAY_HEAD = ["週一", "週二", "週三", "週四", "週五"];
// 節次與時間
const PERIODS = [
  ["01", "08:10", "09:00"], ["02", "09:10", "10:00"], ["03", "10:10", "11:00"], ["04", "11:10", "12:00"],
  ["05", "12:40", "13:30"], ["06", "13:40", "14:30"], ["07", "14:40", "15:30"], ["08", "15:40", "16:30"],
  ["09", "16:40", "17:30"], ["10", "17:40", "18:30"], ["11", "18:35", "19:25"], ["12", "19:30", "20:20"],
  ["13", "20:25", "21:15"], ["14", "21:20", "22:10"],
];

const pad2 = n => String(n).padStart(2, "0");
const esc = str => String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export default function SchedulePage() {
  const { selected, semesters, semester, changeSemester, removeCourse, clearSchedule, saveSchedule, user } = useApp();
  const tableRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  // 每一格（星期 × 節次）有哪些課；同一格兩門以上 = 衝堂
  const cells = {};
  for (const c of selected) {
    for (const t of c.time) {
      for (const s of t.session) (cells[`${t.day}-${s}`] ||= []).push(c);
    }
  }
  const hasConflict = Object.values(cells).some(list => list.length > 1);

  function checkAllConflicts() {
    if (selected.length < 2) { alert("課表裡至少要有兩門課才會有衝堂"); return; }
    const pairs = [];
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const text = overlapText(selected[i], selected[j]);
        if (text) pairs.push(`• ${selected[i].name} ↔ ${selected[j].name}（${text}）`);
      }
    }
    if (pairs.length === 0) alert("✅ 沒有衝堂，課表時間都沒有重疊！");
    else alert(`發現 ${pairs.length} 組衝堂：\n\n${pairs.join("\n")}\n\n衝堂的課已在課表中標成紅色。`);
  }

  // 另外組一份「列印用」的版面（標題、學號、課表、已選課程清單），網頁上的課表不會被改動
  function buildExportElement() {
    const now = new Date();
    const credits = totalCredits(selected);
    const wrap = document.createElement("div");
    wrap.style.cssText = "width:100%;box-sizing:border-box;padding:16px 20px;background:#fff;color:#333;font-family:'PingFang TC','Microsoft JhengHei',sans-serif;";
    wrap.innerHTML = `
      <h2 style="color:#007d66;margin:0 0 6px;font-size:22px;">NTUNHS 擬排課表${semester ? "｜" + semesterLabel(semester) : ""}</h2>
      <div style="font-size:13px;color:#555;margin-bottom:12px;">
        ${user ? `學號：${esc(user)}　` : ""}
        共 ${selected.length} 門課、${credits} 學分
        匯出時間：${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}
      </div>`;

    // 1) 複製網頁上的課表
    const table = tableRef.current.cloneNode(true);
    table.removeAttribute("id");
    table.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;";
    table.querySelectorAll("th, td").forEach(td => { td.style.padding = "3px"; });
    table.querySelectorAll(".schedule-cell").forEach(cell => {
      cell.style.minHeight = "0";
      cell.style.height = "auto";
      cell.querySelectorAll(".course-in-schedule").forEach(el => {
        el.style.cursor = "default"; el.style.padding = "3px"; el.style.fontSize = "10px";
      });
    });
    wrap.appendChild(table);
    if (table.querySelector(".conflict-highlight")) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:11px;color:#d32f2f;margin-top:4px;";
      note.textContent = "※ 紅色標示的課程有時間衝突";
      wrap.appendChild(note);
    }

    // 2) 已選課程清單（課表格子只放得下代碼和名稱，這裡列完整資訊）
    const rows = selected.map(c => `
      <tr>
        <td>${esc(c.code || "")}</td><td style="text-align:left;">${esc(c.name || "")}</td><td>${Number(c.credit) || 0}</td>
        <td>${esc(courseTypeLabel(c))}</td><td>${esc(c.teacher || "")}</td><td>${esc(formatCourseTime(c.time))}</td><td>${esc(c.location || "")}</td>
      </tr>`).join("");
    const list = document.createElement("div");
    list.style.cssText = "margin-top:16px;page-break-inside:avoid;";
    list.innerHTML = `
      <h3 style="color:#007d66;margin:0 0 6px;font-size:16px;">已選課程清單</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr>
          <th style="width:16%;">課程代碼</th><th>課程名稱</th><th style="width:6%;">學分</th>
          <th style="width:7%;">類型</th><th style="width:11%;">教師</th><th style="width:18%;">上課時間</th><th style="width:12%;">地點</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:right;font-weight:bold;">總學分</td><td style="font-weight:bold;">${credits}</td><td colspan="4"></td></tr></tfoot>
      </table>`;
    list.querySelectorAll("th, td").forEach(td => { td.style.padding = "4px"; });
    wrap.appendChild(list);
    return wrap;
  }

  async function exportPdf() {
    if (selected.length === 0) { alert("課表是空的，請先加入課程再匯出"); return; }
    if (typeof window.html2pdf === "undefined") {
      alert("PDF 元件載入失敗，請確認網路連線後重新整理頁面。\n也可以先用瀏覽器的列印（Cmd + P）→「儲存為 PDF」。");
      return;
    }
    setExporting(true);
    try {
      const now = new Date();
      const dateText = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
      const filename = `擬排課表_${semester ? semester + "_" : ""}${user ? user.replace(/[^\w.@-]/g, "_") + "_" : ""}${dateText}.pdf`;
      await window.html2pdf().set({
        margin: [8, 8, 8, 8],   // 單位 mm
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"], avoid: ["tr"] },
      }).from(buildExportElement()).save();
    } catch (e) {
      console.error("匯出 PDF 失敗:", e);
      alert(`匯出 PDF 失敗：${e.message || e}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card">
      <h2>我的擬排課表{" "}
        {/* 學期下拉選單：跟課程搜尋的「學年學期」同步，可以直接切換看各學期的課表 */}
        {semester && semesters?.length > 0 && (
          <select className="schedule-sem-select" title="切換要看的學期課表" value={semester} onChange={e => changeSemester(e.target.value)}>
            {semesters.map(it => <option key={it.semester} value={it.semester}>{semesterLabel(it.semester)}</option>)}
          </select>
        )}
      </h2>

      <div className="conflict-warning" style={{ display: hasConflict ? "block" : "none" }}>
        ⚠️ 發現時間衝突！請檢查課表中的重疊課程。
      </div>

      {/* 手機上課表可左右滑動 */}
      <div className="swipe-hint">← 左右滑動查看整週課表 →</div>
      <div className="schedule-scroll">
        <table id="schedule-table" ref={tableRef}>
          <thead>
            <tr>
              <th className="time-col">節次 / 時間</th>
              {DAY_HEAD.map(d => <th key={d}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map(([no, from, to], i) => (
              <tr key={no}>
                <td className="time-col">{no} <span className="tm">({from}~<span className="tm2">{to})</span></span></td>
                {DAYS.map(day => {
                  const list = cells[`${day}-${i + 1}`] || [];
                  return (
                    <td key={day} className="schedule-cell" data-day={day} data-session={i + 1}>
                      {list.map(c => (
                        <div key={c.id} className={`course-in-schedule ${list.length > 1 ? "conflict-highlight" : ""}`}
                          title={`${c.name} - ${c.teacher} - ${c.location}（點一下可移除）`} onClick={() => removeCourse(c.id)}>
                          <strong>{c.code}</strong><br />{c.name}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="button-group">
        <button onClick={clearSchedule} style={{ backgroundColor: "#ff6b6b", color: "white" }}>清空課表</button>{" "}
        <button onClick={() => saveSchedule()} style={{ backgroundColor: "#007d66", color: "white" }}>儲存課表</button>{" "}
        <button onClick={checkAllConflicts} className="check-conflict-btn">檢查衝堂</button>{" "}
        <button disabled={exporting} onClick={exportPdf} style={{ backgroundColor: "#3b6fb6", color: "white" }}>
          {exporting ? "PDF 產生中..." : "匯出 PDF"}
        </button>
      </div>

      <div className="hint-message">
        💡 提示：點擊課表中的課程可以移除（會先詢問），按「匯出 PDF」可下載課表，使用「檢查衝堂」功能確保課表無時間衝突
      </div>
    </div>
  );
}
