# Side Channels & Spectre — Middle Level

> **Topic:** [Side Channels & Spectre](README.md)
> **Focus:** How speculative and out-of-order execution actually work, the named cache-attack techniques (Flush+Reload, Prime+Probe, Evict+Time), and how Spectre v1 chains them into a leak — with the mitigations, mechanism by mechanism.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Why does a CPU run instructions it might have to throw away?** And **how does the throwing-away leave a fingerprint an attacker can read?**

At the junior level you learned the *shape* of a side channel: a secret leaks through timing or memory-access patterns rather than through your program's output, and the first cure is constant-time comparison. This level opens the box. To understand Spectre — not as a scary headline but as a mechanism you could explain on a whiteboard — you need three things: (1) how a modern CPU executes instructions *out of order* and *speculatively*, (2) how an attacker reads the cache to learn which lines a victim touched, and (3) how those two combine so that *speculative* work, which is supposed to be invisible, becomes visible.

The thread tying everything together is a single distinction: **architectural state** (registers and memory — the program's official, visible reality) versus **microarchitectural state** (caches, branch predictors, internal buffers — the hidden machinery that exists only to make things fast). The CPU is meticulous about rolling back *architectural* state when a speculation turns out wrong. It is not meticulous — historically, not at all — about rolling back *microarchitectural* state. Spectre and its relatives live entirely in that gap: they coax the CPU into doing secret-dependent work speculatively, let the CPU "undo" it architecturally, and then read the secret out of the microarchitectural residue.

This page is mostly about **Spectre v1 (bounds-check bypass)** because it is the cleanest illustration of the whole class. We will also build the cache-attack toolkit (Flush+Reload, Prime+Probe, Evict+Time) you need to understand *any* of these attacks. The full taxonomy — Spectre v2, v4, Meltdown, MDS/RIDL, L1TF, retbleed — is `senior.md`. The deep mitigation engineering and the cost analysis is `professional.md`.

> 🎓 **Why this matters for a middle engineer:** You will not write CPU microcode, but you *will* make decisions that depend on understanding this: whether to enable a compiler's Spectre mitigation, why a security-sensitive service should not co-locate untrusted code, why your cloud bill went up after a microcode update, and how to recognize the rare application-level Spectre-v1 gadget (a bounds check followed by a secret-dependent memory access) in code that touches attacker-controlled indices.

---

## Prerequisites

- **Required:** The junior page — side channels, timing attacks, early-exit leaks, constant-time comparison, the architectural-vs-microarchitectural distinction.
- **Required:** What a CPU cache and a cache line are (typically 64 bytes), and that a cache hit is much faster than a miss.
- **Required:** Basic idea of a branch (`if`) compiling to a compare and a conditional jump.
- **Helpful:** What a pipeline is — instructions move through fetch/decode/execute stages like a factory line.
- **Helpful:** Virtual memory basics: user space vs. kernel space, page permissions.

You do **not** yet need: the full transient-execution taxonomy (`senior.md`), or the detailed microcode/compiler mitigation internals (`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Out-of-order (OoO) execution** | The CPU executes instructions as their inputs become ready, not strictly in program order, then *retires* them in order. Hides memory latency. |
| **Speculative execution** | Executing instructions *past* a branch (or other unresolved condition) by guessing the outcome, before the condition is known. |
| **Branch predictor** | Hardware that guesses which way a branch will go, based on history, so speculation has something to run. |
| **Retire / commit** | The moment an instruction's results become *architecturally* visible. Mis-speculated instructions are squashed before retirement. |
| **Squash / rollback** | Discarding speculatively-executed instructions when the guess was wrong. Restores *architectural* state only. |
| **Transient execution** | Instructions that execute speculatively but never retire (their architectural effects are squashed). They still leave microarchitectural traces. |
| **Transient instruction window** | The window of transient instructions a CPU can have in flight — the "budget" an attacker has to do secret-dependent work before the rollback. |
| **Cache line** | The unit of caching, typically 64 bytes. The cache tracks presence at line granularity. |
| **Flush+Reload** | A cache attack: flush a shared line, let the victim run, then time reloading it. Fast reload ⇒ victim touched it. |
| **Prime+Probe** | A cache attack needing no shared memory: fill (prime) a cache set, let the victim run, then time re-reading your data (probe) to see which lines the victim evicted. |
| **Evict+Time** | Evict a line, time the victim's whole operation; slower ⇒ the victim needed that line. |
| **Covert channel** | A communication path not intended for communication; here, the cache encodes the secret for the attacker to read. |
| **`clflush`** | An x86 instruction that flushes a specific line out of all caches — the enabler of Flush+Reload. |
| **`lfence`** | An x86 load-fence that also acts as a *speculation barrier*: instructions after it do not execute speculatively until prior ones retire. |
| **Gadget** | A code snippet that, when speculatively executed, performs the secret-dependent leak (e.g., bounds-check followed by an attacker-influenced read). |
| **Bounds-check bypass (Spectre v1)** | Speculating past an array bounds check so an out-of-bounds read happens transiently, then leaking the value via cache. |

---

## Core Concepts

### 1. Why CPUs execute out of order and speculatively

A memory load that misses all caches can cost **hundreds of cycles** — main RAM is glacially slow compared to the core. If the CPU stalled, waiting, every time it issued a load, it would spend most of its life idle. So modern cores do two things:

- **Out-of-order execution:** while one instruction waits on a slow load, the CPU executes *later* instructions whose inputs are already available. Results are computed eagerly but only *retired* (made official) in program order, so the program's visible behavior is unchanged.
- **Speculative execution:** control flow has branches. To keep the pipeline full *past* a branch, the CPU asks the **branch predictor** to guess the outcome and starts executing the predicted path *before the branch condition is resolved*. If the guess is right (predictors are right ~95%+ of the time), that work is already done — a big speedup. If wrong, the CPU **squashes** the speculative work and restarts down the correct path.

Both mechanisms are decades old, near-universal, and account for a large fraction of single-core performance. They are not bugs. They are the optimizations that make the hole.

### 2. The leak hides in the incomplete rollback

When speculation is wrong, the CPU squashes the bad instructions: it restores registers, cancels pending memory writes — the **architectural** state is clean, as if the speculation never happened. Your program cannot observe the squashed work *through normal means*.

But during that transient window, the speculated instructions may have issued **loads** that pulled data into the cache. The squash does not evict those lines — *the cache is left warm*. So a load that "never officially happened" has left a **microarchitectural** fingerprint. If *which line got warmed* depended on a secret, the secret has leaked into the cache. All that remains is for the attacker to read it out — and that is what the cache-attack toolkit does.

> The one sentence to memorize: **transient execution rolls back the architectural state but not the cache; if the transient work touched memory based on a secret, the secret is now encoded in cache state.**

### 3. The cache-attack toolkit

These techniques let an attacker learn *which cache lines a victim touched*. They are the "read" half of every Spectre-class attack (and standalone attacks against, e.g., table-based crypto).

**Flush+Reload** (needs memory shared with the victim — e.g., a shared library, or a known buffer):
1. **Flush** a target line out of all caches with `clflush`.
2. **Wait** while the victim runs.
3. **Reload** the line and *time* it. A **fast** reload means the line is cached — the victim must have touched it. A **slow** reload means the victim did not.

It is high-resolution and low-noise, which is why it is the textbook tool. The catch: it needs shared memory between attacker and victim.

**Prime+Probe** (needs *no* shared memory — works across processes/VMs):
1. **Prime:** the attacker fills an entire cache *set* with its own data.
2. **Wait** while the victim runs. If the victim accesses an address mapping to that set, it **evicts** one of the attacker's lines.
3. **Probe:** the attacker re-reads its own data and times it. A **slow** re-read of some line means the victim evicted it ⇒ the victim touched that set.

Prime+Probe is noisier but far more general — it is the workhorse of cross-VM cloud attacks because it needs nothing shared.

**Evict+Time** (coarser): evict a line, then time the victim's *whole* operation. If the operation is slower, it needed the evicted line. Lower resolution, but simple.

All three exploit the same fact: **a cache hit and a cache miss differ by a measurable amount of time, and that timing reveals the victim's memory-access pattern.**

### 4. Spectre v1: bounds-check bypass, step by step (conceptual)

Spectre v1 is the cleanest member of the family. Consider this innocent-looking, *fully bounds-checked* code that runs in a victim (say, a kernel, a JIT, or a server handling an attacker-supplied index `x`):

```c
if (x < array1_size) {           // (1) the bounds check
    y = array2[ array1[x] * 64 ]; // (2) secret-dependent dependent load
}
```

In normal execution this is safe: if `x` is out of bounds, the `if` is false and the body never runs. The exploit defeats the *timing* of the check, not its logic:

1. **Train the predictor.** The attacker calls this code many times with *in-bounds* `x`, so the branch predictor learns "this branch is usually taken (true)."
2. **Set up the cache read-out.** The attacker flushes `array1_size` from cache (so resolving the branch will be *slow*) and flushes the `array2` probe region (so it can later detect which line got warmed).
3. **Pass a malicious `x`.** Now the attacker calls with `x` chosen so `array1[x]` points *out of bounds* — at a secret byte somewhere in memory.
4. **Speculation runs ahead.** Because resolving `x < array1_size` is slow (it had to wait for `array1_size` from RAM) and the predictor says "taken," the CPU **speculatively executes the body** with the malicious `x`. Transiently, it reads the secret byte `array1[x]`, then uses it as an index: `array2[secret * 64]`. That load **pulls one specific line of `array2` into the cache** — the line index encodes the secret.
5. **Squash.** The branch finally resolves: `x` was out of bounds, the guess was wrong, the CPU squashes everything. Architecturally, nothing happened — no out-of-bounds value is in any register your program can read.
6. **Read the secret out of the cache.** The attacker now does **Flush+Reload** across the `array2` probe region: exactly one line is fast (warm). Its index *is the secret byte*. Repeat for each byte of the secret.

Notice what makes this so dangerous: **there was no memory-safety bug.** The code bounds-checks correctly. The leak comes from the CPU *speculating past* a correct check, plus the cache not being rolled back. That is why Spectre cannot be fixed by "just bounds-check better" — the check is already there.

### 5. Mitigating Spectre v1 in software

Because v1 lives in *your* code's bounds check, defenses are at the software level:

- **Speculation barrier (`lfence`).** Insert an `lfence` between the bounds check and the dependent access. `lfence` forces the CPU to *resolve prior instructions* before executing later ones — it stops the speculation that would have read out of bounds. Effective but slow if overused; compilers can insert it automatically (MSVC `/Qspectre`, similar in others).
- **Index masking.** Instead of trusting the branch, *clamp the index in data* so that even speculatively it cannot go out of bounds:

```c
if (x < array1_size) {
    x &= (array1_size - 1);          // mask (when size is a power of two)
    y = array2[array1[x] * 64];      // speculation can't escape the array now
}
```
  Masking is cheaper than a fence because it doesn't serialize the pipeline — it just makes the out-of-bounds value *impossible even transiently*. (Generalized "array_index_nospec" helpers in the Linux kernel do exactly this.)
- **Removing the gadget.** If attacker-controlled indices never feed a secret-dependent dependent load, there is no gadget. Auditing for the bounds-check-then-dependent-load pattern is the structural fix.

### 6. Why browsers and clouds changed everything after Spectre

Spectre needs the attacker to *run code on the same hardware* as the victim's secrets. Two environments make that easy:

- **Browsers** run untrusted JavaScript/WASM from any website, in the same process as your other tabs' data. Spectre let a malicious page read memory from the same renderer. The response was **Site Isolation** (put each site in its own OS process so a Spectre leak only sees that one site's data) plus **reducing timer resolution** and **restricting `SharedArrayBuffer`** (which provided the high-resolution timing that cache attacks need).
- **Clouds** run many tenants' VMs on the same physical CPU. Prime+Probe and L1TF (in `senior.md`) made cross-tenant leakage a real concern, driving core-scheduling, cache partitioning, and "do not co-locate untrusted workloads" policies.

The lesson for a middle engineer: **process and hardware isolation are not bureaucratic — they are the load-bearing defense.** Don't run untrusted code in the same process/VM/core as secrets if you can help it.

---

## Real-World Analogies

**The eager research assistant (speculation).** You ask an assistant to pull a file *only if* the request is authorized. To save time, they start walking to the cabinet and pulling files *while you check authorization*. If you say "denied," they put everything back — but the drawer they opened stays slightly ajar. A spy watching the cabinet learns which drawer was opened, even though "officially" nothing was retrieved. The ajar drawer is the warm cache line.

**Flush+Reload as a still-warm coffee cup.** You leave the break room, return, and touch each cup. The warm one was used while you were gone. `clflush` empties all the cups (resets temperature); timing the reload "touches" them to find which one the victim warmed.

**Prime+Probe as parking spots.** You park your cars in every spot of a lot (prime). You leave. When you return, one of your cars is gone — someone needed that spot (the victim evicted your line). You don't see the other driver, but you learn *which spots they needed*.

**Training the predictor as conditioning a guard dog.** Feed the dog from the left gate a hundred times and it learns to run left whenever the bell rings. Then ring the bell and slip in the right gate — the dog has already committed to the wrong direction. The bell is the branch; the dog is the predictor; the attacker exploits the trained habit.

---

## Mental Models

**Model 1: The transient window is an unsupervised scratchpad.** For a few dozen-to-hundred cycles, the CPU does work that will be erased — *except* for the cache smudges. Anything the attacker can make the CPU *do* in that window, and encode into the cache, escapes.

**Model 2: Two-phase attack — encode then read.** Every Spectre-class attack has an **encode** phase (transiently touch memory based on a secret, planting it in cache state) and a **read** phase (a cache attack like Flush+Reload that decodes the cache state back into the secret). Recognizing these two phases lets you classify *any* of these attacks.

**Model 3: The check is real; the timing is the hole.** In v1 the bounds check is *correct*. The exploit is that the CPU acts on the unchecked path *before the check finishes*. Mitigations either make the CPU wait for the check (`lfence`) or make the bad value harmless even if used (masking).

**Model 4: Isolation is the meta-defense.** You can patch individual gadgets, but the durable defense is *not letting the attacker share hardware with the secret*. Site isolation, per-tenant cores, and "don't co-locate untrusted code" attack the precondition, not the gadget.

---

## Code Examples

### A Spectre-v1 gadget (for *recognition*, not exploitation)

```c
/* This is the SHAPE to learn to recognize and avoid in security-sensitive
 * code that handles attacker-controlled indices. It is not an exploit;
 * exploiting it requires the cache-attack machinery and precise timing. */
uint8_t leak_gadget(size_t x) {            /* x is attacker-controlled */
    if (x < array1_size) {                  /* correct bounds check */
        uint8_t v = array1[x];              /* transiently may read OOB */
        return array2[v * CACHE_LINE];      /* secret-dependent cache footprint */
    }
    return 0;
}
```

### Mitigation A: speculation barrier

```c
uint8_t safe_gadget_fence(size_t x) {
    if (x < array1_size) {
        _mm_lfence();                       /* stop speculation past the check */
        uint8_t v = array1[x];
        return array2[v * CACHE_LINE];
    }
    return 0;
}
```

### Mitigation B: index masking (cheaper, no pipeline stall)

```c
/* Linux-kernel-style: clamp the index in DATA so even a mis-speculated
 * path cannot read out of bounds. mask is all-ones if x<size, else all-zeros. */
static inline size_t array_index_mask(size_t x, size_t size) {
    return ~((size_t)((x - size) >> (sizeof(size_t) * 8 - 1)) - 1);
    /* conceptual; real code uses arch-specific, audited helpers */
}

uint8_t safe_gadget_mask(size_t x) {
    if (x < array1_size) {
        x &= array_index_mask(x, array1_size); /* OOB index becomes 0 */
        uint8_t v = array1[x];
        return array2[v * CACHE_LINE];
    }
    return 0;
}
```

> In real code, use the kernel's `array_index_nospec()` or the compiler's automatic mitigations rather than hand-rolling the masking arithmetic.

### Constant-time crypto (the non-transient side channel you control)

```go
// Don't index tables with secrets; use the platform's vetted, constant-time
// crypto. Go's stdlib uses AES-NI when available, which avoids the
// secret-indexed table lookups that classic cache attacks exploited.
import (
    "crypto/aes"
    "crypto/subtle"
)

func ctEqual(a, b []byte) bool {
    return subtle.ConstantTimeCompare(a, b) == 1 // no early exit
}

func newCipher(key []byte) {
    _, _ = aes.NewCipher(key) // hardware AES: no secret-dependent table index
}
```

---

## Pros & Cons

| Aspect | Upside | Downside |
|--------|--------|----------|
| **Speculative/OoO execution** | Major performance win; modern CPUs depend on it. | The root enabler of every transient-execution attack. |
| **`lfence` speculation barrier** | Reliably stops Spectre-v1 speculation at the gadget. | Serializes the pipeline; costly if overused; must be placed correctly. |
| **Index masking** | Cheap (no stall); makes OOB index harmless even transiently. | Easiest when sizes are powers of two; requires identifying every gadget. |
| **Flush+Reload (attacker's tool)** | (For the attacker) precise and quiet. | Needs shared memory; mitigated by removing shared pages / high-res timers. |
| **Prime+Probe (attacker's tool)** | (For the attacker) needs no shared memory; works cross-VM. | Noisier; mitigated by cache partitioning and core isolation. |
| **Site isolation / per-tenant cores** | Removes the attacker's foothold entirely. | More processes/cores ⇒ more memory and scheduling overhead. |

---

## Use Cases

You apply this knowledge when:

- **You write or review JITs, interpreters, parsers, or kernels** that take attacker-controlled indices and then perform a dependent memory access — the natural home of a Spectre-v1 gadget.
- **You configure build pipelines:** deciding whether to enable compiler Spectre mitigations (`/Qspectre`, retpolines) for code that processes untrusted input on shared hardware.
- **You design multi-tenant systems:** deciding co-location policies, whether to pin untrusted workloads to dedicated cores, and how to reason about cross-tenant cache leakage.
- **You build browsers or browser-like sandboxes:** site isolation and timer hardening are direct consequences of this material.
- **You handle crypto:** ensuring secrets never steer table indices or branches, and using AES-NI / constant-time libraries.

---

## Coding Patterns

**Pattern: barrier-or-mask at the bounds check.** In a confirmed gadget (attacker index → dependent secret-laden access), insert `array_index_nospec()`/masking, or an `lfence`, between the check and the access.

**Pattern: minimize shared, attacker-mappable memory.** Flush+Reload needs shared pages. Avoid mapping the same read-only data into attacker-controlled and victim contexts where it isn't necessary.

**Pattern: deny the high-resolution clock.** In sandboxes, reduce timer resolution and restrict `SharedArrayBuffer`-style shared-memory timers so cache timing becomes too noisy to exploit.

**Pattern: isolate the secret, not just guard it.** Put secrets in a separate process/enclave so a transient leak in untrusted code simply can't reach them.

---

## Best Practices

1. **Learn to *recognize* the gadget shape:** a bounds (or type) check followed by a secret-dependent dependent memory access on an attacker-influenced value.
2. **Prefer masking to fences** where applicable — same protection, far less performance cost. Use audited helpers (`array_index_nospec`), not hand-rolled bit tricks.
3. **Turn on compiler/OS mitigations for untrusted-input code** and understand which attack each one addresses.
4. **Don't co-locate untrusted code with secrets.** Process/VM/core isolation is the most reliable defense; it removes the precondition.
5. **Keep secrets out of indices and branches** in crypto and authentication code; use hardware crypto and constant-time libraries.
6. **Measure the cost.** Mitigations are not free; know what you are paying and decide deliberately, per workload.

---

## Edge Cases & Pitfalls

- **Over-fencing.** Sprinkling `lfence` everywhere tanks performance and is usually unnecessary — only the actual gadget needs protection. Profile and target.
- **Masking only works if it truly clamps.** A subtly wrong mask (off-by-one, non-power-of-two size) leaves the gadget exploitable. Use vetted helpers.
- **The compiler may defeat you.** Just as it can reintroduce branches into "constant-time" code, the compiler can reorder or elide your barrier. Verify the generated assembly for security-critical gadgets, or rely on the compiler's own mitigation pass.
- **"We bounds-check, so we're safe" is the exact misconception Spectre exploits.** The check is fine; speculation runs *past* it.
- **Forgetting the read phase needs a timer.** If you remove the attacker's high-resolution clock, you remove their ability to decode the cache — a real, deployed mitigation in browsers.
- **Assuming Prime+Probe needs shared memory.** It does not — that's why it works cross-VM in clouds and why cache partitioning matters.
- **Treating v1 as the only one.** v1 is the cleanest, but v2, v4, Meltdown, MDS, L1TF, and retbleed each have their own mechanism and their own mitigation — that's `senior.md`.

---

## Test Yourself

1. Distinguish out-of-order execution from speculative execution. Why does each one exist?
2. Explain, in one sentence each, what the **encode** and **read** phases of a Spectre attack do.
3. Walk through the six steps of Spectre v1. At which step does the secret enter the cache, and at which step does the attacker read it out?
4. Why can't Spectre v1 be fixed by "bounds-checking more carefully"?
5. Compare Flush+Reload and Prime+Probe: what does each require, and why is Prime+Probe used cross-VM?
6. Why is index masking usually cheaper than an `lfence` for v1 mitigation?
7. Why did Spectre force *site isolation* in browsers and *timer reduction* / `SharedArrayBuffer` restrictions?
8. What microarchitectural state does the CPU fail to roll back after a squash, and why does that matter?

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| OoO execution | Run ready instructions early, retire in order. |
| Speculation | Run past a branch on a predicted outcome; squash if wrong. |
| Squash | Rolls back **architectural** state; **not** the cache. |
| Flush+Reload | Shared mem; flush, wait, time reload → fast = victim touched it. |
| Prime+Probe | No shared mem; fill set, wait, time probe → slow = victim evicted it. |
| Spectre v1 | Train predictor → speculate past bounds check → transient OOB read → leak via cache. |
| `lfence` | Speculation barrier between check and access (correct but slow). |
| Index masking | Clamp the index in data so OOB is impossible even transiently (cheap). |
| Browser fix | Site isolation + reduced timers + restricted `SharedArrayBuffer`. |

---

## Summary

Modern CPUs run instructions **out of order** and **speculatively** to hide the huge latency of memory and keep the pipeline full past branches. When a speculation is wrong, the CPU **squashes** the bad work and restores the **architectural** state — registers and memory look untouched. But it does **not** restore the **microarchitectural** state: any cache lines the transient instructions warmed *stay warmed*. That incomplete rollback is the entire Spectre family's foothold.

The attacker reads those warmed lines with the **cache-attack toolkit**: **Flush+Reload** (precise, needs shared memory), **Prime+Probe** (general, needs no shared memory, works cross-VM), and **Evict+Time** (coarse). **Spectre v1** chains them: train the branch predictor to take a bounds check, then pass an out-of-bounds index so the CPU *speculatively* reads a secret and uses it to index a probe array — encoding the secret into which cache line gets warm — then read it back with Flush+Reload. Crucially, **there is no memory-safety bug**: the bounds check is correct; the CPU simply acts past it before it resolves. Defenses target the gadget (**`lfence` speculation barrier**, or cheaper **index masking** via `array_index_nospec`) or the precondition (**process/site isolation**, **reduced timers**, **`SharedArrayBuffer` restrictions**). Because Spectre needs the attacker to share hardware with the secret, the most durable defense is isolation — which is exactly why browsers adopted site isolation and clouds rethought co-location. The other transient-execution variants build on this same encode-then-read skeleton, and they are next in `senior.md`.

---

## Further Reading

- The original Spectre paper (Kocher et al., 2018) — the bounds-check-bypass walkthrough this page mirrors.
- "Flush+Reload" (Yarom & Falkner) and the Prime+Probe literature — the cache-attack primitives.
- The Linux kernel's `array_index_nospec()` documentation and the Spectre-v1 mitigation discussion.
- Chromium's "Site Isolation" design docs — the browser response to Spectre.
- Continue in `senior.md` for the full transient-execution taxonomy: Spectre v2/v4, Meltdown, MDS/RIDL, L1TF/Foreshadow, retbleed.
