// 2. 搜尋課程：學期、關鍵字／智慧助理切換、篩選、課程列表、分頁
import React, { useEffect, useRef } from "react";
import { useApp } from "../AppContext.jsx";
import { semesterLabel } from "../lib/course.js";
import { AS_EXAMPLES } from "../lib/assistant.js";
import CourseCard from "./CourseCard.jsx";
import SmartResult from "./SmartResult.jsx";

// 篩選按鈕：同一組是「或」，組和組之間是「而且」
const TYPE_CHIPS = [
  { f: "core", label: "專業必修" }, { f: "elective", label: "專業選修" },
  { f: "gen-core", label: "通識必修" }, { f: "gen-elective", label: "通識選修" },
];
const GRADE_CHIPS = [{ f: "1", label: "一年級" }, { f: "2", label: "二年級" }, { f: "3", label: "三年級" }, { f: "4", label: "四年級" }];
const DAY_CHIPS = ["一", "二", "三", "四", "五"].map((d, i) => ({ f: `day-${i + 1}`, label: `週${d}` }));
const PERIOD_CHIPS = Array.from({ length: 14 }, (_, i) => ({ f: `period-${i + 1}`, label: `第 ${i + 1} 節` }));

export default function CourseSearch() {
  const app = useApp();
  const { semesters, semester, changeSemester, searchMode, setSearchMode, term, setTerm, applySearch, showAll,
          runSmart, favoritesMode, filters, clickFilter } = app;
  const smart = searchMode === "smart";
  const inputRef = useRef(null);
  const timer = useRef(null);
  const composing = useRef(false);   // 注音／中文輸入法選字中，先不要查

  // 進入智慧助理時，游標放進輸入框
  useEffect(() => { if (smart) inputRef.current?.focus(); }, [smart]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // 邊打字邊搜尋：停 0.3 秒才送出；智慧助理則要按 Enter 才送出
  function trigger(text, delay = 300) {
    clearTimeout(timer.current);
    if (smart) { if (delay === 0) runSmart(text); return; }
    timer.current = setTimeout(() => applySearch(text), delay);
  }

  // 這個篩選按鈕是不是亮的
  const noFilter = !favoritesMode && !filters.types.length && !filters.grades.length && !filters.days.length && !filters.periods.length;
  function isOn(f) {
    if (f === "all") return noFilter;
    if (f === "fav") return favoritesMode;
    if (favoritesMode) return false;   // 看收藏時，其他篩選暫時不作用
    if (f.startsWith("period-")) return filters.periods.includes(f.slice(7));
    if (f.startsWith("day-")) return filters.days.includes(f.slice(4));
    if (/^\d$/.test(f)) return filters.grades.includes(f);
    return filters.types.includes(f);
  }
  const chip = ({ f, label, className = "" }) => (
    <div key={f} className={`filter-item ${className} ${isOn(f) ? "active" : ""}`} onClick={() => clickFilter(f)}>{label}</div>
  );

  return (
    <div className="card">
      <h2>2. 搜尋課程</h2>

      {/* 學年學期：選項由後端 /api/courses/semesters 產生 */}
      <div className="semester-bar">
        <label className="select-label" htmlFor="semester-select">學年學期</label>
        <select id="semester-select" className="select-box" value={semester} onChange={e => changeSemester(e.target.value)}>
          {semesters === null && <option value="">載入中...</option>}
          {semesters?.length === 0 && <option value="">全部學期</option>}
          {semesters?.map(it => (
            <option key={it.semester} value={it.semester}>{semesterLabel(it.semester)}（{it.count} 門課）</option>
          ))}
        </select>
      </div>

      {/* 切換：關鍵字搜尋／智慧助理 */}
      <div className="search-mode">
        <button className={`mode-btn ${!smart ? "active" : ""}`} onClick={() => { clearTimeout(timer.current); setSearchMode("keyword"); }}>🔍 關鍵字搜尋</button>
        <button className={`mode-btn ${smart ? "active" : ""}`} onClick={() => { clearTimeout(timer.current); setSearchMode("smart"); }}>✨ 智慧助理</button>
      </div>
      <div className={`search-container ${smart ? "smart" : ""}`} id="search-container">
        <input ref={inputRef} type="text" id="course-search" className="search-box" autoComplete="off"
          placeholder={smart ? "用一句話描述，例如：我是資管系三年級，想加強程式能力" : "輸入課程名稱、代碼或教師，會自動搜尋..."}
          value={term}
          onChange={e => { setTerm(e.target.value); if (!composing.current) trigger(e.target.value); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={e => { composing.current = false; trigger(e.currentTarget.value); }}
          onKeyDown={e => {
            if (e.key === "Enter" && !composing.current && !e.nativeEvent.isComposing) { e.preventDefault(); trigger(term, 0); }
          }} />
        <button className="search-btn" onClick={() => { clearTimeout(timer.current); smart ? runSmart() : applySearch(term); }}>
          {smart ? "送出" : "搜尋課程"}
        </button>
        <button className="search-btn" onClick={() => { clearTimeout(timer.current); showAll(); }}>顯示全部</button>
        {smart && (
          <div className="smart-examples">
            <span>試試看：</span>
            {AS_EXAMPLES.map(e => <button key={e} className="as-ex" type="button" onClick={() => runSmart(e)}>{e}</button>)}
          </div>
        )}
      </div>

      {!smart && (
        <>
          <div className="filter-container" id="course-filters">
            {chip({ f: "all", label: "全部課程" })}
            {TYPE_CHIPS.map(chip)}
            {GRADE_CHIPS.map(chip)}
            {chip({ f: "fav", label: "★ 我的收藏", className: "fav-chip" })}
          </div>
          <div className="filter-container" id="day-filters">
            <span className="filter-label">上課星期：</span>
            {DAY_CHIPS.map(chip)}
          </div>
          <div className="filter-container" id="period-filters" role="group" aria-label="上課節數">
            <span className="filter-label">上課節數：</span>
            {PERIOD_CHIPS.map(c => (
              <button key={c.f} type="button" className={`filter-item period-chip ${isOn(c.f) ? "active" : ""}`}
                aria-pressed={isOn(c.f)} onClick={() => clickFilter(c.f)}>{c.label}</button>
            ))}
          </div>
        </>
      )}

      <div id="course-results">
        {smart ? <SmartResult /> : <CourseResults />}
      </div>
      {!smart && <Pagination />}
    </div>
  );
}

// 課程列表（一般、搜尋、我的收藏）
function CourseResults() {
  const { list, page } = useApp();
  if (!list) return <p>請先選擇系所或直接搜尋課程。</p>;

  if (list.mode === "fav") {
    if (list.error) return <div className="fav-empty">載入收藏失敗：{list.error}</div>;
    if (list.items.length === 0) {
      return <div className="fav-empty">還沒有收藏的課程<br />在課程卡片右上角點 ☆ 就能收藏，之後在這裡一次看到</div>;
    }
    const q = list.term.toLowerCase();
    const shown = q ? list.items.filter(c => [c.name, c.code, c.teacher].some(v => String(v || "").toLowerCase().includes(q))) : list.items;
    if (shown.length === 0) return <div className="fav-empty">收藏裡沒有符合「{list.term}」的課程</div>;
    return (
      <>
        <h3>★ 我的收藏（{shown.length} 門）</h3>
        <div className="course-list">{shown.map(c => <CourseCard key={c.id} course={c} showSemester />)}</div>
      </>
    );
  }

  if (list.error) {
    return <p style={{ color: "#d32f2f" }}>搜尋失敗：{list.error}（請確認後端 node server.js 有在執行）</p>;
  }
  if (list.total === 0) {
    return <p>{list.mode === "search" ? `找不到符合「${list.term}」的課程` : "找不到符合條件的課程"}</p>;
  }
  if (list.items.length === 0) return <p>本頁沒有課程</p>;
  return (
    <>
      <h3>顯示 {list.items.length} 門課程 (第 {list.page || page} 頁)</h3>
      <div className="course-list">{list.items.map(c => <CourseCard key={c.id} course={c} />)}</div>
    </>
  );
}

function Pagination() {
  const { list, setPage } = useApp();
  if (!list || list.mode === "fav" || list.error || !(list.totalPages > 1)) return null;
  const { page, totalPages, total, term, mode } = list;
  return (
    <div className="pagination" id="pagination-container" style={{ display: "flex" }}>
      <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</button>
      <span className="page-info">
        第 {page} 頁 / 共 {totalPages} 頁{mode === "search" ? `（「${term}」共 ${total} 筆）` : `（後端總數：${total}）`}
      </span>
      <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一頁</button>
    </div>
  );
}
