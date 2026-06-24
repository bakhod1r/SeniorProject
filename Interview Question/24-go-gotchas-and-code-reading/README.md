# Go Gotchas & Code Reading

> Tricky-output and code-reading puzzles that probe a senior Go engineer's grasp of loop-variable semantics, defer, typed nil, slice aliasing, channels, and other subtle runtime behaviors.

**35 questions** across **14 topics** · Level: senior

## Topics

- [Loop Variable Capture](#loop-variable-capture) (3)
- [Defer Semantics](#defer-semantics) (5)
- [Typed Nil & Nil Receivers](#typed-nil-nil-receivers) (2)
- [Slice Aliasing & Growth](#slice-aliasing-growth) (4)
- [Map Behaviors](#map-behaviors) (4)
- [Range Quirks](#range-quirks) (2)
- [Channels](#channels) (4)
- [Goroutines & Synchronization](#goroutines-synchronization) (2)
- [Integers, Runes & Iota](#integers-runes-iota) (2)
- [Structs & Methods](#structs-methods) (3)
- [Interfaces & Receivers](#interfaces-receivers) (1)
- [Initialization Order](#initialization-order) (1)
- [Time Pitfalls](#time-pitfalls) (1)
- [Variable Shadowing](#variable-shadowing) (1)

---

## Loop Variable Capture

#### 1. What does this program print under Go 1.21 (pre-1.22) versus Go 1.22+, and why?

*Difficulty:* 🟡 medium  ·  *Tags:* `closures`, `loop-var`, `go1.22`, `goroutines`

**Go 1.21 and earlier:** almost always prints `3 3 3 ` (in some order, but all 3s). There is a single `i` shared by every iteration; the goroutines run after the loop has advanced/finished, so they all read the final value `3`.

**Go 1.22 and later:** prints `0 1 2 ` in some order (the three values, possibly interleaved differently each run). Go 1.22 made the `for` loop variable **per-iteration**: each iteration gets a fresh `i`, so each closure captures a distinct variable holding that iteration's value.

The mechanism: closures in Go capture variables *by reference*, not by value. Before 1.22 there was one variable to capture; after 1.22 there are three. The output order is still nondeterministic because goroutine scheduling is unordered.

**Key points**
- Closures capture the variable, not a snapshot of its value
- Pre-1.22: one shared loop variable -> all goroutines see the last value
- Go 1.22 made loop variables per-iteration (scoped to the loop body)
- The fix changed observed behavior of a very common bug pattern


```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fmt.Print(i, " ")
		}()
	}
	wg.Wait()
}
```

**Follow-ups**
- How did you fix this before 1.22 (e.g. i := i shadow, or passing i as an argument)?
- Does the 1.22 change also apply to range loops?

---

#### 2. Pre-1.22, what is the classic one-line fix inside the loop body, and what does this version print on ALL Go versions?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `closures`, `loop-var`, `fix`

Prints `0 1 2 ` (in some nondeterministic order) on **every** Go version.

The line `i := i` declares a new variable `i` scoped to the loop body, initialized to the current iteration's value. Each closure now captures its own copy. This idiom was the canonical pre-1.22 fix and remains harmless (a no-op-ish redundancy) under 1.22+. Passing the value as a function argument — `go func(i int){...}(i)` — is the other classic fix.

**Key points**
- i := i creates a fresh variable per iteration via shadowing
- Works on all Go versions; redundant but not harmful under 1.22+
- Equivalent alternative: pass i as a goroutine argument


```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		i := i // shadow with a fresh per-iteration variable
		wg.Add(1)
		go func() {
			defer wg.Done()
			fmt.Print(i, " ")
		}()
	}
	wg.Wait()
}
```

**Follow-ups**
- Which fix do you prefer and why — shadow vs argument passing?

---

#### 3. What does this print, and does the Go 1.22 loop-var change affect it?

*Difficulty:* 🟡 medium  ·  *Tags:* `closures`, `loop-var`, `range`, `go1.22`

**Pre-1.22:** prints `ccc`. The range variable `v` is reused across iterations, so all three closures capture the same variable holding the final value `"c"`.

**Go 1.22+:** prints `abc`. The 1.22 per-iteration semantics apply to `range` loops too: `v` is fresh each iteration, so each closure sees its own value.

Unlike the goroutine cases, the order here is deterministic because we call the closures sequentially — only the captured *values* differ between versions.

**Key points**
- The 1.22 change covers both 3-clause and range for-loops
- Deterministic order here (sequential calls), only values differ by version
- ccc pre-1.22, abc on 1.22+


```go
package main

import "fmt"

func main() {
	funcs := make([]func(), 0, 3)
	for _, v := range []string{"a", "b", "c"} {
		funcs = append(funcs, func() { fmt.Print(v) })
	}
	for _, f := range funcs {
		f()
	}
}
```

**Follow-ups**
- What go.mod go directive controls whether you get the new semantics?

---

## Defer Semantics

#### 4. What does this print, and why is the deferred value not 10?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `defer`, `evaluation-time`

Prints:
```
current: 10
deferred: 1
```

Deferred function **arguments are evaluated immediately** when the `defer` statement executes, not when the deferred call runs. At the moment `defer fmt.Println("deferred:", i)` is reached, `i` is `1`, so `1` is captured as the argument. The later `i = 10` does not affect the already-evaluated argument. The call itself runs at function return — hence printed last.

**Key points**
- Defer captures argument VALUES at the point of the defer statement
- The deferred call executes at function return (LIFO)
- Contrast with closures, which capture variables, not values


```go
package main

import "fmt"

func main() {
	i := 1
	defer fmt.Println("deferred:", i)
	i = 10
	fmt.Println("current:", i)
}
```

**Follow-ups**
- How would you make it print 10 instead — wrap it in a closure?

---

#### 5. Now the deferred call is a closure. What does it print?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `defer`, `closures`, `evaluation-time`

Prints:
```
current: 10
deferred: 10
```

Here the deferred entity is a closure over `i`. Only the *call* to the anonymous function is deferred; the body — which reads `i` — runs at return time, by which point `i` is `10`. The closure captures the variable `i` by reference, so it observes the latest value. This is the key contrast with the previous puzzle, where `i` was a directly-evaluated argument.

**Key points**
- A deferred closure reads variables at execution time (return)
- Closure captures the variable; argument-style defer captures the value
- Same i, opposite result vs gotcha-004


```go
package main

import "fmt"

func main() {
	i := 1
	defer func() { fmt.Println("deferred:", i) }()
	i = 10
	fmt.Println("current:", i)
}
```

**Follow-ups**
- When is the argument-evaluation timing actually useful (e.g. defer mu.Unlock())?

---

#### 6. What order are these defers executed in, and what is printed?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `defer`, `lifo`, `ordering`

Prints `start 2 1 0 `.

`start ` prints first because the deferred calls only fire when `main` returns. Defers run in **LIFO** (last-in, first-out) order: the last registered defer (i=2) runs first. Each call's argument was evaluated when its `defer` ran, so the captured values are 0, 1, 2 — printed in reverse registration order as `2 1 0`.

**Key points**
- Defers execute LIFO at function return
- Each deferred call's args were evaluated at registration time (0,1,2)
- Body of the function completes before any defer fires


```go
package main

import "fmt"

func main() {
	for i := 0; i < 3; i++ {
		defer fmt.Print(i, " ")
	}
	fmt.Print("start ")
}
```

**Follow-ups**
- Why is LIFO the right choice for paired acquire/release (locks, files)?

---

#### 7. What does this function return, and how does the defer change it?

*Difficulty:* 🟡 medium  ·  *Tags:* `defer`, `named-returns`

Prints `12`.

With a **named return value** `result`, the `return result + 1` statement does two things: it assigns `6` to `result`, then begins the return. The deferred closure runs *after* this assignment but *before* control actually leaves the function, and it can mutate the named return value: `result *= 2` turns `6` into `12`. So the caller sees `12`, not `6`.

If the return were unnamed (`func compute() int`), the deferred closure would have no name to mutate and the returned value would be `6`.

**Key points**
- return x assigns to the named result, THEN defers run, THEN the function exits
- Deferred closures can mutate named return values
- Common idiom for wrapping errors: defer func(){ err = wrap(err) }()


```go
package main

import "fmt"

func compute() (result int) {
	defer func() {
		result *= 2
	}()
	result = 5
	return result + 1
}

func main() {
	fmt.Println(compute())
}
```

**Follow-ups**
- Rewrite with an unnamed return — what does it print and why?

---

#### 8. This loop opens files. What is the resource bug, and when do the files actually close?

*Difficulty:* 🟡 medium  ·  *Tags:* `defer`, `resource-leak`, `loop`

Behaviorally it prints each path as it processes, but the **bug is resource accumulation**: `defer f.Close()` is bound to the *function* scope, not the loop iteration. None of the files close until `processAll` returns. If `paths` has thousands of entries, you hold thousands of open file descriptors simultaneously and can hit `EMFILE` (too many open files).

Fix options: (1) wrap each iteration in a closure/helper function so the defer fires per-file; or (2) call `f.Close()` explicitly at the end of the loop body (handling the error). Pattern (1):
```go
for _, p := range paths {
    func() {
        f, err := os.Open(p)
        if err != nil { return }
        defer f.Close()
        fmt.Println("processing", f.Name())
    }()
}
```

**Key points**
- defer scope is the enclosing function, not the loop body
- Defers in a loop accumulate and run only at function return
- Risk: file-descriptor / connection / lock exhaustion
- Fix: extract a per-iteration function or close explicitly


```go
package main

import (
	"fmt"
	"os"
)

func processAll(paths []string) {
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		defer f.Close() // BUG: defers accumulate
		fmt.Println("processing", f.Name())
	}
}
```

**Follow-ups**
- How would you propagate Close() errors while still releasing every fd?

---

## Typed Nil & Nil Receivers

#### 9. This function returns a nil pointer through an error interface. What does the caller print, and why is the bug so insidious?

*Difficulty:* 🟠 hard  ·  *Tags:* `typed-nil`, `interfaces`, `error-handling`

Prints `error occurred: boom` (it then calls `Error()` on a nil receiver, which is fine here since the method doesn't dereference `e`).

This is the **typed nil interface** trap. An interface value is a pair `(type, value)`. `err != nil` is true only when *both* halves are nil. `doWork` returns a `*MyError` that is itself nil, but the moment it's assigned to the `error` interface, the interface holds `(type=*MyError, value=nil)` — the type half is non-nil, so `err != nil` is **true**.

The fix is to return `nil` literally on the success path, not a typed nil pointer: `if fail { return &MyError{} }; return nil`. Never declare a concrete error pointer and return it across a success path.

**Key points**
- Interfaces are (type, value) pairs; nil only when BOTH are nil
- A nil *T assigned to an interface yields a non-nil interface
- Always return the literal nil for the no-error path
- Calling a method on a nil receiver is legal unless it dereferences


```go
package main

import "fmt"

type MyError struct{}

func (e *MyError) Error() string { return "boom" }

func doWork(fail bool) error {
	var e *MyError // nil pointer
	if fail {
		e = &MyError{}
	}
	return e // returns a non-nil interface wrapping a (possibly nil) *MyError
}

func main() {
	err := doWork(false)
	if err != nil {
		fmt.Println("error occurred:", err)
	} else {
		fmt.Println("no error")
	}
}
```

**Follow-ups**
- How does errors.Is / a linter (e.g. nilness, staticcheck) catch this?

---

#### 10. Can you call a method on a nil pointer here? What does this print?

*Difficulty:* 🟡 medium  ·  *Tags:* `typed-nil`, `nil-receiver`, `methods`

Prints:
```
0
3
```

Calling a method on a nil pointer is perfectly legal in Go *as long as the method body doesn't dereference the nil receiver*. The receiver `l` is just a pointer argument; the call doesn't dereference it until you access a field. Here `Sum` checks `if l == nil` first, so the nil case returns `0` safely. The recursion `l.next.Sum()` relies on this: the base case is a nil `next`. For the two-node list, `1 + (2 + 0) = 3`.

This is an idiomatic Go pattern for recursive/linked structures — nil receivers as a natural base case.

**Key points**
- Method calls on nil pointers are legal; only dereferencing nil panics
- Nil receiver is a clean base case for recursive structures
- The method must explicitly guard against the nil receiver


```go
package main

import "fmt"

type List struct {
	val  int
	next *List
}

func (l *List) Sum() int {
	if l == nil {
		return 0
	}
	return l.val + l.next.Sum()
}

func main() {
	var l *List // nil
	fmt.Println(l.Sum())

	l = &List{val: 1, next: &List{val: 2}}
	fmt.Println(l.Sum())
}
```

**Follow-ups**
- What happens if Sum forgets the nil check — what's the panic?

---

## Slice Aliasing & Growth

#### 11. What does this print? Pay attention to the shared backing array.

*Difficulty:* 🟠 hard  ·  *Tags:* `slices`, `append`, `aliasing`, `backing-array`

Prints:
```
[1 2 3 99 5]
[2 3 99]
```

`b := a[1:3]` shares `a`'s backing array, starting at index 1, with `len(b)==2` and `cap(b)==4` (from index 1 to the end of `a`). Because there's spare capacity, `append(b, 99)` writes into the *existing* backing array at the slot after `b` — that's `a[3]`, overwriting the original `4` with `99`. So `a` is mutated to `[1 2 3 99 5]` even though we only appended to `b`.

This surprises people who assume `append` always copies. It only reallocates when capacity is exceeded. To avoid clobbering, use a full slice expression `a[1:3:3]` to cap the slice, forcing the next append to reallocate.

**Key points**
- Re-slicing shares the backing array
- append writes in place when spare capacity exists
- This silently mutates the original slice
- a[low:high:max] (full slice expr) limits cap to force copy-on-append


```go
package main

import "fmt"

func main() {
	a := []int{1, 2, 3, 4, 5}
	b := a[1:3] // [2 3], len 2, cap 4
	b = append(b, 99)
	fmt.Println(a)
	fmt.Println(b)
}
```

**Follow-ups**
- Rewrite using a[1:3:3] — what changes in the output?

---

#### 12. Same scenario but with a full slice expression. What does it print now?

*Difficulty:* 🟡 medium  ·  *Tags:* `slices`, `full-slice-expression`, `append`

Prints:
```
[1 2 3 4 5]
[2 3 99]
```

The full slice expression `a[1:3:3]` sets `len(b)==2` and `cap(b)==2` (the third index `3` is the max bound, so cap = max - low = 3 - 1 = 2). Now `append(b, 99)` exceeds capacity, so Go **allocates a new backing array**, copies `[2 3]` into it, and appends `99`. `a` is untouched and remains `[1 2 3 4 5]`.

This is the standard defense against accidental aliasing when handing out sub-slices.

**Key points**
- Full slice expression a[low:high:max] caps capacity to max-low
- When append exceeds cap, a fresh backing array is allocated
- Protects the original slice from being overwritten


```go
package main

import "fmt"

func main() {
	a := []int{1, 2, 3, 4, 5}
	b := a[1:3:3] // [2 3], len 2, cap 2
	b = append(b, 99)
	fmt.Println(a)
	fmt.Println(b)
}
```

**Follow-ups**
- Why is this important when returning slices from a library API?

---

#### 13. A function appends to a slice it received. Does the caller see the change? What prints?

*Difficulty:* 🟠 hard  ·  *Tags:* `slices`, `append`, `pass-by-value`, `function-args`

Prints `[0 0 0]`.

Slices are passed by value: the function gets a *copy* of the slice header (pointer, len, cap). Inside `grow`, `cap(s)==3` and `len(s)==3`, so `append(s, 100)` exceeds capacity and allocates a **new** backing array for the local `s`. The subsequent `s[0] = -1` writes into that new array, which the caller never sees. The caller's slice still points to the original, untouched backing array `[0 0 0]`.

If the slice had spare capacity (e.g. `make([]int, 3, 4)`), the append would write in place and `s[0] = -1` would mutate the *shared* array — but even then the caller's `len` would stay 3, so the appended `100` would be invisible while the `-1` would show. The robust pattern is to return the slice: `s = grow(s)`.

**Key points**
- Slice headers are passed by value (pointer/len/cap copied)
- append that reallocates detaches the callee from the caller's array
- The caller's len/cap never change from inside the callee
- Idiom: s = append(s, ...) and return the slice


```go
package main

import "fmt"

func grow(s []int) {
	s = append(s, 100)
	s[0] = -1
}

func main() {
	s := make([]int, 3, 3) // [0 0 0], len 3 cap 3
	grow(s)
	fmt.Println(s)
}
```

**Follow-ups**
- What changes if you make the slice with cap 4 instead of 3?

---

#### 14. Is there a difference between these two slices? What does this print?

*Difficulty:* 🟡 medium  ·  *Tags:* `slices`, `nil-vs-empty`, `json`

Prints:
```
true false
0 0
null []
```

A nil slice and an empty slice behave identically for `len`, `cap`, `range`, and `append` — but they are **not** equal: `nilSlice == nil` is `true`, `emptySlice == nil` is `false` (the latter has a non-nil backing pointer, even if zero-length).

The difference becomes visible at boundaries like JSON: a nil slice marshals to `null`, while an empty slice marshals to `[]`. This often matters in API contracts where clients distinguish 'no field' from 'empty list'. For internal logic, prefer treating them the same and don't rely on the distinction unless serialization demands it.

**Key points**
- nil slice == nil is true; empty slice == nil is false
- Both have len 0 and are safe to range/append
- json.Marshal: nil -> null, empty -> []
- Distinction matters at serialization / API boundaries


```go
package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var nilSlice []int
	emptySlice := []int{}

	fmt.Println(nilSlice == nil, emptySlice == nil)
	fmt.Println(len(nilSlice), len(emptySlice))

	a, _ := json.Marshal(nilSlice)
	b, _ := json.Marshal(emptySlice)
	fmt.Println(string(a), string(b))
}
```

**Follow-ups**
- How do you force a nil slice to marshal as [] in an API response?

---

## Map Behaviors

#### 15. Will this reliably print keys in insertion order? What is guaranteed?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `maps`, `iteration-order`, `nondeterminism`

It prints the three keys `a`, `b`, `c` but in a **randomized, unspecified order** that varies between runs (e.g. `c a b `). Go deliberately randomizes map iteration order — the runtime starts iteration at a random bucket/offset — specifically to stop programmers from depending on any order.

There is **no** insertion-order or sorted guarantee for maps. If you need a stable order, collect the keys into a slice and `sort.Strings(keys)`, then iterate the slice.

**Key points**
- Map iteration order is intentionally randomized per run
- No insertion-order or sort-order guarantee exists
- For deterministic output: extract keys to a slice and sort


```go
package main

import "fmt"

func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	for k := range m {
		fmt.Print(k, " ")
	}
}
```

**Follow-ups**
- Why did the Go team make this random rather than just unspecified?

---

#### 16. What does this print? Focus on the missing-key reads.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `maps`, `comma-ok`, `zero-value`

Prints:
```
0
0 false
2
```

Reading a missing key returns the **zero value** of the value type (`0` for `int`), never panics. The comma-ok form `v2, ok := m[key]` distinguishes 'present with zero value' from 'absent': `ok` is `false` for a missing key.

The `count["a"]++` idiom works precisely because the first read of the absent key yields `0`, increments to `1`, and stores it — so two increments give `2`. This is why you can build counters without pre-initializing keys.

**Key points**
- Missing-key read returns the value type's zero value, no panic
- Comma-ok form reveals presence vs absence
- m[k]++ relies on the zero-value-on-missing behavior


```go
package main

import "fmt"

func main() {
	m := map[string]int{"x": 10}

	v := m["missing"]
	fmt.Println(v)

	v2, ok := m["missing"]
	fmt.Println(v2, ok)

	count := map[string]int{}
	count["a"]++
	count["a"]++
	fmt.Println(count["a"])
}
```

**Follow-ups**
- How would you distinguish a stored 0 from an absent key in a counter?

---

#### 17. What happens at runtime here — does it print, or panic?

*Difficulty:* 🟡 medium  ·  *Tags:* `maps`, `nil-map`, `panic`

It prints `0 0` first, then **panics** at the write:
```
0 0
panic: assignment to entry in nil map
```

A `nil` map is readable: lookups return the zero value and `len` is `0`. But you cannot *write* to a nil map — there's no underlying hash table allocated, so the runtime panics with `assignment to entry in nil map`. You must initialize it first with `m = make(map[string]int)` or a composite literal.

This bites people when a struct has a map field that they forgot to initialize before assigning to it.

**Key points**
- Reading and len() on a nil map are safe (zero value, 0)
- Writing to a nil map panics: 'assignment to entry in nil map'
- Initialize with make() or a literal before writing
- Common with uninitialized struct map fields


```go
package main

import "fmt"

func main() {
	var m map[string]int // nil map
	fmt.Println(m["a"], len(m)) // reads are fine
	m["a"] = 1                  // write panics
	fmt.Println(m)
}
```

**Follow-ups**
- Does deleting from a nil map panic?

---

#### 18. Will this compile? If not, why?

*Difficulty:* 🟡 medium  ·  *Tags:* `maps`, `addressability`, `compile-error`, `structs`

It does **not compile**. The error is:
```
cannot assign to struct field m["a"].X in map
```

Map elements are **not addressable** in Go. `m["a"]` returns a copy of the value, not a reference to the slot, so you cannot mutate a field of it in place (you'd be mutating a temporary). To update, replace the whole value:
```go
p := m["a"]
p.X = 5
m["a"] = p
```
or store pointers in the map: `map[string]*Point`, where `m["a"].X = 5` *does* work because you're dereferencing a pointer, not addressing the map slot.

**Key points**
- Map values are not addressable; you can't take &m[k] or m[k].field =
- m[k] yields a copy, so in-place field mutation is rejected at compile time
- Fixes: read-modify-write the whole value, or store *Point


```go
package main

import "fmt"

type Point struct{ X, Y int }

func main() {
	m := map[string]Point{"a": {1, 2}}
	m["a"].X = 5 // ???
	fmt.Println(m)
}
```

**Follow-ups**
- Why are map elements non-addressable (hint: rehashing/relocation)?

---

## Range Quirks

#### 19. Ranging over an array — does modifying the array mid-loop affect the iteration? What prints?

*Difficulty:* 🟠 hard  ·  *Tags:* `range`, `array-vs-slice`, `copy-semantics`

Prints `1 2 3 `.

When you `range` over an **array** (not a slice), Go evaluates the range expression once and iterates over a **copy** of the array. So `arr[1] = 99` mutates the original `arr`, but the loop is reading from the copy made at loop start, which still has `2` at index 1. Hence `2`, not `99`.

If `arr` were a *slice* (`arr := []int{1,2,3}`), range would share the backing array, and you'd see `1 99 3 ` because the modification is visible. This array-copy behavior is a classic surprise.

**Key points**
- range over an array copies the array first
- Mutations to the original array don't affect the iteration
- range over a slice shares the backing array -> mutations ARE visible
- Large arrays copied by range can also be a performance footgun


```go
package main

import "fmt"

func main() {
	arr := [3]int{1, 2, 3}
	for i, v := range arr {
		if i == 0 {
			arr[1] = 99 // modify upcoming element
		}
		fmt.Print(v, " ")
	}
}
```

**Follow-ups**
- How would you range over a large array without copying it?

---

#### 20. What does ranging over this string produce for index and value?

*Difficulty:* 🟡 medium  ·  *Tags:* `range`, `strings`, `runes`, `utf-8`

Prints:
```
0:h 1:é 3:l 4:l 5:o 
len: 6
```

Ranging over a string yields `(byteOffset, rune)` pairs, **decoding UTF-8** as it goes. The index is the **byte offset** of the start of each rune, not a sequential 0,1,2 counter. `é` (U+00E9) occupies 2 bytes, so after the rune at byte 1 the next index jumps to 3.

Meanwhile `len(s)` returns the number of **bytes** (6), not runes (5). To count runes use `utf8.RuneCountInString(s)` or `len([]rune(s))`. Indexing `s[1]` would give a single *byte* (the first byte of `é`), not the character.

**Key points**
- range over a string decodes UTF-8: index is the byte offset, value is a rune
- Multi-byte runes cause the index to skip
- len(string) counts bytes, not runes
- s[i] indexes bytes; use []rune or utf8 package for code points


```go
package main

import "fmt"

func main() {
	s := "héllo" // é is U+00E9, 2 bytes in UTF-8
	for i, r := range s {
		fmt.Printf("%d:%c ", i, r)
	}
	fmt.Println()
	fmt.Println("len:", len(s))
}
```

**Follow-ups**
- What does s[1] evaluate to here, and what type is it?

---

## Channels

#### 21. What does receiving from this closed channel print?

*Difficulty:* 🟡 medium  ·  *Tags:* `channels`, `closed-channel`, `comma-ok`

Prints:
```
7 true
0 false
0 false
```

Receiving from a closed channel **never blocks and never panics**. First it drains any buffered values: the buffered `7` comes out with `ok == true`. Once drained, every further receive returns the element type's **zero value** (`0`) with `ok == false`. The `ok` flag is the canonical way to detect channel closure.

This is exactly why `for v := range ch` terminates cleanly when the channel is closed — range stops at the first `ok == false`.

**Key points**
- Receiving from a closed channel drains buffered values first
- After draining: zero value with ok == false, never blocks
- comma-ok on receive detects closure
- Underlies how range over a channel terminates


```go
package main

import "fmt"

func main() {
	ch := make(chan int, 2)
	ch <- 7
	close(ch)

	a, ok1 := <-ch
	b, ok2 := <-ch
	c, ok3 := <-ch
	fmt.Println(a, ok1)
	fmt.Println(b, ok2)
	fmt.Println(c, ok3)
}
```

**Follow-ups**
- What's the difference between a closed channel and a nil channel on receive?

---

#### 22. What happens when you send on a closed channel?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `channels`, `closed-channel`, `panic`

Prints `about to send` and then **panics**:
```
about to send
panic: send on closed channel
```

Sending on a closed channel always panics with `send on closed channel`, even if the channel is buffered with free space. Closing signals 'no more values will ever be sent', so a subsequent send is a programming error. Likewise, **closing an already-closed channel** panics, and **closing a nil channel** panics.

The convention is that the *sender* (or a single coordinating owner) closes the channel, never the receiver — precisely to avoid sending after close.

**Key points**
- Send on a closed channel panics: 'send on closed channel'
- Double-close and close(nil) also panic
- Only the sender/owner should close a channel
- Receivers detect closure via comma-ok or range


```go
package main

import "fmt"

func main() {
	ch := make(chan int, 1)
	close(ch)
	fmt.Println("about to send")
	ch <- 1 // ???
	fmt.Println("sent")
}
```

**Follow-ups**
- How do you coordinate close with multiple senders safely?

---

#### 23. What does this program do at runtime?

*Difficulty:* 🟠 hard  ·  *Tags:* `channels`, `nil-channel`, `deadlock`, `select`

Prints `start`, then **deadlocks**:
```
start
fatal error: all goroutines are asleep - deadlock!
```

A `nil` channel blocks **forever** on both send and receive. Since `ch` was never made, the receive `<-ch` blocks the only goroutine permanently. The Go runtime's deadlock detector notices that all goroutines are blocked and aborts with a `fatal error` (this is a runtime fatal error, not a recoverable panic).

Nil-channel blocking is actually useful in `select`: setting a channel variable to `nil` dynamically disables that case, since a nil channel is never ready.

**Key points**
- Send and receive on a nil channel block forever
- A single blocked goroutine triggers the deadlock detector (fatal error)
- Deadlock is a fatal error, not a recoverable panic
- Useful trick: nil out a channel in select to disable a case


```go
package main

import "fmt"

func main() {
	var ch chan int // nil channel
	fmt.Println("start")
	<-ch // ???
	fmt.Println("done")
}
```

**Follow-ups**
- Show how nil-ing a channel in a select loop disables a branch.

---

#### 24. What does this select print, and is it deterministic?

*Difficulty:* 🟡 medium  ·  *Tags:* `channels`, `select`, `default`, `non-blocking`

Prints (deterministically):
```
received 42
no value ready
```

A `select` with a `default` is **non-blocking**: if no case is ready, it takes the `default` immediately. In the first select, the buffered `42` is available, so the receive case fires. After it's consumed, the buffer is empty; in the second select no receive is ready, so `default` runs. This is the standard 'try-receive' idiom.

(When multiple cases are ready simultaneously, `select` chooses one at random — but here only one case is ever ready at a time, so the output is deterministic.)

**Key points**
- select with default is non-blocking (try-send / try-receive)
- default fires only when no other case is ready
- Among multiple ready cases, select picks pseudo-randomly
- Here only one case is ready each time -> deterministic


```go
package main

import "fmt"

func main() {
	ch := make(chan int, 1)
	ch <- 42

	select {
	case v := <-ch:
		fmt.Println("received", v)
	default:
		fmt.Println("no value ready")
	}

	select {
	case v := <-ch:
		fmt.Println("received", v)
	default:
		fmt.Println("no value ready")
	}
}
```

**Follow-ups**
- When is the random selection among ready cases important for fairness?

---

## Goroutines & Synchronization

#### 25. Will this reliably print the goroutine's message? What is the bug?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `goroutines`, `main-exit`, `synchronization`

It reliably prints `main done` and **usually does NOT print** the goroutine message at all.

`main` returns immediately after launching the goroutine. When `main` (the main goroutine) returns, the entire program exits — the Go runtime does not wait for other goroutines to finish. The spawned goroutine may not even get scheduled before the process tears down. The output is therefore typically just:
```
main done
```
(occasionally you might see both lines if the scheduler happens to run the goroutine first, but that's not guaranteed.)

The fix is explicit synchronization: a `sync.WaitGroup`, a channel to signal completion, etc. Never rely on timing or `time.Sleep` for correctness.

**Key points**
- Program exits when main returns; it does not wait for goroutines
- Output is nondeterministic but usually just 'main done'
- Synchronize with WaitGroup or a done channel, not Sleep


```go
package main

import "fmt"

func main() {
	go func() {
		fmt.Println("hello from goroutine")
	}()
	fmt.Println("main done")
}
```

**Follow-ups**
- Why is time.Sleep a poor synchronization mechanism here?

---

#### 26. There's a concurrency bug in how this WaitGroup is used. What is it, and what can happen?

*Difficulty:* 🟠 hard  ·  *Tags:* `goroutines`, `waitgroup`, `race-condition`, `synchronization`

The bug is calling `wg.Add(1)` **inside** the goroutine instead of before launching it. This creates a race between `wg.Add` and `wg.Wait`. The main goroutine may reach `wg.Wait()` before any goroutine has run `wg.Add(1)` — at which point the counter is `0`, `Wait` returns immediately, and the program prints `all done` while possibly skipping some or all `working` lines. In the worst case `Wait` returns before any work happens.

`Add` must be called in the goroutine that creates the worker, *before* the `go` statement (or at least before any `Wait`), so the counter is guaranteed nonzero when `Wait` is reached:
```go
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); ... }()
}
```
Run with `-race` and this surfaces as a data race / nondeterministic behavior.

**Key points**
- wg.Add must happen before the goroutine starts, not inside it
- Otherwise Wait can observe a zero counter and return early
- Result: missing output and a race between Add and Wait
- Add(n) before the go statement is the correct pattern


```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		go func() {
			wg.Add(1) // BUG: Add inside the goroutine
			defer wg.Done()
			fmt.Println("working")
		}()
	}
	wg.Wait()
	fmt.Println("all done")
}
```

**Follow-ups**
- What does go run -race report for this program?

---

## Integers, Runes & Iota

#### 27. What does this integer arithmetic print?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `integers`, `division`, `rune-byte`, `truncation`

Prints:
```
3
3.5
-3
-1
65 A
```

`7 / 2` is **integer division** — both operands are untyped integer constants, so the result truncates toward zero to `3`. `7.0 / 2` makes one operand a float, so the whole expression is float division: `3.5`. Integer division truncates toward zero (not floor), so `-7 / 2 == -3` (not -4), and `%` follows: `-7 % 2 == -1` (the result of `%` takes the sign of the dividend).

`'A'` is a rune constant with value `65`; assigned to a `byte` it prints as the number `65`, while `string(x)` interprets it as the character `"A"`.

**Key points**
- Integer division truncates toward zero, not floor
- Float division requires a float operand (7.0)
- % result takes the sign of the dividend: -7 % 2 == -1
- A byte/rune prints numerically; string(b) gives the character


```go
package main

import "fmt"

func main() {
	fmt.Println(7 / 2)
	fmt.Println(7.0 / 2)
	fmt.Println(-7 / 2)
	fmt.Println(-7 % 2)
	var x byte = 'A'
	fmt.Println(x, string(x))
}
```

**Follow-ups**
- How would you compute a floor division for negative numbers?

---

#### 28. What values do these iota constants have?

*Difficulty:* 🟡 medium  ·  *Tags:* `iota`, `constants`, `enums`

Prints:
```
1024 1.048576e+06 1.073741824e+09
0 1 3
```

`iota` is the index of the const spec within the `const` block, starting at `0` and incrementing by one per line (whether or not iota is mentioned). In the first block, line 0 is discarded with `_`. `KB` is on line 1: `1 << (10*1) = 1024`. `MB` and `GB` **repeat the same expression** (constants without an explicit value reuse the previous spec's expression), so they evaluate with iota = 2 and 3: `1<<20` and `1<<30`. Because the type is `ByteSize float64`, they print in float form.

In the second block, iota is 0,1,2,3 per line; the `_` on the third line skips value `2`, so `D` (line 3) is `3`, not `2`. This is the standard iota enum/skip pattern.

**Key points**
- iota is the line index in the const block, incrementing each spec
- Omitted expressions repeat the previous spec's expression
- _ consumes an iota value (used to skip)
- iota resets to 0 at each new const block


```go
package main

import "fmt"

type ByteSize float64

const (
	_           = iota // 0, skipped
	KB ByteSize = 1 << (10 * iota)
	MB
	GB
)

const (
	A = iota // 0
	B        // 1
	_        // 2, skipped
	D        // 3
)

func main() {
	fmt.Println(KB, MB, GB)
	fmt.Println(A, B, D)
}
```

**Follow-ups**
- How would you build a bit-flag enum with iota (1 << iota)?

---

## Structs & Methods

#### 29. Does the mutation stick? What does this print?

*Difficulty:* 🟡 medium  ·  *Tags:* `structs`, `methods`, `value-vs-pointer-receiver`

Prints:
```
0
2
```

`IncValue` has a **value receiver**: it operates on a *copy* of `c`, so incrementing `c.n` inside it mutates the copy and is lost when the method returns. Two calls leave the original at `0`.

`IncPtr` has a **pointer receiver**: `c.IncPtr()` is shorthand for `(&c).IncPtr()` (Go auto-takes the address because `c` is addressable), so it mutates the original. Two calls bring `c.n` to `2`.

Rule of thumb: if a method needs to modify the receiver (or the struct is large), use a pointer receiver.

**Key points**
- Value receiver gets a copy; mutations don't persist
- Pointer receiver mutates the original; Go auto-takes &c for addressable values
- Mixing receiver kinds on one type is a common smell
- Use pointer receivers to mutate or avoid large copies


```go
package main

import "fmt"

type Counter struct{ n int }

func (c Counter) IncValue() { c.n++ }   // value receiver
func (c *Counter) IncPtr()  { c.n++ }   // pointer receiver

func main() {
	c := Counter{}
	c.IncValue()
	c.IncValue()
	fmt.Println(c.n)

	c.IncPtr()
	c.IncPtr()
	fmt.Println(c.n)
}
```

**Follow-ups**
- What happens if c is not addressable (e.g. a map value) and you call IncPtr?

---

#### 30. Which method gets called via the embedded field, and what prints?

*Difficulty:* 🟠 hard  ·  *Tags:* `structs`, `embedding`, `method-shadowing`, `no-virtual-dispatch`

Prints:
```
Woof
I say ...
```

`Dog.Speak` **shadows** the embedded `Animal.Speak`, so `d.Speak()` calls the Dog version and returns `"Woof"`.

But `Describe` is defined on `Animal` and is *promoted* to `Dog`. When you call `d.Describe()`, it runs with an `Animal` receiver, and inside it `a.Speak()` resolves statically to `Animal.Speak` — there is **no virtual dispatch** in Go. Embedding is composition, not inheritance: the promoted method has no knowledge of `Dog`'s override, so it returns `"I say ..."`, not `"I say Woof"`.

To get polymorphic behavior you'd need an interface and explicit indirection, not embedding.

**Key points**
- Embedding promotes methods but is composition, not inheritance
- Outer-type methods shadow same-named embedded methods on direct calls
- Promoted methods run with the embedded receiver -> no virtual dispatch
- Use interfaces for polymorphism, not method override expectations


```go
package main

import "fmt"

type Animal struct{}

func (a Animal) Speak() string { return "..." }
func (a Animal) Describe() string { return "I say " + a.Speak() }

type Dog struct{ Animal }

func (d Dog) Speak() string { return "Woof" }

func main() {
	d := Dog{}
	fmt.Println(d.Speak())
	fmt.Println(d.Describe())
}
```

**Follow-ups**
- How would you restructure with an interface to get Describe to print 'Woof'?

---

#### 31. Will these struct comparisons compile and run? What is the outcome?

*Difficulty:* 🟡 medium  ·  *Tags:* `structs`, `comparison`, `compile-error`, `comparable`

This does **not compile**. The error is on the second comparison:
```
invalid operation: b1 == b2 (struct containing []int cannot be compared)
```

Structs are comparable with `==` **only if all their fields are comparable**. `A` has only `int` and `string` fields, both comparable, so `a1 == a2` is fine and would print `true` (field-by-field equality).

But `B` contains a `[]int` slice, and slices are not comparable (you can only compare a slice to `nil`). Therefore any `==` on `B` is a *compile-time* error, not a runtime one. To compare such structs use `reflect.DeepEqual` or a hand-written equality function.

**Key points**
- Structs are comparable iff every field is comparable
- Slices, maps, and functions are not comparable (compile error)
- A{int,string} compares field-by-field and would print true
- Use reflect.DeepEqual for structs with non-comparable fields


```go
package main

import "fmt"

type A struct {
	X int
	Y string
}

type B struct {
	Items []int
}

func main() {
	a1 := A{1, "hi"}
	a2 := A{1, "hi"}
	fmt.Println(a1 == a2)

	b1 := B{[]int{1}}
	b2 := B{[]int{1}}
	fmt.Println(b1 == b2)
}
```

**Follow-ups**
- Why are slices not comparable while arrays are?

---

## Interfaces & Receivers

#### 32. Will this compile? It assigns a value to an interface. Explain.

*Difficulty:* 🟠 hard  ·  *Tags:* `interfaces`, `method-set`, `pointer-receiver`, `compile-error`

It does **not compile**. The error is on `s = t`:
```
cannot use t (variable of type T) as Stringer value in assignment: T does not implement Stringer (method String has pointer receiver)
```

When a method is defined with a **pointer receiver** `(*T)`, only `*T` is in the method set of the type — `T` (the value type) does **not** satisfy the interface. So `s = &t` works, but `s = t` fails to compile.

The asymmetry: if `String` had a *value* receiver `(t T)`, then both `T` and `*T` would satisfy `Stringer`. Pointer-receiver methods are not in the value type's method set because Go can't always take the address of an interface-stored value. This is why a forgotten `&` is a frequent 'does not implement' error.

**Key points**
- Pointer-receiver methods are only in *T's method set, not T's
- Value-receiver methods are in both T's and *T's method sets
- So *T satisfies the interface but T does not (here)
- Common 'does not implement interface' cause: missing &


```go
package main

import "fmt"

type Stringer interface{ String() string }

type T struct{ name string }

func (t *T) String() string { return t.name } // pointer receiver

func main() {
	var s Stringer

	t := T{"hello"}
	s = &t // OK: *T implements Stringer
	fmt.Println(s.String())

	s = t // ??? does T implement Stringer?
	fmt.Println(s.String())
}
```

**Follow-ups**
- Why can't Go just take the address of the value to make T satisfy it?

---

## Initialization Order

#### 33. In what order do these run, and what is printed?

*Difficulty:* 🟡 medium  ·  *Tags:* `init`, `package-initialization`, `ordering`

Prints:
```
init: 3 2 1
main: 3 2 1
```

Package-level variable initialization does **not** follow source order — Go performs a **dependency-ordered** initialization. `a` depends on `b`, which depends on `c`, so the runtime initializes `c=1` first, then `b=c+1=2`, then `a=b+1=3`, regardless of the declaration order in the file.

After all package variables are initialized, `init()` functions run (in source order within a file, and in file order). Only then does `main` run. So both lines print `3 2 1`. (If there were a true initialization cycle, the compiler would reject it.)

**Key points**
- Package vars initialize in dependency order, not source order
- init() runs after all package-level var initialization
- main runs after all init() functions complete
- Initialization cycles are a compile error


```go
package main

import "fmt"

var a = b + 1
var b = c + 1
var c = 1

func init() {
	fmt.Println("init:", a, b, c)
}

func main() {
	fmt.Println("main:", a, b, c)
}
```

**Follow-ups**
- What is the init order across multiple files / multiple packages?

---

## Time Pitfalls

#### 34. Why might this time format produce unexpected output? What is the reference layout?

*Difficulty:* 🟡 medium  ·  *Tags:* `time`, `formatting`, `reference-layout`

Prints:
```
2023-03-04 09:05:00
03/04/2023
4049-09-05
```

Go's `time.Format` uses a **reference layout** rather than `%Y-%m-%d`-style tokens. The reference time is `Mon Jan 2 15:04:05 MST 2006` (mnemonic: 1 2 3 4 5 6 7 — month, day, hour, minute, second, year-2006, and 7=UTC offset). You describe the *shape* of the output by formatting that one specific timestamp. So `"2006-01-02 15:04:05"` yields the actual value formatted that way.

The third line is the classic bug: a developer writes `"2023-03-04"` thinking it's a placeholder for the date. But Go does not see a year — it greedily matches reference *components* and copies everything else verbatim. The layout `"2023-03-04"` actually tokenizes as: `2` = day-of-month (`4`), `0` = literal `0`, `2` = day-of-month again (`4`), `3` = 12-hour clock (`9`), then literal `-`, `03` = zero-padded 12-hour (`09`), literal `-`, `04` = minute (`05`). The result for this timestamp is therefore `4049-09-05` — pure nonsense, and it changes with every different time. 

Lesson: never put arbitrary numbers in a layout. Only the reference components are magic (`2006` year, `01`/`1` month, `02`/`2` day, `15`/`03`/`3` hour, `04`/`4` minute, `05`/`5` second). Prefer the named constants `time.DateOnly` (`"2006-01-02"`), `time.RFC3339`, etc. to avoid this entirely.

**Key points**
- Go formats by example using the reference time Mon Jan 2 15:04:05 MST 2006
- Layout components are specific magic numbers (01=month, 02=day, 15=hour...)
- Using arbitrary numbers like 2023 in a layout silently misbehaves
- Use time constants (time.RFC3339, time.DateOnly) to avoid mistakes


```go
package main

import (
	"fmt"
	"time"
)

func main() {
	t := time.Date(2023, time.March, 4, 9, 5, 0, 0, time.UTC)

	fmt.Println(t.Format("2006-01-02 15:04:05"))
	fmt.Println(t.Format("01/02/2006"))
	fmt.Println(t.Format("2023-03-04")) // common mistake
}
```

**Follow-ups**
- What's the difference between 15 and 03 in the hour position?

---

## Variable Shadowing

#### 35. Why does err appear to be nil after a failure? Spot the shadowing bug.

*Difficulty:* 🟠 hard  ·  *Tags:* `shadowing`, `short-var-declaration`, `error-handling`

Prints:
```
inside: 0 not found
outside err: <nil>
```

The bug is on the line `val, err := find()`. Because at least one new variable would be introduced and `:=` is used **inside the `if` block**, Go declares *brand-new* block-scoped `val` and `err` that shadow the outer ones. The error from `find()` is captured in the inner `err`, which goes out of scope at the closing brace. The outer `err` was never assigned, so it stays `nil`.

This is a very common production bug: the error is checked/printed inside the block but the *outer* code believes there was no error. The fix is to use `=` (plain assignment) since both variables already exist: `val, err = find()`. `go vet`'s shadow analysis and tools like `govet -vettool=shadow` flag this.

**Key points**
- := inside a block creates new variables if it can, shadowing outer ones
- Mixed := where some vars exist still shadows if the scope differs
- The outer err is never assigned and stays nil
- Use = when all variables already exist; enable shadow linting


```go
package main

import (
	"errors"
	"fmt"
)

func find() (int, error) {
	return 0, errors.New("not found")
}

func main() {
	var err error
	val := 0

	if true {
		val, err := find() // := shadows both val and err in this block
		fmt.Println("inside:", val, err)
	}

	fmt.Println("outside err:", err)
	_ = val
}
```

**Follow-ups**
- How does := decide between declaring new vars and reusing existing ones?

---
