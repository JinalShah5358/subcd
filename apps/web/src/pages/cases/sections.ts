import { AREA_TYPE, BANK_TYPE, RATE_TYPE } from '@ifp/shared';

/**
 * Declarative descriptors for the case section forms.
 *
 * Keeping the shape as data (rather than five hand-written forms) means the
 * intake form and the API's Zod schemas can be checked against each other, and
 * adding a field once Phase 0 tells us the portal needs it is a one-line change.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'money'
  | 'number'
  | 'percent'
  | 'select'
  | 'checkbox';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  maxLength?: number;
  full?: boolean;
}

export interface SectionSpec {
  key: 'project' | 'loan' | 'employment' | 'investment' | 'first-sale';
  /** Property on the case aggregate holding the saved values. */
  dataKey: 'project' | 'loan' | 'employment' | 'investment' | 'firstSale';
  title: string;
  blurb?: string;
  groups: Array<{ title?: string; fields: FieldSpec[] }>;
}

const opts = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').toLowerCase() }));

export const PROJECT_SECTION: SectionSpec = {
  key: 'project',
  dataKey: 'project',
  title: 'Project',
  blurb: 'Where the unit is, and when commercial production began.',
  groups: [
    {
      fields: [
        { name: 'projectName', label: 'Project name', type: 'text', maxLength: 250 },
        { name: 'commercialProductionDate', label: 'Commercial production date', type: 'date', hint: 'Drives eligibility window rules' },
        { name: 'isExpansion', label: 'This is an expansion of an existing unit', type: 'checkbox', full: true },
      ],
    },
    {
      title: 'Location',
      fields: [
        { name: 'addressLine1', label: 'Address line 1', type: 'text', maxLength: 200 },
        { name: 'addressLine2', label: 'Address line 2', type: 'text', maxLength: 200 },
        { name: 'village', label: 'Village / area', type: 'text', maxLength: 120 },
        { name: 'pincode', label: 'PIN code', type: 'text', maxLength: 6 },
        { name: 'gidcEstate', label: 'GIDC estate', type: 'text', maxLength: 120 },
        { name: 'plotSurveyNo', label: 'Plot / survey number', type: 'text', maxLength: 80 },
        { name: 'areaType', label: 'Area type', type: 'select', options: opts(AREA_TYPE) },
      ],
    },
  ],
};

