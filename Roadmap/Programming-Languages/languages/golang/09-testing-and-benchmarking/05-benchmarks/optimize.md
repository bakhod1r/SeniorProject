---
layout: default
title: Benchmarks — Optimize
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/optimize/
---

# Benchmarks — Optimize

[← Back](../)

This page is about optimising **the benchmark itself** — not the code under test. The goal is *reproducibility*: produce numbers that, when re-run tomorrow on the same hardware, fall within a tight confidence interval. Without reproducibility you cannot detect a 3 % improvement; without detection you cannot decide whether your optimisation is real.

We walk through six layers, from cheapest to most invasive.

---

## 1. Multiple `-count` runs

The single biggest lever is `-count`. One run is a sample of size one — you cannot estimate variance from it, and `benchstat` refuses to draw conclusions.

```
go test -bench=. -count=10 -benchmem > result.txt
```

`-count=10` is a community baseline. For very fast benchmarks (sub-microsecond), use `-count=20` or `-count=30`. The cost is linear in wall time; an extra 9 runs of a 1 s benchmark is 9 s.

**Why ten?** With ten samples per side and the Mann–Whitney U-test that `benchstat` uses, you can detect a ~5 % effect at `p < 0.05` provided stddev is ≤ 3 %. Lower `n` shrinks your detection threshold; higher `n` widens it (with diminishing returns above ~30).

---

## 2. Quiet machine

Close everything you do not need. The list is mundane and matters:

- Browser tabs running JavaScript.
- IDEs with language servers indexing in the background.
- Spotify / video calls.
- System updates (especially on macOS — `softwareupdate` and `mdworker`).
- Antivirus on Windows.

A Slack notification arriving mid-benchmark can move a 1 ns/op operation by 5 %.

```
# Linux: see what is running
top -bn1 -o %CPU | head -20

# macOS: same
top -l 1 -o cpu | head -20
```

---

## 3. CPU frequency governor

On modern hardware the CPU dynamically scales frequency. A benchmark run while the system is warm and a benchmark run from cold do not see the same silicon. Pin frequency to its highest stable value.

**Linux:**

```bash
# Show current
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

# Set all cores to performance
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Or with cpupower
sudo cpupower frequency-set -g performance
```

**Intel turbo boost** — separate knob. Disable for benchmarks:

```bash
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
```

**AMD** — disable Core Performance Boost:

```bash
echo 0 | sudo tee /sys/devices/system/cpu/cpufreq/boost
```

After benchmarking, restore (`echo schedutil | ...`, `echo 0 | ... no_turbo`).

**macOS** — there is no equivalent without third-party tools. Use a Linux box for serious benchmarking.

---

## 4. CPU pinning with `taskset`

The OS scheduler may migrate your process between cores during the run, trashing L1/L2 cache state. Pin to one core:

```bash
taskset -c 3 go test -bench=. -count=10 -benchmem > pinned.txt
```

Choose a core that is not the boot CPU (avoid 0 on most distros). On SMT-enabled hardware, prefer the *first* core of each physical pair to avoid sharing with its sibling thread:

```bash
# Find sibling pairs
cat /sys/devices/system/cpu/cpu*/topology/thread_siblings_list | sort -u
```

For higher isolation, boot the kernel with `isolcpus=3` so the scheduler will not place *any* other workload on core 3, then `taskset -c 3` your benchmark.

---

## 5. `GOMAXPROCS=1` for deterministic single-thread runs

For microbenchmarks of pure computation, single-threaded execution removes scheduler-induced noise:

```
GOMAXPROCS=1 taskset -c 3 go test -bench=. -count=10 -benchmem
```

This is **not** appropriate for benchmarks of:

- Concurrent data structures (`sync.Map`, channels under contention).
- Code that intentionally exercises parallelism.
- Anything timed with `b.RunParallel`.

For those, fix `GOMAXPROCS` to a stable value (e.g. `4`) and pin to that many cores.

---

## 6. Geomean across cases

A benchmark suite usually has many cases. Comparing them one by one is noisy: some go up, some go down by random amounts. The **geometric mean** across cases gives a single robust summary that is not dominated by outliers.

`benchstat` prints geomean automatically when you have ≥ 3 sub-benchmarks. Look for the bottom line:

```
[Geo mean]    312ns    276ns    -11.5%
```

This is the number to quote in a PR description for "average speedup across the suite".

---

## 7. The full recipe (Linux)

Putting it together:

```bash
# Prep
sudo cpupower frequency-set -g performance
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# Baseline
git checkout main
taskset -c 3 go test -bench=. -count=10 -benchmem > old.txt

# Candidate
git checkout feature/fast-path
taskset -c 3 go test -bench=. -count=10 -benchmem > new.txt

# Compare
benchstat old.txt new.txt

# Restore
echo 0 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
sudo cpupower frequency-set -g schedutil
```

This is the canonical workflow professional perf engineers use for Go.

---

## 8. What you should expect

