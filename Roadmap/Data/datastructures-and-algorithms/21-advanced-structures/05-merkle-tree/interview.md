# Merkle Tree (Hash Tree) — Interview Preparation

> 40+ tiered questions (junior → middle → senior → professional) with model answers, plus a full coding challenge: build a Merkle tree and generate/verify an inclusion proof, in Go, Java, and Python.

---

## How to use this file

Work top-down. The junior questions check that you can describe the structure and its complexity; middle questions probe proofs and sync; senior questions test real systems; professional questions test the security reductions. The coding challenge at the end is the one most likely to be asked live — practice writing it from scratch.

---

## Junior Questions (What / How)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a Merkle tree? | Binary tree; leaves = hashes of data blocks; each internal node = hash of its two children's hashes; single root commits to all data. |
| 2 | What is the Merkle root and why is it useful? | One fixed-size hash summarizing the whole dataset; publish it to commit; any change flips it. |
| 3 | How do you detect tampering with a Merkle tree? | Rebuild the root from the data and compare to the trusted root; mismatch ⇒ tampered. |
| 4 | What is the time and space complexity to build a tree of n blocks? | O(n) time (~2n hashes), O(n) space. |
| 5 | Why hash the blocks at the leaves instead of storing the raw blocks? | Fixed-size uniform nodes + tamper detection; storing raw blocks gives no integrity benefit. |
| 6 | Does the order of children matter when hashing a parent? | Yes — `H(L·R) ≠ H(R·L)`; proofs must record left/right. |
| 7 | What happens to the root if a single bit in one block changes? | The leaf hash changes, propagating new hashes up its path, changing the root entirely. |
| 8 | How is an odd number of leaves handled? | Convention: duplicate the last node (Bitcoin) or promote it unchanged (RFC 6962); both sides must agree. |
| 9 | What is a Merkle proof (authentication path) in one sentence? | The set of sibling hashes from a leaf up to the root that lets you recompute and check the root. |
| 10 | Roughly how many hashes does a proof need for 1,000,000 blocks? | About log₂(10⁶) ≈ 20. |

### Selected junior answers

**Q1.** A Merkle tree (hash tree) is a binary tree where each leaf holds the hash of one data block, and each internal node holds the hash of the concatenation of its two children's hashes. Repeating up to a single node yields the **Merkle root**, a fingerprint that depends on every block.

**Q3.** You recompute the tree (or just the affected path) from the current data and compare the resulting root with a trusted root obtained out-of-band. If they differ, something changed. By walking *down* and comparing subtree hashes you can localize *which* block changed in O(log n) comparisons rather than scanning all blocks.

**Q7.** Changing one bit changes that block's leaf hash, which changes its parent, grandparent, and so on up to the root — exactly the O(log n) nodes on the path. Everything off the path is unaffected, which is what makes single-leaf updates cheap.

---

## Middle Questions (Why / When)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Why is a Merkle proof O(log n) and not O(n)? | One sibling per level; tree height is log₂ n. |
| 2 | How does a verifier check a proof without the full dataset? | Hash the block, fold in each sibling (respecting left/right), compare final hash to the trusted root. |
| 3 | Merkle tree vs flat hash `H(all data)` — when does each win? | Flat hash: tiny, whole-file integrity. Merkle: partial verification, cheap updates, diff/sync. |
| 4 | How does Merkle-based diff/sync (anti-entropy) work? | Exchange roots; recurse only into differing subtrees; reach differing leaves; O(d log n). |
| 5 | What is the cost of updating one leaf? | O(log n): re-hash only the path to the root. |
| 6 | Why must the verifier trust the root, and where does it come from? | The root is the anchor; a proof against an attacker's root proves nothing. From consensus/signature/baked-in. |
| 7 | What is domain separation and why is it needed? | Tag leaves vs nodes (`0x00`/`0x01`) to stop passing an internal node off as a leaf (second-preimage). |
| 8 | What is a consistency proof? | Append-only proof that a larger tree extends a smaller one without rewriting past leaves; O(log n). |
| 9 | Why a tree and not a sorted list of per-bucket hashes for sync? | The tree prunes whole matching subtrees in one comparison → O(d log n) vs shipping all n hashes. |
| 10 | What does a proof leak about other data? | Neighbor (sibling) hashes; can reveal equality/low-entropy values — salt leaves for privacy. |

