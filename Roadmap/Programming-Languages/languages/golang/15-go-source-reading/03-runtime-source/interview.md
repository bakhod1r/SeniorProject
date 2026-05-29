# Reading Go Runtime Source — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus a "what NOT to say" section, a five-minute pre-screen checklist, and signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. Reading the runtime is not a stdlib exercise in the normal sense — `runtime` isn't really written in Go, the compiler colludes with it, and half the functions you care about are reached by code the compiler inserts, not by a normal call. The interview signal is whether you can navigate that world without panicking, name the conventions (`//go:nosplit`, `//go:linkname`, `g0`, `getg()`), and reason about *when* reading the source is worth your time vs reading the trace, the docs, or just measuring.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is the `runtime` package, and what's in it?

**Short answer:** `runtime` is the package that implements the Go execution model — the scheduler, the garbage collector, channels, maps, defers, goroutine creation, stack growth, panics, signal handling, and the boot sequence. It's shipped with the toolchain at `$GOROOT/src/runtime/`. It exposes a handful of public functions (`runtime.GOMAXPROCS`, `runtime.NumGoroutine`, `runtime.GC`, `runtime.Caller`, `runtime.SetFinalizer`) but most of it is internal — called by the compiler, not by you. When you write `go f()`, `make(chan T)`, `defer x()`, or `m[k] = v`, the compiler rewrites those into runtime calls.

**Follow-up:** Is `runtime` the same as the "Go runtime"? Answer: roughly yes — the `runtime` package *is* the runtime, plus a small amount of assembly in `runtime/asm_*.s` per architecture and a few helper packages (`runtime/internal/atomic`, `runtime/internal/sys`). When people say "the Go runtime", they usually mean this directory.

---

### Q2. Where do you find the source, and how is it organized?

**Short answer:** `$GOROOT/src/runtime/` — `go env GOROOT` tells you where. Online at `https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/`. The directory has hundreds of files; the naming is functional, not alphabetical. `proc.go` is the scheduler. `chan.go` is channels. `map.go` is maps (pre-Swiss-table) and `map_swiss.go` is the new implementation. `mgc.go` is the GC core. `malloc.go` is the allocator. `panic.go` is panic and recover. `runtime2.go` holds the central type definitions (`g`, `m`, `p`, `sched`, `mheap`). `asm_amd64.s`, `asm_arm64.s` etc. hold the per-architecture assembly. Skim `runtime2.go` first — once you know what `g`, `m`, `p` are, every other file is readable.

**Follow-up:** Why is it called `runtime2.go` and not `types.go`? Answer: historical accident — there used to be a `runtime.go` with most of the core types, it grew, was split, and the bulk of the type definitions ended up in `runtime2.go`. The name stuck. Don't read meaning into it.

---

### Q3. Why is reading `runtime` harder than reading `net/http`?

**Short answer:** Four reasons. (1) **The compiler is a hidden caller.** Many runtime functions are never called by anyone you can grep for — the compiler inserts the call site during code generation. (2) **Not all of it is Go.** Critical paths are written in assembly (`asm_amd64.s`) or in a Go that pretends to be C — no goroutines, no allocations, no defers, no map literals. (3) **Annotations change semantics.** `//go:nosplit`, `//go:nowritebarrier`, `//go:systemstack`, `//go:linkname` are not comments — they alter how the function is compiled. (4) **Layering inverts.** `net/http` calls `net`, which calls `syscall`, which calls runtime. Runtime calls *itself* and the compiler; there's no "lower layer" to escape to when you're confused.

**Follow-up:** Where does the compiler inserting calls show up most? Answer: built-in operations. `go f()` becomes `runtime.newproc(f)`. `make(chan int, 4)` becomes `runtime.makechan`. `ch <- v` becomes `runtime.chansend1`. `<-ch` becomes `runtime.chanrecv1`. `defer f()` becomes `runtime.deferproc(f)` plus an inserted `runtime.deferreturn` at function end. `m[k] = v` becomes `runtime.mapassign_fast64` (or one of a family of typed variants). You won't find these calls by searching your own code.

---

### Q4. What's a `//go:nosplit` annotation?

**Short answer:** It tells the compiler "do not insert the stack-growth check at the start of this function." Normally every Go function begins with a prologue that checks whether the current goroutine stack has room; if not, it calls `runtime.morestack` to copy the stack to a bigger one. `//go:nosplit` removes that prologue, which is necessary for functions that run in contexts where stack growth is illegal — inside the scheduler itself, on the system stack (`g0`), or in signal handlers. The cost is a strict static budget: a `nosplit` function and everything it calls must fit in a small reserved stack window (currently 800 bytes), or `go vet` and the linker fail the build.

**Follow-up:** What other annotations are siblings? Answer: `//go:nowritebarrier` (no GC write barrier allowed — write barriers may schedule work and you're in a context where you can't), `//go:nowritebarrierrec` (same, transitively for all callees), `//go:systemstack` (must run on `g0`), `//go:noinline` (don't inline), `//go:noescape` (parameters don't escape, even though analysis would say they do), `//go:uintptrescapes` (uintptr args are kept alive across the call). Each is a contract with the compiler, enforced or assumed.

---

### Q5. Why might you read the runtime source?

**Short answer:** Five legitimate reasons. (1) **Debugging weird behaviour** — a panic with "runtime: " in the message, a scheduler hang, a GC pause spike, a channel deadlock the race detector won't explain. (2) **Performance work** — understanding why `select` is slower than direct receive, why map iteration is randomized, why short goroutines have cost. (3) **Building tools** — writing a profiler, a tracer, a debugger needs you to know what the runtime publishes and how. (4) **Contributing back** — fixing or extending the runtime requires reading what's there first. (5) **Learning** — understanding goroutines is much easier with `proc.go` open than with blog posts. Illegitimate reason: "to be a Go expert." Reading every line of `runtime` doesn't make you good at Go; reading the parts that intersect your actual problems does.

**Follow-up:** When is reading runtime a waste? Answer: when the question is answerable by `go doc`, `runtime/trace`, `pprof`, or a benchmark. "How does `time.Sleep` work" is a `go doc` question. "Why is my program slow" is a profiler question. Open `runtime/proc.go` only when those have failed.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through how `ch <- v` in user code ends up in `runtime.chansend`.

**Short answer:** The compiler is the missing link. When the compiler sees `ch <- v` in user code, it rewrites the statement during typecheck/SSA into a call to `runtime.chansend1(ch, &v)` — the "1" variant is the form that blocks (the two-value `select` form maps to `selectnbsend`). `chansend1` is a thin wrapper in `chan.go` that calls `chansend(c, elem, true, getcallerpc())` with `block=true`. `chansend` is the real implementation. The path inside `chansend`:

```
chansend(c, ep, block, callerpc):
  if c == nil:
    if !block: return false        // select case
    gopark forever                  // user wrote `var c chan int; c <- 1`
  lock(&c.lock)
  if c.closed: panic("send on closed")
  if sg := c.recvq.dequeue(); sg != nil:
    send(c, sg, ep, ...)            // direct hand-off to receiver, no buffer
    return true
  if c.qcount < c.dataqsiz:
    typedmemmove(...)              // enqueue into ring buffer
    c.qcount++; unlock; return true
  if !block: unlock; return false   // select non-blocking
  enqueue this g onto c.sendq
  gopark(chanparkcommit, &c.lock, ...)
  // ... wakes here after a receiver did goready ...
```

You can verify the rewrite by running `go build -gcflags='-m=2'` or by looking at the SSA dump (`GOSSAFUNC=main go build`) — you'll see the `runtime.chansend1` call where your `ch <- v` was.

**Follow-up:** Why a wrapper `chansend1` instead of calling `chansend` directly? Answer: the wrapper exists because the compiler's call site needs a stable signature regardless of whether the send blocks. `chansend1` (blocking send), `selectnbsend` (non-blocking, the `case ch <- v:` form), and `chansend` (internal, takes a `block bool`) keep the compiler-visible API small and the internal API expressive. Same pattern for `chanrecv1`/`chanrecv2`/`chanrecv`.

---

### Q7. What's `getg()` and why is it everywhere in runtime code?

**Short answer:** `getg()` returns the *current goroutine* — a `*g`, the struct that holds the goroutine's stack, state, scheduling fields, defer chain, panic chain, and pointer to its `m` (OS thread). Most runtime functions need it: to park the current goroutine on a queue, to check the current `m`'s `p`, to walk the defer chain, to record a profile sample against the right goroutine. It's a compiler intrinsic — not a normal function call — because on most architectures the current `g` lives in a dedicated register (R14 on amd64, R28 on arm64), and `getg()` is rewritten by the compiler to read that register. That's why you'll never find `func getg()` defined as Go in `runtime` — the body is the compiler.

**Follow-up:** What's the difference between `getg()` and `getg().m.curg`? Answer: subtle and important. `getg()` returns whatever `g` is *currently running on this thread* — which might be `g0` (the system goroutine for this `m`) if you're inside the scheduler. `getg().m.curg` is the *user* goroutine that this `m` is supposed to be running, even when you're temporarily on `g0`. Code that wants "the goroutine the user thinks they're in" uses `getg().m.curg`; code that wants "what's executing right now" uses `getg()`.

---

### Q8. When does the compiler insert calls into the runtime?

**Short answer:** Whenever a Go-level operation doesn't have a direct machine instruction. The full list is in `cmd/compile/internal/typecheck/builtin/runtime.go` — the runtime's "public-to-the-compiler" API. Common ones: `go f()` → `runtime.newproc`. `make(map[K]V, n)` → `runtime.makemap` (or `makemap_small`). `m[k] = v` → `runtime.mapassign_*` family. `delete(m, k)` → `runtime.mapdelete_*`. `for k, v := range m` → `runtime.mapiterinit` + `runtime.mapiternext`. `make(chan T, n)` → `runtime.makechan`. `ch <- v` → `runtime.chansend1`. `<-ch` → `runtime.chanrecv1` or `chanrecv2`. `defer f()` → `runtime.deferproc` (or open-coded inline for simple cases since 1.14). `panic(x)` → `runtime.gopanic`. `recover()` → `runtime.gorecover`. Type assertions, interface conversions, growable slice writes, string-to-byte-slice conversions, all of them call into runtime helpers.

**Follow-up:** How do you confirm what the compiler is doing for a specific statement? Answer: `go build -gcflags='-S' file.go` dumps the assembly with runtime calls visible. Or `go build -gcflags='-m=2'` for escape and inline decisions. Or `GOSSAFUNC=YourFunc go build` to get the SSA HTML showing every rewrite pass.

---

### Q9. Explain `gopark` and `goready`.

**Short answer:** These are the scheduler's "park me" / "wake them" primitives. `gopark(unlockf, lock, reason, traceEv, traceskip)` puts the current goroutine into a waiting state and gives control back to the scheduler. The caller supplies a `lock` they hold and an `unlockf` callback that the scheduler invokes *after* parking the goroutine — this is how you atomically (a) enqueue yourself onto a wait list and (b) drop the lock you hold, without a race where someone reads the empty list and never wakes you. The order is critical: park first (state set to `Gwaiting`), then unlock; if anyone is racing to wake you, they'll see the parked state and call `goready`. `goready(gp, traceskip)` puts a previously parked goroutine back onto a runnable queue — typically called by whoever holds the matching wakeup condition (the sender to a parked receiver, the unlocker of a contended mutex, the timer firing). Both functions are written in Go but use `mcall` to switch onto `g0` because parking and rescheduling can't run on the goroutine's own stack — that stack is about to go cold, and continuing to use it after the goroutine is `Gwaiting` violates the scheduler's invariants.

**Follow-up:** Why do channels park via `gopark` while mutexes use `semacquire`? Answer: the layers differ. `gopark` is the *scheduler-level* primitive — it's what everything ends up calling. `runtime.semacquire` is a higher-level building block on top of `gopark` that implements counting semaphores; `sync.Mutex` is built on `semacquire`. Channels go straight to `gopark` because they manage their own wait queue (`c.sendq`/`c.recvq`) and don't need a generic semaphore. Timers, network poll, `runtime.Gosched` — each picks the right layer; reading `sema.go` and `chan.go` side by side shows the design choice.

---

### Q10. What's `//go:linkname` used for?

**Short answer:** `//go:linkname localname importpath.remotename` tells the linker "the symbol named `localname` in this file is actually `remotename` in `importpath`." It's how the runtime exposes private functions to *other* standard library packages without making them public — `sync` calls `runtime.semacquire` via linkname, `time` calls runtime timer code via linkname, `os` calls runtime signal helpers via linkname. The directive is an escape hatch, not a public API, and the compiler now requires the `unsafe` import to use it. Outside the stdlib, third-party packages used to abuse linkname to reach into runtime internals — every major Go release breaks a few of them as the runtime evolves. Go 1.23+ added stricter rules; Go 1.24+ further restricted linkname to only allow it when the *target* file uses `//go:linkname` matching back, in many cases. The trend is clear: linkname into runtime is an evaporating affordance.

