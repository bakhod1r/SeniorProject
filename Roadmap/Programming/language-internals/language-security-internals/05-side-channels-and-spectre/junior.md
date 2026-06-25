# Side Channels & Spectre — Junior Level

> **Topic:** [Side Channels & Spectre](README.md)
> **Focus:** Your code can leak a secret without a single bug, a single overflow, or a single line of "unsafe" code — just by how *long* it runs or which *memory* it touches. Here is how, and the first habit that stops it.

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

> Focus: **What is a side channel?** And **why is a password check that "works perfectly" still a security hole?**

Every program you have written so far has one job: take an input, compute an output, return the output. You judged it "correct" when the output was right. A **side channel** is the uncomfortable discovery that the output is not the only thing the outside world can observe. The program also takes *time*. It touches *memory*. It draws *power*. It emits *heat* and faint *electromagnetic noise*. None of those things are part of your function's return value — they are *side effects of the act of computing* — and yet an attacker who can measure any of them can sometimes reconstruct the secret your program was trying to protect.

The key idea, and the one to hold onto for the rest of this topic: **a side-channel attack does not break your program. Your program runs exactly as designed, returns exactly the right answer, never reads out-of-bounds, never crashes.** There is no buffer overflow, no SQL injection, no missing bounds check. The leak happens in the *physics and timing* of the computation, not in its logic. This is what makes side channels so slippery: every test passes, every code review looks clean, and the secret walks out the door anyway.

Here is the smallest possible example, one you have almost certainly written. You compare a submitted password (or an API token, or a message authentication code) against the correct one with something like `if (submitted == correct)`. In most languages that string comparison is a loop that compares one character at a time **and stops the instant it finds a mismatch**. That early stop is an optimization — and it is also a *timing leak*. A wrong password that differs at the first character returns a hair faster than one that matches the first ten characters. An attacker who can measure that hair, over millions of guesses, can recover your secret one character at a time, *without ever guessing the whole thing at once*.

> 🎓 **Why this matters for a junior:** The single most common security bug juniors ship is not an injection or an overflow — it is a **non-constant-time comparison of a secret**, written with `==`, `memcmp`, or `String.equals`. It looks correct, it passes every test, and it is exploitable. Learning the one habit in this file — comparing secrets in *constant time* — prevents a whole category of real CVEs that ship in real products every year.

This page covers: what a side channel is, the famous **timing attack** and why early-exit comparison leaks, a first look at **cache attacks** (how an attacker watches which memory you touched), a *very brief* mention of power/EM channels, and then the headline-grabbing modern class — **Spectre and Meltdown** — explained at a level you can actually understand, plus the one defensive habit (constant-time code) that you should start using today. The deeper machinery (how speculative execution works, the full taxonomy of transient-execution attacks, the hardware mitigations) lives in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write a function that compares two strings or two byte arrays.
- **Required:** What a `for` loop and an `if` statement compile to, roughly (a comparison, a conditional jump).
- **Required:** The vague idea that reading memory and doing work *takes time*, and that different code paths can take *different* amounts of time.
- **Helpful but not required:** Awareness that your CPU has a **cache** — a small, fast memory that holds recently-used data so it does not have to go to slow main RAM every time.
- **Helpful but not required:** Knowing what a hash, a MAC (message authentication code), or an API token is — the secrets we most often protect.

You do **not** need to know:

