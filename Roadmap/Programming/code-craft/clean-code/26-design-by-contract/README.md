# Design by Contract

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

Bertrand Meyer's **Design by Contract (DbC)** — a method (born in Eiffel) for specifying the *obligations* and *guarantees* between a routine and its caller as **preconditions**, **postconditions**, and **class invariants**. Distinct from [Defensive vs Offensive](../16-defensive-vs-offensive/README.md) (which is about the *stance* you take toward bad input): this chapter is about the **formal contract** itself — who is to blame when an assertion fails, and how a contract serves as machine-checkable specification.

The positive rules will cover: stating preconditions/postconditions/invariants explicitly, the caller-satisfies-precondition / callee-guarantees-postcondition division of responsibility, contracts as executable specification (and their link to property-based testing), and the Liskov rule for contracts under inheritance (weaken preconditions, strengthen postconditions).

## Anti-Patterns to Cover

- **Implicit contracts** — assumptions about valid input that live only in the author's head
- **Double-checking** — the same precondition verified in both caller and callee
- **Contract-as-comment** — a `@param must be > 0` that is never enforced or tested
- **Subtype contract violation** — a subclass that strengthens a precondition or weakens a postcondition (an LSP break)
- **Invariant drift** — a class invariant that some method quietly leaves broken
- **Exceptions for contract breaches that are really programmer bugs** (should fail fast, not be caught)
- **Over-strict preconditions** that reject inputs the routine could reasonably handle

See the [chapter README](../README.md) for the positive rules.
