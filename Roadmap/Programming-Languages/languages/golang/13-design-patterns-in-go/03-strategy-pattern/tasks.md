# Strategy Pattern — Hands-on Tasks

Work through these in order. The first few drill the "function value or one-method interface, swapped at runtime" shape from `junior.md`. The middle tasks force the design decisions in `middle.md` — segregating interfaces, choosing between function and interface, registries, composition, generics, decorator-over-strategy. The last few are open-ended mini-projects.

Run every solution with `go vet ./...` and `go test ./...` before moving on. Each task is self-contained — copy the solution into a fresh directory, `go mod init scratch`, then iterate.

You need Go 1.21 or later. Tasks 13 and 19 use Go 1.18+ generics. Task 4 uses `net/http`. Task 5 uses `container/list`. Task 11 uses `regexp`. Task 17 includes a refactoring exercise — start from broken code, end with the strategy form.

---

## Task 1: Sort users by multiple criteria (warm-up)

A small directory page lets users sort by name, age, or signup date, ascending or descending. Implement a `SortUsers` function whose comparator is the strategy.

```go
users := []User{
    {Name: "Alice", Age: 30, Joined: time.Date(2021, 3, 1, 0, 0, 0, 0, time.UTC)},
    {Name: "Bob",   Age: 25, Joined: time.Date(2022, 1, 1, 0, 0, 0, 0, time.UTC)},
    {Name: "Carol", Age: 28, Joined: time.Date(2020, 6, 1, 0, 0, 0, 0, time.UTC)},
}

SortUsers(users, ByName)         // Alice, Bob, Carol
SortUsers(users, ByAgeDesc)      // Alice, Carol, Bob
SortUsers(users, ByJoinedAsc)    // Carol, Alice, Bob
```

**Acceptance criteria**

- [ ] `User` struct with `Name string`, `Age int`, `Joined time.Time`.
- [ ] Strategy type: `type LessFunc func(a, b User) bool`.
- [ ] Six exported strategies: `ByName`, `ByNameDesc`, `ByAge`, `ByAgeDesc`, `ByJoined`, `ByJoinedDesc`.
- [ ] `SortUsers(users []User, less LessFunc)` mutates the slice in place.
- [ ] A `Reverse(less LessFunc) LessFunc` helper produces a descending strategy from any ascending one.
- [ ] `main()` prints the three example outputs.

<details><summary>Hints</summary>

- `sort.Slice` already does the heavy lifting — your `SortUsers` is a thin wrapper that takes the strategy as a typed parameter.
- `Reverse` is a closure: `return func(a, b User) bool { return less(b, a) }`.
- The descending strategies (`ByNameDesc`, etc.) can be defined in terms of `Reverse(ByName)` to save typing.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sort"
	"time"
)

type User struct {
	Name   string
	Age    int
	Joined time.Time
}

type LessFunc func(a, b User) bool

func SortUsers(users []User, less LessFunc) {
	sort.Slice(users, func(i, j int) bool { return less(users[i], users[j]) })
}

func Reverse(less LessFunc) LessFunc {
	return func(a, b User) bool { return less(b, a) }
}

var (
	ByName       LessFunc = func(a, b User) bool { return a.Name < b.Name }
	ByNameDesc            = Reverse(ByName)
	ByAge        LessFunc = func(a, b User) bool { return a.Age < b.Age }
	ByAgeDesc             = Reverse(ByAge)
	ByJoined     LessFunc = func(a, b User) bool { return a.Joined.Before(b.Joined) }
	ByJoinedDesc          = Reverse(ByJoined)
)

func main() {
	users := []User{
		{"Alice", 30, time.Date(2021, 3, 1, 0, 0, 0, 0, time.UTC)},
		{"Bob", 25, time.Date(2022, 1, 1, 0, 0, 0, 0, time.UTC)},
		{"Carol", 28, time.Date(2020, 6, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, demo := range []struct {
		label string
		less  LessFunc
	}{
		{"ByName", ByName},
		{"ByAgeDesc", ByAgeDesc},
		{"ByJoined", ByJoined},
	} {
		cp := append([]User(nil), users...)
		SortUsers(cp, demo.less)
		fmt.Printf("%s: ", demo.label)
		for _, u := range cp {
			fmt.Printf("%s ", u.Name)
		}
		fmt.Println()
	}
}
```

</details>

**Discussion.** This is Strategy in its lightest weight. The strategy is a `func` type. There is no interface, no struct, no constructor. The `Reverse` helper shows a pattern that recurs: a strategy that *wraps* another strategy. It's a decorator, but the decorator is itself a function value, not a struct. When the strategy fits in one method, the function form composes more cleanly than the interface form.

---

## Task 2: CSV parser with pluggable delimiter

Parse CSV-ish text, but the delimiter rule is plugged in. Comma is the default; tab and semicolon are common; some real files use unusual rules like "any whitespace".

```go
records, err := Parse(input, Comma)         // standard CSV
records, err := Parse(input, Tab)           // TSV
records, err := Parse(input, Semicolon)     // German Excel
records, err := Parse(input, AnyWhitespace) // space- or tab-separated
```

**Acceptance criteria**

- [ ] Strategy type: `type Delimiter func(r rune) bool`. Returns true if the rune is a field separator.
- [ ] `Parse(text string, isDelim Delimiter) ([][]string, error)` returns rows of fields.
- [ ] Newline always ends a row; the delimiter strategy does not need to handle newlines.
- [ ] Built-in delimiters: `Comma`, `Tab`, `Semicolon`, `Pipe`, `AnyWhitespace`.
- [ ] Empty lines produce empty rows (no fields), not skipped.
- [ ] A test parses each delimiter style and asserts the field layout.

<details><summary>Hints</summary>

- Walk the string rune by rune. Maintain a `current` buffer for the field-in-progress.
- On delimiter, flush `current` into the row. On newline, flush, then close the row.
- `AnyWhitespace` is just `unicode.IsSpace`.

</details>

<details><summary>Solution</summary>

```go
package csvparse

import (
	"strings"
	"unicode"
)

type Delimiter func(r rune) bool

func Comma(r rune) bool         { return r == ',' }
func Tab(r rune) bool           { return r == '\t' }
func Semicolon(r rune) bool     { return r == ';' }
func Pipe(r rune) bool          { return r == '|' }
func AnyWhitespace(r rune) bool { return r != '\n' && unicode.IsSpace(r) }

func Parse(text string, isDelim Delimiter) ([][]string, error) {
	var rows [][]string
	var row []string
	var field strings.Builder
	flushField := func() {
		row = append(row, field.String())
		field.Reset()
	}
	flushRow := func() {
		flushField()
		rows = append(rows, row)
		row = nil
	}
	for _, r := range text {
		switch {
		case r == '\n':
			flushRow()
		case isDelim(r):
			flushField()
		default:
			field.WriteRune(r)
		}
	}
	// Last row, only if there is unflushed content.
	if field.Len() > 0 || len(row) > 0 {
		flushRow()
	}
	return rows, nil
}
```

</details>

**Discussion.** The strategy is one tiny function with a fixed signature. Anything more — a struct, a method, an interface — would be overkill. Notice how composing strategies is also trivial: `func(r rune) bool { return Comma(r) || Tab(r) }` accepts either separator with one line of code. The function form is built for this kind of cheap recombination.

---

## Task 3: Logger with pluggable formatters

A `Logger` that writes records, with the line format chosen at construction time. Three formats: human-readable text, JSON, and the Go test "console" style (red errors, dim levels).

```go
log := NewLogger(os.Stdout, TextFormatter{})
log.Info("user signed in", "user", "alice", "ip", "10.0.0.1")
// 2026-05-26 12:00:00 INFO user signed in user=alice ip=10.0.0.1

log := NewLogger(os.Stdout, JSONFormatter{})
log.Info("user signed in", "user", "alice")
// {"time":"2026-05-26T12:00:00Z","level":"INFO","msg":"user signed in","user":"alice"}
```

**Acceptance criteria**

- [ ] `Formatter` interface with one method: `Format(rec Record) []byte`.
- [ ] `Record` struct: `Time time.Time`, `Level string`, `Msg string`, `Fields map[string]any`.
- [ ] Three implementations: `TextFormatter`, `JSONFormatter`, `ConsoleFormatter` (with ANSI color codes).
- [ ] `Logger.Info/Warn/Error` accept `msg string, kv ...any` (alternating key/value).
- [ ] Odd `kv` is a programmer error — append `"!BADKEY"` so the log still goes out.
- [ ] `Logger` is safe for concurrent writes (one mutex).
- [ ] A test compares the formatted output for one record across all three formatters.

<details><summary>Hints</summary>

- Don't pre-build a deeply abstract `slog.Handler` analogue. The point is the strategy, not a feature-complete logger.
- For ANSI colors, `\x1b[31m` is red, `\x1b[0m` is reset.
- Parse `kv` once in the Logger; the formatter receives a `map[string]any` and doesn't worry about the variadic input.

</details>

<details><summary>Solution</summary>

```go
package logger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"sync"
	"time"
)

type Record struct {
	Time   time.Time
	Level  string
	Msg    string
	Fields map[string]any
}

type Formatter interface {
	Format(rec Record) []byte
}

type TextFormatter struct{}

func (TextFormatter) Format(r Record) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "%s %s %s", r.Time.Format("2006-01-02 15:04:05"), r.Level, r.Msg)
	keys := make([]string, 0, len(r.Fields))
	for k := range r.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, " %s=%v", k, r.Fields[k])
	}
	b.WriteByte('\n')
	return b.Bytes()
}

type JSONFormatter struct{}

func (JSONFormatter) Format(r Record) []byte {
	obj := map[string]any{
		"time":  r.Time.UTC().Format(time.RFC3339),
		"level": r.Level,
		"msg":   r.Msg,
	}
	for k, v := range r.Fields {
		obj[k] = v
	}
	out, _ := json.Marshal(obj)
	return append(out, '\n')
}

type ConsoleFormatter struct{}

func (ConsoleFormatter) Format(r Record) []byte {
	color := ""
	switch r.Level {
	case "ERROR":
		color = "\x1b[31m"
	case "WARN":
		color = "\x1b[33m"
	case "INFO":
		color = "\x1b[36m"
	}
	var b bytes.Buffer
	fmt.Fprintf(&b, "%s%s\x1b[0m %s", color, r.Level, r.Msg)
	keys := make([]string, 0, len(r.Fields))
	for k := range r.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, " \x1b[2m%s\x1b[0m=%v", k, r.Fields[k])
	}
	b.WriteByte('\n')
	return b.Bytes()
}

type Logger struct {
	mu  sync.Mutex
	w   io.Writer
	fmt Formatter
}

