# Merge notes

The implementation keeps the existing customer authentication endpoints unchanged and adds separate staff/technician modules. This reduces conflicts with teammates working on repair jobs, estimates and frontend screens.

New isolated files:

- `src/services/sessionService.js`
- `src/services/internalAuthService.js`
- `src/services/technicianManagementService.js`
- `src/controllers/internalAuthController.js`
- `src/controllers/technicianManagementController.js`
- `src/routes/staffRoutes.js`
- `src/routes/technicianRoutes.js`
- `src/middlewares/ownerSetupMiddleware.js`
- `src/middlewares/technicianJobAccessMiddleware.js`

Existing files with small required edits:

- `src/models/User.js`
- `src/models/Otp.js`
- `src/services/otpService.js`
- `src/services/emailService.js`
- `src/repositories/userRepository.js`
- `src/middlewares/authMiddleware.js`
- `src/server.js`
- `package.json`

Do not overwrite another member's Job model/routes with a guessed version. Wire `requireAssignedTechnician(...)` into those routes when their actual module is merged.
