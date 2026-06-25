# Daily Coach — question generation spec

Task: append fresh, high-quality, SAT-style math questions to the `QUESTIONS` array in
`~/sat-math-prep/data.js`. Then verify the file still passes the structural check.

## 0. Read the student's live progress first
Before generating, fetch the latest on-device progress the app pushed to its private topic:
```bash
curl -s "https://ntfy.sh/satmath-progress-99bef57af356c412bc146ee642a84e83/json?poll=1&since=12h" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const line=(s.trim().split("\n").pop()||"");try{console.log(JSON.stringify(JSON.parse(JSON.parse(line).message),null,2))}catch(e){console.log("")}})'
```
If it returns a JSON summary, use it to steer THIS run (this is the "react to my score" loop):
- **`weakestSkills`** → generate extra questions in those skills/domains.
- **`hardAcc` (accuracy at diff 4–5)** → the higher it is, the more **difficulty 5** to generate
  (e.g. `hardAcc ≥ 0.8` → go ~70% diff 5 and add two-concept items; `hardAcc ≤ 0.5` → keep more
  diff 3–4 scaffolding on the weak skills before piling on diff 5).
- **`byDomain[*].acc`** → bias the domain mix toward the lowest-accuracy domains.
If the fetch is empty (no recent practice / message expired), fall back to the default mix below.

## Each run
1. Add **8–12 new questions**, spread across all four domains:
   `ALG` (Algebra), `ADV` (Advanced Math), `PSD` (Problem-Solving & Data), `GEO` (Geometry & Trig).
2. **Difficulty: bias hard, and ramp harder as the bank matures.** This bank targets 790–800
   and already has plenty of easy material, so deepen the *hard tail*. Aim per run for roughly:
   - **~55% difficulty 5** (hardest tier: discriminant/double-root edge cases, nonlinear systems,
     multi-step word problems, radians & circle-equation completing-the-square, multi-concept items).
   - **~35% difficulty 4**.
   - **~10% difficulty 3** — only when introducing a *new* skill that needs an on-ramp.
   - Generate **no difficulty 1–2** unless a brand-new skill genuinely needs one.
   Before generating, count `"diff":4` and `"diff":5` in data.js. The larger and better-spread the
   diff-5 pool already is, the harder you go: introduce **two-concept** questions (e.g. a quadratic
   set inside a geometry or rate context) so a high-performing student never tops out.
   When a progress export is available, also concentrate on the student's **weakest skills**, and lean
   even harder the higher their accuracy at diff 4–5 is — more correct answers ⇒ more diff-5 generation.
3. Use **unique ids** continuing the existing scheme (e.g. `A11`, `B11`, … or `GEN-<n>`).
4. Mix `type`: some `mental`, some `work`, some `desmos`. Mix `format`: ~75% `mc`, ~25% `grid`.

## Quality bar (this is for an 800 target)
- **Verify every answer numerically** before writing it. No wrong keys.
- MC: 4 plausible choices; distractors should reflect common mistakes (sign errors, off-by-one,
  forgetting to halve, etc.). `answer` is the index of the correct choice. **All four choices must
  be distinct values** — never include two that evaluate to the same number (e.g. `3` and `√9`).
- Grid: `answer` is a string; decimals/fractions both acceptable by the app's checker.
- Every question needs: `solution` (full steps), `shortcut` (the fast/mental move),
  and `desmos` (the calculator method, or `""` if truly N/A).
- Style must match the **digital SAT**: concise stems, real-world PSD contexts, Desmos-friendly ADV.

## Weekly (once per 7 runs)
- Research recent digital-SAT math **topic/trick trends** from public test-taker discussion
  (e.g. r/SAT threads after a test date). Add questions targeting those patterns.
  Do NOT copy real questions — emulate the *type*.
- Optionally refresh `DESMOS_TIPS` with any new shortcuts.

## After editing, always run:
```bash
cd ~/sat-math-prep
node --check data.js
node -e 'global.window={};require("./data.js");const Q=window.SAT.QUESTIONS;
  let e=[];const ids=new Set();
  for(const q of Q){if(ids.has(q.id))e.push(q.id+" dup");ids.add(q.id);
    if(!window.SAT.DOMAINS[q.domain])e.push(q.id+" domain");
    if(q.format==="mc"&&!(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.choices.length))e.push(q.id+" ans");
    if(q.format==="grid"&&typeof q.answer!=="string")e.push(q.id+" grid");}
  console.log(e.length?"ERRORS:\n"+e.join("\n"):"OK "+Q.length+" questions");'
```
Only finish if it prints `OK`.
