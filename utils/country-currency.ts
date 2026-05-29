const EURO_COUNTRY_CODES = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
]);

const CURRENCY_BY_COUNTRY_CODE: Record<string, string> = {
  AE: 'AED',
  AR: 'ARS',
  AU: 'AUD',
  BD: 'BDT',
  BG: 'BGN',
  BH: 'BHD',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CN: 'CNY',
  CO: 'COP',
  CZ: 'CZK',
  DK: 'DKK',
  EG: 'EGP',
  GB: 'GBP',
  HK: 'HKD',
  HU: 'HUF',
  ID: 'IDR',
  IL: 'ILS',
  IN: 'INR',
  IS: 'ISK',
  JP: 'JPY',
  KE: 'KES',
  KR: 'KRW',
  KW: 'KWD',
  MA: 'MAD',
  MX: 'MXN',
  MY: 'MYR',
  NG: 'NGN',
  NO: 'NOK',
  NZ: 'NZD',
  OM: 'OMR',
  PE: 'PEN',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  QA: 'QAR',
  RO: 'RON',
  RS: 'RSD',
  RU: 'RUB',
  SA: 'SAR',
  SE: 'SEK',
  SG: 'SGD',
  TH: 'THB',
  TR: 'TRY',
  TW: 'TWD',
  TZ: 'TZS',
  UA: 'UAH',
  US: 'USD',
  VN: 'VND',
  ZA: 'ZAR',
};

const CURRENCY_BY_COUNTRY_NAME: Record<string, string> = {
  switzerland: 'CHF',
  'united kingdom': 'GBP',
  uk: 'GBP',
  usa: 'USD',
  'united states': 'USD',
  india: 'INR',
  nigeria: 'NGN',
  canada: 'CAD',
  australia: 'AUD',
};

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  switzerland: 'CH',
  'united kingdom': 'GB',
  uk: 'GB',
  usa: 'US',
  'united states': 'US',
  india: 'IN',
  nigeria: 'NG',
  canada: 'CA',
  australia: 'AU',
};

const normalizeCountryCode = (countryCode?: string | null): string => {
  return (countryCode || '').trim().toUpperCase();
};

const normalizeCountryName = (country?: string | null): string => {
  return (country || '').trim().toLowerCase();
};

export function resolveCurrencyFromCountry(input: {
  countryCode?: string | null;
  country?: string | null;
  fallbackCurrency?: string;
}): string {
  const fallbackCurrency = (input.fallbackCurrency || 'USD').trim().toUpperCase();
  const code = normalizeCountryCode(input.countryCode);
  const name = normalizeCountryName(input.country);

  if (code) {
    if (EURO_COUNTRY_CODES.has(code)) {
      return 'EUR';
    }
    if (CURRENCY_BY_COUNTRY_CODE[code]) {
      return CURRENCY_BY_COUNTRY_CODE[code];
    }
  }

  if (name) {
    const mappedCode = COUNTRY_NAME_TO_CODE[name];
    if (mappedCode) {
      if (EURO_COUNTRY_CODES.has(mappedCode)) {
        return 'EUR';
      }
      if (CURRENCY_BY_COUNTRY_CODE[mappedCode]) {
        return CURRENCY_BY_COUNTRY_CODE[mappedCode];
      }
    }

    if (CURRENCY_BY_COUNTRY_NAME[name]) {
      return CURRENCY_BY_COUNTRY_NAME[name];
    }
  }

  return fallbackCurrency;
}
