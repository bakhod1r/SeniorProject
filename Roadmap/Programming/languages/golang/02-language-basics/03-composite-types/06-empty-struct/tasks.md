# Go Empty Struct — Tasks

## Instructions

Each task below is a graded exercise. Solve it from scratch first; consult the hint only after you have an attempt; reveal the solution only after you have written and run your own. Each task ends with a self-check question — answer it out loud or in writing before moving on.

Difficulty bands:

- **Easy** — direct application of `struct{}` / `chan struct{}`
- **Medium** — encapsulation, generics, concurrency
- **Hard** — internals, layout, pointer identity
- **Extra-hard** — small system / library design

All exercises are tailored to the empty-struct topic and expect Go 1.22 or newer.

---

## Task 1 (Easy) — Set Conversion And Memory Comparison

**Statement**: You inherit a function that maintains a set of seen IDs as `map[string]bool`. Convert it to `map[string]struct{}`. Then write a small benchmark that inserts one million keys into each variant and reports `runtime.MemStats.HeapAlloc` after each insert phase. Print the difference.

**Constraints**:
- Insert exactly 1,000,000 distinct keys (`fmt.Sprintf("k-%d", i)`).
- Force a GC and read `MemStats` between the two phases.
- Do not import any package outside the standard library.

<details><summary>Hint</summary>

The two maps differ only in the value type. Wrap each phase in its own function so the previous map is collectable. After each phase: `runtime.GC(); runtime.ReadMemStats(&m)`.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"runtime"
)

func fillBool(n int) uint64 {
	m := make(map[string]bool, n)
	for i := 0; i < n; i++ {
		m[fmt.Sprintf("k-%d", i)] = true
	}
	var ms runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms)
	_ = m // keep alive
	return ms.HeapAlloc
}

func fillStruct(n int) uint64 {
	m := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		m[fmt.Sprintf("k-%d", i)] = struct{}{}
	}
	var ms runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms)
	_ = m
	return ms.HeapAlloc
}

func main() {
	const n = 1_000_000
	a := fillBool(n)
	b := fillStruct(n)
	fmt.Printf("bool:   %d bytes\nstruct: %d bytes\nsaved:  %d bytes\n", a, b, int64(a)-int64(b))
}
```

The struct{} variant saves ~1 byte per entry plus alignment-driven savings inside Go's map bucket layout. Real-world savings run roughly 8–16 MB at one million entries, depending on bucket utilization.

</details>

**Self-check**: Why does `map[string]struct{}` save more than just `1,000,000` bytes? (Hint: Go's map buckets group eight key/value pairs and the value array is padded to its element size.)

---

## Task 2 (Easy) — Stop Signal With `chan struct{}`

**Statement**: Write a function `runWorker(stop <-chan struct{})` that loops printing `"tick"` once a second. When the caller closes `stop`, the worker must exit cleanly within at most one second. In `main`, spawn the worker, sleep 3 seconds, then close the channel and wait for the worker via a `sync.WaitGroup`.

**Constraints**:
- The worker must never receive more than one value before checking the stop channel.
- Use `select` over `time.After` (or `time.NewTicker`) and `stop`.
- Worker must terminate the goroutine; `main` must not exit until the worker has returned.

<details><summary>Hint</summary>

Inside the worker, `select { case <-stop: return; case <-ticker.C: ... }`. Receiving from a closed channel is the canonical "broadcast cancel" — every consumer sees it without the producer needing to send anything.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func runWorker(stop <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			fmt.Println("worker exiting")
			return
		case <-t.C:
			fmt.Println("tick")
		}
	}
}

func main() {
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go runWorker(stop, &wg)
	time.Sleep(3 * time.Second)
	close(stop)
	wg.Wait()
}
```

</details>

**Self-check**: Why is `close(stop)` the correct primitive instead of `stop <- struct{}{}`?

---

## Task 3 (Easy) — Trailing Zero-Size Field Sizeof

**Statement**: Define three structs and print `unsafe.Sizeof` for each. Explain what you observe.

```go
type A struct {
    x int64
}
type B struct {
    x int64
    _ struct{} // trailing zero-size
}
type C struct {
    _ struct{} // leading zero-size
    x int64
}
```

