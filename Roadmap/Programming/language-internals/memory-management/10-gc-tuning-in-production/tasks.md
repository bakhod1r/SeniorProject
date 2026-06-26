# GC Tuning in Production — Hands-On Tasks
> **Topic:** [GC Tuning in Production](README.md)

These tasks build from "turn on the lights" to "run an SLO-driven tuning exercise like an SRE." Most require nothing but a JVM and/or a Go toolchain on your laptop. Do them in order; each assumes the previous. Resist the urge to change flags before you've measured — the discipline *is* the lesson.

---

## Table of Contents
- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Turn on GC visibility
Write a tiny program in your runtime of choice that allocates in a loop (e.g. a Go loop appending to and discarding slices, or a Java loop creating short-lived arrays). Run it twice: once silent, once with GC tracing on (`GODEBUG=gctrace=1` for Go, `-Xlog:gc` for the JVM).

**Self-check:**
- [ ] I produced at least 10 GC log lines.
- [ ] I can point to where the program's heap grew and where a collection happened.
- [ ] I did *not* change any tuning flag yet — only enabled logging.

*Hint:* If you see no GC activity, your program isn't allocating enough; make the loop run longer or allocate larger objects.

### Task 2 — Decode a single GC log line
Take one line from Task 1 and annotate every field in a comment: which numbers are pause times, which is the throughput cost, which is the live set, which is the next-collection goal.

**Self-check:**
- [ ] I identified the STW pause time(s).
- [ ] I identified the GC% / throughput cost (Go) or the pause duration (JVM).
- [ ] I identified heap before → after and the live set.

*Hint:* For Go, the `N%` after the timestamp is the throughput cost; the `a->b->c MB` is before→after-mark→live. For a JVM `Pause Young` line, `512M->96M(2048M)` is before→after(total) and the trailing `Xms` is the pause.

### Task 3 — Watch a bigger heap collect less often
Run your Task 1 program with two different heap settings: a small one and a large one (Go: `GOGC=50` vs `GOGC=400`; JVM: `-Xmx256m` vs `-Xmx2g`). Count the number of GC cycles in a fixed run.

**Self-check:**
- [ ] The larger heap / higher GOGC produced **fewer** collections.
- [ ] I can state the trade I just made (fewer pauses, more memory).
- [ ] I recorded both counts so the comparison is concrete, not remembered.

---

## Core

### Task 4 — Measure before/after on the allocation lever
Write a hot path that allocates a fresh buffer every iteration. Capture GC% (Go) or GC frequency (JVM). Then refactor to **reuse one buffer** (`sync.Pool` or a hoisted `byte[]`). Re-measure.

**Self-check:**
- [ ] GC% / frequency dropped measurably after reusing the buffer.
- [ ] I changed *only* the allocation pattern, not any flag.
- [ ] I can quantify the improvement with numbers from both runs.

*Hint:* Make `process(buf)` do enough work that the program runs for several seconds, or the difference will be in the noise.

### Task 5 — Build a 5-signal GC dashboard (even if it's just printed numbers)
From your GC logs, extract and report over time: GC%, pause p99, GC frequency, heap-after-GC, and allocation rate. A script that parses the log and prints these is fine; a Grafana panel is better.

**Self-check:**
- [ ] All five signals are present.
- [ ] I plot heap-after-GC as a *trend*, not a single number.
- [ ] I can explain which signal would reveal a leak (heap-after-GC floor) and which reveals a deploy regression (GC%).

### Task 6 — Reproduce and identify a memory leak vs. a tuning problem
Write a program with an unbounded cache (a map you only ever insert into). Run it and watch heap-after-GC. Then write a second version with bounded churn (high allocation, but everything dies). Compare the heap-after-GC trends.

**Self-check:**
- [ ] The leaky version shows a **rising** heap-after-GC floor.
- [ ] The churn version shows a **flat** heap-after-GC floor despite heavy GC.
- [ ] I can articulate why no GC flag fixes the first case.

*Hint:* This is the single most important diagnostic intuition in the whole topic. If you internalize the difference between "rising floor" and "flat floor," you'll never again waste an incident tuning a leak.

### Task 7 — The container memory mismatch
Run a JVM or Go program inside a container with a memory limit (Docker `--memory=512m`). For the JVM, first run *without* container-aware sizing or with a too-large `-Xmx` and observe an OOMKill; then fix it with `-XX:MaxRAMPercentage=70` (or `GOMEMLIMIT` for Go) and observe survival.

**Self-check:**
- [ ] I triggered an OOMKill (exit 137) by over-sizing the heap vs. the limit.
- [ ] I fixed it by sizing the heap *below* the cgroup limit with headroom.
- [ ] I can explain why the heap looked "fine" right up to the kill (RSS, not heap, crossed the limit).

*Hint:* `docker run --memory=512m ...` then check `docker inspect` / exit code. Exit code 137 = SIGKILL from the OOMKiller.

---

## Advanced

### Task 8 — Collector A/B test under load
Take a small allocating service (an HTTP handler that does real work and allocates). Drive it with a load generator at a fixed rate. Run it under two JVM collectors (e.g. Parallel vs G1, or G1 vs ZGC) and compare **pause p99** and **GC%/throughput**.

**Self-check:**
- [ ] I measured the *same* workload under both collectors.
- [ ] I observed the expected trade: the lower-pause collector had higher GC overhead (or lower throughput).
- [ ] I can state which collector I'd ship for a tight-tail SLO vs. a batch job, with my own numbers as evidence.

