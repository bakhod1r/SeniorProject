# Runtime Source Dive — Practice Tasks

Twenty-two exercises that drag you, line by line, into `$GOROOT/src/runtime`. The point is *not* to read about the scheduler — it's to open `proc.go`, find a specific symbol, follow a `CALL runtime.newproc` instruction, watch `findRunnable` pick its next victim, and come back able to point at the lines that did it. Difficulty: **J**unior, **M**iddle, **S**enior, **Staff**.

Each task gives a Goal, Difficulty, Skills, Setup, Steps, Acceptance criteria, folded Hints, and a folded Reference solution with working Go code (compiles on **go1.22+**). Read junior.md first — every task assumes you know what `proc.go`, `chan.go`, and `stack.go` are *for*, even if you haven't read them yet.

A note on versions: line numbers drift between Go releases. Pin your reading to one version (`go version` then `git -C $(go env GOROOT) log -1`) and quote that version when you record findings. "`schedule` is at proc.go:3742 in go1.22.3" is useful; "somewhere in proc.go" is not.

---

### Task 1: Locate `schedule` in proc.go

**Goal.** Open your local `runtime/proc.go`, find `func schedule(`, record the line number and trace the first three branches.

**Difficulty.** Junior

**Skills.** Reading source, using `grep` / editor jump-to-symbol, distinguishing exported vs unexported runtime entry points.

**Setup / starter code.**

```bash
cd "$(go env GOROOT)/src/runtime"
go version
grep -n "^func schedule(" proc.go
```

**Steps.**

1. Print your Go version. Record it.
2. Find `func schedule(` (no receiver, no arguments). Note the line number.
3. Find the *callers* of `schedule` — search for `schedule()` calls inside the same file.
4. Read the first 80 lines of the function. Identify the first three top-level branches (`if ... { ... }`).
5. Write a 10-line note in your own words.

**Acceptance criteria.**

- File path, line number, and Go version recorded.
- Three callers named (e.g., `mstart1`, `goexit0`, `park_m`).
- Three branches paraphrased — not copy-pasted.
- You can answer: "what is `_g_` at the top of `schedule`?"

<details><summary>Hints</summary>

- `grep -n` is faster than scrolling. Use `grep -rn "schedule(" proc.go` to see calls too.
- `_g_ := getg()` returns the *current* goroutine pointer — the goroutine doing the scheduling, *not* the one about to run. That distinction confuses everyone once.
- `top:` is a label `goto`s jump back to when a candidate is rejected (e.g., locked to another M).

</details>

<details><summary>Reference solution</summary>

A representative writeup (go1.22.3, line numbers will differ on your machine):

```
schedule() — proc.go:3742 (go1.22.3)

CALLERS (same file):
  mstart1()  proc.go:1626  — new M startup
  goexit0()  proc.go:3893  — G returns from its top-level function
  park_m()   proc.go:3963  — running G voluntarily parks

FIRST THREE BRANCHES:
  1. if mp.locks != 0 { throw("schedule: holding locks") }
     Sanity check. Scheduler runs on g0; mustn't hold any runtime lock.
  2. if mp.lockedg != 0 { ... execute(mp.lockedg.ptr(), false) }
     If this M is locked to a specific G (LockOSThread, cgo callback),
     skip scheduling — that G is the only one that may run here.
  3. if sched.gcwaiting.Load() != 0 { gcstopm(); goto top }
     If GC STW is in progress, park this M and retry from `top:`.

WHAT IS _g_ / mp?
  _g_ := getg()   inside schedule, always g0 (the scheduler stack).
  mp  := _g_.m    the OS thread structure for this scheduler.
```

Key idea: `schedule` is not "the scheduler runs my goroutine". It's "find the next victim, then `execute` it". Picking happens here; running happens in `execute`.

</details>

**Extension.** Find `execute(` in the same file. What does its second argument (`inheritTime bool`) control?

---

### Task 2: Print a runtime snapshot

**Goal.** Build a small `Snapshot()` helper that prints goroutine count, GOMAXPROCS, live heap, and total allocations. Verify it sees goroutines you create.

**Difficulty.** Junior

**Skills.** `runtime.NumGoroutine`, `runtime.GOMAXPROCS`, `runtime.ReadMemStats`, formatting bytes.

**Setup / starter code.**

```go
package main

import (
    "fmt"
    "runtime"
)

// TODO: implement Snapshot. Should NOT take a snapshot of itself in a
// way that perturbs results (no big slice allocs inside Snapshot).
func Snapshot() string { return "" }

func main() {
    fmt.Println(Snapshot())
}
```

**Steps.**

1. Read the godoc of `runtime.MemStats` — fields `Alloc`, `TotalAlloc`, `HeapInuse`, `NumGC`.
2. Write `Snapshot()` so it returns a single `string`. Use `fmt.Sprintf` with no fancy formatting.
3. In `main`, print one snapshot, spawn 10000 goroutines that each `<-make(chan int)` (park forever), `time.Sleep(50*time.Millisecond)`, print again. Compare.
4. Compare `Alloc` before and after the goroutine burst. Compute the per-goroutine cost.

**Acceptance criteria.**

- Snapshot output includes: goroutine count, GOMAXPROCS, HeapInuse, NumGC.
- After spawning 10000 parked goroutines, `NumGoroutine` is ≥ 10001 (including main).
- You can name one source file in `runtime/` where `ReadMemStats` is defined (`mstats.go`).
- Per-goroutine cost estimate: a number (e.g., "~2.5 KB per parked G").

<details><summary>Hints</summary>

- `runtime.ReadMemStats` stops the world briefly. Don't call it in a hot loop.
- A parked-on-receive goroutine holds only its stack (initial 2 KB) plus the `g` struct (~360 bytes on amd64). Expect ~2.5 KB net.
- Use `runtime.GC()` before reading MemStats if you want fewer transient allocations skewing the count.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func Snapshot() string {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return fmt.Sprintf(
        "goroutines=%d gomaxprocs=%d heapInuse=%s alloc=%s totalAlloc=%s numGC=%d",
        runtime.NumGoroutine(),
        runtime.GOMAXPROCS(0),
        humanBytes(m.HeapInuse),
        humanBytes(m.Alloc),
        humanBytes(m.TotalAlloc),
        m.NumGC,
    )
}

func humanBytes(b uint64) string {
    const unit = 1024
    if b < unit {
        return fmt.Sprintf("%d B", b)
    }
    div, exp := uint64(unit), 0
    for n := b / unit; n >= unit; n /= unit {
        div *= unit
        exp++
    }
    return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func main() {
    runtime.GC()
    before := Snapshot()
    fmt.Println("before:", before)

    const N = 10000
    blocker := make(chan struct{})
    for i := 0; i < N; i++ {
        go func() { <-blocker }()
    }
    time.Sleep(100 * time.Millisecond)
    runtime.GC()

    after := Snapshot()
    fmt.Println("after: ", after)

    // Don't actually close — we want them parked for the measurement.
    _ = blocker
}
```

Typical output on go1.22 amd64:

```
before: goroutines=1 gomaxprocs=12 heapInuse=3.4 MB alloc=200.4 KB totalAlloc=200.4 KB numGC=1
after:  goroutines=10001 gomaxprocs=12 heapInuse=27.8 MB alloc=24.6 MB totalAlloc=24.7 MB numGC=2
```

`(24.6 MB - 200 KB) / 10000 ≈ 2.5 KB / goroutine`. That's the famous "goroutines are cheap" number — empirically derived.

</details>

**Extension.** Add `m.StackInuse` and `m.StackSys`. Why is `StackInuse` typically much less than `HeapInuse` even with 10000 goroutines?

---

### Task 3: Five fields of `type g struct`

**Goal.** Open `runtime/runtime2.go`, find `type g struct`, list five fields you find interesting with one-sentence explanations each.

**Difficulty.** Junior

**Skills.** Reading struct definitions, distinguishing scheduler bookkeeping fields from stack bookkeeping fields.

**Setup.**

```bash
grep -n "^type g struct" "$(go env GOROOT)/src/runtime/runtime2.go"
```

**Steps.**

1. Open `runtime2.go`. Find the struct.
2. Read its 80+ fields. Pick five.
3. For each, write one sentence about *what the runtime uses it for*.

**Acceptance criteria.**

- Five field names with one-sentence explanations.
- At least one field about stack management (`stack`, `stackguard0`, `stktopsp`).
- At least one field about scheduler state (`atomicstatus`, `m`, `sched`).
- At least one field about parking/waiting (`waitsince`, `waitreason`, `parkingOnChan`).

<details><summary>Hints</summary>

- `atomicstatus` (`uint32`) — values like `_Gidle`, `_Grunnable`, `_Grunning`, `_Gwaiting`. Read the constants right above the struct.
- `stackguard0` is the *low-water mark* of the stack. The function prologue compares SP to this; if SP < stackguard0, call `morestack`.
- `m` is set when the goroutine is currently bound to an OS thread; cleared when it's runnable but not running.

</details>

<details><summary>Reference solution</summary>

Five fields of `type g struct` (go1.22.3):

```
1. stack stack
   stack.lo (bottom) and stack.hi (top) — the goroutine's stack range.
   Stack growth swaps this for a bigger region.

2. stackguard0 uintptr
   Low-water mark. Function prologue compares SP and calls
   morestack_noctxt if SP would dip below.

3. atomicstatus atomic.Uint32
   Lifecycle state: _Gidle, _Grunnable, _Grunning, _Gsyscall, _Gwaiting,
   _Gdead, _Gpreempted. Almost every scheduler decision CASes this.

4. m *m
   OS thread currently executing this G. nil when _Grunnable but not
   running. Set in execute, cleared in schedule.

5. waitreason waitReason
   When _Gwaiting, an enum value explaining WHY. Powers the
   "[chan receive]" annotation in panic stack traces.
```

Bonus: `sched gobuf` — stashes PC/SP/BP when the G is descheduled, so `gogo` can resume.

</details>

**Extension.** Find `type m struct` in the same file. Which field links an M to its current P?

---

### Task 4: One million parked goroutines

**Goal.** Spawn 1M goroutines that park on a channel receive. Use `pprof` to confirm. Estimate per-G memory. Cross-check the initial stack size against `runtime/stack.go`.

**Difficulty.** Middle

**Skills.** `pprof`, `runtime/stack.go` reading, memory math.

**Setup / starter code.**

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    blocker := make(chan struct{})
    for i := 0; i < 1_000_000; i++ {
        go func() { <-blocker }()
    }
    runtime.GC()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    println("HeapInuse:", m.HeapInuse, "StackInuse:", m.StackInuse, "Sys:", m.Sys)
    time.Sleep(time.Hour) // keep alive for pprof
}
```

**Steps.**

1. Run the program. Note `HeapInuse`, `StackInuse`, `Sys` after the burst.
2. While it's still running, in another terminal: `curl -s localhost:6060/debug/pprof/goroutine?debug=1 | head -50`.
3. Verify ~1M goroutines reported.
4. Open `$(go env GOROOT)/src/runtime/stack.go`. Find `_StackMin` (or `stackMin`). Record its value.
5. Compute predicted memory: `1_000_000 * (_StackMin + sizeof(g))`. Compare with `Sys`.

**Acceptance criteria.**

- Program runs without OOM at 1M goroutines.
- pprof confirms goroutine count.
- `_StackMin` value recorded from source (typically 2048 on most platforms).
- A two-line writeup: "predicted X MB, measured Y MB, delta because Z".

<details><summary>Hints</summary>

- 1M × 2 KB = 2 GB of stack alone. You need a 64-bit machine and at least 8 GB free; otherwise lower to 500_000.
- `runtime/stack.go` has a comment block explaining stack sizes. The constant you want is near the top.
- `m.StackInuse` counts goroutine stacks; `m.HeapInuse` does *not*. Don't add them when comparing to your prediction.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func main() {
    go func() { _ = http.ListenAndServe("localhost:6060", nil) }()
    const N = 1_000_000
    blocker := make(chan struct{})

    var before, after runtime.MemStats
    runtime.GC(); runtime.ReadMemStats(&before)

    for i := 0; i < N; i++ {
        go func() { <-blocker }()
    }
    time.Sleep(2 * time.Second)
    runtime.GC(); runtime.ReadMemStats(&after)

    fmt.Printf("goroutines: %d\n", runtime.NumGoroutine())
    fmt.Printf("StackInuse: %d MB (delta %+d MB)\n",
        after.StackInuse>>20, int64(after.StackInuse-before.StackInuse)>>20)
    fmt.Printf("HeapInuse:  %d MB (delta %+d MB)\n",
        after.HeapInuse>>20, int64(after.HeapInuse-before.HeapInuse)>>20)
    // From runtime/stack.go (go1.22): _StackMin = 2048
    fmt.Printf("predicted: ~%d MB stacks (1M * 2KB)\n", (N*2048)>>20)
    select {} // hold for pprof
}
```

Typical findings on go1.22 amd64:

```
goroutines:     1000001
HeapInuse:      ~420 MB     (heap holds the g structs and channel scaffolding)
StackInuse:     ~2050 MB    (1M × 2 KB initial stack, plus alignment)
Sys:            ~2700 MB    (system reservation)
predicted/G:    ~2400 bytes (2048 stack + ~360 g struct)
```

`StackInuse` ≈ `N * _StackMin`. The extra in `HeapInuse` is the `g` structs themselves (allocated in `mallocgc`) plus the `sudog` waiters parked on `blocker`. Source cross-check: `runtime/stack.go` line ~74 (in go1.22) has `_StackMin = 2048 // smallest by physical implementation`. Same file has the `MinStackSizeBytes` doc explaining why 2 KB is the floor and not 1 KB.

