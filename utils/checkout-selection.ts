export type CheckoutItem = {productId:string;quantity:number};
export function checkoutItemsKey(items:CheckoutItem[]):string {
  const quantities=new Map<string,number>();
  for(const item of items)quantities.set(item.productId,(quantities.get(item.productId)||0)+item.quantity);
  return JSON.stringify([...quantities].sort(([a],[b])=>a.localeCompare(b)));
}
export function validatedVoucherSelection(voucher:any,quote:any,items:CheckoutItem[]) {
  if(!voucher?.id || !quote?.voucher_id || voucher.id!==quote.voucher_id || voucher.code!==quote.voucher_code)
    throw new Error('Voucher validation does not match the selected voucher');
  const priced=(quote.items || []).map((item:any)=>({productId:item.product_id,quantity:Number(item.quantity)}));
  if(checkoutItemsKey(items)!==checkoutItemsKey(priced))throw new Error('Cart changed. Validate the voucher again.');
  return {activeVoucher:voucher,checkoutQuote:quote};
}
// Never silently turn a selected voucher into an undiscounted payment request.
export function checkoutVoucherRequest(voucher:any,quote:any) {
  if(!voucher){
    if(quote?.voucher_id)throw new Error('Selected voucher was lost. Resume the original checkout or reapply it.');
    return {voucherCode:null,voucherId:null};
  }
  if(quote?.voucher_id!==voucher.id || quote?.voucher_code!==voucher.code)
    throw new Error('Selected voucher was not included in the server quote. Reapply it before paying.');
  return {voucherCode:quote.voucher_code,voucherId:quote.voucher_id};
}
