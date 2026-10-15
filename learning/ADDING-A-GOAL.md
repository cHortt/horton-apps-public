# Adding a goal

Goals live in the `learning/` applet of [horton-apps-public](https://github.com/cHortt/horton-apps-public). A goal is published at `https://chortt.github.io/horton-apps-public/learning/<goal-slug>/`. Gopher commits to this repository.

1. Create `learning/<goal-slug>/` and copy the structure from `learning/pullups-20/`.
2. Write `MISSION.md` (why and what success looks like) and `NOTES.md`. Keep them PII-free: first name Collin only, training numbers are fine, nothing else personal.
3. Start `progress/log.csv` with the header row (adapt columns if the goal isn't rep-based).
4. Add `learning/<goal-slug>/index.html` (copy and edit `learning/pullups-20/index.html`). Keep links relative to that folder so they work under `/horton-apps-public/learning/`.
5. Add a row to the table in `learning/index.html`.
6. Commit and push to `main` of horton-apps-public. Pages redeploys https://chortt.github.io/horton-apps-public/learning/.
