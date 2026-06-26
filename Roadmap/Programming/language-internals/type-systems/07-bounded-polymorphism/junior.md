# Bounded Polymorphism — Junior Level

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Why a plain `<T>` can only shuffle values around, and how adding a *bound* (`<T extends Comparable<T>>`, `T: Ord`) suddenly lets generic code *do* something with that `T`.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What can you actually *do* with a generic type parameter?** The answer depends entirely on whether you bounded it.

Write a generic function with an unbounded type parameter — `<T>` in Java, `fn f<T>(...)` in Rust, `func F[T any](...)` in Go — and you'll quickly hit a wall. You can *hold* a `T`, *pass* a `T`, *return* a `T`, put `T`s in a list and take them back out. What you **cannot** do is call any method on a `T`, compare two `T`s, add them, print them in a formatted way, or even ask "are these equal?". The compiler rejects all of it. The reason is simple and deep: the function promised to work for *every possible type*, and most types don't have a `.compareTo`, a `+`, or a meaningful `<`. The compiler holds you to that promise.

**Bounded polymorphism** is how you negotiate. Instead of "works for every type," you say "works for every type *that can be compared*," or "*that can be added*," or "*that has a `.draw()` method*." You write a **bound** on the type parameter:

```java
static <T extends Comparable<T>> T max(T a, T b) { ... }   // Java
```
```rust
fn max<T: Ord>(a: T, b: T) -> T { ... }                    // Rust
```

The bound `extends Comparable<T>` / `: Ord` is a **constraint**. It narrows the set of types `T` can be — only comparable types now qualify — and in exchange the compiler hands you new powers *inside* the function body: now you're allowed to call `a.compareTo(b)`, or write `a < b`. You traded universality for capability. That trade is the entire subject of this page.

> 🎓 **Why this matters for a junior:** The single most common confusion when you start writing generics is "I have a `<T>`, why can't I call `.toString()` / `<` / `.equals()` on it?" The answer is *always* "because you didn't bound it." Once you internalize *unbounded means you can only move it; bounded means you can use it*, generics stop feeling like a wall and start feeling like a dial.

This page covers: the contrast between unbounded and bounded type parameters, why unbounded is so restrictive (the idea of **parametricity**), how to read and write a simple upper bound in Java, Rust, Go, Swift, C#, and Haskell, and the everyday workhorse example — a generic `max` function. The deeper machinery (recursive `T extends Comparable<T>` bounds, multiple bounds, typeclasses vs subtyping, the expression problem) is for the middle and senior pages.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a *generic* (parameterized) type or function is at the most basic level — `List<T>`, `Vec<T>`, a function that works on more than one type.
- **Required:** How to call a method or operator in at least one language (`a.foo()`, `a < b`).
- **Required:** The idea of an *interface* / *trait* / *protocol* — a named bundle of method signatures a type can implement.
- **Helpful but not required:** A vague sense of *subtyping* ("a `Dog` is an `Animal`"). Bounds in Java/C#/Swift lean on it.
- **Helpful but not required:** Having hit the "cannot call method on `T`" compiler error yourself. It makes everything here click.

You do **not** need to know:

- How the compiler implements bounds (dictionary passing vs subtype checks — that's `middle.md`/`senior.md`).
- F-bounded / recursive bounds (`<E extends Enum<E>>`), associated types, or the expression problem — later pages.
- Variance (`? extends`, `? super`, covariance) — related but a separate topic.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Generic / parametric polymorphism** | Code written once that works for many types, with the type as a parameter (`<T>`). |
| **Type parameter** | The placeholder type, e.g. the `T` in `List<T>` or `max<T>`. |
| **Unbounded type parameter** | A type parameter with **no** constraint (`<T>`, `T: Sized` only, `T any`). You can move values of it but call nothing on it. |
| **Bound / constraint** | A requirement placed on a type parameter, e.g. `extends Comparable<T>`, `: Ord`, `: Comparable`. |
| **Bounded polymorphism** | Generic code whose type parameter carries a bound, so the body can *use* the type's capabilities. |
| **Upper bound** | The common kind of bound: "`T` must be (a subtype of / implement) this interface." `extends`, `:`. |
| **Interface / trait / protocol / typeclass** | A named set of operations a type can provide. The thing you bound *by*. |
| **`Comparable` / `Ord`** | The "can be ordered" capability. The textbook example used to demonstrate bounds. |
| **Parametricity** | The principle that truly unbounded generic code can do almost nothing with its `T` except pass it around — because it has no idea what `T` is. |
| **Method / operator dispatch** | Choosing which concrete code runs when you call `a.compareTo(b)` on a bounded `T`. |
| **Capability** | The informal word for "what the bound lets you do" — compare, add, clone, print, etc. |

---

## Core Concepts

### 1. Unbounded `<T>`: you can only move it

Start with the most generic function imaginable:

```java
static <T> T identity(T x) { return x; }
```

This compiles, works for *every* type, and is correct — but notice it does *nothing* to `x`. It can't. Try to add even one operation:

```java
static <T> T bigger(T a, T b) {
    return a > b ? a : b;   // COMPILE ERROR: operator > undefined for T
}
```

The compiler refuses. From its point of view, `T` could be `String`, `LocalDate`, `Thread`, `JButton`, or your own `class Potato`. Most of those have no `>`. The promise "works for every `T`" forbids any operation that isn't shared by *literally every* type.

A useful way to see it: with unbounded `<T>`, the only things you can do with a `T` value are **store it, pass it, return it, and put it in / take it out of generic containers**. You can shuffle values around. You cannot inspect them.

### 2. The bound adds a capability

Now constrain `T` to types that *can* be compared:

```java
static <T extends Comparable<T>> T bigger(T a, T b) {
    return a.compareTo(b) >= 0 ? a : b;   // OK now
}
```

By writing `extends Comparable<T>`, you told the compiler: *"I will only ever be called with types that implement `Comparable`."* In return, the compiler now lets you call `Comparable`'s methods — `compareTo` — inside the body. You **narrowed** the set of acceptable `T`s (no more `Thread`, no more `Potato`-without-`Comparable`) and in exchange you **gained** the `compareTo` capability.

That's the whole bargain of bounded polymorphism, in one sentence:

> **A bound shrinks *who can call you* so that it can grow *what you can do.***

### 3. Reading a bound in five languages

The syntax differs; the idea is identical. "`T`, but only types that can be ordered":

```java
<T extends Comparable<T>>      // Java   (subtype bound)
```
```csharp
where T : IComparable<T>       // C#     (subtype bound)
```
```swift
<T: Comparable>                // Swift  (protocol bound)
```
```rust
T: Ord                         // Rust   (trait bound)
```
```haskell
Ord a => ...                   // Haskell (typeclass constraint)
```

In Go, the same shape uses a *constraint interface*:

```go
func Max[T cmp.Ordered](a, b T) T { ... }   // Go 1.21+ (cmp.Ordered constraint)
```

Read every one of these as: "*`T` is any type, **as long as** it provides ordering.*" The keyword (`extends`, `where`, `:`, `=>`) is just punctuation around the same contract.

### 3.5 Upper bounds are the common case

When you write `extends Comparable<T>` or `: Ord`, you're stating an **upper bound**: `T` must be *at most* as general as the bound — it must implement it. This is by far the most common kind of bound and the only one you need at the junior level. (Lower bounds and variance — `? super T` — exist but solve a different problem, namely "what can flow *into* a generic container," and belong to a later discussion.)

### 4. Why the constraint propagates

A subtle but important rule: if your function uses a bounded helper, *you* must carry the same bound.

```java
static <T extends Comparable<T>> T maxOf(List<T> xs) {
    T best = xs.get(0);
    for (T x : xs) best = bigger(best, x);   // bigger needs Comparable
    return best;
}
```

`maxOf` calls `bigger`, and `bigger` requires `T extends Comparable<T>`. So `maxOf` must *also* declare `T extends Comparable<T>` — otherwise it couldn't satisfy `bigger`'s requirement. Bounds **flow upward** through the call chain. You can never have *less* constraint than the things you call. (At the junior level just remember: if the compiler complains that a bound is "not satisfied," you usually need to repeat the bound on the *outer* function too.)

### 5. The bound is a contract, checked at the call site

When someone calls `bigger(a, b)`, the compiler checks at the *call site* that the actual type really does satisfy the bound:

```java
bigger("apple", "banana");       // OK: String implements Comparable<String>
bigger(new Thread(), new Thread()); // ERROR: Thread is not Comparable
```

So the safety is two-sided. Inside the function, the compiler *gives* you the capability. At the call site, it *demands* you supply a type that has it. Neither side can cheat. That's why bounded generics are both flexible *and* type-safe — there's no cast, no runtime "does this support `<`?" check, no `ClassCastException`. It's settled at compile time.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Unbounded `<T>`** | A sealed cardboard box you can carry, hand off, and stack — but never open. You can move it; you can't use what's inside. |
| **Bound (`extends Comparable`)** | A label on the box that says "contents are weighable." Now you're allowed to put it on a scale. |
| **The bound's interface** | A job requirement: "must have a driver's license." It rules out some applicants and lets you ask the rest to drive. |
| **Calling `compareTo` on a bounded `T`** | Asking the licensed driver to drive. You can only ask because the requirement guaranteed they can. |
| **Call-site check** | The bouncer at the door checking IDs. Only people who meet the requirement get in. |
| **Constraint propagation** | A subcontractor needs licensed drivers, so the general contractor must *also* require licensed drivers when hiring for that crew. |
| **Parametricity** | A blindfolded courier: knows nothing about the package, so all they can do is carry it from A to B. |

---

## Mental Models

### The "dial from universal to capable" model

Picture a dial. Turn it all the way to one end — *unbounded* — and your function works for the maximum number of types but can do the minimum with them (basically nothing). Turn it toward the other end by adding bounds, and each bound trades away some types (those that don't satisfy it) for some capabilities (the bound's methods). `<T>` works for everything and does nothing; `<T extends Number>` works for numbers and can call `doubleValue()`; `<T extends MyVerySpecificThing>` works for almost nothing and can do almost anything. Bounded polymorphism is choosing where to set the dial.

### The "permission slip" model

A type parameter is an unknown type, and by default the compiler gives you **zero permissions** on it. A bound is a *permission slip*: `extends Comparable<T>` grants you permission to call exactly the methods `Comparable` declares — and nothing more. If you bounded by `Comparable` but try to call `.add()`, the compiler still says no, because `add` wasn't on the slip. You get *precisely* the capabilities of the bound, no more, no less.

### The "what does the compiler know" model

Inside an unbounded function, ask: *what does the compiler know about `T`?* Answer: that it's a type. That's it. So it lets you do only what's safe for *any* type. Inside a bounded function, the compiler additionally knows *`T` implements this interface* — so it lets you do everything that interface promises. The capabilities you have are exactly equal to what the compiler can prove. Bounds are how you tell it more.

---

## Code Examples

The running example everywhere: a generic **`max`** of two values. First the unbounded version that *won't compile*, then the bounded version that does.

### Java

```java
// WON'T COMPILE — unbounded T has no ordering
static <T> T maxBroken(T a, T b) {
    return a.compareTo(b) >= 0 ? a : b;   // error: cannot find symbol compareTo
}

// WORKS — bounded by Comparable
static <T extends Comparable<T>> T max(T a, T b) {
    return a.compareTo(b) >= 0 ? a : b;
}

public static void main(String[] args) {
    System.out.println(max(3, 7));            // 7  (Integer is Comparable)
    System.out.println(max("pear", "apple")); // "pear" (String is Comparable)
    // max(new Object(), new Object());       // would not compile: Object isn't Comparable
}
```

The bound `T extends Comparable<T>` is what unlocks `a.compareTo(b)`. Without it, the *exact same body* is rejected.

### Rust

```rust
// WON'T COMPILE — no ordering on an unbounded T
// fn max_broken<T>(a: T, b: T) -> T { if a >= b { a } else { b } }
//                                         ^^^^^^ error: binary operation `>=` not supported

// WORKS — trait bound T: Ord (or PartialOrd) provides comparison
fn max<T: Ord>(a: T, b: T) -> T {
    if a >= b { a } else { b }
}

fn main() {
    println!("{}", max(3, 7));               // 7
    println!("{}", max("pear", "apple"));    // "pear"
}
```

Rust spells the bound `T: Ord`. The `>=` operator works because the `Ord` trait provides it. (Rust's standard library already ships `std::cmp::max`, but this shows the mechanism.)

### Go

```go
package main

import (
	"cmp"
	"fmt"
)

// WORKS — T is constrained to ordered types via cmp.Ordered
func Max[T cmp.Ordered](a, b T) T {
	if a > b {
		return a
	}
	return b
}

func main() {
	fmt.Println(Max(3, 7))             // 7
	fmt.Println(Max("pear", "apple"))  // "pear"
}
```

Go expresses the bound as a *constraint interface*, `cmp.Ordered`, listing the types that support `<`/`>`. An unconstrained `[T any]` would reject `a > b` exactly like the others.

### Swift

```swift
// WORKS — protocol bound T: Comparable
func maxOf<T: Comparable>(_ a: T, _ b: T) -> T {
    return a >= b ? a : b
}

print(maxOf(3, 7))            // 7
print(maxOf("pear", "apple")) // "pear"
```

Swift bounds by *protocol*: `T: Comparable`. The `>=` operator is a requirement of the `Comparable` protocol, so the body may use it.

### C#

```csharp
static T Max<T>(T a, T b) where T : IComparable<T>
{
    return a.CompareTo(b) >= 0 ? a : b;
}

// Max(3, 7) -> 7 ;  Max("pear","apple") -> "pear"
```

C# uses a `where T : IComparable<T>` clause — same upper-bound idea, different keyword.

### Haskell

```haskell
-- The constraint `Ord a` before the => means "for any type a that is Ord"
maxOf :: Ord a => a -> a -> a
maxOf a b = if a >= b then a else b

-- maxOf 3 7        => 7
-- maxOf "pear" "apple" => "pear"
```

Haskell writes the constraint as `Ord a =>`. Without `Ord a`, the `>=` would be a type error: `a` would be fully unbounded and ordering wouldn't be in scope.

### Side-by-side: unbounded vs bounded (Java)

```java
static <T> int countNonNull(T a, T b) {       // fine: only moves/compares-to-null
    int n = 0;
    if (a != null) n++;
    if (b != null) n++;
    return n;
}
```

```java
static <T extends Comparable<T>> boolean inOrder(T a, T b) {  // needs the bound
    return a.compareTo(b) <= 0;
}
```

The first is happy unbounded because `!= null` is allowed on any reference. The second *requires* the bound because `compareTo` is not.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Expressiveness** | Lets generic code actually *use* its type — compare, add, print, clone. | Each new capability you need is another bound to add and maintain. |
| **Type safety** | The call-site check guarantees no missing-operation errors at runtime. No casts, no `ClassCastException`. | More verbose declarations (`<T extends Comparable<T>>` is a mouthful). |
| **Reuse** | One `max`, one sorting routine, works for every ordered type forever. | Over-tight bounds reject types that would have worked, hurting reuse. |
| **Readability** | The bound documents *exactly* what the function needs from `T`. | The recursive/self-referential bounds (later) get genuinely hard to read. |
| **Performance** | Often compiles to direct calls or even monomorphized code (no runtime lookup). | Subtype-bound languages may box / use virtual dispatch (a small cost). |

---

## Use Cases

Reach for a bound whenever generic code must **do something specific** with its type, not just move it:

- **Finding a max/min, sorting, binary search** — needs ordering (`Comparable` / `Ord` / `Comparable`).
- **Summing / averaging a generic collection** — needs arithmetic (`Number`, `Add`, `Num`).
- **Deduplicating, using as a map/set key** — needs equality and/or hashing (`Eq`/`Hash`, `equals`/`hashCode`).
- **Generic serialization / formatting** — needs "can be displayed / encoded" (`Display`, `toString`, `Codable`).
- **Cloning generic data** — needs a copy capability (`Clone`, `Cloneable`).
- **A generic "render" / "process" pipeline** — needs a domain interface like `Drawable`, `Validatable`, `Serializable`.

If a function genuinely only *stores and returns* the value — an identity function, a generic stack's `push`/`pop`, a swap — leave it unbounded. Adding a bound you don't use is needless coupling.

---

## Coding Patterns

### Pattern 1: Bound by exactly the interface you call — and no more

```rust
// You only need to *print* it, so bound by Display, not Ord/Clone/etc.
fn announce<T: std::fmt::Display>(x: T) {
    println!("Here is: {}", x);
}
```

Don't over-constrain. If you only print `T`, don't require `Ord`. The minimal bound maximizes reuse.

### Pattern 2: Combine bounds when you need more than one capability

```rust
fn max_and_print<T: Ord + std::fmt::Display>(a: T, b: T) {
    let m = if a >= b { a } else { b };
    println!("max is {}", m);
}
```
```java
static <T extends Comparable<T>> void show(T a, T b) { ... } // single bound here
```

`T: Ord + Display` (Rust) or `<T extends A & B>` (Java) requires *both* capabilities. (Multiple bounds get a fuller treatment in `middle.md`.)

### Pattern 3: Propagate the bound up the call chain

```java
static <T extends Comparable<T>> T maxOf(List<T> xs) {  // must repeat the bound
    T best = xs.get(0);
    for (T x : xs.subList(1, xs.size()))
        if (x.compareTo(best) > 0) best = x;
    return best;
}
```

If the body uses ordering, the signature must promise ordering. The bound isn't optional decoration.

### Pattern 4: Let the standard library's bound do the work

```go
import "slices"
// slices.Max requires cmp.Ordered internally — you just supply an ordered type
m := slices.Max([]int{3, 1, 4, 1, 5})  // 5
```

Most standard libraries already wrap the common bounds (`sort`, `max`, `min`). Use them before writing your own bounded helper.

---

## Best Practices

- **Bound by the smallest interface that compiles.** If `Comparable` is enough, don't require your own bigger interface. Smaller bounds accept more types.
- **Let the use site of the capability drive the bound.** Add a bound *because* the body calls a method, not "just in case."
- **Repeat bounds up the call chain honestly.** When the compiler says a bound isn't satisfied, the fix is usually to add the same bound to the calling function, not to cast or suppress.
- **Prefer standard bounds (`Comparable`, `Ord`, `Eq`, `Hash`, `Number`) over hand-rolled interfaces** when a standard one fits — they're already implemented by built-in types.
- **Name the capability, not the type, in your head:** "this needs *ordering*," "this needs *equality*." That tells you which bound to reach for.
- **Don't bound an identity/move-only function.** If you only store and return `T`, unbounded is correct and maximally reusable.
- **Read the bound aloud as "any type that can …".** `<T extends Comparable<T>>` = "any type that can be compared to itself." It demystifies the syntax.

---

## Edge Cases & Pitfalls

- **"Why can't I call `.toString()` / `<` / `.equals()` on `T`?"** Because `T` is unbounded. The fix is a bound (or, for `equals`/`toString` in Java specifically, note those exist on `Object` so they *are* callable — but a *meaningful, type-specific* comparison still needs `Comparable`).
- **Over-constraining.** Requiring `<T extends Comparable<T>>` on a function that never compares anything needlessly rejects valid types. The compiler won't warn you — your *callers* will, when their type is refused.
- **Forgetting to propagate the bound.** Calling a bounded helper from an unbounded function fails to compile with a "bound not satisfied" error. Add the bound to the outer signature.
- **Confusing the bound with a cast.** A bound is checked at compile time and never throws. If you instead cast `T` to `Comparable` at runtime, you've thrown away the safety and invited a `ClassCastException`.
- **Java's `Comparable<T>` is recursive.** `T extends Comparable<T>` mentions `T` *inside* its own bound. This "self-referential" shape is normal but looks alien at first; it just means "comparable *to its own type*." The full story (F-bounded polymorphism) is in `middle.md`/`senior.md`.
- **`Object` is not `Comparable`.** `max(new Object(), new Object())` won't compile. Many beginners expect "everything is comparable" — it isn't.
- **Operators vs methods.** In Java/C# you call a *method* (`compareTo`), in Rust/Swift/Haskell/Go you use an *operator* (`>=`, `>`). Both are "use the bound's capability"; only the surface syntax differs.
- **A bound on the type ≠ a bound on its elements.** Bounding `T` says nothing about a `List<T>`'s other operations. Each capability you need is its own bound.

---

## Test Yourself

1. Write the smallest generic function you can that *does not* compile when `T` is unbounded but *does* compile after adding `extends Comparable<T>` / `: Ord`. What single line forced the bound?
2. In your favorite language, write `min` (the mirror of `max`). Which bound did it need? Was it the same one as `max`?
3. Take an unbounded `static <T> T identity(T x) { return x; }`. Add `extends Comparable<T>`. Does it still compile? Does anything *break*? What did you gain or lose?
4. Explain, in one sentence, why `bigger(new Thread(), new Thread())` fails to compile even though `bigger(3, 7)` works.
5. You have `maxOf(List<T>)` that calls `max(T, T)`. You forgot the bound on `maxOf`. What error do you get, and what's the fix?
6. Why is it *more* reusable to bound a print helper by `Display`/`toString`-style interface than by `Comparable`? Give a concrete type that the `Comparable` bound would wrongly reject.
7. Read `<T extends Comparable<T>>` aloud as an English sentence. Now do the same for `T: Ord` and `Ord a =>`. Are you saying the same thing?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    BOUNDED POLYMORPHISM (Junior)                  │
├──────────────────────────────────────────────────────────────────┤
│  Unbounded <T>      : can store / pass / return T. Nothing else.  │
│  Bounded   <T: Bnd> : ALSO can use everything Bnd provides.       │
├──────────────────────────────────────────────────────────────────┤
│  The trade:  fewer accepted types  <->  more capabilities         │
├──────────────────────────────────────────────────────────────────┤
│  "any type that can be ORDERED":                                  │
│    Java     <T extends Comparable<T>>                             │
│    C#       where T : IComparable<T>                             │
│    Swift    <T: Comparable>                                       │
│    Rust     T: Ord                                                │
│    Go       [T cmp.Ordered]                                       │
│    Haskell  Ord a =>                                              │
├──────────────────────────────────────────────────────────────────┤
│  Upper bound = "T must implement / be a subtype of this".         │
│  The common, default kind of bound.                              │
├──────────────────────────────────────────────────────────────────┤
│  Rules of thumb:                                                  │
│    * bound = permission slip; you get EXACTLY its methods         │
│    * checked at the CALL SITE — no casts, no runtime failure      │
│    * propagate the bound to every function that uses the helper   │
│    * bound by the smallest interface that compiles                │
│    * don't bound a move-only / identity function                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Unbounded** generic code (`<T>`, `T any`) can only **move** values around — store, pass, return. It can call nothing on the type, because it must work for *every* type. This restriction is called *parametricity*.
- **Bounded** polymorphism adds a **constraint** (`extends Comparable<T>`, `: Ord`, `where T : IComparable<T>`, `<T: Comparable>`, `Ord a =>`) that narrows which types qualify and, in exchange, lets the body **use** that type's capabilities.
- The core trade in one line: **a bound shrinks who can call you so it can grow what you can do.**
- **Upper bounds** ("`T` must implement this interface") are the common, default kind and all you need at this level.
- The bound is a **contract checked at the call site** — supply a type that satisfies it, get the capability inside, with zero runtime casts or failures.
- Bounds **propagate**: a function calling a bounded helper must declare the same bound.
- The canonical example is a generic **`max`/`min`**, which needs an *ordering* bound; summing needs *arithmetic*; map keys need *equality/hashing*.
- Bound by the **smallest** interface that compiles, and don't bound functions that only move values.

---

## What You Can Build

- **A generic `max`/`min`/`clamp` library** across the languages you know, each using that language's ordering bound. Try feeding it a non-comparable type and read the error.
- **A `topThree(list)`** that returns the three largest elements of any ordered type. Notice you must propagate the ordering bound.
- **A "two versions" demo:** the same function unbounded (won't compile) and bounded (compiles), with a comment on the exact line that forced the bound. Great for explaining generics to a teammate.
- **A bounded `prettyPrint(item)`** constrained by a "displayable" interface (`Display`, `toString`, `Codable`). Test that it rejects a type that has no display capability.
- **A tiny `dedup(list)`** for any type with equality, showing why the *equality* bound (not the *ordering* bound) is the right one here.

---

## Further Reading

- *Programming Languages: Application and Interpretation* — Shriram Krishnamurthi. Clear treatment of parametric polymorphism and where bounds come in.
- *The Rust Book* — Chapter 10 ("Generic Types, Traits, and Lifetimes"). The most beginner-friendly explanation of trait bounds. https://doc.rust-lang.org/book/ch10-00-generics.html
- *Effective Java* — Joshua Bloch. Items on generics explain `<T extends Comparable<T>>` and bounded wildcards in practical terms.
- *The Swift Programming Language* — "Generics" chapter, on protocol constraints. https://docs.swift.org/swift-book/
- *Learn You a Haskell for Great Good!* — the "Typeclasses 101" chapter introduces `Ord`, `Eq`, `Num` constraints gently.
- *Go by Example: Generics* — a short, hands-on look at type constraints. https://gobyexample.com/generics
- *Types and Programming Languages* — Benjamin Pierce. The rigorous source on parametric polymorphism (Chapter 23); save it for after the middle/senior pages.
