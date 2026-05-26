# Functional Options — Hands-on Tasks

Work through these in order. The first few cement the basic shape from `junior.md`; the middle ones force you to choose between the variants described in `middle.md`; the last few are open-ended exercises against real-world code. Run every task with `go vet ./...` and `go test ./...` before moving on.

You will need Go 1.21 or later. Tasks 8 and 14 require Go 1.18+ generics. Tasks 11 and 16 expect you to have `encoding/json` and `gopkg.in/yaml.v3` available.

---

## Task 1: A Calculator with two options

Implement the smallest possible functional-options API. A `Calculator` has two configurable fields: `precision` (how many decimal places) and `mode` (one of `"round"`, `"floor"`, `"ceil"`). Defaults: `precision=2`, `mode="round"`.

**Acceptance criteria**

- [ ] `type Calculator struct` holds the two fields plus any internal state.
- [ ] `type Option func(*Calculator)`.
- [ ] `WithPrecision(int) Option` and `WithMode(string) Option` exist and follow the naming convention.
- [ ] `NewCalculator(opts ...Option) *Calculator` sets defaults *before* applying options.
- [ ] A method `Calc(a, b float64) float64` performs `a/b` and applies the configured rounding to the configured precision.
- [ ] A test asserts:
  - `NewCalculator().Calc(10, 3)` returns `3.33`.
  - `NewCalculator(WithPrecision(4)).Calc(10, 3)` returns `3.3333`.
  - `NewCalculator(WithMode("floor"), WithPrecision(2)).Calc(10, 3)` returns `3.33`.

<details><summary>Hints</summary>

- For rounding, use `math.Round`, `math.Floor`, `math.Ceil` combined with `math.Pow(10, precision)`.
- Don't validate `mode` inside the option. Let the constructor (or `Calc`) decide what to do with an unknown mode.
- Remember §7 of junior.md: defaults belong in the constructor literal.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"math"
)

type Calculator struct {
	precision int
	mode      string
}

type Option func(*Calculator)

func WithPrecision(p int) Option {
	return func(c *Calculator) { c.precision = p }
}

func WithMode(m string) Option {
	return func(c *Calculator) { c.mode = m }
}

func NewCalculator(opts ...Option) *Calculator {
	c := &Calculator{precision: 2, mode: "round"}
	for _, o := range opts {
		o(c)
	}
	return c
}

func (c *Calculator) Calc(a, b float64) float64 {
	r := a / b
	mult := math.Pow(10, float64(c.precision))
	switch c.mode {
	case "floor":
		return math.Floor(r*mult) / mult
	case "ceil":
		return math.Ceil(r*mult) / mult
	default:
		return math.Round(r*mult) / mult
	}
}

func main() {
	fmt.Println(NewCalculator().Calc(10, 3))                              // 3.33
	fmt.Println(NewCalculator(WithPrecision(4)).Calc(10, 3))              // 3.3333
	fmt.Println(NewCalculator(WithMode("floor")).Calc(10, 3))             // 3.33
}
```

</details>

**Discussion.** Notice three things you'll repeat for every later task: the option type is `func(*T)`, defaults sit in the constructor, and the option functions are dumb setters. Try moving the default of `precision=2` *into* `WithPrecision` and observe how it breaks the rule from §7 of `junior.md`.

---

## Task 2: HTTP client with retries, timeout, and transport

Build a tiny `httpclient` package whose constructor exposes `WithTimeout`, `WithRetries`, `WithTransport`, and `WithHeader`. `WithHeader` should be *additive*: calling it twice with two different keys should leave both headers set.

**Acceptance criteria**

- [ ] `NewClient(baseURL string, opts ...Option) *Client` is the constructor.
- [ ] `Client.Get(path string) (*http.Response, error)` performs a GET against `baseURL + path` using the configured timeout and adds all configured headers.
- [ ] On a 5xx response, the client retries up to `retries` times. On 4xx, no retry.
- [ ] Defaults: timeout 30s, retries 0 (no retry), no custom transport, no headers.
- [ ] `WithTransport(t http.RoundTripper)` is a no-op when `t == nil`.
- [ ] Lazily initialise the headers map (don't allocate one if `WithHeader` is never called).
- [ ] A test using `httptest.NewServer` proves that:
  - A 500 response is retried twice when `WithRetries(2)` is set.
  - A 400 response is *not* retried.
  - Two `WithHeader` calls both end up on the wire.

<details><summary>Hints</summary>

- Wrap `http.Client.Timeout` for the timeout option.
- Use `httptest.NewServer` and an atomic counter in the handler to count requests.
- For headers, follow §10 of `junior.md` (lazy map allocation in the option).

</details>

<details><summary>Solution</summary>

```go
package httpclient

import (
	"net/http"
	"time"
)

type Client struct {
	hc      *http.Client
	baseURL string
	headers map[string]string
	retries int
}

type Option func(*Client)

func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.hc.Timeout = d }
}

func WithRetries(n int) Option {
	return func(c *Client) { c.retries = n }
}

func WithTransport(t http.RoundTripper) Option {
	return func(c *Client) {
		if t == nil {
			return
		}
		c.hc.Transport = t
	}
}

func WithHeader(key, value string) Option {
	return func(c *Client) {
		if c.headers == nil {
			c.headers = make(map[string]string)
		}
		c.headers[key] = value
	}
}

func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		hc:      &http.Client{Timeout: 30 * time.Second},
		baseURL: baseURL,
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

func (c *Client) Get(path string) (*http.Response, error) {
	var resp *http.Response
	var err error
	attempts := c.retries + 1
	for i := 0; i < attempts; i++ {
		req, rerr := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
		if rerr != nil {
			return nil, rerr
		}
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		resp, err = c.hc.Do(req)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
		if resp != nil {
			resp.Body.Close()
		}
	}
	return resp, err
}
```

</details>

**Discussion.** The "additive" semantics of `WithHeader` is the first meaningful design choice. Compare with `WithTimeout`, which is "replacing" — each call overwrites. Both are valid; the right choice depends on whether the field is conceptually a *single value* (timeout) or a *collection* (headers, middlewares).

---

## Task 3: Database connection with optional fields and one required arg

Build a `db` package whose `NewConn` accepts a required `driver string` plus options for `host`, `port`, `user`, `password`, `ssl bool`, `database`. The constructor must return `(*Conn, error)` because building the DSN can fail (e.g., unknown driver).

**Acceptance criteria**

- [ ] `NewConn(driver string, opts ...Option) (*Conn, error)`.
- [ ] Defaults: host `"localhost"`, port `5432`, user `"postgres"`, password `""`, ssl `false`, database empty.
- [ ] If `driver` is not `"postgres"` or `"mysql"`, return an error.
- [ ] If port is outside `1-65535`, return an error from the constructor (not the option).
- [ ] Method `Conn.DSN() string` returns the formatted connection string. For postgres: `postgres://user:pass@host:port/db?sslmode=disable`.
- [ ] A test confirms that `NewConn("postgres", WithHost("db"), WithPort(5433))` produces the right DSN, and `NewConn("oracle")` returns an error.

<details><summary>Hints</summary>

