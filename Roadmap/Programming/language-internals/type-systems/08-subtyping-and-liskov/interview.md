# Subtyping & Liskov Substitution — Interview Questions

> **Topic:** [Subtyping & Liskov Substitution](README.md)
> **Focus:** Questions that separate "I memorized the Square/Rectangle example" from "I can reason about substitutability, variance, and the gap between what the compiler checks and what LSP requires."

---

## Introduction

These questions probe whether a candidate understands subtyping as the *substitution relation* that powers polymorphism, and the Liskov Substitution Principle as the *soundness discipline* that decides when that substitution is safe. A strong candidate distinguishes subtyping from inheritance, states the four behavioral rules precisely (and connects them to variance), explains *why* the Square/Rectangle hierarchy is unsound rather than just citing it, and knows where real languages and standard libraries break LSP in their own designs. A weaker candidate recites "a subtype must be substitutable" without being able to say *substitutable with respect to what* or predict a violation before it's pointed out.

The questions run Conceptual → Language-Specific → Tricky/Trap → Design. The traps are where it gets interesting: several "obviously fine" overrides are LSP violations, and several "obviously is-a" relationships are not subtypes.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)

---

## Conceptual / Foundational

## Question 1

**What does it mean for S to be a subtype of T?**

`S <: T` means a value of type `S` can be used *correctly* in every context that expects a value of type `T` — the substitution relation. Operationally: any function taking a `T`, any variable of type `T`, any field of type `T` can receive an `S`, and the program both type-checks and behaves correctly. The "type-checks" part is structural (S has all of T's members with compatible signatures); the "behaves correctly" part is behavioral and is exactly what the Liskov Substitution Principle governs. A complete answer names both halves and notes that the compiler verifies only the first.

## Question 2

**What is the subsumption rule?**

Subsumption is the typing rule that lets a subtype value be treated as its supertype: if `e` has type `S` and `S <: T`, then `e` also has type `T`. It's the mechanism behind every "pass a `Dog` to a function expecting an `Animal`." The value doesn't change type — a `Dog` is still a `Dog` — but its static type is *widened* to `Animal`. Without subsumption, the subtype relation would exist but couldn't be used. LSP is the semantic guarantee that subsumption is *safe* — that using an `S` as a `T` never goes wrong.

## Question 3

**State the Liskov Substitution Principle precisely.**

A subtype must be substitutable for its base type without altering the desirable properties (correctness) of the program. Formally (Liskov & Wing, 1994), for `S <: T` and a method overridden in `S`: (1) preconditions may not be **strengthened** in the subtype, (2) postconditions may not be **weakened**, (3) supertype **invariants must be preserved**, and (4) the **history constraint** — the subtype must not permit state changes the supertype's contract forbids. The slogan version: **require no more, promise no less, break nothing, surprise no one.**

## Question 4

**Why can't a subtype strengthen a precondition? Give the failure mode.**

A precondition is what a method demands of its caller. The caller holds the *base* type and only knows the *base*'s precondition. If a subtype demands more (a narrower input range, an extra state requirement), a caller can legitimately pass an input that satisfied the base precondition but violates the subtype's — and the subtype rejects or crashes on input the caller had every right to send. `Penguin.fly()` throwing, `unmodifiableList.add()` throwing, and a `CappedAccount` that rejects withdrawals over 50 when `Account` accepted any positive amount are all strengthened preconditions. This is the same constraint as parameter *contravariance* at the type level.

## Question 5

**Why can't a subtype weaken a postcondition?**

A postcondition is what the method guarantees on return; the caller relies on it. If the subtype delivers less — sometimes doesn't perform the effect, returns a less specific or less constrained result — the caller's downstream logic, written against the base guarantee, is now wrong. A `withdraw` that "usually" deducts the money weakens the postcondition. At the type level this is the same constraint as return *covariance*: an override may return a more specific type (stronger guarantee) but not a less specific one.

## Question 6

**What is the history constraint, and why is it separate from the other three rules?**

The history constraint says a subtype may not introduce state transitions that the supertype's contract forbids — even if every individual method respects preconditions, postconditions, and invariants. The canonical case: an immutable `Point` whose contract guarantees `x`/`y` never change after construction. A `MutablePoint` subtype adds `setX`. Each method might look locally fine, but `MutablePoint` permits a *history* — "x changed over time" — that `Point` forbade. It's separate because rules 1–3 check individual method calls, while the history constraint checks the object's *trajectory over its lifetime*. Practically, it's why you can't soundly add mutation under an immutable base type.

## Question 7

**How is subtyping different from inheritance?**

Inheritance is a *code-reuse* mechanism — a subclass borrows its parent's implementation. Subtyping is a *substitutability relation* — an S can stand in for a T. In most OO languages `extends` gives both at once, which is why they're conflated, but they're independent: you get subtyping without inheritance via interface implementation or structural typing (Go, TypeScript), and you can *abuse* inheritance to reuse code where the subtype is **not** substitutable — which is precisely the LSP violation. "Prefer composition over inheritance" exists largely because inheritance tempts you into substitutability violations you didn't intend.

## Question 8

**What's the difference between nominal and structural subtyping?**

Nominal: `S <: T` holds only if explicitly declared (`extends`/`implements`) — Java, C#, C++, Scala. You can't be a subtype by accident. Structural: `S <: T` holds if S's shape includes T's required members — TypeScript, Go interfaces, OCaml objects. No declaration needed; conformance is automatic and retrofittable. The trade-off: nominal prevents accidental conformance and carries semantic intent via names; structural enables duck typing and retroactive conformance but *widens* the behavioral-contract gap, because a type can satisfy an interface by coincidence and then violate the unwritten behavioral contract.

## Question 9

**Explain the variance of function types.**

`(A → B) <: (C → D)` iff `C <: A` (parameters contravariant) and `B <: D` (return covariant). A function subtype may accept *wider* (more general) parameters and return *narrower* (more specific) results. Intuition: to substitute for a `(Dog) → Animal`, your function must handle every `Dog` the caller sends (so it can accept `Animal`, a superset), and its result is consumed as an `Animal` (so returning a `Dog` is fine). Parameters flip, returns don't. This is the type-level statement of LSP's precondition and postcondition rules.

## Question 10

**How do the behavioral LSP rules relate to variance?**

They are the same constraints viewed from two sides. A method's parameters are *input positions* → contravariant → "don't strengthen preconditions." A method's return is an *output position* → covariant → "don't weaken postconditions." Variance generalizes this to type *constructors*: a type parameter used only in output positions can be covariant (`out`/`+`/`? extends`); only in input positions, contravariant (`in`/`-`/`? super`); in both, invariant. So variance is LSP lifted from values to parameterized types — and LSP is the soundness condition that justifies variance.

## Question 11

**What is width subtyping and depth subtyping on records?**

Width: a record with *more* fields is a subtype of one with fewer — `{name, age}` <: `{name}` — because extra fields are harmless to a caller expecting fewer. Depth: replacing a field's type with a subtype makes the record a subtype — if `Dog <: Animal` then `{pet: Dog}` <: `{pet: Animal}` — but only for *read-only* access, because mutable depth subtyping is unsound (you could write a `Cat` through the `{pet: Animal}` view). These two axes are orthogonal.

## Question 12

**Where does LSP sit in SOLID, and what's special about it?**

LSP is the "L" in SOLID. What's special is that it's a *design-level* and *behavioral* principle, not a type-level one — the compiler enforces the method *signatures* but **not** the behavioral contract. The Single Responsibility, Open/Closed, Interface Segregation, and Dependency Inversion principles are largely about structure; LSP is about the *semantics* of substitution, the part with no compiler. It's also tightly coupled to ISP: small, segregated interfaces (capability interfaces) make LSP violations structurally hard to introduce.

---

## Language-Specific

## Question 13 (Java)

**What are covariant return types, and when were they added?**

Covariant return types let an overriding method return a *subtype* of the base method's return type. Added in Java 5. `Animal reproduce()` in the base can be overridden by `Dog reproduce()` in `Dog extends Animal`, because a caller holding an `Animal` and calling `reproduce()` is happy to receive a `Dog`. It's the return-covariance half of LSP made into a language feature. Before Java 5, the override had to return the *exact* base type, forcing casts.

## Question 14 (Java)

**Why can't you widen a method parameter when overriding in Java? Isn't that sound by LSP?**

Widening a parameter (accepting a more general type) *is* sound by LSP — it weakens the precondition, which is the safe direction. But Java makes method parameters **invariant**: an override must have the *exact* parameter types. Changing a parameter type doesn't override — it creates an *overload*. The reasons are nominal dispatch and overload resolution: allowing contravariant parameters would make it ambiguous which method dynamic dispatch should select. So the "override" with a wider parameter silently becomes dead code unless called with the exact widened type — a classic bug `@Override` catches.

## Question 15 (Java)

**Explain PECS.**

"Producer Extends, Consumer Super." Java generics are invariant, so to get safe variance at a call site you use bounded wildcards. If a parameter is a *producer* (you only read T out of it), use `? extends T` — a covariant view: you can read `T`, can't write. If it's a *consumer* (you only write T into it), use `? super T` — a contravariant view: you can write `T`, can only read as `Object`. `Collections.copy(List<? super T> dest, List<? extends T> src)` is the canonical example. PECS is LSP applied per-use: `extends` carves out a covariant view, `super` a contravariant one.

## Question 16 (Java)

**Why are Java arrays covariant, and what does it cost?**

`Dog[] <: Animal[]` holds in Java — arrays are covariant. This is **unsound**: you can assign a `Dog[]` to an `Object[]` and store a `Cat` into it, which compiles but corrupts the array. Java patches the hole with a *runtime* check on every array store, throwing `ArrayStoreException`. It was a deliberate 1995 decision: Java had no generics, and covariant arrays let methods like `sort(Object[])` work on any array. Generics fixed it by being invariant — `List<Dog>` is not a `List<Animal>`, so the equivalent mistake is a compile error. It's the textbook example of a language knowingly violating LSP in its own type system.

## Question 17 (C#)

**How does C# express variance, and how does it differ from Java's?**

C# uses *declaration-site* variance with `out` (covariant) and `in` (contravariant) on interface/delegate type parameters: `IEnumerable<out T>`, `IComparer<in T>`, `Func<out TResult>`, `Action<in T>`. The compiler verifies that `out` parameters appear only in output positions and `in` only in input positions. The difference from Java: C# fixes variance once at the *declaration*, so it applies to all uses; Java uses *use-site* variance (wildcards), where the caller picks variance per use. Declaration-site is cleaner for consumers; use-site is more flexible but verbose.

## Question 18 (C++)

**Does C++ have covariant return types? What about LSP enforcement?**

Yes, C++ supports covariant return types for virtual functions: an override may return a pointer/reference to a derived class. C++ enforces no behavioral LSP at all — it's nominal subtyping via public inheritance, and the compiler checks only signatures (and only loosely, given slicing). C++ also has *object slicing*: assigning a derived object to a base value (not pointer/reference) copies only the base part, silently discarding the derived behavior — a substitutability hazard unique to value semantics. And `private`/`protected` inheritance gives you implementation inheritance *without* the subtype relation, cleanly separating the two concepts the language otherwise conflates.

## Question 19 (TypeScript)

**How does TypeScript's structural typing interact with LSP?**

TypeScript is structural: a type is assignable to another if its shape conforms, no `implements` needed. This makes the *type-level* subtyping automatic but does nothing for the *behavioral* contract — a type can match a shape by coincidence and still violate behavior LSP exists to protect. TypeScript also checks function parameters bivariantly by default for method syntax (historically, for DOM-event ergonomics) but *contravariantly* under `strictFunctionTypes` for function-typed properties — so the soundness of parameter variance depends on how you declare the function. Candidates who know the `strictFunctionTypes` nuance are demonstrating real depth.

## Question 20 (Scala)

**How does Scala express variance, and why must `List` be covariant but a mutable collection invariant?**

Scala uses declaration-site variance: `class List[+A]` (covariant), `trait Function1[-T, +R]` (contravariant arg, covariant result). The compiler enforces variance positions: a `+A` parameter may appear only in output positions. `scala.collection.immutable.List[+A]` can be covariant precisely *because* it's immutable — `A` appears only in outputs (`head`, `apply`). A mutable collection has both a getter (output, wants covariance) and a setter (input, wants contravariance), so `A` appears in both positions and the type must be **invariant**. This is the cleanest demonstration that mutability forces invariance.

## Question 21 (Go)

**Go has no inheritance and no generics-style variance. How does subtyping work, and does LSP apply?**

Go subtyping is purely structural via interfaces: a type satisfies an interface if it has the required methods — it never names the interface. There's no class inheritance and (pre-1.18) no generic variance; even with generics, Go has no variance annotations and invariant type parameters. LSP absolutely still applies behaviorally: an interface like `io.Reader` carries a documented contract (`Read` returns `n` bytes and possibly an error, `0 <= n <= len(p)`), and an implementation that violates it — returns more bytes than the buffer, or blocks when it shouldn't — is an LSP violation that the compiler can't catch. Go's culture leans on documented contracts and interface tests precisely because structural typing gives zero behavioral guarantees.

## Question 22 (Multi-language)

**Compare how Java, Kotlin, and C# model read-only vs mutable collections, and which avoid the `unmodifiableList` LSP wart.**

Java's `Collections.unmodifiableList` returns a `List` whose `add` throws — an LSP violation, because `List` declares `add` and callers are entitled to call it. Kotlin separates `List` (read-only, no `add`) from `MutableList` (adds mutation), so a read-only reference *has no mutator to break* — principled. C# similarly splits `IReadOnlyList<T>` (covariant, `out T`, no mutators) from `IList<T>`. Kotlin and C# avoid the wart by making read-only a genuine *supertype lacking the mutating methods*; Java retrofitted immutability onto a hierarchy that already had `add` everywhere, so it could only throw at runtime.

---

## Tricky / Trap Questions

## Question 23

**"A Square is-a Rectangle." True or false, and why?**

False *as a subtype*, for the standard mutable `Rectangle` with independent `setWidth`/`setHeight`. `Rectangle` has the invariant that width and height vary independently. A `Square` that keeps width == height must override `setWidth` to also set height, breaking that invariant. Polymorphic code holding a `Rectangle` — `r.setWidth(5); r.setHeight(4);` — expects `area() == 20`, but a `Square` returns 16. The English "is-a" is true; the *substitutability* "is-a" is false. The trap is that the candidate confuses dictionary taxonomy with the behavioral contract. (Note: if `Rectangle` is *immutable*, a `Square` can be a sound subtype — the violation needs mutation.)

## Question 24

**This override compiles and looks fine. Is it a valid subtype?**

```java
class FileStore { void save(String path) { /* writes to disk */ } }
class ReadOnlyStore extends FileStore {
    @Override void save(String path) { throw new UnsupportedOperationException(); }
}
```

No — it's an LSP violation (a "refused bequest"). `FileStore.save` has the postcondition "the data is persisted." `ReadOnlyStore.save` weakens it to "throws," and strengthens the precondition to the impossible. Any code holding a `FileStore` and calling `save` is now a landmine. It compiles because the *signature* matches; the *behavior* doesn't. The fix: `ReadOnlyStore` shouldn't extend `FileStore` — extract a `Readable` capability and a separate `Writable`.

## Question 25

**Is `Stack extends Vector` (Java's actual design) an LSP violation?**

Yes, and it's a real one in the JDK. `java.util.Stack` extends `Vector`, so a `Stack` exposes all of `Vector`'s methods — `add(index, element)`, `remove(index)`, `insertElementAt` — which let you mutate the stack at arbitrary positions, violating the LIFO invariant a `Stack` should guarantee. You can `stack.add(0, x)` and corrupt the stack discipline. It's the canonical "inheritance for code reuse where substitutability doesn't hold." The right design (composition) holds a `Vector`/`List` as a field and exposes only `push`/`pop`/`peek`. `ArrayDeque` is the modern recommended stack precisely to avoid this.

## Question 26

**A subtype overrides a method to accept *more* inputs than the base (weakens the precondition). Is that an LSP violation?**

No — weakening a precondition is the *safe* direction. The base's callers only ever pass inputs valid for the base precondition; if the subtype accepts those *and more*, every base-valid call still works. The trap is candidates reflexively saying "any change to the precondition is a violation." Only *strengthening* (demanding more) breaks LSP. Caveat: weakening is safe only if the method still does the *right thing* for the new inputs — accepting more inputs but mishandling them is a postcondition break in disguise.

## Question 27

**Does overriding `equals` to add a field-comparison in a subclass violate any contract?**

It can violate the `Object.equals` contract's *symmetry* and *transitivity*, which is an LSP violation on the `Object` supertype. If `Point.equals` compares `x,y` and `ColorPoint.equals` compares `x,y,color`, then `point.equals(colorPoint)` may be `true` while `colorPoint.equals(point)` is `false` — asymmetric. This silently corrupts hash-based collections (a `ColorPoint` won't be found via a `Point` key, or vice versa). Effective Java's canonical advice: there's no way to extend an instantiable class with a value component and preserve the `equals` contract — favor composition. A subtle but real substitutability break on a contract everyone forgets is a contract.

## Question 28

**Is a `null`-returning override of a method that the base documented as never-null an LSP violation?**

Yes. "Never returns null" is part of the postcondition. An override that returns `null` weakens it, and every caller written against the base — which skipped null checks because the base promised non-null — now has a latent `NullPointerException`. The compiler won't catch it (unless you have nullability annotations / a checker). This is a frequent, subtle violation: the signature is identical, the behavioral guarantee silently degraded.

## Question 29

**If `List<Dog>` were a subtype of `List<Animal>`, show the concrete unsoundness.**

```java
List<Dog> dogs = new ArrayList<>();
List<Animal> animals = dogs;     // hypothetically, if List were covariant
animals.add(new Cat());          // type-checks: Cat is an Animal
Dog d = dogs.get(0);             // 💥 it's a Cat — type hole
```

`add` is an input position (wants contravariance); `get` is an output position (wants covariance). A mutable list uses the element type in *both*, so it must be **invariant** — which is exactly why Java generics are invariant. The trap tests whether the candidate can *derive* the unsoundness rather than just assert "generics are invariant."

## Question 30

**Can making a method `final` in a subtype, or removing an overridable method, ever be an LSP concern?**

Generally no for `final` (preventing further overriding doesn't affect substitutability for *this* type's callers). But *reducing visibility* of an inherited method does violate LSP — Java forbids an override from being *less* visible than the base method (you can't override a `public` method as `protected`) precisely because a caller holding the base type could call the `public` method and the subtype must offer at least that access. Reducing accessibility strengthens the precondition ("you may only call me if you have more access"), so the language enforces this LSP rule structurally.

## Question 31

**Trap: "Since the compiler type-checks my override, it's a valid subtype." Respond.**

The compiler verifies only the *signature* — method names, parameter types (invariant in Java/C#), return types (covariant where allowed), and exception declarations. It cannot verify the *behavioral* contract: preconditions, postconditions, invariants, and history. Every classic LSP violation — Square/Rectangle, Penguin.fly(), unmodifiableList — type-checks perfectly and fails behaviorally at runtime. "It compiles" proves type-level conformance, not substitutability. Closing that gap is what LSP discipline (and contract tests) is for.

---

## Design Scenarios

## Question 32

**Design a shape hierarchy that includes squares and rectangles without an LSP violation.**

Three sound options. (A) **Make shapes immutable**: `Rectangle(w, h)` with no setters; "resizing" returns a new instance; `Square` is just `Rectangle.square(side)` — no mutator to corrupt the invariant. (B) **Make them siblings**: `Square` and `Rectangle` both implement `Shape { double area(); }` with no inheritance between them. (C) **Composition**: `Square` holds a `Rectangle` and exposes only `setSide`, not `setWidth`/`setHeight`. The unifying insight: the violation requires *mutation* of independent dimensions; remove mutation or remove the subtype relation. There is no override that makes mutable `Square extends Rectangle` sound.

## Question 33

**Design a bird model where some birds fly, some swim, some do both, with no throwing methods.**

Use capability interfaces (ISP + LSP). Base `Bird { void eat(); }` for what all birds share. Separate `Flyable { void fly(); }`, `Swimmable { void swim(); }`. `Eagle implements Bird, Flyable`; `Penguin implements Bird, Swimmable`; `Duck implements Bird, Flyable, Swimmable`. Code that needs flight takes a `Flyable`, so only birds that *can* fly are even accepted — `migrate(List<Flyable>)` can't be handed a `Penguin`, caught at compile time. No method ever throws `UnsupportedOperationException`, because no type inherits an ability it can't honor.

## Question 34

**You're designing a public collection library. How do you offer immutable collections without the `unmodifiableList` LSP problem?**

Split the type hierarchy so read-only is a genuine *supertype that lacks mutators*: `ReadOnlyList<E>` (only `get`, `size`) and `MutableList<E> extends ReadOnlyList<E>` (adds `add`, `remove`). An immutable implementation implements `ReadOnlyList` and never claims `add`, so there's no method to throw from. Consumers that only read accept `ReadOnlyList`; consumers that mutate accept `MutableList`. Make `ReadOnlyList` covariant (`out E`) if the language allows, since reads are output-only. This is what Kotlin (`List`/`MutableList`), C# (`IReadOnlyList`/`IList`), and Guava (`ImmutableList`) do — and it's the principled fix for the JDK's deliberate wart.

## Question 35

**A teammate added a subtype to a base class used in 40 call sites, and now an intermittent production bug appears. How do you reason about whether it's an LSP violation?**

Look for the signature: generic code written against the base type that's now failing only when the new subtype flows through it. Ask: does the new subtype strengthen any precondition (reject inputs the base accepted)? Weaken any postcondition (return less, throw where the base returned, return null where base promised non-null)? Break an invariant the base guaranteed? Add mutation under an immutable base (history)? If yes to any, it's an LSP violation, and the bug fires precisely at the conjunction of the bad subtype and a base-typed call site. The fix is to restore substitutability (immutability, capability split, composition), not to special-case the subtype in the 40 call sites. Then add a *contract test* run against every subtype so the next violation fails in CI, not production.

## Question 36

**How would you enforce LSP in a large codebase where the compiler only checks signatures?**

Layer the defenses. (1) **Contract tests**: an abstract test suite asserting the base type's behavioral contract (preconditions accepted, postconditions guaranteed, invariants held), run parameterized over *every* subtype in CI — the closest thing to a compiler for behavioral LSP. (2) **Capability interfaces and read/write splits** so violations are structurally impossible to write, not just forbidden. (3) **Sealed hierarchies** where the subtype set is closed, enabling exhaustive auditing and `switch`. (4) **Immutable base types** to eliminate history-constraint violations. (5) **Code-review checklist** for the violation shapes: throwing/no-op overrides, narrowed inputs, changed return meaning, null where non-null was promised. The strategy is to make the type system and CI carry as much of the contract as possible, leaving the least to discipline.

---

## Cheat Sheet

| Concept | One-line answer |
|---------|-----------------|
| **Subtyping** | S <: T means an S is usable wherever a T is expected (the substitution relation). |
| **Subsumption** | `e : S, S <: T ⟹ e : T` — the rule that lets a subtype value be typed at the supertype. |
| **LSP** | A subtype must be substitutable for its base without altering correctness; the "L" in SOLID. |
| **4 rules** | Preconditions can't strengthen, postconditions can't weaken, invariants preserved, history constrained. |
| **Mnemonic** | Require no more, promise no less, break nothing, surprise no one. |
| **Precondition rule** | = parameter contravariance (accept wider/more general input). |
| **Postcondition rule** | = return covariance (return narrower/more specific output). |
| **Function variance** | `(A→B) <: (C→D)` iff `C<:A` (contravariant param) and `B<:D` (covariant return). |
| **Width subtyping** | More fields ⇒ subtype (`{name,age} <: {name}`). |
| **Depth subtyping** | Field replaced by a subtype ⇒ subtype (read-only only). |
| **Variance → position** | Output ⇒ covariant (`out`/`+`/`? extends`); input ⇒ contravariant (`in`/`-`/`? super`); both ⇒ invariant. |
| **Mutable container** | Must be invariant (uses element type in input *and* output). |
| **Covariant arrays** | Java/C# arrays are covariant and *unsound* — patched with runtime `ArrayStoreException`. |
| **Nominal vs structural** | By declaration (no accidents) vs by shape (retrofittable, wider behavioral gap). |
| **Inheritance ≠ subtyping** | Inheritance = code reuse; subtyping = substitutability. Prefer composition over inheritance. |
| **Square/Rectangle** | LSP violation: `setWidth` breaks the independent-dimensions invariant; fix = immutable / siblings / composition. |
| **Penguin.fly()** | Refused bequest; fix = capability interfaces (`Flyable`). |
| **unmodifiableList** | Deliberate JDK LSP violation; principled fix = read-only supertype lacking mutators. |
| **PECS** | Producer Extends, Consumer Super — Java use-site variance. |
| **Enforcement** | Compiler checks signatures only; behavioral LSP needs contract tests run over all subtypes. |
