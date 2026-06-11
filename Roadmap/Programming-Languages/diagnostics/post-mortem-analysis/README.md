# Post-Mortem Analysis Roadmap

> *"The dead process can still tell you what killed it — if you know how to listen."*

This roadmap is about **analysing a process after it has died (or been deliberately frozen for inspection)** — core dumps, heap dumps, thread dumps, JFR recordings, eBPF traces saved offline. The "open the body and look" complement to live debugging.

> Looking for *live* introspection of a running process (`/debug/pprof`, JMX, py-spy)? See [Diagnostic Endpoints](../diagnostic-endpoints/).
>
> Looking for *interactive* debugging with a debugger attached? See [Debugging](../debugging/).
>
> Looking for the *human* post-mortem (incident write-up, blameless culture)? That belongs in the Soft-Skills / SRE tracks, not this one — this is the *technical* artefact side.

---

## Why a Dedicated Roadmap

Live debugging fails when:

- The crash happens once a week at 3 a.m. — you can't repro it interactively
- The bug only reproduces with production traffic
- The process is gone by the time you log in
- The state at crash time is gone the moment the process restarts

The skill is **collecting the corpse cheaply at the time of death**, then doing the heavy analysis offline. Every language and runtime has its own format and tooling — and the cost/quality trade-offs differ wildly.

| Roadmap | Question it answers |
|---|---|
| [Debugging](../debugging/README.md) | What's the live state? |
| [Diagnostic Endpoints](../diagnostic-endpoints/README.md) | What's the *running* state, exposed via API? |
| **Post-Mortem Analysis** (this) | What was the state when it died — and can I reconstruct it later? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | When Post-Mortem Beats Live | The diagnostic costs of repro; production-only bugs |
| 02 | Core Dumps | What's in one, generating them (`ulimit -c`, `/proc/sys/kernel/core_pattern`), reading with `gdb` |
| 03 | Heap Dumps | Java `.hprof`, Python `gc.get_objects` + heapy, Go `runtime.WriteHeapDump`, .NET `.dmp` |
| 04 | Thread / Goroutine Dumps | `jstack`, SIGQUIT, `runtime.Stack`; reading them, finding the deadlock |
| 05 | Java Flight Recorder | JFR recordings, what they capture, opening with Mission Control |
| 06 | eBPF Captures | `perf record`, `bpftrace` outputs, off-CPU profiling saved offline |
| 07 | Crash Dumps on Mobile | iOS `.ips`, Android `tombstone`, symbol files |
| 08 | Analysis Tools | `gdb`, Eclipse MAT, VisualVM, `dlv core`, `pyflame --dump`, `pprof` reading |
| 09 | Symbolication | Why a dump without symbols is half-useless; `dSYM`, `pdb`, build-id matching |
| 10 | Offline Reproduction | When a dump *is* the bug report; replaying request from captured state |
| 11 | Cost & Storage | Dumps are big; what to keep, how long, how to triage |
| 12 | Anti-patterns | No `ulimit -c`, no symbol upload, throwing away dumps before triage, dump-on-every-error |

---

## Languages

Examples in **Java** (heap dumps, `jcmd`, JFR, MAT), **Go** (`runtime.WriteHeapDump`, `dlv core`), **Python** (`faulthandler`, heapy), **C / C++** (core dumps + gdb), **mobile** (iOS / Android crash artefacts).

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Java Performance: The Definitive Guide* — Scott Oaks (heap analysis chapters)
- *The Linux Programming Interface* — Michael Kerrisk (signals, core dumps)
- *Systems Performance* — Brendan Gregg
- *Debugging with GDB* — official manual
- Eclipse MAT documentation

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
