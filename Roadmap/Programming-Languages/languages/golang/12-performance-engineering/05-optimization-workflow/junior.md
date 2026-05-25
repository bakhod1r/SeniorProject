# Optimization Workflow — Junior

## 1. The mindset: measure first, guess never

Most engineers' first instinct on "make this faster" is to read the code and look for something obviously slow. That instinct is wrong, and it stays wrong even after years of practice. The correct first move is to measure.

The reason is simple: humans are bad at predicting where slow code lives. Studies of professional developers consistently find that their guesses about hotspots match the profiler less than 30% of the time. So the rule is hard:

> Never change code with the goal of "making it faster" until you have a measurement that says **this specific function** is the cost.

A measurement can be a benchmark, a CPU profile, a flame graph, or production latency data. It cannot be a hunch.

---

## 2. What a "measurement" looks like

The minimum viable measurement in Go is a benchmark:

```go
func BenchmarkSum(b *testing.B) {
    xs := makeInput(10000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = sum(xs)
    }
}
```

Run it:

```bash
go test -bench=BenchmarkSum -benchmem -count=10
```

The output gives you:

- `ns/op` — nanoseconds per iteration.
- `B/op` — bytes allocated per iteration.
- `allocs/op` — allocation events per iteration.

These three numbers are your baseline. Save the output to a file. You will diff against it after every change.

---

## 3. The five-step loop

Every optimization, big or small, follows this shape:

1. **Set the goal.** "Reduce `BenchmarkSum` ns/op by at least 25%."
2. **Measure.** Save baseline output.
3. **Hypothesize one change.** "Pre-allocate the slice in `transform`."
4. **Apply that one change.** No formatting, no rename, no other edits.
5. **Re-measure.** Compare with `benchstat`. Keep or revert.

Repeat. The loop is the entire job. Senior engineers run this loop hundreds of times a year; juniors learning the discipline should aim for ten clean loops before attempting their first "big" optimization.

---

## 4. A worked example

A junior engineer is asked to speed up a CSV row counter. The first version:

```go
func countRows(path string) (int, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return 0, err
    }
    lines := strings.Split(string(data), "\n")
    return len(lines), nil
}
```

Step 1 — set the goal. The function takes 80 ms on a 100 MB file; the team wants it under 30 ms.

Step 2 — measure:

```go
func BenchmarkCountRows(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _, _ = countRows("test.csv")
    }
}
```

```
BenchmarkCountRows-8   12   82_435_111 ns/op   104_857_600 B/op   3 allocs/op
```

100 MB of allocations per call. The bottleneck is reading the entire file into memory and then splitting it.

Step 3 — hypothesis: stream the file line by line instead of loading it whole.

Step 4 — change:

```go
func countRows(path string) (int, error) {
    f, err := os.Open(path)
    if err != nil {
        return 0, err
    }
    defer f.Close()
    sc := bufio.NewScanner(f)
    sc.Buffer(make([]byte, 1<<20), 1<<20)
    n := 0
    for sc.Scan() {
        n++
    }
    return n, sc.Err()
}
```

Step 5 — re-measure:

```
BenchmarkCountRows-8   65   18_201_804 ns/op   1_048_576 B/op   4 allocs/op
```

80 ms → 18 ms, and the per-call allocation dropped 100×. Goal exceeded. Commit.

---

## 5. The benchstat habit

A single run of a benchmark is noise. Run it ten times before and ten times after, and compare with `benchstat`:

```bash
go install golang.org/x/perf/cmd/benchstat@latest

go test -bench=. -count=10 -benchmem > old.txt
# make change
go test -bench=. -count=10 -benchmem > new.txt
benchstat old.txt new.txt
```

The output tells you the percentage change *and* a `p` value (statistical significance). Treat `p > 0.05` as "no detectable change" — the difference is within measurement noise, regardless of how large the percent looks.

---

## 6. The three numbers to keep an eye on

| Number | What it means | Good direction |
|--------|---------------|----------------|
| `ns/op` | Time per operation | Lower |
| `B/op` | Memory allocated per operation | Lower |
| `allocs/op` | Number of allocation events per operation | Lower |

For junior-level work, all three should move in the right direction simultaneously, or the change is suspicious. A 20% `ns/op` win that doubles `allocs/op` is going to bite you under real load.

