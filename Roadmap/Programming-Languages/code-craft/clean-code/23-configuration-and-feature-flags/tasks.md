# Configuration, Constants & Feature Flags — Practice Tasks

> Twelve hands-on exercises on the lifecycle of a setting: where a value lives, who may change it, when it is read, and when a flag must die. Each task gives a scenario, real-looking bad code (Go / Java / Python — varied), an instruction, and a full solution with reasoning. Ordered easy → hard.

---

## Table of Contents

1. [Task 1 — Extract magic numbers into named constants (Go)](#task-1--extract-magic-numbers-into-named-constants-go)
2. [Task 2 — Name magic strings at the right scope (Python)](#task-2--name-magic-strings-at-the-right-scope-python)
3. [Task 3 — Kill the boolean-trap flag call (Java)](#task-3--kill-the-boolean-trap-flag-call-java)
4. [Task 4 — Consolidate config sprawl into one typed source (Go)](#task-4--consolidate-config-sprawl-into-one-typed-source-go)
5. [Task 5 — Validate config at startup, fail fast (Python)](#task-5--validate-config-at-startup-fail-fast-python)
6. [Task 6 — Replace a stringly-typed config map with a typed struct (Go)](#task-6--replace-a-stringly-typed-config-map-with-a-typed-struct-go)
7. [Task 7 — Remove hard-coded `if env == "prod"` (Java)](#task-7--remove-hard-coded-if-env--prod-java)
8. [Task 8 — Move a secret out of code into injected config (Python)](#task-8--move-a-secret-out-of-code-into-injected-config-python)
9. [Task 9 — Turn a silent default into an explicit required value (Go)](#task-9--turn-a-silent-default-into-an-explicit-required-value-go)
10. [Task 10 — Design a feature flag with a retirement plan (Java)](#task-10--design-a-feature-flag-with-a-retirement-plan-java)
11. [Task 11 — Write the flag-removal PR (Python)](#task-11--write-the-flag-removal-pr-python)
12. [Task 12 — Config audit (open-ended, Go)](#task-12--config-audit-open-ended-go)

---

## How to Use

Read the scenario, then try the instruction **before** opening the solution. Type the fix out by hand — configuration bugs hide in code that compiles and runs fine until the one environment where it doesn't.

A setting moves through four stages. Keep the diagram in mind: most of these tasks fix a value that is stuck in the wrong stage.

```mermaid
flowchart LR
    A[Literal in code<br/>magic number/string] --> B[Named constant<br/>right scope]
    B --> C[Typed config<br/>one source, validated]
    C --> D[Injected at startup<br/>fail-fast]
    D --> E{Flag?}
    E -->|temporary| F[Retire on schedule<br/>removal PR]
    E -->|permanent| C
    style A fill:#5b2333,stroke:#c44,color:#fff
    style F fill:#1f3b2c,stroke:#4c8,color:#fff
```

Difficulty scale: 🟢 easy · 🟡 medium · 🔴 hard.

---

### Task 1 — Extract magic numbers into named constants (Go)

🟢 **Difficulty:** easy

**Scenario.** A rate limiter sprinkles raw numbers through its logic. Nobody remembers why `3` and `900` were chosen, and `900` appears twice with no guarantee the two copies stay in sync.

```go
package ratelimit

import "time"

func (l *Limiter) Allow(key string) bool {
    bucket := l.buckets[key]
    if bucket.tokens < 1 {
        if time.Since(bucket.lastRefill) > 900*time.Second {
            bucket.tokens = 3
            bucket.lastRefill = time.Now()
        }
    }
    if bucket.tokens >= 1 {
        bucket.tokens--
        return true
    }
    return false
}

func (l *Limiter) ResetWindow() time.Duration {
    return 900 * time.Second
}
```

**Instruction.** Replace the magic numbers with named package-level constants. Use a `time.Duration` constant so the unit is expressed once. Make the window a single source of truth.

<details><summary>Solution</summary>

```go
package ratelimit

import "time"

const (
    // maxTokens is the burst capacity refilled at the start of each window.
    maxTokens = 3
    // refillWindow is how long a key must idle before its bucket refills.
    refillWindow = 15 * time.Minute
)

func (l *Limiter) Allow(key string) bool {
    bucket := l.buckets[key]
    if bucket.tokens < 1 && time.Since(bucket.lastRefill) > refillWindow {
        bucket.tokens = maxTokens
        bucket.lastRefill = time.Now()
    }
    if bucket.tokens >= 1 {
        bucket.tokens--
        return true
    }
    return false
}

func (l *Limiter) ResetWindow() time.Duration {
    return refillWindow
}
```

**Reasoning.** `900 * time.Second` says nothing; `refillWindow = 15 * time.Minute` says everything and reads in the unit a human thinks in. The constant exists exactly once, so `Allow` and `ResetWindow` can never disagree. `maxTokens` names the intent ("burst capacity") rather than the digit. These are unexported because they are tuning details internal to the package — scope the constant as narrowly as the code that uses it. If operations need to tune the window without a recompile, that is a *config* concern (Task 4), not a constant.

</details>

---

### Task 2 — Name magic strings at the right scope (Python)

🟢 **Difficulty:** easy

**Scenario.** Order status is a bare string compared in a dozen places. A typo (`"shipped "` with a trailing space, `"Cancelled"` with a capital C) silently routes an order to the wrong branch, and there is no way to enumerate the valid statuses.

```python
def can_refund(order):
    if order["status"] == "delivered":
        return True
    if order["status"] == "shipped":
        return True
    return False

def is_terminal(order):
    return order["status"] in ("delivered", "cancelled", "refunded")

def advance(order):
    if order["status"] == "paid":
        order["status"] = "shipped"
    elif order["status"] == "shipped":
        order["status"] = "delivered"
```

**Instruction.** Replace the magic strings with a single typed enum scoped to the order domain. The set of valid values must be enumerable and comparisons must be typo-proof.

<details><summary>Solution</summary>

```python
from enum import Enum


class OrderStatus(str, Enum):
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


REFUNDABLE = frozenset({OrderStatus.SHIPPED, OrderStatus.DELIVERED})
TERMINAL = frozenset({OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED})

_NEXT = {
    OrderStatus.PAID: OrderStatus.SHIPPED,
    OrderStatus.SHIPPED: OrderStatus.DELIVERED,
}


def can_refund(order) -> bool:
    return order.status in REFUNDABLE


def is_terminal(order) -> bool:
    return order.status in TERMINAL


def advance(order) -> None:
    if order.status in _NEXT:
        order.status = _NEXT[order.status]
```

**Reasoning.** A typo'd member (`OrderStatus.SHIPED`) is now an `AttributeError` at import time, not a silent `False` at runtime. Inheriting `str` keeps the values JSON- and DB-serialisable, so the enum lives at the edge as well as in memory. The valid set is enumerable (`list(OrderStatus)`), which transitions and tests can iterate. The scope is the order module — these names mean nothing outside it, so they do not belong in a global constants file. Notice the bonus: the transition table replaced an `if/elif` ladder, removing duplicated string literals from a third location.

</details>

---

### Task 3 — Kill the boolean-trap flag call (Java)

🟢 **Difficulty:** easy

**Scenario.** A call site reads `sendEmail(user, true, false, true)`. To know what those booleans mean you must open the method, count the parameters, and pray nobody reordered them. Worse, two adjacent `boolean` parameters mean the compiler will not catch a swap.

```java
public void sendEmail(User user, boolean html, boolean async, boolean trackOpens) {
    // ...
}

// Call site, 200 lines away:
mailer.sendEmail(user, true, false, true);
```

**Instruction.** Eliminate the boolean trap. Make the call site self-documenting and make a swapped argument a compile error.

<details><summary>Solution</summary>

```java
// Option A — named functions for the common cases (best when combinations are few):
public void sendHtmlEmailSync(User user, boolean trackOpens) { /* ... */ }
public void sendPlainTextEmailAsync(User user) { /* ... */ }

// Option B — a typed options object (best when combinations multiply):
public record EmailOptions(Format format, Delivery delivery, boolean trackOpens) {
    public enum Format { HTML, PLAIN_TEXT }
    public enum Delivery { SYNC, ASYNC }

    public static EmailOptions htmlTracked() {
        return new EmailOptions(Format.HTML, Delivery.SYNC, true);
    }
}

public void sendEmail(User user, EmailOptions options) { /* ... */ }

// Call site is now unambiguous and swap-proof:
mailer.sendEmail(user, EmailOptions.htmlTracked());
// or, fully explicit:
mailer.sendEmail(user, new EmailOptions(Format.HTML, Delivery.SYNC, true));
```

**Reasoning.** `sendEmail(user, true, false, true)` is a riddle; the reader cannot recover meaning without leaving the line. Two same-typed booleans (`html`, `async`) can be swapped with zero compiler complaint — a latent bug. Enums make `Format.HTML` impossible to pass where `Delivery` is expected, so a swap is now a compile error. Prefer Option A when there are two or three real combinations (named methods document intent best). Reach for Option B when the flags combine into many cases, so you are not writing `sendHtmlAsyncTracked`, `sendHtmlSyncUntracked`, and so on.

</details>

---

### Task 4 — Consolidate config sprawl into one typed source (Go)

🟡 **Difficulty:** medium

**Scenario.** The same database settings are read three different ways in three files: one `os.Getenv` with a hard-coded fallback, one with a *different* fallback, and a magic timeout buried in a third. When ops changes `DB_HOST`, two of three places pick it up; the third keeps the stale default and the on-call engineer spends an hour finding out why.

```go
// store/conn.go
func dialDB() (*sql.DB, error) {
    host := os.Getenv("DB_HOST")
    if host == "" {
        host = "localhost"
    }
    return sql.Open("postgres", "host="+host+" port=5432")
}

// migrate/run.go
func migrateDB() (*sql.DB, error) {
    host := os.Getenv("DB_HOST")
    if host == "" {
        host = "127.0.0.1" // different default!
    }
    return sql.Open("postgres", "host="+host+" port=5432")
}

// health/check.go
func pingDB(db *sql.DB) error {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    return db.PingContext(ctx)
}
```

**Instruction.** Define one typed `DBConfig`, loaded once from the environment, with a single set of defaults. Pass it explicitly to every consumer. Eliminate the divergent fallbacks.

<details><summary>Solution</summary>

```go
package config

import (
    "fmt"
    "os"
    "strconv"
    "time"
)

// DBConfig is the single source of truth for database settings.
type DBConfig struct {
    Host        string
    Port        int
    PingTimeout time.Duration
}

func LoadDBConfig() (DBConfig, error) {
    cfg := DBConfig{
        Host:        getenv("DB_HOST", "localhost"),
        Port:        5432,
        PingTimeout: 2 * time.Second,
    }
    if raw := os.Getenv("DB_PORT"); raw != "" {
        p, err := strconv.Atoi(raw)
        if err != nil {
            return DBConfig{}, fmt.Errorf("DB_PORT %q is not an integer: %w", raw, err)
        }
        cfg.Port = p
    }
    return cfg, nil
}

func (c DBConfig) DSN() string {
    return fmt.Sprintf("host=%s port=%d", c.Host, c.Port)
}

func getenv(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
```

```go
// Consumers now receive config; they never read the environment themselves.
func dialDB(cfg config.DBConfig) (*sql.DB, error) {
    return sql.Open("postgres", cfg.DSN())
}

func migrateDB(cfg config.DBConfig) (*sql.DB, error) {
    return sql.Open("postgres", cfg.DSN()) // same DSN, guaranteed
}

func pingDB(db *sql.DB, cfg config.DBConfig) error {
    ctx, cancel := context.WithTimeout(context.Background(), cfg.PingTimeout)
    defer cancel()
    return db.PingContext(ctx)
}
```

**Reasoning.** The divergent defaults (`localhost` vs `127.0.0.1`) were a bug waiting to happen — two code paths can now never disagree because the default lives in exactly one place. Reading the environment is pushed to one `LoadDBConfig` called once at startup; every consumer takes `DBConfig` as a parameter, which also makes them trivially testable (no environment to stub). The `DSN()` method removes the duplicated connection-string assembly. This is the "configuration sprawl" anti-pattern resolved: one typed struct, one loader, explicit injection.

</details>

---

### Task 5 — Validate config at startup, fail fast (Python)

🟡 **Difficulty:** medium

**Scenario.** Config is a free-form dict read lazily wherever it is needed. A missing `MAX_UPLOAD_MB` does not surface until a user three hours into the day uploads a file — then a `KeyError` 500s mid-request. An invalid `WORKER_COUNT="eight"` blows up only when the pool tries to spin up.

```python
import os

config = {
    "max_upload_mb": os.environ.get("MAX_UPLOAD_MB"),
    "worker_count": os.environ.get("WORKER_COUNT"),
    "redis_url": os.environ.get("REDIS_URL"),
}

def handle_upload(file):
    limit = int(config["max_upload_mb"]) * 1024 * 1024  # blows up at request time
    if file.size > limit:
        raise TooLarge()
```

**Instruction.** Parse and validate all config once at startup. If anything is missing or malformed, refuse to boot with a clear, aggregated error message. The running code should only ever see valid, typed values.

<details><summary>Solution</summary>

```python
from dataclasses import dataclass
import os


class ConfigError(Exception):
    """Raised at startup when configuration is missing or malformed."""


@dataclass(frozen=True)
class AppConfig:
    max_upload_bytes: int
    worker_count: int
    redis_url: str

    @classmethod
    def from_env(cls) -> "AppConfig":
        errors: list[str] = []

        max_upload_mb = _require_int("MAX_UPLOAD_MB", errors, minimum=1)
        worker_count = _require_int("WORKER_COUNT", errors, minimum=1)
        redis_url = os.environ.get("REDIS_URL")
        if not redis_url:
            errors.append("REDIS_URL is required")

        if errors:
            raise ConfigError(
                "Invalid configuration:\n  - " + "\n  - ".join(errors)
            )

        return cls(
            max_upload_bytes=max_upload_mb * 1024 * 1024,
            worker_count=worker_count,
            redis_url=redis_url,
        )


def _require_int(key: str, errors: list[str], *, minimum: int) -> int:
    raw = os.environ.get(key)
    if raw is None:
        errors.append(f"{key} is required")
        return 0
    try:
        value = int(raw)
    except ValueError:
        errors.append(f"{key} must be an integer, got {raw!r}")
        return 0
    if value < minimum:
        errors.append(f"{key} must be >= {minimum}, got {value}")
    return value


# At startup (e.g. in main / app factory), before serving any traffic:
CONFIG = AppConfig.from_env()


def handle_upload(file):
    if file.size > CONFIG.max_upload_bytes:  # already an int, already validated
        raise TooLarge()
```

**Reasoning.** Fail-fast means the process refuses to start with bad config instead of crashing mid-request hours later. Errors are *aggregated*: one boot tells you everything wrong, so you fix three env vars in one cycle instead of discovering them one redeploy at a time. After `from_env` succeeds, the rest of the program handles only typed, in-range values — `max_upload_bytes` is an `int`, never a maybe-`None`-maybe-`str`. The frozen dataclass also makes the config immutable, closing the "mutable global config read at arbitrary times" anti-pattern. Validation lives at the boundary; business logic stays clean.

</details>

---

### Task 6 — Replace a stringly-typed config map with a typed struct (Go)

🟡 **Difficulty:** medium

**Scenario.** A service is configured by `map[string]string`. Every consumer re-parses the same string, picks its own default, and discovers malformed values only when it touches them. `cfg["retry_enabled"]` is the string `"true"`, and somewhere a careless `== "yes"` check silently disables retries.

```go
func NewWorker(cfg map[string]string) *Worker {
    return &Worker{
        retries:    cfg["max_retries"],   // a string!
        retryDelay: cfg["retry_delay"],   // a string like "500ms"
        enabled:    cfg["retry_enabled"], // "true" / "false" / "" / "yes"...
    }
}

func (w *Worker) run() {
    n, _ := strconv.Atoi(w.retries) // error ignored; "" -> 0 retries silently
    delay, _ := time.ParseDuration(w.retryDelay)
    for i := 0; i < n; i++ {
        time.Sleep(delay)
    }
}
```

**Instruction.** Replace the string map with a typed struct parsed once. Each field gets its real type (`int`, `time.Duration`, `bool`). Parsing errors are reported, not swallowed.

<details><summary>Solution</summary>

```go
package worker

import (
    "fmt"
    "strconv"
    "time"
)

type RetryConfig struct {
    MaxRetries int
    Delay      time.Duration
    Enabled    bool
}

func ParseRetryConfig(raw map[string]string) (RetryConfig, error) {
    cfg := RetryConfig{MaxRetries: 3, Delay: 500 * time.Millisecond, Enabled: true}

    if v, ok := raw["max_retries"]; ok {
        n, err := strconv.Atoi(v)
        if err != nil {
            return RetryConfig{}, fmt.Errorf("max_retries %q: %w", v, err)
        }
        cfg.MaxRetries = n
    }
    if v, ok := raw["retry_delay"]; ok {
        d, err := time.ParseDuration(v)
        if err != nil {
            return RetryConfig{}, fmt.Errorf("retry_delay %q: %w", v, err)
        }
        cfg.Delay = d
    }
    if v, ok := raw["retry_enabled"]; ok {
        b, err := strconv.ParseBool(v) // accepts 1/0/t/f/true/false, rejects "yes"
        if err != nil {
            return RetryConfig{}, fmt.Errorf("retry_enabled %q: %w", v, err)
        }
        cfg.Enabled = b
    }
    return cfg, nil
}

func NewWorker(cfg RetryConfig) *Worker {
    return &Worker{cfg: cfg}
}

func (w *Worker) run() {
    if !w.cfg.Enabled {
        return
    }
    for i := 0; i < w.cfg.MaxRetries; i++ {
        time.Sleep(w.cfg.Delay)
    }
}
```

**Reasoning.** The string map pushed parsing and defaulting onto every consumer, so the same `strconv.Atoi` ran in five places with five swallowed errors — a missing key silently became `0` retries. The typed `RetryConfig` parses once at the boundary and reports failures instead of hiding them (`max_retries "abc": invalid syntax`). `strconv.ParseBool` rejects `"yes"` loudly, killing the silent-disable bug. Downstream code reads `w.cfg.MaxRetries` as an `int` and `w.cfg.Enabled` as a `bool`; the stringliness is gone. Defaults live in one place, not scattered per call site.

</details>

---

### Task 7 — Remove hard-coded `if env == "prod"` (Java)

🟡 **Difficulty:** medium

**Scenario.** Environment-specific behavior is smeared through the codebase as `if (env.equals("prod"))` checks. Adding a "staging" environment means hunting every such branch; getting one wrong means staging sends real emails or prod points at the sandbox payment gateway.

```java
public class NotificationService {
    private final String env = System.getenv("APP_ENV");

    public void send(Notification n) {
        if (env.equals("prod")) {
            realEmailGateway.send(n);
        } else {
            logger.info("Would send: {}", n); // dev/staging
        }
    }

    public String paymentUrl() {
        if (env.equals("prod")) {
            return "https://api.payments.com";
        }
        return "https://sandbox.payments.com";
    }
}
```

**Instruction.** Replace the scattered environment checks with explicit, injected configuration. The class should depend on *capabilities and values*, not on a string it interrogates. Adding an environment must not require touching this class.

<details><summary>Solution</summary>

```java
// What the code actually cares about — declared as config, not deduced from a string.
public record NotificationConfig(
    boolean emailDeliveryEnabled,
    URI paymentBaseUrl
) {}

public class NotificationService {
    private final NotificationConfig config;
    private final EmailGateway emailGateway;

    public NotificationService(NotificationConfig config, EmailGateway emailGateway) {
        this.config = config;
        this.emailGateway = emailGateway;
    }

    public void send(Notification n) {
        if (config.emailDeliveryEnabled()) {
            emailGateway.send(n);
        } else {
            logger.info("Email delivery disabled; would send: {}", n);
        }
    }

    public URI paymentUrl() {
        return config.paymentBaseUrl();
    }
}
```

```java
// The environment-to-config mapping lives in ONE place (composition root):
public final class ConfigFactory {
    public static NotificationConfig forEnv(String env) {
        return switch (env) {
            case "prod" -> new NotificationConfig(true,  URI.create("https://api.payments.com"));
            case "staging" -> new NotificationConfig(false, URI.create("https://sandbox.payments.com"));
            case "dev" -> new NotificationConfig(false, URI.create("https://sandbox.payments.com"));
            default -> throw new IllegalArgumentException("Unknown APP_ENV: " + env);
        };
    }
}
```

**Reasoning.** `if (env.equals("prod"))` couples behavior to a string and scatters the same decision across methods — the classic "hard-coded environment check" anti-pattern. The fix names the *actual* axes of variation: "is email delivery on?" and "which payment URL?". The class now depends on those values, so it has no idea what environment it runs in and is trivially unit-testable (`new NotificationConfig(false, sandboxUri)`). All environment knowledge collapses into one `switch` at the composition root; adding "qa" is one case there, not a grep across the codebase. The `default` branch fails fast on an unknown environment instead of silently behaving like dev.

</details>

---

### Task 8 — Move a secret out of code into injected config (Python)

🔴 **Difficulty:** hard

**Scenario.** An API key and a database password are hard-coded as module constants. They are in git history forever, visible to everyone with read access, identical across every environment, and rotating them means a code change and a deploy.

```python
# payments.py  — committed to the repo
STRIPE_API_KEY = "sk_live_<FAKE_EXAMPLE_KEY_DO_NOT_USE>"
DB_PASSWORD = "hunter2-prod-primary"


def charge(amount_cents: int, token: str):
    stripe.api_key = STRIPE_API_KEY
    return stripe.Charge.create(amount=amount_cents, source=token)


def connect():
    return psycopg2.connect(
        host="db.internal", user="app", password=DB_PASSWORD
    )
```

**Instruction.** Remove the secrets from the source. Inject them from the environment (or a secrets manager) and fail fast if a required secret is absent. Note what must also happen outside the code.

<details><summary>Solution</summary>

```python
import os
from dataclasses import dataclass


class ConfigError(Exception):
    pass


def _require_secret(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise ConfigError(f"{key} is not set; refusing to start")
    return value


@dataclass(frozen=True)
class Secrets:
    stripe_api_key: str
    db_password: str

    @classmethod
    def load(cls) -> "Secrets":
        # In production these env vars are populated by the secrets manager
        # (Vault / AWS Secrets Manager / k8s Secret), never written to disk in the repo.
        return cls(
            stripe_api_key=_require_secret("STRIPE_API_KEY"),
            db_password=_require_secret("DB_PASSWORD"),
        )


def charge(secrets: Secrets, amount_cents: int, token: str):
    stripe.api_key = secrets.stripe_api_key
    return stripe.Charge.create(amount=amount_cents, source=token)


def connect(secrets: Secrets):
    return psycopg2.connect(
        host="db.internal", user="app", password=secrets.db_password
    )
```

**Reasoning.** Code-level fixes alone are not enough — the secret is still in git history. The full remediation has steps outside the source:

1. **Rotate immediately.** Anything committed is compromised. Issue new `sk_live_…` and DB credentials and revoke the old ones; assume the leaked values are public.
2. **Remove from source** and read from the environment, as above. The secrets are now injected, differ per environment, and rotate without a deploy.
3. **Fail fast** on a missing secret (`_require_secret`) — the process refuses to boot rather than running with `api_key = None` and failing on the first charge.
4. **Prevent recurrence.** Add the values to `.gitignore`d local files, wire a pre-commit secret scanner (e.g. `gitleaks`/`detect-secrets`), and source production values from a real secrets manager. Optionally purge history with `git filter-repo`, but rotation is what actually closes the exposure.

The injected `Secrets` object keeps business functions dependency-explicit and testable with dummy values, with no global mutable secret state.

</details>

---

### Task 9 — Turn a silent default into an explicit required value (Go)

🔴 **Difficulty:** hard

**Scenario.** A signing service falls back to a built-in default signing key when `SIGNING_KEY` is unset. In dev this is convenient. In production, a misconfigured deploy left `SIGNING_KEY` empty — the service happily signed every token with the well-known default key, and the bug was invisible because everything "worked".

```go
func loadSigningKey() []byte {
    key := os.Getenv("SIGNING_KEY")
    if key == "" {
        key = "dev-default-signing-key" // silent, dangerous fallback
    }
    return []byte(key)
}
```

**Instruction.** Make the signing key *required*: a missing value must stop the program with a clear error, not silently degrade to a known-insecure default. Preserve developer convenience without weakening production.

<details><summary>Solution</summary>

```go
package signing

import (
    "errors"
    "fmt"
    "os"
)

var ErrMissingSigningKey = errors.New("SIGNING_KEY is required and was not set")

// LoadSigningKey returns an error instead of a silent fallback.
func LoadSigningKey() ([]byte, error) {
    key := os.Getenv("SIGNING_KEY")
    if key == "" {
        return nil, ErrMissingSigningKey
    }
    if len(key) < 32 {
        return nil, fmt.Errorf("SIGNING_KEY too short: need >= 32 bytes, got %d", len(key))
    }
    return []byte(key), nil
}
```

```go
// Called once at startup. A missing key now stops the boot, loudly.
func main() {
    key, err := signing.LoadSigningKey()
    if err != nil {
        log.Fatalf("startup: %v", err)
    }
    // ... wire key into the signer ...
}
```

```bash
# Developer convenience without a code-level fallback:
# a checked-in .env.example documents the requirement,
# and a local-only .env (gitignored) supplies a value.
# SIGNING_KEY=local-dev-key-please-override-1234567890ab
```

**Reasoning.** A silent default that is *also a security boundary* is the worst kind — it fails closed-but-wrong: the system runs, so monitoring stays green, while every token is forgeable with a public key. Making the value required converts a silent production compromise into a loud, immediate boot failure. Convenience is preserved by moving the dev value *out of code* into a gitignored `.env` (documented by a committed `.env.example`), so developers get a working default without the binary ever shipping one. The length check adds a second fail-fast guard against a present-but-too-weak key. General rule: a default is acceptable only when *any* of its values is safe; for security-critical config, require it.

</details>

---

### Task 10 — Design a feature flag with a retirement plan (Java)

🔴 **Difficulty:** hard

**Scenario.** The team wants to roll out a new checkout flow behind a flag. The last three flags they added are still in the code two years later as permanent dead branches, because nobody recorded who owned them or when they should die. You are asked to add the flag *correctly* this time.

```java
// How NOT to do it — an immortal flag with no owner and no expiry:
public class Checkout {
    public Receipt checkout(Cart cart) {
        if (System.getenv("NEW_CHECKOUT") != null) {
            return newFlow(cart);
        }
        return oldFlow(cart);
    }
}
```

**Instruction.** Design the flag with a built-in retirement plan: a single typed flag definition that records owner, creation date, intended expiry, and the rollout type (temporary vs permanent). Make a stale flag *visible* so it cannot quietly become immortal. Then describe the retirement steps.

<details><summary>Solution</summary>

```java
public enum FlagType { RELEASE_TEMPORARY, OPS_PERMANENT }

public record FeatureFlag(
    String key,
    String owner,            // a person/team, not "platform"
    LocalDate createdOn,
    LocalDate expiresOn,     // for temporary flags, the date it MUST be gone
    FlagType type
) {
    public boolean isStale(LocalDate today) {
        return type == FlagType.RELEASE_TEMPORARY && !today.isBefore(expiresOn);
    }
}

public final class Flags {
    public static final FeatureFlag NEW_CHECKOUT = new FeatureFlag(
        "new_checkout",
        "checkout-team",
        LocalDate.of(2026, 6, 10),
        LocalDate.of(2026, 9, 10),   // 90-day rollout window
        FlagType.RELEASE_TEMPORARY
    );
}
```

```java
public class Checkout {
    private final FeatureFlags flags; // a provider that resolves enabled/disabled per request

    public Receipt checkout(Cart cart) {
        if (flags.isEnabled(Flags.NEW_CHECKOUT)) {
            return newFlow(cart);
        }
        return oldFlow(cart);
    }
}
```

```java
// A scheduled job (or a CI check / unit test) makes staleness LOUD:
@Test
void no_temporary_flag_is_past_its_expiry() {
    LocalDate today = LocalDate.now();
    var stale = Flags.all().stream()
        .filter(f -> f.isStale(today))
        .map(FeatureFlag::key)
        .toList();
    assertThat(stale)
        .as("Temporary flags past expiry must be retired: %s", stale)
        .isEmpty();
}
```

**Reasoning.** The original flag had no owner, no expiry, and read the environment inline — the exact recipe for an immortal flag. The typed `FeatureFlag` records the four facts that prevent that: *who* owns it, *when* it was born, *when* it must die, and *whether* it is even allowed to die (`RELEASE_TEMPORARY`) or is a deliberate permanent operations switch (`OPS_PERMANENT`). The failing unit test turns "we forgot to remove it" into a red build the day it expires — staleness becomes loud instead of silent. Resolution goes through a `FeatureFlags` provider, so the on/off decision is centralized and testable rather than a raw `getenv` smeared through business logic.

**Retirement steps**, once the new flow is fully ramped and stable:

1. Make the chosen branch unconditional; delete the dead branch (`oldFlow`).
2. Delete the flag definition (`Flags.NEW_CHECKOUT`) and the `isEnabled` call.
3. Remove the flag from the flag-management system / config.
4. Delete now-dead supporting code and tests for the abandoned branch.

Task 11 walks through writing that removal PR.

</details>

---

### Task 11 — Write the flag-removal PR (Python)

🔴 **Difficulty:** hard

**Scenario.** The `use_new_search` flag from six months ago is at 100% rollout and stable. It is now a permanent `if` that everyone reads past. Your job is to retire it: produce the actual diff and a PR description that an on-call reviewer can approve with confidence.

```python
# search.py — flag is at 100%, the old branch is dead
from config import flags


def search(query: str, user: User) -> list[Result]:
    if flags.is_enabled("use_new_search", user):
        return _vector_search(query)
    return _keyword_search(query)  # legacy, no longer reached in any environment


def _vector_search(query: str) -> list[Result]:
    ...


def _keyword_search(query: str) -> list[Result]:
    # 120 lines of legacy code, plus its own helpers and tests
    ...
```

**Instruction.** Write the post-removal code (the flag and the dead branch gone) and draft the PR description: what changed, why it is safe, and how to roll back.

<details><summary>Solution</summary>

```python
# search.py — after retirement
def search(query: str, user: User) -> list[Result]:
    return _vector_search(query)


def _vector_search(query: str) -> list[Result]:
    ...

# _keyword_search and its helpers are deleted.
# The "use_new_search" entry is removed from the flag config and the flag service.
# Tests asserting the legacy branch are deleted; tests for _vector_search stay.
```

**PR description:**

> **Retire feature flag `use_new_search`**
>
> **What.** Removes the `use_new_search` flag, makes vector search the unconditional path, and deletes the dead `_keyword_search` branch (~120 lines) plus its helpers and tests. Also removes the flag entry from `config/flags.yaml` and the flag service.
>
> **Why now.** Flag has been at 100% rollout since 2026-01-10 (five months), with no incidents and no rollbacks. Owner: `search-team`. It hit its retirement date in the flag registry. Keeping it is pure carrying cost: every reader pays attention to a branch that can never execute, and the legacy code blocks an upcoming index migration.
>
> **Why it is safe.** The removed branch has had zero traffic in all environments since the 100% ramp (verified via flag-evaluation metrics, linked in the issue). Behavior at runtime is unchanged: the only reachable path before this PR was `_vector_search`, and that is exactly what remains. Test suite passes; coverage of the surviving path is unchanged.
>
> **Rollback.** This is a code-revert rollback, not a flag flip — if vector search regresses, revert this PR. Note the legacy keyword path is being deleted, so re-enabling it later would mean restoring that code, not toggling a flag. We are confident enough to accept that, given five months of stable 100% rollout. (If the team were not yet confident, the correct move would be to keep the flag longer, *not* to merge this PR.)

**Reasoning.** Flag retirement is a first-class engineering task, not cleanup that happens "eventually". The removal deletes three things together — the `if`, the dead branch, and the flag registration — because leaving any one behind recreates the rot. The PR description does the reviewer's risk assessment for them: it proves the branch was already the only live path (so runtime behavior is unchanged), cites the metrics that justify "safe", and is explicit that rollback is now a code revert rather than a flag flip. That last point is the honest part most teams skip: deleting the old branch trades easy rollback for a smaller, clearer codebase, and the PR states that trade openly so the reviewer approves with eyes open.

</details>

---

### Task 12 — Config audit (open-ended, Go)

🔴 **Difficulty:** hard

**Scenario.** Below is a real-looking service constructor. Identify **every** configuration / constant / feature-flag smell, and write a one-line fix for each.

```go
func NewService() *Service {
    apiKey := "ak_live_3f9c2b8e1d7a6054"            // (1)
    timeout := 30                                    // (2)

    region := os.Getenv("REGION")                    // (3)
    if region == "" {
        region = "us-east-1"
    }

    var endpoint string
    if os.Getenv("APP_ENV") == "prod" {              // (4)
        endpoint = "https://api.example.com"
    } else {
        endpoint = "https://staging.example.com"
    }

    settings := map[string]string{                   // (5)
        "max_conns":  os.Getenv("MAX_CONNS"),
        "enable_v2":  os.Getenv("ENABLE_V2"),         // (6)
    }

    maxConns, _ := strconv.Atoi(settings["max_conns"]) // (7)

    return &Service{
        apiKey:   apiKey,
        timeout:  time.Duration(timeout) * time.Second,
        region:   region,
        endpoint: endpoint,
        maxConns: maxConns,
        v2:       settings["enable_v2"] == "true",
    }
}
```

**Instruction.** Produce a table: each numbered smell, its category, and a one-line fix. Then give the recommended order of attack.

<details><summary>Solution</summary>

| # | Smell | Category | One-line fix |
|---|-------|----------|--------------|
| 1 | `apiKey` hard-coded literal | Secret in code | Rotate it now, read from env/secrets manager, fail fast if unset (Task 8). |
| 2 | `timeout := 30` | Magic number | Name it: `const defaultTimeout = 30 * time.Second`, expressed in its unit (Task 1). |
| 3 | `REGION` with inline default | Config sprawl | Move into one typed `Config` loaded once; default lives in the loader (Task 4). |
| 4 | `if APP_ENV == "prod"` | Hard-coded env check | Inject `endpoint` as config; map env→endpoint at the composition root (Task 7). |
| 5 | `map[string]string` settings | Stringly-typed config | Parse into a typed struct with real field types, once (Task 6). |
| 6 | `enable_v2` flag, no owner/expiry | Immortal feature flag risk | Define it as a typed `FeatureFlag` with owner + expiry + retirement plan (Task 10). |
| 7 | `strconv.Atoi(...)` error ignored | Silent default | Report the parse error and fail fast; an empty `MAX_CONNS` must not silently mean 0 (Task 5). |

**Recommended order of attack:**

1. **Rotate and remove the secret (1)** — security first; everything else can wait, a leaked live key cannot.
2. **Introduce a typed `Config` struct + single loader (3, 5)** — gives every later fix a home.
3. **Parse with validation and fail-fast (7, 2)** — no more swallowed errors or silent zeros; named constants for defaults.
4. **Inject environment-specific values (4)** — collapse the `if prod` into one env→config map at startup.
5. **Promote `enable_v2` to a managed flag (6)** — owner, expiry date, and a staleness test so it does not become immortal.

The end state: one `Config` struct, loaded and validated once at startup, with secrets injected, no environment strings interrogated in business code, and the one feature flag carrying its own death certificate.

</details>

---

## Self-Assessment

Rate yourself on each. If any answer is "no", revisit the linked task.

- [ ] I can name a magic number/string at the **right scope** — package-private constant vs domain enum vs runtime config (Tasks 1, 2).
- [ ] I can spot a **boolean-trap** call site and convert it to named functions or a typed options object (Task 3).
- [ ] I consolidate duplicated settings into **one typed source** with a single set of defaults (Tasks 4, 6).
- [ ] I **validate config at startup** and aggregate errors so a bad deploy refuses to boot (Task 5).
- [ ] I never interrogate `env == "prod"` in business code; I inject the **values and capabilities** the code actually needs (Task 7).
- [ ] I keep **secrets out of source**, inject them, fail fast on absence, and know rotation is the real fix for a leak (Task 8).
- [ ] I make required values **explicit** rather than silently defaulting — especially across security boundaries (Task 9).
- [ ] Every temporary flag I add carries an **owner, an expiry, and a staleness check** (Task 10).
- [ ] I treat **flag retirement** as a first-class PR with a risk assessment and an honest rollback story (Task 11).
- [ ] I can **audit** a constructor and categorize every config smell at a glance (Task 12).

---

## Related Topics

- [Chapter README](../README.md) — the positive rules behind these exercises.
- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) — the rest of this topic's file set.
- [Meaningful Names](../01-meaningful-names/README.md) — naming the constants and config fields these tasks introduce.
- [Abstraction & Information Hiding](../22-abstraction-and-information-hiding/README.md) — why config readers should depend on values, not on where they come from.
- [Refactoring](../../refactoring/README.md) — the mechanical moves (Extract Constant, Introduce Parameter Object) used throughout.

> **Next:** [senior.md](senior.md) — config and feature-flag discipline at scale.
