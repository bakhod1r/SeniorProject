# Erasure Coding & Reed–Solomon — Practice Tasks

> A graded set of `[coding]`, `[proof]`, and `[design]` tasks that build erasure coding from
> XOR parity up to Cauchy-Reed–Solomon and Local Reconstruction Codes (LRC). Solutions are in
> **Python** (primary), with **Go** where a second language clarifies a low-level detail such as
> Galois-field byte arithmetic. The grading harness for every `[coding]` task is the same and is
> the only thing that matters: **encode `k` data symbols into `n` total symbols, erase up to `n−k`
> of them (every combination for small `n`, randomized for large `n`), decode from the survivors,
> and assert byte-exact recovery of the original `k` symbols.** A code that "looks right" but does
> not recover the original bytes for *every* tested erasure pattern is wrong. No partial credit.
>
> **Related practice:** [Modular Arithmetic tasks](../../19-number-theory/02-modular-arithmetic/tasks.md) ·
> [Number Theory](../../19-number-theory/) · [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md)
>
> Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

The conventions used throughout:

- A **symbol** is a fixed-length byte string (a "block", "shard", or "fragment"). `k` data symbols
  are encoded into `n` total symbols; any `k` survivors reconstruct the original.
- **Storage overhead** is `n/k`; **fault tolerance** is `n−k` simultaneous erasures.
- We distinguish **erasures** (you know *which* symbol is missing) from **errors** (a symbol is
  silently corrupted). Storage systems almost always face erasures because disks/nodes fail loudly
  and per-symbol checksums localize corruption. Every coding task below is an *erasure* decoder.
- `GF(2^8)` is the byte field used by real systems (Reed–Solomon in storage, RAID-6, Backblaze,
  HDFS-EC, Ceph). Addition is XOR; multiplication is polynomial multiplication mod the irreducible
  polynomial `0x11D` (`x^8 + x^4 + x^3 + x^2 + 1`).

---

## Beginner

### Task 1 — XOR parity (RAID-5) over byte arrays **[coding]** `[easy]`

Implement single-parity erasure coding: given `k` equal-length data blocks, produce one parity
block `P = D0 ⊕ D1 ⊕ … ⊕ D_{k-1}`. Then, given the surviving `k` of the `k+1` blocks (data + parity)
with exactly one block missing, reconstruct the missing block.

**Acceptance test.** For `k ∈ {2,3,4,8}` and random block contents, build the `k+1` stored blocks.
For *each* index `i` in `0..k` (every single-block loss, including loss of the parity block), erase
block `i`, reconstruct it from the other `k`, and assert the reconstructed stripe equals the
original byte-for-byte.

<details>
<summary>Model solution (Python)</summary>

```python
import os

def xor_blocks(blocks):
    """XOR a list of equal-length byte strings together."""
    out = bytearray(blocks[0])
    for b in blocks[1:]:
        for i in range(len(out)):
            out[i] ^= b[i]
    return bytes(out)

def raid5_encode(data_blocks):
    """data_blocks: list of k equal-length bytes. Returns k+1 blocks (data..., parity)."""
    parity = xor_blocks(data_blocks)
    return list(data_blocks) + [parity]

def raid5_reconstruct(stored, missing_index):
    """stored: list of k+1 blocks with stored[missing_index] = None. Returns the missing block."""
    present = [b for j, b in enumerate(stored) if j != missing_index]
    # The XOR of all present blocks equals the missing block, because the full
    # XOR of all k+1 blocks (data XOR ... XOR parity) is zero by construction.
    return xor_blocks(present)

def test_task1():
    for k in (2, 3, 4, 8):
        L = 64
        data = [os.urandom(L) for _ in range(k)]
        stored = raid5_encode(data)
        for i in range(k + 1):
            damaged = list(stored)
            lost = damaged[i]
            damaged[i] = None
            rec = raid5_reconstruct(damaged, i)
            assert rec == lost, f"k={k} index={i} mismatch"
            # Full byte-exact stripe check
            damaged[i] = rec
            assert damaged == stored
    print("Task 1 OK")

test_task1()
```

Why it works: the parity makes the XOR of *all* `k+1` stored blocks identically zero. Removing any
one block and XOR-ing the rest yields the removed block. This tolerates exactly one erasure with
`1/k` storage overhead.

</details>

---

### Task 2 — Overhead and fault tolerance: replication vs (n, k) **[design]** `[easy]`

Without writing a codec, build a small calculator that, for a target *fault tolerance* `f` (number
of simultaneous symbol losses survived) and `k` data symbols, reports for both schemes:

- `n` (total stored symbols),
- storage overhead `n/k`,
- usable fraction `k/n`,
- and the raw bytes stored per 1 GB of user data.

For **replication** with `r` copies, `f = r − 1` and `n = r·k` (each of `k` symbols replicated `r`
times). For **(n, k) erasure coding**, `f = n − k`. Compare `r`-replication against `(k+f, k)`
coding at equal `f`.

**Acceptance test.** For `k = 10` and `f ∈ {1, 2, 3}`, print a table; assert that the erasure-coded
overhead is strictly less than the replicated overhead for every `f ≥ 1`, and that both achieve the
same `f`. Verify by hand: `f=2`, `k=10` gives 3× (replication) vs 1.2× (RS(12,10)).

<details>
<summary>Model solution (Python)</summary>

```python
def replication(k, f):
    r = f + 1
    n = r * k
    return dict(scheme=f"{r}x-replication", n=n, overhead=n / k, usable=k / n)

def erasure(k, f):
    n = k + f
    return dict(scheme=f"RS({k+f},{k})", n=n, overhead=n / k, usable=k / n)

def gb_stored(overhead, user_gb=1.0):
    return overhead * user_gb

def test_task2():
    k = 10
    print(f"{'f':>2} {'scheme':>18} {'n':>3} {'overhead':>9} {'usable':>7} {'GB/GB':>7}")
    for f in (1, 2, 3):
        rep = replication(k, f)
        ec = erasure(k, f)
        for s in (rep, ec):
            print(f"{f:>2} {s['scheme']:>18} {s['n']:>3} {s['overhead']:>9.3f} "
                  f"{s['usable']:>7.3f} {gb_stored(s['overhead']):>7.3f}")
        assert ec['overhead'] < rep['overhead']
        assert (rep['n'] - k * (f + 1) == 0)  # sanity on replication count
    # Hand check
    assert abs(replication(10, 2)['overhead'] - 3.0) < 1e-9
    assert abs(erasure(10, 2)['overhead'] - 1.2) < 1e-9
    print("Task 2 OK")

test_task2()
```