---

## 7. Common bottleneck categories

You don't have to know everything to start spotting these:

| Category | Smell | First check |
|----------|-------|-------------|
| Too many allocations | High `allocs/op` | Profile heap, look for `make` in loop |
| Wrong algorithm | Time grows with input squared | Try a smaller input; does time grow linearly? |
| Too much I/O | CPU low, wall time high | Add a print before/after each `Read` |
| Lock contention | CPU underused at high load | Are several goroutines waiting on the same mutex? |

Most beginner-level performance issues are in the first two boxes. Most production-level ones are in all four, sometimes simultaneously.

---

## 8. Use the standard library before reaching for tricks

Before reading any blog post about `unsafe`, `sync.Pool`, or assembly tricks, make sure you're using the right standard library tool. The common upgrades:

| Slow idiom | Fast standard library |
|------------|----------------------|
| `s += " more"` in a loop | `strings.Builder` |
| `fmt.Sprintf("%d", n)` | `strconv.Itoa(n)` |
| Reading whole file with `os.ReadFile` to count something | `bufio.Scanner` |
| `[]byte(s)` and `string(b)` in a tight loop | Often unnecessary; pass the right type from the start |
| `make([]T, 0)` and growing | `make([]T, 0, expectedLen)` |

Most junior optimizations are about using the right tool; the language already has them.

---

## 9. The first profile

When a benchmark isn't enough, take a CPU profile:

```bash
go test -bench=BenchmarkCountRows -cpuprofile=cpu.out
go tool pprof cpu.out
```

In the interactive prompt:

```
(pprof) top
(pprof) list countRows
(pprof) web      # opens a flame graph in your browser
```

`top` shows the functions consuming the most time. `list <fn>` shows line-by-line CPU. `web` shows the famous flame graph. For a beginner, `top` and `web` are enough.

---

## 10. The flame graph in one paragraph

A flame graph stacks function calls vertically and orders them by sample count horizontally. The *width* of a box is the time spent in that function (and its callees). The *height* is the call depth. You read it like this:

1. Look for the **widest box** at the top of the stack.
2. Ignore the bottom (it's `main` and the scheduler).
3. Click the wide top boxes to zoom in.

The widest function near the top, that isn't a standard library primitive, is almost always your hotspot.

---

## 11. Premature optimization

There is a famous Knuth quote:

> Premature optimization is the root of all evil.

The full quote, often skipped, ends with: "Yet we should not pass up our opportunities in that critical 3%." Junior engineers usually overcorrect in one of two directions:

| Mistake | Symptom |
|---------|---------|
| Premature optimization | Spending hours micro-optimizing code that runs 100 times a day |
| "Performance doesn't matter" | Letting an obvious O(n²) into the hot path because "we can fix it later" |

The rule: don't optimize until you've measured. But also don't write code that you *know* will be slow if you have a clearly better option at the same complexity cost.

---

## 12. What "good enough" looks like

The goal is not the fastest possible code. The goal is code that meets its target with margin. Once you're hitting the target with 20% headroom, stop. The marginal cost of the next 5% improvement is almost always higher than the value.

---

## 13. The five rules for the junior optimizer

1. Never optimize without a benchmark.
2. Change one thing per measurement.
3. Run the benchmark at least 10 times and use `benchstat`.
4. Use the right standard library tool before getting clever.
5. Stop when the goal is met; don't chase shrinking returns.

These five rules cover 90% of the work you'll do in your first year of performance engineering in Go. The remaining 10% is what we explore in the middle, senior, and professional levels.

---

## 14. Summary

The optimization workflow is a small, repeatable loop: set a goal, measure, hypothesize one change, apply it, re-measure. The discipline is not in cleverness — it's in not skipping steps. Build the habit of starting every "make this faster" task by writing a benchmark and saving its output. After ten honest loops, the rest of the toolkit becomes much easier to learn.

---

## Further reading
- `testing.B` reference: https://pkg.go.dev/testing#hdr-Benchmarks
- `benchstat` overview: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Dave Cheney, "High Performance Go" talks: https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html
- Brendan Gregg on flame graphs: https://www.brendangregg.com/flamegraphs.html