func NewLogger(w io.Writer, f Formatter) *Logger { return &Logger{w: w, fmt: f} }

func parseKV(kv []any) map[string]any {
	m := make(map[string]any, len(kv)/2)
	for i := 0; i < len(kv); i += 2 {
		k, ok := kv[i].(string)
		if !ok {
			k = "!BADKEY"
		}
		var v any = "!MISSING"
		if i+1 < len(kv) {
			v = kv[i+1]
		}
		m[k] = v
	}
	return m
}

func (l *Logger) log(level, msg string, kv []any) {
	rec := Record{Time: time.Now(), Level: level, Msg: msg, Fields: parseKV(kv)}
	out := l.fmt.Format(rec)
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = l.w.Write(out)
}

func (l *Logger) Info(msg string, kv ...any)  { l.log("INFO", msg, kv) }
func (l *Logger) Warn(msg string, kv ...any)  { l.log("WARN", msg, kv) }
func (l *Logger) Error(msg string, kv ...any) { l.log("ERROR", msg, kv) }
```

</details>

**Discussion.** `Formatter` has one method. We could have made it `type FormatFunc func(Record) []byte`. Either is fine. The interface version wins here for two reasons: implementations are *named* (a reader sees `TextFormatter`, not an anonymous closure), and you might later want a `Formatter` that holds state (a buffer pool, a precomputed time format). When that future is plausible, the interface form costs little. When it isn't, the func form is shorter.

---

## Task 4: HTTP client with pluggable auth

An `http.Client` wrapper that signs requests via a swappable authenticator. Support basic auth, bearer tokens, and a fake OAuth2 client-credentials flow.

```go
client := NewClient(http.DefaultClient, BasicAuth{User: "alice", Pass: "secret"})
client := NewClient(http.DefaultClient, BearerAuth{Token: "eyJhbGc..."})
client := NewClient(http.DefaultClient, NewOAuth2("https://auth.example.com/token", "client-id", "client-secret"))

resp, err := client.Do(req)
```

**Acceptance criteria**

- [ ] `Authenticator` interface: `Apply(req *http.Request) error`.
- [ ] `BasicAuth` sets the `Authorization` header from user/pass.
- [ ] `BearerAuth` sets `Authorization: Bearer <token>`.
- [ ] `OAuth2` fetches a token from a token endpoint on first use, caches it until expiry, refreshes when needed. It implements `Apply` and sets `Authorization: Bearer <token>` after refreshing.
- [ ] `Client.Do(req)` applies the authenticator then delegates to the underlying `http.Client.Do`.
- [ ] A test uses `httptest.NewServer` to assert each authenticator produces the right header.

<details><summary>Hints</summary>

- The OAuth2 implementation needs a mutex around the cached token.
- For the test, the OAuth2 token endpoint can return a tiny JSON object — `{"access_token":"...","expires_in":3600}`.
- Don't make `Authenticator` a function type. `OAuth2` needs state (the cached token), so an interface is the right shape.

</details>

<details><summary>Solution</summary>

```go
package authclient

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Authenticator interface {
	Apply(req *http.Request) error
}

type BasicAuth struct {
	User string
	Pass string
}

func (b BasicAuth) Apply(req *http.Request) error {
	tok := base64.StdEncoding.EncodeToString([]byte(b.User + ":" + b.Pass))
	req.Header.Set("Authorization", "Basic "+tok)
	return nil
}

type BearerAuth struct {
	Token string
}

func (b BearerAuth) Apply(req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+b.Token)
	return nil
}

type OAuth2 struct {
	endpoint     string
	clientID     string
	clientSecret string

	mu      sync.Mutex
	token   string
	expires time.Time
	hc      *http.Client
}

func NewOAuth2(endpoint, clientID, clientSecret string) *OAuth2 {
	return &OAuth2{endpoint: endpoint, clientID: clientID, clientSecret: clientSecret, hc: &http.Client{Timeout: 10 * time.Second}}
}

func (o *OAuth2) Apply(req *http.Request) error {
	tok, err := o.fetchToken()
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	return nil
}

func (o *OAuth2) fetchToken() (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.token != "" && time.Now().Before(o.expires) {
		return o.token, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {o.clientID},
		"client_secret": {o.clientSecret},
	}
	resp, err := o.hc.Post(o.endpoint, "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("OAuth2: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("OAuth2: decode: %w", err)
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("OAuth2: empty token")
	}
	o.token = body.AccessToken
	// Refresh slightly before expiry.
	o.expires = time.Now().Add(time.Duration(body.ExpiresIn-30) * time.Second)
	return o.token, nil
}

type Client struct {
	hc   *http.Client
	auth Authenticator
}

func NewClient(hc *http.Client, auth Authenticator) *Client {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &Client{hc: hc, auth: auth}
}

func (c *Client) Do(req *http.Request) (*http.Response, error) {
	if c.auth != nil {
		if err := c.auth.Apply(req); err != nil {
			return nil, err
		}
	}
	return c.hc.Do(req)
}
```

</details>

**Discussion.** `BasicAuth` and `BearerAuth` are stateless and tiny, but the interface form is still right here because `OAuth2` needs internal state (cached token, mutex, HTTP client for token fetching). Mixing function-typed and interface-typed strategies for the same role would be confusing. Consistency at one shape per role is worth more than micro-optimisation of "smallest possible code per implementation".

---

## Task 5: Cache with pluggable eviction policy

A bounded key-value cache. The eviction *strategy* — LRU, LFU, FIFO — is plugged in. Capacity is fixed at construction.

```go
c := NewCache(100, NewLRU())
c.Set("alice", 1)
c.Set("bob", 2)
v, ok := c.Get("alice") // moves alice to most-recently-used
```

**Acceptance criteria**

- [ ] `Cache` struct holds `map[string]any` and a `Policy`.
- [ ] `Policy` interface: `Touch(key string)`, `Add(key string)`, `Remove(key string)`, `Evict() string`.
- [ ] `LRU` evicts the least-recently-touched key.
- [ ] `LFU` evicts the least-frequently-used key.
- [ ] `FIFO` evicts the oldest-inserted key.
- [ ] `Cache.Set` evicts via the policy when at capacity. `Cache.Get` calls `Touch` (recording use).
- [ ] A test inserts N+1 keys into a cap-N cache for each policy and asserts the right key was evicted.

<details><summary>Hints</summary>

- LRU is easiest with `container/list` plus a `map[string]*list.Element`.
- LFU needs to track a frequency count per key — a `map[string]int` plus a way to find the min, like another map of `count -> set of keys`.
- FIFO is just a queue: `[]string` and pop from the front.
- The cache struct must coordinate `Policy` and the data map — when evict says "drop alice", the cache deletes from both the data map and tells the policy `Remove`.

</details>

<details><summary>Solution</summary>

```go
package cache

import (
	"container/list"
	"sync"
)

type Policy interface {
	Touch(key string)
	Add(key string)
	Remove(key string)
	Evict() string
}

// LRU

type LRU struct {
	order *list.List
	index map[string]*list.Element
}

func NewLRU() *LRU { return &LRU{order: list.New(), index: map[string]*list.Element{}} }

func (l *LRU) Touch(k string) {
	if el, ok := l.index[k]; ok {
		l.order.MoveToBack(el)
	}
}
func (l *LRU) Add(k string) { l.index[k] = l.order.PushBack(k) }
func (l *LRU) Remove(k string) {
	if el, ok := l.index[k]; ok {
		l.order.Remove(el)
		delete(l.index, k)
	}
}
func (l *LRU) Evict() string {
	front := l.order.Front()
	if front == nil {
		return ""
	}
	k := front.Value.(string)
	l.order.Remove(front)
	delete(l.index, k)
	return k
}

// LFU

type LFU struct {
	freq map[string]int
}

func NewLFU() *LFU { return &LFU{freq: map[string]int{}} }

func (l *LFU) Touch(k string) {
	if _, ok := l.freq[k]; ok {
		l.freq[k]++
	}
}
func (l *LFU) Add(k string)    { l.freq[k] = 1 }
func (l *LFU) Remove(k string) { delete(l.freq, k) }
func (l *LFU) Evict() string {
	var minKey string
	min := -1
	for k, v := range l.freq {
		if min == -1 || v < min {
			min = v
			minKey = k
		}
	}
	delete(l.freq, minKey)
	return minKey
}

// FIFO

type FIFO struct {
	order []string
}

func NewFIFO() *FIFO { return &FIFO{} }

func (f *FIFO) Touch(_ string) {}
func (f *FIFO) Add(k string)   { f.order = append(f.order, k) }
func (f *FIFO) Remove(k string) {
	for i, x := range f.order {
		if x == k {
			f.order = append(f.order[:i], f.order[i+1:]...)
			return
		}
	}
}
func (f *FIFO) Evict() string {
	if len(f.order) == 0 {
		return ""
	}
	k := f.order[0]
	f.order = f.order[1:]
	return k
}

// Cache

type Cache struct {
	mu       sync.Mutex
	data     map[string]any
	policy   Policy
	capacity int
}

func NewCache(cap int, p Policy) *Cache {
	return &Cache{data: map[string]any{}, policy: p, capacity: cap}
}

func (c *Cache) Set(k string, v any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.data[k]; ok {
		c.data[k] = v
		c.policy.Touch(k)
		return
	}
	if len(c.data) >= c.capacity {
		evicted := c.policy.Evict()
		if evicted != "" {
			delete(c.data, evicted)
		}
	}
	c.data[k] = v
	c.policy.Add(k)
}

func (c *Cache) Get(k string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.data[k]
	if ok {
		c.policy.Touch(k)
	}
	return v, ok
}
```

</details>

**Discussion.** The interface has four methods, and they have to work together — `Add` and `Remove` and `Evict` must stay consistent. That's the test of whether an interface is well-sized: every consumer needs all four, and no consumer needs more. If you found yourself wanting to add `Size()` or `Snapshot()`, that's interface creep — push those onto the concrete types instead. The `Cache` doesn't need them.

LFU's `O(n)` `Evict` is intentional. A real production LFU uses a frequency-bucket structure for `O(1)`, but that's an implementation detail of the strategy. The interface stays the same; you swap `NewLFU()` for `NewLFUFast()` without the `Cache` knowing.

---

## Task 6: Payment processor with multiple gateways

The textbook strategy example — but build it for *real*, with retries, idempotency, and the segregated `Charger` / `Refunder` / `Authorizer` interfaces from `middle.md` §3.

```go
stripe := NewStripeGateway(stripeKey)
p := NewProcessor(stripe)
charge, _ := p.Charge(ctx, Order{ID: "ord_1", AmountCents: 1000, Currency: "USD"})

