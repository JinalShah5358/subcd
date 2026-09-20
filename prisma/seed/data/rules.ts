/**
 * Seed validation rules.
 *
 * TWO CLASSES OF RULE, and the difference matters:
 *
 *   STRUCTURAL  (sourceReference: null, status: ACTIVE)
 *     Format checks, arithmetic consistency, internal date ordering. These are
 *     true regardless of what any government resolution says, so they ship on.
 *
 *   SCHEME POLICY (status: DRAFT until a citation is added)
 *     Eligibility windows, employment ratios, claim limits. These depend on the
 *     governing resolution, which has NOT been read yet. They are seeded as
 *     DRAFT with sourceReference null, so the engine does not run them and the
 *     platform never asserts an eligibility rule it cannot cite.
 *     Task XC-007 / P0-018: read the GR, set params, add the citation, activate.
 *
 * An expression evaluates TRUE when the rule PASSES. A finding is raised on FALSE.
 */

export type RuleExpr = Record<string, unknown>;

export interface RuleSeed {
  code: string;
  name: string;
  category:
    | 'FORMAT'
    | 'REQUIRED'
    | 'DATE_WINDOW'
    | 'CONSISTENCY'
    | 'RATIO'
    | 'DUPLICATE'
    | 'DOCUMENT'
    | 'CROSS_FIELD';
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  status: 'ACTIVE' | 'DRAFT';
  expression: RuleExpr;
  params?: Record<string, unknown>;
  messageTemplate: string;
  remediationHint?: string;
  sourceReference?: string | null;
  fieldCode?: string | null;
  section?: string | null;
}