- Keep options as pure setters — none of them returns an error. All validation lives at the bottom of the constructor.
- The classic mistake here is letting `WithPort` panic on bad input. Don't. Set the field; let the constructor decide.

</details>

<details><summary>Solution</summary>

```go
package db

import (
	"errors"
	"fmt"
)

type Conn struct {
	driver   string
	host     string
	port     int
	user     string
	password string
	ssl      bool
	database string
}

type Option func(*Conn)

func WithHost(h string) Option        { return func(c *Conn) { c.host = h } }
func WithPort(p int) Option           { return func(c *Conn) { c.port = p } }
func WithUser(u string) Option        { return func(c *Conn) { c.user = u } }
func WithPassword(p string) Option    { return func(c *Conn) { c.password = p } }
func WithSSL(b bool) Option           { return func(c *Conn) { c.ssl = b } }
func WithDatabase(d string) Option    { return func(c *Conn) { c.database = d } }

func NewConn(driver string, opts ...Option) (*Conn, error) {
	if driver != "postgres" && driver != "mysql" {
		return nil, fmt.Errorf("NewConn: unsupported driver %q", driver)
	}
	c := &Conn{
		driver: driver,
		host:   "localhost",
		port:   5432,
		user:   "postgres",
	}
	for _, o := range opts {
		o(c)
	}
	if c.port < 1 || c.port > 65535 {
		return nil, fmt.Errorf("NewConn: port %d out of range", c.port)
	}
	if c.host == "" {
		return nil, errors.New("NewConn: host is empty")
	}
	return c, nil
}

func (c *Conn) DSN() string {
	mode := "disable"
	if c.ssl {
		mode = "require"
	}
	switch c.driver {
	case "postgres":
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
			c.user, c.password, c.host, c.port, c.database, mode)
	case "mysql":
		return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s", c.user, c.password, c.host, c.port, c.database)
	}
	return ""
}
```

</details>

**Discussion.** This is the canonical shape for *any* constructor that does some real work: required positional → options → validate-and-build. The driver string is positional because forgetting it should be a compile error; the port is an option because there's a sensible default.

---

## Task 4: Logger using closure-based functional options

Build a tiny `mylog` package. A logger has a `level` (`debug|info|warn|error`), an `output io.Writer`, and a `fields map[string]any` that gets attached to every log line. `WithFields` should *merge* additively across multiple calls.

**Acceptance criteria**

- [ ] `NewLogger(opts ...Option) *Logger`.
- [ ] Defaults: level `"info"`, output `os.Stderr`, no fields.
- [ ] `WithLevel(string) Option`, `WithOutput(io.Writer) Option`, `WithFields(map[string]any) Option`, `WithField(key string, val any) Option`.
- [ ] `WithFields` and `WithField` both merge into the existing field map; a duplicate key from a later call overwrites the earlier value.
- [ ] `Logger.Info(msg string)` writes a JSON line containing `level`, `msg`, and all configured fields.
- [ ] A test confirms that `NewLogger(WithField("a", 1), WithFields(map[string]any{"b": 2}), WithField("a", 3))` produces a log with `a=3` and `b=2`.

<details><summary>Hints</summary>

- The merge for `WithFields` is a `for k, v := range incoming { l.fields[k] = v }`.
- Be careful: if you store the caller's map directly (the §13.1 mistake from `middle.md`), mutations from the caller leak in. Copy.

</details>

<details><summary>Solution</summary>

```go
package mylog

import (
	"encoding/json"
	"io"
	"os"
)

type Logger struct {
	level  string
	out    io.Writer
	fields map[string]any
}

type Option func(*Logger)

func WithLevel(l string) Option {
	return func(lg *Logger) { lg.level = l }
}

func WithOutput(w io.Writer) Option {
	return func(lg *Logger) { lg.out = w }
}

func WithFields(f map[string]any) Option {
	return func(lg *Logger) {
		if lg.fields == nil {
			lg.fields = make(map[string]any, len(f))
		}
		for k, v := range f {
			lg.fields[k] = v
		}
	}
}

func WithField(key string, val any) Option {
	return func(lg *Logger) {
		if lg.fields == nil {
			lg.fields = make(map[string]any)
		}
		lg.fields[key] = val
	}
}

func NewLogger(opts ...Option) *Logger {
	l := &Logger{level: "info", out: os.Stderr}
	for _, o := range opts {
		o(l)
	}
	return l
}

func (l *Logger) Info(msg string) {
	entry := map[string]any{"level": l.level, "msg": msg}
	for k, v := range l.fields {
		entry[k] = v
	}
	_ = json.NewEncoder(l.out).Encode(entry)
}
```

</details>

**Discussion.** This is the first task where the *order* of options visibly matters: a later `WithField("a", 3)` overrides an earlier `WithField("a", 1)`. That's correct, and it matches §11.3 of `junior.md`. The contract is "later options win"; the constructor preserves the caller's order by walking the variadic slice front-to-back.

---

## Task 5: Worker pool with optional buffer size, max workers, and rate limit

Build a `pool` package. A `Pool` accepts work items via `Submit(func())` and runs them concurrently with a bounded number of workers and an optional rate limit (calls per second).

**Acceptance criteria**

- [ ] `NewPool(opts ...Option) *Pool`.
- [ ] Defaults: max workers `runtime.NumCPU()`, buffer size `0` (unbuffered), no rate limit.
- [ ] `WithMaxWorkers(int)`, `WithBufferSize(int)`, `WithRateLimit(perSecond int)`.
- [ ] `Pool.Start()` spins up workers, `Pool.Submit(fn func())` enqueues, `Pool.Stop()` drains and shuts down.
- [ ] A test confirms that with `WithMaxWorkers(2)` and 10 quick jobs, no more than 2 run concurrently.
- [ ] A test confirms that `WithRateLimit(10)` limits to ~10 jobs/second over 1 second (allow 20% tolerance).
- [ ] Constructor returns an error if `maxWorkers < 1` or `bufferSize < 0`. Therefore `NewPool` returns `(*Pool, error)`.

<details><summary>Hints</summary>

- Use a `chan func()` for the work queue. Buffer size becomes the channel capacity.
- For the rate limit, the cleanest implementation is `time.NewTicker(time.Second / time.Duration(perSecond))` and reading one tick per Submit.
- Track concurrency in tests with `atomic.Int32` and a high-water-mark variable.

</details>

<details><summary>Solution</summary>

