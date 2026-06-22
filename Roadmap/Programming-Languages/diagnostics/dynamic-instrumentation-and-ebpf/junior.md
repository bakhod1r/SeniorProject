# Dynamic Instrumentation & eBPF — Junior Level

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
> **Focus:** What "attach a probe to a running program" actually means, and why it's different from logging. The four probe families — kprobe, uprobe, tracepoint, USDT. Your first real bpftrace one-liners and BCC tools, run against a live system. When dynamic tracing is the right tool and when it absolutely is not.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Dynamic vs Static Instrumentation](#dynamic-vs-static-instrumentation)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [The Four Probe Families](#the-four-probe-families)
9. [Your First Probes — Code Examples](#your-first-probes--code-examples)
10. [What a Probe Costs](#what-a-probe-costs)
11. [Use Cases](#use-cases)
12. [Coding Patterns](#coding-patterns)
13. [Clean Usage](#clean-usage)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Tricky Points](#tricky-points)
18. [Test Yourself](#test-yourself)
19. [Tricky Questions](#tricky-questions)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [What You Can Build](#what-you-can-build)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)
25. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does "instrument a running program without changing it" mean?** and **What does a beginner run on day one to see inside a live system?**

Here is the idea that the whole topic turns on. With logs, metrics, and traces, **you decided what to observe when you wrote the code.** You added a `log.Info("user logged in")`, a request counter, a trace span. If, at 3 a.m., you need a number nobody thought to record — say, *how long the kernel spends reading from disk for this one process* — you are stuck. You'd have to edit the source, recompile, redeploy, and hope the problem recurs.

**Dynamic instrumentation removes that wait.** You attach a *probe* to a function — in your program or in the Linux kernel itself — *while it is running*, with no source change, no recompile, no restart. The probe fires every time that function is called, runs a tiny piece of your code, records what you asked for, and gets out of the way. When you're done, you detach it and the program is exactly as it was. You did not modify the binary on disk; you taught the *live* process a new trick for ninety seconds.

The engine that makes this safe in production is **eBPF** — a small, sandboxed virtual machine inside the Linux kernel. Before you run your probe, the kernel's **verifier** proves your code can't loop forever, can't read random memory, and can't crash the machine. That guarantee is why on-call engineers run eBPF tools on production boxes that they would never dream of touching with a hand-written kernel module.

At the junior level you don't write eBPF bytecode by hand. You use **bpftrace** (a one-liner language that feels like awk for the kernel) and **BCC tools** (ready-made tools like `execsnoop` and `opensnoop`). You'll be reading live answers off a real system within minutes.

> 🎓 **Why this matters for a junior:** The senior engineer who can say "give me the box, I'll trace it" during an incident looks like a wizard. They're not — they just know three or four bpftrace one-liners and which tool answers which question. Learning those is the single highest-leverage observability skill you can pick up early.

---

## Prerequisites

What you should know before reading this:

- **Required:** Comfort on a **Linux** command line — `sudo`, pipes, reading process names and PIDs. eBPF is Linux-first; everything here assumes Linux.
- **Required:** A rough idea of what a **system call** is (`open`, `read`, `write`, `connect`) — the boundary where your program asks the kernel to do something.
- **Required:** What a *function call* and a *return value* are. Probes fire on those.
- **Helpful:** Having used logs and metrics, so you can feel what's *missing* — see [`../logging/junior.md`](../logging/junior.md) and [`../metrics/junior.md`](../metrics/junior.md). Dynamic tracing is what you reach for when those two can't answer the question.
- **Helpful:** Knowing your kernel version (`uname -r`). Most tools want 4.9+; the modern portable ones want ~5.2+ with BTF. See the **linux-debugging** skill for the surrounding toolbox.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dynamic instrumentation** | Attaching observation code to a *running, unmodified* program or kernel — no recompile, no restart. The subject of this roadmap. |
| **Probe** | A hook attached to a specific event (a function entry, a syscall, a return). When the event fires, your probe code runs. |
| **eBPF** | *extended Berkeley Packet Filter* — a safe, verified, sandboxed VM in the Linux kernel that runs your tiny programs in response to events. |
| **kprobe / kretprobe** | A probe on a **kernel** function's *entry* / *return*. Can attach to almost any kernel function by name. |
| **uprobe / uretprobe** | A probe on a **user-space** function's *entry* / *return*, inside a normal binary or library. |
| **Tracepoint** | A *stable*, kernel-maintained hook (e.g. `syscalls:sys_enter_openat`). Preferred over kprobes because it won't break across kernel versions. |
| **USDT** | *User Statically-Defined Tracing* — dtrace-style probes the application author baked into the program (JVM, Python, Node, Postgres). |
| **bpftrace** | A high-level one-liner language for eBPF. Think "awk for the kernel." Your day-one tool. |
| **BCC** | *BPF Compiler Collection* — a toolkit and a library of ready-made tools (`execsnoop`, `opensnoop`, `biolatency`). |
| **The verifier** | The kernel component that *proves* your eBPF program is safe before it runs — no infinite loops, no wild memory access. |
| **Map** | A kernel data structure (hash, array) eBPF uses to keep state and to share data with user-space. In bpftrace these are the `@name` variables. |
| **`comm`** | The short command name of a process (e.g. `nginx`, `python3`). A field probes can read. |
| **PID / TID** | Process ID / Thread ID. |
| **Overhead** | The performance cost of having a probe attached. Usually tiny, but not zero — see [What a Probe Costs](#what-a-probe-costs). |
| **DTrace** | The original dynamic-tracing framework (Solaris, then BSD/macOS). eBPF's intellectual ancestor. |

---

## Core Concepts

### 1. You attach the question *after* the program is already running

This is the whole shift. A log line exists because someone wrote it months ago. A probe exists because *you* attached it thirty seconds ago to a process you didn't write and can't restart. The program has no idea it's being watched.

### 2. A probe is "an event + code that runs when the event fires"

Every bpftrace line has two parts: a **probe specification** (which event — `tracepoint:syscalls:sys_enter_openat`) and an **action** in `{ }` (what to do when it fires — `@[comm] = count()`). That's the entire mental model. The kernel runs your action each time the event happens.

### 3. eBPF runs your code *inside* the kernel, safely

Your action doesn't run in your shell — it's compiled to eBPF bytecode, verified, and run in the kernel at the moment the event fires. That's why it's fast (no copying every event out to user-space) and why it needs the verifier (kernel code that misbehaves takes the whole machine down).

### 4. Prefer the stable hook over the clever one

You can kprobe almost any kernel function, but kernel functions get renamed between versions. **Tracepoints** and **USDT** probes are *contracts* the maintainers promise to keep. When a tracepoint exists for what you want, use it — your one-liner will still work after the next kernel upgrade.

### 5. This is a complement to logs/metrics/traces, not a replacement

Dynamic tracing is for **ad-hoc, unforeseen questions** during investigation. You would never replace your request counter with a uprobe — the probe is expensive to keep running forever and disappears on reboot. Static instrumentation is your always-on dashboard; dynamic instrumentation is the flashlight you grab when the dashboard isn't enough.

---

## Dynamic vs Static Instrumentation

| | **Dynamic (probes / eBPF)** | **Static (logs / metrics / traces)** |
|---|---|---|
| **Decided when?** | At investigation time, on a live system | Ahead of time, in source code |
| **Needs redeploy?** | No | Yes, to add anything new |
| **Answers unforeseen questions?** | Yes — its entire purpose | No — only what you pre-instrumented |
| **Lifetime** | Seconds to minutes, then detach | Always on, shipped with the build |
| **Sees kernel internals?** | Yes (kprobes, tracepoints) | Almost never |
| **Survives a reboot?** | No | Yes |
| **Cost model** | Per-event overhead while attached | Paid continuously, by design |

The one-line rule: **static tells you what you knew to ask; dynamic lets you ask something new of a system you can't touch.**

---

## Real-World Analogies

- **The stethoscope.** A doctor doesn't redesign you to add a heart-rate display. They press a tool against a *living* patient, listen, and remove it. bpftrace is the stethoscope for a running process.
- **The wiretap.** You don't ask the two people on the call to start narrating their conversation into a logbook (that's logging). You quietly tap the line, listen to *this* call, and unplug. The conversation is unaltered.
- **A toll-booth counter clicker.** A kprobe on a kernel function is a person standing at a doorway clicking a counter every time someone walks through — without rebuilding the door.
- **The smoke detector vs the fire investigator.** Metrics are smoke detectors: always on, cheap, tell you *something is wrong*. Dynamic tracing is the investigator who shows up *after* the alarm and pokes at the actual wiring to find out *why*.

---

## Mental Models

- **"Probe = event + action."** Internalize this and bpftrace stops looking like magic. Left of the `{` is *when*; inside the `{}` is *what to do*.
- **"The map is the answer sheet."** Everything `@named` in bpftrace is a map living in the kernel. Your action writes to it; bpftrace prints it when you Ctrl-C.
- **"The verifier is your seatbelt, not your enemy."** When it rejects your program, it found a way your code *could* have hurt the kernel. It's annoying at first and a gift in production.
- **"Flashlight, not floodlight."** Attach for the investigation, detach when done. If you find yourself wanting a probe running forever, you actually wanted a metric — go add one.

---

## The Four Probe Families

These are the four kinds of hook you'll attach to. Knowing *which* to reach for is most of the skill.

### kprobe / kretprobe — kernel functions

Attach to (almost) **any function in the kernel**, by name, at *entry* (`kprobe`) or *return* (`kretprobe`). Enormously powerful — you can watch internal kernel functions no one designed to be observable. The catch: those function names are *not* a stable API. `vfs_read` might be renamed or inlined away in a future kernel, and your probe silently stops matching.

```
kprobe:vfs_read      // fires when the kernel enters vfs_read()
kretprobe:vfs_read   // fires when vfs_read() returns (you get retval)
```

### uprobe / uretprobe — user-space functions

The same idea, but for functions in a **normal user-space binary or shared library** — your own program, `libc`, `libssl`. You point at the file on disk and the function name (or symbol address).

```
uprobe:/bin/bash:readline          // someone in any bash typed a line
uretprobe:/lib/libc.so.6:malloc    // a malloc() call returned
```

### tracepoint — stable kernel hooks

Hooks the **kernel maintainers placed and promised to keep**. They have stable names and a documented set of fields. Categories include `syscalls:`, `sched:` (scheduler), `block:` (block I/O), `net:`. **Prefer these over kprobes whenever one exists** — they survive kernel upgrades.

```
tracepoint:syscalls:sys_enter_openat   // any process called openat()
tracepoint:sched:sched_switch          // the CPU switched to another task
```

### USDT — probes baked into the app

*User Statically-Defined Tracing* probes are placed by the **application author** as dtrace-style markers. The JVM, CPython, Node.js, Postgres, and MySQL ship them. They're stable, semantically meaningful ("a GC pause started"), and zero-cost when not attached.

```
usdt:/usr/lib/jvm/.../libjvm.so:hotspot:gc__begin   // JVM GC started
usdt:/usr/bin/python3:python:function__entry        // a Python function was entered
```

> **The cheat-sheet rule:** kernel function → tracepoint if it exists, else kprobe. App function → USDT if it exists, else uprobe.

---

## Your First Probes — Code Examples

All of these need root (`sudo`) and a Linux box with bpftrace and bcc-tools installed (`apt install bpftrace bpfcc-tools` on Debian/Ubuntu).

### 1. The "hello world" of eBPF

```bash
sudo bpftrace -e 'BEGIN { printf("tracing started, hit Ctrl-C to stop\n"); }'
```

`BEGIN` is a special probe that fires once when the program starts. Nothing kernel-y yet — but you've run an eBPF program.

### 2. Count syscalls by process — the classic one-liner

```bash
sudo bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
```

Every time *any* process makes *any* syscall, increment the map `@` keyed by the process name. Hit Ctrl-C and bpftrace prints a sorted table: which programs are the syscall-heavy ones, right now, on this box.

### 3. Who is opening which files?

```bash
sudo bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s -> %s\n", comm, str(args->filename)); }'
```

`args->filename` is a field of the tracepoint. `str()` reads the string from user-space memory. You now have a live feed of every file open on the system, with the process that did it.

### 4. The same answer, but with a ready-made BCC tool

You don't always need to write the one-liner — BCC ships polished tools:

```bash
sudo execsnoop-bpfcc      # every new process that gets exec()'d, live
sudo opensnoop-bpfcc      # every file open, with the result code
sudo tcpconnect-bpfcc     # every outbound TCP connection
sudo biolatency-bpfcc     # disk I/O latency as a histogram
```

Run `execsnoop-bpfcc` and then open a new terminal — you'll see your shell and every command it spawns appear instantly. This is often the fastest way to answer "what is this machine actually *doing*?"

### 5. A latency histogram — the thing that makes people gasp

```bash
sudo bpftrace -e '
kprobe:vfs_read { @start[tid] = nsecs; }
kretprobe:vfs_read /@start[tid]/ {
    @ns = hist(nsecs - @start[tid]);
    delete(@start[tid]);
}'
```

On *entry*, stash the start time in a map keyed by thread ID. On *return*, if we have a start time (`/@start[tid]/` is a filter), record the elapsed nanoseconds into a **power-of-two histogram**. Ctrl-C and bpftrace draws an ASCII histogram of read latencies — instantly visible long tail and all. This pattern — *timestamp on entry, measure on return* — is the single most useful thing in this whole page.

### 6. Trace a function in your *own* program (uprobe)

Suppose you compiled `./myapp` in Go or C with a function `handleRequest`:

```bash
sudo bpftrace -e 'uprobe:./myapp:handleRequest { @calls = count(); }'
```

No recompile, no print statements added — you're counting calls to *your* function in a *running* binary you point at on disk.

---

## What a Probe Costs

Probes are cheap, but **not free**, and the cost depends on how often the event fires.

- **A kprobe firing once per request:** negligible — nanoseconds per hit.
- **A tracepoint on `raw_syscalls:sys_enter`:** fires *constantly* (every syscall, every process). Counting is fine; doing expensive work in that action can measurably slow the box.
- **Printing per-event** (`printf`) is far more expensive than **aggregating** (`count()`, `hist()`). Per-event streaming copies data to user-space; aggregation stays in a kernel map and is summarized once at the end.

> **Rule of thumb for juniors:** prefer `count()` / `hist()` over `printf` on high-frequency probes. Aggregate in the kernel, print the summary. And never leave a heavy probe attached after you've got your answer.

---

## Use Cases

- **"Why is this box slow and the dashboards look fine?"** Count syscalls by `comm`; find the noisy process the metrics missed.
- **"Which files / configs is this service actually reading?"** `opensnoop-bpfcc`.
- **"What is spawning all these processes?"** `execsnoop-bpfcc` — catches short-lived processes a `ps` will never see.
- **"Is something making surprise network connections?"** `tcpconnect-bpfcc`.
- **"Is the disk the bottleneck?"** `biolatency-bpfcc` — latency distribution, not just an average.
- **"My function is being called more than I think."** A uprobe `count()` on it.

---

## Coding Patterns

- **Timestamp-on-entry, measure-on-return.** Store `nsecs` in `@start[tid]` on a `kprobe`, subtract on the `kretprobe`. The basis of every latency histogram.
- **Key maps by `tid`, not `pid`,** when matching entry to return — two threads of the same process can be inside the function at once.
- **Filter with `/predicate/`** between the probe and the `{}` to scope to one PID or one condition: `tracepoint:syscalls:sys_enter_openat /pid == 1234/ { ... }`.
- **Aggregate, then print.** `@[key] = count()` or `= hist(x)`, let bpftrace print on exit.

---

## Clean Usage

- **Scope to a target.** Add `/pid == $1/` or `-p <pid>` so you trace the one process you care about, not the whole machine.
- **Name your maps for what they hold.** `@read_latency_ns` reads better in the output than `@`.
- **Always `delete()` per-thread scratch maps** after you use them, so they don't grow unbounded.
- **Detach when done.** Ctrl-C. A forgotten high-frequency probe is a tiny, permanent tax on the box.

---

## Best Practices

- **Reach for an existing BCC tool first.** `execsnoop`, `opensnoop`, `biolatency` already do the right thing safely. Write a one-liner only when no tool fits.
- **Prefer tracepoints/USDT over kprobes/uprobes** — they're stable across versions.
- **Aggregate in-kernel; stream to user-space only when you must.**
- **Check your kernel version first** (`uname -r`); some tools need newer kernels or BTF.
- **Get the right privilege** — historically root; modern kernels allow the finer-grained `CAP_BPF`. Don't run as root if `CAP_BPF` will do.

---

## Edge Cases & Pitfalls

- **kprobe silently matches nothing** because the function was inlined or renamed in your kernel. No error, no data — check with `bpftrace -l 'kprobe:vfs_*'`.
- **`str()` on a NULL or unmapped pointer** can read garbage or fail — guard with a predicate where possible.
- **Per-thread scratch you never delete** leaks map entries on long runs.
- **Tracing a syscall on a busy box without a filter** floods you and adds real overhead. Scope it.
- **Symbols stripped from a binary** mean a uprobe by name can't resolve — you may need the address or a debug-symbol package.

---

## Common Mistakes

- **Using `printf` on `raw_syscalls:sys_enter`** and wondering why the terminal melts and the box slows. Aggregate instead.
- **Keying entry/return maps by `pid`** and getting nonsense when threads overlap. Use `tid`.
- **Expecting it to work on macOS/Windows out of the box.** This is Linux. (DTrace is the macOS cousin, different syntax.)
- **Treating a probe like a permanent metric.** It vanishes on reboot and costs overhead — that's not what it's for.
- **Forgetting `sudo`.** Most probes need elevated privilege; without it you get a permissions error, not data.

---

## Tricky Points

- **A `kretprobe` only fires if the function actually returns.** If it never returns (e.g. the task is killed mid-call), your `@start[tid]` lingers — hence the `delete()`.
- **`comm` is only 16 characters.** Long process names get truncated; don't be surprised by `some-very-long-` in the output.
- **Tracepoint fields differ per tracepoint.** `args->filename` exists on `sys_enter_openat`; another tracepoint has different `args`. List them with `bpftrace -lv 'tracepoint:syscalls:sys_enter_openat'`.
- **Two probes can race.** Counting `sys_enter` without the matching `sys_exit` can overcount if you only care about completed calls.

---

## Test Yourself

1. In one sentence, what can dynamic instrumentation do that adding a log line cannot?
2. What are the two parts of every bpftrace probe?
3. When would you choose a tracepoint over a kprobe?
4. Why key an entry/return map by `tid` instead of `pid`?
5. Which is cheaper on a high-frequency probe: `printf` per event, or `count()`?
6. What does the eBPF verifier protect against, in plain words?
7. Name the BCC tool that shows every new process being exec'd.

---

## Tricky Questions

<details>
<summary>If I attach a kprobe to <code>vfs_read</code> and see no output, the function isn't being called — true or false?</summary>

**False.** The far more common cause is that `vfs_read` was *inlined* or *renamed* in your kernel, so the kprobe matched nothing. Confirm the symbol exists with `bpftrace -l 'kprobe:vfs_read'` before concluding the function is idle.
</details>

<details>
<summary>I want this trace to keep running forever so I always have the data. Good idea?</summary>

**No — you've described a metric.** Dynamic probes cost per-event overhead, disappear on reboot, and aren't built for permanent collection. If you need it always-on, add a [metric](../metrics/) to the source instead. Probes are for the *investigation*, not the *monitoring*.
</details>

<details>
<summary>Why doesn't <code>printf</code> on every syscall scale, when <code>count()</code> does?</summary>

`printf` copies a record out to user-space for *every* event — on a busy box that's millions per second, and the copy plus your terminal can't keep up, so the box slows and events get dropped. `count()` increments a number in a kernel map and is summarized *once* when you stop. Aggregate in-kernel; stream only when you truly need each event.
</details>

---

## Cheat Sheet

```bash
# List available probes
sudo bpftrace -l 'tracepoint:syscalls:*'
sudo bpftrace -l 'kprobe:vfs_*'
sudo bpftrace -lv 'tracepoint:syscalls:sys_enter_openat'   # show its fields

# Count syscalls by process
sudo bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'

# Who opens which files
sudo bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm, str(args->filename)); }'

# Latency histogram (entry/return pattern)
sudo bpftrace -e 'kprobe:vfs_read { @s[tid]=nsecs; }
                  kretprobe:vfs_read /@s[tid]/ { @ns=hist(nsecs-@s[tid]); delete(@s[tid]); }'

# Scope to one process
sudo bpftrace -e 'tracepoint:syscalls:sys_enter_openat /pid == 1234/ { printf("%s\n", str(args->filename)); }'

# Ready-made BCC tools
sudo execsnoop-bpfcc      # new processes
sudo opensnoop-bpfcc      # file opens
sudo tcpconnect-bpfcc     # outbound TCP
sudo biolatency-bpfcc     # disk I/O latency histogram
```

| Probe | Hooks | Stable? | Reach for when |
|---|---|---|---|
| **tracepoint** | kernel-defined event | ✅ yes | a stable kernel hook exists |
| **kprobe/kretprobe** | any kernel function | ⚠️ no | no tracepoint exists |
| **USDT** | app-defined marker | ✅ yes | the app (JVM/Python/PG) provides one |
| **uprobe/uretprobe** | any user-space function | ⚠️ no | tracing app code with no USDT |

---

## Summary

Dynamic instrumentation lets you attach observation code to a **running, unmodified** program or kernel — answering questions you never pre-instrumented, with no redeploy. **eBPF** makes it production-safe by running your tiny programs in a kernel-**verified** sandbox. You attach **probes** to four kinds of hook: **tracepoints** and **kprobes** (kernel), **USDT** and **uprobes** (user-space) — preferring the *stable* one when it exists. With **bpftrace** one-liners and **BCC tools** you can count syscalls, watch file opens, see new processes, and draw live latency histograms in seconds. The discipline is to **aggregate in the kernel, scope to a target, attach for the investigation, and detach when done** — because a probe is a flashlight, not a floodlight, and it is no substitute for the always-on logs and metrics you ship in your code.

---

## What You Can Build

- A one-page "incident toolkit" of bpftrace one-liners you can paste during a page.
- A small script that runs `execsnoop`/`opensnoop` and saves a 60-second snapshot of what a box is doing.
- A uprobe one-liner that counts calls to a hot function in your own service, with no code change.
- A read-latency histogram you can run before and after a change to *prove* the change helped.

---

## Further Reading

- *BPF Performance Tools* — Brendan Gregg, chapters 1–4 (the gentle on-ramp).
- The **bpftrace** one-liner tutorial and reference guide (in the bpftrace repo).
- *Learning eBPF* — Liz Rice, the first chapters on probes and bpftrace.
- The **linux-debugging** and **profiling-techniques** skills for the broader toolbox around these probes.

---

## Related Topics

- [Metrics](../metrics/) — the always-on numbers you ship in code; probes complement, not replace, these.
- [Logging](../logging/) — the other thing dynamic tracing is *not*.
- [Tracing](../tracing/) — in-app request spans; uprobes/USDT can fill gaps where spans are missing.
- [Continuous Profiling](../continuous-profiling/) — eBPF-powered always-on profiling, the always-on cousin of these ad-hoc probes.
- [Observability Engineering](../observability-engineering/) — where dynamic tracing fits in the bigger picture.
- [Debugging](../debugging/) — the discipline this is a power tool *for*.

---

## Diagrams & Visual Aids

**Probe = event + action:**

```
  EVENT FIRES                 YOUR ACTION (runs in-kernel, verified)
  ┌─────────────────────┐     ┌──────────────────────────────┐
  │ tracepoint:syscalls │ ──▶ │ @[comm] = count();           │
  │  :sys_enter_openat  │     │ (writes to a kernel map)     │
  └─────────────────────┘     └──────────────────────────────┘
                                          │  Ctrl-C
                                          ▼
                                  bpftrace prints the map
```

**Where the four families attach:**

```
  USER SPACE      ┌──────────────┐   uprobe / uretprobe ── any function
                  │ your binary  │   USDT ───────────────  author's markers
                  └──────┬───────┘
  ─ syscall boundary ────┼───────────────────────────────────────────
  KERNEL                 ▼
                  ┌──────────────┐   tracepoint ─────────  stable hooks
                  │   kernel     │   kprobe / kretprobe ── any function
                  └──────────────┘
```

**Static vs dynamic, on a timeline:**

```
  WRITE CODE ──▶ SHIP ──▶ RUNNING ──▶ 3 A.M. QUESTION
     │                                      │
  add logs/metrics here              attach a probe HERE
  (static, pre-paid)                 (dynamic, pay-as-you-go)
```
