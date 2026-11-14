import { disabledProcedure } from '../../../create-context';
// Providers send signed raw HTTP requests to /api/paystack/webhook.
export const handleWebhookProcedure = disabledProcedure.mutation(() => ({ success: false }));
