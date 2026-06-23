# Classes

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- God class (does everything; thousands of lines)
- Data class (no behaviour, only fields and accessors)
- Utility class (only static methods, can't mock, can't substitute)
- Inheriting for code reuse rather than for substitutability
- Inheritance hierarchies more than 2–3 levels deep

See the [chapter README](../README.md) for the positive rules.
