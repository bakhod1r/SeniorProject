---
layout: default
title: Fuzzing — Find the Bug
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/find-bug/
---

# Fuzzing — Find the Bug

[← Back](../)

Each block below is a fuzz target that compiles and runs but is *broken* in a subtle way. The bug is in the fuzz target itself — in how the target is written, not in the system under test. Read each block carefully, predict what will go wrong, and then read the explanation.

## Trap 1 — Non-deterministic assertion

```go
func FuzzCacheGet(f *testing.F) {
    f.Add("key1")
    f.Add("key2")
    f.Fuzz(func(t *testing.T, k string) {
        v, ok := cache.Get(k)
        if ok && v == "" {
            t.Fatalf("empty value for present key %q at %s", k, time.Now())
        }
    })
}
```

### What goes wrong

The assertion compares against the cache, but the failure message uses `time.Now()`. If a failure occurs, the fuzz engine attempts to minimize the input by re-running the body with smaller inputs and checking whether the failure reproduces. Including `time.Now()` in the failure message does *not* affect reproduction here, but if `cache.Get` itself depended on time (TTL eviction, for example), the failure would not be reproducible from the saved input.

The deeper bug is *the assumption that the cache is empty at the start of each fuzz body*. The cache is package-global. If a previous input populated the cache with `key1 -> ""`, the assertion fires on every subsequent input that probes `key1`, even though the input is innocent. The saved corpus entry, when replayed alone via `go test -run=FuzzCacheGet/<hash>`, will *not* reproduce because the cache starts empty on a fresh process.

### Fix

```go
func FuzzCacheGet(f *testing.F) {
    f.Fuzz(func(t *testing.T, k string) {
        c := newCache() // local instance per call
        c.Set(k, "v")
        v, ok := c.Get(k)
        if !ok || v != "v" {
            t.Fatalf("set/get mismatch")
        }
    })
}
```

Each invocation owns its own `cache`. The assertion is now a property of the cache, not of accumulated state.

## Trap 2 — Mutating shared global state

```go
var requestCounter int

func FuzzHandle(f *testing.F) {
    f.Add([]byte("GET / HTTP/1.1\r\n\r\n"))
    f.Fuzz(func(t *testing.T, b []byte) {
        requestCounter++
        if requestCounter > 1000 {
            t.Fatal("counter exceeded budget")
        }
        Handle(b)
    })
}
```

### What goes wrong

`requestCounter` is a package variable shared across all fuzz workers (well, within one worker process) and accumulates across inputs. The intent — limiting the fuzz body to 1000 invocations — is unachievable via a package counter because the fuzz engine resets state by spawning new worker processes for replay. Worse, when minimization replays the saved input on a fresh process, the counter starts at zero and the failure does not reproduce.

The fix is to remove the budget entirely (use `-fuzztime` instead) and let the engine control execution count.

### Fix

```go
func FuzzHandle(f *testing.F) {
    f.Add([]byte("GET / HTTP/1.1\r\n\r\n"))
    f.Fuzz(func(t *testing.T, b []byte) {
        Handle(b)
    })
}
```

If you want a budget, pass `-fuzztime=...` from the command line.

## Trap 3 — Missing seed corpus

```go
func FuzzParseURL(f *testing.F) {
    f.Fuzz(func(t *testing.T, s string) {
        u, err := url.Parse(s)
        if err == nil && u.Scheme == "" && u.Host != "" {
            t.Fatalf("host without scheme: %q", s)
        }
    })
}
```

### What goes wrong

No `f.Add` call. The fuzz target compiles and runs, but on the first iteration the mutator has nothing to mutate. It must invent inputs from scratch, starting from the empty string. For a target with a complex input shape — like a URL — the mutator can spend a long time before producing inputs that even resemble URLs. The bug is not in correctness; it is in efficiency. You can fuzz for an hour and find nothing the seed corpus would have surfaced in five seconds.

### Fix

```go
func FuzzParseURL(f *testing.F) {
    f.Add("http://example.com/path?q=1")
    f.Add("https://user:pass@host:8080/")
    f.Add("//relative")
    f.Add("//host-only")
    f.Add("/absolute-path")
    f.Add("")
    f.Fuzz(func(t *testing.T, s string) {
        u, err := url.Parse(s)
        if err == nil && u.Scheme == "" && u.Host != "" {
            t.Fatalf("host without scheme: %q", s)
        }
    })
}
```

The seeds give the mutator a starting point that already exhibits the relevant structure.

## Trap 4 — `t.Skip` in the wrong place

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Fuzz(func(t *testing.T, s string) {
        if !utf8.ValidString(s) {
            return // skip silently
        }
        out := Reverse(Reverse(s))
        if out != s {
            t.Fatalf("not involution")
        }
    })
}
```

### What goes wrong

The author intended `t.Skip()` but used a bare `return`. The two are not the same. With `return`, the fuzz body completes successfully — the input is treated as a *successful* test, and the engine *adds it to the working corpus* if it covered new edges. Over time the working corpus fills with invalid-UTF-8 strings that contribute no useful coverage to the actually-tested invariant.

`t.Skip()` would tell the engine that the input is uninteresting and should be discarded.

### Fix

```go
        if !utf8.ValidString(s) {
            t.Skip()
        }