**Follow-up:** How do you find every place runtime is exposed via linkname? Answer: `grep -r 'go:linkname' $GOROOT/src/runtime/`. You'll see the runtime's "linkname API" — functions like `runtime_Semacquire`, `runtime_notifyListAdd`, `time_now`, `poll_runtime_pollWait`. These are the contracts other stdlib packages depend on, and they're as close as runtime gets to a "stable internal API." If your linkname target is on this list, you're at least using something the runtime team is aware is being observed; if it's not, you're depending on a private name that may evaporate.

---

### Q11. What's `g0`?

**Short answer:** Every `m` (OS thread) has a special goroutine called `g0` whose stack is the *system stack* — a real OS thread stack, typically 8 MB on the main thread and ~32 KB on cgo-created threads, not the small growable user-goroutine stack. The scheduler runs on `g0`. GC mark/sweep workers transition to `g0` for some operations. Signal handlers run on `g0`. The `g0` stack exists so that runtime code which can't tolerate stack growth (because growth itself calls runtime) has a guaranteed-large stack to work in. User code never runs on `g0`. When you see `mcall(fn)` or `systemstack(fn)` in runtime source, that's an explicit switch to `g0` to run `fn`. Reading the runtime without knowing the `g0` discipline produces baffling questions like "why is this function not allowed to allocate?" — the answer is usually "because it runs on g0 and is in a context where allocation would re-enter the scheduler."

**Follow-up:** What's the difference between `mcall` and `systemstack`? Answer: `mcall(fn)` switches to `g0`, calls `fn(gp)` where `gp` is the goroutine that was running, and *never returns* to the caller — `fn` is expected to schedule the next goroutine. `systemstack(fn)` switches to `g0`, runs `fn`, switches back, and returns. Use `systemstack` when you just need a big stack for a function; use `mcall` when you're parking the current goroutine and giving up control. A third sibling, `asmcgocall`, switches to `g0` to call into C code without confusing the Go scheduler about stack ownership.

---

### Q12. Why doesn't runtime use normal Go features in some files?

**Short answer:** Bootstrap and reentry constraints. (1) **The runtime implements `make`, so it can't use `make`.** Same for `new`, channels, maps, defers in some paths. (2) **Allocating triggers the GC**, and the GC is itself in runtime — allocating inside GC code is either a deadlock or a correctness bug. (3) **Stack growth calls runtime**, so functions that *implement* stack growth must be `nosplit` and can't trigger growth themselves. (4) **Write barriers schedule GC work**; functions that run inside the write-barrier path can't issue write barriers (`//go:nowritebarrier`). The upshot: scheduler code, allocator code, and GC code read like a peculiar dialect of Go — no slice literals, no closures (closures allocate), no maps, no `defer`, manual goroutine management. It's still Go syntactically; it's a constrained subset semantically.

**Follow-up:** Is there documentation of which features are off-limits? Answer: `runtime/HACKING.md` in the Go source is the closest thing. It documents the system stack, the `g0` discipline, the write-barrier rules, and the compiler intrinsics. Read it before contributing anything to runtime.

---

## 4. Senior questions (Q13–Q20)

### Q13. How would you find the file responsible for a specific behaviour — "what code runs when defer fires"?

**Short answer:** Four techniques in order of speed.

1. **Compiler intrinsics list first.** Open `cmd/compile/internal/typecheck/builtin/runtime.go` (alias source for the runtime functions the compiler can call). Search for `defer` — you'll find `deferproc`, `deferprocStack`, `deferreturn`. That tells you the entry points; now you grep `runtime/` for those names.
2. **Annotated trace.** Run a tiny reproducer with `GODEBUG=tracebackancestors=1` or with `runtime/trace` enabled. Look at the stack trace at the moment defer fires; the frames *are* the runtime functions involved.
3. **Strategic grep.** `grep -rn 'defer' $GOROOT/src/runtime/*.go | grep -i func`. `panic.go` holds the bulk of `gopanic`, `gorecover`, `deferreturn`. Once you find one function, follow calls outward.
4. **Compiler dump as ground truth.** `go build -gcflags='-S' ./pkg 2>&1 | grep CALL.*defer` shows the actual call sites the compiler emitted. This is unambiguous — whatever you find here is what your binary does. If your `-S` output has no `deferproc` call, the compiler open-coded the defer, and reading `deferproc` is irrelevant to that specific code path.

For defer specifically: `runtime.deferproc` (in `panic.go`) is called by the compiler at the point of the `defer` statement. `runtime.deferreturn` is called at the end of the deferring function. The compiler inlines simple defers since 1.14 ("open-coded defer") — they don't go through `deferproc` at all, they're just inline code with a bitmask in the function's stack frame, and `runtime.deferreturn` walks that bitmask at exit instead of a linked list. Knowing this saves you from misreading: a `defer` in tight code doesn't allocate, doesn't call `deferproc`, won't show up in your search. The threshold for open-coded vs heap-allocated defer also changed across releases (1.14 introduced it, 1.22 widened eligibility); check the relevant `panic.go` for your version.

**Follow-up:** What if grep gives too many hits? Answer: filter by `func ` prefix to find definitions, not callers. Or use `go doc -src runtime.deferproc` to jump straight to the definition. Or open the file in an editor with `gopls` and let it navigate by symbol. For "find every caller", `gopls call-hierarchy` works on runtime symbols if `GOROOT` is in your workspace.

---

### Q14. How do you read scheduler code under contention?

**Short answer:** Reading `proc.go` linearly is hopeless — it's 6,000+ lines and the call graph is dense. Four reading strategies.

1. **Start at `schedule()` and `findRunnable()`.** These are the loop and the work-finding heart of the scheduler. Every M, when it has nothing to do, lands in `findRunnable` looking for a goroutine; understand that function and 60% of the scheduler clicks. The function itself is long, but its structure is a checklist: local runq, global runq, network poller, steal from other Ps, park. Read each branch as a separate question.
2. **Read by transition, not by file.** Make a list of state transitions you care about (`Grunnable` → `Grunning`, `Grunning` → `Gwaiting`, `Gwaiting` → `Grunnable`, goroutine creation, goroutine exit) and trace each one through. The states are defined in `runtime2.go`; transitions live in `proc.go`. The state graph is small (~10 states); pinning it down before diving in saves hours.
3. **Use the trace to anchor.** Run a contended workload with `runtime/trace`, open the trace in `go tool trace`, find the events you care about, then map each event class back to its emitter in `runtime/trace*.go` — that file knows which scheduler function generates each event, and that's your map into `proc.go`.
4. **Read `casgstatus` to understand state hygiene.** Every G state transition goes through `casgstatus`. The function is a CAS plus assertions; reading it once shows you what invariants the scheduler enforces (no `Gwaiting` → `Gdead` directly, no skipping `Grunnable`, etc.). Those invariants are the implicit contract of the rest of `proc.go`.

