# Unnecessary Allocation — Optimization Practice

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *take an allocation-heavy hot path, profile it, and cut the churn — with the numbers to prove it.*

---

This file is one **end-to-end optimization**, the way you'd actually do it: a realistic hot path that allocates too much, a profile that *proves where*, a sequence of behavior-preserving cuts, and before/after `allocs/op` + `ns/op` at every step. The discipline is the senior file's: **profile first, fix the proven site, re-measure, stop when the numbers stop moving** — and the closing caveat that none of this mattered except because the path was hot.

> **How to use this file:** don't skim to the final code. The *sequence* — measure, attribute, cut one thing, re-measure — is the transferable skill. The final fast version is worthless without the profile that justified each step.

---

## Table of Contents

1. [The hot path](#the-hot-path)
2. [Step 0 — Establish the baseline](#step-0--establish-the-baseline)
3. [Step 1 — Profile: where does it allocate?](#step-1--profile-where-does-it-allocate)
4. [Step 2 — Cut the string churn](#step-2--cut-the-string-churn)
5. [Step 3 — Presize the result](#step-3--presize-the-result)
6. [Step 4 — Kill the boxing](#step-4--kill-the-boxing)
7. [Step 5 — Re-profile and stop](#step-5--re-profile-and-stop)
8. [The scoreboard](#the-scoreboard)
9. [The caveat that makes it honest](#the-caveat-that-makes-it-honest)
10. [Related Topics](#related-topics)

---

## The hot path

A log-ingestion service parses lines like `2026-06-10T12:00:00Z user=4412 bytes=918` into events, called **~500k times/sec**. The service is CPU-bound and a flame graph points at GC. Here's the function:

```go
type Event struct {
	Day   string
	User  int
	Bytes int
}

// parseLine is called ~500k/sec. It allocates a lot.
func parseLines(lines []string) []Event {
	events := []Event{} // (a) un-presized
	for _, line := range lines {
		parts := strings.Split(line, " ") // (b) allocates a []string + substrings per line
		if len(parts) != 3 {
			continue
		}
		day := strings.Split(parts[0], "T")[0] // (c) another split, another throwaway slice
		userStr := strings.TrimPrefix(parts[1], "user=")
		bytesStr := strings.TrimPrefix(parts[2], "bytes=")

		// (d) Sprintf to "normalize" the day — boxes its args + allocs a string
		key := fmt.Sprintf("%s", day)

		user, _ := strconv.Atoi(userStr)
		nbytes, _ := strconv.Atoi(bytesStr)
		events = append(events, Event{Day: key, User: user, Bytes: nbytes})
	}
	return events
}
```

Four allocation sites are hiding in there. The discipline is **not** to fix all four on sight — it's to *measure*, attribute the cost, and cut in order of impact.

---

## Step 0 — Establish the baseline

You cannot optimize what you haven't measured. A benchmark with `-benchmem`, realistic input, and a sink to defeat dead-code elimination:

```go
var sink []Event

func BenchmarkParseLines(b *testing.B) {
	lines := makeLogLines(10000) // realistic batch size
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sink = parseLines(lines) // escapes → not eliminated
	}
}
```

```bash
go test -bench=ParseLines -benchmem -memprofile=mem.out
```

```text
# BASELINE
BenchmarkParseLines-8   424   2_812_004 ns/op   3_640_320 B/op   60_021 allocs/op
```

**60,021 allocations** to parse 10,000 lines — ~6 per line. That ratio (allocs ≈ 6 × lines) is the smell: per-line throwaway work. Now find which 6.

---

## Step 1 — Profile: where does it allocate?

```bash
go tool pprof -alloc_objects mem.out
```

```text
(pprof) top
      flat  flat%   cum   cum%
  20003  33%   20003  33%  strings.Split           ← parts := Split(line," ")
  10000  17%   10000  17%  strings.Split (day)     ← Split(parts[0],"T")
  10000  17%   10000  17%  fmt.Sprintf             ← key := Sprintf(...)
  10000  17%   10000  17%  strconv/Event append    ← un-presized growth + strings
   ...
```

The profile, not intuition, gives the order: the two `strings.Split` calls dominate (50% of allocations), `Sprintf` is pure waste (17%), and the un-presized `events` slice contributes its own reallocation chain. We attack them in impact order.

---

## Step 2 — Cut the string churn

`strings.Split` allocates a `[]string` *and* the substring headers every call. We don't need a full split — we need three fields by known delimiters. `strings.Cut` (Go 1.18+) splits on the first separator **without allocating a slice**, and the day is just the prefix before `T`.

```go
// Replace Split with Cut: no per-line []string allocation.
func parseLine(line string) (Event, bool) {
	rest := line
	ts, rest, ok := strings.Cut(rest, " ")
	if !ok { return Event{}, false }
	userF, rest, ok := strings.Cut(rest, " ")
	if !ok { return Event{}, false }
	bytesF := rest

	day, _, _ := strings.Cut(ts, "T") // prefix before 'T', no slice
	userStr := strings.TrimPrefix(userF, "user=")
	bytesStr := strings.TrimPrefix(bytesF, "bytes=")
	// ... (Sprintf and append still as-is for now)
}
```

Re-measure after *this change only* (one cut at a time so you can attribute the win):

```text
# after Step 2 (Cut instead of Split ×2)
BenchmarkParseLines-8   902   1_310_887 ns/op   1_960_184 B/op   30_019 allocs/op
```

60,021 → **30,019** allocs (the two Splits gone), `ns/op` halved. `strings.Cut` returns sub-slices of the original string's backing array — **zero** new allocation for the field-splitting. Output unchanged.

---

## Step 3 — Presize the result

`events := []Event{}` reallocates ~log₂(10000) ≈ 14 times as it grows. We know the upper bound is `len(lines)`.

```go
events := make([]Event, 0, len(lines)) // cap = upper bound
```

```text
# after Step 3 (presize events)
BenchmarkParseLines-8   968   1_201_433 ns/op   1_320_… B/op   20_006 allocs/op
```

30,019 → **20,006**: the ~14 reallocations of the growing slice collapse to 1. Modest in count but it removes a chain of full-slice copies (each realloc copies all prior `Event`s). Note we presize to `len(lines)` even though some lines are skipped — over-reserving a little beats reallocating.

---

## Step 4 — Kill the boxing

```go
key := fmt.Sprintf("%s", day)
```

This is the dumbest allocation in the function: `Sprintf("%s", day)` boxes `day` into an `interface{}`, runs the formatting machinery, and produces a string **equal to `day`**. It does nothing but allocate. Delete it.

```go
events = append(events, Event{Day: day, User: user, Bytes: nbytes})
```

```text
# after Step 4 (drop the pointless Sprintf)
BenchmarkParseLines-8  1693   685_204 ns/op   720_… B/op   10_004 allocs/op
```

20,006 → **10,004**: the per-line `Sprintf` (a string alloc + an interface box, 2 allocations folded into the count) is gone. We're now at ~1 alloc/line — the `day` substring header retained in each `Event`. (That last one is *necessary*: the `Event` keeps the day string, which references the line's backing array; if we wanted zero we'd intern days, but the profile no longer justifies it.)

---

## Step 5 — Re-profile and stop

```bash
go test -bench=ParseLines -benchmem -memprofile=mem2.out
go tool pprof -alloc_objects mem2.out
```

```text
(pprof) top
  10004  ~99%   ...  parseLines (Event.Day string header — intrinsic)
```

The profile is now **flat** at one intrinsic allocation per event. There's no dominant wasteful site left. Could we intern day strings to push toward zero? Yes — but it adds a map, a lifetime question, and complexity, to shave the *last* allocation that the profile says is no longer the bottleneck (the function is now ~4× faster and GC dropped off the flame graph). **We stop.** Chasing the last allocation is exactly the over-optimization the senior file warns against.

---

## The scoreboard

| Step | Change | `allocs/op` | `B/op` | `ns/op` | Δ |
|---|---|---|---|---|---|
| 0 | Baseline | 60,021 | 3.64 MB | 2,812,004 | — |
| 2 | `strings.Cut` ×2 (no Split) | 30,019 | 1.96 MB | 1,310,887 | 2.1× faster |
| 3 | Presize `events` | 20,006 | 1.32 MB | 1,201,433 | — |
| 4 | Drop pointless `Sprintf` | 10,004 | 0.72 MB | 685,204 | — |
| — | **Total** | **6× fewer allocs** | **5× less** | **4.1× faster** | ✓ |

Every row is the *same output* — same `[]Event` for every input. We cut allocations **6×** and wall time **4×**, and the `ns/op` win tracks the `allocs/op` win because, on this path, allocation *was* the cost. The `B/op` and `allocs/op` columns are the honest signal; `ns/op` is the consequence the user actually feels.

---

## The caveat that makes it honest

**None of this would have been worth doing if `parseLine` ran 10 times a day.**

- The win came *only* because the function runs ~500k/sec and the service was measured CPU-bound on GC. The flame graph pointed here first; that's the entire justification.
- We cut in **profile order** (the two Splits, then the Sprintf), not in source order or by guessing. Each cut was re-measured before the next, so every claim is attributed.
- We **stopped** when the profile went flat, leaving the one intrinsic per-event allocation alone. Interning days would have traded real complexity for an allocation the numbers no longer flagged — that's premature optimization wearing a performance costume.
- And the cures were chosen for **lowest complexity that the profile justified**: `Cut` and presizing (near-zero readability cost) did almost all the work; we never needed a `sync.Pool` or an arena. The simplest fix the data demands, then quit.

If you take one thing from this file: the fast code at the end is *not* the lesson. The lesson is the loop — **measure, attribute, cut one thing, re-measure, stop** — and the humility to know it only mattered because the path was hot.

---

## Related Topics

- [`find-bug.md`](find-bug.md) — spot needless allocations (and the necessary one) in isolated snippets.
- [`tasks.md`](tasks.md) — build each individual fix (`Cut`, presize, reuse, escape) with its own benchmark.
- [`senior.md`](senior.md) — reading allocation profiles, escape analysis, and the "profile first, stop early" rule applied here.
- [Premature Optimization Traps](../01-premature-optimization-traps/optimize.md) — the discipline that says *don't* do any of this without the profile.
- [N+1 in Code](../02-n-plus-one-in-code/optimize.md) — the same measure-then-cut loop applied to repeated *work* rather than repeated *allocation*.
- The `profiling-techniques`, `memory-leak-detection`, and `big-o-analysis` skills.
