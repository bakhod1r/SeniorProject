# What Is a Type — Middle Level

> **Topic:** [What Is a Type](README.md)
> **Focus:** The static type (attached to expressions, known at compile time) vs the dynamic type (the runtime tag on a value), what a type system actually checks, and why "well-typed programs don't go wrong."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Where does a type "live"?** On the *expression* (static, compile time) or on the *value* (dynamic, run time)? And **what does a type system actually do** when it "checks" your program?

At the junior level a type is "a set of values plus operations." That's true and useful, but it papers over a distinction that drives every practical decision about typed languages: **a type can be attached to an expression at compile time, or to a value at run time, and these are not the same thing.**

Consider `Animal a = getAnimal();`. The **static type** of the expression `a` is `Animal` — that's what the compiler knows about it, decided before the program runs, by looking at the declaration. But at run time, `a` might *actually* refer to a `Dog`, a `Cat`, or a `Penguin`. That actual runtime identity is the **dynamic type** — the tag the value carries while the program executes. The compiler reasons about static types; the running machine reasons about dynamic types. Most of the subtlety in real typed code lives in the gap between these two.

This page builds the framework. We'll define type checking precisely (verifying that every operation is applied to operands whose static types support it), introduce **type inference** (the compiler reconstructing types you didn't write) and **type erasure** (throwing types away after checking), and state — gently — the property that justifies the whole enterprise: **type soundness**, Robin Milner's slogan that *"well-typed programs don't go wrong."* We'll also nail down what "strong" and "weak" typing really mean (and why those words are nearly useless), and connect a type to the memory layout the compiler chooses for it.

> 🎓 **Why this matters at this level:** Once you understand static-vs-dynamic, a hundred confusing behaviors snap into focus — why a Java cast can fail at run time even though the code compiled, why TypeScript types vanish in the running JavaScript, why Python lets you do anything until the moment it explodes, why a Go `interface{}` needs a "type assertion." These aren't quirks; they're direct consequences of *which* type — static or dynamic — is doing the work at each moment.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior view — a type is a set of values plus valid operations; types classify values; types are contracts.
- **Required:** Comfort writing functions, generics/collections, and at least skimming a compiler/interpreter error message in one typed language.
- **Required:** The difference between "compile" and "run" a program.
- **Helpful but not required:** Having hit a `ClassCastException`, `TypeError`, or "type assertion failed" and wondered why the compiler didn't catch it.
- **Helpful but not required:** Awareness that some languages check types before running (Java, Go, Rust, TypeScript) and some during (Python, JavaScript, Ruby).

You do **not** need:

- Formal type theory (typing judgments, the Curry–Howard correspondence) — that's the senior level.
- The internals of a type inference algorithm (Hindley–Milner) — touched on, detailed later.
- Memory-layout minutiae (alignment, padding) — introduced here, detailed at the professional level.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Static type** | The type the compiler assigns to an *expression* or *variable*, decided at compile time without running the program. |
| **Dynamic type** | The actual type of the *value* at run time, carried as a runtime tag. May be a subtype of the static type. |
| **Type checking** | Verifying that every operation's operands have static types that support the operation. |
| **Static typing** | Type checking performed at compile time, before the program runs. |
| **Dynamic typing** | Type checking performed at run time, as operations execute. |
| **Type inference** | The compiler deducing a type the programmer didn't write explicitly. |
| **Type annotation** | An explicit written type. The opposite of an inferred type. |
| **Type erasure** | Discarding type information after checking, so it's absent at run time (Java generics, TypeScript). |
| **Type soundness** | The guarantee that a well-typed program won't encounter certain runtime type errors. "Well-typed programs don't go wrong." |
| **Type tag** | A runtime marker on a value recording its dynamic type. |
| **Upcast** | Treating a value as one of its supertypes. Always safe. |
| **Downcast** | Treating a value as one of its subtypes. May fail at run time. |
| **Type assertion / cast** | A programmer claim about a value's type that the compiler trusts (and the runtime may verify). |
| **Strong / weak typing** | Vague, contested terms describing how strictly a language prevents type-violating operations. |
| **Memory representation** | The bytes and layout the compiler uses to store a value of a given type. |
| **Nominal typing** | Types are compatible if they share a *name/declaration*. |
| **Structural typing** | Types are compatible if they have the same *shape*. |

