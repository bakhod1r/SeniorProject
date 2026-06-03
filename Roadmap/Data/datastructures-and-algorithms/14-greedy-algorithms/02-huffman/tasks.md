# Huffman Coding — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a round-trip tester early — encode then decode must reproduce the input. Known checks: `"abracadabra"` → 23 bits with an optimal code; entropy band `H ≤ L < H + 1`; Kraft sum `Σ 2^(−len) = 1` for a complete code.

---

## Beginner Tasks (5)

### Task 1 — Count frequencies and report the distribution

**Problem.** Given a string, count how often each character appears and print the symbols sorted, with their counts and probabilities.

**Constraints.** `1 ≤ |text| ≤ 10⁶`, ASCII.

**Hint.** A map/dict keyed by character. Probability = count / total.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	text := "abracadabra"
	freq := map[byte]int{}
	for i := 0; i < len(text); i++ {
		freq[text[i]]++
	}
	syms := make([]int, 0, len(freq))
	for s := range freq {
		syms = append(syms, int(s))
	}
	sort.Ints(syms)
	for _, s := range syms {
		fmt.Printf("%c: %d (%.3f)\n", byte(s), freq[byte(s)], float64(freq[byte(s)])/float64(len(text)))
	}
}
```

#### Java
```java
import java.util.*;
public class Task1 {
    public static void main(String[] args) {
        String text = "abracadabra";
        Map<Character, Integer> freq = new TreeMap<>();
        for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
        for (var e : freq.entrySet())
            System.out.printf("%c: %d (%.3f)%n", e.getKey(), e.getValue(),
                (double) e.getValue() / text.length());
    }
}
```

#### Python
```python
from collections import Counter

text = "abracadabra"
freq = Counter(text)
for s in sorted(freq):
    print(f"{s}: {freq[s]} ({freq[s] / len(text):.3f})")
```

---

### Task 2 — Build the Huffman tree and emit the code table

**Problem.** Build the Huffman tree with a min-heap and produce the `symbol → codeword` table.

**Constraints.** `1 ≤ n ≤ 256`. Deterministic ties.

**Hint.** Pop two smallest, merge (sum freq), push; `n−1` times. Then DFS: left=`0`, right=`1`.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type node struct {
	freq, order int
	sym         byte
	leaf        bool
	left, right *node
}
type mh []*node

func (h mh) Len() int { return len(h) }
func (h mh) Less(i, j int) bool {
	if h[i].freq != h[j].freq {
		return h[i].freq < h[j].freq
	}
	return h[i].order < h[j].order
}
func (h mh) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *mh) Push(x any)   { *h = append(*h, x.(*node)) }
func (h *mh) Pop() any     { o := *h; n := len(o); x := o[n-1]; *h = o[:n-1]; return x }

func build(freq map[byte]int) *node {
	syms := make([]int, 0, len(freq))
	for s := range freq {
		syms = append(syms, int(s))
	}
	sort.Ints(syms)
	h := &mh{}
	ord := 0
	for _, s := range syms {
		heap.Push(h, &node{freq: freq[byte(s)], sym: byte(s), leaf: true, order: ord})
		ord++
	}
	if h.Len() == 1 {
		only := heap.Pop(h).(*node)
		return &node{freq: only.freq, left: only, order: ord}
	}
	for h.Len() > 1 {
		a := heap.Pop(h).(*node)
		b := heap.Pop(h).(*node)
		heap.Push(h, &node{freq: a.freq + b.freq, left: a, right: b, order: ord})
		ord++
	}
	return heap.Pop(h).(*node)
}

func codes(root *node) map[byte]string {
	out := map[byte]string{}
	var walk func(n *node, p string)
	walk = func(n *node, p string) {
		if n.leaf {
			if p == "" {
				p = "0"
			}
			out[n.sym] = p
			return
		}
		walk(n.left, p+"0")
		walk(n.right, p+"1")
	}
	walk(root, "")
	return out
}

func main() {
	text := "abracadabra"
	freq := map[byte]int{}
	for i := 0; i < len(text); i++ {
		freq[text[i]]++
	}
	table := codes(build(freq))
	keys := make([]int, 0, len(table))
	for s := range table {
		keys = append(keys, int(s))
	}
	sort.Ints(keys)
	for _, s := range keys {
		fmt.Printf("%c -> %s\n", byte(s), table[byte(s)])
	}
}
```

