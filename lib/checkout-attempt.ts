import {checkoutItemsKey,CheckoutItem} from '../utils/checkout-selection';
type Storage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>;removeItem:(key:string)=>Promise<void>};
export function checkoutAttemptStorageKey(userId:string,items:CheckoutItem[]) {
 if(!userId)throw new Error('Sign in before checkout');
 return `checkout-attempt-v1:${userId}:${checkoutItemsKey(items)}`;
}
export async function loadCheckoutAttempt(storage:Storage,userId:string,items:CheckoutItem[],createKey:()=>string) {
 const storageKey=checkoutAttemptStorageKey(userId,items);
 const saved=await storage.getItem(storageKey);
 if(saved){
  const attempt=JSON.parse(saved);
  if(typeof attempt.requestKey!=='string'||attempt.requestKey.length<8)throw new Error('Stored checkout needs recovery. Check your orders before paying again.');
  return {storageKey,requestKey:attempt.requestKey as string};
 }
 const requestKey=createKey();
 // Persist before any request can reserve stock or accept money.
 await storage.setItem(storageKey,JSON.stringify({requestKey}));
 return {storageKey,requestKey};
}
