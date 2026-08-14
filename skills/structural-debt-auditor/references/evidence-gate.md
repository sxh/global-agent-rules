# Evidence Gate — DRY / KISS / YAGNI

The scanner produces *candidates*. This gate decides which are real findings.
**A candidate is a finding only when it survives Layer-2 verification.** Never
report a scanner hit without confirming it at the source.

## DRY — Duplication (the scanner's primary signal)

| Pattern | What counts as evidence | Downgrade (skip) | Action |
|---|---|---|---|
| Identical named declaration in ≥2 files | Matching name + body at source | Different lifecycle/ownership modules; intentional decoupling | Extract shared module |
| Repeated validation / error / mapping logic | Same call sequence, different entities | Divergent evolution expected | Extract shared helper / base |
| Repeated error-handling contract | `if (!ok) throw` in N methods | Different security contexts | Extract response-check helper |
| Copy-pasted test setup | Identical fixtures in 5+ files | Tests intentionally isolated | Extract test helpers |

## KISS — Over-Abstraction

| Pattern | Evidence | Downgrade | Action |
|---|---|---|---|
| Abstract class / interface with 1 implementation | Grep implementations = 1 | Interface for DI/testing | Inline, remove abstraction |
| Factory for <3 types | Count branches | DI swap need | Direct construction |
| Wrapper-only class | All methods delegate | External-API isolation adapter | Remove wrapper |

## YAGNI — Unused Extensibility

| Pattern | Evidence | Downgrade | Action |
|---|---|---|---|
| Dead feature flag (always true/false) | Never toggled | A/B testing | Remove flag |
| Abstract method never overridden | 0 implementations | Public library extension point | Make concrete |
| Unused config option | 0 references | Env-specific config | Remove |

## Layer-2 Verification Checklist

Before reporting any candidate, ask:

1. **Same shape?** Read both code blocks — not just same name, but same body and same intent.
2. **Same ownership?** Do the two files belong to the same bounded context / team / lifecycle? If they evolve independently, the duplication may be cheaper than the coupling.
3. **Intentional?** Was this deliberate decoupling (e.g., two services that must not share a schema)?
4. **Would unifying reduce the concepts a reader holds?** If the "cleaner" version leaves the concept count unchanged, it isn't cleaner — prefer the extraction that makes a branch or layer disappear.

## Effort Estimates

- **S** = < 1h (constant/type extraction, mechanical)
- **M** = 1–4h (helper extraction with contract, base class)
- **L** = > 4h (layer restructuring, cross-package unification)

## Exclusions

- Generated code (SST env files, lockfiles, build output)
- Vendor / third-party code
- Migrations
- Test fixtures that are intentionally duplicated per-file for isolation