```

Or, more aggressively, refactor the function under test to accept arbitrary bytes so the precondition is unnecessary.

## Trap 5 — Closing over a buffer

```go
func FuzzWriteRead(f *testing.F) {
    var buf bytes.Buffer
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, b []byte) {
        buf.Reset()
        buf.Write(b)
        out, _ := io.ReadAll(&buf)
        if !bytes.Equal(out, b) {
            t.Fatalf("mismatch")
        }
    })
}
```

### What goes wrong

The `bytes.Buffer` is closed over from the outer scope. The `Reset()` call makes this *appear* safe, but the buffer is shared across parallel workers within the same process — and even with `-parallel=1`, the buffer becomes a hidden source of non-determinism. Worse, if the fuzz body ever takes a copy of the buffer's backing slice and stores it somewhere persistent (a logger, a cache), subsequent inputs reuse the same underlying memory and you get cross-input data corruption that is incredibly hard to debug.

The general rule: do not close over mutable state in a fuzz body.

### Fix

```go
func FuzzWriteRead(f *testing.F) {
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, b []byte) {
        var buf bytes.Buffer
        buf.Write(b)
        out, _ := io.ReadAll(&buf)
        if !bytes.Equal(out, b) {
            t.Fatalf("mismatch")
        }
    })
}
```

Allocate per invocation. Performance is fine; the buffer is tiny.

## Trap 6 — `t.Errorf` instead of `t.Fatalf`

```go
func FuzzParse(f *testing.F) {
    f.Add([]byte("{}"))
    f.Fuzz(func(t *testing.T, b []byte) {
        var v any
        if err := json.Unmarshal(b, &v); err == nil {
            out, err := json.Marshal(v)
            if err != nil {
                t.Errorf("re-marshal failed") // bug
            }
            if !bytes.Equal(canonical(b), canonical(out)) {
                t.Errorf("not idempotent") // bug
            }
        }
    })
}
```

### What goes wrong

`t.Errorf` records a failure but continues executing the fuzz body. For most unit tests this is harmless. For a fuzz body it is harmful: the engine considers the input "failed" but the body proceeded to potentially panic, write to global state, or return a misleading second failure. Use `t.Fatalf` so the body aborts on the first failure.

Also: when the body uses `t.Errorf`, the saved corpus entry's failure message reflects all errors recorded, not the root cause. Reduction is harder.

### Fix

Replace `t.Errorf` with `t.Fatalf` throughout.

## Trap 7 — Fuzzing an integer with `-1` semantics

```go
func FuzzGetItem(f *testing.F) {
    f.Add(0)
    f.Add(5)
    f.Fuzz(func(t *testing.T, i int) {
        item := store.Get(i)
        if item == nil {
            t.Fatalf("nil item for index %d", i)
        }
    })
}
```

### What goes wrong

`int` in Go can be negative. The fuzzer will try negative values, including `MinInt`. The contract of `store.Get` likely is that it accepts non-negative indices; passing a negative one returns nil, which the assertion treats as a failure. But this is not a bug in `store` — it is a bug in the *fuzz target*, which fails to constrain its input.

The author should either skip negative inputs:

```go
        if i < 0 || i >= store.Len() {
            t.Skip()
        }
```

or use `uint` to express the contract:

```go
    f.Fuzz(func(t *testing.T, i uint) {
        ...
    })
```

The latter is cleaner; it expresses intent in the type.

## Trap 8 — Allocating from input size without bound

```go
func FuzzDecodeRLE(f *testing.F) {
    f.Add([]byte{1, 5, 2, 3})
    f.Fuzz(func(t *testing.T, b []byte) {
        out, err := DecodeRLE(b)
        if err != nil {
            t.Skip()
        }
        _ = out
    })
}
```

### What goes wrong

`DecodeRLE` reads a length field and allocates a slice of that size. The fuzzer will eventually generate a header that says "the decoded length is 2 GiB," and the decoder will allocate two gigabytes. On a constrained CI runner this OOMs the worker. The OOM is reported as "fuzzing process hung or terminated unexpectedly," which is correct — there *is* a bug, but it is in `DecodeRLE`, not in the fuzz target.

The trap here is in *interpretation*: the fuzz engine reports the failure, but if you treat it as a flaky CI runner ("the worker crashed, retry") you miss a real vulnerability. RLE decoders, length-prefixed protocols, and compression codecs need an explicit allocation bound, and fuzz is the way to discover that the bound is missing.

### Fix

Inside `DecodeRLE`:

```go
const maxAllocBytes = 64 << 20 // 64 MiB
if length > maxAllocBytes {
    return nil, errTooLarge
}
```

And keep the fuzz target as-is — it is correctly reporting the bug.

## Summary of traps

| # | Symptom |
|---|---------|
| 1 | Failure reproduces in fuzz mode but not in single-input replay |
| 2 | Failure depends on invocation order |
| 3 | Fuzz runs for hours without finding anything obvious |
| 4 | Working corpus grows with garbage entries |
| 5 | Cross-input contamination through closed-over state |
| 6 | Misleading failure messages, double-fails |
| 7 | Fuzz "finds" bugs that are really contract violations of the target |
| 8 | OOM reported as worker crash, real bug missed |

When triaging any fuzz finding, ask yourself: *is the bug in the system under test or in the fuzz target itself?* The traps above are common enough that an experienced reviewer will check them first.

[← Back](../)
