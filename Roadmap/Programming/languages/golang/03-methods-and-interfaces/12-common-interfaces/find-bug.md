# Common Interfaces — Find the Bug

Each snippet below misuses one of the standard library interfaces. Read the
buggy code, form a hypothesis from the hint, then check the cause and the
fix. The point is not to memorize a fix, but to internalize the contract that
each interface imposes on its implementers and callers.

## Bug 1 — io.Reader: ignoring n>0 when err==io.EOF

```go
package main

import (
	"bytes"
	"fmt"
	"io"
)

func readAll(r io.Reader) ([]byte, error) {
	var out []byte
	buf := make([]byte, 32)
	for {
		n, err := r.Read(buf)
		if err != nil {
			if err == io.EOF {
				return out, nil
			}
			return nil, err
		}
		out = append(out, buf[:n]...)
	}
}

func main() {
	r := bytes.NewReader([]byte("hello, world"))
	data, _ := readAll(r)
	fmt.Printf("%q\n", data)
}
```

**Hint:** What does the `io.Reader` contract say about returning a non-zero
`n` together with a non-nil `err`? Try a reader that returns the last chunk
and `io.EOF` in the same call.

**Cause:** The contract for `io.Reader` explicitly allows returning `n > 0`
bytes and `err == io.EOF` in the same call. The buggy loop checks `err`
first and discards the final `n` bytes whenever the reader is helpful enough
to combine them. Many real readers (notably `bytes.Reader` does not, but
`net.Conn`, compressed readers, and custom readers do) trigger this.

```go
func readAll(r io.Reader) ([]byte, error) {
	var out []byte
	buf := make([]byte, 32)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			out = append(out, buf[:n]...)
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
	}
}
```

## Bug 2 — io.Writer: not handling short Write

```go
package main

import (
	"io"
	"os"
)

func writeAll(w io.Writer, p []byte) error {
	_, err := w.Write(p)
	return err
}

func main() {
	_ = writeAll(os.Stdout, []byte("hello, world\n"))
}
```

**Hint:** `io.Writer.Write` returns both `n` and `err`. The contract requires
that an implementation return a non-nil error if `n < len(p)`, but many
wrappers and pipes still return `n < len(p)` with `err == nil` in edge
cases, and well-written callers loop until everything is flushed.

**Cause:** `Write` is allowed to write fewer bytes than requested. Even
though the contract says it must return an error in that case, defensive
callers should still loop, because composed writers (encrypted, chunked,
buffered) sometimes report partial writes. The bug also throws away `n`,
which makes the function useless for callers that want to know how much was
actually written.

```go
func writeAll(w io.Writer, p []byte) (int, error) {
	total := 0
	for total < len(p) {
		n, err := w.Write(p[total:])
		total += n
		if err != nil {
			return total, err
		}
		if n == 0 {
			return total, io.ErrShortWrite
		}
	}
	return total, nil
}
```

## Bug 3 — json.Marshaler returning slice that gets mutated externally

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Tags struct {
	cached []byte
	values []string
}

func (t *Tags) MarshalJSON() ([]byte, error) {
	if t.cached != nil {
		return t.cached, nil
	}
	b, err := json.Marshal(t.values)
	if err != nil {
		return nil, err
	}
	t.cached = b
	return t.cached, nil
}

func main() {
	t := &Tags{values: []string{"go", "json"}}
	b1, _ := json.Marshal(t)
	b1[1] = 'X'
	b2, _ := json.Marshal(t)
	fmt.Println(string(b2))
}
```

**Hint:** `MarshalJSON` returns a `[]byte`. The contract says the caller
must not modify it, but `encoding/json` itself will not, so why would the
returned bytes change between calls?

**Cause:** The bug is the cache being shared with the caller. Anyone who
gets `b1` from `json.Marshal(t)` actually receives the exact same backing
array as `t.cached`. If the caller mutates it (a separate caller may, even
though `json` itself does not), every subsequent marshal returns corrupted
JSON. A `Marshaler` that caches must defensively copy on the way out.

```go
func (t *Tags) MarshalJSON() ([]byte, error) {
	if t.cached == nil {
		b, err := json.Marshal(t.values)
		if err != nil {
			return nil, err
		}
		t.cached = b
	}
	out := make([]byte, len(t.cached))
	copy(out, t.cached)
	return out, nil
}
```

## Bug 4 — sort.Interface Less violating strict weak ordering

```go
package main

