# JPMS — Find the Bug

> Ten module-system bugs that compile, look fine in review, and only bite when the framework hydrates an entity, when a JDK upgrade lands, or when production starts a fresh JVM. For each: read the code, identify the silent symptom, name the missing or wrong directive, and write down the fix.

---

## Bug 1 — Spring fails because the module doesn't `opens` the package

```java
// module-info.java
module com.example.shop {
    requires spring.context;
    requires spring.beans;
    exports com.example.shop.api;
    exports com.example.shop.config;
}
```

```java
// com/example/shop/config/AppConfig.java
package com.example.shop.config;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shop")
public class AppConfig {
    private String region;
    private int maxOrders;
    public String getRegion()   { return region; }
    public int    getMaxOrders(){ return maxOrders; }
    public void setRegion(String r)    { this.region = r; }
    public void setMaxOrders(int n)    { this.maxOrders = n; }
}
```

**Symptom.** The Spring Boot app starts, then on the first bean wiring:

```
org.springframework.beans.factory.BeanCreationException:
  Could not access field 'region' on class com.example.shop.config.AppConfig
Caused by: java.lang.reflect.InaccessibleObjectException:
  Unable to make field private java.lang.String com.example.shop.config.AppConfig.region accessible:
  module com.example.shop does not "opens com.example.shop.config" to module spring.core
```

The author thought `exports` was enough. It isn't — Spring uses reflective field/setter access, which `exports` does not grant. Even though the class is `public` and visible at the type level, `setAccessible(true)` is refused.

**Violation.** `exports` ≠ `opens`. The package is *visible* to other modules' compilers, but not *open* to reflection.

**Fix.** Add a qualified `opens`:

```java
module com.example.shop {
    requires spring.context;
    requires spring.beans;
    exports com.example.shop.api;
    exports com.example.shop.config;
    opens   com.example.shop.config to spring.core;
}
```

Better still: switch to constructor injection where possible, which avoids `setAccessible(true)` entirely.

---

## Bug 2 — Reflection `IllegalAccessException` after a JDK upgrade

```java
// Legacy utility used since Java 8 — works on Java 11, fails on Java 17
public final class FieldGrabber {
    public static <T> T grab(Object target, String field, Class<T> type) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);                         // (*)
        return type.cast(f.get(target));
    }
}

String name = FieldGrabber.grab(String.class.getModule(), "name", String.class);
```

**Symptom.** No change to the app code. CI was green on Java 11. After upgrading the CI image to Java 17:

```
java.lang.reflect.InaccessibleObjectException:
  Unable to make field private final java.lang.String java.lang.Module.name accessible:
  module java.base does not "opens java.lang" to unnamed module @5b2133b1
    at FieldGrabber.grab(FieldGrabber.java:6)
```

**Violation.** This is the JEP 396 / JEP 403 transition. Java 11 had `--illegal-access=permit` as the default, which let the reflective access succeed (with a warning printed to stderr). Java 16 (**JEP 396**) flipped the default to `deny`. Java 17 (**JEP 403**) removed `--illegal-access` entirely. There's no per-launch toggle anymore; you must `--add-opens` explicitly.

**Fix.** First, see if a *supported* API exists for what you're doing (almost always yes — for `Module.name`, use `Module.getName()`). If you genuinely need the reflective access, declare it at launch:

```
java --add-opens java.base/java.lang=ALL-UNNAMED -jar app.jar
```

Treat each such `--add-opens` as tracked debt — see [professional.md](professional.md) §3.

---

## Bug 3 — Split package between two modules

```java
// Module A
module com.example.legacy.utils {
    exports com.example.utils;
}
```

```java
// Module B
module com.example.modern.utils {
    exports com.example.utils;   // same package!
}
```

```java
// App
module com.example.app {
    requires com.example.legacy.utils;
    requires com.example.modern.utils;
}
```

**Symptom.** `javac` looks clean. Running `java --module-path mods -m com.example.app/...`:

```
Error occurred during initialization of boot layer
java.lang.LayerInstantiationException: Package com.example.utils in both module
  com.example.legacy.utils and module com.example.modern.utils
```

The JVM refuses to start. There is no `--allow-split-package` flag.

**Violation.** JPMS forbids the same package being exported by two modules in the same layer. The unit of containment for a package is a single module.

**Fix.** One of three options:

