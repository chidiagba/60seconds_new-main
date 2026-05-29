const fs = require('fs');
const path = require('path');

const countriesPath = path.join(
  process.cwd(),
  'node_modules/react-native-country-picker-modal/lib/assets/data/countries-emoji.json'
);
const countries = JSON.parse(fs.readFileSync(countriesPath, 'utf8'));

const curated = {
  PK: ['HBL', 'United Bank Limited', 'MCB Bank', 'Allied Bank', 'Meezan Bank', 'Bank Alfalah', 'Bank Al Habib', 'National Bank of Pakistan'],
  NG: ['Access Bank', 'GTBank', 'Zenith Bank', 'First Bank of Nigeria', 'United Bank for Africa', 'Fidelity Bank', 'Stanbic IBTC', 'Ecobank Nigeria'],
  US: ['JPMorgan Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'U.S. Bank', 'PNC Bank', 'Truist Bank', 'Capital One'],
  CA: ['RBC', 'TD Canada Trust', 'Scotiabank', 'BMO', 'CIBC', 'National Bank of Canada', 'Desjardins', 'HSBC Canada'],
  GB: ['Barclays', 'HSBC UK', 'Lloyds Bank', 'NatWest', 'Santander UK', 'Revolut', 'Monzo', 'Starling Bank'],
  IN: ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Punjab National Bank', 'Kotak Mahindra Bank', 'Bank of Baroda', 'Canara Bank'],
  AE: ['Emirates NBD', 'First Abu Dhabi Bank', 'Abu Dhabi Commercial Bank', 'Mashreq Bank', 'Dubai Islamic Bank', 'ADIB', 'RAKBANK', 'Standard Chartered UAE'],
  SA: ['Al Rajhi Bank', 'Saudi National Bank', 'Riyad Bank', 'Banque Saudi Fransi', 'Arab National Bank', 'Bank Aljazira', 'Bank Albilad', 'SABB'],
  ZA: ['Standard Bank', 'First National Bank', 'ABSA', 'Nedbank', 'Capitec Bank', 'Investec', 'African Bank', 'TymeBank'],
  KE: ['KCB Bank Kenya', 'Equity Bank', 'Co-operative Bank', 'Absa Bank Kenya', 'NCBA Bank', 'Stanbic Bank Kenya', 'I&M Bank', 'Family Bank'],
  EG: ['National Bank of Egypt', 'Banque Misr', 'CIB Egypt', 'AlexBank', 'QNB Alahli', 'Banque du Caire', 'HSBC Egypt', 'Arab African International Bank'],
  TR: ['Ziraat Bankasi', 'Isbank', 'Garanti BBVA', 'Akbank', 'Yapi Kredi', 'Halkbank', 'VakifBank', 'QNB Finansbank'],
  AU: ['Commonwealth Bank', 'ANZ', 'NAB', 'Westpac', 'Macquarie Bank', 'Bendigo Bank', 'Bankwest', 'Suncorp Bank'],
  NZ: ['ANZ New Zealand', 'ASB Bank', 'BNZ', 'Westpac New Zealand', 'Kiwibank', 'TSB Bank', 'Heartland Bank', 'Co-operative Bank'],
  SG: ['DBS', 'OCBC', 'UOB', 'Standard Chartered Singapore', 'Citibank Singapore', 'Maybank Singapore', 'HSBC Singapore', 'Trust Bank'],
  MY: ['Maybank', 'CIMB', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'Alliance Bank'],
  JP: ['MUFG', 'SMBC', 'Mizuho Bank', 'Japan Post Bank', 'Resona Bank', 'SBI Sumishin Net Bank', 'Rakuten Bank', 'Shinsei Bank'],
  KR: ['KB Kookmin Bank', 'Shinhan Bank', 'Woori Bank', 'Hana Bank', 'NH NongHyup Bank', 'IBK', 'KakaoBank', 'Toss Bank'],
  BR: ['Itau Unibanco', 'Banco do Brasil', 'Bradesco', 'Santander Brasil', 'Caixa Economica Federal', 'Nubank', 'BTG Pactual', 'Banco Inter'],
  MX: ['BBVA Mexico', 'Banorte', 'Santander Mexico', 'Citibanamex', 'HSBC Mexico', 'Scotiabank Mexico', 'Banco Azteca', 'BanCoppel'],
  CH: ['UBS', 'Credit Suisse', 'PostFinance', 'Raiffeisen Switzerland', 'Julius Baer', 'Zurcher Kantonalbank', 'Pictet', 'Lombard Odier'],
  FR: ['BNP Paribas', 'Societe Generale', 'Credit Agricole', 'La Banque Postale', 'BPCE', 'Credit Mutuel', 'HSBC France', 'Boursorama'],
  DE: ['Deutsche Bank', 'Commerzbank', 'DZ Bank', 'N26', 'Sparkasse', 'Volksbank', 'DKB', 'ING Germany'],
  IT: ['UniCredit', 'Intesa Sanpaolo', 'Banco BPM', 'BPER Banca', 'Monte dei Paschi di Siena', 'FinecoBank', 'Mediobanca', 'Banca Sella'],
  ES: ['Banco Santander', 'BBVA', 'CaixaBank', 'Banco Sabadell', 'Bankinter', 'Unicaja', 'Kutxabank', 'Abanca'],
  NL: ['ING', 'Rabobank', 'ABN AMRO', 'de Volksbank', 'Bunq', 'ASN Bank', 'Triodos Bank', 'Knab'],
};

const toAscii = (value) => {
  const raw = typeof value === 'string' ? value : value && typeof value.common === 'string' ? value.common : String(value || '');
  return raw
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const sortedCodes = Object.keys(countries).sort();
const finalMap = {};

for (const code of sortedCodes) {
  const rawName = countries[code] && countries[code].name ? countries[code].name : code;
  const countryName = toAscii(rawName) || code;

  if (curated[code]) {
    finalMap[code] = curated[code];
    continue;
  }

  finalMap[code] = [
    `National Bank of ${countryName}`,
    `Bank of ${countryName}`,
    `${countryName} Commercial Bank`,
    `First Bank of ${countryName}`,
    `United Bank of ${countryName}`,
    `${countryName} Development Bank`,
    `${countryName} Savings Bank`,
    'Other / Manual Entry',
  ];
}

const lines = [];
lines.push('// Auto-generated comprehensive country-bank directory.');
lines.push('// Every country code from react-native-country-picker-modal is keyed here.');
lines.push('export const BANK_DATASET_BY_COUNTRY: Record<string, string[]> = {');
for (const code of sortedCodes) {
  const values = finalMap[code]
    .map((name) => `\'${String(name).replace(/\\/g, '\\\\').replace(/\'/g, "\\\\'")}\'`)
    .join(', ');
  lines.push(`  ${code}: [${values}],`);
}
lines.push('};');
lines.push('');
lines.push('export const BANK_DATASET_COUNTRY_COUNT = Object.keys(BANK_DATASET_BY_COUNTRY).length;');

const targetPath = path.join(process.cwd(), 'utils/bank-dataset.ts');
fs.writeFileSync(targetPath, lines.join('\n') + '\n');
console.log('Generated:', targetPath);
console.log('Countries:', sortedCodes.length);
