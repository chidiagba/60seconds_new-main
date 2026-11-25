import { withdrawalHandler } from '../_shared/withdrawals.ts';
Deno.serve(withdrawalHandler('paystack'));
