# Primitive Obsession — Professional

> **What?** At the professional tier, fighting Primitive Obsession stops being a code-review reflex and becomes a *platform investment*: forbid raw `String`/`int`/`UUID` in domain APIs with ArchUnit; preview Project Valhalla (JEP 401, *Value Classes and Objects*) and what it changes for tiny-types in production; run a contract-driven migration on a legacy codebase that already shipped primitives everywhere; and pick the right wrapping conventions for serialisation, persistence, and inter-service contracts.
> **How?** Three forces in combination — Valhalla previews changing the allocation arithmetic, ArchUnit / Checkstyle catching regressions, and a phased migration playbook for a million-line codebase you can't rewrite. Each force has a setup cost; the payoff is years of avoided bug classes.

---

## 1. Project Valhalla in one paragraph

Project Valhalla is a long-running OpenJDK research effort whose goal is to bring *value types* — heap-free, identity-free, primitive-like classes — into the JVM. The first user-visible preview, **JEP 401: Value Classes and Objects (Preview)**, introduces a `value` modifier for classes. A `value class` has:

- **No object identity.** `==` is forbidden — only structural equality applies. The JVM is free to substitute one bit-identical instance for another.
- **Implicit `final` fields and final class.** Immutability is baked in.
- **Flattenable layout in containers.** A `value class` field in another class can be stored *inline* — no heap pointer, no header. Likewise `value class[]` arrays.
- **No null in flat contexts.** A flat field of a value class is non-null by construction.

For Primitive Obsession, this changes the trade-off completely:

```java
value class Money(long minorUnits, Currency currency) { ... }   // syntax illustrative
```

A `Money` field on an `Account` can be flattened into the `Account` layout — the same 12 bytes a `long cents` field would have taken, plus a small currency reference. The runtime cost of "wrap everything" approaches zero.

Status in mid-2026 (verify against current OpenJDK releases): JEP 401 is in *Preview* — expect refinements; do not deploy to production without a feature flag and a benchmark gate. The semantics are stable enough to model around.

---

## 2. ArchUnit — forbidding raw primitives in domain APIs

ArchUnit lets you express architectural invariants as JUnit tests. Two rules cover the bulk of Primitive Obsession enforcement.

**Rule A: domain methods must not accept raw `String`/`int`/`long`/`UUID` for confusable concepts.**

```java
@AnalyzeClasses(packages = "com.acme.domain")
class DomainPrimitivePolicy {

    private static final DescribedPredicate<JavaClass> RAW_PRIMITIVES_OR_STRING_OR_UUID =
        JavaClass.Predicates.assignableTo(String.class)
            .or(JavaClass.Predicates.assignableTo(UUID.class))
            .or(JavaClass.Predicates.equivalentTo(int.class))
            .or(JavaClass.Predicates.equivalentTo(long.class))
            .as("raw String/UUID/int/long");

    @ArchTest
    static final ArchRule domain_methods_dont_take_raw_primitives =
        methods()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().arePublic()
            .should().notHaveRawParameterTypes(RAW_PRIMITIVES_OR_STRING_OR_UUID);
}
```

This fails the build the first time a developer writes `public void register(String email, String name)` in a domain class. The fix is to introduce `Email`, `FullName`. The rule catches the regression at PR time.

**Rule B: only the boundary layer may construct typed wrappers from `String` literals.**

```java
@ArchTest
static final ArchRule only_adapters_construct_email_from_string =
    constructors()
        .that().areDeclaredIn(Email.class)
        .should().onlyBeCalledFromPackages("..web..", "..persistence..", "..test..");
```

The domain *receives* `Email`; the *adapter* layer (HTTP controllers, JDBC mappers) is the only place where a raw `String` may become an `Email`. The rule encodes the boundary-conversion discipline.

**Allow-list for legitimate exceptions.**

No real codebase fits a single rule perfectly. ArchUnit supports `freeze()` — the first run records the current violations as a baseline; subsequent runs only fail on *new* violations. This is how you onboard the rule onto a legacy module without a big-bang rewrite.

```java
@ArchTest
static final FreezingArchRule rule =
    FreezingArchRule.freeze(domain_methods_dont_take_raw_primitives);
```

---

## 3. Checkstyle and SpotBugs — the lighter tier

ArchUnit catches architectural violations; Checkstyle and SpotBugs catch the everyday ones.

**Checkstyle — boolean parameter count.**