**Constraints**:
- Use `unsafe.Sizeof` and `unsafe.Alignof` from the `unsafe` package.
- Print results on a 64-bit platform (assume `amd64` or `arm64`).
- Do not modify the field declarations.

<details><summary>Hint</summary>

The Go specification permits two distinct zero-size variables to share an address — but the address must remain inside the containing struct. A trailing zero-size field whose natural address is past the end of the struct forces the compiler to add padding so the address stays in bounds. Leading or middle placement does not.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"unsafe"
)

type A struct {
	x int64
}
type B struct {
	x int64
	_ struct{}
}
type C struct {
	_ struct{}
	x int64
}

func main() {
	fmt.Println(unsafe.Sizeof(A{})) // 8
	fmt.Println(unsafe.Sizeof(B{})) // 16  trailing zero-size grows the struct
	fmt.Println(unsafe.Sizeof(C{})) // 8   leading is free
}
```

The cost of a trailing zero-size field is one full word of padding (8 bytes on 64-bit). The fix: place sentinel fields at the start, or drop them entirely and use a method-only zero-size type elsewhere.

</details>

**Self-check**: Where in your codebase have you used a trailing `_ struct{}` to "force named-only initialization"? Did you measure the layout cost?

---

## Task 4 (Medium) — Generic Thread-Safe `Set[T]`

**Statement**: Implement `Set[T comparable]` backed by `map[T]struct{}` with the methods `Add(v T)`, `Remove(v T)`, `Contains(v T) bool`, `Len() int`, and `ForEach(fn func(T))`. The set must be safe for concurrent use.

**Constraints**:
- Use `sync.RWMutex`. Read-heavy methods (`Contains`, `Len`, `ForEach`) take the read lock; write methods take the write lock.
- The element type is constrained to `comparable`.
- `ForEach` must not hold the lock while invoking `fn` if `fn` re-enters the set (document the constraint or copy keys first).
- Provide a constructor `NewSet[T comparable]() *Set[T]`.

<details><summary>Hint</summary>

Wrap the map and a `sync.RWMutex` in a struct. For `ForEach`, snapshot the keys under the read lock into a slice, release the lock, then iterate the slice — this avoids holding the lock during user callbacks.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
)

type Set[T comparable] struct {
	mu sync.RWMutex
	m  map[T]struct{}
}

func NewSet[T comparable]() *Set[T] {
	return &Set[T]{m: make(map[T]struct{})}
}

func (s *Set[T]) Add(v T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[v] = struct{}{}
}

func (s *Set[T]) Remove(v T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, v)
}

func (s *Set[T]) Contains(v T) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.m[v]
	return ok
}

func (s *Set[T]) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.m)
}

func (s *Set[T]) ForEach(fn func(T)) {
	s.mu.RLock()
	keys := make([]T, 0, len(s.m))
	for k := range s.m {
		keys = append(keys, k)
	}
	s.mu.RUnlock()
	for _, k := range keys {
		fn(k)
	}
}

func main() {
	s := NewSet[string]()
	s.Add("a")
	s.Add("b")
	s.Add("a")
	fmt.Println(s.Len())          // 2
	fmt.Println(s.Contains("a"))  // true
	s.Remove("a")
	fmt.Println(s.Contains("a"))  // false
	s.ForEach(func(v string) { fmt.Println(v) })
}
```

</details>

**Self-check**: Why is the map value type `struct{}` here and not `bool`? Would the API change if it were `bool`?

---

## Task 5 (Medium) — Close-Broadcast To Many Workers

**Statement**: Build a fan-out cancellation primitive. Spawn `N=8` workers, each in its own goroutine, each printing its index every 100 ms. After 500 ms, close a single `chan struct{}` to cancel all of them at once. Use a `sync.WaitGroup` so `main` waits for all workers.

**Constraints**:
- One channel cancels all workers — the sender does not loop sending values.
- Workers must check the cancel channel each iteration.
- Total runtime is between 500 ms and 700 ms.

<details><summary>Hint</summary>

A receive on a closed channel always returns the zero value immediately. So `<-cancel` in a `select` triggers for every goroutine the moment `close(cancel)` runs.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func worker(id int, cancel <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-cancel:
			fmt.Printf("worker %d done\n", id)
			return
		case <-t.C:
			fmt.Printf("worker %d tick\n", id)
		}
	}
}

