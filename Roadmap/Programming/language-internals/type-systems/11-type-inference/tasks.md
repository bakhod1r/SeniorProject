# Type Inference — Tasks & Exercises

> **Topic:** [Type Inference](README.md)
> **Focus:** Hands-on exercises that build inference intuition — predict what the compiler infers, run Algorithm W by hand, find where inference fails, and fix cryptic errors with one well-placed annotation.

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Warm-Up: Predict the Inferred Type](#warm-up-predict-the-inferred-type)
3. [Tier 1 — Local Inference (var / auto / := )](#tier-1--local-inference-var--auto--)
4. [Tier 2 — Hindley-Milner by Hand](#tier-2--hindley-milner-by-hand)
5. [Tier 3 — Where Inference Breaks](#tier-3--where-inference-breaks)
6. [Tier 4 — TypeScript Inference](#tier-4--typescript-inference)
7. [Tier 5 — Diagnose & Annotate](#tier-5--diagnose--annotate)
8. [Capstone Projects](#capstone-projects)
9. [Self-Assessment Checklist](#self-assessment-checklist)

---

## How to Use This Page

Each task states a **goal**, gives a **self-check** so you know when you're done, offers a **hint** (collapsed in spirit — read it only if stuck), and — for the harder ones — a **sparse solution** showing the key idea, not the full code. Do the prediction tasks *before* running the compiler: the entire skill is anticipating what inference will do, then confirming. Where a task says "run it," actually run it — inference behavior is exact and your prediction is either right or wrong.

A recurring meta-instruction: when a task asks you to predict a type, also predict *why* — which clue the compiler reads. "It's `int` because `0` is an `int` literal" is a complete answer; "it's `int`" alone is not.

---

## Warm-Up: Predict the Inferred Type

For each, write the inferred type **and the clue** the compiler used. Then verify (IDE hover, or print the type).

```go
a := 42
b := "hi"
c := 3.14
d := a < c        // trick: does this even compile?
e := []int{1, 2}
```

```java
var f = 1_000_000;
var g = 1_000_000L;
var h = new java.util.ArrayList<String>();
var i = h.get(0);
```

```rust
let j = 5;
let k = 5.0;
let l = "abc";
let m = vec![1u8, 2, 3];
```

**Self-check:** `a`=int, `b`=string, `c`=float64, `d`=**does not compile** (Go won't compare `int` and `float64`), `e`=`[]int`. `f`=int, `g`=long, `h`=`ArrayList<String>`, `i`=String. `j`=i32, `k`=f64, `l`=&str, `m`=`Vec<u8>`.

**Hint:** Local inference reads the *initializer*. A numeric literal defaults (`int`/`i32`, `double`/`f64`) unless suffixed (`L`, `u8`). `d` fails because inference faithfully gives `a:int` and `c:float64`, and Go forbids mixed-type comparison — inference reflecting a real type rule.

---

## Tier 1 — Local Inference (var / auto / :=)

### Task 1.1 — The empty-container failure

**Goal:** Reproduce the "inference has no clue" failure and fix it three ways.

```rust
fn main() {
    let v = Vec::new();   // make this compile
    println!("{:?}", v);
}
```

**Self-check:** You found *three* distinct fixes that each compile.
**Hint:** The clue is missing because the vector is empty. Supply it via the variable, the constructor, or a later use.

<details><summary>Sparse solution</summary>

```rust
let v: Vec<i32> = Vec::new();   // 1: annotate the variable
let v = Vec::<i32>::new();      // 2: annotate the constructor
let mut v = Vec::new(); v.push(1i32);  // 3: a later use pins the type
```
</details>

### Task 1.2 — The `auto` copy bug (C++)

**Goal:** Write a loop where `auto` silently copies, measure or reason about the cost, then fix it.

```cpp
std::vector<std::string> names = /* 1M long strings */;
for (auto name : names) { use(name); }   // what's wrong?
```

**Self-check:** You can state *why* it's slow and give the one-token fix.
**Hint:** `auto` deduces the value type and strips references.

<details><summary>Sparse solution</summary>

Each iteration copies a `std::string`. Fix: `for (const auto& name : names)` — bind by reference, no copy.
</details>

### Task 1.3 — Manifest vs. non-manifest types

**Goal:** Classify each line as "inference OK" (type manifest) or "should annotate" (type hidden), and rewrite the hidden ones.

```java
var users = userRepository.findAll();
var x = process(input);
var it = map.entrySet().iterator();
var result = service.handle(request);
```

**Self-check:** You annotated exactly the lines where a reader can't see the type on the line itself.
**Hint:** Ask: "Reading only this one line, do I know the type?"

### Task 1.4 — The numeric-width trap

**Goal:** Write a program where an inferred `int` overflows, then fix it by annotation.

**Self-check:** The buggy version compiles but produces a wrong/overflowed value; the fixed version is correct.
**Hint:** `var x = 0;` is `int`, not `long`. A sum of many large values overflows silently.

---

## Tier 2 — Hindley-Milner by Hand

### Task 2.1 — Trace `\x -> x + 1`

**Goal:** Run Algorithm W on paper. List fresh variables, constraints, the substitution, and the final type.

**Self-check:** Final type is `Int -> Int` (assuming `(+) :: Int -> Int -> Int`), and you can name the constraint that pinned `x`.

<details><summary>Sparse solution</summary>

`x : t0`; using `x` as a `(+)` argument gives `t0 = Int`; substitution `{t0 ↦ Int}`; result `Int -> Int`.
</details>

### Task 2.2 — Trace `\f g x -> f (g x)`

**Goal:** Derive the type of function composition with no annotations.

**Self-check:** You arrive at `(b -> c) -> (a -> b) -> a -> c`.
**Hint:** `g x` forces `g : t2 -> t3`; `f (g x)` forces `f : t3 -> t4`. Rename to `a b c`.

### Task 2.3 — Prove `\x -> x x` fails

**Goal:** Show, step by step, why self-application is rejected. Name the exact rule.

**Self-check:** You wrote the constraint `t0 = t0 -> t1` and identified the **occurs-check** as the rule that rejects it.
**Hint:** Try to unify `t0` with a type that contains `t0`.

### Task 2.4 — `let` vs. lambda

**Goal:** Write both versions in OCaml or Haskell; predict which compiles; explain via let-polymorphism.

```text
A:  let id = \x -> x in (id True, id 0)
B:  \id -> (id True, id 0)
```

**Self-check:** A compiles, B fails. You can explain: `let`-bound `id` is generalized to `forall a. a -> a`; the lambda parameter `id` is monomorphic and `Bool`/`Int` clash.
**Hint:** Generalization happens at `let`, never at lambda parameters.

### Task 2.5 — Predict principal types

**Goal:** Without a compiler, write the principal type of each, then verify in GHCi/OCaml.

```text
\x y -> x
\x -> [x]
\f xs -> map f xs
\p x -> if p x then x else x
```

**Self-check:** `forall a b. a -> b -> a`; `forall a. a -> [a]`; `forall a b. (a->b) -> [a] -> [b]`; `forall a. (a -> Bool) -> a -> a`.

---

## Tier 3 — Where Inference Breaks

### Task 3.1 — Ambiguous type variable

**Goal:** Write a Haskell expression that triggers "ambiguous type variable," then fix it with a single annotation.

**Self-check:** The unfixed version errors with "ambiguous type variable"; the fixed version compiles, and the only change is one `:: T`.
**Hint:** A type constrained by `Read`/`Show` that never appears in the result is ambiguous.

<details><summary>Sparse solution</summary>

```haskell
bad s  = show (read s)             -- ambiguous: the middle type is invisible
good s = show (read s :: Int)      -- pinned
```
</details>

### Task 3.2 — Hit the monomorphism restriction

**Goal:** Write a binding that the MR refuses to generalize, observe the error, fix it two ways.

**Self-check:** You reproduced the MR error and fixed it with (a) a type signature and (b) `{-# LANGUAGE NoMonomorphismRestriction #-}`.
**Hint:** A constraint-carrying binding with *no arguments on the left* (`let g = read`) is the classic trigger.

### Task 3.3 — Higher-rank needs an annotation

**Goal:** Write a function that takes a polymorphic function as an argument. Show it fails without a signature and works with `RankNTypes` + an annotation.

```haskell
applyToBoth f = (f 1, f True)   -- make this typecheck
```

**Self-check:** Without the rank-2 signature it fails (the parameter is forced monomorphic); with `(forall a. a -> a) -> (Int, Bool)` it compiles.
**Hint:** The `forall` must appear in *argument* position, and inference can't put it there for you.

### Task 3.4 — Subtyping vs. inference (Scala or TS)

**Goal:** Demonstrate that `if cond then dog else cat` infers a *supertype* (or union), not what you might expect, and annotate to control it.

**Self-check:** You can state the inferred least-upper-bound (e.g. `Animal`, or a union) and how an annotation changes it.
**Hint:** With subtyping, the inferred type of a branch is the *common* type of the arms, not a specific one.

---

## Tier 4 — TypeScript Inference

### Task 4.1 — Widening and `as const`

**Goal:** Make this compile *without* changing `draw`.

```typescript
type Shape = "circle" | "square";
function draw(s: Shape) {}
const shapes = ["circle", "square"];
shapes.forEach(draw);   // error — fix the inference, not draw
```

**Self-check:** Two valid fixes that each compile.
**Hint:** The array's elements widened to `string`. Stop the widening, or annotate the array.

<details><summary>Sparse solution</summary>

```typescript
const shapes: Shape[] = ["circle", "square"];        // annotate
const shapes2 = ["circle", "square"] as const;       // stop widening
```
</details>

### Task 4.2 — Contextual typing and `noImplicitAny`

**Goal:** Show a callback whose parameter is inferred from context, then break it by extracting the callback into a standalone `const`, then fix the broken version.

**Self-check:** Inline version compiles with no annotation; extracted version errors (implicit `any`); annotated extracted version compiles.
**Hint:** Inference needs an expected type to flow *into* the callback; a standalone `const` has none.

### Task 4.3 — Generic inference from arguments

**Goal:** Write a generic function whose type parameter is inferred from the *argument*, then write one where it *only* appears in the return position and must be supplied explicitly.

```typescript
function first<T>(xs: T[]): T | undefined { return xs[0]; }
function make<T>(): T[] { return []; }
```

**Self-check:** `first([1,2,3])` infers `T = number`; `make()` cannot infer `T` and needs `make<number>()` or a target annotation.
**Hint:** Inference flows from arguments, not from a bare return position.

### Task 4.4 — Best common type

**Goal:** Predict the inferred type of `[1, "a", null]` and `[new Dog(), new Cat()]` (given `Dog`/`Cat` extend `Animal`). Verify.

**Self-check:** `(string | number | null)[]`; and `(Dog | Cat)[]` (TS unions rather than collapsing to `Animal[]` for object literals — verify the exact behavior in your TS version).
**Hint:** TS computes a type compatible with all elements — a union when no single best type exists.

---

## Tier 5 — Diagnose & Annotate

### Task 5.1 — The error in the wrong place

**Goal:** Given a Haskell module where the compiler points at `report` but the bug is in `total`, find and fix the real bug, and explain why the error was mislocated.

```haskell
total :: [Int] -> String          -- BUG is here
total = foldr (\x acc -> show x ++ acc) ""

report xs = putStrLn ("sum=" ++ show (sumOf xs))
  where sumOf = sum               -- error reported around here
```

**Self-check:** You corrected `total`'s type/impl (it should return `Int`), and you can explain that unification reported the clash at the *use* site, not the buggy definition.
**Hint:** Trace types backward from the reported line until two usages disagree.

### Task 5.2 — Reveal the inferred type

**Goal:** Use the "force an error to print the type" trick in Rust and TypeScript to reveal what inference actually chose.

**Self-check:** You produced a compiler message that names the real inferred type.

<details><summary>Sparse solution</summary>

```rust
let v = data.iter().map(|x| x.len()).collect::<Vec<_>>();
let _: () = v;   // error message prints v's real type
```
```typescript
const x = something();
const _: never = x;   // error reveals x's type
```
</details>

### Task 5.3 — One seed annotation fixes a cascade

**Goal:** Find a small program where one wrong/under-constrained type produces many call-site errors, and fix all of them by annotating a *single* boundary.

**Self-check:** Removing your one annotation reproduces the flood; adding it back fixes everything and localizes any remaining error.
**Hint:** The boundary is usually the function whose inferred type all the failing call sites depend on.

### Task 5.4 — Write the annotation policy

**Goal:** Draft a 6–10 line annotation policy for a team in your language of choice, then encode at least one rule as a linter config.

**Self-check:** Your policy distinguishes boundaries (annotate) from bodies (infer), addresses `var`/`auto`/widening, and includes at least one CI-enforceable rule (e.g. `@typescript-eslint/explicit-module-boundary-types`).

---

## Capstone Projects

### Capstone A — A toy Hindley-Milner inferencer

**Goal:** Implement Algorithm W for the lambda calculus with `let`: fresh variables, constraint generation, unification with the occurs-check, and generalization. Test it on `\x -> x`, `\f g x -> f (g x)`, `let id = \x -> x in (id True, id 0)`, and `\x -> x x` (must reject).

**Self-check:** It infers `forall a. a -> a` for identity, the composition type for compose, accepts the `let` example, and rejects self-application with an occurs-check error. Bonus: it reports a useful error location.

**Hint:** Core data types: `Type = Var name | Con name | Arrow Type Type`. Unification returns a substitution; apply substitutions transitively. Generalize only at `let`, instantiating `forall` with fresh vars at each use.

### Capstone B — Inference behavior matrix

**Goal:** Build a table across five languages (Go, Java, Rust, TypeScript, Haskell) documenting, for the *same* small program, what each infers, where each requires an annotation, and how each reports the empty-container and ambiguity failures. Include a screenshot/transcript of each error.

**Self-check:** Every cell is filled with a *verified* (run, not guessed) result, and you can explain each difference in terms of local-vs-global inference and subtyping.

### Capstone C — "Annotate to fix the error" katas

**Goal:** Collect (or construct) ten real-world cryptic inference errors — TS widening, HM ambiguity, MR, mislocated unification error, Rust "type annotations needed," `auto`-copy. For each, write the *minimal* annotation that fixes it and a one-sentence explanation of *why* inference failed.

**Self-check:** Each fix is minimal (one annotation), each explanation names the precise cause (no clue / ambiguous constraint / widening / monomorphic param / undecidable feature).

---

## Self-Assessment Checklist

You understand type inference well enough when you can:

- [ ] Explain why inference is *not* dynamic typing, with the reassignment litmus test.
- [ ] Distinguish local (`var`/`auto`/`:=`) from global (HM) inference and name what each requires you to annotate.
- [ ] Run Algorithm W by hand: fresh variables → constraints → unification → generalization.
- [ ] State the occurs-check and why `\x -> x x` fails.
- [ ] Explain let-polymorphism: why `let id = \x->x` is reusable but `\id -> (id True, id 0)` isn't.
- [ ] Define principal type and why HM always finds it.
- [ ] List the four features that break full inference (subtyping, overloading/typeclasses, higher-rank, polymorphic recursion) and why each needs annotation.
- [ ] Explain bidirectional checking (synthesis vs. checking) and why it localizes errors better than HM.
- [ ] Predict TypeScript widening and fix it with `as const` or an annotation.
- [ ] Explain why `auto` copies and how to bind by reference.
- [ ] Diagnose a mislocated type error and fix it with one boundary annotation.
- [ ] Articulate the boundary principle and write an annotation policy enforceable in CI.

---

## Notes on Verifying Your Work

- **Haskell/OCaml:** use `ghci`/`utop` and `:t expr` to print inferred types; enable `-Wall`. Force ambiguity and the MR deliberately to see the real messages.
- **Rust:** rust-analyzer shows inferred types inline; the `let _: () = v;` trick prints any inferred type in an error.
- **TypeScript:** hover in the editor, or use `// ^?` twoslash queries; trip a `never` assignment to reveal a type. Run with `strict` on.
- **C++:** print `typeid(x).name()` (demangle it) or trip a deliberate template error; check reference/const with `static_assert(std::is_same_v<decltype(x), T>)`.
- **Go/Java/C#:** `fmt.Printf("%T", x)` (Go); IDE hover (Java/C#). Confirm numeric widths explicitly.

Always predict first, then verify. The gap between your prediction and the compiler's answer is exactly the part of inference you don't yet understand.
