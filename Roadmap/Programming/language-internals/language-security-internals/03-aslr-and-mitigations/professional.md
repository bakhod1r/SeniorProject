# ASLR & Mitigations — Professional Level

> **Topic:** [ASLR & Mitigations](README.md)
> **Focus:** Operating a hardening program at scale — entropy economics across platforms, the full mitigation matrix (Linux/glibc, Windows, macOS/iOS, Android), measurement and enforcement, residual-risk modeling, and the trade-offs that decide what you actually ship.

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **How do you run ASLR-and-mitigations as a *program* — across platforms, at fleet scale, with measurable enforcement and explicit residual-risk accounting — rather than as a per-binary checkbox?**

At the professional level the questions change. It's no longer "is PIE on?" but "across our entire artifact inventory — first-party binaries, vendored libraries, container base images, kernel, firmware — what is our weakest link, how do we *prove* the mitigation set on every build, and what is the residual exploitability when (not if) someone finds an info leak?" The mitigations themselves are the same primitives from earlier levels; what's new is the *operational discipline*: entropy economics (how many bits actually buy how much safety, and where the cheap wins are), the divergent platform stories (each OS implements ASLR, DEP, and control-flow enforcement differently, with different defaults and opt-ins), and the governance that keeps a one-non-PIE-module regression from silently un-hardening a whole product.

You also own the **trade-off conversations**. Full RELRO costs startup latency; CET/shadow-stack and KPTI cost cycles; re-randomization costs complexity and pointer-fixup work; high-entropy ASLR can interact with huge address-space reservations. A professional quantifies these, sets policy with explicit exceptions, and can defend the policy to both security and performance stakeholders. And you model **residual risk** honestly: mitigations are probabilistic-or-deterministic cost increases, not guarantees, and the durable answer — memory safety — is a multi-year program, not a flag.

This page is defensive and operational. We discuss attack classes only as risk inputs; there are no exploits.

---

## Prerequisites

- **Required:** The senior-level model: secrecy vs. enforcement layers; the bypass classes (info-leak, BROP/brute force, partial overwrite, JIT spray, side channel); shadow stacks/CET/PAC/CFI; KASLR/KPTI/FGKASLR.
- **Required:** Build-system and CI fluency — you'll enforce flags and gate on attestations across many artifacts.
- **Required:** Cross-platform deployment experience (at least two of Linux, Windows, macOS/iOS, Android).
- **Helpful:** Familiarity with supply-chain concerns (vendored binaries, base images) and fleet-scale telemetry.
- **Helpful:** Threat-modeling and risk-quantification background.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Mitigation matrix** | The table of (mitigation × platform × artifact) used to track coverage and gaps across a product. |
| **Entropy budget** | The bits of randomization a region actually provides on a given platform/architecture, and the cost of increasing it. |
| **High-entropy ASLR (HEASLR)** | Windows `/HIGHENTROPYVA`: 64-bit images get a much larger randomization range for the bottom-up allocation region. |
| **Mandatory ASLR** | Windows Exploit-Protection / `ForceRelocateImages`: relocate even images that didn't opt into ASLR (with an entropy caveat without `BottomUpASLR`). |
| **DYLD / dyld shared cache** | macOS/iOS loader and the prelinked system-library cache, randomized per-boot (slide). |
| **Zygote** | Android's pre-forked app-template process; apps fork from it, sharing its (per-boot) layout — an ASLR consideration. |
| **CET / shstk / IBT** | Intel Control-flow Enforcement: shadow stack + indirect-branch tracking. |
| **PAC / BTI** | ARM Pointer Authentication / Branch Target Identification. |
| **KPTI / KAISER** | Kernel Page-Table Isolation — Meltdown mitigation that also re-strengthens KASLR. |
| **FGKASLR** | Function-granular KASLR — randomizes kernel function order, not just base. |
| **Attestation / provenance** | Build metadata proving which mitigation flags an artifact was built with (SLSA-style). |
| **Residual risk** | Exploitability remaining after mitigations, given a realistic bug (e.g., an info leak). |
| **Hardening regression** | A build/config change that silently drops a mitigation (e.g., reverts to Partial RELRO or non-PIE). |

---

## Core Concepts

### 1. Entropy economics: bits per dollar

