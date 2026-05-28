# Constant Time O(1) -- Specification

## Overview

This document catalogs O(1) operations available in the standard libraries of Go, Java,
and Python. For each operation, the guaranteed complexity is stated along with relevant
caveats (amortized, expected, worst-case).

---

## Table of Contents

1. [Go Standard Library O(1) Operations](#go-standard-library-o1-operations)
2. [Java Standard Library O(1) Operations](#java-standard-library-o1-operations)
3. [Python Standard Library O(1) Operations](#python-standard-library-o1-operations)
4. [Cross-Language Comparison](#cross-language-comparison)
5. [Official Documentation Links](#official-documentation-links)

---

## Go Standard Library O(1) Operations

### Arrays and Slices

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Access by index | `arr[i]` | O(1) worst case | Bounds-checked at runtime |
| Set by index | `arr[i] = v` | O(1) worst case | |
| Length | `len(arr)` | O(1) worst case | Stored as metadata |
| Capacity | `cap(s)` | O(1) worst case | Slices only |
| Append | `append(s, v)` | O(1) amortized | May trigger reallocation (growth factor ~2x) |
| Slice expression | `s[lo:hi]` | O(1) worst case | Creates new slice header, no data copy |

**Source:** Go Language Specification -- https://go.dev/ref/spec#Index_expressions

### Maps

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Lookup | `v, ok := m[k]` | O(1) expected | Average case; worst case O(n) with hash collisions |
| Insert/Update | `m[k] = v` | O(1) amortized expected | May trigger rehash |
| Delete | `delete(m, k)` | O(1) expected | |
| Length | `len(m)` | O(1) worst case | |

**Implementation details:** Go maps use hash tables with buckets of 8 key-value pairs.
Load factor threshold is approximately 6.5 elements per bucket. The hash function uses
AES instructions on supported hardware.

**Source:** Go runtime source -- https://github.com/golang/go/blob/master/src/runtime/map.go

### Channels

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Send (buffered, not full) | `ch <- v` | O(1) | Blocks if full |
| Receive (buffered, not empty) | `v := <-ch` | O(1) | Blocks if empty |
| Length | `len(ch)` | O(1) worst case | Number of elements queued |
| Capacity | `cap(ch)` | O(1) worst case | Buffer size |
| Close | `close(ch)` | O(1) | |

### sync Package

| Operation | Type | Complexity | Notes |
|-----------|------|-----------|-------|
| Lock | `sync.Mutex.Lock()` | O(1) | May block on contention |
| Unlock | `sync.Mutex.Unlock()` | O(1) | |
| Load | `atomic.LoadInt64()` | O(1) worst case | Hardware atomic |
| Store | `atomic.StoreInt64()` | O(1) worst case | Hardware atomic |
| Add | `atomic.AddInt64()` | O(1) worst case | Hardware atomic |
| CompareAndSwap | `atomic.CompareAndSwapInt64()` | O(1) worst case | Hardware CAS |

### container/list (Doubly-Linked List)

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Push front | `l.PushFront(v)` | O(1) worst case | |
| Push back | `l.PushBack(v)` | O(1) worst case | |
| Remove element | `l.Remove(e)` | O(1) worst case | Given element pointer |
| Move to front | `l.MoveToFront(e)` | O(1) worst case | |
| Move to back | `l.MoveToBack(e)` | O(1) worst case | |
| Length | `l.Len()` | O(1) worst case | |
| Front/Back | `l.Front()` / `l.Back()` | O(1) worst case | |

**Source:** https://pkg.go.dev/container/list

### container/heap

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Push | `heap.Push(h, v)` | O(log n) | NOT O(1) |
| Pop | `heap.Pop(h)` | O(log n) | NOT O(1) |
| Init | `heap.Init(h)` | O(n) | NOT O(1) |

**Note:** Heap operations are NOT O(1). Included here to prevent incorrect assumptions.

---

## Java Standard Library O(1) Operations

### Arrays

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Access | `arr[i]` | O(1) worst case | Bounds-checked |
| Set | `arr[i] = v` | O(1) worst case | |
| Length | `arr.length` | O(1) worst case | Field access |

### ArrayList

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Get | `list.get(i)` | O(1) worst case | Random access |
| Set | `list.set(i, v)` | O(1) worst case | |
| Add (at end) | `list.add(v)` | O(1) amortized | Growth factor 1.5x |
| Size | `list.size()` | O(1) worst case | |
| IsEmpty | `list.isEmpty()` | O(1) worst case | |
| Remove (at end) | `list.remove(list.size()-1)` | O(1) | |
| Remove (by index) | `list.remove(i)` | O(n) | NOT O(1) -- shifts elements |
| Contains | `list.contains(v)` | O(n) | NOT O(1) -- linear scan |

**Source:** Java SE Documentation -- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html

### HashMap

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Get | `map.get(k)` | O(1) expected | Worst case O(log n) with Java 8+ treeification |
| Put | `map.put(k, v)` | O(1) amortized expected | |
| Remove | `map.remove(k)` | O(1) expected | |
| ContainsKey | `map.containsKey(k)` | O(1) expected | |
| Size | `map.size()` | O(1) worst case | |

**Implementation details:**
- Default initial capacity: 16
- Default load factor: 0.75
- Growth factor: 2x
- Java 8+: Chains longer than 8 are converted to red-black trees (O(log n) worst case
  instead of O(n))

**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html

### HashSet

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Add | `set.add(v)` | O(1) expected | Backed by HashMap |
| Remove | `set.remove(v)` | O(1) expected | |
| Contains | `set.contains(v)` | O(1) expected | |
| Size | `set.size()` | O(1) worst case | |

### LinkedList

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| addFirst | `list.addFirst(v)` | O(1) worst case | |
| addLast | `list.addLast(v)` | O(1) worst case | |
| removeFirst | `list.removeFirst()` | O(1) worst case | |
| removeLast | `list.removeLast()` | O(1) worst case | Doubly-linked |
| getFirst | `list.getFirst()` | O(1) worst case | |
| getLast | `list.getLast()` | O(1) worst case | |
| Size | `list.size()` | O(1) worst case | |
| get(i) | `list.get(i)` | O(n) | NOT O(1) -- traversal needed |

### Stack / Deque (ArrayDeque)

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Push | `deque.push(v)` | O(1) amortized | |
| Pop | `deque.pop()` | O(1) | |
| Peek | `deque.peek()` | O(1) | |
| offerFirst | `deque.offerFirst(v)` | O(1) amortized | |
| offerLast | `deque.offerLast(v)` | O(1) amortized | |
| pollFirst | `deque.pollFirst()` | O(1) | |
| pollLast | `deque.pollLast()` | O(1) | |
| Size | `deque.size()` | O(1) worst case | |

**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayDeque.html

### Atomic Classes (java.util.concurrent.atomic)

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Get | `atomicInt.get()` | O(1) worst case | Volatile read |
| Set | `atomicInt.set(v)` | O(1) worst case | Volatile write |
| IncrementAndGet | `atomicInt.incrementAndGet()` | O(1) worst case | CAS loop |
| CompareAndSet | `atomicInt.compareAndSet(e, n)` | O(1) worst case | Hardware CAS |

---

## Python Standard Library O(1) Operations

### Lists

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Access | `lst[i]` | O(1) worst case | Including negative indices |
| Set | `lst[i] = v` | O(1) worst case | |
| Append | `lst.append(v)` | O(1) amortized | Growth factor ~1.125x |
| Pop (from end) | `lst.pop()` | O(1) | |
| Length | `len(lst)` | O(1) worst case | |
| Pop (from front) | `lst.pop(0)` | O(n) | NOT O(1) -- shifts elements |
| Insert | `lst.insert(i, v)` | O(n) | NOT O(1) -- shifts elements |
| Remove | `lst.remove(v)` | O(n) | NOT O(1) -- linear scan + shift |
| Contains | `v in lst` | O(n) | NOT O(1) -- linear scan |

**Source:** https://wiki.python.org/moin/TimeComplexity

### Dictionaries (dict)

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Lookup | `d[k]` | O(1) expected | |
| Set | `d[k] = v` | O(1) amortized expected | |
| Delete | `del d[k]` | O(1) expected | |
| Contains | `k in d` | O(1) expected | |
| Length | `len(d)` | O(1) worst case | |
| Get | `d.get(k, default)` | O(1) expected | |
| Setdefault | `d.setdefault(k, v)` | O(1) expected | |
| Pop | `d.pop(k)` | O(1) expected | |

**Implementation details:**
- Python 3.6+: Dicts maintain insertion order.
- Uses open addressing with pseudo-random probing.
- Load factor threshold: ~2/3.
- Growth factor: approximately 3x (for small dicts) to 2x (for large dicts).

**Source:** https://docs.python.org/3/library/stdtypes.html#dict

### Sets (set)

| Operation | Syntax | Complexity | Notes |
|-----------|--------|-----------|-------|
| Add | `s.add(v)` | O(1) expected | |
| Remove | `s.remove(v)` | O(1) expected | Raises KeyError if missing |
| Discard | `s.discard(v)` | O(1) expected | No error if missing |
| Contains | `v in s` | O(1) expected | |
| Pop | `s.pop()` | O(1) | Removes arbitrary element |
| Length | `len(s)` | O(1) worst case | |
| Union | `s | t` | O(len(s) + len(t)) | NOT O(1) |
| Intersection | `s & t` | O(min(len(s), len(t))) | NOT O(1) |

### collections.deque

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Append right | `d.append(v)` | O(1) worst case | |
| Append left | `d.appendleft(v)` | O(1) worst case | |
| Pop right | `d.pop()` | O(1) worst case | |
| Pop left | `d.popleft()` | O(1) worst case | |
| Access by index | `d[i]` | O(n) | NOT O(1) -- deque is not random-access |
| Length | `len(d)` | O(1) worst case | |

**Source:** https://docs.python.org/3/library/collections.html#collections.deque

### collections.defaultdict

Same complexity as `dict` for all operations. The only difference is automatic
initialization of missing keys.

### collections.Counter

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Increment | `c[k] += 1` | O(1) expected | Dict-based |
| Lookup count | `c[k]` | O(1) expected | Returns 0 for missing |
| Most common | `c.most_common(k)` | O(n log k) | NOT O(1) |

### collections.OrderedDict

| Operation | Method | Complexity | Notes |
|-----------|--------|-----------|-------|
| Lookup | `od[k]` | O(1) expected | |
| Set | `od[k] = v` | O(1) expected | |
| Delete | `del od[k]` | O(1) expected | |
| Move to end | `od.move_to_end(k)` | O(1) expected | |
| Pop item (LIFO/FIFO) | `od.popitem(last=True/False)` | O(1) | |

---

## Cross-Language Comparison

### Array/List Access by Index

| Language | Type | Syntax | Complexity |
|----------|------|--------|-----------|
| Go | slice | `s[i]` | O(1) worst case |
| Java | array | `arr[i]` | O(1) worst case |
| Java | ArrayList | `list.get(i)` | O(1) worst case |
| Python | list | `lst[i]` | O(1) worst case |

### Hash Table Lookup

| Language | Type | Syntax | Complexity |
|----------|------|--------|-----------|
| Go | map | `m[k]` | O(1) expected |
| Java | HashMap | `map.get(k)` | O(1) expected, O(log n) worst (treeified) |
| Python | dict | `d[k]` | O(1) expected |

### Append to Dynamic Array

| Language | Type | Syntax | Complexity | Growth Factor |
|----------|------|--------|-----------|---------------|
| Go | slice | `append(s, v)` | O(1) amortized | ~2x |
| Java | ArrayList | `list.add(v)` | O(1) amortized | 1.5x |
| Python | list | `lst.append(v)` | O(1) amortized | ~1.125x |

### Queue Operations (Add/Remove Both Ends)

| Language | Type | Add Front | Add Back | Remove Front | Remove Back |
|----------|------|-----------|----------|-------------|-------------|
| Go | container/list | O(1) | O(1) | O(1) | O(1) |
| Java | ArrayDeque | O(1)* | O(1)* | O(1) | O(1) |
| Python | collections.deque | O(1) | O(1) | O(1) | O(1) |

\* Amortized O(1) due to potential resizing.

---

## Official Documentation Links

### Go

- Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- container/list: https://pkg.go.dev/container/list
- sync/atomic: https://pkg.go.dev/sync/atomic

### Java

- Collections Framework: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/package-summary.html
- HashMap: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html
- ArrayList: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html
- ArrayDeque: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayDeque.html

### Python

- Time Complexity: https://wiki.python.org/moin/TimeComplexity
- Built-in Types: https://docs.python.org/3/library/stdtypes.html
- collections: https://docs.python.org/3/library/collections.html
- CPython source (dict): https://github.com/python/cpython/blob/main/Objects/dictobject.c
