# Merkle Tree (Hash Tree) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Use SHA-256 with domain separation (`0x00` leaves, `0x01` nodes) unless a task says otherwise. Verify against a brute-force or library reference where possible.

---

## Beginner Tasks

**Task 1: Build a Merkle tree and return its root.**
Given a list of byte blocks, hash each into a leaf, pair-and-hash up to a single root, and return it. Use duplicate-last for odd levels.

#### Go

```go
package main

func merkleRoot(blocks [][]byte) []byte {
	// 1. leaves = H(0x00 · block)
	// 2. while >1 node: pair (duplicate last if odd), parent = H(0x01 · L · R)
	// 3. return the last remaining node
	return nil
}

func main() {}
```

#### Java

```java
public class Task1 {
    static byte[] merkleRoot(java.util.List<byte[]> blocks) {
        // implement
        return null;
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
def merkle_root(blocks: list[bytes]) -> bytes:
    # implement
    ...

if __name__ == "__main__":
    print(merkle_root([b"a", b"b", b"c"]).hex()[:12])
```

- **Constraints:** O(n) hashes; handle 1 block (root = leaf hash) and empty input (define a sentinel).
- **Expected Output:** deterministic 32-byte root; same input ⇒ same root.
- **Evaluation:** correctness vs a hand-computed 4-block example; odd-count handling.

**Task 2: Tamper detection.**
Write `isIntact(blocks, trustedRoot) -> bool` that rebuilds the root and compares. Then write `whichChanged(originalBlocks, currentBlocks) -> [indices]` that returns the indices of blocks whose leaf hash changed (brute force is fine here).

- Constraints: do not mutate inputs.
- Demonstrate: flip one byte in one block and show `isIntact` returns false.

**Task 3: Generate an inclusion proof.**
Implement `proof(blocks, index) -> list[(siblingHash, isRight)]`. Return one sibling per level with the correct direction bit.

- Constraints: O(log n); proof length must equal tree height.
- Test: first leaf, last leaf, single-leaf tree (empty proof).

**Task 4: Verify an inclusion proof.**
Implement standalone `verify(block, proof, trustedRoot) -> bool` (no access to the tree). Fold the leaf hash up through the siblings respecting left/right.

- Constraints: O(log n); O(1) extra memory.
- Test: valid proof passes; swapping the block or shuffling proof order fails.

**Task 5: Pretty-print the tree.**
Render the tree level by level (root at top), printing a short hex prefix of each node and its `[lo,hi]` index range. Useful for debugging the other tasks.

- Constraints: works for non-power-of-two sizes.
- Expected Output: a readable ASCII tree for 5–8 blocks.

---

## Intermediate Tasks

**Task 6: O(log n) single-leaf update.**
Store the full tree (all levels). Implement `update(index, newBlock)` that re-hashes **only** the path from the changed leaf to the root, then returns the new root. Assert it equals a full rebuild's root.

- Constraints: must touch only O(log n) nodes (instrument and count them).
- Test: random sequence of updates vs full-rebuild reference.

**Task 7: Anti-entropy diff.**
Given two trees of the **same shape** built from two slightly different block lists, implement `diff(treeA, treeB) -> [indices]` that descends from the roots and recurses only into differing subtrees, returning the differing leaf indices.

- Constraints: visit O(d log n) nodes for d differences (instrument the visit count).
- Test: make 1, 3, and 10 differences; confirm the visit count stays ~d·log n, not n.

**Task 8: Consistency proof (append-only).**
Treat the blocks as an append-only log. Given the root at size `m` and the current root at size `n > m`, produce and verify a **consistency proof** that the size-n tree extends the size-m tree without altering leaves `0..m-1`.

- Constraints: O(log n) proof; reject if any old leaf was modified.
- Test: append-only passes; modifying an old leaf fails.

**Task 9: Bitcoin-style transaction root.**
Implement a Merkle root using **double SHA-256** (`SHA256(SHA256(x))`), **no domain separation**, and **duplicate-last** odd handling — the actual Bitcoin convention. Then demonstrate the duplicate-leaf ambiguity (CVE-2012-2459): construct two distinct transaction lists that yield the **same** root.

- Constraints: match Bitcoin's byte order conventions for a known test vector if you can find one.
- Deliverable: a short note explaining why the two lists collide.

**Task 10: Proof serialization.**
Define a compact wire format for an inclusion proof: leaf index + concatenated sibling hashes (derive directions from the index). Implement `encode(proof, index)` and `decode(bytes) -> (proof, index)` and round-trip them; verify the decoded proof still validates.

