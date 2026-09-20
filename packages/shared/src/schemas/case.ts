import { z } from 'zod';
import {
  APPLICATION_TYPE,
  AREA_TYPE,
  BANK_TYPE,
  CASE_STATUS,
  RATE_TYPE,
} from '../constants/enums';
import {
  optionalCount,
  optionalDate,
  optionalIfsc,
  optionalMoney,
  optionalPastOrTodayDate,
  optionalPercent,
  optionalPincode,
  optionalText,
  requiredText,
  uuid,
} from './common';

export const caseCreateSchema = z
  .object({
    clientId: uuid,
    schemeVersionId: uuid,
    applicationType: z.enum(APPLICATION_TYPE),
    title: optionalText(200),
    assignedToUserId: uuid.optional().nullable(),
    duplicateOverrideReason: optionalText(500),
  })
  .strict();
export type CaseCreateInput = z.infer<typeof caseCreateSchema>;

export const caseUpdateSchema = z
  .object({
    title: optionalText(200),
    applicationDate: optionalPastOrTodayDate,
    assignedToUserId: uuid.optional().nullable(),
  })
  .strict();
export type CaseUpdateInput = z.infer<typeof caseUpdateSchema>;

export const caseStatusChangeSchema = z
  .object({
    status: z.enum(CASE_STATUS),
    reason: optionalText(500),
    /** Only meaningful for the transition to FILED — the CA files manually. */
    portalApplicationNo: optionalText(64),
    filedAt: optionalPastOrTodayDate,
  })
  .strict();
export type CaseStatusChangeInput = z.infer<typeof caseStatusChangeSchema>;

export const caseSearchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(CASE_STATUS).optional(),
    clientId: uuid.optional(),
    assignedToUserId: uuid.optional(),
    applicationType: z.enum(APPLICATION_TYPE).optional(),
    sort: z.enum(['caseNumber', 'updatedAt', 'readinessScore', 'status']).default('updatedAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CaseSearchInput = z.infer<typeof caseSearchSchema>;

/* ------------------------------------------------------------------ *
 * Case sections. Every field is optional: a CA collects this data over
 * days and a partial draft must always save. Completeness is enforced
 * by versioned validation rules at transition time, not by the schema.
 * ------------------------------------------------------------------ */

export const projectSchema = z
  .object({
    projectName: optionalText(250),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    village: optionalText(120),
    talukaCode: optionalText(12),
    districtCode: optionalText(12),
    dicCode: optionalText(12),
    pincode: optionalPincode,
    gidcEstate: optionalText(120),
    plotSurveyNo: optionalText(80),
    areaType: z.enum(AREA_TYPE).optional().nullable(),
    isExpansion: z.boolean().optional().default(false),
    commercialProductionDate: optionalDate,
    latitude: optionalText(20),
    longitude: optionalText(20),
  })
  .strict();
export type ProjectInput = z.infer<typeof projectSchema>;

export const loanSchema = z
  .object({
    bankId: uuid.optional().nullable(),
    /** Used when the bank is not yet in the reference list. */
    newBank: z
      .object({
        name: requiredText(160, 'Bank name'),
        branchName: requiredText(160, 'Branch name'),
        ifsc: optionalIfsc,
        bankType: z.enum(BANK_TYPE).optional().nullable(),
      })
      .strict()
      .optional(),
    loanAccountNo: optionalText(40),
    sanctionLetterRef: optionalText(80),
    sanctionDate: optionalDate,
    firstDisbursementDate: optionalDate,
    lastDisbursementDate: optionalDate,
    sanctionedAmount: optionalMoney,
    disbursedAmount: optionalMoney,
    interestRatePercent: optionalPercent,
    rateType: z.enum(RATE_TYPE).optional().nullable(),
    tenureMonths: optionalCount,
    moratoriumMonths: optionalCount,
    purpose: optionalText(250),
    isTermLoan: z.boolean().optional().default(true),
  })
  .strict();
export type LoanInput = z.infer<typeof loanSchema>;

export const employmentSchema = z
  .object({
    epfEstablishmentCode: optionalText(32),
    esicCode: optionalText(32),
    totalEmployees: optionalCount,
    epfRegisteredEmployees: optionalCount,
    localEmployees: optionalCount,
    skilledCount: optionalCount,
    semiSkilledCount: optionalCount,
    unskilledCount: optionalCount,
    maleCount: optionalCount,
    femaleCount: optionalCount,
    differentlyAbledCount: optionalCount,
    contractEmployees: optionalCount,
    employmentGeneratedNew: optionalCount,
    asOnDate: optionalDate,
  })
  .strict();
export type EmploymentInput = z.infer<typeof employmentSchema>;

export const investmentSchema = z
  .object({
    landCost: optionalMoney,
    landDevelopmentCost: optionalMoney,
    buildingCost: optionalMoney,
    plantMachineryCost: optionalMoney,
    electricalInstallationCost: optionalMoney,
    equipmentCost: optionalMoney,
    furnitureFixtureCost: optionalMoney,
    otherEligibleCost: optionalMoney,
    preOperativeExpenses: optionalMoney,
    totalProjectCost: optionalMoney,
    eligibleInvestmentTotal: optionalMoney,
    promoterContribution: optionalMoney,
    termLoanComponent: optionalMoney,
    workingCapitalComponent: optionalMoney,
    otherSourceAmount: optionalMoney,
    subsidyClaimedAmount: optionalMoney,
    isSecondHandMachinery: z.boolean().optional().default(false),
    machineryInvoiceCount: optionalCount,
    valuationBasis: optionalText(160),
  })
  .strict();
export type InvestmentInput = z.infer<typeof investmentSchema>;

export const firstSaleSchema = z
  .object({
    firstSaleDate: optionalDate,
    invoiceNumber: optionalText(64),
    invoiceDate: optionalDate,
    invoiceAmount: optionalMoney,
    buyerName: optionalText(250),
    buyerGstin: optionalText(15),
    productDescription: optionalText(250),
    quantity: optionalText(20),
    uom: optionalText(16),
    eWayBillNo: optionalText(32),
    commercialProductionDate: optionalDate,
  })
  .strict();
export type FirstSaleInput = z.infer<typeof firstSaleSchema>;

/** Investment heads that must add up to the total project cost. */
export const INVESTMENT_HEADS = [
  'landCost',
  'landDevelopmentCost',
  'buildingCost',
  'plantMachineryCost',
  'electricalInstallationCost',
  'equipmentCost',
  'furnitureFixtureCost',
  'otherEligibleCost',
  'preOperativeExpenses',
] as const;

export const CAPITAL_SOURCES = [
  'promoterContribution',
  'termLoanComponent',
  'workingCapitalComponent',
  'otherSourceAmount',
] as const;

export const CASE_SECTIONS = [
  'project',
  'loan',
  'employment',
  'investment',
  'firstSale',
] as const;
export type CaseSection = (typeof CASE_SECTIONS)[number];
