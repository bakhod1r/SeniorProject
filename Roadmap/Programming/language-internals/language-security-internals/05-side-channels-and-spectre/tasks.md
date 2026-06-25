# Side Channels & Spectre — Hands-On Tasks

> **Topic:** [Side Channels & Spectre](README.md)

---

## Introduction

These tasks teach the **defensive** half of side channels: how to spot a
secret-dependent timing leak, how to write constant-time code, and how to reason
about microarchitectural channels well enough to mitigate them. You will *not*
build a working secret-extraction exploit — that is neither necessary nor
appropriate for learning the defense. Every exercise ends with hardened code or a
mitigation plan.

The mental anchor for the whole file: **architectural state is rolled back on a
misspeculation or a fault, but microarchitectural state (the cache) is not.** A
side channel reads secrets through the door that rollback leaves open.

> ⚠️ Use only benign, non-secret data in any timing measurement. The goal is to
> demonstrate *variance*, not to leak anything.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Spot the leak

For each snippet, say whether its running time depends on a secret, and how:

```c
if (secret_byte == 0x42) do_a(); else do_b();     // (1)
table[secret_index];                               // (2)
for (int i = 0; i < secret_count; i++) work();     // (3)
x = a + b;                                          // (4)
```

**Self-check:**
- [ ] I flagged (1) secret-dependent branch, (2) secret-dependent memory index (cache channel), (3) secret-dependent loop count — and (4) as safe (data-independent).
- [ ] I can name the observable that leaks in each case (branch timing, cache line, total time).

### Task 2 — Early-exit compare leaks

Write the naive `memcmp`-style MAC/password comparison that returns on the first
mismatch. Explain, in writing, how its timing reveals the length of the correct
prefix.

**Self-check:**
- [ ] I can explain why "reject as soon as a byte differs" leaks a position oracle.
- [ ] I understand why this matters even over a network (statistical averaging defeats the noise).

---

## Core

### Task 3 — Constant-time comparison

Implement a constant-time equality check that (a) always examines all bytes and
(b) accumulates differences with `|=` into one accumulator, branchlessly. Verify
it has no secret-dependent branch.

```c
int ct_eq(const uint8_t *a, const uint8_t *b, size_t n) {
    uint8_t d = 0;
    for (size_t i = 0; i < n; i++) d |= a[i] ^ b[i];
    return d == 0;   // single comparison, length-independent path
}
```

**Self-check:**
- [ ] My implementation has no `if` inside the loop and no early `return`.
- [ ] I can explain why the final `d == 0` is acceptable (it doesn't reveal *where* a difference was).
- [ ] I know my language's library version (`crypto_verify`, `MessageDigest.isEqual`, `hmac.compare_digest`, `subtle.ConstantTimeCompare`).

### Task 4 — Measure the variance

Benchmark the early-exit compare from Task 2 against `ct_eq` from Task 3 on inputs
that match in 0, half, and all bytes (use benign data). Plot or tabulate the
timing.

**Self-check:**
- [ ] The early-exit version's time tracks the match length; the constant-time version is flat.
- [ ] I understand why this is a *necessary but not sufficient* check (microbenchmarks miss compiler/CPU effects).

### Task 5 — Remove secret-dependent indexing

Given code that does `sbox[secret & 0xff]`, describe and (where feasible)
implement the standard mitigations: bit-sliced implementations, or scanning the
whole table with a mask so the access pattern is data-independent.

**Self-check:**
- [ ] I can explain why a cache-line-granular attacker learns `secret >> log2(linesize)` from a single table lookup.
- [ ] I know which real ciphers (AES) ship bit-sliced or hardware (AES-NI) implementations for exactly this reason.

---

## Advanced

### Task 6 — Reason about Flush+Reload (conceptual, no exploit)

In writing, walk through how a Flush+Reload covert channel works: flush a shared
line, let the victim run, time a reload to learn whether the victim touched it.
Then list every defense that breaks it (no shared memory across trust boundaries,
no high-res timers, cache partitioning, constant-time code).

**Self-check:**
- [ ] I can explain the channel without writing one.
- [ ] I can map each defense to the step of the attack it breaks.

### Task 7 — Spectre v1 mitigation on a bounds check

Given `if (i < len) return arr[i];`, explain why speculation can read `arr[i]`
for out-of-range `i`, and apply index masking (`i &= (len-1)` for power-of-two, or
an `array_index_nospec`-style clamp) plus an `lfence`/speculation barrier.

**Self-check:**
- [ ] I can explain why the *architectural* bounds check isn't enough on its own.
- [ ] My mitigation makes the speculatively-accessed index safe even under misprediction.

### Task 8 — Why browsers removed timers

Explain why Spectre forced browsers to reduce `performance.now()` resolution and
gate `SharedArrayBuffer` behind cross-origin isolation, and why site isolation
(separate processes per origin) is the real structural fix.

**Self-check:**
- [ ] I can connect "high-resolution timer + shared memory" to "amplifiable cache channel."
- [ ] I understand why process isolation of secrets is stronger than removing timers.

---

## Capstone

### Task 9 — Harden a routine end-to-end

Take a small secret-handling routine (a token comparator, a tiny PIN check, or a
table-driven transform). Then:

1. **Audit** it for every secret-dependent branch, index, loop bound, and
   variable-time operation (division, early-out).
2. **Harden** each into a data-independent form.
3. **Write the verification plan**: what you'd run (a `dudect`/`ctgrind`-style
   timing-leakage test), what "pass" looks like, and the residual risks the test
   can't cover (compiler reintroducing branches, microarchitecture).

**Self-check:**
- [ ] My hardened routine has no secret-dependent control flow or memory access.
- [ ] My verification plan names a concrete tool and a statistical pass criterion.
- [ ] I documented that constant-time source can still be broken by the compiler, and how to check the emitted assembly.

---

## Self-Assessment

You own this topic when you can:

- [ ] Distinguish a side channel from a memory-safety bug (no corruption needed).
- [ ] Write constant-time comparison and explain every line.
- [ ] Explain Spectre v1/v2, Meltdown, and MDS at the level of "what speculative/transient step leaks, and through which microarchitectural buffer."
- [ ] List the software and hardware/microcode mitigations and their performance cost, and explain why secrets are now isolated by *process*.
