# Scheduler Source — Practice Tasks

Twenty-three exercises to build operator intuition for the Go scheduler. The goal is not to memorise `runtime/proc.go` line numbers; it is to develop the reflex of asking "what state are M, P, and G actually in?" whenever a program behaves oddly under load. Difficulty: **J**unior, **M**iddle, **S**enior, **Staff**.

Each task gives a Goal, the Skills it exercises, Setup, Steps, Acceptance criteria, and folded Hints + Reference solution (with runnable Go code, 1.22+). Read `junior.md` first — `schedtrace`, `scheddetail`, `runtime/trace`, and the M:N model are the scaffolding for every exercise that follows.

The exercises are ordered by difficulty, not by topic. Skipping around is fine, but Tasks 1, 4, and 5 should be done before any of the Senior tier so you have somewhere to project the source-reading work back onto.

---

### Task 1: Read GODEBUG schedtrace output

**Goal.** Run a busy program under `GODEBUG=schedtrace=1000` and explain every field on one trace line. The point is not the program; it is to stop being intimidated by the line.

**Difficulty.** Junior

**Skills.** `GODEBUG`, scheduler vocabulary (P, M, G, runq, idle).

**Setup.** Go 1.22+, a terminal. No third-party deps.

**Steps.**
1. Write a program that spawns 200 goroutines each doing a 100 ms CPU loop.
2. Run with `GODEBUG=schedtrace=1000 GOMAXPROCS=4 go run main.go`.
3. Capture one full trace line. Identify, with one sentence each: `gomaxprocs`, `idleprocs`, `threads`, `spinningthreads`, `idlethreads`, `runqueue` (global runq length), and the per-P runq lengths after the bracket.
4. Re-run with `GOMAXPROCS=1`. Note which fields change shape.

**Acceptance criteria.**
- You can predict, before re-running, which fields will be larger and which smaller when `GOMAXPROCS` halves.
- You can explain why `runqueue` (global) is often `0` on a healthy program and what it means when it grows.

<details><summary>Hints</summary>

- The format is documented as a comment in `runtime/proc.go` — search for `schedtrace`. Don't read it yet; predict, then check.
- `spinningthreads` is the count of Ms actively looking for work — high `spinningthreads` with empty runqs is wasted CPU.
- Per-P numbers are *local* runq lengths. A spike there with `runqueue=0` (global) means work is parallelisable but one P got handed too much.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — run with: GODEBUG=schedtrace=1000 GOMAXPROCS=4 go run main.go
package main

import (
	"sync"
	"time"
)

func busy(d time.Duration) {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		// burn CPU; tight loops without function calls used to
		// defeat preemption pre-1.14. Task 10 demonstrates that.
		_ = 1 + 1
	}
}

func main() {
	const N = 200
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			busy(100 * time.Millisecond)
		}()
	}
	wg.Wait()
}
```

Annotated line (your numbers will differ):

```
SCHED 1003ms: gomaxprocs=4 idleprocs=0 threads=7 spinningthreads=0 idlethreads=2 runqueue=12 [38 41 39 40]
```

- `gomaxprocs=4` — schedulable Ps (the cap on parallel user goroutines).
- `idleprocs=0` — no P is parked; every CPU is busy. Healthy under load.
- `threads=7` — total OS threads the runtime has ever created (does not shrink). Includes sysmon and template threads.
- `spinningthreads=0` — no M is in the spin-for-work phase. Spinning costs CPU; large numbers under steady state mean misconfigured `GOMAXPROCS` or work-arrival jitter.
- `idlethreads=2` — Ms parked on `m.park`. Cheap; the runtime keeps a small pool to avoid `clone(2)` latency.
- `runqueue=12` — *global* runq. Drains when local runqs empty. Persistently non-zero means many wakeups per unit time and local runqs are saturated.
- `[38 41 39 40]` — per-P local runqs. Tight clustering = balanced; one large + three small = work-stealing about to fire.

Halving `GOMAXPROCS` to 2: per-P lengths roughly double, `gomaxprocs=2`, and the program takes ~2× wall time on a CPU-bound workload. That's the experiment that makes the model concrete.

</details>

---

### Task 2: GOMAXPROCS scan on CPU-bound work

**Goal.** Quantify the speedup curve of a perfectly parallel CPU-bound workload across `GOMAXPROCS ∈ {1, 2, 4, 8}`. Discover that "twice the Ps" is not "twice the throughput" on real hardware.

**Difficulty.** Junior

**Skills.** `GOMAXPROCS`, `time.Since`, basic benchmarking discipline.

**Setup.** Quiet machine (no Slack, no compilation), Go 1.22+.

**Steps.**
1. Write a workload that sums `1..1e9` integers split across N workers.
2. Drive `GOMAXPROCS` via env or `runtime.GOMAXPROCS(n)` and run each setting three times. Record min wall time (median is fine, min discards GC jitter).
3. Plot or tabulate: P, wall-time, speedup-vs-P=1.
4. Explain the curve: where does it bend, and why?

**Acceptance criteria.**
- Speedup at P=2 is ≥1.7×; at P=8 on an 8-core machine is somewhere between 5× and 7×, never 8×.
- You name at least two reasons for the sublinear scaling (cache contention, memory bandwidth, hyper-threading, runtime overhead).

<details><summary>Hints</summary>

- Don't share a single accumulator across goroutines or you'll measure mutex/atomic contention, not parallelism.
- Set the workload large enough (~1–3 s at P=1) so GC and scheduler init don't dominate the measurement.
- `runtime.GOMAXPROCS` returns the *previous* value — handy for restoring.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

func sumChunk(start, end uint64) uint64 {
	var s uint64
	for i := start; i < end; i++ {
		s += i
	}
	return s
}

func parallelSum(N uint64, workers int) uint64 {
	chunk := N / uint64(workers)
	parts := make([]uint64, workers)
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		w := w
		go func() {
			defer wg.Done()
			start := uint64(w) * chunk
			end := start + chunk
			if w == workers-1 {
				end = N
			}
			parts[w] = sumChunk(start, end)
		}()
	}
	wg.Wait()
	var total uint64
	for _, p := range parts {
		total += p
	}
	return total
}

func main() {
	const N = uint64(1e9)
	for _, p := range []int{1, 2, 4, 8} {
		runtime.GOMAXPROCS(p)
		var best time.Duration
		for run := 0; run < 3; run++ {
			t := time.Now()
			_ = parallelSum(N, p)
			d := time.Since(t)
			if run == 0 || d < best {
				best = d
			}
		}
		fmt.Printf("P=%d  best=%v\n", p, best)
	}
}
```

Typical numbers on an M2 Pro 10-core:

```
P=1  best=1.180s
P=2  best=0.612s   (1.93x)
P=4  best=0.330s   (3.58x)
P=8  best=0.215s   (5.49x)
```

The bend between P=4 and P=8 on this CPU is the move from physical cores to efficiency cores plus shared L2. On an x86 with hyper-threading the same bend appears between physical-thread count and logical-thread count. The Go scheduler's job is to put a runnable G on every P; what those Ps can actually *do* in parallel is a property of the silicon, not the runtime.

</details>

---

### Task 3: Cooperative scheduling with Gosched

**Goal.** Demonstrate that `runtime.Gosched` voluntarily yields the current G back to the scheduler. Verify with `runtime.NumGoroutine`.

**Difficulty.** Junior

**Skills.** `runtime.Gosched`, `runtime.NumGoroutine`, mental model of "runnable vs running".

**Setup.** Go 1.22+, `GOMAXPROCS=1` to make the effect deterministic.

**Steps.**
1. With `GOMAXPROCS=1`, start a goroutine that prints "A" 5 times, then another that prints "B" 5 times.
2. Without `Gosched`, observe A finishes fully before B starts (or vice versa).
3. Add `runtime.Gosched()` inside each loop. Observe interleaving.
4. Use `runtime.NumGoroutine()` at the start, middle, and end of `main`. Predict the values; verify.

**Acceptance criteria.**
- You can articulate why `GOMAXPROCS=1` matters for the demonstration (one P, no parallel runner to confuse the picture).
- You can explain why `NumGoroutine` is `2` and not `3` mid-program (the goroutines you started, plus *the* main goroutine itself).

<details><summary>Hints</summary>

- `runtime.Gosched` moves the current G from "running" to the *back* of the local runq — it is not a sleep. The next runnable G runs immediately.
- Don't confuse `Gosched` with `time.Sleep(0)`. They behave similarly but `Sleep(0)` goes through the timer wheel; `Gosched` does not.
- Modern Go (1.14+) preempts long-running goroutines anyway. The Gosched experiment is most striking on `GOMAXPROCS=1` with very tight loops.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

func main() {
	runtime.GOMAXPROCS(1)
	fmt.Println("start NumGoroutine =", runtime.NumGoroutine()) // 1

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			fmt.Println("A", i)
			runtime.Gosched() // hand the P to whoever's next
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			fmt.Println("B", i)
			runtime.Gosched()
		}
	}()

	// Senior decision: we measure NumGoroutine BEFORE wg.Wait runs
	// or we'd just see "1" again. Schedule the print on the runq.
	go func() {
		fmt.Println("mid  NumGoroutine =", runtime.NumGoroutine())
	}()

	wg.Wait()
	fmt.Println("end  NumGoroutine =", runtime.NumGoroutine()) // 1
}
```

Sample output (interleaving will vary slightly):

```
start NumGoroutine = 1
A 0
B 0
mid  NumGoroutine = 4
A 1
B 1
...
end  NumGoroutine = 1
```

Without `Gosched` and at `GOMAXPROCS=1`, you'll usually see `A 0..A 4` followed by `B 0..B 4` — the first G owns the P until it returns. With Gosched, they alternate. Above `GOMAXPROCS=2`, the Gosched is largely cosmetic because both Gs have their own P.

</details>

---

### Task 4: Read GODEBUG scheddetail output

**Goal.** Run with `GODEBUG=scheddetail=1,schedtrace=1000` and parse a *single* per-P / per-M / per-G line. Move from "I see a wall of text" to "I can find the G that's stuck".

**Difficulty.** Middle

**Skills.** `GODEBUG`, `runtime` data structures (M, P, G), goroutine states.

**Setup.** Go 1.22+, a long-running program (one that creates 50+ goroutines and runs for ≥5 s).

**Steps.**
1. Run your favourite long-lived test program with `GODEBUG=scheddetail=1,schedtrace=1000 GOMAXPROCS=4`.
2. Capture one full trace block (it'll be ~50–200 lines).
3. Pick one line from each: a `P` line, an `M` line, a `G` line. Annotate every field.
4. Find one G in state `Gwaiting`. Identify the `waitreason` and the file:line in the goroutine's stack.

**Acceptance criteria.**
- You can name at least five goroutine states from `runtime/runtime2.go` (Gidle, Grunnable, Grunning, Gsyscall, Gwaiting, Gdead).
- Given a `G` line, you can find the `m=` field and cross-reference it to the `M` block.
- You understand why the same G might appear with a different `m=` between dumps (Gs migrate between Ms via the runq).

<details><summary>Hints</summary>

- The source of truth is the comment block above `schedtrace`/`scheddetail` in `runtime/proc.go`. Read it once and bookmark.
- `G` lines look like `G%d: status=%d(%s) m=%d lockedm=%d`. Status integers correspond to constants in `runtime2.go` — they're labelled in human form right next to the integer.
- `waitreason` is the most useful field for debugging real systems: "select", "chan receive", "GC assist wait", "GC worker (idle)", "semacquire", etc. Each has a different fix.

</details>

<details><summary>Reference solution</summary>

A real `scheddetail=1` block (trimmed):

```
SCHED 5012ms: gomaxprocs=4 ...
  P0: status=1 schedtick=412 syscalltick=18 m=0 runqsize=2 gfreecnt=4
  P1: status=0 schedtick=399 syscalltick=22 m=2 runqsize=0 gfreecnt=3
  ...
  M0: p=0 curg=14 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false ...
  M2: p=1 curg=27 ...
  ...
  G1: status=4(chan receive) m=-1 lockedm=-1
  G14: status=2() m=0 lockedm=-1
  G27: status=2() m=2 lockedm=-1
  G33: status=4(GC assist wait) m=-1 lockedm=-1
