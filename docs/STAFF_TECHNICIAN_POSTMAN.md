# Staff / Technician Postman order

Import `RepairFlow Backend - Staff Technician.postman_collection.json`.

Set these collection variables before testing:

- `ownerSetupKey` - same value as `.env` `OWNER_SETUP_KEY`
- `ownerEmail` - real Gmail address
- `ownerPassword` - 12+ characters
- `technicianEmail` - a second real email address
- `technicianPassword` - 12+ characters

OTP values are intentionally not returned by the API. Read them from the recipient email or the MongoDB `otp` collection, then place them in the matching Postman variable.

Recommended sequence on a clean database:

1. Owner Staff Setup & Authentication
2. Technician Account Creation & Activation
3. Owner Staff - Technician Listing & Toggle
4. Technician Login, Profile & Refresh
5. Technician Forgot Password
6. Owner Staff Forgot Password
7. RBAC & Security Checks
8. Logout tests

Resend endpoints enforce the configured cooldown (default 60 seconds).

For the technician toggle request, send **no body**. Run it once to disable and again to enable.
