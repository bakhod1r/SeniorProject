# Goroutine Preemption — Junior Level

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
> Focus: "Who decides when my goroutine stops running, and why did my program hang before Go 1.14?"

**Preemption** is the act of taking the CPU away from a running goroutine so another goroutine — or the garbage collector, or the scheduler — can run. Without preemption, a goroutine that starts a long computation will hold a CPU core until it decides to give it up. With preemption, the runtime can step in and rotate the CPU among many goroutines fairly.

Two facts you will repeat to yourself many times in this file:

1. Until Go 1.14, preemption was **cooperative**. The goroutine had to "agree" — by making a function call — for the scheduler to take its CPU. A tight loop with no function calls could not be preempted.
2. From Go 1.14 onward, preemption is **asynchronous**. The runtime can interrupt a goroutine at almost any instruction by sending a signal to the OS thread it runs on.

You will hear engineers say "Go is cooperatively scheduled." That was true before 1.14 and is now an oversimplification. Today, Go uses **both** mechanisms. The cooperative one still exists; the asynchronous one was added on top.

After this file you will:

- Understand the difference between cooperative and asynchronous preemption.
- Know why the canonical example `for {}` hanged programs before Go 1.14.
- Be able to use `runtime.Gosched()` and `runtime.Goexit()`.
- Recognise the symptom of preemption-disabled code (GC stalls, scheduler latency).
- Know what `GODEBUG=asyncpreemptoff=1` does and when to avoid it.
- Have a feel for why proposal 24543 (Austin Clements) changed Go.

You do not yet need to read assembly trampolines, follow the signal handler step by step, or know what a safe-point is. Those come at senior and professional levels.

---

## Prerequisites

- **Required:** Comfort with goroutines and the `go` keyword. You should have written a few programs that spawn and join goroutines.
- **Required:** A Go installation, 1.18 or newer. The async preemption mechanism this file describes ships in 1.14 and later.
- **Required:** Awareness of the GMP scheduler (G = goroutine, M = OS thread, P = logical processor). If you have not read [01-gmp-model](../01-gmp-model/), do that first.
- **Helpful:** Some familiarity with operating system signals. You do not need to know the full API; just the idea that the kernel can deliver an asynchronous interrupt to a thread.
- **Helpful:** Awareness that Go's garbage collector occasionally has to pause all goroutines (a "stop the world" pause). Preemption is what makes that pause possible.

If you can write a goroutine that runs a long loop and wonder out loud "why isn't the main goroutine getting any CPU time," you are exactly in the right place.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Preemption** | The act of the runtime taking the CPU away from a running goroutine without that goroutine's explicit consent. The opposite of cooperative scheduling. |
| **Cooperative preemption** | Pre-Go-1.14 mechanism. The compiler inserts a check at the start of each function: "Should I yield?" A goroutine that never makes a function call cannot be preempted. |
| **Asynchronous preemption** | Go-1.14+ mechanism. The runtime sends a signal (`SIGURG` on Unix) to the OS thread; the signal handler arranges for the goroutine to land in a small piece of code that yields. |
| **Function prologue** | The first few instructions of every Go function. The compiler inserts a stack-bound check here, which doubles as the preemption check. |
| **`g.preempt`** | A boolean field on the runtime's `g` struct. When set, the next stack-bound check will yield to the scheduler. |
| **`g.stackguard0`** | The stack-bound the prologue compares against. The runtime sets it to a magic poison value (`stackPreempt`) to force a "fake overflow" and trigger preemption. |
| **`runtime.Gosched()`** | Explicit yield. The current goroutine voluntarily steps off the P and joins the back of the run queue. |
| **`runtime.Goexit()`** | Terminate the calling goroutine. Deferred functions still run. The program does **not** exit; only this goroutine does. |
| **Safe-point** | A place in machine code where the runtime knows it can safely stop the goroutine — stack types are known, pointers are visible to the GC, no half-finished write barrier. |
| **Sysmon** | A special goroutine, not bound to any P, that runs background bookkeeping. It detects long-running goroutines and triggers preemption. |
| **`SIGURG`** | The Unix signal Go's runtime repurposes for async preemption. Chosen because no standard Unix tool uses it for anything important. |
| **`asyncPreempt`** | A tiny assembly stub the signal handler arranges for the goroutine to "return into." It saves registers, calls into the Go scheduler, and continues. |
| **STW (Stop the World)** | A garbage-collection phase that requires every goroutine to pause. Without preemption, STW could not start in bounded time. |
| **Proposal 24543** | The 2018 design document by Austin Clements that introduced non-cooperative loop preemption to Go. |

