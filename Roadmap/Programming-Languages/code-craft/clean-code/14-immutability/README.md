# Immutability

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The inverse of this chapter's rules — practices to **recognize and avoid**. Each will get a junior-level definition, a real example of the harm it causes, and the clean alternative.

## Anti-Patterns to Cover

- Mutating method arguments
- Returning mutable references to internal state
- Partial immutability (an immutable wrapper around a mutable map)
- Using setters to 'fix up' a supposedly immutable object
- Deep mutation of an object passed to a constructor (escape via aliasing)

See the [chapter README](../README.md) for the positive rules.
