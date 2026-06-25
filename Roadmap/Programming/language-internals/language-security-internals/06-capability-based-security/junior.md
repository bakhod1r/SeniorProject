# Capability-Based Security — Junior Level

> **Topic:** [Capability-Based Security](README.md)
> **Focus:** What is a capability, why is it different from "checking permissions," and why does the difference make whole classes of bugs impossible?

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does it mean to *hold* permission instead of *being checked for* permission?**

Almost every security system you have used works like a bouncer at a club. You walk up, you say *"I'm Alice, let me into room 217,"* and a guard checks a list to decide whether Alice is allowed into room 217. The room number — *which* room — is something you simply *name*. Anyone can name any room. The list — the **access-control list**, or ACL — is what decides whether you get in. Your authority is in *who you are*, and it is checked at the door.

**Capability-based security** turns this inside-out. Instead of naming a room and being checked against a list, you are handed a **key**. The key is the only thing that names the room *and* opens it. You cannot point at a room you have no key for, because in this world there is no way to "name" a room except by holding its key. There is no list, no door check, no bouncer reading your identity. **If you have the key, you can get in. If you don't have it, the room does not even exist for you.**

That key is a **capability**: an unforgeable, transferable token that *both* designates a specific resource *and* grants the right to use it. Designation and authority are fused into one thing. You cannot have one without the other.

In one sentence: **an ACL system asks "who are you, and are you allowed?"; a capability system asks nothing — it just checks "do you hold the key?"**

> 🎓 **Why this matters for a junior:** Most of the security section of this roadmap is *defensive* — how to stop SQL injection, how to validate input, how not to leak secrets. Capability-based security is the *affirmative* counterpart: a way of structuring programs so that whole categories of attacks are **impossible by construction**, not merely defended against. A module that was never handed a network socket simply *cannot* phone home, no matter how malicious its code is. That is a different and much stronger kind of safety than "we checked and it looked fine."

This page covers: what ambient authority is and why it causes the famous **confused deputy** problem; what a capability is and how it structurally prevents that bug; the everyday capabilities you already use without naming them (Unix file descriptors, unguessable URLs, OAuth tokens); and the principle that ties it all together — **POLA, the Principle of Least Authority**.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to call a function and pass it arguments. Capabilities, at the bottom, are just *references you pass around*.
- **Required:** A rough idea of what a file path, a URL, and a process are.
- **Required:** What it means for a program to "have permission" to do something (read a file, open a socket).
- **Helpful but not required:** Some exposure to Unix file descriptors (`open()` returns a number you read/write through).
- **Helpful but not required:** A vague sense of how object references work in a memory-safe language (Java, Python, JS) — you hold a reference, you can call methods; you don't hold it, you can't.

You do **not** need to know:

