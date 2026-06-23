# 8.7 `log/slog` — Specification

Reference material. Each interface listed with method signature,
preconditions, postconditions, and invariants. Tables for levels,
default keys, and the `Value.Kind` enumeration. Concurrency table at
the end.

This file is a distillation of the `log/slog` package documentation as
of Go 1.22, with implementation notes that the docs leave implicit.
For prose explanations, see [senior.md](senior.md). For production
patterns, see [professional.md](professional.md).

## 1. `slog.Handler`

```go
type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}
```

| Method | Pre/post |
|--------|----------|
| `Enabled` | Called before record construction. MUST be safe for concurrent use. SHOULD be cheap (atomic load + compare) |
| `Handle` | Called only after `Enabled` returned true. Receives a `Record` whose `Time` is set by the `Logger`. MUST be safe for concurrent use. Returned error is discarded by `Logger.Log` |
| `WithAttrs` | MUST return a new `Handler` whose attributes are receiver's plus `attrs`. Empty `attrs` returns a handler equivalent to receiver |
| `WithGroup` | MUST return a new `Handler`. Empty `name` MUST return the receiver unchanged |

A handler that returns the receiver from `WithAttrs` with non-empty
`attrs` is non-conformant.

## 2. `slog.Logger`

```go
type Logger struct { /* unexported */ }
func New(h Handler) *Logger
func Default() *Logger
func SetDefault(l *Logger)

func (l *Logger) Handler() Handler
func (l *Logger) Enabled(ctx, level) bool
func (l *Logger) With(args ...any) *Logger
func (l *Logger) WithGroup(name string) *Logger
func (l *Logger) Log(ctx, level, msg, args ...any)
func (l *Logger) LogAttrs(ctx, level, msg, attrs ...Attr)
func (l *Logger) Debug/Info/Warn/Error(msg, args ...any)
func (l *Logger) DebugContext/InfoContext/WarnContext/ErrorContext(ctx, msg, args ...any)
```

| Aspect | Specification |
|--------|---------------|
| Concurrency | Safe for concurrent use |
| `New(nil)`, `SetDefault(nil)` | Panic |
| `Default()` | Returns package global; lock-free atomic pointer |
| Non-context calls | Use `context.Background()` internally |

## 3. `slog.Record`

```go
type Record struct {
    Time    time.Time
    Message string
    Level   Level
    PC      uintptr
}

func NewRecord(t time.Time, level Level, msg string, pc uintptr) Record
func (r Record) Clone() Record
func (r Record) NumAttrs() int
func (r *Record) AddAttrs(attrs ...Attr)
func (r *Record) Add(args ...any)
func (r Record) Attrs(f func(Attr) bool)
```

| Aspect | Specification |
|--------|---------------|
| `Time.IsZero()` | Handler MUST omit the time field from output |
| `PC == 0` | Handler MUST omit the source field |
| Attribute storage | Inline array (5) + spill slice |
| Mutation | `AddAttrs`/`Add` mutate the receiver; share via `Clone` |
| `Attrs` callback | Returning `false` halts iteration |

## 4. `slog.Attr` and `slog.Value`

```go
type Attr struct { Key string; Value Value }
type Value struct { /* opaque */ }

// Attr constructors mirror Value constructors plus a key:
//   String, Int, Int64, Uint64, Float64, Bool, Time, Duration,
//   Group, Any
// Value constructors:
//   StringValue, IntValue, Int64Value, Uint64Value, Float64Value,
//   BoolValue, TimeValue, DurationValue, GroupValue, AnyValue
// Value accessors (one per Kind): Kind, String, Int64, Uint64,
//   Float64, Bool, Time, Duration, Group, Any, Resolve, Equal
```

| Aspect | Specification |
|--------|---------------|
| Empty `Attr{}` | Drop signal in `ReplaceAttr` (handler omits) |
| `Group` with empty key | Inlined into parent (no nesting) |
| `Group` with no attrs | Handler MUST omit |
| `Any` with `Attr` value | Treated as the embedded `Attr` |

