# API & Library Design

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

Designing the **public surface you hand to other developers** — library APIs, SDKs, public module interfaces. Distinct from [Boundaries](../07-boundaries/README.md) (which is about *consuming* third-party code) and [Abstraction & Information Hiding](../22-abstraction-and-information-hiding/README.md) (internal module quality): this chapter is the **provider's** side — making an API "easy to use right and hard to use wrong" (Scott Meyers), and evolving it without breaking the people who depend on it.

The positive rules will cover: minimal and orthogonal surface area, the principle of least astonishment, intention-revealing signatures over primitives/booleans, sensible defaults, designing errors into the contract, deprecation and SemVer discipline, and writing the API's usage first (design from the caller in).

## Anti-Patterns to Cover

- **Sprawling public surface** — exposing everything "just in case"; no minimal core
- **Breaking changes without SemVer** — silent incompatibilities on a patch/minor bump
- **Boolean / primitive obsession** in signatures (`create(true, false, 30)`)
- **Inconsistent naming and argument order** across the API
- **No deprecation path** — methods deleted out from under callers
- **Leaking internal types** so consumers couple to your implementation
- **Bad or surprising defaults** that push correctness onto every caller
- **Telescoping constructors / stringly-typed entry points** instead of builders/options
- **Ignoring Hyrum's Law** — assuming undocumented behavior is safe to change

See the [chapter README](../README.md) for the positive rules.
