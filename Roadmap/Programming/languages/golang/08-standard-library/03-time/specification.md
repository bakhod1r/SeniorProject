# 8.3 `time` — Specification

> The formal reference: types, methods, layouts, errors, invariants, in
> tabular form. Cross-reference for the rest of the leaf.

## 1. Core types

| Type | Underlying | Zero value | Notes |
|------|-----------|------------|-------|
| `time.Time` | struct{wall uint64, ext int64, loc *Location} | Jan 1, year 1, 00:00:00 UTC | Comparable; `==` compares encoding, not instant |
| `time.Duration` | `int64` (nanoseconds) | 0 | Range: ~±290 years |
| `time.Month` | `int` | 0 (invalid; `January`=1) | `String()` returns name |
| `time.Weekday` | `int` | `Sunday`=0, ..., `Saturday`=6 | `String()` returns name |
| `time.Location` | opaque struct | nil ≡ UTC for some operations | Pass `*Location` |

## 2. Duration constants

```go
const (
    Nanosecond  Duration = 1
    Microsecond          = 1000 * Nanosecond
    Millisecond          = 1000 * Microsecond
    Second               = 1000 * Millisecond
    Minute               = 60 * Second
    Hour                 = 60 * Minute
)
```

No `Day`, no `Week`, no `Month`, no `Year` constants — by design.
Calendar units are not constant durations.

## 3. Selected `time.Time` methods

| Method | Returns | Notes |
|--------|---------|-------|
| `Now()` | `Time` | Wall + monotonic |
| `Date(y, M, d, h, m, s, ns, loc)` | `Time` | Normalizes overflow |
| `Unix(sec, nsec int64)` | `Time` | Local zone, no monotonic |
| `UnixMilli(ms int64)` | `Time` | Go 1.17+ |
| `UnixMicro(us int64)` | `Time` | Go 1.17+ |
| `Parse(layout, value)` | `Time, error` | UTC default; no monotonic |
| `ParseInLocation(layout, value, loc)` | `Time, error` | Loc-aware |
| `t.Add(d)` | `Time` | `Time + Duration` |
| `t.Sub(u)` | `Duration` | Prefers monotonic if both have it |
| `t.AddDate(y, m, d)` | `Time` | Calendar arithmetic; DST-correct |
| `t.Before(u)` / `After(u)` | `bool` | Wall comparison |
| `t.Equal(u)` | `bool` | Use this, not `==` |
| `t.IsZero()` | `bool` | True iff struct is zero |
| `t.UTC()` / `Local()` / `In(loc)` | `Time` | Same instant, different display zone |
| `t.Round(d)` | `Time` | Round to nearest multiple |
| `t.Truncate(d)` | `Time` | Round down |
| `t.Round(0)` | `Time` | Strip monotonic, same wall instant |
| `t.Unix()` / `UnixNano()` / `UnixMilli()` / `UnixMicro()` | `int64` | Various precisions |
| `t.Year()` / `Month()` / `Day()` / `Hour()` / `Minute()` / `Second()` / `Nanosecond()` | int / Month | Wall components in `t.Location()` |
| `t.Weekday()` | `Weekday` | |
| `t.YearDay()` | `int` | 1..366 |
| `t.ISOWeek()` | `(year, week int)` | ISO 8601 week numbering |
| `t.Location()` | `*Location` | Display zone |
| `t.Zone()` | `(name string, offset int)` | E.g. ("EST", -18000) |
| `t.Format(layout)` | `string` | Allocates |
| `t.AppendFormat(b, layout)` | `[]byte` | Allocation-free |
| `t.MarshalJSON()` / `MarshalText()` / `MarshalBinary()` | `[]byte, error` | Strip monotonic |
| `t.UnmarshalJSON(b)` / `UnmarshalText(b)` / `UnmarshalBinary(b)` | `error` | Set wall, no monotonic |

## 4. Selected `time.Duration` methods

| Method | Returns | Notes |
|--------|---------|-------|
| `d.Nanoseconds()` | `int64` | Same as `int64(d)` |
| `d.Microseconds()` | `int64` | Truncated |
| `d.Milliseconds()` | `int64` | Truncated |
| `d.Seconds()` | `float64` | |
| `d.Minutes()` | `float64` | |
| `d.Hours()` | `float64` | |
| `d.Round(m)` | `Duration` | Round to nearest multiple of `m` |
| `d.Truncate(m)` | `Duration` | Round down |
| `d.Abs()` | `Duration` | Go 1.19+; clamps `MinDuration` to `MaxDuration` |
| `d.String()` | `string` | E.g. `"1h2m3s"` |
| `time.ParseDuration(s)` | `Duration, error` | Inverse of `String()` |
| `time.Since(t)` | `Duration` | `Now().Sub(t)` |
| `time.Until(t)` | `Duration` | `t.Sub(Now())` |

## 5. Layout reference: the magic numbers