---

## Core Concepts

### Preemption is just "fairness for CPU time"

When you run `go f()`, the runtime puts `f` on a run queue. The runtime has a small fixed number of OS threads (one per `GOMAXPROCS`) and rotates goroutines through them. The question this file answers is: **how does a goroutine come off the CPU so the next one can go on?**

There are three ways a goroutine yields:

1. **It blocks.** It calls a channel operation that has no partner, takes a mutex that is held, sleeps, performs a syscall that blocks, etc. The runtime parks it.
2. **It voluntarily yields.** It calls `runtime.Gosched()`. Rare in user code; common inside the runtime.
3. **It is preempted.** Some external force — the scheduler, the GC, the timer — wants the CPU back.

This file is about case (3).

### Cooperative preemption — the prologue check

Before Go 1.14, the compiler emitted, at the start of every Go function, two extra instructions. The simplified pseudo-code is:

```
function prologue:
    if SP <= g.stackguard0:
        call morestack
    ... normal function body ...
```

`stackguard0` normally holds the address near the bottom of the goroutine's stack. The check exists primarily to detect a stack overflow and call `morestack`, which grows the stack.

Cooperative preemption hijacks this check. To preempt a goroutine, the runtime sets:

```
g.stackguard0 = stackPreempt  // a magic poison value
```

The next prologue check sees `SP <= stackguard0` (because the poison value is enormous), falls into `morestack`, which discovers `g.preempt == true` and calls `gopreempt_m`. That puts the goroutine on the global run queue and runs the scheduler.

This is elegant: no new instruction is needed, only repurposing the existing prologue check. But it has one terrible limitation.

### The pre-1.14 limitation: tight loops

If a goroutine runs a loop that contains **no function calls**, the prologue check never executes. The runtime sets `stackguard0 = stackPreempt`, and absolutely nothing happens. The goroutine runs forever, the GC waits forever for everyone to reach a safe-point, and the program freezes.

