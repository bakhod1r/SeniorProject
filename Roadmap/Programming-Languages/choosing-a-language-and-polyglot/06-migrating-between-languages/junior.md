# Migrating Between Languages — Junior

> **What?** Migration is moving an existing, *working* system from one language to another — rewriting the code in Python as Go, in Perl as Java, in CoffeeScript as TypeScript. It is not building something new; it is rebuilding something that already runs in production and that people already depend on.
> **How?** Treat it as one of the highest-risk things you can do to a codebase, because the upside is small ("same features, different language") and the downside is enormous ("we broke the thing that worked"). The cardinal rule: **the old system works, the rewrite might not.**

---

## 1. Why migration is different from normal work

Most work *adds* value. You build a feature that didn't exist, fix a bug that hurt users, make a page load faster. The user notices and is better off.

Migration is the rare project where, if you do it *perfectly*, the user notices **nothing**. Same features, same behavior, same screens — just written in a different language underneath. All the visible upside is zero. Everything that *can* happen is a regression: a feature that used to work now doesn't, a bug that was fixed five years ago comes back, an edge case the old code handled silently gets dropped.

```
Normal feature work:   risk ──┐         ┌── reward
                              ▼         ▼
                          [small]   [can be huge]

Language migration:    risk ────────┐   ┌─ reward
                                    ▼   ▼
                              [can be huge]  [usually ~zero to users]
```

This asymmetry is the whole reason migration deserves fear and respect. You are spending months of expensive engineering time, and the *best* outcome is that nobody can tell you did anything. **You are playing a game where you can only lose points.**

---

## 2. What you're actually fighting: the old code knows things you don't

The working system isn't just code — it's **years of accumulated bug fixes, edge cases, and hard-won corrections**, most of them undocumented. Every weird-looking `if` in that old Perl script is probably there because something broke in production at 3am in 2014 and someone patched it. The patch stayed. The reason left with the engineer who quit.

When you rewrite from scratch, you throw all of that away and start over. The new code is *clean* — and clean means it doesn't yet know about the customer in Brazil whose phone number has no area code, the file that's sometimes UTF-16, the date that's stored as a string in three different formats. The old code learned those lessons the hard way. **Your shiny rewrite has to relearn every single one, in production, on real users.**

This is why experienced engineers flinch when a teammate says "this code is a mess, let's just rewrite it." The mess is often *knowledge*. Ugly, undocumented, irreplaceable knowledge.

---

## 3. The two ways to migrate

There are fundamentally two strategies, and the difference between them decides whether your project lives or dies.

| | **Big-bang rewrite** | **Incremental migration** |
|---|---|---|
| Plan | Build the whole new system in parallel, then switch over all at once | Move one piece at a time; old and new run side by side |
| The switch | A single, terrifying cutover day | Many tiny, boring cutovers |
| Feature work meanwhile | Frozen — the old system stops getting features | Continues — you migrate *and* ship |
| If it goes wrong | The whole thing fails together; rollback is enormous | One small piece fails; roll back just that piece |
| Feels like | A bet-the-company moonshot | Slow, unglamorous, safe |

The big-bang rewrite is the one that *feels* right — clean slate, no legacy cruft, finally do it properly! — and it is the one that kills projects. The incremental approach feels slow and unsatisfying, and it is the one that works. **Almost every migration horror story is a big-bang. Almost every quiet success is incremental.** (The middle level covers the named pattern for doing this — the *strangler fig*.)

---

## 4. The cautionary tale every engineer should know

In 2000, Joel Spolsky wrote an essay titled **["Things You Should Never Do, Part I."](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/)** His "single worst strategic mistake that any software company can make" was:

> **Deciding to rewrite the code from scratch.**

His example: **Netscape.** In the late '90s, Netscape's Navigator browser had most of the market. Their engineers looked at the aging codebase, declared it unmaintainable, and decided to throw it out and rewrite the browser from the ground up. The rewrite took roughly **three years.** During those three years, Netscape shipped essentially nothing new while Microsoft's Internet Explorer — which kept *improving its existing code* — ate the entire market. By the time the rewrite shipped, Netscape was effectively finished.

Spolsky's core argument is the one from section 2: that "unmaintainable" old code is full of fixes for real bugs, and a rewrite throws away years of debugging to recreate the same bugs from scratch. His verdict on the "it's a mess, rewrite it" instinct:

> *"It's harder to read code than to write it."*

The mess looks worse than it is because reading someone else's code is hard. That feeling is not evidence that a rewrite will be faster. It almost never is.

---

## 5. The cardinal rule, and why juniors break it

**The old system works. The rewrite might not.**

That single sentence should sit in your head every time the word "rewrite" comes up. The working system has *earned* its trust by running in production. The rewrite has earned nothing yet — it's a promise, and promises slip.

Juniors break this rule for understandable reasons:

- **The old code is unpleasant to work in.** True. But "unpleasant" is a cost you pay; "broken in production" is a cost your *users* pay. Those aren't the same.
- **The new language is genuinely nicer.** Maybe! But a nicer language doesn't relearn all those edge cases for you. You still have to.
- **A rewrite feels like progress.** It feels productive to delete the old mess and start clean. But to the user and the business, you've spent months to arrive back where you started — *if* you're lucky.

> The mature instinct isn't "never migrate." Sometimes you genuinely must (the language is dead, you can't hire for it, it's a security liability). It's: **migration is a last resort with a heavy burden of proof, and when you do it, you do it incrementally so a mistake costs one component, not the company.**

---

## 6. Before you ever say "let's rewrite it," ask

- [ ] **Does the old system actually work?** If yes, the bar to replace it is high. You're betting against a proven thing.
- [ ] **Is the pain the *language*, or just messy code?** Messy code can be refactored *in place* — far cheaper than a rewrite. (See [`05-when-to-introduce-a-new-language`](../05-when-to-introduce-a-new-language/).)
- [ ] **Can we wrap it instead of replacing it?** Sometimes you put a clean interface in front of the old system and leave it alone. (See [`04-interop-and-polyglot-architectures`](../04-interop-and-polyglot-architectures/).)
- [ ] **If we migrate, can we do it one piece at a time?** If the only plan is "big bang," that's a red flag, not a plan.
- [ ] **What do we lose if the rewrite stalls halfway?** Many rewrites die at 70%. What's your position then?
- [ ] **Are we migrating for the users/business, or because we're bored of the old language?** Be honest. "I want to write Rust" is not a business case.

---

## 7. What's next

| Topic | File |
|---|---|
| The strangler fig pattern and how incremental migration actually works | `middle.md` |
| When *not* to migrate, and de-risking the migrations you must do | `senior.md` |
| Justifying and running migrations across a whole org | `professional.md` |
| Interview questions on migration strategy | `interview.md` |
| Design exercises: strangler plans, kill cases, cutover sequencing | `tasks.md` |

---

**Memorize this:** migration is rebuilding software that already works, so it's mostly downside risk — the old code holds years of invisible bug fixes you'll be forced to relearn. The old system works; the rewrite might not. When you must move, move *incrementally*, one piece at a time — never in one big bang. And read Joel Spolsky's "Things You Should Never Do" before you propose your first rewrite.
