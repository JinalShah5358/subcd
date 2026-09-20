import { db, getAuth } from '../../auth/context';
import { decryptField } from '../crypto';
import { notFound } from '../../utils/problem';

/**
 * Builds the autofill payload for one case.
 *
 * This is the moment the platform hands out real identifiers — PAN, GSTIN,
 * Udyam, a loan account number — in plaintext rather than masked. Everywhere
 * else those leave the API as `••••••234F`. So this is treated as a reveal:
 * it needs `sensitive:reveal`, it is rate limited, and the caller writes an
 * audit row naming which paths were released.
 *
 * The payload is FLAT and path-addressed on purpose. A field mapping says
 * "the control at this selector takes `client.pan`", and nothing more; the
 * shape of our database can change without invalidating a captured mapping,
 * and a mapping can be reviewed by a human reading two columns.
 */

/** Every path the extension is allowed to ask for, and what it means. */
export const SOURCE_PATHS = {
  'client.legalName': 'Applicant legal name',
  'client.tradeName': 'Trade name',
  'client.entityType': 'Constitution / entity type',
  'client.businessActivity': 'Business activity',
  'client.nicCode': 'NIC code',
  'client.incorporationDate': 'Date of incorporation',
  'client.pan': 'PAN (sensitive)',
  'client.gstin': 'GSTIN (sensitive)',
  'client.udyam': 'Udyam registration (sensitive)',
  'client.regdAddressLine1': 'Registered address line 1',
  'client.regdAddressLine2': 'Registered address line 2',
  'client.regdCity': 'Registered city',
  'client.regdPincode': 'Registered PIN code',
  'client.contactPersonName': 'Contact person',
  'client.contactEmail': 'Contact email',
  'client.contactPhone': 'Contact phone',

  'case.caseNumber': 'Internal case number',
  'case.applicationType': 'Application type',
  'case.applicationDate': 'Application date',

  'project.projectName': 'Project name',
  'project.addressLine1': 'Project address line 1',
  'project.addressLine2': 'Project address line 2',
  'project.village': 'Village',
  'project.talukaCode': 'Taluka',
  'project.districtCode': 'District',
  'project.pincode': 'Project PIN code',
  'project.gidcEstate': 'GIDC estate',
  'project.plotSurveyNo': 'Plot / survey number',
  'project.areaType': 'Area type',
  'project.commercialProductionDate': 'Date of commercial production',

  'loan.bankName': 'Financing bank',
  'loan.branchName': 'Branch',
  'loan.ifsc': 'IFSC',
  'loan.accountNumber': 'Loan account number (sensitive)',
  'loan.sanctionLetterRef': 'Sanction letter reference',
  'loan.sanctionDate': 'Sanction date',
  'loan.firstDisbursementDate': 'First disbursement date',
  'loan.sanctionedAmount': 'Sanctioned amount',
  'loan.disbursedAmount': 'Disbursed amount',
  'loan.interestRatePercent': 'Interest rate (%)',
  'loan.tenureMonths': 'Tenure (months)',

  'employment.totalEmployees': 'Total employees',
  'employment.epfRegisteredEmployees': 'EPF-registered employees',
  'employment.localEmployees': 'Local employees',
  'employment.epfEstablishmentCode': 'EPF establishment code',
  'employment.esicCode': 'ESIC code',
  'employment.asOnDate': 'Employment as-on date',
} as const;

export type SourcePath = keyof typeof SOURCE_PATHS;

/** Paths that carry a decrypted identifier. Released only with an audit row. */
export const SENSITIVE_PATHS: ReadonlySet<string> = new Set([
  'client.pan',
  'client.gstin',
  'client.udyam',
  'loan.accountNumber',
]);

export const isSourcePath = (value: string): value is SourcePath => value in SOURCE_PATHS;

const dateStr = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