For contention specifically, focus on `runqsteal`, `runqgrab`, `globrunqget`, `wakep`, `handoffp`. Those implement work-stealing and the "park P / wake M" decisions; that's where contention behaviour lives. Reading them alongside a contention profile (`pprof -block`, `pprof -mutex`) makes the code make sense — block profile shows what blocks; mutex profile shows lock contention; the source shows why.

**Follow-up:** Any prerequisite reading? Answer: the design doc "Scalable Go Scheduler Design Doc" by Dmitry Vyukov (2012) is still 80% accurate. Read it before `proc.go` and the M/P/G model will be familiar. The asynchronous preemption work from 1.14 ("Proposal: Non-cooperative goroutine preemption" by Austin Clements) is the second-most useful doc — it explains why signals get involved in scheduling, which is otherwise mystifying when grep-reading `proc.go`.

---

### Q15. What's the relationship between `runtime/trace` events and source events?

**Short answer:** `runtime/trace` is *part of* the runtime — `runtime/trace.go` and related files emit binary events from inside the scheduler, the GC, and the allocator. Each event type (e.g. `traceEvGoStart`, `traceEvGCStart`, `traceEvProcStart`) is emitted from exactly one or two call sites in the runtime. So a trace event is a *direct breadcrumb* back to runtime source: see `traceEvGoStart` in a trace, grep for `traceEvGoStart` in `runtime/`, find the emitting line, read the surrounding function. This makes the trace far more useful than a profile for source reading — a profile aggregates and obscures origin; a trace points at specific code that ran at a specific time on a specific goroutine.

Concrete workflow. (1) Run with `runtime/trace.Start(f)` around the workload. (2) `go tool trace trace.out` opens the UI. (3) Find an event you want to understand — a GoBlock, a GCSweep, a ProcStart. (4) Note the event name. (5) Grep for that constant in `$GOROOT/src/runtime/` — the emit site is the function you wanted. (6) Read the surrounding function with the trace timeline open as context: you know *when* this code ran, *which* goroutine, and *what* it transitioned to.

**Follow-up:** Where's the canonical mapping from event to emitter? Answer: `runtime/trace.go` defines the event constants and the encoding. Each emitter calls `traceEvent(traceEvX, ...)`. So `grep traceEvGoStart $GOROOT/src/runtime/` lands you on every emit site — usually one or two — and from there the function around it is the scheduler code you wanted to find. Go 1.21+ rewrote the trace format ("trace2") for efficiency and to support flight recording; the same principle applies to the new emitters in `runtime/tracetype.go`, `runtime/traceevent.go`, and friends. The constants are renamed (e.g. `traceEvGoStart` → `traceEvGoStartLocal` in some paths) but the technique is unchanged: event name in the trace → grep in runtime → emit site → context function.

---

### Q16. How would you investigate a "GC pause spike" using runtime source?

**Short answer:** Five steps grounded in the source.

1. **Confirm the spike.** Enable `GODEBUG=gctrace=1`, observe the line for the bad cycle. `gctrace` output is generated in `mgc.go:gcMarkDone` / `gcStart` / `gcSweep`; understanding the line means reading `mgc.go` once. The line fields (`# @s elapsed, ## ms clock, ## ms cpu, ## MB heap → ## MB`) all map to named fields in `gcController` and `work` structs.
2. **Locate the phase.** GC has roughly four phases: sweep termination, mark, mark termination, sweep. The `gctrace` line tells you which one dominated the pause. Mark termination is the historic offender — it's stop-the-world; sweep termination is also STW but typically much shorter.
3. **Read the phase code with the trace open.** `gcMarkTermination` is in `mgc.go`. Read it with `go tool trace` open showing the GC events; the function calls correspond 1:1 to the trace markers (`GCMarkAssistStart`, `GCSweepStart`, etc.).
4. **Check the assist path.** If your workload allocates fast, the spike might be in assist, not in STW. `gcAssistAlloc` (also in `mgc.go`) is the entry; `gcAssistAlloc1` is the worker loop. Allocation-heavy hot paths can starve assist credit and produce wall-clock pauses from the user goroutine's perspective without long STW pauses. The user thinks "GC pause"; the source shows "you owed mark work and we made you pay it inline."
5. **Cross with the pacer.** The pacer in `mgcpacer.go` decides when to start GC and how much work to schedule per allocation. A "spike" can be a pacer miss — GC started late because the pacer underestimated allocation rate. Reading `(*gcControllerState).revise` shows the heuristic; pathological workloads (bursty allocation) defeat it predictably.

Cross-reference with `runtime.ReadMemStats` — `PauseNs`, `PauseTotalNs`, `NumGC`, `GCCPUFraction` come straight from runtime fields you can find by grepping. Knowing where the numbers live in source lets you write a high-cardinality dashboard that matches what the runtime reports. Go 1.19+ added `runtime/metrics` with a more stable surface; prefer it for new dashboards.

**Follow-up:** When does reading mgc.go *not* help? Answer: when the workload is allocation-rate-bound. The pause itself is fine; you allocate too fast, GC runs too often, and aggregate GC CPU dominates. That's a heap-profile question (`pprof -alloc_space`), not an mgc.go question. Read source when you suspect a phase is mis-tuned or a specific path is pathological; read profiles when the rates are off. The other case where source doesn't help: `GOMEMLIMIT` interactions with the pacer — those are documented in `runtime/mgc.go` comments but the behaviour is emergent across the pacer, the sweeper, and OS memory return; you usually need to measure rather than reason from source.

---

### Q17. How do you safely cross-version compare runtime code?

**Short answer:** Runtime evolves more than any other stdlib package — file structure changes, functions are renamed, optimizations are added that change the call graph. Three rules.

1. **Anchor on a specific tag.** `git -C $GOROOT log --oneline -- src/runtime/proc.go | head -20` shows recent changes. Always read source pinned to a Go version that matches your binary. `go version` then `git checkout go1.22.6` in a Go source clone.
2. **Diff with semantic awareness.** `git log -p --follow src/runtime/proc.go` follows renames. For larger restructures (Swiss-table maps in 1.24, GC rewrites, scheduler tweaks across minor versions), read the release notes first to know which big rocks moved before you diff.
3. **Test claims against your version.** "I read on the internet that runtime does X" — verify against `$GOROOT` for the version you actually ship. Don't trust blog posts older than two releases for runtime details.