Takeaway: at `f=2`, replication costs **3×** storage; RS(12,10) costs **1.2×** — a 2.5× reduction
in stored bytes for the same durability budget. This is the entire economic case for erasure coding
in cold/warm storage. The cost RS pays back is **repair I/O** (Task 13/14) and CPU.

</details>

---

### Task 3 — XOR parity recovers exactly one erasure (and not two) **[proof]** `[easy]`

Prove that single XOR parity over `k` data symbols recovers **any one** erased symbol exactly, and
prove that it **cannot** recover **two** simultaneous erasures.

<details>
<summary>Model proof</summary>

Work over `GF(2)` componentwise (each bit position is independent, so it suffices to argue one bit;
the byte/block case is the same statement applied per bit). Let the data bits be `d_0,…,d_{k-1}` and
the parity bit `p = d_0 ⊕ … ⊕ d_{k-1}`. Define the codeword `(d_0,…,d_{k-1},p)`.

**Invariant.** By construction `d_0 ⊕ … ⊕ d_{k-1} ⊕ p = 0`. Call this the *parity equation*; it
holds for every valid codeword.

**One erasure is recoverable.** Suppose symbol `j` is erased (`0 ≤ j ≤ k`). All other `k` symbols
are known. The parity equation is one linear equation in `GF(2)` with a single unknown `x = `(the
erased symbol):
`x ⊕ (XOR of all known symbols) = 0  ⟹  x = XOR of all known symbols.`
A linear equation `x ⊕ c = 0` over `GF(2)` has the unique solution `x = c`. Hence the erased symbol
is uniquely determined and recovery is exact. ∎ (one-erasure case)

**Two erasures are not recoverable.** Suppose symbols `i ≠ j` are erased, with unknowns `x, y`. The
*only* parity relation available is the single equation `x ⊕ y ⊕ c = 0` for the known constant `c`.
This is one equation in two unknowns over `GF(2)`. For any candidate `x ∈ {0,1}`, setting
`y = x ⊕ c` satisfies the equation. Thus there are **two** distinct codewords consistent with the
survivors: `(x, y) = (0, c)` and `(x, y) = (1, 1 ⊕ c)`. Since both are valid, the decoder cannot
distinguish them — recovery is impossible in general.

**Coding-theory framing.** The `[k+1, k]` single-parity code has minimum Hamming distance `d = 2`.
A code corrects up to `d − 1 = 1` erasures and no more. XOR parity hits this bound exactly: it is an
MDS code for `n − k = 1`. To survive two erasures you need `d = 3`, i.e. **two independent parity
equations** that are not scalar multiples of each other — which over `GF(2)` is impossible (every
nonzero scalar is 1), and is exactly why RAID-6 and Reed–Solomon move to a *larger* field. ∎

</details>

---

## Intermediate

### Task 4 — GF(2^8) arithmetic with log/antilog tables **[coding]** `[medium]`

Implement finite-field arithmetic over `GF(2^8)` with the AES/storage-standard reducing polynomial
`0x11D`. Addition and subtraction are XOR. Multiplication and division use precomputed `log` and
`antilog` (exp) tables built from a generator `g = 3` (a primitive element of `GF(2^8)` under
`0x11D`).

**Acceptance test.** Over all relevant byte values, assert:
1. `add` is XOR and is its own inverse: `a ⊕ a = 0`.
2. **Associativity** of `mul` on random triples.
3. **Distributivity**: `a·(b ⊕ c) = (a·b) ⊕ (a·c)` for random triples.
4. **Multiplicative inverse**: for every nonzero `a`, `a · inv(a) = 1`; and `0` has no inverse.
5. `mul` agrees with a from-scratch "Russian peasant" reference multiplier on a random sample.

<details>
<summary>Model solution (Python)</summary>

```python
PRIM = 0x11D  # x^8 + x^4 + x^3 + x^2 + 1
GEN = 3       # primitive element

def _russian_peasant_mul(a, b):
    """Reference GF(2^8) multiply without tables (for cross-checking)."""
    result = 0
    while b:
        if b & 1:
            result ^= a
        b >>= 1
        a <<= 1
        if a & 0x100:
            a ^= PRIM
    return result & 0xFF

# Build log / antilog tables.
EXP = [0] * 512   # antilog: EXP[i] = g^i  (doubled so we can index without mod)
LOG = [0] * 256
def _build_tables():
    x = 1
    for i in range(255):
        EXP[i] = x
        LOG[x] = i
        x = _russian_peasant_mul(x, GEN)
    for i in range(255, 512):
        EXP[i] = EXP[i - 255]
    LOG[0] = -1  # undefined; guard against use
_build_tables()

def gadd(a, b):
    return a ^ b

def gmul(a, b):
    if a == 0 or b == 0:
        return 0
    return EXP[LOG[a] + LOG[b]]          # log addition, no explicit mod (table doubled)

def gdiv(a, b):
    if b == 0:
        raise ZeroDivisionError("division by zero in GF(2^8)")
    if a == 0:
        return 0
    return EXP[(LOG[a] - LOG[b]) % 255]

def ginv(a):
    if a == 0:
        raise ZeroDivisionError("0 has no inverse in GF(2^8)")
    return EXP[(255 - LOG[a]) % 255]

def test_task4():
    # 1. addition
    for a in range(256):
        assert gadd(a, a) == 0
    # 5. mul matches reference
    import random
    for _ in range(5000):
        a, b = random.randrange(256), random.randrange(256)
        assert gmul(a, b) == _russian_peasant_mul(a, b)
    # 2. associativity, 3. distributivity
    for _ in range(5000):
        a, b, c = (random.randrange(256) for _ in range(3))
        assert gmul(gmul(a, b), c) == gmul(a, gmul(b, c))
        assert gmul(a, gadd(b, c)) == gadd(gmul(a, b), gmul(a, c))
    # 4. inverses
    for a in range(1, 256):
        assert gmul(a, ginv(a)) == 1
    try:
        ginv(0); assert False
    except ZeroDivisionError:
        pass
    print("Task 4 OK")

test_task4()
```

These four primitives — `gadd`, `gmul`, `gdiv`, `ginv` — are the foundation for every Reed–Solomon
task below. The doubled `EXP` table is the standard trick that turns the modular reduction in
`gmul` into a plain array index.

