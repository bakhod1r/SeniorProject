# Memory Safety — Hands-On Tasks

> **Topic:** [Memory Safety](README.md)

These tasks build intuition for memory safety through *understanding and prevention*, not exploitation. You'll observe how safe languages catch mistakes, run detection tooling against deliberately buggy (but contained) code, and design organizational strategy. Work in a throwaway directory; never run intentionally buggy native code outside a sandbox/VM.

Each task lists a **Self-check** you can tick off. Hints are collapsed in spirit — try first. Sparse solutions follow the harder tasks.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Watch a safe language catch an out-of-bounds access

In Python, Java, or Go, write a tiny program that creates a fixed-size array/list and deliberately indexes one past the end. Observe the *clean, catchable* error.

**Self-check:**
- [ ] The program raised a defined error (`IndexError` / `ArrayIndexOutOfBoundsException` / panic), not a silent wrong result.
- [ ] You can articulate why this is *better* than what unchecked C would do (silent adjacent-memory corruption).
- [ ] You identified this as a **spatial** safety violation being prevented.

*Hint: the point is to feel the difference between "the language stops you" and "the language trusts you."*

### Task 2 — Classify violations

For each scenario, label it spatial / temporal / type / initialization, and name the violation:
1. Reading `buf[len]` where `buf` has `len` elements.
2. Dereferencing a pointer after the object it pointed to was freed.
3. Reading a local `int` before assigning it.
4. Decoding untrusted bytes into a typed object whose tag is then trusted blindly.
5. `free(p); free(p);`

**Self-check:**
- [ ] All five labeled correctly (answers: 1 spatial/overflow, 2 temporal/use-after-free, 3 initialization/uninitialized-read, 4 type/type-confusion, 5 temporal/double-free).
- [ ] You can explain why #4 is dangerous (misinterpreted field offsets / vtable).

### Task 3 — Find the "safe but still broken" cases

List three things a memory-*safe* language does **not** protect you from. For each, give a one-line example.

**Self-check:**
- [ ] You named at least three of: memory leak, deadlock, panic/exception, logic bug, data race (in Go).
- [ ] You can explain why a memory leak is *not* a memory-safety violation.
- [ ] You noted that a bounds-check panic is the safety mechanism *working*, not failing.

---

## Core

### Task 4 — Run AddressSanitizer against a contained overflow

In a VM or container, write a small C program with a deliberate heap buffer overflow (e.g., `malloc(8)` then write `p[8]`). Compile with `-fsanitize=address -g` and run it. Read the report.

**Self-check:**
- [ ] ASan reported `heap-buffer-overflow` with a stack trace pointing at the exact line.
- [ ] You can explain the report mentions a redzone / "N bytes to the right of an 8-byte region."
- [ ] You understand ASan uses shadow memory + redzones to detect this at the moment it happens.
- [ ] You did this in an isolated environment, not on a host you care about.

*Hint: `clang -fsanitize=address -g overflow.c -o overflow && ./overflow`.*

### Task 5 — Catch a use-after-free with ASan, then prevent it