</details>

**Extension.** Change `<-blocker` to a 4 KB local array followed by the receive. Re-measure. Does `StackInuse` double? Why does it (probably) not — at what threshold does it?

---

### Task 5: Pin a goroutine with `LockOSThread`

**Goal.** Write a program that pins a goroutine to one OS thread using `runtime.LockOSThread`. Verify the pin with `syscall.Gettid()` (Linux) or by reading thread IDs over time.

**Difficulty.** Middle

**Skills.** `LockOSThread`/`UnlockOSThread`, thread identity, why this matters for cgo and OpenGL.

**Setup / starter code.**

```go
//go:build linux
package main

import (
    "fmt"
    "runtime"
    "syscall"
    "time"
)

func main() {
    // TODO: spawn a goroutine that LockOSThreads, then prints its TID
    // every 100ms for 2 seconds. Force scheduler churn by spinning
    // 1000 background goroutines.
}
```

**Steps.**

1. In the locked goroutine, call `runtime.LockOSThread()` first.
2. Print `syscall.Gettid()` 20 times with 100ms gaps. All should be identical.
3. Compare with a *non*-locked goroutine doing the same — TID may change.
4. Open `runtime/proc.go`, find `LockOSThread`. Read the comment.

**Acceptance criteria.**

- Locked goroutine prints the same TID 20 times running.
- Unlocked goroutine prints at least 2 different TIDs (with `GOMAXPROCS > 1` and other goroutines competing).
- Two sentences in your notes: when do you actually need this in real Go code?

<details><summary>Hints</summary>

- Without enough scheduler pressure, an *unlocked* goroutine may still stick on one M for long stretches. Spin 100 background goroutines that `runtime.Gosched()` to force migrations.
- Mac users: `syscall.Gettid` isn't available; use `unix.Gettid` from `golang.org/x/sys/unix` or `syscall.Getpid()` plus reading `/proc/self/task` (Linux only).
- Real use cases: OpenGL contexts, CUDA, certain C libraries with TLS state, signal masks.

</details>

<details><summary>Reference solution</summary>

```go
//go:build linux

package main

import (
    "fmt"
    "runtime"
    "syscall"
    "time"
)

func main() {
    runtime.GOMAXPROCS(4)

    // Background churn to encourage migration of the unlocked goroutine.
    stop := make(chan struct{})
    for i := 0; i < 200; i++ {
        go func() {
            for {
                select {
                case <-stop:
                    return
                default:
                    runtime.Gosched()
                }
            }
        }()
    }

    measure := func(locked bool) map[int]int {
        tids := map[int]int{}
        done := make(chan struct{})
        go func() {
            if locked {
                runtime.LockOSThread()
                defer runtime.UnlockOSThread()
            }
            for i := 0; i < 20; i++ {
                tids[syscall.Gettid()]++
                time.Sleep(100 * time.Millisecond)
            }
            close(done)
        }()
        <-done
        return tids
    }

    fmt.Printf("locked   distinct TIDs: %v\n", measure(true))
    fmt.Printf("unlocked distinct TIDs: %v\n", measure(false))
    close(stop)
}
```

Sample output:

```
=== locked goroutine ===
locked distinct TIDs: 1 -> map[847123:20]
=== unlocked goroutine ===
unlocked distinct TIDs: 3 -> map[847124:7 847125:8 847126:5]
```

From `runtime/proc.go`'s LockOSThread comment: "LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread." Real use: cgo with thread-local state (the OpenGL context, GTK main loop, JNI attachments).

</details>

**Extension.** Read `mexit` in `proc.go`. What happens when a *locked* goroutine returns from its top-level function without calling `UnlockOSThread`?

---

### Task 6: Read `hchan` fields (read-only) via `unsafe`

**Goal.** Build a `ChanState(ch)` debugger that reads `qcount`, `dataqsiz`, and `closed` from a Go channel using `unsafe.Pointer` and the layout in `runtime/chan.go`.

**Difficulty.** Middle

**Skills.** `unsafe.Pointer` arithmetic, struct field offsets, *appropriate* use of internals.

**Setup / starter code.**

```go
package main

import "unsafe"

type hchanHeader struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    // ... remaining fields irrelevant for read-only inspection
}

func ChanState[T any](ch chan T) (qcount, capacity uint, closed bool) {
    // TODO
    return
}

func main() {
    ch := make(chan int, 4)
    ch <- 1; ch <- 2; ch <- 3
    println(ChanState(ch))
}
```

**Steps.**

1. Open `runtime/chan.go`. Find `type hchan struct`. Copy the *order* of the first six fields into `hchanHeader`.
2. The Go function value `chan T` is a pointer to `hchan`. Convert it: `(*hchanHeader)(unsafe.Pointer(&ch))` — no, that's the pointer to the local variable. The right move is `*(*unsafe.Pointer)(unsafe.Pointer(&ch))`. Think carefully.
3. Test with a buffered channel at various fill levels and after `close()`.
4. Document loudly: **this only works because go1.22 has *this* layout. Pin the version.**

**Acceptance criteria.**

- `ChanState` reports correct `qcount` for a partially-filled buffered channel.
- `closed` reports `true` after `close(ch)`.
- File header comment names the Go version this was tested against and warns against production use.

<details><summary>Hints</summary>

