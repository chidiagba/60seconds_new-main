export function voucherExpiryInstant(value?:string|null):number {
 if(!value)return Infinity;
 return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T23:59:59.999Z`:value);
}
