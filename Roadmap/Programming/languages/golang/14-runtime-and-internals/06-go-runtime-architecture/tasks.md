# Go Runtime Architecture — Practice Tasks

Twenty investigations to wire the Go runtime architecture into your hands. The goal is not to memorise diagrams of "M, P, G" — it is to learn *where* the runtime lives on disk, *how* it boots, and *what* changes when you flip a compiler or linker flag. By the end you can open `$(go env GOROOT)/src/runtime` and navigate it the way you navigate your own packages. Difficulty: **J**unior, **M**iddle, **S**enior, **Staff**.

Each task gives a Goal, a Starter (where useful), Hints, and a folded Reference solution. Read `junior.md` first — the three nouns *binary*, *boot sequence*, *runtime* are the spine of every task below. Most of the tasks have you running real commands against a real Go toolchain; copy them into a scratch directory and follow along, do not just read the references.

---

## Task 1 — Embed a version string via `-ldflags=-X` (J)

**Goal.** Build a Go program that prints a `Version` package-level string set at build time by `-ldflags=-X`. Then read the same value back through `runtime/debug.ReadBuildInfo` and reconcile what each source reports. This is the canonical "linker patches a global" trick every production Go binary uses for `--version`.

**Starter.**

```go
// file: main.go
package main

import "fmt"

// Version is patched by the linker at build time:
//   go build -ldflags="-X main.Version=v1.2.3" .
var Version = "dev"

func main() {
    fmt.Println("version:", Version)
}
```

**Hints.**

- `-X importpath.name=value` only works on **string** package-level variables. Not constants. Not `int`s. Not unexported names from outside the package (they have to be addressable from the linker symbol table, which means exported-or-in-main).
- `runtime/debug.ReadBuildInfo` returns module path, VCS info (`vcs.revision`, `vcs.time`, `vcs.modified`) — orthogonal to the `-X` patch. Both can coexist; one is *what the linker stamped*, the other is *what the build system observed*.
- Run `go tool nm ./yourbin | grep main.Version` after the build to prove the symbol actually exists in the binary.

<details><summary>Reference solution</summary>

```go
// file: main.go
package main

import (
    "fmt"
    "runtime/debug"
)

// Version is patched at link time. Default "dev" is what `go run` sees.
var Version = "dev"

// BuildTime is the second slot every production binary patches.
var BuildTime = "unknown"

func main() {
    fmt.Println("ldflags-stamped:")
    fmt.Println("  Version  :", Version)
    fmt.Println("  BuildTime:", BuildTime)

    info, ok := debug.ReadBuildInfo()
    if !ok {
        // ReadBuildInfo fails on `go run` or on binaries built without
        // module mode. In production it is always available.
        fmt.Println("\nno build info (likely `go run` or non-module build)")
        return
    }
    fmt.Println("\ndebug.ReadBuildInfo:")
    fmt.Println("  GoVersion:", info.GoVersion)
    fmt.Println("  Path     :", info.Path)
    fmt.Println("  Main     :", info.Main.Path, info.Main.Version)
    for _, s := range info.Settings {
        // Settings include build flags, GOOS/GOARCH, vcs.revision,
        // vcs.time, vcs.modified, CGO_ENABLED, GOAMD64, ...
        fmt.Printf("    %s=%s\n", s.Key, s.Value)
    }
}
```

Build and run:

```text
$ go build -ldflags="-X main.Version=v1.2.3 -X 'main.BuildTime=2026-05-28T10:00:00Z'" -o app .
$ ./app
ldflags-stamped:
  Version  : v1.2.3
  BuildTime: 2026-05-28T10:00:00Z

debug.ReadBuildInfo:
  GoVersion: go1.22.0
  Path     : example.com/app
  Main     : example.com/app (devel)
    -buildmode=exe
    -compiler=gc
    CGO_ENABLED=1
    GOARCH=amd64
    GOOS=darwin
    vcs=git
    vcs.revision=abcd1234...
    vcs.time=2026-05-28T09:55:00Z
    vcs.modified=true
```

The reconciliation: `Version` comes from the linker (patched into a `.data` section). VCS info comes from the build system snooping `git`. Both end up in the binary; both are reachable at runtime; neither knows about the other. Production tooling typically prints **both** because they answer different questions — "what release am I" (`Version`) vs "what commit was I" (`vcs.revision`).

A subtle gotcha: `vcs.modified=true` means the working tree was dirty. Some teams refuse to ship binaries where `vcs.modified=true`; that policy is enforced by the build pipeline reading `ReadBuildInfo` and bailing.

Verify the symbol made it into the binary:

```text
$ go tool nm ./app | grep main.Version
0x000000010012ab40 D main.Version
```

The `D` means "data segment, exported". The address (here `0x10012ab40`) is the actual byte the linker patched.

</details>

---

## Task 2 — Print the runtime identity quartet (J)

**Goal.** Write a program that prints `runtime.GOOS`, `runtime.GOARCH`, `runtime.Version()`, `runtime.NumCPU()`, `runtime.GOMAXPROCS(0)`, and the size of `uintptr` in bits. These are the six facts every "what host am I on" diagnostic dumps; knowing the difference between *compile-time constants* and *runtime queries* is the whole point.

**Hints.**

