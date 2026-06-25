# Evaluation Strategies (call-by-x) — Interview Questions

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)

---

## Introduction

These questions probe whether a candidate truly understands what happens when an argument is passed to a function — a topic that sits underneath every language's semantics and that an astonishing number of otherwise-strong engineers get wrong. The goal is not trivia. It is to discover whether the candidate can separate two orthogonal axes — *what* a parameter aliases (value / reference / sharing / move) and *when* an argument is evaluated (strict / non-strict, call-by-name / call-by-need) — and whether they can predict program behavior, termination, and performance from those choices.

A strong candidate refuses to call Python "pass by reference," reaches for the broken-swap test to prove it, distinguishes mutation from rebinding without hesitation, and can explain why call-by-name can terminate where call-by-value loops forever. At the senior end they connect the strategies to reduction order in the lambda calculus, treat move semantics as a first-class member of the call-by-x family, and reason about the ABI/performance reality. A weaker candidate gives surface answers ("just use a copy") and cannot say what their language actually does when they pass a list. The questions below progress from foundations to language-specific surfaces, then to traps where the textbook answer is wrong, then to design scenarios.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [Go](#go)
  - [Python](#python)
  - [C++](#c)
  - [Rust](#rust)
  - [Haskell](#haskell)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)

---

## Conceptual / Foundational

## Question 1

**What is an evaluation strategy, and what two independent questions does it answer?**

An evaluation strategy is the set of rules a language uses to evaluate arguments and bind them to a function's parameters. It answers two **independent** questions. First, *what* does the parameter alias — a copy of the value (call-by-value), the caller's variable itself (call-by-reference), a copy of a reference to a shared object (call-by-sharing), or transferred ownership (call-by-move)? Second, *when* is the argument evaluated — eagerly before the call (strict: call-by-value, call-by-reference) or lazily, deferred into a thunk (non-strict: call-by-name, call-by-need)? Conflating these axes is the root of most confusion. A precise candidate keeps them separate: "Python is call-by-sharing (the *what*) and strict (the *when*)."

## Question 2

**Distinguish call-by-value, call-by-reference, and call-by-sharing.**

Call-by-value gives the function a **copy** of the argument; nothing the function does can affect the caller's variable. Call-by-reference gives the function an **alias** for the caller's variable; assigning to the parameter (rebinding) changes the caller's variable. Call-by-sharing gives the function a **copy of a reference** to the same object: the function can **mutate** the shared object (visible to the caller) but **cannot rebind** the caller's variable (the rebind is local). The decisive difference between reference and sharing is the broken-swap test: under call-by-reference `swap(a, b)` swaps the caller's variables; under call-by-sharing it does nothing, because it only rebinds local parameters.

## Question 3

**Why is "pass the reference by value" the precise description of Python/Java/JS object semantics?**

Because the *value* that gets copied is the reference (the arrow), not the object (the box) and not the caller's variable slot. The function receives its own copy of an arrow pointing at the same object. Following the arrow to mutate the object is visible to the caller (shared object); overwriting the arrow itself (rebinding the parameter) is not (the copy is local). This single phrasing predicts every behavior: mutation leaks, rebinding doesn't, and the broken swap fails.

## Question 4

**Why does call-by-name sometimes terminate where call-by-value loops forever?**

Under call-by-value (strict / applicative order), every argument is fully evaluated *before* the call. If an argument diverges — an infinite loop or an exception — the call never happens, even if the function would have ignored that argument. Under call-by-name (non-strict / normal order), an unevaluated argument is substituted into the body and only evaluated *if and when the body demands it*. A function like `const(x, y) = x` that never references `y` never forces `y`, so `const(42, loop_forever())` returns `42` under call-by-name but hangs under call-by-value. Formally, the standardization theorem guarantees normal-order reduction reaches a normal form whenever one exists; applicative order has no such guarantee.

## Question 5

**What is the difference between call-by-name and call-by-need?**

Both are non-strict: the argument is deferred into a thunk and evaluated only on demand. The difference is memoization. **Call-by-name** re-evaluates the argument expression on **every** use — three references mean three evaluations (and three sets of side effects). **Call-by-need** evaluates the argument **at most once**, caches the result, and reuses it for every subsequent use. Call-by-need is therefore "call-by-name plus memoization," and it is exactly what "lazy evaluation" means in Haskell. Implementation-wise, call-by-need is normal-order reduction over a shared graph so a duplicated subterm is reduced once.

## Question 6

**What is a thunk?**

A thunk is a zero-argument closure that captures an unevaluated expression together with its environment. It is the mechanism by which non-strict evaluation is implemented: instead of passing a value, you pass a `() -> T` that, when called ("forced"), evaluates the expression. Scala's `=> T` by-name parameters, Haskell's lazy bindings, and a hand-rolled `Supplier<T>` in Java are all thunks. A bare thunk gives call-by-name (re-evaluates each force); wrapping it in a memoizer gives call-by-need.

## Question 7

**What is call-by-copy-restore, and when does it differ observably from call-by-reference?**

Call-by-copy-restore (value-result) copies the argument into the parameter at call time (like call-by-value), lets the function work on its local copy, and copies the parameter's final value **back into** the caller's variable on return. With no aliasing it is indistinguishable from call-by-reference. The difference appears under **aliasing**: if the same variable is passed to two copy-restore parameters, or a global is also touched, copy-restore writes back only at return, so "last write-back wins" (and the order may be unspecified), whereas call-by-reference writes through live and interleaves. Ada's `in out`, Fortran's argument convention, and some RPC stubs use copy-restore.

## Question 8

**How does strictness relate to the lambda calculus reduction orders?**

Call-by-value corresponds to **applicative order**: reduce the argument to a value before substituting it into the function body. Call-by-name corresponds to **normal order**: reduce the leftmost-outermost redex first, substituting the unreduced argument. The Church-Rosser (confluence) theorem says a term has at most one normal form regardless of reduction order; the standardization theorem says normal order finds it whenever it exists. Call-by-need is normal order implemented via shared graph reduction so each argument is reduced at most once.

## Question 9

**Why do immutable arguments make the value-vs-sharing distinction stop mattering?**

Call-by-sharing only causes surprises through **mutation** of the shared object. If the object cannot be mutated — a Python `tuple`/`str`/`int`, a Java `String`/`Integer`, a `frozenset` — there is nothing the callee can do that the caller will observe, because the only available operation is rebinding (which is local). So an immutable argument behaves identically whether you imagine it passed by value or by sharing. This is why Python integers *feel* call-by-value despite the uniform call-by-sharing mechanism, and why preferring immutable arguments sidesteps the entire confusion.

## Question 10

**What is call-by-move and why isn't it in the classic taxonomy?**

Call-by-move passes an argument by **transferring ownership** of its resources (heap buffer, file handle, lock) rather than copying them or aliasing them. C++ expresses it with rvalue references and `std::move`; Rust makes it the default and enforces single ownership statically. It's value-like — no aliasing, a single owner, the source left unusable — but at reference cost (only a handle is transferred). It isn't in the 1960s taxonomy because the lambda calculus has no notion of a transferable, exhaustible resource; move semantics arises from **affine/linear typing** layered on call-by-value, answering a question (cheap, alias-free transfer of owned resources) the classic strategies never asked.

---

## Language-Specific

### Java

## Question 11

**Is Java pass-by-value or pass-by-reference?**

Java is **always pass-by-value**, but for object types the value passed is a **reference** (call-by-sharing). Primitives (`int`, `double`, …) are copied directly. Object variables hold references, and that reference is copied into the parameter. So a method can mutate the object the reference points at (visible to the caller) but cannot make the caller's variable point at a different object. The proof is the broken swap: `void swap(Object a, Object b)` cannot swap the caller's variables, only its local references — which would be impossible if Java were pass-by-reference.

## Question 12

**`StringBuilder` vs `String` as a method argument — why do they behave differently?**

`StringBuilder` is mutable: a method that calls `sb.append("x")` mutates the shared object, and the caller sees it (call-by-sharing of a mutable object). `String` is immutable: a method cannot change the string; `s = s + "x"` only rebinds the local parameter to a new `String`, invisible to the caller. The passing rule is identical for both; the *mutability of the object* is what differs. This is the cleanest in-language demonstration that "behaves like by-value" is about immutability, not a different passing strategy.

### Go

## Question 13

**Go is call-by-value — so why does mutating a slice parameter affect the caller?**

Because a slice is a small **header** `{ptr, len, cap}` that is copied by value, but the `ptr` points at a **shared backing array**. Mutating an element (`xs[i] = ...`) writes through the shared array and is visible to the caller; reassigning the slice variable (`xs = ...`) re-points only the local copy and is not. Maps and channels are reference types (the copied value is a pointer to the same structure), so they share too. Arrays (`[N]T`) and structs, by contrast, copy their entire contents. So Go is uniformly call-by-value, but several built-in types are "headers over shared storage."

## Question 14

**What's the `append` gotcha with a slice parameter?**

`append(xs, v)` returns a slice that may or may not share the original backing array: if `xs` has spare capacity, `append` writes in place and the caller (sharing the array) sees the new element; if capacity is exhausted, `append` allocates a new array and the caller does **not** see it. So whether mutations via `append` are visible to the caller is **capacity-dependent and non-deterministic from the call site** — a classic source of intermittent data-loss bugs. The idiomatic fix is to return the new slice and have the caller reassign (`xs = f(xs)`).

### Python

## Question 15

**Walk through what happens when you pass a list to a function and the function does `lst.append(4)` then `lst = [1,2,3]`.**

The function receives a copy of the reference; `lst` and the caller's variable both point at the same list. `lst.append(4)` **mutates the shared list** — the caller sees `[..., 4]`. Then `lst = [1,2,3]` **rebinds the local parameter** to a brand-new list; the caller's variable still points at the original (now-mutated) list and does not see `[1,2,3]`. The two operations look similar but one reaches through the shared reference and the other replaces the local copy of the reference. This is call-by-sharing in one example.

## Question 16

**Explain the mutable-default-argument trap.**

`def f(x, acc=[]):` creates the default list **once**, when the function is defined, and **shares that same list** across every call that omits `acc`. So `f(1)` then `f(2)` accumulate into the same list (`[1]`, then `[1, 2]`). It is a direct consequence of call-by-sharing: the single default object is shared. The fix is the sentinel pattern: `def f(x, acc=None): acc = [] if acc is None else acc`, which creates a fresh list per call.

### C++

## Question 17

**Compare `void f(T)`, `void f(const T&)`, `void f(T&)`, and `void f(T&&)`.**

`f(T)` is call-by-value — it copies (or, for an rvalue argument, moves) into a local; the caller's object is isolated. `f(const T&)` is a read-only borrow — no copy, no mutation, the caller's object is aliased but unchanged; the workhorse for large read-only inputs. `f(T&)` is true call-by-reference — aliases the caller's lvalue and may mutate it. `f(T&&)` binds to rvalues and enables **call-by-move** — the function takes ownership and typically steals the argument's resources, leaving it valid-but-unspecified. The choice encodes the contract: copy, read-borrow, write-borrow, or take-ownership.

## Question 18

**Does `std::move` move anything?**

No. `std::move(x)` is a `static_cast<T&&>` — a compile-time relabeling of `x` as an rvalue so overload resolution selects the move constructor or move-assignment operator. The actual resource transfer happens inside those special members (swap the pointer, null the source). A type with no move constructor falls back to copy, so `std::move` *requests* a move but doesn't *guarantee* one. After `std::move(x)`, treat `x` as dead — its state is valid but unspecified.

### Rust

## Question 19

**What does "move by default" mean in Rust, and how does it prevent use-after-move?**

In Rust, passing a non-`Copy` value to a function (or assigning it) **moves** ownership into the callee; the original binding becomes invalid. Because Rust's ownership is **affine** (a value is usable at most once), the compiler tracks this and rejects any later use of the moved-from binding as a compile-time error ("borrow of moved value"). To pass without moving you take a **borrow**: `&T` (shared, read-only) or `&mut T` (exclusive, mutable). So Rust turns the call-by-sharing question — "did I just give away mutation rights?" — into an explicit, compiler-checked choice, eliminating use-after-move and double-free at compile time.

## Question 20

**`&T` vs `&mut T` vs `T` as a parameter — what contract does each express?**

`T` (by value) means "I take ownership; you can't use this afterward" — a sink. `&T` (shared borrow) means "I'll read it, not mutate it, and not keep it past the call" — and the compiler forbids mutation and enforces lifetimes. `&mut T` (exclusive borrow) means "I'll mutate it, and while I hold it no one else may access it" — the borrow checker guarantees no aliasing of the mutable reference. These three signatures encode the entire value/reference/move spectrum and are statically enforced, which is why Rust signatures are unusually self-documenting.

### Haskell

## Question 21

**What evaluation strategy does Haskell use, and what does it enable?**

Haskell uses **call-by-need** (lazy evaluation): arguments and bindings are deferred into thunks and forced at most once, on demand, only if needed. This enables infinite data structures (`take 5 [1..]`), the separation of producers from consumers, and the ability to ignore diverging subcomputations (`const 42 undefined` returns `42`). Evaluation proceeds to **weak head normal form** — just enough to expose the outermost constructor — so an infinite list is fine as long as you only consume a finite prefix.

## Question 22

**What is a space leak in a lazy language, and how do you fix it?**

A space leak is unbounded memory growth caused by accumulating **unforced thunks**. The canonical case is `foldl (+) 0 [1..n]`, which builds a chain of `n` deferred `+` operations before forcing any, consuming O(n) memory (and risking a stack overflow) for what should be a constant-space sum. The fix is to force evaluation as you go: use the strict `foldl'`, `seq`/`$!`, or `BangPatterns` to make the accumulator strict. Strictness analysis in GHC eliminates many thunks automatically, but accumulator leaks often need an explicit nudge.

---

## Tricky / Trap Questions

## Question 23

**A candidate says "Python is pass-by-reference." How do you show they're wrong in 30 seconds?**

The broken swap. `def swap(a, b): a, b = b, a` then `x, y = 1, 2; swap(x, y)`. If Python were pass-by-reference, `x` and `y` would now be `2` and `1`. They aren't — they're unchanged, because `swap` only rebound its local parameters. Yet passing a list and calling `lst.append(4)` *does* leak. The only model consistent with both facts is call-by-sharing: the reference is passed by value, so mutation leaks but rebinding doesn't.

## Question 24

**Under call-by-name, how many times does `print("hi")` run in `twice(print("hi"))` where `twice(x) = x; x`?**

Twice — once for each use of the parameter in the body. Under call-by-name the *expression* `print("hi")` is substituted and re-evaluated at every reference. Under call-by-need it would run **once** (memoized). Under call-by-value it would run **once**, before the call, regardless of how many times the body uses the parameter. And if the body never referenced the parameter, call-by-name and call-by-need would run it **zero** times while call-by-value would still run it once. Counting effect occurrences requires knowing the strategy.

## Question 25

**`f(x, x)` is called with `x = 0`, where `f(a, b) { a = 1; b = 2; return a; }`. What is `x` afterward under value, reference, and copy-restore?**

Under **call-by-value**, `a` and `b` are copies; `x` stays `0` and the function returns `1`. Under **call-by-reference**, `a` and `b` both alias `x`; `a = 1` sets `x` to 1, `b = 2` sets `x` to 2, and `return a` reads `x` = `2`; `x` ends at `2`. Under **call-by-copy-restore**, `a` and `b` are copies that write back at return; whichever copy is restored last wins, so `x` ends at `1` or `2` depending on (possibly unspecified) restore order. This single example separates the three strategies and is a classic exam trap.

## Question 26

**Why does `if (p != null & p.method())` sometimes throw a NullPointerException in Java?**

Because `&` is the **bitwise/eager** boolean AND, which is **strict** — it evaluates **both** operands before combining them. So even when `p` is null and `p != null` is false, `p.method()` is still evaluated, dereferencing null and throwing. The intended operator is `&&`, the **short-circuit** AND, which is **non-strict** in its right operand: it skips `p.method()` when the left side is false. This is a real-world instance of strict-vs-non-strict evaluation hiding inside an operator choice.

## Question 27

**Someone claims "passing by const-reference is always faster than by value." Push back.**

It's a good default but not a law. A `const&` **aliases** the caller's object, which can defeat compiler no-alias optimizations (the reason C has `restrict`), enable TOCTOU/re-entrancy bugs, and **dangle** if stored past the call. For small trivially-copyable types, by-value travels in registers and is *faster* than a reference plus an indirection and a cache miss. And for sink functions, taking by value and moving can beat a reference. Return-value optimization can make a returned-by-value result cost nothing. The professional answer is to choose based on size, mutability, lifetime, and a profiler — not a blanket rule.

## Question 28

**Is a shallow defensive copy enough to isolate a function from its caller?**

Only if the contained elements are immutable or themselves copied. A shallow copy (`list(xs)`, `dict(d)`) duplicates the outer container but the inner objects remain **shared** — mutating an inner object still leaks to the caller. To fully isolate when inner objects are mutable you need a **deep copy** (recursively copying), which is more expensive. Confusing shallow and deep copies is a frequent and subtle aliasing bug.

## Question 29

**After `std::move(v)` in C++, you read `v`. Is that undefined behavior?**

Not undefined behavior, but a likely **logic bug**. A moved-from standard-library object is left in a **valid but unspecified** state — you may safely destroy it or assign a new value to it, but reading its contents yields an unspecified value. So `auto y = std::move(v); use(v.size());` compiles and "works" but reads garbage-shaped state, and may pass tests yet fail under optimization or with a different standard-library implementation. Rust forbids the analogous code at compile time; C++ leaves it as a latent footgun. Treat moved-from objects as dead.

## Question 30

**Why might the same lazy program show different memory behavior in `-O0` vs `-O2` (or with/without strictness analysis)?**

Because strictness analysis — which the optimizer performs — can prove certain arguments are always forced and compile them as **eager** (no thunk, often in a register), eliminating allocation and the associated space-leak behavior. At a lower optimization level those proofs aren't applied, so thunks are allocated and a space leak that the optimizer would have erased becomes visible. The *observable value* is identical (laziness preserves semantics for needed arguments), but memory profile and performance can differ dramatically. This is why "lazy = slow" is too glib and why you profile at production optimization levels.

---

## Design Scenarios

## Question 31

**You're designing a function that stores its argument in a long-lived structure. How should it take the argument, and why?**

It should take ownership — by value in Rust (move), by value-then-`std::move` in C++ (the sink idiom), so the function can store the object without a defensive copy and without aliasing the caller. Taking a borrow/reference is wrong here: storing a borrowed reference past the call dangles (the caller may destroy the object). Taking by value also gives callers a clean choice — pass an lvalue to copy-in, or `std::move`/give up ownership of an rvalue to move-in — with one signature. The contract "I will keep this" maps directly to "give me ownership."

## Question 32

**A hot request handler is allocating far more than expected. The signature is `handle(Config cfg, ...)`. What do you suspect and how do you confirm and fix it?**

Suspect a per-call **deep copy** of `Config` because it's passed by value. Confirm by reading the CPU flame graph for `memcpy`/`__memmove` frames inside `handle`'s call path and the allocation profile for a copy-shaped allocation rate proportional to request rate. Fix by passing `const Config&` (a borrow) if the handler only reads it, eliminating the copy — verified by the disappearance of those frames and a drop in allocation rate. If the handler must store the config, take it by value and move it in once at the boundary rather than copying per request.

## Question 33

**Design an API where it is impossible for a caller to accidentally observe a mutation you make to their argument.**

Two robust options. (1) **Take by value / move ownership** so there is no aliasing with the caller at all — your mutations are on your own object (Rust move, C++ by-value). (2) **Accept an immutable type** (a `const&` to an immutable object, a Python `tuple`/`frozenset`, a Java `String`/record) so the type system forbids mutation. A weaker option is a **defensive copy at the boundary**, but that costs allocation and only a deep copy fully isolates mutable inner objects. The strongest designs encode the guarantee in the **type/signature** so the compiler enforces it for every caller, rather than relying on documentation.

## Question 34

**When would you deliberately choose laziness (call-by-need / thunks) in a production system, and what would you watch for?**

Choose it when work may be skipped or streamed: lazy logging (don't format a message unless the level is enabled), deferred-default computation (compute a fallback only on cache miss), demand-driven pipelines and infinite/streaming sequences where the consumer may stop early, and dependency graphs computed on demand. Watch for: **space leaks** from accumulated unforced thunks (force accumulators), **allocation churn / GC pressure** from per-call thunk/closure allocation on hot paths, **unpredictable timing of side effects and exceptions** (they fire when forced, possibly far from where written or never), and **thunks pinning large captured objects** in memory. Default to strict; reach for laziness where the skipped/streamed work clearly outweighs these costs, and verify with an allocation profiler.

## Question 35

**A teammate proposes adding `out`/`ref` parameters to return multiple values. Critique this in a language with cheap tuples (Go, Rust, Python).**

Prefer returning a tuple/struct over `out`/`ref` parameters. Out-parameters reconstruct call-by-reference to work around languages that historically lacked cheap multiple returns; in languages with tuples and destructuring they add aliasing, obscure the data flow (the call site can't tell which arguments are mutated), and complicate reasoning and testing. Returning by value is clearer, composes better, is friendly to immutability, and — thanks to RVO/sret/escape analysis — usually costs nothing extra. Reserve `out`/`ref` for genuine in-place mutation of large existing buffers on measured hot paths, where avoiding an allocation is the explicit goal.
