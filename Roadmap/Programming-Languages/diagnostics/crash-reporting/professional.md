# Crash Reporting — Professional (Staff / Principal) Level

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** You are no longer a consumer of a crash service — you **operate the pipeline**. Ingesting minidumps at fleet scale, running a symbol server, controlling cardinality and cost, alerting on crash *regressions* (not crashes), the async-signal-safety internals of Crashpad/Breakpad, and the replay/deobfuscation infrastructure that turns a 4KB minidump back into a stack trace you can read. The senior page made crash reporting a system you operate; this page is **how that system is actually built and run.**

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Mental Models](#mental-models)
6. [Async-Signal-Safety — The Internals](#async-signal-safety--the-internals)
7. [Minidump Generation — Crashpad & Breakpad Internals](#minidump-generation--crashpad--breakpad-internals)
8. [The Symbol Server — Storing and Serving Debug Info at Fleet Scale](#the-symbol-server--storing-and-serving-debug-info-at-fleet-scale)
9. [The Symbolication Pipeline](#the-symbolication-pipeline)
10. [Operating the Ingest Pipeline](#operating-the-ingest-pipeline)
11. [Cardinality & Cost Control](#cardinality--cost-control)
12. [Alerting on Crash Regressions](#alerting-on-crash-regressions)
13. [Replay & Deobfuscation Infrastructure](#replay--deobfuscation-infrastructure)
14. [Build / Buy / Self-Host](#build--buy--self-host)
15. [Code Examples](#code-examples)
16. [A Worked Pipeline Build-Out](#a-worked-pipeline-build-out)
17. [Failure Stories](#failure-stories)
18. [Pros & Cons](#pros--cons)
19. [Use Cases](#use-cases)
20. [Coding Patterns](#coding-patterns)
21. [Clean Code](#clean-code)
22. [Best Practices](#best-practices)
23. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Tricky Points](#tricky-points)
26. [Anti-Patterns at Professional Level](#anti-patterns-at-professional-level)
27. [Test Yourself](#test-yourself)
28. [Tricky Questions](#tricky-questions)
29. [Cheat Sheet](#cheat-sheet)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At junior level you read a report. At middle level you wired an SDK and uploaded symbols. At senior level you ran the crash-free SLO as a ship/halt gate and learned why a signal handler must never `malloc`. **At staff/principal level you build and operate the machine that does all of it** — the ingest tier that swallows ten million minidumps a day without falling over, the symbol server that holds 400GB of DWARF keyed by build ID, the symbolication workers that turn binary frames into source lines, the cost controls that keep one crash-loop from costing $40,000, and the regression detector that pages someone only when a *new* bug appears — not when an old one fires for the millionth time.

This page assumes the senior page entirely and does not repeat it. The senior page told you *that* Crashpad runs out-of-process and *that* you symbolicate by build ID and *that* you should sample handled exceptions and never fatal crashes. This page tells you **how Crashpad's out-of-process handler is actually wired** (the `WriteMinidumpToDatabase` / IPC dance, the exception-port plumbing on each OS), **how a symbol server stores and serves debug info** (CAS layout, build-ID keying, GCS/S3 economics), **how symbolication is parallelized and cached**, **how to keep ingest from collapsing under a crash storm**, **how cardinality explodes and how to bound it**, and **how to alert on the second derivative of a crash curve instead of its value.**

The reference systems are real and worth studying directly: **Crashpad** and **Breakpad** (Chromium), **Sentry's `symbolicator`** (Rust, open source), **Microsoft's `SymSrv`/`symbol-server` protocol**, **Backtrace/Sauce Labs' coroner**, **Apple's `symbolicatecrash` and the `.dSYM`/`atos` toolchain**, and **Google's `debuggerd`/`tombstoned`** on Android. Everything here is downstream of how those are actually built.

> If `senior.md` is "crash reporting is a system you operate," `professional.md` is "**here is the system, opened up, with the lid off** — and here is the bill, the on-call burden, and the three places it will fall over at 3am."

---

## Prerequisites

- **Everything in [`senior.md`](senior.md)** — signal-handler safety as a *rule*, the crash-free SLO, release-health gating, fingerprint-as-contract, the mobile/backend split, the existence of minidumps and symbol servers. This page does not re-teach any of it.
- **Comfort operating a stateful data pipeline** — Kafka/Kinesis ingestion, object storage (S3/GCS) economics, a columnar store (ClickHouse/BigQuery), and the SRE discipline for all three. See [`../observability-engineering/professional.md`](../observability-engineering/professional.md).
- **Native toolchain fluency** — DWARF, PDB, Mach-O `.dSYM`, ELF `.note.gnu.build-id`, what `dump_syms` produces, how `addr2line`/`atos`/`llvm-symbolizer` work.
- **Cardinality and sampling at the cost layer.** See [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) — the dollar dimension of everything here.
- **Anomaly-detection basics** — z-scores, EWMA, change-point detection — enough to alert on a *regression* rather than a threshold. See [`../metrics/professional.md`](../metrics/professional.md).
- **Memory-corruption fluency** — you must understand *why* a heap is corrupt at SIGSEGV time to understand why the handler is written the way it is. See [`../debugging/professional.md`](../debugging/professional.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **CAS** | Content-Addressed Storage. Files keyed by a hash (or build ID) of their content; the symbol server's natural layout. |
| **Build ID / GNU build-id / Code ID** | A unique identifier embedded in a binary at link time (ELF `.note.gnu.build-id`, Mach-O UUID, PE `CodeView` GUID+age). The join key between a minidump and its symbols. |
| **Debug ID** | Breakpad/Sentry's normalized 33-hex-char identifier derived from the build ID, used as the symbol-server lookup key. |
| **`symbolicator`** | Sentry's open-source Rust service that takes a raw stack trace + module list and returns symbolicated frames, fetching debug files from configured symbol sources. |
| **`minidump_stackwalk`** | Breakpad's CLI that walks a minidump's stacks using `.sym` files and emits a human-readable trace. The reference symbolicator. |
| **Stackwalking** | Reconstructing the call stack from a raw stack memory dump + register state, using CFI (call frame information) or frame-pointer heuristics. |
| **CFI** | Call Frame Information — DWARF `.debug_frame`/`.eh_frame` (or Breakpad `STACK CFI` records) describing how to unwind each instruction range. Essential for FP-omitted optimized code. |
| **`.sym` file** | Breakpad's textual symbol format produced by `dump_syms` from DWARF/PDB. Lines: `MODULE`, `FILE`, `FUNC`, `PUBLIC`, `STACK CFI`. |
| **Symbol source** | A configured place the symbolicator fetches debug files from: an HTTP symbol server, an S3 bucket, GCS, the Microsoft public server, etc. |
| **SymSrv protocol** | Microsoft's convention for laying out a symbol server: `<server>/<filename>/<id>/<filename>`. The de-facto HTTP symbol-server shape. |
| **`debug_meta` / image list** | The list of loaded modules (name, build ID, load address, size) shipped with an event so the backend knows which symbols to fetch. |
| **Tombstone** | Android's native crash dump from `debuggerd`/`tombstoned`, written to `/data/tombstones`. A pre-symbolicated (on newer Android) or raw native trace. |
| **`exception_handler` / exception port** | The OS mechanism Crashpad hooks: a Mach exception port (macOS/iOS), a `SetUnhandledExceptionFilter` (Windows), or a `sigaction` chain (Linux/Android). |
| **`ptrace`-based capture** | Linux Crashpad's model: the handler process `ptrace`s (or reads `/proc/<pid>/mem` via the `PTRACE_ATTACH`/`process_vm_readv`) the crashed process to snapshot it. |
| **`PR_SET_PTRACER`** | The `prctl` a Linux process calls so a sibling Crashpad handler is permitted to `ptrace` it under Yama. |
| **Spool / database** | Crashpad's on-disk store of pending and completed minidumps (`pending/`, `completed/`, `new/`), uploaded asynchronously. |
| **Regression** | A crash signature whose rate *increased* relative to a baseline, or that is *new in this release*. The thing worth paging on — not the absolute count. |
| **Deobfuscation** | Reversing R8/ProGuard/DexGuard (Android) or a name-mangling scheme so an obfuscated frame `a.b.c()` becomes `com.app.Checkout.scan()`. Requires the per-build mapping file. |
| **Mapping file** | R8/ProGuard `mapping.txt` (or an iOS bitcode/`dSYM`) that records the obfuscation transform for one specific build. Keyed by `UUID`/version. |
| **Reprocessing** | Re-running symbolication/grouping over already-ingested events after symbols or grouping rules arrive late. |
| **Source context** | The few source lines around a frame, attached at symbolication time from a source bundle for in-context display. |
| **Source bundle** | A zip of source files keyed by debug ID, uploaded so the backend can show source context without your repo. |

---

## Core Concepts

### 1. The pipeline is a stateful streaming system with a hard tail-latency constraint

A crash report is not a log line. It is an *event with a deadline*: a minidump that must be received, stored, symbolicated, grouped, deduplicated, counted into release-health, and made queryable — and the whole chain must keep flowing during the exact moments it is under the most load (a bad release). You are operating a streaming system whose **input rate is correlated with the badness of your own software.** That coupling — load spikes precisely when you most need the system working — is the defining operational property and it dictates every design choice below.

### 2. Symbolication is the expensive, cacheable heart

Receiving a minidump is cheap. *Symbolicating* it — fetching the right DWARF/PDB (possibly hundreds of MB) for each of dozens of loaded modules, walking the stack with CFI, mapping addresses to functions and source lines — is by far the most expensive operation in the pipeline, often 100–1000× the cost of ingest. It is also the most *cacheable*: the same build crashes the same way millions of times. The entire economic viability of an at-scale crash pipeline rests on **caching symbol fetches and symbolication results aggressively**, and on never symbolicating the same `(module, build_id, address)` twice.

### 3. Cardinality is the silent cost bomb

A crash event has a fingerprint, a release, an OS version, a device model, and N tags. The product of those dimensions is your storage and query cost. A naive design that puts a per-request ID, a device serial, or a raw memory address into a tag explodes cardinality into the billions, and your columnar store's compression collapses. **Bounding cardinality at ingest — not at query time — is a first-class job**, and it is the same discipline as in metrics (see [`../metrics/professional.md`](../metrics/professional.md)) but with a crash-specific failure mode: an unbounded fingerprint.

### 4. You alert on the derivative, not the value

A mature service crashes constantly — thousands of times a day across known, triaged, won't-fix-this-quarter issues. Paging on absolute crash count is alert spam. The professional signal is **regression**: a *new* signature, or an *existing* signature whose rate jumped relative to its own baseline and to release adoption. The alerting system's job is to compute the second derivative of the crash curve per signature and surface only the deltas.

### 5. The handler internals are where correctness actually lives

The senior page said "use Crashpad, don't hand-roll the handler." The staff engineer who *operates* the native pipeline must understand the handler's internals anyway — because when capture *fails* (no dump, truncated dump, dump that won't symbolicate), the fix is inside the exception-port plumbing, the `ptrace` permissions, the `sigaltstack` sizing, or the `WriteMinidump` path. You cannot debug a pipeline whose first stage you treat as a black box.

### 6. Late-arriving symbols and rules force reprocessing as a core feature

Symbols upload from CI; events arrive from the field. These races are normal: an event can arrive *before* its symbols (CI was slow), or a grouping rule changes *after* a million events are already grouped. A real pipeline must **reprocess** — re-symbolicate and re-group historical events when the inputs they needed arrive late or change. Reprocessing is not an edge case; it is a designed-in batch path that runs constantly.

---

## Mental Models

### Model 1: The pipeline as a refinery, symbolication as the cracking tower

Crude minidumps come in at the front (cheap, dense, unreadable). The refinery's expensive stage — symbolication — *cracks* them into readable, queryable products. The cracking tower is the bottleneck and the cost center; everything before it (ingest, store) is plumbing sized to never starve it, and everything after it (grouping, release-health, query) consumes its output. When you optimize the pipeline, you optimize the cracking tower: cache its inputs (symbol fetches), cache its outputs (per-`(module,addr)` results), and parallelize it horizontally. The plumbing rarely limits you; the tower always does.

```text
   INGEST            STORE             SYMBOLICATE (the tower)        GROUP        SERVE
   ──────            ─────             ──────────────────────        ─────        ─────
   raw minidump ─►   object store ─►   fetch DWARF/PDB by build-id ─► fingerprint ─► query
   (cheap)           (cheap)           walk stack w/ CFI              (cheap)       (cheap)
                                       addr → func → file:line
                                       ▲ CACHE HERE OR DIE ▲
```

### Model 2: The build ID as the universal join key

Every hard problem in this pipeline reduces to a join on build ID. The minidump records *which* binaries were loaded and *which* build of each. The symbol server stores debug files keyed by that same ID. Symbolication is literally a join: for each frame's module, look up the matching debug file. Get the key right (stable, embedded at link time, propagated through every step) and the whole pipeline composes; get it wrong (a build that didn't emit a build ID, a stripped binary, a symbol upload keyed by version string instead of build ID) and you have an unsymbolicatable minidump — a 4KB blob you can store forever and never read.

### Model 3: Two clocks — the field clock and the CI clock

Events flow on the *field clock* (when users crash). Symbols and mapping files flow on the *CI clock* (when builds are made). These clocks are not synchronized and the field clock can *precede* the CI clock for a given build (a beta tester crashes before the release pipeline finished uploading symbols). The pipeline must tolerate either order. The reprocessing system exists precisely to reconcile the two clocks: when the slow clock finally delivers, replay the events that arrived too early.

---

## Async-Signal-Safety — The Internals

The senior page gave you the *rule* (async-signal-safe only; `write`/`_exit` yes, `malloc`/`printf`/locks no) and the *three designs* (in-process write-only, out-of-process, `sigaltstack`). The staff engineer needs the *mechanism*: **why** these are unsafe, and **how** a correct handler is actually constructed when you can't avoid touching it.

### Why `malloc` is a landmine — the allocator lock

`malloc` is not reentrant because the allocator keeps a global (or per-arena) free list protected by a lock. When a thread is inside `malloc` holding that lock and takes a SIGSEGV (e.g. from heap corruption *that malloc itself just tripped over*), the signal handler runs **on that same thread, with the lock still held.** If the handler calls `malloc`, it blocks on a lock its own thread owns → deadlock. The process doesn't crash; it *hangs*. glibc's `malloc` uses `__libc_lock`-style mutexes per arena; jemalloc and tcmalloc have their own per-thread caches plus a central lock with the same hazard. There is no allocator that makes `malloc`-in-handler safe. This is *the* reason out-of-process is the robust answer: a separate process has its own allocator with its own uncontended lock.

### The signal-safe primitive set, concretely

```c
/* The ONLY operations you may rely on in a SIGSEGV/SIGABRT/SIGBUS handler.
   See `man 7 signal-safety` for the full POSIX allowlist. In practice: */

write(fd, buf, n);     /* bare syscall, reentrant            — YES */
_exit(code);           /* bypasses atexit/stdio              — YES */
kill(getpid(), sig);   /* re-raise to default for a core     — YES */
sigaction(...);        /* reset/chain handlers               — YES */
mmap / munmap          /* page-level alloc (no heap lock)    — YES (careful) */
clock_gettime(...);    /* monotonic timestamp                — YES */

/* Everything you actually want is NOT on the list: */
malloc / free / new / std::string   /* allocator lock        — NO */
printf / fprintf / std::cout         /* stdio lock + malloc   — NO */
pthread_mutex_lock                   /* may be the held lock  — NO */
backtrace_symbols                    /* mallocs internally    — NO */
fopen / std::ofstream                /* buffers + malloc      — NO */
```

The practical consequence: a correct in-process handler **pre-allocates everything at install time** — the scratch buffer it writes the dump into, the file descriptor it writes to, the alternate stack. At crash time it only *reads* registers from the `ucontext_t`, *copies* stack bytes into the pre-allocated buffer, and *writes* with the bare syscall. No allocation, no formatting, no locks.

### `mmap` instead of `malloc`

When the handler genuinely needs memory it can't pre-size (rare), `mmap(MAP_ANONYMOUS)` is *page-granularity* allocation that does not touch the heap allocator's lock — it's a direct syscall to the kernel's VM subsystem. Crashpad and Breakpad use exactly this to grab scratch space for serializing a minidump. It is the one "allocation" that's signal-safe, because the kernel's VM lock is not the userspace allocator's lock and is held only briefly inside the syscall.

### The handler runs on a borrowed thread — reentrancy and recursion

The handler interrupts an arbitrary thread at an arbitrary instruction. Two failure modes the staff engineer must design against:

1. **Recursive faults.** If the handler itself faults (e.g. it dereferences corrupt memory while walking the stack), you get a SIGSEGV *inside* the SIGSEGV handler. Without protection this loops or hangs. `SA_RESETHAND` (reset to default after first delivery) and a re-entry guard flag (`static volatile sig_atomic_t in_handler`) are the standard defenses; Crashpad blocks the signal during handling and uses a recursion sentinel.

2. **Multi-thread races.** Two threads can crash near-simultaneously. The handler must serialize (one writes the dump, the others spin or exit) using only `sig_atomic_t` flags and atomic compare-and-swap (`__sync_bool_compare_and_swap`), never a mutex.

```c
static volatile sig_atomic_t handling = 0;

static void handler(int sig, siginfo_t *info, void *uc) {
    /* CAS sentinel: first crasher wins, others exit immediately.
       __atomic / __sync builtins are async-signal-safe (no lock). */
    if (!__sync_bool_compare_and_swap(&handling, 0, 1)) {
        _exit(128 + sig);   /* a sibling is already writing the dump */
    }
    /* ... write minidump from PRE-ALLOCATED buffer to PRE-OPENED fd ... */
    _exit(128 + sig);
}
```

### `sigaltstack` sizing — the gotcha that bites in 2024+

The senior page said register an alternate stack so stack-overflow crashes have somewhere to run. The staff gotcha: `SIGSTKSZ` was a compile-time constant (often 8KB) and is now a *runtime* value on modern glibc (because AVX-512 etc. blew up the minimum). Hard-coding `char stack[SIGSTKSZ]` as a static array can under-size the stack on a machine with wider registers → your handler overflows its own alt stack → silent failure. Modern correct code queries `sysconf(_SC_SIGSTKSZ)` (or `getauxval(AT_MINSIGSTKSZ)`) and `mmap`s the stack at install time. This is a real regression that shipped in crash handlers that worked for a decade.

### Crashpad's answer: do almost nothing in the handler

Crashpad's in-process footprint is deliberately tiny. On the crashing thread, its handler captures the CPU context and then **hands off to a separate handler process** that does the heavy serialization. On Linux that handoff is a `ptrace`/`/proc` snapshot done *by the other process*; on macOS it's a Mach exception message delivered to the handler's exception port; on Windows it's a named-pipe/event signal. The crashing process's job is reduced to "stop, and let the healthy process look at my corpse." That is the whole reason out-of-process is robust: the unsafe work (allocation, serialization, file I/O, upload) happens in a process with a clean heap and uncontended locks.

> The staff takeaway: you still don't hand-roll this — but when capture *fails*, you debug it here. "No dump produced" is almost always one of: alt-stack too small, a non-Crashpad handler stole the signal first (chaining order), `PR_SET_PTRACER` not set under Yama, or the handler process died with the parent. Knowing the mechanism is how you fix capture, not just install it.

---

## Minidump Generation — Crashpad & Breakpad Internals

A minidump is a binary container (the format is Windows-native, `MINIDUMP_HEADER` + a directory of streams) that both Breakpad and Crashpad produce on every platform. Understanding its structure is what lets you debug "the dump symbolicates wrong" and "the dump is truncated."

### Anatomy of a minidump

```text
MINIDUMP_HEADER
  └─ MINIDUMP_DIRECTORY[]  (a list of streams; each is type + RVA + size)
       ├─ ThreadListStream          every thread: TID, context (registers), stack memory range
       ├─ ModuleListStream          every loaded module: name, base addr, size, BUILD ID  ◄── join key
       ├─ MemoryListStream          the raw stack bytes for each thread (the unwinding fuel)
       ├─ ExceptionStream           which signal/exception, faulting address, crashing thread
       ├─ SystemInfoStream          OS, CPU arch, version
       ├─ MemoryInfoStream          VM map (region protections) — used to validate pointers
       ├─ CrashpadInfoStream        Crashpad annotations: app version, custom key/values
       └─ (optional) handle/heap/full-memory streams
```

The two streams that matter most: **ModuleListStream** (carries each module's build ID — without it you cannot symbolicate) and **MemoryListStream** (the actual stack bytes the stackwalker unwinds). A minidump is small (4–64KB typical) precisely because it captures *only the threads' stacks and registers and the module list* — not the full heap. That's the design: enough to reconstruct the call stack, small enough to upload from a phone on cellular.

### Breakpad (in-process) vs Crashpad (out-of-process) — the real difference

| Property | Breakpad | Crashpad |
|---|---|---|
| **Handler location** | In the crashing process, signal handler | Separate handler process |
| **Capture mechanism** | Walks own memory from the signal handler (async-signal-safe code only) | Handler process snapshots the crasher via `ptrace`/`/proc` (Linux), Mach exception port (mac), pipe (Win) |
| **Heap availability** | None — must pre-allocate everything | Full — handler process has a clean heap |
| **Survives handler bugs** | No — a bug in the handler hangs the crasher | Yes — handler bug crashes the *handler*, not the app |
| **Upload** | On next run (in-process writes file; separate code uploads later) | Handler process uploads directly, with retry/backoff |
| **Captures during early init** | Fragile | Robust (handler is already running) |
| **OS support** | Older, gaps on modern macOS | Modern, actively maintained, the default for new work |
| **Used by** | Firefox (historically), many shipping products | Chrome, `sentry-native`, modern native apps |

The decisive advantage of Crashpad is the bolded row: **a bug in your dump-writing code crashes a disposable process instead of hanging your app.** Because writing a minidump is non-trivial (you're serializing thread contexts and reading memory that might be partly corrupt), the chance of a bug in *that* code is real — and out-of-process contains the blast radius.

### How Crashpad writes the dump (Linux, simplified)

```text
   CRASHING PROCESS                          CRASHPAD HANDLER PROCESS
   ────────────────                          ────────────────────────
   1. SIGSEGV delivered                      (already running since startup,
   2. tiny in-proc handler:                   spawned by CrashpadClient::StartHandler)
        - capture CPU context
        - request dump from handler  ──IPC──► 3. ptrace-attach / process_vm_readv
        - (block, then _exit)                    read crasher's threads + stacks + modules
                                              4. build MINIDUMP_* streams in ITS OWN heap
                                              5. write to spool: database/new/<uuid>.dmp
                                              6. move to pending/, upload, move to completed/
                                              7. detach; crasher proceeds to _exit
```

Key files in Crashpad's spool (`CrashReportDatabase`): `new/` (just written), `pending/` (awaiting upload), `completed/` (uploaded), plus `attachments/` and `settings.dat` (client ID, last-upload time for rate control). When you debug "crashes aren't uploading," you inspect this directory on the device: dumps stuck in `pending/` mean upload is failing; nothing in `new/` ever appearing means capture is failing.

### `dump_syms` — turning DWARF/PDB into `.sym`

At build time, `dump_syms` parses your binary's debug info and emits Breakpad's textual `.sym` format. This is the symbol-side of the build-ID join:

```text
MODULE Linux x86_64 1A2B3C4D5E6F0000000000000000000000 myapp
INFO CODE_ID 4D3C2B1A6F5E...
FILE 0 /src/checkout.cc
FUNC 4f30 a0 0 scan(QrFrame const&)        ◄── address range 0x4f30..0x4fd0 → this function
4f30 12 88 0                                ◄── address 0x4f30, len 0x12 → checkout.cc:88
4f42 0e 89 0
PUBLIC 5010 0 fulfill(Order const&)
STACK CFI INIT 4f30 a0 .cfa: $rsp 8 + ...   ◄── how to unwind through this range
STACK CFI 4f34 .cfa: $rsp 16 + ...
```

The `MODULE` line's third field is the **debug ID** — the symbolicator's lookup key. The `STACK CFI` records are what let you unwind optimized, frame-pointer-omitted code; without them you fall back to fragile heuristics. Wire `dump_syms` into CI exactly like source-map upload: per build, gated, non-optional, uploading the `.sym` (or the raw DWARF/PDB) to your symbol server keyed by debug ID. (The senior page told you to do this; here is *what it produces* and *why the CFI records matter*.)

---

## The Symbol Server — Storing and Serving Debug Info at Fleet Scale

This is infrastructure most engineers never see, and it is the single most important piece of an at-scale native crash pipeline. A symbol server is a **content-addressed store of debug files, keyed by build ID, served over HTTP**, fronting object storage.

### The storage layout (SymSrv / Microsoft convention)

The de-facto layout — used by Microsoft's public symbol server, Sentry's symbol sources, and most tooling — is:

```text
<root>/<debug-file-name>/<debug-id>/<debug-file-name>

e.g.  /myapp.so/1A2B3C4D5E6F0000000000000000000000/myapp.so
      /myapp.so/1A2B3C4D5E6F0000000000000000000000/myapp.so.debug
      /ntdll.pdb/8D2A...A1/ntdll.pdb
```

The symbolicator, holding a module name + debug ID from the minidump, constructs this path and does a single `GET`. That's the whole protocol: **a deterministic URL from `(name, build_id)`**. Variants compress (`file.so_` cab/gzip) and add a `index2.txt` for two-tier hashing, but the core is this path convention. Sentry's `symbolicator` supports this plus S3/GCS/HTTP sources with the same keying.

### Sizing and economics

Debug files are *large*. A stripped production binary might be 20MB; its DWARF can be 200MB–2GB. A symbol *server* for a product with many platforms, architectures, and a year of retained builds easily reaches hundreds of GB to multiple TB.

| Decision | Implication |
|---|---|
| **Store raw DWARF/PDB or pre-converted `.sym`?** | `.sym` is smaller and faster to use but lossy (no source context, no inline detail beyond what's emitted). Store *both*, or store DWARF and convert on ingest with caching. Sentry stores native debug files and converts internally. |
| **Retention** | You only need symbols for builds still running in the field. Tie symbol retention to release adoption: when a release drops below N% adoption *and* is past your crash-retention window, its symbols can be tiered to cold storage or deleted. |
| **Object storage tier** | Hot symbols (current + last few releases) on standard S3/GCS; old releases on Glacier/Coldline. A crash on a 2-year-old build pays a retrieval latency, which is fine — it's rare by definition. |
| **CAS dedup** | Many builds share unchanged system libraries; content-addressing dedups them automatically. Build-ID keying gives you this for free. |
| **Compression** | DWARF compresses well (3–5×) with zstd. Store compressed; decompress in the symbolicator with a cache. |

### Serving: cache, don't compute

The symbol server is read-mostly and its reads are *extremely* skewed: the current release's symbols are fetched constantly; old releases' almost never. So:

1. **CDN / edge cache the hot debug files.** Build-ID-keyed URLs are immutable (a build ID never changes meaning), so they cache forever — set `Cache-Control: immutable, max-age=31536000`.
2. **A local disk cache in front of object storage** on each symbolicator worker, since the same DWARF is needed for thousands of consecutive minidumps from the same build.
3. **Never re-parse DWARF per minidump.** Parsing DWARF is expensive; cache the *parsed symbol table* (or the per-address result) keyed by debug ID, not just the raw file.

### The "missing symbols" failure class

The most common at-scale symbol-server problem is *not* the server being down — it's symbols that **never arrived or arrived stripped**. Audit continuously:

- A CI job built and shipped a release but the symbol-upload step failed silently → every crash on that release is unsymbolicatable.
- A binary was built without `-g` / with symbols stripped and no separate debug file uploaded → no DWARF exists to fetch.
- The build ID embedded in the shipped binary differs from the one in the uploaded symbols (a non-reproducible build, a re-link) → the join fails even though "symbols were uploaded."

The defense is a **symbol-coverage check in the release gate**: before a build is allowed to roll out, assert that the symbol server has a debug file for every module's build ID that the build will ship. A crash you can't symbolicate is a crash you can't act on — catch the gap at release time, not at incident time.

---

## The Symbolication Pipeline

Symbolication is the cracking tower. Here is how it's built to be fast, parallel, and cheap.

### The algorithm, per frame

```text
for each frame (a return address in some module's address space):
  1. find the module: which loaded image contains this address?  (binary search the module list)
  2. compute the module-relative offset:  addr - module.load_addr
  3. fetch the debug file for module.build_id  (from cache → disk → object store)
  4. look up the offset in the symbol table → FUNC name + file:line
  5. apply CFI to find the CALLER's frame (unwind one level)
  6. resolve inlined frames: one address can be N logical frames after inlining
  7. (optional) attach source context from a source bundle
```

Step 6 is the subtle one: modern optimizing compilers inline aggressively, so a single machine address can correspond to *several* source-level frames (the inlined callee, its caller, etc.). DWARF records inline information; a good symbolicator expands one physical frame into the full logical call chain. Drop this and your stacks look mysteriously shallow and group wrong.

### Stackwalking: CFI vs frame-pointer heuristics

Reconstructing the stack from raw bytes requires knowing, at each return address, where the *previous* frame is. Two methods:

- **CFI-based (correct):** use the module's `STACK CFI`/DWARF `.eh_frame` to compute the canonical frame address for each instruction range. Works even with `-fomit-frame-pointer` (the default at `-O2`).
- **Frame-pointer heuristic (fallback):** assume `%rbp` chains frames. Fast, but **wrong on optimized code** that omits the frame pointer — you get garbage or truncated stacks.

At scale you *must* have CFI in your symbols, or optimized-release stacks (which is all of them) are unreliable. This is why `dump_syms` emits `STACK CFI` and why uploading symbols without it is a latent disaster.

### Parallelism and caching architecture

```text
                    ┌─────────────┐
   raw events ──►   │ symbolication│  (N stateless workers, horizontally scaled)
                    │   workers    │
                    └──────┬──────┘
                           │ cache lookups (in order, cheapest first):
              ┌────────────┼────────────────────┐
              ▼            ▼                      ▼
       per-(module,addr)  parsed-symbol-table   raw debug file
       RESULT cache       cache (per build-id)  (disk → object store → CDN)
       (Redis/in-proc)    (in-proc/disk)        keyed by build-id
```

Three cache layers, each catching more work earlier:

1. **Result cache** — `(build_id, module_offset) → (func, file, line, inlines)`. The same address crashes a million times; symbolicate it once. This is the highest-leverage cache and the reason at-scale symbolication is affordable.
2. **Parsed-symbol-table cache** — keep the parsed DWARF symbol table per build ID in memory; parsing is the expensive part of a fetch.
3. **Raw-file cache** — disk-cache the debug file so you don't re-download 500MB from object storage per worker per build.

Sentry's `symbolicator` is exactly this: a stateless Rust service with these cache tiers, fed module lists + addresses, returning symbolicated frames. Studying its source is the fastest way to internalize the design.

### Where symbolication runs: server-side, always (at scale)

Client-side symbolication (the device resolves its own stack) is tempting — it avoids shipping symbols to a server — but it's wrong at scale: it requires symbols *on the device* (bloating the app), it can't be re-run when grouping improves, and an obfuscated/stripped production binary can't symbolicate itself anyway. **Server-side symbolication with a symbol server is the only design that supports reprocessing, deobfuscation, and small binaries.** The senior page's "symbolicate before grouping" depends on this being server-side.

---

## Operating the Ingest Pipeline

The ingest tier must survive the crash storm — the load spike that arrives exactly when your software is at its worst.

### The shape of the load

Normal crash volume is steady and predictable. A bad release inverts that: a startup-crash-loop release can take crash volume from 10K/min to 10M/min in *minutes*, because every affected device crashes, relaunches, crashes, relaunches, each cycle queuing a report. Your ingest must **degrade gracefully**, not collapse, under a 1000× spike of *correlated, near-identical* events.

### The standard architecture

```text
   SDKs ──► LOAD BALANCER ──► relay/ingest tier ──► QUEUE (Kafka/Kinesis) ──► processors
            (TLS, auth,        (cheap accept,        (buffer the spike)        (symbolicate,
             rate-limit,        validate, dedup-     ▲ THE SHOCK ABSORBER ▲     group, store)
             429 + Retry-       hash, sample, drop)
             After)
```

Design rules for surviving the storm:

| Rule | Why |
|---|---|
| **Accept-and-queue, never accept-and-process synchronously.** | The expensive work (symbolication) must be decoupled from the accept path by a queue, so a spike buffers instead of backing up into 503s on ingest. |
| **Shed at the edge, cheaply.** | Rate-limit and spike-protect *before* the queue, using only the cheap fields (project, release, a hash). Dropping a flood must cost almost nothing. |
| **Server-side spike protection per signature.** | When one signature floods (crash loop), admit the first N for visibility and drop the rest server-side. The senior page's client-side guard is round one; this is the backstop when the client guard is missing or the client is old. |
| **Backpressure to the SDK via 429 + `Retry-After`.** | The relay must tell SDKs to back off, and SDKs must honor it (senior page). A relay that 500s instead of 429s triggers SDK retry storms. |
| **Idempotent processing.** | Reprocessing and at-least-once queues mean the same event can be processed twice; keying on event ID makes dedup safe. |
| **Separate the dump store from the event store.** | Raw minidumps go to object storage (cheap, large, cold); the symbolicated, indexed event goes to the columnar store (hot, queryable). Don't put 50KB blobs in your query database. |

### Retention as a pipeline parameter

You do not keep everything forever. Tier it:

- **Raw minidumps:** keep 30–90 days in object storage, then delete. You rarely re-open a 6-month-old dump.
- **Symbolicated events (full detail):** 90 days in the hot columnar store.
- **Aggregates (per-signature, per-release counts):** keep for *years* — they're tiny and they're what release-health and regression-detection query. This is the data you need to answer "is this worse than last quarter's equivalent release?"

The cost lever is: **store the aggregate forever, the detail briefly, the raw dump briefest.** Most crash-cost blowups come from keeping full-detail events at full cardinality far longer than anyone queries them.

---

## Cardinality & Cost Control

Crash cost = `events ingested × symbolication cost + unique series × storage × retention`. The dangerous multiplier is **unique series** — distinct combinations of fingerprint and tags — and it explodes through specific, recurring mistakes.

### The cardinality bombs

| Bomb | Mechanism | Defense |
|---|---|---|
| **Unbounded fingerprint** | A per-request ID, timestamp, or raw address in the fingerprint → every event is a "new issue" → billions of one-event issues | Symbolicate before grouping; strip dynamic values; cap distinct new-issue creation rate per project (Sentry does this) |
| **High-cardinality tags** | Tagging events with `user_id`, `device_serial`, `session_id`, full URL with query string | Allowlist tags; hash or bucket high-card fields; never tag with an unbounded identifier |
| **Release explosion** | Every CI build (incl. every PR build) reported as a distinct `release` → thousands of releases, each a partition | Only report *shipped* releases; collapse dev/PR builds to one synthetic release |
| **Crash-loop event flood** | One bad release multiplies *event count* (not series) but burns symbolication + quota | Per-signature spike protection; client + server rate limiting; bounded offline queue |
| **OS/device matrix** | `os.version × device.model × release` is naturally high-card on Android | Accept it but bound retention on full detail; keep only aggregates long-term |

The asymmetry to internalize: **a crash-loop floods event *count* (a quota/throughput problem); an unbounded fingerprint floods *series* (a storage/cardinality problem).** They feel similar in a dashboard but the fix is different — rate-limit the former, fix the grouping key for the latter. Misdiagnose and you'll throttle good signal while the real bomb keeps ticking.

### The cost model, written down

```text
monthly_cost ≈
    ingest_events    × accept_cost
  + symbolicated     × symbolication_cost      ← cache hit-rate is the dominant lever
  + unique_series    × bytes_per_series × retention_days × storage_$
  + raw_dumps_stored × dump_bytes × dump_retention × object_$
  + query_volume     × scan_cost

Levers, in order of impact:
  1. symbolication cache hit-rate  (90% → 99% can 10× the affordable volume)
  2. cardinality of fingerprint + tags  (the series multiplier)
  3. retention tiering  (detail short, aggregates long)
  4. sampling of handled events  (never fatal — senior page)
  5. spike protection  (crash-loop containment)
```

A staff engineer can recite this model and point at which term is blowing up *this* month. "Our crash bill tripled" is always one of these five terms, and the diagnostic is to attribute the delta to a term before touching anything.

### Sampling at the pipeline (beyond the SDK)

The senior page sampled at the SDK (`beforeSend`). At the pipeline you add **dynamic sampling**: the relay decides retention sampling based on what's already abundant. A signature you have a million examples of can be sampled hard *for storage* while still being *counted* at 100% (keep the count, drop the detail). This separates two things naïvely conflated: **counting** (must be accurate — release-health depends on it) and **detailed retention** (can be sampled — the 1,000,001st identical stack adds nothing). Keep every count; store a sample of the details.

---

## Alerting on Crash Regressions

The hardest alerting problem in this domain: a healthy product crashes thousands of times a day across known issues. Paging on crashes is paging on noise. You must page on **regressions** — new or worsening signatures — and nothing else.

### What "regression" means precisely

1. **New-in-release:** a signature with events in release `N` and *zero* events in releases `< N` (at comparable adoption). Genuinely new code path failing.
2. **Rate regression:** a signature whose per-session (or per-adoption-weighted) rate increased beyond a baseline + threshold. An old bug getting worse.
3. **Reopened:** a signature previously marked resolved that produces a new event in a release *after* the one that resolved it. The "fix" didn't fix it (or regressed).

The naïve "alert when issue event count > X" is wrong on all three counts: it pages on stable high-volume known issues and stays silent on a small-but-new regression. **Normalize by adoption and baseline; alert on the delta.**

### The math: adoption-weighted, baseline-relative

```text
crash_rate(signature, release) = events(signature, release) / sessions(release)

A signature regresses in release N if:
  crash_rate(sig, N)  >  baseline_rate(sig)  +  k · stddev(baseline_rate)
  AND  sessions(release N) ≥ min_adoption_threshold   ← don't fire on tiny denominators
  AND  the increase is sustained over W windows        ← don't fire on a single-window blip

For NEW signatures:
  events(sig, N) ≥ min_events   AND   events(sig, <N) == 0   AND   adoption ≥ threshold
```

The `min_adoption_threshold` is the senior-page lesson made operational: at 1% adoption a new release has tiny denominators and one crash swings the rate wildly — wait for statistical significance before paging. Change-point detection (CUSUM, EWMA, or a simple z-score on a rolling baseline) is the standard tool; Sentry's "Issue Alerts" with "% change" conditions and Crashlytics "Velocity alerts" ("a crash affecting X% of users in the first N hours of a release") are productized versions of exactly this.

### Tying it to the release gate

The regression detector *is* the release-health gate's brain (senior page). The flow:

```text
   staged rollout step ─► measure per-signature crash_rate for the new cohort
                              │
              ┌───────────────┴────────────────┐
        any NEW or REGRESSED signature       all signatures within baseline?
        above threshold at adequate adoption?      │
              │                                     ▼
              ▼                              advance rollout
        HALT (mobile) / auto-rollback (backend)
        + page with the SPECIFIC signature, segmented
```

The crucial property: the alert names the *specific signature, segmented by OS/device*, not "crashes went up." That turns a page into a triage-ready ticket. The senior worked example (camera/AVCapture regression on Android 14/Samsung) is what this produces when it's built right.

### Suppressing the known and the noise

- **Issue states matter:** ignored/won't-fix signatures are excluded from regression alerting (but still counted for crash-free rate). A bug you've consciously decided to live with must not page you forever.
- **Deduplicate the alert, not just the events:** a regression across 50 device models is *one* page, with the breakdown attached — not 50 pages.
- **Adoption gating prevents canary-noise paging:** the #1 source of false pages is firing before the release has enough sessions to be statistically real.

---

## Replay & Deobfuscation Infrastructure

Two pieces of infrastructure that turn a raw report into something a human can act on: **deobfuscation** (Android/obfuscated builds) and **reprocessing/replay** (re-running the pipeline when inputs arrive late or improve).

### Deobfuscation (Android R8/ProGuard, and the iOS analogue)

Shipped Android apps are obfuscated: R8/ProGuard rename `com.app.checkout.QrScanner.scan()` to `a.b.c()` and may merge/inline classes. A crash from a release build has obfuscated frames; to read them you need that build's **`mapping.txt`** — the per-build transform — uploaded to the backend and keyed by build UUID.

```text
   OBFUSCATED FRAME            mapping.txt (this build's)            DEOBFUSCATED
   ────────────────            ──────────────────────────            ────────────
   a.b.c(SourceFile:1)   ──►   com.app.checkout.QrScanner ->  a.b   ──►   com.app.checkout.
                               scan(QrFrame) -> c                         QrScanner.scan(QrFrame)
                                                                          (checkout/QrScanner.kt:88)
```

Operational requirements:

1. **Upload `mapping.txt` per build in CI**, keyed by the build UUID embedded in the APK/AAB. Same discipline as `.sym` upload — gated, non-optional, per build.
2. **Deobfuscation happens *before* grouping** — for the same reason as symbolication: if you group on obfuscated names, a new mapping (every build re-randomizes) causes fingerprint drift and your old bugs all look "new" (the senior page's drift killer, now with its concrete cause: R8 renaming).
3. **DexGuard / aggressive optimization** can merge classes and remove line numbers; you may need `-keepattributes SourceFile,LineNumberTable` in your ProGuard rules or your deobfuscated stacks have no line numbers. This is a build-config decision that silently degrades every future crash report if missed.

The iOS analogue is the `.dSYM` (and, historically, bitcode-recompiled dSYMs from App Store Connect): you upload the dSYM per build keyed by UUID, and the backend `atos`-style resolves addresses to symbols. Swift name mangling (`$s4Main8CheckoutC4scanyyF`) is then demangled (`swift-demangle`) for readability. Same shape: per-build artifact, keyed by UUID, applied server-side before grouping.

### Reprocessing / replay — reconciling the two clocks

The field clock and CI clock are unsynchronized (Mental Model 3). Events can arrive before their symbols/mapping, or grouping rules can change after events are stored. **Reprocessing** re-runs symbolication, deobfuscation, and grouping over already-ingested events:

| Trigger | What reprocessing does |
|---|---|
| **Symbols/mapping arrive late** | Events that landed unsymbolicated (stored raw) are re-symbolicated and re-grouped now that the debug file exists. |
| **Grouping rule changes** | A new server-side grouping enhancement is applied retroactively, merging/splitting historical issues. |
| **Symbolicator/SDK bug fix** | A capture or symbolication bug is fixed; the raw dumps are re-walked to produce correct stacks. |
| **A wrong symbol was uploaded** | The bad symbol is replaced and affected events re-symbolicated. |

This is why you **store the raw minidump, not just the symbolicated result** (for your retention window): reprocessing needs the original input. A pipeline that throws away the raw dump after symbolication can never fix a symbolication mistake — the evidence is gone. Sentry exposes this as an explicit "Reprocess" action on events that were stored with missing symbols; at scale it's a batch job over the raw-dump store keyed by the build whose symbols just arrived.

### The replay loop, operationally

```text
   symbols/mapping for build B arrive (late)  ──► look up all raw dumps from build B
                                                   in the retention-window store
                                                        │
                                                        ▼
                                                   re-symbolicate / deobfuscate
                                                        │
                                                        ▼
                                                   re-group → merge into correct issues
                                                        │
                                                        ▼
                                                   re-emit counts (idempotent on event id)
                                                   so release-health corrects itself
```

The idempotency requirement is real: reprocessing must not double-count an event into crash-free math. Key everything on event ID and make re-emission a replace, not an add.

---

## Build / Buy / Self-Host

The staff decision the org will ask you to own.

| Option | When it's right | What you take on |
|---|---|---|
| **SaaS (Sentry.io, Crashlytics, Bugsnag, Backtrace, Embrace)** | Default. You want crash reporting, not a crash-reporting *team*. | Per-event cost; data leaves your perimeter; their cardinality/retention model is yours. |
| **Self-host open-source (Sentry self-hosted, `symbolicator`)** | Data residency/compliance forbids SaaS; volume makes per-event SaaS pricing punitive; you have SRE capacity. | You now operate Kafka, ClickHouse/Snuba, the symbolicator, the symbol server, and their on-call. Real headcount. |
| **Fully bespoke pipeline** | Extreme scale or a unique platform (a console, an embedded fleet) where no vendor fits. | Everything on this page, built and run by you. Rare and expensive; justified only at FAANG-scale or genuinely unusual platforms. |

The honest staff guidance: **self-hosting a crash pipeline is operating three stateful distributed systems (queue, columnar store, symbolicator) plus a symbol server.** It is justified by data-residency law or by volume economics, not by "we can build it." Most orgs should buy, control cardinality and sampling to control the bill, and spend their scarce SRE capacity elsewhere. Reach for self-host when the SaaS bill exceeds the fully-loaded cost of the team that would run the self-hosted stack — and not before.

---

## Code Examples

### Linux — a correct out-of-process-style handler skeleton (alt-stack, mmap, CAS sentinel)

```c
/* Illustrates the async-signal-safe DISCIPLINE the staff engineer must understand
   even though you should use Crashpad. Pre-allocate at install time; in the handler
   only read registers, copy bytes, write() to a pre-opened fd. No malloc, no locks. */
#include <signal.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/auxv.h>
#include <ucontext.h>
#include <string.h>

static int   dump_fd = -1;          /* opened at startup, before any crash */
static void *alt_stack = NULL;      /* mmap'd, runtime-sized */
static volatile sig_atomic_t handling = 0;

static void handler(int sig, siginfo_t *info, void *uc) {
    /* Serialize concurrent crashers without a mutex. */
    if (!__sync_bool_compare_and_swap(&handling, 0, 1)) _exit(128 + sig);

    /* Read register state from the ucontext — no allocation. On x86_64: */
    ucontext_t *ctx = (ucontext_t *)uc;
    greg_t rip = ctx->uc_mcontext.gregs[REG_RIP];
    greg_t rsp = ctx->uc_mcontext.gregs[REG_RSP];

    /* Real handler: serialize a minidump (registers + stack bytes + module list)
       into a PRE-ALLOCATED/mmap'd buffer and write() it. Sketch only: */
    char hdr[64];
    int n = 0;
    const char tag[] = "FATAL sig=";
    memcpy(hdr, tag, sizeof(tag) - 1); n += sizeof(tag) - 1;
    hdr[n++] = '0' + (sig % 10); hdr[n++] = '\n';
    write(dump_fd, hdr, n);              /* bare syscall — safe */
    (void)rip; (void)rsp; (void)info;

    _exit(128 + sig);                   /* never return, never exit() */
}

void install_crash_handler(int fd) {
    dump_fd = fd;

    /* Runtime-sized alt stack — SIGSTKSZ is no longer a safe compile-time const. */
    long sz = sysconf(_SC_SIGSTKSZ);
    if (sz < MINSIGSTKSZ) sz = MINSIGSTKSZ * 4;
    alt_stack = mmap(NULL, (size_t)sz, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    stack_t ss = { .ss_sp = alt_stack, .ss_size = (size_t)sz, .ss_flags = 0 };
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = handler;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESETHAND;
    sigfillset(&sa.sa_mask);             /* block other signals during handling */
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);
    sigaction(SIGBUS,  &sa, NULL);
    sigaction(SIGILL,  &sa, NULL);
    sigaction(SIGFPE,  &sa, NULL);

    /* Under Yama, permit a sibling handler process to ptrace us (Crashpad model). */
    /* prctl(PR_SET_PTRACER, handler_pid, 0, 0, 0); */
}
```

### Rust — wiring `sentry-native`/Crashpad and uploading symbols in CI

```rust
// Cargo.toml: sentry = { version = "0.34", features = ["crashpad"] }
// The crashpad feature spawns a SEPARATE handler process at init (out-of-process).
// Staff concern is the BUILD side: emit + upload symbols keyed by build-id.

fn main() {
    let _guard = sentry::init((
        std::env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            // The Crashpad handler process owns SIGSEGV/abort capture out-of-process.
            ..Default::default()
        },
    ));
    run();
}
# fn run() {}
```

```bash
# CI: produce a build-id and upload debug info to the symbol server.
# (sentry-cli is the reference uploader; it computes the debug-id and lays out
#  the SymSrv-style path for you.)

# 1. Build with debug info retained (a separate .debug, stripped binary shipped).
cargo build --release
objcopy --only-keep-debug target/release/myapp target/release/myapp.debug
objcopy --strip-debug --add-gnu-debuglink=myapp.debug target/release/myapp

# 2. Upload debug files keyed by GNU build-id. Without this the field crashes
#    are 4KB minidumps no one can read.
sentry-cli debug-files upload --include-sources target/release/

# 3. RELEASE GATE: assert symbol coverage before allowing rollout.
sentry-cli debug-files check target/release/myapp \
  || { echo "missing/incomplete symbols — BLOCK release"; exit 1; }
```

### Python — a server-side regression detector (adoption-weighted, baseline-relative)

```python
"""Pages only on NEW or REGRESSED signatures, adoption-gated and sustained.
   This is the brain of the release-health gate, not a threshold alert."""
from dataclasses import dataclass
from statistics import mean, pstdev

MIN_ADOPTION_SESSIONS = 5_000   # don't fire on tiny denominators (canary noise)
Z = 4.0                          # baseline + 4σ before we call it a regression
SUSTAINED_WINDOWS = 2            # must hold for >1 window — no single-blip pages

@dataclass
class SigStat:
    signature: str
    release: str
    events: int
    sessions: int                # sessions for THIS release cohort
    baseline_rates: list[float]  # this signature's per-session rate in prior releases
    prior_releases_had_it: bool

def crash_rate(s: SigStat) -> float:
    return s.events / s.sessions if s.sessions else 0.0

def is_regression(s: SigStat, sustained: int) -> tuple[bool, str]:
    if s.sessions < MIN_ADOPTION_SESSIONS:
        return False, "insufficient adoption"          # statistical gate
    if not s.prior_releases_had_it and s.events >= 25:
        return True, "NEW signature in this release"    # new-in-release regression
    if s.baseline_rates:
        mu, sd = mean(s.baseline_rates), pstdev(s.baseline_rates) or 1e-9
        if crash_rate(s) > mu + Z * sd and sustained >= SUSTAINED_WINDOWS:
            return True, f"rate {crash_rate(s):.4f} >> baseline {mu:.4f}+{Z}σ"
    return False, "within baseline"

# The alert that fires names the SPECIFIC signature, segmented — a triage-ready ticket,
# not "crashes went up". Suppress ignored/won't-fix signatures upstream of this.
```

### Go — bounding cardinality at ingest (the relay's cheap accept path)

```go
// Runs at the EDGE, before the queue: cheap validation + cardinality bounding +
// per-signature spike protection. Must cost almost nothing so a storm can't DoS it.
package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

type Relay struct {
	mu        sync.Mutex
	sigWindow map[string]*window // per-signature token bucket (spike protection)
	allowTag  map[string]bool    // tag ALLOWLIST — never index unbounded tags
}

type window struct {
	count int
	start time.Time
}

// stableSignature strips dynamic values so cardinality stays bounded.
// (Full symbolicated grouping happens downstream; this is a cheap pre-hash.)
func stableSignature(exType string, frames []string) string {
	h := sha256.New()
	h.Write([]byte(exType))
	for _, f := range frames { // frames are normalized module+offset, NOT raw addrs
		h.Write([]byte(f))
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

const maxPerSigPerMin = 200 // admit first N of a flood for visibility, drop the rest

func (r *Relay) Accept(ev *Event) (admit bool, retryAfter time.Duration) {
	// 1. Cardinality bound: drop tags not on the allowlist (kills user_id/serial/url bombs).
	for k := range ev.Tags {
		if !r.allowTag[k] {
			delete(ev.Tags, k)
		}
	}
	// 2. Per-signature spike protection (a crash-loop can't flood the pipeline).
	sig := stableSignature(ev.ExceptionType, ev.NormalizedFrames)
	r.mu.Lock()
	w := r.sigWindow[sig]
	now := time.Now()
	if w == nil || now.Sub(w.start) > time.Minute {
		w = &window{start: now}
		r.sigWindow[sig] = w
	}
	w.count++
	over := w.count > maxPerSigPerMin
	r.mu.Unlock()
	if over {
		return false, 30 * time.Second // 429 + Retry-After; SDK MUST honor it
	}
	return true, 0
}
```

### Node.js — reprocessing trigger: re-symbolicate when late symbols arrive

```js
// When CI finally uploads symbols for build B (the CI clock catching up to the
// field clock), replay every raw dump from B that we stored unsymbolicated.
// Idempotent on event id so release-health counts don't double.

const { listRawDumpsForBuild, symbolicate, regroup, upsertEvent } = require("./pipeline");

async function reprocessBuild(buildId) {
  const dumps = await listRawDumpsForBuild(buildId); // from the raw-dump retention store
  for (const dump of dumps) {
    const frames = await symbolicate(dump);          // now succeeds — symbols exist
    const issue = await regroup(frames);             // group on REAL (symbolicated) names
    // upsert keyed by eventId → re-emission is a REPLACE, never an ADD.
    await upsertEvent({ eventId: dump.eventId, issue, frames, reprocessed: true });
  }
  // release-health self-corrects: the previously-"unsymbolicated" bucket drains
  // into the right issues, and any hidden regression now surfaces.
}
```

### CI — symbol-coverage gate (the release can't ship without readable crashes)

```yaml
# Block any rollout whose binaries lack uploaded, build-id-matching symbols.
# "A crash you can't symbolicate is a crash you can't act on" — catch it here.
release-gate:
  steps:
    - name: upload-debug-files
      run: sentry-cli debug-files upload --include-sources ./build/

    - name: assert-symbol-coverage
      run: |
        for so in $(find ./build -name '*.so' -o -name '*.dylib'); do
          bid=$(./scripts/build-id "$so")
          sentry-cli debug-files check "$so" --build-id "$bid" \
            || { echo "::error::no symbols for $so ($bid) — BLOCKING release"; exit 1; }
        done

    - name: upload-r8-mapping        # Android: deobfuscation needs this PER build
      run: sentry-cli upload-proguard --uuid "$BUILD_UUID" ./app/build/outputs/mapping/release/mapping.txt
```

---

## A Worked Pipeline Build-Out

A staff engineer is handed a mandate: "We're on Crashlytics, our bill is exploding, and compliance now requires crash data to stay in-region. Stand up a self-hosted crash pipeline." Here is the build, decision by decision.

**Week 0 — Frame the decision.** Before building anything, attribute the Crashlytics bill to the cost model. It's two terms: (a) crash-loop event floods from three chronic startup-crash releases, and (b) full-detail retention at 90 days on a high-cardinality Android device matrix. Finding (a) means the *first* fix is spike protection and bounded queues — which the team could do *on Crashlytics* and save 60% without migrating. But compliance (data residency) forces self-host regardless. Migration is justified by law, not cost; cost is fixed in parallel.

**Week 1 — Ingest tier.** Stand up the edge relay (accept-and-queue) behind a load balancer. The relay does only cheap work: TLS, project auth, tag allowlisting (kills the `device_serial` cardinality bomb already present in the data), a stable pre-hash signature, per-signature spike protection (200/min), and 429 + `Retry-After`. Events land in Kafka — the shock absorber for the inevitable crash storm. *Decision:* Kafka over a synchronous accept path, because the migration's first big release *will* produce a storm and synchronous symbolication would 503 the ingest.

**Week 2 — Storage split.** Raw minidumps → S3-compatible in-region object store, 60-day retention, lifecycle rule to delete. Symbolicated events → ClickHouse, 90-day retention. Per-signature/per-release aggregates → a separate ClickHouse table, multi-year retention (this is what regression detection and "is this worse than last quarter" query). *Decision:* never put raw dumps in the query store; never keep full detail as long as aggregates.

**Week 3 — Symbol server + symbolication.** Deploy Sentry's open-source `symbolicator` as the cracking tower: stateless workers, three cache tiers (per-`(build_id,addr)` result cache in Redis, parsed-symbol-table cache in-process, raw debug file on local disk fronting the in-region object store). The symbol server is the SymSrv-style CAS layout in object storage, fronted by a CDN with `immutable` caching. Wire CI to upload `.sym` + raw DWARF and R8 `mapping.txt` per build, keyed by build ID/UUID. *Decision:* server-side symbolication only — it's the only design that supports reprocessing and deobfuscation.

**Week 4 — The release gate.** Add the symbol-coverage check to CI (block rollout if any shipped module lacks build-ID-matching symbols — the team had been shipping a stripped JNI `.so` with no uploaded debug file, so 12% of native crashes were unreadable). Wire the regression detector: adoption-gated, baseline-relative, per-signature, segmented. Connect it to the Play Store staged-rollout halt runbook (mobile can't roll back — senior page).

**Week 5 — Reprocessing.** Build the replay path: when symbols/mapping for a build arrive late (the field clock beating the CI clock for beta testers), re-symbolicate and re-group the raw dumps from that build, idempotent on event ID so crash-free math self-corrects. This immediately recovers the previously-unreadable JNI crashes once the missing `.so` symbols are backfilled.

**Outcome.** Data stays in-region (compliance satisfied). The bill drops ~70%: spike protection killed the crash-loop floods, tag allowlisting killed the cardinality bomb, retention tiering shrank hot storage, and the symbolication result cache (97% hit rate — the same builds crash the same way) made the cracking tower cheap. The release gate now blocks any build whose crashes wouldn't be readable, and the regression detector pages on the *specific new signature, segmented* — not on the steady-state noise of 4,000 known crashes a day.

**Staff takeaways.**
- The first lever was attribution: the bill was two terms, one of which (spike protection) was fixable *without* migrating.
- Compliance, not cost, justified self-hosting — and self-hosting means operating Kafka + ClickHouse + symbolicator + symbol server, real on-call.
- The symbolication cache hit-rate (97%) is what makes the whole thing affordable; it's the dominant term.
- The symbol-coverage gate found a class of *invisible* failure (unreadable native crashes) that no dashboard had surfaced because the crashes *were* arriving — just unsymbolicatable.

---

## Failure Stories

**1. The symbol server that ran out of money before it ran out of disk.** A team uploaded full DWARF for *every CI build*, including thousands of PR builds, with no retention policy. The in-region object store grew to 14TB, 99% of it symbols for builds that never shipped. The bill, not the disk, was the alarm. Fix: only upload symbols for *shipped* releases (or upload all but lifecycle-delete non-shipped within 7 days), and tier old-release symbols to cold storage. *Lesson: symbols are large and most are never needed; tie symbol retention to release adoption.*

**2. The unsymbolicatable fleet.** A native release shipped with a stripped third-party `.so` whose symbols were never uploaded (the vendor didn't provide them, and CI's symbol-upload step didn't fail when a file was missing — it just uploaded what it had). For three weeks, 18% of native crashes were 4KB minidumps no one could read, and the worst native bug hid entirely in that unreadable slice. Fix: a **symbol-coverage gate** in the release pipeline that blocks rollout unless every shipped module's build ID has a matching debug file on the symbol server. *Lesson: "symbols were uploaded" ≠ "all symbols were uploaded"; assert coverage at the gate, not at the incident.*

**3. The fingerprint that drifted because of R8.** Android crashes were grouped on *obfuscated* frame names — before deobfuscation. Every release, R8 re-randomized the obfuscation map, so `a.b.c()` became `x.y.z()` for the same code, and every release re-shattered the issue history. The regression detector ("alert on new issues") fired on hundreds of false "new" issues per release and a real regression hid in the flood. Fix: deobfuscate *before* grouping (upload `mapping.txt` per build, apply it server-side first). *Lesson: group on real names; the senior-page "drift" killer's concrete cause on Android is grouping before deobfuscation.*

**4. The crash storm that took down ingest, not the app.** A startup-crash-loop release sent crash volume from 8K/min to 9M/min in four minutes. The ingest tier symbolicated *synchronously* on the accept path, so the queue backed up into the accept path, ingest started returning 503s, the SDKs (not honoring 429 because the relay sent 500s) retry-stormed, and the *crash pipeline itself* became the outage while the app's actual bug was almost trivial. Fix: accept-and-queue (decouple symbolication behind Kafka), per-signature spike protection at the edge, and correct 429 + `Retry-After`. *Lesson: the pipeline's load spikes precisely when your software is worst; the accept path must be cheap and decoupled, or the pipeline becomes the incident.*

**5. The cardinality bomb in a tag.** Someone added `tags={"session_id": ...}` to enrich crash context. Session IDs are unbounded, so every crash became a unique series; the columnar store's compression collapsed and query latency went from 200ms to 40s. The crash *count* was unchanged — only the *series* count exploded — so it looked like a database problem, not a crash-reporting problem, and three days were lost chasing ClickHouse before someone read the schema. Fix: a tag allowlist at ingest; never index an unbounded identifier. *Lesson: a crash-loop floods event count; an unbounded tag/fingerprint floods series — different bombs, different fixes, and the latter masquerades as a database problem.*

**6. The reprocessing that double-counted.** A late symbol upload triggered reprocessing, which re-emitted the affected events — but the re-emission *added* counts instead of replacing them, so crash-free rate for that release suddenly read worse than before (the same crashes counted twice). Panic over a non-existent regression. Fix: make reprocessing idempotent — key on event ID and upsert (replace), never add. *Lesson: replay must be idempotent on event ID or it corrupts the very release-health math it's meant to fix.*

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **Self-host the pipeline** | Data residency; flat cost at high volume; full control of cardinality/retention | You operate Kafka + columnar store + symbolicator + symbol server; real on-call |
| **Accept-and-queue ingest** | Survives the crash storm; decouples expensive symbolication | More moving parts (a queue to operate); at-least-once semantics force idempotency |
| **Server-side symbolication** | Supports reprocessing, deobfuscation, small binaries | A symbol server to run; symbolication is the cost center |
| **Aggressive symbolication caching** | The single biggest cost lever (90%→99% hit = 10× affordable volume) | Cache invalidation on symbol replacement; memory for the result cache |
| **Cardinality allowlist at ingest** | Prevents the series-explosion cost bomb at the source | You must curate the allowlist; a dropped tag is a debugging field you don't have |
| **Regression-based alerting** | Pages on signal (new/worse), not on steady-state noise | Needs baselines, adoption gating, change-point math; harder to build than thresholds |
| **Reprocessing/replay** | Recovers late-symbol and grouping-rule-change events; fixes mistakes retroactively | Must store raw dumps; must be idempotent; batch load on the pipeline |
| **Symbol-coverage release gate** | Catches the invisible "unreadable crash" failure class before rollout | One more gate; can block a release on a CI symbol-upload flake |

---

## Use Cases

- **"Our crash bill tripled overnight."** → attribute to the cost model: is it event count (crash-loop → spike protection) or series count (unbounded tag/fingerprint → allowlist)? They look alike; the fix differs.
- **"18% of native crashes are unreadable."** → missing/stripped symbols; add a symbol-coverage gate; backfill and reprocess.
- **"Every release shows hundreds of fake 'new' issues."** → grouping before deobfuscation/symbolication; deobfuscate first, group on real names.
- **"The crash pipeline itself went down during a bad release."** → synchronous symbolication on the accept path; decouple behind a queue, spike-protect at the edge, send 429 not 500.
- **"Query latency on the crash DB exploded but crash count is flat."** → cardinality bomb (a high-card tag/fingerprint), not a count problem; find and bound the series.
- **"Compliance says crash data can't leave the region."** → self-host (`symbolicator` + Sentry self-hosted) in-region; budget for operating it.
- **"We page on crashes constantly and ignore the pages."** → you're alerting on value, not derivative; switch to regression-based, adoption-gated, per-signature alerting.
- **"Symbols arrived late and those crashes are stuck unreadable."** → reprocessing/replay over the raw-dump store, idempotent on event ID.

---

## Coding Patterns

### Pattern: symbolication result cache (the dominant cost lever)

```python
# Cache (build_id, module_offset) -> symbolicated frame. The same address crashes
# millions of times; symbolicate it ONCE. This single cache is what makes at-scale
# symbolication affordable. Key on build_id (immutable) so entries never go stale
# except on explicit symbol replacement (reprocessing).
def symbolicate_frame(build_id: str, offset: int, cache, debug_store) -> Frame:
    key = (build_id, offset)
    if (hit := cache.get(key)) is not None:
        return hit
    sym = debug_store.lookup(build_id, offset)  # expensive: fetch+parse DWARF, CFI walk
    cache.set(key, sym)                          # immutable until symbols replaced
    return sym
```

### Pattern: adoption-gated regression check

```python
# Never fire below statistical significance — the #1 source of false canary pages.
if sessions(release) < MIN_ADOPTION and not has_prior_data(release):
    return  # wait for adequate denominators before judging release health
```

### Pattern: idempotent reprocessing

```python
# Replay must REPLACE, never ADD, or it corrupts crash-free math.
store.upsert(event_id=ev.id, issue=regroup(symbolicate(ev.raw_dump)))  # keyed on id
```

### Pattern: tag allowlist at ingest

```go
for k := range ev.Tags {
    if !allowedTags[k] { // drop unbounded identifiers BEFORE they hit the store
        delete(ev.Tags, k)
    }
}
```

### Pattern: build-id-keyed symbol URL (SymSrv shape)

```python
def symbol_url(root: str, name: str, debug_id: str) -> str:
    # Deterministic, immutable URL → cache forever at the CDN.
    return f"{root}/{name}/{debug_id}/{name}"
```

---

## Clean Code

- **Symbolication is server-side, cached at three tiers, and never recomputes a known `(build_id, address)`.** The result cache is the pipeline's economic foundation; treat its hit-rate as a primary SLI.
- **The ingest accept path does only cheap work and immediately queues.** No symbolication, no synchronous storage, on the accept path — the queue absorbs the storm.
- **Cardinality is bounded at ingest by an allowlist**, not cleaned up at query time. An unbounded tag or fingerprint never reaches the store.
- **Symbols and mapping files are uploaded per build, keyed by build ID, gated in CI**, and a coverage check blocks any release whose crashes wouldn't be readable.
- **Grouping happens after symbolication and deobfuscation**, on real names — never on obfuscated or unsymbolicated frames.
- **Raw minidumps are retained for the reprocessing window**, separately from the queryable event store, so symbolication mistakes are fixable.
- **Reprocessing is idempotent on event ID.** Replay replaces, never adds, so it cannot corrupt release-health math.
- **Alerting is on regressions** (new/worsened signatures), adoption-gated, segmented, with known/won't-fix signatures suppressed — never on absolute crash count.
- **Retention is tiered:** raw dumps briefest, full detail short, aggregates long.

---

## Best Practices

1. **Decouple symbolication from ingest with a queue.** The accept path must be cheap; the storm must buffer, not back up. A synchronous accept path turns a bad release into a pipeline outage.
2. **Make the symbolication result cache a first-class SLI.** Cache hit-rate is the dominant cost lever; a regression in it (e.g. after a symbol replacement invalidates a hot build) is a cost incident.
3. **Run a real symbol server, build-ID-keyed, CDN-fronted, immutable-cached.** Tie symbol retention to release adoption; tier old releases to cold storage.
4. **Gate releases on symbol coverage.** Block rollout unless every shipped module's build ID has matching debug info. Unreadable crashes are invisible failures.
5. **Deobfuscate and symbolicate before grouping.** Group on real names so R8/refactor/inlining churn doesn't drift your fingerprints.
6. **Bound cardinality at ingest with an allowlist.** Never index an unbounded identifier; collapse PR/dev builds to one synthetic release.
7. **Separate counting from detailed retention.** Count every event at 100% (release-health depends on it); sample the *detail* you store of abundant signatures.
8. **Alert on regressions, not values.** Adoption-gated, baseline-relative, per-signature, segmented, with won't-fix suppressed.
9. **Store raw dumps for the reprocessing window and make replay idempotent.** The two clocks (field/CI) are unsynchronized; reconcile them with idempotent reprocessing.
10. **Buy unless law or volume forces self-host.** Self-hosting is operating three stateful systems plus a symbol server; justify it by data residency or the bill exceeding the team's loaded cost — not by "we can build it."

---

## Edge Cases & Pitfalls

- **`SIGSTKSZ` is no longer a compile-time constant.** A static `char stack[SIGSTKSZ]` can under-size the alt stack on modern (AVX-512) CPUs; the handler overflows its own stack and capture silently fails. Size it at runtime via `sysconf(_SC_SIGSTKSZ)`.
- **A non-reproducible build breaks the build-ID join.** If the shipped binary and the symbol-side binary aren't bit-identical, their build IDs differ and symbolication fails even though "symbols were uploaded." Use reproducible builds or extract symbols from the *exact* shipped artifact.
- **Stripped binaries with no separate debug file produce permanently unsymbolicatable crashes.** No DWARF exists to fetch. The coverage gate must catch this at release time.
- **R8/DexGuard without `-keepattributes SourceFile,LineNumberTable` strips line numbers.** Deobfuscated stacks then have function names but no source lines — silently degrading every future report.
- **Late symbols + non-idempotent reprocessing double-count.** Replay must key on event ID and replace, or it corrupts crash-free rate (Failure Story 6).
- **An unbounded tag masquerades as a database problem.** Series explosion (not count) collapses columnar compression and tanks query latency; teams chase the DB instead of the schema (Failure Story 5).
- **Cold-storage symbols add latency to old-build crashes.** Acceptable (old builds crash rarely) but the symbolicator must handle a multi-second fetch without timing out the whole event.
- **Two crash SDKs / a native handler fight over the signal.** Chaining order decides who captures; a mis-ordered install means Crashpad never sees the signal. Own the native handler explicitly.
- **`PR_SET_PTRACER`/Yama blocks out-of-process capture.** On hardened Linux the Crashpad handler can't `ptrace` the crasher unless the crasher set `PR_SET_PTRACER`. "No dumps on production but fine in dev" is often this.
- **CDN caching a *mutable* symbol URL.** If a build ID is ever reused (a broken build process), an immutable cache serves stale symbols forever. Build IDs must be truly unique per binary.

---

## Common Mistakes

1. **Symbolicating synchronously on the accept path** — the crash storm backs up into ingest and the pipeline becomes the outage.
2. **No symbolication result cache** (or a low hit-rate) — symbolication cost scales with event volume instead of with *distinct* crashes, and the bill explodes.
3. **Grouping before symbolication/deobfuscation** — fingerprint drift on every release; the regression detector drowns in false "new" issues.
4. **No symbol-coverage gate** — a class of crashes ships unreadable and nobody notices because the crashes *are* arriving.
5. **Unbounded tags/fingerprints** — series explosion; compression collapses; query latency tanks; misdiagnosed as a database problem.
6. **Keeping full-detail events as long as aggregates** — the retention-cost blowup; detail short, aggregates long.
7. **Alerting on absolute crash count** — page spam on steady-state known issues; the real small-but-new regression hides.
8. **Throwing away the raw minidump after symbolication** — reprocessing is then impossible; a symbolication mistake is permanent.
9. **Non-idempotent reprocessing** — replay double-counts and corrupts release-health.
10. **Self-hosting "because we can"** — taking on three stateful distributed systems plus a symbol server with no residency/volume justification.

---

## Tricky Points

- **The pipeline's load is correlated with your software's badness.** It spikes precisely when you most need it working — which is *why* the accept path must be cheap and decoupled. This coupling is the defining operational property.
- **Symbolication is both the most expensive and the most cacheable operation.** The economics of the entire pipeline rest on the result cache's hit-rate; the same builds crash the same way millions of times.
- **A crash-loop floods event count; an unbounded fingerprint floods series.** Different bombs, different fixes — and the series bomb disguises itself as a database problem.
- **Counting and detailed retention are different concerns.** Count everything (release-health needs it); store a sample of the detail of abundant signatures.
- **The field clock can precede the CI clock for a build.** Events arrive before their symbols; reprocessing exists to reconcile the two clocks, and it must be idempotent.
- **"Symbols were uploaded" ≠ "all symbols were uploaded."** The coverage gate is what turns a silent, invisible failure class (unreadable crashes that still arrive) into a release-time block.
- **Group on real names or your history shatters.** R8 re-randomizes the obfuscation map every build; grouping before deobfuscation re-splits every issue every release.
- **Build ID is the universal join key.** Every hard problem here reduces to a join on it; get the key wrong (non-reproducible build, stripped binary, version-keyed upload) and the whole pipeline can't read its own input.

---

## Anti-Patterns at Professional Level

1. **The synchronous symbolication accept path.** Convenient until the first storm, when the pipeline DoSes itself. Always queue.
2. **The cache-less symbolicator.** Re-walking DWARF per identical crash; cost scales with volume instead of distinct bugs. The result cache is non-negotiable.
3. **The grab-bag tag schema.** "Tag everything, we'll figure it out later." Later is a cardinality bomb and a 40-second query. Allowlist from day one.
4. **The fire-and-forget symbol upload.** A CI step that uploads "what it has" and never fails when files are missing. Gate on coverage.
5. **Grouping on obfuscated/unsymbolicated frames.** Drift on every release; the regression detector becomes noise. Symbolicate and deobfuscate first.
6. **The dump-discarding pipeline.** Throwing away raw minidumps after symbolication, making every symbolication mistake permanent and reprocessing impossible.
7. **Threshold alerting on crash count.** Pages on steady-state noise, silent on the small new regression. Alert on the derivative.
8. **The "let's self-host" reflex.** Taking on Kafka + ClickHouse + symbolicator + symbol server because it seems cheaper, without modeling the loaded cost of the team to run it.
9. **The infinite symbol store.** Uploading full DWARF for every PR build forever; the bill, not the disk, eventually screams.
10. **Non-idempotent everything.** Reprocessing that adds instead of replaces, corrupting the release-health math it exists to fix.

---

## Test Yourself

1. Your symbolication cost scales linearly with crash *volume*, not distinct crashes. What is missing, and what cache key makes it affordable?
2. A bad release takes crash volume from 10K/min to 10M/min and your *crash pipeline* goes down (not the app). Walk through every design choice that prevented or caused this.
3. Crash count is flat but the crash DB's query latency went from 200ms to 40s. What's the most likely cause, why does it look like a database problem, and how do you bound it?
4. 18% of your native crashes are 4KB blobs no one can read, but they *are* arriving. What's wrong, and what gate catches it before the next release?
5. Every Android release fills your dashboard with hundreds of "new" issues that are old bugs. Give the concrete mechanism (name the tool) and the fix.
6. A beta tester crashes on a build *before* CI finished uploading its symbols. Describe the two clocks, what the pipeline must do, and the one property the fix must have.
7. Design the regression-alert condition for a staged rollout: what's the metric, the baseline, the adoption gate, the sustain requirement, and what does the page contain?
8. Your `SIGSTKSZ`-sized alt stack worked for a decade and now silently fails to capture stack-overflow crashes on new hardware. Why, and what's the fix?
9. Your CFO asks whether to self-host the crash pipeline to cut the SaaS bill. Give the decision rule and the three systems self-hosting actually means operating.
10. A late symbol upload triggered reprocessing and crash-free rate got *worse* with no real regression. What happened and what's the one-word property the fix needs?

---

## Tricky Questions

**Q1: Why is the symbolication result cache the single most important component of an at-scale crash pipeline?**

Because symbolication is the most expensive operation (fetch hundreds of MB of DWARF/PDB per module, parse it, CFI-walk the stack, resolve inlines) *and* the most repetitive: the same build crashes at the same addresses millions of times. Without a `(build_id, module_offset) → symbolicated_frame` cache, cost scales with *event volume*. With it, cost scales with *distinct crashes* — which is orders of magnitude smaller and roughly flat even during a storm (a crash loop is one signature, so its millionth event is a cache hit). Moving the cache hit-rate from 90% to 99% can 10× the volume you can afford. The build ID makes the key immutable, so entries only go stale on explicit symbol replacement (which reprocessing handles). This one cache is the difference between an affordable pipeline and an unaffordable one.

**Q2: A bad release takes crash volume to 10M/min and your *crash pipeline* — not the app — goes down. Diagnose the design.**

The accept path symbolicated synchronously, so the expensive work was on the critical path of ingestion. When the storm hit, symbolication couldn't keep up, the queue (if any) or the workers backed up into the accept path, ingest returned 503/500, and the SDKs — seeing 500 rather than 429 + `Retry-After` — retry-stormed, multiplying the load. The pipeline became the outage while the app's actual bug was trivial. The fixes: (1) **accept-and-queue** — the accept path does only cheap validation and pushes to Kafka, decoupling symbolication so the storm *buffers* instead of backing up; (2) **per-signature spike protection at the edge** — a crash loop is one signature, so admit the first N for visibility and drop the rest cheaply *before* the queue; (3) **correct backpressure** — 429 + `Retry-After`, which SDKs honor, instead of 500, which triggers retries. The defining property: the pipeline's load correlates with your software's badness, so it must degrade gracefully under a 1000× spike of near-identical events.

**Q3: Crash count is flat but query latency exploded. Why does this look like a database problem, and what's the real cause?**

It looks like a database problem because the symptom is in the database (slow queries, collapsed compression) and the obvious crash metric (count) is unchanged. The real cause is a **series/cardinality explosion**: someone put an unbounded identifier (session ID, user ID, device serial, full URL) into a tag or fingerprint, so the number of *distinct series* — not events — exploded. Columnar stores compress by grouping like values; a unique-per-event field destroys that, bloating storage and scan time. The diagnostic is to attribute: is it event *count* (a crash-loop/throughput problem) or *series* count (a cardinality problem)? Here it's series. The fix is a **tag allowlist at ingest** — drop unbounded fields before they reach the store — plus stripping dynamic values from the fingerprint. The trap is spending days on ClickHouse tuning when the fix is one line in the ingest schema.

**Q4: 18% of native crashes are unreadable 4KB blobs, yet they're clearly arriving. What's wrong and how do you prevent it structurally?**

The minidumps are arriving fine; they just can't be *symbolicated* because the symbol server has no debug file matching some module's build ID — a stripped binary shipped with no separate `.debug`, a vendor `.so` whose symbols you never had, or a CI symbol-upload step that uploaded "what it had" and didn't fail on a missing file. "Symbols were uploaded" is not "all symbols were uploaded." The structural prevention is a **symbol-coverage gate in the release pipeline**: before a build is allowed to roll out, enumerate every module it will ship, compute each build ID, and assert the symbol server has a matching debug file — block the release otherwise. This converts a silent, invisible failure (crashes that arrive but can't be read, so no dashboard flags them) into a release-time block. Backfill the missing symbols and **reprocess** the raw dumps to recover the lost crashes.

**Q5: Every Android release floods your dashboard with fake "new" issues. Name the mechanism and the fix.**

The mechanism is **fingerprint drift caused by grouping on obfuscated frames before deobfuscation**. R8/ProGuard re-randomizes the obfuscation map on every build, so the same method `com.app.Checkout.scan()` is `a.b.c()` in one release and `x.y.z()` in the next. If you group on those obfuscated names, the *same bug* gets a *different fingerprint* every release and re-shatters into "new" issues, drowning the regression detector ("alert on new issues") in false positives so a real regression hides. The fix: upload `mapping.txt` per build (keyed by build UUID) and **deobfuscate server-side before grouping**, so the fingerprint is built from real, stable names. Same principle as symbolicate-before-group for native — group on what's stable across builds, never on what the obfuscator re-randomizes.

**Q6: A beta tester crashes on a build before CI finished uploading its symbols. Explain the clocks and the required fix property.**

Two unsynchronized clocks: the **field clock** (when users crash) and the **CI clock** (when builds and their symbols are produced). For a fresh build distributed to beta testers, the field clock can *precede* the CI clock — a tester crashes before the release pipeline finished uploading symbols/mapping. The event arrives unsymbolicatable. The pipeline must (a) **store the raw minidump** even when it can't symbolicate it yet, and (b) **reprocess** — when the symbols finally arrive (CI clock catches up), replay every stored raw dump from that build, re-symbolicate, re-group, and re-emit counts so release-health corrects itself. The one required property: **idempotency on event ID**. Reprocessing must *replace*, never *add* — otherwise replaying double-counts and corrupts the crash-free math it exists to repair.

**Q7: Design the regression-alert condition for a staged rollout. Be specific.**

Metric: per-signature `crash_rate = events(signature, release) / sessions(release)` (adoption-weighted, not raw count). A signature regresses if it's **new** (events in release N, zero in all releases < N) with at least `min_events`, *or* its rate exceeds `baseline_rate(signature) + k·σ` (a z-score / change-point on the signature's own history). Gates: **adoption** — `sessions(release) ≥ min_adoption_threshold` so you don't fire on a 1%-adoption canary's tiny, swingy denominators; **sustain** — the breach holds for ≥ W windows so a single-window blip doesn't page; **suppression** — ignored/won't-fix signatures are excluded (still counted for crash-free rate, just not paged). The page must name the **specific signature, segmented by OS/device/release** — a triage-ready ticket, not "crashes went up" — and, wired to the gate, halt the staged rollout (mobile) or trigger rollback (backend). The whole point is to alert on the *derivative* of the crash curve per signature, not its value, because a healthy product crashes thousands of times a day across known issues.

**Q8: Your alt stack, sized `SIGSTKSZ` for a decade, now fails to capture stack-overflow crashes on new hardware. Why?**

`SIGSTKSZ` used to be a small compile-time constant (often 8KB). Modern CPUs with wide register files (AVX-512 etc.) need far more space to save context in a signal frame, so glibc made the signal-stack minimum a *runtime* value. A binary that baked in the old compile-time `SIGSTKSZ` as a static array now allocates an alt stack too small for the actual signal frame on wide-register hardware. When a stack-overflow SIGSEGV fires, the handler runs on the alt stack — but the alt stack is too small, so the handler overflows *it* and crashes recursively, capturing nothing. The fix: size the alt stack at install time via `sysconf(_SC_SIGSTKSZ)` (or `getauxval(AT_MINSIGSTKSZ)` with a generous multiple) and `mmap` it, rather than hard-coding a static array. This is a real regression that broke crash handlers which had worked unchanged for years.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║            CRASH REPORTING — PROFESSIONAL (STAFF/PRINCIPAL) CHEAT SHEET       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  THE PIPELINE (refinery; symbolication = the cracking tower)                 ║
║   ingest(accept+queue) → store(dump:object, event:columnar) →                ║
║   SYMBOLICATE(cache×3) → group(after symbolicate+deobfuscate) → serve        ║
║   • load correlates with YOUR software's badness → accept path must be cheap ║
║   • symbolication = most expensive AND most cacheable; cache hit-rate is KING ║
║                                                                              ║
║  HANDLER INTERNALS (when capture FAILS, debug here)                          ║
║   • malloc unsafe = allocator LOCK may be held by crashed thread → HANG      ║
║   • mmap is the one signal-safe "alloc" (kernel VM, not heap lock)           ║
║   • SIGSTKSZ now RUNTIME → size alt stack via sysconf(_SC_SIGSTKSZ)          ║
║   • CAS sentinel for concurrent crashers; SA_RESETHAND for recursion         ║
║   • Crashpad = out-of-process; ptrace(Linux)/Mach port(mac)/pipe(Win)        ║
║                                                                              ║
║  MINIDUMP / SYMBOLS                                                          ║
║   • ModuleListStream carries BUILD ID = the universal join key               ║
║   • symbol server = CAS, /name/debug-id/name, CDN immutable-cached           ║
║   • dump_syms → .sym (MODULE/FUNC/STACK CFI); CFI needed for optimized code  ║
║   • GATE the release on symbol COVERAGE (unreadable crash = invisible bug)   ║
║                                                                              ║
║  CARDINALITY & COST                                                          ║
║   • crash-loop floods COUNT (quota) ; unbounded fp/tag floods SERIES (store) ║
║   • bound at INGEST with a tag allowlist; collapse PR builds to one release  ║
║   • count everything (release-health) ; SAMPLE the detail you retain         ║
║   • retention: raw dumps briefest, detail short, AGGREGATES long             ║
║                                                                              ║
║  REGRESSION ALERTING (page on derivative, not value)                        ║
║   • NEW-in-release OR rate > baseline+kσ ; adoption-gated ; sustained        ║
║   • segment by os/device/release ; suppress won't-fix ; one page per regress ║
║                                                                              ║
║  REPLAY / DEOBFUSCATION                                                      ║
║   • two clocks (field vs CI) unsynced → store raw dump → REPROCESS late      ║
║   • reprocessing MUST be idempotent on event id (replace, never add)         ║
║   • deobfuscate (R8 mapping.txt) + symbolicate BEFORE grouping               ║
║                                                                              ║
║  BUILD/BUY: buy unless data-residency or volume forces self-host            ║
║   self-host = operate Kafka + columnar store + symbolicator + symbol server  ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- **At staff/principal level you operate the crash pipeline, not consume it.** This page is the senior page's "system you operate," opened up: ingest, symbol server, symbolication, cost control, regression alerting, replay.
- **The pipeline is a streaming system whose load correlates with your software's badness** — it spikes exactly when you need it most. So the accept path must be cheap and decoupled (accept-and-queue), with edge spike protection and correct 429 backpressure, or the pipeline becomes the outage.
- **Symbolication is the cracking tower: the most expensive and the most cacheable operation.** A `(build_id, address) → frame` result cache, plus parsed-table and raw-file caches, is the economic foundation; hit-rate is the dominant cost lever. The build ID is the universal join key tying minidump to symbols.
- **The handler internals matter when capture fails.** `malloc` is unsafe because the allocator lock may be held by the crashed thread (hang, not crash); `mmap` is the one signal-safe allocation; `SIGSTKSZ` is now runtime-sized; Crashpad's out-of-process model snapshots the corpse from a healthy process via `ptrace`/Mach port/pipe.
- **A symbol server is content-addressed, build-ID-keyed, CDN-immutable-cached**, with retention tied to release adoption. Gate releases on symbol *coverage* — an unreadable crash is an invisible bug.
- **Cardinality is the silent cost bomb, bounded at ingest.** A crash-loop floods *count* (quota); an unbounded fingerprint/tag floods *series* (storage) and masquerades as a database problem. Count everything; sample the detail; tier retention with aggregates kept longest.
- **Alert on regressions, not crashes** — new or worsened signatures, adoption-gated, baseline-relative, segmented, won't-fix suppressed. This is the brain of the release-health gate.
- **Reconcile the field and CI clocks with idempotent reprocessing.** Store raw dumps; replay when symbols/mapping/rules arrive late; key on event ID so replay replaces, never double-counts. Deobfuscate and symbolicate before grouping.
- **Buy unless law or volume forces self-host** — self-hosting means operating a queue, a columnar store, a symbolicator, and a symbol server, with the on-call that implies.

---

## What You Can Build

- A **symbol-coverage release gate**: a CI job that enumerates every module a build ships, computes each build ID, asserts the symbol server has a matching debug file, and **blocks rollout** on any gap — turning unreadable crashes into a release-time failure.
- A **three-tier symbolication cache**: `(build_id, offset)` result cache (Redis) + parsed-symbol-table cache (per build ID, in-process) + raw-debug-file disk cache fronting object storage, with hit-rate exported as an SLI.
- A **cardinality guard at ingest**: a relay middleware that drops non-allowlisted tags, strips dynamic values from the pre-hash signature, collapses PR/dev builds to one synthetic release, and exports per-project series growth.
- A **regression detector**: adoption-gated, baseline-relative (z-score/EWMA), per-signature, segmented, won't-fix-suppressed — emitting one page per regression with the specific signature, wired to the staged-rollout halt / auto-rollback.
- A **reprocessing service**: triggered when symbols/mapping/grouping-rules arrive late, it replays raw dumps for the affected build, re-symbolicates/deobfuscates/regroups, and re-emits counts idempotently on event ID so release-health self-corrects.
- A **cost-attribution dashboard**: breaks the monthly crash bill into the five cost-model terms (ingest, symbolication, series×retention, dump storage, query) so "the bill tripled" is answered with "this term, this signature/tag."
- A **handler-internals test harness**: triggers heap-corruption SIGSEGV, stack overflow (verifying runtime-sized alt stack), concurrent multi-thread crashes (verifying the CAS sentinel), and crash-during-init, asserting each produces a complete, symbolicated, *non-hanging* report — in CI.

---

## Further Reading

- **Handler & minidump internals**
  - Crashpad source + design docs (out-of-process, exception ports, `CrashReportDatabase`) — <https://chromium.googlesource.com/crashpad/crashpad/>
  - Breakpad source (in-process, `dump_syms`, `minidump_stackwalk`) — <https://chromium.googlesource.com/breakpad/breakpad/>
  - The Minidump file format (`MINIDUMP_HEADER`, stream directory) — Microsoft Docs / Breakpad `minidump_format.h`.
  - `man 7 signal-safety` — the authoritative async-signal-safe allowlist.
  - The `SIGSTKSZ` runtime-value change — glibc 2.34 release notes and the `AT_MINSIGSTKSZ`/`_SC_SIGSTKSZ` discussion.
- **Symbolication & symbol servers**
  - Sentry `symbolicator` (Rust, open source) — the reference at-scale symbolication service. <https://github.com/getsentry/symbolicator>
  - The SymSrv symbol-server layout — Microsoft Docs "Symbol Stores and Symbol Servers."
  - `sentry-cli debug-files` and the debug-ID model — <https://docs.sentry.io/product/cli/dif/>
  - LLVM `llvm-symbolizer`, `addr2line`, Apple `atos`/`symbolicatecrash`, `swift-demangle`.
- **Deobfuscation**
  - R8/ProGuard `mapping.txt` and `-keepattributes SourceFile,LineNumberTable` — Android developer docs.
  - Sentry/Crashlytics ProGuard/R8 upload integrations.
- **Pipeline & cost**
  - Sentry self-hosted architecture (Relay → Kafka → Snuba/ClickHouse) — <https://develop.sentry.dev/>
  - [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) — the cost/cardinality dimension in depth.
  - [`../observability-engineering/professional.md`](../observability-engineering/professional.md) — operating the stateful telemetry stack.
- **Android/iOS OS-level capture**
  - Android `debuggerd`/`tombstoned` and tombstone format; `ApplicationExitInfo`.
  - Apple MetricKit `MXCrashDiagnostic` and `.dSYM`/UUID symbolication.

---

## Related Topics

- **Down a level:** [senior.md](senior.md) — the crash pipeline as a system you operate: signal-safety rule, crash-free SLO, release-health gate, fingerprint contract, mobile/backend split.
- **Further down:** [middle.md](middle.md) — wiring the SDK, grouping overrides, symbol upload, scrubbing. [junior.md](junior.md) — global handlers, anatomy of a report, why symbolication exists.
- **Interview prep:** [interview.md](interview.md)
- **Practice:** [tasks.md](tasks.md)

**Sibling diagnostic topics:**

- [Debugging — Professional](../debugging/professional.md) — RCA culture and incident response for the crashes this pipeline surfaces; the memory-corruption fluency the handler internals require.
- [Observability Engineering — Professional](../observability-engineering/professional.md) — operating the stateful telemetry stack (queue, columnar store) this pipeline is built on.
- [Telemetry Cost and Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the dollar dimension of cardinality, retention, and sampling.
- [Metrics — Professional](../metrics/professional.md) — the change-point/anomaly math behind regression alerting.
- [Dynamic Instrumentation and eBPF](../dynamic-instrumentation-and-ebpf/) — `ptrace`/`process_vm_readv` and the kernel mechanisms Crashpad's capture uses.
- [Post-Mortem Analysis](../post-mortem-analysis/) — turning a halted release and its regression into a write-up and a CI fix.
- [Panic and Recovery](../panic-and-recovery/) — the in-runtime half of crash capture, below which the native pipeline takes over.

**Cross-roadmap links:**

- [Refactoring — Tooling & Automation](../../code-craft/refactoring/05-tooling-and-automation/) — the CI-automation discipline symbol upload, the coverage gate, and the release gate all require.
- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — cleaner errors symbolicate and group better.

---

## Diagrams & Visual Aids

### The pipeline as a refinery — where cost and risk live

```text
   INGEST                 STORE                   SYMBOLICATE (cracking tower)      GROUP        SERVE
   ──────                 ─────                   ────────────────────────────      ─────        ─────
   SDKs ─► LB ─► relay ─► Kafka ─► [object store: ─► fetch DWARF/PDB by BUILD-ID ─► fingerprint ─► columnar
           │     (cheap     (shock   raw dumps]      walk stack w/ CFI               (after        query +
           │      accept,    absorb) [columnar:      addr → func:line + inlines       symbolicate   release-
           │      allowlist,          events]        ▲ CACHE×3 OR DIE ▲               + deobfusc.)   health
           │      spike-prot,                        result / parsed-table / file                    aggregates
           │      429+Retry)                                                                          (kept LONG)
           ▼
   LOAD CORRELATES WITH YOUR SOFTWARE'S BADNESS → accept path must be cheap + decoupled
```

### The build-ID join (the universal key)

```text
   MINIDUMP                              SYMBOL SERVER (CAS)
   ────────                              ───────────────────
   ModuleListStream:                     /myapp.so/1A2B...00/myapp.so.debug
     myapp.so  @0x7f.. build=1A2B...00 ──────────┐
     libc.so   @0x7e.. build=8D2A...A1           │ GET (deterministic, immutable URL)
                                                  ▼
   frame addr 0x7f..4f42                  fetch + parse DWARF → CFI walk
        │  addr - load_addr = 0x4f42             │
        └────────────────────────────────────────► func: scan(QrFrame), checkout.cc:88
                                                   + inlined frames expanded
```

### Two clocks and reprocessing

```text
   FIELD CLOCK (users crash)        CI CLOCK (builds + symbols)
   ─────────────────────────        ──────────────────────────
   t0  beta tester crashes ─► event arrives UNSYMBOLICATED ─► store RAW DUMP (keep it!)
                                                                        │
   t1                          CI finishes symbol upload for build B    │
                                          │                             │
                                          ▼                             ▼
                              REPROCESS: replay raw dumps from B ─► re-symbolicate/deobfuscate
                                          ─► re-group ─► re-emit counts (IDEMPOTENT on event id)
                                          ─► release-health self-corrects
```

### Two different cost bombs

```text
   CRASH-LOOP (floods COUNT)              UNBOUNDED FINGERPRINT/TAG (floods SERIES)
   ─────────────────────────              ─────────────────────────────────────────
   one signature, millions of events      millions of DISTINCT signatures/series
   → quota / throughput / symbolication    → storage; columnar compression collapses
   → FIX: spike protection, rate limit,    → looks like a DB problem (40s queries)
          bounded queue, 429 backpressure  → FIX: tag allowlist at ingest, strip
   (count is huge, series is ~1)                  dynamic values from fingerprint
                                           (count may be normal, series is huge)
```

### Alert on the derivative, not the value

```text
   crash count
      │        ╭─╮            ╭─╮          ← absolute count: noisy, always high
      │   ╭─╮ ╱   ╲   ╭─╮    ╱   ╲         (4,000 known crashes/day — paging on this = spam)
      │  ╱   ╳     ╲ ╱   ╲  ╱     ╲
      └──────────────────────────────► time
                         ▲
                    NEW signature appears here  ← THIS is the page:
                    (rate >> its own baseline,     new-in-release OR rate>baseline+kσ,
                     adoption-gated, sustained)     adoption-gated, segmented, sustained
```

---
