# Cross-Compilation — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Cross-Compilation
> *Cross-compilation interview questions sort candidates fast: people who memorized `GOOS=linux` and people who understand* why *Go cross-compiles for free and C doesn't. This bank gives you the model answers, what each question is really probing, and the design scenarios that separate "I've run the command" from "I've shipped six platforms reliably."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Section 1 — Host, Target, and the Triple](#section-1--host-target-and-the-triple)
4. [Section 2 — Toolchains and the Sysroot](#section-2--toolchains-and-the-sysroot)
5. [Section 3 — Go vs Rust vs C](#section-3--go-vs-rust-vs-c)
6. [Section 4 — CGO and the Native-Dependency Tax](#section-4--cgo-and-the-native-dependency-tax)
7. [Section 5 — QEMU vs True Cross-Compile](#section-5--qemu-vs-true-cross-compile)
8. [Section 6 — Multi-Arch Containers and the Libc Axis](#section-6--multi-arch-containers-and-the-libc-axis)
9. [Section 7 — Design Scenarios](#section-7--design-scenarios)
10. [Rapid-Fire Round](#rapid-fire-round)
11. [What the Interviewer Is Really Testing](#what-the-interviewer-is-really-testing)
12. [Red Flags That Sink Candidates](#red-flags-that-sink-candidates)
13. [Cheat Sheet](#cheat-sheet)
14. [Related Topics](#related-topics)

---

## Introduction

Cross-compilation is a favorite interview topic for platform, build, release-engineering, and embedded roles because it's a fast proxy for *systems depth*. A candidate's answer reveals whether they understand linking, the ABI, what "self-contained" means, and how builds actually ship — or whether they've only ever pressed Run.

The questions below are grouped by theme, each with a **model answer** (what a strong candidate says) and, where useful, **follow-ups** an interviewer drills into. Then a **design-scenario** section, because senior interviews ask you to *architect* a release pipeline, not recite flags. Read the prior four tiers first — this page assumes their content and tests recall + synthesis.

---

## How to Use This Page

- **Cover the model answer**, attempt the question aloud (interviews are verbal), then compare.
- Answer the **"really testing"** subtext, not just the literal question — interviewers grade the depth you reveal.
- For design scenarios, **state assumptions, name trade-offs, and decide** — a defended decision beats a hedge.
- If you can teach the *why* behind `CGO_ENABLED=0` and the glibc/musl split, you're already ahead of most candidates.

---

## Section 1 — Host, Target, and the Triple

**Q1.1 — Define host, target, and build. When is each distinct?**

*Model answer:* **Host** = the machine the build runs on. **Target** = the machine the output runs on. **Build** (GNU autotools' third) = the machine the *toolchain itself* was compiled on. For an ordinary application cross-build, build == host (you use a prebuilt toolchain), so it collapses to two: host vs target. All three become distinct only when you're building a *compiler* — a Canadian Cross — where the compiler is built on one machine, runs on a second, and emits code for a third.

*Really testing:* whether you know the third machine exists and *why* it's usually invisible (you don't build your own toolchain).

---

**Q1.2 — Decode `aarch64-unknown-linux-gnu`. Which field matters most and why?**

*Model answer:* arch=`aarch64` (64-bit ARM instruction set), vendor=`unknown` (cosmetic), OS=`linux` (syscalls + ELF format), ABI/libc=`gnu` (glibc). The *arch* obviously must match or you get `Exec format error`. But the field that silently breaks things is the **ABI/libc** (`gnu` vs `musl`): two binaries identical except for this field have different *runtime* requirements, and the mismatch doesn't surface until the binary runs on a machine with the wrong libc. So I'd say arch is the most *obvious* requirement, but libc/ABI is the most *commonly mishandled*.

*Follow-up:* "What does `none` as the OS mean?" → Bare metal — no operating system (microcontrollers); there's no syscall layer, so you supply the runtime yourself with a linker script.

---

**Q1.3 — Why do `GOOS`/`GOARCH` feel simpler than a full triple?**

*Model answer:* Go's two variables cover arch and OS; Go usually fixes the ABI/libc itself (pure-Go binaries don't depend on a libc, so there's nothing to choose). C and Rust force all four fields because they *do* link a libc and you must say which. Go hides the fourth field precisely because, by default, it doesn't have one.

---

## Section 2 — Toolchains and the Sysroot

**Q2.1 — What is a cross-toolchain, concretely?**

*Model answer:* A full set of build tools — compiler, assembler, linker, binutils — that *run on the host* but *emit/operate on target* artifacts. With GCC they're separate per-target binaries named with the triple prefix: `aarch64-linux-gnu-gcc`, `-ld`, `-as`, `-objdump`. Clang takes the opposite design: one binary that targets everything via `--target=<triple>`, because LLVM's backend is multi-target. So "install the cross-compiler" means an apt package of triple-prefixed tools for GCC, or just a flag for Clang.

---

**Q2.2 — A teammate installed `gcc-aarch64-linux-gnu`, compiled a hello-world fine, but linking against the target's OpenSSL fails. What's missing?**

*Model answer:* The **sysroot** — specifically, OpenSSL built *for the target*. The cross-gcc resolves `<openssl/ssl.h>` and `-lssl` against the sysroot (the target's headers + libs on the host's disk). The distro cross package ships a *libc* sysroot, so hello-world (libc only) links — but third-party libraries aren't included. They must supply a target build of OpenSSL in the sysroot and point `--sysroot` at it. This "compiler installed but won't link" symptom is almost always a missing/incomplete sysroot.

*Really testing:* the single most common real-world cross-compile misconception — that the compiler is the whole story. The sysroot is the other half.

---

**Q2.3 — In a CMake toolchain file, why split `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER` from `..._LIBRARY ONLY`?**

*Model answer:* Because a cross-build runs two kinds of programs at two times. *Build tools* (code generators like `protoc`, run *during* the build) must be **host** binaries — search the host (`PROGRAM NEVER`). *Libraries and the final output* must be **target** binaries — search the sysroot (`LIBRARY ONLY`). Mixing them up is the classic mid-build `Exec format error`: the build compiles a generator *for the target*, then tries to *run* it on the host. This host-tool-vs-target-artifact split is the master cross-compile gotcha; every cross-aware build system has a knob for it.

*Really testing:* the deepest concept in the topic. Nailing this signals genuine cross-build experience.

---

## Section 3 — Go vs Rust vs C

**Q3.1 — Rank Go, Rust, and C by cross-compile ease and explain *why* in terms of dependencies.**

*Model answer:* Go (easiest) < Rust (medium) < C (hardest), and the reason is **how much each binary needs from the target**.
- **Go:** a pure-Go binary is self-contained and statically linked; the toolchain ships codegen for every target. Two env vars, zero target dependencies. Easiest — *until CGO*.
- **Rust:** `rustc`/`std` are multi-target (LLVM); `rustup target add` downloads a precompiled `std`. Pure-Rust cross-compiles cleanly, but you still need a cross *linker* configured, and any C dependency (`-sys` crate) reintroduces the C wall.
- **C:** never self-contained — always needs a cross-compiler *and* the target's headers/libs (sysroot) for everything it links. Hardest.

The unifying principle: **ease tracks how self-contained the artifact is.** The C boundary is where every language's difficulty enters.

*Really testing:* whether you can connect "self-contained / static" (from build fundamentals) to "easy to cross-compile" — the core insight of the whole topic.

---

**Q3.2 — Walk through cross-compiling a pure-Rust binary to `aarch64-unknown-linux-gnu`.**

*Model answer:*
```bash
rustup target add aarch64-unknown-linux-gnu        # downloads std for the triple
# .cargo/config.toml:
#   [target.aarch64-unknown-linux-gnu]
#   linker = "aarch64-linux-gnu-gcc"                # cross linker
cargo build --target aarch64-unknown-linux-gnu
```
`rustup target add` handles the Rust side; the `.cargo/config.toml` linker line is the step people forget — without it the final link uses the host linker and fails. If a `-sys` crate is involved, add a cross C compiler + sysroot, or use `cross` (containerized toolchain).

---

## Section 4 — CGO and the Native-Dependency Tax

**Q4.1 — Go cross-compiles trivially. So why do real Go release pipelines break on cross-compilation?**

*Model answer:* **CGO.** Go's easy mode holds only while the program is pure Go. The moment code (or a transitive dependency) imports `"C"` — common with SQLite drivers, image/crypto wrappers — Go must invoke a C compiler that targets the cross arch. Now you need a cross C toolchain (`CC=aarch64-linux-gnu-gcc`) and, for third-party C libs, a target sysroot — full C-style pain. Most "Go cross-compile is broken" reports are really "CGO is enabled and there's no cross C compiler." The escape, when dependencies allow, is `CGO_ENABLED=0`.

*Follow-up:* "How do you *prevent* this regression?" → A CI guard that runs `CGO_ENABLED=0 go build ./...` and fails if it ever stops working, so a transitive C dependency can't silently re-impose the tax.

*Really testing:* whether you understand that Go's simplicity is conditional, and that the condition is "no C."

---

**Q4.2 — Name strategies, strongest first, to keep the native-dependency tax near zero across a release matrix.**

*Model answer:*
1. **Choose pure-language libraries** deliberately (e.g. `modernc.org/sqlite` over the CGO `go-sqlite3`) so `CGO_ENABLED=0` holds. The cheapest cross-build is designed upstream in dependency choice.
2. **Static musl** when C is unavoidable — self-contained binary, libc question gone.
3. **Containerize/pin the cross-toolchain** (a build image, `cross`, or Bazel hermetic toolchains) so it's reproducible and not per-developer setup.
4. **`zig cc`** as a drop-in cross C compiler with bundled multi-version libcs (and glibc-version selection).
5. **QEMU emulation** as a last resort for gnarly deps, accepting the speed/fidelity cost.

*Really testing:* that you treat cross-compilation as an *architectural* concern (dependency tree), not a command you run at the end.

---

## Section 5 — QEMU vs True Cross-Compile

**Q5.1 — Contrast true cross-compilation with QEMU user-mode emulation across speed, fidelity, setup, and testability.**

*Model answer:*

| | True cross-compile | QEMU user-mode |
|---|---|---|
| Speed | Fast (native host codegen) | Slow, ~5–30× (instruction translation) |
| Fidelity | High (real target codegen) | Imperfect — emulates the *ISA, not the machine* |
| Setup | Cross-toolchain + sysroot (painful) | Use the target's *native* toolchain (easy) |
| Run the output? | No | **Yes** (binary runs under QEMU) |

True cross produces target bytes fast but you can't execute them locally. QEMU lets you build with the target's native toolchain (no sysroot hassle) *and* run the binary and its tests — at a big speed cost and with imperfect fidelity. The mature pattern uses both: true-cross-compile the release artifact (fast/faithful), run tests under QEMU (coverage), smoke-test on real hardware (truth).

---

**Q5.2 — Your multi-arch build passes all tests under QEMU but crashes on real ARM hardware. How is that possible?**

*Model answer:* QEMU user-mode emulates the **instruction set**, not the **whole machine** — it runs on your host kernel and can mishandle some syscalls, signals, threading, timing, and CPU-feature detection, and it isn't a faithful replica of the target CPU. So a code path that QEMU emulates permissively (e.g. reports a CPU feature as present, or stubs a syscall) can behave differently on real silicon. **QEMU-green is not hardware-proven.** The fix is a real-hardware smoke test (a device, or a cloud instance of the target arch like Graviton) before shipping.

*Really testing:* whether you know emulation's limits — a classic trap that bites teams who trust green CI blindly.

---

## Section 6 — Multi-Arch Containers and the Libc Axis

**Q6.1 — How is a multi-arch container image built and what is it, structurally?**

*Model answer:* It's a **manifest list**: one image per architecture under a single tag, with the runtime auto-selecting the right one at pull. `docker buildx build --platform linux/amd64,linux/arm64 -t img --push .` builds them. Under the hood buildx either (a) emulates each non-native stage under QEMU (zero-config, slow), or (b) cross-compiles via `FROM --platform=$BUILDPLATFORM` + the `TARGETOS`/`TARGETARCH` build args, running a native build that cross-compiles (fast, more setup). For Go/Rust the fast cross path is straightforward (`GOARCH=$TARGETARCH go build`); for C-heavy images people fall back to QEMU.

---

**Q6.2 — A binary built on a modern CI host fails on the production server with `GLIBC_2.34 not found`, and the arch matches. Diagnose and fix.**

*Model answer:* glibc is **forward-, not backward-, compatible**: a binary linked against glibc 2.34 needs glibc ≥ 2.34 at runtime. The CI host's glibc is newer than the production box's, so the binary references a symbol version the target lacks. Fixes: (a) build inside an *old* base image with the oldest glibc you support (the manylinux approach), or (b) target **musl** and link statically so there's no glibc dependency at all. This is a cross-compile-adjacent trap even when the architecture matches — the *effective* target (its libc version) differed from the build host.

*Really testing:* the libc/ABI axis — that "which arch" is only half the target; "which libc, which version" is the half that breaks production.

---

## Section 7 — Design Scenarios

**S1 — Design a CI release matrix for a Go CLI shipping to six platforms.**

*Strong answer structure:*

1. **Enumerate the matrix** and prune to real demand: `linux/{amd64,arm64}`, `darwin/{amd64,arm64}`, `windows/amd64` (+`arm64` if users exist). Each cell = a signed, checksummed artifact.
2. **The linchpin decision: keep it pure Go (`CGO_ENABLED=0`).** Then *one* Linux runner cross-compiles every cell in seconds with `GOOS`/`GOARCH`. Use GoReleaser to declare the matrix once. Guard it: a CI step `CGO_ENABLED=0 go build ./...` so a future C dependency can't silently break the matrix.
3. **Parallelism & isolation:** build cells in parallel; a broken `windows/arm64` must not block shipping `linux/amd64`.
4. **macOS exception:** signing + notarization need a **macOS runner** (Linux can't notarize). Build universal (`lipo` amd64+arm64) or two binaries; sign/notarize on the Mac runner.
5. **Trust:** checksums + signatures (cosign) + SLSA provenance + per-artifact SBOM, since users can't run every arch to verify.
6. **Testing:** unit tests on the native runner; for non-native arches, QEMU tests in CI + at least one real-hardware (or Graviton) smoke test pre-release.

*Trade-off to name aloud:* the entire matrix's simplicity rests on staying pure-Go. If a native dependency is required, the matrix needs per-OS runners or QEMU and the cost multiplies — so I'd treat "introduce a CGO dependency" as a significant architectural decision, not a routine library add.

---

**S2 — You must ship a Go service that uses a CGO-only library to `linux/amd64` and `linux/arm64`. Design the build.**

*Strong answer:*
- Acknowledge CGO removes the free cross-compile; we now need a cross C toolchain per target.
- **Preferred:** use `zig cc` as the cross C compiler — `CC="zig cc -target aarch64-linux-musl"` with `CGO_ENABLED=1` — bundling libc and letting us pick musl for a static, portable binary; one tool covers both arches. Alternatively a containerized cross-toolchain (or `cross`-style image) pinned by digest.
- **Static musl** so the artifacts are self-contained and dodge the glibc-version trap.
- **Fallback** if a dependency's C is too gnarly for clean cross: build that arch under QEMU in buildx, accept the speed cost, and add a real-hardware smoke test (QEMU fidelity caveat).
- Pin the toolchain by digest for reproducibility; sign + provenance the outputs.

*Trade-off:* `zig cc`/musl is fast and clean but adds Zig as a build dep and has rough edges on exotic C++; QEMU is universally compatible but slow and lower-fidelity. I'd default to `zig cc`+musl and keep QEMU as the escape hatch.

---

**S3 — Design the build/test pipeline for firmware on a bare-metal ARM microcontroller.**

*Strong answer:*
- **Triple** like `thumbv7em-none-eabi` — `none` OS, freestanding, no libc you'd recognize; vendor SDK as the "sysroot."
- **Build:** cross-compile → link with a **memory-map linker script** (placing code/data into the chip's exact flash/RAM layout) → `objcopy` to a raw/HEX image → flash via JTAG/SWD.
- **Testing:** QEMU can't model real peripherals/timing, so **hardware-in-the-loop (HIL)** on racks of real boards is the *primary* gate — because the device may be unpatchable in the field and a bad flash can brick it.
- **Reproducibility & provenance** are not optional: in safety-regulated domains you must prove exactly which toolchain + sources produced the shipped image (auditable evidence).

*Trade-off to name:* HIL is slow and capital-intensive, but the cost of a field failure (recall, truck roll, safety incident) dwarfs it — so confidence economics invert versus a redeployable server binary.

---

## Rapid-Fire Round

- *What does `Exec format error` mean?* → The binary is for a different CPU/OS than this machine.
- *`uname -m` shows `arm64`. You build and `scp` to an x86 server. What happens?* → `Exec format error`; rebuild with `GOARCH=amd64`.
- *Last field of `aarch64-unknown-linux-musl`?* → ABI/libc = musl.
- *How to force a pure-Go build?* → `CGO_ENABLED=0`.
- *One command to add a Rust target?* → `rustup target add <triple>`.
- *Why `-fPIC` for a `.so`?* → Position-independent code so it loads at any address (ASLR).
- *Why is `-march=native` dangerous in a cross/CI build?* → It tunes for the *host* CPU; the artifact may use instructions the target lacks → `SIGILL`.
- *glibc compatibility direction?* → Forward only — build on the oldest glibc you support.
- *Tool to merge two macOS arch binaries?* → `lipo`.
- *Why must macOS artifacts touch a Mac runner?* → Signing/notarization needs Apple tooling.
- *`go tool dist list` shows what?* → Every supported `GOOS/GOARCH` target.
- *QEMU emulates what, exactly?* → The instruction set, not the whole machine.

---

## What the Interviewer Is Really Testing

- **Do you understand *why*, not just *how*?** "Go cross-compiles for free" is recall. "Because a pure-Go binary is self-contained and the toolchain ships every target's codegen" is understanding. The *why* connects to linking and static binaries — it proves systems depth.
- **Can you connect linking → portability → cross-compile ease?** The thread from "static, self-contained" to "trivial to cross-compile" is the spine of the topic. Following it signals you grasp the fundamentals, not just commands.
- **Do you know the libc/ABI axis exists?** Many candidates stop at "match the arch." Knowing glibc-version forward-compat and the glibc/musl split separates real release experience from tutorial knowledge.
- **Do you respect emulation's limits?** "QEMU-green isn't hardware-proven" shows you've been burned (or learned from those who were) — exactly the judgment senior roles want.
- **Do you treat cross-compilation as architecture?** Senior answers tie matrix health to *dependency choices* and name trade-offs out loud. That's the leap from engineer to release engineer.

---

## Red Flags That Sink Candidates

1. **"Just set `GOOS` and it works."** Ignores CGO entirely — the single most common real-world failure. Always mention the CGO caveat.
2. **Thinking the cross-compiler is the whole job.** Forgetting the **sysroot** (target headers/libs) marks someone who's never done a real C cross-build.
3. **Treating arch as the only target dimension.** No awareness of the **libc/ABI** axis (glibc vs musl, glibc versions) — they'll ship binaries that fail in production with `GLIBC_x not found`.
4. **Trusting QEMU as proof of correctness.** "It passed in the emulator so it's fine" — a candidate who'll cause a production incident.
5. **`-march=native` in a CI/release build.** Reveals no understanding that the build host's CPU leaks into the artifact.
6. **No notion of trust for un-runnable artifacts.** Can't say how you'd make a binary you can't execute trustworthy (reproducibility, signing, provenance) — a gap for any release-engineering role.

---

## Cheat Sheet

```
THE ONE-LINERS
  host = builds it ; target = runs it ; build = where the toolchain was built
  triple = arch-vendor-OS-abi  (abi/libc is the silent one; os=none → bare metal)
  cross-compile ease ∝ how SELF-CONTAINED the artifact is
  the C boundary is the universal tax (CGO / -sys crates / C itself)

GO / RUST / C
  Go:   GOOS=linux GOARCH=arm64 go build .        (free UNTIL CGO)
  Go+C: CGO_ENABLED=1 CC=aarch64-linux-gnu-gcc ... (or CGO_ENABLED=0 to escape)
  Rust: rustup target add <triple> + cross linker in .cargo/config.toml
  C:    cross-compiler + SYSROOT (target headers+libs) — always

THE GOTCHAS INTERVIEWERS PROBE
  Exec format error          = wrong-arch/OS binary
  "compiler installed, won't link" = missing SYSROOT
  GLIBC_x.y not found        = host glibc newer than target (forward-compat only)
  build-tool vs target-artifact = host tools run NOW, output ships → keep separate
  QEMU                       = emulates ISA, NOT the machine → green ≠ proven

MULTI-PLATFORM
  buildx --platform linux/amd64,linux/arm64 ; manifest list = N images, 1 tag
  fast path: FROM --platform=$BUILDPLATFORM ... GOARCH=$TARGETARCH go build
  mac: lipo (universal) + codesign/notarize (needs macOS runner)

RELEASE MATRIX (design)
  keep CGO_ENABLED=0 → 1 runner builds all ; prune cells ; parallel+isolated
  guard: CI `CGO_ENABLED=0 go build ./...`  ; sign + provenance + SBOM
  trust un-runnable artifacts via the BUILD: reproducible + pinned + signed
```

---

## Related Topics

- [junior.md](junior.md) — host/target, `GOOS`/`GOARCH`, the triple, why C is harder.
- [middle.md](middle.md) — triple anatomy, build/host/target, cross-toolchain, sysroot, CGO, static musl.
- [senior.md](senior.md) — CMake toolchain files, glibc/musl ABI, QEMU vs cross, multi-arch buildx, testing un-runnable artifacts.
- [professional.md](professional.md) — release matrices, the CGO tax, `zig cc`, Apple universal/notarization, firmware, supply chain, war stories.
- [01 — Build Fundamentals](../01-build-fundamentals/middle.md) — linking, the ABI, glibc — the substrate beneath every answer here.
- [09 — Reproducible Builds › senior](../09-reproducible-builds/senior.md) — making cross-built artifacts verifiable.
