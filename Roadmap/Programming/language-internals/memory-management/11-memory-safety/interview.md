# Memory Safety — Interview Questions

> **Topic:** [Memory Safety](README.md)

A bank of interview questions on memory safety, framed for understanding and prevention. Questions progress from conceptual foundations through tool-specific knowledge, common traps, and open-ended design. Each includes a model answer outline so you can self-assess depth.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Define memory safety precisely. What are its component guarantees?**

Memory safety means every memory access touches valid, allocated, correctly-typed memory consistent with the program's declarations. It decomposes into: **spatial safety** (no out-of-bounds access), **temporal safety** (no access to freed/out-of-scope memory), **type safety** (no interpreting bytes as the wrong type), **initialization safety** (no reads of uninitialized memory), and sometimes **thread safety / data-race freedom** (since races can break the others). A strong answer names these separately and notes that "memory-safe" is a claim about a language's *safe subset*, not an absolute.

## Question 2

**Distinguish spatial from temporal safety with an example of each violation.**

Spatial is about *location*: a buffer overflow (writing `arr[10]` in a 10-element array) accesses memory outside the object's bounds. Temporal is about *time*: a use-after-free dereferences a pointer to memory already returned to the allocator. Spatial = wrong place; temporal = wrong time. Bonus: note that an out-of-bounds *read* (Heartbleed) leaks adjacent data, while a *write* corrupts it.

## Question 3

**Why are memory-safety bugs considered more dangerous than ordinary logic bugs?**

A logic bug yields a wrong answer; a memory-safety bug can silently corrupt unrelated data, leak adjacent secrets, or let attacker-controlled input overwrite control-flow data (return addresses, function pointers) and execute arbitrary code. That's why ~70% of *severe* CVEs at Microsoft, Google, Chromium, and Android are memory-safety bugs. They convert an ordinary mistake into a potential remote takeover.

## Question 4

**How does a garbage-collected language achieve temporal safety, and what does it cost?**

The GC frees an object only when it's no longer reachable, so no live reference can ever dangle — use-after-free and double-free are structurally impossible in safe code (you can't manually free). Costs: CPU for collection, GC pauses (latency), memory headroom (often 2–5x the live set), and non-deterministic destruction (no guaranteed cleanup point, complicating resource management).

## Question 5

**Explain how Rust achieves memory safety without a garbage collector.**

Compile-time ownership: each value has one owner and is dropped deterministically when the owner's scope ends (RAII). Borrowing with lifetimes lets the borrow checker prove no reference outlives its referent (temporal safety). The aliasing-XOR-mutability rule (`&T` shared-readonly, many; or `&mut T` unique-writable, one — never both) gives temporal safety *and* data-race freedom from a single invariant. The cost moves to compile-time and learning curve; the borrow checker conservatively rejects some sound programs.

## Question 6

**Is a garbage-collected language fully memory-safe? Address Go specifically.**

Not necessarily fully. Go is safe in *race-free* code but a data race on a multi-word value (slice header `ptr,len,cap`, or an interface value) can produce a *torn* value — a new pointer with an old length, for instance — leading to out-of-bounds access. So Go's spatial/temporal safety is *conditional on race-freedom*. This is why `go test -race` exists and races should be treated as safety bugs.

---

## Tool-Specific

## Question 7

**How does AddressSanitizer detect a heap buffer overflow and a use-after-free?**

ASan maintains **shadow memory** (1 shadow byte per 8 program bytes) recording addressability. It places poisoned **redzones** around each allocation; an overflow lands in a redzone, and the instrumented load/store checks the shadow byte and reports immediately with a stack trace. For use-after-free, freed memory is poisoned and held in a **quarantine** (not immediately reused), so a stale-pointer access hits poisoned shadow rather than someone else's live object. Cost is ~2x time and ~2x memory — test/CI only.

## Question 8

**What does MemorySanitizer catch that AddressSanitizer doesn't, and what's its catch?**

MSan catches reads of *uninitialized* memory (ASan does not track initialization). Its catch: it requires the *entire* program — including all libraries — to be instrumented, or it reports false positives from uninitialized values flowing out of uninstrumented code. ASan and MSan also can't run in the same build.

## Question 9

**Why is "fuzzing plus a sanitizer" more powerful than either alone?**

A sanitizer only detects violations on code paths that actually execute; a fuzzer generates inputs that drive execution into new, deep paths. Together: the fuzzer *reaches* the buggy path, the sanitizer *catches* the violation precisely (with a reproducing input). This combination (OSS-Fuzz) has found tens of thousands of memory bugs in open-source C/C++. Detection coverage = reachability × sanitization.

## Question 10

**What is MIRI and when do you use it?**

MIRI is an interpreter for Rust's mid-level IR (MIR) that detects undefined behavior in `unsafe` code — out-of-bounds via raw pointers, use-after-free, invalid values, uninitialized reads, and some data races — that ordinary tests and the compiler miss. You run `cargo miri test` to validate the `unsafe` islands in a Rust program, since the borrow checker doesn't verify `unsafe` blocks.

## Question 11

**Pick three hardware/OS mitigations and state what each stops and a limitation.**

For example: **ASLR** randomizes layout to defeat hardcoded-address exploits, but is bypassed by an info leak revealing a base address. **DEP/NX** blocks executing injected shellcode, but is bypassed by ROP (reusing existing executable code). **MTE** (ARM) tags memory and pointers and faults on a tag mismatch, catching both spatial and temporal bugs in hardware, but its 4-bit tag means ~1/16 of random mismatches slip through. A strong answer notes mitigations raise attacker cost rather than removing bugs; MTE/CHERI are different in attacking the root cause.

---

## Tricky / Trap

