# God Class — Find the Bug

Ten scenarios. For each: read the code, decide what is wrong, then read the diagnosis and the refactor sketch.

---

## Scenario 1 — The 1000-line UserService

```java
public class UserService {
    public void register(String email, String pw) { /* 80 lines */ }
    public void login(String email, String pw) { /* 60 lines */ }
    public void resetPassword(String email) { /* 40 lines */ }
    public void sendWelcomeEmail(User u) { /* 50 lines */ }
    public void exportToCsv(List<User> us, OutputStream o) { /* 90 lines */ }
    public byte[] renderProfilePdf(User u) { /* 120 lines */ }
    public void chargeMonthly(User u) { /* 70 lines */ }
    public void auditLogin(User u, String ip) { /* 30 lines */ }
    public void migrateLegacyAccount(long oldId) { /* 250 lines */ }
    public Stats computeAnalytics(LocalDate from, LocalDate to) { /* 180 lines */ }
    // ... 14 more methods
}
```

**What's wrong?** One class owns authentication, email, reporting, billing, auditing, migration, and analytics — seven reasons to change, ~1000 LOC.

**Refactor.** Split by responsibility:

```java
class AuthService     { register; login; resetPassword; }
class UserMailer      { sendWelcomeEmail; }
class UserExporter    { exportToCsv; renderProfilePdf; }
class BillingService  { chargeMonthly; }
class AuditService    { auditLogin; }
class MigrationJob    { migrateLegacyAccount; }
class UserAnalytics   { computeAnalytics; }
```

Each is < 150 LOC, each has one reason to change.

---

## Scenario 2 — FacadeManager that managed nothing

```java
public class FacadeManager {
    private DbConnection db;
    private HttpClient http;
    private Cache cache;
    private Logger log;
    private Mailer mailer;
    private FeatureFlags flags;

    public Object handle(String op, Map<String, Object> args) {
        switch (op) {
            case "createOrder":  return db.insert(args);
            case "sendEmail":    return mailer.send(args);
            case "fetchProduct": return http.get(args.get("url").toString());
            // ... 40 more cases
        }
        throw new IllegalArgumentException(op);
    }
}
```

**What's wrong?** A "manager" routing arbitrary string operations to arbitrary collaborators. It is dynamic dispatch with no type safety, plus a CBO above 30.

**Refactor.** Replace the switch with a polymorphic command interface or, simpler, direct dependencies injected into the actual callers. The "facade" is hiding nothing — delete it.

```java
interface Command<I, O> { O execute(I input); }
class CreateOrderCommand implements Command<OrderRequest, OrderId> { /* ... */ }
class SendEmailCommand   implements Command<EmailRequest, Void>   { /* ... */ }
```

---

## Scenario 3 — Swiss-army Utils

```java
public final class Utils {
    public static String capitalize(String s) { /* ... */ }
    public static <T> List<T> nonNull(List<T> in) { /* ... */ }
    public static Date parseIso(String s) { /* ... */ }
    public static byte[] sha256(byte[] in) { /* ... */ }
    public static <K,V> Map<K,V> mergeMaps(Map<K,V> a, Map<K,V> b) { /* ... */ }
    public static BigDecimal taxFor(Country c, BigDecimal amount) { /* ... */ }
    public static boolean isValidEmail(String s) { /* ... */ }
    // ... 80 more static methods
}
```

**What's wrong?** A static God Class. No state, but every domain in the system depends on it; changes ripple everywhere. Cannot mock. Cannot extend. Cannot remove safely.

**Refactor.** Promote each cluster to a focused, injectable service or to the type that owns the data:

```java
class StringFormatter   { String capitalize(String s); }
class IsoDateParser     { LocalDate parse(String s); }
class HashService       { byte[] sha256(byte[] in); }
class TaxCalculator     { Money taxFor(Country c, Money amount); }
record EmailAddress(String value) { /* validation in compact ctor */ }
```

---

## Scenario 4 — The 50-method singleton

```java
public class AppContext {
    private static final AppContext INSTANCE = new AppContext();
    public static AppContext get() { return INSTANCE; }

    private AppContext() {}

    public DbConnection db() { /* ... */ }
    public Mailer mailer() { /* ... */ }
    public Cache cache() { /* ... */ }
    public User currentUser() { /* ... */ }
    public Tenant currentTenant() { /* ... */ }
    public void log(String msg) { /* ... */ }
    public void audit(String op, Object payload) { /* ... */ }
    public boolean featureEnabled(String key) { /* ... */ }
    public String config(String key) { /* ... */ }
    // ... 41 more methods
}
```

**What's wrong?** A global registry masquerading as context. Every class depends on it; no test can isolate anything; CBO is effectively the whole codebase.

**Refactor.** Use constructor injection. Each class declares only what it needs:

```java
class OrderService {
    private final OrderRepository repo;
    private final FeatureFlags flags;
    OrderService(OrderRepository repo, FeatureFlags flags) {
        this.repo = repo; this.flags = flags;
    }
}
```

The "context" disappears — its job belonged to the DI container all along.

---

## Scenario 5 — Entity that knows everything about itself

```java
@Entity
public class User {
    @Id private Long id;
    private String email;
    private String passwordHash;
    // 18 more fields

    public void hashAndSetPassword(String plain) { /* uses BCrypt */ }
    public byte[] renderAvatar(int size) { /* image processing */ }
    public void sendWelcomeEmail(MailServer s) { /* SMTP code */ }
    public BigDecimal calculateMonthlyBill(LocalDate month) { /* tax tables */ }
    public String exportAsJson() { /* uses Jackson */ }
    public void persist(EntityManager em) { /* JPA logic */ }
}
```

