/* ============================================================
   SAT MATH PREP — ENGINE + UI
   - localStorage persistence (per device)
   - Elo mastery per skill + per domain
   - Live adaptive question selection (your answer drives the next)
   - Spaced-repetition error log
   - Estimated score + streaks + progress
   ============================================================ */
// DOMAINS, OFFICIAL_RESOURCES, CURRICULUM, DESMOS_TIPS, QUESTIONS are declared as
// top-level consts in data.js (loaded first) and are in scope here. Do NOT redeclare
// them — two `const`s of the same name in the shared global script scope is a SyntaxError.

const STORE_KEY = "satmath_state_v1";
const DAY = 864e5;
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ---------- difficulty <-> Elo rating mapping ---------- */
const DIFF_RATING = { 1: 900, 2: 1050, 3: 1200, 4: 1350, 5: 1500 };
const START_RATING = 1150;
const K = 28;

/* ---------- state ---------- */
function freshState() {
  const skills = {};
  QUESTIONS.forEach(q => { if (!skills[q.skill]) skills[q.skill] = { rating: START_RATING, n: 0, domain: q.domain }; });
  return {
    created: todayStr(),
    skills,
    seen: {},          // qid -> { lastSeen, correctCount, attempts }
    errorLog: {},      // qid -> { due, interval, lapses }
    history: [],       // { date, qid, correct, diff, domain }
    streakDays: 0,
    lastActiveDate: null,
    sessionLevel: 2,
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!s) return freshState();
    // make sure any newly-added skills exist
    QUESTIONS.forEach(q => { if (!s.skills[q.skill]) s.skills[q.skill] = { rating: START_RATING, n: 0, domain: q.domain }; });
    return s;
  } catch { return freshState(); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
let S = load();

/* ---------- mastery math ---------- */
function expected(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function recordAnswer(q, correct) {
  const sk = S.skills[q.skill];
  const qr = DIFF_RATING[q.diff];
  const exp = expected(sk.rating, qr);
  sk.rating += K * ((correct ? 1 : 0) - exp);
  sk.n += 1;

  const seen = S.seen[q.id] || { correctCount: 0, attempts: 0 };
  seen.attempts += 1;
  if (correct) seen.correctCount += 1;
  seen.lastSeen = todayStr();
  S.seen[q.id] = seen;

  // spaced repetition (SM-2 lite)
  if (!correct) {
    S.errorLog[q.id] = { due: Date.now() + DAY, interval: 1, lapses: ((S.errorLog[q.id] || {}).lapses || 0) + 1 };
  } else if (S.errorLog[q.id]) {
    const e = S.errorLog[q.id];
    e.interval = Math.min(Math.round(e.interval * 2.2) + 1, 30);
    e.due = Date.now() + e.interval * DAY;
    if (seen.correctCount >= seen.attempts && e.interval >= 14) delete S.errorLog[q.id]; // graduated
  }

  S.history.push({ date: todayStr(), qid: q.id, correct, diff: q.diff, domain: q.domain });

  // streak (calendar days active)
  const t = todayStr();
  if (S.lastActiveDate !== t) {
    const wasYesterday = S.lastActiveDate === new Date(Date.now() - DAY).toISOString().slice(0, 10);
    S.streakDays = wasYesterday ? S.streakDays + 1 : 1;
    S.lastActiveDate = t;
  }
  save();
}

function domainRating(dom) {
  const rs = Object.values(S.skills).filter(s => s.domain === dom);
  if (!rs.length) return START_RATING;
  return rs.reduce((a, s) => a + s.rating, 0) / rs.length;
}
function overallRating() {
  // weight domains by their SAT weight
  let sum = 0, w = 0;
  for (const d in DOMAINS) { sum += domainRating(d) * DOMAINS[d].weight; w += DOMAINS[d].weight; }
  return sum / w;
}
function estScore() {
  const r = overallRating();
  let sc = 620 + (r - 1200) * 0.45;
  sc = Math.max(200, Math.min(800, sc));
  return Math.round(sc / 10) * 10;
}

/* ---------- adaptive selection ---------- */
function dueReviewIds() {
  const now = Date.now();
  return Object.keys(S.errorLog).filter(id => S.errorLog[id].due <= now);
}
function weakestDomains() {
  return Object.keys(DOMAINS).sort((a, b) => domainRating(a) - domainRating(b));
}
// pick the next question given a target difficulty and what we've served this session
function pickQuestion(targetDiff, servedIds, preferReview, forceDomain) {
  const pool = QUESTIONS.filter(q => !servedIds.includes(q.id));
  if (!pool.length) return null;

  // 1) due review item near the target difficulty
  if (preferReview) {
    const due = dueReviewIds().filter(id => !servedIds.includes(id));
    if (due.length) {
      const byClose = due.map(id => QUESTIONS.find(q => q.id === id)).filter(Boolean)
        .sort((a, b) => Math.abs(a.diff - targetDiff) - Math.abs(b.diff - targetDiff));
      if (byClose.length) return byClose[0];
    }
  }

  const weak = weakestDomains();
  const scored = pool.map(q => {
    let score = 0;
    score -= Math.abs(q.diff - targetDiff) * 3;                 // closeness to target difficulty
    score += (4 - weak.indexOf(q.domain)) * 1.5;                // favor weak domains
    if (forceDomain && q.domain === forceDomain) score += 6;
    const seen = S.seen[q.id];
    if (seen) {                                                  // de-prioritize recently seen
      const days = (Date.now() - new Date(seen.lastSeen).getTime()) / DAY;
      score -= Math.max(0, 6 - days);
      if (seen.correctCount >= 2 && seen.attempts === seen.correctCount) score -= 4; // mastered already
    }
    score += (q.id.charCodeAt(1) % 5) * 0.2;                    // tiny deterministic tiebreak variety
    return { q, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0].q;
}

/* ---------- session controller ---------- */
// Daily session shape for an 800-hunter: warm-up easy → adaptive core → hard challenge.
function buildSessionPlan() {
  // [targetDiff, preferReview] per slot. Core difficulty floats with sessionLevel.
  const lvl = S.sessionLevel;
  return [
    { phase: "Warm-up", diff: 1, review: false },
    { phase: "Warm-up", diff: 2, review: false },
    { phase: "Core",    diff: Math.min(5, Math.max(2, lvl)), review: true },
    { phase: "Core",    diff: Math.min(5, Math.max(2, lvl)), review: true },
    { phase: "Core",    diff: Math.min(5, Math.max(3, lvl + 1)), review: false },
    { phase: "Core",    diff: Math.min(5, Math.max(3, lvl + 1)), review: true },
    { phase: "Challenge", diff: 4, review: false },
    { phase: "Challenge", diff: 5, review: false },
  ];
}

let session = null; // { plan, idx, served, results, started }
function startSession() {
  session = { plan: buildSessionPlan(), idx: 0, served: [], results: [], started: Date.now(), streakRun: 0 };
  renderQuestion();
}
function currentQuestion() {
  if (!session) return null;
  const slot = session.plan[session.idx];
  if (!slot) return null;
  if (!slot._q) {
    slot._q = pickQuestion(slot.diff, session.served, slot.review);
    if (slot._q) session.served.push(slot._q.id);
  }
  return slot._q;
}
function answerCurrent(userAns) {
  const q = currentQuestion();
  if (!q) return;
  const correct = isCorrect(q, userAns);
  recordAnswer(q, correct);
  session.results.push({ q, correct, userAns });

  // live within-session adaptivity: 2 right in a row → harder; a miss → easier
  if (correct) { session.streakRun++; if (session.streakRun >= 2) { S.sessionLevel = Math.min(5, S.sessionLevel + 1); session.streakRun = 0; } }
  else { session.streakRun = 0; S.sessionLevel = Math.max(1, S.sessionLevel - 1); }
  save();
  return correct;
}
function isCorrect(q, userAns) {
  if (q.format === "mc") return userAns === q.answer;
  const norm = v => String(v).trim().replace(/\s+/g, "").replace(/^\+/, "");
  // accept fraction/decimal equivalence for grid-ins
  const a = norm(q.answer), b = norm(userAns);
  if (a === b) return true;
  const toNum = s => { if (s.includes("/")) { const [p, r] = s.split("/").map(Number); return p / r; } return Number(s); };
  const na = toNum(a), nb = toNum(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-6;
}

/* =====================================================================
   UI
   ===================================================================== */
const app = document.getElementById("app");
let activeTab = "today";

function setTab(t) { activeTab = t; render(); }

function render() {
  app.innerHTML = "";
  if (mock && !mock.done) { renderMockView(); renderNav(); return; }
  if (mock && mock.done) { renderMockResults(); renderNav(); return; }
  if (activeTab === "today") renderToday();
  else if (activeTab === "practice") renderPractice();
  else if (activeTab === "desmos") renderDesmos();
  else if (activeTab === "progress") renderProgress();
  else if (activeTab === "plan") renderPlan();
  renderNav();
}

function renderNav() {
  const nav = document.getElementById("nav");
  const tabs = [["today", "📅", "Today"], ["practice", "✏️", "Practice"], ["desmos", "📈", "Desmos"], ["progress", "📊", "Progress"], ["plan", "🗺️", "Plan"]];
  nav.innerHTML = tabs.map(([id, icon, label]) =>
    `<button class="${activeTab === id ? "active" : ""}" onclick="setTab('${id}')"><span class="ni">${icon}</span><span class="nl">${label}</span></button>`).join("");
}

function card(inner, cls = "") { return `<div class="card ${cls}">${inner}</div>`; }

/* ---------- TODAY ---------- */
function renderToday() {
  const score = estScore();
  const due = dueReviewIds().length;
  const doneToday = S.history.filter(h => h.date === todayStr()).length;
  const week = Math.min(8, Math.floor((Date.now() - new Date(S.created).getTime()) / (7 * DAY)) + 1);
  const wk = CURRICULUM[week - 1];

  if (session && session.idx < session.plan.length) { renderQuestion(); return; }
  if (session && session.idx >= session.plan.length) { renderSummary(); return; }

  app.innerHTML = `
    ${card(`<div class="hero">
      <div><div class="hero-label">Estimated SAT Math</div><div class="hero-score">${score}</div></div>
      <div class="hero-stats">
        <div><b>${S.streakDays}</b><span>day streak</span></div>
        <div><b>${doneToday}</b><span>done today</span></div>
        <div><b>${due}</b><span>to review</span></div>
      </div>
    </div>`, "hero-card")}

    ${card(`<div class="row-between">
      <div><div class="muted small">Week ${week} of 8</div><h2 style="margin:.2em 0">${wk.title}</h2><div class="muted">${wk.goal}</div></div>
    </div>
    <button class="big-btn" onclick="startSession()">Start today's adaptive set →</button>
    <div class="muted small center">8 questions · warm-up → adaptive core → challenge · auto-mixes your weak spots & review queue</div>
    <button class="big-btn ghost" onclick="startMock()">🧪 Full module-adaptive mock (44 Q · 70 min)</button>
    <div class="muted small center">Simulates the real 2-module routing & scoring. Do one weekly.</div>`)}

    ${due ? card(`<b>🔁 ${due} review ${due === 1 ? "question" : "questions"} due.</b> They're folded into today's set automatically (spaced repetition on everything you've missed).`, "accent") : ""}

    ${card(`<b>How this works</b>
      <ul class="tips">
        <li>Each answer updates your per-skill mastery and picks the <b>next</b> question — get 2 right and it gets harder; miss one and it eases off.</li>
        <li>Missed questions enter a <b>spaced-repetition queue</b> and resurface until you've truly got them (key for 800).</li>
        <li>Tap <b>📈 Desmos</b> for the shortcut playbook — your biggest score lever.</li>
      </ul>`)}
  `;
}

/* ---------- QUESTION VIEW ---------- */
let revealed = false, pickedMC = null;
function renderQuestion() {
  const q = currentQuestion();
  if (!q) { renderSummary(); return; }
  revealed = false; pickedMC = null;
  const slot = session.plan[session.idx];
  const num = session.idx + 1, total = session.plan.length;
  const typeBadge = { mental: "🧠 Mental", work: "✍️ Show work", desmos: "📈 Desmos" }[q.type];

  app.innerHTML = `
    ${card(`
      <div class="q-top">
        <span class="pill">${slot.phase}</span>
        <span class="pill ghost">${DOMAINS[q.domain].name}</span>
        <span class="pill ghost">${typeBadge}</span>
        <span class="pill ghost">Difficulty ${q.diff}/5</span>
        <span class="q-count">${num}/${total}</span>
      </div>
      <div class="stem">${q.stem}</div>
      <div id="answer-area"></div>
      <div id="feedback"></div>
    `)}
  `;
  const area = document.getElementById("answer-area");
  if (q.format === "mc") {
    area.innerHTML = `<div class="choices">${q.choices.map((c, i) =>
      `<button class="choice" id="ch${i}" onclick="pickMC(${i})">${String.fromCharCode(65 + i)}. ${c}</button>`).join("")}</div>
      <button class="big-btn" id="submit" onclick="submitAnswer()" disabled>Submit</button>`;
  } else {
    area.innerHTML = `<div class="grid-in">
      <input id="gridInput" inputmode="text" autocomplete="off" placeholder="Type your answer (e.g. 6 or 3/4)" onkeydown="if(event.key==='Enter')submitAnswer()" />
      </div><button class="big-btn" id="submit" onclick="submitAnswer()">Submit</button>`;
    setTimeout(() => document.getElementById("gridInput")?.focus(), 50);
  }
}
function pickMC(i) {
  pickedMC = i;
  document.querySelectorAll(".choice").forEach((b, idx) => b.classList.toggle("picked", idx === i));
  document.getElementById("submit").disabled = false;
}
function submitAnswer() {
  if (revealed) { session.idx++; render(); return; }
  const q = currentQuestion();
  let userAns;
  if (q.format === "mc") { if (pickedMC === null) return; userAns = pickedMC; }
  else { userAns = document.getElementById("gridInput").value; if (!userAns.trim()) return; }

  const correct = answerCurrent(userAns);
  revealed = true;
  // mark choices
  if (q.format === "mc") {
    document.querySelectorAll(".choice").forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) b.classList.add("correct");
      if (idx === pickedMC && idx !== q.answer) b.classList.add("wrong");
    });
  }
  const ansText = q.format === "mc" ? `${String.fromCharCode(65 + q.answer)}. ${q.choices[q.answer]}` : q.answer;
  document.getElementById("feedback").innerHTML = `
    <div class="verdict ${correct ? "ok" : "no"}">${correct ? "✓ Correct" : "✗ Not quite"} — answer: <b>${ansText}</b></div>
    <div class="explain">
      <div class="ex-block"><b>Solution.</b> ${q.solution}</div>
      <div class="ex-block tip"><b>⚡ Shortcut.</b> ${q.shortcut}</div>
      ${q.desmos ? `<div class="ex-block dz"><b>📈 Desmos.</b> ${q.desmos}</div>` : ""}
    </div>`;
  document.getElementById("submit").textContent = session.idx + 1 < session.plan.length ? "Next →" : "Finish";
  document.getElementById("submit").disabled = false;
}

function renderSummary() {
  const r = session.results;
  const right = r.filter(x => x.correct).length;
  const mins = Math.max(1, Math.round((Date.now() - session.started) / 60000));
  const byDom = {};
  r.forEach(x => { (byDom[x.q.domain] = byDom[x.q.domain] || { n: 0, ok: 0 }), byDom[x.q.domain].n++, x.correct && byDom[x.q.domain].ok++; });
  const misses = r.filter(x => !x.correct);
  app.innerHTML = `
    ${card(`<h2>Session complete 🎯</h2>
      <div class="hero-stats big">
        <div><b>${right}/${r.length}</b><span>correct</span></div>
        <div><b>${mins}m</b><span>time</span></div>
        <div><b>${estScore()}</b><span>est. score</span></div>
      </div>`)}
    ${card(`<b>By domain</b>${Object.keys(byDom).map(d =>
      `<div class="row-between barline"><span>${DOMAINS[d].name}</span><span class="muted">${byDom[d].ok}/${byDom[d].n}</span></div>`).join("")}`)}
    ${misses.length ? card(`<b>↩ Added to your review queue (${misses.length})</b>
      <div class="muted small">These come back on a spaced schedule until mastered.</div>
      <ul class="tips">${misses.map(m => `<li>${DOMAINS[m.q.domain].name}: ${m.q.skill.replace(/-/g, " ")}</li>`).join("")}</ul>`, "accent")
      : card(`<b>Clean sweep — no misses!</b> 💪`, "accent")}
    <button class="big-btn" onclick="session=null;setTab('today')">Done</button>
    <button class="big-btn ghost" onclick="startSession()">Another set →</button>
  `;
}

/* ---------- PRACTICE (focused by domain) ---------- */
function renderPractice() {
  app.innerHTML = `${card(`<h2>Focused practice</h2><div class="muted">Drill a single domain. Same adaptive engine, same review queue.</div>
    <div class="dom-grid">${Object.keys(DOMAINS).map(d => {
      const rt = Math.round(domainRating(d));
      const pct = Math.max(4, Math.min(100, ((rt - 800) / 800) * 100));
      return `<button class="dom-btn" onclick="startFocused('${d}')">
        <div class="dom-name">${DOMAINS[d].name}</div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        <div class="muted small">mastery ${rt}</div></button>`;
    }).join("")}</div>`)}
    ${card(`<b>Official practice (do these too)</b><ul class="tips">${OFFICIAL_RESOURCES.map(o =>
      `<li><a href="${o.url}" target="_blank" rel="noopener">${o.name}</a> — <span class="muted">${o.note}</span></li>`).join("")}</ul>`)}`;
}
function startFocused(dom) {
  session = { plan: [1, 2, 3, 3, 4, 5].map(diff => ({ phase: DOMAINS[dom].name, diff, review: true, _force: dom })), idx: 0, served: [], results: [], started: Date.now(), streakRun: 0 };
  // override picker to force domain
  session.plan.forEach(slot => { slot._pick = () => pickQuestion(slot.diff, session.served, slot.review, dom); });
  setTab("today");
}

/* ---------- DESMOS ---------- */
function renderDesmos() {
  app.innerHTML = `
    ${card(`<h2>📈 Desmos playbook</h2><div class="muted">The calculator is built into the test and allowed on every math question. Master these and a chunk of “hard” questions become 10-second problems.</div>`)}
    ${card(`<div id="calc" class="calc"></div><div class="muted small center">Live practice calculator — try graphing y=x^2-5x+6 and clicking the x-intercepts.</div>`)}
    ${DESMOS_TIPS.map(t => card(`<b>${t.t}</b><div class="muted">${t.d}</div>`)).join("")}
    ${card(`<b>Use the real one</b> — practice in the actual test calculator: <a href="https://www.desmos.com/testing/cb-digital-sat/graphing" target="_blank" rel="noopener">Desmos digital-SAT test mode</a>.`)}`;
  // mount Desmos if the API loaded
  if (window.Desmos) {
    try {
      const el = document.getElementById("calc");
      const c = Desmos.GraphingCalculator(el, { keypad: true, expressions: true, settingsMenu: false });
      c.setExpression({ id: "demo", latex: "y=x^2-5x+6" });
    } catch (e) {}
  } else {
    document.getElementById("calc").innerHTML = `<div class="muted center" style="padding:2em">Desmos calculator needs internet to load. <a href="https://www.desmos.com/testing/cb-digital-sat/graphing" target="_blank" rel="noopener">Open it here →</a></div>`;
  }
}

/* ---------- PROGRESS ---------- */
function renderProgress() {
  const totalAns = S.history.length;
  const right = S.history.filter(h => h.correct).length;
  const acc = totalAns ? Math.round((right / totalAns) * 100) : 0;
  const skillRows = Object.entries(S.skills).sort((a, b) => a[1].rating - b[1].rating);
  app.innerHTML = `
    ${card(`<div class="hero"><div><div class="hero-label">Estimated SAT Math</div><div class="hero-score">${estScore()}</div></div>
      <div class="hero-stats"><div><b>${totalAns}</b><span>answered</span></div><div><b>${acc}%</b><span>accuracy</span></div><div><b>${S.streakDays}</b><span>streak</span></div></div></div>`, "hero-card")}
    ${card(`<b>Domain mastery</b>${Object.keys(DOMAINS).map(d => {
      const rt = Math.round(domainRating(d));
      const pct = Math.max(4, Math.min(100, ((rt - 800) / 800) * 100));
      return `<div class="barline"><div class="row-between"><span>${DOMAINS[d].name}</span><span class="muted small">${rt}</span></div><div class="bar"><div class="fill" style="width:${pct}%"></div></div></div>`;
    }).join("")}`)}
    ${card(`<b>Weakest skills (drill these)</b><ul class="tips">${skillRows.slice(0, 6).map(([k, v]) =>
      `<li>${k.replace(/-/g, " ")} <span class="muted">— ${DOMAINS[v.domain].name}, mastery ${Math.round(v.rating)}${v.n ? `, ${v.n} attempts` : ", untested"}</span></li>`).join("")}</ul>`)}
    ${card(`<b>Review queue</b> <span class="muted">${Object.keys(S.errorLog).length} item(s), ${dueReviewIds().length} due now</span>`)}
    ${card(`<button class="big-btn ghost" onclick="if(confirm('Reset ALL progress on this device?')){localStorage.removeItem(STORE_KEY);location.reload();}">Reset progress</button>`)}`;
}

/* ---------- PLAN ---------- */
function renderPlan() {
  const week = Math.min(8, Math.floor((Date.now() - new Date(S.created).getTime()) / (7 * DAY)) + 1);
  app.innerHTML = `${card(`<h2>🗺️ 6–8 week plan</h2><div class="muted">Tuned for a 790–800 target: full coverage first, then speed and careless-error elimination. You're in <b>week ${week}</b>.</div>`)}
    ${CURRICULUM.map(w => card(`<div class="row-between"><b>Week ${w.week}: ${w.title}</b>${w.week === week ? `<span class="pill">now</span>` : ""}</div>
      <div class="muted">${w.goal}</div><div class="small muted">Focus: ${w.focus.map(f => DOMAINS[f].name).join(", ")}</div>`, w.week === week ? "accent" : ""))}
    ${card(`<b>The 800 mindset</b><ul class="tips">
      <li><b>Accuracy &gt; speed early.</b> Module 1 routing decides your ceiling — don't rush the first module.</li>
      <li><b>Every miss is a gift.</b> The review queue exists so the same mistake never costs you twice.</li>
      <li><b>Decide mental vs Desmos in 1 second.</b> That single habit saves minutes per test.</li>
      <li><b>Do full Bluebook mocks weekly</b> (link in Practice) — nothing simulates the real adaptive test like the real app.</li></ul>`)}
    ${card(`<b>🧪 Module-adaptive mock</b><div class="muted">A 2-module timed simulation that routes you to an easy or hard Module 2 based on Module 1 — and scores it with the real-style curve.</div>
      <button class="big-btn" onclick="startMock()">Start full mock (44 Q · 70 min) →</button>`)}`;
}

/* =====================================================================
   MODULE-ADAPTIVE MOCK  — simulates the real digital-SAT routing
   Module 1 (22 Q, 35 min, mixed) → routes to a HARD or EASY Module 2.
   790–800 requires the hard route AND ~0–1 total misses.
   ===================================================================== */
let mock = null, mockTimer = null;
const MOCK_PER_MODULE = 22;
const MOCK_SECONDS = 35 * 60;
const MOCK_WEIGHTS = { ALG: 8, ADV: 8, PSD: 3, GEO: 3 }; // ≈ real domain mix per module

function selectMock(diffSet, served) {
  const out = [];
  for (const dom in MOCK_WEIGHTS) {
    let pool = QUESTIONS.filter(q => q.domain === dom && diffSet.includes(q.diff) && !served.includes(q.id));
    pool.sort((a, b) => ((a.id.charCodeAt(1) * 7 + a.diff) % 11) - ((b.id.charCodeAt(1) * 7 + b.diff) % 11));
    let added = 0;
    for (const q of pool) { if (added >= MOCK_WEIGHTS[dom]) break; out.push(q); served.push(q.id); added++; }
    if (added < MOCK_WEIGHTS[dom]) { // relax difficulty if the band ran dry
      const extra = QUESTIONS.filter(q => q.domain === dom && !served.includes(q.id));
      for (const q of extra) { if (added >= MOCK_WEIGHTS[dom]) break; out.push(q); served.push(q.id); added++; }
    }
  }
  return out;
}

function startMock() {
  const served = [];
  const m1 = selectMock([2, 3, 4], served);
  mock = { module: 1, served, qs: m1, idx: 0, answers: {}, started: Date.now(),
           moduleEndsAt: Date.now() + MOCK_SECONDS * 1000, routedHard: null, done: false, allAnswered: [] };
  startMockTimer();
  setTab("today"); // render() will route to the mock view
}

function startMockTimer() {
  clearInterval(mockTimer);
  mockTimer = setInterval(() => {
    if (!mock || mock.done) { clearInterval(mockTimer); return; }
    if (Date.now() >= mock.moduleEndsAt) { finishModule(); return; }
    const el = document.getElementById("mock-timer");
    if (el) el.textContent = fmtTime(Math.max(0, Math.round((mock.moduleEndsAt - Date.now()) / 1000)));
  }, 1000);
}
function fmtTime(s) { const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; }

function renderMockView() {
  const q = mock.qs[mock.idx];
  const n = mock.idx + 1;
  const secLeft = Math.max(0, Math.round((mock.moduleEndsAt - Date.now()) / 1000));
  const saved = mock.answers[q.id];
  app.innerHTML = `
    ${card(`<div class="q-top">
        <span class="pill">Module ${mock.module}${mock.module === 2 ? (mock.routedHard ? " · hard route" : " · standard route") : ""}</span>
        <span class="pill ghost">${DOMAINS[q.domain].name}</span>
        <span class="q-count">${n}/${MOCK_PER_MODULE}</span>
        <span class="mock-clock" id="mock-timer">${fmtTime(secLeft)}</span>
      </div>
      <div class="muted small">No feedback until the test ends — just like the real thing. Desmos allowed.</div>
      <div class="stem">${q.stem}</div>
      <div id="mock-answer"></div>
      <div class="mock-nav">
        ${mock.idx > 0 ? `<button class="big-btn ghost" onclick="mockGoto(${mock.idx - 1})">← Back</button>` : ""}
        <button class="big-btn" onclick="mockNext()">${n < MOCK_PER_MODULE ? "Next →" : (mock.module === 1 ? "Finish Module 1 →" : "Finish & score →")}</button>
      </div>
      <button class="big-btn ghost small-btn" onclick="abandonMock()">Quit mock</button>`)}
  `;
  const area = document.getElementById("mock-answer");
  if (q.format === "mc") {
    area.innerHTML = `<div class="choices">${q.choices.map((c, i) =>
      `<button class="choice ${saved === i ? "picked" : ""}" onclick="mockPick('${q.id}',${i})">${String.fromCharCode(65 + i)}. ${c}</button>`).join("")}</div>`;
  } else {
    area.innerHTML = `<div class="grid-in"><input id="mockInput" inputmode="text" autocomplete="off" placeholder="Your answer" value="${saved != null ? String(saved).replace(/"/g, "&quot;") : ""}" oninput="mock.answers['${q.id}']=this.value" /></div>`;
  }
}
function mockPick(id, i) { mock.answers[id] = i; renderMockView(); }
function mockGoto(i) { saveMockInput(); mock.idx = i; renderMockView(); }
function saveMockInput() { const el = document.getElementById("mockInput"); if (el) mock.answers[mock.qs[mock.idx].id] = el.value; }
function mockNext() {
  saveMockInput();
  if (mock.idx < MOCK_PER_MODULE - 1) { mock.idx++; renderMockView(); }
  else finishModule();
}

function finishModule() {
  clearInterval(mockTimer);
  // tally this module
  mock.qs.forEach(q => mock.allAnswered.push({ q, given: mock.answers[q.id] }));
  if (mock.module === 1) {
    const correct1 = mock.qs.filter(q => isCorrect(q, mock.answers[q.id])).length;
    mock.routedHard = correct1 >= 16; // ≥16/22 routes into the hard Module 2
    const m2 = selectMock(mock.routedHard ? [4, 5] : [1, 2, 3], mock.served);
    mock.module = 2; mock.qs = m2; mock.idx = 0;
    mock.moduleEndsAt = Date.now() + MOCK_SECONDS * 1000;
    startMockTimer();
    // brief transition
    app.innerHTML = card(`<h2>Module 1 complete</h2>
      <div class="muted">You answered <b>${correct1}/22</b> correctly. ${mock.routedHard
        ? "You routed into the <b>hard Module 2</b> — the only path to 790–800. 🔓"
        : "You routed into the <b>standard Module 2</b>. Score caps around 650 here — the goal is to break into the hard module."}</div>
      <button class="big-btn" onclick="renderMockView()">Start Module 2 (35:00) →</button>`);
  } else {
    finishMock();
  }
}

function finishMock() {
  clearInterval(mockTimer);
  mock.done = true;
  // record every answer into mastery + spaced-rep
  mock.allAnswered.forEach(a => recordAnswer(a.q, isCorrect(a.q, a.given)));
  render();
}

function mockScaledScore(misses, routedHard) {
  let s = routedHard ? 800 - misses * 13 : 660 - misses * 11;
  s = routedHard ? Math.max(560, s) : Math.max(200, Math.min(660, s));
  return Math.round(s / 10) * 10;
}

function renderMockResults() {
  const ans = mock.allAnswered;
  const correct = ans.filter(a => isCorrect(a.q, a.given)).length;
  const misses = ans.length - correct;
  const score = mockScaledScore(misses, mock.routedHard);
  const byDom = {};
  ans.forEach(a => { const d = a.q.domain; byDom[d] = byDom[d] || { n: 0, ok: 0 }; byDom[d].n++; if (isCorrect(a.q, a.given)) byDom[d].ok++; });
  const missList = ans.filter(a => !isCorrect(a.q, a.given));
  app.innerHTML = `
    ${card(`<div class="hero"><div><div class="hero-label">Mock scaled score</div><div class="hero-score">${score}</div></div>
      <div class="hero-stats"><div><b>${correct}/44</b><span>correct</span></div><div><b>${mock.routedHard ? "Hard" : "Std"}</b><span>route</span></div></div></div>
      <div class="muted small">${mock.routedHard
        ? "Hard route reached. At this level every miss costs ~10–15 points — the 790–800 game is eliminating careless errors."
        : "You stayed in the standard module, which caps the score near 650. Drill the Module-1 misses below to break into the hard route next time."}</div>`, "hero-card")}
    ${card(`<b>By domain</b>${Object.keys(DOMAINS).map(d => byDom[d]
      ? `<div class="row-between barline"><span>${DOMAINS[d].name}</span><span class="muted">${byDom[d].ok}/${byDom[d].n}</span></div>` : "").join("")}`)}
    ${missList.length ? card(`<b>↩ ${missList.length} added to your review queue</b>
      <div class="muted small">Every one of these will resurface on a spaced schedule. This is the path to 800.</div>
      <ul class="tips">${missList.slice(0, 20).map(a => `<li>${DOMAINS[a.q.domain].name}: ${a.q.skill.replace(/-/g, " ")} <span class="muted">(diff ${a.q.diff})</span></li>`).join("")}</ul>`, "accent")
      : card(`<b>Perfect mock — clean sweep. 🏆</b>`, "accent")}
    <button class="big-btn" onclick="mock=null;setTab('progress')">See progress</button>
    <button class="big-btn ghost" onclick="mock=null;setTab('today')">Back to Today</button>`;
}
function abandonMock() { if (confirm("Quit this mock? Progress on it won't be scored.")) { clearInterval(mockTimer); mock = null; setTab("today"); } }

// patch currentQuestion to honor focused-mode custom picker
const _origCurrent = currentQuestion;
currentQuestion = function () {
  if (!session) return null;
  const slot = session.plan[session.idx];
  if (!slot) return null;
  if (!slot._q) { slot._q = slot._pick ? slot._pick() : pickQuestion(slot.diff, session.served, slot.review); if (slot._q) session.served.push(slot._q.id); }
  return slot._q;
};

// expose for inline handlers
Object.assign(window, { setTab, startSession, startFocused, pickMC, submitAnswer, STORE_KEY,
  startMock, mockPick, mockNext, mockGoto, mockGotoSafe: mockGoto, abandonMock, renderMockView });
render();
