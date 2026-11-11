/**
 * Break-glass: remove 2FA from a platform administrator who lost BOTH their authenticator and recovery codes
 * and cannot be reset by another admin (e.g. the only admin). Run on the server:
 *
 *   node scripts/reset-admin-2fa.cjs --email admin@example.com --yes
 *
 * What it does (database only, in one transaction):
 *   - deletes the user's user_two_factor row and every recovery code,
 *   - revokes all of the user's active auth_sessions,
 *   - writes an AuditLog row (action RESET_2FA_CLI) so the break-glass use is traceable.
 * Without --yes it only prints what it WOULD do (dry run). The target must be a SUPER_ADMIN.
 * Account lock counters live in Redis and expire on their own (<= lock minutes); unlock sooner from another
 * admin's Platform Admins page, or wait.
 * If `security.require2faForSuperAdmin` is ON the admin is forced to enroll again at next login.
 * Needs DATABASE_URL in the environment (`set -a; . ./.env; set +a` first).
 */

/** Pure/testable core: `prisma` is a PrismaClient (or a test double). Returns a summary object. */
async function resetAdmin2fa(prisma, email, { dryRun = false } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('An --email is required');

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user || user.role !== 'SUPER_ADMIN') {
    // Same message for "no such user" and "not a platform admin": this tool must not be an account oracle.
    throw new Error(`No SUPER_ADMIN found with email ${normalized}`);
  }

  const [hadFactor, recoveryCodes, sessions] = await Promise.all([
    prisma.userTwoFactor.count({ where: { userId: user.id } }),
    prisma.userRecoveryCode.count({ where: { userId: user.id } }),
    prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }),
  ]);
  const summary = {
    userId: user.id,
    email: user.email,
    hadFactor: hadFactor > 0,
    recoveryCodes,
    sessionsRevoked: sessions,
    dryRun,
  };
  if (dryRun) return summary;

  await prisma.$transaction([
    prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.userTwoFactor.deleteMany({ where: { userId: user.id } }),
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: '2FA_RESET' },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        action: 'RESET_2FA_CLI',
        entity: 'TwoFactor',
        entityId: user.id,
        changes: { after: { via: 'scripts/reset-admin-2fa.cjs', hadFactor: summary.hadFactor, recoveryCodes } },
      },
    }),
  ]);
  return summary;
}

function parseArgs(argv) {
  const out = { yes: false, email: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--yes') out.yes = true;
    else if (argv[i] === '--email') out.email = argv[++i];
    else if (argv[i].startsWith('--email=')) out.email = argv[i].slice(8);
  }
  return out;
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('Usage: node scripts/reset-admin-2fa.cjs --email <admin email> [--yes]');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const summary = await resetAdmin2fa(prisma, args.email, { dryRun: !args.yes });
    if (summary.dryRun) {
      console.log(
        `DRY RUN for ${summary.email}: would remove ${summary.hadFactor ? 'the 2FA factor' : '(no 2FA factor)'}, ` +
          `${summary.recoveryCodes} recovery code(s), revoke ${summary.sessionsRevoked} session(s). Re-run with --yes to apply.`,
      );
    } else {
      console.log(
        `2FA reset for ${summary.email}: factor removed, ${summary.recoveryCodes} recovery code(s) deleted, ` +
          `${summary.sessionsRevoked} session(s) revoked.`,
      );
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { resetAdmin2fa, parseArgs };
if (require.main === module) void main();
