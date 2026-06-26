# Sum, Product & Unit Types — Tasks & Exercises

> **Topic:** [Sum, Product & Unit Types](README.md)
> **Focus:** Hands-on exercises that build the reflexes — counting inhabitants, choosing sum vs product, killing illegal states, replacing null/exceptions, and reasoning about layout and exhaustiveness. Pick your language; the ideas are universal.

---

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Warm-Up: Counting & Classifying](#warm-up-counting--classifying)
3. [Core: Modeling with Sums and Products](#core-modeling-with-sums-and-products)
4. [Algebra of Types](#algebra-of-types)
5. [Illegal States & Parse-Don't-Validate](#illegal-states--parse-dont-validate)
6. [Null & Exceptions → Option & Result](#null--exceptions--option--result)
7. [Exhaustiveness & the Expression Problem](#exhaustiveness--the-expression-problem)
8. [Recursive ADTs](#recursive-adts)
9. [Layout & Representation](#layout--representation)
10. [Challenge Problems](#challenge-problems)
11. [Self-Check Answer Key](#self-check-answer-key)

---

## How to Use This File

Each task has a **goal**, a **self-check** you can verify yourself, and a folded **hint**. Solutions are deliberately **sparse** — given only for the trickier items, and even then as a sketch, because the learning is in the doing. Work in any language with sum types (Rust, Swift, Haskell, OCaml, F#, TypeScript, Kotlin, modern Java); where a task is language-specific it says so.

Suggested order: do the warm-up counting tasks first (they build the core intuition), then the modeling tasks, then pick from the rest by interest. The challenge problems assume you've done the core.

Conventions used below:
- `|T|` means "number of inhabitants of type `T`."
- "sum" = tagged union / enum / variant; "product" = struct / tuple / record.
- Unit = the one-value type (`()`); Void = the zero-value type (`!` / `never` / `Nothing` / `Void`).

---

## Warm-Up: Counting & Classifying

### Task 1.1 — Count the inhabitants

**Goal:** For each type, compute `|T|`. Show the arithmetic.

```
(a) (bool, bool)
(b) enum E { A, B, C }
(c) (bool, E)                      where E has 3 values
(d) Option<bool>
(e) Result<bool, E>                where E has 3 values
(f) Option<Option<bool>>
(g) (Option<bool>, bool)
(h) enum X { P(bool), Q }          (Q carries no data)
```

**Self-check:** (a) 4; (b) 3; (c) 6; (d) 3; (e) 5; (f) 4; (g) 6; (h) 3. If any of yours disagree, re-derive with `× for AND`, `+ for OR`.

<details><summary>Hint</summary>

Product → multiply the parts; sum → add the variants; a fieldless variant contributes 1; `Option<T> = 1 + |T|`; `Result<T,E> = |T| + |E|`.

</details>

### Task 1.2 — Sum or product?

**Goal:** Classify each as primarily a **sum** or a **product**, and say why.

```
(a) a 2D point (x, y)
(b) an HTTP response: 200 OK with a body, OR 404 Not Found, OR 500 with an error
(c) a database row with id, name, created_at
(d) a JSON value (null | bool | number | string | array | object)
(e) a traffic light (Red | Yellow | Green)
(f) a person's full name (first, middle, last)
(g) a coin flip outcome that, on heads, records a winner, and on tails, records nothing
```

**Self-check:** Sums: (b), (d), (e), (g). Products: (a), (c), (f). Reasoning: "one of these kinds" → sum; "all of these at once" → product.

### Task 1.3 — Unit vs Void vs C-void

**Goal:** For your favorite language, write down (1) its Unit type, (2) its Void/never type (if any), (3) what its `void`/`Unit`-return keyword actually is. Then answer: is `void` (the keyword) closer to Unit or to Void? Why?

**Self-check:** `void` (C/Java/JS) is closer to **Unit** — "returns one uninteresting value," not "never returns / cannot exist." The real Void is Rust `!`, TS `never`, Kotlin `Nothing`, Haskell `Void`.

---

## Core: Modeling with Sums and Products

### Task 2.1 — Shapes

**Goal:** Define a `Shape` sum (circle, rectangle, triangle, each with its dimensions) and write `area` and `perimeter` with **exhaustive** matches. Then add a `Square` variant and let the compiler show you every site to update.

**Self-check:** After adding `Square`, your `area` and `perimeter` should both fail to compile (in a language with exhaustiveness) until you add the `Square` arm. If they compiled without changes, you used a wildcard `_` — remove it.

<details><summary>Hint</summary>

Don't put a `_ => ...` catch-all in the match. The whole point of this exercise is to feel exhaustiveness work for you.

</details>

### Task 2.2 — Network message

**Goal:** Model a network message that is one of: `Ping`, `Pong`, `Text { body: String }`, `Disconnect { code: u16, reason: String }`. Write a function that returns a human-readable description by matching.

**Self-check:** `Ping`/`Pong` carry no payload (pure-tag variants); `Text` and `Disconnect` carry products. Your match has exactly four arms and no wildcard.

### Task 2.3 — Replace the flag soup

**Goal:** You're given this product (pseudocode):

```
struct MediaPlayer {
    is_playing: bool,
    is_paused: bool,
    current_track: Option<Track>,
    position_seconds: u32,
}
```

List at least **three illegal states** this allows, then redesign it as a sum so those states are unrepresentable.

**Self-check (illegal states):** e.g. `is_playing && is_paused` both true; `is_playing` true but `current_track == None`; `position_seconds > 0` with no track. A clean redesign:

```
enum MediaPlayer {
    Stopped,
    Playing { track: Track, position_seconds: u32 },
    Paused  { track: Track, position_seconds: u32 },
}
```

<details><summary>Hint</summary>

Every state in the sum should carry *exactly* the data valid in that state — `Stopped` has no track or position; `Playing`/`Paused` always have both.

</details>

---

## Algebra of Types

### Task 3.1 — Prove an isomorphism

**Goal:** Show that `(bool, bool, bool)` is isomorphic to `enum Octal { Zero, One, Two, Three, Four, Five, Six, Seven }` by writing the two conversion functions (`to`/`from`) and checking they round-trip.

**Self-check:** Both have 8 inhabitants (`2×2×2 = 8 = 1+1+1+1+1+1+1+1`). `from(to(x)) == x` for all 8 tuples and `to(from(o)) == o` for all 8 variants. Map `(b2,b1,b0)` to the integer `4·b2 + 2·b1 + b0`.

### Task 3.2 — Distributivity refactor

**Goal:** Given `struct Event { timestamp: u64, kind: Kind }` where `Kind = Click{x,y} | Key{code}`, rewrite it using distributivity (`A × (B + C) ≅ A×B + A×C`) as a single sum whose variants each carry the timestamp. Confirm both have the same cardinality (informally — `timestamp` is large, so argue structurally).

**Self-check:** The rewrite is `enum Event { Click { timestamp: u64, x: i32, y: i32 }, Key { timestamp: u64, code: u32 } }`. Both encode `u64 × (Click-payload + Key-payload)`; the algebra guarantees they hold the same information. Note which you'd prefer and why.

### Task 3.3 — Functions as exponentials

**Goal:** Enumerate **all** functions of type `bool -> bool` (there should be `2^2 = 4`). Name each (`id`, `not`, `const true`, `const false`). Then say how many functions `Color -> bool` has, where `|Color| = 3`.

**Self-check:** 4 functions for `bool -> bool`; `2^3 = 8` for `Color -> bool`. `|A -> B| = |B|^|A|`.

<details><summary>Hint</summary>

A function is a full input→output table. For `bool -> bool` there are 2 inputs and, for each, 2 output choices: `2 × 2 = 4` tables.

</details>

### Task 3.4 — Simplify with the laws

**Goal:** Simplify each type using the algebra identities, and name the resulting type/value where possible:

```
(a) A × Unit
(b) A + Void
(c) Unit -> A
(d) Void -> A
(e) A -> Unit
```

**Self-check:** (a) `≅ A`; (b) `≅ A`; (c) `≅ A` (a function from Unit is just a value); (d) `≅ Unit` (exactly one function, the "absurd"); (e) `≅ Unit` (only `const ()`).

---

## Illegal States & Parse-Don't-Validate

### Task 4.1 — Smart constructor

**Goal:** Define a `Percent` type that can only ever hold `0..=100`. Make the raw constructor private and expose `Percent::new(n) -> Option<Percent>` (or `Result`). Write a test proving `Percent::new(150)` is `None`/`Err` and `Percent::new(50)` succeeds.

**Self-check:** There must be **no** public way to build an out-of-range `Percent`. `|Percent| = 101`, smaller than its `u8` representation (256) — the smart constructor enforces the gap.

### Task 4.2 — Parse, don't validate

**Goal:** Replace a `fn is_nonempty(s: &str) -> bool` + later use with a `NonEmptyString` type whose `parse(s) -> Result<NonEmptyString, Error>` is the *only* way to construct it. Make a downstream function take `&NonEmptyString` so it *cannot* be called with possibly-empty input.

**Self-check:** Downstream code never re-checks emptiness — the *type* `NonEmptyString` is the proof. You validated exactly once, at the boundary.

<details><summary>Hint</summary>

The trick is the precise return type. `validate` returns `bool` (a check you can forget); `parse` returns a *more precise type* whose mere existence proves the property.

</details>

### Task 4.3 — Newtypes vs mix-ups

**Goal:** Define `UserId` and `OrderId` as newtypes around `u64`. Write a function `fn cancel(order: OrderId, by: UserId)` and then *try* to call it with the arguments swapped. Confirm the compiler rejects it.

**Self-check:** `cancel(user_id, order_id)` must be a **compile error** even though both wrap `u64`. If it compiles, you used a type alias (`type UserId = u64`) instead of a real newtype — fix it.

---

## Null & Exceptions → Option & Result

### Task 5.1 — Kill the null

**Goal:** Take a function that returns a possibly-null/`nil` value (e.g. "find user by id") and rewrite it to return `Option`/`Maybe`. Then chain three operations on the result using `map`/`and_then` (or `?`) **without** any explicit null check.

**Self-check:** No `if x != null` anywhere; the absent case is handled by the combinators or forced by a final match. Compare line count and nesting against the null version.

### Task 5.2 — Exceptions → Result

**Goal:** Take a function that throws/panics on failure (e.g. parse an integer, divide) and rewrite it to return `Result<T, E>` with a small error **enum** (`enum ParseErr { Empty, NotANumber, Overflow }`). Handle all three at the call site exhaustively.

**Self-check:** The error type is a *sum*, the call-site match is exhaustive, and adding a fourth error variant would break the match until handled.

### Task 5.3 — Railway pipeline

**Goal:** Compose four fallible steps — `parse → validate → enrich → save` — each returning `Result<_, AppError>`, into one pipeline that short-circuits on the first failure (use `?`/`flatMap`/`and_then`). Then write the exhaustive top-level handler.

**Self-check:** The happy path reads top-to-bottom with no nested `if err`. The top-level `match` covers every `AppError` variant. On any step's failure, later steps don't run.

<details><summary>Hint</summary>

`?` (Rust), `try`/`?.` chains, or `flatMap`/`andThen` are the "switch onto the error track." The whole pipeline's error type is the union of the steps' errors — model it as one `AppError` sum.

</details>

---

## Exhaustiveness & the Expression Problem

### Task 6.1 — Feel the exhaustiveness break

**Goal:** Write an enum with 3 variants and three functions that each match on it. Add a 4th variant. Count how many compile errors you get and confirm each points at a real site that needs handling. Now add a wildcard `_` to one function and repeat — observe that site *stops* warning.

**Self-check:** Without wildcards: 3 errors (one per function). With a wildcard in one: 2 errors — the wildcard'd function silently mis-handles the new variant. This is the lesson on why wildcards over your own sums are dangerous.

### Task 6.2 — TypeScript exhaustiveness guard

**Goal (TypeScript):** Build a discriminated union of 3 shapes and an `area` switch that ends with `default: return assertNever(shape)`. Add a 4th shape and confirm you get a **compile error** at the `assertNever` line until you add the case.

**Self-check:** In `default`, `shape` is typed `never` only when all cases are handled; an unhandled variant makes it non-`never`, which isn't assignable to `never` → type error. (This is the Void type enforcing exhaustiveness.)

### Task 6.3 — Both sides of the expression problem

**Goal:** Implement the same `Shape` two ways: (a) a **sum + matches** (`area`, `perimeter` as functions), and (b) an **interface/trait + impls** (`area`, `perimeter` as methods). Then perform two changes on *each*: add a new variant (`Triangle`) and add a new operation (`draw`). Count how many files/sites each change touches in each design.

**Self-check:** In (a) sum: new operation = 1 new function (cheap); new variant = edit every function (the compiler lists them). In (b) interface: new variant = 1 new impl (cheap); new operation = edit every impl. This is the expression problem made concrete — neither is universally better.

---

## Recursive ADTs

### Task 7.1 — Linked list

**Goal:** Define a `List<T>` as a recursive sum (`Nil | Cons(T, List<T>)`), and write `length`, `sum` (for numeric `T`), and `map`. In languages that need it (Rust), use `Box` for the recursive field.

**Self-check:** `length(Nil) = 0`, `length(Cons(_, rest)) = 1 + length(rest)`. The recursion bottoms out at `Nil`. `List<T> ≅ 1 + T × List<T>` — note it references itself.

### Task 7.2 — Expression tree + fold

**Goal:** Define `Expr = Lit(i64) | Add(Expr, Expr) | Mul(Expr, Expr) | Neg(Expr)`. Write `eval` by pattern matching. Then write a **second** operation (`count_nodes` or `pretty_print`) without changing `eval`. Bonus: factor both through a single `fold`/`cata` if your language makes it ergonomic.

**Self-check:** Adding `count_nodes` touches no existing code (new operation = cheap, the sum side of the expression problem). `eval(Add(Lit(2), Mul(Lit(3), Lit(4))))` should be `14`.

<details><summary>Hint</summary>

The fold replaces each constructor with a function of the same arity: `fold litF addF mulF negF`. `eval = fold id (+) (*) negate`; `count_nodes` is a different algebra over the same fold.

</details>

### Task 7.3 — JSON value

**Goal:** Define a recursive `Json` sum (`Null | Bool(b) | Number(n) | Str(s) | Array(Vec<Json>) | Object(Map<String, Json>)`). Write a pretty-printer by pattern matching, and a function that counts the total number of nodes.

**Self-check:** Recursion descends into `Array` elements and `Object` values. A nested object's node count is `1 + sum of children's counts`. The match has 6 arms, no wildcard.

---

## Layout & Representation

### Task 8.1 — Measure niche optimization (Rust)

**Goal (Rust):** Print `size_of` for: `Option<&u8>`, `Option<u8>`, `Option<NonZeroU8>`, `Option<Box<u8>>`, and a fieldless 3-variant enum. Explain each result in terms of tags and niches.

**Self-check:** `Option<&u8>` = 8 (niche: null pointer); `Option<u8>` = 2 (no niche, needs a tag byte); `Option<NonZeroU8>` = 1 (niche: 0); `Option<Box<u8>>` = 8 (niche: null); fieldless enum = 1 (bare integer). Cardinality didn't change — representation did.

### Task 8.2 — Box the fat variant (Rust)

**Goal (Rust):** Define `enum E { Small(u8), Big([u8; 1024]) }` and print its size. Then change `Big` to `Big(Box<[u8; 1024]>)` and print again. Explain the difference.

**Self-check:** First version ~1025+ bytes (sized for the big variant); boxed version ~tag + pointer (~16). Same logical data; the box moves the payload to the heap so every `E` value is tiny.

### Task 8.3 — Schema evolution thought experiment

**Goal:** You persist `enum EventKind { Click = 1, Scroll = 2, KeyDown = 3 }` to disk with the integer tag. Answer in writing: (a) what breaks if you reorder the variants? (b) what does an *old* reader do when a *new* writer adds `Hover = 4`? (c) how do you make it forward-compatible?

**Self-check:** (a) Reordering renumbers discriminants → old data is silently reinterpreted (corruption). (b) The old reader hits an unknown tag → must not crash. (c) Pin discriminants explicitly (never rely on order) and add an `Unknown(tag, raw)` catch-all so unknown future variants are tolerated and (for a relay) preserved.

---

## Challenge Problems

### Task 9.1 — Cardinality calculator

**Goal:** Write a program that parses a tiny ADT grammar — `Unit`, `Void`, named base types with given sizes, `A * B` (product), `A + B` (sum), and references to other named types — and computes the number of inhabitants of each definition. Detect recursive (infinite) definitions and report them as infinite rather than looping.

**Self-check:** `Bool = Unit + Unit` → 2; `Option(Bool) = Unit + Bool` → 3; `List(Bool) = Unit + Bool * List(Bool)` → infinite (flagged, not hung). Cross-check a few against hand computation.

<details><summary>Hint</summary>

Represent each definition as an expression tree; evaluate cardinality bottom-up. For recursion, detect a cycle in the dependency graph (or a self-reference reachable from a type) and short-circuit to "infinite."

</details>

### Task 9.2 — Typestate API

**Goal:** Implement a `Connection` whose state (`Closed` / `Open`) is encoded in the type (`Connection<Closed>`, `Connection<Open>`) using phantom types or equivalent. Expose `connect: Connection<Closed> -> Connection<Open>`, `send: &Connection<Open> -> ()`, and `close: Connection<Open> -> Connection<Closed>`. Then write a client sequence that *won't compile* and explain which type fact blocks it.

**Self-check:** `send` on a `Connection<Closed>` must be a compile error (no such method). A double-`close` or `send`-before-`connect` must not compile. The state machine's legality is now a type-checker fact, not a runtime check.

### Task 9.3 — GADT-typed evaluator (Haskell/OCaml)

**Goal:** Using GADTs, define `Expr a` with `IntLit :: Int -> Expr Int`, `BoolLit :: Bool -> Expr Bool`, `Add :: Expr Int -> Expr Int -> Expr Int`, `If :: Expr Bool -> Expr a -> Expr a -> Expr a`. Write `eval :: Expr a -> a`. Then try to construct `Add (BoolLit True) (IntLit 1)` and confirm it **fails to typecheck**.

**Self-check:** `eval` returns the *right* type per branch with no casts (matching `IntLit` refines `a ~ Int`). The ill-typed `Add` of a bool is a compile error — the evaluator can never receive an ill-typed term.

### Task 9.4 — Validation with error accumulation

**Goal:** Write a form validator that checks several fields and, instead of stopping at the first error (`Result`'s short-circuit), **accumulates all errors** into a list. Compare the two behaviors on input where multiple fields are invalid.

**Self-check:** With short-circuiting `Result`/`Either`, you get only the first error. With an accumulating applicative (`Validation`, or `Either` over a `Semigroup` of errors), you get *all* of them. Articulate when each is the right choice (fail-fast pipelines vs user-facing form validation).

---

## Self-Check Answer Key

Consolidated answers for the counting/algebra tasks (the modeling and coding tasks are checked inline above).

**Task 1.1:** (a) `2×2 = 4`; (b) `1+1+1 = 3`; (c) `2×3 = 6`; (d) `1+2 = 3`; (e) `2+3 = 5`; (f) `1+(1+2) = 4`; (g) `(1+2)×2 = 6`; (h) `2+1 = 3`.

**Task 1.2:** Sums: (b), (d), (e), (g). Products: (a), (c), (f).

**Task 3.1:** Both have 8 values → isomorphic. `to((b2,b1,b0)) = 4·b2 + 2·b1 + b0`; `from` reverses by extracting bits. Round-trips for all 8.

**Task 3.3:** `bool -> bool` has 4 functions: `id`, `not`, `const true`, `const false`. `Color -> bool` has `2^3 = 8`.

**Task 3.4:** (a) `A`; (b) `A`; (c) `A`; (d) `Unit` (one function, `absurd`); (e) `Unit` (`const ()`).

**Task 8.1:** `Option<&u8>` = 8, `Option<u8>` = 2, `Option<NonZeroU8>` = 1, `Option<Box<u8>>` = 8, fieldless 3-variant enum = 1. The cardinalities are unchanged; only the byte representation differs (niche vs explicit tag).

**Task 8.3:** (a) reorder → discriminants renumber → old data reinterpreted (corruption); (b) old reader meets an unknown tag and must tolerate it; (c) pin discriminants and add `Unknown(tag, raw)` for forward compatibility, preserving raw bytes if relaying.

> The modeling, parse-don't-validate, null→Option, Result, exhaustiveness, recursive-ADT, typestate, and GADT tasks are intentionally left without full solutions — their value is in the doing, and the inline self-checks tell you whether you got them right. If a task compiles, the self-check passes, and you can explain *why* it's correct in terms of the algebra and exhaustiveness, you've learned it.