The canonical demonstration:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1)
    go func() {
        for {}                // <-- no function calls
    }()
    runtime.Gosched()         // let the goroutine start
    fmt.Println("never prints on Go < 1.14")
}
```

On Go 1.13 with `GOMAXPROCS=1`, this program hangs forever. The `for {}` goroutine grabs the single P and never yields. On Go 1.14+, the same program prints "never prints..." because async preemption kicks in after ~10 ms.

### Asynchronous preemption — the signal trick

Go 1.14 added a second mechanism. A background goroutine called `sysmon` ("system monitor") runs roughly every 10 ms and inspects every P. If a P has had the same goroutine running for more than 10 ms, sysmon decides to preempt it.

The runtime cannot just "modify the goroutine's PC" directly — the goroutine is running on a different thread. What it can do is send a signal to that thread:

```
preemptM(mp) → tgkill(mp.procid, mp.procid, SIGURG)
```

On Linux, `tgkill` is a syscall that delivers a signal to a specific thread of a specific process. The kernel interrupts whatever the thread was doing, saves its registers, and runs the signal handler.

Go's signal handler examines the saved register file and decides: "Is it safe to preempt here?" If yes, it **rewrites the saved PC** so that when the kernel resumes the thread, the thread does not return to where it was — it returns into a tiny piece of assembly called `asyncPreempt`. That stub saves registers, calls into the scheduler, and the goroutine ends up back on the run queue like any other.

This works even inside a `for {}`. There are no function calls, but the kernel still delivers signals to the thread.

### Why `SIGURG`?

The Go runtime repurposes the signal `SIGURG`. Most Unix programs do not use this signal — it is intended for out-of-band data on sockets, but `SO_OOBINLINE` makes it largely irrelevant. By picking a signal that almost nothing else uses, the runtime avoids fighting with the application's own signal handlers.

You can still use `SIGURG` in your own code if you really need to; the runtime cooperates with `os/signal` to route it. But normally you do not touch it and you do not even know it is there.

---

## Real-World Analogies

### Cooperative preemption = polite turn-taking

Imagine four people sharing one whiteboard in a meeting. Whoever is at the board gets to draw. The agreement is: "After every sentence you write, look up and check whether someone is waiting." That works as long as everyone writes short sentences. If one person decides to write a 20-minute essay without looking up, the others wait. **That is pre-1.14 Go.**

### Async preemption = the meeting facilitator with a stopwatch

Now add a facilitator who watches the clock and, after 10 minutes, taps the speaker on the shoulder regardless of whether they wanted to stop. The speaker hands over the marker mid-sentence. **That is Go 1.14+.**

### The signal-based mechanism = a remote pause button

Cooperative preemption requires the runtime and the goroutine to be in the same conversation — the prologue check is a question the goroutine asks itself. Async preemption is a remote pause button: the runtime presses it, the kernel delivers the press, the goroutine cannot ignore it.

### Safe-points = "only stop on the dotted lines"

Even with async preemption, the runtime cannot interrupt the goroutine *literally* anywhere. Half-finished pointer writes, partially established stack frames, write-barrier sequences — these are all "not on the dotted line." Think of road traffic: cars can stop at any traffic light, but not in the middle of an intersection.

---

## Mental Models

### Model 1: Two preemption paths, one runtime

When you read the runtime source, the two mechanisms appear side by side. `preemptone(p)`, in `runtime/proc.go`, attempts both:

1. Set `g.preempt = true` and `g.stackguard0 = stackPreempt`. This is the cooperative path. If the goroutine reaches its next prologue, it will yield.
2. Call `preemptM(mp)`. This is the async path. It sends `SIGURG` and arranges for the trampoline.

Both paths are tried simultaneously. Whichever fires first wins.

### Model 2: Preemption is what makes GC bounded

If a goroutine could refuse to yield forever, the garbage collector could never start a stop-the-world phase. The whole goroutine population must reach a known state — a safe-point — for the GC's marking and sweeping to work. Preemption is the mechanism that **forces** them there.

This is the reason the change was urgent: not "fairness for goroutines" — programs rarely starved each other in practice — but **bounded GC pause time**.

### Model 3: The sysmon-tick-signal pipeline

A complete picture of a typical async preemption:

```
Time 0: goroutine G starts on P.
Time 10ms: sysmon wakes, scans P, sees G has been running.
            sysmon calls preemptone(p).
Time 10ms+ε: preemptM(mp) calls tgkill(SIGURG).
Time ~10ms+ε: kernel delivers SIGURG to thread M.
              signal handler runs, rewrites saved PC → asyncPreempt.
Time ~10ms+ε: kernel returns; thread executes asyncPreempt.
              asyncPreempt saves registers, calls scheduler.
              G is now back on the run queue.
              schedule() picks next G.
