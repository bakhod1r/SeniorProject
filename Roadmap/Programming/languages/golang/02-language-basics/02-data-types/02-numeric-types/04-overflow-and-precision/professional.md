# Go Overflow and Precision — Professional / OSS Patterns

## 1. Overview

This document focuses on what professional Go projects do about overflow and precision: which standard-library packages they reach for, which third-party libraries are dominant in industry, what the production review checklists look like, what lint rules are typically enforced, and what real-world incidents look like. Where useful, file paths and links into well-known OSS codebases are cited so you can read the patterns directly.

---

## 2. Standard Library Reach

Three packages dominate:

- **`math/big`** — arbitrary-precision integers, floats (binary), rationals. Used widely across crypto, parsing, and any place a value can be unbounded.
- **`math/bits`** — overflow-aware unsigned integer primitives (`Add64`, `Sub64`, `Mul64`, `Div64`, `LeadingZeros64`). The building blocks for `math/big` itself and for any wide arithmetic library.
- **`math`** — `IsNaN`, `IsInf`, `Inf`, `NaN`, `MaxInt8` constants, etc.

`encoding/binary` interacts with overflow concerns when decoding fixed-width network protocols.

---

## 3. Third-Party Decimal Libraries

For money and financial calculation, two libraries dominate Go:

### 3.1 `shopspring/decimal`

