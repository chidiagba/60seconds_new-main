import { publicProcedure } from '@/backend/trpc/create-context';
import { z } from 'zod';

const sendWelcomeEmailSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const sendWelcomeEmailProcedure = publicProcedure
  .input(sendWelcomeEmailSchema)
  .mutation(async ({ input }) => {
    try {
      const { email, name } = input;

      const subject = "Welcome to 60seconds - Catch The Moment!";
      
      const emailContent = `Dear ${name},

Welcome aboard! We are thrilled you have joined the 60Seconds community  the ultimate app for capturing and sharing those electrifying nightlife moments in just 60 seconds.
At 60Seconds, we make it easy to dive into the vibrant world of nightlife. Whether you are uploading quick videos of your epic nights out or exploring authentic user-generated content to discover trendy clubs, hidden speakeasy bars, hot party deals, and exclusive event tickets, we have got you covered. Its all about real-time, genuine experiences from people like you, helping everyone find the best spots in any city.
To get started:
1.  Open the app and complete your profile  add a fun bio and your favorite nightlife vibes to connect with like-minded adventurers.
2.  Upload your first 60-second video: Hit record, capture a memorable moment from a recent outing, and share it with the world. Pro tip: Keep it authentic and energetic to get more views and interactions!
3.  Explore the feed: Scroll through videos from your city or beyond to uncover new venues, events, and deals. Follow creators whose style matches yours for personalized recommendations.
4.  Check out tickets and deals: Look for exclusive offers on events  you might snag something amazing right away.
We are here to help you make every night unforgettable. If you have any questions, our support team is just a tap away in the app.
Catch the moment  your next adventure starts now!
Best regards,
The 60Seconds Team
support@60secondsapp.io
https://60secondsapp.io
`;




// TODO: Integrate with an email service provider
      // Options: SendGrid, Mailgun, AWS SES, Resend, Nodemailer, etc.
      // Example with a service:
      // await emailService.send({
      //   to: email,
      //   subject: subject,
      //   text: emailContent,
      //   html: convertToHTML(emailContent), // Optional: HTML version
      // });

      // For now, log the email (in production, replace with actual email sending)
      console.log('📧 Welcome Email:', {
        to: email,
        subject: subject,
        name: name,
      });
      console.log('Email content length:', emailContent.length, 'characters');

      // In development, you might want to see the email content
      if (process.env.NODE_ENV === 'development') {
        console.log('\n--- Email Content Preview ---');
        console.log(emailContent.substring(0, 200) + '...\n');
      }

      return {
        success: true,
        message: 'Welcome email sent successfully',
      };
    } catch (error: any) {
      console.error('❌ Failed to send welcome email:', error);
      return {
        success: false,
        message: error.message || 'Failed to send welcome email',
      };
    }
  });










