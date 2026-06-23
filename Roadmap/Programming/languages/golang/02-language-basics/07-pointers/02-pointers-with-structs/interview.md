# Go Pointers with Structs — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: How do you allocate a struct on the heap and get a pointer to it?**

**Answer**:
```go
p := &Point{X: 1, Y: 2}  // composite literal + address
p := new(Point)           // zero-initialized
```

Both return `*Point`.

---

**Q2: What is auto-dereference?**

**Answer**: For pointer-to-struct, `p.field` automatically becomes `(*p).field`. You don't need explicit `*`:

```go
p := &Point{X: 1}
fmt.Println(p.X)   // auto: (*p).X
p.X = 99           // auto-write
```

---

**Q3: When should you use a pointer receiver?**

**Answer**: When the method:
- Mutates the receiver.
- Accepts a large struct (avoid copy).
- Should be consistent with other pointer-receiver methods on the type.

```go
func (c *Counter) Inc() { c.n++ } // mutates
```

---

**Q4: Why does this fail to compile?**
```go
type T struct{}
func (t *T) M() {}
type I interface{ M() }
var i I = T{}
```

**Answer**: `T` doesn't satisfy `I` because `M` has a pointer receiver — only `*T` has `M` in its method set.

Fix: `var i I = &T{}`.

---

## Middle Level Questions

**Q5: What's the difference between method sets of T and *T?**

**Answer**:
- `T` has methods declared with value receivers.
- `*T` has methods declared with both value AND pointer receivers.

So `*T` satisfies more interfaces than `T`.

---

**Q6: What does receiver consistency mean and why does it matter?**

**Answer**: All methods on a type should use the same receiver type (value or pointer).

If you mix:
```go
func (t T) A()  {}
func (t *T) B() {}
```

`T` has only `{A}`; `*T` has `{A, B}`. An interface `{A; B}` is satisfied by `*T` but not `T`. This causes confusing errors.

Pick one (usually pointer for types with state) and stick to it.

---

**Q7: How do you access a struct field through a pointer to the struct?**

**Answer**: `p.field` (auto-deref) or `(*p).field` (explicit). Both work.

To get a pointer to the field: `&p.field`.

---

**Q8: Why must self-referential struct fields be pointers?**

**Answer**: Without pointers, `Node{Value, Next Node}` would have infinite size (each Node contains another full Node). `*Node` is just an 8-byte address, breaking the recursion.

---

## Senior Level Questions

**Q9: How does Go decide whether `&T{}` allocates on stack or heap?**

**Answer**: Escape analysis:
- If the pointer doesn't escape (stays within the function): stack.
- If it escapes (returned, stored in global, captured by escaping closure): heap.

Verify: `go build -gcflags="-m"`. Look for "moved to heap".

---

**Q10: What's the cost of method dispatch for `*T` vs `T`?**

**Answer**:
- Direct call on `*T`: same as `*T_M(p)` — fast, often inlinable.
- Direct call on `T`: same speed.
- Through interface (either): vtable lookup + indirect call (~3-5 cycles), no inlining (without PGO).

For hot paths, prefer concrete types over interfaces.

---

**Q11: How does the GC handle pointer fields in heap structs?**

**Answer**: Each pointer field is a GC root. The GC follows it during marking.

Pointer-heavy structs add GC scan time. For high-throughput services, prefer value-typed fields when ownership is exclusive.

---

**Q12: Explain write barriers for pointer field mutations.**

**Answer**: When you mutate a pointer field in a heap struct:
```go
heapObj.field = newPtr
```

The compiler inserts a call to `runtime.gcWriteBarrier` to record the change for the GC's mark phase. Required for concurrent GC correctness.

Cost: ~2 cycles when GC inactive; more during marking.

---

## Scenario-Based Questions

**Q13: Your service stores `[]*Event` with 5M events. Each event has 8 pointer fields. GC pauses are too long. How do you fix?**

**Answer**:
1. Convert to `[]Event` (slice of values). Eliminates 5M pointers' worth of roots.
2. Within Event, replace pointer fields with value fields when you own the data exclusively.
3. Use `sync.Pool` for short-lived event allocations.
4. Profile after each change.

---

**Q14: A constructor `NewParser()` is called 50k times/sec, each allocating a 2 KB struct. How do you reduce GC pressure?**

**Answer**: `sync.Pool`:
```go
var pool = sync.Pool{New: func() any { return new(Parser) }}

func acquire() *Parser {
    p := pool.Get().(*Parser)
    return p
}

func release(p *Parser) {
    p.Reset()
    pool.Put(p)
}
```

Reduces allocation rate ~95% in steady state.

---

## FAQ

**When should I use `new(T)` vs `&T{}`?**

`&T{}` for initialized values; `new(T)` for purely zero-initialized. Both are equivalent for `&T{}` with no fields set.

---

**Why are map values not addressable?**

Map values may be moved during rehash. Stable addresses would prevent that. To mutate a struct in a map, store pointers (`map[K]*V`) or use the extract-mutate-restore pattern.

---

**Can I have a struct field of the same struct type?**

Not directly:
```go
type Node struct{ Next Node }   // ERROR: invalid recursive type
type Node struct{ Next *Node }  // OK
```

Pointers break the cycle.