*Hint:* Keep the load generator rate identical across runs; otherwise you're comparing two different experiments.

### Task 9 — Tune `GOGC` + `GOMEMLIMIT` together
Take a Go service with a known live set. Set `GOGC=off` and watch the heap grow unbounded (in a safe environment). Then add `GOMEMLIMIT` and confirm the GC kicks in to hold the ceiling. Finally, set a high `GOGC` *with* `GOMEMLIMIT` and observe lazy collection on a normal day but aggressive collection near the limit.

**Self-check:**
- [ ] With `GOGC=off` and no limit, the heap grew without collecting.
- [ ] Adding `GOMEMLIMIT` made the GC run to stay under the ceiling.
- [ ] I can explain why this combo retired the historical "ballast" trick.

*Hint:* Use `GODEBUG=gctrace=1` to *see* the GC start firing as you approach `GOMEMLIMIT`. Set the limit low enough (e.g. a few hundred MiB) that you reach it quickly.

### Task 10 — Provoke and fix a Full GC / promotion failure (JVM)
Construct a workload that promotes objects to old gen faster than G1 expects (a growing cache plus heavy young-gen churn under burst). Find a `Pause Full` in the log. Then mitigate by lowering `InitiatingHeapOccupancyPercent` and/or adding heap headroom, and confirm the Full GCs disappear.

**Self-check:**
- [ ] I produced at least one `Pause Full` line and noted its (long) duration.
- [ ] Lowering IHOP / adding headroom eliminated or reduced the Full GCs.
- [ ] I can explain why a Full GC shows up as a latency *cliff*, not a gentle rise.

*Hint:* Grep the GC log for `Full`. A periodic cliff that correlates with a load pattern is the real-world signature of this failure.

---

## Capstone

### Task 11 — Run an SLO-driven tuning exercise end to end
Pick (or build) a service with a real handler that does work and allocates. Define a written SLO: e.g. **"p999 latency < 150 ms at 2× the load I can generate."** Then execute the full professional workflow and write a one-page report.

Steps to perform and document:
1. **Baseline:** capture GC%, pause p99/p999, frequency, heap-after-GC, allocation rate at 2× load.
2. **Reduce allocation:** profile the top allocation sites and eliminate the biggest; re-measure.
3. **Size the heap:** give headroom (`-Xms`=`-Xmx` / `GOMEMLIMIT` below the container limit); re-measure.
4. **Pick/confirm the collector:** justify it against the pause budget you derived from the SLO.
5. **Micro-tune** one knob (e.g. `MaxGCPauseMillis`); re-measure.
6. **Validate** the SLO under 2× load and write up before/after numbers.

**Self-check:**
- [ ] My report has a written SLO with a **percentile and a load condition**.
- [ ] I followed the order *reduce allocation → size heap → pick collector → micro-tune* and showed numbers at each step.
- [ ] I changed one thing at a time and can attribute each improvement.
- [ ] I derived the pause budget from the latency budget (not a guessed flag value).
- [ ] My final config meets the SLO at 2× load, demonstrated, not asserted.

*Hint (sparse solution sketch):* The biggest win is almost always step 2 (allocation) and step 3 (heap sizing); collector choice and micro-tuning usually matter less than beginners expect. If your allocation-reduction step did nothing, you probably profiled the wrong thing — use an *allocation* profile (`-alloc_space` / allocation flame graph), not an in-use/CPU profile.

### Task 12 — Write a runbook entry for one war story
Pick one failure mode (allocation regression after deploy, off-heap OOMKill, Full GC cliff, leak, or ZGC allocation stall). Write a runbook entry an on-call engineer could follow at 3 a.m.: symptom, first three things to check, the discriminating signal, and the fix.

**Self-check:**
- [ ] My "discriminating signal" actually distinguishes this failure from the others (e.g. heap-after-GC trend for a leak, RSS-vs-heap for off-heap OOM, GC% diff vs. previous release for an allocation regression).
- [ ] The fix addresses the root cause, not the symptom.
- [ ] An engineer who has never seen this failure could follow it without me.

---

## Self-Assessment

Rate yourself honestly. You're solid on this topic when you can:

- [ ] Explain the latency/throughput/footprint triangle and place any tuning decision inside it.
- [ ] Read a Go `gctrace` line and a JVM `-Xlog:gc` line and name the throughput cost, pause time, and live set.
- [ ] Tell a **leak** from a **tuning problem** using the heap-after-GC trend — without touching a flag first.
- [ ] Tell an **allocation regression** from a **collector problem** using a GC%-vs-previous-deploy comparison.
- [ ] Size a heap correctly inside a container (`MaxRAMPercentage` / `GOMEMLIMIT`) and explain why heap ≠ RSS.
- [ ] Choose a collector (Parallel / G1 / ZGC / Shenandoah) from a workload's SLO, heap size, and throughput budget — and state the cost of the choice.
- [ ] Use `GOGC` + `GOMEMLIMIT` together and explain why it retired the ballast trick.
- [ ] Run the full order — reduce allocation → size heap → pick collector → micro-tune — and resist jumping to the flag.
- [ ] Derive a GC pause budget from a latency SLO with a percentile and a load condition, then validate under load.

If any box is unchecked, the corresponding task above is where to go back.
