# Unit Tests

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Testing implementation details, not behaviour
- Multiple assertions testing different concerns in one test
- Slow tests (hit network/disk in the unit suite)
- Flaky tests left in CI
- Tests with no observable failure mode
- Setup methods longer than the test itself

See the [chapter README](../README.md) for the positive rules.