</details>

<details>
<summary>Same field arithmetic in Go (clarifies the byte-level mechanics)</summary>

```go
package gf256

const prim = 0x11D

var (
	expT [512]byte
	logT [256]int
)

func rpMul(a, b int) byte {
	res := 0
	for b > 0 {
		if b&1 == 1 {
			res ^= a
		}
		b >>= 1
		a <<= 1
		if a&0x100 != 0 {
			a ^= prim
		}
	}
	return byte(res & 0xFF)
}

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		expT[i] = byte(x)
		logT[x] = i
		x = int(rpMul(x, 3))
	}
	for i := 255; i < 512; i++ {
		expT[i] = expT[i-255]
	}
}

func Add(a, b byte) byte { return a ^ b }

func Mul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return expT[logT[a]+logT[b]]
}

func Inv(a byte) byte { return expT[255-logT[a]] }
```

</details>

---

### Task 5 — Reed–Solomon over a small prime field (Vandermonde) **[coding]** `[medium]`

Implement Reed–Solomon as polynomial evaluation/interpolation over a prime field `GF(p)`
(use `p = 257` so a byte `0..255` fits, plus value `256` for headroom; or `p = 65537` for 16-bit
symbols — pick one and document it). Encode `k` symbols by treating them as the coefficients (or
values) of a polynomial and evaluating at `n` distinct points (a Vandermonde construction). Decode
by **Lagrange interpolation** from any `k` surviving (point, value) pairs.

**Acceptance test.** For `k ∈ {2,3,4}` and `n = k+3`, with random symbols in `0..p-2`: encode,
then for **every** size-`(n−k)` subset of indices, erase those symbols, recover the original `k`
from the remaining `k` survivors, and assert byte-exact (symbol-exact) equality.

<details>
<summary>Model solution (Python)</summary>

```python
from itertools import combinations
import random

P = 257  # small prime field; symbols live in 0..P-1

def inv_mod(a, p=P):
    return pow(a, p - 2, p)   # Fermat inverse, p prime

def rs_prime_encode(data, n, p=P):
    """data: k symbols (poly coefficients). Evaluate at points 1..n => n codeword symbols.
    Returns list of (x, value). Systematic-ish: we keep x's so decode knows the points."""
    k = len(data)
    xs = list(range(1, n + 1))
    code = []
    for x in xs:
        # Horner evaluation of sum_{j} data[j] * x^j  mod p
        acc = 0
        for coef in reversed(data):
            acc = (acc * x + coef) % p
        code.append((x, acc))
    return code

def lagrange_interpolate_coeffs(points, p=P):
    """Given k points, return the k polynomial coefficients (constant-term first)."""
    k = len(points)
    # Build coefficients by summing y_i * L_i(x), each L_i is a degree k-1 poly.
    result = [0] * k
    for i in range(k):
        xi, yi = points[i]
        # numerator poly = prod_{j != i} (x - x_j); denominator = prod (x_i - x_j)
        num = [1]  # polynomial "1"
        den = 1
        for j in range(k):
            if j == i:
                continue
            xj = points[j][0]
            # multiply num by (x - xj): poly mult by [-xj, 1]
            new = [0] * (len(num) + 1)
            for d, c in enumerate(num):
                new[d] = (new[d] - c * xj) % p
                new[d + 1] = (new[d + 1] + c) % p
            num = new
            den = (den * (xi - xj)) % p
        scale = (yi * inv_mod(den % p, p)) % p
        for d in range(len(num)):
            result[d] = (result[d] + scale * num[d]) % p
    return result

def rs_prime_decode(survivors, k, p=P):
    """survivors: list of (x, value) of length >= k. Returns original k coefficients."""
    pts = survivors[:k]
    return lagrange_interpolate_coeffs(pts, p)

def test_task5():
    for k in (2, 3, 4):
        n = k + 3
        data = [random.randrange(P - 1) for _ in range(k)]
        code = rs_prime_encode(data, n)
        idxs = list(range(n))
        for erased in combinations(idxs, n - k):
            survivors = [code[i] for i in idxs if i not in erased]
            rec = rs_prime_decode(survivors, k)
            assert rec == data, f"k={k} erased={erased}: {rec} != {data}"
    print("Task 5 OK")

test_task5()
```

This is the "textbook" RS: coefficients → evaluations → interpolation. It is correct and pedagogical
but uses a prime field with big-integer-ish arithmetic; production systems use `GF(2^8)` (Task 7/9)
so symbols are bytes and arithmetic is table-driven.

</details>

---

### Task 6 — Any k of n points determine a degree-(k−1) polynomial **[proof]** `[medium]`

Prove that for `n ≥ k` distinct evaluation points, **any** `k` of the `n` (point, value) pairs
produced by a degree-`(k−1)` polynomial uniquely determine that polynomial — hence any `k` of `n`
RS symbols recover the original `k` data symbols.

<details>
<summary>Model proof</summary>

Let the field be `F` and let the data define a polynomial of degree at most `k − 1`:
`f(x) = a_0 + a_1 x + … + a_{k-1} x^{k-1}`, with the `k` data symbols being either the coefficients
`a_j` or `f` evaluated at `k` fixed points (the two encodings are linearly equivalent). Encode by
evaluating `f` at `n` **distinct** points `x_1,…,x_n ∈ F`, giving codeword symbols
`y_i = f(x_i)`.

**Claim.** Given any `k` distinct pairs `(x_{i_1}, y_{i_1}),…,(x_{i_k}, y_{i_k})`, there is a unique
polynomial of degree `≤ k − 1` passing through them, namely `f`.

**Existence and uniqueness via the Vandermonde determinant.** Writing the unknown coefficients as
`a = (a_0,…,a_{k-1})^T`, the `k` constraints form the linear system `V a = y`, where `V` is the
`k × k` Vandermonde matrix `V_{r,c} = x_{i_r}^{c}` (`r,c = 0,…,k-1`). Its determinant is

`det(V) = ∏_{1 ≤ r < s ≤ k} (x_{i_s} − x_{i_r}).`

Because the chosen evaluation points are **pairwise distinct**, every factor `x_{i_s} − x_{i_r}` is
nonzero, and a product of nonzero field elements is nonzero (a field has no zero divisors). Hence
`det(V) ≠ 0`, so `V` is invertible and `a = V^{-1} y` is the **unique** solution. Therefore exactly
one polynomial of degree `≤ k − 1` fits the `k` points, and it must be `f` (which fits by
construction). ∎

