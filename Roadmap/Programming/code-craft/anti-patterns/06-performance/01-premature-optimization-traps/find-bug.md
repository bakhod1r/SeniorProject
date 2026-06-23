# Premature Optimization Traps — Find the Bug

> **Category:** [Performance Anti-Patterns](../README.md) → **Premature Optimization Traps** — *code twisted for speed that was never measured and rarely matters.*

---

This file is **critical-reading practice**. Each snippet is a plausible chunk of real code in Go, Java, or Python that has been "optimized." Your job is to read it like a reviewer and answer three questions:

> **Was this optimization measured or guessed? What did it cost? Should it stay or go?**

The skill here is *judgment*, not pattern-matching — because the answer isn't always "delete it." **One snippet is a justified optimization that should be KEPT**, and telling it apart from the premature ones is the whole point. A premature optimization and a justified one can look *identical*; the difference is the evidence around them. Read for the profile and the benchmark, not for the cleverness.

> **How to use this file:** for each snippet, write your verdict (measured/guessed, cost, keep/revert) *before* expanding. Watch for the one you should keep — if you delete it, you've learned the most important lesson here.

---

## Table of Contents

1. [The branchless even-counter](#snippet-1--the-branchless-even-counter)
2. [The StringBuilder reflex](#snippet-2--the-stringbuilder-reflex)
3. [The memoized formula](#snippet-3--the-memoized-formula)
4. [The object pool](#snippet-4--the-object-pool)
5. [The hand-inlined helper](#snippet-5--the-hand-inlined-helper)
6. [The tree for ten items](#snippet-6--the-tree-for-ten-items)
7. [The varint encoder](#snippet-7--the-varint-encoder)
8. [The "fast" config parser](#snippet-8--the-fast-config-parser)

---

## Snippet 1 — The branchless even-counter

```go
// Go — replaces a clear loop. Comment says "// faster, no branch".
func countEvens(xs []int) (c int) {
	for _, x := range xs {
		c += ^x & 1 // branchless: 1 when x is even, 0 when odd
	}
	return
}
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** No benchmark, no profile, and the comment ("faster, no branch") asserts a speed-up it never demonstrates. **Premature.**

**Cost:** the reader must *prove* `^x & 1 == 1 ⟺ x even` (and worry about negative/odd-magnitude ints) where `x%2 == 0` is self-evident. Readability and a verification burden, for nothing.

**Verdict: revert.** The modulo version benchmarks identically (the compiler emits the same cheap instruction, and a `range`-loop branch is trivially predicted). Write `if x%2 == 0 { c++ }`. If someone insists the bit trick is faster, the burden is on them to show `benchstat` with `-count=10` proving a real, significant win on a profiled hot path — and even then, box it.

</details>

---

## Snippet 2 — The StringBuilder reflex

```java
// Java — building a two-part log message.
String line(String user, int code) {
    return new StringBuilder()
        .append("user=").append(user)
        .append(" code=").append(code)
        .toString();
}
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed** (a reflex, really). No benchmark, and the optimization the author *thinks* they're doing — avoiding intermediate `String` objects — is one `javac` already performs for `+` concatenation of a fixed set of operands. **Premature.**

**Cost:** five method calls and a `StringBuilder` allocation in the source where `"user=" + user + " code=" + code` says the same thing in one readable line. Worse, the manual chain can actually be *slower* in tight cases because it defeats the compiler's `invokedynamic`/`StringConcatFactory` strategy on modern JDKs.

**Verdict: revert** to `"user=" + user + " code=" + code`. The compiler optimizes it; you get readability for free. (A `StringBuilder` *is* justified when concatenating in a **loop** with unknown iteration count — that's a different, measurable case.)

</details>

---

## Snippet 3 — The memoized formula

```python
# Python — a cache wrapped around a one-line computation.
_area_cache = {}

def circle_area(r):
    if r in _area_cache:
        return _area_cache[r]
    result = 3.14159265 * r * r
    _area_cache[r] = result
    return result
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** No profile shows `circle_area` is hot, and the "saved" work is a single multiply — cheaper than the dict lookup and insert that "cache" it. **Premature, and probably a net slowdown.**

**Cost:** (1) the cache lookup likely costs *more* than the computation it avoids; (2) it's an **unbounded memory leak** — every distinct `r` is retained forever; (3) it adds shared mutable state (a thread-safety hazard) and a thing to invalidate. A clarity *and* correctness cost for a negative speed-up.

**Verdict: revert** to a plain `return 3.14159265 * r * r`. Memoization is justified only when a profile shows the computation is *expensive* and *repeated with the same inputs* — neither is true here. Caching cheap work is a classic premature optimization that introduces a leak.

</details>

---

## Snippet 4 — The object pool

```go
// Go — a hand-rolled pool for Buffer objects, "to reduce GC pressure".
var bufPool = make(chan *bytes.Buffer, 100)

func getBuf() *bytes.Buffer {
	select {
	case b := <-bufPool:
		b.Reset()
		return b
	default:
		return new(bytes.Buffer)
	}
}

func putBuf(b *bytes.Buffer) { select { case bufPool <- b: default: } }

// used in a handler that runs a few hundred times a day:
func handle(r Request) string {
	b := getBuf()
	defer putBuf(b)
	b.WriteString(r.Body)
	return b.String()
}
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** "To reduce GC pressure" with no heap profile, on a handler that runs *a few hundred times a day*. The cold path can't generate meaningful GC pressure. **Premature.**

**Cost:** real bugs waiting to happen — a pooled buffer handed back while another goroutine still references it is a **use-after-return** data race; the channel-as-pool adds contention and complexity; and the win is zero because Go's allocator + escape analysis already handle a few-hundred-a-day `bytes.Buffer` for free. You traded correctness risk for nothing.

**Verdict: revert** to `var b bytes.Buffer` on the stack. If a profile *did* show buffer allocation dominating a genuinely hot path, the right tool is `sync.Pool` (designed for this, GC-aware) — but only with the heap profile proving it, and a benchmark guard. Hand-rolled pools on cold paths are pure liability.

</details>

---

## Snippet 5 — The hand-inlined helper

```java
// Java — isValid() was inlined by hand everywhere "because method calls are slow".
void process(List<Record> records) {
    for (Record r : records) {
        // was: if (isValid(r)) { ... }   — inlined by hand:
        if (r != null && r.id > 0 && r.name != null && !r.name.isEmpty()
                && r.timestamp > 0 && r.timestamp < System.currentTimeMillis()) {
            save(r);
        }
    }
}
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** "Because method calls are slow" is folklore; no benchmark. The JVM's C2 compiler **inlines hot methods automatically** after warm-up — hand-inlining gives the JIT *nothing* it wouldn't do itself. **Premature.**

**Cost:** the validation logic is now duplicated at every call site (so a rule change must be made in N places — a real bug magnet), the loop body is unreadable, and the named concept `isValid` is gone. You lost a name and gained duplication to "save" a call the JIT already eliminates.

**Verdict: revert** — extract `isValid(Record)` back out and call it. Verify with `-XX:+PrintInlining` that C2 inlines it under load (it will, if it's hot). The clear, named, single-source-of-truth version is also the fast one.

</details>

---

## Snippet 6 — The tree for ten items

```python
# Python — a balanced BST (via `sortedcontainers`) to hold a user's active filters.
from sortedcontainers import SortedList

class FilterSet:
    def __init__(self):
        self._filters = SortedList(key=lambda f: f.priority)  # "O(log n) inserts!"

    def add(self, f):       self._filters.add(f)
    def highest(self):      return self._filters[-1]
    # a user has at most ~8 active filters, ever.
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** The "O(log n) inserts!" comment optimizes the asymptotics of a collection that is **provably tiny** (~8 items). At n=8 the asymptotics never engage; a plain list with `max()` is faster *and* simpler because there's no tree overhead and no dependency. **Premature.**

**Cost:** an external dependency, more code, and a structure whose entire value (logarithmic scaling) is irrelevant at this size. The big-O that looks impressive is meaningless when n is bounded by a small constant — see the `big-o-analysis` skill on constant factors dominating at small n.

**Verdict: revert** to a plain `list`; `highest()` is `max(self._filters, key=lambda f: f.priority)`. Linear over 8 items is instant. Choosing a complex structure for tiny, bounded n is a textbook premature optimization (and mild over-engineering).

</details>

---

## Snippet 7 — The varint encoder

```go
// Go — manual byte-packing in a protocol encoder. Has a comment block.
// appendUvarint: profiled as 71% of CPU in BenchmarkEncode (flame graph attached
// in PR #842). Manual loop is 1.6x faster than binary.PutUvarint here because it
// avoids the bounds-check on a fresh slice. Verified equal to the stdlib by
// FuzzUvarintRoundtrip. Do not "simplify" without re-running BenchmarkEncode.
func appendUvarint(buf []byte, x uint64) []byte {
	for x >= 0x80 {
		buf = append(buf, byte(x)|0x80)
		x >>= 7
	}
	return append(buf, byte(x))
}
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer — THIS IS THE ONE TO KEEP</summary>

**Measured — and justified. KEEP IT.** This looks just as "clever" as Snippet 1's bit trick, but every justification condition is satisfied *in the code*:

1. **Profiled hot:** "71% of CPU in BenchmarkEncode, flame graph in PR #842." It's the critical 3% Knuth says to seize.
2. **Benchmarked win:** "1.6× faster" — a real, significant, stated number, not a vibe.
3. **The win matters:** it's the dominant frame in the encoder's hot path.
4. **Guarded + verified:** a fuzz test (`FuzzUvarintRoundtrip`) is the correctness oracle proving it matches the stdlib, and the comment names the benchmark that guards against regression — "do not simplify without re-running BenchmarkEncode."

**Verdict: keep it, untouched.** This is *exactly* what a justified micro-optimization looks like — and the lesson of this file is that **the cleverness is not what makes it premature or justified; the evidence is.** Strip away the profile, the benchmark, the fuzz oracle, and the why-comment, and the identical code becomes a premature optimization. The discipline around the code is the whole difference. If you reverted this, re-read [`senior.md`](senior.md) on boxing the justified hot path.

</details>

---

## Snippet 8 — The "fast" config parser

```python
# Python — config loaded once at startup, "optimized" with manual byte scanning.
def parse_config(raw: bytes):
    # hand-rolled scanner instead of `tomllib.loads` / `json.loads` — "avoids overhead"
    result, i, n = {}, 0, len(raw)
    while i < n:
        # 40 lines of manual key/value byte parsing, escape handling, etc.
        ...
    return result
```

> Measured or guessed? What did it cost? Keep or revert?

<details>
<summary>Answer</summary>

**Guessed.** "Avoids overhead" with no benchmark — and the code is **config parsing, which runs once at startup.** The coldest path imaginable. Even if the hand-scanner were 10× faster, it would shave microseconds off a once-per-process operation: a ~0% whole-program win. **Premature.**

**Cost:** 40 lines of hand-rolled parsing (with bespoke escape handling — a *correctness* minefield the stdlib already solved) replacing one library call. Maximum bug surface, maximum maintenance, on the one path where speed is irrelevant.

**Verdict: revert** to `tomllib.loads(raw)` / `json.loads(raw)`. The startup cost is paid once and nobody notices it; the library is correct and clear. Optimizing the cold startup path is the purest form of this anti-pattern — effort spent precisely where the program spends no time.

</details>

---

## The meta-lesson

Lay the eight snippets side by side and the pattern is unmistakable:

| # | Clever? | Profiled? | Benchmarked? | Hot path? | Verdict |
|---|---|---|---|---|---|
| 1 branchless count | yes | no | no | no | **revert** |
| 2 StringBuilder | yes | no | no | no | **revert** |
| 3 memoized formula | yes | no | no | no | **revert (+ leak)** |
| 4 object pool | yes | no | no | no (daily) | **revert (+ race)** |
| 5 hand-inlined | yes | no | no | no | **revert (+ dup)** |
| 6 tree for n=8 | yes | no | no | no (tiny n) | **revert** |
| **7 varint encoder** | **yes** | **YES** | **YES** | **YES (71%)** | **KEEP** |
| 8 config parser | yes | no | no | no (startup) | **revert** |

Every snippet is "clever." Only one is justified — and what sets #7 apart is **not** the code's cleverness but the **profile, benchmark, oracle, and comment** around it. That is the entire discipline: *cleverness is evidence-neutral; the measurement decides.* When you review a performance change, don't ask "is this clever?" — ask "where's the profile and the benchmark?" If they're absent, it's premature until proven otherwise.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognize → measure → judge → the hard line.
- [`tasks.md`](tasks.md) — the *fixing* counterpart: profile, revert, and guard for real.
- [`interview.md`](interview.md) — the Q&A on measured-vs-guessed and justified micro-opts.
- [N+1 in Code → find-bug.md](../02-n-plus-one-in-code/find-bug.md) · [Unnecessary Allocation → find-bug.md](../03-unnecessary-allocation/find-bug.md) · [Wrong Data Structure → find-bug.md](../04-wrong-data-structure/find-bug.md) — the *real* hotspots, vs the imaginary ones here.
- [Over-Engineering → senior.md](../../01-development/03-over-engineering/senior.md) — Snippets 4 and 6 are also speculative over-engineering.
- The `profiling-techniques` and `big-o-analysis` skills — the evidence that turns Snippet 7 from premature into justified.
