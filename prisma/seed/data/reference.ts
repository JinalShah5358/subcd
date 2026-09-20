/**
 * Reference data.
 *
 * IMPORTANT — provisional codes.
 * The district / taluka / DIC codes below are OUR codes. They are not (yet) the
 * option values the IFP portal uses: that mapping is Phase 0 work, and the
 * DropdownMapping table will translate our code to whatever the portal expects.
 * Nothing downstream should assume these strings appear on the portal.
 */

export interface DistrictSeed {
  code: string;
  name: string;
  dicCode: string;
  dicName: string;
  talukas?: string[];
}

/** All 33 districts of Gujarat. */
export const GUJARAT_DISTRICTS: DistrictSeed[] = [
  {
    code: 'GJ-AHM',
    name: 'Ahmedabad',
    dicCode: 'DIC-AHM',
    dicName: 'DIC Ahmedabad',
    talukas: [
      'Ahmedabad City', 'Daskroi', 'Sanand', 'Viramgam', 'Dholka', 'Bavla',
      'Dhandhuka', 'Detroj-Rampura', 'Mandal', 'Dholera',
    ],
  },
  { code: 'GJ-AMR', name: 'Amreli', dicCode: 'DIC-AMR', dicName: 'DIC Amreli' },
  { code: 'GJ-AND', name: 'Anand', dicCode: 'DIC-AND', dicName: 'DIC Anand' },
  { code: 'GJ-ARV', name: 'Aravalli', dicCode: 'DIC-ARV', dicName: 'DIC Aravalli' },
  { code: 'GJ-BNK', name: 'Banaskantha', dicCode: 'DIC-BNK', dicName: 'DIC Banaskantha' },
  {
    code: 'GJ-BHR',
    name: 'Bharuch',
    dicCode: 'DIC-BHR',
    dicName: 'DIC Bharuch',
    talukas: ['Bharuch', 'Ankleshwar', 'Jambusar', 'Vagra', 'Amod', 'Jhagadia', 'Hansot', 'Valia', 'Netrang'],
  },
  { code: 'GJ-BHV', name: 'Bhavnagar', dicCode: 'DIC-BHV', dicName: 'DIC Bhavnagar' },
  { code: 'GJ-BOT', name: 'Botad', dicCode: 'DIC-BOT', dicName: 'DIC Botad' },
  { code: 'GJ-CHU', name: 'Chhota Udepur', dicCode: 'DIC-CHU', dicName: 'DIC Chhota Udepur' },
  { code: 'GJ-DAH', name: 'Dahod', dicCode: 'DIC-DAH', dicName: 'DIC Dahod' },
  { code: 'GJ-DNG', name: 'Dang', dicCode: 'DIC-DNG', dicName: 'DIC Dang' },
  { code: 'GJ-DDW', name: 'Devbhoomi Dwarka', dicCode: 'DIC-DDW', dicName: 'DIC Devbhoomi Dwarka' },
  {
    code: 'GJ-GND',
    name: 'Gandhinagar',
    dicCode: 'DIC-GND',
    dicName: 'DIC Gandhinagar',
    talukas: ['Gandhinagar', 'Kalol', 'Mansa', 'Dehgam'],
  },
  { code: 'GJ-GIR', name: 'Gir Somnath', dicCode: 'DIC-GIR', dicName: 'DIC Gir Somnath' },
  { code: 'GJ-JAM', name: 'Jamnagar', dicCode: 'DIC-JAM', dicName: 'DIC Jamnagar' },
  { code: 'GJ-JUN', name: 'Junagadh', dicCode: 'DIC-JUN', dicName: 'DIC Junagadh' },
  { code: 'GJ-KHE', name: 'Kheda', dicCode: 'DIC-KHE', dicName: 'DIC Kheda' },
  {
    code: 'GJ-KUT',
    name: 'Kutch',
    dicCode: 'DIC-KUT',
    dicName: 'DIC Kutch',
    talukas: ['Bhuj', 'Anjar', 'Gandhidham', 'Mundra', 'Mandvi', 'Nakhatrana', 'Rapar', 'Bhachau', 'Abdasa', 'Lakhpat'],
  },
  { code: 'GJ-MAH', name: 'Mahisagar', dicCode: 'DIC-MAH', dicName: 'DIC Mahisagar' },
  {
    code: 'GJ-MEH',
    name: 'Mehsana',
    dicCode: 'DIC-MEH',
    dicName: 'DIC Mehsana',
    talukas: ['Mehsana', 'Kadi', 'Visnagar', 'Vijapur', 'Unjha', 'Vadnagar', 'Becharaji', 'Satlasana', 'Kheralu', 'Jotana'],
  },
  { code: 'GJ-MOR', name: 'Morbi', dicCode: 'DIC-MOR', dicName: 'DIC Morbi' },
  { code: 'GJ-NAR', name: 'Narmada', dicCode: 'DIC-NAR', dicName: 'DIC Narmada' },
  { code: 'GJ-NAV', name: 'Navsari', dicCode: 'DIC-NAV', dicName: 'DIC Navsari' },
  { code: 'GJ-PAN', name: 'Panchmahal', dicCode: 'DIC-PAN', dicName: 'DIC Panchmahal' },
  { code: 'GJ-PAT', name: 'Patan', dicCode: 'DIC-PAT', dicName: 'DIC Patan' },
  { code: 'GJ-POR', name: 'Porbandar', dicCode: 'DIC-POR', dicName: 'DIC Porbandar' },
  {
    code: 'GJ-RAJ',
    name: 'Rajkot',
    dicCode: 'DIC-RAJ',
    dicName: 'DIC Rajkot',
    talukas: ['Rajkot', 'Gondal', 'Jetpur', 'Dhoraji', 'Jasdan', 'Upleta', 'Kotda Sangani', 'Lodhika', 'Paddhari', 'Vinchhiya', 'Jamkandorna'],
  },
  { code: 'GJ-SAB', name: 'Sabarkantha', dicCode: 'DIC-SAB', dicName: 'DIC Sabarkantha' },
  {
    code: 'GJ-SUR',
    name: 'Surat',
    dicCode: 'DIC-SUR',
    dicName: 'DIC Surat',
    talukas: ['Surat City', 'Choryasi', 'Olpad', 'Kamrej', 'Palsana', 'Bardoli', 'Mahuva', 'Mangrol', 'Mandvi', 'Umarpada'],
  },
  { code: 'GJ-SRN', name: 'Surendranagar', dicCode: 'DIC-SRN', dicName: 'DIC Surendranagar' },
  { code: 'GJ-TAP', name: 'Tapi', dicCode: 'DIC-TAP', dicName: 'DIC Tapi' },
  {
    code: 'GJ-VAD',
    name: 'Vadodara',
    dicCode: 'DIC-VAD',
    dicName: 'DIC Vadodara',
    talukas: ['Vadodara', 'Savli', 'Waghodia', 'Dabhoi', 'Padra', 'Karjan', 'Sinor', 'Desar'],
  },
  {
    code: 'GJ-VAL',
    name: 'Valsad',
    dicCode: 'DIC-VAL',
    dicName: 'DIC Valsad',
    talukas: ['Valsad', 'Vapi', 'Pardi', 'Umbergaon', 'Dharampur', 'Kaprada'],
  },
];

