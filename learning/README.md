# Learning

Collin's learning goals, lessons, and progress, published at https://chortt.github.io/horton-apps-public/learning/.

This is the `learning/` applet in [horton-apps-public](https://github.com/cHortt/horton-apps-public). Maintained by **Gopher** (Collin's assistant), using Matt Pocock's [teach skill](https://github.com/mattpocock/skills). Collin reports progress in chat; Gopher updates the log and lessons and commits to this repository.

## Structure
- `index.html`: home page listing every goal and its status
- `assets/style.css`: shared styling
- `<goal>/` (one folder per goal, e.g. `pullups-20/`, `dips-20/`)
  - `MISSION.md`, `NOTES.md`, `RESOURCES.md`
  - `learning-records/`: dated notes on what was learned/decided
  - `lessons/`, `reference/`: HTML + PDF
  - `assets/`: goal-specific CSS/JS
  - `progress/log.csv`: `date,type,sets,reps_per_set,total,notes`
  - `index.html`: plan summary, links, chart, and log (rendered from the CSV)

## Public repo rules
Public by design: no personal info beyond the first name "Collin", no family details, addresses, or health info beyond training numbers, and no secrets.

See [ADDING-A-GOAL.md](ADDING-A-GOAL.md).