#### Java
```java
import java.util.*;
public class Task2 {
    static class N { int freq, order; char sym; boolean leaf; N left, right;
        N(int f, int o, char s, boolean l) { freq=f; order=o; sym=s; leaf=l; } }
    static N build(Map<Character, Integer> freq) {
        List<Character> syms = new ArrayList<>(freq.keySet());
        Collections.sort(syms);
        PriorityQueue<N> h = new PriorityQueue<>(
            (a, b) -> a.freq != b.freq ? a.freq - b.freq : a.order - b.order);
        int[] ord = {0};
        for (char s : syms) h.add(new N(freq.get(s), ord[0]++, s, true));
        if (h.size() == 1) { N o = h.poll(); N p = new N(o.freq, ord[0]++, '\0', false); p.left = o; return p; }
        while (h.size() > 1) {
            N a = h.poll(), b = h.poll();
            N m = new N(a.freq + b.freq, ord[0]++, '\0', false); m.left = a; m.right = b; h.add(m);
        }
        return h.poll();
    }
    static void walk(N n, String p, Map<Character, String> out) {
        if (n.leaf) { out.put(n.sym, p.isEmpty() ? "0" : p); return; }
        walk(n.left, p + "0", out); walk(n.right, p + "1", out);
    }
    public static void main(String[] args) {
        String text = "abracadabra";
        Map<Character, Integer> freq = new HashMap<>();
        for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
        Map<Character, String> table = new TreeMap<>();
        walk(build(freq), "", table);
        for (var e : table.entrySet()) System.out.println(e.getKey() + " -> " + e.getValue());
    }
}
```

#### Python
```python
import heapq
from collections import Counter
from itertools import count

def build(freq):
    tie = count()
    heap = [[freq[s], next(tie), s, None, None] for s in sorted(freq)]
    heapq.heapify(heap)
    if len(heap) == 1:
        only = heap[0]
        return [only[0], next(tie), None, only, None]
    while len(heap) > 1:
        a, b = heapq.heappop(heap), heapq.heappop(heap)
        heapq.heappush(heap, [a[0] + b[0], next(tie), None, a, b])
    return heap[0]

def codes(root):
    out = {}
    def walk(node, p):
        _, _, sym, left, right = node
        if sym is not None:
            out[sym] = p or "0"
        else:
            walk(left, p + "0"); walk(right, p + "1")
    walk(root, "")
    return out

table = codes(build(Counter("abracadabra")))
for s in sorted(table):
    print(f"{s} -> {table[s]}")
```

---

### Task 3 — Encode and decode (round trip)

**Problem.** Encode a string with the code table, then decode the bits by walking the tree; assert the result equals the input.

**Constraints.** `1 ≤ |text| ≤ 10⁶`.

**Hint.** Decode: descend left on `0`, right on `1`; emit symbol at each leaf and reset to root.

#### Go
```go
package main

import (
	"fmt"
	"strings"
)

func main() {
	text := "abracadabra"
	freq := map[byte]int{}
	for i := 0; i < len(text); i++ {
		freq[text[i]]++
	}
	root := build(freq)            // from Task 2
	table := codes(root)           // from Task 2
	var enc strings.Builder
	for i := 0; i < len(text); i++ {
		enc.WriteString(table[text[i]])
	}
	bits := enc.String()
	var dec strings.Builder
	cur := root
	for _, b := range bits {
		if b == '0' {
			cur = cur.left
		} else {
			cur = cur.right
		}
		if cur.leaf {
			dec.WriteByte(cur.sym)
			cur = root
		}
	}
	fmt.Println("match:", dec.String() == text, "bits:", len(bits))
}
```

#### Java
```java
public class Task3 {
    public static void main(String[] args) {
        String text = "abracadabra";
        var freq = new java.util.HashMap<Character, Integer>();
        for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
        Task2.N root = Task2.build(freq);
        var table = new java.util.HashMap<Character, String>();
        Task2.walk(root, "", table);
        StringBuilder enc = new StringBuilder();
        for (char c : text.toCharArray()) enc.append(table.get(c));
        String bits = enc.toString();
        StringBuilder dec = new StringBuilder(); Task2.N cur = root;
        for (char b : bits.toCharArray()) {
            cur = b == '0' ? cur.left : cur.right;
            if (cur.leaf) { dec.append(cur.sym); cur = root; }
        }
        System.out.println("match: " + dec.toString().equals(text) + " bits: " + bits.length());
    }
}
```

#### Python
```python
from collections import Counter

text = "abracadabra"
root = build(Counter(text))       # from Task 2
table = codes(root)               # from Task 2
bits = "".join(table[c] for c in text)
out, node = [], root
for b in bits:
    node = node[3] if b == "0" else node[4]
    if node[2] is not None:
        out.append(node[2]); node = root
print("match:", "".join(out) == text, "bits:", len(bits))
```

---

### Task 4 — Compare to fixed-length size

**Problem.** Compute the Huffman-encoded size in bits and compare to a fixed-length code (`⌈log₂ n⌉` bits/symbol). Report the saving.

**Constraints.** `1 ≤ n ≤ 256`.