The single biggest cross-version gotcha is the *map implementation*. Pre-1.24 reads on `map.go`; 1.24+ reads on `map_swiss.go` for the new Swiss-table-based map. The old file may still exist with the bucket-based implementation behind a build flag during transition. Run `go env GOEXPERIMENT` and check `go doc` to confirm which is active.

**Follow-up:** What about reading the master branch instead of your version? Answer: useful for "where is this going" but dangerous for "how does this work today." A function that exists on master may not yet ship, may be behind an experiment flag, or may have just been rewritten. Always cross-reference master findings against the tagged version your binary uses.

---

### Q18. When is reading runtime *tests* more productive than reading runtime code?

**Short answer:** Often. The tests in `runtime/*_test.go` are written to be readable — they construct a minimal scenario and assert on observable behaviour, which is exactly what you'd hand-build to understand a feature. Four cases where tests beat code:

1. **Observable contracts.** "What guarantees does `runtime.Goexit` give about defers?" — `runtime/proc_test.go` has tests demonstrating each invariant. The code in `panic.go` shows *how*; the test shows *what*.
2. **Edge cases.** Tests enumerate the corner cases the implementation must handle — empty channels, nil receivers, panics inside finalizers, closed channels with pending senders. Code paths handle them implicitly; tests name them explicitly.
3. **Reading "by example."** When you can't follow a 200-line function, find a test that exercises it and step through the test in `dlv`. The test gives you concrete inputs; the function suddenly makes sense.
4. **Discovering invariants the code assumes but doesn't state.** A test that says `// must not leak goroutines` followed by 50 lines of setup reveals an invariant that the runtime function it tests assumes but never documents. The test is often the only place that contract is written down.

Tests also encode performance contracts — `BenchmarkChanContended` in `runtime/chan_test.go` tells you what "fast" means for channels. The runtime team won't merge a regression to those benchmarks, so they're a stable contract. Reading the benchmark numbers in CI history (visible on `perf.golang.org`) shows performance evolution release-over-release in ways no doc captures.

**Follow-up:** Any tests that are themselves famous? Answer: `TestStackGrowth` (`runtime/stack_test.go`) is the canonical demo of recursive stack growth and copying. `TestGCSys` is the historic "GC must not leak system memory" test. `TestSelectStress` exercises the trickiest path in the scheduler. `TestGoroutineParallelism` exercises `GOMAXPROCS` invariants. Read these four and you've seen the runtime team's pain points.

---

### Q19. Compare reading runtime to reading `net/http` — what techniques transfer?

**Short answer:** Some, but the differences matter more.

**What transfers.** (1) Start with the public surface — exported functions and types. For `runtime` that's a short list; for `net/http` it's `Handler`, `Server`, `Client`, `Request`, `ResponseWriter`. (2) Follow the call graph from public to internal. (3) Read the tests to anchor understanding. (4) Use a debugger to step through real scenarios. (5) Use `gopls` for symbol navigation — works equally on both.

**What doesn't transfer.** (1) `net/http` is purely library code; you can grep your way through it. `runtime` has hidden compiler-inserted callers — grep doesn't show them. (2) `net/http` uses normal Go — goroutines, channels, defers, slices, maps. `runtime` uses a constrained subset with compiler annotations. (3) `net/http` is layered: handler → server → transport → connection → syscall. `runtime` is mutually recursive: the scheduler calls the allocator calls the GC calls the scheduler. You can't read it "top down" because there's no top. (4) `net/http` is mostly stable across releases; `runtime` rewrites itself every few releases. The reading you did last year may be obsolete. (5) `net/http` failures usually surface as Go-level errors; runtime failures surface as `runtime:` panics or fatal errors that bypass `recover` entirely.

The practical implication: in `net/http`, "I understand this file" is a real claim. In `runtime`, "I understand this *transition*" is a real claim — file-level understanding doesn't compose cleanly because functions are scattered by concern (scheduler logic is spread across `proc.go`, `mgc.go` for GC-related transitions, `chan.go` for channel-related transitions, and so on).

**Follow-up:** What's the closest stdlib analog in difficulty to runtime? Answer: `reflect` and `sync/atomic`. `reflect` because it knows about Go's type representation at the runtime level and links into runtime functions extensively via linkname. `sync/atomic` because it's mostly assembly with Go shims. Both share runtime's "compiler is part of the implementation" property — though to a lesser degree. `crypto/internal/*` is the third — performance-critical assembly with strict invariants.

---

### Q20. How would you use `dlv` to step through runtime code?

**Short answer:** Four techniques.

1. **Break on a runtime function from your binary.** `dlv exec ./mybin`, then `break runtime.chansend1`, then `continue`. When it hits, `step` and `next` walk through the runtime function as if it were your code. You see locals, you can `print` variables — `gp` for the goroutine, `c` for the channel.
2. **Set breakpoints by file:line in `$GOROOT/src/runtime/`.** `break /usr/local/go/src/runtime/chan.go:215`. Dlv resolves runtime source automatically if `GOROOT` is set correctly.
3. **Inspect goroutines.** `goroutines` lists every goroutine with its state, and `goroutine N` switches to it. This is the only way to inspect a parked goroutine — you can see its stack, its waiting reason, what it's blocked on. `goroutine N bt` prints a full traceback for goroutine N without switching to it.
4. **Conditional breakpoints to skip noise.** `break runtime.chansend1` then `condition <bp-id> c.qcount == 0` only breaks when the channel buffer is empty. Critical for runtime code where the breakpoint hits thousands of times per second.

Caveats. (a) **Optimized builds confuse dlv.** Some lines are reordered or elided. Build with `-gcflags='all=-N -l'` to disable optimizations and inlining for clean stepping — but realize you're now debugging a different binary than production. (b) **`//go:nosplit` functions sometimes have weird debug info.** You may see `<optimized out>` for locals even with `-N -l`. (c) **Assembly frames are unfriendly.** When you step into `runtime.mcall`, you're in assembly and dlv's `step` becomes per-instruction. Use `stepout` to escape assembly back to Go. (d) **dlv attaches stop the world for the dlv process duration**, which can mask the very race you're trying to catch.

For deep work, combine dlv with `GODEBUG=schedtrace=1000` running in the background — dlv shows the current state, schedtrace shows the trend.

