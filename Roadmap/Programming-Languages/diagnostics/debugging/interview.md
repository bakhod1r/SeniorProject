# Debugging — Interview Questions

> **Topic:** [Debugging Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about reading stack traces, using debuggers, diagnosing races, and reasoning about failures in production.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Language-Specific](#language-specific)
4. [Tricky / Trap Questions](#tricky--trap-questions)
5. [System / Design Scenarios](#system--design-scenarios)
6. [Live Coding / Whiteboard](#live-coding--whiteboard)
7. [Behavioral / Experience](#behavioral--experience)
8. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
9. [Cheat Sheet](#cheat-sheet)
10. [Further Reading](#further-reading)
11. [Related Topics](#related-topics)

---

## Introduction

Debugging interviews split into two flavours. The first is "do you know the tools" — can you drive `gdb`, `dlv`, `pdb`, Chrome DevTools, `jstack`; can you read a stack trace; do you know what a watchpoint is. The second is "do you think like a debugger" — given a vague symptom, can you build a hypothesis, design a cheap experiment, and converge on the cause without flailing. Senior interviews lean hard on the second.

This file is the question bank. Trap questions also explain *why* the obvious instinct is wrong, because in real life the wrong instinct is the expensive part. The behavioural section is for staff and senior roles where the interviewer wants stories with shape — hypothesis, evidence, surprise, lesson — not a tools recital.

---

## Conceptual / Foundational

### Q: What's the difference between a bug and an error?

An **error** is a runtime event the program raises when something it tried to do failed — `ENOENT`, `NullPointerException`, a returned `error` value. It's a fact the program reports about its world.

A **bug** is a defect in the program itself: the code does something different from what was intended. Bugs may cause errors, suppress errors (a `catch` that swallows), or cause silent wrong behaviour with no error at all — off-by-one, wrong currency conversion, wrong sort order.

Consequence: not every error is a bug (a network timeout under load is an error the system *should* report), and not every bug produces an error (the worst bugs return the wrong answer cleanly). "No errors in the logs" is not "no bugs."

### Q: Walk me through how you read a Python stack trace top-to-bottom vs bottom-to-top.

Python prints `Traceback (most recent call last):` — outermost caller first, deepest frame last, exception at the very bottom.

```
Traceback (most recent call last):
  File "app.py", line 42, in main         ← outer
  File "app.py", line 19, in process      ← middle
  File "app.py", line 7, in charge        ← innermost
    return order.price * order.qty
AttributeError: 'NoneType' object has no attribute 'price'
```

**Bottom-up** ("what blew up"): start at the exception, read up one frame. `order.price` failed because `order` is `None`. Now ask how `None` got into the list.

**Top-down** ("who started this"): start at `main`, follow the chain. Useful when the exception class is generic (`ValueError`) and you need to know which call site initiated the broken request.

In practice you read both. Chained exceptions (`raise X from Y`) print "The above exception was the direct cause" — read each chunk bottom-up, then chain.

### Q: What is rubber-duck debugging? Does it work? Why?

You explain the broken code, line by line, out loud to an inanimate object. Halfway through you say "...and then it returns the user — wait, no, it returns the *cached* user, keyed by..." and you have the bug.

It works because most bugs are a **mismatch between your mental model and the code**, and that mismatch is invisible while you're thinking — your brain skips over it the same way you skip over a typo in your own writing. Forcing yourself to verbalise each step forces every step to be examined.

It's excellent for "I'm confused and stuck" bugs. It's useless for Heisenbugs, race conditions, environment-specific bugs, or anything whose cause is not in the code in front of you.

### Q: What's a Heisenbug? Give an example you've seen.

A bug whose behaviour changes when you try to observe it. The act of measurement perturbs the system.

Common causes: **timing** (logging slows a tight loop enough to hide a race), **optimiser** (compiling with `-O0` for gdb reorders nothing, a use-after-free crashes only in `-O2`), **memory layout** (valgrind changes allocator behaviour and the corrupted byte lands somewhere harmless), **buffering** (a `print` flushes stdout and masks a buffer-overrun symptom).

Example: a Go service occasionally returned the wrong user's profile, only in production, never with `-race`. A goroutine wrote to a map shared with a handler. `-race` slowed the writer enough that the read always lost the race and saw the old (correct) value. Reproducing required removing `-race` and adding latency to the *reader*.

### Q: What does the Go race detector actually do?

`-race` is a ThreadSanitizer implementation. The compiler instruments every memory load and store to record the accessing goroutine, the address, and a vector clock tracking happens-before. At runtime: for any two accesses to the same address from different goroutines, is at least one a write, and is there *no* happens-before edge between them (no `chan` op, no Mutex, no WaitGroup, no `sync/atomic`)? If yes — data race, print both stacks.

Key facts: it detects races that **actually happened** in this run (not absence of races); costs ~5–10× CPU and memory; sound (every reported race is real); does **not** detect *logical* race conditions that are properly synchronised but semantically wrong (e.g. check-then-act with a mutex held only for the check).

### Q: Explain `git bisect` and when you'd use it.

Binary search over commits to find the one that introduced a regression. Mark a known-good commit (`git bisect good <sha>`) and a known-bad commit (`git bisect bad HEAD`); git checks out the midpoint. Test, mark, repeat. After `log2(N)` steps you have the offending commit.

Use it when you have a deterministic pass/fail test and the diff is too large to eyeball. Power move: `git bisect run ./repro.sh` automates it (exit 0=good, 1=bad, 125=skip). Walk away, come back to the SHA.

Fails when the bug is non-deterministic (you mark a flaky run "good" and bisect lies to you), the test depends on a moving external (a retagged CI image), or intermediate commits don't build (use `git bisect skip`).

### Q: What's the difference between `step over` and `step into`?

At `result = calculate(x, y)`:

- **Step into (`s`)**: descend into `calculate`, pause at its first line. Use when you want to debug the callee.
- **Step over (`n`)**: execute `calculate` to completion, pause at the next line. Use when you trust the callee.
- **Step out / finish (`finish` / `r`)**: run until the current function returns, pause in the caller. Used to escape an accidental step-in.
- **Continue (`c`)**: run until the next breakpoint.

Newer debuggers add **step back** (`rr`, JetBrains snapshot debuggers) — actually walk backwards in time. Worth mentioning if asked about reversible debugging.

### Q: What's a watchpoint?

A breakpoint that triggers on access to a memory *location* instead of a code *line*.

```
(gdb) watch user.balance        ; break on write
(gdb) rwatch user.balance       ; break on read
(gdb) awatch user.balance       ; read or write
```

Use case: a field has the wrong value and you don't know which function is writing it. Set a write-watchpoint and run; the debugger pauses at the offending store with full stack.

Implementation: x86 has 4 hardware debug registers that monitor an address with no slowdown. Beyond that, the debugger single-steps the entire program — orders of magnitude slower. Practical limit: 2–4 watchpoints.

### Q: What does `--inspect-brk` do in Node?

Starts the program with the V8 Inspector protocol on `127.0.0.1:9229` *and* pauses before the first line of user code. Attach Chrome DevTools (`chrome://inspect`), VS Code, or any Inspector client and step from the beginning.

Contrast with `--inspect`: same protocol, **does not pause**; the program runs normally and you attach when you want. Use `--inspect-brk` when the bug is in module load or the first 50ms before you can click "attach."

Production safety: bind to localhost only, never `0.0.0.0`. The Inspector protocol gives full debugger control — anyone who can reach the port executes arbitrary code in your process.

### Q: When is `print` debugging the right tool?

When the cost of setting up the debugger exceeds the cost of the bug. Specifically: embedded / remote / production targets where a debugger can't attach; async or event-loop code where stepping changes timing and hides the bug; Heisenbugs that vanish under a debugger (print is less perturbing); quick "does this branch even execute?" checks; multi-process or multi-machine flows where attaching N debuggers is impractical.

It stops being right for long-running investigations (prints accumulate; you commit them), deeply nested state (you drown in output), or anything that needs to step backwards in causality.

The senior answer: print is the *first* tool, not the only one. A few targeted prints to localise, then attach a debugger to the suspect region. Use a logger from day one — `logger.debug("…")` is print debugging with a kill switch.

### Q: What's a core dump and how do you read one?

A snapshot of a process's full memory at the moment it crashed (or when SIGQUIT was sent): stack, heap, register state, loaded library addresses — everything a debugger needs to reconstruct the moment of death.

```bash
gdb /path/to/binary /path/to/core
(gdb) bt full              ; full stack with locals
(gdb) thread apply all bt  ; backtrace every thread
(gdb) info registers
(gdb) print myVariable
```

Prereqs: `ulimit -c unlimited` (or systemd `LimitCORE=infinity`); the **exact binary** with debug symbols (`-g`) or a separate `.debug` file; matching shared library versions (sysroot if cross-debugging).

For Go: `GOTRACEBACK=crash`, then `dlv core ./binary corefile`. For Java: `jmap -dump` (heap dump, object graph not register state); analyse with Eclipse MAT.

### Q: What's the difference between a race condition and a deadlock?

**Race condition**: correctness depends on unpredictable interleaving. Two goroutines write to the same counter without synchronisation; sometimes you lose an increment. Symptom: wrong results, intermittent. Detection: race detector, stress tests.

**Deadlock**: threads hold resources each other needs and none proceeds. A holds M1, wants M2; B holds M2, wants M1. Symptom: program hangs forever (or watchdog kills it), not wrong result. Detection: `pprof` goroutine dump shows everyone in `sync.Mutex.Lock`; Java `jstack` says "Found one Java-level deadlock."

Diagnostic move differs: for races, compare values across runs; for deadlocks, snapshot and read the lock graph.

---

## Language-Specific

### Go

#### Q: Give me the `dlv` commands you actually use.

```
dlv debug ./cmd/server     ; build and start
dlv attach <pid>           ; attach to running process
dlv test ./...             ; debug tests
b main.handle | b main.go:42 ; breakpoints
c, n, s, so                ; continue, next, step, step-out
p req.UserID, locals, args ; inspect
gr | grs | gr <id>         ; current / all / switch goroutine
bt                         ; backtrace
on <bp> print foo          ; tracepoint without pausing
```

Interview-impressive: `grs` (find stuck goroutines), `on N print x` (poor-man's tracepoint), `dlv attach` (debug a running misbehaving process without restart).

#### Q: How do you read a Go goroutine dump?

Send `SIGQUIT` or hit `/debug/pprof/goroutine?debug=2`. Each block:

```
goroutine 47 [chan receive, 12 minutes]:
main.worker(0xc000010180)
        /app/main.go:73 +0x65
created by main.main
        /app/main.go:45 +0x12a
```

Read three things: **state** (`chan receive`, `chan send`, `select`, `IO wait`, `semacquire` = blocked on mutex, `sync.WaitGroup.Wait`) plus how-long-stuck; **stack** (current location); **created by** (owner).

Patterns: 10K goroutines in `chan send` to the same channel = closed/drained consumer. Everyone in `semacquire` on the same address = deadlock or slow critical section. One in `running` stuck on the same line for minutes = CPU-bound loop.

#### Q: How does `go test -race` interact with `t.Parallel()` and `time.Sleep`?

Detection is at the load/store level, regardless of `Parallel`. But `t.Parallel()` widens the schedule and raises the chance the race actually occurs in this run, so `-race` is most effective with parallel concurrency tests.

`time.Sleep` is an anti-test: a "passing" race test where the sleep was long enough for A to finish before B is luck, not synchronisation. Real sync in tests means channels, `sync.WaitGroup`, or `synctest`.

#### Q: How do you take a `pprof` CPU profile in production?

If `net/http/pprof` is mounted (localhost, admin auth):

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top; list <fn>; web
```

Reading: `top` shows hottest functions by flat (self) and cum (with callees). Flame graph: width = time; wide bar with narrow top = time spent in that function; wide bar with wide same-coloured top = time in callee. The right-side outlier is usually the bug. For continuous profiling: Pyroscope or Datadog (same pprof format, sampled).

### Python

#### Q: `pdb` cheat sheet — top commands.

```
n / s / r / c    next / step / return / continue
b 42             breakpoint at line
b mod.fn         breakpoint at function
b 42, x>0        conditional breakpoint
p x / pp x       print / pretty-print
l / ll           list source / whole function
w                where (stack)
u / d            up / down stack frame
!stmt            execute Python statement (e.g. !x = 5)
```

Non-obvious: `ll` (whole function), `w` (stack), `!` to mutate state mid-debug to test a hypothesis.

#### Q: What does `breakpoint()` actually do?

Builtin since 3.7. By default calls `pdb.set_trace()`. Consults `PYTHONBREAKPOINT`:

```bash
PYTHONBREAKPOINT=ipdb.set_trace python app.py   # use ipdb
PYTHONBREAKPOINT=0 python app.py                # disable all
PYTHONBREAKPOINT=web_pdb.set_trace python app.py # remote browser debugger
```

Killer feature: leave `breakpoint()` in conditional debug paths, ship the code, disable with one env var.

#### Q: What is `pdb.post_mortem` and when do you use it?

`pdb.post_mortem(tb)` drops you into pdb at the frame where an uncaught exception occurred — stack and locals preserved.

```python
import pdb, sys
try: risky()
except Exception: pdb.post_mortem(sys.exc_info()[2])
```

Or: `python -m pdb -c continue app.py` — runs to completion; if it crashes, drops into pdb. Use it when the bug only manifests after 20 minutes of setup — let it crash, look around.

#### Q: How does `tracemalloc` help find memory leaks?

Stdlib allocation tracker. Started early, it records file/line for every allocation:

```python
import tracemalloc
tracemalloc.start(25)
snap1 = tracemalloc.take_snapshot()
# ... workload ...
snap2 = tracemalloc.take_snapshot()
for stat in snap2.compare_to(snap1, "lineno")[:10]: print(stat)
```

The `compare_to` diff shows which source lines allocated bytes never freed between snapshots — points at the leaking call site, not the leaked type. Cost ~2× slowdown; diagnosis tool, not always-on.

### Java

#### Q: How do you analyse a heap dump?

Take it: `jmap -dump:live,format=b,file=heap.hprof <pid>` (or `-XX:+HeapDumpOnOutOfMemoryError`). Open with Eclipse MAT.

1. **Leak Suspects Report** — heuristics tell you "X% of heap held by class Y." Often nails it.
2. **Dominator Tree** — sort by retained size; top entries are what's keeping memory alive.
3. **GC Roots path** — "Path to GC Roots, excluding weak/soft" tells you who holds the suspect.

Classic findings: static `HashMap` cache with no eviction; `ThreadLocal` holding a request in a pooled thread; listeners on a long-lived bus never unregistered.

#### Q: What does `jstack` give you that `jcmd` doesn't?

`jstack <pid>` prints a thread dump — every thread's stack, lock ownership, deadlock detection. Fast, focused.

`jcmd` is the swiss army knife: `Thread.print` (same as jstack), `GC.heap_dump`, `GC.class_histogram`, `VM.flags`, `JFR.start`. Modern answer: use `jcmd` for everything except the muscle-memory `jstack` dump.

#### Q: How does JDWP remote debugging work?

JDWP is the protocol the JVM speaks to debuggers. Enable:

```
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

`server=y` = JVM listens; `suspend=n` = don't wait for attach; `suspend=y` to debug startup. The debugger (IntelliJ, VS Code, `jdb`) connects on 5005 and gets full breakpoint/step/evaluate power.

Security: never expose JDWP to the open internet. Anyone reaching the port executes arbitrary code in your JVM. Bind to localhost and tunnel: `ssh -L 5005:localhost:5005 prod-host`.

### JavaScript / Node

#### Q: How do async stack traces work, and why do they sometimes lie?

A traditional stack trace is the chain of currently-executing frames. In async code, by the time a `.then` callback runs, the scheduler (`fetch(...).then(...)`) is gone from the stack — the trace shows only the callback.

V8's **async stack traces** stitch in the synchronous context that *registered* the callback (the `await` / `then` site). On in Node since 12.

Where it lies: Promise constructors with manual `resolve`/`reject` lose the link; event emitters and callback APIs don't participate; deep chains truncate at a depth limit. Defensive: prefer `async`/`await`, `fs/promises` over callbacks, capture `new Error()` early in long pipelines to preserve a real stack.

#### Q: Walk through capturing a heap snapshot in Chrome DevTools.

DevTools → Memory → Heap snapshot → Take. Reproduce the leak (navigate around the SPA, open/close a modal 50×). Take a second snapshot. Switch to Comparison.

Columns: Shallow Size (own bytes), Retained Size (bytes freed if this object went away), Retainer (who holds the reference). Sort by retained size; top entries with growing retained size are the leaks.

In Node: `require('v8').writeHeapSnapshot('/tmp/snap.heapsnapshot')`, open in DevTools Memory. Or attach via `--inspect`.

#### Q: Why does `--inspect-brk` exist separately from `--inspect`?

Because the bug is sometimes in startup. With `--inspect`, the program runs past the window before you click "attach." With `--inspect-brk`, the very first line is paused; you attach, set breakpoints in module init, continue. The split keeps a production diagnostic attach from accidentally pausing services on restart.

---

## Tricky / Trap Questions

### Q: A test passes locally but fails in CI. Give me 5 possible causes.

Wrong instinct: "CI is flaky, retry it." That hides real bugs.

1. **Time / timezone.** Local UTC+5, CI UTC. A test hard-coding "today" or formatting dates trips on the offset.
2. **CPU count / parallelism.** Local 10 cores, CI 2. `t.Parallel()`, pools sized to `NumCPU()`, and timing-sensitive tests behave differently.
3. **Hidden env dependency.** Test reads `$HOME/.aws/credentials`, an env var, ssh-agent — present locally, missing in CI.
4. **Ordering / isolation.** Shared global state (singleton DB conn, env var). Locally you ran one test; CI runs the suite and an earlier test poisoned state.
5. **Network / DNS / proxy.** Local hits a public API directly; CI is behind a corporate proxy that mangles TLS, blocks egress, or rate-limits.

Honourable mentions: filesystem case sensitivity (mac insensitive, Linux sensitive); CRLF on Windows runners; Docker RAM; races that hide on a fast CPU.

### Q: A program uses 100% CPU but seems to make no progress. What do you check?

Wrong instinct: "infinite loop, attach a debugger." Often the spinning is intended — a hot retry loop or busy-wait — and the bug is "what is it waiting for."

1. **Thread snapshot** (`jstack`, `pprof goroutine`, `py-spy dump`). Is 1 thread busy or all? Targets the scope.
2. **CPU profile** (`perf top`, `pprof`, `py-spy top`). Where is the CPU going? A retry loop with no sleep? `contains` over 10M rows?
3. **Syscall trace.** No syscalls = compute-bound. Millions of `futex`/`epoll_wait` returning `EAGAIN` = busy-poll on a contended lock.
4. **GC pressure.** In Java/Node/Go, "100% CPU, no progress" is sometimes the GC: heap nearly full, every allocation triggers collection. Check GC logs.
5. **Compare to expected I/O.** If it should be writing to disk and `iostat` shows nothing, it's stuck *deciding not to* do I/O.

### Q: You added a print statement and the bug went away. Why?

Wrong instinct: "the print fixed it; ship it." It didn't — you found a Heisenbug.

- **Timing.** Print does syscall + I/O + flush — microseconds that perturb a tight race.
- **Memory visibility.** The print call inhibits a JIT optimisation; a value previously kept in a register is now spilled to memory, where another thread sees the update; the visibility bug vanishes.
- **Memory allocator.** Print allocated a buffer; subsequent allocations shifted; the use-after-free now lands on a still-valid byte.
- **Side effect.** Print called `__str__` / `String()`, which lazily initialised a field that was the actual bug.

The fix is not the print. Suspect concurrency or undefined behaviour.

### Q: Your service segfaults only when run under systemd, never under bash. Hypothesis?

Wrong instinct: "must be a systemd bug." Almost never. The difference is the *environment*.

- **Env vars.** Bash has `LD_LIBRARY_PATH`, `PATH`, locale; systemd's unit has almost nothing. Missing `LANG=C.UTF-8` → glibc locale init returns null used downstream.
- **Working directory.** systemd starts at `/`, your shell at `~`. Relative path writes / reads now fail.
- **User / uid.** Unit has `User=svc`; you ran as your user. File permissions, supplementary groups differ.
- **stdin/stdout.** Bash gives terminals; systemd pipes to journald or closes them. `tcsetattr` fails on a non-terminal.
- **Resource limits.** systemd applies `LimitNOFILE`, `MemoryMax`, `TasksMax`.

Repro trick: `systemd-run --user --pty --same-dir /path/to/binary`, or `env -i bash` to strip your shell's env.

### Q: Which is faster: `for i in range(1000000)` or `for i in range(0, 1000000)`? How would you check?

Wrong instinct: "they look identical, must be the same." Semantically identical in Python 3, but is the bytecode?

Answer: in CPython 3, both produce equivalent loop bytecode — `range(stop)` and `range(0, stop)` both construct `range(start=0, step=1)`. Verify with `dis.dis`: one extra `LOAD_CONST 0` in the second form, once, outside the loop. Time it: `python -m timeit 'for i in range(1000000): pass'`. Difference is below measurement noise.

Interview point: don't guess, measure. And measure the *right* thing — a 1ms difference across 1M iterations is meaningless next to allocator jitter.

### Q: A method completes in 10ms directly but 800ms when called from a different module. Why?

Wrong instinct: "module loading must be slow." Loading happens once, not per call.

- **Different arguments.** Direct test passes a small input; the other module passes a huge or deeply nested structure.
- **Lazy init.** First call into the module triggers DB pool init, config load, JIT warm-up. Did you measure first call or steady state?
- **Decorators.** `@trace`, `@retry`, `@cache_check` wrap every call.
- **Lock contention.** The caller holds a lock; your method blocks on a shared resource.
- **Indirection.** The other module calls via reflection, RPC, or proxy — every "call" is a network round-trip.
- **GC pressure.** The other module just allocated 500 MB; your method runs during a pause.

Check: profile the slow path, diff against the fast path's stack. The difference is the answer.

### Q: Unit tests pass but integration tests fail with "connection refused". The DB is up. What's wrong?

Wrong instinct: "the DB is down, restart it." The question says it's up.

- **Wrong host.** Integration test uses `localhost`; CI service is `db` in the Docker network, or `host.docker.internal` from a container.
- **Wrong port.** Test points at 5432; CI maps to 5433.
- **Race with startup.** DB container is up (process running) but not yet accepting connections — needs a readiness probe.
- **Firewall / netpol.** Local reaches DB; CI's network policy blocks tests-pod → db-pod.
- **Protocol mismatch.** TLS required and client doesn't present it (or vice versa).
- **Connection limit.** Previous tests leaked connections; `max_connections` reached.

Diagnostic: from inside the test env, `nc -zv <host> <port>`. Fails → network/config. Succeeds → auth / TLS / db name / max-conn.

### Q: A SQL query is fast on staging and slow on production. First move?

Wrong instinct: "must be a missing index." More commonly: statistics or plan cache.

First move: get the actual execution plan on production (`EXPLAIN ANALYZE` on Postgres, `EXPLAIN FORMAT=JSON` + `ANALYZE` on MySQL). Compare to staging.

Common findings: stale stats → `ANALYZE table_name`; cardinality mismatch (10K rows in staging, 10M in prod — index bypassed due to selectivity); parameter sniffing (a bad plan cached on first call); buffer cache fit (staging hot, prod cold); lock contention from concurrent writers.

First physical operation always: get the plan from prod.

### Q: A `for` loop allocates objects and the GC is killing throughput. Where do you look first?

Wrong instinct: "tune the GC." Usually wrong first move.

Look at **what's being allocated** via a heap profile (`pprof -alloc_objects`, py-spy `--memory`, V8 snapshot diff). Typical findings: **boxing** (Java `Integer` instead of `int`); **string concat in a loop** (N² allocations — use builder); **defensive copies** (every `getList()` returns `new ArrayList<>(internal)`); **lambda captures** (fresh closure per iteration); **hidden iterators** (`for x in lazy_seq` materialises because of `len`).

Fix the allocation; the GC stops mattering. Only tune the GC after cutting allocation rate 10× and still needing more.

### Q: A user reports the dashboard "freezes for 2 seconds every minute." What do you suspect first?

Wrong instinct: "browser bug." Almost certainly your code.

Suspect a **periodic task**: cron, `setInterval`, polling websocket, metrics flush. "Every minute" is the giveaway. Check DevTools Performance for a wide red bar every 60s (sync JS blocking the renderer); a `setInterval` GET downloading 5MB and parsing synchronously; layout thrash on data update; client-side log/metric flush. Subtler: server-side cron at minute boundaries makes the API slow.

### Q: Your test uses a 100ms sleep "to let the goroutine finish." Why is that wrong?

Wrong instinct: "it works most of the time." It will fail in CI at 3am.

It's not synchronisation, it's hope. On a fast machine the goroutine finishes in 10ms; on a slow CI box it needs 200ms. Tests flake. The sleep also slows the suite, and worst — it can be long enough that racing accesses no longer overlap, `-race` reports nothing, bug ships.

Right tools: channel signal (`done := make(chan struct{}); ... close(done); <-done`); `sync.WaitGroup`; bounded polling (`assert.Eventually`); `testing/synctest` (Go 1.24+) for virtual time.

### Q: Your service has a memory leak — but only after deploying on Tuesdays. Why?

Wrong instinct: "must be a bug we ship on Tuesdays." Look for what *changes* on Tuesdays.

Likely: a weekly batch job that uploads a 2GB file and never frees the buffer; a B2B customer's reporting job that triggers a leaky code path; a Tuesday-only cron coinciding with deploy; a feature flag gradual rollout crossing a percentage threshold; a calendar boundary (`weekofyear`) causing a cache miss avalanche.

Pattern: when a bug correlates with an external schedule, look for what runs on that schedule, not what changed in the code.

### Q: You see a CPU spike to 100% for 5 seconds every 30 minutes. Two suspects.

Wrong instinct: "scheduled cron, find it." Could be runtime behaviour.

Top two: **GC** — a long-lived service accumulates promotable objects, old-gen GC fires every ~30 min; **cache expiry / refresh** — TTL of 30 min, on expiry every request stampedes the regeneration path.

Honourable mentions: scheduled metric aggregation, periodic log rotate, expensive K8s liveness probe, downstream poll. Diagnostic: on the next spike, capture a CPU profile for 10 seconds. Hottest stack is the answer.

---

## System / Design Scenarios

### Q: Design a debug mode for a high-throughput service that imposes minimal overhead when off.

Goals: rich diagnostics on demand, near-zero cost when not in use, no restart required to toggle.

- **Leveled logger backed by an atomic int.** `logger.Debug(...)` is a single branch on `level <= DEBUG`. Critically the *arguments* must also be lazy — accept a closure or use a structured logger that defers formatting (`slog`).
- **Sampled tracing.** Always emit spans, sample at 1/1000. Toggle to 100% via admin endpoint. Cost per span ~30ns.
- **Runtime toggles.** `/admin/loglevel` POST; `/admin/debug-user/{id}` for full-fidelity per-user traces for an hour.
- **Conditional pprof.** `/debug/pprof/*` always mounted, gated behind localhost or admin auth. Profiling cost only on request.
- **On-demand goroutine dump.** `SIGUSR1` writes a dump to a file. No cost until signalled.

Key principle: **the default path is silent.** Anything "on always, just in case" is overhead you pay forever.

### Q: Walk me through diagnosing a memory leak in production without restarting.

Constraint: no restart, no downtime. The service has `/debug/pprof` (Go), `jcmd` (Java), or `--inspect` (Node) behind admin auth.

1. **Confirm the leak.** `kubectl top pod` or `ps -o rss` over 10 minutes. RSS monotonically rising, not a sawtooth (GC).
2. **Snapshot.** `curl /debug/pprof/heap > heap_t1.pprof` or `jcmd <pid> GC.heap_dump /tmp/heap_t1.hprof`.
3. **Wait, snapshot again.** 10-30 minutes later, `heap_t2`.
4. **Diff.** `go tool pprof -base heap_t1 heap_t2`; in MAT, "compare snapshots."
5. **Identify retainer.** Dominator tree (MAT), `inuse_objects` + `list` (pprof). Go: global map or channel buffer; Java: static collection or ThreadLocal.
6. **Confirm with a controlled experiment.** Route traffic of the suspected type away from the pod. RSS should plateau.
7. **Patch, canary, watch RSS for a full leak cycle.**

### Q: A user reports "sometimes my data is stale" — design a diagnosis plan.

"Sometimes" means: identify the conditions, then explain them.

1. **Define stale.** By how long, compared to what source of truth?
2. **Reproduce.** Ask the user for the exact click path. Usually: "opened a new tab, came back, saw old data."
3. **Map all caches.** Browser, CDN, varnish, Redis, DB read replica lag, materialised view refresh interval — each is a candidate.
4. **Match staleness window to TTL.** If CDN TTL is 5 min and staleness is "minute or two," CDN. If reads go to a 2s-lag replica and writes to primary, read-your-writes problem.
5. **Add trace headers.** `X-Served-By: cache|origin`, `X-Cache-Age: 47s`, `X-Replica-Lag: 2.1s`. Ask the user to screenshot.
6. **Fix or document.** Cache bust on write, sticky session to primary after writes, or shorten TTL. If "stale by 30s" is acceptable, document it.

### Q: You join a team with a long-running flaky test problem. What's your 30-day plan?

Week 1 — **measure.** CI records every failure (test, branch, commit, log). Compute pass rate per test over 30 days. Top 20 flakiest tests usually account for >80% of failures.

Week 2 — **triage.** Classify each: (a) race in test code, (b) race in production code surfaced by test, (c) external dependency (network, time, fs), (d) ordering / shared state. (b) is the one nobody wants to admit but matters most.

Week 3 — **fix.** Tackle the easiest 10. Replace sleeps with synchronisation. Isolate state per test. Pin / mock externals. Each fix gets a 1000-iteration stress run as regression.

Week 4 — **prevent.** Quarantine label: tests >X% flake move out of the merge gate; the team owns getting them back in. SLO "merge-gate pass rate >= 99.5% over 30 days," visible, blocks merges when violated.

Beyond 30 days: team norms doc — no sleeps, no raw `time.Now()`, no shared global state, no "retry until pass" without an issue link.

### Q: Design the observability for a new payments service.

**Metrics.** RED (Rate, Errors, Duration) per endpoint. Business metrics: payments authorised/captured/refunded per minute, dollar volume, success rate by card brand. Histograms for latency, not averages. Alert on error rate and p99, not p50.

**Logs.** Structured JSON, one event per logical action: `payment.authorise.attempt|success|failure` with `reason`. Mandatory fields: `request_id`, `payment_id`, `merchant_id`, `amount`, `currency`. Never log full card numbers, CVV, track data — PCI-DSS scope explosion.

**Traces.** `trace_id` propagated through every downstream call (issuer, fraud, ledger). Sample 10% baseline, 100% for failures and high-value transactions. Spans tagged with `payment_id`.

**Audit log.** Separate, append-only, 7+ year retention. Every state change immutable. Treat as a database, not a log stream.

**Alerts**: p99 > 1s for 5min; error rate > 0.5% for 2min; downstream issuer errors > 5%; queue depth > 1000; merchant-level anomaly (a single merchant at 100× normal — fraud or test traffic).

### Q: A service's p99 latency doubled after a deploy. Plan?

1. **Roll back first, diagnose second.** Don't debug live revenue if safe to revert.
2. **Compare profiles.** Run v1 and v2 in staging at the same traffic shape; diff CPU and allocation profiles.
3. **Look at the diff.** Library upgrade adding serialisation cost? New validation? A metric label exploding cardinality?
4. **Trace span tree on v2.** Which span widened? A DB call from 5ms to 50ms points at queries or pool config, not business logic.
5. **Reproduce in load test.** Confirm hypothesis with and without the change.
6. **Hotfix forward if revert impossible.**

Order matters: stop the bleed, then diagnose.

---

## Live Coding / Whiteboard

### Q: Here's a 30-line Python program with a subtle bug. Find it.

```python
def parse_amounts(lines):
    amounts = []
    for line in lines:
        parts = line.split(",")
        if len(parts) < 2: continue
        amounts.append(float(parts[1]))
    return amounts

def total(amounts):
    t = 0
    for a in amounts: t += a
    return t

def report(lines):
    a = parse_amounts(lines)
    print(f"count={len(a)} total={total(a):.2f}")

report(["alice, 10.00", "bob, 20.50", "carol, 3.14", "", "dave, 7.99 "])
```

The subtle bug: **floating-point accumulation for money**. `10.00 + 20.50 + 3.14 + 7.99` is `41.629999999...`, masked by `.2f`. For real currency: `decimal.Decimal` or integer cents, never `float`. Interviewer wants: "for money, never use float."

```python
from decimal import Decimal
amount = Decimal(parts[1].strip())
```

### Q: Write a small reproducer for a race condition in Go.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    counter := 0
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // race: read-modify-write of shared variable
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter)
}
```

Run with `go run -race main.go`. The race detector reports the unsynchronised access on `counter`. The printed value is typically not 1000 — it's whatever the schedule allowed.

The fix demonstrates the conceptual cure: either a mutex (`sync.Mutex` around the increment) or an atomic (`atomic.AddInt64(&counter, 1)`). Mention that `counter++` is three machine operations (LOAD, INC, STORE), and the race interleaves them across goroutines.

### Q: Add proper instrumentation to this Python function so a future bug would be diagnosable.

Before:

```python
def charge_customer(customer_id, amount):
    customer = db.get_customer(customer_id)
    if customer.balance < amount:
        return False
    db.deduct(customer_id, amount)
    return True
```

After:

```python
import logging, time
log = logging.getLogger(__name__)

def charge_customer(customer_id: str, amount: int) -> bool:
    start = time.monotonic()
    log.info("charge.start", extra={"customer_id": customer_id, "amount": amount})
    try:
        customer = db.get_customer(customer_id)
        if customer.balance < amount:
            log.warning("insufficient_funds",
                        extra={"customer_id": customer_id,
                               "balance": customer.balance, "requested": amount})
            return False
        db.deduct(customer_id, amount)
        log.info("charge.success",
                 extra={"customer_id": customer_id, "amount": amount,
                        "new_balance": customer.balance - amount,
                        "duration_ms": (time.monotonic()-start)*1000})
        return True
    except Exception:
        log.exception("charge.error",
                      extra={"customer_id": customer_id, "amount": amount})
        raise
```

Talking points: structured fields (queryable); explicit `insufficient_funds` event ("how often does this happen?"); `customer_id` for correlation; no PII; exception path covered; duration in ms.

### Q: Read this Go stack trace and tell me where the bug is.

```
panic: runtime error: index out of range [3] with length 3
goroutine 1 [running]:
main.normalise(...)
        /app/normalise.go:12
main.process(0xc0000a8000, 0x4, 0x4)
        /app/process.go:23 +0x9a
main.main()
        /app/main.go:8 +0x76
```

Bottom-up: `normalise` at line 12 tried index 3 on a length-3 slice. The bug isn't necessarily *there* — that's where it died. The question is why a length-3 slice was passed when the code expects length ≥ 4. Likely cause: an off-by-one (`i <= len(s)` instead of `i < len(s)`), or `normalise` was changed to expect a different length than `process` builds.

Action: open `normalise.go:12`, check the indexing, then trace what `process` constructed at line 23 to understand the contract mismatch.

### Q: Take this print-heavy Python debugging session and refactor to logging.

Before:

```python
def handle(req):
    print("got request")
    print(req)
    user = find_user(req["user_id"])
    print("user is", user)
    if user is None:
        print("no user found!"); return None
    result = compute(user, req["params"])
    print("result is", result)
    return result
```

After:

```python
import logging
log = logging.getLogger(__name__)

def handle(req):
    log.debug("request_received",
              extra={"user_id": req.get("user_id"), "request_id": req.get("request_id")})
    user = find_user(req["user_id"])
    if user is None:
        log.warning("user_not_found",
                    extra={"user_id": req["user_id"], "request_id": req.get("request_id")})
        return None
    result = compute(user, req["params"])
    log.info("request_handled",
             extra={"user_id": user.id,
                    "result_size": len(result) if result else 0})
    return result
```

Talking points: removed `print(req)` (full payload, PII risk); leveled (`debug` for trace, `warning` for missing user, `info` for success); structured fields, not interpolated strings; `request_id` correlation; log result *size*, not the result itself.

### Q: Find the bug in this Java code.

```java
public class Cache<K, V> {
    private final Map<K, V> map = new HashMap<>();
    public V getOrLoad(K key, Function<K, V> loader) {
        if (!map.containsKey(key)) {
            V value = loader.apply(key);
            map.put(key, value);
            return value;
        }
        return map.get(key);
    }
}
```

Two bugs: (1) **not thread-safe** — `HashMap` concurrent access can corrupt internal state; two threads can both pass `containsKey`, both call the expensive `loader`, both `put`; identity breaks. (2) **Cache stampede** — N concurrent misses → N loader calls.

Fix:

```java
private final Map<K, V> map = new ConcurrentHashMap<>();
public V getOrLoad(K key, Function<K, V> loader) {
    return map.computeIfAbsent(key, loader);
}
```

`computeIfAbsent` is atomic per key — exactly one loader call. (Caveat: avoid recursive `computeIfAbsent` in the loader on Java < 17.)

### Q: Write a snippet that produces a deadlock in Go, then describe how `dlv` would diagnose it.

```go
package main

import ("sync"; "time")

func main() {
    var a, b sync.Mutex
    go func() {
        a.Lock(); time.Sleep(10 * time.Millisecond); b.Lock()
        b.Unlock(); a.Unlock()
    }()
    go func() {
        b.Lock(); time.Sleep(10 * time.Millisecond); a.Lock()
        a.Unlock(); b.Unlock()
    }()
    select {}
}
```

Diagnosis: `dlv attach <pid>`, then `grs` lists goroutines, `goroutine 6 bt` shows it blocked in `sync.Mutex.Lock`; `goroutine 7 bt` shows the symmetric block. G6 holds `a` waiting for `b`; G7 holds `b` waiting for `a` — classic AB-BA. Fix: acquire locks in a canonical order everywhere.

Alternatively: SIGQUIT and read the goroutine dump — the Go runtime sometimes detects "all goroutines asleep — deadlock!" and aborts.

---

## Behavioral / Experience

### Q: Tell me about the hardest bug you ever debugged.

The interviewer wants arc, evidence, surprise, lesson — not "I'm a great debugger."

Example skeleton:

- **Symptom.** Orders intermittently double-charged customers, 1 in 50,000.
- **Wrong first hypothesis.** Assumed retries on transient payment failures; logs showed only one retry per call.
- **Investigation.** Added unique idempotency keys. Found two distinct keys for the same order — so two separate attempts, not a retry.
- **Breakthrough.** Traced the `request_id`: the payment gateway's webhook fired twice (at-least-once semantics).
- **Resolution.** `processed_webhooks(event_id)` table with a unique constraint; idempotent handler.
- **Lesson.** External webhooks are at-least-once unless proven otherwise. We added a checklist item for any third-party webhook.

Tell *one* bug, with concrete numbers. No generalities.

### Q: Describe a Heisenbug you found.

Pick a specific story where the bug *changed* when observed. Important elements: the moment you realised it was a Heisenbug, and how you adapted your approach. Example:

"A Go service occasionally lost a websocket message. Adding a `log.Printf` before sending made the bug disappear. I realised the print was forcing a memory barrier (via the mutex inside the logger) and that was what we needed. The real bug was a missing channel synchronisation — we were assuming a write to a shared field happened-before a goroutine read. Removing the log and adding a `sync.Mutex` fixed it. Lesson: when adding logging changes behaviour, suspect concurrency."

### Q: Walk me through an incident where the first hypothesis was wrong.

"DB CPU at 100%. First hypothesis: new query from yesterday's release. Rolled back. CPU stayed at 100%. Second: unindexed query — `pg_stat_statements` showed nothing slow. Third: connection storm — `pg_stat_activity` showed 500 idle-in-transaction from one service. That service had an error path that returned without releasing its DB connection. Restarting it dropped CPU to 5%.

Lesson: I anchored on 'we deployed something' too long. Now I have a checklist that runs before blaming a deploy: top 10 queries, idle-in-tx count, connection count, replication lag, *then* recent deploys."

### Q: Tell me about a time you debugged code you didn't write.

Show respect for prior context, willingness to read, and discipline in not assuming the author was wrong.

"Inherited a Go service from a disbanded team. Bug: 'sometimes returns 500 on customer search.' Spent two hours reading without changing anything; found a custom retry wrapper around the HTTP client. The retry counted only HTTP errors, not context cancellation — so a cancelled outer context still drove retries for ~30s. Added a log line, reproduced under load, made retries respect context, wrote tests (there were none). Lesson: resist the urge to rewrite. The original author had reasons; understand them, then refactor with tests."

### Q: When have you been wrong about a 'root cause'?

"Customer-facing latency spiked. I shipped a fix for what I thought was the cause — an N+1 query. Latency improved 30%. I called it done. A week later it spiked again, on a different endpoint with no N+1. Real cause: a downstream service's connection pool was too small; saturation slowed *all* calls. My fix had reduced load just enough to mask the underlying problem.

Lesson: 'a fix that improves the symptom' is not 'a fix for the root cause.' Now I demand a hypothesis that explains *all* the data, not just most of it."

### Q: Tell me about a bug you couldn't reproduce.

"A user's dashboard always loaded with the wrong locale — German for an English user. Couldn't reproduce in dev, staging, or even with the user's account in production. Asked for their HAR file. The `Accept-Language` header was `de-DE,en;q=0.5` — their browser was German-first. Our backend used the first language without checking what we actually supported, and ignored their profile setting.

Lesson: when you can't reproduce, ask for the request — headers, body, timing. The bug often hides in something the user took for granted."

### Q: Describe a bug that taught you something about a system you thought you understood.

"Thought I understood Postgres MVCC. A SELECT on a 2M-row table did a full table scan despite a good index. Statistics were fresh. Cause: heavy concurrent updates had left 10× as many dead tuples as live; autovacuum hadn't caught up. Postgres was scanning dead rows. Manual `VACUUM` made the query 100× faster. Now I check `pg_stat_user_tables` for dead row counts before assuming the planner is the problem."

### Q: Tell me about a debugging session that took 3 days.

"Rare data corruption in our event store, ~1 event per 10 million dropped. Day 1: assumed disk error — fsck, SMART, replaced disk; bug persisted. Day 2: assumed serialisation; wrote a fuzzer over event types; no repro. Day 3: instrumented every write with a SHA-256. Found that when the write batch was exactly 64 KB, the last few bytes were lost. Cause: a `bufio.Writer` with a 64 KB buffer; a shutdown path called Close without Flush. Lesson: 'rare' doesn't mean 'random' — find the variable that correlates with the rarity (batch size, here)."

---

## What I'd Ask a Candidate Now

Questions that separate "knows tools" from "knows debugging."

### Q: How do you decide when to stop debugging and ask for help?

Listening for a concrete heuristic, not "I'm a team player." E.g., "after an hour with no new evidence, I write up what I know and what I've tried, then ask. The act of writing usually unsticks me; if not, someone now has the cheap context to help." Bonus: timeboxing as a deliberate practice.

### Q: What's a debugging tool you used last week that most people haven't heard of?

Reveals depth of toolkit. Satisfying answers: `rr` (record/replay), `bpftrace`, `py-spy --dump`, JFR, continuous profilers, `git bisect run`, `tcpdump` + Wireshark, `strace -fttT`. Bad sign: "I just use console.log."

### Q: A junior engineer adds 30 `print` statements to debug. What do you say to them?

Listening for: respect (print is fine; we all do it), plus teaching the next level — structured logging with levels, breakpoints, an attached debugger. Not "stop using print, it's bad."

### Q: When do you write a test for a bug, before or after fixing it?

The right answer is "**before**, when possible." A failing reproduction confirms you understand the bug, proves the fix actually fixes it, and prevents regression. Pragmatic follow-up: "If the fix must ship in 20 minutes, fix first, test second — but always test." Listening for principle plus pragmatism.

### Q: What's your unit of "evidence" in debugging?

Strong answer: "A reproducible observation that constrains the hypothesis." Not "I think it might be" or "the user said." A timestamped log line, pcap, failing test, goroutine dump. Candidates who treat hunches as evidence stay stuck.

### Q: How would you debug a system you have no access to (closed-source, deployed elsewhere)?

Listening for black-box thinking. Vary inputs systematically, log responses, compare. Read public docs. Packet capture at your edge. Look for timing patterns, error message strings, version headers. Debugging *behaviour* without debugging *code* is rare and valuable.

### Q: What's the worst debugging habit you've broken?

A self-aware candidate has one: "changing multiple things at once," "believing log timestamps without checking clock skew," "assuming the docs are correct." The story of breaking the habit is more interesting than the habit.

---

## Cheat Sheet

Top-10 must-know questions for any debugging interview:

```
┌──────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW DEBUGGING QUESTIONS                                        │
├──────────────────────────────────────────────────────────────────────┤
│  1. How do you read a stack trace?                                   │
│       → Bottom-up for "what blew up," top-down for "who started it." │
│                                                                      │
│  2. Difference between race condition and deadlock?                  │
│       → Race: wrong result. Deadlock: no progress.                   │
│                                                                      │
│  3. What is `git bisect` and when to use it?                         │
│       → Binary search over commits for regressions.                  │
│                                                                      │
│  4. Step over vs step into?                                          │
│       → Over: execute callee, pause at next line.                    │
│       → Into: pause inside callee.                                   │
│                                                                      │
│  5. What's a Heisenbug? How do you debug one?                        │
│       → Observation perturbs system. Suspect concurrency, UB.        │
│       → Use less perturbing tools (rr, prod sampling).               │
│                                                                      │
│  6. When is print debugging right?                                   │
│       → When attaching a debugger is impossible or expensive.        │
│       → Use real logging, not raw print, in committed code.          │
│                                                                      │
│  7. Test passes locally, fails in CI — five causes?                  │
│       → Time/TZ, parallelism, env, ordering, network.                │
│                                                                      │
│  8. Find a memory leak in production — process?                      │
│       → Snapshot, wait, snapshot, diff, retainer path, hypothesis.   │
│                                                                      │
│  9. What does the Go race detector do?                               │
│       → Tracks happens-before with vector clocks per access.         │
│       → Reports actual races observed in this run.                   │
│                                                                      │
│ 10. What's your evidence-based debugging process?                    │
│       → Hypothesis → cheap experiment → update belief → repeat.      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **"Debugging: The 9 Indispensable Rules for Finding Even the Most Elusive Software and Hardware Problems"** — David J. Agans. The canonical short book on debugging mindset.
- **"Why Programs Fail: A Guide to Systematic Debugging"** — Andreas Zeller. Academic but rigorous; introduces delta debugging.
- **"Working Effectively with Legacy Code"** — Michael Feathers. Debugging code you didn't write.
- **Brendan Gregg's USE method** — [brendangregg.com/usemethod.html](https://www.brendangregg.com/usemethod.html). Systems performance analysis discipline.
- **Russ Cox: "Differential Coverage"** — [research.swtch.com/coverage](https://research.swtch.com/coverage). How to use coverage diffs for diagnosis.
- **Dave Cheney: "Go execution tracer"** — practical tracing in Go.
- **Julia Evans' zines** — perf-tools, bite-sized Unix and debugging primers, excellent for filling in syscall-level mental models.
- **Postmortem cultures: Google SRE book, Ch. 15** — how to write blameless postmortems.

---

## Related Topics

- [Debugging — Junior](junior.md)
- [Debugging — Middle](middle.md)
- [Debugging — Senior](senior.md)
- [Debugging — Professional](professional.md)
- [Debugging — Tasks](tasks.md)
- [Error Handling — Interview](../error-handling/interview.md)
- [Logging — Interview](../logging/interview.md)
