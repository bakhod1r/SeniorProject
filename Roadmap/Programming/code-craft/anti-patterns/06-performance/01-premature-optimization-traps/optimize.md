# Premature Optimization Traps — Optimize It (Inverted)

> **Category:** [Performance Anti-Patterns](../README.md) → **Premature Optimization Traps** — *code twisted for speed that was never measured and rarely matters.*

---

This `optimize.md` is **inverted**. For the other anti-patterns in this chapter you take slow code and make it fast. Here you do the opposite, because the anti-pattern *is* misplaced speed: you take code that was prematurely "optimized" into an unreadable mess and **simplify it back to clarity — then prove, with a benchmark, that the simplification cost nothing** (and sometimes gained). "Optimizing" a premature optimization means *removing* it.

The file ends with the necessary counterweight: **one real hotspot, correctly optimized with measurement** — so you see that the discipline isn't "never optimize," it's "optimize the proven 3%, and prove it." Every case shows before/after with numbers.

> **How to use this file:** for each case, predict the benchmark delta *before* reading it. If you expect the "optimized" version to be meaningfully faster and it isn't, that prediction error is the lesson. The numbers below are representative (Apple M-series / OpenJDK 21 / CPython 3.12) — reproduce them on your machine; the *shape* of the result is what generalizes.

---

## Table of Contents