- `runtime.GOOS` and `runtime.GOARCH` are `const string`. They are baked in at compile time — cross-compile for arm64 and you get `"arm64"` even when running on amd64 (you won't be running there, but the value is fixed at build).
- `runtime.Version()` is a function but returns the Go toolchain version that built the binary, not the runtime *currently executing*. They are always the same on a vanilla build.
- `runtime.NumCPU()` is a syscall on Linux (reads `sched_getaffinity`) — affected by cgroups. `runtime.GOMAXPROCS(0)` reads (without setting) the current P count.

<details><summary>Reference solution</summary>

```go
// file: main.go
package main

import (
    "fmt"
    "runtime"
    "unsafe"
)

func main() {
    fmt.Println("=== compile-time constants ===")
    fmt.Println("GOOS         :", runtime.GOOS)
    fmt.Println("GOARCH       :", runtime.GOARCH)
    fmt.Println("uintptr bits :", unsafe.Sizeof(uintptr(0))*8)
    fmt.Println("Compiler     :", runtime.Compiler)

    fmt.Println("\n=== runtime queries ===")
    fmt.Println("Version()    :", runtime.Version())
    fmt.Println("NumCPU()     :", runtime.NumCPU())
    fmt.Println("GOMAXPROCS(0):", runtime.GOMAXPROCS(0))
    fmt.Println("NumGoroutine :", runtime.NumGoroutine())
    fmt.Println("NumCgoCall   :", runtime.NumCgoCall())
}
```

Output on a typical M2 Mac:

```text
=== compile-time constants ===
GOOS         : darwin
GOARCH       : arm64
uintptr bits : 64
Compiler     : gc

=== runtime queries ===
Version()    : go1.22.0
NumCPU()     : 10
GOMAXPROCS(0): 10
NumGoroutine : 1
NumCgoCall   : 0
```

The distinction that matters: `GOOS`/`GOARCH` are *constants the linker chose*. `NumCPU()` is a *runtime probe of the kernel*. If you cross-compile `GOARCH=arm64` on an amd64 host and copy the binary to an arm64 server with 4 cores, `GOOS`/`GOARCH` say "arm64" but `NumCPU()` says "4". They answer entirely different questions; conflating them is the bug behind half of "why is my Go binary slow in this container" tickets — folks read `GOARCH` and think they're done.

`GOMAXPROCS(0)` deserves its own attention. Go 1.5+ defaults it to `NumCPU()`. In a cgroup-constrained container (e.g. Kubernetes `cpu: 500m`), `NumCPU()` returns the host's core count, **not** the cgroup limit — so `GOMAXPROCS` is wrong. That's why production deployments either set `GOMAXPROCS` explicitly or use [`automaxprocs`](https://github.com/uber-go/automaxprocs).

Cross-compilation sanity check:

```text
$ GOOS=linux GOARCH=arm64 go build -o app-linux-arm64 .
$ file app-linux-arm64
app-linux-arm64: ELF 64-bit LSB executable, ARM aarch64, ...
```

The binary's `runtime.GOARCH` constant is now `"arm64"`, baked at the `go build` command. Only `NumCPU()` reflects the actual machine at run time.

</details>

---

## Task 3 — Disassemble main and find `runtime.newproc` (J)

**Goal.** Write a tiny `hello world` that launches one goroutine, compile it with `-gcflags=-l` (no inlining) so the call sites are explicit, and use `go tool objdump` to find the `runtime.newproc` call that the `go` statement compiled into. This is the first time most developers *see* that `go fn()` is just sugar for "push args, call runtime.newproc".

**Starter.**

```go
// file: hello.go
package main

import "fmt"

func say(s string) {
    fmt.Println(s)
}

func main() {
    go say("hi from goroutine")
    say("hi from main")
}
```

Build:

```text
$ go build -gcflags="all=-l" -o hello hello.go
```

**Hints.**

- `-gcflags="all=-l"` disables inlining for the *whole* dependency tree — without `all=`, only your local package is affected, and the runtime helpers stay inlined.
- `go tool objdump -s 'main\.main' hello` filters disassembly to one symbol. The output looks like assembly; you want to find `CALL runtime.newproc(SB)`.
- On arm64 the call looks like `BL runtime.newproc(SB)`; on amd64 it's `CALL runtime.newproc(SB)`. Same semantics.

<details><summary>Reference solution</summary>

```go
// file: hello.go
package main

import "fmt"

//go:noinline
func say(s string) {
    fmt.Println(s)
}

func main() {
    go say("hi from goroutine")
    say("hi from main")
}
```

```text
$ go build -gcflags="all=-l" -o hello hello.go
$ go tool objdump -s 'main\.main' hello | head -40
TEXT main.main(SB) /tmp/hello.go
  hello.go:11   0x10a0a00   ...                  SUBQ $0x30, SP
  hello.go:11   0x10a0a04   ...                  MOVQ BP, 0x28(SP)
  hello.go:11   0x10a0a09   ...                  LEAQ 0x28(SP), BP
  hello.go:12   0x10a0a0e   ...                  LEAQ go:string."hi from goroutine"(SB), AX
  hello.go:12   0x10a0a15   ...                  MOVQ $0x11, BX
  hello.go:12   0x10a0a1c   ...                  LEAQ main.main.func1(SB), CX
  hello.go:12   0x10a0a23   ...                  CALL runtime.newproc(SB)
  hello.go:13   0x10a0a28   ...                  LEAQ go:string."hi from main"(SB), AX
  hello.go:13   0x10a0a2f   ...                  MOVQ $0xc, BX
  hello.go:13   0x10a0a36   ...                  CALL main.say(SB)
  hello.go:14   0x10a0a3b   ...                  MOVQ 0x28(SP), BP
  hello.go:14   0x10a0a40   ...                  ADDQ $0x30, SP
  hello.go:14   0x10a0a44   ...                  RET
```

The four lines around `0x10a0a23` are the entire `go say(...)` translation:

1. Load the *closure* address into `CX` — `main.main.func1` is a compiler-generated wrapper containing the captured arguments and a tail call to `main.say`.
2. Load the *string data and length* into `AX:BX` — these go onto the new goroutine's stack as `say`'s argument.
3. `CALL runtime.newproc` — hand off to the scheduler. `newproc` allocates a `g` struct, copies the args, marks it runnable, and returns; the caller proceeds without waiting.

The crucial mental model: `go f()` is a *normal function call to `runtime.newproc`* that happens to push a closure pointer first. There is no compiler magic beyond closure synthesis and arg marshalling. Everything else — stack allocation, P/M pairing, schedpoint — lives in `runtime/proc.go`.

If you want to see the closure wrapper too:

```text
$ go tool objdump -s 'main\.main\.func1' hello | head -10
TEXT main.main.func1(SB)
  hello.go:12   ...   MOVQ $..., AX  ; load captured string addr
  hello.go:12   ...   MOVQ $..., BX  ; load captured length
  hello.go:12   ...   CALL main.say(SB)
  hello.go:12   ...   RET
```

That is the body the scheduler eventually picks up and runs as the new G.

Aside: rebuilding without `-l` shows `main.say` inlined into `main.main.func1` and into `main.main`; without the no-inline flag the assembly is genuinely confusing for a first read. Always disable inlining for **didactic** disassembly.

</details>

---

## Task 4 — Locate `rt0_linux_amd64.s` and trace into `rt0_go` (J)

**Goal.** Find the file `runtime/rt0_linux_amd64.s` (or your platform equivalent) in your local Go installation. Identify the entry function the kernel actually calls (`_rt0_amd64_linux`), then follow its branch into the platform-agnostic `rt0_go`. Write down — in plain English — the first three things `rt0_go` does before any Go code runs.

**Hints.**

- `go env GOROOT` tells you where the toolchain lives. The runtime source is under `$GOROOT/src/runtime/`.
- The files follow a strict naming convention: `rt0_<GOOS>_<GOARCH>.s` for the platform-specific entry shim, `asm_<GOARCH>.s` for the platform-agnostic body (`rt0_go`).
- On macOS arm64 the file is `rt0_darwin_arm64.s`; the body still lives in `asm_arm64.s::rt0_go`.

<details><summary>Reference solution</summary>

```text
$ go env GOROOT
/usr/local/go

$ ls $(go env GOROOT)/src/runtime/rt0_*.s | head -10
/usr/local/go/src/runtime/rt0_aix_ppc64.s
/usr/local/go/src/runtime/rt0_android_386.s
...
/usr/local/go/src/runtime/rt0_linux_amd64.s
/usr/local/go/src/runtime/rt0_darwin_amd64.s
/usr/local/go/src/runtime/rt0_darwin_arm64.s
...
```

Open `rt0_linux_amd64.s` and the entire file is short — roughly 30 lines:

```asm
// file: src/runtime/rt0_linux_amd64.s
#include "textflag.h"

TEXT _rt0_amd64_linux(SB),NOSPLIT,$-8
    JMP _rt0_amd64(SB)

TEXT _rt0_amd64_linux_lib(SB),NOSPLIT,$0
    JMP _rt0_amd64_lib(SB)
```

The kernel jumps into `_rt0_amd64_linux` when it execs the binary. That symbol is one instruction — `JMP _rt0_amd64` — into `asm_amd64.s`. Conceptually: the per-platform file knows the ABI (how argc/argv are passed by *this* kernel), and immediately dispatches to the per-architecture body.

`_rt0_amd64` (in `asm_amd64.s`) then forwards to `rt0_go`. The first three steps of `rt0_go` (paraphrased — read the file for the exact assembly):

1. **Set up the g0 stack.** `g0` is the *first* goroutine — the one that runs scheduler code and signal handlers. It uses the OS-provided stack (not a heap-allocated Go stack). `rt0_go` records the stack bounds in the `g0` struct.

2. **Initialise TLS.** Each OS thread needs a "current g" pointer, kept in TLS (thread-local storage). The code that runs Go has to be able to ask "which goroutine am I" in O(1); TLS is how. `rt0_go` calls platform-specific `settls` or sets the FS/GS base register directly.

3. **Detect CPU features.** Routines like `runtime·cpuinit` probe `CPUID` for AES, SSE4, AVX2 support; the results gate optimised paths in `crypto/aes`, `bytes.Equal`, the GC. After this, the runtime knows what *this* CPU can do.

Only then does `rt0_go` call `runtime·args`, `runtime·osinit`, and finally `runtime·schedinit` — the next task.

To see the actual assembly:

```text
$ less $(go env GOROOT)/src/runtime/asm_amd64.s
/rt0_go            # search for TEXT runtime·rt0_go
```

The function is ~200 lines and dense. Read the comments — they explicitly explain the ABI handover and the g0 setup. Reading once is enough; you do not need to memorise the SP arithmetic. What you need is the *map*: kernel -> `rt0_<GOOS>_<GOARCH>` -> `_rt0_<GOARCH>` -> `rt0_go` -> Go-land. That sequence is constant across Linux/Darwin/Windows/BSD; only the first hop changes.

</details>

---

## Task 5 — Read `runtime.schedinit` and list the 12 sub-steps (M)

**Goal.** Open `$GOROOT/src/runtime/proc.go` and find `func schedinit()`. Read the body and produce an ordered list of the major initialisation steps it performs. There are around 12 distinct phases (the exact count depends on Go version); the point is internalising the order — *which subsystem depends on which*.

**Hints.**

- `schedinit` is called once, by `rt0_go`, on the g0 goroutine before any user code runs. After it returns, the runtime is "operational" but no goroutines other than g0/m0 exist yet.
- Many steps initialise lazily — `schedinit` only puts the structures *in place*; the actual work happens on first use. Note which steps are "create memory layout" vs "actually allocate".
- Look at the imports inside each helper (`mcommoninit`, `lockInit`, `stackinit`, `mallocinit`, ...) to figure out what each touches.

<details><summary>Reference solution</summary>

Reading Go 1.22's `runtime/proc.go` `schedinit` from top to bottom, the steps in order are roughly:

1. **`lockInit(&sched.lock, lockRankSched)`** — Set up the lock-rank metadata for the global scheduler lock. The rank checker (debug build only) refuses to acquire higher-ranked locks while holding lower-ranked ones; this is how Go prevents deadlocks among its own internal mutexes.

2. **`raceinit()`** — If the race detector is enabled (binary was built with `-race`), initialise the ThreadSanitizer runtime. No-op otherwise.

3. **`sched.maxmcount = 10000`** — Cap the number of OS threads the runtime is willing to allocate. This is the famous "fatal error: thread limit reached" ceiling.

4. **`worldStopped()`** — Mark the world as stopped. Until P initialisation completes, no scheduler activity is permitted; this assert-style call enforces that.

5. **`moduledataverify()`** — Walk the per-module metadata (one entry per linked Go module — main + every shared object) and sanity-check it. Catches a corrupted binary at boot rather than at first symbol lookup.

6. **`stackinit()`** — Initialise the per-P stack cache pools. Stacks come from a freelist; `stackinit` zeros the head pointers.

7. **`mallocinit()`** — Initialise the memory allocator (mheap, mcentral, page allocator metadata). This is the heaviest step — sets up the arena, the page table, the central cache pointers. After this, `mallocgc` is callable.

8. **`fastrandinit()`** — Seed the per-P fast random number generator. Used internally by the scheduler for work-stealing and by `runtime.fastrand`.

9. **`mcommoninit(_g_.m, -1)`** — Initialise m0 (the main OS thread). This includes signal-stack allocation, m-list linking, and TLS hookup.

10. **`cpuinit()`** — Detect CPU features (CPUID on amd64, ID_AA64ISAR0_EL1 reads on arm64). Stores results in `internal/cpu.X86.HasAVX2` and friends.

11. **`alginit()`** — Initialise the map hash functions. Specifically, generates the hash seeds and selects between AES-NI and Wyhash based on the CPU detection above. After this, maps are usable.

12. **`modulesinit()` and `typelinksinit()`** — Build the type-link tables used by `reflect`, `interface`, and `cgo`. These walk the per-module metadata that `moduledataverify` already validated and produce the in-memory lookups.

13. **`itabsinit()`** — Pre-populate the interface table cache for known (type, interface) pairs from the module data.

14. **`stkobjinit()`** — Initialise the stack-object allocator used during garbage-collection precise scanning.

15. **`mp.helpgc = 0`** (and friends) — Reset per-m GC bookkeeping.

16. **`gcinit()`** — Initialise GC state (mark queue, write barrier flags, gcController). After this, the GC could be invoked.

17. **`procresize(procs)`** — *Create* the P array. Counts from `GOMAXPROCS` (env or default = NumCPU). Allocates `len(allp) = procs` `p` structs, links them, and binds the calling m to `allp[0]`. After this the scheduler has work-stealing queues, P/M pairing slots, and is ready to run user code.

The dependency story to internalise:

- **`mallocinit` before everything that allocates.** That includes `alginit` (which allocates seeds) and `mcommoninit` (which allocates an m struct).
- **`cpuinit` before `alginit`.** `alginit` reads `internal/cpu.X86.HasAES` to decide hash algorithm — that flag is set by `cpuinit`.
- **`procresize` last.** It is the trigger; once it returns, work-stealing can begin. Everything before it is preparation.

A practical experiment: insert `print("step N")` lines (well, modify a *local copy* of Go in `~/go-src` and rebuild) and re-run a hello-world. You will see the prints flood out before `main()` executes. That is `schedinit`.

</details>

---

## Task 6 — Binary size with and without `-s -w` (M)

**Goal.** Build a non-trivial Go program (say, anything that imports `net/http`) twice — once with default flags, once with `-ldflags="-s -w"`. Compare binary sizes with `ls -l` and `go tool nm | wc -l`. Explain in 4-6 sentences exactly what `-s` and `-w` strip.

**Starter.**

```go
// file: main.go
package main

import (
    "fmt"
    "net/http"
)

func main() {
    fmt.Println(http.StatusText(http.StatusOK))
}
```

**Hints.**

- `-s` strips the **symbol table** (no `nm` output, no `go tool addr2line` resolution).
- `-w` strips **DWARF debug info** (no source-level `delve`, no per-line stack traces in core dumps).
- The Go runtime still has its own internal *function table* (`pclntab`) — `-s -w` does **not** strip that, so panics still show file:line. Stripping pclntab needs `-trimpath` plus more aggressive tricks.

<details><summary>Reference solution</summary>

```text
$ go build -o app-default main.go
$ go build -ldflags="-s -w" -o app-stripped main.go
$ ls -l app-default app-stripped
-rwxr-xr-x  1 user  staff  7541264 May 28 10:00 app-default
-rwxr-xr-x  1 user  staff  5320560 May 28 10:00 app-stripped
$ go tool nm app-default   | wc -l
   18432
$ go tool nm app-stripped  | wc -l
       0
$ go tool objdump -s 'main\.main' app-default   2>&1 | head -2
TEXT main.main(SB) /tmp/main.go
  main.go:8  0x10a0a00  ...  SUBQ $0x10, SP
$ go tool objdump -s 'main\.main' app-stripped  2>&1 | head -2
go: objdump tool not yet supported on darwin/arm64 for stripped binaries
# (or on linux: "no symbols", "no DWARF info")
```

So:

- **Size delta**: roughly 30% smaller. The exact ratio depends on the program; the stripped sections are proportional to dependency count and source-line density.
- **`-s` strips the symbol table.** That table maps `name -> address`. Tools that need it: `nm`, `go tool addr2line`, `pprof` (for symbolising profiles taken with non-Go tools like `perf`), `delve` (for setting breakpoints by name). Tools that **don't** need it: the runtime itself, panic stack-trace printing, `pprof` collecting profiles via the Go runtime API (because the runtime keeps its own function table).
- **`-w` strips DWARF debug info.** DWARF is the cross-platform debug format that maps "byte at address X" to "source file:line:column" and "this stack frame has variable named foo at offset -8(BP)". Stripping DWARF disables: source-level debugging in `delve`, full backtraces in `gdb`, line-accurate profiling in non-Go tools, core-dump analysis showing local variables. It does **not** disable: Go panic stack traces (these use `pclntab`, a Go-specific structure that is *not* DWARF and is *not* affected by `-w`), `runtime.Caller`/`Callers` (also `pclntab`), pprof CPU/heap profiles (the runtime symbolises them itself).

Crucial subtlety: **`pclntab`** (program counter line table) is the table the *runtime* uses to print stack traces. It is a separate structure from the symbol table and from DWARF. `-s -w` leaves it intact, which is why panics in a `-s -w` binary still look like:

```text
panic: runtime error: ...
goroutine 1 [running]:
main.main()
    /tmp/main.go:8 +0x18
```

You still see file:line. You just don't see them in `gdb` or `delve`. For production binaries this is the standard trade-off: keep the user-visible stack traces, lose the 2MB of DWARF nobody reads in steady-state.

Want **really** small? `go build -ldflags="-s -w" -trimpath` removes the build-machine paths from `pclntab`. To truly hide source paths you also `upx --best` the result — but `upx` breaks `dlopen` and confuses some antivirus heuristics, so production rarely uses it.

A reality check on what the bytes are:

```text
$ go build -o app main.go
$ go tool nm app | sort | head
... data
... bss
... rodata
... text
... pclntab
... DWARF .debug_info
... DWARF .debug_line
... DWARF .debug_loc
... DWARF .debug_pubnames
```

`-w` chops everything starting with `.debug_*`. `-s` chops the public symbol table. Both are *post-link* operations on already-linked sections; the linker itself runs the same.

</details>

---

## Task 7 — Full stack trace via `runtime.Callers` + `CallersFrames` (M)

**Goal.** Write a `Trace()` helper that returns a string containing the current goroutine's stack as `func\n  file:line\n` lines, using `runtime.Callers` to get the PC slice and `runtime.CallersFrames` to expand each PC into a frame. Call it from three nested functions and verify the output names all three.

**Starter.**

```go
package main

import (
    "fmt"
    "runtime"
)

func Trace() string {
    // TODO: collect PCs via runtime.Callers, expand via runtime.CallersFrames,
    // format each frame as "  funcname\n    file:line\n".
    return ""
}

func c() string { return Trace() }
func b() string { return c() }
func a() string { return b() }

func main() {
    fmt.Println(a())
}
```

**Hints.**

- `runtime.Callers(skip, pc)` fills `pc` with PCs. `skip=0` includes `runtime.Callers` itself; `skip=1` skips it; `skip=2` skips both `Callers` and the immediate caller. For a `Trace()` helper you usually want `skip=2` so the helper doesn't appear in its own output.
- The first frame returned from `CallersFrames.Next()` is the *innermost* (deepest) — the caller of `Callers`. You iterate `Next()` until `more == false`.
- A PC pointing to inlined code is fully handled by `CallersFrames` — modern Go (1.12+) walks the inline tree for you. Don't use `FuncForPC` for this; it lies about inlines.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "strings"
)

// Trace returns a formatted stack trace of the current goroutine,
// excluding Trace itself.
func Trace() string {
    // Senior decision: 64 frames is plenty for almost every real
    // program. Pre-size the slice instead of growing — runtime.Callers
    // is allowed to ignore frames that don't fit.
    pcs := make([]uintptr, 64)
    // skip=2: 0 is runtime.Callers, 1 is Trace, 2 is the caller of Trace.
    n := runtime.Callers(2, pcs)
    if n == 0 {
        return "(no stack)"
    }
    pcs = pcs[:n]

    var b strings.Builder
    frames := runtime.CallersFrames(pcs)
    for {
        frame, more := frames.Next()
        // frame.Function is the fully-qualified name, e.g.
        //   "main.b" or "net/http.(*Server).Serve".
        // frame.File and frame.Line point at the source location.
        // frame.Entry is the function's start PC (handy for cross-
        // referencing with `go tool addr2line`).
        fmt.Fprintf(&b, "  %s\n    %s:%d\n", frame.Function, frame.File, frame.Line)
        if !more {
            break
        }
    }
    return b.String()
}

func c() string { return Trace() }
func b() string { return c() }
func a() string { return b() }

func main() {
    fmt.Print(a())
}
```

Output:

```text
  main.c
    /tmp/main.go:30
  main.b
    /tmp/main.go:31
  main.a
    /tmp/main.go:32
  main.main
    /tmp/main.go:35
  runtime.main
    /usr/local/go/src/runtime/proc.go:267
  runtime.goexit
    /usr/local/go/src/runtime/asm_amd64.s:1650
```

A few things to note in the output:

- **The bottom two frames are `runtime`.** `runtime.main` is the function the scheduler runs as goroutine 1's body; it calls `init` for every package and then `main.main`. `runtime.goexit` is the universal "every G ends here" trampoline that cleans up the G's stack and returns it to the freelist.
- **No `Trace` in the output.** That's the `skip=2` paying off. Adjust to `skip=1` if you want to see `Trace` listed.
- **Frame ordering is stack-down** (innermost first). To print "main at top, deepest at bottom" you'd reverse the slice or use a deque.

A wrinkle worth knowing: **inlined frames** in Go 1.12+ are correctly expanded by `runtime.CallersFrames`. Compare to `runtime.FuncForPC(pc).Name()` which returns only the *outermost* function for an inlined PC — so a stack trace built with `FuncForPC` silently collapses frames and looks wrong. Always use `CallersFrames` for traces.

The classic real-world use of this pattern is **error wrapping**. Pre-Go 1.13 (and still in libraries like `pkg/errors`), every wrapped error captured a stack at construction:

```go
func Errorf(format string, args ...any) error {
    return &tracedError{
        msg:   fmt.Sprintf(format, args...),
        stack: Trace(),
    }
}
```

The cost: ~3 µs per call (the `CallersFrames` walk dominates). The benefit: every error in a log already carries the answer to "where did this come from". Production logging libraries (`zap`, `zerolog`) integrate the same trick optionally so you pay only when you `.Error()` is called, not when you wrap.

</details>

---

## Task 8 — `debug.ReadBuildInfo` for VCS and module info (M)

**Goal.** Read every field of `debug.ReadBuildInfo()` and print: module path, Go toolchain version, every direct dependency with `(Path, Version, Sum)`, and the four most operationally important Settings keys: `vcs.revision`, `vcs.time`, `vcs.modified`, `CGO_ENABLED`. Demonstrate by running it against a module with non-trivial dependencies.

**Hints.**

- `ReadBuildInfo()` returns `(*BuildInfo, bool)`. The `bool` is `false` for binaries built without modules (Go's own toolchain, `go run`-style ephemeral binaries before 1.18).
- `info.Deps` is a `[]*Module` containing *every* transitive dependency that contributed code to the binary, not just direct imports.
- `info.Settings` is a flat `[]BuildSetting{Key, Value}` slice. Convert it to a map once for ergonomic access.

<details><summary>Reference solution</summary>

```go
// file: main.go
package main

import (
    "fmt"
    "runtime/debug"
    "sort"
)

func main() {
    info, ok := debug.ReadBuildInfo()
    if !ok {
        fmt.Println("no build info available")
        return
    }

    fmt.Println("=== Module ===")
    fmt.Printf("  Path     : %s\n", info.Main.Path)
    fmt.Printf("  Version  : %s\n", info.Main.Version)
    fmt.Printf("  Sum      : %s\n", info.Main.Sum)
    fmt.Printf("  GoVersion: %s\n", info.GoVersion)

    // Build settings -> map for easy lookup.
    settings := make(map[string]string, len(info.Settings))
    for _, s := range info.Settings {
        settings[s.Key] = s.Value
    }

    fmt.Println("\n=== VCS (operationally critical) ===")
    fmt.Printf("  vcs.revision : %s\n", settings["vcs.revision"])
    fmt.Printf("  vcs.time     : %s\n", settings["vcs.time"])
    fmt.Printf("  vcs.modified : %s\n", settings["vcs.modified"])
    fmt.Printf("  CGO_ENABLED  : %s\n", settings["CGO_ENABLED"])

    fmt.Println("\n=== All Settings ===")
    keys := make([]string, 0, len(settings))
    for k := range settings {
        keys = append(keys, k)
    }
    sort.Strings(keys)
    for _, k := range keys {
        fmt.Printf("  %-20s = %s\n", k, settings[k])
    }

    fmt.Println("\n=== Direct + Transitive Deps ===")
    fmt.Printf("  %d modules pulled in\n", len(info.Deps))
    for _, d := range info.Deps {
        line := fmt.Sprintf("  %s@%s %s", d.Path, d.Version, d.Sum)
        if d.Replace != nil {
            line += fmt.Sprintf(" => %s@%s", d.Replace.Path, d.Replace.Version)
        }
        fmt.Println(line)
    }
}
```

Sample output running on a project that imports `net/http`, `github.com/spf13/cobra`, and a few others:

```text
=== Module ===
  Path     : example.com/svc
  Version  : (devel)
  Sum      :
  GoVersion: go1.22.0

=== VCS (operationally critical) ===
  vcs.revision : 9a8b7c6d5e4f3210...
  vcs.time     : 2026-05-28T09:00:00Z
  vcs.modified : false
  CGO_ENABLED  : 1

=== All Settings ===
  -buildmode           = exe
  -compiler            = gc
  -ldflags             = -X main.Version=v1.2.3
  CGO_CFLAGS           =
  CGO_CPPFLAGS         =
  CGO_CXXFLAGS         =
  CGO_ENABLED          = 1
  CGO_LDFLAGS          =
  GOARCH               = amd64
  GOOS                 = linux
  GOAMD64              = v1
  vcs                  = git
  vcs.modified         = false
  vcs.revision         = 9a8b7c6d5e4f3210...
  vcs.time             = 2026-05-28T09:00:00Z

=== Direct + Transitive Deps ===
  12 modules pulled in
  github.com/inconshreveable/mousetrap@v1.1.0 h1:...
  github.com/spf13/cobra@v1.8.0 h1:...
  github.com/spf13/pflag@v1.0.5 h1:...
  ...
```

The four operationally critical Settings deserve scrutiny:

- **`vcs.revision`** — Exact git SHA. Production runbook: every binary's `/healthz` or `--version` must surface this. Pair an alert's payload with this value and you can `git diff` instantly between "broken" and "working" deployments.
- **`vcs.time`** — Commit timestamp. Not build timestamp (which moves whenever you re-build the same SHA). Means "the source you compiled was last touched at X".
- **`vcs.modified`** — `"true"` if the working tree had uncommitted changes at build time. Many shops gate prod releases on this being `"false"`.
- **`CGO_ENABLED`** — Whether the binary contains any cgo. Has consequences for: static linking (cgo binaries can't be statically linked to musl without effort), Alpine deployments (need libc compatibility), debugging (cgo crashes look different from pure-Go panics).

A small Go-version trivia: `vcs.*` settings were added in Go 1.18. Before that you had to embed the SHA yourself via `-ldflags=-X`. Modern Go gives you VCS info **for free**; the manual `-X` embedding is now backup-and-belt.

Worth knowing — the `Deps` list shows the *frozen* version that the binary was built against, complete with module sum. This is your offline-proof attestation of "what was in the binary"; pair it with the `go.sum` file and you have a reproducible build manifest. SBOM (software bill of materials) tools that scan Go binaries read exactly this data.

</details>

---

## Task 9 — Recover a panic and inspect via `runtime.Stack` (M)

**Goal.** Write a function that deliberately panics inside three layers of nested calls. The top-level wrapper has a `defer recover()` that, on recover, calls `runtime.Stack(buf, false)` to capture the *current goroutine's* stack and writes it to stderr. Demonstrate that the captured stack contains all three layers — recovery happens **after** the unwind, but the stack snapshot is taken **during** the recover, when the runtime still has the frames available.

**Starter.**

```go
package main

import (
    "fmt"
    "runtime"
)

func deep() {
    panic("boom")
}

func middle() {
    deep()
}

func outer() {
    defer func() {
        if r := recover(); r != nil {
            // TODO: capture stack with runtime.Stack(buf, false)
            // and print both r and the stack.
        }
    }()
    middle()
}

func main() {
    outer()
    fmt.Println("survived")
}
```

**Hints.**

- `runtime.Stack(buf []byte, all bool) int` — `all=false` gives the calling goroutine, `all=true` gives every goroutine (the same dump you see on `kill -SIGQUIT` of a Go program). Returns bytes written.
- A reasonable buffer is 64KB. If the trace is bigger, you've lost a tail; production logging libs grow until `n < len(buf)`.
- The stack must be captured **inside the deferred function**, not stored and printed later. By the time `outer` returns, the frames are gone.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "runtime"
)

func deep() {
    panic("boom from deep")
}

func middle() {
    deep()
}

func outer() {
    defer func() {
        if r := recover(); r != nil {
            // Senior decision: capture the stack INSIDE the deferred
            // function, while the runtime is still mid-unwind. The
            // panic frames are reachable here. Once outer() returns
            // they are torn down.
            buf := make([]byte, 64<<10) // 64 KiB
            n := runtime.Stack(buf, false)
            // Note: even though this is `false` (current goroutine
            // only), the trace includes the panicking frames because
            // recover() halted the unwind and we are now executing
            // ON those frames.
            fmt.Fprintf(os.Stderr, "panic recovered: %v\n", r)
            fmt.Fprintf(os.Stderr, "stack at recover:\n%s\n", buf[:n])
            // Optionally: re-panic if the recovery is logging-only.
            //   panic(r)
        }
    }()
    middle()
}

func main() {
    outer()
    fmt.Println("survived after recovery")
}
```

Output to stderr:

```text
panic recovered: boom from deep
stack at recover:
goroutine 1 [running]:
main.outer.func1()
    /tmp/main.go:18 +0x6e
panic({0x1057200?, 0x10b3578?})
    /usr/local/go/src/runtime/panic.go:914 +0x21f
main.deep(...)
    /tmp/main.go:7
main.middle(...)
    /tmp/main.go:11
main.outer()
    /tmp/main.go:24 +0x65
main.main()
    /tmp/main.go:33 +0x18
```

To stdout:

```text
survived after recovery
```

Several mechanisms are visible in this trace:

- **`main.outer.func1`** — The deferred closure. The first frame, because that is what is currently executing during the recovery.
- **`panic(...)` in `runtime/panic.go`** — The runtime function that actually starts the unwind. Every Go panic passes through this; it is the universal entry point.
- **`main.deep(...)`** without an explicit PC offset and with `(...)` — These are **inlined** frames as Go 1.12+ knows about them. The exact rendering varies; the point is that `runtime.Stack` returns *logical* frames, not raw machine frames.
- **No `runtime.gopanic` between `panic` and `main.deep`** — In some versions `gopanic` is the actual symbol name. The output formatter elides intermediate runtime helpers when they are pure plumbing.

The **lifetime trap** worth memorising: if you capture the stack like this:

```go
var savedStack []byte
defer func() {
    if r := recover(); r != nil {
        savedStack = make([]byte, 64<<10)
        n := runtime.Stack(savedStack, false)
        savedStack = savedStack[:n]
    }
}()
panic("...")
// later, after outer() returns:
log.Println(string(savedStack)) // STILL works — it's just bytes
```

That works because `savedStack` is a byte slice that survives the function return. But if you tried to capture `[]runtime.Frame` and dereference *those* after return, you'd be fine too — `Frame` is a value type, no dangling pointers. The danger is purely that the *raw frames on the stack* are gone after the defer returns; the snapshot bytes are not.

`runtime.Stack(_, true)` — capturing **all** goroutines — is the gold-standard "what was happening when this exploded" dump. Production crash handlers always grab `(_, true)` so a hang in one goroutine doesn't hide which other goroutines were stuck. Cost: O(N) where N is goroutine count, plus a stop-the-world pause to consistently snapshot.

A real-world pattern from `net/http`:

```go
// http/server.go — paraphrased
func (c *conn) serve(ctx context.Context) {
    defer func() {
        if err := recover(); err != nil && err != ErrAbortHandler {
            const size = 64 << 10
            buf := make([]byte, size)
            buf = buf[:runtime.Stack(buf, false)]
            c.server.logf("http: panic serving %v: %v\n%s",
                c.remoteAddr, err, buf)
        }
        ...
    }()
    ...
}
```

Same pattern, in production code. The deferred recover + stack dump is *the* idiom for "I want to keep serving even if one handler explodes, but I refuse to drop the diagnostic info".

</details>

---

## Task 10 — Trace the boot sequence with `runtime/trace` (M)

**Goal.** Write a small program that does almost nothing — initialises one package, spawns a few goroutines, returns — but wrap its main with `runtime/trace.Start(file)` / `trace.Stop()`. Then view the trace with `go tool trace trace.out` and identify the boot-phase events: `proc start`, `goroutine create`, `GC start`, first `task` event, scheduler ticks.

**Starter.**

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    // Do something modest.
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            _ = i * i
        }(i)
    }
    wg.Wait()
}
```

**Hints.**

- `go tool trace trace.out` opens a localhost web UI. The "View trace" link shows a timeline; "Goroutine analysis" shows per-goroutine summary; "Network blocking profile" and others are zero-event but visible.
- The first events you see are *not* `main.main` — they are the runtime initialising the GC, creating Ps, finishing schedinit. These appear in the first few microseconds of the trace.
- The Go execution tracer is *not* DWARF, *not* pprof — it is a third format. Internally it logs scheduler events into per-P ring buffers and writes them on `Stop`.

<details><summary>Reference solution</summary>

```go
// file: main.go
package main