func main() {
	cancel := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go worker(i, cancel, &wg)
	}
	time.Sleep(500 * time.Millisecond)
	close(cancel) // one operation, eight wakeups
	wg.Wait()
}
```

</details>

**Self-check**: How would you change the design if you wanted to cancel only every other worker? (Spoiler: you would not use a single shared channel.)

---

## Task 6 (Medium) — Method-Only Type Using Empty Struct

**Statement**: Define a type `Logger` that has no state but provides three methods: `Info(msg string)`, `Warn(msg string)`, `Error(msg string)`. Implement them so they print with a prefix like `"[INFO] ..."`. Construct `Logger` as `Logger{}` and confirm with `unsafe.Sizeof` that it occupies zero bytes.

**Constraints**:
- The type itself must have zero size.
- All three methods are pointer-free value methods (`func (Logger) ...`).
- Provide a `package-level` global `var Log Logger` so callers can use it without constructing.

<details><summary>Hint</summary>

`type Logger struct{}` is the standard recipe. Methods are defined on `Logger` (not `*Logger`) because there is nothing to mutate. `unsafe.Sizeof(Logger{}) == 0`.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"unsafe"
)

type Logger struct{}

func (Logger) Info(msg string)  { fmt.Println("[INFO]", msg) }
func (Logger) Warn(msg string)  { fmt.Println("[WARN]", msg) }
func (Logger) Error(msg string) { fmt.Println("[ERROR]", msg) }

var Log Logger

func main() {
	fmt.Println(unsafe.Sizeof(Log)) // 0
	Log.Info("started")
	Log.Warn("low disk")
	Log.Error("failed")
}
```

A method-only zero-size type costs nothing per instance and embeds cleanly into other structs without enlarging them (provided it is not the only field, and it is not placed at the end).

</details>

**Self-check**: When would you reach for a method-only zero-size type instead of a free function?

---

## Task 7 (Medium) — Permission Set Memory Comparison

**Statement**: Model up to 32 distinct permissions per user. Compare three representations of "the set of permissions a user has":

1. `map[Permission]struct{}` (set with empty-struct value)
2. `[]bool` of length 32 (bitmap-as-slice)
3. `uint32` bitmap

For each, build a `User` containing the representation, populate it with 5 random permissions, allocate 100,000 users, and report `runtime.MemStats.HeapAlloc` after each phase.

**Constraints**:
- `Permission` is `type Permission int` with values 0..31.
- Bitmap operations must use bitwise AND/OR/SHIFT.
- Provide `Has(p Permission) bool` for each representation.

<details><summary>Hint</summary>

Build three `User` types in three sub-functions. Force GC between phases. The `uint32` bitmap will dominate by an order of magnitude — but the map is the clearest API. Decide tradeoffs deliberately.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"math/rand"
	"runtime"
)

type Permission int

const NumPerms = 32

type UserMap struct{ Perms map[Permission]struct{} }
type UserSlice struct{ Perms []bool }
type UserBits struct{ Perms uint32 }

func (u UserMap) Has(p Permission) bool   { _, ok := u.Perms[p]; return ok }
func (u UserSlice) Has(p Permission) bool { return u.Perms[p] }
func (u UserBits) Has(p Permission) bool  { return u.Perms&(1<<p) != 0 }

func memAfter(label string, build func()) {
	build()
	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	fmt.Printf("%-10s %d bytes\n", label, m.HeapAlloc)
}