**Hint.** Huffman bits = `Σ freq·len`. Fixed = `N · ⌈log₂ n⌉`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func main() {
	text := "abracadabra"
	freq := map[byte]int{}
	for i := 0; i < len(text); i++ {
		freq[text[i]]++
	}
	table := codes(build(freq))     // Task 2
	huff := 0
	for i := 0; i < len(text); i++ {
		huff += len(table[text[i]])
	}
	n := len(freq)
	fixedBits := int(math.Ceil(math.Log2(float64(n))))
	if n == 1 {
		fixedBits = 1
	}
	fixed := len(text) * fixedBits
	fmt.Printf("huffman=%d fixed=%d saving=%.1f%%\n", huff, fixed, 100*float64(fixed-huff)/float64(fixed))
}
```

#### Java
```java
public class Task4 {
    public static void main(String[] args) {
        String text = "abracadabra";
        var freq = new java.util.HashMap<Character, Integer>();
        for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
        var table = new java.util.HashMap<Character, String>();
        Task2.walk(Task2.build(freq), "", table);
        int huff = 0;
        for (char c : text.toCharArray()) huff += table.get(c).length();
        int n = freq.size();
        int fixedBits = n == 1 ? 1 : (int) Math.ceil(Math.log(n) / Math.log(2));
        int fixed = text.length() * fixedBits;
        System.out.printf("huffman=%d fixed=%d saving=%.1f%%%n", huff, fixed, 100.0 * (fixed - huff) / fixed);
    }
}
```

#### Python
```python
import math
from collections import Counter

text = "abracadabra"
freq = Counter(text)
table = codes(build(freq))          # Task 2
huff = sum(len(table[c]) for c in text)
n = len(freq)
fixed_bits = 1 if n == 1 else math.ceil(math.log2(n))
fixed = len(text) * fixed_bits
print(f"huffman={huff} fixed={fixed} saving={100 * (fixed - huff) / fixed:.1f}%")
```

---

### Task 5 — Handle single-symbol and empty inputs

**Problem.** Confirm your builder handles `""` (empty) and a string of one repeated character (`"aaaa"`) without crashing; the lone symbol must get a 1-bit code.

**Constraints.** Inputs include `""`, `"a"`, `"aaaa"`.

**Hint.** Empty → empty table, zero bits. Single distinct symbol → code `"0"`.

#### Go
```go
package main

import "fmt"

func main() {
	for _, text := range []string{"", "a", "aaaa"} {
		freq := map[byte]int{}
		for i := 0; i < len(text); i++ {
			freq[text[i]]++
		}
		if len(freq) == 0 {
			fmt.Printf("%q -> empty\n", text)
			continue
		}
		table := codes(build(freq))   // Task 2
		fmt.Printf("%q -> %v\n", text, table)
	}
}
```

#### Java
```java
public class Task5 {
    public static void main(String[] args) {
        for (String text : new String[]{"", "a", "aaaa"}) {
            var freq = new java.util.HashMap<Character, Integer>();
            for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
            if (freq.isEmpty()) { System.out.println("\"" + text + "\" -> empty"); continue; }
            var table = new java.util.HashMap<Character, String>();
            Task2.walk(Task2.build(freq), "", table);
            System.out.println("\"" + text + "\" -> " + table);
        }
    }
}
```

#### Python
```python
from collections import Counter

for text in ["", "a", "aaaa"]:
    freq = Counter(text)
    if not freq:
        print(repr(text), "-> empty")
        continue
    print(repr(text), "->", codes(build(freq)))   # Task 2
```

---

## Intermediate Tasks (5)

### Task 6 — Canonical Huffman from lengths

**Problem.** Compute Huffman code *lengths*, then assign **canonical** codewords from the lengths alone. Verify decoding works from the canonical table.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Sort by `(length, symbol)`; `code <<= Δlength`; assign; `code++`.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

func lengths(freq map[byte]int) map[byte]int {
	syms := make([]int, 0, len(freq))
	for s := range freq {
		syms = append(syms, int(s))
	}
	sort.Ints(syms)
	h := &mh{} // mh from Task 2
	ord := 0
	for _, s := range syms {
		heap.Push(h, &node{freq: freq[byte(s)], sym: byte(s), leaf: true, order: ord})
		ord++
	}
	L := map[byte]int{}
	if h.Len() == 1 {
		L[(*h)[0].sym] = 1
		return L
	}
	for h.Len() > 1 {
		a := heap.Pop(h).(*node)
		b := heap.Pop(h).(*node)
		heap.Push(h, &node{freq: a.freq + b.freq, left: a, right: b, order: ord})
		ord++
	}
	var walk func(n *node, d int)
	walk = func(n *node, d int) {
		if n.leaf {
			L[n.sym] = d
			return
		}
		walk(n.left, d+1)
		walk(n.right, d+1)
	}
	walk(heap.Pop(h).(*node), 0)
	return L
}

func canonical(L map[byte]int) map[byte]string {
	type sl struct {
		s byte
		l int
	}
	arr := make([]sl, 0, len(L))
	for s, l := range L {
		arr = append(arr, sl{s, l})
	}
	sort.Slice(arr, func(i, j int) bool {
		if arr[i].l != arr[j].l {
			return arr[i].l < arr[j].l
		}
		return arr[i].s < arr[j].s
	})
	out := map[byte]string{}
	code, prev := 0, 0
	for _, e := range arr {
		code <<= (e.l - prev)
		out[e.s] = fmt.Sprintf("%0*b", e.l, code)
		code++
		prev = e.l
	}
	return out
}

func main() {
	freq := map[byte]int{'a': 5, 'b': 2, 'r': 2, 'c': 1, 'd': 1}
	for s, c := range canonical(lengths(freq)) {
		fmt.Printf("%c -> %s\n", s, c)
	}
}
```