1. **Rename** one package — `com.example.utils` in `modern` becomes `com.example.utils.modern`.
2. **Merge** the two modules into one if they really do contain pieces of one cohesive package.
3. **Use module layers** so each module lives in a different layer (advanced; see [senior.md](senior.md) §8 — only justified for plugin/tenancy scenarios).

The fix has to happen at one of the source modules. No build-time workaround exists.

---

## Bug 4 — Cyclic `requires` between modules

```java
// Module A
module com.example.orders {
    requires com.example.payments;
    exports com.example.orders.api;
}

// Module B
module com.example.payments {
    requires com.example.orders;      // ← cycle
    exports com.example.payments.api;
}
```

**Symptom.** `javac` refuses to compile, with a clear message:

```
error: cyclic dependence involving com.example.orders
```

The cycle is forbidden by the resolver. Two modules that need each other's types are *one* module pretending to be two.

**Violation.** Cyclic `requires` is rejected by the module resolver (JLS §7.7.1). No workaround exists at the `javac` level.

**Fix.** Three structural options:

1. **Extract a shared abstraction module** — `com.example.commerce.api` containing the types both modules need. Both `orders` and `payments` `requires` it; neither requires the other.
2. **Invert one dependency** via `ServiceLoader` — if `payments` only needs a callback from `orders`, define a `PaymentCallback` interface in `payments`, have `orders` `provides PaymentCallback with ...;`. Now `payments` `uses PaymentCallback` and doesn't `requires com.example.orders`.
3. **Merge the modules.** If they really are codependent, the boundary is artificial.

---

## Bug 5 — Missing `requires transitive`

```java
// Module 'lib' exports an API that returns a type from another module
module com.example.lib {
    requires com.example.money;        // plain, non-transitive
    exports com.example.lib.api;
}
```

```java
// com/example/lib/api/Wallet.java
package com.example.lib.api;
import com.example.money.Money;

public class Wallet {
    public Money balance() { return Money.of(0); }
}
```

```java
// Module 'app' uses Wallet
module com.example.app {
    requires com.example.lib;
}
```

```java
// com/example/app/App.java
package com.example.app;
import com.example.lib.api.Wallet;

public class App {
    public static void main(String[] args) {
        var w = new Wallet();
        var balance = w.balance();      // ← compile error
        System.out.println(balance);
    }
}
```

**Symptom.** Compile error in `App.java`:

```
error: cannot find symbol — class Money
error: package com.example.money is not visible
       (package com.example.money is declared in module com.example.money,
        but module com.example.app does not read it)
```

The `app` module can see `Wallet` (because `lib` `exports com.example.lib.api`), but can't see `Money` — because `lib` `requires` it as a plain dependency.

**Violation.** A type from another module appears in `lib`'s exported API, but the dependency is not re-exported. Consumers cannot use the API without also depending on the underlying module.

**Fix.** Change the `requires` to `requires transitive`:

```java
module com.example.lib {
    requires transitive com.example.money;
    exports com.example.lib.api;
}
```

Now `app` implicitly reads `com.example.money` whenever it `requires com.example.lib`. The rule: **types in your exported API's signatures imply `requires transitive`.**

---

## Bug 6 — `ServiceLoader` finds no providers because `provides` is missing

```java
// API module
module com.example.notify.api {
    exports com.example.notify.api;
}
```

```java
// Implementation module
module com.example.notify.email {
    requires com.example.notify.api;
    // ← no `provides` declaration!
}
```

```java
// com/example/notify/email/EmailNotifier.java
package com.example.notify.email;
import com.example.notify.api.Notifier;

public class EmailNotifier implements Notifier {
    public String channelId() { return "email"; }
    public void send(String to, String message) { /* ... */ }
}
```

```java
// Consumer
module com.example.notify.dispatcher {
    requires com.example.notify.api;
    uses com.example.notify.api.Notifier;
}

// At runtime:
for (Notifier n : ServiceLoader.load(Notifier.class)) { ... }
// Iterator is empty!
```

**Symptom.** No exception. The for-loop runs zero times. The dispatcher silently drops every message — no one notices until customer support flags it.

**Violation.** The implementation module declares `EmailNotifier implements Notifier`, but never tells JPMS that it provides one. In a *named* module, only `provides` declarations are visible to `ServiceLoader.load`. The classpath-era `META-INF/services/com.example.notify.api.Notifier` file is also ignored when the JAR is on the module path.

