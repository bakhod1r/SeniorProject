# WASI & `GOOS=wasip1` — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is WASI?" and "How do I compile my Go program to a `.wasm` that runs on a server, not a browser?"

You have probably heard that Go can compile to WebAssembly. The first thing most people meet is `GOOS=js GOARCH=wasm` — that builds a `.wasm` that runs *inside a web browser*, talking to JavaScript and the DOM. This page is about the *other* WebAssembly target: `GOOS=wasip1 GOARCH=wasm`.

`wasip1` produces a `.wasm` module that runs **outside** the browser — on a server, in a CLI, inside another program — on a small piece of software called a *WebAssembly runtime* (Wasmtime, wazero, WasmEdge, or Node). There is no DOM, no JavaScript. Instead, the module talks to the host through a standardized syscall interface called **WASI** (the **WebAssembly System Interface**).

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm
wasmtime main.wasm
```

Run those two lines and you have compiled an ordinary Go program into a portable, sandboxed `.wasm` file, then executed it on a runtime. The program can print to standard output, read command-line arguments, read environment variables, and — *if you explicitly allow it* — read and write files. It cannot do anything you did not grant.

This was added to Go in **Go 1.21** (released August 2023). Before that, the only non-browser wasm story in Go was experimental and unsupported. `wasip1` is a first-class, officially-supported port.

After reading this file you will:
- Understand what WASI is and why it exists
- Build and run a `wasip1` Go program
- Understand the *capability sandbox*: why a wasm module starts with zero permissions
- Know what works on `wasip1` (files, stdio, clocks, random, args, env) and what does not (full networking, threads, `fork`/`exec`)
- Know the difference between `wasip1` (WASI preview 1) and the newer preview 2
- Avoid the most common beginner traps

You do **not** need to understand the WASI ABI, `go:wasmimport`/`go:wasmexport`, or the Component Model yet. This file is about the moment you say "I want my Go program to run as a sandboxed `.wasm` on a server."

---

## Prerequisites

- **Required:** Go 1.21 or newer. The `wasip1` port did not exist before 1.21. Check with `go version`. (Go 1.24+ is recommended so you also get `go:wasmexport`.)
- **Required:** A WebAssembly runtime to run the output. Install one:
  - [Wasmtime](https://wasmtime.dev) — `curl https://wasmtime.dev/install.sh -sSf | bash`
  - [wazero](https://wazero.io) — a pure-Go runtime, `go install github.com/tetratelabs/wazero/cmd/wazero@latest`
  - [WasmEdge](https://wasmedge.org), or a recent Node.js, also work.
- **Required:** Comfort with the basics — `go build`, environment variables, `cd`, `ls`.
- **Helpful:** Having already seen `GOOS=js GOARCH=wasm` (the browser target) so you can contrast the two. See [16.1 js/wasm in the browser](../01-goos-js-wasm-browser/junior.md).

If `go version` prints `go1.21` or higher and `wasmtime --version` prints anything, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **WebAssembly (wasm)** | A portable, sandboxed binary instruction format. Originally for browsers; now also a general compilation target. |
| **WASI** | WebAssembly System Interface — a standardized, capability-based set of "syscalls" that lets wasm modules interact with a host operating system (files, clock, random, stdio) in a portable way. |
| **`wasip1`** | Go's `GOOS` value for **WASI preview 1**. Combined with `GOARCH=wasm` it targets the WASI preview-1 ABI. Added in Go 1.21. |
| **WASI preview 1 (snapshot1)** | The first stable WASI ABI. A flat set of imported functions (`fd_read`, `path_open`, `clock_time_get`, …). What `wasip1` targets. |
| **WASI preview 2** | The newer, Component-Model-based WASI. More capable (networking, richer types), but Go's standard toolchain targets **preview 1**, not preview 2. |
| **Runtime** | The program that loads and executes a `.wasm` module: Wasmtime, wazero, WasmEdge, Node, etc. |
| **Host** | The environment running the wasm module — the runtime plus the machine it runs on. |
| **Capability** | A specific permission the host explicitly grants the module (e.g., access to one directory). WASI is *capability-based*: no permission is implicit. |
| **Preopen** | A directory the host opens and hands to the module before it starts (`--dir`). The module can only touch the file system through preopens. |
| **Ambient authority** | The traditional Unix model where any process can, by default, open any file its user can. WASI deliberately removes this. |
| **`go:wasmimport`** | A Go compiler directive (Go 1.21) to call a function *provided by the host* from Go. |
| **`go:wasmexport`** | A Go compiler directive (Go 1.24) to expose a Go function *to the host*. |

---

## Core Concepts

### What WASI actually is

A normal compiled program calls the operating system through *syscalls*: `read`, `write`, `open`, `clock_gettime`. These syscalls are specific to Linux, macOS, or Windows. A WebAssembly module has no operating system — it runs inside a runtime. So how does it open a file or print a line?

WASI is the answer. It is a **standard list of functions a host runtime promises to provide**, with fixed names and signatures: `fd_write`, `fd_read`, `path_open`, `clock_time_get`, `random_get`, `args_get`, `environ_get`, and so on. A wasm module *imports* these functions; the runtime *supplies* them. Because the interface is standardized, the **same `.wasm` file runs unchanged** on Wasmtime, wazero, WasmEdge, or Node.

Think of WASI as "POSIX-for-wasm, but smaller and sandboxed." It gives a wasm module just enough of an operating system to be useful, while keeping it inside a box.

### Why WASI exists: running wasm *outside* the browser

WebAssembly was born in the browser, where the browser itself provides the world (DOM, fetch, canvas). But people quickly realised the wasm sandbox is valuable *anywhere*: a portable, fast, memory-safe, language-agnostic unit of code that you can run on a server, in a CLI, or embedded inside a bigger application — as long as something gives it a way to do I/O. WASI is that "something." It is the bridge between a wasm module and a real machine, defined so that no single OS or runtime is required.

### Go's `wasip1` port

In Go 1.21, the team added `GOOS=wasip1 GOARCH=wasm`. From your point of view it is "just another platform," like `linux/amd64` or `darwin/arm64`. You write ordinary Go, and the toolchain produces a `.wasm` that uses WASI preview 1 for I/O.

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm ./...
```

Most of the standard library that does not need networking or threads "just works": `fmt`, `strings`, `encoding/json`, `os.Args`, `os.Getenv`, `time.Now`, `crypto/rand`, and file I/O on directories you were granted.

### The capability sandbox: zero authority by default

This is the single most important idea, and the one that surprises everyone. A `wasip1` module **starts with no permissions at all**:

- It cannot see *any* file on disk unless you preopen a directory for it.
- It cannot read environment variables unless the host passes them in.
- It cannot read command-line arguments unless the host passes them in.
- It has no network access (preview 1 has very limited socket support; see [middle.md](middle.md)).

This is the opposite of a normal Unix process, which inherits the *ambient authority* of the user that launched it (it can open anything that user can). With WASI, every door is locked, and the host hands you keys one at a time.

```bash
# This program tries to read /data/input.txt. It FAILS — no preopen.
wasmtime main.wasm

# Grant the directory, and it works:
wasmtime --dir=/data main.wasm
```

This "deny by default, grant explicitly" model is what makes wasm a good place to run *untrusted* code: a plugin, a user-supplied script, a third-party function.

### What works and what does not on `wasip1`

Works out of the box:
- **Standard I/O:** `os.Stdin`, `os.Stdout`, `os.Stderr`, `fmt.Println`.
- **Args and env:** `os.Args`, `os.Getenv` — *if the host passes them*.
- **Clocks:** `time.Now`, `time.Since`.
- **Random:** `crypto/rand`, `math/rand`.
- **Files:** `os.Open`, `os.ReadFile`, `os.WriteFile` — *but only inside preopened directories*.

Does **not** work (or is severely limited) on `wasip1`:
- **General networking.** WASI preview 1 has only minimal, runtime-dependent socket support. Listening on a TCP port from portable Go on `wasip1` does not work the way it does on Linux. (Some runtimes add non-standard socket extensions; see [middle.md](middle.md).)
- **Threads.** wasm preview-1 is single-threaded; goroutines are scheduled cooperatively on one OS thread. No `GOMAXPROCS > 1` parallelism.
- **`os/exec` / `fork`.** You cannot spawn subprocesses. There is no `fork`, no `exec`.
- **Signals** behave differently or are absent.

If your program needs to listen on a socket, spawn child processes, or use OS threads, `wasip1` is not (yet) the right target. If it reads input, computes, and writes output, `wasip1` is an excellent fit.

### `wasip1` vs `wasip2` (preview 1 vs preview 2)

WASI has versions, called *previews*.

- **Preview 1** (what `wasip1` targets) is a flat list of functions and is widely supported by every runtime today. It is mature and stable.
- **Preview 2** is a newer design built on the **Component Model**. It is richer — it has a real networking story, richer interface types, and composability — but it is newer and the Go standard toolchain **does not** target it directly today. Go targets `wasip1`.

So: `wasip1` is the target you use now. Preview 2 is the future direction of WASI; expect Go to follow, but for current work, `wasip1` is the answer. Do not confuse "WASI" (the general idea) with "preview 1" (the specific ABI Go compiles to).

---

## Real-World Analogies

**1. A hotel room with a keycard.** A normal program is like owning the whole hotel — you can walk into any room (any file) the building lets your account into. A WASI module is a guest with one keycard that opens exactly one room (one preopened directory). Want access to the gym and the pool too? The front desk (the host) must program those into your card explicitly. Nothing is yours by default.

**2. A standardized power socket.** WASI is like the standard wall socket. Any appliance (any `.wasm`) plugs into any socket (any runtime) and gets power (syscalls) the same way, whether the building is wired by Wasmtime, wazero, or Node. The appliance does not care who built the wall.

**3. A sealed lab glovebox.** Researchers handle dangerous material through a sealed glovebox: they can reach in through fixed ports, but nothing escapes and nothing enters except through those ports. A WASI module is the material; the preopens and stdio are the glovebox ports. Untrusted code runs inside, touching only what you pass through.

**4. A vending machine instead of a kitchen.** A normal process is a full kitchen — open any cupboard, use any appliance. A WASI module is a vending machine: it can only dispense from the slots someone stocked. It cannot wander into the pantry.

---

## Mental Models

### Model 1 — `wasip1` is "just another GOOS"

You do not learn a new language. You set two environment variables and `go build`. The Go you already know compiles. The differences are at the *edges* — what syscalls are available — not in the language.

### Model 2 — Deny by default, grant explicitly

A native process: "you can do anything your user can, unless blocked." A WASI module: "you can do nothing, unless granted." Flip your intuition. Every capability — a directory, an env var, an argument — is a deliberate grant from the host.

### Model 3 — The module imports the world; the host provides it

The `.wasm` file is a list of *imported functions* it needs (`wasi_snapshot_preview1.fd_write`, …) plus your compiled code. The runtime *links* those imports to real implementations at load time. The module is inert until a host gives it a world.

### Model 4 — Portable bytes, pluggable host

One `main.wasm` runs on Wasmtime today, wazero tomorrow, inside your own Go program the day after. The bytes do not change; only the host changes. That portability is the whole point.

### Model 5 — `wasip1` is for compute, not for servers (yet)

A clean mental cut: if your program is shaped like a *function* — read input, transform, write output — `wasip1` fits. If it is shaped like a *daemon* — listen on a port, hold connections, spawn workers — `wasip1` is not ready for that on the standard toolchain. Use it where it shines.

---

## Pros & Cons

### Pros

- **Portable.** One `.wasm` runs unchanged on every WASI runtime and every CPU architecture.
- **Sandboxed by default.** Zero ambient authority; you grant capabilities explicitly. Excellent for untrusted code.
- **Memory-safe and isolated.** A crash in the module cannot corrupt the host's memory.
- **Fast startup.** wasm modules instantiate in microseconds-to-milliseconds — far faster than booting a container or VM.
- **Language-agnostic ecosystem.** Your Go module and someone's Rust module run side by side on the same runtime.
- **First-class Go support since 1.21.** Officially maintained, not a hack.

### Cons

- **No full networking on preview 1.** Servers and rich socket programs do not port cleanly.
- **No threads / no real parallelism.** Single-threaded execution; goroutines cooperate on one thread.
- **No subprocesses.** `os/exec`, `fork`, `exec` are unavailable.
- **Large binaries.** A trivial Go `wasip1` binary is megabytes — the Go runtime ships inside it.
- **Preview 1 vs preview 2 churn.** The standard you target today (preview 1) will eventually be superseded; the ecosystem is still moving.
- **Runtime differences.** Capabilities and extensions vary between runtimes; "portable" has caveats at the edges.

The trade is: you give up servers, threads, and subprocesses, and you gain portability, a strong sandbox, and fast startup. For plugins, edge functions, and sandboxed compute, that is a great deal.

---

## Use Cases

You should reach for `GOOS=wasip1` when:

- **Plugin systems.** A host program (often itself in Go, using wazero) loads user- or vendor-supplied `.wasm` plugins and runs them safely, with only the capabilities the host grants.
- **Serverless / edge functions.** Platforms (Fastly, Fermyon Spin, Cloudflare-style edges) run wasm at the edge; fast cold start and small isolation units are exactly what wasm gives.
- **Sandboxed execution of untrusted code.** Run code you did not write — a user's transformation, a third-party rule — without giving it the keys to your machine.
- **Portable CLIs and filters.** A "read stdin, transform, write stdout" tool shipped as a single architecture-independent `.wasm`.
- **Reproducible compute units.** A deterministic transformation that must run identically across machines and architectures.

You should **not** reach for `wasip1` when:

- You need to write a network server that listens on a port.
- You need OS threads or true multi-core parallelism.
- You need to spawn subprocesses.
- Binary size is tightly constrained (a Go wasm binary is large; TinyGo helps — see [16.3 TinyGo](../03-tinygo-for-wasm-and-embedded/junior.md)).

---

## Code Examples

### Example 1 — Hello, WASI

```go
// main.go
package main

import "fmt"

func main() {
    fmt.Println("hello from wasip1")
}
```

Build and run:

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
wasmtime main.wasm
# hello from wasip1
```

The same `main.wasm` runs on wazero:

```bash
wazero run main.wasm
# hello from wasip1
```

### Example 2 — Reading arguments and environment

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("args:", os.Args)
    fmt.Println("HOME:", os.Getenv("HOME"))
}
```

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .

# Args after the module name are passed to the program:
wasmtime main.wasm alpha beta
# args: [main.wasm alpha beta]
# HOME:

# Pass an env var explicitly — nothing is inherited by default:
wasmtime --env HOME=/home/me main.wasm
# args: [main.wasm]
# HOME: /home/me
```

Notice that `HOME` is empty until you pass `--env`. The module does *not* inherit your shell's environment.

### Example 3 — File I/O needs a preopen

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    data, err := os.ReadFile("/data/input.txt")
    if err != nil {
        fmt.Println("read failed:", err)
        os.Exit(1)
    }
    fmt.Printf("read %d bytes\n", len(data))
}
```

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .

# Without a preopen: fails — the module cannot see the filesystem.
wasmtime main.wasm
# read failed: open /data/input.txt: ...

# Grant /data, mapped to /data inside the sandbox:
wasmtime --dir=/data main.wasm
# read 27 bytes
```

