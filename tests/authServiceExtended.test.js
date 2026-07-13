// =============================================================================
// FireISP 5.0 — Auth Service Extended Tests
// =============================================================================
// Tests for password reset, change password, and email verification flows.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$hashed$'),
  compare: jest.fn(),
}));

// resendVerificationEmail sends real transactional email (§382 Tier 2) — mock
// the transport so tests never attempt a real SMTP connection.
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
}));

const db = require('../src/config/database');
const bcrypt = require('bcryptjs');
const emailTransport = require('../src/services/emailTransport');
const authService = require('../src/services/authService');

describe('authService — extended flows', () => {
  beforeEach(() => jest.clearAllMocks());

  // =========================================================================
  // requestPasswordReset
  // =========================================================================
  describe('requestPasswordReset', () => {
    test('returns token info when user exists', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, email: 'test@example.com' }]]);  // findByEmail
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE

      const result = await authService.requestPasswordReset('test@example.com');

      expect(result.token).toBeDefined();
      expect(result.email).toBe('test@example.com');
      expect(result.userId).toBe(1);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('returns silently when user not found (prevent enumeration)', async () => {
      db.query.mockResolvedValueOnce([[]]);  // findByEmail — no user

      const result = await authService.requestPasswordReset('nobody@example.com');

      expect(result.message).toContain('If that email exists');
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // resetPassword
  // =========================================================================
  describe('resetPassword', () => {
    test('resets password with valid token', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }]])  // SELECT by token hash
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE password
        .mockResolvedValueOnce([{ affectedRows: 0 }]);  // DELETE sessions

      const result = await authService.resetPassword('valid-token-hex', 'newpassword123');

      expect(result.message).toContain('Password reset successfully');
      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
    });

    test('single-use — clears reset_token_hash/reset_token_expires on success so the same token cannot be redeemed twice', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }]])  // SELECT by token hash
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE password
        .mockResolvedValueOnce([{ affectedRows: 0 }]);  // DELETE sessions

      await authService.resetPassword('valid-token-hex', 'newpassword123');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('reset_token_hash = NULL, reset_token_expires = NULL'),
        expect.arrayContaining(['$hashed$', 1]),
      );
    });

    test('throws on invalid/expired token (the lookup query enforces reset_token_expires > NOW(), so an expired token returns zero rows same as an invalid one)', async () => {
      db.query.mockResolvedValueOnce([[]]);  // no matching token / expired

      await expect(
        authService.resetPassword('bad-token', 'newpassword123'),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    test('throws on short password', async () => {
      await expect(
        authService.resetPassword('any-token', 'short'),
      ).rejects.toThrow('Password must be at least 8 characters');
    });
  });

  // =========================================================================
  // changePassword
  // =========================================================================
  describe('changePassword', () => {
    test('changes password when current password is valid', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, password_hash: '$existing$' }]]);  // findById
      bcrypt.compare.mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE

      const result = await authService.changePassword(1, 'oldpass123', 'newpass123');

      expect(result.message).toContain('Password changed successfully');
    });

    test('throws when current password is wrong', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, password_hash: '$existing$' }]]);
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(
        authService.changePassword(1, 'wrongpass', 'newpass123'),
      ).rejects.toThrow('Current password is incorrect');
    });

    test('throws when user not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        authService.changePassword(999, 'any', 'newpass123'),
      ).rejects.toThrow('User not found');
    });

    test('throws on short new password', async () => {
      await expect(
        authService.changePassword(1, 'old', 'short'),
      ).rejects.toThrow('New password must be at least 8 characters');
    });
  });

  // =========================================================================
  // verifyEmail
  // =========================================================================
  describe('verifyEmail', () => {
    test('verifies email with valid token', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }]])  // SELECT by token hash
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE

      const result = await authService.verifyEmail('valid-token');
      expect(result.message).toContain('Email verified successfully');
    });

    test('throws on invalid token', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        authService.verifyEmail('bad-token'),
      ).rejects.toThrow('Invalid verification token');
    });
  });

  // =========================================================================
  // generateEmailVerificationToken
  // =========================================================================
  describe('generateEmailVerificationToken', () => {
    test('generates and stores verification token', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await authService.generateEmailVerificationToken(1);
      expect(result.token).toBeDefined();
      expect(result.token.length).toBe(64);  // 32 bytes hex
    });
  });

  // =========================================================================
  // resendVerificationEmail
  // =========================================================================
  describe('resendVerificationEmail', () => {
    test('no-op fast path when already verified — does not generate a new token or send an email', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, email: 'test@example.com', email_verified_at: '2026-01-01 00:00:00' }]]);  // User.findById

      const result = await authService.resendVerificationEmail(1);

      expect(result.alreadyVerified).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(1);  // only the findById lookup
      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    });

    test('generates a fresh token and emails it when not yet verified', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, email: 'test@example.com', first_name: 'Test', last_name: 'User', email_verified_at: null }]])  // User.findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // generateEmailVerificationToken UPDATE

      const result = await authService.resendVerificationEmail(1);

      expect(result.message).toContain('Verification email sent');
      expect(emailTransport.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com', subject: 'Verify Your Email Address' }),
      );
    });

    test('throws NotFoundError when the user does not exist', async () => {
      db.query.mockResolvedValueOnce([[]]);  // User.findById — no row

      await expect(authService.resendVerificationEmail(999)).rejects.toThrow('User');
      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    });
  });
});
