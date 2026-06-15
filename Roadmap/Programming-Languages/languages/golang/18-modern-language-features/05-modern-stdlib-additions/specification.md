# Modern Standard-Library Additions — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Sources of Truth](#sources-of-truth)
3. [Version-by-Version Cheat Sheet](#version-by-version-cheat-sheet)
4. [`log/slog` Signatures](#logslog-signatures)
5. [`slices` Signatures](#slices-signatures)
6. [`maps` Signatures](#maps-signatures)
7. [`cmp` Signatures](#cmp-signatures)
8. [`math/rand/v2` Signatures](#mathrandv2-signatures)
9. [`unique` Signatures](#unique-signatures)
10. [`net/http` Routing Grammar](#nethttp-routing-grammar)
11. [Other Additions](#other-additions)
12. [References](#references)

---

## Introduction

These packages are part of the *standard library*, not the language specification. The authoritative references are the per-package `pkg.go.dev` documentation and the per-release notes at `go.dev/doc/devel/release`. This file collects exact signatures, version tags, and the routing grammar in one place.

---

## Sources of Truth

1. **Release notes** — `go.dev/doc/go1.21`, `go1.22`, `go1.23`, `go1.24`.
2. **Package docs** — `pkg.go.dev/log/slog`, `/slices`, `/maps`, `/cmp`, `/math/rand/v2`, `/unique`, `/net/http`.
3. **Go blog** — `go.dev/blog/slog`, `go.dev/blog/routing-enhancements`.

---

## Version-by-Version Cheat Sheet

| Go | Released | Headline stdlib additions |
|----|----------|---------------------------|
| **1.21** | Aug 2023 | `log/slog`; `slices`; `maps`; `cmp`; builtins `min`/`max`/`clear`; `slog`+`slices`/`maps` graduate from `x/exp` |
| **1.22** | Feb 2024 | `math/rand/v2`; `cmp.Or`; `net/http.ServeMux` method + wildcard routing; `go/version`; `slices.Concat` |
| **1.23** | Aug 2024 | `unique`; range-over-func (`iter` package); `slices`/`maps` iterator funcs (`All`, `Values`, `Collect`, `Sorted`, `Keys`→iter); `structs.HostLayout` |
| **1.24** | Feb 2025 | `testing/synctest` (experimental); `os.Root`; `crypto/rand.Text`; `encoding.TextAppender`/`BinaryAppender`; `json` `omitzero`; `weak` package; generic type aliases |

---

## `log/slog` Signatures

```go
// Top-level (use the default logger)
func Info(msg string, args ...any)
func Warn(msg string, args ...any)
func Error(msg string, args ...any)
func Debug(msg string, args ...any)
func InfoContext(ctx context.Context, msg string, args ...any) // + Warn/Error/Debug Context
func SetDefault(l *Logger)
func Default() *Logger
func With(args ...any) *Logger
func SetLogLoggerLevel(level Level) Level
func NewLogLogger(h Handler, level Level) *log.Logger

// Logger
func New(h Handler) *Logger
func (l *Logger) Info(msg string, args ...any) // + Warn/Error/Debug(+Context)
func (l *Logger) LogAttrs(ctx context.Context, level Level, msg string, attrs ...Attr)
func (l *Logger) With(args ...any) *Logger
func (l *Logger) WithGroup(name string) *Logger
func (l *Logger) Enabled(ctx context.Context, level Level) bool

// Handlers
func NewTextHandler(w io.Writer, opts *HandlerOptions) *TextHandler
func NewJSONHandler(w io.Writer, opts *HandlerOptions) *JSONHandler

type HandlerOptions struct {
    AddSource   bool
    Level       Leveler
    ReplaceAttr func(groups []string, a Attr) Attr
}

type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}

// Attr constructors
func String(key, value string) Attr
func Int(key string, value int) Attr
func Int64(key string, value int64) Attr
func Uint64(key string, value uint64) Attr
func Float64(key string, value float64) Attr
func Bool(key string, value bool) Attr
func Time(key string, v time.Time) Attr
func Duration(key string, v time.Duration) Attr
func Any(key string, value any) Attr
func Group(key string, args ...any) Attr

// Levels
const (
    LevelDebug Level = -4
    LevelInfo  Level = 0
    LevelWarn  Level = 4
    LevelError Level = 8
)

type LogValuer interface { LogValue() Value }
```

---

## `slices` Signatures

```go
// Go 1.21
func Sort[S ~[]E, E cmp.Ordered](x S)
func SortFunc[S ~[]E, E any](x S, cmp func(a, b E) int)
func SortStableFunc[S ~[]E, E any](x S, cmp func(a, b E) int)
func BinarySearch[S ~[]E, E cmp.Ordered](x S, target E) (int, bool)
func BinarySearchFunc[S ~[]E, E, T any](x S, target T, cmp func(E, T) int) (int, bool)
func Index[S ~[]E, E comparable](s S, v E) int
func IndexFunc[S ~[]E, E any](s S, f func(E) bool) int
func Contains[S ~[]E, E comparable](s S, v E) bool
func ContainsFunc[S ~[]E, E any](s S, f func(E) bool) bool
func Equal[S ~[]E, E comparable](s1, s2 S) bool
func EqualFunc[S1 ~[]E1, S2 ~[]E2, E1, E2 any](s1 S1, s2 S2, eq func(E1, E2) bool) bool
func Compact[S ~[]E, E comparable](s S) S
func CompactFunc[S ~[]E, E any](s S, eq func(E, E) bool) S
func Insert[S ~[]E, E any](s S, i int, v ...E) S
func Delete[S ~[]E, E any](s S, i, j int) S
func Replace[S ~[]E, E any](s S, i, j int, v ...E) S
func Clone[S ~[]E, E any](s S) S
func Reverse[S ~[]E, E any](s S)
func Clip[S ~[]E, E any](s S) S
func Min[S ~[]E, E cmp.Ordered](x S) E
func Max[S ~[]E, E cmp.Ordered](x S) E
func MinFunc/MaxFunc[S ~[]E, E any](x S, cmp func(a, b E) int) E
func IsSorted[S ~[]E, E cmp.Ordered](x S) bool

// Go 1.22
func Concat[S ~[]E, E any](slices ...S) S

// Go 1.23 (iterators)
func All[Slice ~[]E, E any](s Slice) iter.Seq2[int, E]
func Values[Slice ~[]E, E any](s Slice) iter.Seq[E]
func Collect[E any](seq iter.Seq[E]) []E
func Sorted[E cmp.Ordered](seq iter.Seq[E]) []E
func SortedFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E
func SortedStableFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E
func Repeat[S ~[]E, E any](x S, count int) S
```

---

## `maps` Signatures

```go
// Go 1.21
func Clone[M ~map[K]V, K comparable, V any](m M) M
func Copy[M1 ~map[K]V, M2 ~map[K]V, K comparable, V any](dst M1, src M2)
func Equal[M1, M2 ~map[K]V, K, V comparable](m1 M1, m2 M2) bool
func EqualFunc[...](m1 M1, m2 M2, eq func(V1, V2) bool) bool
func DeleteFunc[M ~map[K]V, K comparable, V any](m M, del func(K, V) bool)

// Go 1.23 (iterators — NOTE: Keys/Values return iter.Seq, NOT []K/[]V)
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K]
func Values[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[V]
func All[Map ~map[K]V, K comparable, V any](m Map) iter.Seq2[K, V]
func Insert[Map ~map[K]V, K comparable, V any](m Map, seq iter.Seq2[K, V])
func Collect[K comparable, V any](seq iter.Seq2[K, V]) map[K]V
```

> The slice-returning `Keys`/`Values` of `golang.org/x/exp/maps` did **not** carry over; the stdlib versions return iterators.

---

## `cmp` Signatures

```go
// Go 1.21
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 | ~string
}
func Compare[T Ordered](x, y T) int  // -1, 0, +1; NaN sorts before all
func Less[T Ordered](x, y T) bool

// Go 1.22
func Or[T comparable](vals ...T) T   // first non-zero value, else zero
```

---

## `math/rand/v2` Signatures

```go
// Sources (Go 1.22)
type Source interface { Uint64() uint64 }
func NewPCG(seed1, seed2 uint64) *PCG
func NewChaCha8(seed [32]byte) *ChaCha8

// Rand
func New(src Source) *Rand
func (r *Rand) IntN(n int) int
func (r *Rand) Int64N(n int64) int64
func (r *Rand) Uint64N(n uint64) uint64
func (r *Rand) Float64() float64
func (r *Rand) Shuffle(n int, swap func(i, j int))
func (r *Rand) Perm(n int) []int

// Generic, top-level (global source; no Seed function)
func N[Int intType](n Int) Int   // [0, n), any integer-kinded type
func IntN(n int) int
func Int64N(n int64) int64
func Uint64N(n uint64) uint64
func Float64() float64
func Shuffle(n int, swap func(i, j int))
func Perm(n int) []int
```

> No `Seed`. The global source is auto-seeded once, unpredictably. For reproducibility use `New(NewPCG(a, b))`.

---

## `unique` Signatures

```go
// Go 1.23
func Make[T comparable](value T) Handle[T]
type Handle[T comparable] struct { /* opaque */ }
func (h Handle[T]) Value() T
// Handle[T] is comparable; equal values produce == handles (pointer compare).
```

---

## `net/http` Routing Grammar

Pattern syntax (Go 1.22+):

```
pattern  = [ method " " ] [ host ] "/" [ segments ]
method   = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | ...
segment  = literal | "{" name "}" | "{" name "..." "}" | "{$}"
```

- `{name}` — matches exactly one path segment; readable via `r.PathValue("name")`.
- `{name...}` — matches the remaining (possibly multi-segment) path; must be the final segment.
- `{$}` — anchors the pattern to the exact path (no subtree match).
- No method → matches all methods. `GET` also serves `HEAD`.
- Path matches but method does not → `405 Method Not Allowed` with `Allow` header.
- Overlapping patterns: most specific wins; truly ambiguous registrations **panic** at registration time.

```go
func (r *Request) PathValue(name string) string
func (r *Request) SetPathValue(name, value string)
```

Behaviour is gated by the module's `go` directive (`go 1.22+` for the new semantics).

---

## Other Additions

```go
// structs (Go 1.23)
type HostLayout struct{ /* compiler marker, no fields */ }

// go/version (Go 1.22)
func IsValid(x string) bool
func Compare(x, y string) int    // -1, 0, +1
func Lang(x string) string       // "go1.21.3" -> "go1.21"

// testing/synctest (Go 1.24, GOEXPERIMENT=synctest)
func Run(f func())
func Wait()

// crypto/rand (Go 1.24)
func Text() string               // cryptographically-random base32 string

// encoding (Go 1.24)
type TextAppender interface   { AppendText(b []byte) ([]byte, error) }
type BinaryAppender interface { AppendBinary(b []byte) ([]byte, error) }

// os (Go 1.24)
func OpenRoot(name string) (*Root, error)  // traversal-confined FS ops
```

---

## References

- [Go 1.21 Release Notes](https://go.dev/doc/go1.21)
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22)
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23)
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24)
- [All Go release notes](https://go.dev/doc/devel/release)
- [`log/slog`](https://pkg.go.dev/log/slog), [`slices`](https://pkg.go.dev/slices), [`maps`](https://pkg.go.dev/maps), [`cmp`](https://pkg.go.dev/cmp), [`math/rand/v2`](https://pkg.go.dev/math/rand/v2), [`unique`](https://pkg.go.dev/unique), [`net/http`](https://pkg.go.dev/net/http#ServeMux)
- [slog blog post](https://go.dev/blog/slog), [routing enhancements blog post](https://go.dev/blog/routing-enhancements)
