// ===== 整個系統共用的狀態與動作（登入後才會建立） =====
//   學期、已選課程（課表）、收藏、系所、課程搜尋條件……都放在這裡，
//   各個畫面元件用 useApp() 取用，不用一層一層傳 props。
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api.js";
import { normalizeCourseFromApi, hasTimeConflict, coursesOverlap, semesterLabel, scheduleKey, totalCredits, formatCourseTime } from "./lib/course.js";
import { asAnswer } from "./lib/assistant.js";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const COURSES_PER_PAGE = 20;

export function AppProvider({ user, onLogout, children }) {
  // ---------- 畫面 ----------
  const [section, setSection] = useState("courses");          // courses | schedule | analysis
  const [detailCourse, setDetailCourse] = useState(null);     // 課程詳細彈窗
  const [pwOpen, setPwOpen] = useState(false);                // 修改密碼彈窗

  // ---------- 學期 ----------
  const [semesters, setSemesters] = useState(null);           // null = 載入中；[] = 後端沒有學期清單
  const [semester, setSemester] = useState("");               // 例如 "1151"；"" = 不限
  const [semDataMap, setSemDataMap] = useState(new Map());    // 學期 → 實際課程資料的學期
  const [ready, setReady] = useState(false);                  // 學期決定好了才開始載入課程

  // ---------- 課表 ----------
  const [selected, setSelected] = useState([]);               // 已選課程
  const [savedKey, setSavedKey] = useState("");               // 最後一次讀取 / 儲存時的課表內容
  const scheduleLoadId = useRef(0);

  // ---------- 收藏 ----------
  const [favoriteIds, setFavoriteIds] = useState(new Set());

  // ---------- 系所 ----------
  const [depts, setDepts] = useState([]);                     // 已選系所代碼

  // ---------- 課程搜尋 ----------
  const [searchMode, setSearchModeState] = useState("keyword"); // keyword 關鍵字 | smart 智慧助理
  const [term, setTerm] = useState("");                       // 搜尋框目前的字
  const [appliedTerm, setAppliedTerm] = useState("");         // 實際拿去查詢的字（打字停 0.3 秒才更新）
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);            // 強制重新查詢
  const [favoritesMode, setFavoritesMode] = useState(false);  // 正在看「我的收藏」
  const [filters, setFilters] = useState({ types: [], grades: [], days: [], periods: [] });
  const [list, setList] = useState(null);                     // 課程列表結果；null = 還沒查
  const listReqId = useRef(0);

  // ---------- 智慧助理 ----------
  const [smartQuery, setSmartQuery] = useState("");           // 最後一次問的句子
  const [smartResult, setSmartResult] = useState(null);
  const smartReqId = useRef(0);

  const deptsKey = depts.join(",");
  const filtersKey = JSON.stringify(filters);
  const bump = () => setReloadTick(t => t + 1);

  // =====================================================================
  // 學期
  // =====================================================================
  const effectiveSemester = (sem = semester) => semDataMap.get(sem) || sem || "";

  async function loadSemesters() {
    try {
      const data = await apiFetch("/api/courses/semesters");
      const items = data.items || [];
      if (items.length === 0) throw new Error("沒有學期資料");
      setSemDataMap(new Map(items.map(it => [it.semester, it.hasOwnData === false && data.dataSemester ? data.dataSemester : it.semester])));
      setSemesters(items);
      setSemester(items[0].semester);   // 預設最新的學期
      return items[0].semester;
    } catch (e) {
      console.warn("讀取學期清單失敗：", e);   // 後端沒有學期清單 → 不篩學期
      setSemesters([]);
      setSemester("");
      return "";
    }
  }

  // 課表綁學期：切換學期 = 換成那個學期的課表；有沒存的變更會先詢問
  async function changeSemester(next) {
    if (next === semester) return;
    if (semester && scheduleKey(selected) !== savedKey) {
      const label = semesterLabel(semester) || "目前";
      if (confirm(`「${label}」的課表有變更還沒儲存。\n\n按「確定」：先儲存，再切換學期\n按「取消」：選擇不儲存或留在這學期`)) {
        if (!(await saveSchedule({ silent: true }))) return;
      } else if (!confirm(`要「不儲存」直接切換學期嗎？\n\n按「確定」：放棄這些變更，切換學期\n按「取消」：留在「${label}」`)) {
        return;
      }
    }
    setSemester(next);
    setFavoritesMode(false);
    setPage(1);
    loadSavedSchedule(next);
  }

  // =====================================================================
  // 課表
  // =====================================================================
  async function loadSavedSchedule(sem) {
    const loadId = ++scheduleLoadId.current;
    try {
      const data = await apiFetch(sem ? `/api/planner?semester=${encodeURIComponent(sem)}` : "/api/planner");
      if (loadId !== scheduleLoadId.current) return;   // 已經又切到別的學期了
      const items = (data.items || []).map(normalizeCourseFromApi);
      setSelected(items);
      setSavedKey(scheduleKey(items));
    } catch (e) {
      if (loadId !== scheduleLoadId.current) return;
      console.warn("讀取已儲存的課表失敗：", e);
      setSelected([]);
      setSavedKey("");
    }
  }

  function addCourse(course) {
    // 別的學期的課（例如從「我的收藏」）不能加進這學期的課表
    const curSem = effectiveSemester();
    if (course.semester && curSem && course.semester !== curSem) {
      alert(`「${course.name}」是 ${semesterLabel(course.semester)} 的課，\n目前課表是 ${semesterLabel(semester)}。\n\n請先把上方「學年學期」切換到 ${semesterLabel(course.semester)} 再加入。`);
      return;
    }
    if (selected.some(c => c.id === course.id)) {
      alert("此課程已加入課表");
      return;
    }
    if (hasTimeConflict(course, selected) && !confirm("此課程與已選課程時間衝突，是否仍要加入？")) return;
    setSelected([...selected, course]);
  }

  // 智慧助理「整個方案加入課表」；成功回傳加入的門數，會衝堂則回傳 null
  function addPlan(courses) {
    const list = courses.filter(c => !selected.some(x => x.id === c.id));
    if (list.some(c => hasTimeConflict(c, selected)) || list.some((a, i) => list.slice(i + 1).some(b => coursesOverlap(a, b)))) {
      alert("課表在推薦之後有變動，這個方案現在會衝堂，請重新問一次");
      return null;
    }
    setSelected([...selected, ...list]);
    return list.length;
  }

  function removeCourse(courseId) {
    const course = selected.find(c => c.id === courseId);
    if (!course) return;
    const ok = confirm(`確定要從課表移除這門課嗎？\n\n${course.name}\n${formatCourseTime(course.time)}${course.teacher ? "｜" + course.teacher : ""}`);
    if (ok) setSelected(selected.filter(c => c.id !== courseId));
  }

  function clearSchedule() {
    if (selected.length === 0) { alert("課表已是空的"); return; }
    const semText = semester ? `「${semesterLabel(semester)}」的` : "整個";
    if (confirm(`確定要清空${semText}課表嗎？\n（其他學期的課表不受影響；按「儲存課表」後才會清掉已存的）`)) setSelected([]);
  }

  // 只儲存「目前學期」的課表；silent = 切換學期時自動儲存，成功不跳提示
  async function saveSchedule({ silent = false } = {}) {
    const semText = semester ? semesterLabel(semester) : "";
    if (!silent && selected.length === 0) {
      if (!confirm(`目前${semText ? "「" + semText + "」的" : ""}課表是空的。\n儲存後會清掉這學期之前存過的課表，確定要儲存嗎？`)) return false;
    }
    try {
      const body = { courseIds: selected.map(c => c.id) };
      if (semester) body.semester = semester;
      const data = await apiFetch("/api/planner", { method: "PUT", body });
      setSavedKey(scheduleKey(selected));
      if (!silent) {
        let msg = `✅ ${semText ? semText + "的" : ""}課表已儲存！\n共 ${data.saved ?? selected.length} 門課、${totalCredits(selected)} 學分\n之後登入或切回這個學期，會自動載入這份課表。`;
        if (data.skipped) msg += `\n\n（有 ${data.skipped} 門課不是這學期的課或找不到，沒有存到）`;
        alert(msg);
      }
      return true;
    } catch (e) {
      alert(`儲存失敗：${e.message}`);
      return false;
    }
  }

  // =====================================================================
  // 收藏
  // =====================================================================
  async function loadFavorites() {
    try {
      const data = await apiFetch("/api/favorites");
      setFavoriteIds(new Set(data.ids || []));
    } catch (e) {
      console.warn("讀取收藏失敗：", e);
    }
  }

  // 點星星：收藏 / 取消收藏（畫面先變，失敗再改回來）
  async function toggleFavorite(course) {
    const id = course.id;
    const wasOn = favoriteIds.has(id);
    const next = new Set(favoriteIds);
    wasOn ? next.delete(id) : next.add(id);
    setFavoriteIds(next);
    // 在「我的收藏」裡取消收藏 → 直接從列表拿掉
    if (favoritesMode && wasOn) setList(l => (l && l.mode === "fav" ? { ...l, items: l.items.filter(c => c.id !== id) } : l));

    try {
      if (wasOn) await apiFetch(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
      else await apiFetch("/api/favorites", { method: "POST", body: { courseId: id } });
    } catch (e) {
      setFavoriteIds(prev => { const s = new Set(prev); wasOn ? s.add(id) : s.delete(id); return s; });
      if (favoritesMode) bump();
      alert(`${wasOn ? "取消收藏" : "收藏"}失敗：${e.message}`);
    }
  }

  // =====================================================================
  // 系所
  // =====================================================================
  function changeDepts(next) {
    setDepts(next);
    setFavoritesMode(false);
    setPage(1);
  }

  // =====================================================================
  // 課程搜尋（篩選、分頁、收藏模式）
  // =====================================================================
  function clickFilter(f) {
    const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
    const groupOf = v => (v.startsWith("period-") ? ["periods", v.slice(7)]
      : v.startsWith("day-") ? ["days", v.slice(4)]
      : /^\d$/.test(v) ? ["grades", v] : ["types", v]);
    const empty = { types: [], grades: [], days: [], periods: [] };

    if (f === "fav") {
      setFavoritesMode(!favoritesMode);   // 再點一次回到一般課程列表
    } else if (f === "all") {
      setFavoritesMode(false);
      setFilters(empty);
    } else if (favoritesMode) {
      // 看收藏時點其他篩選 → 離開收藏，改用這個篩選
      const [g, v] = groupOf(f);
      setFavoritesMode(false);
      setFilters({ ...empty, [g]: [v] });
    } else {
      const [g, v] = groupOf(f);
      setFilters({ ...filters, [g]: toggle(filters[g], v) });
    }
    setPage(1);
    bump();
  }

  function filterParams() {
    let p = "";
    const { types, grades, days, periods } = filters;
    if (types.length > 0 && types.length < 4) p += `&kind=${[...types].sort().join(",")}`;   // 四種全選 = 全部
    if (grades.length) p += `&grade=${[...grades].sort().join(",")}`;
    if (days.length) p += `&day=${[...days].sort().join(",")}`;
    if (periods.length) p += `&period=${[...periods].sort((a, b) => a - b).join(",")}`;
    if (semester) p += `&semester=${semester}`;
    if (depts.length) p += `&dept=${encodeURIComponent(depts.join(","))}`;
    return p;
  }

  // 依目前條件向後端查課程（條件一變就自動重查）
  useEffect(() => {
    if (!ready || searchMode === "smart") return;
    const id = ++listReqId.current;
    const q = appliedTerm.trim();
    (async () => {
      try {
        if (favoritesMode) {
          const data = await apiFetch("/api/favorites");
          if (id !== listReqId.current) return;
          setFavoriteIds(new Set(data.ids || []));
          setList({ mode: "fav", items: (data.items || []).map(normalizeCourseFromApi), term: q });
          return;
        }
        const url = q
          ? `/api/courses/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${COURSES_PER_PAGE}${filterParams()}`
          : `/api/courses?page=${page}&pageSize=${COURSES_PER_PAGE}${filterParams()}`;
        const data = await apiFetch(url);
        if (id !== listReqId.current) return;   // 已經有更新的查詢，丟掉這個舊結果
        setList({
          mode: q ? "search" : "all",
          items: (data.items || []).map(normalizeCourseFromApi),
          page: data.page || page,
          totalPages: data.totalPages || 1,
          total: data.total ?? 0,
          term: q,
        });
      } catch (e) {
        if (id !== listReqId.current) return;
        if (favoritesMode) setList({ mode: "fav", error: e.message, items: [], term: q });
        else if (q) setList({ mode: "search", error: e.message, items: [], term: q });   // 打字時不要一直跳視窗
        else { console.error("載入課程失敗:", e); alert(`載入課程失敗：${e.message}`); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, searchMode, favoritesMode, appliedTerm, page, semester, deptsKey, filtersKey, reloadTick]);

  // 搜尋框：打字停 0.3 秒才查；按 Enter 或「搜尋課程」立刻查
  function applySearch(text) {
    setAppliedTerm(text);
    setPage(1);
    bump();
  }

  function showAll() {
    setTerm("");
    if (searchMode === "smart") { setSearchMode("keyword"); return; }   // 回到關鍵字搜尋並顯示全部
    setFavoritesMode(false);
    applySearch("");
  }

  function setSearchMode(mode) {
    if (mode === searchMode) return;
    setSearchModeState(mode);
    setTerm("");
    if (mode === "smart") {
      setFavoritesMode(false);
      setSmartQuery("");
      setSmartResult({ kind: "intro" });
    } else {
      applySearch("");
    }
  }

  // =====================================================================
  // 智慧助理
  // =====================================================================
  async function runSmart(textArg) {
    const text = String(textArg ?? term).trim();
    if (typeof textArg === "string") setTerm(textArg);
    if (!text) { setSmartResult({ kind: "help", prefix: "請先輸入一句話。" }); return; }
    setSmartQuery(text);
    const id = ++smartReqId.current;
    setSmartResult({ kind: "loading", text });
    let data;
    try {
      data = await asAnswer(text, { semester, depts, selected });
    } catch (e) {
      data = { kind: "error", message: e.message };
    }
    if (id !== smartReqId.current) return;   // 已經有更新的查詢
    setSmartResult({ ...data, text });
  }

  // 換學期、系所時，用同一句話重新問一次
  useEffect(() => {
    if (searchMode === "smart" && smartQuery) runSmart(smartQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester, deptsKey]);

  // =====================================================================
  // 登入後的初始化：收藏 → 學期 → 該學期課表 → 課程列表
  // =====================================================================
  useEffect(() => {
    (async () => {
      loadFavorites();
      const sem = await loadSemesters();
      loadSavedSchedule(sem);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    user, onLogout,
    section, setSection, detailCourse, setDetailCourse, pwOpen, setPwOpen,
    semesters, semester, changeSemester, effectiveSemester,
    selected, addCourse, addPlan, removeCourse, clearSchedule, saveSchedule,
    isDirty: !!semester && scheduleKey(selected) !== savedKey,
    favoriteIds, toggleFavorite,
    depts, changeDepts,
    searchMode, setSearchMode, term, setTerm, applySearch, showAll, page, setPage,
    favoritesMode, filters, clickFilter, list,
    smartResult, runSmart,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
