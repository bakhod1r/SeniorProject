# Aho-Corasick Multi-Pattern String Matching — Senior Level

> Aho-Corasick is rarely the bottleneck on a toy dictionary — but the moment the dictionary has millions of signatures, the alphabet is full bytes, the text is a multi-gigabyte stream, or the matcher sits on the hot path of an intrusion-detection appliance, every detail (children representation, transition-table memory, DFA compression, streaming state, rebuild strategy, failure modes under adversarial input) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Children Representation: Array vs Map vs Double-Array](#2-children-representation-array-vs-map-vs-double-array)
3. [Transition-Table Memory and DFA Compression](#3-transition-table-memory-and-dfa-compression)
4. [Large Dictionaries and Build-Time Engineering](#4-large-dictionaries-and-build-time-engineering)
5. [Streaming, Online Scanning, and State Management](#5-streaming-online-scanning-and-state-management)
6. [Applications: IDS, Antivirus, Keyword Filtering](#6-applications-ids-antivirus-keyword-filtering)
7. [Concurrency and Reuse](#7-concurrency-and-reuse)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the failure link work" but "what system am I actually building, and what breaks when I scale it?". Aho-Corasick shows up in three production guises that share one engine:

1. **Signature scanning under a huge dictionary** — antivirus / IDS matching a packet or file against millions of byte-level signatures, where memory and cache behaviour dominate.
2. **Keyword / content filtering** — chat, email, or document pipelines flagging or censoring tens of thousands of phrases, where latency per message and correct overlap handling matter.
3. **Bioinformatics motif search** — locating many short DNA/protein motifs in long sequences over a tiny alphabet, where the small `σ` makes the array automaton ideal.

All three reduce to: *build a trie of all patterns, complete it into a goto automaton with failure and output links, then scan input in `O(n + z)`.* The senior decisions are: how to represent children to fit memory, how to compress the transition table, how to build a million-pattern automaton without blowing the heap, how to scan a stream while keeping a single integer of state, and how to verify and operate the thing under load and under attack.

This document treats those decisions in production terms.

---

## 2. Children Representation: Array vs Map vs Double-Array

The single biggest implementation lever is how each node stores its children / transitions. The choice trades memory against per-character speed.

| Representation | Memory per node | Lookup | Best for |
|----------------|-----------------|--------|----------|
| **Dense array `[σ]int`** | `O(σ)` always | `O(1)`, cache-friendly | small `σ` (DNA `σ=4`, lowercase `σ=26`) |
| **Hash map `char→int`** | `O(degree)` | `O(1)` expected, constant-factor heavy | large/sparse `σ` (Unicode), most nodes low-degree |
| **Sorted edge list + binary search** | `O(degree)` | `O(log degree)` | moderate `σ`, memory-tight, immutable after build |
| **Double-array trie (DAT)** | near `O(nodes)` | `O(1)` | huge static dictionaries, byte alphabet |

### 2.1 The array trap at byte alphabets

A dense `[256]int32` per node is 1 KB per node. A 1-million-node automaton is then ~1 GB *just for transitions*, before failure/output arrays. For byte-level signatures this is the classic memory blow-up. Solutions: switch to maps for sparse nodes, use a double-array trie, or compress (Section 3).

### 2.2 Hybrid: array near the root, map deep

Nodes near the root have high degree (many patterns branch early); deep nodes are nearly linear (single continuations). A practical hybrid uses dense arrays for the first one or two levels and maps below, capturing the `O(1)` benefit where degree is high and the memory benefit where degree is low.

### 2.3 Double-array trie

A double-array trie packs the whole transition function into two integer arrays (`base[]` and `check[]`) so that `goto(s, c)` is `t = base[s] + c; if check[t] == s then t else fail`. It achieves near-`O(nodes)` memory with `O(1)` lookup and excellent cache behaviour, at the cost of a more complex (and slower) build. It is the representation of choice for very large, static dictionaries — most production Aho-Corasick libraries (e.g. those used in IDS) use a double-array or a closely related compact encoding.

---

## 3. Transition-Table Memory and DFA Compression

The completed goto automaton is a DFA: every `(state, char)` has a defined next state. Storing it densely is `O(states · σ)`. Compression techniques:

### 3.1 NFA-style (lazy) vs DFA-style (precomputed)

- **NFA form:** store only real trie edges; follow `fail` at scan time. Memory `O(m)`; scan amortized `O(n)` but with a worse constant (pointer chasing through the fail chain).
- **DFA form:** precompute every transition. Memory `O(m·σ)`; scan `O(n)` with the best constant (one flat lookup per char).

For throughput-critical scanning (line-rate packet inspection), the DFA form wins; for memory-critical embedded use, the NFA form or a compressed DFA wins.

### 3.2 Default-transition / failure compression

Most `goto(u, c)` equal `goto(fail(u), c)`. Store only the transitions that *differ* from the failure target, plus the failure link itself (a "default transition"). At scan time, follow defaults when a state lacks an explicit edge. This is essentially the NFA form with a bounded chain, and it is how many compressed automata (and the original Aho-Corasick "goto + fail" formulation) keep memory near `O(m)` while staying close to `O(1)` per char in practice.

### 3.3 Banded / sparse row encoding

For each state, store its row of the transition table as a sparse structure (only the non-default entries) with an offset/base scheme. Combined with the double-array idea, this is how byte-alphabet automata with millions of states fit in a few hundred MB instead of tens of GB.

### 3.4 Alphabet reduction

If the dictionary uses only a subset of the byte values (common: ASCII letters and digits), build an **alphabet map** from the 256 byte values to a small dense range `[0, σ')`. The transition rows shrink from 256 to `σ'`, often a 5–10× memory cut, with a single extra table lookup per character to translate the byte. This is one of the cheapest, highest-value optimizations and should be the default for byte input.

---

## 4. Large Dictionaries and Build-Time Engineering

### 4.1 Build cost and memory

Building is `O(m)` for the trie and `O(m·σ)` for the full goto table. For `m = 10^7` and `σ = 256`, the goto build touches `2.5 × 10^9` slots — seconds of work and gigabytes of RAM. Mitigations: alphabet reduction (Section 3.4), lazy transitions, and building in a compact representation directly rather than building dense then compressing.

### 4.2 Deduplicate and normalize patterns first

Real dictionaries have duplicates, substrings, and case variants. Before building:

- **Deduplicate** identical patterns (keep a count or id list per node).
- **Normalize** (lowercase, Unicode NFC, trim) consistently with how the text will be normalized.
- **Drop redundant supersets** only if the semantics allow it — note that `he` and `hers` are *both* needed; one being a substring of the other does **not** make it redundant for an "all occurrences" query.

### 4.3 Incremental updates

The classic automaton is **static**: adding a pattern invalidates failure links and forces a rebuild. Strategies when the dictionary changes:

- **Batch rebuilds.** Accumulate changes and rebuild periodically; serve queries from the old automaton until the new one is ready (atomic pointer swap).
- **Two-level matching.** A large static automaton for the stable core plus a small, frequently rebuilt automaton (or even KMP-per-pattern) for the volatile tail; union the results.
- **Versioned automata.** Keep the immutable automaton behind a version pointer; readers never see a half-built structure.

### 4.4 Serialization

For multi-GB automata, building at startup is too slow. Serialize the compact representation (the double-array or flat goto + fail + output arrays) to disk and `mmap` it at boot. This turns a minutes-long build into a millisecond memory-map, and lets multiple processes share one read-only copy.

---

## 5. Streaming, Online Scanning, and State Management

Aho-Corasick is naturally **online**: the entire scan state is a single integer — the current automaton state. This makes it ideal for streaming.

### 5.1 Chunk-boundary correctness

When scanning a stream in chunks (network packets, file blocks), a pattern may straddle a chunk boundary. Because the only state is the current node, you simply **carry the state across chunks**: feed chunk after chunk into the same `scan(state, chunk)` call, threading the returned state. No buffering of previous chunks is needed — this is a key advantage over algorithms that need a sliding window of the last `maxlen` characters.

### 5.2 Reporting positions across chunks

Track a running global offset so a match's end position is reported in absolute stream coordinates, not chunk-relative. Keep a 64-bit offset counter alongside the state.

### 5.3 Backpressure and match volume

Adversarial or pathological input (e.g. a long run of a character that ends many patterns) can produce an enormous `z`. If a downstream consumer cannot keep up, either switch to **counting** (Section in `middle.md`) or cap/aggregate matches. Never let unbounded match emission OOM the process.

### 5.4 Resettable vs persistent state

For independent inputs (separate messages), reset state to the root between them. For a true continuous stream, persist state. Mixing these up causes either missed cross-boundary matches (resetting a stream) or phantom matches that span unrelated inputs (persisting across independent messages).

---

## 6. Applications: IDS, Antivirus, Keyword Filtering

### 6.1 Intrusion detection (Snort, Suricata)

Network IDS match packet payloads against thousands of attack signatures at line rate. Aho-Corasick (or a multi-pattern variant) is the canonical fast pre-filter: it identifies *which* signatures might match, and a slower per-rule engine confirms. Engineering notes: byte alphabet with alphabet reduction, DFA form for throughput, `mmap`-ed serialized automaton shared across worker threads, and a hard cap on per-packet match emission to resist algorithmic-complexity attacks.

### 6.2 Antivirus / malware scanning

Virus scanners match files against millions of signatures. Pure Aho-Corasick is the substring-anchor stage; wildcards, regex, and entropy checks layer on top. Because signatures change daily, the **batch-rebuild + atomic-swap** model (Section 4.3) and **serialized automata** (Section 4.4) are essential — you ship a new signature database without restarting the scanner.

### 6.3 Keyword / profanity / content filtering

Chat and document pipelines flag or censor banned phrases. Concerns specific to this domain:

- **Overlap and substring semantics:** `class` contains `ass`; whether that should fire is a *policy* decision, often handled with word-boundary checks layered on top of raw matching, not by the automaton itself.
- **Normalization and evasion:** users insert spaces/zero-width chars (`b a d`) to dodge filters; normalize aggressively before matching, and consider matching over a normalized character stream.
- **Censoring (replace):** requires resolving overlapping matches into non-overlapping replacements — a separate pass over the reported matches (see the interview "censor" challenge).

### 6.4 Bioinformatics

Locate many short motifs in long DNA (`σ=4`) or protein (`σ=20`) sequences. The tiny alphabet makes the **dense array automaton** both fast and memory-cheap — the array trap of Section 2.1 does not apply. Aho-Corasick is a standard primitive for read mapping pre-filters and motif scanning.

### 6.5 URL / domain blocklists and log scanning

Blocking malicious domains, scanning access logs for indicators of compromise, and grep-like multi-string search over large corpora are all Aho-Corasick territory. The classic GNU `grep -F` (fixed-string) with multiple patterns and tools like `ripgrep` use Aho-Corasick (or a SIMD-accelerated variant) under the hood when the pattern set is large enough that per-pattern Boyer-Moore loses. The engineering notes mirror IDS: byte alphabet with reduction, build-once over the blocklist, atomic swap when the list updates, and capped emission for adversarial logs. For *very* small pattern sets, a SIMD memchr-style scan can beat the automaton's per-byte table lookup, so production tools often pick the strategy based on pattern count at build time.

---

## 7. Concurrency and Reuse

### 7.1 The automaton is read-only after build

Once built, the transition/fail/output arrays never change during scanning. This makes the automaton **trivially shareable** across threads, goroutines, or processes — each scanner keeps only its own current-state integer. Do **not** mutate shared `output` accumulators from multiple threads; if counting, give each worker a private counter array and merge at the end.

### 7.2 Per-scan local state

The only mutable per-scan state is the current node index (and optional offset/counters). Keep it on the stack / in a local variable, never in a shared field. The classic concurrency bug is a single mutable `cur` field on a shared matcher object reused by multiple threads.

### 7.3 Sharing across processes

Serialize the compact automaton and `mmap` it read-only; the OS page cache shares one physical copy across all processes. This is how IDS appliances run many worker processes against one large signature set without `N`× memory.

---

## 8. Code Examples

### 8.1 Go — alphabet-reduced byte automaton with streaming scan

```go
package main

import "fmt"

type Matcher struct {
	alpha   [256]int // byte -> reduced index, -1 if unused
	sigma   int
	next    [][]int  // [state][reducedChar]
	fail    []int
	out     [][]int  // pattern ids ending at state
}

func New(patterns []string) *Matcher {
	m := &Matcher{}
	for i := range m.alpha {
		m.alpha[i] = -1
	}
	for _, p := range patterns {
		for i := 0; i < len(p); i++ {
			m.alpha[p[i]] = 0 // mark used
		}
	}
	for b := 0; b < 256; b++ {
		if m.alpha[b] == 0 {
			m.alpha[b] = m.sigma
			m.sigma++
		}
	}
	m.addNode()
	for id, p := range patterns {
		m.insert(p, id)
	}
	m.build()
	return m
}

func (m *Matcher) addNode() int {
	m.next = append(m.next, make([]int, m.sigma))
	for c := range m.next[len(m.next)-1] {
		m.next[len(m.next)-1][c] = -1
	}
	m.fail = append(m.fail, 0)
	m.out = append(m.out, nil)
	return len(m.next) - 1
}

func (m *Matcher) insert(p string, id int) {
	cur := 0
	for i := 0; i < len(p); i++ {
		c := m.alpha[p[i]]
		if m.next[cur][c] == -1 {
			m.next[cur][c] = m.addNode()
		}
		cur = m.next[cur][c]
	}
	m.out[cur] = append(m.out[cur], id)
}

func (m *Matcher) build() {
	q := []int{}
	for c := 0; c < m.sigma; c++ {
		if m.next[0][c] == -1 {
			m.next[0][c] = 0
		} else {
			q = append(q, m.next[0][c])
		}
	}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		m.out[u] = append(m.out[u], m.out[m.fail[u]]...)
		for c := 0; c < m.sigma; c++ {
			v := m.next[u][c]
			if v == -1 {
				m.next[u][c] = m.next[m.fail[u]][c]
			} else {
				m.fail[v] = m.next[m.fail[u]][c]
				q = append(q, v)
			}
		}
	}
}

// Scan a chunk starting from state `cur` at absolute offset `base`; returns new state.
func (m *Matcher) Scan(cur int, chunk []byte, base int64, emit func(id int, end int64)) int {
	for i := 0; i < len(chunk); i++ {
		c := m.alpha[chunk[i]]
		if c == -1 { // byte not in any pattern: forced to root path
			cur = 0
			continue
		}
		cur = m.next[cur][c]
		for _, id := range m.out[cur] {
			emit(id, base+int64(i))
		}
	}
	return cur
}

func main() {
	m := New([]string{"he", "she", "his", "hers"})
	state := 0
	state = m.Scan(state, []byte("ush"), 0, func(id int, end int64) {
		fmt.Printf("match %d at %d\n", id, end)
	})
	// streaming: second chunk continues from the carried state
	m.Scan(state, []byte("ers"), 3, func(id int, end int64) {
		fmt.Printf("match %d at %d\n", id, end)
	})
}
```

### 8.2 Java — atomic rebuild + swap for a mutable dictionary

```java
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

public class SwappableMatcher {
    // Immutable, read-only after build — safe to share across threads.
    static final class Automaton {
        final int[][] next;
        final int[] fail;
        final int[][] out;
        Automaton(int[][] next, int[] fail, int[][] out) {
            this.next = next; this.fail = fail; this.out = out;
        }
        int step(int cur, int c) { return next[cur][c]; }
    }

    static final int SIGMA = 26;
    final AtomicReference<Automaton> ref = new AtomicReference<>();

    void rebuild(List<String> patterns) {
        List<int[]> next = new ArrayList<>();
        List<Integer> fail = new ArrayList<>();
        List<List<Integer>> out = new ArrayList<>();
        next.add(newRow()); fail.add(0); out.add(new ArrayList<>());
        for (int id = 0; id < patterns.size(); id++) {
            int cur = 0;
            for (char ch : patterns.get(id).toCharArray()) {
                int c = ch - 'a';
                if (next.get(cur)[c] == -1) {
                    next.get(cur)[c] = next.size();
                    next.add(newRow()); fail.add(0); out.add(new ArrayList<>());
                }
                cur = next.get(cur)[c];
            }
            out.get(cur).add(id);
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < SIGMA; c++) {
            if (next.get(0)[c] == -1) next.get(0)[c] = 0;
            else q.add(next.get(0)[c]);
        }
        while (!q.isEmpty()) {
            int u = q.poll();
            out.get(u).addAll(out.get(fail.get(u)));
            for (int c = 0; c < SIGMA; c++) {
                int v = next.get(u)[c];
                if (v == -1) next.get(u)[c] = next.get(fail.get(u))[c];
                else { fail.set(v, next.get(fail.get(u))[c]); q.add(v); }
            }
        }
        int[][] nextArr = next.toArray(new int[0][]);
        int[] failArr = fail.stream().mapToInt(Integer::intValue).toArray();
        int[][] outArr = new int[out.size()][];
        for (int i = 0; i < out.size(); i++)
            outArr[i] = out.get(i).stream().mapToInt(Integer::intValue).toArray();
        ref.set(new Automaton(nextArr, failArr, outArr)); // atomic publish
    }

    static int[] newRow() { int[] r = new int[SIGMA]; Arrays.fill(r, -1); return r; }

    void search(String text) {
        Automaton a = ref.get(); // snapshot; safe even if a rebuild swaps mid-scan
        int cur = 0;
        for (int i = 0; i < text.length(); i++) {
            cur = a.step(cur, text.charAt(i) - 'a');
            for (int id : a.out[cur])
                System.out.println("match " + id + " at " + i);
        }
    }

    public static void main(String[] args) {
        SwappableMatcher m = new SwappableMatcher();
        m.rebuild(Arrays.asList("he", "she", "his", "hers"));
        m.search("ushers");
        m.rebuild(Arrays.asList("us", "her")); // new dictionary, atomic swap
        m.search("ushers");
    }
}
```

### 8.3 Python — memory-conscious lazy (map-based) automaton for large alphabets

```python
from collections import deque


class LazyAho:
    """Map-based children; follows failure links at scan time (no dense goto table)."""

    def __init__(self):
        self.goto = [{}]   # per-node dict: char -> child
        self.fail = [0]
        self.out = [[]]

    def add(self, pat, pid):
        cur = 0
        for ch in pat:
            if ch not in self.goto[cur]:
                self.goto.append({})
                self.fail.append(0)
                self.out.append([])
                self.goto[cur][ch] = len(self.goto) - 1
            cur = self.goto[cur][ch]
        self.out[cur].append(pid)

    def build(self):
        q = deque()
        for ch, v in self.goto[0].items():
            self.fail[v] = 0
            q.append(v)
        while q:
            u = q.popleft()
            for ch, v in self.goto[u].items():
                # find fail target by walking the parent's fail chain
                f = self.fail[u]
                while f and ch not in self.goto[f]:
                    f = self.fail[f]
                self.fail[v] = self.goto[f].get(ch, 0) if f or ch in self.goto[0] else 0
                if self.fail[v] == v:
                    self.fail[v] = 0
                self.out[v] += self.out[self.fail[v]]
                q.append(v)

    def _next(self, cur, ch):
        while cur and ch not in self.goto[cur]:
            cur = self.fail[cur]
        return self.goto[cur].get(ch, 0)

    def search(self, text):
        cur = 0
        for i, ch in enumerate(text):
            cur = self._next(cur, ch)
            for pid in self.out[cur]:
                yield pid, i


if __name__ == "__main__":
    a = LazyAho()
    for pid, p in enumerate(["he", "she", "his", "hers"]):
        a.add(p, pid)
    a.build()
    print(list(a.search("ushers")))
```

---

## 9. Observability and Testing

A multi-pattern matcher is opaque — a missed match looks like silence, not an error. Build in checks from day one.

| Check | Why |
|-------|-----|
| Naive multi-search oracle on small inputs | Catches output-link and overlap bugs. |
| KMP-per-pattern agreement for `P = 1` | Confirms the single-pattern degenerate case. |
| Count cross-check: positions reported == fail-tree count totals | Validates the counting aggregation against enumeration. |
| Root invariants: `fail[root]==root`, root's missing edges → root | The most common build bug. |
| `fail[u]` strictly shallower than `u` | The fail links must form a tree; a cycle is a bug. |
| Random dictionary + random text fuzzing | Surfaces alphabet/normalization edge cases. |
| Determinism across languages | Same dictionary + text → identical Go/Java/Python match lists. |

The single most valuable test is the **naive oracle**: brute-force every pattern with `str.find` for `m, n ≤ a few hundred`, sort, and diff against the automaton's output. It catches the overwhelming majority of bugs.

### 9.1 Property-test battery

```text
for random small dictionary D, random text T:
    assert sorted(aho_matches(D, T)) == sorted(naive_matches(D, T))
    assert all fail[u] has depth < depth[u]          # fail tree, no cycles
    assert aho_count(D, T)[p] == len([m for m in matches if m.pid == p])
    assert single-pattern aho == kmp                  # P = 1 degenerate case
```

### 9.2 Production guardrails

For a service scanning at scale: log the **match rate** (matches per byte) so an anomalous spike (possible complexity attack) stands out; cap per-input match emission; assert the dictionary was normalized identically to the text; and expose the automaton **version/build hash** so you can correlate results with a signature-database version.

---

## 10. Failure Modes

### 10.1 Missing overlapping matches
Forgetting to merge `output[fail[u]]` (or to walk output links) silently drops shorter patterns that end where a longer one does. Symptom: `he` not reported inside `she`. Mitigation: merge outputs in BFS; test against the naive oracle.

### 10.2 Memory blow-up on byte alphabets
Dense `[256]int` per node → gigabytes for large dictionaries. Mitigation: alphabet reduction, map-based children for sparse nodes, or a double-array trie.

### 10.3 Rebuild on every query
Building the automaton inside a per-request handler throws away the `O(m)` investment each time. Symptom: latency scales with dictionary size per request. Mitigation: build once, share read-only, atomic-swap on dictionary change.

### 10.4 Shared mutable scan state across threads
A single `cur` field on a shared matcher corrupts under concurrency. Mitigation: keep current state local per scan; only the read-only automaton is shared.

### 10.5 Stream reset / persist confusion
Resetting state mid-stream misses cross-chunk matches; persisting state across independent inputs invents phantom matches. Mitigation: reset between independent inputs, persist within a single logical stream.

### 10.6 Normalization mismatch
Patterns lowercased but text not (or different Unicode normal forms) → matches silently missed. Mitigation: one normalization function applied to *both* patterns and text.

### 10.7 Algorithmic-complexity / match-flood attacks
Adversarial input that ends many patterns at every position produces enormous `z`, exhausting CPU or memory in the emit path. Mitigation: cap emission, switch to counting, or rate-limit; treat `z` as attacker-controlled.

### 10.8 Off-by-one in start vs end position
Reporting the wrong endpoint corrupts downstream censoring/highlighting. A match at state `u` after index `i` ends at `i`; start = `i - len + 1`. This survives "does it match" tests and only surfaces against position-sensitive consumers. Mitigation: store pattern length per end-node and assert positions in tests.

---

## 11. Summary

- Aho-Corasick's scan is `O(n + z)` and online — the entire scan state is one integer, which is what makes streaming, chunk-boundary correctness, and read-only sharing across threads/processes trivial.
- The dominant engineering lever is the **children representation**: dense arrays for small alphabets (DNA, lowercase), maps or double-array tries for byte/Unicode alphabets; **alphabet reduction** is the cheapest big memory win for byte input.
- The completed goto automaton is a DFA costing `O(m·σ)`; compress it via default/failure transitions, sparse rows, or double-array encoding when memory matters. NFA (lazy) form trades the table for amortized failure walking.
- Large, changing dictionaries demand **batch rebuild + atomic swap**, **serialization + mmap** for fast startup and cross-process sharing, and careful **deduplication/normalization** (a substring pattern is *not* redundant for all-occurrences queries).
- The flagship applications — IDS (Snort/Suricata), antivirus, keyword/profanity filtering, bioinformatics motif search — each stress a different axis: throughput (DFA form), dictionary churn (atomic swap), policy/normalization (filtering), or tiny alphabet (bioinformatics array automaton).
- Always keep a naive multi-search oracle and a fail-tree-count cross-check; they catch the overlap-miss, the root-handling, and the normalization bugs that account for nearly every real defect.
- Treat `z` and the input as adversarial in security contexts: cap emission and monitor match rate to resist complexity attacks.

### Decision summary

- **Small alphabet (≤ ~32), throughput-critical** → dense array DFA automaton.
- **Byte/Unicode alphabet, large dictionary** → alphabet reduction + double-array / compressed DFA, or map-based lazy NFA if memory-bound.
- **Dictionary changes frequently** → batch rebuild + atomic pointer swap; serialize + mmap for fast boot.
- **Streaming input** → thread the single state across chunks; report absolute offsets; cap match emission.
- **Counts, not positions** → fail-tree aggregation, `O(n + m)` (see `middle.md`).
- **Single pattern** → drop to KMP (sibling `01-kmp`).

References to study further: Aho-Corasick (1975) original paper; double-array trie (Aoe 1989); Snort/Suricata multi-pattern engines; Commentz-Walter (Aho-Corasick + Boyer-Moore hybrid); Gusfield's *Algorithms on Strings, Trees, and Sequences*; and sibling topics `01-kmp` and `07-tries`.
