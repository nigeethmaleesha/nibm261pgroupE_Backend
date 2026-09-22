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
