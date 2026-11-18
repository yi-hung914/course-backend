// ===== 智慧選課助理（規則式：程式自己解析句子，不用外部 AI、不用 API 金鑰）=====
//   1. 看懂問題：把句子拆成條件（星期、時段、學分、類別、年級、課名或老師）
//   2. 找課：把條件交給後端 /api/courses 查詢
//   3. 排課推薦：「還差 N 學分」→ 找出不衝堂、剛好湊滿學分的課程組合
//   4. 興趣推薦：「我是資管系三年級，想加強程式能力」→ 幫每門課打分數，推薦前 5 門並附理由
import { apiFetch } from "../api.js";
import { DEPT_MAP } from "../data/departments.js";
import { normalizeCourseFromApi, courseTypeLabel, coursesOverlap, hasTimeConflict } from "./course.js";

export const AS_EXAMPLES = [
  "我是資管系三年級，想加強程式能力",
  "大二，對心理學有興趣",
  "我想往資料分析發展",
  "週三下午有什麼通識課？",
  "2 學分的通識選修",
  "大一的專業必修",
  "我還差 4 學分通識，週五不想上課",
  "推薦 6 學分的專業選修",
  "資料庫",
];
const AS_DAY = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
export const AS_DAY_NAME = ["", "週一", "週二", "週三", "週四", "週五", "週六", "週日"];
const AS_SLOT_NAME = { morning: "上午", afternoon: "下午", evening: "晚上" };
const AS_KIND_NAME = { "core": "專業必修", "elective": "專業選修", "gen-core": "通識必修", "gen-elective": "通識選修" };
const AS_CN_NUM = { "零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
const AS_DAY_RE = "(?:週|周|星期|禮拜)([一二三四五六日天])";
const AS_NUM_RE = "(\\d+|[一二兩三四五六七八九十]{1,3})";

function asToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (AS_CN_NUM[s[1]] || 0);
  if (s.endsWith("十")) return (AS_CN_NUM[s[0]] || 1) * 10;
  if (s.length === 3 && s[1] === "十") return AS_CN_NUM[s[0]] * 10 + AS_CN_NUM[s[2]];
  return AS_CN_NUM[s] ?? NaN;
}