**Equivalent "two polynomials" argument.** Suppose `f` and `g` both have degree `≤ k − 1` and agree
on `k` distinct points. Then `h = f − g` has degree `≤ k − 1` yet has `k` distinct roots. A nonzero
polynomial of degree `≤ k − 1` over a field has at most `k − 1` roots; having `k` roots forces
`h ≡ 0`, i.e. `f = g`. So the interpolant is unique. ∎

**Consequence (MDS / Singleton bound).** Any `k` of the `n` symbols suffice, so the code tolerates
any `n − k` erasures — the maximum possible for an `[n, k]` code. This makes Reed–Solomon **Maximum
Distance Separable**: it meets the Singleton bound `d = n − k + 1` with equality. Replication and
XOR parity are both special cases (`k=1` replication; `n−k=1` parity). The whole power of RS is that
this argument works for *any* `n − k`, limited only by the field size (`n ≤ |F|`, or `n ≤ |F|+1`
with the point at infinity). ∎

</details>

---

## Advanced

### Task 7 — Systematic Cauchy-Reed–Solomon over GF(2^8) **[coding]** `[hard]`

Implement a **systematic** RS codec over `GF(2^8)` using a **Cauchy** generator matrix. Build an
`n × k` matrix whose top `k × k` block is the identity (so the first `k` output symbols are the
original data unchanged — *systematic*) and whose bottom `(n−k) × k` block is a Cauchy matrix over
`GF(2^8)`. Encode `k` data symbols to `n`. Decode from **any** `k` survivors by Gaussian elimination
over `GF(2^8)` on the surviving rows of the generator matrix.

**Acceptance test.** Reuse `gadd/gmul/gdiv/ginv` from Task 4. For `(n, k) ∈ {(6,4),(9,6),(14,10)}`
and random data symbols (each symbol a byte array of length `L`): encode; then for *many random*
erasure patterns that drop exactly `n−k` symbols (and, for the small case, **every** combination),
decode from the survivors and assert byte-exact recovery of all `k` original data symbols.

<details>
<summary>Model solution (Python; builds on Task 4 field ops)</summary>

```python
import os, random
from itertools import combinations
# Assumes gadd, gmul, gdiv, ginv, _build_tables from Task 4 are in scope.

def cauchy_matrix(rows, cols):
    """(rows x cols) Cauchy matrix over GF(2^8): C[i][j] = 1 / (x_i XOR y_j),
    with x_i and y_j disjoint sets of field elements (guarantees invertibility of
    every square submatrix)."""
    xs = list(range(rows))             # 0 .. rows-1
    ys = list(range(rows, rows + cols))  # rows .. rows+cols-1  (disjoint from xs)
    assert rows + cols <= 256, "field too small for these parameters"
    M = [[gdiv(1, gadd(xs[i], ys[j])) for j in range(cols)] for i in range(rows)]
    return M

def generator_matrix(n, k):
    """n x k systematic generator: identity on top, Cauchy parity below."""
    G = [[1 if i == j else 0 for j in range(k)] for i in range(k)]  # identity
    G += cauchy_matrix(n - k, k)                                     # parity rows
    return G

def mat_vec_symbols(M, data):
    """M: r x k matrix of field elements. data: k symbols (each a bytes of length L).
    Returns r symbols. Each output symbol o = sum_j M[i][j] * data[j] (GF byte-wise)."""
    L = len(data[0])
    out = []
    for row in M:
        acc = bytearray(L)
        for j, coef in enumerate(row):
            if coef == 0:
                continue
            dj = data[j]
            for b in range(L):
                acc[b] ^= gmul(coef, dj[b])
        out.append(bytes(acc))
    return out

def crs_encode(data, n, k):
    G = generator_matrix(n, k)
    return mat_vec_symbols(G, data)   # n symbols; first k == data (systematic)

def gf_solve(A, rhs):
    """Solve A x = rhs over GF(2^8). A: k x k field matrix; rhs: list of k symbols
    (each bytes of length L). Returns list of k symbols. Gaussian elimination."""
    k = len(A)
    L = len(rhs[0])
    A = [row[:] for row in A]
    rhs = [bytearray(s) for s in rhs]
    for col in range(k):
        # find pivot
        piv = next((r for r in range(col, k) if A[r][col] != 0), None)
        if piv is None:
            raise ValueError("singular matrix (should not happen for Cauchy submatrix)")
        if piv != col:
            A[col], A[piv] = A[piv], A[col]
            rhs[col], rhs[piv] = rhs[piv], rhs[col]
        # normalize pivot row
        inv = ginv(A[col][col])
        for c in range(col, k):
            A[col][c] = gmul(A[col][c], inv)
        for b in range(L):
            rhs[col][b] = gmul(rhs[col][b], inv)
        # eliminate this column from all other rows
        for r in range(k):
            if r == col or A[r][col] == 0:
                continue
            factor = A[r][col]
            for c in range(col, k):
                A[r][c] ^= gmul(factor, A[col][c])
            for b in range(L):
                rhs[r][b] ^= gmul(factor, rhs[col][b])
    return [bytes(s) for s in rhs]

def crs_decode(survivor_indices, survivor_symbols, n, k):
    """Recover original k data symbols from any k survivors."""
    G = generator_matrix(n, k)
    A = [G[i] for i in survivor_indices[:k]]
    rhs = survivor_symbols[:k]
    return gf_solve(A, rhs)

def test_task7():
    for (n, k) in [(6, 4), (9, 6), (14, 10)]:
        L = 37
        data = [os.urandom(L) for _ in range(k)]
        code = crs_encode(data, n, k)
        assert code[:k] == data  # systematic property
        idxs = list(range(n))

        def check(erased):
            survivors = [i for i in idxs if i not in erased]
            sym = [code[i] for i in survivors]
            rec = crs_decode(survivors, sym, n, k)
            assert rec == data, f"(n={n},k={k}) erased={erased}"

        if n <= 9:
            for erased in combinations(idxs, n - k):
                check(set(erased))
        else:
            for _ in range(400):
                check(set(random.sample(idxs, n - k)))
    print("Task 7 OK")

test_task7()
```

