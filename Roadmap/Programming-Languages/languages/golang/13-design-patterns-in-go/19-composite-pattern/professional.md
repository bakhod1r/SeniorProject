# Composite — Professional

> Focus: staff/principal-level decisions. Composite is interface dispatch all the way down — `Children()` is the contract, and every other engineering decision flows from that one boundary. The hard parts are not "implement `Add`/`Remove`". They are: what does a billion-node tree cost in cache misses, how do you serialize without quadratic blowup, what do `GOMAXPROCS` workers stealing from a deep tree look like, and what happens when a customer uploads a 1 MB YAML file nested 50 000 levels deep. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Composite as a system primitive

A Composite is *uniform treatment of a part and a whole through one interface*. Consumers traverse without caring whether they hold a leaf or an interior node. The interface boundary buys polymorphism; performance, serialization, concurrency are consequences of that choice.

Composite is not the only way to encode a tree:

| Representation | Random access | Mutation | When it wins |
|---|---|---|---|
| Composite (pointer tree) | O(depth) by path | O(1) at node | Heterogeneous nodes, polymorphic ops, parser ASTs |
| Flat array + parent index | O(1) by index | O(N) for child insert | Homogeneous nodes, cache-bound workloads |
| Adjacency list (map of edges) | O(1) by ID | O(1) edge mutation | Graph-shaped (Composite forbids cycles) |
| Nested sets (left/right) | O(log N) subtree scan | O(N) rebalance | Read-heavy hierarchical SQL |
| Materialized path | O(log N) prefix index | O(N_subtree) | LIKE-prefix queries; URL-shaped trees |
| Closure table | O(1) row lookup | Heavy on insert/delete | Frequent ancestor/descendant queries |

Composite dominates when nodes are *heterogeneous* (`*BinaryOp`, `*Literal`, `*Call` in an AST) and operations are *polymorphic* (every node knows how to evaluate, print, type-check itself). The moment the tree becomes homogeneous (a million `Comment` rows nested under posts), flat representations win on every axis except code aesthetics.

Decision rule: **Composite for code-driven trees walked in-process (ASTs, DOMs, CLI command graphs). Flat arrays or SQL representations for data-driven trees stored in databases.** Mixing — a Composite that loads a million rows from Postgres into a pointer tree per request — is the canonical N+1-with-extra-pointer-chasing performance bug.

---

## 2. Quantitative cost analysis

Go 1.23, amd64, Linux 6.6, 16-core box. 100 000-node tree, fanout 5, depth ~10. Profile your own; orders of magnitude are what matter.

### 2.1 Interface dispatch per node

Every call through an interface costs an indirect call:

```
direct call (concrete struct)              ~2 ns    inlinable
interface call (one impl)                  ~3 ns    itab cached
interface call (two impls, alternating)    ~6 ns    itab cache miss every other call
type assertion `x.(*File)`                 ~2 ns
type switch over 5 types                   ~5 ns    jump table after warm
```

A 100 000-node traversal making two interface calls per node costs ~600 µs in dispatch overhead. Add real per-node work (regex, map insert) and dispatch fades into noise. Don't optimise dispatch in isolation; profile the whole walk.

### 2.2 Recursion stack depth

Go goroutines start with 8 KB stacks and grow up to 1 GB. Each frame of a typical `Walk(n Node, fn func(Node))` is ~80 bytes:

| Tree depth | Frames × 80 B | Risk |
|---|---|---|
| 100 | 8 KB | None |
| 1 000 | 80 KB | One stack-copy; fine |
| 10 000 | 800 KB | Latency spike from stack copies |
| 100 000 | 8 MB | Noticeable pause; check for cycles |
| 1 000 000 | 80 MB | Stack overflow at the 1 GB cap |

Linear-shaped trees (a list pretending to be a tree) blow up first. Attacker-controlled depth is the canonical exploit (§10). Mitigation: explicit stack, depth limit in `Walk`, restructure the data.

### 2.3 Cache locality

Composite nodes are individually heap-allocated. Siblings have no spatial relationship in memory:

