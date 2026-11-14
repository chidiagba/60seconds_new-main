import { z } from 'zod';
import { protectedProcedure } from '@/backend/trpc/create-context';
import type { OrderPDF } from '@/types';

export const getUserOrderPDFsProcedure = protectedProcedure
  .input(z.object({
    userId: z.string(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      // In a real implementation, this would query the database
      // For now, we'll return mock data
      const mockOrderPDFs: OrderPDF[] = [
        {
          id: '1',
          orderId: 'order-1',
          orderNumber: 'ORD-20241214-0001',
          userId: ctx.user.id,
          pdfUrl: 'https://storage.example.com/orders/ORD-20241214-0001.pdf',
          qrCodeData: 'ORDER:ORD-20241214-0001:1734192000000',
          generatedAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
          isActive: true
        },
        {
          id: '2',
          orderId: 'order-2',
          orderNumber: 'ORD-20241212-0002',
          userId: ctx.user.id,
          pdfUrl: 'https://storage.example.com/orders/ORD-20241212-0002.pdf',
          qrCodeData: 'ORDER:ORD-20241212-0002:1734019200000',
          generatedAt: new Date(Date.now() - 86400000 * 4).toISOString(), // 4 days ago
          isActive: true
        },
        {
          id: '3',
          orderId: 'order-3',
          orderNumber: 'ORD-20241210-0003',
          userId: ctx.user.id,
          pdfUrl: 'https://storage.example.com/orders/ORD-20241210-0003.pdf',
          qrCodeData: 'ORDER:ORD-20241210-0003:1733846400000',
          generatedAt: new Date(Date.now() - 86400000 * 6).toISOString(), // 6 days ago
          isActive: true
        }
      ];

      // Apply pagination
      const paginatedResults = mockOrderPDFs.slice(input.offset, input.offset + input.limit);

      return {
        success: true,
        data: {
          orderPDFs: paginatedResults,
          total: mockOrderPDFs.length,
          hasMore: input.offset + input.limit < mockOrderPDFs.length
        }
      };
    } catch (error: any) {
      console.error('Error fetching user order PDFs:', error);
      throw new Error(error.message || 'Failed to fetch order PDFs');
    }
  });