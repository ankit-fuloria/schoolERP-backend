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

Owner creates INR bills with a description, amount and due date. A bill becomes overdue after **23:59:59.999 India Standard Time** on that date. Any unpaid overdue bill blocks login and authenticated ERP API requests for every branch of the school. Owner access remains available.

Record payment with a reference or void a bill with a reason. All overdue bills must be settled/voided to restore access. Payments are recorded manually; this is not a payment gateway. The owner can also suspend a school or an individual branch independently of billing.

## Database Configuration

- `MONGODB_URI`: existing school database, retained as the legacy main branch.
- `OWNER_MONGODB_URI`: optional control-database connection URL; defaults to the existing cluster URL.
- `OWNER_DB_NAME`: control database name, default `schoolo_platform`. Must differ from the legacy database name.
- `TENANT_DB_ENCRYPTION_KEY`: a base64-encoded, 32-byte AES key. When not supplied, a key is generated in `.tenant-db.key` on the first branch creation.
- `TENANT_KEY_FILE`: optional path for that generated key.

Back up the encryption key separately and securely. All API instances must use the same key. Losing it makes stored branch URLs unreadable. Neither MongoDB credentials nor password hashes are returned by owner APIs. Deploy behind HTTPS, restrict MongoDB network access, use least-privilege database users, and configure persistent storage for the generated key.

School models resolve their connection through AsyncLocalStorage; the tenant is chosen from verified JWT claims, never a caller-controlled database URL. Transactions use the same tenant connection. Connections are cached with bounded capacity; access checks read fresh school, branch and invoice state on every request. Outages fail closed. Old branchless JWTs can access only the legacy branch, still subject to billing checks.

This change isolates **MongoDB records**. Existing document uploads still use the application's local upload directory and existing public URL behavior; private/object-storage document access is a separate deployment concern.

## Verification

`npm test` runs isolated MongoDB replica-set tests for owner-only operations, cross-school switching rejection, concurrent branch isolation, populated references, tenant transactions, overdue locks, payment restoration, suspension and owner password revocation, plus the exam workflow regression suite. These tests do not use school production data.
# Recurring Subscriptions

The Flutter school form supports up to 50 branches, each with a separate MongoDB database. Exactly one branch is the main branch and is preferred during principal login. School codes are normalized to lowercase and protected by a unique database index across all schools; branch codes are unique within a school. Existing schools receive their earliest branch as the main branch during initialization.

Configure a monthly, quarterly, or annual subscription during school creation or from the school's Subscription section. The cycle price is separate from monthly maintenance. The generated amount is the cycle price plus monthly maintenance multiplied by 1, 3, or 12. Amounts are stored as whole paise. Existing schools are not charged automatically until a subscription is configured.

The first billing date starts the schedule in Asia/Kolkata. A backend worker runs at startup and every minute, using database transactions and a unique school/period index to prevent duplicate bills across restarts and multiple processes. Month-end dates retain their original day where possible. Bills are due at the end of the date 15 days after actual generation. Missed periods are generated after an outage; suspended schools do not generate bills until enabled again. The backend must remain running for timely generation.

Subscription changes replace the future schedule, do not change existing bills, and require a first billing date after any already-generated period. The owner can still generate additional manual bills.

Email notifications go separately to active owner accounts and the school's active principal accounts for school/subscription creation, subscription changes, generated bills, payments, voids, and overdue access suspension. Notifications are stored in a durable outbox with retry/backoff. SMTP delivery is at least once: a crash after delivery but before recording success can resend a notification.

Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` only in the backend environment or secret manager. Gmail uses TLS on port 465 and an app password. Do not put credentials in Flutter. `.env` is ignored by Git. Mail authentication can be verified without sending an email; the outbox retains pending messages while SMTP is unavailable.