```
flat array iteration (sequential)          ~0.3 ns/elem    L1 prefetch
pointer chase (random heap layout)         ~5 ns/elem      L1 miss every access
pointer chase (deep heap fragmentation)    ~80 ns/elem     L3 miss; main memory
```

A flat `[]Node` walk runs at memory bandwidth (~10 GB/s). A pointer-chase walk is *latency-bound* — one cache miss per node, ~100 ns each cold. A 100 000-node pointer tree walks in ~10 ms cold; the same data as a flat array walks in ~30 µs. **Three orders of magnitude.**

Built once, walked millions of times: flatten (§9). Built once, walked once: Composite is fine.

---

## 3. Serialization

A pointer tree on the heap is invisible to the network. Three production options, each with sharp trade-offs.

### 3.1 Tagged-union JSON

```go
type rawNode struct {
    Kind     string          `json:"kind"`
    Name     string          `json:"name,omitempty"`
    Size     int64           `json:"size,omitempty"`
    Children json.RawMessage `json:"children,omitempty"`
}

func (n *rawNode) Decode() (Node, error) {
    switch n.Kind {
    case "file":
        return &File{name: n.Name, size: n.Size}, nil
    case "folder":
        var raws []rawNode
        if err := json.Unmarshal(n.Children, &raws); err != nil { return nil, err }
        f := &Folder{name: n.Name}
        for _, r := range raws {
            c, err := r.Decode(); if err != nil { return nil, err }
            f.Add(c)
        }
        return f, nil
    }
    return nil, fmt.Errorf("unknown kind %q", n.Kind)
}
```

Human-readable, browser-compatible, schema-loose. Costs: ~2× memory (raw bytes + decoded), recursive decode hits the stack-depth issue (§8), unknown `Kind` is a decode error. Use for config, debug dumps, web APIs.

### 3.2 Protobuf `oneof`

```protobuf
message Node { oneof body { File file = 1; Folder folder = 2; } }
message File   { string name = 1; int64 size = 2; }
message Folder { string name = 1; repeated Node children = 2; }
```

Schema-enforced, ~3–5× smaller than JSON, forward/backward compatible via field numbers. Costs: codegen toolchain, unknown variants silently preserved, recursion sits in generated `Unmarshal` — same depth limits apply. The right default for service-to-service Composite payloads.

### 3.3 MessagePack

Self-describing binary, ~10% larger than protobuf, no schema needed. `msgpack:"kind"` mirrors the JSON pattern. Use when you want binary efficiency without a `.proto`, are talking to a polyglot consumer, or need schemaless wire flexibility. Avoid for high-throughput RPC — protobuf wins.

### 3.4 Comparison

| Format | Size | Decode CPU | Schema | Streaming | Best fit |
|---|---|---|---|---|---|
| JSON tagged-union | 1.0× | 1.0× | None | Hard (SAX possible) | Config, debug, web APIs |
| Protobuf `oneof` | 0.3× | 0.4× | `.proto` required | Native | Service RPC, persistent storage |
| MessagePack | 0.35× | 0.5× | Optional | Native | Polyglot binary, no toolchain |
| CBOR | 0.4× | 0.5× | Optional | Native | IoT/CoAP, deterministic encoding |

Serialization is also a security choice (§10). Self-describing formats are easier to abuse with adversarial depth.

---

## 4. Persistent trees

Mutable Composite is the default. Persistent (immutable, structurally shared) Composite is what you reach for when concurrent readers need a consistent snapshot, when undo/redo is a product requirement, or when versioned config is the contract.

### 4.1 Immutable updates

```go
// withChildAdded returns a NEW Folder; the original is untouched.
func (d *Folder) withChildAdded(c Node) *Folder {
    next := make([]Node, len(d.children)+1)
    copy(next, d.children); next[len(d.children)] = c
    return &Folder{name: d.name, children: next}
}
```

Adding a leaf at depth 10 rebuilds the path from leaf to root — 10 new `Folder` nodes, every other subtree shared by pointer. Update cost: O(depth × fanout). Storage: O(depth) extra nodes per update. Read cost: identical to mutable.