**What's wrong?** A JPA entity that imports BCrypt, ImageIO, JavaMail, Jackson, and JPA APIs. Loading a `User` drags half the application into scope.

**Refactor.** Keep behavior on the entity only when it concerns its invariants (e.g., `changeEmail(EmailAddress newEmail)`). Move everything else out:

```java
class PasswordService { String hash(String plain); boolean matches(String plain, String hash); }
class AvatarRenderer  { byte[] render(User u, int size); }
class UserMailer      { void sendWelcome(User u); }
class BillingService  { Money monthlyBill(User u, YearMonth month); }
class UserJsonView    { String toJson(User u); }
```

---

## Scenario 6 — God Controller

```java
@RestController
@RequestMapping("/api")
public class ApiController {
    @GetMapping("/users")         public List<User> users() { /* ... */ }
    @PostMapping("/users")        public User create(@RequestBody User u) { /* ... */ }
    @GetMapping("/orders")        public List<Order> orders() { /* ... */ }
    @PostMapping("/orders")       public Order placeOrder(@RequestBody Order o) { /* ... */ }
    @GetMapping("/products")      public List<Product> products() { /* ... */ }
    @GetMapping("/reports/daily") public Report daily() { /* ... */ }
    // 40 more endpoints
}
```

**What's wrong?** One controller for the whole REST surface. PR conflicts on every change. Cross-cutting concerns (auth, validation) cannot be applied selectively.

**Refactor.** One controller per resource (or per use case):

```java
@RestController @RequestMapping("/users")    class UserController    { /* 3-5 endpoints */ }
@RestController @RequestMapping("/orders")   class OrderController   { /* 3-5 endpoints */ }
@RestController @RequestMapping("/products") class ProductController { /* 3-5 endpoints */ }
@RestController @RequestMapping("/reports")  class ReportController  { /* 2-3 endpoints */ }
```

---

## Scenario 7 — God DAO

```java
public class Dao {
    public User getUser(long id) { /* ... */ }
    public void saveUser(User u) { /* ... */ }
    public Order getOrder(long id) { /* ... */ }
    public void saveOrder(Order o) { /* ... */ }
    public List<Product> searchProducts(String q) { /* ... */ }
    public Report generateMonthlyReport(YearMonth m) { /* ... */ }
    public void migrateSchema(int from, int to) { /* ... */ }
    public Stats analyticsForTenant(long tenantId) { /* ... */ }
    // ... 30 more
}
```

**What's wrong?** Persistence concerns mixed with reporting and migration. Every developer changes the same file.

**Refactor.** One repository per aggregate:

```java
interface UserRepository    { Optional<User> findById(UserId id); void save(User u); }
interface OrderRepository   { Optional<Order> findById(OrderId id); void save(Order o); }
interface ProductSearch     { List<Product> matching(String query); }
class ReportingQueries      { /* read-only projections */ }
class SchemaMigrator        { /* Flyway-driven */ }
```

---

## Scenario 8 — Inheritance hiding a God Class

```java
public abstract class BaseEntity {
    protected Long id; protected Instant createdAt; protected Instant updatedAt;
    public void save() { /* ... */ }
    public void delete() { /* ... */ }
    public String toJson() { /* ... */ }
    public byte[] toCsv() { /* ... */ }
    public void audit(String op) { /* ... */ }
    public boolean isOwnedBy(User u) { /* ... */ }
    public void notifyChange() { /* ... */ }
    // 15 more methods every entity "inherits"
}
public class Order extends BaseEntity { /* ... */ }
```

**What's wrong?** The God Class is the parent — every entity drags its full surface area. Subclasses cannot opt out.

**Refactor.** Prefer composition. Make audit, serialization, and notification *services* that take an entity, not capabilities on the base class.

```java
class JsonSerializer { String toJson(Object o); }
class AuditService   { void record(String op, Object subject); }
class ChangePublisher{ void publish(Object subject); }
```

---

## Scenario 9 — God Aggregate

```java
public class Order {
    private List<OrderLine> lines;
    private Customer customer;
    private List<Shipment> shipments;
    private List<Payment> payments;
    private List<Refund> refunds;
    private List<Invoice> invoices;
    private List<SupportTicket> tickets;
    private LoyaltyAccount loyalty;
    // ...
    // 60 methods spanning shipping, billing, support, loyalty
}
```

**What's wrong?** The aggregate has swallowed several bounded contexts. A single transaction now locks data for shipping, billing, and support simultaneously.

**Refactor.** Split into multiple aggregates referenced by ID, with eventual consistency between them:

```java
class Order      { OrderId id; List<OrderLine> lines; CustomerId customerId; }
class Shipment   { ShipmentId id; OrderId orderId; /* shipping invariants */ }
class Invoice    { InvoiceId id; OrderId orderId; /* billing invariants */ }
class Ticket     { TicketId id; OrderId orderId; /* support invariants */ }
```

Cross-aggregate updates go through domain events, not direct method calls.

---

## Scenario 10 — God Test class

```java
class EverythingTest {
    @Test void registersUser() { /* ... */ }
    @Test void chargesCard() { /* ... */ }
    @Test void rendersPdf() { /* ... */ }
    @Test void exportsCsv() { /* ... */ }
    @Test void migratesSchema() { /* ... */ }
    // 80 more @Test methods, 2000 LOC
}
```

**What's wrong?** Tests mirror production structure. A God Test points to a God Class — or to teams not owning their slice of tests.

**Refactor.** Split tests by the class under test. If the production code is already split, the test split is mechanical. If it is not, the test smell exposes the production smell.

---

**Memorize this:** God Classes hide in services, utils, entities, controllers, DAOs, base classes, aggregates, and tests — wherever responsibility is unowned, scope creeps; the fix is always the same: name the responsibilities, split the class.