The reference time is **Mon Jan 2 15:04:05 MST 2006**. Each digit
selects a field:

| Digit/Word | Meaning | Example output |
|------------|---------|----------------|
| `2006` | 4-digit year | `2026` |
| `06` | 2-digit year | `26` |
| `1` | Month (no pad) | `5` |
| `01` | Month (zero-pad) | `05` |
| `Jan` | Month abbreviation | `May` |
| `January` | Month full name | `May` |
| `2` | Day (no pad) | `6` |
| `02` | Day (zero-pad) | `06` |
| `_2` | Day (space-pad) | ` 6` |
| `Mon` | Weekday abbrev | `Wed` |
| `Monday` | Weekday full | `Wednesday` |
| `15` | Hour 24h (zero-pad) | `14` |
| `3` | Hour 12h (no pad) | `2` |
| `03` | Hour 12h (zero-pad) | `02` |
| `04` | Minute (zero-pad) | `30` |
| `4` | Minute (no pad) | `30` |
| `05` | Second (zero-pad) | `45` |
| `5` | Second (no pad) | `45` |
| `PM` | AM/PM upper | `PM` |
| `pm` | am/pm lower | `pm` |
| `MST` | Zone abbreviation | `EST` (or `+0500`) |
| `-0700` | Zone offset, no colon, always sign | `+0500` |
| `-07:00` | Zone offset, with colon | `+05:00` |
| `-07` | Zone offset, hours only | `+05` |
| `Z0700` | Same as `-0700` but `Z` for UTC | `Z` or `+0500` |
| `Z07:00` | Same as `-07:00` but `Z` for UTC | `Z` or `+05:00` |
| `.000` / `,000` | Fractional seconds, zero-padded | `.123` |
| `.999` / `,999` | Fractional seconds, trailing zeros trimmed | `.12` |

Anything else in the layout is treated as a literal.

## 6. Pre-defined layout constants

```go
const (
    Layout      = "01/02 03:04:05PM '06 -0700"
    ANSIC       = "Mon Jan _2 15:04:05 2006"
    UnixDate    = "Mon Jan _2 15:04:05 MST 2006"
    RubyDate    = "Mon Jan 02 15:04:05 -0700 2006"
    RFC822      = "02 Jan 06 15:04 MST"
    RFC822Z     = "02 Jan 06 15:04 -0700"
    RFC850      = "Monday, 02-Jan-06 15:04:05 MST"
    RFC1123     = "Mon, 02 Jan 2006 15:04:05 MST"
    RFC1123Z    = "Mon, 02 Jan 2006 15:04:05 -0700"
    RFC3339     = "2006-01-02T15:04:05Z07:00"
    RFC3339Nano = "2006-01-02T15:04:05.999999999Z07:00"
    Kitchen     = "3:04PM"
    Stamp       = "Jan _2 15:04:05"
    StampMilli  = "Jan _2 15:04:05.000"
    StampMicro  = "Jan _2 15:04:05.000000"
    StampNano   = "Jan _2 15:04:05.000000000"
    DateTime    = "2006-01-02 15:04:05"  // Go 1.20+
    DateOnly    = "2006-01-02"           // Go 1.20+
    TimeOnly    = "15:04:05"             // Go 1.20+
)
```

## 7. Error sentinels

| Error | Meaning |
|-------|---------|
| `*time.ParseError` | Parse failure; has `Layout`, `Value`, `LayoutElem`, `ValueElem`, `Message` fields |
| `context.DeadlineExceeded` | Returned by `ctx.Err()` when deadline passes |
| `context.Canceled` | Returned by `ctx.Err()` on cancel |

`time` itself does not export sentinel error variables. Failures from
`LoadLocation` return wrapped OS errors; check with `errors.Is` against
`fs.ErrNotExist` if you care.

## 8. Timer/Ticker invariants

| Property | `Timer` | `Ticker` |
|----------|---------|----------|
| Fires on `.C` | Once | Repeatedly |
| Channel buffer | 1 | 1 (drops if not consumed) |
| `Stop()` returns bool | True if prevented from firing | (returns nothing; void) |
| `Stop()` closes the channel | No | No |
| `Reset(d)` allowed | Yes; on stopped or fired | No (`Ticker.Reset` Go 1.15+) |
| Pre-1.23 leak risk | `time.After` in select | `time.Tick` always |
| Post-1.23 GC | Unreferenced collected | Unreferenced collected |

`time.NewTimer(d)`, `time.NewTicker(d)`:
- `d <= 0` → panic for `NewTicker`; immediate fire for `NewTimer`.

`time.AfterFunc(d, f)`:
- Returns a `*Timer` you can `Stop` / `Reset`.
- Callback runs in a fresh goroutine from a runtime pool.

`time.Tick(d)`:
- Returns `<-chan Time` only; no way to stop.
- Returns `nil` if `d <= 0`.
- **Leaks the underlying ticker forever.** Avoid in production code.

