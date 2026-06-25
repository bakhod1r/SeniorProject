# Side Channels & Spectre — Professional Level

> **Topic:** [Side Channels & Spectre](README.md)
> **Focus:** Engineering and operating defenses at scale — the performance economics of each mitigation, threat-model-driven mitigation policy, constant-time programming discipline, and verifying it with dudect / ctgrind / formal tooling.

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

> Focus: **Given a fleet, a threat model, and a budget, which mitigations do you actually turn on — and how do you prove your own crypto and auth code is constant-time?**

By the senior level you can classify any transient-execution variant and name its mitigation. The professional problem is harder and more concrete: **mitigations are not free, threat models are not uniform, and "turn everything on" is the wrong default** — it can cost double-digit percentages of fleet capacity, which at scale is millions of dollars and a real carbon and latency budget. The professional engineer treats mitigation as a *risk-and-cost optimization* keyed to *where the trust boundary actually is*, and owns two things the platform cannot do for them: (1) the **mitigation policy** (what to enable, on which hosts, for which workloads), and (2) the **constant-time discipline** in the security-critical code their team writes — the one channel that is fully theirs and that no microcode update will fix for them.

This page covers the economics (KPTI's syscall tax, retpoline's indirect-branch penalty, SSBD per-process cost, the brutal arithmetic of disabling SMT), how to set mitigation policy from a threat model instead of from fear, and then the craft of **constant-time programming**: the rules (no secret-dependent branches, indices, divisions, or variable-latency instructions), the techniques (branchless selection, bitmasking, blinding, hardware crypto), and — critically — how to *verify* you got it right with **dudect** (statistical timing leakage testing), **ctgrind** (Valgrind-based taint of secret bytes), and tools like ct-verif / Binsec/Rel for stronger guarantees. The thesis: **you cannot eyeball constant-timeness — the compiler will betray you — so you must measure and verify, in CI, on the real target.**

> 🎓 **Why this matters for a professional:** This is where security meets the P&L and the SLO. The decisions here — disable SMT on the secrets tier but not the batch tier; enable SSBD only for the JIT processes; gate the crypto library on a dudect run in CI — are exactly the judgment calls that distinguish an engineer who *understands* side channels from one who only *knows about* them.

---

## Prerequisites

- **Required:** `senior.md` — the full transient-execution taxonomy and the structure→mitigation→layer map.
- **Required:** Comfort reading generated assembly and reasoning about per-instruction latency/throughput.
- **Required:** Operational fluency: syscall-rate profiling, SMT/topology, kernel/microcode/compiler-flag management across a fleet.
- **Helpful:** Statistics basics (hypothesis testing, percentiles) for interpreting dudect output.
- **Helpful:** Experience with a crypto library's internals (BoringSSL, libsodium, or similar).

You do **not** need to be a CPU designer — but you must be able to reason about *cost per boundary crossing* and *leakage measured statistically*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Mitigation policy** | The per-workload, per-host decision of which CPU-vuln mitigations to enable, derived from the threat model. |
| **Threat model** | Explicit statement of who the attacker is, what they can run, and what boundary protects the secret. Drives mitigation choice. |
| **Syscall tax (KPTI)** | The extra page-table switch / TLB cost added to every user↔kernel transition by KPTI; worst for syscall-heavy workloads. |
| **PCID / INVPCID** | Process-context identifiers that let KPTI avoid full TLB flushes, dramatically reducing its cost on supporting CPUs. |
| **Constant-time (CT) code** | Code whose timing and memory-access pattern are independent of secret values. |
| **Secret-dependent branch/index/division** | The three classic CT violations: control flow, memory addresses, or variable-latency arithmetic that depends on a secret. |
| **Branchless selection** | Choosing between two values with arithmetic/bitwise ops (a mask) instead of an `if`, to avoid a secret-dependent branch. |
| **Blinding** | Randomizing a computation (e.g., multiplying by a random factor) so its side-channel signature is decorrelated from the secret. |
| **dudect** | A practical tool that statistically tests whether a function's runtime distribution differs between two input classes (fixed vs. random secret) — a leak indicator. |
| **ctgrind** | A Valgrind (Memcheck) modification that marks secret bytes as "uninitialized" so any branch/index on them is flagged — taint-based CT checking. |
| **ct-verif / Binsec/Rel** | Tools giving stronger (formal/relational) guarantees that a binary is constant-time. |
| **Doit / DIT** | Data-Independent Timing CPU modes (Intel DOITM / ARM DIT) that promise certain instructions run in secret-independent time. |
| **Selective mitigation** | Enabling a costly mitigation only on the subset of processes/hosts whose threat model needs it. |

