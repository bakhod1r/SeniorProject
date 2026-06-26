# What Is a Type — Junior Level

> **Topic:** [What Is a Type](README.md)
> **Focus:** What a type actually *is* — a set of values plus the operations you're allowed to do with them — and why naming that set is the cheapest bug-prevention tool you'll ever use.

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
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [What You Can Build](#what-you-can-build)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does it mean for a value to "have a type"?** And **why does writing the type down stop bugs before the program ever runs?**

Every value in a program — the number `42`, the text `"hello"`, the truth value `true`, a list `[1, 2, 3]` — belongs to a **type**. The simplest, most useful definition a junior can carry around is this:

> A **type is a set of values, together with the operations that are valid on those values.**

`int` is the set of whole numbers your machine can represent, plus operations like `+`, `-`, `*`, `<`. `bool` is the two-element set `{true, false}`, plus `&&`, `||`, `!`. `string` is the set of all finite text values, plus `length`, concatenation, slicing. The type tells you two things at once: **which values are legal**, and **what you're allowed to do with them**. You can add two `int`s. You cannot meaningfully add a `bool` to a `string` — and a type system is the thing that catches you when you try.

This is the highest-leverage idea in this entire topic: a type is a **promise** about a value. When a function says it returns a `User`, it promises you'll get a `User` and not a `null`, not a number, not an error string. When a parameter says it takes a `PositiveInt`, it promises the function never has to handle zero or negatives. Types let you say, *out loud and in code*, "this value is one of these and never any other," and a compiler or interpreter holds you to it.

> 🎓 **Why this matters for a junior:** Most bugs you write in your first year are **type confusions** in disguise — passing a user ID where a username was expected, treating a string `"42"` as if it were the number `42`, calling a method on something that turned out to be `null`. A type system is a robot reviewer that catches a huge fraction of these *before you even run the code*. Learning to think in types is learning to make those mistakes impossible instead of merely unlikely.

This page covers: what a type is (a set of values + operations), what a type system *does* for you (prevents whole classes of errors, documents intent, powers your editor's autocomplete), the difference between a value's type being known at **compile time** versus checked at **run time**, primitive types versus composite types, and the same ideas shown across Python, Java, TypeScript, Go, and Rust. Deeper levels go into the formal lenses (types as sets, types as propositions), static vs dynamic typing in detail, and how types connect to memory layout.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program with variables and functions in at least one language (Python, Java, JavaScript/TypeScript, Go, or Rust).
- **Required:** What a variable is and what "assigning a value to it" means.
- **Required:** Calling a function and passing arguments.
- **Helpful but not required:** A vague sense that `5` and `"5"` are different things even though they look similar.
- **Helpful but not required:** Having seen at least one error message complaining about a type (`TypeError`, `cannot convert`, `expected X got Y`).

You do **not** need to know:

- The difference between static and dynamic typing in detail (the next level goes deep on this).
- Anything formal: set theory, the Curry–Howard correspondence, kinds. Those are senior topics, introduced gently later.
- How a compiler actually checks types internally.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A set of values together with the operations valid on those values. `int`, `string`, `bool`, `User`. |
| **Value** | A concrete piece of data: `42`, `"hi"`, `true`, an object, a list. Every value has a type. |
| **Type checking** | The process of verifying that operations are applied to compatible types — e.g. that you don't add a number to a function. |
| **Type error** | A mistake the type system catches: applying an operation to a value whose type doesn't support it. |
| **Primitive type** | A built-in, indivisible type: `int`, `float`, `bool`, `char`, `byte`. |
| **Composite type** | A type built from other types: arrays, lists, structs/records, maps, tuples. |
| **Static type** | The type known at **compile time**, attached to a variable or expression by the compiler. |
| **Dynamic type** | The actual type of the **value** at **run time**, carried as a runtime tag. |
| **Compile time** | When the program is being translated/checked, *before* it runs. |
| **Run time** | When the program is actually executing. |
| **Type annotation** | An explicit written type, like `x: int` or `String name`. |
| **Type inference** | The compiler figuring out a type you didn't write down. |
| **Contract** | The promise a type makes: "any value of this type supports these operations and obeys these rules." |
| **Type safety** | The guarantee that operations are never applied to the wrong kind of value. |
| **Strongly/weakly typed** | Vague terms for how strictly a language enforces type rules. Use with care (covered below). |

---

## Core Concepts

### 1. A Type Is a Set of Values + Operations

Take `bool`. Its **set of values** is exactly `{true, false}` — nothing else is a `bool`. Its **operations** are `&&`, `||`, `!`, equality. Take `byte` (unsigned). Its set is `{0, 1, 2, ..., 255}`. Its operations are arithmetic and comparison. The pattern repeats for every type:

| Type | The set of values | Some valid operations |
|------|-------------------|----------------------|
| `bool` | `{true, false}` | `&&`, `||`, `!`, `==` |
| `byte` | `{0 ... 255}` | `+`, `-`, `&`, `<` |
| `int` | machine integers | `+`, `-`, `*`, `/`, `<`, `==` |
| `string` | all finite text | concat, `length`, slice, `==` |
| `Point{x,y}` | all `(x, y)` pairs | `.x`, `.y`, distance, `==` |

When you ask "what is the type of this value?", you're really asking "**which set does it belong to, and what am I allowed to do with it?**" The two halves matter equally. A type that listed values but not operations would be useless — you'd know what you have but not what you can do. A type that listed operations but not values would be incoherent — operations need something to operate on.

### 2. Types Classify Values

Another way to see it: a type is a **label that sorts values into bins**. Every value carries (or can be assigned) a label that says which bin it lives in. The number `42` is in the `int` bin. `"42"` is in the `string` bin. They *look* alike on paper but live in different bins, and the operations differ: `42 + 1` is `43`, but `"42" + 1` is either an error or `"421"` depending on the language. The type — the bin — is what decides.

Classification is the foundation of everything else. Once values are sorted into bins, the type system can enforce a single, simple rule: **only apply an operation to values in a bin that supports it.** That one rule prevents an enormous range of bugs.

### 3. A Type Is a Contract / a Promise

This is the framing that will serve you best in real code. When you write:

```
func sendEmail(to EmailAddress, subject string) error
```

every type here is a **contract**:

- `to EmailAddress` promises: *this is a valid email address* — not just any string, but one that passed whatever check makes an `EmailAddress`. The function doesn't have to re-validate.
- `subject string` promises: *this is text*.
- returns `error` promises: *the caller will get back something that says whether it worked*.

The types document the function's expectations and guarantees **in a way the compiler enforces**. Comments lie; types don't. If you try to call `sendEmail("not-an-email", 5)`, the type system stops you. A type is a promise that someone (the compiler, or the runtime) actually keeps for you.

### 4. Compile Time vs Run Time (Set-Up)

There are two different moments a type can matter:

- **At compile time**, the *variable or expression* has a **static type** — what the compiler thinks it is. In `int x = 5;`, the static type of `x` is `int`, decided before the program runs.
- **At run time**, the *value* has a **dynamic type** — its actual runtime tag. In a dynamically typed language, `x = 5` makes `x` hold a value whose runtime type is `int`; later `x = "hi"` makes it hold a value whose runtime type is `string`.

Some languages check types at compile time (Java, Go, Rust, TypeScript). Some check at run time (Python, JavaScript, Ruby). The next level (the middle file) is entirely about this static-vs-dynamic distinction. For now, hold onto the idea: **the static type is attached to the name; the dynamic type is attached to the value.**

### 5. Primitive vs Composite Types

- **Primitive types** are the indivisible building blocks: `int`, `float`, `bool`, `char`, `byte`. They come built into the language.
- **Composite (compound) types** are built by combining other types:
  - A **list/array** `[]int` is "many `int`s in order."
  - A **struct/record** `Point{x int, y int}` is "an `int` *and* an `int`, with names."
  - A **map/dictionary** `map[string]int` is "a lookup from `string` to `int`."
  - A **tuple** `(int, string)` is "an `int` *and* a `string`, by position."

You build big types out of small ones. Almost every type you'll define yourself — a `User`, an `Order`, a `Tree` — is composite, assembled from primitives and other composites.

### 6. What a Type System *Does* For You

A type system isn't just bookkeeping. It buys you four concrete things:

1. **It prevents whole classes of errors.** You cannot call a string method on a number, cannot pass two arguments in the wrong order if their types differ, cannot forget a field a struct requires. These bugs become *impossible to write*, not merely caught later.
2. **It documents intent.** Reading `func price(item Product) Money` tells you more than any comment. The signature *is* the documentation, and it can't go stale.
3. **It powers your tools.** Autocomplete, "go to definition," refactoring, inline error squiggles — all of it runs on type information. When your editor knows `user` is a `User`, it can offer you `.name` and `.email`.
4. **It enables fast code.** Knowing a value is an `int` lets the compiler pick the right machine instructions and lay out memory tightly (more on this in deeper levels).

### 7. "Make Illegal States Unrepresentable"

The most powerful idea you'll take from thinking in types: **design your types so that bad states can't even be expressed.** If an order can be `Pending`, `Shipped`, or `Cancelled`, don't model it as three booleans (`isPending`, `isShipped`, `isCancelled`) — that allows nonsense like "pending *and* shipped at once." Model it as a single type with exactly three possibilities. Now the impossible state literally cannot be constructed. The type does the work that validation code, tests, and code review would otherwise have to do — and it does it for free, forever.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Type** | A category of object, like "screw" or "bolt." Knowing the category tells you what fits and what you can do with it. |
| **Set of values** | All the individual screws of that kind in the world. |
| **Valid operations** | "You can screw it into a threaded hole." (You can't hammer it like a nail and expect it to work.) |
| **Type error** | Trying to fit a metric bolt into an imperial nut — they don't match, and a good shop catches it before assembly. |
| **Type as contract** | A power socket shape. A plug labeled "Type C" promises it fits a Type C socket. The shape *is* the guarantee. |
| **Static type** | The label printed on the box: "contains: 4mm screws." Known before you open it. |
| **Dynamic type** | What's actually inside when you open it at use-time. |
| **Primitive type** | A raw material: a single screw, a single nail. |
| **Composite type** | An assembled part: a hinge made of screws, a plate, and a pin. |
| **Make illegal states unrepresentable** | A USB plug that only goes in the right way (eventually) — the shape forbids the wrong connection. |
| **Type system** | The quality inspector who checks every part fits before the product ships. |

The socket-and-plug analogy is worth keeping. Electrical standards exist so that a "Type G" plug *cannot* be jammed into a "Type A" socket — the physical shape is a type, and the mismatch is caught by geometry, not by trusting the person. A type system does exactly this for data.

---

## Mental Models

### The Bins Model

Imagine every value in your program being dropped into a labeled bin: the `int` bin, the `string` bin, the `User` bin. The type *is* the bin's label. Operations are tools that only work on specific bins — the "add" tool works on the `int` bin, the "uppercase" tool works on the `string` bin. The type system is the rule "you may only use a tool on a bin it's built for." When you reach into the `string` bin with the "add 1" tool, the system stops your hand.

### The Promise Model

Every type annotation is a promise written into the code. `name: string` promises *I will only ever hold text here.* `getUser(): User` promises *I will hand you back a User.* A statically typed language checks all these promises before running. A dynamically typed language trusts you and only complains at run time if a promise turns out false. Either way, **the type is the promise**, and bugs are broken promises.

### The "Cheapest Test" Model

Think of a type as a tiny test that runs everywhere, for free, forever. A unit test checks one example. A type checks *every possible value* at *every call site* — and it's already written the moment you declare the type. `n: PositiveInt` is, in effect, a test that runs at every place a `PositiveInt` is used, asserting "this is positive," without you writing a single assertion. When senior engineers say "make illegal states unrepresentable," they mean: push as much checking as you can into types, because types are the cheapest tests you'll ever have.

---

## Code Examples

We'll show the same handful of ideas across languages: that values have types, that operations are type-restricted, and that mismatches get caught (some at compile time, some at run time).

### Python — types exist even without annotations

```python
x = 42          # value 42 has dynamic type int
y = "42"        # value "42" has dynamic type str

print(type(x))  # <class 'int'>
print(type(y))  # <class 'str'>

print(x + 1)    # 43   — '+' on int means addition
print(y + "!")  # 42!  — '+' on str means concatenation

print(x + y)    # TypeError: unsupported operand type(s) for +: 'int' and 'str'
```

Python doesn't make you *write* the types, but every value still *has* one (its dynamic type), and `+` does completely different things depending on it. The last line is a **type error** — caught at run time, the moment the bad operation executes. The type `int` is a set (whole numbers) with operations (`+` = addition); the type `str` is a set (text) with operations (`+` = concatenation). Same symbol, different operation, because different type.

### Python with type hints — writing the promise down

```python
def average(numbers: list[float]) -> float:
    return sum(numbers) / len(numbers)
```

`numbers: list[float]` is an **annotation**: the promise "this is a list of floats." `-> float` promises a float comes back. Python itself doesn't enforce these at run time, but a type checker like `mypy` reads them and flags mistakes *before* you run — turning a runtime crash into a compile-time warning.

### Java — types checked before the program runs

```java
int x = 42;
String y = "42";

System.out.println(x + 1);   // 43
System.out.println(y + "!"); // 42!

// int z = x + y;            // COMPILE ERROR: bad operand types
String w = x + y;            // "42" + 42 -> "4242" (Java converts here)
```

In Java the type is **part of the variable**. `int x` means *x is forever an int*. The commented line doesn't even compile — the type checker rejects it before any code runs. (Note Java's `+` quietly converts `x` to a string in the last line; that's a language choice, not a universal rule.)

### TypeScript — types layered on top of JavaScript

```typescript
function greet(name: string): string {
  return "Hello, " + name;
}

greet("Ada");   // ok
greet(42);      // COMPILE ERROR: Argument of type 'number'
                //                is not assignable to parameter of type 'string'
```

TypeScript adds a static type layer over dynamically typed JavaScript. The `: string` annotation is a contract the TypeScript compiler enforces. After compilation the types are **erased** — the JavaScript that runs has no types left. The checking happened entirely before run time.

### Go — types as documented contracts

```go
type EmailAddress string

func send(to EmailAddress, subject string) {
    // ...
}

func main() {
    var addr EmailAddress = "ada@example.com"
    send(addr, "Hi")        // ok
    // send("plain", "Hi")  // ok-ish: untyped string literal converts
    // send(5, "Hi")        // COMPILE ERROR: cannot use 5 as EmailAddress
}
```

Here `EmailAddress` is a *distinct type* even though it's "just a string" underneath. Giving it its own name turns a bag of characters into a contract: a function taking `EmailAddress` documents that it expects an address, and the compiler tracks the distinction.

### Rust — types you can't lie about

```rust
fn main() {
    let x: i32 = 42;
    let y: &str = "42";

    println!("{}", x + 1);   // 43

    // let z = x + y;        // COMPILE ERROR: cannot add `&str` to `i32`
    let n: i32 = y.parse().unwrap(); // explicit conversion str -> i32
    println!("{}", x + n);   // 84
}
```

Rust never silently converts between types. To turn the string `"42"` into the number `42`, you must *explicitly* `parse()` it. The type system forces every conversion to be deliberate, which removes a whole category of "I didn't realize that was a string" bugs.

### Modeling a state — making illegal states unrepresentable

```typescript
// BAD: three booleans allow impossible combinations
type OrderBad = {
  isPending: boolean;
  isShipped: boolean;
  isCancelled: boolean;
}; // pending AND shipped AND cancelled all true? nonsense, but allowed

// GOOD: one type, exactly three legal states
type Order =
  | { status: "pending" }
  | { status: "shipped"; trackingId: string }
  | { status: "cancelled"; reason: string };
```

The `Order` type makes the impossible *unrepresentable*: there's no way to construct an order that is both shipped and cancelled, and "shipped" *requires* a `trackingId` while "cancelled" *requires* a `reason`. The type encodes the rules, so no validation code or test is needed to enforce them.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Bug prevention** | Whole classes of errors become impossible to write. Catches mismatches early. | Can't catch *logic* bugs — a wrong-but-well-typed program still compiles. |
| **Documentation** | Signatures document intent and never go stale. | Verbose annotations can clutter simple code. |
| **Tooling** | Powers autocomplete, refactoring, navigation. | Tooling quality varies by language. |
| **Performance** | Lets the compiler pick efficient representations. | (For dynamic languages) runtime type tags cost memory and time. |
| **Refactoring** | Change a type and the checker shows every place that must update. | Big type changes can ripple widely. |
| **Learning curve** | Types teach you to think about your data precisely. | Strict type systems (Rust, Haskell) have a real learning cost up front. |
| **Flexibility** | Strong contracts make large codebases manageable. | Sometimes you genuinely don't know the type yet; strictness can slow prototyping. |

---

## Use Cases

Thinking carefully about types pays off most when:

- **You're modeling a domain.** Users, orders, money, dates — give each its own type instead of passing raw strings and ints around. The types become the spec.
- **You're writing a function others will call.** Precise parameter and return types are the cheapest, truest documentation.
- **You're working in a large or long-lived codebase.** Types are what let you refactor with confidence; the checker finds everything you broke.
- **Correctness matters more than speed of first draft.** Payments, auth, anything where a wrong value is expensive.
- **You want your editor to help you.** Good types unlock autocomplete and navigation across the whole codebase.

Lighter typing (or just primitives) is fine when:

- You're writing a quick throwaway script.
- You're exploring and don't yet know the shape of your data.
- The whole program fits on a screen and lives for an afternoon.

---

## Coding Patterns

### Pattern 1: Name your domain types instead of using primitives

```go
type UserID string     // not just "string"
type Cents int         // money in cents, not a bare int
```

This "type alias for meaning" pattern (sometimes called *making the implicit explicit*) prevents mixing up a `UserID` with a `ProductID` even though both are strings underneath. The compiler now treats them as different.

### Pattern 2: Let the type narrow the valid set

```python
from enum import Enum

class Color(Enum):
    RED = "red"
    GREEN = "green"
    BLUE = "blue"
```

Instead of accepting any `str` for a color (where typos like `"gren"` slip through), an enum restricts the set of legal values to exactly three. The type *is* the validation.

### Pattern 3: Use composite types to group related data

```go
type Point struct {
    X int
    Y int
}
```

Rather than passing `x` and `y` as two separate ints everywhere (and risking swapping them), bundle them into one type. The struct is the unit you pass around.

### Pattern 4: Push checks into the type, not into runtime guards

Prefer `func setAge(a PositiveInt)` over `func setAge(a int)` with a runtime `if a < 0 { panic }`. If you can express the constraint as a type, the check happens everywhere automatically, and the impossible case never reaches your function.

---

## Best Practices

- **Give meaningful things their own types.** A `UserID` is not "just a string." Naming the type prevents whole categories of mix-ups.
- **Write annotations on public boundaries.** Even in dynamically typed languages, annotate function signatures — they're documentation that tools can check.
- **Prefer the narrowest type that works.** If a function only needs to *read* a list, take a read-only type. If a value can only be one of three things, use an enum, not a string.
- **Let inference handle the obvious; annotate the meaningful.** `x := 5` doesn't need `x int` — it's obvious. A function's return type usually *should* be written, because it's a contract.
- **Make illegal states unrepresentable.** Design types so bad combinations can't be constructed. This is the single highest-value habit in this whole topic.
- **Treat type errors as a gift.** A compile error is the type system catching a bug for free. Don't paper over it with a cast — understand why it fired.
- **Don't fight the type system with escape hatches.** `any`, `Object`, unchecked casts, and `# type: ignore` throw away the very protection you wanted.

---

## Edge Cases & Pitfalls

- **`"5"` is not `5`.** The string `"5"` and the integer `5` are different types in different bins. Mixing them is the single most common beginner bug. Always know whether you're holding text or a number.
- **`null`/`None`/`nil` sneaks past types in many languages.** A variable typed `User` can secretly be `null` in Java, Go, and others — and then `user.name` crashes. Languages like Rust and Kotlin make nullability part of the type so this can't happen silently.
- **Silent conversions hide bugs.** JavaScript's `[] + {}`, Java's `int + String`, and similar implicit conversions can produce surprising results. Know your language's conversion rules.
- **A type annotation in Python is not enforced at run time.** `def f(x: int)` will happily run with a string unless you use a checker like `mypy`. The annotation is a promise *you* must verify with tooling.
- **Two types with the same underlying representation are still different.** A `UserID` and a `ProductID` that are both strings are *not* interchangeable if you declared them as distinct types — and that's the point.
- **Casting lies to the type system.** When you force a value to a type with a cast, you're overriding the checker's judgment. If you're wrong, the bug just moves to run time.

---

## Common Mistakes

1. **Treating types as a formality to satisfy the compiler** instead of a design tool. The point isn't to make errors go away; it's to model your data correctly.
2. **Using `string` for everything.** Dates, money, IDs, and enums all become indistinguishable bags of characters — and bugs slip through. Give them real types.
3. **Reaching for `any`/`Object`/`interface{}` to silence an error.** This discards the type information and pushes the bug to run time.
4. **Confusing the variable's static type with the value's runtime type.** A variable declared `Animal` may hold a `Dog` at run time; the two are different questions.
5. **Assuming a Python annotation prevents bad input.** It doesn't run anything — you need `mypy` or runtime validation.
6. **Casting to make an error disappear** without checking whether the cast is actually valid.
7. **Modeling states with multiple booleans** instead of one type with the legal states, allowing impossible combinations.

---

## Test Yourself

1. Define "type" in one sentence using the words *set* and *operations*.
2. `42` and `"42"` — give the type of each, and explain why `42 + "1"` behaves differently than `42 + 1`.
3. What's the difference between a value's type and a variable's type? Give an example where they differ.
4. Name three things a type system does *for* you beyond catching errors.
5. Why is `func charge(amount Cents)` better than `func charge(amount int)`?
6. Rewrite an "order" modeled as `isPending`, `isShipped`, `isCancelled` (three booleans) so that impossible states can't be represented.
7. In Python, does `def f(x: int)` stop you from calling `f("hi")` at run time? What tool would catch it?
8. Give an example of a primitive type and a composite type, and explain what makes them different.

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────┐
│                        WHAT IS A TYPE                          │
├────────────────────────────────────────────────────────────────┤
│  A TYPE = a SET of values + the OPERATIONS valid on them       │
│                                                                │
│    bool   = {true, false}   + && || ! ==                       │
│    byte   = {0 .. 255}      + + - & <                          │
│    int    = machine ints    + + - * / < ==                     │
│    string = all text        + concat, length, slice           │
├────────────────────────────────────────────────────────────────┤
│  Four views of the same idea:                                  │
│    1. set of values + operations   (pragmatic)                 │
│    2. a label that classifies values into bins                 │
│    3. a contract / promise about a value                       │
│    4. the cheapest test you ever write                         │
├────────────────────────────────────────────────────────────────┤
│  A type system DOES:                                           │
│    * prevents whole classes of errors                          │
│    * documents intent (signatures never lie)                   │
│    * powers autocomplete / refactor / navigation               │
│    * enables efficient compiled code                           │
├────────────────────────────────────────────────────────────────┤
│  static type = attached to the NAME, known at compile time     │
│  dynamic type = attached to the VALUE, the runtime tag         │
├────────────────────────────────────────────────────────────────┤
│  Primitive: int, float, bool, char, byte                       │
│  Composite: list, struct, map, tuple  (built from others)      │
├────────────────────────────────────────────────────────────────┤
│  Golden rule: MAKE ILLEGAL STATES UNREPRESENTABLE              │
└────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **type is a set of values together with the operations valid on those values.** That one definition carries you a long way.
- The same idea has several faces: types **classify** values into bins, types are **contracts/promises** about values, and types are the **cheapest tests** you can write.
- Every value has a type — even in languages where you don't write it down. `42` is an `int`; `"42"` is a `string`; they live in different bins and support different operations.
- A type can be known at **compile time** (the static type, attached to a name) or carried at **run time** (the dynamic type, the value's tag). The next level explores this split in depth.
- A **type system** prevents whole classes of errors, documents intent, powers your editor's tooling, and enables fast compiled code.
- **Primitive** types (`int`, `bool`, `char`) are the building blocks; **composite** types (lists, structs, maps) are assembled from them.
- The most valuable habit you can build: **make illegal states unrepresentable** — design types so that bad values simply cannot be constructed.
- Common traps: confusing `"5"` with `5`, letting `null` slip past a type, over-using `string`/`any`, and assuming Python annotations are enforced (they need a checker).
- A junior's #1 mindset shift: stop seeing types as red tape to satisfy the compiler, and start seeing them as the tool that makes bugs *impossible* instead of merely unlikely.

---

## What You Can Build

- **A "guess the type" quiz.** Print a series of values (`42`, `"42"`, `[1,2]`, `true`, `3.14`) and have a friend name the type and one valid operation for each.
- **A typed domain model.** Take a small app idea (a to-do list, a contacts book) and define every entity with its own types — `TaskID`, `DueDate`, `Priority` enum — instead of raw strings and ints.
- **A "make illegal states unrepresentable" refactor.** Find some code that uses multiple booleans for one concept and rewrite it as a single type with explicit states.
- **A type-error gallery.** Deliberately write the same type error (adding a string to a number) in Python, Java, TypeScript, Go, and Rust, and compare *when* each catches it (run time vs compile time) and what the message says.
- **A tiny validator-by-type.** Define a `PositiveInt` type (or wrapper) that can only be constructed from a positive number, and use it to remove runtime `if x < 0` checks from a small program.

---

## Further Reading

- *Types and Programming Languages* — Benjamin C. Pierce. The standard introduction; chapter 1 motivates "what a type is" beautifully.
- *Programming with Types* — Vlad Riscutia. A practical, language-agnostic tour for working developers.
- *Thinking with Types* (intro chapters) — Sandy Maguire. Approachable framing of types as a design tool.
- *The TypeScript Handbook* — https://www.typescriptlang.org/docs/handbook/ — excellent on "types as a layer over values."
- *mypy documentation* — https://mypy.readthedocs.io/ — how optional static typing works in Python.
- *The Rust Book*, chapters 3 and 6 — https://doc.rust-lang.org/book/ — types, and enums for modeling states.
- "Make Illegal States Unrepresentable" — Scott Wlaschin (F# for Fun and Profit). The clearest essay on the idea. https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/
- *Effective Java* — Joshua Bloch. Many items are really about using types to make APIs hard to misuse.