#### Java
```java
import java.util.*;
public class Task6 {
    static Map<Character, Integer> lengths(Map<Character, Integer> freq) {
        List<Character> syms = new ArrayList<>(freq.keySet());
        Collections.sort(syms);
        PriorityQueue<Task2.N> h = new PriorityQueue<>(
            (a, b) -> a.freq != b.freq ? a.freq - b.freq : a.order - b.order);
        int[] ord = {0};
        for (char s : syms) h.add(new Task2.N(freq.get(s), ord[0]++, s, true));
        Map<Character, Integer> L = new HashMap<>();
        if (h.size() == 1) { L.put(h.peek().sym, 1); return L; }
        while (h.size() > 1) {
            Task2.N a = h.poll(), b = h.poll();
            Task2.N m = new Task2.N(a.freq + b.freq, ord[0]++, '\0', false);
            m.left = a; m.right = b; h.add(m);
        }
        walk(h.poll(), 0, L);
        return L;
    }
    static void walk(Task2.N n, int d, Map<Character, Integer> L) {
        if (n.leaf) { L.put(n.sym, d); return; }
        walk(n.left, d + 1, L); walk(n.right, d + 1, L);
    }
    static Map<Character, String> canonical(Map<Character, Integer> L) {
        List<Map.Entry<Character, Integer>> a = new ArrayList<>(L.entrySet());
        a.sort((x, y) -> x.getValue().equals(y.getValue())
            ? Character.compare(x.getKey(), y.getKey()) : x.getValue() - y.getValue());
        Map<Character, String> out = new TreeMap<>();
        int code = 0, prev = 0;
        for (var e : a) {
            int Lv = e.getValue(); code <<= (Lv - prev);
            out.put(e.getKey(), String.format("%" + Lv + "s",
                Integer.toBinaryString(code)).replace(' ', '0'));
            code++; prev = Lv;
        }
        return out;
    }
    public static void main(String[] args) {
        var freq = new HashMap<Character, Integer>();
        for (char c : "abracadabra".toCharArray()) freq.merge(c, 1, Integer::sum);
        canonical(lengths(freq)).forEach((s, c) -> System.out.println(s + " -> " + c));
    }
}
```

#### Python
```python
import heapq
from collections import Counter
from itertools import count

def lengths(freq):
    tie = count()
    heap = [[freq[s], next(tie), s, None, None] for s in sorted(freq)]
    heapq.heapify(heap)
    if len(heap) == 1:
        return {heap[0][2]: 1}
    while len(heap) > 1:
        a, b = heapq.heappop(heap), heapq.heappop(heap)
        heapq.heappush(heap, [a[0] + b[0], next(tie), None, a, b])
    L = {}
    def walk(node, d):
        _, _, s, left, right = node
        if s is not None: L[s] = d
        else: walk(left, d + 1); walk(right, d + 1)
    walk(heap[0], 0)
    return L

def canonical(L):
    out, code, prev = {}, 0, 0
    for s in sorted(L, key=lambda x: (L[x], x)):
        l = L[s]; code <<= (l - prev); out[s] = format(code, f"0{l}b"); code += 1; prev = l
    return out

for s, c in canonical(lengths(Counter("abracadabra"))).items():
    print(f"{s} -> {c}")
```

---

### Task 7 — Verify the entropy bound

**Problem.** For several distributions, build the code, compute `L` and `H`, and assert `H ≤ L < H + 1`.

**Constraints.** Include a power-of-two distribution (where `L = H`) and a uniform one.