func main() {
	const N = 100_000
	rng := rand.New(rand.NewSource(1))

	var keep any
	memAfter("map", func() {
		us := make([]UserMap, N)
		for i := range us {
			us[i].Perms = make(map[Permission]struct{}, 5)
			for j := 0; j < 5; j++ {
				us[i].Perms[Permission(rng.Intn(NumPerms))] = struct{}{}
			}
		}
		keep = us
	})
	memAfter("slice", func() {
		us := make([]UserSlice, N)
		for i := range us {
			us[i].Perms = make([]bool, NumPerms)
			for j := 0; j < 5; j++ {
				us[i].Perms[rng.Intn(NumPerms)] = true
			}
		}
		keep = us
	})
	memAfter("bits", func() {
		us := make([]UserBits, N)
		for i := range us {
			for j := 0; j < 5; j++ {
				us[i].Perms |= 1 << rng.Intn(NumPerms)
			}
		}
		keep = us
	})
	_ = keep
}
```

The bits version wins on memory by orders of magnitude (4 bytes per user vs ~hundreds for the map). The map version wins on readability and on flexibility when the permission set is unbounded. Pick by domain, not by reflex.

</details>

**Self-check**: At what size does the map version's metadata cost dominate? Where is the crossover with bits?

---

## Task 8 (Hard) — Pointer Identity Of `&struct{}{}`

**Statement**: Write a test (or `main` with assertions) that demonstrates the runtime collapsing distinct `&struct{}{}` allocations to the same address. Use `unsafe.Pointer` to print the addresses; assert equality. Then define a type `type marker struct{}` and show the same behavior for `&marker{}`.

**Constraints**:
- Use the standard library only.
- The assertion must reflect actual runtime behavior (use `t.Fatalf` if writing as a test).
- Add a comment citing the Go specification clause.

<details><summary>Hint</summary>

The Go spec says: "Two distinct zero-size variables may have the same address in memory." The runtime exploits this with `runtime.zerobase`. So `&struct{}{} == &struct{}{}` is observably `true` on every supported runtime (though spec-allowed to be false).

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"unsafe"
)

type marker struct{}

func main() {
	// Spec: "Two distinct zero-size variables may have the same address in memory."
	a := &struct{}{}
	b := &struct{}{}
	fmt.Printf("a=%p b=%p eq=%v\n", a, b, a == b)
	if a != b {
		panic("expected same zerobase address for distinct &struct{}{}")
	}

	c := &marker{}
	d := &marker{}
	fmt.Printf("c=%p d=%p eq=%v\n", c, d, unsafe.Pointer(c) == unsafe.Pointer(d))
	if unsafe.Pointer(c) != unsafe.Pointer(d) {
		panic("expected same zerobase address for distinct &marker{}")
	}
	fmt.Println("ok — runtime.zerobase collapse confirmed")
}
```

Implication: never use a pointer to a zero-size type as a map key or identity token. Every allocation produces the same address.

</details>

**Self-check**: Why does this NOT break `map[*int]struct{}` lookups when the keys are pointers to non-zero-size types?

---

## Task 9 (Hard) — Method-Only Set With Hidden State

**Statement**: Implement a `StringSet` type whose API is method-only: `Add`, `Contains`, `Remove`, `Len`, `Iter` (returns a Go 1.23 iterator: `iter.Seq[string]`). Internal storage is `map[string]struct{}`. The map field must be unexported. The iterator must be safe to consume partially (a caller may break early).

**Constraints**:
- Public API exposes no map.
- `Iter` returns `iter.Seq[string]` (`func(yield func(string) bool)`).
- The `Iter` callback must respect early termination (`return` if `yield` returns false).

<details><summary>Hint</summary>

`iter.Seq[T]` is `func(yield func(T) bool)`. Inside, range the map and call `yield(k)`; if it returns `false`, return immediately.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"iter"
)

type StringSet struct {
	m map[string]struct{}
}

func NewStringSet() *StringSet {
	return &StringSet{m: make(map[string]struct{})}
}

func (s *StringSet) Add(v string)           { s.m[v] = struct{}{} }
func (s *StringSet) Remove(v string)        { delete(s.m, v) }
func (s *StringSet) Contains(v string) bool { _, ok := s.m[v]; return ok }
func (s *StringSet) Len() int               { return len(s.m) }

func (s *StringSet) Iter() iter.Seq[string] {
	return func(yield func(string) bool) {
		for k := range s.m {
			if !yield(k) {
				return
			}
		}
	}
}