const decimalStr = (d: { toString(): string } | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toString();

export interface CasePayload {
  caseId: string;
  caseNumber: string;
  clientName: string;
  /** path -> value. Absent paths simply have no data on this case. */
  values: Record<string, string>;
  /** Which of the returned paths were sensitive, for the audit row. */
  sensitiveReleased: string[];
}

/**
 * @param includeSensitive when false, identifiers are omitted entirely rather
 *   than masked. A masked PAN typed into a government form would be worse than
 *   an empty box: it looks filled and is wrong.
 */
export async function buildCasePayload(
  caseId: string,
  includeSensitive: boolean,
): Promise<CasePayload> {
  const { firmId } = getAuth();

  const kase = await db().case.findFirst({
    where: { id: caseId },
    select: {
      id: true,
      caseNumber: true,
      applicationType: true,
      applicationDate: true,
      client: {
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          entityType: true,
          businessActivity: true,
          nicCode: true,
          incorporationDate: true,
          panEnc: true,
          gstinEnc: true,
          udyamEnc: true,
          regdAddressLine1: true,
          regdAddressLine2: true,
          regdCity: true,
          regdPincode: true,
          contactPersonName: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
      project: true,
      loan: { include: { bank: { select: { name: true, branchName: true, ifsc: true } } } },
      employment: true,
    },
  });

  if (!kase) throw notFound('That case');

  const values: Record<string, string> = {};
  const put = (path: SourcePath, value: unknown): void => {
    if (value === null || value === undefined) return;
    const str = String(value).trim();
    if (str !== '') values[path] = str;
  };

  const c = kase.client;
  put('client.legalName', c.legalName);
  put('client.tradeName', c.tradeName);
  put('client.entityType', c.entityType);
  put('client.businessActivity', c.businessActivity);
  put('client.nicCode', c.nicCode);
  put('client.incorporationDate', dateStr(c.incorporationDate));
  put('client.regdAddressLine1', c.regdAddressLine1);
  put('client.regdAddressLine2', c.regdAddressLine2);
  put('client.regdCity', c.regdCity);
  put('client.regdPincode', c.regdPincode);
  put('client.contactPersonName', c.contactPersonName);
  put('client.contactEmail', c.contactEmail);
  put('client.contactPhone', c.contactPhone);

  put('case.caseNumber', kase.caseNumber);
  put('case.applicationType', kase.applicationType);
  put('case.applicationDate', dateStr(kase.applicationDate));

  const p = kase.project;
  if (p) {
    put('project.projectName', p.projectName);
    put('project.addressLine1', p.addressLine1);
    put('project.addressLine2', p.addressLine2);
    put('project.village', p.village);
    put('project.talukaCode', p.talukaCode);
    put('project.districtCode', p.districtCode);
    put('project.pincode', p.pincode);
    put('project.gidcEstate', p.gidcEstate);
    put('project.plotSurveyNo', p.plotSurveyNo);
    put('project.areaType', p.areaType);
    put('project.commercialProductionDate', dateStr(p.commercialProductionDate));
  }

  const l = kase.loan;
  if (l) {
    put('loan.bankName', l.bank?.name);
    put('loan.branchName', l.bank?.branchName);
    put('loan.ifsc', l.bank?.ifsc);
    put('loan.sanctionLetterRef', l.sanctionLetterRef);
    put('loan.sanctionDate', dateStr(l.sanctionDate));
    put('loan.firstDisbursementDate', dateStr(l.firstDisbursementDate));
    put('loan.sanctionedAmount', decimalStr(l.sanctionedAmount));
    put('loan.disbursedAmount', decimalStr(l.disbursedAmount));
    put('loan.interestRatePercent', decimalStr(l.interestRatePercent));
    put('loan.tenureMonths', l.tenureMonths);
  }

  const e = kase.employment;
  if (e) {
    put('employment.totalEmployees', e.totalEmployees);
    put('employment.epfRegisteredEmployees', e.epfRegisteredEmployees);
    put('employment.localEmployees', e.localEmployees);
    put('employment.epfEstablishmentCode', e.epfEstablishmentCode);
    put('employment.esicCode', e.esicCode);
    put('employment.asOnDate', dateStr(e.asOnDate));
  }

  const sensitiveReleased: string[] = [];

  if (includeSensitive) {
    const reveal = async (
      path: SourcePath,
      cipher: Uint8Array | null,
      table: string,
      column: string,
      rowId: string,
    ): Promise<void> => {
      if (!cipher) return;
      const plain = await decryptField(cipher, { firmId, table, column, rowId });
      if (plain) {
        values[path] = plain;
        sensitiveReleased.push(path);
      }
    };

    await reveal('client.pan', c.panEnc, 'client', 'pan_enc', c.id);
    await reveal('client.gstin', c.gstinEnc, 'client', 'gstin_enc', c.id);
    await reveal('client.udyam', c.udyamEnc, 'client', 'udyam_enc', c.id);
    if (l) {
      await reveal('loan.accountNumber', l.loanAccountEnc, 'loan', 'loan_account_enc', l.id);
    }
  }

  return {
    caseId: kase.id,
    caseNumber: kase.caseNumber,
    clientName: c.legalName,
    values,
    sensitiveReleased,
  };
}

/* ------------------------------ transforms ------------------------------ */

/**
 * Named value transforms a mapping may apply.
 *
 * Closed set, looked up by name — never an expression, never anything that
 * gets evaluated. A field mapping is data captured from a page and reviewed by
 * a human; it must not be able to become code.
 */
export const TRANSFORMS: Record<string, (value: string) => string> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  trim: (v) => v.trim(),
  digitsOnly: (v) => v.replace(/\D/g, ''),
  /** 2024-03-15 -> 15/03/2024 */
  dateDDMMYYYY: (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  },
  /** 2024-03-15 -> 15-03-2024 */
  dateDDMMYYYYDash: (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
  },
  /** "1250000.00" -> "1250000" for integer-only boxes. */
  amountWhole: (v) => v.split('.')[0] ?? v,
  /** Strips grouping a portal might reject. */
  amountPlain: (v) => v.replace(/,/g, ''),
};

export const TRANSFORM_NAMES = Object.keys(TRANSFORMS);

export function applyTransform(value: string, transform: string | null | undefined): string {
  if (!transform) return value;
  const fn = TRANSFORMS[transform];
  // An unknown transform leaves the value alone rather than guessing. The
  // mapping is wrong, but a wrong value in a government form is worse.
  return fn ? fn(value) : value;
}