The `--dir` flag is the host *granting a capability*. Without it, there is no filesystem at all.

### Example 4 — The `go run` wrapper (running without naming a runtime)

You can configure `go run` and `go test` to use a runtime automatically by setting the exec wrapper:

```bash
# Tell go to run wasip1 binaries with wasmtime:
go env -w GOOS=wasip1 GOARCH=wasm

# Point the toolchain at a wrapper that knows how to execute .wasm.
# The Go distribution ships a helper; many setups just set:
export GOWASIRUNTIME=wasmtime    # used by the misc/wasm exec wrapper

go run .
# hello from wasip1
```

In practice, with `GOOS=wasip1 GOARCH=wasm` set, `go run .` and `go test ./...` invoke the `go_wasip1_wasm_exec` wrapper script from the Go distribution, which shells out to the runtime named by `GOWASIRUNTIME` (defaulting to `wasmtime`). This lets you run and test wasm builds with the normal `go run`/`go test` workflow.

When you are done experimenting, reset:

```bash
go env -u GOOS GOARCH
```

### Example 5 — Standard input as a filter

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

func main() {
    s := bufio.NewScanner(os.Stdin)
    for s.Scan() {
        fmt.Println(strings.ToUpper(s.Text()))
    }
}
```

```bash
GOOS=wasip1 GOARCH=wasm go build -o upper.wasm .
echo "make me loud" | wasmtime upper.wasm
# MAKE ME LOUD
```

A classic Unix filter — but as a single, portable, sandboxed `.wasm`.

### Example 6 — Clocks and randomness

```go
package main