## Question 12

**True or false: a memory-safe language cannot leak memory. Explain.**

False. Leaking is *safe* — it's not a memory-safety violation. Java/Go/Python leak when a long-lived reference (cache, static list) keeps an object reachable; Rust leaks via `Rc` reference cycles or `std::mem::forget` (which is a *safe* function). Safety guarantees you won't access *invalid* memory; it says nothing about reclaiming *valid* memory you no longer need. Safety and leak-freedom are orthogonal.

## Question 13

**A junior says "Rust is safe, so this `unsafe` block is fine — it's only 3 lines." Why is that reasoning flawed?**

The blast radius of an `unsafe` bug is *not* the block. Safe code downstream trusts the invariants the `unsafe` block is supposed to uphold; a soundness bug there can corrupt safe code that contains no `unsafe` at all, and can even cause the optimizer to miscompile safe code (it assumed `&mut` uniqueness). The size of the block is irrelevant — what matters is whether it upholds its soundness contract for *all* inputs reachable from safe code. The cardinal sin is a safe-looking signature over unsound internals.

## Question 14

**Is a `NullPointerException` (or a bounds-check panic) a memory-safety *failure*?**

No — it's the safety mechanism *working*. The illegal dereference or out-of-range access was *caught* and converted into a defined, recoverable error instead of being allowed to corrupt memory. A panic on a bounds violation is the *defined* safe behavior. Confusing "the program threw an exception" with "memory safety failed" is a category error.

## Question 15

**Is an integer-overflow bug a memory-safety bug?**

It can be the *root cause* of one. Computing `count * size` for an allocation can overflow and wrap to a small value, allocating an undersized buffer that's then overflowed — a heap overflow. The arithmetic is the cause; the memory corruption is the consequence. This is why size calculations are safety-critical and why checked/saturating arithmetic matters. (An overflow that never feeds a size or index is "just" a logic bug.)

## Question 16

**Does compiling C/C++ with ASLR, DEP, stack canaries, and CFI make it memory-safe?**

No. Those are *exploit mitigations*, not safety — the bugs still exist; the mitigations only make specific exploitation techniques harder, and each is individually bypassable (info-leak defeats ASLR, ROP defeats DEP, canaries don't help against UAF or heap overflows, coarse CFI permits many targets). Chained bypasses routinely defeat the stack. They reduce risk and buy time; they don't deliver the *guarantee* a memory-safe language gives.

---

## Design

## Question 17

**You own a 5-million-line C++ service exposed to the internet. You can't rewrite it. Design a strategy to drive memory-safety vulnerabilities down.**

Layered, prioritized by the trust boundary: (1) **Mandate a memory-safe language for new code** — highest ROI, since bugs concentrate in new code (Android saw its memory-safety vuln *fraction* fall from ~76% to ~24% this way). (2) **Continuous fuzzing under sanitizers** (ASan/UBSan) for parsers and protocol handlers — the network-facing attack surface first. (3) **Sandbox untrusted-input components** (decoders) in confined processes or Wasm so a bug can't escape. (4) **Harden all native builds** with CFI, stack protector, `_FORTIFY_SOURCE`, and MTE where available. (5) **Incrementally rewrite** the highest-risk modules in Rust via FFI, treating the seam as a new audited boundary. (6) **Measure** the memory-safety vulnerability fraction over time as the program's leading indicator.

## Question 18

**You're choosing a language for a new low-latency networking component. Argue Rust vs. a GC language vs. C++.**

C++: maximum control and ecosystem, but no safety guarantee — a poor fit for network-facing code where memory bugs become remote exploits. A GC language (Go/Java): memory-safe and productive, but GC pauses threaten tail latency and you don't get data-race-freedom guarantees. Rust: total memory safety (including data-race freedom in safe code) with *no* GC and deterministic destruction — the best fit for low-latency *and* security-critical, at the cost of a steeper learning curve and a borrow checker that rejects some patterns. A strong answer ties the choice to the *trust boundary* and *latency budget* rather than dogma, and notes Rust's `unsafe`/FFI must still be audited.

## Question 19

**How would you review a Rust crate that advertises a "safe" API but uses `unsafe` internally?**

Verify *soundness encapsulation*: every public safe function must be sound for *all* inputs a safe caller can supply — there must be no input that drives it to UB. Read each `unsafe` block and its `// SAFETY:` comment, checking the stated invariant actually holds (bounds verified before `get_unchecked`, lifetimes respected, no aliasing of `&mut`). Run `cargo miri test` and fuzz the public API under sanitizers. The safe parts are guaranteed by the compiler; *all* the risk lives in the `unsafe` islands and the FFI boundary, so that's where review effort concentrates.

## Question 20

**Your team debates spending on MTE-capable hardware vs. more fuzzing infrastructure. How do you frame the decision?**

They address different parts of the lifecycle. **Fuzzing + sanitizers** is *pre-ship detection* — finds and lets you fix bugs before release, with precise repros; cost is engineering for harnesses/corpora and CI time, coverage-limited to reached paths. **MTE** is *production-time, root-cause mitigation/detection* — catches surviving spatial/temporal bugs on real devices at low overhead (~10–35%), but is probabilistic (4-bit tags) and needs hardware/OS/allocator support. They're complementary, not substitutes: fuzz to remove bugs early, deploy MTE to catch what slipped through in production. Frame it as defense-in-depth budgeting, weighted by attack surface and the cost of a field exploit.

---

*Self-assessment: you should be able to answer the Conceptual and Tricky questions crisply from memory, explain at least two tools mechanically (ASan + one other), and reason through the Design questions with explicit trade-offs and the "prioritize the trust boundary / measure the fraction" framing.*