**Fix.** Add the `provides` declaration:

```java
module com.example.notify.email {
    requires com.example.notify.api;
    provides com.example.notify.api.Notifier
        with com.example.notify.email.EmailNotifier;
}
```

Now `ServiceLoader.load(Notifier.class)` finds `EmailNotifier`. Note: if you also support classpath mode, ship both the `provides` directive *and* the `META-INF/services` file — they don't conflict, and the file is used when the JAR is on the classpath.

---

## Bug 7 — `--add-opens` workaround with a deprecation warning

```
# Launch script
java --add-opens java.base/sun.misc=com.example.legacy \
     --add-opens java.base/java.lang=ALL-UNNAMED \
     -jar legacy-app.jar
```

```java
// In the legacy app:
sun.misc.Unsafe unsafe = (Unsafe) ...;
```

**Symptom.** App boots, but every launch prints:

```
WARNING: A terminally deprecated method in sun.misc.Unsafe has been called
WARNING: sun.misc.Unsafe::allocateInstance has been called by com.example.legacy.Hack
WARNING: Please consider reporting this to the maintainers of class com.example.legacy.Hack
WARNING: sun.misc.Unsafe::allocateInstance will be removed in a future release
```

The `--add-opens` *works* — the call doesn't throw — but the JDK is warning that `sun.misc.Unsafe` itself is deprecated for removal (JEP 471 in Java 23, fully removed in a future release).

**Violation.** Two debts compounded: (a) reaching into a `sun.misc.*` package via `--add-opens`, (b) using a deprecated terminal API. The runtime is warning the team that the workaround has a sunset date.

**Fix.** Replace `sun.misc.Unsafe` with the supported API. For most use cases:

- **Off-heap memory** → `java.lang.foreign.MemorySegment` (JEP 442, finalised in Java 22).
- **Field offsets** → `VarHandle` (JEP 193).
- **Uninstrumented object creation** → `Constructor.newInstance` with `setAccessible` (still works, but on *your own* packages).

The structural fix is to remove the `--add-opens` line entirely once `sun.misc.Unsafe` is gone from your code. Use the warning as a planning signal, not a thing to silence.

---

## Bug 8 — `Automatic-Module-Name` in the JAR manifest, with a typo

```
# legacy-lib.jar's manifest (MANIFEST.MF)
Manifest-Version: 1.0
Automatic-Module-Name: com.example.legecy.lib
```

```java
// Consumer
module com.example.app {
    requires com.example.legacy.lib;   // ← matches the JAR file's *filename*, not the manifest!
}
```

**Symptom.** Compile succeeds (because the consumer matched the *derived* name from the JAR filename `legacy-lib-1.0.jar` → `legacy.lib`). Runtime explodes:

```
Error occurred during initialization of boot layer
java.lang.module.FindException: Module com.example.legacy.lib not found,
  required by com.example.app
```

Or worse, two consumers using different names (one matched the typo, one matched the filename), and the runtime resolves *neither* on certain machines.

**Violation.** The `Automatic-Module-Name` manifest entry overrides the filename-derived name. With a typo there, consumers are caught between two names. Even without a typo, automatic-module names are not stable — changing the JAR file's filename (e.g., adding a version suffix) changes the derived name.

**Fix.** Two layers:

1. **Short term**: fix the typo, document the canonical module name, and make sure every consumer's `requires` matches.
2. **Long term**: ship a real `module-info.java` in the library. Automatic modules are a *migration* aid; production should not depend on them. See [professional.md](professional.md) §5.

---

## Bug 9 — `opens X;` (unqualified) defeats encapsulation

```java
module com.example.shop {
    requires spring.context;
    exports com.example.shop.api;
    opens   com.example.shop.entity;     // ← unqualified
    opens   com.example.shop.config;     // ← unqualified
    opens   com.example.shop.internal;   // ← unqualified
}
```

**Symptom.** Everything works. Tests pass. Spring hydrates entities, Jackson serialises configs, the app runs in production. Six months later, a security review flags that any JAR on the classpath — including the third-party logging library and the unmaintained CSV parser — can reflectively read and write *every* private field of every entity.

**Violation.** Unqualified `opens` exposes the package to **all** modules, including the unnamed module (every classpath JAR). The strong-encapsulation guarantee of JPMS is silently turned off for these packages.

