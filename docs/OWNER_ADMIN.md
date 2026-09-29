# Owner Administration and Branch Databases

## Access

- The owner panel is part of Flutter at `/owner/home`, using the principal dashboard theme and navigation. Node.js serves the owner APIs only; the HTML panel and browser sign-in handoff have been removed.
- Owners use the main Flutter login with their full email and password; school code is ignored for an owner identity. Owner sessions are saved and restored inside Flutter, and owner routes are restricted to the owner role.
- Owner accounts are bootstrapped with `node scripts/createOwner.js email@example.com`, not public registration.
- The generated initial password is written to `.owner-initial-credentials.txt` with mode 0600. Change it through the owner portal, then securely remove that file.
- School users sign in through Flutter with school code, email/mobile and password. Existing accounts use school code `legacy`. There is no branch-code field.
- Principals start in their school's first active branch and can switch afterward. Other accounts are matched by credentials within active branches of that school, in creation order; repeated matching credentials use the first match. Older API clients may still send an explicit branch code.
- Existing data is registered as **Existing School / Main Branch** without moving records. The owner can rename both.

## School and Branch Creation

Create a school with its first branch's MongoDB URL and a principal account. Additional branches take a separate URL. Principals can switch between active branches of their own school in the dashboard top bar; they cannot create branches. Teachers, staff and parents authenticate only against their selected branch.

The URL must include a dedicated database name and point to a reachable MongoDB replica set or Atlas cluster. A plain standalone MongoDB server does not support the existing transactional exam workflow. URLs for an already assigned database or the control database are rejected. Use consistent hostnames for a cluster; DNS aliases must not be used to register the same database twice.

Principal identities are held in the control database and materialized as local principal users on login/switch. Existing principals are linked after a successful legacy login. New branches start empty apart from their principal account. Classes, subjects and students are not copied across branches.

## Billing

Owner issues ERP setup and maintenance invoices after creating a school. An installment becomes overdue after **23:59:59.999 India Standard Time** on its due date. Unpaid overdue amounts block operational ERP requests for every branch; principals retain billing-only login and access. Owner access remains available.

Record payment with a reference or void a bill with a reason. All overdue bills must be settled/voided to restore access. Payments are recorded manually; this is not a payment gateway. The owner can also suspend a school or an individual branch independently of billing.

## Database Configuration

- `MONGODB_URI`: existing school database, retained as the legacy main branch.
- `OWNER_MONGODB_URI`: optional control-database connection URL; defaults to the existing cluster URL.
- `OWNER_DB_NAME`: control database name, default `schoolo_platform`. Must differ from the legacy database name.
- `TENANT_DB_ENCRYPTION_KEY`: a base64-encoded, 32-byte AES key. When not supplied, a key is generated in `.tenant-db.key` on the first branch creation.
- `TENANT_KEY_FILE`: optional path for that generated key.

Back up the encryption key separately and securely. All API instances must use the same key. Losing it makes stored branch URLs unreadable. Neither MongoDB credentials nor password hashes are returned by owner APIs. Deploy behind HTTPS, restrict MongoDB network access, use least-privilege database users, and configure persistent storage for the generated key.

School models resolve their connection through AsyncLocalStorage; the tenant is chosen from verified JWT claims, never a caller-controlled database URL. Transactions use the same tenant connection. Connections are cached with bounded capacity; access checks read fresh school, branch and invoice state on every request. Outages fail closed. Old branchless JWTs can access only the legacy branch, still subject to billing checks.

MongoDB records and server media are school/branch scoped. See `docs/media-storage.md` for authenticated media access, migration and persistent-volume configuration.

## Verification

`npm test` runs isolated MongoDB replica-set tests for owner-only operations, cross-school switching rejection, concurrent branch isolation, populated references, tenant transactions, overdue locks, payment restoration, suspension and owner password revocation, plus the exam workflow regression suite. These tests do not use school production data.
# Owner Billing

The Flutter school form supports up to 50 branches, each with a separate MongoDB database. Exactly one branch is the main branch and is preferred during principal login. School codes are normalized to lowercase and protected by a unique database index across all schools; branch codes are unique within a school. Existing schools receive their earliest branch as the main branch during initialization.

Owner Settings > Payment Settings stores the one-time ERP base cost, minimum/maximum monthly maintenance amount, free maintenance months and default tax percentage. Creating a school snapshots the agreed price, fixed discount, monthly maintenance amount, monthly/quarterly/yearly period and activation/handover date. Later global settings changes do not modify school agreements. Existing schools can configure a payment plan before their first new-style invoice. Plans with new-style invoices cannot be changed retroactively. Amounts are whole paise; tax is rounded to paise.

After school creation the owner raises bills explicitly. ERP setup bills allow full payment or advance + balance, with separate due dates. The discount is applied once, then tax; installment totals equal the tax-inclusive bill total. Maintenance bills cover 1, 3 or 12 months and cannot include free months. The first maintenance period is the first day on or after the free-maintenance expiry; no partial initial month is billed. Owner reminders list due periods not yet billed, including missed periods. There is no automatic bill issuance, including for legacy subscription plans. Each issued maintenance period is protected by a unique school/period index; ERP bill creation is serialized in a school transaction. Existing `/invoices` endpoints and the internal `Invoice` model are retained as the payable-bill ledger for client compatibility; new records have `documentType=bill` and `BILL-` numbers.