Treat randomization bits like a budget with non-linear returns.

- **The cheap, decisive win is 64-bit + PIE.** Moving from 32-bit (~16 mmap bits, brute-forceable) to 64-bit (~28+ bits) is the single largest improvement, at near-zero runtime cost. Everything else is marginal by comparison.
- **Marginal bits have diminishing security value against the dominant threat.** The dominant real-world bypass is the **info leak**, which is *entropy-independent* — it doesn't matter whether you had 28 or 40 bits if one pointer is disclosed. So past a brute-force-resistant threshold, spending engineering effort on *more entropy* is usually worse value than spending it on **leak resistance** (enforcement layer, OOB-read elimination, re-randomization).
- **Where extra entropy *does* pay:** against the **brute-force/BROP** class on forking servers and against **side-channel** narrowing — but even there, *layout non-reuse* (re-exec) and side-channel mitigations (KPTI) dominate raw bit count.

The professional framing: **bits stop brute force; they do nothing against leaks. Budget accordingly — buy the cheap bits (64-bit PIE), then invest in leak resistance, not in shaving more entropy.**

### 2. The cross-platform mitigation matrix

Each platform implements the same *concepts* with different defaults, opt-ins, and gaps. You must track them per platform.

**Linux / glibc:**
- ASLR via kernel `randomize_va_space` (default 2); stack/mmap/brk + PIE load bias.
- PIE/PIC via `-fPIE -pie`; many distros default to PIE for system binaries.
- NX via `-z noexecstack`; RELRO via `-z relro -z now` (Full); canaries via `-fstack-protector-strong`; FORTIFY via `-D_FORTIFY_SOURCE=2/3`.
- CET via `-fcf-protection=full` + `-z shstk` (kernel + hardware support required).
- Kernel: KASLR (default on), KPTI, optional FGKASLR.

**Windows:**
- ASLR per-image via `/DYNAMICBASE` (default on for modern toolchains); **HEASLR** via `/HIGHENTROPYVA` for 64-bit; **Mandatory ASLR / Bottom-up ASLR** via Exploit Protection (system or per-app), the successor to **EMET**.
- DEP via `/NXCOMPAT`.
- Stack cookies via `/GS`; SafeSEH / SEHOP for exception-handler integrity; **CFG (Control Flow Guard)** via `/guard:cf` (forward-edge CFI), **XFG** (extended), and hardware **CET shadow stack** support.
- Caveat: **Mandatory ASLR without Bottom-up ASLR can relocate to a low-entropy fixed slot** — a known footgun; enable both together.

**macOS / iOS:**
- ASLR on by default; all system binaries position-independent; the **dyld shared cache** gets a per-boot **slide**.
- DEP/W^X enforced; **`MAP_JIT`** + `pthread_jit_write_protect_np` is the sanctioned JIT W^X path (especially on Apple Silicon, which enforces W^X strictly).
- **Pointer Authentication (PAC)** on Apple Silicon is pervasive (return addresses, function pointers) — a deterministic enforcement layer that holds even when ASLR is leaked. **BTI** likewise.
- iOS adds platform constraints (code signing, restricted JIT entitlements) that shrink the JIT-spray surface.

**Android:**
- Linux kernel underneath: KASLR, ASLR for native code; PIE has been *required* for executables for years.
- **Zygote**: apps fork from a pre-initialized template process, so they **share the zygote's per-boot layout** — a deliberate startup optimization with an ASLR consequence (analogous to fork-without-exec). Mitigated by per-boot re-randomization of the zygote and the app-process model, but worth knowing.
- ARM PAC/BTI/MTE on modern devices; **MTE (Memory Tagging Extension)** is the strategic memory-safety hardware play, tagging allocations to catch OOB/UAF probabilistically.
- SELinux, seccomp, and scudo/hardened allocator round out the native-hardening story.

### 3. Measurement and enforcement at fleet scale

Policy you can't measure is aspiration. Build the pipeline:

