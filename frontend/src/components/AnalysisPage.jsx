// 已選課程與學分分析（圓餅圖用 Chart.js）
import React, { useEffect, useRef } from "react";
import { useApp } from "../AppContext.jsx";
import { formatCourseTime, totalCredits } from "../lib/course.js";

// 依類型加總學分
function creditSummary(list) {
  const s = { requiredMajor: 0, requiredGeneral: 0, electiveMajor: 0, electiveGeneral: 0 };
  for (const c of list) {
    const general = c.category === "general";
    if (c.type === "core") general ? (s.requiredGeneral += c.credit) : (s.requiredMajor += c.credit);
    else if (c.type === "elective") general ? (s.electiveGeneral += c.credit) : (s.electiveMajor += c.credit);
  }
  return s;
}

export default function AnalysisPage({ active }) {
  const { selected, removeCourse } = useApp();
  const s = creditSummary(selected);
  const canvasRef = useRef(null);

  // 只有在這個分頁顯示時才畫圖（隱藏時畫會變成 0 大小）
  useEffect(() => {
    if (!active || !window.Chart || !canvasRef.current) return;
    const chart = new window.Chart(canvasRef.current, {
      type: "doughnut",
      data: {
        labels: ["專業必修", "通識必修", "專業選修", "通識選修"],
        datasets: [{
          data: [s.requiredMajor, s.requiredGeneral, s.electiveMajor, s.electiveGeneral],
          backgroundColor: ["#007d66", "#00a896", "#ff6b6b", "#ff9e6d"],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { padding: 20, font: { family: '"Microsoft JhengHei", sans-serif' } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label || ""}: ${ctx.parsed || 0} 學分` } },
        },
      },
    });
    return () => chart.destroy();
  }, [active, s.requiredMajor, s.requiredGeneral, s.electiveMajor, s.electiveGeneral]);

  return (
    <div className="card">
      <h2>已選課程與學分分析</h2>

      <div className="selected-courses">
        <h3>已選課程清單</h3>
        <div id="selected-courses-list">
          {selected.length === 0 ? <p>尚未選擇任何課程</p> : selected.map(c => (
            <div key={c.id} className="selected-course-item">
              <div>
                <strong>{c.code} {c.name}</strong><br />
                <small>{formatCourseTime(c.time)} | {c.credit}學分 | {c.teacher}</small>
              </div>
              <button className="remove-course-btn" onClick={() => removeCourse(c.id)}>移除</button>
            </div>
          ))}
        </div>
        <div className="credit-summary">總學分: <span id="total-credits">{totalCredits(selected)}</span> 學分</div>
      </div>

      <div className="credit-distribution">
        <h3>學分分佈分析</h3>
        <div className="chart-container"><canvas id="creditChart" ref={canvasRef}></canvas></div>
        <div className="distribution-grid">
          <div className="distribution-category">
            <div className="category-title">必修課程</div>
            <div className="category-credits">{s.requiredMajor + s.requiredGeneral}</div>
            <div className="subcategory">
              <div>專業必修: <span>{s.requiredMajor}</span></div>
              <div>通識必修: <span>{s.requiredGeneral}</span></div>
            </div>
          </div>
          <div className="distribution-category">
            <div className="category-title">選修課程</div>
            <div className="category-credits">{s.electiveMajor + s.electiveGeneral}</div>
            <div className="subcategory">
              <div>專業選修: <span>{s.electiveMajor}</span></div>
              <div>通識選修: <span>{s.electiveGeneral}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