[github.com/shopspring/decimal](https://github.com/shopspring/decimal). Used in many SaaS / e-commerce / fintech codebases. Stable API, exact decimal arithmetic, JSON / SQL marshaling included.

```go
import "github.com/shopspring/decimal"

a, _ := decimal.NewFromString("0.1")
b, _ := decimal.NewFromString("0.2")
sum := a.Add(b)
fmt.Println(sum.String()) // "0.3" — exact
```

Key APIs:
- `NewFromString`, `NewFromFloat` (avoid the latter for money inputs)
- `Add`, `Sub`, `Mul`, `Div`, `Mod`
- `RoundUp`, `RoundDown`, `RoundBank`
- `Cmp`, `Equal`, `LessThan`
- `MarshalJSON`, `UnmarshalJSON`

### 3.2 `cockroachdb/apd`

[github.com/cockroachdb/apd](https://github.com/cockroachdb/apd). Used inside CockroachDB for the SQL `DECIMAL` type. Lower-level than shopspring; you control rounding mode and precision context. More allocations-conscious.

```go
import "github.com/cockroachdb/apd/v3"

ctx := apd.BaseContext.WithPrecision(20)
a, _, _ := apd.NewFromString("0.1")
b, _, _ := apd.NewFromString("0.2")
out := new(apd.Decimal)
ctx.Add(out, a, b)
fmt.Println(out.String()) // "0.3"
```

Used in CockroachDB at:
- `pkg/sql/sem/tree/decimal.go` — wrapper for SQL DECIMAL
- `pkg/sql/sem/eval/binary_op.go` — arithmetic kernel

### 3.3 When to Choose Which

| Use case | Library |
|----------|---------|
| App-level money | `shopspring/decimal` (simpler API) |
| Database engine, fine-grained rounding | `cockroachdb/apd` |
| Cryptocurrency (e.g., wei, satoshi) | integer-only with `*big.Int` |

---

## 4. Real OSS References

### 4.1 Kubernetes — `metav1.Time` Truncation

Path: [`staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/time.go`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/time.go).

Kubernetes truncates timestamps to second granularity for round-trip stability. If you serialize a `time.Time` with sub-second precision and parse it back, you get a value that may differ in the nanos. The wrapper `metav1.Time` truncates explicitly to avoid the issue.

This isn't a float overflow per se, but it's a precision-loss pattern: if you don't normalize, equality fails after a round trip.

### 4.2 Prometheus Histograms — Float Bucket Boundaries

Path: [`prometheus/client_golang/prometheus/histogram.go`](https://github.com/prometheus/client_golang/blob/main/prometheus/histogram.go).

Histogram buckets are float64 boundaries. The `+Inf` bucket catches everything above the highest finite boundary. Special care is taken for NaN inputs: they are excluded from observation by `math.IsNaN`. Bucket counts are `uint64` so they can grow without overflow for the lifetime of any reasonable process.

### 4.3 etcd — `raft.Term` and ID Wrap

Path: [`raft/log.go`](https://github.com/etcd-io/etcd/blob/main/raft/log.go).

etcd uses `uint64` for term and index. Terms can grow over years; the size is chosen so wrap is impossible in any practical timeline (`2^64` is ~5 billion years at one term per second).

### 4.4 Go Standard Library — `time.Duration` as int64 Nanoseconds

Path: [`src/time/time.go`](https://github.com/golang/go/blob/master/src/time/time.go).

`time.Duration` is `int64` representing nanoseconds. Range: ~292 years. Operations check for overflow; e.g., `time.Until` clamps to MinDuration / MaxDuration.

### 4.5 Cockroach — Decimal Hot Path

Path: [`pkg/sql/sem/tree/decimal.go`](https://github.com/cockroachdb/cockroach/blob/master/pkg/sql/sem/tree/decimal.go).

CockroachDB's `DDecimal` wraps `apd.Decimal`. Arithmetic delegates to apd; conversions to/from float are explicit and rounding-controlled. The performance work in CockroachDB includes special-casing small decimals that fit in int64 — fast path with int64, slow path with apd.

### 4.6 gVisor — Bounded Buffer Sizes

Path: [`pkg/tcpip/buffer/buffer.go`](https://github.com/google/gvisor/tree/master/pkg/tcpip/buffer).

Network packet handling is full of length fields and offset arithmetic. gVisor consistently uses checked addition and bounded sizes (`MaxBufferSize`) to prevent overflow leading to undersized allocations.

### 4.7 Tailscale — Wireguard's Wide Math via math/bits

Path: [Wireguard-Go's curve25519 implementation](https://github.com/tailscale/wireguard-go/tree/main/device).

Curve25519 needs 256-bit modular arithmetic. The implementation uses `math/bits.Mul64` and `Add64` to compose 64-bit words into wider math without leaving the realm of native types. Faster than `math/big` for fixed-width operations.

### 4.8 Real Bug Postmortems

- **CockroachDB**: a regression where decimal-to-int conversion at certain magnitudes produced incorrect results because of an intermediate float64 rounding. Fix: avoid the float intermediate; convert decimal to big.Int directly. (See PR threads on cockroachdb/cockroach.)
- **Kubernetes**: cluster-autoscaler had a bug where node count overflowed `int32` for very large clusters. Fix: widen to `int64`.
- **Stripe Go SDK**: amounts were carried as `int64` cents to avoid float; documented in the SDK README. ([github.com/stripe/stripe-go](https://github.com/stripe/stripe-go))

---

## 5. Lint Rules

### 5.1 `gosec` G701 — Integer Overflow Conversion

[github.com/securego/gosec](https://github.com/securego/gosec).

Flags suspicious conversions that may overflow:

```go
n, _ := strconv.Atoi(input) // n is int
x := int32(n)               // G701: potential overflow
```

In CI, this catches common attacker-controlled-integer patterns.

### 5.2 `staticcheck` SA4006 / SA9003

[github.com/dominikh/go-tools](https://github.com/dominikh/go-tools).

`SA4006` — value never used (catches unused conversions).
`SA9003` — empty branch in division-by-zero guard.

`SA1019` flags deprecated APIs; relevant when migrating off old `math/rand` to `math/rand/v2`.

### 5.3 `revive` Style Rules

[github.com/mgechev/revive](https://github.com/mgechev/revive).

`unused-parameter`, `early-return`, `imports-blacklist` (e.g., to forbid `math/big` in places it shouldn't appear).

### 5.4 Custom CI Rules

Many companies add bespoke rules:
- Forbid `float64` for fields named `Amount`, `Price`, `Cost`.
- Forbid `int8` / `int16` outside specific files (e.g., wire format decoders).
- Require range-check comments on conversions.

These are enforced via `golangci-lint`, `semgrep`, or in-house tools.

---

## 6. Production Review Checklist

When reviewing PRs touching numeric code, walk through:

1. **Does any field representing money use float?** Reject.
2. **Are conversions narrowing without a range check?** Question.
3. **Are user-supplied lengths / counts bounded before allocation?** Required.
4. **Are float comparisons using `==`?** Require epsilon / ULP.
5. **Are NaN / Inf handled explicitly after potential-producing ops?** Required.
6. **Are constants checked for overflow at compile time?** (Usually automatic; verify if you change types.)
7. **For `math/big`, are `Set` / `SetInt64` used to reuse receivers?** (Allocation hygiene.)
8. **For aggregation over a stream, is overflow possible in long runs?** Add saturation or widen.
9. **Is `gosec` clean?** Required in many CIs.
10. **Are tests covering boundary values (0, 1, MaxIntN, MinIntN, NaN, Inf)?** Required.

---

## 7. Configuration Defaults

A typical `golangci-lint` config that catches numeric issues:

```yaml
linters:
  enable:
    - gosec
    - staticcheck
    - revive
    - errcheck
    - govet
    - ineffassign

linters-settings:
  gosec:
    config:
      G701:
        enabled: true
```

A team norm: never disable `gosec G701` without a `//nolint:gosec` comment that explains why.

---

## 8. Money Type Conventions

### 8.1 Stripe-Style: Integer Minor Units

```go
type Amount struct {
    Cents    int64
    Currency string // ISO 4217
}
```

Used by Stripe, PayPal SDKs, many e-commerce backends. Internal math is exact int64; rendering converts at display time.

Pros: fastest, no allocations, stdlib-only.
Cons: must remember the multiplier (100 for USD/EUR, 1 for JPY, 1000 for Tunisian Dinar).

### 8.2 Decimal-Type-Wrapped

```go
type Money struct {
    Value    decimal.Decimal
    Currency string
}
```

Used when the system handles many currencies with different scales, or precision-sensitive financial calculations (interest, percentage, tax compounding).

Pros: handles any scale, any precision.
Cons: ~50x slower than int64; allocations.

### 8.3 Bigint Wei (Cryptocurrency)

```go
import "math/big"

type Wei big.Int
```

Used by Ethereum-related Go code (`go-ethereum`'s [`common/math/big.go`](https://github.com/ethereum/go-ethereum/blob/master/common/math/big.go)). 1 ether = `10^18` wei, exceeds int64.

---

## 9. Decimal vs Float in Test Frameworks

Property-based testing libraries (e.g., `gopter`) often need to handle both. Patterns:

- For decimal types, generators yield strings parsed via `decimal.NewFromString`.
- For floats, generators include NaN, ±Inf, ±0, subnormals, and "random" doubles.

Test invariants:
- For decimal: `(a + b) - b == a` exactly.
- For float: `(a + b) - b ≈ a` (with tolerance).

The contrast between exact and approximate is the heart of why decimal exists.

---

## 10. Performance Tradeoffs in OSS

Profiling-guided observations from real codebases:

| Library | Operation cost (rough) |
|---------|------------------------|
| int64 add | 1 ns |
| float64 add | 1 ns |
| `math/bits.Add64` | 1-2 ns |
| `*big.Int.Add` (small) | 30-100 ns + alloc |
| `*big.Int.Add` (large) | scales with size |
| `decimal.Decimal.Add` | 100-300 ns + alloc |
| `apd.Decimal.Add` | 50-200 ns (with pre-allocated context) |

For hot paths, ordering matters. CockroachDB optimizes "value fits in int64" pre-checks to bypass apd entirely. Stripe uses int64 cents end-to-end.

---

## 11. Migration Patterns

### 11.1 Float-to-Decimal Migration

When replacing float money with decimal:

1. Add a `decimal.Decimal` field alongside the float.
2. At write paths, populate the decimal.
3. At read paths, prefer decimal; fallback to float.
4. Backfill historical data.
5. Remove the float field.
6. Audit serialization formats — JSON numeric fields may auto-coerce to float.

The migration is multi-release; never collapsed into one commit.

### 11.2 Widening int32 to int64

Easier: change the type and run tests. Watch for:
- Fixed-width serialization (network protocols, DB columns).
- Public API consumers.
- Reflect-based code that asserts the type.

### 11.3 Deprecating Float Comparison

Replace `==` with helper. Use `staticcheck`-like custom rule to flag remaining sites. Migrate gradually.

---

## 12. Architecture-Level Lessons

1. **Choose representation early.** Migrating money from float to decimal in production is painful.
2. **Type-encode units.** A `type Cents int64` prevents accidentally adding seconds and dollars.
3. **Document overflow policy.** Each counter should declare: what happens at MaxInt? Wrap, saturate, panic, alarm?
4. **Boundary validation.** All external numeric input should pass through a validator before reaching business logic.
5. **Reproducibility.** For ML / financial / scientific systems, document the rounding mode and float library version.

---

## 13. Self-Assessment Checklist

- [ ] I can list three OSS Go projects that use `math/big`
- [ ] I know the difference between `shopspring/decimal` and `cockroachdb/apd`
- [ ] I configure `gosec` with G701 enabled
- [ ] I never use `float64` for money in code I review
- [ ] I have read at least one OSS file that handles overflow in production
- [ ] I can sketch a money-migration plan
- [ ] I know how `time.Duration` is represented and its range
- [ ] I have used `math/bits` for an actual problem (hashing, modular arithmetic, etc.)

---

## 14. Summary

Professional Go avoids float for money, reaches for `math/big` only when input is unbounded, uses `math/bits` for fixed-width wide arithmetic, enforces lint rules in CI, and reads OSS for proven patterns. The ecosystem is mature: `shopspring/decimal` and `cockroachdb/apd` for decimal, `time.Duration` as int64 ns, integer minor units for currency, and bounded length fields in network code. Reviewing PRs with this checklist catches most numeric bugs before they reach production.

---

## 15. Further Reading

- [github.com/shopspring/decimal](https://github.com/shopspring/decimal)
- [github.com/cockroachdb/apd](https://github.com/cockroachdb/apd)
- [github.com/securego/gosec](https://github.com/securego/gosec)
- [github.com/dominikh/go-tools](https://github.com/dominikh/go-tools) (staticcheck)
- [`math/big`](https://pkg.go.dev/math/big), [`math/bits`](https://pkg.go.dev/math/bits)
- [Stripe Go SDK README](https://github.com/stripe/stripe-go) — int64 cents convention
- [Ethereum go-ethereum common/math/big.go](https://github.com/ethereum/go-ethereum/tree/master/common/math)
- [CockroachDB pkg/sql/sem/tree/decimal.go](https://github.com/cockroachdb/cockroach/tree/master/pkg/sql/sem/tree)
- [Tailscale Wireguard-go](https://github.com/tailscale/wireguard-go) — `math/bits` for wide modular arithmetic