**Hint.** `H = −Σ p log₂ p`; `L = Σ p·len`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func main() {
	dists := []map[byte]int{
		{'a': 5, 'b': 2, 'r': 2, 'c': 1, 'd': 1},
		{'a': 4, 'b': 2, 'c': 1, 'd': 1}, // 1/2,1/4,1/8,1/8 -> L=H=1.75
		{'w': 1, 'x': 1, 'y': 1, 'z': 1},
	}
	for _, freq := range dists {
		L := lengths(freq) // Task 6
		total := 0
		for _, f := range freq {
			total += f
		}
		avg, H := 0.0, 0.0
		for s, f := range freq {
			p := float64(f) / float64(total)
			avg += p * float64(L[s])
			H += -p * math.Log2(p)
		}
		fmt.Printf("H=%.4f L=%.4f ok=%v\n", H, avg, H <= avg+1e-9 && avg < H+1)
	}
}
```

#### Java
```java
import java.util.*;
public class Task7 {
    public static void main(String[] args) {
        List<Map<Character, Integer>> dists = List.of(
            Map.of('a',5,'b',2,'r',2,'c',1,'d',1),
            Map.of('a',4,'b',2,'c',1,'d',1),
            Map.of('w',1,'x',1,'y',1,'z',1));
        for (var freq : dists) {
            var L = Task6.lengths(freq);
            int total = freq.values().stream().mapToInt(Integer::intValue).sum();
            double avg = 0, H = 0;
            for (var e : freq.entrySet()) {
                double p = (double) e.getValue() / total;
                avg += p * L.get(e.getKey());
                H += -p * (Math.log(p) / Math.log(2));
            }
            System.out.printf("H=%.4f L=%.4f ok=%b%n", H, avg, H <= avg + 1e-9 && avg < H + 1);
        }
    }
}
```

#### Python
```python
import math
from collections import Counter

for freq in [Counter("abracadabra"),
             {"a": 4, "b": 2, "c": 1, "d": 1},   # L = H = 1.75
             {"w": 1, "x": 1, "y": 1, "z": 1}]:
    L = lengths(freq)                              # Task 6
    total = sum(freq.values())
    avg = sum((freq[s] / total) * L[s] for s in freq)
    H = -sum((freq[s] / total) * math.log2(freq[s] / total) for s in freq)
    print(f"H={H:.4f} L={avg:.4f} ok={H - 1e-9 <= avg < H + 1}")
```

---

### Task 8 — Validate the Kraft inequality

**Problem.** Confirm the computed code lengths satisfy `Σ 2^(−len) = 1` (a complete Huffman code is always full).

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Accumulate `2^(−len)`; it must equal 1 for a full tree.

#### Go
```go
package main

import "fmt"

func main() {
	freq := map[byte]int{'a': 5, 'b': 2, 'r': 2, 'c': 1, 'd': 1}
	L := lengths(freq) // Task 6
	kraft := 0.0
	for _, l := range L {
		kraft += 1.0 / float64(int64(1)<<l)
	}
	fmt.Printf("Kraft = %.6f (== 1: %v)\n", kraft, kraft > 0.999999 && kraft < 1.000001)
}
```

#### Java
```java
public class Task8 {
    public static void main(String[] args) {
        var freq = new java.util.HashMap<Character, Integer>();
        for (char c : "abracadabra".toCharArray()) freq.merge(c, 1, Integer::sum);
        var L = Task6.lengths(freq);
        double kraft = 0;
        for (int l : L.values()) kraft += 1.0 / (1L << l);
        System.out.printf("Kraft = %.6f (== 1: %b)%n", kraft, Math.abs(kraft - 1) < 1e-6);
    }
}
```

#### Python
```python
from collections import Counter

L = lengths(Counter("abracadabra"))    # Task 6
kraft = sum(2 ** -l for l in L.values())
print(f"Kraft = {kraft:.6f} (== 1: {abs(kraft - 1) < 1e-9})")
```

---

### Task 9 — Decode from a canonical table (no tree)

**Problem.** Given canonical lengths and a bit stream, decode by accumulating bits into `(length, value)` and matching against the canonical table — the way zlib/JPEG decode.

**Constraints.** Stream is well-formed.

**Hint.** Build `table[(L, code)] = symbol`; accumulate bits, reset on match.

#### Python
```python
def decode_canonical(L, bits):
    code, prev, table = 0, 0, {}
    for s in sorted(L, key=lambda x: (L[x], x)):
        l = L[s]; code <<= (l - prev); table[(l, code)] = s; code += 1; prev = l
    out, acc, length = [], 0, 0
    for b in bits:
        acc = (acc << 1) | (1 if b == "1" else 0); length += 1
        if (length, acc) in table:
            out.append(table[(length, acc)]); acc, length = 0, 0
    return "".join(out)

from collections import Counter
text = "abracadabra"
L = lengths(Counter(text))            # Task 6
table = canonical(L)                  # Task 6
bits = "".join(table[c] for c in text)
print(decode_canonical(L, bits) == text)   # True
```

#### Go / Java
```text
// Build canonical codes from lengths; map (length, value) -> symbol. Accumulate bits,
// shifting into an integer; when (length, value) matches, emit and reset. Mirror Python.
```

---

### Task 10 — Pack bits into bytes with a length header

**Problem.** Pack the encoded bit string into bytes, store the true bit count, then unpack and decode — proving padding is not misread.

**Constraints.** Arbitrary `|text|`.

**Hint.** Write the bit count first; on unpack, read exactly that many bits.

#### Python
```python
from collections import Counter

def pack(bits):
    n = len(bits)
    by = bytearray()
    for i in range(0, n, 8):
        chunk = bits[i:i + 8].ljust(8, "0")
        by.append(int(chunk, 2))
    return n, bytes(by)

