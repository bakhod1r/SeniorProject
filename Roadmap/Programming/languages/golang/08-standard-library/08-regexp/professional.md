# 8.8 `regexp` — Professional

> **Audience.** You're embedding `regexp` in a service that has SLOs.
> The patterns may come from operators, configuration, or even
> end-users; the inputs may be any size; allocations and tail-latency
> matter. This file is the production playbook: pattern caches,
> allocation-free hot paths, observability, and rejecting expensive
> patterns before they hit your matcher.

## 1. Pattern caches: when, how, and how much

If your service compiles patterns from external sources (rules
engine, config-driven router, search-by-pattern API), you do *not*
want to compile on every request. A pattern cache fixes this in
about ten lines:

```go
type patternCache struct {
    mu    sync.RWMutex
    items map[string]*regexp.Regexp
    cap   int
}

func (c *patternCache) Get(pattern string) (*regexp.Regexp, error) {
    c.mu.RLock()
    re, ok := c.items[pattern]
    c.mu.RUnlock()
    if ok {
        return re, nil
    }
    re, err := regexp.Compile(pattern)
    if err != nil {
        return nil, err
    }
    c.mu.Lock()
    if len(c.items) >= c.cap {
        for k := range c.items { // randomized eviction
            delete(c.items, k)
            break
        }
    }
    c.items[pattern] = re
    c.mu.Unlock()
    return re, nil
}
```

Notes for production:

- **Cap the size.** A naive cache grows unbounded if patterns come
  from request data. Set a cap based on memory budget and pattern
  count.
- **Evict simply.** Random eviction (above) is fine for most loads.
  LRU adds locking overhead; only use it if your access distribution
  is heavily skewed.
- **Cache compile errors too** — but with a shorter TTL. A bad
  pattern arriving in a hot loop shouldn't recompile and re-fail
  thousands of times per second.
- **Don't cache user-controlled patterns by default.** A million
  unique patterns from a million users will saturate the cache.
  Either cap at a small N with random eviction, or skip the cache
  for user input and only use compile-time-known patterns.

For static service-internal patterns, skip the cache: declare them
as `var` at package scope and forget about it.

## 2. Reject expensive patterns at the door

When patterns come from outside, set policies before you compile:

```go
const maxPatternLen = 1024

func compileBounded(pattern string) (*regexp.Regexp, error) {
    if len(pattern) > maxPatternLen {
        return nil, fmt.Errorf("pattern too long (max %d)", maxPatternLen)
    }
    if strings.Count(pattern, "|") > 100 {
        return nil, errors.New("too many alternatives")
    }
    return regexp.Compile(pattern)
}
```

The bounds depend on your workload. A search service that accepts
short user queries can cap at 256 bytes. An admin-configured
dispatch table might allow 4 KiB. The point is to refuse arbitrarily
large patterns: compile time is roughly linear-to-quadratic in
pattern length, and a 100 KiB pattern can take tens of milliseconds
to compile.

For inspecting more sophisticated cost (e.g., the size of the
compiled program), use `regexp/syntax`:

```go
import "regexp/syntax"

func patternComplexity(pattern string) (int, error) {
    parsed, err := syntax.Parse(pattern, syntax.Perl)
    if err != nil { return 0, err }
    prog, err := syntax.Compile(parsed)
    if err != nil { return 0, err }
    return len(prog.Inst), nil
}
```

A "size budget" of, say, 10,000 instructions is a reasonable cap for
pattern complexity. Anything larger usually indicates a malicious or
mistakenly-large pattern.

## 3. Allocation-free hot paths

A `*Regexp` method that returns string data allocates. `MatchString`
returns only a bool; it does not. The cheapest pattern for a hot
path:

```go
var hotRE = regexp.MustCompile(`...`)

func handle(input []byte) {
    if !hotRE.Match(input) { // []byte input, []byte API, no allocation
        return
    }
    // ...
}
```

When you do need data:

| Operation | Allocates |
|-----------|-----------|
| `Match([]byte)` / `MatchString(string)` | No (the bool path) |
| `FindIndex([]byte)` | One slice header (`[]int`) |
| `Find([]byte)` | One slice header (sub-slice of input — no copy) |
| `FindString(string)` | One string header (sub-string of input) |
| `FindSubmatch([]byte)` | One outer slice + one per submatch |
| `FindAllSubmatchIndex([]byte, -1)` | One outer slice + one `[]int` per match |
| `FindAllString(string, -1)` | One outer slice + one string per match |
| `ReplaceAllString` | One result string + intermediate buffers |

For a hot inner loop:

1. Use `[]byte` over `string` if your input is already `[]byte`.
2. Use `Match` over `Find` if you only need the bool.
3. Use `FindIndex` over `Find` if you need the location, not the
   text — and then slice the input directly.
