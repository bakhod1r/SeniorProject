# Modules & Packages

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Circular package dependencies (A imports B imports A)
- "Utils" / "Common" / "Helpers" dumping-ground packages
- Public API leaking internal types (consumers depend on private structure)
- Cross-layer reaches (controller imports repository, skipping the service)
- One-class-per-package over-fragmentation
- Package-by-layer (`/controllers`, `/services`, `/repos`) instead of package-by-feature
- Re-exporting third-party types from your own package (hidden coupling)
- "God" package that every other package imports

See the [chapter README](../README.md) for the positive rules.