func main() {
	s := NewStringSet()
	for _, v := range []string{"a", "b", "c", "d"} {
		s.Add(v)
	}
	fmt.Println("len:", s.Len())
	count := 0
	for v := range s.Iter() {
		fmt.Println(v)
		count++
		if count == 2 {
			break // exercise early termination
		}
	}
}
```

</details>

**Self-check**: What invariants does the unexported `m` field protect that an exported `Map map[string]struct{}` would not?

---

## Task 10 (Hard) — Detect Trailing Zero-Size Field Cost In Tests

**Statement**: Write a Go test (`*_test.go`) that fails if a struct gains an unintended trailing zero-size field. Use `unsafe.Sizeof`. Cover at least three structs and assert their expected sizes on 64-bit platforms.

**Constraints**:
- The test must be runnable via `go test`.
- Skip the test on non-64-bit platforms (use `runtime.GOARCH` or `unsafe.Sizeof(uintptr(0)) != 8`).
- Print actual size when the assertion fails for diagnostic value.

<details><summary>Hint</summary>

Use a table of `{name, gotSize, wantSize}` rows. On a non-64-bit platform, `t.Skip("64-bit only")`. This pattern catches accidental layout regressions in code review.

</details>

<details><summary>Solution</summary>

```go
// layout_test.go
package layout

import (
	"runtime"
	"testing"
	"unsafe"
)

type Packet struct {
	ID  uint64
	Len uint32
}

type FlaggedPacket struct {
	ID  uint64
	Len uint32
	_   struct{} // accidental trailing zero-size
}

type SafePacket struct {
	_   struct{} // leading zero-size — free
	ID  uint64
	Len uint32
}

func TestLayoutSizes(t *testing.T) {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("64-bit only")
	}
	cases := []struct {
		name string
		got  uintptr
		want uintptr
	}{
		{"Packet", unsafe.Sizeof(Packet{}), 16},
		{"FlaggedPacket", unsafe.Sizeof(FlaggedPacket{}), 24},
		{"SafePacket", unsafe.Sizeof(SafePacket{}), 16},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s size = %d, want %d", c.name, c.got, c.want)
		}
	}
}
```

In production, you would assert the *intended* size (16 for `Packet`, 16 for `SafePacket`) and treat any drift as a failure. The test for `FlaggedPacket` shows the cost so reviewers see why placement matters.

</details>

**Self-check**: How would you extend this to also assert struct alignment via `unsafe.Alignof`?

---

## Task 11 (Extra-hard) — Tiny Event Bus With `chan struct{}` Subscribers

**Statement**: Build a minimal in-process event bus where any number of subscribers register a `chan struct{}` they want closed when "shutdown" fires. The bus exposes:

- `Subscribe() <-chan struct{}` — returns a fresh channel that will be closed on shutdown.
- `Shutdown()` — closes all subscribed channels exactly once and rejects further subscriptions.

Concurrent calls to `Subscribe` and `Shutdown` must be safe. After `Shutdown`, any `Subscribe` call must return an already-closed channel so consumers do not deadlock.

**Constraints**:
- Use `sync.Mutex` and a slice or map to hold subscribers.
- Use a `bool` flag (or `atomic.Bool`) to guard shutdown idempotency.
- Each channel is closed exactly once (no double-close panic).
- Late `Subscribe` callers receive a closed channel (drain-on-arrival semantics).

<details><summary>Hint</summary>

Hold subscribers in a slice. In `Shutdown`, set the flag, copy the slice under the lock, release the lock, then `close` each channel outside the lock. In `Subscribe`, if the flag is set, return a pre-closed channel; otherwise append a new one.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
)

type Bus struct {
	mu   sync.Mutex
	subs []chan struct{}
	done bool
}

func (b *Bus) Subscribe() <-chan struct{} {
	b.mu.Lock()
	if b.done {
		b.mu.Unlock()
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	ch := make(chan struct{})
	b.subs = append(b.subs, ch)
	b.mu.Unlock()
	return ch
}

func (b *Bus) Shutdown() {
	b.mu.Lock()
	if b.done {
		b.mu.Unlock()
		return
	}
	b.done = true
	subs := b.subs
	b.subs = nil
	b.mu.Unlock()
	for _, ch := range subs {
		close(ch)
	}
}

func main() {
	bus := &Bus{}
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		i := i
		ch := bus.Subscribe()
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-ch
			fmt.Printf("subscriber %d woke\n", i)
		}()
	}
	bus.Shutdown()
	bus.Shutdown() // idempotent
	late := bus.Subscribe()
	<-late // already closed
	fmt.Println("late subscriber returned immediately")
	wg.Wait()
}
```

Closing channels outside the lock prevents subscriber goroutines from blocking on `b.mu` while the bus tries to wake them. The `done` flag guards against double-close panics if `Shutdown` is called twice.