### Selected middle answers

**Q2.** The verifier starts with `running = H(block)`, then for each `(sibling, side)` in the proof sets `running = H(running · sibling)` if the sibling is on the right, else `H(sibling · running)`. After folding all `log n` siblings, it compares `running` to the trusted root. Equal ⇒ the block is the committed leaf.

**Q4.** Two replicas each build a Merkle tree. They exchange roots; if equal, they are in sync (one round-trip). If not, they exchange the root's children and recurse **only** into subtrees whose hashes differ, skipping matching ones. They bottom out at the differing leaves (buckets/rows), which are the only data repaired. Cost is O(d log n) hashes for d differences — far cheaper than streaming everything. This is Cassandra/DynamoDB anti-entropy repair.

**Q7.** Without separation, a leaf `H(block)` and an internal node `H(L·R)` use the same function, so an attacker can claim a "block" whose value equals `L·R` and reuse the upper tree to forge a proof — no hash break needed. Tagging leaves with `0x00` and nodes with `0x01` makes the two domains disjoint, so the forgery now requires a genuine cross-tag collision.

---

## Senior Questions (Systems)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How does Bitcoin use Merkle trees? | Each block header holds a Merkle root of transactions; SPV clients verify tx inclusion via the branch without the full block. |
| 2 | How does Ethereum's state commitment differ from Bitcoin's? | Three Merkle–Patricia tries (state/tx/receipts), keyed by address, proving inclusion *and absence*; re-hash only touched paths. |
| 3 | Indexed Merkle tree vs Merkle–Patricia trie — when each? | Indexed: prove by position (ordered list). Patricia: prove by key + prove absence (maps). |
| 4 | What is a sparse Merkle tree and what does it add? | Fixed-depth tree over a huge keyspace with default hashes; proves non-inclusion; deterministic root. |
| 5 | How do Git and IPFS use Merkle DAGs? | Content-addressed objects; root hash commits to whole snapshot; diffs transfer only missing objects. |
| 6 | What is a Merkle Mountain Range and why use it? | Append-optimized forest of perfect trees; O(log n) amortized append, immutable subtrees, consistency proofs. |
| 7 | Explain Bitcoin's duplicate-leaf vulnerability. | Duplicate-last odd handling makes distinct tx lists share a root (CVE-2012-2459) — a DoS; fixed by promote rule. |
| 8 | How do you scale anti-entropy without over-streaming? | Tune leaf/bucket granularity, subrange/incremental repair, tree-over-ranges not over-rows. |
| 9 | Why is the trusted root the critical security boundary? | All proof soundness is relative to it; compromise it and every proof is meaningless. |
| 10 | How does Certificate Transparency use Merkle trees? | Append-only log of certs; inclusion + consistency proofs; gossip roots to detect split views. |

### Selected senior answers

**Q1.** Each Bitcoin block header (≈80 bytes) contains the 32-byte Merkle root of that block's transactions. An SPV client downloads only headers (secured by proof-of-work) and, to confirm its transaction is in a block, requests the **Merkle branch** (authentication path). It folds the branch up to the root and checks it against the header — O(log n) hashes, no full block download. Bitcoin uses double-SHA-256 and duplicate-last odd handling.

**Q4.** A sparse Merkle tree is a fixed-depth (e.g., 256) Merkle tree over the entire key space. Almost all leaves are empty, represented implicitly by precomputed **default hashes** per level, so only non-empty nodes are stored. Because the leaf for any key has a defined (possibly empty) value, you can produce **non-inclusion proofs** — show the path to where the key would be and that it is empty — which a plain indexed Merkle tree cannot do. The root is deterministic regardless of insertion order.