Extend Task 4: `free(p)` then read `*p`. Run under ASan and observe `heap-use-after-free`. Then rewrite the program so the bug is impossible (set the pointer to `NULL` after free, or restructure so the pointer can't outlive the allocation).

**Self-check:**
- [ ] ASan reported `heap-use-after-free` and showed both the free site and the access site.
- [ ] You can explain ASan's *quarantine* is why the freed block wasn't silently reused.
- [ ] Your fix makes the bug structurally impossible, not just "less likely."

### Task 6 — Compare safe vs. `unsafe` in Rust

Write a Rust program that indexes a `Vec` two ways: the safe `v[i]` (bounds-checked) and `unsafe { *v.get_unchecked(i) }`. With an out-of-range `i`, observe that safe indexing *panics* (defined behavior) while the unsafe path would be UB. Then wrap `get_unchecked` in a *sound* function that checks bounds first.

**Self-check:**
- [ ] Safe indexing panicked cleanly on out-of-range; you did **not** actually execute `get_unchecked` out of range.
- [ ] Your wrapper has a safe signature that is sound for *all* inputs (checks `i < v.len()` before `get_unchecked`).
- [ ] You added a `// SAFETY:` comment justifying the `unsafe` block.
- [ ] You can explain "soundness encapsulation": safe callers can't reach UB.

### Task 7 — Trigger Go's race detector

Write a Go program where two goroutines write a shared variable without synchronization. Run with `go run -race`. Observe the race report. Then fix it with a mutex or channel.

**Self-check:**
- [ ] `-race` reported a data race with both stack traces.
- [ ] You can explain why a race on a multi-word value (slice/interface) is a *memory-safety* issue (torn value), not just nondeterminism.
- [ ] The fixed version reports no race.

### Task 8 — Detect an undersized allocation from integer overflow

Write (in C, contained) an allocation `malloc(count * size)` and reason about values of `count`/`size` that overflow `size_t`. Then write the *safe* version using an overflow check (or Rust's `checked_mul`). Confirm the safe version refuses the overflowing input instead of allocating a tiny buffer.

**Self-check:**
- [ ] You identified that an overflowing product wraps to a small allocation, enabling a heap overflow.
- [ ] Your safe version detects the overflow before allocating (explicit check or `checked_mul` returning `None`).
- [ ] You can explain why this is a memory-safety bug whose *root cause* is integer arithmetic.

---

## Advanced

### Task 9 — Fuzz a parser under a sanitizer

Write a tiny C function `parse(const uint8_t*, size_t)` with a *subtle* bounds bug (e.g., it reads a length byte and trusts it). Build a libFuzzer harness compiled with `-fsanitize=address,fuzzer` and let it run. Observe the fuzzer find the crashing input that ASan flags.

**Self-check:**
- [ ] The fuzzer produced a crashing input and ASan pinpointed the violation.
- [ ] You saved the reproducing input and can re-trigger the crash deterministically.
- [ ] You can explain "coverage = reachability × sanitization": the fuzzer reached the path, ASan caught the bug.
- [ ] You fixed the parser (validate the length against the actual buffer size) and confirmed the fuzzer no longer crashes for a fixed time budget.

*Hint: `LLVMFuzzerTestOneInput` calls `parse(data, len)`; run `./fuzz -max_total_time=120`.*

### Task 10 — Validate `unsafe` Rust with MIRI

Write a small Rust program with an `unsafe` block that has a *latent* bug reachable only on certain inputs (e.g., a raw-pointer offset that's off-by-one for some lengths). Run `cargo +nightly miri test`. Observe MIRI flag the UB that ordinary `cargo test` missed.

**Self-check:**
- [ ] `cargo test` passed (or didn't catch it) but `cargo miri test` reported UB.
- [ ] You can name what MIRI checks that the compiler/tests don't (out-of-bounds, UAF, invalid values, uninitialized reads).
- [ ] You fixed the `unsafe` block so MIRI is clean.

### Task 11 — Map mitigations to violations

Build a table: rows = violation categories (stack overflow, heap overflow, UAF, type confusion); columns = mitigations (ASLR, DEP/NX, stack canary, CFI, shadow stack, MTE, CHERI). Mark which mitigation meaningfully helps which violation and note one bypass per "yes."

**Self-check:**
- [ ] You noted stack canaries help linear stack overflows but *not* UAF or heap overflows.
- [ ] You noted DEP/NX is bypassed by ROP; ASLR by an info leak.
- [ ] You noted MTE/CHERI address *both* spatial and temporal at the root cause, unlike the exploit-step mitigations.
- [ ] You can defend the claim "mitigations raise attacker cost; they don't remove bugs."

### Task 12 — Set up a sanitizer matrix in CI

Take a small C/C++ project (yours or a sample). Add CI jobs (or a Makefile/script) that build and test it under: (a) ASan+UBSan, (b) TSan, separately. Document why you can't combine them all into one build.

**Self-check:**
- [ ] You have *separate* build configurations for ASan+UBSan and TSan.
- [ ] You can explain that ASan and MSan don't compose, and TSan is its own build.
- [ ] Tests run green under each (or you found and filed real bugs).

---

## Capstone

### Task 13 — Author a memory-safety migration strategy for a legacy estate

Pick a realistic scenario: a 3M-line C++ media-processing service with internet-facing decoders, a small team, and active security pressure. Write a 1–2 page strategy document.

It must address:
1. **A "new code" policy** and the data-backed rationale (vulnerabilities concentrate in new code; Android's vuln *fraction* fell ~76% → ~24%).
2. **Prioritization by trust boundary** — what you harden/migrate/sandbox first and why.
3. **A detection pipeline** — sanitizers + continuous fuzzing, where each runs.
4. **Production mitigations** — which compiler/OS/hardware mitigations you enable and what each buys.
5. **What to sandbox** vs. rewrite, with the FFI-boundary risk called out.
6. **A metric** — how you'll measure progress (the memory-safety vulnerability fraction over time).

**Self-check:**
- [ ] The plan is *prioritized*, not "fix everything"; the trust boundary drives ordering.
- [ ] You justified "safe by default for new code" as the highest-ROI move with the empirical rationale.
- [ ] You named specific tools (ASan/UBSan/TSan, libFuzzer/AFL++, MIRI for any Rust) and where each runs.
- [ ] You listed concrete production mitigations (CFI, stack protector, `_FORTIFY_SOURCE`, ASLR/DEP, MTE) and one limitation each.
- [ ] You included a containment plan (process/Wasm sandbox) for decoders you can't yet rewrite, and flagged FFI as a new bug source.
- [ ] You defined a *measurable* leading indicator and a cadence for reviewing it.

### Task 14 — Soundness review of a "safe" wrapper

Given (or write) a Rust module that exposes a safe public API over an `unsafe` internal implementation (e.g., a custom buffer with `get`/`set`). Audit it for *soundness encapsulation*: is there any input a safe caller could supply that drives the `unsafe` code to UB? Document each `unsafe` block's invariant, run MIRI and a quick fuzz of the public API, and either prove it sound or fix it.

**Self-check:**
- [ ] You enumerated every `unsafe` block and its required invariant.
- [ ] You checked whether each public function is sound for *all* safe-caller inputs (no out-of-range index reaches `get_unchecked`, etc.).
- [ ] You ran MIRI and fuzzed the public API; both clean after any fixes.
- [ ] You can articulate why a safe signature over unsound internals is the cardinal sin.

---

## Self-Assessment

You've internalized memory safety when you can:

- [ ] Define memory safety as the conjunction of **spatial, temporal, type, initialization, and (sometimes) thread** safety, and classify any violation.
- [ ] Explain how **GC languages** and **Rust's ownership** each achieve safety, and where each pays the cost.
- [ ] State precisely what safety does **not** cover (leaks, deadlocks, panics, logic bugs, Go data races).
- [ ] Run and interpret **ASan**, **the Go race detector**, and **MIRI**, and explain their mechanisms and limits.
- [ ] Explain why **fuzzing × sanitizers** beats either alone, and set up a non-composing **sanitizer matrix**.
- [ ] Map **hardware/OS mitigations** to the violations they affect, with a bypass for each, and explain why **MTE/CHERI** are different.
- [ ] Reason about the **`unsafe` contract** and **soundness encapsulation**, auditing a safe-over-unsafe API.
- [ ] Design a **prioritized migration strategy** for a legacy C/C++ estate, justified by the trust boundary and measured by the memory-safety vulnerability fraction.

---

### Sparse Solutions / Pointers

- **Task 4/5 (ASan):** `clang -fsanitize=address -g bug.c -o bug`. The report's first line names the bug class; the "SUMMARY" and "shadow bytes" sections show the redzone. Always in a VM/container.
- **Task 6 (sound wrapper):** the safe function is `if i < v.len() { Some(unsafe { *v.get_unchecked(i) }) } else { None }` — the check *inside* the boundary is what makes it sound for all inputs.
- **Task 7 (Go race):** `go run -race main.go`; fix with `sync.Mutex` around the shared write or by passing ownership via a channel.
- **Task 8 (overflow):** Rust `count.checked_mul(size)?` returns `None` on overflow; in C, check `if (size != 0 && count > SIZE_MAX / size) reject;` before `malloc`.
- **Task 9 (fuzz):** harness is `int LLVMFuzzerTestOneInput(const uint8_t* d, size_t n){ parse(d,n); return 0; }` built with `-fsanitize=address,fuzzer`. The fix validates the embedded length against `n`.
- **Task 10 (MIRI):** `cargo +nightly miri test`; it interprets MIR and catches UB that release tests miss.
- **Task 13/14:** there's no single "right" answer — grade yourself against the self-check boxes. The recurring themes are *prioritize the trust boundary*, *safe-by-default for new code*, *measure the fraction*, and *soundness lives at the API boundary*.