```xml
<module name="ParameterAssignment"/>
<module name="ParameterNumber">
    <property name="max" value="4"/>
</module>
<module name="BooleanExpressionComplexity">
    <property name="max" value="2"/>
</module>
```

Forcing methods to four parameters or fewer is the *easiest* nudge toward Parameter Object extraction. Pair it with a custom rule that flags methods with two or more `boolean` parameters as candidates for an enum.

**SpotBugs — primitive-related smells.**

- `BX_BOXING_IMMEDIATELY_UNBOXED` — autoboxing followed by an unbox; often a sign that someone reached for `Integer` when `int` would have done.
- `FE_FLOATING_POINT_EQUALITY` — `double == double` for money is a classic Primitive Obsession bug.
- `RV_NEGATING_RESULT_OF_COMPARE_TO` — comparing primitives in ways that overflow for `Integer.MIN_VALUE`.

These catch the residual primitives that slipped past your design review.

---

## 4. A migration playbook for a legacy codebase

You inherited a 500k-LOC Java service where every domain method takes `String`s and `long`s. You cannot rewrite. The playbook:

**Phase 1: pick a bounded context.**

Choose one module with a single team and a clear domain boundary — e.g., the payments module. Don't try to migrate everything at once; the typed types must travel one bounded context at a time.

**Phase 2: introduce the wrappers as add-ons.**

For each primitive that gets confused or carries an invariant, add a `record` wrapper *alongside* the existing primitive APIs. The wrappers do nothing yet — they just exist.

```java
public record Money(BigDecimal amount, Currency currency) { ... }
```

**Phase 3: introduce a parallel API surface.**

For each public method that takes primitives, add an overload that takes the wrappers. The overload delegates to the primitive version. Internally, the primitive version stays; externally, callers are encouraged toward the typed one.

```java
public class PaymentService {
    public void charge(String cardToken, BigDecimal amountInUsd) { ... }    // legacy

    public void charge(CardToken token, Money amount) {                     // new
        if (!amount.currency().equals(Currency.getInstance("USD"))) throw new IllegalArgumentException();
        charge(token.value(), amount.amount());
    }
}
```

**Phase 4: migrate one caller at a time.**

Track adoption via a Sonar custom rule or a simple grep of `import com.acme.payments.legacy.*`. Each PR migrates a few callers to the new API. The legacy API survives until adoption is complete.

**Phase 5: deprecate, then delete.**

When the legacy API has no callers, mark it `@Deprecated(forRemoval = true)`. Two release cycles later, delete. The migration is done.

**Time budget:** a million-line codebase typically takes 12-24 months to fully migrate, with two engineers spending 20% of their time on it. The bug-reduction starts in month three — long before completion.

---

## 5. Serialisation contracts — keep them primitive

A persistent professional mistake: leaking typed wrappers into your JSON or your database schema.

```java
public record UserDto(Email email, FullName name) {}   // serialised to JSON

// Output:
// {"email":{"value":"alice@example.com"},"name":{"value":"Alice"}}
```

External consumers (mobile apps, partners, downstream services) now depend on the *wrapper shape*. Renaming `value` becomes a breaking change.

The fix: keep the DTO primitive, convert in the adapter.

```java
public record UserDto(String email, String name) {}   // public contract

public static UserDto from(User u) {
    return new UserDto(u.email().value(), u.name().value());
}
```

Or — if you prefer the typed wrappers to appear at the public surface — write a Jackson custom serialiser that unwraps:

```java
public class EmailSerializer extends JsonSerializer<Email> {
    @Override public void serialize(Email v, JsonGenerator g, SerializerProvider p) throws IOException {
        g.writeString(v.value());
    }
}

@JsonComponent
public class WrappersModule extends SimpleModule { /* register all wrappers */ }
```

Either way, the wrapper *type* never appears on the wire. The wire stays primitive.

The same principle applies to the database: store `VARCHAR` for emails, `BIGINT` for IDs, convert at the repository boundary. The schema is part of your contract with your DBA, your DBA does not know about `Email`.

---

## 6. Inter-service contracts — typed-on-both-sides via codegen

Two Java services that talk to each other can share *typed* wrappers safely *if* the contract is generated from a single source of truth — usually an OpenAPI schema or a `.proto` file.

```yaml
# openapi.yaml
components:
  schemas:
    UserId:
      type: string
      format: uuid
      x-java-type: com.acme.contract.UserId
```