```

The whole sequence finishes in microseconds. The 10 ms is the *detection* delay.

---

## Pros & Cons

### Pros of async preemption

- **Bounded GC pause time.** No tight loop can hold STW open.
- **Fairness for goroutines.** A misbehaving goroutine cannot starve siblings.
- **Programmer simplicity.** You can write any code you like; the runtime will rotate it.
- **No source-level changes.** Existing code becomes preemptible without modification.

### Cons of async preemption

- **Cost per signal.** Sending and handling `SIGURG` is not free. On a busy system this can add up.
- **Surprising for signal-aware code.** Programs that install their own signal handlers must cooperate with the runtime.
- **Cgo limitations.** The runtime cannot preempt a goroutine that has crossed into C code.
- **Debugger friction.** Older debuggers do not handle `SIGURG` cleanly. `dlv` learned to.
- **Increased ABI sensitivity.** The async path saves a full register set; new architectures need a per-arch trampoline.

### Why cooperative preemption is still around

It is **cheaper**. When a function call happens, the prologue check is one extra compare-and-branch. No signal, no kernel transition. If a goroutine naturally calls a function within 10 ms, cooperative preemption fires first and async never runs. Most real programs are like this.

---

## Use Cases

You almost never *invoke* preemption in user code. You **rely on it**. Below are the cases where you should be aware of it.

### Long CPU-bound computations

Image processing, scientific simulation, regex matching on huge strings, JSON decoding of multi-megabyte payloads. All of these spend long stretches inside a single function. On Go 1.14+, sysmon will preempt them. On Go 1.13 and earlier, they would hold the P until they returned.

### Implementing your own runtime-like loops

If you write a "polling worker" that spins waiting for work, you should periodically call `runtime.Gosched()`. Not because async preemption fails (it does not), but because explicit yields are cheaper than waiting for the 10 ms sysmon tick.

### Honoring context cancellation

A correctly written long-running goroutine checks `ctx.Done()` periodically. That check is itself a function call, which doubles as a preemption point even in pre-1.14 Go.

```go
for {
    select {
    case <-ctx.Done():
        return
    default:
    }
    // ... do a unit of work ...
}
```

The `select` is the preemption point. The `default` keeps it non-blocking.

---

## Code Examples

### Example 1: The pre-1.14 hang (now harmless)

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)

    go func() {
        for {
            // tight loop, no function calls
        }
    }()

    time.Sleep(100 * time.Millisecond)
    fmt.Println("the main goroutine is alive")
    // On Go 1.14+, this prints fine.
    // On Go 1.13 with GOMAXPROCS=1, this would never print.
}
```

Run with `go version` first to confirm you are on 1.14+. The program will print and exit.

### Example 2: Explicit yield with `runtime.Gosched`

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)

    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        for i := 0; i < 3; i++ {
            fmt.Println("A", i)
            runtime.Gosched()
        }
    }()

    go func() {
        defer wg.Done()
        for i := 0; i < 3; i++ {
            fmt.Println("B", i)
            runtime.Gosched()
        }
    }()

    wg.Wait()
}
```

Output will interleave A and B because each goroutine yields after every print.

### Example 3: `runtime.Goexit` terminates the goroutine

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        defer fmt.Println("deferred runs")

        fmt.Println("before Goexit")
        runtime.Goexit()
        fmt.Println("after Goexit (never prints)")
    }()

    wg.Wait()
    fmt.Println("main continues normally")
}
```

Output:
```
before Goexit
deferred runs
main continues normally
```

Notice that `Goexit` does **not** kill the program. The deferred `wg.Done` runs. The main goroutine carries on.

### Example 4: Watching `GODEBUG=asyncpreemptoff=1`

```bash
GODEBUG=asyncpreemptoff=1 go run main.go
```

This disables async preemption. Run the program from Example 1 with this flag on Go 1.14+ and `GOMAXPROCS=1`. It will hang again, just like Go 1.13.

**Do not** set this in production. It is a debugging tool.

### Example 5: Detecting preemption with a hot counter

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)

    var n int64
    go func() {
        for {
            atomic.AddInt64(&n, 1)
        }
    }()

    for i := 0; i < 5; i++ {
        time.Sleep(time.Second)
        fmt.Println("iterations:", atomic.LoadInt64(&n))
    }
}
```

The main goroutine runs because async preemption rotates the spinner off its P every ~10 ms. Without preemption, the main goroutine could not print after the first iteration.

---

## Coding Patterns

### Pattern: defensive `select` with `default`

Use this when a loop's body is CPU-bound and you want to cooperate with cancellation:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    // CPU-heavy work
}
```

The `select` block also counts as a function call (it goes through runtime helpers), so it doubles as a cooperative preemption point.

### Pattern: chunked work with explicit yield

```go
for i := 0; i < len(huge); i += chunk {
    end := i + chunk
    if end > len(huge) {
        end = len(huge)
    }
    process(huge[i:end])
    runtime.Gosched()       // give the scheduler a turn
}
```