import (
    "context"
    "log"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    // Annotated region — shows up as a "task" in the trace UI.
    ctx, task := trace.NewTask(context.Background(), "boot-demo")
    defer task.End()

    trace.WithRegion(ctx, "spawn-workers", func() {
        var wg sync.WaitGroup
        for i := 0; i < 4; i++ {
            wg.Add(1)
            go func(i int) {
                defer wg.Done()
                trace.WithRegion(ctx, "worker", func() {
                    _ = i * i
                })
            }(i)
        }
        wg.Wait()
    })
}
```

```text
$ go run .
$ go tool trace trace.out
2026/05/28 10:00:00 Parsing trace...
2026/05/28 10:00:00 Splitting trace...
2026/05/28 10:00:00 Opening browser. Trace viewer is listening on http://127.0.0.1:50678
```

In the browser, click "View trace". You see a multi-row timeline:

- **Top row(s): GC, NetPoll, Heap.** System-level events.
- **PROC 0..N rows: per-P timeline.** What ran on each scheduler P.
- **Goroutine N rows (when zoomed).** Individual goroutine lifecycles.

Zoom to the leftmost edge (first microseconds). You will see:

1. **`runtime.schedinit` doesn't appear explicitly** — the tracer starts emitting events *after* `trace.Start` is called, which is inside `main`. By then schedinit is done. To trace schedinit itself you have to enable the tracer earlier (set `GODEBUG=traceback=1` or use `GOTRACEBACK=crash` for a different purpose, or rebuild with `-tags=trace` patched into the runtime — non-trivial).
2. **First visible events: `Proc start`.** As workers spawn and Ps acquire them. Each goroutine appears as a horizontal segment on its P.
3. **`Goroutine create` markers.** A small triangle when one goroutine spawns another. Visible when you click the spawning goroutine — you can follow the line to the spawned one.
4. **GC events.** If your program is small enough not to trigger GC, this row stays empty. Inflate by allocating in the workers (`_ = make([]byte, 1024)`) to see a `GC start -> GC mark -> GC mark assist -> GC sweep` cycle.
5. **Task: `boot-demo`.** The `trace.NewTask` we created. Visible in the "User tasks" view (also accessible at `/usertasks` on the trace UI).
6. **Region: `spawn-workers` and `worker`.** Visible in the "User-defined regions" view; also rendered as coloured bars on the relevant Goroutine row.

What the trace teaches you about the boot order:

- `main.main` does **not** start at time 0. There is always a ~50-500 µs gap during which `runtime.main`, `runtime.schedinit`, `init` for all packages, and GC setup run. The trace doesn't capture this because the tracer is off until you call `trace.Start`, but you can *infer* it from "where is event 0?" being non-zero relative to process start.
- The four worker goroutines spawn essentially in parallel (microseconds apart) and the scheduler distributes them across the available Ps. On a 10-P machine, all 4 are picked up immediately by 4 distinct Ps.
- `runtime.gcStart` only fires if the heap grew enough during the trace. For a tiny program it never fires. Add a 100MB allocation and you'll see the entire GC cycle, including `STW (Stop-The-World)` markers as thin vertical lines.
- The `runtime.goexit` symbol is the universal end-of-goroutine; when a worker finishes, its goroutine row ends at `goexit`. This is the same `goexit` that appeared in Task 7's stack trace.

Production usage:

- **`go tool trace` is the right tool for "what was every goroutine doing for that 200ms spike"?** pprof aggregates over time; the tracer is event-by-event.
- **Trace files are large.** A 1-second trace of a busy server is easily 100MB+. Standard ops practice: collect short traces (`runtime/trace.Start` for 1-5 seconds), not 10-minute ones.
- **The tracer has overhead.** Roughly 10-30% throughput cost when active. Use it for diagnosis, not for production-always observability.

</details>

---

## Task 11 — Read `runtime·rt0_go` first 30 lines and summarise (S)

**Goal.** Open `$GOROOT/src/runtime/asm_amd64.s` and read the first ~30 lines of `TEXT runtime·rt0_go`. Write a paragraph summary of what those lines do, instruction by instruction. This is the *first* Go code (well, assembly) to run; understanding it bridges "the kernel called my binary" with "schedinit can now allocate memory".

**Hints.**

- The Go assembler uses a pseudo-assembly. `SUBQ $24, SP` subtracts 24 from the stack pointer (allocating stack space). `MOVQ AX, x(SP)` stores AX at offset x from SP. The conventions look like Plan 9; comments are sparse but present.
- The first job of `rt0_go` is to **set up the g0 stack**. `g0` is a special goroutine that runs runtime code — it uses the OS-provided stack, not a heap-allocated Go stack.
- You will see `runtime·g0`, `runtime·m0` referenced as global symbols. Those are the initial goroutine and initial machine (OS thread) — pre-allocated singletons in `runtime/proc.go`.

<details><summary>Reference solution</summary>

Open the file:

```text
$ less +/'TEXT runtime·rt0_go' $(go env GOROOT)/src/runtime/asm_amd64.s
```

The first ~30 lines of `rt0_go` (Go 1.22, paraphrased — line numbers and minor details vary by version):

```asm
TEXT runtime·rt0_go(SB),NOSPLIT|TOPFRAME,$0
    // copy argc, argv
    MOVQ    DI, AX        // argc
    MOVQ    SI, BX        // argv
    SUBQ    $(5*8), SP    // 3 args + 2 slots for AX, BX
    ANDQ    $~15, SP      // align stack to 16
    MOVQ    AX, 24(SP)
    MOVQ    BX, 32(SP)

    // create istack out of the given (operating system) stack.
    // _cgo_init may update stackguard.
    MOVQ    $runtime·g0(SB), DI       // g0 = the special "scheduler" goroutine
    LEAQ    (-64*1024)(SP), BX        // 64 KiB below current SP
    MOVQ    BX, g_stackguard0(DI)     // record stack lower bound
    MOVQ    BX, g_stackguard1(DI)
    MOVQ    BX, (g_stack+stack_lo)(DI)
    MOVQ    SP, (g_stack+stack_hi)(DI)

    // find out information about the processor we're on
    MOVL    $0, AX
    CPUID
    CMPL    AX, $0
    JE      nocpuinfo
    ...
