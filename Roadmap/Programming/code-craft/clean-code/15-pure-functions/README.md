# Pure Functions

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Hidden side effects (logging, metrics, caches inside 'pure' code)
- Reading mutable globals / singletons
- Time / random / network calls in functions that look pure
- Mutating arguments while claiming purity
- Memoisation on functions that aren't actually pure

See the [chapter README](../README.md) for the positive rules.
