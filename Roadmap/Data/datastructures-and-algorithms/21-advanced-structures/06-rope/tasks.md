# Rope — Hands-On Tasks

> **Audience:** Anyone who has read `junior.md`, `middle.md`, and (for the harder tier) `senior.md`/`professional.md`, and wants to lock the patterns in by building a real rope library.

Work through these in order within each tier. By the end you will have a balanced, persistent, line-aware rope with a property-test harness. Reference language is Python (translate to Go/Java as extra practice); pick whichever you are interviewing in.

The single rule that makes ropes click: **everything is `split` + `concat`, and you descend by comparing the position to the weight.** Most tasks below exist to drill that.

---

## Tier 1 — Junior (Tasks 1–5): Leaves, Weights, Index, Concat

### Task 1 — Node model and `length`
Implement a `Node` that is either a **leaf** (holds a `chunk` string) or an **internal** node (holds `left`, `right`). Compute and cache `weight` (= length of the left subtree) and `length` (= total characters) in the constructor. Write `rope_len(n)` returning `length` (0 for `None`).
**Verify:** `concat(leaf("ab"), leaf("cde"))` has `weight == 2` and `length == 5`.

### Task 2 — `concat(A, B)` in O(1)
Implement `concat` that returns `B` if `A` is empty, `A` if `B` is empty, else a new internal node with `left=A, right=B`. Confirm no characters are copied (only one node is allocated).
**Verify:** building `concat(concat(leaf("a"),leaf("b")),leaf("c"))` reads back as `"abc"` via a leaf-walk `to_str`.

### Task 3 — `index(i)` by descending on weight
Implement `index(n, i)`: while at an internal node, go left if `i < weight`, else `i -= weight` and go right; at the leaf return `chunk[i]`. Validate `0 <= i < length` first.
**Verify:** on the rope for `"Hello_my_name_is_Simon"` (split across the 5 leaves from `junior.md`), `index(10) == 'a'` and `index(0) == 'H'`.

### Task 4 — `to_str` (full read) and an iterator
Implement `to_str(n)` via in-order leaf concatenation (O(n)). Then implement a generator `chars(n)` that yields characters by walking leaves — proving you should iterate, not call `index` in a loop.
**Verify:** `to_str(r) == "".join(chars(r))` for any rope.

### Task 5 — Build a rope from a string with a chunk cap
Write `from_string(s, chunk=8)` that slices `s` into ≤`chunk`-length leaves and `concat`s them left-to-right into one rope. Print the resulting tree's height.
**Verify:** `to_str(from_string("Hello_my_name_is_Simon", 5)) == "Hello_my_name_is_Simon"`; height is small relative to n.

---

## Tier 2 — Middle (Tasks 6–10): Split, Insert, Delete, Substring, Balance Check

### Task 6 — `split(n, i)` → `(L, R)`
Implement `split`: at a leaf, slice the chunk (handle `i<=0` and `i>=len`); at an internal node, recurse into the side containing the cut and `concat` the off-path child onto the correct result side (right child → right result when cutting left; left child → left result when cutting right).
**Verify:** for every `i` in `0..len`, `to_str(L) + to_str(R) == to_str(original)` where `(L,R)=split(r,i)`.

### Task 7 — `insert(i, s)` and `delete(i, j)` as compositions
Implement `insert(n, i, s) = concat(concat(L, leaf(s)), R)` and `delete(n, i, j) = concat(L, R)` after splitting out `[i, j)`. Express both purely via `split`/`concat`.
**Verify:** `insert` then `delete` of the same span returns the original string; `delete(0, len)` yields the empty rope.

### Task 8 — `substring(i, j)` in O(log n + m)
Implement `substring` that descends to the boundary and walks leaves collecting `j - i` characters — without calling `index` in a loop. Count and print the number of leaves touched.
**Verify:** `substring(r, i, j) == to_str(r)[i:j]` for random `i ≤ j`.

### Task 9 — `replace` and `move`
Implement `replace(n, i, j, s)` (= delete then insert) and `move(n, i, j, k)` (cut block `[i,j)` and insert it at position `k` in the remaining text). Both must be O(log n) (+|s|) compositions of split/concat.
**Verify:** against flat-string equivalents on 1000 random operations.

### Task 10 — Height tracking and a balance warning
Add a `height(n)` function. Build a rope by concatenating 1000 single-char leaves *without* rebalancing and show the height is ~1000 (a spine), making `index` O(n). Then rebuild via Task 5's `from_string` and show the height drops to O(log n).
**Verify:** print both heights; confirm the spine's `index(999)` touches ~1000 nodes vs ~10 after rebuild.

---

## Tier 3 — Senior/Professional (Tasks 11–15): Balance, Persistence, Lines, mmap, Fuzz

### Task 11 — Treap-balanced rope (split + merge)
Add a random 64-bit `prio` to each node and replace `concat` with treap `merge` (higher priority stays on top) and `split` with the treap split. Keep nodes **immutable** (build new nodes, never mutate).
**Verify:** after 10⁵ random inserts/deletes the height stays O(log n) (print max height seen); all reads still match a flat-string oracle.

### Task 12 — Persistence and O(1) undo/redo
Wrap the rope in a `Buffer` that keeps a list of roots. Each edit appends the new (path-copied) root; `undo`/`redo` move an index. Truncate the redo branch on a fresh edit.
**Verify:** a sequence of edits followed by N undos reproduces every intermediate document exactly; confirm old roots are unmodified (immutability) and each edit allocated only O(log n) new nodes.

### Task 13 — Line/column mapping via newline augmentation
Augment each node with `newlines` (= newlines in its subtree). Implement `line_of(pos)` (0-based line of a byte position) and `line_start(line)` (byte position where a line begins), both O(log n) by descending on the newline counts.
**Verify:** on a multi-line document, `line_of` and `line_start` agree with a brute-force scan for every position/line.

### Task 14 — Reference-leaves (simulated mmap) + coalescing
Add a second leaf kind that references a span of a large read-only "original" string (`(buffer, offset, length)`) instead of owning bytes; edits create small private leaves. Then write `coalesce(n, target)` that merges adjacent tiny private leaves into `target`-sized chunks.
**Verify:** building a rope over a 1 MB original costs O(1) leaves; after many edits, `coalesce` reduces leaf count and tree height while `to_str` is unchanged.

### Task 15 — Property-test harness and chunk-size benchmark
Write a fuzzer that applies random `insert`/`delete`/`split`/`replace`/`move` to both your rope and a flat string, asserting equality of `to_str`, random `index`, and random `substring` after every step (≥10⁵ ops). Then benchmark `index`, `insert`, and full-read throughput across chunk sizes {1, 8, 64, 256, 4096} and report the sweet spot.
**Verify:** zero assertion failures; produce a table of (chunk size → ops/sec) showing the 64–256 range winning, matching `senior.md` §4.

---

**Next step:** [animation.html](animation.html) — visualize the rope tree, an index descent, a concat, and a split interactively.
