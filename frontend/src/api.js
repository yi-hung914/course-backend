// ===== 呼叫後端 API =====
//   - 在自己電腦開（localhost / 127.0.0.1）→ 連本機後端 http://localhost:3000
//   - 在 GitHub Pages 開 → 連雲端後端（Render）
const CLOUD_API_BASE = "https://ntunhs-course-planner.onrender.com";
const IS_LOCAL_PAGE = ["localhost", "127.0.0.1", ""].includes(location.hostname);
export const API_BASE = IS_LOCAL_PAGE ? "http://localhost:3000" : CLOUD_API_BASE;

// 登入狀態（token 和 userId）；重新整理後從 localStorage 讀回
export const auth = {
  accessToken: localStorage.getItem("accessToken") || "",
  userId: localStorage.getItem("userId") || "",
};

export function setAuth(token, userId) {
  auth.accessToken = token;
  auth.userId = userId;
  if (token) {
    localStorage.setItem("accessToken", token);
    localStorage.setItem("userId", userId);
  } else {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("userId");
  }
}

// 統一的 API 呼叫函式：自動帶 token、x-user-id，錯誤時丟出後端的訊息
export async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
      ...(auth.userId ? { "x-user-id": auth.userId } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// 解開 JWT 中間那段，拿到 userId
export function parseJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}