## 6. `slog.Kind` and `slog.LogValuer`

```go
type Kind int

const (
    KindAny Kind = iota
    KindBool
    KindDuration
    KindFloat64
    KindInt64
    KindString
    KindTime
    KindUint64
    KindGroup
    KindLogValuer
)

type LogValuer interface { LogValue() Value }
```

| Kind | Constructor | Accessor |
|------|-------------|----------|
| `KindString` | `StringValue` | `String()` |
| `KindInt64` | `IntValue`, `Int64Value` | `Int64()` |
| `KindUint64` | `Uint64Value` | `Uint64()` |
| `KindFloat64` | `Float64Value` | `Float64()` |
| `KindBool` | `BoolValue` | `Bool()` |
| `KindTime` | `TimeValue` | `Time()` |
| `KindDuration` | `DurationValue` | `Duration()` |
| `KindGroup` | `GroupValue` | `Group()` |
| `KindAny` | `AnyValue` | `Any()` |
| `KindLogValuer` | `AnyValue(LogValuer)` | `Resolve()` |

`Resolve()` calls `LogValue` repeatedly (capped at 4 levels) to
collapse a chain of `LogValuer`s into a non-`LogValuer` `Value`.
`LogValue` is called lazily — only if the record reaches a handler.

## 7. `slog.Level`, `slog.LevelVar`, `slog.Leveler`

```go
type Level int
const (
    LevelDebug Level = -4
    LevelInfo  Level = 0
    LevelWarn  Level = 4
    LevelError Level = 8
)
type LevelVar struct { /* atomic */ }
type Leveler interface { Level() Level }
```

| Level | Numeric | String |
|-------|---------|--------|
| Debug | -4 | "DEBUG" |
| Info | 0 | "INFO" |
| Warn | 4 | "WARN" |
| Error | 8 | "ERROR" |

Custom levels render as `nearest±offset` (`DEBUG-4`, `INFO+2`); rename
via `ReplaceAttr`. `Level` and `*LevelVar` both implement `Leveler`;
`HandlerOptions.Level` accepts either. `LevelVar.Level()`/`Set()` are
atomic.

## 11. `slog.HandlerOptions`

```go
type HandlerOptions struct {
    Level       Leveler
    AddSource   bool
    ReplaceAttr func(groups []string, a Attr) Attr
}
```

| Field | Default | Meaning |
|-------|---------|---------|
| `Level` | nil → `LevelInfo` | Minimum level emitted |
| `AddSource` | false | If true, capture and emit `source` (file:line) |
| `ReplaceAttr` | nil | Per-attribute rewrite hook; nil-Key Attr drops |

`ReplaceAttr` is called for every attribute including built-ins
(`time`, `level`, `msg`, `source`). To distinguish, check `a.Key` and
the `groups` argument (empty for top-level).

## 12. Built-in handlers and default keys

```go
func NewTextHandler(w io.Writer, opts *HandlerOptions) *TextHandler
func NewJSONHandler(w io.Writer, opts *HandlerOptions) *JSONHandler

const (
    TimeKey    = "time"
    LevelKey   = "level"
    MessageKey = "msg"
    SourceKey  = "source"
)
```

Both handlers implement `Handler`, pass `slogtest.TestHandler`, are
concurrent-safe if their `io.Writer` is, and pre-format `WithAttrs`
output once per `With` call.

| Format | Time | Attributes |
|--------|------|------------|
| Text | RFC3339Nano | `key=value` (quoted as needed) |
| JSON | RFC3339Nano | JSON object fields |

Rename built-in keys via `ReplaceAttr` matching `a.Key` against the
constants. Custom handlers SHOULD use the same names for consistency.

## 14. Package-level helpers

