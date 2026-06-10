# Logging & Diagnostics

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- `log.info()` everywhere — no log-level strategy
- Logging PII, tokens, or secrets to stdout
- Multi-line log entries that break grep and structured parsing
- Logging the same event at every layer (caller + callee + middleware)
- `printf` / `console.log` debugging left in production code
- Stack traces logged at INFO instead of ERROR (alert noise)
- Free-text logs instead of structured key-value or JSON
- Hot-path logging without sampling (logs become the bottleneck)

See the [chapter README](../README.md) for the positive rules.