def unpack(n, by):
    bits = "".join(format(b, "08b") for b in by)
    return bits[:n]

text = "abracadabra"
root = build(Counter(text)); table = codes(root)   # Task 2
bits = "".join(table[c] for c in text)
n, packed = pack(bits)
assert unpack(n, packed) == bits
print("packed bytes:", len(packed), "for", n, "bits")
```

#### Go / Java
```text
// Pack: for each 8-bit group, build a byte (pad last group with zeros); store bit count n.
// Unpack: expand bytes to bits, take the first n. Decode via the tree (Task 3).
// Verify the round trip survives byte packing.
```

---

## Advanced Tasks (5)

### Task 11 — Length-limited Huffman (package-merge)

**Problem.** Compute optimal code lengths with `max len ≤ L_max` using package-merge. Verify `max len ≤ L_max` and Kraft `≤ 1`, and that WPL is ≥ the unlimited Huffman WPL.

**Constraints.** `1 ≤ n ≤ 10⁴`, `⌈log₂ n⌉ ≤ L_max ≤ 32`.

**Hint.** Coins of dyadic width `2^(−d)`; at each level package adjacent pairs, merge with originals, keep cheapest; select `2(n−1)` cheapest.

#### Python
```python
def package_merge(freqs, limit):
    n = len(freqs)
    if n == 1:
        return [1]
    order = sorted(range(n), key=lambda i: freqs[i])
    orig = [(freqs[i], (i,)) for i in order]
    prev = list(orig)
    for _ in range(limit - 1):
        packaged = [(prev[i][0] + prev[i + 1][0], prev[i][1] + prev[i + 1][1])
                    for i in range(0, len(prev) - 1, 2)]
        prev = sorted(orig + packaged, key=lambda x: x[0])
    lengths = [0] * n
    for _, syms in prev[:2 * (n - 1)]:
        for s in syms:
            lengths[s] += 1
    return lengths

freqs = [20, 17, 6, 3, 2, 2]
L = package_merge(freqs, 4)
print("lengths:", L, "max:", max(L))
assert max(L) <= 4
assert sum(2 ** -l for l in L) <= 1 + 1e-9
```

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func packageMerge(freqs []int, limit int) []int {
	n := len(freqs)
	if n == 1 {
		return []int{1}
	}
	type item struct {
		w    int
		syms []int
	}
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return freqs[idx[a]] < freqs[idx[b]] })
	orig := make([]item, n)
	for i, id := range idx {
		orig[i] = item{freqs[id], []int{id}}
	}
	prev := append([]item(nil), orig...)
	for L := 0; L < limit-1; L++ {
		var pk []item
		for i := 0; i+1 < len(prev); i += 2 {
			s := append(append([]int{}, prev[i].syms...), prev[i+1].syms...)
			pk = append(pk, item{prev[i].w + prev[i+1].w, s})
		}
		merged := append(append([]item{}, orig...), pk...)
		sort.Slice(merged, func(a, b int) bool { return merged[a].w < merged[b].w })
		prev = merged
	}
	lengths := make([]int, n)
	for i := 0; i < 2*(n-1) && i < len(prev); i++ {
		for _, s := range prev[i].syms {
			lengths[s]++
		}
	}
	return lengths
}

func main() {
	L := packageMerge([]int{20, 17, 6, 3, 2, 2}, 4)
	mx := 0
	for _, l := range L {
		if l > mx {
			mx = l
		}
	}
	fmt.Println("lengths:", L, "max:", mx)
}
```

#### Java
```java
import java.util.*;
public class Task11 {
    static int[] packageMerge(int[] freqs, int limit) {
        int n = freqs.length;
        if (n == 1) return new int[]{1};
        Integer[] idx = new Integer[n];
        for (int i = 0; i < n; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> freqs[a] - freqs[b]);
        List<int[]> origW = new ArrayList<>(); List<List<Integer>> origS = new ArrayList<>();
        for (int id : idx) { origW.add(new int[]{freqs[id]}); origS.add(new ArrayList<>(List.of(id))); }
        List<int[]> pw = new ArrayList<>(origW); List<List<Integer>> ps = new ArrayList<>(origS);
        for (int L = 0; L < limit - 1; L++) {
            List<int[]> nw = new ArrayList<>(); List<List<Integer>> ns = new ArrayList<>();
            for (int i = 0; i + 1 < pw.size(); i += 2) {
                nw.add(new int[]{pw.get(i)[0] + pw.get(i + 1)[0]});
                List<Integer> s = new ArrayList<>(ps.get(i)); s.addAll(ps.get(i + 1)); ns.add(s);
            }
            List<Integer> order = new ArrayList<>();
            List<int[]> allW = new ArrayList<>(origW); allW.addAll(nw);
            List<List<Integer>> allS = new ArrayList<>(origS); allS.addAll(ns);
            for (int i = 0; i < allW.size(); i++) order.add(i);
            order.sort((a, b) -> allW.get(a)[0] - allW.get(b)[0]);
            pw = new ArrayList<>(); ps = new ArrayList<>();
            for (int i : order) { pw.add(allW.get(i)); ps.add(allS.get(i)); }
        }
        int[] lengths = new int[n];
        for (int i = 0; i < 2 * (n - 1) && i < ps.size(); i++)
            for (int s : ps.get(i)) lengths[s]++;
        return lengths;
    }
    public static void main(String[] args) {
        int[] L = packageMerge(new int[]{20, 17, 6, 3, 2, 2}, 4);
        System.out.println(Arrays.toString(L));
    }
}
```

