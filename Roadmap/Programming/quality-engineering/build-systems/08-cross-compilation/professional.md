# Cross-Compilation — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Cross-Compilation
> *Cross-compilation stops being a command and becomes a release strategy: a CI matrix that ships N platforms reliably, a deliberate war against the CGO/native-dependency tax, Apple's notarization gauntlet, firmware pipelines that can't tolerate a field failure — and the scars from the times it all went wrong.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Release Matrix as a System](#the-release-matrix-as-a-system)
3. [The CGO / Native-Dependency Tax — and How Teams Avoid It](#the-cgo--native-dependency-tax--and-how-teams-avoid-it)
4. [Zig as a Cross-Compiler](#zig-as-a-cross-compiler)
5. [Apple: Universal Binaries and Notarization](#apple-universal-binaries-and-notarization)
6. [Embedded and Firmware Pipelines](#embedded-and-firmware-pipelines)
7. [Supply Chain and Reproducibility of Cross-Builds](#supply-chain-and-reproducibility-of-cross-builds)
8. [War Stories](#war-stories)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Cross-compilation as a shipping discipline — release matrices, the native-dependency tax, platform-specific gauntlets (Apple, embedded), supply-chain integrity, and the failures that teach.**

At the professional level nobody asks "how do I cross-compile for ARM?" — that's settled. The questions are organizational and operational: *How do I ship six platforms on every tag without a flaky, 40-minute, occasionally-broken matrix? Why does one innocuous dependency turn our trivial Go release into a cross-toolchain nightmare, and how do we structurally prevent that? How do we get a Mac app past Apple's notarization? How do firmware teams cross-compile for chips with no OS and ship something that can't be patched in the field? And how do we prove our cross-built artifacts weren't tampered with?*

This page is the accumulated judgment: the patterns that keep a release matrix boring, the architectural choices that keep the CGO tax at zero, and the war stories that explain *why* seasoned engineers are dogmatic about "no CGO" and "smoke-test on real hardware."

---

## The Release Matrix as a System

A serious release is not one binary — it's a **matrix**: every (OS × arch) pair you support, each producing a signed, checksummed artifact. A typical CLI tool matrix:

```
linux/amd64    linux/arm64    linux/arm        (servers, Pi, embedded)
darwin/amd64   darwin/arm64                    (Intel + Apple Silicon Macs)
windows/amd64  windows/arm64                    (PCs, Surface)
```

The professional concern is making this matrix **fast, parallel, and trustworthy**. For a Go project, GoReleaser is the de-facto standard — declare the matrix once, it cross-compiles every cell on one Linux runner and produces archives, checksums, and signatures:

```yaml
# .goreleaser.yaml
builds:
  - env: [CGO_ENABLED=0]                 # the linchpin: pure Go → every cell cross-compiles trivially
    goos:   [linux, darwin, windows]
    goarch: [amd64, arm64]
    ignore:
      - {goos: windows, goarch: arm64}   # prune cells you don't support
checksum: {name_template: 'checksums.txt'}
```

One runner, `CGO_ENABLED=0`, every cell built in seconds. The matrix is *boring* — which is the goal.

Design principles for a sane matrix:

- **Build cells in parallel, fail independently.** A broken `windows/arm64` shouldn't block shipping `linux/amd64`. CI fan-out (matrix jobs) over sequential loops.
- **Minimize the cell count to what you actually support.** Every cell is build time, test surface, and a thing that can break. Prune aggressively; add cells only with a real user behind them.
- **Make cells reproducible and signed.** Each artifact gets a checksum and signature; the matrix emits a manifest. This is where cross-compilation meets supply chain (below).
- **Decide the toolchain story up front.** Pure-Go/static-Rust → one runner cross-compiles all. Native deps → you need per-platform runners or QEMU, and the matrix's cost balloons. *This single decision dominates matrix complexity.*

> **Key insight:** The cost and reliability of your release matrix is set almost entirely by **whether your artifacts cross-compile cleanly**. A pure-Go/static matrix is one fast runner and a YAML file. The instant a native (C) dependency enters, the matrix needs per-OS runners or emulation, gains a combinatorial test burden, and starts to flake. *The matrix's health is a downstream consequence of the dependency choices in section 3.*

---

## The CGO / Native-Dependency Tax — and How Teams Avoid It

The recurring villain of professional cross-compilation is the **native dependency**: any library that's actually C/C++ under the hood, pulled in via CGO (Go), a `-sys` crate (Rust), a native node-gyp module (Node), or a C extension (Python). Each one re-imposes C's cross-compile cost — a cross C toolchain *and* a target sysroot for *that library* — on what was an easy build.

The **tax** is concrete: a 5-line release config becomes a per-platform cross-toolchain maintenance project; the matrix needs native runners or QEMU; build time multiplies; and a single transitive dependency can break a platform you didn't even know you supported.

How teams structurally avoid it:

**1. Choose pure-language libraries deliberately.** The most effective move is upstream: pick the dependency that doesn't pull in C.
- Go: `modernc.org/sqlite` (pure Go) over `mattn/go-sqlite3` (CGO). Pure-Go DNS, crypto, image libs where they exist.
- A pure-language stack keeps `CGO_ENABLED=0` and the matrix trivial. This is a *real architectural constraint* many teams enforce in code review.

**2. Static musl when C is unavoidable.** If you must link C, link it *statically against musl* so the artifact is self-contained and the runtime libc question vanishes ([senior.md](senior.md)). Per-arch musl cross-toolchains in a container, or `cross` for Rust.

**3. Containerize the toolchain.** Don't make every developer install cross-toolchains. Bake the cross-toolchain + sysroots into a build image (or use `cross`, or Bazel hermetic toolchains — [05](../05-polyglot-hermetic-builds/senior.md)). The matrix runs that image; the toolchain is pinned and reproducible.

**4. `zig cc` as a drop-in cross C compiler** (next section) — increasingly the pragmatic escape hatch for CGO cross-builds.

**5. QEMU emulation as a last resort.** When true cross is too painful (gnarly autotools deps), build the C parts under QEMU. Accept the speed hit and the fidelity caveat ([senior.md](senior.md)); reserve real-hardware tests.

> **Key insight:** The CGO/native tax is not paid at the cross-compile command — it's paid in the *architecture* of your dependency tree, months earlier. The cheapest cross-compilation is the one you designed for by **refusing native dependencies** unless they earn their keep. "Is there a pure-Go/pure-Rust equivalent?" is a release-engineering question disguised as a library-choice question.

---

## Zig as a Cross-Compiler

A development worth knowing professionally: the **Zig** toolchain ships a `zig cc` subcommand that is a *drop-in C/C++ cross-compiler for almost any target, with sysroots bundled*. It's Clang underneath, but Zig packages the libc headers/sources (glibc *and* musl, multiple versions) so you don't assemble a sysroot yourself:

```bash
# Cross-compile C to arm64 glibc 2.28 — no sysroot setup, no apt install:
zig cc -target aarch64-linux-gnu.2.28 hello.c -o hello

# Use it as Go's CGO compiler to cross-compile a CGO program:
CGO_ENABLED=1 \
CC="zig cc -target aarch64-linux-musl" \
GOOS=linux GOARCH=arm64 \
go build .
```

The killer features: you pick the **glibc version** in the target string (`...gnu.2.28`) — directly solving the "build on old glibc" problem from [senior.md](senior.md) *without* an old base image — and one ~50 MB download cross-compiles to dozens of targets. Many teams adopted `zig cc` *purely* to make CGO cross-builds sane.

The caveats: it's young, some exotic targets or C++ corners have rough edges, and you're adding Zig as a build dependency. But for "I have one CGO dependency and a multi-platform matrix," `zig cc` often turns a multi-day toolchain project into a one-line `CC=`.

> **Key insight:** Zig's `zig cc` reframes the sysroot problem: instead of *sourcing* the target's libc, you ship a compiler that *already contains* every libc/version. It's the same "containerize the toolchain" instinct, compressed into a single portable binary — and it's the most practical answer to the CGO cross-compile tax available today.

---

## Apple: Universal Binaries and Notarization

macOS adds two wrinkles beyond the ordinary cross-compile.

**Universal (fat) binaries.** Since the Intel→Apple-Silicon transition, a Mac app should run on *both* `x86_64` and `arm64`. Apple's answer is a **universal binary**: one file containing *both* architectures' code, selected at launch. You build each arch, then merge with `lipo`:

```bash
clang -target x86_64-apple-macos11  -O2 main.c -o app_x64
clang -target arm64-apple-macos11   -O2 main.c -o app_arm
lipo -create -output app_universal app_x64 app_arm    # fat binary: both arches
lipo -info app_universal                               # → x86_64 arm64
```

Go can't emit a fat binary directly (it builds one arch per invocation), so Go projects build both and `lipo` them, or ship two separate binaries. This is a distinct concept from everything prior: not "pick a target," but "embed *multiple* targets in one artifact."

**Code signing and notarization.** Apple won't *run* an unsigned/unnotarized binary downloaded from the internet (Gatekeeper blocks it). The cross-build isn't done until it's signed and notarized — which **requires macOS tooling** (`codesign`, `notarytool`) and an Apple Developer certificate. You cannot fully produce a shippable Mac artifact on a Linux CI runner; the matrix needs a **macOS runner** for the sign/notarize step:

```bash
codesign --sign "Developer ID Application: ..." --options runtime app_universal
xcrun notarytool submit app.zip --apple-id ... --wait    # Apple scans it
xcrun stapler staple app.app                              # attach the notarization ticket
```

> **Key insight:** Apple breaks the "one Linux runner cross-compiles everything" dream twice: a shippable Mac binary should be **universal** (two arches in one file via `lipo`), and it *must* be **signed and notarized** on macOS hardware/tooling. Plan a macOS runner into the matrix specifically for these steps — cross-compilation gets you the code, but Apple's gatekeeping is a host-bound, platform-specific gate you can't cross around.

---

## Embedded and Firmware Pipelines

Embedded cross-compilation is the discipline at its most extreme: the target often has **no OS** (`...-none-eabi`), kilobytes of RAM, no filesystem, and — critically — **may be unpatchable in the field**. The pipeline reflects the stakes:

- **Bare-metal triples and freestanding builds.** `thumbv7em-none-eabi`, `riscv32imac-unknown-none-elf`. No libc you'd recognize (often `newlib` or none), `-ffreestanding`, a custom **linker script** placing code/data into the chip's exact memory map. The "sysroot" is a vendor SDK.
- **The build produces a firmware image, not an executable.** Cross-compile → link with a memory-map linker script → `objcopy` to a raw binary / Intel HEX → flash via JTAG/SWD or a bootloader. The artifact is an *image burned into flash*, not a file the OS loads.
- **Hardware-in-the-loop (HIL) testing is mandatory, not optional.** Because QEMU can't model the real peripherals, timing, and analog behavior, and because a bad firmware can **brick a shipped device**, embedded teams run tests on *racks of real target boards* in CI. The "test what you can't natively run" problem from [senior.md](senior.md) is here answered almost entirely by *real hardware*, because the cost of a field failure is a truck roll or a recall.
- **Reproducibility and provenance are safety/regulatory requirements.** In automotive/medical/aerospace, you must prove *exactly* which toolchain and sources produced the firmware on a device (functional-safety standards). Cross-build reproducibility ([09](../09-reproducible-builds/senior.md)) stops being nice-to-have and becomes auditable evidence.

> **Key insight:** Embedded flips the confidence economics. For a server binary, real-hardware testing is an expensive backstop; for firmware, it's the *primary* gate, because the target can't be patched and a bad flash can brick the device or harm someone. The whole pipeline — freestanding cross-build, memory-map linking, image flashing, HIL test farms, auditable reproducibility — is built around "we get one shot, and it must be provable."

---

## Supply Chain and Reproducibility of Cross-Builds

Cross-compilation widens the supply-chain attack surface, because you're now trusting *more* moving parts that the consumer can't easily inspect: the cross-toolchain, every sysroot, and N output artifacts the user can't natively run to sanity-check.

Professional practice:

- **Pin every toolchain and sysroot by content hash/digest.** A poisoned cross-compiler or sysroot compromises *every* artifact it builds. Pin the build image by digest; use hermetic toolchains (Bazel/Nix) where stakes are high ([05](../05-polyglot-hermetic-builds/senior.md)).
- **Reproducible cross-builds enable verification.** If the build is bit-reproducible and host-independent ([09](../09-reproducible-builds/senior.md)), independent parties can rebuild from source and confirm the published artifact matches — the only way to *verify* a binary you can't easily run. This is the foundation of trustworthy releases.
- **Sign artifacts and emit provenance.** Each matrix cell gets a signature (Sigstore/cosign) and **SLSA provenance** attesting which builder, sources, and toolchain produced it. The consumer verifies the chain without trusting your CI by faith.
- **SBOMs per artifact.** A cross-built binary's bill of materials (which library versions, which libc) lets downstream security tooling assess it even though they can't run it.

> **Key insight:** You can't `./run-and-inspect` a binary built for an arch you don't have — so for cross-built artifacts, **trust must come from the build process, not the artifact**. Reproducibility (rebuild-and-compare), pinned hermetic toolchains, signatures, and provenance are how you make a binary trustworthy when the consumer can neither run it nor read it. Cross-compilation makes supply-chain rigor *more* essential, not less.

---

## War Stories

**1. The CGO dependency that blew up the release matrix.** A Go service shipped fine for years: `CGO_ENABLED=0`, one runner, six platforms, seconds per build. Someone added a metrics library that transitively pulled in a CGO dependency. The next release: `linux/amd64` still built, but `linux/arm64`, all `darwin`, and `windows` failed with cryptic gcc errors. The "two-line dependency bump" turned a 30-second matrix into a week of assembling cross-toolchains and sysroots per platform. The fix that stuck wasn't more toolchains — it was *replacing the dependency with a pure-Go equivalent* and adding a CI check that fails the build if `CGO_ENABLED=0 go build` stops working. **Lesson:** guard `CGO_ENABLED=0` in CI so a transitive C dependency can never silently re-impose the tax.

**2. The QEMU build that passed but the native run crashed.** A multi-arch image built `linux/arm64` under QEMU emulation in buildx. Unit tests ran (under QEMU) green. Shipped to ARM (Graviton) production: instant crash on startup. Cause: code that detected CPU features at runtime hit a path QEMU emulated permissively but real hardware executed differently (an unsupported instruction under a feature QEMU reported as present). QEMU emulated the *ISA loosely*; the real CPU did not. **Lesson:** QEMU-green is not hardware-proven; the team added one real-arm64 smoke-test runner before any multi-arch release.

**3. The `-march=native` that shipped illegal instructions.** A C++ service's Dockerfile compiled with `-march=native` for "performance." The build ran on modern AVX-512 CI hardware; the binary used AVX-512 instructions. Deployed to older production CPUs without AVX-512: `SIGILL` (illegal instruction) on first hot-path call. The build host's CPU had leaked into the artifact. **Lesson:** never `-march=native` for anything that ships; specify the *baseline* target arch explicitly. (This is a same-arch cousin of cross-compilation: the *effective* target differed from the build host.)

**4. The macOS notarization that blocked the launch.** A team cross-compiled their Mac binary on Linux, shipped it, and users got "cannot be opened because the developer cannot be verified." They'd produced the *code* but never signed/notarized it — a step that *requires* macOS tooling they hadn't put in the matrix. The launch slipped while they stood up a macOS runner. **Lesson:** for Mac, "cross-compiled" ≠ "shippable"; budget a macOS sign/notarize stage from day one.

---

## Mental Models

- **The matrix's health is decided by your dependency tree, not your CI YAML.** Pure-language artifacts → one fast runner, boring matrix. One native dependency → per-platform runners, QEMU, flakiness. Engineer the dependencies and the matrix takes care of itself.

- **The native-dependency tax is paid upstream, in design.** By the time `go build` fails for arm64, the mistake (choosing a CGO library) was made months ago in code review. The cheapest cross-build is the one whose dependencies were chosen to be portable.

- **Cross-compilation gets you the code; platform gatekeepers get the final word.** Apple wants universal + notarized on macOS hardware; embedded wants HIL-tested firmware. Some final steps are *host-bound by policy or physics* and can't be cross-compiled around. Plan runners/hardware for them.

- **For artifacts you can't run, trust is a property of the build, not the binary.** Reproducibility, hermetic pinned toolchains, signatures, and provenance replace "I ran it and it worked." Cross-compilation makes this rigor mandatory.

---

## Common Mistakes

1. **No CI guard on `CGO_ENABLED=0`.** A transitive C dependency silently re-enables CGO and detonates the matrix on the next release. Add an explicit `CGO_ENABLED=0 go build` check (or equivalent) that fails fast.

2. **Treating the release matrix as an afterthought.** Bolting six platforms on at the end, sequentially, with hand-rolled scripts. Use GoReleaser / a matrix CI fan-out / cargo-dist; design it early; prune cells to what you support.

3. **Shipping `-march=native` (or omitting the target `-march`).** Bakes the build host's CPU into the artifact → `SIGILL` on older target CPUs. Specify the baseline target arch explicitly.

4. **Forgetting macOS is special.** Universal binaries need `lipo`; shipping needs signing + notarization on macOS tooling. Cross-compiling on Linux gets you neither. Budget a macOS runner.

5. **Trusting QEMU as the only gate for a release.** Emulation fidelity is imperfect; ship-critical arches need at least a real-hardware smoke test. (See war story 2.)

6. **Unpinned, unsigned cross-build toolchains.** A floating cross-toolchain or sysroot is a supply-chain hole and a reproducibility hole. Pin by digest; sign artifacts; emit provenance.

---

## Test Yourself

1. Why does adding one CGO-using dependency to a previously pure-Go project blow up a six-platform release matrix? What CI guard prevents the regression?
2. List four structural ways teams keep the native-dependency tax at (or near) zero, strongest first.
3. What problem does `zig cc -target aarch64-linux-gnu.2.28` solve that a distro cross-gcc + sysroot makes painful?
4. What two macOS-specific steps mean "cross-compiled the code" is not "shippable Mac artifact," and which one forces a macOS runner into your matrix?
5. Why is real-hardware (HIL) testing the *primary* gate in firmware pipelines, whereas it's a backstop for server binaries?
6. You can't natively run your cross-built ARM artifacts. How do you make them *trustworthy* to a consumer who also can't run them? Name three mechanisms.

<details>
<summary>Answers</summary>

1. CGO turns the build into a C build, so each non-native cell now needs a cross C toolchain + target sysroot; cells that built in seconds via pure-Go cross-compilation start failing. Guard: a CI step that runs `CGO_ENABLED=0 go build ./...` and fails if it breaks, so any new C dependency is caught immediately.
2. (a) Choose pure-language libraries (pure-Go/pure-Rust) so `CGO_ENABLED=0` holds; (b) when C is unavoidable, static-link against musl so the artifact is self-contained; (c) containerize/pin the cross-toolchain + sysroots (or use `cross`/Bazel hermetic toolchains) so it's reproducible and not per-dev setup; (d) use `zig cc` as a drop-in cross C compiler; (QEMU emulation is the last resort).
3. It lets you pick the exact **glibc version** in the target string, solving glibc's forward-compat "build on old glibc" problem without an old base image, and bundles the libc/headers so you don't assemble a sysroot per target. One portable compiler cross-compiles to many targets.
4. Building a **universal binary** (merge x86_64 + arm64 with `lipo`) and **code signing + notarization**. Notarization requires Apple tooling (`codesign`/`notarytool`) and a Developer cert on macOS — forcing a macOS runner into the matrix.
5. Firmware targets often can't be patched in the field and a bad flash can brick the device or cause physical harm, and QEMU can't model real peripherals/timing/analog behavior — so real hardware is the only valid proof and the cost of failure is enormous. Server binaries can be redeployed cheaply, so hardware testing is a periodic backstop rather than the gate.
6. (a) Reproducible, host-independent builds so independent parties can rebuild from source and confirm the artifact matches; (b) pinned hermetic toolchains/sysroots (by digest) so the build process itself is trustworthy; (c) signatures (cosign/Sigstore) + SLSA provenance (and SBOMs) attesting builder, sources, and toolchain. Trust comes from the build process, not from running the binary.

</details>

---

## Cheat Sheet

```
RELEASE MATRIX
  goal: fast, parallel, independent cells, signed + checksummed
  GoReleaser (Go) / cargo-dist (Rust): declare matrix once, one runner cross-builds all
  cell count = build time + test surface + breakage → prune to what you SUPPORT
  matrix health ≈ f(dependency tree), NOT f(CI yaml)

CGO / NATIVE-DEP TAX — escape, strongest first
  1. pure-language libs (modernc.org/sqlite over go-sqlite3) → keep CGO_ENABLED=0
  2. static musl when C is unavoidable
  3. containerize/pin the cross-toolchain (cross, Bazel, build image)
  4. zig cc as drop-in cross C compiler
  5. QEMU emulation (last resort)
  GUARD:  CI step `CGO_ENABLED=0 go build ./...` fails if a C dep sneaks in

ZIG CC (the pragmatic escape)
  zig cc -target aarch64-linux-gnu.2.28 main.c       # pick glibc version!
  CC="zig cc -target aarch64-linux-musl" CGO_ENABLED=1 GOOS=linux GOARCH=arm64 go build .

APPLE
  universal binary:  lipo -create -output app x64_build arm_build
  shippable needs:   codesign + notarytool + stapler  → REQUIRES a macOS runner

EMBEDDED / FIRMWARE
  triple ...-none-eabi (no OS) ; linker script for memory map ; objcopy → image ; flash
  HIL (real hardware) testing = PRIMARY gate (unpatchable, can brick)
  reproducibility = auditable safety/regulatory evidence

SUPPLY CHAIN (for artifacts you can't run)
  pin toolchain+sysroot by digest ; reproducible+host-independent build ;
  sign (cosign/Sigstore) ; SLSA provenance ; per-artifact SBOM
  → trust the BUILD, not the binary

WAR-STORY REFLEXES
  guard CGO_ENABLED=0   |   QEMU-green ≠ hardware-proven   |
  never ship -march=native   |   mac: cross ≠ shippable (notarize)
```

---

## Summary

- A release is a **matrix** of (OS × arch) cells. Its speed and reliability are decided almost entirely by whether your artifacts **cross-compile cleanly** — pure-Go/static-Rust is one fast runner and a YAML file; native dependencies force per-platform runners or QEMU and combinatorial flakiness.
- The **CGO / native-dependency tax** re-imposes C's cross-compile cost on any language that links C. Teams keep it near zero by **choosing pure-language libraries**, **static musl** when C is unavoidable, **containerized/pinned toolchains**, **`zig cc`**, and QEMU as a last resort — and by **guarding `CGO_ENABLED=0` in CI**.
- **`zig cc`** is the modern pragmatic cross C compiler: bundled multi-version libcs, glibc-version selection in the target string, one portable binary for dozens of targets.
- **Apple** breaks the single-runner dream twice: shippable Mac artifacts should be **universal** (`lipo` two arches) and **must be signed + notarized on macOS** — plan a macOS runner.
- **Embedded/firmware** is cross-compilation at the extreme: bare-metal triples, memory-map linker scripts, flashed images, and **real-hardware (HIL) testing as the primary gate** because the target is unpatchable and failure is catastrophic; reproducibility becomes auditable evidence.
- For artifacts you **can't run**, trust is a property of the **build, not the binary**: reproducible host-independent builds, pinned hermetic toolchains, signatures, and provenance.
- The **war stories** all rhyme: a hidden CGO dependency, a QEMU pass that wasn't hardware truth, a `-march=native` that shipped illegal instructions, an unnotarized Mac binary. The reflexes — guard CGO, smoke-test on hardware, pin the target arch, budget the notarize step — are earned, not invented.

[interview.md](interview.md) consolidates all four tiers into a question bank with model answers and design scenarios (including "design a CI release matrix for six platforms").

---

## Further Reading

- [GoReleaser](https://goreleaser.com/) and [cargo-dist](https://opensource.axo.dev/cargo-dist/) — declarative release matrices done right.
- [`zig cc` as a cross-compiler](https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html) — Andrew Kelley's canonical write-up.
- [Apple — Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and `man lipo` — universal binaries and Gatekeeper.
- [SLSA framework](https://slsa.dev/) and [Sigstore/cosign](https://www.sigstore.dev/) — provenance and signing for build artifacts.

---

## Related Topics

- [05 — Polyglot & Hermetic Builds › senior](../05-polyglot-hermetic-builds/senior.md) — pinned hermetic cross-toolchains, the rigorous foundation for trustworthy matrices.
- [09 — Reproducible Builds › senior](../09-reproducible-builds/senior.md) — reproducible, host-independent cross-builds as the basis of verifiable artifacts.
- [04 — Per-Language Tools › middle](../04-per-language-tools/middle.md) — the language toolchains the matrix orchestrates.
- [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — the linking/ABI/libc substrate behind the CGO tax and static-musl escape.
- [interview.md](interview.md) — the consolidated question bank and design scenarios.
