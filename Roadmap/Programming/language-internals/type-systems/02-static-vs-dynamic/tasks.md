# Static vs Dynamic Typing — Tasks & Exercises

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** Hands-on exercises that turn the static/dynamic distinction, the strong/weak axis, gradual typing, soundness, erasure, and the performance/migration story into muscle memory.

---

## How to Use This Page

Each task states a goal, gives you a **self-check** (how to know you're right), then **hints**, then a **sparse solution** (key idea, not a full transcript). Resist peeking. Try to run things — a REPL, `tsc`, `mypy`, `go build`, `ghci` — because *seeing* where the error lands (build vs run) is the entire lesson. Tasks are grouped by level; do them in order if you're new to the topic.

Languages used: Python, JavaScript/TypeScript, Go, Java, Haskell. You don't need all of them — substitute the static/dynamic language you know, but the cross-language contrasts are where the insight lives.

---

## Level 1 — Foundations (Junior)

### Task 1.1 — Where does the error land?

Write the *same* type-buggy program in a dynamic language (Python) and a static one (Go or Java): a function that returns a greeting using a **misspelled field name** (`user.naem`). Run both.

**Self-check:** The dynamic version *starts running* and crashes only when the bad line executes (or, in JS, prints `Hello, undefined` with no error at all). The static version **fails to build** — you never get a runnable program.

<details>
<summary>Hints</summary>

- In Python, put the typo inside a function and only call it at the end — notice the program does work first, then crashes.
- In Go/Java, the field-access typo is a compile error pointing right at the name.
- Try the JavaScript version too and note it doesn't even throw.
</details>

<details>
<summary>Sparse solution</summary>

Python: `return "Hi, " + user.naem` → `AttributeError` *at runtime*, only when called. JS: `"Hi, " + user.naem` → `"Hi, undefined"`, **silent**. Go: `u.Naem undefined (type User has no field Naem)` *at compile time*. The lesson: same bug, three radically different discovery times — and JS's silence is the most dangerous.
</details>

---

### Task 1.2 — Prove the two axes are independent

Demonstrate, with runnable snippets, that **strong/weak ≠ static/dynamic** by producing all four cells of the grid behaviorally: show a strong-dynamic language refusing coercion and a weak-static language accepting a byte-reinterpreting cast.

**Self-check:** You can point to Python (dynamic) raising on `"5" + 5` (strong) and to C (static) compiling `*(int*)&someFloat` (weak). You can articulate why "Python is strongly typed" and "Python is dynamically typed" are both true.

<details>
<summary>Hints</summary>

- Strong + dynamic: Python `"5" + 5` → `TypeError`. Strong + static: Java `"5" + 5` won't compile as arithmetic.
- Weak + dynamic: JS `"5" + 5` → `"55"` (silent coercion). Weak + static: C cast reinterpreting bits.
- The axes are: *when* (static/dynamic) vs *whether it coerces* (strong/weak).
</details>

<details>
<summary>Sparse solution</summary>

Fill the grid: Static+Strong = Go/Java/Rust; Static+Weak = C/C++; Dynamic+Strong = Python/Ruby; Dynamic+Weak = JS/PHP. The punchline snippet: `"5" + 5` is a `TypeError` in Python (strong) but `"55"` in JS (weak) — *both dynamic*. So coercion behavior is orthogonal to check timing.
</details>

---

### Task 1.3 — The `None`/`undefined` crash, and a static fix

In Python, write `find_user(users, id)` that returns `None` when not found, then crash it with `find_user([], 1)["name"]`. Then write the equivalent in a language with a "maybe" type (Rust `Option`, TypeScript `T | undefined` + `strictNullChecks`, or Kotlin `T?`) and show the compiler *forcing* you to handle the absent case.

**Self-check:** The Python version crashes at runtime with `'NoneType' is not subscriptable`. The static version *won't compile* until you handle the `None`/`undefined`/`Nothing` branch.

<details>
<summary>Hints</summary>

- Rust: `find` returns `Option<&User>`; you can't access `.name` without `match`/`if let`.
- TS: enable `strictNullChecks`; `a.balance` errors with "possibly undefined."
- The point: the type encodes "might be absent," and the checker enforces handling it.
</details>

<details>
<summary>Sparse solution</summary>

Rust: `match find_user(&[], 1) { Some(u) => ..., None => ... }` — omitting `None` is a non-exhaustive-match compile error. TS with `strictNullChecks`: `const u = find(...)` typed `User | undefined`, and `u.name` errors until you guard `if (u) ...`. The most common production crash becomes a laptop compile error.
</details>

---

### Task 1.4 — Inferred is still static

In Go (or TypeScript), write `x := 5` (no annotation), then try `x = "hello"`. Predict and verify the result. Explain why "no annotation" did *not* make `x` dynamic.

**Self-check:** `x = "hello"` is a **compile error** — `x` was inferred as `int` and is permanently an `int`. You can state that terseness comes from *inference*, not from dynamic typing.

<details>
<summary>Hints</summary>

- Go: `x := 5; x = "hello"` → `cannot use "hello" (untyped string constant) as int value`.
- TS: `let x = 5; x = "hello"` → `Type 'string' is not assignable to type 'number'`.
</details>

<details>
<summary>Sparse solution</summary>

The inferred type is fixed at the declaration and enforced thereafter — fully static. Contrast Python, where `x = 5; x = "hello"` is fine because the *variable* is untyped and the *value* carries the type. "No annotations visible" tells you nothing about static vs dynamic.
</details>

---

## Level 2 — Hybrids (Middle)

### Task 2.1 — Watch `any` leak

In TypeScript, parse JSON with a typo (`{"naem": "Ada"}`) into a value typed `any`, return it as a `User`, and access `.name`. Observe the silent pass-through and the runtime crash. Then fix it using `unknown` + a type guard so the bug is caught *before* the bad access.

**Self-check:** With `any`, `tsc` reports **no error** and the program crashes at runtime. With `unknown`, `tsc` *refuses* to let you treat it as `User` until you validate — and validation catches the missing `name` at the boundary.

<details>
<summary>Hints</summary>

- `JSON.parse` returns `any` by default — annotate the variable `: unknown` to force a check.
- A type guard: `typeof x === "object" && x !== null && "name" in x && typeof (x as any).name === "string"`.
- Note how the `any` version's bug surfaces *far* from where the `any` was introduced.
</details>

<details>
<summary>Sparse solution</summary>

`any` is assignable to `User` with no check (viral, silent), so the typo flows through and `.name` is `undefined` at runtime → `.toUpperCase()` throws. Switching the parse result to `unknown` makes the `as User` illegal without narrowing; the guard rejects the typo'd object at the boundary with a clear error. Rule: `unknown` at edges, never `any`.
</details>

---

### Task 2.2 — Optional/erased: prove the runtime ignores hints

In Python, write `def greet(name: str) -> str: return "Hi " + name`. Call `greet(42)` **without** running mypy and observe what happens. Then run mypy and observe what *it* says. Explain the difference.

**Self-check:** At runtime, Python ignores the hint and `greet(42)` raises `TypeError` from the `+` (string + int) — a *different* error than a type-check would give. mypy, run separately, reports `Argument 1 to "greet" has incompatible type "int"; expected "str"` *before running*.

<details>
<summary>Hints</summary>

- The interpreter never checks `name: str`. The hint is for the external checker only.
- This is "optional + erased" typing: annotations checked at build, ignored at run.
</details>

<details>
<summary>Sparse solution</summary>

Runtime: `"Hi " + 42` → `TypeError: can only concatenate str (not "int") to str` — the crash comes from the *operation*, not from the *annotation*. mypy catches it at the call site statically. The annotation guided the checker, not the runtime. If you want runtime enforcement, opt in (pydantic/typeguard).
</details>

---

### Task 2.3 — Structural vs nominal

In Go, define a `Quacker` interface (`Quack()`) and a `Dog` with a `Quack()` method, and assign a `Dog` to a `Quacker` *without any `implements`*. Then attempt the equivalent in Java with a class that has a `quack()` method but does **not** declare `implements Quacker`, and observe the difference.

**Self-check:** Go compiles (structural — shape is enough). Java *fails* to treat the class as a `Quacker` without the explicit `implements` (nominal). You can state that structural typing is "compile-time duck typing."

<details>
<summary>Hints</summary>

- Go: `var q Quacker = Dog{}` works if `Dog` has `Quack()`.
- Java: a class needs `implements Quacker` even if its method signature matches exactly.
- Map this to: duck typing (runtime), structural (compile, by shape), nominal (compile, by declaration).
</details>

<details>
<summary>Sparse solution</summary>

Go's structural typing: any type with the right method set satisfies the interface, no declaration — flexibility of duck typing with a static check. Java's nominal typing: identity comes from the *declared* relationship, so accidental shape matches don't count. Trade-off: structural is flexible (works with types you don't own); nominal is explicit (prevents accidental coupling, lets `Meters` and `Feet` differ despite the same shape).
</details>

