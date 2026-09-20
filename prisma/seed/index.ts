/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';
import { hash as argonHash } from '@node-rs/argon2';
import {
  PLAN_DEFAULTS,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  ROLE_KEYS,
  uuidv7,
} from '@ifp/shared';
import { DOCUMENT_TYPES, GUJARAT_DISTRICTS } from './data/reference';
import { CONSENT_TEMPLATE_DRAFT, VALIDATION_RULES } from './data/rules';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * The seed connects as the MIGRATION role (DATABASE_DIRECT_URL), which owns the
 * tables and therefore is not subject to RLS. The application never uses this
 * connection string.
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL } },
});

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

async function seedRoles() {
  for (const key of ROLE_KEYS) {
    const existing = await prisma.role.findFirst({ where: { key, firmId: null } });
    const data = {
      key,
      name: ROLE_LABEL[key],
      description: `${ROLE_LABEL[key]} — seeded system role`,
      permissions: ROLE_PERMISSIONS[key],
      isSystem: true,
      rank: ROLE_RANK[key],
      firmId: null,
    };
    if (existing) {
      await prisma.role.update({ where: { id: existing.id }, data });
    } else {
      await prisma.role.create({ data: { id: uuidv7(), ...data } });
    }
  }
  console.log(`  roles                 ${ROLE_KEYS.length}`);
}

async function seedGeography() {
  let districts = 0;
  let talukas = 0;
  for (const d of GUJARAT_DISTRICTS) {
    const district = await prisma.district.upsert({
      where: { code: d.code },
      update: { name: d.name, dicCode: d.dicCode, dicName: d.dicName },
      create: {
        id: uuidv7(),
        code: d.code,
        name: d.name,
        stateCode: 'GJ',
        dicCode: d.dicCode,
        dicName: d.dicName,
      },
    });
    districts++;

    for (const [i, t] of (d.talukas ?? []).entries()) {
      const code = `${d.code}-T${String(i + 1).padStart(2, '0')}`;
      await prisma.taluka.upsert({
        where: { code },
        update: { name: t, districtId: district.id },
        create: { id: uuidv7(), code, name: t, districtId: district.id },
      });
      talukas++;
    }
  }
  console.log(`  districts / talukas   ${districts} / ${talukas}  (taluka lists are partial until Phase 0)`);
}

async function seedDocumentTypes() {
  for (const dt of DOCUMENT_TYPES) {
    const existing = await prisma.documentType.findFirst({ where: { code: dt.code, firmId: null } });
    const data = {
      code: dt.code,
      name: dt.name,
      description: dt.description,
      category: dt.category,
      sortOrder: dt.sortOrder,
      isActive: true,
      firmId: null,
    };
    if (existing) {
      await prisma.documentType.update({ where: { id: existing.id }, data });
    } else {
      await prisma.documentType.create({ data: { id: uuidv7(), ...data } });
    }
  }
  console.log(`  document types        ${DOCUMENT_TYPES.length}`);
}

async function seedScheme() {
  const scheme = await prisma.scheme.upsert({
    where: { code: 'GJ_IFP_CAPITAL' },
    update: {},
    create: {
      id: uuidv7(),
      code: 'GJ_IFP_CAPITAL',
      name: 'Gujarat IFP — Capital subsidy',
      authority: 'Industries Commissionerate, Government of Gujarat',
      description:
        'Placeholder scheme record. The governing resolution has not been read yet — see task XC-007.',
      isActive: true,
    },
  });

  const version = await prisma.schemeVersion.upsert({
    where: { schemeId_versionLabel: { schemeId: scheme.id, versionLabel: 'v1-draft' } },
    update: {},
    create: {
      id: uuidv7(),
      schemeId: scheme.id,
      versionLabel: 'v1-draft',
      effectiveFrom: new Date('2024-01-01'),
      status: 'DRAFT',
      sourceReference: null,
      notes:
        'DRAFT. No eligibility rule in this version is active until the governing resolution is read and cited (XC-007 / P0-018).',
    },
  });

  // Document requirements for this scheme version.
  const types = await prisma.documentType.findMany({ where: { firmId: null } });
  const byCode = new Map(types.map((t) => [t.code, t]));
  let reqs = 0;
  for (const dt of DOCUMENT_TYPES) {
    const type = byCode.get(dt.code);
    if (!type) continue;
    await prisma.schemeDocumentRequirement.upsert({
      where: {
        schemeVersionId_documentTypeId: {
          schemeVersionId: version.id,
          documentTypeId: type.id,
        },
      },
      update: { isMandatory: dt.mandatory, sortOrder: dt.sortOrder },
      create: {
        id: uuidv7(),
        schemeVersionId: version.id,
        documentTypeId: type.id,
        isMandatory: dt.mandatory,
        sortOrder: dt.sortOrder,
      },
    });
    reqs++;
  }
  console.log(`  scheme + version      1 + 1  (status DRAFT)`);
  console.log(`  document requirements ${reqs}`);
  return version;
}