**Fix.** Qualify every `opens` to exactly the framework that needs it:

```java
module com.example.shop {
    requires spring.context;
    exports com.example.shop.api;
    opens com.example.shop.entity to org.hibernate.orm.core;
    opens com.example.shop.config to spring.core;
    // com.example.shop.internal stays *not* opened — nothing reflects on it
}
```

ArchUnit can catch unqualified opens in CI:

```java
@ArchTest
static final ArchRule no_unqualified_opens =
    // Read module-info.class, fail if any opens clause has no `to`.
    ...;
```

---

## Bug 10 — `requires static` bites at runtime with `ClassNotFoundException`

```java
module com.example.shop {
    requires static com.fasterxml.jackson.databind;   // optional integration
    exports com.example.shop.api;
}
```

```java
// com/example/shop/api/Json.java
package com.example.shop.api;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class Json {
    private static final ObjectMapper MAPPER = new ObjectMapper();   // (*)
    public static String stringify(Object o) {
        try { return MAPPER.writeValueAsString(o); }
        catch (Exception e) { throw new RuntimeException(e); }
    }
}
```

```java
// In production, Jackson is NOT on the runtime module path
Json.stringify(new Order(...));
```

**Symptom.** The app compiles fine — `requires static` makes Jackson available at compile time. The app starts. The first call to `Json.stringify`:

```
java.lang.NoClassDefFoundError: com/fasterxml/jackson/databind/ObjectMapper
  at com.example.shop.api.Json.<clinit>(Json.java:6)
  at com.example.shop.app.OrderEndpoint.toJson(OrderEndpoint.java:24)
```

The static initialiser ran (line `*`), tried to instantiate `ObjectMapper`, and couldn't find the class because Jackson isn't on the runtime module path.

**Violation.** `requires static` means *the module may be absent at runtime*. If your code *unconditionally* references types from that module, you must check for availability or guard the call. `requires static` doesn't mean "automatically optional"; it means "I take responsibility for the absence."

**Fix.** Two approaches depending on intent:

1. **If Jackson is genuinely optional**, guard the access:

   ```java
   public final class Json {
       private static final boolean JACKSON_AVAILABLE = isJacksonAvailable();
       private static final Object MAPPER = JACKSON_AVAILABLE ? new ObjectMapper() : null;

       private static boolean isJacksonAvailable() {
           try { Class.forName("com.fasterxml.jackson.databind.ObjectMapper"); return true; }
           catch (ClassNotFoundException e) { return false; }
       }
   }
   ```

2. **If Jackson is required at runtime**, switch back to plain `requires` and remove the `static`:

   ```java
   module com.example.shop {
       requires com.fasterxml.jackson.databind;   // present at runtime
       exports com.example.shop.api;
   }
   ```

The rule of thumb: `requires static` is for *truly optional* features (e.g., annotation libraries that only matter at compile time, or feature-flagged integrations behind explicit checks).

---

## Pattern summary

| Symptom                                                              | Likely cause                                    |
|----------------------------------------------------------------------|-------------------------------------------------|
| `InaccessibleObjectException` from a framework                       | Missing or wrong `opens` (bug 1, 2)             |
| `LayerInstantiationException: Package X in both modules ...`          | Split package across two modules (bug 3)        |
| `cyclic dependence involving X` at compile time                      | Cycle in `requires` graph (bug 4)               |
| `package X is not visible` even though you `requires Y`              | Missing `requires transitive` in `Y` (bug 5)    |
| `ServiceLoader.load` returns empty iterator silently                 | Missing `provides` or `uses` declaration (bug 6) |
| `WARNING: deprecated method in sun.misc.Unsafe`                      | `--add-opens` workaround on a sunsetting API (bug 7) |
| `FindException: Module X not found`                                  | Wrong/typo'd automatic-module name (bug 8)      |
| Any classpath JAR can reflect into your internals                    | Unqualified `opens` (bug 9)                     |
| `NoClassDefFoundError` for a `requires static` dependency at runtime | Unguarded use of an optional-only module (bug 10) |

Most of these violations compile cleanly. They show up at first launch on a fresh classpath, the first time a framework reflects, or the first time you upgrade the JDK. Train your eye in review: search for unqualified `opens`, missing `transitive`, and `ServiceLoader.load(...)` without a matching `uses`. The compiler will tell you about cycles and split packages; the rest is yours.
