// 智慧助理的回答（顯示在課程列表的位置）
import React, { useState } from "react";
import { useApp } from "../AppContext.jsx";
import { courseTypeLabel, formatCourseTime } from "../lib/course.js";

function Tags({ tags }) {
  if (!tags?.length) return null;
  return <div className="as-tags">{tags.map((t, i) => <span key={i} className="as-tag">{t}</span>)}</div>;
}

function Help({ prefix }) {
  return (
    <>
      {prefix}<br />我是規則式的選課助理，看得懂這些條件：
      <Tags tags={["星期（週三、週一到週三）", "時段（上午、下午、晚上）", "學分", "專業／通識、必修／選修", "年級（大一、二年級）", "課名或老師"]} />
      想排課可以說「我還差 4 學分通識，週五不想上課」，我會幫你找不衝堂、剛好湊滿的組合。<br />
      也可以描述你的背景和目標，例如「我是資管系三年級，想加強程式能力」，我會推薦相關的課並說明理由。
    </>
  );
}

// 助理列出的一門課
function AsCourse({ course, prefix = "", children }) {
  const { selected, favoriteIds, addCourse, toggleFavorite } = useApp();
  const added = selected.some(x => x.id === course.id);
  const fav = favoriteIds.has(course.id);
  return (
    <div className="as-course">
      <div className="t">{prefix}{course.name}</div>
      <div className="i">{course.credit} 學分｜{courseTypeLabel(course)}｜{course.teacher}</div>
      <div className="i">{course.time.length ? formatCourseTime(course.time) : "未提供時間"}{course.location ? "｜" + course.location : ""}</div>
      {children}
      <div className="b">
        <button className="as-btn main" disabled={added} onClick={() => addCourse(course)}>{added ? "已加入" : "加入課表"}</button>{" "}
        <button className="as-btn" onClick={() => toggleFavorite(course)}>{fav ? "★ 已收藏" : "☆ 收藏"}</button>
      </div>
    </div>
  );
}

function Grid({ courses }) {
  return <div className="smart-grid">{courses.map(c => <AsCourse key={c.id} course={c} />)}</div>;
}

// 一個排課方案
function Plan({ plan, index, need }) {
  const { addPlan } = useApp();
  const [addedCount, setAddedCount] = useState(null);
  return (
    <div className="as-plan">
      <h4>方案 {index + 1}：{plan.courses.length} 門課，共 {need} 學分（{plan.days}）</h4>
      <Grid courses={plan.courses} />
      <div className="as-plan-foot">
        <button className="as-btn main" disabled={addedCount !== null}
          onClick={() => { const n = addPlan(plan.courses); if (n !== null) setAddedCount(n); }}>
          {addedCount !== null ? "已加入課表 ✓" : "整個方案加入課表"}
        </button>
        {addedCount !== null && (
          <span style={{ marginLeft: 8, fontSize: ".85em", color: "#007d66" }}>已加入 {addedCount} 門課，記得到「我的課表」按「儲存課表」</span>
        )}
      </div>
    </div>
  );
}

function Body({ r }) {
  switch (r.kind) {
    case "intro": return <Help prefix="✨ 智慧助理：用一句話告訴我你想找什麼課。" />;
    case "help": return <Help prefix={r.prefix} />;
    case "loading": return <>分析中…</>;
    case "error": return <>查詢失敗：{r.message}</>;
    case "askNeed": return <>想湊幾學分呢？例如：「我還差 <b>4 學分</b>通識，週五不想上課」。</>;

    case "search":
      if (r.total === 0) {
        return <>我理解的條件：<Tags tags={r.tags} />
          {r.onlyKeyword ? <Help prefix={`找不到課名或老師含有「${r.keyword}」的課程。`} /> : "找不到符合的課程，可以少一個條件再試試看。"}</>;
      }
      return <>我理解的條件：<Tags tags={r.tags} />
        共找到 <b>{r.total}</b> 門課{r.total > r.show ? `，先列出前 ${r.show} 門（可以再加條件縮小範圍）` : ""}：
        <Grid courses={r.items} /></>;

    case "plan":
      if (r.plans.length === 0 && r.cand.length === 0) {
        return <>我理解的條件：<Tags tags={r.tags} />找不到跟目前課表不衝堂的課，可以放寬條件再試試看。</>;
      }
      if (r.plans.length === 0) {
        return <>我理解的條件：<Tags tags={r.tags} />找不到剛好湊滿 {r.need} 學分的組合，以下是符合條件、而且不衝堂的課，可以自己挑：<Grid courses={r.cand} /></>;
      }
      return <>我理解的條件：<Tags tags={r.tags} />
        幫你找到 <b>{r.totalPlans >= 300 ? "300+" : r.totalPlans}</b> 種剛好 {r.need} 學分、而且不衝堂的組合，推薦這 {r.plans.length} 種：
        {r.plans.map((p, i) => <Plan key={i} plan={p} index={i} need={r.need} />)}</>;

    case "rec":
      if (r.count === 0) {
        return <>我理解的背景與目標：<Tags tags={r.tags} />在這個學期的課程裡，找不到和你目標相關的課。可以換個說法，例如「想加強資料分析」「對心理學有興趣」。</>;
      }
      return <>我理解的背景與目標：<Tags tags={r.tags} />
        從 {r.poolSize} 門課中，找到 <b>{r.count}</b> 門相關的課，最推薦這 {r.top.length} 門：
        <div className="smart-grid">
          {r.top.map((x, i) => (
            <AsCourse key={x.course.id} course={x.course} prefix={`${i + 1}. `}>
              <div className="i" style={{ color: "#f5a623" }}>{"★".repeat(x.stars)}{"☆".repeat(5 - x.stars)} 相符度</div>
              <ul style={{ margin: "4px 0 0 18px", fontSize: ".84em", color: "#444" }}>
                {x.reasons.map((t, j) => <li key={j}>{t}</li>)}
              </ul>
            </AsCourse>
          ))}
        </div>
        <div className="i" style={{ marginTop: 8, fontSize: ".8em", color: "#888" }}>推薦方式：課名和目標的相關程度為主，再依本系、年級、選修、是否衝堂加減分。推薦僅供參考，請以學校選課系統為準。</div></>;

    default: return null;
  }
}

export default function SmartResult() {
  const { smartResult } = useApp();
  if (!smartResult) return null;
  return (
    <div className="smart-result">
      {smartResult.text && <div className="smart-q">「{smartResult.text}」</div>}
      <Body r={smartResult} />
    </div>
  );
}