**Follow-up:** What's the safest way to debug a production-only runtime issue? Answer: capture a core dump in production (`GOTRACEBACK=crash`, plus kernel core dump settings — `ulimit -c unlimited` and `/proc/sys/kernel/core_pattern` on Linux) and post-mortem-debug it with `dlv core ./mybin core.NNN`. Live attach to production is rarely worth the latency hit and the risk; cores let you read the whole goroutine and heap state without touching the running service. The runtime emits enough info into the core that `dlv core` can show every goroutine's stack and current waiting reason — which is usually 80% of what a live attach would have given you.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. Argue when reading runtime source is a waste vs essential.

**Short answer:** Essential when (a) the question's answer changes how you write code in your codebase — e.g. understanding open-coded defer changes how you write hot-path APIs; (b) you're debugging an issue where the runtime is in the stack trace and the public docs don't say enough; (c) you're building a tool that observes runtime state (profiler, tracer, hot-reloader); (d) you're contributing to the runtime; (e) you're teaching someone Go's execution model and want to ground the abstraction in code. Waste when (a) the question is "is X faster than Y?" — benchmark, don't read; (b) you're trying to "understand Go better in general" — pick a real project and read what it forces you to read; (c) the version you're reading isn't the version you're running; (d) you'd be substituting source reading for `go doc`, `pprof`, or `runtime/trace`, which would have answered the question in five minutes; (e) you're reading to look impressive in code reviews — source-citation theater is a waste of everyone's time.

The decision rule: if the answer to "what will I do differently after reading this?" is concrete and specific, read. If it's vague ("understand it better"), don't — pick a tighter question first.

**Follow-up:** When is reading necessary but not sufficient? Answer: scheduler tuning. Reading `proc.go` tells you what `GOMAXPROCS`, `GOGC`, `GOMEMLIMIT` do; it does *not* tell you what *your* workload needs. You read to know the levers; you benchmark to know which lever to pull. Reading without measuring is theoretical; measuring without reading is cargo cult. Both, in that order, for any tuning that matters.

---

### Q22. Critique the runtime's coding style.

**Short answer:** Five honest critiques.

1. **Function length.** Many runtime functions are 300+ lines with deep nesting and no helper extraction. `findRunnable` in `proc.go` is famous. The defense is "the runtime team measures inlining and cache locality"; the cost is readability for outsiders.
2. **Single-letter variable names.** `gp`, `mp`, `pp`, `c`, `n`. Idiomatic for runtime, hostile to new readers. The convention is consistent (`gp` is always a `*g`, `mp` a `*m`), but the cost is a learning ramp.
3. **Implicit invariants.** Runtime functions assume things about caller context — "must be called on g0", "must hold sched.lock", "caller's stack must not grow" — and these are documented in comments above the function (when at all), not encoded in the type system. A misuse panics at runtime in a hard-to-debug way.
4. **Annotation soup.** `//go:nosplit //go:nowritebarrierrec //go:systemstack` on a single function. Each is necessary, but the combinations are stacking constraints that aren't obvious from reading.
5. **Inconsistent helpers.** Some operations have a small helper (`fastrand`, `mallocgc`); others are open-coded everywhere. Refactoring is rare because performance must be preserved bit-exactly.

**Defense.** The runtime is a performance-critical, never-restarted, embedded-in-every-Go-program system. Conventions that prioritize predictability and inlining over readability are correct for that brief. Style guides for application code shouldn't be ported wholesale to runtime.

**Follow-up:** Has any of this been addressed? Answer: marginally. Go 1.20+ added more inline comments around invariants. The 1.24 map rewrite (`map_swiss.go`) has noticeably clearer factoring than `map.go`. But the broad style is stable — and pragmatic, given the constraints.

---

### Q23. What would you propose to make runtime easier to read?

**Short answer:** Six proposals, ordered by likely return.

1. **One-page "reading order" doc.** A `runtime/READING.md` that says "start at `runtime2.go` for types, then `proc.go:schedule`, then follow these N transitions." The current `HACKING.md` is contributor-focused; a reader-focused index would lower the entry barrier dramatically.
2. **Annotated call graphs for key paths.** A picture (or rendered text diagram) of "what runs when you send to a channel" or "what runs during a GC cycle." Doesn't change code; changes onboarding time from weeks to days.
3. **Invariant assertions as code.** Where runtime says "// caller must hold sched.lock", make it an actual `assertWorldStopped()` or `assertLockHeld(&sched.lock)` call. Many already exist; extending the coverage costs little and documents in a way readers can't miss.
4. **Stable subset boundaries.** Distinguish "stable runtime API" (the linkname targets that other stdlib packages depend on) from "implementation churn." Today a 1.x → 1.(x+1) upgrade can rename a deep internal; if the public-to-stdlib surface were documented as such, the rename's blast radius would be obvious.
5. **Per-event source maps for trace.** The `runtime/trace` parser already knows which event came from where in source; expose that mapping as a tool ("trace event → source location") so investigators can jump from a trace view to runtime source.
6. **Slim "narrative" files.** Where conventions allow, extract the *narrative* of a function (steps 1, 2, 3) into commented pseudocode at the top, with the optimized code below. Readers get the algorithm without the inline-hostile rewrites obscuring it.

None of these change semantics. All of them lower the cost of newcomers learning runtime, which is currently the single largest barrier to outside contribution.

**Follow-up:** Which of these would the runtime team accept today? Answer: #3 (more invariant assertions) and #1 (READING.md) are the lowest-friction. #2 (call graphs) and #5 (event-to-source maps) need a maintainer to own them. #4 (stable surface) requires a community RFC. #6 (narrative comments) is style-controversial.

---

### Q24. How do you train juniors to read runtime?

**Short answer:** Five stages, weeks apart, each with a concrete deliverable.

1. **Concept layer first, no source.** Pair them with the M/P/G model on a whiteboard. Have them explain "what happens when you call `go f()`" three times before opening a file. Without the model, the file is gibberish.
2. **`runtime2.go` reading.** Just the types. `g`, `m`, `p`, `sched`, `mheap`, `mspan`. Have them draw the diagram of which struct points to which. Deliverable: a one-page diagram.
3. **One transition end-to-end.** Pick "channel send to a parked receiver." Have them trace from `ch <- v` in user code through `chansend1`, `chansend`, the `recvq` dequeue, `goready`, the receiver waking up. Deliverable: a written paragraph of the call path with line numbers.
4. **One mystery debug.** Give them a real bug — a deadlock, a leak, a pause spike — and require they cite the runtime function involved. Deliverable: a postmortem.
5. **One contribution-class question.** Have them propose a small runtime change (a new GODEBUG flag, a clarifying comment, a missed inlining opportunity). They don't have to ship it, but they have to defend the proposal in source terms. Deliverable: a written proposal.