This pattern was important pre-1.14. On Go 1.14+ it is mostly redundant, but it makes the intent visible.

### Pattern: never disable async preemption

```go
// Wrong, unless you are debugging the runtime itself
os.Setenv("GODEBUG", "asyncpreemptoff=1")
```

If you reach for this, something else is broken. Find that instead.

---

## Clean Code

- **Do not call `runtime.Gosched()` "to give other goroutines a chance."** That was a 2013 reflex. The runtime preempts you automatically. Calling Gosched in modern code is usually noise.
- **Do not catch `SIGURG`** unless you know how to forward it back to the runtime. Use `os/signal.Notify` carefully and never call `signal.Stop` on `SIGURG` directly.
- **Keep loops short or make them call functions.** A simple way to be friendly to preemption is to avoid 100% inline-only hot loops. Even a small bounds-checked function call gives the prologue a chance.
- **Never rely on goroutine ordering.** Preemption can rearrange execution at any safe-point. Your code must not assume "this runs before that."
- **Trust the scheduler by default.** If you find yourself reaching for Gosched, ask whether a channel or condition variable is the real answer.

---

## Product Use / Feature

When you build a feature that processes user data — a CSV importer, an image thumbnail batch job, a search indexer — preemption is what keeps your service responsive while that feature runs. If the importer were a pre-1.14 tight loop, your HTTP handlers would queue up, your health check would fail, and your load balancer would mark the instance unhealthy.

Async preemption is invisible plumbing that lets product engineers write straight-line code without worrying about cooperation. You inherit that benefit just by being on Go 1.14+.

---

## Error Handling

Preemption itself is silent — there is no `error` to handle. But there are situations where you might *want* to fail loudly if preemption is disabled:

- A long-running batch job whose SLO depends on responsiveness.
- A service that must shut down within a deadline (graceful drain).
- A tool that runs untrusted user-supplied loops (a scripting host).

For these you can include a startup assertion:

```go
import "os"

func init() {
    if os.Getenv("GODEBUG") != "" && strings.Contains(os.Getenv("GODEBUG"), "asyncpreemptoff=1") {
        log.Fatal("async preemption must be enabled for this service")
    }
}
```

This is rare, but it documents the assumption.

---

## Security Considerations

Async preemption uses signals. Signals are an OS-level mechanism. A few security-adjacent notes:

- **Signal masking.** A program that masks `SIGURG` globally breaks Go's preemption. Avoid `sigprocmask`/`pthread_sigmask` for `SIGURG` unless you really know what you are doing.
- **Cgo callbacks.** Code running inside C cannot be preempted. A malicious or buggy C library that spins forever will hang a Go thread.
- **Embedded Go runtimes.** If you embed Go via cgo into another runtime that already uses `SIGURG`, you must resolve the conflict (usually by picking a different repurposed signal at build time, though this is non-standard).
- **Sandboxes.** Some Linux sandboxes (seccomp filters, gVisor) block `tgkill`. Without it, async preemption falls back to cooperative.

---

## Performance Tips

- **A function call is cheap; don't fear it.** A small helper inside your hot loop costs single-digit nanoseconds and gives the prologue check a place to fire.
- **Stagger long jobs.** If two long-running goroutines share a P, sysmon will preempt them in turn — a context switch every 10 ms. Letting them run on separate Ps avoids that overhead.
- **Watch tail latency, not average.** Async preemption affects p99 and p999 latencies, not the mean. Use histograms.
- **Profile with `pprof`.** If `pprof` shows time inside `asyncPreempt`, that is the cost of preemption itself, which is usually fine but bounded.

---

## Best Practices