---

### Task 2.4 — The `any` budget

Take a small TypeScript or typed-Python project (or write one ~150-line module). Count the `any`/`Any`/`type: ignore`/`@ts-ignore` occurrences. Then enable strict mode (`strict: true` / `--strict`) and count the *new* errors that appear. Reflect: how much of your "typed" code was actually unchecked?

**Self-check:** You have a number for "fraction of data flow that is `any`," and strict mode reveals errors that lenient mode hid (especially nullability). You can argue that type *presence* ≠ type *safety*.

<details>
<summary>Hints</summary>

- `grep -rc ": any\|<any>\|as any\| any\b" src/` for a rough TS count; mypy reports `Any` via `--disallow-any-explicit`.
- The most impactful strict flag is usually `strictNullChecks`.
</details>

<details>
<summary>Sparse solution</summary>

Strict mode (especially null checking) typically surfaces a wave of "possibly undefined" errors that lenient settings silently allowed. The number of `any`s is your real safety gap: a module that's "100% annotated" but routes its core data through `any` is unchecked where it matters. Real coverage = non-`any` data flow.
</details>

---

## Level 3 — Foundations of the Guarantee (Senior)

### Task 3.1 — Find a deliberate unsoundness hole

In Java, write a program that **type-checks** but throws at runtime via **array covariance**. Then do the same via an **unchecked cast**. Explain, for each, why the type system accepted a program that fails.