// 把一句話拆成查詢條件
export function asParse(text) {
  const r = { days: new Set(), noDays: new Set(), slots: new Set(), credits: new Set(), kinds: new Set(), grades: new Set(), need: 0, plan: false, keyword: "" };
  let t = String(text || "").replace(/\s+/g, "").replace(/[？?！!。，,、；;：:~～]/g, " ");
  const cut = (re, fn) => { t = t.replace(re, (...m) => { fn(...m); return " "; }); };

  // 想排課／推薦
  if (/推薦|建議|幫我排|排課|組合|搭配|湊|還差|差幾|修滿|補滿/.test(t)) r.plan = true;

  // 星期：範圍（週一到週三）、不要的星期、一般星期
  cut(new RegExp(AS_DAY_RE + "(?:到|至|-)(?:週|周|星期|禮拜)?([一二三四五六日天])", "g"),
      (m, a, b) => { for (let d = AS_DAY[a]; d <= AS_DAY[b]; d++) r.days.add(d); });
  // 「不要週一和週五」：否定詞後面接的每一天都不排
  cut(new RegExp("(?:不要|不想|避開|除了|不排|不上|沒空)(?:在)?" + AS_DAY_RE + "(?:(?:和|跟|及|或|、| )?(?:週|周|星期|禮拜)?[一二三四五六日天](?![年級]))*(?:上課|有課|的課)?", "g"),
      (m) => { for (const ch of m.replace(/^(?:不要|不想|避開|除了|不排|不上|沒空)/, "").replace(/上課|有課|的課/g, "")) if (AS_DAY[ch] && ch !== "天") r.noDays.add(AS_DAY[ch]); });
  cut(new RegExp(AS_DAY_RE + "(?:不想上課|不要上課|不想有課|不要有課|不上課|不要|不想|沒課|沒空|休息|放假|空出來|空堂)", "g"),
      (m, a) => r.noDays.add(AS_DAY[a]));
  cut(new RegExp(AS_DAY_RE, "g"), (m, a) => r.days.add(AS_DAY[a]));

  // 時段（「不要晚上」這種排除時段的說法先略過，不當成條件）
  cut(/(?:不要|不想|避開)(?:在)?(?:早上|上午|早八|下午|午後|晚上|夜間|傍晚)(?:的課|上課|有課)?/g, () => { r.skipped = true; });
  cut(/早上|上午|早八/g, () => r.slots.add("morning"));
  cut(/下午|午後/g, () => r.slots.add("afternoon"));
  cut(/晚上|夜間|傍晚/g, () => r.slots.add("evening"));

  // 學分：「還差 4 學分」是要湊的總學分；「2 學分的課」是每門課的學分
  cut(new RegExp("(?:還差|差|湊滿|湊|還需要|需要|還要|補滿|補|修滿|排|多修|要修|想修|推薦|建議)(?:個)?" + AS_NUM_RE + "(?:個)?學分", "g"),
      (m, n) => { r.need = asToNum(n); r.plan = true; });
  cut(new RegExp(AS_NUM_RE + "(?:個)?學分", "g"), (m, n) => { const v = asToNum(n); if (!isNaN(v)) r.credits.add(v); });

  // 類別（先比對長的詞）
  cut(/通識必修/g, () => r.kinds.add("gen-core"));
  cut(/通識選修/g, () => r.kinds.add("gen-elective"));
  cut(/專業必修|系必修|本系必修/g, () => r.kinds.add("core"));
  cut(/專業選修|系選修|本系選修/g, () => r.kinds.add("elective"));
  cut(/通識/g, () => { r.kinds.add("gen-core"); r.kinds.add("gen-elective"); });
  cut(/必修/g, () => { r.kinds.add("core"); r.kinds.add("gen-core"); });
  cut(/選修/g, () => { r.kinds.add("elective"); r.kinds.add("gen-elective"); });
  cut(/專業課|專業/g, () => { r.kinds.add("core"); r.kinds.add("elective"); });

  // 年級
  cut(/大([一二三四])/g, (m, a) => r.grades.add(AS_DAY[a]));
  cut(/([一二三四1-4])年級/g, (m, a) => r.grades.add(/\d/.test(a) ? Number(a) : AS_DAY[a]));

  // 剩下的字當關鍵字（課名或老師）
  t = t.replace(/有沒有|有哪些|有什麼|什麼|哪些|哪幾門|幾門|可以|幫我|幫忙|請問|請|給我|列出|找一下|找找|搜尋|查詢|查一下|推薦|建議|排課|組合|搭配|一下|我想要修|我想要上|我想修|我想上|我要修|我要上|想要修|想要上|想要|想上|想修|我想|我要|我還|還有|還差|湊滿|修滿|補滿|上課|的課|課程|老師的|老師|教授|開的|一些|^查|^找|我|課|嗎|呢|吧|啊|的|在|還|跟/g, " ");
  const words = t.split(/\s+/).filter(w => w.length >= 2);
  r.keyword = words.sort((a, b) => b.length - a.length)[0] || "";
  return r;
}

// 條件 → 後端查詢參數（沿用目前選的學期、系所）
function asParams(r, ctx, { withCredits = true } = {}) {
  let q = "";
  if (r.kinds.size > 0 && r.kinds.size < 4) q += `&kind=${[...r.kinds].sort().join(",")}`;
  if (r.days.size) q += `&day=${[...r.days].sort().join(",")}`;
  if (r.slots.size) q += `&slot=${[...r.slots].join(",")}`;
  if (r.noDays.size) q += `&noday=${[...r.noDays].sort().join(",")}`;
  if (r.grades.size) q += `&grade=${[...r.grades].sort().join(",")}`;
  if (withCredits && r.credits.size) q += `&credits=${[...r.credits].join(",")}`;
  if (ctx.semester) q += `&semester=${ctx.semester}`;
  if (ctx.depts.length) q += `&dept=${encodeURIComponent(ctx.depts.join(","))}`;
  return q;
}