export const LOAN_SECTION: SectionSpec = {
  key: 'loan',
  dataKey: 'loan',
  title: 'Loan & bank',
  blurb: 'The sanctioned term loan the subsidy claim relates to.',
  groups: [
    {
      title: 'Facility',
      fields: [
        { name: 'loanAccountNo', label: 'Loan account number', type: 'text', maxLength: 40, hint: 'Stored encrypted; shown masked afterwards' },
        { name: 'sanctionLetterRef', label: 'Sanction letter reference', type: 'text', maxLength: 80 },
        { name: 'purpose', label: 'Purpose', type: 'text', maxLength: 250 },
        { name: 'isTermLoan', label: 'This is a term loan', type: 'checkbox' },
      ],
    },
    {
      title: 'Dates',
      fields: [
        { name: 'sanctionDate', label: 'Sanction date', type: 'date' },
        { name: 'firstDisbursementDate', label: 'First disbursement date', type: 'date', hint: 'Primary eligibility-window anchor' },
        { name: 'lastDisbursementDate', label: 'Last disbursement date', type: 'date' },
      ],
    },
    {
      title: 'Amounts',
      fields: [
        { name: 'sanctionedAmount', label: 'Sanctioned amount', type: 'money' },
        { name: 'disbursedAmount', label: 'Disbursed amount', type: 'money' },
        { name: 'interestRatePercent', label: 'Interest rate %', type: 'percent' },
        { name: 'rateType', label: 'Rate type', type: 'select', options: opts(RATE_TYPE) },
        { name: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
        { name: 'moratoriumMonths', label: 'Moratorium (months)', type: 'number' },
      ],
    },
  ],
};

export const EMPLOYMENT_SECTION: SectionSpec = {
  key: 'employment',
  dataKey: 'employment',
  title: 'Employment',
  blurb: 'Headcount and EPF registration evidencing it.',
  groups: [
    {
      title: 'Registration',
      fields: [
        { name: 'epfEstablishmentCode', label: 'EPF establishment code', type: 'text', maxLength: 32 },
        { name: 'esicCode', label: 'ESIC code', type: 'text', maxLength: 32 },
        { name: 'asOnDate', label: 'Figures as on', type: 'date' },
      ],
    },
    {
      title: 'Headcount',
      fields: [
        { name: 'totalEmployees', label: 'Total employees', type: 'number' },
        { name: 'epfRegisteredEmployees', label: 'EPF-registered employees', type: 'number' },
        { name: 'localEmployees', label: 'Local employees', type: 'number' },
        { name: 'employmentGeneratedNew', label: 'New employment generated', type: 'number' },
        { name: 'contractEmployees', label: 'Contract employees', type: 'number' },
        { name: 'skilledCount', label: 'Skilled', type: 'number' },
        { name: 'semiSkilledCount', label: 'Semi-skilled', type: 'number' },
        { name: 'unskilledCount', label: 'Unskilled', type: 'number' },
        { name: 'maleCount', label: 'Male', type: 'number' },
        { name: 'femaleCount', label: 'Female', type: 'number' },
        { name: 'differentlyAbledCount', label: 'Differently abled', type: 'number' },
      ],
    },
  ],
};

export const INVESTMENT_SECTION: SectionSpec = {
  key: 'investment',
  dataKey: 'investment',
  title: 'Investment & capital',
  blurb: 'Eligible fixed capital investment by head, and how it is funded.',
  groups: [
    {
      title: 'Investment heads',
      fields: [
        { name: 'landCost', label: 'Land', type: 'money' },
        { name: 'landDevelopmentCost', label: 'Land development', type: 'money' },
        { name: 'buildingCost', label: 'Building', type: 'money' },
        { name: 'plantMachineryCost', label: 'Plant & machinery', type: 'money' },
        { name: 'electricalInstallationCost', label: 'Electrical installation', type: 'money' },
        { name: 'equipmentCost', label: 'Equipment', type: 'money' },
        { name: 'furnitureFixtureCost', label: 'Furniture & fixtures', type: 'money' },
        { name: 'otherEligibleCost', label: 'Other eligible cost', type: 'money' },
        { name: 'preOperativeExpenses', label: 'Pre-operative expenses', type: 'money' },
      ],
    },
    {
      title: 'Totals',
      fields: [
        { name: 'totalProjectCost', label: 'Total project cost', type: 'money' },
        { name: 'eligibleInvestmentTotal', label: 'Eligible investment total', type: 'money' },
        { name: 'subsidyClaimedAmount', label: 'Subsidy claimed', type: 'money' },
      ],
    },
    {
      title: 'Funding',
      fields: [
        { name: 'promoterContribution', label: 'Promoter contribution', type: 'money' },
        { name: 'termLoanComponent', label: 'Term loan', type: 'money' },
        { name: 'workingCapitalComponent', label: 'Working capital', type: 'money' },
        { name: 'otherSourceAmount', label: 'Other sources', type: 'money' },
      ],
    },
    {
      title: 'Machinery',
      fields: [
        { name: 'isSecondHandMachinery', label: 'Includes second-hand machinery', type: 'checkbox' },
        { name: 'machineryInvoiceCount', label: 'Number of machinery invoices', type: 'number' },
        { name: 'valuationBasis', label: 'Valuation basis', type: 'text', maxLength: 160 },
      ],
    },
  ],
};

export const FIRST_SALE_SECTION: SectionSpec = {
  key: 'first-sale',
  dataKey: 'firstSale',
  title: 'First sale',
  blurb: 'Evidence that commercial production has commenced.',
  groups: [
    {
      fields: [
        { name: 'firstSaleDate', label: 'First sale date', type: 'date' },
        { name: 'commercialProductionDate', label: 'Commercial production date', type: 'date' },
        { name: 'invoiceNumber', label: 'Invoice number', type: 'text', maxLength: 64 },
        { name: 'invoiceDate', label: 'Invoice date', type: 'date' },
        { name: 'invoiceAmount', label: 'Invoice amount', type: 'money' },
        { name: 'buyerName', label: 'Buyer name', type: 'text', maxLength: 250 },
        { name: 'buyerGstin', label: 'Buyer GSTIN', type: 'text', maxLength: 15 },
        { name: 'productDescription', label: 'Product description', type: 'text', maxLength: 250 },
        { name: 'quantity', label: 'Quantity', type: 'text', maxLength: 20 },
        { name: 'uom', label: 'Unit of measure', type: 'text', maxLength: 16 },
        { name: 'eWayBillNo', label: 'e-Way bill number', type: 'text', maxLength: 32 },
      ],
    },
  ],
};

export const BANK_TYPE_OPTIONS = opts(BANK_TYPE);

export const SECTIONS: SectionSpec[] = [
  PROJECT_SECTION,
  LOAN_SECTION,
  EMPLOYMENT_SECTION,
  INVESTMENT_SECTION,
  FIRST_SALE_SECTION,
];
