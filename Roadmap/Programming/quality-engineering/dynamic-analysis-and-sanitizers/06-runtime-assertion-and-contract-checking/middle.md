# Runtime Assertions & Contracts — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Runtime Assertions & Contracts
> *The junior page said "assert your assumptions." This page formalizes the discipline underneath: who owes what to whom (Design by Contract), which checks survive into release, the one decision that separates an assertion from a thrown error, and why asserting on attacker input is a denial-of-service bug you wrote yourself.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Design by Contract: Supplier, Client, and Three Clauses](#core-concept-1--design-by-contract-supplier-client-and-three-clauses)
5. [Core Concept 2 — Assert vs Error Handling: the Decision Table](#core-concept-2--assert-vs-error-handling-the-decision-table)
6. [Core Concept 3 — Debug vs Release, and Assertions That Refuse to Die](#core-concept-3--debug-vs-release-and-assertions-that-refuse-to-die)
7. [Core Concept 4 — Static vs Runtime: Push Checks to Compile Time](#core-concept-4--static-vs-runtime-push-checks-to-compile-time)
8. [Core Concept 5 — A Language Tour of Assertions](#core-concept-5--a-language-tour-of-assertions)
9. [Core Concept 6 — What Makes an Assertion Good](#core-concept-6--what-makes-an-assertion-good)
10. [Core Concept 7 — Contracts as the Connective Tissue](#core-concept-7--contracts-as-the-connective-tissue)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Which invariants do I check, where, and with what — so that bugs die at their source instead of three frames later?**

At the junior level an assertion is "a check that crashes if something is false." That model is correct but incomplete — it can't yet tell you *which* checks belong in an `assert`, *which* belong in an `if`/`return err`, and *which* must keep running after you ship. Get those wrong and you either (a) ship asserts that get compiled away exactly when you need them, or (b) write an `assert(user_input != NULL)` that lets any client crash your service on demand.

This page gives you the framework professionals actually use. **Design by Contract** (Bertrand Meyer, Eiffel) names *who* is responsible for each broken assumption. A short **decision table** tells you assert-or-error in one glance. The **debug/release** distinction explains why C's `assert` is a trap for security-critical code and what `CHECK`/`DCHECK` exist to fix. Then a tour across C, C++, Rust, Go, Java, and Python shows the same idea wearing six different syntaxes. The throughline: an assertion is an *executable specification* of a programmer-error state — and the value is entirely in drawing that line correctly.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state what an assertion does and why "fail fast" beats "limp on."
- **Required:** You can write and run code in at least one of C/C++, Rust, Go, Java, or Python.
- **Helpful:** You've debugged a `NullPointerException` / segfault whose *cause* was many frames above the *crash*.
- **Helpful:** A rough sense of pre/postconditions from a method's documentation ("returns non-null", "x must be ≥ 0").

---

## Glossary

| Term | Meaning |
|---|---|
| **Precondition** | What must be true *on entry* to a routine. The **caller's** obligation. |
| **Postcondition** | What the routine guarantees *on exit*, given its preconditions held. The **supplier's** obligation. |
| **Class invariant** | A property that holds for every object of a type *between* public calls (e.g., `0 ≤ size ≤ capacity`). |
| **Loop invariant** | A property true before and after every loop iteration; proves the loop *correct*. |
| **Loop variant** | A non-negative integer expression that strictly decreases each iteration; proves the loop *terminates*. |
| **Assertion** | An executable claim that a condition is true at a point in the program; a false assertion signals a **bug**. |
| **Contract** | The pre/post/invariant triple that specifies *and* checks a routine's interface. |
| **`NDEBUG`** | C/C++ macro that, when defined, compiles `assert()` to nothing (the standard "release" switch). |
| **`CHECK` / `DCHECK`** | An "always-on" assertion vs a debug-only one (Chromium/glog naming). |
| **Fail-fast** | Policy of aborting at the first sign of a broken invariant rather than continuing in a corrupt state. |

---

## Core Concept 1 — Design by Contract: Supplier, Client, and Three Clauses

**Design by Contract (DbC)** is Bertrand Meyer's framing (built into the Eiffel language): a routine and its caller form a *business contract*, with obligations and benefits on both sides.

- The **client** (caller) promises to meet the **precondition**. In return it gets the postcondition for free.
- The **supplier** (the routine) promises the **postcondition** *provided* the precondition held. In return it may *assume* the precondition without re-checking it.

This division answers a question raw assertions can't: **whose bug is it?**

> **Key insight:** A *failed precondition* is the **caller's** bug — the routine was used wrong. A *failed postcondition or invariant* is the **supplier's** bug — the routine is implemented wrong. The contract doesn't just check the interface; it *assigns blame*, which is exactly the information you need at 3 a.m.

A third clause, the **class invariant**, holds between every public operation: an object is always in a valid state when no method is mid-execution.

```cpp
// A bounded stack with an explicit contract.
class Stack {
  int data[CAP];
  int n = 0;                       // number of elements
  bool invariant() const { return 0 <= n && n <= CAP; }  // class invariant

public:
  void push(int x) {
    assert(n < CAP);               // PRECONDITION: caller must not overflow us
    assert(invariant());           // (invariant holds on entry)
    data[n++] = x;
    assert(n <= CAP && data[n-1] == x);  // POSTCONDITION: supplier's guarantee
    assert(invariant());           // (invariant restored on exit)
  }
  int size() const { return n; }
};
```

The precondition `n < CAP` is the *caller's* job — if it trips, fix the call site. The postcondition and `invariant()` are the *implementation's* job — if they trip, fix `push`.

**Loops get the same treatment.** A *loop invariant* states what stays true across iterations; a *loop variant* is a value that strictly decreases toward zero and proves the loop ends.

```c
// Binary search: invariant = "if key exists, it's in [lo, hi]".
int bsearch(const int *a, int n, int key) {
    int lo = 0, hi = n;
    while (lo < hi) {
        assert(0 <= lo && lo <= hi && hi <= n);  // loop INVARIANT
        int prev_width = hi - lo;                 // loop VARIANT (must shrink)
        int mid = lo + (hi - lo) / 2;
        if (a[mid] == key) return mid;
        else if (a[mid] < key) lo = mid + 1;
        else hi = mid;
        assert(hi - lo < prev_width);             // VARIANT strictly decreased → terminates
    }
    return -1;
}
```

The variant check is what catches the classic infinite loop where a buggy update (`lo = mid` instead of `lo = mid + 1`) silently fails to make progress.

---

## Core Concept 2 — Assert vs Error Handling: the Decision Table

This is the single most consequential decision in the topic, and it has a clean rule:

> **Key insight:** Use an **assertion** for states that are *impossible if the program is correct* (broken invariants, "can't happen" branches, internal consistency). Use **error handling** (return value / exception / `Result`) for *expected* runtime conditions the program must survive (bad input, I/O failure, resource exhaustion). Assertions catch **your** bugs; error handling copes with **the world**.

| Situation | Mechanism | Why |
|---|---|---|
| Broken class/loop invariant | **assert** | If it fails, the code is wrong, not the input. |
| "Impossible" `default:` / `else` branch | **assert / `unreachable`** | A new enum case slipping through is a bug to surface loudly. |
| Internal consistency (`a == recompute(a)`) | **assert** | Detects logic corruption near its source. |
| Malformed user/network/file input | **return error / exception** | Expected; the program must handle it gracefully. |
| File not found, socket reset, disk full | **return error / exception** | The world failing is not a bug in your code. |
| Allocation failure, timeout | **return error / exception** | A normal (if rare) runtime outcome. |
| **Untrusted external input** | **NEVER assert — validate & reject** | See below. |

The last row is a security rule, not a style rule:

> **Key insight:** **Never assert on untrusted input.** An assertion aborts the process; if an attacker controls the asserted value, they can crash your service *on demand* — a self-inflicted **denial-of-service**. Untrusted data must be *validated* and *rejected* (return 400, drop the packet), never *asserted*. Assertions guard the boundary *inside* your code, after input has already been validated at the edge.

```c
// WRONG — a remote client can kill the server by sending len > MAX.
void handle_packet(const uint8_t *buf, size_t len) {
    assert(len <= MAX_PACKET);     // attacker controls len → DoS on demand
    process(buf, len);
}

// RIGHT — validate untrusted input; reject, don't abort.
int handle_packet(const uint8_t *buf, size_t len) {
    if (len > MAX_PACKET) return ERR_TOO_LARGE;   // expected, handled
    process(buf, len);                            // now len is trusted
    return OK;
}
```

The mental test: *"Can this ever be false if every line of code I wrote is correct, no matter what data arrives?"* If **yes** (only a bug makes it false) → assert. If **no** (bad data alone can make it false) → handle the error.

---

## Core Concept 3 — Debug vs Release, and Assertions That Refuse to Die

In C and C++, the standard `assert` macro is **disabled in release builds**: defining `NDEBUG` (which `-DNDEBUG`, and most "Release" CMake/compiler presets, do) makes `assert(expr)` expand to *nothing*. The expression is not evaluated at all.

This creates two traps.

**Trap 1 — side effects vanish.** If you put work *inside* an assertion, that work disappears in release:

```c
assert(advance_cursor() == OK);   // BUG: in release, cursor is never advanced!
```

In a debug build it works; in production the cursor never moves and the program misbehaves only when optimized. **Rule: assertions must be pure — no side effects, ever.** Compute first, assert the result:

```c
int rc = advance_cursor();
assert(rc == OK);                 // safe: advance happened regardless of NDEBUG
(void)rc;                         // silence "unused in release" warning
```

**Trap 2 — security-critical invariants get stripped.** Some checks must hold *even in production* — a bounds check before indexing, a "this pointer is non-null before we dereference attacker-reachable code." A plain `assert` for these is a footgun: optimization removes exactly the guard you needed.

The fix is an **always-on assertion** that ignores `NDEBUG`. The convention, popularized by Chromium and glog, is two tiers:

- **`CHECK(cond)`** — *always* compiled in, debug **and** release. For invariants whose violation is unrecoverable or security-relevant.
- **`DCHECK(cond)`** — debug-only (the `D` = debug), like classic `assert`. For hot-path checks too expensive to keep in release.

```cpp
// Chromium / glog style.
CHECK(index < size);    // survives release — a bad index here is memory-unsafe
DCHECK(IsSorted(v));    // debug-only — expensive, and a logic check, not a safety one

// Roll your own "survives release" check in plain C:
#define VERIFY(cond) do { if (!(cond)) __builtin_trap(); } while (0)
VERIFY(ptr != NULL);    // aborts in ANY build; not affected by NDEBUG
```

The Linux kernel uses the same idea with different names: **`BUG_ON(cond)`** aborts (panics the kernel) when an invariant is violated, and **`WARN_ON(cond)`** logs a stack trace but *keeps running* — a "loud but survivable" assertion for cases where a crash would be worse than the bug.

> **Key insight:** "Assertion" splits into two policies. **Debug-only** (`assert`/`DCHECK`) is a developer-time sanity net you can afford to strip for speed. **Always-on** (`CHECK`/`VERIFY`/`abort()`/`__builtin_trap()`/`BUG_ON`) is a *safety mechanism* you must keep in production. Choosing the wrong tier is how a "defensive check" becomes a silent gap in the shipped binary.

---

## Core Concept 4 — Static vs Runtime: Push Checks to Compile Time

A runtime assertion costs a branch every time it runs and only fires if the bad state is actually reached during execution. A **compile-time assertion** costs *nothing* at runtime and fails *every* build where the condition is false — strictly better when the condition is knowable at compile time.

C11/C++ provide `static_assert` (`_Static_assert` in C):

```c
#include <assert.h>
static_assert(sizeof(int) == 4, "this protocol code assumes 32-bit int");
static_assert(sizeof(struct Header) == 16, "Header must be 16 bytes on the wire");
```

If `struct Header` ever grows past 16 bytes (a stray field, a padding change), the build *fails* with your message — long before a wire-format bug reaches a wire. Compare with the runtime version, which would only catch it if the right packet happened to flow through during testing.

> **Key insight:** Prefer compile-time over runtime whenever the condition is a property of *types, sizes, or constants* rather than *runtime values*. A `static_assert` is a free, exhaustive check; a runtime `assert` is a sampled, costed one. Move every check leftward (toward compile time) that you can.

Sizes, enum counts, alignment, and configuration constants all belong in `static_assert`. Runtime values (a pointer's nullness, a list's length *this call*) inherently need a runtime check.

---

## Core Concept 5 — A Language Tour of Assertions

The same idea — *claim a fact, abort on a bug* — appears with different defaults and ergonomics per language. The defaults matter as much as the syntax.

**C** — `assert` (stripped by `NDEBUG`) and `static_assert`:

```c
#include <assert.h>
assert(p != NULL);                    // runtime, gone under -DNDEBUG
static_assert(CAP > 0, "need capacity");  // compile-time
```

**C++** — same `assert`/`static_assert`, plus the **Contracts proposal (P2900)** targeting a future standard, which adds first-class `pre`, `post`, and `contract_assert`:

```cpp
// C++ contracts (P2900) — illustrative future syntax:
int sqrt_floor(int x)
    pre(x >= 0)                       // precondition (caller's obligation)
    post(r: r * r <= x);             // postcondition names the result `r`
// inside a body:  contract_assert(invariant());
```

**Rust** — a rich, deliberate set. `assert!`/`assert_eq!`/`assert_ne!` are **always on**; `debug_assert!` family is **stripped in release** (the C-`assert` semantics, but opt-*in* rather than opt-out). `unreachable!()` marks impossible branches; `unwrap()`/`expect()` assert that an `Option`/`Result` is `Some`/`Ok`:

```rust
fn pop(v: &mut Vec<i32>) -> i32 {
    assert!(!v.is_empty(), "pop on empty");     // always on (safety)
    debug_assert!(v.capacity() >= v.len());     // debug-only (cheap sanity)
    v.pop().expect("just checked non-empty")    // expect = assert + message
}

match shape {
    Shape::Circle | Shape::Square => render(shape),
    _ => unreachable!("new Shape variant not handled"),  // "can't happen"
}
```

Rust's split is the cleanest expression of Concept 3: `assert!` = `CHECK`, `debug_assert!` = `DCHECK`.

**Go** — has **no built-in `assert`**, and that's a deliberate design decision (documented in the Go FAQ): the team worried programmers would use assertions as a crutch to avoid proper error handling and reporting. Idiomatic Go uses `panic` for truly unrecoverable programmer errors and returns `error` for everything expected. Teams add a tiny helper for genuine invariants:

```go
// Go has no assert; panic marks an invariant violation, error marks expected failure.
func mustInvariant(cond bool, msg string) {
    if !cond {
        panic("invariant violated: " + msg)   // programmer error → crash
    }
}

func dequeue(q *Queue) (int, error) {
    if q.Empty() {
        return 0, errors.New("queue empty")   // EXPECTED → return error
    }
    mustInvariant(q.head < q.cap, "head out of range")  // BUG → panic
    return q.popFront(), nil
}
```

**Java** — has `assert`, but it is **disabled by default**; you must pass `-ea` (enable assertions) to the JVM to turn it on. The rationale is that assertions were added late (Java 1.4) and enabling them globally could change the behavior of code written before they existed. Consequence: Java `assert` is purely a *development/test* tool — never rely on it in production, and never use it for argument validation of public APIs (use explicit exceptions).

```java
assert balance >= 0 : "balance went negative: " + balance;  // only runs with -ea
// For PUBLIC input validation use an exception, not assert:
if (amount < 0) throw new IllegalArgumentException("amount < 0");
```

**Python** — `assert` is a statement, and the `-O` (optimize) flag **strips all asserts** (and sets `__debug__` to `False`). Same trap as C's `NDEBUG`: never put required logic in an `assert`, and never validate untrusted input with one.

```python
assert qty > 0, f"qty must be positive, got {qty}"   # gone under `python -O`
# Input validation must use a real exception:
if qty <= 0:
    raise ValueError(f"qty must be positive, got {qty}")
```

> **Key insight:** Across every language, the dividing line is identical to Concept 2 — `assert`/`panic!`/`unreachable!` for *programmer errors*, exceptions/`Result`/`error` for *expected conditions*. What differs is the **default**: C/Python/Java strip or disable assertions unless told otherwise; Rust makes you *choose* `assert!` (on) vs `debug_assert!` (off); Go refuses to give you the crutch at all. Know your language's default before you trust an assertion to fire in production.

---

## Core Concept 6 — What Makes an Assertion Good

A weak assertion is barely better than none; a sharp one turns a 2-hour bug hunt into a 2-minute fix.

- **Assert one thing.** `assert(a && b && c)` tells you *something* broke; three separate asserts tell you *which*. Split compound conditions so the failure line names the exact violated fact.
- **Write a specific message.** `assert(n >= 0)` prints the expression; `assert(n >= 0 && "refund count cannot be negative")` (C trick) or `assert!(n >= 0, "refund count={}", n)` (Rust) prints *why* and *with what value*. The message is for the engineer reading the crash, often you, months later.
- **Assert invariants at boundaries.** The highest-value spots are *function entry* (preconditions), *function exit* (postconditions), and *right before a dangerous operation* (bounds before indexing, non-null before deref). These are where a violated assumption is freshest and cheapest to pin down.
- **Document the contract as you check it.** The same condition serves as machine-checked precondition *and* human-readable documentation. A contract is the rare doc comment that can't go stale, because the runtime enforces it.

This connects to two broader ideas:

- **Total functions.** A function that is defined for *every* input in its parameter types needs no precondition — there is no "invalid" input to guard against. Designing toward total functions (use a `NonEmptyList` type instead of asserting a list is non-empty) replaces runtime asserts with compile-time guarantees.
- **"Parse, don't validate."** Validate untrusted data once *at the edge*, converting it into a type that *cannot* be invalid; then internal code asserts invariants on already-trusted, well-typed values. The edge does rejection (error handling); the interior does assertion (bug detection). This is Concept 2's security rule expressed as an architecture.

> **Key insight:** The best assertion is the one you didn't have to write because the *type system* made the bad state unrepresentable. Reach for a sharper type before a runtime check; reserve assertions for invariants types can't express.

---

## Core Concept 7 — Contracts as the Connective Tissue

Runtime assertions are not an island — they are the runtime face of several techniques this section covers.

- **Assertions are the oracle for testing.** A property-based or fuzz test generates thousands of inputs but needs a way to *judge* each result. In-code assertions, postconditions, and invariants are that judge — the **oracle**. A fuzzer that finds an input which trips an `assert` or `CHECK` has found a bug *with a built-in explanation*. (See [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md): fuzzing + assertions is the canonical pairing.)
- **Sanitizers are compiler-inserted assertions.** AddressSanitizer effectively wraps every memory access in `assert(this_address_is_valid)`; UBSan asserts "no signed overflow, no null deref" at each risky operation. They are the *same idea* — check an invariant at runtime, abort on violation — generated by the compiler instead of hand-written. (See [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md).)
- **Runtime contracts are the dynamic shadow of formal contracts.** Formal methods *prove* pre/postconditions hold for all inputs; a runtime `assert` *checks* them for the inputs that actually occur. When a full proof is too costly, runtime contracts give you a cheap, partial version of the same guarantee — and the same pre/post vocabulary. (See the [Formal Methods & Verification](../../formal-methods-and-verification/) section.)

> **Key insight:** "Assertion" is one mechanism — *check an invariant, fail loud on violation* — that recurs at every layer: hand-written (`assert`/`CHECK`), compiler-generated (sanitizers), test-driven (oracles for fuzzing/property tests), and proof-backed (formal contracts). Learn the mechanism once and you recognize it everywhere.

---

## Real-World Examples

**Chromium — `CHECK` vs `DCHECK` at browser scale.** Chromium's codebase is built around the two-tier split. Security-critical invariants (a buffer length, a process-type check that a sandbox decision depends on) use `CHECK`, which fires in shipping Chrome and converts an exploitable memory bug into a controlled crash + crash report. Cheap developer sanity checks use `DCHECK`, compiled out of release for speed. The policy is explicit: *if a failed check could be a security boundary, it must be a `CHECK`.* This is Concept 3 as a load-bearing engineering rule, not a style guide.

**SQLite — assertions as a correctness multiplier.** SQLite is famous for its test-to-code ratio, and its `assert()` macros are central. They are compiled *out* of production (via `NDEBUG`) but run constantly during its enormous test suite, where they act as the oracle that turns "the query returned wrong rows" into "invariant X broke in function Y." The asserts encode the database's internal invariants (B-tree balance, page reference counts) that no external test could observe directly.

**The Linux kernel — `BUG_ON` and `WARN_ON`.** The kernel cannot pop an exception dialog. `BUG_ON(cond)` panics when an invariant is so broken that continuing is unsafe; `WARN_ON(cond)` dumps a stack trace and *continues*, used where a crash would harm the user more than the bug does. The choice between them *is* the fail-fast policy decision (Concept 3) made per-call-site with the stakes explicit.

**A real ABI-style failure averted by `static_assert`.** Networking and serialization code routinely guards wire structs: `static_assert(sizeof(PacketHeader) == 20)`. A teammate adds an `int flags` field; instead of silently shipping a 24-byte header that desyncs every peer, the *build* fails with "wire header must be 20 bytes." The check that would have been a sampled runtime bug becomes an exhaustive compile-time one (Concept 4).

---

## Mental Models

- **A precondition is an unpaid invoice with the caller's name on it.** When it bounces (fails), you know whose account to charge: the *caller* used the routine wrong. A bounced postcondition charges the *supplier*. The contract is an accounting system for bugs.

- **An assertion is an executable comment that the runtime enforces.** `// invariant: n <= CAP` rots silently; `assert(n <= CAP)` cannot lie, because the moment it becomes false the program says so. It is the one form of documentation that fails the build/test when it goes stale.

- **`assert` is a smoke detector; error handling is a sprinkler.** A smoke detector screams about a condition that *should never exist* (a bug) so a human investigates. A sprinkler *handles* an expected hazard (a fire, i.e., bad input/IO) and keeps the building usable. Wiring the smoke detector to the front door — `assert(input_valid)` — lets anyone trigger the alarm: a DoS.

- **Debug-only vs always-on is "training wheels vs seatbelt."** `assert`/`DCHECK` are training wheels you remove once stable (release). `CHECK`/`VERIFY`/`abort()` are a seatbelt you *never* remove, because the cost of being wrong is catastrophic. Don't confuse the two and ship a car with no seatbelt.

---

## Common Mistakes

1. **Putting side effects inside an assertion.** `assert(do_work() == OK)` works in debug and vanishes under `NDEBUG`/`-O`/non-`-ea`. The work silently stops happening in production. Compute first, assert the saved result.

2. **Asserting on untrusted input.** `assert(len <= MAX)` on a network/file/user value is a self-inflicted denial-of-service: the attacker picks the value that aborts you. Validate and *return an error* at the trust boundary; assert only after.

3. **Using `assert` for expected runtime failures.** A missing file, a closed socket, an allocation failure are *the world*, not your bug. Returning them through `assert` both crashes on normal conditions and (in release) does nothing at all. Use exceptions/`Result`/`error`.

4. **Trusting an assertion that's compiled out.** C `assert` under `NDEBUG`, Python `assert` under `-O`, Java `assert` without `-ea` — all silently disabled. If a check must hold in production, use an always-on form (`CHECK`/`VERIFY`/explicit `if`+`abort`), never the default macro.

5. **Compound assertions that hide the culprit.** `assert(a && b && c)` reports "something broke." Split into three asserts so the failing line names the exact violated condition; add a message with the offending value.

6. **Choosing runtime when compile-time would do.** Checking `sizeof`, enum counts, or config constants with a runtime `assert` is a sampled check for a fact that's known at build time. Use `static_assert` for an exhaustive, zero-cost guarantee.

7. **Validating public-API arguments with `assert` in Java/Python.** Since those asserts can be disabled, public input validation must throw a real exception (`IllegalArgumentException`, `ValueError`). Reserve `assert` for internal invariants you control.

---

## Test Yourself

1. In Design by Contract, a **precondition** fails. Whose bug is it — the caller's or the routine's — and why?
2. Give the one-sentence rule for deciding `assert` vs return-an-error, and apply it to (a) a null internal pointer and (b) a malformed HTTP request body.
3. Why is `assert(len <= MAX)` on a value from the network a *security* bug, and what should you write instead?
4. What does defining `NDEBUG` do to C `assert`, and what is the "side-effect trap" that follows from it?
5. You need a bounds check that must survive into the shipped release binary. Name two mechanisms that do this and one that does *not*.
6. When should you prefer `static_assert` over a runtime `assert`? Give a concrete example.
7. Why does Go deliberately omit a built-in `assert`, and what do idiomatic Go programs use instead?

<details>
<summary>Answers</summary>

1. The **caller's** bug. In DbC the client *promises* to satisfy the precondition before calling; if it doesn't, it used the routine incorrectly. (A failed *postcondition*/invariant is the *supplier's* bug.)
2. Rule: **assert if it can only be false when your code has a bug; return an error if bad data alone can make it false.** (a) A null *internal* pointer → assert (only a logic bug nulls it). (b) A malformed request body → return an error/4xx (bad input is expected, not a bug).
3. `assert` aborts the process, and the attacker controls `len` — so they can crash your service on demand: a denial-of-service. Untrusted input must be *validated and rejected* (`if (len > MAX) return ERR;`), not asserted.
4. `NDEBUG` makes `assert(expr)` expand to nothing — `expr` is not evaluated. The side-effect trap: any work placed *inside* the assertion (`assert(advance() == OK)`) silently stops running in release. Assertions must be pure.
5. **Do survive release:** `CHECK` (Chromium/glog), a custom `VERIFY`/`if (!cond) abort();`/`__builtin_trap()`, `BUG_ON` (kernel), Rust's `assert!`. **Does not survive:** plain C `assert` (stripped by `NDEBUG`), and equally Python `assert` under `-O` / Java `assert` without `-ea`, Rust's `debug_assert!`.
6. Prefer `static_assert` when the condition depends only on *types/sizes/constants* known at compile time — it's free and checks *every* build. Example: `static_assert(sizeof(WireHeader) == 20)` catches a struct that grew at *build* time instead of as a runtime wire-format bug.
7. The Go team feared assertions become a crutch for skipping proper error handling/reporting. Idiomatic Go uses `panic` for unrecoverable *programmer errors* (invariants) and returns `error` for all *expected* conditions; teams add a tiny `mustInvariant` helper for genuine invariants.

</details>

---

## Cheat Sheet

```
ASSERT  vs  ERROR-HANDLE   (the core decision)
  assert / panic! / unreachable!   → IMPOSSIBLE-if-correct: broken invariant,
                                      "can't happen" branch, internal consistency
  return err / exception / Result  → EXPECTED: bad input, I/O fail, OOM, timeout
  NEVER assert on untrusted input  → validate & reject (assert = self-DoS)

DESIGN BY CONTRACT (who's to blame)
  precondition   caller's obligation   → fail = CALLER's bug
  postcondition  supplier's guarantee  → fail = ROUTINE's bug
  class invariant true between calls    loop invariant + variant = correct + terminates

DEBUG-ONLY vs ALWAYS-ON
  debug-only (stripped)   C assert | DCHECK | Rust debug_assert! | Python -O | Java w/o -ea
  always-on  (survives)   CHECK | VERIFY | if(!c) abort() | __builtin_trap() | BUG_ON | assert!
  side-effect trap:  NEVER put work inside assert() — it vanishes in release

STATIC vs RUNTIME
  static_assert / _Static_assert  → compile-time, free, exhaustive (sizes/enums/constants)
  runtime assert                  → sampled, costed (runtime values only)
  push checks LEFT (toward compile time) whenever possible

LANGUAGE DEFAULTS (does it fire in release?)
  C        assert NO (NDEBUG) | static_assert yes
  C++      assert NO          | static_assert yes | P2900: pre/post/contract_assert
  Rust     assert! YES        | debug_assert! NO  | unreachable!/expect/unwrap
  Go       no assert at all   | panic (bug) + return error (expected)
  Java     assert NO (need -ea)
  Python   assert NO (need: not -O)
```

---

## Summary

- **Design by Contract** (Meyer/Eiffel) splits responsibility: **preconditions** are the *caller's* obligation (failure = caller's bug), **postconditions** and **class invariants** are the *supplier's* guarantee (failure = routine's bug). **Loop invariants** prove correctness; **loop variants** prove termination.
- The central decision is **assert vs error-handle**: assert states that are *impossible if the code is correct*; return errors/exceptions for *expected* conditions (bad input, I/O, OOM). **Never assert on untrusted input** — it's a denial-of-service you wrote yourself.
- **Debug builds strip assertions** (`NDEBUG`, Python `-O`, Java without `-ea`), creating the **side-effect trap** and stripping security-critical guards. Use **always-on** checks (`CHECK`/`VERIFY`/`abort()`/`__builtin_trap()`/`BUG_ON`) for invariants that must survive release; reserve debug-only `assert`/`DCHECK` for cheap sanity checks.
- **Prefer compile-time** `static_assert` over runtime `assert` whenever the condition is a type/size/constant — it's free and exhaustive.
- The **language tour** shows one idea in six dialects, differing mainly in *defaults*: C/Python/Java disable by default, Rust makes you choose `assert!` (on) vs `debug_assert!` (off), Go omits assertions on purpose in favor of `panic` + `error`.
- **Good assertions** check one thing, carry a specific message with the offending value, sit at boundaries (entry/exit/before-danger), and document the contract. The best are the ones a *sharper type* made unnecessary (total functions; *parse, don't validate*).
- Assertions are the **connective tissue** of this section: the **oracle** for fuzzing/property tests, the hand-written cousin of **sanitizers**, and the runtime **shadow** of formal contracts.

---

## Further Reading

- *Object-Oriented Software Construction* (2nd ed.) — Bertrand Meyer. The source text for Design by Contract: pre/post/invariant, supplier/client, and why the contract *is* the interface.
- *The Pragmatic Programmer* (Hunt & Thomas) — the chapters "Design by Contract" and "Assertive Programming"; the practical case for asserting your assumptions and the "it can't happen" fallacy.
- Chromium docs — *"CHECK, DCHECK, and NOTREACHED"* — the canonical real-world policy for always-on vs debug-only checks at scale; glog's `CHECK` macros are the same lineage.
- The Go FAQ — *"Why does Go not have assertions?"* — the design rationale for omitting `assert` straight from the language authors.
- `man assert`, `cppreference` on `assert`/`static_assert`, the Rust `std` docs for `assert!`/`debug_assert!`/`unreachable!` — primary sources for the per-language behavior.
- [senior.md](senior.md) — contract verification at scale, the C++ contracts proposal (P2900) in depth, assertion-as-oracle in fuzzing pipelines, and the performance/observability of always-on checks in production.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md) — sanitizers as compiler-inserted assertions on memory safety.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) — the same "check an invariant, fail loud" idea applied to data races.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md) — assertions as the *oracle* that lets a fuzzer recognize a bug.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — proving pre/postconditions hold for all inputs; runtime contracts are their cheap dynamic shadow.
- [Testing](../../testing/) — where assertions live as the judgment layer of property-based and example-based tests.
