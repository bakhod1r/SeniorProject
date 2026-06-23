# Cross-Compilation — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Cross-Compilation
> *The junior page named host and target and waved at "the triple." This page dissects the triple field by field, distinguishes the three machines autotools actually tracks, and makes the cross-toolchain and the sysroot concrete — because "just install the cross-compiler" is the advice that wastes the most afternoons.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Triple, Field by Field](#the-triple-field-by-field)
4. [Three Machines: Build, Host, Target](#three-machines-build-host-target)
5. [The Cross-Toolchain — What It Actually Is](#the-cross-toolchain--what-it-actually-is)
6. [The Sysroot — the Target's World on Your Disk](#the-sysroot--the-targets-world-on-your-disk)
7. [Rust Cross-Compilation — `--target` and the Linker](#rust-cross-compilation----target-and-the-linker)
8. [Go + CGO — How C Breaks the Easy Case](#go--cgo--how-c-breaks-the-easy-case)
9. [Static Linking as a Cross-Compile Simplifier](#static-linking-as-a-cross-compile-simplifier)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The precise vocabulary — triple, build/host/target, toolchain, sysroot — and how Rust and Go-with-CGO use it.**

At the junior level cross-compilation is "host ≠ target, Go is easy, C is hard." That's the right shape, but it can't yet explain *why* `rustup target add` is one command while a C cross-build is a research project, *why* autotools insists on a `--build` flag you've never set, or *what exactly* "install the cross-compiler" leaves out (almost always: the sysroot).

This page makes four things precise: the **anatomy of a target triple**, the **three** machines a build can involve (not two), the **cross-toolchain** as a concrete set of programs, and the **sysroot** as a concrete directory tree. Then it applies them to Rust (where the model is clean) and to Go+CGO (where Go's easy mode collapses into C's hard mode), and closes on the trick that dodges much of the pain: **static linking**.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) — host vs target, `GOOS`/`GOARCH`, the idea of a triple.
- **Required:** You've read [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — symbols, linking, `.so` vs `.a`, the ABI, glibc.
- **Helpful:** You've built a non-trivial C/C++ project (`./configure && make`, or CMake) and seen it fail.
- **Helpful:** You've used Rust's `cargo build` at least once.

---

## The Triple, Field by Field

The junior page introduced the triple as `arch-vendor-os-abi`. Now read each field as a *decision the toolchain has to make*.

```
   aarch64  -  unknown  -  linux  -  gnu
   └─ ARCH     └─ VENDOR   └─ OS     └─ ABI / ENVIRONMENT
```

**ARCH — the instruction set.** Determines which machine instructions the code generator emits. `x86_64`, `aarch64` (ARM64), `arm` (ARM32), `riscv64`, `wasm32`, `i686` (32-bit x86). Sub-variants encode CPU features: `armv7`, `thumbv7em`. Get this wrong and you get `Exec format error` at best, illegal-instruction crashes at worst.

**VENDOR — who ships the platform.** `unknown`, `pc`, `apple`, `nvidia`. Mostly historical; for Linux it's almost always `unknown` and changes nothing. Apple targets use `apple` (`aarch64-apple-darwin`). Don't overthink this field.

**OS — the operating system.** Decides the system-call interface, executable format (ELF for Linux, Mach-O for macOS, PE for Windows), and which OS facilities exist. `linux`, `windows`, `darwin`, `freebsd`. The special value **`none`** means *bare metal — there is no OS* (microcontrollers); the runtime that an OS normally provides isn't there, so you supply it yourself.

**ABI / ENVIRONMENT — the system-interface flavor.** This is the field people forget and pay for. On Linux it selects the **C library**: `gnu` = glibc, `musl` = musl libc, `gnueabihf` = glibc with the ARM hard-float calling convention. On Windows it's the toolchain/runtime: `msvc` (Microsoft) vs `gnu` (MinGW). Two triples that differ *only* in this field — `x86_64-unknown-linux-gnu` vs `x86_64-unknown-linux-musl` — produce binaries with *different runtime requirements*. (Why glibc vs musl matters in depth: [senior.md](senior.md) and [01 — Build Fundamentals](../01-build-fundamentals/middle.md)'s ABI section.)

> **Key insight:** The triple isn't a label you copy-paste — it's four orthogonal choices (instruction set, platform, OS/exec-format, libc/ABI). A cross-compile breaks if *any one* of them is wrong, and the libc/ABI field is the one most likely to be silently mismatched, because it doesn't change the file's name or obvious shape — only what it needs at runtime.

---

## Three Machines: Build, Host, Target

The junior page said "two machines: host and target." That's the common case. But the GNU autotools world tracks **three**, and the distinction is real (it's called a **Canadian Cross** when all three differ):

| Name | Definition | Example |
|---|---|---|
| **build** | Where the *toolchain itself* is compiled. | The CI machine that compiles the cross-gcc. |
| **host** | Where the *toolchain runs* (= where *your* build runs). | Your laptop, running that cross-gcc. |
| **target** | Where the *output of the toolchain* runs. | The ARM device the binary lands on. |

For most of us, **build == host** (we use a prebuilt cross-compiler), so it collapses to the familiar two: *host* (where I build) and *target* (where it runs). But when you build a *toolchain* — a compiler that runs on machine X to produce code for machine Y — all three become distinct, and autotools makes you say so:

```bash
./configure \
  --build=x86_64-linux-gnu \      # this configure script runs here
  --host=x86_64-linux-gnu \       # the program we're building runs here
  --target=aarch64-linux-gnu      # (only for toolchains) the code IT emits runs here
```

For an ordinary cross-compile of an *application* you set `--host` to the target and leave `--target` alone:

```bash
./configure --host=aarch64-linux-gnu    # "build this app to RUN on aarch64 linux"
```

The naming is famously confusing because autotools' **host** means "where the thing I'm building runs," which for a normal app *is the target*. Just remember: for apps, `--host` = your target.

> **Key insight:** Most cross-builds are two machines (host, target) because you use a prebuilt toolchain (build == host). The third machine — **build** — only appears when you're building the *compiler itself*. If `--build` vs `--host` vs `--target` ever confuses you, ask: "am I building an application, or a toolchain?" Applications: set `--host`. Toolchains: all three.

---

## The Cross-Toolchain — What It Actually Is

A **cross-toolchain** is not one program; it's the full set of build tools, each one a *host* program that knows how to produce *target* artifacts. On Linux they share a triple-prefixed naming convention:

```
aarch64-linux-gnu-gcc       # C compiler  → emits aarch64 code
aarch64-linux-gnu-g++       # C++ compiler
aarch64-linux-gnu-ld        # linker      → links aarch64 objects
aarch64-linux-gnu-as        # assembler
aarch64-linux-gnu-objdump   # disassembler for aarch64 binaries
aarch64-linux-gnu-strip     # strips aarch64 binaries
```

The prefix *is* the triple. `aarch64-linux-gnu-gcc` runs on your x86 host and emits ARM64 glibc code. Install one on Debian/Ubuntu:

```bash
sudo apt-get install gcc-aarch64-linux-gnu
aarch64-linux-gnu-gcc --version          # runs on x86, targets aarch64
aarch64-linux-gnu-gcc hello.c -o hello   # produces an aarch64 ELF binary
file hello                               # ELF 64-bit LSB ... ARM aarch64
```

Clang takes a different approach: **one** binary targets *everything* via `--target`, because LLVM's code generator is multi-target by design:

```bash
clang --target=aarch64-linux-gnu hello.c -o hello   # same clang, different target
clang --target=x86_64-pc-windows-msvc ...           # the very same clang
```

This is a genuine architectural difference: GCC is built per-target (you install a separate `gcc` for each), while a single Clang knows all targets and you select with a flag. It's one reason Clang-based cross-compilation (and tools built on it, like Zig — see [professional.md](professional.md)) is so much smoother.

> **Key insight:** "Install the cross-compiler" really means "install a *toolchain* — compiler, assembler, linker, binutils — all targeting the same triple." GCC gives you a per-target set of triple-prefixed programs; Clang gives you one program plus `--target`. But in *both* cases the compiler alone is only half of what you need. The other half is the sysroot.

---

## The Sysroot — the Target's World on Your Disk

Here is the piece every "I installed the cross-compiler but it still won't build" story is missing. A C/C++ program needs the **target's** headers and libraries — `<stdio.h>`, `libc.so`, `libm.so`, plus any other library it links (OpenSSL, zlib…). Those are the *target's* files, and they don't exist on your host (your host has *its own* `libc`, for the wrong architecture).

A **sysroot** is a directory tree that looks like the target's filesystem root — specifically its `/usr/include` (headers) and `/usr/lib` (libraries) — placed on your host so the cross-toolchain can find them:

```
/opt/aarch64-sysroot/
├── usr/
│   ├── include/        ← the TARGET's headers (stdio.h, openssl/*.h, …)
│   └── lib/            ← the TARGET's libraries (libc.so, libssl.so, …)
└── lib/
```

You point the compiler at it with `--sysroot`:

```bash
aarch64-linux-gnu-gcc --sysroot=/opt/aarch64-sysroot \
    main.c -lssl -o app
#   ^ now #include <openssl/ssl.h> resolves to the TARGET's header,
#     and -lssl links the TARGET's libssl, not your host's x86 one.
```

Where does a sysroot come from? Common sources: it ships *with* a packaged cross-toolchain (e.g. an embedded vendor's SDK); you extract it from the target's OS packages; or you copy it off a real target device. Distro cross packages like `gcc-aarch64-linux-gnu` come *with* a matching libc sysroot, which is why a plain `aarch64-linux-gnu-gcc hello.c` (using only libc) works out of the box — but the moment you need a *third-party* library (OpenSSL, SQLite) for the target, you must supply *that* library compiled for the target, in the sysroot. That's the cliff.

> **Key insight:** Cross-compiling C is "cross-compiler **plus** sysroot." The compiler decides *what instructions* to emit; the sysroot supplies *what to link against*. Pure-Go has no sysroot problem because it links nothing from the target. C's entire difficulty, and CGO's, is sourcing a correct target sysroot for every library you depend on.

---

## Rust Cross-Compilation — `--target` and the Linker

Rust sits between Go's "free" and C's "research project." The Rust *compiler* (`rustc`, built on LLVM) is multi-target like Clang, so adding a target is one command:

```bash
rustup target add aarch64-unknown-linux-gnu     # download the std library for that triple
cargo build --target aarch64-unknown-linux-gnu  # build for it
```

`rustup target add` downloads a **precompiled `std`** for that triple — Rust's answer to "the target's library." This handles pure-Rust dependencies completely. So a project with no C dependencies cross-compiles almost as easily as Go.

The catch: Rust still uses a **C linker** to produce the final binary (and any C dependency needs a C cross-compiler). For a pure-Rust binary you must tell Cargo which linker to invoke for the target, via `.cargo/config.toml`:

```toml
# .cargo/config.toml
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"          # the cross linker (from the cross-toolchain)
```

Without this, the build fails at the *link* step (`rustc` compiled fine, but tried to link with your host's linker and produced garbage / errors). So the model is:

- **Pure Rust:** `rustup target add` + a cross *linker* in `.cargo/config.toml`. Easy.
- **Rust + C deps (a `*-sys` crate):** now you also need a cross C compiler and the C library's sysroot — same wall as C. Tools like [`cross`](https://github.com/cross-rs/cross) (which builds inside a container that already has the toolchain) exist precisely to hide this:

```bash
cargo install cross
cross build --target aarch64-unknown-linux-gnu   # runs the build in a preconfigured container
```

> **Key insight:** Rust's `rustc`/`std` cross-compiles cleanly (multi-target compiler + downloadable std). The friction is the same as everywhere — the **C boundary**: you need a cross C *linker* always, and a full cross C *toolchain + sysroot* the moment a `-sys` crate pulls in real C. The pattern repeats in every language: the language itself is portable; *its C dependencies* are the problem.

---

## Go + CGO — How C Breaks the Easy Case

Now the inverse of the junior page's happy story. Go's effortless cross-compile holds *only* while the program is pure Go. **CGO** — Go's facility for calling C — silently turns the build into a C build.

By default Go disables CGO when cross-compiling (because it can't assume a cross C compiler exists), so a *pure-Go* cross-build just works:

```bash
GOOS=linux GOARCH=arm64 go build .       # CGO auto-disabled; pure Go → fine
```

But if your code (or a dependency) *requires* CGO — common with database drivers (`go-sqlite3`), image/crypto wrappers, anything importing `"C"` — Go must invoke a C compiler that targets ARM. Now you must hand it one:

```bash
CGO_ENABLED=1 \
CC=aarch64-linux-gnu-gcc \                # the cross C compiler
GOOS=linux GOARCH=arm64 \
go build .
```

If you set `CGO_ENABLED=1` but *don't* provide a cross `CC`, you get errors like `gcc: error: unrecognized command line option` or a link failure — Go tried to use your host's x86 gcc to produce ARM objects. And if the C code links a *third-party* library, you also need that library's target build in a sysroot — full C-style pain.

The common escape, when your dependencies allow it:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build .   # force pure Go; no C at all
```

Many teams deliberately choose pure-Go libraries (e.g. `modernc.org/sqlite`, a pure-Go SQLite, over the CGO `go-sqlite3`) *specifically* to keep `CGO_ENABLED=0` and preserve trivial cross-compilation. That's a real architectural decision driven by build concerns, expanded in [professional.md](professional.md).

> **Key insight:** `CGO_ENABLED` is the switch between Go's two universes. `0` = self-contained, cross-compiles for free. `1` = your Go build is now a C build and inherits the cross-compiler + sysroot tax. The question "does anything in my dependency tree need CGO?" decides whether your release pipeline is five lines or five hundred.

---

## Static Linking as a Cross-Compile Simplifier

Recall from [01 — Build Fundamentals](../01-build-fundamentals/middle.md): a dynamically-linked binary needs its `.so` files *present and ABI-compatible on the target at runtime*. For cross-compilation that's a double burden — you need the libraries at *build* time (sysroot) *and* on the target at *run* time, in compatible versions.

**Static linking** collapses much of this. If you statically link everything, the binary carries its own copies, so:

- There's nothing for the target to be "missing" at runtime — no `cannot open shared object file`, no `GLIBC_x not found`.
- The runtime ABI surface shrinks to almost nothing (often just the kernel syscall interface, which is far more stable than glibc's symbol versions).

The catch on Linux: **glibc does not statically link cleanly** (it relies on dynamic loading for things like `getaddrinfo`/NSS and warns or breaks if you force `-static`). The practical answer is **musl**, a libc designed to static-link fully. Build against the musl triple and you get a truly static, dependency-free binary:

```bash
# Go: musl-free static is the default for pure Go; for CGO use a musl cross-toolchain.
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build .   # already fully static, no libc dep

# Rust: pick the musl target → a static binary that runs on ANY linux of that arch
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl
file target/x86_64-unknown-linux-musl/release/app
#   ELF 64-bit ... statically linked          ← no .so needed on the target
```

A statically-linked musl (or pure-Go) binary is the cross-compiler's dream: it runs on essentially *any* Linux of the right architecture, regardless of which libc or library versions that machine has. You've traded a slightly larger binary (and rebuilding to pick up security fixes) for the disappearance of a whole class of "works on the build box, not the target" failures.

> **Key insight:** Static linking turns "does the target have the right libraries?" into "no, and it doesn't need to." For cross-compilation specifically, that removes both the runtime-dependency risk *and* much of the sysroot burden, which is why so much modern cross-compiled tooling targets `*-musl` and ships one self-contained binary per arch.

---

## Mental Models

- **The triple is four switches, not one label.** Arch, vendor, OS/exec-format, libc/ABI. A wrong flip on *any* switch produces a binary that won't run — and the libc/ABI switch is the silent one, because its damage doesn't show up until runtime.

- **Build/host/target is a question about what you're making.** Making an *app*? Two machines (host, target). Making a *compiler*? Three (build, host, target). The third only exists because a compiler's *output* runs somewhere different from the compiler itself.

- **Compiler = the *what*, sysroot = the *against what*.** The cross-compiler decides which instructions to emit. The sysroot decides which libraries to link against. C cross-compilation needs both; pure-Go needs neither because it links nothing from the target.

- **The C boundary is the universal cross-compile tax.** Go, Rust, every high-level language cross-compiles its *own* code cleanly. The pain always enters through linked C — CGO in Go, `-sys` crates in Rust, the whole program in C/C++. "Avoid C, or fully containerize the C toolchain" is the recurring escape.

---

## Common Mistakes

1. **Installing the cross-compiler and stopping there.** The compiler emits target code, but it still needs the target's *libraries* (sysroot) to link anything beyond bare libc. "Compiler installed, still won't link" = missing sysroot.

2. **Mixing up `--host` and `--target` in autotools.** For an *application* cross-build, set `--host` to your target and leave `--target` alone. `--target` is for building toolchains, not apps. This single confusion eats hours.

3. **Treating `gnu` and `musl` triples as interchangeable.** `x86_64-linux-gnu` and `x86_64-linux-musl` need different runtime libcs. A glibc-built binary won't run cleanly on a musl-only system (Alpine) and vice versa. Match the triple to the target's libc.

4. **Forgetting to set `CC` when `CGO_ENABLED=1` and cross-compiling.** Go will try your host's gcc to make target objects and fail. Provide a cross `CC` (and `CXX`), or set `CGO_ENABLED=0`.

5. **Forgetting the cross *linker* in Rust's `.cargo/config.toml`.** `rustup target add` gets you `std` and the compiler, but Cargo still needs to be told which linker to call for the target, or the final link fails.

6. **Assuming a dynamically-linked cross-built binary will "just run" on the target.** It needs its `.so` dependencies present at compatible versions *on the target*. Prefer static (musl / pure-Go) to make the binary self-sufficient.

---

## Test Yourself

1. Break down `x86_64-unknown-linux-musl` into its four fields and say what each controls. How does it differ from `x86_64-unknown-linux-gnu` in practice?
2. Distinguish **build**, **host**, and **target**. For cross-compiling a normal application, which two are usually equal, and which `./configure` flag do you set?
3. You installed `gcc-aarch64-linux-gnu` and `aarch64-linux-gnu-gcc hello.c` (using only libc) works — but linking against the target's OpenSSL fails. What's missing and why?
4. How does Clang's approach to multi-target compilation differ from GCC's, and why does that make Clang-based cross-compilation smoother?
5. What two things must you supply for Rust to cross-compile a *pure-Rust* binary to `aarch64-unknown-linux-gnu`? What additionally do you need if a `-sys` crate is involved?
6. Why does choosing a `musl` target often make a cross-compiled Linux binary "run anywhere of that arch," and what's the trade-off?

<details>
<summary>Answers</summary>

1. `x86_64` = arch (instruction set); `unknown` = vendor (cosmetic); `linux` = OS (ELF, Linux syscalls); `musl` = ABI/libc (musl instead of glibc). In practice the musl binary links a different C library and can be fully static, so it runs on systems (e.g. Alpine) where glibc isn't present; a `gnu` binary needs glibc at runtime.
2. **build** = where the toolchain was compiled; **host** = where the toolchain (your build) runs; **target** = where the *toolchain's output* runs. For a normal app, build == host; you set `--host` to your target (and leave `--target` alone — that's for building compilers).
3. A **sysroot** containing the *target's* OpenSSL headers and `libssl` is missing. libc works because the distro cross package ships a libc sysroot, but third-party libraries for the target aren't included — you must supply OpenSSL built for the target and point `--sysroot` at it.
4. GCC is built per-target (a separate `gcc` per triple); a single Clang knows all targets and you pick with `--target`. So with Clang you don't install a new compiler per architecture — one binary plus a flag (and a sysroot) cross-compiles anywhere.
5. (a) `rustup target add aarch64-unknown-linux-gnu` (downloads `std` for the triple) and (b) a cross *linker* configured in `.cargo/config.toml`. If a `-sys` crate pulls in C, you additionally need a cross C compiler and that library's target sysroot.
6. A musl target can link fully **statically**, so the binary carries its own libc and libraries and needs nothing from the target at runtime — it runs on any Linux of that architecture regardless of installed libc/versions. Trade-off: larger binary and you must rebuild to absorb library security fixes.

</details>

---

## Cheat Sheet

```
THE TRIPLE (four switches)
  aarch64 - unknown - linux - gnu
  ARCH      VENDOR    OS      ABI/LIBC
  arch  = instruction set        (x86_64, aarch64, arm, riscv64, wasm32)
  os    = syscalls + exec format (linux=ELF, darwin=Mach-O, windows=PE, none=baremetal)
  abi   = libc/runtime flavor    (gnu=glibc, musl, gnueabihf, msvc)  ← the silent one

THREE MACHINES
  build  = where the TOOLCHAIN was built
  host   = where the toolchain RUNS  (= where YOUR build runs)
  target = where the OUTPUT runs
  apps:      build==host;  ./configure --host=<target>
  toolchains: all three;   --build --host --target

CROSS-TOOLCHAIN
  GCC:   per-target, triple-prefixed   aarch64-linux-gnu-{gcc,ld,as,objdump}
  Clang: one binary + flag             clang --target=aarch64-linux-gnu
  install: apt-get install gcc-aarch64-linux-gnu

SYSROOT (the target's headers+libs on your disk)
  aarch64-linux-gnu-gcc --sysroot=/opt/aarch64-sysroot main.c -lssl
  libc ships with the cross pkg; 3rd-party libs you must supply for the target

RUST
  rustup target add aarch64-unknown-linux-gnu     # downloads std
  cargo build --target aarch64-unknown-linux-gnu
  .cargo/config.toml:  [target.<triple>] linker = "aarch64-linux-gnu-gcc"
  with C deps → use `cross` (containerized toolchain)

GO + CGO
  CGO_ENABLED=0  → pure Go, cross-compiles free (default when cross)
  CGO_ENABLED=1  → need cross C compiler:  CC=aarch64-linux-gnu-gcc ...

STATIC = SIMPLIFIER
  musl target → fully static → runs on ANY linux of that arch, no .so needed
  rustup target add x86_64-unknown-linux-musl
```

---

## Summary

- A **target triple** is four orthogonal choices: **arch** (instruction set), **vendor** (cosmetic), **OS** (syscalls + executable format), and **ABI/libc** (gnu vs musl vs msvc…). The ABI/libc field is the one most often mismatched because its effects only appear at runtime.
- Builds can involve **three** machines — **build** (where the toolchain was compiled), **host** (where it runs / where you build), **target** (where the output runs). For applications, build == host and you set autotools' `--host` to your target; the third machine appears only when building a toolchain.
- A **cross-toolchain** is a full set of host programs targeting one triple — GCC ships them per-target with triple prefixes; Clang uses one binary plus `--target`. The compiler is only half the job.
- The other half is the **sysroot**: the target's headers and libraries on your disk, pointed to with `--sysroot`. libc usually ships with the cross package; third-party libraries you must supply built for the target.
- **Rust** cross-compiles cleanly for pure-Rust code (`rustup target add` + a cross linker in `.cargo/config.toml`); C dependencies reintroduce the C toolchain/sysroot wall, which `cross` hides via containers.
- **CGO** flips Go from self-contained to C-dependent: `CGO_ENABLED=0` keeps cross-compilation free; `CGO_ENABLED=1` requires a cross `CC` (and a sysroot for third-party C libraries).
- **Static linking** (via **musl** or pure-Go) is the great simplifier: the binary carries its world, runs on any machine of that arch, and erases both the runtime-dependency risk and much of the sysroot burden.

[senior.md](senior.md) goes deeper into C/C++ toolchain files (CMake), the glibc/musl ABI angle, QEMU emulation vs true cross-compile, and multi-arch container images.

---

## Further Reading

- [LLVM/Clang — Cross-compilation](https://clang.llvm.org/docs/CrossCompilation.html) — triples, `--sysroot`, `--target`, concisely.
- [Rust — `cross` project](https://github.com/cross-rs/cross) — containerized cross-compilation that pre-bakes toolchains and sysroots.
- [Go wiki — cgo and cross-compilation](https://github.com/golang/go/wiki/cgo) — the canonical CGO caveats.
- [musl libc](https://musl.libc.org/) and the [`x86_64-linux-musl` cross toolchains](https://musl.cc/) — for fully static Linux binaries.

---

## Related Topics

- [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — symbols, `.a` vs `.so`, the ABI, and glibc — the substrate of sysroots and static linking.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how `cargo` and `go build` orchestrate the toolchain.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — pinning a toolchain + sysroot so a cross-build is hermetic and repeatable.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — making cross-built artifacts bit-for-bit reproducible across hosts.
- [senior.md](senior.md) — CMake toolchain files, QEMU vs true cross, multi-arch `docker buildx`.
