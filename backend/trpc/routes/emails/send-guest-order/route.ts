import { publicProcedure } from '@/backend/trpc/create-context';
import { z } from 'zod';

const sendGuestOrderEmailSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string(),
  orderNumber: z.string(),
  eventName: z.string(),
  businessName: z.string(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    price: z.number(),
  })),
  total: z.number(),
  pdfUrl: z.string().optional(),
});

export const sendGuestOrderEmailProcedure = publicProcedure
  .input(sendGuestOrderEmailSchema)
  .mutation(async ({ input }: { input: z.infer<typeof sendGuestOrderEmailSchema> }) => {
    try {
      // In a real implementation, you would use an email service like:
      // - SendGrid
      // - Mailgun
      // - AWS SES
      // - Resend
      
      console.log('Sending order confirmation email to guest:', {
        to: input.customerEmail,
        subject: `Order Confirmation - ${input.orderNumber}`,
        orderDetails: input,
      });

      // Simulate email sending
      const emailContent = `
        Dear ${input.customerName},

        Thank you for your order! Here are your order details:

        Order Number: ${input.orderNumber}
        Event: ${input.eventName}
        Business: ${input.businessName}

        Items:
        ${input.items.map((item: { name: string; quantity: number; price: number }) => `- ${item.name} x${item.quantity} - ₦${(item.price * item.quantity).toFixed(2)}`).join('\n')}

        Total: ₦${input.total.toFixed(2)}

        ${input.pdfUrl ? `Your order PDF is attached to this email.` : ''}

        Thank you for your business!

        Best regards,
        60Seconds Team
      `;

      // In a real app, you would send the actual email here
      // await emailService.send({
      //   to: input.customerEmail,
      //   subject: `Order Confirmation - ${input.orderNumber}`,
      //   text: emailContent,
      //   attachments: input.pdfUrl ? [{ url: input.pdfUrl, filename: `order-${input.orderNumber}.pdf` }] : []
      // });

      return {
        success: true,
        message: 'Order confirmation email sent successfully',
      };
    } catch (error) {
      console.error('Error sending guest order email:', error);
      throw new Error('Failed to send order confirmation email');
    }
  });