# Runtime Assertions & Contracts — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Runtime Assertions & Contracts
> *Most bugs aren't caught where they're born — they're caught three functions later, wearing a disguise. An assertion is a tripwire you plant at the scene of the crime so the program stops while the evidence is still warm.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What an Assertion Actually Is](#core-concept-1--what-an-assertion-actually-is)
5. [Core Concept 2 — Fail-Fast: Catching Bugs Where They Happen](#core-concept-2--fail-fast-catching-bugs-where-they-happen)
6. [Core Concept 3 — Assertions in Five Languages](#core-concept-3--assertions-in-five-languages)
7. [Core Concept 4 — Contracts: Preconditions, Postconditions, Invariants](#core-concept-4--contracts-preconditions-postconditions-invariants)
8. [Core Concept 5 — "Can't Happen" vs "Might Happen": Asserts vs Error Handling](#core-concept-5--cant-happen-vs-might-happen-asserts-vs-error-handling)
9. [Core Concept 6 — Debug vs Release, and the Side-Effect Trap](#core-concept-6--debug-vs-release-and-the-side-effect-trap)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is an assertion, and why is it the cheapest bug-catcher you have?**

Picture a function that divides two numbers. Somewhere upstream, a calculation goes wrong and passes it a zero divisor. Without any guard, one of two things happens: the program crashes with a cryptic message far from the real bug, or — worse — it limps along producing nonsense numbers that corrupt a report nobody checks until next quarter. Either way, the *real* fault (the upstream calculation) is now miles away from the *symptom* you'll eventually see.

An **assertion** is a one-line defense against exactly this. It is a statement you write in your code that says: *"At this exact point, this thing MUST be true. If it isn't, the program is in a state I never designed for — stop right now and tell me where."* You write `assert(divisor != 0)` at the top of the function, and if `divisor` is ever zero, the program halts and prints the file and line number. The bug is caught at the *scene*, not three functions downstream.

This is the simplest, oldest, and arguably most underused tool in this entire roadmap. The sanitizers in the other topics — [AddressSanitizer](../01-address-sanitizer-asan/junior.md), [ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md) — are checks the *compiler* inserts for you, automatically, for whole categories of bug. An assertion is a check *you* insert, by hand, for the specific things *you* know must be true about *your* logic. The compiler can't know that "this list should already be sorted here" or "the cache size should never exceed its capacity" — only you do. Assertions are how you write that knowledge down where the machine can enforce it.

> **Mindset shift:** stop trusting your assumptions silently. Every time you think "this can't be null here" or "the index is obviously in range," you are making a bet. An assertion turns that silent bet into a written, checked claim. The rule is: **assert your assumptions, and fail fast.** A program that stops loudly at the first sign of a broken assumption is infinitely easier to debug than one that keeps running with corrupted state. Crashing early is a *feature*, not a failure.

---

## Prerequisites

- **Required:** You can write a function with parameters, call it, and use an `if` statement (examples use **C**, **Go**, and **Python**).
- **Required:** You've seen a program crash and print an error message, even if you didn't fully understand it.
- **Helpful:** You've spent time debugging something where the crash happened far from the actual mistake. (Assertions exist to end that experience.)
- **Helpful:** You know the difference between writing code (development) and shipping it to real users (production). We'll lean on it heavily.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Assertion** | A line of code that checks "this MUST be true here"; if false, the program aborts and reports where. |
| **Invariant** | A condition that is *always* true at a certain point (about an object, a loop, the whole program). |
| **Precondition** | What must be true *before* a function runs — the caller's responsibility. |
| **Postcondition** | What the function *guarantees* is true when it returns — the function's responsibility. |
| **Contract** | A function's promise: "if you meet my preconditions, I'll deliver my postconditions." |
| **Fail-fast** | Stop the program at the first detected sign of a bug, instead of continuing in a broken state. |
| **Programmer error** | A bug in the code itself — a mistake that *should never happen* if the code is correct. |
| **Runtime error** | An *expected* bad situation from the outside world: bad input, missing file, network down. |
| **Side effect** | Anything a piece of code does besides return a value — changing a variable, popping a stack, writing a file. |
| **`NDEBUG`** | A C setting that, when defined, **deletes** every `assert` from the compiled program. |
| **Abort** | An immediate, hard stop of the program (no cleanup, no recovery) — what a failed `assert` triggers. |

---

## Core Concept 1 — What an Assertion Actually Is

An assertion is a check with an attitude. A normal `if` says "if this is true, do something." An assertion says: *"this had better be true — and if it isn't, the program has no business continuing."*

Here it is in C, the language where assertions have lived since the 1970s:

```c
#include <assert.h>   // the assert() macro lives here

int factorial(int n) {
    assert(n >= 0);   // I declare: n is never negative here. Prove me wrong = abort.
    int result = 1;
    for (int i = 2; i <= n; i++)
        result *= i;
    return result;
}
```

If someone calls `factorial(-3)`, the program doesn't quietly return garbage. It stops dead and prints something like:

```
Assertion failed: (n >= 0), function factorial, file math.c, line 5.
Abort trap: 6
```

Read that message for what it is: a confession from the program. *"At line 5 of math.c, in `factorial`, I expected `n >= 0` and it was false. I refuse to keep going."* You now know the exact place the assumption broke and the exact condition that failed. No guessing.

The mechanics are simple. `assert(expr)` evaluates `expr`. If it's true (non-zero), nothing happens — the program flows on as if the line weren't there. If it's false (zero), the program prints the failed expression plus the file and line, then calls `abort()`, which kills the process immediately.

> **Key insight:** An assertion is a claim about what is *always true if your code is correct* — not a way to handle things that might legitimately go wrong. A failing assertion never means "a user did something weird." It always means "*I*, the programmer, was wrong about my own code." That distinction — which we'll sharpen in [Concept 5](#core-concept-5--cant-happen-vs-might-happen-asserts-vs-error-handling) — is the entire key to using assertions well.

---

## Core Concept 2 — Fail-Fast: Catching Bugs Where They Happen

Why is stopping immediately so valuable? Because of the *distance* between a bug and its symptom.

Imagine a bug as a drop of ink in a glass of water. The instant it lands (the actual mistake) it's a tight, identifiable spot. Every second the program keeps running, the ink spreads — bad data flows into other variables, gets stored, gets passed around — until the whole glass is grey and you can't tell where the drop landed. The crash you *eventually* see tells you almost nothing about where the ink *entered*.

Concretely: suppose a function returns a user record, but a bug makes it return `NULL` (nothing) in a case you didn't expect:

```c
// WITHOUT an assertion: the bug spreads
User *u = find_user(id);          // BUG: returns NULL in a case we missed
print_name(u->name);              // crash here — but the real bug was above
                                  // ...or u gets passed to 5 more functions first,
                                  //    and the crash happens somewhere unrelated
```

The crash lands at `u->name`, or worse, deep inside some unrelated function that received `u` later. You'll spend an hour reading the *wrong* code, because the symptom is far from the cause.

Now plant the tripwire:

```c
// WITH an assertion: the bug is caught at the scene
User *u = find_user(id);
assert(u != NULL);                // tripwire — fires the instant find_user misbehaves
print_name(u->name);
```

The program now aborts *at the assertion*, naming `find_user` as the suspect. The ink is caught the moment it touches the water. **This is fail-fast:** the closer in time and space a failure is to its cause, the cheaper it is to fix. Assertions buy you that closeness for the price of one line.

> **Key insight:** The cost of a bug is roughly proportional to how far it travels before it's noticed. A bug caught at its source by an assertion costs minutes. The same bug, allowed to corrupt state and surface later as a mysterious crash (or a wrong number in production), can cost days. You are not "adding crashes" by writing assertions — you are *moving* crashes earlier, to where they're trivial to diagnose.

---

## Core Concept 3 — Assertions in Five Languages

The idea is universal; the spelling differs. Here's the same assumption — "the count must be positive" — across the languages you're most likely to meet.

**C** — the `assert` macro from `<assert.h>`:

```c
#include <assert.h>
assert(count > 0);   // aborts with file+line if false; removed when NDEBUG is set
```

**Python** — `assert` is a built-in keyword:

```python
assert count > 0, "count must be positive"   # raises AssertionError if false
```

The optional text after the comma is a message printed on failure. Note: running Python with the `-O` (optimize) flag *removes* all `assert` statements — the same debug-vs-release idea as C's `NDEBUG`.

**Go** — has **no** `assert` keyword, by deliberate design. The idiomatic equivalent is an explicit `if` that `panic`s:

```go
if count <= 0 {
    panic("count must be positive")   // stops the goroutine, prints a stack trace
}
```

Go's authors left `assert` out on purpose — they worried it encourages skipping real error handling. So in Go you write the check by hand. A `panic` is the rough equivalent of an abort: it unwinds with a stack trace and (if uncaught) crashes the program.

**Java** — has an `assert` keyword, but it's **off by default**:

```java
assert count > 0 : "count must be positive";   // throws AssertionError — IF enabled
```

Java assertions only run if you launch the JVM with the `-ea` (enable assertions) flag. Without `-ea`, every `assert` line is skipped. This trips up beginners constantly: they "added an assert" and wonder why it never fires.

**Rust** — two flavors, and the distinction is worth learning early:

```rust
assert!(count > 0, "count must be positive");   // ALWAYS runs, even in release builds
debug_assert!(count > 0);                        // runs in debug, REMOVED in release
```

Rust makes the debug-vs-release choice explicit and per-assertion: `assert!` is always on (use it for cheap, critical checks), `debug_assert!` is stripped from optimized release builds (use it for expensive checks you only want during development).

> **Key insight:** Two patterns appear in every language. First, an assertion that can be **compiled/optimized away** for production (C's `assert`, Python's under `-O`, Java's without `-ea`, Rust's `debug_assert!`). Second — in Rust's `assert!` and any hand-written `if`/`panic` — a check that **always runs**. Knowing which kind you're writing matters: an always-on check costs a little speed forever; a stripped check costs nothing in production but also protects nothing there.

---

## Core Concept 4 — Contracts: Preconditions, Postconditions, Invariants

Assertions get far more powerful once you organize them around a single idea: a function makes a **contract** with whoever calls it. Like a contract between two businesses, it has obligations on *both* sides.

A contract has three kinds of clauses:

**1. Preconditions — what must be true when the function is *called*.** These are the *caller's* obligations. "Don't call me with a negative number." "The index you pass must be in range." You check them at the *top* of the function:

```c
int element_at(int *array, int size, int index) {
    assert(array != NULL);            // precondition: caller must give a real array
    assert(index >= 0 && index < size); // precondition: index must be in bounds
    return array[index];
}
```

If a precondition fails, the *caller* has a bug — they violated the deal.

**2. Postconditions — what the function *guarantees* when it returns.** These are the *function's* obligations. "When I return, the result will be sorted." "My output will never be negative." You check them at the *bottom*, just before returning:

```python
def absolute_value(x):
    result = x if x >= 0 else -x
    assert result >= 0   # postcondition: I promise the result is never negative
    return result
```

If a postcondition fails, *this function* has a bug — it failed to deliver what it promised.

**3. Invariants — what is *always* true about something.** An invariant is a truth that holds at well-defined moments throughout a thing's life. Two common kinds:

A **data/object invariant** — something always true about a structure. For a stack with a fixed capacity, "the number of items never exceeds the capacity":

```go
func (s *Stack) Push(v int) {
    s.items = append(s.items, v)
    if s.size > s.capacity {          // invariant check
        panic("stack invariant violated: size exceeded capacity")
    }
}
```

A **loop invariant** — something true on every pass through a loop. Here, "low and high stay within the array":

```c
while (low <= high) {
    assert(low >= 0 && high < n);   // loop invariant: indices stay in bounds every pass
    int mid = low + (high - low) / 2;
    // ...binary search...
}
```

> **Key insight:** Pre/post/invariant isn't bureaucracy — it's a way to assign *blame in advance*. A failed precondition means the **caller** is wrong. A failed postcondition means **this function** is wrong. A failed invariant means **something corrupted the object/loop** between checks. The moment an assertion fires, you don't just know *that* something broke — the *kind* of clause tells you *whose* fault it is and where to look first. This idea — functions as contracts enforced by checks — is called **Design by Contract**, and it's the bridge to the more rigorous world of [Formal Methods & Verification](../../formal-methods-and-verification/).

---

## Core Concept 5 — "Can't Happen" vs "Might Happen": Asserts vs Error Handling

This is the single most important distinction in the entire topic. Get it wrong and you'll either litter your code with useless asserts or crash on your users for things that aren't bugs.

There are two categories of bad situation, and they need two completely different tools.

**Category A — "Can't happen if my code is correct" (programmer error).** A negative array size. A `NULL` where your own logic guarantees a value. A sorted list that isn't sorted after your sort function ran. These are *bugs*. If one occurs, the code is wrong and there is nothing sensible to do but stop and fix it. **This is what assertions are for.**

**Category B — "Might happen during normal operation" (runtime condition).** A user types "abc" into a number field. A file the user named doesn't exist. The network drops mid-request. The disk is full. None of these are bugs in your code — they are *facts of the real world* that correct programs must *handle gracefully*. **This is what error handling is for** — return an error, show a message, retry, ask again. **Never** an assertion.

The contrast in code:

```c
// WRONG — asserting on a runtime condition (user/world input)
FILE *f = fopen(filename, "r");
assert(f != NULL);   // BUG IN YOUR THINKING: a missing file is NORMAL,
                     //   not a programmer error. This crashes on the user
                     //   for something they can legitimately cause.

// RIGHT — handle the expected failure
FILE *f = fopen(filename, "r");
if (f == NULL) {
    fprintf(stderr, "Could not open %s: %s\n", filename, strerror(errno));
    return ERROR;    // graceful: report it, let the program decide what to do
}
```

```python
# RIGHT — assert on a programmer-error condition (your own invariant)
def withdraw(account, amount):
    assert amount > 0, "withdraw() called with non-positive amount"  # caller's BUG
    if amount > account.balance:
        raise InsufficientFunds(amount, account.balance)  # NORMAL — a real-world case
    account.balance -= amount
```

Notice both appear in one function. `amount <= 0` is a *programmer* mistake (no UI should ever submit it; if it arrives, code upstream is broken) → assert. `amount > balance` is a perfectly *normal* real-world situation → proper error.

> **Key insight:** Ask one question of every check: *"If this fails, is it a bug in my code, or a fact about the world?"* Bug → **assert** (fail fast, the developer must fix it). Fact about the world → **error handling** (handle it, the program must cope). Asserting on world-facts crashes on your users; using soft error handling for real bugs lets corruption spread silently. Each tool in its own lane.

---

## Core Concept 6 — Debug vs Release, and the Side-Effect Trap

Here's a property of C assertions that is either a great feature or a nasty footgun, depending on whether you know about it.

In C, defining a setting called **`NDEBUG`** ("no debug") at compile time makes the `assert` macro expand to *nothing*. Every assertion in the program vanishes:

```bash
gcc  program.c -o app          # assertions ACTIVE (default)
gcc -DNDEBUG program.c -o app  # assertions REMOVED — every assert() is now empty
```

The reasoning: assertions are a development safety net. In a performance-critical production build, you may not want to pay even the tiny cost of checking them millions of times. So C lets you strip them all out with one flag. (Python's `-O`, Java's missing `-ea`, and Rust's `debug_assert!` give you the same on/off behavior.)

This leads directly to the most important rule about *how* to write assertions:

> **Key insight: NEVER put code with side effects inside an assertion.** Because the assertion can be *deleted entirely* in a release build, any work it does besides checking disappears with it. If the program's correctness depends on that work, your release build is now broken in a way your debug build isn't — the worst kind of bug to chase.

The classic disaster:

```c
// CATASTROPHIC — pop() is a SIDE EFFECT (it removes an item)
assert(pop(stack) == 5);
// Debug build:   pops an item AND checks it == 5.  Works.
// Release build (NDEBUG): the WHOLE line is deleted.
//   pop() never runs. The item is never removed. The program behaves
//   completely differently in production than in testing. Nightmare.
```

The fix is to separate the *action* from the *check*:

```c
// CORRECT — do the side-effecting work OUTSIDE the assert, check the result INSIDE
int top = pop(stack);   // the pop always happens, in every build
assert(top == 5);       // only the CHECK is removed in release — harmless
```

The rule in one sentence: **an assertion's condition must be a pure question, not an action.** It may read values and compare them; it may never *change* anything. Calls like `pop()`, `i++`, `next()`, `remove()`, or anything that writes a file or mutates state are forbidden inside an assert. Comparisons, range checks, null checks, and `==` are exactly what belongs there.

---

## Real-World Examples

**1. The null pointer that crashed "randomly."** A service occasionally crashed deep inside a logging routine with a meaningless stack trace. The real bug: a lookup function returned `NULL` for a rare key, and the `NULL` was passed through four functions before something dereferenced it. A single `assert(record != NULL)` right after the lookup would have aborted at the source, naming the lookup as the culprit instead of the innocent logger four calls downstream. The fix took five minutes once the assert was added; finding it without one took two days.

**2. The off-by-one a loop invariant caught.** A binary search occasionally read one element past the end of an array — rarely, only for certain sizes. Adding `assert(mid >= 0 && mid < n)` inside the loop turned an intermittent, data-dependent corruption into an immediate, reproducible abort that pointed at the exact iteration. The invariant made a heisenbug deterministic.

**3. Where assertions and fuzzing meet.** A team fuzzes their JSON parser (see [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md)). A fuzzer normally only notices a bug if the program *crashes*. But many bugs produce *wrong output*, not a crash — the parser accepts malformed input and silently builds a broken tree. By adding postcondition assertions ("every node has a valid type tag," "the depth never exceeds the input length"), the team gave the fuzzer an **oracle**: now a violated assertion *is* a crash the fuzzer can detect. Inputs that produced quietly-wrong results suddenly became findable bugs. This is why assertions are described as "the cheapest dynamic analysis" — they're checks *you* write, and they multiply the power of every other tool in this section.

**4. The `NDEBUG` regression.** A developer wrote `assert(initialize_cache() == OK)` — putting the *entire cache setup* inside an assert. It worked perfectly in every test (debug build). Shipped to production (built with `-DNDEBUG`), the cache was never initialized because the whole line was stripped, and the service ran with an empty cache, silently slow, for a week. A textbook side-effect-in-assert disaster.

---

## Mental Models

- **An assertion is a tripwire at the scene of the crime.** You plant it where you *expect* nothing bad to happen. If it ever fires, the criminal (the bug) just walked past *that exact spot* — you've caught it red-handed instead of finding the body three rooms away.

- **A contract is a deal with obligations on both sides.** Preconditions are what the *caller* owes you ("give me valid input"). Postconditions are what *you* owe the caller ("I'll return a valid result"). When an assert fires, the *type* of clause tells you which party broke the deal.

- **"Bug or weather?"** Before every check, ask: is this failure a *bug in my code* or just *the weather* (bad input, missing file, dead network)? Bugs get assertions (stop, a human must fix this). Weather gets error handling (cope, this is normal life).

- **An assertion's condition is a question, never an action.** "Is `x` positive?" — fine. "Pop an item and is it 5?" — forbidden: the question secretly *did something*, and that something vanishes when assertions are turned off.

- **Asserts are training wheels you can remove for the race.** During development (debug builds) they catch your wobbles. In a tuned production build you *can* strip them (`NDEBUG`) for speed — which is exactly why nothing the program *needs* may live inside one.

---

## Common Mistakes

1. **Asserting on user input or external conditions.** `assert(file != NULL)` after opening a user-named file crashes on the user for a completely normal situation. Missing files, bad input, and network failures are *weather*, not *bugs* — handle them with real error handling, never an assert.

2. **Putting side effects inside an assert.** `assert(pop() == 5)` or `assert(i++ < n)` works in debug and silently breaks in release, because the whole line is stripped when assertions are off. Do the action on its own line; assert only the *result*.

3. **Forgetting to enable assertions where they're off by default.** Java assertions do nothing without `-ea`; Python's vanish under `-O`. Beginners "add an assert," see it never fire, and conclude their code is correct — when really the assert was never running.

4. **Using an assert where you needed to actually handle the case.** Swapping `if (err) return err;` for `assert(!err)` doesn't handle the error — it just crashes on it (in debug) or *ignores it* (in release, where the line is gone). Asserts are not a shortcut for error handling.

5. **Writing assertions with no information.** `assert(ok)` tells you almost nothing when it fires. Prefer a specific condition (`assert(count > 0)`) and, in languages that allow it, a message (`assert count > 0, "count must be positive"`) so the failure explains itself.

6. **Asserting things that aren't actually guaranteed.** An assertion must encode a truth that holds *whenever the code is correct*. Asserting something that can legitimately be false (e.g., a value that's *sometimes* zero on purpose) turns a normal case into a crash. If it can happen, it's not an invariant.

---

## Test Yourself

1. In one sentence, what does an assertion claim, and what does it do if that claim is false?
2. Explain "fail-fast" and why a program that crashes *earlier* is easier to debug than one that crashes *later*.
3. A function `sort(list)` should return a sorted list. Write (in any language) a *postcondition* assertion for it, in words or code.
4. You write `assert(deposit(account, 100) == SUCCESS)` in C. Why is this dangerous, and how do you fix it?
5. A user submits an empty form field. Should you use an assertion or error handling? Why?
6. Java: you added `assert balance >= 0;` but it never seems to fire even when balance goes negative. What did you most likely forget?
7. Name the three parts of a contract and say, for each, *whose* bug it is when that part's assertion fails.

<details>
<summary>Answers</summary>

1. An assertion claims that a condition **must be true at this point if the code is correct**; if it's false, the program **aborts (stops immediately) and reports the failed condition with its file and line**.
2. **Fail-fast** means stopping at the *first* detected sign of a bug instead of continuing in a broken state. An earlier crash is easier to debug because the symptom is *close* to the cause — bad state hasn't yet spread to other variables and functions, so the error message points near the real mistake instead of somewhere unrelated downstream.
3. Just before returning: check that every adjacent pair is in order, e.g. `assert all(list[i] <= list[i+1] for i in range(len(list)-1))` (Python), or in words: "assert that for every position, each element is ≤ the next."
4. `deposit(...)` is a **side effect** (it changes the account). In a release build with `NDEBUG`, the entire `assert` line is **deleted**, so the deposit never happens in production — the program behaves differently than in testing. Fix: `int r = deposit(account, 100); assert(r == SUCCESS);` — the action runs in every build; only the check is stripped.
5. **Error handling.** An empty field is a *normal, expected* real-world event the user can cause at any time — not a bug in your code. Asserting on it would crash the program on the user. Show a validation message instead.
6. You forgot to run the JVM with **`-ea`** (enable assertions). Java assertions are disabled by default and do nothing without that flag.
7. **Preconditions** (must be true when the function is called) — failure = the **caller's** bug. **Postconditions** (what the function guarantees on return) — failure = **this function's** bug. **Invariants** (always true about an object or loop) — failure = something **corrupted the object/loop** between checks.

</details>

---

## Cheat Sheet

```
WHAT AN ASSERTION IS
  assert(condition)  → if condition is FALSE, print file+line and ABORT.
                       if TRUE, do nothing (flows on).
  Meaning: "this MUST be true here if my code is correct."

THE GOLDEN RULE
  Assert your assumptions. Fail fast. Crash EARLY where it's cheap to fix.

ASSERT (bug) vs ERROR HANDLING (weather)
  programmer error / "can't happen"   → ASSERT          (stop; a human must fix)
    e.g. negative size, null my-own-logic guarantees, unsorted-after-sort
  expected real-world condition        → ERROR HANDLING  (cope; this is normal)
    e.g. bad user input, missing file, network down, disk full

CONTRACT = a function's promise (assigns blame in advance)
  precondition   checked at TOP     fail → CALLER's bug
  postcondition  checked at RETURN  fail → THIS function's bug
  invariant      always true        fail → something corrupted it

PER-LANGUAGE
  C        #include <assert.h>;  assert(x > 0);           (removed by -DNDEBUG)
  Python   assert x > 0, "msg"                            (removed by -O)
  Go       if !cond { panic("msg") }                      (no assert keyword)
  Java     assert x > 0 : "msg";                          (needs -ea to run!)
  Rust     assert!(x > 0)   always   |  debug_assert!(x)  removed in release

THE SIDE-EFFECT TRAP  (assert can be DELETED in release → never hide work in it)
  WRONG:  assert(pop() == 5);          // pop() vanishes in release build
  RIGHT:  int t = pop(); assert(t==5); // action always runs; only check is stripped
  Rule: an assert's condition is a QUESTION, never an ACTION.
```

---

## Summary

- An **assertion** is a line you write that says "this MUST be true here if my code is correct." If it's false, the program **aborts** and reports the exact file and line. It's the cheapest bug-catcher you have.
- Assertions exist to **fail fast**: catch a bug at its source, before the bad state spreads through other variables and functions and resurfaces — far away and disguised — as a mysterious crash. Crashing early is a feature.
- Every mainstream language has the idea: C's `assert` (`<assert.h>`), Python's `assert`, Go's hand-written `if !cond { panic(...) }` (no keyword), Java's `assert` (needs `-ea`), Rust's `assert!` (always on) and `debug_assert!` (debug only).
- A **contract** is a function's promise, with three clause types: **preconditions** (true when called — the caller's job), **postconditions** (guaranteed on return — the function's job), and **invariants** (always true about an object or loop). Assertions enforce contracts at runtime, and the clause type tells you *whose* bug it is. This is **Design by Contract**.
- The critical distinction: assertions are for **"can't happen if my code is correct"** (programmer error — a bug). Expected real-world conditions — bad input, missing files, dead networks — are **not** bugs; they need real **error handling**, never an assert.
- Assertions can be **stripped from release builds** (C's `NDEBUG`, Python's `-O`, Java without `-ea`, Rust's `debug_assert!`) for speed. Because they can vanish, you must **never put side effects inside an assertion** — the condition is a *question*, never an *action*.

Junior recipe: in development, **assert your assumptions liberally** — non-null, in-range, loop and object invariants, pre/postconditions. Keep **side effects out** of the conditions. Use **real error handling** for anything the outside world can legitimately cause. Those three habits alone will catch a startling fraction of your bugs at the scene instead of the morgue.

---

## Further Reading

- [`assert.h` — C standard library reference (cppreference)](https://en.cppreference.com/w/c/error/assert) — exactly what the `assert` macro does and how `NDEBUG` controls it.
- *The Pragmatic Programmer* (Hunt & Thomas) — the topics "Assertive Programming" and "Design by Contract" are the canonical, accessible introduction to everything on this page.
- *Writing Solid Code* (Steve Maguire) — a classic on using assertions aggressively to catch bugs early; dated examples, timeless advice.
- The [middle.md](middle.md) of this topic, which goes deeper on Design by Contract, contract inheritance, when to strip vs keep assertions in production, and the relationship between assertions and exceptions.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) — the compiler-inserted cousin: automatic checks for memory bugs, where assertions are checks *you* write by hand.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md) — another automatic dynamic check (for data races); contrasts with your handwritten invariants.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md) — fuzzing: a violated assertion becomes a bug the fuzzer can catch even without a crash (assertions as the fuzzer's oracle).
- [Formal Methods & Verification](../../formal-methods-and-verification/) — where Design by Contract leads: *proving* pre/postconditions hold on all inputs, not just checking them when the code happens to run.
- [Testing](../../testing/) — assertions are the checks inside your tests too; the relationship between a test's `assert` and a contract's `assert`.