</details>

**Self-check**: What goes wrong if you hold `b.mu` while calling `close(ch)` on every subscriber?

---

## Task 12 (Extra-hard) — Mini `sets.Set[T]` API

**Statement**: Re-implement a small slice of `k8s.io/apimachinery/pkg/util/sets`'s generic `Set[T]` API. Required methods on `Set[T comparable]`:

- `Insert(items ...T) Set[T]` — adds items, returns the set for chaining.
- `Has(v T) bool`
- `Len() int`
- `Difference(other Set[T]) Set[T]` — items in receiver not in `other`.
- `Intersection(other Set[T]) Set[T]`
- `Union(other Set[T]) Set[T]`
- `UnsortedList() []T`

Backing storage is `map[T]struct{}`. The type must be `Set[T comparable] map[T]struct{}` (a named map type) so set operations can read directly without a wrapper struct.

**Constraints**:
- Type definition: `type Set[T comparable] map[T]struct{}`.
- `Insert` is a method that returns the receiver to allow chaining.
- All set operations allocate a fresh result; they do not mutate inputs.
- `T` must satisfy `comparable`; explain in a comment why this is necessary.

<details><summary>Hint</summary>

A named map type can have methods. `comparable` is required because map keys must be comparable. Iterate the smaller map for `Intersection` to keep the work proportional to `min(|a|, |b|)`.

</details>

<details><summary>Solution</summary>

```go
package main

import "fmt"

// Set requires T to be comparable because the backing map's key type must be comparable.
type Set[T comparable] map[T]struct{}

func New[T comparable](items ...T) Set[T] {
	s := make(Set[T], len(items))
	s.Insert(items...)
	return s
}

func (s Set[T]) Insert(items ...T) Set[T] {
	for _, v := range items {
		s[v] = struct{}{}
	}
	return s
}

func (s Set[T]) Has(v T) bool { _, ok := s[v]; return ok }
func (s Set[T]) Len() int     { return len(s) }

func (s Set[T]) Difference(other Set[T]) Set[T] {
	out := make(Set[T])
	for v := range s {
		if !other.Has(v) {
			out[v] = struct{}{}
		}
	}
	return out
}

func (s Set[T]) Intersection(other Set[T]) Set[T] {
	a, b := s, other
	if len(b) < len(a) {
		a, b = b, a // iterate the smaller
	}
	out := make(Set[T])
	for v := range a {
		if b.Has(v) {
			out[v] = struct{}{}
		}
	}
	return out
}

func (s Set[T]) Union(other Set[T]) Set[T] {
	out := make(Set[T], len(s)+len(other))
	for v := range s {
		out[v] = struct{}{}
	}
	for v := range other {
		out[v] = struct{}{}
	}
	return out
}

func (s Set[T]) UnsortedList() []T {
	out := make([]T, 0, len(s))
	for v := range s {
		out = append(out, v)
	}
	return out
}

func main() {
	a := New("alpha", "beta", "gamma")
	b := New("beta", "delta")
	fmt.Println("union:", a.Union(b).UnsortedList())
	fmt.Println("inter:", a.Intersection(b).UnsortedList())
	fmt.Println("diff: ", a.Difference(b).UnsortedList())
	fmt.Println("len a:", a.Len(), "has alpha:", a.Has("alpha"))
}
```

Notes worth internalizing:

- The named map `type Set[T comparable] map[T]struct{}` is itself a reference type; `Insert` mutates in place. No pointer receiver needed.
- `Intersection` iterates the smaller side — the same trick `k8s.io/apimachinery` uses.
- The choice of `struct{}` value (not `bool`) is what saves the value byte per entry across millions of entries.

</details>

**Self-check**: Why is `T comparable` (not `T any`) required, and what error message would Go produce if you tried `T any`?

---

## Wrap-up

If you completed Tasks 1–6, you can use empty struct idioms day to day. If you completed 7–9, you understand the layout and pointer-identity edge cases. If you completed 10–12, you can teach the topic.

For deeper mastery, return to:

- `specification.md` — the spec text and the runtime implementation
- `professional.md` — the runtime internals (`runtime.zerobase`, allocator path)
- `find-bug.md` — the 15 graded bug exercises
