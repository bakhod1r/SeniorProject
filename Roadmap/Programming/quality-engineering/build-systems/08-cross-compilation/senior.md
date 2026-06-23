# Cross-Compilation — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Cross-Compilation
> *The middle page defined the toolchain and sysroot. This page is where they bite: CMake toolchain files, the glibc/musl ABI fork, the QEMU-emulation shortcut and its lies, multi-arch container images, and the hardest question of all — how do you test a binary you physically cannot run?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [C/C++ Cross-Toolchains in Practice](#cc-cross-toolchains-in-practice)
4. [CMake Toolchain Files](#cmake-toolchain-files)
5. [glibc vs musl and the ABI Question](#glibc-vs-musl-and-the-abi-question)
6. [QEMU User-Mode Emulation vs True Cross-Compile](#qemu-user-mode-emulation-vs-true-cross-compile)
7. [Multi-Arch Container Images with buildx](#multi-arch-container-images-with-buildx)
8. [Reproducibility Across Host and Target](#reproducibility-across-host-and-target)
9. [Testing Artifacts You Can't Natively Run](#testing-artifacts-you-cant-natively-run)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The two execution models (true cross vs emulation), their correctness/speed trade-off, and integrating cross-builds into CMake, containers, and CI.**

By the senior level the vocabulary is settled; the questions are now operational. *How do I wire a sysroot into a real CMake build without hand-editing flags? Should I cross-compile or emulate the target with QEMU — and what does each one quietly get wrong? How do multi-arch Docker images actually get built? And the question that separates teams who ship reliably from teams who ship and pray: how do I gain confidence in a binary my CI machine cannot execute?*

There are two fundamentally different ways to produce a target binary on a non-target host: **true cross-compilation** (a host toolchain emits target code) and **emulation** (you run a real target build/test under an emulator like QEMU). They have opposite trade-offs — speed vs fidelity — and senior engineers choose deliberately, often using both. This page is about that choice and the machinery around it.

---

## Prerequisites

- **Required:** You've read [middle.md](middle.md) — triple, build/host/target, cross-toolchain, sysroot, `CGO_ENABLED`, static/musl.
- **Required:** You've read [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — the ABI, glibc, dynamic vs static linking, symbol versioning.
- **Helpful:** You've used CMake and Docker, and have seen `docker buildx` or `--platform` in the wild.
- **Helpful:** You know roughly what an emulator is (QEMU, Rosetta).

---

## C/C++ Cross-Toolchains in Practice

A real C/C++ cross-build wires together four things: the cross compiler/linker, the sysroot, the right architecture flags, and the build system's awareness of all three. Doing it by hand for one file:

```bash
aarch64-linux-gnu-gcc \
  --sysroot=/opt/aarch64-sysroot \   # target headers + libs
  -march=armv8-a \                   # which ARM revision (codegen)
  -O2 \
  main.c -lssl -lcrypto \            # resolved against the sysroot's libs
  -o app
```

This is fine for a toy. Real projects have hundreds of files, generated headers, and conditional compilation, so you never pass these flags by hand — you teach the *build system* about the target once. The mechanism differs per build tool:

- **Autotools:** `./configure --host=aarch64-linux-gnu CC=aarch64-linux-gnu-gcc --with-sysroot=...` then `make`.
- **CMake:** a **toolchain file** (next section) — the cleanest, most portable mechanism.
- **Meson:** a `--cross-file` describing the toolchain binaries and target properties.
- **Bazel:** registered C++ toolchains + `--platforms=//:aarch64` — fully hermetic, the gold standard for big polyglot repos ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md)).

The recurring failure isn't the compiler — it's the sysroot. The compiler resolves `<openssl/ssl.h>` and `-lssl` *inside the sysroot*. If OpenSSL isn't in the sysroot built for the target, you're stuck building OpenSSL for the target first — and *its* dependencies — a dependency-of-dependencies problem that is why people reach for containerized toolchains (`cross`, Zig, Bazel) or QEMU.

---

## CMake Toolchain Files

CMake's answer to cross-compilation is a **toolchain file**: a small script that tells CMake what target it's building for, before any project configuration runs. You pass it once with `-DCMAKE_TOOLCHAIN_FILE`.

```cmake
# aarch64-linux.cmake
set(CMAKE_SYSTEM_NAME      Linux)        # → CMAKE_CROSSCOMPILING becomes TRUE
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(CMAKE_C_COMPILER   aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)

set(CMAKE_SYSROOT      /opt/aarch64-sysroot)

# Search for HEADERS/LIBS only in the sysroot, but PROGRAMS on the host:
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)   # tools (e.g. protoc) run on the HOST
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)    # libs come from the TARGET sysroot
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)    # headers come from the TARGET sysroot
```

```bash
cmake -B build -DCMAKE_TOOLCHAIN_FILE=aarch64-linux.cmake
cmake --build build
```

The non-obvious lines are the `CMAKE_FIND_ROOT_PATH_MODE_*` triplet, and they encode the single most important cross-compile subtlety in any build system:

> **Key insight:** A cross build runs **two kinds of programs at two different times**. *Build tools* (code generators like `protoc`, `moc`, `bison`; anything executed *during* the build) must be **host** binaries — they run *now*, on the build machine. The things they help produce — libraries, the final executable — must be **target** binaries. Mix these up and you get the classic disaster: the build compiles a code-generator *for the target*, then tries to *run* it on the host and gets `Exec format error` mid-build. `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER` (find programs on the host) vs `..._LIBRARY ONLY` (find libraries in the sysroot) is exactly this host-tool/target-artifact split, made explicit.

This host-tool-vs-target-artifact distinction is *the* recurring senior-level gotcha across every build system: autotools' `BUILD_CC` vs `CC`, Bazel's exec platform vs target platform, Go's `go generate` (host) vs `go build` (target). Internalize it and most cross-build mysteries dissolve.

---

## glibc vs musl and the ABI Question

The middle page flagged the libc/ABI field of the triple as "the silent one." Here's why it dominates senior-level decisions.

**glibc** is the default Linux C library: feature-rich, fast, and the runtime ABI almost every prebuilt Linux binary expects. But glibc uses **symbol versioning** ([01 › middle](../01-build-fundamentals/middle.md)) and is **forward-, not backward-, compatible**: a binary linked against glibc 2.34 needs glibc ≥ 2.34 at runtime. Build on a modern host, deploy to an older target, and you get the infamous:

```
./app: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found (required by ./app)
```

This is a *cross-compile-adjacent* trap even when arch matches: your build host's glibc is newer than the target's. The fix is to build against the **oldest glibc you must support** — which is why release pipelines build inside an *old* base image (the `manylinux` standard for Python wheels exists entirely for this), not the newest one.

**musl** sidesteps the whole problem: it's small, designed for **full static linking**, and has no symbol-versioning forward-compat trap. A musl-static binary depends on nothing but the kernel syscall ABI (extraordinarily stable). The costs: musl is slower at a few things (allocator, some locale/DNS behaviors differ), and glibc-only assumptions in third-party code can break.

| | glibc | musl |
|---|---|---|
| Default on | Debian, Ubuntu, RHEL | Alpine |
| Static linking | Problematic (NSS, warnings) | Clean, the design goal |
| Compatibility trap | Forward-only; newest-host bites you | None (static); runs anywhere of arch |
| Performance | Generally faster | Smaller; some paths slower |
| Best for | Native/dynamic deploys | Portable static cross-built binaries |

> **Key insight:** "Which arch?" is the obvious cross-compile axis. "Which libc, and which *version* of it?" is the one that silently breaks production. The senior reflex: for dynamically-linked glibc artifacts, **build against the oldest supported glibc** (old base image); for maximum portability, **target musl and link statically** so the libc question disappears entirely.

---

## QEMU User-Mode Emulation vs True Cross-Compile

There's a second way to get a target binary built and tested without owning the target hardware: **emulate** the target on the host. QEMU has a **user-mode** mode (`qemu-aarch64`, `qemu-arm`, …) that runs a *single target binary* on your host by translating its instructions, transparently — no full VM, no target kernel. With `binfmt_misc` registered (Docker Desktop and `tonistiigi/binfmt` do this for you), the host can *execute target binaries directly*:

```bash
# Register QEMU handlers for foreign architectures (one-time, privileged):
docker run --privileged --rm tonistiigi/binfmt --install all

# Now an aarch64 binary "just runs" on an x86 host — QEMU intercepts and emulates it:
./app-aarch64          # transparently executed under qemu-aarch64
```

This unlocks two things true cross-compilation cannot: you can **run the target's native toolchain** (build *inside* an emulated arm64 environment, sidestepping sysroot hell entirely), and you can **execute the target binary's tests** on the host.

The catch is the trade-off that defines this whole choice:

| | True cross-compile | QEMU emulation |
|---|---|---|
| Speed | **Fast** (native host codegen) | **Slow** (5–30× slower; instruction translation) |
| Toolchain setup | Cross-toolchain + sysroot (painful) | Use the target's *native* toolchain (easy) |
| Can run tests? | No (output isn't host-runnable) | **Yes** (binary runs under QEMU) |
| Fidelity | High (real target codegen) | **Imperfect** — emulates the ISA, *not* the exact target |
| Best for | Producing release artifacts fast | Building awkward deps, running tests |

> **Key insight — the dangerous part:** QEMU user-mode emulates the **instruction set**, not the **whole machine**. It runs your *host's* kernel, can mishandle some syscalls, threading, signals, timing, and CPU-feature detection, and silently differs from real hardware on edge cases. So **"it passed under QEMU" is not "it works on the device."** A build that emulates successfully can crash on real hardware (a war story in [professional.md](professional.md)). Use QEMU for *convenience and broad test coverage*, but validate release-critical paths on real target hardware. The correctness/speed trade-off is real and asymmetric: emulation is slower *and* less faithful — its only wins are setup ease and the ability to execute.

A pragmatic senior pattern: **true-cross-compile the release artifact** (fast, faithful codegen) but **run the test suite under QEMU** (so you at least exercise the target binary), then **smoke-test on one real device** before shipping.

---

## Multi-Arch Container Images with buildx

Modern deployment usually means a container image that runs on both `linux/amd64` (most cloud) and `linux/arm64` (Apple Silicon dev machines, Graviton, Ampere). A **multi-arch image** is a *manifest list* pointing at one image per architecture; the runtime auto-selects the right one. `docker buildx` builds them:

```bash
docker buildx create --use                      # a builder that supports multi-platform
docker buildx build \
  --platform linux/amd64,linux/arm64 \           # build BOTH arches
  -t registry.example.com/app:1.2.3 \
  --push .                                        # push as a single multi-arch manifest
```

Under the hood, buildx has two strategies to produce each arch — and they're exactly the two from the previous section:

1. **Emulation (default, zero-config):** each non-native stage runs under QEMU/binfmt. Simple, slow, and any `RUN` step that compiles code does so under emulation — correct but potentially 10× slower and subject to QEMU's fidelity caveats.
2. **Cross-compilation (fast, more work):** use the Dockerfile's `--platform=$BUILDPLATFORM` build args (`TARGETARCH`, `TARGETOS`) to run a *native* build that cross-compiles, so the heavy compile happens at host speed:

```dockerfile
# Build stage runs on the NATIVE builder arch; cross-compiles to the target.
FROM --platform=$BUILDPLATFORM golang:1.22 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /app .

FROM alpine
COPY --from=build /app /app                       # the lean, per-arch final image
ENTRYPOINT ["/app"]
```

This pattern — native build stage + `GOOS/GOARCH` from buildx's target args — gives multi-arch images at near-native speed *because Go cross-compiles trivially*. For C-heavy images, teams fall back to QEMU emulation or maintain cross-toolchains in the build stage.

> **Key insight:** A multi-arch image is just *N* single-arch builds under one manifest, and each one is the same true-cross-vs-emulate decision. Languages that cross-compile cleanly (Go, Rust) let you choose the **fast cross** path in a Dockerfile (`$TARGETARCH` + `GOARCH`); C-heavy images often default to the **slow QEMU** path. The choice of language echoes all the way up to your container build time.

---

## Reproducibility Across Host and Target

Cross-compilation and reproducibility ([09 — Reproducible Builds](../09-reproducible-builds/senior.md)) intersect sharply: a cross-build's output must depend on the **target and the pinned toolchain**, *not* on incidental properties of the **host**. Three host-leakage hazards:

1. **Toolchain version drift.** Two CI hosts with slightly different cross-gcc or sysroot versions produce different binaries for the same source. Pin the *exact* toolchain + sysroot (container digest, Bazel toolchain, Nix derivation) so host = irrelevant.
2. **Embedded host paths/timestamps.** Builds that bake in `__FILE__` absolute paths, build dirs, or `__DATE__` make output host- and time-dependent. Mitigate with `-ffile-prefix-map`, `SOURCE_DATE_EPOCH`, and `-Wdate-time`.
3. **Host-arch leakage in codegen.** `-march=native` is poison in a cross-build — it tunes for the *host's* CPU, not the target's. Always specify the *target's* `-march`/`-mcpu` explicitly.

> **Key insight:** The reproducibility goal for a cross-build is *host-independence*: given the same source, target triple, and pinned toolchain, **any** host must emit the **same** bytes. That's only achievable if the toolchain and sysroot are pinned by content (digest/hash), and if you've scrubbed host paths, timestamps, and `-march=native` from the build. Cross-compilation makes reproducibility *harder* (more inputs vary) and *more valuable* (you can't easily re-run on the target to compare).

---

## Testing Artifacts You Can't Natively Run

The hardest operational problem: your CI host is x86 Linux, your artifact is an ARM (or Windows, or bare-metal) binary it cannot execute. How do you gain confidence? A layered strategy, weakest to strongest:

1. **Static verification (no execution).** `file app` (right format/arch?), `readelf -h` / `objdump -f` (entry point, machine type), `ldd`-equivalent inspection of the *target* binary's needed libs (`readelf -d`), symbol checks. Catches wrong-arch, wrong-libc, unexpected dynamic deps — without running anything.
2. **Emulated execution (QEMU).** Run the binary and its unit/integration tests under `qemu-<arch>`. Catches most logic bugs and obvious crashes. *Remember the fidelity caveat:* passing here ≠ working on hardware.
3. **Self-test binaries.** Cross-compile a tiny "does the runtime even come up?" program (prints a banner, exercises threads/TLS/atomics) and run it under emulation and on hardware. Cheap canary for ABI/runtime-init problems.
4. **Real-hardware CI.** A device farm, a physical board on a CI runner, or cloud instances of the target arch (AWS Graviton for arm64, etc.). The only thing that proves real-hardware behavior, especially for timing, CPU features, and syscalls QEMU fakes.
5. **Production canary.** Ship to a small slice of real target machines and watch. The ultimate test, used as a *backstop*, never as the primary gate.

The senior judgment call is *where to draw the confidence line* given cost: most teams run (1)+(2) on every commit and (4) on a periodic/pre-release basis, because real-hardware CI is expensive and slow. Embedded teams that *can't* tolerate a field failure invest heavily in (4) hardware-in-the-loop.

> **Key insight:** When you can't run the artifact natively, **confidence is a budget you allocate across layers**, not a single gate. Static checks are free and catch whole classes of error (wrong arch/libc) instantly — run them always. Emulation is cheap coverage with a fidelity asterisk. Real hardware is the only ground truth and the most expensive, so reserve it for what emulation can't validate. Never let "it cross-compiled" or "QEMU passed" masquerade as "it works on the target."

---

## Mental Models

- **True cross vs QEMU = fast-but-can't-run vs slow-but-runs.** Cross-compilation produces target bytes at host speed but you can't execute them locally. Emulation lets you execute (and test) but pays 5–30× speed *and* sacrifices fidelity. Pick per task; mature pipelines use both.

- **The host-tool / target-artifact split is the master gotcha.** Anything that *runs during the build* (code generators) must be a host binary; anything that *ships* must be a target binary. Every cross-aware build system has a knob for this (`CMAKE_FIND_ROOT_PATH_MODE_PROGRAM`, autotools `BUILD_CC`, Bazel exec vs target platform). Most mid-build `Exec format error`s are a violation of it.

- **The libc is a second target axis.** Choosing the arch is half the target; choosing glibc-version vs musl is the other half. glibc's forward-only compat means "build on the oldest you support"; musl-static means "the question disappears." Ignoring this axis is how arch-correct binaries still fail in production.

- **QEMU emulates the ISA, not the machine.** It's a translator of instructions running on your kernel — not a faithful replica of the target's kernel, CPU features, or timing. Treat green QEMU as "probably fine," never "proven on hardware."

---

## Common Mistakes

1. **Running a target-built code generator during the build.** The cross-build compiles `protoc`/`bison`/a custom tool *for the target*, then executes it on the host → `Exec format error` mid-build. Build host tools for the host; only ship-artifacts for the target.

2. **`-march=native` in a cross-build.** Tunes codegen for the *host* CPU; produces a binary that may use instructions the target lacks (illegal-instruction crash) and destroys reproducibility. Specify the target's `-march` explicitly.

3. **Building glibc artifacts on the newest host.** Links against a new `GLIBC_x.y`; fails on older targets with `version ... not found`. Build inside an old base image (manylinux-style) or target musl.

4. **Trusting QEMU as proof of hardware correctness.** Emulation fakes syscalls/timing/CPU features. A build that passes under QEMU can crash on the device. Smoke-test on real hardware for release-critical paths.

5. **Forgetting `CMAKE_FIND_ROOT_PATH_MODE_*` (or the Meson cross-file equivalent).** Without it, CMake's `find_library`/`find_package` may pick up *host* libraries, silently linking the wrong arch and failing late or weirdly.

6. **Letting buildx emulate the whole C build under QEMU and wondering why CI takes 40 minutes.** For languages that cross-compile (Go/Rust), use `$BUILDPLATFORM` + `$TARGETARCH` to do a native cross-build instead of emulating every compile.

---

## Test Yourself

1. In a CMake toolchain file, why do you set `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER` but `..._LIBRARY ONLY`? What disaster does this prevent?
2. Your service builds and runs on your modern Ubuntu CI host, but fails on the production box with `GLIBC_2.34 not found`. Arch matches. Diagnose and give two fixes.
3. Contrast true cross-compilation and QEMU user-mode emulation on speed, fidelity, setup effort, and ability to run tests. When would you use each?
4. Why is "the build passed under QEMU" *not* equivalent to "it works on the target device"? Name two concrete things QEMU user-mode can get wrong.
5. A `docker buildx --platform linux/amd64,linux/arm64` build of a Go service takes 35 minutes because each arch builds under emulation. How do you make it near-native fast?
6. You cannot execute your ARM artifact on the x86 CI host. List, weakest to strongest, the layers of confidence you can still obtain, and which you'd run on every commit.

<details>
<summary>Answers</summary>

1. *Programs* found during configure/build (code generators) must run on the **host** *now*, so search the host (`PROGRAM NEVER` = don't restrict to sysroot). *Libraries* must be the **target's**, so search only the sysroot (`LIBRARY ONLY`). It prevents building a generator for the target and then failing to execute it on the host (`Exec format error`), and prevents linking host-arch libraries.
2. The CI host's glibc is newer than the target's; the binary links a `GLIBC_2.34` symbol the old target lacks (glibc is forward-, not backward-compatible). Fixes: (a) build inside an *old* base image with the oldest glibc you support (manylinux-style), or (b) target musl and link statically so there's no glibc dependency.
3. True cross: fast (native codegen), high fidelity, painful setup (cross-toolchain + sysroot), **cannot** run the output locally. QEMU: slow (5–30×), imperfect fidelity (emulates ISA not the machine), easy setup (use target's native toolchain), **can** run tests. Use true-cross to produce release artifacts quickly; use QEMU to build awkward C deps and to execute the test suite.
4. QEMU user-mode emulates the *instruction set* but runs on the *host kernel*; it can mishandle certain syscalls, signals, threading, timing, and CPU-feature detection, and isn't a faithful replica of the target's kernel/CPU. So real hardware can crash where QEMU passed. Examples: a syscall QEMU stubs/misimplements; CPU-feature detection or timing-dependent code behaving differently.
5. Use a `FROM --platform=$BUILDPLATFORM` build stage and pass buildx's `TARGETOS`/`TARGETARCH` into `GOOS`/`GOARCH` so the compile runs natively on the builder and *cross-compiles* to each target, instead of emulating the compile under QEMU.
6. (1) Static verification (`file`, `readelf`, symbol/dep checks) — no execution; (2) emulated execution + tests under QEMU; (3) tiny self-test/canary binaries; (4) real-hardware CI (device farm / Graviton); (5) production canary. Run (1) and (2) on every commit; reserve (4)/(5) for pre-release because hardware CI is slow/expensive.

</details>

---

## Cheat Sheet

```
C/C++ CROSS, BY HAND
  aarch64-linux-gnu-gcc --sysroot=/opt/sys -march=armv8-a main.c -lssl -o app

CMAKE TOOLCHAIN FILE (the key lines)
  set(CMAKE_SYSTEM_NAME Linux)            # → CMAKE_CROSSCOMPILING = TRUE
  set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
  set(CMAKE_SYSROOT /opt/aarch64-sysroot)
  set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)  # host tools run NOW
  set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)   # target libs from sysroot
  set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
  cmake -B build -DCMAKE_TOOLCHAIN_FILE=aarch64-linux.cmake

HOST-TOOL vs TARGET-ARTIFACT (the master gotcha)
  runs DURING build (codegen) → HOST binary
  ships as output             → TARGET binary
  violating it → "Exec format error" mid-build

LIBC AXIS
  glibc: forward-compat only → build on OLDEST supported (manylinux-style base)
         "GLIBC_x.y not found" = host glibc newer than target's
  musl:  static-clean → no libc dep → runs on any linux of arch

TRUE CROSS vs QEMU
  cross  = fast, faithful, can't run output, hard setup
  qemu   = slow (5-30x), imperfect fidelity, easy, CAN run tests
  qemu emulates the ISA, NOT the machine → green ≠ works on hardware
  docker run --privileged --rm tonistiigi/binfmt --install all

MULTI-ARCH IMAGE
  docker buildx build --platform linux/amd64,linux/arm64 -t img --push .
  fast path: FROM --platform=$BUILDPLATFORM ... GOARCH=$TARGETARCH go build

REPRODUCIBILITY
  pin toolchain+sysroot by digest;  NO -march=native;  SOURCE_DATE_EPOCH;
  -ffile-prefix-map to scrub host paths

TESTING WHAT YOU CAN'T RUN (weak→strong)
  file/readelf  →  QEMU tests  →  self-test binary  →  real HW CI  →  prod canary
```

---

## Summary

- Real C/C++ cross-builds wire **compiler + sysroot + target flags** into the build system (CMake toolchain file, Meson cross-file, autotools `--host`, Bazel platforms). The recurring wall is sourcing **third-party libraries built for the target** into the sysroot.
- A **CMake toolchain file** declares the target and, crucially, the `CMAKE_FIND_ROOT_PATH_MODE_*` policy that separates **host build-tools** from **target libraries** — the master cross-compile gotcha that otherwise produces `Exec format error` mid-build.
- The **libc/ABI** is a second target axis. **glibc** is forward-compat-only, so build on the *oldest* glibc you support; **musl** static-links cleanly and erases the libc dependency. Arch-correct binaries still fail in production when this axis is ignored.
- **True cross-compilation** (fast, faithful, can't execute the output) and **QEMU user-mode emulation** (slow, imperfect, *can* execute) are opposite trade-offs. QEMU emulates the **instruction set, not the machine** — green under QEMU is *not* proof on real hardware.
- **Multi-arch images** (`docker buildx --platform`) are N single-arch builds under one manifest; choose the fast **cross** path (`$BUILDPLATFORM` + `GOARCH`) for languages that cross-compile, or fall back to slow **QEMU** for C-heavy builds.
- Cross-builds must be **host-independent** to be reproducible: pin toolchain + sysroot by digest, ban `-march=native`, scrub host paths/timestamps.
- When you **can't run the artifact**, confidence is a *budget across layers*: static checks (always) → QEMU tests (cheap, caveated) → self-tests → real-hardware CI → prod canary. Never let "it cross-compiled" pass as "it works on the target."

[professional.md](professional.md) takes this to release matrices, the CGO/native-dependency tax and how teams escape it, Apple universal binaries and notarization, embedded pipelines, and the war stories where these trade-offs went wrong.

---

## Further Reading

- [CMake — `CMAKE_TOOLCHAIN_FILE` and cross-compiling](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html) — the authoritative guide, including the find-root-path modes.
- [docker buildx — multi-platform images](https://docs.docker.com/build/building/multi-platform/) — emulation vs cross-compilation strategies, `$BUILDPLATFORM`/`$TARGETARCH`.
- [QEMU user-mode emulation](https://www.qemu.org/docs/master/user/main.html) and [`tonistiigi/binfmt`](https://github.com/tonistiigi/binfmt) — what user-mode does and doesn't emulate.
- [PEP 600 — manylinux](https://peps.python.org/pep-0600/) — the canonical "build on old glibc for forward compat" standard, instructive beyond Python.

---

## Related Topics

- [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — the ABI, symbol versioning, and glibc that drive the libc axis.
- [05 — Polyglot & Hermetic Builds › senior](../05-polyglot-hermetic-builds/senior.md) — Bazel/Nix toolchains + sysroots pinned by hash, the hermetic ideal for cross-builds.
- [09 — Reproducible Builds › senior](../09-reproducible-builds/senior.md) — making cross-built output bit-identical and host-independent.
- [04 — Per-Language Tools › middle](../04-per-language-tools/middle.md) — how language toolchains orchestrate cross-builds.
- [professional.md](professional.md) — release matrices, the CGO tax, universal binaries, and the war stories.