// Refunds require the gateway to satisfy Refunder.
if r, ok := stripe.(Refunder); ok {
    r.Refund(ctx, charge.ID, 500) // partial refund
}
```

**Acceptance criteria**

- [ ] Three small interfaces in the `payment` package: `Charger`, `Refunder`, `Authorizer`.
- [ ] `StripeGateway` and `PayPalGateway` implement all three. `SquareGateway` implements only `Charger`.
- [ ] `Processor.Charge` accepts a `Charger`, validates the order (`AmountCents > 0`, non-empty `Currency`), and returns a `Charge` struct with the gateway's ID.
- [ ] All gateways simulate the call (no real network) but include random failures: 5% of calls return an error.
- [ ] A `RetryingCharger` decorator wraps any `Charger` and retries up to 3 times.
- [ ] A test asserts `Square` doesn't satisfy `Refunder` at *compile time* (use `var _ Refunder = (*SquareGateway)(nil)` in a `// +build ignore` file or just rely on the type assertion failing).
- [ ] `main()` charges via all three gateways, then refunds via Stripe.

<details><summary>Hints</summary>

- Use `math/rand` for the 5% failure simulation; seed it with a constant in tests for determinism.
- `RetryingCharger` is a struct holding an inner `Charger` and an attempt count. It implements `Charge` itself — that's the decorator pattern over a strategy interface.

</details>

<details><summary>Solution</summary>

```go
package payment

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
)

type Order struct {
	ID          string
	AmountCents int
	Currency    string
}

type Charge struct {
	ID      string
	Order   Order
	Gateway string
}

type Charger interface {
	Charge(ctx context.Context, o Order) (Charge, error)
}

type Refunder interface {
	Refund(ctx context.Context, chargeID string, amountCents int) error
}

type Authorizer interface {
	Authorize(ctx context.Context, o Order) (Charge, error)
}

// Gateways

type StripeGateway struct {
	key string
	rng *rand.Rand
}

func NewStripeGateway(key string) *StripeGateway {
	return &StripeGateway{key: key, rng: rand.New(rand.NewSource(1))}
}

func (s *StripeGateway) Charge(ctx context.Context, o Order) (Charge, error) {
	if s.rng.Float64() < 0.05 {
		return Charge{}, errors.New("stripe: transient")
	}
	return Charge{ID: "stripe_" + o.ID, Order: o, Gateway: "stripe"}, nil
}

func (s *StripeGateway) Refund(ctx context.Context, id string, amount int) error {
	return nil
}

func (s *StripeGateway) Authorize(ctx context.Context, o Order) (Charge, error) {
	return Charge{ID: "stripe_auth_" + o.ID, Order: o, Gateway: "stripe"}, nil
}

type PayPalGateway struct{ rng *rand.Rand }

func NewPayPalGateway() *PayPalGateway { return &PayPalGateway{rng: rand.New(rand.NewSource(2))} }
func (p *PayPalGateway) Charge(ctx context.Context, o Order) (Charge, error) {
	if p.rng.Float64() < 0.05 {
		return Charge{}, errors.New("paypal: transient")
	}
	return Charge{ID: "pp_" + o.ID, Order: o, Gateway: "paypal"}, nil
}
func (p *PayPalGateway) Refund(ctx context.Context, id string, amount int) error { return nil }
func (p *PayPalGateway) Authorize(ctx context.Context, o Order) (Charge, error) {
	return Charge{ID: "pp_auth_" + o.ID, Order: o, Gateway: "paypal"}, nil
}

type SquareGateway struct{}

func NewSquareGateway() *SquareGateway { return &SquareGateway{} }
func (s *SquareGateway) Charge(ctx context.Context, o Order) (Charge, error) {
	return Charge{ID: "sq_" + o.ID, Order: o, Gateway: "square"}, nil
}

// Processor

type Processor struct{ charger Charger }

func NewProcessor(c Charger) *Processor { return &Processor{charger: c} }

func (p *Processor) Charge(ctx context.Context, o Order) (Charge, error) {
	if o.AmountCents <= 0 {
		return Charge{}, errors.New("Charge: non-positive amount")
	}
	if o.Currency == "" {
		return Charge{}, errors.New("Charge: empty currency")
	}
	return p.charger.Charge(ctx, o)
}

// RetryingCharger — decorator over Charger

type RetryingCharger struct {
	Inner    Charger
	Attempts int
}

func (r *RetryingCharger) Charge(ctx context.Context, o Order) (Charge, error) {
	var lastErr error
	for i := 0; i < r.Attempts; i++ {
		c, err := r.Inner.Charge(ctx, o)
		if err == nil {
			return c, nil
		}
		lastErr = err
	}
	return Charge{}, fmt.Errorf("after %d attempts: %w", r.Attempts, lastErr)
}
```

</details>

**Discussion.** Three things worth noting:

1. `SquareGateway` *doesn't* implement `Refunder`. If your code needs refund, you accept `Refunder` and the compiler tells you "Square is not a Refunder". This is interface segregation paying off.
2. `RetryingCharger` is a *decorator over a strategy*. It implements the same interface as the underlying `Charger` and delegates with extra behaviour. Strategy and decorator pair naturally because both are about "this type satisfies the same interface".
3. The strategies hold their own state (`rng`). Function values can't easily do that — closures over `rng` work but they're awkward to share. Interfaces win when implementations need internal state.

---

## Task 7: Compression service with codec registry

