# Generic Data Structures — Find the Bug

## How to use

Each problem shows a code snippet from a generic data structure. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. What pattern does this teach?

Solutions are at the end. The bugs are realistic — many appear in real code reviews.

---

## Bug 1 — value receiver on a stack

```go
type Stack[T any] struct{ data []T }
func (s Stack[T]) Push(v T) { s.data = append(s.data, v) }

s := Stack[int]{}
s.Push(1); s.Push(2); s.Push(3)
fmt.Println(len(s.data)) // 0
```

**Hint:** Why is the stack empty after three pushes?

---

## Bug 2 — nil map in a set

```go
type Set[T comparable] struct{ m map[T]struct{} }
func (s *Set[T]) Add(v T) { s.m[v] = struct{}{} }

var s Set[int]
s.Add(5) // panic
```

**Hint:** What is the value of `s.m` at the start?

---

## Bug 3 — wrong constraint on Set

```go
type Set[T any] struct{ m map[T]struct{} } // ❌
```

**Hint:** Map keys.

---

## Bug 4 — leaking dead pointers in a queue

```go
type Queue[T any] struct{ data []T }
func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.data) == 0 { return zero, false }
    v := q.data[0]
    q.data = q.data[1:]
    return v, true
}
```

**Hint:** What if `T` is a pointer or contains pointers?

---

## Bug 5 — sharing the underlying slice

```go
type List[T any] struct{ data []T }
func (l List[T]) Slice() []T { return l.data }

l := List[int]{data: []int{1, 2, 3}}
s := l.Slice()
s[0] = 99
fmt.Println(l.data[0]) // 99 — surprise
```

**Hint:** What did `Slice` actually return?

---

## Bug 6 — missing comparable on a contains method

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Contains(v T) bool {
    for _, x := range s.data {
        if x == v { return true } // ❌
    }
    return false
}
```

**Hint:** What does the constraint allow you to do with T?

---

## Bug 7 — receiver missing [T]

```go
type Box[T any] struct{ v T }
func (b Box) Get() T { return b.v } // ❌
```

**Hint:** Receiver type parameter list.

---

## Bug 8 — method-level type parameters

```go
type List[T any] struct{ items []T }
func (l List[T]) Map[U any](f func(T) U) List[U] { // ❌
    out := List[U]{}
    for _, v := range l.items { out.items = append(out.items, f(v)) }
    return out
}
```

**Hint:** Methods cannot…

---

## Bug 9 — nil receiver on linked list

```go
type Node[T any] struct{ value T; next *Node[T] }
func (n *Node[T]) Length() int {
    count := 0
    for c := n; c != nil; c = c.next { count++ }
    return count
}

var n *Node[int]
fmt.Println(n.Length()) // 0 — works
n = &Node[int]{value: 1}
fmt.Println(n.Length()) // 1
```

This actually works. But:
```go
type List[T any] struct{ head *Node[T] }
func (l *List[T]) Length() int { return l.head.Length() }

var l *List[int]
l.Length() // panic
```

**Hint:** Why does the second case panic but not the first?

---

## Bug 10 — sharing a backing array between two stacks

```go
func Copy[T any](s *Stack[T]) *Stack[T] {
    return &Stack[T]{data: s.data}
}

a := &Stack[int]{}
a.Push(1); a.Push(2)
b := Copy(a)
b.Push(99)
fmt.Println(a.data) // surprising
```

**Hint:** What did `Copy` actually copy?

---

## Bug 11 — comparing T in a generic Heap

```go
type Heap[T any] struct{ data []T }
func (h *Heap[T]) Push(v T) {
    for _, x := range h.data {
        if x == v { return } // ❌
    }
    h.data = append(h.data, v)
}
```

**Hint:** Constraint mismatch.

---

## Bug 12 — using `len` on a generic T

```go
func First[T any](v T) T {
    if len(v) == 0 { // ❌
        var zero T
        return zero
    }
    return v
}
```

**Hint:** What does `T any` allow?

---

## Bug 13 — recursive type expansion

```go
type Bad[T any] struct {
    inner Bad[Bad[T]] // ❌
}
```

**Hint:** Infinite types.

---

## Bug 14 — wrong stack receiver pointer

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Pop() T {
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n] // panic on empty stack
    return v
}
```

**Hint:** Empty stack handling.

---

## Bug 15 — Pop returning a value, no zero handling

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Pop() T { // ❌
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v
}
```

**Hint:** Combine with Bug 14 — what is the right return signature?

---

## Bug 16 — incorrect Set.Remove leaks bucket memory

```go
type Set[T comparable] struct{ m map[T]struct{} }
func (s *Set[T]) Remove(v T) {
    s.m[v] = struct{}{} // ❌ inserts instead of removes
}
```

**Hint:** Which built-in operation actually removes a key?

---

## Bug 17 — pointer receiver returning value type

```go
type LinkedList[T any] struct{ head *listNode[T] }

func (l LinkedList[T]) Append(v T) LinkedList[T] {
    n := &listNode[T]{value: v}
    if l.head == nil { return LinkedList[T]{head: n} }
    c := l.head
    for c.next != nil { c = c.next }
    c.next = n
    return l
}