- How capability operating systems implement kernel objects (that's `senior.md` and `professional.md`).
- The object-capability calculus or formal proofs of confinement (that's `senior.md`).
- WASI, seL4 internals, or membrane patterns (later levels).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Authority** | The actual ability to cause an effect — read this file, open that socket. Distinct from *permission* (a recorded rule); authority is what you can really do *right now*. |
| **Designation** | The act of *naming* a resource — "file 217," "the printer," "Bob's account." |
| **Capability** | An **unforgeable** token that fuses *designation* and *authority*: it names exactly one resource and grants the right to use it. Holding it *is* the permission. |
| **Ambient authority** | Authority you have *just by being you*, available from the surrounding environment, without being handed it for the specific call. A normal process's ability to open any file by path is ambient. |
| **ACL (Access-Control List)** | A list attached to a resource saying which identities may do what. The bouncer's clipboard. The dominant model in Unix, Windows, and most databases. |
| **Identity** | *Who* a subject is (user ID, role). ACL systems make decisions based on identity; capability systems do not need it. |
| **Confused deputy** | A program that holds authority and is tricked by a less-privileged caller into using that authority on the caller's behalf, against the rules. The canonical bug ambient authority enables. |
| **POLA** | **Principle of Least Authority** — every component should hold exactly the authority it needs to do its job, and no more. |
| **Object capability (ocap)** | A capability that *is* an ordinary object reference in a memory-safe language. You can only call what you hold a reference to. |
| **Attenuation** | Handing someone a *weaker* version of a capability — e.g. "read-only" instead of "read-write," or "this one file" instead of "the whole directory." |
| **Revocation** | Taking a capability *back* — making a previously-handed-out key stop working. |
| **Delegation** | Passing a capability you hold to someone else, so they can use the resource too. |
| **Forgeable / unforgeable** | A token is *forgeable* if you can manufacture a valid one from nothing (guess a filename). It is *unforgeable* if the only way to get one is to be given it. |
| **Bearer token** | A secret string such that *whoever holds it* is treated as authorized — no identity check. A capability in disguise (OAuth tokens, signed URLs, password-reset links). |
| **File descriptor (fd)** | The integer Unix hands you from `open()`. You read/write through it. It behaves like a capability: holding it is the right to use that open file. |

---

## Core Concepts

### 1. Two Things a Reference Can Do: Name and Empower

When you say "the file `/etc/passwd`," you are doing **designation** — you are pointing at a resource. When the system then *lets you read it*, that is **authority**. In an ACL world these are split: anyone can *name* `/etc/passwd` (designation is free and universal), and a separate check decides authority.

A **capability fuses them**. The capability *is* the name *and* the permission. There is no separate name you could utter to reach a resource you have no capability for. This fusion is the entire idea. Everything else follows from it.

### 2. Ambient Authority — The Default Most Programs Live In

Run an ordinary program. It can `open("/anything")`, connect to any host, read any environment variable, delete files in `/tmp`. It did not have to be *handed* these abilities for the specific call — they hang in the air around it, inherited from the user who launched it. This is **ambient authority**.

Ambient authority is convenient. It is also the root of a surprising amount of insecurity, because **every line of code in the process has all of it**. A logging library you imported can read your SSH keys. A JSON parser can open a socket. None of them *need* to, but the ability is ambient, so nothing stops them.

### 3. The Confused Deputy — The Bug Ambient Authority Causes

This is the canonical story, from Norm Hardy (1988). A pay-for-use compiler runs on a shared system. It has two jobs and two authorities:

1. Compile the user's source file (it must be able to read the file the user names).
2. Write a billing record into a system file `BILL`, recording that the user owes money (it must be able to write `BILL` — an authority the *user* does not have).

The compiler accepts a command-line argument: *the name of the output file* to write the compilation results into. A clever user runs:

```text
compile  myprogram.src  -o BILL
```

The compiler, doing exactly what it was told, opens the user-named output file `BILL` and writes compiler output into it — **destroying the billing records**. The user could not write `BILL` directly; the system would have refused. But the compiler *could*, and the user **tricked the compiler into using its own authority on the user's behalf.** The compiler is the "deputy"; it is "confused" about whose authority it is exercising.

Why did this happen? Because the output file was *designated by a name* (`BILL`), and the authority to write it was *ambient* (the compiler had it for its own reasons). The two were separate. The compiler had no way, from the bare name `BILL`, to know that *the user* had no right to it.

### 4. How a Capability Structurally Prevents It

Now imagine the user does not pass a *name* but a **capability** — an already-opened, writable handle to the output file. To create that handle, the user had to *already hold* the authority to write there. The compiler simply writes through the handle it was given.

The user **cannot** produce a capability to `BILL`, because the user has no capability to `BILL` to begin with. There is no string they can type to conjure one. The attack evaporates — not because the compiler defended against it, but because **the bad request is unrepresentable.** Designation now *carries* authority, so the user can only designate what they were already allowed to touch.

This is the affirmative power of the model: it does not detect the confused deputy and reject it. It makes the confused deputy *impossible to express*.

### 5. POLA — The Principle of Least Authority

If authority only flows by being handed a capability, you naturally hand each component just the keys it needs. A PDF thumbnail generator gets a read handle to *one* PDF and a write handle to *one* output image — and nothing else. No filesystem, no network, no environment. If that library is malicious or compromised, the blast radius is two file handles. This is **POLA**: least authority, granted explicitly, per component.

POLA is the security payoff of capabilities, and it is why this topic is the *constructive* side of security: instead of listing everything an attacker might do and blocking each, you deny *all* authority by default and grant back the minimum.

### 6. Capabilities You Already Use

You have used capabilities for years without the name:

- **A Unix file descriptor.** `open("/etc/passwd", O_RDONLY)` checks the ACL *once*, then returns an `fd` — say `3`. From then on, `read(3, ...)` does **no path check**. Holding fd 3 *is* the authority to read that open file. You can even pass fd 3 to another process over a Unix socket, and now *it* can read the file with no path lookup. That is delegation of a capability.
- **An unguessable URL.** A "secret link" to a Google Doc, a Dropbox share link, a password-reset link. Anyone who holds the URL can act; there is no login. The unguessable string *is* the key. (This is why such links must be long and random — a forgeable capability is no capability.)
- **An OAuth bearer token.** Your app gets a token; every request carries it; the server honors whoever presents it. The token names a scope of access and grants it. A capability with an expiry.
- **An object reference in a memory-safe language.** If you hold a reference to a `BankAccount` object, you can call `.withdraw()`. If you were never given the reference, you cannot reach the object at all — there is no `findAccountByName()` available to you. This is the purest form: an **object capability**.

The lesson for a junior: capabilities are not exotic. They are *handles you were given*, and the security comes from controlling **who gets handed what**.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **ACL / ambient authority** | A building where every door reads your face, checks a master list, and decides. You can walk up to *any* door and try. |
| **Capability** | A physical key. The key names exactly one lock and opens it. No list, no face scan. |
| **Designation = authority (fused)** | The key *is* the address. You can't point at a room you have no key for; you wouldn't even know it's there. |
| **Confused deputy** | A valet (deputy) who can drive any car in the lot. You hand him a ticket and say "the red Ferrari" — he fetches it, even though it isn't yours, because his authority drives any car and you merely *named* one. |
| **Capability fix** | Instead of a ticket, you hand the valet *your* car key. He can only fetch the car the key opens — yours. |
| **Attenuation** | A hotel key card programmed for *one* room and *this week only*, made from the master key. |
| **Revocation** | The front desk deactivating your key card. The card still exists; it just stops working. |
| **Delegation** | Lending your house key to a friend so they can water the plants. |
| **POLA** | Giving the dog-walker a key to *only* the side gate, not the whole house. |
| **Bearer token** | A movie ticket. Whoever holds it gets in. The cinema doesn't check your ID. |
| **Unforgeable** | A key you cannot whittle from a photo of the lock — the only way to get one is to be given one. |

---

## Mental Models

### The "No Names, Only Keys" Model

The single idea that unlocks the whole topic: in a capability world, **there is no global namespace of resources you can reach.** You cannot write `open("/etc/passwd")` because there is no ambient `open` and no `/etc/passwd` to name. You can only act through the handles someone put in your hand. If a component holds three capabilities, those three are the *entire* universe it can affect. Carry this picture: a program is a bag of keys, and it can touch exactly what its keys open — nothing more.

### The "Connectivity Begets Connectivity" Model

How does a component ever get a new capability? Only three ways: it was *born* holding it (endowment by its creator), it was *handed* one as an argument (introduction), or it *created* a new resource and got the key to it (parenthood). There is no fourth way — no "look it up by name," no "ask the environment." So authority spreads only along the lines of who-already-talks-to-whom. **You can reason about what a component could possibly reach by following the references it was given.** That is auditable; ambient authority is not.

### The "Possession Is the Permission" Model

Stop thinking "is this subject *allowed*?" and start thinking "does this code *hold the handle*?" The check is not a policy decision made at a door; it is the brute physical fact of whether the reference is in your hand. A function that needs no `fs` handle was never given one, and so the question "is it allowed to read files?" has a structural answer — *no, it has no handle* — rather than a policy answer that someone might misconfigure.

---

## Code Examples

We will contrast the two models with the **confused-deputy** scenario, then show capabilities as plain dependency injection. The point at this level is the *shape*, not a specific framework.

### The Ambient-Authority Version (the vulnerable shape)

```python
# AMBIENT AUTHORITY: any code in this process can open any path.
import os

BILLING_FILE = "/var/lib/compiler/BILL"

def record_charge(user):
    with open(BILLING_FILE, "a") as f:        # the deputy's own authority
        f.write(f"{user} owes $5\n")

def compile_source(src_path, out_path):
    record_charge(current_user())
    source = open(src_path).read()            # reads whatever path it's told
    result = do_compile(source)
    with open(out_path, "w") as f:            # writes whatever path it's told
        f.write(result)

# The attack: the user controls out_path.
compile_source("myprogram.src", "/var/lib/compiler/BILL")
# -> compiler output overwrites the billing file. Confused deputy.
```

`open()` is **ambient** — it reaches the whole filesystem. The user supplied a *name*, and the deputy's own authority did the rest. Nothing in the type signature reveals that `out_path` is dangerous.

### The Capability Version (the safe shape)

```python
# CAPABILITY STYLE: authority arrives as handles, not names.
# The function can ONLY write through the handle it was given.

def compile_source(source_text, out_file, charge_fn):
    """
    source_text : already-read string (no path, no read authority)
    out_file    : an OPEN writable file object (a capability)
    charge_fn   : a closure that records a charge (a capability to bill)
    """
    charge_fn()                      # can bill, because it was handed that power
    result = do_compile(source_text)
    out_file.write(result)           # can ONLY write where out_file points

# The caller decides what authority to hand in:
with open("myprogram.src") as src, open("out.o", "w") as dst:
    def charge():
        with open("/var/lib/compiler/BILL", "a") as b:  # caller holds BILL authority
            b.write("alice owes $5\n")
    compile_source(src.read(), dst, charge)
```

Now `compile_source` has **no `open`, no path, no filesystem.** It cannot touch `BILL` even if it wanted to, because it holds no handle to it. The authority to write `BILL` lives only in `charge`, which the *caller* (who legitimately has it) constructed. The malicious "`-o BILL`" trick has nothing to attack: there is no path argument to poison. The bug is now **unrepresentable**.

> **Note:** This is "just" passing arguments instead of importing `os`. That is the whole secret. Capability security at the language level is **disciplined dependency injection of authority**, where the discipline is: *never import ambient power; always receive it.*

### A File Descriptor Is a Capability (C)

```c
// open() checks the ACL ONCE, here:
int fd = open("/etc/hosts", O_RDONLY);   // path -> authority check -> handle

// From now on, NO path, NO recheck — the fd IS the authority:
char buf[256];
read(fd, buf, sizeof buf);               // uses the held capability

// You can DELEGATE it to another process over a Unix socket:
send_fd_over_socket(peer, fd);           // the peer can now read the file,
                                         // with no path lookup of its own
```

The integer `fd` behaves exactly like a capability: unforgeable (you can't invent a valid fd for a file you never opened), transferable (SCM_RIGHTS over a Unix socket), and it fuses designation (which open file) with authority (read it).

### Object Capability in a Memory-Safe Language (Java-ish)

```java
// You can act on an account ONLY if you hold its reference.
final class Account {
    private long cents;
    void deposit(long c)  { cents += c; }
    void withdraw(long c) { if (c <= cents) cents -= c; }
}

// A function that receives the capability:
void payRent(Account tenant, Account landlord, long rent) {
    tenant.withdraw(rent);
    landlord.deposit(rent);
}
// payRent can touch EXACTLY these two accounts. It has no registry,
// no "lookup account by name", no ambient list of all accounts.
// If it was never handed your account, it can never reach it.
```

There is no `AccountRegistry.find("alice")` here. The *absence* of an ambient lookup is the security. Authority is the reference itself.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Confused deputy** | Structurally eliminated — the bad request can't be named. | Requires rethinking APIs to pass handles, not names. |
| **Least authority** | POLA is natural: hand each part only its keys. | Ambient-authority code (most code) must be refactored to receive authority. |
| **Auditability** | What a component can reach = the keys it holds. Follow the references. | Tracking who-holds-what at runtime can be harder than reading a static ACL. |
| **Composition** | Capabilities compose: attenuate, wrap, revoke, delegate cleanly. | Revocation needs design (the caretaker/membrane pattern), not free. |
| **Supply-chain safety** | A library handed no network can't exfiltrate data, period. | Ecosystems assume ambient `fs`/`net`; libraries must be rewritten to accept authority. |
| **Familiar substrate** | fds, object references, tokens are already capabilities. | Mainstream OSes are ACL-based; capability discipline fights the grain. |
| **Mental load** | "Do I hold the handle?" is simpler than policy reasoning. | The discipline is all-or-nothing: one ambient `import os` reintroduces full authority. |

---

## Use Cases

Capability thinking is the right tool when:

- **You run untrusted or semi-trusted code.** Plugins, user scripts, third-party libraries, sandboxed extensions. Hand them keys; deny everything else.
- **You want supply-chain resilience.** A compromised dependency that was never handed a socket cannot phone home. Authority you didn't grant cannot be abused.
- **You are designing a sandbox or runtime.** WASI, browser sandboxes, and capability OSes are built this way because it is the only model that *composes* under untrust.
- **You need fine-grained delegation.** "Let this microservice read *this one* bucket prefix for *one hour*" is an attenuated, expiring capability (a signed URL).
- **You build security-critical kernels.** seL4 — a formally verified microkernel — is capability-based precisely because the model is small enough to *prove* correct.

It is the **wrong** (or harder) tool when:

- You must interoperate with a deeply ACL/identity-based world (most enterprise IAM) where roles and audit-by-identity are the lingua franca.
- The team cannot commit to the no-ambient-authority discipline — partial adoption gives partial (often false) safety.
- You genuinely need *identity-based* policy ("only HR may read salaries, whoever they are, however they got here"), where ACLs map more directly.

---

## Coding Patterns

### Pattern 1: Inject authority, never import it

```python
# BAD (ambient): the module reaches the world by itself
import requests
def fetch(url): return requests.get(url)

# GOOD (capability): the caller hands in the power to do HTTP
def fetch(http_client, url): return http_client.get(url)
```

The rule: a module's import list should contain *no* sources of authority (`os`, `socket`, `requests`, `open`). All authority arrives as parameters.

### Pattern 2: Hand a narrow handle, not a broad one (attenuation)

```python
# Instead of passing the whole filesystem or a directory:
process_upload(open(user_file, "rb"))   # one read handle, nothing else
```

Give the callee the *least* it needs: one open file, not a directory; a read handle, not read-write; one bucket prefix, not the bucket.

### Pattern 3: Wrap to attenuate rights

```python
class ReadOnly:
    def __init__(self, f): self._f = f
    def read(self, n=-1): return self._f.read(n)
    # deliberately no write(): the wrapper REMOVES authority

process(ReadOnly(open("data.bin", "rb")))
```

A wrapper that exposes a *subset* of the underlying capability's methods is the simplest attenuation device.

### Pattern 4: Create-then-hand (parenthood)

```python
sandbox_dir = make_temp_dir()             # you create the resource
plugin.run(workspace=sandbox_dir)         # and hand the plugin ONLY that
# the plugin can scribble in its sandbox and reach nothing else
```

The component that *creates* a resource holds its capability and decides who else gets it.

### Pattern 5: Token as capability (across a network)

```text
# A signed, expiring URL is a remote capability:
https://files.example.com/d/9f3a...e1?sig=...&exp=1719300000
# Whoever holds it may download THAT object until it expires.
# Unguessable + signed = unforgeable. Expiry = built-in revocation.
```

---

## Best Practices

- **Default to no authority.** A new component starts with zero capabilities. Grant back only what a task provably needs.
- **Pass handles, not names.** If an API takes a *path* or an *account id and looks it up*, it is ambient. Prefer an already-opened handle or an already-resolved object.
- **Keep the authority-holding surface small.** The fewer places that hold the powerful keys (the real `open`, the network), the smaller your trusted base.
- **Make capabilities unguessable when they're tokens.** Long, random, signed. A guessable URL or token is a forgeable capability — i.e., not a capability at all.
- **Attenuate on delegation.** When you pass a capability onward, pass the *weakest* sufficient version (read-only, single-resource, time-limited).
- **Design revocation in from the start.** Decide *how* a handed-out capability gets disabled before you hand it out. (The pattern for this — a revocable forwarder — is `senior.md` material.)
- **Audit by following references, not by reading policy.** "What can this module touch?" is answered by listing the capabilities it was given.

---

## Edge Cases & Pitfalls

- **One ambient import undoes everything.** A module that receives a tidy set of capabilities but *also* does `import os` has full ambient authority again. The discipline is only as strong as its weakest module.
- **A capability you can't revoke is a capability forever.** Hand someone a raw file handle and you can never take it back. If you may need to revoke, hand a *wrapper* you control, not the raw thing.
- **Forgeable "capabilities" aren't.** A short, guessable URL or a sequential token is something an attacker can manufacture. Designation-equals-authority only holds if the token is unforgeable.
- **Leaking a capability = leaking authority.** Logging a signed URL, putting a token in an error message, or storing a handle where untrusted code can read it hands out the key.
- **Bearer tokens have no identity, by design.** That is the point *and* the risk: whoever steals one *is* authorized. Treat them like keys, not like passwords.
- **Ambient authority hides in "helpful" globals.** A logger that writes to a fixed file, a config that reads env vars, a singleton database connection — all are ambient authority smuggled in through the back door.
- **Amplification surprises.** Some systems let two weak capabilities *combine* into a stronger one ("rights amplification"). Convenient, but it means "what can this hold?" is not always just the union of its keys.

---

## Common Mistakes

1. **Passing a name and "checking permission separately."** That *is* the ACL model and *is* the confused-deputy setup. Pass the handle instead.
2. **Calling it capabilities while keeping ambient `open`/`socket`.** If the module can still reach the world on its own, you have an ACL system wearing a costume.
3. **Treating a guessable URL/token as secure.** Forgeable tokens give attackers free capabilities.
4. **Handing out raw handles when you'll need to revoke.** Always wrap if revocation might be required.
5. **Logging or serializing capabilities.** Tokens in logs, handles in dumps — you just published the keys.
6. **Granting a directory when one file would do.** Over-broad authority defeats POLA; the blast radius is everything you handed, not everything that was used.
7. **Assuming the OS does this for you.** Mainstream Unix/Windows are ACL-based with heavy ambient authority. Capability discipline is something *you* impose in your design.
8. **Conflating identity with authority.** "Who is the caller?" is the wrong question in this model; "what handle did they pass?" is the right one.

---

## Tricky Points

- **The check moves from *use-time* to *grant-time*.** An ACL checks every access; a capability checks once, when it is created/granted, and never again. That is faster *and* it is what makes the confused deputy impossible — but it means **getting the grant right is everything.**
- **Designation = authority is the whole theorem.** Every property (no confused deputy, easy POLA, follow-the-references auditing) is a corollary of fusing the name and the right. If you ever split them again, you lose the guarantees.
- **A capability system can *emulate* an ACL, but not vice versa cheaply.** You can build identity checks on top of capabilities (hand each user a personalized facet). Going the other way — getting confused-deputy safety out of an ambient-ACL system — requires bolting on capabilities (like file descriptors already are).
- **"No ambient authority" is a property of the *whole* environment, not one function.** A pure function in an impure language still lives in a process with ambient `open`. True ocap requires the *language/runtime* to deny ambient access (no global `import os`), which is why dedicated ocap languages exist.
- **Bearer tokens prove the model is everywhere.** Every "secret link" and OAuth token is a capability. The web reinvented capabilities because, across a trust boundary with no shared identity, *holding the secret* is the only thing that scales.

---

## Test Yourself

1. State the difference between *designation* and *authority* in one sentence each. Then explain what it means for a capability to *fuse* them.
2. Re-tell the confused-deputy compiler story in your own words. Identify exactly which argument was a *name* and where the *ambient* authority came from.
3. In the capability version of the compiler, *why* can the malicious user no longer attack? Point at the specific thing that is now missing from the function's reach.
4. Give three capabilities you have personally used this week. For each, say what it designates and what authority it grants.
5. A function signature is `def thumbnail(image_path: str) -> bytes`. Rewrite it to be capability-style. What did you remove, and what does the caller now have to do?
6. Explain why a *guessable* download URL is not really a capability, using the word "unforgeable."
7. Your teammate says "we use capabilities" but every module starts with `import requests`. Explain why this is not actually a capability system.
8. Why is "check the ACL once at `open()`, then trust the fd" both *faster* than re-checking every `read()` *and* the reason file descriptors avoid a confused-deputy bug on the read path?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                  CAPABILITY-BASED SECURITY                       │
├──────────────────────────────────────────────────────────────────┤
│ ACL / ambient model:  "Who are you? Are you on the list?"        │
│   designation (name)  is FREE & universal — anyone names anything│
│   authority (allow?)  decided by a separate check at use-time    │
├──────────────────────────────────────────────────────────────────┤
│ Capability model:     "Do you hold the key?"                     │
│   ONE token = designation + authority, fused & unforgeable       │
│   no list, no identity check, no ambient namespace               │
├──────────────────────────────────────────────────────────────────┤
│ Confused deputy:  privileged code tricked via a NAME it was given│
│   cure: pass a HANDLE (capability), not a name — bug unnameable  │
├──────────────────────────────────────────────────────────────────┤
│ POLA: every part holds only the keys it needs, nothing more      │
├──────────────────────────────────────────────────────────────────┤
│ Capabilities you already use:                                    │
│   * Unix file descriptor   (check once, then fd IS authority)    │
│   * unguessable / signed URL (bearer capability over the web)    │
│   * OAuth token            (scoped, expiring capability)         │
│   * object reference       (ocap: hold it = can call it)         │
├──────────────────────────────────────────────────────────────────┤
│ Operations on capabilities:                                      │
│   attenuate  hand a weaker version (read-only, one file, expiring)│
│   delegate   pass it onward                                       │
│   revoke     make it stop working (needs a wrapper you control)  │
├──────────────────────────────────────────────────────────────────┤
│ The discipline:                                                  │
│   * default to ZERO authority                                    │
│   * never IMPORT power; always RECEIVE it as an argument         │
│   * one ambient `import os` reintroduces everything              │
│   * audit by following the references a component was given      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **capability** is an unforgeable, transferable token that **both designates a resource and grants the right to use it** — designation and authority fused into one thing.
- The mainstream alternative is the **ACL / ambient-authority** model: anyone can *name* any resource, and a separate check at use-time decides whether they're allowed. Authority hangs in the air around every process.
- Ambient authority causes the **confused deputy**: privileged code is tricked, via a *name* it was handed, into wielding its own authority for a less-privileged caller. The canonical example is Norm Hardy's pay-per-use compiler tricked into overwriting its billing file with `-o BILL`.
- Capabilities **structurally prevent** this: if the caller must pass a *handle* (which they could only obtain by already holding the authority), the malicious request becomes **unrepresentable** — there is no name to poison.
- **POLA**, the Principle of Least Authority, falls out naturally: hand each component only the keys it needs. The blast radius of a compromised part is exactly the capabilities it held.
- You already use capabilities: **Unix file descriptors** (checked once, then the fd *is* the authority), **unguessable/signed URLs**, **OAuth bearer tokens**, and **object references** in memory-safe languages.
- The core discipline is simple to say and strict to keep: **never import authority; always receive it.** One ambient import reintroduces full ambient power.
- This is the **affirmative** side of security: not "detect and block the attack," but "structure the program so the attack cannot be expressed."

---

## What You Can Build

- **A confused-deputy demo.** Write the vulnerable compiler-billing program (ambient `open`), exploit it with a malicious output path, then rewrite it capability-style and show the exploit no longer compiles/runs.
- **A capability-style file processor.** A function that resizes an image but is *only* handed an input read-handle and an output write-handle — no `os`, no paths. Prove it can't touch anything else.
- **A revocable share link.** A tiny web endpoint that mints unguessable, signed, expiring URLs to a single object, and a "revoke" button that disables one without affecting others.
- **An fd-passing experiment.** Two Unix processes; one opens a file and passes the *fd* (not the path) to the other via `SCM_RIGHTS`. Confirm the second process reads the file with no path lookup of its own.
- **A "least-authority" audit of a real script.** Take a script you wrote, list every ambient power it uses (`open`, `requests`, env vars), and refactor it so all authority is injected at the top.

---

## Further Reading

- *The Confused Deputy* — Norm Hardy, 1988. The four-page paper that named the problem. The compiler-billing story is here. https://cap-lore.com/CapTheory/ConfusedDeputy.html
- *Capability-Based Computer Systems* — Henry Levy. The classic survey of capability hardware and OSes (Plessey 250, CAP, Hydra, KeyKOS). http://homes.cs.washington.edu/~levy/capabook/
- *Paradigm Regained: Abstraction Mechanisms for Access Control* — Mark S. Miller & Jonathan Shapiro. The clearest modern statement of the object-capability model.
- *What Are Capabilities?* — an accessible long-form introduction by Chip Morningstar (the "habitat" essay). http://habitatchronicles.com/2017/05/what-are-capabilities/
- *POSIX `open(2)` / file-descriptor passing (`unix(7)`, `SCM_RIGHTS`)* — read these to see capabilities you already use. https://man7.org/linux/man-pages/man2/open.2.html
- *The Principle of Least Authority (POLA)* — Saltzer & Schroeder's "least privilege" (1975), refined into least *authority*. https://web.mit.edu/Saltzer/www/publications/protection/
- *seL4 Whitepaper* — the formally verified, capability-based microkernel. https://sel4.systems/

---

## Diagrams & Visual Aids

### ACL vs Capability: Where the Decision Lives

```text
ACL / AMBIENT MODEL
  subject ──names──► "/etc/passwd"           (anyone can name anything)
                          │
                          ▼
                   ┌──────────────┐
                   │  CHECK ACL   │  ◄── decision at USE-TIME, every access
                   │ is Alice ok? │
                   └──────┬───────┘
                     yes  │  no
                  ────────┴────────►  (allow / deny)

CAPABILITY MODEL
  subject ──holds──► [ KEY: this file, read ]   (only if it was handed one)
                          │
                          ▼
                     use the key        ◄── NO check; holding it IS the right
                          │
                          ▼
                      (read happens)
```

### The Confused Deputy

```text
        ┌──────────── USER (cannot write BILL) ────────────┐
        │  "compile myprog.src  -o BILL"   ◄── just a NAME │
        └───────────────────────┬──────────────────────────┘
                                 │ passes a name
                                 ▼
        ┌──────────── COMPILER (the DEPUTY) ───────────────┐
        │  has its OWN authority to write BILL (ambient)    │
        │  opens the user-named output file ... = BILL      │
        │  writes compiler output  ──► BILL DESTROYED       │
        └──────────────────────────────────────────────────┘

   The deputy was CONFUSED: it used ITS authority on the USER's behalf.
```

### The Capability Fix

```text
        ┌──────────── USER ────────────┐
        │ can only produce a handle to  │
        │ files the USER may write.     │
        │ -> CANNOT make a BILL handle. │
        └───────────────┬───────────────┘
                        │ passes a HANDLE (capability)
                        ▼
        ┌──────────── COMPILER ─────────┐
        │ writes through the handle.     │
        │ has NO path arg, NO ambient    │
        │ open -> cannot reach BILL.     │
        └────────────────────────────────┘

         The attack has nothing to poison. Bug = UNREPRESENTABLE.
```

### Connectivity Begets Connectivity (how authority spreads)

```text
   A component gains a capability ONLY by:

   (1) ENDOWMENT      ── born holding it (creator gave it at birth)
   (2) INTRODUCTION   ── handed one as an argument by someone who holds it
   (3) PARENTHOOD     ── it created a new resource, got the key

   There is NO (4): no "look it up by name", no "ask the environment".

        held keys = the ENTIRE reachable world of a component
        audit "what can it touch?"  ==  follow its references
```

### A File Descriptor's Life as a Capability

```text
   open("/etc/hosts", O_RDONLY)
        │   ▲
        │   └── ACL checked HERE, ONCE (path -> permission)
        ▼
      fd = 3   ◄── unforgeable handle: fuses (which file) + (read right)
        │
        ├── read(3, ...)            no path, no recheck — fd IS authority
        │
        └── sendmsg(SCM_RIGHTS, 3)  delegate to another process
                    │
                    ▼
            peer holds fd, reads the file, with NO path lookup of its own
```
