/**
 * Seeds roles and the first SUPER_ADMIN user. Idempotent.
 * Contains NO candidate data — candidates only ever come from an approved sync.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const { prisma, DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES, ROLE_DESCRIPTIONS } = await import("../src/index");

const DESCRIPTIONS = ROLE_DESCRIPTIONS;

async function main() {
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      update: { permissions: [...DEFAULT_ROLE_PERMISSIONS[name]], description: DESCRIPTIONS[name] },
      create: { name, permissions: [...DEFAULT_ROLE_PERMISSIONS[name]], description: DESCRIPTIONS[name] },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) in .env");
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — password left unchanged.`);
  } else {
    await prisma.user.create({
      data: { email, name: "Super Admin", passwordHash: await bcrypt.hash(password, 12), roleId: role.id },
    });
    console.log(`Created admin ${email}.`);
  }
  console.log(`Roles: ${ROLE_NAMES.join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