- How the CPU pipeline or speculative execution works internally (that is `middle.md`).
- The full list of transient-execution attacks — Spectre v1/v2/v4, Meltdown, MDS, L1TF, retbleed (that is `senior.md` and `professional.md`).
- How to *implement* an attack. We will never build a working exploit here — only enough mechanism to understand the defense.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Side channel** | An unintended path that leaks information about a computation through a *physical or timing* property (time, cache state, power, EM, sound), not through its declared output. |
| **Side-channel attack** | Recovering a secret by measuring a side channel rather than by breaking the program's logic. |
| **Secret** | The data you are trying to protect: a password, a private key, a token, a MAC, a credit-card number. |
| **Timing attack** | A side-channel attack that measures *how long* a computation takes to infer something about the secret. |
| **Constant-time code** | Code whose execution time (and memory-access pattern) does **not** depend on the secret values it handles. The primary defense against timing leaks. |
| **Early exit** | Returning from a loop as soon as the answer is known (e.g., a mismatch found). Fast, and a classic timing leak when the loop touches a secret. |
| **Cache** | Small fast CPU memory holding recently-used data. A *cache hit* is fast; a *cache miss* (go to RAM) is much slower — and that difference is measurable. |
| **Cache attack** | Observing which cache lines a victim touched (via timing) to infer the victim's secret-dependent memory accesses. |
| **MAC (Message Authentication Code)** | A short tag that proves a message was not tampered with. Verifying a MAC means comparing two tags — a place you *must* use constant-time comparison. |
| **Speculative execution** | A CPU optimization: the processor *guesses* the outcome of a branch and runs ahead before it knows the guess was right. If wrong, it throws the work away — *architecturally*. |
| **Architectural state** | The "official" CPU state your program can see: registers, memory values. Speculation that turns out wrong is rolled back here. |
| **Microarchitectural state** | The hidden performance machinery: caches, predictors, buffers. Speculation leaves *traces* here that are **not** rolled back. This is the leak. |
| **Spectre** | A family of attacks that trick the CPU into speculatively touching memory it should not, then read the secret out of the cache trace it left behind. |
| **Meltdown** | A related attack that transiently reads kernel memory from user space before the permission check "catches up." |
| **Covert channel** | A channel deliberately used to move data between two parties who are not supposed to communicate — here, the cache is turned into one. |

---

## Core Concepts

### 1. The output is not the only observable

When you reason about a function, you think about inputs and the returned value. A security analyst thinks about everything an attacker can *observe*:

- **Time:** how many nanoseconds (or milliseconds) it ran.
- **Memory access pattern:** which addresses / cache lines it touched.
- **Power:** how much current it drew (relevant for smartcards, IoT, hardware tokens).
- **Electromagnetic emission:** the faint radio noise the chip emits while switching.
- **Sound:** yes — capacitors and coils on a board emit a faint whine that correlates with what the CPU is doing (acoustic cryptanalysis is real, though exotic).

If *any* of these observables changes depending on the *secret*, you have a side channel. The fix is always the same shape: make the observable **independent of the secret**.

### 2. The canonical leak: early-exit comparison

Look closely at how a normal string/byte comparison works:

```text
compare(a, b):
    for i in 0..len:
        if a[i] != b[i]:
            return false      # <-- stops HERE, early
    return true
```

That `return false` is the whole problem. The number of loop iterations executed depends on **how many leading characters matched** — which depends on the secret. Concretely:

- Guess `Xxxxxxxx` vs secret `password` → mismatch at index 0 → loop runs **1** iteration.
- Guess `pxxxxxxx` vs secret `password` → mismatch at index 1 → loop runs **2** iterations.
- Guess `paxxxxxx` vs secret `password` → mismatch at index 2 → loop runs **3** iterations.

The function takes slightly longer the more leading characters you get right. An attacker times each guess, notices that `p...` is consistently a tiny bit slower than `X...`, concludes the first character is `p`, then attacks the second character, and so on. Instead of guessing a 16-character secret (astronomically hard), they guess it **one character at a time** (trivially easy). The math collapses from "impossible" to "a few thousand requests."

This is not a hypothetical. Timing attacks on MAC and token comparison are a recurring real-world vulnerability class.

### 3. The cure: constant-time comparison

To compare two secrets without leaking, you must **always look at every byte** and **combine the results without branching**:

```text
constant_time_equal(a, b):           # assume same length
    diff = 0
    for i in 0..len:
        diff |= a[i] XOR b[i]        # accumulate differences, never branch
    return diff == 0
```

Walk through it. `a[i] XOR b[i]` is `0` when the bytes match and non-zero when they differ. We `OR` (`|=`) every result into `diff`. After the loop, `diff` is `0` if *and only if* every byte matched. Crucially:

- The loop **always runs the full length** — no early exit.
- There is **no branch inside the loop** that depends on the secret.
- The running time depends only on the *length*, which is not secret.

This is the single most important defensive habit in this whole topic. Real languages and crypto libraries give you a ready-made version (see Code Examples). **Use them. Never compare a secret with `==`, `memcmp`, or `.equals()`.**

### 4. Cache attacks: watching which memory you touched

Timing the *whole function* is the simplest channel. A sharper one watches *which memory addresses* you touched, using the cache. The intuition you need now:

- Reading data that is **in the cache** is fast. Reading data that is **not** (a cache miss, goes to RAM) is much slower — and the difference is large enough to measure with a clock.
- So an attacker can ask: "Did the victim recently touch *this particular* cache line?" by timing how long *they* take to read it. Fast read → the victim loaded it (it is cached). Slow read → the victim did not.

Why does that leak a secret? Because some code touches **different memory depending on secret data**. A classic example: an encryption routine that uses a secret key byte as an *index* into a lookup table (`table[key_byte]`). Which table entry it reads — and therefore which cache line gets loaded — reveals the value of that key byte. By watching the cache, the attacker reads the key out of the *access pattern*, never touching the key directly. (You will meet the named techniques — Flush+Reload, Prime+Probe — in `middle.md`.)

The defense rhymes with constant-time comparison: **do not let secrets steer which memory you touch.** Don't index tables with secret bytes; don't branch to different code based on secret bits.

### 5. Power, EM, and acoustic channels (brief)

On a smartcard, a hardware security key, or an IoT chip, an attacker may have *physical access* and can put a probe on the power line or near the chip. The current the chip draws depends on what it is computing — a `1` bit and a `0` bit flip different numbers of transistors and draw measurably different power. **Power analysis** (especially "differential power analysis") can extract keys from a chip by averaging thousands of power traces. EM (electromagnetic) and acoustic channels are the same idea through different physics. As a junior writing application code, you will rarely defend against these directly — they are the domain of hardware and embedded-crypto engineers — but you should know they exist, because they explain why secure hardware (HSMs, secure enclaves, smartcards) is engineered so carefully.

### 6. The modern headline: Spectre and Meltdown (intuition only)

In 2018 the world learned that the CPU itself contains a side channel, built into a *performance optimization* present in nearly every processor made in the previous two decades. Here is the intuition; the mechanism is in `middle.md`.

Modern CPUs do not patiently wait to find out whether an `if` is true before continuing. They **guess** (this is *speculative execution* and *out-of-order execution*) and race ahead, executing instructions *past* the branch on the assumption their guess is right. If the guess was right, great — free speed. If wrong, the CPU **rolls back** the wrong work so your program never officially sees it.

The catch: the rollback is *incomplete*. The CPU undoes the **architectural** state (registers, memory) — but it does **not** undo the **microarchitectural** state, specifically *the cache*. During the wrongly-speculated run, the CPU may have loaded some data into the cache based on a secret. That data load is rolled back logically, but the *cache line it pulled in stays warm*. Now the attacker uses a cache attack (Core Concept 4) to detect which line is warm — and reads out the secret that the speculation "should never have touched."

That is the whole trick: **architectural state is rolled back; microarchitectural state is not; the gap between them is a covert channel.** **Spectre** tricks a program into speculating past a bounds check and leaking via the cache. **Meltdown** transiently reads privileged (kernel) memory before the "you're not allowed" fault is delivered. Both forced enormous, expensive changes across the entire industry — browsers, operating systems, and cloud platforms — which is why this topic matters far beyond academic curiosity.

---

## Real-World Analogies

**The locked diary and the bookmark.** Imagine a diary you cannot open (the secret is safe — no memory-safety bug). But every time the owner reads it, they leave the ribbon bookmark on the page they last read. You never open the diary, but by glancing at where the ribbon sits, you learn which page mattered to them. The diary's *contents* never leaked — its *access pattern* did. That ribbon is the cache line a cache attack reads.

**The guess-the-password game show.** A host has a secret word. Each time you guess, the host says "wrong" — but a buzzer takes a fraction of a second longer to sound the more leading letters you got right. You never see the word, but the buzzer's delay tells you, letter by letter, when you're on the right track. That is a timing attack on early-exit comparison.

**The detective and the warm engine.** A car has just been driven, then parked among twenty identical cars. You can't see who drove which. But you can touch each hood: the warm one was driven recently. Flush+Reload is exactly this — the attacker "feels" which cache lines are warm to learn which the victim just used.

**Speculation as an over-eager intern.** You tell an intern, "If the customer is a VIP, pull their file." The intern, to save time, *runs to the cabinet and starts pulling the file before you finish the sentence*. If it turns out the customer isn't a VIP, the intern shoves the file back and pretends nothing happened — but the cabinet drawer is now slightly ajar, and anyone watching the cabinet knows which file was touched. The "official" record shows nothing was pulled; the *physical drawer* tells a different story. That ajar drawer is the warm cache line after a mis-speculated read.

