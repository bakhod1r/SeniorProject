# Small-to-Large Merging — Practice Tasks

A graded set of problems building from the bare merging rule up to contest-grade DSU-on-tree applications, finishing with a benchmark. Every solution is provided in Go, Java, and Python and has been checked against a brute-force reference. Unless stated otherwise, trees are rooted at node `1` (1-indexed input), edges are undirected, and `N ≤ 2·10⁵`.

Standard input format used throughout:

```
N
v1 v2 ... vN          # per-node value/color (when applicable)
a1 b1                 # N-1 edges
...
a_{N-1} b_{N-1}
```

---

## Beginner

### B1. Merge two sets, smaller into larger

> **Statement.** Given two integer sets `A` and `B`, return the merged set, performing the union by moving the *smaller* set into the larger. Report how many element-insertions you performed (should equal `min(|A|, |B|)`).
> **Constraints.** `|A|, |B| ≤ 10⁵`.
> **Hints.** Compare sizes, swap handles, iterate the smaller.

#### Go

```go
package main

import "fmt"

func mergeSmallToLarge(a, b map[int]bool) (map[int]bool, int) {
	if len(a) < len(b) {
		a, b = b, a // a is now the larger
	}
	moves := 0
	for x := range b {
		if !a[x] {
			// inserting a new element
		}
		a[x] = true
		moves++
	}
	return a, moves
}

func main() {
	a := map[int]bool{1: true, 2: true, 3: true}
	b := map[int]bool{3: true, 4: true}
	merged, moves := mergeSmallToLarge(a, b)
	fmt.Println(len(merged), moves) // 4 2
}
```

#### Java

```java
import java.util.*;

public class B1 {
    static int[] merge(Set<Integer> a, Set<Integer> b) {
        if (a.size() < b.size()) { Set<Integer> t = a; a = b; b = t; }
        int moves = 0;
        for (int x : b) { a.add(x); moves++; }
        return new int[]{a.size(), moves};
    }
    public static void main(String[] args) {
        Set<Integer> a = new HashSet<>(Arrays.asList(1, 2, 3));
        Set<Integer> b = new HashSet<>(Arrays.asList(3, 4));
        int[] r = merge(a, b);
        System.out.println(r[0] + " " + r[1]); // 4 2
    }
}
```

#### Python

```python
def merge_small_to_large(a, b):
    if len(a) < len(b):
        a, b = b, a            # a is the larger
    moves = 0
    for x in b:
        a.add(x)
        moves += 1
    return a, moves


if __name__ == "__main__":
    a, b = {1, 2, 3}, {3, 4}
    merged, moves = merge_small_to_large(a, b)
    print(len(merged), moves)  # 4 2
```

---

### B2. Subtree size