import (
	"fmt"
	"sort"
)

type Item struct {
	Priority int
	Name     string
}

type byPriority []Item

func (s byPriority) Len() int      { return len(s) }
func (s byPriority) Swap(i, j int) { s[i], s[j] = s[j], s[i] }
func (s byPriority) Less(i, j int) bool {
	return s[i].Priority <= s[j].Priority
}

func main() {
	items := []Item{
		{1, "a"}, {2, "b"}, {1, "c"}, {3, "d"}, {2, "e"},
	}
	sort.Sort(byPriority(items))
	fmt.Println(items)
}
```

**Hint:** What must `Less(i, j)` and `Less(j, i)` simultaneously return when
the two elements are considered equal? Try drawing the truth table.

**Cause:** `sort.Interface.Less` must implement a strict weak ordering: for
any two equal elements, both `Less(i, j)` and `Less(j, i)` must return
`false`. Using `<=` makes both directions return `true` for equal
priorities, which violates the invariant. `sort.Sort` may then loop, panic
with "less func called on equal elements," or simply produce a wrong
ordering depending on the algorithm path.

```go
func (s byPriority) Less(i, j int) bool {
	return s[i].Priority < s[j].Priority
}
```

## Bug 5 — error: typed-nil from custom error type

```go
package main

import "fmt"

type ValidationError struct {
	Field string
	Msg   string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Msg
}

func validate(name string) error {
	var err *ValidationError
	if name == "" {
		err = &ValidationError{Field: "name", Msg: "must not be empty"}
	}
	return err
}

func main() {
	if err := validate("alice"); err != nil {
		fmt.Println("invalid:", err)
		return
	}
	fmt.Println("ok")
}
```

**Hint:** What is the dynamic type of the value returned when `name` is
non-empty? An `error` interface value is nil only when both its type and its
value are nil.

**Cause:** The function declares `var err *ValidationError`, which is a
typed nil. Returning it through the `error` return type wraps it as an
interface value `(type=*ValidationError, value=nil)`. That interface is
not equal to `nil`, so callers that check `err != nil` always think
validation failed. Always declare the variable with the interface type, or
return `nil` explicitly on the success path.

```go
func validate(name string) error {
	if name == "" {
		return &ValidationError{Field: "name", Msg: "must not be empty"}
	}
	return nil
}
```

## Bug 6 — context.Context leaking via Background() instead of WithCancel

```go
package main

import (
	"context"
	"fmt"
	"time"
)

func fetch(parent context.Context, url string) (string, error) {
	ctx := context.Background()
	go func() {
		time.Sleep(5 * time.Second)
		fmt.Println("background work for", url, "done")
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(50 * time.Millisecond):
		return "body of " + url, nil
	}
}

func main() {
	parent, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	body, err := fetch(parent, "https://example.com")
	fmt.Println(body, err)
}
```

**Hint:** What happens to the parent's deadline inside `fetch`? Which
context governs the goroutine and the `select`?

**Cause:** `fetch` ignores its `parent` and calls `context.Background()`,
which has no deadline and no cancellation. The parent timeout becomes
meaningless: the function still waits up to 50 ms and the goroutine still
runs to completion regardless of caller cancellation. Functions that accept
a `context.Context` must derive any sub-context from it (typically with
`WithCancel`, `WithTimeout`, or `WithValue`) and propagate it everywhere
they spawn work.

```go
func fetch(parent context.Context, url string) (string, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
			fmt.Println("background work for", url, "done")
		}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(50 * time.Millisecond):
		return "body of " + url, nil
	}
}
```

## Bug 7 — fmt.Stringer infinite recursion via %v in String()

```go
package main

import "fmt"

type Money struct {
	Amount   int64
	Currency string
}

func (m Money) String() string {
	return fmt.Sprintf("%v %s", m, m.Currency)
}

