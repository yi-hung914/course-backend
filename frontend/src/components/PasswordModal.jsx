// 修改密碼彈窗
import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { useApp } from "../AppContext.jsx";

export default function PasswordModal() {
  const { pwOpen, setPwOpen } = useApp();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const firstInput = useRef(null);

  // 每次打開都是空白的
  useEffect(() => {
    if (!pwOpen) return;
    setOldPw(""); setNewPw(""); setNewPw2(""); setMsg("");
    setTimeout(() => firstInput.current?.focus(), 0);
  }, [pwOpen]);

  async function submit() {
    if (!oldPw) return setMsg("請輸入目前的密碼");
    if (newPw.length < 6) return setMsg("新密碼至少要 6 個字");
    if (newPw !== newPw2) return setMsg("兩次輸入的新密碼不一樣");
    setBusy(true);
    setMsg("");
    try {
      await apiFetch("/api/auth/password", { method: "PUT", body: { oldPassword: oldPw, newPassword: newPw } });
      setPwOpen(false);
      alert("密碼已更新，下次登入請使用新密碼");
    } catch (e) {
      setMsg(/ACCESS_INVALID|請先登入|已過期/.test(e.message) ? "登入已過期，請登出後重新登入再修改" : e.message);
    } finally {
      setBusy(false);
    }
  }

  const onEnter = e => { if (e.key === "Enter") submit(); };
  if (!pwOpen) return null;

  return (
    <div id="password-modal" className="modal" style={{ display: "flex" }}>
      <div className="modal-content pw-modal-content">
        <span className="close-modal" onClick={() => setPwOpen(false)}>&times;</span>
        <h3>修改密碼</h3>
        <input ref={firstInput} type="password" placeholder="目前的密碼" autoComplete="current-password"
          value={oldPw} onChange={e => setOldPw(e.target.value)} onKeyDown={onEnter} />
        <input type="password" placeholder="新密碼（至少 6 個字）" autoComplete="new-password"
          value={newPw} onChange={e => setNewPw(e.target.value)} onKeyDown={onEnter} />
        <input type="password" placeholder="再輸入一次新密碼" autoComplete="new-password"
          value={newPw2} onChange={e => setNewPw2(e.target.value)} onKeyDown={onEnter} />
        <div className="pw-msg">{msg}</div>
        <button className="login-btn" disabled={busy} onClick={submit}>{busy ? "更新中..." : "更新密碼"}</button>
      </div>
    </div>
  );
}