- The `chan T` value itself is already a pointer (it's an `*hchan` in disguise). You don't need `&ch` — you need to convert `ch` to `unsafe.Pointer`. Do it via `*(*unsafe.Pointer)(unsafe.Pointer(&ch))` because Go won't let you convert a typed `chan int` to `unsafe.Pointer` directly.
- `qcount uint` and `dataqsiz uint` are 8 bytes each on 64-bit. After them comes `buf unsafe.Pointer` (8 bytes), then `elemsize uint16` (2 bytes), then `closed uint32` (4 bytes — note the natural alignment).
- Run with `go vet -unsafeptr`; expect warnings — silence locally with a comment.

</details>

<details><summary>Reference solution</summary>

```go
// WARNING: reads runtime.hchan via unsafe pointer math.
// Verified against go1.22.3 — runtime/chan.go layout: qcount, dataqsiz,
// buf, elemsize, closed, ... If the layout shifts, this returns garbage.
// Use ONLY for learning / debugging — never in production.

package main

import (
    "fmt"
    "unsafe"
)

type hchanHeader struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to dataqsiz array of elemtype
    elemsize uint16
    closed   uint32
    // remaining fields (elemtype, sendx, recvx, recvq, sendq, lock)
    // omitted — we only read the first 5.
}

func ChanState[T any](ch chan T) (qcount, capacity uint, closed bool) {
    // ch is itself a pointer (*hchan in disguise). We need the
    // hchan address as unsafe.Pointer; round-trip via a stack slot
    // because Go disallows direct chan -> unsafe.Pointer conversion.
    chanPtr := *(*unsafe.Pointer)(unsafe.Pointer(&ch))
    h := (*hchanHeader)(chanPtr)
    return h.qcount, h.dataqsiz, h.closed != 0
}

func main() {
    ch := make(chan int, 8)
    ch <- 10
    ch <- 20
    ch <- 30
    q, cap, closed := ChanState(ch)
    fmt.Printf("after 3 sends:  qcount=%d cap=%d closed=%v\n", q, cap, closed)

    <-ch
    q, cap, closed = ChanState(ch)
    fmt.Printf("after 1 recv:   qcount=%d cap=%d closed=%v\n", q, cap, closed)

    close(ch)
    q, cap, closed = ChanState(ch)
    fmt.Printf("after close:    qcount=%d cap=%d closed=%v\n", q, cap, closed)

    unbuf := make(chan int)
    q, cap, closed = ChanState(unbuf)
    fmt.Printf("unbuffered:     qcount=%d cap=%d closed=%v\n", q, cap, closed)
}
```

Expected:

```
after 3 sends:  qcount=3 cap=8 closed=false
after 1 recv:   qcount=2 cap=8 closed=false
after close:    qcount=2 cap=8 closed=true
unbuffered:     qcount=0 cap=0 closed=false
```

Why this matters as a *learning* exercise (and only as learning): you see that `cap(ch) == h.dataqsiz` and `len(ch) == h.qcount`. The exported `len`/`cap` builtins are just typed wrappers around these fields, with a runtime acquire-load for the mutex word.

Why this is bad in production: layout changes silently between Go versions; the moment go1.23 or 1.24 reorders fields, you read garbage with no compile error.

</details>

**Extension.** Add reading of `sendx` and `recvx` (positions in the ring buffer). Show how they advance during sends and receives. Predict what they should be after one wraparound.

---

### Task 7: Disassemble `go f()` to find `runtime.newproc`

**Goal.** Build a tiny program with `go build -gcflags="-S"` and find the `CALL runtime.newproc` instruction emitted for a `go f()` statement. Identify what's on the stack.

**Difficulty.** Middle

**Skills.** Reading Go assembly, understanding ABI for the `go` statement.

**Setup / starter code.**

```go
// main.go
package main

func work(x int, y string) { _ = x; _ = y }

func main() {
    go work(42, "hello")
    select {}
}
```

**Steps.**

1. Build with `go build -gcflags="-S" -o /dev/null main.go 2> asm.txt` (the `-S` flag prints assembly to stderr).
2. Open `asm.txt`. Find `main.main`. Look for `CALL runtime.newproc(SB)`.
3. Read the instructions immediately above the `CALL`. They prepare a `funcval` and a closure context on the stack.
4. Find the assembly for `runtime.newproc` in `$(go env GOROOT)/src/runtime/proc.go` (the Go body) and `$(go env GOROOT)/src/runtime/asm_amd64.s` (the trampoline if your arch is amd64).

**Acceptance criteria.**

- One screenshot or pasted snippet of `main.main`'s assembly showing the `CALL runtime.newproc`.
- A note identifying: which register/stack slot holds the function pointer, and which holds the arguments.
- Brief: what `newproc` does in three lines (allocate `g`, copy args, put on runq).

<details><summary>Hints</summary>

- Plan9-syntax assembly: `MOVQ $main.work, AX` loads a function pointer; `MOVQ AX, ...(SP)` stores it as the argument to `newproc`.
- `runtime.newproc1` is the real worker; `newproc` is a one-line wrapper that does `systemstack(...)` to switch to the scheduler stack first.
- On go1.22, the call shape is `newproc(fn *funcval)`. Arguments are stored in a goroutine-local frame, not as varargs to newproc.

</details>

<details><summary>Reference solution</summary>

Build the sample:

```bash
go build -gcflags="-S" -o /dev/null main.go 2> asm.txt
grep -A 3 "newproc" asm.txt | head -20
```

Annotated output (amd64, go1.22):

```asm
main.main STEXT size=128 args=0x0 locals=0x28
  0x000f LEAQ main.main.func1·f(SB), AX
        ; AX = pointer to a *funcval representing the closure that
        ; captures (42, "hello") and calls work.
  0x0016 PCDATA $1, $0
  0x0016 CALL   runtime.newproc(SB)
        ; newproc reads AX (the funcval) and creates a new G with that
        ; entry. Args are captured INSIDE main.main.func1 — they don't
        ; go through newproc directly.
```

What you'd see for an unclosured call (rare in practice — the compiler usually generates a closure wrapper for `go f(args...)`):

```asm
  MOVQ $42, 0(SP)             ; first arg
  LEAQ "hello"(SB), AX        ; pointer to "hello" string
  MOVQ AX, 8(SP)
  MOVQ AX, 16(SP)             ; string length
  CALL runtime.newproc(SB)
```

`newproc` in `runtime/proc.go` (paraphrased):

```go
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc) // allocate a new G, copy stack frame
        _p_ := getg().m.p.ptr()
        runqput(_p_, newg, true)     // put on this P's local run queue
        if mainStarted {
            wakep()                  // maybe wake a sleeping M
        }
    })
}
```

So `go f()` is really: build a tiny closure value pointing at `f` (capturing arguments), call `runtime.newproc(fn)`, and the runtime does the rest — allocate G, copy stack frame, enqueue, possibly wake an idle P.

</details>

**Extension.** Change `go work(42, "hello")` to `go func() { work(42, "hello") }()`. Diff the assembly. Why does the compiler emit nearly the same thing?

---

### Task 8: Use `runtime/trace` to measure goroutine create-to-start latency

**Goal.** Record a 100ms execution trace of a busy program. In `go tool trace`, find a specific `GoCreate` event and its matching `GoStart`. Compute the latency.

**Difficulty.** Senior

**Skills.** `runtime/trace`, `go tool trace`, reading the per-goroutine event timeline.

**Setup / starter code.**

```go
package main

import (
    "context"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 200; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ctx, task := trace.NewTask(context.Background(), "work")
            defer task.End()
            _ = ctx
            spin(i * 1000)
        }(i)
    }
    wg.Wait()
}

func spin(n int) {
    x := 0
    for i := 0; i < n; i++ {
        x += i
    }
    _ = x
}
```

**Steps.**

1. Run the program. It produces `trace.out`.
2. Open it: `go tool trace trace.out`. A browser opens.
3. Click "Goroutine analysis" → pick one goroutine.
4. Identify its `GoCreate` (when `newproc` ran) and `GoStart` (when `execute` ran).
5. Compute the gap. This is **scheduling latency**.

**Acceptance criteria.**

- One specific goroutine's `GoCreate` → `GoStart` latency reported (in µs or ns).
- A note on which P picked it up.
- A second observation: under what conditions does this latency spike (lots of GC? few Ps?).

<details><summary>Hints</summary>

- If `go tool trace` complains about the version, your trace file is from a newer Go than your `go` binary. Use matching versions.
- The "Network blocking profile" view is unrelated; you want the goroutine view.
- For *programmatic* analysis, use `golang.org/x/exp/trace` (or the older `internal/trace`) to parse `trace.out` and aggregate latencies.

</details>

<details><summary>Reference solution</summary>

Programmatic version (parses the trace, no browser needed):

```go
// trace-latency.go — capture a trace; analyze with `go tool trace`.
package main

import (
    "context"
    "os"
    "runtime"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    _ = trace.Start(f)
    defer trace.Stop()

    runtime.GOMAXPROCS(4)
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ctx, task := trace.NewTask(context.Background(), "spin")
            defer task.End()
            trace.Logf(ctx, "id", "%d", i)
            x := 0
            for j := 0; j < 500; j++ { x += j }
            _ = x
        }(i)
    }
    wg.Wait()
}
```

Then `go run trace-latency.go && go tool trace trace.out` — browser opens. Click "View trace" → pick a G → read its `GoCreate` and `GoStart` events on the timeline.

Typical findings: with `GOMAXPROCS=4` and 1000 goroutines launched in a tight loop, average `GoCreate → GoStart` latency is 5–50 µs. Goroutines created when all 4 Ps are busy queue in the local runq and wait until a `findRunnable` cycle picks them up. With `GOMAXPROCS=1`, every goroutine after the first waits its turn.

For programmatic latency aggregation, use `golang.org/x/exp/trace`: pair `EvGoCreate` and `EvGoStart` events by goroutine ID, compute the delta, aggregate. The point of the exercise: scheduling latency is *real* and *measurable*. Production batch systems that fan out 10000 short tasks may spend more time scheduling than working — at which point a worker pool of N goroutines pulling from a channel beats `go` per task.

</details>

**Extension.** Modify the program to inject a `runtime.GC()` call halfway through. Reopen the trace. What does GC do to scheduling latency? (Look for STW gaps.)

---

### Task 9: Benchmark `go f()` cost across 1, 4, 16 Ps

**Goal.** Write a benchmark that measures the cost of `go f()` (creation + scheduling) at `GOMAXPROCS=1`, `4`, `16`. Explain the curve using your knowledge of local-runq vs global-runq.

**Difficulty.** Senior

**Skills.** `testing.B`, `runtime.GOMAXPROCS`, scheduler queue mechanics from `proc.go`.

**Setup / starter code.**

```go
package main

import (
    "runtime"
    "sync"
    "testing"
)

func BenchmarkGoCreate(b *testing.B) {
    for _, p := range []int{1, 4, 16} {
        b.Run(/* TODO */, func(b *testing.B) {
            runtime.GOMAXPROCS(p)
            var wg sync.WaitGroup
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                wg.Add(1)
                go func() { wg.Done() }()
            }
            wg.Wait()
        })
    }
}
```

**Steps.**

1. Run `go test -bench=BenchmarkGoCreate -benchmem`.
2. Record ns/op for each P count.
3. Read `runqput` and `runqsteal` in `runtime/proc.go`. Understand: P-local runq is 256 slots; overflow goes to a global queue protected by a mutex.
4. Explain why P=1 might *not* be the slowest.

**Acceptance criteria.**

- Three benchmark numbers, each labeled by P count.
- One-paragraph explanation referencing `runqput` (`runq` size 256, then global queue with mutex).
- A note: at what `b.N` does the local runq overflow start dominating?

<details><summary>Hints</summary>

- P=1 means no work-stealing, no atomic CAS on `runqhead`/`runqtail`, no global queue contention. Sometimes *fastest* for tight create-and-done bursts.
- P=16 with only 4 cores means M:P binding churns; you may see thrashing.
- `runqput` first tries `runqputslow` if local queue is full → drops half into the global queue under `sched.lock`.

</details>

<details><summary>Reference solution</summary>

```go
// go_cost_test.go
package gocost

import (
    "runtime"
    "sync"
    "testing"
)

func empty() {}

func BenchmarkGoCreate(b *testing.B) {
    for _, p := range []int{1, 2, 4, 8, 16} {
        b.Run(name(p), func(b *testing.B) {
            old := runtime.GOMAXPROCS(p)
            defer runtime.GOMAXPROCS(old)

            var wg sync.WaitGroup
            b.ReportAllocs()
            b.ResetTimer()

            for i := 0; i < b.N; i++ {
                wg.Add(1)
                go func() {
                    empty()
                    wg.Done()
                }()
            }
            wg.Wait()
        })
    }
}

func name(p int) string {
    return [...]string{"", "P=1", "P=2", "", "P=4", "", "", "", "P=8",
        "", "", "", "", "", "", "", "P=16"}[p]
}
```

Sample results (12-core MacBook, go1.22):

```
BenchmarkGoCreate/P=1-12         5000000     280 ns/op    32 B/op    1 allocs/op
BenchmarkGoCreate/P=2-12         3000000     420 ns/op    32 B/op    1 allocs/op
BenchmarkGoCreate/P=4-12         3000000     510 ns/op    32 B/op    1 allocs/op
BenchmarkGoCreate/P=8-12         2000000     680 ns/op    32 B/op    1 allocs/op
BenchmarkGoCreate/P=16-12        1500000     830 ns/op    32 B/op    1 allocs/op
```

The curve goes *up*, not down. Why?

1. **P=1**: every `go` lands in P0's local runq (256 slots). `runqput` is a single atomic store. No contention.
2. **P=2..8**: now multiple Ms execute scheduler cycles. `runqsteal` from neighbors causes CAS contention on `runqhead`. `findRunnable` walks all Ps once per cycle — O(P) work per descheduling.
3. **P=16 on 12 cores**: Ms thrash. Some Ps are perpetually empty (their M parks in `stopm`); others overflow into the global queue via `runqputslow`, which takes `sched.lock` — *now* there's a single-point contention.

**Lesson**: more Ps is not free. The sweet spot is `GOMAXPROCS == NumCPU` for most workloads. For *purely create-and-done* microbenchmarks like this one, fewer Ps wins because you've removed all stealing overhead. Real programs do actual work between `go` calls, hiding this.

Cross-reference: `runtime/proc.go`'s `runqput` and `runqputslow`:

```go
// runqput tries to put g on the local runnable queue.
// If the local queue is full, runqput puts half of the local
// queue on a global queue.
func runqput(_p_ *p, gp *g, next bool) { ... }

// runqputslow puts g and a batch of work from local runnable queue
// on global queue.
// Lock acquired: sched.lock
func runqputslow(_p_ *p, gp *g, h, t uint32) bool { ... }
```

</details>

**Extension.** Change `func empty()` to `func spin()` that runs ~1 µs of work. Re-run. Does the P curve invert (more Ps becomes faster)? Below what work amount is `go f()` net-negative?

---

### Task 10: Map `findRunnable`'s decision tree

**Goal.** Read `findRunnable` in `runtime/proc.go`. Write a markdown summary of its 8+ steps in order, with line numbers from your Go version.

**Difficulty.** Senior

**Skills.** Patient long-form source reading, summarizing scheduler heuristics.

**Setup.**

```bash
grep -n "^func findRunnable" "$(go env GOROOT)/src/runtime/proc.go"
```

**Steps.**

1. Find the function. Note its line number.
2. Read it top to bottom. It's ~300 lines. Take notes as you go.
3. Identify each `top:` label loop and each `goto top`.
4. List the queues `findRunnable` checks, in order.

**Acceptance criteria.**

- Numbered list of 8+ steps with one sentence each.
- Each step references a line number.
- A note: which step does *work stealing*, and what's its budget (`stealOrder.start`).

<details><summary>Hints</summary>

- The phases are roughly: (1) local runq, (2) global runq, (3) netpoll without blocking, (4) work stealing, (5) GC mark workers, (6) check for runnable timers, (7) park M, (8) blocking netpoll.
- "GC mark workers" is gated by `gcBlackenEnabled`. If GC is not running, that step short-circuits.
- The function returns `(gp, inheritTime, tryWakeP)`; `schedule()` uses these.

</details>

<details><summary>Reference solution</summary>

`findRunnable` walkthrough (go1.22.3, line numbers approximate):

```
findRunnable — proc.go:3201

Phases (first hit wins, else fall through):

1. Local runq via runqget — ~90% of pulls land here, one atomic CAS.
2. Every 61st tick, peek global runq — anti-starvation poke.
3. Global runq via globrunqget — sched.lock, take 1/P share.
4. Non-blocking netpoll(0) — return ready I/O Gs without blocking.
5. Work stealing — stealWork iterates Ps in random order, 4 passes
   (stealTries budget); per-victim runqsteal takes half their runq.
6. GC mark worker check — if gcBlackenEnabled, return mark worker.
7. Re-check global runq under sched.lock — defensive.
8. Check timers — expired pp.timers become runnable Gs.
9. Park the M via stopm — no work; wakep wakes it later.
10. After wake: blocking netpoll for I/O (with timer-aware timeout).

WORK STEALING DETAIL:
  stealOrder = randomized permutation of P indices. Budget: 4 tries,
  each walks full P list. Per-victim: runqsteal first (half), else
  take victim's next-G slot.

RETURNS (gp, inheritTime, tryWakeP):
  inheritTime: don't reset schedtick (continue same time slice).
  tryWakeP: multiple runnable Gs found → wake another P to help.
```

Takeaway: `findRunnable` is a *hierarchy of heuristics* tuned over a decade. The 61-tick global-runq poke is a famously magical-number tweak; the 4-try steal budget is another. Read the comments.

</details>

**Extension.** Find `stealOrder` in the same file. How does the random order get generated? Why is randomization important?

---

### Task 11: Reproduce pre-1.14 goroutine starvation

**Goal.** Write a program that *would have* exhibited goroutine starvation pre-Go 1.14 (a CPU-bound loop with no function calls). Demonstrate that on go1.22, asynchronous preemption fixes it.

**Difficulty.** Senior

**Skills.** Cooperative vs asynchronous preemption, `GODEBUG=asyncpreemptoff=1`, reading `runtime/preempt.go`.

**Setup / starter code.**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func tightLoop(stop *bool) {
    for !*stop {
        // No function calls; pre-1.14 this would never yield.
    }
}

func main() {
    runtime.GOMAXPROCS(1) // worst-case: one P, starvation visible
    var stop bool

    go tightLoop(&stop)
    time.Sleep(100 * time.Millisecond)

    fmt.Println("did the main goroutine ever wake?")
    stop = true
    time.Sleep(100 * time.Millisecond)
}
```

**Steps.**

1. Run normally. On go1.22, the `fmt.Println` runs and the program exits. Async preemption fired.
2. Run with `GODEBUG=asyncpreemptoff=1 go run main.go`. The program hangs. Kill with Ctrl+C.
3. Open `runtime/preempt.go`. Find `preemptM`. Note the SIGURG signal injection.
4. Open `runtime/signal_unix.go`. Find the `sigPreempt` handler.

**Acceptance criteria.**

- Normal run: program exits cleanly within ~250ms.
- `asyncpreemptoff=1`: program hangs (you have to kill it).
- One sentence: where does `runtime/preempt.go` send the preemption signal?
- One sentence: what does the signal handler do that allows the loop to yield?

<details><summary>Hints</summary>

- `GODEBUG=schedtrace=1000` prints scheduler state every 1s. Useful to see "1 G running, 1 G waiting".
- Pre-1.14, preemption happened only at function-call prologues (the "morestack" check was also the preempt check).
- Async preemption: runtime sends SIGURG to the M; the signal handler manipulates the saved register state to push a call to `runtime.asyncPreempt` onto the stack. That function calls `gopreempt_m`, which goes back through the scheduler.

</details>

<details><summary>Reference solution</summary>

```go
// preempt_demo.go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func tightLoop(stop *bool) {
    for !*stop {
        // No function calls. Pre-1.14 cooperative preemption would
        // never fire here; the scheduler had no chance to preempt.
    }
}

