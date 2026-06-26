# Allocators — Professional Level

> **Topic:** [Allocators](README.md)
> **Focus:** Production tuning and profiling — `MALLOC_CONF`, heap profiling with jeprof/tcmalloc, fragmentation diagnosis, decay tuning, container-aware sizing, custom-allocator deployment, and allocator security hardening.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [A diagnosis workflow for allocator problems](#a-diagnosis-workflow-for-allocator-problems)
  - [Tuning glibc malloc](#tuning-glibc-malloc)
  - [Tuning and profiling jemalloc](#tuning-and-profiling-jemalloc)
  - [Tuning and profiling tcmalloc](#tuning-and-profiling-tcmalloc)
  - [Fragmentation metrics that matter](#fragmentation-metrics-that-matter)
  - [Container-aware sizing](#container-aware-sizing)
- [Security Hardening](#security-hardening)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

In production, allocator work is mostly *operations*: a service whose RSS climbs until the OOM killer fires, a p99 latency spike traced to a `malloc` slow path, a container that mysteriously uses 4× the memory of the same binary on a laptop. None of these are fixed by rewriting `malloc`. They're fixed by *choosing* the right allocator, *configuring* it via environment variables, and *profiling* it with the tooling each allocator ships.

This tier is a practitioner's playbook: how to tell fragmentation from a leak, which knobs (`MALLOC_CONF`, `MALLOC_ARENA_MAX`, decay times) move which numbers, how to read a `jeprof` heap profile, and how to deploy and secure a custom or hardened allocator. The throughline: **make the allocator observable, then turn the right knob, then verify the RSS/latency curve actually moved.**

## Prerequisites

- Senior-tier understanding: per-thread caches, arenas, decay, RSS vs. virtual size, internal/external fragmentation, blowup.
- Comfort reading `/proc/<pid>/smaps`, `RSS`/`VSZ` from `top`/`ps`, and basic flame graphs.
- Familiarity with `perf`, `strace`, and at least one profiler.
- A service you can load-test and observe over hours, not seconds — allocator behavior is a *steady-state* property.

## Glossary

- **`MALLOC_CONF`:** jemalloc's (and tcmalloc-compatible) environment/config string for runtime options.
- **jeprof:** jemalloc's heap-profile renderer (fork of pprof); turns sampled allocation dumps into call-graph/flame views.
- **Dirty / muzzy pages (jemalloc):** Freed pages not yet purged. *Dirty* = unpurged; *muzzy* = `MADV_FREE`'d but still mapped. Two decay timers control each.
- **Decay time:** How long jemalloc waits before purging idle dirty/muzzy pages back to the OS.
- **Quarantine:** A delayed-reuse buffer (scudo/hardened_malloc) that holds freed chunks to catch use-after-free.
- **`mallctl`:** jemalloc's programmatic introspection/control API.
- **Release rate (tcmalloc):** How aggressively tcmalloc returns free pages to the OS.

## Core Concepts

### A diagnosis workflow for allocator problems

When memory or latency goes wrong, don't guess — triage:

```
1. Is RSS growing unbounded, or plateauing high?
     unbounded forever  -> likely a real LEAK (objects never freed)
     plateau / sawtooth -> likely FRAGMENTATION or undecayed pages

2. Compare "bytes your program holds" vs "RSS":
     allocator stats.allocated  vs  /proc/<pid>/status VmRSS
       allocated ~= RSS         -> not the allocator; it's your live set (leak or design)
       allocated << RSS         -> fragmentation + retained/dirty pages

3. If fragmentation: what's the size distribution?
     many tiny + few huge       -> size-class / arena fragmentation
     long-lived pinning runs    -> mix lifetimes badly; segregate by lifetime

4. If latency spikes: where does malloc go slow?
     thread-cache miss storms   -> tune cache size / arena count
     syscall (mmap/madvise)     -> tune decay / mmap threshold
```

The single most useful discriminator is step 2: **`allocated` vs `RSS`**. A real leak shows `allocated` itself climbing forever. Fragmentation shows a large, persistent gap between `allocated` and `RSS` while `allocated` is stable.

### Tuning glibc malloc

glibc's allocator is the default on most Linux and is tuned through `M_*` parameters (via `mallopt`) and a few environment variables:

- **`MALLOC_ARENA_MAX`** — caps the number of arenas. Default is roughly `8 × nproc`, sized to *host* cores. In a container limited to 2 CPUs on a 96-core host, glibc may still create dozens of arenas, each retaining freed memory → bloated RSS. Setting `MALLOC_ARENA_MAX=2` (or `1`) is the classic container memory fix.
- **`M_MMAP_THRESHOLD` / `MALLOC_MMAP_THRESHOLD_`** — requests above this go straight to `mmap`/`munmap` (returned to OS immediately) instead of the heap. Default is dynamic (starts ~128 KiB, grows). Pin it if you allocate many medium-large buffers and want predictable return.
- **`M_TRIM_THRESHOLD` / `MALLOC_TRIM_THRESHOLD_`** — how much free space must accumulate at the top of the heap before `sbrk` shrinks it back. `malloc_trim(0)` forces a trim.
- **glibc `tcache`** — per-thread cache of up to 7 chunks per size class by default (`glibc.malloc.tcache_count`, `tcache_max`). Speeds small allocations but adds per-thread retention.

```bash
# Common container hardening for a glibc service:
export MALLOC_ARENA_MAX=2
export MALLOC_TRIM_THRESHOLD_=131072
```

### Tuning and profiling jemalloc

jemalloc is configured through the `MALLOC_CONF` string (or a weak-symbol `malloc_conf`, or `/etc/malloc.conf`). Key options:

- **`narenas:N`** — number of arenas (default `4 × CPUs`). Lower it for memory-constrained, contention-light services.
- **`dirty_decay_ms` / `muzzy_decay_ms`** — milliseconds to retain dirty/muzzy pages before purging. `0` = purge immediately (lowest RSS, more syscalls/faults); a few seconds smooths churn. The headline RSS knob.
- **`tcache:true` / `tcache_max`** — per-thread cache controls.
- **`background_thread:true`** — let a background thread perform purging, keeping it off the hot path.
- **`prof:true,prof_active:true,lg_prof_sample:N`** — enable sampled heap profiling.

Heap profiling workflow:

```bash
# Run with profiling on; dump on demand and at exit.
export MALLOC_CONF="prof:true,prof_active:true,lg_prof_sample:19,prof_prefix:/tmp/jeprof.out"

./my_service &              # run workload...
# trigger a dump via the app (mallctl "prof.dump") or on exit it writes the file

# Render: which call paths hold the most live bytes?
jeprof --show_bytes --pdf ./my_service /tmp/jeprof.out.*.heap > heap.pdf
jeprof --text       ./my_service /tmp/jeprof.out.*.heap | head -30
```

`lg_prof_sample:19` samples roughly every 512 KiB (2^19) of allocation — cheap enough for production. The output is a call-graph attributing *live* (or cumulative) bytes to allocation sites, which is how you find both leaks (a site whose live bytes only grow) and churn hot spots.

Inspect live state without a profiler via `mallctl`/`malloc_stats_print`:

```c
// Dump human-readable stats (per-arena, per-size-class, dirty/muzzy pages):
malloc_stats_print(NULL, NULL, NULL);
```

### Tuning and profiling tcmalloc

tcmalloc (the modern Google version, and the older gperftools one) offers:

- **Per-CPU caches** (`rseq`-based) vs. per-thread caches — per-CPU scales better on many-core boxes.
- **Release rate** — how fast free pages return to the OS (`MallocExtension::SetMemoryReleaseRate`, or `TCMALLOC_RELEASE_RATE`). Higher = lower RSS, more syscalls.
- **`MallocExtension::GetStats()`** and the pprof HTTP handler for heap profiles.

```bash
# gperftools-style heap profiling:
export HEAPPROFILE=/tmp/myheap
./my_service                 # writes /tmp/myheap.0001.heap, ...
pprof --text ./my_service /tmp/myheap.0001.heap
```

Both jemalloc and tcmalloc integrate with `pprof`-family tooling, so the muscle memory transfers between them.

### Fragmentation metrics that matter

Track these continuously, not just during incidents:

- **`allocated` / `resident` ratio** (jemalloc `stats.allocated` vs `stats.resident`). The closer to 1.0, the less waste. A persistent 0.5 means half your RSS is fragmentation + unpurged pages.
- **`retained`** (jemalloc) — virtual memory returned to the allocator but not the OS; large `retained` is usually fine (it's not RSS) but signals churn.
- **Live bytes vs. RSS delta over time** — diverging lines = fragmentation accumulating.
- **Page-fault and `madvise` syscall rates** (`perf stat`, `/proc/<pid>/stat`) — high rates mean decay is too aggressive (thrashing).

### Container-aware sizing

Containers are where allocator defaults bite hardest, because most allocators read *host* CPU/memory, not cgroup limits:

- Cap arenas: `MALLOC_ARENA_MAX` (glibc) / `narenas` (jemalloc) to match the cgroup CPU quota, not host cores.
- Account per-thread/per-arena cache retention in your memory limit — N threads × cache size adds up.
- Set decay/release to favor lower RSS when running under tight cgroup memory limits (a co-tenant or the OOM killer is less forgiving than spare host RAM).
- Verify with `cat /sys/fs/cgroup/memory.current` (cgroup v2) under load, not just `top`.

## Security Hardening

Allocator metadata is a prime exploitation target: heap overflows that smash chunk headers, use-after-free, double-free, and free-list poisoning have driven a generation of exploits. Hardened allocators defend the heap itself:

- **scudo** (LLVM, Android default): chunk header checksums (detect corruption), randomized chunk placement, a **quarantine** that delays reuse of freed memory (catches use-after-free/double-free), and separation of metadata from user data. Modest overhead for meaningful exploit mitigation.
- **GrapheneOS `hardened_malloc`**: aggressive — fully out-of-line metadata, guard pages, randomized layout, zero-on-free, slab isolation by size class. Higher overhead, strong guarantees; used where security dominates.
- **glibc hardening:** modern glibc adds tcache double-free detection, `__libc_malloc` safe-linking (XOR-mangled free-list pointers so a leaked pointer can't be trivially overwritten), and chunk-size sanity checks. `GLIBC_TUNABLES=glibc.malloc.check=3` enables extra consistency checking (dev/debug, not production-hot).
- **General principle:** keep allocator metadata *away from* attacker-writable user data, *validate* it on every operation, *randomize* placement, and *delay* reuse. These cost speed and memory; you spend that budget where input is untrusted (browsers, parsers, mobile, network-facing daemons).

When you deploy a custom allocator, you *opt out* of these protections unless you reimplement them — a real consideration for security-sensitive code paths.

## Real-World Analogies

- **Decay tuning = thermostat hysteresis.** Purge too eagerly and you thrash (heat/cool/heat). A dead band (decay interval) keeps the system stable — return pages only after they've been idle a while.
- **`allocated` vs `RSS` = inventory vs. warehouse footprint.** You might hold $1M of goods (allocated) but rent a warehouse sized for $2M (RSS) because the goods are spread out and you haven't consolidated. The gap is fragmentation.
- **Quarantine = a holding cell for released memory**, so anyone still clutching a stale key (dangling pointer) is caught red-handed instead of unlocking someone else's room.

## Mental Models

1. **Observe before you tune.** Every allocator ships introspection (`mallctl`, `malloc_stats_print`, pprof). Wire it into metrics first; turning knobs blind is how you trade one pathology for another.

2. **One knob, one number, one verification.** Change `dirty_decay_ms`, watch RSS and `madvise` rate, confirm the trade went the way you intended. Don't change five options at once.

3. **Defaults are host-shaped, production is cgroup-shaped.** The biggest, cheapest wins in containers come from making the allocator respect the *limit*, not the *host*.

4. **Security is a budget you spend deliberately.** Hardened/quarantined allocation costs throughput and RSS; apply it to untrusted-input surfaces, not uniformly.

## Code Examples

### Forcing a trim and dumping stats (glibc)

```c
#include <malloc.h>
#include <stdio.h>

void report_and_trim(void) {
    struct mallinfo2 mi = mallinfo2();
    printf("arena=%zu in-use=%zu mmapped=%zu top-free=%zu\n",
           mi.arena, mi.uordblks, mi.hblkhd, mi.keepcost);

    malloc_trim(0);                 // return free top-of-heap pages to the OS
    malloc_stats();                 // human-readable per-arena dump to stderr
}
```

`uordblks` (bytes in use) far below `arena` (bytes obtained from the OS) is your fragmentation signal; `malloc_trim(0)` reclaims what it safely can.

### Triggering and reading a jemalloc heap profile programmatically

```c
#include <jemalloc/jemalloc.h>

void dump_heap_profile(const char *path) {
    // Force a profile dump to `path` (requires prof:true at startup).
    int err = mallctl("prof.dump", NULL, NULL, &path, sizeof(const char *));
    if (err) fprintf(stderr, "prof.dump failed: %d\n", err);
    // then offline:  jeprof --text ./binary path
}

void print_fragmentation(void) {
    uint64_t epoch = 1;
    size_t sz = sizeof(size_t), allocated = 0, resident = 0;
    mallctl("epoch", NULL, NULL, &epoch, sizeof(epoch));     // refresh counters
    mallctl("stats.allocated", &allocated, &sz, NULL, 0);
    mallctl("stats.resident",  &resident,  &sz, NULL, 0);
    double frag = 1.0 - (double)allocated / (double)resident;
    printf("fragmentation+unpurged: %.1f%%\n", frag * 100.0);
}
```

### Lifetime-segregated arenas to defeat pinning

```cpp
// Problem: a few long-lived objects sprinkled among short-lived ones pin
// whole runs/pages, inflating RSS. Fix: separate by lifetime.

std::pmr::monotonic_buffer_resource short_lived;   // reset per request
// long-lived objects go to the default global allocator instead.

void handle(Request& r) {
    std::pmr::vector<Token> scratch{&short_lived};  // dies with the request
    auto* persistent = new CacheEntry{...};         // global heap, outlives request
    // ...
}   // short_lived reclaimed wholesale; no long-lived object pins its pages
```

Mixing lifetimes in one allocator is one of the most common real-world fragmentation causes; segregating them is often a bigger win than any knob.

## Pros & Cons

**Aggressive decay / high release rate**

- Pros: minimal RSS, container/OOM-friendly, predictable footprint.
- Cons: more `madvise`/page-fault syscalls; latency jitter under realloc-heavy churn.

**Profiling always-on (sampled)**

- Pros: leaks and churn visible in production; root-cause without reproduction.
- Cons: small CPU/memory cost; profile storage and rotation to manage.

**Hardened allocator in production**

- Pros: contains heap-corruption exploits; turns silent corruption into a clean crash.
- Cons: throughput and RSS overhead; some debugging tools assume the default heap.

## Use Cases

- **Long-running service with creeping RSS:** diagnose `allocated` vs `RSS`, tune decay / `MALLOC_ARENA_MAX`, segregate lifetimes.
- **Container OOM kills despite "small" live set:** cap arenas to cgroup CPUs, lower release timers.
- **Latency p99 spikes on allocation:** raise thread-cache size, reduce purge aggressiveness, move purging to a background thread.
- **Security-exposed native daemon:** deploy scudo/hardened_malloc on the untrusted-input path.

## Coding Patterns

- **Allocator stats as first-class telemetry.** Export `allocated`/`resident`/`retained` (or tcmalloc equivalents) on your metrics endpoint; alert on the fragmentation ratio.
- **Profile-on-signal.** Wire a signal handler (or admin endpoint) to trigger `prof.dump` / heap dump so you can capture a profile from a misbehaving instance live.
- **Config, not code, for allocator selection.** Pick allocator and `MALLOC_CONF` via env/deploy config so you can A/B without a rebuild.
- **Segregate by lifetime, not just by size.** Arenas/pools per lifetime class (request, connection, process) prevent long-lived objects from pinning short-lived runs.

## Best Practices

- **Establish a baseline RSS curve under representative load before tuning**, then change one knob at a time and compare curves over hours.
- **In containers, always cap arenas** (`MALLOC_ARENA_MAX` / `narenas`) to the CPU quota — this single change resolves a large fraction of "container uses too much memory" reports.
- **Turn on sampled heap profiling in production** (`lg_prof_sample` ~19); the overhead is negligible and the diagnostic value when an incident hits is enormous.
- **Distinguish leak from fragmentation before acting** — they have opposite fixes (find the missing free vs. tune/segregate).
- **Keep the allocator consistent across shared-library boundaries**; never free across allocator boundaries.
- **Apply hardening surgically** to untrusted-input surfaces; measure the cost.

## Edge Cases & Pitfalls

- **Tuning by microbenchmark.** A knob that wins a synthetic loop can regress real steady-state RSS. Always validate on the real workload over time.
- **`MADV_FREE` masquerading as a leak.** RSS doesn't fall after frees because the kernel only reclaims `MADV_FREE` pages under pressure. Confirm with allocator `resident`/`retained` before filing a leak bug.
- **Container arena explosion.** Forgetting `MALLOC_ARENA_MAX` on a high-core host inflates a small container's RSS several-fold.
- **Over-aggressive decay → syscall thrash.** `dirty_decay_ms:0` on a realloc-heavy service can spike CPU in `madvise` and page faults; a small decay window is usually better.
- **Profiling sample too fine.** A tiny `lg_prof_sample` adds real overhead and noise; default to coarse sampling in prod.
- **Custom allocator drops hardening silently.** Replacing the system allocator on a security-sensitive path removes scudo/glibc protections unless you reimplement them.
- **Stats not epoch-refreshed.** jemalloc `stats.*` are cached; forgetting the `epoch` `mallctl` returns stale numbers and a wrong diagnosis.

## Summary

Professional allocator work is observe → tune → verify. The decisive diagnostic is **`allocated` vs. `RSS`**: equal-and-climbing means a leak (find the missing free); a persistent gap means fragmentation or unpurged pages (tune decay, cap arenas, segregate lifetimes). Each production allocator exposes the levers and the telemetry: glibc via `MALLOC_ARENA_MAX`/`M_*` and `malloc_trim`/`mallinfo2`; jemalloc via `MALLOC_CONF` (`narenas`, `dirty_decay_ms`, `prof`) plus `mallctl`/`jeprof`; tcmalloc via per-CPU caches, release rate, and pprof. Containers demand cgroup-aware sizing — capping arenas is the highest-ROI fix. Always-on sampled heap profiling turns incidents into call-graphs instead of guesswork. And where input is untrusted, hardened allocators (scudo, hardened_malloc, glibc safe-linking) trade measured overhead to contain heap-corruption exploits — a budget you spend deliberately, and one a custom allocator silently forgoes.