A code generator (`openapi-generator`, `swagger-codegen`) produces a `UserId` record on both client and server. Both sides see the same type; primitives never enter the contract.

For Protobuf, a similar effect is achieved with `protoc` plugins that emit Java records or value classes for scalar fields.

This is the only situation where wrapper types *should* be part of the contract — when both sides are generated from one schema and a rename propagates through the generator.

---

## 7. Records vs sealed classes vs value classes — picking the right tool

A senior question: when does each apply?

| Tool                    | Use when                                                | Cost                         |
|-------------------------|---------------------------------------------------------|------------------------------|
| `record` (JEP 395)      | A value object with one shape, immutable, value equality | Heap allocation per instance |
| `enum`                  | A small fixed set of values with simple behaviour       | Zero overhead, no extension  |
| `sealed interface` + records | A closed set of variants with *different shapes*  | One allocation per variant   |
| `value class` (JEP 401) | A record-like value with hot-path frequency             | Near-zero — flattened layout |
| Plain `final class`     | A value that needs custom equality (e.g., epsilon-tolerant) | Manual `equals`/`hashCode`  |

The professional discipline: default to `record`; promote to `sealed` when variants diverge in shape; promote to `value class` when JMH proves allocation matters. Don't reach for `value class` first — it's a preview feature, the syntax may evolve.

---

## 8. Mentoring the team — naming conventions

A team that has bought into typed wrappers still gets the names wrong. A few conventions that pay off:

- **`Id` suffix for identifiers.** `UserId`, `OrderId`, `ProductId` — never `User` for an ID type.
- **No `Wrapper`, `Holder`, `Value` suffix.** The type is `Email`, not `EmailValue`. The wrapper *is* the value.
- **`Money` not `Amount`.** "Amount" is too generic — a domain may have order amount, refund amount, discount amount. `Money` carries currency; "amount" doesn't.
- **`Iso*` prefix for international codes.** `IsoCurrencyCode`, `IsoCountryCode` — signals the format constraint.
- **`Display*` prefix when there are multiple representations.** `Email` is the canonical form; `DisplayName` is the human-friendly version of a `FullName`.

These conventions reduce code-review friction. Reviewers stop arguing about names; they argue about behaviour.

---

## 9. Watching for regressions — a quarterly audit

Even with ArchUnit, regressions happen — usually from:

- New modules that haven't onboarded the rule.
- Adapter code that bypasses the rule with an `@ArchIgnore` annotation.
- New developers who add `String email` parameters to legacy methods that already have other `String`s.

A quarterly audit:

```bash
# Count primitive parameters per public domain method
javap -p -c target/classes/com/acme/domain/**/*.class \
    | grep 'public ' \
    | grep -E '(Ljava/lang/String;|J|I)\)' \
    | wc -l
```

Trend this number. It should *decrease* over quarters. If it's flat or rising, the discipline has slipped — pick the worst-offending module and refactor it.

---

## 10. Quick rules

- [ ] **ArchUnit rule** that fails the build for raw `String`/`int`/`UUID` in domain method signatures.
- [ ] **Freeze** the rule for legacy modules; require new code to be clean.
- [ ] **Conversion happens at the boundary** — adapter layer is the only legitimate place to construct wrappers from primitives.
- [ ] **Wire contracts stay primitive.** JSON, DB schema, gRPC use raw types; conversion is internal.
- [ ] **`record` by default**, `sealed` for divergent variants, `value class` when JMH proves it.
- [ ] **Migration is phased**: parallel APIs, adopter-by-adopter, deprecate, delete.

---

## 11. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Metrics, thresholds, sample lint rules                           | `specification.md` |
| Production bug archaeology                                       | `find-bug.md`      |
| Allocation cost, scalar replacement, autoboxing                  | `optimize.md`      |
| Exercises                                                        | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

Related smells:

- [Data Clumps](../08-data-clumps/) — once wrappers exist, parameter objects emerge naturally.
- [Anemic Domain Model](../02-anemic-domain-model/) — typed wrappers carry behaviour that anaemic models lacked.

---

**Memorize this:** Professional discipline means *automated enforcement* of the wrapper habit (ArchUnit), *phased migration* on legacy code (parallel APIs, then deprecate, then delete), *primitive contracts on the wire* (DTOs and DB schemas stay raw), and *Valhalla awareness* (JEP 401 is the inflection that will erase the allocation cost). One rule per concept, one freeze for the legacy, one boundary for conversion.
