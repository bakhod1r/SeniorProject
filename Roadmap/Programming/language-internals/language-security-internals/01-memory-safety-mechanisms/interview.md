# Memory-Safety Mechanisms — Interview Questions

> **Topic:** [Memory-Safety Mechanisms](README.md)
> **Focus:** Interview-ready questions on memory safety — the bug taxonomy, language strategies (C/C++ discipline, Rust borrow checker, GC-based safety, Swift ARC), detection/mitigation tooling, hardware enforcement, and design judgment.

---

## Introduction

This file is a question bank, not a tutorial. Questions are grouped:

- **Conceptual / Foundational** — the model: spatial vs temporal, the bug taxonomy, why ~70% of severe CVEs are memory-safety.
- **Language-Specific** — C/C++ unsafety, Rust's borrow checker, GC-based safety (Java/Go) and its leaks, Swift ARC.
- **Tricky / Trap** — the questions that separate "read the docs" from "understands the mechanism."
- **Design** — judgment calls a senior/staff engineer must defend.

Each question has a crisp model answer. Treat the answers as the *floor* of a good response; in a real interview you'd add examples and ask clarifying questions.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)

---

## Conceptual / Foundational

## Question 1

**Q: Define memory safety. What are its two halves?**

Memory safety is the guarantee that a program only accesses memory that is allocated to it, still alive, and within its real bounds (and of its real type). It has two halves: **spatial safety** — staying *within the bounds* of an allocation (no out-of-bounds read/write, no buffer overflow); and **temporal safety** — only accessing memory *while it is alive* (no use-after-free, double-free, or dangling pointer). A language is fully memory-safe only if it guarantees *both*.

## Question 2

**Q: Walk through the memory-safety bug taxonomy.**

Spatial: **stack buffer overflow** (write past a stack array, dangerous because the return address is nearby), **heap buffer overflow** (corrupts neighbouring heap data or allocator metadata), **out-of-bounds read** (can leak secrets — Heartbleed), **OOB write** (corruption). Temporal: **use-after-free** (use freed memory the allocator may have reused), **double-free** (corrupts the free-list), **dangling pointer** (pointer to freed/out-of-scope data). Others: **uninitialized read** (read garbage leftover bytes), **type confusion** (treat bytes as the wrong type → wild pointers inside), **null dereference** (follow a NULL pointer — usually a clean crash / DoS).

## Question 3

**Q: Why are roughly 70% of severe vulnerabilities in C/C++ codebases memory-safety bugs?**

Both Microsoft (MSRC) and the Chromium team independently reported that ~70% of their high-severity security bugs are memory-safety issues. The cause is structural: C/C++ are *unsafe by default* — arrays carry no length, you free memory manually, and violations are *undefined behavior* (silent, layout-sensitive). Expert engineers being careful still produce this rate, which is the whole argument: safety can't come from discipline alone at scale; it has to come from the language/runtime/hardware making the bug impossible or always-caught.

## Question 4

**Q: Why is spatial safety cheaper to enforce than temporal safety?**

Spatial safety needs only *local* information — the bounds of the object you're accessing. Carry a length, check the index: a predictable branch the optimizer often eliminates entirely. Temporal safety needs a *global, time-varying* fact — "is this exact object still the live object it was when the pointer was made?" There's no cheap local check for "still alive." Enforcing it requires never reusing memory (GC, quarantine — memory cost), per-object liveness tracking, or hardware machinery (MTE re-tagging, CHERI revocation). Any disproportionate machinery you see is almost always buying *temporal* safety.

## Question 5

**Q: What is undefined behavior and why does it make C memory bugs so dangerous?**

Undefined behavior (UB) means the C/C++ standard imposes *no requirements* on what happens if the program does something illegal (OOB access, UAF, signed overflow, etc.). The program may crash, silently corrupt data, or appear to work — and the optimizer is allowed to *assume UB never happens*, which can make the bug behave even more strangely and far from its cause. This is why memory bugs in C are intermittent, layout-sensitive "Heisenbugs" that often don't crash where the mistake is.

