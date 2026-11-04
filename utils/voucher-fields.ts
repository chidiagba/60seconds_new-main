// Production still contains vouchers from before discount_type/discount_value existed.
export function voucherDiscountFields(row: any): { discountType: 'percentage' | 'fixed'; discountValue: number } {
  return {
    discountType: row.discount_type || (Number(row.discount_percentage) > 0 ? 'percentage' : 'fixed'),
    discountValue: Number(row.discount_value ?? (Number(row.discount_percentage) > 0 ? row.discount_percentage : row.discount_amount)),
  };
}

export function legacyVoucherFields(row: any) {
  if (row.product_id) throw new Error('Product-specific vouchers require the voucher database update. You can create a voucher for all products.');
  const { discount_type, discount_value, product_id, ...fields } = row;
  return {
    ...fields,
    ...(row.business_id ? { creator_id: row.business_id } : {}),
    ...(discount_value !== undefined ? {
      discount_percentage: discount_type === 'percentage' ? discount_value : null,
      discount_amount: discount_type === 'fixed' ? discount_value : null,
    } : {}),
  };
}

export function isLegacyVoucherSchemaError(error: any) {
  return error?.code === 'PGRST204' && /discount_type|discount_value|product_id/.test(error.message || '');
}