---

## Core Concepts

### 1. Static Type: Attached to the Expression

The **static type** is a property of a *piece of program text* — a variable, a literal, a function call, any expression. The compiler computes it without running anything, by following the language's rules:

```java
int n = readInt();        // static type of n is int
String s = "hello";       // static type of s is String
List<User> users = ...;   // static type is List<User>
Animal a = new Dog();     // static type of a is Animal (even though it's a Dog)
```

The static type is the compiler's *conservative knowledge*: it's what the compiler can prove is true about that expression for *every possible run*. That last line is the key example — the compiler only knows `a` is *some* `Animal`. It deliberately forgets that it's a `Dog`, because in general it can't track which subtype flows where.

Crucially, **operations are checked against the static type.** You can call `a.eat()` (every `Animal` can eat), but you cannot call `a.bark()` (not every `Animal` barks) even though `a` happens to be a `Dog` right now. The static type, not the runtime reality, governs what you're allowed to write.

### 2. Dynamic Type: Attached to the Value

The **dynamic type** is a property of an actual *value* at *run time*. The `Dog` object that `a` points to carries — physically, in memory, in dynamically typed and object-oriented languages — a tag saying "I am a Dog." This tag is what makes virtual method dispatch, `instanceof`, `isinstance`, and reflection work.

```java
Animal a = new Dog();
// static type of a:  Animal
// dynamic type of a: Dog
System.out.println(a instanceof Dog); // true — asks the runtime tag
a.makeSound();                         // dispatches on the DYNAMIC type → Dog.makeSound()
```

Note the split in that last line: **what you're allowed to call** is decided by the static type (`Animal` must declare `makeSound`), but **which implementation runs** is decided by the dynamic type (`Dog`'s override). This is the entire mechanism of polymorphism, and it only makes sense once you separate the two notions of type.

### 3. The Static/Dynamic Relationship

In a sound statically typed language with subtyping, there's an invariant:

> The dynamic type of a value is always the static type of its expression **or a subtype of it.**

`Animal a` may hold an `Animal`, `Dog`, or `Cat` — never a `String`. This is exactly *why* static checking is safe: the compiler proves a bound (`a` is at most an `Animal`), and the runtime can only ever do better (a more specific subtype), never worse. When you **downcast** (`Dog d = (Dog) a;`), you're asking the runtime to *verify* a guess the static type couldn't confirm — and it can fail (`ClassCastException`) precisely because the static type was a loose upper bound.

### 4. What "Type Checking" Actually Does

Type checking is the process of walking the program and, for each operation, asking: *do the static types of the operands support this operation?* For `x + y`, it asks "is there a `+` defined for these two static types?" For `f(a, b)`, it asks "do `a` and `b`'s static types match `f`'s declared parameter types?" For `obj.method()`, "does `obj`'s static type declare `method`?"