---

## Professional Questions (Proofs / Theory)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove that a verifying inclusion proof implies genuine membership. | Reduction: climb the path to the first agreeing height → exhibit a hash collision. |
| 2 | State the position-binding property formally. | No PPT adversary outputs `(R,i,m,π,m',π')` with `m≠m'` and both verify, except negl. |
| 3 | Derive the exact hash count to build a tree of n leaves. | n leaves + (n−1) internal = 2n−1 = Θ(n). |
| 4 | Why does domain separation reduce second-preimage to collision resistance? | Tagged leaf/node domains are disjoint; forgery needs a cross-tag collision. |
| 5 | Prove the O(d log n) bound for reconciliation. | Visited internal nodes ⊆ union of d root-to-leaf paths ≤ d·H. |
| 6 | What hardness assumption do Merkle proofs rely on? | Collision resistance of the hash; (sometimes random-oracle for stronger claims). |
| 7 | Are Merkle commitments post-quantum? Compare to KZG. | Yes (hash-based, only CR); KZG needs pairings + trusted setup, not PQ. |
| 8 | Formalize a consistency proof and its soundness. | Shared perfect-subtree hashes recompute both roots; altering old leaf ⇒ collision. |
| 9 | Why is Bitcoin's MTR not injective? | Duplicate-last lets distinct sequences map to the same root. |
| 10 | Compare Merkle vs RSA accumulator vs hash list as commitments. | Proof size, assumptions, PQ, trusted setup, (non-)membership. |

### Selected professional answers

**Q1 (sketch).** Suppose an adversary outputs `(m*, i, π*)` that verifies against the honest root `R` but `m* ≠ m_i`. Run the honest fold and the adversarial fold for position `i` in parallel. If their leaf hashes already collide, output that collision. Otherwise the leaf values differ but both folds end at `R`, so let `t` be the smallest height where they agree: at height `t` we have two distinct preimages (the honest vs adversarial child-concatenations, which differ because they disagree at height `t−1`) hashing to the same value — a collision. Either way we extract a collision in `H`, so forging succeeds only with probability ≤ `Adv_CR(H)` = negligible. Therefore a verifying proof implies genuine membership.

**Q5.** When reconciling two equal-shape trees, we visit an internal node only if its subtree contains a differing leaf — i.e., it is an ancestor of some differing leaf. Each differing leaf has at most `H = ⌈log₂ n⌉` ancestors, and there are `d` differing leaves, so the visited set is contained in the union of `d` root-to-leaf paths, of size ≤ `d·H = O(d log n)`. Pruning matching subtrees is sound because equal hashes imply equal subtrees except with negligible collision probability.