```go
package pool

import (
	"errors"
	"runtime"
	"sync"
	"time"
)

type Pool struct {
	maxWorkers int
	bufSize    int
	rateLimit  int

	work chan func()
	wg   sync.WaitGroup
	tick *time.Ticker
}

type Option func(*Pool)

func WithMaxWorkers(n int) Option { return func(p *Pool) { p.maxWorkers = n } }
func WithBufferSize(n int) Option { return func(p *Pool) { p.bufSize = n } }
func WithRateLimit(n int) Option  { return func(p *Pool) { p.rateLimit = n } }

func NewPool(opts ...Option) (*Pool, error) {
	p := &Pool{maxWorkers: runtime.NumCPU(), bufSize: 0}
	for _, o := range opts {
		o(p)
	}
	if p.maxWorkers < 1 {
		return nil, errors.New("NewPool: maxWorkers must be >= 1")
	}
	if p.bufSize < 0 {
		return nil, errors.New("NewPool: bufferSize must be >= 0")
	}
	p.work = make(chan func(), p.bufSize)
	if p.rateLimit > 0 {
		p.tick = time.NewTicker(time.Second / time.Duration(p.rateLimit))
	}
	return p, nil
}

func (p *Pool) Start() {
	for i := 0; i < p.maxWorkers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for fn := range p.work {
				if p.tick != nil {
					<-p.tick.C
				}
				fn()
			}
		}()
	}
}

func (p *Pool) Submit(fn func()) { p.work <- fn }

func (p *Pool) Stop() {
	close(p.work)
	p.wg.Wait()
	if p.tick != nil {
		p.tick.Stop()
	}
}
```

</details>

**Discussion.** Notice how validation of *combinations* (`maxWorkers >= 1`, `bufSize >= 0`) happens after the loop, exactly as §7 of `middle.md` recommends. The rate limiter is allocated only when needed — keep allocations off the default path.

---

## Task 6: Metrics collector with options for sampling rate and batch size

Build a `metrics` package. A `Collector` accumulates `Record(name string, value float64)` calls and periodically flushes to an `io.Writer`. Options control sampling rate (0.0-1.0), batch size (flush every N records), and flush interval (flush every D duration).

**Acceptance criteria**

- [ ] `NewCollector(out io.Writer, opts ...Option) (*Collector, error)`.
- [ ] Defaults: sampling rate `1.0` (no sampling), batch size `100`, flush interval `5s`.
- [ ] `WithSamplingRate(float64)`, `WithBatchSize(int)`, `WithFlushInterval(time.Duration)`.
- [ ] Constructor returns an error if `samplingRate` is outside `[0, 1]` or `batchSize <= 0`.
- [ ] `Collector.Record(name, value)` is concurrency-safe.
- [ ] A test confirms that `WithSamplingRate(0.5)` retains roughly half of 10 000 records (allow 5% tolerance).
- [ ] A test confirms that `WithBatchSize(10)` triggers a flush after 10 records.

<details><summary>Hints</summary>

- For sampling: `rand.Float64() < samplingRate`. Seed with `rand.New(rand.NewSource(time.Now().UnixNano()))` for testability.
- Protect the buffer with a `sync.Mutex`.
- Use a `time.Ticker` for the flush interval.

</details>

<details><summary>Solution</summary>

```go
package metrics

import (
	"errors"
	"fmt"
	"io"
	"math/rand"
	"sync"
	"time"
)

type Collector struct {
	out          io.Writer
	samplingRate float64
	batchSize    int
	flushEvery   time.Duration

	mu    sync.Mutex
	buf   []string
	rng   *rand.Rand
	close chan struct{}
}

type Option func(*Collector)

func WithSamplingRate(r float64) Option   { return func(c *Collector) { c.samplingRate = r } }
func WithBatchSize(n int) Option          { return func(c *Collector) { c.batchSize = n } }
func WithFlushInterval(d time.Duration) Option {
	return func(c *Collector) { c.flushEvery = d }
}

func NewCollector(out io.Writer, opts ...Option) (*Collector, error) {
	c := &Collector{
		out:          out,
		samplingRate: 1.0,
		batchSize:    100,
		flushEvery:   5 * time.Second,
		rng:          rand.New(rand.NewSource(time.Now().UnixNano())),
		close:        make(chan struct{}),
	}
	for _, o := range opts {
		o(c)
	}
	if c.samplingRate < 0 || c.samplingRate > 1 {
		return nil, errors.New("samplingRate must be in [0,1]")
	}
	if c.batchSize <= 0 {
		return nil, errors.New("batchSize must be > 0")
	}
	go c.loop()
	return c, nil
}

func (c *Collector) Record(name string, value float64) {
	c.mu.Lock()
	if c.rng.Float64() < c.samplingRate {
		c.buf = append(c.buf, fmt.Sprintf("%s=%f", name, value))
		if len(c.buf) >= c.batchSize {
			c.flushLocked()
		}
	}
	c.mu.Unlock()
}

func (c *Collector) loop() {
	t := time.NewTicker(c.flushEvery)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			c.mu.Lock()
			c.flushLocked()
			c.mu.Unlock()
		case <-c.close:
			return
		}
	}
}

func (c *Collector) flushLocked() {
	for _, line := range c.buf {
		fmt.Fprintln(c.out, line)
	}
	c.buf = c.buf[:0]
}

func (c *Collector) Close() { close(c.close) }
```

</details>

**Discussion.** Sampling rate at `1.0` and an unbounded flush interval would produce a "no sampling, no flushing" collector — which is *almost* what you want as the default, but you also want timely output. The default value `5 * time.Second` is the kind of judgment call that has to live in your docs, not just your code.

---

## Task 7: Test fixture builder using functional options

In test code, you often need to construct objects with most fields at sensible defaults and one or two custom values per test. Use functional options for the fixture builder.

**Acceptance criteria**

- [ ] `type User struct { ID int; Name string; Email string; Role string; CreatedAt time.Time }`.
- [ ] `NewTestUser(opts ...UserOption) User` returns a fully-populated `User` with sensible defaults.
- [ ] Defaults: `ID=1, Name="alice", Email="alice@example.com", Role="user", CreatedAt=time.Now()`.
- [ ] Options: `WithID`, `WithName`, `WithEmail`, `WithRole`, `WithCreatedAt`.
- [ ] In a test, build five different users with one-line overrides per test.
- [ ] Add `WithAdmin()` as a sugar option that calls `WithRole("admin")` internally — show how to compose options.

<details><summary>Hints</summary>

- For the fixture pattern, `User` is a value type — the option type is `func(*User)`, but the constructor returns the value (not the pointer).
- `WithAdmin()` is just `return WithRole("admin")`. Composition by call.

</details>

<details><summary>Solution</summary>

```go
package fixtures

import "time"

type User struct {
	ID        int
	Name      string
	Email     string
	Role      string
	CreatedAt time.Time
}

type UserOption func(*User)

func WithID(id int) UserOption        { return func(u *User) { u.ID = id } }
func WithName(n string) UserOption    { return func(u *User) { u.Name = n } }
func WithEmail(e string) UserOption   { return func(u *User) { u.Email = e } }
func WithRole(r string) UserOption    { return func(u *User) { u.Role = r } }
func WithCreatedAt(t time.Time) UserOption {
	return func(u *User) { u.CreatedAt = t }
}

func WithAdmin() UserOption { return WithRole("admin") }

func NewTestUser(opts ...UserOption) User {
	u := User{
		ID:        1,
		Name:      "alice",
		Email:     "alice@example.com",
		Role:      "user",
		CreatedAt: time.Now(),
	}
	for _, o := range opts {
		o(&u)
	}
	return u
}

// Usage in a test:
//   u := NewTestUser(WithName("bob"), WithAdmin())
```

</details>

