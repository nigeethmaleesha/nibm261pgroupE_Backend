# RepairFlow Backend - Auto Role Login Patch

Replace/add these files in the existing backend.

## New shared internal auth endpoints

- POST `/api/internal/auth/login`
- POST `/api/internal/auth/login/verify-otp`
- POST `/api/internal/auth/login/resend-otp`
- POST `/api/internal/auth/forgot-password/initiate`
- POST `/api/internal/auth/forgot-password/resend-otp`
- POST `/api/internal/auth/forgot-password/verify-otp`
- POST `/api/internal/auth/forgot-password/change`
- POST `/api/internal/auth/refresh-token`
- POST `/api/internal/auth/logout`
- GET `/api/internal/auth/me`

The backend resolves `owner_staff` vs `technician` from the account email. The frontend no longer sends a selected role.

## Technician creation verification

Owner/Staff now completes technician email verification inside the technician-management flow using:

- POST `/api/staff/technicians/verify-otp`
- POST `/api/staff/technicians/resend-otp`

The existing public activation endpoints can remain for backward compatibility, but the new Staff Portal does not expose a public technician activation page.

## SCRUM-9 - Repair Job Registration

This backend now supports the Repair Job Registration story without changing the completed authentication flows.

Owner/Staff-only endpoints:

- `GET /api/staff/customers?query=<name|email|contact>&limit=10` - search existing active, verified Customer accounts for the intake form.
- `POST /api/staff/jobs` - register a device intake. Send a stable `Idempotency-Key` header for the submission.

Required job body fields are `customerId`, `deviceType`, `makeModel`, and `reportedFault`. `serialNumber` is optional. A successful new intake returns `201`, a retry using the same key and same normalized payload returns the same saved job with `200` and `idempotentReplay: true`, and reusing that key with a different payload returns `409`.

New jobs are persisted in the MongoDB `repair_jobs` collection with a database-unique `JOB-YYYYMM-XXXX` reference, `receivedAt` timestamp, and initial `Received` status. Run `npm run db:sync-indexes` after merging this story so the unique reference and idempotency indexes are synchronized.
