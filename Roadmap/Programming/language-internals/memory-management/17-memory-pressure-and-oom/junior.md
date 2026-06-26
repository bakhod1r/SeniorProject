# Memory Pressure & OOM — Junior Level

> **Topic:** [Memory Pressure & OOM](README.md)
> **Focus:** What "running out of memory" actually means, why programs get killed, and the difference between asking for memory and using it.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Sooner or later every program meets the same wall: there is no more memory. When that happens your process does not get a polite error and a chance to recover. On Linux it usually gets **killed** — terminated instantly with no warning and no cleanup. The log says something like `Out of memory: Killed process 4821 (python)`, your service vanishes, and your pager goes off.

To reason about this you need to unlearn one comforting belief: that `malloc` (or `new`, or making a slice) "gives you memory." It mostly gives you a **promise**. The real memory is handed over later, lazily, the first time you actually touch each page. This is why a program can allocate 10 GB on a 4 GB machine without an error — and then die the moment it starts writing to that memory. Understanding this gap between *allocating* and *using* memory is the foundation of everything in this topic.

**Memory pressure** is the state where demand for memory is climbing toward what the machine can supply. Before the system fully runs out, it starts to struggle — slowing down, frantically shuffling data around — and these slowdowns are early warnings. **OOM** (Out Of Memory) is the end state, where the kernel gives up and kills something to survive.

