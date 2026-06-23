# Security & Performance Review — Junior Level

> **Roadmap:** [Code Review](../README.md) → Security & Performance Review
> *Every diff is two questions wearing one outfit: "could an attacker abuse this?" and "will this fall over under load?" Most reviewers never ask either — they read the code as if the only user is a polite, single, well-behaved human. The whole job here is learning to read it the way the internet will.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Follow the Untrusted Input](#core-concept-1--follow-the-untrusted-input)
5. [Core Concept 2 — Input Validation](#core-concept-2--input-validation)
6. [Core Concept 3 — Authentication vs Authorization (and IDOR)](#core-concept-3--authentication-vs-authorization-and-idor)
7. [Core Concept 4 — Injection](#core-concept-4--injection)
8. [Core Concept 5 — Secrets and Sensitive Data](#core-concept-5--secrets-and-sensitive-data)
9. [Core Concept 6 — Performance You Can See in the Diff](#core-concept-6--performance-you-can-see-in-the-diff)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Two specialist lenses every reviewer runs over a diff — security and performance.**

When you review a change, you naturally check the obvious thing: *does it do what it's supposed to do?* That's correctness, and it's covered in [03 — Correctness & Design Review](../03-correctness-and-design-review/junior.md). But a change can be perfectly correct for the happy path and still be a disaster — because correctness assumes a cooperative user, and the real world has *attackers* and it has *scale*.

Security review asks: **what happens when the input is hostile?** A login form that works fine for you also accepts whatever a script types into it ten thousand times a second. A URL with `/users/42/profile` in it can have the `42` changed to `43` by anyone who can type. Code that "works" against you may be wide open to someone who isn't being nice.

Performance review asks: **what happens when there's a lot of data?** A function that loops over a list and does one database query per item is invisible in your tests with five rows. In production with fifty thousand rows it issues fifty thousand queries and takes the page down. The bug was always there; only the data size revealed it.

These two lenses are *specialist* lenses — you run them deliberately, as separate passes, after you've checked correctness. This page gives you a concrete, example-driven checklist for both. You are not expected to become a security engineer or a performance engineer from one page. You *are* expected to catch the common, obvious, high-impact problems that you can see directly in a diff — and to know when something is over your head and needs an expert.

> **Mindset shift:** stop reading a diff as "code one nice person runs once." Read it twice more. First as a **security** reviewer: *follow the untrusted input* — where does data from outside enter, and what does it touch on the way through (a query? a command? a file? another user's data)? Then as a **performance** reviewer: *see the structural bug, measure the rest* — flag the database-call-in-a-loop and the nested loop you can spot by eye, but never block a change on a guessed micro-optimization. Real performance is a measurement, not an opinion.

---

## Prerequisites

- **Required:** You can read a diff and understand what the code does (start with [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md)).
- **Required:** You've written code that takes input from somewhere — a form, an API request, a command-line argument, a file.
- **Required:** You've written or read a database query (SQL or an ORM call). Examples use **SQL**, **Python**, and a little **Go**.
- **Helpful:** You've heard the words "SQL injection" or "XSS" but couldn't precisely say what they are. (You will by the end.)
- **Helpful:** You've seen a page that got slow as the data grew, and didn't know why.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Untrusted input** | Any data that came from outside your program — a user, an API client, a file, another service. Assume it can be anything. |
| **Trust boundary** | The line where untrusted data enters your trusted code. Validation happens here. |
| **Input validation** | Checking that incoming data is the shape, type, and range you expect *before* you use it. |
| **Authentication (authn)** | Proving *who* you are. "Are you logged in? Are you really this user?" |
| **Authorization (authz)** | Checking *what you're allowed to do.* "You're user A — are you allowed to read user B's invoice?" |
| **IDOR** | *Insecure Direct Object Reference.* You can access someone else's data just by changing an ID in the request. A missing-authz bug. |
| **Injection** | Tricking the program into running attacker-supplied data *as code or commands* (SQL, shell, HTML). |
| **Parameterized query** | A SQL query where user data is passed as a separate *parameter*, never glued into the query text. The safe way. |
| **XSS** | *Cross-Site Scripting.* Attacker's input gets rendered as HTML/JavaScript in someone else's browser. |
| **Secret** | A password, API key, token, or private key. Must never be hardcoded or logged. |
| **PII** | *Personally Identifiable Information* — names, emails, SSNs, addresses. Sensitive; don't leak or log it. |
| **N+1 query** | One query to get a list, then *one more query per item* in that list. The classic database performance bug. |
| **Hot loop** | A loop that runs many times. Wasted work inside it is multiplied by every iteration. |
| **O(n²)** | "Quadratic" — work that grows with the *square* of the input. Double the data, quadruple the time. Usually a loop inside a loop over the same big collection. |

---

## Core Concept 1 — Follow the Untrusted Input

Almost every security bug a junior reviewer can realistically catch reduces to one habit: **trace the untrusted input through the diff.** Before you check anything specific, find the answer to two questions:

1. **Where does data from outside enter this code?** Request bodies, URL parameters, query strings, headers, cookies, uploaded files, command-line args, messages from a queue, responses from a third-party API. All of it is untrusted — *especially* the ones that look harmless.
2. **What does that data touch on its way through?** Does it get put into a database query? Run as a shell command? Rendered into a web page? Used as a filename? Used to decide *which record* to fetch?

Wherever untrusted input *meets* one of those dangerous operations is where vulnerabilities live. That meeting point is the only place you need to look hard.

```
                  TRUST BOUNDARY
                       │
  request body  ───────┤
  URL params    ───────┤──►  your code  ──►  database query   ← injection?
  query string  ───────┤                ──►  shell command    ← injection?
  headers       ───────┤                ──►  HTML page         ← XSS?
  uploaded file ───────┤                ──►  filename / path   ← path traversal?
                       │                ──►  "fetch record N"  ← IDOR / authz?
              (untrusted)   (trusted)
```

> **Key insight:** You don't audit the *whole* diff for security. You find where untrusted input crosses the trust boundary, then follow it to whatever dangerous thing it touches. If untrusted data never reaches a query, a command, a page, or an access-control decision, most of these bugs simply can't happen there. Security review is *targeted*, not exhaustive — that's what makes it doable by a junior.

The rest of this page is just the specific dangerous "touches," one at a time: validation, authz, injection, secrets. Keep the input-tracing habit in mind for every one.

---

## Core Concept 2 — Input Validation

**Input validation** means checking that incoming data is what you expect — the right type, the right shape, within sane limits — *before* you use it. The trust boundary (where outside data enters) is exactly where this check belongs.

A junior question to ask of any new endpoint or handler: **is every piece of external input checked before it's used?**

```python
# BEFORE — trusts the client completely
@app.post("/transfer")
def transfer():
    amount = request.json["amount"]        # could be missing, negative, a string, 1e308
    to_account = request.json["to"]        # could be anything
    do_transfer(amount, to_account)        # used raw
```

Everything that can go wrong here goes wrong with a *normal* client bug, never mind an attacker: missing key (crash), a negative amount (money flows the wrong way), a string where a number is expected (crash or silent coercion), an absurdly large number.

```python
# AFTER — validate at the boundary
@app.post("/transfer")
def transfer():
    data = request.json or {}
    amount = data.get("amount")
    to_account = data.get("to")

    if not isinstance(amount, (int, float)) or amount <= 0 or amount > 1_000_000:
        abort(400, "amount must be a positive number up to 1,000,000")
    if not isinstance(to_account, str) or not ACCOUNT_RE.match(to_account):
        abort(400, "invalid account id")

    do_transfer(amount, to_account)
```

The rule of thumb to look for in review: validation should be an **allow-list** ("accept only what matches this expected shape") rather than a **deny-list** ("reject these few bad things"). Deny-lists are always incomplete — attackers find the case you forgot.

> **Key insight:** "Validate input" doesn't mean sprinkle checks everywhere. It means: *at the boundary where untrusted data arrives, confirm it matches the expected type, shape, and range — and reject everything else.* In review, look for input that flows from the request straight into logic with no check in between. That gap is the finding.

A note on scope: input validation is a deep topic with its own techniques (schemas, canonicalization, length limits). For the junior review lens, you're checking that *some* sensible validation exists at the boundary — not designing the validation framework. The full treatment lives in the [Security](../../../../Security/) section.

---

## Core Concept 3 — Authentication vs Authorization (and IDOR)

These two words sound similar and get mixed up constantly. They are different checks, and getting them confused is the source of the single most common real-world vulnerability.

- **Authentication (authn)** = *who are you?* "Are you logged in? Is this token valid? Are you really `alice`?"
- **Authorization (authz)** = *what are you allowed to do?* "OK, you're `alice` — are you allowed to read *this* invoice / delete *this* comment / view *this* user's data?"

A logged-in user has passed *authentication*. That does **not** mean they're allowed to do *anything*. The check that's missing in real breaches is almost always **authorization**.

Here's the canonical bug — **IDOR** (Insecure Direct Object Reference):

```python
# BEFORE — authenticated, but NOT authorized
@app.get("/invoices/<invoice_id>")
@login_required                      # ← authn: you must be logged in
def get_invoice(invoice_id):
    invoice = db.get_invoice(invoice_id)   # fetches by ID, no ownership check
    return invoice.to_json()
```

This *looks* secure — there's `@login_required`. But it only checks that you're *someone*, not that the invoice is *yours*. Any logged-in user can request `/invoices/1001`, then `/invoices/1002`, then `/invoices/1003`, and read every invoice in the system. That's IDOR: the object (`invoice_id`) is referenced *directly* from user input, with no check that this user owns it.

```python
# AFTER — authn AND authz
@app.get("/invoices/<invoice_id>")
@login_required                      # authn
def get_invoice(invoice_id):
    invoice = db.get_invoice(invoice_id)
    if invoice is None or invoice.owner_id != current_user.id:   # ← authz
        abort(404)                   # 404, not 403 — don't reveal it exists
    return invoice.to_json()
```

The review question that catches almost all of these: **"Can user A access user B's data by changing an ID in the request?"** Whenever you see a handler that fetches a record by an ID taken from the URL or body, look for the line that confirms *this user is allowed to see that record*. If it's missing, that's your comment — and it's often the most valuable comment you'll leave all week.

> **Key insight:** Authentication is the bouncer checking you have a ticket. Authorization is the usher checking your ticket is for *this* seat. Most apps remember the bouncer and forget the usher. Missing authorization (IDOR) is consistently among the top real-world vulnerabilities precisely because the code *looks* protected — there's a login check right there — so reviewers stop looking. Don't stop at authn; always look for the ownership check.

---

## Core Concept 4 — Injection

**Injection** is what happens when untrusted input gets treated as *code or commands* instead of as plain data. The program meant the input to be a value; the attacker shaped it so it becomes an instruction. It's the textbook example of "untrusted input touching a dangerous operation."

### SQL injection

The classic. A query built by gluing user input into the query *string*:

```python
# BEFORE — SQL injection
def find_user(username):
    query = "SELECT * FROM users WHERE name = '" + username + "'"
    return db.execute(query)
```

Look what a malicious `username` does. If the user submits:

```
' OR '1'='1
```

the query becomes:

```sql
SELECT * FROM users WHERE name = '' OR '1'='1'
```

`'1'='1'` is always true, so this returns *every user*. Worse inputs (`'; DROP TABLE users; --`) can delete data. The program thought `username` was a name; the attacker made it part of the SQL.

The fix is a **parameterized query** (also called a *prepared statement*): you send the query and the data *separately*, and the database driver guarantees the data is treated only as a value, never as SQL.

```python
# AFTER — parameterized query (the ? is a placeholder, username is sent separately)
def find_user(username):
    query = "SELECT * FROM users WHERE name = ?"
    return db.execute(query, (username,))     # username can NEVER become SQL here
```

```go
// AFTER, in Go — placeholders again; the driver handles escaping
row := db.QueryRow("SELECT * FROM users WHERE name = $1", username)
```

The review rule is mechanical and absolute: **if you see user input being string-concatenated (or formatted/templated) into a SQL query, that's a finding — every time.** The fix is always "use parameters." This is so common and so high-impact that it deserves its own muscle memory. (Deep version: the [`sql-injection-prevention`](../../static-analysis/) territory and the [Security](../../../../Security/) section.)

### Command injection

The same disease, different target — building a shell command from input:

```python
# BEFORE — command injection
import os
def ping(host):
    os.system("ping -c 1 " + host)     # host = "google.com; rm -rf /"  → runs BOTH
```

```python
# AFTER — pass arguments as a list; no shell parsing of the input
import subprocess
def ping(host):
    subprocess.run(["ping", "-c", "1", host], check=True)   # host is a single arg, not shell text
```

Same rule: user input concatenated into a command string is a finding.

### Other injections to recognize (lighter touch)

- **XSS (Cross-Site Scripting)** — untrusted input rendered into an HTML page without escaping, so the attacker's `<script>` runs in another user's browser. If you see user-supplied data going into HTML, look for escaping/encoding. (Templating engines usually auto-escape; raw string-building into HTML is the danger sign.)
- **Log injection** — user input written straight into logs can forge fake log lines or break log parsers. Don't blindly concatenate raw input into log messages.

> **Key insight:** Every injection is the same shape: *data crosses a boundary where data and instructions share a channel, and the input is allowed to become an instruction.* The universal cure is **separation** — keep data and code in different lanes. Parameterized queries separate data from SQL; argument lists separate data from the shell; output encoding separates data from HTML. When you see input and instructions mixed in one string, that's the vulnerability, regardless of the technology.

---

## Core Concept 5 — Secrets and Sensitive Data

Two related habits to check on every diff: don't *embed* secrets, and don't *leak* them.

**1. No hardcoded secrets.** Passwords, API keys, tokens, and private keys must never be written into source code. Code gets committed to git, shared, forked, and screenshotted — and once a secret is in git history, it's effectively public forever (rewriting history rarely fully removes it).

```python
# BEFORE — hardcoded secret (now in git history forever)
STRIPE_KEY = "sk_live_51H8xQ2eZvKYlo3aB9cD..."   # 🚩 finding
db = connect("postgres://admin:Sup3rSecret@db.internal/prod")  # 🚩 password in code
```

```python
# AFTER — read secrets from the environment / a secrets manager
import os
STRIPE_KEY = os.environ["STRIPE_KEY"]            # supplied at runtime, not committed
db = connect(os.environ["DATABASE_URL"])
```

The review rule: **any string that looks like a key, token, or password in the diff is a finding** — even in tests, even in "temporary" code, even in comments. (Deeper: the [`secrets-management`](../../../../Security/) territory.)

**2. Don't log secrets or PII.** Logs get shipped to dashboards, stored for months, and read by lots of people. A token or a password or a credit-card number in a log line is a leak.

```python
# BEFORE — leaks a token and a password into the logs
log.info(f"auth request: user={user} token={token} password={password}")
```

```python
# AFTER — log the fact, never the secret
log.info("auth request received", extra={"user_id": user.id})   # no token, no password
```

The review question: **does this log line, error message, or exception print a secret, a full token, or personal data?** Look especially at logging added "for debugging" and at error handlers that dump whole request objects.

> **Key insight:** A secret in code or logs isn't a *future* risk — it's already exposed the moment it's committed or written, because both git history and log storage are durable and widely readable. Treat the appearance of a secret in a diff the way you'd treat a fire alarm: stop, flag it, and (for anything that reached a real branch) tell the team it needs to be *rotated*, not just deleted. Deletion hides it; rotation invalidates it.

---

## Core Concept 6 — Performance You Can See in the Diff

Now the second lens. The junior performance rule has two halves, and the second half matters as much as the first:

1. **Flag the obvious *structural* problems you can see by reading the diff.**
2. **Do NOT block on micro-optimizations or guesses — real performance needs measurement.**

Here are the structural problems that are genuinely visible in a code review.

### N+1 queries — a database call inside a loop

The single most common performance bug in real applications. You fetch a list, then loop over it making *one more query per item*.

```python
# BEFORE — N+1: 1 query for orders, then 1 query PER order = N+1 total
orders = db.query("SELECT * FROM orders WHERE user_id = ?", (user_id,))  # 1 query
for order in orders:
    customer = db.query("SELECT * FROM customers WHERE id = ?", (order.customer_id,))  # N queries
    print(order.id, customer.name)
```

With 5 orders that's 6 queries — fine in your test. With 50,000 orders it's 50,001 queries and the page times out. The fix is to fetch what you need in *one* query (a JOIN, or one batched `IN (...)` query):

```python
# AFTER — one query (a JOIN) instead of N+1
rows = db.query("""
    SELECT orders.id, customers.name
    FROM orders
    JOIN customers ON customers.id = orders.customer_id
    WHERE orders.user_id = ?
""", (user_id,))
for row in rows:
    print(row.id, row.name)
```

In an ORM the N+1 hides behind innocent-looking attribute access (`order.customer.name` inside a loop quietly issues a query each time). The review smell is identical: **a query, or anything that hits the database/network, *inside a loop*.** When you see it, ask "can this be fetched once before the loop instead?"

### Work inside a hot loop

Anything expensive computed *inside* a loop that doesn't change between iterations should be **hoisted** out (computed once, before the loop).

```python
# BEFORE — recompiles the regex and re-reads config on every iteration
for line in lines:
    pattern = re.compile(r"\d{4}-\d{2}-\d{2}")   # rebuilt every iteration
    limit = load_config()["max_len"]             # re-read every iteration
    if pattern.search(line) and len(line) < limit:
        process(line)
```

```python
# AFTER — compute the invariant work once, outside the loop
pattern = re.compile(r"\d{4}-\d{2}-\d{2}")       # once
limit = load_config()["max_len"]                 # once
for line in lines:
    if pattern.search(line) and len(line) < limit:
        process(line)
```

### Nested loops over the same big collection — accidental O(n²)

A loop inside a loop, both over a large collection, is **O(n²)** ("quadratic"): double the data, quadruple the work. Often it's an accidental "for each X, scan all Y to find a match."

```python
# BEFORE — for each order, scan ALL users to find the match = O(n²)
for order in orders:                  # n
    for user in users:                # n  →  n × n comparisons
        if user.id == order.user_id:
            order.user_name = user.name
```

```python
# AFTER — build a lookup once (O(n)), then each lookup is O(1)  →  O(n) overall
users_by_id = {user.id: user for user in users}   # one pass
for order in orders:
    order.user_name = users_by_id[order.user_id].name
```

The review smell: **two nested loops over big collections, especially where the inner loop is searching.** A dictionary/set/map usually turns the inner search into an instant lookup.

### Unbounded queries — loading the whole table

A query with no `LIMIT` that could match a huge number of rows will happily load the entire table into memory.

```sql
-- BEFORE — loads EVERY event ever, could be tens of millions of rows
SELECT * FROM events WHERE user_id = 42;
```

```sql
-- AFTER — bounded; page through results instead of loading everything
SELECT * FROM events WHERE user_id = 42 ORDER BY created_at DESC LIMIT 50;
```

The smell: a `SELECT` (or any "fetch all") with no `LIMIT` and no obvious upper bound, especially on a table that grows over time. Also watch for `SELECT *` pulling columns nobody uses.

> **Key insight:** Flag the *structural* bugs — the database call in a loop, the nested loops, the unbounded query — because those are **algorithmic** problems visible from the code alone, and they get exponentially worse as data grows. But **do not** start arguing about whether a list comprehension is faster than a `for` loop, or whether to cache a value used twice. Those are *micro-optimizations*, and the honest answer to "is this faster?" is almost always **"measure it."** Guessing at micro-performance wastes review time and is frequently wrong — the slow part is rarely where you'd guess. Block on the structural bug; defer the rest to a benchmark or profiler. The [Performance](../../performance/) section is where measurement lives.

---

## Real-World Examples

**1. The IDOR that exposed everyone's documents.** A file-sharing feature served downloads from `/files/<file_id>`. There was a `@login_required` check, so it shipped. A user noticed the file IDs were sequential and wrote a ten-line script to download `/files/1` through `/files/200000`. The code was *correct* and *authenticated* — it was never *authorized*. One missing line (`if file.owner_id != current_user.id: abort(404)`) would have stopped it. This is why "can A read B's data by changing the ID?" is the most valuable question in your toolkit.

**2. The login form that leaked the whole user table.** A search box built its query with string concatenation: `"... WHERE name LIKE '%" + term + "%'"`. Someone typed `%' OR '1'='1` and got every row back; a follow-up `UNION SELECT` pulled password hashes. The fix was a one-character change in spirit — a `?` placeholder and passing `term` as a parameter. SQL injection is decades old and *still* in the OWASP Top 10 because string-concatenated queries keep getting written.

**3. The dashboard that worked in the demo and died in production.** A reporting page rendered a customer list and, for each customer, showed their latest order — by accessing `customer.latest_order` inside the template loop. The ORM turned each access into a query. With the 12 demo customers it was 13 queries and felt instant. With 40,000 real customers it was 40,001 queries; the page took 90 seconds and timed out. The reviewer who *should* have caught it saw a clean-looking template and didn't think "loop + per-item attribute = N+1." Now you will.

**4. The secret that lived in git for two years.** An AWS key was committed in a config file, then "removed" in a later commit. It was still in the git history the whole time, got scraped by a bot trawling public repos, and ran up a five-figure bill mining cryptocurrency. Deleting a secret from the current code does nothing — it must be *rotated* (the old key invalidated). The reviewer's job was simply to never let `AKIA...` through in the first place.

---

## Mental Models

- **Follow the water.** Untrusted input is water; your code is the plumbing. Trace where the water enters and where it flows. Wherever it reaches something dangerous — a query, a command, an HTML page, an access decision — that joint needs a seal (validation, parameters, escaping, an authz check). Dry joints are fine; you only inspect where the water actually goes.

- **Bouncer vs usher.** Authentication is the bouncer (do you have *a* ticket?). Authorization is the usher (is this ticket for *this* seat?). Apps remember the bouncer and forget the usher. Always look for the usher.

- **Data should never get to be code.** Every injection is data sneaking into the code lane. Parameterized queries, argument lists, and output encoding all do the same thing: keep data *as data*. When you see input glued into a string that will be *executed or rendered*, the lanes have merged — that's the bug.

- **The loop multiplies everything.** Whatever sits inside a loop happens once per iteration. A query in a loop = N queries. Expensive work in a loop = N × expensive. A loop in a loop = N². The loop is a magnifying glass; check what's under it.

- **Structural vs micro: see vs measure.** Structural performance bugs (N+1, O(n²), unbounded queries) are *visible* and *block-worthy*. Micro-performance (this call vs that call) is *invisible* without a profiler and is *not* a review fight. See the structural; measure the rest.

---

## Common Mistakes

1. **Trusting input because "the frontend validates it."** The frontend is untrusted — anyone can call your API directly with `curl`. Validation must exist on the server, at the boundary. Client-side checks are for UX, not security.

2. **Confusing authentication with authorization.** Seeing `@login_required` and concluding "it's secure." Logged-in ≠ allowed. Always look for the *ownership / permission* check, not just the login check.

3. **Missing the ID-swap (IDOR).** Reviewing a `GET /thing/<id>` handler and not asking "is there a check that this user owns `<id>`?" If a record is fetched by a user-supplied ID, demand the authz line.

4. **Letting string-built queries or commands slide.** Any user input concatenated/formatted into SQL or a shell command is a finding — no exceptions, not even for "internal" or "admin-only" code. Use parameters / argument lists.

5. **Approving a hardcoded secret "to fix later."** Once it's committed it's exposed; "later" is too late. Block it in review, and for anything already merged, say it must be *rotated*, not just removed.

6. **Logging secrets or PII while debugging.** Debug logging that dumps tokens, passwords, full request bodies, or personal data is a leak into durable, widely-read storage. Flag it even though it "helps debugging."

7. **Missing the N+1 because the ORM hides it.** `for x in items: use(x.related.field)` looks innocent but can fire a query per item. Learn to see "loop + per-item data access" as a query-in-a-loop smell.

8. **Blocking a change on a micro-optimization guess.** Demanding a "faster" construct without a benchmark wastes everyone's time and is usually wrong. Flag *structural* problems; for micro-perf, ask for a measurement instead of insisting.

9. **Trying to be the security expert when you're not.** For anything beyond the obvious checklist here — crypto, auth protocols, a clever-looking exploit you half-understand — don't approve and don't bluff. Pull in someone who owns security. Knowing the edge of your competence *is* the senior move.

---

## Test Yourself

1. In one sentence each, what's the difference between **authentication** and **authorization**? Which one is missing in an IDOR bug?
2. You review `GET /api/orders/<order_id>` and it has `@login_required`. What's the one question you must ask, and what line would you look for in the body?
3. You see `query = "SELECT * FROM users WHERE email = '" + email + "'"`. Name the vulnerability and the fix.
4. A diff adds `log.info(f"login: user={u} pwd={p}")` for debugging. What's wrong with it?
5. A function loops over a list of 10,000 invoices and calls `db.get_customer(inv.customer_id)` inside the loop. Name the performance bug and the fix.
6. A reviewer wants to block a PR because it uses a `for` loop where a list comprehension "would be faster." Is that a good review comment? Why or why not?
7. You spot a `SELECT * FROM audit_log WHERE account_id = ?` with no `LIMIT`. Why might this be a problem, and what would you suggest?

<details>
<summary>Answers</summary>

1. **Authentication** = proving *who you are* (are you logged in / really this user). **Authorization** = checking *what you're allowed to do* (are you permitted to act on *this* resource). IDOR is a missing **authorization** check — you're authenticated but not checked for permission to access that specific object.
2. Ask: **"Can a logged-in user read someone else's order by changing the ID?"** Look for an ownership/permission check such as `if order.owner_id != current_user.id: abort(404)`. If it's absent, that's the finding.
3. **SQL injection** — user input (`email`) is concatenated into the query string, so it can become SQL. **Fix:** use a parameterized query — `"... WHERE email = ?"` and pass `email` as a separate parameter so it can only ever be a value.
4. It **logs a password** (and a user identifier) into durable, widely-read log storage — a secret/PII leak. Log the event and a non-sensitive id (`user_id`), never the password or tokens.
5. **N+1 query** — one query for the list plus one query per invoice (≈10,001 total). **Fix:** fetch the customers in one query (a JOIN or a single batched `IN (...)` query) before/instead of the per-item calls.
6. **No** — that's a micro-optimization guess with no measurement, and such guesses are usually wrong and rarely matter. The right move is to defer to a benchmark/profiler if anyone suspects a real bottleneck. Block on *structural* problems (N+1, O(n²)), not on style-level perf hunches.
7. With no `LIMIT`, the query can load an unbounded, ever-growing table entirely into memory and blow up as the account ages. Suggest a `LIMIT` plus pagination (and ordering), and selecting only the needed columns instead of `*`.

</details>

---

## Cheat Sheet

```
SECURITY — follow the untrusted input, then check what it touches
  WHERE does outside data enter?  body, URL/query params, headers, cookies, files, args
  WHAT does it touch?             query · command · HTML · filename · "which record"

  INPUT VALIDATION   validate at the boundary; allow-list expected shape, reject the rest
  AUTHN vs AUTHZ     authn = who are you?   authz = allowed to do THIS?
  IDOR (the #1 bug)  fetch-by-user-supplied-ID  →  is there an OWNERSHIP check?
                     ask: "can A read B's data by changing the ID?"
  INJECTION          user input glued into SQL/shell/HTML  →  FINDING, every time
                     fix = SEPARATE data from code:
                       SQL    →  parameterized query   "... WHERE x = ?", (val,)
                       shell  →  arg list               run(["cmd", "-f", val])
                       HTML   →  escape / auto-escaping templates
  SECRETS            no hardcoded keys/passwords/tokens (git = forever)
                     don't log secrets / tokens / PII
                     already merged?  →  ROTATE it, deletion isn't enough

PERFORMANCE — see the structural bug, MEASURE the rest
  N+1 QUERY          DB/network call INSIDE a loop  →  fetch once (JOIN / batch)
  HOT-LOOP WORK      invariant work inside a loop   →  hoist it OUT (compute once)
  NESTED LOOPS       loop-in-loop over big data = O(n²)  →  use a dict/set lookup
  UNBOUNDED QUERY    SELECT with no LIMIT on a growing table  →  add LIMIT + paginate

  RULE: block on STRUCTURAL bugs (visible, algorithmic).
        DON'T block on micro-perf guesses — that needs a benchmark/profiler.

WHEN IN DOUBT
  serious / unfamiliar security issue  →  pull in a security expert, don't bluff
```

---

## Summary

- A diff deserves **two specialist passes** beyond correctness: a **security** pass and a **performance** pass.
- **Security review starts by following the untrusted input** — find where outside data enters, then check what dangerous thing it touches (a query, a command, an HTML page, an access decision). The bugs live at those meeting points.
- **Input validation** belongs at the boundary: confirm incoming data matches the expected type/shape/range and reject the rest (allow-list, not deny-list).
- **Authentication** (who are you) is not **authorization** (what you're allowed to do). The most common real-world vulnerability is missing authz — **IDOR**, where a user reads someone else's data by changing an ID. Always ask: *"can A access B's data by changing the ID?"*
- **Injection** (SQL, command, XSS, log) is untrusted input becoming code. The cure is always **separation**: parameterized queries, argument lists, output escaping. String-built queries/commands are a finding *every time*.
- **Secrets** must never be hardcoded or logged; once committed or logged they're exposed, so they must be **rotated**, not merely deleted.
- **Performance review flags the structural bug you can see** — N+1 queries (a call in a loop), work in a hot loop, nested loops (O(n²)), unbounded queries — and **defers everything else to measurement.** Don't block on micro-optimization guesses; a profiler decides those.
- Know your limit: for serious or unfamiliar security issues, **pull in an expert** rather than approving on a guess.

Run these two lenses on every diff and you'll catch the bugs that actually take systems down and get data stolen — the ones plain correctness review walks right past.

---

## Further Reading

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — the canonical list of the most critical web application security risks (injection, broken access control, and friends). Read it once; recognize these in diffs forever.
- [OWASP Code Review Guide](https://owasp.org/www-project-code-review-guide/) — exactly this skill, in depth: how to review code specifically for security.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — short, practical pages on SQL injection prevention, XSS, authn/authz, secrets, and more.
- ["What is the N+1 query problem?"](https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem-in-orm-object-relational-mapping) — a clear, example-driven explainer of the classic performance bug and how ORMs cause it.
- The [middle.md](middle.md) of this topic, which goes deeper: threat modeling a change, authz patterns, more injection classes, and reading a profiler's output rather than guessing at performance.

---

## Related Topics

- [03 — Correctness & Design Review](../03-correctness-and-design-review/junior.md) — the pass you run *before* these two: does the code do the right thing for the happy path?
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md) — where the security and performance lenses fit in the overall review sequence.
- [Security](../../../../Security/) — the full security curriculum: input validation, authn/authz, injection, secrets management, and more, in depth.
- [Performance](../../performance/) — how to actually *measure* performance (benchmarks, profilers) instead of guessing — the home of the "measure the rest" half of this page.
- [Static Analysis & Linting](../../static-analysis/) — tools that catch many of these issues (injection, hardcoded secrets) automatically, before a human ever reviews the diff.