**Discussion.** Test fixtures are the *purest* use case for functional options. There are no defaults to evolve, no public API to keep stable, no validation needed. The win is purely ergonomic: one-liner overrides keep tests readable. The `WithAdmin()` sugar shows another reason to prefer functions over a config struct — sugar options compose without copying field values.

---

## Task 8: Generic options helper package (Go 1.18+)

Create a reusable `opt` package providing `Option[T]`, `Apply[T]`, `If[T]`, and `Combine[T]`. Use it to build a `Server` and a `Client` from the same package, demonstrating reuse.

**Acceptance criteria**

- [ ] `package opt` exposes:
  - `type Option[T any] func(*T)`
  - `func Apply[T any](t *T, opts []Option[T])`
  - `func If[T any](cond bool, o Option[T]) Option[T]`
  - `func Combine[T any](opts ...Option[T]) Option[T]`
- [ ] `Apply` skips `nil` entries.
- [ ] A `server` package defines `NewServer(addr string, opts ...opt.Option[Server]) *Server`.
- [ ] A `client` package defines `NewClient(baseURL string, opts ...opt.Option[Client]) *Client`.
- [ ] Both use `opt.Apply` instead of their own loop.
- [ ] Tests verify `If(false, ...)` doesn't apply, `If(true, ...)` does, and `Combine(a, b, c)` applies all three.

<details><summary>Hints</summary>

- The generic version is exactly the function variant of the pattern, with `T` substituted for the concrete struct.
- `Combine` returns a function that runs each child option in order — that's the trick that makes profiles work.

</details>

<details><summary>Solution</summary>

```go
// opt/opt.go
package opt

type Option[T any] func(*T)

func Apply[T any](t *T, opts []Option[T]) {
	for _, o := range opts {
		if o != nil {
			o(t)
		}
	}
}

func If[T any](cond bool, o Option[T]) Option[T] {
	return func(t *T) {
		if cond && o != nil {
			o(t)
		}
	}
}

func Combine[T any](opts ...Option[T]) Option[T] {
	return func(t *T) {
		for _, o := range opts {
			if o != nil {
				o(t)
			}
		}
	}
}
```

```go
// server/server.go
package server

import (
	"example.com/opt"
	"time"
)

type Server struct {
	Addr        string
	ReadTimeout time.Duration
}

func WithReadTimeout(d time.Duration) opt.Option[Server] {
	return func(s *Server) { s.ReadTimeout = d }
}

func NewServer(addr string, opts ...opt.Option[Server]) *Server {
	s := &Server{Addr: addr, ReadTimeout: 30 * time.Second}
	opt.Apply(s, opts)
	return s
}
```

```go
// client/client.go
package client

import "example.com/opt"

type Client struct {
	BaseURL string
	Retries int
}

func WithRetries(n int) opt.Option[Client] {
	return func(c *Client) { c.Retries = n }
}

func NewClient(baseURL string, opts ...opt.Option[Client]) *Client {
	c := &Client{BaseURL: baseURL}
	opt.Apply(c, opts)
	return c
}
```

</details>

**Discussion.** Re-read §6.1 of `middle.md`. The generic version doesn't save much code at the option-definition site; the win is the shared helpers (`If`, `Combine`, `Apply`) which you only have to write once. For a single-package library, this is overkill. For a codebase with 5+ option-taking types, it pays off.

---

## Task 9: Options with validation that returns errors

Convert the HTTP client from Task 2 to use the `func(*Client) error` variant. Validate `timeout > 0`, `retries >= 0`, and non-empty header keys *inside* the options.

**Acceptance criteria**

- [ ] `type Option func(*Client) error`.
- [ ] `WithTimeout(d time.Duration) Option` returns an error if `d <= 0`.
- [ ] `WithRetries(n int) Option` returns an error if `n < 0`.
- [ ] `WithHeader(key, value string) Option` returns an error if `key == ""`.
- [ ] `NewClient(baseURL string, opts ...Option) (*Client, error)` short-circuits on the first error.
- [ ] A test confirms that `NewClient("http://x", WithTimeout(-1))` returns `(nil, error)`.
- [ ] A test confirms that on error, subsequent options are *not* applied.

<details><summary>Hints</summary>

- Use `fmt.Errorf("WithTimeout: ...")` so the error message identifies the failing option.
- The constructor's loop is `for _, o := range opts { if err := o(c); err != nil { return nil, err } }`.

</details>

<details><summary>Solution</summary>

```go
package httpclient

import (
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	hc      *http.Client
	baseURL string
	headers map[string]string
	retries int
}

type Option func(*Client) error

func WithTimeout(d time.Duration) Option {
	return func(c *Client) error {
		if d <= 0 {
			return fmt.Errorf("WithTimeout: must be > 0, got %v", d)
		}
		c.hc.Timeout = d
		return nil
	}
}

func WithRetries(n int) Option {
	return func(c *Client) error {
		if n < 0 {
			return fmt.Errorf("WithRetries: must be >= 0, got %d", n)
		}
		c.retries = n
		return nil
	}
}

func WithHeader(key, value string) Option {
	return func(c *Client) error {
		if key == "" {
			return fmt.Errorf("WithHeader: key is empty")
		}
		if c.headers == nil {
			c.headers = make(map[string]string)
		}
		c.headers[key] = value
		return nil
	}
}

func NewClient(baseURL string, opts ...Option) (*Client, error) {
	c := &Client{
		hc:      &http.Client{Timeout: 30 * time.Second},
		baseURL: baseURL,
	}
	for _, o := range opts {
		if err := o(c); err != nil {
			return nil, err
		}
	}
	return c, nil
}
```

</details>

**Discussion.** Compare this with the original Task 2 client. The constructor signature changed from `*Client` to `(*Client, error)` — that's a breaking change for any caller. Reach for this variant only when **many** options can fail; for a single fallible option, prefer §4.1 of `middle.md` (defer to constructor).

---

## Task 10: Composing options into profiles

Building on Task 5 (the worker pool), define three "profiles" — `Production`, `Development`, `Testing` — that bundle related options. Show how to override one knob inside a profile at the call site.

**Acceptance criteria**

- [ ] Three exported functions or vars:
  - `Production() []Option` → many workers, big buffer, no rate limit.
  - `Development() []Option` → few workers, small buffer, generous logging.
  - `Testing() []Option` → 1 worker, unbuffered, rate-limit 1/sec to force ordering.
- [ ] Call site looks like `opts := append(Production(), WithMaxWorkers(8))`.
- [ ] A test verifies that the override wins (Production sets 64 workers; the override drops to 8).
- [ ] Optional: also implement `Combine(opts ...Option) Option` returning a single `Option` that runs each child — show both styles (slice-of-options vs single combined option).

<details><summary>Hints</summary>

- §5.1 of `middle.md`: later options override earlier ones because they run later in the loop.
- A profile is just `[]Option` returned by a function — nothing magical.

</details>

<details><summary>Solution</summary>