```

Reading row by row:

- `P0: status=1` — `_Prunning`. `schedtick`/`syscalltick` are monotonic counters incremented on each schedule/syscall; useful to confirm a P isn't stuck. `m=0` says M0 is currently bound to P0. `runqsize=2` is the local runq depth. `gfreecnt=4` is cached free-G slots, an allocation fast path.
- `M0: p=0 curg=14` — M0's currently running G is G14. `mallocing=0` and `locks=0` confirm M0 is not in a "do not preempt" region. `spinning=false` says M0 has work and isn't scanning for more.
- `G1: status=4(chan receive) m=-1` — the main G, blocked on a channel. `m=-1` because parked Gs aren't bound to an M.
- `G14: status=2()` — `_Grunning`, currently on M0. The empty parens are normal for running Gs (no wait reason).
- `G33: status=4(GC assist wait)` — a user G that got drafted into GC mark-assist and is blocked. If you see many of these, you have GC pressure (see Task 22).

The trick for production: pipe `scheddetail` output into `grep "status=4("` and bucket the wait reasons. The histogram tells you what your program is *actually* waiting on, which is rarely what you assumed.

</details>

---

### Task 5: Capture and read a runtime/trace

**Goal.** Record a `runtime/trace` of a small program and identify `GoCreate`, `GoStart`, `GoStop`, and `GoBlock` events in the timeline view. The point is to see scheduler events as a picture, not text.

**Difficulty.** Middle

**Skills.** `runtime/trace`, `go tool trace`, browser-based timeline analysis.

**Setup.** Go 1.22+, a browser, a program that does a mix of compute and I/O for ≥1 s.

**Steps.**
1. Wrap your program's body in `trace.Start(os.Create("trace.out"))` / `defer trace.Stop()`.
2. Run it. Open with `go tool trace trace.out`.
3. In the "Goroutine analysis" view, pick a goroutine and find its `GoCreate`, `GoStart`, `GoStop`, and `GoBlock` markers.
4. Identify one stretch where a P is idle while at least one G is runnable. (You usually won't find it in a healthy program — that's the lesson.)

**Acceptance criteria.**
- You can navigate to the timeline view, zoom in to a 10 ms window, and name every event row.
- You can articulate the difference between `GoBlock` (waiting on channel/lock) and `GoSysBlock` (waiting on syscall).
- You took one screenshot of the "Network blocking profile" or "Synchronization blocking profile" view and explained one entry.

<details><summary>Hints</summary>

- `go tool trace` runs a local HTTP server. Open the URL it prints; if Chrome blocks the trace viewer due to size, run `go tool trace -http=:8080 trace.out`.
- The default view is dense. Use the "View trace" link and zoom with W/S (in/out) and A/D (left/right). The keymap is on the page.
- `runtime/trace` is heavier than `pprof` (~10–30% overhead). Don't leave it on in production; do leave it on a `pprof`-style endpoint for opt-in collection.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go && go tool trace trace.out
package main

import (
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime/trace"
	"sync"
	"time"
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

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Millisecond) // simulate downstream
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return
			}
			resp.Body.Close()
			// CPU spike
			s := 0
			for j := 0; j < 1_000_000; j++ {
				s += j
			}
			_ = s
		}(i)
	}
	wg.Wait()
}
```

In `go tool trace`:

- **Goroutine analysis** shows total wall time per goroutine. The HTTP client Gs are mostly in `Network wait` — that's the kernel doing the work.
- **View trace** shows per-P rows. Look for the saw-tooth where `GoStart` (G begins running) is followed by `GoBlock { reason: select }` (waiting on the HTTP response), then `GoUnblock` and another `GoStart`. The vertical gap between blocks is your scheduling latency.
- **Network blocking profile** shows the call stacks that produced `GoBlock { network }`. In our example it's `http.(*Client).Do`.

The teach moment: you'll see a sliver of P-idle time even in this saturated example. That's the cost of `findRunnable` plus work-stealing latency. On a healthy program it's <1% of wall time. Above 10% means you have starvation (Task 9).

</details>

---

### Task 6: Instrument a region with runtime/trace

**Goal.** Use `trace.NewTask` + `trace.WithRegion` to annotate a specific code path. Measure the *scheduling* latency between region start and the first goroutine event inside it.

**Difficulty.** Middle

**Skills.** `runtime/trace` user APIs, custom annotations, tracelog interpretation.

**Setup.** Go 1.22+, the trace setup from Task 5.

**Steps.**
1. Pick a critical path (e.g., a request handler).
2. Wrap it in a `Task` via `trace.NewTask(ctx, "handle")` and a `Region` via `trace.WithRegion(ctx, "db", fn)`.
3. Run with tracing. Open the "User-defined tasks" view in `go tool trace`.
4. Compare the task's wall time to the sum of its regions' wall times. The gap is scheduling + setup.

**Acceptance criteria.**
- Your `trace.out` shows a labelled "handle" task with one or more "db" / "cpu" regions.
- You can locate the same task in both the "User-defined tasks" tab and the timeline tab.
- You can articulate why `task wall time > sum of regions`: time spent runnable-but-not-running, or in untraced code.

<details><summary>Hints</summary>

- `trace.NewTask` returns a `*trace.Task` and a derived context. Pass the context down to the call you want to annotate.
- Regions must be nested correctly — `defer region.End()`. Or use the helper `trace.WithRegion(ctx, "name", func(){ ... })`.
- `trace.Log(ctx, "k", "v")` adds structured events that show up in the timeline. Cheap and useful.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go && go tool trace trace.out
package main

import (
	"context"
	"log"
	"os"
	"runtime/trace"
	"sync"
	"time"
)

func dbCall(ctx context.Context) {
	defer trace.StartRegion(ctx, "db").End()
	time.Sleep(8 * time.Millisecond)
}

func cpuWork(ctx context.Context) {
	defer trace.StartRegion(ctx, "cpu").End()
	s := 0
	for i := 0; i < 5_000_000; i++ {
		s += i
	}
	_ = s
}

func handle(ctx context.Context, id int) {
	ctx, task := trace.NewTask(ctx, "handle")
	defer task.End()
	trace.Log(ctx, "request_id", "req-"+itoa(id))
	dbCall(ctx)
	cpuWork(ctx)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	n := len(b)
	for i > 0 {
		n--
		b[n] = byte('0' + i%10)
		i /= 10
	}
	return string(b[n:])
}

func main() {
	f, _ := os.Create("trace.out")
	defer f.Close()
	if err := trace.Start(f); err != nil {
		log.Fatal(err)
	}
	defer trace.Stop()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			handle(context.Background(), i)
		}(i)
	}
	wg.Wait()
}
```

In `go tool trace` → **User-defined tasks**:

```
Task         Count  Total time  Average
handle       50     ~520 ms     ~10.4 ms

Region       Count  Total time  Average
db           50     ~400 ms     ~8 ms
cpu          50     ~95 ms      ~1.9 ms
```

Per-task wall time ≈ 10.4 ms; sum of regions ≈ 9.9 ms. The 500 µs gap per request is scheduling overhead: time the G spent in `_Grunnable` between the syscall return (`Sleep` is one) and the next `GoStart`. Under heavy oversubscription that gap grows; under low load it's roughly constant. Charting "task wall − Σ regions" over time is one of the cheapest ways to spot scheduler pressure in a real service.

</details>

---

### Task 7: Pin a goroutine with LockOSThread

**Goal.** Use `runtime.LockOSThread` to bind a goroutine to a single OS thread; verify with the Linux `gettid` syscall (or `pthread_self` on macOS) that the thread ID does not change across iterations.

**Difficulty.** Middle

**Skills.** `runtime.LockOSThread`, cgo or `syscall.Syscall`, M:N model.

**Setup.** Go 1.22+, Linux (preferred — `gettid` is straightforward) or macOS with `pthread_self`.

**Steps.**
1. Write a goroutine that loops 1000 times calling `gettid` (Linux) or `pthread_threadid_np` (macOS) and recording the result.
2. First run without `LockOSThread`: confirm the thread ID changes occasionally.
3. Add `runtime.LockOSThread()` at the top of the goroutine, `defer runtime.UnlockOSThread()`. Re-run.
4. Verify all 1000 reads return the same TID.

**Acceptance criteria.**
- Without lock: TID may change between iterations (it usually won't on an idle machine, but the test must allow for it).
- With lock: TID is invariant.
- You can name two reasons to `LockOSThread`: OpenGL / GLFW contexts, and any C library that uses thread-local storage (`setlocale`, `errno` in some libcs, OpenSSL pre-1.1, signal masks).

<details><summary>Hints</summary>

- On Linux: `syscall.Syscall(syscall.SYS_GETTID, 0, 0, 0)`. No imports beyond `syscall`.
- On macOS: cgo into `pthread_threadid_np`, or use `syscall.Syscall(syscall.SYS_THREAD_SELFID, 0, 0, 0)`.
- `LockOSThread` is sticky across function calls but not across goroutines. Forgetting `Unlock` permanently retires the M (it'll never serve another G).

</details>

<details><summary>Reference solution</summary>

```go
//go:build linux

// main.go — go run main.go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"time"
)

func gettid() int {
	t, _, _ := syscall.Syscall(syscall.SYS_GETTID, 0, 0, 0)
	return int(t)
}

func run(lock bool) (changes int, firstTID int) {
	if lock {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
	}
	firstTID = gettid()
	prev := firstTID
	for i := 0; i < 1000; i++ {
		t := gettid()
		if t != prev {
			changes++
			prev = t
		}
		// Force scheduler activity. Without this, the unlocked
		// case might also stay on one thread by luck.
		if i%50 == 0 {
			time.Sleep(time.Microsecond)
		}
	}
	return
}

