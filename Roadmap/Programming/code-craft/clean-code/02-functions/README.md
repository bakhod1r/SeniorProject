# Functions

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Flag arguments (`render(true)` vs `renderHtml()` / `renderText()`)
- Output arguments (mutated parameters instead of return values)
- Hidden temporal coupling (caller must invoke `a()` before `b()`)
- Mixed levels of abstraction in one function
- Returning `null` instead of empty collection / Optional / Result
- Functions over ~20 lines with no clear sub-step boundary

See the [chapter README](../README.md) for the positive rules.
