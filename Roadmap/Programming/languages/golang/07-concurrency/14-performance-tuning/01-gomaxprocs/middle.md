# `GOMAXPROCS` Performance Tuning — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Sweep Methodology From First Principles](#sweep-methodology-from-first-principles)
3. [Building a Reusable Sweep Harness](#building-a-reusable-sweep-harness)
4. [Statistical Hygiene for Sweeps](#statistical-hygiene-for-sweeps)
5. [Throughput, Latency, and CPU Utilisation Together](#throughput-latency-and-cpu-utilisation-together)
6. [Interpreting a Sweep Curve](#interpreting-a-sweep-curve)
7. [Containers and CFS Throttling](#containers-and-cfs-throttling)
8. [Detecting Throttling From Inside the Process](#detecting-throttling-from-inside-the-process)
9. [NUMA Topology — A Pragmatic Tour](#numa-topology--a-pragmatic-tour)
10. [Mixed CPU and I/O Workloads in Practice](#mixed-cpu-and-io-workloads-in-practice)
11. [Sweep Recipes per Workload Class](#sweep-recipes-per-workload-class)
12. [When the Sweep Shows No Effect](#when-the-sweep-shows-no-effect)
13. [Co-Tenancy and Headroom Sizing](#co-tenancy-and-headroom-sizing)
14. [Middle-Level Checklist](#middle-level-checklist)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

Junior level covered the *why* of `GOMAXPROCS = NumCPU` and the shape of throughput and latency curves. Middle level is about *how* you produce those curves rigorously, what to do when they surprise you, and what container and NUMA realities they hide. You are expected to be able to plan, run, and interpret a `GOMAXPROCS` sweep on a real service without supervision.

The scheduler-internals chapter at `10-scheduler-deep-dive/03-gomaxprocs-tuning/middle.md` explains *what* cgroup files exist and how `automaxprocs` reads them. We will not repeat that here. What we add is the **measurement side**: given that the runtime is doing the right thing (or you suspect it is not), how do you confirm by experiment?

By the end of this file you should be able to:

- Author a sweep harness that produces statistically meaningful curves.
- Recognise CFS-throttling artefacts in latency data.
- Choose a sensible `GOMAXPROCS` for a service whose workload class you understand.
- Diagnose the "sweep shows no effect" outcome, which is more common than juniors expect.

---

## Sweep Methodology From First Principles

A sweep, formally, is: vary one independent variable across a planned set of values; for each value, measure the dependent variables under controlled conditions; repeat enough times to bound noise.

For `GOMAXPROCS`:

- **Independent variable:** `GOMAXPROCS` ∈ a chosen set, typically `{1, 2, 4, 8, 16, NumCPU, 2×NumCPU}`.
- **Dependent variables:** throughput, p50/p95/p99 latency, CPU utilisation, allocator pressure, GC pause, scheduling latency.
- **Controlled:** hardware, kernel, Go version, code under test, load shape, duration, warmup, the load generator's seed if randomised.
- **Noise sources:** other processes, thermal effects, network jitter, host kernel scheduler decisions, GC timing.

Three principles to internalise:

1. **One variable at a time.** Do not sweep `GOMAXPROCS` and `GOGC` together — you cannot attribute changes.
2. **Warm up before measuring.** First five seconds of any benchmark are wrong. Discard them.
3. **Repeat and report median.** Single runs are 5–15% noisy on shared hardware. Use 3–5 repeats.

A sweep that violates any of these produces folklore, not data.

---

## Building a Reusable Sweep Harness

The harness below is the minimum useful version. It runs a service binary under `GOMAXPROCS` values, drives it with `wrk`, captures structured output, and writes a CSV.

```go
// File: sweep/main.go — runs a sweep and emits CSV to stdout.
package main

import (
    "encoding/csv"
    "fmt"
    "os"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
    "time"
)

type Result struct {
    GMP        int
    RPS        float64
    P50, P95, P99 time.Duration
}

func runOnce(gmp int, serverCmd, wrkCmd string) (Result, error) {
    srv := exec.Command("sh", "-c", serverCmd)
    srv.Env = append(os.Environ(), fmt.Sprintf("GOMAXPROCS=%d", gmp))
    if err := srv.Start(); err != nil {
        return Result{}, err
    }
    defer func() { _ = srv.Process.Kill(); _, _ = srv.Process.Wait() }()
    time.Sleep(2 * time.Second) // warm up

    out, err := exec.Command("sh", "-c", wrkCmd).CombinedOutput()
    if err != nil {
        return Result{}, fmt.Errorf("wrk: %v\n%s", err, out)
    }
    return parseWrk(gmp, string(out)), nil
}

var (
    rxRPS = regexp.MustCompile(`Requests/sec:\s+([\d.]+)`)
    rxLat = regexp.MustCompile(`(\d+)%\s+([\d.]+)(us|ms|s)`)
)

func parseDur(v, u string) time.Duration {
    f, _ := strconv.ParseFloat(v, 64)
    switch u {
    case "us":
        return time.Duration(f * float64(time.Microsecond))
    case "ms":
        return time.Duration(f * float64(time.Millisecond))
    case "s":
        return time.Duration(f * float64(time.Second))
    }
    return 0
}

func parseWrk(gmp int, out string) Result {
    r := Result{GMP: gmp}
    if m := rxRPS.FindStringSubmatch(out); m != nil {
        r.RPS, _ = strconv.ParseFloat(m[1], 64)
    }
    for _, line := range strings.Split(out, "\n") {
        if m := rxLat.FindStringSubmatch(line); m != nil {
            d := parseDur(m[2], m[3])
            switch m[1] {
            case "50":
                r.P50 = d
            case "95":
                r.P95 = d
            case "99":
                r.P99 = d
            }
        }
    }
    return r
}

func main() {
    server := "./tinyserver"
    wrk := "wrk -t8 -c128 -d20s --latency http://localhost:8080/"
    gmps := []int{1, 2, 4, 8, 16, 32}
    repeats := 3

    w := csv.NewWriter(os.Stdout)
    defer w.Flush()
    _ = w.Write([]string{"gmp", "trial", "rps", "p50_us", "p95_us", "p99_us"})

    for _, gmp := range gmps {
        for trial := 1; trial <= repeats; trial++ {
            r, err := runOnce(gmp, server, wrk)
            if err != nil {
                fmt.Fprintln(os.Stderr, "error:", err)
                continue
            }
            _ = w.Write([]string{
                strconv.Itoa(gmp), strconv.Itoa(trial),
                fmt.Sprintf("%.0f", r.RPS),
                strconv.FormatInt(r.P50.Microseconds(), 10),
                strconv.FormatInt(r.P95.Microseconds(), 10),
                strconv.FormatInt(r.P99.Microseconds(), 10),
            })
        }
    }
}
```

This produces a CSV that any spreadsheet, `gnuplot`, or Python script can plot. The plot — not the raw numbers — is what you use to decide.

Notes:

- Build `tinyserver` separately, point the harness at it.
- The warmup is 2 seconds; lengthen to 5+ for GC-heavy services.
- The harness kills the server between runs. Always restart — leaving it running across `GOMAXPROCS` changes hides the procresize STW in the wrong place.

---

## Statistical Hygiene for Sweeps

Some bullet rules to keep your sweeps honest.

1. **Discard the first repeat.** It tends to be slow due to disk caches, network handshakes, and OS warmup.
2. **Use median, not mean.** A single bad run swings the mean; the median ignores it.
3. **Report a percentile of percentiles.** Take p99 from each run; report the median p99. Reporting "the p99 of the union of all requests" is technically wrong (p99 of pooled data is not the median of per-run p99s) but commonly accepted as long as you are consistent.
4. **Plot, do not just print.** A table hides the curve's shape; a plot reveals it.
5. **Annotate the plot.** Hardware, kernel, Go version, sweep date. Six months later you will not remember.
6. **Quote variance.** Reporting "200 k RPS" without saying "± 8 k across 3 runs" is hiding information.
7. **Cross-check with a different load generator.** If `wrk` and `hey` disagree, the discrepancy is informative.

Common statistical sin: running a sweep, seeing `GOMAXPROCS=8` win by 1%, deciding 8 is the answer. With 5% per-run variance, a 1% difference is noise. Either run more repeats or accept that the optimum is "anywhere between 6 and 12".

---

## Throughput, Latency, and CPU Utilisation Together

A complete sweep has at least four series per `GOMAXPROCS` value:

| Series | Tool | What it tells you |
|---|---|---|
| Throughput (RPS) | `wrk` | Saturation throughput |
| p50 latency | `wrk --latency` | Typical request behaviour |
| p99 latency | `wrk --latency` | Tail behaviour, queueing |
| CPU utilisation | `/proc/<pid>/stat`, `top`, `pidstat` | Whether you are saturated |

A common pitfall: a sweep that shows throughput plateauing at `GOMAXPROCS=4` may actually be saturating something else (DB, network, downstream service). Check the CPU utilisation: if you are not at ~100% × `GOMAXPROCS`, the bottleneck is elsewhere and tuning `GOMAXPROCS` is futile.

`pidstat` gives clean per-process CPU numbers:

```bash
pidstat -p $(pidof tinyserver) -u 1 5
```

Aim for `%CPU` close to `GOMAXPROCS × 100` under load. If you only see `%CPU=200` while running with `GOMAXPROCS=8`, the runtime cannot use the available `P`s — investigate why before tuning further.

---

## Interpreting a Sweep Curve

Once you have plotted the curves, you will see one of these shapes. Each implies different action.

**Shape 1: clean monotonic rise to a plateau.** Throughput climbs from `GOMAXPROCS=1` to a peak at or near `NumCPU`, then flat. p99 mirrors it (drops then flat). This is the textbook CPU-bound shape. Action: trust `NumCPU`. No tuning needed.

**Shape 2: rise, peak, regression.** Throughput peaks below `NumCPU` (often at `NumCPU/2`) and regresses at higher values. p99 rises past the peak. This is a *contended* workload — likely fighting a global lock, an allocator hot path, or a shared map. Action: tune the contention, then re-sweep.

**Shape 3: flat curve.** No setting matters. Action: the bottleneck is not CPU. Profile to find what it actually is (network, disk, downstream service, mutex).

**Shape 4: sawtooth.** Throughput jumps unpredictably across `GOMAXPROCS` values. Action: variance is too high. More repeats, longer runs, quieter hardware.

**Shape 5: throughput rises past `NumCPU` (rare but real).** Action: you are misconfigured somewhere — possibly the kernel is reporting wrong `nproc`, or `NumCPU` is wrong inside the container. Read the value at startup and confirm.

A senior engineer can name these shapes from a glance at a CSV. Building that fluency is the goal of the middle level.

---

## Containers and CFS Throttling

The biggest single performance failure mode in containerised Go is **CFS throttling caused by `GOMAXPROCS > cgroup quota`**. The mechanics:

1. Pod has `cpu: 2` — CFS quota = 200 ms per 100 ms period.
2. Old or misconfigured runtime sets `GOMAXPROCS = 64` (the host's CPU count).
3. Service spins up many `P`s; they actively run threads; threads burn CPU.
4. Within milliseconds, the process exceeds its 200 ms quota.
5. CFS pauses the process until the next period (up to ~80 ms wait).
6. Every running goroutine — including ones not at fault — sees an 80 ms gap.
7. p99 latency spikes; throughput collapses.

The fix is to size `GOMAXPROCS = ceil(cgroup quota / period)`, i.e. `2`. Modern Go does this. `automaxprocs` does this on older Go.

You can see throttling in three places:

| Place | Metric/path |
|---|---|
| cAdvisor | `container_cpu_cfs_throttled_periods_total`, `container_cpu_cfs_throttled_seconds_total` |
| cgroup file | `/sys/fs/cgroup/cpu.stat` (`nr_throttled`, `throttled_time`) |
| From inside the process | high p99 + low utilisation, irregular |

The cleanest signal is the cgroup file. On cgroup v2:

```bash
$ cat /sys/fs/cgroup/cpu.stat
usage_usec 312445820
user_usec 280921104
system_usec 31524716
nr_periods 124501
nr_throttled 4231
throttled_usec 184273000
```

`nr_throttled > 0` is the alarm. `throttled_usec / 1_000_000` is the wall-clock seconds lost. If that figure is non-trivial (> 0.5% of `usage_usec`), tune.

---

## Detecting Throttling From Inside the Process

You can build a small in-process throttling detector that polls `cpu.stat` and emits a metric. Useful for services that emit Prometheus metrics but cannot easily mount cAdvisor.

```go
// File: throttledetect/main.go — reads cgroup cpu.stat periodically.
package throttledetect

import (
    "bufio"
    "os"
    "strconv"
    "strings"
    "time"
)

type Stats struct {
    NrPeriods    uint64
    NrThrottled  uint64
    ThrottledNS  uint64
}

func Read() (Stats, error) {
    f, err := os.Open("/sys/fs/cgroup/cpu.stat")
    if err != nil {
        return Stats{}, err
    }
    defer f.Close()
    var s Stats
    sc := bufio.NewScanner(f)
    for sc.Scan() {
        parts := strings.Fields(sc.Text())
        if len(parts) != 2 {
            continue
        }
        v, _ := strconv.ParseUint(parts[1], 10, 64)
        switch parts[0] {
        case "nr_periods":
            s.NrPeriods = v
        case "nr_throttled":
            s.NrThrottled = v
        case "throttled_usec":
            s.ThrottledNS = v * 1000
        }
    }
    return s, sc.Err()
}

func Watch(interval time.Duration, emit func(throttledRatio float64)) {
    prev, _ := Read()
    t := time.NewTicker(interval)
    for range t.C {
        cur, err := Read()
        if err != nil {
            continue
        }
        periods := cur.NrPeriods - prev.NrPeriods
        throttled := cur.NrThrottled - prev.NrThrottled
        if periods > 0 {
            emit(float64(throttled) / float64(periods))
        }
        prev = cur
    }
}
```

Wire `emit` into Prometheus and alert when the ratio exceeds, say, 1% over a 5-minute window. Throttling above 5% almost always means `GOMAXPROCS > quota` (or genuine over-subscription that the orchestrator should fix).

---

## NUMA Topology — A Pragmatic Tour

Non-Uniform Memory Access architectures are servers where memory is partitioned among CPU sockets. Each socket has fast access to its local memory and slower access to remote memory. Modern dual-socket Intel/AMD servers are NUMA.

Why this matters for `GOMAXPROCS`: a goroutine that runs on a `P` whose `M` is bound to socket A but whose memory lives on socket B pays a 30–80% latency penalty for memory access. Go does not have NUMA-aware scheduling; goroutines migrate freely across `P`s and `M`s.

Practical guidance:

1. **Single-socket servers.** No NUMA concerns. `GOMAXPROCS = NumCPU`. Default is fine.
2. **Multi-socket servers, single-tenant.** `GOMAXPROCS = NumCPU` and accept some cross-socket overhead. Default is fine; absolute throughput is highest because both sockets are used.
3. **Multi-socket servers, latency-critical.** Consider pinning to one socket: `GOMAXPROCS = cores per socket` + `taskset --cpu-list` for the binary. You give up half the CPU but win on memory locality.

To see your topology:

```bash
$ lscpu | grep -E 'NUMA|Socket'
Socket(s):              2
NUMA node(s):           2
NUMA node0 CPU(s):      0-31,64-95
NUMA node1 CPU(s):      32-63,96-127
```

Two sockets, 32 cores each (plus HT). To pin to socket 0:

```bash
taskset -c 0-31,64-95 ./service
```

And set `GOMAXPROCS=64` (the cores in node 0). On a memory-latency-sensitive workload this can win 10–30% on p99. On a throughput-only workload it is usually a regression.

NUMA is a senior-level concern in practice; here you should at least know it exists, recognise the symptom (multi-socket box, weird scaling past `NumCPU/2`), and read `lscpu` and `numactl --hardware`.

---

## Mixed CPU and I/O Workloads in Practice

Most real services are mixed. A typical HTTP handler does:

1. Parse the request (CPU, ~50 µs).
2. Call a downstream service or DB (I/O, ~5 ms).
3. Format the response (CPU, ~100 µs).

For such a service, the `GOMAXPROCS` sweep curves look slightly different from pure CPU work. The plateau extends — the workload can absorb extra `P`s without proportional throughput growth because the netpoller already lets goroutines wait without consuming `P`s.

Two patterns to know:

**Pattern A: I/O dominates (5 ms I/O, 150 µs CPU).** Throughput is largely insensitive to `GOMAXPROCS` once you exceed the CPU need. `GOMAXPROCS = NumCPU` is correct but `GOMAXPROCS = NumCPU/2` may give similar throughput at lower scheduling overhead. The sweep curve is flat.

**Pattern B: CPU dominates (200 µs I/O, 2 ms CPU).** Throughput is highly sensitive to `GOMAXPROCS`. Acts like a CPU-bound workload. Peak at `NumCPU`.

Many real services fall between these. The sweep tells you which one your service is, more reliably than any introspection.

---

## Sweep Recipes per Workload Class

Quick reference for choosing sweep ranges and load shapes:

| Workload class | Sweep range | Concurrency | Duration | Key metric |
|---|---|---|---|---|
| CPU-bound (hashing, compression) | 1 → 2×NumCPU | NumCPU × 8 | 20 s | RPS |
| HTTP-only I/O (downstream API) | 1 → NumCPU | NumCPU × 16 | 30 s | p99 |
| DB-heavy (most reads from PG) | 1 → NumCPU | NumCPU × 4 | 60 s | p99, DB CPU |
| gRPC fan-out | 1 → NumCPU | NumCPU × 16 | 30 s | p99 |
| Batch CPU (job worker) | 1 → 2×NumCPU | jobs queue depth | 60 s | Total wall time |

For most services, `1 → NumCPU` is enough. Going above `NumCPU` is for *demonstrating* the regression, not for finding the optimum.

---

## When the Sweep Shows No Effect

A surprisingly common outcome: you run the sweep, all `GOMAXPROCS` values produce within 2% of each other. What does this mean?

Three possibilities:

1. **The service is bottlenecked elsewhere.** Most likely. Profile with `pprof` and find the real bottleneck.
2. **The workload is too light.** If you are only doing 100 RPS, the service has all the CPU it needs at `GOMAXPROCS=1`. Increase load until something gives.
3. **The workload is too I/O-heavy.** If the service is 99% blocked on a downstream call, `GOMAXPROCS` is irrelevant.

The right reaction is *not* to declare the optimum; it is to widen the investigation. The sweep has told you that `GOMAXPROCS` is not your problem. Move on to the actual bottleneck.

Pseudocode for "sweep showed no effect" follow-up:

```
1. Confirm load was high enough (CPU utilisation > 80% per P at peak)
2. If not, increase concurrency and re-sweep
3. If utilisation low even at high concurrency:
   a. Run pprof CPU profile during load
   b. Check for downstream-dominated time
   c. Look for lock contention via mutex profile
4. Identify real bottleneck; tune that, not GOMAXPROCS
```

---

## Co-Tenancy and Headroom Sizing

If your service shares a host or pod with other CPU consumers, `GOMAXPROCS` should be sized to leave them headroom.

Common cases:

- **Sidecar containers in a Kubernetes pod.** The Envoy sidecar can use 0.5–1.5 cores. If your pod has `cpu: 4` total and Envoy takes 1, the main container effectively has 3 cores. Set Envoy and main container CPU limits explicitly so each gets its own `GOMAXPROCS` correctly.
- **Co-located batch jobs.** A nightly batch job sharing a node with online services. Use Kubernetes guaranteed QoS or `cpuset` cgroups to isolate.
- **A noisy neighbour on a bare-metal host.** Rare in modern fleets, but on developer hardware common. `GOMAXPROCS = NumCPU - 2` is a reasonable default if a known-noisy app is on the box.

The general principle: `GOMAXPROCS` controls *your process's* parallelism, not the host's. If you and a sibling both set `GOMAXPROCS = NumCPU`, you collectively want 2× the host's CPU, and the kernel will throttle both. Coordinate.

The clean answer in containers: set CPU limits per container and let each container's runtime pick `GOMAXPROCS` from its own quota. Avoid manual coordination wherever possible.

---

## Middle-Level Checklist

You can call yourself middle-competent on `GOMAXPROCS` tuning when:

1. You can write a sweep harness from scratch in under an hour.
2. You can interpret the five canonical curve shapes by eye.
3. You can detect CFS throttling from `cpu.stat` and from in-process metrics.
4. You know what a NUMA topology looks like and when to consider pinning.
5. You can choose a sweep range and concurrency level appropriate to a workload class.
6. You recognise "sweep showed no effect" and pivot to profiling rather than tuning further.
7. You can articulate the difference between throughput-optimal and latency-optimal `GOMAXPROCS`.
8. You can advise a colleague when *not* to tune `GOMAXPROCS`.

---

## Self-Assessment

Answer without looking up:

1. Why is median preferred over mean in sweep results?
2. What CFS metric is the cleanest single signal of `GOMAXPROCS` mis-sizing?
3. Sketch the throughput curve for a CPU-bound workload on a 16-core box, `GOMAXPROCS` from 1 to 32.
4. Name two reasons a sweep might show no effect at all.
5. When does NUMA pinning help, and what does it cost?
6. What command shows your machine's NUMA topology?
7. Why does Pattern A (I/O-dominated) workload have a flat sweep curve, while Pattern B (CPU-dominated) does not?

If most are sharp, move on to [senior.md](senior.md) for fleet policy, `automaxprocs` deployment, and CFS-throttling alerting.

---

## Summary

At middle level, `GOMAXPROCS` tuning is a *measurement discipline*. The runtime usually picks correctly; your job is to confirm with sweeps, recognise when the default is wrong, and articulate the trade-offs:

- A sweep is a planned, repeated experiment, not one run.
- Throughput and latency curves diverge — both matter.
- CFS throttling is the dominant container failure mode; detect it with `cpu.stat`.
- NUMA pinning is sometimes a latency win at a throughput cost.
- "No effect" sweeps mean tune something else.

Internals references throughout, especially `10-scheduler-deep-dive/03-gomaxprocs-tuning/middle.md`. Move on to senior for the fleet-level view.