---

## Core Concepts

### 1. Mitigations cost real money; quantify before you enable

Every mitigation buys safety with performance. At fleet scale, the cost is the headline. You must reason about the *shape* of each cost, because it interacts with your workload:

- **KPTI (Meltdown):** adds work to every user↔kernel transition. A compute-bound service that rarely syscalls barely notices; a syscall-storm service (small-packet networking, high-IOPS storage, databases doing tiny reads) can lose a meaningful fraction of throughput. **PCID/INVPCID** support cuts this sharply by avoiding TLB flushes. Lever: measure your *syscall rate*; the tax is proportional to it.
- **Retpoline (Spectre v2):** taxes every *indirect* branch (virtual calls, function pointers, interpreter dispatch). Pointer-chasing, polymorphic, or interpreter-heavy code pays most; straight-line numeric code barely. eIBRS in hardware is much cheaper and often supersedes retpoline on modern parts.
- **SSBD (Spectre v4):** a per-process throughput cost; enable it for processes that *run untrusted code* (browsers, JITs, serverless), not for trusted batch jobs.
- **MDS buffer flush (VERW):** a cost per security-boundary crossing; combined with the big one —
- **Disabling SMT:** the heaviest hammer. SMT typically adds substantial throughput; turning it off to fully close MDS/L1TF cross-thread leakage can cost a large slice of fleet capacity. This is the decision with the biggest dollar sign attached, and it must be made by *threat boundary*, not blanket policy.

The professional move is to **measure each mitigation's cost on *your* workload** (microbenchmarks plus production canaries) rather than trusting generic numbers, because the spread between "negligible" and "severe" is entirely workload-shaped.

### 2. Mitigation policy follows the threat model, not the news cycle

The single most important professional skill here is *not over-mitigating*. Ask, per workload:

1. **Does an attacker run code on this hardware?** If no untrusted code shares the machine, most cross-domain attacks (MDS, L1TF, cross-tenant v2) are not in your threat model. A single-tenant, trusted-code-only host running behind a firewall does **not** need SMT disabled for MDS.
2. **What boundary protects the secret?** User/kernel → KPTI matters. Process/VM with untrusted neighbors → SMT, core scheduling, SSBD, buffer flush matter. Same-process untrusted code (a browser tab, a WASM module) → site/process isolation plus v1/v4 hardening matter.
3. **What is the asset?** A host that holds long-lived signing keys or other tenants' data warrants maximal mitigation even at high cost; a stateless cache node may not.

This produces a **tiered policy**: e.g., "secrets tier: SMT off, full mitigations; multi-tenant compute tier: SMT off, core scheduling, SSBD; trusted internal batch tier: defaults only, SMT on." Document the reasoning so the next audit can re-evaluate as hardware and attacks evolve.

### 3. Constant-time programming: the rules

The transient zoo is fought below your code, but the *classic* timing/cache channel is yours, and it shows up wherever you write or maintain crypto, auth, or any secret-handling primitive. The rules of constant-time code:

- **No secret-dependent branches.** `if (secret) {...}` leaks via timing and via the branch predictor. Replace with branchless selection.
- **No secret-dependent memory addresses.** `table[secret]` leaks via the cache (the original AES-table attack). Either avoid the table, scan it fully, or use hardware crypto.
- **No secret-dependent variable-latency instructions.** Integer division/modulo, some multiplies, and certain floating-point ops take *data-dependent* cycles on some CPUs. Avoid them on secret operands or use known-constant-time alternatives.
- **No secret-dependent loop bounds.** The iteration count must not reveal the secret (the early-exit comparison, generalized).
- **Beware compiler "help."** The compiler can turn your branchless code back into a branch, vectorize away your padding, or constant-fold your blinding. CT code must be checked *at the assembly/binary level*, and sometimes written with compiler barriers or in assembly.

