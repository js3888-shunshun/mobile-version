/**
 * Set passwords for Cronwell members to "test1234".
 * Uses Node.js built-in crypto.scrypt — same algorithm as better-auth.
 *
 * Usage: npx tsx scripts/set-passwords.ts
 */

import { scrypt, randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://collab:14f40f40a202c455e3810e067168d040@localhost:5432/collab";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
  return `${salt}:${key.toString("hex")}`;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  // Cronwell members (all 4)
  const members = [
    { email: "js3888@cornell.edu", name: "Joy Sun" },
    { email: "rongjiu.cai@cronwell-ai.cn", name: "RongjiuCai" },
    { email: "tomz@cronwell.ai", name: "Tom Zheng" },
    { email: "test-mobile@cronalpha.com", name: "Mobile Test" },
  ];

  const newPassword = "test1234";

  for (const member of members) {
    const hashed = await hashPassword(newPassword);

    const result = await pool.query(
      `UPDATE account
       SET password = $1
       FROM "user"
       WHERE account.user_id = "user".id
         AND "user".email = $2
         AND account.provider_id = 'credential'
       RETURNING "user".name, "user".email`,
      [hashed, member.email]
    );

    if ((result.rowCount ?? 0) > 0) {
      console.log(`✅ Password set for ${member.name} (${member.email})`);
    } else {
      console.log(`❌ No credential account found for ${member.email}`);
    }
  }

  // Verify
  console.log("\n--- Verification ---");
  const verify = await pool.query(
    `SELECT u.name, u.email, LEFT(a.password, 32) as salt, LENGTH(a.password) as hash_len
     FROM account a JOIN "user" u ON a.user_id = u.id
     WHERE u.email = ANY($1)
       AND a.provider_id = 'credential'`,
    [members.map((m) => m.email)]
  );
  for (const row of verify.rows) {
    console.log(`  ${row.name} (${row.email}): hash_len=${row.hash_len}`);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
