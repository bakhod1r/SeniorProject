# Evaluation Strategies (call-by-x) — Professional Level

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)
> **Focus:** What the calling convention actually does at the ABI level, how passing choices show up in flame graphs and allocation profiles, and how to design APIs where the parameter-passing contract is correct, fast, and impossible to misuse at scale.

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
13. [War Stories](#war-stories)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **At production scale, the parameter-passing choice is a performance contract, an ABI detail, and an API-misuse surface — all at once.** Get it right and it disappears; get it wrong and it shows up as p99 latency, allocation pressure, or a security bug.

By this tier the *what*, *when*, and *why* are settled. What remains is the part that decides whether a system is fast and safe in production: how the abstract strategy is realized by the **calling convention** (registers vs stack, who copies, who owns), how it manifests in **profiles** (deep copies in a CPU flame graph, thunk churn in an allocation profile, cache misses from pointer chasing), and how the *choice you encode in a signature* either prevents or invites bugs across a large codebase and a large team.

The throughline: every `f(x)` compiles to a concrete contract about who places the bytes where, who is responsible for the copy, and who owns the lifetime afterward. A `std::vector` passed by value becomes a heap allocation plus a `memcpy` in the System V AMD64 convention; passed by `const&` it becomes a single register holding a pointer. A Go slice "passed by value" copies a 24-byte header but **shares the backing array**, so a mutation through it leaks — a call-by-sharing trap hiding inside Go's call-by-value. Python's every argument is a refcount bump on a shared `PyObject*`. These are not academic distinctions; they are the difference between a service that holds SLO and one that pages someone at 3 a.m.

In one sentence: **professionally, parameter passing is where language semantics meet the ABI and the profiler, and where API signatures become the cheapest place to make misuse impossible.**

> 🎓 **Why this matters at the professional level:** You own the latency budget and the API surface. "Why is this endpoint allocating 4× what it should?" is often a by-value parameter on a hot path. "Why did this 'pure' function corrupt shared state in prod?" is often a shared mutable argument. And the fix is frequently a one-line signature change that the type system then enforces for everyone, forever.

This page covers calling-convention reality, the performance/allocation profile of each strategy, language-specific production traps (Go slice/map sharing, Python refcounts, JVM escape analysis, C++ ABI), and API design that encodes the right contract.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in junior/middle/senior — value/reference/sharing, strict/non-strict, name/need/thunks, the reduction-order grounding, and call-by-move.
- **Required:** Basic ability to read a CPU flame graph and an allocation/heap profile.
- **Required:** Awareness of what a calling convention / ABI is (registers, stack frame, caller/callee-saved).
- **Helpful but not required:** Exposure to one of: perf/pprof/async-profiler, C++ ABIs (Itanium/SysV), the Go memory model, CPython internals.

You do **not** need to know:

- The full register-allocation algorithm or every ABI's edge rules.
- GC implementation details beyond "shared references keep objects alive."

---

## Glossary

| Term | Definition |
|------|-----------|
| **Calling convention / ABI** | The binary contract for a call: which args go in which registers vs on the stack, who copies aggregates, who cleans up, caller/callee-saved registers. |
| **System V AMD64** | The dominant Unix x86-64 convention: first integer/pointer args in `rdi, rsi, rdx, rcx, r8, r9`; large aggregates passed by hidden pointer. |
| **Trivially copyable** | A type the compiler may copy with a bitwise `memcpy` (no user copy ctor/dtor). Affects whether by-value is a `memcpy` or a member-wise copy. |
| **Sret (struct return)** | "Structure return": a hidden pointer arg into which a large return value is constructed (enables RVO). |
| **Escape analysis** | Compiler analysis (JVM, Go) proving a value doesn't outlive the call, allowing stack allocation / scalar replacement instead of heap. |
| **Slice header** | Go's 3-word `{ptr, len, cap}`; copied by value on a call but pointing at a **shared** backing array. |
| **Refcount churn** | Per-argument increment/decrement of an object's reference count (CPython), a measurable cost and a cache/contention factor. |
| **Defensive copy** | Copying an incoming (or outgoing) mutable argument to break aliasing with the caller. Safety bought with allocation. |
| **TOCTOU via aliasing** | Time-of-check/time-of-use bug where a shared mutable argument changes between validation and use. |
| **Hot path** | Code executed at high frequency where per-call copy/alloc costs dominate latency and throughput. |

---

## Core Concepts

### 1. The Calling Convention Is the Real Strategy

"Call-by-value" is a source-language idea; the **ABI** decides what actually happens. Under System V AMD64:

- A small trivially-copyable struct passed by value may travel **in registers** — essentially free.
- A large struct passed by value is materialized in the caller's frame and passed **by hidden pointer**, and the callee may copy it — a real `memcpy`.
- A return of a large value uses **sret**: the caller passes a hidden destination pointer; the callee constructs the result in place. This is the ABI mechanism that makes RVO real — no copy *and* no move on return.

So "by value" can be free (registers) or expensive (memcpy) depending entirely on size and triviality. Reasoning about cost requires the ABI, not just the keyword.

### 2. The Performance Profile of Each Strategy

| Strategy | Shows up in a profile as | Typical hot-path cost |
|----------|--------------------------|------------------------|
| by-value (small/trivial) | nothing — args in registers | ~free |
| by-value (large) | `memcpy`/`__memmove` frames; high resident copies | O(size) per call |
| by-const-ref / pointer | pointer deref; cache misses on cold data | O(1) + memory latency |
| by-move | move ctor frames; near-zero copies | O(1) handle transfer |
| call-by-need / thunk | allocation profile churn; GC pressure; `force`/closure frames | alloc + force per arg |
| call-by-sharing | refcount inc/dec (CPython); write barriers (JVM/Go) | small but ubiquitous |

The two most common production findings: (a) a large value silently passed by value on a hot path → `memcpy` dominates the flame graph; (b) thunk/closure allocation per request → GC pauses and allocation-rate alerts.

### 3. Go: Call-by-Value With Sharing Hiding Inside

Go is strictly call-by-value — *every* argument is copied. The trap is **what** gets copied:

- A `[]T` slice copies its 3-word header but **shares the backing array** → mutating elements through the parameter leaks to the caller (call-by-sharing semantics on top of call-by-value).
- A `map[K]V` and `chan` are reference types: the copied value is a pointer to the same map/channel → shared.
- A large array `[N]T` or big struct copies the **whole thing** → silent O(N) copy on every call. Pass `*[N]T` or `[]T` instead.

So Go forces you to know which types are "headers over shared storage." `append` adds another twist: it may or may not reallocate, so whether a caller sees appended elements depends on capacity — a notorious source of bugs.

### 4. Python/JVM: Sharing Plus Lifetime Effects

In CPython, every argument is a `PyObject*` passed by value, with a **refcount bump** on bind and a decrement on scope exit. Implications at scale: refcount writes are cache-line traffic, they prevent some compiler optimizations, and they're why CPython's GIL and refcounting are intertwined. Passing a huge object is cheap (one pointer + one refcount op) but **shared** — defensive copies cost real memory.

On the JVM, arguments are references (call-by-sharing) or primitives (by value). **Escape analysis** can prove a passed object doesn't escape the callee and **stack-allocate or scalar-replace** it, erasing the heap allocation entirely — so "everything is heap" is false in practice. But escape analysis is fragile: storing the argument in a field, returning it, or passing it to an un-inlined method defeats it. Knowing what keeps an argument from escaping is a real JIT-performance skill.

### 5. The API Signature Is a Misuse-Prevention Tool

At scale, the parameter-passing choice in a signature is the cheapest, most durable safety mechanism you have, because the compiler enforces it for everyone:

- `const T&` / `&T` (immutable borrow) says "I will read, not keep, not mutate" — and the compiler enforces no-mutate (C++ `const`, Rust shared borrow).
- `T&&` / `T` by value (sink) says "give me ownership" — Rust makes the source unusable, preventing accidental later use.
- A by-value copy of a small immutable type makes a function provably side-effect-free in its argument.
- Returning a new value instead of mutating an out-param removes the aliasing question entirely.

A correct signature turns a class of runtime bugs into compile errors. That leverage is why senior+ engineers obsess over signatures.

### 6. Cost vs Safety Is a Real Tradeoff, Not a Dogma

"Always pass by const-reference for big objects" is a good default but not a law. A const-reference can **alias** the caller's mutable state, enabling TOCTOU and re-entrancy bugs; it can **dangle** if stored; and pointer-chasing has its own cache cost. Sometimes a defensive copy (or a move) is *both* safer and, after escape analysis/RVO, not measurably slower. The professional move is to **measure**, not to recite a rule.

---

## Real-World Analogies

**Calling convention — the loading dock's standard operating procedure.** Two companies can agree "we trade goods" (call-by-value), but the *dock* decides whether small parcels go through the express slot (registers) or a pallet gets forklifted and re-stacked (memcpy of a large aggregate). The contract is abstract; the dock SOP is where time is actually spent.

**Go slice sharing — handing someone the coordinates of your storage unit, on a copied index card.** They get a copy of the card (the header), but it points to *your* unit. Rearrange the boxes (mutate elements) and you both see it; build a whole new unit (reallocating `append`) and only they know the new address.

**Refcount churn — a sign-in/sign-out sheet at a shared archive.** Every time anyone borrows the same document, they sign in; on leaving, they sign out. Cheap per person, but at thousands of accesses a second, the sign-in desk itself becomes the bottleneck.

**Escape analysis — the JIT noticing a rental never leaves the building.** If a borrowed tool is provably returned before you leave the room, the manager lets you grab it off a local shelf (stack) instead of filing paperwork with central inventory (heap). Hand it to someone who walks out (escape) and the paperwork is mandatory again.

---

## Mental Models

**Model 1: "The keyword is a request; the ABI is the contract."** `by value` may compile to registers, a memcpy, or sret. Always ask "what size, what triviality, what convention?" before assuming a cost.

**Model 2: "In GC languages, passing also touches lifetime."** A shared reference keeps the object alive and may pin it; a refcount bump is a write; a captured argument in a thunk/closure extends lifetime. Passing is not free of memory-management consequences.

**Model 3: "Aliasing is a correctness *and* a performance axis."** Aliasing enables mutation bugs and TOCTOU (correctness) *and* defeats compiler optimizations that assume non-aliasing (performance — this is why `restrict` exists in C).

**Model 4: "The signature is the cheapest enforcement point."** One `const`/`&mut`/owned choice, enforced by the compiler, beats a hundred code-review comments and runtime assertions.

**Model 5: "Measure copies in the flame graph, allocations in the heap profile."** Large-by-value → memcpy frames. Thunk/closure churn → allocation rate. Sharing bugs → not in a profile at all; they're in a correctness test.

---

## Code Examples

### Example 1: The Hot-Path By-Value Copy (and Its Fix)

```cpp
// BEFORE: each call deep-copies a potentially huge config (memcpy in the flame graph)
Result handle(Config cfg, const Request& req);   // Config by value

// AFTER: borrow it; the caller still owns it; zero copy
Result handle(const Config& cfg, const Request& req);

// If 'handle' must STORE the config, take it by value and move (sink idiom):
struct Handler {
    Config cfg_;
    explicit Handler(Config cfg) : cfg_(std::move(cfg)) {}  // copy-or-move once, then steal
};
```

### Example 2: The Go Slice Aliasing Trap

```go
func normalize(xs []float64) {
    for i := range xs {
        xs[i] /= total(xs)   // mutates the CALLER's backing array — shared!
    }
}

data := []float64{1, 2, 3}
normalize(data)              // data is modified in place, even though "passed by value"

// And the append surprise:
func addZero(xs []int) []int {
    return append(xs, 0)     // may or may not realloc; caller sees the change ONLY if no realloc
}
```

The fix when you must not mutate the caller: copy explicitly with `append([]float64(nil), xs...)` or `slices.Clone`.

### Example 3: CPython — Sharing and the Defensive-Copy Cost

```python
def add_audit_fields(record: dict) -> dict:
    record["audited_at"] = now()   # MUTATES caller's dict — shared reference
    return record

# Safe version pays a copy:
def add_audit_fields_safe(record: dict) -> dict:
    record = dict(record)          # shallow copy breaks aliasing (real memory cost)
    record["audited_at"] = now()
    return record
```

At high throughput, the defensive `dict(record)` is a measurable allocation; whether to pay it is a real design decision, not an automatic "always copy."

### Example 4: JVM Escape Analysis in Action

```java
// 'point' may be scalar-replaced (no heap alloc) IF it doesn't escape:
int dist(int x, int y) {
    Point p = new Point(x, y);   // escape analysis can eliminate this allocation
    return p.x * p.x + p.y * p.y;
}

// Escape DEFEATED — now it must live on the heap:
Point cache;
int distLeaky(int x, int y) {
    Point p = new Point(x, y);
    cache = p;                   // p escapes via a field → real allocation
    return p.x * p.x + p.y * p.y;
}
```

### Example 5: Encoding the Contract in the Type System

```rust
fn read_only(cfg: &Config) { /* compiler forbids mutation */ }
fn update(cfg: &mut Config) { cfg.retries += 1; }      // exclusive, explicit
fn take(cfg: Config) { /* owns it; caller can't use cfg afterward */ }

// Misuse is a COMPILE ERROR, enforced for the whole codebase:
let c = Config::default();
take(c);
// read_only(&c);  // error: borrow of moved value 'c'
```

---

## Pros & Cons

### Borrowing on hot paths (const-ref / shared borrow)

**Pros:** zero copy, lowest latency for large read-only inputs; the production default.
**Cons:** aliases caller state (TOCTOU, re-entrancy risk); can dangle if stored; pointer-chasing cache cost; defeats no-alias optimizations.

### Defensive copy / by value for isolation

**Pros:** breaks aliasing → eliminates a class of correctness bugs; enables no-alias optimizations; safe to hand to other threads.
**Cons:** allocation + copy cost; GC pressure; can dominate a hot path if the value is large.

### Move / ownership transfer

**Pros:** isolation at O(1); the right tool for sinks; statically safe in Rust.
**Cons:** moved-from hazard in C++; needs careful API design; can't share.

### Laziness / thunks at scale

**Pros:** skips unneeded work; enables streaming and back-pressure.
**Cons:** allocation churn, GC pressure, unpredictable when effects/latency land; profiling and reasoning get harder.

---

## Use Cases

- **Const-ref / borrow** for large request/config objects on request paths — the default high-performance read contract.
- **By value + move (sink)** for constructors and functions that store the argument.
- **Defensive copy** at trust/thread boundaries where the caller's object must not be mutated and aliasing across threads is unsafe.
- **Move** for transferring buffers to I/O, ownership of locks/handles, and builder pipelines.
- **Laziness/thunks** for deferred-default computation, lazy logging, and streaming pipelines where the consumer may stop early.
- **Small-by-value** for cache-friendly numeric/POD types where register passing wins.

---

## Coding Patterns

**Pattern: Default to borrow, escalate deliberately.** Start every parameter as a read-only borrow; promote to `&mut`/owned/move only when the function's job demands it. The signature documents and enforces intent.

**Pattern: Sink-by-value-then-move** (C++/Rust) so one signature optimally handles both lvalue and rvalue callers.

**Pattern: Copy at the boundary, share within the core.** Defensive-copy untrusted/cross-thread inputs once at the edge; pass borrows freely inside the trusted core where you control aliasing.

**Pattern: Return, don't out-param.** In languages with cheap multiple returns (Go, Rust, Python), return tuples/structs and rely on RVO/sret rather than mutating caller variables.

**Pattern: Make the hot path allocation-free.** On the critical path, prefer borrows and pre-allocated buffers over by-value copies and thunks; verify with an allocation profiler.

---

## Best Practices

1. **Profile before changing a passing strategy.** "Pass by reference for speed" is a hypothesis; the flame graph (copies) and heap profile (allocations) are the evidence.
2. **Encode the contract in the signature** so the compiler enforces no-mutate / single-owner across the whole codebase.
3. **Know your language's hidden sharing:** Go slices/maps, Python/JVM object references. Treat any mutable shared argument as mutable-by-the-callee unless proven otherwise.
4. **Defensive-copy at trust and thread boundaries**, not everywhere; copies cost memory and GC time.
5. **Prefer move over copy for sinks; prefer borrow over move/copy for reads.**
6. **On hot paths, drive copies and per-call allocations toward zero**, and let escape analysis / RVO / strictness analysis do the rest — but verify they actually fired.
7. **Never store a borrowed reference past the call** unless lifetime is guaranteed; that's how dangling and use-after-free happen.

---

## Edge Cases & Pitfalls

**Pitfall 1: Large-by-value on a hot path.** A big struct/array passed by value compiles to a per-call `memcpy`. Classic flame-graph surprise; fix with a borrow or move.

**Pitfall 2: Go `append` capacity aliasing.** Whether the caller sees appended elements depends on whether `append` reallocated — non-deterministic from the call site. Clone when you need isolation.

**Pitfall 3: Defensive copy that's only shallow.** Copying the outer container but sharing inner mutable objects leaves an aliasing leak. Deep-copy when the inner objects are mutable and must be isolated.

**Pitfall 4: TOCTOU through an aliased argument.** Validate a shared mutable argument, then act on it, and a concurrent (or re-entrant) mutation between the two steps invalidates the check. Copy or snapshot before validating.

**Pitfall 5: Escape analysis silently failing.** A refactor that stores or returns a previously-local argument re-introduces a heap allocation and a latency regression with no source-level "smell." Watch allocation profiles across refactors.

**Pitfall 6: Moved-from object reused (C++).** After `std::move`, the source is valid-but-unspecified; reading it is a latent bug that may pass tests and fail under load/optimization. Treat moved-from as dead.

**Pitfall 7: Thunk/closure capturing a large object.** A deferred argument that closes over a big structure keeps it alive (and out of the nursery), inflating memory and GC time until forced.

---

## War Stories

**The 4× allocation endpoint.** A request handler took its `Config` (a few hundred KB after expansion) **by value**. Each request deep-copied it; under load the allocator and GC became the bottleneck and p99 tripled. The fix was a one-character change — `Config` → `const Config&` — confirmed by the disappearance of `memcpy` frames from the flame graph and a 60% drop in allocation rate. The lesson: a passing-strategy bug looks like an infra problem.

**The mutated audit log.** A "pure-looking" `enrich(record)` helper in a Python pipeline mutated its `dict` argument (call-by-sharing). Because the same `dict` was reused downstream, audit records cross-contaminated under concurrency, producing wrong-but-plausible logs that survived review for months. The fix: snapshot at the boundary (`record = dict(record)`), then enforce immutability further in. The lesson: shared mutable arguments make "pure" functions impure.

**The Go slice that grew behind the caller's back.** A worker called `buf = append(buf, item)` on a slice it had received as a parameter, assuming the caller would see all appends. When the slice had spare capacity, the caller's view *did* update (shared backing array); when `append` reallocated, it silently did not. The result was intermittent, capacity-dependent data loss. The fix: return the new slice and reassign at the caller (`buf = worker(buf)`), the idiomatic Go contract for "append may reallocate."

**The dangling const-reference.** A C++ cache stored a `const std::string&` parameter into a member, expecting the caller to keep the string alive. Callers passed temporaries; the reference dangled; reads returned garbage intermittently under optimization. The fix: store by value (or `std::string` + move). The lesson: a reference is a borrow, never ownership — never persist one past the call.

---

## Test Yourself

1. Why can "call-by-value" cost anywhere from zero to O(size)? What decides?
2. Why does mutating a Go slice element inside a function leak to the caller, while reassigning the slice doesn't?
3. What does escape analysis do, and name two things that defeat it.
4. When is a defensive copy the *right* call despite its cost?
5. How does a parameter-passing choice in a signature prevent bugs across an entire team?
6. Why is "always pass big objects by const-reference" an incomplete rule?

<details>
<summary>Answers</summary>

1. The **ABI** decides: small trivially-copyable values travel in registers (≈free); large aggregates are passed by hidden pointer and `memcpy`'d (O(size)). Size and triviality, not the keyword, set the cost.
2. A Go slice value is a 3-word header **copied by value** but pointing at a **shared backing array**; element mutation goes through the shared array (leaks), while reassigning the local header re-points only the copy (doesn't leak).
3. It proves a value doesn't outlive the call, allowing **stack allocation / scalar replacement** instead of heap. Defeated by **storing the argument in a field/global**, **returning it**, or **passing it to an un-inlined method** — anything that lets it escape.
4. At **trust or thread boundaries**, or before **validating** a shared mutable argument (to avoid TOCTOU) — when breaking aliasing prevents a correctness bug worth more than the allocation.
5. The compiler **enforces** the contract (`const`/`&mut`/owned) for every call site, turning a class of runtime mutation/ownership bugs into compile errors — cheaper and more durable than review or assertions.
6. A `const&` **aliases** the caller's mutable state (TOCTOU/re-entrancy), can **dangle** if stored, and has pointer-chasing cache costs; sometimes a copy or move is both safer and, after RVO/escape analysis, not measurably slower. Measure.

</details>

---

## Cheat Sheet

```text
KEYWORD vs ABI:
  by-value small/trivial → registers (free) ; by-value large → memcpy via hidden ptr (O(size))
  large return → sret hidden pointer → RVO (no copy, no move)

PROFILE SIGNATURES:
  memcpy/__memmove frames  → large-by-value on hot path
  allocation-rate spikes    → thunk/closure churn or defensive copies
  refcount inc/dec (CPython)→ per-arg sharing cost
  no profile hit at all      → a SHARING/aliasing CORRECTNESS bug

HIDDEN SHARING:
  Go: []T copies header, SHARES backing array ; map/chan are refs ; [N]T copies whole thing
  Go append: may realloc → caller-visibility is capacity-dependent → return the slice
  Python/JVM: args are shared object refs ; JVM escape analysis can stack-allocate (fragile)

API CONTRACTS (compiler-enforced):
  borrow/const& = read, don't keep, don't mutate
  &mut / ref     = exclusive mutate
  by-value/move  = take ownership (Rust: source unusable)
  return > out-param when multiple returns are cheap

RULES OF THUMB (then MEASURE):
  default borrow → escalate to &mut/move/own only when the job needs it
  defensive-copy at trust/thread boundaries, share in the trusted core
  never persist a borrowed ref past the call (dangling)
```

---

## Summary

- The source keyword is a **request**; the **calling convention/ABI** is the real contract — by-value ranges from free (registers) to O(size) (`memcpy`), and `sret`/RVO makes returns free.
- Each strategy has a **profile signature**: large-by-value → memcpy frames; thunks/defensive copies → allocation churn; sharing bugs → *no* profile hit, only failing correctness tests.
- Languages hide sharing in plain sight: **Go slices share backing arrays** (and `append` aliasing is capacity-dependent), **Python/JVM pass shared object references** (with refcount churn / escape-analysis nuance).
- The **signature is the cheapest, most durable misuse-prevention tool**: encode read/mutate/own in the type and let the compiler enforce it for everyone.
- **Cost vs safety is a measured tradeoff**, not a slogan: const-ref aliasing and dangling are real, defensive copies and moves are sometimes both safer and fast enough — profile before deciding.
- Production discipline: default to borrow, escalate deliberately, copy at boundaries, never persist a borrow, and drive hot-path copies/allocations toward zero with profiler evidence.

---

## Further Reading

- The System V AMD64 ABI document (argument passing, sret, register classes) and your platform's equivalent.
- The Go memory model and the official Go blog posts on slices, `append`, and slice internals.
- CPython internals on reference counting and argument handling; the HotSpot JVM docs on escape analysis and scalar replacement.
- The C++ Core Guidelines parameter-passing section (in/out/in-out/sink conventions) and the Rust ownership/borrowing reference.
- The `interview.md` and `tasks.md` pages in this topic to pressure-test the material.