### 4.2 Structural sharing

The new version shares 99% of nodes with the old. A 1 M-node tree with one update produces ~depth new nodes (say 20) and shares ~999 980 by pointer. Memory cost is logarithmic in tree size.

Hash-array-mapped tries (HAMTs) generalise this to arbitrary keyed maps — the basis of Clojure's persistent collections. In Go, `github.com/benbjohnson/immutable` ships production-quality Map/List/SortedMap. For domain-specific Composite, write your own copy-on-write — 50 lines.

### 4.3 Finger trees

For sequences where you append/prepend at both ends and split at arbitrary positions in O(log N) — editing buffers, ropes — finger trees are textbook. CRDTs and rope-backed editors need them; most Go projects don't. Reach for `github.com/google/btree` first; finger trees only when profiling justifies.

### 4.4 When to choose persistent

| Workload | Choose |
|---|---|
| Single-threaded mutation, single reader | Mutable — persistent is wasteful |
| Many readers, occasional writer | Persistent + `atomic.Pointer` swap |
| Undo/redo, time-travel debugging | Persistent — free; hold past roots |
| Sub-tree diffing for sync (CRDT) | Persistent — O(changed) via pointer equality |

Killer property: **pointer equality is structural equality**. A subtree unchanged across versions has the same address. Sync protocols (Merkle-style) and incremental rebuilds (React reconciliation) exploit this; mutable trees cannot.

---

## 5. Concurrent traversal

A serial `Walk` over a 100 000-node tree takes ~10 ms cold (§2.3). On 16 cores with embarrassingly parallel per-node work, ~1 ms is the target. Two approaches.

### 5.1 Fan-out workers

```go
func ParallelWalk(root Node, workers int, fn func(Node)) {
    jobs := make(chan Node, 1024)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for n := range jobs { fn(n) } }()
    }
    var enqueue func(Node)
    enqueue = func(n Node) {
        jobs <- n
        for _, c := range n.Children() { enqueue(c) }
    }
    enqueue(root); close(jobs); wg.Wait()
}
```

Wrong for two reasons: (a) the producer is serial and walks the whole tree, eating the parallelism budget; (b) `jobs <- n` blocks when workers fall behind. Acceptable only for small trees with expensive per-node work (each `fn` is a network call).

### 5.2 Work-stealing for deep trees

For uniform per-node cost, every worker has a deque and steals from peers when empty:

```go
type Worker struct {
    mu    sync.Mutex
    queue []Node // owner pushes/pops back (LIFO); thieves steal front
}

func (w *Worker) popLocal() (Node, bool) {
    w.mu.Lock(); defer w.mu.Unlock()
    if len(w.queue) == 0 { return nil, false }
    n := w.queue[len(w.queue)-1]; w.queue = w.queue[:len(w.queue)-1]
    return n, true
}
// stealHalf: thief takes front half of w.queue under the same mutex.
```

Push children to the local deque, pop LIFO, steal peers' front when empty. Same shape as Go's goroutine scheduler. For 16 cores on a uniform 100 000-node tree, expect 12–14× speedup; the gap is end-game steal contention.

For most trees, the answer is **don't.** Parallel traversal is justified only when per-node work is expensive (parser, type-checker, network call) and the tree is large. Saving 9 ms once is rarely worth goroutine overhead per HTTP request.

### 5.3 Mutation during concurrent traversal

Don't. Forbid at the type level (`Children()` returns a read-only view; mutation requires a separate writer reference), or snapshot via persistent trees (§4). `sync.RWMutex` over the whole tree kills reader scaling and is the wrong primitive for tree-shaped data.

---

## 6. Streaming trees

When the tree exceeds memory, or you need to produce output before parsing finishes, SAX-style streaming replaces DOM-style materialisation.

### 6.1 SAX-style: events, no tree

```go
type Event struct { Kind int; Name, Value string; Depth int } // Kind: Start/End/Text
func StreamParse(r io.Reader, handle func(Event) error) error { /* ... */ }
```

