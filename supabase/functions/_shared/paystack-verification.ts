export async function verifyPaystackPayment(reference:string,key:string,request:typeof fetch=fetch) {
 if(!key||!reference)throw new Error('Payment verification is not configured');
 const response=await request(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{method:'GET',headers:{Authorization:`Bearer ${key}`}});
 const payload=await response.json().catch(()=>null);
 if(!response.ok||payload?.status!==true)throw new Error(`Payment verification unavailable (HTTP ${response.status})`);
 const transaction=payload.data;
 if(transaction?.status!=='success'||transaction.reference!==reference||!Number.isSafeInteger(transaction.amount)||transaction.amount<=0||!transaction.id||!transaction.currency)
  throw new Error('Verified successful payment required');
 return transaction;
}