async function seedRules(schemeVersionId: string) {
  let active = 0;
  let draft = 0;

  for (const r of VALIDATION_RULES) {
    const rule = await prisma.validationRule.upsert({
      where: { code: r.code },
      update: { name: r.name, category: r.category, isActive: true },
      create: {
        id: uuidv7(),
        code: r.code,
        name: r.name,
        category: r.category,
        appliesTo: 'CASE',
        isActive: true,
      },
    });

    const isPolicy = r.status === 'DRAFT';
    await prisma.validationRuleVersion.upsert({
      where: { ruleId_versionLabel: { ruleId: rule.id, versionLabel: 'v1' } },
      update: {
        severity: r.severity,
        expression: r.expression as Prisma.InputJsonValue,
        params: (r.params ?? {}) as Prisma.InputJsonValue,
        messageTemplate: r.messageTemplate,
        remediationHint: r.remediationHint ?? null,
        status: r.status,
        fieldCode: r.fieldCode ?? null,
        section: r.section ?? null,
      },
      create: {
        id: uuidv7(),
        ruleId: rule.id,
        // Policy rules are pinned to the scheme version; structural rules are not.
        schemeVersionId: isPolicy ? schemeVersionId : null,
        versionLabel: 'v1',
        severity: r.severity,
        expression: r.expression as Prisma.InputJsonValue,
        params: (r.params ?? {}) as Prisma.InputJsonValue,
        messageTemplate: r.messageTemplate,
        remediationHint: r.remediationHint ?? null,
        sourceReference: r.sourceReference ?? null,
        fieldCode: r.fieldCode ?? null,
        section: r.section ?? null,
        status: r.status,
        effectiveFrom: new Date('2024-01-01'),
      },
    });

    if (r.status === 'ACTIVE') active++;
    else draft++;
  }
  console.log(`  validation rules      ${active} ACTIVE (structural) + ${draft} DRAFT (scheme policy, awaiting citation)`);
}

async function seedConsentTemplate() {
  const t = CONSENT_TEMPLATE_DRAFT;
  await prisma.consentTemplate.upsert({
    where: {
      code_versionLabel_language: {
        code: t.code,
        versionLabel: t.versionLabel,
        language: t.language,
      },
    },
    update: { bodyText: t.bodyText, bodySha256: sha256(t.bodyText) },
    create: {
      id: uuidv7(),
      code: t.code,
      versionLabel: t.versionLabel,
      language: t.language,
      bodyText: t.bodyText,
      bodySha256: sha256(t.bodyText),
      purposeCodes: t.purposeCodes,
      effectiveFrom: new Date('2024-01-01'),
      isActive: true,
      isDraftText: true,
    },
  });
  console.log('  consent template      1  (DRAFT TEXT — not legally reviewed)');
}

/**
 * The platform operator's own tenant.
 *
 * A user row requires a firm, so a platform administrator has to belong to
 * one. Rather than making firmId nullable — which would put a hole in the RLS
 * policy on every user query — the operator gets a firm of its own. It holds
 * no clients and no cases, so the platform admin's ordinary tenant-scoped
 * access reaches nothing but their own account. Everything cross-tenant goes
 * through the platform_* functions, which return counts and metadata only.
 */
/**
 * The form the extension is allowed to act on.
 *
 * Only the IDENTITY of the form is seeded — a code, a name and the one host
 * the extension may run on. No selectors, because nobody has seen the
 * authenticated page yet and a guessed selector is worse than none: it would
 * type a PAN into whatever box happened to match. The field map is captured
 * from the real page through the extension's "Learn this page" mode and
 * reviewed before it is activated.
 */
async function seedFormDefinitions() {
  await prisma.formDefinition.upsert({
    where: { code: 'IFP_CAPITAL_SUBSIDY' },
    update: {},
    create: {
      id: uuidv7(),
      code: 'IFP_CAPITAL_SUBSIDY',
      name: 'IFP capital subsidy application',
      description:
        'The application form on the Gujarat IFP portal. No field mapping is seeded — capture it from the real page.',
      host: 'ifp.gujarat.gov.in',
      pathHint: null,
    },
  });
  // The dev stand-in, so the extension can be exercised before portal access.
  // Its host is localhost, so the extension will act on it and on nothing else.
  await prisma.formDefinition.upsert({
    where: { code: 'IFP_MOCK_DEV' },
    update: {},
    create: {
      id: uuidv7(),
      code: 'IFP_MOCK_DEV',
      name: 'MOCK application form (development only)',
      description:
        'A stand-in served by the API at /dev/mock-ifp-form. Not the IFP portal and not a copy of it — it imitates the shape of a government form so the capture and fill flow can be walked through.',
      host: 'localhost',
      pathHint: '/dev/mock-ifp-form',
    },
  });

  console.log('  form definitions      2  (IFP: no field map — capture from the real page)');
  console.log('                           (MOCK: dev stand-in at /dev/mock-ifp-form)');
}