func main() {
    runtime.GOMAXPROCS(1)
    var stop bool

    start := time.Now()
    go tightLoop(&stop)

    // Sleep blocks the main goroutine. Under GOMAXPROCS=1 and no
    // preemption, the tight loop monopolises the only P. Main never
    // wakes; the program hangs.
    time.Sleep(100 * time.Millisecond)

    fmt.Printf("main woke after %s\n", time.Since(start))
    stop = true
    time.Sleep(50 * time.Millisecond)
}
```

Outputs:

```bash
$ go run preempt_demo.go
main woke after 102.4ms

$ GODEBUG=asyncpreemptoff=1 go run preempt_demo.go
# hangs forever; Ctrl+C
```

**With async preemption OFF:** `tightLoop` runs on the only P. `main` calls `time.Sleep`, parks. Scheduler picks the only runnable G (`tightLoop`), which has no function calls and no preempt check. Timer fires but the only P is busy; no M is free. Deadlock.

**With async preemption ON:** After ~10ms, sysmon notices `tightLoop` has run too long without a preempt point. `preemptM(mp)` sends SIGURG to the M's OS thread. `doSigPreempt` (in `runtime/signal_unix.go`) rewrites the saved PC via `pushCall(c, abi.FuncPCABIInternal(asyncPreempt), 0)`. When the signal handler returns, execution jumps to `runtime.asyncPreempt` (assembly, in `asm_amd64.s`), which saves registers and calls `gopreempt_m` to mark the G as preempted and return to the scheduler.

Source pointers (go1.22):
- `runtime/preempt.go` — `preemptone(_p_)`, `preemptM(mp)`.
- `runtime/signal_unix.go` — `doSigPreempt`, signal mask handling.
- `runtime/asm_amd64.s` — `asyncPreempt`/`asyncPreempt2` trampolines.

</details>

**Extension.** Read the design doc at `https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md`. What considerations went into picking SIGURG specifically?

---

### Task 12: Call an unexported runtime function via `go:linkname`

**Goal.** Use `//go:linkname` to call `runtime.nanotime()` (or similar unexported helper) from your test package. Discuss when this is appropriate.

**Difficulty.** Senior

**Skills.** `//go:linkname` directive, unsafe binding to runtime symbols, ethics of doing so.

**Setup / starter code.**

```go
// linkname.go — must include `import _ "unsafe"` to enable the directive.
package main

import (
    "fmt"
    _ "unsafe"
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func main() {
    a := nanotime()
    for i := 0; i < 1_000_000; i++ {
        _ = i * i
    }
    b := nanotime()
    fmt.Printf("elapsed: %d ns\n", b-a)
}
```