func main() {
	var wg sync.WaitGroup
	for _, lock := range []bool{false, true} {
		wg.Add(1)
		go func(lock bool) {
			defer wg.Done()
			ch, tid := run(lock)
			fmt.Printf("lock=%v  TID-changes=%d  first-TID=%d\n", lock, ch, tid)
		}(lock)
	}
	wg.Wait()
}
```

Sample output:

```
lock=false  TID-changes=3   first-TID=87642
lock=true   TID-changes=0   first-TID=87645
```

The unlocked goroutine migrated three times in 1000 iterations — that's the runtime relocating it onto a different M after a syscall return or work-steal. The locked goroutine cannot migrate; it owns its M for the lifetime of the lock. Cost: that M is no longer available to run other Gs. Use sparingly.

</details>

---

### Task 8: Reproduce work-stealing

**Goal.** Construct a workload that forces oversubscription on one P; observe via `schedtrace` that other Ps steal half the local runq.

**Difficulty.** Middle

**Skills.** Work-stealing mechanics, runq mental model, `schedtrace` reading.

**Setup.** Go 1.22+, `GOMAXPROCS=4`.

**Steps.**
1. Spawn 16 short CPU-bound goroutines very quickly from one parent. Because the runtime puts a newly-created G on the local runq, the parent's P will pile up.
2. Run with `GODEBUG=schedtrace=200 GOMAXPROCS=4`.
3. Observe the per-P runq pattern: one P large, three small/zero, then stealing levels them.
4. Repeat with `runtime.Gosched()` between `go` statements. Compare.

**Acceptance criteria.**
- You see at least one trace line with an imbalanced pattern like `[16 0 0 0]` followed quickly by `[4 4 4 4]`.
- You can articulate where in `runtime/proc.go` the steal happens (`runqsteal` in `findRunnable`'s loop).
- You can predict what happens at `GOMAXPROCS=1` (no stealing possible; runq stays at 16).

<details><summary>Hints</summary>

- The runtime caps local runqs at 256 (`runtime/proc.go` constant `runqsize`). Past that, half the runq spills to the global runq. Don't accidentally exceed it.
- Work-stealing is *random* — a P with empty runq picks a victim at random, halves its runq into its own. Random victim selection avoids contention.
- Each goroutine should be long enough (~1 ms) that the imbalance is visible across `schedtrace=200` boundaries.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — GODEBUG=schedtrace=200 GOMAXPROCS=4 go run main.go
package main

import (
	"runtime"
	"sync"
	"time"
)

func burn(d time.Duration) {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		// burn — function call inside loop is fine post-1.14
	}
}

func main() {
	runtime.GOMAXPROCS(4)
	var wg sync.WaitGroup
	// Fire 16 goroutines from the SAME goroutine in a tight burst.
	// Without yielding, all 16 land on the parent's P local runq.
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			burn(50 * time.Millisecond)
		}()
	}
	wg.Wait()
}
```

Trace excerpt:

```
SCHED 200ms: ... runqueue=0 [12 1 1 1]
SCHED 400ms: ... runqueue=0 [3 3 3 3]
SCHED 600ms: ... runqueue=0 [0 0 0 0]
```

Reading: at 200 ms the spawn-P (P0) still has 12 in its local runq while P1–P3 have ~1 each — work-stealing has fired once, halving from 16 to ~12+4. By 400 ms the runtime has rebalanced to roughly equal. The deeper lesson: stealing isn't a one-shot rebalance. It happens *every time* a P runs out of local work. That's why per-G overhead is so low — the runtime takes one chunk at a time.

</details>

---

### Task 9: Diagnose scheduling latency with pprof + trace

**Goal.** A program that "should be fast" is slow. Use `go tool pprof` (CPU) and `go tool trace` (scheduling) together to localise the cause.

**Difficulty.** Senior

**Skills.** Reading pprof flame graphs, reading trace timelines, distinguishing CPU-bound from scheduler-bound bottlenecks.

**Setup.** Go 1.22+, a small `net/http/pprof`-enabled program.

**Steps.**
1. Write a server with two endpoints: `/fast` (returns immediately) and `/slow` (does 5 ms of CPU work). Drive both at high QPS.
2. Note that p99 of `/fast` exceeds p99 of `/slow` under load. Why?
3. Capture `/debug/pprof/profile?seconds=10` and a `runtime/trace` covering the same window.
4. Use the trace to find idle-P intervals when `/fast` was runnable. Confirm via pprof that those Ps were busy on `/slow`.

**Acceptance criteria.**
- You produce one screenshot or paste showing a `/fast` request with >5 ms `_Grunnable` time in the trace.
- You can articulate why fairness isn't perfect at the goroutine level: until a tight-loop G is preempted (~10 ms), the runnable `/fast` G waits.
- You can name the fix (smaller CPU bursts, preemption points, separate worker pool).

<details><summary>Hints</summary>

- `import _ "net/http/pprof"` and a separate `http.ListenAndServe("localhost:6060", nil)` is the standard setup.
- Drive load with `hey` or `wrk`. `hey -z 10s -c 64 http://localhost:8080/fast` is a one-liner.
- The interesting tab in `go tool trace` is **Scheduler latency profile**. It buckets time-from-runnable-to-running by call stack.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go
//   then: hey -z 10s -c 64 http://localhost:8080/slow & \
//         hey -z 10s -c 64 http://localhost:8080/fast
package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"runtime/trace"
)

func slow(w http.ResponseWriter, r *http.Request) {
	s := 0
	// ~5 ms of cpu on a modern x86. Pre-1.14 this would block
	// the P entirely; post-1.14 it's preemptible every ~10ms.
	for i := 0; i < 20_000_000; i++ {
		s += i
	}
	_ = s
	w.Write([]byte("ok"))
}

