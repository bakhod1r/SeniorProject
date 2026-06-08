# Link-Cut Tree — Interview Preparation

> **Audience:** Engineers preparing for senior/specialist interviews (competitive programming, systems with dynamic graphs) where Link-Cut Trees, dynamic-tree reasoning, or splay-based path queries may appear. Prerequisite: `junior.md` through `professional.md`. Solutions in Go, Java, Python.

This document provides **45 tiered questions** with answer focus, followed by a **full coding challenge** implemented in Go, Java, and Python: an online minimum-spanning-forest using an LCT with the edge-as-node encoding.

---

## Table of Contents

1. [Junior Questions (1–12)](#junior)
2. [Middle Questions (13–26)](#middle)
3. [Senior Questions (27–38)](#senior)
4. [Professional Questions (39–45)](#professional)
4b. [Whiteboard Follow-Up Discussion Points](#followup)
5. [Coding Challenge — Online Minimum Spanning Forest](#challenge)

---

<a name="junior"></a>
## 1. Junior Questions (1–12)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What problem does a Link-Cut Tree solve? | The **dynamic trees problem**: maintain a forest under `link`/`cut` with path queries, each amortized O(log n). |
| 2 | Why not just use parent pointers? | Updates are O(1) but path/connectivity queries are O(path length) = O(n) worst case (long chains). |
| 3 | What is a *preferred path*? | A maximal downward chain of preferred edges; each node designates ≤1 preferred child, partitioning the tree into preferred paths. |
| 4 | How is each preferred path stored? | As a **splay tree** keyed by **depth** (shallowest = leftmost, deepest = rightmost). |
| 5 | What glues the splay trees together? | One-directional **path-parent pointers** from a splay-tree root to the node it attaches under in the path above. |
| 6 | What does `access(v)` do? | Makes the represented-root-to-`v` path one preferred path (one splay tree) with `v` at the top. |
| 7 | After `access(v)`, where is the path sum? | In the aggregate field at the splay root `v` — one O(1) field read. |
| 8 | What is the time complexity of `access`? | **Amortized O(log n)** (not worst-case). |
| 9 | How do you check if `u` and `v` are connected? | `findRoot(u) == findRoot(v)`. |
| 10 | What's the space complexity? | O(n) — a constant number of fields per node. |
| 11 | Is the "tree" in LCT a binary search tree? | No — the *represented* tree is a general rooted tree; the *auxiliary* splay trees are BSTs keyed by depth. |
| 12 | Name one real use of LCTs. | Network flow (Dinic), dynamic connectivity, online MST, simulation. |

---

<a name="middle"></a>
## 2. Middle Questions (13–26)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Why is `access` *amortized*, not worst-case, O(log n)? | One `access` may climb many preferred paths; only the *total* preferred-child changes over a sequence is O(m log n). |
| 14 | What does `makeRoot(v)` do and how? | Re-roots the tree at `v`: `access(v)` then mark a **lazy reverse** flag (flips depth order); O(log n). |
| 15 | Why a *lazy* reverse instead of eager? | Eager swap of all children is O(size); lazy marks O(1) and flushes via `push` only when nodes are touched. |
| 16 | Which aggregates survive `makeRoot`? | **Commutative** ones (sum/min/max/gcd/xor). Non-commutative ones need both forward and reverse stored. |
| 17 | LCT vs Heavy-Light Decomposition — when each? | LCT for **dynamic** trees (link/cut); HLD for **static** trees (simpler, faster, worst-case). |
| 18 | LCT vs Euler-tour tree? | ETT is natural for **subtree**/connectivity on dynamic trees but not path aggregates; LCT is natural for **path** aggregates. |
| 19 | How does `link(u, v)` work? | `makeRoot(u)`; set `u.parent = v` (a path-parent pointer). Guard: must be different trees. |
| 20 | How does `cut(u, v)` work? | `makeRoot(u); access(v)`; then `v.left == u`, detach it. Guard: must be an edge. |
| 21 | What is `isRoot(n)` and why does it matter? | True iff `n`'s parent doesn't list `n` as a child — distinguishes splay-parent from path-parent on the shared `parent` field. |
| 22 | What's the #1 bug source in LCTs? | Forgetting to **`push`** (flush lazy reverse) before a rotation or child read. |
| 23 | Why splay rather than AVL for the auxiliary tree? | Splay's native "bring node to top" is exactly what `access` needs; its potential underpins the amortized proof; no balance metadata. |
| 24 | How do you compute LCA with a fixed root? | `access(u)`; the value returned by `access(v)` (its last path-parent switch) is the LCA. |
| 25 | When can you skip `makeRoot`? | When the root is fixed — use `access(u); access(v)` for LCA-based path splitting; avoids lazy-reverse overhead. |
| 26 | Why store the tree in a flat array/arena? | Cache locality, no GC pressure, simpler serialization; pointer chasing per-node `malloc` is slow. |

---

<a name="senior"></a>
## 3. Senior Questions (27–38)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 27 | Design dynamic connectivity with edge deletion. | LCT spanning forest + non-tree edge sets; on tree-edge delete, search for a replacement → HDLT level structure for full dynamism. |
| 28 | How do you encode **edge** weights in an LCT (which aggregates nodes)? | **Edge-as-node**: split each edge into its own node carrying the weight; vertices carry identity values. |
| 29 | Sketch online MST with an LCT. | For new edge `(u,v,w)`: if disconnected `link`; else `heavy = pathMax(u,v)`; if `w < heavy`, `cut(heavy); link(e)`. |
| 30 | How do dynamic trees speed up Dinic? | Path-min (bottleneck) + lazy path-add (augment) + cut/link, cutting blocking-flow from O(VE) to O(E log V). |
| 31 | How do you get **subtree** (not path) aggregates? | The **virtual-subtree augmentation**: maintain `virt` = aggregate of path-parent-attached subtrees, updated on every virtual↔real transition. |
| 32 | Why is subtree-*add* (lazy) hard in an LCT? | A lazy tag must reach the *virtual* children, which aren't in the splay tree — this is where top trees win. |
| 33 | What worst-case alternative exists, and when use it? | **Top trees** — worst-case O(log n); use under hard real-time or for cluster aggregates. |
| 34 | How do you make an LCT robust in production? | Shadow brute-force forest in tests, invariant checks, arena allocation, adversarial chain fuzzing, latency p99 monitoring. |
| 35 | What does the `access` preferred-change counter tell you? | It is what the amortization bounds; a spiking average signals a pathological workload. |
| 36 | Can two threads share one LCT? | Not lock-free easily; splays mutate shared structure. Use coarse locking or per-component partitioning. |
| 37 | How do you compose lazy reverse with lazy path-add? | Flush in correct order; reverse changes which end an asymmetric add affects — keep tags order-aware. |
| 38 | Trade-off: LCT vs rebuild-HLD for a mostly-static tree with rare edits? | If edits are rare, periodic HLD rebuild may beat LCT's constant factor; measure. |

---

<a name="professional"></a>
## 4. Professional Questions (39–45)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 39 | State and outline the proof of the LCT access bound. | O(m log n) total: splay Access Lemma telescoped **once per access** (O(log n)) + heavy/light charging of preferred-child changes (≤ log n light promotions per access). |
| 40 | Why doesn't the analysis give O(m log² n)? | Splay potential is charged once per access via telescoping ranks, not once per path-segment — the two logs don't multiply. |
| 41 | What weighting makes the proof work? | Rank `r(x) = log₂(represented-subtree-size)`; light edges halve subtree mass ⇒ ≤ log n light edges per root path. |
| 42 | Prove `makeRoot`'s lazy reverse is correct. | rev is an involution; child-swap is its own inverse ⇒ flags compose; `push` materializes logical orientation before any read. |
| 43 | Why is O(log n) per op essentially optimal? | Cell-probe dynamic-connectivity lower bound (Pătraşcu–Demaine) forces Ω(log n) amortized. |
| 44 | Compare LCT and top trees formally. | Both O(log n); LCT amortized + preferred-path/splay abstraction; top trees worst-case + cluster/join-split abstraction (richer aggregates). |
| 45 | Which aggregates need a two-sided node and why? | Non-commutative combines (ordered matrix product); reversal changes operand order, so store fwd & rev and swap on `applyRev`. |

---

<a name="followup"></a>
## 4b. Whiteboard Follow-Up Discussion Points

Interviewers often probe *beyond* the canned answer. Be ready to say a few sentences on each:

- **"Walk me through `access` on paper."** Draw a 5–6 node tree, mark preferred edges solid, dashed otherwise, then narrate: splay the target, cut its deeper part, climb via path-parent re-pointing each preferred child, final splay. The interviewer is checking that you can *see* the preferred-path reshaping, not recite it.
- **"Why does the amortization not give an extra log factor?"** The key one-liner: the splay potential telescopes *once per access* (ranks at the top minus ranks at the accessed node, ≤ log n), so the per-segment splays do not each pay an independent log — they share one telescoping sum.
- **"What breaks if you forget `push`?"** A reversed-but-unflushed path makes "leftmost = root" false; `findRoot` returns the wrong end, `cut` detaches the wrong subtree, and the corruption is silent. This is the bug interviewers love because it tests whether you understand *why* the lazy flag exists, not just that it does.
- **"How would you test this in production?"** Shadow brute-force forest on random sequences; adversarial chain inputs; invariant re-derivation; p99 latency monitoring (because amortized ≠ worst-case).
- **"When would you NOT use an LCT?"** Static tree (use HLD); subtree-only/connectivity (use Euler-tour trees); hard real-time or rich cluster aggregates like diameter (use top trees); or when a simpler O(√n) sqrt-decomposition meets the latency budget with far less code.
- **"Edge weights vs node values?"** Volunteer the edge-as-node encoding before being asked — it signals you have actually used LCTs for MST/flow, where weights live on edges.

A strong candidate connects the data structure to the *algorithm it accelerates* (Dinic, dynamic MST, dynamic connectivity) rather than treating it as a standalone gadget.

### Quick complexity recap (memorize)

| Operation | Bound | One-line reason |
|---|---|---|
| `access` | amortized O(log n) | splay potential telescopes once per access |
| `link` / `cut` | amortized O(log n) | one `access` + O(1) splice |
| `findRoot` | amortized O(log n) | `access` + walk-left + splay |
| `makeRoot` | amortized O(log n) | `access` + O(1) lazy reverse |
| path/subtree aggregate | amortized O(log n) | read root field (subtree needs `virt`) |
| space | O(n) | O(1) fields per node |
| lower bound | Ω(log n) | cell-probe dynamic connectivity |

### Common interview traps

- Claiming **worst-case** O(log n) — it is **amortized**; top trees give worst-case.
- Forgetting the **edge-as-node** trick when weights are on edges.
- Forgetting `makeRoot` requires a **commutative** aggregate.
- Forgetting to **guard** `link` (cycle) and `cut` (non-edge).

---

<a name="challenge"></a>
## 5. Coding Challenge — Online Minimum Spanning Forest

> **Problem.** Process a stream of weighted edges `(u, v, w)` arriving one at a time. Maintain a **minimum spanning forest**: after each insertion report the **current total MSF weight**. When a new edge would close a cycle, it replaces the heaviest edge on the cycle's tree path iff it is strictly lighter. Use an LCT with the **edge-as-node** encoding so that path-max returns the heaviest tree *edge*. All operations amortized O(log n).
>
> **Input:** `n` vertices (0…n−1), a list of edges `(u, v, w)`.
> **Output:** after each edge, the total weight of the current MSF.

### Approach
- Vertex nodes carry value `−∞` (they never win a path-max).
- Each edge `e` gets its own node `m_e` with value `w` and a stored id so we can identify which edge to cut.
- Insert `(u,v,w)`: if `findRoot(u) != findRoot(v)`, `link(u, m_e); link(m_e, v)` and add `w` to total. Else `pathMax(u,v)` returns the heaviest edge-node; if `w < its weight`, cut it out (subtract its weight) and link in `m_e` (add `w`).
- Track total weight incrementally.

Complexity: O(log n) amortized per edge; O(n + E) space.

### Go
```go
package main

import "fmt"

const negInf = int64(-1) << 62

type Node struct {
	ch     [2]*Node
	parent *Node
	val    int64 // edge weight, or negInf for a vertex
	mxVal  int64 // max value in splay subtree
	mxId   int   // id of the edge-node achieving mxVal (-1 if vertex)
	id     int
	rev    bool
}

func newNode(val int64, id int) *Node {
	return &Node{val: val, mxVal: val, mxId: id, id: id}
}

func isRoot(n *Node) bool {
	p := n.parent
	return p == nil || (p.ch[0] != n && p.ch[1] != n)
}

func pull(n *Node) {
	n.mxVal, n.mxId = n.val, n.id
	for _, c := range n.ch {
		if c != nil && c.mxVal > n.mxVal {
			n.mxVal, n.mxId = c.mxVal, c.mxId
		}
	}
}

func applyRev(n *Node) {
	if n != nil {
		n.ch[0], n.ch[1] = n.ch[1], n.ch[0]
		n.rev = !n.rev
	}
}
func push(n *Node) {
	if n.rev {
		applyRev(n.ch[0])
		applyRev(n.ch[1])
		n.rev = false
	}
}

func rotate(n *Node) {
	p, g := n.parent, n.parent.parent
	d := 0
	if p.ch[1] == n {
		d = 1
	}
	if !isRoot(p) {
		if g.ch[0] == p {
			g.ch[0] = n
		} else {
			g.ch[1] = n
		}
	}
	n.parent = g
	p.ch[d] = n.ch[d^1]
	if n.ch[d^1] != nil {
		n.ch[d^1].parent = p
	}
	n.ch[d^1] = p
	p.parent = n
	pull(p)
	pull(n)
}

func splay(n *Node) {
	push(n)
	for !isRoot(n) {
		p := n.parent
		if !isRoot(p) {
			g := p.parent
			push(g)
			push(p)
			push(n)
			if (g.ch[0] == p) == (p.ch[0] == n) {
				rotate(p)
			} else {
				rotate(n)
			}
		} else {
			push(p)
			push(n)
		}
		rotate(n)
	}
}

func access(n *Node) {
	var last *Node
	for cur := n; cur != nil; cur = cur.parent {
		splay(cur)
		cur.ch[1] = last
		pull(cur)
		last = cur
	}
	splay(n)
}

func makeRoot(n *Node) { access(n); applyRev(n) }

func findRoot(n *Node) *Node {
	access(n)
	for n.ch[0] != nil {
		push(n)
		n = n.ch[0]
	}
	splay(n)
	return n
}

func link(u, v *Node) { makeRoot(u); u.parent = v }

func cut(u, v *Node) {
	makeRoot(u)
	access(v)
	if v.ch[0] == u && u.ch[1] == nil {
		v.ch[0].parent = nil
		v.ch[0] = nil
		pull(v)
	}
}

// pathMaxEdge returns (weight, edge-id) of heaviest edge-node on u..v.
func pathMaxEdge(u, v *Node) (int64, int) {
	makeRoot(u)
	access(v)
	return v.mxVal, v.mxId
}

func main() {
	n := 5
	verts := make([]*Node, n)
	for i := range verts {
		verts[i] = newNode(negInf, -1)
	}
	edges := [][3]int{{0, 1, 4}, {1, 2, 3}, {0, 2, 5}, {2, 3, 2}, {0, 3, 1}, {3, 4, 7}}
	edgeNodes := map[int]*Node{} // id -> edge node
	edgeEnds := map[int][2]int{}
	var total int64
	nextId := n // edge ids start after vertices
	for _, e := range edges {
		u, v, w := e[0], e[1], int64(e[2])
		if findRoot(verts[u]) != findRoot(verts[v]) {
			m := newNode(w, nextId)
			edgeNodes[nextId] = m
			edgeEnds[nextId] = [2]int{u, v}
			link(verts[u], m)
			link(m, verts[v])
			total += w
			nextId++
		} else {
			mw, mid := pathMaxEdge(verts[u], verts[v])
			if w < mw {
				old := edgeNodes[mid]
				ends := edgeEnds[mid]
				cut(verts[ends[0]], old)
				cut(old, verts[ends[1]])
				total -= mw
				delete(edgeNodes, mid)
				m := newNode(w, nextId)
				edgeNodes[nextId] = m
				edgeEnds[nextId] = [2]int{u, v}
				link(verts[u], m)
				link(m, verts[v])
				total += w
				nextId++
			}
		}
		fmt.Println(total)
	}
}
```

### Java
```java
import java.util.*;

public class MsfChallenge {
    static final long NEG_INF = Long.MIN_VALUE / 4;

    static final class Node {
        Node[] ch = new Node[2];
        Node parent;
        long val, mxVal;
        int mxId, id;
        boolean rev;
        Node(long v, int id) { val = v; mxVal = v; mxId = id; this.id = id; }
    }

    static boolean isRoot(Node n) {
        return n.parent == null || (n.parent.ch[0] != n && n.parent.ch[1] != n);
    }
    static void pull(Node n) {
        n.mxVal = n.val; n.mxId = n.id;
        for (Node c : n.ch) if (c != null && c.mxVal > n.mxVal) { n.mxVal = c.mxVal; n.mxId = c.mxId; }
    }
    static void applyRev(Node n) {
        if (n == null) return;
        Node t = n.ch[0]; n.ch[0] = n.ch[1]; n.ch[1] = t; n.rev = !n.rev;
    }
    static void push(Node n) { if (n.rev) { applyRev(n.ch[0]); applyRev(n.ch[1]); n.rev = false; } }

    static void rotate(Node n) {
        Node p = n.parent, g = p.parent;
        int d = (p.ch[1] == n) ? 1 : 0;
        if (!isRoot(p)) { if (g.ch[0] == p) g.ch[0] = n; else g.ch[1] = n; }
        n.parent = g;
        p.ch[d] = n.ch[d ^ 1];
        if (n.ch[d ^ 1] != null) n.ch[d ^ 1].parent = p;
        n.ch[d ^ 1] = p; p.parent = n;
        pull(p); pull(n);
    }
    static void splay(Node n) {
        push(n);
        while (!isRoot(n)) {
            Node p = n.parent;
            if (!isRoot(p)) {
                Node g = p.parent; push(g); push(p); push(n);
                rotate(((g.ch[0] == p) == (p.ch[0] == n)) ? p : n);
            } else { push(p); push(n); }
            rotate(n);
        }
    }
    static void access(Node n) {
        Node last = null;
        for (Node cur = n; cur != null; cur = cur.parent) { splay(cur); cur.ch[1] = last; pull(cur); last = cur; }
        splay(n);
    }
    static void makeRoot(Node n) { access(n); applyRev(n); }
    static Node findRoot(Node n) {
        access(n);
        while (n.ch[0] != null) { push(n); n = n.ch[0]; }
        splay(n); return n;
    }
    static void link(Node u, Node v) { makeRoot(u); u.parent = v; }
    static void cut(Node u, Node v) {
        makeRoot(u); access(v);
        if (v.ch[0] == u && u.ch[1] == null) { v.ch[0].parent = null; v.ch[0] = null; pull(v); }
    }
    static long[] pathMaxEdge(Node u, Node v) { makeRoot(u); access(v); return new long[]{v.mxVal, v.mxId}; }

    public static void main(String[] args) {
        int n = 5;
        Node[] verts = new Node[n];
        for (int i = 0; i < n; i++) verts[i] = new Node(NEG_INF, -1);
        int[][] edges = {{0,1,4},{1,2,3},{0,2,5},{2,3,2},{0,3,1},{3,4,7}};
        Map<Integer, Node> edgeNodes = new HashMap<>();
        Map<Integer, int[]> edgeEnds = new HashMap<>();
        long total = 0; int nextId = n;
        for (int[] e : edges) {
            int u = e[0], v = e[1]; long w = e[2];
            if (findRoot(verts[u]) != findRoot(verts[v])) {
                Node m = new Node(w, nextId);
                edgeNodes.put(nextId, m); edgeEnds.put(nextId, new int[]{u, v});
                link(verts[u], m); link(m, verts[v]); total += w; nextId++;
            } else {
                long[] mm = pathMaxEdge(verts[u], verts[v]);
                long mw = mm[0]; int mid = (int) mm[1];
                if (w < mw) {
                    Node old = edgeNodes.get(mid); int[] ends = edgeEnds.get(mid);
                    cut(verts[ends[0]], old); cut(old, verts[ends[1]]); total -= mw; edgeNodes.remove(mid);
                    Node m = new Node(w, nextId);
                    edgeNodes.put(nextId, m); edgeEnds.put(nextId, new int[]{u, v});
                    link(verts[u], m); link(m, verts[v]); total += w; nextId++;
                }
            }
            System.out.println(total);
        }
    }
}
```

### Python
```python
NEG_INF = float("-inf")

class Node:
    __slots__ = ("ch", "parent", "val", "mxVal", "mxId", "id", "rev")
    def __init__(self, val, id):
        self.ch = [None, None]; self.parent = None
        self.val = val; self.mxVal = val; self.mxId = id; self.id = id; self.rev = False

def is_root(n):
    p = n.parent
    return p is None or (p.ch[0] is not n and p.ch[1] is not n)

def pull(n):
    n.mxVal, n.mxId = n.val, n.id
    for c in n.ch:
        if c and c.mxVal > n.mxVal:
            n.mxVal, n.mxId = c.mxVal, c.mxId

def apply_rev(n):
    if n is None: return
    n.ch[0], n.ch[1] = n.ch[1], n.ch[0]; n.rev = not n.rev

def push(n):
    if n.rev:
        apply_rev(n.ch[0]); apply_rev(n.ch[1]); n.rev = False

def rotate(n):
    p, g = n.parent, n.parent.parent
    d = 1 if p.ch[1] is n else 0
    if not is_root(p):
        if g.ch[0] is p: g.ch[0] = n
        else:            g.ch[1] = n
    n.parent = g
    p.ch[d] = n.ch[d ^ 1]
    if n.ch[d ^ 1]: n.ch[d ^ 1].parent = p
    n.ch[d ^ 1] = p; p.parent = n
    pull(p); pull(n)

def splay(n):
    push(n)
    while not is_root(n):
        p = n.parent
        if not is_root(p):
            g = p.parent; push(g); push(p); push(n)
            rotate(p if (g.ch[0] is p) == (p.ch[0] is n) else n)
        else:
            push(p); push(n)
        rotate(n)

def access(n):
    last = None; cur = n
    while cur is not None:
        splay(cur); cur.ch[1] = last; pull(cur); last = cur; cur = cur.parent
    splay(n)

def make_root(n): access(n); apply_rev(n)

def find_root(n):
    access(n)
    while n.ch[0]:
        push(n); n = n.ch[0]
    splay(n); return n

def link(u, v): make_root(u); u.parent = v

def cut(u, v):
    make_root(u); access(v)
    if v.ch[0] is u and u.ch[1] is None:
        v.ch[0].parent = None; v.ch[0] = None; pull(v)

def path_max_edge(u, v):
    make_root(u); access(v); return v.mxVal, v.mxId

def solve(n, edges):
    verts = [Node(NEG_INF, -1) for _ in range(n)]
    edge_nodes, edge_ends = {}, {}
    total = 0; nid = n; out = []
    for u, v, w in edges:
        if find_root(verts[u]) is not find_root(verts[v]):
            m = Node(w, nid); edge_nodes[nid] = m; edge_ends[nid] = (u, v)
            link(verts[u], m); link(m, verts[v]); total += w; nid += 1
        else:
            mw, mid = path_max_edge(verts[u], verts[v])
            if w < mw:
                old = edge_nodes[mid]; a, b = edge_ends[mid]
                cut(verts[a], old); cut(old, verts[b]); total -= mw; del edge_nodes[mid]
                m = Node(w, nid); edge_nodes[nid] = m; edge_ends[nid] = (u, v)
                link(verts[u], m); link(m, verts[v]); total += w; nid += 1
        out.append(total)
    return out

if __name__ == "__main__":
    edges = [(0,1,4),(1,2,3),(0,2,5),(2,3,2),(0,3,1),(3,4,7)]
    for t in solve(5, edges):
        print(t)
```

**Expected output** (running totals of MSF weight after each edge): `4, 7, 7, 9, 6, 13`.

Trace: `(0,1,4)`→4; `(1,2,3)`→7; `(0,2,5)` closes a cycle, path-max = 4, and 5 < 4 is false → **discarded**, stays 7; `(2,3,2)` links a new vertex →9; `(0,3,1)` closes the cycle 0-1-2-3 whose heaviest tree edge is 4, and 1 < 4 → **replace** (drop 4, add 1) → 9−4+1 = 6; `(3,4,7)` links a new vertex → 6+7 = 13.

**Evaluation:** correctness on cycle replacement, the edge-as-node encoding, amortized O(log n) per edge, and correct guards on `link`/`cut`.