A compression service that picks the codec by name at runtime. Support `gzip`, plus a fake `snappy` and `zstd` (you don't need real implementations — just simulate compression by base64-encoding).

```go
codec.Register("gzip", &gzipCodec{})
codec.Register("snappy", &snappyCodec{})
codec.Register("zstd", &zstdCodec{})

c, _ := codec.Get("gzip")
encoded := c.Encode([]byte("hello"))
decoded, _ := c.Decode(encoded)
```

**Acceptance criteria**

- [ ] `Codec` interface: `Encode([]byte) []byte`, `Decode([]byte) ([]byte, error)`, `Name() string`.
- [ ] Package-level `Register(name string, c Codec)` and `Get(name string) (Codec, error)`.
- [ ] `Register` panics on duplicate registration.
- [ ] `Get` returns an `error` for unknown codec names.
- [ ] `List() []string` returns known codec names in sorted order.
- [ ] One real codec: `gzip` using `compress/gzip`.
- [ ] Two fake codecs: `snappy` and `zstd` that just base64-encode/decode (simulating compression).
- [ ] A test registers all three and round-trips a payload through each.

<details><summary>Hints</summary>

- The registry is a `map[string]Codec` guarded by a `sync.RWMutex`.
- For `gzip`, use `bytes.Buffer` + `gzip.Writer` for encode, `gzip.NewReader` + `io.ReadAll` for decode.
- `init()` functions in sub-packages call `Register` to make codecs available.

</details>

<details><summary>Solution</summary>

```go
package codec

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sort"
	"sync"
)

type Codec interface {
	Encode([]byte) []byte
	Decode([]byte) ([]byte, error)
	Name() string
}

var (
	mu       sync.RWMutex
	registry = map[string]Codec{}
)

func Register(name string, c Codec) {
	mu.Lock()
	defer mu.Unlock()
	if _, dup := registry[name]; dup {
		panic("codec: duplicate registration for " + name)
	}
	registry[name] = c
}

func Get(name string) (Codec, error) {
	mu.RLock()
	defer mu.RUnlock()
	c, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("codec: unknown %q", name)
	}
	return c, nil
}

func List() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

type GzipCodec struct{}

func (GzipCodec) Name() string { return "gzip" }
func (GzipCodec) Encode(in []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(in)
	_ = w.Close()
	return buf.Bytes()
}
func (GzipCodec) Decode(in []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(in))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

type SnappyCodec struct{}

func (SnappyCodec) Name() string             { return "snappy" }
func (SnappyCodec) Encode(in []byte) []byte  { return []byte(base64.StdEncoding.EncodeToString(in)) }
func (SnappyCodec) Decode(in []byte) ([]byte, error) {
	out, err := base64.StdEncoding.DecodeString(string(in))
	if err != nil {
		return nil, errors.New("snappy: bad data")
	}
	return out, nil
}

type ZstdCodec struct{}

func (ZstdCodec) Name() string             { return "zstd" }
func (ZstdCodec) Encode(in []byte) []byte  { return []byte(base64.URLEncoding.EncodeToString(in)) }
func (ZstdCodec) Decode(in []byte) ([]byte, error) {
	return base64.URLEncoding.DecodeString(string(in))
}

func init() {
	Register("gzip", GzipCodec{})
	Register("snappy", SnappyCodec{})
	Register("zstd", ZstdCodec{})
}
```

</details>

**Discussion.** This is the registry pattern from `middle.md` §5. It buys you configuration-driven selection — your config file says `compression: zstd`, and the service picks the codec at runtime. The cost is global mutable state: tests that register a mock codec leak it into the next test. For new code, prefer explicit construction (`NewProcessor(GzipCodec{})`) unless you have a real need for name-based lookup; for legacy code where the registry is already established, this is the canonical shape.

---

## Task 8: Rate limiter with pluggable algorithm

A rate limiter where the algorithm — token bucket, leaky bucket, fixed window — is plugged in. The caller doesn't care which; the choice is configuration.

```go
limiter := NewLimiter(NewTokenBucket(10, time.Second))
if limiter.Allow() {
    handleRequest()
}
```

**Acceptance criteria**

- [ ] `Algorithm` interface: `Allow() bool`.
- [ ] `TokenBucket`: capacity N, refills at R tokens/sec. `Allow` consumes 1 if available.
- [ ] `LeakyBucket`: queue of size N; refills empty at R/sec. `Allow` adds a "drop"; returns false if full.
- [ ] `FixedWindow`: N requests per window of D duration. Window resets at boundaries.
- [ ] `Limiter` is a thin wrapper that delegates `Allow` to the algorithm.
- [ ] All implementations are safe for concurrent use (one mutex each).
- [ ] A test runs each algorithm at a known rate and asserts the allow/deny pattern.

<details><summary>Hints</summary>

- For `TokenBucket`, store `tokens float64` and the last refill timestamp. On `Allow`, compute elapsed × rate, add to tokens (capped at capacity), then try to consume 1.
- `LeakyBucket` is the inverse — start at 0, on `Allow` try to add 1 (capped at capacity), and a background ticker subtracts at the rate. For this exercise, instead of a goroutine, compute the drainage on demand from `time.Now()` — same trick as `TokenBucket`.
- `FixedWindow` is simplest: a counter that resets when `time.Now() / D` changes.

</details>

<details><summary>Solution</summary>

```go
package ratelimit

import (
	"sync"
	"time"
)

type Algorithm interface {
	Allow() bool
}

// TokenBucket

type TokenBucket struct {
	mu       sync.Mutex
	capacity float64
	rate     float64 // tokens per second
	tokens   float64
	last     time.Time
}

func NewTokenBucket(capacity int, perPeriod time.Duration) *TokenBucket {
	return &TokenBucket{
		capacity: float64(capacity),
		rate:     float64(capacity) / perPeriod.Seconds(),
		tokens:   float64(capacity),
		last:     time.Now(),
	}
}

func (t *TokenBucket) Allow() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(t.last).Seconds()
	t.tokens += elapsed * t.rate
	if t.tokens > t.capacity {
		t.tokens = t.capacity
	}
	t.last = now
	if t.tokens >= 1 {
		t.tokens--
		return true
	}
	return false
}

// LeakyBucket

type LeakyBucket struct {
	mu       sync.Mutex
	capacity float64
	rate     float64 // drips per second
	level    float64
	last     time.Time
}

func NewLeakyBucket(capacity int, perPeriod time.Duration) *LeakyBucket {
	return &LeakyBucket{
		capacity: float64(capacity),
		rate:     float64(capacity) / perPeriod.Seconds(),
		last:     time.Now(),
	}
}

func (l *LeakyBucket) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(l.last).Seconds()
	l.level -= elapsed * l.rate
	if l.level < 0 {
		l.level = 0
	}
	l.last = now
	if l.level+1 <= l.capacity {
		l.level++
		return true
	}
	return false
}

// FixedWindow

type FixedWindow struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	start  time.Time
	count  int
}

func NewFixedWindow(limit int, window time.Duration) *FixedWindow {
	return &FixedWindow{limit: limit, window: window, start: time.Now()}
}

func (f *FixedWindow) Allow() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	if now.Sub(f.start) >= f.window {
		f.start = now
		f.count = 0
	}
	if f.count < f.limit {
		f.count++
		return true
	}
	return false
}

// Limiter

type Limiter struct{ alg Algorithm }

func NewLimiter(a Algorithm) *Limiter { return &Limiter{alg: a} }
func (l *Limiter) Allow() bool        { return l.alg.Allow() }
```

</details>

**Discussion.** The `Limiter` is barely a wrapper — it just forwards to the algorithm. You might be tempted to inline it: pass the `Algorithm` directly. Don't. The wrapper is your point of extension: later you'll want `AllowN(int)`, or `Wait(ctx)`, or instrumentation that doesn't belong inside the algorithm. Once you have the wrapper, those grow naturally without touching every algorithm implementation.

This is the **Context** in the GoF Strategy diagram — the object that *uses* a strategy, providing the consumer-facing API and delegating the variable step. In Go we don't usually name it "Context" (the name is already taken), but the role is the same.

---

## Task 9: Retry executor with pluggable backoff

A retry helper where the wait-between-attempts strategy is plugged in.

```go
err := Retry(ctx, 5, ConstantBackoff(time.Second), func() error {
    return callFlakyAPI()
})

err := Retry(ctx, 5, ExponentialBackoff(100*time.Millisecond, 2.0), op)
err := Retry(ctx, 5, JitteredBackoff(100*time.Millisecond, 2.0), op)
```

**Acceptance criteria**

- [ ] Strategy type: `type Backoff func(attempt int) time.Duration`.
- [ ] `ConstantBackoff(d)` returns a closure that always returns `d`.
- [ ] `ExponentialBackoff(base, factor)` returns `base * factor^attempt`.
- [ ] `JitteredBackoff(base, factor)` adds full-jitter (`rand.Float64()`-scaled) to the exponential value.
- [ ] `Retry(ctx, attempts, backoff, op)` calls `op` up to `attempts` times; sleeps `backoff(attempt)` between tries; honors `ctx.Done()`.
- [ ] If `attempts` is reached, return the last error wrapped with the attempt count.
- [ ] A test asserts that an op that succeeds on attempt 3 makes exactly 3 calls.

<details><summary>Hints</summary>

- Use `time.NewTimer` rather than `time.Sleep` so the wait is cancelable via `ctx`.
- For jitter, `time.Duration(float64(d) * rand.Float64())` — between 0 and `d`.

</details>

<details><summary>Solution</summary>

```go
package retry

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"time"
)

type Backoff func(attempt int) time.Duration

func ConstantBackoff(d time.Duration) Backoff {
	return func(_ int) time.Duration { return d }
}

func ExponentialBackoff(base time.Duration, factor float64) Backoff {
	return func(attempt int) time.Duration {
		return time.Duration(float64(base) * math.Pow(factor, float64(attempt)))
	}
}

func JitteredBackoff(base time.Duration, factor float64) Backoff {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	return func(attempt int) time.Duration {
		expo := float64(base) * math.Pow(factor, float64(attempt))
		return time.Duration(expo * rng.Float64())
	}
}

func Retry(ctx context.Context, attempts int, backoff Backoff, op func() error) error {
	var lastErr error
	for i := 0; i < attempts; i++ {
		if err := op(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i == attempts-1 {
			break
		}
		wait := backoff(i)
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return fmt.Errorf("retry: context cancelled: %w", ctx.Err())
		case <-t.C:
		}
	}
	return fmt.Errorf("retry: failed after %d attempts: %w", attempts, lastErr)
}
```

</details>

**Discussion.** Three backoff functions, all closures, all closing over their configuration. The strategy *here* is a pure function value — no state, no methods, no interface. Notice that `JitteredBackoff` captures an `*rand.Rand` in the closure for deterministic-seedability in tests; closures are the most concise way to bind state without declaring a struct.

The signature `func(attempt int) time.Duration` is part of the contract. If you needed to communicate more (e.g., "skip retry on this error"), you'd promote to an interface or expand the function signature. Both are valid; pick the cheapest change that fits.

---

## Task 10: Notification system with multiple channels

A `Notifier` that sends a message via one or more channels (email, sms, slack, webhook). The channel implementation is the strategy.

```go
n := NewNotifier(EmailChannel{...}, SMSChannel{...}, SlackChannel{...})
n.Send(ctx, Message{To: "user_42", Subject: "Welcome", Body: "..."})
```

**Acceptance criteria**

- [ ] `Channel` interface: `Send(ctx context.Context, m Message) error`, `Name() string`.
- [ ] Four channels: `EmailChannel`, `SMSChannel`, `SlackChannel`, `WebhookChannel`. None need real implementations — just log to stdout and simulate failure 10% of the time.
- [ ] `Notifier.Send` fans out to all channels concurrently. Returns a `MultiError` aggregating per-channel errors.
- [ ] A `RouteByPriority` strategy returns a different channel set per message priority (e.g., critical → all channels; info → email only).
- [ ] A test asserts that a `Send` with 3 channels triggers 3 `Send` calls (use mocks).

<details><summary>Hints</summary>

- Use `sync.WaitGroup` and a buffered error channel for the fan-out.
- `MultiError` can be a slice of errors with an `Error()` method that joins them.
- The "route by priority" piece is a *higher-level strategy* — it picks which lower-level strategies to invoke.

</details>

<details><summary>Solution</summary>

```go
package notify

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"sync"
)

type Message struct {
	To       string
	Subject  string
	Body     string
	Priority string // "info", "warn", "critical"
}

type Channel interface {
	Send(ctx context.Context, m Message) error
	Name() string
}

type MultiError struct{ Errs []error }

func (m *MultiError) Error() string {
	parts := make([]string, len(m.Errs))
	for i, e := range m.Errs {
		parts[i] = e.Error()
	}
	return "multierror: " + strings.Join(parts, "; ")
}

// Channel implementations

type EmailChannel struct{ rng *rand.Rand }

func NewEmailChannel() *EmailChannel { return &EmailChannel{rng: rand.New(rand.NewSource(1))} }
func (e *EmailChannel) Name() string { return "email" }
func (e *EmailChannel) Send(ctx context.Context, m Message) error {
	if e.rng.Float64() < 0.1 {
		return errors.New("email: SMTP down")
	}
	fmt.Printf("[email -> %s] %s\n", m.To, m.Subject)
	return nil
}

type SMSChannel struct{ rng *rand.Rand }

func NewSMSChannel() *SMSChannel    { return &SMSChannel{rng: rand.New(rand.NewSource(2))} }
func (s *SMSChannel) Name() string  { return "sms" }
func (s *SMSChannel) Send(ctx context.Context, m Message) error {
	if s.rng.Float64() < 0.1 {
		return errors.New("sms: gateway timeout")
	}
	fmt.Printf("[sms -> %s] %s\n", m.To, m.Body)
	return nil
}

type SlackChannel struct{ Webhook string }

func (s SlackChannel) Name() string { return "slack" }
func (s SlackChannel) Send(ctx context.Context, m Message) error {
	fmt.Printf("[slack] %s\n", m.Body)
	return nil
}

type WebhookChannel struct{ URL string }

func (w WebhookChannel) Name() string { return "webhook" }
func (w WebhookChannel) Send(ctx context.Context, m Message) error {
	fmt.Printf("[webhook -> %s] %s\n", w.URL, m.Subject)
	return nil
}

// Notifier

type Notifier struct{ channels []Channel }

func NewNotifier(channels ...Channel) *Notifier { return &Notifier{channels: channels} }

func (n *Notifier) Send(ctx context.Context, m Message) error {
	var wg sync.WaitGroup
	errs := make(chan error, len(n.channels))
	for _, ch := range n.channels {
		wg.Add(1)
		go func(c Channel) {
			defer wg.Done()
			if err := c.Send(ctx, m); err != nil {
				errs <- fmt.Errorf("%s: %w", c.Name(), err)
			}
		}(ch)
	}
	wg.Wait()
	close(errs)
	me := &MultiError{}
	for e := range errs {
		me.Errs = append(me.Errs, e)
	}
	if len(me.Errs) == 0 {
		return nil
	}
	return me
}

// Higher-level: route by priority

type PriorityRouter struct {
	critical Channel
	warn     []Channel
	info     []Channel
}

func NewPriorityRouter(critical Channel, warn, info []Channel) *PriorityRouter {
	return &PriorityRouter{critical: critical, warn: warn, info: info}
}

func (r *PriorityRouter) Channels(m Message) []Channel {
	switch m.Priority {
	case "critical":
		return []Channel{r.critical}
	case "warn":
		return r.warn
	default:
		return r.info
	}
}
```

</details>

**Discussion.** Two levels of strategy. The lower level is "how do I deliver a message" — the `Channel`. The higher level is "which channels do I pick for this message" — the router. Both are strategies; both could be swapped. The router *uses* lower-level strategies as its data. This is composition without inheritance: small interfaces stack like Lego.

---

## Task 11: Validator framework with composable rules

Build a validator where each rule is a strategy and the validator chains them.

```go
v := NewValidator().
    Add("email", Email()).
    Add("age", Min(0), Max(150)).
    Add("name", NonEmpty(), MaxLen(100))

errs := v.Validate(map[string]any{"email": "alice@example.com", "age": 30, "name": "Alice"})
```

**Acceptance criteria**

- [ ] Strategy type: `type Rule func(value any) error`.
- [ ] Built-in rules: `NonEmpty()`, `MaxLen(n int)`, `Min(n int)`, `Max(n int)`, `Email()` (regex `[^@]+@[^@]+`), `Matches(re *regexp.Regexp)`.
- [ ] `Validator.Add(field string, rules ...Rule)` registers rules per field.
- [ ] `Validator.Validate(m map[string]any) map[string][]error` runs every rule on each field, accumulating errors.
- [ ] An absent field is *not* an error by default; rules apply only when the key exists.
- [ ] An additional `Required()` rule fails when the value is missing or zero.
- [ ] A test runs all built-in rules and asserts the right errors fire.

<details><summary>Hints</summary>

- Rules are pure functions. Composing them is just calling them in a loop.
- Rules return `error`, not `bool`, so they can report *why* something failed. `error == nil` means "pass".
- A `Required()` that detects "missing" needs a sentinel — use `value == nil`.

</details>

<details><summary>Solution</summary>

```go
package validate

import (
	"errors"
	"fmt"
	"regexp"
)

type Rule func(v any) error

func NonEmpty() Rule {
	return func(v any) error {
		s, ok := v.(string)
		if !ok {
			return errors.New("NonEmpty: not a string")
		}
		if s == "" {
			return errors.New("NonEmpty: empty")
		}
		return nil
	}
}

func MaxLen(n int) Rule {
	return func(v any) error {
		s, ok := v.(string)
		if !ok {
			return errors.New("MaxLen: not a string")
		}
		if len(s) > n {
			return fmt.Errorf("MaxLen: %d > %d", len(s), n)
		}
		return nil
	}
}

func Min(n int) Rule {
	return func(v any) error {
		x, ok := v.(int)
		if !ok {
			return errors.New("Min: not an int")
		}
		if x < n {
			return fmt.Errorf("Min: %d < %d", x, n)
		}
		return nil
	}
}

func Max(n int) Rule {
	return func(v any) error {
		x, ok := v.(int)
		if !ok {
			return errors.New("Max: not an int")
		}
		if x > n {
			return fmt.Errorf("Max: %d > %d", x, n)
		}
		return nil
	}
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func Email() Rule { return Matches(emailRe) }

func Matches(re *regexp.Regexp) Rule {
	return func(v any) error {
		s, ok := v.(string)
		if !ok {
			return errors.New("Matches: not a string")
		}
		if !re.MatchString(s) {
			return fmt.Errorf("Matches: %q does not match %s", s, re)
		}
		return nil
	}
}

func Required() Rule {
	return func(v any) error {
		if v == nil {
			return errors.New("Required: missing")
		}
		return nil
	}
}

type Validator struct{ rules map[string][]Rule }

func NewValidator() *Validator { return &Validator{rules: map[string][]Rule{}} }

func (v *Validator) Add(field string, rules ...Rule) *Validator {
	v.rules[field] = append(v.rules[field], rules...)
	return v
}

func (v *Validator) Validate(m map[string]any) map[string][]error {
	out := map[string][]error{}
	for field, rules := range v.rules {
		val, present := m[field]
		for _, rule := range rules {
			// Required runs even when absent; others skip.
			if !present {
				if err := rule(nil); err != nil {
					out[field] = append(out[field], err)
				}
				continue
			}
			if err := rule(val); err != nil {
				out[field] = append(out[field], err)
			}
		}
	}
	return out
}
```

</details>

**Discussion.** Every rule is a closure over its parameters. The Validator doesn't know about specific rule types — it just calls `rule(value)`. Adding a new rule means adding a new closure-returning function; nothing else changes. The function-shaped strategy is at its most powerful here because rules genuinely *are* single operations with a fixed signature.

This is also how libraries like `go-playground/validator` work under the hood, only with a struct-tag-driven API on top. The internals are exactly this pattern.

---

## Task 12: Middleware chain for HTTP handlers

`http.HandlerFunc` is already a strategy. Build a fluent middleware chain that wraps a base handler with arbitrary decorators.

```go
h := Chain(handleUsers).
    Use(LogMiddleware(logger)).
    Use(AuthMiddleware(authn)).
    Use(RecoverMiddleware()).
    Build()
http.Handle("/users", h)
```

**Acceptance criteria**

- [ ] `Middleware` type: `func(http.Handler) http.Handler`.
- [ ] `Chain(h http.Handler) *Builder` starts a chain.
- [ ] `Builder.Use(mw)` adds a middleware. Multiple `Use` calls compose in *call order* (first `Use` runs outermost).
- [ ] `Builder.Build()` returns an `http.Handler` wrapped by all middlewares.
- [ ] Three middlewares: `LogMiddleware` (logs method+path+duration), `AuthMiddleware` (returns 401 if `Authorization` header missing), `RecoverMiddleware` (catches panics, returns 500).
- [ ] A test using `httptest.NewRecorder` asserts the middlewares run in the right order.

<details><summary>Hints</summary>

- Apply middlewares in reverse order at build time so the *first* `Use` call wraps outermost: `for i := len(mws)-1; i >= 0; i--`.
- `Use` returns `*Builder` for chaining.
- `RecoverMiddleware` uses `defer recover()`.

</details>

<details><summary>Solution</summary>

```go
package middleware

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

type Middleware func(http.Handler) http.Handler

type Builder struct {
	base        http.Handler
	middlewares []Middleware
}

func Chain(h http.Handler) *Builder { return &Builder{base: h} }

func (b *Builder) Use(mw Middleware) *Builder {
	b.middlewares = append(b.middlewares, mw)
	return b
}

func (b *Builder) Build() http.Handler {
	h := b.base
	for i := len(b.middlewares) - 1; i >= 0; i-- {
		h = b.middlewares[i](h)
	}
	return h
}

// Concrete middlewares

func LogMiddleware(logger *log.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			next.ServeHTTP(w, r)
			logger.Printf("%s %s took %v", r.Method, r.URL.Path, time.Since(start))
		})
	}
}

func AuthMiddleware(authn func(*http.Request) bool) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !authn(r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RecoverMiddleware() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					http.Error(w, fmt.Sprintf("internal: %v", rec), http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
```

</details>

**Discussion.** Each middleware *is a strategy*, but the strategy's type is `func(http.Handler) http.Handler` — a higher-order function. It takes a handler (which itself is a strategy for handling a request) and returns a new one. This is exactly the decorator pattern composed with strategy: the wrapper implements the same interface as the wrapped.

`net/http`'s authors made `HandlerFunc` *and* `Handler` so both function-shaped and interface-shaped strategies fit the same slot. Once you internalise that trick (`middle.md` §4), middleware feels obvious — it's just the chained version.

---

## Task 13: Generic Map / Filter / Reduce (Go 1.18+)

Implement the trio of slice operations whose strategy is the per-element function.

```go
nums := []int{1, 2, 3, 4, 5}
doubled := Map(nums, func(x int) int { return x * 2 })       // [2 4 6 8 10]
evens   := Filter(nums, func(x int) bool { return x%2 == 0 }) // [2 4]
sum     := Reduce(nums, 0, func(a, b int) int { return a + b }) // 15

// Mix types:
names := Map(users, func(u User) string { return u.Name })
```

**Acceptance criteria**

- [ ] `Map[T, R any](in []T, fn func(T) R) []R`.
- [ ] `Filter[T any](in []T, fn func(T) bool) []T`.
- [ ] `Reduce[T, R any](in []T, init R, fn func(R, T) R) R`.
- [ ] All preserve order.
- [ ] A test calls each with int, string, and struct types.

<details><summary>Hints</summary>

- Map returns a fresh slice of length `len(in)`. Pre-allocate with `make([]R, len(in))`.
- Filter doesn't pre-allocate because the result length is unknown.
- Reduce iterates linearly, no pre-allocation.

</details>

<details><summary>Solution</summary>

```go
package sliceutil

func Map[T, R any](in []T, fn func(T) R) []R {
	out := make([]R, len(in))
	for i, v := range in {
		out[i] = fn(v)
	}
	return out
}

func Filter[T any](in []T, fn func(T) bool) []T {
	var out []T
	for _, v := range in {
		if fn(v) {
			out = append(out, v)
		}
	}
	return out
}

func Reduce[T, R any](in []T, init R, fn func(R, T) R) R {
	acc := init
	for _, v := range in {
		acc = fn(acc, v)
	}
	return acc
}
```

</details>

**Discussion.** This is Strategy + generics. The strategy is the per-element function; generics let it work across types. Before Go 1.18, you wrote `MapInts`, `MapStrings`, `MapUsers` and they all had the same body. Generics collapse the family.

Note what generics *don't* give you: methods can't be generic. You can't put `Map[R]` on a `Slice[T]` type — Go's generic methods can only use the type's parameters. For pipelines you stay with functions. `lo.Map(...)` (a popular library) makes this exact choice.

---

## Task 14: Pluggable resolver chain

A name resolver that tries strategies in order — local cache, DNS, hosts file — and returns the first hit. Compositions are themselves strategies (`middle.md` §6).

```go
r := ChainResolver{
    cacheResolver,
    NewDNSResolver(),
    NewHostsFileResolver("/etc/hosts"),
}
ip, err := r.Resolve("example.com")
```

**Acceptance criteria**

- [ ] `Resolver` interface: `Resolve(name string) (string, error)`.
- [ ] `ChainResolver []Resolver` implements `Resolver` by trying each in order.
- [ ] `CacheResolver` wraps another resolver with a TTL cache.
- [ ] `StaticResolver map[string]string` is a constant lookup.
- [ ] `DNSResolver` (fake) returns `"1.2.3.4"` for any name except `"unknown"` which errors.
- [ ] If all resolvers fail, `ChainResolver.Resolve` returns the last error wrapped.
- [ ] A test exercises a chain where the second resolver provides the answer; assert the first was tried first.

<details><summary>Hints</summary>

- `ChainResolver` doesn't need a struct — make it a named slice type with a method.
- For `CacheResolver`, store `map[string]struct{value string; expires time.Time}` plus a mutex.
- The "tried first" assertion can use a counter inside a fake resolver.

</details>

<details><summary>Solution</summary>

```go
package resolver

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

type Resolver interface {
	Resolve(name string) (string, error)
}

type ChainResolver []Resolver

func (cs ChainResolver) Resolve(name string) (string, error) {
	var lastErr error
	for _, r := range cs {
		v, err := r.Resolve(name)
		if err == nil {
			return v, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		return "", errors.New("ChainResolver: empty chain")
	}
	return "", fmt.Errorf("ChainResolver: %w", lastErr)
}

type StaticResolver map[string]string

func (s StaticResolver) Resolve(name string) (string, error) {
	v, ok := s[name]
	if !ok {
		return "", fmt.Errorf("Static: %q not found", name)
	}
	return v, nil
}

type DNSResolver struct{}

func NewDNSResolver() *DNSResolver { return &DNSResolver{} }

func (d *DNSResolver) Resolve(name string) (string, error) {
	if name == "unknown" {
		return "", errors.New("DNS: NXDOMAIN")
	}
	return "1.2.3.4", nil
}

type CacheResolver struct {
	inner Resolver
	ttl   time.Duration

	mu    sync.Mutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	value   string
	expires time.Time
}

func NewCacheResolver(inner Resolver, ttl time.Duration) *CacheResolver {
	return &CacheResolver{inner: inner, ttl: ttl, cache: map[string]cacheEntry{}}
}

func (c *CacheResolver) Resolve(name string) (string, error) {
	c.mu.Lock()
	if e, ok := c.cache[name]; ok && time.Now().Before(e.expires) {
		c.mu.Unlock()
		return e.value, nil
	}
	c.mu.Unlock()
	v, err := c.inner.Resolve(name)
	if err != nil {
		return "", err
	}
	c.mu.Lock()
	c.cache[name] = cacheEntry{value: v, expires: time.Now().Add(c.ttl)}
	c.mu.Unlock()
	return v, nil
}
```

</details>

**Discussion.** Two structural ideas in one task. First, `ChainResolver` *is* a strategy itself — it satisfies `Resolver` while delegating to a slice of `Resolver`s. The composition is invisible to callers; they pass a `ChainResolver` anywhere a `Resolver` is expected. Second, `CacheResolver` is a decorator. The pattern repeats: any wrapper that implements the same interface composes with both single strategies and chains.

Try this as a follow-up: define `FallbackResolver{Primary, Backup Resolver}` and prove that all four (Static, DNS, Cache, Fallback, plus Chain) can be nested arbitrarily.

---

## Task 15: Pluggable persistence layer

A user repository whose storage backend is the strategy. Support an in-memory implementation, a fake SQL implementation, and a fake key-value store.

```go
repo := NewUserRepo(NewMemoryStore())
repo := NewUserRepo(NewSQLStore(db))
repo := NewUserRepo(NewKVStore(client))

u, err := repo.Get(ctx, "user_1")
```

**Acceptance criteria**

- [ ] `Store` interface: `Get(ctx, id) (User, error)`, `Put(ctx, u User) error`, `Delete(ctx, id) error`, `List(ctx) ([]User, error)`.
- [ ] `MemoryStore` is real (uses a `map[string]User` and a mutex).
- [ ] `SQLStore` is a *fake* — store data in maps internally, but log SQL-like statements (`"SELECT * FROM users WHERE id = $1"`).
- [ ] `KVStore` is a fake — store data in maps; log `GET key`, `SET key value`.
- [ ] A test runs the same scenario (put, get, delete, list) against all three stores and asserts the same observable behaviour.
- [ ] A `NotFoundError` sentinel returned from `Get` on missing IDs; tests check via `errors.Is`.

<details><summary>Hints</summary>

- The "same behaviour" test is the value here — your `Store` contract is whatever the test exercises. If the test passes for all implementations, they're equivalent strategies.
- `errors.Is` requires either an exported sentinel error or an `Is(target error) bool` method.

</details>

<details><summary>Solution</summary>

```go
package storage

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type User struct {
	ID   string
	Name string
	Age  int
}

var ErrNotFound = errors.New("not found")

type Store interface {
	Get(ctx context.Context, id string) (User, error)
	Put(ctx context.Context, u User) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]User, error)
}

// MemoryStore

type MemoryStore struct {
	mu   sync.Mutex
	data map[string]User
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{data: map[string]User{}} }

func (m *MemoryStore) Get(_ context.Context, id string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.data[id]
	if !ok {
		return User{}, fmt.Errorf("memory: %w", ErrNotFound)
	}
	return u, nil
}
func (m *MemoryStore) Put(_ context.Context, u User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[u.ID] = u
	return nil
}
func (m *MemoryStore) Delete(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, id)
	return nil
}
func (m *MemoryStore) List(_ context.Context) ([]User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]User, 0, len(m.data))
	for _, u := range m.data {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// SQLStore — fake; logs statements

type SQLStore struct {
	mu   sync.Mutex
	data map[string]User
	Log  []string
}

func NewSQLStore() *SQLStore { return &SQLStore{data: map[string]User{}} }

func (s *SQLStore) log(stmt string) { s.Log = append(s.Log, stmt) }

func (s *SQLStore) Get(_ context.Context, id string) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.log(fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", id))
	u, ok := s.data[id]
	if !ok {
		return User{}, fmt.Errorf("sql: %w", ErrNotFound)
	}
	return u, nil
}
func (s *SQLStore) Put(_ context.Context, u User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.log(fmt.Sprintf("INSERT INTO users (id, name, age) VALUES ('%s', '%s', %d) ON CONFLICT UPDATE", u.ID, u.Name, u.Age))
	s.data[u.ID] = u
	return nil
}
func (s *SQLStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.log(fmt.Sprintf("DELETE FROM users WHERE id = '%s'", id))
	delete(s.data, id)
	return nil
}
func (s *SQLStore) List(_ context.Context) ([]User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.log("SELECT * FROM users")
	out := make([]User, 0, len(s.data))
	for _, u := range s.data {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// KVStore — fake; logs GET/SET

type KVStore struct {
	mu   sync.Mutex
	data map[string]User
	Log  []string
}

func NewKVStore() *KVStore { return &KVStore{data: map[string]User{}} }

func (k *KVStore) log(op string) { k.Log = append(k.Log, op) }

func (k *KVStore) Get(_ context.Context, id string) (User, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.log("GET user:" + id)
	u, ok := k.data[id]
	if !ok {
		return User{}, fmt.Errorf("kv: %w", ErrNotFound)
	}
	return u, nil
}
func (k *KVStore) Put(_ context.Context, u User) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.log("SET user:" + u.ID)
	k.data[u.ID] = u
	return nil
}
func (k *KVStore) Delete(_ context.Context, id string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.log("DEL user:" + id)
	delete(k.data, id)
	return nil
}
func (k *KVStore) List(_ context.Context) ([]User, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.log("SCAN user:*")
	out := make([]User, 0, len(k.data))
	for _, u := range k.data {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// UserRepo

type UserRepo struct{ s Store }

func NewUserRepo(s Store) *UserRepo { return &UserRepo{s: s} }

func (r *UserRepo) Get(ctx context.Context, id string) (User, error)    { return r.s.Get(ctx, id) }
func (r *UserRepo) Save(ctx context.Context, u User) error              { return r.s.Put(ctx, u) }
func (r *UserRepo) Delete(ctx context.Context, id string) error         { return r.s.Delete(ctx, id) }
func (r *UserRepo) All(ctx context.Context) ([]User, error)             { return r.s.List(ctx) }
```

</details>

**Discussion.** The repository pattern is Strategy in disguise. The repo is the consumer; the `Store` is the strategy. Different production setups need different stores — local dev wants `MemoryStore`, integration tests want a real SQL DB, production wants Postgres. The repo's API doesn't care.

The contract test ("same scenario passes against all stores") is the secret weapon. If you ever introduce a fourth store (`RedisStore`, `S3Store`), reuse the test. Any divergence reveals an unwritten assumption in the contract.

---

## Task 16: A/B test router with weighted strategies

A traffic router that splits requests across N strategies by weight. Useful for canary deploys, gradual rollouts, A/B experiments.

```go
r := NewRouter().
    Add(70, oldRecommender).
    Add(20, newRecommender).
    Add(10, experimentalRecommender)

for i := 0; i < 100; i++ {
    rec := r.Pick()
    items := rec.Recommend(userID)
}
// Approx: 70 calls to old, 20 to new, 10 to experimental.
```

**Acceptance criteria**

- [ ] `Recommender` interface: `Recommend(userID string) []string`.
- [ ] `Router.Add(weight int, r Recommender) *Router`. Weight must be `> 0`.
- [ ] `Router.Pick() Recommender` returns one of the registered recommenders, chosen by weight.
- [ ] `Router.PickFor(seed string) Recommender` is deterministic — same seed → same recommender. Useful for keeping a given user in the same A/B group.
- [ ] `Sum(weights)` overflow guard — refuse weights summing past `1<<30`.
- [ ] A test runs `Pick()` 10,000 times and asserts the distribution is within 5% of the expected split.

<details><summary>Hints</summary>

- `Pick()` is the running-sum trick: roll a random in `[0, total)`, walk the slice subtracting weights until you go negative.
- `PickFor(seed)` uses `hash/fnv` on the seed mod total.

</details>

<details><summary>Solution</summary>

```go
package abrouter

import (
	"errors"
	"hash/fnv"
	"math/rand"
	"sync"
)

type Recommender interface {
	Recommend(userID string) []string
}

type weighted struct {
	weight int
	r      Recommender
}

type Router struct {
	mu      sync.Mutex
	entries []weighted
	total   int
	rng     *rand.Rand
}

func NewRouter() *Router { return &Router{rng: rand.New(rand.NewSource(1))} }

func (r *Router) Add(weight int, rec Recommender) *Router {
	if weight <= 0 {
		panic("Add: non-positive weight")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.total+weight > 1<<30 {
		panic("Add: total weight overflow")
	}
	r.entries = append(r.entries, weighted{weight: weight, r: rec})
	r.total += weight
	return r
}

func (r *Router) Pick() Recommender {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.total == 0 {
		return nil
	}
	pick := r.rng.Intn(r.total)
	for _, e := range r.entries {
		pick -= e.weight
		if pick < 0 {
			return e.r
		}
	}
	return r.entries[len(r.entries)-1].r
}

func (r *Router) PickFor(seed string) Recommender {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.total == 0 {
		return nil
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(seed))
	pick := int(h.Sum32()) % r.total
	if pick < 0 {
		pick += r.total
	}
	for _, e := range r.entries {
		pick -= e.weight
		if pick < 0 {
			return e.r
		}
	}
	return r.entries[len(r.entries)-1].r
}

// Sample recommenders for demo

type StaticRecommender struct{ Items []string }

func (s StaticRecommender) Recommend(_ string) []string { return s.Items }

var _ = errors.New
```

</details>

**Discussion.** The router *is* a strategy. It satisfies whatever interface a "thing that recommends" satisfies, but internally it dispatches across multiple inner strategies by weight. This is dispatch pluralism: the strategy interface is the same; the choice of implementation is randomised.

`PickFor` is the production-critical extension. A/B tests need a user to consistently see the same variant across requests — otherwise you can't measure outcomes. Hashing the user ID into the same bucket every time gives consistency for free.

---

## Task 17: Refactor an enum-dispatch into a strategy interface

You inherit this code. Refactor it into idiomatic Strategy form. (Try the refactor yourself before reading the solution.)

**Starter (the "before"):**

```go
package shipping

import (
	"errors"
	"time"
)

type Carrier int

const (
	UPS Carrier = iota
	FedEx
	DHL
	USPS
)

type Quote struct {
	Carrier  Carrier
	Price    float64
	ETA      time.Time
}

func GetQuote(carrier Carrier, weightKg float64) (Quote, error) {
	switch carrier {
	case UPS:
		if weightKg > 70 {
			return Quote{}, errors.New("UPS: over 70kg")
		}
		return Quote{Carrier: UPS, Price: 5 + weightKg*0.5, ETA: time.Now().Add(3 * 24 * time.Hour)}, nil
	case FedEx:
		return Quote{Carrier: FedEx, Price: 8 + weightKg*0.7, ETA: time.Now().Add(2 * 24 * time.Hour)}, nil
	case DHL:
		if weightKg > 100 {
			return Quote{}, errors.New("DHL: over 100kg")
		}
		return Quote{Carrier: DHL, Price: 7 + weightKg*0.6, ETA: time.Now().Add(4 * 24 * time.Hour)}, nil
	case USPS:
		if weightKg > 30 {
			return Quote{}, errors.New("USPS: over 30kg")
		}
		return Quote{Carrier: USPS, Price: 3 + weightKg*0.4, ETA: time.Now().Add(5 * 24 * time.Hour)}, nil
	default:
		return Quote{}, errors.New("unknown carrier")
	}
}
```

**Acceptance criteria**

- [ ] Replace the `switch` with a `CarrierQuoter` interface and per-carrier implementations.
- [ ] Each carrier owns its rules (weight limit, price, ETA).
- [ ] `GetQuote(q CarrierQuoter, weightKg float64)` becomes a thin function — the strategy is the caller's choice.
- [ ] The `Carrier` enum is *removed* from the public API. Carriers are now identified by their concrete types or names returned via `Name() string`.
- [ ] Behaviour must remain identical — existing call sites can be updated, but a test pinning the original behaviour for each carrier must pass.
- [ ] Bonus: explain in one paragraph why this refactor is an improvement (or isn't).

<details><summary>Hints</summary>

- Pull each `case` into a struct. Move the body into a `Quote(weightKg) (Quote, error)` method.
- The struct fields are the per-carrier constants — flat-rate, per-kg, weight limit, days-to-arrival.
- Pin the original behaviour: write a test before refactoring that calls `GetQuote(UPS, 10)`, captures the result, then asserts the refactored `UPS{}.Quote(10)` produces the same numbers.

</details>

<details><summary>Solution</summary>

```go
package shipping

import (
	"errors"
	"fmt"
	"time"
)

// Strategy interface
type CarrierQuoter interface {
	Quote(weightKg float64) (Quote, error)
	Name() string
}

type Quote struct {
	Carrier string
	Price   float64
	ETA     time.Time
}

// Each carrier is a struct holding its parameters
type UPS struct{}

func (UPS) Name() string { return "UPS" }
func (UPS) Quote(w float64) (Quote, error) {
	if w > 70 {
		return Quote{}, fmt.Errorf("UPS: over 70kg")
	}
	return Quote{Carrier: "UPS", Price: 5 + w*0.5, ETA: time.Now().Add(3 * 24 * time.Hour)}, nil
}

type FedEx struct{}

func (FedEx) Name() string { return "FedEx" }
func (FedEx) Quote(w float64) (Quote, error) {
	return Quote{Carrier: "FedEx", Price: 8 + w*0.7, ETA: time.Now().Add(2 * 24 * time.Hour)}, nil
}

type DHL struct{}

func (DHL) Name() string { return "DHL" }
func (DHL) Quote(w float64) (Quote, error) {
	if w > 100 {
		return Quote{}, fmt.Errorf("DHL: over 100kg")
	}
	return Quote{Carrier: "DHL", Price: 7 + w*0.6, ETA: time.Now().Add(4 * 24 * time.Hour)}, nil
}

type USPS struct{}

func (USPS) Name() string { return "USPS" }
func (USPS) Quote(w float64) (Quote, error) {
	if w > 30 {
		return Quote{}, fmt.Errorf("USPS: over 30kg")
	}
	return Quote{Carrier: "USPS", Price: 3 + w*0.4, ETA: time.Now().Add(5 * 24 * time.Hour)}, nil
}

// GetQuote — kept as a thin facade for compatibility
func GetQuote(c CarrierQuoter, weightKg float64) (Quote, error) {
	if c == nil {
		return Quote{}, errors.New("GetQuote: nil carrier")
	}
	return c.Quote(weightKg)
}
```

</details>

**Discussion.** Three concrete wins from this refactor:

1. **Open for extension.** Adding `Aramex` is one new struct in a new file. The old `switch` would force editing `GetQuote`, risking touching every existing carrier's case.
2. **Per-carrier state.** If `FedEx` later needs an API key, you give the struct a field — the other carriers don't change. The enum form would have to thread the API key through every call.
3. **Compile-time checks.** Calling `GetQuote(nil, 10)` is a nil check. With the enum you have to remember the `default` case and the magic string error.

The cost: more files, more types, no central "list of all carriers". The trade is worth it when you have *more than two* cases or *any per-case state*. For exactly two cases with no state, the `switch` is fine — don't refactor prematurely.

---

## Task 18: Segregate a multi-method strategy into multiple interfaces

Start from a "monolithic" `Provider` interface and split it into segregated interfaces, then refactor the consumers.

**Starter (the "before"):**

```go
package storage

import (
	"context"
	"io"
)

type Provider interface {
	Read(ctx context.Context, key string) ([]byte, error)
	Write(ctx context.Context, key string, data []byte) error
	Delete(ctx context.Context, key string) error
	Stream(ctx context.Context, key string) (io.ReadCloser, error)
	Lock(ctx context.Context, key string) error
	Unlock(ctx context.Context, key string) error
	Subscribe(ctx context.Context, prefix string) (<-chan Event, error)
}

type Event struct{ Key string }

// Consumer 1
type Reader struct{ p Provider }
func (r *Reader) Get(ctx context.Context, k string) ([]byte, error) { return r.p.Read(ctx, k) }

// Consumer 2
type Writer struct{ p Provider }
func (w *Writer) Put(ctx context.Context, k string, v []byte) error { return w.p.Write(ctx, k, v) }

// Consumer 3
type Locker struct{ p Provider }
func (l *Locker) Acquire(ctx context.Context, k string) error { return l.p.Lock(ctx, k) }
```

**Acceptance criteria**

- [ ] Split `Provider` into `KVReader`, `KVWriter`, `Streamer`, `Lockerer`, `Subscriber`. Each interface has only the methods it needs.
- [ ] Each consumer (`Reader`, `Writer`, `Locker`) accepts the narrowest interface.
- [ ] A single concrete `RealProvider` satisfies *all* of the segregated interfaces (it has all the methods).
- [ ] Demonstrate a `ReadOnlyProvider` that satisfies only `KVReader` — and prove the type system rejects passing it to `Writer`.
- [ ] Write tests for each consumer that mock only the relevant interface.

<details><summary>Hints</summary>

- A type can implement many interfaces simultaneously. There's no "implements" keyword in Go; satisfaction is structural.
- Use `var _ KVReader = (*ReadOnlyProvider)(nil)` to assert interface satisfaction at compile time.

</details>

<details><summary>Solution</summary>

```go
package storage

import (
	"context"
	"errors"
	"io"
)

type Event struct{ Key string }

// Segregated interfaces

type KVReader interface {
	Read(ctx context.Context, key string) ([]byte, error)
}

type KVWriter interface {
	Write(ctx context.Context, key string, data []byte) error
	Delete(ctx context.Context, key string) error
}

type Streamer interface {
	Stream(ctx context.Context, key string) (io.ReadCloser, error)
}

type Lockerer interface {
	Lock(ctx context.Context, key string) error
	Unlock(ctx context.Context, key string) error
}

type Subscriber interface {
	Subscribe(ctx context.Context, prefix string) (<-chan Event, error)
}

// Consumers — each takes the narrowest interface

type Reader struct{ p KVReader }

func NewReader(p KVReader) *Reader                                       { return &Reader{p: p} }
func (r *Reader) Get(ctx context.Context, k string) ([]byte, error)      { return r.p.Read(ctx, k) }

type Writer struct{ p KVWriter }

func NewWriter(p KVWriter) *Writer                                       { return &Writer{p: p} }
func (w *Writer) Put(ctx context.Context, k string, v []byte) error      { return w.p.Write(ctx, k, v) }
func (w *Writer) Delete(ctx context.Context, k string) error             { return w.p.Delete(ctx, k) }

type Locker struct{ p Lockerer }

func NewLocker(p Lockerer) *Locker                                       { return &Locker{p: p} }
func (l *Locker) Acquire(ctx context.Context, k string) error            { return l.p.Lock(ctx, k) }
func (l *Locker) Release(ctx context.Context, k string) error            { return l.p.Unlock(ctx, k) }

// RealProvider satisfies all segregated interfaces

type RealProvider struct{}

func (RealProvider) Read(_ context.Context, _ string) ([]byte, error)          { return nil, nil }
func (RealProvider) Write(_ context.Context, _ string, _ []byte) error         { return nil }
func (RealProvider) Delete(_ context.Context, _ string) error                  { return nil }
func (RealProvider) Stream(_ context.Context, _ string) (io.ReadCloser, error) { return nil, nil }
func (RealProvider) Lock(_ context.Context, _ string) error                    { return nil }
func (RealProvider) Unlock(_ context.Context, _ string) error                  { return nil }
func (RealProvider) Subscribe(_ context.Context, _ string) (<-chan Event, error) {
	return nil, nil
}

// ReadOnlyProvider satisfies only KVReader

type ReadOnlyProvider struct{}

func (ReadOnlyProvider) Read(_ context.Context, _ string) ([]byte, error) { return nil, errors.New("ro") }

// Compile-time interface assertions
var (
	_ KVReader    = (*RealProvider)(nil)
	_ KVWriter    = (*RealProvider)(nil)
	_ Streamer    = (*RealProvider)(nil)
	_ Lockerer    = (*RealProvider)(nil)
	_ Subscriber  = (*RealProvider)(nil)
	_ KVReader    = (*ReadOnlyProvider)(nil)
)
```

</details>

**Discussion.** This is *Interface Segregation* in action. Three benefits beyond the obvious "smaller interface":

1. **Mocks shrink.** A test for `Writer` mocks one struct with two methods, not seven. Less code, fewer behaviour stubs.
2. **Read-only types compile-check correctly.** `NewWriter(readonly)` fails to compile because `ReadOnlyProvider` doesn't implement `KVWriter`. The bad code path is caught before deployment.
3. **Composition becomes intentional.** A "write-then-publish" service takes `KVWriter` *and* `Subscriber`, not "a Provider". The dependencies are visible at the type signature.

For libraries you publish, segregation is the default. For internal code with one consumer per interface, it's premature; you'd just stamp out a single small interface and skip the segregation. The signal "I need segregation" is *multiple consumers with divergent needs*.

---

## Task 19: Templating engine with pluggable functions

Build a small templating engine where the available functions are the strategy. Each function is a value in a `FuncMap` (just like `text/template`).

```go
funcs := FuncMap{
    "upper":  strings.ToUpper,
    "lower":  strings.ToLower,
    "repeat": func(s string, n int) string { return strings.Repeat(s, n) },
    "join":   func(sep string, items []string) string { return strings.Join(items, sep) },
}

t := New(funcs)
out, err := t.Render("Hello {{upper(name)}}!", map[string]any{"name": "alice"})
// → "Hello ALICE!"
```

**Acceptance criteria**

- [ ] `FuncMap` type: `map[string]any` where each value is a function with arbitrary signature.
- [ ] Templates have one syntax: `{{<expr>}}`. `<expr>` is either a variable name (`name`) or a function call (`fn(arg1, arg2)`).
- [ ] Arguments are parsed as: bare identifier (look up in data), single-quoted string, or integer.
- [ ] `Render(template, data)` substitutes each `{{...}}` with the evaluated result.
- [ ] Use `reflect` to call the function with the parsed arguments.
- [ ] Unknown function → error. Type mismatch → error.
- [ ] A test renders three templates using different functions.

<details><summary>Hints</summary>

- You don't need a real parser. A regex matching `{{[^}]+}}` plus splitting the inside on commas is enough.
- `reflect.ValueOf(fn).Call(args)` invokes a function reflectively. Each arg is a `reflect.Value`.
- For typed conversion of arguments, look at the function's `reflect.Type` (`In(i)`) and convert each parsed value accordingly.

</details>

<details><summary>Solution</summary>

```go
package template

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

type FuncMap map[string]any

type Template struct{ funcs FuncMap }

func New(funcs FuncMap) *Template { return &Template{funcs: funcs} }

var exprRe = regexp.MustCompile(`\{\{([^}]+)\}\}`)
var callRe = regexp.MustCompile(`^(\w+)\((.*)\)$`)

func (t *Template) Render(tpl string, data map[string]any) (string, error) {
	var err error
	out := exprRe.ReplaceAllStringFunc(tpl, func(match string) string {
		if err != nil {
			return ""
		}
		expr := strings.TrimSpace(match[2 : len(match)-2])
		v, e := t.eval(expr, data)
		if e != nil {
			err = e
			return ""
		}
		return fmt.Sprintf("%v", v)
	})
	return out, err
}

func (t *Template) eval(expr string, data map[string]any) (any, error) {
	if m := callRe.FindStringSubmatch(expr); m != nil {
		name := m[1]
		fn, ok := t.funcs[name]
		if !ok {
			return nil, fmt.Errorf("unknown function %q", name)
		}
		argList := splitArgs(m[2])
		args := make([]reflect.Value, len(argList))
		fnVal := reflect.ValueOf(fn)
		fnType := fnVal.Type()
		if fnType.NumIn() != len(argList) {
			return nil, fmt.Errorf("%s: want %d args, got %d", name, fnType.NumIn(), len(argList))
		}
		for i, raw := range argList {
			v, err := parseArg(raw, fnType.In(i), data)
			if err != nil {
				return nil, fmt.Errorf("%s arg %d: %w", name, i, err)
			}
			args[i] = v
		}
		results := fnVal.Call(args)
		return results[0].Interface(), nil
	}
	// Bare identifier lookup
	v, ok := data[expr]
	if !ok {
		return nil, fmt.Errorf("unknown name %q", expr)
	}
	return v, nil
}

func splitArgs(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func parseArg(raw string, want reflect.Type, data map[string]any) (reflect.Value, error) {
	if strings.HasPrefix(raw, "'") && strings.HasSuffix(raw, "'") {
		return reflect.ValueOf(raw[1 : len(raw)-1]), nil
	}
	if n, err := strconv.Atoi(raw); err == nil {
		return reflect.ValueOf(n), nil
	}
	if v, ok := data[raw]; ok {
		rv := reflect.ValueOf(v)
		if !rv.Type().AssignableTo(want) {
			return reflect.Value{}, fmt.Errorf("cannot use %T as %s", v, want)
		}
		return rv, nil
	}
	return reflect.Value{}, fmt.Errorf("cannot parse %q", raw)
}
```

</details>

**Discussion.** The `FuncMap` *is* a registry of strategies, but each strategy has a *different signature*. That's why we need reflection — we can't express "any function" in Go's type system without it. `text/template` and `html/template` use exactly this pattern; the standard library's `template.FuncMap` documentation is worth reading.

The pattern's cost is real: reflection is ~50× slower than a direct call, and errors surface at runtime, not compile time. For a templating language that's acceptable — flexibility is the product. For high-throughput business logic, prefer compile-time strategy registration (a `map[string]func(...)` with a fixed signature, no reflect).

---

## Task 20: Implement `sort.Interface` from scratch

The original strategy in Go's standard library. Implement your own `Interface` and a sort algorithm, then apply it to a custom type.

```go
type ByAge []User
func (a ByAge) Len() int           { return len(a) }
func (a ByAge) Less(i, j int) bool { return a[i].Age < a[j].Age }
func (a ByAge) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

mysort.Sort(ByAge(users))
```

**Acceptance criteria**

- [ ] Define `mysort.Interface` with three methods: `Len()`, `Less(i, j)`, `Swap(i, j)`.
- [ ] Implement `mysort.Sort(data Interface)` using quicksort or insertion sort.
- [ ] Add a `mysort.Slice(items any, less func(i, j int) bool)` helper that takes a slice plus a comparison function and sorts without requiring the caller to define an `Interface` type. Use `reflect`.
- [ ] Apply both to a `[]User` sorted by Age, then by Name.
- [ ] Bonus: implement `mysort.IsSorted(data Interface) bool` and write a test that uses property-based checks.

<details><summary>Hints</summary>

- Insertion sort is fine for this exercise — N² but small constant factor and easy to write.
- `mysort.Slice` is the "function-instead-of-interface" alternative form. Use reflection to swap elements.
- For `IsSorted`, walk the slice once: if any `Less(i+1, i)` is true, it's not sorted.

</details>

<details><summary>Solution</summary>

```go
package mysort

import (
	"fmt"
	"reflect"
)

type Interface interface {
	Len() int
	Less(i, j int) bool
	Swap(i, j int)
}

// Sort implements insertion sort using the Interface.
func Sort(data Interface) {
	n := data.Len()
	for i := 1; i < n; i++ {
		for j := i; j > 0 && data.Less(j, j-1); j-- {
			data.Swap(j, j-1)
		}
	}
}

// IsSorted returns true if data is in non-decreasing order.
func IsSorted(data Interface) bool {
	n := data.Len()
	for i := n - 1; i > 0; i-- {
		if data.Less(i, i-1) {
			return false
		}
	}
	return true
}

// Slice adapts a raw slice + less-func to the Interface using reflection.
func Slice(slicePtr any, less func(i, j int) bool) error {
	v := reflect.ValueOf(slicePtr)
	if v.Kind() != reflect.Slice {
		return fmt.Errorf("Slice: not a slice")
	}
	adapter := &sliceAdapter{v: v, less: less}
	Sort(adapter)
	return nil
}

type sliceAdapter struct {
	v    reflect.Value
	less func(i, j int) bool
}

func (s *sliceAdapter) Len() int           { return s.v.Len() }
func (s *sliceAdapter) Less(i, j int) bool { return s.less(i, j) }
func (s *sliceAdapter) Swap(i, j int) {
	a, b := s.v.Index(i), s.v.Index(j)
	tmp := reflect.New(a.Type()).Elem()
	tmp.Set(a)
	a.Set(b)
	b.Set(tmp)
}
```

Usage:

```go
package main

import (
	"fmt"

	"scratch/mysort"
)

type User struct {
	Name string
	Age  int
}

type ByAge []User

func (a ByAge) Len() int           { return len(a) }
func (a ByAge) Less(i, j int) bool { return a[i].Age < a[j].Age }
func (a ByAge) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

func main() {
	users := []User{{"Alice", 30}, {"Bob", 25}, {"Carol", 28}}

	// Interface form
	mysort.Sort(ByAge(users))
	fmt.Println(users)

	// Function form via reflection
	_ = mysort.Slice(users, func(i, j int) bool { return users[i].Name < users[j].Name })
	fmt.Println(users)

	fmt.Println("sorted?", mysort.IsSorted(ByAge(users)))
}
```

</details>

**Discussion.** This is the *whole pattern* in three methods. `Interface` is the strategy contract. `Sort` is the algorithm that uses the strategy. `ByAge` is one concrete strategy; another type `ByName` would be another. The function-form `Slice` is the same trick `http.HandlerFunc` uses — adapt a closure into something that satisfies the interface.

Now you've reimplemented one of the most-used pieces of the Go standard library. Look at the real `sort` package source after finishing — it's a few hundred lines including all the optimisations (introsort, ZFunc, fast paths for small slices). The strategy *interface* is the same as yours; the algorithm is just bigger.

---

## Where to go from here

You've covered:

- Function-shaped strategies (Tasks 1, 2, 9, 11, 13, 16).
- Interface-shaped strategies with single methods (Tasks 3, 4).
- Multi-method interfaces and segregation (Tasks 5, 6, 15, 18).
- Strategy + decorator composition (Tasks 6, 12, 14).
- Registries (Task 7).
- Generic strategies (Task 13).
- Refactoring switch-dispatch into strategies (Task 17).
- A small templating engine and a from-scratch `sort.Interface` (Tasks 19, 20).

Next, read `senior.md` (when it lands) for architecture-level concerns: strategy reload at runtime, versioning the contract across major releases, observability for "which strategy ran when", and case studies in the standard library (`crypto/cipher`, `database/sql` drivers, `compress/*`, gRPC interceptors). Then visit `../04-decorator-pattern/` — once you can write strategies fluently, decorator becomes the natural next pattern, because every decorator implements the same interface as the strategy it wraps.