**Steps.**

1. Compile and run. Output should show ~few ms in nanoseconds.
2. Try removing `import _ "unsafe"`. Build will fail with "linkname must refer to declared function or variable" — `unsafe` enables the directive.
3. Open `time/sleep.go` or `sync/poolqueue.go` in the stdlib. Search for `//go:linkname`. Note how the *standard library itself* uses it to bind to runtime symbols.
4. Write a 3-line comment block in your file explaining when you'd use this in production.

**Acceptance criteria.**

- Program compiles, runs, prints a sensible nanosecond delta.
- Comment block names at least one stdlib package that uses `go:linkname` to call runtime internals (e.g., `time`, `sync`, `reflect`).
- Two sentences on the danger: linker won't catch a symbol rename; symbol could disappear silently between Go versions.

<details><summary>Hints</summary>

- Without `import _ "unsafe"`, `go:linkname` is silently ignored — the most confusing of all Go linker errors.
- The standard library has hundreds of `//go:linkname` calls. They're how `time.Now()` reaches into `runtime.nanotime()` (which uses `CLOCK_MONOTONIC`).
- Go 1.23+ tightened the rules: `go:linkname` targeting a third-party package requires that package to opt in via a comment. The runtime is still permissive.

</details>

<details><summary>Reference solution</summary>

```go
// linkname_demo.go — binds local names to unexported runtime symbols.
// stdlib does this routinely (time.Now -> runtime.nanotime). Symbols
// can disappear in any minor release with no compile error.
package main

import (
    "fmt"
    _ "unsafe" // required for go:linkname to be honored
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func main() {
    start := nanotime()
    sum := 0
    for i := 0; i < 1_000_000; i++ { sum += i }
    elapsed := nanotime() - start
    fmt.Printf("loop: %d ns; sum=%d\n", elapsed, sum)
}
```

Stdlib examples to read:
- `time/sleep.go` — `//go:linkname runtimeNano runtime.nanotime`, `startTimer`.
- `reflect/value.go` — `//go:linkname unsafe_New runtime.unsafe_New`.
- `sync/poolqueue.go` — uses runtime atomics via linkname.
- `internal/poll/` — links to `runtime.poll_runtime_pollServerInit`.

When NOT to use: anything `context.Context` or `time.Now` can do; any "supported" `runtime` API. When it IS used (third-party): gVisor's scheduler integration, certain profilers calling `runtime.systemstack`, GC-bypass allocators binding to `runtime.mallocgc`.

</details>

**Extension.** Try `//go:linkname` to `runtime.gopark`. What additional types do you need to declare (`waitReason`, `traceEv`)? Why is this dramatically more dangerous than `nanotime`?

---

### Task 13: Summarize the non-cooperative preemption proposal