func main() {
	m := Money{Amount: 100, Currency: "USD"}
	fmt.Println(m)
}
```

**Hint:** When `fmt` formats a value with `%v`, it asks the value whether it
implements `Stringer`. What happens if the answer is yes and that
`String()` method itself uses `%v` on the same value?

**Cause:** Inside `String()`, the verb `%v` against `m` triggers
`fmt.Stringer.String` again, which recurses indefinitely until the stack
overflows. The package detects some self-recursive formatting and prints
`%!v(PANIC=...)`, but you should never rely on that. Use field-level verbs
or a different type when you want to avoid the `Stringer` path.

```go
func (m Money) String() string {
	return fmt.Sprintf("%d %s", m.Amount, m.Currency)
}
```

## Bug 8 — http.Handler writing header after Write

```go
package main

import (
	"fmt"
	"net/http"
)

type errorHandler struct{}

func (errorHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "something went wrong")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
}

func main() {
	http.Handle("/", errorHandler{})
	_ = http.ListenAndServe(":8080", nil)
}
```

**Hint:** `http.ResponseWriter` implicitly calls `WriteHeader(200)` the
first time a handler writes the body. What state is the response in by the
time the explicit `WriteHeader` call is reached?

**Cause:** `Write` is `Fprintln`'d before any header is set. That implicitly
flushes status `200 OK` and any default headers. The subsequent
`Header().Set` and `WriteHeader(500)` calls are no-ops; net/http logs
`http: superfluous response.WriteHeader call`. Headers and status must be
set before the first byte of the body. Refactor so `WriteHeader` happens
last in the prep stage, or use `http.Error` for the common case.

```go
func (errorHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	fmt.Fprintln(w, "something went wrong")
}
```

## Bug 9 — io.Closer double-close panic

```go
package main

import (
	"fmt"
	"sync"
)

type Pipe struct {
	mu     sync.Mutex
	ch     chan []byte
	closed bool
}

func NewPipe() *Pipe {
	return &Pipe{ch: make(chan []byte)}
}

func (p *Pipe) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	close(p.ch)
	return nil
}

func main() {
	p := NewPipe()
	_ = p.Close()
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("recovered:", r)
		}
	}()
	_ = p.Close()
}
```

**Hint:** What is the contract of `io.Closer`? Specifically, what should
happen if a caller calls `Close` twice? What does `close(ch)` do on a
channel that is already closed?

**Cause:** The `io.Closer` contract recommends that `Close` be safe to call
multiple times and idempotent for well-behaved types. Calling `close` on an
already-closed channel panics with "close of closed channel," and the
mutex does not help because the second call still reaches `close(ch)`. The
fix is to track and short-circuit on the `closed` flag.

```go
func (p *Pipe) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	close(p.ch)
	return nil
}
```

## Bug 10 — iter.Seq yielding from goroutine without sync

```go
package main

import (
	"fmt"
	"iter"
)

func Stream(values []int) iter.Seq[int] {
	return func(yield func(int) bool) {
		go func() {
			for _, v := range values {
				if !yield(v) {
					return
				}
			}
		}()
	}
}

func main() {
	for v := range Stream([]int{1, 2, 3, 4, 5}) {
		fmt.Println(v)
	}
}
```

**Hint:** `iter.Seq` is a push-style sequence. The `yield` callback runs on
the consumer's goroutine and uses the consumer's stack frame. What happens
if you call it from a different goroutine, especially after the producer
function has returned?

**Cause:** Calling `yield` from a goroutine other than the one driving the
range loop is undefined behavior in `range over func`: the runtime expects
`yield` to run on the same goroutine that is suspended in the loop, because
the loop body and `yield` cooperate via stack switching. Even when it
appears to work, the producer function returns immediately, the
runtime considers the iterator exhausted, and the goroutine's later
`yield` calls race with cleanup. Iterators must drive `yield`
synchronously; if you genuinely need a producer goroutine, hand values
through a channel and pull from it inside the iterator.

```go
func Stream(values []int) iter.Seq[int] {
	return func(yield func(int) bool) {
		for _, v := range values {
			if !yield(v) {
				return
			}
		}
	}
}
```

Each of these bugs is small, but each one corresponds to a clause in the
interface's contract. Reading the doc comments on `io.Reader`, `io.Writer`,
`json.Marshaler`, `sort.Interface`, `error`, `context.Context`,
`fmt.Stringer`, `http.ResponseWriter`, `io.Closer`, and `iter.Seq` is the
single highest-leverage thing you can do to avoid this whole class of
mistakes in the future.
