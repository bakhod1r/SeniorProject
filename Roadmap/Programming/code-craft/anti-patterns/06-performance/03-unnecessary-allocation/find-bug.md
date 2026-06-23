# Unnecessary Allocation — Find the Bug

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *throwaway objects, boxing, and copies churned in a hot path.*

---

This file is **critical-reading practice**. Each snippet is a plausible chunk of real Go, Java, or Python with an allocation question hiding in it. Read it like a reviewer and answer three things:

> **Where does it allocate needlessly? Is that allocation in a hot path? What's the behavior-preserving fix — and does its `allocs/op` actually drop?**

The skill is *judgment*, not pattern-matching — because the answer isn't always "it allocates, remove it." **One snippet allocates exactly as much as it must** (the allocation is necessary or harmless), and telling it apart from the wasteful ones is the whole point. A needless allocation and a required one can look identical; the difference is whether you can remove it *without changing behavior*. Read for the lifetime and the loop, not just for `new`.

> **How to use this file:** for each snippet, write your verdict (where it allocates, hot-or-not, the fix) *before* expanding. Watch for the trap — if you "fix" the one that's already correct, you've introduced a bug.

---

## Table of Contents

1. [Snippet 1 — The CSV builder](#snippet-1--the-csv-builder)
2. [Snippet 2 — The lookup map](#snippet-2--the-lookup-map)
3. [Snippet 3 — The defensive copy](#snippet-3--the-defensive-copy)  ← read carefully
4. [Snippet 4 — The growing result](#snippet-4--the-growing-result)
5. [Snippet 5 — The stream that re-collects](#snippet-5--the-stream-that-re-collects)
6. [Snippet 6 — The interface logger](#snippet-6--the-interface-logger)
7. [Snippet 7 — The per-iteration regexp](#snippet-7--the-per-iteration-regexp)
8. [Scorecard](#scorecard)
9. [Related Topics](#related-topics)

---

## Snippet 1 — The CSV builder

```go
// Builds a CSV line from fields. Called once per row, millions of rows.
func csvLine(fields []string) string {
	line := ""
	for i, f := range fields {
		if i > 0 {
			line = line + ","
		}
		line = line + f
	}
	return line + "\n"
}
```

<details>
<summary>Verdict & fix</summary>

**Needless allocation, hot path.** Classic loop concatenation: each `line = line + …` allocates a new string and copies the growing prefix — **O(n²)** in field count and ~2× the field count in allocations, per row, millions of rows. The allocation rate here dominates real CPU.

```go
// Fixed — one builder, presized.
func csvLine(fields []string) string {
	n := len(fields) // commas + newline
	for _, f := range fields {
		n += len(f)
	}
	var b strings.Builder
	b.Grow(n)
	for i, f := range fields {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(f)
	}
	b.WriteByte('\n')
	return b.String()
}
```

`allocs/op` goes from ~`2·len(fields)` to **1**. Output identical. (Go's `encoding/csv` does this for you; reach for it before hand-rolling.)

</details>

---

## Snippet 2 — The lookup map

```java
// Counts word frequencies. Called per document in a large corpus.
Map<String, Integer> wordCounts(List<String> words) {
    Map<String, Integer> counts = new HashMap<>();
    for (String w : words) {
        Integer c = counts.get(w);
        counts.put(w, c == null ? 1 : c + 1);
    }
    return counts;
}
```

<details>
<summary>Verdict & fix</summary>

**Two allocation problems, hot path.** (1) The `HashMap` starts un-presized and **rehashes** repeatedly as it fills (reallocating the table). (2) Every `c + 1` *autoboxes* a fresh `Integer` (and the cache only covers −128..127, so most counts box). On a large corpus this is real GC pressure.

```java
Map<String, Integer> wordCounts(List<String> words) {
    // presize: avoids rehash storm for up-to-`words.size()` distinct keys
    Map<String, Integer> counts = new HashMap<>((int) (words.size() / 0.75f) + 1);
    for (String w : words) {
        counts.merge(w, 1, Integer::sum); // still boxes, but clearer
    }
    return counts;
}
```

Presizing removes the rehashes. The boxing is intrinsic to `Map<String,Integer>`; to kill it entirely on a *proven* hotspot, use a primitive-valued map (`Object2IntOpenHashMap` from fastutil / Eclipse Collections), which stores `int` values unboxed. Don't reach for the third-party map on a cold path — `merge` + presizing is the right default.

</details>

---

## Snippet 3 — The defensive copy

```go
// Returns the internal config's allowed hosts to a caller.
type Config struct {
	allowedHosts []string
}

func (c *Config) AllowedHosts() []string {
	out := make([]string, len(c.allowedHosts))
	copy(out, c.allowedHosts) // a copy on every call
	return out
}
```

<details>
<summary>Verdict — this is the TRAP</summary>

**The allocation is NOT needless — keep it.** This is a **defensive copy**, and it's doing essential work: it prevents the caller from mutating `Config`'s internal slice. If you "optimized" it to `return c.allowedHosts`, you'd hand out a reference to internal state — any caller doing `hosts[0] = "evil.com"` or `append(hosts, …)` (which can write into the shared backing array) would silently corrupt the config. That's a **correctness/security bug**, not a speedup.

How to tell it apart from a *needless* copy: ask "does removing the copy change observable behavior under a hostile/careless caller?" Here, **yes** — so the allocation is buying encapsulation. A needless copy is one where the source is already immutable, owned, or never retained by anyone.

**If and only if** profiling proves this exact call is a hotspot, the *correct* optimizations preserve the guarantee: return an immutable view (a read-only wrapper type), return a defensive copy but document callers must not mutate, or have callers ask the question they actually need (`IsAllowed(host)`) instead of taking the whole slice. The wrong move is deleting the copy. **Verdict: the allocation stays.**

</details>

---

## Snippet 4 — The growing result

```go
// Filters records; size of result is bounded by len(in).
func keepValid(in []Record) []Record {
	var out []Record // nil slice, grows by reallocation
	for _, r := range in {
		if r.Valid {
			out = append(out, r)
		}
	}
	return out
}
```

<details>
<summary>Verdict & fix</summary>

**Needless reallocation, hot path.** Starting from `nil`, the slice reallocates ~log₂(k) times as it grows to k valid records. The final size is *bounded* by `len(in)`, which is known up front — so presize.

```go
func keepValid(in []Record) []Record {
	out := make([]Record, 0, len(in)) // cap = upper bound; no growth reallocs
	for _, r := range in {
		if r.Valid {
			out = append(out, r)
		}
	}
	return out
}
```

`allocs/op` drops from log-many to **1**. **Subtlety:** presizing to `len(in)` may over-allocate if few records are valid (you reserve capacity for all, keep only some). That's usually a good trade — a little extra capacity vs. a chain of reallocations and copies. If valid records are a tiny fraction *and* memory is tight, presize to an *estimate* instead. Either way, `make([]Record, 0, n)` not `make([]Record, n)` (the latter prefills n zero-Records).

</details>

---

## Snippet 5 — The stream that re-collects

```java
// Top customer names by spend. Called on each dashboard refresh.
List<String> topNames(List<Customer> customers) {
    List<Customer> active = customers.stream()
        .filter(Customer::isActive)
        .collect(Collectors.toList());           // materialize 1
    List<Customer> sorted = active.stream()
        .sorted(Comparator.comparingDouble(Customer::spend).reversed())
        .collect(Collectors.toList());           // materialize 2
    return sorted.stream()
        .limit(10)
        .map(Customer::name)
        .collect(Collectors.toList());           // materialize 3
}
```

<details>
<summary>Verdict & fix</summary>

**Needless intermediates, warm path.** Three `.collect(toList())` calls materialize three lists where one lazy pipeline suffices. `filter`, `sorted`, `map`, and `limit` are all lazy intermediate operations — breaking the chain to re-stream forces a full list at each break.

```java
List<String> topNames(List<Customer> customers) {
    return customers.stream()
        .filter(Customer::isActive)
        .sorted(Comparator.comparingDouble(Customer::spend).reversed())
        .limit(10)
        .map(Customer::name)
        .collect(Collectors.toList());           // single materialization
}
```

Two intermediate lists eliminated; one terminal allocation remains (and `limit(10)` means the final list is tiny). **One genuine subtlety:** `sorted` is a *stateful* intermediate op — it must buffer all elements to sort, so it allocates internally regardless. You can't make sorting allocation-free, but you've removed the two *avoidable* `collect`s around it. Behavior identical.

</details>

---

## Snippet 6 — The interface logger

```go
// Debug logging inside a hot request handler.
func handle(req *Request) {
	for _, item := range req.Items {
		log.Printf("processing item %d for user %s", item.ID, req.UserID)
		process(item)
	}
}
```

<details>
<summary>Verdict & fix</summary>

**Needless allocation, hot path — but the fix is to *not log*, not to micro-optimize the log.** `log.Printf` formats via `...interface{}`, which **boxes** every argument (`item.ID` the int, `req.UserID` the string-in-interface) onto the heap, *and* allocates the formatted message — on every item of every request, even though this is debug noise you don't read in production.

```go
// Fixed — gate the log so it costs nothing when disabled.
func handle(req *Request) {
	for _, item := range req.Items {
		if log.Enabled(LevelDebug) { // no formatting / boxing unless enabled
			log.Printf("processing item %d for user %s", item.ID, req.UserID)
		}
		process(item)
	}
}
```

The real bug is *logging in a hot loop at all*. Level-gating means the `Printf` (and its boxing) never runs in production where debug is off. If you genuinely need the log, a structured logger that takes typed fields (`slog.Int`, `zap.Int`) avoids the `interface{}` boxing path. **Don't** "fix" this by hand-building the string with a `strings.Builder` every iteration — you'd still pay it unconditionally; gating is the win.

</details>

---

## Snippet 7 — The per-iteration regexp

```go
// Validates each line of a large file.
func countMatches(lines []string) int {
	n := 0
	for _, line := range lines {
		re := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`) // compiled every line!
		if re.MatchString(line) {
			n++
		}
	}
	return n
}
```

<details>
<summary>Verdict & fix</summary>

**Needless allocation (and CPU), hot path — the worst kind.** `regexp.MustCompile` parses and builds the entire regex automaton *every iteration*, allocating a large `*Regexp` object each time and throwing it away. The pattern is a constant; compiling it per line is pure waste — this is both an allocation and a [hoist-the-work](../02-n-plus-one-in-code/junior.md) problem.

```go
// Fixed — compile once, hoisted out of the loop (package-level is idiomatic).
var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)

func countMatches(lines []string) int {
	n := 0
	for _, line := range lines {
		if dateRe.MatchString(line) {
			n++
		}
	}
	return n
}
```

The compiled `*Regexp` allocation goes from *once per line* to **once per program**. `*Regexp` is safe for concurrent use, so package-level is correct. This single hoist is often a 10–100× speedup on this pattern — the allocation was the smaller half of the cost. Output identical.

</details>

---

## Scorecard

| # | Snippet | Needless? | Form | The point |
|---|---|---|---|---|
| 1 | CSV builder | **Yes** | String building | Loop concat → builder; O(n²) → O(n) |
| 2 | Lookup map | **Yes** | Boxing + rehash | Presize the map; primitive map only if hot |
| 3 | Defensive copy | **NO — keep it** | (necessary) | Removing it is a correctness/security bug |
| 4 | Growing result | **Yes** | Un-presized growth | Presize to the known upper bound |
| 5 | Re-collecting stream | **Yes** | Intermediate collections | One lazy pipeline; `sorted` must buffer |
| 6 | Interface logger | **Yes** | Boxing (`interface{}`) | Gate the log; don't log in a hot loop |
| 7 | Per-iteration regexp | **Yes** | Re-create in loop | Hoist/compile once |

**If you flagged #3 as a bug, re-read it.** A defensive copy *looks* like a wasteful allocation but is buying encapsulation; deleting it leaks mutable internal state. The lesson of this whole file: an allocation is only "unnecessary" if you can remove it **without changing behavior** — and the only way to be sure of *both* (it's removable *and* it's worth removing) is to check the lifetime and then check the profile.

---

## Related Topics

- [`optimize.md`](optimize.md) — fix a full allocation-heavy hot path with before/after `allocs/op`.
- [`tasks.md`](tasks.md) — guided exercises that *build* these fixes with benchmarks.
- [N+1 in Code](../02-n-plus-one-in-code/find-bug.md) — the per-iteration regexp (#7) and logger (#6) overlap with repeated *work* in a loop.
- [Premature Optimization Traps](../01-premature-optimization-traps/find-bug.md) — the sibling "spot the unjustified optimization," including a keeper to recognize.
- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) — recognition → forms → hot-path judgment.
- The `profiling-techniques` and `memory-leak-detection` skills.
