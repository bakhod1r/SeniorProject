# Concurrent Bloom Filter — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Your First Bloom Filter](#your-first-bloom-filter)
10. [Using `bits-and-blooms/bloom/v3`](#using-bits-and-bloomsbloomv3)
11. [The False-Positive Story](#the-false-positive-story)
12. [Sizing Your Filter](#sizing-your-filter)
13. [Reading the Bitset](#reading-the-bitset)
14. [Concurrent Use: First Look](#concurrent-use-first-look)
15. [Coding Patterns](#coding-patterns)
16. [Clean Code](#clean-code)
17. [Error Handling](#error-handling)
18. [Security Considerations](#security-considerations)
19. [Performance Tips](#performance-tips)
20. [Best Practices](#best-practices)
21. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Common Misconceptions](#common-misconceptions)
24. [Tricky Points](#tricky-points)
25. [Test](#test)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "What is a Bloom filter? Why does it sometimes lie? How do I use one from Go?"

A **Bloom filter** is a tiny data structure that answers one question: *"have I seen this thing before?"* It answers with one of two responses:

- **"No, definitely not."** This answer is always correct.
- **"Maybe."** This answer is sometimes wrong. The wrong cases are called **false positives**.

A Bloom filter never says "yes, definitely." It never produces **false negatives** either: if you added an item, the filter will always say "maybe" for that item. The asymmetry — *no false negatives, some false positives* — is exactly what makes the structure useful and exactly what trips up beginners.

A Bloom filter stores no keys. It stores a **bit array** (often called a **bitset**) plus a recipe for turning a key into a list of bit positions. To Add a key you flip those bits to 1. To Test a key you read those same bits and ask "are they all 1?" If any is 0, the key was never added. If they are all 1, the key was either added or unlucky — three or four other unrelated keys happened to set all the bits your key cares about.

A single Bloom filter that holds 10 million items can fit in roughly 12 MB of memory with a 1% false-positive rate. A `map[string]struct{}` storing those same 10 million items would cost gigabytes. That space saving is the entire point.

This file is your first encounter with the structure. By the end you will:

- Know what bits a Bloom filter is built from
- Know what false positives and false negatives mean and which one is possible
- Have written and run a Bloom filter from scratch in about 40 lines of Go
- Have used the `bits-and-blooms/bloom/v3` library to get a production-quality filter
- Understand the relationship between **m** (bits), **k** (hash functions), **n** (items), and **p** (false-positive rate)
- Have seen what happens when you call a Bloom filter from many goroutines without protection
- Know one safe pattern — `sync.RWMutex` — for sharing a filter across goroutines

You do not need to know about counting Bloom filters, scalable Bloom filters, Cuckoo filters, partitioned designs, or lock-free atomic bitsets. Those come at the middle, senior, and professional levels. Right now the goal is to build, query, and share one simple filter and feel comfortable doing it.

---

## Prerequisites

- **Required:** A Go installation, version 1.21 or newer. Check with `go version`.
- **Required:** Comfort with `go mod init` and `go get` for adding third-party packages.
- **Required:** Familiarity with maps, slices, and basic functions in Go.
- **Required:** Awareness that hashing turns an arbitrary input into a fixed-size integer; you do not need to know how `fnv` or `xxhash` are implemented internally.
- **Helpful:** Some exposure to bit operations (`|`, `&`, `>>`, `<<`). The first hand-rolled example uses them but explains every step.
- **Helpful:** Knowledge of probability at the level of "if I flip a coin n times, the chance all heads is `(1/2)^n`." We will derive Bloom filter formulae from that intuition.

If you can write a Go program that reads a slice of strings, builds a `map[string]struct{}`, and reports which inputs are in the set, you are ready.

---

## Glossary

| Term | Definition |
| --- | --- |
| **Bloom filter** | A probabilistic set that supports Add and Test, may have false positives, and never has false negatives. |
| **Bitset** (bit array) | A contiguous array of bits, indexed from 0. The underlying storage of a Bloom filter. |
| **m** | The number of bits in the bitset. Larger m means lower false-positive rate. |
| **k** | The number of hash functions used per key. Each key sets or tests k bits. |
| **n** | The number of items added so far. |
| **p** | The false-positive probability, often written FPR. |
| **False positive** | The filter says "maybe" for an item that was never added. |
| **False negative** | The filter says "no" for an item that was added. A standard Bloom filter never produces these. |
| **Saturation** | The state in which most bits are 1, causing p to approach 1. |
| **Hash family** | The set of k hash functions used by the filter. In practice often two hashes combined arithmetically (double hashing). |
| **Counting Bloom filter** | A variant that stores small counters instead of bits, supporting deletion. |
| **Scalable Bloom filter** (SBF) | A variant that grows by chaining filters when capacity is exceeded. |
| **Partitioned Bloom filter** | A variant that splits the bitset into k equal partitions, one per hash function. |
| **Cuckoo filter** | A different probabilistic set with deletion and often better space efficiency. |
| **`bits-and-blooms/bloom/v3`** | The actively maintained Go library; successor to `willf/bloom`. |
| **`willf/bloom`** | The original Go library by Will Fitzgerald; superseded but still referenced in older code. |

You will meet these terms repeatedly. None of them require more than one sentence to understand; the depth comes from the *combinations*.

---

## Core Concepts

### 1. The bit array

At the bottom of every Bloom filter is a fixed-size array of bits. Conceptually:

```
m = 16
index:  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
bits:   0 0 0 0 0 0 0 0 0 0  0  0  0  0  0  0
```

We will represent this in Go as a `[]uint64`, where bit `i` lives in word `i / 64` at offset `i % 64`. The library handles this for you; we will do it by hand once for intuition.

### 2. The hash functions

You need a way to turn a key into k positions in the bitset. The traditional recipe uses k independent hash functions, but in practice almost every modern Bloom filter uses **double hashing**: compute two hashes `h1` and `h2`, then derive position `i` as `(h1 + i*h2) mod m`. Two hash computations give you k positions.

For our first example we use Go's built-in `hash/fnv` and a simple split of its 64-bit output into two 32-bit halves.

### 3. Add and Test

To **Add** a key, compute its k positions and set all those bits to 1. To **Test** a key, compute its k positions and check if all those bits are 1.

```
Add("apple")  -> positions 2, 7, 13 -> set bits 2, 7, 13
Add("pear")   -> positions 1, 7, 14 -> set bits 1, 7, 14
Test("apple") -> bits 2, 7, 13 -> all 1, answer "maybe"
Test("grape") -> positions 2, 7, 14 -> all happen to be 1, answer "maybe" (false positive!)
Test("kiwi")  -> positions 0, 4, 9 -> bit 0 is 0, answer "no"
```

The "grape" case is the false positive. Its three bits were each set by a different real Add, not by anything related to grape.

### 4. The three numbers that define a filter

A Bloom filter is fully described by:

- **m** — bits of memory
- **k** — hashes per key
- **n** — keys added

From these, the false-positive rate is approximately:

```
p ≈ (1 - e^(-k*n/m))^k
```

For a target p and expected n, the optimal m is:

```
m = -(n * ln p) / (ln 2)^2
```

And the optimal k is:

```
k = (m/n) * ln 2
```

You do not need to remember these formulae as a junior; you need to know they exist and that `bits-and-blooms/bloom/v3` has `EstimateParameters(n, p)` that computes them for you.

### 5. Why a Bloom filter saves memory

A `map[string]struct{}` stores every key in full. A 16-byte key in a map of 10 million entries costs at least 160 MB just for the keys, plus pointers, plus a load-factor margin, plus the bucket overhead — typically over a gigabyte in practice.

A Bloom filter sized for 10 million items at 1% false positives needs roughly **9.6 bits per item**, so about **12 MB total**. The trade-off is that it cannot return the key itself, only "yes/no/maybe" for membership.

### 6. No deletion in the basic variant

Once a bit is set you cannot safely unset it. Several different keys may have set that bit; clearing it removes those other keys from the set as far as the filter is concerned. This is why a true delete operation requires a **counting Bloom filter** that stores small counters instead of bits — covered in middle.md.

---

## Real-World Analogies

### Restaurant reservation list

A receptionist keeps a paper checklist where each square represents a *hash* of a name, not the name itself. When someone arrives and gives their name, the receptionist computes the hash and checks the square. If empty, the person definitely has no reservation. If marked, the person *might* have one — but two different people could hash to the same square. The receptionist then asks for ID. The paper list is the Bloom filter; the ID check is the slow lookup.

### Apartment mailbox lights

Imagine an apartment block where each tenant flips three light bulbs out of 1 000 to indicate they live there. The pattern of three bulbs is computed from their name. To check if a stranger "lives there," check if their three bulbs are on. With few tenants the question is reliable; once most bulbs are on, almost anyone looks like a tenant.

### Customs declaration

A border officer has a list of confiscated-item types stored as a Bloom filter. The officer scans each item and the filter says "this *might* be on the list" or "this is definitely not." When the answer is "maybe," the officer does a slow manual check. The vast majority of innocent items are filtered out without manual work.

These analogies share a single shape: a cheap, possibly-wrong "maybe" gates an expensive, always-correct check.

---

## Mental Models

### Model 1 — The bingo card

Picture each key as the recipient of three squares on a giant bingo card. Adding a key fills its three squares. Testing a key asks "are all three of this key's squares filled?" After enough Adds the card is full enough that almost any pattern of three squares is "filled" — that is saturation, and that is when false positives explode.

### Model 2 — The fingerprint cabinet

Each key has a k-bit fingerprint scattered across an m-bit cabinet. Adding records the fingerprint. Testing asks "is this fingerprint already in the cabinet?" Two different keys can share parts of a fingerprint, so a recorded fingerprint can be a coincidence of other entries.

### Model 3 — The lossy index

Think of a normal index that lost the keys but kept the buckets. You can still tell "this key's bucket is empty, so the key cannot be present," but you can no longer tell "what other keys hashed here." That is precisely a Bloom filter.

### Model 4 — Negative-cache amplifier

A Bloom filter wrapping a database is a **negative cache amplifier**: it shortcuts the common "definitely not present" case without paying the round trip. Treat it as an optimisation for the negative path, not a replacement for the positive path.

---

## Pros & Cons

### Pros

- **Memory efficient.** Roughly `1.44 * log2(1/p)` bits per item — about 9.6 bits per item for p = 0.01.
- **Constant-time operations.** Add and Test are O(k), independent of n.
- **No allocations per operation.** A well-implemented filter touches only the bitset and stack temporaries.
- **No false negatives.** "No" answers are always trustworthy.
- **Trivially serialisable.** A `[]uint64` plus three integers — m, k, n — is the full state.
- **Plays well with caches and disks.** Used by Bigtable, Cassandra, RocksDB, Postgres, Bitcoin SPV clients, and HDFS for negative-lookup avoidance.

### Cons

- **False positives are real and measurable.** You must plan for them.
- **No standard deletion.** Counting Bloom filters add deletion at the cost of more memory.
- **Sensitive to sizing.** Undersizing destroys accuracy; oversizing wastes RAM. You must estimate n in advance.
- **Hash quality matters.** A bad hash family clusters bits and inflates p.
- **Hard to combine with TTL.** A bit set today cannot be "expired" individually.
- **Concurrent updates are surprisingly subtle.** Naive writes risk torn words; deletion requires extra care.

---

## Use Cases

A junior is most likely to meet Bloom filters in these settings:

1. **Negative cache in front of a database.** "Is this user ID in the system?" — a no from the filter avoids the SQL round trip.
2. **Deduplication of stream events.** "Have I already processed this event ID this hour?" — false positives mean a tiny fraction of legitimate events are skipped; the math controls how tiny.
3. **Web crawler URL frontier.** "Have I already crawled this URL?" — false positives mean a few new URLs are missed; usually acceptable.
4. **Password breach checks.** Pwned-password lists shipped as Bloom filters allow client-side checks without leaking the password.
5. **Big-data system internals.** LSM-tree SSTables (RocksDB, Cassandra) carry per-file Bloom filters so a Get that misses can skip reading the file at all.
6. **Spam filters.** Quickly reject known-bad URLs or sender hashes.
7. **Cache stampede protection.** "Is this key currently being recomputed?" — used in combination with single-flight.

We will revisit these at higher levels with concurrency in mind.

---

## Your First Bloom Filter

Let us build one by hand. Forty lines of Go, no dependencies. The point is to *feel* what is happening; we will switch to the library immediately after.

Create `simple/bloom.go`:

```go
package simple

import (
	"hash/fnv"
)

type Bloom struct {
	bits []uint64
	m    uint64 // number of bits
	k    uint64 // number of hash positions per key
}

func New(m, k uint64) *Bloom {
	words := (m + 63) / 64
	return &Bloom{
		bits: make([]uint64, words),
		m:    m,
		k:    k,
	}
}

func (b *Bloom) hashes(key []byte) (uint64, uint64) {
	h := fnv.New64a()
	h.Write(key)
	x := h.Sum64()
	return x, x>>32 | x<<32
}

func (b *Bloom) Add(key []byte) {
	h1, h2 := b.hashes(key)
	for i := uint64(0); i < b.k; i++ {
		pos := (h1 + i*h2) % b.m
		b.bits[pos/64] |= 1 << (pos % 64)
	}
}

func (b *Bloom) Test(key []byte) bool {
	h1, h2 := b.hashes(key)
	for i := uint64(0); i < b.k; i++ {
		pos := (h1 + i*h2) % b.m
		if b.bits[pos/64]&(1<<(pos%64)) == 0 {
			return false
		}
	}
	return true
}
```

And `simple/bloom_test.go`:

```go
package simple

import (
	"fmt"
	"testing"
)

func TestBasic(t *testing.T) {
	b := New(1024, 3)
	b.Add([]byte("apple"))
	b.Add([]byte("pear"))

	if !b.Test([]byte("apple")) {
		t.Error("apple should be present")
	}
	if !b.Test([]byte("pear")) {
		t.Error("pear should be present")
	}
	if b.Test([]byte("kiwi")) {
		t.Log("kiwi reported as present (false positive)")
	}
}

func TestFPRGrowsWithFill(t *testing.T) {
	b := New(1024, 3)
	for i := 0; i < 200; i++ {
		b.Add([]byte(fmt.Sprintf("key-%d", i)))
	}
	fp := 0
	trials := 10_000
	for i := 0; i < trials; i++ {
		if b.Test([]byte(fmt.Sprintf("probe-%d", i))) {
			fp++
		}
	}
	t.Logf("FPR ≈ %.4f", float64(fp)/float64(trials))
}
```

Run it:

```
go test -v ./simple/...
```

The second test prints something like `FPR ≈ 0.0540`. That is your filter's observed false-positive rate at this fill level. Try doubling m, halving m, doubling k, halving k, and observe how the number moves. Hands-on feel beats memorising formulae.

### What you just built

You allocated `m / 64` `uint64` words. You wrote a hash that returns two 64-bit numbers from one FNV-1a digest. You used double hashing to derive k positions. You set bits with `|=` and tested them with `&`. That is the entire algorithm.

The data structure is *that* small. Every variant in this topic — counting, partitioned, scalable, lock-free — is a variation on these forty lines.

---

## Using `bits-and-blooms/bloom/v3`

Hand-rolled filters are excellent for learning but you should not ship them. The community-maintained library handles edge cases, serialisation, parameter estimation, and intersection/union for you.

```
go mod init example.com/bloomdemo
go get github.com/bits-and-blooms/bloom/v3
```

A first program:

```go
package main

import (
	"fmt"

	"github.com/bits-and-blooms/bloom/v3"
)

func main() {
	// Sized for 1 million expected items at 1% false-positive rate.
	f := bloom.NewWithEstimates(1_000_000, 0.01)

	f.AddString("alice")
	f.AddString("bob")

	fmt.Println("alice present?", f.TestString("alice"))
	fmt.Println("bob present?  ", f.TestString("bob"))
	fmt.Println("carol present?", f.TestString("carol"))

	fmt.Printf("m=%d bits, k=%d hashes, ApproxItems=%d\n",
		f.Cap(), f.K(), f.ApproximatedSize())
}
```

The output is something like:

```
alice present? true
bob present?   true
carol present? false
m=9585059 bits, k=7 hashes, ApproxItems=2
```

A few API points worth memorising:

- `bloom.New(m, k)` — explicit sizing.
- `bloom.NewWithEstimates(n, p)` — derive m and k from a target capacity and false-positive rate.
- `f.Add(b []byte)` / `f.AddString(s string)` — Add.
- `f.Test(b []byte)` / `f.TestString(s string)` — Test.
- `f.TestAndAdd(b []byte) bool` — Atomically Test, then Add; returns true if probably present *before* the Add. Not safe across goroutines unless you wrap it.
- `f.Cap()`, `f.K()`, `f.ApproximatedSize()` — inspection.
- `f.MarshalBinary()` / `f.UnmarshalBinary()` — serialisation.
- `f.Union(other *bloom.BloomFilter)` / `f.Intersect(other *bloom.BloomFilter)` — set operations between filters with identical (m, k).

The library uses MurmurHash3 internally and applies double hashing, which is a strict upgrade over FNV for non-cryptographic use.

### A note on the package name

`bits-and-blooms/bloom/v3` is the active home of the project. The original `willf/bloom` package (named after Will Fitzgerald) was donated to the bits-and-blooms organisation and you should always import the `v3` path in new code. APIs are nearly identical, which is why old tutorials still mostly work. Where this document later says "the library," it means `bits-and-blooms/bloom/v3`.

---

## The False-Positive Story

False positives are not a bug — they are the entire deal you signed. The questions are:

1. What rate did I target?
2. What rate am I actually getting?
3. What happens in my application when one fires?

### What rate did I target?

If you call `bloom.NewWithEstimates(n, p)`, you targeted `p`. The library picks m and k to achieve `p` *assuming you add exactly n items*. Add 2n items and your real p shoots well above the target.

### What rate am I actually getting?

You measure it. Sample a stream of negative queries (keys you know are not in the set) and count how many the filter answered "maybe" for. Divide by the total.

```go
func MeasureFPR(f *bloom.BloomFilter, negatives [][]byte) float64 {
	fp := 0
	for _, k := range negatives {
		if f.Test(k) {
			fp++
		}
	}
	return float64(fp) / float64(len(negatives))
}
```

In production this becomes a Prometheus gauge updated periodically — see middle.md for the observability story.

### What happens when one fires?

A false positive routes a query down the slow path. If the slow path is "ask the database," you pay an extra round trip. If the slow path is "skip the event because we think we already processed it," then a *real* event is dropped. The cost of a false positive depends entirely on the slow path.

Junior rule: **always be able to articulate the cost of a single false positive in your system.** If you cannot, you are using a Bloom filter for the wrong reason.

---

## Sizing Your Filter

The library does this for you, but you should know what it is computing.

```go
m, k := bloom.EstimateParameters(1_000_000, 0.01)
// m = 9585059, k = 7
```

The closed-form rules:

```
m = ceil(-n * ln(p) / (ln 2)^2)
k = round((m/n) * ln 2)
```

For common targets:

| n | p | m (bits) | bytes | bits/item | k |
| --- | --- | --- | --- | --- | --- |
| 100 000 | 1% | 958 506 | 119 813 | 9.58 | 7 |
| 1 000 000 | 1% | 9 585 059 | 1 198 132 | 9.58 | 7 |
| 1 000 000 | 0.1% | 14 377 588 | 1 797 198 | 14.38 | 10 |
| 1 000 000 | 0.01% | 19 170 117 | 2 396 264 | 19.17 | 13 |
| 10 000 000 | 1% | 95 850 583 | 11 981 322 | 9.58 | 7 |

Rules of thumb:

- Halving p costs you roughly `9.58` extra bits per item to drop from 1% to 0.1%, then another 4.8 to drop to 0.01%. Diminishing returns kick in fast.
- k around 7 is "normal." If your estimator returns k = 30, you probably over-tightened p and the resulting filter will be CPU-bound on every Test.
- If you do not know n in advance, you cannot pick m correctly. Use a **scalable Bloom filter** (senior.md) instead.

### A junior estimation trick

Need a quick mental estimate? **10 bits per item gives roughly 1% false positives.** That is close enough for back-of-envelope sizing. For 1 million items, allocate about 1.25 MB and you are in the right ballpark.

---

## Reading the Bitset

The library exposes `f.BitSet()` returning a `*bitset.BitSet` from `github.com/bits-and-blooms/bitset`. You can inspect or print it for debugging:

```go
f := bloom.New(64, 3)
f.AddString("hello")
fmt.Println(f.BitSet().String())
// {1,21,34}  (positions of set bits — depends on hash)
```

You can also count set bits to estimate fill:

```go
fmt.Println("set bits:", f.BitSet().Count(), "of", f.Cap())
```

`ApproximatedSize()` uses the Swamidass–Baldi estimator to invert the fill formula and recover an approximate item count.

---

## Concurrent Use: First Look

Now we step into territory that is the topic of this whole subsection. The library's `BloomFilter` is **not** safe for concurrent use. If two goroutines call `Add` at the same time, you have a data race on the bitset.

Try this — it is meant to fail under `-race`:

```go
package main

import (
	"fmt"
	"sync"

	"github.com/bits-and-blooms/bloom/v3"
)

func main() {
	f := bloom.NewWithEstimates(100_000, 0.01)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 10_000; i++ {
				f.Add([]byte(fmt.Sprintf("g%d-key%d", g, i)))
			}
		}(g)
	}
	wg.Wait()
	fmt.Println("approx items:", f.ApproximatedSize())
}
```

Run with `go run -race main.go` and observe the race report on the bitset words. Without `-race` the program "works" — the racy writes may even produce a roughly correct filter — but a few bit-set operations have been silently lost, every false-positive guarantee is now meaningless, and your serialised filter will be subtly wrong.

The simplest safe wrapper is an RWMutex:

```go
package safebloom

import (
	"sync"

	"github.com/bits-and-blooms/bloom/v3"
)

type Filter struct {
	mu sync.RWMutex
	bf *bloom.BloomFilter
}

func New(n uint, p float64) *Filter {
	return &Filter{bf: bloom.NewWithEstimates(n, p)}
}

func (f *Filter) Add(key []byte) {
	f.mu.Lock()
	f.bf.Add(key)
	f.mu.Unlock()
}

func (f *Filter) Test(key []byte) bool {
	f.mu.RLock()
	ok := f.bf.Test(key)
	f.mu.RUnlock()
	return ok
}
```

This wrapper is correct. It is also a contention bottleneck under heavy write load because every Add takes the write lock. Junior level: ship the wrapper, accept the bottleneck, measure first, and revisit only when profiling shows a problem. Middle and senior pages cover atomic and sharded designs that remove the lock.

### Why the bitset is not concurrent-safe out of the box

A `[]uint64` modified with `bits[i] |= mask` is a read-modify-write of a single word. Two goroutines doing this on the same word can lose a bit if their RMW operations interleave: each reads the old value, ORs in their own bit, and one of the writes wins. The lost bit corresponds to a lost Add — a future Test for that key will return "no" — and a Bloom filter with even one false negative is broken for its primary contract.

The fix is to make the write atomic. Either lock around it (the RWMutex wrapper above), or use `atomic.Uint64` and CAS the bit in (middle.md). Both work; the trade-offs differ.

---

## Coding Patterns

### Pattern: Bloom-then-database

```go
func (s *Service) UserExists(id string) (bool, error) {
	if !s.filter.Test([]byte(id)) {
		return false, nil // definite negative, no DB hit
	}
	return s.db.UserExists(id) // possible positive, check authoritatively
}
```

This is the canonical use. The filter eliminates 99% of negative queries; the database handles the remaining 1% plus all positives.

### Pattern: Filter-as-cache-shield

```go
func (c *Cache) Get(key string) ([]byte, bool) {
	if !c.knownKeys.Test([]byte(key)) {
		return nil, false
	}
	return c.store.Get(key)
}

func (c *Cache) Put(key string, val []byte) {
	c.knownKeys.Add([]byte(key))
	c.store.Put(key, val)
}
```

A negative Test skips the cache backend entirely. Useful when the backend is a remote Redis whose RTT dominates.

### Pattern: Idempotent event consumer

```go
func (w *Worker) Handle(eventID string, body []byte) {
	if w.seen.Test([]byte(eventID)) {
		w.metrics.DuplicateSkipped.Inc()
		return
	}
	w.process(body)
	w.seen.Add([]byte(eventID))
}
```

False positives here mean *real events get dropped*. Pick `p` accordingly. For payment processing, this pattern alone is *insufficient* — you need an authoritative dedup store; the filter merely fast-paths obvious duplicates.

### Pattern: Periodic snapshot for cold start

```go
func loadFilter(path string) (*bloom.BloomFilter, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	f := &bloom.BloomFilter{}
	if err := f.UnmarshalBinary(data); err != nil {
		return nil, err
	}
	return f, nil
}
```

A filter takes one Marshal at shutdown and one Unmarshal at startup. Cold-starting a service with a populated filter avoids the "negative cache cold for the first ten minutes" problem.

---

## Clean Code

- **Hide the filter behind a method.** Code outside the package should not see `*bloom.BloomFilter`; it should see your `Exists(key string) bool`.
- **Name the false-positive rate.** `const userFilterFPR = 0.01` is better than `0.01` inlined in three places.
- **Wrap construction.** A single `NewUserFilter()` that picks n and p makes future tuning a one-line change.
- **Always commit the m, k, n choice somewhere.** Either in a constant or in a `init`-time log line. Future-you will thank present-you.
- **Do not export the underlying bitset.** Callers must not poke at bits directly; if they do, they will accidentally make the filter wrong.

---

## Error Handling

A Bloom filter's API is very small. Errors come from three places:

1. **Construction with bad parameters.** `bloom.New(0, 0)` panics; `EstimateParameters(0, 0.01)` returns zero m. Validate inputs at the boundary.
2. **Marshal/Unmarshal.** Treat I/O errors normally. A corrupted byte stream produces a decode error you should log and refuse to start with.
3. **Concurrent misuse.** This is silent. The race detector is your only signal. Run tests with `go test -race`.

There is no "the filter is full" error — the structure happily keeps adding items, but its false-positive rate climbs. You must monitor for that condition yourself (see middle.md).

---

## Security Considerations

- **Hash quality.** The standard library uses a deterministic, non-keyed hash. An attacker who can predict your hash can craft keys that all collide on the same bits, intentionally driving up the false-positive rate or creating a saturation attack. For adversarial inputs use a keyed or randomised hash (see senior.md).
- **Memory safety.** A Bloom filter's bitset is fixed-size. There is no unbounded growth and no allocation per insert, so a malicious adversary cannot OOM you with insertions.
- **Information leakage.** A filter does *not* store keys, but the set of marked bits leaks information. A motivated attacker with access to the bitset can in principle infer item presence with statistical confidence. Treat the bitset as sensitive if it summarises sensitive data.

---

## Performance Tips

- **Reuse the filter.** Construction allocates m/8 bytes. Construct once at startup.
- **Avoid `string([]byte)` round-trips.** `f.Add([]byte(s))` allocates; if your data is already `[]byte`, use it.
- **Pre-size with `NewWithEstimates`.** Manual sizing is error-prone.
- **Batch reads where possible.** A loop of `Test` calls is fine; each call costs k hashes plus k bitset reads.
- **Beware false positives in hot paths.** If `Test` returns true, you then pay the slow-path cost. A filter sized for 50% false positives is barely a filter; it forwards half its work to the slow path.

---

## Best Practices

- **Pick `n` for your *peak* expected load, not average.**
- **Add a buffer to `n`.** A 20–30% safety margin keeps you out of saturation if traffic spikes.
- **Always wrap with synchronisation in concurrent code.** The library is not safe by default.
- **Snapshot to disk if cold-start matters.** Marshal at shutdown; Unmarshal on boot.
- **Plan for a rebuild path.** Once a filter saturates, the only fix is to make a new one. Have a code path that builds the next filter in the background and atomically swaps it in. The "scalable Bloom filter" idea (senior.md) automates this.

---

## Edge Cases & Pitfalls

- **Adding the same key twice does nothing.** Bits are idempotent. Counters track this, the basic filter does not.
- **Calling `Test` on an empty filter always returns false.** No bits are set.
- **m = 0 is illegal.** The library panics if you ask for zero bits.
- **k = 0 makes every Test return true.** It tests zero bits, so the AND-over-zero is vacuously true.
- **`MarshalBinary` is endian-safe** but you must not concatenate two filters' encodings hoping for a union; use `Union` explicitly.
- **Different libraries produce incompatible serialisations.** A filter marshalled by `bits-and-blooms/bloom/v3` cannot be unmarshalled by `willf/bloom` 1.x without a converter.
- **Forgetting to seed.** Some hash families (not the library's default) require a seed. If you forget, two filters in two processes disagree on the bit positions for the same key, breaking serialised exchange.

---

## Common Mistakes

1. **Treating "maybe" as "yes."** Every Test that returns true *must* be followed by the authoritative check.
2. **Sizing for current n, not future n.** Filter ages along with the data; size for end-of-life capacity.
3. **Sharing one filter across goroutines without a lock.** Silent corruption.
4. **Deleting from a basic Bloom filter.** There is no Delete. Use a counting Bloom filter or rebuild from scratch.
5. **Mixing two different hash families.** A filter built with FNV cannot answer queries hashed with MurmurHash; the bit positions disagree.
6. **Loading a marshalled filter into a freshly constructed one without checking m, k.** The library's `UnmarshalBinary` sets these for you; rolling your own and forgetting them is a classic bug.
7. **Logging a "filter hit" without distinguishing true positive from false positive.** Without slow-path confirmation logs you cannot measure your true FPR in production.

---

## Common Misconceptions

- *"Bloom filters are exact for small inputs."* No. They are probabilistic at every size. Small n usually means very low p, but the rate is never zero.
- *"More hash functions are always better."* No. There is an optimum at `k = (m/n) ln 2`. Beyond it, every Test sets and reads more bits but the false-positive rate goes up because the bitset saturates faster.
- *"A Bloom filter can replace a database."* No. It only answers a yes/no/maybe question and stores no values.
- *"I can iterate the filter to list all added keys."* No. The keys are gone the moment they were added.
- *"A Bloom filter with `p = 0` exists."* No. Any finite filter accepts some negatives as positives.
- *"`TestAndAdd` is the same as a CAS."* No. `TestAndAdd` is two non-atomic operations under one lock-free read in the library; only the wrapper's lock makes it linearisable.

---

## Tricky Points

### "It worked in my test, why is it wrong in prod?"

Your test added 100 items to a filter sized for 100. Production added 100 000 items to a filter sized for 100. The filter is saturated; everything looks present.

### "We removed a user but they still match the filter."

The basic filter has no delete. You either rebuild periodically or migrate to a counting Bloom filter.

### "Two services disagree on whether a key is present."

They are likely using different hashes (or different seeds) and so compute different bit positions for the same key. Serialise the filter from one and Unmarshal into the other; never rebuild from a key list expecting bitwise equality unless you control hash determinism.

### "FPR rose suddenly even though insertion rate is flat."

You marshalled the filter to disk and reloaded it but accidentally Unioned it with another filter, or your counter for n drifted from reality. Or the data distribution shifted and you are now testing keys that collide with existing bits more often (rare; uniform hashing usually masks this).

### "Filter looks empty but `ApproximatedSize()` returns 5."

That is the estimator's noise floor. With very few bits set, the inversion is dominated by rounding. Trust the estimator only for non-trivial fill.

---

## Test

A pragmatic test for a junior Bloom-filter wrapper:

```go
package safebloom

import (
	"fmt"
	"sync"
	"testing"
)

func TestAddTest(t *testing.T) {
	f := New(10_000, 0.01)
	for i := 0; i < 1000; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
	}
	for i := 0; i < 1000; i++ {
		if !f.Test([]byte(fmt.Sprintf("k%d", i))) {
			t.Fatalf("false negative for k%d", i)
		}
	}
}

func TestObservedFPR(t *testing.T) {
	f := New(10_000, 0.01)
	for i := 0; i < 10_000; i++ {
		f.Add([]byte(fmt.Sprintf("a%d", i)))
	}
	fp := 0
	probes := 100_000
	for i := 0; i < probes; i++ {
		if f.Test([]byte(fmt.Sprintf("b%d", i))) {
			fp++
		}
	}
	rate := float64(fp) / float64(probes)
	t.Logf("observed FPR = %.4f", rate)
	if rate > 0.03 {
		t.Fatalf("FPR %.4f exceeds 3%% sanity bound", rate)
	}
}

func TestConcurrentNoRace(t *testing.T) {
	f := New(100_000, 0.01)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				k := []byte(fmt.Sprintf("g%d-i%d", g, i))
				f.Add(k)
				f.Test(k)
			}
		}(g)
	}
	wg.Wait()
}
```

Run with `go test -race -v`. The first two assert behaviour; the third exists purely to satisfy the race detector.

---

## Tricky Questions

1. **You added 1 000 keys to a filter sized for 100. What is the false-positive rate now?**
   Likely near 1.0. The bitset is saturated; almost every probe looks present.

2. **Your test passes but production sees a 30% FPR. Why?**
   Sizing. Your test used 100 keys; production has 1 000 000. The filter was sized for the test, not production.

3. **You wrap the filter in `sync.Mutex`. Reads block writes. Is that correct?**
   It is safe but pessimistic. `sync.RWMutex` lets concurrent Tests overlap. For low write rates RWMutex is strictly better; under hot writes it has its own contention story (see middle.md).

4. **Two goroutines `TestAndAdd` the same key concurrently. Each sees `false` and then both `Add`. Is that a bug?**
   It is the expected behaviour of `TestAndAdd` without a lock. If you need exactly one "first add" to win, take a lock around `TestAndAdd` or use `Add`'s idempotence and accept that both callers reported "first."

5. **You marshal a filter, ship the bytes to another service, Unmarshal, and queries always return false. Why?**
   Either you Unmarshalled into a freshly constructed `*bloom.BloomFilter` whose constructor zeroed the bitset *after* Unmarshal, or you are using a different library version with an incompatible encoding. Always Unmarshal into `var f bloom.BloomFilter` and check the returned m, k.

6. **You see false positives at exactly the target rate in a benchmark. Are you done?**
   Only if your benchmark inputs match production. The rate is sensitive to data distribution if your hash function is weak. With MurmurHash3 it is essentially distribution-independent; with a homemade hash it can be very distribution-dependent.

---

## Cheat Sheet

```
What is it?               A probabilistic set: definitely-not or maybe.
Operations?               Add, Test, MarshalBinary, UnmarshalBinary, Union, Intersect.
Time complexity?          O(k) per Add and per Test, independent of n.
Space?                    ≈ -n ln(p) / (ln 2)^2 bits.
Rule of thumb?            10 bits per item for 1% FPR.
Default library?          github.com/bits-and-blooms/bloom/v3
Construction?             bloom.NewWithEstimates(n, p)
Concurrent safe?          No. Wrap in sync.RWMutex (junior) or use sharded/atomic (middle+).
Can I delete?             Not from the basic filter. Use a counting variant.
Can I resize?             Not in place. Use a scalable Bloom filter or rebuild.
Cost of one false positive? Whatever your slow path costs. Articulate it.
```

---

## Self-Assessment Checklist

- [ ] I can write a Bloom filter from scratch in under 60 lines.
- [ ] I can use `bits-and-blooms/bloom/v3` to construct, Add, and Test.
- [ ] I can derive m and k from n and p, at least roughly.
- [ ] I can explain why there are no false negatives and how false positives arise.
- [ ] I can wrap the library in a `sync.RWMutex` and explain why the library is not concurrent-safe by default.
- [ ] I can describe at least two real-world systems that use Bloom filters (e.g. RocksDB SSTables, Cassandra, Bitcoin SPV).
- [ ] I can measure the observed FPR of a filter with a stream of negative probes.
- [ ] I know that the basic filter has no delete and what counting Bloom filters do about it.
- [ ] I have run a Bloom filter test under `go test -race`.
- [ ] I can recite the rule "10 bits per item ≈ 1% FPR" without looking it up.

---

## Summary

A Bloom filter is a fixed-size bitset plus k hash functions. Add sets bits; Test reads them. The structure may lie one way (false positives) but never the other (no false negatives), and that asymmetry is precisely why it is useful. The library `bits-and-blooms/bloom/v3` gives you a tested implementation with `NewWithEstimates(n, p)` that picks the right m and k for your target rate. The library is single-threaded; a `sync.RWMutex` wrapper makes it safe to share across goroutines, and that is enough to ship a junior-level service. Middle, senior, and professional pages explore why and when to do better.

The discipline of using a Bloom filter is sizing and measurement. Size for your peak n with margin, measure your observed FPR continuously, and have a plan for rebuild when the filter saturates. Everything else is variation on these forty lines of code.

---

## What You Can Build

After this file you can implement:

- A negative cache in front of a SQL or Redis lookup.
- A per-user "have I seen this notification" deduper for an email/SMS sender.
- A web-crawler URL frontier that skips already-crawled URLs.
- A "known-bad" Bloom filter shipped as a static asset to clients (e.g. for breached passwords).
- A pre-filter for any expensive yes/no query whose negative case dominates.

You can also wrap the library safely for concurrent use behind a thin interface, which is more than enough for the majority of production needs.

---

## Further Reading

- Bloom, B. H. (1970). *Space/Time Trade-offs in Hash Coding with Allowable Errors.* CACM 13(7).
- Mitzenmacher, M., & Upfal, E. (2017). *Probability and Computing*, chapter on Bloom filters.
- Broder, A., & Mitzenmacher, M. (2003). *Network Applications of Bloom Filters: A Survey.*
- The `bits-and-blooms/bloom/v3` README and godoc.
- *Designing Data-Intensive Applications* by Martin Kleppmann, chapter 3 (SSTables, Bloom filters).
- Cassandra documentation on Bloom filters per SSTable.
- RocksDB wiki: "Bloom Filter."

---

## Related Topics

- [Concurrent Counters](../06-concurrent-counters/) — Counting Bloom filters are a counter array; many lessons carry over.
- [Concurrent Skip List](../03-concurrent-skip-list/) — When you actually need ordered access alongside membership.
- [LRU Concurrent](../02-lru-concurrent/) — Bloom-then-LRU is a common cache topology.
- [TTL Caches](../01-ttl-caches/) — TTL semantics interact awkwardly with bit-based filters; rebuild-on-rotate is the usual answer.
- Hashing fundamentals: `hash/fnv`, `hash/maphash`, `github.com/spaolacci/murmur3`, `github.com/cespare/xxhash/v2`.

---

## Extended Walk-Through: Building a Negative Cache

Reading the above gives you the vocabulary. Now let us build something real, end to end, so that every concept lands in code. We will build a tiny "is this user registered?" lookup service backed by a slow source of truth (we will simulate it with `time.Sleep`) and a Bloom filter that short-circuits the obvious negatives.

### Step 1: define the slow source

```go
package userdir

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("user not found")

// SlowStore is a stand-in for a real database with realistic latency.
type SlowStore struct {
	users map[string]string
	delay time.Duration
}

func NewSlowStore(users map[string]string, delay time.Duration) *SlowStore {
	return &SlowStore{users: users, delay: delay}
}

func (s *SlowStore) Get(ctx context.Context, id string) (string, error) {
	select {
	case <-time.After(s.delay):
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if v, ok := s.users[id]; ok {
		return v, nil
	}
	return "", ErrNotFound
}
```

A `Get` of an unknown user costs `delay` seconds — fifty milliseconds in our example. That is the cost we want to avoid for queries we know cannot succeed.

### Step 2: wrap with a Bloom filter

```go
package userdir

import (
	"context"
	"sync"

	"github.com/bits-and-blooms/bloom/v3"
)

type Directory struct {
	store  *SlowStore
	filter *bloom.BloomFilter
	mu     sync.RWMutex // protects filter
}

func NewDirectory(store *SlowStore, expectedUsers uint) *Directory {
	d := &Directory{
		store:  store,
		filter: bloom.NewWithEstimates(expectedUsers, 0.01),
	}
	// Pre-populate the filter from the known user set.
	for id := range store.users {
		d.filter.AddString(id)
	}
	return d
}

func (d *Directory) Lookup(ctx context.Context, id string) (string, error) {
	d.mu.RLock()
	mayExist := d.filter.TestString(id)
	d.mu.RUnlock()
	if !mayExist {
		return "", ErrNotFound
	}
	return d.store.Get(ctx, id)
}

func (d *Directory) Register(ctx context.Context, id, email string) {
	d.store.users[id] = email
	d.mu.Lock()
	d.filter.AddString(id)
	d.mu.Unlock()
}
```

The shape is identical to the "Bloom-then-database" pattern but now committed to real code. Note how the filter is filled at construction from the existing store; without that step the filter answers "no" for every existing user and we never reach the store.

### Step 3: drive it from many goroutines

```go
package userdir

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDirectoryUnderLoad(t *testing.T) {
	users := map[string]string{}
	for i := 0; i < 10_000; i++ {
		users[fmt.Sprintf("user-%d", i)] = fmt.Sprintf("u%d@example.com", i)
	}
	store := NewSlowStore(users, 50*time.Millisecond)
	dir := NewDirectory(store, 20_000)

	var slowHits int64
	var notFound int64
	var found int64
	var wg sync.WaitGroup

	queries := 1000
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < queries; i++ {
				id := fmt.Sprintf("user-%d", (g*queries+i)%20_000)
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				start := time.Now()
				_, err := dir.Lookup(ctx, id)
				cancel()
				switch {
				case err == nil:
					atomic.AddInt64(&found, 1)
					if time.Since(start) > time.Millisecond {
						atomic.AddInt64(&slowHits, 1)
					}
				case errors.Is(err, ErrNotFound):
					atomic.AddInt64(&notFound, 1)
				}
			}
		}(g)
	}
	wg.Wait()

	t.Logf("found=%d notFound=%d slowHits=%d", found, notFound, slowHits)
}
```

Half the IDs in this test exist; half do not. Without the filter every "not found" pays 50 ms; with the filter most "not found" answers return immediately. Use `time.Since` to record both paths and observe.

### Step 4: measure the cost of false positives

In the test above, count `slowHits` for queries where `err == ErrNotFound`. Those are false-positive cases — the filter said "maybe" and the store said "no." Divide by total `notFound` and you have the observed FPR.

```go
t.Logf("observed FPR ≈ %.4f", float64(slowHitsForMisses)/float64(notFound))
```

Compare with the targeted 1%. If you sized the filter for `expectedUsers = 20_000` and added all 10 000 real users, you should see well under 1% — the filter is half full.

### Step 5: simulate growth past the design limit

Re-run the test but make the user set grow to 50 000 users without re-sizing the filter. Now you sized for 20 000 but added 50 000. Watch the FPR climb. This is the saturation-on-misestimation scenario you must defend against in production.

---

## Hands-on: Reading the Bit Pattern

A short detour to make the structure tangible. The `bits-and-blooms/bitset` package backs the filter. You can read it directly:

```go
package main

import (
	"fmt"

	"github.com/bits-and-blooms/bloom/v3"
)

func main() {
	f := bloom.New(64, 4)
	keys := []string{"alice", "bob", "carol", "dan", "eve"}
	for _, k := range keys {
		f.AddString(k)
	}
	bs := f.BitSet()
	fmt.Println("filter capacity (bits):", f.Cap())
	fmt.Println("set bits:", bs.Count())
	fmt.Println("pattern:")
	for i := uint(0); i < f.Cap(); i++ {
		if bs.Test(i) {
			fmt.Print("1")
		} else {
			fmt.Print("0")
		}
		if (i+1)%16 == 0 {
			fmt.Println()
		}
	}
}
```

Output looks like:

```
filter capacity (bits): 64
set bits: 19
pattern:
0101001011010101
1001000010110011
0010110001000101
1101000010101010
```

Five keys * four hashes = 20 bit-positions; one collision left 19 set bits.

### Counting bits per word

If you ever want to compute fill manually:

```go
func fill(b []uint64) int {
	total := 0
	for _, w := range b {
		total += bits.OnesCount64(w)
	}
	return total
}
```

`bits.OnesCount64` from `math/bits` uses a CPU `popcnt` instruction where available — one instruction per word.

---

## How the Library Picks `k`

`EstimateParameters` rounds `(m/n)*ln 2` to the nearest integer with a minimum of 1. Let us watch it:

```go
for _, n := range []uint{100, 1_000, 10_000, 100_000, 1_000_000} {
	for _, p := range []float64{0.1, 0.01, 0.001} {
		m, k := bloom.EstimateParameters(n, p)
		fmt.Printf("n=%-7d p=%-6g -> m=%-9d (≈%.2f bits/item)  k=%d\n",
			n, p, m, float64(m)/float64(n), k)
	}
}
```

Sample output:

```
n=100     p=0.1    -> m=479      (≈4.79 bits/item)  k=3
n=100     p=0.01   -> m=959      (≈9.59 bits/item)  k=7
n=100     p=0.001  -> m=1438     (≈14.38 bits/item) k=10
n=1000    p=0.1    -> m=4793     (≈4.79 bits/item)  k=3
...
n=1000000 p=0.001  -> m=14377588 (≈14.38 bits/item) k=10
```

Key observation: `bits per item` is a function of `p` alone. It does not depend on n. That is why people quote the rule "10 bits per item ≈ 1% FPR" — the bits-per-item is a property of the FPR target.

---

## Hand-tracing an Add

The very first time you build a filter it pays to trace one Add on paper. Pick m = 32, k = 3, key = "hi".

1. `h := fnv.New64a(); h.Write([]byte("hi")); x := h.Sum64()`
   - Say `x = 0xA9F37ED7C9266F31`.
2. Split into two 32-bit halves: `h1 = 0xA9F37ED7`, `h2 = 0xC9266F31` (or use a high/low rotation as our snippet did).
3. Compute positions:
   - i = 0: `(h1 + 0*h2) mod 32 = 0xA9F37ED7 mod 32 = 23`
   - i = 1: `(h1 + 1*h2) mod 32 = (0xA9F37ED7 + 0xC9266F31) mod 32 = ...`
   - i = 2: similar
4. For each `pos`, set bit `pos % 64` in word `pos / 64` of the `[]uint64`.

You can do the modular arithmetic with a hand calculator and convince yourself the positions land in `[0, 32)`. Repeat for `Test("hi")` and observe that the same three positions are computed.

This trace is the entire algorithm. Every variant in the rest of the topic is "do this, but differently."

---

## A Tour of the Library Surface

Even at junior level a tour of `bits-and-blooms/bloom/v3` helps you avoid reinventing wheels.

### Constructors

- `New(m, k uint)` — explicit.
- `NewWithEstimates(n uint, p float64)` — recommended.
- `From([]uint64, uint k)` — wrap existing bitset words. Useful for tests.

### Mutation

- `Add(data []byte) *BloomFilter` — returns the same filter for chaining.
- `AddString(s string) *BloomFilter`
- `ClearAll()` — zero the bitset. Equivalent to "delete everything."

### Query

- `Test(data []byte) bool`
- `TestString(s string) bool`
- `TestAndAdd(data []byte) bool` — returns `Test` result, then unconditionally `Add`s.
- `TestOrAdd(data []byte) bool` — returns true if already present *and skips* Add.
- `TestAndAddString(s string) bool`
- `TestOrAddString(s string) bool`

### Inspection

- `Cap() uint` — m.
- `K() uint` — k.
- `BitSet() *bitset.BitSet`
- `ApproximatedSize() uint32` — Swamidass–Baldi estimator.

### Set Operations

- `Equal(other *BloomFilter) bool`
- `Union(other *BloomFilter) (*BloomFilter, error)` — bitwise OR of bitsets. Requires identical m, k.
- `Merge(other *BloomFilter) error` — in-place Union.
- `Intersect(other *BloomFilter) (*BloomFilter, error)` — bitwise AND. Approximates intersection but with worse semantics; use with care.

### Serialisation

- `MarshalBinary() ([]byte, error)`
- `UnmarshalBinary(data []byte) error`
- `WriteTo(w io.Writer) (int64, error)`
- `ReadFrom(r io.Reader) (int64, error)`
- `GobEncode/GobDecode`
- `MarshalJSON/UnmarshalJSON`

### Differences from `willf/bloom`

The `bits-and-blooms` fork:

- Renames the import path to `github.com/bits-and-blooms/bloom/v3`.
- Adds `TestOrAdd` and `TestOrAddString`.
- Adopts `*bitset.BitSet` from the sibling `bits-and-blooms/bitset` package.
- Maintains binary compatibility with `willf/bloom` v2 serialisations.

When you read older blog posts that say `import "github.com/willf/bloom"`, mentally substitute the new path.

---

## A Closer Look at `TestAndAdd` vs `TestOrAdd`

These two look similar. They are not.

```go
present := f.TestAndAdd(key) // Test, then ALWAYS Add. Returns the Test result.
present := f.TestOrAdd(key)  // Test, and Add ONLY IF NOT present. Returns the Test result.
```

For a Bloom filter the *effect* is identical (Adding a key that is already present is a no-op as far as bits go), but the *cost* differs:

- `TestAndAdd` always pays the bit-set cost.
- `TestOrAdd` skips the bit-set cost on cache hits.

For a counting Bloom filter (middle.md), the difference is semantically important: `TestAndAdd` increments counters every time; `TestOrAdd` only on first sight.

For concurrent use, both are unsafe in the library. Wrap them.

---

## Beginner-Friendly Recipes

A small recipe book you can copy into a service.

### Recipe 1: A bounded-size "have we seen this notification?" deduper

```go
type Deduper struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}

func NewDeduper(expectedPerHour uint, fpr float64) *Deduper {
	return &Deduper{f: bloom.NewWithEstimates(expectedPerHour, fpr)}
}

func (d *Deduper) Seen(id string) bool {
	d.mu.RLock()
	seen := d.f.TestString(id)
	d.mu.RUnlock()
	if seen {
		return true
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.f.TestString(id) { // double-check after upgrade
		return true
	}
	d.f.AddString(id)
	return false
}
```

The double-check after lock upgrade prevents a race where two goroutines both saw "not seen" under RLock and both want to Add. With the inner re-Test only the first to acquire the write lock returns false; the second sees the Add and returns true.

### Recipe 2: Hourly rotation

```go
func (d *Deduper) Rotate(expectedPerHour uint, fpr float64) {
	fresh := bloom.NewWithEstimates(expectedPerHour, fpr)
	d.mu.Lock()
	d.f = fresh
	d.mu.Unlock()
}
```

A timer or scheduler calls `Rotate` every hour. The new filter starts empty; deduplication resets across the boundary. If you want overlap, keep both the current and previous filter and Test against both — a "two-window" pattern handy for event streams.

### Recipe 3: Snapshot on shutdown

```go
func (d *Deduper) Snapshot(path string) error {
	d.mu.RLock()
	data, err := d.f.MarshalBinary()
	d.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func RestoreDeduper(path string) (*Deduper, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	f := &bloom.BloomFilter{}
	if err := f.UnmarshalBinary(data); err != nil {
		return nil, err
	}
	return &Deduper{f: f}, nil
}
```

These three recipes cover the majority of small services' needs.

---

## A First Look at Sharding

You will hit the wall of "the RWMutex is my bottleneck" eventually. The simplest fix is **sharding**: maintain N filters keyed by `hash(key) % N`, lock each shard independently, and you have N times less contention.

```go
type Sharded struct {
	shards [16]struct {
		mu sync.RWMutex
		f  *bloom.BloomFilter
	}
}

func (s *Sharded) shardFor(key []byte) int {
	h := fnv.New32a()
	h.Write(key)
	return int(h.Sum32()) % len(s.shards)
}

func (s *Sharded) Add(key []byte) {
	i := s.shardFor(key)
	s.shards[i].mu.Lock()
	s.shards[i].f.Add(key)
	s.shards[i].mu.Unlock()
}

func (s *Sharded) Test(key []byte) bool {
	i := s.shardFor(key)
	s.shards[i].mu.RLock()
	defer s.shards[i].mu.RUnlock()
	return s.shards[i].f.Test(key)
}
```

This is the bridge to middle.md. Note that each shard is sized for `n / 16` items at the same FPR; the union of all shards behaves like one big filter for any given key (it always lands in exactly one shard).

There is a subtlety we will deepen later: `ApproximatedSize` across shards is *not* the sum of per-shard estimates — the formula is non-linear. We will return to that.

---

## Comparing Three Junior-Safe Wrappers

To anchor your intuition, here are the three wrappers a junior could ship side by side.

### Wrapper A: `sync.Mutex` (simplest)

```go
type Mutexed struct {
	mu sync.Mutex
	f  *bloom.BloomFilter
}

func (m *Mutexed) Add(k []byte) { m.mu.Lock(); m.f.Add(k); m.mu.Unlock() }
func (m *Mutexed) Test(k []byte) bool {
	m.mu.Lock(); defer m.mu.Unlock(); return m.f.Test(k)
}
```

- Pros: dead simple, no read/write race.
- Cons: reads serialise. Every Test waits for every other Test.

### Wrapper B: `sync.RWMutex`

```go
type RWMutexed struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}

func (r *RWMutexed) Add(k []byte) { r.mu.Lock(); r.f.Add(k); r.mu.Unlock() }
func (r *RWMutexed) Test(k []byte) bool {
	r.mu.RLock(); defer r.mu.RUnlock(); return r.f.Test(k)
}
```

- Pros: parallel reads.
- Cons: writes still block reads; under heavy writes RWMutex performs worse than plain Mutex due to its own internal overhead.

### Wrapper C: Sharded

```go
// As above with 16 or 32 shards.
```

- Pros: scales with cores under mixed workloads.
- Cons: more code; APIs like `ApproximatedSize` and `Union` are harder to implement correctly.

Pick Wrapper B as your default. Move to C when profiling shows contention; never go straight to C without measurement.

---

## Diagrams & Visual Aids

### A 16-bit filter after three Adds

```
              0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
Empty:        .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
Add(apple):   .  .  X  .  .  .  .  X  .  .  .  .  .  X  .  .   (positions 2,7,13)
Add(pear):    .  X  X  .  .  .  .  X  .  .  .  .  .  X  X  .   (adds 1,7,14)
Add(plum):    X  X  X  .  X  .  .  X  .  .  .  .  .  X  X  .   (adds 0,4,7 — bit 7 shared)
```

### Why "maybe" is sometimes wrong

```
Test(grape) — hashes to positions 2, 7, 14
              0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
              X  X  X  .  X  .  .  X  .  .  .  .  .  X  X  .
                    ^              ^                    ^
                  set by         set by              set by
                  apple/plum     all three           pear
              -> answer "maybe", but grape was never added => false positive
```

### Saturation curve

```
FPR ↑
1.0 |                                              ___------
    |                                       ___---
    |                                ___---
0.5 |                          ___---
    |                    ___---
    |               ___--
0.1 |          ___--
    |     ___--
0.0 | ___-
    +---------------------------------------------------> n
        sized for n*                              2n*    3n*
```

A filter sized for `n*` items keeps p near its target until n approaches n*. Beyond it the curve steepens until p saturates near 1.

### The "Bloom-then-database" path

```
                ┌──────────────┐
   query ──▶    │ Bloom filter │ ── "no" ─────▶ respond "not found"
                └──────┬───────┘
                       │ "maybe"
                       ▼
                ┌──────────────┐
                │   database   │ ── true positive ──▶ respond with row
                └──────┬───────┘
                       │ false positive
                       ▼
                  respond "not found"
                  (extra DB round trip wasted)
```

A small `p` keeps the wasted-round-trip rate small; the filter eliminates 100% of the "no" cases.

### Double hashing visualised

```
key "alice" --FNV64a--> 0xA9F3...6F31
                          │
            ┌─────────────┴─────────────┐
            │                           │
          h1=0xA9F37ED7              h2=0xC9266F31
            │                           │
            v                           v
       pos_0 = h1            mod m
       pos_1 = h1 +     h2   mod m
       pos_2 = h1 + 2 * h2   mod m
       ...
       pos_{k-1} = h1 + (k-1) * h2 mod m
```

Two hash computations produce k positions. Modern Bloom filter libraries all use a variant of this.

### Word-and-bit layout in a `[]uint64`

```
bit index:  0  1  2  3  4 ...  63  64  65 ...  127  128 ...
word index: [---------- word 0 -----------][----- word 1 -----][-- word 2 --
mask for bit i: 1 << (i % 64)
word for bit i: bits[i / 64]
```

Set: `bits[i/64] |= 1 << (i%64)`. Test: `bits[i/64] & (1 << (i%64)) != 0`.

### A racy RMW on one word

```
Goroutine A wants to set bit 3.   Goroutine B wants to set bit 5.
Both touch word 0.

Time | A                            | B
-----|------------------------------|------------------------------
 t1  | tmp_a := word0      (0x00)   |
 t2  |                              | tmp_b := word0      (0x00)
 t3  | tmp_a |= 1<<3      (0x08)    |
 t4  |                              | tmp_b |= 1<<5      (0x20)
 t5  | word0 := tmp_a      (0x08)   |
 t6  |                              | word0 := tmp_b      (0x20)

Final word0 = 0x20.  Bit 3 was lost.  A's Add became a future false negative.
```

This is exactly the race that an RWMutex eliminates by serialising writes, and that atomic CAS (middle.md) eliminates by retrying the RMW.

### The Bloom-filter-protected cache hierarchy

```
              ┌──────────────────────────┐
              │  Bloom filter (in-RAM)   │
              └────────────┬─────────────┘
                           │ "maybe"
                           ▼
              ┌──────────────────────────┐
              │      LRU cache (RAM)     │
              └────────────┬─────────────┘
                           │ miss
                           ▼
              ┌──────────────────────────┐
              │    Redis (network RTT)   │
              └────────────┬─────────────┘
                           │ miss
                           ▼
              ┌──────────────────────────┐
              │     PostgreSQL (disk)    │
              └──────────────────────────┘
```

Each layer admits a small false-positive rate that costs the next layer's lookup. A 1% Bloom + 99% LRU hit + 1% network miss = 99.9999% of queries answered without touching Postgres.

### Saturation in three stages

```
fill = 0.50                                   fill = 0.85                                   fill = 0.99
0 1 0 0 1 0 1 0 0 1 0 1 1 0 0 1 1 0 1 0 0    1 1 0 1 1 1 0 1 1 1 0 1 1 1 1 1 0 1 1 1 1    1 1 1 1 1 1 0 1 1 1 1 1 1 1 1 1 1 1 1 1 1
FPR ≈ 0.01                                   FPR ≈ 0.20                                   FPR ≈ 0.85
```

A filter sized correctly hovers near the first picture. A filter run past its design lifetime drifts toward the third.

---

## Frequently Asked Questions

A short, junior-flavoured FAQ. These are real questions new engineers ask in code review.

### "Can I just use `map[string]struct{}`?"

For small sets, yes — a map of 10 000 strings is fine and gives exact answers. The Bloom filter wins when the set is large and you cannot afford the memory, or when negative lookups dominate and you want to short-circuit a slow source of truth.

### "Why use a Bloom filter when I have Redis?"

Redis is fast but it is not free: every lookup is a network round trip in the millisecond range. A Bloom filter is a memory read in the nanosecond range. Use them together: the filter rejects 99% of negatives without touching the network; Redis answers the rest.

### "How do I check if my filter is `nil`?"

`if f == nil`. The library does not guard against nil receivers. A panic on nil is your sign that initialisation order is wrong.

### "Can I share the bitset bytes between processes?"

Yes. `MarshalBinary` produces deterministic bytes; another process can `UnmarshalBinary` and use the filter. The only requirement is identical library versions (or compatible serialisation formats) on both sides.

### "Should I version my filter's bytes on disk?"

Yes. Prepend a one-byte version tag so future you can change the layout without breaking old files. The library does not do this for you.

### "What hash should I prefer?"

The library uses MurmurHash3 internally and you should let it. If you must implement your own filter, use `hash/maphash` (random seed per process; good distribution) or `cespare/xxhash` (fast, strong, deterministic). Avoid `hash/fnv` for production filters — it has weaker distribution on short inputs.

### "Is there a Bloom filter that lets me iterate added keys?"

No. The basic structure does not store keys. If you need iteration, store the keys separately (a `map[string]struct{}` or a database) and use the Bloom filter only as a fast negative cache in front.

### "What happens if I `Test` a key longer than the maximum hash input?"

There is no maximum. Hashes consume arbitrary byte streams. Memory cost of hashing is O(len(key)).

### "Does the library reuse goroutines internally?"

No. Add and Test are purely CPU-bound and stay on the calling goroutine. There is no background work.

### "Why is `BloomFilter.Cap()` not the original `n`?"

Because `Cap()` returns `m`, the bitset size, not the design capacity. There is no public method that returns the design n; if you need it, record it yourself at construction.

### "Why does `ApproximatedSize` return a smaller number than my actual inserts?"

When the filter is heavily loaded, the estimator's accuracy degrades. The Swamidass–Baldi formula is good for fills under 70%; beyond that the inversion becomes ill-conditioned.

### "What's a good default p?"

`0.01` (1%) is conventional. It gives ~9.6 bits/item and k = 7 — a balanced point. For pre-cache filters where slow-path cost is small, `0.05` saves space. For paranoid use cases like password breach checks, `0.0001` is normal.

### "Are filters serialisable across architectures?"

`bits-and-blooms/bloom/v3` writes its bits in little-endian, so big-endian readers get the same data. Field sizes are fixed. Cross-architecture round trips work in practice.

### "Can two filters with the same data be `Equal`?"

`f.Equal(g)` is bit-for-bit comparison of the bitsets *and* equal m and k. Two filters built from the same keys in the same order with the same parameters are Equal; built in different orders, also Equal (the structure is order-independent).

---

## Worked Example: Choosing Parameters for a URL Crawler

A junior is asked to build a Bloom filter for a crawler that will see roughly 1 billion URLs across one week. False positives mean "this URL is a duplicate, do not crawl" — so a false positive is a missed page. The team can tolerate up to one missed page per 10 000.

Step 1: pick `p = 0.0001`.
Step 2: pick `n = 1.2 * 10^9` (1.2 billion, a 20% safety margin).
Step 3: compute `m`.

```
m = -n * ln p / (ln 2)^2
  = -1.2e9 * (-9.21) / 0.4805
  ≈ 2.30e10 bits
  ≈ 2.87 GB
```

Step 4: compute `k`.

```
k = (m/n) * ln 2 = (2.30e10 / 1.2e9) * 0.6931 ≈ 13
```

Conclusion: a single in-RAM filter would cost 2.87 GB and require 13 hash positions per URL. If RAM is tight, you must either accept a higher `p`, partition the filter across multiple machines (each handling a hash range), or move to a scalable Bloom filter that grows incrementally.

For the same `p` with `n = 1e8`, the math gives `m ≈ 1.92 * 10^9` bits ≈ 240 MB. Big problems with low `p` and high `n` are *expensive*.

---

## Worked Example: A Per-Tenant Spam Filter

A multi-tenant SaaS uses Bloom filters to remember "URL was reported as spam in this tenant" so future emails containing the URL are flagged. Average tenant: 100 000 spam URLs. p = 0.001.

```
m = -1e5 * ln(0.001) / (ln 2)^2 ≈ 1.44 * 10^6 bits ≈ 180 KB
k ≈ 10
```

180 KB per tenant. 10 000 tenants = 1.8 GB total. Fits comfortably on a single server.

Concurrent access: each tenant has its own filter; one RWMutex per tenant works fine because intra-tenant traffic is low. Inter-tenant operations (cross-tenant search) are not common in this design.

---

## What Goes Wrong in the First Week

A junior shipping their first Bloom filter typically hits one of these issues:

1. **Saturation surprise.** They sized for the wrong `n`. Symptom: false-positive rate is double-digit. Fix: re-size and reload.
2. **Race condition that "doesn't show up."** They forgot to wrap with a mutex. Symptom: occasional false negatives that look like cache inconsistency. Fix: wrap with `sync.RWMutex`; run tests with `-race` in CI.
3. **Cold cache after deployment.** They restart the service and the filter is empty; for ten minutes every "no" is recomputed by the slow path. Fix: marshal at shutdown, unmarshal on boot.
4. **Wrong import path.** They `go get github.com/willf/bloom` and confuse the abandoned package with the active one. Fix: use `github.com/bits-and-blooms/bloom/v3` exclusively.
5. **Believing `TestAndAdd` is atomic across goroutines.** It is not. Fix: wrap with a mutex or use a dedicated atomic implementation.
6. **Treating false positives as bugs.** They open tickets when the filter says "maybe" and the slow path says "no." Fix: this is expected behaviour; budget for it.

Each of these has been written about in a postmortem somewhere on the internet. Stand on those shoulders.

---

## Performance Cheat Sheet by Filter Size

How long does a single Test take? An order-of-magnitude back-of-envelope on a recent Intel/AMD/ARM core:

| Filter size | Cache fit | Test latency (single key) |
| --- | --- | --- |
| 8 KB | L1 | ~30 ns |
| 256 KB | L2 | ~60 ns |
| 4 MB | L3 | ~150 ns |
| 64 MB | RAM | ~800 ns (~5 cache misses) |
| 1 GB | RAM | ~1 µs (~7 cache misses) |

The dominant cost at large sizes is **cache misses**, because the k positions are essentially random and each falls in a different cache line. Engineering tricks like "block Bloom filter" pack each key's bits into a single cache line at the cost of slightly worse FPR; we cover that in professional.md.

---

## Brief Tour of `willf/bloom` (Historical Note)

You will sometimes maintain code that imports `github.com/willf/bloom`. A few facts:

- The package was the original Go Bloom filter implementation.
- It uses the same algorithm and produces compatible serialisations to `bits-and-blooms/bloom/v3` (the fork was effectively a rename).
- The `willf/bloom` repo is archived; security and bug fixes go into the bits-and-blooms fork.
- Migration is a one-line import change in nearly all cases.

When in doubt, switch to `bits-and-blooms/bloom/v3` and run your existing tests.

---

## Two-Line Pop Quizzes

Quick reflexes. Answers right after.

1. Adding 200 items to a filter sized for 100. Expected FPR?
2. Calling `f.Add(nil)` — legal?
3. Two goroutines call `f.Add(k)` simultaneously without a lock. Effect?
4. `bloom.NewWithEstimates(0, 0.01)` — what happens?
5. `f := &bloom.BloomFilter{}` — usable?

Answers.

1. Roughly 50–70% — saturation is in full swing.
2. Yes. The hash of an empty input is well-defined and the filter sets bits at those positions.
3. Race condition; possible lost bit, leading to a future false negative.
4. The library panics. n must be positive.
5. No. The bitset is nil; the first Add or Test will panic. Use `bloom.New` or `bloom.NewWithEstimates`.

---

## A Final Walkthrough: From `nil` to Production

We end this file with the lifecycle of a single filter from boot to shutdown.

1. **Boot.** Service starts. We attempt to `os.ReadFile("filter.bin")`. If present, `UnmarshalBinary`. If absent or corrupt, build a fresh one with `NewWithEstimates(n, p)` and pre-populate from the source of truth.
2. **Warmup.** A background goroutine runs `MeasureFPR` against a sampled stream of negatives for 30 seconds. The result is logged. If the rate is more than 2x the target, an alert fires.
3. **Steady state.** Each request hits `Test`. False answers short-circuit. True answers hit the slow path. Metrics record both branches.
4. **Hourly housekeeping.** A goroutine writes the current filter to `filter.bin.tmp` and atomically renames it. If the size has crept up so that p is climbing, the goroutine triggers a rebuild: new filter, populate from source of truth, swap atomically.
5. **Shutdown.** A `SIGTERM` handler flushes the latest filter to disk. The next boot picks up where we left off.

That is the entire production lifecycle. Everything in middle.md and beyond is making each step cheaper, faster, and more correct.

---

## Building Intuition Through Variation

The single best way to internalise the Bloom filter is to vary the parameters and observe. Below is a script that tabulates observed FPR across a grid of `n`, `m`, and `k`.

```go
package main

import (
	"fmt"
	"math/rand"

	"github.com/bits-and-blooms/bloom/v3"
)

func observed(n, m, k uint, probes int) float64 {
	f := bloom.New(m, k)
	for i := uint(0); i < n; i++ {
		var buf [8]byte
		rand.Read(buf[:])
		f.Add(buf[:])
	}
	fp := 0
	for i := 0; i < probes; i++ {
		var buf [8]byte
		rand.Read(buf[:])
		if f.Test(buf[:]) {
			fp++
		}
	}
	return float64(fp) / float64(probes)
}

func main() {
	fmt.Printf("%-8s %-10s %-4s %-10s\n", "n", "m", "k", "observed_fpr")
	for _, n := range []uint{1000, 10_000, 100_000} {
		for _, m := range []uint{8 * n, 16 * n, 32 * n} {
			for _, k := range []uint{3, 7, 13} {
				p := observed(n, m, k, 50_000)
				fmt.Printf("%-8d %-10d %-4d %-10.4f\n", n, m, k, p)
			}
		}
	}
}
```

Run it. Observe:

- At `m/n = 8`, doubling `k` from 3 to 7 lowers FPR.
- At `m/n = 32`, going from `k = 7` to `k = 13` *raises* FPR — you have overpassed the optimum.
- For each `n`, the FPR you see at the optimum `k` matches the theoretical curve within statistical noise.

Two hours with this script teaches more than two days with the math.

---

## Recommended Reading Order Within This Topic

Now that you have the basics, here is how to progress:

1. **junior.md** (this file) — what, why, single-goroutine use, RWMutex wrapper.
2. **middle.md** — sharing across goroutines: atomic bitset, sharding, counting Bloom filters, observability.
3. **senior.md** — architecture: partitioned Bloom, scalable Bloom (SBF), Cuckoo filter, hash selection, integrating with LSM-trees.
4. **professional.md** — internals: false-positive math derivation, double hashing analysis, cache-line packing, lock-free designs with `atomic.Uint64`, NUMA, production failure modes.
5. **specification.md** — formal definitions, library API contracts.
6. **interview.md** — questions from junior to staff.
7. **tasks.md** — hands-on exercises.
8. **find-bug.md** — debugging exercises.
9. **optimize.md** — performance exercises.

The path is intentional: each file builds on the previous and avoids hand-waving by deferring open questions to the next level.

---

## A Note on `sync.Once` for One-Time Construction

If your filter is built lazily, use `sync.Once`:

```go
type LazyFilter struct {
	once sync.Once
	f    *bloom.BloomFilter
	mu   sync.RWMutex
}

func (l *LazyFilter) ensure() {
	l.once.Do(func() {
		l.f = bloom.NewWithEstimates(1_000_000, 0.01)
	})
}

func (l *LazyFilter) Add(k []byte) {
	l.ensure()
	l.mu.Lock()
	l.f.Add(k)
	l.mu.Unlock()
}

func (l *LazyFilter) Test(k []byte) bool {
	l.ensure()
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.f.Test(k)
}
```

`sync.Once` guarantees the filter is constructed exactly once even under racing first calls. Without it, two goroutines could both call `NewWithEstimates` and one would lose its filter (and any Adds it absorbed before the lose).

---

## When *Not* to Use a Bloom Filter

A junior should also know when to *not* reach for one.

- **You have fewer than a thousand items.** `map[string]struct{}` is faster, simpler, and gives exact answers.
- **You need to enumerate the items.** A Bloom filter cannot return them.
- **False positives are catastrophically costly.** For example, "is this user a paying customer?" — a false positive grants free service. Use an exact check.
- **You need TTL per item.** Bloom filters cannot expire individual entries.
- **You need to delete a specific key.** Use a counting Bloom filter (middle.md) or a Cuckoo filter (senior.md).
- **You need partial-match queries.** Bloom filters answer exact-membership only.

When you do reach for one, the value proposition is unambiguous: dramatic memory savings, constant-time access, no false negatives, at the cost of a measurable false-positive rate.

---

## Final Checklist Before Shipping Your First Filter

- [ ] You chose `n` for *peak expected* items with a safety margin.
- [ ] You chose `p` deliberately, knowing what a false positive costs.
- [ ] You used `NewWithEstimates(n, p)` and not hand-picked `m`, `k`.
- [ ] You wrapped the filter with at least `sync.RWMutex`.
- [ ] You ran your tests with `go test -race`.
- [ ] You log or expose the observed FPR.
- [ ] You snapshot at shutdown and restore on boot.
- [ ] You have a documented rebuild path for when the filter saturates.
- [ ] You used `github.com/bits-and-blooms/bloom/v3`, not the archived `willf/bloom`.
- [ ] You know what your slow path costs.

When all ten check, you have shipped a junior-level Bloom filter that will not embarrass anyone in code review.

---

## Extended Case Study: Caching Read-Through for a User Service

This case study expands the earlier "Bloom-then-database" recipe into a fully wired component. The goal is a single Go package you can drop into a service.

### Requirements

- The service answers `GetUser(id string) (User, bool, error)`.
- The underlying database (Postgres) supports `SELECT * FROM users WHERE id = $1` with median latency 8 ms and p99 of 60 ms.
- 30% of `GetUser` queries are for IDs that do not exist (web crawlers, expired sessions, broken clients).
- The team can tolerate ~1 in 1000 false positives — i.e. a stale "maybe present" hits the database for a key that does not exist.

### Package skeleton

```go
package userservice

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bits-and-blooms/bloom/v3"
)

type User struct {
	ID    string
	Email string
}

type Store interface {
	GetUser(ctx context.Context, id string) (User, error)
	AllUserIDs(ctx context.Context) ([]string, error)
}

type Service struct {
	store Store

	mu     sync.RWMutex
	filter *bloom.BloomFilter

	hits    int64
	misses  int64
	fpHits  int64 // filter said maybe, store said not found
}

const (
	expectedUsers      = 5_000_000
	targetFalsePositive = 0.001
)

func New(ctx context.Context, store Store) (*Service, error) {
	f := bloom.NewWithEstimates(expectedUsers, targetFalsePositive)
	ids, err := store.AllUserIDs(ctx)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		f.AddString(id)
	}
	return &Service{store: store, filter: f}, nil
}

func (s *Service) GetUser(ctx context.Context, id string) (User, bool, error) {
	s.mu.RLock()
	mayExist := s.filter.TestString(id)
	s.mu.RUnlock()
	if !mayExist {
		atomic.AddInt64(&s.misses, 1)
		return User{}, false, nil
	}
	atomic.AddInt64(&s.hits, 1)
	u, err := s.store.GetUser(ctx, id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		atomic.AddInt64(&s.fpHits, 1)
		return User{}, false, nil
	case err != nil:
		return User{}, false, err
	}
	return u, true, nil
}

func (s *Service) Register(ctx context.Context, u User) error {
	if _, err := s.store.GetUser(ctx, u.ID); err == nil {
		return errors.New("user exists")
	}
	// Persist first; filter is a cache and must lag truth.
	if err := s.persistRegistration(ctx, u); err != nil {
		return err
	}
	s.mu.Lock()
	s.filter.AddString(u.ID)
	s.mu.Unlock()
	return nil
}

func (s *Service) persistRegistration(ctx context.Context, u User) error {
	// SQL INSERT omitted for brevity.
	_ = ctx
	_ = u
	return nil
}

func (s *Service) FalsePositiveRate() float64 {
	hits := atomic.LoadInt64(&s.hits)
	fp := atomic.LoadInt64(&s.fpHits)
	if hits == 0 {
		return 0
	}
	return float64(fp) / float64(hits)
}

func (s *Service) Stats() (hits, misses, fpHits int64) {
	return atomic.LoadInt64(&s.hits),
		atomic.LoadInt64(&s.misses),
		atomic.LoadInt64(&s.fpHits)
}
```

### Bootstrapping order

The order matters. We construct the filter, then pull *all* IDs from the store. This is acceptable only if `AllUserIDs` is paginated and cheap; for large user sets you would stream IDs and Add them as they arrive. Either way, the rule is "filter must contain every existing key before `GetUser` is allowed to run." Otherwise the filter will produce false negatives, defeating its no-false-negative guarantee.

### Registration ordering

Registration writes to the store *first* and updates the filter *second*. The reverse order would create a window where the filter says "yes" but the store does not yet contain the user — a stale "maybe" that turns into a 404 on the very next `GetUser`. Since the filter is the optimistic side of a probabilistic system, it should never be ahead of truth.

### Periodic refresh

If users can be deleted, the filter accumulates "ghost" bits for keys that no longer exist. Every Test for a deleted user returns "maybe" forever, paying the database cost. Solution: rebuild the filter periodically.

```go
func (s *Service) StartRebuild(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				ids, err := s.store.AllUserIDs(ctx)
				if err != nil {
					continue
				}
				fresh := bloom.NewWithEstimates(expectedUsers, targetFalsePositive)
				for _, id := range ids {
					fresh.AddString(id)
				}
				s.mu.Lock()
				s.filter = fresh
				s.mu.Unlock()
			}
		}
	}()
}
```

The swap is atomic from the readers' perspective: an RLock that started before the swap reads the old filter; one that starts after reads the new. No race.

### Why rebuild rather than delete?

Because the basic Bloom filter cannot delete individual keys. Even a counting Bloom filter would only let you decrement a counter that you incremented yourself — and we never tracked who added which bits. Rebuild from authoritative state is the simplest cure.

### Metrics

```go
import "github.com/prometheus/client_golang/prometheus"

var (
	gaugeFPR = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "user_filter_observed_fpr",
		Help: "Observed false-positive rate of the user-existence Bloom filter.",
	})
	counterFilterMisses = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "user_filter_misses_total",
		Help: "Negative answers returned from the filter without touching the database.",
	})
)

func (s *Service) ExposeMetrics() {
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for range t.C {
			gaugeFPR.Set(s.FalsePositiveRate())
			counterFilterMisses.Add(float64(atomic.LoadInt64(&s.misses)))
		}
	}()
}
```

These metrics are the difference between "we have a Bloom filter" and "we operate a Bloom filter." Without them you cannot tell when the filter is failing you.

---

## Extended Case Study: Deduplicating Webhook Deliveries

A webhook receiver gets the same event ID several times if upstream retries. We want to process each event exactly once.

### Naive solution: `map[string]struct{}`

```go
var seen sync.Map
func handle(id string, body []byte) {
	if _, loaded := seen.LoadOrStore(id, struct{}{}); loaded {
		return
	}
	process(body)
}
```

This works for low volumes. At a million events per hour the map grows unboundedly: every ID is retained forever.

### Bloom-filter solution

```go
type Dedup struct {
	mu   sync.RWMutex
	cur  *bloom.BloomFilter
	prev *bloom.BloomFilter
}

func NewDedup(eventsPerHour uint, fpr float64) *Dedup {
	d := &Dedup{
		cur:  bloom.NewWithEstimates(eventsPerHour, fpr),
		prev: bloom.NewWithEstimates(eventsPerHour, fpr),
	}
	go d.rotateLoop()
	return d
}

func (d *Dedup) rotateLoop() {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for range t.C {
		d.mu.Lock()
		d.prev = d.cur
		d.cur = bloom.NewWithEstimates(1_000_000, 0.001)
		d.mu.Unlock()
	}
}

func (d *Dedup) Seen(id string) bool {
	d.mu.RLock()
	seen := d.cur.TestString(id) || d.prev.TestString(id)
	d.mu.RUnlock()
	if seen {
		return true
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.cur.TestString(id) {
		return true
	}
	d.cur.AddString(id)
	return false
}
```

Two filters provide a sliding two-hour window: events within the last hour land in `cur`; the previous hour lives in `prev`. After rotation, last hour's `cur` becomes `prev` and a fresh `cur` is born. Bounded memory; sliding window; constant-time operations.

False positives here mean *legitimate events get dropped*. With `fpr = 0.001`, one in a thousand new events is mistakenly treated as a duplicate. If even that is too high for your business, this technique is the wrong choice — you need exact dedup backed by Redis or a database.

### Why two filters and not one with rotation?

A single filter rotated at the hour boundary has a sharp edge: an event ID that arrives at 12:59:59 is forgotten at 13:00:00. The two-filter design extends the window to "at least one hour, at most two hours" of memory, so events at the boundary still benefit.

---

## Extended Case Study: Bloom-Filter-Backed Rate Limiter

A bizarre but illustrative application: use a Bloom filter to remember "this user already received an SMS today, do not send again." The downside of false positives is "a real user is missed today" — acceptable for a marketing campaign, unacceptable for 2FA codes.

```go
type DailySMSLimiter struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}

func NewDailySMSLimiter(usersPerDay uint) *DailySMSLimiter {
	return &DailySMSLimiter{
		f: bloom.NewWithEstimates(usersPerDay, 0.0001),
	}
}

func (l *DailySMSLimiter) ShouldSend(userID string) bool {
	l.mu.RLock()
	already := l.f.TestString(userID)
	l.mu.RUnlock()
	if already {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f.TestString(userID) {
		return false
	}
	l.f.AddString(userID)
	return true
}

func (l *DailySMSLimiter) Reset() {
	l.mu.Lock()
	l.f.ClearAll()
	l.mu.Unlock()
}
```

A cron `Reset` at midnight clears the filter for the next day. The double-check after lock upgrade ensures only one goroutine returns `true` for any given userID in a day, even when many requests arrive simultaneously.

This pattern is used in production by ad-targeting and marketing-automation platforms where exact uniqueness is not required but a low duplicate rate matters.

---

## A Day in the Life of a Bit

Pick bit position 42 in our hand-rolled filter. Its story:

- **08:00.** Boot. The bitset is zeroed; bit 42 is 0.
- **08:13.** A goroutine Adds key "alice"; double hashing computes positions 9, 42, 71. Bit 42 becomes 1.
- **08:13.001.** Another goroutine concurrently Adds key "anonymous-7". Its positions happen to include 42. Bit 42 stays 1 (idempotent).
- **08:14.** A goroutine Tests "bob". Positions 12, 42, 100. Bit 12 is 0, so Test returns false without even looking at 42.
- **08:15.** A goroutine Tests "alice". All three positions are 1. Returns true. Slow path confirms.
- **08:16.** A goroutine Tests "ghost". Positions 9, 42, 71 — coincidentally the same as "alice". Returns true. Slow path returns "no." That is a false positive; bit 42 contributed.
- **09:00.** A rebuild happens. A new bitset is allocated; bit 42 is fresh-zero. The cycle restarts.

Bit 42 contributed to one true positive ("alice"), one false positive ("ghost"), and zero false negatives. That ratio is the soul of the Bloom filter.

---

## Five Idioms to Memorise

These five small Go snippets, learned by heart, cover 90% of junior usage.

### Idiom 1: Construct from estimates

```go
f := bloom.NewWithEstimates(uint(expectedItems), targetFPR)
```

### Idiom 2: Wrap with RWMutex

```go
type SafeFilter struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}
```

### Idiom 3: Lock-upgrade with double-check

```go
mu.RLock()
seen := f.TestString(k)
mu.RUnlock()
if seen { return true }
mu.Lock()
defer mu.Unlock()
if f.TestString(k) { return true }
f.AddString(k)
return false
```

### Idiom 4: Snapshot and restore

```go
data, _ := f.MarshalBinary()
_ = os.WriteFile(path, data, 0o600)

// later
data, _ := os.ReadFile(path)
g := &bloom.BloomFilter{}
_ = g.UnmarshalBinary(data)
```

### Idiom 5: Atomic swap-rebuild

```go
fresh := bloom.NewWithEstimates(n, p)
populate(fresh)
mu.Lock()
f = fresh
mu.Unlock()
```

Type these out a few times; they will be muscle memory by the end of middle.md.

---

## A Tiny Benchmark

Set up a microbenchmark to see how fast a Test really is on your machine.

```go
package main

import (
	"fmt"
	"testing"

	"github.com/bits-and-blooms/bloom/v3"
)

func BenchmarkTestHit(b *testing.B) {
	f := bloom.NewWithEstimates(1_000_000, 0.01)
	for i := 0; i < 1_000_000; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
	}
	probes := make([][]byte, 1024)
	for i := range probes {
		probes[i] = []byte(fmt.Sprintf("k%d", i))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		f.Test(probes[i%len(probes)])
	}
}

func BenchmarkTestMiss(b *testing.B) {
	f := bloom.NewWithEstimates(1_000_000, 0.01)
	for i := 0; i < 1_000_000; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
	}
	probes := make([][]byte, 1024)
	for i := range probes {
		probes[i] = []byte(fmt.Sprintf("z%d", i))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		f.Test(probes[i%len(probes)])
	}
}
```

Run with `go test -bench=. -benchmem`. On a recent laptop expect ~150–500 ns per Test, with no allocations. The miss case is often slightly faster because it short-circuits on the first 0-bit.

Now wrap with `sync.RWMutex` and measure again. The wrapper adds ~30 ns per call from the mutex itself (no contention). Under concurrent benchmark (`b.RunParallel`), watch the cost rise sharply once you contend.

---

## Reading the Source

If you want to read the library source after junior.md, the relevant files are:

- `bits-and-blooms/bloom/v3/bloom.go` — `BloomFilter` type, `New`, `NewWithEstimates`, `Add`, `Test`, `TestAndAdd`, `TestOrAdd`, `Union`, `Intersect`.
- `bits-and-blooms/bloom/v3/baseHashes.go` — hashing logic. Two MurmurHash3 derivations produce `h1`, `h2`, `h3`, `h4` and a 4-way combination yields k positions.
- `bits-and-blooms/bloom/v3/baseHashes_native.go` — assembly-optimised paths on some architectures.
- `bits-and-blooms/bitset/bitset.go` — the bitset implementation, set/clear/test/count.

The whole thing is under 1 000 lines. Worth a slow read once you have written your own.

---

## A Closing Mental Model: "Compressed Set"

Think of a Bloom filter as a *lossy compression* of a set. The compressed representation is small but cannot perfectly reconstruct the original. A query on the compressed form gives an approximate answer with a known error rate.

That framing is helpful when you generalise: Bloom filters are not the only compressed-set design. Counting Bloom filters compress multisets with deletion. Cuckoo filters compress with deletion *and* better space efficiency. HyperLogLog compresses cardinality (a count, not a membership query). MinHash compresses similarity. They all share the same trade-off shape: small memory, fast operations, approximate answers, no false negatives for the operation they support.

Once you internalise that, you reach for the right structure with confidence — not just Bloom, but the right Bloom-family member for the job.

---

## Hands-On Exercise: Reproduce the Saturation Curve

Time-boxed (30 minutes) closing exercise.

1. Construct `bloom.New(1024, 7)`.
2. In a loop, Add a fresh key (e.g. `fmt.Sprintf("k%d", i)`). After every 16 Adds, measure FPR by Testing 10 000 fresh negatives.
3. Print `n, fillFraction, observedFPR` per measurement.
4. Plot the three columns (or `gnuplot` them) — y vs n.
5. Observe the curve: nearly flat early, sharp climb past the design n, asymptotic toward 1.

Compare your plot to the theoretical curve `p(n) = (1 - exp(-k*n/m))^k`. They should match within statistical noise.

If they do, congratulations: you have *verified* the central formula of Bloom filters with your own keystrokes. That is the bar at junior level.

---

## Going Forward

You now have:

- A working mental model of the bit array, hash positions, Add, Test, false positives, no false negatives.
- A hand-rolled implementation you wrote yourself.
- A library implementation you can use with confidence.
- A safe concurrent wrapper.
- Sizing intuition and the back-of-envelope rules.
- An idea of why concurrency makes everything harder.
- A roadmap of what to study next.

Middle.md picks up exactly where this stops: how to share the filter across thousands of goroutines without serialising every operation through one mutex, how to add deletion via counting, and how to observe a filter in production with metrics and alerts. The mental model you built here is the foundation; nothing in the higher levels invalidates it, only refines it.

---

## Appendix A: Worked Math for `p = (1 - e^(-kn/m))^k`

A short derivation suitable for a junior who has not seen probability arguments like this before.

Imagine you have an m-bit array, all zeros. You add a single key. It hashes to k positions. Each position is uniformly distributed in `[0, m)` and independent of the others.

After adding *one* key, the probability that a specific bit `j` is still zero is:

```
P(bit j is 0 after 1 add) = (1 - 1/m)^k
```

Why? Because k positions were chosen uniformly; for each choice the probability of *not* hitting bit j is `(1 - 1/m)`.

After adding *n* keys, the same argument gives:

```
P(bit j is 0 after n adds) = (1 - 1/m)^(kn)
```

For large m this is approximately:

```
(1 - 1/m)^(kn) ≈ e^(-kn/m)
```

So the probability that bit j is *set* is approximately:

```
1 - e^(-kn/m)
```

Now consider a query for a key that was *not* added. It hashes to k positions. The probability that *each* of those positions is set (a false positive) is approximately:

```
(1 - e^(-kn/m))^k
```

That is the false-positive rate formula. The derivation assumes:

- The hash function is uniform (or close enough).
- The k positions per key are independent (true in expectation for double hashing on large m).
- m is large enough that `(1 - 1/m)^(kn) ≈ e^(-kn/m)`.

You can find more rigorous treatments in Mitzenmacher's textbook, but this is the intuition every Bloom-filter user must carry.

### Optimum k

Take the derivative of `p` with respect to k and set to zero. After algebra:

```
k_opt = (m/n) ln 2
```

At `k_opt`, the value of `p` reduces to:

```
p_min = (1/2)^k_opt
```

so the bit array is precisely half-full at the optimum — exactly what a good hash function should do.

### Bits per item

Substituting `k_opt` into the FPR formula and solving for `m/n`:

```
m/n = -ln(p) / (ln 2)^2 ≈ 1.44 * log2(1/p)
```

For p = 0.01: `m/n ≈ 9.58`, i.e. **9.6 bits per item**.
For p = 0.001: `m/n ≈ 14.38`.
For p = 0.0001: `m/n ≈ 19.17`.

Every order-of-magnitude reduction in p adds about 4.8 bits per item.

---

## Appendix B: Why `bits-and-blooms/bloom/v3` Picks MurmurHash3

The library could in principle use any hash. The choice of MurmurHash3 is driven by:

- **Speed.** ~3 GB/s on a modern x86 core, ~1 ns per 8-byte key.
- **Distribution quality.** Passes the SMHasher test suite. Few clustering issues.
- **64-bit output, conveniently splittable into two 32-bit halves** for double hashing.
- **No external state.** Pure function of input bytes, no allocations.
- **Mature, widely used.** Same hash you find in many databases (Cassandra, Bigtable).

The trade-off is that MurmurHash3 is *not* cryptographically secure. An adversary who can choose keys can craft them to collide on the same bits, driving up the FPR for those keys. If your inputs are adversarial (user-uploaded content, untrusted webhooks), middle.md and senior.md discuss seeded and keyed alternatives.

For most server-side workloads, MurmurHash3 is the right call.

---

## Appendix C: The Single Most Common Junior Bug

Of all the junior-level Bloom-filter bugs the author has reviewed, the most common is this:

```go
func (s *Service) Lookup(id string) (bool, error) {
	if !s.filter.Test([]byte(id)) {
		return false, nil
	}
	return s.db.Exists(id)
}

func (s *Service) Register(id string) error {
	s.filter.Add([]byte(id))      // <-- filter updated FIRST
	return s.db.Insert(id)         // <-- db updated SECOND
}
```

The bug: between `filter.Add` and `db.Insert`, a concurrent `Lookup(id)` will see "yes" from the filter, then call `db.Exists(id)`, which returns false. The caller observes a phantom positive — a user that "exists" for a moment then vanishes. Worse, if `db.Insert` errors, the filter is permanently polluted with a key the DB never accepted.

Fix: update the slow source of truth first, then the fast cache. This is the **cache-aside** ordering rule. It applies to every cache, not just Bloom filters.

```go
func (s *Service) Register(id string) error {
	if err := s.db.Insert(id); err != nil {
		return err
	}
	s.filter.Add([]byte(id))
	return nil
}
```

A small change; a large class of incidents avoided.

---

## Appendix D: A Tiny Glossary of Adjacent Probabilistic Structures

Knowing the neighbours helps you pick the right tool.

| Structure | Question answered | Memory | Notes |
| --- | --- | --- | --- |
| **Bloom filter** | Is x in the set? | `1.44 log2(1/p)` bits/item | Today's topic. |
| **Counting Bloom filter** | Is x in the set? Delete x. | 4–8x the Bloom filter | Middle.md. |
| **Cuckoo filter** | Is x in the set? Delete x. | Slightly less than Bloom at p ≥ 0.001 | Senior.md. |
| **Quotient filter** | Is x in the set? Delete x. Iterate. | Similar to Cuckoo | Less common in Go. |
| **HyperLogLog** | How many *distinct* xs are in the stream? | ~12 KB for ±1% | `axiomhq/hyperloglog` for Go. |
| **Count–Min Sketch** | How many times has x appeared? | O(width * depth) | Frequency estimation. |
| **MinHash** | How similar are two sets? | O(k) hashes | Jaccard similarity. |
| **t-digest** | What are the quantiles of a stream? | ~5 KB | Latency percentiles. |

You may meet several of these in the same service. Bloom filter is the most common starting point.

---

## Appendix E: Sanity Checks Before Code Review

A checklist you can apply to your own (or a colleague's) PR that adds a Bloom filter.

- [ ] The expected `n` is documented near the constructor, with reasoning.
- [ ] The chosen `p` is documented and justified relative to the slow-path cost.
- [ ] Construction uses `NewWithEstimates(n, p)`.
- [ ] Concurrent access is wrapped (Mutex, RWMutex, sharded, or atomic).
- [ ] `go test -race` passes for any test that touches the filter from multiple goroutines.
- [ ] The filter's observed FPR is logged or exposed as a metric.
- [ ] Snapshot/restore (if required by cold-start sensitivity) is implemented and tested.
- [ ] A rebuild path is documented for when the filter saturates.
- [ ] No code path treats `Test` returning `true` as definitive — it is always followed by a slow-path check.
- [ ] Slow-path checks update the filter or the source of truth in the correct order (truth before cache).

If any item is missing, return the PR for changes. Defense in depth at code-review time prevents incident-driven learning later.

---

## Appendix F: A Sample Production Incident

A real incident retold. A team launched a feature using a Bloom filter sized for 10 million users. Six weeks later they crossed 25 million users; nobody had alerted on the filter's observed FPR; query latencies began creeping up because every "negative" query was paying the database round trip. The on-call engineer noticed during a routine review that the filter was nearly full.

The fix took an hour:

1. Build a fresh filter sized for 100 million users (10x headroom).
2. Populate it from the source of truth.
3. Atomically swap.

Latency returned to baseline immediately. The post-mortem actions:

- Add a Prometheus alert for `user_filter_observed_fpr > 0.05`.
- Add a rebuild-on-threshold mechanism that triggers when fill exceeds 70%.
- Add the filter's `n` as a deployment-time configuration value, not a constant.

Three small process changes; the incident class disappeared.

You will eventually own a filter that someone else sized two years ago for an `n` that no longer reflects reality. The lesson: **alerts on observed FPR are not optional.**

---

## Appendix G: A Smaller, Deeper Lesson — Hash Independence

The math derivation in Appendix A assumes the k positions per key are *independent*. With true k independent hash functions this is exactly true. With double hashing (`h1 + i*h2`), it is approximately true and the empirical FPR matches the formula within statistical noise for typical sizes.

But there is a degenerate case: when `h2 mod m == 0`, all k positions collapse to `h1`. You wrote one bit when you intended to write k. Future Tests for this key need only check that single bit — almost always set after enough Adds — and almost every probe through this key reports "maybe."

Production hash families avoid this by ensuring `h2` is non-zero. The library does so. Hand-rolled implementations sometimes forget. If your hand-rolled filter has surprisingly bad FPR, examine your `h2` distribution first.

A safe formulation:

```go
func (b *Bloom) hashes(key []byte) (uint64, uint64) {
	h := fnv.New64a()
	h.Write(key)
	x := h.Sum64()
	h2 := x>>32 | x<<32
	if h2 == 0 {
		h2 = 1
	}
	return x, h2
}
```

That one-line guard removes a class of pathological inputs. The library does the equivalent internally.

---

## Appendix H: Reading Order If You Are in a Hurry

If you have one hour to be useful tomorrow morning:

- Read [Introduction](#introduction), [Core Concepts](#core-concepts), [Your First Bloom Filter](#your-first-bloom-filter), [Using `bits-and-blooms/bloom/v3`](#using-bits-and-bloomsbloomv3), [Concurrent Use: First Look](#concurrent-use-first-look), and [Cheat Sheet](#cheat-sheet).
- Skip the worked examples and appendices on the first pass.
- Type out Idiom 1 and Idiom 2 from memory.
- Ship a `sync.RWMutex`-wrapped filter behind a method.

Come back for the rest after lunch. The hour above gets you something correct in production; the rest of the file gets you something *good* in production.

---

## Appendix I: The Bloom Filter as a Teaching Tool

A Bloom filter is one of the smallest data structures that meaningfully blends three concepts:

- **Hashing** as a primitive for placement.
- **Probability** as the reason approximate answers are useful.
- **Concurrency** as the reason naive implementations break.

If you build a Bloom filter from scratch, you have practised all three. If you ship one, you have managed observability, sizing, and incident response. Few junior-level projects pack as much engineering into so few lines of code. Treat this exercise as one of the highest-leverage ways to grow your engineering toolkit early in your career.

---

## Appendix J: When Junior Becomes Middle

You are ready for middle.md when you can answer these questions without rereading this file:

1. What does a Bloom filter return, and which return values are exact?
2. Given n and p, how do you pick m and k?
3. Why is the library not concurrent-safe?
4. Which mutex variant would you pick for a read-heavy workload?
5. Why must the source of truth be updated before the filter?
6. What is a counting Bloom filter and when do you need one?
7. What happens to FPR as the filter is over-filled?
8. How do you measure observed FPR in production?
9. What does `TestAndAdd` do that is different from `TestOrAdd`?
10. What is the right serialisation strategy for cold-start avoidance?

If those answers feel solid, turn the page.

---

## Appendix K: A Self-Contained Mini Project

If you have an evening, try this end-to-end:

1. Write a CLI tool `bloomtool` with these subcommands:
   - `bloomtool build --in users.csv --out users.bloom --n 1000000 --p 0.001`
   - `bloomtool query --filter users.bloom --key alice`
   - `bloomtool stats --filter users.bloom`
   - `bloomtool union --in a.bloom --in b.bloom --out merged.bloom`

2. Use `bits-and-blooms/bloom/v3` everywhere; do not roll your own.

3. Add tests for build, query (hit and miss), stats parsing, and union.

4. Add a `--concurrent` flag to the build subcommand that spawns N goroutines each reading a slice of the CSV. Wrap the filter with `sync.RWMutex` and verify it works under `-race`.

5. Add a `--shards N` flag that switches to a 16-shard or 32-shard wrapper. Measure throughput against the single-mutex version using `time`.

6. Write a short README that documents the chosen `n`, `p`, and the trade-offs.

This project hits every junior topic in this file: construction, serialisation, query, stats, set operations, concurrency, sharding. By the time you finish it, the cheat sheet is no longer a cheat sheet — it is your knowledge.

---

## Appendix L: A Look at What's Coming in Middle

To whet your appetite, middle.md covers:

- **Atomic bitsets.** Replace `bits[i] |= mask` with `atomic.OrUint64(&bits[i], mask)` (Go 1.19+) or CAS loops in older runtimes. Lock-free Adds; lock-free Tests; correct under arbitrary concurrency.
- **Sharded designs in depth.** How many shards is right? When does false sharing hurt?
- **Counting Bloom filters.** Replace bits with 4-bit counters; support Delete. Math for required counter width vs n.
- **Observability.** Prometheus metrics, alert thresholds, fill-fraction calibration, rolling FPR window.
- **Production rotation.** Sliding two-window deduplication, atomic swap, snapshot+restore.

If you finish junior.md you are ready for all of it.

---

## Appendix M: A Look at What's Coming in Senior

And senior.md covers:

- **Partitioned Bloom filters.** Each hash function gets its own m/k-bit region; cleaner math, sometimes better cache behaviour.
- **Scalable Bloom filters.** A chain of filters, each with tightening false-positive rate, allowing unbounded growth without re-sizing.
- **Cuckoo filters.** A different probabilistic set with native delete, often less memory at the same p.
- **Hash family selection.** When is MurmurHash3 enough? When do you need xxhash? When do you need a keyed hash?
- **Integration with caches and LSM-trees.** How RocksDB and Cassandra use per-SSTable Bloom filters.

By that level, you will be architecting the *system* around the filter, not just using one.

---

## Appendix N: A Look at What's Coming in Professional

Professional.md goes deep on:

- **False-positive math from first principles.** Independent vs dependent hashes, tight error bounds.
- **Cache-line packing.** Block Bloom filters (Apache Impala) trade slightly higher FPR for 1 cache miss per Test.
- **Lock-free designs with `atomic.Uint64`.** Memory ordering, CAS-vs-OR, when each wins.
- **NUMA effects.** Cross-socket cache coherence costs, replicated filters per NUMA node.
- **Production failure modes.** Long tails in Test latency, GC interaction, page-fault tails.

If you make it to professional.md, you will read Impala/CockroachDB/RocksDB code and recognise the patterns.

---

## End of Junior

Skim back through the Table of Contents one more time. Each entry should now correspond to something concrete you understand or can do. If any entry is still hazy, jump back to that section — the file is dense but every section is self-contained enough to re-read in isolation.

When you are confident, move to middle.md.
