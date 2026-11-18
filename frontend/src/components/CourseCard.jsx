// 一門課的卡片（課程列表用）
import React from "react";
import { useApp } from "../AppContext.jsx";
import { courseTypeLabel, formatCourseTime, semesterLabel } from "../lib/course.js";

export default function CourseCard({ course, showSemester }) {
  const { selected, favoriteIds, toggleFavorite, addCourse, setDetailCourse } = useApp();
  const added = selected.some(c => c.id === course.id);
  const fav = favoriteIds.has(course.id);

  return (
    <div className="course-card">
      <button className={`fav-btn ${fav ? "on" : ""}`} title={fav ? "取消收藏" : "收藏"} onClick={() => toggleFavorite(course)}>
        {fav ? "★" : "☆"}
      </button>
      <div className="course-title">{course.code} {course.name}</div>
      {showSemester && course.semester && <div className="course-info">學期: {semesterLabel(course.semester)}</div>}
      <div className="course-info">學分: {course.credit} | 類型: {courseTypeLabel(course)} | 年級: {course.grade}</div>
      <div className="course-info">系所: {course.dept} | 教師: {course.teacher}</div>
      <div className="course-info">時間: {formatCourseTime(course.time)}</div>
      <div className="course-info">地點: {course.location || "未提供"}</div>
      <button className="add-course-btn" disabled={added} onClick={() => addCourse(course)}>
        {added ? "已加入" : "加入課表"}
      </button>{" "}
      <button style={{ marginLeft: 5, padding: "10px 15px", background: "#eee", border: "none", borderRadius: 6, cursor: "pointer" }}
        onClick={() => setDetailCourse(course)}>
        詳細
      </button>
    </div>
  );
}