1. **Stay on a recent Go.** 1.14 introduced async preemption; subsequent releases improved it (especially 1.17 ABI changes). Use 1.21+ where possible.
2. **Do not disable async preemption in production.** `GODEBUG=asyncpreemptoff=1` is for debugging only.
3. **Honor `context.Context`.** Cancellation checks coexist beautifully with preemption.
4. **Avoid huge cgo calls.** If you must, chunk the work so control returns to Go regularly.
5. **Avoid spinning waits.** Use channels or `sync.Cond`. If you must spin, throttle with `runtime.Gosched()`.
6. **Don't install handlers for `SIGURG`.** Let the runtime own it.
7. **Test with `GOMAXPROCS=1`.** Single-P configurations expose preemption issues fastest.

---

## Edge Cases & Pitfalls

### A `for {}` with no body

Yes, this is preemptible on Go 1.14+. The compiler does *not* optimise it into something un-preemptible. The signal still hits the thread.

### A spin lock written in assembly

If you write an assembly function that loops without ever returning to Go, async preemption may still hit it — depending on the safe-point. But because you bypassed the compiler, you may have skipped any cooperative checkpoints. Be careful.

### `runtime.LockOSThread`

A goroutine locked to a thread *can* still be preempted. The lock affects which OS thread the goroutine runs on, not whether it can yield.

### Cgo calls

A goroutine in cgo holds an M but not a P. Async preemption does not reach into C code. The goroutine will be preempted on return.

### Signal handlers your program installs

If you install a handler for any signal and it never returns (or runs for a long time), it can delay preemption on that thread. Keep signal handlers short.

### `runtime.Goexit` from `main`

Calling `runtime.Goexit()` from the main goroutine terminates the main goroutine, which makes the program panic with "no goroutines" because no goroutines remain. Use it in worker goroutines, not main.

---

## Common Mistakes

### Mistake 1: "Gosched yields the CPU to the OS"

No. `runtime.Gosched` yields to the **Go scheduler**, not the kernel. The current goroutine moves to the back of the run queue; the next Go goroutine takes the P. The OS thread keeps running.

### Mistake 2: "I need Gosched in every loop"

Almost never. Async preemption handles it. Gosched is a hint, not a requirement. Use it only when you genuinely want to deprioritise the current goroutine.

### Mistake 3: "Goexit kills the program"

No. It kills the calling goroutine and runs its deferred functions. Other goroutines are unaffected. The program exits only when the main goroutine returns or panics.

### Mistake 4: "Go is cooperatively scheduled"

Half-true. Go has cooperative preemption (the prologue check) and asynchronous preemption (the signal). Saying "cooperative" alone is outdated since 2020.

### Mistake 5: "GOMAXPROCS=1 means no concurrency"

`GOMAXPROCS=1` means one P, so at most one goroutine runs at a time. But preemption still rotates the P among many goroutines, giving concurrency without parallelism.

---

## Common Misconceptions

- **"Preemption costs the same as a context switch."** No. A Go preemption is a register save plus a scheduler tick, all in user space. An OS context switch is much more expensive.
- **"The runtime preempts on every system call."** Syscalls are different: the goroutine voluntarily enters `entersyscall` and may be detached from its P. That is syscall handling, not preemption (see [05-syscall-handling](../05-syscall-handling/)).
- **"`SIGURG` is the only signal Go uses."** No. The runtime uses several signals (`SIGTERM`, `SIGINT`, `SIGSEGV`, etc.). `SIGURG` is the one specifically for async preemption.
- **"Disabling preemption makes the program faster."** It does eliminate signal overhead, but it also re-introduces unbounded latency tails. Net loss in real workloads.
- **"Loops with `range` are not preemptible."** Range loops compile to ordinary loops; preemption rules are the same. On Go 1.14+ they are preempted asynchronously.

---

## Tricky Points

### "Why is `for {}` not optimised away?"

In a single-goroutine context, the Go compiler could in principle prove that an empty loop is dead code. But in a concurrent context, the loop might be holding a goroutine alive for synchronisation (waiting for a flag, for example). The compiler conservatively keeps it. Even if it were optimised away, the *test* of preemption is still the loop's body being un-callable, which is a runtime concept.

### "Why 10 ms?"

The sysmon tick is approximately 10 ms because that is the Go scheduler's notion of "long enough that one goroutine has had its fair share." It is not configurable from user code. The constant is `forcePreemptNS = 10 * 1000 * 1000` (10 ms) in `runtime/proc.go`.

