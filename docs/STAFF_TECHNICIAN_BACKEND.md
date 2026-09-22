# RepairFlow Staff / Technician Backend

This package extends the existing customer authentication without replacing its routes.

## Roles

- `customer` - existing public customer account.
- `owner_staff` - the single Owner/Staff privileged account.
- `technician` - accounts created only by an authenticated Owner/Staff user.

## One-time Owner/Staff setup

Set `OWNER_SETUP_KEY` in `.env`. The first setup request must send the same value in the `x-owner-setup-key` header.

1. `POST /api/staff/auth/setup`
2. `POST /api/staff/auth/setup/resend-otp`
3. `POST /api/staff/auth/setup/verify-otp`

A partial unique MongoDB index on `role: owner_staff` ensures only one Owner/Staff document can exist. Once the first setup request creates the pending Owner/Staff account, calling setup again returns `409`; resend/verify must be used instead.

## Owner/Staff authentication

- `POST /api/staff/auth/login`
- `POST /api/staff/auth/login/resend-otp`
- `POST /api/staff/auth/login/verify-otp`
- `POST /api/staff/auth/forgot-password/initiate`
- `POST /api/staff/auth/forgot-password/resend-otp`
- `POST /api/staff/auth/forgot-password/verify-otp`
- `POST /api/staff/auth/forgot-password/change`
- `POST /api/staff/auth/refresh-token`
- `POST /api/staff/auth/logout`
- `GET /api/staff/auth/me`

Login verification creates the same HttpOnly access/refresh cookie session model used by customer auth.

## Technician creation and management

Owner/Staff-only endpoints:

- `POST /api/staff/technicians`
- `GET /api/staff/technicians`
- `GET /api/staff/technicians?status=all`
- `GET /api/staff/technicians?status=disabled`
- `PATCH /api/staff/technicians/:technicianId/toggle-active`

Create Technician requires `fullName`, unique `email`, `contactNumber`, and a password of at least 12 characters. Password is bcrypt-hashed by the User model and never returned by API responses.

The toggle endpoint requires **no request body**. It flips `isActive`. Disabling a technician also revokes active sessions and deletes pending OTP records.

## Technician activation and authentication

After Owner/Staff creates the technician:

- `POST /api/technician/auth/activate/resend-otp`
- `POST /api/technician/auth/activate/verify-otp`

Then normal technician auth:

- `POST /api/technician/auth/login`
- `POST /api/technician/auth/login/resend-otp`
- `POST /api/technician/auth/login/verify-otp`
- `POST /api/technician/auth/forgot-password/initiate`
- `POST /api/technician/auth/forgot-password/resend-otp`
- `POST /api/technician/auth/forgot-password/verify-otp`
- `POST /api/technician/auth/forgot-password/change`
- `POST /api/technician/auth/refresh-token`
- `POST /api/technician/auth/logout`
- `GET /api/technician/auth/me`

## RBAC

`protect` validates the JWT, user status, email verification and server-side session. `authorizeRoles(...)` then restricts privileged routes.

`POST /api/staff/technicians`, technician listing and technician toggle are all protected with `authorizeRoles('owner_staff')`. A customer or technician session therefore receives `403` and no internal account is created.

## Technician job ownership (SCRUM-41)

The uploaded backend does not yet contain the team member's Job model or `/api/jobs/:id` routes. To avoid inventing that schema and causing merge conflicts, this package adds:

`src/middlewares/technicianJobAccessMiddleware.js`

It exports `requireAssignedTechnician(loadJobById)`. When the Job module is merged, mount it after `protect` on job-detail/update routes. Owner/Staff passes; technicians pass only when the job's assigned technician id matches the logged-in technician; customers and unassigned technicians receive `403`.

## Database index sync

After merging the model changes, run:

```bash
npm run db:sync-indexes
```

This creates/synchronizes the one-owner partial unique index and the existing user/OTP indexes.