---

## Mental Models

**Model 1: Two channels out of every function — the front door and the side door.** The front door is the return value; you guard it carefully. The side door is *time, cache, power*. Secrets leak through the side door precisely because nobody thinks to lock it. Constant-time programming is "lock the side door."

**Model 2: Anything secret-dependent that is observable is a leak.** Make a checklist of observables — time, memory-access pattern — and ask of each: *does this change with the secret?* If yes, that's your bug. If no, you're constant-time on that channel.

**Model 3: The optimization is the hole.** Early exit, caching, branch prediction, speculation — every one of these is a *speed optimization* that works by *doing different amounts of work depending on the data*. Side channels are the tax we pay for those optimizations. Defending often means *giving up the optimization* (do all the work every time) — which is why the defenses cost performance.

**Model 4: Architectural vs. microarchitectural — the official record vs. the smudges.** The CPU keeps an official record (registers, memory) it carefully cleans up. It also leaves smudges (cache warmth, predictor state) it does *not* clean up. Spectre-class attacks read the smudges.

---

## Code Examples

### The bug: leaky token comparison (do **not** do this)

```python
# INSECURE — early-exit comparison leaks via timing.
def check_token(submitted: str, correct: str) -> bool:
    return submitted == correct          # stops at first mismatching char
```

```java
// INSECURE — String.equals short-circuits on the first difference.
boolean checkToken(String submitted, String correct) {
    return submitted.equals(correct);
}
```

```c
/* INSECURE — memcmp returns as soon as it finds a differing byte. */
int check_token(const unsigned char *submitted, const unsigned char *correct, size_t n) {
    return memcmp(submitted, correct, n) == 0;
}
```

All three are functionally correct and all three leak. The leak is the *early exit*.

### The fix: use the library's constant-time comparison

Do not hand-roll crypto — use the vetted function your platform already ships:

```python
# Python: hmac.compare_digest is constant-time for equal-length inputs.
import hmac
def check_token(submitted: str, correct: str) -> bool:
    return hmac.compare_digest(submitted, correct)
```

```java
// Java: MessageDigest.isEqual is constant-time (since Java 6u17).
import java.security.MessageDigest;
boolean checkToken(byte[] submitted, byte[] correct) {
    return MessageDigest.isEqual(submitted, correct);
}
```

```go
// Go: subtle.ConstantTimeCompare returns 1 if equal, 0 otherwise.
import "crypto/subtle"
func checkToken(submitted, correct []byte) bool {
    return subtle.ConstantTimeCompare(submitted, correct) == 1
}
```

```c
/* C with libsodium: sodium_memcmp is constant-time. */
#include <sodium.h>
int check_token(const unsigned char *a, const unsigned char *b, size_t n) {
    return sodium_memcmp(a, b, n) == 0; /* 0 == equal */
}
```

### What "constant-time" looks like under the hood

You will normally call the library, but it helps to see the shape so you recognize it:

```c
/* Conceptual constant-time byte comparison. Always scans all n bytes,
 * never branches on the data. (Real libraries also guard against the
 * compiler "optimizing" the constant-timeness away.) */
int ct_equal(const unsigned char *a, const unsigned char *b, size_t n) {
    unsigned char diff = 0;
    for (size_t i = 0; i < n; i++) {
        diff |= a[i] ^ b[i];   /* accumulate; no early return */
    }
    return diff == 0;          /* one branch at the very end, on a non-secret bit */
}
```

> ⚠️ **Length is not secret here, but be careful:** if the two inputs can have *different* lengths and you bail out early on a length mismatch, you have leaked the length. For tokens and MACs, hash or pad to a fixed length, or use a library function designed for the case.

### Don't index memory with a secret (cache-attack surface)

```c
/* RISKY: which table entry (and cache line) is loaded depends on the secret.
 * This pattern is how naive table-based AES leaked keys via cache attacks. */
unsigned char sub = sbox[secret_byte];   /* memory access steered by a secret */
```

The defensive replacement is to use hardware crypto instructions (e.g., AES-NI) or a bitsliced/constant-time implementation that does not index tables by secret data. As a junior: **don't roll your own crypto; call a vetted library that has already solved this.**

---

## Pros & Cons