l := LinkedList[int]{}
l = l.Append(1)
l = l.Append(2)
fmt.Println(l.head.value, l.head.next.value)
```

This works but with a subtle inefficiency — what is it?

**Hint:** Compare with the `*LinkedList[T]` mutating-receiver style.

---

## Solutions

### Bug 1 — fix
Use a pointer receiver:
```go
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
```
Value receivers operate on a copy. Lesson: containers always use pointer receivers for mutation.

### Bug 2 — fix
Add a constructor:
```go
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
```
Or initialise the map manually: `s := Set[int]{m: map[int]struct{}{}}`.

### Bug 3 — fix
```go
type Set[T comparable] struct{ m map[T]struct{} }
```
Map keys must be comparable.

### Bug 4 — fix
Zero the slot before reslicing:
```go
v := q.data[0]
q.data[0] = zero
q.data = q.data[1:]
```
Without this, the underlying array still references the old element, blocking GC. Or use a ring buffer.

### Bug 5 — fix
Either return a copy:
```go
func (l List[T]) Slice() []T {
    out := make([]T, len(l.data))
    copy(out, l.data)
    return out
}
```
Or document that the returned slice shares storage with the list. Both are valid; choose one and stick to it.

### Bug 6 — fix
Tighten the constraint:
```go
type Stack[T comparable] struct{ data []T }
```
Or use the free-function pattern to avoid restricting the type:
```go
type Stack[T any] struct{ data []T }
func StackContains[T comparable](s *Stack[T], v T) bool { ... }
```

### Bug 7 — fix
```go
func (b Box[T]) Get() T { return b.v }
```
Methods on a generic type repeat the type parameter list.

### Bug 8 — fix
Methods cannot declare their own type parameters. Make `Map` a free function:
```go
func ListMap[T, U any](l List[T], f func(T) U) List[U] {
    out := List[U]{}
    for _, v := range l.items { out.items = append(out.items, f(v)) }
    return out
}
```

### Bug 9 — fix
```go
func (l *List[T]) Length() int {
    if l == nil || l.head == nil { return 0 }
    return l.head.Length()
}
```
The first case worked because the loop body never executed (the receiver was nil but only read for the loop condition). The second case dereferences `l.head` directly. Always guard against nil receivers in public methods of containers that are pointer-typed.

### Bug 10 — fix
Deep-copy:
```go
func Copy[T any](s *Stack[T]) *Stack[T] {
    out := &Stack[T]{data: make([]T, len(s.data))}
    copy(out.data, s.data)
    return out
}
```
Lesson: copying a struct copies its slice header, not the underlying array.

### Bug 11 — fix
Heaps usually rely on a `less` function, not equality. If you do need equality, tighten the constraint to `comparable`:
```go
type Heap[T comparable] struct{ ... }
```

### Bug 12 — fix
`T any` does not guarantee `len`. Either tighten the constraint to slice-shaped:
```go
func First[T ~[]E, E any](v T) E { ... }
```
…or change the function's purpose.

### Bug 13 — fix
Use a pointer to break the recursion:
```go
type Bad[T any] struct {
    inner *Bad[T]
}
```
`*Bad[T]` is a fixed-size pointer; `Bad[Bad[T]]` is an infinite type.

### Bug 14 — fix
Return `(T, bool)` and check length:
```go
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}
```

### Bug 15 — fix
Same as Bug 14: idiomatic Go uses `(T, bool)` for "may not exist" rather than panic.

### Bug 16 — fix
Use the `delete` built-in:
```go
func (s *Set[T]) Remove(v T) { delete(s.m, v) }
```

### Bug 17 — fix
The current code allocates a new `LinkedList[T]` header on every Append. For a small number of appends this is fine. For frequent mutation, switch to pointer receivers:
```go
func (l *LinkedList[T]) Append(v T) {
    n := &listNode[T]{value: v}
    if l.head == nil { l.head = n; return }
    c := l.head
    for c.next != nil { c = c.next }
    c.next = n
}
```
The traversal is still O(n); store a `tail` pointer to make it O(1).

---

## Lessons

Patterns from these bugs:

1. **Pointer receivers for mutation** (Bug 1, 17). Always.
2. **Initialise internal maps** with a constructor (Bug 2).
3. **Match constraint to operations** — `comparable` for `==`, `cmp.Ordered` for `<` (Bugs 3, 6, 11).
4. **Zero the slot** when removing pointer-shaped values from a slice (Bug 4).
5. **Returned slices share storage** unless you copy (Bug 5).
6. **Methods need `[T]` on the receiver** (Bug 7).
7. **Methods cannot declare their own type parameters** (Bug 8). Use free functions.
8. **Guard against nil receivers** when methods may be called on pointer-typed containers (Bug 9).
9. **Copying a struct copies the slice header**, not the data (Bug 10).
10. **`T any` is restrictive** — most operations require a constraint (Bug 12).
11. **Use pointers to break recursive types** (Bug 13).
12. **Empty containers return `(T, bool)`**, not panics (Bugs 14, 15).
13. **Use `delete` for map removal**, not assignment (Bug 16).

A senior engineer reads a generic data structure with these patterns in mind. Most bugs are not in the type parameter syntax — they are in the same old slice/map/pointer pitfalls Go has always had, now wrapped in a `[T]`.