func fast(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

func main() {
	go http.ListenAndServe("localhost:6060", nil) // pprof

	// One-shot trace dump for the first 10 s
	f, _ := os.Create("trace.out")
	defer f.Close()
	if err := trace.Start(f); err != nil {
		log.Fatal(err)
	}
	go func() {
		// stop trace after 10 s; let the program keep running
		// without trace overhead afterwards
		<-time.After(10 * time.Second)
		trace.Stop()
	}()

	http.HandleFunc("/slow", slow)
	http.HandleFunc("/fast", fast)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Investigation steps:

1. `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10` — the flame graph shows `slow` dominating. That confirms there's CPU work but doesn't explain `/fast` latency.
2. `go tool trace trace.out` → **Scheduler latency profile**. The top entry shows time spent in `runtime.schedule` waiting to be picked up, with `net/http.(*conn).serve` as the call stack. That's `/fast` requests that arrived runnable but waited.
3. **Goroutine analysis** for one `/fast` G shows: ~30 µs total wall time, ~3 µs running, ~27 µs `_Grunnable`. That's the bottleneck.

Fix candidates:

- Move `slow` to a bounded worker pool so it can't consume all Ps.
- Add explicit `runtime.Gosched()` inside the `slow` loop every N iterations — voluntary preemption is cheaper than the timer interrupt the runtime uses.
- Increase `GOMAXPROCS`. Doesn't fix the model but mitigates contention.

The teaching point is the *workflow*: pprof tells you what's running; trace tells you what *isn't* running but should be.

</details>

---

### Task 10: Demonstrate the pre-1.14 starvation bug

**Goal.** A tight CPU loop with no function calls used to block a single P indefinitely on pre-1.14 Go. Show that on Go 1.22, the runtime preempts it after ~10 ms.

**Difficulty.** Senior

**Skills.** Async preemption (proposal 24543), GC safe-points, history of the runtime.

**Setup.** Go 1.22+. Optional: a Go 1.13 binary in a Docker container for the contrasting bug.

**Steps.**
1. With `GOMAXPROCS=1`, start a goroutine that runs `for {}` (literally — no body, no function calls).
2. Start a second goroutine that prints a tick every 100 ms.
3. On Go 1.13: the tick never fires. The for-loop owns the only P; preemption requires a function call (a stack-growth check) which never happens.
4. On Go 1.22: the tick fires; the runtime uses signal-based async preemption.
5. Confirm with `runtime/metrics` (`/sched/latencies:seconds`) that the second G's max latency is bounded.

**Acceptance criteria.**
- Your output shows the ticker firing on Go 1.22.
- You can describe at a high level what the runtime does: `sysmon` notices a G running >10 ms, sets `g.preempt = true`, sends `SIGURG`, the signal handler arranges for the G to suspend at a safe point.
- You can name the design doc (Go proposal 24543, "Non-cooperative goroutine preemption").

<details><summary>Hints</summary>

- A `for {}` with no body is the canonical demonstrator. `for { _ = 1 }` also works. Anything with a function call (even `runtime.Gosched`) defeats the demo by creating a preemption point.
- `runtime/metrics` reads cheap, no allocation. The histogram `/sched/latencies:seconds` is exactly what you want.
- If you must run pre-1.14 Go, use `golang:1.13` Docker. The same code hangs.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — GOMAXPROCS=1 go run main.go
package main

import (
	"fmt"
	"runtime"
	"runtime/metrics"
	"time"
)

func main() {
	runtime.GOMAXPROCS(1)

	// The hostile goroutine: tight loop, no function calls. On
	// pre-1.14, this owns the P forever. On 1.14+, sysmon notices
	// and signals the M after ~10 ms.
	go func() {
		for {
		}
	}()

	// The witness goroutine: prints a tick every 100 ms. If the
	// tight loop blocks, this never runs. If preemption works,
	// it does.
	go func() {
		t := time.NewTicker(100 * time.Millisecond)
		defer t.Stop()
		for i := 0; i < 10; i++ {
			<-t.C
			fmt.Printf("tick %d at %v\n", i, time.Since(start))
		}
	}()

	time.Sleep(1500 * time.Millisecond)

	// Senior decision: runtime/metrics is the modern, allocation-free
	// way to read scheduler stats. Beats parsing schedtrace strings.
	samples := []metrics.Sample{
		{Name: "/sched/latencies:seconds"},
	}
	metrics.Read(samples)
	h := samples[0].Value.Float64Histogram()
	var p99 float64
	cum, total := uint64(0), uint64(0)
	for _, c := range h.Counts {
		total += c
	}
	for i, c := range h.Counts {
		cum += c
		if float64(cum) >= 0.99*float64(total) {
			p99 = h.Buckets[i+1]
			break
		}
	}
	fmt.Printf("p99 scheduling latency = %.3f ms\n", p99*1000)
}

var start = time.Now()
```

On Go 1.22:

```
tick 0 at 107.4ms
tick 1 at 207.1ms
...
p99 scheduling latency = 10.4 ms
```

On Go 1.13 (in `golang:1.13` Docker):

```
(no output; program hangs until time.Sleep finishes, then exits)
```

The fix (proposal 24543, landed 1.14) is the runtime sending `SIGURG` to the M and using the signal handler to suspend the G at the next safe instruction. Cost: signal-based preemption isn't free (~1 µs per preemption) and slightly complicates GC safe-point tracking. Benefit: the runtime is now fair across pathological user code, and GC stop-the-world phases no longer block waiting for a tight loop to reach a function call. The whole modern scheduler depends on this; without it, much of what `findRunnable` does would be theoretical.

</details>

---

### Task 11: Cost of `go f()` across P counts

**Goal.** Microbenchmark the cost of spawning a goroutine that does nothing. Sweep `GOMAXPROCS ∈ {1, 4, 16}` and explain the resulting curve.

**Difficulty.** Senior

**Skills.** `testing.B`, scheduler allocation paths, runqueue contention.

**Setup.** Go 1.22+, a multi-core machine.

**Steps.**
1. Write `BenchmarkGoSpawn` that does `b.N` iterations of `go func(){}()` and `wg.Wait()`s on each.
2. Run with `GOMAXPROCS=1`, `4`, `16`. Record ns/op and `B/op`.
3. Try a variant that fans out to a pool of N goroutines via a channel and compare.

**Acceptance criteria.**
- Spawn cost is in the 200–500 ns range on a modern x86 — confirm the order of magnitude.
- At `GOMAXPROCS=16`, ns/op is *higher*, not lower, than at `GOMAXPROCS=4` (more contention on global runq for the wakeups).
- You can explain the `gfreecnt` field on each P (a free-G cache that makes the next spawn allocation-free).

<details><summary>Hints</summary>

- Always `defer wg.Done()` inside the goroutine; otherwise you'll race the `wg.Wait`.
- Use `b.ReportAllocs()` to confirm spawn is allocation-free in steady state.
- `testing.B`'s default minimum time is 1 s. For 200 ns operations, that's ~5 million iterations. Plenty.

</details>

<details><summary>Reference solution</summary>

```go
// bench_test.go — go test -bench . -benchmem -cpu 1,4,16
package main

import (
	"sync"
	"testing"
)

func BenchmarkGoSpawn(b *testing.B) {
	b.ReportAllocs()
	var wg sync.WaitGroup
	wg.Add(b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		go wg.Done()
	}
	wg.Wait()
}

// Senior decision: a pool reuses goroutines so we measure only
// send/recv, not the spawn path. Sometimes pools are faster, often
// they're not — the runtime's free-G cache makes raw spawn cheap.
func BenchmarkPoolDispatch(b *testing.B) {
	const workers = 16
	jobs := make(chan struct{}, workers*2)
	done := make(chan struct{}, workers*2)
	for i := 0; i < workers; i++ {
		go func() {
			for range jobs {
				done <- struct{}{}
			}
		}()
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		jobs <- struct{}{}
		<-done
	}
	close(jobs)
}
```

Sample numbers (Apple M2, Go 1.22):

```
BenchmarkGoSpawn-1     5_000_000   297 ns/op   0 B/op
BenchmarkGoSpawn-4     7_000_000   215 ns/op   0 B/op
BenchmarkGoSpawn-16    4_000_000   388 ns/op   0 B/op

BenchmarkPoolDispatch-4   3_000_000   430 ns/op   0 B/op
```

Reading the curve:

- P=1: serial; each `go` is one local-runq push + wakeup; ~300 ns.
- P=4: spawns spread across local runqs; wakeups are local; ~220 ns. Sweet spot.
- P=16: now the wakeups contend on the global runq (the sched lock) because most spawns end up needing to wake a parked M. ~390 ns — *worse* than P=1.

The pool benchmark is *slower* than raw spawn at the right `GOMAXPROCS`. Counter-intuitive lesson: in modern Go, "don't allocate goroutines, reuse them" is often premature. The runtime's `gfreecnt` cache (per-P free-G slots) makes spawn allocation-free after the first batch. Reserve pools for cases where you need *fewer* goroutines than tasks (rate limiting), not for spawn-cost reasons.

</details>

---

### Task 12: Quantify the cost of runtime.Gosched

**Goal.** Show that `runtime.Gosched` is not free. Measure exactly how expensive it is in a tight loop and decide when calling it is worth the cost.

**Difficulty.** Senior

**Skills.** `testing.B`, micro-benchmark hygiene, scheduler entry/exit cost.

**Setup.** Go 1.22+.

**Steps.**
1. Write two benchmarks: one tight loop summing 1..N; one identical but calling `runtime.Gosched()` every iteration.
2. Compare ns/op.
3. Sweep "Gosched every K iterations" for K ∈ {1, 10, 100, 1000} and plot/tabulate.

**Acceptance criteria.**
- Per-call Gosched cost is between 100 and 300 ns on x86.
- At K=1000 the overhead is negligible; at K=1 it dwarfs the workload. The sensible call frequency depends on what the work is.
- You can articulate when Gosched is appropriate: tight loops that need to be cooperative on `GOMAXPROCS=1`, or "I want to yield before grabbing a lock" patterns.

<details><summary>Hints</summary>

- Don't accidentally measure call-site cost vs scheduler cost. Run at multiple `GOMAXPROCS` values; the actual yield only happens if there's work to switch to.
- The Gosched cost is roughly: save G's PC + restore scheduler context + run findRunnable + restore G. ~150–250 ns on modern CPUs.

</details>

<details><summary>Reference solution</summary>

```go
// bench_test.go — go test -bench . -benchmem
package main

import (
	"runtime"
	"testing"
)

func tight(n int) int {
	s := 0
	for i := 0; i < n; i++ {
		s += i
	}
	return s
}

func tightYield(n, k int) int {
	s := 0
	for i := 0; i < n; i++ {
		s += i
		if k > 0 && i%k == 0 {
			runtime.Gosched()
		}
	}
	return s
}

func BenchmarkTight(b *testing.B) {
	for i := 0; i < b.N; i++ {
		tight(10_000)
	}
}

func BenchmarkYield_1(b *testing.B)    { for i := 0; i < b.N; i++ { tightYield(10_000, 1) } }
func BenchmarkYield_10(b *testing.B)   { for i := 0; i < b.N; i++ { tightYield(10_000, 10) } }
func BenchmarkYield_100(b *testing.B)  { for i := 0; i < b.N; i++ { tightYield(10_000, 100) } }
func BenchmarkYield_1000(b *testing.B) { for i := 0; i < b.N; i++ { tightYield(10_000, 1000) } }
```

Sample output (Apple M2, Go 1.22):

```
BenchmarkTight-10        4_180_000    3_120 ns/op
BenchmarkYield_1-10      150_000      2_240_000 ns/op  (~720x slower)
BenchmarkYield_10-10     1_100_000    310_000 ns/op    (~100x)
BenchmarkYield_100-10    3_900_000    34_000 ns/op     (~11x)
BenchmarkYield_1000-10   4_050_000    6_500 ns/op      (~2x)
```

So one Gosched is ~225 ns. Yielding every iteration on 10 000-iteration workloads adds *milliseconds*. Yielding every 1000 iterations doubles the cost but is invisible at human time scales.

When is Gosched worth it? Two cases:

1. You have a long-running G on `GOMAXPROCS=1` and need to be polite to other Gs. Async preemption (Task 10) covers this now, but Gosched is still cheaper than the 10 ms timer.
2. You're about to acquire a contended lock and want to give the current lock-holder a chance to release. The yield costs ~225 ns; the spin you'd otherwise do is much more.

Outside those two cases, **don't sprinkle Gosched**. It's a code smell signalling "I think I know better than the scheduler". Almost always you don't.

</details>

---

### Task 13: Read findRunnable and summarise priority order

**Goal.** Read `findRunnable` in `runtime/proc.go` in current Go source. Produce a one-page summary of the order in which it tries sources of work.

**Difficulty.** Senior

**Skills.** Reading runtime source, distinguishing fast paths from slow paths.

**Setup.** Go source checked out (`git clone https://go.googlesource.com/go`) or any GOROOT (`go env GOROOT`).

**Steps.**
1. Open `src/runtime/proc.go`. Find `func findRunnable() (gp *g, inheritTime, tryWakeP bool)`.
2. Walk through the function top to bottom. Identify each "try to get work from X" attempt.
3. Produce a numbered list: "1. local runq; 2. global runq (every 61 ticks for fairness); 3. ..."
4. For each, note: cost (cheap/expensive), lock taken (none/sched lock/timer mutex), how it interacts with `spinning`.

**Acceptance criteria.**
- Your list has at least 7 steps (local, global, finalizer-G fast path, netpoll non-blocking, timers, work-stealing from other Ps, schedule of GC worker, then block).
- You can explain the "every 61 ticks" check: it occasionally pulls from the *global* runq even when local has work, to avoid starvation of globally-queued Gs.
- You note the "spinning" state and its purpose: an M may continue searching for work for a brief period before parking, avoiding the cost of park-then-immediately-unpark.

<details><summary>Hints</summary>

- The function is ~300 lines. Don't try to understand every detail; identify the *strategies* and the order.
- The `top:` label is the entry point; the goto loop is the retry path after partial successes (e.g., a netpoll returned new work that needs to be queued, then we restart the search).
- The relevant constants: `schedtick`, `stealOrder`, `spinning`.

</details>

<details><summary>Reference solution</summary>

A one-page summary of `findRunnable` priority order (as of Go 1.22):

```
findRunnable() ordering:

1. Check g.preempt — if asked to yield, prefer the global runq (fairness)
   so we don't starve already-queued Gs.

2. Every 61st schedule tick, peek the global runq before the local runq.
   This prevents pathological starvation where Gs always re-queue locally.

3. Local runq (p.runqhead..p.runqtail) — lock-free, cheap. Most common
   path on a busy P.

4. Global runq (sched.runq) — under sched.lock. Pull at most
   min(len(global)/gomaxprocs + 1, len(local)/2) to spread load.

5. Wake one parked P if there's I/O ready in netpoll. Non-blocking
   `netpoll(0)` — drain ready Gs without blocking the M.

6. Work-stealing: pick a random P, try to steal half its runq. Use
   `stealOrder` (a permuted index) to avoid all Ms hitting the same
   victim. Steal timers too if our timer heap is empty.

7. If we're a spinning M, give up spinning here. Park the M with
   notesleep on m.park.

8. Idle GC mark worker — if GC needs assist and we have nothing else.

9. Last resort: blocking netpoll. The M blocks in epoll/kqueue until
   I/O is ready. This is the only place an M voluntarily blocks
   waiting for events.

Key invariants:
- A spinning M holds no P. It transitions from spinning to running by
  acquiring a P from the idle list.
- Calling out of findRunnable means: we have a G to run. Calling back
  means: we found nothing, M parks.
- The 61-tick fairness check is the single most cited "magic number"
  in the scheduler. The number is arbitrary but the principle (a
  small probability of bypassing local) avoids starvation.
```

This is the kind of summary worth keeping in a personal notebook. The actual code has more cases (LockOSThread coordination, runtime profiler integration, GC mark workers) but the order above is the spine. Operators who can recite this list spot starvation bugs in seconds where others spend hours.

</details>

---

### Task 14: Use //go:linkname to call an unexported runtime function

**Goal.** Use `//go:linkname` to call `runtime_procPin` and `runtime_procUnpin` from your code. Demonstrate that between Pin and Unpin, the goroutine cannot be preempted to a different P.

**Difficulty.** Senior

**Skills.** `//go:linkname`, runtime ABI, the difference between `LockOSThread` (M binding) and `procPin` (P binding).

**Setup.** Go 1.22+, a single `.go` file, and a one-line cgo or empty `.s` assembly trick to allow `linkname`.

**Steps.**
1. Add an empty `unsafe.go` file in your package that just imports `_ "unsafe"`.
2. Add the linkname declarations for `runtime_procPin` and `runtime_procUnpin`.
3. Call them around a section that reads/writes a per-P data structure (a `[GOMAXPROCS]Counter` array indexed by the current P).
4. Verify with a multi-goroutine test that contention vanishes — each P touches only its own counter.

**Acceptance criteria.**
- Your code compiles and runs.
- You acknowledge that `//go:linkname` is unsupported and can break on any minor version.
- You can articulate when `procPin` is more appropriate than `LockOSThread` (very short critical sections that need a stable P identity but not a stable M).

<details><summary>Hints</summary>

- The directive is `//go:linkname localName runtime.symbolName` immediately above a *no-body* function declaration.
- You need `import _ "unsafe"` somewhere in the file. The directive is gated on that import.
- `runtime_procPin` returns the current P's id (int) and disables preemption. `runtime_procUnpin` re-enables it. Forget the Unpin and the runtime panics on the next GC.

</details>

<details><summary>Reference solution</summary>

```go
// procpin.go — go run procpin.go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	_ "unsafe" // for go:linkname
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

// Per-P counters. We use a slice sized GOMAXPROCS at init and
// trust procPin to give us a valid index.
type Counter struct {
	_ [64]byte // false-sharing padding
	n int64
	_ [64]byte
}

var counters []Counter

func incPerP() {
	pid := runtime_procPin()
	counters[pid].n++ // single-writer, no atomic needed: we own this P
	runtime_procUnpin()
}

func sumAll() int64 {
	var s int64
	for i := range counters {
		s += atomic.LoadInt64(&counters[i].n)
	}
	return s
}

func main() {
	maxp := runtime.GOMAXPROCS(0)
	counters = make([]Counter, maxp)

	const N = 1_000_000
	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < N; i++ {
				incPerP()
			}
		}()
	}
	wg.Wait()
	fmt.Printf("expected=%d sum=%d\n", 8*N, sumAll())
}
```

Output:

```
expected=8000000 sum=8000000
```

The critical-section invariants:

- Between `procPin` and `procUnpin`, GC cannot run (the runtime keeps a count of pinned Ms and waits). Don't allocate inside.
- The G *can* still be preempted to another M, but it cannot move to another P. The pin is on the P, not the M.

This is exactly the trick the runtime itself uses internally to maintain per-P caches (mcache for the allocator, sudog cache, gfreecnt). It's how `sync/atomic` can implement fast counters without locks in some cases.

**Risks of `//go:linkname`:**

1. The runtime function name may change between minor versions. The Go team has been clear that `linkname` is not API.
2. ABI changes (parameter order, calling convention) silently corrupt your program.
3. Static analysers and `go vet` won't catch most bugs in linkname'd code.

Use it only when the alternative is clearly worse (e.g., implementing a custom allocator that needs per-P arenas) and document the Go version dependency loudly.

</details>

---

### Task 15: Goroutine count limiter vs errgroup

**Goal.** Implement a "spawn at most N goroutines at a time" primitive using a buffered channel + WaitGroup. Benchmark it against `errgroup.WithContext` + `g.SetLimit(N)`. Discover that the standard library's primitive is roughly as fast and has cancellation built in.

**Difficulty.** Senior

**Skills.** Concurrency patterns, fair scheduling, when to roll your own.

**Setup.** Go 1.22+, `golang.org/x/sync/errgroup`.

**Steps.**
1. Write `Limiter` with `Go(func())` that blocks until a slot is free. Use `chan struct{}` as the semaphore.
2. Write a benchmark that fires 10 000 small tasks through it.
3. Repeat with `errgroup` + `SetLimit(N)`.
4. Compare ns/op, allocations, and *cancellation* behaviour (kill the parent ctx mid-flight).

**Acceptance criteria.**
- Both implementations finish in roughly the same wall time.
- The errgroup variant cancels on ctx-done; your hand-rolled one doesn't (unless you wire it up).
- You can articulate when the hand-rolled limiter is justified (no error propagation needed, want zero deps).

<details><summary>Hints</summary>

- `g.SetLimit(N)` in errgroup blocks `g.Go` when N goroutines are already in flight. It replaced the older `errgroup` + manual semaphore pattern that was everywhere pre-1.20.
- Cancellation: `errgroup.WithContext` returns a derived ctx that's cancelled when the first goroutine returns an error. Your limiter needs explicit ctx wiring or callers won't get this.

</details>

<details><summary>Reference solution</summary>

```go
// limiter.go and limiter_test.go
package main

import (
	"context"
	"sync"
	"testing"

	"golang.org/x/sync/errgroup"
)

// Senior decision: minimal Limiter. No error propagation, no context.
// Tradeoff: explicit, dependency-free, hard to extend. The moment you
// want "stop on first error" you've reinvented errgroup.
type Limiter struct {
	sem chan struct{}
	wg  sync.WaitGroup
}

func NewLimiter(n int) *Limiter {
	return &Limiter{sem: make(chan struct{}, n)}
}

func (l *Limiter) Go(fn func()) {
	l.sem <- struct{}{} // blocks if N goroutines already in flight
	l.wg.Add(1)
	go func() {
		defer func() { <-l.sem; l.wg.Done() }()
		fn()
	}()
}

func (l *Limiter) Wait() { l.wg.Wait() }

const N = 10_000

func work() {
	s := 0
	for i := 0; i < 100; i++ {
		s += i
	}
	_ = s
}

func BenchmarkHandRolled(b *testing.B) {
	for i := 0; i < b.N; i++ {
		l := NewLimiter(16)
		for j := 0; j < N; j++ {
			l.Go(work)
		}
		l.Wait()
	}
}

func BenchmarkErrgroup(b *testing.B) {
	for i := 0; i < b.N; i++ {
		g, _ := errgroup.WithContext(context.Background())
		g.SetLimit(16)
		for j := 0; j < N; j++ {
			g.Go(func() error { work(); return nil })
		}
		g.Wait()
	}
}
```

Typical:

```
BenchmarkHandRolled-10   850   1.39 ms/op
BenchmarkErrgroup-10     820   1.41 ms/op
```

Essentially indistinguishable. errgroup's `SetLimit` *is* a semaphore internally; the cost is identical. The decision is about *features*, not speed:

- Want error short-circuit? errgroup, no contest.
- Want ctx cancellation? errgroup.
- Writing a library with zero deps and no error model? Hand-rolled is honest about what you've built.

The trap to avoid: a hand-rolled limiter that "almost" implements errgroup, missing the context cancel race. You'll catch it on the third post-mortem. Just use errgroup.

</details>

---

### Task 16: Read the async preemption design doc

**Goal.** Read Go proposal 24543 (Non-cooperative goroutine preemption). Summarise it in your own words and identify which runtime source files implement it.

**Difficulty.** Staff

**Skills.** Reading design docs, mapping proposals to code, runtime architecture.

**Setup.** Web access to read the proposal, Go source checked out.

**Steps.**
1. Read https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md
2. Write a one-page summary covering: the problem, alternatives considered (loop preemption, separate sched thread, etc.), the chosen mechanism (signal-based, with stack-pointer rewriting), and the GC implications.
3. Locate the implementation in `src/runtime/`. At minimum: `signal_unix.go` for the signal handler, `preempt.go` for the orchestration, `proc.go` for the integration with `sysmon`.
4. Identify three subtleties you didn't anticipate (e.g., what about register state? what if the G is in unsafe-point code?).

**Acceptance criteria.**
- Your summary correctly identifies `SIGURG` as the signal of choice (chosen because it's rarely used by other code).
- You can name the concept of "async safe points" — instructions where the runtime is willing to suspend a G. Not every instruction qualifies; the runtime uses PCDATA tables to track which are safe.
- You can describe one limitation: on architectures without good signal-mechanism support, preemption still falls back to stack-growth checks.

<details><summary>Hints</summary>

- The proposal predates the implementation by ~18 months. It went through several revisions.
- The Go team's blog post "Goroutine preemption" (around 1.14 release) is a more accessible summary.
- `runtime/preempt_amd64.s` (and per-arch siblings) contain the actual assembly that rewrites a goroutine's stack to call into the preemption handler.

</details>

<details><summary>Reference solution</summary>

**Summary of proposal 24543:**

> Before Go 1.14, goroutine preemption was *cooperative*: the runtime could only suspend a goroutine when that goroutine called a function (because each prologue checks `g.preempt`). Tight loops with no calls would run forever, blocking GC stop-the-world phases and starving other goroutines on the same P. The proposal introduces non-cooperative ("async") preemption via OS signals.
>
> **Mechanism (Unix):** `sysmon` notices a G has been running >10 ms. It sets `g.preempt = true` and sends `SIGURG` to the M running the G. The signal handler inspects the trapped PC; if it's at an async-safe point (most instructions are), it rewrites the G's stack so that when the signal returns, control transfers to `asyncPreempt` instead. `asyncPreempt` saves all registers, calls `preemptPark`, which suspends the G. The G is then resumed normally later.
>
> **Why SIGURG:** it's rarely sent by anything else (originally for "urgent" out-of-band TCP data). Using SIGUSR1/2 would conflict with user code; using a synthetic signal would require kernel support.
>
> **Async safe points:** not every instruction is safe to suspend at. Code that's mid-write-barrier, mid-stack-grow, or in runtime-internal critical sections must not be suspended. The compiler emits `funcdata` tables (`runtime.PCDATA_UnsafePoint`) marking unsafe instruction ranges. The preemption handler checks the trapped PC against these tables and, if unsafe, returns without preempting (the next sysmon round will retry).
>
> **GC integration:** before async preemption, GC stop-the-world had to wait for every G to reach a function call. With async preemption, GC can suspend a G in ~10 µs regardless of what it's doing. This alone reduced p99 GC pauses by 10–100× on workloads with tight loops.
>
> **Affected files:**
> - `runtime/preempt.go` — orchestration, `preemptone`, `preemptall`.
> - `runtime/signal_unix.go` — `sighandler`, dispatch of `_SIGURG` to preemption handling.
> - `runtime/preempt_amd64.s` (and siblings) — `asyncPreempt` register save/restore.
> - `runtime/proc.go` — `sysmon`'s preemption decision (`retake`).
> - `runtime/runtime2.go` — additions to `g` and `m` structs (`preempt`, `preemptStop`, `preemptShrink`).
>
> **Subtleties you might not anticipate:**
> 1. Windows uses thread suspension (`SuspendThread`) instead of signals, with similar PC-rewrite logic.
> 2. cgo callbacks are not preemptible — the M holding the cgo call is opaque. `sysmon` simply records a debt that's paid on cgo-call return.
> 3. The first 10 ms of a goroutine's life are exempt — newly-created Gs are too valuable to disturb. Only after a G has been running 10 ms does it become a preemption candidate.

The reason this matters to you as an operator: every story about Go GC latency *before* 2020 includes "tight loop blocks GC". Every modern Go GC story does not. The async preemption work is the boundary.

</details>

---

### Task 17: Diff runtime/proc.go between two Go releases

**Goal.** Compare `runtime/proc.go` between two adjacent Go releases (e.g., 1.21 and 1.22). Identify one significant scheduler change and explain its motivation.

**Difficulty.** Staff

**Skills.** `git log`, `git diff`, release-note correlation, reading runtime patches.

**Setup.** Go source repo (`git clone https://go.googlesource.com/go`), `git`.

**Steps.**
1. `cd go && git log --oneline -- src/runtime/proc.go | grep -i 1.22` or similar to find the release boundary.
2. `git diff release-branch.go1.21..release-branch.go1.22 -- src/runtime/proc.go | less`
3. Pick one non-trivial hunk (>30 lines). Identify the function and the change in behaviour.
4. Cross-reference with the Go 1.22 release notes and any linked issues/CLs.

**Acceptance criteria.**
- You name a specific change (e.g., PGO-driven inlining hooks, runtime/metrics additions, the GOROOT/GOMAXPROCS env-var defaulting changes).
- You can explain what the previous code did, what the new code does, and what user-visible behaviour shifts.
- You found at least one commit message and skimmed it.

<details><summary>Hints</summary>

- Major scheduler changes don't ship in every release. Sometimes the diff is mostly clean-ups. That's fine — small refactors are also good reading.
- Useful starting points: `findRunnable`, `schedule`, `sysmon`, `runqsteal`. Less-fundamental functions change more often.
- `git blame` on a specific line tells you which commit introduced it.

</details>

<details><summary>Reference solution</summary>

Example: Go 1.21 → 1.22 changes in `runtime/proc.go`.

```
$ git diff release-branch.go1.21..release-branch.go1.22 -- src/runtime/proc.go \
    | grep '^@@' | head
@@ -240,6 +240,12 @@ func main() {
@@ -1024,7 +1030,15 @@ func mPark() {
@@ -2114,3 +2128,25 @@ func runqgrab(...) {
```

Picking one hunk — the `runqgrab` change:

```
+	// In Go 1.22, when stealing from another P's runq, we now
+	// take a portion proportional to the victim's queue depth
+	// rather than always halving. This avoids over-correction
+	// on bursty workloads.
 func runqgrab(_p_ *p, batch *[256]guintptr, ...) uint32 {
-	n := _p_.runqtail - _p_.runqhead
-	n -= n / 2
+	n := _p_.runqtail - _p_.runqhead
+	if n > 1 {
+		n -= n / 2
+	}
```

(This is an illustrative example — your real diff will differ; the point is the pattern.)

Cross-references:

- Release notes: "The scheduler's work-stealing heuristic was tweaked to reduce thrash on workloads with short bursts of producer activity."
- Commit message includes a benchmark showing reduced p99 latency on a representative test case.

What user-visible behaviour shifts: nothing observable in correctness; ~3–5% improvement on bursty producer-consumer benchmarks; potentially worse on perfectly balanced steady-state workloads (the new heuristic leaves a little more local work for the producer P).

The exercise's real value isn't this specific diff. It's the *workflow*: when a user reports "my Go program got slower after 1.X", you know how to find the relevant code change in 20 minutes instead of speculating.

</details>

---

### Task 18: Profile LockOSThread impact on a worker pool

**Goal.** Build a CPU-bound worker pool, then run it again with every worker holding `LockOSThread`. Quantify the increase in scheduler latency.

**Difficulty.** Staff

**Skills.** `runtime/metrics`, `LockOSThread`, M:N model under stress.

**Setup.** Go 1.22+, a machine with more workers than cores (oversubscription is the point).

**Steps.**
1. Pool of N workers consuming from a channel, doing 1 ms of CPU work per job.
2. Drive `GOMAXPROCS=4`, `N=16` workers, 100 000 jobs.
3. Measure: median, p99 of "job-arrival to job-start" using a timestamp on the job.
4. Repeat with `runtime.LockOSThread()` at the top of each worker goroutine.
5. Compare. Predict the result, then run.

**Acceptance criteria.**
- Without lock: latency is dominated by `GOMAXPROCS=4` parallelism. p99 is roughly `(16/4)*1ms = 4 ms`.
- With lock: scheduler latency is much worse, because Ms cannot be re-bound to a different P, so a parked M cannot rejoin work.
- You can articulate the *cost*: every worker now consumes one OS thread permanently. Memory pressure (each thread has its own kernel stack), context-switch cost, and reduced M:N flexibility.

<details><summary>Hints</summary>

- `runtime/metrics` exposes `/sched/latencies:seconds`. That's per-G runnable-to-running latency. Also `/cpu/classes/scavenge/total:cpu-seconds` if you want to rule out GC effects.
- The "job arrival to job start" timestamp is application-level latency. The scheduler latency from `runtime/metrics` is one component.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go
package main

import (
	"fmt"
	"runtime"
	"runtime/metrics"
	"sync"
	"time"
)

type job struct {
	arrival time.Time
}

func worker(jobs <-chan job, wg *sync.WaitGroup, lock bool, results chan<- time.Duration) {
	defer wg.Done()
	if lock {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
	}
	for j := range jobs {
		results <- time.Since(j.arrival)
		// 1 ms of CPU
		s := 0
		for i := 0; i < 3_000_000; i++ {
			s += i
		}
		_ = s
	}
}

func run(lock bool) (p50, p99 time.Duration) {
	const NJobs, NWorkers = 100_000, 16
	runtime.GOMAXPROCS(4)
	jobs := make(chan job, NWorkers)
	results := make(chan time.Duration, NJobs)
	var wg sync.WaitGroup
	for i := 0; i < NWorkers; i++ {
		wg.Add(1)
		go worker(jobs, &wg, lock, results)
	}
	go func() {
		for i := 0; i < NJobs; i++ {
			jobs <- job{arrival: time.Now()}
		}
		close(jobs)
	}()
	wg.Wait()
	close(results)

	var lats []time.Duration
	for d := range results {
		lats = append(lats, d)
	}
	sortDurations(lats)
	return lats[len(lats)/2], lats[len(lats)*99/100]
}

func sortDurations(d []time.Duration) {
	// insertion sort, fine for our N
	for i := 1; i < len(d); i++ {
		for j := i; j > 0 && d[j-1] > d[j]; j-- {
			d[j-1], d[j] = d[j], d[j-1]
		}
	}
}

func schedP99() float64 {
	samples := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
	metrics.Read(samples)
	h := samples[0].Value.Float64Histogram()
	var cum, total uint64
	for _, c := range h.Counts {
		total += c
	}
	for i, c := range h.Counts {
		cum += c
		if float64(cum) >= 0.99*float64(total) {
			return h.Buckets[i+1]
		}
	}
	return 0
}

func main() {
	for _, lock := range []bool{false, true} {
		p50, p99 := run(lock)
		sched := schedP99()
		fmt.Printf("lock=%-5v  jobP50=%v  jobP99=%v  schedP99=%.2fms\n",
			lock, p50, p99, sched*1000)
	}
}
```

Sample output:

```
lock=false  jobP50=2.3ms  jobP99=4.1ms  schedP99=0.05ms
lock=true   jobP50=2.7ms  jobP99=8.9ms  schedP99=0.32ms
```

The job-level p99 doubles with `LockOSThread`. The scheduler-internal p99 (the `/sched/latencies:seconds` metric) is 6× worse. Why?

- Without lock: when a worker G blocks (on receive from `jobs`), the M can be re-bound to another P that has work. Smooth load balancing.
- With lock: the M cannot move. If the M's P has no work but another P does, the M is stuck. Effectively `GOMAXPROCS - 1` Ps can run user code; the locked-but-idle workers are dead weight.

The lesson: `LockOSThread` is a powerful tool with a real cost. Use it when you must (cgo + thread-local state, signal masking, OpenGL contexts). Don't use it for "I want my G to have a stable identity" — `procPin` (Task 14) is cheaper.

</details>

---

### Task 19: Microbenchmark global runq contention

**Goal.** Construct a workload that forces the global runq to be hot. Show that as `GOMAXPROCS` grows beyond the work-arrival concurrency, the sched lock becomes the bottleneck.

**Difficulty.** Staff

**Skills.** `runtime/pprof` for `sched_lock` contention, microbenchmarking, runtime architecture.

**Setup.** Go 1.22+, a multi-core machine, `pprof`.

**Steps.**
1. Write a benchmark where one producer goroutine fires `go work()` as fast as it can, and N consumer Ps drain.
2. Sweep `GOMAXPROCS ∈ {2, 4, 8, 16, 32}`. Measure throughput (jobs/sec).
3. Capture a mutex profile (`runtime.SetMutexProfileFraction(1)`) and look at `runtime.schedule`'s contention.
4. Demonstrate that at high P counts, the producer becomes the bottleneck because every new `go` requires touching the sched lock to wake a parked M.

**Acceptance criteria.**
- Throughput improves from P=2 to P=8, then plateaus or regresses by P=32.
- The mutex profile shows `runtime.lock` / `runtime.unlock` from `runtime.schedule` near the top.
- You can articulate why: every G's `go` statement that targets a parked M takes the sched lock to dequeue from the idle-M list and wake it.

<details><summary>Hints</summary>

- The local runq is lock-free. Contention only happens on the *global* runq and the M idle list.
- A program that fires `go` from one goroutine creates many wake-ups because most Ms are parked (no local work).
- `pprof` mutex profile: `go test -bench . -mutexprofile=mutex.out`, then `go tool pprof mutex.out`.

</details>

<details><summary>Reference solution</summary>

```go
// bench_test.go — go test -bench . -benchmem -mutexprofile=mutex.out -cpu 2,4,8,16,32
package main

import (
	"sync"
	"sync/atomic"
	"testing"
)

func BenchmarkGlobalRunq(b *testing.B) {
	// Senior decision: ResetTimer after barrier setup; otherwise
	// the spawn warmup dominates short benchmarks.
	var done int64
	var wg sync.WaitGroup
	wg.Add(b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Spawning from main G ensures all wakes go through
		// the shared sched lock pathway.
		go func() {
			defer wg.Done()
			atomic.AddInt64(&done, 1)
		}()
	}
	wg.Wait()
	_ = done
}
```

Run with mutex profile:

```
go test -bench BenchmarkGlobalRunq -mutexprofile=mutex.out -cpu 2,4,8,16,32
```

Sample output:

```
BenchmarkGlobalRunq-2     6M    216 ns/op
BenchmarkGlobalRunq-4     8M    180 ns/op
BenchmarkGlobalRunq-8     7M    220 ns/op
BenchmarkGlobalRunq-16    5M    340 ns/op
BenchmarkGlobalRunq-32    3M    560 ns/op
```

Throughput peaks at P=4. At P=32 we're *slower* than P=2.

Mutex profile (`go tool pprof -top mutex.out`):

```
flat   flat%   sum%        cum   cum%
1.2s    62%    62%        1.2s    62%  runtime.lock2
0.4s    21%    83%        0.4s    21%  runtime.unlock
0.2s    11%    94%        0.2s    11%  runtime.semasleep
```

The `runtime.lock2` calls are coming from `runtime.startm`, `runtime.wakep`, `runtime.findRunnable` — all the wake-up paths around the global runq and the M idle list.

The structural fix in user code: distribute the `go` calls across multiple producers (the runtime aggressively favours the local runq when the spawner has its own P). The structural fix in the runtime: there isn't one; the sched lock is fundamental to global runq management. Go's design assumes spawn is mostly from worker Gs that already own a P, not from a single hot-spawn producer.

The takeaway for design: if you have a job dispatcher pattern, spread the dispatch across `GOMAXPROCS` producers instead of one hot producer.

</details>

---

### Task 20: Design a work-steal tracer

**Goal.** Sketch the design of a tool that emits a custom event each time a P performs a work-steal. You won't ship this — you'll discuss what it would require.

**Difficulty.** Staff

**Skills.** Runtime internals, tracing infrastructure, design judgement.

**Setup.** Pen, paper, and the source of `runtime/trace.go`.

**Steps.**
1. Read `runtime/trace.go`'s event format. Identify the existing event types (`GoCreate`, `GoStart`, `GoBlock`, ...).
2. Locate `runqsteal` in `runtime/proc.go`. Identify the call site where you would emit a `GoStealStart` event.
3. Specify the event payload: source P, target P, number of Gs stolen, timestamp.
4. Discuss implementation cost: where the bytes are written (`p.tracebuf`), the budget (each trace event is ~10 bytes), and the alternative of using an existing event creatively.

**Acceptance criteria.**
- Your design names the precise function (`runqsteal`) and line range.
- You acknowledge that adding a new trace event requires updating both `runtime/trace.go` and `cmd/trace`/`internal/trace` to display it.
- You identify an alternative: emit a `UserLog` event from the stealing M with a stringified description, no runtime patch needed.

<details><summary>Hints</summary>

- Custom trace events in Go 1.22+ are easier via `runtime/trace.Log` (Task 6). But that requires user-code call sites; you can't easily inject from inside the runtime without a patch.
- `runqsteal` is hot — even a few nanoseconds added per call is significant. The trace buffer write is ~30 ns. Acceptable, but measure.
- The `internal/trace` package parses the binary format. Adding an event type means version-bumping the trace format (`traceEvVersion`).

</details>

<details><summary>Reference solution</summary>

**Design sketch:**

```
Goal: emit "STEAL src=Px dst=Py n=K" every time a P steals work.

Where to instrument: runtime/proc.go, func runqsteal:

    func runqsteal(_p_, p2 *p, ...) ... {
        n := runqgrab(p2, ...)
        if n == 0 {
            return 0
        }
        // NEW: emit trace event
        if traceEnabled() {
            traceGoStealStart(_p_.id, p2.id, n)
        }
        ...
    }

Payload format (added to runtime/traceback.go event table):

    traceEvGoStealStart = NN  // new event id, version bump required
        args: srcP int32, dstP int32, n uint32

Per-event cost:
  - traceEvent() — already used by other events, ~20 ns hot, ~50 ns cold
  - 3 args × varint-encode = ~3-9 bytes
  - Negligible compared to the steal itself (~1 µs).

Parser-side changes (cmd/trace, internal/trace):
  1. Bump traceVersion.
  2. Add Event constant and decoder.
  3. Add a new view in cmd/trace's HTML: "Work-steal heatmap".

Alternative (zero-patch): use trace.Log from a wrapper.
  - Can't directly, because the steal happens in runtime code that
    user code can't intercept.
  - Could be approximated by: monitor per-P runq depths from
    user code at 100 µs intervals (sysmon-ish). Detect drops in
    one P's depth that coincide with rises in another. Lossy but
    requires no runtime patch.

Production justification: would I land this upstream?
  - "Why is my workload steal-heavy?" is a real question.
  - Existing trace doesn't show steals; you can infer them from
    G-migrations across P rows but it's tedious.
  - Cost is borderline acceptable. The trace buffer is already
    paying ~5% overhead; another event type adds <1%.

Decision: write it as a runtime patch, ship as a private build,
collect data, then decide if it's worth proposing upstream. Don't
upstream speculatively — the Go team is rightly conservative about
trace event proliferation.
```

This is the kind of internal proposal a Staff-level engineer would write before touching the code. The judgement: most ideas to instrument the runtime are *good* ideas; most should not ship because the overhead compounds and the tool's audience is small. Pick fights carefully.

</details>

---

### Task 21: GOMAXPROCS far above core count

**Goal.** Set `GOMAXPROCS=128` on a 10-core machine. Predict the result. Run. Explain.

**Difficulty.** Staff

**Skills.** OS scheduling vs Go scheduling, oversubscription effects.

**Setup.** Go 1.22+, multi-core machine, ability to set `GOMAXPROCS`.

**Steps.**
1. CPU-bound workload that takes ~5 s at `GOMAXPROCS=1`.
2. Run at `GOMAXPROCS=10` (cores), `GOMAXPROCS=20`, `GOMAXPROCS=128`. Record wall time.
3. Use `GODEBUG=schedtrace=500` to observe runqueue sizes and parked-M counts.
4. Use `top` or `htop` (or Activity Monitor) to see context-switch rate.

**Acceptance criteria.**
- Wall time at P=128 is roughly the same as P=10, sometimes slightly worse, never better.
- Context-switch rate jumps significantly at P=128 because the OS is now multiplexing 128 OS threads onto 10 cores.
- You can articulate why: the Go runtime gladly creates 128 Ms, but the kernel does *its* scheduling on top. Two layers of scheduling means context switches happen at both layers.

<details><summary>Hints</summary>

- Don't expect catastrophic slowdown — modern Linux schedulers handle oversubscription gracefully. The penalty is real but small.
- The interesting metric is *latency*, not throughput. p99 of a per-task timer will degrade at P=128 because of OS-level context switches.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — for P in 10 20 128; do GOMAXPROCS=$P go run main.go; done
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

func work(d time.Duration) {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		// burn
	}
}

func main() {
	const NJobs = 200
	p := runtime.GOMAXPROCS(0)
	var wg sync.WaitGroup
	wg.Add(NJobs)
	t := time.Now()
	for i := 0; i < NJobs; i++ {
		go func() {
			defer wg.Done()
			work(100 * time.Millisecond)
		}()
	}
	wg.Wait()
	fmt.Printf("P=%d wall=%v\n", p, time.Since(t))
}
```

Results (10-core M2 Pro):

```
P=10  wall=2.05s
P=20  wall=2.08s
P=128 wall=2.18s
```

`schedtrace` at P=128 shows:

```
gomaxprocs=128 idleprocs=118 threads=132 spinningthreads=0 idlethreads=121
```

118 Ps are idle. They were created (the runtime trusts `GOMAXPROCS`) but they have nothing to do because there are only 200 jobs and 10 cores worth of throughput. Each of the 10 working Ps has full local runq depth; the others are parked.

Penalty at P=128 vs P=10: ~6%. Where does it come from?

- The OS thread scheduler now has 132 threads to consider. CFS (Linux's scheduler) is O(log N) per pick; small but non-zero.
- The Go runtime's `findRunnable` looks at more Ps when work-stealing, increasing the time to find no work.
- Memory: each parked M has its own kernel stack (~8 KB) and Go stack. 120 extra Ms = ~2 MB resident.

Rule of thumb: set `GOMAXPROCS` to the number of cores you actually want to use (which may be smaller than the machine if you're sharing). Setting it higher gains nothing. Setting it lower than the number of cores is appropriate for "I want to leave headroom for other processes".

</details>

---

### Task 22: Scheduling latency during GC mark-assist

**Goal.** Construct a workload heavy enough to trigger GC mark-assist. Show, via `runtime/metrics`, that scheduling latency spikes during the assist phase.

**Difficulty.** Staff

**Skills.** GC architecture, mark-assist mechanism, correlating multiple metrics.

**Setup.** Go 1.22+, a workload with steady allocation pressure.

**Steps.**
1. Workload allocates ~100 MB/s of small objects (the goal is to keep GC working).
2. Periodically sample `runtime/metrics`: `/sched/latencies:seconds`, `/gc/pauses:seconds`, `/cpu/classes/gc/mark/assist:cpu-seconds`.
3. Plot the three over time. Find the correlated spikes.
4. Reduce allocation rate by 4× and re-run. Confirm latency stabilises.

**Acceptance criteria.**
- You produce a time-series showing all three metrics. Mark-assist CPU correlates with scheduling latency p99.
- You can explain mark-assist: when a G allocates more than its "budget" while GC is running, the allocator hijacks the G and forces it to do marking work. That G is now doing GC, not user work.
- You can name the fix: reduce allocation rate, increase GOGC, or move large allocations off the hot path.

<details><summary>Hints</summary>

- `GODEBUG=gctrace=1` is the easiest way to confirm GC is running and assists are happening (look for `assist` in the trace line).
- `runtime/metrics.Read` is allocation-free; you can sample from a hot loop without polluting your results.

</details>

<details><summary>Reference solution</summary>

```go
// main.go — go run main.go
package main

import (
	"fmt"
	"runtime/metrics"
	"sync"
	"time"
)

func churn(rate int, stop <-chan struct{}) {
	for {
		select {
		case <-stop:
			return
		default:
		}
		for i := 0; i < rate; i++ {
			_ = make([]byte, 1024) // 1 KB each
		}
	}
}

func snapshot() (schedP99, gcAssist, gcPauseP99 float64) {
	samples := []metrics.Sample{
		{Name: "/sched/latencies:seconds"},
		{Name: "/cpu/classes/gc/mark/assist:cpu-seconds"},
		{Name: "/gc/pauses:seconds"},
	}
	metrics.Read(samples)

	h := samples[0].Value.Float64Histogram()
	schedP99 = histP99(h)
	gcAssist = samples[1].Value.Float64()
	gh := samples[2].Value.Float64Histogram()
	gcPauseP99 = histP99(gh)
	return
}

func histP99(h *metrics.Float64Histogram) float64 {
	var cum, total uint64
	for _, c := range h.Counts {
		total += c
	}
	for i, c := range h.Counts {
		cum += c
		if float64(cum) >= 0.99*float64(total) {
			return h.Buckets[i+1]
		}
	}
	return 0
}

func main() {
	stop := make(chan struct{})
	var wg sync.WaitGroup
	const Workers = 8
	wg.Add(Workers)
	for i := 0; i < Workers; i++ {
		go func() {
			defer wg.Done()
			churn(2000, stop) // ~16 MB per worker per loop iter, hot
		}()
	}

	// Sample for 5 s
	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()
	timeout := time.After(5 * time.Second)
	prevAssist := 0.0
	for {
		select {
		case <-tick.C:
			sched, assist, pause := snapshot()
			fmt.Printf("schedP99=%.2fms  pauseP99=%.2fms  gcAssist=%.3f cpu-sec/0.5s (Δ=%.3f)\n",
				sched*1000, pause*1000, assist, assist-prevAssist)
			prevAssist = assist
		case <-timeout:
			close(stop)
			wg.Wait()
			return
		}
	}
}
```

Sample output:

```
schedP99=0.85ms  pauseP99=0.21ms  gcAssist=0.012 cpu-sec/0.5s (Δ=0.012)
schedP99=3.1ms   pauseP99=0.42ms  gcAssist=0.180 cpu-sec/0.5s (Δ=0.168)
schedP99=4.2ms   pauseP99=0.51ms  gcAssist=0.211 cpu-sec/0.5s (Δ=0.031)
schedP99=0.92ms  pauseP99=0.18ms  gcAssist=0.214 cpu-sec/0.5s (Δ=0.003)
```

The middle two samples show the symptom: scheduling latency p99 jumps 5× while `gcAssist` deltas are large. That's user goroutines being conscripted into marking work.

Why scheduling latency goes up:

- A G allocating heavily is doing 30% mark-assist on every allocator slow-path call.
- During the assist, the G is "running" but its user code is paused. To any G waiting to be picked up, the assisting G is consuming a P slot.
- Effective parallelism drops from `GOMAXPROCS` to `GOMAXPROCS × (1 - assistFraction)`.

Fixes in order of typical effectiveness:

1. Reduce allocation rate — pre-allocate, pool, or use `sync.Pool` for hot-path objects.
2. `GOGC=200` or higher — runs GC less often at the cost of higher heap usage. Often a great deal.
3. `GOMEMLIMIT` — sets a soft heap ceiling. Different mechanism, can reduce assist pressure.
4. Move allocation off the request path (precompute, hand pointers around).

The diagnostic skill: see scheduling latency, *look at GC metrics first*. They are the most common cause and the cheapest to confirm.

</details>

---

### Task 23: Fair scheduler wrapper across priority groups

**Goal.** Implement a user-space "fair scheduler" that round-robins a worker pool across N priority groups, each with its own work channel. Discuss trade-offs.

**Difficulty.** Staff

**Skills.** Channel patterns, fairness vs throughput, priority inversion.

**Setup.** Go 1.22+, no external deps.

**Steps.**
1. Define `Job{Priority int, Run func()}` and `Scheduler` with N priority channels.
2. Worker goroutines pull from priority queues in round-robin order: take 1 from priority 0, 1 from priority 1, ..., wrap.
3. Compare against (a) strict priority (always drain high before low) and (b) FIFO across all groups.
4. Show round-robin's anti-starvation property under "100% high-priority load".

**Acceptance criteria.**
- Your round-robin scheduler delivers throughput on the lowest priority group even when the highest is saturated.
- Strict priority starves the lowest under the same input.
- You can articulate the trade: round-robin reduces *worst-case* delay on low-priority work; strict priority gives *best-case* delay on high-priority work. Pick based on whether you fear starvation or care about urgency.

<details><summary>Hints</summary>

- Don't use `select { case <-chans[0]: ... case <-chans[1]: ...}` — `select` picks randomly, which is *not* round-robin.
- Use a loop with explicit index that increments. Use `default` to skip empty queues without blocking.
- "Fairness across priority groups" is different from "fair scheduling of goroutines". Go's runtime gives you the latter for free.

</details>

<details><summary>Reference solution</summary>

```go
// fair.go — go run fair.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Job struct {
	Priority int
	Done     chan time.Duration
	Created  time.Time
}

type Scheduler struct {
	queues [][]chan Job // priority groups
	wg     sync.WaitGroup
	stop   chan struct{}
}

func NewScheduler(priorities, workers int) *Scheduler {
	s := &Scheduler{
		queues: make([][]chan Job, priorities),
		stop:   make(chan struct{}),
	}
	for p := range s.queues {
		s.queues[p] = []chan Job{make(chan Job, 1024)}
	}
	for w := 0; w < workers; w++ {
		s.wg.Add(1)
		go s.worker()
	}
	return s
}

func (s *Scheduler) Submit(j Job) {
	j.Created = time.Now()
	s.queues[j.Priority][0] <- j
}

// Senior decision: round-robin across priorities. Each pass, try
// each queue with a non-blocking receive. If nothing was found,
// block on a select across all queues (so we don't busy-spin).
func (s *Scheduler) worker() {
	defer s.wg.Done()
	cursor := 0
	for {
		select {
		case <-s.stop:
			return
		default:
		}
		gotOne := false
		for i := 0; i < len(s.queues); i++ {
			p := (cursor + i) % len(s.queues)
			select {
			case j := <-s.queues[p][0]:
				j.Done <- time.Since(j.Created)
				gotOne = true
				cursor = (p + 1) % len(s.queues)
			default:
			}
			if gotOne {
				break
			}
		}
		if !gotOne {
			// Nothing on any queue; block on any with a fair select
			cases := make([]chan Job, len(s.queues))
			for i, q := range s.queues {
				cases[i] = q[0]
			}
			// Note: select picks randomly. Acceptable here because
			// it's the slow path (nothing on any queue).
			select {
			case j := <-cases[0]:
				j.Done <- time.Since(j.Created)
			case j := <-cases[1]:
				j.Done <- time.Since(j.Created)
			case <-s.stop:
				return
			}
		}
	}
}

func (s *Scheduler) Close() {
	close(s.stop)
	s.wg.Wait()
}

func main() {
	s := NewScheduler(2, 4)
	defer s.Close()

	var highSum, lowSum, highN, lowN int64
	hDone := make(chan time.Duration, 10000)
	lDone := make(chan time.Duration, 10000)

	// Saturate priority 0; lightly use priority 1
	go func() {
		for i := 0; i < 10000; i++ {
			s.Submit(Job{Priority: 0, Done: hDone})
		}
	}()
	go func() {
		for i := 0; i < 200; i++ {
			s.Submit(Job{Priority: 1, Done: lDone})
			time.Sleep(time.Millisecond)
		}
	}()

	go func() {
		for d := range hDone {
			atomic.AddInt64(&highSum, int64(d))
			atomic.AddInt64(&highN, 1)
		}
	}()
	go func() {
		for d := range lDone {
			atomic.AddInt64(&lowSum, int64(d))
			atomic.AddInt64(&lowN, 1)
		}
	}()

	time.Sleep(2 * time.Second)
	hN, lN := atomic.LoadInt64(&highN), atomic.LoadInt64(&lowN)
	if hN > 0 && lN > 0 {
		fmt.Printf("high: avg=%v  count=%d\n", time.Duration(highSum/hN), hN)
		fmt.Printf("low : avg=%v  count=%d\n", time.Duration(lowSum/lN), lN)
	}
}
```

Sample output:

```
high: avg=312µs   count=8400
low : avg=1.1ms   count=185
```

Both groups make progress. Low-priority average latency is ~3× higher because workers spend most of their time on high-priority items, but it's bounded.

Compare against strict priority (always drain high before checking low) — under the same load, low-priority count would be ~0 because the high-priority queue never empties.

Trade-offs:

| Strategy | Fairness | Throughput | Worst-case for low | Use when |
|---|---|---|---|---|
| Round-robin | High | Slightly lower | Bounded | Mixed workload, no strict urgency |
| Strict priority | None | Highest | Unbounded | Hard real-time, must service high first |
| Weighted RR | Tunable | Tunable | Bounded | Want priority *and* fairness |

The bigger lesson: Go's scheduler is fair *across goroutines*, but as a user you might need fairness across *some user-defined concept* (tenants, customers, priority levels). The runtime can't do that; you build it on top with channels.

</details>

---

## How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (unaided), `3` (your investigation surfaced a concrete observation the reference solution didn't anticipate — a unique trace pattern, a measurable on your hardware, a runtime quirk you can reproduce). Sum:

| Score | What it means |
|-------|---------------|
| 0–20  | You can run a Go program and see it use CPU. The scheduler is a black box. Re-read `junior.md`, redo Tasks 1–5; the goal there is to make `schedtrace` and `runtime/trace` feel like ordinary tools, not arcana. |
| 21–40 | Comfortable with the observability layer. Tasks 6–12 push you into the failure modes: pre-1.14 starvation, work-stealing, contention. By the end you can read a trace and say "the problem is N", not "the program is slow". |
| 41–55 | You can debug a production scheduling issue from `runtime/metrics` alone. Tasks 13–18 force you into the source. The reward is being the person who reads a goroutine dump and immediately sees the lock-order violation that everyone else missed. |
| 56–69 | Staff. Tasks 19–23 are about design judgement: when to instrument, when to leave alone, when fairness in user space matters. If they didn't teach you something concrete about your own production workloads, you weren't reading metrics during the experiments. Re-run Task 22 against a real service and prove (or disprove) the assist hypothesis. |

Concrete checks worth running:

- Task 1: predict three fields of `schedtrace` before running. Right ≥2/3? You're fluent.
- Task 4: take a `scheddetail=1` dump from a real service and find one goroutine in an unexpected wait state. Open a bug or close a misconception.
- Task 9: produce a real scheduling-latency spike *in your team's code* and fix it.
- Task 10: run on Go 1.22 and *also* on Go 1.13 (Docker `golang:1.13`). The contrast is the whole point.
- Task 13: write the priority list from memory after a week. If you can't, you didn't read carefully enough; redo with a notebook.
- Task 14: do not ship `//go:linkname` code without a Go-version regression test. The compiler will not warn you.
- Task 18: measure on a workload where `LockOSThread` is genuinely needed (cgo+OpenGL or similar). The trade is real; quantify it for your case.
- Task 22: instrument your production service for one week. If GC mark-assist isn't visibly correlated with latency spikes, something else is the bottleneck; investigate.

The single most important question is not *did you finish*. It is *can you predict, from a one-paragraph workload description, where the scheduler will become the bottleneck and what `runtime/metrics` field will surface it?* When a colleague says "our p99 jumped after we increased worker count from 8 to 64" and you can name three plausible scheduler causes and the metric to confirm each — that's senior. When you can also pick the cheapest one to verify first, that's staff.

---

## Stretch challenges

**S1 — Build a custom dashboard for `runtime/metrics`.** Wire `runtime/metrics` into Prometheus or OpenTelemetry. Expose all `/sched/*`, `/gc/*`, and `/cpu/classes/gc/*` histograms. Build a Grafana dashboard with: scheduling latency p50/p99, GC pause p99, assist CPU rate, goroutine count, and Ps idle/busy. Run it against a real service for a week. Identify three "interesting" events in the timeline (deploys, traffic spikes, GC churn) and write a one-paragraph post-mortem of each. The deliverable is not the dashboard; it is the *intuition* of what these metrics look like in steady state vs distress.

**S2 — Reproduce a real scheduling pathology from a Go issue tracker.** Browse https://github.com/golang/go/issues with label `Scheduler`. Pick a closed issue with a reproducer attached. Reproduce on your machine. Walk through the fix in the corresponding CL. Predict, before reading the fix, what you would change. Compare. The skill grown here is reading other people's runtime patches.

**S3 — Sketch a "scheduler-aware" worker pool library.** Take Task 15's limiter and Task 23's fair scheduler. Combine them: a worker pool that monitors `runtime/metrics` and shrinks/grows its worker count in response to scheduling latency. When `/sched/latencies:seconds` p99 exceeds a threshold, *reduce* concurrency (counterintuitive but correct — you're oversubscribed). When it falls, expand. Stress-test against a workload that varies between CPU-bound and I/O-bound. The interesting bug to find: the feedback loop oscillates if your hysteresis is wrong. Tune it.
