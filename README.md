# SAT Math — Daily Adaptive Prep

A self-contained web app for SAT Math prep, tuned for a **790–800** target by September.
Runs on laptop + phone, works offline (except the live Desmos panel), saves progress per device.

## Run it

**Laptop:** open `index.html`, or serve the folder:
```bash
cd ~/sat-math-prep
python3 -m http.server 8777
# then open http://localhost:8777
```

**Phone (same Wi-Fi):** with the server running, open `http://<your-laptop-IP>:8777` on your phone
(your laptop IP is shown when you run the server; e.g. `http://192.168.86.200:8777`).
Add it to your home screen for an app-like icon.

**Always-on / anywhere:** deploy the folder to any free static host (Netlify drop, GitHub Pages, Vercel).
No backend needed — it's pure static files.

## What it does

- **📅 Today** — one adaptive daily set: warm-up (easy) → adaptive core → challenge (hard).
  Each answer updates your mastery and picks the next question (2 right → harder, a miss → easier).
- **✏️ Practice** — drill a single domain; links to official Bluebook / College Board practice.
- **📈 Desmos** — a live calculator + the shortcut playbook (your biggest score lever).
- **📊 Progress** — estimated score, domain mastery bars, weakest skills, review-queue size.
- **🗺️ Plan** — the 6–8 week curriculum and the "800 mindset."
- **Spaced-repetition error log** — every miss resurfaces on a schedule until mastered.

## Files

| file | purpose |
|------|---------|
| `index.html` | shell |
| `styles.css` | mobile-first styling |
| `app.js` | adaptive engine, mastery (Elo), spaced repetition, UI |
| `data.js` | question bank + Desmos tips + curriculum + official links — **the coach edits this** |
| `coach-prompt.md` | spec for generating fresh questions |

## The daily coach

The coach is a Claude run that appends fresh, verified SAT-style questions to `QUESTIONS` in `data.js`
(and periodically refreshes Desmos tips / researches recent test trends). See `coach-prompt.md`.
Personalization (what *you* see) happens client-side in the app; the coach just keeps the bank growing.

## Honest notes

- Questions are **SAT-style and generated/curated**, not copied College Board property.
- The **June 2026 SAT itself isn't published** — the coach can research *topic/trick trends* from
  test-taker reports, not actual questions.
- Do **full official Bluebook practice tests weekly** — nothing else simulates the real adaptive test.
