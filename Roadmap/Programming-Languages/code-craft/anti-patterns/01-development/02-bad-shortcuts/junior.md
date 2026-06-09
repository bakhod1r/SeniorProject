# Bad Shortcuts Anti-Patterns — Junior Level

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Shortcuts** — *convenience taken now, paid back many times later.*
> **Covers (collectively):** Copy-Paste Programming · Magic Numbers / Strings · Hard Coding · Cargo Cult Programming · Pokémon Exception Handling · Stringly-Typed Programming

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Six at a Glance](#the-six-at-a-glance)
5. [Copy-Paste Programming](#copy-paste-programming)
6. [Magic Numbers / Magic Strings](#magic-numbers--magic-strings)
7. [Hard Coding](#hard-coding)
8. [Cargo Cult Programming](#cargo-cult-programming)
9. [Pokémon Exception Handling](#pokémon-exception-handling)
10. [Stringly-Typed Programming](#stringly-typed-programming)
11. [How They Reinforce Each Other](#how-they-reinforce-each-other)
12. [A Quick Spotting Checklist](#a-quick-spotting-checklist)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does it look like?** and **Why is it bad?**

The five [Bad Structure](../01-bad-structure/junior.md) anti-patterns were about the *shape* of code. This family is about **shortcuts** — small conveniences that feel like saving time but quietly create a debt that someone (often future-you) pays back with interest.

Every shortcut here shares one logic: *"the fast thing now."* Copy instead of extract. Type `86400` instead of naming it. Hard-code the URL instead of configuring it. Copy a snippet you don't understand. Swallow every error so the program doesn't crash *today*. Pass a `String` instead of a real type. Each is a tiny decision. Multiplied across a codebase and a year, they're why a "simple" change takes a week.

At the junior level your goal is to **recognize the shortcut as you're about to take it** and know the small habit that replaces it. The replacement is rarely more work — often it's the *same* work, done once, in the right place.

> **The mindset shift:** "it works" is not the same as "it's done." A shortcut that works today but confuses, breaks silently, or duplicates a bug across five files is a loan, not a gift.

---

## Prerequisites

- **Required:** You can write functions, use constants/enums, and handle errors/exceptions in at least one language (examples use Go, Java, Python).
- **Required:** You understand the [DRY principle](../../../clean-code/README.md) at a basic level — "don't repeat yourself."
- **Helpful:** You've experienced fixing a bug, then discovering the same bug copy-pasted somewhere else.
- **Helpful:** Basic awareness of configuration vs. code (environment variables, config files).

---

## Glossary

| Term | Definition |
|------|-----------|
| **DRY** | "Don't Repeat Yourself" — every piece of knowledge should have one authoritative place in the code. |
| **Magic value** | A literal number or string in code whose meaning isn't explained by a name. |
| **Constant** | A named, immutable value (`MAX_RETRIES = 3`) — the cure for magic values. |
| **Configuration** | Values that vary by environment (URLs, credentials, limits) kept *outside* source code. |
| **Enum** | A type with a fixed set of named values — replaces stringly-typed status/role fields. |
| **Swallowing an exception** | Catching an error and doing nothing, so the failure becomes invisible. |
| **Cargo cult** | Imitating a ritual without understanding it, expecting the result to follow. |
| **Stringly-typed** | (Pun on "strongly-typed.") Using `String` to represent things that should be real types. |

---

## The Six at a Glance

| Anti-pattern | One-line symptom | The cost later |
|---|---|---|
| **Copy-Paste Programming** | Same logic in N places | Fix the bug N times; miss one |
| **Magic Numbers / Strings** | Unexplained literals in logic | Nobody knows what `42` or `"WTF"` means |
| **Hard Coding** | URLs, keys, paths baked into source | Can't change env without a recompile; secrets leak |
| **Cargo Cult Programming** | Code copied without understanding | Carries bugs and noise you can't justify |
| **Pokémon Exception Handling** | "Gotta catch 'em all" → silence | Failures vanish; debugging becomes guesswork |
| **Stringly-Typed Programming** | `String` for everything | Typos become runtime bugs the compiler could've caught |

Each section below shows the shape, a concrete example, and the junior-level fix.

---

## Copy-Paste Programming

### What it looks like

You need similar logic in a new place, so you copy the existing block and tweak it. The same knowledge now lives in two (then three, then ten) places.

```python
# Python — the same discount logic, copied and slightly varied
def price_for_member(items):
    total = sum(i.price for i in items)
    if total > 100:                 # free shipping rule
        shipping = 0
    else:
        shipping = 9.99
    return total * 0.9 + shipping   # 10% member discount

def price_for_guest(items):
    total = sum(i.price for i in items)
    if total > 100:                 # SAME shipping rule, copied
        shipping = 0
    else:
        shipping = 9.99
    return total + shipping
```

### Why it's bad

- **A bug fixed in one copy stays alive in the others.** The free-shipping threshold changes to `150`? You must find and edit every copy — and you'll miss one.
- **It hides the real abstraction.** The duplication is a signal that there's a shared concept (`shipping_for(total)`) waiting to be named.
- **The codebase grows faster than it needs to,** and every copy is more to read.

### The junior-level fix

Extract the shared knowledge into one function and call it. This is [DRY](../../../clean-code/README.md) in practice.

```python
def shipping_for(total):
    return 0 if total > 100 else 9.99        # one place, one truth

def price(items, member: bool):
    total = sum(i.price for i in items)
    discount = 0.9 if member else 1.0
    return total * discount + shipping_for(total)
```

> **Smell test:** before you press Ctrl-V on code, ask "is this *knowledge* I'm duplicating?" If yes, extract it instead. (Beware the opposite trap too — see [Common Mistakes](#common-mistakes) on coincidental duplication.)

---

## Magic Numbers / Magic Strings

### What it looks like

Unexplained literals embedded directly in logic. The reader has to guess what `86400`, `7`, or `"WTF"` means.

```java
// Java — what do these mean?
if (user.getStatus().equals("3")) { ... }          // 3 = ??
if (elapsed > 86400) { expire(session); }           // 86400 = ??
double price = base * 1.08;                          // 1.08 = ??
```

### Why it's bad

- **No one knows the meaning.** Is `1.08` tax? A markup? A fudge factor? The number can't tell you.
- **The same magic value appears in multiple places** with no link between them, so changing "the tax rate" means hunting for `1.08` everywhere (and you might hit an unrelated `1.08`).
- **Typos are invisible:** `8640` instead of `86400` looks fine and breaks silently.

### The junior-level fix

Give each value a name. The name *is* the documentation.

```java
static final int    SECONDS_PER_DAY = 86_400;
static final double SALES_TAX_RATE  = 0.08;
static final String STATUS_SUSPENDED = "3";   // better still: an enum (see Stringly-Typed)

if (user.getStatus().equals(STATUS_SUSPENDED)) { ... }
if (elapsed > SECONDS_PER_DAY) { expire(session); }
double price = base * (1 + SALES_TAX_RATE);
```

> **Smell test:** if a literal in your code needs a comment to explain it, it needs a *name* instead. (Exceptions: truly self-evident values like `0`, `1`, or `2` in `total / 2`.)

---

## Hard Coding

### What it looks like

Environment-specific or deployment-specific values — URLs, file paths, credentials, feature limits — baked directly into source code.

```go
// Go — hard-coded everything
func connect() *DB {
    return open("postgres://admin:S3cr3t@10.0.0.5:5432/prod")  // credentials in source!
}

const uploadDir = "/Users/alex/dev/app/uploads"   // works only on Alex's laptop
```

### Why it's bad

- **It can't move between environments.** Dev, staging, and prod need different URLs; hard-coding forces a code change (and redeploy) to switch.
- **It leaks secrets.** Credentials in source end up in git history forever and in every clone — a serious security hole. (See [Secrets Management](../../../../../Architecture/system-design/README.md).)
- **It breaks on other machines.** `/Users/alex/...` exists only on Alex's laptop.

### The junior-level fix

Move environment-specific values to **configuration** — environment variables or a config file — and read them at startup.

```go
func connect() *DB {
    dsn := os.Getenv("DATABASE_URL")   // injected per environment, never in source
    return open(dsn)
}

uploadDir := os.Getenv("UPLOAD_DIR")
```

> **Smell test:** ask "would this value be different in production than on my laptop?" or "is this a password/key?" If yes, it belongs in configuration, not source. **Secrets never go in git.**

---

## Cargo Cult Programming

### What it looks like

Copying code from a tutorial, Stack Overflow, or another project and keeping it *without understanding why it's there*. The name comes from post-WWII Pacific islanders who built straw "runways" hoping to summon cargo planes — imitating the ritual without grasping the cause.

```python
# Python — copied from a blog; nobody knows why these lines exist
import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"   # ?? copied "to fix a warning"

def load(path):
    time.sleep(0.1)          # "the example had this, leaving it in"
    df = pd.read_csv(path)
    df = df.copy()           # "saw this somewhere, seems safe"
    return df.reset_index().reset_index()   # reset twice "just in case"
```

### Why it's bad

- **It carries noise and bugs.** Lines that did something in the original context do nothing (or something harmful) in yours.
- **It can't be maintained.** If you don't know why a line is there, you can't safely change or remove it — it becomes [Lava Flow](../01-bad-structure/junior.md).
- **It blocks learning.** The shortcut skips the understanding that would make you faster next time.

### The junior-level fix

Before keeping any borrowed line, **be able to explain what it does and why you need it.** If you can't justify it, remove it and see what breaks (in a test). Read the documentation for the API you're using.

> **Smell test:** if your honest answer to "why is this line here?" is *"the example had it"* or *"just in case,"* you're cargo-culting. Delete it or learn it.

---

## Pokémon Exception Handling

### What it looks like

"Gotta catch 'em all" — wrapping code in a catch-everything block that swallows the error and continues as if nothing happened.

```java
// Java
try {
    chargeCard(order);
    saveOrder(order);
} catch (Exception e) {
    // nothing. the order silently fails. customer thinks it worked.
}
```

```python
# Python — the same crime
try:
    result = risky()
except:        # bare except: catches EVERYTHING, even Ctrl-C
    pass
```

### Why it's bad

- **Failures become invisible.** The card charge fails, but the code continues — now you have a corrupt order and no error, no log, no trace.
- **Debugging becomes guesswork.** The one piece of information that would explain the bug (the exception) was thrown away.
- **It hides bugs you didn't even know about** — a `NullPointerException` from a real coding mistake gets swallowed alongside the network error.

### The junior-level fix

Catch only what you can actually handle, do something meaningful (retry, log with context, return a clear error), and let everything else propagate loudly.

```java
try {
    chargeCard(order);
} catch (PaymentDeclinedException e) {
    return Result.failed("Card declined: " + e.getReason());  // handled meaningfully
}
// a bug like NullPointerException is NOT caught here — it crashes loudly, as it should
```

> **Smell test:** an empty catch block, a bare `except:`, or `catch (Exception e) {}` is almost always wrong. If you catch it, *do something* with it. See [Error Handling](../../../clean-code/06-error-handling/README.md).

---

## Stringly-Typed Programming

### What it looks like

A pun on "strongly-typed": using `String` (or raw ints) to represent things that have a fixed, meaningful set of values — statuses, roles, types, units — so the type system carries no information.

```java
// Java — everything is a String
void setRole(String role) { ... }     // "admin"? "Admin"? "ADMINISTRATOR"? "amdin"?
void transition(String status) { ... } // any typo compiles fine, fails at runtime

setRole("admni");                       // compiles! breaks in production
```

### Why it's bad

- **Typos become runtime bugs.** `"admni"` compiles cleanly; the compiler can't help because every string is "valid."
- **No discoverability.** A new developer can't ask the type "what are the valid roles?" — they have to grep the codebase and hope.
- **Invalid states are representable.** Nothing stops `status = "banana"`.

### The junior-level fix

Use an **enum** (or a small dedicated type). Now the compiler rejects illegal values and your IDE lists the valid ones.

```java
enum Role { ADMIN, EDITOR, VIEWER }

void setRole(Role role) { ... }   // setRole(Role.ADMN) → won't compile. Typo caught instantly.
```

```python
from enum import Enum
class Status(Enum):
    PENDING = "pending"
    ACTIVE  = "active"
    CLOSED  = "closed"
```

> **Smell test:** if a `String`/`int` parameter only accepts a fixed handful of values, it wants to be an enum or a domain type. Let the compiler reject illegal states. (Idea: *"make illegal states unrepresentable."*)

---

## How They Reinforce Each Other

Bad shortcuts cluster — taking one makes the others easier:

```mermaid
graph TD
    CC[Cargo Cult] --> CP[Copy-Paste]
    CC --> PE[Pokémon Exceptions]
    HC[Hard Coding] --> MN[Magic Numbers/Strings]
    ST[Stringly-Typed] --> MN
    CP -. "duplicated magic values" .-> MN
    MN -. "unexplained literals copied around" .-> CP
```

- **Cargo Cult** code is **Copy-Pasted** wholesale and often includes a **Pokémon** `try/except: pass` from the original.
- **Magic Strings** and **Stringly-Typed** code go hand in hand: `status == "3"` is both.
- **Hard-coded** values are usually **Magic** too — `"postgres://10.0.0.5"` is an unexplained literal *and* an environment value in the wrong place.

The common root: **skipping the small naming/extraction/understanding step now.** Each shortcut defers that step and adds interest.

---

## A Quick Spotting Checklist

Run over any file you touch this week:

- [ ] Did I just copy a block and tweak it? → **Copy-Paste** (extract instead)
- [ ] Is there a bare literal (`42`, `"3"`, `0.08`) doing real work? → **Magic Number/String** (name it)
- [ ] Is there a URL, path, or credential in source? → **Hard Coding** (configure it; secrets out of git)
- [ ] Is there a line I can't explain? → **Cargo Cult** (justify or delete)
- [ ] Is there an empty `catch` / bare `except:` / `catch(Exception){}`? → **Pokémon** (handle or propagate)
- [ ] Is a `String`/`int` carrying a fixed set of meanings? → **Stringly-Typed** (use an enum)

---

## Common Mistakes

1. **"DRY everything" → over-extraction.** Two pieces of code that *look* the same but represent *different knowledge* (coincidental duplication) should NOT be merged — they'll diverge and the shared function becomes a tangle of flags. DRY is about *knowledge*, not *text*. (More in `middle.md`.)
2. **Naming a magic number with another magic number.** `final int THREE = 3;` names the *value*, not the *meaning*. Name the concept: `MAX_LOGIN_ATTEMPTS = 3`.
3. **Catching to "log and rethrow" but losing the cause.** `catch (Exception e) { throw new RuntimeException("failed"); }` discards the original stack trace. Always wrap with the cause: `throw new RuntimeException("...", e)`.
4. **Moving secrets to a config file that's still committed to git.** Configuration that contains secrets must come from the environment or a secrets manager — a committed `config.yaml` with a password is still a leak.
5. **Replacing magic strings with an enum, then doing `enum.name()` and comparing strings again.** Use the enum value directly; don't round-trip back to strings.
6. **Thinking these are "just style."** A swallowed exception or a hard-coded credential is a *bug* and a *security risk*, not a cosmetic preference.

---

## Test Yourself

1. Name the six Bad-Shortcut anti-patterns and the one-line cost of each.
2. You find the literal `0.08` in twelve files. What anti-pattern(s) is this, and what's the fix?
3. What's the difference between a **Magic String** and **Stringly-Typed** programming? (They overlap — explain how.)
4. Why is `except: pass` worse than letting the program crash?
5. Your teammate says "we should never duplicate any code, ever — DRY!" Why is that statement too strong?
6. Rewrite safely:
   ```java
   try {
       int n = Integer.parseInt(input);
       process(n);
   } catch (Exception e) {}
   ```

<details>
<summary>Answers</summary>

1. **Copy-Paste** (fix the bug N times, miss one), **Magic Numbers/Strings** (nobody knows what the literal means), **Hard Coding** (can't change env without redeploy; secrets leak), **Cargo Cult** (carries bugs/noise you can't justify), **Pokémon Exceptions** (failures vanish, debugging by guesswork), **Stringly-Typed** (typos become runtime bugs).
2. **Magic Number** (an unexplained literal), and the repetition across files is also a form of **Copy-Paste** of that knowledge. Fix: define one named constant (`SALES_TAX_RATE = 0.08`) in a single authoritative place and reference it everywhere.
3. A **Magic String** is *any* unexplained string literal in logic (`"3"`, `"WTF"`). **Stringly-Typed** is the broader design choice of using `String` as the *type* for something with a fixed value set (status, role). They overlap when a magic string is also the value of a stringly-typed field — `if (status.equals("3"))`. Fix for both: an enum.
4. A crash gives you a stack trace, a message, and a clear failure signal — you can debug it. `except: pass` deletes all of that and lets the program continue in a corrupt state, so the failure surfaces later, far from its cause, with no information. A loud failure is cheaper than a silent corruption.
5. Because DRY is about not duplicating *knowledge*, not avoiding all textual similarity. Two functions that look identical today but encode *different* business rules (e.g. member vs guest pricing that just happen to match now) will diverge; merging them forces flags and re-coupling. Forcing them into one abstraction (over-DRY) creates worse coupling than the duplication.
6. ```java
   try {
       int n = Integer.parseInt(input);
       process(n);
   } catch (NumberFormatException e) {
       return Result.failed("Invalid number: " + input);  // handle the expected failure
   }
   // Note: only NumberFormatException is caught. A bug inside process() propagates loudly.
   ```

</details>

---

## Cheat Sheet

| Anti-pattern | Spot it by | Fix it with |
|---|---|---|
| **Copy-Paste** | The same logic in multiple places | Extract one function; [DRY](../../../clean-code/README.md) (knowledge, not text) |
| **Magic Numbers/Strings** | Bare literals doing real work | Named constants / enums |
| **Hard Coding** | URLs, paths, secrets in source | Configuration / env vars; secrets out of git |
| **Cargo Cult** | Lines you can't explain | Justify or delete; read the docs |
| **Pokémon Exceptions** | Empty `catch` / bare `except:` | Catch what you handle; log with context; propagate the rest |
| **Stringly-Typed** | `String`/`int` with a fixed value set | Enums / domain types — let the compiler reject illegal states |

> **One rule to remember:** *A shortcut that saves a minute now and costs an hour later — every time the code is touched — was never a shortcut.*

---

## Summary

- **Bad shortcuts** trade a small convenience now for a recurring cost later: duplicated bugs, unexplained values, unmovable code, unjustifiable lines, invisible failures, and compiler-blind types.
- **Copy-Paste**: extract the shared knowledge. **Magic Numbers/Strings**: name them. **Hard Coding**: configure it, keep secrets out of git. **Cargo Cult**: justify every line or delete it. **Pokémon Exceptions**: handle what you can, propagate the rest loudly. **Stringly-Typed**: use enums so the compiler catches typos.
- They cluster and reinforce each other; the shared root is *skipping the small naming/extraction/understanding step.*
- At the junior level, the fix is almost never more work — it's the same work, done once, in the right place.
- Next: [`middle.md`](middle.md) — when these creep in under deadline pressure, the DRY-vs-coincidental-duplication nuance, and how to design them out.

---

## Further Reading

- **The Pragmatic Programmer** — Hunt & Thomas (20th anniv. ed., 2019) — DRY, orthogonality, "don't use wizard code you don't understand."
- **Clean Code** — Robert C. Martin (2008) — meaningful names, error handling, the cost of duplication.
- **Refactoring** — Martin Fowler (2nd ed., 2018) — Extract Function, Replace Magic Literal with Symbolic Constant.
- **The Twelve-Factor App** — [12factor.net](https://12factor.net) — config in the environment (factor III).

---

## Related Topics

- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the cure for Pokémon exception handling.
- [Clean Code → Meaningful Names](../../../clean-code/01-meaningful-names/README.md) — naming away magic values.
- [DRY Principle](../../../clean-code/README.md) — and its limits (coincidental duplication).
- [Bad Structure](../01-bad-structure/junior.md) — the sibling category; Cargo Cult feeds Lava Flow.
- [Over-Engineering](../03-over-engineering/junior.md) — the opposite failure: too much abstraction instead of too little.
