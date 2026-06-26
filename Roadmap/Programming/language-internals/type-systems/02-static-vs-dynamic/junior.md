# Static vs Dynamic Typing — Junior Level

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** When are types checked — before the program runs, or while it runs? And what does each choice catch, miss, and cost you?

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

---

## Introduction

> Focus: **What does it mean for a type to be checked "at compile time" versus "at run time"?** And **why does that single decision shape everything from how fast you write code to where your bugs show up?**

Every value your program touches has a **type**: `42` is an integer, `"hello"` is a string, `[1, 2, 3]` is a list. A type is a promise about what a value *is* and therefore what you can *do* with it. You can add two integers. You can uppercase a string. You cannot uppercase an integer — and if you try, something has to notice.

The whole static-vs-dynamic debate comes down to **when "something notices"**:

- In a **statically typed** language (Java, Go, Rust, TypeScript, Haskell, C#), the compiler checks types **before the program ever runs**. If you write `"hello".length() + 5` where `+ 5` doesn't make sense, the build fails. You can't even produce a runnable program until the types line up.
- In a **dynamically typed** language (Python, JavaScript, Ruby, PHP, Lisp), types are checked **while the program runs**, at the moment of each operation. The same nonsensical expression compiles fine and starts running — and then *blows up* the instant it actually executes that line. If that line never runs, you never find out.

In one sentence: **static typing asks "will this ever go wrong?" before launch; dynamic typing asks "is this going wrong right now?" as it flies.**

That timing difference has consequences a junior feels immediately. Static typing catches a whole category of mistakes — typos in field names, passing a string where a number was wanted, calling a method that doesn't exist — *before you run anything*. The price is ceremony: you write more type annotations, and the compiler sometimes rejects programs that would actually have worked. Dynamic typing is terse and flexible — you just write the logic — but a typo in a rarely-taken branch can sit silently in your codebase for months and then crash in production at 2 a.m.

> 🎓 **Why this matters for a junior:** The single most common production crash you will ever cause is some flavor of `'NoneType' object has no attribute 'name'` (Python) or `undefined is not a function` (JavaScript). Those are *type errors that escaped to runtime* — exactly the errors a static type system is built to catch before you ship. Understanding which world you're in, and what it does and doesn't protect you from, is the difference between confident shipping and superstition.

This page covers: what a type is, the precise meaning of "compile time" vs "run time," the canonical type-error in both worlds (and where it shows up), the **strong vs weak** axis (which is *not* the same thing — a frequent confusion), and the same small program written in a static language and a dynamic one. The next levels go deeper: `middle.md` covers gradual typing (TypeScript, Python type hints) and duck typing; `senior.md` covers soundness, erasure vs reification, and inference; `professional.md` covers performance, the empirical bug-rate research, and large-codebase migrations.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program with variables and functions in at least one language (Python, JavaScript, Java, or Go).
- **Required:** What a variable is and what it means to call a function or method on a value.
- **Required:** The rough idea that there's a "build" or "compile" step in some languages (Java, Go) and not in others (Python, JavaScript — you just run the file).
- **Helpful but not required:** Having seen at least one error message from each world — a compiler error and a runtime exception.

You do **not** need to know:

- Type theory, lambda calculus, or the formal definition of soundness (that's `senior.md`).
- How a compiler's type checker is implemented or how inference works (later levels).
- Anything about generics, variance, or advanced type features.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A classification of a value that says what it is and what operations are valid on it. `int`, `string`, `bool`, `User`. |
| **Static typing** | Types are checked **before the program runs**, by a compiler/checker. Type errors block the build. |
| **Dynamic typing** | Types are checked **while the program runs**, at each operation. Type errors become runtime exceptions. |
| **Compile time** | The phase when source code is translated and checked, before execution. Static type checks happen here. |
| **Run time** | The phase when the program is actually executing. Dynamic type checks happen here. |
| **Type annotation** | An explicit note in source code stating a type, e.g. `int count` or `count: int`. |
| **Type error** | An operation applied to a value of the wrong type, e.g. calling `.length()` on a number. |
| **Type inference** | The compiler figuring out a type you didn't write down, e.g. Go's `x := 5` infers `int`. |
| **Strong typing** | The language resists implicit, surprising type conversions. `"5" + 5` is an error, not magic. |
| **Weak typing** | The language freely, implicitly coerces types. `"5" + 5` quietly becomes `"55"` or `10`. |
| **Duck typing** | "If it walks like a duck and quacks like a duck, treat it as a duck." Dynamic languages care about whether a value *has* a method, not what its declared type is. |
| **`null` / `None` / `nil` / `undefined`** | The "no value here" value. The source of the single most common type-related crash. |
| **Coercion** | Automatic conversion of a value from one type to another, e.g. number to string. |
| **REPL** | Read-Eval-Print Loop — an interactive prompt where you type code and see results immediately. Common in dynamic languages. |

> ⚠️ **Do not confuse two different axes.** "Static vs dynamic" is about *when types are checked*. "Strong vs weak" is about *how willing the language is to coerce between types*. They are independent. Python is **dynamic and strong**. C is **static and weak**. We'll untangle this in Core Concepts.

---

## Core Concepts

### 1. A Type Is a Promise

A type answers the question: *what can I do with this value?* If `x` is an `int`, you can add, subtract, compare. If `x` is a `string`, you can concatenate, slice, uppercase. The type is the contract. A **type error** is breaking that contract — asking a value to do something its type doesn't support, like `5.toUpperCase()`.

The interesting question is never *whether* type errors are caught. They always are, eventually — you can't actually uppercase the number 5; the machine has no instruction for it. The interesting question is **when**.

### 2. Static = Checked Before Running

In a static language, there is a separate **type-checking phase** that runs over your *entire source file* (or program) before any of it executes. The checker reads the code, works out the type of every variable and expression, and verifies every operation is legal. If anything is wrong, you get a compile error and **no runnable program is produced at all**.

```java
String s = "hello";
int n = s;          // COMPILE ERROR: incompatible types: String cannot be converted to int
```

This never runs. The build fails. You fix it and try again. The key property: **the error is found whether or not that line would ever have executed.** Static checking examines *all* the code, including the branch that only runs on February 29th.

### 3. Dynamic = Checked While Running

In a dynamic language, there is no separate type-checking phase. The program starts running, and at the moment each operation executes, the runtime checks: *does this value actually support this operation?* If yes, proceed. If no, raise an exception **right then**.

```python
s = "hello"
n = s + 5          # runs fine UP TO HERE, then: TypeError: can only concatenate str (not "int") to str
```

Two crucial properties follow:

1. **The error only appears when the line actually runs.** If `s + 5` lives inside `if user_is_admin and is_leap_year():`, you might not discover the bug for a year.
2. **Earlier code runs first.** The program does real work, possibly with side effects (writes a file, sends an email), and *then* crashes. There's no "the whole program is valid" guarantee.

### 4. Where Types Live: Variables vs Values

There's a subtle, important distinction:

- In a **static** language, the type is attached to the **variable** (or expression). `int count;` says: *this slot only ever holds integers.* The variable has a fixed type for its whole life; the type checker reasons about the slot.
- In a **dynamic** language, the type is attached to the **value**, and variables are just names that can point at anything. `count = 5` then `count = "hello"` is fine — `count` is just a label, and the *value* it points to carries the type.

This is why in Python you can write `x = 5; x = "hi"; x = [1,2,3]` with no complaint — `x` is not typed, the values are. In Java, `int x = 5; x = "hi";` is a compile error — `x` is permanently an `int`.

### 5. What Static Catches That Dynamic Doesn't (and Vice Versa)

**Static typing catches, before you run:**

- Typos in names: `usr.naem` when the field is `name`.
- Wrong argument types: passing a `string` where the function wants an `int`.
- Calling methods that don't exist on a type.
- (In some languages) forgetting to handle `null` / `None`.

**Static typing's price — it sometimes rejects valid programs.** A type checker is *conservative*: it must reject anything it can't *prove* safe. Some programs are actually correct but the checker can't see why, so it refuses them. You then either restructure the code or reach for an escape hatch (a cast). This is the trade: false alarms (rejecting good programs) in exchange for catching real ones early.

**Dynamic typing's strength** is exactly the flip side: it accepts everything and only complains about what actually goes wrong *as it goes wrong*. It never rejects a valid program for being un-provable. It's terse, flexible, and great for exploration. **Its weakness** is that a type bug on an unexercised path is invisible until that path runs — often in production.

### 6. Strong vs Weak Is a DIFFERENT Axis

This trips up almost everyone, so it gets its own section. **Static/dynamic is about *when* (compile time vs run time). Strong/weak is about *whether the language silently coerces types*.**

- **Strong typing:** the language refuses surprising implicit conversions. `"5" + 5` is an error (Python) — you must convert explicitly.
- **Weak typing:** the language happily coerces. `"5" + 5` becomes `"55"` (JavaScript) or `5 + "5"` becomes `10` in some contexts (PHP). C lets you treat an `int` as a pointer with a cast and read arbitrary memory — extremely weak.

The two axes are independent. Here's the grid:

| | **Strong** | **Weak** |
|---|---|---|
| **Static** | Java, Go, Rust, Haskell | C, C++ (casts let you reinterpret bytes) |
| **Dynamic** | Python, Ruby | JavaScript, PHP, Perl |

So "Python is strongly typed" and "Python is dynamically typed" are both true and *not contradictory*: Python checks types at runtime (dynamic) but refuses to silently coerce `"5" + 5` (strong). Don't let anyone tell you dynamic means weak — Python is a counterexample you'll use constantly.

### 7. The Canonical Crash: `null` / `None` / `undefined`

The single most common runtime type error in the world is calling a method on "nothing":

```python
user = find_user(id)   # returns None if not found
print(user.name)       # AttributeError: 'NoneType' object has no attribute 'name'
```

```javascript
const user = findUser(id);  // returns undefined if not found
console.log(user.name);     // TypeError: Cannot read properties of undefined (reading 'name')
```

In a dynamic language, this is a runtime crash that only happens when `find_user` actually returns nothing. A *static* type system that distinguishes "User" from "maybe-a-User" (like Rust's `Option<User>`, Kotlin's `User?`, or Haskell's `Maybe User`) can force you to handle the empty case **at compile time** — turning a 2 a.m. production page into a build error on your laptop. This is one of the strongest practical arguments for static typing, and you'll meet it again at every level.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Static type checking** | Airport security screening *before* you board — every passenger checked at the gate, the plane doesn't take off with a problem aboard. |
| **Dynamic type checking** | A bouncer checking IDs at each door *inside* the club — you're already in the building; you only get stopped when you try to enter a room. |
| **Type error** | Trying to plug a US plug into a UK socket. It simply doesn't fit. |
| **Compile time** | Proofreading the whole essay before printing 10,000 copies. |
| **Run time** | Reading the essay aloud and discovering the typo only when you reach that word. |
| **`null` crash** | Reaching into your pocket for your keys, finding nothing, and the door staying locked. |
| **Conservatism (static rejects valid code)** | A strict spell-checker flagging "Anthropic" as a misspelling — it's actually fine, but the checker can't prove it. |
| **Duck typing** | Hiring based on "can you do the job?" rather than "what's your job title?" If it can quack, it's hired as a duck. |
| **Weak typing / coercion** | A vending machine that accepts a button as a coin because it's round and metal — convenient until it gives you the wrong snack. |
| **Type annotation** | Labeling every box in a move "KITCHEN — FRAGILE" so nobody has to open it to know what's inside. |

---

## Mental Models

### The "Spell-Check vs Read-Aloud" Model

Static typing is like a spell-checker that scans the **entire document** before you publish. It flags every misspelling, even in the footnote nobody reads. It occasionally flags a real word it doesn't recognize (a false alarm — that's conservatism). Dynamic typing is like proofreading by **reading aloud**: you only catch the typo when you reach that exact word, and if you skip a paragraph, its typos go unnoticed. Both find typos; one finds them all up front, the other finds them as you go and misses the parts you skip.

### The "Label on the Box vs Label on the Item" Model

In a static language, the **box** (variable) is labeled "INTEGERS ONLY," and you may only ever put integers in it. The checker enforces the label without opening the box. In a dynamic language, the box is unlabeled — anything goes in — and each **item** inside carries its own tag. You find out what you grabbed only when you pull it out and look. This is the variable-typed-vs-value-typed distinction made physical.

### The "Pay Now vs Pay Later" Model

Static typing makes you **pay up front** with annotations and the occasional rejected-but-valid program — in exchange, fewer surprises later. Dynamic typing lets you **pay later**: write fast and loose now, and possibly pay with a production crash on an untested path. Neither is free; they just move the cost to different times. As a codebase grows and lives longer, the "pay later" bill tends to grow, which is why large old codebases drift toward static checking.

---

## Code Examples

We'll write the same tiny program — *look up a user and greet them* — in a static language (Java, Go) and a dynamic one (Python, JavaScript), and watch where the bug surfaces.

### The bug: a typo in a field name

#### Python (dynamic) — runs, then crashes

```python
class User:
    def __init__(self, name):
        self.name = name

def greet(user):
    return "Hello, " + user.naem   # TYPO: should be .name

u = User("Ada")
print(greet(u))   # AttributeError: 'User' object has no attribute 'naem'
```

This program **compiles and starts running**. The typo is only discovered the instant `greet` executes the bad line. If `greet` were called only in an error-handling branch, the typo could ship to production unnoticed.

#### JavaScript (dynamic, weak) — even quieter

```javascript
const user = { name: "Ada" };
console.log("Hello, " + user.naem);   // "Hello, undefined"  — NO ERROR AT ALL
```

Worse than Python: reading a missing property returns `undefined`, so this *doesn't even throw* — it just prints `Hello, undefined` and carries on. The bug is completely silent.

#### Java (static) — won't compile

```java
class User {
    String name;
    User(String name) { this.name = name; }
}

class Main {
    static String greet(User user) {
        return "Hello, " + user.naem;   // COMPILE ERROR: cannot find symbol 'naem'
    }
}
```

The compiler refuses. You never get a runnable program with this typo. The error message points right at `naem` and you fix it in five seconds, before any user, any test, any deploy.

#### Go (static) — won't compile

```go
type User struct {
    Name string
}

func greet(u User) string {
    return "Hello, " + u.Naem   // COMPILE ERROR: u.Naem undefined (type User has no field or method Naem)
}
```

Same story. `go build` fails. The bug cannot reach runtime.

### The other bug: passing the wrong type

#### Python (dynamic, strong) — runtime TypeError

```python
def double(n):
    return n * 2

print(double("5"))   # prints "55"  — string repetition, NOT what we meant!
print(double(5))     # prints 10
```

Note Python is *strong* but *dynamic*: `"5" * 2` is a legal operation (string repetition), so there's no error — just a wrong answer. The dynamic checker can't know you meant numeric doubling.

#### Go (static) — won't compile

```go
func double(n int) int {
    return n * 2
}

func main() {
    fmt.Println(double("5"))   // COMPILE ERROR: cannot use "5" (string) as int value
}
```

The static type on the parameter (`n int`) makes this impossible. The wrong call is caught at the boundary.

### The famous `null`/`None`/`undefined` crash

#### Python (dynamic)

```python
def find_user(users, target_id):
    for u in users:
        if u["id"] == target_id:
            return u
    return None   # not found

user = find_user([], 42)
print(user["name"])   # TypeError: 'NoneType' object is not subscriptable
```

#### Rust (static, with `Option`) — forces you to handle "not found"

```rust
fn find_user(users: &[User], target_id: u32) -> Option<&User> {
    users.iter().find(|u| u.id == target_id)
}

fn main() {
    let user = find_user(&[], 42);
    // println!("{}", user.name);  // COMPILE ERROR: Option<&User> has no field `name`
    match user {
        Some(u) => println!("{}", u.name),
        None => println!("not found"),   // compiler MAKES you handle this
    }
}
```

The static type `Option<&User>` literally cannot be used as a `User` until you unwrap it and deal with the `None` case. The 2 a.m. crash becomes a compile error.

---

## Pros & Cons

| Aspect | Static Typing | Dynamic Typing |
|--------|---------------|----------------|
| **When errors are found** | Before running — at build time. Fail fast. | While running — only on executed lines. |
| **Whole-program guarantees** | Yes — even unexecuted branches are checked. | No — only the paths you actually run are checked. |
| **Verbosity** | More annotations and ceremony. | Terse — just write the logic. |
| **Flexibility** | Less — the checker is conservative and rejects some valid programs. | More — anything goes until it actually breaks. |
| **Refactoring safety** | High — rename a field and the compiler lists every broken caller. | Low — you hope your tests cover every call site. |
| **Onboarding / reading** | Types document intent; IDE autocomplete is precise. | You must read the code or run it to know the shape of data. |
| **Speed of prototyping** | Slower to get started; fight the checker. | Fast — great for scripts, exploration, REPL. |
| **Tooling (autocomplete, jump-to-def)** | Excellent — the IDE knows types. | Weaker — the IDE has to guess. |
| **Runtime performance** | Often faster — no runtime type checks needed (see `professional.md`). | Pays for runtime type tags and checks (JITs claw some back). |

---

## Use Cases

**Reach for static typing when:**

- The codebase is **large, long-lived, or has many contributors** — the compiler is a tireless reviewer who never forgets a field name.
- **Correctness matters more than speed of writing** — payments, infrastructure, libraries other teams depend on.
- You'll do a lot of **refactoring** — renaming and reshaping data safely is static typing's superpower.
- You want **precise IDE support** — accurate autocomplete and "find all usages."

**Reach for dynamic typing when:**

- You're **prototyping, scripting, or exploring** — a quick data-munging script, a one-off automation, a notebook.
- The program is **small and short-lived** — the bug-catching value of static types is lowest here.
- You need **maximum flexibility** — metaprogramming, plugins, gluing together loosely-shaped data (JSON from anywhere).
- You're working in a **REPL-driven, interactive** style and want instant feedback.

**The modern reality (covered fully in later levels):** the line is blurring. Dynamic languages are bolting on *optional* static checking — TypeScript over JavaScript, type hints + mypy over Python — to get the best of both: dynamic flexibility where you want it, static safety where it pays.

---

## Coding Patterns

### Pattern 1: Validate at the boundary (dynamic languages)

Dynamic languages don't check types for you, so check incoming data yourself at the edges of your program:

```python
def set_age(age):
    if not isinstance(age, int):
        raise TypeError(f"age must be int, got {type(age).__name__}")
    ...
```

Validate at the boundary (request handlers, file parsers, library entry points) and trust the data inside.

### Pattern 2: Let the type be the documentation (static languages)

```go
func SendEmail(to EmailAddress, subject string, body string) error
```

The signature tells you everything: it needs an `EmailAddress` (not just any string), a subject, a body, and it can fail. You don't need a doc comment to know how to call it.

### Pattern 3: Make "no value" explicit, not a landmine

Prefer types that encode emptiness — `Optional`, `Option`, `Maybe`, a nullable `User?` — over a bare value that might secretly be `null`. In dynamic languages, be explicit in your return contract and document it: "returns `None` if not found," then always handle `None`.

### Pattern 4: Convert explicitly, never rely on coercion

```python
total = int(quantity) * float(price)   # explicit, clear
```

Don't lean on weak-typing coercion even when the language offers it — it's the source of silent wrong answers. Being explicit reads the same in strong and weak languages.

---

## Best Practices

- **Know which two axes you're on.** Be able to place your language: static-or-dynamic, strong-or-weak. Python = dynamic + strong. C = static + weak. Don't conflate them.
- **In dynamic languages, lean on tests harder.** Tests are your only safety net for the bugs a compiler would otherwise catch. Aim to *execute* every branch.
- **In static languages, don't fight the checker with casts.** A cast (`(int)`, `as`, type-ignore) silences the checker and hands the risk back to runtime. Use sparingly.
- **Handle `null`/`None`/`undefined` at every boundary.** It's the #1 runtime crash. Never assume a lookup found something.
- **Let static types replace comments.** A good signature documents intent better than prose and can't go stale.
- **Add type checking incrementally to dynamic code.** If your Python or JS project is growing, adopt type hints / TypeScript — you don't have to convert everything at once (the "gradual" story, `middle.md`).
- **Don't rely on coercion for correctness.** Convert explicitly. Coercion is convenience, not a contract.

---

## Edge Cases & Pitfalls

- **"Dynamic means weak" — false.** Python and Ruby are dynamic *and* strongly typed. Don't repeat this myth in an interview.
- **"Static means no runtime type errors" — false.** Casts, reflection, deserialization, and `null` can all still blow up at runtime in a static language. Static *reduces* runtime type errors; it doesn't eliminate them.
- **The unexercised-branch trap.** In dynamic code, a type bug in a rarely-run branch is invisible until that branch runs. Your "it works" run proved nothing about the other branches.
- **JavaScript's silent `undefined`.** Reading a missing property gives `undefined` instead of throwing, so bugs propagate silently (`Hello, undefined`) until something downstream finally chokes.
- **Static typing rejects some valid programs.** When the checker says no but you're *sure* it's fine, the checker may simply be too conservative to prove it. Sometimes you're right; often you're missing a case it sees. Default to assuming the checker has a point.
- **`==` coercion in weak languages.** JavaScript's `0 == "0"` is `true`, `0 == ""` is `true`, `"0" == ""` is `false`. Use `===` (strict equality) to avoid the coercion maze.
- **Inferred types still mean static.** Go's `x := 5` has no written annotation but `x` is statically an `int` forever. "No annotations visible" does not mean "dynamic."
- **A REPL exists for static languages too.** Dynamic languages are famous for REPLs, but Scala, Haskell, and others have them. REPL-friendliness correlates with dynamic but isn't the definition.

---

## Test Yourself

1. Define static typing and dynamic typing in one sentence each, focusing on *when* checks happen.
2. Place these languages on the static/dynamic and strong/weak grid: Python, JavaScript, Go, C, Haskell, Ruby.
3. Why is "Python is strongly typed" not a contradiction with "Python is dynamically typed"? Give the example that proves both.
4. In the Python typo example (`user.naem`), why does the program run at all before crashing? In the Java version, why doesn't it?
5. Write a function in a dynamic language with a type bug inside an `if` branch that only runs when its argument is negative. Explain when the bug would be discovered.
6. What does JavaScript print for `"Hello, " + user.naem` when `naem` doesn't exist, and why is that more dangerous than Python's behavior?
7. Explain how a static `Option<User>` / `User?` type prevents the `NoneType has no attribute` crash. What does the compiler force you to do?
8. Give one program that is actually correct but a static type checker would (reasonably) reject. Why can't the checker prove it safe?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 STATIC vs DYNAMIC TYPING                          │
├──────────────────────────────────────────────────────────────────┤
│ STATIC   types checked BEFORE running (compile time)             │
│          type attached to the VARIABLE/slot                      │
│          catches typos, wrong args, missing methods up front     │
│          rejects some valid programs (conservative)              │
│          e.g. Java, Go, Rust, Haskell, TypeScript, C#            │
├──────────────────────────────────────────────────────────────────┤
│ DYNAMIC  types checked WHILE running (run time)                  │
│          type attached to the VALUE                              │
│          terse, flexible, REPL-friendly, duck typing             │
│          type bugs hide on unexecuted paths until they run       │
│          e.g. Python, JavaScript, Ruby, PHP, Lisp                │
├──────────────────────────────────────────────────────────────────┤
│ ORTHOGONAL AXIS — STRONG vs WEAK (do NOT confuse!)              │
│   strong: refuses surprise coercion  ("5"+5 => error)            │
│   weak:   coerces freely             ("5"+5 => "55" or 10)       │
│                                                                  │
│            STRONG            WEAK                                │
│   STATIC   Java, Go, Rust    C, C++                              │
│   DYNAMIC  Python, Ruby      JavaScript, PHP                     │
├──────────────────────────────────────────────────────────────────┤
│ THE #1 RUNTIME CRASH                                            │
│   None / null / undefined has no attribute/method               │
│   static "maybe" types (Option/?/Maybe) catch it at compile     │
├──────────────────────────────────────────────────────────────────┤
│ RULE OF THUMB                                                   │
│   small / script / explore  -> dynamic is fine                  │
│   large / long-lived / team -> static earns its keep            │
│   modern trend: add static checks ON TOP of dynamic (TS, mypy)  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **type** is a promise about what a value is and what you can do with it. A **type error** is breaking that promise (e.g. uppercasing a number). Type errors are *always* caught eventually — the question is **when**.
- **Static typing** checks types **before the program runs**. The type is attached to the **variable**. It catches typos, wrong arguments, and missing methods across the *whole* program — even unexecuted branches — and fails the build. The cost: annotations, ceremony, and rejecting some valid-but-unprovable programs (conservatism).
- **Dynamic typing** checks types **while the program runs**. The type is attached to the **value**. It's terse, flexible, and REPL-friendly, and never rejects a valid program. The cost: type bugs on unexercised paths stay invisible until those paths run — often in production.
- **Strong vs weak is a *different* axis** — it's about whether the language silently coerces types (`"5" + 5`), not about when checks happen. Python is dynamic *and* strong; C is static *and* weak. Never conflate the two.
- The **single most common runtime type crash** is `None`/`null`/`undefined` having no such attribute/method. Static "maybe" types (`Option`, `User?`, `Maybe`) can force you to handle the empty case at compile time.
- **Rule of thumb:** dynamic is great for small, short-lived, exploratory code; static earns its keep as codebases grow large, long-lived, and shared. The modern industry trend is to **bolt static checking onto dynamic languages** (TypeScript, Python type hints) — the subject of the next level.

---

## What's Next

- `middle.md` — **gradual typing** (TypeScript, Python hints + mypy), **duck typing vs structural typing**, the `any`/`Any` escape hatch, and how the static and dynamic worlds meet in the middle.
- `senior.md` — **type soundness**, **erasure vs reification**, **type inference** making static feel dynamic, and the runtime mechanics.
- `professional.md` — **performance** (monomorphization, JITs, inline caches), the **empirical bug-rate research**, and migrating a large Python/JS codebase to static checking.
- `interview.md` — graded questions across all of the above.
- `tasks.md` — exercises to make the distinction muscle-memory.
