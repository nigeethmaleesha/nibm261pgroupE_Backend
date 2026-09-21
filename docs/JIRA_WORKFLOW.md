# Jira Workflow - Customer Registration/Login Backend

For the assigned backend work, the implementation covers:

- SCRUM-32: registration endpoint, validation, password hashing, Customer role enforcement, registration OTP, verification and resend
- SCRUM-33: User schema with unique email constraint and contact-number index, plus separate Otp schema/collection for verification codes
- SCRUM-36: login/logout, login OTP, verification/resend, JWT access/refresh tokens, HttpOnly cookies and session invalidation

The OTP implementation follows the supplied PrintDrop backend: OTP data is stored in a separate `Otp` model / `otp` MongoDB collection instead of inside the `User` document.

Recommended Jira flow:

1. Move SCRUM-32, SCRUM-33 and SCRUM-36 to **In Progress** while implementing/testing your backend work.
2. Test registration + OTP + resend + verification in Postman.
3. In MongoDB Atlas confirm the OTP is created under the separate `otp` collection and removed after successful verification.
4. Test login + OTP + resend + verification.
5. Test `/me`, refresh-token rotation and logout invalidation.
6. Push the tested code to `nigeeth_dev` and create/link the commit or PR.
7. Add a short Jira testing comment with the endpoints tested.
8. Move only completed backend subtasks to **Done**.
9. Keep frontend subtasks in **To Do** until the UI designs are available.
10. Leave QA subtasks with the assigned QA member.