import (
    "crypto/rand"
    "fmt"
    "time"
)

func main() {
    fmt.Println("now:", time.Now().Format(time.RFC3339))
    b := make([]byte, 8)
    _, _ = rand.Read(b)
    fmt.Printf("random: %x\n", b)
}
```

```bash
GOOS=wasip1 GOARCH=wasm go build -o cr.wasm .
wasmtime cr.wasm
# now: 2026-06-15T10:00:00Z
# random: 9f3a...
```

`time.Now` maps to WASI's `clock_time_get`; `crypto/rand` maps to `random_get`. Both are standard preview-1 functions, so they work everywhere.

---

## Coding Patterns

### Pattern: build target as an environment prefix

Keep the build command in a script so you do not mistype the GOOS/GOARCH:

```bash
#!/usr/bin/env bash
GOOS=wasip1 GOARCH=wasm go build -o "$1.wasm" "./cmd/$1"
```

### Pattern: a Makefile target for wasm builds

```Makefile
.PHONY: wasm
wasm:
	GOOS=wasip1 GOARCH=wasm go build -o bin/app.wasm ./cmd/app
```

### Pattern: filter-shaped programs

Programs that read stdin and write stdout port to `wasip1` with zero changes. Design tools as filters and they become portable wasm for free.

### Pattern: explicit capabilities documented at the call site

Write down which preopens and env vars your program needs, right next to the run command, so users know how to invoke it:

```bash
# Requires: --dir=./data (reads ./data/in.json, writes ./data/out.json)
wasmtime --dir=./data app.wasm
```

---

## Clean Code

- **Do not assume ambient authority.** Code defensively: check errors on `os.Open` and emit a clear message ("did you pass `--dir`?") instead of a cryptic failure.
- **Keep platform-specific code behind build tags.** If you have native-only code (e.g., a server), guard it with `//go:build !wasip1` and provide a wasm-friendly path with `//go:build wasip1`.
- **Centralise the build command.** One script or Makefile target, not a command pasted into many READMEs.
- **Do not hard-code host paths.** Read input/output paths from args or env so the same module works under different preopens.
- **Fail loudly on unsupported operations.** If your code path needs networking, detect `wasip1` and return a clear error rather than hanging.