**Q2.** A vector commitment is **position-binding** if for every PPT adversary `A`:
```
Pr[ (R, i, m, π, m', π') ← A : m ≠ m' ∧ Verify(m,i,π,R)=1 ∧ Verify(m',i,π',R)=1 ] ≤ negl(λ).
```
Intuitively: nobody can open the same root `R` at the same position `i` to two different values. For Merkle trees this reduces to collision resistance (any such double-opening yields a hash collision somewhere on position `i`'s path).

**Q4.** Without domain separation, the leaf image set `{H(m)}` and the node image set `{H(L·R)}` overlap, so a verifier cannot tell a leaf from an internal node — an attacker presents an internal node's preimage `L·R` as a "leaf value." Tagging leaves with `0x00` and nodes with `0x01` makes the two preimage domains disjoint (`0x00·m` vs `0x01·L·R` can never be equal as byte strings). For the type-confusion to still work the attacker would need `H(0x00·m) = H(0x01·L·R)` — a genuine collision. So second-preimage tree forgery is reduced to collision resistance.

**Q8.** A consistency proof for an append-only log shows that the size-`n` root `R_n` extends the size-`m` root `R_m` (`m<n`) without altering old leaves. The prover supplies the `O(log n)` hashes of the **perfect subtrees fully contained in `[0,m)`** that are shared by both trees. The verifier recomputes `R_m` from just those shared hashes and recomputes `R_n` from the shared hashes plus the new (appended) ones. If both match, then changing any old leaf would have changed one shared subtree hash — contradicting one recomputation, i.e., implying a collision. Hence (under CR) old leaves are provably unchanged. This is what CT monitors use to detect a log rewriting history.

**Q10.**

| Commitment | Proof size | Non-membership | Assumption | Post-quantum | Trusted setup |
|---|---|---|---|---|---|
| Merkle tree | O(log n) | only sparse/MPT | collision resistance | yes | no |
| Hash list | O(1) but O(n) commitment | no | CR | yes | no |
| RSA accumulator | O(1) | yes | strong RSA | no | depends |
| KZG polynomial | O(1) | yes | q-SDH + pairings | no | yes |

Merkle wins on transparency and post-quantum safety at the cost of logarithmic (not constant) proofs.

---

## Behavioral / Design Discussion Questions

These are open-ended; the interviewer wants to see structured reasoning, not a single right answer.

1. **You are designing a software update system. Why might you ship a Merkle root instead of a plain SHA-256 of the whole package?** (Partial verification of chunks, resumable/parallel download from many mirrors, cheap incremental updates of only changed files.)
2. **A teammate proposes hashing leaves and nodes the same way "to keep it simple." What do you say?** (Second-preimage/type-confusion risk; insist on domain separation for any adversarial input.)
3. **How would you let a mobile client verify a transaction without storing the chain?** (Light client holds block headers with Merkle roots; request an inclusion branch; verify in O(log n).)
4. **Two database replicas drifted. How do you reconcile without shipping terabytes?** (Merkle anti-entropy: exchange roots, descend mismatches, repair only differing buckets; tune granularity.)
5. **Where does the "trusted root" come from, and why does it matter?** (Consensus/signature/baked-in; a proof against an attacker-chosen root proves nothing.)
6. **Your proofs are too big for the bandwidth budget. Options?** (Larger blocks → fewer leaves; compressed sparse proofs; or switch to constant-size KZG if a trusted setup is acceptable.)

---

## Rapid-Fire (mixed)

| # | Question | Answer |
|---|----------|--------|
| 1 | Proof size for n = 2²⁰ with SHA-256? | 20 × 32 = 640 bytes |
| 2 | Does a Merkle tree prove non-membership? | Not plain; sparse Merkle tree / Patricia trie do |
| 3 | What hash does Bitcoin use? | Double SHA-256 |
| 4 | What is "bagging the peaks"? | Hashing MMR mountain peaks into one root |
| 5 | Why is Git a Merkle DAG, not a tree? | Objects can have many children and be shared (dedup) |
| 6 | What replaces SHA-1 in modern Merkle systems? | SHA-256 / SHA-3 (SHA-1 collisions broken) |
| 7 | Constant-size-proof alternative to Merkle? | KZG / polynomial commitments |
| 8 | What does CT gossip to detect a misbehaving log? | Signed tree roots (STHs) + consistency proofs |
| 9 | How do you privacy-protect leaves? | Salt/blind: `H(0x00 · salt · block)` |
| 10 | Min proof length for a single-leaf tree? | 0 (root = leaf hash) |
| 11 | What does the direction bit in a proof encode? | Whether the sibling is left or right, so concatenation order is correct |
| 12 | Cost to update one leaf? | O(log n) — re-hash only its path |
| 13 | What is an STH in Certificate Transparency? | Signed Tree Head: signed root + size + timestamp |
| 14 | Why hash leaves rather than store blocks? | Fixed-size uniform nodes + integrity; blocks alone give no proof benefit |
| 15 | Tree-over-rows vs tree-over-ranges in anti-entropy? | Ranges keep tree size independent of row count |

---

## Scenario Deep-Dives

### Scenario A — "Design BitTorrent-style verified download"
**Prompt.** A file is fetched in 256 KB chunks from many untrusted peers, possibly out of order. Verify each chunk as it arrives.
**Answer.** Publish (or fetch from a trusted source) the Merkle root of the chunk list. For each received chunk, fetch its authentication path and `verify(chunk, path, root)` before accepting — O(log n) hashes per chunk, independent of arrival order. A corrupted chunk fails immediately and is re-fetched from another peer; you never need the whole file to validate a part. This is precisely BitTorrent v2's per-file Merkle trees.

### Scenario B — "Light wallet confirms a payment"
**Prompt.** A phone wallet must confirm "transaction T is in block H" without storing the chain.
**Answer.** The wallet keeps block headers (each containing a transaction Merkle root, secured by proof-of-work). It requests T's Merkle branch from a full node, folds it up, and compares to the header's root. O(log n) hashes; no full block. Caveat: SPV trusts that the header chain is the heaviest — it verifies *inclusion*, not *validity* of every other transaction.

### Scenario C — "Reconcile two diverged replicas"
**Prompt.** Two Cassandra replicas of the same token range disagree on a few rows after a partition.
**Answer.** Each builds a Merkle tree over key ranges (leaves hash buckets of rows). Exchange roots; descend only into mismatched subtrees; bottom out at the differing buckets; stream and reconcile only those. O(d log n) for d differences. Trade-off: bucket granularity — too coarse over-streams a big bucket for one bad row; too fine inflates the tree and build cost.

### Scenario D — "Prove an account does NOT exist"
**Prompt.** A user claims they were never registered; prove the absence of their key.
**Answer.** A plain indexed Merkle tree cannot do this. Use a sparse Merkle tree or Merkle–Patricia trie: produce the path to where the key would live and show the leaf is the empty/default value (SMT) or that the trie path diverges/terminates without the key (MPT). Both are O(depth) and verify against the same trusted root that proves inclusions.

---

## Coding Challenge — Build a Merkle Tree + Generate/Verify a Proof

> **Problem.** Implement a Merkle tree over a list of data blocks using SHA-256 with **domain separation** (`0x00` for leaves, `0x01` for internal nodes) and **duplicate-last** odd handling. Expose: `Root()`, `Proof(index)`, and a standalone `Verify(block, proof, root)`. The proof must encode left/right direction so the verifier can recompute the root. Demonstrate that a valid proof passes and a tampered block fails.
>
> **Constraints.** Build O(n); proof and verify O(log n). Handle 1 block (empty proof) and odd counts.

### Go

```go
package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
)

func h(b []byte) []byte { s := sha256.Sum256(b); return s[:] }
func hLeaf(block []byte) []byte { return h(append([]byte{0x00}, block...)) }
func hNode(l, r []byte) []byte {
	buf := make([]byte, 0, 1+len(l)+len(r))
	buf = append(buf, 0x01)
	buf = append(buf, l...)
	buf = append(buf, r...)
	return h(buf)
}

type Tree struct{ levels [][][]byte }

func Build(blocks [][]byte) *Tree {
	leaves := make([][]byte, len(blocks))
	for i, b := range blocks {
		leaves[i] = hLeaf(b)
	}
	t := &Tree{levels: [][][]byte{leaves}}
	for len(t.levels[len(t.levels)-1]) > 1 {
		cur := t.levels[len(t.levels)-1]
		var next [][]byte
		for i := 0; i < len(cur); i += 2 {
			r := cur[i]
			if i+1 < len(cur) {
				r = cur[i+1]
			}
			next = append(next, hNode(cur[i], r))
		}
		t.levels = append(t.levels, next)
	}
	return t
}

func (t *Tree) Root() []byte { return t.levels[len(t.levels)-1][0] }

type Step struct {
	Hash    []byte
	IsRight bool // sibling sits to the right of the running hash
}

func (t *Tree) Proof(idx int) []Step {
	var path []Step
	j := idx
	for level := 0; level < len(t.levels)-1; level++ {
		cur := t.levels[level]
		sib := j ^ 1
		isRight := j%2 == 0
		if sib >= len(cur) {
			sib = j // duplicate-last
		}
		path = append(path, Step{Hash: cur[sib], IsRight: isRight})
		j >>= 1
	}
	return path
}

func Verify(block []byte, proof []Step, root []byte) bool {
	run := hLeaf(block)
	for _, s := range proof {
		if s.IsRight {
			run = hNode(run, s.Hash)
		} else {
			run = hNode(s.Hash, run)
		}
	}
	return bytes.Equal(run, root)
}

func main() {
	blocks := [][]byte{[]byte("alice"), []byte("bob"), []byte("carol"), []byte("dave"), []byte("erin")}
	t := Build(blocks)
	root := t.Root()
	idx := 2
	proof := t.Proof(idx)
	fmt.Printf("root          : %x...\n", root[:6])
	fmt.Printf("proof length  : %d\n", len(proof))
	fmt.Printf("valid (carol) : %v\n", Verify(blocks[idx], proof, root)) // true
	fmt.Printf("tampered (eve): %v\n", Verify([]byte("eve"), proof, root)) // false
}
```

### Java

```java
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class MerkleChallenge {
    static byte[] sha(byte[] b) {
        try { return MessageDigest.getInstance("SHA-256").digest(b); }
        catch (Exception e) { throw new RuntimeException(e); }
    }
    static byte[] hLeaf(byte[] block) {
        byte[] x = new byte[block.length + 1]; x[0] = 0x00;
        System.arraycopy(block, 0, x, 1, block.length); return sha(x);
    }
    static byte[] hNode(byte[] l, byte[] r) {
        byte[] x = new byte[1 + l.length + r.length]; x[0] = 0x01;
        System.arraycopy(l, 0, x, 1, l.length);
        System.arraycopy(r, 0, x, 1 + l.length, r.length); return sha(x);
    }

    static final List<List<byte[]>> levels = new ArrayList<>();

    static void build(List<byte[]> blocks) {
        levels.clear();
        List<byte[]> leaves = new ArrayList<>();
        for (byte[] b : blocks) leaves.add(hLeaf(b));
        levels.add(leaves);
        while (levels.get(levels.size() - 1).size() > 1) {
            List<byte[]> cur = levels.get(levels.size() - 1);
            List<byte[]> next = new ArrayList<>();
            for (int i = 0; i < cur.size(); i += 2) {
                byte[] r = (i + 1 < cur.size()) ? cur.get(i + 1) : cur.get(i);
                next.add(hNode(cur.get(i), r));
            }
            levels.add(next);
        }
    }

    static byte[] root() { return levels.get(levels.size() - 1).get(0); }

    record Step(byte[] hash, boolean isRight) {}

    static List<Step> proof(int idx) {
        List<Step> path = new ArrayList<>();
        int j = idx;
        for (int level = 0; level < levels.size() - 1; level++) {
            List<byte[]> cur = levels.get(level);
            int sib = j ^ 1;
            boolean isRight = (j % 2 == 0);
            if (sib >= cur.size()) sib = j;
            path.add(new Step(cur.get(sib), isRight));
            j >>= 1;
        }
        return path;
    }

    static boolean verify(byte[] block, List<Step> proof, byte[] root) {
        byte[] run = hLeaf(block);
        for (Step s : proof)
            run = s.isRight() ? hNode(run, s.hash()) : hNode(s.hash(), run);
        return Arrays.equals(run, root);
    }

    public static void main(String[] args) {
        List<byte[]> blocks = new ArrayList<>();
        for (String s : new String[]{"alice", "bob", "carol", "dave", "erin"})
            blocks.add(s.getBytes());
        build(blocks);
        byte[] root = root();
        int idx = 2;
        List<Step> p = proof(idx);
        System.out.println("proof length  : " + p.size());
        System.out.println("valid (carol) : " + verify(blocks.get(idx), p, root));
        System.out.println("tampered (eve): " + verify("eve".getBytes(), p, root));
    }
}
```

### Python

```python
import hashlib
from dataclasses import dataclass


def sha(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def h_leaf(block: bytes) -> bytes:
    return sha(b"\x00" + block)


def h_node(l: bytes, r: bytes) -> bytes:
    return sha(b"\x01" + l + r)


@dataclass
class Step:
    hash: bytes
    is_right: bool


class MerkleTree:
    def __init__(self, blocks: list[bytes]):
        leaves = [h_leaf(b) for b in blocks]
        self.levels: list[list[bytes]] = [leaves]
        while len(self.levels[-1]) > 1:
            cur = self.levels[-1]
            nxt = []
            for i in range(0, len(cur), 2):
                r = cur[i + 1] if i + 1 < len(cur) else cur[i]   # duplicate-last
                nxt.append(h_node(cur[i], r))
            self.levels.append(nxt)

    def root(self) -> bytes:
        return self.levels[-1][0]

    def proof(self, idx: int) -> list[Step]:
        path, j = [], idx
        for level in range(len(self.levels) - 1):
            cur = self.levels[level]
            sib = j ^ 1
            is_right = (j % 2 == 0)
            if sib >= len(cur):
                sib = j
            path.append(Step(cur[sib], is_right))
            j >>= 1
        return path


def verify(block: bytes, proof: list[Step], root: bytes) -> bool:
    run = h_leaf(block)
    for s in proof:
        run = h_node(run, s.hash) if s.is_right else h_node(s.hash, run)
    return run == root


if __name__ == "__main__":
    blocks = [b"alice", b"bob", b"carol", b"dave", b"erin"]
    t = MerkleTree(blocks)
    root = t.root()
    idx = 2
    p = t.proof(idx)
    print("proof length  :", len(p))
    print("valid (carol) :", verify(blocks[idx], p, root))    # True
    print("tampered (eve):", verify(b"eve", p, root))         # False
```

### Test cases the interviewer may ask you to handle

| Case | Input | Expected |
|---|---|---|
| Single block | `["a"]`, prove 0 | empty proof; verify true |
| Two blocks | `["a","b"]`, prove 1 | one-step proof; verify true |
| Odd count | 5 blocks, prove last | duplicate-last; verify true |
| Wrong index proof | proof(1) used for block 2 | verify false |
| Tampered block | swap one block | verify false |
| Large n | 2²⁰ blocks | proof length 20 |

### Follow-ups they may push on

- **"Make updates O(log n)."** Re-hash only the path from the changed leaf to the root.
- **"Add non-inclusion proofs."** Switch to a sparse Merkle tree or Merkle–Patricia trie.
- **"Why domain separation?"** Prevents passing an internal node off as a leaf (second-preimage).
- **"Where does the trusted root come from?"** Consensus, a signed header, or a baked-in value — never the prover.

### Live-coding pitfalls graders watch for

1. **Wrong concatenation order.** Folding `H(sibling · running)` when the sibling is on the right (or vice versa) silently produces a wrong root. Always derive the side from `index & 1` at each level.
2. **Forgetting odd-leaf handling.** Looping `i += 2` without the `i+1 < len` guard crashes or drops the last leaf. Decide duplicate-vs-promote and code it.
3. **Mutating the input blocks.** Copy before hashing if the caller may reuse the slice.
4. **Off-by-one in the proof length.** It must equal tree height; a single-leaf tree has an *empty* proof.
5. **Comparing digests with reference equality** (`==` on arrays in Java/Go) instead of `Arrays.equals` / `bytes.Equal`.
6. **Hashing the raw block at internal nodes.** Internal nodes hash child *hashes*, never raw data.

### Walkthrough the interviewer may ask you to narrate

```text
build([a,b,c,d]):
  leaves = [H(a), H(b), H(c), H(d)]
  level1 = [H(H(a)·H(b)), H(H(c)·H(d))]
  root   =  H(level1[0]·level1[1])

proof(index=2):        # prove c
  level0: idx=2 even → sibling = leaves[3]=H(d), side=RIGHT, idx→1
  level1: idx=1 odd  → sibling = level1[0]=H(H(a)·H(b)), side=LEFT, idx→0
  proof = [(H(d),RIGHT), (H(H(a)·H(b)),LEFT)]

verify(c, proof, root):
  r = H(c)
  r = H(r · H(d))                 # sibling RIGHT
  r = H(H(H(a)·H(b)) · r)         # sibling LEFT
  return r == root                # true
```

Being able to narrate this small trace fluently is usually enough to pass the Merkle portion of an interview.

---

## Extra Tiered Questions (mixed depth)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How big is a proof if you use 4 KB blocks for a 4 GB file? | n ≈ 10⁶ leaves → ~20 hashes ≈ 640 bytes |
| 2 | What breaks if two systems use different odd-leaf rules? | Roots never match → all cross-system proofs fail |
| 3 | Can you parallelize tree construction? | Yes — leaf hashing is independent; level builds are data-parallel |
| 4 | Why is the root alone not "hiding"? | Guessable/low-entropy blocks can be confirmed by recomputing the leaf |
| 5 | How does Git detect a corrupted object? | Recompute the object's hash; mismatch with its name = corruption |
| 6 | What is the difference between an inclusion proof and a consistency proof? | Inclusion: one leaf is in the tree. Consistency: a bigger tree append-extends a smaller one |
| 7 | Why does Ethereum re-hash only touched paths per block? | Only changed accounts alter their root-paths; rest of state is untouched — O(changed · log n) |
| 8 | When would you pick KZG over Merkle? | When constant-size proofs matter and a trusted setup + pairings are acceptable (not PQ) |
| 9 | How do you defend against a forged root being served to a light client? | Anchor the root via signature/consensus; never accept a prover-supplied root |
| 10 | What is the storage of a sparse Merkle tree with k non-empty leaves? | O(k · depth) — empty subtrees are implicit default hashes |

---

## One-Page Cheat Sheet for the Interview

```text
DEFINITION
  leaf  = H(0x00 · block)          node = H(0x01 · left · right)
  root  commits to all blocks; publish 32 bytes to anchor everything

COMPLEXITY
  build O(n)   proof/verify/update O(log n)   diff O(d log n)   memory O(n)

PROOF
  generate: for each level, sibling = index XOR 1, record side, index >>= 1
  verify  : run = H(0x00·block); fold each sibling (L/R); compare to trusted root
  soundness: a verifying proof ⇒ collision if the block isn't the real leaf

MUST-SAY KEYWORDS
  domain separation · trusted root anchor · O(log n) authentication path ·
  anti-entropy (O(d log n)) · non-inclusion needs sparse/Patricia ·
  Bitcoin double-SHA-256 duplicate-last (CVE-2012-2459) · Merkle DAG (Git/IPFS)

SYSTEMS
  Bitcoin SPV · Ethereum 3 MPT roots · Git/IPFS Merkle DAG ·
  Cassandra/DynamoDB anti-entropy · Certificate Transparency · BitTorrent v2
```

---

**Next step:** [tasks.md](./tasks.md) — graded practice tasks (beginner, intermediate, advanced) implementing Merkle trees, proofs, anti-entropy diffing, sparse trees, and MMRs in Go, Java, and Python.
