# Concurrency

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Shared mutable state without locks
- Double-checked locking (broken in many languages/memory models)
- `synchronized` on `this` (anyone can block your code)
- Spinning without backoff
- Forgetting `volatile` / atomic semantics on lock-free reads
- Using thread-unsafe collections under a lock that is only sometimes held

See the [chapter README](../README.md) for the positive rules.