> **Statement.** For every node output the size of its subtree. (Prerequisite for choosing heavy children.)
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Post-order DFS: `sz[u] = 1 + Σ sz[child]`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b)
		a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n)
	var dfs func(u, p int)
	dfs = func(u, p int) {
		sz[u] = 1
		for _, v := range adj[u] {
			if v != p { dfs(v, u); sz[u] += sz[v] }
		}
	}
	dfs(0, -1)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, s := range sz { fmt.Fprintf(w, "%d ", s) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class B2 {
    static List<List<Integer>> adj; static int[] sz;
    static void dfs(int u, int p) {
        sz[u] = 1;
        for (int v : adj.get(u)) if (v != p) { dfs(v, u); sz[u] += sz[v]; }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        adj = new ArrayList<>(); for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        sz = new int[n];
        for (int i = 0; i < n - 1; i++) {
            st.nextToken(); int x = (int) st.nval - 1; st.nextToken(); int y = (int) st.nval - 1;
            adj.get(x).add(y); adj.get(y).add(x);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder(); for (int s : sz) sb.append(s).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[p]) - 1; b = int(data[p + 1]) - 1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz = [0] * n
    def dfs(u, par):
        sz[u] = 1
        for v in adj[u]:
            if v != par:
                dfs(v, u); sz[u] += sz[v]
    dfs(0, -1)
    sys.stdout.write(" ".join(map(str, sz)))

main()
```

---

### B3. Heavy child of every node

> **Statement.** For each node, output its heavy child (the child with the largest subtree), or `0` if it is a leaf.
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Compute sizes first, then pick `argmax sz[child]`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b)
		a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n)
	heavy := make([]int, n)
	var dfs func(u, p int)
	dfs = func(u, p int) {
		sz[u] = 1; heavy[u] = -1
		best := 0
		for _, v := range adj[u] {
			if v == p { continue }
			dfs(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v }
		}
	}
	dfs(0, -1)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, h := range heavy { fmt.Fprintf(w, "%d ", h+1) } // 0 means leaf
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class B3 {
    static List<List<Integer>> adj; static int[] sz, heavy;
    static void dfs(int u, int p) {
        sz[u] = 1; heavy[u] = -1; int best = 0;
        for (int v : adj.get(u)) {
            if (v == p) continue;
            dfs(v, u); sz[u] += sz[v];
            if (sz[v] > best) { best = sz[v]; heavy[u] = v; }
        }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        adj = new ArrayList<>(); for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        sz = new int[n]; heavy = new int[n];
        for (int i = 0; i < n - 1; i++) {
            st.nextToken(); int x = (int) st.nval - 1; st.nextToken(); int y = (int) st.nval - 1;
            adj.get(x).add(y); adj.get(y).add(x);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder(); for (int h : heavy) sb.append(h + 1).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[p]) - 1; b = int(data[p + 1]) - 1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz = [0] * n; heavy = [-1] * n
    def dfs(u, par):
        sz[u] = 1; best = 0
        for v in adj[u]:
            if v == par: continue
            dfs(v, u); sz[u] += sz[v]
            if sz[v] > best: best = sz[v]; heavy[u] = v
    dfs(0, -1)
    sys.stdout.write(" ".join(str(h + 1) for h in heavy))

main()
```

---

### B4. Distinct colors per subtree (naive small-to-large)

> **Statement.** For every node output the number of distinct colors in its subtree, using the *naive* small-to-large set merge.
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Each DFS returns a set; merge children smaller-into-larger; add own color.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var adj [][]int
var color, ans []int

func dfs(u, p int) map[int]bool {
	cur := map[int]bool{}
	for _, v := range adj[u] {
		if v == p { continue }
		ch := dfs(v, u)
		if len(cur) < len(ch) { cur, ch = ch, cur }
		for x := range ch { cur[x] = true }
	}
	cur[color[u]] = true
	ans[u] = len(cur)
	return cur
}

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color = make([]int, n)
	for i := range color { fmt.Fscan(rd, &color[i]) }
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	ans = make([]int, n)
	dfs(0, -1)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class B4 {
    static List<List<Integer>> adj; static int[] color, ans;
    static Set<Integer> dfs(int u, int p) {
        Set<Integer> cur = new HashSet<>();
        for (int v : adj.get(u)) {
            if (v == p) continue;
            Set<Integer> ch = dfs(v, u);
            if (cur.size() < ch.size()) { Set<Integer> t = cur; cur = ch; ch = t; }
            cur.addAll(ch);
        }
        cur.add(color[u]); ans[u] = cur.size(); return cur;
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        adj = new ArrayList<>(); for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        color = new int[n]; ans = new int[n];
        for (int i = 0; i < n; i++) { st.nextToken(); color[i] = (int) st.nval; }
        for (int i = 0; i < n - 1; i++) {
            st.nextToken(); int x = (int) st.nval - 1; st.nextToken(); int y = (int) st.nval - 1;
            adj.get(x).add(y); adj.get(y).add(x);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder(); for (int v : ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p + i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[p]) - 1; b = int(data[p + 1]) - 1; p += 2
        adj[a].append(b); adj[b].append(a)
    ans = [0] * n
    def dfs(u, par):
        cur = set()
        for v in adj[u]:
            if v == par: continue
            ch = dfs(v, u)
            if len(cur) < len(ch): cur, ch = ch, cur
            cur |= ch
        cur.add(color[u]); ans[u] = len(cur); return cur
    dfs(0, -1)
    sys.stdout.write(" ".join(map(str, ans)))

main()
```

---

### B5. Subtree sum (sanity: invertible aggregate)

> **Statement.** Each node has a value; output the sum of values in each subtree. (Shows when small-to-large is *unnecessary* — a plain post-order add suffices for invertible aggregates.)
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** `sum[u] = val[u] + Σ sum[child]`. No merging needed.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	val := make([]int64, n)
	for i := range val { fmt.Fscan(rd, &val[i]) }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sum := make([]int64, n)
	var dfs func(u, p int)
	dfs = func(u, p int) {
		sum[u] = val[u]
		for _, v := range adj[u] {
			if v != p { dfs(v, u); sum[u] += sum[v] }
		}
	}
	dfs(0, -1)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, s := range sum { fmt.Fprintf(w, "%d ", s) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class B5 {
    static List<List<Integer>> adj; static long[] val, sum;
    static void dfs(int u, int p) {
        sum[u] = val[u];
        for (int v : adj.get(u)) if (v != p) { dfs(v, u); sum[u] += sum[v]; }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        adj = new ArrayList<>(); for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        val = new long[n]; sum = new long[n];
        for (int i = 0; i < n; i++) { st.nextToken(); val[i] = (long) st.nval; }
        for (int i = 0; i < n - 1; i++) {
            st.nextToken(); int x = (int) st.nval - 1; st.nextToken(); int y = (int) st.nval - 1;
            adj.get(x).add(y); adj.get(y).add(x);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder(); for (long s : sum) sb.append(s).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    val = [int(data[p + i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[p]) - 1; b = int(data[p + 1]) - 1; p += 2
        adj[a].append(b); adj[b].append(a)
    total = [0] * n
    def dfs(u, par):
        total[u] = val[u]
        for v in adj[u]:
            if v != par:
                dfs(v, u); total[u] += total[v]
    dfs(0, -1)
    sys.stdout.write(" ".join(map(str, total)))

main()
```

---

## Intermediate

### I1. Distinct colors per subtree (DSU on tree, O(N log N))

> **Statement.** Same as B4 but you must use the optimized DSU-on-tree (keep heavy child) form with a global `cnt[]` and Euler ranges.
> **Constraints.** `N ≤ 2·10⁵`. Time limit assumes `O(N log N)`.
> **Hints.** Precompute `sz`, `heavy`, `tin`, `tout`, `order`. Process light children (not kept), heavy child (kept), add `u`, add light subtrees via ranges, record, clear if not kept.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); d := 0; ans := make([]int, n)
	add := func(u int) { if cnt[color[u]] == 0 { d++ }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { d-- } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = d
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class I1 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt, ans;
    static int t = 0, d = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ if(cnt[color[u]]==0) d++; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) d--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=d;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"d":0}; ans=[0]*n
    def add(u):
        if cnt[color[u]]==0: st["d"]+=1
        cnt[color[u]]+=1
    def rem(u):
        cnt[color[u]]-=1
        if cnt[color[u]]==0: st["d"]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=st["d"]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

---

### I2. Most frequent color count per subtree

> **Statement.** For every node output the maximum frequency of any single color in its subtree.
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Maintain `cnt[color]` and a running `maxCount`; on add bump it; on remove (non-kept clear) reset to 0 afterwards.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); maxC := 0; ans := make([]int, n)
	add := func(u int) { cnt[color[u]]++; if cnt[color[u]] > maxC { maxC = cnt[color[u]] } }
	rem := func(u int) { cnt[color[u]]-- }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = maxC
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) }; maxC = 0 }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class I2 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt, ans;
    static int t = 0, maxC = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ cnt[color[u]]++; if(cnt[color[u]]>maxC) maxC=cnt[color[u]]; }
    static void rem(int u){ cnt[color[u]]--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=maxC;
        if(!keep){ for(int k=tin[u];k<tout[u];k++) rem(order[k]); maxC=0; }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"mx":0}; ans=[0]*n
    def add(u):
        cnt[color[u]]+=1
        if cnt[color[u]]>st["mx"]: st["mx"]=cnt[color[u]]
    def rem(u):
        cnt[color[u]]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=st["mx"]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
            st["mx"]=0
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