| # | Case | Direction | Lang |
|---|---|---|---|
| 1 | [Un-unroll the loop](#case-1--un-unroll-the-loop) | simplify back | Go |
| 2 | [Delete the StringBuilder ceremony](#case-2--delete-the-stringbuilder-ceremony) | simplify back | Java |
| 3 | [Rip out the cache that costs more than it saves](#case-3--rip-out-the-cache-that-costs-more-than-it-saves) | simplify back | Python |
| 4 | [Un-inline the hand-flattened helper](#case-4--un-inline-the-hand-flattened-helper) | simplify back | Go |
| 5 | [The real hotspot, correctly optimized](#case-5--the-real-hotspot-correctly-optimized) | **optimize for real** | Go |

---

## Case 1 — Un-unroll the loop

**Before — manually 4-way unrolled with a bit trick.** Someone "optimized" a dot product.

```go
func Dot(a, b []float64) float64 {
	var s0, s1, s2, s3 float64
	n, i := len(a), 0
	for ; i+4 <= n; i += 4 { // manual 4-way unroll into 4 accumulators
		s0 += a[i] * b[i]
		s1 += a[i+1] * b[i+1]
		s2 += a[i+2] * b[i+2]
		s3 += a[i+3] * b[i+3]
	}
	sum := s0 + s1 + s2 + s3
	for ; i < n; i++ { // tail
		sum += a[i] * b[i]
	}
	return sum
}
```

**After — the obvious loop.**

```go
func Dot(a, b []float64) float64 {
	var sum float64
	for i := range a {
		sum += a[i] * b[i]
	}
	return sum
}
```

**Prove it** (`go test -bench=Dot -count=10 | benchstat -`, n=4096):

```text
            │  unrolled   │             clear              │
            │   sec/op    │   sec/op     vs base           │
Dot-10        1.42µs ± 2%   1.41µs ± 1%   ~ (p=0.55 n=10)
```

**Result: identical (`~`, p=0.55).** The compiler schedules the simple loop just as well — and on architectures where it auto-vectorizes, the clean version can *win*. The unroll bought nothing and cost the tail-loop bookkeeping (an `i+4 <= n` off-by-one waiting to happen) plus four accumulators a reader must mentally re-combine. **Clarity was free.**

> Note the subtle behavioral trap the unroll *introduced*: four separate accumulators sum floats in a different order than one accumulator, so the two versions can disagree in the last ULP. The "optimization" silently changed the result. Reverting also restored the obvious summation order.

---

## Case 2 — Delete the StringBuilder ceremony

**Before — `StringBuilder` for a fixed three-part string.**

```java
String url(String host, int port, String path) {
    return new StringBuilder()
        .append("https://").append(host)
        .append(':').append(port)
        .append('/').append(path)
        .toString();
}
```

**After — plain concatenation.**

```java
String url(String host, int port, String path) {
    return "https://" + host + ":" + port + "/" + path;
}
```

**Prove it** (JMH, `AverageTime`, 5 warm-up + 10 measured iterations, 3 forks):

```text
Benchmark            Mode  Cnt   Score   Error  Units
url_stringBuilder    avgt   30   38.1 ±  1.2   ns/op
url_concat           avgt   30   31.7 ±  0.9   ns/op   <-- clearer AND ~17% faster
```

**Result: the clear version is *faster*.** On modern JDKs, `javac` compiles `+` concatenation through `StringConcatFactory` (an `invokedynamic` bootstrap) that often beats a hand-written `StringBuilder` chain — and it's one readable line. The "optimization" was both slower and uglier. **Reverting it improved both axes.**

> The `StringBuilder` *is* the right call inside a loop with unknown iteration count — that's the measurable case. For a fixed, small number of operands, the compiler wins. Know which case you're in; don't apply the reflex blindly.

---

## Case 3 — Rip out the cache that costs more than it saves

**Before — a memoization dict around a cheap computation, in a request hot path.**

```python
_fee_cache = {}

def fee(amount: float) -> float:
    key = round(amount, 2)
    if key in _fee_cache:
        return _fee_cache[key]
    result = amount * 0.029 + 0.30   # the entire "expensive" computation
    _fee_cache[key] = result
    return result
```

**After — just compute it.**

```python
def fee(amount: float) -> float:
    return amount * 0.029 + 0.30
```

**Prove it** (`pyperf timeit`, distinct amounts so the cache actually misses like production):

```text
cached:   210 ns ± 7 ns   per call   (dict lookup + insert + the multiply)
direct:    48 ns ± 2 ns   per call   (just the multiply)   <-- 4.4x FASTER
```

**Result: the cache made it 4× *slower*** — the dict lookup and insert cost far more than the multiply-add they "save," and real traffic has distinct amounts so the hit rate is low anyway. Worse, the cache is an **unbounded memory leak** (every distinct `amount` retained forever) and shared mutable state (not thread-safe). The "optimization" added a leak, a race, and a slowdown.

**Removing it** restored a pure, fast, thread-safe one-liner. Caching is justified only when a profile shows the computation is *expensive and repeated with the same inputs* — neither held here.

---

## Case 4 — Un-inline the hand-flattened helper

**Before — a validation helper hand-inlined "to avoid the call".**

```go
func process(rs []*Record) {
	for _, r := range rs {
		// validity check inlined by hand at 3 call sites in this file:
		if r != nil && r.ID > 0 && r.Name != "" &&
			r.TS > 0 && r.TS < time.Now().UnixNano() {
			save(r)
		}
	}
}
```

**After — extract the named helper back out.**

```go
func valid(r *Record) bool {
	return r != nil && r.ID > 0 && r.Name != "" &&
		r.TS > 0 && r.TS < time.Now().UnixNano()
}

func process(rs []*Record) {
	for _, r := range rs {
		if valid(r) {
			save(r)
		}
	}
}
```

**Prove it** (`go test -bench=Process -count=10`; confirm inlining with `-gcflags=-m`):

```text
$ go build -gcflags='-m' ./... 2>&1 | grep 'inline.*valid'
./record.go:1:6: can inline valid
./record.go:14:11: inlining call to valid     <-- compiler inlines it for us

$ benchstat hand-inlined.txt extracted.txt
            │ hand-inlined │           extracted            │
            │   sec/op     │   sec/op     vs base           │
Process-10    9.81µs ± 1%    9.79µs ± 2%   ~ (p=0.73 n=10)
```

**Result: identical (`~`), because the compiler inlines `valid` anyway** — the `-gcflags=-m` output proves it. The hand-inlining gained nothing the compiler wasn't already doing, while *costing* a named concept and duplicating the rule across three call sites (so a future change to "valid" must be made in three places — a real bug magnet). **Extracting it back was free at runtime and a large readability win.**

---

## Case 5 — The real hotspot, correctly optimized

The counterweight. The discipline is **not** "never optimize" — it's "optimize the *proven* hotspot, and prove the win." Here's that done right, so the contrast with Cases 1–4 is sharp.

**The situation.** A log-ingestion service misses its throughput target. We **profile** before touching anything:

```bash
go test -bench=Ingest -cpuprofile cpu.out
go tool pprof -top cpu.out
#   flat  flat%   function
#  4.20s  63.1%   parseTimestamp     <-- the hotspot; called per log line
#  0.91s  13.7%   splitFields
#  ...
```

`parseTimestamp` is **63% of CPU**, measured, on the hottest path (per line). This is Knuth's critical 3% — the place optimization is *supposed* to go. The before code re-parses the layout string on every call:

```go
// Before — time.Parse re-interprets the layout for every single line.
func parseTimestamp(s string) (int64, error) {
	t, err := time.Parse("2006-01-02T15:04:05Z07:00", s) // hot: millions of calls
	if err != nil {
		return 0, err
	}
	return t.UnixNano(), nil
}
```

**The fix** — a specialized parser for the known, fixed format, avoiding the general layout machinery. It's uglier, so it ships **boxed**: a clean signature, a fuzz oracle proving it matches `time.Parse`, and a benchmark guard.

```go
// After — hand parse the fixed RFC3339-UTC shape. Justified: 63% of CPU
// (see cpu.out / PR), 3.1x faster (BenchmarkParseTimestamp), verified equal
// to time.Parse by FuzzParseTimestamp. Don't simplify without re-benchmarking.
func parseTimestamp(s string) (int64, error) {
	if len(s) != 20 || s[4] != '-' || s[10] != 'T' || s[19] != 'Z' {
		return slowParse(s) // fall back to time.Parse for anything unexpected
	}
	y := atoi4(s[0:4]); mo := atoi2(s[5:7]); d := atoi2(s[8:10])
	h := atoi2(s[11:13]); mi := atoi2(s[14:16]); sec := atoi2(s[17:19])
	return time.Date(y, time.Month(mo), d, h, mi, sec, 0, time.UTC).UnixNano(), nil
}
```

**Prove it** (`benchstat`, `-count=10`):

```text
                      │   before    │             after              │
                      │   sec/op    │   sec/op     vs base           │
ParseTimestamp-10       198.0n ± 1%   63.4n ± 1%   -68.0% (p=0.000)
```

And confirm the **whole-program** win by re-profiling:

```text
ingestion throughput:  1.0x  →  2.4x   (re-profiled; parseTimestamp now 8% of CPU)
```

**Why this is the right kind of optimization — and the inverse of Cases 1–4:**

| | Cases 1–4 (premature) | Case 5 (justified) |
|---|---|---|
| Profile says it's hot? | No | **Yes — 63% of CPU** |
| Benchmark proves the win? | No (it was noise/negative) | **Yes — 3.1×, p=0.000** |
| Win matters? | No (cold/cheap) | **Yes — 2.4× throughput** |
| Guarded + oracle + comment? | No | **Yes — fuzz oracle + benchmark + why** |
| Verdict | **remove it** | **keep it, boxed** |

The cleverness in Case 5 is no greater than in Case 1 — what makes it right is the **evidence and the box around it**. And note the re-profile: after the fix, `parseTimestamp` dropped to 8%, so it's no longer the hotspot. The next optimization target (if any) is now `splitFields` — and you'd repeat the loop, or stop if you've hit the throughput target.

---

## The discipline — recap

Inverting the usual exercise drove home the anti-pattern's core truth:

- **Most "optimizations" benchmark as noise or worse** (Cases 1, 4: `~`; Cases 2, 3: the clear version *wins*). Simplifying them back is free or a gain — and removes the bugs they smuggled in (Case 1's reordered float sum, Case 3's leak + race, Case 4's duplication).
- **The clear version is the optimizer's friend.** Compilers inline (Case 4), vectorize (Case 1), and pick the best concat strategy (Case 2) *for* you — and do it better on code they recognize. Hand-doing their job usually ties their hands.
- **"Optimizing" a premature optimization means deleting it** and proving with `benchstat`/JMH/`pyperf` that clarity cost nothing.
- **Real optimization is the same discipline pointed at the proven 3%** (Case 5): profile → confirm it's hot → benchmark the fix → box it with an oracle and a guard → re-profile. The cleverness is identical to the premature cases; the *evidence* is what makes it right.

```text
premature:  clever  +  no profile  +  no benchmark   →  REMOVE (clarity is free)
justified:  clever  +  profiled hot +  benchmarked    →  KEEP, boxed (the critical 3%)
```

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognize → measure → judge → the hard line.
- [`find-bug.md`](find-bug.md) — the spotting counterpart, including the justified opt you must *not* delete.
- [`tasks.md`](tasks.md) — guided practice: revert an unhelpful micro-opt and guard a justified one.
- [N+1 in Code → optimize.md](../02-n-plus-one-in-code/optimize.md) · [Unnecessary Allocation → optimize.md](../03-unnecessary-allocation/optimize.md) · [Wrong Data Structure → optimize.md](../04-wrong-data-structure/optimize.md) — the *real* hotspots, where `optimize.md` runs in its normal direction.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — reverting an over-clever optimization is a refactoring with a benchmark attached.
- The `profiling-techniques` and `big-o-analysis` skills — the measurement that separates Case 5 from Cases 1–4.
