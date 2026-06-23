# Build Fundamentals — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Build Fundamentals
> *The senior page taught you the policy levers. This page is about pulling them at organizational scale, under production failure, with auditors and a CVE clock running — where "statically or dynamically linked?" stops being academic and becomes a question about your supply chain, your glibc floor, and how fast you can patch a fleet.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Toolchain Pinning and Hermeticity at the Fundamentals Layer](#toolchain-pinning-and-hermeticity-at-the-fundamentals-layer)
4. [The glibc Floor — manylinux and the Symbol-Version Tax](#the-glibc-floor--manylinux-and-the-symbol-version-tax)
5. [glibc vs musl — A Real Decision, Not a Religion](#glibc-vs-musl--a-real-decision-not-a-religion)
6. [Static vs Dynamic as a Supply-Chain Decision](#static-vs-dynamic-as-a-supply-chain-decision)
7. [Security Hardening as Build-Time Flags](#security-hardening-as-build-time-flags)
8. [Debugging Production Link and Load Failures](#debugging-production-link-and-load-failures)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Operating builds across a fleet and a supply chain, where the linking model is a security, compliance, and incident-response concern.**

The senior page framed linking choices as engineering tradeoffs. At the professional level those same choices show up in different meetings: a CVE in `libwebp` and "how many of our binaries statically bundled it?"; a wheel that imports fine on the build box and `ImportError: GLIBC_2.34 not found` on a customer's RHEL 8; a compliance audit that asks "are your binaries built PIE with full RELRO?"; an incident where a base-image bump silently changed the glibc floor and broke a third of the fleet.

None of these are new *concepts* — they're the fundamentals from the earlier tiers, now multiplied by a fleet, a regulator, and a clock. The skill here is judgment under those constraints: knowing that static linking trades patch-velocity for portability, that musl trades compatibility for size, that a pinned toolchain is the only thing standing between you and a non-reproducible incident. This page is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — ELF, the dynamic linker, GOT/PLT, RPATH/RUNPATH, LTO, linker choice.
- **Required:** You've operated something in production and debugged a failure you couldn't reproduce locally.
- **Helpful:** You've owned a CI pipeline, a base image, or a release process.
- **Helpful:** You've been on the receiving end of a CVE that required rebuilding and redeploying artifacts.

---

## Toolchain Pinning and Hermeticity at the Fundamentals Layer

Everything in the earlier tiers — codegen, relocation, symbol versions, LTO decisions — is a *function of the exact toolchain*. Two engineers running `gcc -O2 -flto` get different bytes if their GCC versions, their `binutils`, their glibc headers, or even their `/usr/lib` contents differ. At org scale, "different bytes" means non-reproducible builds, un-cacheable artifacts, and incidents that vanish when you try to reproduce them.

**Pinning** means the toolchain is an explicit, versioned input, not "whatever the runner has":

```dockerfile
# Bad: floating. "latest" is a different compiler next Tuesday.
FROM ubuntu:latest
RUN apt-get install -y gcc

# Better: pinned base + pinned compiler + recorded versions
FROM ubuntu:22.04
RUN apt-get install -y gcc-12=12.3.0-1ubuntu1~22.04 binutils=2.38-* \
 && gcc-12 --version && ld --version    # record exact versions in the build log
```

**Hermeticity** goes further: the build should depend *only* on declared inputs, isolated from the host's ambient state — no reaching into the runner's `/usr/include`, no picking up an `LD_LIBRARY_PATH` from the CI environment, no network fetch mid-build. This is the foundation that [09 — Reproducible Builds](../09-reproducible-builds/professional.md) is built on, and at the fundamentals layer it specifically means:

- **Pin the compiler, linker, and `binutils`** — same versions everywhere, recorded in the artifact's provenance.
- **Pin the sysroot / libc headers** — the headers you compile against determine the symbol versions you record (next section).
- **Strip nondeterminism from codegen** — `-ffile-prefix-map` to remove absolute paths from `__FILE__` and debug info; `SOURCE_DATE_EPOCH` for timestamps; pin the LTO mode (LTO codegen varies by compiler version).
- **Control link inputs** — explicit library paths, no implicit `/usr/local/lib`, deterministic link order.

> **The professional reality:** a toolchain that isn't pinned is a latent incident. The day a CI runner image upgrades GCC or glibc, your binaries' symbol-version requirements, optimization, or even their hardening flags can shift — and you'll find out from a customer, not a test. Pinning isn't bureaucracy; it's the difference between an incident you can reproduce and one you can't.

---

## The glibc Floor — manylinux and the Symbol-Version Tax

Recall from middle.md that glibc uses **symbol versioning**: your binary doesn't just need `memcpy`, it needs `memcpy@GLIBC_2.14` or `memcpy@GLIBC_2.34`. The version recorded is the *newest* one your build's glibc headers offered for each symbol you used. This creates a **glibc floor**: your binary will refuse to run on any system whose glibc is older than the highest version it references.

This is the entire reason `GLIBC_2.34 not found` is the most-Googled deployment error in existence. You built on Ubuntu 22.04 (glibc 2.35); the binary recorded `@GLIBC_2.34` for some symbol; you deployed to RHEL 8 / Amazon Linux 2 (glibc 2.28); the loader refuses because 2.28 < 2.34.

```bash
# Find your binary's glibc floor — the highest GLIBC_ version it requires
objdump -T app | grep GLIBC_ | sed 's/.*GLIBC_/GLIBC_/' | sort -uV | tail
# or
readelf --dyn-syms app | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -1
```

The Python ecosystem solved this systematically with **manylinux**: a set of policies (`manylinux2014`, `manylinux_2_28`, `manylinux_2_34`…) where the *number is literally the maximum glibc version* a wheel is allowed to require. A `manylinux_2_28` wheel is guaranteed to run on any Linux with glibc ≥ 2.28. You produce one by *building inside the corresponding old toolchain image* and running `auditwheel` to verify (and to vendor any non-allowlisted shared libraries into the wheel):

```bash
# Build inside a deliberately OLD environment to keep the glibc floor low
docker run -v "$PWD:/io" quay.io/pypa/manylinux_2_28_x86_64 \
  /io/build-wheels.sh
auditwheel repair dist/mypkg-*.whl --plat manylinux_2_28_x86_64
# auditwheel rejects the wheel if it requires a glibc newer than the policy allows
```

> **The principle, beyond Python:** *build on the oldest libc you intend to support, run on the newest.* glibc is forward-compatible (new glibc runs old binaries) but not backward-compatible (old glibc can't satisfy new symbol versions). Your **build environment's libc, not your dev laptop's, sets the floor for the entire fleet**. This is why mature C/C++ release pipelines build inside an intentionally ancient base image — the inverse of everyone's instinct to "build on something modern."

---

## glibc vs musl — A Real Decision, Not a Religion

Alpine-based images use **musl** libc instead of glibc, and this is the second-most-common "works in CI, breaks in prod" source after the glibc floor. They are different C library implementations with different tradeoffs:

| | glibc | musl |
|---|---|---|
| Size | Large | Tiny (Alpine images are small largely because of this) |
| Static linking | Discouraged; NSS/`getaddrinfo` pull in dlopen'd modules | First-class; clean fully-static binaries |
| Symbol versioning | Yes (the floor problem) | No |
| Compatibility | The de-facto Linux standard; most binaries built for it | Stricter; subtle behavioral differences |
| Performance | Faster `malloc`, faster stdio in many workloads | Historically slower `malloc` (mitigated in recent versions); tiny default thread stack |

The classic musl gotchas that bite teams:

- **A glibc-built binary will not run on a musl-only system** (no `ld-linux`), and vice versa. You can't copy a binary from Ubuntu to Alpine and expect it to run.
- **musl's default thread stack is small** (~128 KB historically), so deeply-recursive or large-stack code that's fine on glibc segfaults on Alpine.
- **DNS resolution differs** — musl's resolver has historically not read all the `nsswitch`/`resolv.conf` features glibc does, causing intermittent resolution failures that look like network bugs.
- **No native `dlopen` of glibc plugins** — software that `dlopen`s NSS modules or proprietary glibc-built `.so`s breaks.

> **The decision:** choose **musl/Alpine** when you want truly static, tiny binaries and control the whole stack (Go and Rust target it cleanly). Choose **glibc** (Debian/Ubuntu slim, RHEL UBI, distroless-glibc) when you depend on the broad C/C++ ecosystem, third-party `.so`s, or behavioral compatibility. The most common professional mistake is choosing Alpine *for image size* without realizing you've also opted into a different libc with real behavioral differences — and then debugging a DNS or stack-size "heisenbug" for a week.

---

## Static vs Dynamic as a Supply-Chain Decision

Junior framed static vs dynamic as size-vs-portability. At the professional level it's primarily a **patch-velocity and supply-chain** decision, and the CVE clock makes it concrete.

When `libwebp` (CVE-2023-4863) or `xz`/`liblzma` (CVE-2024-3094) gets a critical advisory, the operative question is: *how do we patch every affected binary, and how fast?*

- **Dynamically linked:** the vulnerable code is one shared `libwebp.so.7` on each host. Patch the package, restart processes, done — *one* update fixes *every* program that links it. The distro's security team does most of the work. This is dynamic linking's killer feature at scale.
- **Statically linked:** the vulnerable code is *copied into every binary that bundled it*. There is no shared `.so` to patch. You must **rebuild and redeploy every affected artifact** — which means you must first *know* which artifacts bundled the vulnerable version. If you don't have an SBOM, you're grepping build manifests during an incident.

This reframes the tradeoff:

| Concern | Static | Dynamic |
|---|---|---|
| Patch a transitive CVE | Rebuild + redeploy every artifact | Update one shared lib, restart |
| Knowing what you shipped | Requires an **SBOM** per artifact | Query the package manager on the host |
| Reproducibility / portability | Self-contained, immune to host drift | Depends on host libs (and their floor) |
| Attack surface on host | No shared lib to hijack (`LD_PRELOAD` weaker) | Shared libs are a hijack/`LD_PRELOAD` target |
| "Works on my machine" | Strong | Weaker |

The professional resolution is not "always static" or "always dynamic" — it's *making the choice deliberately and instrumenting it*. If you statically link (Go services, distroless static images), you **must** generate an SBOM (`syk`/`syft`, `cyclonedx`) per artifact so a future CVE is a query, not an archaeology dig. If you dynamically link, you **must** track and control your base image's library versions so the patch path actually exists and the glibc floor doesn't drift.

> **The hard-won lesson from xz/liblzma:** static bundling without an SBOM turned a one-line `apt upgrade` for dynamic consumers into a fleet-wide "which of our 400 services bundled this, and at what version?" scramble for static consumers. The linking model you chose months earlier dictated your incident response time. See [09 — Reproducible Builds](../09-reproducible-builds/professional.md) for how SBOM generation rides on the same machinery.

---

## Security Hardening as Build-Time Flags

Modern exploit mitigations are *build-time decisions* baked into the artifact — which means they're your responsibility, and they're auditable. The core four on Linux:

| Mitigation | Flag(s) | What it defends |
|---|---|---|
| **PIE** (position-independent executable) | `-fPIE -pie` | Enables ASLR for the *main executable's* code, not just libraries — randomizes its load base so code-reuse attacks can't assume addresses |
| **Full RELRO** | `-Wl,-z,relro -Wl,-z,now` | Resolves all symbols at load, then marks the GOT read-only — blocks GOT-overwrite |
| **Stack canaries** | `-fstack-protector-strong` | Detects stack-buffer overflows before `ret` |
| **Fortify source** | `-D_FORTIFY_SOURCE=2 -O2` | Compile-time + runtime bounds checks on `memcpy`/`sprintf`/etc. |

Audit any binary in one command:

```bash
checksec --file=./app
# RELRO   STACK CANARY   NX   PIE   FORTIFY ...
# Full RELRO  Canary found  NX enabled  PIE enabled  Yes
```

The professional concerns layered on top of "just set the flags":

- **PIE has a (small) cost** — the extra GOT indirection for the main executable. For most services it's noise; for a measured hot path you may evaluate it. Most distros default to PIE now, so opting *out* is the deliberate act.
- **Hardening must be enforced org-wide, not per-developer.** A single dependency built without canaries or RELRO is the weak link. Bake the flags into the shared toolchain wrapper / build template and *verify with `checksec` in CI*, because flags silently get dropped when someone copies a Makefile.
- **ASLR is also a runtime setting** (`/proc/sys/kernel/randomize_va_space`) — PIE is necessary but the kernel must also have ASLR enabled for it to matter. Containers inherit the host's setting.
- **These compose with the supply chain.** A statically linked binary still benefits from PIE/RELRO/canaries; they're orthogonal to linking. Don't assume "static = secure."

> **The audit reality:** "are your release binaries PIE with full RELRO and stack protection?" is a routine question in security reviews and compliance frameworks (e.g., for FedRAMP-adjacent or supply-chain attestation). The right answer is "yes, enforced in the build template and verified by `checksec` in CI" — not "probably, the distro defaults handle it." Make it provable, not hopeful.

---

## Debugging Production Link and Load Failures

A structured triage beats guessing every time. Classify *which border* failed (recall middle.md's link/load/run-time borders), then run the matching tool.

**The triage tree:**

```
Symptom                                  →  Border / Tool
─────────────────────────────────────────────────────────────
"undefined reference" at build           →  LINK     → check link order, missing -l, missing .o
"cannot open shared object file"          →  LOAD     → ldd; lib absent or not on search path
"version GLIBC_2.xx not found"            →  LOAD     → glibc floor too high for target
"symbol lookup error: ... undefined sym"  →  RUN/LOAD → lazy-bound symbol missing; LD_BIND_NOW to surface
"wrong/garbage values, intermittent crash" → ABI      → mismatched .so version; same symbol, different layout
binary won't exec at all, "No such file"  →  LOAD     → wrong interpreter (musl vs glibc, wrong arch)
```

**The command sequence for a load failure:**

```bash
ldd ./app                       # what's needed; "=> not found" points at the culprit
readelf -d ./app | grep NEEDED  # the declared dependencies (ground truth, not host-resolved)
readelf -d ./app | grep -E 'RPATH|RUNPATH'   # where it will look
LD_DEBUG=libs ./app             # watch the loader's actual search, dir by dir
LD_DEBUG=files ./app 2>&1 | grep "trying file"   # exact paths it probed and rejected

# glibc floor mismatch:
objdump -T ./app | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -1   # binary needs
ldd --version | head -1                                            # target provides

# "No such file or directory" on a binary that clearly exists = wrong/missing interpreter
readelf -l ./app | grep INTERP   # e.g. needs ld-musl but host is glibc, or wrong arch
file ./app                       # arch + interpreter + PIE confirmation
```

The two classic traps:

1. **"No such file or directory" on a file that exists** almost always means the *interpreter* (`PT_INTERP`) is missing — you copied a musl binary to a glibc box (or wrong CPU arch). The error is about `ld-linux`, not your binary.
2. **Intermittent garbage/crashes with no error message** is the ABI-mismatch signature — symbols resolved fine but a struct layout or type size differed between build-time headers and the runtime `.so`. There's no diagnostic; you correlate the `.so` version (`readelf -d`, package version) against what you built against.

> **The professional discipline:** never debug a load failure by trial-and-error `LD_LIBRARY_PATH` exports. Read `readelf -d` for ground truth (what the binary *declares* it needs and where it'll look), then `LD_DEBUG=libs` for what the loader *actually does*. That two-step turns a multi-hour guessing session into a five-minute diagnosis.

---

## War Stories

**The Alpine DNS heisenbug.** A team moved a Go service to Alpine to shrink images. Most requests worked; ~1% of outbound calls failed DNS resolution intermittently. Cause: Go's *pure-Go* resolver vs musl's resolver handling `resolv.conf` `search`/`ndots` differently than glibc, surfacing only for certain hostnames. The "image size optimization" had quietly swapped the libc and its resolver behavior. Fix involved `CGO_ENABLED` and resolver config — but the *lesson* was that choosing Alpine is choosing musl, with all its behavioral edges.

**The base-image bump that raised the glibc floor.** A routine "update CI base from Ubuntu 20.04 to 22.04" sailed through tests (the test runners also updated). Released binaries then failed on customers' older systems with `GLIBC_2.34 not found`. Nothing in the *code* changed; the *build environment's glibc* rose, lifting the floor above customers' systems. Fix: build releases inside a pinned, deliberately-old `manylinux`-style image, decoupled from the dev/CI base.

**The static-bundle CVE scramble.** When a critical CVE landed in a compression library, the dynamic-linking consumers patched with one `apt upgrade` + restart. The teams that had statically bundled it — for "portability" — had no shared lib to patch and *no SBOM* to find which of their dozens of artifacts were affected. The incident's long pole was inventory, not the fix. The linking decision made months earlier set the response time.

**The `LD_LIBRARY_PATH` that worked until it didn't.** A service ran fine for a year. A new deployment tool launched it under a different parent process that didn't export the `LD_LIBRARY_PATH` the binary secretly depended on. Instant `cannot open shared object file` in production only. The binary had relied on an environment variable instead of a baked-in `RUNPATH`/`$ORIGIN` — an invisible dependency that finally got dropped.

---

## Decision Frameworks

**Static or dynamic? Ask:**
- Do I control the runtime environment (containers, my own fleet)? → either works; lean dynamic for patch velocity *if* you control base images.
- Do I ship to *other people's* heterogeneous machines? → static (Go/Rust) for portability, *with an SBOM*.
- Is fast CVE patching across a fleet the priority? → dynamic, with controlled base images.
- Is "single self-contained artifact, no host assumptions" the priority? → static, and own the SBOM.

**glibc or musl? Ask:**
- Do I need tiny, truly-static binaries and control the whole stack (Go/Rust)? → musl/Alpine is great.
- Do I depend on third-party `.so`s, broad C/C++ ecosystem, or behavioral compatibility? → glibc.
- Is the team prepared to debug musl's resolver/stack/`malloc` edges? → if no, glibc.

**Which base image sets my floor? Ask:**
- What's the *oldest* glibc any target runs? → build on that, or older. Decouple the *build* base from the *dev* base.

**What hardening is mandatory? Default to:**
- `-fPIE -pie`, full RELRO (`-z relro -z now`), `-fstack-protector-strong`, `-D_FORTIFY_SOURCE=2`, enforced in the build template, verified by `checksec` in CI.

---

## Mental Models

- **The build environment's libc is a contract with the entire fleet.** Whatever glibc you build against sets the floor for everyone who runs the binary. Build old, run new — not the reverse.

- **Static vs dynamic is "who patches the CVE, and how fast."** Dynamic = the distro patches one `.so` for everyone. Static = you rebuild every artifact, so you'd better have an SBOM to know which ones.

- **Alpine isn't "small Ubuntu" — it's a different libc.** Choosing it for image size silently opts into musl's resolver, stack, and `malloc` behavior. Free megabytes, paid for in heisenbugs if you're unaware.

- **Hardening is a property of the artifact, set at build time, and auditable.** `checksec` makes "are we hardened?" a fact, not a hope. Enforce in the template; verify in CI.

- **A binary that needs an environment variable to run has an invisible dependency.** `LD_LIBRARY_PATH` works until the day a different launcher doesn't set it. Bake the path into `RUNPATH`/`$ORIGIN`.

---

## Common Mistakes

1. **Floating toolchains and base images.** `latest` is a different compiler/glibc next week. Pin compiler, linker, `binutils`, and the build base; record versions in provenance. An unpinned toolchain is a non-reproducible incident waiting to happen.

2. **Building releases on a modern image, shipping to older targets.** This silently raises the glibc floor. Build releases inside a deliberately-old (`manylinux`-style) image, decoupled from dev/CI.

3. **Choosing Alpine purely for size.** You also chose musl. Budget for resolver/stack/`malloc` differences, or stay on a glibc slim/distroless base.

4. **Statically linking without an SBOM.** The first critical CVE in a bundled lib turns into a fleet-wide archaeology project. If you bundle, you inventory — per artifact.

5. **Treating hardening flags as per-project polish.** A single un-hardened dependency is the weak link. Enforce PIE/RELRO/canaries/FORTIFY in the shared build template and *verify with `checksec` in CI*.

6. **Debugging load failures with trial-and-error `LD_LIBRARY_PATH`.** Read `readelf -d` (ground truth) and `LD_DEBUG=libs` (actual behavior) instead. And never *ship* a binary that depends on `LD_LIBRARY_PATH`.

7. **Misreading "No such file or directory" on an existing binary.** It's the missing *interpreter* (wrong libc or arch), not a missing binary. `readelf -l | grep INTERP` and `file` reveal it instantly.

---

## Test Yourself

1. You build a release on Ubuntu 22.04 and it fails on a customer's RHEL 8 with `GLIBC_2.34 not found`. Explain the root cause in terms of symbol versioning, and give the build-side fix.
2. What does manylinux's version number (`manylinux_2_28`) actually mean, and how does `auditwheel` enforce it?
3. A critical CVE lands in a compression library you depend on. Compare your patch path and timeline if you linked it dynamically vs statically. What artifact must you have for the static case?
4. A team moves to Alpine for smaller images and starts seeing intermittent DNS failures. What's the likely cause, and what general lesson does it teach about choosing Alpine?
5. List the four core Linux hardening flags, what each defends, and the one command to verify them on a built binary.
6. A binary runs from its build directory but dies in production with `cannot open shared object file`. Walk through your triage. What two commands give you ground truth before you touch the environment?
7. A binary that clearly exists fails to execute with "No such file or directory." What's actually missing, and how do you confirm it?

<details>
<summary>Answers</summary>

1. glibc uses **versioned symbols**; your binary recorded the *newest* version (`@GLIBC_2.34`) of some symbol because that's what the build's glibc offered. The target's glibc (2.28) can't satisfy a 2.34 requirement (glibc is forward- but not backward-compatible), so the loader refuses. **Fix:** build the release inside a deliberately-old environment (e.g., a `manylinux`/older-distro image) so the floor stays ≤ the oldest target.
2. The number is the **maximum glibc version the wheel is allowed to require** — `manylinux_2_28` runs on any Linux with glibc ≥ 2.28. `auditwheel` inspects the wheel's required symbol versions, **rejects** it if it exceeds the policy, and vendors non-allowlisted shared libs into the wheel.
3. **Dynamic:** patch the one shared `.so` (distro package), restart processes — one update covers every consumer; fast. **Static:** the vulnerable code is copied into every binary that bundled it; you must **rebuild and redeploy every affected artifact**, and first you must *know which ones bundled it* — which requires a per-artifact **SBOM**. Without an SBOM the long pole is inventory, not the fix.
4. Likely **musl's resolver** handling `resolv.conf` (`search`/`ndots`) differently from glibc, surfacing for some hostnames. Lesson: **choosing Alpine is choosing musl** — a different libc with real behavioral differences (resolver, thread stack size, `malloc`), not just a smaller Ubuntu.
5. **PIE** (`-fPIE -pie`, ASLR for the executable's code), **Full RELRO** (`-Wl,-z,relro -Wl,-z,now`, read-only GOT after load — blocks GOT overwrite), **stack canaries** (`-fstack-protector-strong`, detect stack overflow before `ret`), **FORTIFY** (`-D_FORTIFY_SOURCE=2 -O2`, bounds-checked libc calls). Verify with **`checksec --file=./app`**.
6. Classify it as a **load-time** failure. Before touching the environment: `readelf -d ./app | grep -E 'NEEDED|RUNPATH'` (ground truth: what it declares it needs and where it'll look) and `ldd ./app` (which dependency resolves to "not found"). Then `LD_DEBUG=libs ./app` to watch the actual search. The binary likely relied on a build-dir path or an `LD_LIBRARY_PATH` not present in prod; fix with baked-in `RUNPATH`/`$ORIGIN`.
7. The **program interpreter** (`PT_INTERP`, i.e. `ld-linux`/`ld-musl`) is missing — typically a musl binary on a glibc host (or vice versa), or the wrong CPU architecture. Confirm with `readelf -l ./app | grep INTERP` and `file ./app`.

</details>

---

## Cheat Sheet

```
GLIBC FLOOR
  objdump -T app | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -1   binary needs
  ldd --version | head -1                                          target provides
  RULE: build on the OLDEST libc you support, run on the newest

manylinux
  build inside quay.io/pypa/manylinux_2_28_x86_64  → floor = glibc 2.28
  auditwheel repair --plat manylinux_2_28_x86_64   → verify + vendor libs

glibc vs musl
  glibc: standard, broad compat, versioned symbols, larger
  musl : tiny, clean static, NO versioning; resolver/stack/malloc differences
  CANNOT mix: glibc binary won't run on musl-only host (no ld-linux)

STATIC vs DYNAMIC (supply chain)
  dynamic → patch one .so, restart   (need controlled base image)
  static  → rebuild every artifact   (NEED an SBOM per artifact)

HARDENING (set in build template, verify in CI)
  -fPIE -pie                    PIE → ASLR for executable code
  -Wl,-z,relro -Wl,-z,now       full RELRO → read-only GOT
  -fstack-protector-strong      stack canaries
  -D_FORTIFY_SOURCE=2 -O2       fortified libc calls
  checksec --file=app           audit all of the above

LOAD-FAILURE TRIAGE (ground truth before guessing)
  readelf -d app | grep NEEDED      what it declares it needs
  readelf -d app | grep RUNPATH     where it will look
  ldd app                           which dep is "not found"
  LD_DEBUG=libs ./app               loader's actual search
  readelf -l app | grep INTERP      "No such file" → wrong/missing interpreter
  file app                          arch + interpreter + PIE
```

---

## Summary

- **Pin the toolchain** (compiler, linker, `binutils`) and the **build base image**, and record versions in provenance. An unpinned toolchain is a non-reproducible incident in waiting — the fundamentals-layer foundation of [reproducible builds](../09-reproducible-builds/professional.md).
- glibc's **symbol versioning** creates a **glibc floor**: your binary refuses to run on any system older than the newest `GLIBC_x` it references. **Build on the oldest libc you support, run on the newest** — manylinux systematizes exactly this, with the policy number = the max glibc allowed.
- **glibc vs musl** is a real decision: musl gives tiny, cleanly-static binaries but differs in its resolver, thread-stack size, and `malloc`. Choosing Alpine for size means choosing musl — budget for its edges or stay on glibc.
- **Static vs dynamic is a supply-chain decision**: dynamic = patch one shared `.so` for the whole fleet; static = rebuild every artifact, so you *must* keep an **SBOM** to survive the next CVE.
- **Hardening** (PIE, full RELRO, stack canaries, FORTIFY) is a set of **build-time flags** baked into the artifact and **auditable with `checksec`**. Enforce in the shared build template; verify in CI; don't rely on distro defaults you can't prove.
- **Debug load failures with ground truth** (`readelf -d`, `LD_DEBUG=libs`), not trial-and-error environment variables. "No such file" on an existing binary means the *interpreter* (libc/arch) is wrong.

You can now operate the linking model as a fleet-, security-, and incident-level concern. The remaining tier — [interview.md](interview.md) — consolidates the entire topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- [The manylinux project and PEP 600](https://github.com/pypa/manylinux) — the "build old, run new" policy made concrete, plus `auditwheel`.
- [musl libc — functional differences from glibc](https://wiki.musl-libc.org/functional-differences-from-glibc.html) — the authoritative list of behavioral edges.
- *Secure Programming Cookbook* and your platform's hardening guide — the rationale behind PIE/RELRO/canaries.
- [`checksec` and the hardening-check tooling](https://github.com/slimm609/checksec.sh) — auditing what your build actually emitted.
- SLSA framework and SBOM tooling (`syft`, `cyclonedx`) — provenance and inventory for the static-linking supply-chain problem.
- Retrospectives on CVE-2024-3094 (xz/liblzma) — a live case study in why your linking and supply-chain posture is an incident-response decision.

---

## Related Topics

- [09 — Reproducible Builds](../09-reproducible-builds/professional.md) — toolchain pinning, hermeticity, SBOMs, and provenance at scale.
- [02 — Dependency Graphs](../02-dependency-graphs/professional.md) — tracking the transitive lib graph that the CVE patch path depends on.
- [04 — Per-Language Tools](../04-per-language-tools/professional.md) — how Go/Rust/Python toolchains expose libc, static-linking, and manylinux choices.
- [Quality Engineering › Supply-Chain Security](../../README.md) — the broader picture the static/dynamic CVE decision feeds into.
