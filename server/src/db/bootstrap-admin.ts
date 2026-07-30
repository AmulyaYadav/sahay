/**
 * Creates the FIRST admin account on a deployment.
 *
 * Staff accounts are normally minted by an existing admin through the console
 * (ADR-0013), which leaves a fresh database with no way in. This script is that
 * way in, and it is deliberately the only one: a single idempotent command run
 * once per deployment, not a permanent self-service endpoint.
 *
 *   BOOTSTRAP_ADMIN_USERNAME=amulya \
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
 *   npm run -w server db:bootstrap:admin
 *
 * The generated password is printed to stdout ONCE and never stored in readable
 * form. Supply BOOTSTRAP_ADMIN_PASSWORD to set a known one instead — useful
 * when the output is not somewhere you can read it back from.
 *
 * Idempotent: if the username already exists, nothing is written and the
 * command succeeds, so it is safe in a deploy script that runs every release.
 * The account is created with must_change_password set, so whatever password
 * this prints stops working the moment the owner signs in and replaces it.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pseudonymFromIndexes } from '@sahay/shared';
import { emailBlindIndex, encryptPii, hashPassword, newAdminPassword } from '../lib/crypto.js';
import { closeDb, getDb, schema } from './index.js';

interface BootstrapInput {
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'moderator';
}

function readInput(): BootstrapInput {
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? '').trim().toLowerCase();
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim();
  const role = (process.env.BOOTSTRAP_ADMIN_ROLE ?? 'admin').trim();

  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(username) || username.length < 3) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME must be 3+ chars: a-z, 0-9, dot, dash, underscore');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }
  if (role !== 'admin' && role !== 'moderator') {
    throw new Error("BOOTSTRAP_ADMIN_ROLE must be 'admin' or 'moderator'");
  }

  const supplied = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (supplied !== undefined && supplied.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
  }

  return { username, email, password: supplied ?? newAdminPassword(), role };
}

export async function bootstrapAdmin(input: BootstrapInput): Promise<
  { created: false; username: string } | { created: true; username: string; password: string; pseudonym: string }
> {
  const db = getDb();
  const emailHmac = emailBlindIndex(input.email);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, input.username))
      .limit(1);
    if (existing) return { created: false as const, username: input.username };

    // A different account already holds this address — creating a second one
    // would break the unique blind index, and merging identities silently is
    // not this script's call to make.
    const [emailTaken] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.emailHmac, emailHmac))
      .limit(1);
    if (emailTaken) {
      throw new Error(`Email already belongs to another account (${emailTaken.id}); pick another address`);
    }

    const pseudonym = pseudonymFromIndexes(randomInt(1024), randomInt(1024));
    const [created] = await tx
      .insert(schema.users)
      .values({
        pseudonym,
        avatarSeed: pseudonym,
        role: input.role,
        username: input.username,
        passwordHash: hashPassword(input.password),
        passwordSetAt: new Date(),
        mustChangePassword: true,
        emailEnc: encryptPii(input.email),
        emailHmac,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: schema.users.id });
    if (!created) throw new Error('bootstrap insert returned no row');

    await tx.insert(schema.reliabilityStats).values({ userId: created.id }).onConflictDoNothing();
    // Actor is null: no human was signed in to authorize this one.
    await tx.insert(schema.auditLog).values({
      actorId: null,
      action: 'admin_account_bootstrap',
      target: `user:${created.id}`,
      reason: `bootstrapped ${input.role} @${input.username}`,
    });

    return { created: true as const, username: input.username, password: input.password, pseudonym };
  });
}

async function main(): Promise<void> {
  const input = readInput();
  const result = await bootstrapAdmin(input);

  if (!result.created) {
    console.log(`✓ Admin @${result.username} already exists — nothing to do.`);
    return;
  }

  console.log(`\n✓ Created ${input.role} account\n`);
  console.log(`  username:  ${result.username}`);
  console.log(`  password:  ${result.password}`);
  console.log(`  display:   ${result.pseudonym}`);
  console.log(`\n  This password is shown once and is not recoverable.`);
  console.log(`  You will be asked to choose a new one at first sign-in.\n`);
}

// Only run when invoked directly, so tests can import bootstrapAdmin.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    await main();
    await closeDb();
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    await closeDb().catch(() => {});
    process.exitCode = 1;
  }
}