4. For replace, walk indices manually rather than calling
   `ReplaceAllStringFunc`, which scans twice.

## 4. Streaming with backpressure

Logs, large NDJSON files, multi-gigabyte text dumps: don't load them
into memory.

```go
var lineRE = regexp.MustCompile(`^(\S+) (\S+) (\S+)`)

func processLog(ctx context.Context, r io.Reader) error {
    s := bufio.NewScanner(r)
    s.Buffer(make([]byte, 64*1024), 1<<20)
    for s.Scan() {
        if err := ctx.Err(); err != nil {
            return err
        }
        m := lineRE.FindSubmatchIndex(s.Bytes())
        if m == nil {
            continue
        }
        host := s.Bytes()[m[2]:m[3]]
        method := s.Bytes()[m[4]:m[5]]
        path := s.Bytes()[m[6]:m[7]]
        if err := emit(ctx, host, method, path); err != nil {
            return err
        }
    }
    return s.Err()
}
```

Three things this gets right:

1. **`s.Bytes()`** — a view, not a copy. The slice is valid until the
   next `Scan`. We pass it directly to the regex's `[]byte` API.
2. **`FindSubmatchIndex`** — returns positions, no string allocation.
3. **Context check inside the loop** — long-running scans are
   cancellable.

For pipelines of regex stages, the same pattern from
[`../01-io-and-file-handling/professional.md`](../01-io-and-file-handling/professional.md)
(pipeline staging with `io.Pipe`) lets you compose regex
transformations without intermediate buffers.

## 5. Concurrent matching against a single pattern

`*Regexp` is concurrency-safe. The internal state-pool means the
hottest pattern across thousands of goroutines doesn't bottleneck on
a mutex.

```go
var emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)

// Called from any number of goroutines, concurrently — fine.
func validateEmail(email string) bool {
    return emailRE.MatchString(email)
}
```

Don't try to "improve" this with a `sync.Pool` of `*Regexp` copies.
The package already pools the per-call state; an outer pool just adds
indirection without speeding up anything.

For *patterns from multiple sources* matched in a hot path, you do
benefit from grouping: combine related patterns into one alternation
when their semantics allow it. One match call against
`(?:p1)|(?:p2)|(?:p3)` is faster than three sequential match calls,
because the engine prunes inputs that match none of the alternatives
in a single pass.

```go
// Three checks
isMatch := re1.MatchString(s) || re2.MatchString(s) || re3.MatchString(s)

// One check (when the alternatives can be combined)
combined := regexp.MustCompile(`(?:` + p1 + `)|(?:` + p2 + `)|(?:` + p3 + `)`)
isMatch := combined.MatchString(s)
```

The combined form gives up the ability to know *which* alternative
matched. If you need that, capture each one and check the submatch
indices:

```go
combined := regexp.MustCompile(`(p1)|(p2)|(p3)`)
m := combined.FindStringSubmatchIndex(s)
switch {
case m == nil: // no match
case m[2] >= 0: // p1
case m[4] >= 0: // p2
case m[6] >= 0: // p3
}
```

## 6. Observability: counters, latencies, slow-pattern detection

For services that match a lot, log structured metrics around each
match:

| Metric | Why it matters |
|--------|----------------|
| Match attempts per second | Capacity planning, anomaly detection |
| Hit rate (matched / attempted) | Spot pattern drift or input distribution shift |
| Match latency p50/p95/p99 | Detect slow patterns or large inputs |
| Compile rate (cache misses) | Catch when a runaway client compiles unique patterns |
| Compile errors | Validate that user patterns are mostly valid |

Sample histogram instrumentation, kept light:

```go
type instrumentedRE struct {
    re      *regexp.Regexp
    matches *atomic.Int64
    hits    *atomic.Int64
    nanos   *atomic.Int64 // total nanos, divide by matches for avg
}

func (i *instrumentedRE) MatchString(s string) bool {
    start := time.Now()
    ok := i.re.MatchString(s)
    i.matches.Add(1)
    if ok { i.hits.Add(1) }
    i.nanos.Add(int64(time.Since(start)))
    return ok
}
```

`time.Since` is roughly 30 ns on modern Linux. For sub-microsecond
match calls, that's significant overhead — sample with `if rand.
Intn(100) == 0` if the call is in a tight loop.

A periodic reporter exports the deltas to Prometheus, OpenTelemetry,
or whatever your stack uses. Keep regex-specific labels (`pattern`,
`source`) low-cardinality — high-cardinality labels are the classic
metrics-explosion bug.

## 7. Slow-pattern hunting

When a regex-heavy service spikes in CPU, the question is "which
pattern is doing it?" Two practical approaches:

### Pattern-level CPU sampling

Wrap each compiled pattern in an `instrumentedRE` (above) and pivot
on the `matches`/`nanos` counters. The pattern with the highest
total nanos in the last interval is the suspect.

### `pprof` per-pattern attribution

Go's CPU profiler reports stacks but not pattern strings. To get
attribution, give each pattern its own thin wrapper *function* and
let the profiler distinguish them:

```go
//go:noinline
func matchUserAgent(s string) bool { return userAgentRE.MatchString(s) }

