/**
 * Bank NAMES only, for the "add a bank" typeahead.
 *
 * We deliberately ship no branch directory: a stale branch/IFSC list is worse
 * than no list. Each firm creates the bank+branch rows it actually encounters,
 * and those rows are firm-scoped until curated.
 */
export const BANK_NAMES: readonly string[] = [
  'State Bank of India',
  'Bank of Baroda',
  'Punjab National Bank',
  'Canara Bank',
  'Union Bank of India',
  'Bank of India',
  'Indian Bank',
  'Central Bank of India',
  'Indian Overseas Bank',
  'UCO Bank',
  'Bank of Maharashtra',
  'Punjab & Sind Bank',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'IndusInd Bank',
  'Yes Bank',
  'IDFC FIRST Bank',
  'Federal Bank',
  'South Indian Bank',
  'Karnataka Bank',
  'RBL Bank',
  'Bandhan Bank',
  'IDBI Bank',
  'AU Small Finance Bank',
  'Equitas Small Finance Bank',
  'Ujjivan Small Finance Bank',
  'The Kalupur Commercial Co-operative Bank',
  'Saraswat Co-operative Bank',
  'Gujarat State Co-operative Bank',
  'SIDBI',
] as const;