```

Plain-English summary, in order:

1. **`MOVQ DI, AX` / `MOVQ SI, BX`** — On Linux/amd64, the kernel calls our entry point with `argc` in DI and `argv` in SI (per System V AMD64 ABI). We move them into safer registers because the upcoming `CALL`s will trash DI/SI.

2. **`SUBQ $(5*8), SP` / `ANDQ $~15, SP`** — Reserve 40 bytes of stack space for our own use, then align SP to a 16-byte boundary. Required by the ABI before calling C-ish functions (which `_cgo_init` is). The alignment step throws away up to 15 bytes of stack; that's fine — we have 8MB.

3. **`MOVQ AX, 24(SP) / MOVQ BX, 32(SP)`** — Stash argc and argv on the (now aligned) stack. We'll need them later when calling `runtime.args(argc, argv)`.

4. **`MOVQ $runtime·g0(SB), DI`** — Load the address of the global `g0` (declared in `runtime/proc.go` as `var g0 g`). `(SB)` is the static-base addressing mode — `runtime·g0(SB)` is the absolute address of that symbol after relocation.

5. **`LEAQ (-64*1024)(SP), BX`** — Compute `SP - 64KiB`. This is the lower bound we'll claim for the g0 stack. The OS gave us a stack of (typically) 8MB; we declare the bottom 64KiB usable for runtime work. The kernel will SIGSEGV if anyone walks past the real bottom; the 64KiB is a *Go-side* safety check (the stack-growth check).

6. **`MOVQ BX, g_stackguard0(DI)` etc.** — Write that 64KiB-below-SP address into four fields of the g0 struct: `stackguard0` (the main growth check), `stackguard1` (cgo growth check), `stack.lo` (low bound), `stack.hi` (high bound). After these writes, **g0 has a valid stack descriptor** and stack-growth probes (`MORESTACK`) will route correctly.

7. **`MOVL $0, AX` / `CPUID`** — Probe CPUID with EAX=0. Returns in EAX the highest supported CPUID leaf; in EBX/ECX/EDX the vendor string. The runtime uses this to decide which optimised routines to enable (AVX2, AES-NI, ADX). If CPUID returns 0 (impossible on real x86-64 but defensive), jump to `nocpuinfo` and skip feature detection.

8. **Subsequent lines (not shown above)** — Set up TLS via `MOVQ $setg_gcc<>(SB), BX; CALL BX`, install `g0` as the *current* goroutine in TLS, then `CALL runtime·schedinit(SB)` (the function from Task 5), then `CALL runtime·newproc(SB)` to create goroutine 1 with `runtime.main` as its body, then `CALL runtime·mstart(SB)` to enter the scheduler proper.

The architecture lesson behind this passage:

- **`g0` is special.** It's the goroutine that runs *scheduler code* — the function `mstart()`, `schedule()`, `findRunnable()`, etc. all execute on g0's stack. User goroutines have their own (heap-allocated, growable) stacks. The scheduler explicitly switches the "current g" pointer in TLS when transitioning between user goroutine and scheduler logic.

- **The OS stack becomes g0's stack.** We don't allocate g0's stack — we *adopt* the stack the kernel gave us at exec time. That's why g0's stack is large (8MB), fixed-size (does not grow with `MORESTACK`), and located in the same address range as `argv` and the auxv.

- **TLS setup is the moment Go-land begins.** Before TLS is hooked up, any Go function call that needs to know "what goroutine am I on" would crash. The runtime carefully orders these steps so the first instruction that asks the question executes *after* TLS is set.

Recommended follow-up: `git blame` the file to see which Go version added each line. You'll find that the CPUID block existed in Go 1.5; the 16-byte alignment was added explicitly when cgo became reliable on macOS; the `g_stackguard1` write only exists because cgo callbacks check it independently. The file is a historical museum of "what bug did we have to fix and where".

</details>

---

## Task 12 — `-buildmode=plugin` and runtime hosting two modules (S)

**Goal.** Build a Go plugin (`-buildmode=plugin`), load it from a host binary via `plugin.Open`, and observe in `debug.ReadBuildInfo()` (within the plugin) that it knows *its own* module info — separate from the host. Identify two complications: (a) both host and plugin have **their own runtime state** linked in, and (b) GOOS support is restricted (Linux, macOS, FreeBSD — no Windows).

**Starter.**

Host:

```go
// file: host/main.go
package main

import (
    "fmt"
    "plugin"
)

func main() {
    p, err := plugin.Open("./plug.so")
    if err != nil {
        panic(err)
    }
    sym, err := p.Lookup("Hello")
    if err != nil {
        panic(err)
    }
    helloFn, ok := sym.(func() string)
    if !ok {
        panic("Hello has wrong signature")
    }
    fmt.Println(helloFn())
}
```

Plugin:

```go
// file: plug/plug.go
package main

import "fmt"

func Hello() string {
    return fmt.Sprintf("hello from plugin")
}
```

Build:

```text
$ go build -buildmode=plugin -o plug.so ./plug
$ go build -o host ./host
$ ./host
```

**Hints.**

- `plugin.Open` is `dlopen`-based on Linux/macOS. The plugin must be compiled with the **exact same Go toolchain version** as the host. A 1-patch version drift breaks plugin loading.
- Both host and plugin must share **all** their dependencies' exact module versions. `go.mod` mismatches between host and plugin cause `plugin was built with a different version of package X` errors.
- The runtime detects two modules at load time via `runtime.modulesinit`. Each module's metadata (type-link table, GC bitmap pointers) is registered into the global lists.

<details><summary>Reference solution</summary>

Project structure:

```text
.
├── go.mod
├── host/
│   └── main.go
└── plug/
    └── plug.go
```

`go.mod`:

```text
module example.com/plugin-demo
go 1.22
```

`host/main.go`:

```go
package main

import (
    "fmt"
    "plugin"
    "runtime/debug"
)

func main() {
    if info, ok := debug.ReadBuildInfo(); ok {
        fmt.Printf("HOST module=%s go=%s\n", info.Main.Path, info.GoVersion)
    }
    p, err := plugin.Open("./plug.so")
    if err != nil {
        panic(err)
    }
    sym, err := p.Lookup("Hello")
    if err != nil {
        panic(err)
    }
    helloFn, ok := sym.(func() string)
    if !ok {
        panic("Hello: wrong signature")
    }
    fmt.Println(helloFn())
}
```

`plug/plug.go`:

```go
package main

import (
    "fmt"
    "runtime/debug"
)

