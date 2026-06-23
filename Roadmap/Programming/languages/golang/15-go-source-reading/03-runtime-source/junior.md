# Reading the `runtime` Package — Junior

## 1. Where this topic sits

In the earlier topics of this series you opened `net/http` and `sync` and read them as Go programmers reading Go code. You looked for types, traced one function, followed an interface to its implementations. Same techniques. Same tools.

This topic asks: **can we use those techniques on `runtime`?**

The honest answer is *mostly, yes, with caveats*. The `runtime` package is the trickiest stdlib package to read because it is partly normal Go, partly Go with hidden compiler help, and partly assembly. We already did a deeper dive into the runtime as a *system* in topic **`14-runtime-and-internals/01-runtime-source-dive`**. Here we do something narrower — we read `runtime` the same way we read any other stdlib package and call out where the rules change.

> If you haven't read 14-01 yet, you can still do this topic — but the GMP types and the scheduler loop are explained there in more depth, and we'll lean on that.

---

## 2. Why `runtime` source is the hardest stdlib to read

Three things make `runtime/*.go` look different from `net/http/*.go`:

1. **Hidden helpers.** Functions like `mcall`, `systemstack`, `gopark`, `acquirem` exist *only* inside the runtime. You can't import them. There's no godoc. To know what they do you read the source comments and the call sites.
2. **Compiler magic.** Some "functions" you see have no body — the compiler rewrites them at compile time. For example `runtime.getg()` is a single machine instruction (read a register). The `.go` file is mostly a placeholder for the toolchain.
3. **Restricted Go dialect.** Hot paths in the runtime avoid `interface{}`, `append`, `make`, and even normal `panic` — because those things themselves call into the runtime, and you can't have the scheduler calling the scheduler from inside a critical section. You'll see `//go:nosplit`, `//go:nowritebarrier`, `//go:systemstack` pragmas restricting what a function may do.

For a learning reader, the practical effect is: **expect to hit walls.** When a function calls `mcall(parkunlock_c)` and you have no idea what that is, don't give up — bookmark it and move on. The trick is to read for *shape*, not completeness.

---

## 3. File map (short recap)

Topic 14-01 covered the file layout in detail. Quick refresher:

| File | What it covers |
|------|----------------|
| `runtime2.go` | Type declarations: `g`, `m`, `p`, `hchan`, `sudog`, `sched` |
| `proc.go` | Scheduler: `newproc`, `schedule`, `gopark`, `goready` |
| `chan.go` | Channels: `chansend`, `chanrecv`, `closechan` |
| `select.go` | `select` statement implementation |
| `panic.go` | `defer`, `panic`, `recover` |
| `malloc.go`, `mheap.go` | Allocator |
| `mgc.go`, `mgcmark.go`, `mgcsweep.go` | Garbage collector |
| `stack.go` | Goroutine stack growth and shrinking |
| `time.go` | Timers, `time.Sleep` |
| `netpoll.go` | Network poller |
| `sema.go` | Semaphore used by `sync.Mutex`, `sync.WaitGroup` |
| `asm_*.s`, `sys_*_*.s` | Assembly: register save/restore, syscalls, atomic primitives |

For everything you'd want to know about *what each file does*, see 14-01. The job here is to look at three of these files as **a reader**.

---

## 4. A different lens — the runtime source as a *spec*

`net/http` has an RFC (RFC 7230, 9110). `sync.Mutex` has a documented contract on godoc. What is the contract for *goroutines*? For *channels*? For *defer*?

There isn't a separate spec document. **The runtime source is the spec.** The behaviour of `go f()`, of `ch <- x`, of `defer recover()` is defined by what the code in `proc.go`, `chan.go`, `panic.go` actually does. The Go Language Specification describes the *syntax* and *semantics at the language level*, but when you ask "what exactly happens when two goroutines send into a buffered channel at the same time?" the answer is: read `chansend` in `chan.go`.

This reframes how you read. You're not reading an implementation of something documented elsewhere — you're reading **the canonical definition**.

> **Implication:** if you see a comment in `runtime/chan.go` that contradicts a Stack Overflow answer, the source wins. Always.

---

## 5. The three files to actually open

If you only ever open three runtime files in your life, pick these:

### 5.1. `runtime2.go` — the dictionary

This file declares the structs. No methods. No logic. Just types. Reading it is like reading a glossary:

