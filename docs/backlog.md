# Global tooling backlog

Work owned by this repo (agent tooling, skills, the incidents archive). Newest first.
This repo has no PCP store, so items live here; see `docs/incidents.md` for the principles behind them.

- **2026-09-20** `structural-debt-scan`: exclude build/generated output so duplication ratios
  reflect source. The scanner's `DEFAULT_EXCLUDES` covers `node_modules`/`dist`/`build`/etc. but
  not `elm-stuff`, committed bundles (`elm/main.js`, `public/main.js`), or `s3-backup-*`; a
  scaleaircraftstuff run reported 96.4% duplication from 440 candidates that were all generated
  Elm bundles. Needs file-level excludes (committed bundles aren't directories), plus a test.
- **2026-09-20** Audit incident entries tagged `[ENFORCED]` that name no covering artefact
  (e.g. 102, 132) and either name the gate or downgrade to `[KNOWLEDGE]`.
- **2026-09-20** Tag audit: add status tags (`[ENFORCED]`/`[OPEN]`/`[KNOWLEDGE]`) to rule-bearing
  incident entries that carry only a category tag.
