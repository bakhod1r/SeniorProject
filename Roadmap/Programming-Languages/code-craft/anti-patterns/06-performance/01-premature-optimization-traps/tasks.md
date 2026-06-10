# Premature Optimization Traps — Exercises

> **Category:** [Performance Anti-Patterns](../README.md) → **Premature Optimization Traps** — *hands-on practice telling measured optimization from guessed.*

---

These are **do-it** exercises, not recognition quizzes. For each one you get a problem statement, starting code (Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The recurring skill is the discipline from the level files: **profile to find the real hotspot, benchmark to prove a change, and revert clever code that the numbers say does nothing.**

> **How to use this file.** Try each in your editor *before* opening the solution — and where it says "prove it," actually run the benchmark. The number is the point; the gap between what you *expected* the number to be and what it *was* is where the learning is. Refer back to [`middle.md`](middle.md) for the tooling and [`senior.md`](senior.md) for the judgment.

---

## Table of Contents

| # | Exercise | Skill | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Find the true hotspot](#exercise-1--find-the-true-hotspot) | Profile, don't guess | Python | ★ easy |
| 2 | [Revert the unhelpful micro-opt](#exercise-2--revert-the-unhelpful-micro-opt) | Benchmark proves it's noise | Go | ★ easy |
| 3 | [Clarity-neutral vs clarity-costing](#exercise-3--clarity-neutral-vs-clarity-costing) | Spot the difference | Java | ★★ medium |
| 4 | [Write the benchmark that guards a justified opt](#exercise-4--write-the-benchmark-that-guards-a-justified-opt) | Guard a real win | Go | ★★ medium |
| 5 | [Catch the lying benchmark](#exercise-5--catch-the-lying-benchmark) | Dead-code elimination | Go | ★★★ hard |
| 6 | [Diagnose flat vs spiky](#exercise-6--diagnose-flat-vs-spiky) | Two failures, two cures | (process) | ★★★ hard |

---

## Exercise 1 — Find the true hotspot

**Skill:** profile before optimizing · **Language:** Python · **Difficulty:** ★ easy

A report builder is slow. A colleague is about to "optimize" the price math. Profile it and tell them where the time *actually* goes.

```python
def build_report(orders):
    rows = []
    for o in orders:                              # 20,000 orders
        total = sum(li.qty * li.price for li in o.lines)   # colleague wants to optimize this
        name = lookup_customer_name(o.customer_id)         # hits the DB, once per order
        rows.append({"id": o.id, "name": name, "total": total})
    return rows
```

**Acceptance criteria**
- Produce profiler output identifying the dominant function (the hotspot).
- State whether the price-math optimization is premature, with the % to back it.
- Fix only the hotspot; leave the price math untouched.

<details>
<summary>Solution</summary>

**Profile first.**

```bash
python -m cProfile -s cumtime build_report.py
#   ncalls   cumtime  function
#    20000    16.4s   lookup_customer_name   <-- 95% of the time (per-order DB call)
#    20000     0.5s   build_report (sum)     <-- ~3%, the colleague's target
```

**Verdict:** optimizing the `sum` is **premature** — it's ~3% of runtime. The hotspot is `lookup_customer_name`, called once per order: an N+1. Tuning the price math would make the code uglier and the report **still 16s slow**.

**Fix only the hotspot** — batch the lookups, leave the clear `sum` exactly as it is:

```python
def build_report(orders):
    ids = {o.customer_id for o in orders}
    names = lookup_customer_names(ids)            # ONE query
    return [
        {"id": o.id,
         "name": names[o.customer_id],
         "total": sum(li.qty * li.price for li in o.lines)}  # unchanged
        for o in orders
    ]
```

**Why it's better.** The profiler chose the target, not intuition. We removed the 95% (≈16s → ≈0.3s) and didn't touch the clear 3%. The lesson is the ordering: *profile → fix the proven hotspot → leave the rest clear*.

</details>

---

## Exercise 2 — Revert the unhelpful micro-opt

**Skill:** benchmark proves a "speed-up" is noise · **Language:** Go · **Difficulty:** ★ easy

Someone replaced a clear range-loop with a hand-unrolled, bit-tricked version "for speed." Prove with a benchmark whether it helped, and act on the result.

```go
// The "optimized" version that landed in the PR:
func CountEvens(xs []int) int {
	n, i, c := len(xs), 0, 0
	for ; i+4 <= n; i += 4 {
		c += (^xs[i] & 1) + (^xs[i+1] & 1) + (^xs[i+2] & 1) + (^xs[i+3] & 1)
	}
	for ; i < n; i++ {
		c += ^xs[i] & 1
	}
	return c
}
```

**Acceptance criteria**
- Write the obvious version.
- Benchmark both with `-count=10` and compare with `benchstat`.
- Keep whichever the numbers justify; if it's noise, revert to the clear version.

<details>
<summary>Solution</summary>

**The obvious version:**

```go
func CountEvensClear(xs []int) int {
	c := 0
	for _, x := range xs {
		if x%2 == 0 {
			c++
		}
	}
	return c
}
```

**Benchmark both** (same input, 10 runs each):

```go
var sink int
func BenchmarkUnrolled(b *testing.B) {
	xs := makeInts(10000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ { sink = CountEvens(xs) }
}
func BenchmarkClear(b *testing.B) {
	xs := makeInts(10000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ { sink = CountEvensClear(xs) }
}
```

```text
$ go test -bench='Unrolled|Clear' -count=10 | benchstat -
            │  unrolled   │            clear             │
            │   sec/op    │   sec/op     vs base         │
CountEvens    3.11µ ± 2%    3.08µ ± 2%   ~ (p=0.41 n=10)
```

`~ (p=0.41)` → **no significant difference.** The bit-tricks bought nothing.

**Act on it: revert to the clear version.** It reads at a glance, has no `i+4 <= n` off-by-one risk, no `^x & 1` correctness puzzle, and benchmarks identically. The compiler vectorizes the simple loop as well as (or better than) the manual unroll.

**Why it's better.** The "optimization" was clarity-costing with zero measured gain — all three trap conditions. The benchmark is what let us delete it *with confidence* rather than argue about it.

</details>

---

## Exercise 3 — Clarity-neutral vs clarity-costing

**Skill:** classify efficiency by its readability cost · **Language:** Java · **Difficulty:** ★★ medium

For each change below, decide: is it **clarity-neutral** (do it always, no measurement needed), **clarity-costing/premature** (defer until profiled), or **design** (decide up front)? Justify each.

```java
// (a)
List<String> a1 = new ArrayList<>();      →  List<String> a1 = new ArrayList<>(expectedSize);
// (b)
if (list.contains(x)) {...}  // list is scanned every call, in a hot loop, n large
                                          →  if (set.contains(x)) {...}  // set built once
// (c)
return "Hello, " + name;                  →  return new StringBuilder().append("Hello, ").append(name).toString();
// (d)
int half = n / 2;                         →  int half = n >> 1;
// (e)
for (Order o : orders) total += o.amount; →  total = orders.stream().mapToLong(Order::amount).sum();
```

**Acceptance criteria**
- Classify each as neutral / costing-premature / design, with a one-line reason.

<details>
<summary>Solution</summary>

| | Change | Classification | Reason |
|---|---|---|---|
| (a) | pre-size the `ArrayList` | **clarity-neutral** | Same readability, avoids reallocs. Do it when the size is known; no measurement needed. |
| (b) | `list.contains` → `set.contains` | **design** | O(n)→O(1) for a repeated lookup driven by the known access pattern; same readability. Decide up front. |
| (c) | `+` → `StringBuilder` chain | **clarity-costing / premature** | The compiler already optimizes `+`; the chain is *less* readable for zero measured gain. |
| (d) | `n / 2` → `n >> 1` | **clarity-costing / premature** | The compiler emits the same instruction for `/2`; the shift is a clarity-costing micro-opt with no gain. |
| (e) | manual loop → `stream().sum()` | **clarity-neutral** (taste) | Equivalent readability and performance for a sum; pick the team's idiom. Not an optimization either way. |

**Why it matters.** The dividing line is **readability cost, not speed**. (a), (b), (e) cost no clarity — take them freely. (c), (d) trade clarity for speed the compiler already provides — defer/skip them. Conflating "be efficient" (always fine when free) with "micro-optimize" (measurement-gated) is the core confusion this anti-pattern fixes.

</details>

---

## Exercise 4 — Write the benchmark that guards a justified opt

**Skill:** pin a real, measured optimization · **Language:** Go · **Difficulty:** ★★ medium

A profile shows `Normalize` is 60% of CPU in an ingestion hot loop. You have a faster version that avoids re-allocating per call. The faster version is uglier — so it **must** ship with a benchmark guard and a correctness oracle, or it's just premature optimization with extra steps.

```go
// Hot (profiled at 60% CPU): clear version allocates a new slice every call.
func Normalize(xs []float64) []float64 {
	out := make([]float64, len(xs))
	max := maxAbs(xs)
	for i, x := range xs { out[i] = x / max }
	return out
}

// Faster (justified): normalizes in place into a caller-provided buffer (no per-call alloc).
func NormalizeInto(dst, xs []float64) {
	max := maxAbs(xs)
	for i, x := range xs { dst[i] = x / max }
}
```

**Acceptance criteria**
- A correctness oracle: `NormalizeInto` agrees with `Normalize` for random inputs.
- A benchmark comparing the two, so a future refactor that regresses the win fails review.
- A comment explaining *why* the ugly version exists.

<details>
<summary>Solution</summary>

```go
// Correctness oracle — the fast version must match the clear one everywhere.
func TestNormalizeIntoMatches(t *testing.T) {
	for trial := 0; trial < 1000; trial++ {
		xs := randFloats(rand.Intn(64) + 1)
		want := Normalize(xs)
		got := make([]float64, len(xs))
		NormalizeInto(got, xs)
		if !floatsEqual(got, want) {
			t.Fatalf("mismatch for %v: got %v want %v", xs, got, want)
		}
	}
}

// Benchmark guard — committed so CI shows if the win ever evaporates.
var fsink []float64
func BenchmarkNormalize(b *testing.B) {        // clear, allocates
	xs := randFloats(1024)
	b.ReportAllocs(); b.ResetTimer()
	for i := 0; i < b.N; i++ { fsink = Normalize(xs) }
}
func BenchmarkNormalizeInto(b *testing.B) {    // fast, reuses buffer
	xs := randFloats(1024)
	dst := make([]float64, len(xs))
	b.ReportAllocs(); b.ResetTimer()
	for i := 0; i < b.N; i++ { NormalizeInto(dst, xs); fsink = dst }
}
```

```text
$ go test -bench=Normalize -benchmem -count=10 | benchstat -
                   sec/op        B/op       allocs/op
Normalize-10       1.12µs ± 2%   8192 ± 0%    1 ± 0%
NormalizeInto-10   0.74µs ± 1%      0 ± 0%    0 ± 0%   <-- 34% faster, zero allocs
```

And the why-comment on the fast function:

```go
// NormalizeInto avoids the per-call slice allocation that Normalize incurs.
// Justified: profiled at 60% CPU in the ingestion loop; benchmark shows
// 34% faster, 0 allocs (see BenchmarkNormalizeInto). Verified equal to
// Normalize by TestNormalizeIntoMatches. Keep both: clear API + hot-path buffer reuse.
```

**Why it's better.** This is the difference between a *justified* micro-opt and a premature one — **the evidence**. There's a profile (it's hot), a benchmark (the win is real, 34% + zero allocs), an oracle (it's still correct), and a comment (the next person knows it's deliberate). Without those four, the same `NormalizeInto` would be premature optimization.

</details>

---

## Exercise 5 — Catch the lying benchmark

**Skill:** spot dead-code elimination · **Language:** Go · **Difficulty:** ★★★ hard

A teammate "proves" their hashing tweak is 50× faster with this benchmark. The number is a lie. Find why, fix the benchmark, and re-measure.

```go
func BenchmarkHash(b *testing.B) {
	data := []byte("the quick brown fox")
	for i := 0; i < b.N; i++ {
		hash(data)          // result discarded
	}
}
// Reported: "0.31 ns/op — 50x faster than the old hash!"
```

**Acceptance criteria**
- Explain why 0.31 ns/op is impossible for a real hash and what happened.
- Rewrite the benchmark so the work can't be eliminated.
- Note the general rule.

<details>
<summary>Solution</summary>

**What happened: dead-code elimination.** `hash(data)`'s result is never used, so the compiler proves the call has no observable effect and **deletes it**. The benchmark measures an empty loop — 0.31 ns/op is the cost of incrementing `i`, not of hashing. The "50× faster" is an artifact; the tweak may do nothing (or be slower).

**Fix — make the result escape so it can't be eliminated:**

```go
var sink uint64           // package-level: the compiler can't prove it's unused

func BenchmarkHash(b *testing.B) {
	data := []byte("the quick brown fox")
	var h uint64
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h = hash(data)     // accumulate
	}
	sink = h               // publish — forces the work to actually run
}
```

```text
$ go test -bench=Hash -count=10 | benchstat -
        old.txt (0.31n, a lie)   →   new.txt (real measurement)
Hash                                   18.7n ± 2%
```

The real cost is ~18.7 ns/op. Now compare old vs new *honestly* with `benchstat` on two real runs — and the tweak may well show `~ (p>0.05)`, i.e. premature.

**General rule.** A benchmark whose result is unused gets dead-code-eliminated to nothing. Always consume the result — Go `sink`/`runtime.KeepAlive`, JMH `Blackhole`, or return it. A benchmark that lies is *worse* than no benchmark: it gives a premature optimization a number to hide behind.

</details>

---

## Exercise 6 — Diagnose flat vs spiky

**Skill:** pick the right cure from the profile's shape · **Difficulty:** ★★★ hard

Two services miss the same SLO. Their flame graphs differ. Diagnose each and prescribe the cure.

**Service A profile:**
```text
68%  serializeResponse  (one giant JSON encode of a 4MB object)
14%  db.fetch
 9%  auth
 ... rest small ...
```

**Service B profile:**
```text
 4%  fmt.Sprintf (scattered)
 3%  defensive copy() in 12 handlers
 3%  json re-parse of already-parsed config
 2%  time.Format in a log line
 ... 25 more frames at 1-3% each, nothing dominant ...
```

**Acceptance criteria**
- Name each failure mode and its cure.
- For A, state the Amdahl ceiling of fixing the top frame.
- For B, explain why "find the hotspot" is the wrong instruction.

<details>
<summary>Solution</summary>

**Service A — a real hotspot (spiky).** 68% in one frame. This is *not* premature-optimization territory — it's exactly the "critical 3%" Knuth says to seize. Cure: optimize `serializeResponse` (stream it, encode only needed fields, swap the encoder), **box it** behind the existing interface, and **guard it with a benchmark**. Amdahl ceiling of fixing the top frame: making it free caps the win at `1/(1−0.68) − 1 ≈ 3.1×` — a huge, worthwhile target.

**Service B — death by a thousand cuts (flat).** No frame dominates; the slowness is smeared across 25+ small frames. **"Find the hotspot" is wrong because there isn't one** — even zeroing the biggest (4%) frame barely moves the total (Amdahl: ≤4.2%). The cure is the *opposite* of A's: a **broad clarity-neutral sweep** — `strconv` instead of `Sprintf`, drop copies nobody mutates, parse config once, gate log formatting on level — applied across all the small frames, plus a look for a **systemic lever** (a framework or allocation-strategy change that moves many frames at once).

**Why it matters.** The two failures need opposite medicine, and the **profile's shape** is the diagnostic. Prescribing A's "find and fix the hotspot" to B sends you hunting a hotspot that doesn't exist; prescribing B's "we don't micro-optimize, sweep broadly" to A wastes the chance at a 3× win sitting in one frame. Read the shape first.

</details>

---

## The discipline — recap

Every exercise ran the same loop:

```text
profile (find the real target)  →  benchmark (prove the change)  →
keep only if the number is real  →  leave everything else clear
```

- **Profile before you touch anything.** The hotspot is rarely where intuition points (Ex. 1). Guessing *is* premature optimization.
- **Benchmark to decide, not to confirm a bias.** `~ (p>0.05)` means revert (Ex. 2); and a benchmark whose result is discarded *lies* (Ex. 5).
- **Classify by readability cost.** Clarity-neutral wins are free and always taken; clarity-costing tweaks are measurement-gated (Ex. 3).
- **A justified opt ships with evidence** — profile, benchmark guard, correctness oracle, why-comment (Ex. 4). Without them it's premature.
- **Read the profile's shape.** Spiky → fix and box the hotspot; flat → broad sweep / systemic lever. Same SLO miss, opposite cures (Ex. 6).

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognize → measure → judge → the hard line.
- [`find-bug.md`](find-bug.md) — the spotting counterpart: judge measured-vs-guessed in snippets.
- [`interview.md`](interview.md) — the Q&A on the same ideas.
- [N+1 in Code](../02-n-plus-one-in-code/tasks.md) — the hotspot Exercise 1 actually found.
- [Unnecessary Allocation](../03-unnecessary-allocation/tasks.md) — the win Exercise 4 measured (zero allocs).
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — reverting an over-clever optimization is a refactoring with a benchmark attached.
- The `profiling-techniques` and `big-o-analysis` skills — the measurement toolkit these exercises use.
