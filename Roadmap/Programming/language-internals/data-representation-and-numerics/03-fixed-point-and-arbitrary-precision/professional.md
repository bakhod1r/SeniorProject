# Fixed-Point & Arbitrary Precision — Professional Level

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)
> **Focus:** Designing money and high-precision systems that survive audits and attackers — a real Money type, ledger invariants, multi-currency and FX, constant-time crypto bignums, the real incidents (billing rounding, salami slicing), and the cross-language facilities a production system actually leans on.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **How do you architect a system where every cent is accounted for, every rounding is defensible to an auditor, and the bignums under your crypto don't leak keys?**

The earlier pages gave you correct primitives. This page is about *systems* — the decisions that, made wrong, become incidents with names: a billing run that double-charges fractions of a cent, a multi-currency report that doesn't tie out, a payout split where the platform quietly absorbs (or pockets) the remainder, a crypto path that leaks a private key through timing.

Two domains dominate professional use of this topic:

1. **Money systems** — ledgers, billing, FX, payouts. The hard requirements are *exactness*, *conservation* (debits equal credits, splits sum to the whole), *auditability* (every rounding has a documented, reproducible rule), and *currency correctness* (minor units, scale, and rounding per currency and jurisdiction).
2. **Cryptographic bignums** — RSA/DH/ECC riding on arbitrary-precision modular arithmetic where *constant-time* behavior is a security requirement and a single non-constant-time path is a vulnerability.

And one recurring villain ties it together: **salami slicing** — skimming sub-unit fractions across many transactions so each victim loses an unnoticeable amount while the attacker accumulates a fortune. The "half-cent that has to go somewhere" is exactly the seam a fraudster (or a careless rounding bug) exploits.

> 🎓 **Why this matters at the professional level:** You're the person who signs off that the billing engine is correct, that the ledger balances under concurrency, that the FX rounding satisfies the regulator, and that the crypto isn't leaking. These are not algorithm-trivia; they're design and review decisions where the cost of being wrong is money, trust, or a CVE.

This page covers: a production Money type and ledger invariants; rounding policy and conservation under FX and allocation; real incidents and the salami-slicing pattern; constant-time crypto bignums; and the language-facility comparison you reach for in practice. The `interview.md` and `tasks.md` files turn all of this into questions and exercises.

---

## Prerequisites

