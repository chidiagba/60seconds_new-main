import { BANK_DATASET_BY_COUNTRY } from '@/utils/bank-dataset';

type AccountIdentifierType = 'iban' | 'account_number';

type SecondaryFieldType = 'routing' | 'swift' | 'none';

export type BankFieldRequirement = {
  identifierType: AccountIdentifierType;
  identifierLabel: string;
  identifierPlaceholder: string;
  identifierKeyboard: 'default' | 'number-pad';
  secondaryFieldType: SecondaryFieldType;
  secondaryLabel: string;
  secondaryPlaceholder: string;
  secondaryRequired: boolean;
  swiftOptionalLabel?: string;
};

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

const normalizeCountryCode = (countryCode?: string | null): string => {
  return (countryCode || '').trim().toUpperCase();
};

export const normalizeIban = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

export const isValidIban = (value: string): boolean => {
  const normalized = normalizeIban(value);
  return /^[A-Z]{2}[0-9A-Z]{13,34}$/.test(normalized);
};

export const normalizeSwift = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

export const isValidSwift = (value: string): boolean => {
  const normalized = normalizeSwift(value);
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalized);
};

export function getBankFieldRequirement(countryCode?: string | null): BankFieldRequirement {
  const code = normalizeCountryCode(countryCode);

  if (code === 'US') {
    return {
      identifierType: 'account_number',
      identifierLabel: 'Account Number',
      identifierPlaceholder: 'Enter account number',
      identifierKeyboard: 'number-pad',
      secondaryFieldType: 'routing',
      secondaryLabel: 'Routing Number (ABA)',
      secondaryPlaceholder: 'Enter routing number',
      secondaryRequired: true,
      swiftOptionalLabel: 'SWIFT Code (optional for international transfers)',
    };
  }

  if (code === 'GB') {
    return {
      identifierType: 'account_number',
      identifierLabel: 'Account Number',
      identifierPlaceholder: 'Enter account number',
      identifierKeyboard: 'number-pad',
      secondaryFieldType: 'routing',
      secondaryLabel: 'Sort Code',
      secondaryPlaceholder: 'Enter sort code',
      secondaryRequired: true,
      swiftOptionalLabel: 'SWIFT/BIC (optional)',
    };
  }

  if (code === 'CA') {
    return {
      identifierType: 'account_number',
      identifierLabel: 'Account Number',
      identifierPlaceholder: 'Enter account number',
      identifierKeyboard: 'number-pad',
      secondaryFieldType: 'routing',
      secondaryLabel: 'Transit / Routing Number',
      secondaryPlaceholder: 'Enter transit or routing number',
      secondaryRequired: true,
      swiftOptionalLabel: 'SWIFT Code (optional)',
    };
  }

  if (code === 'NG') {
    return {
      identifierType: 'account_number',
      identifierLabel: 'Account Number',
      identifierPlaceholder: 'Enter NUBAN account number',
      identifierKeyboard: 'number-pad',
      secondaryFieldType: 'routing',
      secondaryLabel: 'Bank Code (optional)',
      secondaryPlaceholder: 'Enter bank code if you know it',
      secondaryRequired: false,
      swiftOptionalLabel: 'SWIFT Code (optional)',
    };
  }

  if (code === 'PK') {
    return {
      identifierType: 'iban',
      identifierLabel: 'IBAN',
      identifierPlaceholder: 'PK36SCBL0000001123456702',
      identifierKeyboard: 'default',
      secondaryFieldType: 'swift',
      secondaryLabel: 'SWIFT / BIC Code',
      secondaryPlaceholder: 'e.g. NBPAPKKA',
      secondaryRequired: true,
    };
  }

  if (EU_COUNTRY_CODES.has(code)) {
    return {
      identifierType: 'iban',
      identifierLabel: 'IBAN',
      identifierPlaceholder: 'Enter your IBAN',
      identifierKeyboard: 'default',
      secondaryFieldType: 'swift',
      secondaryLabel: 'SWIFT / BIC Code',
      secondaryPlaceholder: 'Optional for many EU domestic transfers',
      secondaryRequired: false,
    };
  }

  return {
    identifierType: 'iban',
    identifierLabel: 'IBAN',
    identifierPlaceholder: 'Enter your IBAN',
    identifierKeyboard: 'default',
    secondaryFieldType: 'swift',
    secondaryLabel: 'SWIFT / BIC Code',
    secondaryPlaceholder: 'Required for international settlement',
    secondaryRequired: true,
  };
}

export function getBanksForCountry(countryCode?: string | null): string[] {
  const code = normalizeCountryCode(countryCode);
  if (!code) {
    return ['Other / Manual Entry'];
  }

  return BANK_DATASET_BY_COUNTRY[code] || ['Other / Manual Entry'];
}
