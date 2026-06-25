# Evaluation Order & Sequencing — Interview Questions

> **Topic:** [Evaluation Order & Sequencing](README.md)

---

## Introduction

These questions probe whether a candidate can separate two ideas that look identical to most programmers — *operator precedence* (how an expression is grouped) and *evaluation order* (the order its sub-expressions actually run) — and whether they can reason precisely about the consequences when side effects enter the picture. The strongest signal is a candidate who answers in the right vocabulary: who says "unsequenced" rather than "random," who distinguishes *unspecified* from *undefined*, who names the standard era before pronouncing a verdict on `a[i] = i++`, and who can connect single-thread sequencing to the concurrency memory model without hand-waving. Weaker candidates either conflate precedence with order, treat undefined behavior as merely "garbage values," or assume every language evaluates left-to-right.

The questions move from conceptual foundations, through language-specific surfaces (C/C++ sequence points and UB, Java/C# defined left-to-right, Go, Python, Rust), into trap questions where the textbook intuition is wrong, and finish with design scenarios that reveal whether the candidate has actually shipped and debugged real code.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
  - [C / C++ — Sequence Points & UB](#c--c--sequence-points--ub)
  - [Java & C# — Defined Left-to-Right](#java--c--defined-left-to-right)
  - [Go](#go)
  - [Python](#python)
  - [Rust](#rust)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)
- [Cheat Sheet](#cheat-sheet)

---

## Conceptual

## Question 1

**What is the difference between operator precedence and evaluation order?**

Precedence (together with associativity) decides how an expression is *grouped* — the shape of its parse tree. `a + b * c` parses as `a + (b * c)` because `*` has higher precedence than `+`. Evaluation order decides *which sub-expression is computed first* — the order the tree is walked. These are independent: the same tree can be walked in many orders. In `a + b * c`, precedence guarantees the multiply binds tighter, but it says nothing about whether `a`, `b`, or `c` is read first. For pure operands the order is unobservable; it only becomes visible when a sub-expression has a side effect or returns a different value each call. Confusing the two is the single most common conceptual error on this topic.

## Question 2

**When does evaluation order actually matter?**

Only when a sub-expression is *observable* — it has a side effect (mutation, I/O, throwing) or is impure (returns different values on different calls). `2 + 3` is `5` regardless of order. But `f() + g()` where both print, or `a[i] = i++` where `i` is both read and written, exposes order. The practical corollary: if you don't want order to matter, don't put side effects where order is unspecified — hoist them into separate statements.

## Question 3

**Distinguish unspecified behavior, implementation-defined behavior, and undefined behavior.**

*Unspecified*: the standard allows a set of behaviors and the implementation picks one without documenting it — e.g. the order of function-argument evaluation in C/C++. *Implementation-defined*: like unspecified, but the implementation must document its choice — e.g. the size of `int`. *Undefined (UB)*: the standard imposes no requirements at all; the program is meaningless and the optimizer may assume it never happens — e.g. `i = i++` in C. The crucial practical difference: unspecified gives you a *legal but unknown* result; undefined gives you *no result you can reason about*, and the compiler may delete surrounding code.

## Question 4

**Do short-circuit operators guarantee evaluation order? In which languages?**

Yes, in *every* mainstream language. `&&` evaluates its left operand first and skips the right if the left is false; `||` skips the right if the left is true; `?:` evaluates the condition first and runs only the selected branch; `??` evaluates the left first and the right only if the left is null. This left-to-right guarantee is *the* portable ordering tool — it's why `p != NULL && p->field` is safe. Notably, these guarantees hold even in C and C++, where ordinary function-argument order is unspecified.

## Question 5

**Why do languages like C deliberately leave evaluation order unspecified?**

To give the compiler freedom to schedule operations optimally for the target — register allocation, instruction scheduling, matching the calling convention's natural push order. The as-if rule already lets the compiler reorder anything unobservable; leaving argument order explicitly unspecified makes that freedom standard-blessed and portable across implementations. The cost is that order-dependent code is non-portable, and combined with unsequenced modification it becomes undefined.

## Question 6

**How does single-thread sequencing relate to the concurrency memory model?**

The single-thread relation *sequenced-before* is exactly per-thread program order, and it is the base case of the cross-thread *happens-before* relation: `A happens-before B` if A is sequenced-before B in the same thread, or A synchronizes-with B across threads (release/acquire, lock/unlock, channel send/receive, thread start/join), or transitively. Without a synchronization edge, one thread's program order tells another thread nothing — which is why "it's sequential in the source" is never a valid concurrency-correctness argument. A data race is exactly two conflicting accesses with no happens-before edge between them.

## Question 7

**What is the as-if rule, and what reorderings does it permit?**

The compiler may transform a program in any way that preserves *observable behavior* — the sequence of I/O, accesses to `volatile` objects, and (since C++11) atomic/synchronization ordering. It may reorder independent operations, eliminate redundant or dead loads/stores, fuse, vectorize, hoist loop-invariant code, and reassociate integer arithmetic. It may *not* reorder observable events relative to each other, and it may not reassociate floating-point arithmetic (which isn't associative) without an opt-in like `-ffast-math`. Within one thread the reorderings are invisible; across threads the same reorderings become observable and remain legal unless you established happens-before.

---

## Language-Specific

### C / C++ — Sequence Points & UB

## Question 8

**Define a sequence point. Where are they in C?**

A sequence point is a position in execution where all side effects of prior evaluations are complete and none of the subsequent evaluations' side effects have started. The classic C rule: between two sequence points, a scalar object may be modified at most once, and its prior value may be read only to determine the value to be stored. Sequence points occur at: the end of a full expression (the `;`); after the left operand of `&&`, `||`, `?:`, and the comma *operator*; and after all function arguments are evaluated but before the call (function-call entry).

## Question 9

**Explain precisely why `a[i] = i++;` is undefined in C.**

The full expression both reads `i` — to compute the address `&a[i]` on the left side — and writes `i` — via the `i++` on the right side — with no sequence point between the two. The read of `i` is *not* "to determine the value to be stored into `i`" (it's used to index `a`), and `i` is simultaneously modified, violating the sequence-point rule. Therefore the behavior is undefined: the index might use the old `i`, the new `i`, or the program may be miscompiled. Note the era: this is UB in C and in C++14, but **C++17 sequences the assignment's right side before its left side, making `a[i] = i++` well-defined in C++17** (it uses the old `i`).

## Question 10

**What is the C++11 sequenced-before / unsequenced / indeterminately-sequenced trichotomy?**

For any two evaluations: *sequenced-before* means one fully completes (value computation and side effects) before the other begins — total order, safe (e.g. left of `&&`). *Unsequenced* means no ordering and possible overlap; if both access the same scalar and at least one writes, it's undefined behavior (e.g. the two `i++` in `f(i++, i++)`). *Indeterminately-sequenced* means one is sequenced-before the other but which is unspecified, with no overlap — merely *unspecified*, not undefined (e.g. two whole function arguments relative to each other). The key split: unsequenced can overlap and conflict (UB); indeterminately-sequenced cannot overlap (just unknown order).

## Question 11

**Is the order of function-argument evaluation specified in C/C++? What do real compilers do?**

No — it is *unspecified*; the compiler may pick any order. In practice, GCC and Clang on x86-64 frequently evaluate arguments right-to-left, and MSVC has also commonly done so for cdecl, but the standard requires nothing and you must never depend on it. Even C++17, which tightened several rules, deliberately left function-argument order unspecified. So `printf("%d %d", i++, i++)` is doubly bad: the order is unspecified *and* the two unsequenced modifications of `i` make it undefined.

## Question 12

**What did C++17 change about sequencing?**

C++17 added sequenced-before edges that previously didn't exist: in an assignment `E1 = E2`, the right operand `E2` is now sequenced-before the left `E1` (so `a[i] = i++` becomes defined, using the old `i`); the operands of `<<`, `>>`, `[]`, `.`, `->*` and several others are now evaluated left-to-right (fixing the old `cout << f() << g()` argument-order surprise); and postfix-expression-and-argument sequencing for calls was clarified. Crucially, C++17 did **not** fix function-argument order — it remains unspecified — so `f(i++, i++)` is still undefined.

## Question 13

**Does the comma operator impose ordering? How does it differ from the comma separator?**

The comma *operator* `(a, b)` fully evaluates `a` (sequenced-before), discards its value, evaluates `b`, and yields `b` — so it *does* impose left-to-right order. The comma *separator* in a function call `f(a, b)` is not the comma operator; it imposes **no** ordering between `a` and `b` (they are indeterminately-sequenced). Same character, opposite guarantees — a frequent source of confusion.

## Question 14

**In what order do C++ class members initialize?**

In *declaration* order — the order members appear in the class definition — *not* the order they appear in the constructor's initializer list. If a member's initializer reads another member that is declared later, it reads an uninitialized object (UB / garbage). Compilers warn with `-Wreorder`. The discipline: write the initializer list in the same order as the declarations, and never let an earlier-declared member's initializer depend on a later-declared one.

## Question 15

**What is the static initialization order fiasco, and how do you fix it?**

Within a single translation unit, statics with dynamic initialization are constructed top-to-bottom. *Across* translation units, the order is unspecified. If one TU's static constructor uses another TU's static during its own construction, it may run before that other static exists — undefined behavior that appears or vanishes depending on link order. The fix is **construct-on-first-use**: replace the eager global with a function holding a function-local static (`T& get() { static T x; return x; }`), so initialization is deferred to first access (and thread-safe since C++11), making the dependency, not the link order, drive the sequence.

## Question 16

**What does `volatile` guarantee about ordering in C/C++ — and what does it not?**

It guarantees that each access actually occurs at the abstract-machine level (no caching the value in a register, no eliding repeated accesses) and that `volatile` accesses are not reordered relative to *other* `volatile` accesses. It does **not** provide atomicity, does **not** establish any inter-thread happens-before relationship, does **not** order `volatile` accesses relative to *non-volatile* ones, and emits **no** CPU memory fence. Its only correct uses are memory-mapped hardware registers and signal-handler flags. For cross-thread ordering, use `std::atomic` or a mutex. (Java's `volatile` is a different keyword with acquire/release semantics — don't transfer the intuition.)

### Java & C# — Defined Left-to-Right

## Question 17

**Does Java guarantee evaluation order? What order?**

Yes — the Java Language Specification guarantees strict left-to-right evaluation of operands and of method arguments. The left operand of a binary operator is fully evaluated (including side effects) before the right; arguments are evaluated left-to-right before the call. This is one of Java's deliberate design choices: it trades a little optimizer freedom for fully predictable, portable behavior. C# follows the same strict left-to-right model.

## Question 18

**In Java, what does `i = i++;` do, and why?**

It leaves `i` *unchanged*. Evaluation: the right-hand side `i++` is evaluated first — it reads `i`'s current value (say 0) as the expression's result *and* increments `i` to 1 as a side effect. Then the assignment stores the saved result (0) back into `i`, overwriting the 1. Net effect: `i == 0`. This is fully defined in Java precisely because the order is specified — unlike C/C++, where the same syntax is undefined behavior. It's a great question to test whether a candidate understands that "specified order" turns an unpredictable expression into a predictable (if useless) one.

## Question 19

**Is `System.out.println(f() + g())` order-deterministic in Java if both print?**

Yes. Java evaluates left-to-right, so `f()` runs before `g()`, deterministically, on every JVM. This contrasts sharply with the C version, where the print order is unspecified. The lesson: identical-looking source has a guaranteed order in Java and an unspecified one in C.

### Go

## Question 20

**What does Go specify about evaluation order?**

Go's spec mandates that, within a single goroutine, the effects of statements execute in program order, and operands of expressions, assignments, and return statements are evaluated left-to-right in a well-defined way for the *function calls, method calls, and communication operations* involved. Go pins more order than C does, but there are subtleties — for example, in a multiple assignment the operands and index expressions on the left and the right are evaluated in a specified order before the assignments happen. Across goroutines, ordering is governed by Go's memory model (happens-before via channel operations, `sync` primitives), not by program order alone. Go also has no `volatile`; you use channels or `sync/atomic`.

## Question 21

**In Go, what does multiple assignment like `a, b = b, a` guarantee?**

Go evaluates the right-hand side operands first (left-to-right), then performs the assignments. So `a, b = b, a` swaps cleanly: both `b` and `a` on the right are read before either assignment occurs. More generally, in `x, y = f(), g()`, the operands are evaluated in the specified order and then assigned, which avoids the aliasing traps you'd hit in a language without this guarantee.

### Python

## Question 22

**What evaluation order does Python guarantee, and where are the documented exceptions?**

Python evaluates expressions left-to-right in general — operands, function arguments, and the elements of list/dict/set displays. The notable documented subtlety is *assignment*: in `target = expression`, the right-hand side is evaluated before the target is bound, and in augmented or multiple-target assignments the order of evaluating the expression versus the target sub-expressions follows specific documented rules (e.g. for `a[i] = b`, the right side `b` is evaluated, then the target's subscript). Dictionary displays evaluate each key before its value, left-to-right. Python has no undefined behavior here — the order is defined, just occasionally non-obvious for assignment targets.

## Question 23

**In Python, what does `a[i], i = i, i + 1` do step by step?**

Python evaluates the right-hand side tuple first: `(i, i + 1)` using the current `i` (say 0) gives `(0, 1)`. Then it assigns to the targets left-to-right: `a[i] = 0` using the *current* `i` (still 0, because targets are bound after the RHS is fully evaluated) sets `a[0] = 0`, then `i = 1`. The guaranteed order makes this fully predictable — the same shape in C would be undefined. It's a clean demonstration of why pinned order eliminates a whole bug class.

### Rust

## Question 24

**How does Rust handle evaluation order and the `i = i++`-style trap?**

Rust has well-defined, left-to-right evaluation order, so there is no unsequenced-modification undefined behavior of the C kind. Notably, Rust has no `++` operator at all (you write `i += 1`), which structurally removes the `i++` family of traps. Combined with the borrow checker — which forbids aliasing a mutable reference with any other access in safe code — Rust makes the classic "read and write the same object in one expression" data-race and sequencing hazards either impossible or well-defined. Cross-thread ordering uses `std::sync::atomic` with explicit `Ordering` values, mirroring the C++ memory model but without the `volatile` confusion.

## Question 25

**Does Rust's borrow checker relate to evaluation order?**

Indirectly but importantly. The borrow checker enforces that you cannot have a mutable borrow of a value simultaneously with any other borrow of it. This statically rules out many expressions that, in C, would be unsequenced read+write of the same object — you simply can't write code that aliases a mutating access with a reading one in safe Rust. So where C relies on programmer discipline (and the optimizer punishes its absence with UB), Rust pushes the equivalent guarantee into the type system at compile time.

---

## Tricky / Trap

## Question 26

**"`a + b * c` multiplies first, so `b` and `c` are evaluated before `a`." True or false?**

False — and this is the central trap of the topic. Precedence makes `b * c` *group* before adding `a`, but grouping is not timing. In a left-to-right language, `a` is in fact evaluated *first*. Precedence shapes the tree; evaluation order walks it. A candidate who falls for this hasn't internalized the precedence/order distinction.

## Question 27

**Is `f(i++, i++)` undefined in C++17?**

Yes, still undefined. C++17 did tighten many rules, but it left function-argument order unspecified, and the two `i++` are *unsequenced* relative to each other while both modifying `i` — a conflict that is undefined regardless of order. The trap is that candidates hear "C++17 fixed sequencing" and over-generalize. C++17 fixed *assignment* (RHS-before-LHS) and some operators, not function arguments.

## Question 28

**Does `volatile` make `volatile int x; x++;` thread-safe?**

No. `volatile` provides no atomicity. `x++` is still a read-modify-write of three machine steps, and two threads can lose an update. `volatile` also provides no inter-thread ordering and emits no fence. You need `std::atomic<int>` with `fetch_add`, or a lock. This trap catches engineers who carry the (different) Java `volatile` intuition into C/C++.

## Question 29

**Will the compiler always preserve the left-to-right order of two side-effect-free function calls in C?**

It may evaluate them in any order, and you cannot observe the difference — that's conforming. The candidate should recognize that "side-effect-free" is precisely what makes the reordering invisible and legal under the as-if rule. If the calls *had* observable side effects, the *order* would still be unspecified in C (just now observable, hence non-portable).

## Question 30

**Is `(a, b)` in `foo(a, b)` the comma operator?**

No — it's the argument separator, which imposes no ordering between `a` and `b`. The comma *operator* only appears where a single expression is expected, e.g. `for (i = 0, j = n; ...)` or `x = (a, b)`. Mixing these up leads to wrong conclusions about ordering. A sharp candidate notes that the separator gives indeterminately-sequenced arguments, while the operator gives a guaranteed left-to-right sequenced-before.

## Question 31

**Given `struct S { int a; int b; S(): b(1), a(b) {} };`, what is `a`?**

Undefined / garbage. Members initialize in *declaration* order: `a` (declared first) is initialized before `b`, so `a(b)` reads `b` while `b` is still uninitialized. The initializer list says `b(1)` first, but that order is ignored — declaration order wins. The fix is to not have `a` depend on `b`, or reorder the declarations so the dependency is satisfiable. Catches candidates who think the initializer list controls order.

## Question 32

**Does "undefined behavior" just mean the value of `i++ + i++` is unpredictable?**

No — and this is the most important trap for senior candidates. UB means the compiler may assume that code is unreachable and optimize accordingly, potentially deleting surrounding checks (including null or bounds checks) and producing miscompilations that look like arithmetic stopped working. The correct mental model is that UB voids the contract entirely; reasoning about "the value" is meaningless. A candidate who treats UB as merely "a random number" hasn't worked with modern optimizers.

## Question 33

**Can floating-point summation order be reordered by the compiler for speed?**

Not without an explicit opt-in. Floating-point addition is not associative, so `(a+b)+c` can differ from `a+(b+c)` — the order is *observable*, so the as-if rule forbids the compiler from reordering it. Only flags like `-ffast-math` / `-funsafe-math-optimizations` permit it, at the cost of reproducibility (and they can break Kahan summation and NaN/inf handling). Integer reassociation, by contrast, is generally safe and the compiler does it freely.

---

## Design

## Question 34

**You inherit a 200k-line C codebase. How do you find and prevent evaluation-order/sequencing UB across the team?**

Detection: enable `-Wsequence-point` (GCC) / `-Wunsequenced` (Clang) and promote to `-Werror`; run a clang-tidy ruleset; run UBSan in CI to catch some cases at runtime; grep/AST-search for side-effecting argument lists and multiple-expansion macros. Prevention (structural): a house style of one observable side effect per statement, no read-and-write of a scalar in one expression, FFI/vararg/macro arguments bound to named temporaries first, and a code-review checklist item. Process: audit for dormant UB *before* every compiler upgrade, since upgrades often begin exploiting previously-benign UB. The strategy should make the bug class structurally impossible, not merely discouraged.

## Question 35

**Design an API or coding convention that makes evaluation order irrelevant to your callers.**

Make side effects explicit and singular: functions take already-evaluated values, not lazily-side-effecting expressions; APIs avoid signatures that invite `f(next(), next())`. Internally, hoist every observable side effect to its own statement so neither the language's unspecified order nor the optimizer's freedom can change behavior. For ordering you genuinely need (e.g. publication across threads), make the synchronization construct *visible in the code* — an atomic with explicit memory order or a mutex — rather than relying on implicit `volatile` or program order. The principle: when order can't be observed, no platform, compiler, or standard-era difference can hurt you.

## Question 36

**Your service is polyglot — C++ core, Go services, a Python tooling layer, JS frontend. How do you reason about evaluation order consistently across the stack?**

Recognize the buckets: Java/C#/JS/Python/Rust pin left-to-right (with Python's documented assignment subtleties and JS literals/arguments left-to-right); Go pins most order via its spec and governs cross-goroutine order through its memory model; C++ leaves function-argument order unspecified and has the `a[i]=i++` UB family (era-dependent). Establish one cross-language rule that holds everywhere — *no side-effecting expression as a function argument; bind to a temporary first* — so engineers don't have to remember per-language rules at call sites. At FFI boundaries specifically, never pass side-effecting arguments directly, because argument evaluation happens in the host language's (possibly unspecified) order before crossing the ABI. Pin floating-point reproducibility explicitly wherever numerical results cross language boundaries.

## Question 37

**When would you intentionally rely on evaluation order, and how do you make that safe?**

Legitimately: short-circuit ordering for guarded dereferences (`p && p->x`) and cheap-before-expensive checks (`quickCheck() && expensiveCheck()`); these are guaranteed in every language and are the *intended* use of ordering. To make reliance safe: restrict it to the constructs that *guarantee* order (`&&`, `||`, `?:`, `??`, the comma operator), keep the safe/cheap operand on the left, document the intent in a comment, and never rely on the unspecified order of function arguments. The discipline is "rely on order only where the standard promises it, and make the reliance obvious to the next reader."

---

## Cheat Sheet

```
PRECEDENCE = grouping (tree shape) ; ORDER = timing (tree walk). Independent.

ORDER BY LANGUAGE
  Left-to-right (guaranteed): Java, C#, JavaScript, Python*, Rust
  Specified (with rules):     Go (cross-goroutine: memory model, not program order)
  Unspecified args:           C, C++  (often right-to-left on x86-64; never depend on it)

C/C++ HAZARDS
  sequence-point rule: modify a scalar <=1x per full expr; read only to compute stored value
  a[i] = i++   -> UB in C and C++14 ; DEFINED in C++17 (RHS sequenced before LHS)
  f(i++, i++)  -> UB in ALL standards (unsequenced conflicting writes); args still unspecified
  member init  -> DECLARATION order, not initializer-list order
  static init  -> cross-TU order UNSPECIFIED -> fiasco -> construct-on-first-use
  volatile     -> no atomicity, no inter-thread order, no fence; HW/signals only

i = i++  :  C/C++14 = UB ;  Java = defined, stays unchanged
ALWAYS ORDERED everywhere: &&  ||  ?:  ??  comma-OPERATOR (not the arg separator)
UB is NOT "a random value" -> license to assume-unreachable and delete code.
FP add is NOT associative -> order is observable -> no reorder without -ffast-math.
sequenced-before = program order = base case of happens-before (concurrency).
```
