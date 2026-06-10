# Documentation & ADRs

Status: ⏳ PENDING

The documentation that lives *outside* the code — READMEs, runbooks, design docs, and **Architecture Decision Records (ADRs)**. Distinct from [Comments](../03-comments/README.md) (which covers *in-code* annotation): this chapter is about the artifacts a reader needs *before* they open the source — how to run it, how it is shaped, and **why** the important decisions were made the way they were.

The positive rules will cover: a README that gets a newcomer running in minutes, capturing the *why* (not the *what*) in ADRs, keeping a single source of truth, and treating documentation rot as a defect.

## Anti-Patterns to Cover

- **README rot** — setup steps that silently stopped working three releases ago
- **No "why" record** — decisions made, forgotten, then re-litigated every quarter
- **Documentation that duplicates the code** instead of explaining intent and rationale
- **Over-documentation** — generated reference docs nobody reads, restating signatures
- **Tribal knowledge** — critical setup living only in one engineer's head
- **Rubber-stamp ADRs** written after the fact to satisfy process, recording no real decision
- **Wiki sprawl** — five half-true pages and no single source of truth
- **Missing "getting started"** — onboarding takes days because nothing is written down

See the [chapter README](../README.md) for the positive rules.
