# Amortized Analysis — Practice Tasks

> All **coding** tasks must be solved in **Go**, **Java**, and **Python**. The **proof/derivation** tasks have no code: write a clean mathematical argument (aggregate, accounting, or potential method) — model derivations are provided so you can grade yourself.

Amortized analysis is half implementation, half proof. You implement a sequence of operations, *instrument* it to count real work, and then prove a per-operation bound that holds *on average over the sequence* even when individual operations are expensive. Work the tasks in order: the proofs build directly on the structures you implement.

See also: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · and the sibling [time-vs-space tasks](../01-time-vs-space-complexity/tasks.md).

A note on terminology used throughout:
- **Aggregate method:** bound the total cost `T(n)` of any sequence of `n` operations, then divide: amortized cost `= T(n)/n`.
- **Accounting (banker's) method:** assign each operation an *amortized charge*; cheap operations overpay and bank credit, expensive ones spend it. Invariant: bank balance stays `≥ 0`.
- **Potential (physicist's) method:** define a potential function `Φ` mapping each state to a real number with `Φ(D₀) = 0` and `Φ(Dᵢ) ≥ 0`. Amortized cost of operation `i` is `ĉᵢ = cᵢ + Φ(Dᵢ) − Φ(Dᵢ₋₁)`. Then `Σ ĉᵢ = Σ cᵢ + Φ(Dₙ) − Φ(D₀) ≥ Σ cᵢ`, so the amortized total upper-bounds the real total.

---

## Beginner Tasks

**Task 1 (coding):** Implement a growable array using the *doubling* strategy. Start with capacity 1; when full, allocate a new backing array of twice the capacity and copy elements over. Instrument it: count the *total number of element copies* across `n` pushes, and report the average copies-per-push. Empirically show this average stays below a small constant (it tends to `< 2`), demonstrating amortized `O(1)`.

`Difficulty: Easy`

#### Go

```go
package main

import "fmt"

type GrowArray struct {
	data  []int
	size  int
	copies int // total element copies performed by all grows
}

func NewGrowArray() *GrowArray {
	return &GrowArray{data: make([]int, 1), size: 0}
}

func (g *GrowArray) Push(x int) {
	if g.size == len(g.data) {
		newData := make([]int, 2*len(g.data))
		for i := 0; i < g.size; i++ {
			newData[i] = g.data[i]
			g.copies++
		}
		g.data = newData
	}
	g.data[g.size] = x
	g.size++
}

func main() {
	for _, n := range []int{1, 16, 1000, 1 << 20} {
		g := NewGrowArray()
		for i := 0; i < n; i++ {
			g.Push(i)
		}
		fmt.Printf("n=%8d copies=%8d copies/push=%.3f\n",
			n, g.copies, float64(g.copies)/float64(n))
	}
}
```

#### Java

```java
public class Task1 {
    static class GrowArray {
        int[] data = new int[1];
        int size = 0;
        long copies = 0;

        void push(int x) {
            if (size == data.length) {
                int[] nd = new int[2 * data.length];
                for (int i = 0; i < size; i++) { nd[i] = data[i]; copies++; }
                data = nd;
            }
            data[size++] = x;
        }
    }

    public static void main(String[] args) {
        for (int n : new int[]{1, 16, 1000, 1 << 20}) {
            GrowArray g = new GrowArray();
            for (int i = 0; i < n; i++) g.push(i);
            System.out.printf("n=%8d copies=%8d copies/push=%.3f%n",
                n, g.copies, (double) g.copies / n);
        }
    }
}
```

#### Python

```python
class GrowArray:
    def __init__(self):
        self.data = [None]        # capacity 1
        self.size = 0
        self.copies = 0

    def push(self, x):
        if self.size == len(self.data):
            new = [None] * (2 * len(self.data))
            for i in range(self.size):
                new[i] = self.data[i]
                self.copies += 1
            self.data = new
        self.data[self.size] = x
        self.size += 1


for n in (1, 16, 1000, 1 << 20):
    g = GrowArray()
    for i in range(n):
        g.push(i)
    print(f"n={n:8d} copies={g.copies:8d} copies/push={g.copies / n:.3f}")
```

- **Constraints:** Do not use the language's built-in dynamic array growth (slices' implicit append, `ArrayList`, list `append`) for the backing store — manage the capacity yourself.
- **Hint:** Total copies for `n = 2^k` pushes is `1 + 2 + 4 + ... + 2^(k-1) = 2^k − 1 < n`. So copies/push `< 1`, and total work (copies + writes) `< 2n`.
- **Expected Output:** copies/push converges to a value `< 1`; including the `n` direct writes, work/push stays `< 2`.
- **Evaluation:** Correct doubling, correct copy count, average bounded by a constant independent of `n`.

---

**Task 2 (coding):** Implement a `k`-bit binary counter supporting `increment()`. Count the *total number of bit flips* performed over `n` increments starting from zero. Report flips-per-increment and show it approaches `2`.

`Difficulty: Easy`

#### Go

```go
package main

import "fmt"

type Counter struct {
	bits  []int
	flips int
}

func NewCounter(k int) *Counter { return &Counter{bits: make([]int, k)} }

func (c *Counter) Increment() {
	i := 0
	for i < len(c.bits) && c.bits[i] == 1 {
		c.bits[i] = 0 // flip 1 -> 0 (carry)
		c.flips++
		i++
	}
	if i < len(c.bits) {
		c.bits[i] = 1 // flip 0 -> 1
		c.flips++
	}
}

func main() {
	for _, n := range []int{1, 16, 1000, 100000} {
		c := NewCounter(64)
		for i := 0; i < n; i++ {
			c.Increment()
		}
		fmt.Printf("n=%7d flips=%7d flips/incr=%.3f\n",
			n, c.flips, float64(c.flips)/float64(n))
	}
}
```

#### Java

```java
public class Task2 {
    static class Counter {
        int[] bits;
        long flips = 0;
        Counter(int k) { bits = new int[k]; }

        void increment() {
            int i = 0;
            while (i < bits.length && bits[i] == 1) { bits[i] = 0; flips++; i++; }
            if (i < bits.length) { bits[i] = 1; flips++; }
        }
    }

    public static void main(String[] args) {
        for (int n : new int[]{1, 16, 1000, 100000}) {
            Counter c = new Counter(64);
            for (int i = 0; i < n; i++) c.increment();
            System.out.printf("n=%7d flips=%7d flips/incr=%.3f%n",
                n, c.flips, (double) c.flips / n);
        }
    }
}
```

#### Python

```python
class Counter:
    def __init__(self, k):
        self.bits = [0] * k
        self.flips = 0

    def increment(self):
        i = 0
        while i < len(self.bits) and self.bits[i] == 1:
            self.bits[i] = 0          # carry
            self.flips += 1
            i += 1
        if i < len(self.bits):
            self.bits[i] = 1
            self.flips += 1


for n in (1, 16, 1000, 100000):
    c = Counter(64)
    for _ in range(n):
        c.increment()
    print(f"n={n:7d} flips={c.flips:7d} flips/incr={c.flips / n:.3f}")
```

- **Constraints:** Use enough bits (`k = 64`) that the counter never overflows for the chosen `n`.
- **Hint:** Bit 0 flips every increment, bit 1 flips every 2nd, bit `i` flips every `2^i`-th. Total flips `= Σ_{i≥0} ⌊n/2^i⌋ < n·Σ 1/2^i = 2n`.
- **Expected Output:** flips/incr converges toward `2` from below.
- **Evaluation:** Correct increment with carry propagation; total flips `< 2n`.

---

**Task 3 (coding):** Implement a *multipop stack*: a stack supporting `push(x)`, `pop()`, and `multipop(k)` which pops `min(k, size)` elements. Instrument the *total element-touches* (one per individual pop, including those inside multipop) over a sequence of `n` operations, and confirm it never exceeds the number of pushes — proving any sequence of `n` operations costs `O(n)`, i.e. `O(1)` amortized per operation.

`Difficulty: Easy`

#### Go

```go
package main

import "fmt"

type MultiStack struct {
	data   []int
	pops   int // total individual element pops
}

func (s *MultiStack) Push(x int) { s.data = append(s.data, x) }

func (s *MultiStack) Pop() (int, bool) {
	if len(s.data) == 0 {
		return 0, false
	}
	x := s.data[len(s.data)-1]
	s.data = s.data[:len(s.data)-1]
	s.pops++
	return x, true
}

func (s *MultiStack) Multipop(k int) {
	for i := 0; i < k; i++ {
		if _, ok := s.Pop(); !ok {
			break
		}
	}
}

func main() {
	s := &MultiStack{}
	pushes := 0
	// Interleaved sequence: push bursts then multipops.
	for round := 0; round < 1000; round++ {
		for i := 0; i < 5; i++ {
			s.Push(i)
			pushes++
		}
		s.Multipop(3)
	}
	fmt.Printf("pushes=%d total pops=%d (pops <= pushes: %v)\n",
		pushes, s.pops, s.pops <= pushes)
}
```

#### Java

```java
import java.util.ArrayDeque;

public class Task3 {
    static class MultiStack {
        ArrayDeque<Integer> data = new ArrayDeque<>();
        long pops = 0;

        void push(int x) { data.push(x); }

        boolean pop() {
            if (data.isEmpty()) return false;
            data.pop(); pops++; return true;
        }

        void multipop(int k) {
            for (int i = 0; i < k && pop(); i++) { }
        }
    }

    public static void main(String[] args) {
        MultiStack s = new MultiStack();
        long pushes = 0;
        for (int round = 0; round < 1000; round++) {
            for (int i = 0; i < 5; i++) { s.push(i); pushes++; }
            s.multipop(3);
        }
        System.out.printf("pushes=%d total pops=%d (pops <= pushes: %b)%n",
            pushes, s.pops, s.pops <= pushes);
    }
}
```

#### Python

```python
class MultiStack:
    def __init__(self):
        self.data = []
        self.pops = 0

    def push(self, x):
        self.data.append(x)

    def pop(self):
        if not self.data:
            return False
        self.data.pop()
        self.pops += 1
        return True

    def multipop(self, k):
        for _ in range(k):
            if not self.pop():
                break


s = MultiStack()
pushes = 0
for _ in range(1000):
    for i in range(5):
        s.push(i)
        pushes += 1
    s.multipop(3)
print(f"pushes={pushes} total pops={s.pops} (pops <= pushes: {s.pops <= pushes})")
```

- **Constraints:** `multipop(k)` on an empty stack is a no-op; never pop below empty.
- **Hint:** Every element is popped at most once, and only after being pushed. So total pops `≤` total pushes `≤ n`. A single `multipop` can be `O(size)`, but it can only spend pushes that already happened.
- **Expected Output:** `pops <= pushes` is always `true`; total work is `O(n)`.
- **Evaluation:** Correct multipop semantics; the instrumented bound holds.

---

## Intermediate Tasks

**Task 4 (coding):** Implement a dynamic array with **grow and shrink**. Double capacity on overflow; halve capacity when, after a pop, `size ≤ capacity/4`. (Crucially, shrink at `1/4`, *not* `1/2`.) Run an adversarial sequence that repeatedly straddles a power-of-two boundary and instrument total copies to show **no thrashing** — copies stay `O(n)`. Then add a buggy variant that shrinks at `1/2` and show it thrashes (copies become `Θ(n·m)` for `m` boundary crossings).

`Difficulty: Medium`

#### Go

```go
package main

import "fmt"

type DynArray struct {
	data       []int
	size       int
	copies     int
	shrinkAtHalf bool // if true, the BUGGY policy
}

func New(shrinkAtHalf bool) *DynArray {
	return &DynArray{data: make([]int, 1), shrinkAtHalf: shrinkAtHalf}
}

func (a *DynArray) resize(cap int) {
	nd := make([]int, cap)
	for i := 0; i < a.size; i++ {
		nd[i] = a.data[i]
		a.copies++
	}
	a.data = nd
}

func (a *DynArray) Push(x int) {
	if a.size == len(a.data) {
		a.resize(2 * len(a.data))
	}
	a.data[a.size] = x
	a.size++
}

func (a *DynArray) Pop() {
	if a.size == 0 {
		return
	}
	a.size--
	cap := len(a.data)
	if a.shrinkAtHalf {
		if cap > 1 && a.size <= cap/2 {
			a.resize(cap / 2)
		}
	} else {
		if cap > 1 && a.size <= cap/4 {
			a.resize(cap / 2)
		}
	}
}

func run(shrinkAtHalf bool, n int) int {
	a := New(shrinkAtHalf)
	for i := 0; i < n; i++ {
		a.Push(i)
	}
	// Adversary: sit exactly on a boundary and toggle.
	for round := 0; round < 1000; round++ {
		a.Pop()
		a.Push(0)
	}
	return a.copies
}

func main() {
	fmt.Printf("shrink@1/4 copies=%d\n", run(false, 1024))
	fmt.Printf("shrink@1/2 copies=%d (thrashing)\n", run(true, 1024))
}
```

#### Java

```java
public class Task4 {
    static class DynArray {
        int[] data = new int[1];
        int size = 0;
        long copies = 0;
        boolean shrinkAtHalf;
        DynArray(boolean s) { shrinkAtHalf = s; }

        void resize(int cap) {
            int[] nd = new int[cap];
            for (int i = 0; i < size; i++) { nd[i] = data[i]; copies++; }
            data = nd;
        }

        void push(int x) {
            if (size == data.length) resize(2 * data.length);
            data[size++] = x;
        }

        void pop() {
            if (size == 0) return;
            size--;
            int cap = data.length;
            if (shrinkAtHalf) { if (cap > 1 && size <= cap / 2) resize(cap / 2); }
            else              { if (cap > 1 && size <= cap / 4) resize(cap / 2); }
        }
    }

    static long run(boolean shrinkAtHalf, int n) {
        DynArray a = new DynArray(shrinkAtHalf);
        for (int i = 0; i < n; i++) a.push(i);
        for (int r = 0; r < 1000; r++) { a.pop(); a.push(0); }
        return a.copies;
    }

    public static void main(String[] args) {
        System.out.printf("shrink@1/4 copies=%d%n", run(false, 1024));
        System.out.printf("shrink@1/2 copies=%d (thrashing)%n", run(true, 1024));
    }
}
```

#### Python

```python
class DynArray:
    def __init__(self, shrink_at_half):
        self.data = [None]
        self.size = 0
        self.copies = 0
        self.shrink_at_half = shrink_at_half

    def resize(self, cap):
        nd = [None] * cap
        for i in range(self.size):
            nd[i] = self.data[i]
            self.copies += 1
        self.data = nd

    def push(self, x):
        if self.size == len(self.data):
            self.resize(2 * len(self.data))
        self.data[self.size] = x
        self.size += 1

    def pop(self):
        if self.size == 0:
            return
        self.size -= 1
        cap = len(self.data)
        if self.shrink_at_half:
            if cap > 1 and self.size <= cap // 2:
                self.resize(cap // 2)
        else:
            if cap > 1 and self.size <= cap // 4:
                self.resize(cap // 2)


def run(shrink_at_half, n):
    a = DynArray(shrink_at_half)
    for i in range(n):
        a.push(i)
    for _ in range(1000):
        a.pop()
        a.push(0)
    return a.copies


print(f"shrink@1/4 copies={run(False, 1024)}")
print(f"shrink@1/2 copies={run(True, 1024)} (thrashing)")
```

- **Constraints:** Never shrink below capacity 1. After any resize, the load factor must be in `[1/4, 1]` for the `1/4` policy.
- **Hint:** With shrink-at-`1/2`, sitting at `size = cap/2` and doing push→pop→push→pop forces a full copy on *every* operation. With shrink-at-`1/4`, a shrink leaves the array half-full, so `Ω(cap)` operations must occur before the next resize in either direction.
- **Expected Output:** `shrink@1/4` copies grow with `n` (linear); `shrink@1/2` copies blow up with the number of toggle rounds.
- **Evaluation:** Both policies correct; the `1/4` policy demonstrably avoids thrashing.

---

**Task 5 (proof):** Using the **accounting (banker's) method**, prove that `Push` on a doubling dynamic array (Task 1) costs amortized `O(1)`. Charge each `Push` an amortized cost of **3** units (1 to write the new element, 2 banked). Show the bank balance never goes negative, so the total real cost is `≤ 3n`.

`Difficulty: Medium`

> **No code.** Write the argument. Use this as the grading model.

**Model derivation.**

Real cost of a `Push`:
- If there is room: `cᵢ = 1` (write the element).
- If full (capacity `c`, holding `c` elements): `cᵢ = c + 1` (copy `c` old elements, then write the new one).

Set the amortized charge `ĉᵢ = 3` for every `Push`. Define the **credit invariant**: immediately after any `Push`, every element occupying the *second half* of the backing array carries **2 credits**.

Why 2 credits suffice. Consider a doubling that occurs when the array of capacity `c` is full. The `c` elements being copied are exactly those that were inserted since the *previous* doubling — i.e., the elements that filled the array from `c/2` up to `c`, the most recent `c/2` insertions, plus the `c/2` that were already present. We arrange credits so that the `c/2` elements in the upper half each banked 2 credits during their own `Push`. Each such `Push` paid `ĉ = 3`: 1 unit for its own write, and 2 units banked onto itself.

When the array of capacity `c` fills and we double to `2c`, we must copy all `c` elements (cost `c`). The `c/2` elements in the upper half carry 2 credits each, totaling `c` credits — exactly enough to pay for copying all `c` elements. (The lower half's credits were already spent on the *previous* doubling.) After the copy, all `c` existing elements are now in the lower half of the new capacity-`2c` array and carry 0 credits, which is consistent: they sit in the lower half, and the invariant only requires upper-half elements to be funded.

Formally, the bank balance after `t` pushes is

```
B(t) = Σ ĉᵢ − Σ cᵢ = 3t − (real cost so far).
```

We show `B(t) ≥ 0` for all `t`. Between doublings, each push adds `3` to the bank and spends `1`, so the balance climbs by `2` per push. At a doubling from capacity `c`, the real cost is `c + 1`: the push contributes `3`, and we spend `c + 1`, a net change of `3 − (c+1) = 2 − c`. Just before this doubling, the upper half (`c/2` elements) accumulated `2` credits each since the last doubling, so the balance is `≥ 2·(c/2) = c ≥ c − 2`, which covers the `c − 2` deficit of the doubling step. Hence `B(t)` never drops below 0.

Therefore `Σ cᵢ ≤ Σ ĉᵢ = 3n`, so the amortized cost per `Push` is at most `3 = O(1)`, and any sequence of `n` pushes costs `O(n)`. ∎

- **Evaluation:** States real costs, fixes the charge at 3, exhibits the credit invariant, and proves the bank stays non-negative across a doubling.

---

**Task 6 (proof):** Prove the same `O(1)` amortized `Push` bound using the **potential method** with `Φ(D) = 2·size − capacity`. Verify `Φ ≥ 0` whenever the array is at least half full (the invariant doubling maintains), compute `ĉᵢ` for a non-resizing push and for a resizing push, and show both are `O(1)`.

`Difficulty: Medium`

> **No code.** Model derivation follows.

**Model derivation.**

Let `Φ(Dᵢ) = 2·sizeᵢ − capacityᵢ`. The doubling policy keeps the array at least half full immediately after any resize, and a push only increases `size`, so `size ≥ capacity/2` always holds after the first push; thus `Φ ≥ 0`. Initially we take `size = capacity` after the conceptual start, giving `Φ ≥ 0`, and `Φ(D₀) = 0` for the empty/size-1 start (`2·0 − ... ` is handled by treating the first push as a resize). The amortized cost is `ĉᵢ = cᵢ + Φ(Dᵢ) − Φ(Dᵢ₋₁)`.

**Case 1 — push without resize** (`sizeᵢ = sizeᵢ₋₁ + 1`, `capacity` unchanged, `cᵢ = 1`):

```
ĉᵢ = 1 + (2·sizeᵢ − cap) − (2·sizeᵢ₋₁ − cap)
   = 1 + 2(sizeᵢ − sizeᵢ₋₁)
   = 1 + 2·1
   = 3.
```

**Case 2 — push that triggers a resize.** Before the push, `sizeᵢ₋₁ = capᵢ₋₁ = c` (array full). The push copies `c` elements and writes 1, so `cᵢ = c + 1`. Afterward `sizeᵢ = c + 1` and `capᵢ = 2c`:

```
Φ(Dᵢ)   = 2(c+1) − 2c = 2.
Φ(Dᵢ₋₁) = 2c − c       = c.
ĉᵢ = (c + 1) + Φ(Dᵢ) − Φ(Dᵢ₋₁)
   = (c + 1) + 2 − c
   = 3.
```

In both cases `ĉᵢ = 3 = O(1)`. Since `Φ(Dₙ) ≥ 0 = Φ(D₀)`,

```
Σ cᵢ ≤ Σ cᵢ + Φ(Dₙ) − Φ(D₀) = Σ ĉᵢ = 3n,
```

so `n` pushes cost `O(n)`, i.e. amortized `O(1)` per push. The constant `3` matches the accounting charge of Task 5 — the two methods are dual: `Φ` *is* the bank balance. ∎

- **Evaluation:** Correct `Φ`, non-negativity argument, both `ĉ` cases computed to `3`, and the telescoping conclusion.

---

**Task 7 (proof):** Analyze the binary counter (Task 2) with the **potential method** using `Φ = (number of 1-bits in the counter)`. Show each `increment` has amortized cost `≤ 2`, recovering the `O(n)`-total bound.

`Difficulty: Medium`

> **No code.** Model derivation follows.

**Model derivation.**

Let `Φ(Dᵢ) = bᵢ`, the number of 1-bits after the `i`-th increment. Then `Φ(D₀) = 0` (counter starts at zero) and `Φ ≥ 0` always.

Consider increment `i`. Suppose it resets `tᵢ` trailing 1-bits to 0 (carry propagation) and, if a 0-bit was reached within the word, sets exactly one bit to 1. The real cost (bit flips) is

```
cᵢ = tᵢ + 1.
```

The number of 1-bits changes by `−tᵢ` (cleared) `+ 1` (the newly set bit), so

```
bᵢ = bᵢ₋₁ − tᵢ + 1   ⇒   Φ(Dᵢ) − Φ(Dᵢ₋₁) = 1 − tᵢ.
```

Therefore

```
ĉᵢ = cᵢ + Φ(Dᵢ) − Φ(Dᵢ₋₁) = (tᵢ + 1) + (1 − tᵢ) = 2.
```

Every increment has amortized cost exactly `2` (assuming no overflow; if the high bit overflows we simply drop the `+1` set and the bound only improves). Summing,

```
Σ cᵢ ≤ Σ ĉᵢ = 2n,
```

so `n` increments cost `O(n)` total — exactly `2n − b_n ≤ 2n` flips, matching the aggregate bound `Σ ⌊n/2^i⌋ < 2n`. ∎

- **Evaluation:** `Φ = #1-bits`, correct expression for `cᵢ` and `ΔΦ`, the cancellation to `ĉ = 2`, and the conclusion.

---

**Task 8 (proof):** Re-derive the binary-counter bound with the **aggregate method** directly, by summing how often each bit position flips. Show the total is `< 2n` and that this is tight up to lower-order terms.

`Difficulty: Medium`

> **No code.** Model derivation follows.

**Model derivation.**

Start the counter at 0 and perform `n` increments. Bit position `i` (with `i = 0` the least-significant bit) flips exactly once every `2^i` increments: bit 0 flips on every increment, bit 1 on every second, bit 2 on every fourth, and so on. Over `n` increments, bit `i` flips

```
⌊ n / 2^i ⌋  times.
```

Total flips across all bit positions:

```
T(n) = Σ_{i = 0}^{⌊log₂ n⌋} ⌊ n / 2^i ⌋
     ≤ Σ_{i = 0}^{∞} n / 2^i
     = n · (1 / (1 − 1/2))
     = 2n.
```

So `T(n) < 2n`, and the amortized cost per increment is `T(n)/n < 2 = O(1)`.

**Tightness.** Dropping the floors loses at most `1` per term, and there are `⌊log₂ n⌋ + 1` terms, so

```
T(n) ≥ 2n − O(log n),
```

confirming `T(n) = 2n − O(log n)`; the constant `2` cannot be reduced. ∎

- **Evaluation:** Per-bit flip frequency, geometric sum to `2n`, and the tightness remark.

---

## Advanced Tasks

**Task 9 (coding):** Implement a top-down **splay tree** supporting `insert` and `find` (each performs a splay that moves the accessed node to the root). Insert `n` keys and then perform `m` random accesses; instrument the *total nodes touched during splays* and show the average per access grows like `O(log n)`, confirming the amortized `O(log n)` bound.

`Difficulty: Hard`

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

type Node struct {
	key         int
	left, right *Node
}

type Splay struct {
	root  *Node
	touch int64
}

// rotateRight / rotateLeft via splay using the bottom-up "zig" steps.
func (t *Splay) splay(root *Node, key int) *Node {
	if root == nil {
		return nil
	}
	header := &Node{}
	leftMax, rightMin := header, header
	for {
		t.touch++
		if key < root.key {
			if root.left == nil {
				break
			}
			if key < root.left.key { // zig-zig
				r := root.left
				root.left = r.right
				r.right = root
				root = r
				if root.left == nil {
					break
				}
			}
			rightMin.left = root
			rightMin = root
			root = root.left
		} else if key > root.key {
			if root.right == nil {
				break
			}
			if key > root.right.key { // zag-zag
				r := root.right
				root.right = r.left
				r.left = root
				root = r
				if root.right == nil {
					break
				}
			}
			leftMax.right = root
			leftMax = root
			root = root.right
		} else {
			break
		}
	}
	leftMax.right = root.left
	rightMin.left = root.right
	root.left = header.right
	root.right = header.left
	return root
}

func (t *Splay) Insert(key int) {
	if t.root == nil {
		t.root = &Node{key: key}
		return
	}
	t.root = t.splay(t.root, key)
	if t.root.key == key {
		return
	}
	n := &Node{key: key}
	if key < t.root.key {
		n.left = t.root.left
		n.right = t.root
		t.root.left = nil
	} else {
		n.right = t.root.right
		n.left = t.root
		t.root.right = nil
	}
	t.root = n
}

func (t *Splay) Find(key int) bool {
	t.root = t.splay(t.root, key)
	return t.root != nil && t.root.key == key
}

func main() {
	for _, n := range []int{1000, 100000} {
		t := &Splay{}
		for i := 0; i < n; i++ {
			t.Insert(rand.Intn(10 * n))
		}
		t.touch = 0
		m := 100000
		for i := 0; i < m; i++ {
			t.Find(rand.Intn(10 * n))
		}
		fmt.Printf("n=%6d touches/access=%.2f (~log2 n=%.2f)\n",
			n, float64(t.touch)/float64(m), logBase2(float64(n)))
	}
}

func logBase2(x float64) float64 {
	r := 0.0
	for x > 1 {
		x /= 2
		r++
	}
	return r
}
```

#### Java

```java
import java.util.Random;

public class Task9 {
    static class Node { int key; Node left, right; Node(int k){key=k;} }

    static class Splay {
        Node root;
        long touch = 0;

        Node splay(Node root, int key) {
            if (root == null) return null;
            Node header = new Node(0);
            Node leftMax = header, rightMin = header;
            while (true) {
                touch++;
                if (key < root.key) {
                    if (root.left == null) break;
                    if (key < root.left.key) {
                        Node r = root.left; root.left = r.right; r.right = root; root = r;
                        if (root.left == null) break;
                    }
                    rightMin.left = root; rightMin = root; root = root.left;
                } else if (key > root.key) {
                    if (root.right == null) break;
                    if (key > root.right.key) {
                        Node r = root.right; root.right = r.left; r.left = root; root = r;
                        if (root.right == null) break;
                    }
                    leftMax.right = root; leftMax = root; root = root.right;
                } else break;
            }
            leftMax.right = root.left;
            rightMin.left = root.right;
            root.left = header.right;
            root.right = header.left;
            return root;
        }

        void insert(int key) {
            if (root == null) { root = new Node(key); return; }
            root = splay(root, key);
            if (root.key == key) return;
            Node n = new Node(key);
            if (key < root.key) { n.left = root.left; n.right = root; root.left = null; }
            else                { n.right = root.right; n.left = root; root.right = null; }
            root = n;
        }

        boolean find(int key) {
            root = splay(root, key);
            return root != null && root.key == key;
        }
    }

    public static void main(String[] args) {
        Random rng = new Random(1);
        for (int n : new int[]{1000, 100000}) {
            Splay t = new Splay();
            for (int i = 0; i < n; i++) t.insert(rng.nextInt(10 * n));
            t.touch = 0;
            int m = 100000;
            for (int i = 0; i < m; i++) t.find(rng.nextInt(10 * n));
            System.out.printf("n=%6d touches/access=%.2f (~log2 n=%.2f)%n",
                n, (double) t.touch / m, Math.log(n) / Math.log(2));
        }
    }
}
```

#### Python

```python
import random, sys, math
sys.setrecursionlimit(1 << 20)


class Node:
    __slots__ = ("key", "left", "right")
    def __init__(self, k):
        self.key, self.left, self.right = k, None, None


class Splay:
    def __init__(self):
        self.root = None
        self.touch = 0

    def splay(self, root, key):
        if root is None:
            return None
        header = Node(0)
        left_max = right_min = header
        while True:
            self.touch += 1
            if key < root.key:
                if root.left is None:
                    break
                if key < root.left.key:                # zig-zig
                    r = root.left; root.left = r.right; r.right = root; root = r
                    if root.left is None:
                        break
                right_min.left = root; right_min = root; root = root.left
            elif key > root.key:
                if root.right is None:
                    break
                if key > root.right.key:               # zag-zag
                    r = root.right; root.right = r.left; r.left = root; root = r
                    if root.right is None:
                        break
                left_max.right = root; left_max = root; root = root.right
            else:
                break
        left_max.right = root.left
        right_min.left = root.right
        root.left = header.right
        root.right = header.left
        return root

    def insert(self, key):
        if self.root is None:
            self.root = Node(key); return
        self.root = self.splay(self.root, key)
        if self.root.key == key:
            return
        n = Node(key)
        if key < self.root.key:
            n.left = self.root.left; n.right = self.root; self.root.left = None
        else:
            n.right = self.root.right; n.left = self.root; self.root.right = None
        self.root = n

    def find(self, key):
        self.root = self.splay(self.root, key)
        return self.root is not None and self.root.key == key


for n in (1000, 100000):
    t = Splay()
    for _ in range(n):
        t.insert(random.randrange(10 * n))
    t.touch = 0
    m = 100000
    for _ in range(m):
        t.find(random.randrange(10 * n))
    print(f"n={n:6d} touches/access={t.touch / m:.2f} (~log2 n={math.log2(n):.2f})")
```

- **Constraints:** Implement the splay yourself (no balanced-tree library). A single access may touch `Θ(n)` nodes in the worst case — that is expected; the *average* over the sequence must be `O(log n)`.
- **Hint:** The amortized bound is proven with the potential `Φ = Σ_x rank(x)` where `rank(x) = ⌊log₂(size of subtree at x)⌋`; the Access Lemma gives amortized `O(log n)` per splay. You only need to *measure* it here.
- **Expected Output:** touches/access stays within a small constant factor of `log₂ n`.
- **Evaluation:** Correct splay restructuring (BST invariant preserved); measured average is `O(log n)`.

---

**Task 10 (coding):** Implement **union-find** with **path compression** and **union by rank**. Run `m` random `union`/`find` operations on `n` elements and instrument the *total parent-pointer hops*. Show the average per operation is effectively constant (the true bound is the inverse Ackermann `α(n)`, which is `≤ 4` for all practical `n`).

`Difficulty: Hard`

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

type DSU struct {
	parent, rank []int
	hops         int64
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), rank: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}

func (d *DSU) Find(x int) int {
	root := x
	for d.parent[root] != root {
		d.hops++
		root = d.parent[root]
	}
	for d.parent[x] != root { // path compression
		next := d.parent[x]
		d.parent[x] = root
		x = next
	}
	return root
}

func (d *DSU) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
}

func main() {
	for _, n := range []int{1000, 1000000} {
		d := NewDSU(n)
		m := 2 * n
		for i := 0; i < m; i++ {
			if i%2 == 0 {
				d.Union(rand.Intn(n), rand.Intn(n))
			} else {
				d.Find(rand.Intn(n))
			}
		}
		fmt.Printf("n=%7d ops=%7d hops/op=%.3f\n",
			n, m, float64(d.hops)/float64(m))
	}
}
```

#### Java

```java
import java.util.Random;

public class Task10 {
    static class DSU {
        int[] parent, rank;
        long hops = 0;
        DSU(int n) {
            parent = new int[n]; rank = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
        }
        int find(int x) {
            int root = x;
            while (parent[root] != root) { hops++; root = parent[root]; }
            while (parent[x] != root) { int nx = parent[x]; parent[x] = root; x = nx; }
            return root;
        }
        void union(int a, int b) {
            int ra = find(a), rb = find(b);
            if (ra == rb) return;
            if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
            parent[rb] = ra;
            if (rank[ra] == rank[rb]) rank[ra]++;
        }
    }

    public static void main(String[] args) {
        Random rng = new Random(1);
        for (int n : new int[]{1000, 1000000}) {
            DSU d = new DSU(n);
            int m = 2 * n;
            for (int i = 0; i < m; i++) {
                if (i % 2 == 0) d.union(rng.nextInt(n), rng.nextInt(n));
                else d.find(rng.nextInt(n));
            }
            System.out.printf("n=%7d ops=%7d hops/op=%.3f%n", n, m, (double) d.hops / m);
        }
    }
}
```

#### Python

```python
import random


class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.hops = 0

    def find(self, x):
        root = x
        while self.parent[root] != root:
            self.hops += 1
            root = self.parent[root]
        while self.parent[x] != root:        # path compression
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


for n in (1000, 1000000):
    d = DSU(n)
    m = 2 * n
    for i in range(m):
        if i % 2 == 0:
            d.union(random.randrange(n), random.randrange(n))
        else:
            d.find(random.randrange(n))
    print(f"n={n:7d} ops={m:7d} hops/op={d.hops / m:.3f}")
```

- **Constraints:** You must apply *both* path compression *and* union by rank; either alone gives a weaker bound. Compress the path after locating the root.
- **Hint:** The amortized bound `O(α(n))` per operation is one of the deepest results in amortized analysis (Tarjan). You only measure it: hops/op should hover near a small constant even as `n` grows by `1000×`.
- **Expected Output:** hops/op barely changes between `n = 10³` and `n = 10⁶`.
- **Evaluation:** Correct DSU with both heuristics; near-constant measured cost per operation.

---

**Task 11 (coding):** **De-amortization.** The doubling array gives amortized `O(1)` push but a *single* push can take `Θ(n)`. Build a stack/array with **worst-case `O(1)` push** using **incremental copying**: keep two backing arrays; when the small one fills, allocate a bigger one and copy a *constant number* of old elements on every subsequent push, finishing the copy before the new array fills. Verify the worst-case per-push work is bounded by a constant, then explain why the amortized analysis still holds.

`Difficulty: Hard`

#### Go

```go
package main

import "fmt"

// IncrementalArray: worst-case O(1) push via incremental migration.
type IncrementalArray struct {
	cur     []int // active array
	curSize int
	old     []int // array being migrated out of
	oldSize int   // how many of old are still unmigrated (copied front-to-back)
	migrate int   // index in old of next element to copy
	maxWork int   // max elements copied in a single push (instrumentation)
}

func New() *IncrementalArray {
	return &IncrementalArray{cur: make([]int, 1)}
}

func (a *IncrementalArray) Push(x int) {
	work := 0
	// Step 1: make incremental progress migrating old -> cur.
	if a.old != nil {
		// Copy up to 2 old elements per push (enough to finish before cur fills).
		for k := 0; k < 2 && a.migrate < a.oldSize; k++ {
			a.cur[a.migrate] = a.old[a.migrate]
			a.migrate++
			a.curSize++
			work++
		}
		if a.migrate >= a.oldSize {
			a.old = nil // migration complete
		}
	}
	// Step 2: if cur is full, start a new migration into a doubled array.
	if a.curSize == len(a.cur) {
		bigger := make([]int, 2*len(a.cur))
		a.old = a.cur
		a.oldSize = a.curSize
		a.cur = bigger
		a.migrate = 0
		a.curSize = 0
		// Copy a couple right away to bound steady-state.
		for k := 0; k < 2 && a.migrate < a.oldSize; k++ {
			a.cur[a.migrate] = a.old[a.migrate]
			a.migrate++
			a.curSize++
			work++
		}
	}
	a.cur[a.curSize] = x
	a.curSize++
	work++ // the write itself
	if work > a.maxWork {
		a.maxWork = work
	}
}

func main() {
	a := New()
	for i := 0; i < 1 << 20; i++ {
		a.Push(i)
	}
	fmt.Printf("pushes=%d max work in any single push=%d\n", 1<<20, a.maxWork)
}
```

#### Java

```java
public class Task11 {
    static class IncrementalArray {
        int[] cur = new int[1];
        int curSize = 0;
        int[] old = null;
        int oldSize = 0, migrate = 0, maxWork = 0;

        void push(int x) {
            int work = 0;
            if (old != null) {
                for (int k = 0; k < 2 && migrate < oldSize; k++) {
                    cur[migrate] = old[migrate]; migrate++; curSize++; work++;
                }
                if (migrate >= oldSize) old = null;
            }
            if (curSize == cur.length) {
                int[] bigger = new int[2 * cur.length];
                old = cur; oldSize = curSize; cur = bigger; migrate = 0; curSize = 0;
                for (int k = 0; k < 2 && migrate < oldSize; k++) {
                    cur[migrate] = old[migrate]; migrate++; curSize++; work++;
                }
            }
            cur[curSize++] = x;
            work++;
            if (work > maxWork) maxWork = work;
        }
    }

    public static void main(String[] args) {
        IncrementalArray a = new IncrementalArray();
        for (int i = 0; i < (1 << 20); i++) a.push(i);
        System.out.printf("pushes=%d max work in any single push=%d%n", 1 << 20, a.maxWork);
    }
}
```

#### Python

```python
class IncrementalArray:
    def __init__(self):
        self.cur = [None]
        self.cur_size = 0
        self.old = None
        self.old_size = 0
        self.migrate = 0
        self.max_work = 0

    def push(self, x):
        work = 0
        if self.old is not None:
            for _ in range(2):
                if self.migrate >= self.old_size:
                    break
                self.cur[self.migrate] = self.old[self.migrate]
                self.migrate += 1
                self.cur_size += 1
                work += 1
            if self.migrate >= self.old_size:
                self.old = None
        if self.cur_size == len(self.cur):
            bigger = [None] * (2 * len(self.cur))
            self.old, self.old_size = self.cur, self.cur_size
            self.cur, self.migrate, self.cur_size = bigger, 0, 0
            for _ in range(2):
                if self.migrate >= self.old_size:
                    break
                self.cur[self.migrate] = self.old[self.migrate]
                self.migrate += 1
                self.cur_size += 1
                work += 1
        self.cur[self.cur_size] = x
        self.cur_size += 1
        work += 1
        self.max_work = max(self.max_work, work)


a = IncrementalArray()
N = 1 << 20
for i in range(N):
    a.push(i)
print(f"pushes={N} max work in any single push={a.max_work}")
```

- **Constraints:** No single `push` may perform more than a fixed constant amount of copying. The migration must finish before the new array fills (copying 2 per push while the array fills over `cap` pushes is sufficient since the old array holds only `cap/2`... actually `cap` here — choose the per-push copy budget to guarantee completion).
- **Hint:** De-amortization converts an `O(1)`-amortized operation into `O(1)`-*worst-case* by spreading the expensive rebuild across the cheap operations that follow it. The total work is unchanged, so the amortized bound is preserved; only its *distribution* over operations changes.
- **Expected Output:** `max work in any single push` is a small constant (independent of `n`).
- **Evaluation:** Worst-case per-push work bounded by a constant; correctness preserved (elements retrievable in order); explanation of why amortized total is unchanged.

---

**Task 12 (proof + coding):** **Persistence trap.** Amortized bounds via the potential method assume each version of the structure is used *once* (a single linear timeline of operations). Demonstrate the trap: take the doubling array and make it *persistent* by sharing the backing array between snapshots. Show that repeatedly pushing onto the *same* full snapshot forces a full `O(n)` copy *every time*, so the amortized `O(1)` bound collapses to `O(n)` per push. Then explain the fix (rebuild from scratch on each branch resets the credit, or use a worst-case structure).

`Difficulty: Hard`

#### Go

```go
package main

import "fmt"

// A "persistent" doubling array snapshot. Push returns a NEW snapshot,
// sharing the backing array until a grow is forced.
type Snapshot struct {
	data []int
	size int
}

var totalCopies int

func Push(s *Snapshot, x int) *Snapshot {
	// Persistence forbids overwriting a shared cell, so we copy every time.
	cap := len(s.data)
	if s.size == cap {
		cap *= 2
	}
	nd := make([]int, cap)
	copy(nd, s.data[:s.size])
	totalCopies += s.size
	nd[s.size] = x
	return &Snapshot{data: nd, size: s.size + 1}
}

func main() {
	// Build a full snapshot of size n.
	base := &Snapshot{data: make([]int, 8), size: 8}
	totalCopies = 0
	// Adversary: push onto the SAME full base 1000 times (branching).
	for i := 0; i < 1000; i++ {
		_ = Push(base, i) // each forces a full copy of base
	}
	fmt.Printf("branchings=%d total copies=%d (≈ n per push -> O(n) each)\n",
		1000, totalCopies)
}
```

#### Java

```java
public class Task12 {
    static class Snapshot {
        int[] data; int size;
        Snapshot(int[] d, int s) { data = d; size = s; }
    }
    static long totalCopies = 0;

    static Snapshot push(Snapshot s, int x) {
        // Persistence forbids overwriting a shared cell, so we copy every time.
        int cap = (s.size == s.data.length) ? 2 * s.data.length : s.data.length;
        int[] nd = new int[cap];
        System.arraycopy(s.data, 0, nd, 0, s.size);
        totalCopies += s.size;
        nd[s.size] = x;
        return new Snapshot(nd, s.size + 1);
    }

    public static void main(String[] args) {
        Snapshot base = new Snapshot(new int[8], 8);
        totalCopies = 0;
        for (int i = 0; i < 1000; i++) push(base, i); // each forces full copy
        System.out.printf("branchings=%d total copies=%d (~n per push -> O(n) each)%n",
            1000, totalCopies);
    }
}
```

#### Python

```python
total_copies = 0


class Snapshot:
    __slots__ = ("data", "size")
    def __init__(self, data, size):
        self.data = data
        self.size = size


def push(s, x):
    global total_copies
    cap = 2 * len(s.data) if s.size == len(s.data) else len(s.data)
    nd = [None] * cap
    for i in range(s.size):           # cannot overwrite shared cells
        nd[i] = s.data[i]
    total_copies += s.size
    nd[s.size] = x
    return Snapshot(nd, s.size + 1)


base = Snapshot([None] * 8, 8)
total_copies = 0
for i in range(1000):
    push(base, i)                     # each forces a full copy of base
print(f"branchings={1000} total copies={total_copies} (~n per push -> O(n) each)")
```

- **Constraints:** Each `Push` returns a new snapshot without mutating the input — that is what "persistent" means. Do not share-and-overwrite.
- **Hint:** The amortized argument banks credit assuming the bank is spent *once*. Branching off the same expensive state reuses the same banked credit many times — but the credit was only paid for once. The potential difference `Φ(Dᵢ) − Φ(Dᵢ₋₁)` telescopes only along a single timeline; with branching, the telescoping breaks and `Σ ĉᵢ` no longer bounds `Σ cᵢ`.
- **The fix:** (1) Use a *functional/worst-case* data structure (e.g., a balanced tree or a finger tree) whose every operation is worst-case `O(log n)` or `O(1)`, so persistence is free; or (2) Okasaki's *lazy evaluation + memoization* technique, which restores amortized bounds under persistence by sharing the *result* of the expensive computation across all branches that observe it (so it is paid for once even when reached many ways).
- **Expected Output:** total copies ≈ `branchings × n`, i.e. each push is `O(n)`.
- **Evaluation:** Demonstrates the `O(n)`-per-push blow-up under branching; correctly explains why the amortized telescoping fails and names a valid fix.

---

## Benchmark Task

> Across all three languages, compare a **naive `O(n²)` repeated-rebuild** array (rebuild the whole backing store on every push) against the **amortized `O(1)` doubling** array, over `n` pushes. The gap should widen quadratically.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func naivePush(n int) {
	data := []int{}
	for i := 0; i < n; i++ {
		nd := make([]int, len(data)+1) // rebuild every push -> O(n) each, O(n²) total
		copy(nd, data)
		nd[len(data)] = i
		data = nd
	}
}

func doublingPush(n int) {
	data := make([]int, 1)
	size := 0
	for i := 0; i < n; i++ {
		if size == len(data) {
			nd := make([]int, 2*len(data))
			copy(nd, data)
			data = nd
		}
		data[size] = i
		size++
	}
}

func main() {
	for _, n := range []int{1000, 4000, 16000, 64000} {
		start := time.Now()
		naivePush(n)
		naive := time.Since(start)

		start = time.Now()
		doublingPush(n)
		dbl := time.Since(start)

		fmt.Printf("n=%6d naive=%8v doubling=%8v ratio=%.1f\n",
			n, naive, dbl, float64(naive)/float64(dbl+1))
	}
}
```

#### Java

```java
public class Benchmark {
    static void naivePush(int n) {
        int[] data = new int[0];
        for (int i = 0; i < n; i++) {
            int[] nd = new int[data.length + 1];
            System.arraycopy(data, 0, nd, 0, data.length);
            nd[data.length] = i;
            data = nd;
        }
    }

    static void doublingPush(int n) {
        int[] data = new int[1];
        int size = 0;
        for (int i = 0; i < n; i++) {
            if (size == data.length) {
                int[] nd = new int[2 * data.length];
                System.arraycopy(data, 0, nd, 0, size);
                data = nd;
            }
            data[size++] = i;
        }
    }

    public static void main(String[] args) {
        for (int n : new int[]{1000, 4000, 16000, 64000}) {
            long s = System.nanoTime();
            naivePush(n);
            double naive = (System.nanoTime() - s) / 1e6;

            s = System.nanoTime();
            doublingPush(n);
            double dbl = (System.nanoTime() - s) / 1e6;

            System.out.printf("n=%6d naive=%8.2f ms doubling=%8.3f ms ratio=%.1f%n",
                n, naive, dbl, naive / (dbl + 1e-9));
        }
    }
}
```

#### Python

```python
import time


def naive_push(n):
    data = []
    for i in range(n):
        nd = data[:]          # rebuild whole backing store -> O(n) per push
        nd.append(i)
        data = nd


def doubling_push(n):
    data = [None]
    size = 0
    for i in range(n):
        if size == len(data):
            nd = [None] * (2 * len(data))
            nd[:size] = data[:size]
            data = nd
        data[size] = i
        size += 1


for n in (1000, 4000, 16000, 64000):
    s = time.perf_counter()
    naive_push(n)
    naive = (time.perf_counter() - s) * 1000

    s = time.perf_counter()
    doubling_push(n)
    dbl = (time.perf_counter() - s) * 1000

    print(f"n={n:6d} naive={naive:8.2f} ms doubling={dbl:8.3f} ms ratio={naive / (dbl + 1e-9):.1f}")
```

- **Expected Output:** As `n` grows `4×`, the naive time grows `~16×` (quadratic) while doubling grows `~4×` (linear); the ratio widens steadily — the amortized structure wins decisively at scale.

---

## Where to go next

- Revisit the asymptotics behind these bounds in the [time-vs-space tasks](../01-time-vs-space-complexity/tasks.md).
- For the conceptual treatment of each method and the worked structures, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
- The splay-tree Access Lemma (Task 9) and the union-find `α(n)` analysis (Task 10) are the canonical "hard" amortized proofs — derive them by hand once you can implement and measure the structures.