// 「我理解的條件」標籤
function asTags(r, ctx) {
  const tags = [];
  r.days.forEach(d => tags.push(AS_DAY_NAME[d]));
  r.noDays.forEach(d => tags.push(`${AS_DAY_NAME[d]}不排課`));
  r.slots.forEach(s => tags.push(AS_SLOT_NAME[s]));
  r.credits.forEach(c => tags.push(`每門 ${c} 學分`));
  if (r.kinds.size > 0 && r.kinds.size < 4) {
    const k = r.kinds;
    if (k.size === 2 && k.has("gen-core") && k.has("gen-elective")) tags.push("通識");
    else if (k.size === 2 && k.has("core") && k.has("elective")) tags.push("專業課");
    else if (k.size === 2 && k.has("core") && k.has("gen-core")) tags.push("必修");
    else if (k.size === 2 && k.has("elective") && k.has("gen-elective")) tags.push("選修");
    else k.forEach(x => tags.push(AS_KIND_NAME[x]));
  }
  r.grades.forEach(g => tags.push(`${g} 年級`));
  if (r.keyword) tags.push(`關鍵字「${r.keyword}」`);
  if (r.need) tags.push(`湊滿 ${r.need} 學分`);
  if (r.skipped) tags.push("（排除時段目前不支援，已略過）");
  if (ctx.depts.length) tags.push(`系所：${ctx.depts.map(c => DEPT_MAP[c] || c).join("、")}`);
  return tags;
}

async function asFetch(r, pageSize, ctx, opts) {
  const base = r.keyword ? `/api/courses/search?q=${encodeURIComponent(r.keyword)}&` : "/api/courses?";
  const data = await apiFetch(`${base}page=1&pageSize=${pageSize}${asParams(r, ctx, opts)}`);
  return { total: data.total ?? 0, items: (data.items || []).map(normalizeCourseFromApi) };
}

// 找課
async function asSearch(r, ctx) {
  const SHOW = 6;
  const { total, items } = await asFetch(r, SHOW, ctx);
  const onlyKeyword = r.keyword && !(r.days.size || r.noDays.size || r.slots.size || r.credits.size || r.kinds.size || r.grades.size);
  return { kind: "search", tags: asTags(r, ctx), total, items, show: SHOW, onlyKeyword, keyword: r.keyword };
}

// 排課推薦：找出不衝堂、剛好湊滿 need 學分的組合
async function asPlan(r, ctx) {
  const need = r.need;
  const selected = ctx.selected;
  const { items } = await asFetch(r, 200, ctx, { withCredits: true });
  const names = new Set(selected.map(c => c.name));
  const seen = new Set();
  const cand = items.filter(c => {
    if (!(c.credit > 0 && c.credit <= need)) return false;
    if (!c.time.length) return false;                        // 沒有上課時間的課無法檢查衝堂
    if (selected.some(x => x.id === c.id)) return false;
    if (names.has(c.name) || seen.has(c.name)) return false; // 同名的課只留一班
    if (hasTimeConflict(c, selected)) return false;          // 跟目前課表衝堂
    seen.add(c.name);
    return true;
  }).sort((a, b) => b.credit - a.credit).slice(0, 60);

  const result = { kind: "plan", tags: asTags(r, ctx), need, cand: [], plans: [], totalPlans: 0 };
  if (cand.length === 0) return result;

  // 深度優先搜尋，最多 4 門課；找到的方案依「門數少、上課天數少」排序
  const plans = [];
  let steps = 0;
  const pick = [];
  (function dfs(start, sum) {
    if (++steps > 40000 || plans.length >= 300) return;
    if (sum === need) { plans.push([...pick]); return; }
    if (pick.length >= 4) return;
    for (let i = start; i < cand.length; i++) {
      const c = cand[i];
      if (sum + c.credit > need) continue;
      if (pick.some(p => coursesOverlap(p, c))) continue;
      pick.push(c); dfs(i + 1, sum + c.credit); pick.pop();
    }
  })(0, 0);

  if (plans.length === 0) { result.cand = cand.slice(0, 5); return result; }

  const daysOf = p => new Set(p.flatMap(c => c.time.map(t => t.day)));
  plans.sort((a, b) => a.length - b.length || daysOf(a).size - daysOf(b).size);
  const chosen = [];
  for (const p of plans) {   // 盡量挑彼此不同課的方案
    if (chosen.length >= 3) break;
    if (chosen.every(q => p.filter(c => q.includes(c)).length < p.length)) chosen.push(p);
  }
  result.totalPlans = plans.length;
  result.plans = chosen.map(p => ({ courses: p, days: [...daysOf(p)].sort().map(d => AS_DAY_NAME[d]).join("、") }));
  return result;
}