## Question 6

**Q: What is a bounds check, and why doesn't C just add them?**

A bounds check is a runtime test — "is `0 <= index < length`?" — inserted before an array access; if it fails, the program throws/panics instead of corrupting memory. C can't easily add them because a C array *is just a pointer* — at the access point, the length isn't even available; the language discarded it. Safe languages keep arrays as "pointer **+ length**" (a fat representation) so the check is *possible*. And optimizers eliminate provable checks, so the cost is usually near zero.

## Question 7

**Q: List the four broad language strategies for memory safety.**

(1) **Unsafe by default + discipline + tooling** (C/C++): no guarantees; safety from care plus sanitizers (testing) and hardened allocators (production). (2) **Garbage collection** (Java/Go/C#/JS): bounds checks for spatial safety, a tracing GC and no manual free for temporal safety. (3) **Ownership/borrowing checked at compile time** (Rust): bugs become compile errors at zero runtime cost, with `unsafe` as an audited escape hatch. (4) **Automatic reference counting** (Swift/ObjC): deterministic frees at refcount zero, with retain cycles as the weak spot.

## Question 8

**Q: Why is an out-of-bounds *read* dangerous even though it corrupts nothing?**

Because it can *leak secrets*. Reading past a buffer returns whatever adjacent memory holds — which may be private keys, session tokens, or other users' data. Heartbleed was exactly this: an OOB read that returned chunks of server memory, including TLS private keys, to attackers. Information disclosure is a first-class severity, not a "harmless" bug.

## Question 9

**Q: Why is use-after-free often worse than a plain crash?**

After `free`, the allocator typically *reuses* that memory for a different object. A dangling pointer then operates on bytes that now belong to something else — two pieces of code believe they own the same memory. If an attacker can control *what* gets placed in the freed region (heap grooming), the dangling pointer reads/writes attacker-chosen data, which is how UAF escalates from a crash into type confusion and code execution.

---

## Language-Specific

### C / C++ (unsafe-by-default)

## Question 10

**Q: Name the unbounded C functions you should avoid and their safer replacements.**

`gets` (never use it — no size argument at all), `strcpy`/`strcat` (no destination bound; prefer `strncpy`/`strlcpy` used carefully, or a length-carrying API), `sprintf` (prefer `snprintf` with `sizeof(dst)`). The general principle: avoid any function that writes until a terminator with no knowledge of the destination's capacity. Carry sizes explicitly and prefer the bounded variant.

## Question 11

**Q: What does `_FORTIFY_SOURCE` do, and what is its blind spot?**

When the compiler can determine a destination buffer's size at compile time, `_FORTIFY_SOURCE` (=2/=3) replaces libc calls like `memcpy`/`strcpy`/`sprintf` with `__*_chk` variants that verify the copy fits and abort on overflow. It's free at runtime when sizes are known. Blind spot: when the destination size is *not* compile-time known, it does nothing. `=3` widens coverage using `__builtin_dynamic_object_size`.

## Question 12

**Q: How does a stack canary work, and what does it not stop?**

A stack canary is a random value placed between local buffers and the saved return address, checked on function return. A *linear* stack buffer overflow that overwrites the return address must pass through the canary, corrupting it → the check fails → abort before the corrupted return is used. It does *not* stop *targeted* writes that skip over the canary (e.g. an indexed write directly to the return address), nor non-control-data attacks.

## Question 13

**Q: When would you use AddressSanitizer versus Valgrind/Memcheck?**

ASan: compiler-instrumented (needs recompile), ~2× slowdown, strong on stack/global/heap OOB (redzones) plus UAF/double-free (quarantine), great for CI + fuzzing. Valgrind/Memcheck: runs an unmodified binary on a synthetic CPU (no recompile), catches uninitialized reads/OOB/leaks, but is much slower (10–50×) and weak on stack/global OOB. Use ASan for speed and stack coverage; Valgrind when you can't recompile or want leak detection on an arbitrary binary.

## Question 14

**Q: Does ThreadSanitizer relate to memory safety?**

Yes — TSan detects data races, and in many languages a data race is itself undefined behavior that can corrupt memory or break type safety (e.g. tearing a multi-word value). So race-freedom is often a *precondition* of the memory-safety guarantee, and TSan defends that precondition.

### Rust (borrow checker)

## Question 15

**Q: Explain ownership, moves, and how they prevent double-free and use-after-move.**

Every value has exactly one owner; when the owner goes out of scope, Rust runs its `drop` (destructor) *exactly once* — so you can't double-free. Assignment/passing *moves* ownership by default; after a move the source binding is *invalidated*, and using it is a compile error — preventing the C++ trap of two objects owning one buffer (double-free) or using a value after it's been given away.

## Question 16

**Q: State "aliasing XOR mutability" and explain why it gives safety.**

At any moment, for a given value, you may have *either* any number of shared references `&T` (read-only) *or* exactly one mutable reference `&mut T` (read-write) — never both. The deepest cause of memory corruption is "mutation while another part of the code holds a pointer assuming the data didn't change" (iterator invalidation, modify-while-borrowed, data races). Forbidding simultaneous alias+mutate makes that whole family *un-typable* — a compile error.

## Question 17

**Q: What are lifetimes, and do they cost anything at runtime?**

A lifetime is the compile-time span over which a reference is valid. The borrow checker proves every reference's lifetime is contained within the lifetime of the data it points to, so a reference can never outlive its data (no dangling pointers — e.g. returning `&x` to a local is rejected). Lifetimes are pure compile-time proof annotations with *zero* runtime representation or cost.

## Question 18

**Q: What does `unsafe` actually do, and why isn't it "cheating"?**

`unsafe` unlocks five extra powers (deref raw pointers, call `unsafe` functions, access `union` fields, access/modify mutable statics, implement `unsafe` traits). It does *not* disable the borrow checker for the surrounding code. It marks a small, greppable region where the human asserts invariants the compiler can't verify. It isn't cheating because some operations (FFI, hardware, certain data structures) are *unverifiable* statically; confining unsafety to a tiny audited surface — wrapped behind a safe API — is the realistic form of safety at scale. `std` itself is built on audited `unsafe`.

## Question 19

**Q: How does Rust prevent data races at compile time?**

The same aliasing-XOR-mutability rule plus the `Send`/`Sync` marker traits. A data race requires two threads, at least one writing, with no synchronization — i.e. aliasing + mutation across threads. `Send` controls what can move between threads; `Sync` controls what can be *shared* (`&T` across threads). The type system rejects sharing a type across threads in a way that would allow concurrent unsynchronized mutation, so data races become compile errors.

### Java / Go (GC-safe)

## Question 20

**Q: How does a garbage-collected language achieve temporal safety?**

There is no manual `free`. A tracing GC reclaims only *unreachable* objects, so any reference you still hold points to a live object. You can't free at the wrong time because you can't free at all — use-after-free and double-free are structurally impossible for ordinary code.

## Question 21

**Q: "Go is memory-safe." State the exceptions precisely.**

Three: (1) **Explicit escape hatches** — `unsafe.Pointer` (pointer arithmetic/type punning) and **cgo** (calling C) leave the safe world. (2) **Data races break safety, not just correctness** — a Go interface/slice is multi-word; an unsynchronized concurrent write can *tear* it into a mismatched (type-ptr, data-ptr) pair, and dereferencing that mismatched type pointer is type confusion → memory corruption. The Go memory model explicitly says racy programs aren't guaranteed memory-safe. (3) The **runtime itself is C++/Go-runtime code** — runtime bugs are platform memory-safety bugs. So: race-free Go using no `unsafe`/cgo is memory-safe.

## Question 22

**Q: Why does the Go race detector matter for *safety*, not just bugs?**

Because in Go a data race can produce a torn multi-word value (e.g. an interface with a type pointer that doesn't match its data pointer), which is genuine type confusion and memory corruption inside a "safe" language. Race-freedom is therefore a *precondition* of Go's memory-safety guarantee, and `go test -race` defends that precondition — findings should be release blockers.

## Question 23

**Q: Does the JVM bytecode verifier contribute to memory safety?**

Yes. The verifier checks bytecode before execution to ensure type-safe operations, valid stack usage, and that you can't, say, treat an `Object` reference as an `int[]` and forge a wild pointer. Combined with bounds checks and the GC, it prevents type confusion and raw memory corruption that the language could otherwise allow via crafted bytecode.

## Question 24

**Q: Does GC eliminate *all* memory problems?**

No. GC eliminates *use-after-free from your own frees* and double-free. You can still: **leak** logically (keep references you don't need — the GC can't reclaim reachable objects), have **data races** corrupt memory in some runtimes, and reintroduce unsafety via `Unsafe`/cgo/JNI. GC also doesn't promptly release *non-memory* resources (files, sockets) — use `try-with-resources`/`defer`, not the GC, for those.

### Swift (ARC)

## Question 25

**Q: How does ARC provide memory safety, and how does it differ from tracing GC?**

ARC inserts `retain`/`release` calls so each object tracks its strong-reference count; at zero, `deinit` runs and the object is freed *immediately and deterministically*. Like GC, you never free manually (temporal safety); unlike GC, reclamation is deterministic (no pauses, lower footprint) — but it pays per-refcount traffic and, crucially, can't reclaim reference cycles on its own.

## Question 26

**Q: What is a retain cycle and how do you break it? Contrast `weak` and `unowned`.**

A retain cycle is two objects holding strong references to each other; their counts never reach zero → permanent leak (ARC has no tracing pass to find cycles). You break it by making one side non-owning: **`weak`** doesn't increment the count and auto-nils to `nil` when the referent deallocates (safe — accessing it yields nil), useful when the referent may outlive or be shorter-lived; **`unowned`** doesn't increment and *assumes* the referent outlives the reference — cheaper (non-optional, no side-table), but if that assumption is violated you get a use-after-free. So default to `weak`; use `unowned` only when you can *prove* the lifetime relationship.

---

## Tricky / Trap Questions

## Question 27

**Q: "My program runs fine, so it's memory-safe." What's wrong with this reasoning?**

In C/C++, memory bugs are *undefined behavior* and frequently *dormant* — the OOB write or UAF lands on currently-unused or harmless memory, so the program appears to work. It will fail when the memory layout shifts (new compiler, added struct field, different input). "It works on my machine" is in fact the *signature* of a latent memory bug. Only a sanitizer run (ideally with fuzzing) or a safe language gives real assurance.

## Question 28

**Q: AddressSanitizer reports no errors. Is the code memory-safe?**

No — it's *evidence*, not *proof*. ASan found nothing *on the inputs you ran*, *within the quarantine's finite capacity* (a UAF whose freed block was evicted and reused before the bad access is missed), and *in instrumented code* (uninstrumented libraries are blind spots; MSan especially). Also, a wild access that *jumps over* the redzone into valid memory isn't caught. Pair ASan with fuzzing, enlarge quarantine when hunting UAF, and remember the limits.

## Question 29

**Q: Why does a 4-bit MTE tag (only 16 values) provide useful protection?**

Per *single* access there's a 1/16 chance a wild access collides with the matching tag and is missed. But useful exploitation needs *reliable, repeated* control, and bug *discovery* across a fleet aggregates over billions of accesses — so a 15/16 per-access catch rate makes both detection and exploitation overwhelmingly likely to trip a fault. It's a *probabilistic mitigation*, not a deterministic guarantee, but probabilistic-and-pervasive-and-cheap beats deterministic-but-unaffordable for fleet defense.

## Question 30

**Q: Is MTE "memory safety"? Is a stack of mitigations (ASLR + canary + CFI) "memory safety"?**

Neither, strictly. MTE is a strong *probabilistic mitigation* (1/16 miss). ASLR/canary/CFI/DEP are *mitigations* that make exploitation harder but are independently bypassable (info leak defeats ASLR, tag guess defeats MTE, gadget chains defeat CFI), and stacking them doesn't compose into a *guarantee* because attackers chain bypasses. True memory safety (safe languages, deterministic CHERI) *removes the bug class* — there's nothing to bypass. Keep "harder to exploit" and "impossible bug class" distinct.

## Question 31

**Q: Why can CHERI enforce temporal safety when raw pointers can't, given both could "revoke on free"?**

Because CHERI capabilities are *tagged and findable* in memory — the runtime can sweep memory to locate and invalidate *every* capability pointing into a freed region (revocation). With raw integer pointers, you can't even distinguish a pointer from an integer, so you can't find them to revoke. CHERI makes pointers first-class, discoverable objects, which is exactly the property temporal revocation needs. (Even so, the sweep has cost — temporal safety stays the expensive half.)

## Question 32

**Q: A teammate wants to disable bounds checks for performance. How do you respond?**

Ask for a profile first. Optimizers perform **bounds-check elimination** — they remove checks they can prove are always in range (e.g. `for i in 0..len`), so most checks cost nothing already. The ones that survive are on genuinely dynamic indices — exactly where you *want* the check, and where it's a well-predicted branch. The "safe = slow" narrative is largely obsolete; the real cost of safety today is GC pauses/footprint and Rust authoring effort, not bounds checks. Disabling them usually trades a real vulnerability for negligible gain.

## Question 33

**Q: `malloc` returned memory and the program read it before writing — is reading a zero safe?**

`malloc` does *not* zero memory; it returns whatever leftover bytes are there, so an uninitialized read yields nondeterministic garbage and is UB to rely on (and an information-leak risk). If you need zeroed memory, use `calloc`. MSan exists precisely to catch this; many safe languages zero-initialize to close the hole entirely.

## Question 34

**Q: You introduced Rust into a C codebase and the team declared "we're memory-safe now." What's the catch?**

The **FFI boundary** is now the critical surface. Rust calling C (or C calling Rust) crosses out of Rust's guarantees; raw pointers, sizes, and lifetimes passed across the `extern` seam can carry every classic bug. The seam should be narrow, audited like `unsafe`, validate all sizes/pointers, and be exercised under sanitizers/Miri. "Mostly Rust" reduces the surface; it doesn't make the C-interop seam safe by itself.

---

## Design Questions

## Question 35

**Q: You're starting a new network-facing service that parses untrusted input. What language and why?**

A memory-safe language — Rust if I need C-level performance / no GC (the parser handles attacker-controlled input, the highest-risk surface), or a managed language (Go/Java) if GC pauses are acceptable. Parsers of untrusted input are where memory bugs become remote code execution, and ~70% of severe CVEs are memory-safety. Choosing C/C++ here means signing up for sanitizers + fuzzing + hardened allocators forever and *still* carrying the residual risk. The default for new high-risk code should be memory-safe.

## Question 36

**Q: Design a memory-safety strategy for a large legacy C/C++ codebase you can't fully rewrite.**

Two prongs, simultaneously. **Prevent new bugs:** mandate memory-safe languages for *new* and *high-risk* components (the bug-age data shows bugs concentrate in new/recently-changed code, so this captures most benefit affordably), with a merge gate. **Harden the legacy in place:** `_FORTIFY_SOURCE=3`, `-fstack-protector-strong`, CFI, a hardened allocator, and **MTE where the hardware supports it** (cheap temporal coverage in production), plus ASan/UBSan/MSan + fuzzing in CI. **Rewrite selectively** the highest-exposure components into Rust, auditing the FFI seam. **Measure:** memory-safety CVE fraction, % new-LOC in safe languages, and bug density by code age — report the trend. This mirrors Android's approach (76%→24% memory-safety CVEs).

## Question 37

**Q: When is C/C++ still the right choice, knowing the risks?**

When you need zero runtime, tiny footprint, hard-real-time determinism, or you're targeting hardware with no Rust/MSL support — OS kernels (though Rust is entering), drivers, deeply embedded, certain hot paths. Even then, the modern stance is "Rust where the toolchain allows," and where you stay in C/C++ you commit to the full hardening + sanitizer + fuzzing discipline and treat memory safety as an ongoing program, not a one-time effort.

## Question 38

**Q: How do you measure whether a memory-safety initiative is working?**

Track outcome and leading indicators together: **memory-safety CVE fraction over time** (the outcome — should trend down), **% of new LOC in memory-safe languages** (leading — should trend up), and **bug density by code age** (validates that new code stopped producing memory bugs). Avoid measuring activity alone ("% safe code written") without the CVE outcome, or the metric can be gamed with trivial new files. The trend line is the ROI case for leadership.

## Question 39

**Q: How would you decide between MTE and CHERI for a future platform?**

By guarantee, cost, and timeline. **MTE** is the pragmatic near-term choice: it ships today on ARMv8.5+, costs single-digit percent, gives both spatial and (probabilistic) temporal coverage for recompiled C/C++ — but it's probabilistic (1/16 miss). **CHERI** is the principled long-term answer: deterministic spatial safety via unforgeable capabilities, temporal safety via revocation — but it roughly doubles pointer size and isn't mainstream yet (Morello is early silicon). I'd deploy MTE now to bend the curve and track/pilot CHERI as the eventual deterministic floor; they're complementary, not exclusive.

## Question 40

**Q: How would you build a code-review checklist for memory safety across mixed C/Rust/Go?**

For **C/C++:** every buffer carries a length; bounded functions only; init on declare; NULL after free; ASan/UBSan in CI; new code justified vs. doing it in a safe language. For **Rust:** every `unsafe` block minimized and carrying a documented `// SAFETY:` invariant; Miri in CI; no reflexive `Rc<RefCell>` to dodge the borrow checker. For **Go:** `-race` in CI (race-freedom is a safety precondition); `unsafe.Pointer`/cgo as a reviewed, minimized surface. **Cross-cutting:** the FFI/interop seam audited like `unsafe`; sanitizers/fuzzing on parsers of untrusted input; distinguish mitigations from safety in the risk write-up.

## Question 41

**Q: Explain to a non-specialist executive why migrating to memory-safe languages is worth the investment.**

About 70% of our severe security vulnerabilities are a single class — memory-safety bugs — and they overwhelmingly appear in *new* code, regardless of how careful our engineers are (the whole industry, expert teams included, produces this rate in C/C++). We don't need to rewrite everything: if new and high-risk code is written in memory-safe languages, that class of bug largely stops appearing, while we harden the old code in place. Android did exactly this and cut memory-safety vulnerabilities from about three-quarters of the total to under a quarter in five years — fewer emergencies, lower breach risk, less firefighting — without a big-bang rewrite. The metric that proves it is the memory-safety CVE rate trending down, which I'll report quarterly.

---

## Related Topics

These questions span all four tiers of Memory-Safety Mechanisms: `junior.md` (taxonomy, spatial/temporal, the ~70% data), `middle.md` (sanitizers, hardened allocators, guard pages), `senior.md` (Rust/managed/ARC designs and their leaks), and `professional.md` (MTE, CHERI, the migration playbook). The `tasks.md` file turns these into hands-on reasoning exercises. Adjacent interview areas — undefined behavior and the compilation pipeline, garbage-collection internals, concurrency memory models and data races, exploit mitigations (ASLR/DEP/CFI), and FFI/interop — are covered in their own roadmap folders.