```go
type g struct {
    stack       stack
    sched       gobuf
    atomicstatus atomic.Uint32
    goid        uint64
    // ~100 more fields
}
```

You won't understand every field. That's fine. The point is that when `proc.go` says `gp.atomicstatus.Store(_Grunning)` later, you can come back here and see that `atomicstatus` is a `uint32` of state constants. The types ground everything else.

### 5.2. `chan.go` — a complete subsystem in one file

`chan.go` is roughly 850 lines and contains *everything* about channels: the struct (`hchan`), creation (`makechan`), send (`chansend`), receive (`chanrecv`), close (`closechan`), and the parking/waking logic that connects channels to the scheduler.

This is the best teaching file in the entire runtime. It's:

- Small enough to read end-to-end in an afternoon.
- Self-contained — almost everything it does is in this one file.
- Connected to real Go code you write every day (`ch <- x`).
- Uses the runtime's tricky helpers (`gopark`, `goready`, `mcall`) in a context simple enough to follow.

If you finish `chan.go`, you've essentially learned how blocking works in Go.

### 5.3. `panic.go` — defer, panic, recover

`panic.go` is shorter than you'd expect (~1500 lines including comments). It defines:

- The `_panic` and `_defer` linked lists per goroutine.
- `deferproc` — what the compiler emits for `defer f()`.
- `gopanic` — what the compiler emits for `panic(x)`.
- `gorecover` — what `recover()` does (it's *only* meaningful inside a deferred function — the source explains why).

Reading `panic.go` rewires your mental model of defer from "magic" to "linked list walk in the function epilogue".

---

## 6. The `// from runtime/...` reference convention

Throughout this curriculum we use a comment convention when quoting runtime source:

```go
// from runtime/chan.go, line ~178 (go1.22)
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // ...
}
```

It tells you three things:
1. Which file in `$GOROOT/src/runtime/` the snippet came from.
2. Approximate line (so you can grep if line numbers shifted).
3. The Go version it was pulled against.

You'll see this in `senior.md` and `professional.md`. When you copy code from the runtime into your own notes, adopt the same convention — internals move between versions, and a snippet without a version stamp ages badly.

---

## 7. How to *verify* your reading

Reading is half the work. Confirming you understood it is the other half. Three techniques:

**(a) Write a test that should hit the path.** If you think `chansend` blocks on a full buffered channel, write a test that fills the buffer and asserts the next send doesn't complete within 50ms. If the test passes, your reading is behaviourally right.

**(b) Step through with `dlv`.** Delve lets you breakpoint *inside* the runtime:

```bash
dlv test
(dlv) break runtime.chansend
(dlv) continue
(dlv) print c.qcount
```

Nothing makes runtime source real like watching it execute on your own program.

**(c) Inspect compiler output with `go tool objdump`.**

```bash
go build -o prog main.go
go tool objdump -s main.main prog | grep -i chansend
```

You'll see a `CALL runtime.chansend1(SB)` instruction — the compiler's contract with the runtime. Every `ch <- x` in your code becomes a call to that exact function.

---

## 8. Prerequisites

- Junior-level Go (you've written goroutines, channels, used `defer`).
- The `net/http` and `sync` source-reading topics earlier in this series — they teach the *technique*.
- A copy of the Go source locally (`go env GOROOT`).
- Comfort opening a 6000-line file without panicking. You're skimming, not auditing.

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **`runtime` package** | The stdlib package at `$GOROOT/src/runtime` that implements goroutines, channels, GC, allocation |
| **`hchan`** | The channel struct, declared in `runtime2.go`, implemented in `chan.go` |
| **`mcall`** | Switch from a goroutine stack onto the scheduler's `g0` stack; only callable from inside the runtime |
| **`gopark` / `goready`** | Park a goroutine off the run queue; mark it runnable |
| **`//go:nosplit`** | Pragma forbidding stack-growth checks in this function — used in low-level hot paths |
| **`//go:systemstack`** | Pragma forcing the function to run on the system stack, not a goroutine stack |
| **objdump** | `go tool objdump`, disassembles a compiled binary so you can see what the compiler emitted |
| **dlv** | Delve, the Go debugger — supports stepping into runtime code |

---

## 10. Common confusions at this level

- **"Reading `runtime` source means understanding it line by line." No.** Even Go core developers don't claim to fully understand every line of `mgc.go`. Aim to follow *shape* — what calls what, what state is changed.
- **"I should start with `proc.go`." Don't.** It's the biggest file and the most interconnected. Start with `chan.go` or `panic.go` — they're more self-contained.
- **"Pragmas like `//go:nosplit` are comments." They are not.** The compiler reads them and changes how the function is compiled. Treat them as part of the code.
- **"If I can't find the function body, it's broken." Some functions are pure compiler intrinsics.** `getg()`, `KeepAlive`, `gogo` — the body is either trivial or assembly elsewhere.
- **"`recover()` works anywhere if there's a panic." No — only inside a deferred function.** `panic.go`'s `gorecover` checks this with `gp._panic != nil && gp._panic.argp == argp`. Reading the source clarifies why.

---

## 11. A recipe for reading `chan.go`

A time-boxed plan that works (five short sessions, ~3.5 hours total):

1. **Session 1.** `runtime2.go` — find `hchan`. Describe `buf`, `qcount`, `dataqsiz`, `sendq`, `recvq` in your own words.
2. **Session 2.** `chan.go` — read `makechan`. Trace how the buffer is allocated; note the zero-sized element special case.
3. **Session 3.** `chansend`. Identify the three branches: (a) receiver waiting, (b) buffer has space, (c) block and park.
4. **Session 4.** `chanrecv`. Mirrors `chansend` plus a fourth branch — channel closed.
5. **Session 5.** `closechan`. See how it wakes every parked sender and receiver.

Don't try to do this in one sitting — five short reads beat one long one.

---

## 12. A tiny example that lets you see the runtime in action

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    fmt.Println("goroutines:", runtime.NumGoroutine())

    go func() { ch <- 3 }() // blocks — buffer is full

    for runtime.NumGoroutine() < 2 {
        runtime.Gosched()
    }
    fmt.Println("after blocking sender:", runtime.NumGoroutine())
    <-ch; <-ch; <-ch
}
```

Three runtime calls leave fingerprints here:
- `make(chan int, 2)` → `makechan` (chan.go).
- `ch <- 3` on a full buffer → `chansend` → `gopark` (proc.go). The sender is "stopped" but `NumGoroutine()` still counts it.
- Each `<-ch` → `chanrecv` → `goready` on the parked sender.

The runtime is invisible, but its fingerprints are everywhere.

---

## 13. Cross-link to 14-01

Topic **`14-runtime-and-internals/01-runtime-source-dive`** covers:
- The full GMP model in detail.
- The scheduler loop (`schedule`, `findRunnable`).
- The allocator (`mallocgc`).
- The GC's tri-color mark-and-sweep.

If 14-01 was "what is the runtime?", this topic is "how do I *read* the runtime?". Treat them as a pair — 14-01 gives the system view, 15-03 gives the reading technique.

---

## 14. Summary

`runtime` is the trickiest stdlib package because it uses hidden helpers, compiler intrinsics, assembly trampolines, and a restricted Go dialect. The way to read it as a *learner* is to (1) accept you won't understand every line, (2) start with self-contained files — `chan.go` and `panic.go` are the best teaching texts, (3) treat `runtime2.go` as your dictionary of types, (4) verify your reading with tests, `dlv`, and `go tool objdump`. The source is the canonical specification of how goroutines, channels, and defer actually behave — when documentation and source disagree, source wins. Pair this topic with 14-01 for the full picture: 14-01 explains the system, 15-03 teaches the reading technique.

---

## Further reading
- Topic **`14-runtime-and-internals/01-runtime-source-dive`** — the system-level dive
- Topic **`15-go-source-reading/01-net-http-source`** — the source-reading technique applied to `net/http`
- Topic **`15-go-source-reading/02-sync-source`** — the same applied to `sync`
- Go source: `https://github.com/golang/go/tree/master/src/runtime` (pin to a tagged release)
- `chan.go` walkthrough: Kavya Joshi, "Understanding Channels" — GopherCon 2017 talk
- `panic.go` walkthrough: Dave Cheney, "Eliminate error handling by eliminating errors" + the defer cost posts
- `go tool objdump` docs: `https://pkg.go.dev/cmd/objdump`
- Delve docs: `https://github.com/go-delve/delve/tree/master/Documentation`
