# Objects & Data Structures

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Anaemic domain model (data classes with no behaviour)
- Train wreck (`a.getB().getC().getD().doIt()`) — Law of Demeter violation
- Hybrids (a struct with one or two behaviour methods bolted on)
- Getter/setter for every field — leaks internal state
- Public mutable collections returned from methods
- Visitor-style switching on type instead of polymorphism

See the [chapter README](../README.md) for the positive rules.