---

### Task 12 — Adaptive (one-pass) Huffman skeleton

**Problem.** Implement a simplified adaptive scheme: maintain running counts, rebuild the static code after each symbol, and decode in lockstep. (Demonstrates the one-pass idea without the full FGK tree-rotation machinery.)

**Constraints.** `|text| ≤ 10⁴` (rebuild-per-symbol is `O(N·n log n)` — fine for the demo).

**Hint.** Both encoder and decoder must rebuild from the *same* counts *before* processing each next symbol, using a deterministic build.

#### Python
```python
from collections import Counter

def adaptive_roundtrip(text):
    # Encoder: build code from counts seen SO FAR (start uniform over alphabet).
    alphabet = sorted(set(text))
    counts = Counter({c: 1 for c in alphabet})   # +1 smoothing so all codes exist
    out_syms = []
    for ch in text:
        table = codes(build(counts))             # Task 2 build/codes
        out_syms.append((ch, table[ch]))
        counts[ch] += 1
    # Decoder mirrors: rebuild from identical evolving counts.
    counts2 = Counter({c: 1 for c in alphabet})
    decoded = []
    for ch, bits in out_syms:
        table = codes(build(counts2))
        rev = {v: k for k, v in table.items()}
        decoded.append(rev[bits])
        counts2[rev[bits]] += 1
    return "".join(decoded)

print(adaptive_roundtrip("abracadabra") == "abracadabra")   # True
```

#### Go / Java
```text
// Maintain a counts map starting at 1 per known symbol. Before each symbol, rebuild the
// Huffman code deterministically (Task 2), emit the codeword, then increment the count.
// Decoder rebuilds from the identical evolving counts and reverses the codeword.
```

---

### Task 13 — k-ary (ternary) Huffman

**Problem.** Build a ternary (`k = 3`) Huffman code: merge the 3 smallest each step, padding with zero-weight dummies until `(n − 1) mod (k − 1) == 0`.

**Constraints.** `1 ≤ n ≤ 10⁴`, `k = 3`.

**Hint.** Pad count: `pad = (k - 1 - (n - 1) % (k - 1)) % (k - 1)`. Codewords are over `{0,1,2}`.

#### Python
```python
import heapq
from collections import Counter
from itertools import count

def kary(freq, k=3):
    tie = count()
    items = [[freq[s], next(tie), s, []] for s in sorted(freq)]
    n = len(items)
    pad = (k - 1 - (n - 1) % (k - 1)) % (k - 1) if n > 1 else 0
    for _ in range(pad):
        items.append([0, next(tie), None, []])    # dummy leaf
    heapq.heapify(items)
    while len(items) > 1:
        kids = [heapq.heappop(items) for _ in range(k)]
        heapq.heappush(items, [sum(x[0] for x in kids), next(tie), None, kids])
    root = items[0]
    out = {}
    def walk(node, path):
        f, o, s, kids = node
        if s is not None:
            out[s] = path or "0"
        elif not kids:
            return
        else:
            for d, child in enumerate(kids):
                walk(child, path + str(d))
    walk(root, "")
    return out

table = kary(Counter("abracadabra"), 3)
for s in sorted(table):
    print(s, "->", table[s])
assert all(set(c) <= set("012") for c in table.values())
```

#### Go / Java
```text
// Pad with zero-weight dummies until (n-1) % (k-1) == 0. Heap by (freq, order). Each step
// pop k smallest, merge, push. Codewords use digits 0..k-1. Dummies get no real symbol.
```

---

### Task 14 — Build a fast decode lookup table

**Problem.** Build a single-level `2^MAX_BITS` lookup table mapping the next bits to `(symbol, length)`, and decode using it (advance the cursor by `length`).

**Constraints.** `MAX_BITS = max code length ≤ 16`.

**Hint.** For a canonical code of length `L` and value `v`, every table index whose top `L` bits equal `v` maps to that symbol.