**Goal.** Read [Go proposal #24543 "Non-cooperative goroutine preemption"](https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md). Summarize in 1 page (markdown). Point at the implementation in current `runtime/preempt.go` and `runtime/signal_unix.go`.

**Difficulty.** Staff

**Skills.** Design doc reading, mapping proposal to source.

**Steps.**

1. Read the proposal end-to-end (~30 minutes). It's 5000 words.
2. Take notes on: motivation (what broke pre-1.14), the safe-point problem, signal choice (SIGURG over SIGUSR2), and stack scanning challenges.
3. Open `runtime/preempt.go`. Find `asyncPreempt` and `asyncPreempt2`. Trace the call chain from `preemptM(mp *m)` (the sender) to the signal-handler-driven jump (the receiver).
4. Write your 1-page summary.

**Acceptance criteria.**

- 1 page (~400 words).
- Names the four sub-problems: (a) signal-safe interruption, (b) safe points for GC, (c) stack scanning at arbitrary PC, (d) inserting a synthetic call frame.
- Cites at least two source files with function names.
- Discusses why SIGURG was chosen.

<details><summary>Hints</summary>

- SIGURG is rarely used by applications (it's for out-of-band TCP data, which almost nothing uses), so claiming it for the runtime is safe.
- The hardest part of async preemption is *stack scanning*: GC must walk a stack to find pointers, but at an arbitrary PC, the stack frame layout is unknown. The proposal addresses this with PCDATA tables that encode "at PC X, the live pointers are at offsets Y1, Y2, ...".
- "Safe point" was redefined: every instruction is now a safe point as long as PCDATA covers it.

</details>

<details><summary>Reference solution</summary>

```markdown
# Non-cooperative goroutine preemption (proposal 24543) — summary

## The problem (pre-1.14)

A Go program could not preempt a tight CPU loop with no function calls.
The scheduler's only preemption hook was the function prologue's stack-
growth check (`morestack`): no call sites meant no preempt points.
A single G could starve its P arbitrarily. GC also suffered — STW had
to wait for every G to reach a safe point.

## The four sub-problems

1. **Signal-safe interruption.** SIGURG was chosen because it's rarely
   used by applications (out-of-band TCP data, mostly abandoned).
   SIGUSR1/2 are reserved for user programs; SIGSEGV/SIGBUS for runtime
   error handling.

2. **Safe-point coverage for GC.** Async preemption can land the PC
   anywhere. Solution: extend PCDATA so every reachable PC has a
   precise live-pointer map. Cost: ~5% larger binaries.

3. **Stack scanning at arbitrary PC.** Redefined the safe point: any
   PC with a covered stack map. Required updates in
   `cmd/compile/internal/gc` and `runtime/mgcmark.go`.

4. **Inserting a synthetic call frame.** The signal handler must
   arrange for the G to call into the runtime *after* the handler
   returns. `doSigPreempt` rewrites the saved PC to `asyncPreempt`;
   sigreturn unwinds, CPU "returns" into `asyncPreempt`.

## Implementation pointers (go1.22)

- `runtime/preempt.go` — `preemptM(mp *m)`, entry point from sysmon.
- `runtime/signal_unix.go` — `doSigPreempt` rewrites PC via `pushCall`.
- `runtime/asm_amd64.s` — `asyncPreempt` saves all registers, calls
  `asyncPreempt2` → `gopreempt_m`.
- `runtime/proc.go` — `gopreempt_m` marks G preempted, re-enters
  scheduler.

## Trade-offs

- Binary size ~5% larger (PCDATA tables).
- Some asm packages without PCDATA cannot be async-preempted.
- CGo callbacks still not async-preemptable (foreign frames).

## Effect in practice

`for {}` loops in tests no longer hang `go test`. STW pauses dropped
from "sometimes seconds" to "consistently sub-millisecond" on healthy
programs.
```

</details>

**Extension.** Find any open issue in `golang/go` related to async preemption. Read the conversation. What edge case is still being debated?

---

### Task 14: Diff `runtime/proc.go` between two Go releases

**Goal.** Pick two adjacent Go releases (e.g., go1.21 and go1.22). Diff `runtime/proc.go`. Pick one non-trivial change. Write a 1-page explanation of *what* and *why*.

**Difficulty.** Staff

**Skills.** Git, release notes reading, going from "this diff" to "this changed because".

**Setup.**

```bash
git clone --depth 1000 https://go.googlesource.com/go /tmp/go-src
cd /tmp/go-src
git diff go1.21.5 go1.22.3 -- src/runtime/proc.go > /tmp/proc-diff.patch
wc -l /tmp/proc-diff.patch
```

**Steps.**

1. Skim the diff. ~500–2000 lines is typical.
2. Find a single hunk that's not just renaming/comments. Could be: new goroutine state, changed steal logic, new fast path, removed slow path.
3. Read the release notes (`go.dev/doc/go1.22`). Find the relevant section.
4. Read the commit that introduced the change: `git log -p -- src/runtime/proc.go | grep -A 5 "<your change>"`.
5. Write your 1-page explanation.

**Acceptance criteria.**

- Hunk identified by commit SHA and one-line summary.
- 1 page (~400 words) explaining what changed and why.
- A measurable claim: what does this affect (throughput, latency, fairness)?

<details><summary>Hints</summary>

- Good candidate changes between 1.21 → 1.22: PGO-related scheduler tweaks, timer-G integration changes, `randomOrder` refinements.
- `git log --oneline src/runtime/proc.go | head -50` after checking out the newer tag — look for descriptive commits.
- Don't pick a comment-only or formatting change. Look for new code paths.

</details>

<details><summary>Reference solution</summary>

Example writeup picking a real-style change:

```markdown
# proc.go change: go1.21 → go1.22

## Change

Refactor of `runqsteal` to bound the amount taken per steal,
favouring smaller more frequent steals over bursts of 128.

## Why

Two pressures in tension:
1. Bigger steals reduce steal frequency (each is a CAS-loop on
   the victim's runqhead — amortises cost).
2. Smaller steals improve fairness and cache locality. A big
   burst means the stealer is committed to running N user Gs
   before checking back — long enough to miss new timer expiries,
   netpoll readiness, etc.

go1.22 favours (2). Workloads observed in production showed the
stealer's local runq behaving like a "stash" that hid new global
runq work from `findRunnable`'s 61-tick poke.

## Measurable effect

- net/http throughput unchanged within noise.
- Tail latency under bursty arrival improved ~3% in runtime's
  internal benchmarks.
- GOMAXPROCS=1 unaffected (no stealing).

## Lesson

The Go runtime is a decade-old codebase that still gets tuned.
"We took less" is sometimes the right change. The cost of a
tweak is not the diff size — it's whether the workloads that
motivated the change are representative of *yours*.
```

</details>

**Extension.** Cross-check your finding against the GopherCon scheduler talks (Dmitry Vyukov, Austin Clements, Michael Knyszek). Does anyone discuss the change you found?

---

### Task 15: Log every `gopark` reason

**Goal.** Build a tool that intercepts every `gopark` call and logs its `waitReason` to stderr. Discuss what you'd need beyond a normal Go program to make this work.

**Difficulty.** Staff

**Skills.** `runtime/trace` events, `GODEBUG`, weighing the cost of patching the runtime.

**Steps.**

1. Open `runtime/proc.go`. Find `gopark`. Note the `reason waitReason` parameter.
2. Read `runtime/trace.go`. The runtime already emits `EvGoBlock*` events with reasons via the trace mechanism.
3. Decide: do you patch the runtime, use `runtime/trace`, or use `go:linkname` to hook?
4. Build a minimal version using `runtime/trace`: start tracing, run a program that does various blocking operations, stop tracing, parse the trace, print waitReasons.

**Acceptance criteria.**

- A program that runs work, captures the trace, and prints `gopark` reasons.
- A short writeup (~300 words) discussing what each approach costs.

<details><summary>Hints</summary>

- `runtime/trace` is the only sanctioned way. Patching the runtime requires rebuilding it.
- `EvGoBlock`, `EvGoBlockSend`, `EvGoBlockRecv`, `EvGoBlockSelect`, `EvGoBlockSync`, etc. — the trace format encodes reasons as event IDs, not strings.
- Parsing the trace yourself is hard; use `golang.org/x/exp/trace` or shell out to `go tool trace -trace`.

</details>

<details><summary>Reference solution</summary>

Using `runtime/trace` and `golang.org/x/exp/trace`:

```go
// gopark_logger.go — aggregate gopark reasons from a runtime trace.
package main

import (
    "fmt"
    "os"
    "runtime/trace"
    "sync"
    "time"

    xtrace "golang.org/x/exp/trace"
)

func main() {
    f, _ := os.Create("trace.out")
    _ = trace.Start(f)
    runWork()
    trace.Stop()
    f.Close()

    in, _ := os.Open("trace.out")
    defer in.Close()
    r, _ := xtrace.NewReader(in)

    counts := map[string]int{}
    for {
        ev, err := r.ReadEvent()
        if err != nil {
            break
        }
        if ev.Kind() == xtrace.EventStateTransition {
            st := ev.StateTransition()
            if st.Resource.Kind == xtrace.ResourceGoroutine {
                _, to := st.Goroutine()
                if to == xtrace.GoWaiting {
                    counts[st.Reason]++
                }
            }
        }
    }
    fmt.Println("=== gopark reasons ===")
    for r, n := range counts {
        fmt.Printf("  %-30s %d\n", r, n)
    }
}

func runWork() {
    var wg sync.WaitGroup
    ch := make(chan int, 1)
    wg.Add(3)
    go func() { defer wg.Done(); <-ch }()
    go func() { defer wg.Done(); time.Sleep(50 * time.Millisecond); ch <- 1 }()
    go func() {
        defer wg.Done()
        m := &sync.Mutex{}
        m.Lock()
        go func() { time.Sleep(20 * time.Millisecond); m.Unlock() }()
        m.Lock(); m.Unlock()
    }()
    wg.Wait()
}
```

Sample output:

```
=== gopark reasons (counts) ===
  chan receive                    1
  sleep                           1
  sync.Mutex.Lock                 1
  GC mark assist wait             3
```

**Cost discussion (what you'd write up):**

Three approaches to logging gopark, ranked by cost:

1. **`runtime/trace` (this solution).**
   Pros: works with stock Go binary, sanctioned API, can attach offline.
   Cons: ~2–3% runtime overhead during tracing; can't filter at the source.

2. **`go:linkname` to wrap `gopark`.**
   The signature is `gopark(unlockf func(*g, unsafe.Pointer) bool,
   lock unsafe.Pointer, reason waitReason, traceEv byte, traceskip int)`.
   You'd need to declare `waitReason` (it's `byte`) and intercept.
   Pros: zero baseline overhead until you opt in.
   Cons: extremely fragile — any signature change between Go versions
   breaks compilation; future Go versions may refuse linkname into
   `gopark`.

3. **Patch the runtime.**
   Edit `runtime/proc.go`'s `gopark` to write to stderr. Rebuild the
   whole toolchain.
   Pros: ultimate flexibility.
   Cons: rebuild is 5+ minutes; programs built with this toolchain
   are not portable.

For learning, approach 1. For production tracing, eBPF on the
generated machine code is the modern answer (see `parca-dev/parca-agent`).

</details>

**Extension.** Use eBPF with `bpftrace` to attach to `runtime.gopark` directly via a uprobe. Compare the output (and the overhead).

---

### Task 16: Compare Go's scheduler with Erlang's BEAM

**Goal.** Write a 2-page comparison of Go's work-stealing scheduler and Erlang's reductions-based BEAM scheduler. Cite the relevant Go runtime source.

**Difficulty.** Staff

**Skills.** Cross-runtime literacy, identifying which design decisions matter.

**Steps.**

1. Read the BEAM scheduler chapter of "The BEAM Book" (free online) or Joe Armstrong's papers.
2. Re-read `runtime/proc.go`'s `schedule` and `findRunnable`.
3. Identify three axes of comparison: (a) preemption mechanism, (b) work distribution, (c) fairness.
4. Write the 2-page comparison.

**Acceptance criteria.**

- 2 pages (~800 words).
- Three axes covered explicitly.
- At least three source citations from `runtime/proc.go` with function names.
- A take: which design wins for which workload.

<details><summary>Hints</summary>

- BEAM counts "reductions" (function calls / pattern matches). At ~2000 reductions, the scheduler forcibly switches. Cooperative but very fine-grained.
- Go uses async signal preemption (10ms target) plus cooperative checks at function prologues.
- BEAM's run queues are per-scheduler-thread (similar to Go's per-P queues), with cross-scheduler migration on imbalance.
- BEAM has a global "reduction account" per process. Go doesn't track work units this way.

</details>

<details><summary>Reference solution</summary>

```markdown
# Go vs BEAM: scheduler comparison

## (a) Preemption

**BEAM** uses a *reductions* counter — every function call / pattern
match decrements it. At ~2000, the VM switches processes. Cooperative,
fine-grained, deterministic in cost.

**Go** uses signal-based async preemption (since 1.14): sysmon watches
per-P schedticks, calls `preemptM` after 10ms, SIGURG rewrites PC to
`runtime.asyncPreempt`. Source: `runtime/preempt.go:preemptM`,
`runtime/signal_unix.go:doSigPreempt`, `runtime/proc.go:sysmon`.

**Verdict:** BEAM gives predictable sub-ms tail latency. Go's 10ms is
fine for most servers but worse for soft-real-time (game servers,
telco). Erlang built BEAM for telco.

## (b) Work distribution

**BEAM:** per-scheduler-thread run queues + migration logic +
*priorities* (normal/high/max). High-priority processes preempt
normal ones.

**Go:** per-P local runqs (256 slots) + global runq. Randomized
work-stealing (`stealOrder`) with 4-pass budget. No priorities.
Source: `runtime/proc.go:runqsteal`, `runqput`, `globrunqget`.

**Verdict:** BEAM's priorities matter when "one critical loop +
many background workers" is the topology. Go's flat model is
simpler and matches typical server workloads.

## (c) Fairness

**BEAM:** strongly fair via reductions counter — every process
yields after ~2000 reductions regardless of code shape.

**Go:** eventually fair via signal preemption (10ms), the 61-tick
global runq poke (`findRunnable` — `if schedtick%61 == 0`), and
work-stealing.

**Verdict:** BEAM is dramatically fairer at small timescales. Go is
"fair enough" for HTTP and batch. If you need sub-ms fairness in
Go you write a manual worker pool — at which point you've
reinvented BEAM's run queue.

## Which design wins for which workload

| Workload | Winner | Why |
|----------|--------|-----|
| HTTP API (~1ms) | Go | Lower per-G overhead, simpler |
| Telco / soft-real-time | BEAM | Sub-ms fairness, priorities |
| ML batching | Go | Stealing redistributes bursts |
| Chat / fanout | BEAM | Per-process mailbox + priorities |
| Numerical CPU-bound | Go | Native code, no VM |
| Supervisor trees | BEAM | OTP — Go has no equivalent |

## Deeper lesson

Both runtimes optimize for "many lightweight units". They disagree
on what "fair" means: BEAM enforces it via runtime counter; Go via
signal interruption + work stealing. Pick by latency profile, not
language preference.
```

</details>

**Extension.** Look up Akka (JVM actor system). How does it compare on these three axes? Is its scheduler closer to Go's or BEAM's?

---

### Task 17: GODEBUG=schedtrace=1000 interpretation

**Goal.** Run a program with `GODEBUG=schedtrace=1000` and parse the per-second scheduler dumps. Annotate each field.

**Difficulty.** Middle

**Skills.** `GODEBUG` env, reading semi-structured runtime output, mapping it to source.

**Setup.**

```bash
GODEBUG=schedtrace=1000 go run yourprog.go 2>&1 | head -20
```

**Steps.**

1. Run any non-trivial program for 5 seconds with `schedtrace=1000`.
2. Capture one line of output, e.g.:
   ```
   SCHED 1015ms: gomaxprocs=12 idleprocs=8 threads=15 spinningthreads=0 needspinning=0 idlethreads=11 runqueue=0 [0 0 0 0 0 0 0 0 0 0 0 0]
   ```
3. Open `runtime/proc.go`. Find `schedtrace` (search for the format string). It's near `sysmon`.
4. Annotate each field in your line.

**Acceptance criteria.**

- One captured `schedtrace` line.
- Each field annotated with a one-sentence explanation.
- Pointer to the source line that emits this format.

<details><summary>Hints</summary>

- `[0 0 0 0 ...]` at the end is the per-P local runq depth, one per P.
- `spinningthreads` is how many Ms are in `findRunnable`'s steal-spin loop right now.
- `idlethreads` includes both `mput` Ms and those parked in `notesleep`.

</details>

<details><summary>Reference solution</summary>

Captured line:

```
SCHED 1015ms: gomaxprocs=12 idleprocs=8 threads=15 spinningthreads=0
              needspinning=0 idlethreads=11 runqueue=0 [0 0 0 0 0 0 0 0 0 0 0 0]
```

Annotations:

```
SCHED 1015ms      — milliseconds since program start
gomaxprocs=12     — runtime.GOMAXPROCS(0); cap on simultaneous Ms running Gs
idleprocs=8       — Ps with no G to run RIGHT NOW (in sched.pidle list)
threads=15        — total OS threads (Ms) the runtime has created
spinningthreads=0 — Ms currently in findRunnable's spin (looking for work)
needspinning=0    — runtime believes 0 more spinners would help
idlethreads=11    — Ms parked (sched.midle list) waiting for work or sysmon
runqueue=0        — depth of the GLOBAL runq
[0 0 0 0 ...]     — per-P local runq depths, one slot per P

INTERPRETATION:
  4 Ps have Gs running (12 - 8 = 4 active).
  No M is spinning, no M is needed. System is at rest.
  All per-P queues are empty — every active P has exactly one G
  running and nothing queued.
```

Source: `runtime/proc.go`'s `schedtrace` function — search for `print("SCHED ")`. It's called from `sysmon` at the configured interval.

Try also: `GODEBUG=schedtrace=1000,scheddetail=1` for per-G dumps. Output is enormous but invaluable when diagnosing scheduler issues.

</details>

**Extension.** Use `schedtrace=100` (every 100ms) during a `go test -bench`. What do you see during a `b.N` ramp?

---

### Task 18: Read `mallocgc` and identify the fast path

**Goal.** Open `runtime/malloc.go`. Find `mallocgc`. Identify its three size classes (tiny, small, large) and the fast path for each.

**Difficulty.** Senior

**Skills.** Reading allocation source, understanding size classes.

**Steps.**

1. `grep -n "^func mallocgc" "$(go env GOROOT)/src/runtime/malloc.go"`.
2. Read the function. ~300 lines.
3. Identify the three branches: tiny (<16B), small (16B–32KB), large (>32KB).
4. For each, write down: which mcache field is used, what happens on cache miss.

**Acceptance criteria.**

- Three size class thresholds quoted from source.
- For each class: cache field name, allocator function called.
- One-line note: what's the *most expensive* call mallocgc can make?

<details><summary>Hints</summary>

- `mcache` is per-P. `mcentral` is per-size-class globally. `mheap` is the big lock-protected master.
- Tiny allocations (under 16 bytes, no pointers) get packed into a shared tiny block — multiple tiny allocations from one mcache.tiny block.
- Large (>32KB) goes straight to mheap.alloc(). No intermediate caching.

</details>

<details><summary>Reference solution</summary>

`mallocgc` size classes (go1.22, runtime/malloc.go):

```
1. TINY  (size < 16 && !containsPointers)
   Cache: mcache.tiny (16-byte block, bump-allocate).
   Refill from tinyalloc-class span. ~10ns hot path.

2. SMALL (16 ≤ size < 32KB)
   Cache: mcache.alloc[sizeclass] (an *mspan).
   67 size classes (8, 16, 24, ..., 32KB).
   Fast: pop span.freelist (one CAS).
   Slow: refill from mcentral via mcache.nextFree.
   Slow-slow: mcentral grabs from mheap (heap lock).

3. LARGE (size ≥ 32KB)
   No cache. Direct mheap.alloc(npages). Page granularity (8KB).
   Locks the heap. ~µs.

FAST PATH: read mcache.alloc[sizeclass] → pop freelist → advance →
return slot. No global state touched.

SLOW PATHS by cost:
  mcentral refill      — central lock per size class
  mheap refill         — global heap lock
  Heap grow            — mmap / VirtualAlloc syscall

MOST EXPENSIVE: mheap.grow() → sysAlloc → mmap, then zeroing.
```

Cross-reference the comment block at the top of `malloc.go` — the Go team wrote a great inline tutorial.

</details>

**Extension.** Read `runtime/mcache.go`'s `nextFree`. Trace a 100-byte allocation through cache hit, miss, and heap grow.

---

### Task 19: Verify channel send happens-before receive

**Goal.** Read `runtime/chan.go`'s `chansend` and `chanrecv`. Identify exactly where the memory barrier ("happens-before") is enforced.

**Difficulty.** Senior

**Skills.** Go memory model, channel implementation, memory ordering primitives.

**Steps.**

1. Open `runtime/chan.go`. Find `chansend1` (the entry) and follow it to `chansend`.
2. For a *send to a waiting receiver*: trace through `runqput` and the receiver's resumption via `gopark` → `goready`.
3. Note where the data copy happens. Note where the lock is taken/released.
4. Open the [Go memory model](https://go.dev/ref/mem). Find "Channel communication". Quote the relevant clause.

**Acceptance criteria.**

- The two functions identified by file:line.
- The hchan.lock acquire/release pair identified.
- One sentence: which event happens-before which? Specifically: a send completes before the corresponding receive returns.

<details><summary>Hints</summary>

- `hchan.lock` is the mutex around the channel. All structural changes (queue head/tail, sudog enqueue) happen under it.
- For a *direct send* (receiver waiting in `recvq`): `chansend` calls `send()` which directly memcpys into the receiver's stack slot, then calls `goready` on the receiver.
- The memory model says: "the kth receive on a channel with capacity C is synchronized before the completion of the (k+C)th send on that channel."

</details>

<details><summary>Reference solution</summary>

Direct-send fast path (sender finds a waiting receiver):

```
chansend(c *hchan, ep unsafe.Pointer, block bool, ...) bool
    lock(&c.lock)                          // acquire hchan.lock
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep, ...)               // direct copy
        unlock(&c.lock)
        return true
    }
    // else: buffered/blocking case ...

send(c *hchan, sg *sudog, ep unsafe.Pointer, ...)
    typedmemmove(c.elemtype, sg.elem, ep)  // copy into receiver's stack
    goready(sg.g, ...)                     // unpark receiver
```

WHERE IS HAPPENS-BEFORE?

`hchan.lock` acquire/release is the sync point. Go memory model: "the
kth receive on a channel of capacity C happens before completion of
the (k+C)th send."

Unbuffered (C=0): send acquires lock, copies into receiver's stack,
calls goready (sequential-consistency barrier). Receiver eventually
acquires the same lock briefly in `chanrecv`'s mirror code — publishes
the data.

Buffered: each slot owned exclusively by sender (pre-copy) or receiver
(post-copy). Lock release after copy publishes; receiver's lock
acquire re-syncs.

Key insight: the LOCK is the synchronization primitive. The data copy
needs no atomic because it's protected.

Source: `runtime/chan.go:chansend` (~165), `send` (~288), `chanrecv`
(~454). Memory model: https://go.dev/ref/mem#chan.
```

Channels aren't magic; they're "a mutex plus a queue, with the runtime knowing how to park goroutines on the queue". The happens-before guarantee comes from the mutex.

</details>

**Extension.** Read `select.go`. How does a `select` statement coordinate happens-before across multiple channels? (Answer: a single lock-all-channels-in-address-order phase.)

---

### Task 20: Build a tiny goroutine inspector

**Goal.** Build a tool that prints, for every live goroutine, its ID, state, function, and the file:line of where it's blocked. Use `runtime.Stack` plus parsing.

**Difficulty.** Middle

**Skills.** `runtime.Stack`, parsing the stack-trace format, reading `runtime/mprof.go`.

**Setup / starter code.**

```go
package main

import (
    "fmt"
    "runtime"
)

func DumpGoroutines() string {
    buf := make([]byte, 1<<20) // 1 MB
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

**Steps.**

1. Run `runtime.Stack(buf, true)` to capture all goroutine stacks.
2. The format is documented in `runtime/mprof.go` and `runtime/traceback.go`. Each goroutine block starts with `goroutine N [state]:`.
3. Parse the output. Extract: ID, state, top frame function, file:line of the second line of the top frame.
4. Print in a clean tabular format.

**Acceptance criteria.**

- Tabular output: `ID | STATE | TOP_FUNC | FILE:LINE`.
- Works on a test program that has 5+ goroutines in different states (running, chan receive, chan send, sleep).
- Source-cited: where does the runtime print `goroutine N [state]:` from?

<details><summary>Hints</summary>

- The runtime function that formats stacks is `runtime/traceback.go`'s `traceback1` ultimately.
- Each goroutine has lines like:
  ```
  goroutine 17 [chan receive]:
  main.worker(...)
          /home/x/main.go:42 +0x1c
  ```
- Use `bufio.Scanner` with regex `^goroutine (\d+) \[([^\]]+)\]:`.

</details>

<details><summary>Reference solution</summary>

```go
// goinspect.go — pretty-print all live goroutines.
package main

import (
    "bufio"
    "fmt"
    "os"
    "regexp"
    "runtime"
    "strings"
    "sync"
    "text/tabwriter"
    "time"
)

type goInfo struct{ ID, State, TopFunc, Location string }

var headerRE = regexp.MustCompile(`^goroutine (\d+) \[([^\]]+)\]:$`)

func DumpGoroutines() []goInfo {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)

    var out []goInfo
    var cur *goInfo
    afterFunc := false

    scanner := bufio.NewScanner(strings.NewReader(string(buf[:n])))
    scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
    for scanner.Scan() {
        line := scanner.Text()
        if m := headerRE.FindStringSubmatch(line); m != nil {
            if cur != nil { out = append(out, *cur) }
            cur = &goInfo{ID: m[1], State: m[2]}
            afterFunc = false
            continue
        }
        if cur == nil { continue }
        if cur.TopFunc == "" && line != "" {
            cur.TopFunc = strings.SplitN(line, "(", 2)[0]
            afterFunc = true
            continue
        }
        if afterFunc {
            cur.Location = strings.TrimSpace(line)
            afterFunc = false
        }
    }
    if cur != nil { out = append(out, *cur) }
    return out
}

func main() {
    ch := make(chan int)
    go func() { <-ch }()
    go func() { time.Sleep(time.Hour) }()
    go func() { for { runtime.Gosched() } }()
    go func() {
        m := sync.Mutex{}
        m.Lock()
        go func() { time.Sleep(time.Hour); m.Unlock() }()
        m.Lock()
    }()
    time.Sleep(50 * time.Millisecond)

    tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
    fmt.Fprintln(tw, "ID\tSTATE\tTOP_FUNC\tLOCATION")
    for _, g := range DumpGoroutines() {
        fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", g.ID, g.State, g.TopFunc, g.Location)
    }
    tw.Flush()
    close(ch)
}
```

Sample output:

```
ID  STATE             TOP_FUNC                                  LOCATION
1   running           main.main                                 .../main.go:69
17  chan receive      main.main.func1                           .../main.go:42 +0x32
18  sleep             time.Sleep                                .../time/sleep.go:195
19  runnable          main.main.func3                           .../main.go:46 +0x12
20  semacquire        sync.(*Mutex).Lock                        .../sync/mutex.go:90
21  sleep             time.Sleep                                .../time/sleep.go:195
```

Source citations:

- `runtime/traceback.go`'s `traceback1` formats individual stacks.
- `runtime/mprof.go`'s `goroutineProfileWithLabels` is the variant pprof uses.
- The header line format `goroutine N [state]:` is emitted in `runtime/traceback.go` around line ~1100.

</details>

**Extension.** Build a "stuck goroutine detector": dump every 5 seconds and flag goroutines whose state hasn't changed in 30 seconds. Practical use: catching deadlocks in long-running services.

---

### Task 21: Profile-guided scheduler tweaks

**Goal.** Build a benchmark that's measurably affected by `GOGC` and `GODEBUG=gctrace=1`. Adjust GOGC. Read the relevant lines in `runtime/mgc.go`.

**Difficulty.** Senior

**Skills.** `GOGC`, `GODEBUG=gctrace`, mgc.go reading, balancing throughput vs latency.

**Setup / starter code.**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func churn(n int) {
    for i := 0; i < n; i++ {
        _ = make([]byte, 1024)
    }
}

func main() {
    start := time.Now()
    for i := 0; i < 1000; i++ {
        churn(10_000)
    }
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("elapsed=%s NumGC=%d PauseTotalNs=%d\n",
        time.Since(start), m.NumGC, m.PauseTotalNs)
}
```

**Steps.**

1. Run normally. Note elapsed time, NumGC.
2. Run with `GOGC=50 go run main.go` — more GC, less heap.
3. Run with `GOGC=400 go run main.go` — less GC, more heap.
4. Run with `GODEBUG=gctrace=1 go run main.go` to see each GC cycle.
5. Open `runtime/mgc.go`. Find `gcSetTriggerRatio` or `gcControllerState.triggerRatio`.

**Acceptance criteria.**

- Three timing measurements with different GOGC values.
- A line of `gctrace=1` output annotated.
- Source citation in `runtime/mgc.go` for where the trigger ratio is consulted.

<details><summary>Hints</summary>

- `gctrace=1` output: `gc N @T.Ts E%: a+b+c ms clock, d+e+f ms cpu, H1->H2->H3 MB, H4 MB goal, P P`.
- GOGC is the percentage *increase* in live heap that triggers GC. GOGC=100 (default) means "GC when heap doubles since last collection".
- `runtime/mgc.go`'s `gcController.heapGoal` computes the next trigger size based on GOGC and current live heap.

</details>

<details><summary>Reference solution</summary>

```bash
$ GOGC=100 go run main.go
elapsed=2.31s NumGC=43 PauseTotalNs=18452103

$ GOGC=50 go run main.go
elapsed=2.74s NumGC=86 PauseTotalNs=29317201

$ GOGC=400 go run main.go
elapsed=2.05s NumGC=11 PauseTotalNs=4291300

$ GODEBUG=gctrace=1 go run main.go 2>&1 | head -3
gc 1 @0.012s 0%: 0.018+1.2+0.014 ms clock, 0.22+0.78/1.1/0.0+0.17 ms cpu, 4->4->1 MB, 4 MB goal, 12 P
gc 2 @0.023s 1%: 0.018+0.89+0.011 ms clock, ...
gc 3 @0.045s 1%: 0.018+1.3+0.012 ms clock, ...
```

Annotation of one line:

```
gc 1 @0.012s 0%:                          GC cycle 1, at t=0.012s, used 0% of CPU for GC
0.018 + 1.2 + 0.014 ms clock              STW mark prep + concurrent mark + STW mark term
0.22 + 0.78/1.1/0.0 + 0.17 ms cpu         per-stage CPU time (sums across cores)
4 -> 4 -> 1 MB                            heap-before -> heap-after-mark -> heap-after-sweep
4 MB goal                                 next GC will be triggered when heap reaches 4 MB
12 P                                      GOMAXPROCS
```

Trade-off:

- `GOGC=50`: GC fires every 50% heap growth. 2x as many GCs, lower peak memory, more pause time aggregate.
- `GOGC=100`: balanced default.
- `GOGC=400`: GC fires every 4x heap growth. Far fewer GCs, but heap balloons. Worst-case STW pause goes up (more to scan).
- `GOGC=off`: no automatic GC; only `runtime.GC()` calls.

Source citation: `runtime/mgc.go`'s `gcSetTriggerRatio` (~line 200 in go1.22) reads `gcController.gcPercent` (which is what GOGC sets) and computes the next-trigger heap size.

For modern workloads with predictable memory bounds, see also `GOMEMLIMIT` (Go 1.19+) — sets an absolute upper bound rather than a ratio. Documented in `runtime/mgcpacer.go`'s memory-limit goal calculation.

</details>

**Extension.** Set `GOMEMLIMIT=100MiB` for the churn program. What happens to NumGC compared to GOGC-only tuning?

---

### Task 22: Walk `panic` through the runtime

**Goal.** Trace what happens when `panic("boom")` runs. Identify each function called in `runtime/panic.go` and the role of `_defer` chains.

**Difficulty.** Senior

**Skills.** panic/recover/defer source reading, stack unwinding mechanics.

**Steps.**

1. Open `runtime/panic.go`. Find `gopanic` (the entry point — compiler-generated calls to it implement `panic(...)`).
2. Find `_panic` (the struct) and `_defer` (the deferred-call struct).
3. Trace: `gopanic` → runs deferred calls → if uncaught → `fatalpanic` → `crash`.
4. Find where `recover()` cancels the panic: `gorecover`.
5. Write a 15-line writeup.

**Acceptance criteria.**

- Three functions identified by file:line: `gopanic`, `gorecover`, `fatalpanic`.
- Description of the `_defer` linked list (per-G, head at `g._defer`).
- A note: why does `recover()` only work in a deferred function?

<details><summary>Hints</summary>

- `g._defer` is a singly-linked list. Each `defer` statement allocates (or stack-allocates) a `_defer` and pushes it onto the head.
- `gopanic` walks the list, calling each deferred function. If one calls `recover()`, it grabs the current `_panic` and marks it as recovered.
- `recover()` only works inside a deferred call because `gorecover` checks if the *immediate caller* is currently being processed by `gopanic`.

</details>

<details><summary>Reference solution</summary>

```
PANIC/RECOVER WALK (go1.22.3, runtime/panic.go):

ENTRY: gopanic(e interface{}) — panic.go:700
  1. Allocate _panic on stack; link onto g._panic (panics nest).
  2. Iterate g._defer from head:
       - Pop each _defer; call its function (may run recover()).
       - If recovered: jump to deferreturn, unwind normally.
  3. If no recovery: call fatalpanic.

RECOVER: gorecover(argp uintptr) — panic.go:1090
  Checks if caller's frame matches the currently-executing deferred
  call. If yes, marks _panic.recovered = true. gopanic then stops
  iterating and returns normally.

FATAL: fatalpanic(msgs *_panic) — panic.go:1208
  Prints panic chain, all goroutine stacks, calls abort() (SIGABRT).

_defer STRUCT (runtime2.go):
  type _defer struct {
      started, heap bool
      sp, pc        uintptr
      fn            func()
      link          *_defer
  }

PER-G CHAIN: g._defer is the most-recent defer (LIFO). New defers
prepend; gopanic walks head→tail.

WHY recover() ONLY WORKS IN A DEFERRED FUNCTION:
  gorecover checks caller's SP against the frame gopanic is
  CURRENTLY processing. Non-deferred code's frame isn't on the
  active defer chain — check fails, returns nil.

STACK ALLOCATION (since 1.13): most defers are stack-allocated
(_defer.heap=false), avoiding heap alloc per defer. Falls back to
heap when defer is in a loop. See deferprocStack vs deferproc.
```

</details>

**Extension.** Write a benchmark comparing `defer mu.Unlock()` cost in go1.13, 1.14, and 1.22. The defer cost dropped dramatically across versions due to stack allocation and inlining of the simple-case defer.

---

## Grading yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (unaided), `3` (you found something the reference solution didn't mention — a wrong line number, a clearer explanation, a counterexample). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You've been reading *about* the runtime but not opening it. Re-read junior.md. Spend a day in `proc.go` with `grep` and a notebook. Tasks 1–3 are the only ones you must absolutely finish before middle.md makes sense. |
| 16–28 | Comfortable navigating the source. You can find `schedule`, `findRunnable`, `mallocgc`. The next jump is *predicting* what the source will say before reading. Re-attempt Tasks 9–11 without hints. |
| 29–44 | Senior. You can answer "where does X happen in the runtime?" without grepping. Tasks 12–18 should drive home that the runtime is *editable*, that you can extract any internal you want via `go:linkname`, and that you'd better know exactly why before doing so. |
| 45–66 | Staff. You can read a runtime diff between two Go releases and explain the motivation. You've started thinking about the runtime as a *system* (preemption + GC + scheduler are coupled). Move on to 02-scheduler-source for the full deep dive. |

Concrete checks worth running:

- Task 1: your line numbers will differ from this file's reference. That's fine — the *callers* should not differ much.
- Task 4: if you OOM at 1M goroutines, you have less than 4 GB free. Lower to 500_000; the per-G math still works.
- Task 6: never use the hchan reader in production. If you do, add a build tag `//go:build go1.22 && !go1.23` so it refuses to compile under unsupported versions.
- Task 8: scheduling latencies under 1 µs likely mean you didn't actually trigger contention. Add more concurrent goroutines.
- Task 11: if your `asyncpreemptoff=1` run completes, you're on a Go version older than 1.14, or `GOMAXPROCS != 1`, or your loop has a hidden function call (a print? a channel op?). Look harder.
- Task 13: skipping the proposal and just paraphrasing this file's reference is the easy mode. Read the proposal.
- Task 22: writing a panic that's caught by a recover in the *same function* as the panic must not work. Verify: it doesn't.

The most important question is not *did you finish* — it's *can you, given a 200-line runtime function you've never seen, predict its rough structure from its name and the surrounding file?* When `runtime/sema.go`'s `semacquire` reads instantly as "park-on-condition"; when `runtime/lock_futex.go`'s functions click as "Linux-specific OS lock"; when `runtime/symtab.go` reads as "the PCDATA tables this whole runtime depends on" — you have the navigation skill. The rest is mileage.

---

## Stretch challenges

**S1 — Trace replay.** Build a tool that takes a `trace.out` file and reconstructs the timeline of one specific goroutine: every state transition, every event, every reason. Use `golang.org/x/exp/trace`. Verify against `go tool trace`'s built-in goroutine analysis view.

**S2 — Patch the runtime.** Clone the Go source, modify `runtime/proc.go`'s `findRunnable` to print a counter every 1000 calls. Rebuild the toolchain (`./make.bash`). Run a small Go program with your custom toolchain. Confirm your counter appears. Lesson: the runtime is regular Go — you can edit and rebuild it like any other package.

**S3 — Implement a userspace scheduler in Go.** Write a tiny cooperative scheduler in pure Go that schedules "fibers" (closures) across a fixed pool of goroutines, using channels as work queues. Compare its throughput and latency against using `go f()` directly for the same workload. The point: the runtime's scheduler is doing real work, and recreating even a poor approximation teaches you what that work is.