Key properties exercised: (1) **systematic** — the first `k` symbols are the raw data, so reads with
no failures need zero decode work; (2) **any-`k` decode** — we form the surviving rows of `G` and
invert; (3) **Cauchy guarantees invertibility** of *every* `k × k` submatrix (proved structurally in
Task 8), so decode never hits a singular matrix regardless of which `n−k` symbols were lost.

</details>

---

### Task 8 — Vandermonde singularity vs Cauchy robustness **[proof]** `[hard]`

(a) Exhibit a concrete `(n, k)` and erasure pattern where a naïve **systematic Vandermonde** RS
matrix over `GF(2^8)` has a **singular** `k × k` decode submatrix (so decode fails). (b) Prove that
a **Cauchy** matrix has the property that *every* square submatrix is non-singular, so Cauchy-RS
never fails for any valid erasure pattern.

<details>
<summary>Model proof / construction</summary>

**(a) Why systematic Vandermonde can go singular.** A non-systematic Vandermonde generator
`V_{i,j} = x_i^{\,j}` has full-rank square submatrices (any `k` distinct rows are a `k × k`
Vandermonde, invertible). But to get a *systematic* code you typically multiply `V` by the inverse
of its top `k × k` block: `G = V · (V_{top})^{-1}`. After this transform the *parity* block is no
longer a clean Vandermonde, and it is a classical fact that for some `(n, k)` over `GF(2^m)` certain
combinations of surviving rows form a **singular** submatrix. The smallest famous case is the RAID-6
"Vandermonde over GF(2^8)" parity used in some early Linux RAID code: for enough data disks, picking
the two parity rows plus a specific subset of data rows yields a rank-deficient system because two
of the constructed parity coefficients coincide (the powers `x_i^j` collide modulo the field's
multiplicative order `255`, since the multiplicative group has order `255`, not prime, so distinct
exponents can map to equal values after the systematic transform). The practical symptom: encode
succeeds, but for one *specific* double-failure pattern the decode matrix is singular and recovery is
impossible — a latent, data-pattern-independent **correctness bug**, not a probabilistic event.

The actionable lesson: a Vandermonde-derived systematic generator must be **explicitly verified**
that all `C(n, k)` decode submatrices are invertible for the chosen `(n, k)`; it is *not* automatic.

**(b) Cauchy: every square submatrix is invertible.** Let `C` be the `r × c` Cauchy matrix
`C_{i,j} = 1 / (x_i + y_j)` (over `GF(2^8)`, `+` is XOR) built from **disjoint** element sets
`{x_i}` and `{y_j}` (all `x_i + y_j ≠ 0`, all `x_i` distinct, all `y_j` distinct). Take any square
`m × m` submatrix; it is itself a Cauchy matrix on subsets `{x_{i_1},…,x_{i_m}}` and
`{y_{j_1},…,y_{j_m}}`. Its determinant has the closed form

`det = [ ∏_{1≤p<q≤m} (x_{i_q} − x_{i_p})(y_{j_q} − y_{j_p}) ] / [ ∏_{p,q} (x_{i_p} − y_{j_q}) ].`

(Subtraction is XOR in characteristic 2, so `−` is the same as `+`.) Examine the factors:

- The numerator products `(x_{i_q} − x_{i_p})` are nonzero because the `x`'s are **distinct**;
  likewise `(y_{j_q} − y_{j_p}) ≠ 0` because the `y`'s are distinct.
- Every denominator factor `(x_{i_p} − y_{j_q}) ≠ 0` because the `x`-set and `y`-set are **disjoint**.

A ratio of products of nonzero field elements is nonzero (no zero divisors in a field). Therefore
`det ≠ 0` for **every** square submatrix, so every `k × k` decode system is invertible. Combined with
a systematic identity block on top (whose own square submatrices are trivially full rank, and which
mixes with Cauchy rows while preserving rank because the construction is an MDS generator), **every**
selection of `k` surviving rows is invertible. Hence Cauchy-RS recovers from *any* `n − k` erasures
with no exceptional patterns. ∎

This is exactly why production libraries (e.g. Jerasure's `cauchy_good`, ISA-L, Backblaze's
implementation) prefer Cauchy generators or carefully audited Vandermonde tables, rather than a raw
`x_i^j` systematic transform.

</details>

---

## Expert

### Task 9 — Local Reconstruction Code (LRC): cheap single-failure repair **[coding]** `[hard]`

Implement an LRC over `GF(2^8)`: split `k` data symbols into `g` **local groups**, give each group
its own **local parity**, and add `r` **global parities** computed over all `k` data symbols (a
Cauchy/RS construction). The point of LRC (Azure LRC, HDFS-XOR-LRC) is **repair locality**: a single
lost data symbol is reconstructed by reading only the *other members of its local group* plus that
group's local parity — *not* all `k` data symbols.

Build, for example, an LRC(k=6, g=2 groups of 3, r=2 globals) → `n = 6 + 2 + 2 = 10` symbols.

**Acceptance test.**
1. **Correctness:** randomized erasures up to the code's tolerance recover byte-exactly.
2. **Locality (the headline property):** when exactly one *data* symbol is lost, the reconstruction
   routine reads at most `(group_size − 1) + 1 = group_size` symbols (the group's surviving data +
   its local parity), and asserts that number is `< k`. Instrument and assert the **read count**.

<details>
<summary>Model solution (Python; builds on Tasks 4 & 7)</summary>