| Setup | Typical stddev |
|---|---|
| Laptop, defaults, one run | ± 5–15 % |
| Laptop, `-count=10`, no other prep | ± 3–8 % |
| Desktop Linux, governor=performance, no turbo | ± 1–3 % |
| Pinned core + isolcpus + GOMAXPROCS=1 | ± 0.3–1 % |
| Bare-metal CI runner, dedicated | ± 0.5–1 % |

If you want to detect a 2 % improvement, you need the bottom two rows. A 20 % improvement is visible everywhere.

---

## 9. CI realities

Cloud CI runners (GitHub Actions hosted runners, GitLab shared runners, etc.) are **noisy neighbourhoods**. They run on shared hardware with co-tenants. Their noise budget is typically 10–20 %. Conclusions:

- Use them to catch *huge* regressions (50 %+).
- Do not use them to gate on a 3 % regression.
- For sub-10 % regressions, run on a dedicated benchmark box and post results back to the PR.

The Go project itself runs its perf builders on dedicated hardware at `perf.golang.org`.

---

## 10. Pre-warming

Some benchmarks have a transient "warm-up" phase: JITs, cache populating, sync.Pool filling. `go test` does no warm-up; the first iterations are slower. With small `b.N` (very expensive operations), this matters.

Mitigation:

- Inside the benchmark, do a "warm-up" pass before `b.ResetTimer()`:

  ```go
  for i := 0; i < 100; i++ {
      _ = work(input)
  }
  b.ResetTimer()
  for i := 0; i < b.N; i++ {
      _ = work(input)
  }
  ```

- Or increase `-benchtime` so the warm-up amortises away.

---

## Summary checklist

- [ ] `-count >= 10`.
- [ ] `benchstat` instead of eyeballing.
- [ ] Quiet machine (no other heavy workloads).
- [ ] CPU governor set to `performance`.
- [ ] Turbo / boost disabled.
- [ ] `taskset -c <N>` to pin a core.
- [ ] `GOMAXPROCS` set appropriately (1 for microbenches, fixed N for concurrent).
- [ ] Geomean reported for multi-case suites.
- [ ] CI used for big regressions only; dedicated box for fine-grained perf work.

---

## 11. Per-core noise: how to choose which core to use

When you pin to a core, choice matters.

- **Core 0** is the boot processor on most distros; many interrupts route to it. Avoid.
- **Cores running system threads** (`ksoftirqd`, kernel workers) are noisier than idle cores. Check with `ps -e -o pid,cmd | grep -E 'ksoftirqd|kworker'`.
- **NUMA locality** — pick a core whose closest memory node is where your data lives. `numactl --hardware` shows the layout.
- **SMT siblings** — if you pin to core 4, ensure core's SMT sibling (the second logical core on the same physical core, e.g. core 20 on a 16-core / 32-thread machine) is idle.

A safe default on a typical Linux server: pick a core from the middle of the range (e.g. core 4 on an 8-core machine), verify it is idle, and stick with it across runs.

## 12. Interleaved vs grouped runs

Two scheduling strategies for baseline-vs-candidate comparison:

**Interleaved:**

```
A B A B A B A B A B (each letter is one run)
```

Pros: tolerant to slow temporal drift (machine warming up, gradual background load).

Cons: cache state mixes between runs; statistical assumption of independence is muddied.

**Grouped:**

```
A A A A A | B B B B B
```

Pros: clean cache state for each side; cleaner statistical analysis.

Cons: vulnerable to drift between the two groups.

For most workloads, grouped wins. Run baseline rapidly, then candidate rapidly, within a few minutes total. The machine state will not drift much in that window.

If the suite is very large (hours), interleave. The drift is the bigger threat.

## 13. Bootstrap and the U-test

`benchstat`'s U-test computes one p-value per benchmark. For a suite of 100 benchmarks, applying p<0.05 individually means you expect 5 false positives by chance. Three responses:

1. **Bonferroni correction** — require `p < 0.05 / 100 = 0.0005`. Conservative.
2. **False Discovery Rate (FDR)** — control the expected fraction of false positives; less conservative.
3. **Ignore for casual work** — accept 5 % false positives; rerun any individual claim with more `-count`.

`benchstat` does not apply correction automatically. For senior work on large suites, apply Bonferroni manually or just rerun suspicious deltas.

## 14. Bootstrapping for tight confidence intervals

For small `-count` (5-10), the U-test's confidence intervals can be tight or loose depending on the data distribution. Bootstrap resampling gives an alternative: resample your data with replacement, recompute, repeat 1000 times, report the 2.5th and 97.5th percentiles of the resamples.

This is not built into `benchstat` but is easy in a small Go or Python script. Use when you have few samples and need tight intervals.

## 15. Closing thought

Benchmark stability is a Pareto problem: 80 % of the variance comes from 20 % of the noise sources. The biggest wins, in order:

1. `-count=10` (free).
2. Quiet the machine (free).
3. Performance governor + turbo off (free if you have access).
4. Pin a core with `taskset` (free).
5. `GOMAXPROCS=1` for microbenches (free).
6. Dedicated bare-metal box (expensive).

Apply the cheap interventions first. If you still have unacceptable noise, escalate to the expensive ones. For most projects, the free interventions are sufficient — you can detect 3-5 % effects reliably without a perf box.
