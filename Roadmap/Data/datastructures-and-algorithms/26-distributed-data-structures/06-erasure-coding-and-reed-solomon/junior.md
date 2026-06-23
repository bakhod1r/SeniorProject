# Erasure Coding & Reed–Solomon — Junior Level

> **The one-sentence version:** Keeping three full copies of your data so you can survive two disk failures costs **200% extra storage**. Erasure coding survives the *same* failures while paying as little as **40% extra**. This file shows you how that magic works, building up from a single XOR.

> **Where this fits in the section.** Most topics in `26-distributed-data-structures` are about *replicated mutable state* — CRDTs, consensus, gossip — where many nodes hold copies and must agree. This topic is the section's **redundancy & durability** chapter. It answers a different, more physical question: *given that disks and machines die, how do we store bytes so we never lose them — without drowning in copies?* Erasure coding is the math behind RAID, Ceph, HDFS, and every serious object store (S3-class systems). It complements the CRDT topics rather than competing with them: CRDTs keep *live data consistent*; erasure coding keeps *stored data durable*.

---

## Table of Contents

1. [The durability problem](#1-the-durability-problem)
2. [Replication: simple, but expensive](#2-replication-simple-but-expensive)
3. [The gateway drug: XOR parity (RAID-5)](#3-the-gateway-drug-xor-parity-raid-5)
4. [The limitation: XOR survives only one failure](#4-the-limitation-xor-survives-only-one-failure)
5. [The (n, k) framing: general erasure coding](#5-the-n-k-framing-general-erasure-coding)
6. [Picture & table: replication vs erasure coding](#6-picture--table-replication-vs-erasure-coding)
7. [Runnable code: XOR-parity RAID-5](#7-runnable-code-xor-parity-raid-5)
8. [Where this is used in the real world](#8-where-this-is-used-in-the-real-world)
9. [Misconceptions](#9-misconceptions)
10. [Common mistakes](#10-common-mistakes)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

## 1. The durability problem

You have a file. You write it to a disk. The disk is a physical object with spinning platters or flash cells, and physical objects fail. A 2009 Google study of consumer drives found that **a few percent fail every year**. At scale this is not a maybe — it is a certainty. Backblaze, which runs hundreds of thousands of drives, reports drive failures *every single day*.

So the naive plan — "write the file to one disk and hope" — is not a plan. If that one disk dies, the bytes are gone. There is no algorithm that recovers information that exists nowhere. The only defense against losing data is to store **more than the bare minimum**, so that when some storage dies, what remains still contains enough to rebuild the whole.

Let us be precise about the words, because the whole topic hinges on them:

- **Durability** — the probability that your data is *still recoverable* after some failures. "Eleven nines" (99.999999999%) is the famous S3 number.
- **Availability** — whether you can read it *right now*. A node can be temporarily offline (unavailable) without the data being lost (still durable).
- **Redundancy** — the extra stored bytes, beyond the original size, that buy you durability.
- **Fault tolerance** — how many simultaneous storage failures you can survive without losing data.
- **Erasure** — a *known* missing piece. The system knows "disk 3 is dead" or "node 7 timed out." This is different from *corruption*, where a byte is silently wrong and you don't know which. **Hold onto this distinction — it is the single most important idea in section [9](#9-misconceptions).**

The engineering question for the rest of this file is:

> **For a chosen fault tolerance (survive `f` failures), what is the *cheapest* amount of redundancy?**

Replication answers it expensively. Erasure coding answers it cheaply. We will build from the most familiar tool you already know — XOR — up to the general scheme.

---

## 2. Replication: simple, but expensive

The simplest durability scheme is **make copies**. This is how RAID-1 (disk mirroring) and classic distributed file systems (early HDFS, GFS) work.

**Replication factor `r`** means: store `r` identical copies of the data on `r` different disks/nodes.

- `r = 2` (mirror / RAID-1): survives **1** failure. Storage overhead: **100%** (you store the data twice).
- `r = 3` (3× replication, the HDFS/GFS default for years): survives **2** failures. Storage overhead: **200%**.

The rule is clean and easy to reason about: with `r` copies you survive `r − 1` failures, and you pay `(r − 1) × 100%` extra storage. To read, grab any surviving copy — no computation needed. To recover a lost copy, copy a survivor. Replication's appeal is its *simplicity*: no math, trivial repair, trivial reads.

### Worked cost example

Suppose you operate a 10 PB (petabyte) data lake and you want to survive **2** simultaneous disk failures.

With **3× replication**:

```
Logical data:        10 PB
Copies stored:       3
Raw storage needed:  10 PB × 3 = 30 PB
Extra ("waste"):     20 PB   (200% overhead)
```

You bought **30 PB of disks to durably hold 10 PB of data**. Two-thirds of your storage spend is redundancy. At, say, \$15,000 per usable PB of raw storage, that extra 20 PB is **\$300,000** of hardware whose only job is to be a copy.

Hold that 200% number. By the end of section [5](#5-the-n-k-framing) we will survive the *same two failures* for **40% overhead** instead of 200% — about **5× less redundant storage** for the same safety. That gap, multiplied across an exabyte-scale fleet, is why every large storage system moved to erasure coding.

> **Why not just lower the replication factor?** Because `r = 2` only survives 1 failure, and `r = 1` survives 0. Replication's fault tolerance and its cost are welded together one-to-one. Erasure coding *breaks* that welding: it lets you dial fault tolerance and overhead almost independently.

---

## 3. The gateway drug: XOR parity (RAID-5)

Here is the key realization that opens the door. You do **not** need a full second copy to survive one failure. You need just enough *redundant information* to reconstruct any one missing piece. And XOR gives you exactly that, almost for free.

### A two-minute XOR refresher

XOR (`⊕`, exclusive-or) compares bits: `0⊕0=0`, `0⊕1=1`, `1⊕0=1`, `1⊕1=0`. It outputs `1` when the inputs *differ*. Two algebraic facts make XOR the perfect parity tool:

1. **Self-inverse:** `a ⊕ a = 0`. A value XORed with itself cancels out.
2. **Identity:** `a ⊕ 0 = a`. XOR with zero changes nothing.

From these, XOR is **associative** and **commutative**, so the order you combine values in doesn't matter. (If XOR feels rusty, see [Bit Manipulation / XOR](../../18-bit-manipulation/02-xor-pairing/junior.md).)

### The RAID-5 idea

Take three data blocks `D1, D2, D3` stored on three disks. Add a **fourth** disk holding their XOR:

```
P = D1 ⊕ D2 ⊕ D3        (P is the "parity" block)
```

Now you have four disks. The claim: **if any one of the four dies, you can rebuild it from the other three.** Watch why. Suppose `D2` dies. Compute the XOR of everything that survives:

```
D1 ⊕ D3 ⊕ P
  = D1 ⊕ D3 ⊕ (D1 ⊕ D2 ⊕ D3)     substitute P's definition
  = (D1 ⊕ D1) ⊕ (D3 ⊕ D3) ⊕ D2    reorder freely (commutative/associative)
  = 0 ⊕ 0 ⊕ D2                     since a ⊕ a = 0
  = D2                             since 0 ⊕ a = a
```

`D2` is recovered exactly. The same algebra rebuilds `D1`, or `D3`, or even the parity disk `P` itself (just recompute `D1 ⊕ D2 ⊕ D3`). **The single XOR formula `recovered = XOR of all survivors` repairs whichever one block is missing.** This is RAID-5.

### Concrete bytes — watch it actually reconstruct

Forget abstractions; use three real bytes. We'll write each in binary so the bit-by-bit XOR is visible.

```
D1 = 0b10110010   = 178
D2 = 0b01100101   = 101
D3 = 0b11010001   = 209
```

Compute the parity byte `P = D1 ⊕ D2 ⊕ D3`. XOR is bitwise, so line them up and XOR each column (output `1` where the number of `1`s in the column is odd):

```
   D1 :  1 0 1 1 0 0 1 0
   D2 :  0 1 1 0 0 1 0 1
   D3 :  1 1 0 1 0 0 0 1
        -----------------  XOR each column
   P  :  0 0 0 0 0 1 1 0    = 0b00000110 = 6
```

So we store `P = 6` on the parity disk. Four disks now hold `[178, 101, 209, 6]`.

**Now disk 2 dies.** All we have left is `D1 = 178`, `D3 = 209`, `P = 6`. Reconstruct `D2` by XORing the survivors:

```
   D1 :  1 0 1 1 0 0 1 0
   D3 :  1 1 0 1 0 0 0 1
   P  :  0 0 0 0 0 1 1 0
        -----------------  XOR each column
        :  0 1 1 0 0 1 0 1    = 0b01100101 = 101
```

The result is `101`, which is exactly the original `D2`. **Recovered, bit for bit.** No copy of `D2` was ever stored — only one extra byte of parity for three data bytes, and it was enough to bring `D2` back from nothing.

### The cost win

Three data blocks plus one parity block survives **1 failure** at:

```
overhead = parity / data = 1 / 3 ≈ 33%
```

Compare: a mirror (`r = 2`) also survives 1 failure but costs **100%** overhead. RAID-5 gives the *same* single-failure protection for **one-third** the redundant storage. And if you spread the parity across more data disks — say 9 data + 1 parity — the overhead drops to ~11% while still surviving one failure. That is the gateway: a tiny amount of cleverly computed extra data replaces a whole copy.

---

## 4. The limitation: XOR survives only one failure

XOR parity is wonderful, but it has a hard ceiling: **one parity block tolerates exactly one failure.** Push it and it breaks.

Go back to `[D1, D2, D3, P]` and let **two** disks die — say `D2` *and* `D3`. The survivors are `D1` and `P`. Try to recover:

```
D1 ⊕ P = D1 ⊕ (D1 ⊕ D2 ⊕ D3) = D2 ⊕ D3
```

You get `D2 ⊕ D3` — a single byte that is the XOR of *two* unknowns. There is no way to split it back into `D2` and `D3` separately. One equation, two unknowns: **unsolvable.** The data is lost.

The intuition generalizes cleanly:

> **To survive `m` simultaneous failures, you need `m` independent parity blocks** — `m` independent "equations" so that no matter which `m` pieces vanish, the remaining equations still pin down every unknown.

Plain XOR gives you exactly *one* equation (`P = D1 ⊕ D2 ⊕ D3 ⊕ …`). To get a *second, independent* equation you cannot just XOR everything again — that produces the same equation. You need a genuinely different combination of the data blocks. The mathematical tool that manufactures `m` independent equations — guaranteed independent, no matter how many you ask for — is **Reed–Solomon coding**. That is the leap from RAID-5 (one parity) to RAID-6 (two parity) to general erasure coding (any number of parities).

You don't need the field math yet (that is the `middle` and `senior` files). For now, internalize the shape of the answer:

> **General erasure coding = XOR parity, but with `m` independent parity blocks instead of one, so you can survive `m` failures.**

---

## 5. The (n, k) framing: general erasure coding

Here is the vocabulary that every storage system speaks. An erasure code is described by two numbers, written `(n, k)`:

- **`k`** — split the file into `k` equal **data chunks**.
- **`n`** — the total number of chunks you store, where `n > k`.
- **`m = n − k`** — the number of extra **parity chunks** computed from the `k` data chunks.

You store all **`n`** chunks on **`n` different disks/nodes** (one chunk per failure domain, so no single failure takes out two chunks). The defining property — the thing Reed–Solomon delivers — is:

> **Any `k` of the `n` chunks are enough to rebuild the entire original file.**

Read that again, because it is the whole topic in one line. It does not matter *which* `k` survive — any `k`-sized subset of the `n` chunks reconstructs everything. Equivalently, you can lose **any `n − k = m` chunks** and still recover. The system tolerates `m` failures.

Codes with this "any `k` of `n` is enough" property are called **MDS** (Maximum Distance Separable) — they are mathematically optimal: they extract the maximum possible fault tolerance from the parity they store. Reed–Solomon is MDS.

### Storage overhead

You store `n` chunks to protect `k` chunks' worth of real data, so:

```
storage factor   = n / k          (1.0 = no redundancy)
storage overhead = (n − k) / k    (extra, as a fraction of the data)
```

### Three concrete configurations

| Config | Split into `k` | Store `n` | Parity `m = n−k` | Survives | Storage factor `n/k` | Overhead |
|--------|---------------:|----------:|-----------------:|---------:|---------------------:|---------:|
| RAID-5 `(4, 3)`        | 3  | 4  | 1 | 1 failure  | 1.33× | 33%  |
| RAID-6 `(6, 4)`        | 4  | 6  | 2 | 2 failures | 1.50× | 50%  |
| HDFS/Backblaze `(14, 10)` | 10 | 14 | 4 | **4 failures** | **1.4×**  | **40%** |

Look at the last row against section [2](#2-replication-simple-but-expensive). The `(14, 10)` code survives **4** simultaneous failures at **1.4×** storage. To survive 4 failures with replication you would need **5× replication** — **400% overhead**, **10× the redundant storage** of the erasure code, for *less* total fault tolerance margin. That is not a small saving; it is the difference between a profitable storage business and an unaffordable one.

### Why "any k of n" is the magic (preview, no field math)

With XOR you had one equation. Reed–Solomon's trick is to treat your `k` data chunks as the coefficients of a polynomial, then *evaluate that polynomial at `n` different points* to produce `n` chunks. Recovering the original is exactly **polynomial interpolation**: any `k` points uniquely determine a degree-`(k−1)` polynomial (two points fix a line, three fix a parabola, and so on). So *any* `k` of the `n` evaluated points are enough to reconstruct the polynomial — and therefore the original `k` data chunks. The parities are different evaluation points, which is *why* they're independent and *why* you can lose any `m` of them.

The arithmetic happens in a **finite field** (`GF(2^8)`, so every "number" is one byte) using [modular arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md)-style rules — but the *idea* is just "polynomials are pinned down by enough points." The field mechanics — Galois fields, the encoding matrix, how repair actually solves the linear system — are the subject of [middle](middle.md) and [senior](senior.md). For the junior level, this is the load-bearing sentence:

> **Reed–Solomon turns `k` data chunks into `n` chunks such that any `k` of them rebuild the original — generalizing XOR parity from "survive 1" to "survive `n − k`."**

---

## 6. Picture & table: replication vs erasure coding

A `(4, 3)` XOR code, drawn:

```
            ORIGINAL FILE
                 │
        split into k = 3 data chunks
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
      ┌────┐  ┌────┐  ┌────┐        ┌────┐
      │ D1 │  │ D2 │  │ D3 │        │ P  │  ← parity = D1⊕D2⊕D3
      └────┘  └────┘  └────┘        └────┘
      disk1    disk2   disk3        disk4
        │        │        │           │
     store on n = 4 separate failure domains
        │        ✗ dies   │           │
        ▼                 ▼           ▼
   any k = 3 of the 4 survivors → rebuild the whole file
   (here: D1, D3, P  →  D2 = D1 ⊕ D3 ⊕ P)
```

The same file under **3× replication**:

```
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ FULL COPY│  │ FULL COPY│  │ FULL COPY│
   └──────────┘  └──────────┘  └──────────┘
      disk1         disk2         disk3
   survives 2 failures · overhead 200% · read = grab any 1 copy
```

A head-to-head table for the **same 10 PB of logical data**:

| Scheme | Survives | Raw storage for 10 PB | Overhead | Read path | Repair cost |
|--------|---------:|----------------------:|---------:|-----------|-------------|
| Single disk           | 0 | 10 PB | 0%   | direct | impossible |
| RAID-1 mirror `r=2`   | 1 | 20 PB | 100% | grab a copy | copy 1 survivor |
| 3× replication `r=3`  | 2 | 30 PB | 200% | grab a copy | copy 1 survivor |
| 5× replication `r=5`  | 4 | 50 PB | 400% | grab a copy | copy 1 survivor |
| RAID-5 `(4, 3)`       | 1 | 13.3 PB | 33%  | read chunks (or compute) | XOR survivors |
| RAID-6 `(6, 4)`       | 2 | 15 PB | 50%  | read chunks | solve from `k` chunks |
| **EC `(14, 10)`**     | **4** | **14 PB** | **40%** | read 10 chunks | read `k`, recompute |

The trade is now visible in one glance. Erasure coding **wins decisively on storage** (40% vs 400% for the same 4-failure tolerance). Replication **wins on simplicity and read/repair cost**: a replicated read is "grab one copy," while an erasure-coded read may require fetching `k` chunks from `k` nodes and, on repair, recomputing from `k` survivors (network- and CPU-heavier). That is the real-world reason hot, frequently-read data often stays replicated while cold, rarely-read bulk data is erasure-coded.

---

## 7. Runnable code: XOR-parity RAID-5

Let's make section [3](#3-the-gateway-drug-xor-parity-raid-5) real. We implement `(k+1, k)` XOR parity over byte arrays: encode the parity chunk, simulate the loss of one chunk, reconstruct it from the survivors, and `assert` that the recovered bytes equal the originals. The reconstruction logic is the *same* XOR-of-survivors operation whether the lost chunk is a data chunk or the parity chunk.

### Python (primary)

```python
"""
RAID-5-style XOR parity over byte arrays.

We split data into k equal chunks, store one parity chunk = XOR of all data
chunks, and demonstrate that losing ANY single chunk is fully recoverable.
"""
from functools import reduce
from operator import xor


def xor_bytes(a: bytes, b: bytes) -> bytes:
    """XOR two equal-length byte strings, byte by byte."""
    assert len(a) == len(b), "chunks must be equal length"
    return bytes(x ^ y for x, y in zip(a, b))


def split_into_chunks(data: bytes, k: int) -> list[bytes]:
    """Split data into k equal-length chunks, zero-padding the last one."""
    chunk_len = (len(data) + k - 1) // k          # ceil division
    padded = data.ljust(chunk_len * k, b"\x00")   # pad so all chunks are equal
    return [padded[i * chunk_len:(i + 1) * chunk_len] for i in range(k)]


def compute_parity(chunks: list[bytes]) -> bytes:
    """Parity = XOR of all data chunks (RAID-5)."""
    return reduce(xor_bytes, chunks)


def reconstruct(stored: list[bytes | None]) -> list[bytes]:
    """
    Given k+1 stored chunks (data chunks followed by the parity chunk),
    where exactly one slot is None (the failed disk), rebuild it.

    Recovery rule: the missing chunk = XOR of every surviving chunk.
    This works whether the missing slot is a data chunk OR the parity chunk,
    because P = D1 ^ D2 ^ ... ^ Dk  rearranges to  Di = (XOR of all others).
    """
    missing = [i for i, c in enumerate(stored) if c is None]
    assert len(missing) == 1, "XOR parity recovers exactly ONE missing chunk"
    survivors = [c for c in stored if c is not None]
    recovered = reduce(xor_bytes, survivors)
    result = list(stored)
    result[missing[0]] = recovered
    return result  # type: ignore[return-value]


def demo() -> None:
    k = 3
    original = b"erasure coding beats replication on storage!"

    data_chunks = split_into_chunks(original, k)
    parity = compute_parity(data_chunks)
    stored = data_chunks + [parity]          # k data chunks + 1 parity chunk
    print(f"k = {k} data chunks + 1 parity chunk = {len(stored)} disks")

    # --- Case A: a DATA chunk (disk 1) dies ---
    damaged = list(stored)
    damaged[1] = None                        # disk 1 fails
    healed = reconstruct(damaged)
    assert healed[1] == stored[1], "data-chunk recovery failed!"
    print("Recovered lost DATA chunk exactly. ✓")

    # --- Case B: the PARITY chunk (disk 3) dies ---
    damaged = list(stored)
    damaged[3] = None                        # parity disk fails
    healed = reconstruct(damaged)
    assert healed[3] == stored[3], "parity-chunk recovery failed!"
    print("Recovered lost PARITY chunk exactly. ✓")

    # --- Reassemble the original file from healed data chunks ---
    recovered_data = b"".join(healed[:k]).rstrip(b"\x00")
    assert recovered_data == original, "file mismatch!"
    print(f"Reassembled file: {recovered_data!r}")
    print("All assertions passed — single-failure recovery works.")


if __name__ == "__main__":
    demo()
```

Expected output:

```
k = 3 data chunks + 1 parity chunk = 4 disks
Recovered lost DATA chunk exactly. ✓
Recovered lost PARITY chunk exactly. ✓
Reassembled file: b'erasure coding beats replication on storage!'
All assertions passed — single-failure recovery works.
```

The recovery rule is one line: `recovered = XOR of all survivors`. It does not care whether the dead disk held data or parity — the XOR algebra from section [3](#3-the-gateway-drug-xor-parity-raid-5) handles both uniformly.

### Go (short version)

Same idea, idiomatic Go: build parity, drop a chunk, recover it, assert equality.

```go
package main

import (
	"bytes"
	"fmt"
)

// xorChunks XORs any number of equal-length byte slices together.
func xorChunks(chunks ...[]byte) []byte {
	out := make([]byte, len(chunks[0]))
	for _, c := range chunks {
		for i := range out {
			out[i] ^= c[i]
		}
	}
	return out
}

func main() {
	// 3 equal-length data chunks (RAID-5, k = 3).
	d1 := []byte("AAAAAAAA")
	d2 := []byte("BBBBBBBB")
	d3 := []byte("CCCCCCCC")

	parity := xorChunks(d1, d2, d3) // P = D1 ^ D2 ^ D3

	// Simulate: disk holding d2 dies. Survivors are d1, d3, parity.
	// Recovery rule: missing = XOR of all survivors.
	recovered := xorChunks(d1, d3, parity)

	if bytes.Equal(recovered, d2) {
		fmt.Printf("Recovered lost chunk exactly: %q ✓\n", recovered)
	} else {
		fmt.Println("recovery FAILED")
	}
}
```

Expected output:

```
Recovered lost chunk exactly: "BBBBBBBB" ✓
```

Both programs prove the central claim by construction: with one parity chunk you recover any one lost chunk, paying only `1/k` extra storage instead of a whole copy.

---

## 8. Where this is used in the real world

Erasure coding (and Reed–Solomon specifically) is not academic — it is running in the storage layer of nearly everything you touch.

- **RAID-5 / RAID-6** — disk arrays in servers and NAS boxes. RAID-5 is single XOR parity (survive 1 disk); RAID-6 adds a second, Reed–Solomon-style parity (survive 2 disks). This is the most direct embodiment of sections [3](#3-the-gateway-drug-xor-parity-raid-5)–[5](#5-the-n-k-framing).
- **HDFS Erasure Coding** — Hadoop 3 added native erasure coding (e.g. `RS(6,3)` and `RS(10,4)`) precisely to escape the 200% overhead of 3× replication on cold data. Hot data may still be replicated; archival data is erasure-coded for ~1.4× storage instead of 3×.
- **Backblaze** — publicly documented that their Vaults use a `(20, 17)` Reed–Solomon code: 17 data + 3 parity shards spread across 20 drives in 20 different physical "tomes," surviving 3 drive failures at ~18% overhead. Their open-source Java/Python Reed–Solomon library popularized the technique.
- **Ceph** — its object store supports erasure-coded pools (`k` + `m` profiles such as `k=4, m=2`) alongside replicated pools, letting operators choose per-pool durability/cost trade-offs.
- **S3-class object stores** — Amazon S3's "eleven nines" durability and similar guarantees from Azure Blob, Google Cloud Storage, and MinIO are delivered with erasure coding across many devices and racks, not by keeping eleven copies. MinIO ships Reed–Solomon erasure coding by default.
- **CD / DVD / Blu-ray** — physical media use **Reed–Solomon** so a scratch (a *known* damaged region) doesn't ruin the disc. This is erasure coding against physical erasures.
- **QR codes** — every QR code is Reed–Solomon encoded; you can obscure a chunk of it (up to ~30% in the high error-correction level) and a scanner still reconstructs the payload.
- **Deep-space & satellite links, DSL, digital TV** — Reed–Solomon (often layered with other codes) protects transmissions where retransmission is impossible or expensive.

The through-line: **anywhere bytes must survive partial loss with minimal overhead, you find erasure coding, and very often Reed–Solomon underneath.**

---

## 9. Misconceptions

**"Erasure coding detects and fixes corruption."** No — and this is *the* misconception to kill. Erasure coding handles **erasures**: pieces that are *known to be missing or unreadable* (a dead disk, a timed-out node, a `read error`). The system must already know *which* chunk is gone. It does **not**, by itself, find a chunk whose bytes have silently flipped while masquerading as valid. Detecting silent corruption is the job of **checksums** (CRC32C, SHA-256) stored alongside each chunk. The real pipeline is two-stage: **(1)** checksums detect a chunk as bad and *mark it missing* (turning silent corruption into a known erasure), then **(2)** erasure coding reconstructs that now-known-missing chunk. Codes that fix unknown errors are *error-correcting* codes; classic Reed–Solomon storage configs are run in *erasure* mode. **Erasure coding ≠ corruption detection. It needs checksums to tell it what's broken.**

**"It's just compression."** No. Compression *removes redundancy* to shrink data. Erasure coding *adds* carefully structured redundancy to make data survivable. Opposite goals.

**"More parity means faster reads."** No. Parity is read only during *repair* or degraded reads. In the normal case you read the `k` data chunks; extra parity sits idle, costing storage, not improving healthy-read speed.

**"XOR parity protects against two failures if I'm lucky."** No — section [4](#4-the-limitation) proved two losses leave you with `D2 ⊕ D3` and no way to separate them. One XOR parity = exactly one tolerated failure, every time.

**"Erasure coding is always cheaper, so always use it."** Not always. For tiny objects, chunking overhead and metadata can dominate; for hot, latency-sensitive data, replication's "read one copy" path beats fetching `k` chunks from `k` nodes. Erasure coding shines for **large, cold, durability-critical** data.

---

## 10. Common mistakes

- **Putting two chunks on the same failure domain.** If chunk D1 and parity P live on the *same* disk (or same rack, same power supply), one failure kills two chunks and your `(4,3)` code that "tolerates 1" actually tolerated 0. **One chunk per independent failure domain** is the whole game.
- **Forgetting checksums.** Relying on erasure coding alone to catch bad data. Without per-chunk checksums, silent corruption is invisible and you may "reconstruct" using a corrupt chunk, producing corrupt output (see misconception 1).
- **Unequal chunk lengths.** XOR and Reed–Solomon operate position-by-position; chunks **must** be equal length. Forgetting to pad the last chunk (as `split_into_chunks` does) corrupts recovery.
- **Trying to recover more than `m` losses.** Asking a `(14,10)` code to survive 5 failures (`m = 4`) is mathematically impossible — fewer than `k` chunks remain, the file is gone. Choose `m` for your *worst-case* expected simultaneous failures, not the average.
- **Counting overhead as `n/k` when you mean extra storage.** `n/k = 1.4` is the *storage factor*; the *overhead* (extra beyond the data) is `(n−k)/k = 0.4 = 40%`. Mixing these up makes erasure coding look worse (or better) than it is.
- **Ignoring repair cost.** Erasure-coded repair reads `k` chunks across the network to rebuild one — a single failure triggers `k` chunk-reads of traffic. At scale this "repair bandwidth" is a real constraint that replication (copy one survivor) avoids.

---

## 11. Cheat sheet

```
TERMS
  durability     = data still recoverable after failures
  availability   = readable right now
  erasure        = a KNOWN-missing piece (vs. silent corruption)
  redundancy     = extra stored bytes that buy fault tolerance
  MDS code       = "any k of n suffices" — optimal (Reed–Solomon is MDS)

REPLICATION (factor r)
  survives   : r - 1 failures
  overhead   : (r - 1) × 100%
  3× copies  : survive 2, pay 200%

XOR PARITY (RAID-5)
  P          = D1 ⊕ D2 ⊕ ... ⊕ Dk
  recover    = XOR of all survivors          (any ONE missing chunk)
  survives   : exactly 1 failure
  overhead   : 1/k   (e.g. k=3 → 33%, k=9 → 11%)

ERASURE CODING (n, k)
  k          = data chunks
  m = n - k  = parity chunks
  store      = all n chunks, one per failure domain
  recover    = ANY k of the n chunks rebuild the file
  survives   : m = n - k failures
  storage factor   = n / k
  storage overhead = (n - k) / k

  (4, 3)  RAID-5 : survive 1, factor 1.33×, overhead 33%
  (6, 4)  RAID-6 : survive 2, factor 1.50×, overhead 50%
  (14,10) HDFS   : survive 4, factor 1.40×, overhead 40%

ERASURE CODING vs REPLICATION (same 4-failure tolerance)
  EC (14,10) : 40% overhead       ← ~10× less redundant storage
  5× replica : 400% overhead

REMEMBER
  • XOR parity = survive 1.  Reed–Solomon = survive m (independent parities).
  • Coding handles ERASURES; CHECKSUMS detect corruption. Use both.
  • Spread chunks across independent failure domains or fault tolerance is a lie.
```

---

## 12. Summary

- Disks and nodes fail constantly; the only defense is storing **structured redundancy** so survivors can rebuild what's lost.
- **Replication** is dead simple but pays one full copy per tolerated failure — `r = 3` survives 2 failures at **200%** overhead.
- **XOR parity (RAID-5)** survives **one** failure for only `1/k` overhead by storing `P = D1 ⊕ D2 ⊕ … ⊕ Dk`; the lost chunk is recovered as the **XOR of all survivors** — proven with concrete bytes and runnable code.
- XOR has a hard ceiling: **one parity → one failure.** Surviving `m` failures needs `m` *independent* parities, which is what **Reed–Solomon** manufactures.
- The universal vocabulary is **`(n, k)`**: split into `k` data chunks, add `m = n − k` parities, store all `n`; **any `k` of `n` rebuild the file**, tolerating `m` losses at `n/k` storage. `(14, 10)` survives 4 failures at **1.4×** — versus 5× replication's 5×.
- Erasure coding handles **known erasures**, not silent corruption — pair it with **checksums**, and spread chunks across independent failure domains.
- It runs everywhere bytes must survive partial loss cheaply: RAID, HDFS, Backblaze, Ceph, S3-class stores, CDs, QR codes, deep-space links.

**Next:** [middle](middle.md) introduces the finite field `GF(2^8)` and shows how Reed–Solomon turns data chunks into polynomial evaluations; [senior](senior.md) covers the encoding/decoding matrices, repair as solving a linear system, and production concerns like repair bandwidth and locally repairable codes.

---

## 13. Further reading

- **Within this roadmap:**
  - [Bit Manipulation / XOR](../../18-bit-manipulation/02-xor-pairing/junior.md) — the XOR algebra (`a⊕a=0`, associativity) that makes parity work.
  - [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md) — the wrap-around arithmetic that finite-field (`GF(2^8)`) operations build on.
  - [middle](middle.md) and [senior](senior.md) — finite fields, polynomial encoding, and matrix-based Reed–Solomon decoding.
- **External:**
  - James S. Plank, *"A Tutorial on Reed-Solomon Coding for Fault-Tolerance in RAID-like Systems"* — the classic, approachable introduction.
  - Backblaze blog, *"Reed-Solomon: How We Make Files Durable"* — a real production system explained, with open-source code.
  - HDFS Erasure Coding design docs (Apache Hadoop 3) — replication vs erasure coding trade-offs at data-lake scale.
  - *"Erasure Coding in Windows Azure Storage"* (Huang et al., USENIX ATC 2012) — Local Reconstruction Codes and repair-cost engineering at hyperscale.