### 4. Constant-time techniques

- **Branchless selection (masking):** compute both results, then select with an all-ones/all-zeros mask derived from the (non-secret-leaking) condition:
  `result = (mask & a) | (~mask & b);`
- **Conditional swap/move:** the building block of constant-time sorting and constant-time elliptic-curve scalar multiplication (`cswap`).
- **Full-table scan or hardware crypto:** instead of `table[secret]`, read *every* entry and select the right one with a mask — or use AES-NI / CLMUL / SHA extensions that have no secret-dependent memory access.
- **Blinding:** randomize the operand (e.g., RSA blinding multiplies the ciphertext by `r^e` before decryption and divides out `r` after), so each run's side-channel signature is decorrelated from the key. The standard defense for variable-latency big-integer math.
- **DIT/DOIT modes:** on supporting CPUs, enable Data-Independent Timing so a documented set of instructions runs in secret-independent time, removing a class of microarchitectural timing variation.

### 5. You cannot eyeball it — verify

The defining professional practice: **prove** constant-timeness, don't assert it. Three tiers of tooling:

- **dudect (statistical, black-box):** run the function many times with two input classes — a *fixed* secret and *random* secrets — and statistically test whether the two timing distributions differ (Welch's t-test on the measured cycles). A significant difference is evidence of a leak. dudect is easy to wire into CI, requires no source annotations, and tests on the *real* CPU, but it can only *detect* leaks, not prove their absence, and it needs a quiet machine and enough samples.
- **ctgrind / MemSan-style taint (dynamic, white-box):** mark the secret bytes as "uninitialized" (poisoned) under Valgrind's Memcheck; any branch on, or memory access indexed by, a poisoned value is reported. This pinpoints *where* the leak is in the source, on real execution paths, but only on paths you exercise.
- **ct-verif / Binsec/Rel (formal/relational):** prove, over all inputs, that two executions differing only in the secret are indistinguishable in the leakage model (branches + addresses). Strongest guarantee, highest effort; used for the most critical primitives.

The pragmatic recipe most teams adopt: **ctgrind to find leaks during development, dudect in CI as a regression gate on the real target, and formal verification reserved for the crown-jewel primitives.**

### 6. Defense in depth and the residual-risk reality

No combination of mitigations is complete forever — new variants keep arriving, and hardware fixes lag the fleet. The professional posture is **layered and explicit about residual risk**:

- **Platform layer:** current microcode, kernel, hypervisor, compiler mitigations; SMT/core-scheduling policy per tier.
- **Isolation layer:** keep untrusted code off shared cores/processes with secrets; site isolation; per-tenant cores for the highest tiers.
- **Code layer:** constant-time crypto/auth, verified in CI; no Spectre-v1 gadgets in index-handling code.
- **Detection/governance layer:** track new CVEs, re-run the threat-model mapping, and re-evaluate the SMT decision as hardware refreshes change the cost/benefit.

State the residual risk plainly: e.g., "on this tier we accept cross-tenant L1 leakage risk in exchange for SMT throughput, mitigated by single-tenant scheduling." Security at scale is documented trade-offs, not absolutes.

---

## Real-World Analogies

**Mitigation policy as insurance underwriting.** You don't buy flood insurance for a house on a hill. KPTI, SSBD, SMT-off are premiums; you pay them where the risk (untrusted neighbors, exposed boundary, valuable asset) justifies the cost, and you document why you skipped them elsewhere.

**Constant-time code as a poker face.** A skilled player never lets their *timing* — the pause before a bet, the speed of a fold — reveal their hand. Constant-time code is the engineering version: the function must "play every hand at the same tempo" so the observer learns nothing from the rhythm.

**dudect as a polygraph.** You don't trust the function's claim that it's constant-time; you wire it up, feed it two kinds of secrets, and watch whether its "pulse" (cycle count) changes. A statistically significant tell is a confession.

**SMT-off as closing the shared break room.** SMT siblings share the core's "break room" (buffers, caches) at the same time, where they can overhear each other (MDS, L1TF). Disabling SMT gives each tenant their own room — safer, but you've halved the building's occupancy.

---

## Mental Models

**Model 1: Mitigation = premium; threat model = the actuarial table.** Compute expected cost (performance × fleet × time) against expected risk (exposure × asset value). Enable where risk-adjusted benefit beats cost; document the rest.

**Model 2: Three CT sins.** Every constant-time bug is a secret-dependent **branch**, **address**, or **variable-latency op**. Auditing CT code is hunting those three.

**Model 3: The compiler is an adversary to CT code.** Anything you write to be constant-time, the optimizer may "improve" back into a leak. Trust only the verified binary, not the source.

**Model 4: Detect ≠ prove.** dudect/ctgrind *find* leaks; only formal tools *prove* their absence. Calibrate confidence to the tool and to the asset's value.

**Model 5: Residual risk is a deliverable.** At scale you never reach zero. The professional artifact is a written, re-visitable statement of what you mitigated, what you accepted, and why.

---

## Code Examples

### Branchless constant-time select (the workhorse)

```c
/* Returns a if cond (0 or 1), else b — without a secret-dependent branch.
 * Build mask = all-ones if cond==1, all-zeros if cond==0. */
uint32_t ct_select(uint32_t cond, uint32_t a, uint32_t b) {
    uint32_t mask = (uint32_t)0 - (cond & 1);   /* 0xFFFFFFFF or 0x00000000 */
    return (mask & a) | (~mask & b);
}

/* Constant-time conditional swap — used in scalar multiplication, sorting. */
void ct_cswap(uint32_t cond, uint32_t *x, uint32_t *y) {
    uint32_t mask = (uint32_t)0 - (cond & 1);
    uint32_t t = mask & (*x ^ *y);
    *x ^= t;
    *y ^= t;
}
```

### Avoiding a secret-indexed table (cache-attack surface)

```c
/* Instead of t[secret] (leaks via cache), scan the WHOLE table and select. */
uint8_t ct_table_lookup(const uint8_t *t, size_t n, uint8_t secret_idx) {
    uint8_t out = 0;
    for (size_t i = 0; i < n; i++) {
        uint8_t mask = (uint8_t)(0 - (i == secret_idx)); /* careful: '==' must be CT */
        out |= mask & t[i];                              /* touches every line */
    }
    return out;
}
/* In production: prefer AES-NI / vetted bitsliced impls over hand-rolled scans. */
```

### Wiring dudect-style leakage testing into CI (sketch)

```c
/* Conceptual: measure cycle counts for two input classes and t-test them.
 * A significant |t| (e.g., > ~4.5) across enough samples flags a leak.
 * Real frameworks (dudect.h) handle warmup, outlier rejection, and the stats. */
for (size_t i = 0; i < N; i++) {
    bool class_fixed = (i & 1);
    prepare_input(class_fixed ? FIXED_SECRET : random_secret());
    uint64_t t0 = rdtsc_serialized();
    function_under_test();              /* the CT candidate */
    uint64_t dt = rdtsc_serialized() - t0;
    record(class_fixed, dt);            /* feed into Welch's t-test */
}
report_t_statistic();                   /* gate the build on it */
```

### Mitigation policy as code (illustrative)

```yaml
# Per-tier mitigation policy derived from threat model (illustrative).
secrets_tier:        # holds signing keys / other tenants' PII
  smt: off
  kpti: on
  ssbd: force
  l1d_flush: on
  scheduling: single_tenant_cores
multitenant_compute:
  smt: off
  ssbd: on           # untrusted guest code
  scheduling: core_scheduling
trusted_batch:
  smt: on            # no untrusted code co-located; defaults suffice
  mitigations: auto
```

---

## Pros & Cons

| Decision | Upside | Downside |
|----------|--------|----------|
| **Selective mitigation by tier** | Spends performance only where risk justifies it; large fleet savings. | Requires accurate threat modeling and per-tier ops; misclassification = exposure. |
| **Disabling SMT (secrets tier)** | Closes the strongest cross-thread leaks (MDS/L1TF). | Large capacity loss; expensive at scale. |
| **PCID-aware KPTI** | Keeps Meltdown protection while slashing the syscall tax. | Needs CPU support; still nonzero for syscall-storm workloads. |
| **Branchless CT code** | Removes the timing/cache leak; portable. | Harder to write/read; compiler can undo it; must be verified. |
| **Hardware crypto (AES-NI etc.)** | Constant-time and fast; no secret-indexed tables. | Not available everywhere; must fall back carefully. |
| **dudect in CI** | Cheap, real-target regression gate. | Detects, can't prove absence; needs a quiet, stable runner. |
| **Formal CT verification** | Strongest guarantee. | High effort; reserved for critical primitives. |

---

## Use Cases

- **Cloud/hosting platforms:** set per-tier SMT/scheduling/mitigation policy; decide co-location rules for untrusted guests vs. secret-bearing hosts.
- **Crypto/auth library maintainers:** write and *verify* constant-time primitives; gate releases on dudect/ctgrind; reserve formal verification for the core.
- **Browser / serverless / WASM runtime teams:** combine site/process isolation, SSBD, timer hardening, and v1 gadget hardening; balance against latency.
- **Confidential computing / HSM / enclave teams:** L1TF/MDS mitigations, SMT policy, and CT code are existential; residual-risk statements are part of the security argument.
- **Performance/SRE teams:** quantify mitigation cost on real workloads and feed it back into capacity planning and the mitigation policy.

---

## Coding Patterns

**Pattern: tiered, documented mitigation policy.** Encode mitigations per workload tier, justified by an explicit threat model, and re-evaluate on hardware refresh and new CVEs.

**Pattern: CT primitive + verification gate.** Every secret-handling primitive ships with a dudect/ctgrind check in CI; the build fails on a detected leak.

**Pattern: prefer hardware crypto; mask when you can't.** Use AES-NI/CLMUL/SHA-ext where available; fall back to verified bitsliced/branchless implementations, never to secret-indexed tables.

**Pattern: verify the binary, not the source.** Inspect generated assembly (or run binary-level CT tools) for critical code, because the compiler may reintroduce leaks.

**Pattern: write down residual risk.** Each accepted trade-off (e.g., SMT on for a tier) is documented with its rationale and revisit trigger.

---

## Best Practices

1. **Mitigate by threat boundary and asset value, not by headline.** Over-mitigation is a real, expensive failure mode.
2. **Measure mitigation cost on your own workloads** before fleet-wide rollout; the spread is enormous and workload-shaped.
3. **Keep KPTI but exploit PCID;** profile syscall rate to predict the tax.
4. **Make constant-time a verified property, not an aspiration** — dudect in CI, ctgrind in development, formal proof for crown jewels.
5. **Don't trust the source; trust the verified binary.** Compilers undo CT; check the assembly.
6. **Use hardware crypto and vetted libraries;** never hand-roll secret-indexed lookups or comparisons.
7. **Maintain an explicit, re-visitable residual-risk register** for accepted trade-offs.
8. **Re-run the threat-model mapping on every new variant** and on hardware refresh, since cost/benefit shifts.

---

## Edge Cases & Pitfalls

- **Blanket "enable everything" at scale.** It can quietly cost double-digit percentages of capacity for risk you don't actually carry. Always justify by threat model.
- **Disabling SMT where no untrusted code runs.** Pure cost, no benefit, on a single-tenant trusted host.
- **Trusting source-level constant-time.** The optimizer reintroduces branches, vectorizes away padding, constant-folds blinding. Verify the binary.
- **dudect on a noisy CI runner.** Frequency scaling, neighbors, and interrupts inflate variance and hide leaks (false negatives) or fabricate them (false positives). Pin frequency, isolate the core, use enough samples.
- **`==` inside a "constant-time" function.** A naive equality comparison in your masking helper can itself be a non-CT branch. Build comparisons from CT primitives.
- **Variable-latency arithmetic slipping in.** A `secret % n` or a data-dependent multiply can leak even in otherwise branchless code; know your target's latency tables or enable DIT/DOIT.
- **Forgetting the read phase mitigations.** Timer hardening and shared-memory restrictions degrade *every* cache-attack read phase; don't quietly re-enable high-resolution timers in a sandbox for a perf win.
- **Stale residual-risk register.** Accepted trade-offs that are never revisited become silent vulnerabilities after a hardware refresh or a new attack changes the math.
- **Assuming hardware fixes covered you.** Fleets are heterogeneous; the oldest in-service CPU defines exposure, not the newest.

---

## Test Yourself

1. For a syscall-heavy database tier, how do you predict KPTI's cost, and what hardware feature reduces it?
2. Construct a tiered mitigation policy for: (a) a host holding signing keys, (b) a multi-tenant VM host running untrusted guests, (c) a trusted internal batch cluster. Justify each.
3. List the three "constant-time sins" and give a branchless fix for a secret-dependent branch.
4. Why must constant-time code be verified at the binary level rather than the source level?
5. Contrast dudect, ctgrind, and ct-verif on what they guarantee and their cost.
6. When is disabling SMT *not* worth it, and when is it essential?
7. Explain RSA blinding and which side channel it defeats.
8. Write a one-paragraph residual-risk statement for keeping SMT on in a tier, and the trigger that would force you to revisit it.

---

## Cheat Sheet

| Item | Professional takeaway |
|------|------------------------|
| KPTI cost | ∝ syscall rate; cut hard by PCID/INVPCID. |
| Retpoline cost | ∝ indirect-branch density; eIBRS cheaper on modern CPUs. |
| SSBD | Enable for untrusted-code processes (browsers/JITs), not trusted batch. |
| SMT off | Strongest MDS/L1TF cut; biggest capacity cost; decide by trust boundary. |
| CT sins | Secret-dependent branch / address / variable-latency op. |
| CT techniques | Masking, cswap, full-table scan, blinding, hardware crypto, DIT/DOIT. |
| Verify | ctgrind (find), dudect (CI gate), ct-verif (prove crown jewels). |
| Golden rule | Trust the verified binary, not the source; the compiler is adversarial to CT. |
| Policy | Mitigate by threat boundary + asset value; document residual risk; revisit. |

---

## Summary

At scale, side-channel defense is an optimization problem, not a checklist. **Mitigations cost real performance** — KPTI taxes syscalls (cut by PCID), retpoline taxes indirect branches (cut by eIBRS), SSBD costs per-process, and disabling SMT to fully close MDS/L1TF can cost a large slice of fleet capacity. The professional discipline is to **set mitigation policy from an explicit threat model** — who runs code on this hardware, what boundary protects the secret, how valuable the asset is — producing a *tiered* policy that spends performance only where risk justifies it, with every skipped or accepted trade-off written into a re-visitable residual-risk register. Over-mitigation is a genuine, expensive failure mode.

The one channel that is fully yours is **constant-time programming**: no secret-dependent branches, addresses, or variable-latency operations. The techniques are branchless selection (masking), conditional swap, full-table scans or hardware crypto instead of secret-indexed tables, and blinding for variable-latency big-integer math. But you **cannot eyeball constant-timeness — the compiler will undo it** — so you must verify at the binary level: **ctgrind** (taint-based, finds leaks during development), **dudect** (statistical timing test, a CI regression gate on the real CPU), and **ct-verif / Binsec/Rel** (formal proof for the crown-jewel primitives). The mature posture is defense in depth — current microcode/kernel/compiler, isolation of untrusted code, verified constant-time code, and active CVE governance — combined with an honest, documented statement of residual risk that you revisit as hardware and attacks evolve. Security at this level is the quality of your trade-offs and the rigor of your verification, not the absence of risk.

---

## Further Reading

- "Dude, is my code constant time?" (Reparaz, Balasch, Verbauwhede) — the dudect methodology.
- Adam Langley's writing on ctgrind and constant-time pitfalls; the BearSSL constant-time documentation.
- ct-verif and Binsec/Rel papers on verified constant-time at the binary level.
- Intel DOITM / ARM DIT documentation on data-independent timing modes.
- Kernel and hypervisor mitigation tuning guides (KPTI/PCID, SSBD, MDS, L1TF, core scheduling) for fleet operators.
- The crypto-engineering literature on blinding and constant-time elliptic-curve and big-integer implementations.
