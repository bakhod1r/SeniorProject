# Side Channels & Spectre — Interview Questions

> **Topic:** [Side Channels & Spectre](README.md)

---

## Introduction

These questions probe whether a candidate truly understands the defining feature of side-channel and transient-execution attacks: a secret can leak without any memory-safety violation — no overflow, no out-of-bounds write, no crash — purely through *how long* a computation takes or *which memory* it touches. A strong candidate reasons mechanically: they distinguish architectural from microarchitectural state, they describe the encode-then-read structure of every Spectre-class attack, they classify a new variant by *which structure it misleads* and *which boundary it crosses*, and they know that constant-time code must be *verified*, not asserted, because the compiler is adversarial to it. A weaker candidate recites "use a lock" equivalents — "just patch the CPU," "use HTTPS" — without explaining the mechanism or the precise defense.

The questions progress from conceptual foundations, to variant-specific mechanism questions (Spectre v1/v2/v4, Meltdown, MDS/RIDL, L1TF, retbleed/PACMAN-class), to traps where the textbook answer is subtly wrong, and finally to design scenarios that test whether the candidate has actually had to defend a real system.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Variant-Specific](#variant-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What is a side-channel attack, and how does it differ from a "normal" vulnerability like a buffer overflow?**

A side-channel attack recovers a secret by measuring a *physical or timing* property of a computation — how long it runs, which cache lines it touches, how much power it draws, its electromagnetic or acoustic emissions — rather than by exploiting a flaw in the program's logic. The defining contrast: a buffer overflow is a *memory-safety violation* in which the program does something it was never supposed to do (write out of bounds). A side channel involves the program running **exactly as designed**, returning **exactly the right answer**, never reading or writing out of bounds and never crashing — yet still leaking the secret through a side effect of the act of computing. This is what makes side channels insidious: every functional test passes and every code review of the logic looks clean, because the leak is not in the logic at all. The defense is correspondingly different: not bounds checks, but making the *observable* (time, access pattern) independent of the secret.

## Question 2

**Why does comparing a secret token with `==` (or `memcmp`, or `String.equals`) leak information?**

Those comparisons short-circuit: they return as soon as they find the first differing byte. The number of bytes compared — and thus the time taken — depends on how many *leading* bytes matched, which depends on the secret. An attacker who can measure that timing learns, for each guess, whether they got more leading bytes right, letting them recover the secret **one byte at a time** instead of guessing it whole. That collapses the attacker's work from astronomically infeasible (guess the whole secret) to trivially feasible (a few thousand timed requests per byte). The fix is a constant-time comparison that *always scans every byte* and accumulates differences without branching: `diff |= a[i] ^ b[i]` over the full length, then check `diff == 0`. Use the library version — `hmac.compare_digest`, `crypto/subtle.ConstantTimeCompare`, `MessageDigest.isEqual`, `sodium_memcmp` — never a hand-rolled or stdlib short-circuiting comparison on a secret.

## Question 3

**Distinguish architectural state from microarchitectural state, and explain why the distinction is the heart of Spectre.**

Architectural state is the CPU's *official, programmer-visible* state: registers and memory values, as defined by the instruction-set architecture. Microarchitectural state is the *hidden performance machinery*: caches, branch predictors, internal buffers — structures that exist only to make execution fast and that the ISA does not expose. When a speculation turns out wrong, the CPU **squashes** the bad work and carefully restores the *architectural* state, so the program never officially observes it. But it does **not** restore the *microarchitectural* state — in particular, cache lines warmed by the transient (squashed) loads stay warm. Spectre and its relatives live entirely in that gap: they coax the CPU into doing *secret-dependent* work speculatively, let it "undo" that work architecturally, and then read the secret out of the surviving microarchitectural residue (usually via a cache-timing attack). In one sentence: **architectural state is rolled back, microarchitectural state is not, and that gap is a covert channel.**

## Question 4

**Describe the encode-then-read structure common to all transient-execution attacks.**

Every Spectre-class attack has two phases. In the **encode** phase, the attacker induces the CPU to *transiently* (speculatively, before the work is squashed) access memory in a way that depends on a secret — for example, using a transiently-read secret byte as an index into a probe array, which pulls one specific cache line into the cache. The secret is now encoded in *which* line is warm. In the **read** phase, the attacker uses a cache-timing attack — Flush+Reload, Prime+Probe, or Evict+Time — to detect which line is warm, decoding the cache state back into the secret value, typically one byte at a time. Recognizing these two phases lets you classify and reason about any variant: the differences between variants are mostly in *how the encode phase is triggered* (which structure is misled, which boundary is crossed), while the read phase is the same cache-attack machinery.

## Question 5

**Explain Flush+Reload and Prime+Probe, and when each is used.**

Both let an attacker learn *which cache lines a victim touched*, exploiting the measurable difference between a cache hit (fast) and a miss (slow). **Flush+Reload** requires memory *shared* with the victim (a shared library page, a known buffer): the attacker flushes a target line out of all caches (`clflush`), waits while the victim runs, then times reloading the line — a fast reload means the line is cached, so the victim must have touched it. It is precise and low-noise but needs shared memory. **Prime+Probe** needs *no* shared memory and therefore works across processes and even across VMs: the attacker fills (primes) a whole cache set with its own data, waits while the victim runs, then re-reads (probes) its data and times it — a slow re-read of some line means the victim *evicted* it, revealing that the victim accessed an address mapping to that set. Prime+Probe is noisier but far more general, which is why it dominates cross-tenant cloud attacks.

## Question 6

**Why did Spectre force "site isolation" in browsers and KPTI in operating systems?**

Both are isolation responses to the two attack families. **Site isolation** (each website in its own OS process) was the browser response to *Spectre*: a malicious page running JavaScript/WASM could speculatively read other data in the same renderer process; if each site lives in its own process, a Spectre leak only sees that one site's data, not your bank tab's. Browsers also *reduced timer resolution* and *restricted `SharedArrayBuffer`* to deny the high-resolution clock the cache-attack read phase needs. **KPTI (Kernel Page Table Isolation)** was the OS response to *Meltdown*: Meltdown transiently reads kernel memory from user space, so KPTI unmaps (most of) the kernel from the user-mode page tables — when user code transiently reads a kernel address, there is simply no mapping and no data to forward. The unifying lesson: when you cannot prevent the leak per-gadget, you remove the attacker's *foothold* — don't let untrusted code share an address space, process, or core with the secret.

## Question 7

**What is constant-time programming, and what are the three things it forbids?**

Constant-time code is code whose execution time *and memory-access pattern* are independent of the secret values it handles, so neither a timing observer nor a cache observer learns anything about the secret. It forbids three things on secret data — the "three constant-time sins": (1) **secret-dependent branches** (`if (secret) ...` leaks via timing and the branch predictor), (2) **secret-dependent memory addresses** (`table[secret]` leaks via the cache — the original AES-table attack), and (3) **secret-dependent variable-latency instructions** (integer division/modulo and some multiplies take data-dependent cycles on many CPUs). The replacements are branchless selection via bitmasks, full-table scans or hardware crypto instead of secret-indexed lookups, and avoiding or blinding variable-latency arithmetic. Crucially, constant-timeness must be *verified* (dudect, ctgrind), not assumed, because the compiler can reintroduce a branch into "branchless" source.

## Question 8

**Briefly: what are power, electromagnetic, and acoustic side channels, and who has to worry about them?**

These are physical side channels that matter when an attacker has proximity or physical access to the device — smartcards, hardware security keys, HSMs, IoT, and embedded chips. The current a chip draws depends on what it computes (flipping a `1` bit versus a `0` bit toggles different numbers of transistors), so **power analysis** — especially *differential power analysis*, which averages thousands of traces to cancel noise — can extract a key from a chip even when the software is logically perfect. **Electromagnetic** channels read the same switching activity as radio emissions; **acoustic** channels read the faint whine of capacitors and coils that correlates with CPU activity. Ordinary application developers rarely defend against these directly; they are the domain of hardware and embedded-crypto engineers, who use techniques like masking, hiding, shielding, and balanced logic. But every engineer should know they exist, because they explain why secure hardware is engineered so carefully and why secrets belong in dedicated secure elements.

---

## Variant-Specific

## Question 9

**Walk through Spectre v1 (bounds-check bypass) step by step. Why can't "bounds-check more carefully" fix it?**

Consider `if (x < array1_size) { y = array2[array1[x] * 64]; }`, with attacker-controlled `x`. (1) The attacker **trains the branch predictor** by calling with in-bounds `x` so it learns "branch taken." (2) They flush `array1_size` (so resolving the check is slow) and flush the `array2` probe region. (3) They pass an *out-of-bounds* `x` so `array1[x]` points at a secret byte. (4) Because the check resolves slowly and the predictor says "taken," the CPU **speculatively** executes the body: it transiently reads the secret and uses it to index `array2`, pulling one specific cache line in — the line index encodes the secret. (5) The check finally resolves, `x` was out of bounds, the work is **squashed** — architecturally nothing happened. (6) The attacker does **Flush+Reload** over `array2`; the one warm line reveals the secret byte. You cannot fix this by bounds-checking more carefully because **the bounds check is already correct** — the CPU acts on the speculated path *before* the check resolves. The fixes target speculation (`lfence` barrier) or make the bad index harmless (index masking / `array_index_nospec`).

## Question 10

**What is Spectre v2 (branch-target injection), and how do retpoline and eIBRS each defeat it?**

Spectre v2 attacks *indirect* branches — calls/jumps through a function pointer, vtable, or jump table — whose *target* is predicted by the Branch Target Buffer (BTB). The attacker **mistrains the BTB** (often from a different context, such as another process or an SMT sibling) so that when the victim executes its indirect branch, the CPU speculatively jumps to an **attacker-chosen address** — a "Spectre gadget" already present in the victim's code — which transiently performs a secret-dependent load and encodes it in cache. It is more powerful than v1 because the attacker controls *where* the victim speculatively executes. **Retpoline** is a compiler construct that replaces indirect branches with a contrived `call`/`ret` "return trampoline" whose speculation is steered to a benign loop pad, so the BTB cannot redirect it; it costs indirect-call performance and does not rely on microcode. **IBRS/eIBRS** is a microcode/hardware control that restricts or isolates indirect-branch prediction by privilege domain so a less-privileged context cannot influence a more-privileged one; **eIBRS** is the modern, low-overhead, always-on hardware version. **STIBP** prevents one SMT sibling from influencing the other's predictor, and **IBPB** flushes predictor state on a domain switch.

## Question 11

**Explain Meltdown. Why is it fixed structurally by KPTI rather than by patching code?**

Meltdown transiently reads data across the *privilege* boundary — kernel memory from user space. On affected CPUs, a user-mode load of a kernel address is permitted to forward its *data* to dependent instructions **transiently**, because the permission fault is resolved at *retirement*, not at *issue* (a "deferred fault"). In that window the attacker does the standard encode — `probe[kernel_byte * 64]` — leaving a cache footprint, then reads it back. Architecturally the fault is eventually delivered and no kernel value lands in a register, but the cache already leaked it. Unlike Spectre v1, there is **no gadget in the victim's code** to patch — the attacker writes the entire attack in their own process — so a code fix is impossible. The fix is **structural**: KPTI/KAISER unmaps (most of) the kernel from the user-mode page tables, so when user code transiently reads a kernel address there is no mapping and no data to forward. The cost is a page-table switch (and historically a TLB flush, mitigated by PCID) on every user↔kernel transition. Newer CPUs fix the deferred-fault behavior in hardware, removing the need for KPTI.

## Question 12

**What is Spectre v4 (speculative store bypass)?**

Spectre v4 misleads the CPU's *memory-disambiguation* predictor. When a load follows a store whose address is not yet computed, the CPU predicts whether they alias. If it predicts "no alias," the load **speculatively bypasses the older store** and reads the *stale* value from cache/memory; it later discovers they actually aliased and squashes. During that window, code can transiently operate on stale data — which becomes a gadget, notably in language sandboxes and JITs that rely on a just-written guard, mask, or bounds value that the speculative load reads as its *old* (permissive) value. The defense is **SSBD (Speculative Store Bypass Disable)**, a microcode/MSR control that turns off the bypass for sensitive code; because it costs throughput, it is typically enabled *selectively* for processes that run untrusted code (browsers, JITs, serverless) rather than fleet-wide.

## Question 13

**How do MDS attacks (RIDL, Fallout, ZombieLoad) differ from Meltdown, and why does "disable SMT" recur as the remedy?**

Meltdown and Spectre target a *chosen address*; MDS (Microarchitectural Data Sampling) instead **samples whatever data happens to be in flight** in internal CPU buffers — the line-fill buffer (RIDL), the store buffer (Fallout), or multiple buffers (ZombieLoad). A faulting or assisting load transiently receives stale data from these buffers that may belong to another context — another thread, another privilege level, even another VM on the same physical core. It's a lower-precision "scoop up whatever's passing" attack: the attacker can't pick an address, so they sample repeatedly and filter for the data they want, but it crosses boundaries the address-based attacks can't. **Disabling SMT** recurs because these buffers are shared *concurrently* between two SMT siblings on the same core; microcode buffer-flushing (re-purposed `VERW`) on boundary crossings closes the cross-*privilege* case, but the cross-*thread* case where two logical CPUs run simultaneously often requires turning SMT off for a full guarantee. Newer CPUs fix MDS in hardware.

## Question 14

**What is L1TF / Foreshadow, and why is it especially dangerous for SGX enclaves and virtual machines?**

L1TF (L1 Terminal Fault) abuses page-table entries marked *not present* (or with manipulated physical-address bits). On affected CPUs, a load to such an address can **transiently read whatever data resides at that physical address in the L1 cache**, ignoring the not-present bit during speculation. This is potent because it bypasses the very mechanism that's supposed to keep data unreachable: **Foreshadow** breaks **SGX enclaves** (reading enclave secrets that are otherwise sealed), and across the **hypervisor/VM** boundary it lets a malicious guest read host or other-guest data that happens to be resident in L1. Defenses include **flushing L1D on VM entry**, **page-table inversion** (so not-present entries point their physical-address bits at non-existent memory), and, for the cross-VM SMT case, **core scheduling or disabling SMT** so an attacker VM and a victim VM never share a core's L1 simultaneously.

## Question 15

**What did retbleed and PACMAN demonstrate about the durability of mitigations?**

Both show that a mitigation creates an *assumption* the next attack can break. **Retbleed** demonstrated that on some CPUs, `ret` instructions can be predicted via the same BTB-style machinery as indirect branches, so the retpoline-era assumption that "returns are safe and don't need protection" did not hold universally — additional microcode and return-stack-stuffing/IBPB-style measures were required, at real performance cost. **PACMAN** (a class on ARM) attacked **Pointer Authentication (PAC)**, a memory-safety mitigation: it used speculation to *brute-force a PAC value without crashing*, because wrong guesses are squashed transiently rather than faulting architecturally — so the attacker probes the check for free where it would normally trigger a crash. PACMAN's deeper lesson is the unifying superpower of the whole class: **anything that would normally fault — a wrong PAC, a not-present page, an out-of-bounds index — can be *tested* speculatively where the fault is squashed and costs nothing**, which is exactly why transient execution keeps undermining checks that look airtight architecturally.

---

## Tricky / Trap Questions

## Question 16

**"We bounds-check the index, so we're safe from Spectre v1." True or false?**

False — and it's the exact misconception Spectre v1 exploits. The bounds check is *correct*; the problem is that the CPU **speculatively executes the body past the check before the check resolves**, using the out-of-bounds index transiently. A perfectly correct check does not prevent the speculative out-of-bounds read; it only prevents the *architectural* one. The real mitigations either stop the speculation (`lfence`) or make the index harmless even when used speculatively (index masking / `array_index_nospec`, which clamps the value *in data* so it cannot point out of bounds in any execution). Anyone who answers "we bounds-check, so we're fine" has missed the entire point of the attack.

## Question 17

**"Our auth code passed all unit and integration tests, so it has no timing leak." What's wrong with this reasoning?**

Functional tests are blind to side channels. A leaky early-exit comparison and a constant-time comparison return the *identical value* for every input — they differ only in *timing*, which functional tests don't measure. So passing every test tells you nothing about the timing channel. Detecting a timing leak requires *timing* tooling: dudect (statistically test whether the runtime distribution differs between fixed and random secrets), ctgrind (mark secret bytes as poisoned under Valgrind and flag any branch or memory access that depends on them), or a manual assembly audit. "It passed the tests" is precisely the false comfort that lets non-constant-time comparisons ship in production.

## Question 18

**Does the GIL (or a single-threaded interpreter) protect you from side-channel attacks?**

No — that conflates a *concurrency* property with a *side-channel* property. The GIL serializes Python bytecode execution; it has nothing to do with whether a computation's *timing* or *memory-access pattern* depends on a secret. A single-threaded program that compares a token with `==` still leaks via timing, because the leak is in the time the comparison takes, not in any thread interleaving. Likewise, the attacker doesn't need a thread inside your process — they can be a remote client measuring response latency, or a co-resident process running Prime+Probe. Side channels are about *observable behavior*, independent of how many threads execute it.

## Question 19

**You wrote a careful branchless constant-time comparison in C and reviewed the source. Is it constant-time?**

Not necessarily — reviewing the *source* is insufficient. The compiler optimizes for performance and is free to reintroduce a branch into your "branchless" code, vectorize away padding, short-circuit a loop it can prove is redundant, or constant-fold blinding. Constant-timeness is a property of the *generated machine code on the target CPU*, not of the source. You must verify at the binary level: inspect the emitted assembly for security-critical primitives, use compiler barriers or volatile accesses where needed to prevent the optimizer from collapsing the work, and run a tool like ctgrind or dudect on the actual build. This is also why the standard advice is to *call the vetted library function* (which has already fought this battle, often with assembly or careful barriers) rather than hand-roll it.

## Question 20

**An attacker is in a different VM, with no memory shared with the victim. Are cache attacks off the table?**

No. Flush+Reload needs shared memory and would indeed be unavailable, but **Prime+Probe needs no shared memory** — the attacker fills a cache *set* with its own data and detects when the victim *evicts* a line, inferring the victim's access pattern from its own slowed re-reads. This is exactly why Prime+Probe is the workhorse of cross-VM cloud attacks, and why "no shared memory between tenants" is not a sufficient defense. Real cross-tenant protection requires cache partitioning, core scheduling, or not co-locating untrusted tenants on the same core at all — and for buffer-sampling attacks (MDS) and L1TF, disabling SMT.

## Question 21

**Is `if (length(a) != length(b)) return false;` at the top of your constant-time comparison a problem?**

It can be, because it leaks the *length* of the secret through timing and through whether the early return is taken. For a fixed-size MAC or token (where the correct length is public and the same for all inputs), a length check is generally fine — the length isn't secret. But if the secret's length is itself sensitive, or if comparing variable-length inputs, that early return reveals length information and may also create a timing difference between same-length and different-length inputs. The robust pattern is to compare hashes of a fixed length (so all comparisons are the same size), or to use a library function explicitly designed for the case. The general principle: *anything* you branch on early — including length — is part of the side channel if it depends on the secret.

## Question 22

**"Just apply every CPU mitigation everywhere — security first." Why might a senior engineer push back?**

Because over-mitigation is a real and expensive failure mode, and "security first" without a threat model is not actually good security engineering. Mitigations cost real performance: KPTI taxes syscalls, retpoline taxes indirect branches, SSBD costs per-process throughput, and *disabling SMT* can cost a large slice of fleet capacity — at scale, double-digit percentages, which is millions of dollars, latency budget, and energy. Many mitigations defend against threats that aren't in a given workload's model: a single-tenant host running only trusted code, behind a firewall, with no untrusted neighbors, does not need SMT disabled for MDS. The professional approach is to *mitigate by threat boundary and asset value* — produce a tiered policy (maximal on the secrets/multi-tenant tiers, defaults on the trusted-batch tier), measure each mitigation's cost on the actual workload, and document accepted residual risk so it can be revisited as hardware and attacks evolve.

---

## Design Scenarios

## Question 23

**Design the auth-token verification path for a web service so it has no timing side channel. What do you check?**

Route the token comparison through a **constant-time equality** function — `hmac.compare_digest`, `crypto/subtle.ConstantTimeCompare`, `MessageDigest.isEqual`, or `sodium_memcmp` — never `==`/`memcmp`/`.equals`, which short-circuit. To neutralize length leakage and to make all comparisons fixed-size, compare a **keyed hash (HMAC) of the token** rather than the raw token, so every comparison runs over a constant length and the early-out-on-length issue disappears. Avoid logging or exposing per-request latency for the auth path (don't *publish* the channel). Ensure the surrounding logic — user lookup, "user not found" vs. "wrong password" paths — also runs in indistinguishable time, since a difference there is itself a side channel (e.g., always compute against a dummy hash when the user doesn't exist). Finally, add a **dudect-style timing test in CI** as a regression gate so a future refactor that reintroduces a short-circuit fails the build. The mindset: treat *timing as an output of the auth path* and make it independent of the secret and of whether the account exists.

## Question 24

**You operate a multi-tenant cloud running untrusted guest VMs. Define a mitigation policy.**

Start from the threat model: untrusted guest code runs on your physical CPUs, so cross-tenant transient-execution attacks (Prime+Probe, MDS/RIDL, L1TF/Foreshadow, cross-tenant Spectre v2) are squarely in scope. For tiers that co-locate untrusted guests on shared cores, **disable SMT** (or enforce strict core scheduling so two different tenants never share a core's buffers/L1 simultaneously) to close MDS and L1TF cross-thread leakage; enable **L1D flush on VM entry** and **page-table inversion** for L1TF; enable **SSBD** for guest processes; ensure **eIBRS/retpoline/STIBP/IBPB** for v2; keep **KPTI** (with PCID to limit the syscall tax) and current **microcode/kernel/hypervisor**. For a separate *secrets tier* holding signing keys or aggregated PII, run maximal mitigations and single-tenant scheduling. For internal *trusted-batch* tiers with no untrusted neighbors, run defaults with SMT on. Quantify each mitigation's cost on the actual workloads, encode the policy per tier, and maintain a **residual-risk register** (e.g., "tier X keeps SMT on; revisit on next CPU refresh or new cross-thread CVE"). The core discipline: mitigate by boundary and asset value, measure the cost, and document what you accept.

## Question 25

**You maintain a crypto library. How do you ensure — and prove — that a new primitive is constant-time?**

Enforce the three constant-time rules in the implementation: no secret-dependent branches (use branchless selection via bitmasks and `cswap`), no secret-dependent memory addresses (use hardware crypto like AES-NI, or full-table scans with masked selection, never `table[secret]`), and no secret-dependent variable-latency arithmetic (avoid `secret % n` and data-dependent multiplies; use blinding for big-integer ops like RSA). Then *prove* it rather than assert it, in three tiers: use **ctgrind** during development (mark secret bytes as poisoned under Valgrind so any branch or index on them is reported, pinpointing leaks in source), wire **dudect** into CI as a regression gate (statistically test that the runtime distribution doesn't differ between fixed and random secrets, on the real target CPU, on a pinned/isolated core to control noise), and reserve **formal binary-level verification** (ct-verif, Binsec/Rel) for the crown-jewel primitives. Critically, verify the **generated binary**, not the source, because the compiler can reintroduce branches; use barriers or assembly where needed, and where the CPU offers it, enable **DIT/DOIT** data-independent-timing modes. The build must fail on any detected leak.

## Question 26

**A browser team asks how to defend against a malicious page using Spectre to read other tabs' data. What's the layered answer?**

No single fix suffices; layer the defenses. First and foremost, **Site Isolation**: put each site in its own OS process so a Spectre leak in a renderer can only reach that one site's data, not other origins' — this attacks the *precondition* (shared address space) rather than each gadget. Second, **degrade the read phase**: reduce timer resolution (`performance.now()` coarsening) and restrict or gate `SharedArrayBuffer` (which provides the high-resolution timing that cache attacks need to distinguish hits from misses); without a precise clock, decoding the cache state becomes impractical. Third, **harden the gadgets**: apply v1 mitigations (index masking) in the JIT and bytecode interpreter, enable **SSBD** for renderer processes to close v4 in the JIT, and build with v2 mitigations. Fourth, sandbox untrusted WASM with the same index-masking discipline. The framing to convey: Spectre needs the attacker to *share an address space with the secret and have a precise clock* — site isolation removes the shared address space, timer hardening removes the clock, and gadget hardening removes the remaining in-process leaks.

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| Side channel | Leak via timing/cache/power, not via a logic bug; program runs correctly. |
| Early-exit leak | `==`/`memcmp` short-circuit → timing reveals leading-byte matches → byte-by-byte recovery. |
| Constant-time fix | Scan all bytes, no branch on data; use the library (`compare_digest`, `subtle`, `isEqual`, `sodium_memcmp`). |
| Arch vs. microarch | Squash rolls back registers/memory, **not** the cache — that gap is the channel. |
| Encode→read | Transient secret-dependent cache footprint, then Flush+Reload / Prime+Probe decodes it. |
| Spectre v1 | Train predictor → speculate past bounds check → transient OOB read → leak. Fix: `lfence`/index mask. |
| Spectre v2 | BTB injection → victim speculates to attacker gadget. Fix: retpoline + eIBRS/STIBP/IBPB. |
| Spectre v4 | Speculative store bypass → load reads stale guard. Fix: SSBD (selective). |
| Meltdown | Deferred fault → transient kernel read. Fix: KPTI (structural). |
| MDS/RIDL | Sample in-flight buffer data across SMT. Fix: VERW flush + disable SMT. |
| L1TF/Foreshadow | Read L1 via not-present PTE; breaks SGX/VM. Fix: L1D flush + PTE inversion + core sched. |
| Retbleed/PACMAN | Each broke a prior mitigation's assumption (retpoline; PAC). |
| 3 CT sins | Secret-dependent branch / address / variable-latency op. |
| Verify CT | ctgrind (find) → dudect (CI gate) → ct-verif (prove); trust the binary, not the source. |
| Policy | Mitigate by threat boundary + asset value; over-mitigation is costly; document residual risk. |

---

## Further Reading

- The Spectre (Kocher et al.) and Meltdown (Lipp et al.) papers, 2018.
- Foreshadow/L1TF, and the RIDL / Fallout / ZombieLoad (MDS) papers; Retbleed and PACMAN.
- "Remote Timing Attacks Are Practical" (Brumley & Boneh); the AES cache-attack literature (Osvik, Shamir, Tromer).
- "Dude, is my code constant time?" (dudect); Adam Langley on ctgrind and constant-time pitfalls; ct-verif / Binsec/Rel.
- Vendor mitigation docs (IBRS/eIBRS/STIBP/IBPB/SSBD/MD_CLEAR; KPTI/PCID); Chromium Site Isolation design docs.