// Hello is exported by the plugin via symbol lookup.
func Hello() string {
    if info, ok := debug.ReadBuildInfo(); ok {
        return fmt.Sprintf("PLUGIN module=%s go=%s",
            info.Main.Path, info.GoVersion)
    }
    return "no build info"
}
```

Build and run:

```text
$ go build -buildmode=plugin -o plug.so ./plug
$ go build -o host ./host
$ ./host
HOST module=example.com/plugin-demo go=go1.22.0
PLUGIN module=example.com/plugin-demo/plug go=go1.22.0
```

The two `ReadBuildInfo` calls return **different module paths**, proving that each binary carries its own `runtime.modinfo` block. The Go toolchain version matches because the build used the same compiler.

The two architectural complications:

**(a) Two runtimes, one process.**

This is the load-bearing part. When you `plugin.Open`, the host and plugin do **not** share a runtime — they each linked in `runtime/*.o` separately. But they live in one process with one OS thread, so:

- **There is only one scheduler.** The runtime in the plugin shares state with the host's runtime because `plugin.Open` patches the plugin's `runtime.allp`, `runtime.sched`, etc. pointers to *match the host's* via the dynamic linker. The plugin's `runtime` package source produces the same symbols as the host's, and the dynamic linker resolves duplicate symbols to a single instance — the host's.
- **Type tables MUST be reconciled.** If the host and plugin both define `type Foo struct { ... }`, the runtime has two distinct `*runtime._type` pointers describing it. The plugin loader calls `typelinksinit` and `itabsinit` to unify them — but only if the type *layouts match exactly*. A field-order difference in `Foo` between host and plugin produces a runtime panic like `runtime: plugin: incompatible package versions`.
- **GC must see both modules' globals.** The plugin's global variables are roots for the GC. `modulesinit` appends the plugin's `moduledata` to the global `firstmoduledata` linked list so subsequent GC mark phases scan its globals.
- **Goroutines spawned by plugin code are scheduled by the host's scheduler.** From the user's perspective: indistinguishable. From the runtime's: the goroutine struct allocated by `runtime.newproc` lives in the host's heap; the function pointer it executes lives in the plugin's `.text` section. If you `dlclose` the plugin while a goroutine is mid-execution there — crash.

**(b) GOOS support is restricted.**

The implementation depends on `dlopen` (Linux, macOS, FreeBSD) and the position-independent code (PIC) target supported by the linker. Windows is unsupported because Go's runtime makes assumptions about thread-local storage layout that don't translate to DLL-loaded code on Windows. Trying to `go build -buildmode=plugin` on Windows:

```text
-buildmode=plugin not supported on windows/amd64
```

Plus the more painful constraint: **plugin and host must agree on every transitive dependency version exactly.** If the host uses `golang.org/x/sys@v0.10.0` and the plugin uses `golang.org/x/sys@v0.11.0`, the loader will refuse with `plugin was built with a different version of package golang.org/x/sys/unix`. In practice this means plugins are only viable in tightly-controlled monorepos.

**When are plugins actually used?**

- Compiler/linker plugins for build tools.
- Database drivers loaded at runtime (rare in Go — usually compiled in).
- Game engine mods.
- Mostly **not** for "user-extensible application logic" — Go's plugin system is far more brittle than e.g. Python's. Most teams that want extensibility use gRPC and out-of-process plugins instead. That trade-off is on purpose: in-process plugin extensibility is intrinsically hostile to Go's "static-link everything" model.

The two-modules observation is exactly what the runtime is engineered to handle, but every Go developer who has tried plugins discovers within a week that the engineering tax is enormous. A senior Go developer in 2026 considers plugins an *educational* feature: useful for understanding how the linker and module system work, almost never the right answer for production extensibility.

</details>

---

## Task 13 — Step through startup with `delve` and find `g0` creation (S)

**Goal.** Build a hello-world Go program (no `-s -w` — you need the symbols), launch `dlv exec ./hello`, set a breakpoint on `runtime.schedinit`, and step until you find where `g0`'s stack is set up. Identify the call frame, the value of `g0.stack.lo` and `g0.stack.hi`, and the SP register relative to those bounds.

**Hints.**

- `dlv exec ./hello` launches the binary under delve's control. `break runtime.schedinit`, then `continue`, then `step`.
- `print g0` (or `print runtime.g0`) shows the global g0 struct. Its `stack` field is a `runtime.stack` with `lo` and `hi` (`uintptr`s pointing at the bounds).
- delve respects Go's source layout. Use `bt` (backtrace), `frame N` to switch frames, `locals` to dump local variables.

<details><summary>Reference solution</summary>

```go
// file: hello.go
package main

func main() {
    println("hi")
}
```

```text
$ go build -gcflags='all=-N -l' -o hello hello.go    # -N -l = no opt, no inline
$ dlv exec ./hello
Type 'help' for list of commands.
(dlv) break runtime.schedinit
Breakpoint 1 set at 0x10567a0 for runtime.schedinit() /usr/local/go/src/runtime/proc.go:680
(dlv) continue
> [Breakpoint 1] runtime.schedinit() /usr/local/go/src/runtime/proc.go:680 (hits goroutine(1):1 total:1) (PC: 0x10567a0)
   675:                _g_ := getg()
   676:                if raceenabled {
   677:                        _g_.racectx, raceprocctx0 = raceinit()
   678:                }
=> 680:                sched.maxmcount = 10000
   ...
(dlv) print runtime.g0
runtime.g {
        stack: runtime.stack {lo: 824633720320, hi: 824633728512,},
        stackguard0: 824633721344,
        stackguard1: 824633721344,
        ...
        m: ("*runtime.m")(0x10ba1c0),
        sched: runtime.gobuf {sp: 824633727216, pc: 4329216, g: ...,},
        ...
}
(dlv) bt
0  0x00000000010567a0 in runtime.schedinit
   at /usr/local/go/src/runtime/proc.go:680
1  0x000000000107d2e7 in runtime.rt0_go
   at /usr/local/go/src/runtime/asm_amd64.s:357
```

Interpret the numbers:

- **`g0.stack.lo = 824633720320` and `g0.stack.hi = 824633728512`.** In hex: `0xc000000000` and `0xc000002000`. So g0's stack spans 8 KiB starting at `0xc000000000`.
- **`g0.sched.sp = 824633727216`.** Hex `0xc0000017b0`. That's 1232 bytes below `stack.hi` — well within bounds.
- **`stackguard0 = stackguard1 = 824633721344`.** Hex `0xc000000400` — 1024 bytes above `stack.lo`. This is the "you have 1KB of stack left, time to grow" threshold (for normal goroutines; g0 doesn't grow but the field still gets set).
- **The backtrace shows `runtime.rt0_go` as the caller of `runtime.schedinit`.** Exactly matching the source we read in Task 11.

Wait — those numbers look wrong. The Go runtime usually allocates *huge* (8 MiB) stacks for `g0`. The trace above shows 8 KiB which is suspicious. The truth: in real builds, **`g0`'s stack bounds are set inside `rt0_go` itself** to be `[SP-64KiB, SP]` based on the OS-provided stack — and `SP` at that moment is somewhere in the OS stack region. The exact bounds depend on platform and Go version. The 8 KiB above is **what delve has captured after a stack switch** that the runtime performs between `rt0_go`'s entry and the `schedinit` body — the runtime swaps onto a *child* g0 stack briefly during init.

(Reproducibly observing the *original* OS stack requires setting an earlier breakpoint — e.g. `break runtime.rt0_go` — and inspecting g0 immediately after entry. Try it.)

To find where `g0` is *first* set up, set the breakpoint earlier:

```text
(dlv) break runtime.rt0_go
Breakpoint 2 set at 0x107d2a0 for runtime.rt0_go() ...:267
(dlv) restart
(dlv) continue
> [Breakpoint 2] runtime.rt0_go() ...:267
=> 267:    MOVQ    DI, AX        // argc
(dlv) step
=> 268:    MOVQ    SI, BX        // argv
(dlv) ...
```

Step a dozen times until you reach the `MOVQ BX, g_stackguard0(DI)` instruction (from Task 11). The next `print runtime.g0` shows the freshly-installed values, drawn from `SP - 64KiB` to `SP`.

**Why this exercise is worth doing once:**

- It removes the magic from "the runtime starts up". The first dozen instructions of `rt0_go` are the entire Go runtime's "we're alive" event.
- It teaches you that delve can step through *assembly*. Pure-asm functions (like `rt0_go`) don't have Go source; delve falls back to showing instruction addresses and lets you `disassemble` to see the actual bytes.
- It demonstrates that `g0` is **the only goroutine that exists during early boot**. The first user goroutine (`goroutine 1`, which runs `runtime.main` -> `main.main`) doesn't exist until `runtime.newproc` is called near the end of `rt0_go`. Until then there's *literally one goroutine*, and it's the scheduler.

Production tip: this same delve session works for diagnosing weird startup issues. If your binary panics before `main()` runs (rare but happens with bad `init()` functions or cgo init code), `break runtime.gopanic` and walk the stack — you'll find the offending init.

</details>

---

## Task 14 — Build with `-race` and compare binary size (S)

**Goal.** Build the same program with and without `-race`. Measure the size delta (typically 5-10x larger with `-race`). Explain architecturally why: the race detector is **ThreadSanitizer (TSan) compiled into the binary**, which instruments every memory access and links against `libtsan` (a 100MB+ shared library compiled into the executable).

**Starter.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        mu sync.Mutex
        n  int
    )
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            n++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("n =", n)
}
```

**Hints.**

- `go build -race -o app-race main.go` and `go build -o app-clean main.go`. Compare with `ls -l` and `go tool nm | wc -l`.
- The race detector instruments *every read and every write* of *every shared variable*. The compiler emits `tsan_read` / `tsan_write` calls inline. Those calls live in `libtsan`, which is linked statically into the binary.
- The CPU overhead is also significant: typically 2-10x slower at runtime, plus 5-10x memory. `-race` is a development/CI tool, never production.

<details><summary>Reference solution</summary>

```text
$ go build -o app-clean main.go
$ go build -race -o app-race main.go
$ ls -l app-clean app-race
-rwxr-xr-x  1 user  staff   1654784 May 28 10:00 app-clean
-rwxr-xr-x  1 user  staff   8847664 May 28 10:00 app-race
$ go tool nm app-clean | wc -l
    2103
$ go tool nm app-race  | wc -l
    8567
```

The race-enabled binary is roughly **5x larger** and contains roughly **4x more symbols**. The extra symbols are split between:

1. **`libtsan` itself** — about 2 MB of compiled C++ code from LLVM's compiler-rt, statically linked into the Go binary. This is the actual race detection engine — shadow memory bookkeeping, happens-before graph, vector clocks.
2. **Per-package instrumentation** — every Go function that reads or writes a memory location has `runtime.raceread` / `runtime.racewrite` calls inserted around the access. These calls fan into `__tsan_read*` / `__tsan_write*` in libtsan.

Architecturally:

**What `-race` actually changes:**

- **Compiler.** With `-race`, the gc compiler inserts a call to `runtime.raceread(addr)` before every load and `runtime.racewrite(addr)` after every store, for every memory access the compiler can't prove is local-stack-only. Channel operations, atomic ops, sync primitives — all get extra "happens-before" hooks (`runtime.racereleaseacquire`, `runtime.raceacquire`).
- **Runtime.** The runtime is rebuilt with race support: every goroutine carries an additional `racectx` field, every channel and mutex has shadow happens-before metadata. The `runtime.allg` slice has parallel state for the race detector.
- **Linker.** `cmd/link -race` links the `runtime/race` package, which CGO-wraps the C++ libtsan runtime.

**The shadow memory cost.**

ThreadSanitizer's main data structure is "shadow memory" — for every 8 bytes of application memory, it keeps 32 bytes of metadata (the IDs of the last few threads that touched it, with their vector clocks). That's a 4x **memory** blowup at runtime, layered on top of the larger binary size. A `-race` binary running with a 4GB working set will actually consume ~20GB of RAM.

**The CPU cost.**

Every load and store goes through a libtsan call. Loads turn from a single MOV instruction into ~30 instructions (check shadow memory, update timestamp, branch). For tight loops over arrays, that's a 30x slowdown. Real-world Go programs slow by 5-10x in `-race` mode — better than worst case because most code is dominated by syscalls and channel ops, not raw memory churn.

**Why this is acceptable.**

`-race` is a *development* tool. You run it in CI, on a per-PR basis, against your test suite. If `go test -race ./...` passes, you have strong evidence that your tested code paths are free of data races. The 10x slowdown is fine in CI; the 10x binary size is fine when CI binaries are ephemeral.

`-race` is *not* a production tool. Don't ship a `-race` binary to production. Use `go test -race` exhaustively, including under load, to flush out races *before* they're in production.

**A subtle bonus benefit: race binaries are also debug binaries.** They contain extra metadata that makes them friendlier to `delve`, `gdb`, and core-dump analysis. Some teams use `-race` binaries for staging environments specifically because they catch races AND give richer diagnostic output on any crash.

**Comparing nm output:**

```text
$ go tool nm app-race | grep -i tsan | head -10
0x...   T __tsan_atomic16_compare_exchange_strong
0x...   T __tsan_atomic16_compare_exchange_val
0x...   T __tsan_atomic16_compare_exchange_weak
0x...   T __tsan_atomic16_exchange
0x...   T __tsan_atomic16_fetch_add
... [hundreds of __tsan_* symbols]
0x...   T __tsan_init
0x...   T __tsan_read1
0x...   T __tsan_read16
0x...   T __tsan_read2
0x...   T __tsan_read4
0x...   T __tsan_read8
0x...   T __tsan_write1
0x...   T __tsan_write16
0x...   T __tsan_write2
0x...   T __tsan_write4
0x...   T __tsan_write8
... [hundreds more]
```

`app-clean` has zero `__tsan_*` symbols. The entire ThreadSanitizer runtime is statically baked into `app-race`. That's where the megabytes come from.

</details>

---

## Task 15 — Custom panic handler via `debug.SetPanicOnFault` (S)

**Goal.** Demonstrate `debug.SetPanicOnFault(true)`: when enabled, dereferencing an invalid pointer or accessing unmapped memory turns into a recoverable Go panic instead of a SIGSEGV crash. Show a contrived "read from address 0x1" case that crashes the process by default and is `recover`-able under `SetPanicOnFault(true)`.

**Hints.**

- `SetPanicOnFault` is **global** — it sets a process-wide flag. Set it once in main and undo it before tests if you care.
- The mechanism: the runtime installs a signal handler that catches SIGSEGV/SIGBUS, and when the fault address is *outside* known Go memory (heap, stack, BSS), it can convert the fault into a Go panic instead of dying. The hooked-up path is `runtime.sigpanic`.
- This is **not** "I can recover from any crash". Memory corruption inside Go's heap is still fatal — the runtime is no longer in a consistent state. `SetPanicOnFault` is specifically for "I dereferenced a pointer that's pointing at an mmap'd file region the OS unmapped" kind of scenario.

<details><summary>Reference solution</summary>

```go
// file: main.go
package main

import (
    "fmt"
    "runtime/debug"
    "unsafe"
)

func panicOnFaultDemo() (result string) {
    defer func() {
        if r := recover(); r != nil {
            result = fmt.Sprintf("recovered from fault: %v", r)
        }
    }()
    // Construct a pointer to address 1 — guaranteed to be unmapped.
    // We use uintptr -> unsafe.Pointer conversion explicitly to bypass
    // any compile-time check.
    p := unsafe.Pointer(uintptr(0x1))
    // Read a byte from there. Without SetPanicOnFault, this is a
    // SIGSEGV that kills the process. With SetPanicOnFault(true), it
    // becomes a recoverable Go panic of type *runtime.Error.
    _ = *(*byte)(p)
    return "no fault?!"
}

func main() {
    fmt.Println("=== without SetPanicOnFault ===")
    // (commented out, because uncommented this kills the program)
    // panicOnFaultDemo() // would: "unexpected fault address ..." then SIGSEGV

    fmt.Println("=== with SetPanicOnFault(true) ===")
    debug.SetPanicOnFault(true)
    result := panicOnFaultDemo()
    fmt.Println(result)

    debug.SetPanicOnFault(false)
    fmt.Println("flag reset; program continues normally")
}
```

Output:

```text
=== without SetPanicOnFault ===
=== with SetPanicOnFault(true) ===
recovered from fault: runtime error: invalid memory address or nil pointer dereference
flag reset; program continues normally
```

**What's actually happening under the hood:**

1. Without `SetPanicOnFault(true)`:
   - Go installs a SIGSEGV handler at startup (`runtime.sigtramp` -> `runtime.sighandler`).
   - When the kernel delivers SIGSEGV with `si_addr = 0x1`, the handler checks: is this address in Go-managed memory? No (`0x1` is in the kernel-reserved zero page).
   - The handler decides this is **inherent corruption** — the program is in an unknown state — and prints a panic-style stack trace, then calls `abort()` to dump core.

2. With `SetPanicOnFault(true)`:
   - Same path up to "is this in Go-managed memory?"
   - The handler checks `runtime.debugPanicOnFault` (set by `debug.SetPanicOnFault`).
   - If true and the fault is from Go code (not from cgo or syscall), the handler converts the SIGSEGV into a call to `runtime.gopanic` with a `runtime.Error` value.
   - The panic propagates normally — `defer` runs, `recover()` catches it.

**Why this exists.**

The original motivating use case is **memory-mapped files** (`mmap`). Suppose a Go program `mmap`s a 1GB file, then a parallel process truncates the file. Subsequent reads from the mapped region SIGBUS. Without `SetPanicOnFault`, the entire Go process dies. With it, the read panics, the handler logs and recovers, and the program survives.

Library authors who do mmap (e.g. databases, log indexers) set `SetPanicOnFault(true)` once at init and treat the per-region access as "may panic, handle it". User code that doesn't mmap typically never touches this knob.

**The catch: SetPanicOnFault is process-wide.**

You can't say "this goroutine has SetPanicOnFault on, this one doesn't". It's a global flag in the runtime; flipping it affects all goroutines. Two libraries with different expectations of this flag in the same binary is a foot-gun. Conventional advice: set it once, at the application boundary, and document it.

**SetPanicOnFault does NOT save you from:**

- Memory corruption inside Go's heap. If a `unsafe.Pointer` cast overwrites a `*runtime._type` pointer in the heap, the runtime hits an internal assertion and `throw`s — non-recoverable, panics through `recover()`.
- Stack overflow. The Go runtime detects stack overflow before the OS does and `throw`s.
- `panic` in the runtime itself. `runtime: out of memory` etc. — these are `throw`s, not panics.
- cgo crashes. If the C side SIGSEGVs, Go's signal handler often forwards it to whatever C++ does — but the goroutine running cgo is in an inconsistent state and you cannot reliably recover.

**Realistic check** that the panic value is what you expect:

```go
defer func() {
    if r := recover(); r != nil {
        // The type is runtime.Error (an interface).
        // Concrete type is usually *runtime.errorString or *runtime.runtimeError.
        fmt.Printf("type: %T, value: %v\n", r, r)
    }
}()
```

Output:

```text
type: runtime.Error, value: runtime error: invalid memory address or nil pointer dereference
```

The `runtime.Error` interface (one method: `RuntimeError()`) is the marker that this panic came from the runtime, not from user `panic(...)`. Production crash handlers use `errors.Is(err, runtime.Error)` to differentiate "your code panicked" from "the runtime panicked on your behalf".

</details>

---

## Task 16 — Read `g` status with `unsafe.Pointer` (educational only) (S)

**Goal.** Read the `runtime.g` struct's `atomicstatus` field via `unsafe.Pointer`. This is **strictly educational** — production code must never depend on the layout of `runtime.g`, which changes between Go versions without notice. The exercise reveals what the scheduler sees when it asks "what is goroutine X doing right now".

**Hints.**

- `runtime.g` lives in `runtime/runtime2.go`. The status is a `uint32` named `atomicstatus`. Use `runtime/internal/atomic.Uint32.Load()` to read it without tearing.
- You can't `import "runtime"` and access `g.atomicstatus` directly — the field is unexported. The hack: copy the struct layout into your own file, compute the field offset, and use `unsafe.Pointer` arithmetic.
- The status values are `_Gidle`, `_Grunnable`, `_Grunning`, `_Gsyscall`, `_Gwaiting`, `_Gdead`, `_Gcopystack`, `_Gpreempted`. They live in `runtime/proc.go` as untyped constants.

<details><summary>Reference solution</summary>

```go
// file: main.go
// EDUCATIONAL ONLY — depends on internal runtime layout that can change
// without notice between Go versions. Do not ship this code.
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "unsafe"
)

// getg returns a pointer to the current goroutine's g struct.
// Implementation lives in assembly in runtime/asm_<arch>.s.
//
// We can't call runtime.getg directly (it's unexported); instead we
// use go:linkname to bind to it.

//go:linkname getg runtime.getg
func getg() unsafe.Pointer

// gStatusField is the offset of g.atomicstatus inside the runtime.g
// struct. This offset MUST match the running Go runtime's definition.
// For Go 1.22 amd64 it is currently:
//
//   type g struct {
//       stack       stack         // 0..16
//       stackguard0 uintptr       // 16..24
//       stackguard1 uintptr       // 24..32
//       _panic      *_panic       // 32..40
//       _defer      *_defer       // 40..48
//       m           *m            // 48..56
//       sched       gobuf         // 56..120
//       syscallsp   uintptr       // 120..128
//       syscallpc   uintptr       // 128..136
//       stktopsp    uintptr       // 136..144
//       param       unsafe.Pointer// 144..152
//       atomicstatus atomic.Uint32// 152..156   <-- here
//       ...
//   }
//
// If you copy this code into your own project, recompute the offset
// from your local $GOROOT/src/runtime/runtime2.go — every Go release
// could change it.
const gAtomicStatusOffset = 152

// Status values copied from $GOROOT/src/runtime/runtime2.go.
const (
    gIdle       = 0
    gRunnable   = 1
    gRunning    = 2
    gSyscall    = 3
    gWaiting    = 4
    gMoribund   = 5 // unused, slot reserved
    gDead       = 6
    gEnqueue    = 7 // unused
    gCopystack  = 8
    gPreempted  = 9
)

func statusName(s uint32) string {
    switch s & 0x0F { // low nibble — high bits are flag bits
    case gIdle:
        return "Gidle"
    case gRunnable:
        return "Grunnable"
    case gRunning:
        return "Grunning"
    case gSyscall:
        return "Gsyscall"
    case gWaiting:
        return "Gwaiting"
    case gDead:
        return "Gdead"
    case gCopystack:
        return "Gcopystack"
    case gPreempted:
        return "Gpreempted"
    }
    return fmt.Sprintf("?(%d)", s)
}

// currentStatus reads the current goroutine's atomic status field by
// dereferencing the g struct via unsafe arithmetic.
func currentStatus() uint32 {
    gp := getg()
    if gp == nil {
        return 0
    }
    statusPtr := (*atomic.Uint32)(unsafe.Add(gp, gAtomicStatusOffset))
    return statusPtr.Load()
}

func main() {
    s := currentStatus()
    fmt.Printf("main goroutine status: %s (raw=%d)\n", statusName(s), s)

    // Now from another goroutine.
    done := make(chan struct{})
    go func() {
        s := currentStatus()
        fmt.Printf("worker  goroutine status: %s (raw=%d)\n", statusName(s), s)
        close(done)
    }()
    <-done

    // Note: a goroutine reading its OWN status will always see
    // _Grunning. To see other statuses (Gwaiting, Gsyscall) you have
    // to inspect ANOTHER goroutine — which requires walking allgs or
    // ptracing. That is a different exercise.
    _ = runtime.NumGoroutine()
}
```

Output:

```text
main goroutine status: Grunning (raw=2)
worker  goroutine status: Grunning (raw=2)
```

The educational payoff:

- **You see a running goroutine always reports `Grunning`.** Self-introspection is uninteresting. To observe `Gwaiting` you'd need to walk `runtime.allgs` (the global slice of all goroutines) and inspect *another* goroutine — which is what `runtime/debug.WriteHeapDump` and pprof's goroutine profile do internally.
- **The status word has flag bits in the high nibble.** `_Gscan` (status & 0x1000) means "the GC has marked this goroutine for stack scanning". The runtime ORs the scan bit on top of the regular status; subsequent CAS operations have to handle both.
- **`atomicstatus` is a `sync/atomic.Uint32`** (Go 1.19+). It used to be a plain `uint32` accessed with `atomic.Load/CompareAndSwap`; the runtime migrated to typed atomics for safety. Our code uses `atomic.Uint32.Load` correspondingly.

**Why this is fragile:**

1. **Offset changes with Go versions.** `gAtomicStatusOffset` is `152` for one specific build of Go 1.22 on amd64. A debug build, an arm64 build, a Go 1.23 release — all may shift the field. Production code that depends on this offset breaks silently. The compiler does not warn.
2. **`go:linkname` is officially discouraged.** It bypasses the type system and the export rules. Go's release notes have removed access to internal symbols in the past, breaking older `go:linkname` users.
3. **The status value is a snapshot.** By the time you've read it, the goroutine may have moved to a different state. Useful for observability, useless for control flow.

**Why senior Go developers do this anyway:**

- Tools like `gops` (the Go goroutine inspector), `pprof`, and `delve` rely on exactly this kind of internal access. They re-implement parts of the runtime's introspection because the official APIs are intentionally minimal.
- Performance debugging sometimes requires "show me the status of every goroutine right now" — that's `runtime.Stack(buf, true)`, which internally walks `allgs` and inspects each one's status field.

**A safer (official) alternative:**

```go
import "runtime/debug"

debug.SetGCPercent(100)
buf := make([]byte, 64<<10)
n := runtime.Stack(buf, true) // all goroutines
fmt.Println(string(buf[:n]))
```

The output includes lines like:

```text
goroutine 17 [chan receive, 5 minutes]:
```

The `[chan receive]` is the runtime's *human-readable rendering of the status field* — specifically the `gwaiting` status combined with the wait reason (`waitReasonChanReceive`). You get this for free, in production-safe code, without `unsafe`.

The takeaway: every goroutine carries a status word the scheduler reads constantly. You can see it via `unsafe` if you know the layout; you can see a clean rendering of it via `runtime.Stack`. Knowing both lets you read the runtime's output fluently and know exactly which internal field each rendered word maps to.

</details>

---

## Task 17 — Trace a cgo call from Go side to C side (S)

**Goal.** Read `$GOROOT/src/runtime/cgocall.go` and follow one cgo call's path. Write a one-paragraph trace of the steps `runtime.cgocall` takes from "Go calls a C function" through "C function executes" back to "Go resumes execution". Identify the key transitions: P release, M parking, signal mask change, and result marshalling.

**Hints.**

- `runtime.cgocall` is the *Go-side* entry. It receives a function pointer to the C-side trampoline (typically `_cgo_Cfunc_<funcname>`) and a pointer to a struct of arguments.
- The cost of a cgo call is famously ~200ns minimum (vs ~2ns for a Go function call). Understanding why requires understanding the steps.
- Key concepts: **`entersyscall`**, **`exitsyscall`**, **`cgocallback`** (for C calling Go), **the m's signal stack**.

<details><summary>Reference solution</summary>

The path of `C.someFunction(a, b)` from Go through `runtime.cgocall`:

1. **The compiler generates a wrapper.** The line `C.someFunction(a, b)` is rewritten to call a Go-side helper `_Cfunc_someFunction(a, b)` (in a generated `_cgo_gotypes.go` file). That helper marshals the arguments into a stack-allocated struct and calls `runtime.cgocall(_cgo_Cfunc_someFunction, &args)`. `_cgo_Cfunc_someFunction` is a small C trampoline that unpacks the args struct and calls the user's actual `someFunction(a, b)`.

2. **`runtime.cgocall` on the Go side.**
   - `entersyscall()` is called. This **releases the current P** so other goroutines can run on a different M. The current m is now "in syscall" mode — disconnected from any P. If there's a goroutine in the run queue, another m can pick it up and proceed.
   - The m's stack pointer is recorded in `m.cgomal` for cleanup.
   - The signal mask is switched: signals that Go normally handles (SIGURG for preemption, SIGPIPE) are blocked, because we're about to leave Go-land and a signal handler that calls back into the scheduler would be catastrophic.

3. **Transition to the m's g0 stack.**
   - cgo calls run on `g0` (the m's scheduler goroutine), not on the calling user goroutine. The runtime switches: save the user g's PC/SP, restore g0's PC/SP, mark current g as g0.
   - Why: user goroutine stacks are *growable* (the runtime can move them to a bigger backing array). The C code cannot tolerate the stack moving out from under it. g0's stack is OS-allocated and fixed. The cgo call runs on a stack that won't be reallocated.

4. **The C function executes.**
   - `_cgo_Cfunc_someFunction` is jumped to. It reads its args from the struct (which lives on the *user goroutine's* stack — that stack is pinned for the duration of the call), invokes `someFunction(a, b)`, and writes the result back into the args struct.
   - During this time, **no Go scheduler activity occurs on this m**. The m is "in syscall" and the C code can take as long as it likes. Other Go goroutines run on other m's.
   - If the C code spawns a thread that calls back into Go, that's `cgocallback` — a separate, more expensive path (~10x slower).

5. **C function returns to `runtime.cgocall`'s tail.**
   - Switch back from g0 to the user g (restore PC/SP/g).
   - **`exitsyscall()`** is called. This is the reverse of `entersyscall`:
     - Try to re-acquire the same P. If it's still free (no other m grabbed it), fast path — single CAS.
     - If the P was stolen, slow path: park the m on a wait queue, wait for a P to be free, then resume. This is rare and the source of cgo latency variance.
   - Signal mask restored.

6. **`runtime.cgocall` returns**, the generated Go-side wrapper unmarshals the result from the args struct, and the user code continues.

**The numbers that matter:**

- `entersyscall` + `exitsyscall` cost ~100ns each in the fast case (no contention). That's already ~200ns of overhead before the C function does anything.
- If `exitsyscall` is slow (P stolen), latency can jump to microseconds.
- A pure Go function call is ~2ns. So cgo is **100x more expensive** than a Go-to-Go call in the best case.

**Why this design:**

- **P release is necessary** because the C function might block (`sleep`, `read`, `flock`). If we held the P, no Go work could happen on this m for the duration. Releasing the P keeps `GOMAXPROCS` Go-runnable.
- **g0 stack switch is necessary** because Go goroutine stacks can be moved by `runtime.growstack`. C cannot tolerate that.
- **Signal mask change is necessary** because Go's preemption signal (SIGURG since 1.14) would, mid-C-call, attempt to redirect execution back into the Go scheduler — which is impossible while the m is in C land.

**A senior question on cost reduction:**

- If you have a **hot** cgo call (every microsecond), the 200ns floor dominates. The Go community has experimented with "fast cgo" variants that avoid the P release — but those are unsafe for any C call that can block. They're hidden behind `//go:nosplit` and used in cryptography intrinsics, not user code.
- The standard library's approach for the hot case: don't use cgo. `crypto/aes`, `crypto/sha256` etc. are pure Go with arch-specific assembly. cgo is for *bringing in foreign libraries*, not for *speed*.

**Reading `cgocall.go`:**

```text
$ less $(go env GOROOT)/src/runtime/cgocall.go
```

The file is ~700 lines. Skim the top docstring (it explains exactly the above), then `cgocall` (the main entry), then `cgocallback` (C-to-Go callback path). The hot-path comments are gold — the runtime maintainers explicitly call out which transitions are "must happen" and which are "optimisation".

</details>

---

## Task 18 — Compare boot times: Go vs JVM vs Rust (Staff)

**Goal.** Write `hello world` in Go, Java, and Rust. Measure end-to-end startup latency (time to first stdout byte) for each. Tabulate the results. Explain architecturally why Go sits in the middle of the trio.

**Hints.**

- Use `hyperfine ./hello-go ./hello-rust 'java -jar Hello.jar'` for repeatable benchmarks.
- Rust is the floor: a static binary with no runtime → ~1ms.
- JVM is the ceiling: classpath load, JIT warm-up, GC bootstrap → ~100ms+.
- Go sits in the middle: runtime init (`schedinit`, `mallocinit`, GC init, allgs) is ~5-15ms.

<details><summary>Reference solution</summary>

The three programs:

**Rust** (`hello.rs`):

```rust
fn main() {
    println!("hi");
}
```

```text
$ rustc -O hello.rs -o hello-rust
```

**Go** (`hello.go`):

```go
package main

import "fmt"

func main() {
    fmt.Println("hi")
}
```

```text
$ go build -ldflags="-s -w" -o hello-go .
```

**Java** (`Hello.java`):

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}
```

```text
$ javac Hello.java
$ jar cfe Hello.jar Hello Hello.class
```

Benchmark with `hyperfine`:

```text
$ hyperfine --warmup 3 ./hello-rust ./hello-go 'java -jar Hello.jar'
Benchmark 1: ./hello-rust
  Time (mean ± σ):       0.8 ms ±   0.2 ms    [User: 0.4 ms, System: 0.3 ms]
  Range (min … max):     0.5 ms …   1.5 ms    500 runs

Benchmark 2: ./hello-go
  Time (mean ± σ):       6.3 ms ±   0.4 ms    [User: 4.1 ms, System: 1.9 ms]
  Range (min … max):     5.6 ms …   9.0 ms    300 runs

Benchmark 3: java -jar Hello.jar
  Time (mean ± σ):     112.7 ms ±   3.8 ms    [User: 92.0 ms, System: 18.0 ms]
  Range (min … max):   107.2 ms …  128.1 ms    30 runs

Summary
  ./hello-rust ran
    7.9 ± 2.0 times faster than ./hello-go
    140.9 ± 35.5 times faster than 'java -jar Hello.jar'
```

(Numbers vary by hardware; the ratios are stable.)

**Architectural breakdown:**

**Rust: ~1 ms** — what does the time go to?

- Kernel `execve` syscall: ~0.3 ms (load binary, set up address space, jump to `_start`).
- libc `_start` -> `__libc_start_main` -> `main`: ~0.1 ms (set up TLS, parse argv).
- The `println!` macro: a few writes to stdout via `write(2)`: ~0.4 ms.

There is essentially no Rust *runtime*. Rust has the smallest possible startup: the kernel loads the binary, libc sets up TLS, `main` runs. No GC, no scheduler, no JIT. The constant overhead is the cost of running *any* native process. Static linking (`-C target-feature=+crt-static`) makes it even faster — no `ld.so` to traverse.

**Go: ~6 ms** — where does the extra time go?

- Same kernel `execve`: ~0.3 ms.
- Same libc-style setup (Go on Linux/amd64 doesn't use libc by default; `rt0_amd64_linux` does the equivalent): ~0.5 ms.
- **`runtime.schedinit`** (Task 5's 12 steps): ~2 ms. Most of the cost is `mallocinit` setting up the page allocator and arena metadata.
- **GC init + first GC cycle setup**: ~1 ms. The runtime pre-allocates GC structures.
- **Init for all packages**: depends on imports. `fmt` pulls in `reflect`, `os`, `syscall`, `runtime`. Each runs its `init()` if any. For a `hello world` this is maybe 1 ms.
- **`runtime.main` -> `main.main`**: ~0.1 ms.
- **`fmt.Println` first call**: ~1 ms — lazy allocation of internal buffers, first call to `os.Stdout.Write`, mutex acquisition, write(2).

The non-negotiable cost: `schedinit` and `mallocinit` are upfront — even an empty Go binary has them. They are the price of "I want a GC, a scheduler, goroutines, channels". Stripping the `fmt` import and using `print` (the unformatted, runtime-built-in) drops `fmt` init's ~1ms. The minimum stays around 4-5ms.

**JVM: ~110 ms** — why so much?

- Same kernel `execve`: ~0.3 ms.
- **JVM bootstrap**: `java` is a small launcher that `dlopen`s `libjvm.so`. Then it has to *boot a Java Virtual Machine*: parse the classpath, create the metaspace, initialise the GC (G1 or ZGC), set up JIT thresholds. ~30-50 ms.
- **Bootstrap classloading**: java.lang.Object, java.lang.String, java.lang.System are loaded and verified before *any* user code. ~30-40 ms.
- **User class loading**: `Hello.class` is loaded, verified, and resolved. ~5 ms.
- **`main()` runs**: the call into `System.out.println("hi")` involves the standard output's print stream, which lazy-loads more classes (java.io.PrintStream, java.nio.charset.UTF_8) on first use. ~5 ms.
- **Write**: ~1 ms.

The JVM is a *whole interpreter + JIT + GC* loaded into memory and warmed up. It pays this cost on every cold start. GraalVM native-image compiles a Java program ahead-of-time and yields startup times comparable to Go (~10 ms) — but at the cost of dropping JVM features (dynamic class loading, reflection requires configuration, etc.).

**The architectural lesson:**

Go is **deliberately positioned in the middle**. It has a runtime — needs one for goroutines, GC, network poller — but the runtime is **statically linked and lean**. Compared to Rust's "no runtime", Go pays ~5ms. Compared to the JVM's "full VM", Go saves ~100ms.

The corollary in production: **Go is excellent for serverless / CLI workloads** where every invocation starts cold. AWS Lambda's Go runtime cold-starts in ~10-30ms; the Java runtime cold-starts in 300ms-1s. For a CLI tool that runs once and exits, the JVM's startup overhead is fatal; Go is fine; Rust is invisible.

**Trade-off the table doesn't show:**

- Steady-state throughput: JVM is often *faster* than Go because the JIT optimises hot code paths over time. A 10-minute server run sees Java edge out Go on raw CPU.
- Memory: JVM uses 100-500MB minimum (heap, metaspace, off-heap). Go uses 5-15MB for an empty server. Rust uses ~1MB.
- Latency tails: Go's GC pauses are sub-millisecond now; the JVM's G1 GC can pause for 50-100ms during a major collection. ZGC is sub-millisecond but uses more memory.

So Go is the "cold start + small memory + modern concurrency" sweet spot. Rust beats it on raw startup and memory but pays in development velocity. The JVM beats it on steady-state throughput but pays in startup and memory.

</details>

---

## Task 19 — Read the "soft memory limit" proposal (#48409) (Staff)

**Goal.** Locate the design proposal at [github.com/golang/go/issues/48409](https://github.com/golang/go/issues/48409) (the "Soft memory limit" feature, shipped in Go 1.19 as `runtime.SetMemoryLimit` / `GOMEMLIMIT`). Identify which `runtime/` files changed to implement it. Summarise the runtime architectural change in 3-5 paragraphs.

**Hints.**

- The implementing commit is around `https://go-review.googlesource.com/c/go/+/353989` (and follow-ups). It touches `runtime/mgc.go`, `runtime/mgcpacer.go`, `runtime/runtime.go`, `runtime/debug.go`.
- The feature adds a *soft* limit: the GC tries hard to stay under it but does not OOM-kill if it can't. Hard OOM-style behaviour requires `GOGC=off` plus the soft limit.
- The key innovation is changing the GC pacer from "track heap growth ratio (GOGC)" to "track ratio AND absolute memory ceiling". The pacer became a Pareto-style controller balancing two objectives.

<details><summary>Reference solution</summary>

The proposal (issue #48409) and its rationale:

**Problem statement.** Before 1.19, Go's only knob for memory pressure was `GOGC` — the heap growth ratio target. With `GOGC=100` (default), the GC triggers when the heap doubles. But "double the heap" is meaningless to ops: if a container has a 1GB memory limit and your heap is 700MB, doubling kills you. If your heap is 50MB, doubling is fine. Engineers worked around this by:

- Manually calling `runtime.GC()` periodically.
- Setting `GOGC=50` or lower (paying 30% extra CPU for predictable memory).
- Using `cgroup-aware GOMAXPROCS` plus custom watchdogs.

**Solution: `GOMEMLIMIT`.** A new environment variable (and corresponding `debug.SetMemoryLimit`) that sets a *soft* memory ceiling. The GC adapts its pacing dynamically: if total memory (heap + stacks + globals + GC metadata) approaches the limit, GC runs more aggressively. If memory is well under, GC behaves as `GOGC` dictates.

**Files changed (from the Gerrit CL):**

- **`runtime/mgcpacer.go`** — The core of the change. The "GC pacer" is the controller that decides *when* the next GC cycle should start. Before 1.19, it computed a `gcTrigger` from `GOGC * liveHeapBytes`. After 1.19, it computes a Pareto-optimal trigger from BOTH `GOGC` AND `GOMEMLIMIT`. The pacer became a feedback loop with two reference signals.
- **`runtime/mgc.go`** — Hooks for the new pacer. The mark-phase start now consults the memory-limit-aware trigger.
- **`runtime/debug.go`** — Exports `SetMemoryLimit(bytes int64) int64`, returning the previous limit. Implementation just delegates to the pacer.
- **`runtime/extern.go`** — Doc for the new `GOMEMLIMIT` env var.
- **`runtime/runtime1.go`** — Env var parsing: `GOMEMLIMIT=4GiB` parses to bytes.
- **`runtime/metrics/*`** — New metrics exposed via `runtime/metrics`: `/gc/heap/goal:bytes` and friends now reflect the memory-limit-aware target.

**Architectural summary.**

*Paragraph 1 — what changed conceptually.* The GC pacer is the piece of the runtime that decides "should I start a GC cycle right now?" It does not do collection — it triggers collection. Before 1.19 the pacer's input was one number (heap growth since last GC). After 1.19 it has two inputs (heap growth AND distance to memory limit) and produces a trigger that respects both. When the heap is small and memory is plenty, the pacer behaves identically to old Go — GOGC alone drives it. When memory approaches the limit, the pacer pulls the trigger forward, running GC more often, paying CPU to save RAM.

*Paragraph 2 — why soft.* A *hard* memory limit (OOM-kill on overshoot) was rejected during proposal review because Go's runtime cannot atomically prevent allocations. By the time the runtime notices it's at the limit, allocations are already in flight on multiple goroutines. The "soft" interpretation: the GC tries to keep total memory under the limit by aggressive collection, but if user code allocates faster than GC can free, memory continues to grow. The user opts in to OOM behaviour by combining `GOMEMLIMIT=4GB GOGC=off` — at which point the only memory release is via the limit, and breaching it means the program is genuinely over-allocating and should die.

*Paragraph 3 — the new pacer's math.* The old pacer's target was `gcTrigger = liveHeap * (1 + GOGC/100)` — when heap doubles, GC starts. The new pacer adds: `memLimitTrigger = memLimit - (estimated allocation rate * estimated GC duration) - safety margin`. The effective trigger is `min(gcTrigger, memLimitTrigger)`. As you approach the limit, `memLimitTrigger` decreases, eventually becoming the dominant signal. The pacer also dynamically adjusts the *mark-assist ratio* — how much extra mark work allocating goroutines have to perform — to slow allocations down when GC can't keep up alone.

*Paragraph 4 — the operational impact.* Production Kubernetes deployments universally use `GOMEMLIMIT` now (1.19+). The pattern is:

```yaml
env:
  - name: GOMEMLIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.memory
        divisor: '1'
```

The Go binary picks up the cgroup memory limit and tunes its GC accordingly. CPU usage may go up by 5-20% under memory pressure (more GC cycles) but OOM-kills drop dramatically. This is one of the few runtime features in Go's history that *required no application code change* and yielded measurable production wins for everyone.

*Paragraph 5 — what's still hard.* The soft limit does NOT cover non-Go memory: cgo allocations, mmap'd regions, large goroutine stacks. A program with a leaky cgo library can blow past `GOMEMLIMIT` and still OOM. The proposal explicitly excluded those — they're outside the GC's purview. For pure-Go workloads (the 95% case), the limit is decisive.

**Practical lessons for reading runtime proposals:**

- Find the issue, the proposal doc (linked from the issue, typically a Google Doc or `design/` markdown file in the `golang/proposal` repo), and the implementing CLs.
- Read the proposal doc *first*, then the CLs. The doc explains the design space and alternatives considered; the CLs are the concrete answer.
- Focus on the *pacer* / *scheduler* / *allocator* files. Most "GC behaviour" changes touch `mgcpacer.go` and `mheap.go`. Most "scheduler" changes touch `proc.go` and `runtime2.go`. Knowing the rough file layout makes proposal-reading 5x faster.

</details>

---

## Task 20 — Design a "deterministic test mode" for the Go runtime (Staff)

**Goal.** Sketch (in design-doc form, not as code) what would have to change in the Go runtime to support a *deterministic test mode* — a build flag where, for unit-test purposes, every random / time-dependent / scheduling choice is replaced by a deterministic one. The goal: identical inputs always produce identical interleavings, making race-condition bugs reliably reproducible.

**Hints.**

- The runtime currently is non-deterministic in multiple places: goroutine scheduling order (work stealing is random), map iteration order, hash function seed, GC pacing, channel select choice.
- A deterministic mode would have to fix each source. Some are easy (`alginit` seed), some are deeply structural (work-stealing order).
- This proposal does not exist in production Go (and is unlikely to be adopted as-is). The exercise is to think through the architectural constraints; senior engineers should be able to design something they know wouldn't ship and articulate why.

<details><summary>Reference solution</summary>

# Proposal sketch: `GODETERMINISTIC=1` runtime test mode

**Status.** Hypothetical. Not submitted. Educational exercise only.

**Authors.** Bakhodir Yashin Mansur (sketching for self-study).

**Date.** 2026-05-28.

## Motivation

Go's runtime is intentionally non-deterministic in several places. Concurrency bugs (data races, deadlocks, ordering issues) are notoriously hard to reproduce because each test run produces a different scheduling interleaving. `go test -race` catches *some* races, but only the ones the chosen interleaving exposes. A test failing 1-in-1000 runs is essentially unfixable without spending hours on `go test -count=10000` to find a repro.

A *deterministic mode* would make every test run produce the same interleaving given the same input. Bugs become reliably reproducible. Tests become a *recording* of a specific scheduling, replayable indefinitely.

## Design

The fundamental shift: replace every source of non-determinism with either (a) a fixed value or (b) a value derived from a controllable seed. The user calls `runtime.SetDeterministicSeed(seed uint64)` at program start; from that point on, every "random" choice the runtime makes is a function of `seed` and the operations performed so far.

### Sources of non-determinism and proposed fixes

**1. Goroutine scheduling order.**

*Current behaviour.* The scheduler picks goroutines from the local P run queue (FIFO with steal-half from other Ps' tails). When a P's queue is empty, it work-steals from a random other P; the choice of which P to steal from is `runtime.fastrand() % len(allp)`. When multiple goroutines are runnable, the scheduler picks one essentially arbitrarily (depending on Ps' interleaved progress).

*Proposed fix.* In deterministic mode, replace the work-steal RNG with a deterministic per-P PRNG seeded from `(globalSeed, pIndex)`. Force goroutines to run sequentially: at any point in time, only one goroutine runs. The scheduler picks the next goroutine by an explicit rule: lowest `g.goid` among runnable, ties broken by oldest "became runnable" timestamp. This eliminates parallel execution but is the only way to make scheduling fully deterministic.

*Cost.* This effectively turns Go into a single-threaded runtime. Programs that depend on parallelism for liveness (rare but exists — busy-wait spinlocks counting on another core to release) will deadlock. Tests for performance characteristics become meaningless. We declare these out of scope.

**2. Map iteration order.**

*Current behaviour.* Map iteration starts at a random bucket and walks from there. This is intentional — the runtime adds randomness specifically to prevent programs from depending on iteration order. (See `runtime/map.go::mapiterinit`.)

*Proposed fix.* In deterministic mode, start iteration at bucket 0. This is a one-line change in `mapiterinit`. Trivial.

*Cost.* Code that "accidentally" passed because of random iteration order will now consistently exhibit its bug. This is a feature, not a regression.

**3. `runtime.fastrand` and `math/rand` (default Source).**

*Current behaviour.* `runtime.fastrand` is seeded per-P at scheduler init using nanoseconds. `math/rand`'s package-level `rand.Int()` uses a global source seeded at package init.

*Proposed fix.* In deterministic mode, seed `runtime.fastrand` from `globalSeed`, and reset the global `math/rand` source to a fixed seed. User code that explicitly creates `rand.New(rand.NewSource(seed))` is unaffected — the user controls their seed.

*Cost.* The Go security primitives (`crypto/rand`) still use OS entropy. Tests for crypto operations remain non-deterministic. Acceptable.

**4. Hash seed (map collision randomisation).**

*Current behaviour.* `alginit` generates a random hash seed from `aeshashbody` registers at init. This prevents hash-DoS attacks. As a side effect, maps with the same keys can have different bucket layouts across runs.

*Proposed fix.* In deterministic mode, use a fixed hash seed (e.g. all zeros). Maps now have stable bucket layouts.

*Cost.* Hash-DoS vulnerability re-introduced in test builds. Production builds are unaffected (`GODETERMINISTIC` must not be settable in production binaries — enforced by linker flag refusing to set it alongside `-buildmode=exe`).

**5. GC timing.**

*Current behaviour.* The GC starts when the heap reaches the pacer's trigger. The trigger depends on allocation rate, which depends on goroutine scheduling, which depends on the OS scheduler. Cascading non-determinism.

*Proposed fix.* In deterministic mode, GC runs on a *step count* basis, not a heap-size basis. Every `N` runtime "ticks" (where a tick is one scheduler context switch), run a GC cycle. `N` is configurable; default 10000. The mark and sweep phases are then themselves deterministic because the input (the set of live objects) is deterministic.

*Cost.* GC behaviour no longer reflects production. Tests for "does this code leak memory under load?" become invalid in deterministic mode. The trade-off is intentional: deterministic mode is for *bug-finding*, not *performance characterisation*.

**6. Channel `select` choice.**

*Current behaviour.* When multiple `select` cases are ready, the runtime picks one randomly via `fastrand`.

*Proposed fix.* In deterministic mode, pick the lowest-indexed ready case. Tied lifecycle (`default` case): always pick default first if no others, never pick default if others are ready.

*Cost.* Test code that depends on `select`'s random distribution (rare) breaks. Replaceable with explicit `rand.Intn`.

**7. Mutex acquire order.**

*Current behaviour.* `sync.Mutex` acquisitions are FIFO via the runtime's `semaroot`, but at the OS level, multiple goroutines blocked on the same mutex can be released in arbitrary order if multiple OS threads are released near-simultaneously.

*Proposed fix.* Since we've forced single-threaded execution (point 1), mutex contention reduces to "which runnable goroutine is picked next" — already deterministic.

**8. `time.Now()`.**

*Current behaviour.* Returns wall-clock time. Inherently non-deterministic.

*Proposed fix.* `runtime.SetDeterministicSeed` also resets time. Every call to `time.Now()` in deterministic mode returns `seedTime + (runtimeTicks * fixedTickDuration)`. `time.Sleep` advances `runtimeTicks` directly without actually sleeping.

*Cost.* Tests that measure real time (benchmarks) don't work. Tests that depend on relative ordering of events (`Time1.After(Time2)`) work perfectly.

**9. `os.Pipe` / network ordering.**

*Current behaviour.* OS-level non-determinism in `select`, `epoll`, `kqueue`.

*Proposed fix.* In deterministic mode, route all I/O through an in-memory virtual filesystem. Network I/O via an in-process loopback. Files via an in-memory FS like `testing/fstest`. The OS is *excluded* from determinism — we control I/O entirely in Go.

*Cost.* Tests that hit real OS resources can't run in deterministic mode. Acceptable: this is a *unit-test* mode, not an integration-test mode.

## Implementation cost

Approximately:

- **`runtime/proc.go`**: Major. Scheduler picks become deterministic; work-stealing becomes round-robin. ~500 lines changed.
- **`runtime/map.go`**: Minor. Fixed bucket start. ~20 lines.
- **`runtime/alg.go`**: Minor. Fixed hash seed gate. ~30 lines.
- **`runtime/chan.go`**: Moderate. `select` choice becomes deterministic. ~100 lines.
- **`runtime/mgc.go` / `mgcpacer.go`**: Major. GC trigger becomes step-count-based. ~200 lines.
- **`time/`**: Major. `time.Now` becomes runtime-tick-based. ~150 lines.
- **`internal/poll/`**: Major. I/O routes through in-memory backends. ~500 lines.

Total: ~1500 lines of runtime change, plus a parallel non-deterministic build (the regular path) maintained alongside. Significant maintenance cost.

## Why this likely won't ship

**1. Performance cost of branching.** Every scheduler decision now has a `if deterministic { ... } else { ... }` branch. Branch prediction handles it but the runtime gets bigger and slower. Go's maintainers historically reject patches that add per-decision branches even when guarded by a build flag — the slowdown shows up in benchmarks.

**2. False sense of safety.** A test that passes in deterministic mode does not guarantee it passes in production. The test only proves "this specific interleaving doesn't have a bug". Production has a different interleaving. Worse, developers might *come to depend on* the deterministic interleaving, writing code that subtly assumes it (e.g. "goroutine A always wins the race"). When the same code runs in production with normal scheduling, it breaks.

**3. The race detector is better.** `go test -race` doesn't make the scheduling deterministic — it makes *every interleaving theoretically possible* by inserting yield points, then it dynamically checks for happens-before violations. The race detector catches bugs that any specific interleaving (deterministic or not) misses, because it reasons over the *whole* dataflow graph.

**4. Existing approaches.** `gomochi` and `goptl` have explored deterministic Go schedulers for testing in research papers. None gained adoption. The closest production-grade alternative is `petri-go` (a model-checker for Go that explores all interleavings exhaustively for small programs). For the same reason: it's an academic curiosity, not a production fix.

## Conclusion

The exercise of *designing* this feature is more valuable than the feature itself. By enumerating sources of non-determinism, the designer internalises the runtime's architecture in a way that no other exercise produces. After this proposal, you know exactly where in the runtime each random choice lives, why it's there, and what would break if you removed it.

A senior engineer should be able to articulate (a) what the proposal would change, (b) why it's not trivially obvious how to do it, (c) what existing alternatives are stronger, and (d) the second-order consequences (false safety, maintenance cost) that doom most "well, why don't we just..." proposals. If you can do all four, you understand the Go runtime architecture at the depth this module aims for.

</details>

---

## How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (got it unaided), `3` (got it and could explain the architectural *why* to another engineer). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You can build Go binaries but the runtime is still a black box. Re-do Tasks 1–6 — they're all "read what's on disk / compare two builds" and require no clever insight. The boot sequence has to be a road you've walked, not a paragraph you've read. |
| 16–30 | Tasks 7–10 are introspection and tooling: stack traces, build info, trace UI. These are the diagnostic tools you use in production every week. If they didn't click, you're still treating the runtime as opaque — practice harder. |
| 31–45 | Senior. Tasks 11–17 require reading runtime source code (`asm_amd64.s`, `cgocall.go`) and running a debugger against startup. If you struggled, the gap is not understanding — it's tool familiarity (delve, objdump, nm). Drill the tools. |
| 46–60 | Staff. Tasks 18–20 require synthesising the runtime's design with adjacent ecosystems (JVM, Rust) and proposing changes to the runtime itself. Anyone who got 3s on all three has internalised the runtime architecture to the level of "I could hold a hallway conversation with a member of the Go team about an open proposal and contribute meaningfully". |

The deepest test: open `$GOROOT/src/runtime/proc.go` to a random line. Can you, within ten seconds, name the subsystem you're looking at? (scheduler / GC pacer / stack management / cgo / signals / netpoller). If yes — you have a map of the runtime in your head, and any future runtime question becomes "let me read the right file" instead of "let me Google for a blog post".

---

## Stretch challenges

**X1 — Runtime-level "what is everyone doing right now" debugger.** Build a small tool (call it `gopeek`) that, given a running Go process's PID, attaches via `ptrace` and produces output equivalent to `runtime.Stack(buf, true)` — the per-goroutine status and stack trace. The catch: do it *without* asking the target process to dump anything. You must read its memory directly. Hints: parse `pclntab` from the on-disk binary (use `debug/gosym`), walk `runtime.allgs` by reading the target's data segment, then walk each `g`'s stack via its `sched.sp`. The challenge teaches you exactly which fields the runtime exports as roots (allgs, allps, sched) and how external tools (delve, gops) navigate them.

**X2 — Cross-version runtime-source diff visualiser.** Write a tool that, given two Go versions (e.g. 1.20 and 1.22), produces a per-file diff size matrix for `runtime/`. Surface the files with the largest changes between versions. The output should answer questions like "what runtime files changed most between 1.21 and 1.22?" (Answer for that pair: `mgcpacer.go` for soft memory limit refinements, `traceback.go` for inline frame handling, `proc.go` for scheduler tweaks.) The exercise gives you a *forensic* feel for runtime evolution — useful when you need to debug a regression introduced by a Go upgrade.

**X3 — A "runtime architecture" CLI dashboard.** A long-running TUI (terminal UI) that connects to a running Go program (via `net/http/pprof` or via `gops`) and renders a live view of: goroutine count, GC frequency, heap size vs `GOMEMLIMIT`, current schedlatency, syscall count, cgo call count, allocation rate. The dashboard is not new; pprof has parts of it. The exercise is to *combine* the views into one screen that answers, in a glance, "what is this runtime doing and is it healthy?". Constraint: the dashboard itself must not allocate on the hot path — use buffered output, pre-allocated slices, and avoid `fmt.Sprintf` in the render loop. Building this is the practical capstone for everything in this module — diagnostic tooling that *uses* every runtime API the tasks covered.
