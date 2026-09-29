# Transport

Transport is vehicle-based. No route, stop sequence, or route planning is required.
The legacy TransportRoute collection is retained but is no longer the transport UI/API.
Existing vehicles must be configured in the new vehicle screen with a driver and student assignments.

## Setup and daily flow

1. Principal or staff with the transport permission opens Transport.
2. Create a driver with name, login mobile, initial password (12-72 characters), licence number,
   optional licence expiry/image, email, address, and emergency contact.
3. Create a vehicle, set passenger capacity, and assign the driver. One active vehicle per driver.
4. Assign students, choosing pickup, drop-off, or both, with optional handover instructions.
   Capacity is enforced, and a student cannot be assigned to multiple vehicles.
5. Driver signs in through normal ERP login with the school code, mobile, and initial password.
   The initial password must be changed before starting a trip.
6. Start pickup or drop-off. Each vehicle has at most one trip of each kind per Indian calendar day.
7. During pickup: awaiting -> picked -> arrived at school. Alternatively absent/skipped, with a reason.
   During drop-off: awaiting -> boarded -> dropped. A handover issue leaves the child onboard.
8. Picking up and dropping off save the actual GPS coordinates and event time. If GPS fails, the driver
   must explicitly enter a location-exception reason; the record is not presented as GPS-confirmed.
9. Complete the trip only after every student is resolved and no child remains onboard.

Parents open Transport from their home screen and select a child. They can cancel today's pickup
before the child is picked, including before the trip starts. This does not cancel drop-off or
remove the permanent assignment. Parents see only their child's records and assigned active vehicle.
Principal/staff can monitor all active vehicles and inspect paginated trip history.

## Data and security

- All transport models resolve through the existing school/branch MongoDB tenant context.
- MongoDB must support transactions (replica set or Atlas), as required by existing ERP workflows.
- Trips snapshot the student roster. Assignments and driver/vehicle details cannot change during a trip.
- Parent cancellation and driver events serialize on the vehicle inside transactions.
- Driver event IDs make retries idempotent. Offline actions persist on the device scoped to the
  authenticated school, branch, and user; failed conflicts are surfaced, never silently accepted.
- GPS updates require a timestamp within two minutes and reported accuracy within 100 metres.
  Live updates stop after completion. Position history expires after 30 days; pickup/drop records remain.
- Licence images accept PNG/JPEG up to 5 MB and are stored in the tenant database, served only to
  authorized school transport administrators. They are not exposed through public uploads.
- Driver passwords are bcrypt hashes. No password is returned in driver listings.

## Deployment and verification

- Deploy both backend and Flutter changes together. No external realtime service is required:
  live screens poll every five seconds, and driver GPS uploads are throttled to five seconds.
- Flutter uses the existing location and flutter_map dependencies. Serve the web build over HTTPS
  (localhost is sufficient for local testing). Browser tracking works only while the browser permits it.
- Android foreground/background location permissions and iOS location background mode are configured.
  Driver permission approval, locked-screen tracking, battery optimization, and app termination behavior
  must be verified on physical Android/iOS devices before transporting students. Do not rely on web
  background tracking. A delayed GPS indicator appears when updates are older than 30 seconds.
- Maps use OpenStreetMap tiles with attribution. Review tile-provider capacity for production usage.
- Status updates are visible within the app; OS push notifications are not part of this implementation.
- Run `node --test test/transport.test.js` for backend transport tests.
  In Flutter, run `flutter test test/transport_test.dart` and `flutter build web --release`.
