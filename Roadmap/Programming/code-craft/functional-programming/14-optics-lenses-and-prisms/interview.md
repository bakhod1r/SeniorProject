# Optics: Lenses & Prisms — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Optics: Lenses & Prisms
> **Essence:** An optic is a *first-class, composable focus into a data structure* that bundles reading and immutable updating. A **lens** focuses on a part that always exists (a field of a product type); a **prism** focuses on a case that may exist (a variant of a sum type); a **traversal** focuses on zero-or-more targets. They exist to kill the nested-copy tower you write to update `user.address.city` immutably — and the deep magic is that, encoded as functions, they all compose with a single operator.

A bank of 50+ interview questions and answers spanning the intuition, the operations, the laws, the optic hierarchy, real-language libraries, the van Laarhoven/profunctor encoding, and runtime cost — calibrated junior → professional. Each answer models the reasoning a strong candidate gives, trade-offs included. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Judgment, Cost, Language Reality](#senior--judgment-cost-language-reality)
4. [Professional / Deep — Encoding, Laws, Performance](#professional--deep--encoding-laws-performance)
5. [Code-Reading — What Does This Produce?](#code-reading--what-does-this-produce)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Optics in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> The nested-update pain, lens vs prism, the product/sum mental model, and the core operations.

**Q1. Explain optics to a junior who's never heard the word.**

<details><summary>Answer</summary>

An optic is a **reusable "pointer" into a piece of a data structure** — one value that knows how to *read* that piece and how to *update* it without mutating the original. Say you have a `user`, with an `address`, with a `city`, and you want to change the city *immutably* (no `user.address.city = ...`). Normally you'd rebuild every level by hand: a new address, then a new user wrapping it, copying every other field. An optic packages "reach the city, read or replace it, copy everything else" into one value you define once and reuse. The headline kinds are a **lens** (for a field that's always there) and a **prism** (for a case that might be there, like one variant of a union). The whole point is killing the nested-copy boilerplate.
</details>

**Q2. What problem do optics actually solve, in one sentence?**

<details><summary>Answer</summary>

They make **immutable updates to deeply nested data** composable and reusable — replacing the per-call-site tower of "copy everything else the same" (`{...x, y: {...x.y, z: newValue}}`) with a single, named, composable update path.
</details>

**Q3. What is a lens, precisely?**

<details><summary>Answer</summary>

A lens is an optic that focuses on **one part of a structure that always exists** — a field of a record. It bundles two abilities: `get` (read the focus out of the whole, always succeeds) and `set` (return a *new* whole with the focus replaced — the original is untouched). From those you derive `over`/`modify` (apply a *function* to the focus). A lens is for a **product type** — "this AND that AND the other" — where the focused field is always present, so reading never fails.
</details>

**Q4. What is a prism, and how is it different from a lens?**

<details><summary>Answer</summary>

A prism focuses on **one case of a sum type** — a value that's *one of several variants* — and reading it can **fail**, because the value might be a different case. It bundles `preview` (try to read the focus — returns the value if the right case is present, "nothing" otherwise) and `review` (run backwards: build the whole *from* just a focus value). The key difference from a lens: a lens's `get` *always* succeeds (the field is always there); a prism's `preview` *may fail* (the case might not be present). **Lens = always-there field; prism = maybe-there case.** Partiality is the whole distinction.
</details>

**Q5. Give the single clearest mental model for lens vs prism.**

<details><summary>Answer</summary>

**Lens is for a product (AND); prism is for a sum (OR).** A product type is "name AND age AND address" — all fields present at once, so focusing on one is a lens (reading always works). A sum type is "Circle OR Square," "Some OR None" — exactly one variant present, so focusing on one is a prism (reading may fail because it might be the other case). This maps directly onto algebraic data types: **field of a record → lens; case of a union → prism.** Ask of any layer "is this an AND or an OR?" and the optic follows.
</details>

**Q6. What does `over` (a.k.a. `modify`) do, and how does it relate to `set`?**

<details><summary>Answer</summary>

`over` applies a *function* to the focus and returns a new whole — e.g. `cityLens.over(toUpper, user)` uppercases the city, immutably. `set` replaces the focus with a fixed value. `set(x)` is just `over` with the constant function `_ -> x`: it ignores the old focus and writes `x`. So `over` is the more general operation; `set` is the special case where the new value doesn't depend on the old one.
</details>

**Q7. Show the nested-copy pain optics remove.**

<details><summary>Answer</summary>

```javascript
// Without optics — the spread tower. Every level copied by hand.
const u2 = { ...u, address: { ...u.address, city: "Berlin" } };
// The ONE thing we wanted is `city: "Berlin"`; the rest is "keep everything the same".
```
```javascript
// With a composed lens — the tower lives in the optic, written once.
const userCity = userL.compose(addressL).compose(cityL);
const u2 = userCity.set("Berlin")(u);   // one line; both levels rebuilt for us
```
The deeper the nesting and the more often you do this, the more the optic pulls ahead — the tower is written *once* in the optic, not at every call site.
</details>

**Q8. Why can't you just mutate `user.address.city = "Berlin"`?**

<details><summary>Answer</summary>

Because in an immutable design the data may be shared (other parts of the program hold the same `user`), frozen, or relied upon to never change underfoot (the core reason for immutability — predictability, safe sharing, time-travel/undo, change detection by reference). Mutating it in place corrupts everyone else's view and breaks those guarantees. So you must produce a *new* `user` with the new city and leave the old one intact — which means rebuilding every level along the path. Optics make that rebuild painless; they don't remove the *need* for it, they remove the *boilerplate*.
</details>

**Q9. Name three things you'd use an optic for.**

<details><summary>Answer</summary>

- **Updating a deeply nested field immutably** — `set` the city in `user.address.city` (a lens).
- **Operating on one variant of a union** — "+1 the value if this JSON node is a number, else leave it" (a prism for the number case).
- **Transforming every matching element in a nested collection** — "uppercase every heading's text in a document tree" (a traversal composed with a prism and lenses).

The unifying theme: *reach into nested/branching/repeating data and read-or-update part of it, immutably, with one composable expression.*
</details>

**Q10. What is a traversal?**

<details><summary>Answer</summary>

A traversal focuses on **zero-or-more** targets at once — every element of a list, every value in a map, every matching node in a tree. It's the optic generalization of `map`: its core operation is `over`, which applies a function to *all* foci immutably (and `toList`, which collects them). A lens focuses on exactly one; a prism on zero-or-one; a traversal on zero-or-more — so a traversal is the common generalization of both. Its power shows when composed: `members . traverse . address . city` reaches and updates every member's city through a list, in one expression.
</details>

---

## Intermediate / Middle

> The operations, the lens/prism laws, the optic family, and the composition rule.

**Q11. What two functions does a lens really hold, and what are their types?**

<details><summary>Answer</summary>

`get :: S -> A` (read the focus out of the whole) and `set :: A -> S -> S` (put a new focus in, return a new whole). `S` is the whole, `A` is the focus. Everything else is derived: `over f s = set (f (get s)) s`, and `set a = over (const a)`. A lens is *literally* a getter and a setter travelling together — there's no magic; the value is that this pair becomes a first-class, composable thing.
</details>

**Q12. State the three lens laws and why they matter.**

<details><summary>Answer</summary>

- **Get-Put:** `set (get s) s == s` — writing back exactly what you read changes nothing.
- **Put-Get:** `get (set a s) == a` — you read back exactly what you set.
- **Put-Put:** `set a2 (set a1 s) == set a2 s` — the last set wins; intermediate sets are overwritten cleanly.

They matter because a lens obeying them behaves *exactly* like an honest, labeled immutable field — which is what lets you trust `over` (read/modify/write), trust composed lenses, and refactor optic code safely. A "lens" that breaks a law is a footgun: it looks like a field accessor but has side behavior, so refactors silently change meaning.
</details>

**Q13. Give a concrete example of a "lens" that breaks a law.**

<details><summary>Answer</summary>

A lens onto `email` whose **setter lowercases the input** breaks **Put-Get**: `set "Bob@X.com"` then `get` returns `"bob@x.com" ≠ "Bob@X.com"` — the lens lied about what you stored. Now `over` is wrong (it sees a normalized value, not what you set), and any read-modify-write refactor changes behavior. The fix: keep the lens a *pure, honest accessor* and put normalization in the `over` function or a separate validation step — never hide transformation in a setter.
</details>

**Q14. What two functions does a prism hold, and what are their laws?**

<details><summary>Answer</summary>

`preview :: S -> Maybe A` (try to read the focus — may fail) and `review :: A -> S` (build the whole from the focus — run backwards). Laws: **Review-Preview** `preview (review a) == Just a` (build-then-match round-trips) and **Preview-Review** `preview s == Just a ⟹ review a == s` (if a match succeeds, building from it reconstructs the original whole). Together they make a prism a *faithful, reversible* focus onto one variant — which is why prisms are perfect for `parse`/`print` pairs, `Some`/`None`, and picking one constructor of a union.
</details>

**Q15. What's an iso, and where does it sit in the hierarchy?**

<details><summary>Answer</summary>

An iso (isomorphism) is a **lossless, reversible conversion** between two types holding the same information in different shapes — `to`/`from` that are total inverses (`from (to s) == s`, `to (from a) == a`). Examples: Celsius ↔ Fahrenheit, a newtype ↔ its underlying value, a tuple ↔ a 2-field record. It sits at the **top** of the optic hierarchy because, being total and reversible, it can be *used as* a lens (its `get` always succeeds) *and* as a prism (its `preview` always succeeds, `review` = `from`). It adds no weakening, so composing an iso with X yields X.
</details>

**Q16. List the optic family and what each can do.**

<details><summary>Answer</summary>

- **Iso** — lossless reversible conversion; usable as anything below.
- **Lens** — exactly one focus; total `get`/`set`/`over`.
- **Prism** — zero-or-one focus; `preview`/`review`/`over` (no total `get`).
- **Traversal** — zero-or-more foci; `over`/`toList` (no total `get`).
- **Getter** — read-only lens (`get`, no update).
- **Fold** — read-only traversal (`toList`/`preview`, no update).
- **Setter** — write-only traversal (`over`/`set`, no read).

They form a lattice of generality: more general optics make fewer guarantees about their foci, so they support fewer operations.
</details>

**Q17. State the composition rule — the most important fact about optics.**

<details><summary>Answer</summary>

**When you compose two optics, the result is as weak as the weakest of the two — it supports only the operations both support.** Lens ∘ lens = lens. Lens ∘ prism = affine traversal (zero-or-one; you can `preview`/`over` but *not* total `get`). Lens ∘ traversal = traversal. Prism ∘ prism = prism. Iso ∘ X = X. So to read any optic path `a . b . c`, find the weakest link and you instantly know what the composite can do: a prism anywhere → no total `get`; a traversal anywhere → `over`/`toList`, no `get`. **The composite is only as strong as its weakest link**, exactly like a chain.
</details>

**Q18. Why can't a traversal support a total `get`, while a lens can?**

<details><summary>Answer</summary>

A traversal focuses on **zero-or-more** targets — there might be *none* (an empty list has nothing to read) or *many* (which one would `get` return?). So it supports `over` (map across all), `toList` (collect all), and a *partial* `preview` (the first, if any) — but not a total `get`. A lens focuses on **exactly one** target that always exists, so its `get` is total. This single fact — "how many foci?" — is what places each optic in the hierarchy.
</details>

**Q19. How does composing optics relate to the nested-copy tower?**

<details><summary>Answer</summary>

The tower *is* what composition automates. To `get` through `userL . addressL . cityL` you dig down twice; to `set` you rebuild the inner whole, then rebuild the outer whole around it — which is *exactly* `{...user, address: {...user.address, city: x}}`. The difference is that this rebuild is written **once**, inside the lens composition, and is free at every call site. Composing N optics handles an N-level copy tower; the call site stays one clean line.
</details>

**Q20. What's an "affine traversal" / "optional" optic?**

<details><summary>Answer</summary>

It's the optic you get from `lens . prism` (or `prism . lens`): a focus on **zero-or-one** target with *both* read and write. You can `preview` (maybe-read, since the prism case might not match) and `over` (modify-if-present), but you *cannot* total-`get` (there might be nothing there). It's "a traversal that hits at most one target." Many libraries surface it explicitly (Monocle's `Optional`, `optics`' `AffineTraversal`). The practical point: composing a lens with a prism doesn't give you a lens — the partiality of the prism downgrades it.
</details>

**Q21. Walk through the "uppercase every heading in a document" example.**

<details><summary>Answer</summary>

The document is `{ blocks: [...] }` where each block is a sum (`Heading | Paragraph | Image`). The optic is `blocks . traverse . _Heading . text`:
- `blocks` — a **lens** (Document → [Block]).
- `traverse` — a **traversal** (each element of the list).
- `_Heading` — a **prism** (only the Heading case).
- `text` — a **lens** (Heading → its text).

Composed, the weakest link is the traversal, so the whole thing is a **traversal**, and you use `over`: `over (blocks . traverse . _Heading . text) toUpper doc`. One expression reaches every heading's text through a list and a sum type and uppercases them all, immutably. The manual version is a nested loop with a type-check and two layers of copying — *that gap* is why optics exist.
</details>

**Q22. Why do all the optic kinds compose with the *same* operator?**

<details><summary>Answer</summary>

Because in the real (van Laarhoven/profunctor) encoding, **every optic is the same kind of thing — a function** — and functions compose with ordinary function composition. Each optic kind only differs in a *constraint* (a lens needs `Functor`, a traversal needs the stronger `Applicative`, etc.); composing the functions intersects the constraints, automatically producing the weakest optic. So "they all compose with `.`" and "composition yields the weakest link" are the *same fact*: function composition with constraint intersection. (The naive `{get, set}` encoding can't do this — it'd need a separate compose per pair of optic kinds.)
</details>

**Q22a. How does composition order read — left-to-right or right-to-left? Why does it confuse people?**

<details><summary>Answer</summary>

In Haskell's `lens`, the path reads **left-to-right as outermost-to-innermost**: `address . city` means "go into `address`, then into `city`" — the leftmost optic is the *outer* layer of the whole. This *feels* backwards if you think of `.` as mathematical function composition (`f . g` = "apply g first"), and that's the common confusion. The reconciliation: a van Laarhoven optic is a function `(focus -> f focus) -> (whole -> f whole)`, so `address`'s argument is "a function on Addresses," which is exactly what `city` *produces* — so `address . city` type-checks as ordinary composition while *reading* outer-to-inner. Most library APIs (monocle-ts's `.composeLens`, Monocle's `andThen`) read left-to-right outer-to-inner too, matching the intuitive "path from the root." The practical rule: **read an optic path like a filesystem path from the root inward**, regardless of the underlying composition mechanics.
</details>

---

## Senior — Judgment, Cost, Language Reality

> When optics pay off vs cargo-cult, the cost function, Immer, and language fit.

**Q23. Optics produce the same value as a manual copy — so what do they actually buy?**

<details><summary>Answer</summary>

They're a **cost-of-change tool, not a correctness or performance tool.** Four concrete things: (1) the copy tower written *once* (dedup of immutable-update boilerplate); (2) update paths as **first-class, composable values** you can name, pass, reuse, and combine; (3) robustness to *renames* (one optic definition, not N call sites); (4) uniform reach into *branching/repeating* nested data (lens ∘ prism ∘ traversal). They do **not** buy correctness (same result as manual) or performance (they often allocate *more*). If a use doesn't clearly hit one of those four with real weight, the optic isn't paying for itself.
</details>

**Q24. What determines whether an optic is worth it?**

<details><summary>Answer</summary>

The product **depth × repetition × branching**, gated by **team fluency × language support**. Deep nesting (4+ levels), the same path updated in many places, and "many/sum" branching updates push *toward* optics; shallow, one-off, flat updates push *away*. And it's all gated: even a perfect structural fit isn't worth it if the team can't read optics or the language has no support. A 2-level update at one call site fails the test — the spread is trivial and used once, so the optic adds reader cost with no offsetting benefit.
</details>

**Q25. When are optics over-engineering / cargo-cult?**

<details><summary>Answer</summary>

- **Shallow structure** — a lens onto a top-level field is ceremony; `{...x, y: z}` is clearer. Speculative Generality of update paths.
- **A team that can't read optics** — every optic becomes negative leverage (slower reviews, onboarding, misuse). The value is gated on fluency.
- **When a simpler tool fits** — in JS/TS, **Immer** solves the same pain at ~zero concept cost; reaching for monocle-ts when Immer would do optimizes elegance over the cost function.
- **A language without an optics culture** — Go/idiomatic-Python/Java; hand-rolling fights the grain.

Senior signal: adopting optics *because they're principled/elegant*, to solve a pain a simpler tool already covers, in a team that can't read them — that's category theory wearing a costume.
</details>

**Q26. What is Immer and how does it relate to optics?**

<details><summary>Answer</summary>

Immer is the **pragmatic, non-optic answer** to immutable nested updates in JS/TS. Instead of reifying the path (optics), you write *apparent mutation* on a "draft" inside `produce(state, draft => { draft.user.address.city = "Berlin" })`, and Immer uses a proxy to record your writes and produce an immutable copy with structural sharing. The trade: Immer needs **~zero new concepts** (it's like mutation) but the path *isn't* a reusable first-class value; optics need real vocabulary but give you composable, reusable, passable paths. For the *median* JS/TS product team, Immer is usually the right default; optics earn their seat only when the path itself must be a composed first-class value (especially prisms/traversals over branching data) *and* the team will pay the fluency cost.
</details>

**Q27. Compare optics, Immer, and manual copies as a senior would in a design review.**

<details><summary>Answer</summary>

| | Manual copy | Immer | Optics |
|---|---|---|---|
| New concepts | none | ~zero | lens/prism/traversal + composition |
| Per-update writing | full rebuild each site | mutation-looking block | one-liner `optic.set` |
| Path as reusable value | no | no | **yes** |
| Branching/many | nested loops | imperative loop in draft | one composed `over` |
| Rename-robustness | breaks at N sites | breaks at N sites | one optic definition |

The decision is the row-by-row sum *in your context*: shallow/one-off → manual or Immer; deep/branching but non-fluent team → Immer; deep/reused/composed/fluent team → optics. "We'll use Immer for state and reach for optics only where paths are deep and reused" is defensible; "everything is a lens" in a React app usually isn't.
</details>

**Q28. Which languages have real optics, and what's the friction?**

<details><summary>Answer</summary>

- **Haskell** — `lens` (Kmett — vast, powerful, cryptic operators `^.`/`.~`/`%~`/`^?`) and `optics` (cleaner, named combinators, better errors). Their true home.
- **Scala** — **Monocle**, idiomatic in FP-Scala, macro-generated lenses.
- **Kotlin** — **Arrow Optics** with a compiler plugin that *generates* the optics (the key enabler).
- **TS/JS** — monocle-ts / optics-ts (full family) or Ramda lenses (simple subset); competes with **Immer**.
- **Clojure** — **Specter** (pragmatic, performance-focused).
- **Java / Go / idiomatic Python** — no real culture; no HKT/sugar. Use records + copy/`replace`, or flatten the model. Hand-rolling fights the grain.

The abstraction's value is bounded by language support *and* team fluency.
</details>

**Q29. `lens` vs `optics` in Haskell — why does the choice matter?**

<details><summary>Answer</summary>

Both implement the same family, but `lens` (Kmett) encodes everything as cleverly-typed functions with a dense operator zoo that is a notorious teaching wall — fluent once learned, alien before, and with intimidating type errors. `optics` deliberately uses an *opaque* optic representation and *named* combinators (`view`, `set`, `over`, `preview`) with far clearer type errors — a direct response to `lens`'s steepness. The senior lesson generalizes: *the same abstraction can be packaged for cleverness or for teachability, and which you pick affects your team's cost more than the underlying math does.* Prefer the teachable packaging.
</details>

**Q30. Why is hand-rolling optics in Go a mistake?**

<details><summary>Answer</summary>

Go has no higher-kinded types, no composition sugar, and no optics culture — a hand-rolled lens library is non-idiomatic and reads slower for the next maintainer, paying the full abstraction tax with none of the ecosystem support. It's the same mistake as hand-rolling a `Result` monad in Go: the language *deliberately rejected* this style's grain in favor of explicit, visible code. The right Go answer is manual nested copies (struct value-copy + overwrite one field) or, better, *restructuring to flatten* the nesting so the copies stay shallow. Honor the grain.
</details>

**Q31. How should you expose optics in an API?**

<details><summary>Answer</summary>

Keep them **internal** to your update logic; don't leak optic types into public signatures. A public function should expose a *domain operation* (`updateCity(state, city)`), not demand callers pass a `Lens<State, String>` — that would force every consumer to learn the abstraction. Define optics **centrally** (near the data, one authoritative path per field) so rename-robustness actually holds, keep setters law-abiding and `over` functions pure (no I/O/validation hidden inside), and prefer *flattening a too-deep model* over propping it up with a deep optic stack. The optic is *how* you implement a clean update; the *contract* should be domain-shaped.
</details>

**Q32. Are optics ever a performance optimization?**

<details><summary>Answer</summary>

No — and claiming so is a red flag. Optics produce the *same* value as a manual copy (no algorithmic win) and typically allocate *more* (the functor wrappers on top of the same rebuild) unless the runtime erases the wrappers. In Haskell `-O2` the wrappers (`Const`/`Identity` newtypes) erase to nothing, so optics are zero-cost there; on the JVM/V8 the wrappers are real objects and the libraries' polymorphism often defeats the escape analysis that would scalar-replace them. So optics buy composability and readability, *sometimes at a GC cost* — never speed. If a hot path's composed traversal shows in a profile, you *collapse it to a manual copy* for speed, which is the opposite direction.
</details>

---

## Professional / Deep — Encoding, Laws, Performance

> Van Laarhoven, the Const/Identity trick, profunctors, formal laws, and runtime cost.

**Q33. Why is a lens "just a function," and why does that make optics compose with `.`?**

<details><summary>Answer</summary>

In the van Laarhoven encoding, a lens is **not** a `{get, set}` record — it's a single polymorphic function:
```haskell
type Lens' s a = forall f. Functor f => (a -> f a) -> (s -> f s)
```
It takes a "focus-function" `(a -> f a)` and returns a "whole-function" `(s -> f s)`, for *any* functor `f`. Because a lens *is a function*, two lenses compose with **ordinary function composition** `.` — `_address . _city` is just function composition, yielding the deep lens onto `user.address.city`. And the *same* `.` composes lenses with prisms with traversals, because each optic only differs in the *constraint on `f`* (lens needs `Functor`, traversal the stronger `Applicative`); composing intersects the constraints, automatically yielding the weakest optic. That's why "compose with `.`" and "weakest link" are the same fact.
</details>

**Q34. Derive `view` and `over` from one van Laarhoven lens. What's the trick?**

<details><summary>Answer</summary>

The trick is **choosing the functor `f`**:
- **`over` uses `Identity`.** `Identity a` carries the value untouched (`fmap f (Identity x) = Identity (f x)`). Feed the lens `Identity . f` and its `fmap`-rebuild performs the update: `over l f s = runIdentity (l (Identity . f) s)`.
- **`view` uses `Const`.** `Const r a` ignores its `a` and just holds an `r`, so `fmap _ (Const r) = Const r` is a **no-op**. Feed the lens a focus-function that *captures the focus into the `Const`*; the rebuild is discarded (Const ignores it), leaving only the captured focus: `view l s = getConst (l Const s)`.

One lens definition, two behaviors, selected by the caller's functor — `Identity`'s `fmap` does the rebuild (write), `Const`'s `fmap` throws it away (read). That's the elegant heart of the encoding.
</details>

**Q35. How is a traversal the same encoding as a lens?**

<details><summary>Answer</summary>

It's the *exact same function type*, with the `Functor` constraint **strengthened to `Applicative`**:
```haskell
type Traversal s t a b = forall f. Applicative f => (a -> f b) -> (s -> f t)
```
A traversal must combine the functorial results of *multiple* foci, and combining needs `pure` and `<*>` — i.e. `Applicative`. The "each element of a list" traversal *is* `traverse` from `Traversable`. Because `Applicative` is stronger than `Functor`, composing a lens (`Functor`) with a traversal (`Applicative`) forces the composite to require `Applicative` — so it's a traversal. **The functor-constraint hierarchy `Functor ⊃ Applicative` IS the optic hierarchy**, encoded in the types.
</details>

**Q36. What's the profunctor encoding and why does it exist?**

<details><summary>Answer</summary>

The profunctor encoding represents an optic as a polymorphic function over profunctors: `type Optic p s t a b = p a b -> p s t`, where a profunctor `p a b` generalizes "a function `a -> b`" (contravariant in `a`, covariant in `b`). Each optic kind adds a typeclass on `p`: **`Strong`** for lens (carry the untouched product context — "the rest of the record"), **`Choice`** for prism (carry the other branch of the sum — "the other cases"), `Wandering` for traversal, plain `Profunctor` for iso. It exists because van Laarhoven handles lens/traversal cleanly but makes *prisms and isos* awkward; the profunctor encoding handles the *whole family uniformly*. And beautifully, **`Strong`/`Choice` = product/sum = lens/prism** — the junior-level duality reappears as a precise typeclass duality. It's what `optics`, profunctor-lenses, and modern TS libraries use internally.
</details>

**Q37. State all the optic laws formally.**

<details><summary>Answer</summary>

**Lens:** `view l (set l a s) ≡ a` (PutGet), `set l (view l s) s ≡ s` (GetPut), `set l a2 (set l a1 s) ≡ set l a2 s` (PutPut).
**Prism:** `preview l (review l a) ≡ Just a` (ReviewPreview), `preview l s ≡ Just a ⟹ review l a ≡ s` (PreviewReview).
**Iso:** `from (to s) ≡ s` and `to (from a) ≡ a` (total inverses).
**Traversal:** `over t id ≡ id` (no duplicate/drop foci) and `over t (g . f) ≡ over t g . over t f` (composition/fusion — two passes equal one).

These are the **license for refactorings**: PutGet justifies read/modify/write, GetPut deletes no-op write-backs, PutPut collapses consecutive sets, the prism round-trips justify trusting `parse`/`print` pairs, and the traversal laws justify fusing passes.
</details>

**Q38. What does a composed optic cost at runtime?**

<details><summary>Answer</summary>

Per level: the **functor wrapper** (`Const`/`Identity`/the applicative structure) plus the **closure** the optic captures, on top of the **rebuilt node** (the new copy — which a manual copy also pays). So an optic allocates the *same rebuild as a manual copy plus the wrappers* — it allocates *more*, not less. Whether that's real depends on erasure: in **GHC `-O2`**, `Const`/`Identity` are `newtype`s with zero runtime representation and `lens` is `INLINE`d, so the wrappers *vanish* — optics are genuinely zero-cost (traversals still scale with the collection, like `map`). On the **JVM/V8**, the wrappers are real heap objects, and the libraries' heavy polymorphism frequently *defeats* the inlining that escape analysis needs to scalar-replace them — so the allocations are real young-gen pressure. Prove it with `+RTS -s` / JMH `-prof gc` / heap snapshots.
</details>

**Q39. A composed traversal is hot in a flame graph. What do you do?**

<details><summary>Answer</summary>

First *measure*: confirm with allocation profiling that the optic version allocates materially more than a manual copy *and* that the path is genuinely hot. If so, **collapse the optic into a hand-written update** that copies only the touched spine — the de-optic analogue of de-monadizing a hot bind chain. Keep the change behind a clean boundary with a committed benchmark, and de-optic *only* there — everywhere else the readability/composability is the point. An un-benchmarked "I de-optic'd for speed" is premature optimization in functional clothing. (In Haskell you'd rarely need this — `-O2` erases the wrappers — so this is mostly a JVM/V8 concern.)
</details>

**Q40. How do you verify a custom optic is lawful?**

<details><summary>Answer</summary>

**Property-based testing** — it's non-negotiable for any hand-written optic. Generate random wholes and foci and assert the laws hold: for a lens, PutGet/GetPut/PutPut; for a prism, the two round-trip laws; for a traversal, identity and composition. Use QuickCheck (Haskell, often via `lens`'s own law combinators), ScalaCheck / `monocle-law` (Scala), or fast-check (TS). This catches the classic bugs: a normalizing setter (breaks PutGet), a `parse`/`print` pair that loses information (breaks the prism round-trips), a traversal that visits a focus twice (breaks composition). An optic that passes example tests but not property tests is a landmine that breaks under a harmless refactor.
</details>

---

## Code-Reading — What Does This Produce?

> You're shown a snippet; predict the output or name the optic.

**Q41. What does this produce, and is the original mutated?**

```python
addr = Address(street="5 Main", city="London", zip="EC1")
result = city_lens.set("Berlin", addr)
print(result.city, addr.city)
```

<details><summary>Answer</summary>

Prints **`Berlin London`**. `set` returns a *new* address with `city="Berlin"`; the original `addr` is **untouched** (its city is still `"London"`). This is the core property: optics never mutate — `set`/`over` always return a fresh whole. If you'd ignored the return value (`city_lens.set("Berlin", addr)` without assigning), nothing observable would happen to `addr` — a common no-op bug for people used to `addr.city = ...`.
</details>

**Q42. What does `preview` return for each call?**

```haskell
preview _Just (Just 5)     -- (a)
preview _Just Nothing      -- (b)
review  _Just 5            -- (c)
```

<details><summary>Answer</summary>

(a) **`Just 5`** — the prism matched the `Just` case, returning the focus wrapped in `Maybe`. (b) **`Nothing`** — the value is the *other* case (`Nothing`), so the prism's `preview` fails (returns `Nothing`). (c) **`Just 5`** — `review` runs the prism *backwards*, building the whole (a `Maybe Int`) from the focus `5`, giving `Just 5`. The reading skill: `preview` is the partial read (may fail because of the wrong case), `review` is the backwards constructor.
</details>

**Q43. What optic kind is `blocks . traverse . _Heading . text`, and which operation must you use?**

```haskell
result = over (blocks . traverse . _Heading . text) toUpper doc
```

<details><summary>Answer</summary>

It's a **traversal** (the composite). The chain is lens (`blocks`) ∘ traversal (`traverse`) ∘ prism (`_Heading`) ∘ lens (`text`); the weakest link is the traversal, so the whole composite is a traversal. You must use **`over`** (not `set`/`view`) — a traversal can hit zero-or-many foci, so it has no total `get`, and `over` maps the function across *all* foci. `result` is a new document where every heading's text is uppercased, immutably; paragraphs and images are untouched (the prism skips them).
</details>

**Q44. Why does this type-check fail?**

```haskell
view (account . _Premium . discount) user   -- TYPE ERROR
```

<details><summary>Answer</summary>

Because the path contains a **prism** (`_Premium`), so the composite is an **affine traversal** (zero-or-one focus) — the account might *not* be the `Premium` case, so the focus may be absent. `view` requires a focus that's *always* present (a `Getter`/`Lens`), which the composite can't promise. You must use **`preview`** instead (`preview (account . _Premium . discount) user :: Maybe Double`), which returns `Just discount` if the account is Premium and `Nothing` otherwise. The composition rule predicts this: a prism anywhere in the path kills the total `get`/`view`.
</details>

**Q45. Convert this manual update to its optic, and say which optic kind.**

```javascript
const u2 = { ...u, profile: { ...u.profile, settings: { ...u.profile.settings, theme: "dark" } } };
```

<details><summary>Answer</summary>

It's a chain of three **lenses** (all fields, all always present), composed into one lens — composition of lenses yields a lens:

```javascript
const themeL = profileL.compose(settingsL).compose(themeL_);   // lens . lens . lens = lens
const u2 = themeL.set("dark")(u);                               // one line, three levels rebuilt
```

Since every layer is a product field, it's a pure lens path with a total `set`. The optic packages the three-level spread tower into one composable value; the call site collapses from the nested spread to `themeL.set("dark")(u)`.
</details>

---

**Q45a. What does this Specter-style / traversal `over` produce, and what's the key property?**

```python
# A traversal "each element of a list" composed with a lens onto a record field.
team = Team(members=[User("Ada", 36, Address("5 Main", "london", "EC1")),
                     User("Bo",  29, Address("9 Oak",  "paris",  "75001"))])
result = over(members_each . address . city, str.title, team)
print([m.address.city for m in result.members],
      [m.address.city for m in team.members])
```

<details><summary>Answer</summary>

Prints **`['London', 'Paris'] ['london', 'paris']`**. The composed optic `members_each . address . city` is a **traversal** (the `members_each` link is "many"), so `over` maps `str.title` across *every* member's city, returning a brand-new `Team` with both cities title-cased. The key property — and the reading skill — is that the **original `team` is untouched** (`['london', 'paris']`): the traversal rebuilt the entire spine (new team, new members list, new users, new addresses) with structural sharing of everything it didn't touch, immutably. One expression updated every nested target across a collection without a single explicit copy.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q46. Explain optics without using "functor," "category," or any other jargon.**

<details><summary>Answer</summary>

An optic is a **reusable pointer into a piece of nested data that can read it and make an updated copy without changing the original.** A *lens* points at a field that's always there (like the city inside an address inside a user) — it can read it and replace it. A *prism* points at a case that might be there (like "this value is the number variant, not the string variant") — reading might come up empty. You build the pointer once and reuse it; you can glue two pointers together to reach deeper. The whole point is to stop hand-writing "copy everything else the same" every time you update one buried field.
</details>

**Q47. Are optics a performance win? Defend your answer.**

<details><summary>Answer</summary>

**No.** They produce the *same* value as a hand-written copy (no algorithmic improvement) and typically allocate *more* — the functor wrappers on top of the identical rebuild. They're free *only* when the runtime erases those wrappers: in Haskell `-O2`, `Const`/`Identity` are `newtype`s that compile away, so optics are zero-cost; on the JVM/V8 the wrappers are real objects and the libraries' polymorphism often defeats the escape analysis that would erase them, so it's *measurably more* garbage. Optics buy **composability and readability, sometimes at a GC cost.** If anything, the performance *fix* on a hot path is to *remove* the optic and write a manual copy. Anyone selling a lens on speed has it backwards.
</details>

**Q48. If optics are so elegant, why doesn't every codebase use them?**

<details><summary>Answer</summary>

Because elegance isn't a cost function. Optics carry a steep **fluency cost** (lens/prism/traversal + the composition-degradation rule + the library's idioms), and that cost is paid by *every reviewer and every new hire forever*, while the *benefit* (dedup of the copy tower, reusable paths) only materializes when the structure is *deep* and updated in *many* places. For shallow or one-off updates, a plain spread is clearer; for the median JS/TS team, **Immer** solves the same pain at ~zero concept cost. And in Go/Java/idiomatic-Python there's no support or culture. So optics are excellent in a fluent FP/Scala/Haskell shop with deep branching state, and over-engineering most other places — the same "abstraction is gated on fluency and depth" reality as monad transformers.
</details>

**Q49. Is `?.` (optional chaining) a prism?**

<details><summary>Answer</summary>

Not exactly — it's a *syntax*, not a first-class optic value — but it captures part of a prism's *behavior*. `a?.b?.c` is "thread the value through, stop at the first `null`," which is the read direction of a `Maybe`/null prism baked into an operator. The differences that matter: `?.` only *reads* (and only the null case — no `review`/build-backwards, no general sum types), it's not a value you can compose/pass/reuse, and it has no `over`/update story. A prism is a first-class, reversible, composable focus onto *any* sum variant with read *and* the backwards `review`. So `?.` is "a prism's short-circuit read, specialized to null and lowered to syntax" — the idea without the generality or the update side.
</details>

**Q50. A teammate proposes a "lens" whose setter validates and throws on bad input. Good idea?**

<details><summary>Answer</summary>

No — it breaks the abstraction in two ways. First, a throwing setter makes `over` *partial* and breaks referential transparency; the whole edifice rests on optics being pure total functions. Second, validation in a setter tends to break **Put-Get** (if it normalizes) and makes the "lens" lie about what it stored, silently corrupting read-modify-write refactors. Validation is a *separate concern*: keep the lens an honest, total, pure accessor, and run validation as an explicit step in the pipeline (returning a `Result`/`Either` for the failure). Smuggling effects or validation into an optic is exactly the kind of leaky abstraction the laws are designed to forbid.
</details>

**Q51. You're in Go. How do you "do optics"?**

<details><summary>Answer</summary>

You don't — and that's the right answer. Go has no higher-kinded types, no composition sugar, and no optics culture; a hand-rolled lens library reads slower for the next maintainer and fights the language's preference for explicit, visible code. The idiomatic Go answer to nested immutable updates is a **manual nested copy** (value-copy each struct, overwrite the one field, graft it back), or — better — **restructuring the model to be flatter** so the copies stay shallow. If the nesting is so deep that manual copies hurt, that's a signal to flatten the domain, not to import an abstraction the language rejected. Same lesson as "don't hand-roll a `Result` monad in Go."
</details>

**Q52. The product/sum duality keeps coming up — lens/prism, Strong/Choice. Why is it so fundamental?**

<details><summary>Answer</summary>

Because **all algebraic data is built from products (AND) and sums (OR)**, and optics are *ways to focus into that structure* — so the optic family inevitably mirrors the data-construction family. A lens decomposes a product (`S = A` *and* "the rest") → it needs to carry the untouched "rest" → that's the `Strong` profunctor. A prism decomposes a sum (`S = A` *or* "other cases") → it needs to carry the other branch → that's the `Choice` profunctor. Iso is the degenerate case (no AND/OR split — same information, reshaped) → plain `Profunctor`, top of the hierarchy. The duality is fundamental because it's just the product/sum duality of the data itself, viewed from the "how do I focus on a part" angle. Spotting "is this layer an AND or an OR?" is *the* skill for choosing an optic.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q53. Lens vs prism in one line?**

<details><summary>Answer</summary>

Lens = focus on an always-present field (product/AND), `get` always succeeds; prism = focus on a maybe-present case (sum/OR), `preview` may fail.
</details>

**Q54. What problem do optics solve?**

<details><summary>Answer</summary>

Composable, reusable immutable updates to deeply nested data — killing the per-call-site copy tower.
</details>

**Q55. The two lens operations?**

<details><summary>Answer</summary>

`get :: S -> A` (read the focus) and `set :: A -> S -> S` (return a new whole with the focus replaced); `over` is derived.
</details>

**Q56. The two prism operations?**

<details><summary>Answer</summary>

`preview :: S -> Maybe A` (try to read — may fail) and `review :: A -> S` (build the whole backwards from the focus).
</details>

**Q57. The composition rule?**

<details><summary>Answer</summary>

A composed optic is as weak as its weakest link — a prism or traversal in the path kills the total `get`.
</details>

**Q58. What's a traversal?**

<details><summary>Answer</summary>

An optic onto zero-or-more foci (every element); the optic version of `map`; supports `over`/`toList`, no total `get`.
</details>

**Q59. Why does a lens compose with `.`?**

<details><summary>Answer</summary>

Because (van Laarhoven) a lens *is a function* `(a -> f a) -> (s -> f s)`, and functions compose with function composition.
</details>

**Q60. `Const` vs `Identity` functor — which gives what?**

<details><summary>Answer</summary>

`Const` (fmap is a no-op) gives `view` (read); `Identity` (carries the value) gives `over` (write).
</details>

**Q61. Are optics faster than manual copies?**

<details><summary>Answer</summary>

No — same result, usually *more* allocation; free only when the runtime erases the functor wrappers (always GHC `-O2`, sometimes JVM/V8).
</details>

**Q62. The pragmatic JS alternative to optics?**

<details><summary>Answer</summary>

Immer — "mutate a draft, I produce the immutable copy" — zero new concepts; the median product team's default.
</details>

**Q63. When are optics overkill?**

<details><summary>Answer</summary>

Shallow structure, one-off updates, a team that can't read them, or a language without support (Go/Java/idiomatic Python).
</details>

**Q64. The one lens law most often broken?**

<details><summary>Answer</summary>

Put-Get — broken by a setter that normalizes/validates (`get (set a s) != a`); keep lenses honest accessors.
</details>

---

## How to Talk About Optics in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the pain, then the tool.** Start with the nested-copy tower (`{...x, y: {...x.y, z}}`), say "that boilerplate is what optics delete," *then* introduce lens/prism. Opening with "a lens is a `forall f. Functor f =>` function" signals memorization, not understanding.
- **Nail the lens/prism = product/sum duality.** It's the single clearest mental model and a frequent question. "Field of a record → lens; case of a union → prism" proves you understand *why*, not just *what*.
- **Know the composition rule and state it as "weakest link."** Being able to read `lens . prism . traversal` and say "it's a traversal, so `over` only, no `view`" is the middle-level depth marker.
- **Be honest that optics aren't a performance win.** "Same result as a manual copy, usually *more* allocation, free only when the runtime erases the wrappers" is a strong professional signal — most candidates assume optics are an optimization.
- **Show the van Laarhoven insight if pushed.** "A lens is just a function `(a -> f a) -> (s -> f s)`, which is *why* it composes with `.`, and you get `view`/`over` by choosing `Const`/`Identity`" is the senior/principal-grade answer. Derive the `Const`/`Identity` trick if you can.
- **Name the trade-offs and the alternative.** Fluency cost, depth × repetition × branching, **Immer** as the pragmatic JS default, Go's no-fit. "It depends, here's on what" beats evangelism.
- **Don't oversell.** Optics are gorgeous and frequently over-applied. Calibrated enthusiasm ("excellent for deep branching state in a fluent FP shop; Immer or a spread otherwise") reads as experience; "everything should be a lens" reads as having just discovered them.

---

## Summary

- An **optic** is a first-class, composable focus into a data structure that bundles reading and immutable updating — the cure for the nested-copy tower of immutable updates.
- A **lens** focuses on an always-present field (`get`/`set`/`over`) — for **product** types. A **prism** focuses on a maybe-present case (`preview`/`review`) — for **sum** types; partiality is the difference. A **traversal** focuses on zero-or-more targets (`over`/`toList`) — the optic version of `map`. An **iso** is a lossless reversible conversion at the top of the hierarchy.
- **The single clearest mental model: lens = product (AND), prism = sum (OR)** — straight from algebraic data types, and it reappears at the deep level as the `Strong`/`Choice` profunctor duality.
- **The composition rule** — a composed optic is *as weak as its weakest link* — lets you read any optic path and know its operations: a prism or traversal kills the total `get`.
- **The deep insight:** a lens is *just a function* `forall f. Functor f => (a -> f b) -> (s -> f t)`, which is *why* optics compose with ordinary `.`; you recover `view` (via `Const`, whose `fmap` is a no-op) and `over` (via `Identity`, which rebuilds) from one definition by choosing the functor. The functor-constraint hierarchy `Functor ⊃ Applicative` *is* the optic hierarchy.
- **Optics are a cost-of-change tool, not correctness or performance:** same value as a manual copy, usually *more* allocation, free only when the runtime erases the functor wrappers. The signal for adopting them is **depth × repetition × branching**, gated by **team fluency × language support**.
- **Language reality:** first-class in Haskell (`lens`/`optics`), Scala (Monocle), Kotlin (Arrow), Clojure (Specter); a situational library competing with **Immer** in TS/JS; a misfit in Go/Java/idiomatic-Python.
- The strongest interview answers **lead with the copy-tower pain**, nail the **product/sum duality**, state the **weakest-link composition rule**, are **honest that optics aren't a performance win**, can **derive the van Laarhoven `Const`/`Identity` trick** when pushed, and **name Immer and the depth × repetition cost function** for when *not* to reach for optics.

---

## Related Topics

- [Functional Programming Roadmap](../README.md) — the section index.
- [Immutability → `senior.md`](../03-immutability/senior.md) — the core motivation; optics are the composable answer to "update without mutating."
- [Algebraic Data Types → `senior.md`](../06-algebraic-data-types/senior.md) — product vs sum *is* lens vs prism; the data side of the duality.
- [Composition → `senior.md`](../05-composition/senior.md) — optic composition is function composition; the van Laarhoven encoding makes it literal.
- [Map / Filter / Reduce → `middle.md`](../04-map-filter-reduce/middle.md) — a traversal generalizes `map` to reach into nested, branching structures.
- [Monads — Plain English → `senior.md`](../09-monads-plain-english/senior.md) — the same "abstraction gated on fluency and language grain; don't hand-roll where the language rejected it" judgment.
- **Functors & Applicatives** (sibling topic `13-functors-and-applicatives`) — the machinery the van Laarhoven optic encoding is built on.