/**
 * Document checklist catalog. Mandatory flags come from the SCHEME version,
 * not from this list — see SchemeDocumentRequirement.
 */
export interface DocumentTypeSeed {
  code: string;
  name: string;
  description: string;
  category: 'ENTITY' | 'PROMOTER' | 'PROJECT' | 'FINANCE' | 'EMPLOYMENT' | 'SALES' | 'OTHER';
  sortOrder: number;
  mandatory: boolean;
}

export const DOCUMENT_TYPES: DocumentTypeSeed[] = [
  { code: 'PAN_CARD', name: 'PAN card of the entity', description: 'Permanent Account Number card issued to the applicant entity', category: 'ENTITY', sortOrder: 10, mandatory: true },
  { code: 'GST_CERT', name: 'GST registration certificate', description: 'GST REG-06 registration certificate', category: 'ENTITY', sortOrder: 20, mandatory: true },
  { code: 'UDYAM_CERT', name: 'Udyam registration certificate', description: 'MSME Udyam registration certificate', category: 'ENTITY', sortOrder: 30, mandatory: true },
  { code: 'INCORP_DOC', name: 'Constitution document', description: 'Certificate of incorporation, partnership deed, or trust deed as applicable', category: 'ENTITY', sortOrder: 40, mandatory: true },
  { code: 'BOARD_RESOLUTION', name: 'Board resolution / authority letter', description: 'Resolution authorising the signatory to apply', category: 'ENTITY', sortOrder: 50, mandatory: false },
  { code: 'PROMOTER_PAN', name: 'PAN of promoters', description: 'PAN cards of proprietor, partners or directors', category: 'PROMOTER', sortOrder: 60, mandatory: true },
  { code: 'PROMOTER_ID', name: 'Identity proof of promoters', description: 'Identity proof as accepted by the scheme', category: 'PROMOTER', sortOrder: 70, mandatory: false },
  { code: 'LAND_DOC', name: 'Land ownership / lease document', description: 'Sale deed, allotment letter or registered lease for the project site', category: 'PROJECT', sortOrder: 80, mandatory: true },
  { code: 'BUILDING_PERMIT', name: 'Building plan approval', description: 'Approved building plan or construction permission', category: 'PROJECT', sortOrder: 90, mandatory: false },
  { code: 'POLLUTION_NOC', name: 'Pollution control consent / NOC', description: 'GPCB consent to establish or operate, where applicable', category: 'PROJECT', sortOrder: 100, mandatory: false },
  { code: 'POWER_CONNECTION', name: 'Electricity connection proof', description: 'Power connection sanction letter or latest bill', category: 'PROJECT', sortOrder: 110, mandatory: false },
  { code: 'SANCTION_LETTER', name: 'Bank sanction letter', description: 'Term loan sanction letter from the financing bank', category: 'FINANCE', sortOrder: 120, mandatory: true },
  { code: 'DISBURSEMENT_STMT', name: 'Disbursement statement', description: 'Bank statement or certificate evidencing loan disbursement', category: 'FINANCE', sortOrder: 130, mandatory: true },
  { code: 'PROJECT_REPORT', name: 'Detailed project report', description: 'DPR covering project cost, capacity and financials', category: 'FINANCE', sortOrder: 140, mandatory: true },
  { code: 'MACHINERY_INVOICE', name: 'Plant and machinery invoices', description: 'Purchase invoices for plant, machinery and equipment', category: 'FINANCE', sortOrder: 150, mandatory: true },
  { code: 'CA_CERTIFICATE', name: 'CA certificate of investment', description: 'Chartered Accountant certificate of fixed capital investment', category: 'FINANCE', sortOrder: 160, mandatory: true },
  { code: 'AUDITED_FINANCIALS', name: 'Audited financial statements', description: 'Latest audited balance sheet and profit and loss account', category: 'FINANCE', sortOrder: 170, mandatory: false },
  { code: 'EPF_REGISTRATION', name: 'EPF registration certificate', description: 'Employees Provident Fund establishment registration', category: 'EMPLOYMENT', sortOrder: 180, mandatory: false },
  { code: 'EPF_ECR', name: 'EPF electronic challan return', description: 'Recent ECR evidencing registered employee count', category: 'EMPLOYMENT', sortOrder: 190, mandatory: false },
  { code: 'FIRST_SALE_INVOICE', name: 'First sale invoice', description: 'Invoice evidencing commencement of commercial production', category: 'SALES', sortOrder: 200, mandatory: true },
  { code: 'PRODUCTION_CERT', name: 'Commercial production certificate', description: 'Certificate or declaration of date of commercial production', category: 'SALES', sortOrder: 210, mandatory: false },
  { code: 'CANCELLED_CHEQUE', name: 'Cancelled cheque', description: 'Cancelled cheque of the account for subsidy disbursement', category: 'OTHER', sortOrder: 220, mandatory: true },
];
