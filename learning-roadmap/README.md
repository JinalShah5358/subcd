# Full-Stack Mastery Roadmap

A static, self-contained learning roadmap and 228-day timetable covering TypeScript, React,
Node.js, C#/.NET, OOP, software architecture, design patterns, professional folder structures
and AI engineering.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, styles, static sections (folder structures, how-to-use, decision tables) |
| `data.js` | All content: 9 phases, 38 weeks × 6 days, tracks, OOP, architectures, patterns, projects, checkpoints, interview bank, mistakes |
| `app.js` | Rendering, filtering, search, theme toggle, progress tracking |

Edit `data.js` to change the plan. It is plain data — no build step, no dependencies.

## Run locally

Any static server works:

```bash
npx serve .
# or
python -m http.server 8080
```

Opening `index.html` directly with `file://` also works.

## Deploy to Vercel

**Option A — drag and drop**
Go to [vercel.com/new](https://vercel.com/new), drag this `learning-roadmap` folder onto the page. Done.

**Option B — CLI**

```bash
npm i -g vercel
cd learning-roadmap
vercel
```

No framework preset, no build command, output directory `.` — it is a plain static site.

**Option C — Git**
Push this folder to a repo and import it in Vercel. If the folder sits inside a larger repo, set
**Root Directory** to `learning-roadmap` in the project settings.

## Notes

- Progress ticks are stored in `localStorage`, so they live in one browser on one device only.
- The theme follows your OS by default; the **Theme** button overrides it.
- The page prints reasonably (nav and filters are hidden in print styles).