---

## Product Use / Feature

When you ship `wasip1` modules in a product, they affect:

- **Distribution.** One `.wasm` artifact instead of per-architecture binaries. No `GOARCH` matrix.
- **Plugin ecosystems.** Customers (or third parties) write plugins in any wasm-capable language; your host loads them safely.
- **Edge deployment.** Fast cold start makes wasm attractive for serverless and edge platforms.
- **Security posture.** Untrusted code runs in a deny-by-default sandbox; capabilities are auditable.
- **Operational simplicity.** No container image to build for the module itself; the runtime is the only dependency.

For platforms that run customer-supplied logic — CDNs, automation tools, data pipelines — `wasip1` is increasingly the unit of safe, portable compute.

---

## Error Handling

### "open …: operation not permitted" / "no such file or directory" for files that exist

The host did not preopen the directory. Add `--dir=<path>`. The file exists on disk, but the module's sandbox cannot see it without a grant.

### Empty `os.Getenv` / missing `os.Args`

The host did not pass them. Use `--env KEY=VALUE` and place arguments after the module name. Nothing is inherited from your shell automatically.

### "unknown import: `wasi_snapshot_preview1::sock_accept`" (or similar)

Your code (or a dependency) used a function the runtime does not implement, often a networking call. Either avoid that code path on `wasip1`, or use a runtime that provides the extension. See [middle.md](middle.md).