//go:noinline
func matchHostHeader(s string) bool { return hostHeaderRE.MatchString(s) }
```

The `//go:noinline` directive ensures the function appears in the
profile. Now `matchUserAgent` and `matchHostHeader` show up as
distinct call sites under the regex internals.

## 8. Anchoring and prefix scans for throughput

The biggest "free" win is an anchor or a literal prefix. RE2 detects
both and switches to a faster scan path.

```go
// Slow on a 100 MB log — checks every position
loose := regexp.MustCompile(`error\b`)

// Fast — Boyer-Moore-style scan for the literal "error", NFA only on hits
prefixed := regexp.MustCompile(`error\b`) // already has a literal prefix

// Faster still — anchored, NFA only at line start (with (?m)) or input start
anchored := regexp.MustCompile(`(?m)^error\b`)
```

Order of preference, when semantically equivalent:

1. Anchor at start of input or line.
2. Lead with a literal prefix.
3. Lead with a small character class.
4. Lead with `.` (the worst case — every position is a candidate).

The same pattern in different positions of a query has different
performance. If you control the framing, pick the anchored form.

## 9. Pre-filter with `strings.Contains` for high-throughput cases

For ultra-hot paths where most inputs *don't* match, a literal
pre-check beats the regex by a wide margin:

```go
var (
    fullPat = regexp.MustCompile(`(?i)\bfatal\b`)
    needle  = "fatal" // lowercase substring (we'll lowercase before checking)
)

func looksFatal(line string) bool {
    if !strings.Contains(strings.ToLower(line), needle) {
        return false
    }
    return fullPat.MatchString(line)
}
```

The `strings.Contains` short-circuit costs ~5-10 ns per line. The
regex costs ~100-500 ns. If 99% of lines fail the prefilter, the
average drops by 50-90%.

This is the same idea as `LiteralPrefix()` from
[middle.md](middle.md) section 10, but for cases where the pattern
isn't *entirely* literal but does have a substring you can check
cheaply.

## 10. Testing: golden regex tests

Regexes drift. The pattern that worked at deploy slowly stops
matching as inputs evolve. Catch the drift with golden tests:

```go
func TestErrorPattern_Examples(t *testing.T) {
    cases := []struct {
        in   string
        want bool
    }{
        {"ERROR: file not found", true},
        {"failed to open: error", true},
        {"warning: noisy", false},
        {"e.r.r.o.r evasion", false},
    }
    for _, tc := range cases {
        t.Run(tc.in, func(t *testing.T) {
            if got := errorRE.MatchString(tc.in); got != tc.want {
                t.Errorf("got %v want %v", got, tc.want)
            }
        })
    }
}
```

For high-stakes regexes (security filters, billing rules), include
*counter*-examples — strings that look like they should match but
shouldn't. Adversarial inputs in the test suite catch the drift in
both directions.

## 11. Fuzzing patterns and inputs

Go's `testing/fuzz` fits the use case nicely:

```go
func FuzzEmailRE(f *testing.F) {
    f.Add("alice@example.com")
    f.Add("invalid")
    f.Fuzz(func(t *testing.T, s string) {
        emailRE.MatchString(s) // never panics, never times out
    })
}
```

Because Go's regex is linear-time, you don't need a timeout in the
fuzz body. The matcher will complete on every input. Fuzzing exercises
the input space; pair it with `go test -fuzz=FuzzEmailRE -race` to
catch any goroutine-level surprises in your wrapper code.

For *pattern* fuzzing — checking that user-supplied patterns can't
crash your service — fuzz the compile path:

```go
func FuzzCompile(f *testing.F) {
    f.Add(`\d+`)
    f.Fuzz(func(t *testing.T, pattern string) {
        if len(pattern) > 1024 { return } // respect the bound
        re, err := regexp.Compile(pattern)
        if err != nil { return }
        re.MatchString("test")
    })
}
```

Any panic from `Compile` is a stdlib bug — report it. Any error is
fine; that's the contract for invalid patterns.

## 12. Compile-time analysis with `regexp/syntax`

For tools that vet patterns before they hit production
(linters, CI checks), `regexp/syntax` exposes the AST:

```go
func patternRisks(pattern string) []string {
    parsed, err := syntax.Parse(pattern, syntax.Perl)
    if err != nil { return []string{"invalid: " + err.Error()} }
    var risks []string
    var walk func(*syntax.Regexp)
    walk = func(r *syntax.Regexp) {
        if r.Op == syntax.OpStar || r.Op == syntax.OpPlus {
            // an unbounded quantifier — usually fine in RE2, but flag
            // for review if combined with .* nested in a capture
        }
        for _, sub := range r.Sub {
            walk(sub)
        }
    }
    walk(parsed)
    return risks
}
```

Use this to enforce house rules: "no unanchored patterns longer than
N characters," "no `(?i)` on patterns matching ASCII-only fields,"
etc.

## 13. Migrating from PCRE-flavored patterns

When you import patterns from a PCRE-flavored system (logstash, GitLab
CI, configurations from PHP/Perl/Python), watch for:

| PCRE feature | Go equivalent or workaround |
|--------------|------------------------------|
| Backreferences `\1` | None — restructure the match |
| Lookahead `(?=...)` | Often: capture the prefix, ignore in code |
| Lookbehind `(?<=...)` | Often: capture the suffix, ignore in code |
| Atomic groups `(?>...)` | Drop — RE2 doesn't backtrack anyway |
| Possessive quantifiers `a++` | Drop — same reason |
| Recursive patterns `(?R)` | None — use a real parser |
| Named groups `(?<name>...)` | Use `(?P<name>...)` |
| Unicode property `\pL`, `\p{Letter}` | Use `\p{L}` (RE2 spelling) |
| Comment `(?#...)` | Drop — split into separate constants |
| Inline `(?x)` extended mode | Drop — concatenate Go strings instead |

For each unsupported feature, consider whether a regex is the right
tool. If the pattern needs lookbehind because the grammar has true
context dependency (e.g., not matching `foo` after `not `), a
hand-written check is often cheaper *and* correct.

## 14. Handling untrusted patterns end-to-end

The full hardening for a service that accepts patterns from outside:

```go
type patternService struct {
    cache *patternCache
    cap   int
}

func (s *patternService) Match(ctx context.Context, pattern, input string) (bool, error) {
    if len(pattern) > 1024 {
        return false, errors.New("pattern too long")
    }
    if len(input) > 10<<20 {
        return false, errors.New("input too large")
    }
    re, err := s.cache.Get(pattern)
    if err != nil {
        return false, fmt.Errorf("pattern compile: %w", err)
    }
    type result struct {
        ok  bool
        err error
    }
    done := make(chan result, 1)
    go func() {
        done <- result{ok: re.MatchString(input)}
    }()
    select {
    case r := <-done:
        return r.ok, r.err
    case <-ctx.Done():
        return false, ctx.Err()
    }
}
```

Even though Go regex is linear-time and won't catastrophically
backtrack, very long inputs or pathologically large patterns can
still consume seconds of CPU. The context-bounded match in a
goroutine lets you cap latency without trusting the pattern author
to write efficiently.

The leaked goroutine (the background `re.MatchString` keeps running
until done) is acceptable for bounded inputs. For unbounded inputs,
you'd also need a way to cancel the match — which `regexp` doesn't
provide natively. Wrap the input in an `io.RuneReader` that returns
EOF when the context is cancelled, and use `MatchReader`:

```go
type ctxRuneReader struct {
    rr  io.RuneReader
    ctx context.Context
}

func (c *ctxRuneReader) ReadRune() (rune, int, error) {
    if err := c.ctx.Err(); err != nil { return 0, 0, err }
    return c.rr.ReadRune()
}

re.MatchReader(&ctxRuneReader{rr: bufio.NewReader(strings.NewReader(input)), ctx: ctx})
```

The matcher checks for EOF between rune reads, so the cancellation
takes effect within one rune of the context being done.

## 15. Logs, metrics, and the "regex spend"

In a typical Go service, regex CPU is measurable but rarely
dominant. A useful rough budget:

| Workload | Approx. regex CPU share |
|----------|-------------------------|
| HTTP routing (config-driven) | 1-5% |
| Log filtering / structured logging | 2-10% |
| Search / indexing | 10-30% |
| WAF / security filtering | 20-50% |
| User-supplied pattern matching | 40-80% (the regex *is* the workload) |

If your service is in the first three categories and regex is
showing >20% of CPU in `pprof`, something has gone wrong: a pattern
is uncached, an unanchored pattern is being applied to long
inputs, or a `ReplaceAllStringFunc` is being called per-line on a
high-throughput log stream. Investigate — usually one of the
patterns from this leaf will pay back the engineering time several
times over.

## 16. Reading: what to read next

- [optimize.md](optimize.md) — when correctness is fine and you
  need raw speed.
- [find-bug.md](find-bug.md) — drills targeting items in this file
  (caching, allocation, anchoring).
- [specification.md](specification.md) — the authoritative API
  reference.
