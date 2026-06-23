# Concurrent Bloom Filter — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definitions](#formal-definitions)
3. [False-Positive Rate Formula](#false-positive-rate-formula)
4. [Optimum k and Memory Bounds](#optimum-k-and-memory-bounds)
5. [The `bits-and-blooms/bloom/v3` API Contract](#the-bits-and-bloomsbloomv3-api-contract)
6. [The Go Memory Model in Concurrent Bloom Use](#the-go-memory-model-in-concurrent-bloom-use)
7. [Variant Specifications](#variant-specifications)
8. [Wire Format](#wire-format)
9. [References](#references)

---

## Introduction

This file collects the formal, normative specifications that govern Bloom filters and their concurrent use in Go. Where the other files in this subsection teach, this file states.

Three sources are normative:

- **The original Bloom paper** (Bloom 1970): defines the structure and the FPR.
- **The Go Memory Model** (`https://go.dev/ref/mem`): defines visibility and ordering for atomic operations.
- **The `bits-and-blooms/bloom/v3` source and godoc**: defines the API contract for the canonical Go library.

The variant papers (Counting, Scalable, Cuckoo, Block, Xor, Ribbon) provide normative definitions for their respective structures.

---

## Formal Definitions

### Bloom filter

A Bloom filter is a tuple `(m, k, B, H)` where:

- `m ∈ ℕ⁺` is the number of bits.
- `k ∈ ℕ⁺` is the number of hash functions.
- `B ∈ {0, 1}^m` is the bit array.
- `H = (h_1, ..., h_k)` is a family of k hash functions, each `h_i : U → {0, ..., m-1}`, where U is the universe of keys.

The structure supports two operations:

- **Add(x):** for each `i ∈ {1, ..., k}`, set `B[h_i(x)] := 1`.
- **Test(x):** return `true` iff for all `i ∈ {1, ..., k}`, `B[h_i(x)] = 1`.

### Membership semantics

For any set `S ⊆ U` of items added to the filter, and any `x ∈ U`:

- **No false negatives:** if `x ∈ S` then `Test(x) = true`.
- **False positives possible:** if `x ∉ S` then `Test(x)` is `true` with probability `p(m, k, |S|)` defined below.

### Counting Bloom filter

A Counting Bloom filter replaces each bit with a counter `C[i] ∈ {0, 1, ..., 2^w - 1}` for some counter width `w` (typically `w = 4`). Operations:

- **Add(x):** for each `i`, `C[h_i(x)] := min(C[h_i(x)] + 1, 2^w - 1)`.
- **Delete(x):** for each `i`, if `0 < C[h_i(x)] < 2^w - 1`, `C[h_i(x)] := C[h_i(x)] - 1`.
- **Test(x):** return `true` iff for all `i`, `C[h_i(x)] > 0`.

Saturated counters (at `2^w - 1`) are never decremented, preventing under-counting and false negatives.

### Partitioned Bloom filter

A Partitioned Bloom filter divides the m-bit array into k equal-size partitions, each of `m/k` bits. Hash function `h_i` maps only into partition i. Operations are unchanged otherwise.

### Scalable Bloom filter (SBF)

An SBF is a sequence `F_0, F_1, ..., F_L` of basic Bloom filters with parameters `(m_i, k_i)` where:

- `m_i = m_0 * r^i` for growth ratio `r > 1`.
- `p_i = p_0 * s^i` for tightening ratio `0 < s < 1`.

Operations:

- **Add(x):** add to `F_L` (the current/last filter). If `F_L` is full, append a fresh `F_{L+1}`.
- **Test(x):** return `true` iff `Test_i(x)` is `true` for some i.

The overall false-positive rate is bounded by `p_0 / (1 - s)`.

### Cuckoo filter

A Cuckoo filter is a tuple `(B, b, f, H, H_f)` where:

- `B` is an array of `B` buckets.
- Each bucket holds up to `b` fingerprints of `f` bits each (typically `b = 4`, `f = 8` or `16`).
- `H : U → {0, ..., B - 1}` and `H_f : U → {0, ..., 2^f - 1}` are hash functions.
- The alternate bucket is `H'(x) = H(x) XOR H_f(fp_x) mod B`.

Operations:

- **Insert(x):** compute `fp = H_f(x)`, `b_1 = H(x)`, `b_2 = b_1 XOR H_f(fp) mod B`. If `b_1` or `b_2` has an empty slot, place `fp` there. Otherwise, evict a fingerprint from one bucket; place `fp` in its slot; the evicted fp goes to its alternate bucket. Repeat until success or max attempts.
- **Lookup(x):** check `b_1` and `b_2` for matching fp.
- **Delete(x):** find and clear `fp` in `b_1` or `b_2`.

---

## False-Positive Rate Formula

### Approximate formula (large m, large mn)

For independent uniform hashes:

```
p(m, k, n) = (1 - e^(-kn/m))^k
```

This is the canonical formula taught in textbooks. It assumes:

- Hash functions are mutually independent and uniform over `{0, ..., m-1}`.
- The k positions for a query key are independent of the m bits set by Adds.
- m is large enough that the substitution `(1 - 1/m)^m ≈ 1/e` is accurate.

### Exact formula

For mutually independent k hash functions:

```
p_exact(m, k, n) = sum_{i=0..k} (-1)^i * C(k, i) * (1 - i/m)^(kn)
```

This inclusion-exclusion form is exact but rarely used in practice.

### Double hashing variant

The library uses `g_i(x) = h_1(x) + i*h_2(x) mod m`. Kirsch and Mitzenmacher (2006) proved that the FPR of this scheme matches the FPR of k independent hashes within `O(1/m)` for large m.

### Empirical agreement

For typical production sizes (m > 10^6), the approximate formula and empirical FPR agree to within statistical noise (~5%).

---

## Optimum k and Memory Bounds

### Optimum k

Minimising `p(m, k, n)` over k yields:

```
k* = (m/n) * ln 2
```

At `k*`, exactly half the bits are set in expectation:

```
1 - e^(-k*n/m) = 1/2
```

The optimal FPR is:

```
p* = (1/2)^k* = e^(-(m/n) * (ln 2)^2)
```

### Memory per item

Given target FPR `p*` and choosing `k = k*`, the required memory is:

```
m/n = -ln(p*) / (ln 2)^2 ≈ 1.4427 * log_2(1/p*)
```

That is approximately `1.44 * log_2(1/p*)` bits per item.

### Information-theoretic lower bound

(Carter, Floyd, Gill, Markowsky, Wegman 1978.) Any data structure supporting approximate set membership with false-positive rate `p` on a set of size `n` must use at least:

```
n * log_2(1/p)
```

bits. Bloom filters use approximately `1.44 / 1 = 1.44` times this minimum.

The Xor filter (Graf, Lemire 2020) and Ribbon filter (Dillinger, Walzer 2021) achieve approximately `1.23 * log_2(1/p)` bits per item, closer to the lower bound.

---

## The `bits-and-blooms/bloom/v3` API Contract

The library at `github.com/bits-and-blooms/bloom/v3` exports the following public API.

### Types

```go
type BloomFilter struct { /* unexported fields */ }
```

### Constructors

```go
func New(m uint, k uint) *BloomFilter
func NewWithEstimates(n uint, fp float64) *BloomFilter
func From(data []uint64, k uint) *BloomFilter
```

`New(m, k)` returns a filter with explicit parameters. `NewWithEstimates(n, fp)` derives `m` and `k` using `EstimateParameters`. `From(data, k)` constructs a filter wrapping an existing bitset.

### Estimation

```go
func EstimateParameters(n uint, p float64) (m uint, k uint)
```

Returns the optimal parameters via the closed-form formulae above.

### Mutation

```go
func (f *BloomFilter) Add(data []byte) *BloomFilter
func (f *BloomFilter) AddString(data string) *BloomFilter
func (f *BloomFilter) ClearAll() *BloomFilter
```

Add returns the filter for chaining. ClearAll zeros the bitset.

### Query

```go
func (f *BloomFilter) Test(data []byte) bool
func (f *BloomFilter) TestString(data string) bool
func (f *BloomFilter) TestAndAdd(data []byte) bool
func (f *BloomFilter) TestAndAddString(data string) bool
func (f *BloomFilter) TestOrAdd(data []byte) bool
func (f *BloomFilter) TestOrAddString(data string) bool
```

`TestAndAdd` returns the prior `Test` result and unconditionally `Add`s. `TestOrAdd` returns the prior `Test` result and `Add`s only if the result was `false`.

### Inspection

```go
func (f *BloomFilter) Cap() uint
func (f *BloomFilter) K() uint
func (f *BloomFilter) BitSet() *bitset.BitSet
func (f *BloomFilter) ApproximatedSize() uint32
```

`Cap` returns `m`; `K` returns `k`. `ApproximatedSize` estimates `n` via the Swamidass-Baldi formula.

### Set operations

```go
func (f *BloomFilter) Equal(other *BloomFilter) bool
func (f *BloomFilter) Union(other *BloomFilter) (*BloomFilter, error)
func (f *BloomFilter) Merge(other *BloomFilter) error
func (f *BloomFilter) Intersect(other *BloomFilter) (*BloomFilter, error)
```

Union/Merge/Intersect require compatible parameters (`Cap()` and `K()` equal).

### Serialisation

```go
func (f *BloomFilter) MarshalBinary() ([]byte, error)
func (f *BloomFilter) UnmarshalBinary(data []byte) error
func (f *BloomFilter) MarshalJSON() ([]byte, error)
func (f *BloomFilter) UnmarshalJSON(data []byte) error
func (f *BloomFilter) WriteTo(w io.Writer) (int64, error)
func (f *BloomFilter) ReadFrom(r io.Reader) (int64, error)
func (f *BloomFilter) GobEncode() ([]byte, error)
func (f *BloomFilter) GobDecode(data []byte) error
```

### Concurrency contract

The `BloomFilter` type makes no concurrency guarantees. From the godoc:

> A Bloom filter must not be concurrently mutated or read.

Callers must provide external synchronisation (mutex, atomic wrapper, sharding, immutable patterns).

---

## The Go Memory Model in Concurrent Bloom Use

### Atomics synchronise

From the Go memory model:

> If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

For Bloom filters using atomic bitsets:

- `atomic.OrUint64(&bits[i], mask)` writes the OR result.
- A subsequent `atomic.LoadUint64(&bits[i])` reads the result.
- The Or is synchronized before the Load.

### Happens-before via atomics

A Bloom filter's `Add(k)` operation, implemented with `atomic.OrUint64` for each of k positions, establishes happens-before for each bit individually. Reading a bit with `atomic.LoadUint64` observes any prior Or.

### Happens-before via mutexes

A Bloom filter wrapped in `sync.RWMutex`:

- `mu.Lock()` synchronises with prior `mu.Unlock()`.
- `mu.RLock()` synchronises with prior `mu.Unlock()`.

Inside the lock, the wrapped filter sees the most recent state. Concurrent reads via RLock are race-free because the wrapped filter is not mutated under RLock.

### Sequential consistency for atomics

Go's atomic operations are sequentially consistent (post-2022 Go memory model clarification). This means there exists a total order of all atomic operations consistent with each goroutine's program order. As a programmer, you reason as if atomic operations occur in some interleaving consistent with each thread's order.

### Implications for Test followed by Add

If goroutine A's `Add(k)` has happened-before goroutine B's `Test(k)`, then B observes all k bits set by A. This is the contract that gives Bloom filters their "no false negatives" property across goroutines.

If A's Add and B's Test are concurrent (no happens-before edge), B may observe intermediate state: some bits set, others not. The Test may return false. This is *not* a false negative in the formal sense — the Add had not "happened" before the Test.

---

## Variant Specifications

### Counting Bloom filter (Fan, Cao, Almeida, Broder 2000)

Counter width `w = 4` for typical use. Memory: `m * w` bits, i.e. 4x the basic Bloom for w = 4.

For optimal k and balanced operation, the expected counter value per cell is `k*n/m = ln 2`. The probability of counter overflow at width `w` is approximately:

```
P(overflow) ≈ (ln 2)^(2^w) / (2^w)!
```

For `w = 4` (max 15), this is on the order of `10^-16` — negligible.

### Scalable Bloom filter (Almeida, Baquero, Preguiça, Hutchison 2007)

Parameters:
- Initial capacity `n_0`.
- Growth ratio `r` (typically 2-4).
- Tightening ratio `s` (typically 0.5-0.8).
- Initial FPR `p_0`.

Sub-filter `i` has capacity `n_0 * r^i` and FPR `p_0 * s^i`. The overall FPR is bounded:

```
P <= p_0 / (1 - s)
```

For `p_0 = 0.01`, `s = 0.5`: overall FPR ≤ 0.02.

### Cuckoo filter (Fan, Andersen, Kaminsky, Mitzenmacher 2014)

Memory at load factor 95%:

```
bits/key ≈ ceil(log_2(1/p) + 3) / 0.95
```

For p = 0.01: ~9 bits/key. For p = 0.001: ~12 bits/key.

Insertion is O(1) amortised; worst-case bounded by max kick count (default 500). Insertion failure rate is essentially zero for properly sized filters but non-zero in adversarial cases.

### Block Bloom filter (Putze, Sanders, Singler 2007)

Each block is a contiguous cache line (typically 64 bytes = 512 bits). A key's k bits all land within one block. Lookup cost: 1 cache miss + k bit checks.

FPR is slightly higher than standard Bloom at the same memory; typically 1.15-1.3x. The advantage is dramatically reduced cache misses for filters larger than L3.

### Xor filter (Graf, Lemire 2020)

Static (no Add after construction). Memory: ~9.84 bits/key at p ≈ 0.0039. Lookup: 3 random reads + XOR.

### Ribbon filter (Dillinger, Walzer 2021)

Improvement on Xor with batched construction. Memory: ~8.5 bits/key at p ≈ 0.0039.

Used in RocksDB as `RibbonFilterPolicy`.

---

## Wire Format

### `bits-and-blooms/bloom/v3` binary format

```
[8 bytes] uint64 little-endian: m
[8 bytes] uint64 little-endian: k
[ceil(m/8) bytes] bitset bytes (little-endian within each word)
```

No version prefix. No checksum. Stable since v3.0.

### Recommended versioning wrapper

For long-lived snapshots, prefix with a one-byte version tag:

```
[1 byte] version (0x01 for first version)
[N bytes] payload (version-specific)
```

Future versions can add: checksums, compression, additional metadata.

### Cross-language compatibility

The library's wire format is straightforward; equivalent readers exist in Python (`pybloom`), Java (Apache `BloomFilter`), C++ (Apache Hadoop). Compatibility requires:

- Same hash family (MurmurHash3 128-bit).
- Same hash seed (the library uses a constant; verify in the consumer).
- Same little-endian byte order.

In practice, most cross-language Bloom-filter exchange is bespoke; the library's format is not a standard.

---

## References

### Foundational

- Bloom, B. H. (1970). *Space/Time Trade-offs in Hash Coding with Allowable Errors.* CACM 13(7), 422-426.
- Carter, J. L., Floyd, R. W., Gill, J., Markowsky, G., & Wegman, M. (1978). *Exact and Approximate Membership Testers.* STOC.

### Variants

- Fan, L., Cao, P., Almeida, J., & Broder, A. (2000). *Summary Cache: A Scalable Wide-Area Web Cache Sharing Protocol.* IEEE/ACM ToN. (Counting Bloom Filter)
- Almeida, P. S., Baquero, C., Preguiça, N., & Hutchison, D. (2007). *Scalable Bloom Filters.* Information Processing Letters.
- Putze, F., Sanders, P., & Singler, J. (2007). *Cache-, Hash-, and Space-Efficient Bloom Filters.* WEA. (Block Bloom)
- Fan, B., Andersen, D. G., Kaminsky, M., & Mitzenmacher, M. D. (2014). *Cuckoo Filter: Practically Better Than Bloom.* CoNEXT.
- Graf, T. M., & Lemire, D. (2020). *Xor Filters: Faster and Smaller Than Bloom and Cuckoo Filters.* JEA.
- Dillinger, P., & Walzer, S. (2021). *Ribbon Filter: Practically Smaller Than Bloom and Xor.* arXiv:2103.02515.

### Analysis

- Kirsch, A., & Mitzenmacher, M. (2006). *Less Hashing, Same Performance: Building a Better Bloom Filter.* ESA.
- Mitzenmacher, M., & Upfal, E. (2017). *Probability and Computing.* (Textbook chapter on Bloom filters.)
- Mitzenmacher, M., & Vadhan, S. (2008). *Why Simple Hash Functions Work.* SODA.

### Go-specific

- The Go Memory Model: `https://go.dev/ref/mem`.
- `sync/atomic` package: `https://pkg.go.dev/sync/atomic`.
- `bits-and-blooms/bloom/v3`: `https://github.com/bits-and-blooms/bloom`.
- `seiflotfy/cuckoofilter`: `https://github.com/seiflotfy/cuckoofilter`.
- `tylertreat/BoomFilters`: `https://github.com/tylertreat/BoomFilters`.
- `FastFilter/xorfilter`: `https://github.com/FastFilter/xorfilter`.

### Production systems

- RocksDB Bloom filter docs.
- Apache Cassandra Bloom filter docs.
- Apache Impala Runtime Filtering docs.
- ClickHouse skip indices docs.
- PostgreSQL `bloom` extension.

---

## Appendix A: ApproximatedSize Derivation

The `ApproximatedSize` method uses the Swamidass-Baldi estimator. Given an observed bit count `X` in a filter with `m` bits and `k` hashes, the estimator for the number of inserted items is:

```
n_hat = -m/k * ln(1 - X/m)
```

The derivation:

- After `n` inserts, the expected number of set bits is `E[X] = m * (1 - e^(-kn/m))`.
- Solving for `n`: `n = -m/k * ln(1 - E[X]/m)`.
- The estimator substitutes the observed `X` for the expectation, giving the formula above.

Accuracy: good for fill `X/m < 0.7`. Beyond that, the logarithm grows steeply and the estimator's variance balloons.

For very heavily-loaded filters, the estimate can be misleading. Cross-check against an external counter for confidence.

---

## Appendix B: Bit-Level Layout

A Go `[]uint64` is laid out in memory with little-endian word order. Bit `i` in the conceptual bitset lives at:

```
word_index = i / 64
bit_offset = i % 64
mask = uint64(1) << bit_offset
```

Setting bit `i`:

```go
bits[word_index] |= mask
```

Testing bit `i`:

```go
bits[word_index] & mask != 0
```

Atomic equivalents:

```go
atomic.OrUint64(&bits[word_index], mask)        // set
atomic.LoadUint64(&bits[word_index]) & mask != 0 // test
```

### Endianness in serialised form

The library writes each `uint64` word in little-endian byte order. On a big-endian system, the library must byte-swap on read and write. Go handles this transparently via `encoding/binary.LittleEndian`.

A serialised filter is byte-for-byte identical across architectures. A 1 MB bitset on amd64 is the same 1 MB on arm64.

---

## Appendix C: Hash Function Properties Used in Bloom Filters

A hash function used in a Bloom filter must satisfy:

1. **Uniform output distribution.** Output values are uniformly distributed over `{0, 1, ..., 2^64 - 1}` for a 64-bit hash.

2. **Avalanche.** Flipping one bit of the input flips approximately half the bits of the output, independently of the input.

3. **Determinism.** Same input + same seed (if seeded) -> same output.

4. **No bias on specific bit ranges.** Both the high and low bits of the output are uniform, so taking `h mod m` for any `m` gives a uniform result.

5. **Speed.** The function returns in time proportional to the input length.

The `bits-and-blooms/bloom/v3` library uses MurmurHash3 128-bit, which satisfies all five. The `xxhash.Sum64` function also satisfies them with comparable speed.

For Bloom filters, no preimage resistance or collision resistance is needed; only the above five properties.

### Test suites for hash quality

- **SMHasher.** Used to validate MurmurHash3 and xxhash.
- **NIST SP 800-22.** Statistical test suite for randomness.
- **Goodness-of-fit tests** in custom Bloom-filter benchmarks.

A team writing its own Bloom filter library would run these to validate the chosen hash family.

---

## Appendix D: Concurrent-Safe API Specification (Recommended)

A recommended concurrent-safe API derived from the above:

```go
type ConcurrentBloomFilter interface {
    Add(key []byte)
    Test(key []byte) bool
    TestAndAdd(key []byte) bool
    ApproximatedSize() uint64
    FillFraction() float64
    WriteTo(w io.Writer) (int64, error)
    Merge(other ConcurrentBloomFilter) error
    ClearAll()
    Cap() uint64
    K() uint64
}
```

Documentation:

- All methods are safe for concurrent use by multiple goroutines.
- `Add`, `Test`, `TestAndAdd` are wait-free.
- `WriteTo` produces a per-word-consistent snapshot; in-flight Adds may be included or excluded.
- `ClearAll` is safe to call concurrently but observable mid-clear state is non-deterministic.
- `Merge` requires identical `Cap()` and `K()` and assumes no concurrent Adds during merge.

This is the API a `bits-and-blooms` consumer should *wrap* the library with for safe concurrent use.

---

## Appendix E: Memory Model Vocabulary

Quick reference for the Go memory model terms used above.

- **Synchronizes-with:** A relation between two memory operations indicating one must precede the other in a globally agreed-upon order.
- **Happens-before:** The closure of synchronizes-with and program order.
- **Race:** Two memory operations on the same location, at least one a write, not ordered by happens-before. A race in Go is undefined behaviour.
- **Atomic operation:** A read or write from `sync/atomic` that participates in synchronizes-with.
- **Sequentially consistent:** Operations appear in a single total order consistent with each goroutine's program order. Go's atomics are sequentially consistent.

For Bloom filters:

- All atomic-Or operations on the bitset are sequentially consistent.
- A happens-before edge from Add to Test (via channel, mutex, or atomic) guarantees Test observes Add's bits.
- Concurrent Add and Test without happens-before may see intermediate state but no race occurs (atomic ops are not racy).

---

## Appendix F: Compatibility Matrix

| Library | Wire format compatibility | Concurrent-safe by default |
| --- | :---: | :---: |
| `bits-and-blooms/bloom/v3` | with v2.x, v3.x | no |
| `willf/bloom` | v2.x | no |
| `tylertreat/BoomFilters` (Bloom) | own format | no |
| `seiflotfy/cuckoofilter` | own format | no |
| `AndreasBriese/bbloom` | own format | no |
| `holdno/bloom` | own format | yes (atomic) |
| `FastFilter/xorfilter` | own format | reads only |

For long-term storage, pin to the library version that wrote the snapshot and document it. The major libraries are stable but not interchangeable.