Parser emits start/end events; consumer accumulates the state it needs. Memory is O(depth), not O(nodes). `encoding/xml.Decoder.Token()` is exactly this — read tokens, optionally `DecodeElement` to materialise a subtree.

O(depth) memory, can start emitting output immediately, handles inputs bigger than RAM. Costs: consumer tracks context explicitly, no random access, queries like "find the second `<book>`" are awkward.

### 6.2 DOM-style: full materialisation

```go
doc, err := html.Parse(r) // materialises the whole tree
walk(doc.FirstChild)
```

Random access for any traversal, easy CSS-selector-like queries, reusable across operations. Costs: O(N) memory, fails on pathological inputs (§10), parser must finish before consumer starts.

### 6.3 Trade-off table

| Need | SAX | DOM |
|---|---|---|
| Document > RAM | Mandatory | Crashes |
| Random access by path | Awkward | Native |
| Multiple passes over same data | Re-parse cost | Free |
| Latency-sensitive (first-byte) | Streaming | Buffered |
| Untrusted input | Bounded by handler | Bounded by input size |

Pragmatic answer: **stream the parse, materialise the subtrees that matter.** `xml.Decoder.Token` + `DecodeElement(&item, &startElem)` gives both. Materialise the `<item>` you care about, skip the `<metadata>` you don't.

---

## 7. Observability

A Composite tree is opaque. The day you debug "why is this customer's input slow" you'll wish you had metrics.

### 7.1 Tree shape gauges

| Metric | Type | Why |
|---|---|---|
| `tree_nodes_total{tree}` | Gauge | Memory proxy; alert on growth trend |
| `tree_max_depth{tree}` | Gauge | DoS canary; spike = malicious input |
| `tree_avg_fanout{tree}` | Gauge | Schema-drift indicator |
| `tree_walk_duration_seconds{tree,op}` | Histogram | Slow-traversal SLO |
| `tree_walk_aborted_total{tree,reason}` | Counter | Depth limit, timeout, cycle |
| `tree_serialize_bytes{tree,codec}` | Histogram | Wire-size regression |

### 7.2 Histogram of depth at parse time

For parsers exposed to untrusted input, depth is the most actionable metric. A depth p99 of 8 tells you what "normal" is; the day p99 jumps to 50 000 is the day someone tried billion-laughs (§10). Alert on it. Use logarithmic buckets — `[4, 8, 16, 32, 64, 128, 256, 1024, 8192, 65536]` — covering legitimate and adversarial regimes.

### 7.3 Slow-traversal alerting

If `tree_walk_duration_seconds{op="typecheck"}` p99 jumps from 100 ms to 5 s, either input shape changed, code regressed, or memory pressure caused page faults during pointer chase. Capture goroutine stacks on slow walks (`runtime/pprof`) to disambiguate.

### 7.4 Audit on suspicious shapes

Log at WARN when input exceeds a soft cap (depth > 1000, nodes > 1 M, single-node fanout > 10 000). Not errors yet — humans build big YAML — but leading indicators of producer bugs or parser-exhaustion attempts.

---

## 8. Failure modes

Tree failures mostly manifest as the *process* failing.

### 8.1 Cycles

A tree with one back-edge becomes a graph. Recursive walkers loop forever; depth-tracking walkers overflow the stack. Three defences:

| Defence | Cost | When |
|---|---|---|
| Type-level: nodes are immutable after construction | Zero runtime cost | Parser output, persistent trees |
| `seen map[Node]bool` in Walk | O(N) memory, ~50 ns/node hash | When cycles are possible but rare |
| Depth limit in Walk | O(1) memory, ~1 ns/node | When input is adversarial |

Pick one per tree. The pure-tree contract (no back-edges) is strongest and cheapest; enforce at construction.

### 8.2 Deep recursion → stack overflow

Go caps a goroutine's stack at ~1 GB. A `Walk` with 80-byte frames overflows at ~13 M frames; long before that, stack-copy latency dominates. Mitigations:

