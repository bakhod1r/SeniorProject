# Dynamic Instrumentation & eBPF — Interview Questions

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
> Observing a running program or the Linux kernel — its calls, latencies, and arguments — without touching source, recompiling, or restarting.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Probes & Attach Points](#probes--attach-points)
4. [eBPF Internals & the Verifier](#ebpf-internals--the-verifier)
5. [bpftrace / BCC Practical](#bpftrace--bcc-practical)
6. [Tricky / Trap Questions](#tricky--trap-questions)
7. [System / Design Scenarios](#system--design-scenarios)
8. [Behavioral / Experience](#behavioral--experience)
9. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
10. [Cheat Sheet](#cheat-sheet)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

Dynamic instrumentation shows up wherever the question is "the box is misbehaving *right now* and there is nothing useful in the dashboards." SRE, platform-engineering, and performance interviews lean on it to separate people who *consume* observability from people who can *manufacture* it on demand — someone who, handed a slow production host with no instrumentation in the hot path, can attach to a running kernel or process and extract per-function latency in under five minutes. The eBPF angle specifically tests whether you understand the safety story (verifier, no crashes, no recompiles) well enough to be trusted to run it in production.

Use this bank as a layered drill. Start with the conceptual section to get the framing crisp ("pre-paid vs pay-as-you-go observability"), then move to probes and verifier internals, which is where mid-level and senior answers diverge. The practical section expects you to *type real one-liners* — `bpftrace` and BCC tool names should come off your fingers, not your memory of a blog post. The trap and scenario sections are where strong candidates demonstrate judgment: knowing what a kprobe *cannot* tell you, and when an in-app span beats a kernel probe.

---

## Conceptual / Foundational

**Q: What is dynamic instrumentation, and how does it differ from static instrumentation?**

Static instrumentation means the measurement points are compiled in: log statements, OpenTelemetry spans, Prometheus counters, USDT markers placed by the author. The cost is paid at build time and the points are fixed. Dynamic instrumentation attaches measurement to an *already-running* program or kernel at runtime — you pick the function or event after the fact, observe it, and detach, leaving the binary untouched. The trade-off: static gives you semantically rich, intentional signals; dynamic gives you the ability to instrument code nobody anticipated needing to instrument, including third-party binaries and the kernel itself.

**Q: What is eBPF in one sentence?**

eBPF is a sandboxed virtual machine inside the Linux kernel that lets you load small, verified-safe programs which run in response to kernel and user-space events, without writing a kernel module or rebooting.

**Q: What problem does eBPF solve that logs, metrics, and traces don't?**

Logs, metrics, and traces are all *pre-paid*: someone decided in advance what to record, instrumented it, and you pay storage and emission cost for it whether or not you ever look. They answer questions you anticipated. eBPF is *pay-as-you-go*: when an unanticipated question arises ("which process is hammering this syscall? what's the distribution of disk I/O latency right now?") you attach a probe, collect exactly that, and stop. It fills the gap between "I have no signal for this" and "I'd have to ship code and wait for a deploy."

**Q: Explain "pre-paid vs pay-as-you-go observability."**

Pre-paid observability is the dashboards, metrics, and structured logs you instrument ahead of time and pay for continuously — predictable cost, predictable coverage, blind spots exactly where you didn't think to instrument. Pay-as-you-go observability is dynamic tracing you spin up only when you have a question, targeted at the precise event, and tear down immediately. The mature posture is both: pre-paid signals to *detect and triage*, dynamic tracing to *root-cause* the long tail that pre-paid coverage never anticipated.

**Q: Why eBPF instead of writing a kernel module?**

A kernel module runs as fully trusted ring-0 code: a bug panics the box, and a module compiled against one kernel often won't load on another. eBPF programs are passed through a static verifier that proves termination and memory safety *before* they run, so a buggy program is rejected, not loaded — it cannot panic the kernel. eBPF also has a stable helper-function ABI and, with CO-RE/BTF, a portable bytecode that runs across kernel versions, which modules cannot offer. The cost is expressiveness: you live within the verifier's rules.

**Q: Is eBPF a replacement for application tracing / OpenTelemetry spans?**

No. eBPF sees the kernel boundary and whatever symbols exist in a binary — syscalls, network events, function entry/exit — but it does not know your application's *semantics*: which user, which tenant, which business transaction, the trace context propagated across services. eBPF auto-instrumentation can synthesize spans for protocols it understands (HTTP, gRPC, SQL) with zero code changes, which is great for coverage, but it cannot reconstruct a custom in-process workflow or attach domain attributes the way an in-app SDK span can. They are complementary: eBPF for broad, code-free coverage; SDK spans for semantic depth.

**Q: What are the hard limits and honest caveats of eBPF?**

It is Linux-only (the BSDs and Windows have separate, less mature efforts). It needs a reasonably modern kernel — many features assume 5.x+, CO-RE needs BTF (kernel `CONFIG_DEBUG_INFO_BTF`, broadly available from ~5.2 / RHEL 8.2 onward). Loading programs requires elevated privilege — `CAP_BPF`/`CAP_PERFMON` or historically root. Uprobes on a hot user-space function can add meaningful overhead because each hit traps into the kernel. And it is an observation tool, not a fix: it tells you *what* is slow, not *why your code* is slow at the business-logic level.

**Q: What does "without recompiling or restarting" actually buy you operationally?**

It collapses the feedback loop from a deploy cycle to seconds. The classic alternative — "add a log line, build, deploy, wait for the condition to recur" — can take hours or days and changes the system you're trying to observe. Dynamic instrumentation lets you interrogate the exact process that is currently misbehaving, with its current state and traffic, and get an answer before the incident resolves itself. For intermittent or load-dependent problems that vanish on restart, this is often the *only* way to catch them.

**Q: What's the difference between observability and dynamic instrumentation as terms?**

Observability is the property of a system: can you ask arbitrary questions about its internal state from the outside? Dynamic instrumentation is one *technique* for achieving it — a powerful one because it lets you add observation points after deployment. You can have rich observability with only static instrumentation (if you instrumented the right things), and you can use dynamic instrumentation precisely when your static observability falls short.

**Q: Roughly how does eBPF overhead compare to other approaches?**

A tracepoint or a well-bounded kprobe is cheap — typically tens to low hundreds of nanoseconds per event, and the program runs in-kernel so there's no context switch per event to user space. The expensive parts are: very high-frequency events (instrumenting every `tcp_sendmsg` on a 100Gbit link), uprobes on hot user functions (each is a trap), and copying large payloads to user space. The discipline is to aggregate *in the kernel* (histograms, counts in maps) and ship summaries out, rather than emitting one user-space event per kernel event.

---

## Probes & Attach Points

**Q: Compare kprobe, kretprobe, uprobe, uretprobe, tracepoint, and USDT.**

A **kprobe** fires on entry to (almost) any kernel function and gives you its arguments. A **kretprobe** fires on return and gives you the return value. **uprobe**/**uretprobe** are the user-space equivalents: entry and return of a function in a user binary or shared library. A **tracepoint** is a stable, named instrumentation point the kernel developers placed deliberately (e.g. `sched:sched_switch`), with a documented, versioned argument format. **USDT** (User Statically-Defined Tracing) is the user-space analogue: markers a developer baked into the binary (common in libc, the JVM, PostgreSQL, MySQL). Roughly: tracepoint/USDT are stable and intentional; kprobe/uprobe are dynamic and can attach anywhere but are not contract-stable.

**Q: Why prefer a tracepoint over a kprobe when both are available?**

Tracepoints are a stability contract: their name and argument layout are maintained across kernel versions, so a tool built on `tracepoint:syscalls:sys_enter_openat` keeps working after a kernel upgrade. A kprobe attaches to an internal function name that can be renamed, inlined, or split between versions — `do_sys_open` became `do_sys_openat2`, and inlined functions vanish entirely from the symbol table, so the kprobe silently attaches to nothing. Use a tracepoint when one exists; fall back to a kprobe only for internals that have no tracepoint.

**Q: How do you capture function arguments vs the return value?**

Arguments are available at *entry* — in bpftrace, `arg0`, `arg1`, … for kprobes/uprobes, and named fields (`args.filename`) for tracepoints. The return value is available only at *return* — `retval` in a kretprobe/uretprobe. The catch: at return, the original arguments are gone (registers have been clobbered), so to correlate a call's args with its result you must save the args at entry, keyed by thread, and read them back at return.

**Q: When would you use each probe type in practice?**

Use **tracepoints** for stable kernel events (scheduling, syscalls, block I/O, networking). Use **kprobes** to reach kernel internals with no tracepoint, accepting fragility. Use **USDT** when the application author gave you semantic markers (JVM GC events, `mysql:query__start`). Use **uprobes** to trace a specific user-space function (a library call, a function in your own binary) when you have its symbol. As a rule: most stable first, drop to dynamic probes only when forced.

**Q: What are fentry/fexit and why are they better than kprobes where available?**

`fentry`/`fexit` are newer attach mechanisms (kernel 5.5+) built on BPF trampolines. They do the same job as kprobe/kretprobe — function entry and exit — but with lower overhead (no breakpoint-trap mechanism) and a major bonus: in an `fexit` program you have access to *both* the arguments and the return value at once, eliminating the save-at-entry/read-at-exit dance. They require BTF and a recent kernel; where those exist, prefer `fentry:func`/`fexit:func` over `kprobe`/`kretprobe`.

**Q: What's the difference between `profile` and `interval` probes in bpftrace?**

`profile:hz:99` fires on *every CPU* at 99 Hz — it's a sampling profiler, used to capture stacks across the fleet of CPUs for flame graphs. `interval:s:1` fires *once* (on one CPU) every second — it's a timer, used to print accumulated aggregates periodically (a live counter, a per-second rate). Profile is for "what is the CPU doing"; interval is for "emit my running totals on a clock."

**Q: How stable and portable are kprobe-based tools across kernels?**

Not very, by themselves. A kprobe hard-codes a kernel function name and assumes a struct layout; both can change between versions. This is exactly the problem CO-RE (Compile Once – Run Everywhere) and BTF solve for compiled libbpf programs — the loader relocates struct field offsets at load time against the running kernel's BTF. But the function *name* and *existence* still aren't guaranteed; if `tcp_set_state` is renamed or inlined, even a CO-RE program needs a fallback. bpftrace mitigates this by reading the running kernel's tracefs/BTF, but a one-liner that names a kprobe can still hit nothing on a different kernel.

**Q: Why are USDT probes considered "free when not enabled"?**

A USDT marker compiles down to a single no-op instruction (a `nop`) plus metadata in an ELF note. When nothing is tracing it, the marker costs effectively one no-op — negligible. When a tracer attaches, it patches that location to fire the probe. This is why projects ship USDT probes by default: zero steady-state cost, instant rich semantics when someone needs them.

**Q: Can you attach to a function that's been inlined?**

No — inlined functions have no distinct entry point in the compiled binary, so there is no address for a kprobe/uprobe to attach to, and they often don't appear in the symbol table. This is a common reason a probe "attaches" to nothing or the name isn't found. Workarounds: trace the caller or a non-inlined neighbor, use a tracepoint/USDT if one exists, or for user space compile with the symbols you need and `-fno-inline` on the target (rarely an option in prod).

**Q: What does it mean that a kprobe can attach "almost anywhere" — what's excluded?**

You cannot kprobe functions on the kprobe machinery's own path (you'd recurse infinitely), functions marked `__kprobes`/`NOKPROBE_SYMBOL`, and anything inlined or optimized away. There's also a denylist the kernel maintains for functions that are unsafe to probe. Everything else with a symbol is fair game — which is the power and the danger: you can instrument code with no stability guarantees whatsoever.

---

## eBPF Internals & the Verifier

**Q: Walk through how an eBPF program runs, end to end.**

You write the program (in C compiled to BPF bytecode by clang/LLVM, or generated by bpftrace). It's loaded via the `bpf()` syscall, where the **verifier** statically analyzes it and either rejects or accepts it. On acceptance the **JIT** compiles the bytecode to native machine code. The program is then **attached** to an event (kprobe, tracepoint, etc.). When that event fires, the kernel runs the native code in a restricted context; the program reads data via **helper functions** and stores results in **maps**. User space reads those maps (or drains a ring/perf buffer) to get the data out. Detach unloads everything.

**Q: What does the verifier check, and why does it have to?**

The verifier proves, before the program ever runs, that it is safe to execute in the kernel: it terminates (no unbounded loops), it never reads or writes out-of-bounds memory, it only calls helpers allowed in its program type, it doesn't leak kernel pointers to user space, and it leaves the stack in a valid state. It must do this *statically* because the program runs in kernel context where a bad access is a panic — there's no sandbox to catch a fault at runtime cheaply. It simulates all reachable execution paths and tracks the possible value range and type of every register.

**Q: What are the verifier's main hard limits?**

The big ones: a maximum of ~1 million instructions analyzed (older kernels capped the *program* at 4096 instructions); a 512-byte stack; loops must be provably bounded (early kernels banned loops entirely, 5.3+ added bounded loops, later `bpf_loop()` helper); and you may only call helpers whitelisted for your program type. Complexity also matters — a program with too many paths can blow the verifier's analysis budget even if each path is fine.

**Q: What's a classic verifier rejection, and what does it actually mean?**

The most common one: you do a `bpf_map_lookup_elem()`, get a pointer back, and dereference it without checking for NULL. The verifier rejects with something like `invalid mem access 'map_value_or_null'`. The lookup returns a value-*or-null* type, and the verifier refuses to let you touch it until you've proven it's non-null:

```c
u64 *val = bpf_map_lookup_elem(&my_map, &key);
if (!val)          // <-- mandatory: collapses the type to map_value
    return 0;
(*val)++;          // now legal
```

Without the `if (!val)` guard the program will not load. This is the verifier preventing a NULL dereference in kernel context.

**Q: What are eBPF maps and why do they matter?**

Maps are the kernel/user-space shared data structures and the only durable state an eBPF program has (its stack is wiped each invocation). Types include hash, array, per-CPU variants (for lock-free aggregation), LRU hash, stack-trace maps, ring buffer, perf event array, and more. They're how a program accumulates results (a histogram, a per-PID counter) that survives across millions of invocations and how user space reads the data out. Per-CPU maps are the key to low-overhead counting at high event rates — each CPU updates its own copy, no contention, summed at read time.

**Q: Ring buffer vs perf buffer — what's the difference and which do you choose?**

The **perf buffer** (`BPF_MAP_TYPE_PERF_EVENT_ARRAY`) is per-CPU: each CPU has its own ring, which means memory scales with CPU count and ordering across CPUs is lost. The **ring buffer** (`BPF_MAP_TYPE_RINGBUF`, kernel 5.8+) is a single shared, MPSC buffer with better memory efficiency, preserved event ordering, and a reserve/commit API that avoids an extra copy. Prefer the ring buffer on modern kernels; use the perf buffer when you must support pre-5.8. Either way, for high-frequency data prefer aggregating in a map and skip per-event streaming entirely.

**Q: What is the JIT, and what happens without it?**

The JIT compiler translates verified BPF bytecode into native machine instructions for the host architecture, so the program runs at near-native speed rather than being interpreted. Without it (some embedded configs, or `net.core.bpf_jit_enable=0`), the kernel falls back to an interpreter, which is correct but slower. On production servers the JIT is on; it's one reason eBPF tracing overhead is low enough to run on live traffic.

**Q: Explain CO-RE and BTF.**

**BTF** (BPF Type Format) is compact type/debug metadata describing kernel data structures, embedded in the kernel (`/sys/kernel/btf/vmlinux`) and optionally in BPF objects. **CO-RE** (Compile Once – Run Everywhere) uses BTF to make a single compiled BPF object portable: the program records *which* struct fields it accesses, and at load time libbpf relocates those accesses to the actual field offsets in the *running* kernel's BTF. Before CO-RE, tools like BCC shipped clang and compiled against kernel headers on every target machine — heavy and fragile. CO-RE means you compile once on a build box and the same `.o` runs across kernel versions with different struct layouts.

**Q: Why does eBPF beat a kernel module for this kind of work?**

Three reasons: safety (verifier-proven, can't panic the box — a module bug can), portability (CO-RE/BTF gives one binary across kernels — a module is tied to its build kernel's ABI), and operability (load/unload at runtime via a syscall, no `insmod`, no reboot, finer privilege model via `CAP_BPF`). A module is more powerful and unconstrained, which is exactly why it's riskier; for observability the eBPF constraints are a feature.

**Q: What are tail calls, and why do they exist?**

A tail call lets one eBPF program jump to another (via a program-array map), without returning, to chain logic that would otherwise exceed the instruction limit or to build dispatch tables (e.g. per-syscall handlers). It's a workaround for the verifier's size and complexity ceilings and a way to modularize. There's a limit on chain depth (historically 32) to keep termination provable. Newer kernels also offer BPF-to-BPF function calls and `bpf_loop()` which reduce the need for tail-call gymnastics.

---

## bpftrace / BCC Practical

**Q: Write the one-liner that counts syscalls by process name.**

```sh
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
```

`raw_syscalls:sys_enter` fires on every syscall entry; `@[comm] = count()` builds a map keyed by process name, incrementing a counter. On Ctrl-C bpftrace prints the map sorted. To break it down by syscall number instead, key on `args.id`; to see a specific process, add `/pid == 1234/` as a filter.

**Q: Write a latency histogram for a function using the entry/exit join pattern.**

```sh
bpftrace -e '
kprobe:vfs_read { @start[tid] = nsecs; }
kretprobe:vfs_read /@start[tid]/ {
    @ns = hist(nsecs - @start[tid]);
    delete(@start[tid]);
}'
```

At entry, stash the timestamp keyed by thread id (`tid`). At return, the filter `/@start[tid]/` ensures we only measure calls whose entry we saw, compute the delta, feed it to `hist()` (which builds a power-of-two histogram), and delete the start entry to avoid leaking map memory. `hist()` prints an ASCII distribution — exactly what you want to see p99 tails rather than a misleading average.

**Q: Why key the timestamp on `tid` and not `pid`?**

`pid` in bpftrace is the thread-group id (the process), and `tid` is the individual thread (the kernel's "pid"). A multithreaded process has many threads, all sharing one `pid`, each potentially inside `vfs_read` simultaneously — keying on `pid` would have concurrent calls clobber each other's start timestamp. `tid` is unique per running thread, so each in-flight call gets its own entry. The entry/exit join must always key on the thread, `tid`.

**Q: Trace file opens, showing process and filename.**

```sh
bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%-16s %s\n", comm, str(args.filename)); }'
```

Or just use the BCC tool: `opensnoop-bpfcc`. `str()` reads the user-space string pointer into the program. Note `openat` is the modern syscall; tracing `open` alone misses most opens on current systems.

**Q: When do you reach for BCC vs bpftrace vs libbpf?**

**bpftrace** is for ad-hoc, interactive, one-liner-to-short-script tracing — the fastest path from question to answer at a prompt. **BCC** ships a large set of battle-tested, production-grade tools (`execsnoop-bpfcc`, `biolatency-bpfcc`, etc.) and a Python framework for building richer tools; historically it compiled at runtime (heavy), though it's moving to libbpf. **libbpf** (C, with CO-RE) is for shipping a compiled, portable, low-dependency production agent — no LLVM on the target, smallest footprint. Roughly: bpftrace to explore, BCC tools to grab a known answer, libbpf to build a product.

**Q: Name the BCC tools you'd reach for first and what each does.**

`execsnoop-bpfcc` traces new process executions (catches short-lived processes a `ps` snapshot misses). `opensnoop-bpfcc` traces file opens with the failing/succeeding result. `biolatency-bpfcc` prints a histogram of block-device I/O latency. `tcpconnect-bpfcc` traces active TCP connections (who's connecting where). `tcpretrans-bpfcc` traces TCP retransmits — gold for diagnosing flaky network paths. These five answer a huge fraction of "what is this box doing" questions in seconds.

**Q: Give an off-CPU / scheduling example.**

To see why threads are blocked rather than what's burning CPU, you trace scheduler events. A quick run-queue latency check:

```sh
runqlat-bpfcc            # histogram of how long tasks wait to get on-CPU
```

For deeper off-CPU analysis you sample stacks at `sched:sched_switch` keyed by the off-CPU duration, which produces an "off-CPU flame graph" showing where threads sleep/block (lock waits, I/O waits). The mental model: on-CPU profiling tells you where time is *spent*, off-CPU tells you where time is *lost waiting*.

**Q: How do you read a BCC/bpftrace verifier error?**

The loader prints the rejected program's instructions with the verifier's running analysis and an error at the offending line. The signal is the *type* the verifier complains about: `map_value_or_null` means an unchecked map lookup (add the NULL check); `R1 invalid mem access` with a `scalar` or out-of-range offset means you indexed past a bounds-checked region; `back-edge` or `infinite loop detected` means a loop it can't prove terminates; `invalid stack` usually means you exceeded the 512-byte stack. You read bottom-up: find the failing instruction, map it back to your source line, and satisfy the proof the verifier wanted.

**Q: Show a per-second syscall rate counter.**

```sh
bpftrace -e '
tracepoint:raw_syscalls:sys_enter { @c = count(); }
interval:s:1 { print(@c); clear(@c); }'
```

Count into `@c` on every syscall; the `interval:s:1` timer prints and clears it once a second, giving a live syscalls-per-second number without streaming an event per syscall to user space.

**Q: How do you measure I/O latency by disk?**

```sh
biolatency-bpfcc -D
```

`-D` breaks the histogram down per disk. Under the hood it times from block-I/O issue (`block_rq_issue` tracepoint) to completion (`block_rq_complete`) and buckets the deltas — letting you see whether one device is the tail-latency culprit versus a uniform slowdown.

---

## Tricky / Trap Questions

**Q: My kprobe on `foo()` produced zero events. Does that mean the function is idle?**

Not necessarily — and this is the most common rookie trap. Zero events can mean the function genuinely isn't being called, *or* it was inlined and has no probe-able address, *or* it was renamed in this kernel version so you attached to the wrong/nonexistent symbol, *or* the path simply isn't exercised by current traffic. Before concluding "idle," verify the symbol exists (`bpftrace -l 'kprobe:foo*'` or check `/proc/kallsyms`), try a tracepoint or the caller, and confirm the probe actually attached. Absence of evidence from a dynamic probe is not evidence of absence.

**Q: Can I just leave the trace running forever as a poor man's monitor?**

You can, but you usually shouldn't. Dynamic tracing is pay-as-you-go: a high-frequency uprobe or per-event streaming left on indefinitely adds steady overhead and risks dropping events or accumulating unbounded map state. If you find yourself wanting a permanent signal, that's a sign it should be promoted to *static* instrumentation (a metric, an exporter) which is cheaper and purpose-built for continuous collection. Use tracing to discover what's worth monitoring, then bake it in.

**Q: I'll just `printf` on every syscall to see what's happening — fine?**

Bad idea on a busy box. A `printf` per syscall sends an event to user space for *every* syscall — millions per second on a loaded host — which can drop events, spike overhead, and even perturb the very behavior you're measuring (the observer effect). Aggregate in the kernel instead: `count()`, `hist()`, per-CPU maps. Stream individual events only when they're rare (errors, connections) or when you've narrowed with a tight filter.

**Q: I have p99 latency per host; can I average them to get fleet p99?**

No — percentiles don't average. The mean of per-host p99s is a meaningless number; the true fleet p99 depends on the full distribution and the request volume per host. This is why eBPF tools build *histograms* (power-of-two buckets) rather than emitting pre-computed percentiles: histograms are mergeable across hosts, and you compute the global percentile from the merged distribution. If you only kept the p99 scalars, you've thrown away the information needed to aggregate correctly.

**Q: Can I read the function's arguments in a kretprobe?**

No, not directly — by the time the function returns, its argument registers have been overwritten, so a kretprobe sees only `retval`. To correlate args with the result you must save the args at entry (a kprobe), keyed by `tid`, and read them back in the kretprobe. The alternative on modern kernels is `fexit`, which uniquely gives you both arguments and return value in one probe — which is exactly why it's preferred where BTF is available.

**Q: Will the kprobe-based tool I wrote on my laptop work on the customer's kernel?**

Maybe not. A kprobe naming an internal function assumes that function exists with that name and that the struct fields you read sit at the same offsets — both can differ across kernel versions and distro configs. Even CO-RE only relocates struct *offsets*; it can't conjure a function that was renamed or inlined away. Portable production tools are built with libbpf + CO-RE + BTF and include fallbacks, and you still test against the target kernel range. "Works on my kernel" is not "works on their kernel."

**Q: bpftrace says my map is huge / memory keeps growing — what did I do wrong?**

You almost certainly forgot to `delete()` keyed entries in an entry/exit pattern. If you `@start[tid] = nsecs` at entry but never delete it (e.g., the return is missed, or you omitted the delete), the map grows one entry per unmatched thread forever. Always delete the per-`tid` start entry in the return probe, and guard the return with `/@start[tid]/` so you don't compute deltas for entries you never saw. Maps have size limits; unbounded keys will eventually drop or fail.

**Q: The numbers from my trace changed the moment I attached — is the tool broken?**

Possibly you're seeing the observer effect: high-overhead probes (hot uprobes, per-event printf) consume CPU and serialize behavior, shifting timing and even masking the race or contention you're chasing. The fix is to lower the probe's cost — aggregate in-kernel, tighten filters, sample instead of trace-all, prefer fentry/tracepoints over breakpoint-based kprobes/uprobes. If a cheap tracepoint-based version shows the same numbers, trust it; if only the heavy version does, suspect perturbation.

---

## System / Design Scenarios

**Q: Design a fleet-wide, low-overhead dynamic-tracing capability. What does it look like?**

I'd build on libbpf + CO-RE so a single compiled agent runs across the fleet's kernel versions without shipping LLVM or headers everywhere. The agent aggregates *in-kernel* (per-CPU maps, histograms) and exports periodic summaries, never one event per kernel event, to keep steady-state overhead negligible. Tracing programs are pre-vetted and shipped as a curated catalog (the team can't load arbitrary bytecode in prod), gated behind `CAP_BPF`/`CAP_PERFMON` and an audit log. Each program declares a TTL and resource budget so nothing runs forever or unbounded. The output feeds the same backend as the rest of observability — histograms because they merge correctly across hosts — and there's a kill switch to detach everything instantly. Reference the **observability-stack** skill for how the export and storage tiers fit together.

**Q: You're handed a slow production box with no useful dashboards. Walk your approach.**

First, the USE/RED triage with cheap built-ins: is it CPU, memory, disk, or network bound? `top`/`mpstat` for CPU saturation, `vmstat`/`free` for memory pressure, `iostat` for disk, `ss`/`sar` for network. Then I bring in eBPF tools to localize: `execsnoop-bpfcc` for a fork storm or short-lived processes, `biolatency-bpfcc` for disk I/O tail latency, `tcpretrans-bpfcc`/`tcpconnect-bpfcc` for network pathology, `runqlat-bpfcc` for scheduler queueing (CPU oversubscription). If CPU-bound, I sample stacks with a `profile:hz:99` run and build a flame graph to find the hot path. Once I've localized the subsystem, I write a targeted bpftrace latency histogram on the suspect function to confirm. The discipline is breadth-first triage, then a single targeted probe — not random kprobes. The **linux-debugging** and **profiling-techniques** skills cover this triage ladder in depth.

**Q: When do you choose eBPF auto-instrumentation over OpenTelemetry SDK spans?**

Choose eBPF auto-instrumentation when you need *coverage without code changes* — third-party services, legacy apps nobody will re-instrument, polyglot fleets, or a fast "what talks to what" map across the estate. It gives you protocol-level spans (HTTP/gRPC/SQL) at the kernel boundary for free. Choose SDK spans when you need *semantic depth*: business attributes (tenant, user, order id), accurate intra-process boundaries, and reliable distributed-trace context propagation across async hops and message queues — things eBPF can't reconstruct because it doesn't know your code's intent. The mature answer is layered: eBPF for baseline coverage, SDK spans for the services where you need rich, correlated detail.

**Q: Design governance for who can run BPF in production.**

Loading BPF is privileged and can read sensitive data (packet contents, syscall arguments, file paths), so it needs the same rigor as any prod access. I'd scope it with `CAP_BPF`/`CAP_PERFMON` rather than full root, grant it via just-in-time elevation tied to an incident or change ticket, and log every program load with who/what/when (auditd or a dedicated BPF audit hook). For routine use, ship a *vetted catalog* of read-only tracing programs and forbid ad-hoc bytecode in prod; arbitrary one-liners are dev/staging only. Programs carry TTLs and resource budgets, there's a fleet-wide detach kill switch, and anything reading payloads (not just metadata) gets extra review for PII exposure. The principle: dynamic tracing is powerful enough to be treated as a controlled capability, not a free-for-all.

**Q: An intermittent latency spike happens a few times a day and vanishes on restart. How do you catch it?**

Restart-on-fix means the state lives in the running process, so any approach that restarts it destroys the evidence — dynamic instrumentation is ideal precisely because it observes without restarting. I'd attach a low-overhead latency histogram to the suspect path and let it accumulate across the day, plus capture stacks on the slow tail (a filter like `/duration > threshold/` to record a stack only when a request exceeds the budget). Aggregating in-kernel keeps it cheap enough to leave attached for hours. When a spike hits, I have the distribution, the offending stack, and the args saved at entry — enough to root-cause something a deploy-a-log-line loop would never have caught because each restart reset the system.

---

## Behavioral / Experience

**Q: Tell me about a time dynamic tracing solved something static instrumentation couldn't.**

Strong answers describe a real blind spot: a latency tail in a third-party library or the kernel where there was no log line and no metric, and adding one would have meant a deploy and waiting for recurrence. The candidate attached a kprobe/uprobe latency histogram to the live process, saw the distribution, and localized it — say, a `vfs_read` tail caused by a specific device, or a lock held inside a vendored library. The point they should land: the problem was *unanticipated*, so only after-the-fact instrumentation could reach it, and they got the answer in minutes against live traffic instead of a multi-hour deploy loop.

**Q: How do you keep production safe while tracing it live?**

Look for explicit risk awareness: start with the cheapest probe (tracepoint over kprobe, fentry over kprobe), aggregate in-kernel rather than streaming per-event, use tight filters, and prefer sampling for high-frequency events. They should mention the observer effect, set a TTL so nothing runs forever, watch overhead while attached, and have a detach plan ready. A great answer notes they tested the tool against the target kernel first and ran it on one host before fanning out — treating "attach to prod" with the same caution as any prod change.

**Q: How did you convince a skeptical team that eBPF was safe to run in prod?**

The persuasive version centers on the verifier and the safety model: eBPF programs are statically proven safe before they run, can't panic the box the way a kernel module can, and load/unload without reboot. The candidate likely demonstrated it on a non-critical host first, showed measured overhead numbers, started with read-only tracepoint tools (`opensnoop`, `biolatency`) that are clearly benign, and proposed governance (vetted catalog, audit log, TTLs). Winning trust is incremental: small, measurable, reversible steps — not a "trust me, attach to the database" pitch.

**Q: Describe a tracing mistake you made and what you learned.**

Good candidates own a concrete failure: leaving a `printf` on every syscall and dropping events / spiking overhead; forgetting to `delete()` map entries and leaking memory until the tool failed; averaging per-host p99s and reporting a nonsense fleet number; or concluding a function was "idle" when it was actually inlined. The learning should be a durable rule — aggregate in-kernel, always delete keyed entries, percentiles need histograms not means, verify the symbol attached before trusting a zero. The reflection matters more than the specific bug.

**Q: How do you decide when a dynamic probe should become permanent static instrumentation?**

The signal is repetition: if you keep attaching the same trace to answer the same recurring question, you're paying interactive cost for something that wants to be a cheap continuous metric. The candidate should describe promoting that signal — adding a counter/histogram or an exporter — so the steady-state question is answered by pre-paid observability, freeing dynamic tracing for genuinely novel questions. Recognizing this boundary is a sign of someone who understands the pay-as-you-go vs pre-paid trade-off operationally, not just conceptually.

---

## What I'd Ask a Candidate Now

**Q: Why can't you read function arguments in a kretprobe, and how do you get them anyway?**

A strong answer explains that the argument registers are clobbered by the time the function returns, so a kretprobe only has `retval`; you save args at entry keyed by `tid` and read them back at return, or use `fexit` which exposes both at once. Weaker answers just say "you can't" without the entry/exit join or the fexit alternative. The thread-keying detail (`tid`, not `pid`) is a senior tell.

**Q: A kprobe returns zero events. List every reason that isn't "the function is idle."**

I want: inlined (no address), renamed/removed in this kernel, attached to the wrong symbol, path not exercised by current traffic, probe failed to attach, function on the kprobe denylist. The level separator is whether they instinctively *verify the attach* (list the symbol, check it fired) before drawing any conclusion, rather than trusting silence.

**Q: Walk me from `bpf()` syscall to data in user space.**

Strong: load → verifier → JIT → attach → event fires → helpers + maps → user space drains a map/ring buffer. They should name the verifier's role (static safety proof) and the JIT's (native speed), and know that aggregating in maps beats streaming per-event. Vague "it runs in the kernel" without the verifier/JIT/maps pipeline is junior.

**Q: Explain a real verifier rejection and how you fix it.**

I'm listening for the unchecked-map-lookup case: `invalid mem access 'map_value_or_null'`, fixed by a NULL check that collapses the type. Bonus for naming others (instruction/complexity limit, unbounded loop, 512-byte stack). The depth signal is understanding *why* the verifier requires it — kernel context, no cheap runtime fault handling — not just memorizing the incantation.

**Q: Why prefer a tracepoint over a kprobe, and what's the cost of getting it wrong?**

Strong: tracepoints are a stability contract (stable name + arg layout across versions); kprobes attach to internals that get renamed/inlined, so a kprobe tool can silently break or attach to nothing after an upgrade. The cost of getting it wrong is a tool that *appears* to work but reports zeros. Mention fentry/fexit as the modern low-overhead path and you're clearly senior.

**Q: You need fleet p99 latency from per-host eBPF data. How?**

The right answer: collect *histograms* per host (power-of-two buckets), merge them, then compute the percentile from the merged distribution — because percentiles don't average. If they say "average the p99s" they've failed the question. This tests whether they understand why eBPF tools emit histograms in the first place.

**Q: When is eBPF the wrong tool?**

Honest seniors say: when you need application semantics (tenant, business transaction, trace context) that the kernel can't see — use SDK spans; on non-Linux platforms; on kernels without BTF for CO-RE tooling; for continuous signals better served by a cheap static metric; and where the privilege/governance cost outweighs the benefit. Someone who treats eBPF as a hammer for everything is a yellow flag.

**Q: How would you keep a trace from hurting a production box?**

I want concrete tactics: cheapest probe type, in-kernel aggregation over per-event streaming, tight filters, sampling for hot events, a TTL, overhead monitoring, single-host canary before fan-out, and a detach kill switch. Awareness of the observer effect — that a heavy probe can change the behavior being measured — separates people who've actually done this in prod from people who've read about it.

---

## Cheat Sheet

```sh
# Count syscalls by process
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'

# Latency histogram with entry/exit tid-join
bpftrace -e 'kprobe:vfs_read { @s[tid]=nsecs; }
  kretprobe:vfs_read /@s[tid]/ { @ns=hist(nsecs-@s[tid]); delete(@s[tid]); }'

# Trace file opens (or: opensnoop-bpfcc)
bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm, str(args.filename)); }'

# Per-second rate
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @c=count(); }
  interval:s:1 { print(@c); clear(@c); }'

# Sampling profiler for flame graphs
bpftrace -e 'profile:hz:99 { @[kstack] = count(); }'

# List available probes
bpftrace -l 'tracepoint:syscalls:*'
bpftrace -l 'kprobe:vfs_*'

# Ready-made BCC tools
execsnoop-bpfcc      # new process executions
opensnoop-bpfcc      # file opens + result
biolatency-bpfcc -D  # block I/O latency histogram, per disk
runqlat-bpfcc        # scheduler run-queue latency
tcpconnect-bpfcc     # active TCP connections
tcpretrans-bpfcc     # TCP retransmits

# Inspect kernel BTF / symbols
ls /sys/kernel/btf/vmlinux
grep ' foo$' /proc/kallsyms
```

| Need | Probe / tool | Stability | Notes |
|------|-------------|-----------|-------|
| Kernel function entry args | `kprobe` / `fentry` | low / med | fentry needs BTF, lower overhead |
| Kernel function return value | `kretprobe` / `fexit` | low / med | fexit gives args + retval together |
| Stable kernel event | `tracepoint` | high | prefer when one exists |
| User function entry/return | `uprobe` / `uretprobe` | low | overhead on hot paths; watch inlining |
| App author's markers | `USDT` | high | ~free when not enabled |
| CPU profiling | `profile:hz:N` | n/a | per-CPU sampling, flame graphs |
| Periodic emit | `interval:s:N` | n/a | one CPU, timer for aggregates |
| Aggregate cheaply | maps (`count`, `hist`, per-CPU) | n/a | always prefer over per-event printf |

Mantras: **tracepoint > kprobe; fentry/fexit > kprobe/kretprobe; aggregate in-kernel; key the join on `tid`; histograms merge, percentiles don't; always `delete()`; zero events ≠ idle.**

---

## Further Reading

- Brendan Gregg, *BPF Performance Tools* — the definitive catalog of eBPF tracing tools and the methodology behind them.
- Brendan Gregg, *Systems Performance* (2nd ed.) — the USE method and the performance-triage ladder that tells you *which* probe to reach for.
- Liz Rice, *Learning eBPF* — accessible, hands-on introduction to writing eBPF programs, the verifier, maps, and CO-RE.
- The **bpftrace** repository — the reference guide and a large library of example one-liners and scripts.
- The **BCC** repository — source and man pages for `execsnoop`, `biolatency`, `tcpretrans`, and dozens more production tools.
- For triage workflow and tooling context, see the **linux-debugging** skill (server-side diagnosis), the **observability-stack** skill (how dynamic tracing fits with logs/metrics/traces and storage), and the **profiling-techniques** skill (CPU/off-CPU profiling and flame graphs).

---

## Related Topics

- [Continuous Profiling](../continuous-profiling/) — fleet-wide always-on sampling, often eBPF-based
- [Tracing](../tracing/) — distributed spans and trace context that eBPF complements
- [Metrics](../metrics/) — the pre-paid signals dynamic tracing fills the gaps around
- [Logging](../logging/) — static, intentional signals vs after-the-fact probes
- [Debugging](../debugging/) — root-cause workflows that dynamic instrumentation feeds
- [Observability Engineering](../observability-engineering/) — the discipline that decides pre-paid vs pay-as-you-go coverage
