import React, { useState } from "react";
import { setAuth } from "./api.js";
import { clearRecCache } from "./lib/assistant.js";
import { AppProvider, useApp } from "./AppContext.jsx";
import LoginPage from "./components/LoginPage.jsx";
import Navbar from "./components/Navbar.jsx";
import DepartmentPicker from "./components/DepartmentPicker.jsx";
import CourseSearch from "./components/CourseSearch.jsx";
import AnalysisPage from "./components/AnalysisPage.jsx";
import SchedulePage from "./components/SchedulePage.jsx";
import CourseDetailModal from "./components/CourseDetailModal.jsx";
import PasswordModal from "./components/PasswordModal.jsx";

export default function App() {
  // session = 登入後的資訊；null = 顯示登入畫面
  const [session, setSession] = useState(null);

  if (!session) return <LoginPage onLogin={setSession} />;

  // 登出：清掉 token，整個主畫面卸載，下一個人登入是乾淨的狀態
  const logout = () => {
    setAuth("", "");
    clearRecCache();
    setSession(null);
  };

  return (
    <AppProvider key={session.loginAt} user={session.displayId} onLogout={logout}>
      <MainLayout />
    </AppProvider>
  );
}

function MainLayout() {
  const { section } = useApp();
  return (
    <div id="app-content">
      <Navbar />
      <div className="main-content">
        <div className={`section-container ${section === "courses" ? "active" : ""}`} id="section-courses">
          <DepartmentPicker />
          <CourseSearch />
        </div>
        <div className={`section-container ${section === "analysis" ? "active" : ""}`} id="section-analysis">
          <AnalysisPage active={section === "analysis"} />
        </div>
        <div className={`section-container ${section === "schedule" ? "active" : ""}`} id="section-schedule">
          <SchedulePage />
        </div>
      </div>
      <CourseDetailModal />
      <PasswordModal />
    </div>
  );
}
