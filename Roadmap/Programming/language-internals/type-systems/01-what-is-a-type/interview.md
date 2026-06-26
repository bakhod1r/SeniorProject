# What Is a Type — Interview Questions

> **Topic:** [What Is a Type](README.md)
> **Focus:** Probing whether a candidate can define what a type *is* from several angles, distinguish static from dynamic type, reason about type vs memory safety, and design with types to make illegal states unrepresentable.

---

## Introduction

These questions test whether a candidate understands the most foundational concept in programming-language design: what a type actually is. The strongest answers move fluidly between lenses — a type as a set of values plus operations, as a contract, as a proposition whose values are proofs, as an interface of capabilities — and never confuse the *static* type of an expression with the *dynamic* type of a value. Weak answers stop at "a type is like `int` or `string`" and cannot say what a type system *buys* you, when it checks, or what it provably rules out.

The progression below runs from conceptual foundations, through language-specific surfaces (Java, Python, Haskell, TypeScript, Rust), into tricky traps where the textbook answer is wrong, and ends with design scenarios that reveal whether the candidate has actually used types to eliminate bug classes in real systems.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [Python](#python)
  - [Haskell](#haskell)
  - [TypeScript](#typescript)
  - [Rust](#rust)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)

---

## Conceptual / Foundational

## Question 1

**Q: What is a type? Give the most useful one-sentence definition, then name two other lenses.**

The most useful pragmatic definition: **a type is a set of values together with the operations that are valid on those values.** `int` is the machine integers plus `+`, `-`, `<`; `bool` is `{true, false}` plus `&&`, `||`, `!`. Two other lenses worth naming: (1) a type is a **contract/proposition** — under the Curry–Howard correspondence a type is a logical proposition and a value of it is a *proof* that the proposition holds; (2) a type is an **interface/capability** — the set of operations you may perform, describing what you can *do* rather than what something *is* (the view behind interfaces, traits, and type classes). A strong candidate notes the pragmatic definition is really the value-lens and the operation-lens fused.

## Question 2

**Q: What does a type system *do* for you? Name several distinct benefits.**

Four distinct things, none of which is "stops crashes": (1) it **prevents whole classes of errors** — applying an operation to a value of the wrong type becomes impossible to write, not merely caught later; (2) it **documents intent** — a signature like `charge(amount: Cents) -> Receipt` is documentation the compiler keeps honest; (3) it **powers tooling** — autocomplete, go-to-definition, safe refactoring, and inline errors all run on type information; (4) it **enables optimization** — knowing a value is an `int32` lets the compiler choose efficient instructions and tight memory layout. A candidate who only says "catches type errors" is missing most of the value.

## Question 3

**Q: Distinguish the static type from the dynamic type of a value.**

The **static type** is what the compiler assigns to an *expression* at compile time, by following the language's rules — it governs *what you may write*. The **dynamic type** is the actual type of the *value* at run time, carried as a runtime tag — it governs *which implementation runs* and whether a downcast succeeds. For `Animal a = new Dog();`, the static type of `a` is `Animal` and its dynamic type is `Dog`. You can call `a.eat()` (allowed by the static type) but not `a.bark()` (not on `Animal`), even though the value is a `Dog`. The invariant: the dynamic type is always the static type or a *subtype* of it — which is exactly why static checking is safe.

## Question 4

**Q: What does Milner's "well-typed programs don't go wrong" mean, and what does it *not* cover?**

It is the statement of **type soundness**: if a program passes a sound type checker, it will never reach a *stuck* state — an operation applied to an operand of the wrong type with no defined behavior (calling a method that doesn't exist, adding a function to an integer). "Go wrong" has this precise meaning. What it does *not* cover: logic bugs, infinite loops, panics/exceptions, or business-rule violations. A sound, well-typed program can still compute the wrong answer or diverge. Soundness rules out one large, valuable class of failures — type errors — not all bugs.

## Question 5

**Q: What is the difference between type checking, type inference, and type erasure?**

**Type checking** verifies that each operation's operands have static types that support it; a static checker does this at compile time (a proof over all runs), a dynamic checker lazily at run time (a test of this run). **Type inference** is the compiler reconstructing a type the programmer didn't write — `x := 42` in Go infers `int`. Crucially, inferred types are *still fully static*; inference is about who wrote the type, not when it's known. **Type erasure** is discarding type information after checking, so it's absent at run time — Java generics (`List<String>` and `List<Integer>` are both just `List` at run time) and TypeScript (which emits type-free JavaScript) both erase.

## Question 6

**Q: Why is "strong vs weak typing" a poor way to describe a language?**

Because the terms have no agreed definition and conflate several independent properties. People call Python "strongly typed" (won't add `1 + "1"`) and dynamically typed (no compile-time checks) in the same breath, treating two orthogonal things as one. Better, precise axes: **static vs dynamic** (when checking happens), **sound vs unsound** (whether well-typed programs are guaranteed type-error-free), **implicit vs explicit conversions** (how much the language coerces for you), and **memory-safe vs unsafe** (whether you can reinterpret raw bytes). Using these resolves arguments instead of starting them.

## Question 7

**Q: How does a type relate to memory representation?**

For a compiled language, a type *is* a layout decision: it tells the compiler how many bytes to allocate and how to interpret them. `int32` is four bytes of two's-complement; `float64` is eight bytes of IEEE-754; a struct's fields are laid out (with alignment padding) in some order. The same bytes mean different things under different types — `0x40490FDB` is the integer `1078530011` as `int32` but `3.1415927` as `float32`. The type is the *lens* that tells the hardware how to read the bits. This is also why field ordering affects struct size and why reinterpreting bytes under the wrong type (type punning) is dangerous.

## Question 8

**Q: What does "make illegal states unrepresentable" mean, and why is it powerful?**

It means designing your types so that invalid combinations of data simply cannot be constructed. Instead of modeling an order with three booleans (`isPending`, `isShipped`, `isCancelled`) — which permits nonsense like "pending and shipped at once" — model it as a single type with exactly three variants, where "shipped" *requires* a tracking ID and "cancelled" *requires* a reason. It's powerful because the type then does the work that validation code, tests, and code review would otherwise do — and it does it for *every* value at *every* call site, at compile time, with no runtime cost and no way to skip it. It's the Curry–Howard idea (construction-as-proof) applied to everyday design.

## Question 9

**Q: In what sense is an "untyped" language actually typed?**

It is **uni-typed**: it has exactly one static type — the universal type of all values — rather than no types. Every value inhabits that single type, and the language inserts a runtime tag check at *every* operation to defend against misuse (`x.foo()` becomes "if the value's tag supports `foo`, dispatch, else error"). Robert Harper's framing: a dynamically typed language is a statically typed language with a single recursive type into which all values are injected, with tag-checking projections out of it. So "untyped" code still pays for types — just at run time, on every operation, instead of once at compile time.

---

## Language-Specific

### Java

## Question 10

**Q: In Java, why does `(Dog) someAnimal` compile but sometimes throw `ClassCastException` at run time?**

Because the compiler only knows the *static* type. If `someAnimal`'s static type is `Animal`, the cast to `Dog` is *plausible* — the value *could* be a `Dog` — so the compiler accepts it. But whether it *is* a `Dog` is only known at run time from the value's dynamic type tag. If the actual object is a `Cat`, the runtime check fails and throws `ClassCastException`. The upcast direction (`Animal a = aDog;`) never fails because the dynamic type is always the static type or a subtype; the downcast is a bet that the value is *more specific* than the static type guarantees.

## Question 11

**Q: What does Java type erasure remove, and what can you therefore not do?**

Java erases generic type arguments after checking: `List<String>` and `List<Integer>` are *both* just `List` (`ArrayList`) at run time. The `<String>` existed only to let the compiler check your code; the JVM never sees it. Consequences: you cannot write `new T[]`, you cannot do `x instanceof List<String>` (only `instanceof List`), and reflection can't recover the type argument of a field's value. Erasure was chosen for backward compatibility with pre-generics bytecode — the trade was zero runtime cost and compatibility in exchange for losing runtime access to generic types.

## Question 12

**Q: A Java variable declared `String s` — can it hold something that isn't a `String`?**

It can hold `null`, which is the type system's classic hole. `s.length()` then throws `NullPointerException` at run time even though the code typechecked. This is why `null` is sometimes called "the billion-dollar mistake": a reference type's static type doesn't actually guarantee a value of that type is present. Languages like Kotlin (`String?` vs `String`) and Rust (`Option<String>`) make nullability part of the type, so the possibility of absence is explicit and the compiler forces you to handle it.

### Python

## Question 13

**Q: Does a Python type annotation like `def f(x: int)` prevent calling `f("hi")`?**

No. Python annotations are not enforced at run time — `f("hi")` runs and only fails if some operation inside `f` rejects a string. The annotation is a *promise* that a separate tool (mypy, pyright, Pyre) checks ahead of time, turning a would-be runtime error into a static one. Without that tooling, the annotation is documentation only. This is the essence of *gradual typing*: optional static types layered over a dynamically typed core, checked by an external checker rather than the interpreter.

## Question 14

**Q: Python is dynamically typed — does that mean values have no types?**

The opposite. Every Python *value* has a concrete dynamic type (`type(42)` is `int`, `type("x")` is `str`), and operations dispatch on it — `+` does addition on ints and concatenation on strings. What Python lacks is *static* types on variables and a compile-time checker. So values are richly typed at run time; the *names* are untyped (uni-typed) until you add annotations. "Dynamically typed" means checking happens at run time, not that types are absent.

## Question 15

**Q: Why does `1 + "1"` raise a `TypeError` in Python but `"1" + "1"` does not?**

Because `+` is defined per type, and `int.__add__` has no rule for adding a `str`. When the interpreter executes `1 + "1"`, it looks up `__add__` on `int` (which rejects the `str`) and then `__radd__` on `str` (which also rejects the `int`), and finding no valid operation, raises `TypeError`. `"1" + "1"` succeeds because `str.__add__` *is* defined for two strings (concatenation). This is the "set of values + operations" definition made concrete: the same symbol `+` names different operations on different types, and the type decides which — or whether — it applies.

### Haskell

## Question 16

**Q: Under the Curry–Howard correspondence, what propositions do the product, sum, and function types correspond to?**

A **product** type `(A, B)` corresponds to logical **AND** (`A ∧ B`): a value is a pair, so you must supply a proof of both. A **sum** type `Either A B` corresponds to logical **OR** (`A ∨ B`): a value is a choice of one side, so it's a proof of at least one. A **function** type `A -> B` corresponds to **implication** (`A ⇒ B`): a value is a procedure turning a proof of `A` into a proof of `B`, and function application *is* modus ponens. The unit type `()` is `True` (trivially inhabited) and the empty type `Void` is `False` (no value can be constructed). A value of a type is a *proof* the proposition holds.

## Question 17

**Q: What is the kind of `Maybe` in Haskell, and how does it differ from the kind of `Int`?**

`Int` has kind `*` — it is a concrete type that classifies values directly. `Maybe` has kind `* -> *` — it is a *type constructor* that takes a type and produces a type: `Maybe` alone is not a type, but `Maybe Int` is (`Maybe Int :: *`). Kinds are "the type of a type." This distinction is why you can write `Functor f` quantifying over `f :: * -> *` to abstract over *any* container — a **higher-kinded** abstraction that languages without HKTs (Java, Go, Rust, TypeScript) cannot express cleanly.

## Question 18

**Q: What does it mean for a type to be "uninhabited," and why is it useful?**

An uninhabited type has no values — `Void` (also `Never` / `!` in other languages). Under Curry–Howard it corresponds to `False`: just as you can't prove falsehood, you can't construct a value of it. It's useful as a *proof of impossibility*: a function `A -> Void` is a proof of `¬A` ("assuming `A` leads to absurdity"), and a `Result<T, Void>`-style type says "the error case can never occur," so the type *proves* the operation is total. Compilers use uninhabited types to mark unreachable code and optimize it away. The catch: in a language with non-termination or exceptions, you can technically inhabit `Void` via code that never returns, which is why such languages correspond to *inconsistent* logics.

### TypeScript

## Question 19

**Q: How does a TypeScript `x as number` assertion differ from a Java `(Integer) x` cast at run time?**

A Java cast is *verified at run time* against the value's dynamic type tag — if `x` isn't an `Integer`, it throws `ClassCastException`. A TypeScript `as` assertion is *not* verified at run time at all: TypeScript erases all types before emitting JavaScript, so there's nothing to check against. `as number` simply tells the compiler "trust me, this is a number" and silences the error; if you're wrong, no error fires and you get silent garbage (`NaN`, `undefined`-driven bugs) downstream. This is why `as` is dangerous and should be a last resort behind a real runtime check.

## Question 20

**Q: TypeScript uses structural typing. What does that mean, and how does it differ from nominal typing?**

In **structural** typing, two types are compatible if they have the same *shape* — the same fields and methods — regardless of their declared names. A value satisfies an interface if it *has the operations*, "duck typing" checked at compile time. In **nominal** typing (Java, C#, Rust), compatibility requires a declared relationship — sharing a name or an explicit `implements`. The practical difference: in TypeScript, two differently-named types `{ x: number }` are interchangeable; in Java, two classes with identical fields are unrelated unless one extends the other. Structural typing maximizes interop; nominal typing lets you keep semantically-distinct-but-identically-shaped types apart (a `Meters` vs a `Celsius`).

## Question 21

**Q: How can you get a "nominal-like" distinct type in TypeScript despite structural typing?**

With a **branded** (or "tagged") type: intersect the base type with a unique, unconstructable marker, e.g. `type Email = string & { readonly __brand: "Email" }`. Because no plain `string` has the `__brand` property, you can only obtain an `Email` by deliberately asserting one inside a validating constructor (`parseEmail`). This recovers nominal behavior — a function taking `Email` won't accept a raw `string` — on top of TypeScript's structural core, and is the idiomatic way to make validated values carry proof of validity.

### Rust

## Question 22

**Q: How does Rust use types to give you a guarantee with zero runtime cost? Give an example.**

The **newtype** pattern: `struct UserId(u64)` and `struct OrderId(u64)` are logically distinct types — the compiler refuses to pass one where the other is expected — but both are *physically* just a `u64`, so there's no wrapper, no extra byte, no indirection at run time. You buy compile-time type safety (no ID transposition bugs) and pay nothing at run time; the distinction is erased after checking. **Phantom types** (`PhantomData`) extend this to encode state (`Connection<Open>` vs `Connection<Closed>`) or units (`Temp<Celsius>` vs `Temp<Fahrenheit>`) with zero runtime storage — illegal operations simply don't compile.

## Question 23

**Q: What is the `!` (never) type in Rust and what does it represent?**

`!` is the **uninhabited** type — it has no values, corresponding to `False` under Curry–Howard. It's the type of expressions that never produce a value: `panic!()`, `loop {}`, `return`, `continue`. A function `fn f() -> !` never returns normally — its type *proves* it has no normal exit. `!` coerces to any type (since it can never actually occur, it's safe to use anywhere a value is expected), which is why `let x: i32 = if cond { 5 } else { panic!() };` typechecks. The related `Infallible` (an uninhabited error type) lets `Result<T, Infallible>` *prove* an operation can't fail.

## Question 24

**Q: How does Rust prevent both type errors and memory errors, and where is the boundary?**

Safe Rust is *both* type-safe (operations only apply to compatible types) and memory-safe (no out-of-bounds, use-after-free, or data races) — enforced by the type system, the borrow checker, and ownership, *without* a garbage collector. The boundary is the `unsafe` keyword: inside an `unsafe` block you can dereference raw pointers, call FFI, and reinterpret bytes (`transmute`), lowering the *memory-safety* dial while the compiler still enforces type rules outside it. The design philosophy is that `unsafe` is an explicit, auditable region where *you* uphold the invariants the compiler can't verify — so memory safety becomes a small, reviewable surface rather than a property of the whole program.

---

## Tricky / Trap Questions

## Question 25

**Q: "It compiled, so the program is correct." True or false?**

False, and the candidate should explain precisely why. A passing type check (in a sound system) rules out *type errors* — a specific, valuable class. It says nothing about logic errors, off-by-ones, infinite loops, wrong business rules, race conditions, or panics. A program can be perfectly well-typed and compute entirely wrong answers. Types narrow the space of possible bugs; they don't eliminate it. A candidate who treats "compiles" as "correct" is over-trusting the type system.

## Question 26

**Q: Does type inference mean the language is dynamically typed?**

No — this is a common confusion. Inferred types are *fully static*: they're known and checked at compile time; the compiler simply reconstructs them instead of making you write them. `let v = vec![1, 2, 3];` in Rust has the static type `Vec<i32>`, fixed at compile time, even though you didn't annotate it. Inference is about *who writes the type down*, not *when it's known*. Haskell and ML infer almost everything and are statically typed; Python infers nothing for variables and is dynamically typed. The two axes are independent.

## Question 27

**Q: `volatile`-style aside: is `"5"` the same as `5`? When does mixing them bite?**

No — `"5"` is a `string` (a sequence of characters) and `5` is an `int` (a number); different types, different bins, different operations. They *look* alike on screen, which is exactly the trap. Mixing them bites at type boundaries: JSON parsing (a numeric field arrives as a string), form input (everything is text), and weakly-coercing languages where `"5" + 1` might be `"51"` or `6` or an error depending on the language. The discipline is to know, at every point, whether you hold text or a number, and to convert *explicitly* at the boundary rather than relying on implicit coercion.

## Question 28

**Q: Can a memory-safe language still have a serious type-related bug?**

Yes. Memory safety prevents corruption (no OOB, no use-after-free) but not *logical* type confusion. A memory-safe program can still pass a `userId` where an `orgId` was expected (if both are bare integers), charge the wrong account, or deserialize untrusted data into the wrong shape. Memory safety and type safety are *separate dials* — a garbage-collected dynamic language is memory-safe yet can still execute a value-of-wrong-type bug to a catastrophic but non-corrupting conclusion. The fix for that class is *more precise types* (newtypes, validated types), not more memory safety.

## Question 29

**Q: If a type is "a set of values," what set is the function type `Int -> Int`?**

This is the trap that exposes the limits of types-as-sets. Naively it's "the set of all functions from `Int` to `Int`" — but that mathematical set is *uncountable*, while the functions a program can actually *express* are countable, so the naive set over-counts. More deeply, treating types as plain sets breaks on **recursive types** (a `List` defined in terms of itself needs a *least fixed point*, not naive enumeration) and on a **type of all types** (which reproduces Russell's paradox and is logically inconsistent — hence universe hierarchies in dependent type theories). The honest answer: types-as-sets is a great intuition for subtyping and unions but an unsound *foundation*; functions, recursion, and types-of-types require domain theory.

## Question 30

**Q: A candidate says "Rust's newtype wrapper must add overhead." Are they right?**

No. A newtype like `struct Meters(f64)` is *logically* distinct from `f64` but has the *identical* representation — it's still just eight bytes — and the wrapper compiles away entirely. There's no allocation, no extra field, no indirection; "zero-cost abstraction" means the physical representation and dispatch are exactly as good as writing the raw type by hand. The candidate is confusing *logical* distinction (which is real and valuable) with *physical* overhead (which is zero here). The whole point of the pattern is to get the safety for free.

---

## Design Scenarios

## Question 31

**Q: You receive raw user input as a `string`. Design types so that the rest of the system can't accidentally use unvalidated input.**

Apply "parse, don't validate": at the boundary, convert the raw `string` into a distinct type that *proves* validity — `parseEmail(raw: string) -> Email | null`, where `Email` is a branded/newtype that can only be constructed by passing the validator. Every downstream function takes `Email`, not `string`, so unvalidated input *cannot* reach them — it wouldn't typecheck. This replaces a re-validation at every call site with a single construction point, gives full coverage (every value, every path), and makes "forgot to validate here" a compile error. The candidate should contrast this with `isValidEmail(s): bool`, which throws the validation evidence away the moment it returns.

## Question 32

**Q: Model a network connection that can only be sent on while open. How do you make "send on a closed connection" impossible?**

Use **typestate** via phantom types: `Connection<Open>` and `Connection<Closed>` as distinct types, where `send()` exists *only* on `Connection<Open>` and `close()` consumes a `Connection<Open>` and returns a `Connection<Closed>`. The state lives entirely in the type parameter (zero runtime storage), so calling `send()` on a closed connection doesn't fail at run time — it doesn't compile. The candidate should note that this guarantee is lost across serialization (the phantom state isn't represented) and that the same pattern models builders, sessions, and permission tiers.

## Question 33

**Q: A bug shipped where `userId` and `orgId` (both `int64`) were transposed at a call site. It compiled and passed tests. How do you prevent the entire class?**

Newtype each: `UserId(int64)` and `OrgId(int64)` as distinct types with no implicit conversion between them. The transposition then becomes a *compile error* at every call site simultaneously, at zero runtime cost. The key insight for the interviewer: this isn't a fix for *one* bug, it's the deletion of an entire *class* — every present and future transposition of these two IDs is now impossible to write. The candidate should recognize that bare primitives (`int64`, `string`) for semantically distinct concepts are an invisible, recurring source of these bugs, and that "give meaningful things their own types" is the cheapest possible test for the whole class.

## Question 34

**Q: When is "make illegal states unrepresentable" *not* worth it, and what do you do instead?**

When the invariant is low-frequency, low-cost, or hard to express in the type system, the modeling effort can exceed the payoff — and some constraints (a string matching a complex regex, a cross-field invariant spanning a large aggregate, a value within a runtime-configured range) are awkward or impossible to encode statically. In those cases, prefer a **runtime check at the boundary** (validate on construction, assert at the trust edge) and keep the type simple. The senior judgment is *triage*: spend type-design effort on the high-frequency, high-cost invariants (IDs, units, validation state, protocol state) and use cheap runtime checks for the long tail. A candidate who tries to type-encode *everything* shows dogma; one who never does shows they've left value on the table.

## Question 35

**Q: You're choosing types for a money field. Walk me through the decision.**

Never use a floating-point type — `float`/`double` can't represent `0.10` exactly and accumulate rounding errors that are unacceptable for money. Use an integer count of the smallest unit (`Cents`, or a fixed-point/decimal type), wrapped in a **newtype** (`Money` or `Cents`) so it can't be confused with a plain count or mixed across currencies. Ideally encode the currency too — `Money<USD>` vs `Money<EUR>` via a phantom type — so adding dollars to euros doesn't compile. The candidate should hit three things: representation correctness (no floats), type distinction (newtype, not bare `int`), and unit/currency safety (phantom type or explicit currency field). This is the whole topic — values-and-operations, representation, and make-illegal-states-unrepresentable — applied to one ubiquitous field.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
|              WHAT IS A TYPE — INTERVIEW MUST-KNOWS              |
+------------------------------------------------------------------+
| 1. Type = SET of values + OPERATIONS valid on them.              |
|    Also: a contract/proposition, an interface/capability.        |
|                                                                  |
| 2. STATIC type = on the expression, compile time, what you may   |
|    WRITE.  DYNAMIC type = on the value, run time, what RUNS.     |
|    dynamic type is always static type or a subtype of it.        |
|                                                                  |
| 3. Soundness: "well-typed programs don't go wrong" = no STUCK    |
|    state. Rules out type errors, NOT logic bugs/loops/panics.    |
|                                                                  |
| 4. Inference = compiler reconstructs a STILL-STATIC type.        |
|    Erasure = types gone at run time (Java generics, TS).         |
|                                                                  |
| 5. Don't say strong/weak. Say static/dynamic, sound/unsound,    |
|    implicit/explicit conversion, memory-safe/unsafe.            |
|                                                                  |
| 6. Curry-Howard: types=propositions, values=PROOFS.             |
|    AND=product, OR=sum, =>=function, False=Void/Never.          |
|                                                                  |
| 7. Type safety (right op on right type) != memory safety        |
|    (no OOB/use-after-free). Type confusion -> corruption -> RCE. |
|                                                                  |
| 8. Kinds = type of a type. Int::*  List::*->*  Either::*->*->*. |
|    Higher-kinded (Functor f) absent in Java/Go/Rust/TS.         |
|                                                                  |
| 9. "Untyped" = UNI-typed: one universal type + runtime tag      |
|    checks at every operation.                                    |
|                                                                  |
| 10. Make illegal states unrepresentable. Newtypes/phantom types |
|     = zero-cost safety. "Parse, don't validate."                |
+------------------------------------------------------------------+
```

---

## Further Reading

- *Types and Programming Languages* — Benjamin C. Pierce. The reference for checking, soundness, and subtyping.
- "Propositions as Types" — Philip Wadler. The clearest essay on Curry–Howard. https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf
- "Parse, Don't Validate" — Alexis King. Construction-as-proof for working engineers. https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- "Dynamic Languages are Static Languages" — Robert Harper. The uni-typed argument. https://existentialtype.wordpress.com/2011/03/19/dynamic-languages-are-static-languages/
- "Make Illegal States Unrepresentable" — Scott Wlaschin. https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/
- "What To Know Before Debating Type Systems" — Chris Smith. Why "strong/weak" misleads.
- *The Rust Book* (chs. 3, 6, 10) and *The Rustonomicon* — newtypes, enums, and the type/memory-safety boundary.
- *The TypeScript Handbook* — narrowing, structural typing, branded types.