This junior tier builds the vocabulary and mental model. The mechanics (the OOM killer's scoring, cgroups, swap thrashing) come in later tiers.

## Prerequisites

- Basic understanding of what a process is.
- The idea that programs ask the operating system for memory (via `malloc`, `new`, or your language's allocator).
- Comfort reading a few lines of C, Python, and shell.
- A rough sense of what RAM is versus disk.

## Glossary

- **RAM (physical memory):** The actual fast memory chips. Finite. The thing you run out of.
- **Virtual memory:** The address space a process *thinks* it has. Can be far larger than physical RAM.
- **Page:** The unit the OS manages memory in, almost always 4 KB. Memory is given out one page at a time.
- **RSS (Resident Set Size):** How much physical RAM your process is *actually using right now*. This is the number that matters.
- **VSZ / virtual size:** How much address space your process has *reserved*. Usually much larger than RSS and mostly meaningless for "am I about to die."
- **Allocation:** Asking for memory (`malloc`, `new`). Cheap. Often does not touch physical RAM at all.
- **Touch / first write:** The moment you actually read or write a page. This is when physical RAM is committed.
- **OOM (Out Of Memory):** The condition where the system cannot satisfy a memory demand even after trying everything.
- **OOM killer:** The Linux kernel component that picks a process and kills it to free memory.
- **`SIGKILL`:** Signal 9. The uncatchable, instant-death signal the OOM killer uses. Your process cannot trap it or clean up.
- **Swap:** Disk space used as overflow for RAM. Slow. We will meet it properly in later tiers.

## Core Concepts

### 1. Allocating is not using

When you call `malloc(1_000_000_000)`, the C library asks the kernel for a billion bytes of *address space*. The kernel says "sure" and returns a pointer — but it has not reserved a single byte of physical RAM. It has just drawn a region on a map. Physical pages get attached only when you write to them.

This behavior is called **lazy allocation** (or demand paging). The consequence is profound and surprising:

> `malloc` almost never fails, even when you ask for more than exists. The failure happens *later*, when you touch the memory, and that failure is not a returned error — it's the OOM killer.

So the classic defensive code `if (malloc(...) == NULL) { handle_error(); }` rarely triggers on Linux. The death comes from a different direction entirely.

### 2. RSS is the number that matters

Two numbers describe your process's memory:

- **VSZ (virtual size):** everything you reserved. A program can have a 20 GB VSZ and use 200 MB of real RAM.
- **RSS (resident set size):** the physical pages actually backing your process. This is what counts against the machine's RAM.

When people say "this process is using 3 GB," they mean RSS. When the machine runs low and the kernel needs a victim, it looks at who is consuming real pages — RSS — not who reserved the most address space.

### 3. The kernel runs out, then kills

When every process's combined RSS plus everything else (the OS, caches it can't free) approaches physical RAM, the kernel tries to make room: it drops cached file data, it may move pages to swap. If those efforts fail and a process still needs a page that cannot be provided, the kernel invokes the **OOM killer**. The OOM killer chooses one process and sends it `SIGKILL`.

Three things make this brutal for beginners:

1. **It's instant and uncatchable.** `SIGKILL` cannot be caught, blocked, or handled. No `finally`, no destructors, no graceful shutdown. The process is simply gone.
2. **The victim is often innocent.** The kernel picks the process that frees the most memory, which is frequently the *biggest* process — not the one whose runaway loop caused the crisis. Your well-behaved database can be killed because a buggy script next to it exhausted RAM.
3. **The only evidence is in the kernel log.** Your application logs show nothing — they just stop. The story is in `dmesg` / the system journal.

### 4. Pressure comes before death

Before the kill, the system shows strain. It slows down because the kernel spends CPU reclaiming memory, and disk activity spikes if swap is involved. These symptoms — a service mysteriously getting slow under load, then disappearing — are the signature of memory pressure building to OOM. Learning to see the slowdown as a *warning* rather than a separate, unrelated problem is a key skill.

## Real-World Analogies

**The restaurant reservation book.** Allocating memory is like taking a reservation: you write a name in the book and promise a table. Using memory is the guests actually arriving and sitting down. A restaurant can take far more reservations than it has tables (overbooking), betting many won't show. It works fine — until everyone shows up at once. Then there are no tables, and someone gets turned away at the door (the OOM kill). The reservation (allocation) succeeded; the seating (touching the page) is what failed.

**The overbooked elevator.** The sign says "max 8 people." Ten squeeze in. The doors don't close, an alarm sounds, and someone has to get off — and the elevator doesn't ask politely; it just won't move until weight drops. The kernel similarly refuses to proceed and ejects a passenger.

**The lifeboat.** When a ship is sinking and the lifeboat is over capacity, the goal is survival of *something*, not fairness. The OOM killer is the kernel deciding "I will lose one process so the system as a whole survives, rather than freezing everyone."

## Mental Models

**Memory is a bank that lends more than it has.** The bank (kernel) issues loans (allocations) freely because most borrowers never draw the full amount. Trouble starts only when too many borrowers demand cash (touch pages) simultaneously. The bank doesn't fail when it issues the loan; it fails at the teller window.

**Two columns: reserved vs. real.** Keep two mental columns for every process. The left column (VSZ) is "reserved on paper" and can be huge and harmless. The right column (RSS) is "real RAM consumed" and is the only column the survival math uses. When you debug, always look right.

**Death by SIGKILL is a power cut, not a shutdown.** A normal exit is turning a computer off through the menu. An OOM kill is yanking the plug. Anything not already saved is lost; no shutdown hooks run. Design with the assumption that any process can be plug-pulled at any instant.

## Code Examples

### Allocation succeeds, touching kills

```c
// overcommit.c — demonstrates allocate-vs-touch on Linux
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    size_t gb = 1UL << 30;          // 1 GiB
    char *p = malloc(50 * gb);      // ask for 50 GiB

    if (p == NULL) {
        printf("malloc failed\n");  // rarely prints on Linux
        return 1;
    }
    printf("malloc of 50 GiB succeeded (no RAM used yet)\n");

    // Now actually touch the memory, page by page.
    // RSS climbs here. On a small machine, the OOM killer
    // ends the process partway through this loop.
    for (size_t i = 0; i < 50 * gb; i += 4096) {
        p[i] = 1;                   // first write to each page commits RAM
    }

    printf("touched all of it (you have a big machine)\n");
    return 0;
}
```

Run it on a 4 GB machine and you'll typically see "malloc … succeeded" print, then the program vanishes mid-loop with no message — killed. Check the kernel log:

```bash
dmesg | tail -n 20
# ... Out of memory: Killed process 1234 (overcommit) ...
```

### Watching RSS climb in Python

```python
# climb.py — watch resident memory grow
import os, time

def rss_mb():
    # statm reports pages; field 2 (index 1) is resident pages
    with open(f"/proc/{os.getpid()}/statm") as f:
        resident_pages = int(f.read().split()[1])
    return resident_pages * 4096 / (1024 * 1024)

chunks = []
while True:
    chunks.append(bytearray(50 * 1024 * 1024))  # 50 MB, and we touch it
    print(f"RSS = {rss_mb():.0f} MB")
    time.sleep(0.3)
```

`bytearray(n)` zero-fills, so it *touches* every page immediately — RSS climbs in real time. Watch the numbers grow until the process is killed.

### Reading the evidence after a kill

```bash
# Was my process OOM-killed? The kernel log is the source of truth.
dmesg -T | grep -i -A1 "killed process"

# Example output:
# [Tue Jun 24 10:02:11 2026] Out of memory: Killed process 4821 (python3)
#   total-vm:8421000kB, anon-rss:3980000kB, file-rss:0kB
```

`anon-rss` is the real RAM the victim was holding — the number the kernel cared about.

## Pros & Cons

The OOM killer and lazy allocation are deliberate design choices. They have real benefits and real costs.

**Pros (of the Linux overcommit + OOM model):**

- **Efficiency.** Programs routinely reserve more than they use (sparse arrays, large buffers used partially). Lazy allocation lets the machine pack many such programs together.
- **Simplicity for the programmer.** You allocate freely without negotiating exact physical budgets up front.
- **System survival.** When memory truly runs out, the OOM killer keeps the machine alive instead of freezing everything.

**Cons:**

- **Unpredictable victims.** The process that dies is often not the one at fault.
- **No graceful exit.** `SIGKILL` means no cleanup, no flushing, no last log line.
- **Hidden failures.** A successful `malloc` lulls you into thinking memory is available when it isn't, pushing failure to an inconvenient later moment.
- **Hard to test.** Bugs only appear under real memory load, which is awkward to reproduce.

## Use Cases

Where a junior engineer meets this topic in practice:

- **A service that "randomly" restarts.** It's often OOM. Check the kernel log and exit codes before blaming flaky hardware.
- **A batch job that dies on big inputs but works on small ones.** Classic touch-the-memory OOM as the dataset grows.
- **A container that won't stay up.** Containers have memory limits; exceeding them triggers an OOM kill scoped to that container (covered in later tiers).
- **A laptop that freezes under heavy load.** Memory pressure with swap, grinding to a crawl before something is killed.

## Best Practices

- **Look at RSS, not VSZ.** Use `ps -o pid,rss,vsz,comm` or `top` (the `RES` column). RSS is reality.
- **Assume any process can be killed at any instant.** Make work resumable: checkpoint long jobs, use durable queues so a killed worker's task is retried.
- **Don't rely on `malloc`/`new` returning an error.** On Linux it usually won't. Defensive null-checks are still correct C, but they are not your OOM safety net.
- **Set bounds on memory-hungry structures.** Cap cache sizes, batch sizes, and queue depths so growth is bounded rather than open-ended.
- **Check the kernel log first when a process disappears.** `dmesg -T | grep -i "killed process"` answers "was this OOM?" in seconds.
- **Reproduce with a small limit.** You don't need a huge dataset to test OOM behavior; run your program under a tight memory limit locally (later tiers show how with cgroups/`ulimit`).

## Edge Cases & Pitfalls

- **"My `malloc` succeeded so I have the memory."** No — you have an address-space promise. The check that matters is whether you can touch all of it.
- **Blaming the killed process.** The victim is frequently chosen for being *large*, not for being *guilty*. Investigate who *grew*, not only who *died*.
- **Watching the wrong number.** A 30 GB VSZ on a 16 GB machine is not necessarily a problem; a 15 GB RSS is. Beginners panic at VSZ and miss the real signal.
- **Expecting cleanup on death.** No destructors, `finally` blocks, atexit handlers, or buffered writes survive a `SIGKILL`. Files mid-write can be left truncated.
- **Confusing "slow" with "fine."** A system thrashing under memory pressure is seconds away from an OOM kill, not in a stable degraded state. Slowness is a fire alarm.
- **Trusting that calloc/zeroed memory is "already used."** `calloc` can still be lazy: the kernel can hand out a shared zero page and only commit real RAM on first write. Zeroing isn't always touching.

## Summary

- Memory has two faces: **allocation** (a cheap promise) and **use** (committing real physical RAM on first touch). The gap between them is where OOM bugs hide.
- On Linux, `malloc`/`new` rarely fail. You don't get an error when you run out; you get the **OOM killer** sending an uncatchable `SIGKILL`.
- **RSS** is the number that matters — real RAM in use. **VSZ** is mostly reserved address space and can be large and harmless.
- The OOM killer keeps the *system* alive by sacrificing one process, often the biggest rather than the guilty one, with no cleanup and no warning.
- **Memory pressure** — the slowdown before the kill — is an early warning, not a separate problem.
- Practical survival: watch RSS, bound your data structures, make work resumable, and read the kernel log first when a process mysteriously vanishes.