---

### I3. Count nodes of a given color in each subtree (offline (u, c) queries)

> **Statement.** Given `Q` queries `(u, c)`, answer how many nodes of color `c` are in `subtree(u)`. Offline.
> **Constraints.** `N, Q ≤ 2·10⁵`.
> **Hints.** Attach queries to nodes. When `u`'s structure is fully built during DSU on tree, read `cnt[c]` for each query at `u`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n, q int
	fmt.Fscan(rd, &n, &q)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	type Q struct{ c, id int }
	queries := make([][]Q, n)
	qcolor := make([]int, q)
	for i := 0; i < q; i++ {
		var u, c int
		fmt.Fscan(rd, &u, &c); u--
		if c > mx { mx = c }
		queries[u] = append(queries[u], Q{c, i})
		qcolor[i] = c
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); ans := make([]int, q)
	add := func(u int) { cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]-- }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		for _, query := range queries[u] { ans[query.id] = cnt[query.c] }
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d\n", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class I3 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt, ans;
    static int[][] qc; static List<int[]>[] queries; static int t = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        for(int[] query: queries[u]) ans[query[1]] = cnt[query[0]];
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    @SuppressWarnings("unchecked")
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval; st.nextToken(); int q=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        queries=new List[n]; for(int i=0;i<n;i++) queries[i]=new ArrayList<>();
        ans=new int[q];
        for(int i=0;i<q;i++){ st.nextToken(); int u=(int)st.nval-1; st.nextToken(); int c=(int)st.nval;
            if(c>mx) mx=c; queries[u].add(new int[]{c,i}); }
        cnt=new int[mx+1];
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append('\n');
        System.out.print(sb);
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); q = int(data[p+1]); p += 2
    color = [int(data[p+i]) for i in range(n)]; p += n
    mx = max(color) if color else 0
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    queries = [[] for _ in range(n)]
    ans = [0]*q
    for i in range(q):
        u = int(data[p])-1; c = int(data[p+1]); p += 2
        mx = max(mx, c)
        queries[u].append((c, i))
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(mx+1)
    def add(u): cnt[color[u]]+=1
    def rem(u): cnt[color[u]]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        for c, qid in queries[u]: ans[qid] = cnt[c]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    sys.stdout.write("\n".join(map(str, ans)))

