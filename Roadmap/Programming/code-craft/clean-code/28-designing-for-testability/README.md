# Designing for Testability

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

How to **shape production code so it is easy to test** — the design side of testing. Distinct from [Unit Tests](../08-unit-tests/README.md) (which is about *writing good tests*): this chapter is about the structural choices — dependency injection, seams, pure cores, ports & adapters, the humble object — that make code testable in the first place, *before* a single test is written. Testability is a proxy for good decoupling: code that is hard to test is usually badly designed.

The positive rules will cover: depending on injected abstractions rather than concrete globals, isolating side effects behind seams (Michael Feathers), pushing logic into a pure functional core, the Humble Object pattern for untestable boundaries, and separating object construction from business logic.

## Anti-Patterns to Cover

- **Hidden dependencies** — `new`-ing collaborators or calling statics/singletons inside a method
- **Global mutable state** that test cases leak into each other
- **Un-injected `time.Now()` / random / I/O** making behavior non-deterministic
- **God constructors** that do real work (network, DB) on instantiation
- **Logic trapped in an untestable layer** (UI handler, framework callback, `main`)
- **No seams** — concrete types with no interface to substitute a test double
- **Static/utility classes** holding behavior that can't be faked
- **Testing through too many layers** because the unit can't be isolated

See the [chapter README](../README.md) for the positive rules.
