import { createTRPCRouter } from "./create-context";
import hiRoute from "./routes/example/hi/route";
import { initializePaymentProcedure } from "./routes/paystack/initialize/route";
import { verifyPaymentProcedure } from "./routes/paystack/verify/route";
import { handleWebhookProcedure } from "./routes/paystack/webhook/route";
import { createCustomerProcedure, getCustomerProcedure } from "./routes/paystack/customers/route";
import { initializePaymentProcedure as worldlineInitializeProcedure } from "./routes/worldline/initialize/route";
import { verifyPaymentProcedure as worldlineVerifyProcedure } from "./routes/worldline/verify/route";
import { webhookProcedure as worldlineWebhookProcedure } from "./routes/worldline/webhook/route";
import { createCustomerProcedure as worldlineCreateCustomerProcedure } from "./routes/worldline/create-customer/route";
import { getCustomerProcedure as worldlineGetCustomerProcedure } from "./routes/worldline/get-customer/route";
import { directCardPaymentProcedure } from "./routes/worldline/direct-card-payment/route";
import { getPaymentMethodsProcedure } from "./routes/worldline/get-payment-methods/route";
import { deletePaymentMethodProcedure } from "./routes/worldline/delete-payment-method/route";
import { setDefaultPaymentMethodProcedure } from "./routes/worldline/set-default-payment-method/route";
import { getPaymentHistoryProcedure } from "./routes/worldline/get-payment-history/route";
import { createSessionProcedure } from "./routes/worldline/create-session/route";
import { initializePaymentProcedure as datatransInitializeProcedure } from "./routes/datatrans/initialize/route";
import { verifyPaymentProcedure as datatransVerifyProcedure } from "./routes/datatrans/verify/route";
import { directCardPaymentProcedure as datatransDirectCardPaymentProcedure } from "./routes/datatrans/direct-card-payment/route";
import { generateOrderPDFProcedure } from "./routes/orders/generate-pdf/route";
import { getUserOrderPDFsProcedure } from "./routes/orders/get-user-pdfs/route";
import { sendGuestOrderEmailProcedure } from "./routes/emails/send-guest-order/route";
import { sendWelcomeEmailProcedure } from "./routes/emails/send-welcome/route";
import { deleteAccountProcedure } from "./routes/account/delete/route";

export const appRouter = createTRPCRouter({
  example: createTRPCRouter({
    hi: hiRoute,
  }),
  paystack: createTRPCRouter({
    initialize: initializePaymentProcedure,
    verify: verifyPaymentProcedure,
    webhook: handleWebhookProcedure,
    createCustomer: createCustomerProcedure,
    getCustomer: getCustomerProcedure,
  }),
  worldline: createTRPCRouter({
    initialize: worldlineInitializeProcedure,
    verify: worldlineVerifyProcedure,
    webhook: worldlineWebhookProcedure,
    createCustomer: worldlineCreateCustomerProcedure,
    getCustomer: worldlineGetCustomerProcedure,
    directCardPayment: directCardPaymentProcedure,
    getPaymentMethods: getPaymentMethodsProcedure,
    deletePaymentMethod: deletePaymentMethodProcedure,
    setDefaultPaymentMethod: setDefaultPaymentMethodProcedure,
    getPaymentHistory: getPaymentHistoryProcedure,
    createSession: createSessionProcedure,
  }),
  datatrans: createTRPCRouter({
    initialize: datatransInitializeProcedure,
    verify: datatransVerifyProcedure,
    directCardPayment: datatransDirectCardPaymentProcedure,
  }),
  videos: createTRPCRouter({
    // Video routes will be added here
  }),
  orders: createTRPCRouter({
    generatePDF: generateOrderPDFProcedure,
    getUserPDFs: getUserOrderPDFsProcedure,
  }),
  emails: createTRPCRouter({
    sendGuestOrder: sendGuestOrderEmailProcedure,
    sendWelcome: sendWelcomeEmailProcedure,
  }),
  account: createTRPCRouter({
    deleteAccount: deleteAccountProcedure,
  }),
});

export type AppRouter = typeof appRouter;