#### Python
```python
from collections import Counter

def build_decode_table(L):
    codes_map = canonical(L)                    # Task 6
    max_bits = max(L.values())
    table = [None] * (1 << max_bits)
    for sym, code in codes_map.items():
        l = len(code)
        v = int(code, 2)
        # fill all indices whose top l bits == v
        low = v << (max_bits - l)
        high = low + (1 << (max_bits - l))
        for idx in range(low, high):
            table[idx] = (sym, l)
    return table, max_bits

def decode_with_table(L, bits):
    table, max_bits = build_decode_table(L)
    out, i = [], 0
    bits = bits + "0" * max_bits                # pad so the last read is safe
    while i < len(bits) - max_bits:
        window = int(bits[i:i + max_bits], 2)
        sym, l = table[window]
        out.append(sym)
        i += l
    return "".join(out)

text = "abracadabra"
L = lengths(Counter(text))                       # Task 6
table = canonical(L)
bits = "".join(table[c] for c in text)
print(decode_with_table(L, bits) == text)        # True
```

#### Go / Java
```text
// Build a 1<<maxBits table; for each canonical (sym, len, value), fill every index whose
// top `len` bits equal `value` with (sym, len). Decode: read maxBits, index, emit symbol,
// advance cursor by the stored length. This is the zlib/JPEG fast-decode trick.
```

---

### Task 15 — Compress a real file and report the ratio

**Problem.** Read a file's bytes, build a Huffman code over the 256 byte values, encode, pack into bytes (with a header of the code lengths + bit count), and report the compression ratio. Decode and verify byte-for-byte.

**Constraints.** Any file up to a few MB. Use a 256-entry frequency array.

**Hint.** Header = `256` lengths (1 byte each is fine for ≤255-bit, but use ≤32) + the bit count; payload = packed bits. Ratio = `compressed_size / original_size`.

#### Python
```python
from collections import Counter

def compress(data: bytes):
    if not data:
        return b"", {}, 0
    freq = Counter(data)
    L = lengths({bytes([b]): c for b, c in freq.items()})  # adapt keys as needed
    # Simpler: operate on ints directly
    freq_i = Counter(data)
    Li = lengths(freq_i)                       # Task 6 works on hashable keys
    table = canonical(Li)
    bits = "".join(table[b] for b in data)
    return bits, Li, len(bits)

def decompress(bits, Li, n):
    # decode_canonical from Task 9 (keys are ints)
    code, prev, dec = 0, 0, {}
    for s in sorted(Li, key=lambda x: (Li[x], x)):
        l = Li[s]; code <<= (l - prev); dec[(l, code)] = s; code += 1; prev = l
    out, acc, length = bytearray(), 0, 0
    for b in bits[:n]:
        acc = (acc << 1) | (1 if b == "1" else 0); length += 1
        if (length, acc) in dec:
            out.append(dec[(length, acc)]); acc, length = 0, 0
    return bytes(out)

data = b"abracadabra" * 1000
bits, Li, n = compress(data)
restored = decompress(bits, Li, n)
print("match:", restored == data, "ratio:", (n / 8) / len(data))
```

#### Go / Java
```text
// Use a 256-int frequency array. Build canonical lengths (Task 6/11). Encode to a bit buffer,
// pack to bytes with a header (lengths + bit count). Decode with a lookup table (Task 14) and
// assert byte-equality. Report (compressed_bytes / original_bytes).
```

---

## Benchmark Task — Tree-walk vs Table Decode

**Problem.** Decode a large encoded stream two ways: bit-by-bit tree walk and `2^MAX_BITS` lookup table. Time both; report the speedup.

**Expected findings.**
- The **tree walk** does one branch per bit — branch-heavy and cache-unfriendly.
- The **table decode** does one memory read per *symbol* and advances by the code length — typically an order of magnitude faster on real data.
- The table costs `O(2^MAX_BITS)` memory and a one-time build; it pays off across a long stream.

#### Python
```python
import time
from collections import Counter

def bench(text):
    root = build(Counter(text)); table = codes(root)     # Task 2
    bits = "".join(table[c] for c in text)
    Li = lengths(Counter(text))                          # Task 6

    t0 = time.perf_counter()
    out, node = [], root
    for b in bits:
        node = node[3] if b == "0" else node[4]
        if node[2] is not None: out.append(node[2]); node = root
    t_walk = time.perf_counter() - t0

    t0 = time.perf_counter()
    r = decode_with_table(Li, bits)                      # Task 14
    t_table = time.perf_counter() - t0
    print(f"walk={t_walk*1000:.1f}ms table={t_table*1000:.1f}ms speedup={t_walk/t_table:.1f}x")

bench("abracadabra" * 50000)
```

#### Go / Java
```text
// Encode a large string. Time (a) tree-walk decode and (b) table decode (Task 14).
// Go: time.Now()/time.Since. Java: System.nanoTime(). Report the speedup; expect the
// table decode to win by a large factor on long streams.
```

**Evaluation criteria.**
- Correctness: both decoders reproduce the input exactly.
- Performance: report wall-clock for each; explain why the table wins.
- Discussion: when is the table *not* worth it? (Tiny streams where the build cost dominates, or huge `MAX_BITS` forcing multi-level tables.)