- **Iterative walk with explicit `[]Node` stack.** Heap-allocated, bounded by allocation rather than goroutine cap, easier to depth-limit.
- **Depth limit at the parser.** Refuse documents with depth > 10 000 at decode time. Cheaper than handling overflow.

```go
func IterWalk(root Node, fn func(Node)) {
    stack := []Node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]; stack = stack[:len(stack)-1]
        fn(n)
        for _, c := range n.Children() { stack = append(stack, c) }
    }
}
```

### 8.3 Mutation during traversal

```go
for _, c := range folder.children {
    if shouldDelete(c) { folder.Remove(c) } // mutating while ranging
}
```

`range` captures the slice header at loop start; `Remove` mutates the underlying array. Result: skipped or re-visited elements depending on where the removal occurs. Defences: collect-then-mutate (build a removal slice, apply after the walk), persistent trees (new root), or crash loudly if mutation is detected mid-walk.

### 8.4 Partial-evaluation correctness

When a walker has side effects (writing rows, emitting events) and aborts mid-subtree, you have a partial side-effect set. Recover by:

- **Idempotency.** Per-node side effects safe to retry.
- **Transactions.** Wrap the walk in a single transaction; abort = rollback.
- **Two-phase walk.** First pass collects intended side effects; second applies atomically.

Worst pattern: a half-completed walk leaving the system in a state no input could produce. Always provide an explicit recovery model.

---

## 9. Memory layout

Default Composite — `*Folder` with `[]Node` of interfaces — is pointer-heavy. Every node is its own heap allocation, every `Node` slot is a 16-byte interface header, every traversal is a cache-miss tour. Unacceptable for hot trees.

### 9.1 Pointer trees: the default cost

```go
type Folder struct {
    name     string   // 16 B header + heap string
    children []Node   // 24 B slice header + N × 16 B iface entries + N node allocs
}
```

Per node: ~64 B + fragmentation. 1 M nodes ≈ 64 MB scattered across the heap. GC scans every pointer; a 1 M-node tree costs ~10 ms of mark work.

### 9.2 Flat arrays with index references

```go
type FlatTree struct {
    nodes       []NodeData // contiguous; cache-friendly
    firstChild  []int32    // -1 if leaf
    nextSibling []int32    // -1 if last
}
type NodeData struct { Kind byte; Name string; Size int64 }
```

Walk by index; sequential layout lets L1 prefetcher work. 1 M nodes ≈ 32 MB, walked at memory bandwidth (~3 ms). GC scans three slice headers, not 1 M pointers.

Cost: heterogeneity dies. Every `NodeData` is one size; `File` and `Folder` share a struct with a discriminator field. Tagged-struct shape taken to its logical end.

### 9.3 Arena allocation

When the tree's lifetime is well-defined (parse → walk → discard), allocate all nodes in one arena, free as a unit:

```go
type Arena struct { buf []byte; off int }

func (a *Arena) New(size int) unsafe.Pointer {
    if a.off+size > len(a.buf) { /* grow */ }
    p := unsafe.Pointer(&a.buf[a.off]); a.off += size
    return p
}
```

O(1) per-node allocation, zero GC pressure, cache-friendly. Costs: `unsafe.Pointer`, no per-node finalisers, manual lifetime, must outlive every reference. Protobuf's C++ implementation uses arenas by default; Go's protobuf does not. Reach for arenas only when profiling shows allocation/GC dominates.

### 9.4 Layout decision table

| Trees per request | Walks per tree | Recommendation |
|---|---|---|
| 1 | 1 | Pointer tree, default Composite |
| 1 | 1000 | Flat array; one-time cost of conversion |
| 1000 | 1 | Arena per request; reset arena between |
| Persistent (held across requests) | Many | Persistent tree (§4) |
| Bigger than RAM | Streaming | SAX (§6) |

---

## 10. Security

Recursive data structures are the most reliable DoS surface on the open internet. The textbook attacks are decades old and still work.

### 10.1 Billion laughs (XML/JSON)

