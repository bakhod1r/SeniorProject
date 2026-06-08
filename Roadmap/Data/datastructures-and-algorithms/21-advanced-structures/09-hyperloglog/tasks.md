# HyperLogLog — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Validate every estimate against an **exact set** on small/medium inputs, and confirm the relative error tracks `1.04/√m`.

---

## Beginner Tasks

**Task 1:** Implement the `add` step: given a 64-bit hash `x` and precision `p`, return `(registerIndex, rank)` where `registerIndex = x >> (64 - p)` and `rank = 1 + leadingZeros(rest)`. Use a **sentinel bit** so the rank is well defined when the suffix is all zeros.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func split(x uint64, p uint) (uint64, uint8) {
	// implement here
	return 0, 0
}

func main() {
	idx, r := split(0x00FF<<48, 4)
	fmt.Println(idx, r)
	_ = bits.LeadingZeros64
}
```

#### Java

```java
public class Task1 {
    static long[] split(long x, int p) {
        // implement here: return {registerIndex, rank}
        return new long[]{0, 0};
    }

    public static void main(String[] args) {
        long[] r = split(0x00FFL << 48, 4);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

#### Python

```python
def split(x, p):
    # implement here: return (register_index, rank)
    return 0, 0


if __name__ == "__main__":
    print(split(0x00FF << 48, 4))
```

- **Constraints:** O(1); handle all-zero suffix via a sentinel.
- **Expected Output:** a valid `(index, rank)` with `rank ≥ 1`.
- **Evaluation:** correctness of bit extraction, sentinel handling.

**Task 2:** Implement a full `HLL` class/struct with `add(item)` and `count()` for a chosen `p` (use FNV-1a 64-bit hashing). Include the **linear-counting** correction in the low range. Verify the estimate for 50,000 distinct items at `p=12` is within ~3%.

- Provide starter code in all 3 languages.
- Constraints: `count` is one O(m) pass; registers store the **max** rank.

**Task 3:** Show **idempotence**: add the same 1,000 items ten times each and confirm `count()` is unchanged versus adding them once. Print both estimates.

- Constraints: duplicates must not change any register.

**Task 4:** Build an HLL and an **exact set** in parallel over 100,000 distinct strings. Print the exact count, the HLL estimate, and the absolute relative error. Confirm it is below `2 × 1.04/√m`.

- Constraints: same stream feeds both; report the error as a percentage.

**Task 5:** Sweep `p ∈ {8, 10, 12, 14}` on the same 100,000-distinct stream. Print, for each `p`, the estimate, the empirical error, and the predicted `1.04/√m`. Confirm error shrinks ~`1/√m`.

- Constraints: reuse one `add`/`count` implementation; only `p` changes.

---

## Intermediate Tasks

**Task 6:** Implement `merge(other)` (register-wise max) for two HLLs with the same `p`. Feed two **overlapping** streams (e.g. ids `[0,70k)` and `[50k,100k)`), merge, and confirm `count()` estimates the **union** (~100,000), not the sum (120,000).

- Provide starter code in all 3 languages.
- Constraints: enforce equal `p`; do not mutate `other`.

**Task 7:** Add the **large-range correction** path for a 32-bit-hash variant: when `E > (1/30)·2^32`, return `-2^32·ln(1 - E/2^32)`. Demonstrate the difference versus omitting it for a high-cardinality stream. Then show that switching to a 64-bit hash makes the correction unnecessary.

- Constraints: keep both code paths and compare estimates.

**Task 8:** Implement a **sparse representation** that stores only nonzero registers as a map `index → rank`, and **promotes to dense** once the sparse size would exceed the dense byte budget (`m·6/8`). Confirm a 5-item key stays sparse (a few bytes) and a 1M-item key is dense (`m` registers).

- Constraints: `count()` works in both modes (linear counting while sparse).

**Task 9:** Estimate an **intersection** two ways for two streams: (a) HLL inclusion-exclusion `|A|+|B|-|A∪B|`, and (b) the exact intersection of two sets. Run it for a **large** overlap (80%) and a **small** overlap (1%), and report how much worse the HLL estimate is in the small-overlap case (demonstrate the error amplification).

- Constraints: print both estimates and the exact value for each overlap level.

**Task 10:** Implement a **time roll-up**: build one HLL per "hour" over a stream where some users appear in multiple hours, then merge all hourly sketches into a "day" sketch. Confirm the day count equals the distinct users across all hours (not the sum of hourly counts).

- Constraints: a user active in 3 hours must be counted once in the day total.

---

## Advanced Tasks

**Task 11:** Implement **register packing**: store the `m` ranks in a packed **6-bit** array (since ranks ≤ 64) instead of one byte each. Verify `add`/`count` still work and memory drops to `m·6/8` bytes (~12 KB for `p=14` vs 16 KB unpacked).

- Provide starter code in all 3 languages.
- Constraints: correct bit-level get/set of 6-bit registers spanning byte boundaries.

**Task 12:** Implement **precision folding**: given a `p'`-precision register array, produce the equivalent `p`-precision array (`p < p'`) by taking the rank-adjusted max over each group of `2^{p'-p}` source registers sharing the same top `p` index bits. Verify the folded sketch's count is close to the original's.

- Constraints: account for the `p'-p` index bits that become suffix bits when adjusting ranks.

**Task 13:** Implement an **empirical bias correction** lite: by simulation, measure the raw HLL estimate's bias at cardinalities `{1m, 2m, 3m, 5m}` (averaged over many runs), store the `(rawEstimate, bias)` points, and at query time subtract an **interpolated** bias. Show the corrected estimate beats the uncorrected one in the `[m, 5m]` range.

- Constraints: interpolate between the nearest stored points.

**Task 14:** Build a **streaming benchmark**: feed 10 million random items and measure `add` throughput and the final estimate's error for `p ∈ {12, 14, 16}`. Report items/sec and memory. Confirm `add` throughput is roughly constant across `p` (it is O(1)).

- Constraints: time only the `add` loop; report MB of registers per `p`.

**Task 15:** Implement **serialize / deserialize** for an HLL sketch with a header carrying `p` and a `hashVersion`. On `merge`, **reject** sketches whose `p` or `hashVersion` differ. Round-trip a sketch through bytes and confirm the deserialized sketch's count matches the original.

- Constraints: merging incompatible sketches must raise/return an error, not produce a silent wrong answer.

---

## Benchmark Task

> Compare `add` throughput and estimate error across all 3 languages for `p = 14` on 1,000,000 distinct items.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"time"
)

func main() {
	h := New(14) // your HLL
	start := time.Now()
	for i := 0; i < 1_000_000; i++ {
		h.Add(fmt.Sprintf("item-%d", i))
	}
	elapsed := time.Since(start)
	est := h.Count()
	fmt.Printf("add: %.0f items/sec  est=%.0f err=%.2f%%\n",
		1_000_000/elapsed.Seconds(), est, math.Abs(est-1_000_000)/1_000_000*100)
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        HLL h = new HLL(14); // your HLL
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) h.add("item-" + i);
        double secs = (System.nanoTime() - start) / 1e9;
        double est = h.count();
        System.out.printf("add: %.0f items/sec  est=%.0f err=%.2f%%%n",
                1_000_000 / secs, est, Math.abs(est - 1_000_000) / 1_000_000 * 100);
    }
}
```

#### Python

```python
import time, math

h = HLL(14)  # your HLL
start = time.perf_counter()
for i in range(1_000_000):
    h.add(f"item-{i}")
secs = time.perf_counter() - start
est = h.count()
print(f"add: {1_000_000/secs:.0f} items/sec  est={est:.0f} "
      f"err={abs(est-1_000_000)/1_000_000*100:.2f}%")
```

> Expected: ~0.8% error at `p=14` regardless of language; memory stays ~12 KB (dense) independent of the 1,000,000 items added.