- **Required:** Junior/middle/senior pages — fixed-point, decimals, rounding/allocation, bignum internals and cost model, constant-time concerns.
- **Required:** Database transactions and isolation basics (you'll persist money).
- **Required:** A working mental model of an accounting ledger (debits/credits, double-entry).
- **Helpful:** Exposure to a payments/billing or FX system.
- **Helpful:** Awareness of timing side channels in crypto.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Money type** | A value object pairing an exact amount (minor units or decimal) with a currency, exposing safe arithmetic. |
| **Minor unit** | The smallest indivisible unit of a currency (cent, yen, fils). ISO 4217 lists each currency's exponent. |
| **ISO 4217 exponent** | The number of decimal places a currency uses: USD=2, JPY=0, BHD/KWD=3. |
| **Conservation invariant** | Money is neither created nor destroyed: debits = credits; sum of allocated shares = total. |
| **Double-entry** | Every transaction posts equal debits and credits, so the books always balance. |
| **FX rounding** | Rounding produced by converting between currencies at a rate; must be deterministic and reproducible. |
| **Salami slicing** | Fraud/error that skims sub-minor-unit fractions across many transactions ("penny shaving"). |
| **Constant-time** | Execution time independent of secret data — required to prevent timing attacks on crypto bignums. |
| **Reproducible rounding** | The same inputs always produce the same rounded outputs, so an auditor can re-derive every figure. |
| **Settlement** | The point where amounts become final and are rounded to the payable minor unit. |
| **Materialized rounding remainder** | The leftover from a split, explicitly assigned (to a party or a rounding account) rather than lost. |

---

## Core Concepts

### 1. The Money Type: Make Wrong States Unrepresentable

Bare integers invite bugs: adding USD to EUR, mixing cents and dollars, applying the wrong scale. A production **Money** value object closes those holes:

- Stores an **exact** amount — integer minor units, or a `BigDecimal`/`Decimal` with a fixed scale — *plus a currency code*.
- **Forbids cross-currency arithmetic** without an explicit conversion (a type error, not a silent bug).
- Carries the **currency's scale** (from ISO 4217), so it knows USD has 2 places and JPY has 0.
- Is **immutable** — operations return new Money, so values can't be mutated under your feet.
- Centralizes the **rounding policy** so every figure is rounded the same documented way.

This is Fowler's **Money** pattern, hardened. The payoff is that the *type* enforces the invariants you'd otherwise enforce by code review and prayer.

### 2. Conservation: The Non-Negotiable Invariant

Money systems have one inviolable rule: **value is conserved.** Concretely:

- **Double-entry:** every posting's debits equal its credits. The ledger's sum is always zero across all accounts.
- **Allocation:** when you split a total, `sum(shares) == total`, always — use the allocation algorithm from `middle.md`, never independent rounding.
- **FX round-trip awareness:** converting USD→EUR→USD will *not* generally return the original amount (rounding both ways). Don't assume reversibility; track conversions as first-class postings.

Every rounding step must materialize its remainder *somewhere explicit*: assigned to a party, swept into a "rounding differences" account, or held as a residual. A remainder that just disappears is a conservation violation and an audit finding — and the seam fraud exploits.

### 3. Rounding Policy as Auditable Configuration

Auditors don't accept "the framework rounded it." Every rounded figure must be **reproducible**: same inputs, same rule, same output, re-derivable months later. That means:

- The rounding mode (HALF_EVEN, HALF_UP, etc.) is **chosen per regulation/contract** and stored as configuration, not a code literal.
- The **scale** is the currency's minor unit (ISO 4217 exponent), except where a contract specifies more precision for intermediate calculation.
- Rounding happens at **defined boundaries** (per line item? per invoice? per settlement?) and the boundary choice is documented, because *where* you round changes the totals.
- The system can **replay** a calculation deterministically for any historical figure.

### 4. Multi-Currency and FX

Each currency has its own scale and rounding conventions. Storing everything as "cents" is wrong the moment JPY (0 decimals) or KWD (3 decimals) appears. A multi-currency system:

- Stores amounts in each currency's own minor units with its ISO 4217 exponent.
- Treats FX conversion as a posting with an explicit rate, timestamp, and resulting rounding remainder.
- Keeps the **rate's precision** high (rates often need 6+ decimals) and rounds the *result* to the target currency's scale with the agreed mode.
- Never compares or sums amounts across currencies without conversion.

### 5. Real Incidents and Salami Slicing

The "half-cent fraud" / "salami slicing" trope is real and recurring:

- **The skim:** interest or conversion produces fractions of a cent. Truncating each transaction's fraction and sweeping the accumulated fractions into one account skims a fortune across millions of transactions, invisible per-victim. This is the plot of *Office Space* and *Superman III* — but also of actual prosecuted fraud cases.
- **The honest-mistake version:** a billing engine that rounds each line item independently and sums them produces invoice totals that don't match "round the sum" — customers and finance both notice, and reconciliation breaks. Many real billing incidents are this, not malice.
- **The accumulation bug:** repeatedly rounding intermediate results (instead of once at the boundary) biases totals by fractions of a unit that compound across a billing cycle.

The defenses are the same as the correctness rules: conserve every remainder explicitly, round once at a documented boundary, allocate splits so they sum to the whole, and reconcile against an independent total. If a remainder has nowhere to go, that's the vulnerability.

### 6. Constant-Time Crypto Bignums

On the crypto side, the professional concern is **side channels**. RSA/DH/ECC ride on arbitrary-precision modular arithmetic, and if the running time (or cache behavior, or branch pattern) depends on secret key bits, an attacker can recover the key remotely (timing attacks: Kocher 1996; Brumley–Boneh's remote-timing-attacks-are-practical, 2003). Requirements:

- **Constant-time modular exponentiation** — no secret-dependent branches; a fixed sequence of squarings and multiplies (e.g., Montgomery ladder).
- **Constant-time conditional selects** instead of `if (secret_bit)`.
- **No secret-dependent memory access** (avoid table lookups indexed by secret bits, which leak via cache).
- Use **vetted libraries** (BoringSSL, libsodium, Go's `crypto/...`, `crypto/subtle.ConstantTimeCompare`) — generic `BigInteger`/`big.Int` operations are *not* constant-time and must not be on secret paths.

### 7. Language Facilities in Production

| Language | Money | Bignum | Notes |
|----------|-------|--------|-------|
| **Java** | `BigDecimal` (+ Joda-Money / JSR-354 `MonetaryAmount`) | `BigInteger` | `BigDecimal` from strings; pick `RoundingMode`; `equals`≠value. |
| **Python** | `decimal.Decimal` (+ `py-moneyed`) | `int` (native bignum) | thread-local context; `Fraction` for rationals. |
| **Go** | `math/big.Rat`/`big.Float` or cents+`int64`; libs like `shopspring/decimal`, Rhymond `go-money` | `math/big.Int` | mutable receivers to avoid allocation; `big.Float` is binary, not decimal. |
| **C++** | Boost.Multiprecision (`cpp_int`, `cpp_dec_float`), GMP/MPFR; `__int128` for wide fixed-point intermediates | GMP `mpz_t` | `__int128` is the go-to wide intermediate for Q-format multiply. |
| **Rust** | `rust_decimal`, `bigdecimal`; `num-rational` | `num-bigint`, `i128`/`u128` | strong type system makes a Money newtype natural. |
| **JavaScript** | no native decimal; `decimal.js`, `big.js`, `dinero.js` | `BigInt` | plain `Number` loses integer precision past 2^53 — a real JSON hazard. |

---

## Real-World Analogies

**The cash drawer that must balance.** At close, a cashier's drawer must reconcile to the penny. A money system is that drawer at scale: if it's off by a cent, *something* is wrong, and "it's just a cent" is not an acceptable answer to an auditor — because a systematic one-cent error is exactly how skimming looks.

**The recipe with a master ledger.** A professional kitchen tracks every gram in and out; "we lost a little flour each batch" eventually means theft or waste. Conservation invariants are the kitchen's inventory discipline applied to money.

**The poker face, again, with stakes.** Constant-time crypto is a dealer who takes exactly the same time on every hand. The moment the dealer hesitates on strong hands, the table reads the tell. The attacker is *measuring* your hesitation in microseconds.

**The split bill that always sums.** When friends split a check, someone has to absorb the odd cent — and everyone agrees who, *before* paying. Allocation is making that agreement explicit and consistent so the restaurant always gets exactly the bill total.

---

## Mental Models

**Model 1 — "Make illegal money states unrepresentable."** Encode currency, scale, and rounding into a type so cross-currency math and scale mixups are compile/throw errors, not silent corruption.

**Model 2 — "Every remainder has a home."** Rounding never destroys value; it relocates it. Name the destination (a party, a rounding account) explicitly. A homeless remainder is a bug and a fraud seam.

**Model 3 — "Reproducible or it didn't happen."** If you can't re-derive a historical figure from inputs + documented rules, you can't defend it. Rounding policy is configuration and audit trail, not an implementation detail.

**Model 4 — "Secret-dependent anything is a leak."** In crypto, time, branches, and memory access patterns are all observable. Constant-time discipline removes the channel.

---

## Code Examples

### A Money value object (Python, integer minor units + ISO 4217 scale)

```python
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_EVEN

MINOR_UNITS = {"USD": 2, "EUR": 2, "JPY": 0, "KWD": 3}  # ISO 4217 exponents

@dataclass(frozen=True)
class Money:
    minor: int       # amount in the currency's smallest unit
    currency: str

    def _check(self, other: "Money"):
        if self.currency != other.currency:
            raise ValueError(f"currency mismatch: {self.currency} vs {other.currency}")

    def add(self, other: "Money") -> "Money":
        self._check(other)
        return Money(self.minor + other.minor, self.currency)

    @classmethod
    def parse(cls, amount: str, currency: str) -> "Money":
        scale = MINOR_UNITS[currency]
        q = Decimal(amount).quantize(Decimal(1).scaleb(-scale), ROUND_HALF_EVEN)
        return cls(int(q.scaleb(scale)), currency)

    def __str__(self) -> str:
        scale = MINOR_UNITS[self.currency]
        return f"{Decimal(self.minor).scaleb(-scale)} {self.currency}"

print(Money.parse("19.99", "USD"))   # 19.99 USD  (minor=1999)
print(Money.parse("1000", "JPY"))    # 1000 JPY   (minor=1000, scale 0)
# Money.parse("1.99","USD").add(Money.parse("2","EUR"))  -> raises: currency mismatch
```

### Conservation-preserving allocation as a method (Python)

```python
def allocate(self_total: int, weights: list[int]) -> list[int]:
    w_sum = sum(weights)
    raw = [(self_total * w) // w_sum for w in weights]
    leftover = self_total - sum(raw)
    rema = sorted(range(len(weights)),
                  key=lambda i: (self_total * weights[i]) % w_sum, reverse=True)
    for i in rema[:leftover]:
        raw[i] += 1
    assert sum(raw) == self_total          # conservation invariant
    return raw

# $100.00 split 1:1:1 -> sums to exactly 10000 cents
print(allocate(10000, [1, 1, 1]))          # [3334, 3333, 3333]
```

### Java: FX conversion with high-precision rate, rounded to target scale

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

BigDecimal usd  = new BigDecimal("100.00");        // source
BigDecimal rate = new BigDecimal("0.918734");      // USD->EUR, 6dp
BigDecimal eurRaw = usd.multiply(rate);            // 91.8734  (don't round yet)
// round to EUR's scale (2) with the contractually agreed mode:
BigDecimal eur = eurRaw.setScale(2, RoundingMode.HALF_EVEN); // 91.87
// the remainder (eurRaw - eur) is materialized as an FX rounding posting, not dropped
```

### Constant-time comparison and exponentiation (Go)

```go
import (
    "crypto/subtle"
    "math/big"
)

// Constant-time equality for secret tokens — NOT bytes.Equal (which early-exits).
func tokensEqual(a, b []byte) bool {
    return subtle.ConstantTimeCompare(a, b) == 1
}

// big.Int.Exp is NOT guaranteed constant-time for secret exponents.
// For RSA/DH use crypto/rsa, crypto/ecdh, etc., which take care of side channels.
func modexp(base, exp, mod *big.Int) *big.Int {
    return new(big.Int).Exp(base, exp, mod) // fine for non-secret exponents only
}
```

### C++: wide intermediate for 64-bit fixed-point multiply

```cpp
#include <cstdint>
// Q32.32 multiply: 64-bit operands need a 128-bit intermediate.
int64_t fx_mul_q32(int64_t a, int64_t b) {
    __int128 product = (__int128)a * b; // no overflow at full width
    return (int64_t)(product >> 32);    // rescale back to Q32.32
}
```

---

## Pros & Cons

### A dedicated Money type

**Pros:** enforces currency/scale/rounding invariants in the type; eliminates whole bug classes; auditable in one place. **Cons:** upfront design cost; serialization/ORM mapping work; team must use it consistently (a single bare-int escape hatch reopens the holes).

### Storing minor-unit integers vs `BigDecimal`

**Pros (integers):** fastest, simplest, exact, trivially DB-mappable. **Cons (integers):** awkward for >2-decimal intermediate precision (FX rates, interest) — often pair integers for storage with decimals for calculation.
**Pros (`BigDecimal`):** flexible scale, natural for tax/interest/FX. **Cons:** slower, `equals` pitfalls, must pin scale/mode.

### Constant-time crypto

**Pros:** closes timing side channels; required for any real crypto. **Cons:** harder to write, sometimes slower; must resist "optimizations" that reintroduce data-dependent timing — which is why you use vetted libraries, not roll your own.

---

## Use Cases

- **Billing / invoicing / subscriptions:** exact line items, documented rounding boundary, reconciliation.
- **Ledgers / double-entry accounting:** conservation invariants enforced and tested.
- **Payments / payouts / marketplace splits:** allocation so platform + sellers + fees sum to the charge.
- **Multi-currency / FX / treasury:** per-currency scale, high-precision rates, materialized rounding remainders.
- **Cryptographic services:** key generation, signing, TLS — constant-time bignum modular arithmetic.

---

## Coding Patterns

**Pattern 1 — "Money is a type, never a primitive."** Centralize currency, scale, rounding, and arithmetic; forbid cross-currency ops by construction.

**Pattern 2 — "Round once, at a named boundary."** Decide and document where rounding happens (line / invoice / settlement); keep full precision until then.

**Pattern 3 — "Every split goes through allocate(), with a conservation assertion."** Test `sum(parts) == total` as an invariant, not an afterthought.

**Pattern 4 — "Materialize the remainder."** Post leftover fractions to an explicit account; never let rounding silently absorb value.

**Pattern 5 — "Crypto on vetted, constant-time libraries only."** Never put secret-dependent branches in bignum code; use `subtle`-style constant-time helpers.

**Pattern 6 — "Reconcile independently."** Compute totals two ways (sum of parts vs round-of-sum) and alert on divergence — your early-warning for rounding/skim bugs.

---

## Best Practices

1. **Wrap money in an immutable Money type** with currency + scale; make cross-currency arithmetic a hard error.
2. **Choose rounding mode per regulation/contract and store it as config**; never rely on a language default.
3. **Round exactly once, at a documented boundary**, and keep historical figures reproducible from inputs + rules.
4. **Use ISO 4217 scales** — don't assume "2 decimals" (JPY=0, KWD=3).
5. **Allocate every split; assert conservation.** Materialize remainders explicitly.
6. **Keep FX rates high-precision; round the result, not the rate.** Track conversions as postings.
7. **For crypto bignums, use audited constant-time libraries** and constant-time comparisons for secrets.
8. **Reconcile and monitor** for cent-level drift; treat any unexplained remainder as a possible skim.

---

## Edge Cases & Pitfalls

- **Bare-int escape hatch.** One place that does raw cents bypasses the Money type's protections and reintroduces currency/scale bugs.
- **Rounding boundary ambiguity.** "Round per line" vs "round the total" give different invoice totals; pick one, document it, test both don't silently diverge.
- **FX non-reversibility.** USD→EUR→USD rarely returns the start; code that assumes round-trip equality is wrong.
- **Currency-scale assumptions.** Hard-coding ×100 breaks JPY (×1) and KWD (×1000). Always consult the exponent.
- **`BigDecimal` equals vs compareTo** as map keys / in tests — scale-sensitivity causes false "not equal."
- **Salami / accumulation drift.** Independent or repeated intermediate rounding biases totals; the swept remainder is the fraud (or audit) finding.
- **Concurrency on balances.** Read-modify-write on a balance without proper isolation loses updates — a money correctness bug even with perfect arithmetic (see the shared-memory concurrency topic).
- **Crypto via generic bignum ops.** `big.Int.Exp`/`BigInteger.modPow` are not guaranteed constant-time; using them on secret exponents leaks. Use the crypto library.
- **JS `Number` for money or large IDs.** Past 2^53 it silently loses precision; deserialize big integers as `BigInt`/string and money via a decimal lib.
- **Database column scale mismatch.** Persisting a scale-4 calculation into a `NUMERIC(_, 2)` column rounds at the DB silently with the DB's mode, not yours.

---

## Summary

- Production money systems rest on a **Money type** that makes illegal states (cross-currency math, wrong scale, ad-hoc rounding) unrepresentable.
- **Conservation is non-negotiable:** double-entry balances, splits sum to the whole, and **every rounding remainder gets an explicit home**. A homeless remainder is both a bug and a fraud seam.
- **Rounding is auditable policy:** mode chosen per regulation, scale per ISO 4217, rounding at one documented boundary, every figure reproducible.
- **Salami slicing** (penny shaving) is the real-incident form of mishandled sub-unit fractions — defended by conservation, single-boundary rounding, allocation, and independent reconciliation.
- **Crypto bignums must be constant-time:** secret-dependent timing/branches/memory access leak keys; use vetted libraries, never generic bignum ops on secret paths.

---

## Further Reading

- Martin Fowler, *Patterns of Enterprise Application Architecture* — **Money** and `allocate`.
- ISO 4217 currency codes and minor-unit exponents.
- JSR-354 (Java Money & Currency API), Joda-Money; `shopspring/decimal`, `dinero.js`, `rust_decimal` docs.
- Kocher (1996), *Timing Attacks*; Brumley & Boneh (2003), *Remote Timing Attacks Are Practical*.
- Go `crypto/subtle`, BoringSSL/libsodium constant-time guidance.
- *Modern Computer Arithmetic* (Brent & Zimmermann) for the bignum foundations underneath crypto.
- This topic's `interview.md` and `tasks.md` to pressure-test the above.