```go
package pool

func Production() []Option {
	return []Option{
		WithMaxWorkers(64),
		WithBufferSize(1024),
	}
}

func Development() []Option {
	return []Option{
		WithMaxWorkers(2),
		WithBufferSize(8),
	}
}

func Testing() []Option {
	return []Option{
		WithMaxWorkers(1),
		WithBufferSize(0),
		WithRateLimit(1),
	}
}

func Combine(opts ...Option) Option {
	return func(p *Pool) {
		for _, o := range opts {
			if o != nil {
				o(p)
			}
		}
	}
}

// Usage:
//   p, _ := NewPool(append(Production(), WithMaxWorkers(8))...)
//   // or with Combine:
//   p, _ := NewPool(Combine(Production()...), WithMaxWorkers(8))
```

</details>

**Discussion.** Profiles are how teams stop arguing about defaults. Document the profile once ("Production = 64 workers, 1024 buffer"), and call sites no longer specify each knob. The trick is that profiles compose with overrides: `append(Production(), WithMaxWorkers(8))` is a one-liner that says "production, but smaller". You cannot do that as elegantly with a config struct.

---

## Task 11: Building options from a JSON config file

Write a function that reads a JSON file and returns `[]Option` for the HTTP client from Task 2.

**Acceptance criteria**

- [ ] JSON shape:
  ```json
  {
    "timeout": "5s",
    "retries": 3,
    "headers": {"X-API-Key": "abc", "Accept": "application/json"}
  }
  ```
- [ ] `LoadOptions(path string) ([]Option, error)` reads, parses, and returns `[]Option`.
- [ ] Missing keys yield no option (i.e., the default applies).
- [ ] Parse `"5s"` as a `time.Duration` (use `time.ParseDuration`).
- [ ] A test confirms that loading a config with `timeout="2s"` and `retries=5` produces options equivalent to `WithTimeout(2*time.Second), WithRetries(5)`.

<details><summary>Hints</summary>

- Define an internal struct mirroring the JSON shape with `json` tags.
- For each non-zero / non-empty field in the parsed struct, append the corresponding option to the slice.
- Headers map → multiple `WithHeader` calls.

</details>

<details><summary>Solution</summary>

```go
package httpclient

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type jsonConfig struct {
	Timeout string            `json:"timeout"`
	Retries int               `json:"retries"`
	Headers map[string]string `json:"headers"`
}

func LoadOptions(path string) ([]Option, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("LoadOptions: %w", err)
	}
	var cfg jsonConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("LoadOptions: parse: %w", err)
	}
	var opts []Option
	if cfg.Timeout != "" {
		d, err := time.ParseDuration(cfg.Timeout)
		if err != nil {
			return nil, fmt.Errorf("LoadOptions: timeout: %w", err)
		}
		opts = append(opts, WithTimeout(d))
	}
	if cfg.Retries > 0 {
		opts = append(opts, WithRetries(cfg.Retries))
	}
	for k, v := range cfg.Headers {
		opts = append(opts, WithHeader(k, v))
	}
	return opts, nil
}
```

</details>

**Discussion.** This is the bridge between "compile-time configuration" (options at the call site) and "runtime configuration" (options loaded from a file). Notice the pattern: parse the file into a plain struct, then translate non-zero fields into options. The plain struct has the zero-value problem from `junior.md` §4.1 — `"retries": 0` is indistinguishable from "missing key". For libraries where that distinction matters, use `*int` (pointer) in the JSON struct so you can tell `null` from `0`.

---

## Task 12: Refactor a config-struct API to functional options

You inherit this code:

```go
package server

import "time"

type Config struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	MaxConns     int
	TLSEnabled   bool
}

func NewServer(c Config) *Server { /* ... */ return &Server{} }
```

Callers use `server.NewServer(server.Config{Addr: ":8080", ReadTimeout: 5 * time.Second})`. Refactor to functional options *without breaking existing callers* on the first commit; deprecate the old API on the second.

**Acceptance criteria**

- [ ] Commit 1: introduce `NewServerWith(addr string, opts ...Option) *Server` alongside the existing `NewServer(Config) *Server`. All existing callers compile unchanged.
- [ ] Commit 2: mark `Config` and `NewServer` with `// Deprecated: use NewServerWith` comments. `staticcheck` should flag them.
- [ ] Both functions produce identical `*Server` values for equivalent inputs.
- [ ] A test confirms parity:
  ```go
  s1 := NewServer(Config{Addr: ":8080", ReadTimeout: 5*time.Second})
  s2 := NewServerWith(":8080", WithReadTimeout(5*time.Second))
  assertEqual(*s1, *s2)
  ```

<details><summary>Hints</summary>

- The deprecated `// Deprecated:` comment is a specific format godoc and `staticcheck` recognise.
- Don't delete the old API in the same commit — that's the breaking change you're trying to avoid.

</details>

<details><summary>Solution</summary>

```go
// Commit 1: add the new API
package server

import "time"

type Server struct {
	addr         string
	readTimeout  time.Duration
	writeTimeout time.Duration
	maxConns     int
	tlsEnabled   bool
}

type Config struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	MaxConns     int
	TLSEnabled   bool
}

type Option func(*Server)

func WithReadTimeout(d time.Duration) Option  { return func(s *Server) { s.readTimeout = d } }
func WithWriteTimeout(d time.Duration) Option { return func(s *Server) { s.writeTimeout = d } }
func WithMaxConns(n int) Option               { return func(s *Server) { s.maxConns = n } }
func WithTLS() Option                         { return func(s *Server) { s.tlsEnabled = true } }

func NewServerWith(addr string, opts ...Option) *Server {
	s := &Server{
		addr:         addr,
		readTimeout:  30 * time.Second,
		writeTimeout: 30 * time.Second,
		maxConns:     100,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

func NewServer(c Config) *Server {
	var opts []Option
	if c.ReadTimeout != 0 {
		opts = append(opts, WithReadTimeout(c.ReadTimeout))
	}
	if c.WriteTimeout != 0 {
		opts = append(opts, WithWriteTimeout(c.WriteTimeout))
	}
	if c.MaxConns != 0 {
		opts = append(opts, WithMaxConns(c.MaxConns))
	}
	if c.TLSEnabled {
		opts = append(opts, WithTLS())
	}
	return NewServerWith(c.Addr, opts...)
}
```

```go
// Commit 2: deprecate the old API

// Deprecated: use NewServerWith and the WithX option functions.
type Config struct { /* ... unchanged ... */ }

// Deprecated: use NewServerWith.
func NewServer(c Config) *Server { /* ... unchanged ... */ }
```

</details>

**Discussion.** The two-step refactor — add new, route old through new, deprecate old — is the canonical way to evolve a Go API. Callers see no break in the first commit; the second commit only adds a vet warning. Six months later, you can delete the deprecated API in a major version bump. This is also a real-world example of where the bridge function (`NewServer(Config)` calling `NewServerWith`) converts old shape into options — exactly the same shape as Task 11's `LoadOptions` from a config file.

---

## Task 13: Implementing the interface variant of options

Rewrite the server from Task 12 using `type Option interface { apply(*Server) }`. Add one *unexported* option that external packages cannot construct.

**Acceptance criteria**

