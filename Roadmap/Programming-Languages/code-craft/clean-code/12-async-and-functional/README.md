# Async & Functional

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Async without backpressure (unbounded queues, memory blowup)
- Callback hell (deep nesting instead of composing)
- Unhandled promise rejections / dropped futures
- Mixing sync and async APIs in one function ('coloured function' violations)
- Blocking the event loop with CPU-bound work

See the [chapter README](../README.md) for the positive rules.