This table frames the *trade-offs of defending* (and of the optimizations that create the holes), since "side channels" themselves are not something you adopt — they are something you defend against.

| Aspect | Upside | Downside |
|--------|--------|----------|
| **Constant-time comparison** | Closes the timing leak completely; trivial to adopt (one library call). | Slightly slower than early-exit; you must remember to use it *everywhere* a secret is compared. |
| **Constant-time crypto overall** | Robust against timing and cache attacks. | Often slower and harder to write than the "natural" data-dependent version; needs verification tools. |
| **CPU speculation (the optimization)** | Massive real-world speedup — modern CPUs would crawl without it. | Created the entire Spectre/Meltdown class; mitigations cost performance. |
| **OS/browser mitigations (KPTI, site isolation)** | Block Meltdown / Spectre in practice; shipped to billions of devices. | Measurable performance and memory cost; complexity. |
| **Removing high-resolution timers** | Makes timing the cache harder for web attackers. | Hurts legitimate performance-measurement APIs. |

---

## Use Cases

You should be thinking about side channels whenever your code **handles a secret and an attacker can measure something about the computation**:

- **Verifying tokens, API keys, MACs, signatures, or password hashes** — the #1 place a junior must use constant-time comparison.
- **Comparing CSRF tokens or webhook signatures** — same hazard, same fix.
- **Any cryptographic operation** — use vetted libraries; never hand-roll the comparison or the table lookups.
- **Multi-tenant / cloud / browser environments** — where untrusted code runs on the *same hardware* as your secrets, making Spectre-class attacks relevant (mitigated at the OS/browser/cloud layer, but you should know why those mitigations exist).
- **Embedded / smartcard / IoT firmware** — where power and EM channels matter and dedicated countermeasures are required.

You generally do **not** need to hand-write microarchitectural defenses in ordinary application code — those live in compilers, OS kernels, browsers, and hardware. Your job at the application layer is mostly: **constant-time secret handling, and don't roll your own crypto.**

---

## Coding Patterns

**Pattern: constant-time equality, always.** Any time the values being compared include a secret, route through a constant-time comparison function. Make it a code-review checklist item.

**Pattern: fixed-length, fixed-work.** Where you can, make the work independent of the secret: compare hashes of fixed length, pad inputs, process all elements rather than stopping early.

**Pattern: lean on the library.** Crypto libraries (`hmac`, `crypto/subtle`, `MessageDigest`, libsodium, BoringSSL) have already solved constant-time comparison and constant-time crypto. Calling them is the pattern; re-implementing them is the anti-pattern.

**Pattern: don't branch or index on secrets.** If a branch condition or an array index is derived from a secret, that is a side-channel smell. Restructure so the secret only flows through arithmetic/bitwise operations, never through control flow or addresses.

---

## Best Practices

1. **Never compare secrets with `==`, `memcmp`, or `.equals()`.** Use `hmac.compare_digest`, `crypto/subtle.ConstantTimeCompare`, `MessageDigest.isEqual`, or `sodium_memcmp`.
2. **Don't roll your own crypto.** The vetted libraries have already handled constant-time comparison, constant-time table lookups, and blinding. You will get it subtly wrong.
3. **Treat timing as an output.** When a function handles a secret, ask: "Does its running time depend on the secret?" If yes, fix it.
4. **Keep secret data out of control flow and addresses.** No secret-dependent branches; no secret-dependent array indices.
5. **Keep your platform patched.** Spectre/Meltdown mitigations ship as OS, microcode, browser, and compiler updates. Applying them is most of the practical defense for application developers.
6. **Understand *why* your platform is slower.** KPTI, retpolines, and site isolation cost performance — that cost is the price of closing these channels, not a bug.

---

## Edge Cases & Pitfalls

