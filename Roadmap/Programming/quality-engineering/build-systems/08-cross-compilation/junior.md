# Cross-Compilation — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Cross-Compilation
> *Your laptop is an x86 Mac or an ARM MacBook. Your server is x86 Linux. Your IoT device is a tiny ARM chip. Cross-compilation is how one machine builds a program that runs on a different machine — and it's the difference between "ship in five seconds" and "wait, why won't this binary run?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Host vs Target: Two Different Machines](#core-concept-1--host-vs-target-two-different-machines)
5. [Core Concept 2 — Why You'd Ever Want To](#core-concept-2--why-youd-ever-want-to)
6. [Core Concept 3 — Go's GOOS/GOARCH: The Easy Case](#core-concept-3--gos-goosgoarch-the-easy-case)
7. [Core Concept 4 — The Target Triple](#core-concept-4--the-target-triple)
8. [Core Concept 5 — Why C Is Harder Than Go](#core-concept-5--why-c-is-harder-than-go)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Building a program on one kind of machine so it runs on a different kind of machine.**

Up to now you've probably assumed the obvious: you build a program *on* the machine that's going to run it. You compile on your laptop, you run on your laptop. Done.

But that assumption breaks the moment your code has to run somewhere that isn't your desk. You write code on an Apple Silicon (ARM) MacBook, but your production server is x86 Linux. Or you're building firmware for a 50-cent ARM microcontroller that can't even *hold* a compiler. Or your CI pipeline has to ship one app for Windows, macOS, and Linux — from a single Linux build machine.

In all those cases you need **cross-compilation**: building a binary for a CPU architecture and/or operating system *other than the one you're building on*. The machine doing the building (your laptop, the CI runner) is the **host**. The machine that will run the result (the server, the device, the customer's PC) is the **target**. When host and target differ, you're cross-compiling.

The good news: some languages make this almost free. The bad news: the moment your program touches C — directly or through a dependency — it gets genuinely hard. This page teaches you the core vocabulary (host, target, triple) and walks the easy case (Go) and the hard case (C) so the next two tiers have somewhere to build from.

> **The mindset shift:** stop assuming "build machine = run machine." Start asking, for every build, *"what is the host, and what is the target?"* When they're the same, life is simple. When they differ, every tool, library, and assumption has to be told about the target explicitly — and that's where cross-compilation lives.

---

## Prerequisites

- **Required:** You've read [01 — Build Fundamentals › junior](../01-build-fundamentals/junior.md) and can describe compile vs link, and static vs dynamic linking.
- **Required:** You've built and run a program in at least one compiled language (examples use **Go** and **C**).
- **Helpful:** You know your own machine's architecture — run `uname -m` (you'll see `x86_64`/`amd64` or `arm64`/`aarch64`).
- **Helpful:** You've heard "ARM vs x86" or "Apple Silicon vs Intel" and have a vague sense they're different CPUs.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Host** | The machine where the build *runs* (your laptop, the CI runner). |
| **Target** | The machine where the output *will run* (the server, the device). |
| **Cross-compile** | Build on the host for a *different* target. |
| **Native build** | Host and target are the same — the normal case. |
| **Architecture (arch)** | The CPU's instruction set: `x86_64`/`amd64`, `arm64`/`aarch64`, etc. |
| **OS** | The operating system the binary runs on: Linux, Windows, macOS (`darwin`). |
| **Target triple** | A short name for a target, like `aarch64-unknown-linux-gnu`. |
| **Toolchain** | The set of tools (compiler, linker) that produce the binary. |
| **Cross-toolchain** | A toolchain that *runs on the host* but *emits code for the target*. |
| **CGO** | Go's mechanism for calling C code — the thing that breaks easy cross-compilation. |

---

## Core Concept 1 — Host vs Target: Two Different Machines

The single most important idea in this whole topic is two words: **host** and **target**.

- **Host** = the computer doing the work *right now*, running the compiler. Your laptop. The CI runner.
- **Target** = the computer the finished binary is meant to run on. The production server. The phone. The router.

```
   HOST (build here)                          TARGET (run there)
 ┌──────────────────┐                       ┌──────────────────┐
 │  ARM macOS laptop│   cross-compile  →     │  x86_64 Linux    │
 │  runs the compiler│                       │  runs the binary │
 └──────────────────┘                       └──────────────────┘
```

When host and target are identical — you build x86 Linux *on* x86 Linux — that's a **native build**, the default everyone learns first. You never had to think about host vs target because they were the same thing.

The moment they differ, you're **cross-compiling**, and the compiler now has to produce machine code for a CPU it *isn't running on*, possibly for an OS it *isn't running on*. The compiler itself runs on the host (it's a normal program); its *output* is aimed at the target.

> **Key insight:** A compiler is just a program that reads text and writes machine code. There's no law that says the machine code has to be for the same CPU the compiler is running on. A compiler running on x86 can emit ARM instructions just fine — *if* it was built to know about ARM. Cross-compilation is "normal compilation, but the output is aimed elsewhere." Everything hard about it comes from the *libraries and tools* that assumed host = target.

---

## Core Concept 2 — Why You'd Ever Want To

If you've only ever built on the machine you run on, cross-compilation can sound exotic. It's not — it's everywhere in real software shipping. The reasons:

**1. You ship to platforms you don't develop on.** You write a CLI tool on a Mac. Your users are on Windows, Linux, and Mac, on both Intel and ARM. You can't buy six laptops. You cross-compile all six binaries from one build machine.

**2. Apple Silicon vs servers.** Most developers now have ARM (`arm64`) MacBooks. Most cloud servers are still x86 (`amd64`) Linux (though ARM servers are rising). Building the server binary *on* your ARM laptop means cross-compiling ARM→x86.

**3. Embedded and IoT.** A microcontroller or a router has a tiny, slow CPU and often *no* operating system and *no* room for a compiler. It physically cannot build its own software. The only option is to cross-compile on a beefy host and flash the result onto the device.

**4. CI release matrices.** A "release" of a serious project is often a dozen binaries: `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`, … One CI machine cross-compiles all of them in parallel. (More on this in [professional.md](professional.md).)

**5. Speed.** Even when you *could* build natively (e.g. in an emulator), cross-compiling on a fast host is often dramatically faster than building inside a slow emulated target.

> **The common thread:** in every case, the machine that *runs* the code is not convenient (or even possible) to *build* on. Cross-compilation decouples "where I build" from "where it runs."

---

## Core Concept 3 — Go's GOOS/GOARCH: The Easy Case

Go is where you should first *feel* cross-compilation, because Go makes it almost insultingly easy. Two environment variables control the target:

- `GOOS` — the target operating system (`linux`, `windows`, `darwin`, …).
- `GOARCH` — the target architecture (`amd64`, `arm64`, `386`, …).

That's it. From an ARM Mac, build a Linux x86 server binary:

```bash
GOOS=linux GOARCH=amd64 go build -o myapp-linux-amd64 .
```

Build a Windows binary from the same Mac:

```bash
GOOS=windows GOARCH=amd64 go build -o myapp.exe .
```

Build for a Raspberry Pi (ARM Linux):

```bash
GOOS=linux GOARCH=arm64 go build -o myapp-pi .
```

No extra tools to install. No special compiler. The standard `go` you already have can emit code for *every* platform it supports — run `go tool dist list` to see the whole matrix (40+ combinations). You can build a Plan 9 PowerPC binary on a Windows laptop if you really want to.

**Why is Go so easy here?** Because a normal Go program is **self-contained**. The Go compiler and its standard library are written in Go (plus a little assembly the Go toolchain ships for every target). A pure-Go binary statically links everything it needs and talks to the OS through a thin, built-in layer — it does **not** depend on the target's C library or any external `.so`. So the Go toolchain already *contains* everything required to emit a complete, runnable binary for any supported target. There's nothing on the target it needs to find at build time.

> **Key insight:** Go cross-compiles trivially because a pure-Go binary has *no external dependencies* — it's the static-linking idea from [01 — Build Fundamentals](../01-build-fundamentals/junior.md) taken to its logical end. The whole world the binary needs is baked into the binary by a toolchain that already knows every target. Set two env vars, get a binary. This is the *easy* case — and it stays easy *only as long as you stay in pure Go*. (Core Concept 5 shows what breaks it.)

---

## Core Concept 4 — The Target Triple

`GOOS=linux GOARCH=amd64` is Go's *friendly* way of naming a target. The rest of the world (C, C++, Rust, LLVM, Clang) uses a more formal name called a **target triple**. You will see these constantly, so learn to read them.

A triple is a hyphen-separated string. Despite the name "triple," it usually has *four* parts:

```
   aarch64  -  unknown  -  linux  -  gnu
   └─ arch     └─ vendor   └─ OS     └─ ABI / libc
```

- **arch** — the CPU instruction set: `aarch64` (= ARM64), `x86_64`, `arm`, `riscv64`, …
- **vendor** — who makes the platform. Usually `unknown` or `pc` or `apple`. Mostly cosmetic.
- **OS** — `linux`, `windows`, `darwin` (macOS), `none` (bare-metal embedded), …
- **ABI / libc** — the "flavor" of the OS interface: `gnu` (glibc), `musl` (a smaller libc), `gnueabihf` (ARM hard-float), `msvc` (Windows), …

Examples you'll meet:

| Triple | In English |
|---|---|
| `x86_64-unknown-linux-gnu` | 64-bit Intel/AMD, Linux, glibc — the standard server |
| `aarch64-unknown-linux-gnu` | 64-bit ARM, Linux, glibc — an ARM server / Raspberry Pi |
| `x86_64-pc-windows-msvc` | 64-bit Windows, Microsoft toolchain |
| `aarch64-apple-darwin` | Apple Silicon macOS |
| `arm-unknown-linux-gnueabihf` | 32-bit ARM, Linux, hard-float — many embedded boards |
| `thumbv7em-none-eabi` | A bare-metal microcontroller, *no OS at all* |

You don't need to memorize these. You need to recognize that *this is the name of a target*, that the last part (the ABI/libc) matters as much as the CPU, and that `none` as the OS means "there is no operating system — this is bare metal." Middle and senior tiers go deep on the triple; here, just learn to *read* one.

> **Key insight:** A triple answers four questions about where your code will run: *which CPU, whose platform, which OS, which system-interface flavor.* `GOOS`/`GOARCH` only answers the first three (Go usually picks the ABI for you); C and Rust make you state all four — which is exactly why they're harder.

---

## Core Concept 5 — Why C Is Harder Than Go

If Go is two env vars, why is C cross-compilation a notorious headache? Because a C program is *not* self-contained the way a pure-Go binary is. To build a C program for a target, you need things that live **on the target**:

1. **A compiler that emits the target's machine code.** Your normal `gcc`/`clang` emits code for *your* CPU. To emit ARM code you need a **cross-compiler** — a compiler that runs on the host but produces target code. It often has a name like `aarch64-linux-gnu-gcc`.

2. **The target's headers and libraries.** A C program `#include`s `<stdio.h>` and links against the C library (`libc`). Those header files and that `libc` are *the target's*, not the host's. Your x86 Mac's `libc` is the wrong one for an ARM Linux box. The collection of the target's headers and libraries is called a **sysroot** (you'll meet it properly in [middle.md](middle.md)).

So a C cross-build needs: the right compiler **and** a copy of the target's system files. Compare:

```bash
# Go: build an ARM Linux binary from anywhere. Zero setup.
GOOS=linux GOARCH=arm64 go build .

# C: build an ARM Linux binary — needs a cross-compiler installed,
#    and it needs the target's libraries to link against.
aarch64-linux-gnu-gcc main.c -o myapp        # this compiler is a separate install
```

The Go version works on a fresh machine. The C version fails with `aarch64-linux-gnu-gcc: command not found` until you install the cross-toolchain — and may *still* fail at link time if it can't find the target's libraries.

**And here's the trap that connects the two:** Go's easy mode only lasts while your program is *pure Go*. The moment your Go program uses **CGO** — Go's feature for calling C code (e.g. a database driver, an image library, anything that wraps a C library) — your Go build *secretly becomes a C build*, and it inherits all of C's cross-compilation pain. You suddenly need a cross C compiler too:

```bash
# Pure Go — fine:
GOOS=linux GOARCH=arm64 go build .

# Go with CGO enabled, cross-compiling — now needs a C cross-compiler:
GOOS=linux GOARCH=arm64 go build .
#  → "gcc: error: unrecognized command-line option '-marm'" or similar
#  → because CGO needs a C compiler that targets ARM, and you didn't give it one
```

You either disable CGO (`CGO_ENABLED=0`, if your code allows it) or provide a cross C compiler. This CGO problem is *the* reason Go cross-compilation goes from "trivial" to "why is my release pipeline on fire," and middle/professional tiers spend real time on it.

> **Key insight:** Cross-compilation is easy exactly when your binary is **self-contained** (pure Go, statically linked, no C). It gets hard exactly when your binary needs **things from the target** — a target compiler and the target's headers/libraries. C always needs those. Go needs them *only* when CGO drags C into the picture. Remember this one rule and most of cross-compilation makes sense.

---

## Real-World Examples

**1. Shipping a CLI from a Mac for the whole world.** You wrote a developer tool in Go. With a five-line loop you build `darwin/amd64`, `darwin/arm64`, `linux/amd64`, `linux/arm64`, `windows/amd64` — five binaries — on your one laptop in seconds, and upload them to a GitHub Release. Users on any platform download the right one and run it. No CI farm of six machines; one Go toolchain that knows every target.

**2. The Apple Silicon → server surprise.** A team gets new M-series MacBooks (ARM). They `go build` their service and `scp` it to their x86 Linux server as always. It refuses to run: `cannot execute binary file: Exec format error`. The binary is ARM; the server is x86. They forgot host (now ARM) ≠ target (still x86). Fix: `GOOS=linux GOARCH=amd64 go build`. This exact mistake hits teams the week they switch to Apple Silicon.

**3. Firmware for a device with no compiler.** An IoT thermostat runs on a tiny ARM chip with a few hundred KB of RAM — far too small to host a compiler. All its firmware is cross-compiled on developers' powerful x86 laptops using an ARM cross-toolchain, then flashed onto the device. There is no "build on the device" option; cross-compilation is the *only* way the device gets software at all.

---

## Mental Models

- **Host is the kitchen; target is the dinner table.** You cook (build) in the kitchen (host). The meal is eaten at the table (target). Cross-compilation is cooking in *your* kitchen for *someone else's* table — which means you'd better know what plates and utensils *their* table has (the target's libraries).

- **A compiler is a translator, not a citizen of the CPU it emits for.** An x86 compiler emitting ARM code is like an English speaker writing fluent French. The translator doesn't *live* in France; it just produces French. Cross-compiling is asking the translator to write in a language other than the one spoken in the room.

- **Self-contained = portable; needs-the-target = painful.** A static, pure-Go binary carries everything with it, so building it anywhere for anywhere is trivial. A C binary expects to *find* things on the target (libc, headers), so you must supply the target's world at build time. Most of cross-compilation's difficulty is a measure of how much your binary expects from its destination.

- **The triple is a shipping address for code.** `aarch64-unknown-linux-gnu` tells the toolchain exactly *where this code is going to live* — which CPU, which OS, which system-library flavor — so it can pack the right thing. Get the address wrong and the binary arrives somewhere it can't run.

---

## Common Mistakes

1. **Assuming the build machine is the run machine.** The root error. On Apple Silicon especially, `go build` now defaults to an ARM binary that your x86 server can't run. Always know your host (`uname -m`) and your target.

2. **`Exec format error` panic.** This runtime message means "this binary is for a different CPU/OS than this machine." It's not corruption — it's a wrong-target binary. Rebuild with the correct `GOOS`/`GOARCH` (or triple).

3. **Thinking Go *always* cross-compiles for free.** It does — until **CGO**. The instant a dependency uses C, you need a C cross-compiler too. Many "Go cross-compile is broken!" reports are really "CGO is enabled and there's no cross C toolchain."

4. **Forgetting C needs the *target's* libraries, not the host's.** Installing the cross-*compiler* is half the job. It also needs the target's headers and `libc` (the sysroot) to link against. "Compiler installed but it still won't link" is usually a missing sysroot.

5. **Ignoring the ABI/libc part of the triple.** `aarch64-linux-gnu` and `aarch64-linux-musl` are *different targets*. A binary built for one libc may not run where the other is expected. The last part of the triple is not decoration.

6. **Confusing 32-bit and 64-bit ARM.** `arm` (32-bit) and `aarch64`/`arm64` (64-bit) are different architectures. A binary for one will not run on the other. Embedded boards are often 32-bit; phones and modern Pis are 64-bit.

---

## Test Yourself

1. Define **host** and **target** in one sentence each. When are you "cross-compiling"?
2. You're on an Apple Silicon (ARM) MacBook and need a binary for your x86 Linux server. Write the Go command.
3. Why can Go cross-compile to dozens of platforms with no extra tools installed, when C cannot?
4. Read this triple: `aarch64-unknown-linux-gnu`. What are its four parts and what do they mean?
5. Your Go program built fine for ARM Linux yesterday. You added a database driver that uses CGO, and now the cross-build fails. Why? Name two ways to fix it.
6. You `scp` a freshly built binary to a server and get `Exec format error`. What does that tell you, and what's the likely cause?

<details>
<summary>Answers</summary>

1. **Host** = the machine the build runs on (your laptop/CI). **Target** = the machine the output will run on (server/device). You're cross-compiling whenever host and target differ in CPU architecture and/or OS.
2. `GOOS=linux GOARCH=amd64 go build -o myapp .`
3. A pure-Go binary is **self-contained** (statically linked, no dependency on the target's C library), and the Go toolchain already ships everything needed to emit code for every supported target. C programs depend on the target's headers and `libc`, so a C cross-build needs a cross-compiler *and* the target's libraries (a sysroot).
4. `aarch64` = arch (64-bit ARM); `unknown` = vendor (cosmetic); `linux` = OS; `gnu` = ABI/libc (glibc). It means: 64-bit ARM, Linux, using glibc.
5. **CGO** turns the build into a C build, which needs a C compiler that targets ARM — and you don't have one (or didn't point Go at it). Fixes: (a) set `CGO_ENABLED=0` if the code can build without C, or (b) install/point to a cross C toolchain (e.g. `CC=aarch64-linux-gnu-gcc`).
6. It means the binary is for a *different CPU/OS* than the server. Likely cause: you built on an ARM host without setting `GOARCH=amd64`, so you produced an ARM binary the x86 server can't execute.

</details>

---

## Cheat Sheet

```
THE TWO WORDS
  HOST   = where the build RUNS  (your laptop / CI)
  TARGET = where the output RUNS (server / device)
  cross-compile = host ≠ target

GO (the easy case)
  GOOS=linux   GOARCH=amd64  go build .   # x86 Linux server
  GOOS=windows GOARCH=amd64  go build .   # Windows .exe
  GOOS=linux   GOARCH=arm64  go build .   # ARM Linux / Raspberry Pi
  GOOS=darwin  GOARCH=arm64  go build .   # Apple Silicon mac
  go tool dist list                       # every supported target

KNOW YOUR HOST
  uname -m        x86_64 / amd64   or   arm64 / aarch64

TARGET TRIPLE (C / Rust / LLVM)
  aarch64 - unknown - linux - gnu
  arch      vendor    OS      ABI/libc
  os = "none"  → bare metal, no OS (embedded)

WHY C IS HARDER
  needs a CROSS-COMPILER   (aarch64-linux-gnu-gcc) — emits target code
  needs the TARGET's libs  (sysroot: target headers + libc)

THE CGO TRAP
  pure Go            → cross-compiles free
  Go + CGO (uses C)  → now needs a cross C compiler too
  escape hatch:  CGO_ENABLED=0 go build .   (if code allows)

THE ERROR
  "Exec format error" = wrong-CPU/OS binary for this machine
```

---

## Summary

- **Cross-compilation** is building on one kind of machine (the **host**) for a different kind of machine (the **target**) — different CPU architecture and/or different OS. When host = target, it's a normal **native** build.
- You cross-compile because the run machine isn't the build machine: shipping to many platforms, Apple Silicon laptops vs x86 servers, embedded devices too small to host a compiler, and CI release matrices.
- **Go is the easy case.** `GOOS` + `GOARCH` pick the target; the toolchain already knows every platform and a pure-Go binary is self-contained, so it needs nothing from the target.
- A **target triple** (`aarch64-unknown-linux-gnu`) formally names a target by *arch–vendor–OS–ABI/libc*. The last part (the libc/ABI flavor) matters as much as the CPU.
- **C is the hard case** because a C program isn't self-contained: it needs a **cross-compiler** that emits target code *and* the target's headers and libraries (a **sysroot**). And **CGO** drags this same difficulty into Go the instant your Go program links C.
- The unifying rule: cross-compilation is easy when the binary is **self-contained**, and hard when it needs **things from the target**.

You now have the vocabulary and the intuition. [middle.md](middle.md) dissects the triple, defines the cross-toolchain and sysroot precisely, and shows how Rust and Go-with-CGO handle the same problem.

---

## Further Reading

- [Go — `go tool dist list`](https://pkg.go.dev/cmd/go) and the [environment variables reference](https://pkg.go.dev/cmd/go#hdr-Environment_variables) — the canonical `GOOS`/`GOARCH` documentation.
- [LLVM — Cross-compilation overview](https://clang.llvm.org/docs/CrossCompilation.html) — a clear, short explanation of triples and sysroots.
- [Rust — Platform Support](https://doc.rust-lang.org/rustc/platform-support.html) — the tier list of triples Rust supports; a great way to see real-world triples.
- The [middle.md](middle.md) of this topic — the triple anatomy, the cross-toolchain, the sysroot, and Rust's `--target` model.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — static vs dynamic linking, the foundation of *why* self-contained binaries cross-compile easily.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how `go build`, `cargo`, and friends wrap the toolchain.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — pinning the *exact* toolchain so cross-builds are reproducible across machines.
- [09 — Reproducible Builds](../09-reproducible-builds/junior.md) — making the cross-built binary bit-identical every time.
