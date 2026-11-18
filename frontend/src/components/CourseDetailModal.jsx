// 課程詳細資料彈窗（點旁邊灰色區域也會關閉）
import React from "react";
import { useApp } from "../AppContext.jsx";
import { courseTypeLabel, formatCourseTime, semesterLabel } from "../lib/course.js";

export default function CourseDetailModal() {
  const { detailCourse: c, setDetailCourse, semester } = useApp();
  if (!c) return null;
  const close = () => setDetailCourse(null);
  return (
    <div id="course-detail-modal" className="modal" style={{ display: "flex" }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-content">
        <span className="close-modal" onClick={close}>&times;</span>
        <h3>{c.code} {c.name}</h3>
        <div>
          <p><strong>課程名稱：</strong>{c.name}</p>
          <p><strong>課程代碼：</strong>{c.code}</p>
          <p><strong>學分數：</strong>{c.credit}</p>
          <p><strong>課程類型：</strong>{courseTypeLabel(c)}</p>
          {semester && <p><strong>開課學期：</strong>{semesterLabel(c.semester || semester)}</p>}
          <p><strong>適合年級：</strong>{c.grade}</p>
          <p><strong>開課系所：</strong>{c.dept}</p>
          <p><strong>授課教師：</strong>{c.teacher}</p>
          <p><strong>上課時間：</strong>{formatCourseTime(c.time)}</p>
          <p><strong>上課地點：</strong>{c.location || "未提供"}</p>
          <p><strong>課程簡介：</strong>{c.desc}</p>
        </div>
      </div>
    </div>
  );
}
