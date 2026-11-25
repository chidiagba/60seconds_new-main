/** Replay bank payouts at their effective date so missing historical credits
 * cannot turn an old payout into a debt against future purchases. */
export function calculateOwnerWalletBalance(rows: ReadonlyArray<{
  amount?: number; type?: string; status?: string;
  created_at?: string; createdAt?: string; metadata?: Record<string, any>;
}>, includeLegacyEntries = false): number {
  const time = (row: typeof rows[number]) => {
    const value = row.metadata?.entry === 'paystack_bank_settlement'
      ? row.metadata?.settlement_date || row.created_at || row.createdAt
      : row.created_at || row.createdAt;
    return Date.parse(value || '') || 0;
  };
  const ordered = [...rows].sort((a, b) => time(a) - time(b) ||
    Number(a.metadata?.entry === 'paystack_bank_settlement') -
    Number(b.metadata?.entry === 'paystack_bank_settlement'));
  let balance = 0;
  for (const row of ordered) {
    if (!['completed', 'success', 'successful', 'paid'].includes(String(row.status || '').trim().toLowerCase()) && !(row.status==='pending' && row.metadata?.entry==='owner_withdrawal')) continue;
    const amount = Math.round(Number(row.amount || 0) * 100);
    if (!Number.isFinite(amount)) continue;
    const entry = String(row.metadata?.entry || '').trim();
    if (entry === 'owner_credit' || entry === 'wallet_funding') balance += Math.max(0, amount);
    else if (entry === 'paystack_bank_settlement') balance = Math.max(0, balance - Math.abs(amount));
    else if (entry === 'owner_withdrawal' || row.type === 'withdrawal') balance -= Math.abs(amount);
    else if (includeLegacyEntries && row.type !== 'fee' && entry !== 'buyer_debit') {
      const description = String((row as { description?: string }).description || '').toLowerCase();
      const provider = String(row.metadata?.paymentProvider || row.metadata?.payment_provider || '').toLowerCase();
      const purchaseDebit = amount < 0 && (provider === 'paystack' ||
        description.includes('paystack purchase') || description.includes('purchase (backfill)'));
      if (!purchaseDebit) balance += amount;
    }
  }
  return Math.max(0, balance) / 100;
}
