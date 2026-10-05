# Model Selection — coding agent models (decision record)

Layer: documentation (`docs/`). Owner: human-facing record, not agent instructions.

---

## 2026-10-05 — Stay on DeepSeek V4 Flash. No model churn.

**Decision.** Keep OpenCode + DeepSeek V4 Flash as the coding model. Do not switch to, or add,
another model on performance grounds.

**Reasoning.**

1. *The cheap tier has clustered.* On DeepSeek's own published table the whole cheap-to-mid band
   lands between 82.7 and 90.6 on Terminal-Bench 2.1, and harness differences alone account for
   several points inside that range. Swapping within the band buys a different personality, not
   a capability.
2. *Step changes arrive between generations, not within them.* GLM-5.2 → 5.3 moved Terminal-Bench
   3.0 from 4.6 to 28.3; DeepSeek V4-Flash → V4.1-Flash moved DeepSWE v1.1 from 54.4 to 74.2 —
   and that second one is already being served, at the old price. Contemporaneous models priced
   $0.15–$1.50 are broadly interchangeable; the next generation will not be.
3. *The independent review base is too thin to act on.* Almost all published material on these
   specific models is vendor-adjacent (model-tracking sites, provider blogs) or the vendors' own
   benchmark tables. Where genuinely independent checks exist they are cooler than the vendor
   figures. Acting on that material would be acting on marketing.

**What this means in practice.**

- Do not propose a model change for incremental benchmark gains.
- Keep `mimo/mimo-v2.5` configured and reach for it only when a task stalls. A second model kept
  in reserve captures most of the benefit at zero switching cost.
- Re-test when a *new generation* lands, not between point releases.

**Mechanism.** A monthly Hermes cron job ("Monthly coding model watch") reviews the market against
the baseline below and reports only step changes — a new generation, a price move ≥ 30%, a capable
new free tier, or independent evidence on an *unsaturated* benchmark (Terminal-Bench 3.0/4.0,
DeepSWE v1.1). It never reports incremental gains. Baseline, triggers, sources and report shape
live in the Hermes `web-research` skill at `references/coding-model-watch.md`.

**Baseline — verified 2026-10-05.** Vendor list prices, per 1M tokens, USD.

| Model | In | Out | Cache-hit | Terminal-Bench 2.1 | DeepSWE v1.1 |
|---|---|---|---|---|---|
| `deepseek-flash` (incumbent) | 0.15 | 0.60 | 0.003 | 90.6 | 74.2 |
| GLM-4.7-FlashX | 0.07 | 0.40 | 0.01 | n/p | n/p |
| GLM-5.3-Flash | 0.15 | 0.50 | 0.03 | 84.3 | 63.4 |
| MiniMax-M3 | 0.30 | 1.20 | 0.06 | 66.0 | — |
| deepseek-v4-pro | 0.66 | 1.98 | 0.022 | 87.9 | 62.7 |
| kimi-k2.7-code | 0.95 | 4.00 | 0.19 | 67.0 | — |
| GLM-5.3 | 1.40 | 4.40 | 0.26 | 88.2 | 66.9 |
| kimi-k3 | 3.00 | 15.00 | — | 88.3 | 67.5 |

DeepSeek figures are off-peak. Benchmark figures are vendor-reported on each maker's own harness
except where noted in the skill reference; treat them as directional, not controlled.

**Caveats carried forward.**

- The config requests `deepseek-v4-flash`, which DeepSeek lists as a **retired legacy alias**. It
  is still accepted, and requests are served by DeepSeek-V4.1-Flash and billed at the Flash price.
  The canonical id is `deepseek-flash`.
- DeepSeek bills peak/off-peak. Peak is exactly 2x and runs 01:00–04:00 and 06:00–10:00 UTC,
  Mon–Fri — i.e. 07:00–11:00 BST, which is inside the usual morning working window. Off-peak
  covers all evening, all weekend and holidays.
- `opencode stats` reports Total Cost $0.00 because custom providers carry no cost data. Add a
  `cost` block (`input`, `output`, `cache_read`, `cache_write`) per model in `opencode.json` if
  spend tracking is wanted.
