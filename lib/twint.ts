import { Linking } from 'react-native';

const TWINT_SCHEMES = ['twint://'];
const TWINT_WEB_BASE_URL = 'https://www.twint.ch/en/';

export type TwintLaunchParams = {
  amount: number;
  currency: string;
  reference: string;
  note?: string;
};

export const getTwintWebCheckoutUrl = (params: TwintLaunchParams): string => {
  const search = new URLSearchParams({
    amount: params.amount.toFixed(2),
    currency: params.currency.toUpperCase(),
    reference: params.reference,
    note: params.note || '',
  });

  return `${TWINT_WEB_BASE_URL}?${search.toString()}`;
};

const buildTwintDeepLinks = (params: TwintLaunchParams): string[] => {
  const search = new URLSearchParams({
    amount: params.amount.toFixed(2),
    currency: params.currency.toUpperCase(),
    reference: params.reference,
    note: params.note || '',
  });

  return [
    `twint://payment?${search.toString()}`,
    ...TWINT_SCHEMES,
  ];
};

export const canOpenTwintApp = async (): Promise<boolean> => {
  for (const scheme of TWINT_SCHEMES) {
    try {
      const supported = await Linking.canOpenURL(scheme);
      if (supported) {
        return true;
      }
    } catch {
      // Ignore and keep checking the remaining schemes.
    }
  }

  return false;
};

export const openTwintApp = async (params: TwintLaunchParams): Promise<boolean> => {
  const deepLinks = buildTwintDeepLinks(params);

  for (const link of deepLinks) {
    try {
      const supported = await Linking.canOpenURL(link);
      if (supported) {
        await Linking.openURL(link);
        return true;
      }
    } catch {
      // Ignore and try the next candidate deep link.
    }
  }

  return false;
};