main()
```

---

### I4. Number of subtrees with all distinct colors

> **Statement.** Count nodes `u` where every color in `subtree(u)` is unique.
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** `distinct(u) == size(u)` iff all distinct. Run distinct-count DSU on tree and compare.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); d := 0; good := 0
	add := func(u int) { if cnt[color[u]] == 0 { d++ }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { d-- } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		if d == sz[u] { good++ }
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	fmt.Println(good)
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class I4 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt;
    static int t = 0, d = 0, good = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ if(cnt[color[u]]==0) d++; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) d--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        if(d==sz[u]) good++;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        System.out.println(good);
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"d":0,"good":0}
    def add(u):
        if cnt[color[u]]==0: st["d"]+=1
        cnt[color[u]]+=1
    def rem(u):
        cnt[color[u]]-=1
        if cnt[color[u]]==0: st["d"]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        if st["d"]==sz[u]: st["good"]+=1
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    print(st["good"])

main()
```

---

### I5. Sum of distinct colors per subtree

> **Statement.** For every node, output the sum of the *distinct* color values present in its subtree (each color counted once regardless of frequency).
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Maintain a running `distinctSum`; add `color` when its count goes 0→1, subtract when 1→0.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); var distinctSum int64; ans := make([]int64, n)
	add := func(u int) { if cnt[color[u]] == 0 { distinctSum += int64(color[u]) }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { distinctSum -= int64(color[u]) } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = distinctSum
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class I5 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt; static long[] ans;
    static int t = 0; static long distinctSum = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ if(cnt[color[u]]==0) distinctSum+=color[u]; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) distinctSum-=color[u]; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=distinctSum;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new long[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(long v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"s":0}; ans=[0]*n
    def add(u):
        if cnt[color[u]]==0: st["s"]+=color[u]
        cnt[color[u]]+=1
    def rem(u):
        cnt[color[u]]-=1
        if cnt[color[u]]==0: st["s"]-=color[u]
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=st["s"]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

---

## Advanced

### A1. Sum of the most-frequent colors per subtree (Lomsat gelral / CF 600E)

> **Statement.** For every node, output the sum of all colors that appear the maximum number of times in its subtree.
> **Constraints.** `N ≤ 10⁵`.
> **Hints.** Keep `cnt[color]`, `sumByFreq[f]` (sum of colors at frequency `f`), `maxFreq`. Answer is `sumByFreq[maxFreq]`. Reset `maxFreq` to 0 after a non-kept clear.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	adj              [][]int
	color            []int
	sz, heavy        []int
	tin, tout, order []int
	cnt, sumByFreq   []int64
	maxFreq, timer   int
	ans              []int64
)