- **Per-build attestation:** capture the exact compiler/linker flags into provenance metadata; reject artifacts missing the required set.
- **Binary-level verification:** `checksec`/`readelf` (Linux), `dumpbin /headers` and `/dependents` or BinSkim (Windows), `otool`/`codesign` (macOS) — run on *every* artifact, including **vendored and transitive** binaries, not just first-party.
- **Fleet telemetry:** sample running processes for `/proc/pid/maps` randomization, RELRO status, KPTI state, KASLR-on, CET enablement — to catch *runtime* regressions (a misconfigured host, a disabled sysctl).
- **Gate on the weakest link:** a product's hardening posture is the *minimum* across all loaded objects. CI must fail if any module (including a vendored DLL/.so) drops below policy.

### 4. Residual-risk modeling

Mitigations don't make exploitation impossible; they change its *cost and prerequisites*. Model it explicitly:

- **Given a memory-corruption bug, what does the attacker still need?** With NX+ASLR+Full RELRO+canary+CET, they typically need: an info leak (for ASLR), a corruption primitive that satisfies CET/CFI (much harder than plain ROP), and possibly a way around shadow stacks for returns. Enumerate which of your bugs supply which capabilities.
- **Score by bypass class, not by "mitigation on/off."** A forking server with all flags on but fork-without-exec is *brute-forceable* despite a perfect checksec report. A JIT process with all flags on still has the JIT surface. The matrix that matters is bug-class × mitigation, per component.
- **Track the leak surface as a first-class asset.** Out-of-bounds reads, uninitialized-memory disclosure, verbose diagnostics, side-channel exposure — these are your ASLR's real adversary. Reducing them often beats adding bits.

### 5. The trade-off conversations you own

