// 1. 選擇學制與系所
//   - 學制選「全部學制」→ 系所選單列出所有系所，依學制分組
//   - 選了某個學制 → 系所選單只列出該學制的系所
//   - 已選過的系所標「（已選）」且不能再選；選了就自動篩選課程
import React, { useState } from "react";
import { useApp } from "../AppContext.jsx";
import { EDU_SYSTEMS, departmentData, deptLabel, deptTagLabel, eduSystemName } from "../data/departments.js";

export default function DepartmentPicker() {
  const { depts, changeDepts } = useApp();
  const [system, setSystem] = useState("");

  const option = code => (
    <option key={code} value={code} disabled={depts.includes(code)}>
      {deptLabel(code)}{depts.includes(code) ? "（已選）" : ""}
    </option>
  );

  const pick = code => { if (code && !depts.includes(code)) changeDepts([...depts, code]); };
  const remove = code => changeDepts(depts.filter(d => d !== code));
  const clearAll = () => { setSystem(""); changeDepts([]); };

  return (
    <div className="card">
      <h2>1. 選擇學制與系所</h2>
      <div className="department-section">
        <p>可以直接選擇系所，或先選學制縮小系所範圍：</p>

        <div className="select-group">
          <div className="select-container">
            <label className="select-label">選擇學制（可不選）</label>
            <select id="edu-system-select" className="select-box" value={system} onChange={e => setSystem(e.target.value)}>
              <option value="">全部學制</option>
              {EDU_SYSTEMS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="select-container">
            <label className="select-label">選擇系所</label>
            {/* value 固定為空：選完就回到「請選擇系所」，選到的系所變成下面的標籤 */}
            <select id="department-select" className="select-box" value="" onChange={e => pick(e.target.value)}>
              <option value="">{system ? `請選擇系所（${eduSystemName(system)}）` : "請選擇系所（全部學制）"}</option>
              {system
                ? (departmentData[system] || []).map(option)
                : Object.keys(departmentData).map(key => (
                    <optgroup key={key} label={eduSystemName(key)}>{departmentData[key].map(option)}</optgroup>
                  ))}
            </select>
          </div>
        </div>

        {depts.length > 0 && (
          <div id="selected-dept-tags" className="dept-tag-container">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <small style={{ fontWeight: "bold" }}>已選系所：</small>
              <button onClick={clearAll} style={{ padding: "5px 10px", fontSize: "0.8em", background: "#ff6b6b", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>清除所有系所</button>
            </div>
            <div>
              {depts.map(code => (
                <span key={code} className="dept-tag" title="點一下移除這個系所" onClick={() => remove(code)}>
                  {deptTagLabel(code)} ✕
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="button-group">
          <button onClick={clearAll} style={{ backgroundColor: "#ff6b6b", color: "white" }}>清除系所選擇</button>
        </div>

        <div className="hint-message">
          💡 提示：選擇系所後會自動顯示該系所的課程，可以選多個系所；點系所標籤可以移除
        </div>
      </div>
    </div>
  );
}