- Constraints: fixed 32-byte hashes; minimal overhead.
- Test: byte-for-byte round-trip; cross-language decode (Go encodes, Python decodes).

---

## Advanced Tasks

**Task 11: Sparse Merkle tree with non-inclusion proofs.**
Implement a fixed-depth (e.g., 16 or 256) sparse Merkle tree with precomputed default hashes. Support `update(key, value)`, `root()`, `prove(key)`, and a `verify` that handles **both** inclusion (`value`) and non-inclusion (`value = empty`).

- Constraints: store only non-default nodes; updates O(depth).
- Test: prove a present key, then prove a sibling key is absent; both must verify against the same root.

**Task 12: Merkle Mountain Range (MMR).**
Implement an append-only MMR: `append(leaf)`, `root()` (bag the peaks), and `proof(pos)` (leaf → its peak → bagged root). Appends must never reshape existing nodes.

- Constraints: O(log n) amortized append; immutable existing subtrees.
- Test: append 1..100 leaves, prove a random old leaf still verifies after later appends.

**Task 13: Concurrent-safe Merkle store with snapshots.**
Wrap a Merkle tree so reads (proofs) and writes (updates) can run concurrently. Use copy-on-write or a read-write lock so a proof always reflects a single consistent root.

- Constraints: a proof generated during a burst of updates must verify against *some* committed root (no torn reads).
- Test: hammer with concurrent updates + proof requests; every returned proof must verify against the root it was issued with.

**Task 14: Anti-entropy over key ranges (Cassandra-style).**
Build a Merkle tree over **ranges** of a key space (each leaf hashes a bucket of rows) on two replicas with a few divergent rows. Implement the repair protocol: exchange roots, descend mismatches, report and "repair" only the differing buckets. Measure bytes exchanged vs a naive full sync.

- Constraints: tree-over-ranges (size independent of row count); tune bucket granularity.
- Deliverable: a table of bytes exchanged for d = 1, 10, 100 differences.

**Task 15: Merkle DAG (mini Git/IPFS).**
Implement a content-addressed Merkle DAG: `putBlob(bytes) -> CID`, `putTree(entries) -> CID`, where a CID is the hash of the node's content and trees reference children by CID. Demonstrate **deduplication** (identical blobs share a CID) and **snapshot commitment** (changing one blob changes only the CIDs on its path to the root).

- Constraints: nodes are immutable and addressed by hash; support directories of directories.
- Test: build two snapshots differing in one file; show that only the path of CIDs changed and unchanged blobs are reused.

---

## Benchmark Task

> Compare proof generation + verification time as n grows, across all 3 languages. The time should grow **logarithmically** in n.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	for _, k := range []int{10, 12, 14, 16, 18} {
		n := 1 << k
		blocks := make([][]byte, n)
		for i := range blocks {
			blocks[i] = []byte(fmt.Sprintf("b%d", i))
		}
		t := Build(blocks)       // from your Task 6 implementation
		root := t.Root()
		start := time.Now()
		for i := 0; i < 20000; i++ {
			p := t.Proof(i % n)
			_ = Verify(blocks[i%n], p, root)
		}
		fmt.Printf("n=2^%d: %.3f us/op\n", k, float64(time.Since(start).Microseconds())/20000)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        for (int k : new int[]{10, 12, 14, 16, 18}) {
            int n = 1 << k;
            List<byte[]> blocks = new ArrayList<>();
            for (int i = 0; i < n; i++) blocks.add(("b" + i).getBytes());
            // build tree, get root via your implementation
            long start = System.nanoTime();
            for (int i = 0; i < 20000; i++) {
                // p = proof(i % n); verify(blocks.get(i % n), p, root);
            }
            System.out.printf("n=2^%d: %.3f us/op%n", k, (System.nanoTime() - start) / 20000 / 1000.0);
        }
    }
}
```

#### Python

```python
import timeit

for k in (8, 10, 12, 14, 16):
    n = 1 << k
    blocks = [f"b{i}".encode() for i in range(n)]
    t = MerkleTree(blocks)            # from your implementation
    root = t.root()
    secs = timeit.timeit(lambda: verify(blocks[0], t.proof(0), root), number=5000)
    print(f"n=2^{k}: {secs / 5000 * 1e6:.2f} us/op")
```

**What to report:** a table of `n` vs microseconds per proof+verify. Confirm that doubling `n` adds roughly a constant (one extra hash per level), i.e., the curve is logarithmic, not linear.