**Self-check:** `Object[] a = new String[1]; a[0] = 42;` compiles and throws `ArrayStoreException`. `(Integer) someStringObject` compiles and throws `ClassCastException`. You can name these as *designed* soundness holes with runtime backstops.

<details>
<summary>Hints</summary>

- Array covariance: `String[]` is usable as `Object[]`, but the element store is checked at runtime.
- Unchecked cast: the compiler trusts your `(T)` and defers the check to runtime.
</details>

<details>
<summary>Sparse solution</summary>

Both are escape hatches the language ships for expressiveness/compatibility, each backstopped by a runtime check (`ArrayStoreException`, `ClassCastException`). They illustrate that "sound static language" means "sound *for the operations it models, absent escape hatches*." The footnotes on the soundness theorem are exactly these holes (plus `null`, reflection, deserialization).
</details>

---

### Task 3.2 — Observe erasure vs reification

Show, in code, that Java generics are **erased** (two `List<T>` have the same runtime class; `instanceof List<String>` won't compile) and that Python/Go/C# can **reify** (inspect the runtime type). Explain why dynamic typing *requires* reification.

**Self-check:** Java: `new ArrayList<String>().getClass() == new ArrayList<Integer>().getClass()` is `true`. Python: `type([1,2,3])` is `list` and `isinstance(x, list)` works. You can articulate that runtime type checking is impossible without runtime types.

<details>
<summary>Hints</summary>

- Java `instanceof List<String>` is a compile error — the parameter is gone.
- C# `ls is List<string>` is `true` — generics reified.
- Dynamic dispatch (`a + b` → `a.__add__`) needs the runtime type of `a`.
</details>

<details>
<summary>Sparse solution</summary>

Erasure (Java generics, TS) removes type info before runtime: zero cost, but no `instanceof` on the parameter and silent `any` leaks. Reification (Python values, Go reflection, C# generics) keeps it: enables introspection/serialization/dispatch at a memory cost. Dynamic typing *is* runtime type checking, which presupposes the types are present — so dynamic ⇒ reified, always.
</details>

---

### Task 3.3 — Hindley–Milner: terse and total

In Haskell (or OCaml), write a small polymorphic function (`compose`, `pair`, or `map`) with **no type annotations** and ask the compiler/REPL for its inferred type. Then write a program that should fail and confirm the checker catches it *despite the absence of annotations*.

**Self-check:** GHCi's `:t compose` shows `(b -> c) -> (a -> b) -> a -> c` — the **principal (most general)** type, inferred from nothing. A genuine type error is still rejected. You can state that terseness comes from inference, not dynamism.

<details>
<summary>Hints</summary>

- `compose f g x = f (g x)` then `:t compose` in GHCi.
- Try `compose (+1) (++ "x")` — a type mismatch HM rejects.
</details>

<details>
<summary>Sparse solution</summary>

HM reconstructs the most general type with zero annotations and is sound + complete for its discipline — accepting exactly the well-typed programs. This is the strongest refutation of "static typing means lots of annotations." Subtyping languages (Java/TS/C#) can't use full HM and fall back to local inference + signature annotations.
</details>

---

### Task 3.4 — State the guarantee with its footnotes

Write a short paragraph (then check it against `senior.md`) stating *exactly* what a sound static type system guarantees, including every footnote: which errors it does and doesn't model, and which escape hatches reopen runtime risk.

**Self-check:** Your paragraph says "well-typed programs don't go type-wrong **for the operations the system models**, **assuming no casts/reflection/`unsafe`/`any`/unvalidated deserialization**," and explicitly excludes logic errors, division by zero, bounds, and (unless tracked) `null`.

<details>
<summary>Hints</summary>

- Soundness = progress + preservation, *relative to modeled errors*.
- The footnotes are the escape hatches and the unmodeled error classes.
</details>

<details>
<summary>Sparse solution</summary>

"A sound static type system guarantees that an accepted program never reaches a stuck state for the type errors it models, provided no escape hatch (cast, reflection, `unsafe`, `any`, raw deserialization) is used and provided the modeled-error set is what you think it is. It does *not* guarantee correctness, termination, bounds-safety, division-safety, or null-safety unless those are specifically encoded in the types." That's the senior-level statement.
</details>

---

## Level 4 — Engineering Reality (Professional)

### Task 4.1 — Measure the dynamic tax and the JIT recovery

Write a tight numeric loop (sum of `i*i` for large `n`) in CPython, in PyPy (or Node/V8), and in a static language (Go/Rust). Time all three. Explain the gap between CPython and the static language, and how PyPy/V8 narrows it.

**Self-check:** CPython is dramatically slower (often 10–50×) than Go/Rust; PyPy/V8 is within a small factor of native. You can explain the gap as per-operation dynamic dispatch + boxing, and the recovery as JIT type specialization.

<details>
<summary>Hints</summary>

- Use `time` or each language's benchmark facility; large `n` (1e8) to dominate startup.
- CPython: each `+=`/`*` does tag-check + dispatch + box/unbox.
- PyPy traces the loop and specializes to unboxed ints; V8 does similar for JS.
</details>

<details>
<summary>Sparse solution</summary>

Static languages spend the compile-time-known type to emit unboxed integer arithmetic with no checks. CPython pays the full dynamic tax per op. PyPy/V8 *observe* the types are stable, speculate, and compile near-native code — recovering most of the gap, modulo warmup and deopt risk. Conclusion: "dynamic is slow" is outdated; "dynamic makes *predictable, warmup-free peak* performance harder" is accurate.
</details>

---

### Task 4.2 — Break the JIT fast path

In JavaScript (Node/V8), create a million objects the *same* way and sum a field in a loop (fast: monomorphic, hidden-class-stable). Then add an extra property to some objects mid-stream (or mix shapes) and re-time. Explain the slowdown.

**Self-check:** The shape-stable version is fast; mutating shapes makes the call site polymorphic/megamorphic and measurably slower. You can connect this to hidden classes and inline caches.

<details>
<summary>Hints</summary>

- Build objects with `{x, y}` consistently; access `.x` in a hot loop.
- Then `obj.z = 1` on half of them, or build some objects with a different key order.
- Time both; the divergence is the inline-cache degradation.
</details>

<details>
<summary>Sparse solution</summary>

Stable shapes share a hidden class, so `.x` becomes a fixed-offset load and the inline cache stays monomorphic — near-static speed. Diverging shapes force the site polymorphic then megamorphic, falling back to slow dictionary lookup. The lesson: dynamic *peak* speed is real but **fragile**, depending on type/shape stability the programmer must maintain implicitly — exactly what static typing guarantees.
</details>

---

### Task 4.3 — Read the bug-research claim critically

Find a summary of *To Type or Not to Type* (Gao, Bird, Barr, ICSE 2017). Write down (a) its headline result, (b) at least three caveats that mean it is **not** "types reduce bugs by 15%," and (c) what regime the broader evidence favors.

**Self-check:** You can state ~15% of *public, fixed* JS bugs in their corpus were *detectable* by TS/Flow annotations; that this is a lower bound on one slice (public + clearly-fixed + the kind types catch); and that the broader signal is mixed at small scale but trends positive for large, long-lived codebases.

<details>
<summary>Hints</summary>

- "Detectable by adding types" ≠ "would not have happened."
- The corpus is public bugs with fixes — a biased sample.
- Controlled lab studies are mixed; the payoff scales with size/age/team.
</details>

<details>
<summary>Sparse solution</summary>

Headline: adding TS/Flow types would have caught ~15% of the studied public JS bugs at compile time. Caveats: only public bugs, only those with clear fixes, only the type-catchable category, and "detectable" not "prevented." Regime: defensible to say types reliably help *large, long-lived, multi-team* codebases (refactoring safety + null/shape crashes), while small-scale controlled evidence is genuinely mixed. Never quote "15%" as "15% fewer bugs."
</details>

---

### Task 4.4 — Design a migration (and spot the `any` flood)

Draft a one-page plan to add static typing to a hypothetical 500k-line dynamic codebase. Then write a "bad migration" snippet that *passes the type checker* and *looks* typed but provides ~zero safety. Identify the controls that would have prevented it.

**Self-check:** Your plan includes: permissive-then-strict, `strictNullChecks` first, boundaries-before-internals, validate-at-edges, a `ratchet`, real-coverage metrics, and stub auditing. Your bad snippet uses `any` in/out + `@ts-ignore` and would be caught by an `any` budget + coverage metric.

<details>
<summary>Hints</summary>

- The `any` flood: `function process(data: any): any { /* @ts-ignore */ return data.items... }`.
- Controls: measure non-`any` data flow, not "percent annotated."
- A ratchet lets `any`/`ignore` counts only decrease.
</details>

<details>
<summary>Sparse solution</summary>

Plan order: green build on permissive settings → `strictNullChecks` → type public signatures/data models → validate-and-narrow at every dynamic edge (because erased types don't check input) → CI ratchet on `any`/`ignore` → migrate hot/bug-prone modules first → measure real coverage → audit stubs. The bad snippet is "typed" by name only; the `any`s mean the production crashes are unchanged. Real-coverage metrics + a ratchet + an `any` budget prevent it.
</details>

---

## Stretch Challenges

### Challenge A — Build a tiny gradual checker

Write a toy interpreter for a 3-operation language (`+`, `.field`, function call) and add an *optional* type-check pass. Make annotations optional (`any` when omitted), and implement the **gradual guarantee** behaviorally: adding correct annotations must not change runtime results, only add build-time checks. Then show an `any` boundary leaking a wrong value to runtime.

**Self-check:** Annotated and unannotated runs produce identical outputs for correct programs; a wrong annotation behind an `any` boundary passes the checker and fails at runtime.

### Challenge B — Nominal wrappers prevent a real bug

In a statically typed language, model `UserId` and `OrderId` as *distinct* nominal types over the same underlying `int` (Rust newtype, TS branded type, Go defined type). Write a function that takes a `UserId` and prove the compiler rejects passing an `OrderId` — a bug structural typing alone would miss.

**Self-check:** Mixing the two IDs is a compile error despite identical representations. You can explain why this is a case for nominal over structural typing ("make illegal states unrepresentable").

### Challenge C — The refactor demo

Build a small typed codebase with ~10 call sites of a `User.name` field, then rename it to `User.fullName`. Show the compiler enumerating *every* broken site. Then do the same in a dynamic language and show that `grep` + tests can miss one (hide a call site behind an untested branch).

**Self-check:** The static rename is exhaustive and compiler-verified; the dynamic rename misses the untested branch, which would crash in production. This is the single most defensible argument for static typing at scale.

---

## Self-Assessment Checklist

You've internalized this topic when you can, without notes:

- [ ] Define static vs dynamic by *when* types are checked, and place the type on variable vs value.
- [ ] Draw the static/dynamic × strong/weak grid and fill all four cells with real languages.
- [ ] Explain why static typing rejects some valid programs (sound + incomplete, conservatism, undecidability).
- [ ] State soundness *with its footnotes* (modeled errors only, escape hatches reopen risk; sound ≠ correct).
- [ ] Explain erasure vs reification and why dynamic typing requires reification and erasure makes `any` leak silently.
- [ ] Explain why "no annotations" ≠ dynamic, citing local inference and Hindley–Milner.
- [ ] Describe gradual typing, the gradual guarantee, and the `any`/`unknown` distinction.
- [ ] Distinguish duck (runtime), structural (compile-by-shape), and nominal (compile-by-declaration) typing.
- [ ] Explain the dynamic per-op tax and how JIT hidden classes + inline caches recover it (and when they don't).
- [ ] State the empirical bug evidence accurately (mixed at small scale, positive at scale) with the Gao et al. caveats.
- [ ] Sketch a large-codebase migration plan and name the `any`-flood failure mode and its controls.