- [ ] `type Option interface { apply(*Server) }`.
- [ ] Public options: `WithReadTimeout`, `WithMaxConns`. Each returns an unexported struct that implements `apply`.
- [ ] An unexported option type `internalDebugOption` exists and is only usable from within the package (via, e.g., `internalWithDebug()`).
- [ ] A test in a *different* package imports `server` and constructs a `*Server` using the public options. It compiles.
- [ ] A test in the same package uses `internalWithDebug()` to enable debug mode. It also compiles.
- [ ] An external package cannot construct an `internalDebugOption` — write a comment in a test file demonstrating that `server.internalDebugOption{}` would fail to compile.

<details><summary>Hints</summary>

- §3.2 of `middle.md` is the recipe.
- Each `WithX` returns an instance of an unexported struct: `return readTimeoutOption{d: d}`.
- The unexported option's `apply` method is also unexported, so even reflective use is blocked.

</details>

<details><summary>Solution</summary>

```go
package server

import "time"

type Server struct {
	addr        string
	readTimeout time.Duration
	maxConns    int
	debug       bool
}

type Option interface {
	apply(*Server)
}

type readTimeoutOption struct{ d time.Duration }

func (o readTimeoutOption) apply(s *Server) { s.readTimeout = o.d }

func WithReadTimeout(d time.Duration) Option { return readTimeoutOption{d: d} }

type maxConnsOption struct{ n int }

func (o maxConnsOption) apply(s *Server) { s.maxConns = o.n }

func WithMaxConns(n int) Option { return maxConnsOption{n: n} }

// internal-only option
type internalDebugOption struct{}

func (internalDebugOption) apply(s *Server) { s.debug = true }

func internalWithDebug() Option { return internalDebugOption{} }

func NewServer(addr string, opts ...Option) *Server {
	s := &Server{addr: addr, readTimeout: 30 * time.Second, maxConns: 100}
	for _, o := range opts {
		o.apply(s)
	}
	return s
}
```

</details>

**Discussion.** The interface variant trades two extra lines per option for two real benefits: (1) options can be *unexported* — external packages cannot construct them, which is impossible with the function variant; (2) you can attach methods like `String()` to options for debugging. `grpc-go` chose this variant for exactly these reasons — `grpc.DialOption` is an interface so that `credentials`, `balancer`, and `keepalive` can each ship their own dial options without depending on internal types.

---

## Task 14: Cross-package options

Define a base `server` package with `ServerOption`. In a second package `serverext`, define additional options (e.g., metrics, tracing) that can be passed to the `server` constructor.

**Acceptance criteria**

- [ ] `server` package: `type Server struct`, `type Option interface { apply(*Server) }`, public function `Server.Set(field string, value any)` callable by external option providers.
- [ ] `serverext` package: imports `server`, defines `WithMetrics()` and `WithTracing()` which return `server.Option`.
- [ ] The `apply` method in `serverext` calls `Server.Set("metrics", true)` to communicate with the server.
- [ ] Main `package main` imports both `server` and `serverext`, builds a `Server` using a mix of options from both.
- [ ] A test verifies that `serverext.WithMetrics()` actually toggles the metrics flag inside the server.

<details><summary>Hints</summary>

- The function variant works too, but the interface variant makes cross-package option-passing natural — `serverext` just implements the interface.
- `Server.Set` is the controlled mutation surface that external packages use; private fields stay private.

</details>

<details><summary>Solution</summary>

```go
// server/server.go
package server

type Server struct {
	addr    string
	metrics bool
	tracing bool
}

type Option interface {
	apply(*Server)
}

func (s *Server) Set(field string, value any) {
	switch field {
	case "metrics":
		s.metrics = value.(bool)
	case "tracing":
		s.tracing = value.(bool)
	}
}

func (s *Server) Metrics() bool { return s.metrics }
func (s *Server) Tracing() bool { return s.tracing }

func NewServer(addr string, opts ...Option) *Server {
	s := &Server{addr: addr}
	for _, o := range opts {
		o.apply(s)
	}
	return s
}
```

```go
// serverext/serverext.go
package serverext

import "example.com/server"

type metricsOption struct{}

func (metricsOption) apply(s *server.Server) { s.Set("metrics", true) }

func WithMetrics() server.Option { return metricsOption{} }

type tracingOption struct{}

func (tracingOption) apply(s *server.Server) { s.Set("tracing", true) }

func WithTracing() server.Option { return tracingOption{} }
```

```go
// main.go
package main

import (
	"fmt"
	"example.com/server"
	"example.com/serverext"
)

func main() {
	s := server.NewServer(":8080",
		serverext.WithMetrics(),
		serverext.WithTracing(),
	)
	fmt.Println("metrics:", s.Metrics(), "tracing:", s.Tracing())
}
```

</details>

