# Dynamic Instrumentation & eBPF — Senior Level

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
> **Focus:** Master the eBPF programming model end to end — program types and attach points, maps as the data plane, CO-RE/BTF portability, the verifier as a hard safety net, and the judgment to drop a production-safe bpftrace one-liner into a live incident when the failure is an unknown-unknown you never pre-instrumented.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The eBPF Programming Model](#the-ebpf-programming-model)
6. [fentry/fexit vs kprobe/kretprobe](#fentryfexit-vs-kprobekretprobe)
7. [CO-RE and BTF — Compile Once, Run Everywhere](#co-re-and-btf--compile-once-run-everywhere)
8. [The Verifier as Your Safety Net](#the-verifier-as-your-safety-net)
9. [Ring Buffers vs Perf Buffers](#ring-buffers-vs-perf-buffers)
10. [A Minimal libbpf CO-RE Tool](#a-minimal-libbpf-co-re-tool)
11. [Production-Safe Dynamic Tracing](#production-safe-dynamic-tracing)
12. [When to Reach for bpftrace in an Incident](#when-to-reach-for-bpftrace-in-an-incident)
13. [Code Examples](#code-examples)
14. [Worked Example — Catching an Unforeseen Bug Live](#worked-example--catching-an-unforeseen-bug-live)
15. [Pros & Cons](#pros--cons)
16. [Use Cases](#use-cases)
17. [Coding Patterns](#coding-patterns)
18. [Clean Usage](#clean-usage)
19. [Best Practices](#best-practices)
20. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Tricky Points](#tricky-points)
23. [Test Yourself](#test-yourself)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **the eBPF programming model in depth — how a kernel-verified bytecode program attaches to a hook, talks to user space through maps and ring buffers, stays portable across kernels via CO-RE/BTF, and why this is the only safe way to ask a running production kernel a question you didn't anticipate.**

eBPF turns the Linux kernel into a programmable observability surface. You write a small, restricted C program, compile it to BPF bytecode, and the kernel's verifier statically proves it cannot crash, loop forever, leak memory, or read arbitrary addresses. Only then does the JIT compile it to native instructions and attach it to a hook — a syscall tracepoint, a function entry, a network event, a perf counter overflow. The program runs in kernel context at the hook, with near-zero overhead, and ships results to user space through shared maps. No source change, no recompile, no restart of the target.

At the senior level the interesting work is not running a one-liner — it is reasoning about the *model*. Which program type can attach where? What can a verifier-bounded program actually compute? How do you read a kernel struct field whose offset differs between 5.10 and 6.6 without shipping a binary per kernel? How much overhead does a tracepoint on `sys_enter_read` add at 200k syscalls/sec, and how do you scope it so you never find out the hard way? These are the questions that separate "I copied a bpftrace line from a blog" from "I attached a probe to a customer's kernel during a SEV-2 and read the answer off a histogram in ninety seconds."

bpftrace and BCC are the fast path; libbpf with CO-RE is the durable path for shipping tools. Both ride the same machinery. Understanding the machinery is what lets you trust the tool you point at a production box.

> 🎓 **Why this matters for a senior:** Metrics and traces answer the questions you knew to ask at instrumentation time. eBPF answers the questions you didn't. When a latency spike has no corresponding span, no log line, and no metric, dynamic instrumentation is the difference between "we attached a probe and saw the off-CPU stall in TCP retransmit" and "we restarted it and hoped." Knowing the verifier guarantees safety is what makes you willing to run it in prod at all.

## Prerequisites

- Comfort with the [junior level](junior.md) (what tracing is, perf/strace basics) and the [middle level](middle.md) (probes, tracepoints, perf events, basic bpftrace).
- Reading C and basic kernel data structures (`task_struct`, `sk_buff`, `file`).
- Linux 4.9+ for basic eBPF; **5.2+** for bounded loops and large programs; **5.8+** for ring buffers and `CAP_BPF`/`CAP_PERFMON`; **5.5+** for `fentry`/`fexit` (BTF trampolines). Kernel with `CONFIG_DEBUG_INFO_BTF=y` for CO-RE.
- Familiarity with the **linux-debugging** and **profiling-techniques** skills for the surrounding diagnostic workflow.

## Glossary

| Term | Meaning |
|------|---------|
| Program type | `BPF_PROG_TYPE_*` — defines context, allowed helpers, and valid attach points (e.g. `KPROBE`, `TRACING`, `PERF_EVENT`, `XDP`). |
| Attach point | The kernel hook a program binds to: kprobe, tracepoint, fentry, perf event, raw_tp, USDT. |
| CO-RE | Compile Once – Run Everywhere; relocations resolved at load time against the target kernel's BTF. |
| BTF | BPF Type Format — compact type/debug info; ships in-kernel (`/sys/kernel/btf/vmlinux`) and in BPF objects. |
| libbpf | The canonical C loader library; resolves CO-RE relocations, loads maps/programs, generates skeletons. |
| Ring buffer | `BPF_MAP_TYPE_RINGBUF` (5.8+) — single MPSC variable-length buffer, ordered, lower overhead than perf buffer. |
| Perf buffer | `BPF_MAP_TYPE_PERF_EVENT_ARRAY` — per-CPU ring of perf events; older, per-CPU ordering only. |
| Tail call | Jump from one BPF program to another via a prog array, without returning; works around the 1M instruction limit. |
| `BPF_PROG_TYPE_*` | Enum selecting program semantics; chosen implicitly by the `SEC()` annotation in libbpf. |
| kfunc | Kernel function exported for direct call from BPF programs (typed, BTF-described). |
| fentry/fexit | BTF-based entry/exit trampoline probes; type-safe, faster than kprobe/kretprobe. |
| BPF skeleton | `xxx.skel.h` generated by `bpftool gen skeleton`; embeds the object and gives typed open/load/attach functions. |
| vmlinux.h | A single header with all kernel types, dumped from BTF; replaces shipping kernel-version headers. |
| `CAP_BPF`/`CAP_PERFMON` | Capabilities (5.8+) granting BPF load and perf/tracing access without full `root`. |
| JIT | Just-In-Time compiler turning verified BPF bytecode into native machine code. |
| map-in-map | `ARRAY_OF_MAPS`/`HASH_OF_MAPS` — a map whose values are other maps; enables dynamic per-entity tables. |
| LRU map | `BPF_MAP_TYPE_LRU_HASH` — bounded hash that evicts least-recently-used entries instead of failing on full. |
| Stack ID | A handle into `BPF_MAP_TYPE_STACK_TRACE`; lets you aggregate by stack without copying frames every event. |

## Core Concepts

### 1. A program is bytecode the kernel proves safe before it runs

You never hand the kernel native code. You hand it BPF bytecode plus relocations. The verifier walks every reachable path, tracks the type and bounds of every register, and rejects anything it can't prove safe. Acceptance is a *proof*, not a heuristic — this is the foundation of running it in production.

### 2. Maps are the only state and the only channel

A BPF program has no malloc, no globals beyond maps, and no syscalls. All persistent state and all communication with user space goes through maps: hashes, arrays, per-CPU variants, ring buffers, stack-trace maps, LRU hashes. Designing a tool is mostly designing its maps.

### 3. The attach point determines what you can see

A tracepoint gives you a stable, documented argument struct. A kprobe gives you raw registers at an arbitrary instruction. An fentry gives you typed function arguments via a trampoline. The same question ("how long does `vfs_read` take?") has different fidelity and cost depending on the hook.

### 4. Aggregate in the kernel, ship summaries

The performance win is doing the reduction (count, histogram, stack-ID aggregation) in kernel space and emitting only the result. Per-event streaming to user space is the expensive path; reserve it for events rare enough to afford it.

### 5. Portability is a load-time concern, not a compile-time one

CO-RE means the *same* compiled object runs on many kernels because field offsets and existence are patched at load time from the target's BTF. This is what makes a single binary shippable across a fleet.

### 6. Privilege is now granular

Pre-5.8, tracing meant root. With `CAP_BPF` + `CAP_PERFMON` you grant exactly the tracing capability and nothing else — material for least-privilege agents.

## The eBPF Programming Model

Three pieces compose every tool:

**Program types** (`BPF_PROG_TYPE_*`) define the execution context and the helper allowlist. `BPF_PROG_TYPE_KPROBE` gets a `pt_regs *`; `BPF_PROG_TYPE_TRACING` (fentry/fexit) gets typed args; `BPF_PROG_TYPE_PERF_EVENT` fires on counter overflow (the basis of profiling); `BPF_PROG_TYPE_RAW_TRACEPOINT` is a low-overhead tracepoint. In libbpf you rarely name the enum — the `SEC("...")` annotation selects it.

**Attach points** are where the program binds. Tracepoints (`tp/...`, `tp_btf/...`) are stable kernel ABI. kprobes attach to any kernel symbol but offer no ABI stability. fentry/fexit attach to function entry/return via a BTF trampoline. perf events attach to hardware/software counters or `perf_event_open`-style sampling.

**Maps are the data plane.** The program writes; user space reads (or vice versa). Choosing the map *is* the design: a histogram is a `PERCPU_ARRAY` of log2 buckets; a "who called this most" tally is a `HASH` keyed by comm or PID; a per-flow table is a `LRU_HASH` so it self-bounds; an event stream is a `RINGBUF`.

## fentry/fexit vs kprobe/kretprobe

kprobes work everywhere (4.x kernels) but pay a cost: they trap via a breakpoint/INT3 mechanism, hand you raw `pt_regs`, and offer zero type safety — you decode arguments by ABI calling convention and pray the signature didn't change. kretprobes also consume a limited pool of return-probe slots and add entry+exit overhead.

fentry/fexit (5.5+, needs BTF) attach a **trampoline** directly at function entry/return. They are faster (no breakpoint trap), type-safe (real argument types from BTF), and `fexit` can read *both* arguments and the return value in one probe — kretprobe cannot see the original arguments without a paired kretprobe juggling a map.

```bash
# fentry: typed, fast, modern
bpftrace -e 'fentry:vfs_read { @[comm] = count(); }'

# equivalent kprobe: works on older kernels, raw, slower
bpftrace -e 'kprobe:vfs_read { @[comm] = count(); }'

# fexit sees args AND retval together:
bpftrace -e 'fexit:vfs_read { @bytes = hist(retval); }'
```

Rule of thumb: prefer fentry/fexit when BTF is present (5.5+); fall back to kprobe for portability or for symbols without a stable BTF function entry.

## CO-RE and BTF — Compile Once, Run Everywhere

The portability problem: kernel struct layouts change between versions. `task_struct->pid` lives at a different byte offset on 5.4 vs 6.6. The old BCC approach embedded a Clang compiler and compiled the program *on the target* against its headers — heavyweight, fragile, and impossible on a stripped box.

CO-RE solves it with **BTF relocations**. You compile once against `vmlinux.h` (the full kernel type universe dumped from BTF). When you access `task->pid`, the compiler emits a *relocation* rather than a fixed offset. At load time, libbpf reads the **target kernel's** BTF from `/sys/kernel/btf/vmlinux` and rewrites the offset to match. The same `.o` runs across the fleet.

`BPF_CORE_READ()` is the CO-RE-aware accessor: it issues `bpf_probe_read_kernel` with relocatable offsets and chases pointers safely:

```c
// reads task->mm->owner->comm with per-hop relocations + safe kernel reads
char comm[16];
BPF_CORE_READ_INTO(&comm, task, comm);
struct mm_struct *mm = BPF_CORE_READ(task, mm);
```

Generate `vmlinux.h` once: `bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h`. This is why CO-RE tools ship as a single small binary with no kernel headers attached.

## The Verifier as Your Safety Net

The verifier is what lets you point this at production. It rejects the program *before* it runs unless it can prove safety along every path:

- **Bounded loops only.** Pre-5.3 no loops at all (you unrolled with `#pragma unroll`). 5.3+ allows loops the verifier can prove terminate; `bpf_loop()` (5.17+) gives a clean bounded-iteration helper.
- **1 million instruction complexity limit.** The verifier explores paths; total complexity (not source lines) is capped. Deep nesting or unbounded pointer walks blow the budget. Tail calls split work across programs to stay under it.
- **512-byte stack.** No large on-stack buffers. Big scratch space goes in a per-CPU array map.
- **Helper allowlist per program type.** You can only call the helpers permitted for your program type. No arbitrary kernel calls (kfuncs are the typed, sanctioned exception).
- **No uninitialized reads, no out-of-bounds, no unchecked pointer deref.** Every memory access must be provably in bounds; every kernel pointer must be read through `bpf_probe_read_kernel`/`BPF_CORE_READ`.

Why this beats a kernel module: a buggy module panics the box. A buggy BPF program is *rejected at load* with a verifier log pointing at the offending instruction. The cost of that safety is a restricted language — and learning to read `bpftool prog load` verifier output is a core senior skill.

## Ring Buffers vs Perf Buffers

Both stream variable-length events to user space. Prefer the **ring buffer** on 5.8+.

| | Perf buffer (`PERF_EVENT_ARRAY`) | Ring buffer (`RINGBUF`) |
|---|---|---|
| Topology | Per-CPU buffers | Single shared MPSC buffer |
| Ordering | Per-CPU only | Global event ordering |
| Memory | N × per-CPU (often over-provisioned) | One sized buffer (power of two pages) |
| Overhead | Higher; copy + per-CPU wakeups | Lower; reserve/commit, fewer wakeups |
| API | `bpf_perf_event_output` | `bpf_ringbuf_reserve` + `bpf_ringbuf_submit` |

The ring buffer's `reserve`/`submit` is also nicer: you reserve space, fill it in place (no double copy), then submit. If a downstream consumer is slow, you can `bpf_ringbuf_discard` instead of submit and drop the event cleanly rather than corrupting the stream.

## A Minimal libbpf CO-RE Tool

Two files: the kernel program (`.bpf.c`) and the user-space loader. Annotated.

**`openat.bpf.c`** — kernel side:

```c
#include "vmlinux.h"            // all kernel types, from BTF — no kernel headers needed
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

struct event {                  // what we ship to user space
    __u32 pid;
    char  comm[16];
    char  fname[128];
};

struct {                        // the data plane: a 256 KiB ring buffer
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} rb SEC(".maps");

SEC("tp/syscalls/sys_enter_openat")          // stable tracepoint = stable ABI
int handle_openat(struct trace_event_raw_sys_enter *ctx)
{
    struct event *e = bpf_ringbuf_reserve(&rb, sizeof(*e), 0);
    if (!e)                                   // verifier forces the NULL check
        return 0;

    e->pid = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    // args[1] is the const char *filename for openat
    bpf_probe_read_user_str(&e->fname, sizeof(e->fname),
                            (const char *)ctx->args[1]);

    bpf_ringbuf_submit(e, 0);                 // or bpf_ringbuf_discard(e, 0)
    return 0;
}
```

**User-space loader** (sketch), using the generated skeleton `openat.skel.h`:

```c
#include "openat.skel.h"
#include <bpf/libbpf.h>

static int on_event(void *ctx, void *data, size_t len) {
    struct event *e = data;
    printf("%-6d %-16s %s\n", e->pid, e->comm, e->fname);
    return 0;
}

int main(void) {
    struct openat_bpf *skel = openat_bpf__open_and_load(); // CO-RE relocs happen here
    openat_bpf__attach(skel);                              // attach the tracepoint

    struct ring_buffer *rb =
        ring_buffer__new(bpf_map__fd(skel->maps.rb), on_event, NULL, NULL);

    while (ring_buffer__poll(rb, 100 /*ms*/) >= 0) { }     // drain events

    ring_buffer__free(rb);
    openat_bpf__destroy(skel);
}
```

`open_and_load` is where CO-RE earns its name: libbpf reads the target's BTF and patches every relocatable field access. You ship one `.o` (embedded in the skeleton) and it runs on any 5.8+ kernel with BTF — no per-kernel headers, no on-target Clang.

## Production-Safe Dynamic Tracing

The discipline that makes this acceptable on a customer's box:

- **Reason about overhead before attaching.** Cost ≈ (event rate) × (per-probe work). A probe on `tcp_retransmit_skb` fires rarely — essentially free. A probe on `sys_enter_read` at 300k/s is *not* free; scope it or aggregate hard.
- **Scope by target.** Filter by PID, cgroup, comm, or device in the probe body so you only pay for the events you care about: `kprobe:vfs_read /pid == 4242/ { ... }`.
- **Time-box it.** Never leave an ad-hoc probe attached. Use a `timeout`, `interval` with `exit()`, or a wrapping `timeout 30 bpftrace ...`.
- **Privileges:** prefer `CAP_BPF` + `CAP_PERFMON` (5.8+) over root. Grant the tracing agent exactly these caps; it can load and trace but cannot, say, load network-attached XDP that reroutes traffic (`CAP_NET_ADMIN` is separate).
- **Locked-down kernels block you.** Secure Boot / kernel **lockdown mode** (`integrity`/`confidentiality`) disables kprobes and `bpf_probe_read` on many fields; missing `CONFIG_DEBUG_INFO_BTF` kills CO-RE and fentry. Know this *before* the incident.
- **Prefer aggregation over streaming** in prod; a histogram is cheap, a per-event ring buffer at high rate is not.

## When to Reach for bpftrace in an Incident

Pre-instrumentation (metrics, spans, logs) answers questions you anticipated. The incidents that page you at 3am are, by selection, the ones you *didn't* anticipate — the unknown-unknown. bpftrace is the tool for those, because you can ask a brand-new question of a running, unmodified process or kernel in seconds.

A realistic walk-through. Symptom: p99 request latency jumped 10×, but CPU is flat, all app spans look normal, and there's no error log. The app spans being normal is the tell — the time is being spent *outside* what the app instrumented. So you go below the app:

```bash
# 1. Is the process off-CPU (blocked), not on-CPU (busy)?
sudo bpftrace -e '
  kprobe:finish_task_switch {
    $prev = (struct task_struct *)arg0;
    @off[$prev->comm] = sum(nsecs - @start[$prev->pid]);
  }
  tracepoint:sched:sched_switch { @start[args->prev_pid] = nsecs; }
  interval:s:10 { exit(); }'
```

Off-CPU time for the app process dominates — it's *waiting*, not computing. Now: waiting on what? Aggregate the off-CPU stacks to see where it blocks:

```bash
sudo bpftrace -e '
  kprobe:finish_task_switch /comm == "api-server"/ {
    @[kstack] = sum(nsecs - @s[tid]); delete(@s[tid]);
  }
  tracepoint:sched:sched_switch /args->prev_comm == "api-server"/ {
    @s[args->prev_pid] = nsecs;
  }
  interval:s:30 { exit(); }'
```

The top stack points into TCP retransmit / `tcp_write_xmit`. Confirm with a retransmit tracer and you have your answer — packet loss to a downstream is stalling sends. None of this was pre-instrumented; you discovered it live.

## Code Examples

```bash
# 1. fentry one-liner: count vfs_read callers by command (typed, fast)
sudo bpftrace -e 'fentry:vfs_read { @[comm] = count(); }'

# 2. Off-CPU time by stack (where is the app blocking?)
sudo bpftrace -e '
  tracepoint:sched:sched_switch { @start[args->prev_pid] = nsecs; }
  kprobe:finish_task_switch /@start[tid]/ {
    @offcpu_ns[kstack] = sum(nsecs - @start[tid]); delete(@start[tid]);
  }'

# 3. Flame-graph-friendly on-CPU stack aggregation (folded output)
sudo bpftrace -e 'profile:hz:99 { @[kstack, ustack, comm] = count(); }' \
  | ./stackcollapse-bpftrace.pl | ./flamegraph.pl > cpu.svg

# 4. TCP retransmits, two ways
sudo tcpretrans-bpfcc                                   # BCC tool, ready-made
sudo bpftrace -e 'kprobe:tcp_retransmit_skb {
    @retrans[comm] = count(); printf("retrans %s\n", comm); }'

# 5. Syscall latency histogram via fexit (args + retval in one probe)
sudo bpftrace -e '
  fentry:do_sys_openat2 { @ts[tid] = nsecs; }
  fexit:do_sys_openat2 /@ts[tid]/ {
    @us = hist((nsecs - @ts[tid]) / 1000); delete(@ts[tid]); }'
```

```c
// 6. libbpf CO-RE snippet: read task fields portably with BPF_CORE_READ
struct task_struct *task = (struct task_struct *)bpf_get_current_task();
pid_t ppid = BPF_CORE_READ(task, real_parent, tgid);   // relocatable offsets
__u64 start = BPF_CORE_READ(task, start_time);          // patched at load time
```

## Worked Example — Catching an Unforeseen Bug Live

Production, payments service, SEV-2. Symptom: ~1% of requests time out at 5s. Dashboards: CPU normal, GC normal, DB query metrics normal, app traces show the *handler* finishing in 4ms — yet the client sees 5s. The trace ends; the wall clock doesn't. The gap is between "handler returns the response object" and "bytes leave the box."

Step 1 — confirm the process is blocked, not busy:

```bash
sudo bpftrace -e '
  kprobe:finish_task_switch /comm == "pay-svc"/ {
    @off[ustack] = sum(nsecs - @s[tid]); delete(@s[tid]); }
  tracepoint:sched:sched_switch /args->prev_comm == "pay-svc"/ {
    @s[args->prev_pid] = nsecs; }
  interval:s:20 { exit(); }'
```

Dominant off-CPU stack: blocked in `futex` inside the connection-pool's lock. The handler finishes fast, but the *response writer* contends on a pool mutex held by a slow path.

Step 2 — who holds it that long? Trace lock hold time:

```bash
sudo bpftrace -e '
  uprobe:/app/pay-svc:pool_lock   { @h[tid] = nsecs; }
  uprobe:/app/pay-svc:pool_unlock /@h[tid]/ {
    @hold_ms = hist((nsecs - @h[tid]) / 1000000); delete(@h[tid]); }'
```

A long tail at 5000ms. The lock holder is doing a *synchronous DNS resolve* (the rare cache-miss path) **inside** the critical section — invisible to app metrics because DNS wasn't instrumented and the median path never blocked.

Step 3 — confirm the DNS theory cheaply:

```bash
sudo bpftrace -e 'kprobe:tcp_retransmit_skb { @[comm] = count(); }'   # rule out network
sudo bpftrace -e 'kprobe:__inet_lookup_established { } ; uprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo { @gai[comm] = count(); }'
```

`getaddrinfo` calls correlate exactly with the slow requests. Fix: move resolution out of the lock and add a resolver cache. The entire diagnosis used probes attached to an unmodified production binary; nothing was redeployed until the fix.

## Pros & Cons

| Pros | Cons |
|------|------|
| Observe running code with no source change/restart | Linux-only (Windows eBPF is nascent) |
| Verifier-proven safety — won't panic the box | Restricted language; verifier rejections take skill to read |
| Near-zero overhead with kernel-side aggregation | High-rate probes *can* hurt if unscoped |
| CO-RE = one binary across kernels | Needs BTF (5.x+) for the good features |
| Granular privilege via `CAP_BPF`/`CAP_PERFMON` | Lockdown/Secure Boot can disable tracing |
| Answers unknown-unknowns no metric anticipated | Not a replacement for in-app spans/metrics |

## Use Cases

- Live latency/off-CPU/blocked-time analysis with no redeploy.
- Continuous profiling and flame graphs at fleet scale (see **profiling-techniques**).
- Network observability: TCP retransmits, connection latency, DNS, packet drops.
- Security/runtime monitoring (Falco, Tetragon) on syscalls and process events.
- Per-cgroup/per-container resource accounting and I/O latency.
- Validating a hypothesis during an incident before shipping a fix.

## Coding Patterns

- **Map-per-concept:** one map for in-flight timestamps keyed by tid, one for the aggregated histogram/stack tally.
- **Entry/exit timing:** stash `nsecs` at entry keyed by `tid`, compute delta at exit, `delete()` the entry to bound the map.
- **Stack-ID aggregation:** store stack IDs into a `STACK_TRACE` map and tally by ID; resolve symbols in user space once.
- **LRU for unbounded keyspaces:** use `BPF_MAP_TYPE_LRU_HASH` for per-flow/per-PID tables so a busy box can't exhaust the map.
- **Tail calls for big logic:** split a program exceeding the complexity budget across a prog array.

## Clean Usage

- Always check `bpf_ringbuf_reserve()` for NULL; the verifier requires it and a dropped event is better than a stall.
- `delete()` transient map entries to prevent unbounded growth.
- Filter (`/pred/`) as early as possible to minimize per-event work.
- Resolve symbols and format strings in user space, not in the probe.
- Prefer tracepoints over kprobes for ABI stability; prefer fentry over kprobe for speed where BTF exists.

## Best Practices

- Estimate event rate × cost before attaching anything in prod; scope and time-box.
- Ship libbpf CO-RE tools, not BCC-compile-on-target, for production agents.
- Keep `vmlinux.h` regenerated from the target BTF; never hand-edit kernel types.
- Run agents under `CAP_BPF`+`CAP_PERFMON`, not blanket root.
- Test on the *oldest and newest* kernels in your fleet — CO-RE handles offsets, not removed fields.
- Treat bpftrace as a scalpel for hypotheses, libbpf for the durable tool you keep.

## Edge Cases & Pitfalls

- **Missing BTF:** no CO-RE, no fentry — fall back to kprobes and on-target compilation, or build BTF with the `BTFhub` archive.
- **Lockdown mode** silently blocks `bpf_probe_read` of certain fields; symptom is empty/zero reads, not an error.
- **Inlined functions** have no kprobe/fentry target; the symbol exists in source but not as a callable entry.
- **kretprobe slot exhaustion** under high concurrency drops return events — another reason to prefer fexit.
- **Per-CPU map aggregation** must be summed across CPUs in user space; reading one CPU's value undercounts.
- **High-rate ring buffer** can drop events; check the dropped counter and consider sampling.

## Common Mistakes

- Attaching an unscoped probe to a hot path (`sys_enter_read`) in prod and adding measurable latency.
- Forgetting to `delete()` entry timestamps — the map grows until it's full and silently drops new entries.
- Reading kernel memory with a raw deref instead of `BPF_CORE_READ`/`bpf_probe_read_kernel` (rejected, or worse, non-portable).
- Assuming a one-liner from a blog matches your kernel version's symbol names — `tcp_retransmit_skb` vs `tcp_retransmit_skb` argument shapes vary.
- Treating eBPF as a substitute for application metrics; it sees syscalls and kernel state, not your business logic.
- Leaving a probe attached after the incident.

## Tricky Points

- A program "passing the verifier" means *safe*, not *correct* — your aggregation logic can still be wrong.
- fentry can't attach to a function the compiler inlined; the fix is a different (often parent) hook.
- CO-RE relocates offsets but cannot conjure a field that doesn't exist on the target kernel; guard with `bpf_core_field_exists()`.
- Ring buffer ordering is global, but timestamps from different CPUs need a monotonic clock to compare meaningfully.
- `comm` is 16 bytes including the NUL — long process names are truncated, which can collide in tallies.

## Test Yourself

1. Why can the verifier guarantee a BPF program won't hang the kernel, and what specific constraints enforce that?
2. Give one case where you must use a kprobe instead of fentry, and one where fentry is strictly better.
3. What does CO-RE relocate at load time, and what does it read to do so?
4. When would you choose a perf buffer over a ring buffer?
5. How do you measure off-CPU time with bpftrace, and which two hooks do you combine?
6. Which capabilities replace root for tracing in 5.8+, and what can lockdown mode block?
7. Why aggregate in the kernel rather than streaming every event to user space?

## Tricky Questions

<details><summary>Your CO-RE tool works on the 6.6 dev box but reads zeros for a struct field on a 5.10 prod box. What happened and how do you make it robust?</summary>

The field likely doesn't exist (or moved into a different struct) on 5.10 — CO-RE relocated the offset, but the field is absent, so the read returns zero rather than failing. Guard with `bpf_core_field_exists(task, the_field)` and branch, or read an alternate field on older kernels. Always test against the oldest fleet kernel; CO-RE handles layout changes, not field *existence*.
</details>

<details><summary>A teammate's bpftrace one-liner on `sys_enter_read` "added 15% latency in prod." What went wrong and what's the fix?</summary>

`read` is an extremely hot syscall; an unscoped probe firing hundreds of thousands of times per second adds per-event work to every read. Fix: scope it with a predicate (`/pid == X/` or by cgroup), aggregate into a histogram instead of streaming, and time-box the run. Better still, probe a rarer, more specific hook that answers the actual question.
</details>

<details><summary>Why is fexit able to record both a function's arguments and its return value, while kretprobe needs two probes and a map?</summary>

fexit is a BTF trampoline that wraps the function: at the exit point it still has typed access to the original arguments *and* the return value in one program. kretprobe only fires on return and has no argument context, so you must pair it with a kprobe on entry that stashes the args in a map keyed by tid, then read them back on return — more code, more overhead, and vulnerable to slot exhaustion.
</details>

<details><summary>The kernel has no BTF (`CONFIG_DEBUG_INFO_BTF=n`). Which of your tools break and what are the workarounds?</summary>

CO-RE and fentry/fexit break (both need BTF); tracepoints with raw offsets and kprobes still work, but you lose portability and type safety. Workarounds: install BTF from the **BTFhub** archive matching the kernel build, generate BTF for the running kernel, or fall back to BCC's compile-on-target approach. This is exactly why you check for BTF before an incident, not during one.
</details>

## Cheat Sheet

```bash
# Probe fentry vs kprobe
bpftrace -e 'fentry:vfs_read { @[comm]=count(); }'
bpftrace -e 'kprobe:vfs_read  { @[comm]=count(); }'
# fexit: args + retval together
bpftrace -e 'fexit:vfs_read { @=hist(retval); }'
# List probes
bpftrace -l 'fentry:*'   ;  bpftrace -l 'tracepoint:syscalls:*'
# TCP retransmits
tcpretrans-bpfcc
# Generate vmlinux.h for CO-RE
bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
# Build + skeleton (libbpf-bootstrap layout)
clang -O2 -g -target bpf -c x.bpf.c -o x.bpf.o
bpftool gen skeleton x.bpf.o > x.skel.h
# Inspect loaded programs / maps
bpftool prog show ; bpftool map show
```

| Need | Reach for |
|------|-----------|
| Fast typed entry probe (5.5+) | fentry/fexit |
| Old kernel / no BTF | kprobe + on-target compile |
| Stream events to user space | `BPF_MAP_TYPE_RINGBUF` |
| Histogram in kernel | `PERCPU_ARRAY` log2 buckets |
| Aggregate by stack | `STACK_TRACE` map + stack ID |
| Self-bounding per-key table | `LRU_HASH` |
| Portable kernel field read | `BPF_CORE_READ` |

## Summary

eBPF is a verifier-guaranteed-safe, kernel-resident programming surface: you attach a small bytecode program (selected by program type and `SEC()` annotation) to a hook — tracepoint, kprobe, or the faster type-safe fentry/fexit trampoline — and it communicates with user space exclusively through maps, streaming events via the low-overhead `BPF_MAP_TYPE_RINGBUF` or aggregating in-kernel into histograms and stack-ID tallies. CO-RE plus BTF make a single compiled object portable across kernels by relocating field offsets at load time from the target's BTF, so you ship one binary instead of compiling on every box. The verifier — bounded loops, the 1M-instruction budget, the 512-byte stack, the helper allowlist — is precisely what makes it safe to point at production, while `CAP_BPF`/`CAP_PERFMON` make it safe to run without root (lockdown and missing BTF being the main blockers). Senior judgment is reasoning about overhead, scoping and time-boxing probes, and knowing that when an incident is an unknown-unknown with no span and no metric, bpftrace lets you ask the unanticipated question of a live, unmodified kernel — without replacing the in-app metrics and spans that handle everything you *did* anticipate.

## What You Can Build

- A libbpf CO-RE syscall/file/network tracer shippable across your whole fleet from one binary.
- A continuous-profiler agent emitting folded stacks for flame graphs (pairs with the **profiling-techniques** and **observability-stack** skills).
- An off-CPU/latency-breakdown tool that attributes wall-clock time the app's spans miss.
- A runtime-security sensor on syscall and process-exec events under `CAP_BPF`.
- An incident "probe kit": curated, scoped, time-boxed bpftrace one-liners ready to paste during a SEV.

## Further Reading

- Brendan Gregg, *BPF Performance Tools* — the definitive catalog of tracing tools and one-liners.
- Brendan Gregg, *Systems Performance* (2nd ed.) — the methodology (USE, off-CPU analysis) that drives the tools.
- Liz Rice, *Learning eBPF* — the programming model and libbpf from the ground up.
- Repos: `bpftrace`, `iovisor/bcc`, and `libbpf/libbpf-bootstrap` (the canonical CO-RE project layout).
- This material connects to the **linux-debugging**, **observability-stack**, and **profiling-techniques** skills — use them for the surrounding workflow, dashboards, and CPU-profiling methodology.

## Related Topics

- [Continuous Profiling](../continuous-profiling/)
- [Tracing](../tracing/)
- [Metrics](../metrics/)
- [Logging](../logging/)
- [Debugging](../debugging/)
- [Observability Engineering](../observability-engineering/)

## Diagrams & Visual Aids

```
 eBPF data path
 ┌────────────────────────────────────────────────────────────┐
 │ kernel hook (tracepoint / kprobe / fentry)                  │
 │        │ fires                                              │
 │        ▼                                                    │
 │  ┌──────────────┐   writes    ┌──────────────────────────┐ │
 │  │ BPF program  │ ──────────► │ maps (HASH / PERCPU /     │ │
 │  │ (verified +  │             │ STACK_TRACE / RINGBUF)    │ │
 │  │  JITed)      │             └──────────┬───────────────┘ │
 │  └──────────────┘                        │ poll/read       │
 └──────────────────────────────────────────┼─────────────────┘
                                             ▼
                              user space (libbpf / bpftrace)
```

```
 Load-time CO-RE relocation
   x.bpf.o  (offset = RELOC task->pid)
       │ open_and_load
       ▼
   libbpf reads /sys/kernel/btf/vmlinux  ──►  patches offset for THIS kernel
       │
       ▼  one object, many kernels
```

```
 fexit vs kretprobe (entry+exit timing)
   fentry  ──┐                          kprobe ─┐ stash args in map[tid]
             │ args                              │
   function  │                          function │
             │                                   │
   fexit   ──┘  sees args + retval      kretprobe┘ retval only -> join via map[tid]
```