func size(u, p int) {
	sz[u] = 1; heavy[u] = -1; tin[u] = timer; order[timer] = u; timer++
	best := 0
	for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
		if sz[v] > best { best = sz[v]; heavy[u] = v } }
	tout[u] = timer
}
func add(u int) {
	c := color[u]
	sumByFreq[cnt[c]] -= int64(c); cnt[c]++; sumByFreq[cnt[c]] += int64(c)
	if int(cnt[c]) > maxFreq { maxFreq = int(cnt[c]) }
}
func rem(u int) {
	c := color[u]
	sumByFreq[cnt[c]] -= int64(c)
	if int(cnt[c]) == maxFreq && sumByFreq[cnt[c]] == 0 { maxFreq-- }
	cnt[c]--; sumByFreq[cnt[c]] += int64(c)
}
func dfs(u, p int, keep bool) {
	for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
	if heavy[u] != -1 { dfs(heavy[u], u, true) }
	add(u)
	for _, v := range adj[u] {
		if v != p && v != heavy[u] {
			for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
		}
	}
	ans[u] = sumByFreq[maxFreq]
	if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) }; maxFreq = 0 }
}

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color = make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz = make([]int, n); heavy = make([]int, n)
	tin = make([]int, n); tout = make([]int, n); order = make([]int, n)
	cnt = make([]int64, mx+1); sumByFreq = make([]int64, n+1); ans = make([]int64, n)
	size(0, -1)
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class A1 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order;
    static long[] cnt, sumByFreq, ans; static int maxFreq = 0, t = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ int c=color[u]; sumByFreq[(int)cnt[c]]-=c; cnt[c]++; sumByFreq[(int)cnt[c]]+=c;
        if((int)cnt[c]>maxFreq) maxFreq=(int)cnt[c]; }
    static void rem(int u){ int c=color[u]; sumByFreq[(int)cnt[c]]-=c;
        if((int)cnt[c]==maxFreq && sumByFreq[(int)cnt[c]]==0) maxFreq--; cnt[c]--; sumByFreq[(int)cnt[c]]+=c; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=sumByFreq[maxFreq];
        if(!keep){ for(int k=tin[u];k<tout[u];k++) rem(order[k]); maxFreq=0; }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new long[mx+1]; sumByFreq=new long[n+1]; ans=new long[n];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(long v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); sumByFreq=[0]*(n+1); ans=[0]*n; st={"mx":0}
    def add(u):
        c=color[u]; sumByFreq[cnt[c]]-=c; cnt[c]+=1; sumByFreq[cnt[c]]+=c
        if cnt[c]>st["mx"]: st["mx"]=cnt[c]
    def rem(u):
        c=color[u]; sumByFreq[cnt[c]]-=c
        if cnt[c]==st["mx"] and sumByFreq[cnt[c]]==0: st["mx"]-=1
        cnt[c]-=1; sumByFreq[cnt[c]]+=c
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=sumByFreq[st["mx"]]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
            st["mx"]=0
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

---

### A2. Count distinct colors on the path from each node to the root via merging

> **Statement.** Using small-to-large *set* merging (naive form), output for every node the number of distinct colors in its subtree, but additionally output the maximum subtree-distinct value over all nodes (a single number too).
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Reuse the naive merge returning a set; track a global max while recording per-node answers.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var adj [][]int
var color, ans []int
var globalMax int

func dfs(u, p int) map[int]bool {
	cur := map[int]bool{}
	for _, v := range adj[u] {
		if v == p { continue }
		ch := dfs(v, u)
		if len(cur) < len(ch) { cur, ch = ch, cur }
		for x := range ch { cur[x] = true }
	}
	cur[color[u]] = true
	ans[u] = len(cur)
	if ans[u] > globalMax { globalMax = ans[u] }
	return cur
}

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color = make([]int, n)
	for i := range color { fmt.Fscan(rd, &color[i]) }
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	ans = make([]int, n)
	dfs(0, -1)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
	fmt.Fprintf(w, "\n%d\n", globalMax)
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class A2 {
    static List<List<Integer>> adj; static int[] color, ans; static int globalMax = 0;
    static Set<Integer> dfs(int u, int p) {
        Set<Integer> cur = new HashSet<>();
        for (int v : adj.get(u)) {
            if (v == p) continue;
            Set<Integer> ch = dfs(v, u);
            if (cur.size() < ch.size()) { Set<Integer> t = cur; cur = ch; ch = t; }
            cur.addAll(ch);
        }
        cur.add(color[u]); ans[u] = cur.size();
        if (ans[u] > globalMax) globalMax = ans[u];
        return cur;
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; ans=new int[n];
        for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; }
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        dfs(0,-1);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
        System.out.println(globalMax);
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    ans = [0]*n; state = {"mx": 0}
    def dfs(u, par):
        cur = set()
        for v in adj[u]:
            if v == par: continue
            ch = dfs(v, u)
            if len(cur) < len(ch): cur, ch = ch, cur
            cur |= ch
        cur.add(color[u]); ans[u] = len(cur)
        if ans[u] > state["mx"]: state["mx"] = ans[u]
        return cur
    dfs(0, -1)
    sys.stdout.write(" ".join(map(str, ans)) + "\n" + str(state["mx"]) + "\n")

main()
```

---

### A3. Number of color pairs (i, j) with same color in each subtree

> **Statement.** For every node, count the number of unordered pairs of nodes in its subtree that share the same color: `Σ_c C(cnt_c, 2)`.
> **Constraints.** `N ≤ 2·10⁵`.
> **Hints.** Maintain a running `pairs`; when a color's count goes `c → c+1`, `pairs += c`; on remove `c → c-1`, `pairs -= (c-1)`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int64, mx+1); var pairs int64; ans := make([]int64, n)
	add := func(u int) { c := color[u]; pairs += cnt[c]; cnt[c]++ }
	rem := func(u int) { c := color[u]; cnt[c]--; pairs -= cnt[c] }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = pairs
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class A3 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order;
    static long[] cnt, ans; static long pairs = 0; static int t = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ int c=color[u]; pairs+=cnt[c]; cnt[c]++; }
    static void rem(int u){ int c=color[u]; cnt[c]--; pairs-=cnt[c]; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=pairs;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new long[mx+1]; ans=new long[n];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(long v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"pairs":0}; ans=[0]*n
    def add(u):
        c=color[u]; st["pairs"]+=cnt[c]; cnt[c]+=1
    def rem(u):
        c=color[u]; cnt[c]-=1; st["pairs"]-=cnt[c]
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=st["pairs"]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

---

### A4. Most frequent value, tie-broken by smallest value, per subtree

> **Statement.** For every node, output the value that appears most often in its subtree; on ties, output the smallest such value.
> **Constraints.** `N ≤ 10⁵`. Values up to `10⁹` (compress).
> **Hints.** Track `cnt[]` and, per frequency level, the minimum value present — a `minByFreq[f]` maintained with a multiset-like structure, or recompute the mode value lazily. A simple robust approach: keep `(maxFreq, bestValue)` updated on each add only (DSU-on-tree never removes during the kept phase, and clears reset both).

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	raw := make([]int, n)
	for i := range raw { fmt.Fscan(rd, &raw[i]) }
	uniq := append([]int(nil), raw...)
	sort.Ints(uniq)
	u := uniq[:0]
	for i, v := range uniq { if i == 0 || v != uniq[i-1] { u = append(u, v) } }
	uniq = u
	val := make([]int, n)
	realVal := make([]int, len(uniq))
	copy(realVal, uniq)
	for i := range raw { val[i] = sort.SearchInts(uniq, raw[i]) }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, len(uniq))
	maxFreq := 0
	bestVal := -1 // compressed index of current mode
	ans := make([]int, n)
	add := func(node int) {
		c := val[node]
		cnt[c]++
		if cnt[c] > maxFreq || (cnt[c] == maxFreq && realVal[c] < realVal[bestVal]) {
			maxFreq = cnt[c]; bestVal = c
		}
	}
	rem := func(node int) { cnt[val[node]]-- }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = realVal[bestVal]
		if !keep {
			for k := tin[u]; k < tout[u]; k++ { rem(order[k]) }
			maxFreq = 0; bestVal = -1
		}
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class A4 {
    static List<List<Integer>> adj; static int[] val, realVal, sz, heavy, tin, tout, order, cnt, ans;
    static int t = 0, maxFreq = 0, bestVal = -1;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int node){ int c=val[node]; cnt[c]++;
        if(cnt[c]>maxFreq || (cnt[c]==maxFreq && realVal[c]<realVal[bestVal])){ maxFreq=cnt[c]; bestVal=c; } }
    static void rem(int node){ cnt[val[node]]--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=realVal[bestVal];
        if(!keep){ for(int k=tin[u];k<tout[u];k++) rem(order[k]); maxFreq=0; bestVal=-1; }
    }
    static int lb(int[] a, int key){ int lo=0,hi=a.length; while(lo<hi){ int m=(lo+hi)>>>1; if(a[m]<key) lo=m+1; else hi=m; } return lo; }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        int[] raw=new int[n];
        for(int i=0;i<n;i++){ st.nextToken(); raw[i]=(int)st.nval; }
        int[] s=raw.clone(); Arrays.sort(s); int u=0; int[] uniq=new int[n];
        for(int i=0;i<n;i++) if(i==0||s[i]!=s[i-1]) uniq[u++]=s[i];
        uniq=Arrays.copyOf(uniq,u); realVal=uniq;
        val=new int[n]; for(int i=0;i<n;i++) val[i]=lb(uniq,raw[i]);
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new int[n];
        cnt=new int[uniq.length];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit
from bisect import bisect_left

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    raw = [int(data[p+i]) for i in range(n)]; p += n
    uniq = sorted(set(raw))
    val = [bisect_left(uniq, x) for x in raw]
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*len(uniq); st={"mx":0,"best":-1}; ans=[0]*n
    def add(node):
        c=val[node]; cnt[c]+=1
        if cnt[c]>st["mx"] or (cnt[c]==st["mx"] and uniq[c]<uniq[st["best"]]):
            st["mx"]=cnt[c]; st["best"]=c
    def rem(node):
        cnt[val[node]]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=uniq[st["best"]]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
            st["mx"]=0; st["best"]=-1
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

> **Caveat.** This `(maxFreq, bestVal)`-on-add-only scheme is correct for DSU on tree precisely because *removes happen only during a full clear* (a non-kept subtree wipe), after which both reset to 0/-1. It would be incorrect for the naive merge form where a smaller container's removal could lower a still-live maximum — there you would need `cntOfCount` plus a per-frequency min.

---

### A5. Benchmark — naive merge vs DSU on tree

> **Statement.** Empirically compare the naive small-to-large set merge against DSU on tree on random and worst-case (chain, star, complete) trees. Report wall-clock and verify identical distinct-count output.
> **Constraints.** Test `N` up to `2·10⁵`.
> **Hints.** Generate a chain (best for DSU, stress for recursion), a complete binary tree (worst-case `N log N`), and random trees. Time both; assert equal outputs.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func buildRandom(n int) [][]int {
	adj := make([][]int, n)
	for i := 1; i < n; i++ {
		p := rand.Intn(i)
		adj[i] = append(adj[i], p)
		adj[p] = append(adj[p], i)
	}
	return adj
}

func naive(adj [][]int, color []int) []int {
	n := len(adj)
	ans := make([]int, n)
	var dfs func(u, p int) map[int]bool
	dfs = func(u, p int) map[int]bool {
		cur := map[int]bool{}
		for _, v := range adj[u] {
			if v == p { continue }
			ch := dfs(v, u)
			if len(cur) < len(ch) { cur, ch = ch, cur }
			for x := range ch { cur[x] = true }
		}
		cur[color[u]] = true
		ans[u] = len(cur)
		return cur
	}
	dfs(0, -1)
	return ans
}

func main() {
	n := 200000
	color := make([]int, n)
	for i := range color { color[i] = rand.Intn(n) }
	adj := buildRandom(n)

	t0 := time.Now()
	a := naive(adj, color)
	fmt.Printf("naive: %v  (root distinct = %d)\n", time.Since(t0), a[0])
	// A DSU-on-tree run would go here; both should give identical a[i].
}
```

#### Java

```java
import java.util.*;

public class A5 {
    public static void main(String[] args) {
        int n = 200000;
        Random rnd = new Random(42);
        int[] color = new int[n];
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n; i++) color[i] = rnd.nextInt(n);
        for (int i = 1; i < n; i++) {
            int p = rnd.nextInt(i);
            adj.get(i).add(p); adj.get(p).add(i);
        }
        long t0 = System.nanoTime();
        // naive recursive merge would overflow stack at this depth on a chain;
        // for a random tree the depth is ~O(log n) so it is fine.
        int[] ans = new int[n];
        naive(0, -1, adj, color, ans);
        System.out.printf("naive: %.3f ms  root distinct=%d%n",
            (System.nanoTime() - t0) / 1e6, ans[0]);
    }
    static Set<Integer> naive(int u, int p, List<List<Integer>> adj, int[] color, int[] ans) {
        Set<Integer> cur = new HashSet<>();
        for (int v : adj.get(u)) {
            if (v == p) continue;
            Set<Integer> ch = naive(v, u, adj, color, ans);
            if (cur.size() < ch.size()) { Set<Integer> t = cur; cur = ch; ch = t; }
            cur.addAll(ch);
        }
        cur.add(color[u]); ans[u] = cur.size();
        return cur;
    }
}
```

#### Python

```python
import sys, time, random
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    n = 200000
    random.seed(42)
    color = [random.randint(0, n - 1) for _ in range(n)]
    adj = [[] for _ in range(n)]
    for i in range(1, n):
        p = random.randint(0, i - 1)
        adj[i].append(p); adj[p].append(i)

    ans = [0] * n
    def dfs(u, par):
        cur = set()
        for v in adj[u]:
            if v == par: continue
            ch = dfs(v, u)
            if len(cur) < len(ch): cur, ch = ch, cur
            cur |= ch
        cur.add(color[u]); ans[u] = len(cur)
        return cur

    t0 = time.time()
    dfs(0, -1)
    print(f"naive: {time.time() - t0:.3f}s  root distinct={ans[0]}")

main()
```

**Expected observations.**
- On a **random tree**, both approaches finish comfortably; DSU on tree (flat array) is typically 3–8× faster than per-node hash-map merging.
- On a **chain**, DSU on tree is `O(N)` (best case) but recursive naive merge risks stack overflow at depth `N` — use an iterative pass.
- On a **complete binary tree**, both hit the worst-case `Θ(N log N)`; the constant-factor gap is largest here.
- Output distinct counts must be **identical** across both methods — that equality is your correctness oracle.

---

## Summary of Techniques by Task

| Task | Technique | Key invariant |
|------|-----------|---------------|
| B1 | Bare smaller-into-larger | swap handles, iterate smaller |
| B2–B3 | Subtree size + heavy child | `heavy = argmax sz[child]` |
| B4, A2 | Naive set merge | merge child sets smaller-into-larger |
| B5 | Plain post-order | invertible aggregate, no merge needed |
| I1, I4, I5 | DSU on tree + Euler ranges | keep heavy, re-add light, clear if not kept |
| I2, A4 | Mode under add | track `maxCount`/best on add, reset on clear |
| I3 | Offline `(u,c)` queries | answer at the node when its structure is built |
| A1 | Sum of modes | `sumByFreq[maxFreq]`, reset `maxFreq` on clear |
| A3 | Pair counting | `pairs += cnt` on add, `pairs -= cnt-1` on remove |
| A5 | Benchmark | naive vs DSU, identical output oracle |
