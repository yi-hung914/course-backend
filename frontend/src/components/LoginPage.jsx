// 登入 / 註冊畫面
import React, { useState } from "react";
import { apiFetch, parseJwtPayload, setAuth } from "../api.js";

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");   // login | register
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const isReg = mode === "register";

  async function login() {
    const id = user.trim();
    if (!id) return alert("請輸入學號");
    if (!pass) return alert("請輸入密碼");
    try {
      const data = await apiFetch("/api/auth/login", { method: "POST", body: { email: id, password: pass } });
      const token = data.accessToken || data.token || data.jwt || "";
      if (!token) return alert("登入成功但沒有拿到 accessToken");
      const payload = parseJwtPayload(token);
      const uid = payload?.userId || payload?.uid || payload?.id || payload?.sub || payload?._id || "";
      if (!uid) return alert("登入成功但 JWT 裡找不到 userId");
      setAuth(token, uid);
      onLogin({ displayId: id, loginAt: Date.now() });
    } catch (e) {
      console.error("LOGIN ERROR =", e);
      alert("登入失敗：" + e.message);
    }
  }

  async function register() {
    const id = user.trim();
    if (!id) return alert("請輸入學號");
    if (pass.length < 6) return alert("密碼至少要 6 個字");
    if (pass !== pass2) return alert("兩次輸入的密碼不一樣");
    try {
      await apiFetch("/api/auth/register", { method: "POST", body: { email: id, password: pass, username: id } });
    } catch (e) {
      if (String(e.message).includes("已被註冊")) return alert("這個學號已經註冊過了，請直接登入");
      return alert(`註冊失敗：${e.message}`);
    }
    // 註冊成功就直接登入
    setPass2("");
    setMode("login");
    await login();
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (isReg) await register();
      else await login();
    } finally {
      setBusy(false);
    }
  }

  const onEnter = e => { if (e.key === "Enter") submit(); };

  return (
    <div id="login-overlay">
      <div className="login-card">
        <h1>NTUNHS 課程規劃系統</h1>
        <p>{isReg ? "用學號建立帳號（密碼至少 6 個字）" : "請輸入學號與密碼進入系統"}</p>
        <input type="text" id="username" placeholder="學號" autoComplete="username"
          value={user} onChange={e => setUser(e.target.value)} onKeyDown={onEnter} />
        <input type="password" id="password" placeholder="密碼" autoComplete={isReg ? "new-password" : "current-password"}
          value={pass} onChange={e => setPass(e.target.value)} onKeyDown={onEnter} />
        {isReg && (
          <input type="password" id="password-confirm" placeholder="再輸入一次密碼" autoComplete="new-password"
            value={pass2} onChange={e => setPass2(e.target.value)} onKeyDown={onEnter} />
        )}
        {/* 雲端免費主機閒置後會休眠，第一次要等它醒來 */}
        <button className="login-btn" id="auth-submit" disabled={busy} onClick={submit}>
          {busy ? "處理中...（第一次連線可能要等 30 秒）" : isReg ? "註冊並登入" : "登入系統"}
        </button>
        <p className="auth-switch">
          <span>{isReg ? "已經有帳號？" : "還沒有帳號？"}</span>{" "}
          <a href="#" onClick={e => { e.preventDefault(); setMode(isReg ? "login" : "register"); }}>
            {isReg ? "回到登入" : "註冊新帳號"}
          </a>
        </p>
        <p className="admin-entry"><a href="./admin.html">課程管理者登入 →</a></p>
      </div>
    </div>
  );
}