**Discussion.** `Server.Set(field, value)` is a *deliberate* compromise — you've widened the API surface to let third parties twiddle internal state. The alternative is exposing every field directly, which is worse. `grpc-go` solves this with a `dialOptions` struct passed through the option's `apply` method; the struct is exported within the module but not to outsiders. Read its [`dialoptions.go`](https://github.com/grpc/grpc-go/blob/master/dialoptions.go) for the production approach.

---

## Task 15: Hot-path optimisation — pre-compile options

You construct an `httpclient.Client` per request inside a hot loop (1 million times/sec). Each `WithX` call allocates a closure. Profile, identify the allocations, then refactor so the option closures are built once and reused.

**Acceptance criteria**

- [ ] A benchmark `BenchmarkClientNew` builds a client with 5 options per iteration. Note the `allocs/op` figure.
- [ ] A refactored version builds the same 5 options *once*, stores them in a package-level `[]Option`, and reuses the slice on each call. Note the new `allocs/op`.
- [ ] The optimised benchmark should show ~5 fewer allocs/op than the baseline.
- [ ] A doc comment explains why this only matters for hot paths (>1k constructions/sec) and that for normal use cases the optimisation is unnecessary.

<details><summary>Hints</summary>

- Each `WithTimeout(5*time.Second)` allocates a `func(*Client)` closure. The closure captures the duration.
- Hoisting `var defaultOpts = []Option{WithTimeout(5*time.Second), ...}` to package scope evaluates each `WithX` once at program start.

</details>

<details><summary>Solution</summary>

```go
package httpclient

import (
	"net/http"
	"time"
)

// Pre-built options for hot-path callers. Each entry is constructed once at
// init time; subsequent calls to NewClient(... defaultOpts...) reuse them.
var defaultOpts = []Option{
	WithTimeout(5 * time.Second),
	WithRetries(3),
	WithHeader("User-Agent", "hot-path/1.0"),
	WithHeader("Accept", "application/json"),
	WithTransport(&http.Transport{}),
}

// HotPathClient returns a Client using the pre-built option list.
// Use for callers that build many clients per second.
func HotPathClient(baseURL string) *Client {
	return NewClient(baseURL, defaultOpts...)
}

// Benchmark sketch:
//
//   func BenchmarkBaseline(b *testing.B) {
//       for i := 0; i < b.N; i++ {
//           _ = NewClient("http://x",
//               WithTimeout(5*time.Second),
//               WithRetries(3),
//               WithHeader("User-Agent", "x"),
//               WithHeader("Accept", "y"),
//               WithTransport(&http.Transport{}),
//           )
//       }
//   }
//   func BenchmarkHotPath(b *testing.B) {
//       for i := 0; i < b.N; i++ {
//           _ = HotPathClient("http://x")
//       }
//   }
```

</details>

**Discussion.** Re-read §12 of `middle.md`. Each `WithX` call allocates a ~16-32 byte closure. At 5 options × 1M calls/sec = 5M allocations/sec just for the options — measurable in a profile. The fix is to pay the allocation cost once at startup and reuse the slice. This is a real optimisation in only one situation: hot loops that construct configured objects repeatedly. For the typical "build a server at process start, run it forever" case, this optimisation is invisible.

---

## Task 16: Mini-project — build a small `httpserver` package

Compose everything. Build a `httpserver` package with the following public API:

```go
type Server struct { /* ... */ }
type Option interface { apply(*Server) }

func NewServer(addr string, opts ...Option) (*Server, error)
func (s *Server) Start(ctx context.Context) error

// Public options:
func WithReadTimeout(time.Duration) Option
func WithWriteTimeout(time.Duration) Option
func WithIdleTimeout(time.Duration) Option
func WithMaxHeaderBytes(int) Option
func WithTLS(certFile, keyFile string) Option        // returns error from constructor
func WithHandler(http.Handler) Option
func WithLogger(*slog.Logger) Option
func WithMiddleware(func(http.Handler) http.Handler) Option   // additive
func WithGracefulShutdown(time.Duration) Option

// Profiles:
func Production() []Option
func Development() []Option

// Loaders:
func LoadOptionsJSON(path string) ([]Option, error)
```

**Acceptance criteria**

- [ ] Use the interface variant (Task 13 style).
- [ ] `WithTLS` stores file paths; the constructor loads them and returns an error if loading fails (§4.1 of `middle.md`).
- [ ] `WithMiddleware` is additive — multiple calls produce a middleware chain in order.
- [ ] `WithHandler` defaults to a `404 Not Found` handler if never called.
- [ ] `Production()` profile sets sensible production defaults (timeouts 5s/10s/60s, 64 KiB max headers, 30s graceful shutdown).
- [ ] An integration test starts the server, sends a request through `httptest`, and verifies that middlewares run in the right order.
- [ ] All public functions have godoc comments.
- [ ] `go vet ./...` and `staticcheck ./...` are clean.

<details><summary>Solution sketch</summary>

```go
package httpserver

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

type Server struct {
	addr             string
	readTimeout      time.Duration
	writeTimeout     time.Duration
	idleTimeout      time.Duration
	maxHeaderBytes   int
	tlsCert          string
	tlsKey           string
	tlsConfig        *tls.Config
	handler          http.Handler
	logger           *slog.Logger
	middlewares      []func(http.Handler) http.Handler
	gracefulShutdown time.Duration

	httpSrv *http.Server
}

type Option interface{ apply(*Server) }

type optFn func(*Server)

func (f optFn) apply(s *Server) { f(s) }

func WithReadTimeout(d time.Duration) Option {
	return optFn(func(s *Server) { s.readTimeout = d })
}
func WithWriteTimeout(d time.Duration) Option {
	return optFn(func(s *Server) { s.writeTimeout = d })
}
func WithIdleTimeout(d time.Duration) Option {
	return optFn(func(s *Server) { s.idleTimeout = d })
}
func WithMaxHeaderBytes(n int) Option {
	return optFn(func(s *Server) { s.maxHeaderBytes = n })
}
func WithTLS(certFile, keyFile string) Option {
	return optFn(func(s *Server) { s.tlsCert, s.tlsKey = certFile, keyFile })
}
func WithHandler(h http.Handler) Option {
	return optFn(func(s *Server) { s.handler = h })
}
func WithLogger(l *slog.Logger) Option {
	return optFn(func(s *Server) { s.logger = l })
}
func WithMiddleware(m func(http.Handler) http.Handler) Option {
	return optFn(func(s *Server) { s.middlewares = append(s.middlewares, m) })
}
func WithGracefulShutdown(d time.Duration) Option {
	return optFn(func(s *Server) { s.gracefulShutdown = d })
}

func Production() []Option {
	return []Option{
		WithReadTimeout(5 * time.Second),
		WithWriteTimeout(10 * time.Second),
		WithIdleTimeout(60 * time.Second),
		WithMaxHeaderBytes(64 * 1024),
		WithGracefulShutdown(30 * time.Second),
	}
}

func Development() []Option {
	return []Option{
		WithReadTimeout(60 * time.Second),
		WithWriteTimeout(60 * time.Second),
		WithIdleTimeout(120 * time.Second),
	}
}

func NewServer(addr string, opts ...Option) (*Server, error) {
	if addr == "" {
		return nil, errors.New("NewServer: addr is required")
	}
	s := &Server{
		addr:             addr,
		readTimeout:      30 * time.Second,
		writeTimeout:     30 * time.Second,
		idleTimeout:      90 * time.Second,
		maxHeaderBytes:   1 << 20,
		handler:          http.NotFoundHandler(),
		logger:           slog.New(slog.NewTextHandler(os.Stderr, nil)),
		gracefulShutdown: 5 * time.Second,
	}
	for _, o := range opts {
		o.apply(s)
	}
	// Validation / construction past the loop.
	if s.tlsCert != "" {
		c, err := tls.LoadX509KeyPair(s.tlsCert, s.tlsKey)
		if err != nil {
			return nil, fmt.Errorf("NewServer: load TLS: %w", err)
		}
		s.tlsConfig = &tls.Config{Certificates: []tls.Certificate{c}}
	}
	// Wrap handler with middlewares in reverse so they run in caller order.
	h := s.handler
	for i := len(s.middlewares) - 1; i >= 0; i-- {
		h = s.middlewares[i](h)
	}
	s.httpSrv = &http.Server{
		Addr:           s.addr,
		Handler:        h,
		ReadTimeout:    s.readTimeout,
		WriteTimeout:   s.writeTimeout,
		IdleTimeout:    s.idleTimeout,
		MaxHeaderBytes: s.maxHeaderBytes,
		TLSConfig:      s.tlsConfig,
	}
	return s, nil
}

func (s *Server) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		if s.tlsConfig != nil {
			errCh <- s.httpSrv.ListenAndServeTLS("", "")
		} else {
			errCh <- s.httpSrv.ListenAndServe()
		}
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), s.gracefulShutdown)
		defer cancel()
		return s.httpSrv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
```

</details>

**Discussion.** This is the production shape. Every concept from the prior tasks shows up: required positional arg, defaults in the constructor literal, additive options (middlewares), file-loading deferred to the constructor (TLS), profiles, interface variant for future extensibility. Compare what you wrote against `net/http.Server` — note how the standard library uses a config struct because every field is conceptually orthogonal and the package is *the* server. You're building a *wrapper* around it, where options control how the wrapper is configured. Different layer, different pattern.

---

## Task 17: Read grpc-go's dial options

Open `grpc-go/dialoptions.go` and read it end-to-end. Write a 1-2 page description of the architecture — paste it into a `dialoptions-notes.md` file in your project.

**Acceptance criteria**

- [ ] You identify and describe:
  - The `DialOption` interface (note that it has both `apply` and `before` — what's the difference?).
  - The `EmptyDialOption` embedding trick used for default options.
  - The `funcDialOption` adapter that converts a `func(*dialOptions)` into a `DialOption`.
  - At least three concrete dial options of different shapes: `WithBlock` (no args), `WithTimeout` (one arg, deprecated), `WithTransportCredentials` (interface arg).
  - How options interact with `defaultDialOptions()` at the bottom of the file.
- [ ] You note one design choice that's *different* from what `junior.md` and `middle.md` showed — for example, the dual-method interface.
- [ ] You explain why grpc-go chose the interface variant.
- [ ] Bonus: identify one option you would simplify if you were writing it today.

<details><summary>Hints</summary>

- The file is at: https://github.com/grpc/grpc-go/blob/master/dialoptions.go
- The `before` method exists because some options need to mutate the dial options *before* the rest of the options apply. This is a real-world example of order-dependent options solved by extending the interface, not by relying on caller order.

</details>

**Discussion.** This is the most valuable task in the file. Reading production code teaches what dimensions of the pattern actually matter at scale: cross-package extensibility, evolution across versions, options that need to run in two phases, options that carry default behaviour, deprecation strategy. After reading it, the difference between the function variant (good enough for 90% of libraries) and the interface variant (necessary for the 10% that ship a public option ecosystem) will be obvious.

---

## Task 18: Find and fix three bugs in this options code

A junior engineer wrote this code. Three things are wrong. Find them, explain each one, and fix.

```go
package server

import (
	"log"
	"time"
)

var DefaultHeaders = map[string]string{"User-Agent": "default/1.0"}

type Server struct {
	readTimeout time.Duration
	logger      *log.Logger
	headers     map[string]string
}

type Option *func(*Server)

func WithReadTimeout(d time.Duration) Option {
	if d == 0 {
		d = 30 * time.Second
	}
	f := func(s *Server) { s.readTimeout = d }
	return &f
}

func WithLogger(l *log.Logger) Option {
	f := func(s *Server) { s.logger = l }
	return &f
}

func NewServer(opts ...Option) *Server {
	s := &Server{headers: DefaultHeaders}
	for _, o := range opts {
		(*o)(s)
	}
	return s
}
```

**Acceptance criteria**

- [ ] Identify Bug 1 (`Option` is a pointer to a function type — pointless).
- [ ] Identify Bug 2 (default lives inside `WithReadTimeout` — violates §7 of `junior.md`).
- [ ] Identify Bug 3 (`DefaultHeaders` is a shared mutable map — every Server points at the same one).
- [ ] Rewrite the package fixing all three.
- [ ] A test demonstrates each bug in the original and passes after the fix.

<details><summary>Solution</summary>

```go
package server

import (
	"log"
	"time"
)

type Server struct {
	readTimeout time.Duration
	logger      *log.Logger
	headers     map[string]string
}

type Option func(*Server)

func WithReadTimeout(d time.Duration) Option {
	return func(s *Server) { s.readTimeout = d }
}

func WithLogger(l *log.Logger) Option {
	return func(s *Server) { s.logger = l }
}

func NewServer(opts ...Option) *Server {
	s := &Server{
		readTimeout: 30 * time.Second,
		headers:     map[string]string{"User-Agent": "default/1.0"}, // per-instance copy
	}
	for _, o := range opts {
		o(s)
	}
	return s
}
```

Bugs:

1. `type Option *func(*Server)` — pointer to a function type. Functions in Go are already reference types (a closure is a pointer to a function descriptor plus a captured-variables pointer). Wrapping in `*` adds indirection and allocation for zero benefit. Use `type Option func(*Server)`.
2. `if d == 0 { d = 30 * time.Second }` inside `WithReadTimeout` — the default lives in the option, not the constructor. If the constructor's default later changes, callers who passed `WithReadTimeout(0)` get the wrong value. §7 of `junior.md`.
3. `DefaultHeaders` is a package-level mutable map. Every `Server` literal `&Server{headers: DefaultHeaders}` points at the same map. A test that mutates `server.headers["X"] = "y"` corrupts the global. §13.1 of `middle.md`.

</details>

**Discussion.** Code review training. The three bugs are the three most common mistakes in junior-written functional-options code. Once you can spot them in 30 seconds of reading, you've internalised the pattern.

---

## Task 19: Open-ended — design options for a TLS-aware reverse proxy

You're designing a `proxy` package: an HTTP reverse proxy with optional TLS, dynamic upstream lists, request transformation hooks, and per-upstream timeouts. No code required. Write a design doc (3-5 pages) that answers:

**Acceptance criteria**

- [ ] What is the constructor signature? What's positional, what's an option?
- [ ] Function variant or interface variant? Why?
- [ ] How are options grouped — flat options, or per-namespace (e.g., `proxy.Upstream(...)` sub-options)?
- [ ] How do dynamic upstream lists fit — as a closure-returning option, as a separate `Upstream` interface, or as an `Upstream(...)` chainable method on `*Proxy`?
- [ ] How do you validate that at least one upstream is configured?
- [ ] How do you support both "config from file" and "config from code" callers?
- [ ] What does the test fixture look like?

<details><summary>Discussion</summary>

This is intentionally open. There is no single right answer. A reasonable design: function variant (small surface), positional `addr` + variadic options, upstreams as additive `WithUpstream(name, url, opts...)` calls, per-upstream timeouts via the nested-option pattern from §8.3 of `middle.md`, validation in a constructor returning `(*Proxy, error)`. Compare your answer with how `traefik`, `caddy`, or `nginx`-style Go proxies (e.g., `oxy`, `vulcand`) structured their config. The exercise is for you to *defend* your choices against the trade-offs from `middle.md` §10.

</details>

---

## 20. Wrap-up

These nineteen tasks cover the full lifecycle of the functional-options pattern. You started with the smallest possible example (Calculator with two options) and ended designing a reverse-proxy config from first principles. Along the way you practised:

- The function variant (Tasks 1-7, 10-12, 15, 18)
- The interface variant (Tasks 13-14, 16-17)
- Generic options (Task 8)
- Error-returning options (Task 9)
- Profiles and composition (Tasks 10, 16)
- Runtime configuration (Tasks 11, 16)
- Refactoring legacy APIs (Task 12)
- Cross-package extension (Task 14)
- Hot-path optimisation (Task 15)
- Code review (Task 18)
- System design (Task 19)

If you can hand-write Task 16 from scratch without referencing `middle.md`, you've internalised the pattern. The next file is `senior.md`, which covers evolving option APIs across major versions, applying options to immutable types, and DSL-style options in real production Go libraries.

---

## Further reading

- `grpc-go/dialoptions.go` — https://github.com/grpc/grpc-go/blob/master/dialoptions.go
- `uber-go/zap/options.go` — https://github.com/uber-go/zap/blob/master/options.go
- `go-chi/chi` options — https://github.com/go-chi/chi
- Dave Cheney's original article — https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis
- Rob Pike's predecessor pattern — https://commandcenter.blogspot.com/2014/01/self-referential-functions-and-design.html
- Sibling pattern: [02-builder-pattern](../02-builder-pattern/)
