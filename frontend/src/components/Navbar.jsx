import React from "react";
import { useApp } from "../AppContext.jsx";

const LINKS = [
  { id: "courses", label: "課程搜尋" },
  { id: "schedule", label: "我的課表" },
  { id: "analysis", label: "學分分析" },
];

export default function Navbar() {
  const { section, setSection, user, setPwOpen, onLogout } = useApp();
  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="logo"><h1>NTUNHS 課程規劃助手</h1></div>
        <div className="nav-links">
          {LINKS.map(l => (
            <a key={l.id} href="#" className={`nav-link ${section === l.id ? "active" : ""}`}
              onClick={e => { e.preventDefault(); setSection(l.id); }}>{l.label}</a>
          ))}
          <div className="user-info">
            <span className="user-id">學號: <span id="display-user-id">{user}</span></span>
            <button className="change-pw-btn" onClick={() => setPwOpen(true)}>修改密碼</button>
            <button className="logout-btn" onClick={onLogout}>登出</button>
          </div>
        </div>
      </div>
    </nav>
  );
}