The error mode is asking juniors to "read runtime" with no scaffolding — they bounce off `proc.go` in an hour and conclude they're not smart enough. The fix is constrained exercises with concrete deliverables.

**Follow-up:** What if they want to skip ahead? Answer: it's fine, but require they pass the diagram check (`runtime2.go` types) before opening `proc.go`. The diagram is the prerequisite for everything else; skipping it costs hours later.

---

### Q25. Discuss the trade-off of using `//go:linkname` into runtime from your own code.

**Short answer:** It's almost always wrong, with two exceptions.

**The case against (default).** (1) **Stability** — runtime internals are not API; linkname targets get renamed, removed, or restructured every release. Your code breaks on every Go upgrade. (2) **Safety** — runtime functions assume invariants (called on `g0`, holding a lock, no preemption) that you can't replicate from outside; calling them from user code can corrupt scheduler state. (3) **Compiler trust** — the Go team has explicitly tightened linkname rules in 1.23/1.24 because too many ecosystem libraries (notably some hot-reload and observability tools) were reaching into runtime and getting away with it for a release or two. (4) **No `go vet`, no `go doc`, no IDE** — the symbol you linkname'd isn't visible to anything that helps you reason about correctness.

**Exceptions.** (1) **You are stdlib.** `sync`, `time`, `os` use linkname into runtime by design. (2) **You are writing a profiler or debugger** and the runtime exposes the symbol *intentionally* via documented linkname targets (`runtime_Semacquire`, `runtime/pprof`'s internal API). Still risky, but defensible because the runtime team is aware those names are observed.

**For everyone else,** the cost is a guaranteed maintenance burden, breakage on minor version upgrades, and the chance of subtle scheduler corruption. The benefit is some feature you couldn't otherwise build. Almost always, the right answer is to file an issue with the Go team proposing a public API, or to find a less invasive design.

**Follow-up:** What about `linkname` to *expose* internal functions of your own package? Answer: different beast. Within your own module, `linkname` for "expose a private function across packages for testing" is legitimate but ugly. Prefer the `internal/` package convention; use linkname only when `internal/` isn't enough (rare).

---

## 6. What NOT to say

These phrases tank an interview.

- **"I've read all of `runtime`."** No, you haven't. The honest claim is "I've read `proc.go`'s `schedule` and `findRunnable`, plus the channel send and receive paths." Be specific. Claiming exhaustive knowledge of a 6,000-line scheduler file plus a 5,000-line GC plus everything else is a red flag, not a strong signal.
- **"The runtime is just Go."** It isn't. It's a Go dialect with `//go:nosplit`, `//go:linkname`, assembly bridges, and compiler intrinsics. Saying "it's just Go" signals you haven't actually read it.
- **"`getg()` is a function."** It's a compiler intrinsic. Saying "function" misses why it's so cheap (a register read, not a call).
- **"`g0` is the main goroutine."** No. The main goroutine is the one running `main.main`. `g0` is a per-`m` system goroutine that hosts the scheduler. Conflating them gets corrected in the first follow-up.
- **"I'd just use `dlv` to step through."** Maybe — but `dlv` on optimized builds is unreliable for runtime, and you should know that before you say it. Mention `-gcflags='all=-N -l'` if you bring up dlv.
- **"The compiler doesn't really insert code."** It does, extensively. `go f()`, `make`, `defer`, `panic`, channel ops, map ops, type assertions, interface conversions, range over map — all become runtime calls.
- **"`//go:linkname` is fine to use."** Mostly not. The default answer is "avoid it." Exceptions are stdlib and a small set of observability tools.
- **"I'd read the master branch."** Maybe — but the version you ship is the version you should read. Master may have rewrites that don't reflect your binary.
- **"GC is just mark and sweep."** Go's GC is concurrent, has a write barrier, assist mechanism, and is tuned by `GOGC` and `GOMEMLIMIT`. "Just mark and sweep" misses the parts that actually cause your pauses.
- **"The scheduler is preemptive."** Partially. Pre-1.14 it was cooperative — preemption only at function preamble. Since 1.14 there's asynchronous preemption via signals (`SIGURG`). If you say "preemptive" without that nuance, the interviewer probes.
- **"You can hot-patch the runtime."** Effectively no, in normal Go. The functions are compiled and inlined; there's no plugin point. Don't pretend.
- **"I've never opened the runtime."** Honest, but if the interview is about runtime, you're done. Be honest with a recovery: "I haven't, but I know the M/P/G model and I'd start at `runtime2.go` for types and `proc.go:schedule` for the loop."
- **"Maps are just hash tables."** Pre-1.24 they're bucket-based with overflow chains; 1.24+ they're Swiss tables. Both are hash tables, but the implementations differ in cache behaviour, growth, and the rules around iteration-during-insert. "Just a hash table" misses why map performance changed at 1.24.
- **"Channels are lock-free."** They aren't — every operation acquires `c.lock`. They're well-tuned with fast paths but the lock is real and shows up in mutex profiles of contended workloads.
- **"Defers are slow."** They were before 1.14. Open-coded defers (1.14+) are roughly free for the common case of a fixed number of defers in a function. Quoting pre-1.14 numbers signals you stopped reading runtime years ago.

---

## 7. Five-minute pre-interview checklist

Run this in five minutes before the call.

- [ ] Confirm where your `$GOROOT/src/runtime/` is (`go env GOROOT`) — be ready to name the path.
- [ ] Name `g`, `m`, `p` in one sentence each. (`g` = goroutine state; `m` = OS thread; `p` = scheduling context with run queue.)
- [ ] State the file each of these lives in: scheduler (`proc.go`), channels (`chan.go`), GC core (`mgc.go`), allocator (`malloc.go`), panic/recover/defer (`panic.go`), type definitions (`runtime2.go`), maps (`map.go` pre-1.24, `map_swiss.go` 1.24+).
- [ ] Name three `//go:` annotations and what each does. (`nosplit`: no stack-growth check; `linkname`: rename symbol for linker; `systemstack`: must run on `g0`.)
- [ ] Explain `getg()` in one breath. (Compiler intrinsic that returns the current goroutine via a dedicated register.)
- [ ] Trace `ch <- v` from user code to runtime: compiler rewrites to `runtime.chansend1`, which calls `runtime.chansend`, which either copies into a waiting receiver, enqueues in the buffer, or parks via `gopark`.
- [ ] State why `runtime` can't use normal Go features in some files. (Stack growth, allocation, and write barriers all call back into runtime — paths that implement them must avoid them.)
- [ ] Name a debugging path: `gctrace=1`, `schedtrace=1000`, `runtime/trace`, `pprof`. Which answers what. (`gctrace`: GC phase breakdown; `schedtrace`: scheduler queue depths; `runtime/trace`: per-event timeline; `pprof`: aggregated profile.)
- [ ] State when reading runtime is a waste. (When `go doc`, `runtime/trace`, or a benchmark would answer the question faster, or when the version you read isn't the version you run.)
- [ ] Know the linkname rule: avoid in user code; runtime targets are unstable; stdlib uses it by design.
- [ ] Name one annotation conflict. (`//go:nosplit` plus a function that allocates is a bug — allocation can grow the stack; the compiler will fail the build via the nosplit budget check.)
- [ ] Be ready to say one thing you read recently and what you learned from it. (Specificity is the strongest senior signal.)

If you stumble on any of these, re-read the matching question above before the call.

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Doesn't know where the source lives.** Can't name `$GOROOT/src/runtime/` or the public mirror URL.
- **Confuses `runtime` with "the Go runtime" abstractly.** Treats it as a black box, not as a directory with files they could open.
- **Can't name M/P/G.** This is table stakes. Without it, none of the scheduler discussion lands.
- **Doesn't mention the compiler.** Talks about runtime as if functions are called from user code by name; doesn't grasp that the compiler inserts most of them.
- **Uses `//go:linkname` casually.** Says "yeah I linkname into runtime for X" without acknowledging the stability and safety costs.
- **No mention of `g0`.** Asked about the scheduler, doesn't bring up the system stack.
- **Reads master without knowing.** Cites behaviour that's only on master or behind an experiment flag and presents it as current.
- **Conflates `gopark` with channel-specific waiting.** Doesn't know `gopark` is the universal park primitive used by channels, mutexes, timers, select.
- **Doesn't know about open-coded defer.** Asked about defer cost, gives pre-1.14 numbers.
- **Treats GC as one operation.** Doesn't name the phases (sweep termination, mark, mark termination, sweep) or distinguish STW pauses from assist time.
- **Can't say when reading runtime is a waste.** Wants to read it for every question — signals immature judgement.
- **Treats `//go:nosplit` as a "go fast" annotation.** It's a constraint that removes the stack-growth check, not a hint to the compiler to optimize. The candidate who thinks it's a free win hasn't read the budget rules.
- **Never opens the runtime directory but cites blog posts confidently.** Blog-derived knowledge of runtime ages out in two releases.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Names the file for the question.** "Defer? That's `panic.go`, plus open-coded defer in the compiler." "GC pause? `mgc.go:gcMarkTermination`."
- **Brings up the compiler unprompted.** "When you write `ch <- v`, the compiler rewrites that to `runtime.chansend1`." Recognises that runtime and compiler are co-designed.
- **Knows the `//go:` annotation family.** Names two or three, explains what each does and why it exists.
- **Distinguishes `getg()` from `getg().m.curg`.** Knows when each applies.
- **Names `g0` correctly.** System stack per `m`, scheduler runs here, user code doesn't.
- **Anchors source reading in observability.** "I'd start with `runtime/trace` to find the event, then jump to the emitter in source." Knows the relationship between trace events and source.
- **Honest about cross-version risk.** Pins their answer to a specific Go release; acknowledges that runtime evolves.
- **Mentions tests as reading material.** Knows `runtime/*_test.go` is often clearer than the implementation.
- **Reaches for `dlv` with caveats.** Knows optimized builds are fragile in dlv and adjusts the build flags.
- **Names when reading is wasteful.** Recommends `go doc`, `pprof`, `runtime/trace`, or a benchmark before opening source.
- **Critiques runtime style with respect.** Acknowledges that runtime conventions exist for performance reasons even when they're hostile to readers.
- **Cites the compiler intrinsics file by name.** `cmd/compile/internal/typecheck/builtin/runtime.go` — naming this file shows the candidate has actually navigated the runtime/compiler boundary.
- **Distinguishes phases of GC by name.** Sweep termination, mark, mark termination, sweep — and which is STW vs concurrent. Not "GC is mark and sweep."
- **Brings up `GODEBUG` flags spontaneously.** `gctrace`, `schedtrace`, `allocfreetrace`, `cgocheck`, `madvdontneed`, etc. — knowing which flag to set for which question signals operational experience.
- **Mentions Go release notes as a reading habit.** The runtime team documents big changes in release notes; tracking them is the cheapest way to stay current.

---

## 10. Further reading

- **`runtime/HACKING.md`**: `$GOROOT/src/runtime/HACKING.md` — the runtime team's own onboarding document. The system stack, write-barrier rules, and compiler intrinsics are explained. Read once before any serious runtime work.
- **`runtime2.go`**: `$GOROOT/src/runtime/runtime2.go` — the central type definitions (`g`, `m`, `p`, `sched`, `mheap`). Read once to anchor every other file.
- **"Scalable Go Scheduler Design Doc" (Dmitry Vyukov, 2012)**: <https://go.dev/s/go11sched> — the original scheduler design, still 80% accurate. Read before `proc.go`.
- **"Proposal: Non-cooperative goroutine preemption" (Austin Clements, 2019)**: <https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md> — the 1.14 async preemption design. Explains why `SIGURG` is used and what runtime invariants it preserves.
- **Go source mirror**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/> — browsable runtime source with cross-references. Pin to a release tag for reading.
- **`cmd/compile/internal/typecheck/builtin/runtime.go`**: the compiler's view of runtime — every function the compiler can call. Tells you which runtime functions are reached from user code.
- **`go tool trace` documentation**: <https://pkg.go.dev/runtime/trace> — the trace primitives and how to read the output. The trace is your best entry point into the scheduler's behaviour.
- **`GODEBUG` reference**: <https://pkg.go.dev/runtime#hdr-Environment_Variables> — the runtime's diagnostic flags (`gctrace`, `schedtrace`, `allocfreetrace`, etc.). Each one tells you which runtime path to read for that diagnostic.
- **`runtime/metrics` package**: <https://pkg.go.dev/runtime/metrics> — the stable, version-resilient surface for runtime instrumentation. Prefer over `ReadMemStats` for new dashboards.
- **"Getting to Go: The Journey of Go's Garbage Collector" (Rick Hudson)**: blog post tracking the GC's evolution; useful context for `mgc.go` reading.
- **Go release notes**: <https://go.dev/doc/devel/release> — the runtime team flags significant runtime changes here. Skim each release's "Runtime" section to keep your mental model current.