A **static type checker** does all of this at compile time and rejects the program if any check fails — the error appears before the program ever runs. A **dynamic type checker** (a dynamically typed language's runtime) does the same checks but *lazily*, at the moment each operation executes — so `x + y` is checked only when that line actually runs, and only for the values that actually reach it.

The trade-off is stark and worth internalizing: static checking proves the *absence* of type errors across *all* runs but requires the program to satisfy the checker; dynamic checking catches type errors only on the paths and inputs you actually exercise, but never blocks you from running.

### 5. Type Inference: Types You Didn't Write

A statically typed language does not require you to *write* every type. **Type inference** lets the compiler reconstruct them:

```go
x := 42            // Go infers x is int
y := "hello"       // y is string
m := map[string]int{}  // m is map[string]int
```

```rust
let v = vec![1, 2, 3];   // Rust infers Vec<i32>
let n = v.len();          // n is usize
```

Inference ranges from local (Go, C++ `auto`, Java `var` — infer from the right-hand side) to whole-program (Haskell, ML — infer a function's types from how it's used, via the Hindley–Milner algorithm). The important point: **inferred and annotated types are equally static.** Inference is about *who wrote the type down*, not about *when it's known*. The type still exists at compile time; the compiler just figured it out instead of you typing it.

### 6. Type Erasure: Types Gone at Run Time

After checking, some languages **erase** types — the running program has no record of them:

- **Java generics** are erased: `List<String>` and `List<Integer>` are *both* just `List` at run time. The `<String>` exists only to check your code; the JVM never sees it. That's why you can't write `new T[]` or `x instanceof List<String>`.
- **TypeScript** erases *everything*: the compiler checks types, then emits plain JavaScript with all annotations stripped. At run time there is no type information from TypeScript at all.

Erasure is a deliberate trade: you get static checking with zero runtime cost and full backward compatibility, but you lose the ability to *inspect* the erased types at run time. Contrast with languages that keep types around (C# reified generics, Python's runtime types) where `typeof`/`isinstance` can see the full type.

### 7. Type Soundness: "Well-Typed Programs Don't Go Wrong"

This Milner slogan is the *reason type systems exist*. A type system is **sound** if a program that passes the type checker is guaranteed never to hit a certain class of runtime type errors — calling a method that doesn't exist, adding a function to an integer, treating bytes as a pointer. "Don't go wrong" has a precise meaning: the program will never reach a *stuck* state where an operation is applied to an operand of the wrong type with no defined behavior.

Soundness is what makes static types worth the trouble. If the checker accepts your program, an entire category of failures is *provably impossible*, not merely tested-against. Crucially, soundness says nothing about *logic* bugs — a well-typed program can still compute the wrong answer, loop forever, or violate business rules. Types rule out a specific class of failure (type errors), and that class is large and valuable, but it is not "all bugs."

Real-world languages make pragmatic holes in soundness: Java's `null` (a `String` variable can be `null`), unchecked casts, `unsafe` blocks in Rust, `any` in TypeScript, reflection. Each hole is a place where the language traded a soundness guarantee for flexibility — and each is a place runtime type errors can creep back in.

### 8. Strong vs Weak Typing — Why the Terms Are Vague

People say "Python is strongly typed, C is weakly typed," but the terms have no agreed definition. Roughly, a "strong" type system rarely lets you violate type rules implicitly; a "weak" one allows lots of implicit coercion or reinterpretation of bytes. But the line is blurry:

- Python won't add `1 + "1"` (feels strong) but has no compile-time checking (feels weak).
- C will happily reinterpret an `int*` as a `char*` (feels weak) but won't silently turn a struct into a function.
- JavaScript coerces aggressively (`[] + {}` → `"[object Object]"`) — usually called weak.

Better, more precise axes to talk about instead of "strong/weak":

- **Static vs dynamic** — *when* checking happens.
- **Sound vs unsound** — whether well-typed programs are *guaranteed* free of type errors.
- **Implicit vs explicit conversions** — how much the language coerces for you.
- **Memory-safe vs memory-unsafe** — whether you can reinterpret raw bytes.

Use these. "Strong/weak" creates more arguments than it resolves.

### 9. A Type Tells the Compiler the Memory Layout

A type isn't only a logical set of values — for a compiled language it's also a **physical layout decision**. The type tells the compiler exactly how many bytes to allocate and how to interpret them:

| Type | Size (typical) | What the bytes mean |
|------|----------------|---------------------|
| `bool` | 1 byte | 0 = false, nonzero = true |
| `int32` | 4 bytes | two's-complement integer |
| `float64` | 8 bytes | IEEE-754 double |
| `*T` (pointer) | 8 bytes | a memory address |
| `struct{a int32; b int32}` | 8 bytes | two ints side by side |

The *same bytes* mean different things under different types: the 4 bytes `0x40490FDB` are the integer `1078530011` as `int32` but the value `3.1415927` as `float32`. The type is the lens that tells the hardware how to read the bits. This is also why **type safety and memory safety are related but distinct**: type safety says "you won't apply the wrong operation to a value"; memory safety says "you won't read or write memory you shouldn't." A language can have one without the other — but losing type safety often opens the door to losing memory safety too.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Static type** | The label on a shipping container: "ELECTRONICS." Decided and stamped before the ship sails. |
| **Dynamic type** | What's *actually* inside the container when opened at the destination — maybe specifically "phones." |
| **Static ⊆ dynamic invariant** | A box labeled "FRUIT" may contain apples or oranges, never a brick. The label is an honest upper bound. |
| **Downcast that fails** | Opening a "FRUIT" box expecting *apples* and finding oranges — your assumption was narrower than the label promised. |
| **Type checking** | Customs inspecting that the contents match the declared category before the goods move. |
| **Type inference** | A clerk who fills in the category for you by looking at the contents, so you don't have to write it. |
| **Type erasure** | Removing all the labels once goods clear customs — fine for shipping, but now you can't tell boxes apart by sight. |
| **Type soundness** | A guarantee from customs: "anything that cleared will never explode in transit" (rules out one disaster class, not all). |
| **Type as memory layout** | A blueprint that says "these 8 bytes are two 4-byte integers" — the same wall of bricks, read as a structure. |

---

## Mental Models

### The Two-Question Model

For any value at any moment, ask two *separate* questions: (1) **What does the compiler think this is?** (static type — governs what you may write) and (2) **What is it really, right now?** (dynamic type — governs which code runs). Almost every confusing typed-language behavior dissolves once you keep these questions apart. A cast is "I'm asking the runtime to confirm my answer to question 2 is more specific than question 1."

### The Upper-Bound Model

The static type is an **upper bound** on the value: a promise that the value is *at most* this general. `Animal a` promises "no worse than an `Animal`." The runtime is always free to be *more specific* (a `Dog`), never *less* (a `String`). Static checking is safe because it reasons about the bound, and the bound is never violated. Downcasting is "betting the actual value is tighter than the bound" — and the bet can lose.

### The "Lens Over Bits" Model

Underneath, memory is just bytes. A type is a **lens** that says how to read a region of bytes: as an integer, a float, a pointer, a struct. Two different types over the same bytes give two different readings. This model explains both performance (the compiler picks tight layouts) and danger (reinterpreting bytes under the wrong type — a `union`, a `reinterpret_cast`, an `unsafe` transmute — is exactly putting the wrong lens on the bits).

### The "Proof vs Test" Model

Static type checking is a **proof** about all runs: "no type error can occur, for any input, on any path." Dynamic type checking is a **test** on the actual run: "no type error occurred *this time*, on *this* path, with *these* values." Soundness is the statement that the proof is valid. Holes in soundness (`null`, casts, `any`) are places where the proof has a gap, and a runtime test is the only safety net left.

---

## Code Examples

### Java — static vs dynamic, and a downcast that fails

```java
class Animal { void eat() {} }
class Dog extends Animal { void bark() {} }
class Cat extends Animal {}

Animal a = new Dog();   // static: Animal, dynamic: Dog
a.eat();                // OK: Animal supports eat()
// a.bark();            // COMPILE ERROR: Animal has no bark() — static type governs

Dog d = (Dog) a;        // downcast: runtime VERIFIES the dynamic type. OK here.
d.bark();               // now legal: d's static type is Dog

Animal b = new Cat();
Dog d2 = (Dog) b;       // compiles fine, but throws ClassCastException at run time
```

The compiler accepts `(Dog) b` because, statically, `b` *could* be a `Dog` (it's an `Animal`). Only the runtime, checking the actual tag (`Cat`), can reject it. This is the static/dynamic gap made concrete.

### Java generics — type erasure

```java
List<String> ss = new ArrayList<>();
List<Integer> is = new ArrayList<>();
System.out.println(ss.getClass() == is.getClass()); // true!  both are ArrayList at run time

// is instanceof List<Integer>  // COMPILE ERROR: cannot check erased type
```

`<String>` and `<Integer>` are erased after checking — the JVM sees only `ArrayList`. The generic types existed solely to let the compiler verify your code.

### Python — checking happens at run time

```python
def process(x):
    return x.upper()      # no static type; nothing checked until this runs

process("hello")          # works: str has .upper()
process(42)               # AttributeError at run time: 'int' has no 'upper'
```

Nothing rejects `process(42)` ahead of time. The "type check" is the runtime attribute lookup, performed lazily, only when the line executes with that value. The dynamic type *is* the type system here.

### TypeScript — types checked then fully erased

```typescript
function double(n: number): number {
  return n * 2;
}
// Compiles to plain JS with NO types:
//   function double(n) { return n * 2; }

const x: unknown = "hi";
// const y: number = x;        // COMPILE ERROR: unknown not assignable to number
const y = x as number;          // assertion: compiler trusts you; NO runtime check
console.log(y * 2);             // runs, produces "hihi"... or NaN — types are gone
```

TypeScript checks at compile time, then emits type-free JavaScript. The `as number` assertion is *not* verified at run time (unlike a Java cast) — TypeScript has nothing to verify with, because the types are erased.

### Go — static type plus a runtime type assertion

```go
var i interface{} = "hello"   // static type: interface{}, dynamic type: string

s := i.(string)               // type assertion: checked at run time
fmt.Println(s)                // hello

n, ok := i.(int)              // comma-ok form: ok == false, no panic
fmt.Println(ok)               // false
// n2 := i.(int)              // would PANIC: interface holds string, not int
```

`interface{}` is Go's "any" — a static type that erases the specifics. To recover the dynamic type you *assert* it, and the runtime verifies against the stored tag.

### Rust — inference, and the type as memory layout

```rust
let x = 3.1415_f32;            // inferred f32: 4 bytes, IEEE-754 single
let bits = x.to_bits();        // the same 4 bytes read as a u32
println!("{:#010x}", bits);    // 0x40490fdb

// reinterpreting the bits under a different type:
let y = f32::from_bits(0x40490fdb);
println!("{}", y);             // 3.1415927

assert_eq!(std::mem::size_of::<f32>(), 4);
assert_eq!(std::mem::size_of::<(i32, i32)>(), 8); // type dictates layout/size
```

`size_of` shows the type *is* a layout decision. `to_bits`/`from_bits` show the same bytes meaning different things under different types — the "lens over bits" model in action.

### Type inference is still static — Go and Rust

```go
x := compute()   // x's type is fixed at compile time by compute()'s return type
```

```rust
let v: Vec<_> = (0..5).collect();  // element type inferred from context; fully static
```

You didn't write the type, but it's known and checked at compile time. Inference ≠ dynamic typing.

---

## Pros & Cons

| Aspect | Static typing | Dynamic typing |
|--------|---------------|----------------|
| **When errors caught** | Compile time, across all paths. | Run time, only on exercised paths. |
| **Guarantees** | Soundness can rule out type errors entirely (modulo holes). | No ahead-of-time guarantee. |
| **Tooling** | Rich: autocomplete, refactor, navigation from static types. | Weaker; the IDE can't always know the type. |
| **Speed of iteration** | Must satisfy the checker before running. | Run immediately, fix as you go. |
| **Performance** | Types drive efficient layout and dispatch. | Runtime tags cost memory and indirection. |
| **Expressiveness** | Some valid programs are rejected (checker is conservative). | Anything goes until it breaks. |
| **Erasure cost** | Erased types: no runtime info (can't reflect on them). | Full runtime types available for reflection. |

---

## Use Cases

- **Choose static typing** for large, long-lived, multi-author codebases; for APIs and libraries where the contract must be enforced; for performance-critical code; for domains where a type error is expensive (payments, medical, aerospace).
- **Choose dynamic typing** for scripting, glue code, rapid prototyping, data exploration, and situations where the data shape is genuinely unknown until run time.
- **Use gradual/optional typing** (TypeScript over JS, mypy over Python) to get static guarantees on the parts that matter while keeping dynamic flexibility elsewhere — the common modern compromise.
- **Reach for runtime type info** (reflection, `isinstance`, type assertions) deliberately and sparingly — it's where static guarantees end and runtime checks begin.

---

## Coding Patterns

### Pattern 1: Prefer the comma-ok / checked downcast over the panicking one

```go
if s, ok := i.(string); ok {
    use(s)
} // never panics; you handle the "wrong type" case explicitly
```

Whenever you cross from a loose static type to a specific one, use the form that lets you *handle* a mismatch rather than the one that crashes.

### Pattern 2: Annotate boundaries, infer internals

```rust
fn parse_config(raw: &str) -> Config { /* ... */ }  // annotate the public contract
// inside:
let parts: Vec<_> = raw.split(',').collect();        // let inference handle locals
```

Write types where they're contracts (function signatures); let inference remove noise where the type is obvious from context.

### Pattern 3: Push runtime-type branching to the edge

Convert from `interface{}`/`any`/`Object` to a concrete type *once*, at the boundary (deserialization, plugin loading), then work with concrete static types everywhere inside. Don't sprinkle type assertions through your core logic.

### Pattern 4: Use the type system's own escape hatch honestly

When you must reinterpret (a `union`, `unsafe`, `as`), isolate it in a small, well-named, well-tested function with a comment stating the invariant you're asserting that the compiler can't. The escape hatch is a debt; localize it.

---

## Best Practices

- **Keep the static/dynamic distinction explicit in your head** when debugging "but it compiled!" errors — a runtime cast failure is the static type being looser than reality.
- **Don't reach for casts to silence the checker.** A cast moves a compile error to run time; it rarely *solves* anything. Restructure so the types line up.
- **Treat `null` as a type hole.** In languages where any reference can be `null`, defend at boundaries or adopt optional/nullable types that make the possibility explicit.
- **Annotate public APIs; infer private locals.** Maximize signal (contracts) and minimize noise (obvious locals).
- **Remember erasure when you reach for reflection.** If you're on Java generics or TypeScript, the type you want to inspect at run time may simply not exist anymore.
- **Stop using "strong/weak."** Say "statically/dynamically typed," "sound/unsound," "memory-safe/unsafe," "implicit/explicit conversions" — you'll be understood precisely.
- **Respect the layout meaning of a type.** Picking `int32` vs `int64`, `float32` vs `float64`, or a struct ordering is a real memory and performance decision, not just a label.

---

## Edge Cases & Pitfalls

- **"It compiled, so it's correct" is false.** Static typing rules out *type* errors, not logic errors, infinite loops, or business-rule violations. A well-typed program can still be wrong.
- **A successful cast proves nothing about *future* runs.** `(Dog) a` working once means *this* value was a `Dog`; another run with a `Cat` still throws.
- **Erased generics defeat runtime checks.** `if (x instanceof List<String>)` doesn't compile; at run time you can only see `List`. Don't design around inspecting erased types.
- **Inference can surprise you.** `let x = 5;` might infer `i32` when you wanted `i64`, or Go's `:=` may pick a type you didn't intend. Annotate when the inferred type matters.
- **`any`/`interface{}`/`Object` is a static-typing off switch.** Every value fits, so the checker stops helping. Each one is a place runtime type errors can return.
- **Implicit conversions can silently lose information.** `int` → `float` may lose precision; `long` → `int` may truncate. The type system may allow conversions that quietly corrupt data.
- **Nominal vs structural surprises.** In nominal languages, two identical-looking structs are *different* types; in structural ones (TypeScript), two differently-named types with the same shape are *compatible*. Know which discipline your language uses.

---

## Common Mistakes

1. **Believing the dynamic type is what the compiler checks.** It checks the *static* type; the dynamic type only governs which implementation runs and whether casts succeed.
2. **Thinking type inference means dynamic typing.** Inferred types are fully static — known and checked at compile time. Only *who wrote them* differs.
3. **Treating a TypeScript `as` assertion like a Java cast.** TS assertions are *not* checked at run time (types are erased); they only silence the compiler.
4. **Assuming static typing makes a program correct.** It rules out one class of bug. The rest are still yours.
5. **Using "strongly typed" as if it had a precise meaning.** It doesn't; it confuses static-ness, soundness, and coercion behavior into one fuzzy word.
6. **Forgetting that a type fixes memory layout.** Choosing `float32` over `float64` or reordering struct fields has real size/performance consequences.
7. **Reaching for reflection on erased types** and being puzzled when the type information isn't there.

---

## Tricky Points

- **The static type is deliberately *forgetful*.** Even when the compiler could in principle track that `a` is a `Dog`, it generally treats it as the declared `Animal`, because tracking the precise flow of every subtype is undecidable in general. Flow-sensitive typing (TypeScript's narrowing, Kotlin smart casts) recovers *some* of this locally.
- **Soundness is a property of the *type system*, not your program.** A sound system guarantees *all* well-typed programs avoid type errors. Adding one unsound feature (an unchecked cast) breaks the guarantee for the whole language, which is why these holes are designed carefully.
- **Erasure vs reification is a spectrum.** Java erases generics; C# reifies them (the type is available at run time); Go's interfaces carry the dynamic type but generics (since 1.18) are partly erased. The choice shapes what reflection can do.
- **"Goes wrong" has a technical meaning.** In Milner's formulation, a program "goes wrong" when evaluation gets *stuck* — an operation with no rule for its operand types. Soundness = well-typed programs never get stuck. It does *not* mean "never crashes" (a sound program can still `panic`, throw, or diverge).
- **Memory safety and type safety can be decoupled.** Assembly is memory-unsafe and type-unsafe. A garbage-collected dynamic language is memory-safe but does runtime type checks. Rust is both type-safe and memory-safe *without* GC. They're related dials, not one dial.

---

## Test Yourself

1. For `Animal a = new Dog();`, state the static type and the dynamic type of `a`, and explain which one decides whether `a.bark()` compiles.
2. Why can `(Dog) someAnimal` compile yet throw `ClassCastException` at run time? What invariant makes the *upcast* direction always safe?
3. Is `let x = 5;` (with inference) statically or dynamically typed? Defend your answer.
4. Explain what Java generic *erasure* removes, and give one thing you therefore *cannot* do at run time.
5. State Milner's soundness slogan and explain precisely what "go wrong" means — and one kind of bug soundness does *not* prevent.
6. Why are "strong" and "weak" typing poor terms? Name three more precise axes to use instead.
7. The 4 bytes `0x40490FDB` are `1078530011` as an `int32` and `3.1415927` as a `float32`. What does this tell you about the relationship between a type and memory?
8. A TypeScript `x as number` assertion and a Java `(Integer) x` cast look similar. How do they differ at *run time*, and why?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            STATIC vs DYNAMIC TYPE  (the core distinction)        │
├──────────────────────────────────────────────────────────────────┤
│  STATIC type   → on the EXPRESSION,  known at COMPILE time        │
│                  decides WHAT YOU MAY WRITE                       │
│  DYNAMIC type  → on the VALUE,        carried at RUN time         │
│                  decides WHICH CODE RUNS / if a cast succeeds     │
│                                                                  │
│  Invariant: dynamic type ⊆ static type (it's an upper bound)     │
├──────────────────────────────────────────────────────────────────┤
│  TYPE CHECKING = "does each operation's operands' static types   │
│                   support the operation?"                        │
│    static checker → at compile time, all paths (a PROOF)         │
│    dynamic checker → at run time, exercised paths (a TEST)       │
├──────────────────────────────────────────────────────────────────┤
│  INFERENCE  = compiler reconstructs a type you didn't write      │
│               (still 100% static — inferred ≠ dynamic)           │
│  ERASURE    = types discarded after checking (Java generics, TS) │
│               → can't inspect them at run time                   │
├──────────────────────────────────────────────────────────────────┤
│  SOUNDNESS = "well-typed programs don't go wrong" (Milner)       │
│    "go wrong" = evaluation gets STUCK on a type-mismatched op    │
│    rules out TYPE errors — NOT logic bugs, loops, or panics      │
│    holes: null, casts, any, unsafe, reflection                   │
├──────────────────────────────────────────────────────────────────┤
│  Don't say strong/weak. Say:                                     │
│    static vs dynamic | sound vs unsound                          │
│    implicit vs explicit conversion | memory-safe vs unsafe       │
├──────────────────────────────────────────────────────────────────┤
│  A TYPE = also a LAYOUT: how many bytes + how to read them       │
│    same bytes, different type → different value (the "lens")     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A type can be attached to an **expression at compile time** (the **static type**) or to a **value at run time** (the **dynamic type**). They are different questions and most subtlety lives between them.
- The static type **governs what you may write**; the dynamic type **governs which implementation runs** and whether a downcast succeeds. The dynamic type is always the static type or a **subtype** of it.
- **Type checking** verifies each operation's operands support it. A **static checker** does this at compile time (a proof over all runs); a **dynamic checker** does it lazily at run time (a test of this run).
- **Type inference** reconstructs unwritten types but is still fully static. **Type erasure** discards types after checking (Java generics, TypeScript), so they can't be inspected at run time.
- **Type soundness** — "well-typed programs don't go wrong" (Milner) — is the payoff: a sound system *provably* rules out a class of runtime type errors. It does *not* rule out logic bugs, loops, or panics. Real languages punch holes in soundness (`null`, casts, `any`, `unsafe`) for flexibility.
- **"Strong" and "weak" typing are vague.** Prefer static/dynamic, sound/unsound, implicit/explicit conversions, memory-safe/unsafe.
- A type is also a **memory-layout decision**: it tells the compiler how many bytes a value takes and how to read them. The same bytes mean different things under different types — the "lens over bits."
- **Type safety and memory safety are related but distinct** dials; a language can have either, both, or neither.

---

## Further Reading

- *Types and Programming Languages* — Benjamin C. Pierce. Chapters 1, 8, 9, 11; the canonical treatment of checking and soundness.
- "A Theory of Type Polymorphism in Programming" — Robin Milner, 1978. The origin of "well-typed programs don't go wrong" and Hindley–Milner inference.
- *The Java Language Specification* — sections on type erasure and casting. https://docs.oracle.com/javase/specs/
- *The TypeScript Handbook* — "Type Compatibility" and "Narrowing." https://www.typescriptlang.org/docs/handbook/
- *Programming in Scala* / *Programming Rust* — practical chapters contrasting nominal/structural and inference.
- "What To Know Before Debating Type Systems" — Chris Smith. The classic essay on why "strong/weak" is misleading.
- *Practical Foundations for Programming Languages* — Robert Harper. A rigorous, modern account of statics and dynamics.
- "Parsing Gigabytes of JSON per Second" and similar — for how type/layout choices drive real performance (background reading).