export const VALIDATION_RULES: RuleSeed[] = [
  /* ----------------------------- structural: format ----------------------------- */
  {
    code: 'PAN_FORMAT',
    name: 'Entity PAN format',
    category: 'FORMAT',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'client.pan' },
        { op: 'matchesRegex', field: 'client.pan', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
      ],
    },
    messageTemplate: 'Entity PAN is not in the standard format (5 letters, 4 digits, 1 letter).',
    remediationHint: 'Open the client record and correct the PAN.',
    fieldCode: 'client.pan',
    section: 'ENTITY',
  },
  {
    code: 'GSTIN_FORMAT',
    name: 'GSTIN format and check digit',
    category: 'FORMAT',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [{ op: 'isBlank', field: 'client.gstin' }, { op: 'isTrue', field: 'client.gstinValid' }],
    },
    messageTemplate: 'GSTIN is not valid — the format or the check digit does not match.',
    remediationHint: 'Re-enter the GSTIN exactly as printed on the registration certificate.',
    fieldCode: 'client.gstin',
    section: 'ENTITY',
  },
  {
    code: 'GSTIN_PAN_CONSISTENT',
    name: 'GSTIN embeds the entity PAN',
    category: 'CROSS_FIELD',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'client.gstin' },
        { op: 'isBlank', field: 'client.pan' },
        { op: 'equalsField', field: 'client.gstinEmbeddedPan', otherField: 'client.pan' },
      ],
    },
    messageTemplate: 'The PAN inside the GSTIN does not match the entity PAN.',
    remediationHint: 'One of the two is mistyped — check both against the source documents.',
    fieldCode: 'client.gstin',
    section: 'ENTITY',
  },
  {
    code: 'UDYAM_FORMAT',
    name: 'Udyam registration format',
    category: 'FORMAT',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'client.udyam' },
        { op: 'matchesRegex', field: 'client.udyam', pattern: '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' },
      ],
    },
    messageTemplate: 'Udyam number does not look like UDYAM-GJ-01-0000000.',
    fieldCode: 'client.udyam',
    section: 'ENTITY',
  },
  {
    code: 'PAN_ENTITY_TYPE_CHAR',
    name: 'PAN holder-type character matches entity type',
    category: 'CROSS_FIELD',
    severity: 'INFO',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'client.pan' },
        { op: 'isTrue', field: 'client.panEntityCharMatches' },
      ],
    },
    messageTemplate: 'The 4th character of the PAN does not match the selected entity type.',
    remediationHint: 'This is a convention, not a rule — confirm the entity type is right.',
    fieldCode: 'client.pan',
    section: 'ENTITY',
  },

  /* --------------------------- structural: required ---------------------------- */
  {
    code: 'CLIENT_PAN_REQUIRED',
    name: 'Entity PAN is captured',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isPresent', field: 'client.pan' },
    messageTemplate: 'Entity PAN has not been captured.',
    fieldCode: 'client.pan',
    section: 'ENTITY',
  },
  {
    code: 'APPLICATION_DATE_REQUIRED',
    name: 'Application date is captured',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isPresent', field: 'case.applicationDate' },
    messageTemplate: 'Application date has not been set on the case.',
    fieldCode: 'case.applicationDate',
    section: 'CASE',
  },
  {
    code: 'PROJECT_BASICS_REQUIRED',
    name: 'Project name and district are captured',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'and',
      args: [
        { op: 'isPresent', field: 'project.projectName' },
        { op: 'isPresent', field: 'project.districtCode' },
      ],
    },
    messageTemplate: 'Project name and district are required.',
    fieldCode: 'project.projectName',
    section: 'PROJECT',
  },
  {
    code: 'LOAN_BANK_REQUIRED',
    name: 'Financing bank is selected',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isPresent', field: 'loan.bankId' },
    messageTemplate: 'The financing bank and branch have not been selected.',
    fieldCode: 'loan.bankId',
    section: 'LOAN',
  },
  {
    code: 'INVESTMENT_TOTAL_REQUIRED',
    name: 'Total project cost is captured',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isPresent', field: 'investment.totalProjectCost' },
    messageTemplate: 'Total project cost has not been entered.',
    fieldCode: 'investment.totalProjectCost',
    section: 'INVESTMENT',
  },
  {
    code: 'PRIMARY_PROMOTER_REQUIRED',
    name: 'A primary promoter is identified',
    category: 'REQUIRED',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: { op: 'isTrue', field: 'promoter.primaryExists' },
    messageTemplate: 'No promoter has been marked as the primary contact.',
    section: 'PROMOTER',
  },

  /* -------------------------- structural: consistency -------------------------- */
  {
    code: 'DATE_ORDER_SANITY',
    name: 'Key dates are in a possible order',
    category: 'CONSISTENCY',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'and',
      args: [
        { op: 'dateOrder', earlier: 'loan.sanctionDate', later: 'loan.firstDisbursementDate', orEqual: true },
        { op: 'dateOrder', earlier: 'loan.firstDisbursementDate', later: 'loan.lastDisbursementDate', orEqual: true },
        { op: 'dateOrder', earlier: 'project.commercialProductionDate', later: 'firstSale.firstSaleDate', orEqual: true },
      ],
    },
    messageTemplate: 'Sanction, disbursement, production and first-sale dates are not in a possible order.',
    remediationHint: 'Check each date against its source document.',
    section: 'LOAN',
  },
  {
    code: 'DATES_NOT_IN_FUTURE',
    name: 'Recorded dates are not in the future',
    category: 'CONSISTENCY',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'noneInFuture',
      fields: [
        'loan.sanctionDate',
        'loan.firstDisbursementDate',
        'loan.lastDisbursementDate',
        'firstSale.firstSaleDate',
        'firstSale.invoiceDate',
        'project.commercialProductionDate',
      ],
    },
    messageTemplate: 'One or more recorded dates is in the future.',
    section: 'CASE',
  },
  {
    code: 'INVESTMENT_SUM_MATCH',
    name: 'Investment heads add up to the total project cost',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'sumEquals',
      fields: [
        'investment.landCost',
        'investment.landDevelopmentCost',
        'investment.buildingCost',
        'investment.plantMachineryCost',
        'investment.electricalInstallationCost',
        'investment.equipmentCost',
        'investment.furnitureFixtureCost',
        'investment.otherEligibleCost',
        'investment.preOperativeExpenses',
      ],
      totalField: 'investment.totalProjectCost',
      tolerance: { param: 'tolerance' },
    },
    params: { tolerance: 1 },
    messageTemplate: 'The investment heads do not add up to the total project cost.',
    remediationHint: 'Check each head against the project report.',
    fieldCode: 'investment.totalProjectCost',
    section: 'INVESTMENT',
  },
  {
    code: 'CAPITAL_STRUCTURE_MATCH',
    name: 'Funding sources add up to the total project cost',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'sumEquals',
      fields: [
        'investment.promoterContribution',
        'investment.termLoanComponent',
        'investment.workingCapitalComponent',
        'investment.otherSourceAmount',
      ],
      totalField: 'investment.totalProjectCost',
      tolerance: { param: 'tolerance' },
    },
    params: { tolerance: 1 },
    messageTemplate: 'Promoter contribution, loan and other sources do not add up to the total project cost.',
    fieldCode: 'investment.promoterContribution',
    section: 'INVESTMENT',
  },
  {
    code: 'DISBURSED_LTE_SANCTIONED',
    name: 'Disbursed amount does not exceed sanctioned',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'lteField',
      field: 'loan.disbursedAmount',
      otherField: 'loan.sanctionedAmount',
    },
    messageTemplate: 'Disbursed amount is greater than the sanctioned amount.',
    remediationHint: 'A top-up facility can explain this — confirm against the bank statement.',
    fieldCode: 'loan.disbursedAmount',
    section: 'LOAN',
  },
  {
    code: 'EPF_LTE_TOTAL_EMPLOYEES',
    name: 'EPF-registered count does not exceed total employees',
    category: 'CONSISTENCY',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: {
      op: 'lteField',
      field: 'employment.epfRegisteredEmployees',
      otherField: 'employment.totalEmployees',
    },
    messageTemplate: 'EPF-registered employees exceed the total employee count.',
    fieldCode: 'employment.epfRegisteredEmployees',
    section: 'EMPLOYMENT',
  },
  {
    code: 'OWNERSHIP_SUM_100',
    name: 'Promoter ownership adds up to 100%',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'promoter.ownershipSum' },
        { op: 'numberBetween', field: 'promoter.ownershipSum', min: 99.5, max: 100.5 },
      ],
    },
    messageTemplate: 'Promoter ownership percentages do not add up to 100%.',
    section: 'PROMOTER',
  },
  {
    code: 'DUPLICATE_LOAN_ACCOUNT',
    name: 'Loan account is not already claimed on another case',
    category: 'DUPLICATE',
    severity: 'WARNING',
    status: 'ACTIVE',
    expression: { op: 'isFalse', field: 'case.hasDuplicateLoanAccount' },
    messageTemplate: 'This loan account is already recorded on another case for this firm.',
    remediationHint: 'Confirm this is a genuinely separate claim before filing.',
    fieldCode: 'loan.loanAccountNo',
    section: 'LOAN',
  },

  /* ------------------------ structural: documents & consent -------------------- */
  {
    code: 'REQUIRED_DOCUMENTS',
    name: 'All mandatory documents accounted for',
    category: 'DOCUMENT',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isTrue', field: 'documents.allMandatoryAccountedFor' },
    messageTemplate: 'Some mandatory documents are still marked as required.',
    remediationHint: 'Mark each as present, not available, or not applicable on the checklist.',
    section: 'DOCUMENTS',
  },
  {
    code: 'CONSENT_RECORDED',
    name: 'Client authorization has been recorded',
    category: 'REQUIRED',
    severity: 'BLOCKING',
    status: 'ACTIVE',
    expression: { op: 'isTrue', field: 'consent.active' },
    messageTemplate: 'No active client authorization has been recorded for this case.',
    remediationHint: 'Complete the consent step before moving the case to ready-to-file.',
    section: 'CONSENT',
  },

  /* ---------------------- SCHEME POLICY — DRAFT until cited -------------------- */
  {
    code: 'APP_DATE_AFTER_DISBURSEMENT',
    name: 'Application filed within the window after first disbursement',
    category: 'DATE_WINDOW',
    severity: 'BLOCKING',
    status: 'DRAFT',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'case.applicationDate' },
        { op: 'isBlank', field: 'loan.firstDisbursementDate' },
        {
          op: 'and',
          args: [
            { op: 'dateOrder', earlier: 'loan.firstDisbursementDate', later: 'case.applicationDate', orEqual: true },
            {
              op: 'dateWithinMonths',
              field: 'case.applicationDate',
              fromField: 'loan.firstDisbursementDate',
              maxMonths: { param: 'windowMonths' },
            },
          ],
        },
      ],
    },
    params: { windowMonths: 12 },
    messageTemplate:
      'Application date is outside the eligibility window measured from first disbursement.',
    remediationHint: 'Confirm the window length against the governing resolution before relying on this.',
    sourceReference: null,
    fieldCode: 'case.applicationDate',
    section: 'CASE',
  },
  {
    code: 'APP_DATE_VS_PRODUCTION',
    name: 'Application filed within the window after commercial production',
    category: 'DATE_WINDOW',
    severity: 'BLOCKING',
    status: 'DRAFT',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'case.applicationDate' },
        { op: 'isBlank', field: 'project.commercialProductionDate' },
        {
          op: 'dateWithinMonths',
          field: 'case.applicationDate',
          fromField: 'project.commercialProductionDate',
          maxMonths: { param: 'windowMonths' },
        },
      ],
    },
    params: { windowMonths: 12 },
    messageTemplate:
      'Application date is outside the eligibility window measured from commercial production.',
    sourceReference: null,
    fieldCode: 'case.applicationDate',
    section: 'CASE',
  },
  {
    code: 'EPF_RATIO',
    name: 'EPF-registered employment ratio',
    category: 'RATIO',
    severity: 'WARNING',
    status: 'DRAFT',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'employment.totalEmployees' },
        {
          op: 'ratioAtLeast',
          numerator: 'employment.epfRegisteredEmployees',
          denominator: 'employment.totalEmployees',
          min: { param: 'minRatio' },
        },
      ],
    },
    params: { minRatio: 0.8 },
    messageTemplate: 'EPF-registered headcount is below the ratio the scheme expects.',
    sourceReference: null,
    fieldCode: 'employment.epfRegisteredEmployees',
    section: 'EMPLOYMENT',
  },
  {
    code: 'LOCAL_EMPLOYMENT_RATIO',
    name: 'Local employment ratio',
    category: 'RATIO',
    severity: 'WARNING',
    status: 'DRAFT',
    expression: {
      op: 'or',
      args: [
        { op: 'isBlank', field: 'employment.totalEmployees' },
        {
          op: 'ratioAtLeast',
          numerator: 'employment.localEmployees',
          denominator: 'employment.totalEmployees',
          min: { param: 'minRatio' },
        },
      ],
    },
    params: { minRatio: 0.85 },
    messageTemplate: 'Local employment is below the ratio the scheme expects.',
    sourceReference: null,
    fieldCode: 'employment.localEmployees',
    section: 'EMPLOYMENT',
  },
  {
    code: 'TERM_LOAN_EXPECTED',
    name: 'Facility is a term loan',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'DRAFT',
    expression: { op: 'isTrue', field: 'loan.isTermLoan' },
    messageTemplate: 'The recorded facility is not a term loan, which the scheme may not cover.',
    sourceReference: null,
    fieldCode: 'loan.isTermLoan',
    section: 'LOAN',
  },
  {
    code: 'FIRST_SALE_REQUIRED',
    name: 'First sale evidence is captured',
    category: 'REQUIRED',
    severity: 'WARNING',
    status: 'DRAFT',
    expression: {
      op: 'and',
      args: [
        { op: 'isPresent', field: 'firstSale.firstSaleDate' },
        { op: 'isPresent', field: 'firstSale.invoiceNumber' },
      ],
    },
    messageTemplate: 'First sale date and invoice number have not been captured.',
    sourceReference: null,
    section: 'FIRST_SALE',
  },
  {
    code: 'SUBSIDY_CLAIM_LTE_ELIGIBLE',
    name: 'Subsidy claimed does not exceed eligible investment',
    category: 'CONSISTENCY',
    severity: 'WARNING',
    status: 'DRAFT',
    expression: {
      op: 'lteField',
      field: 'investment.subsidyClaimedAmount',
      otherField: 'investment.eligibleInvestmentTotal',
    },
    messageTemplate: 'Subsidy claimed is greater than the eligible investment recorded.',
    sourceReference: null,
    fieldCode: 'investment.subsidyClaimedAmount',
    section: 'INVESTMENT',
  },
];

/** Placeholder consent wording. Deliberately marked as not legally reviewed. */
export const CONSENT_TEMPLATE_DRAFT = {
  code: 'SUBSIDY_FILING_AUTH',
  versionLabel: 'v0.1-draft',
  language: 'en',
  purposeCodes: ['SUBSIDY_FILING', 'DOCUMENT_STORAGE'],
  bodyText: `DRAFT — NOT LEGALLY REVIEWED.

I confirm that this firm has been engaged by the client named in this case, and
that the client has authorised us to collect, hold and use the information
recorded here for the purpose of preparing and filing their application for
subsidy under the scheme identified on this case.

I confirm that:
 1. The information was obtained from the client or from documents the client
    provided to us.
 2. The client has been informed that this information is stored in this
    platform on the firm's behalf for the purpose stated above.
 3. The client may ask us to correct or withdraw this information at any time.
 4. I remain responsible for reviewing and submitting the application on the
    government portal myself.

This wording is a placeholder produced by the engineering team. It must be
replaced with text reviewed by the firm's legal adviser before this platform is
used with real client data. See tasks XC-003 and XC-004.`,
};