- **"It passed all my tests" is not safety.** Side channels are invisible to functional tests. A leaky comparison and a constant-time one return identical values for every input — they differ only in timing.
- **Early-exit hidden inside a library call.** `==`, `strcmp`, `Arrays.equals`, and `memcmp` all short-circuit. The leak hides inside the standard library you trusted.
- **Comparing different-length inputs leaks the length.** If you `return false` immediately when lengths differ, you've revealed the secret's length. Hash first, or use a function designed for it.
- **The compiler can "optimize away" your constant-time code.** A clever compiler may notice it can short-circuit your careful loop and reintroduce a branch. This is exactly why you use the library's version, which is written to resist that.
- **High-resolution timers help attackers.** Browsers deliberately reduced timer precision and restricted `SharedArrayBuffer` after Spectre to make timing the cache harder — a reminder that even "read the clock" can be an attack tool.
- **Logging timing of secret operations.** If you log "auth check took 1.3ms," you may be *publishing* the side channel. Be careful what you measure and expose.
- **Assuming Spectre is "only a CPU/OS problem."** It is mostly mitigated below your code — but in shared environments (browsers running untrusted JS, multi-tenant clouds) the *reason* your platform isolates processes is to contain these attacks. Don't disable those protections to chase performance without understanding the cost.

---

## Test Yourself

1. In one sentence, what is a side channel, and how is it different from a normal bug like a buffer overflow?
2. Explain precisely *why* `submitted == correct` leaks information when `correct` is a secret token.
3. Write out (in pseudocode) a constant-time byte comparison and explain why each line avoids the leak.
4. What is the difference between **architectural** and **microarchitectural** state, and which one does the CPU fail to roll back after a wrong speculation?
5. Why does reading data that is "in the cache" being faster than reading from RAM turn the cache into a side channel?
6. Why do browsers reduce timer resolution and restrict `SharedArrayBuffer`?
7. Name three things an attacker might measure as a side channel besides wall-clock time.
8. Why is it dangerous to use a *secret* byte as an *index* into a lookup table?

---

## Cheat Sheet

| Situation | Wrong (leaky) | Right (constant-time) |
|-----------|---------------|------------------------|
| Compare token/MAC (Python) | `a == b` | `hmac.compare_digest(a, b)` |
| Compare bytes (Go) | `bytes.Equal(a, b)` for secrets | `subtle.ConstantTimeCompare(a, b) == 1` |
| Compare bytes (Java) | `Arrays.equals(a, b)` | `MessageDigest.isEqual(a, b)` |
| Compare bytes (C) | `memcmp(a, b, n) == 0` | `sodium_memcmp(a, b, n) == 0` |
| Crypto table lookup | `table[secret_byte]` | use AES-NI / vetted constant-time impl |
| Branch on a secret | `if (secret_bit) {...}` | branchless arithmetic / library |

**Two rules to remember forever:** (1) Never compare a secret with `==`/`memcmp`/`.equals`. (2) Don't roll your own crypto — call the vetted library, which already handles constant time.

---

## Summary

A **side channel** leaks a secret not through your program's logic but through *how it behaves physically*: how long it runs, which memory it touches, how much power it draws. Your program can be perfectly correct — no overflow, no crash — and still hand the secret to anyone who can measure the side channel. The classic example is **early-exit comparison**: `==` on a secret token stops at the first mismatch, so its timing reveals how many leading characters were right, letting an attacker recover the secret one character at a time. The fix is **constant-time comparison**: always scan every byte, never branch on the data, and lean on the vetted library function (`hmac.compare_digest`, `crypto/subtle`, `MessageDigest.isEqual`, `sodium_memcmp`).

**Cache attacks** sharpen this: by timing their own memory reads, an attacker can tell *which cache lines a victim touched*, leaking any secret that steers memory access — which is why you must not index tables or branch on secret data. **Spectre and Meltdown** showed the CPU's own speed optimizations (speculative and out-of-order execution) form a side channel: the processor speculatively touches secret memory, rolls back the *architectural* state, but leaves the *microarchitectural* cache trace behind — and that gap is a covert channel. These attacks forced KPTI in every OS and site isolation in every browser. As a junior, your highest-leverage habits are simple and durable: **never compare secrets in non-constant time, don't roll your own crypto, treat timing as an output, and keep your platform patched.**

---

## Further Reading

- "Remote Timing Attacks Are Practical" (Brumley & Boneh) — the paper that made timing attacks undeniable.
- The Spectre and Meltdown papers (2018) and the project pages that accompanied them.
- Your language's standard-library docs for constant-time comparison: Python `hmac.compare_digest`, Go `crypto/subtle`, Java `MessageDigest.isEqual`, libsodium `sodium_memcmp`.
- "A beginner's guide to constant-time cryptography" style write-ups from reputable crypto engineers.
- Continue in `middle.md` for how speculative and out-of-order execution actually work, and the named cache-attack techniques (Flush+Reload, Prime+Probe).