### The program hangs

Common cause: code that blocks on a network read or waits for a subprocess — operations that never complete on `wasip1`. Audit for networking, `os/exec`, or blocking syscalls and guard them with build tags.

### "GOOS/GOARCH pair wasip1/wasm not supported"

You are on Go older than 1.21. Upgrade: `wasip1` did not exist before then.

### `go run` does nothing useful

You did not set up the exec wrapper. Either name the runtime directly (`wasmtime main.wasm`) or set `GOWASIRUNTIME` and use `go run`/`go test` with `GOOS=wasip1 GOARCH=wasm`.

---

## Security Considerations

- **Deny by default is your friend.** The sandbox is the feature. Treat every `--dir`, `--env`, and argument as a security decision: grant the minimum.
- **Preopen the narrowest directory.** Grant `--dir=./data` (one folder), never `--dir=/`. A module with `/` preopened can read everything its host process can.
- **wasm isolates memory, not capabilities.** The module cannot corrupt host memory, but if you grant it a sensitive directory it will read your secrets. Memory safety and capability scoping are different protections — you need both.
- **Untrusted modules are still code.** A sandboxed module can still spin the CPU, allocate memory, or write garbage to a granted file. Sandboxing limits *reach*, not *intent*. Add resource limits (fuel/timeouts) at the runtime level.
- **Validate inputs the module produces.** Output from an untrusted module is untrusted data. Do not blindly trust files it wrote.
- **Pin your runtime version.** Capabilities and bugs differ across runtime versions; pin and test.

---

## Performance Tips