## 9. JSON marshaling format

```
"2006-01-02T15:04:05.999999999Z07:00"
```

This is `time.RFC3339Nano`. The marshaler uses `AppendFormat` so
trailing zeros in the fractional component are trimmed.

Unmarshaling accepts:

- `RFC3339` (no fraction)
- `RFC3339Nano` (any fraction count, 1..9 digits)
- Zone of either `Z`, `+HH:MM`, or `-HH:MM`

Does **not** accept space-separated (`2006-01-02 15:04:05Z`) or
zone-less inputs. Use a custom `UnmarshalJSON` for non-conforming
sources.

The result of `UnmarshalJSON` has **no monotonic reading** (parse
constructs a Time without one).

## 10. Monotonic-clock rules

| Operation | Monotonic preserved? |
|-----------|----------------------|
| `time.Now()` | Created |
| `time.Date(...)` | Not created |
| `time.Unix(...)` / `UnixMilli/Micro` | Not created |
| `time.Parse / ParseInLocation` | Not created |
| `t.Add(d)` | Yes (if `t` had it) |
| `t.AddDate(...)` | Stripped |
| `t.UTC() / Local() / In(loc)` | Preserved |
| `t.Round(d)` (d ≠ 0) | Stripped |
| `t.Truncate(d)` (d ≠ 0) | Stripped |
| `t.Round(0)` | Stripped (intentional) |
| `t.Truncate(0)` | Preserved (no-op) |
| `MarshalJSON / Text / Binary / gob` | Stripped on round-trip |
| `t.GobEncode` | Strips |
| Channel send/receive | Preserved (Go runtime, not serialization) |

`Sub`, `Since`, `Until` use the monotonic reading when available on
both operands. Comparison via `Before`/`After`/`Equal` always uses
the wall clock.

## 11. Location resolution order

1. `$ZONEINFO` env var (path).
2. Embedded data from `time/tzdata` import.
3. OS zoneinfo paths: `/usr/share/zoneinfo`, `/usr/share/lib/zoneinfo`,
   `/usr/lib/locale/TZ/`.
4. `$GOROOT/lib/time/zoneinfo.zip`.

`time.LoadLocation("UTC")` always returns `time.UTC` without lookup.
`time.LoadLocation("Local")` returns `time.Local`.
`time.LoadLocation("")` returns `time.UTC`.

Anything else: `*time.Location, error`.

## 12. `Duration.String()` format

| Range | Format |
|-------|--------|
| 0 | `"0s"` |
| `< 1µs` | nanoseconds: `"42ns"` |
| `< 1ms` | microseconds: `"42µs"` (or `42us` on terminals lacking µ) |
| `< 1s`  | milliseconds: `"42ms"` |
| `< 1m`  | seconds with fractional: `"4.2s"` |
| Larger | hours/minutes/seconds: `"1h2m3s"` |

Always emits the smallest unit needed to be exact, never strips zero
hours/minutes when larger units are non-zero (`"1h0m3s"` is valid
output).

## 13. Common parse layouts cheat sheet

| Input shape | Layout |
|-------------|--------|
| `2026-05-06` | `time.DateOnly` |
| `2026-05-06 14:30:45` | `time.DateTime` |
| `2026-05-06T14:30:45Z` | `time.RFC3339` |
| `2026-05-06T14:30:45.123456789Z` | `time.RFC3339Nano` (or `RFC3339`) |
| `2026-05-06T14:30:45+05:00` | `time.RFC3339` |
| `Wed, 06 May 2026 14:30:45 GMT` | `time.RFC1123` |
| `2026-05-06 14:30:45.999999-07` | `"2006-01-02 15:04:05.999999-07"` (PostgreSQL TIMESTAMPTZ) |
| `06/May/2026:14:30:45 +0500` | `"02/Jan/2006:15:04:05 -0700"` (Apache log) |
| `20260506T143045Z` | `"20060102T150405Z"` (basic ISO 8601) |

## 14. Operator semantics summary

| Expression | Type | Notes |
|------------|------|-------|
| `time.Time + time.Duration` | invalid | Use `t.Add(d)` |
| `time.Time - time.Time` | invalid | Use `t1.Sub(t2)` |
| `time.Duration + time.Duration` | `time.Duration` | Plain `+`, integer math |
| `time.Duration * int` | `time.Duration` | Plain `*` |
| `int * time.Duration` | `time.Duration` | Plain `*` |
| `time.Duration / time.Duration` | `time.Duration` | Yields a count, but typed as Duration |
| `time.Time == time.Time` | `bool` | Compares encoding; **prefer `Equal`** |
| `time.Time < time.Time` | invalid | Use `Before`/`After` |

## 15. What to read next

- [senior.md](senior.md) — internals behind the entries in this table.
- [interview.md](interview.md) — questions that probe these tables.
- [find-bug.md](find-bug.md) — bugs that violate these invariants.