- **Full RELRO vs. startup latency:** eager binding resolves all symbols up front. For short-lived, frequently-forked processes this can matter; for long-lived services it's noise. Default Full; exempt only with data.
- **CET / shadow stack / KPTI vs. cycles:** generally low (shadow stack is cheap; KPTI's cost is context-switch-bound and workload-dependent). Measure on *your* workload; these are usually worth it for anything attack-exposed.
- **Re-randomization vs. complexity:** powerful against leaks but requires consistent live-pointer fixup; mostly research-grade in general-purpose software. Know it exists; deploy where a productized form is available.
- **High-entropy ASLR vs. address-space reservations:** apps that reserve huge contiguous virtual ranges (some databases, GC runtimes) can interact with HEASLR placement; validate.
- **Mandatory ASLR pitfalls (Windows):** force-relocation without bottom-up randomization can *reduce* entropy. The trade-off is "compatibility with legacy non-ASLR DLLs" vs. "low-entropy fixed slot." Prefer enabling both, or fixing the DLL.

### 6. Governance: keeping hardening from regressing

The recurring failure mode is *silent regression*: a build flag dropped during a refactor, a vendored binary added without ASLR, a sysctl reverted on a host, a Mandatory-ASLR policy that quietly relocated to low entropy. Govern it:

- **Codify policy** as machine-checkable rules (required flags per platform/artifact class), with an explicit, reviewed exception register.
- **Block on regression** in CI and at deploy-time (admission control for container images checking their binaries).
- **Inventory and re-scan continuously** — supply-chain artifacts change; re-verify on every ingest.
- **Treat a hardening regression as a security incident**, not a build warning.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Entropy economics** | Buying locks: the first deadbolt (64-bit PIE) hugely improves safety cheaply; the tenth lock on the same door (more bits) barely helps if the burglar can just bribe the doorman (info leak). |
| **Mitigation matrix** | A building-safety audit grid: every door (artifact) × every required control (sprinkler, alarm, fire door) × every wing (platform). One missing fire door fails the wing. |
| **Weakest-link enforcement** | A convoy moves at the speed of its slowest ship; one non-PIE module sets the product's pace. |
| **Residual risk** | Insurance underwriting: not "is the alarm on?" but "given a break-in attempt, what's the expected loss after all controls?" |
| **Silent regression** | A fire door propped open during renovation that nobody closes — the audit passed last year, but the building is unsafe today. |
| **Mandatory-ASLR footgun (Windows)** | Forcing a guest into a "random" room that's actually always Room 1 — technically relocated, practically predictable. |

---

## Mental Models

### The "minimum over the inventory" model

A product's exploit-resistance is the *minimum* of its components' resistance, not the average and not the first-party subset. Your job is to find and raise that minimum — which is almost always a vendored binary, a base-image library, a JIT region, or a fork-shared layout, not your carefully-flagged main binary. Always ask: *what is the weakest loaded object, and who owns it?*

### The "bits for brute force, leak-resistance for everything else" model

Spend the entropy budget to cross the brute-force threshold (64-bit PIE), then stop optimizing bits and start optimizing **leak resistance** (enforcement layer, OOB-read elimination, re-randomization, side-channel mitigations). Most of your remaining risk is leak-driven, and leaks don't care about your bit count.

### The "policy is the artifact" model

The durable deliverable isn't a hardened binary; it's a *machine-checkable policy plus continuous enforcement* that keeps every binary hardened forever, including the ones engineers haven't written yet and the vendors you haven't onboarded yet. Manual `checksec` once is theater; gated, fleet-wide, re-scanned enforcement is the control.

---

## Code Examples

Operational and defensive only.

### Fleet-wide Linux hardening audit (fail on weakest link)

```bash
#!/usr/bin/env bash
# Fail if ANY ELF in the tree is missing PIE / Full RELRO / NX / canary.
set -euo pipefail
fail=0
while IFS= read -r -d '' f; do
  json=$(checksec --file="$f" --output=json 2>/dev/null) || continue
  echo "$json" | grep -q '"pie":"yes"'        || { echo "NO PIE: $f"; fail=1; }
  echo "$json" | grep -q '"relro":"full"'     || { echo "WEAK RELRO: $f"; fail=1; }
  echo "$json" | grep -q '"nx":"yes"'          || { echo "NO NX: $f"; fail=1; }
  echo "$json" | grep -q '"canary":"yes"'      || { echo "NO CANARY: $f"; fail=1; }
done < <(find ./dist -type f -name '*.so*' -o -type f -perm -u+x -print0)
exit $fail
```

### Verifying CET / shadow-stack property in shipped binaries

```bash
# GNU property note advertises SHSTK / IBT support.
readelf -n ./program | grep -iE 'SHSTK|IBT' \
  || echo "WARN: no CET properties — built without -fcf-protection?"
```

### Windows: confirm DYNAMICBASE / HIGHENTROPYVA / NXCOMPAT / CFG

```text
:: dumpbin reveals the image's opted-in mitigations.
dumpbin /headers app.exe | findstr /i "Dynamic NX High Entropy"
::   "Dynamic base"        -> /DYNAMICBASE (ASLR)
::   "NX compatible"       -> /NXCOMPAT (DEP)
::   "High Entropy Virtual Addresses" -> /HIGHENTROPYVA
:: dumpbin /loadconfig app.exe | findstr /i "Guard"   -> CFG (/guard:cf)
:: Microsoft BinSkim is the policy-grade scanner for CI.
```

### macOS: confirm PIE and signing/JIT entitlements

```bash
otool -hv ./app | grep -i PIE          # MH_PIE flag present => position-independent
codesign -d --entitlements :- ./app    # inspect allow-jit / restricted entitlements
```

### Detecting a hardening regression in CI (concept)

```bash
# Compare current artifact's mitigation set against a stored baseline.
# Any downgrade (e.g., full->partial RELRO, pie yes->no) fails the build.
diff <(scan_mitigations ./build/app) ./policy/app.baseline \
  || { echo "HARDENING REGRESSION DETECTED"; exit 1; }
```

### Linux runtime posture check (host fleet)

```bash
echo "randomize_va_space=$(cat /proc/sys/kernel/randomize_va_space)"   # want 2
echo "kpti: $(cat /sys/devices/system/cpu/vulnerabilities/meltdown)"
grep -qw nokaslr /proc/cmdline && echo "WARN: KASLR disabled" || echo "kaslr: on"
```

---

## Pros & Cons

| Decision | Pro | Con / cost |
|----------|-----|-----------|
| **64-bit + PIE everywhere** | Largest entropy win; near-zero cost; crosses brute-force threshold. | Small PIE indirection overhead; legacy 32-bit/`MAP_FIXED` code may need work. |
| **Full RELRO default** | Freezes GOT; closes a whole hijack class. | Startup latency for short-lived/forky processes; measure exceptions. |
| **CET/shadow stack + PAC/BTI** | Deterministic — holds when ASLR is leaked. | Hardware/OS dependency; cycles; coverage gaps (forward edge, signing gadgets). |
| **KPTI / KASLR / FGKASLR** | Restores kernel-base secrecy vs. Meltdown/side channels. | Context-switch cost; not free on syscall-heavy workloads. |
| **Mandatory ASLR (Windows)** | Relocates legacy non-ASLR DLLs. | Without bottom-up ASLR, can land at low-entropy fixed slot — net negative if misconfigured. |
| **Fleet enforcement + provenance** | Catches regressions; covers vendored/transitive artifacts. | Build/CI investment; exception governance overhead. |
| **More entropy beyond threshold** | Helps brute-force/side-channel narrowing. | Poor ROI vs. leak resistance; the dominant threat is leak, which ignores bits. |

---

## Use Cases

- **Establishing org-wide hardening policy** with per-platform required-flag sets, machine-checked in CI and at deploy time, with a governed exception register.
- **Supply-chain hardening:** scanning every vendored and transitive binary/library/base-image on ingest; rejecting non-PIE/Partial-RELRO/non-DYNAMICBASE artifacts or quarantining with compensating controls.
- **Platform-specific rollouts:** enabling CET on x86 fleets, PAC/BTI/MTE on ARM mobile, KPTI/FGKASLR on kernels, `/HIGHENTROPYVA` + Bottom-up on Windows — each with measured cost.
- **Residual-risk reporting** to leadership: not "we have ASLR" but "given a typical info leak, exploitation requires X additional capabilities, and our weakest components are Y and Z."
- **Incident analysis:** determining whether a given crash was reachable as an exploit by reconstructing the layout, RELRO/CET state, and whether a leak primitive existed.

---

## Coding Patterns

### Pattern 1: Policy-as-code, enforced at two gates

Encode required mitigations per platform/artifact-class as machine-checkable rules. Enforce at **build** (provenance attestation) *and* **deploy** (admission control re-scans the actual bytes). Two gates catch both build regressions and post-build tampering/substitution.

### Pattern 2: Cover the whole inventory, not the first-party subset

Scan vendored binaries, transitive `.so`/`.dll`, base-image libraries, and JIT/runtime components. The weakest link is almost never your main binary.

### Pattern 3: Budget bits once, then invest in leak resistance

Standardize 64-bit PIE; stop optimizing entropy past the brute-force threshold; redirect effort to enforcement-layer deployment, OOB-read elimination, and side-channel mitigations.

### Pattern 4: Re-exec, don't re-fork, for crash-respawn workers

Across all platforms with a fork/zygote/template model, ensure crashed workers re-randomize (re-exec / fresh process) rather than reusing a shared layout. Audit fork-without-exec, zygote-shared layout, and snapshot/restore paths.

### Pattern 5: Sanction the JIT path per platform

Use the platform's blessed W^X JIT mechanism (`MAP_JIT` + write-protect toggling on macOS/iOS; dual-mapping on Linux), apply constant blinding and randomized placement, and minimize JIT entitlements (iOS).

---

## Best Practices

- **64-bit + PIE as a non-negotiable baseline**, enforced in CI for every artifact.
- **Full RELRO, NX, canaries, FORTIFY** by default; per-platform control-flow enforcement (CET/CFG/PAC/BTI) where supported.
- **Enforce on the weakest link** across the *entire* loaded-object inventory, including vendored/transitive.
- **Measure both build-time flags and runtime posture** (sysctls, KPTI, KASLR, CET) across the fleet.
- **Budget entropy for the brute-force threshold, then invest in leak resistance** — it's where residual risk actually lives.
- **Re-randomize crash-respawned workers** (no fork-without-exec / shared zygote / snapshot reuse).
- **Govern regressions as incidents**; keep a reviewed exception register with expiry dates.
- **Drive toward memory safety** (safe languages, MTE on ARM, sanitizer-verified C/C++) as the strategic endgame; mitigations buy time.
- **On Windows, enable Bottom-up *with* Mandatory ASLR**; never force-relocate into a low-entropy slot.

---

## Edge Cases & Pitfalls

- **Mandatory ASLR without bottom-up randomization (Windows)** relocates legacy DLLs to a *predictable low-entropy* slot — worse than honest about the gap. Enable both, or fix the DLL.
- **Zygote-shared layout (Android)** means app processes inherit the zygote's per-boot randomization; a leak in one app context can have layout relevance until re-randomization. Know the model when threat-modeling mobile.
- **dyld shared cache slide (macOS/iOS)** randomizes the whole system-library cache as a unit per boot — strong, but a single leaked system-library pointer reveals the slide for *all* cached libraries (the "shared cache" amplifies the move-the-deck weakness).
- **`MAP_FIXED`, hugepages, and huge VA reservations** create predictable regions and can interact with HEASLR. Audit allocators, GC runtimes, and databases.
- **Container base images** can ship un-hardened libraries that your scanner misses if it only checks your layer. Scan the *flattened* image.
- **FORTIFY level mismatch:** `_FORTIFY_SOURCE=3` (newer) catches more than `=2` but needs toolchain support; verify which level actually applied (compiler may silently downgrade).
- **CET/PAC coverage gaps:** shadow stack protects returns not forward edges; PAC has signing-gadget and key-management caveats; coarse CFG/IBT still permits some reuse. Don't represent them as absolute.
- **Disabled ASLR in performance/debug images leaking to prod** (golden images built with `nokaslr` or `setarch -R`). Verify the *production* artifact's runtime posture.

---

## Common Mistakes

1. **Auditing only first-party binaries.** The weakest link is usually vendored/transitive or the base image.
2. **Optimizing entropy past the brute-force threshold** while leaving a large leak surface — spending where it doesn't matter.
3. **Passing checksec but shipping fork-without-exec** — a brute-forceable server with a perfect report.
4. **Enabling Mandatory ASLR without bottom-up on Windows** and getting a low-entropy fixed slot.
5. **Treating CET/PAC/shadow stacks as complete control-flow protection** — they have edges and gaps.
6. **No runtime posture telemetry** — a reverted sysctl or `nokaslr` host goes unnoticed.
7. **Hardening regressions handled as build warnings**, not incidents — they silently un-protect products.
8. **Assuming the JIT is covered by process-wide flags** — it's a distinct surface needing W^X + blinding.

---

## Tricky Points

- **Leaks make entropy nearly irrelevant past a threshold.** This inverts naive intuition ("more random = more safe"). Past brute-force resistance, the marginal bit buys almost nothing against the dominant (leak) threat. Communicate this to stakeholders who want "stronger ASLR" when they should want "fewer leaks + enforcement."
- **A perfect checksec report can hide a brute-forceable design.** Tooling verifies *flags*, not *architecture*. Fork-without-exec, shared zygotes, and snapshot reuse are invisible to binary scanners.
- **Shared caches/zygotes amplify the move-the-deck weakness.** When many libraries share one slide/layout, one leaked pointer de-randomizes *all* of them at once — higher blast radius than per-library randomization.
- **Mandatory ASLR can reduce entropy.** A force-relocate that lands in a fixed slot is a relocation, not randomization. The Windows case is the canonical example.
- **The durable metric is residual exploitability, not mitigation count.** Two products with identical checksec output can have very different real risk depending on their bug surface (especially leaks) and architecture (forking, JIT).
- **Memory safety changes the whole equation.** MTE/safe languages remove the OOB reads/writes the bypass tree needs; where deployed, the mitigation matrix matters far less. Track adoption as the strategic line, not a side note.

---

## Test Yourself

1. Your fleet is fully 64-bit PIE with Full RELRO and canaries. A team proposes spending a quarter increasing ASLR entropy by several bits. Argue, with the leak-vs-brute-force distinction, where that effort should go instead and when the entropy work *would* be justified.
2. Build a per-platform mitigation matrix (rows: ASLR, DEP/NX, RELRO/GOT-protect, stack cookie, forward-edge CFI, return protection, kernel ASLR). Fill columns for Linux/glibc, Windows, macOS/iOS, Android with the concrete mechanism name for each cell.
3. A binary passes `checksec` (PIE/Full RELRO/NX/canary all green) but the service is brute-forceable. Give two architectural reasons invisible to checksec, and how you'd detect each.
4. Explain the Windows Mandatory-ASLR-without-bottom-up footgun. Why can force-relocation *reduce* effective entropy?
5. Why does the macOS dyld shared cache slide simultaneously provide strong randomization *and* a large blast radius on a single leak?
6. Define a CI gate that enforces hardening across vendored and transitive binaries, not just first-party. What does it check at build time vs. deploy time, and why both?
7. Model the residual risk of a service with NX+ASLR+Full RELRO+canary+CET given a single out-of-bounds *read* bug. What capabilities does the attacker still need, and which mitigation does the read defeat?
8. Where does MTE (ARM) fit relative to ASLR — secrecy, enforcement, or neither — and why does it change the strategic calculus?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        OPERATING ASLR & MITIGATIONS AT SCALE (PROFESSIONAL)     │
├──────────────────────────────────────────────────────────────────┤
│ ENTROPY ECONOMICS:                                              │
│   64-bit + PIE = the cheap decisive win (crosses brute thresh.) │
│   past threshold: bits buy little; LEAK ignores entropy         │
│   => budget bits once, invest the rest in LEAK RESISTANCE       │
├──────────────────────────────────────────────────────────────────┤
│ PLATFORM MATRIX (mechanism names):                              │
│   Linux  : randomize_va_space, -fPIE -pie, -z relro,now,        │
│            -fstack-protector, FORTIFY, -fcf-protection (CET),    │
│            KASLR/KPTI/FGKASLR                                    │
│   Windows: /DYNAMICBASE, /HIGHENTROPYVA, /NXCOMPAT, /GS,         │
│            /guard:cf (CFG), CET shstk; Exploit Protection (EMET  │
│            successor); Mandatory+Bottom-up ASLR TOGETHER         │
│   macOS/iOS: PIE default, dyld shared-cache slide, W^X+MAP_JIT,  │
│              PAC + BTI (Apple Silicon)                           │
│   Android: PIE required, Zygote shared layout, PAC/BTI/MTE,      │
│            SELinux/seccomp/scudo                                 │
├──────────────────────────────────────────────────────────────────┤
│ ENFORCE: scan EVERY artifact (incl. vendored/transitive/base    │
│   image); gate at build (provenance) + deploy (admission);      │
│   posture telemetry across fleet; weakest link = product risk   │
├──────────────────────────────────────────────────────────────────┤
│ FOOTGUNS: Mandatory-ASLR low-entropy slot; fork-without-exec    │
│   (checksec-invisible); shared cache/zygote blast radius;       │
│   MAP_FIXED/huge VA; FORTIFY level downgrade; nokaslr in prod   │
├──────────────────────────────────────────────────────────────────┤
│ STRATEGIC ENDGAME: memory safety (safe langs, MTE) dissolves    │
│   the bypass tree; mitigations buy time.                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At scale, ASLR-and-mitigations is a **program**, not a checkbox: entropy economics, a cross-platform mitigation matrix, fleet-wide measurement and enforcement, residual-risk modeling, and governance against silent regressions.
- **Entropy economics:** 64-bit + PIE is the cheap, decisive win that crosses the brute-force threshold. Beyond it, more bits buy little because the dominant threat — the **info leak** — is entropy-independent. Budget bits once; invest the rest in **leak resistance** (enforcement layer, OOB-read elimination, re-randomization, side-channel mitigations).
- **Each platform differs:** Linux (`randomize_va_space`, `-fPIE -pie`, `-z relro,now`, CET, KASLR/KPTI/FGKASLR); Windows (`/DYNAMICBASE`, `/HIGHENTROPYVA`, `/NXCOMPAT`, `/GS`, `/guard:cf` CFG, CET, Exploit Protection as EMET's successor — enable Mandatory *and* Bottom-up ASLR together); macOS/iOS (PIE default, dyld shared-cache slide, W^X + `MAP_JIT`, PAC/BTI on Apple Silicon); Android (PIE required, Zygote shared layout, PAC/BTI/MTE, SELinux/seccomp).
- **Enforce on the weakest link** across the *entire* loaded-object inventory — vendored, transitive, base-image, JIT — at both build (provenance) and deploy (admission) gates, with fleet posture telemetry.
- **Model residual risk by bug class × mitigation per component**, not by "mitigation on/off." A checksec-clean binary can still be brute-forceable (fork-without-exec) or JIT-exposed; tooling verifies flags, not architecture.
- **Footguns:** Windows Mandatory-ASLR-without-bottom-up (low-entropy slot), fork/zygote/snapshot shared layouts (checksec-invisible), shared-cache blast radius, `MAP_FIXED`/huge-VA reservations, FORTIFY-level downgrade, `nokaslr` leaking to prod.
- The **strategic endgame is memory safety** (safe languages, ARM MTE) — it removes the out-of-bounds reads/writes every bypass class depends on. Mitigations buy time; safety ends the class.

---

## Further Reading

- *Microsoft Docs* — "Exploit protection reference," `/DYNAMICBASE`, `/HIGHENTROPYVA`, `/NXCOMPAT`, `/GS`, `/guard:cf`; BinSkim policy scanner.
- *Apple Platform Security Guide* — ASLR, dyld shared cache, W^X/`MAP_JIT`, Pointer Authentication on Apple Silicon.
- *Android Platform Security* docs — ASLR, Zygote, MTE, scudo allocator, SELinux/seccomp.
- *Intel CET specification* and Linux `-fcf-protection` / `-z shstk` documentation.
- *ARM* — Pointer Authentication, BTI, and Memory Tagging Extension (MTE) architecture references.
- *"KASLR is Dead: Long Live KASLR"* — Gruss et al. (KAISER/KPTI); Linux FGKASLR design.
- *"On the Effectiveness of Address-Space Randomization"* — Shacham et al. (the entropy-vs-brute-force baseline).
- *SLSA / supply-chain provenance* specifications — for build-flag attestation.
- *Distribution hardening guides* — Debian, Fedora, Ubuntu, and the OpenSSF compiler-hardening best-practices guide.
- *"What is Memory Safety and Why Does It Matter"* (CISA/industry guidance) — the strategic case for the endgame.

---

## Diagrams & Visual Aids

### Entropy economics curve

```text
  security
  value
    │           leak resistance (enforcement, OOB-read removal,
    │         ╭─ re-randomization) — where residual risk lives
    │        ╱
    │   ╭───╯  <- diminishing returns: more ASLR bits buy little
    │  ╱          because INFO LEAK ignores entropy
    │ ╱
    │╱  <- 64-bit + PIE: the cheap, decisive jump (beats brute force)
    └────────────────────────────────────────────────────────► effort
         32-bit   64-bit+PIE   +more bits      +leak resistance
```

### The mitigation matrix (rows × platforms)

```text
                 Linux/glibc     Windows        macOS/iOS     Android
   ASLR          randomize_va    /DYNAMICBASE   on by default PIE required
                 + -fPIE -pie    + /HIGHENTROPY dyld slide    + kernel KASLR
   DEP/NX        -z noexecstack  /NXCOMPAT      W^X enforced  W^X enforced
   GOT protect   Full RELRO      (loader/CFG)   read-only     RELRO
   stack cookie  -fstack-prot.   /GS            stack guard   stack guard
   fwd-edge CFI  CET IBT         CFG /guard:cf  BTI           BTI
   return prot.  CET shstk       CET shstk      PAC           PAC
   kernel ASLR   KASLR+KPTI      kernel ASLR    kernel ASLR   KASLR+KPTI
   mem-safety hw  (—)            (—)            MTE (newer)   MTE
```

### Weakest-link enforcement across the inventory

```text
   PRODUCT POSTURE = min over ALL loaded objects
   ┌──────────────────────────────────────────────────────────┐
   │ main binary       : PIE  Full RELRO  NX  canary  CET  ✔   │
   │ first-party libs  : PIE  Full RELRO  NX  canary       ✔   │
   │ vendored lib X    : non-PIE  Partial RELRO            ✘ ◄─ weakest link
   │ base-image lib Y  : PIE  NX                           ~   │
   │ JIT region        : (needs W^X + blinding)            ~   │
   └──────────────────────────────────────────────────────────┘
   The product is as hard as vendored lib X — not as hard as main.
```

### Build + deploy enforcement gates

```text
   source ──► build ──[provenance: required flags attested?]──► artifact
                                  │ fail -> reject
                                  ▼
   registry ──► deploy ──[admission: re-scan actual bytes; weakest link?]──► run
                                  │ fail -> reject
                                  ▼
   fleet ──► telemetry [randomize_va_space=2? KPTI? CET? nokaslr?] ──► alert
```
