# Debugging — Senior Level

> **Topic:** [Debugging Roadmap](README.md)
> **Focus:** Debugging production without stopping the world. Distributed systems. Heisenbugs. The diagnostic toolkit you ship with your service.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Production Debugging Without Stopping the World](#production-debugging-without-stopping-the-world)
8. [Memory Bugs at Scale](#memory-bugs-at-scale)
9. [Concurrency Bugs in Depth](#concurrency-bugs-in-depth)
10. [Distributed Debugging](#distributed-debugging)
11. [Heisenbugs and Flaky Tests](#heisenbugs-and-flaky-tests)
12. [The "Debug Fearlessly" Mindset](#the-debug-fearlessly-mindset)
13. [System-Call Level Debugging](#system-call-level-debugging)
14. [Snapshot Debugging in Production](#snapshot-debugging-in-production)
15. [GC Pauses, JIT, and Runtime Magic](#gc-pauses-jit-and-runtime-magic)
16. [The Diagnostic Toolkit You Ship](#the-diagnostic-toolkit-you-ship)
17. [Code Examples](#code-examples)
18. [Worked Example — 3 a.m. CPU Spike](#worked-example--3-am-cpu-spike)
19. [Same Memory Leak, Four Languages](#same-memory-leak-four-languages)
20. [Pros & Cons](#pros--cons)
21. [Use Cases](#use-cases)
22. [Coding Patterns](#coding-patterns)
23. [Clean Code](#clean-code)
24. [Best Practices](#best-practices)
25. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
26. [Common Mistakes](#common-mistakes)
27. [Tricky Points](#tricky-points)
28. [Test Yourself](#test-yourself)
29. [Tricky Questions](#tricky-questions)
30. [Cheat Sheet](#cheat-sheet)
31. [Summary](#summary)
32. [What You Can Build](#what-you-can-build)
33. [Further Reading](#further-reading)
34. [Related Topics](#related-topics)
35. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Debugging the systems you cannot stop, with the tools that observe without disturbing.**

At junior level you debugged a function. At middle level you debugged a process — breakpoints, race detector, core dumps. At senior level the unit of debugging is no longer a process: it's a **production fleet**, a **distributed call chain**, or a **runtime that you cannot pause for thirty seconds without paging the on-call**.

The mental shift is brutal and worth naming: *you can no longer attach a debugger*. The machine is serving real users. The bug appears once every fifty thousand requests. The state that triggered it is gone by the time you SSH in. The senior question is no longer "what does this line do?" but **"how do I observe this system as it runs, without changing its behavior, and reconstruct what happened?"**

This page collects the techniques that answer that question — eBPF, sampling profilers, distributed traces, snapshot debuggers, sanitizers, thread dumps — and the **mindset** that uses them: trust nothing, instrument before you guess, time-box your investigations, and when the impossible has happened, one of your premises is wrong.

> 🎓 **Why this matters for a senior:** Anyone can debug with a debugger. The senior's craft is debugging *the things you cannot pause* — production traffic, GC pauses, race conditions that appear once a week, memory leaks that show up in week three. The toolkit here is the difference between "we restart the pod and hope" and "we know exactly which goroutine leaked, on which deploy, since which commit."

---

## Prerequisites

What you should already have nailed:

- **Required:** Junior debugging: `printf` debugging, exception/stack traces, basic interactive debuggers (`gdb`, `dlv`, `pdb`, IntelliJ/VS Code).
- **Required:** Middle debugging: conditional breakpoints, watchpoints, core dumps, the race detector (`go test -race`, ThreadSanitizer).
- **Required:** Working Linux comfort — `ps`, `top`, `htop`, `lsof`, `netstat`/`ss`, signals, `/proc`.
- **Required:** Awareness of OS concepts — virtual memory, file descriptors, threads vs processes, system calls.
- **Required:** You've shipped at least one service to production and been paged at least once.
- **Helpful:** Familiarity with at least one runtime in depth — JVM GC, Go scheduler, Python GIL, Node's event loop.
- **Helpful:** Some `tcpdump`/Wireshark exposure.

---

## Glossary

| Term | Definition |
|------|-----------|
| **eBPF** | Extended Berkeley Packet Filter — a Linux mechanism for safely running sandboxed programs in kernel space without writing kernel modules. The substrate behind `bpftrace`, `bcc`, `pixie`, Cilium. |
| **Sampling profiler** | A profiler that periodically interrupts the program and records the call stack, instead of instrumenting every function. Low overhead; safe for production. |
| **Tracing profiler** | A profiler that records every function entry/exit. Accurate but expensive — usually not safe for production. |
| **Continuous profiling** | Running a low-overhead sampling profiler permanently in production and aggregating across the fleet. Datadog, Pyroscope, Grafana Phlare. |
| **Snapshot debugger** | A tool that captures the local state at a code line *without* stopping execution. Rookout, Lightrun, Datadog Live Debugger. |
| **Heisenbug** | A bug whose behavior is altered by the act of observing it. Adding a log line, attaching a debugger, or slowing the loop makes it disappear. |
| **Bohrbug** | A reliably reproducible bug. The opposite of a Heisenbug. |
| **Mandelbug** | A bug whose causes are so complex and non-local that it appears chaotic. |
| **Schrödinbug** | A bug that only manifests after someone reads the code and realizes it should not work. (Folklore, but real.) |
| **Sanitizer** | A compile-time/runtime tool that injects checks: ASan (address), MSan (memory), UBSan (undefined behavior), TSan (thread). |
| **Use-after-free (UAF)** | Reading or writing memory after it has been freed. Common in C/C++; impossible in safe Rust; possible in `unsafe` Rust. |
| **Distributed trace** | A tree of spans recording a request as it traverses multiple services. Each span has start/end timestamps and a parent. |
| **Correlation ID / request ID** | A unique ID attached to a request and propagated through every log line, span, and downstream call. |
| **Stop-the-world (STW)** | A GC pause during which all application threads are halted. Modern collectors (ZGC, Shenandoah, Go's GC) aim for sub-millisecond STW. |
| **goroutine dump** | Go's equivalent of a Java thread dump — every goroutine's stack trace, obtained via `SIGQUIT` or `/debug/pprof/goroutine`. |
| **`pprof`** | Go's built-in profiler and the `/debug/pprof` HTTP surface for live introspection (CPU, heap, goroutines, mutex, block). |
| **`jstack`** | JVM tool that prints a thread dump for a running process. |
| **Record-replay debugger** | A debugger that records every nondeterministic input and lets you replay execution deterministically (rr, Pernosco, Mozilla's rr). |
| **Traffic mirroring** | Sending a copy of production traffic to a staging environment to reproduce bugs without risk to users. Envoy, AWS VPC Traffic Mirroring. |
| **Flaky test** | A test that passes sometimes and fails sometimes on the same code, usually due to nondeterminism (time, ordering, network). |
| **Continuous Profiler** | A daemon that produces flamegraphs aggregated across hosts, deployments, and time windows. |

---

## Core Concepts

### 1. The observer effect is the senior's first enemy

Attaching a debugger changes scheduling. Adding a log line changes timing. Enabling verbose tracing changes the GC. The cardinal rule of senior debugging: **the tool you use must perturb the system less than the bug you are hunting**, or it will disappear under your feet. This is why we reach for sampling profilers, snapshot debuggers, and eBPF — they observe without taking the system down.

### 2. Reproduction is half the bug

Senior engineers spend more time reproducing than fixing. If you can reproduce on demand, the fix is mechanical. If you cannot, every "fix" is a guess. Strategies to force reproduction: increase load, restrict cores (`taskset -c 0`), add latency (`tc qdisc`), inject GC pressure, replay recorded traffic. The bug that "only happens in production" usually means *production has a property your reproduction lacks* — find which one.

### 3. Telemetry is the prerequisite for debugging

You cannot debug a system you cannot see. The senior writes services that are **observable by default**: structured logs with trace IDs, RED metrics (Rate/Errors/Duration), `/debug/pprof` endpoints, runtime-toggleable log levels. Debugging at 3 a.m. is mostly *reading dashboards and logs you set up two months ago* — the work to be debuggable is done in advance.

### 4. The distributed system has no single stack trace

When a request crosses six services, the question "where did this fail?" has no local answer. The senior thinks in **traces, not stacks** — a tree of spans linked by IDs, with the failing span highlighted. Without distributed tracing, you debug by grepping logs across nine machines and a database. With it, you click one span and see the upstream cause.

### 5. Some bugs only exist in aggregate

A function takes 5ms — fine. The same function called from a hot loop 10,000 times per request — a 50-second timeout. Senior debugging frequently means looking at **distributions, not single events**: p99 latency, allocation rate, lock contention. A bug invisible at the single-request level is obvious in a flame graph aggregated over a million requests.

### 6. The kernel is debuggable too

When user-space tools tell you "the syscall returned EAGAIN", you stop at the syscall boundary and ask the kernel. `strace`, `perf`, eBPF, `tcpdump`, `/proc` — these are the lenses into the layer below your runtime. Senior bugs often live below the language: a missing `O_CLOEXEC`, an `EAGAIN` not retried, a TCP window collapse.

### 7. "Restart the pod" is debt, not a fix

When you can't reproduce a bug, restarting the offending process makes the symptom go away. This is fine *as a triage tactic*. It is **not a fix**. Every restart-and-pray hides the diagnostic information you need. Before you restart: take a thread dump, a heap dump, a goroutine dump. Save the artifact. Then restart. The senior turns every incident into evidence.

---

## Real-World Analogies

| Concept | Real-world analogy |
|---------|--------------------|
| Production debugging | A surgeon operating on a beating heart — you cannot stop the patient. |
| Sampling profiler | A security camera that records one frame per second — cheap, lossy, but enough to see patterns. |
| eBPF | An X-ray machine for the kernel — see inside without cutting it open. |
| Distributed tracing | The "track package" page across multiple shipping carriers. |
| Heisenbug | A noise in your car that vanishes when the mechanic listens. |
| Snapshot debugger | A red light camera — captures the state at the moment, but traffic keeps flowing. |
| Race condition | Two waiters grabbing the same plate from the kitchen window. |
| Deadlock | Two cars stuck nose-to-nose on a one-lane bridge, neither willing to back up. |
| Memory leak | Hotel rooms occupied by ghosts — never checking out, but no one is in them. |
| `strace` | A wiretap on every conversation your program has with the kernel. |
| Correlation ID | The case number written on every document in a hospital file. |
| Continuous profiler | A traffic helicopter that's always watching the freeway. |

---

## Mental Models

### Model 1: The cone of doubt

When a production system misbehaves, the cone of doubt is wide — it could be your code, the framework, the runtime, the kernel, the network, the disk, the cloud provider, or DNS. Senior debugging is a discipline of **narrowing the cone**. Each measurement rules out a layer. Don't fix; **rule out**. The goal of each command is to shrink the cone by half.

```text
   ┌───────────────────────────────────────────┐
   │       Where the bug might live            │
   │ Code · Runtime · OS · Net · Disk · Cloud  │
   └───────────────────────────────────────────┘
              │
              ▼  (strace shows no syscalls in disk path)
   ┌───────────────────────────────────────────┐
   │ Code · Runtime · OS · Net                 │
   └───────────────────────────────────────────┘
              │
              ▼  (tcpdump shows no traffic)
   ┌───────────────────────────────────────────┐
   │ Code · Runtime                            │
   └───────────────────────────────────────────┘
```

### Model 2: Premise audit

Sherlock Holmes: *"When you have eliminated the impossible, whatever remains, however improbable, must be the truth."* The senior corollary: **when the impossible has happened, one of your premises is wrong**. List your premises out loud — "the load balancer is sticky," "the cache is invalidated on write," "this code path is single-threaded." For each, ask: *how do I know?* If you cannot answer, you have a candidate.

### Model 3: Time-box, document, re-evaluate

Junior debugging is a rabbit hole. Senior debugging is a **timed loop**: 30 minutes of investigation, then write down what you've ruled out and what you still suspect, then either continue or pull in a peer. The act of writing forces clarity. A scratchpad full of "ruled out: disk IO, GC, lock contention; still suspect: connection pool" is worth more than three hours of staring.

---

## Production Debugging Without Stopping the World

The senior toolbox replaces "attach debugger" with **observe in flight**.

### eBPF — `bpftrace`, `bcc`, Pixie

eBPF lets you run sandboxed programs in the kernel without writing modules. Practically: you can ask questions like *"how long does every `read()` syscall take on this host?"* or *"which TCP retransmits are happening, on which sockets?"* with single-digit microsecond overhead.

```bash
# Histogram of read() latency, system-wide, in nanoseconds.
sudo bpftrace -e 'kprobe:vfs_read { @start[tid] = nsecs; }
                  kretprobe:vfs_read /@start[tid]/ {
                    @ns = hist(nsecs - @start[tid]);
                    delete(@start[tid]);
                  }'
```

`bcc` (BPF Compiler Collection) ships ready-made tools: `execsnoop` (every new process), `opensnoop` (every file opened), `tcpretrans` (TCP retransmits), `runqlat` (scheduler run-queue latency). These are the first tools a senior reaches for when "the host feels slow."

Pixie auto-instruments Kubernetes clusters via eBPF — no code changes, full visibility into HTTP, MySQL, DNS, Redis. Worth knowing exists.

### `strace`, `ltrace`, `dtrace`

| Tool | What it traces | When to use |
|------|---------------|------------|
| `strace` | System calls (Linux) | "Why does this binary not see my config file?" |
| `ltrace` | Library calls | "Which `libc` function is hanging?" |
| `dtrace` | Anything, including user-space probes (macOS, BSD, Solaris) | Cross-layer tracing on non-Linux |
| `perf trace` | Like `strace` but with much lower overhead | Production-safe syscall tracing |

Trap: `strace` slows the traced process roughly 10–100×. Never `strace -p $PID` on a busy production process without warning the on-call.

### Sampling profilers

A sampling profiler interrupts the process N times per second (typically 99 or 100 Hz) and records the call stack. Aggregated, you get a **flame graph** — the wider a bar, the more time spent in that function. Overhead: 1–3%.

- **Go:** `net/http/pprof` exposes `/debug/pprof/profile` (CPU), `/heap`, `/goroutine`, `/mutex`, `/block`. The senior leaves this enabled in production (on a non-public port).
- **Python:** `py-spy` (no code changes, attaches to a running PID).
- **JVM:** `async-profiler` (uses `AsyncGetCallTrace`, avoids JVM safepoint bias).
- **Node:** `0x`, `clinic flame`.

### Continuous profiling

Run the sampling profiler permanently, ship the samples to a backend, get a flame graph per service per deploy. Tools: Pyroscope (open source), Grafana Phlare, Datadog Continuous Profiler, Polar Signals. The win: when latency regresses on Tuesday's deploy, you compare Tuesday's flame graph to Monday's and the culprit function pops out.

### `perf`, `tcpdump`, Wireshark

`perf` is the kernel's swiss-army profiler — CPU, cache misses, branch mispredictions, syscall counts. `perf top` is `top` for functions. `perf record` + `perf report` + FlameGraph.pl is the classic Linux profiling pipeline.

`tcpdump -i any -A 'port 5432'` dumps the actual bytes on the wire — invaluable when "the database says X but the client thinks Y." Pipe to Wireshark for protocol decoding.

> The principle: **observe a healthy process without taking it down.** If the act of debugging crashes your service, the bug wins.

---

## Memory Bugs at Scale

### C / C++ / Rust unsafe — sanitizers

Compile with `-fsanitize=address` (ASan), `-fsanitize=memory` (MSan), `-fsanitize=undefined` (UBSan), `-fsanitize=thread` (TSan). They catch use-after-free, double-free, buffer overflow, uninitialized reads, data races — at 2–4× slowdown, which is too much for production but fine for staging and CI.

```bash
clang -fsanitize=address -g main.c -o main && ./main
# ==1234==ERROR: AddressSanitizer: heap-use-after-free on address 0x...
#   READ of size 4 at 0x... thread T0
#     #0 0x... in process /src/main.c:42
#   freed by thread T0 here:
#     #0 0x... in free
#     #1 0x... in cleanup /src/main.c:30
#   previously allocated by thread T0 here:
#     #0 0x... in malloc
#     #1 0x... in init /src/main.c:15
```

Valgrind/Memcheck remains useful for binaries you cannot recompile — slower (~20×), but no rebuild required.

### Java — heap dumps and dominator trees

`jmap -dump:format=b,file=heap.hprof <pid>` snapshots the heap. Open the `.hprof` in **Eclipse MAT** (Memory Analyzer Tool) and run **Leak Suspects** — MAT computes a **dominator tree** and tells you which object subgraph holds the most retained memory. "A `HashMap` with 12 million entries is retained by `CacheService.instance`" — that's your leak.

### Go — `pprof` heap profiles

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
# (pprof) top
# Showing nodes accounting for 800MB, 95% of 842MB total
#   flat  flat%   sum%        cum   cum%
# 700MB 83.1%  83.1%      700MB 83.1%  github.com/svc/cache.(*LRU).Set
```

`GODEBUG=gctrace=1` prints per-GC summaries to stderr — useful for confirming "is the heap actually growing, or is GC just lazy?"

### Python — `tracemalloc`, `objgraph`

`tracemalloc.start()` then `tracemalloc.take_snapshot().statistics('lineno')` tells you which line allocated the most live memory. `objgraph.show_backrefs(obj)` draws the reference graph that keeps `obj` alive — invaluable for finding *who is holding the reference* in a cycle.

### Node.js — heap snapshots

`--inspect` opens Chrome DevTools' Memory panel. Take three snapshots: before, during, after the leaky operation. The **comparison view** shows which objects grew. `--max-old-space-size=4096` raises the V8 heap ceiling (a workaround, not a fix).

---

## Concurrency Bugs in Depth

### Vocabulary, precisely

| Term | Meaning |
|------|--------|
| **Race condition** | Behavior depends on the timing of events. A *category* — any of the below can be a race. |
| **Data race** | Two threads access the same memory, at least one writes, no synchronization. **Undefined behavior in C/C++/Go.** Specifically what TSan detects. |
| **Deadlock** | Threads wait on each other forever. Detectable with thread dumps. |
| **Livelock** | Threads keep doing work but make no progress (e.g. two processes that politely back off in lockstep). |
| **Starvation** | One thread cannot make progress because others monopolize a resource. |
| **Priority inversion** | A low-priority thread holds a lock a high-priority thread needs. |

A program can have a race condition without a data race (e.g. two `compareAndSwap` calls in the wrong logical order). It can have a data race without a visible bug — until the compiler reorders, the CPU caches differently, or you upgrade Go versions.

### The lock-ordering rule

Deadlocks between two mutexes follow one rule: **acquire locks in a consistent global order**. If every function in your codebase acquires `accountA.lock` then `accountB.lock` only when `accountA.id < accountB.id`, you cannot deadlock. Enforce via code review, lint rules, or types (e.g. `withLocks(a, b, fn)` that sorts internally).

### Detection tools

- **Go race detector:** `go test -race` / `go run -race`. Based on TSan. Catches data races with ~5–10× slowdown. **Run it in CI on every PR.**
- **Java:** `jstack <pid>` dumps every thread's stack. JConsole and Mission Control show contention. Tools like `coverity` and JCStress test concurrent classes.
- **Rust:** `loom` is a model checker — exhaustively explores thread interleavings of a small test. Plus `cargo test` with the borrow checker prevents most data races at compile time.

### Diagnosing "stuck" goroutines

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
# or, in a hung Go process:
kill -SIGQUIT $PID   # GOTRACEBACK=all dumps all goroutines
```

Each stack tells you *where* the goroutine is parked (`runtime.gopark`, `sync.(*Mutex).Lock`, `chan receive`). Group by stack signature — if 10,000 goroutines are all blocked on the same `chan receive`, you have a leak: the producer died.

For Java:

```bash
jstack $PID > threads.txt
# Look for "BLOCKED" threads, then look at "waiting to lock <0x...>" and
# match against another thread "locked <0x...>" — that's the cycle.
```

`kill -3 $PID` (SIGQUIT) makes the JVM print a thread dump to stdout.

---

## Distributed Debugging

### Correlation IDs

The cheapest, most powerful pattern in distributed debugging: a unique ID per request, propagated through every service and stamped on every log line. Conventionally `X-Request-ID` or `traceparent` (W3C Trace Context).

```
client ──[X-Request-ID: 7af3]──> API gateway
                                       │
                            ┌──────────┼──────────┐
                            ▼          ▼          ▼
                       service-A  service-B  service-C
                            │          │          │
                            └──────────┴──────────┘
                                       ▼
                            log aggregator: query `request_id=7af3`
                            → 73 log lines across 4 services, in order
```

### Distributed tracing — OpenTelemetry

A trace is a tree of spans. The root span is the incoming HTTP request; child spans are downstream calls (DB, RPC, cache), each with start/end timestamps and attributes. The senior workflow:

1. Open the trace UI (Jaeger, Tempo, Datadog APM, Honeycomb).
2. Filter by `status_code=500` in the last hour, or by p99 latency.
3. Click the slowest trace. The widest span is the bottleneck.
4. Click into it — the `db.statement` attribute shows the slow query.

> **Practical:** Sample 100% in dev/staging, 1–10% in production with **head-based sampling on errors** (always sample 4xx/5xx). Storage and cost are real.

### Log aggregation queries

| System | Query language | Example |
|--------|---------------|---------|
| Loki | LogQL | `{service="api"} |= "request_id=7af3"` |
| Elasticsearch | KQL / DSL | `service:api AND request_id:"7af3"` |
| Datadog | Datadog query | `service:api @request_id:7af3` |
| CloudWatch | CloudWatch Insights | `fields @timestamp, @message | filter request_id="7af3"` |

### Replaying production traffic

When a bug only appears under real traffic patterns:

- **VCR-style fixtures** (`vcrpy`, `go-vcr`, `wiremock`): record real HTTP interactions in CI, replay in tests.
- **Traffic mirroring (Envoy `shadow`, AWS VPC Traffic Mirroring, GoReplay):** send a copy of production traffic to a staging instance with the suspected fix.
- **Diffy** (Twitter's open-source tool): send each request to old + new versions, compare responses.

### The "one request died, where?" workflow

1. Get the **request ID** from the user's error message (you put it in the response body, right?).
2. Query the log aggregator: `request_id=X`. Read the timeline.
3. Open the distributed trace for the same ID. Find the error span.
4. Pull the heap/CPU profile from the service at that timestamp (continuous profiler).
5. Cross-reference with deploy timeline — did anything ship in the last hour?

---

## Heisenbugs and Flaky Tests

A **Heisenbug** is a bug whose existence depends on observation — adding a `println` makes it go away. The senior recognizes the species and adapts.

### Sources of nondeterminism

- **Time:** `time.Now()`, expiration timestamps, race-on-second-boundary.
- **Randomness:** untested seed, `Math.random()`.
- **Network:** DNS, TCP windows, packet loss, congestion.
- **GC pauses:** test passes on fast machine, fails on slow CI.
- **OS scheduling:** different number of cores changes interleaving.
- **File system ordering:** `readdir` order is not guaranteed.
- **Locale / timezone / env vars:** `LANG=C` vs `LANG=en_US.UTF-8`.
- **Hash seed:** Go and Python randomize map iteration order per process.

### Reproduction strategies

- **Increase pressure.** Run the test 10,000 times in a loop (`go test -count=10000 -race`).
- **Restrict resources.** `taskset -c 0` (one core), `cgroup` memory limits, `tc qdisc` to add latency.
- **Slow the disk.** `dd` writing junk in the background.
- **Record-replay.** [`rr`](https://rr-project.org/) records every nondeterministic input and replays exactly. Pernosco offers it as a service for C/C++/Rust.
- **Fault injection.** Chaos Monkey, Toxiproxy, `tc netem` — make failures the default.

### Flaky tests — quarantine vs fix

The senior judgment call: a test that fails 0.1% of the time is **worse than a test that always fails**, because it trains the team to ignore CI. Three responses:

1. **Fix it now.** If the cause is obvious (timing, ordering).
2. **Quarantine it.** Mark it `Skip`/`Ignore`, file a ticket, set a deadline. Honest debt.
3. **Delete it.** If nobody can explain what it's testing, it doesn't deserve to stay flaky.

Never accept "just rerun CI" as a permanent answer.

---

## The "Debug Fearlessly" Mindset

The seniors who debug fast share a posture:

1. **Trust nothing, verify everything.** "The config is loaded" — show me. "The mutex is acquired" — show me. Every premise is a hypothesis.
2. **When the impossible has happened, one of your premises is wrong.** Re-read the code with adversarial eyes. The `if !ok` you skimmed past is the bug.
3. **Adding instrumentation > guessing.** A `log.Printf` deployed to one canary pod beats four hours of theory.
4. **Time-box.** 30 minutes of investigation, then write down what you've ruled out and re-evaluate. Beat the sunk-cost fallacy.
5. **Read the code, not the comments.** Comments lie. Code runs.
6. **Read the change log, not the latest version.** Many bugs are recent. `git log -p path/to/file` is a debugger.
7. **The simplest explanation that fits the evidence is usually right** — but only after you have the evidence. Don't guess in the dark.
8. **Bring a peer at hour two.** Rubber-ducking with a senior teammate halves diagnosis time. It is not weakness; it is calibration.

> The senior is not the person who knows the answer. The senior is the person who **runs a process that converges on the answer**, even when they start with no idea.

---

## System-Call Level Debugging

When user-space tools fail, the syscall boundary is the next floor down.

```bash
# What files is this binary opening?
strace -f -e trace=openat,read,write ./prog 2>&1 | head -40
# openat(AT_FDCWD, "/etc/myapp/config.yaml", O_RDONLY) = -1 ENOENT
# openat(AT_FDCWD, "/usr/local/etc/myapp/config.yaml", O_RDONLY) = 3
#   ^ AH-HA: it's reading the wrong config.
```

```bash
# What library calls is it making?
ltrace -e 'getenv' ./prog
# getenv("HOME") = "/home/svc"
# getenv("XDG_CONFIG_HOME") = nil
```

```bash
# What's actually on the wire to Postgres?
sudo tcpdump -i any -A 'port 5432' -c 200
# ...0...SELECT id, name FROM users WHERE id = $1...
#   ^ confirms parameterized query, not concatenated SQL.
```

```bash
# Which file descriptors does process 1234 have open?
lsof -p 1234
# COMMAND   PID  USER   FD   TYPE  ...   NAME
# api      1234  svc    7u   IPv4  ...   TCP localhost:54321->postgres:5432
# api      1234  svc    8u   IPv4  ...   TCP localhost:54322->redis:6379
# api      1234  svc    9u   REG   ...   /var/log/api.log
# ...
# api      1234  svc  4093u  IPv4  ...   TCP -> external-api:443 (CLOSE_WAIT)
#   ^ 4000 sockets in CLOSE_WAIT = you forgot to close response bodies.
```

| Bug class | First-line tool |
|-----------|----------------|
| Wrong config path / file not found | `strace -e openat` |
| Hung on syscall | `strace -p $PID` (briefly) or `cat /proc/$PID/wchan` |
| FD leak | `lsof -p $PID | wc -l` over time |
| Wire protocol mystery | `tcpdump` |
| DNS oddities | `dig`, `getent hosts`, `strace -e connect` |
| Permission denied that shouldn't be | `strace -e openat,connect` for the exact `EACCES` |

---

## Snapshot Debugging in Production

Tools: **Rookout**, **Lightrun**, **Datadog Live Debugger**. The idea: drop a "non-breaking breakpoint" on a line of running production code. When execution reaches it, the tool snapshots local variables and ships them to a UI — without pausing the process.

Use it when:

- The bug is rare and lives deep in code you can't easily reproduce locally.
- Redeploying for a log line is expensive (slow CI, regulated environment).
- You need a value from one specific request out of millions.

Do not use it when:

- The captured state would include PII / secrets. Most tools have redaction, but **review the rules before flipping it on**.
- The line is in a hot path with millions of QPS — even the snapshot cost adds up.
- You don't have permission. These tools can effectively dump memory; treat them as a privileged operation with an audit log.

---

## GC Pauses, JIT, and Runtime Magic

The senior knows where their runtime hides surprises.

### Java GC

- **G1GC** (default since Java 9): regional, mostly concurrent, target pause time tunable via `-XX:MaxGCPauseMillis`. Mixed collections occasionally spike.
- **ZGC** (Java 15+): sub-millisecond STW, scalable to TB heaps. The default choice for new latency-sensitive services.
- **Shenandoah** (OpenJDK alt): similar goals to ZGC.

Diagnose with `-Xlog:gc*:file=gc.log` and visualize with **GCViewer** or **GCEasy**. The senior signature of a GC problem: **periodic latency spikes that align with GC log timestamps**.

### Go GC

Concurrent, tricolor mark-and-sweep. STW phases are sub-millisecond on modern Go. `GODEBUG=gctrace=1` prints one line per GC:

```
gc 42 @5.234s 1%: 0.018+1.2+0.014 ms clock, 0.07+0.4/1.0/0.6+0.05 ms cpu, 32->33->17 MB, 34 MB goal, 4 P
```

- `1%` = GC took 1% of CPU.
- `0.018+...+0.014` = STW start + concurrent mark + STW end. Both STWs are sub-ms.
- `32->33->17 MB` = heap before / after / live.

A latency spike that is *not* in the GC trace is not GC. (Often: lock contention or DNS.)

### Python GC

CPython uses reference counting plus a cycle detector. `gc.set_debug(gc.DEBUG_STATS)` prints cycle-collection stats. For latency-sensitive paths, the senior sometimes calls `gc.disable()` inside the hot loop and `gc.collect()` between requests — but only after measuring that the GC was actually the problem.

### JIT warmup

JVM and V8 ship with **interpreted** code first; the JIT promotes hot methods after enough calls. This is why "the first 1000 requests after deploy are slow" — and why benchmarks that don't warm up lie. `-XX:+PrintCompilation` shows JIT decisions.

---

## The Diagnostic Toolkit You Ship

Every senior-owned service exposes, on a non-public port (or behind auth), at minimum:

1. **`/health`** — liveness + readiness. The load balancer reads it.
2. **`/metrics`** — Prometheus exposition: RED metrics, runtime metrics (heap, GC, goroutines/threads), business counters.
3. **`/debug/pprof/*`** (Go) or equivalent — CPU, heap, goroutine, mutex, block profiles.
4. **Thread dump endpoint** (Java, Go via `goroutine?debug=2`) — for stuck threads.
5. **Heap dump on demand** — `jmap`-equivalent. In Go, hit `/debug/pprof/heap`. In Java, `/actuator/heapdump`.
6. **Runtime log-level toggle** — `POST /admin/loglevel {"level":"DEBUG"}` so on-call can crank verbosity without redeploying.
7. **Version + build info** — `/version` returning git SHA, build time, Go/Java version. *Did the bad version actually deploy?*
8. **Config inspection** — `/admin/config` (with secrets redacted) so on-call sees what config is loaded.

Spring Boot Actuator bundles items 1–7 for the JVM. Go has `net/http/pprof` + `expvar`. Embed these from day one — adding them at 3 a.m. is too late.

---

## Code Examples

### Go — exposing `pprof` in production

```go
package main

import (
	"log"
	"net/http"
	_ "net/http/pprof" // registers /debug/pprof/* on DefaultServeMux
	"time"
)

func main() {
	// Public app traffic on :8080
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(50 * time.Millisecond)
			w.Write([]byte("ok"))
		})
		log.Fatal(http.ListenAndServe(":8080", mux))
	}()

	// Admin/debug surface on :6060 (loopback only in real deploys,
	// or behind mTLS / a sidecar).
	log.Println("pprof listening on 127.0.0.1:6060")
	log.Fatal(http.ListenAndServe("127.0.0.1:6060", nil))
}

// Then from your laptop, via SSH port-forward:
//   go tool pprof -http=:9000 http://localhost:6060/debug/pprof/profile?seconds=30
//   curl 'http://localhost:6060/debug/pprof/goroutine?debug=2' > goroutines.txt
//   curl 'http://localhost:6060/debug/pprof/heap' > heap.pb.gz
```

### Python — `py-spy` + structured trace context

```python
# pip install py-spy structlog opentelemetry-api opentelemetry-sdk
import structlog
from opentelemetry import trace

log = structlog.get_logger()
tracer = trace.get_tracer(__name__)

def handle_request(req_id: str, user_id: int):
    log_ctx = log.bind(request_id=req_id, user_id=user_id)
    with tracer.start_as_current_span("handle_request") as span:
        span.set_attribute("user.id", user_id)
        log_ctx.info("request.start")
        try:
            result = expensive_work(user_id)
            log_ctx.info("request.ok", duration_ms=result.duration_ms)
            return result
        except Exception as e:
            log_ctx.exception("request.error")
            span.record_exception(e)
            raise

# Attach to a running process (no code changes, no restart):
#   sudo py-spy top --pid $PID
#   sudo py-spy dump --pid $PID         # all thread stacks
#   sudo py-spy record -o flame.svg --pid $PID --duration 30
```

### Java — thread dump + heap dump on demand

```java
// Add Spring Boot Actuator:
// management.endpoints.web.exposure.include=health,metrics,heapdump,threaddump,loggers

// curl http://localhost:8081/actuator/threaddump > threads.json
// curl http://localhost:8081/actuator/heapdump  > heap.hprof
// Open heap.hprof in Eclipse MAT.

// Toggle log level at runtime, no redeploy:
// curl -X POST http://localhost:8081/actuator/loggers/com.example.svc \
//      -H "Content-Type: application/json" \
//      -d '{"configuredLevel":"DEBUG"}'

// Manual thread-dump trigger (in case Actuator isn't available):
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;

public class ThreadDumper {
    public static String dump() {
        ThreadMXBean mx = ManagementFactory.getThreadMXBean();
        ThreadInfo[] infos = mx.dumpAllThreads(true, true);
        StringBuilder sb = new StringBuilder();
        for (ThreadInfo info : infos) sb.append(info).append('\n');
        return sb.toString();
    }
}
```

### Rust — `tracing` + `tokio-console` for async debugging

```rust
// Cargo.toml:
//   tokio = { version = "1", features = ["full", "tracing"] }
//   tracing = "0.1"
//   tracing-subscriber = "0.3"
//   console-subscriber = "0.2"

use tracing::{info, instrument};

#[instrument]
async fn handle_request(req_id: &str, user_id: u64) -> anyhow::Result<()> {
    info!(%req_id, user_id, "request.start");
    let result = expensive_work(user_id).await?;
    info!(?result, "request.ok");
    Ok(())
}

#[tokio::main]
async fn main() {
    // tokio-console: see every task, its state, poll time, in real time.
    // Run `tokio-console` in another terminal to attach.
    console_subscriber::init();
    handle_request("abc-123", 42).await.unwrap();
}

# async fn expensive_work(_: u64) -> anyhow::Result<&'static str> { Ok("ok") }
```

---

## Worked Example — 3 a.m. CPU Spike

**Symptom:** PagerDuty fires at 03:12. `cpu_usage{service="orders"}` is at 90% on every pod. Latency p99 is 8s, normally 80ms. Nothing was deployed in the last 24 hours.

**Hypotheses (cone of doubt):**

1. Traffic spike.
2. Slow downstream (DB, third-party API).
3. Memory pressure → GC thrash.
4. Goroutine / thread leak.
5. Hot loop on an unbounded queue.

**Step 1 — rule out traffic.** Grafana dashboard: RPS is flat at 200. *Not* a traffic spike. Cone narrows.

**Step 2 — rule out downstream.** Database CPU is 3%. Tracing UI shows downstream span p99 is normal. *Not* downstream. Cone narrows to: this process.

**Step 3 — runtime metrics.** `go_goroutines{}` is at **48,000** on each pod, normally **150**. There's the smoking gun: a goroutine leak. We have hours, not minutes, of leak.

**Step 4 — goroutine dump.**

```bash
curl 'http://orders-pod-7c9:6060/debug/pprof/goroutine?debug=2' > goroutines.txt
wc -l goroutines.txt   # 480000 lines, ~47900 goroutines
```

**Step 5 — group by stack signature.**

```bash
# Naive bucket: count goroutines parked in the same function.
grep -E '^goroutine [0-9]+ \[' goroutines.txt | sort | uniq -c | sort -rn | head
#  47821 goroutine N [chan receive, 124 minutes]:
#     49 goroutine N [select]:
#     35 goroutine N [IO wait]:
#     14 goroutine N [runnable]:
#      ...
```

47,821 goroutines parked in `chan receive` for 2 hours. **One stack** is doing this. Look at any one of them:

```text
goroutine 78231 [chan receive, 124 minutes]:
internal/notify.(*Notifier).Wait(0xc0004a8000)
	/src/internal/notify/notify.go:88 +0x6d
internal/notify.SendAndWait(...)
	/src/internal/notify/notify.go:42
service/orders.(*Handler).onOrderCreated(0xc0001b8060, 0xc000abc100)
	/src/service/orders/handler.go:213 +0x1ee
created by service/orders.(*Handler).Create
	/src/service/orders/handler.go:201 +0x340
```

**Step 6 — read the code.**

```go
// handler.go:201
func (h *Handler) Create(ctx context.Context, o Order) error {
    // ...
    go h.onOrderCreated(o)   // ← fire-and-forget
    return nil
}

func (h *Handler) onOrderCreated(o Order) {
    notify.SendAndWait(o)    // ← blocks on a channel, no timeout, no ctx
}
```

**Diagnosis.** `notify.SendAndWait` blocks on a downstream `chan` that was never closed because the notification consumer crashed at 01:08 (cross-check: `notify-svc` restart count metric jumped at 01:08). Every `Create` since has leaked a goroutine. After 2 hours × 200 RPS × 2 a.m. ≈ 47,800 stuck goroutines. CPU is 90% because the runtime scheduler is sweating across that many parked Gs.

**Immediate mitigation.** Rolling restart of `orders` pods — drops goroutine count to 150, latency recovers. *Bug is not fixed yet, but the bleeding stops.*

**Permanent fix.**

```go
func (h *Handler) onOrderCreated(ctx context.Context, o Order) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := notify.SendAndWait(ctx, o); err != nil {
        log.Warn("notify failed", "order", o.ID, "err", err)
    }
}
```

Plus an alert: `go_goroutines > 1000 for 5m`. Plus a goroutine-leak unit test using `goleak`.

**Post-mortem write-up takeaways.**

- `/debug/pprof/goroutine` saved 4 hours.
- The cause was a downstream service's crash *two hours earlier*, not visible in this service's alerts. Add: alert on `notify-svc.restart_count`.
- Fire-and-forget goroutines without `context` are a class of bug. Add a lint rule.

---

## Same Memory Leak, Four Languages

The bug: an in-memory cache that never evicts. Each request inserts a 4KB value keyed by request ID.

```text
            ┌──────────────┐        ┌────────────────────┐
request ──> │ insert into  │ ─────> │   cache: HashMap   │
            │  global cache│        │  (never evicted)   │
            └──────────────┘        └────────────────────┘
```

### Diagnostic command per language

| Language | Command | What it shows |
|----------|---------|--------------|
| Go | `go tool pprof http://host:6060/debug/pprof/heap` then `top -cum` | `cache.(*LRU).Set` retains 700MB |
| Java | `jmap -dump:live,format=b,file=h.hprof $PID` → MAT "Leak Suspects" | `HashMap` retained by `CacheService` |
| Python | `tracemalloc.take_snapshot().statistics('lineno')` | `cache.py:42: 800 MiB` |
| Node.js | `--inspect`, three Chrome heap snapshots, compare | retained size of `Map` grows linearly |

### Go

```go
import _ "net/http/pprof"
// later, from your laptop:
//   go tool pprof -http=:9000 http://host:6060/debug/pprof/heap
//   (pprof) top -cum
//   showing nodes accounting for 712MB, 89% of 800MB total
//         flat   flat%    sum%        cum   cum%
//        700MB  87.5%    87.5%      712MB  89.0%   svc/cache.(*LRU).Set
```

### Java

```bash
jmap -dump:live,format=b,file=heap.hprof 12345
# Open in Eclipse MAT → "Leak Suspects" report
# Problem Suspect 1: One instance of "com.svc.CacheService" loaded by
# "AppClassLoader" occupies 712,341,200 (89.04 %) bytes.
# The instance is referenced by ... .CacheService.instance
```

### Python

```python
import tracemalloc, gc
tracemalloc.start(25)
# ... let it run ...
gc.collect()
snap = tracemalloc.take_snapshot()
for stat in snap.statistics('lineno')[:5]:
    print(stat)
# svc/cache.py:42: size=800 MiB, count=200000, average=4 KiB
```

### Node.js

```bash
node --inspect server.js
# In chrome://inspect → Memory → "Take heap snapshot" before/after load.
# Compare → "Constructor: Map" → retained size 712 MB.
```

The shapes differ; the workflow is the same: **take a snapshot, sort by retained size, follow the dominator chain back to the offending field**.

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| Interactive debugger | Precise, immediate | Useless in production; freezes the process |
| Sampling profiler | Low overhead, production-safe | Statistical — misses rare hot paths |
| Tracing profiler | Exact call counts | High overhead; not for production |
| eBPF / `bpftrace` | Kernel-level visibility, microsecond overhead | Linux only; needs root; learning curve |
| `strace`/`ltrace` | Built-in, ubiquitous | Slows the target 10–100× |
| Sanitizers (ASan/TSan/MSan) | Catches latent UB | 2–4× slowdown; recompile needed |
| Continuous profiling | Always-on; great for regressions | Storage cost; needs aggregation backend |
| Snapshot debuggers | Production-safe non-breaking breakpoints | Privacy/PII risk; vendor lock-in |
| Distributed tracing | Maps cross-service flow | Setup cost; sampling decisions are subtle |
| Record-replay (`rr`) | Deterministic replay | Linux x86 only, ~3× recording overhead |

---

## Use Cases

- **3 a.m. paging.** `pprof` + goroutine dump + log search.
- **Memory leak after week 3.** Heap dump + dominator tree.
- **Latency regressed on Tuesday's deploy.** Continuous profiler flame-graph diff.
- **One customer reports a 500.** Request ID → log aggregator → distributed trace.
- **Test flakes 1% in CI.** `-count=100`, `-race`, restrict cores, look for time/order assumptions.
- **Service stuck, not crashed.** Thread/goroutine dump.
- **Wire-level mystery.** `tcpdump` + Wireshark.
- **Permission denied that shouldn't be.** `strace -e openat,connect`.

---

## Coding Patterns

### Pattern: instrument first, then guess

```go
// Bad: spend an hour theorising why the queue grew.
// Good: ship one metric, wait one hour, know.
queueDepth.Set(float64(len(q.items)))
```

### Pattern: every request carries an ID

```go
func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = uuid.NewString()
        }
        ctx := context.WithValue(r.Context(), ctxKeyReqID{}, id)
        w.Header().Set("X-Request-ID", id) // echo back so users can report it
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Pattern: take the dump before the restart

```bash
# Triage runbook step 1 — not step 4.
mkdir -p /tmp/incident-$(date +%s)
kill -SIGQUIT $PID                                          # goroutine dump to logs
curl localhost:6060/debug/pprof/heap > /tmp/incident-*/heap.pb.gz
curl localhost:6060/debug/pprof/goroutine?debug=2 > /tmp/incident-*/gs.txt
# now you may restart
systemctl restart svc
```

### Pattern: feature-flag verbose logging

```python
if feature_flags.is_on("debug_logging", request_id):
    log.debug("detailed", req=request, headers=dict(headers))
```

Turn it on per request, per user, per pod. No redeploy.

---

## Clean Code

- Every service exposes `/debug/pprof` (or equivalent) from day one.
- Every request gets a request ID. Every log line includes it.
- Every async task accepts a `context` / `CancellationToken` / cancellation signal.
- Every long-running goroutine/thread has a documented owner and a way to stop it.
- Every external call has a timeout.
- Every panic in production includes the goroutine ID and the stack.
- No debug print left in a hot path. (`go vet`, ESLint `no-console`.)

---

## Best Practices

1. **Make services observable by default.** Add `/debug/pprof`, `/metrics`, `/healthz`, `/version` to every service template.
2. **Sample CPU and heap continuously in production.** 1% sampling is enough to find regressions.
3. **Always run `-race` in CI.** A data race that ships is a 3 a.m. page.
4. **Propagate request IDs end to end.** Including to the database (`SET application_name`).
5. **Take artifacts before you restart.** Heap dump, thread dump, log tail.
6. **Sanitizers in CI for C/C++/Rust unsafe.** Catch UB before production.
7. **Time-box debugging.** 30-minute loops with a written scratch-pad.
8. **Document runbooks per service.** "If queue depth > N, do X." Future-you will thank present-you.
9. **Practice debugging in tabletop drills.** Restore from a goroutine dump in dev. Don't learn the tool at 3 a.m.

---

## Edge Cases & Pitfalls

- **`pprof` sample bias.** Go's CPU profiler can under-sample syscall-heavy code (pre-1.18) and signal-disabled code. Cross-check with traces.
- **GC log scale.** A GC log line every 100ms ×  30 days = lots of disk. Rotate.
- **`strace` permission.** On hardened hosts you'll hit `ptrace_scope=2` — needs `CAP_SYS_PTRACE` or root.
- **Thread dump on Java doesn't show native threads.** Use `jstack -m` (mixed mode) for JNI.
- **Memory profile only sees allocations, not native memory.** A C library `malloc` leak inside the JVM won't show in heap dumps — use `jcmd VM.native_memory`.
- **Sampling under low traffic is useless.** A flame graph from 30 samples is noise. Profile during load tests.
- **Sanitizers don't compose.** ASan and TSan are mutually exclusive in the same build.
- **Continuous profiler PII leak.** Stack frames can include parameter names; some include values. Audit.

---

## Common Mistakes

1. **Restarting the pod before taking artifacts.** You lose the evidence.
2. **"It works on my machine" without verifying GOMAXPROCS, CPU count, kernel version.**
3. **Adding a log line and calling that "the fix."** You masked the timing.
4. **Reading the trace tree without checking the wall-clock of each span.** Misleading.
5. **Trusting metrics over logs over code.** They lie at different rates. Triangulate.
6. **Profiling on a warm process and missing JIT effects.** Or profiling cold and missing steady state.
7. **Forgetting that `/debug/pprof` is on the public port.** It's a remote code execution surface (CPU profile triggers stack collection). Bind to loopback.
8. **Using a snapshot debugger on a hot loop.** Even a non-breaking breakpoint costs.
9. **Letting flaky tests stay flaky for months.** The team stops trusting CI.
10. **Closing the incident before writing the post-mortem.** The fix is half the value.

---

## Tricky Points

- **A goroutine in `select` waiting on `ctx.Done()` is still a goroutine.** It counts toward the leak.
- **Stack traces lie under heavy inlining.** Compile with `-gcflags="-l"` (Go) or `-XX:-Inline` (JVM) to get true frames — but only for a debugging build.
- **`tcpdump` on `lo` is special.** Loopback packets bypass some kernel paths; use `--direction=in` or capture on the inner interface.
- **Continuous profilers symbolize on the host.** If the binary on disk changed (rolled deploy), symbolization breaks. Keep build artifacts.
- **GC pauses that align with load spikes might be load-induced.** Allocations *cause* GC. Look at allocation rate, not pause time alone.
- **`strace -p` on a thread doesn't follow forks.** Add `-f`.
- **`jstack` on a deadlocked JVM is the *only* tool that works.** Heap dump and CPU profile may hang.
- **Containers hide PIDs.** `kubectl exec -- ps` shows container PIDs; `pprof` URLs need the in-container port; `lsof` needs `nsenter`.

---

## Test Yourself

1. A Go service shows `go_goroutines` climbing 1k/hour. Describe the exact sequence of commands you would run, in order, to identify the leak source.
2. A Java service exhibits 200ms latency spikes every 30 seconds. List the three most likely causes and the command that distinguishes them.
3. You suspect a production race condition but cannot reproduce locally. What three production-safe techniques would you apply to increase the probability of reproduction?
4. Given a heap dump showing `HashMap` retained by `CacheService`, walk through how MAT's dominator tree confirms the cause.
5. You have a Linux host where one process is allegedly "hanging on disk I/O." Which eBPF tool answers this, and what does its output look like?
6. Design a request-ID propagation scheme across three services: HTTP gateway → gRPC service → Kafka consumer. What gets injected where?
7. A test passes locally but fails on CI 5% of the time. Outline a debugging plan that does not start with "just rerun it."
8. A Python service grows memory by 50MB per 1000 requests. Demonstrate the `tracemalloc` workflow that pinpoints the leak.

---

## Tricky Questions

1. **Q: A `strace` on a process makes it 50× slower. Is `strace` itself the bug?**
   A: No — `strace` reveals that the process makes huge numbers of syscalls per request. The bug is *that*. Use `perf trace` or `bpftrace` for a low-overhead measurement.

2. **Q: Why does my Go service have 47,000 goroutines but `top` shows only 8 OS threads?**
   A: Goroutines are multiplexed onto OS threads by the runtime. Most are parked (blocked on channels/select); only runnable goroutines occupy threads. The OS sees `GOMAXPROCS` worth of threads regardless of goroutine count.

3. **Q: A continuous profiler shows a flame graph dominated by `runtime.findRunnable`. What does that mean?**
   A: The Go scheduler is spending CPU looking for work — usually because the *application* has lots of short-lived goroutines or heavy parking. It's a symptom of a scheduling pathology, not a bug in the runtime.

4. **Q: I added `gc.disable()` to my Python hot loop and latency dropped 30%. Should I leave it off?**
   A: Probably not. Reference counting still runs; you only disabled cycle detection. If your code creates cycles, memory will grow until you call `gc.collect()` manually. Measure both latency and memory.

5. **Q: My distributed trace shows a 4-second gap between a span ending and its parent ending. What's in the gap?**
   A: Time spent in the parent service *after* the child returned — usually serialization, response writing, or post-processing not yet instrumented. Add a child span around the suspect code.

6. **Q: Why is "add a log line" sometimes a Heisenbug fix?**
   A: Because `printf` flushes, syncs, takes a mutex, or yields the scheduler — all of which change timing. The bug is still there; you just changed the race window. Worse: future-you will remove the log and the bug returns.

7. **Q: I see `CLOSE_WAIT` sockets piling up. Whose bug is this?**
   A: The local process's. `CLOSE_WAIT` means the remote sent FIN and the local app hasn't called `close()`. Usually means HTTP response bodies aren't being closed, or a connection pool isn't returning connections.

8. **Q: ASan reports a heap-use-after-free, but I cannot reproduce without ASan. Real bug?**
   A: Yes, almost certainly. ASan changes allocator behavior so reads after free hit poisoned memory deterministically; without ASan, the memory might still hold the old value and the bug is invisible until the allocator reuses it. Fix it.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════╗
║                  SENIOR DEBUGGING CHEAT SHEET                    ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  PRODUCTION-SAFE                                                 ║
║   • Sampling profilers: py-spy, async-profiler, Go pprof         ║
║   • eBPF: bpftrace, bcc (execsnoop, opensnoop, runqlat)          ║
║   • Snapshot debuggers: Rookout, Lightrun, Datadog Live          ║
║   • Continuous profiling: Pyroscope, Phlare, DD Profiler         ║
║                                                                  ║
║  KEEP-OUT-OF-PROD                                                ║
║   • Interactive debuggers (gdb, dlv attach on hot proc)          ║
║   • Tracing profilers                                            ║
║   • strace -p on hot proc                                        ║
║                                                                  ║
║  TRIAGE ARTIFACTS — TAKE BEFORE RESTART                          ║
║   • Goroutine/thread dump  (curl pprof, kill -3, jstack)         ║
║   • Heap dump              (pprof heap, jmap, --inspect)         ║
║   • Log tail with request_id index                               ║
║   • Recent traces around the incident timestamp                  ║
║                                                                  ║
║  THE DEBUG LOOP                                                  ║
║   1. State the symptom precisely.                                ║
║   2. List premises. Mark each "verified" / "assumed".            ║
║   3. Pick the cheapest experiment that rules one out.            ║
║   4. Run it. Write the result.                                   ║
║   5. Repeat. Time-box 30 min. Bring a peer at hour 2.            ║
║                                                                  ║
║  RUNTIME ENDPOINTS YOU SHIP                                      ║
║   /health   /metrics   /debug/pprof/*   /version                 ║
║   /admin/loglevel   /actuator/threaddump   /actuator/heapdump    ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Summary

- Senior debugging is about **observing live systems without disturbing them**: eBPF, sampling profilers, snapshot debuggers, distributed traces.
- The unit of debugging shifts from a process to a **fleet** and a **request chain**.
- **Reproduction is half the bug.** When you can't reproduce, force the conditions (load, fewer cores, fault injection, traffic replay).
- **Build debuggability in**: `/debug/pprof`, `/metrics`, `/health`, request IDs, runtime log-level toggles, on-demand heap dumps. Adding these at 3 a.m. is too late.
- **Concurrency vocabulary matters**: race condition vs data race vs deadlock vs livelock — different tools find different ones.
- **Distributed bugs need distributed tools**: correlation IDs, distributed tracing, log aggregation, traffic mirroring.
- **Take artifacts before you restart**: goroutine dump, heap dump, log tail. The restart is a triage tactic, not evidence.
- **Heisenbugs and flakes are non-determinism in disguise.** Find the source: time, randomness, scheduling, ordering.
- **Time-box, document, re-evaluate.** A scratch-pad of ruled-out hypotheses beats hours of staring.
- **When the impossible has happened, one of your premises is wrong.** Audit them out loud.

---

## What You Can Build

- A **service template** (Go, Java, or Python) that ships with `/health`, `/metrics`, `/debug/pprof`, runtime log-level toggle, and request-ID middleware preconfigured.
- A **debugging runbook** for one of your team's production services — pre-written "if X is wrong, run Y."
- A **continuous-profiling pipeline**: run Pyroscope locally, push samples from a demo service, diff flame graphs across two deploys.
- A **distributed tracing demo**: three services (gateway → api → worker) instrumented with OpenTelemetry, visualized in Jaeger.
- A **goroutine-leak detector**: a wrapper that snapshots `goroutine` count at test start and end, fails if delta > 0.
- A **chaos-style flake reproducer**: a CI job that runs the test suite under `taskset -c 0`, `tc qdisc netem delay 50ms`, and `gctrace=1` to surface flaky tests early.
- An **incident artifact collector**: a sidecar that, on receiving SIGUSR1, dumps heap, goroutines, last 10k log lines, and tar-balls them to S3.

---

## Further Reading

- Brendan Gregg, *Systems Performance: Enterprise and the Cloud* (2nd ed.). The canonical book on Linux performance and observability.
- Brendan Gregg's website: [brendangregg.com](http://www.brendangregg.com/) — flame graphs, eBPF, perf.
- *BPF Performance Tools*, Brendan Gregg.
- Julia Evans, *Debugging Manifesto* — short, sharp, free PDFs at [wizardzines.com](https://wizardzines.com).
- *Site Reliability Engineering*, Google (ch. on debugging and post-mortems).
- The OpenTelemetry documentation: [opentelemetry.io](https://opentelemetry.io/docs/).
- Go's `runtime/pprof` docs and Russ Cox's blog posts on profiling.
- Eclipse Memory Analyzer (MAT): [eclipse.dev/mat](https://eclipse.dev/mat/).
- The `rr` debugger: [rr-project.org](https://rr-project.org/). Pernosco: [pernos.co](https://pernos.co/).
- Pyroscope continuous profiling: [pyroscope.io](https://pyroscope.io/).
- Cindy Sridharan, *Distributed Systems Observability* (O'Reilly).
- John Regehr's blog on undefined behavior and sanitizers.

---

## Related Topics

- [Debugging — Junior](junior.md) — your first debugger, `printf`, stack traces.
- [Debugging — Middle](middle.md) — conditional breakpoints, core dumps, race detector.
- [Debugging — Professional](professional.md) — debugging as an organizational discipline; post-mortems; safety culture.
- [Debugging — Interview Questions](interview.md) — what staff/senior interviews actually ask.
- [Debugging — Tasks](tasks.md) — graded exercises for this level.
- [Error Handling — Senior](../error-handling/senior.md) — error boundaries, propagation, recovery.
- [Logging — Senior](../logging/senior.md) — structured logs, correlation IDs, log aggregation.
- [Diagnostics Roadmap](../README.md) — the umbrella.

---

## Diagrams & Visual Aids

### Distributed debug flow

```text
              ┌──────────┐   X-Request-ID: 7af3
   client ──> │  client  │ ───────────────────────────────────────┐
              └──────────┘                                        ▼
                                                          ┌───────────────┐
                                                          │  API Gateway  │
                                                          └───────┬───────┘
                                                                  │ (propagate ID)
                              ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
                              ▼                   ▼               ▼               ▼                   ▼
                       ┌────────────┐      ┌────────────┐  ┌────────────┐  ┌────────────┐      ┌────────────┐
                       │ auth-svc   │      │ orders-svc │  │ pricing    │  │ inventory  │      │ notify-svc │
                       └─────┬──────┘      └─────┬──────┘  └─────┬──────┘  └─────┬──────┘      └─────┬──────┘
                             │                   │               │               │                   │
                             └───────────────────┴───────────────┼───────────────┴───────────────────┘
                                                                 │ logs + spans tagged with request_id=7af3
                                                                 ▼
                                                       ┌─────────────────┐
                                                       │ log aggregator  │ ── query: request_id=7af3
                                                       │  + trace store  │     → full timeline of one request
                                                       └─────────────────┘
```

### Cone of doubt narrowing

```text
                  ALL POSSIBLE CAUSES
   ┌──────────────────────────────────────────────────┐
   │ Code · Runtime · OS · Net · Disk · Cloud · DNS   │
   └──────────────────────────────────────────────────┘
                          │  metric: disk_io flat
                          ▼
   ┌──────────────────────────────────────────────────┐
   │ Code · Runtime · OS · Net · Cloud · DNS          │
   └──────────────────────────────────────────────────┘
                          │  tcpdump shows no retransmits
                          ▼
   ┌──────────────────────────────────────────────────┐
   │ Code · Runtime · DNS                             │
   └──────────────────────────────────────────────────┘
                          │  resolver latency is 1ms
                          ▼
   ┌──────────────────────────────────────────────────┐
   │ Code · Runtime                                   │
   └──────────────────────────────────────────────────┘
                          │  GC trace shows 2ms pauses
                          ▼
                  ┌───────────────┐
                  │     CODE      │  ← now we can read it
                  └───────────────┘
```

### The diagnostic toolkit on one service

```text
                              ┌─────────────────────────────┐
                              │       your-service          │
                              │                             │
   8080 ──── traffic ────────►│  app handlers               │
                              │                             │
                              │  ┌───────────────────────┐  │
                              │  │ admin port :6060      │◄─┼── 6060 (loopback / authn)
                              │  │                       │  │
                              │  │ /health               │  │
                              │  │ /metrics              │  │
                              │  │ /version              │  │
                              │  │ /debug/pprof/profile  │  │
                              │  │ /debug/pprof/heap     │  │
                              │  │ /debug/pprof/goroutine│  │
                              │  │ /admin/loglevel       │  │
                              │  │ /admin/config         │  │
                              │  └───────────────────────┘  │
                              └─────────────────────────────┘
```