- **Startup is fast; binary size is not.** Instantiation is quick, but a Go `wasip1` binary is several MB. If size matters, build with `-ldflags="-s -w"` and consider TinyGo. See [optimize.md](optimize.md).
- **Single-threaded.** Do not expect goroutine parallelism to use multiple cores; on `wasip1` they cooperate on one thread.
- **Precompile / cache modules.** Runtimes can compile a `.wasm` to native code once and cache it (e.g., Wasmtime's `wasmtime compile`). Reuse the compiled artifact to avoid recompilation on every run.
- **Reuse instances in a host.** When embedding (wazero), compile the module once and instantiate per request rather than recompiling each time.
- **Avoid chatty syscalls.** Each WASI call crosses the host boundary. Buffer I/O (`bufio`) rather than writing byte-by-byte.

---

## Best Practices

1. **Pin Go ≥ 1.21** (≥ 1.24 if you need `go:wasmexport`). Earlier versions cannot build `wasip1`.
2. **Grant the minimum capability.** Narrow preopens, only the env vars you need.
3. **Design programs as filters** (stdin → stdout) where possible; they port for free.
4. **Guard native-only code with build tags** (`//go:build !wasip1`) and provide wasm fallbacks.
5. **Name your runtime explicitly in docs**, and pin its version, so behaviour is reproducible.
6. **Test with `go test` under `wasip1`** using the exec wrapper, so your wasm path is covered in CI.
7. **Do not rely on networking or subprocesses**; if you need them, `wasip1` is the wrong target today.
8. **Measure binary size and startup** if you deploy at the edge; optimise deliberately.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Expecting ambient file access
Your program reads `/etc/hosts` and it works natively but fails on `wasip1`. There is no implicit filesystem. You must preopen — and even then only what you granted is visible.

### Pitfall 2 — Forgetting `--env`
`os.Getenv("PATH")` returns `""` on `wasip1` unless you pass `--env PATH=...`. The shell environment is not inherited.

### Pitfall 3 — Assuming networking works
`net.Listen("tcp", ":8080")` does not work on portable `wasip1`. Preview 1 has no general networking. This catches every newcomer who tries to "run my web server in wasm."

### Pitfall 4 — Confusing `wasip1` with `js/wasm`
`GOOS=js` is the *browser* target with a JavaScript host; `GOOS=wasip1` is the *server/CLI* target with a WASI host. They are different `GOOS` values, different runtimes, different APIs.

### Pitfall 5 — Confusing preview 1 and preview 2
Go targets preview 1 (`wasip1`). Preview 2 is a different, newer ABI Go does not compile to today. Tutorials that mention "WASI 0.2" or "the Component Model" are about preview 2; they do not apply to `GOOS=wasip1`.

### Pitfall 6 — Path mismatch in preopens
`wasmtime --dir=./data` maps the host `./data` to `/data`-ish inside the sandbox depending on the runtime. If the path your code uses does not match the granted path, you get "not found" even though the directory was preopened. Use the runtime's mapping syntax (e.g., `--dir=host::guest`) and match it in code.

### Pitfall 7 — Surprising binary size
A "hello world" `.wasm` from Go is multiple megabytes because the Go runtime is embedded. This is normal, not a bug. TinyGo produces far smaller modules at the cost of standard-library coverage.

### Pitfall 8 — Runtime feature differences
A module that uses a non-standard socket extension runs on WasmEdge but fails on a stock Wasmtime. "Portable" means "portable across standard preview-1 features." Extensions are not portable.

---

## Common Mistakes

- **Running the browser build by accident.** Using `GOOS=js` then trying `wasmtime main.wasm` — the js target imports JavaScript glue, not WASI. Use `GOOS=wasip1`.
- **Forgetting `--dir` and blaming Go.** The file exists; the sandbox just was not granted it.
- **Trying to listen on a port.** Networking is not available on preview 1.
- **Expecting goroutines to use all cores.** Single-threaded on `wasip1`.
- **Shipping without pinning the runtime.** Behaviour drifts between runtime versions.
- **Hard-coding absolute host paths** that do not match the preopen mapping.
- **Assuming `os/exec` works.** No subprocesses.
- **Mixing up "WASI" (the idea) with "preview 1" (the ABI Go targets).**

---

## Common Misconceptions

> *"WASI is only for the browser."*

Backwards. WASI is specifically for running wasm *outside* the browser. The browser target is `GOOS=js`.

> *"`wasip1` gives my program the same powers as a normal process."*

No. It starts with zero authority. You grant capabilities (dirs, env, args) explicitly.

> *"WASI preview 1 supports full networking."*

No. Preview 1 has only minimal, non-portable socket support. General TCP/UDP servers do not work on standard `wasip1`.

> *"Go compiles to WASI preview 2 / the Component Model."*

No. Go's standard toolchain targets **preview 1** (`wasip1`). Preview 2 is the future, not the current `GOOS`.

> *"A wasm sandbox means the module can't do anything harmful."*

It can still burn CPU, allocate memory, and corrupt files you granted it. Sandboxing limits *reach*, not *behaviour*. Add timeouts and resource limits.

> *"The `.wasm` is tiny."*

A Go `wasip1` binary embeds the Go runtime and is typically several MB. Use TinyGo or strip flags if you need small.

---

## Tricky Points

- **`wasip1` is a `GOOS`, `wasm` is the `GOARCH`.** You need both: `GOOS=wasip1 GOARCH=wasm`. Setting only one fails.
- **Capabilities come from the *host invocation*, not the module.** The same `.wasm` is more or less powerful depending on the flags you pass at run time.
- **`--dir` maps host paths to guest paths**, and the mapping syntax differs by runtime. Read your runtime's docs.
- **`go run`/`go test` need an exec wrapper** (`GOWASIRUNTIME`) to execute the produced `.wasm`. Without it they cannot launch the binary.
- **`crypto/rand` and `time.Now` work** because `random_get` and `clock_time_get` are standard preview-1 functions; many other syscalls are not present.
- **Build tags use `wasip1`**: `//go:build wasip1` selects wasm-specific code; `//go:build !wasip1` excludes it from wasm builds.
- **`go:wasmimport` (1.21) and `go:wasmexport` (1.24)** let you call into / out of the host. You will meet them in [middle.md](middle.md) and [professional.md](professional.md).

---

## Test

Try this in a scratch folder.

```bash
mkdir wasi-test && cd wasi-test
go mod init example.com/wt
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("args:", os.Args)
    fmt.Println("FOO:", os.Getenv("FOO"))
    if data, err := os.ReadFile("/data/x.txt"); err == nil {
        fmt.Printf("file: %d bytes\n", len(data))
    } else {
        fmt.Println("file:", err)
    }
}
EOF
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
mkdir -p data && echo "hello" > data/x.txt
wasmtime main.wasm one two
wasmtime --env FOO=bar --dir=./data main.wasm one two
```

Now answer:
1. Why is `FOO:` empty in the first run but `bar` in the second? (Answer: env is granted only with `--env`.)
2. Why does `file:` show an error in the first run? (Answer: no `--dir` preopen.)
3. What `GOOS`/`GOARCH` pair did you build with, and what happens if you omit `GOARCH=wasm`? (Answer: `wasip1`/`wasm`; omitting the arch fails to build for wasm.)
4. Would this same `main.wasm` run on wazero? (Answer: yes — it uses only standard preview-1 functions.)

---

## Tricky Questions

**Q1.** I set `GOOS=wasip1` but forgot `GOARCH=wasm`. What happens?

A. The build fails or targets the wrong arch. `wasip1` is only valid with `GOARCH=wasm`. Always set both.

**Q2.** My program reads `/etc/hosts` fine natively but fails under `wasmtime`. Why?

A. No ambient filesystem. Even with `--dir`, you only see what you granted. `/etc/hosts` is outside any preopen, so it is invisible.

**Q3.** Can I run a Go HTTP server on `wasip1`?

A. Not on the standard toolchain today. Preview 1 lacks general networking. Some runtimes add socket extensions, but that is non-portable and not the standard story.

**Q4.** Is `wasip1` the same as the browser wasm target?

A. No. The browser target is `GOOS=js GOARCH=wasm` and uses a JavaScript host. `wasip1` uses a WASI host and runs outside the browser.

**Q5.** Why is my "hello world" `.wasm` 2 MB?

A. The Go runtime is compiled into every binary. That is expected. Use `-ldflags="-s -w"` to trim, or TinyGo for much smaller output.

**Q6.** Does `wasip1` use goroutines and threads?

A. Goroutines work, but they are scheduled cooperatively on a single thread. There is no multi-core parallelism on preview 1.

**Q7.** What is the difference between `wasip1` and `wasip2`?

A. `wasip1` is WASI preview 1 (a flat function list, what Go targets). `wasip2` refers to WASI preview 2, the newer Component-Model-based design, which the Go standard toolchain does not target today.

**Q8.** How do I pass a command-line flag to my wasm program?

A. Put it after the module name: `wasmtime main.wasm --my-flag value`. The runtime forwards arguments after the `.wasm` to the program as `os.Args`.

**Q9.** Will the same `.wasm` behave identically on Wasmtime and wazero?

A. For standard preview-1 features, yes. If you used a non-standard extension, behaviour differs. Stick to standard features for portability.

**Q10.** Can I read an environment variable that exists in my shell without `--env`?

A. No. The module inherits nothing. You must pass each variable explicitly (or use a runtime flag that forwards the whole environment, which some runtimes provide but which defeats the sandbox's intent).

---

## Cheat Sheet

```bash
# Build a wasip1 module
GOOS=wasip1 GOARCH=wasm go build -o main.wasm ./...

# Run it on various runtimes (same file)
wasmtime main.wasm
wazero run main.wasm
wasmedge main.wasm

# Grant a directory (a capability)
wasmtime --dir=./data main.wasm

# Pass environment variables (none inherited by default)
wasmtime --env KEY=value main.wasm

# Pass program arguments (after the module name)
wasmtime main.wasm arg1 arg2

# Use go run / go test with a runtime wrapper
go env -w GOOS=wasip1 GOARCH=wasm
export GOWASIRUNTIME=wasmtime
go run .
go test ./...
go env -u GOOS GOARCH    # reset when done

# Strip the binary to shrink it
GOOS=wasip1 GOARCH=wasm go build -ldflags="-s -w" -o main.wasm .
```

```
What works on wasip1:           What does NOT (well):
---------------------           ---------------------
stdin / stdout / stderr         general TCP/UDP networking
os.Args (if passed)             OS threads / multi-core
os.Getenv (if passed)           os/exec, fork, exec
time.Now (clock)                signals (mostly)
crypto/rand (random)            arbitrary filesystem access
file I/O on preopens            (must preopen each dir)
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| File "not found" but it exists | No preopen | `--dir=<path>` |
| `os.Getenv` empty | No env granted | `--env KEY=VALUE` |
| `os.Args` missing values | Args not after module | `wasmtime main.wasm a b` |
| "wasip1/wasm not supported" | Go < 1.21 | Upgrade Go |
| Program hangs | Network/subprocess call | Remove; guard with build tags |
| `go run` does nothing | No exec wrapper | Set `GOWASIRUNTIME` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what WASI is
- [ ] State the two-variable build command for `wasip1`
- [ ] Run the produced `.wasm` on at least one runtime
- [ ] Explain "deny by default" and what a capability is
- [ ] Grant a directory with `--dir` and an env var with `--env`
- [ ] List three things that work and three that do not on `wasip1`
- [ ] Explain the difference between `GOOS=js` and `GOOS=wasip1`
- [ ] Explain the difference between WASI preview 1 and preview 2
- [ ] Diagnose a "file not found" caused by a missing preopen
- [ ] Run a `wasip1` program with `go run` using the exec wrapper
- [ ] Explain why a Go `wasip1` binary is large

---

## Summary

WASI (WebAssembly System Interface) is a standardized, capability-based syscall interface that lets WebAssembly modules run *outside* the browser — on servers, in CLIs, embedded in other programs — through any conforming runtime. Go targets **WASI preview 1** via `GOOS=wasip1 GOARCH=wasm`, added in Go 1.21. You compile ordinary Go into a portable, sandboxed `.wasm` and run it on Wasmtime, wazero, WasmEdge, or Node.

The defining property is the **capability sandbox**: a `wasip1` module starts with zero authority. Files, environment variables, and arguments are granted explicitly by the host at run time (`--dir`, `--env`, trailing args). Standard I/O, clocks, randomness, and file access on preopened directories work; general networking, OS threads, and subprocesses do not.

`wasip1` is the target you use today; **preview 2** (the Component Model) is the future direction but is not what the Go standard toolchain compiles to. Use `wasip1` for plugins, edge/serverless functions, sandboxed untrusted code, and portable filters — the shapes where a deny-by-default, fast-starting, portable compute unit is exactly right.

---

## What You Can Build

After learning this:

- **A portable CLI filter** shipped as one architecture-independent `.wasm`.
- **A sandboxed transformation** that runs untrusted user logic with only a single granted directory.
- **An edge/serverless function** that cold-starts in milliseconds on a wasm platform.
- **A reproducible compute unit** that runs identically on Wasmtime, wazero, and WasmEdge.
- **The "leaf" of a plugin system** whose host (built later, with wazero) loads and runs your module safely.

You cannot yet:
- Call host-provided functions from Go (next: `go:wasmimport` in middle.md)
- Export Go functions to a host (later: `go:wasmexport`, Go 1.24, in professional.md)
- Embed and run plugins inside a Go host with wazero (senior.md)
- Reason about the preview-1 vs preview-2 migration path (senior.md)

---

## Further Reading

- [Go blog: "WASI support in Go"](https://go.dev/blog/wasi) — the official 1.21 announcement, authoritative.
- [Go wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — overview of all Go wasm targets including `wasip1`.
- [WASI.dev](https://wasi.dev) — the WASI project, preview 1 and preview 2.
- [Wasmtime documentation](https://docs.wasmtime.dev) — the reference runtime; preopens, env, fuel.
- [wazero](https://wazero.io) — a pure-Go runtime for embedding wasm in Go programs.

---

## Related Topics

- [16.1 js/wasm in the Browser](../01-goos-js-wasm-browser/junior.md) — the *other* Go wasm target
- [16.3 TinyGo for wasm & Embedded](../03-tinygo-for-wasm-and-embedded/junior.md) — much smaller wasm binaries
- [16.4 wasm Interop & Performance](../04-wasm-interop-and-performance/junior.md) — `go:wasmimport`/`go:wasmexport` and the host boundary
- [16.5 wasm in Production](../05-wasm-in-production/junior.md) — deploying wasm at the edge and as plugins
- 6.x Build constraints and tags — guarding platform-specific code

---

## Diagrams & Visual Aids

```
The two Go wasm targets:

    GOOS=js GOARCH=wasm              GOOS=wasip1 GOARCH=wasm
    -------------------              -----------------------
    runs IN the browser              runs OUTSIDE the browser
    host = JavaScript engine         host = WASI runtime
    talks to DOM/fetch via JS        talks to OS via WASI syscalls
    syscall_js glue                  wasi_snapshot_preview1 imports
    (16.1)                           (this page)
```

```
The capability sandbox:

    native process                   wasip1 module
    --------------                   -------------
    user's ambient authority         ZERO authority at start
    can open any file user can       can open NOTHING
    inherits the environment         inherits NOTHING
                                          │
                                     host grants, one at a time:
                                       --dir=./data   → one directory
                                       --env KEY=VAL  → one variable
                                       trailing args  → os.Args
```

```
How a .wasm runs:

    main.wasm  (imports: wasi_snapshot_preview1.fd_write, path_open, ...)
        │
        │  loaded by
        ▼
    [ runtime: wasmtime | wazero | wasmedge | node ]
        │
        │  links imports to real implementations,
        │  grants only the capabilities you passed as flags
        ▼
    [ executes inside the sandbox ]
        │
        ├── stdout / stderr   → your terminal
        ├── preopened dirs    → only what --dir granted
        └── everything else   → denied
```

```
wasip1 vs wasip2:

    WASI preview 1 (wasip1)          WASI preview 2 (wasip2)
    -----------------------          -----------------------
    flat list of functions           Component Model based
    mature, universal support        newer, richer (networking, types)
    Go targets THIS today            future direction; Go not yet
    GOOS=wasip1                      (no standard GOOS yet)
```