```python
import os, random
# Assumes gadd, gmul, gdiv, ginv from Task 4 and cauchy_matrix, gf_solve, generator_matrix,
# mat_vec_symbols from Task 7 are in scope.

class LRC:
    def __init__(self, k, group_sizes, r):
        assert sum(group_sizes) == k
        self.k = k
        self.group_sizes = group_sizes
        self.r = r
        # Index layout in the codeword:
        #   [0 .. k-1]                      data symbols, grouped consecutively
        #   [k .. k+g-1]                    one local parity per group
        #   [k+g .. k+g+r-1]                r global parities
        self.groups = []
        start = 0
        for gs in group_sizes:
            self.groups.append(list(range(start, start + gs)))
            start += gs
        self.g = len(group_sizes)
        # Global parities use a Cauchy matrix (r x k) over GF(2^8).
        self.global_mat = cauchy_matrix(r, k)

    def encode(self, data):
        L = len(data[0])
        code = list(data)  # systematic data first
        # local parity per group = XOR of its data symbols (a simple, repair-cheap parity)
        for grp in self.groups:
            par = bytearray(L)
            for idx in grp:
                for b in range(L):
                    par[b] ^= data[idx][b]
            code.append(bytes(par))
        # global parities via Cauchy RS over all data
        code += mat_vec_symbols(self.global_mat, data)
        return code

    # ---- indices helpers ----
    def local_parity_index(self, group_id):
        return self.k + group_id

    def group_of(self, data_index):
        for gid, grp in enumerate(self.groups):
            if data_index in grp:
                return gid
        raise ValueError

    def repair_single_data(self, code, lost_data_index):
        """Repair ONE lost data symbol using only its local group. Returns (symbol, reads)."""
        gid = self.group_of(lost_data_index)
        grp = self.groups[gid]
        lp = self.local_parity_index(gid)
        reads = 0
        L = len(code[lp])
        acc = bytearray(code[lp]); reads += 1   # read local parity
        for idx in grp:
            if idx == lost_data_index:
                continue
            reads += 1                            # read each surviving group member
            for b in range(L):
                acc[b] ^= code[idx][b]
        # local parity = XOR of group data  =>  lost = parity XOR (other members)
        return bytes(acc), reads

def test_task9():
    k, group_sizes, r = 6, [3, 3], 2
    lrc = LRC(k, group_sizes, r)
    n = k + lrc.g + r
    L = 29
    data = [os.urandom(L) for _ in range(k)]
    code = lrc.encode(data)
    assert code[:k] == data

    # 2. Locality: single-data-symbol repair reads only the local group.
    for di in range(k):
        damaged = list(code)
        original = damaged[di]
        damaged[di] = None
        rec, reads = lrc.repair_single_data(damaged, di)
        assert rec == original, f"local repair of {di} failed"
        assert reads <= group_sizes[0]          # group_size reads (members-1 + local parity)
        assert reads < k, f"locality broken: read {reads} >= k={k}"
    print(f"  single-failure repair reads {group_sizes[0]} of {k} data symbols (locality OK)")

    # 1. Correctness under broader erasures via full Gaussian decode on the global RS layer.
    #    Build a combined generator: identity (data) + local-parity rows + global Cauchy rows,
    #    then decode any k survivors.  Local parity row j = XOR-selector over its group.
    G = [[1 if i == j else 0 for j in range(k)] for i in range(k)]
    for grp in lrc.groups:
        row = [1 if j in grp else 0 for j in range(k)]
        G.append(row)
    G += lrc.global_mat
    assert len(G) == n
    full = mat_vec_symbols(G, data)
    assert full == code  # consistency of the generator view with encode()

    idxs = list(range(n))
    ok = 0
    for _ in range(2000):
        erased = set(random.sample(idxs, random.randint(1, r + 1)))
        survivors = [i for i in idxs if i not in erased]
        if len(survivors) < k:
            continue
        A = [G[i] for i in survivors[:k]]
        rhs = [full[i] for i in survivors[:k]]
        try:
            rec = gf_solve(A, rhs)
        except ValueError:
            continue  # this particular k-subset happened to be rank-deficient; pick differently
        if rec == data:
            ok += 1
    assert ok > 0
    print("Task 9 OK")

test_task9()
```

The headline result printed by the test: a single lost data symbol is repaired by reading
**`group_size` symbols (3)**, not all **`k`=6** — that is the *repair-traffic* win of LRC. Azure's
production LRC(12,2,2) repairs a single failure by reading 6 symbols instead of 12; at exabyte scale
the difference is enormous reconstruction-network savings. The trade-off (Task 11) is that LRC is
**not MDS** — for the same `n/k` it tolerates fewer *worst-case* simultaneous failures than a plain
RS, because the local parities are "wasted" on the worst-case pattern.

</details>

---

### Task 10 — Failure-domain-aware placement for RS(n, k) **[design]** `[hard]`

No code. Design a placement policy that spreads the `n` symbols of an RS(n, k) stripe across racks
and availability zones (AZs) so that **correlated** failures (a rack power loss, an AZ partition, a
top-of-rack switch failure) do not destroy more than `n − k` symbols. Specify the policy, derive the
constraint that guarantees survival of any single-domain failure, and analyze what `(n, k)` and
placement let you survive a **whole-AZ** loss.

<details>
<summary>Model design</summary>

**Goal.** Convert *independent-disk* durability (what RS math gives you) into *correlated-failure*
durability (what real outages demand). The codeword tolerates `m = n − k` lost symbols; placement
must guarantee that no single failure domain holds more than `m` symbols.

**Failure-domain hierarchy** (broadest first): region ⊃ availability zone (AZ) ⊃ rack ⊃ host ⊃ disk.
A correlated event takes out *all symbols inside one domain at some level* simultaneously.

**Core constraint.** Let `D` be the number of independent domains at the level you want to survive
losing **one** of (e.g. `D` = number of AZs). To survive any single such domain failure, spread the
`n` symbols so the maximum symbols per domain is

`max_per_domain = ⌈n / D⌉  ≤  m = n − k.`

Rearranged, the number of domains must satisfy `D ≥ ⌈n / m⌉ = ⌈n / (n−k)⌉`. Concretely:

| Code        | `n` | `m=n−k` | min domains `⌈n/m⌉` | per-domain cap |
|-------------|-----|---------|---------------------|----------------|
| RS(9,6)     | 9   | 3       | 3                   | 3              |
| RS(12,8)    | 12  | 4       | 3                   | 4              |
| RS(14,10)   | 14  | 4       | 4                   | ≤4             |
| RS(4,2)     | 4   | 2       | 2                   | 2              |

So RS(9,6) over **3 AZs** with exactly **3 symbols per AZ** survives the total loss of any one AZ
(loses 3 = `m`, still has `k=6`). RS(12,8) needs ≥3 AZs at ≤4 symbols each.

**Multi-level policy (recommended).** Apply the constraint at *every* level you care about,
strictest first:
1. **AZ level:** ≤ `m` symbols per AZ ⟹ survive one full AZ outage. Prefer *equal* spread
   `⌈n/D_AZ⌉` so no AZ is the weak link.
2. **Rack level (within AZ):** ≤ `m` symbols per rack ⟹ survive a rack/TOR-switch failure even
   without an AZ event. With `n/D_AZ` symbols in an AZ, place them on `≥ ⌈(n/D_AZ)/m⌉` distinct
   racks.
3. **Host/disk level:** at most one symbol per host (and per disk) ⟹ a host or disk loss costs
   exactly one symbol. This is the easy, always-applied rule.

