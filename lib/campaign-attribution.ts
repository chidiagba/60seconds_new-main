import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'campaign_attribution_v1';
const REFERRAL_PATTERN = /^[a-z0-9][a-z0-9_-]{2,39}$/i;

export type AttributionSource = 'android_install_referrer' | 'ios_deferred_deeplink' | 'direct_deeplink' | 'manual_code' | 'organic';
export type CampaignAttribution = {
  referralCode: string;
  campaignId?: string;
  influencerId?: string;
  provider: 'signupt' | 'branch' | 'unknown';
  source: AttributionSource;
  clickTimestamp?: string;
  firstOpenTimestamp: string;
  platform: string;
  status: 'pending' | 'registered' | 'reported';
};

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 40 && REFERRAL_PATTERN.test(normalized) ? normalized : null;
}

export function parseReferralValue(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    const query = decoded.includes('?') ? decoded.slice(decoded.indexOf('?') + 1) : decoded;
    const params = new URLSearchParams(query);
    const nestedReferrer = params.get('referrer');
    if (nestedReferrer) {
      const nested = new URLSearchParams(nestedReferrer);
      const nestedCode = normalizeReferralCode(nested.get('ref'));
      if (nestedCode) return nestedCode;
    }
    return normalizeReferralCode(params.get('ref') || decoded);
  } catch {
    return null;
  }
}

export async function getCampaignAttribution(): Promise<CampaignAttribution | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as CampaignAttribution : null;
  } catch {
    return null;
  }
}

export async function saveCampaignAttribution(
  referralCode: string,
  source: AttributionSource,
  options: Partial<CampaignAttribution> = {},
  allowOverride = false,
): Promise<CampaignAttribution | null> {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;
  const existing = await getCampaignAttribution();
  if (existing?.referralCode && !allowOverride) return existing;
  const next: CampaignAttribution = {
    referralCode: code,
    provider: options.provider || (source === 'ios_deferred_deeplink' ? 'branch' : 'unknown'),
    source,
    firstOpenTimestamp: options.firstOpenTimestamp || new Date().toISOString(),
    platform: options.platform || Platform.OS,
    status: 'pending',
    ...options,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function captureReferralUrl(url: string): Promise<CampaignAttribution | null> {
  try {
    const parsed = new URL(url);
    const isTrustedCampaignUrl = parsed.protocol === 'myapp:' ||
      (parsed.protocol === 'https:' && parsed.hostname === 'signupt.com');
    if (!isTrustedCampaignUrl) return null;
    const direct = normalizeReferralCode(parsed.searchParams.get('ref') || parsed.searchParams.get('referral_code')) ||
      parseReferralValue(parsed.searchParams.get('referrer') || '');
    const pathCode = parsed.pathname.match(/^\/(?:r|ref)\/([a-z0-9_-]+)$/i)?.[1] ||
      (parsed.protocol === 'myapp:' ? parsed.hostname.match(/^(?:r|ref)-([a-z0-9_-]+)$/i)?.[1] : undefined);
    const code = direct || normalizeReferralCode(pathCode);
    return code ? saveCampaignAttribution(code, 'direct_deeplink', { provider: 'signupt' }) : null;
  } catch {
    return null;
  }
}

export async function setManualReferral(value: string): Promise<CampaignAttribution | null> {
  const code = normalizeReferralCode(value);
  return code ? saveCampaignAttribution(code, 'manual_code', { provider: 'unknown' }, true) : null;
}

export async function getSignupAttribution(value: string): Promise<CampaignAttribution | null> {
  const code = normalizeReferralCode(value);
  if (!code) return null;
  const existing = await getCampaignAttribution();
  if (existing?.referralCode === code) return existing;
  return setManualReferral(code);
}