// ===== 興趣導向推薦 =====
//   詞庫：每個目標有「別名」（學生會怎麼說）、「強相關詞」「弱相關詞」（課名裡會出現的字）
const REC_TOPICS = [
  { name: "程式能力", alias: ["程式", "寫程式", "coding", "code", "軟體開發", "工程師", "開發能力", "寫code"],
    strong: ["程式", "物件導向", "軟體", "演算法", "資料結構", "網頁", "Python", "Java", "資料庫", "系統分析", "系統規劃", "數位訊號"],
    weak: ["資訊", "電腦", "人工智慧", "網路", "統計套裝", "R語言", "SAS", "開放軟體", "數位"] },
  { name: "資料分析", alias: ["資料分析", "數據", "大數據", "數據分析", "統計", "data", "分析能力"],
    strong: ["資料分析", "巨量資料", "統計", "R語言", "SAS", "資料處理", "預測分析", "多變量", "資料庫"],
    weak: ["資料", "研究方法", "調查研究", "量性研究", "流行病學"] },
  { name: "人工智慧", alias: ["AI", "人工智慧", "機器學習", "深度學習", "智慧科技"],
    strong: ["人工智慧", "智慧", "機器學習"], weak: ["巨量資料", "程式", "資訊科技", "數位"] },
  { name: "網頁與網路", alias: ["網頁", "網站", "前端", "後端", "網路", "全端"],
    strong: ["網頁", "網路程式", "網路", "電子商務"], weak: ["多媒體", "數位", "資訊"] },
  { name: "資訊安全", alias: ["資安", "資訊安全", "駭客", "網路安全"],
    strong: ["資訊安全"], weak: ["網路", "資訊"] },
  { name: "資訊系統與醫療資訊", alias: ["資訊系統", "醫療資訊", "系統分析", "資訊管理", "資訊科技"],
    strong: ["資訊系統", "醫療資訊", "醫院電腦化", "資訊管理", "系統分析", "資訊科技", "知識管理", "護理資訊"],
    weak: ["資訊", "專案管理", "電子商務"] },
  { name: "管理與創業", alias: ["管理", "創業", "經營", "當老闆", "領導", "管理能力"],
    strong: ["管理", "創業", "策略", "經營", "組織", "專案"], weak: ["財務", "會計", "品質", "行銷", "決策"] },
  { name: "行銷", alias: ["行銷", "廣告", "品牌", "電商", "銷售", "業務"],
    strong: ["行銷", "顧客關係", "電子商務", "產品設計", "服務創新"], weak: ["管理", "創意"] },
  { name: "財務會計", alias: ["會計", "財務", "理財", "經濟", "金融", "財會"],
    strong: ["會計", "財務", "成本", "經濟"], weak: ["管理", "保險"] },
  { name: "健康照護", alias: ["醫療", "健康", "護理", "照護", "臨床", "醫院"],
    strong: ["健康照護", "醫療", "護理", "照護", "健康"], weak: ["臨床", "病", "醫"] },
  { name: "心理與諮商", alias: ["心理", "諮商", "情緒", "壓力", "療癒", "輔導"],
    strong: ["心理", "諮商", "情緒", "壓力", "輔導", "悲傷"], weak: ["溝通", "治療", "生死"] },
  { name: "外語能力", alias: ["英文", "英語", "外語", "語言能力", "多益", "日文", "日語", "口說", "托福"],
    strong: ["英文", "英語", "日語", "台語"], weak: ["簡報", "寫作", "國際"] },
  { name: "運動健身", alias: ["運動", "健身", "體能", "瑜珈", "重訓", "球類"],
    strong: ["運動", "體適能", "瑜珈", "肌力", "體育", "球", "游泳", "皮拉提斯", "有氧"], weak: ["健康", "身體活動"] },
  { name: "藝術人文", alias: ["藝術", "音樂", "美術", "文化", "電影", "人文", "文學", "美學"],
    strong: ["藝術", "音樂", "美學", "文化", "電影", "文學", "戲劇", "影像", "哲學", "文明"], weak: ["創意", "生活"] },
  { name: "多媒體設計", alias: ["平面設計", "視覺設計", "剪輯", "影片", "動畫", "多媒體", "美編", "影音"],
    strong: ["多媒體", "影音", "動畫", "剪輯", "電子書", "腳本", "網頁設計"], weak: ["設計", "數位", "媒體"] },
  { name: "研究與升學", alias: ["研究所", "升學", "論文", "做研究", "讀研究所", "考研"],
    strong: ["研究方法", "研究概論", "統計", "文獻", "論文", "量性研究"], weak: ["研究", "專題"] },
  { name: "就業與實習", alias: ["就業", "找工作", "實習", "職涯", "職場", "工作經驗"],
    strong: ["實習", "職場", "生涯", "見習"], weak: ["實務", "專題", "創業"] },
  { name: "高齡與長照", alias: ["長照", "老人", "高齡", "銀髮", "失智", "長期照護"],
    strong: ["高齡", "老人", "長期照護", "銀髮", "失智", "老化"], weak: ["照護", "安寧"] },
  { name: "觀光休閒", alias: ["觀光", "旅遊", "休閒", "餐飲", "導遊", "飯店"],
    strong: ["觀光", "旅遊", "休閒", "遊憩", "餐飲", "民宿", "領隊"], weak: ["服務", "文化"] },
];
// 系所簡稱（「資管系」「我是資管」）
const REC_DEPT_ABBR = { "資管": "資訊管理", "健管": "健康事業管理", "長照": "長期照護", "語聽": "語言治療與聽力", "休閒": "休閒產業與健康促進",
  "運保": "運動保健", "生諮": "生死與健康心理諮商", "幼保": "嬰幼兒保育", "高照": "高齡健康照護", "醫教": "醫護教育", "護理": "護理" };