async function seedPlatformFirm() {
  const password = process.env.SEED_PLATFORM_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'ChangeMe!Dev2026';
  const passwordHash = await argonHash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const firm = await prisma.firm.upsert({
    where: { slug: 'platform' },
    update: {},
    create: {
      id: uuidv7(),
      name: 'Platform Operations',
      slug: 'platform',
      contactEmail: 'platform@demo.local',
      status: 'ACTIVE',
      // The platform's own tenant holds no client data and must never be able
      // to lock itself out of the console that grants licences.
      plan: 'ENTERPRISE',
      licenseExpiresAt: null,
      licenseNote: 'Platform operations — not a customer',
    },
  });

  const role = await prisma.role.findFirst({ where: { key: 'PLATFORM_ADMIN', firmId: null } });
  if (!role) throw new Error('PLATFORM_ADMIN role missing — seedRoles must run first');

  await prisma.user.upsert({
    where: { emailNormalized: 'platform@demo.local' },
    update: { roleId: role.id, status: 'ACTIVE', passwordHash },
    create: {
      id: uuidv7(),
      firmId: firm.id,
      email: 'platform@demo.local',
      emailNormalized: 'platform@demo.local',
      fullName: 'Platform Administrator',
      roleId: role.id,
      status: 'ACTIVE',
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
  });

  console.log('  platform firm + admin 1 + 1');
}

async function seedDemoFirm() {
  if (process.env.NODE_ENV === 'production') {
    console.log('  demo firm             skipped (NODE_ENV=production)');
    return;
  }

  const password = process.env.SEED_DEMO_PASSWORD ?? 'ChangeMe!Dev2026';
  const passwordHash = await argonHash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const firm = await prisma.firm.upsert({
    where: { slug: 'demo-ca-firm' },
    update: {},
    create: {
      id: uuidv7(),
      name: 'Demo CA Associates',
      slug: 'demo-ca-firm',
      contactEmail: 'admin@demo.local',
      city: 'Ahmedabad',
      state: 'Gujarat',
      status: 'ACTIVE',
      // A real licence rather than the column defaults, so the console has
      // something to show and the quota path is exercised in development
      // rather than first meeting a limit in production.
      plan: 'PROFESSIONAL',
      licenseExpiresAt: new Date(Date.now() + 365 * 86_400_000),
      licenseGraceDays: 14,
      maxUsers: PLAN_DEFAULTS.PROFESSIONAL.maxUsers,
      maxClients: PLAN_DEFAULTS.PROFESSIONAL.maxClients,
      maxCases: PLAN_DEFAULTS.PROFESSIONAL.maxCases,
      licenseNote: 'Seeded demo firm',
    },
  });

  const roles = await prisma.role.findMany({ where: { firmId: null } });
  const roleByKey = new Map(roles.map((r) => [r.key, r]));

  const demoUsers = [
    { email: 'admin@demo.local', fullName: 'Demo Firm Admin', roleKey: 'FIRM_ADMIN' },
    { email: 'ca@demo.local', fullName: 'Demo Chartered Accountant', roleKey: 'CA' },
    { email: 'staff@demo.local', fullName: 'Demo Staff', roleKey: 'STAFF' },
    { email: 'reviewer@demo.local', fullName: 'Demo Reviewer', roleKey: 'REVIEWER' },
  ];

  for (const u of demoUsers) {
    const role = roleByKey.get(u.roleKey);
    if (!role) continue;
    await prisma.user.upsert({
      where: { emailNormalized: u.email },
      update: { roleId: role.id, status: 'ACTIVE', passwordHash },
      create: {
        id: uuidv7(),
        firmId: firm.id,
        email: u.email,
        emailNormalized: u.email,
        fullName: u.fullName,
        roleId: role.id,
        status: 'ACTIVE',
        passwordHash,
        passwordUpdatedAt: new Date(),
      },
    });
  }

  console.log(`  demo firm + users     1 + ${demoUsers.length}`);
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log('  │ DEV LOGIN                                                │');
  console.log('  │   admin@demo.local / ca@demo.local / staff@demo.local    │');
  console.log('  │   reviewer@demo.local                                    │');
  console.log(`  │   password: ${password.padEnd(44)}│`);
  console.log('  │ Synthetic data only. Never seed a production database.   │');
  console.log('  └──────────────────────────────────────────────────────────┘');
}

async function main() {
  console.log('\nSeeding IFP platform reference data\n');
  await seedRoles();
  await seedGeography();
  await seedDocumentTypes();
  const version = await seedScheme();
  await seedRules(version.id);
  await seedConsentTemplate();
  await seedFormDefinitions();
  await seedPlatformFirm();
  await seedDemoFirm();
  console.log('\nSeed complete.\n');
}

main()
  .catch((e) => {
    console.error('\nSeed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
