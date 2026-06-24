# Daily Coach — question generation spec

Task: append fresh, high-quality, SAT-style math questions to the `QUESTIONS` array in
`~/sat-math-prep/data.js`. Then verify the file still passes the structural check.

## Each run
1. Add **8–12 new questions**, spread across all four domains:
   `ALG` (Algebra), `ADV` (Advanced Math), `PSD` (Problem-Solving & Data), `GEO` (Geometry & Trig).
2. Bias toward **difficulty 3–5** and toward the domains/skills the student is weakest in
   (if a progress export is available; otherwise rotate evenly).
3. Use **unique ids** continuing the existing scheme (e.g. `A11`, `B11`, … or `GEN-<n>`).
4. Mix `type`: some `mental`, some `work`, some `desmos`. Mix `format`: ~75% `mc`, ~25% `grid`.

## Quality bar (this is for an 800 target)
- **Verify every answer numerically** before writing it. No wrong keys.
- MC: 4 plausible choices; distractors should reflect common mistakes (sign errors, off-by-one,
  forgetting to halve, etc.). `answer` is the index of the correct choice.
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
