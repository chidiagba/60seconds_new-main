import { z } from 'zod';
import { publicProcedure } from '@/backend/trpc/create-context';
import type { OrderPDFData } from '@/types';

export const generateOrderPDFProcedure = publicProcedure
  .input(z.object({
    orderNumber: z.string(),
    customerName: z.string(),
    customerEmail: z.string(),
    businessName: z.string(),
    items: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
      type: z.enum(['ticket', 'drink', 'reservation', 'merchandise'])
    })),
    subtotal: z.number(),
    tax: z.number().default(0),
    discount: z.number().default(0),
    total: z.number(),
    currency: z.string().default('USD'),
    orderDate: z.string(),
    notes: z.string().optional()
  }))
  .mutation(async ({ input }) => {
    try {
      // Generate unique QR code data
      const qrCodeData = `ORDER:${input.orderNumber}:${Date.now()}`;
      
      // Generate PDF content as base64
      await generatePDFContent({
        ...input,
        qrCodeData
      });
      
      // In a real implementation, you would:
      // 1. Upload the PDF to cloud storage (AWS S3, Google Cloud Storage, etc.)
      // 2. Store the PDF metadata in the database
      // 3. Return the public URL
      
      // For now, we'll simulate this with a mock URL
      const pdfUrl = `https://storage.example.com/orders/${input.orderNumber}.pdf`;
      
      return {
        success: true,
        data: {
          pdfUrl,
          qrCodeData,
          orderNumber: input.orderNumber,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error: any) {
      console.error('PDF generation error:', error);
      throw new Error(error.message || 'Failed to generate order PDF');
    }
  });

// PDF generation function
async function generatePDFContent(data: OrderPDFData): Promise<string> {
  // This is a simplified PDF generation
  // In a real app, you would use libraries like:
  // - puppeteer (for HTML to PDF)
  // - jsPDF (client-side PDF generation)
  // - PDFKit (server-side PDF generation)
  // - React-PDF (React components to PDF)
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Order Receipt - ${data.orderNumber}</title>
      <style>
        body {
          font-family: 'Helvetica', Arial, sans-serif;
          margin: 0;
          padding: 40px;
          background: #f8f9fa;
          color: #333;
        }
        .receipt {
          max-width: 600px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #8A2BE2, #9932CC);
          color: white;
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 300;
        }
        .order-number {
          font-size: 18px;
          margin-top: 10px;
          opacity: 0.9;
        }
        .content {
          padding: 30px;
        }
        .section {
          margin-bottom: 30px;
        }
        .section h2 {
          color: #8A2BE2;
          font-size: 18px;
          margin-bottom: 15px;
          border-bottom: 2px solid #f0f0f0;
          padding-bottom: 8px;
        }
        .customer-info {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .items-table th,
        .items-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #eee;
        }
        .items-table th {
          background: #f8f9fa;
          font-weight: 600;
          color: #666;
        }
        .item-type {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .type-ticket { background: #e3f2fd; color: #1976d2; }
        .type-drink { background: #f3e5f5; color: #7b1fa2; }
        .type-reservation { background: #e8f5e8; color: #388e3c; }
        .type-merchandise { background: #fff3e0; color: #f57c00; }
        .totals {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .total-row.final {
          font-weight: bold;
          font-size: 18px;
          color: #8A2BE2;
          border-top: 2px solid #ddd;
          padding-top: 12px;
          margin-top: 12px;
        }
        .qr-section {
          text-align: center;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
        }
        .qr-code {
          width: 120px;
          height: 120px;
          margin: 0 auto 15px;
          background: white;
          border: 2px solid #ddd;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: #666;
        }
        .footer {
          text-align: center;
          padding: 20px;
          color: #666;
          font-size: 14px;
          border-top: 1px solid #eee;
        }
        .business-name {
          font-size: 20px;
          color: #8A2BE2;
          margin-bottom: 5px;
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <div class="header">
          <h1>Order Receipt</h1>
          <div class="order-number">Order #${data.orderNumber}</div>
        </div>
        
        <div class="content">
          <div class="section">
            <div class="business-name">${data.businessName}</div>
            <div class="customer-info">
              <strong>Customer:</strong> ${data.customerName}<br>
              <strong>Email:</strong> ${data.customerEmail}<br>
              <strong>Order Date:</strong> ${new Date(data.orderDate).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
          
          <div class="section">
            <h2>Order Items</h2>
            <table class="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${data.items.map(item => `
                  <tr>
                    <td>
                      <strong>${item.name}</strong>
                      ${item.description ? `<br><small style="color: #666;">${item.description}</small>` : ''}
                    </td>
                    <td><span class="item-type type-${item.type}">${item.type}</span></td>
                    <td>${item.quantity}</td>
                    <td>$${item.unitPrice.toFixed(2)}</td>
                    <td>$${item.totalPrice.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <div class="totals">
              <div class="total-row">
                <span>Subtotal:</span>
                <span>$${data.subtotal.toFixed(2)}</span>
              </div>
              ${data.discount > 0 ? `
                <div class="total-row">
                  <span>Discount:</span>
                  <span style="color: #4caf50;">-$${data.discount.toFixed(2)}</span>
                </div>
              ` : ''}
              ${data.tax > 0 ? `
                <div class="total-row">
                  <span>Tax:</span>
                  <span>$${data.tax.toFixed(2)}</span>
                </div>
              ` : ''}
              <div class="total-row final">
                <span>Total:</span>
                <span>$${data.total.toFixed(2)} ${data.currency}</span>
              </div>
            </div>
          </div>
          
          <div class="section">
            <div class="qr-section">
              <div class="qr-code">
                QR Code<br>
                ${data.qrCodeData}
              </div>
              <p style="margin: 0; color: #666; font-size: 14px;">
                Scan this QR code for order verification
              </p>
            </div>
          </div>
          
          ${data.notes ? `
            <div class="section">
              <h2>Notes</h2>
              <p style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 0;">
                ${data.notes}
              </p>
            </div>
          ` : ''}
        </div>
        
        <div class="footer">
          <p>Thank you for your order!</p>
          <p style="font-size: 12px; margin: 5px 0 0 0;">
            Generated on ${new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  // Convert HTML to base64 (in a real app, you'd convert to actual PDF)
  return Buffer.from(htmlContent).toString('base64');
}