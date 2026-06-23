# Aspect-Oriented Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Aspect-Oriented Programming
> *The junior level gave you the idea. This level gives you the precise machinery: the five words every AOP discussion uses (join point, pointcut, advice, aspect, weaving), the three places weaving can happen, and the two implementations you'll actually meet — Spring's runtime proxies and AspectJ's bytecode weaving.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The AOP Vocabulary, Precisely](#the-aop-vocabulary-precisely)
4. [The Five Kinds of Advice](#the-five-kinds-of-advice)
5. [Pointcut Expressions — Matching Join Points](#pointcut-expressions--matching-join-points)
6. [Weaving — Compile-Time, Load-Time, Runtime](#weaving--compile-time-load-time-runtime)
7. [How a Runtime Proxy Actually Intercepts a Call](#how-a-runtime-proxy-actually-intercepts-a-call)
8. [Spring AOP vs AspectJ](#spring-aop-vs-aspectj)
9. [A Complete Spring AOP Aspect](#a-complete-spring-aop-aspect)
10. [The Same Idea in Python and Go](#the-same-idea-in-python-and-go)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The exact mechanics — name every part and know how the wiring works.**

At the junior level, "an aspect wraps a method" was enough. Now you need to talk about AOP the way the frameworks and the literature do, because every config option, every annotation, and every bug report is phrased in this vocabulary. AOP has exactly five core nouns and a handful of verbs, and once they click, the whole `@Transactional`-and-friends machinery stops being magic.

The throughline of this level: **an aspect is a pointcut + advice, and weaving is what connects them to your code.** Everything else — proxies, bytecode manipulation, compile-time vs runtime — is *how* the weaving is implemented, and that implementation choice drives every real-world limitation you'll hit (self-invocation, final methods, startup cost). Get the vocabulary exact first; then the trade-offs at senior level land cleanly.

---

## Prerequisites

- **Required:** You understand cross-cutting concerns, scattering/tangling, and before/after/around advice from [`junior.md`](junior.md).
- **Required:** You can read Java with annotations (`@Annotation`) and have seen interfaces and method calls.
- **Helpful:** You've used Spring (any `@Service`/`@Component`), or written a Python decorator, or any HTTP middleware.
- **Helpful:** A rough idea of what "bytecode" and "the JVM" are — we contrast bytecode weaving with runtime proxies.

---

## The AOP Vocabulary, Precisely

Five nouns. Memorize these definitions — they're the spine of every AOP conversation.

| Term | Precise definition | Mundane example |
|------|-------------------|-----------------|
| **Join point** | A *point during execution* where an aspect *could* run. In Spring AOP it's always "a method is being called." (AspectJ adds field access, constructor calls, exception handlers, etc.) | The call to `accountService.transfer(...)` |
| **Pointcut** | A *predicate* that selects a **set** of join points by matching a pattern. The "where." | `execution(* com.bank.service.*.*(..))` — "every method in the `service` package" |
| **Advice** | The *code* that runs at a matched join point, and *when* (before/after/around). The "what" and "when." | `log.info("entering " + methodName)` |
| **Aspect** | A *module* bundling pointcuts with their advice — one cross-cutting concern in one place. | The `LoggingAspect` class |
| **Weaving** | The *process* of inserting aspect code at the matched join points so the advice actually runs. The "how it gets wired." | Spring building a proxy; AspectJ rewriting bytecode |

The one sentence that ties them together:

> **An aspect says: at the join points my pointcut matches, run this advice — and weaving makes it happen.**

A useful sanity check on each term: a **join point** is a *single* spot in execution; a **pointcut** *names a set* of join points (it's a query, not a place). People constantly blur these two — "the pointcut" when they mean "the join point" and vice versa. The pointcut is the *pattern*; each thing it matches is a join point.

---

## The Five Kinds of Advice

Junior gave you before / after / around. The real taxonomy has **five**, because "after" splits by *how* the method ended:

| Advice | Runs… | Sees the return value? | Typical use |
|--------|-------|------------------------|-------------|
| **Before** | before the method body | no | security check, validation, "entering" log |
| **After returning** | after the method *returns normally* | **yes** (can read/modify it) | audit the result, cache the result |
| **After throwing** | only if the method *threw* | the exception | error logging, metrics on failures |
| **After (finally)** | after the method, *however it ended* | no | cleanup, "leaving" log, releasing a resource |
| **Around** | wraps the whole call | yes — it *is* the call | timing, caching, transactions, retry |

Mapping to Spring's annotations:

```java
@Before("serviceMethods()")            void before(JoinPoint jp) { ... }
@AfterReturning(pointcut="...", returning="result")  void ok(Object result) { ... }
@AfterThrowing(pointcut="...", throwing="ex")        void boom(Throwable ex) { ... }
@After("serviceMethods()")             void always(JoinPoint jp) { ... }   // finally-style
@Around("serviceMethods()")            Object around(ProceedingJoinPoint pjp) throws Throwable {
    // ...before...
    Object result = pjp.proceed();     // <-- YOU call the real method
    // ...after...
    return result;
}
```

The defining feature of **around** is `proceed()`: only around advice receives a `ProceedingJoinPoint`, and only around advice decides **whether, when, and with what arguments** to invoke the real method. That's why caching is around (skip `proceed()` on a hit), transactions are around (commit after `proceed()`, rollback if it throws), and retry is around (call `proceed()` in a loop). Before/after advice can only *observe*; around can *intercept and replace*.

> **Rule of thumb:** use the *least powerful* advice that does the job. Around is the heavy tool — it can swallow exceptions, change the return value, and forget to call `proceed()` entirely (a classic bug that silently stops the real method from running). Reach for before/after-returning/after-throwing when you only need to observe.

---

## Pointcut Expressions — Matching Join Points

A **pointcut expression** is a tiny query language for selecting join points. AspectJ's syntax (which Spring borrows) is the standard. The workhorse is `execution`:

```
execution(  modifiers?  return-type  declaring-type?  method-name(params)  throws? )
```

```java
// Every public method, any return type, in any class of the service package,
// with any arguments:
execution(public * com.bank.service.*.*(..))
//        │      │  │                 │ │  └ (..) = any number/type of args
//        │      │  │                 │ └ any method name
//        │      │  │                 └ any class in that package
//        │      │  └ the package
//        │      └ * = any return type
//        └ optional modifier
```

More pointcut designators you'll see:

```java
within(com.bank.service..*)              // any join point inside this package tree
@annotation(org.springframework.transaction.annotation.Transactional)  // methods marked @Transactional
@within(com.bank.Audited)                // methods of classes annotated @Audited
args(java.lang.String, ..)               // first arg is a String
bean(*Service)                           // Spring beans whose name ends in "Service"
```

Pointcuts compose with `&&`, `||`, `!`, and you give them names so advice can reference them:

```java
@Pointcut("execution(* com.bank.service.*.*(..))")
public void inService() {}                       // named pointcut

@Pointcut("@annotation(Audited)")
public void audited() {}

@Before("inService() && audited()")              // compose two named pointcuts
public void check(JoinPoint jp) { ... }
```

> **The `@annotation(...)` pointcut is the bridge to modern style.** Instead of matching by *location* (`execution(... service ...)`), you match by *marker*: "any method annotated `@Retry`." This is why today's AOP feels like "just put an annotation on it" — the pointcut is `@annotation(Retry)`, and the annotation is the opt-in. Spring's `@Transactional`, `@Cacheable`, and `@Async` all work exactly this way.

---

## Weaving — Compile-Time, Load-Time, Runtime

Weaving is *when and how* aspect code gets inserted. There are three points in a class's life where it can happen, and the choice has real consequences.

```
   SOURCE  ──javac──►  BYTECODE (.class)  ──classloader──►  LOADED CLASS  ──new──►  OBJECT
              ▲                    ▲                              ▲                    ▲
         (1) COMPILE-TIME    (post-compile)              (2) LOAD-TIME          (3) RUNTIME
         AspectJ compiler    weave existing .class       JVM agent rewrites     proxy wraps
         weaves as it builds at build time               bytes as loaded        the object
```

| Weaving | When | How | Trade-offs |
|---------|------|-----|-----------|
| **Compile-time** | at build, by a special compiler (`ajc`) | aspect code is baked into the `.class` files | Fastest at runtime (no proxy indirection); can weave *anything* (private methods, field access, `final`, even calls within the same class). Needs the AspectJ compiler in your build. |
| **Load-time (LTW)** | as each class is loaded by the JVM | a Java agent (`-javaagent`) rewrites bytecode in memory | No special compiler; weave third-party/already-compiled classes; same power as compile-time. Costs startup time and needs the agent configured. |
| **Runtime (proxy)** | when the object is created | a **proxy object** wraps your bean and intercepts calls | No agent, no special compiler — pure library. *This is Spring AOP.* But: only intercepts calls **through the proxy** (the self-invocation limit), only public/overridable methods, only Spring-managed beans. |

The headline: **AspectJ does compile-time or load-time bytecode weaving** (modifies the actual class), while **Spring AOP does runtime proxy weaving** (wraps the object). Bytecode weaving is more powerful and has fewer limits; proxy weaving is far simpler to set up and "just works" with a plain Spring app. Almost every limitation discussed at senior level traces directly to *which* of these three a system uses.

---

## How a Runtime Proxy Actually Intercepts a Call

Spring AOP's "magic" is a **proxy** — a stand-in object that looks identical to your bean but wraps the real one. Understanding this one mechanism explains both how Spring AOP works *and* why it has its specific limitations.

When Spring detects that a bean is the target of any aspect, it doesn't hand callers the real object. It hands them a **proxy** that implements the same interface (or subclasses the class) and holds a reference to the real bean:

```
   caller ──► proxy.transfer()
                  │
                  ├─ run BEFORE advice (security check)
                  ├─ try { result = realBean.transfer();   // delegate to the real object
                  │       run AFTER-RETURNING advice }
                  ├─ catch { run AFTER-THROWING advice }
                  └─ finally { run AFTER advice }
              ◄── return result
```

Two proxy mechanisms, chosen automatically:

- **JDK dynamic proxy** — used when the bean implements an interface. The proxy implements that interface and forwards through an `InvocationHandler`. Callers must depend on the *interface*, not the concrete class.
- **CGLIB proxy** — used when there's no interface. Spring generates a **subclass** of your bean at runtime and overrides each method to add advice. (This is why proxied methods can't be `final` — you can't override `final`.)

```java
// Conceptually, the generated proxy is:
class AccountService$$Proxy extends AccountService {
    AccountService target;
    @Override public void transfer(...) {
        securityAspect.before();          // advice
        try { target.transfer(...); }     // the REAL method on the REAL object
        finally { loggingAspect.after(); }
    }
}
```

This single picture explains the two most-asked gotchas (full treatment at senior level):

1. **Self-invocation doesn't trigger advice.** If `transfer()` internally calls `this.audit()`, that inner call goes to the *real object's* `this`, **not** through the proxy — so any aspect on `audit()` is skipped. The advice only runs on calls that pass *through the proxy* from outside.
2. **`final` and `private` methods can't be advised** by the CGLIB proxy, because the proxy works by *overriding* methods in a subclass, and you can't override `final` or `private`.

Both vanish with AspectJ, because bytecode weaving edits the method *itself* — there's no proxy and no "through the proxy" requirement.

---

## Spring AOP vs AspectJ

These are the two AOP systems you'll actually use in the JVM world. They're often combined (Spring *uses* AspectJ's pointcut syntax), so be precise about what differs.

| | **Spring AOP** | **AspectJ** |
|---|---|---|
| Weaving | Runtime, **proxy-based** | Compile-time or load-time, **bytecode** |
| Join points | **Method execution only** (on Spring beans) | Methods, constructors, field read/write, exception handlers, static init… |
| Power | Limited by the proxy (no self-invocation, no `final`/`private`, beans only) | Weaves *anything*, including calls within the same object |
| Setup | Just Spring — no agent, no special compiler | Needs `ajc` (compile-time) or a `-javaagent` (load-time) |
| Performance | One extra indirection per advised call | No proxy indirection; advice inlined into bytecode |
| Scope | Only Spring-managed beans | Any class, including third-party and JDK classes |
| Pointcut language | A **subset** of AspectJ's | The full AspectJ language |

> **The practical decision:** reach for **Spring AOP** by default — it covers the 95% case (transactions, caching, security on your service methods) with zero build changes. Reach for **AspectJ** only when you hit the proxy's walls: you need to advise self-invocations, `final`/`private` methods, field access, constructors, or non-Spring classes. Spring even supports a hybrid: use Spring to manage beans but switch to AspectJ load-time weaving (`@EnableLoadTimeWeaving`) for the cases Spring AOP can't reach.

---

## A Complete Spring AOP Aspect

Putting the whole vocabulary together — a timing-and-logging aspect over a service package:

```java
@Aspect
@Component                                                   // make Spring discover it
public class ObservabilityAspect {

    private static final Logger log = LoggerFactory.getLogger("aspect");

    @Pointcut("execution(* com.bank.service.*.*(..))")       // POINTCUT: where
    public void serviceMethods() {}

    @Before("serviceMethods()")                              // BEFORE advice
    public void logEntry(JoinPoint jp) {
        log.info("-> {} {}", jp.getSignature().getName(), Arrays.toString(jp.getArgs()));
    }

    @AfterThrowing(pointcut = "serviceMethods()", throwing = "ex")   // AFTER-THROWING
    public void logError(JoinPoint jp, Throwable ex) {
        log.error("!! {} threw {}", jp.getSignature().getName(), ex.toString());
    }

    @Around("serviceMethods()")                              // AROUND advice (timing)
    public Object time(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.nanoTime();
        try {
            return pjp.proceed();                            // call the REAL method
        } finally {
            long ms = (System.nanoTime() - start) / 1_000_000;
            log.info("<- {} took {}ms", pjp.getSignature().getName(), ms);
        }
    }
}
```

That's the entire model. **One** aspect class; **one** pointcut naming every service method; **three** pieces of advice. No service method contains a single log or timing line, yet every one of them is logged, timed, and error-tracked. Add a new service method tomorrow and it's covered automatically — the pointcut already matches it.

---

## The Same Idea in Python and Go

AOP isn't a Java concept; it's a *paradigm* that each ecosystem expresses with its own tools.

**Python** uses decorators (an in-language aspect) and, for "apply to many methods at once," a class decorator or metaclass:

```python
def traced(fn):                          # advice + weaving, in one decorator
    @functools.wraps(fn)
    def wrapper(*a, **k):
        log.info("-> %s", fn.__name__)   # before
        try:
            return fn(*a, **k)           # around: the real call
        finally:
            log.info("<- %s", fn.__name__)  # after (finally)
    return wrapper

def trace_all(cls):                      # a "pointcut": every public method of the class
    for name, member in vars(cls).items():
        if callable(member) and not name.startswith("_"):
            setattr(cls, name, traced(member))
    return cls

@trace_all
class OrderService:
    def create(self, o): ...             # automatically traced
    def cancel(self, o): ...             # automatically traced
```

`@trace_all` plays the role of a *pointcut* ("every public method") and weaves `traced` (the *advice*) onto each — exactly Spring's "execution(* OrderService.*(..))" idea, hand-rolled.

**Go** has no annotations or proxies; its answer is **middleware** — the same wrap-from-outside idea expressed as higher-order functions over handlers:

```go
type Handler func(ctx context.Context, req Request) (Response, error)

// "advice" that wraps any handler — the Go form of an around aspect:
func WithLogging(next Handler) Handler {
    return func(ctx context.Context, req Request) (Response, error) {
        start := time.Now()
        log.Printf("-> %s", req.Op)
        resp, err := next(ctx, req)               // proceed()
        log.Printf("<- %s in %s", req.Op, time.Since(start))
        return resp, err
    }
}

handler = WithLogging(WithAuth(WithMetrics(coreHandler)))   // weave a stack
```

Go's culture deliberately prefers this *explicit* wrapping: you can *see* `WithLogging` at the wiring site. That visibility is the opposite of Spring's invisible proxy — and it's the central trade-off the senior level explores.

---

## Common Mistakes

- **Saying "pointcut" when you mean "join point" (or vice versa).** A join point is one spot in execution; a pointcut is the *pattern* that selects a set of them. Interviewers and code reviews catch this instantly.
- **Using `@Around` when `@Before`/`@AfterReturning` would do.** Around is powerful but easy to misuse — forget to call `proceed()` and you've silently disabled the method; mishandle its return type and you corrupt the result. Use the weakest advice that fits.
- **Expecting Spring AOP to advise an internal `this.method()` call.** It won't — self-invocation bypasses the proxy. This surprises everyone once. If you need it, refactor so the call comes from outside, inject the bean into itself, or switch to AspectJ.
- **Marking a method `final` and wondering why the aspect doesn't fire.** CGLIB proxies override methods to add advice; `final` can't be overridden, so the advice is silently skipped.
- **Writing pointcuts by *location* when *annotation* is clearer.** `execution(* *..*Service.*(..))` is brittle — it breaks when packages move. `@annotation(Audited)` matches intent directly and travels with the code. Prefer annotation-driven pointcuts for opt-in concerns.
- **Forgetting that a too-broad pointcut advises *everything*.** `execution(* *(..))` will wrap getters, `toString`, and framework callbacks, tanking performance and producing log noise. Scope pointcuts tightly.

---

## Summary

AOP has **five core terms**: a **join point** (a point in execution where an aspect could run — in Spring AOP, always a method call), a **pointcut** (a predicate selecting a *set* of join points), **advice** (the code that runs, in five flavors: before, after-returning, after-throwing, after-finally, around), an **aspect** (a module bundling pointcuts with advice), and **weaving** (inserting the advice). **Around advice** is the powerful one — it alone receives `proceed()` and decides whether/when/how to call the real method, which is why caching, transactions, and retry are all around. **Pointcut expressions** are a query language (`execution(...)`, `@annotation(...)`, `within(...)`); annotation-based pointcuts are the bridge to modern "just add `@Transactional`" style. **Weaving** happens at one of three times — **compile-time** or **load-time** (AspectJ, editing real bytecode, no limits) or **runtime via proxies** (Spring AOP, wrapping the object). The proxy mechanism explains Spring AOP's signature limits: **self-invocation** bypasses advice, and **`final`/`private`** methods and **non-bean** classes can't be advised. Python expresses the same paradigm with decorators and class decorators; Go expresses it explicitly with middleware. The next level turns these mechanics into judgment: when AOP clarifies, when it hides, and why it thrives narrowly while it faded as a general tool.

---

## Further Reading

- *AspectJ Programming Guide* — the canonical reference for join points, pointcuts, and weaving; the source of the vocabulary everyone borrows.
- Spring Framework Reference, "Aspect Oriented Programming with Spring" §, and "Proxying Mechanisms" (JDK vs CGLIB) — exactly how Spring's runtime weaving works.
- Ramnivas Laddad, *AspectJ in Action*, 2nd ed. — the five advice types and weaving models in depth, with worked aspects.
- Spring's `@EnableLoadTimeWeaving` docs — the hybrid path when proxy-based AOP hits its limits.

---

## Related Topics

- [`junior.md`](junior.md) — the scattering/tangling motivation and before/after/around intuition.
- [`senior.md`](senior.md) — the trade-offs: action-at-a-distance, proxy limits in practice, testability, when AOP earns its keep.
- [`professional.md`](professional.md) — where AOP actually lives today: `@Transactional`/`@Cacheable`, middleware, observability agents.
- [Proxy Pattern](../../code-craft/design-patterns/02-structural/07-proxy/) — the structural pattern Spring AOP is built on.
- [Decorator Pattern](../../code-craft/design-patterns/02-structural/04-decorator/) — wrapping one object to add behavior; AOP generalizes it.
- [Overview & Taxonomy](../01-overview-and-taxonomy/) — where AOP sits among paradigms.