// 全學期課程的暫存（推薦要看全部課程，同一學期只抓一次）
let recCache = { semester: null, items: null };
export function clearRecCache() { recCache = { semester: null, items: null }; }

// 讀出背景（系所、年級）與目標（興趣主題、想學的關鍵字）
export function recParseProfile(text) {
  const t = String(text || "").replace(/\s+/g, "");
  const prof = { deptCodes: [], deptName: "", grade: 0, topics: [], words: [], phrases: [], intent: false };

  // 系所：比對系所全名（去掉「四年制」等字），或簡稱＋系
  const cores = Object.entries(DEPT_MAP).map(([code, name]) => [code, name, name.replace(/^(四年制|二年制|進修部)/, "").replace(/\(.*\)$/, "")]);
  for (const [code, name, core] of cores) {
    const base = core.replace(/系$/, "");
    if (base.length >= 2 && (t.includes(core) || t.includes(base + "系"))) {
      const preferFour = !/二技|二年制|進修/.test(t);
      if (!preferFour || /四年制/.test(name) || !cores.some(([, n2, c2]) => c2 === core && /四年制/.test(n2))) {
        if (!prof.deptCodes.includes(code)) prof.deptCodes.push(code);
        prof.deptName = prof.deptName || core;
      }
    }
  }
  if (prof.deptCodes.length === 0) {
    for (const [abbr, full] of Object.entries(REC_DEPT_ABBR)) {
      if (new RegExp(abbr + "(系|[一二三四]年級|大[一二三四]|的學生)|(我是|我讀|就讀)" + abbr).test(t)) {
        const hit = cores.filter(([, , core]) => core.startsWith(full));
        const four = hit.filter(([, n]) => /四年制/.test(n));
        (four.length ? four : hit).forEach(([code, , core]) => { prof.deptCodes.push(code); prof.deptName = prof.deptName || core; });
        if (prof.deptCodes.length) break;
      }
    }
  }

  // 年級
  const g = t.match(/大([一二三四])|([一二三四1-4])年級/);
  if (g) prof.grade = g[1] ? AS_DAY[g[1]] : (/\d/.test(g[2]) ? Number(g[2]) : AS_DAY[g[2]]);

  // 目標：「想加強 X」「對 X 有興趣」……
  const wants = [];
  for (const m of t.matchAll(/(?:增進|加強|提升|培養|精進|學習|想學|多學|往|朝|走|進入|從事|想當|成為|補強)(?:我的|一些|一點|更多)?([^，,。！!？?；;、]{2,14})/g)) wants.push(m[1]);
  for (const m of t.matchAll(/對([^，,。！!？?]{2,12})(?:很|比較|有點)?(?:有興趣|感興趣|好奇)/g)) wants.push(m[1]);
  for (const m of t.matchAll(/(?:興趣是|目標是|喜歡)([^，,。！!？?]{2,12})/g)) wants.push(m[1]);
  prof.intent = wants.length > 0 || /推薦|適合我|建議我|該修|要修什麼|修什麼/.test(t);

  // 比對興趣前，先把系所名稱拿掉（「資訊管理系」不代表想學「管理」）
  let rest = t;
  if (prof.deptName) rest = rest.split(prof.deptName).join(" ").split(prof.deptName.replace(/系$/, "")).join(" ");
  for (const abbr of Object.keys(REC_DEPT_ABBR)) rest = rest.replace(new RegExp(abbr + "系"), " ");
  const lower = rest.toLowerCase();
  for (const topic of REC_TOPICS) {
    if (topic.alias.some(a => lower.includes(a.toLowerCase()))) prof.topics.push(topic);
  }
  // 詞庫沒有的目標（例如「想學中醫」）→ 直接當關鍵字比對課名
  for (let w of wants) {
    w = w.replace(/(的)?(能力|方面|領域|相關|的課|課程|技能|知識|技術|專業|發展)+$/, "").replace(/^(的|有關|關於)/, "");
    if (w.length >= 2) prof.phrases.push(w);   // 原句裡想學的詞，課名直接出現會再加分
    if (w.length >= 2 && !prof.topics.some(tp => tp.alias.some(a => w.toLowerCase().includes(a.toLowerCase())))) prof.words.push(w);
  }
  return prof;
}