```xml
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol9;</lolz>
```

1 KB input expands to 10⁹ characters during entity resolution. `encoding/xml` disables most expansion by default, but custom parsers and downstream consumers may not. Defence: **disable entity expansion entirely** unless required. The JSON analogue is unbounded `{"a":{"a":{...}}}` — same shape, same DoS.

### 10.2 JSON deep nesting

```json
[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[ ... ]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
```

100 KB of brackets. `encoding/json` has no `MaxDepth` (Go 1.23) and overflows the goroutine stack on ~10 M nesting levels. Mitigation: depth-counting wrapper, hard cap (1000 is generous), or `jsoniter`/`goccy/go-json` with explicit limits.

```go
func ValidateDepth(r io.Reader, maxDepth int) error {
    dec := json.NewDecoder(io.LimitReader(r, 10<<20))
    var depth int
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }
        switch tok {
        case json.Delim('['), json.Delim('{'):
            if depth++; depth > maxDepth {
                return fmt.Errorf("max depth %d exceeded", maxDepth)
            }
        case json.Delim(']'), json.Delim('}'):
            depth--
        }
    }
}
```

### 10.3 Limits as policy

Untrusted Composite input needs explicit limits:

| Limit | Default for public APIs | Why |
|---|---|---|
| Max bytes | 1 MB (JSON), 10 MB (uploads) | Bounds total work |
| Max depth | 100 | Bounds stack and recursion |
| Max nodes | 100 000 | Bounds memory after parse |
| Max fanout at a single node | 10 000 | Bounds intermediate allocation |
| Max string length per field | 64 KB | Bounds individual leaf size |
| Parser timeout | 5 s | Bounds wall-clock for adversarial inputs |

These are *policy*, not magic numbers. Pick defaults that match your input distribution (§7), reject outliers, let humans request exceptions. **Every unbounded recursive parser on a public endpoint is a future on-call incident.**

### 10.4 Untrusted-input policy

| Source | Policy |
|---|---|
| First-party internal services | Limits as defence-in-depth; trust by default |
| Authenticated user input | Strict limits; per-user rate-limit; alert on rejections |
| Anonymous public input | Strictest limits; refuse on any anomaly |
| Federated (webhooks, ActivityPub) | Treat as anonymous; verify signatures separately |
| Plugin/customer-supplied | Sandbox the parser, not just the limits |

**The parser is the security boundary for any Composite-shaped input.** Validate before you walk.

---

## 11. Anti-patterns at scale

| Anti-pattern | Symptom | Fix |
|---|---|---|
| God interface (`Node` with 20 methods) | Every node implements stubs | Minimal `Children()`; feature-detect via `if r, ok := n.(Renamable); ok` |
| Parent pointers on every node | GC scans 2× more pointers; cycles | Compute parent during walk; pass via visitor state |
| `Children() []*Folder` (concrete) | Polymorphism defeated | `Children() []Node` always |
| `Children()` allocates a fresh slice | Per-traversal allocation; GC pressure | Return underlying slice; document immutability |
| Recursive Walk on adversarial input | Stack overflow | Iterative walk + depth limit |
| Copy-on-clone for serialization | Quadratic memory on deep trees | Walk + write; no intermediate tree |
| Pointer tree for 1 M-node DB-backed data | N+1 queries; 100 ms+ load | Flat repr; SQL closure table; load on demand |
| Mutation during concurrent walk | Race detector trips; crashes | Persistent tree or single-writer policy |
| Composite where flat array would do | Cache misses; GC; no benefit | Flat array + index references |
| `Parse`/`Marshal`/`Print`/`Eval` methods on every node | Cross-cutting concerns scattered | Visitor pattern; one impl per operation |
| `json.Unmarshal` on untrusted input, no depth cap | Public DoS surface | Token-streaming decoder with limits (§10) |
| Walker aborts mid-walk, leaves partial side effects | Inconsistent state; no rollback | Two-phase walk or transaction |
| `fmt.Sprintf` debug printer in production logs | 10 MB log lines from deep trees | Bounded depth-limited printer |

