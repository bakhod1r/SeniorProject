# Dynamic Instrumentation & eBPF Roadmap

> *"The best question to ask a production system is the one you didn't think to ask before it shipped."*

This roadmap is about **observing a running, unmodified program — or the kernel itself — without changing its source, recompiling it, or restarting it.** Traditional observability is *pre-paid*: you only see the log, metric, or span you had the foresight to add. Dynamic instrumentation is *pay-as-you-go*: you attach a probe to a live binary or syscall at the moment you need an answer, and detach it when you're done. **eBPF** is the modern engine that makes this safe enough to do in production.

> Looking for the *aggregate* signals a service emits on purpose? See [Metrics](../metrics/).
>
> Looking for *CPU/heap flame graphs over time*? See [Continuous Profiling](../continuous-profiling/) and the **profiling-techniques** skill.
>
> This section is the **runtime-attach** discipline — answering the unknown-unknowns of a system you cannot pause, redeploy, or reproduce.

---

## Why a Dedicated Roadmap

Every engineer can add a log line and ship it. Far fewer can walk up to a process that is misbehaving *right now*, attach a probe, and read the answer off a live histogram — then leave the binary untouched. That skill is the difference between "let me add logging and wait for it to recur" and "here's the offending syscall, captured in the last ninety seconds."

| Approach | When the instrumentation was decided | Requires redeploy? | Answers unforeseen questions? |
|---|---|---|---|
| Logs / Metrics / Traces | **Ahead of time**, in source | Yes — to add a new field | No — only what you pre-instrumented |
| **Dynamic instrumentation (this)** | **At the moment you ask** | No — attach to the live process/kernel | **Yes** — that is the entire point |

The premise in one line: **static observability shows you the questions you anticipated; dynamic instrumentation lets you ask new ones of an unmodified, running system.** eBPF earns the "production-safe" qualifier because its programs run in a kernel-verified, sandboxed VM that *cannot* crash the host — unlike the loadable kernel modules and `ptrace` hacks it replaced.

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | The Premise | Pre-paid vs pay-as-you-go observability; unknown-unknowns; no redeploy |
| 02 | kprobes & kretprobes | Attach to *any* kernel function's entry/exit; capture args & return values |
| 03 | uprobes & uretprobes | Same, for user-space functions in an unmodified binary |
| 04 | Tracepoints | Stable, kernel-maintained hooks (`syscalls:`, `sched:`, `block:`) |
| 05 | USDT / Static Probes | dtrace-style probes baked into the JVM, Python, Node, Postgres, libc |
| 06 | perf events | Hardware/software counters, sampling, the `perf` tool lineage |
| 07 | What eBPF Is | A safe, verified, JIT-compiled VM running tiny event-driven programs in-kernel |
| 08 | The Verifier | Why eBPF can't crash the kernel — bounded loops, memory & type safety |
| 09 | eBPF Maps & Ring Buffers | The data plane: sharing state and streaming events kernel↔user-space |
| 10 | CO-RE & BTF | "Compile once, run everywhere" across kernel versions |
| 11 | The Tooling | bpftrace one-liners, BCC tools, libbpf, `perf`; DTrace & SystemTap lineage |
| 12 | Production-Safe Tracing | Overhead, `CAP_BPF`, containers/k8s, governance, and the honest limits |

> These are **conceptual sub-topics**, not folders. The full treatment lives across the six tier files below.

---

## Languages

Probes attach to **any** language's compiled artifact. Examples use **bpftrace** (the one-liner DSL), **C** (BCC and libbpf programs), and USDT probes in the **JVM**, **Python** (`libpython` / `sys.monitoring`), **Node**, and **Go** binaries. The kernel side is language-agnostic; the verifier sees only eBPF bytecode.

---

## Platforms

**Linux is the home of eBPF** (kernel 4.x+, CO-RE needs BTF and roughly 5.2+). Its intellectual ancestor **DTrace** runs on Solaris/illumos, FreeBSD, and macOS; **SystemTap** is the older Linux predecessor. Windows has an emerging eBPF-for-Windows port. This roadmap is honest that the production sweet spot is modern Linux.

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *BPF Performance Tools* — Brendan Gregg (the definitive catalog of bpftrace/BCC tools)
- *Systems Performance* — Brendan Gregg (the methodology around the tools)
- *Learning eBPF* — Liz Rice (the programming model, verifier, and CO-RE)
- *Linux Observability with BPF* — Calavera & Fontana
- The **bpftrace** and **BCC** repositories — the canonical one-liner and tool catalogs

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
