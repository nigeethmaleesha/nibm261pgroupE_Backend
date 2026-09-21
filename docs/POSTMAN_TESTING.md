# RepairFlow Auth Postman Testing

Import `postman/RepairFlow_Auth_Separate_Otp_Model.postman_collection.json`.

Set `testEmail` to an email address you can receive mail on.

## Registration

1. Run **Registration - Request OTP**.
2. In MongoDB Atlas open database `repairflow`, collection `otp`.
3. Find `{ email: <testEmail>, purpose: "REGISTER" }` and copy the six-digit `otp`, or read it from Gmail.
4. Set Postman collection variable `registrationOtp`.
5. Run **Registration - Verify OTP**.
6. Confirm the REGISTER OTP document disappears and the user has `isEmailVerified: true`.

For resend testing, wait for the configured cooldown and run **Registration - Resend OTP**. Confirm the same OTP record is updated with a new `otp`, new `expiresAt`, reset attempts, and incremented resend count.

## Login

1. Run **Login - Request OTP** with the verified customer's credentials.
2. In the `otp` collection find `{ email: <testEmail>, purpose: "LOGIN" }`.
3. Copy the OTP into Postman's `loginOtp` variable.
4. Run **Login - Verify OTP**.
5. Confirm the LOGIN OTP document is deleted and Postman receives the HttpOnly access/refresh cookies.

For resend testing, run **Login - Request OTP**, wait for the cooldown, then **Login - Resend OTP**. Resend is rejected if there is no pending LOGIN OTP request.

## Session lifecycle

After login OTP verification:

- `GET /api/auth/me` -> `200`
- `POST /api/auth/refresh-token` -> `200`
- `POST /api/auth/logout` -> `200`
- `GET /api/auth/me` after logout -> `401`
