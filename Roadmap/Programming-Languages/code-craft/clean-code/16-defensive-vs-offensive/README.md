# Defensive vs Offensive

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Defensive copying everywhere (real performance cost)
- Null checks at every layer (should live at the trust boundary)
- try/catch around every line ('paranoid' code)
- Asserts used as runtime validation in production
- Throwing on every contract violation instead of `Result`/error returns where appropriate

See the [chapter README](../README.md) for the positive rules.
