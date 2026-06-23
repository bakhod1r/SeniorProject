# Boy Scout Rule

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- "I didn't touch it, so I won't fix the typo next to my change" (cleanup avoidance)
- Mixed-concern PRs bundling 50 unrelated cleanups with a feature (review sandbagging)
- "Big rewrite" instead of incremental, behavior-preserving cleanup
- Cleanup commits without tests — silent behavior changes slip through
- Drive-by refactoring on a feature branch without telling reviewers
- "Cleanup later" debt that is never actually paid
- Treating cleanup as optional instead of part of the definition of done
- Over-eager cleanup that touches files unrelated to the current task (scope creep)

See the [chapter README](../README.md) for the positive rules.
