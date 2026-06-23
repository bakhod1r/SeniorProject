# Debugging Roadmap

> *"Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are, by definition, not smart enough to debug it."* — Brian Kernighan

This roadmap is about **the craft of finding and fixing bugs** — the systematic discipline, the tools, and the language-specific debuggers that every working programmer relies on.

> Looking for runtime/performance bottlenecks rather than functional bugs? See [Performance](../../quality-engineering/performance/README.md) for profiling and benchmarking.
>
> Looking for the *methodology* (binary search through a problem, hypothesis-first thinking, reading errors carefully)? Pair this roadmap with the [`systematic-debugging`](../../../../skills/) skill.

---

## Why a Dedicated Roadmap

Most "debugging" content lives inside a specific language's docs (gdb chapter for C, dlv for Go, pdb for Python, IntelliJ debugger for Java). This roadmap **unifies the discipline** across languages — the underlying techniques transfer, the tools differ.

| Roadmap | Question it answers |
|---|---|
| [Clean Code](../../code-craft/clean-code/README.md) | How do I write code that's easy to reason about? |
| [Refactoring](../../code-craft/refactoring/README.md) | How do I fix code that already smells? |
| [Testing](../../quality-engineering/testing/README.md) | How do I prove code works? |
| **Debugging** (this) | How do I find out *why* code doesn't work, fast? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Mindset & Methodology | Hypothesis-first thinking, binary search, reading errors, rubber-ducking |
| 02 | Print-Debugging Done Right | When `printf` is the correct tool, structured trace logs, conditional prints |
| 03 | Interactive Debuggers | Breakpoints, stepping, watchpoints, conditional breaks, reverse debugging |
| 04 | Per-Language Debuggers | `gdb` / `lldb` (C/C++/Rust), `dlv` (Go), `pdb` / `ipdb` (Python), JDB / IntelliJ (Java) |
| 05 | Core Dumps & Post-Mortem | Generating and reading crash dumps, `coredumpctl`, symbol files |
| 06 | Production Debugging | Live debugging with eBPF, `strace`, `dtrace`, sampling without stopping the world |
| 07 | Memory Bugs | ASan, MSan, Valgrind, leak detection, use-after-free, double-free |
| 08 | Concurrency Bugs | Race detector (Go, Rust, ThreadSanitizer), deadlock analysis, lock ordering |
| 09 | Distributed Debugging | Correlation IDs, distributed tracing, replaying production traffic |
| 10 | Heisenbugs & Flaky Tests | Bugs that disappear under observation, sources of non-determinism, reproduction strategies |

---

## Languages

All examples in **Go**, **Java**, and **Python** — same bug, different debuggers — to highlight what transfers and what doesn't.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Debugging: The 9 Indispensable Rules for Finding Even the Most Elusive Software and Hardware Problems* — David J. Agans
- *Why Programs Fail: A Guide to Systematic Debugging* — Andreas Zeller
- *The Art of Debugging with GDB, DDD, and Eclipse* — Norman Matloff, Peter Jay Salzman

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
