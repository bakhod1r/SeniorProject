# Cognitive Load

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Deep nesting (5+ levels of `if`/`for`) instead of early returns
- Long parameter lists (8+ positional args)
- "Clever" one-liners that replace 3 clear lines
- Acronym-soup names that require domain knowledge to decode
- Hidden control flow — exceptions for normal cases, side effects in getters
- Functions exceeding a screen height (no chunking)
- Boolean parameters that flip behavior (`process(data, true, false, true)`)
- Mixed abstraction levels in one function (high-level orchestration next to bit-shifting)

See the [chapter README](../README.md) for the positive rules.