```go
func Debug/Info/Warn/Error(msg string, args ...any)
func DebugContext/InfoContext/WarnContext/ErrorContext(ctx, msg, args...)
func Log(ctx, level, msg, args...)
func LogAttrs(ctx, level, msg, attrs...)
func Default() *Logger
func SetDefault(*Logger)
func NewLogLogger(h Handler, level Level) *log.Logger
```

All package-level helpers delegate to `Default()`.

## 15. Variadic key-value parsing rules

The `args ...any` form follows these rules:

1. If the first remaining argument is a `slog.Attr`, consume one
   argument and emit it as-is.
2. Otherwise, the first argument must be a string (the key). The
   second argument is the value. Consume two arguments and emit
   `Attr{Key: key, Value: AnyValue(value)}`.
3. If a non-string appears where a key is expected, emit
   `Attr{Key: "!BADKEY", Value: AnyValue(arg)}` and consume one
   argument.
4. If the last argument is a key with no following value, emit
   `Attr{Key: "!BADKEY", Value: AnyValue(arg)}`.

`go vet -slogargs` (or the `sloglint` external linter) flags violations
at compile time.

## 16. Group flattening and sentinel values

| Case | Output |
|------|--------|
| Group with no attrs | Handler omits |
| Group with all attrs dropped by `ReplaceAttr` | Handler omits |
| `Group("", attrs...)` (empty key) | Inlined into parent — no nesting |
| `slog.Attr{}` from `ReplaceAttr` | Attribute dropped |
| `"!BADKEY"` | Auto-generated for malformed variadic args |
| `time.Time{}` zero | Handler omits time |
| `uintptr(0)` PC | Handler omits source |

Empty-keyed group inlining is how a `LogValuer` returning a group
keys naturally to the caller-supplied attribute name.

## 18. `testing/slogtest`

```go
func slogtest.TestHandler(h slog.Handler, results func() []map[string]any) error
```

Exercises every contract: time presence/omission, level emission,
source under `AddSource`, group nesting, empty-group omission,
`LogValuer` resolution inside groups, `WithAttrs` propagation across
chains. A handler that passes is contract-compliant.

## 19. Record allocation

| Attrs at `AddAttrs` | Allocation |
|---------------------|------------|
| ≤ 5 (inline array) | None |
| 6+ | One spill slice; doubling growth |

For zero-alloc paths, keep total attrs ≤ 5.

## 20. Concurrency table

| Type | Safe for concurrent use |
|------|--------------------------|
| `*slog.Logger` | Yes |
| `slog.Default()` / `slog.SetDefault` | Yes (atomic pointer) |
| `*slog.LevelVar` | Yes (atomic) |
| `*slog.JSONHandler` | Yes if underlying `io.Writer` is |
| `*slog.TextHandler` | Yes if underlying `io.Writer` is |
| Custom handlers | Implementer's responsibility |
| `slog.Record` | Mutable; share via `Clone` |
| `slog.Value` | Immutable |
| `slog.Attr` | Immutable (Key string, Value immutable) |

For `os.Stderr`/`os.Stdout`: writes are atomic per record up to
`PIPE_BUF` (4 KiB on Linux). For `bytes.Buffer`: not safe; wrap with a
mutex.

## 21. Bridge to `log`, defaults, and limits

`NewLogLogger(h, level)` adapts a `slog.Handler` to the `log.Logger`
type — every `log.Print*` becomes a record at the fixed level. The
reverse direction is `log.SetOutput(slog.NewLogLogger(...).Writer())`.

| Constant | Value |
|----------|-------|
| Inline-attr array size | 5 |
| `LogValuer.Resolve` recursion limit | 4 |
| `JSONHandler` time format | RFC 3339 nano |
| `TextHandler` time format | RFC 3339 nano |

## 22. What to read next

- [senior.md](senior.md) — prose form of these contracts with examples.
- [find-bug.md](find-bug.md) — bugs from violating items in the tables.
- [optimize.md](optimize.md) — performance implications of the inline
  attr array and the `LogAttrs` fast path.