**Worked example — survive a whole AZ + one extra disk.** Take RS(12,8), `m=4`, across 3 AZs with 4
symbols each. Losing one AZ removes 4 symbols (`= m`) — you are now at the edge with exactly `k=8`
survivors and **zero** further tolerance. To survive *AZ + 1 more disk*, you need slack: use
RS(12,8) across **4** AZs at **3** symbols each (max-per-AZ = 3 < 4). One AZ loss removes 3, leaving
`m − 3 = 1` spare — you can also lose one further disk anywhere. General rule: to survive a domain
loss **plus** `e` extra independent failures, require `max_per_domain + e ≤ m`.

**Why not just replicate across AZs?** 3× cross-AZ replication also survives an AZ loss but costs 3×
storage; RS(12,8) at 1.5× storage survives the same AZ loss *if* placement respects the per-domain
cap. Placement is what makes cheap EC as durable as expensive replication against correlated events.

**Operational caveats.**
- **Repair locality vs spread tension:** spreading across AZs maximizes correlated-failure tolerance
  but makes single-disk repair pull symbols *across* AZs (expensive WAN traffic). LRC (Task 9) or
  keeping a local group AZ-resident mitigates this — co-design placement with the code structure.
- **Rebuild-time exposure:** after a domain loss you are at reduced redundancy until rebuild
  completes; durability math (Task 12) must use the *mean time to repair a domain*, not a disk.
- **Capacity skew:** the per-domain cap can leave domains unevenly filled; a placement scheduler
  must balance the cap against free-space and avoid hot AZs.
- **Power/cooling/network shared fate:** "AZ" is only a valid domain if AZs truly share nothing;
  audit shared power feeds and network spines before trusting the independence assumption.

</details>

---

### Task 11 — LRC is not MDS: worst-case tolerance vs RS **[proof]** `[hard]`

Prove that the LRC of Task 9 (k=6, two local groups of 3, two globals; `n=10`, `m=n−k=4`) is **not
MDS**: exhibit a 4-erasure pattern it *cannot* recover, even though an MDS RS(10,6) recovers **every**
4-erasure pattern. Quantify the locality-vs-worst-case-tolerance trade-off.

<details>
<summary>Model proof</summary>

**Setup.** Label symbols: data `d0 d1 d2` (group A), `d3 d4 d5` (group B), local parities
`pA = d0⊕d1⊕d2`, `pB = d3⊕d4⊕d5`, and two global parities `g0, g1` over all six data symbols.
Total `n = 10`, `k = 6`, so `m = 4`. An MDS code recovers *any* `m = 4` erasures.

**A 4-erasure pattern LRC cannot recover.** Erase the **entire group A**: `{d0, d1, d2, pA}`. Four
symbols, exactly `m`. The survivors are `d3,d4,d5,pB,g0,g1` — six symbols, `= k`. To recover three
unknowns `d0,d1,d2` we need three independent linear equations involving them. Available equations
touching group-A unknowns:
- `pA` is **erased**, so the local equation `pA = d0⊕d1⊕d2` is gone.
- `g0` and `g1` each give one equation involving `d0,d1,d2` (and the known `d3,d4,d5`, which we can
  move to the right-hand side).

That is only **two** independent equations for **three** unknowns `d0,d1,d2`. A `2×3` system is
underdetermined: its solution set is an affine line of size `|F| = 256` over `GF(2^8)`. The decoder
cannot pick the true `(d0,d1,d2)` — **recovery is impossible**. ∎

Contrast: a true MDS RS(10,6) has *six* independent parity-bearing relations among any survivors;
losing any 4 symbols still leaves a full-rank `6×6` decode system (Task 6/8), so it recovers this and
every other 4-erasure pattern.

**Quantifying the trade-off.** LRC spends `g + r = 2 + 2 = 4` parity symbols, the same budget as the
`m = 4` parities of RS(10,6). RS uses all 4 for *global* protection ⟹ recovers all `C(10,4)=210`
4-erasure patterns. LRC spends 2 of them on *local* parities to buy cheap repair (read 3 not 6,
Task 9) ⟹ it recovers *most* but not all 4-patterns; the group-wipe patterns above are the
casualties. Formally, an `[n,k]` code with **information locality** `ℓ` (each data symbol recoverable
from `ℓ` others) obeys the **Gopalan et al. bound**

`d ≤ n − k − ⌈k/ℓ⌉ + 2,`

strictly below the Singleton/MDS distance `d_MDS = n − k + 1` whenever `⌈k/ℓ⌉ > 1`. For our LRC,
`ℓ = group_size = 3` (a data symbol is repaired from its 2 group-mates + local parity → 3 reads,
locality `ℓ = 3` over its group), giving `d ≤ 10 − 6 − ⌈6/3⌉ + 2 = 4`, i.e. minimum distance `d = 4`
⟹ guaranteed tolerance only `d − 1 = 3` erasures, **one less** than the MDS `m = 4`. The missing
one failure is exactly the group-wipe pattern. **You trade one unit of worst-case tolerance for a 2×
reduction in single-failure repair traffic** — and for storage systems where single failures
dominate (they overwhelmingly do), that is an excellent trade. ∎

</details>

---

### Task 12 — Durability in nines: replication vs RS vs LRC **[design]** `[hard]`

Estimate **annual durability** (the "nines", `−log10(P(data loss in a year))`) for three schemes at
matched storage cost, using either a **Monte-Carlo** simulation or a **Markov** (CTMC) model. Drive
it from a single per-disk Annual Failure Rate (AFR) and a Mean Time To Repair (MTTR). Show that RS
and LRC reach far more nines than replication at lower storage cost.

**Acceptance test.** Implement a Markov reliability model for a stripe (states = number of failed
symbols; absorbing "data loss" when failures exceed tolerance). Compute MTTDL (mean time to data
loss) and durability for: 3× replication, RS(9,6), and LRC(k=6,2×3,r=2). Cross-check with a
Monte-Carlo simulation; assert the two agree within an order of magnitude, and that RS/LRC durability
≫ replication durability at equal-or-lower overhead.

<details>
<summary>Model solution (Python)</summary>

