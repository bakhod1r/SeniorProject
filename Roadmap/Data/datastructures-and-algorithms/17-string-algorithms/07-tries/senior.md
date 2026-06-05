# Tries (Prefix Trees) for String Processing — Senior Level

> **One-line summary:** At production scale, a trie is a memory-engineering problem first and an algorithm second. This file covers array vs map vs **double-array tries**, **DAWG / MA-FSA** minimization, **IP longest-prefix-match** routing tables, large-dictionary loading and persistence, testing strategies, and the failure modes that bite real systems.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Memory Engineering: Array vs Map vs Double-Array](#memory-engineering-array-vs-map-vs-double-array)
3. [DAWG and MA-FSA: Sharing Suffixes Too](#dawg-and-ma-fsa-sharing-suffixes-too)
4. [Longest-Prefix Match for IP Routing](#longest-prefix-match-for-ip-routing)
5. [Large Dictionaries: Loading, Memory, Cache](#large-dictionaries-loading-memory-cache)
6. [Persistence and Serialization](#persistence-and-serialization)
7. [Concurrency and Immutability](#concurrency-and-immutability)
8. [Testing Strategy](#testing-strategy)
9. [Failure Modes and Operations](#failure-modes-and-operations)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Performance Tips](#performance-tips)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Cheat Sheet](#cheat-sheet)
16. [Visual Animation](#visual-animation)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

A trie that holds a few thousand words in a demo behaves nothing like a trie that holds a 100-million-entry routing table, a 5-million-word spell-check dictionary, or an autocomplete index serving 50k queries per second. At that scale the algorithm (walk `L` edges) is trivially correct and fast; the hard problems are **memory**, **load time**, **cache behavior**, **persistence**, and **concurrency**. A pointer-per-node trie with `map[char]node` children can easily consume 10–20× the size of the raw key data, blowing your memory budget and trashing the CPU cache.

This file is about the engineering. We compare the three canonical node representations and introduce the **double-array trie** (DAT) — the representation used by production tokenizers (MeCab, Kuromoji) and IME dictionaries — which stores the whole trie in two flat integer arrays with near-zero per-node overhead and excellent cache locality. We cover the **DAWG / MA-FSA** (directed acyclic word graph / minimal acyclic finite-state automaton), which shares **suffixes** as well as prefixes, collapsing a dictionary into the minimal DFA recognizing it. We work through **IP longest-prefix match**, the routing-table application where the *deepest* matching prefix wins. We discuss loading multi-gigabyte dictionaries, memory-mapping them, persisting them, making them safe under concurrent reads, and the failure modes (alphabet assumptions, deletion corruption, unbounded memory) that take production tries down.

The senior mindset: pick the representation from the workload. Read-heavy and static? Build a DAWG or double-array trie offline and mmap it. Write-heavy and small? A plain map trie is fine. Longest-prefix routing? A bit-trie / radix structure tuned for the IP-address alphabet.

---

## Memory Engineering: Array vs Map vs Double-Array

| Representation | Per-node cost | Lookup | Build | Mutable? | Best for |
|----------------|--------------|--------|-------|----------|----------|
| Array `[Σ]*node` | Σ pointers always | O(1) index | easy | yes | small fixed alphabet, dense |
| Map `char→node` | hash entries only | O(1) hash | easy | yes | sparse / Unicode |
| List-of-pairs | `deg` pairs | O(deg) scan | easy | yes | tiny degree nodes |
| **Double-array** | ~2 ints/node | O(1) per char | hard (offline) | painful | static, read-heavy, huge |
| DAWG / MA-FSA | minimal states | O(1) per char | medium | no (build once) | static dictionaries |

**Double-array trie (DAT).** Two parallel integer arrays, `base[]` and `check[]`. For a state `s` and input character `c`, the next state is `t = base[s] + code(c)`, valid only if `check[t] == s`. This encodes the entire trie transition table in flat arrays — no per-node objects, no pointers, tiny memory, sequential memory access. The catch: insertion may require relocating a node's whole child block to find a non-colliding `base`, so DATs are built once from a sorted key set and treated as read-only. They are the workhorse of Japanese/CJK tokenizers and large IME dictionaries precisely because the alphabet is huge and the dictionary is static.

The decision is workload-driven: mutable + small → map; mutable + small alphabet + dense → array; static + huge + read-heavy → double-array or DAWG.

---

## DAWG and MA-FSA: Sharing Suffixes Too

A trie shares **prefixes**. A **DAWG** (directed acyclic word graph), equivalently a **minimal acyclic finite-state automaton (MA-FSA)**, also shares **suffixes** by merging equivalent subtrees. The words `nation`, `station`, `ration` all end in `ation`; a trie stores that suffix three times, a DAWG stores it once.

Construction: build the trie (or build incrementally), then **minimize** by merging states that have identical outgoing transitions and identical `isEnd` status — exactly the DFA-minimization equivalence used in automata theory (see `professional.md`). The result is the unique minimal DFA recognizing the finite language of your dictionary. Daciuk's algorithm builds the minimal automaton incrementally from sorted input in linear time.

| | Trie | DAWG / MA-FSA |
|--|------|---------------|
| Shares | prefixes | prefixes **and** suffixes |
| Structure | tree | DAG |
| Size | O(total chars) | minimal DFA states (often far smaller) |
| Mutable | yes | build-once |
| Use | autocomplete, prefix queries | static membership, spell-check, compression |

Trade-off: a DAWG gives the smallest membership structure but, because subtrees are shared, you **lose** the ability to attach distinct per-word data to a node by identity (two words sharing a suffix share the node). If you need per-word values, use a **transducer** variant (FST — finite-state transducer, as in Lucene) that emits an output along the path, or keep a separate value array keyed by a perfect-hash ordinal computed during the walk.

---

## Longest-Prefix Match for IP Routing

A router has a forwarding table of `(prefix, next-hop)` rules like `10.0.0.0/8 → A`, `10.1.0.0/16 → B`, `10.1.2.0/24 → C`. For a destination address it must choose the **most specific** (longest) matching prefix. This is **longest-prefix match (LPM)**, and a binary trie over the address bits is the classic structure.

```
Walk the address bit by bit (MSB first) down a binary trie.
Each node may carry a next-hop (a prefix ends there).
Remember the deepest next-hop seen on the path; that is the answer.
```

- Each prefix `p/len` is a path of `len` bits from the root; mark the node with its next-hop.
- To route a 32-bit (IPv4) or 128-bit (IPv6) address, descend bit by bit; the **last** marked node on the descent is the longest match.
- A default route `0.0.0.0/0` is the root mark — the fallback when nothing deeper matches.

The plain bit-trie is `O(W)` per lookup (`W` = address width, 32 or 128). Production routers compress it: **path-compressed (Patricia) tries**, **multibit tries** (consume several bits per node to cut depth), and **LC-tries / Lulea / DIR-24-8** schemes trade memory for fewer memory accesses. This is the same path-compression idea as the radix trie (sibling `21/24`), specialized to the fixed-width binary alphabet. The integer/XOR bit-trie machinery itself lives in sibling `18-bit-manipulation/06`; here the point is the *longest-prefix-match* semantics — deepest mark wins, with a fallback default.

---

## Large Dictionaries: Loading, Memory, Cache

- **Build from sorted input.** Inserting keys in sorted order improves locality during build and is required for incremental DAWG/DAT construction.
- **Estimate memory before building.** A map-trie node in a managed runtime can be 64–128 bytes plus the map's bucket array. For 50M nodes that is multiple gigabytes — measure, do not guess. Use the space bounds from `professional.md`.
- **Prefer compact representations at scale.** A double-array trie or DAWG can be 5–20× smaller than a pointer trie and lives in contiguous memory, so it stays cache-resident.
- **Intern / pool nodes** if you must use objects, to cut allocator overhead and fragmentation.
- **Cache locality dominates.** A pointer-chasing trie incurs a cache miss per character at depth; a flat double-array trie streams sequentially. At scale, cache misses, not instructions, set your latency.
- **Lazy / chunked loading.** For huge static dictionaries, mmap the serialized structure and let the OS page it in on demand rather than parsing it into the heap.

---

## Persistence and Serialization

A trie built offline should be serialized so it can be loaded without rebuilding:

- **Flat-array formats serialize trivially.** A double-array trie *is* two integer arrays — write them to disk and `mmap` them back. No parsing, instant load, shared across processes.
- **Pointer tries need a layout pass.** Assign each node an ordinal, write nodes in a fixed format with child references as ordinals (not pointers), then reconstruct on load. Or do a structural DFS dump.
- **Versioning.** Embed an alphabet/codec version and a format version in the header; a dictionary built with one character encoding must not be loaded under another.
- **mmap + read-only.** Memory-map the file and treat it as immutable. Multiple processes share one physical copy; the OS handles paging. This is how FST-backed search indices (Lucene) ship terms dictionaries.
- **Checksums.** A truncated or corrupted dictionary file should fail loudly at load (CRC/length check), not silently route packets to the wrong place.

---

## Concurrency and Immutability

- **Read-mostly is the common case.** Build the trie once, then serve concurrent reads. An immutable trie needs **no locks** — readers traverse a structure that never changes.
- **Copy-on-write for updates.** To update an immutable trie, build new nodes along the changed path and share the rest (a persistent/functional trie), then atomically swap the root pointer. Readers see either the old or new root, never a torn state. This is the HAMT idea (hash array mapped trie) applied to string keys.
- **Avoid in-place mutation under concurrent reads.** Inserting into a shared mutable trie without synchronization is a data race; a reader can observe a half-linked node.
- **Sharding.** Partition keys by first character (or hash) across independent tries to spread write contention and parallelize builds.
- **Double-buffering.** Keep an active dictionary serving reads while a background thread builds the next version, then flip an atomic pointer — zero-downtime dictionary reloads.

---

## Testing Strategy

- **Oracle comparison.** Test `search`/`startsWith`/`countPrefix`/autocomplete against a brute-force list-of-strings implementation on random inputs (property-based testing). They must agree for every query.
- **Round-trip serialization.** Build a random trie, serialize, deserialize, and assert identical query answers — catches layout/encoding bugs.
- **Deletion invariants.** After a delete, assert: the word is gone, all *other* words still present, no orphaned nodes, and `passCount` equals an independent recount.
- **Alphabet fuzzing.** Feed Unicode, empty strings, very long keys, keys that are prefixes of each other, and (for array tries) characters outside the assumed range — assert graceful handling.
- **Memory regression.** Track node count and bytes-per-key in CI; a refactor that doubles memory should fail the budget.
- **LPM correctness.** For routing tries, test that the longest matching prefix wins, the default route is the fallback, and overlapping prefixes resolve to the most specific.

---

## Failure Modes and Operations

| Failure | Symptom | Mitigation |
|---------|---------|-----------|
| Array-trie alphabet overflow | crash / corruption on out-of-range char | validate input; use map for arbitrary alphabets |
| Deletion corrupts shared paths | other words vanish or `search` lies | prune only nodes with no children and `passCount==0` |
| Unbounded memory growth | OOM as dictionary grows | use radix/DAWG/double-array; budget bytes-per-key |
| Cache thrash on deep keys | latency spikes under load | flat layout (DAT), shorten depth (multibit/radix) |
| Stale dictionary after reload | wrong answers post-deploy | atomic root/pointer swap, version header, checksum |
| Data race on concurrent insert | torn nodes, intermittent wrong reads | immutable + copy-on-write, or proper locking |
| Wrong char encoding on load | garbled keys, false negatives | embed codec version; fail on mismatch |
| LPM returns wrong route | packets misrouted | test deepest-mark-wins + default fallback explicitly |

---

## Code Examples

### Example: Longest-prefix match over a binary trie (IP routing core)

#### Go

```go
package main

import "fmt"

type RNode struct {
	child   [2]*RNode
	nextHop string
	hasHop  bool
}

type RouteTrie struct{ root *RNode }

func NewRouteTrie() *RouteTrie { return &RouteTrie{root: &RNode{}} }

// Insert prefix given as its high bits and length, with a next hop.
func (rt *RouteTrie) Insert(prefix uint32, length int, hop string) {
	cur := rt.root
	for i := 0; i < length; i++ {
		bit := (prefix >> (31 - i)) & 1
		if cur.child[bit] == nil {
			cur.child[bit] = &RNode{}
		}
		cur = cur.child[bit]
	}
	cur.nextHop = hop
	cur.hasHop = true
}

// Lookup returns the next hop of the longest matching prefix.
func (rt *RouteTrie) Lookup(addr uint32) (string, bool) {
	cur := rt.root
	best, found := "", false
	if cur.hasHop { // default route 0.0.0.0/0
		best, found = cur.nextHop, true
	}
	for i := 0; i < 32 && cur != nil; i++ {
		bit := (addr >> (31 - i)) & 1
		cur = cur.child[bit]
		if cur != nil && cur.hasHop {
			best, found = cur.nextHop, true // deepest mark wins
		}
	}
	return best, found
}

func ip(a, b, c, d uint32) uint32 { return a<<24 | b<<16 | c<<8 | d }

func main() {
	rt := NewRouteTrie()
	rt.Insert(ip(10, 0, 0, 0), 8, "A")
	rt.Insert(ip(10, 1, 0, 0), 16, "B")
	rt.Insert(ip(10, 1, 2, 0), 24, "C")
	rt.Insert(0, 0, "DEFAULT")
	fmt.Println(rt.Lookup(ip(10, 1, 2, 99))) // C true  (most specific)
	fmt.Println(rt.Lookup(ip(10, 1, 9, 9)))  // B true
	fmt.Println(rt.Lookup(ip(8, 8, 8, 8)))   // DEFAULT true
}
```

#### Java

```java
public class RouteTrie {
    static class Node {
        Node[] child = new Node[2];
        String nextHop;
        boolean hasHop;
    }
    private final Node root = new Node();

    public void insert(long prefix, int length, String hop) {
        Node cur = root;
        for (int i = 0; i < length; i++) {
            int bit = (int) ((prefix >> (31 - i)) & 1);
            if (cur.child[bit] == null) cur.child[bit] = new Node();
            cur = cur.child[bit];
        }
        cur.nextHop = hop;
        cur.hasHop = true;
    }

    public String lookup(long addr) {
        Node cur = root;
        String best = null;
        if (cur.hasHop) best = cur.nextHop;       // default route
        for (int i = 0; i < 32 && cur != null; i++) {
            int bit = (int) ((addr >> (31 - i)) & 1);
            cur = cur.child[bit];
            if (cur != null && cur.hasHop) best = cur.nextHop; // deepest wins
        }
        return best;
    }

    static long ip(long a, long b, long c, long d) {
        return (a << 24) | (b << 16) | (c << 8) | d;
    }

    public static void main(String[] args) {
        RouteTrie rt = new RouteTrie();
        rt.insert(ip(10, 0, 0, 0), 8, "A");
        rt.insert(ip(10, 1, 0, 0), 16, "B");
        rt.insert(ip(10, 1, 2, 0), 24, "C");
        rt.insert(0, 0, "DEFAULT");
        System.out.println(rt.lookup(ip(10, 1, 2, 99))); // C
        System.out.println(rt.lookup(ip(10, 1, 9, 9)));  // B
        System.out.println(rt.lookup(ip(8, 8, 8, 8)));   // DEFAULT
    }
}
```

#### Python

```python
class RNode:
    __slots__ = ("child", "next_hop", "has_hop")

    def __init__(self):
        self.child = [None, None]
        self.next_hop = None
        self.has_hop = False


class RouteTrie:
    def __init__(self):
        self.root = RNode()

    def insert(self, prefix, length, hop):
        cur = self.root
        for i in range(length):
            bit = (prefix >> (31 - i)) & 1
            if cur.child[bit] is None:
                cur.child[bit] = RNode()
            cur = cur.child[bit]
        cur.next_hop = hop
        cur.has_hop = True

    def lookup(self, addr):
        cur = self.root
        best = None
        if cur.has_hop:                       # default route
            best = cur.next_hop
        for i in range(32):
            if cur is None:
                break
            bit = (addr >> (31 - i)) & 1
            cur = cur.child[bit]
            if cur is not None and cur.has_hop:
                best = cur.next_hop            # deepest mark wins
        return best


def ip(a, b, c, d):
    return (a << 24) | (b << 16) | (c << 8) | d


if __name__ == "__main__":
    rt = RouteTrie()
    rt.insert(ip(10, 0, 0, 0), 8, "A")
    rt.insert(ip(10, 1, 0, 0), 16, "B")
    rt.insert(ip(10, 1, 2, 0), 24, "C")
    rt.insert(0, 0, "DEFAULT")
    print(rt.lookup(ip(10, 1, 2, 99)))  # C
    print(rt.lookup(ip(10, 1, 9, 9)))   # B
    print(rt.lookup(ip(8, 8, 8, 8)))    # DEFAULT
```

**Run:** `go run main.go` | `javac RouteTrie.java && java RouteTrie` | `python route.py`

---

## Capacity Planning and Memory Budgeting

Before you ship a trie at scale, estimate its footprint — guessing leads to OOM in production. Use concrete per-node accounting tied to the representation.

**Per-node cost by representation (rough, managed runtime).**

| Representation | Bytes per node (approx) | 50M nodes |
|----------------|-------------------------|-----------|
| Map children (HashMap/dict) | object header + map (buckets, entries) ≈ 80–150 B | 4–7.5 GB |
| Array[26] of pointers | header + 26 × 8 B ≈ 220 B | ~11 GB |
| List-of-pairs (small nodes) | header + deg × (1 + 8) B | varies with degree |
| Double-array trie | ~8 B (one `base` + one `check` int) | ~0.4 GB |
| DAWG / MA-FSA | minimal states × ~8–16 B | often < 0.3 GB |

The lesson is stark: a pointer/map trie can be **10–25×** larger than a flat double-array trie or DAWG for the same key set. For a 5M-word English dictionary (~`m ≈ 45M` characters), a naive map trie may need 3–5 GB while a DAWG fits in tens of MB because English words share enormous prefix *and* suffix structure.

**Estimating node count.** From `professional.md` Theorem 2, character-trie nodes = `|distinct prefixes|`, bounded by `1 + m`. Measure the real number on a sample: `nodes = countDistinctPrefixes(sample)`, then extrapolate linearly. For a radix trie, Theorem 3 caps nodes at `2n − 1`, so `nodes ≈ 2n` is a safe upper bound regardless of key length.

**Bytes-per-key as a CI metric.** Track `total_bytes / n` and alert on regressions. A refactor that swaps an array node for a map node, or forgets `__slots__` in Python, can silently double this. Put a hard budget in the test suite so memory blowups fail the build, not production.

**When the dictionary does not fit in RAM.** Memory-map a serialized double-array trie or FST; the OS pages in only the touched nodes. For truly massive routing/lookup tables, shard by first character or prefix across machines and route the query to the owning shard — the same partition-by-prefix idea used for distributed key-value stores.

---

## Real-World Systems Using Tries

Knowing where tries actually run in production sharpens the engineering intuition for which variant to pick.

- **Redis `rax` (radix tree).** Redis stores its keyspace cluster routing, stream consumer-group metadata, and other internal indexes in a compact radix tree (`rax.c`) rather than pointer-per-char tries, precisely for the `O(n)`-node memory win on long keys.
- **Linux kernel IP routing.** The kernel's FIB (forwarding information base) uses an LC-trie / level-compressed trie variant (`fib_trie`) for longest-prefix match on routes — the LPM structure from this file, tuned with level compression to cut memory accesses per lookup.
- **Lucene / Elasticsearch terms dictionary.** The inverted index's term dictionary is an **FST** (finite-state transducer) — a DAWG that emits an output (the term's posting-list offset) along the accepting path. This gives minimal size *and* per-term payloads, exactly the "DAWG with payloads" trade-off discussed above.
- **CJK tokenizers (MeCab, Kuromoji, Sudachi).** Morphological analyzers store their lexicons in **double-array tries** because the alphabet (kanji/kana) is huge, the dictionary is static, and lookups are on the hot path of every tokenization.
- **Browser/IDE autocomplete and IME.** Typeahead engines keep a trie (often with precomputed per-node top-k) so each keystroke yields suggestions in `O(L + k)`.
- **DNS and URL filtering.** Domain blocklists and CDN routing use suffix/prefix tries over reversed domain labels to match `*.example.com` rules by longest suffix.

Across all of these the pattern repeats: **static + read-heavy + large → compact flat structure (double-array / DAWG / FST), mmap-loaded, atomically reloaded.** Mutable, small, or write-heavy workloads keep the simple pointer/map trie.

---

## Observability and Operating a Trie Service

A trie powering autocomplete or routing is a service component; treat it like one with metrics, alerts, and runbooks.

**Metrics to emit.**

- `trie_nodes` and `trie_bytes` — gauge the structure size; alert if it grows beyond the capacity budget (OOM precursor).
- `trie_bytes_per_key` — derived; a sudden jump signals a representation regression (array vs map, lost compression).
- `lookup_latency_p50 / p99` — autocomplete and LPM are on the request hot path; p99 spikes usually mean cache thrash from a too-large pointer trie.
- `autocomplete_subtree_size` histogram — a few very-short prefixes (`a`, `s`) have huge subtrees; cap the DFS and track how often the cap is hit.
- `dictionary_version` and `reload_count` — confirm the served dictionary matches the deployed one after a reload.
- `cache_miss_rate` (if profiled) — the real driver of trie latency at scale, more than instruction count.

**Runbook: slow autocomplete.** Check `autocomplete_subtree_size` first — an uncapped DFS on a 1-character prefix can walk millions of nodes. Mitigate by capping output (`k`) and/or precomputing per-node top-k. If subtree sizes are normal but latency is high, suspect cache misses from a bloated pointer trie; switch to a flat representation.

**Runbook: memory alert.** Inspect `trie_bytes_per_key`. If it regressed, diff the node representation; if it is steady but total grew, the dictionary genuinely grew — move to a DAWG/double-array or shard. Never "fix" memory by silently dropping keys, which corrupts query correctness.

**Runbook: wrong answers after deploy.** Compare `dictionary_version` to the build artifact; a stale mmap or a failed atomic swap serves the old dictionary. Verify the checksum on load and that the reload flipped the root pointer. For routing tries, additionally assert the default route exists.

**Graceful degradation.** If the dictionary fails to load (corruption, checksum mismatch), keep serving the previous good version rather than starting empty — an autocomplete that returns last-known suggestions beats one that returns nothing, and a router with the last-known table beats one that drops all packets.

---

## Migration and Versioning of Dictionaries

A long-lived trie service ships new dictionaries constantly (new words, new routes, new product names). Treat each dictionary like a deployable artifact with a lifecycle.

**Build pipeline.**

1. Collect and **normalize** the key set (lowercasing, Unicode NFC, trimming) — the same normalization must run at query time, or you get silent false negatives.
2. **Sort** keys (required for incremental DAWG / double-array construction).
3. **Build** the compact structure offline; record `n`, `node_count`, `bytes`, and a content **checksum**.
4. **Validate** against the previous version: assert membership for a regression corpus, diff the added/removed key sets, and fail the build if the diff is implausibly large (a sign of an upstream data bug).
5. **Publish** the serialized artifact with a header carrying `format_version`, `codec_version`, `build_timestamp`, and `checksum`.

**Rollout.** Load the new artifact into memory beside the live one (double-buffer), run a smoke test against it, then flip the atomic root pointer. Keep the previous artifact resident for fast rollback. Never mutate the live structure in place to "patch" it under traffic.

**Compatibility rules.**

| Change | Safe? | Action |
|--------|-------|--------|
| Add keys | yes | rebuild + atomic swap |
| Remove keys | yes | rebuild + atomic swap (verify dependents) |
| Change normalization | breaking | bump `codec_version`; query side must match before deploy |
| Change serialization format | breaking | bump `format_version`; loaders reject unknown versions |
| Change alphabet/encoding | breaking | rebuild from source under new codec; never reinterpret old bytes |

**Failure containment.** A loader that encounters a version or checksum mismatch must **refuse** the artifact and keep the prior version — silent acceptance routes packets or suggests words from a garbled structure. Emit a loud alert; a stale-but-correct dictionary is operationally far better than a fresh-but-corrupt one.

**Per-environment dictionaries.** Staging and production often need different key sets (test data vs real). Tag artifacts by environment and assert at load that the artifact's environment matches the host — a production node loading a staging dictionary is a classic, hard-to-diagnose incident.

---

## Choosing the Representation: A Decision Checklist

Run through these questions in order; the first "yes" usually decides the structure.

1. **Do you need only exact membership (no prefix queries at all)?**
   - Yes → use a hash set, not a trie. Simpler, faster, smaller for disjoint keys.
2. **Is the key set mutable at runtime (frequent inserts/deletes)?**
   - Yes, and small alphabet, dense → array-backed trie.
   - Yes, sparse / Unicode → map-backed trie.
   - Yes, but mostly reads with rare writes → immutable trie + copy-on-write swaps.
3. **Is the dictionary static and large and read-heavy?**
   - Yes, need prefix queries / autocomplete → double-array trie (mmap) or FST.
   - Yes, need only membership, minimize size → DAWG / MA-FSA.
   - Yes, need per-key payloads on a minimal structure → FST or ordinal-indexed values.
4. **Are keys long with little branching (URLs, paths, IPs)?**
   - Yes → radix / compressed trie (`O(n)` nodes). For fixed-width binary keys → multibit / Patricia trie.
5. **Is this longest-prefix match (routing)?**
   - Yes → binary/multibit trie, deepest-mark-wins, with a default `/0` route.
6. **Is memory the binding constraint at extreme scale?**
   - Yes → succinct trie (bit-vectors with rank/select) or sharded tries across machines.

| Workload | Recommended structure |
|----------|-----------------------|
| Small mutable set, prefix queries | map / array trie |
| Read-mostly, rare writes | immutable trie + COW |
| Huge static dictionary, autocomplete | double-array trie / FST (mmap) |
| Huge static set, membership only | DAWG / MA-FSA |
| Long sparse keys | radix / compressed trie |
| IP/route longest-prefix match | multibit / Patricia binary trie |
| Per-key payload, minimal size | FST (transducer) |
| Beyond single-machine RAM | succinct trie or prefix-sharded cluster |

Document the chosen representation and the reasoning in the code; the next engineer (or you in six months) needs to know *why* it is a double-array trie and not a map, so they do not "simplify" it back into an OOM.

---

## Coding Patterns

### Pattern 1: Build-once, serve-many (immutable static trie)

**Intent:** For read-heavy dictionaries, build offline from sorted keys into a compact, immutable structure (DAWG / double-array), serialize it, mmap it at startup, serve concurrent lock-free reads. Updates ship as a whole new dictionary swapped atomically.

### Pattern 2: Deepest-mark-wins traversal (LPM)

**Intent:** For longest-prefix-match, carry a "best so far" as you descend and overwrite it every time you pass a marked node. The default route is the root mark and the initial value. The deepest mark on the path is the answer.

### Pattern 3: Ordinal-indexed values (DAWG with payloads)

**Intent:** Because a DAWG shares nodes, you cannot attach per-word data by node identity. Instead, count keys to the left during the walk to compute a unique ordinal per word, and index a flat value array by that ordinal — restoring per-word payloads on a minimal structure.

---

## Performance Tips

- At scale, optimize **cache misses per lookup**, not instruction count: flat arrays beat pointer chasing.
- Use a **double-array trie** for static, read-heavy, large-alphabet dictionaries; build from sorted keys.
- Use a **DAWG/MA-FSA** when you only need membership and want minimal size (shares suffixes).
- For IP routing, use **multibit / path-compressed** tries to cut the 32/128-depth descent to a few memory accesses.
- **mmap** serialized tries for instant load and cross-process sharing.
- Reload dictionaries with an **atomic pointer swap** and double-buffering for zero downtime.

---

## Edge Cases & Pitfalls

- **DAWG payloads** — shared suffix nodes cannot hold distinct per-word values; use ordinals or an FST.
- **Double-array insertion** — mutating a DAT may relocate whole child blocks; treat it as read-only after build.
- **Default route** — forgetting the `/0` mark makes unmatched addresses return "no route" instead of the fallback.
- **IPv6 width** — descend 128 bits, not 32; a hardcoded 32 silently truncates IPv6.
- **Encoding mismatch on load** — a dictionary built as UTF-8 loaded as Latin-1 yields silent false negatives.
- **Concurrent mutation** — never insert into a trie being read without synchronization; prefer immutable + COW.
- **Sorted-input assumption** — incremental DAWG/DAT builders require sorted keys; unsorted input corrupts them.

---

## Common Mistakes

1. **Shipping a pointer trie at scale** — burning 10–20× memory and cache misses where a DAT or DAWG would fit in cache.
2. **Attaching values to shared DAWG nodes** — two words collide on the shared node; use ordinal-indexed values.
3. **Forgetting the default route in LPM** — unmatched packets get dropped instead of the fallback hop.
4. **Mutating an immutable/shared trie under reads** — data races and torn reads; build new + swap atomically.
5. **No version/codec header on serialized dictionaries** — a future load under a different encoding silently misbehaves.
6. **Deletion that prunes shared nodes** — guard pruning with `passCount==0` and no-children checks.
7. **Hardcoding the alphabet** — array tries crash on out-of-range characters; validate or use maps.

---

## Cheat Sheet

| Need | Choose |
|------|--------|
| Mutable, small, fixed alphabet | array[Σ] trie |
| Mutable, sparse / Unicode | map trie |
| Static, huge, read-heavy | double-array trie (mmap) |
| Minimal membership structure | DAWG / MA-FSA |
| Per-word payload on minimal structure | FST / ordinal-indexed values |
| IP routing (LPM) | binary / multibit / Patricia trie, deepest mark wins |
| Zero-downtime reload | double-buffer + atomic root swap |
| Lock-free concurrent reads | immutable trie + copy-on-write updates |

LPM core:

```
lookup(addr):
    best = root.hop if root marked else none   # default route
    node = root
    for bit in addr bits (MSB first):
        node = node.child[bit]; if node == null: break
        if node marked: best = node.hop         # deepest wins
    return best
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation builds a character trie and runs search/prefix/autocomplete walks. The same descend-and-track-best pattern underlies the longest-prefix-match routing trie in this file; picture marking nodes with next-hops and remembering the deepest mark as you descend.

---

## Summary

At production scale a trie is a memory and systems problem. The representation must match the workload: map tries for small mutable sets, array tries for dense small alphabets, **double-array tries** for static huge read-heavy dictionaries (flat arrays, cache-friendly, mmap-able), and **DAWG/MA-FSA** when you want the minimal membership structure that shares suffixes as well as prefixes. **Longest-prefix match** powers IP routing: descend the address bits and keep the deepest marked node, with the default route as fallback. Persist compact tries by serializing flat arrays and memory-mapping them; reload with atomic swaps; serve concurrent reads lock-free via immutability and copy-on-write. Test against brute-force oracles, round-trip serialization, deletion invariants, and LPM correctness. The failure modes — alphabet overflow, deletion corruption, unbounded memory, encoding mismatch, missing default route — are all preventable with the discipline above.

---

## Further Reading

- Aoe (1989) — "An Efficient Digital Search Algorithm by Using a Double-Array Structure."
- Daciuk et al. — incremental construction of minimal acyclic finite-state automata (DAWG/MA-FSA).
- *Computer Networks* (Tanenbaum) and the Lulea / DIR-24-8 papers — IP longest-prefix-match hardware/software.
- Lucene FST documentation — finite-state transducers as terms dictionaries with payloads.
- Sibling topic `21-advanced-structures/24-25` — radix/Patricia tries and TSTs.
- Sibling topic `18-bit-manipulation/06` — binary/XOR tries over integer keys.
