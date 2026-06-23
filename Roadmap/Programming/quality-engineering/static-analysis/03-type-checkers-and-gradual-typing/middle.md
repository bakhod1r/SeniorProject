# Type Checkers & Gradual Typing — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Type Checkers & Gradual Typing

*Gradual typing lets you add static guarantees to a dynamic codebase one module at a time — but only if you understand `any`, `unknown`, and the strict flags that decide how much the checker actually protects you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Gradual typing: types you can add incrementally](#core-concept-1----gradual-typing-types-you-can-add-incrementally)
5. [Core Concept 2 — `any` is a hole; `unknown` is a wall](#core-concept-2----any-is-a-hole-unknown-is-a-wall)
6. [Core Concept 3 — Narrowing: how the checker tracks types through code](#core-concept-3----narrowing-how-the-checker-tracks-types-through-code)
7. [Core Concept 4 — Escape hatches and how they erode guarantees](#core-concept-4----escape-hatches-and-how-they-erode-guarantees)
8. [Core Concept 5 — Strict flags: turning the checker's strength up](#core-concept-5----strict-flags-turning-the-checkers-strength-up)
9. [Core Concept 6 — Richer Python types: TypedDict, Protocol, Union](#core-concept-6----richer-python-types-typeddict-protocol-union)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Adding types incrementally to a dynamic codebase, controlling escape hatches, and using strict flags to choose how strong the checker is.**

You already know a type checker catches wrong-type and null bugs before runtime. The next question is practical: you have an existing JavaScript or Python codebase with *no* types. You can't stop and annotate 200k lines. **Gradual typing** is the answer — a type system explicitly designed so typed and untyped code coexist, letting you add types where they pay off and defer the rest.

But gradual typing has a sharp edge: every untyped region is a place the checker is blind. The tools you use to mark those regions — `any`, `Any`, `# type: ignore`, casts — are *escape hatches*, and they silently spread blindness if you're not careful. This page is about wielding gradual typing on purpose: knowing where the holes are, using `unknown` instead of `any`, and dialing strictness up with flags so the checker actually earns its keep.

## Prerequisites

- Comfortable writing annotations on function boundaries (the [Junior](./junior.md) page).
- You've run `tsc`, `mypy`, or `pyright` on real code and fixed errors.
- Familiar with control flow: `if`, early returns, `typeof`/`isinstance`.
- You've seen at least one large untyped codebase you'd like to make safer.

## Glossary

| Term | Meaning |
|------|---------|
| **Gradual typing** | A type discipline where typed and untyped code interoperate; you add types incrementally. |
| **`any` (TS) / `Any` (Py)** | The "turn off checking here" type. Anything is assignable to it and from it. |
| **`unknown` (TS)** | A safe top type: anything is assignable *to* it, but you must narrow before *using* it. |
| **Narrowing** | The checker refining a type based on control flow (`if (typeof x === "string")`). |
| **Cast / assertion** | Telling the checker "trust me, it's this type" (`x as User`, `cast(User, x)`). |
| **Escape hatch** | Any construct that bypasses checking: `any`, casts, `@ts-ignore`, `# type: ignore`. |
| **Strict flags** | Compiler options (`strict`, `noImplicitAny`, `strictNullChecks`) that tighten the rules. |
| **Type coverage** | The percentage of expressions whose type is known (not `any`). |
| **`TypedDict`** | A Python type describing the keys and value types of a dict. |
| **`Protocol`** | A Python structural type ("anything with these methods"). |

## Core Concept 1 — Gradual typing: types you can add incrementally

Gradual typing's whole point is that **untyped code is valid code**. The checker assumes untyped values could be anything and lets them flow freely — until they touch a typed boundary, where it starts enforcing.

The dominant strategy is **types at the boundaries first**: annotate the edges where data enters and leaves your system (API responses, function signatures, module exports), then let types propagate inward over time.

```python
# Day 1: untyped function — checker leaves it alone
def parse(raw):
    return raw["payload"]

# Day 2: type the boundary
def parse(raw: dict[str, str]) -> str:
    return raw["payload"]   # now misuse of the return value is checked
```

In TypeScript-over-JavaScript, the same idea: rename `.js` to `.ts`, fix the errors at the file's edges, and `allowJs` lets typed and untyped files import each other during the migration. Sorbet does this for Ruby; Flow does it for JavaScript; Python's hints + mypy/pyright do it for Python. Different languages, same gradual contract.

## Core Concept 2 — `any` is a hole; `unknown` is a wall

`any` is the escape hatch that disables checking. Anything is assignable to it, *and it is assignable to anything* — which means it silently spreads.

```ts
let data: any = JSON.parse(input);
data.foo.bar.baz();        // no error — and a crash at runtime
const n: number = data;    // no error — any flows into number unchecked
```

`unknown` is the safe alternative. You can put anything *into* it, but you must **narrow** before you take anything *out*:

```ts
let data: unknown = JSON.parse(input);
data.foo;                  // error: 'data' is of type 'unknown'

if (typeof data === "object" && data !== null && "foo" in data) {
  // now the checker lets you proceed, having forced you to prove the shape
}
```

```
$ tsc
parse.ts:2:6 - error TS18046: 'data' is of type 'unknown'.
```

Rule of thumb: **use `unknown` at every boundary where the type is genuinely not known (parsed JSON, `catch` clauses, generic containers). Reserve `any` for nothing.** Python's `Any` behaves like TS `any`; prefer `object` (its rough equivalent of `unknown`, requiring narrowing) when you can.

## Core Concept 3 — Narrowing: how the checker tracks types through code

A type checker isn't static in the naive sense — it follows your control flow and *refines* types as it goes. This is **narrowing**, and it's why typed code feels natural instead of fighting you.

```ts
function format(value: string | number): string {
  if (typeof value === "number") {
    return value.toFixed(2);   // here, value is narrowed to number
  }
  return value.toUpperCase();  // here, value is narrowed to string
}
```

```python
def length_of(value: str | list[int]) -> int:
    if isinstance(value, str):
        return len(value)        # value: str
    return sum(value)            # value: list[int]
```

Narrowing also handles null:

```ts
function nameLen(u: { name?: string }): number {
  if (u.name === undefined) return 0;
  return u.name.length;   // narrowed to string — no "possibly undefined" error
}
```

Understanding narrowing changes how you write code: you handle the impossible cases *first* (early return), and the checker rewards you by knowing the remaining type is safe.

## Core Concept 4 — Escape hatches and how they erode guarantees

Every checker has explicit "trust me" mechanisms. They're sometimes necessary, but each one is a place where a future bug can hide:

```ts
const user = data as User;       // cast: no runtime check, pure assertion
// @ts-ignore                    // suppress the next line's error entirely
legacyApi.doThing(user);
// @ts-expect-error              // better: errors if the line STOPS erroring
brokenCall();
```

```python
user = cast(User, data)          # assertion, no runtime effect
result = legacy()  # type: ignore[no-any-return]   # suppress, scoped to a code
```

The danger isn't using an escape hatch once — it's that they **compound**. A cast that's wrong makes every downstream use wrong, and the checker won't warn you. Two practices keep them honest:

1. **Prefer the self-expiring forms.** `@ts-expect-error` errors if the underlying problem is fixed, so dead suppressions get cleaned up. Always scope `# type: ignore[code]` to a specific error code.
2. **Budget them.** Grep for escape hatches in CI and treat a rising count as a regression (more in [Senior](./senior.md)).

```bash
# A crude but effective escape-hatch budget
grep -rn "as any\|@ts-ignore\|: any" src/ | wc -l
grep -rn "# type: ignore\|cast(" . | wc -l
```

## Core Concept 5 — Strict flags: turning the checker's strength up

By default both TS and mypy are lenient so adoption is easy. The protection you actually want lives behind strict flags.

**TypeScript** — the `strict` family in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,              // enables the whole family below
    "noImplicitAny": true,       // error on inferred 'any'
    "strictNullChecks": true,    // null/undefined are their own types
    "noUncheckedIndexedAccess": true,  // arr[i] is T | undefined
    "exactOptionalPropertyTypes": true
  }
}
```

`strictNullChecks` is the single most valuable flag — without it, `null` and `undefined` are assignable to everything and the checker can't catch null-deref bugs at all.

**mypy** — in `pyproject.toml` or `mypy.ini`:

```toml
[tool.mypy]
strict = true                    # bundles the strict flags
disallow_untyped_defs = true     # every function must be annotated
warn_return_any = true
no_implicit_optional = true      # a default of None doesn't imply Optional
```

You don't have to flip everything on day one — strictness can be ratcheted up incrementally and even applied per-module (covered in [Senior](./senior.md)). But know that **a type checker without strict null checks is doing a fraction of its job.**

## Core Concept 6 — Richer Python types: TypedDict, Protocol, Union

Real code passes dicts and duck-typed objects around. Python's typing toolkit describes them precisely:

```python
from typing import TypedDict, Protocol

# Describe the shape of a dict (e.g. a JSON object)
class UserRow(TypedDict):
    id: int
    name: str
    email: str | None        # 3.10+ union syntax

def display(u: UserRow) -> str:
    return u["name"]         # u["nmae"] would be a type error

# Structural typing: "anything with a .read() method"
class Readable(Protocol):
    def read(self, n: int) -> bytes: ...

def consume(src: Readable) -> bytes:
    return src.read(1024)    # files, sockets, BytesIO all satisfy this
```

`TypedDict` turns string-keyed dicts (the usual JSON shape in Python) into checkable objects. `Protocol` gives you interface-style polymorphism without inheritance — the structural-typing counterpart to TypeScript's object types.

## Real-World Examples

**1. Hardening a JSON boundary.** An endpoint does `const body = req.body as RequestShape`. The cast is a lie — `req.body` is whatever the client sent. The fix: type it `unknown` and validate with a schema library (Zod, Pydantic), so the type assertion is backed by a real runtime check.

**2. The migration that stalled.** A team renamed all `.js` to `.ts` but set `noImplicitAny: false`, so thousands of parameters silently became `any`. The codebase "had types" but the checker caught almost nothing. Turning on `noImplicitAny` revealed the truth — they'd been typing theater.

**3. The `# type: ignore` graveyard.** A Python service had 400 bare `# type: ignore` comments, many for errors fixed years ago. Switching to `# type: ignore[code]` plus mypy's `--warn-unused-ignores` let them delete 250 of them.

## Mental Models

- **Gradual typing is a frontier, not a switch.** Typed and untyped code share a border; you push the border inward over time.
- **`any` is acid.** It dissolves type information everywhere it touches and flows downstream invisibly. `unknown` is inert until you safely open it.
- **Strict flags are the dial.** The checker has a strength dial from "barely on" to "sound-ish." Lenient defaults exist for adoption, not for production.
- **Narrowing rewards defensive structure.** Handle null and impossible cases first; the checker then *knows* the rest is safe, so you write less defensive code, not more.

## Common Mistakes

- **Using `any` as the default escape.** Reach for `unknown` (TS) / `object` (Py) and narrow. `any` is almost never the right answer.
- **Casting to silence errors.** `as User` / `cast(User, x)` is an unchecked assertion; if you're wrong, every downstream use is wrong. Validate at boundaries instead.
- **Leaving `strictNullChecks` / null checks off.** This disables the highest-value protection. Turn it on, even if it means a migration.
- **Bare `# type: ignore` and `@ts-ignore`.** Always scope to an error code, and prefer `@ts-expect-error` so stale suppressions surface.
- **Believing "we have types" without measuring.** Without `noImplicitAny` / type-coverage measurement, you can have annotations everywhere and protection nowhere.

## Test Yourself

1. What is the core promise of gradual typing, and what's the standard rollout strategy?
2. Why is `unknown` safer than `any`? Give a one-line example of each.
3. Explain narrowing using a `typeof`/`isinstance` example.
4. Why is `@ts-expect-error` better than `@ts-ignore`?
5. Which single strict flag matters most, and what does turning it off cost you?
6. When would you reach for `TypedDict` vs `Protocol` in Python?

## Cheat Sheet

```ts
// TypeScript — safer choices
let x: unknown = JSON.parse(s);     // not any
const u = data as User;             // cast = unchecked assertion (avoid)
// @ts-expect-error                 // self-expiring suppression
// tsconfig: "strict": true, "noImplicitAny": true, "strictNullChecks": true
```

```python
# Python
from typing import TypedDict, Protocol, cast
class Row(TypedDict): id: int; name: str
x = cast(User, data)                # assertion, no runtime check
# type: ignore[arg-type]            # scoped suppression
# mypy: strict = true, disallow_untyped_defs = true
```

| Escape hatch | TS | Python |
|--------------|----|--------|
| Disable type | `any` | `Any` |
| Safe unknown | `unknown` | `object` |
| Assertion | `x as T` | `cast(T, x)` |
| Suppress | `@ts-expect-error` | `# type: ignore[code]` |

## Summary

Gradual typing lets you add static guarantees to a dynamic codebase incrementally, typing the boundaries first and pushing inward. The catch is that every untyped region is a blind spot, and escape hatches — `any`, casts, `@ts-ignore`/`# type: ignore` — spread blindness if uncontrolled. Prefer `unknown`/`object` and narrow; back casts with real validation; scope and budget suppressions; and turn on strict flags (especially null checking) so the checker delivers the protection you adopted it for. Lean on narrowing and rich types (`TypedDict`, `Protocol`, unions) to describe real-world data precisely.

## Further Reading

- *TypeScript Handbook* — "Narrowing", "The any type", and `unknown`.
- *mypy* — "Strict mode", "Protocols and structural subtyping", "TypedDict".
- *TypeScript Deep Dive* — strict compiler options.
- Pydantic / Zod docs — pairing runtime validation with static types at boundaries.

## Related Topics

- [Junior: first annotations](./junior.md) — annotating function boundaries.
- [Senior: rolling out types on legacy code](./senior.md) — strict ratchets and coverage gates.
- [Linters and Style Checkers](../01-linters-and-style-checkers/) — complementary static checks.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating on the type checker.
- For structural vs nominal typing theory, see `../../../language-internals/type-systems/`.