async function recLoadAll(semester) {
  const sem = semester || "";
  if (recCache.items && recCache.semester === sem) return recCache.items;
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const data = await apiFetch(`/api/courses?page=${page}&pageSize=200${sem ? `&semester=${sem}` : ""}`);
    all.push(...(data.items || []));
    if (page >= (data.totalPages || 1)) break;
  }
  recCache = {
    semester: sem,
    items: all.map(c => ({ ...normalizeCourseFromApi(c), required: c.required, isGeneral: c.type === "general", gradeNum: Number(c.grade) || 0 })),
  };
  return recCache.items;
}

// 幫一門課打分數，並記下理由
export function recScore(c, prof, selected = []) {
  let score = 0;
  const reasons = [];
  const name = c.name.toLowerCase();

  // 1. 課名相關度
  const hitWords = [];
  for (const tp of prof.topics) {
    const s = tp.strong.filter(w => name.includes(w.toLowerCase()));
    const w = tp.weak.filter(x => name.includes(x.toLowerCase()) && !s.some(y => y.includes(x)));
    if (s.length || w.length) {
      score += (s.length ? 6 + (s.length > 1 ? 2 : 0) : 0) + Math.min(w.length, 2) * 2;
      hitWords.push({ topic: tp.name, words: [...s, ...w] });
    }
  }
  for (const word of prof.words) {
    if (name.includes(word.toLowerCase())) { score += 8; hitWords.push({ topic: word, words: [word] }); }
  }
  if (score === 0) return null;   // 跟目標無關的課不推
  hitWords.forEach(h => reasons.push(`課名有「${h.words.slice(0, 2).join("、")}」，和你想加強的「${h.topic}」相關`));
  const phrase = prof.phrases.find(ph => ph.length >= 2 && name.includes(ph.toLowerCase()) && !prof.words.includes(ph));
  if (phrase) {
    score += 5;
    if (!hitWords.some(h => h.words.includes(phrase))) reasons.unshift(`課名直接包含你說的「${phrase}」`);
  }

  // 2. 系所
  if (prof.deptCodes.length) {
    if (prof.deptCodes.includes(c.deptCode)) { score += 3; reasons.push(`${c.dept}開課（本系）`); }
    else if (c.isGeneral) { score += 1; reasons.push("通識課，各系都能修"); }
    else { score -= 1; reasons.push(`外系課（${c.dept}），要確認能否跨系選修`); }
  } else if (c.isGeneral) {
    reasons.push("通識課，各系都能修");
  }

  // 3. 年級
  if (prof.grade && c.gradeNum) {
    if (c.gradeNum === prof.grade) { score += 2; reasons.push(`建議 ${c.gradeNum} 年級修，正適合你`); }
    else if (c.gradeNum === prof.grade + 1) { score += 1; reasons.push(`${c.gradeNum} 年級的課，可以提早修`); }
    else if (c.gradeNum < prof.grade) { score += c.required ? -5 : 0; reasons.push(c.required ? `${c.gradeNum} 年級必修，你可能已經修過` : `${c.gradeNum} 年級就能修的選修`); }
    else { score -= 1; reasons.push(`${c.gradeNum} 年級的課，難度可能較高`); }
  }

  // 4. 選修（自己選的空間）／必修
  if (!c.required) score += 1;
  reasons.push(`${courseTypeLabel(c)}・${c.credit} 學分`);

  // 5. 跟目前課表衝堂嗎
  if (!c.time.length) reasons.push("沒有上課時間資料");
  else if (hasTimeConflict(c, selected)) { score -= 3; reasons.push("⚠ 跟你目前的課表衝堂"); }
  else reasons.push("跟你目前的課表不衝堂");

  return { score, reasons };
}

