# Dynamic Instrumentation & eBPF — Middle Level

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
> **Focus:** How eBPF actually works — the VM, the verifier, maps, and ring/perf buffers. Reading and writing real bpftrace programs (not just one-liners) and BCC tools. Capturing function arguments and return values. USDT in the JVM and Python. The entry/return latency pattern, per-process scoping, and tracing your own service in production without making it worse.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [How eBPF Runs Your Code](#how-ebpf-runs-your-code)
6. [The Verifier, Concretely](#the-verifier-concretely)
7. [Maps and Buffers — The Data Plane](#maps-and-buffers--the-data-plane)
8. [Probe Selection in Practice](#probe-selection-in-practice)
9. [Capturing Arguments and Return Values](#capturing-arguments-and-return-values)
10. [USDT in the JVM and Python](#usdt-in-the-jvm-and-python)
11. [Code Examples](#code-examples)
12. [bpftrace vs BCC vs libbpf](#bpftrace-vs-bcc-vs-libbpf)
13. [Use Cases](#use-cases)
14. [Coding Patterns](#coding-patterns)
15. [Clean Usage](#clean-usage)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test Yourself](#test-yourself)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is eBPF doing under the hood when you run a one-liner?** and **How do I write a real tracing program against my own service safely?**

At the junior level you treated bpftrace as awk-for-the-kernel and ran ready-made BCC tools. That gets you a long way. To go further you need to understand the machine underneath: when you run `bpftrace -e '...'`, your text is compiled to **eBPF bytecode**, handed to the kernel, **verified** for safety, **JIT-compiled** to native instructions, and **attached** to your chosen events. Each time an event fires, the kernel runs your verified program *in kernel context*, writing results into **maps**. bpftrace reads those maps back and prints them.

Understanding this pipeline changes how you write tracing. You'll stop fighting the verifier and start working with it. You'll know *why* per-event `printf` is expensive (it streams through a **perf/ring buffer** to user-space) and *why* `count()` is cheap (it stays in a kernel map). You'll know how to capture a function's **arguments** (`arg0`, `args->field`) and its **return value** (`retval`) — the difference between "this function was called" and "this function was called with *these inputs* and returned *this error*."

This level is also where you start tracing **your own running service** — the one you can't restart in production. You'll use uprobes on your binary, USDT probes the JVM and CPython expose, and the entry/return timing pattern to build latency histograms of *your* functions, live, with overhead you can reason about.

> 🎓 **Why this matters for a mid-level engineer:** You're the one who gets handed the box during an incident. Knowing the eBPF pipeline means you can write a *correct* one-liner under pressure, predict its overhead before you attach it, and capture the argument that actually explains the bug — rather than copy-pasting a tool and hoping.

---

## Prerequisites

- **Required:** The [junior level](junior.md) — probe families, `probe = event + action`, the entry/return pattern, basic bpftrace.
- **Required:** Comfort with C-like syntax (bpftrace and BCC borrow it) and pointers (you'll dereference struct fields).
- **Required:** A service of your own you can run and trace — Go, Java, Python, or a C/Rust binary.
- **Helpful:** Knowing what a **system call** does internally, and roughly how a function passes arguments in registers (the calling convention). bpftrace's `arg0..argN` map to those.
- **Helpful:** The **linux-debugging** and **observability-stack** skills for where this sits in the wider toolkit.

---

## Glossary

| Term | Definition |
|------|-----------|
| **eBPF bytecode** | The portable instruction set your program is compiled to before the kernel verifies and JITs it. |
| **Verifier** | Kernel pass that *proves* the program halts, only touches valid memory, and has a bounded instruction/loop budget — before it runs. |
| **JIT** | Just-In-Time compiler that turns verified eBPF bytecode into native machine code for speed. |
| **Map** | A typed kernel key/value store (hash, array, per-CPU, LRU, …) eBPF uses for state and for kernel↔user sharing. |
| **Perf buffer** | The older per-CPU mechanism for streaming individual events to user-space. |
| **Ring buffer (`BPF_MAP_TYPE_RINGBUF`)** | The newer, single shared, ordered, lower-overhead event channel (kernel 5.8+). Prefer it. |
| **`arg0`..`argN`** | bpftrace's accessors for a probed function's positional arguments (from registers). |
| **`retval`** | bpftrace's accessor for the return value in a `kretprobe`/`uretprobe`. |
| **USDT** | User Statically-Defined Tracing — author-placed, stable, semantically-named probes in apps. |
| **Stack trace** | The call stack at the moment a probe fires: `kstack` (kernel), `ustack` (user). |
| **Per-CPU map** | A map with one copy per CPU to avoid lock contention; values are summed when read. |
| **BTF** | BPF Type Format — kernel type info that powers CO-RE and lets tools read struct fields portably. |
| **`CAP_BPF`** | The Linux capability that grants the ability to load BPF programs without full root (kernel 5.8+). |

---

## Core Concepts

### 1. Your program is verified *before* it ever runs

Unlike a kernel module — which the kernel trusts blindly and which can panic the box — an eBPF program must *prove* its safety to the verifier first. This is the central bargain: you accept real constraints (bounded loops, limited stack, no arbitrary memory access) in exchange for being allowed to run code in the kernel of a production machine.

### 2. Aggregating in-kernel is cheap; streaming to user-space is not

Every design decision flows from this. `count()`/`hist()`/`sum()` update a kernel map and never leave the kernel until you stop. `printf`/per-event records traverse a ring or perf buffer into user-space — orders of magnitude more work per event. On a hot path, that difference is the whole ballgame.

### 3. Arguments and return values are where the *insight* lives

"`do_sys_openat2` was called 4,000 times" is a number. "`do_sys_openat2` was called with `/etc/shadow` and returned `-EACCES`" is an *answer*. Capturing `args`/`arg0`/`retval` is the step from counting to understanding.

### 4. Match entry to return by thread, and clean up

Latency = `return_time − entry_time`. Store the entry timestamp keyed by **`tid`** (threads of one process can be in the same function simultaneously), read it on return, then **`delete()`** it. Forgetting the delete leaks map entries; forgetting that a function might *not* return leaves stale entries forever.

### 5. Stable hooks are an engineering decision, not a preference

A kprobe on an internal function is a tool you accept will break on the next kernel. A tracepoint or USDT probe is a *contract*. For a one-off incident, the kprobe is fine. For a tool you'll ship and rely on, choose the stable hook or use **CO-RE** (senior level) so it survives upgrades.

---

## How eBPF Runs Your Code

The pipeline, end to end:

```
  bpftrace text / C source
        │  compile
        ▼
  eBPF bytecode  ──▶  [ VERIFIER ]  ──reject──▶  error, nothing runs
        │  accept
        ▼
     [ JIT ]  ──▶  native machine code
        │  attach to probe(s)
        ▼
  EVENT FIRES ──▶ your code runs in kernel context ──▶ writes to MAPS
                                                          │
                          user-space reads maps / drains ring buffer
```

Three things to internalize:

1. **The verifier runs once, at load time** — not per event. Its cost is paid up front; the attached program then runs at native speed.
2. **The program runs in restricted kernel context** — it can't sleep arbitrarily, can't call most kernel functions, and has a tiny (512-byte) stack. That's why state lives in maps, not local variables.
3. **The probe is the trigger, the program is the payload, the map is the result.** Everything you do is some arrangement of those three.

---

## The Verifier, Concretely

The verifier is the feature that makes production eBPF possible. It walks every possible path through your program and rejects anything it can't prove safe. The constraints you'll actually hit:

- **No unbounded loops.** Early eBPF banned loops entirely; modern kernels allow *bounded* loops the verifier can prove terminate. An infinite loop = rejection (it would hang the kernel).
- **Every memory access must be provably in-bounds.** Reading a map value or a packet requires a NULL/bounds check the verifier can see. This is why BCC code is littered with `if (val == NULL) return 0;`.
- **Pointer arithmetic is tracked.** You can't fabricate a pointer to arbitrary kernel memory; the verifier knows the provenance of every pointer.
- **Instruction budget.** Programs over the complexity limit are rejected — the verifier must finish analyzing in finite time.

A typical rejection, paraphrased from a real BCC error:

```
; val = bpf_map_lookup_elem(&counts, &key);
invalid mem access 'map_value_or_null'
```

Translation: *you looked up a map entry and used the result without checking it for NULL.* The lookup can return NULL (key absent), and dereferencing NULL in the kernel is a panic, so the verifier refuses. The fix is the check the verifier is demanding:

```c
u64 *val = bpf_map_lookup_elem(&counts, &key);
if (!val) return 0;       // <-- the verifier wanted this proof
(*val)++;
```

> **Mental reframe:** the verifier is not in your way; it found a path where your code *could* have crashed a production kernel and is making you handle it. Every rejection is a bug you didn't ship.

---

## Maps and Buffers — The Data Plane

eBPF programs are stateless between firings *except* for maps. Maps are how state survives across events and how data crosses into user-space.

**Common map types you'll meet:**

| Type | Use |
|---|---|
| `HASH` | General key→value, e.g. `@start[tid]`. |
| `PERCPU_HASH/ARRAY` | High-frequency counters with no lock contention; summed on read. |
| `LRU_HASH` | Bounded hash that evicts oldest entries — caps memory automatically. |
| `STACK_TRACE` | Stores stacks for flame-graph-style aggregation. |

**Two ways to get *individual events* out to user-space:**

- **Perf buffer** — the classic mechanism; one buffer per CPU, can drop and reorder under load.
- **Ring buffer** (`BPF_MAP_TYPE_RINGBUF`, kernel 5.8+) — one shared buffer, preserves ordering, lower overhead, simpler API. **Prefer it** when available.

The decision that matters: **do you need every event, or a summary?** If a summary (counts, histograms, top-N), keep it in a map and never use a buffer — far cheaper. Use a ring buffer only when you genuinely need each event's detail in user-space.

---

## Probe Selection in Practice

The junior rule was "stable if it exists." Mid-level, you weigh it deliberately:

| Question | Choice |
|---|---|
| Kernel behavior, stable hook exists? | **tracepoint** (`bpftrace -l 'tracepoint:*'` to find it) |
| Kernel function, no tracepoint? | **kprobe/kretprobe** — accept it may break on upgrade |
| App behavior, author shipped a marker? | **USDT** (`bpftrace -l 'usdt:/path/to/bin'`) |
| Your own function, no USDT? | **uprobe/uretprobe** by symbol name |
| Need a periodic sample, not an event? | **`profile:hz:99`** or `interval:s:1` |

A subtlety: **syscall tracepoints come in `sys_enter_X` / `sys_exit_X` pairs.** Arguments live on `sys_enter`; the return code lives on `sys_exit`. To capture both you attach to both and join by `tid`.

---

## Capturing Arguments and Return Values

This is the mid-level superpower. The accessors:

- **Tracepoints:** named fields via `args->field` (discover them with `bpftrace -lv 'tracepoint:...'`).
- **kprobes/uprobes:** positional `arg0`, `arg1`, … (from registers; you must know the function's signature).
- **kretprobes/uretprobes:** `retval`.

```bash
# openat() arguments AND result, joined by thread id
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_openat { @fn[tid] = str(args->filename); }
tracepoint:syscalls:sys_exit_openat /@fn[tid]/ {
    printf("%-16s open(%s) = %d\n", comm, @fn[tid], args->ret);
    delete(@fn[tid]);
}'
```

This shows *which file* each process tried to open *and whether it succeeded* (`= -13` is `-EACCES`). That single line answers "who is failing to open what, and why" — a question no pre-shipped log would have anticipated.

---

## USDT in the JVM and Python

USDT probes are author-placed markers that survive upgrades and carry meaning. Two big runtimes ship them.

**JVM** (built/run with USDT enabled — `-XX:+ExtendedDTraceProbes` or a probe-enabled build):

```bash
# List the HotSpot probes a running JVM exposes
sudo bpftrace -l 'usdt:/usr/lib/jvm/java-17-openjdk/lib/server/libjvm.so:*'

# Count GC pauses by trigger
sudo bpftrace -e 'usdt:/.../libjvm.so:hotspot:gc__begin { @gc = count(); }'
```

**CPython** (built `--with-dtrace`):

```bash
# Trace Python function entries with module + function name
sudo bpftrace -e '
usdt:/usr/bin/python3:python:function__entry {
    printf("%s:%s\n", str(arg1), str(arg2));
}'
```

USDT gives you semantically meaningful events ("a GC started," "a Python function was entered") that a raw uprobe on `libjvm` internals never could — and they don't break when the runtime is patched.

---

## Code Examples

### 1. Syscall latency by syscall name (top offenders)

```bash
sudo bpftrace -e '
tracepoint:raw_syscalls:sys_enter { @start[tid] = nsecs; }
tracepoint:raw_syscalls:sys_exit /@start[tid]/ {
    @ns[probe] = sum(nsecs - @start[tid]);
    delete(@start[tid]);
}'
```

### 2. Per-process read-latency histogram (your service)

```bash
sudo bpftrace -e '
kprobe:vfs_read /comm == "myservice"/ { @s[tid] = nsecs; }
kretprobe:vfs_read /@s[tid]/ {
    @us = hist((nsecs - @s[tid]) / 1000);   // microseconds
    delete(@s[tid]);
}'
```

### 3. uprobe with arguments on your own binary

```bash
# Suppose handleRequest(int routeId, char *path)
sudo bpftrace -e '
uprobe:./myapp:handleRequest { printf("route=%d path=%s\n", arg0, str(arg1)); }'
```

### 4. Capture user + kernel stack on slow reads

```bash
sudo bpftrace -e '
kretprobe:vfs_read /(nsecs - @s[tid]) > 10000000/ {
    @slow[ustack, kstack] = count();
}'
```

### 5. A minimal BCC program (Python front-end, C kernel side)

```python
from bcc import BPF

prog = r"""
BPF_HASH(counts, u32);            // a map keyed by PID

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 zero = 0, *val;
    val = counts.lookup_or_try_init(&pid, &zero);
    if (val) (*val)++;            // verifier-mandated NULL check
    return 0;
}
"""

b = BPF(text=prog)
print("Tracing openat()... Ctrl-C to end.")
try:
    b.trace_print()              # not used; we read the map below
except KeyboardInterrupt:
    pass
for k, v in sorted(b["counts"].items(), key=lambda kv: kv[1].value):
    print(f"pid={k.value:6d}  opens={v.value}")
```

Note the `if (val)` guard — that's the verifier's NULL-check requirement, in real code.

### 6. Find what's exec'ing (the readable, scoped version)

```bash
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_execve {
    printf("%-8d %-16s %s\n", pid, comm, str(args->filename));
}'
```

---

## bpftrace vs BCC vs libbpf

| | **bpftrace** | **BCC** | **libbpf + CO-RE** |
|---|---|---|---|
| Form | one-liners / short scripts | Python (or C++) + C kernel code | C, compiled to a portable object |
| Best for | ad-hoc investigation | custom tools, prototyping | production-grade, shippable tools |
| Compiles on target? | yes (needs headers/BTF) | yes (ships LLVM/Clang) | **no** — compile once, run everywhere |
| Startup cost | seconds | seconds (compiles at runtime) | instant (already compiled) |
| Where you'll meet it | incidents | bcc-tools (`execsnoop` etc.) | distributed agents (senior level) |

The progression mirrors maturity: **bpftrace to find the answer, BCC to prototype a tool, libbpf+CO-RE to ship it.** The senior level covers CO-RE in depth.

---

## Use Cases

- **"Which syscall is eating the latency budget?"** Syscall-latency-by-name one-liner.
- **"Who is opening this file and getting permission-denied?"** `enter`/`exit` join capturing `args->ret`.
- **"My JVM has random pauses."** USDT `hotspot:gc__begin`/`gc__end` to time GC, no JVM flags-fishing.
- **"This Go service is slow on one route."** uprobe on the handler with `arg0` route id.
- **"What's the call stack when reads go slow?"** `ustack`/`kstack` keyed by a latency predicate.

---

## Coding Patterns

- **Enter/exit join by `tid`** for any "what happened across a call" question; always `delete()`.
- **Per-CPU maps for hot counters** to avoid lock contention; bpftrace's built-in aggregations already do this.
- **Predicate early** (`/comm == "x"/`, `/pid == $1/`) so expensive work only runs for your target.
- **Aggregate by stack** (`@[ustack] = count()`) to turn raw events into a ranked culprit list.
- **Use `lookup_or_try_init` in BCC** and check the result — it satisfies the verifier and avoids races.

---

## Clean Usage

- **Pass the PID as an argument** (`bpftrace script.bt 1234`, read with `$1`) instead of hardcoding.
- **Name maps for their contents and units** — `@read_us`, not `@`.
- **Keep one-liners as files once they grow past a line** — `.bt` files are readable and reusable.
- **Comment the function signature** above any `arg0`/`arg1` use, so the next person knows what the positions mean.

---

## Best Practices

- **Estimate event frequency before attaching.** A probe on `sys_enter` (every syscall) needs a cheap action; a probe on your once-per-request handler can afford more.
- **Aggregate in-kernel; reach for a ring buffer only for genuine per-event needs.**
- **Prefer the ring buffer over the perf buffer** on 5.8+ kernels.
- **Confirm the symbol/probe exists** with `bpftrace -l` before relying on a kprobe/uprobe.
- **Trace in production with a target filter and a time limit**, and watch the box's own load while you do.

---

## Edge Cases & Pitfalls

- **`sys_enter`/`sys_exit` argument mismatch** — arguments are on enter, return code on exit; people attach to the wrong one and get nulls.
- **uprobe on an inlined/optimized function** — the symbol may not exist or may fire at unexpected times; `-O2` can inline your target away.
- **Dropped events under load** — perf buffers drop; if counts look low, you may be losing events, not seeing fewer.
- **USDT not present** because the runtime wasn't built with it (`--with-dtrace`, JVM probe build) — the probe simply won't list.
- **`str()` length limits** — bpftrace truncates strings at a fixed size; long paths get cut.

---

## Common Mistakes

- **Doing `printf` per event on a hot probe** and slowing the box you're trying to diagnose.
- **Keying enter/exit maps by `pid`** and corrupting timing when threads overlap — use `tid`.
- **Not NULL-checking a BCC map lookup** and getting a verifier rejection (or worse, on old kernels, a crash).
- **Assuming a kprobe is portable** — shipping a tool built on kprobes that breaks on the customer's kernel.
- **Forgetting `delete()`** and slowly leaking map entries on a long-running trace.

---

## Tricky Points

- **`profile:hz:99` vs an event probe.** Profiling samples at a fixed rate regardless of events — great for "where is CPU going," useless for "what happened on this syscall."
- **A kretprobe sees `retval`, but not the args** — the arguments are gone by return time. Stash them on entry if you need both.
- **Per-CPU map reads are summed**, so a single key can appear to "jump" as different CPUs are aggregated — expected, not a bug.
- **USDT probe arguments are positional and typed by the author** — read the runtime's probe documentation; `arg1`/`arg2` meaning varies per probe.

---

## Test Yourself

1. Walk through what happens between typing `bpftrace -e '...'` and the first event firing.
2. Why does the verifier force a NULL check after a map lookup?
3. When do you need a ring buffer instead of just a map?
4. Where do a syscall's *arguments* live, and where does its *return code* live?
5. Why key the entry/exit map by `tid` rather than `pid`?
6. Give one reason to choose USDT over a uprobe for tracing the JVM.
7. When would you reach for libbpf+CO-RE instead of bpftrace?

---

## Tricky Questions

<details>
<summary>My BCC program won't load: "invalid mem access 'map_value_or_null'". What's wrong?</summary>

You used the result of `bpf_map_lookup_elem` (or `map.lookup`) without checking it for NULL. The lookup returns NULL when the key is absent, and dereferencing NULL in the kernel would panic — so the verifier rejects the program. Add `if (!val) return 0;` (or use `lookup_or_try_init` and still check). The verifier is demanding proof you handle the absent-key case.
</details>

<details>
<summary>I attached a kretprobe to capture both the function's argument and its return value, but the argument is garbage. Why?</summary>

By the time a function *returns*, its arguments are no longer guaranteed to be in registers — they may be clobbered. `kretprobe`/`uretprobe` give you `retval` reliably but not args. Capture the argument on the **entry** probe, stash it in a map keyed by `tid`, and read it back on return.
</details>

<details>
<summary>Counts from my high-frequency probe look suspiciously low under load. Bug in my script?</summary>

Possibly not — if you're streaming per-event records through a **perf buffer**, it can *drop* events when user-space can't keep up, so you undercount. Switch to in-kernel aggregation (`count()`), or use a **ring buffer** (5.8+) which has lower overhead and reports drops explicitly.
</details>

---

## Cheat Sheet

```bash
# Discover probes and their fields
sudo bpftrace -l 'tracepoint:syscalls:*'
sudo bpftrace -lv 'tracepoint:syscalls:sys_enter_openat'
sudo bpftrace -l 'usdt:/path/to/binary:*'

# Args + return joined by tid
sudo bpftrace -e '
t:syscalls:sys_enter_openat { @f[tid]=str(args->filename); }
t:syscalls:sys_exit_openat /@f[tid]/ { printf("%s=%d\n",@f[tid],args->ret); delete(@f[tid]); }'

# Per-process latency histogram
sudo bpftrace -e '
k:vfs_read /comm=="myservice"/ { @s[tid]=nsecs; }
kr:vfs_read /@s[tid]/ { @us=hist((nsecs-@s[tid])/1000); delete(@s[tid]); }'

# Stack aggregation
sudo bpftrace -e 'profile:hz:99 /comm=="myservice"/ { @[ustack] = count(); }'

# uprobe with args (know the signature!)
sudo bpftrace -e 'uprobe:./myapp:handleRequest { printf("%d %s\n", arg0, str(arg1)); }'
```

| Accessor | Available in | Gives you |
|---|---|---|
| `args->field` | tracepoint, USDT | named fields |
| `arg0..argN` | kprobe, uprobe | positional args (entry only) |
| `retval` | kretprobe, uretprobe | return value |
| `ustack` / `kstack` | any | user / kernel call stack |
| `comm`, `pid`, `tid`, `nsecs` | any | context |

---

## Summary

eBPF compiles your tracing program to bytecode, **verifies** it can't crash the kernel, **JIT**s it to native code, and runs it in kernel context on every event — writing results to **maps**. That pipeline explains the craft: **aggregate in maps (cheap), stream through ring/perf buffers only when you need each event (expensive)**, and treat verifier rejections as bugs it caught for you. The mid-level leap is capturing **arguments and return values** — `args->field`, `arg0`, `retval` — joined across **entry and exit by `tid`**, which turns counting into understanding. You can now trace your **own production service** with uprobes, lean on **USDT** in the JVM and CPython for stable semantic events, and choose between **bpftrace** (investigate), **BCC** (prototype), and **libbpf+CO-RE** (ship). Done right — scoped to a target, time-limited, frequency-aware — you diagnose a live system without making it worse.

---

## What You Can Build

- A reusable `.bt` script that takes a PID and prints a live latency histogram for your service's hot path.
- A "permission-denied finder" that shows every failed `openat`/`connect` with the offending process and target.
- A small BCC tool that counts a custom event in your binary via uprobe, with a NULL-safe map.
- A JVM GC-pause tracer built entirely on HotSpot USDT probes, no JVM restart needed.

---

## Further Reading

- *BPF Performance Tools* — Brendan Gregg, the chapters on bpftrace internals, maps, and USDT.
- *Learning eBPF* — Liz Rice, the verifier, maps, and ring buffers chapters.
- The **bpftrace** reference guide (built-ins, probe types, map functions).
- The **BCC** reference and tools source — read `opensnoop`/`biolatency` to see real map and buffer use.
- The **observability-stack** and **profiling-techniques** skills for context.

---

## Related Topics

- [Continuous Profiling](../continuous-profiling/) — the same `profile:hz` sampling and stack aggregation, made always-on.
- [Tracing](../tracing/) — where uprobes/USDT can fill gaps your in-app spans don't cover.
- [Metrics](../metrics/) — what your aggregated probe data should become if you need it permanently.
- [Logging](../logging/) — the complement; dynamic tracing answers what logs didn't anticipate.
- [Debugging](../debugging/) — the discipline these probes serve.
- [Observability Engineering](../observability-engineering/) — fitting dynamic tracing into a strategy.

---

## Diagrams & Visual Aids

**The eBPF run pipeline:**

```
 source ─▶ bytecode ─▶ VERIFIER ─reject─▶ ✗
                          │accept
                          ▼
                        JIT ─▶ native ─▶ attach ─▶ [event] ─▶ run ─▶ MAP
                                                                       │
                                                  user-space ◀─ read / ring-buffer drain
```

**Enter/exit join (the latency pattern):**

```
   sys_enter_openat        sys_exit_openat
   ───────┬────────        ───────┬────────
   @f[tid] = filename  ───▶  read @f[tid], args->ret
                             delete @f[tid]
        (keyed by TID so overlapping threads don't collide)
```

**Cheap vs expensive data paths:**

```
  count()/hist()  ──▶  kernel MAP  ──▶  printed once on Ctrl-C     (cheap)
  printf() per event ─▶ RING/PERF BUFFER ─▶ user-space per event   (expensive)
```