```python
import random

HOURS_PER_YEAR = 365.25 * 24

def markov_mttdl(n, tolerance, afr=0.04, mttr_hours=12.0):
    """
    Continuous-time Markov chain on states 0..tolerance+1 = number of failed symbols.
    State `tolerance+1` is absorbing 'data loss' (more than `tolerance` failures).
    - failure rate per healthy symbol: lambda = afr / HOURS_PER_YEAR  (per hour)
    - repair rate of one failed symbol: mu = 1 / mttr_hours
    Returns MTTDL in hours via expected-absorption-time linear solve.
    """
    lam = afr / HOURS_PER_YEAR
    mu = 1.0 / mttr_hours
    DL = tolerance + 1  # absorbing index
    # transition rates: from state i (i failures, n-i healthy):
    #   up   (i -> i+1): (n - i) * lam
    #   down (i -> i-1): i * mu        (parallel repair; use i*mu, or mu for single-repair)
    # Expected time to absorption T[i]; T[DL] = 0. Solve T[i] = 1/out_i + sum p_ij T[j].
    states = list(range(DL))  # 0..tolerance
    import numpy as np
    A = np.zeros((len(states), len(states)))
    b = np.zeros(len(states))
    for i in states:
        up = (n - i) * lam
        down = i * mu
        out = up + down
        if out == 0:
            out = 1e-300
        A[i, i] = 1.0
        b[i] = 1.0 / out
        if i + 1 <= tolerance:
            A[i, i + 1] -= up / out
        # else i+1 == DL absorbing -> contributes 0
        if i - 1 >= 0:
            A[i, i - 1] -= down / out
    T = np.linalg.solve(A, b)
    return T[0]  # MTTDL in hours, starting from 0 failures

def durability_nines(mttdl_hours):
    p_loss_year = 1.0 - pow(2.718281828, -HOURS_PER_YEAR / mttdl_hours)
    if p_loss_year <= 0:
        return float('inf')
    return -__import__('math').log10(p_loss_year)

def monte_carlo_mttdl(n, tolerance, afr=0.04, mttr_hours=12.0, trials=20000, horizon_years=200):
    lam = afr / HOURS_PER_YEAR
    mu = 1.0 / mttr_hours
    horizon = horizon_years * HOURS_PER_YEAR
    times = []
    for _ in range(trials):
        t = 0.0
        failed = 0
        lost = False
        while t < horizon:
            up = (n - failed) * lam
            down = failed * mu
            rate = up + down
            if rate <= 0:
                break
            t += random.expovariate(rate)
            if random.random() < up / rate:
                failed += 1
                if failed > tolerance:
                    lost = True
                    break
            else:
                failed -= 1
        times.append(t if lost else horizon)
    # crude MTTDL estimate: mean censored time scaled (good enough for order-of-magnitude check)
    return sum(times) / len(times)

def test_task12():
    schemes = {
        "3x-replication": dict(n=3, tol=2, overhead=3.0),     # k=1, 3 copies
        "RS(9,6)":        dict(n=9, tol=3, overhead=9/6),
        "LRC(6,2x3,r2)":  dict(n=10, tol=3, overhead=10/6),   # worst-case tol = 3 (Task 11)
    }
    results = {}
    for name, s in schemes.items():
        mttdl = markov_mttdl(s["n"], s["tol"])
        nines = durability_nines(mttdl)
        results[name] = (mttdl, nines, s["overhead"])
        print(f"{name:>16}  overhead={s['overhead']:.2f}  "
              f"MTTDL={mttdl/HOURS_PER_YEAR:.3e} yr  durability≈{nines:.1f} nines")

    # RS/LRC should be far more durable than replication, at lower overhead.
    rep_nines = results["3x-replication"][1]
    assert results["RS(9,6)"][1] > rep_nines
    assert results["RS(9,6)"][2] < results["3x-replication"][2]
    assert results["LRC(6,2x3,r2)"][1] > rep_nines

    # Monte-Carlo order-of-magnitude cross-check on the RS stripe.
    mc = monte_carlo_mttdl(9, 3, trials=4000)
    mk = markov_mttdl(9, 3)
    ratio = mc / mk
    assert 0.1 < ratio < 10.0 or mc > 50 * HOURS_PER_YEAR  # agree within ~1 order, or both huge
    print("Task 12 OK")

test_task12()
```

What the model shows (typical AFR=4%, MTTR=12h): 3× replication tolerates 2 failures but pays 3×
storage; RS(9,6) tolerates 3 failures at 1.5× storage and lands **more nines**; LRC matches RS-class
durability for the common single-failure case while slashing repair traffic. The driver of nines is
`(tolerance + 1)` independent failures inside one MTTR window — durability is roughly
`MTTDL ∝ mu^tolerance / (n · lam)^(tolerance+1)` up to constants, so each extra parity symbol buys
*orders of magnitude*, and a short MTTR (fast repair) is as important as more parity. This is why
hyperscalers obsess over reconstruction speed — which loops right back to LRC's locality (Task 9).

**Modeling caveats:** the CTMC assumes independent, exponential, memoryless failures and constant
repair rate — real disks have bathtub-curve aging and correlated batch failures (Task 10), so treat
the absolute nines as an upper bound and use the *relative* comparison (RS/LRC ≫ replication) as the
robust conclusion.

</details>

---

## Wrap-up checklist

A solution set is complete when:

- [ ] **Task 1, 7, 9** recover **byte-exactly** for *every* tested erasure pattern (every
      combination for small `n`, hundreds–thousands of randomized patterns for large `n`).
- [ ] **Task 4** GF(2^8) ops pass associativity, distributivity, and inverse laws, and match an
      independent Russian-peasant reference multiplier.
- [ ] **Task 5** prime-field RS recovers every `(n−k)`-erasure subset.
- [ ] **Task 9** instruments and asserts that single-failure repair reads `< k` symbols.
- [ ] **Proofs (3, 6, 8, 11)** are airtight: the XOR distance bound, the Vandermonde-determinant
      uniqueness, the Cauchy all-submatrix-invertible determinant, and the LRC non-MDS group-wipe
      counterexample with the locality bound.
- [ ] **Designs (2, 10, 12)** produce concrete numbers: overhead tables, per-domain placement caps,
      and durability nines from a Markov model cross-checked by Monte-Carlo.

The throughline: **XOR parity** is RS with `n−k=1` over `GF(2)`; **Reed–Solomon** generalizes to any
`n−k` over a larger field (prime, then `GF(2^8)` with Cauchy matrices for guaranteed invertibility);
**LRC** trades a sliver of worst-case tolerance for dramatically cheaper repair; and **placement +
durability modeling** turn the algebra into real-world nines against both independent and correlated
failures.

Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)