async function recRecommend(prof, ctx) {
  const items = await recLoadAll(ctx.semester);
  const picked = new Map();   // 同名的課只留分數最高的一班
  for (const c of items) {
    if (ctx.selected.some(x => x.id === c.id)) continue;
    const r = recScore(c, prof, ctx.selected);
    if (!r) continue;
    const old = picked.get(c.name);
    if (!old || r.score > old.score) picked.set(c.name, { c, ...r });
  }
  const list = [...picked.values()].sort((a, b) => b.score - a.score || a.c.gradeNum - b.c.gradeNum);

  const tags = [];
  if (prof.deptName) tags.push(`系所：${prof.deptName}`);
  if (prof.grade) tags.push(`${prof.grade} 年級`);
  prof.topics.forEach(tp => tags.push(`目標：${tp.name}`));
  prof.words.forEach(w => tags.push(`想學：${w}`));

  const top = list.slice(0, 5);
  const best = top[0]?.score || 1;
  return {
    kind: "rec", tags, poolSize: items.length, count: list.length,
    top: top.map(x => ({ course: x.c, reasons: x.reasons, stars: Math.max(1, Math.min(5, Math.round((x.score / best) * 5))) })),
  };
}

// 判斷這句話是要推薦、排課還是找課，回傳結果資料（畫面由 SmartResult 元件負責）
//   ctx = { semester, depts, selected }
export async function asAnswer(text, ctx) {
  const r = asParse(text);
  const prof = recParseProfile(text);
  const hasCond = r.days.size || r.noDays.size || r.slots.size || r.credits.size || r.kinds.size || r.grades.size || r.keyword;
  if (r.plan && r.need > 0) return asPlan(r, ctx);
  if (prof.topics.length || (prof.intent && prof.words.length)) return recRecommend(prof, ctx);
  if (r.plan && !r.need) return { kind: "askNeed" };
  if (!hasCond) return { kind: "help", prefix: "抱歉，這句我看不太懂 🙏" };
  return asSearch(r, ctx);
}