### "Why `SIGURG` instead of `SIGUSR1`?"

`SIGUSR1` and `SIGUSR2` are typically reserved for user applications. Many libraries and frameworks already use them. `SIGURG` is essentially unused in modern Unix programming, so the runtime can claim it without conflicts.

### "Does Windows have async preemption?"

Yes, but the mechanism is different. There are no Unix signals. Instead, the runtime suspends the thread via `SuspendThread`, modifies its context with `SetThreadContext`, and resumes it. The effect is the same.

### "Can a panic happen during preemption?"

No, because the runtime constructs the resume path carefully. The PC rewrite always lands in `asyncPreempt`, which has well-defined behaviour. If the goroutine was inside an unsafe sequence (write barrier, atomic), the signal handler simply declines to preempt and returns normally; sysmon will retry next tick.

---

## Test

A simple test that exercises preemption:

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    var hot, cold int64

    go func() {
        for {
            atomic.AddInt64(&hot, 1)   // hot loop
        }
    }()

    go func() {
        for {
            atomic.AddInt64(&cold, 1)
            time.Sleep(time.Millisecond) // cold loop
        }
    }()

    time.Sleep(2 * time.Second)
    fmt.Printf("hot=%d cold=%d\n", atomic.LoadInt64(&hot), atomic.LoadInt64(&cold))
}
```

If preemption works, both counters increment. If it did not, only `hot` would.

Run with `GODEBUG=asyncpreemptoff=1` to confirm the cold loop counter falls (or hangs, depending on which goroutine got the P first).

---

## Tricky Questions

1. **Why do programs hang less often on Go 1.14+ than on 1.13?** Because async preemption interrupts goroutines that lack cooperative checkpoints.
2. **Does `runtime.Gosched` cause a syscall?** No. It runs entirely in user space.
3. **Does `runtime.Goexit` invoke deferred functions?** Yes.
4. **Why is `SIGURG` chosen?** Because it is unused in modern Unix programming.
5. **What happens if I block `SIGURG`?** Async preemption breaks; you fall back to cooperative only.
6. **Can a cgo call be preempted?** No, not while it is inside C code.
7. **What does `GODEBUG=asyncpreemptoff=1` do?** It disables async preemption (signals).
8. **What is `stackPreempt`?** A magic value the runtime stores in `g.stackguard0` to force the prologue check to fire.
9. **Who is sysmon?** A background goroutine that scans Ps and triggers preemption.
10. **What is `asyncPreempt`?** A small assembly stub the signal handler arranges as the resume PC.

---

## Cheat Sheet

```
WHAT          | WHO TRIGGERS IT       | WHEN               | OBSERVABLE EFFECT
--------------|-----------------------|--------------------|---------------------------
Cooperative   | Compiler + scheduler  | At function prologue| Goroutine yields
Async         | sysmon + signal       | Every ~10 ms        | Goroutine interrupted
Gosched       | User code             | Explicit            | Goroutine yields voluntarily
Goexit        | User code             | Explicit            | Goroutine terminates (defers run)
GC preemption | GC + scheduler        | At STW start        | All goroutines parked
```

| Tool | When to use |
|---|---|
| `runtime.Gosched()` | Cooperative hint; rarely needed |
| `runtime.Goexit()` | Exit current goroutine, run defers |
| `GODEBUG=asyncpreemptoff=1` | Debugging only — do not ship |
| `GODEBUG=schedtrace=1000` | See scheduler activity in stderr |
| `runtime.NumGoroutine()` | Detect goroutine leaks |

---

## Self-Assessment Checklist

- [ ] I can explain the difference between cooperative and asynchronous preemption.
- [ ] I know why `for {}` hung Go 1.13 programs and does not hang Go 1.14+.
- [ ] I have used `runtime.Gosched` and `runtime.Goexit` in a small program.
- [ ] I have observed the effect of `GODEBUG=asyncpreemptoff=1`.
- [ ] I can name the signal used for async preemption (`SIGURG`).
- [ ] I understand sysmon's role.
- [ ] I can sketch the sequence: sysmon → preemptM → tgkill → signal handler → asyncPreempt.
- [ ] I know preemption is what makes bounded GC pauses possible.
- [ ] I avoid disabling async preemption in production.
- [ ] I do not install handlers for `SIGURG`.

---

## Summary

Preemption is how the Go runtime takes the CPU back from a running goroutine. Before Go 1.14, preemption was cooperative: the compiler inserted a stack-bound check at every function prologue, and a tight loop without function calls could never be preempted. Go 1.14 added asynchronous preemption: the sysmon background goroutine notices long-running goroutines, sends `SIGURG` to the OS thread, and the signal handler arranges for the goroutine to land in the `asyncPreempt` stub. Both mechanisms still exist; the runtime tries both at once and whichever fires first wins. Preemption is the mechanism that makes bounded GC pause time possible — without it, a single tight loop could hang the world. Use the explicit yields `runtime.Gosched` and `runtime.Goexit` when you really mean "step back" or "terminate," but never disable async preemption in production code.

---

## What You Can Build

- A tiny demo that hangs on Go 1.13 (or with `asyncpreemptoff=1`) and runs fine otherwise.
- A latency measurement tool that compares wall-clock time between a hot CPU loop and a sleeping goroutine, showing preemption granularity.
- A "fair scheduler" benchmark: spawn N CPU-bound goroutines and measure how evenly they progress.
- A small profiler that samples `runtime.NumGoroutine` and reports goroutine churn.

---

## Further Reading

- Go proposal **#24543** — *Non-cooperative goroutine preemption*, Austin Clements. Read the design and the discussion thread.
- Go release notes for **1.14**.
- `src/runtime/preempt.go` — the implementation. Short, readable.
- `src/runtime/signal_unix.go` — the signal handler that arranges async preemption.
- Dave Cheney, *"Five things that make Go fast"* — broader context on the runtime.
- Austin Clements' GopherCon 2019 talk on the GC and preemption.

---

## Related Topics

- [01-gmp-model](../01-gmp-model/) — the scheduler architecture preemption operates on.
- [05-syscall-handling](../05-syscall-handling/) — the other way goroutines come off a P.
- [04-work-stealing](../04-work-stealing/) — what the scheduler does after preemption.
- [GC fundamentals](../../11-gc/) — the consumer of safe-points and STW.
- [Signals in os/signal](https://pkg.go.dev/os/signal) — the API your program shares with the runtime.

---

## Diagrams & Visual Aids

```
Cooperative preemption:
   goroutine -- runs -- prologue check -- runs -- prologue check -- ...
                              |
                              v
                  stackguard0 == stackPreempt?
                              |
                           yes -> morestack -> gopreempt_m -> schedule()

Async preemption:
   sysmon (every 10 ms): for each P: if G has run > 10ms, preempt
                              |
                              v
                       preemptM(mp) -> tgkill(tid, SIGURG)
                              |
                              v
                       kernel delivers SIGURG to thread M
                              |
                              v
                       signal handler examines saved PC
                              |
                              v
                       rewrites saved PC -> asyncPreempt
                              |
                              v
                       kernel resumes thread -> asyncPreempt runs
                              |
                              v
                       saves regs, calls schedule(), G is requeued
```

```
                Pre-1.14                            Go 1.14+
            +-----------------+                  +-----------------+
            | for { tight() } |  hangs!          | for { tight() } |  preempted
            +-----------------+                  +-----------------+
                                                          |
                                                          v
                                                     ~10 ms later
                                                     SIGURG arrives
```

```
asyncPreempt path (high level):
   user code  ----[SIGURG]---->  signal handler
                                       |
                                       v
                          rewrite saved RIP to asyncPreempt
                                       |
                                       v
                              kernel returns to userspace
                                       |
                                       v
                             asyncPreempt (assembly stub)
                                       |
                                       v
                              save full register state
                                       |
                                       v
                              call into runtime.gopreempt_m
                                       |
                                       v
                              schedule() picks next G
```
