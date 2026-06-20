# Runtime Assertions & Contracts — Senior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Runtime Assertions & Contracts
> *The middle page taught you to write an assertion and keep it honest. This page is about the decisions a senior owns: whether a violated invariant should crash the process or just the request, why `CHECK` survives into release while `DCHECK` does not, how the same pre/postcondition can be checked here or proven by a verifier, and why a codebase dense with invariants gets far more out of a fuzzer than one without.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Fail-Fast vs Keep-Running, and the Granularity of Failure](#core-concept-1--fail-fast-vs-keep-running-and-the-granularity-of-failure)
5. [Core Concept 2 — CHECK vs DCHECK as a Cost/Benefit Design](#core-concept-2--check-vs-dcheck-as-a-costbenefit-design)
6. [Core Concept 3 — Assertions as Exploit Mitigation](#core-concept-3--assertions-as-exploit-mitigation)
7. [Core Concept 4 — The NDEBUG / Side-Effect Footgun, in Depth](#core-concept-4--the-ndebug--side-effect-footgun-in-depth)
8. [Core Concept 5 — Contracts as Specification](#core-concept-5--contracts-as-specification)
9. [Core Concept 6 — The Runtime-Check ↔ Static-Verification Spectrum](#core-concept-6--the-runtime-check--static-verification-spectrum)
10. [Core Concept 7 — Contract Inheritance and Liskov](#core-concept-7--contract-inheritance-and-liskov)
11. [Core Concept 8 — Assertions as Oracles for Fuzzing](#core-concept-8--assertions-as-oracles-for-fuzzing)
12. [Core Concept 9 — Performance: Branch Prediction, Sampling, and `__builtin_assume`](#core-concept-9--performance-branch-prediction-sampling-and-__builtin_assume)
13. [Core Concept 10 — Concurrency, TOCTOU, and Asserting Under Locks](#core-concept-10--concurrency-toctou-and-asserting-under-locks)
14. [Core Concept 11 — Assertion Failures as First-Class Signals](#core-concept-11--assertion-failures-as-first-class-signals)
15. [Real-World Examples](#real-world-examples)
16. [Mental Models](#mental-models)
17. [Common Mistakes](#common-mistakes)
18. [Test Yourself](#test-yourself)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Assertion policy as an engineering discipline — the production trade-offs, the contracts theory underneath, and the ecosystem of tools that turn invariants into safety, exploit mitigation, and bug-finding leverage.**

By the middle level you can write an assertion that states an invariant, you know `assert` vanishes under `NDEBUG`, and you avoid side effects inside the condition. That makes your code safer to read. The senior jump is different: you now set *policy*. You decide which invariants are important enough to cost a few cycles in every production request, whether a violation crashes the process or sheds a single request, whether the same precondition you check at runtime should instead be *proven* by a verifier, and how a violated invariant becomes a structured, alertable signal instead of a silent `SIGABRT` in a log nobody reads.

Each of those choices has second-order effects on availability, security, debuggability, and how much your fuzzers and property tests can find. To choose well you have to understand what an assertion *is* at the machine level — a branch and a trap, sometimes a hint to the optimizer, sometimes the thing standing between a memory-corruption bug and an exploit — and what a contract *is* as a specification that can be checked here or verified elsewhere. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — assertions vs error handling, invariants/pre/postconditions, `NDEBUG`, and why you never put side effects in the condition.
- **Required:** You can read a stack trace and a core dump, and you know what `SIGABRT` / `abort()` do to a process.
- **Helpful:** You've operated a service in production and felt the difference between "one request errored" and "the process died."
- **Helpful:** A working memory of undefined behavior and how the optimizer exploits it — see [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/senior.md).
- **Helpful:** You've written a fuzz target or property test and watched it find (or fail to find) a bug.

---

## Glossary

| Term | Meaning |
|---|---|
| **Assertion** | A boolean expression asserted to be true at a program point; if false, the program is in a state the author believed impossible. |
| **Precondition** | What a function requires of its caller before it runs (`require`). A violated precondition is the *caller's* bug. |
| **Postcondition** | What a function guarantees on return, given its preconditions held (`ensure`). A violated postcondition is the *callee's* bug. |
| **Invariant** | A property that holds at well-defined points — a class invariant holds between public method calls; a loop invariant holds each iteration. |
| **`CHECK`** | abseil/Chromium macro: an *always-on* assertion that aborts in release builds too. |
| **`DCHECK`** | "debug check": compiled out in release (`NDEBUG`); the C++ ecosystem's named `assert`. |
| **`__builtin_trap` / `__builtin_unreachable`** | Compiler intrinsics: emit a trapping instruction (`ud2` on x86); declare a path unreachable (UB if reached — the optimizer assumes it can't be). |
| **`__builtin_assume` / `std::unreachable` / `[[assume]]`** | Tell the optimizer a fact is true *without checking it* — a wrong assume is undefined behavior. |
| **Design by Contract (DbC)** | Meyer's discipline (Eiffel): pre/postconditions/invariants as first-class, checkable parts of an interface. |
| **Crash-only software** | Candea & Fox: design so the only way to stop is to crash and the only way to start is recovery; eliminates the fragile shutdown/startup path. |
| **Oracle** | In testing, the thing that decides pass/fail. An assertion is a built-in oracle — it makes any input that violates it a detectable bug. |
| **`panic_on_warn`** | Linux kernel sysctl that promotes every `WARN_ON` to a full `panic` — fleniency turned into fail-fast for fleets. |

---

## Core Concept 1 — Fail-Fast vs Keep-Running, and the Granularity of Failure

This is the question that separates a junior's "asserts are for catching bugs" from a senior's understanding. A failed assertion means the program reached a state the author proved impossible. Two truths are now in tension:

1. **Continuing is dangerous.** The state is corrupt or inconsistent. Every instruction after the violated invariant operates on data you've already established is wrong — you might serve a wrong account balance, persist garbage, or hand an attacker a primitive. Crashing is *safer* than continuing because it stops you from acting on bad data.
2. **Crashing is also dangerous.** If one malformed request can violate an assertion, an attacker who sends that request repeatedly has a remote, self-inflicted denial of service. Aborting the whole server on one bad input converts a contained bug into an outage.

The naive framing — "fail-fast vs keep-running" — is a false binary. The senior resolution is **the granularity of failure**: pick the *smallest unit you can safely destroy and recreate*.

```
violated invariant
        │
        ▼
  what do I tear down?
        │
   ┌────┼─────────┬──────────────┬────────────────┐
   ▼    ▼         ▼              ▼                ▼
 the   the       the          the              the
 expr  request   goroutine/   actor/           whole
 (none) (return  task         connection       process
        error)   (recover)    (supervisor)     (abort)
   safest ◄───────────────────────────────────────► most "fail-fast"
   (most likely to mask)                  (largest blast radius)
```

A web server can usually **abort the request**, not the process: roll back the transaction, log a structured assertion failure, return `500`, and keep serving every other client. The invariant was local to that request's state; tearing down the request discards the corruption without taking down the fleet.

```go
// Go: per-request recovery turns a panic (failed invariant) into a 500,
// not a dead server. The blast radius is one request.
func withAssertRecovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if v := recover(); v != nil {
                // structured, alertable signal — not a swallowed error
                log.Error("invariant violated",
                    "panic", v, "path", r.URL.Path,
                    "stack", string(debug.Stack()))
                metrics.Inc("assertion_failure", "path", r.URL.Path)
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

But this only works when the corruption is *confined* to the request. If a violated invariant means a shared, process-wide structure is corrupt — a global cache, an allocator's free list, a shared map mid-mutation — then recovering the request is the dangerous choice, because the next request inherits the corruption. There, crashing the process is correct.

This is the insight behind **crash-only software** (Candea & Fox, 2003): if you design every component so that the *only* way to stop it is to crash and the *only* way to start is recovery, you delete the fragile, rarely-tested "graceful shutdown" code path entirely, and crashing becomes a *normal, well-exercised* operation rather than a catastrophe. Erlang/OTP institutionalizes this as **"let it crash"**: a process that hits a bad state doesn't try to heroically repair itself — it dies, and a *supervisor* (which is correct because it shares no state with the crashed process) restarts it from a known-good state. The granularity of failure is the lightweight process; the recovery is supervised restart.

> **Key insight:** "Should I crash?" is the wrong question. The right one is **"what is the smallest unit I can destroy and cleanly recreate, and is the corruption confined to it?"** Confined corruption → shed that unit (request/goroutine/actor) and keep serving. Process-wide corruption → crash the process; a request handler that catches it just spreads bad state. Crash-only design and supervised restart make crashing *cheap and routine*, which is what makes fail-fast affordable.

The precondition for all of this is **idempotent recovery**: restart from durable, validated state, never from the in-memory state that the violated invariant just told you is untrustworthy.

---

## Core Concept 2 — CHECK vs DCHECK as a Cost/Benefit Design

Plain `assert` is a single global switch: on in debug, gone in release. That's too coarse. The mature ecosystems (Chromium/abseil, LLVM, Folly, V8) split assertions into **two tiers** with different lifetimes, and the design choice for each invariant is *which tier it belongs to*.

| | `CHECK(cond)` (abseil/Chromium) | `DCHECK(cond)` / `assert` |
|---|---|---|
| In release (`NDEBUG`) | **Stays.** Always evaluated, always aborts on failure. | **Removed.** Compiles to nothing. |
| Cost in production | A predictable branch (a few cycles) on every execution. | Zero. |
| Use for | Security/safety-critical invariants that **must** hold in the field; cheap checks; conditions whose violation is unrecoverable. | Expensive checks; internal consistency you're confident of; anything you'd never want to pay for in the hot path. |
| Failure in the field | Clean, deliberate abort with a symbolized message. | (Can't fail in release — it isn't there.) |

```cpp
#include "absl/log/check.h"

Balance Account::Withdraw(Money amount) {
  // SECURITY-CRITICAL: must hold in release. A negative withdrawal or an
  // overdraw is a financial-integrity violation — never optimize this away.
  CHECK_GE(amount, Money::Zero()) << "negative withdrawal: " << amount;
  CHECK_LE(amount, balance_)      << "overdraw: " << amount << " > " << balance_;

  // INTERNAL CONSISTENCY: expensive, and a bug here means our own code is
  // wrong, not the caller's. Fine to strip in release.
  DCHECK(InvariantHolds()) << "ledger invariant broken before withdraw";

  balance_ -= amount;
  return balance_;
}
```

A real `CHECK` failure is a clean, intentional abort with a symbolized message — not a mysterious segfault three functions later:

```
[FATAL:account.cc(42)] Check failed: amount <= balance_ (150 vs. 100)
overdraw: 150 > 100
*** Check failure stack trace: ***
    @     0x55e3a1  absl::log_internal::LogMessage::~LogMessage()
    @     0x55e2f4  Account::Withdraw()
    @     0x55e10a  HandleWithdrawRequest()
```

The cost/benefit calculus for an *always-on* `CHECK` is stark and almost always favors keeping it: you spend a correctly-predicted branch — a few cycles, effectively free next to the surrounding work — to guarantee you never act on a corrupt invariant in production. The alternative to a `CHECK` that fires is rarely "everything's fine"; it's "we silently did the wrong thing with money / memory / auth, and we found out hours later from a customer."

> **Key insight:** `assert`/`DCHECK` answers "is *our* code self-consistent?" and is fine to strip. `CHECK` answers "is it *safe to proceed*?" and must survive into release. The tiering is not "debug vs prod" — it's **"can I afford to be wrong about this in production?"** For anything touching safety, security, money, or memory, the answer is no, and a few cycles is the right price.

---

## Core Concept 3 — Assertions as Exploit Mitigation

There is a security argument for always-on `CHECK` that is independent of correctness. Consider a function that has a memory-corruption bug — an integer overflow that lets `len` exceed the buffer:

```cpp
void Copy(char* dst, size_t dst_cap, const char* src, size_t len) {
  // Without this CHECK, an attacker who controls `len` gets an OOB write —
  // a classic memory-corruption primitive they can escalate to code execution.
  CHECK_LE(len, dst_cap) << "OOB write blocked";
  memcpy(dst, src, len);
}
```

If `len > dst_cap`, the `memcpy` is an out-of-bounds write: a *write-what-where* primitive, one of the most powerful things an attacker can have. The `CHECK` converts that exploitable corruption into a **clean, deterministic abort** *before* the dangerous instruction executes. The attacker's best case collapses from "arbitrary code execution" to "crash the process" — a denial of service, which is real but vastly less severe, and which your supervisor restarts.

This is exactly the family of mitigation that `-fsanitize=undefined -fsanitize-trap` and `__builtin_trap()` provide: turn an *exploitable* condition into a *trap*. UBSan in trap mode (see [03 — UBSan](../03-undefined-behavior-sanitizer-ubsan/senior.md)) inserts, at the point of a signed-overflow or OOB index, the moral equivalent of `if (bad) __builtin_trap();` — and a `CHECK` is the hand-written version of the same idea.

```cpp
// What CHECK and a trapping sanitizer both compile to, conceptually:
if (__builtin_expect(!(len <= dst_cap), 0))
    __builtin_trap();        // x86: `ud2` — a guaranteed, un-skippable fault
```

`__builtin_trap()` emits an instruction (`ud2` on x86-64, `brk #1` / `udf` on ARM) that *cannot* be turned into a no-op or skipped by corrupting a return address — unlike calling `abort()`, which goes through the PLT and is, in principle, a control-flow target an attacker might redirect. That's why hardened builds prefer trapping over calling a libc function: the trap is closer to the metal and harder to bypass.

> **Key insight:** A `CHECK` on a security-critical bound is not just a bug-catcher — it's an **exploit mitigation** that downgrades the worst-case from code execution to a crash. The few cycles it costs buy you the difference between "remote DoS" and "remote code execution." This is why Chromium and Android keep thousands of `CHECK`s in shipping release binaries: each one is a tiny, always-on guard that caps the blast radius of the next memory bug.

---

## Core Concept 4 — The NDEBUG / Side-Effect Footgun, in Depth

The middle level warned you never to put side effects in an `assert`. The senior understanding is *why* the standard workarounds are also fragile, and what the modern fix is.

`assert(expr)` is defined (C11 §7.2.1.2, C++ `<cassert>`) to expand to *nothing* when `NDEBUG` is defined. Not "evaluate but ignore" — **textually nothing**. So this:

```c
assert(initialize_subsystem() == OK);   // BUG: in release, the subsystem is NEVER initialized
assert(--remaining >= 0);               // BUG: in release, `remaining` is never decremented
```

silently changes behavior between debug and release. Worse, the bug is invisible in every debug test run and only appears in production. This is the canonical "works in debug, broken in release" class.

The classic attempts to have an assert with a side effect are all traps in their own way:

```c
// "comma operator" trick: evaluate the side effect, then assert the condition.
assert((void)expensive_log(), cond);
```

This is fragile for several reasons. First, it's hostile to read and easy to get the operand order wrong (the asserted value is the *last* operand). Second, the side effect *still* vanishes under `NDEBUG` along with the rest of the macro — so if you needed `expensive_log()` to run, it now doesn't, which is the exact bug you were trying to dodge. Third, comma-operator overloading in C++ (rare, but legal) can change what `,` even means. It is a pattern that looks clever and behaves inconsistently across build modes.

The correct discipline is to **separate the action from the check**:

```c
int rc = initialize_subsystem();   // the EFFECT always happens
assert(rc == OK);                  // the CHECK is debug-only — fine, it's a pure observation
(void)rc;                          // silence "unused variable" under NDEBUG
```

Now the side effect is unconditional and the assertion is a *pure observation* of an already-computed value — which is exactly what an assertion should always be.

For expensive checks you genuinely don't want in release, don't lean on the comma trick — make the *evaluation* explicitly conditional:

```cpp
#ifndef NDEBUG
  // This whole block, side effects included, compiles out in release —
  // and it's obvious that it does.
  auto snapshot = ComputeExpensiveInvariantState();
  DCHECK(snapshot.IsConsistent());
#endif
```

> **Key insight:** An assertion must be a **pure predicate over already-computed values** — `assert(x)`, never `assert(mutate())`. The comma-operator "fix" is worse than the disease: it's unreadable, it *still* disappears under `NDEBUG`, and it hides which operand is the condition. If you need an effect, run it on its own line; if you need an expensive *check*, gate the whole block in `#ifndef NDEBUG` so its disappearance is explicit, not buried inside a macro's expansion rules.

---

## Core Concept 5 — Contracts as Specification

Step back from the mechanics. The deepest reason to write pre/postconditions and invariants is that they are a **machine-checkable, executable specification** that lives next to the code and *cannot rot*. A comment that says "n must be positive" drifts the moment someone changes the function; a `CHECK_GT(n, 0)` that's still passing in CI is *proof* the contract still holds.

Design by Contract (Meyer, Eiffel) makes the three obligations first-class parts of an interface:

- **Precondition (`require`)** — the caller's obligation. Violating it is the *caller's* bug.
- **Postcondition (`ensure`)** — the callee's guarantee, *given* the precondition held. Violating it is the *callee's* bug.
- **Class invariant** — a property true between every public method call; methods may break it internally but must restore it before returning.

The blame assignment is the powerful part. A precondition failure points at the *call site*; a postcondition failure points at the *implementation*. This turns "something's wrong somewhere" into "the bug is on one specific side of this interface."

```eiffel
class ACCOUNT
feature
    withdraw (amount: INTEGER)
        require                          -- caller's obligation
            non_negative: amount >= 0
            sufficient_funds: amount <= balance
        do
            balance := balance - amount
        ensure                           -- callee's guarantee
            debited: balance = old balance - amount
            non_negative_balance: balance >= 0
        end
invariant
    balance_never_negative: balance >= 0  -- holds between every public call
end
```

C++ is standardizing this as a language feature. **Contracts (P2900)**, targeting C++26, give pre/post/assert as syntax with *configurable enforcement semantics* — `ignore`, `observe` (log and continue), or `enforce` (terminate) — chosen at build time, which is exactly the CHECK/DCHECK tiering promoted into the language:

```cpp
// C++26 contracts (P2900) — syntax illustrative
Money withdraw(Money amount)
    pre (amount >= Money::Zero())          // precondition
    pre (amount <= balance_)               // precondition
    post (r : r == old_balance - amount)   // postcondition, names the return value
{
    contract_assert(InvariantHolds());     // assertion, same enforcement knob
    balance_ -= amount;
    return balance_;
}
```

> **Key insight:** Contracts are a **specification you can run**. Unlike a comment, a checked contract is *falsifiable in CI* — if it's wrong, a test fails — so it cannot silently drift out of sync with the code. Pre/post split *blame*: a precondition failure indicts the caller, a postcondition failure indicts the implementation. That blame assignment is half the debugging value, before you've even run the program.

---

## Core Concept 6 — The Runtime-Check ↔ Static-Verification Spectrum

Here is the connection most engineers miss. The *same* precondition can be **checked at runtime** (this topic) or **proven at compile time** by a verifier — they are two enforcement strategies for one specification. The contract is the invariant; runtime vs static is *when and how you discharge it*.

```
    SPECIFICATION:  ∀ inputs satisfying pre, the function ensures post
                                  │
              ┌───────────────────┴────────────────────┐
              ▼                                         ▼
        RUNTIME CHECK                            STATIC VERIFICATION
   CHECK / assert / contract                  Dafny / SPARK / Frama-C
   ──────────────────────────                 ──────────────────────────
   + cheap to write                           + proves it for ALL inputs
   + catches real prod inputs                 + zero runtime cost
   + no whole-program analysis                + no DoS-on-bad-input risk
   − only catches inputs you hit              − requires the proof to go through
   − costs cycles in production               − expertise + annotation burden
   − a violation is a crash, not a proof      − doesn't see the real environment
```

The same `require amount >= 0` you'd `CHECK` at runtime can be handed to **Dafny**, **SPARK** (Ada), or **Frama-C** (C, via ACSL), which use an SMT solver to *prove* — for *every* possible input, not just the ones your tests happen to feed — that the postcondition follows. Where a runtime check tells you "this specific execution didn't violate the contract," a verifier tells you "no execution *can*."

```c
// Frama-C / ACSL: the SAME contract, written for a prover instead of a CPU.
/*@ requires amount >= 0;
  @ requires amount <= *balance;
  @ ensures  *balance == \old(*balance) - amount;
  @ ensures  *balance >= 0;
  @ assigns  *balance;
  @*/
void withdraw(int* balance, int amount) {
    *balance -= amount;
}
```

In practice you mix them along the spectrum: prove the handful of invariants where a bug is catastrophic and the code is small enough to verify (a bounds calculation, a crypto length check, a state machine), and runtime-check everything else where proof is uneconomical. A mature codebase treats "is this contract *proven*, *runtime-checked*, or *just a comment*?" as a deliberate, per-invariant decision — and the cross-link is exact: [Formal Methods & Verification](../../formal-methods-and-verification/) is the static end of the *same* line this topic sits at the runtime end of.

> **Key insight:** A runtime assertion and a formal proof are not different worlds — they are the **runtime and static ends of one spectrum**, discharging the *same* specification. Runtime checks catch the inputs you actually hit, cheaply and everywhere; verification proves the property for *all* inputs but costs annotation and expertise. Senior judgment is choosing, per invariant, how far up the spectrum the stakes justify going.

---

## Core Concept 7 — Contract Inheritance and Liskov

When a class hierarchy carries contracts, inheritance imposes a non-obvious rule that is precisely the **Liskov Substitution Principle** made formal. A subtype must be usable *anywhere* its supertype is, without the caller knowing. Translated to contracts (Meyer's rule for Eiffel):

- **Preconditions may only be *weakened*** (or kept the same) in a subclass — the subclass may accept *more* than the parent, never *less*. If a subclass demanded *more* of the caller, code written against the parent's looser contract would break when handed the subclass.
- **Postconditions may only be *strengthened*** (or kept the same) — the subclass may promise *more*, never *less*. If a subclass delivered *less*, code relying on the parent's guarantee would be let down.

```
                     Parent.method
   pre:  x > 0                          post: result < 100
        │                                       │
   subclass may   ──── WEAKEN pre ────►    ──── STRENGTHEN post ────►
   accept more (x ≥ 0 ✓)                   promise more (result < 50 ✓)
   accept less (x > 10 ✗ breaks LSP)       promise less (result < 200 ✗ breaks LSP)
```

This is *contravariance* of preconditions and *covariance* of postconditions, and it's why Eiffel uses `require else` (a subclass precondition is OR-ed with the parent's — automatically weakening) and `ensure then` (AND-ed with the parent's — automatically strengthening). The language enforces LSP structurally; you cannot accidentally tighten a precondition in an override.

The practical payoff even without Eiffel: when you override a method and find yourself wanting to add `CHECK(arg != null)` that the base didn't require, *stop* — you're about to violate LSP, and callers polymorphic over the base will be surprised. The contract rule turns a slippery design principle into a mechanical check.

> **Key insight:** Contract inheritance *is* LSP with the hand-waving removed: **preconditions can only weaken, postconditions can only strengthen** in a subclass. A subclass that demands more, or promises less, than its parent is not substitutable. If you reach for a stricter `CHECK` in an override, you've found an LSP violation before it became a polymorphism bug.

---

## Core Concept 8 — Assertions as Oracles for Fuzzing

This is where assertion density pays off the most, and it ties this topic directly to [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md). A fuzzer or property test generates inputs and runs your code; the hard part is the **oracle** — deciding whether a given run is *wrong*. Without invariants, a fuzzer can only catch the crudest failures: a segfault, an ASan report, a hang. Logic bugs that produce a *plausible-looking wrong answer* sail straight through, because nothing flagged them.

A codebase rich in assertions hands the fuzzer a free, dense oracle. **Every invariant is a tripwire**: any generated input that violates one is a found bug, *with no crash required*. You don't need to know the correct output to detect that the red-black tree is no longer balanced, the parser's output doesn't round-trip, or the balance went negative — the assertion already encodes "this must be true," so the fuzzer just has to hit it.

```c
// A fuzz-friendly invariant: it makes ANY input that desyncs the tree a finding,
// even when the operation "succeeds" and returns a normal-looking result.
void rbtree_insert(RBTree* t, int key) {
    rbtree_insert_impl(t, key);
    DCHECK(rbtree_red_black_invariant(t));   // fuzzer trips this on a bad rebalance
    DCHECK(rbtree_is_sorted(t));
}

// libFuzzer entry point: the assertions ARE the oracle.
int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    RBTree t = {0};
    for (size_t i = 0; i + 4 <= size; i += 4)
        rbtree_insert(&t, read_int(data + i));   // a violated DCHECK aborts → libFuzzer logs it
    return 0;
}
```

The craft of writing **fuzz-friendly assertions**: prefer invariants that are *cheap to evaluate* (so they don't slow the fuzzer's executions-per-second), *total* (true for every reachable state, not just the happy path), and *round-trip / differential* where possible (`decode(encode(x)) == x`; `optimized(x) == reference(x)`) — these catch the largest class of logic bugs. Build fuzz targets with `DCHECK`s *enabled* (don't fuzz a release `NDEBUG` build, or you've thrown away your oracle), plus a sanitizer, so you get *both* the hand-written invariants *and* the automatically-inserted ones.

Which is the other half of the connection: **a sanitizer is a set of assertions the compiler inserts for you.** ASan asserts "this access is in-bounds" on every load and store; UBSan asserts "this shift is in-range," "this signed add didn't overflow." You write the *domain* invariants (the tree is balanced); the sanitizer supplies the *language* invariants (no UB, no OOB). Together they make a fuzzer dramatically more effective than either alone.

> **Key insight:** A fuzzer is only as good as its oracle, and **every assertion is a free oracle** — a violated invariant is a found bug with no crash needed. A codebase dense with cheap, total, round-trip invariants gets *far* more out of fuzzing and property testing than a sparse one. Write your domain invariants as assertions; let the sanitizers supply the language invariants; fuzz with both enabled.

---

## Core Concept 9 — Performance: Branch Prediction, Sampling, and `__builtin_assume`

Always-on assertions have a cost, and the senior knows how to make it negligible — and, more subtly, how to turn an assertion into something that makes code *faster*.

**1. The branch is nearly free if you tell the predictor it never fires.** An assertion is a branch that, by definition, is almost always not-taken. Mark it so the compiler lays out the failure path cold (out of the hot instruction stream) and the predictor assumes success:

```c
#define CHECK(c) do { if (__builtin_expect(!(c), 0)) abort_with_msg(#c); } while (0)
//                                          ^^^^^^^ 0 = "expect false" → cold failure path

// C++20: the portable spelling
if (cond) [[likely]] { /* hot path stays hot */ }
```

With the failure path marked unlikely, a passing `CHECK` is a single predicted-not-taken branch — a couple of cycles, and the failure-handling code isn't even in the cache line you're executing. This is why "a `CHECK` costs a few cycles" is true in practice, not just in theory.

**2. Sample expensive checks instead of running them every time.** If an invariant is genuinely costly (an O(n) scan of a structure), don't pay it on every call in production — pay it *occasionally*, which still catches a systematic violation quickly while keeping the amortized cost near zero:

```cpp
// Run the O(n) invariant on ~0.1% of calls. A persistent violation still
// surfaces fast across a fleet, at 1/1000th the cost.
if (ABSL_PREDICT_FALSE((rand() & 0x3FF) == 0)) {
    CHECK(ExpensiveWholeStructureInvariant());
}
```

**3. The dangerous, powerful inverse: `__builtin_assume` / `std::unreachable` give the *optimizer* information.** An assertion *checks* a fact; an *assumption* tells the compiler the fact is true and lets it optimize on that basis — *without checking it*. Used correctly, this removes redundant checks and enables vectorization:

```cpp
void process(int* p, size_t n) {
    __builtin_assume(n % 8 == 0);     // "trust me, n is a multiple of 8"
    // the compiler can now vectorize the loop with no scalar remainder
    for (size_t i = 0; i < n; ++i) p[i] *= 2;
}

int classify(Color c) {
    switch (c) {
        case RED: return 1;
        case GREEN: return 2;
        case BLUE: return 3;
    }
    std::unreachable();   // C++23: no default, no bounds check, no warning — UB if hit
}
```

Here is the trap, and it is a serious one: **a wrong assumption is undefined behavior.** `__builtin_assume(cond)` where `cond` is actually false, or reaching `std::unreachable()`, doesn't fail loudly — it hands the optimizer a false premise, and the optimizer will *delete code, mis-vectorize, and miscompile* based on it, often far from the assumption, with no diagnostic. This is the same UB you read about in [03 — UBSan](../03-undefined-behavior-sanitizer-ubsan/senior.md): you've *promised* the compiler something, and breaking the promise is catastrophic, not graceful.

The disciplined pattern is to **check in debug, assume in release** — get the loud failure during testing and the optimization in production:

```cpp
#ifdef NDEBUG
  #define ASSUME(c) __builtin_assume(c)      // release: optimize on the fact
#else
  #define ASSUME(c) assert(c)                // debug: VERIFY the fact loudly
#endif
```

> **Key insight:** An assertion *verifies* a fact at a small, predictable cost (a cold-marked branch); an *assumption* *exploits* a fact for speed at the cost of **UB if it's wrong**. The two are mirror images. Use `__builtin_expect`/`[[likely]]` and sampling to make assertions nearly free; use `ASSUME = assert-in-debug, assume-in-release` so you *prove* the fact in testing before you let the optimizer bet your correctness on it.

---

## Core Concept 10 — Concurrency, TOCTOU, and Asserting Under Locks

Assertions about shared state have a failure mode that single-threaded code doesn't: the asserted fact can become false *between the check and its use*, or even *during* the evaluation of the assertion itself.

**The condition must be evaluated under the same lock that protects the data.** Reading a shared variable in an assertion without holding its lock is itself a data race (TSan will flag it — see [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md)), and the value you read may be torn or stale:

```cpp
// WRONG: reads shared state without the lock. The assertion is itself a race,
// and `queue_.size()` may be mid-mutation.
DCHECK_LT(queue_.size(), kMaxQueue);   // ← data race + meaningless if unsynchronized

// RIGHT: assert while holding the lock that owns the invariant.
{
    absl::MutexLock lock(&mu_);
    DCHECK_LT(queue_.size(), kMaxQueue);   // queue_ is stable for this critical section
    queue_.push(item);
}
```

**TOCTOU (time-of-check to time-of-use) makes a lock-free assertion a lie.** If you assert a condition, *release* the lock, then act, the condition can change in the gap:

```cpp
// BROKEN: the invariant is true at the CHECK and false by the time we use it.
{ absl::MutexLock l(&mu_); CHECK(!buffer_.full()); }   // true here...
// ... another thread fills buffer_ in this window ...
buffer_.push(x);                                        // ...false here → corruption
```

The fix is the same as for any TOCTOU bug: **the check and the use must be in the same critical section** — hold the lock across both. An assertion does not exempt you from atomicity; an "assert then act" pattern with a lock release in between is exactly as racy as a "check then act" one.

A practical tool: many lock libraries let you *assert that a lock is held*, turning "callers must hold `mu_`" from a comment into a checked precondition:

```cpp
void AppendLocked(Item x) {
    mu_.AssertHeld();              // abseil: aborts if mu_ isn't held by this thread
    queue_.push_back(x);          // now the "must hold mu_" contract is enforced
}
```

> **Key insight:** A concurrent assertion is only meaningful **inside the critical section that owns the data**, and it must hold the lock across both check *and* use — otherwise it's either a data race (unsynchronized read) or a TOCTOU lie (true when checked, false when used). `AssertHeld()` promotes locking discipline from comment to enforced precondition. Asserting shared state is a concurrency operation, subject to all the rules of one.

---

## Core Concept 11 — Assertion Failures as First-Class Signals

A `CHECK` that fires in production is one of the highest-value signals your system can emit: it's a place where reality contradicted something an engineer *proved* should hold. Treating that as a bare `SIGABRT` in a log wastes it. The senior treats assertion failures as **first-class observability events**.

The components:

- **Structured crash reports.** On `abort()`, capture a symbolized stack, the assertion expression and message, build ID, and relevant context — and ship it to a crash-aggregation service (Crashpad/Breakpad, Sentry, a kernel `pstore`), not just stderr.
- **Symbolized stacks.** A stack of hex addresses is useless; resolve it against the build's debug info (locally via a signal handler that prints `backtrace_symbols`, or server-side from a symbol store keyed on build ID).
- **Aggregation and dedup.** Group failures by *call site* (file:line + top frames) so "this `CHECK` fired 4,000 times" is one actionable bucket, not 4,000 lines. The bucket's *rate* and *first-seen build* are the triage signals.
- **Alerting with a threshold.** A `CHECK` that fires once might be a cosmic ray; one firing on 5% of requests is an incident. Alert on *rate*, and tie it to the deploy that introduced it.

```c
// Minimal in-process symbolized backtrace on abort — the local end of the pipeline.
static void on_fatal(int sig) {
    void* frames[64];
    int n = backtrace(frames, 64);
    backtrace_symbols_fd(frames, n, STDERR_FILENO);   // symbolized stack to stderr
    _exit(128 + sig);
}
// install for SIGABRT/SIGSEGV at startup; a real system also writes a minidump.
```

The **kernel model** is the reference design for this at fleet scale. Linux distinguishes:

- `BUG_ON(cond)` — the invariant is unrecoverable; *panic* (or oops and kill the thread) here.
- `WARN_ON(cond)` — the invariant is violated but the kernel can limch on; emit a stack trace to `dmesg` and *continue*. This is "log and keep running" with a full backtrace as the signal.
- `panic_on_warn` (a sysctl) — flips every `WARN_ON` into a `panic`. Fleets and CI/syzkaller turn this *on* deliberately: in a test fleet you *want* the first sign of a broken invariant to be a crash you can capture, not a warning that scrolls past. It's the granularity-of-failure dial (Concept 1) exposed as a runtime knob.

```c
if (WARN_ON(refcount_read(&obj->ref) == 0))   // logs a full backtrace, then...
    return -EINVAL;                            // ...continues — unless panic_on_warn is set
```

A weak but real meta-signal: **assertion density**. A module with one assertion per few hundred lines is encoding far more of its author's intent (and giving fuzzers far more oracles) than one with none. It's a *weak* proxy — assertions can be trivial or wrong — so never make it a target (that invites gaming: see Goodhart's law in the engineering-metrics material), but as a code-review heuristic, "this complex function has zero invariants stated" is worth a comment.

> **Key insight:** A fired `CHECK` is your system telling you reality broke a proof — the highest-signal event you can get. Capture it as a **structured, symbolized, deduplicated, rate-alerted** event, not a stray `SIGABRT`. The kernel's `BUG_ON`/`WARN_ON`/`panic_on_warn` triad is the canonical design: crash on the unrecoverable, log-with-backtrace on the recoverable, and a fleet-wide knob to promote leniency to fail-fast where you want maximum signal.

---

## Real-World Examples

**Chromium / Android — `CHECK` as shipped exploit mitigation.** Chromium's release binaries carry thousands of `CHECK`s, deliberately, because the browser is the single most-attacked piece of software on most machines. Each `CHECK` on a buffer length, an index, or a state-machine transition caps the blast radius of the next memory bug: an attacker's OOB-write primitive becomes a clean crash (a renderer-process crash, contained by the sandbox and the site-isolation architecture — the granularity of failure is the renderer, not the browser). The cost — a predicted branch each — is a price the security team pays gladly.

**LLVM / Clang — `assert` as the development oracle, stripped in release.** LLVM is built with thousands of `assert`s encoding compiler invariants (this value dominates that block, this type matches). Development and CI build with assertions *on*; the shipped `clang` is built `NDEBUG` for speed. The assertions are what make LLVM's aggressive fuzzing (via `clang-fuzz`, `llvm-isel-fuzzer`) productive — a generated program that drives the compiler into an impossible IR state trips an assert, turning "the compiler miscompiled something" (hard to detect) into "an assertion fired at a precise location" (trivial to triage).

**SQLite — assertions plus a separate always-on integrity layer.** SQLite is famously assertion-dense (`assert()` strewn through the b-tree and VDBE) *and* ships an always-on, non-assert corruption-detection layer (`PRAGMA integrity_check`, defensive checks behind `SQLITE_ENABLE_*` and the `sqlite3_db_config(SQLITE_DBCONFIG_DEFENSIVE)` mode). The split is exactly the CHECK/DCHECK distinction: `assert` catches *SQLite's own* bugs during its exhaustive test harness; the defensive layer catches *corrupt input databases* in the field, where an `assert` is gone and a corrupt file must not be allowed to drive the engine off a cliff.

**Erlang/OTP behind telecom switches.** The "let it crash" model isn't a slogan; it's why Ericsson's AXD301 switch reached famous availability figures. A process that hits a bad message doesn't defensively try to handle every malformed case — it crashes, its supervisor restarts it from known-good state, and the *isolation* (no shared memory between processes) guarantees the crash can't have corrupted anyone else. The granularity of failure (a lightweight process) is small enough that a crash is invisible to the call in progress on another process.

---

## Mental Models

- **The granularity-of-failure dial.** Every violated invariant forces a choice along a dial from "do nothing" to "kill the process." Turn it to the smallest unit whose corruption is *confined* and that you can cleanly recreate. Confined → shed the request/goroutine/actor. Process-wide → crash. Recovering a request that left a global corrupt just spreads the rot.

- **Two tiers, one question.** `assert`/`DCHECK` asks "is *our* code self-consistent?" (strippable). `CHECK` asks "is it *safe to proceed*?" (must survive release). The tier is decided by one question: *can I afford to be wrong about this in production?*

- **An assertion is a branch; an assumption is a bet.** A checked assertion costs a cold-marked branch and tells *you* the truth. An `__builtin_assume` costs nothing and tells the *optimizer* a "truth" it won't verify — and miscompiles silently if you lied. Mirror images: check in debug, assume in release.

- **A contract is one spec with two discharge strategies.** The same pre/postcondition can be runtime-checked (catches the inputs you hit, cheaply, everywhere) or statically proven (holds for *all* inputs, at the cost of annotation and expertise). Runtime and formal verification are the two ends of one line.

- **Every assertion is a free oracle.** A fuzzer is only as good as the thing that decides "wrong." Each invariant you write is a tripwire that turns a plausible-looking bad result into a detected bug, no crash required. Sanitizers add the language-level invariants for free on top.

- **A fired CHECK is reality breaking a proof.** It's the highest-signal event your system emits. Capture it like one — symbolized, structured, deduplicated, rate-alerted — not as an anonymous `SIGABRT`.

---

## Common Mistakes

1. **Asserting on external input.** A precondition is a contract with *your own code*; user input, network bytes, and file contents are *adversarial* and must be *validated* with real error handling, never asserted. `assert(json_is_valid(input))` is a remote-DoS in release-with-CHECK and a silently-skipped check in release-without. Validate the boundary; assert the interior.

2. **Swallowing assertion failures in a broad `catch`.** A `try { ... } catch (...) {}` that engulfs a contract violation turns the most valuable signal you have into silence — and lets the program continue on the corrupt state the assertion was trying to stop. If you catch, *re-raise* or crash; never swallow.

3. **Using asserts to replace needed error handling.** `assert(fopen(...) != NULL)` is a bug: file-open failure is an *expected runtime condition*, not an impossible state. Asserts are for things that can't happen if the code is correct; recoverable failures need real handling that survives `NDEBUG`.

4. **Side effects in the condition.** `assert(--n >= 0)` or `assert(init() == OK)` changes behavior between debug and release because the macro expands to *nothing* under `NDEBUG`. Run effects on their own line; assert pure observations of already-computed values.

5. **The comma-operator "fix."** `assert((void)log(), cond)` is unreadable, *still* vanishes under `NDEBUG` (so the side effect you wanted is gone), and obscures which operand is the condition. Gate expensive checks in `#ifndef NDEBUG` instead.

6. **Over-asserting trivia.** `assert(i == i)`, `assert(ptr == ptr)`, asserting things the type system already guarantees — noise that dilutes the real invariants and trains readers to skim past assertions. Assert *non-obvious* properties that encode genuine intent.

7. **Fuzzing a release (`NDEBUG`) build.** Doing so throws away your hand-written oracle — the `DCHECK`s that would have caught logic bugs are gone, so the fuzzer can only find crashes. Fuzz with assertions *and* a sanitizer enabled.

8. **A wrong `__builtin_assume` / reachable `std::unreachable`.** This isn't a graceful failure — it's UB that licenses the optimizer to miscompile arbitrarily, often far from the assumption, with no diagnostic. Only assume what you'd otherwise be willing to `CHECK`, and prefer assert-in-debug/assume-in-release.

9. **Asserting shared state without the lock.** Reading shared data in an assertion off-lock is itself a data race and reads possibly-torn values; an "assert then act" with a lock release in between is a TOCTOU lie. Hold the lock across check *and* use.

---

## Test Yourself

1. A violated assertion means corrupt state. Give the senior framing for "should I crash?" and explain why a web request handler and a corrupted global cache lead to *opposite* answers.
2. What distinguishes `CHECK` from `DCHECK`/`assert`, and what single question decides which tier an invariant belongs to?
3. Explain how an always-on `CHECK` on a buffer bound functions as an *exploit mitigation*. What does it downgrade the attacker's best case to, and how does `__builtin_trap` relate?
4. Why is `assert((void)expensive(), cond)` a fragile pattern even though it "works"? Give the correct way to (a) run a needed side effect and (b) gate an expensive check.
5. The same precondition can be a runtime `CHECK` or proven by Frama-C/Dafny/SPARK. What does each strategy catch that the other doesn't, and what does this tell you about the relationship between this topic and formal methods?
6. State Meyer's contract-inheritance rule and connect it to the Liskov Substitution Principle. What goes wrong if a subclass *strengthens* a precondition?
7. Why does a codebase rich in invariants get dramatically more out of a fuzzer? What's the difference between the assertions you write and the ones a sanitizer inserts?
8. You want an optimization that depends on `n % 8 == 0`, which you can't prove but strongly believe. Contrast `assert(n % 8 == 0)` with `__builtin_assume(n % 8 == 0)`, name the danger, and give the disciplined pattern.

<details>
<summary>Answers</summary>

1. The framing isn't "crash vs continue" — it's **"what is the smallest unit I can destroy and cleanly recreate, and is the corruption confined to it?"** A request handler's corruption is usually confined to that request, so you shed the request (roll back, log, `500`) and keep serving — crashing the process would be a self-inflicted DoS. A corrupted global cache is process-wide, so continuing (even just for the next request) spreads bad state; there you *crash the process* and let a supervisor restart from known-good, durable state.

2. `CHECK` is **always-on** — it stays and aborts in release (`NDEBUG`) too; `DCHECK`/`assert` is **compiled out** in release. The deciding question is **"can I afford to be wrong about this in production?"** — safety/security/money/memory invariants get `CHECK` (a few cycles is worth never acting on corruption); expensive internal-consistency checks get `DCHECK`.

3. A `CHECK_LE(len, cap)` before a `memcpy` converts an out-of-bounds write (a write-what-where primitive an attacker escalates to code execution) into a **clean, deterministic abort** *before* the dangerous instruction. The attacker's best case drops from **arbitrary code execution to a crash (DoS)**, which a supervisor restarts. `__builtin_trap` is what hardened builds emit instead of calling `abort()`: a trapping instruction (`ud2`/`brk`) that can't be no-op'd or redirected by corrupting control flow — the same mechanism UBSan's trap mode uses.

4. It's fragile because (i) it's unreadable and the *condition is the last operand* (easy to misorder); (ii) the whole macro — side effect included — **still vanishes under `NDEBUG`**, so the effect you wanted doesn't run; (iii) comma overloading can change its meaning in C++. Correct: (a) run the side effect on its own line and `assert` a pure observation of the result (`int rc = init(); assert(rc==OK); (void)rc;`); (b) gate the expensive check in `#ifndef NDEBUG ... #endif` so its disappearance is explicit.

5. **Runtime check** catches the inputs you *actually hit*, cheaply, in the real environment — but only those, and a violation is a crash, not a proof. **Static verification** proves the postcondition for *every* input with zero runtime cost and no DoS risk — but requires the proof to go through (annotation + expertise) and doesn't see the real environment. They're the **runtime and static ends of one spectrum** discharging the *same* specification; choosing how far up to go is a per-invariant decision based on stakes. Formal methods is the static end of the line this topic is the runtime end of.

6. **Preconditions may only weaken (or stay equal); postconditions may only strengthen (or stay equal)** in a subclass. That's LSP made mechanical: a subtype must be usable anywhere the supertype is. If a subclass *strengthens* a precondition (demands more of the caller), code written against the parent's looser contract passes arguments the subclass rejects — substitutability breaks, polymorphic callers fail. (Eiffel enforces this with `require else` / `ensure then`.)

7. The hard part of fuzzing is the **oracle** — deciding a run is wrong. Without invariants a fuzzer only catches crashes/hangs; logic bugs that return plausible-but-wrong results pass. **Every assertion is a free oracle**: any input violating it is a found bug *with no crash needed* (e.g., tree no longer balanced). The assertions *you* write encode **domain** invariants (balance ≥ 0, output round-trips); a **sanitizer** inserts **language** invariants (no OOB access, no signed overflow). Enable both, and fuzz a build with `DCHECK`s on.

8. `assert(n % 8 == 0)` **verifies** the fact at the cost of a (cold-marked) branch and aborts loudly if it's false — but does nothing for the optimizer in release. `__builtin_assume(n % 8 == 0)` **tells the optimizer the fact is true without checking it**, enabling vectorization — but if it's ever false, that's **undefined behavior**: the compiler miscompiles silently, possibly far from the assumption, with no diagnostic. Disciplined pattern: `#define ASSUME(c) assert(c)` in debug (prove it loudly in testing) and `__builtin_assume(c)` in release (let the optimizer exploit it once you've gained confidence).

</details>

---

## Cheat Sheet

```
GRANULARITY OF FAILURE  (what to tear down on a violated invariant)
  confined to request  → roll back + log + 500, keep the process alive
  confined to actor/goroutine → recover/supervised restart from good state
  process-wide corruption → abort(); supervisor restarts (crash-only / let-it-crash)
  precondition: idempotent recovery from DURABLE state, never in-memory state

TWO TIERS  (decide per invariant: "can I be wrong about this in prod?")
  CHECK / CHECK_GE / CHECK_LE   always-on; aborts in release; safety/security/$
  DCHECK / assert               stripped under NDEBUG; expensive / internal checks
  failure → clean symbolized abort, NOT a segfault 3 frames later

EXPLOIT MITIGATION
  CHECK_LE(len, cap) before memcpy → OOB-write primitive becomes a clean crash
  __builtin_trap()  → ud2 / brk: un-skippable fault; hardened builds prefer over abort()
  same idea as UBSan trap mode (-fsanitize=undefined -fsanitize-trap)

NDEBUG FOOTGUN
  NEVER side effects in the condition (macro expands to NOTHING in release)
  effect on its own line + assert a pure observation; (void)rc to silence unused
  expensive check → #ifndef NDEBUG ... #endif  (NOT the comma-operator trick)

CONTRACTS = SPEC
  pre (caller's obligation) / post (callee's guarantee) / invariant
  pre fails → blame CALLER ; post fails → blame IMPLEMENTATION
  C++26 P2900: pre/post/contract_assert with ignore|observe|enforce
  SAME contract → runtime CHECK  OR  proven by Dafny/SPARK/Frama-C (formal methods)
  inheritance: preconditions WEAKEN, postconditions STRENGTHEN  (= LSP)

PERFORMANCE
  if (__builtin_expect(!(c),0)) ...   /  if (c) [[likely]]   → cold failure path
  sample: if ((rand() & 0x3FF)==0) CHECK(expensive())        → 0.1% of calls
  __builtin_assume(c) / std::unreachable()  → tells OPTIMIZER (UB if wrong!)
  pattern: ASSUME = assert(c) in debug, __builtin_assume(c) in release

CONCURRENCY
  evaluate the condition UNDER the lock that owns the data (off-lock = data race)
  TOCTOU: check + use in the SAME critical section (no lock release between)
  mu_.AssertHeld()  → "must hold mu_" from comment to enforced precondition

OBSERVABILITY  (a fired CHECK = reality broke a proof)
  symbolized stack + expr + build-id → crash aggregator (Crashpad/Sentry)
  dedup by call site; alert on RATE, tie to the deploy
  kernel: BUG_ON (panic) / WARN_ON (log+continue) / panic_on_warn (promote all)

FUZZING ORACLE
  every invariant = a free oracle (violation = bug, no crash needed)
  fuzz-friendly: cheap, total, round-trip (decode(encode(x))==x) / differential
  fuzz with DCHECKs ENABLED + a sanitizer (domain invariants + language invariants)
```

---

## Summary

- "Should I crash?" is the wrong question. The right one is **the granularity of failure**: tear down the smallest unit whose corruption is *confined* and that you can cleanly recreate — shed a request/goroutine/actor when corruption is local; crash the process when it's process-wide. **Crash-only software** and **let-it-crash + supervision** make crashing cheap and routine, which is what makes fail-fast affordable; the precondition is **idempotent recovery from durable state**.
- The ecosystem splits assertions into **`CHECK`** (always-on, survives release — for safety/security/money/memory) and **`DCHECK`/`assert`** (stripped under `NDEBUG`). The tier is chosen by one question: *can I afford to be wrong about this in production?* A few cycles for a `CHECK` is almost always the right price.
- An always-on `CHECK` is also an **exploit mitigation** — it downgrades a memory-corruption primitive to a clean crash, the same trick as `__builtin_trap` and UBSan's trap mode.
- The **`NDEBUG` side-effect footgun** is deep: the macro expands to *nothing*, so effects in the condition silently vanish — and the comma-operator "fix" is worse (unreadable, still vanishes). Run effects on their own line; gate expensive checks in `#ifndef NDEBUG`.
- **Contracts are a runnable, non-rotting specification**; pre/post assign *blame* (caller vs implementation). The *same* contract sits on a **spectrum** from runtime-checked (catches the inputs you hit) to statically **proven** (holds for all inputs) — connecting this topic directly to formal methods. Contract inheritance (**preconditions weaken, postconditions strengthen**) is the **Liskov Substitution Principle** made mechanical.
- **Every assertion is a free oracle**: a codebase dense with cheap, total, round-trip invariants gets dramatically more out of fuzzing — a violated invariant is a found bug with no crash needed — and a **sanitizer is just assertions the compiler inserts** (the language invariants on top of your domain ones).
- Make assertions nearly free with `__builtin_expect`/`[[likely]]` and sampling; make them *speed you up* with `__builtin_assume`/`std::unreachable` — but a wrong assumption is **UB**, so check-in-debug / assume-in-release. Assert shared state **under the lock**, check-and-use in one critical section. Finally, treat a fired `CHECK` as a **first-class, symbolized, deduplicated, rate-alerted signal** — the kernel's `BUG_ON`/`WARN_ON`/`panic_on_warn` triad is the canonical fleet-scale design.

The next layer — [professional.md](professional.md) — is about operating assertion and contract policy across an organization: rollout strategy for turning `CHECK`s on in a live fleet, the crash-reporting pipeline end to end, and the cultural work of making "let it crash" safe to adopt.

---

## Further Reading

- *Object-Oriented Software Construction* (2nd ed.) — Bertrand Meyer. The definitive treatment of Design by Contract: pre/postconditions, class invariants, and the contract-inheritance (LSP) rules, from the designer of Eiffel.
- ["Crash-Only Software"](https://www.usenix.org/legacy/events/hotos03/tech/candea.html) — George Candea & Armando Fox (HotOS IX, 2003). Why designing for crash-as-the-only-stop makes recovery cheap and reliable.
- ["Assert(false): A Personal Perspective on Assertions"](https://www.gwern.net/docs/cs/2002-hoare.pdf) / *Assertions: A Personal Perspective* — C.A.R. Hoare. The history and philosophy of assertions from the person who put them on the map.
- [abseil `CHECK` / `DCHECK` documentation](https://abseil.io/docs/cpp/guides/logging) and the [Chromium "Using CHECK, DCHECK, NOTREACHED" guide](https://chromium.googlesource.com/chromium/src/+/main/docs/security/check_failures.md) — the canonical two-tier assertion design and its security rationale.
- [P2900 — Contracts for C++](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2024/p2900r6.pdf) — the C++26 contracts proposal: pre/post/`contract_assert` with `ignore`/`observe`/`enforce` semantics.
- *Working Effectively with Legacy Code* — Michael Feathers, on using assertions to characterize and pin behavior before changing it.
- `man assert`, the LLVM and Linux-kernel `BUG_ON`/`WARN_ON` documentation, and the libFuzzer / property-testing guides for assertions-as-oracles.
- See [professional.md](professional.md) for operating assertion policy and the crash-reporting pipeline across an organization.

---

## Related Topics

- [01 — AddressSanitizer (ASan)](../01-address-sanitizer-asan/senior.md) — sanitizers as automatically-inserted memory-safety assertions; pair domain invariants with the language invariants ASan supplies.
- [03 — UndefinedBehaviorSanitizer (UBSan)](../03-undefined-behavior-sanitizer-ubsan/senior.md) — trap mode as compiler-inserted `CHECK`s, and why a wrong `__builtin_assume` is the same UB UBSan hunts.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md) — why a codebase dense with invariants gives a fuzzer a vastly better oracle; writing fuzz-friendly assertions.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the static end of the same spectrum: proving the *same* pre/postconditions for all inputs with Dafny, SPARK, and Frama-C.
- [Testing](../../testing/) — contracts as executable specification and oracles, and where assertions sit relative to unit, property, and integration tests.
