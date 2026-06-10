# Error Handling

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Exception swallowing (`catch (Exception e) { /* ignore */ }`)
- Catch-and-rethrow without adding context
- Error codes as enum returned via `int` (caller forgets to check)
- Using exceptions for control flow
- Returning `null` instead of empty/Optional/Result
- Wrapping every line in try/catch (paranoid handling)

See the [chapter README](../README.md) for the positive rules.