Full settlement atomically generates a separate, immutable `CompletedInvoice` with its own `INV-` number, bill reference, school snapshot, discount, tax, total and payment date. A unique bill index prevents duplicate completion invoices, including payment retries. Partial payments do not generate an invoice. A zero-cost, fully discounted bill is immediately settled and receives a zero-value invoice. Both the owner and active school principals receive the completed invoice automatically via the durable email outbox; the Flutter billing screens show bills and paid invoices separately. No historical invoice or payment is deleted or automatically rewritten.

Every payment is an immutable ledger entry with school, invoice, amount, payment date, method, reference, notes and recording owner. Payment request IDs are idempotent per invoice; transactions prevent duplicate posting and overpayment. Payments allocate to installments in order. Statuses are unpaid, partial, paid and void, with overdue calculated from unpaid installments. Cancellation is allowed only before any payment and retains invoice history; cancelled maintenance periods are not billed again. Legacy invoices remain readable and payable; old paid invoices retain their historical settlement reference without inventing ledger entries.

Owner Expenses records ERP expense transactions: transaction date, payee, category, amount in whole paise, payment method, reference, description, notes and recording owner. Request IDs protect retries. Future-dated and non-positive expenses are rejected. An incorrect expense can be voided with a reason; it remains visible in history and has zero report impact. Expenses and financial reports exist only under authenticated owner routes; principals, staff, teachers and parents cannot access them.

Owner Reports has date and transaction-type filters plus pagination. Completed-payment invoices contribute a positive tax-inclusive total, recorded expenses a negative amount, and all payable bills zero to the net total. Advance payments stay in the payment ledger but become report income only when the bill is fully settled, as requested; this is not a cash-flow or statutory accounting report. Expense entries use their transaction date; invoice and bill entries use issuance dates in IST. Voided expenses/bills remain visible with zero net impact. Historical paid invoices without a completion record count once as income using their settlement date; linked completion invoices never double-count them.

Finance APIs: `/api/owner/expenses` (GET paginated, POST), `/api/owner/expenses/:id/void` (PATCH with reason), `/api/owner/finance-report` (GET with startDate, endDate, type=all|expense|invoice|bill, page, limit), and `/api/owner/completed-invoices` (GET). Principal `/api/dashboard/billing` includes only that school's bills, payments and completed invoices, never the owner expense ledger.

Owner and principal dashboards show ERP pending, maintenance pending, overdue and paid totals, invoice details and payment history. Due dates are selected by the owner and expire at 23:59:59.999 IST, not a fixed 15-day rule. An unpaid overdue installment blocks operational access across branches; a future unpaid balance does not. Authenticated principals retain billing-only access and can sign in to view the reason and invoices. Teachers, parents and staff receive a generic error. Owner disablement remains separate from overdue status: payment does not activate a disabled school. The minute worker only queues overdue notices and delivers the durable mail outbox.

APIs: `/api/owner/payment-settings` (GET/PUT), `/api/owner/billing-reminders` (GET), `/api/owner/schools/:id/pricing` (PUT), `/api/owner/schools/:id/invoices` (POST with `kind=erp|maintenance`), `/api/owner/schools/:id/invoices/:invoiceId/payments` (POST), `/api/owner/schools/:id/payments` (GET ledger), and `/api/dashboard/billing` (principal-only GET). Deprecated subscription/legacy invoice endpoints remain for older clients; they do not enable auto-billing.

Email notifications go separately to active owner accounts and the school's active principal accounts for school/subscription creation, subscription changes, raised bills, payments, completed-payment invoices, voids, and overdue access suspension. Notifications are stored in a durable outbox with retry/backoff. SMTP delivery is at least once: a crash after delivery but before recording success can resend a notification.

Set `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=noreply@lavener.com`, and `SMTP_PASSWORD` only in the backend environment or secret manager. Port 465 uses implicit TLS; port 587 is supported with required STARTTLS. Do not put credentials in Flutter. `.env` is ignored by Git. Run `node scripts/verifyMail.js` to verify authentication without sending an email; the outbox retains pending messages while SMTP is unavailable.

All outbox emails, including already-queued messages, use Lavener Holdings branding: HTML and plain-text alternatives, inline symbol/wordmark assets from the Lavener website, billing details, and event-specific status. Assets are bundled in `src/assets/email`, not loaded from public school uploads. Creation, subscription changes, bills, payments, voids, and overdue notifications share the template in `src/services/emailTemplate.js`. School-supplied text is escaped before rendering. Restart the backend after changing SMTP configuration.

Run `node scripts/previewMail.js` to generate six self-contained HTML previews using fictional school/billing data in a temporary directory. This never connects to SMTP or a database.