The deepest anti-pattern: **using Composite when flat would do.** A 16 KB Composite walked once per request is fine — dispatch is invisible. A 16 MB Composite walked thousands of times per request is a performance bug. **Pointer-heavy trees pay GC and cache-miss tax forever; flat arrays pay it once at construction.**

---

## 12. Closing principles

Composite is *interface dispatch all the way down*. One method — `Children()` — defines the pattern. Every other decision is a consequence. The power is uniformity; the hazards are uniformity scaled to production load.

1. **Composite is for heterogeneous, code-driven trees.** ASTs, DOMs, CLI command graphs — yes. A million `Comment` rows — no; that's a flat table with `parent_id` and a closure-table index. Composite when *types* differ and *operations* are polymorphic; flat when data is uniform and storage is durable.

2. **Interface dispatch is cheap; pointer chase is not.** A 100 000-node walk costs ~600 µs in dispatch and ~10 ms in cache misses cold. The bottleneck is layout. Flatten when you walk more than you build.

3. **Serialization is the wire shape.** Tagged-union JSON for human-facing config and debug; protobuf `oneof` for service-to-service; MessagePack for polyglot binary. Don't invent a format; don't ship JSON over high-throughput RPC.

4. **Persistent trees buy safety; mutable trees buy simplicity.** Persistent for many readers + occasional writer, undo/redo, sub-tree diffing. Mutable for single-threaded parsers. The day you reach for `sync.RWMutex` to coordinate readers is the day `atomic.Pointer[Node]` with persistent updates wins.

5. **Parallel traversal pays only on expensive per-node work.** Fan-out for I/O-bound; work-stealing for uniform CPU-bound on big trees; serial for everything else.

6. **Stream when the tree exceeds memory.** SAX for unbounded input; materialise only subtrees the consumer needs. `xml.Decoder.Token()` + `DecodeElement` is the sweet spot.

7. **Observability is the shape, not the contents.** Node-count gauges, depth histograms, aborted-walk counters. Depth p99 spiking is the adversarial-input canary.

8. **Failure modes are stack and mutation.** Forbid cycles at the type level; iterate over a stack; snapshot before walking; design for idempotency or transactions.

9. **Layout is a performance budget.** Pointer trees: 64 B/node, every pointer scanned, L3 latency. Flat arrays: 32 B/node, slice-header scan, memory bandwidth. Arenas: O(1) alloc, freed as a unit. Match layout to lifetime; profile before changing.

10. **Untrusted recursive input is the DoS surface.** Bytes, depth, node, fanout, timeout caps on every public parser. No exceptions. Adversarial depth is older than your codebase and still works.

Get these right and Composite is invisible: parsers produce trees, walkers traverse, serialisers round-trip, persistent updates publish new versions atomically. Get them wrong and the on-call incident is a 50 000-level YAML overflowing the stack, a serialiser allocating quadratic memory on a wide tree, a hot path walking pointers at L3 latency per request, and a parallel walker mutating siblings under another worker's iterator. **Composite is the easiest pattern to write and one of the easiest to operate carelessly.** Interface dispatch is the contract; everything else is engineering.

---

## Further reading

- `go/ast` — canonical pure-interface Composite in the standard library
- `golang.org/x/net/html` — DOM Composite with explicit tree mutation
- `gopkg.in/yaml.v3` — tagged-struct Composite with stream parser
- `encoding/xml.Decoder` — SAX/DOM hybrid streaming
- `github.com/benbjohnson/immutable` — persistent collections (HAMT, sorted map)
- Phil Bagwell, *Ideal Hash Trees* — HAMT foundation paper
- Chris Okasaki, *Purely Functional Data Structures* — persistent tree algorithms
- Hickey, *Persistent Hash Map Implementation* — Clojure's persistent collection design
- OWASP, *XML External Entity (XXE) Processing* — billion-laughs and related attacks
- protobuf `oneof` reference — wire format for tagged Composite payloads
- Russ Cox, *Profiling Go Programs* — methodology for tree-walk performance work
