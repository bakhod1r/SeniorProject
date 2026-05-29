# Binary Search on Answer — Senior Level

> **Audience:** Engineers building production systems where parametric search is the actual technique used to size, tune, and calibrate infrastructure. Prerequisites: `junior.md`, `middle.md`.

This document treats binary search on the answer as a **production technique** — used to size Kubernetes pods, tune database query timeouts, calibrate rate limits, plan scheduler deadlines, and find SLO-respecting configurations. The interview-puzzle veneer of Koko Eating Bananas fades; in its place are real loops in real systems that bisect a noisy expensive feasibility check (a load test, a benchmark run, a simulated workload) to discover the smallest resource setting that satisfies an SLO. We cover **capacity planning**, **scheduling-deadline calculation**, **rate-limit tuning**, **database query timeout calibration**, **noisy feasibility checks**, and the **operational concerns** (caching, parallelization, monotonicity violations under noise) that separate textbook code from a system that ships.

---

## Table of Contents

1. [Capacity Planning — Kubernetes Pod Sizing](#capacity-planning)
2. [Scheduling Deadlines — Min Time to Complete N Jobs](#scheduling)
3. [Rate Limiting / Throttling Calibration](#rate-limit)
4. [Database Query Timeout Tuning](#timeout-tuning)
5. [Noisy Feasibility Checks — Statistical Bisection](#noisy)
6. [When Monotonicity Breaks in Production](#monotonicity-breaks)

---

<a name="capacity-planning"></a>
## 1. Capacity Planning — Kubernetes Pod Sizing

The most common production application of parametric search is **finding the smallest resource allocation (CPU, memory, replica count) that keeps a service within its SLO**. The problem decomposes as:

- **Answer space:** integer CPU millicores in `[100m, 8000m]`, or memory in `[64Mi, 16Gi]`, or replica count in `[1, 100]`.
- **Predicate:** `feasible(x) := "with resource setting x, p99 latency under load is < 100ms"`.
- **Monotonicity:** more CPU/memory/replicas → lower latency. Predicate is monotone (in the right direction).
- **Predicate evaluation:** run a 5-minute load test in a staging environment.

### 1.1 Code skeleton (operator pattern)

**Go (Kubernetes operator using client-go):**
```go
package autosize

import (
    "context"
    "time"
)

// Bisect the CPU request in millicores to find the smallest value where p99 < slo.
func FindMinCPU(ctx context.Context, podSpec PodSpec, slo time.Duration) (int, error) {
    lo, hi := 100, 8000
    for lo < hi {
        mid := lo + (hi-lo)/2
        ok, err := runLoadTest(ctx, podSpec, mid, slo)
        if err != nil {
            return 0, err
        }
        if ok {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo, nil
}

// runLoadTest deploys a pod with `cpuMillicores` CPU, drives synthetic traffic
// for 5 minutes, and returns true iff p99 latency < slo.
func runLoadTest(ctx context.Context, spec PodSpec, cpuMillicores int, slo time.Duration) (bool, error) {
    // 1. Deploy a transient Deployment with the candidate CPU request.
    // 2. Wait for readiness.
    // 3. Generate load via k6 / vegeta / locust.
    // 4. Scrape Prometheus for p99 over the test window.
    // 5. Compare against SLO.
    // 6. Tear down.
    // ...elided...
    return p99 < slo, nil
}
```

**Java (Spring Boot job orchestrating tests against a Kubernetes API):**
```java
public int findMinCpu(PodSpec spec, Duration slo) throws Exception {
    int lo = 100, hi = 8000;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (runLoadTest(spec, mid, slo)) hi = mid;
        else                              lo = mid + 1;
    }
    return lo;
}

private boolean runLoadTest(PodSpec spec, int cpu, Duration slo) throws Exception {
    // deploy → measure → tear down
    Duration p99 = orchestrator.deployAndBenchmark(spec, cpu, Duration.ofMinutes(5));
    return p99.compareTo(slo) < 0;
}
```

**Python (Argo Workflow step):**
```python
def find_min_cpu(pod_spec, slo_ms):
    lo, hi = 100, 8000
    while lo < hi:
        mid = (lo + hi) // 2
        p99 = run_load_test(pod_spec, cpu_millicores=mid, duration_min=5)
        if p99 < slo_ms:
            hi = mid
        else:
            lo = mid + 1
    return lo
```

### 1.2 Operational realities

Each `runLoadTest` call costs **5 minutes** of real time + the cost of running the pod. With `lo = 100, hi = 8000`, the binary search runs `log₂(7900) ≈ 13` iterations × 5 min = **65 minutes** to find the optimal CPU. Linear search (trying every 100m increment) would take 79 iterations × 5 min = **6.5 hours**. Binary search is the standard.

### 1.3 Caching previous results

If the same `cpu_millicores` value is tested multiple times (e.g., during nightly autotuning across many services), cache the verdict. The cache key is `(service_version, pod_spec_hash, cpu_millicores, slo)`. Cache hits skip the 5-minute test entirely.

```python
from functools import lru_cache

@lru_cache(maxsize=2048)
def cached_feasible(pod_spec_hash, cpu_millicores, slo_ms):
    return run_load_test(...)
```

### 1.4 Coupled resources (CPU + memory)

Real services have **two** resource knobs: CPU and memory. The 1D binary search becomes a 2D problem. Two common approaches:

- **Fix one, binary-search the other.** Fix memory at a generous value, find min CPU. Then fix CPU at that value, find min memory. Two 1D searches. Not necessarily optimal but cheap.
- **Pareto frontier sweep.** Run binary search at several memory levels; build a Pareto frontier of (CPU, memory, cost) configurations. Pick the cost-optimal point that meets SLO. Expensive but accurate.

For most autotuning systems, the first approach is good enough. The cost difference is usually within 10–20% of optimal.

### 1.5 Tools using this technique in production

- **Netflix's Scryer** for predictive autoscaling combines parametric search with time-series forecasting.
- **Google's Autopilot** for Kubernetes does similar autosizing.
- **AWS Compute Optimizer** uses cost-vs-performance bisection to recommend instance types.
- Internal "right-sizing" tools at most large engineering organizations bisect CPU/memory against historical workload replay.

---

<a name="scheduling"></a>
## 2. Scheduling Deadlines — Min Time to Complete N Jobs

A scheduler has `N` jobs and `M` workers. Each job has a known processing time. The scheduler needs to know: **what is the minimum makespan (wall-clock time) by which all jobs can complete?**

This is **identical** to "Capacity to Ship Packages within D days" (LC 1011) — except `D` is now the answer (minimum time) and `M` is the budget (number of workers). The technique:

- **Answer space:** `[max(job_times), sum(job_times)]`.
- **Predicate:** `feasible(T) := "M workers can complete all jobs within time T"`.
- **Monotone in T:** more time → easier → predicate switches false→true once.

### 2.1 The feasibility check

For **identical machines** (any worker can do any job), `feasible(T)` is: greedy-assign jobs in order; whenever the current worker's load + next job exceeds T, start a new worker. If we use ≤ M workers, return true.

```python
def feasible(T, jobs, M):
    workers, current = 1, 0
    for j in jobs:
        if current + j > T:
            workers += 1
            current = 0
        current += j
    return workers <= M

def min_makespan(jobs, M):
    lo, hi = max(jobs), sum(jobs)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid, jobs, M):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Go:**
```go
func MinMakespan(jobs []int, M int) int {
    lo, hi := 0, 0
    for _, j := range jobs {
        if j > lo {
            lo = j
        }
        hi += j
    }
    feasible := func(T int) bool {
        workers, current := 1, 0
        for _, j := range jobs {
            if current+j > T {
                workers++
                current = 0
            }
            current += j
        }
        return workers <= M
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public int minMakespan(int[] jobs, int M) {
    int lo = 0;
    long hi = 0;
    for (int j : jobs) { if (j > lo) lo = j; hi += j; }
    while (lo < hi) {
        long mid = lo + (hi - lo) / 2;
        if (feasibleMakespan(jobs, M, mid)) hi = mid;
        else                                 lo = (int)(mid + 1);
    }
    return lo;
}
private boolean feasibleMakespan(int[] jobs, int M, long T) {
    int workers = 1;
    long cur = 0;
    for (int j : jobs) {
        if (cur + j > T) { workers++; cur = 0; }
        cur += j;
    }
    return workers <= M;
}
```

### 2.2 When jobs are independent (any order)

If the scheduler is allowed to reorder jobs, the greedy "fill workers in input order" is NOT optimal — the optimal assignment is NP-hard (bin packing). However, **first-fit decreasing** (sort descending, place each job in the first worker that fits) is a 4/3 approximation, and combined with binary search it gives a usable solution.

For interview / theoretical contexts, you usually assume in-order, which is what makes the problem polynomial.

### 2.3 Production examples

- **Apache Airflow scheduler** decides DAG completion deadlines by bisecting on time given dependency constraints.
- **Spark / Hadoop YARN** estimate job completion time using historical task runtimes + bisection on cluster size.
- **CI/CD systems** (Buildkite, GitHub Actions, CircleCI) use parametric search variants to estimate "when will this build queue drain?" given known historical durations.
- **Apache Kafka MirrorMaker 2 throughput planning** bisects the number of replication workers against target replication lag.

---

<a name="rate-limit"></a>
## 3. Rate Limiting / Throttling Calibration

You're running a service that calls a downstream API. The downstream returns 429 (Too Many Requests) above some unknown threshold. You want to find the **maximum sustainable rate** (requests per second) that stays under the 429 boundary, with some safety margin.

### 3.1 The problem

- **Answer space:** integer RPS in `[1, 10000]`.
- **Predicate:** `feasible(r) := "running at r RPS for 60 seconds yields a 429 rate below the safety threshold (say 0.1%)"`.
- **Monotone:** higher RPS → more 429s. Once 429 rate exceeds threshold, all higher rates also exceed.

### 3.2 Practical wrinkle — the downstream may have hidden burst tolerance

Most rate limiters allow short bursts above the steady-state limit, then throttle. The "monotone" predicate is approximately true only for sustained traffic of ≥ 30 seconds. Burst-detection logic is needed in the calibrator.

### 3.3 Code (token-bucket calibration)

**Go:**
```go
// CalibrateRateLimit finds the maximum RPS the downstream tolerates with
// < failureThreshold (e.g. 0.001 = 0.1%) failures over windowSec seconds.
func CalibrateRateLimit(
    ctx context.Context,
    downstream Caller,
    failureThreshold float64,
    windowSec int,
) (int, error) {
    lo, hi := 1, 10000
    for lo < hi {
        mid := lo + (hi-lo+1)/2 // find LARGEST RPS that still passes
        rate, err := measureFailureRate(ctx, downstream, mid, windowSec)
        if err != nil {
            return 0, err
        }
        if rate <= failureThreshold {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return lo, nil
}
```

**Java:**
```java
public int calibrateRateLimit(Caller downstream, double failureThreshold, int windowSec) {
    int lo = 1, hi = 10000;
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        double rate = measureFailureRate(downstream, mid, windowSec);
        if (rate <= failureThreshold) lo = mid;
        else                          hi = mid - 1;
    }
    return lo;
}
```

**Python (using locust or custom load gen):**
```python
def calibrate_rate_limit(downstream, failure_threshold=0.001, window_sec=60):
    lo, hi = 1, 10000
    while lo < hi:
        mid = (lo + hi + 1) // 2     # find LARGEST passing rate
        failure_rate = measure_failure_rate(downstream, rps=mid, duration_sec=window_sec)
        if failure_rate <= failure_threshold:
            lo = mid
        else:
            hi = mid - 1
    return lo
```

### 3.4 The "destructive" nature of this calibration

Each `measureFailureRate` call deliberately overloads the downstream. Calibration is intentionally destructive — you must do it against a **canary** or **isolated environment**, not production. Some teams build a "throttle calibration sandbox" specifically for periodic recalibration.

### 3.5 Adaptive variants

Production rate limiters (e.g., **AIMD — Additive Increase Multiplicative Decrease** in TCP congestion control) don't binary-search — they react to feedback in real time. But the **initial calibration** of "what's the starting rate?" is often done via offline binary search before the AIMD loop takes over.

---

<a name="timeout-tuning"></a>
## 4. Database Query Timeout Tuning

Setting a per-query timeout is hard. Too short → legit slow queries get killed → user errors. Too long → bad queries pile up → connection pool exhaustion → site down.

The right approach: bisect the timeout against a replay of historical traffic, finding the smallest timeout that catches < 0.1% of legitimate queries.

### 4.1 The setup

You have:
- A log of 24 hours of historical queries, each with their actual completion time (or "still running at end of window").
- An SLO: "catch ≤ 0.1% of healthy queries with the timeout".

### 4.2 The predicate

`feasible(t) := "fraction of legit queries that exceed t is ≤ 0.001"`.

Monotone: as `t` grows, fewer queries exceed it.

### 4.3 Code

**Python:**
```python
import bisect

def find_min_timeout(query_durations_sorted_ms, slo_fraction=0.001):
    """
    query_durations_sorted_ms: pre-sorted list of historical query times (ms).
    Returns the smallest timeout (ms) such that ≤ slo_fraction of queries exceed it.
    """
    n = len(query_durations_sorted_ms)
    # We want the smallest t with (count of durations > t) / n ≤ slo_fraction.
    # That is: count > t ≤ slo_fraction * n.
    target_max_violations = int(slo_fraction * n)
    # The smallest t s.t. count > t ≤ target → t ≥ the (n - target)-th value.
    idx = n - target_max_violations - 1
    if idx < 0:
        return query_durations_sorted_ms[0]
    return query_durations_sorted_ms[idx]
```

This is binary search via **direct indexing** into a sorted distribution — much faster than running `feasible(t)` repeatedly. But when the duration distribution is too large to sort, fall back to the explicit binary search.

**Go (explicit bisection for a streaming dataset):**
```go
func FindMinTimeout(streamingDurations <-chan int, sloFraction float64) int {
    // collect into buckets, then bisect
    durations := []int{}
    for d := range streamingDurations {
        durations = append(durations, d)
    }
    sort.Ints(durations)
    n := len(durations)
    target := int(sloFraction * float64(n))
    feasible := func(t int) bool {
        violations := n - sort.SearchInts(durations, t+1)
        return violations <= target
    }
    lo, hi := 0, durations[n-1]
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public int findMinTimeout(List<Integer> durations, double sloFraction) {
    Collections.sort(durations);
    int n = durations.size();
    int target = (int) (sloFraction * n);
    int lo = 0, hi = durations.get(n - 1);
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        // count of durations > mid = n - lowerBound(mid + 1)
        int idx = Collections.binarySearch(durations, mid + 1);
        if (idx < 0) idx = -idx - 1;
        int violations = n - idx;
        if (violations <= target) hi = mid;
        else                       lo = mid + 1;
    }
    return lo;
}
```

### 4.4 Combining with percentile telemetry

In practice, you run this offline on yesterday's query log. The output goes into your service config:
```yaml
postgres:
  query_timeout_ms: 4500   # calibrated 2025-11-01 from 24h trace, slo=0.001
```

Re-run weekly or on workload shifts. **Databases at Stripe, Shopify, and Airbnb** use exactly this pattern for per-shard query timeout calibration.

### 4.5 Variant — adaptive per-query class

Different query classes have different distributions. Calibrate each separately. E.g., separate timeouts for `/checkout` (95th percentile ~100 ms, timeout 500 ms) versus `/admin/report` (95th percentile ~3 s, timeout 30 s).

---

<a name="noisy"></a>
## 5. Noisy Feasibility Checks — Statistical Bisection

Most production feasibility checks (load tests, benchmarks, simulations) return **noisy** results. A 5-minute load test at the same CPU level might return p99=98ms once and p99=103ms another time. The predicate isn't deterministic.

### 5.1 The naive failure mode

Standard binary search assumes `feasible(x)` is a pure function. If it's noisy and the SLO boundary is near `x = 1200m`, you might get:

- `feasible(1200)` → false (noise)
- next iteration narrows to `[1201, 2000]`, finds answer ~ 1400m
- Actually, 1100m was enough; you over-provisioned 27%.

Even worse: **non-monotonic outputs from noise** can cause the search to diverge in pathological ways.

### 5.2 Mitigation 1 — Average multiple runs

Run `feasible(x)` `k` times (say 5) and take the median. Reduces noise variance by ~`√k`. Cost: `k` times slower.

```python
def robust_feasible(x, k=5):
    results = [run_load_test(x) for _ in range(k)]
    results.sort()
    return results[k // 2]   # median
```

### 5.3 Mitigation 2 — Confidence interval bisection

Instead of binary classification, compute a confidence interval. Only commit to "feasible" or "infeasible" when the CI is entirely on one side of the SLO.

```python
def confident_feasible(x, slo, ci_alpha=0.05, max_runs=10):
    results = []
    for _ in range(max_runs):
        results.append(run_load_test(x))
        if len(results) >= 3:
            mean, std = stats.mean(results), stats.stdev(results)
            t = stats.t.ppf(1 - ci_alpha / 2, len(results) - 1)
            ci_half = t * std / math.sqrt(len(results))
            if mean + ci_half < slo:
                return True
            if mean - ci_half > slo:
                return False
    # Hit max_runs without certainty — be conservative (assume infeasible)
    return False
```

### 5.4 Mitigation 3 — Bias the search

If the cost of "false-feasible" (under-provisioning, SLO violation) is much higher than "false-infeasible" (over-provisioning, wasted money), bias the SLO check:

```python
# Instead of "p99 < 100ms", check "p99 < 80ms" — gives ourselves a 20ms buffer.
def feasible_with_buffer(x):
    return run_load_test(x) < slo * 0.8
```

This converges to a configuration with a safety margin built in. Cost: ~20% over-provisioning in the worst case.

### 5.5 Mitigation 4 — Hierarchical search

Coarse-grained first, fine-grained second:
1. Coarse: bisect at multiples of 500m to find the rough range.
2. Fine: linear-scan within the rough range using more replicas per test.

This shifts the noise problem to the smaller fine-grained scan, where averaging cost is bounded.

### 5.6 Production pattern — record-and-replay

For services with stable behavior, record one good golden trace and replay it in calibration tests instead of generating fresh synthetic traffic each time. Eliminates much of the noise (the trace is deterministic) and speeds up iteration.

---

<a name="monotonicity-breaks"></a>
## 6. When Monotonicity Breaks in Production

In textbook problems, the predicate is monotonic by construction. In production, it can break in subtle ways. Knowing these failure modes is the difference between a calibrator that works and one that silently picks bad answers.

### 6.1 NUMA / cache effects

For very fine-grained CPU allocation, going from 2 cores to 3 cores might **increase** latency because the JVM/Go runtime starts NUMA-balancing across sockets, incurring cross-socket memory traffic. The predicate "p99 < 100ms" looks like:

```
cpu_millicores:    100  200  500 1000 2000 3000 4000 5000
p99 (ms):          800  450  180  110   90  140   80   75
                                   ↑     ↑    ↑
                                under  under over (?)
                                100ms  100ms  100ms
```

The predicate is **not monotonic**. Binary search returns whatever it lands on first — potentially the wrong answer.

**Mitigation:** smooth the predicate by averaging adjacent samples, or restrict the answer space to settings that don't cross NUMA boundaries.

### 6.2 Stateful warm-up

If the service has a JIT warmup (Java, V8) or buffer warmup (databases), a 5-minute test may not capture steady-state. The first iteration of binary search runs against a fresh pod and looks slower than later iterations on stable pods.

**Mitigation:** warm up before each measurement window. Discard the first N seconds of any benchmark.

### 6.3 External dependencies

The downstream service might tighten its rate limits during your binary search (autoscaling, manual intervention, AWS region issues). What was feasible at iteration 3 isn't at iteration 7.

**Mitigation:** detect environmental drift via control measurements (re-run a known baseline midway through bisection). If the baseline shifts, restart the search.

### 6.4 Per-tenant noise in multi-tenant systems

If the service is shared by multiple tenants and tenant load varies wildly, the predicate at the same `cpu_millicores` setting depends on which tenants are active. Genuinely non-stationary.

**Mitigation:** restrict calibration to a "quiet" time window, or use a dedicated calibration tenant.

### 6.5 Memory pressure causing non-monotone behavior

For memory-bound services: at 512Mi memory, the JVM spends 60% of CPU in GC. At 1Gi, GC drops to 5% and p99 plummets. At 2Gi, no change. At 4Gi, the GC heuristics shift and p99 actually rises slightly. Non-monotone.

**Mitigation:** sweep at multiple memory settings, validate monotonicity in the relevant range, restrict binary search to that range.

### 6.6 "Almost monotonic" with islands

Sometimes the predicate is mostly monotone but has isolated "islands" of false where it should be true (or vice versa). Caused by transient noise, GC pauses during the measurement window, or thermal throttling on shared hardware.

**Mitigation:** require **two consecutive** feasibility checks at the same value to agree before committing. Costs more time but cuts the false-positive rate dramatically.

### 6.7 The escape hatch

When all else fails: **abandon binary search, switch to grid search**. For a 1D answer space of 50–100 candidates, grid search with averaged samples is more robust. Binary search is faster *in expectation*, but production reliability matters more.

A common pattern in autotuning systems: run binary search to get a rough answer in O(log n) iterations, then **verify** with a grid search within the resulting ±20% range. The verify stage catches monotonicity-breakage.

---

## Closing Thoughts

Binary search on the answer is among the highest-ROI techniques you'll ever learn — not because it solves more problems than DP or graph algorithms, but because **every operations team that scales a service eventually needs it**. Pod sizing, rate-limit tuning, timeout calibration, scheduler deadline estimation, A/B test sizing, GPU memory budgeting — all naturally bisect a monotone (or "monotone-ish") predicate over an answer space.

The senior-level skill is **recognizing the parametric structure in messy real problems**, then defending the implementation against noise, drift, and edge-case monotonicity violations. The code is rarely more than 30 lines. The hard part is everything around it: the load generator, the metrics pipeline, the staging environment, the safety bounds, the noise mitigation. If you have those, parametric search is one of the cleanest tools in your kit.

---

## Further Reading

- **Brendan Gregg**, *Systems Performance* (2nd ed.), Chapter 12 (Benchmarking). The art of running clean feasibility checks.
- **Netflix Tech Blog** — "Predictive Auto-Scaling at Netflix" (Scryer). How a streaming service combines forecasting with bisection.
- **Google SRE Book** — Chapter 21 (Handling Overload). Rate-limit calibration patterns.
- **Megiddo**, "Combinatorial Optimization with Rational Objective Functions" (1979). The theoretical foundation; not light reading but historic.
- **Cole**, "Slowing Down Sorting Networks to Obtain Faster Sorting Algorithms" (1987). Megiddo's parametric search applied — a cornerstone of computational geometry.
- **Kubernetes Vertical Pod Autoscaler** — source code (`autoscaler/vertical-pod-autoscaler`). Production code that bisects CPU/memory targets in real clusters.
- Continue with `professional.md` for the theory: Megiddo's parametric search, lower bounds, and the deeper connection to LP duality.
