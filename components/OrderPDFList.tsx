import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  ActivityIndicator,
  Share,
} from 'react-native';
import { Calendar, ExternalLink, Download, Share2 } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import QRCodeGenerator from 'qrcode';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import Colors from '@/constants/colors';
import { ticketReceiptService } from '@/lib/database';

type TicketRow = {
  id: string;
  order_number: string;
  qr_code_data: string;
  ticket_title: string;
  ticket_image_url?: string | null;
  event_name?: string | null;
  event_start_date?: string | null;
  location_name?: string | null;
  seat_no?: string | null;
  is_active: boolean;
  redeemed_at?: string | null;
  issued_at: string;
  created_at?: string | null;
  pdf_url?: string | null;
  ticket_type?: string | null;
  receipt_kind?: 'ticket' | 'product' | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  currency?: string | null;
  purchased_at?: string | null;
};

interface OrderPDFListProps {
  userId: string;
}

const sanitizePdfText = (value: string) => {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
};

const encodeBase64 = (input: string) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;

  while (i < input.length) {
    const byte1 = input.charCodeAt(i++) & 0xff;
    const byte2 = i < input.length ? input.charCodeAt(i++) & 0xff : Number.NaN;
    const byte3 = i < input.length ? input.charCodeAt(i++) & 0xff : Number.NaN;

    output += chars[byte1 >> 2];
    output += chars[((byte1 & 3) << 4) | (Number.isNaN(byte2) ? 0 : byte2 >> 4)];
    output += Number.isNaN(byte2) ? '=' : chars[((byte2 & 15) << 2) | (Number.isNaN(byte3) ? 0 : byte3 >> 6)];
    output += Number.isNaN(byte3) ? '=' : chars[byte3 & 63];
  }

  return output;
};

// Compact JPEG rendition of assets/images/icon.png for the self-contained PDF.
const TICKET_LOGO_JPEG_BASE64 = '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';

const decodeBase64 = (input: string) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const character of input.replace(/=+$/, '')) {
    const value = chars.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
};

const buildTicketPdfBase64 = (ticket: TicketRow) => {
  const logoJpeg = decodeBase64(TICKET_LOGO_JPEG_BASE64);
  const isEventTicket = ticket.receipt_kind
    ? ticket.receipt_kind === 'ticket'
    : String(ticket.ticket_type || 'ticket').toLowerCase() === 'ticket';
  const qrValue = ticket.qr_code_data || ticket.order_number || ticket.id;
  const qr = QRCodeGenerator.create(qrValue, { errorCorrectionLevel: 'M' });
  const qrSize = 190;
  const quietZone = 12;
  const qrX = (612 - qrSize) / 2;
  const qrY = 500;
  const moduleSize = (qrSize - quietZone * 2) / qr.modules.size;
  const qrCommands: string[] = [
    '1 1 1 rg',
    `${qrX} ${qrY} ${qrSize} ${qrSize} re f`,
    '0.039 0.039 0.059 rg',
  ];

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) continue;
      const x = qrX + quietZone + column * moduleSize;
      const y = qrY + quietZone + (qr.modules.size - row - 1) * moduleSize;
      qrCommands.push(`${x.toFixed(3)} ${y.toFixed(3)} ${moduleSize.toFixed(3)} ${moduleSize.toFixed(3)} re f`);
    }
  }
  const eventDate = ticket.event_start_date || ticket.issued_at;
  const issuedDate = ticket.issued_at ? new Date(ticket.issued_at).toLocaleString() : 'N/A';
  const rows = [
    ['Event', ticket.event_name || '60seconds Event'],
    ['Ticket', ticket.ticket_title || 'Ticket'],
    ['Order number', ticket.order_number || ticket.id],
    ['Quantity', String(Math.max(1, Number(ticket.quantity || 1)))],
    ['Unit price', `${ticket.currency || ''} ${Number(ticket.unit_price || 0).toFixed(2)}`.trim()],
    ['Total', `${ticket.currency || ''} ${Number(ticket.total_price || 0).toFixed(2)}`.trim()],
    ['Seat', ticket.seat_no || '-'],
    ['Location', ticket.location_name || 'Location not specified'],
    ['Event date', eventDate ? new Date(eventDate).toLocaleString() : 'Date TBA'],
    ['Status', ticket.redeemed_at ? 'REDEEMED' : ticket.is_active ? 'OPEN' : 'INACTIVE'],
    ['Issued', issuedDate],
  ];

  const textLines = [
    { size: 28, x: 142, y: 758, text: isEventTicket ? '60seconds Ticket' : '60seconds' },
    { size: 12, x: 142, y: 734, text: isEventTicket ? 'Official ticket receipt' : 'Official order document' },
    ...rows.flatMap((row, index) => {
      const y = 458 - index * 34;
      return [
        { size: 10, x: 54, y, text: row[0].toUpperCase() },
        { size: 16, x: 54, y: y - 20, text: row[1] },
      ];
    }),
    { size: 10, x: 54, y: 84, text: isEventTicket
      ? 'Keep this PDF with you. Venue staff may verify the ticket using the QR data above.'
      : 'Keep this PDF with you. The business may verify your order using the QR data above.' },
  ];

  const content = [
    'q',
    '0.039 0.039 0.059 rg',
    '0 0 612 792 re f',
    '0.098 0.098 0.122 rg',
    '36 44 540 704 re f',
    '0.388 0.4 0.945 rg',
    '36 704 540 88 re f',
    'q 72 0 0 72 54 712 cm /Im1 Do Q',
    ...qrCommands,
    '1 1 1 rg',
    ...textLines.map((line) => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${sanitizePdfText(line.text)}) Tj ET`),
    'Q',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 96 /Height 96 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>\nstream\n${logoJpeg}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encodeBase64(pdf);
};

const openDataUriInBrowser = (dataUri: string, fileName: string, download: boolean) => {
  const documentRef = (globalThis as any).document;
  if (!documentRef) {
    return false;
  }

  const link = documentRef.createElement('a');
  link.href = dataUri;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (download) {
    link.download = fileName;
  }

  documentRef.body.appendChild(link);
  link.click();
  documentRef.body.removeChild(link);
  return true;
};

export default function OrderPDFList({ userId }: OrderPDFListProps) {
  const [tickets, setTickets] = React.useState<TicketRow[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const totalPurchased = tickets.reduce(
    (sum, ticket) => sum + Math.max(1, Number(ticket.quantity || 1)),
    0
  );
  const ticketCount = tickets.reduce(
    (sum, ticket) => sum + (String(ticket.ticket_type || 'ticket').toLowerCase() === 'ticket' ? Math.max(1, Number(ticket.quantity || 1)) : 0),
    0
  );
  const productCount = totalPurchased - ticketCount;

  const getSafePdfFileName = (ticket: TicketRow) => {
    const receiptLabel = ticket.receipt_kind === 'product' ? 'product-receipt' : 'ticket';
    const rawName = `${ticket.order_number || ticket.id}-${receiptLabel}-branded-scannable-v4.pdf`;
    return rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  };

  const getLocalPdfUri = async (ticket: TicketRow) => {
    const rootDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!rootDir) {
      throw new Error('STORAGE_NOT_AVAILABLE');
    }

    const ticketsDir = `${rootDir}tickets`;
    const localUri = `${ticketsDir}/${getSafePdfFileName(ticket)}`;

    await FileSystem.makeDirectoryAsync(ticketsDir, { intermediates: true });

    const existing = await FileSystem.getInfoAsync(localUri);
    if (existing.exists && (((existing as any).size as number | undefined) ?? 0) > 0) {
      return localUri;
    }

    await FileSystem.writeAsStringAsync(localUri, buildTicketPdfBase64(ticket), {
      encoding: FileSystem.EncodingType.Base64,
    });

    return localUri;
  };

  const loadTickets = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = (await ticketReceiptService.getVisibleTickets(userId)) as unknown as TicketRow[];
      setTickets(data || []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load tickets';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const handleDownloadPdf = async (ticket: TicketRow) => {
    try {
      if (Platform.OS === 'web') {
        const dataUri = `data:application/pdf;base64,${buildTicketPdfBase64(ticket)}`;
        if (openDataUriInBrowser(dataUri, getSafePdfFileName(ticket), true)) {
          return;
        }
        Alert.alert('Unable to Download', 'Could not create the ticket PDF.');
        return;
      }

      const localUri = await getLocalPdfUri(ticket);
      const canShareFile = await Sharing.isAvailableAsync();
      if (canShareFile) {
        await Sharing.shareAsync(localUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Save ${ticket.ticket_title}`,
          UTI: 'com.adobe.pdf',
        });
        return;
      }

      Alert.alert('Download Complete', 'Ticket PDF downloaded successfully.');
    } catch (e) {
      Alert.alert('Error', 'Could not download the ticket PDF.');
    }
  };

  const handleOpenPdf = async (ticket: TicketRow) => {
    try {
      if (Platform.OS !== 'web') {
        const localUri = await getLocalPdfUri(ticket);
        try {
          await Linking.openURL(localUri);
          return;
        } catch {
          const canShareFile = await Sharing.isAvailableAsync();
          if (canShareFile) {
            await Sharing.shareAsync(localUri, {
              mimeType: 'application/pdf',
              dialogTitle: `Open ${ticket.ticket_title}`,
              UTI: 'com.adobe.pdf',
            });
            return;
          }
        }
      }

      const dataUri = `data:application/pdf;base64,${buildTicketPdfBase64(ticket)}`;
      if (openDataUriInBrowser(dataUri, getSafePdfFileName(ticket), false)) {
        return;
      }
      Alert.alert('Unable to Open', 'Could not create this ticket PDF.');
    } catch (e) {
      Alert.alert('Error', 'Could not open the ticket PDF.');
    }
  };

  const handleShareTicket = async (ticket: TicketRow) => {
    try {
      const shareUrl = ticket.pdf_url?.trim() || '';
      const shareMessage = [
        `60seconds Ticket: ${ticket.ticket_title}`,
        ticket.event_name ? `Event: ${ticket.event_name}` : null,
        ticket.order_number ? `Order: ${ticket.order_number}` : null,
        shareUrl || null,
      ]
        .filter(Boolean)
        .join('\n');

      if (Platform.OS !== 'web') {
        const localPdfUri = await getLocalPdfUri(ticket);
        const canShareFile = await Sharing.isAvailableAsync();

        if (canShareFile) {
          await Sharing.shareAsync(localPdfUri, {
            mimeType: 'application/pdf',
            dialogTitle: `Share ${ticket.ticket_title}`,
            UTI: 'com.adobe.pdf',
          });
          return;
        }
      }

      await Share.share({
        message: shareMessage,
        url: shareUrl,
        title: ticket.ticket_title,
      });
    } catch (e) {
      Alert.alert('Share Failed', 'Could not share this ticket right now.');
    }
  };

  const formatTicketDate = (rawDate?: string | null) => {
    if (!rawDate) {
      return {
        dateLabel: '--/--/----',
        timeLabel: '--:--',
      };
    }

    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) {
      return {
        dateLabel: '--/--/----',
        timeLabel: '--:--',
      };
    }

    return {
      dateLabel: date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
      timeLabel: date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    };
  };

  const renderTicket = (item: TicketRow) => {
    const resolvedReceiptKind = item.receipt_kind ||
      (String(item.ticket_type || 'ticket').toLowerCase() === 'ticket' ? 'ticket' : 'product');
    const isProductReceipt = resolvedReceiptKind === 'product';
    const purchaseTimestamp = item.purchased_at || item.issued_at || item.created_at || '';
    const { dateLabel, timeLabel } = formatTicketDate(purchaseTimestamp);
    const purchaseDate = new Date(purchaseTimestamp);
    const purchaseDateLabel = Number.isNaN(purchaseDate.getTime())
      ? 'Purchase date unavailable'
      : purchaseDate.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        });

    return (
      <View style={styles.ticketWrap}>
        <View style={styles.ticketCard}>
          <LinearGradient
            colors={['#0A1733', '#10264F', '#173163']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ticketBackground}
          >
            <View style={styles.ticketFrame}>
              <Text style={styles.brandText}>60seconds</Text>
              <Text style={styles.receiptKindText}>{isProductReceipt ? 'PRODUCT RECEIPT' : 'EVENT TICKET'}</Text>

              <View style={styles.qrPanel}>
                <QRCode
                  value={item.qr_code_data || item.order_number}
                  size={168}
                  backgroundColor="#ffffff"
                  color="#0A1733"
                />
              </View>

              <View style={styles.dateRow}>
                <View>
                  <Text style={styles.sectionLabel}>PURCHASE DATE</Text>
                  <Text style={styles.dateValue}>{dateLabel}</Text>
                </View>
                <View style={styles.purchaseTimeColumn}>
                  <Text style={styles.sectionLabel}>PURCHASE TIME</Text>
                  <Text style={styles.dateValue}>{timeLabel}</Text>
                </View>
              </View>

              <View style={styles.ticketDivider} />

              <View style={styles.locationSection}>
                <Text style={styles.sectionLabel}>LOCATION</Text>
                <Text style={styles.locationTitle}>{item.event_name || '60seconds Event'}</Text>
                <Text style={styles.locationSubtitle}>{item.location_name || 'Location not specified'}</Text>
              </View>

              <View style={styles.bottomRow}>
                <View style={styles.bottomCol}>
                  <Text style={styles.sectionLabel}>{isProductReceipt ? 'PRODUCT' : 'TICKET'}</Text>
                  <Text style={styles.primaryBottomText}>{item.ticket_title}</Text>
                  <Text style={styles.sectionLabel}>QUANTITY</Text>
                  <Text style={styles.secondaryBottomText}>{Math.max(1, Number(item.quantity || 1))}</Text>
                  <Text style={styles.sectionLabel}>TOTAL</Text>
                  <Text style={styles.secondaryBottomText}>
                    {item.currency || ''} {Number(item.total_price || 0).toFixed(2)}
                  </Text>
                  <Text style={styles.sectionLabel}>ORDER NO.</Text>
                  <Text style={styles.secondaryBottomText}>{item.order_number}</Text>
                  <Text style={styles.sectionLabel}>SEAT</Text>
                  <Text style={styles.secondaryBottomText}>{item.seat_no || '-'}</Text>
                </View>

                <View style={styles.bottomColRight}>
                  <Text style={styles.sectionLabel}>STATUS</Text>
                  <Text style={styles.performingText}>
                    {item.redeemed_at ? 'REDEEMED' : item.is_active ? 'OPEN' : 'INACTIVE'}
                  </Text>
                </View>
              </View>

              <View style={styles.purchaseDateSection}>
                <Text style={styles.sectionLabel}>PURCHASED ON</Text>
                <Text style={styles.purchaseDateText}>{purchaseDateLabel}</Text>
              </View>

              <Text style={styles.brandFooter}>60seconds</Text>
            </View>
          </LinearGradient>
        </View>

        <View style={styles.orderActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleDownloadPdf(item)}>
            <Download size={16} color={Colors.dark.text} />
            <Text style={styles.actionButtonText}>Download PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={() => handleShareTicket(item)}>
            <Share2 size={16} color={Colors.dark.text} />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>

          {Platform.OS !== 'web' && (
            <TouchableOpacity style={styles.actionButton} onPress={() => handleOpenPdf(item)}>
              <ExternalLink size={16} color={Colors.dark.text} />
              <Text style={styles.actionButtonText}>Open</Text>
            </TouchableOpacity>
          )}

          <View style={styles.generatedAtRow}>
            <Calendar size={14} color={Colors.dark.subtext} />
            <Text style={styles.generatedAtText}>Issued {formatTicketDate(item.issued_at).dateLabel}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading tickets...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadTickets()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!tickets.length) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTicketIcon}>TICKET</Text>
        <Text style={styles.emptyTitle}>No Purchases Yet</Text>
        <Text style={styles.emptySubtitle}>Purchased tickets and products will appear here in your profile</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Purchases</Text>
        <Text style={styles.subtitle}>
          {totalPurchased} item{totalPurchased !== 1 ? 's' : ''} purchased
        </Text>
        <Text style={styles.purchaseBreakdown}>
          {ticketCount} ticket{ticketCount !== 1 ? 's' : ''} · {productCount} product{productCount !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.listContainer}>
        {tickets.map((ticket) => (
          <View key={ticket.id}>{renderTicket(ticket)}</View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  purchaseBreakdown: {
    fontSize: 13,
    color: Colors.dark.primary,
    marginTop: 6,
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 24,
  },
  ticketWrap: {
    marginBottom: 16,
  },
  ticketCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  ticketBackground: {
    width: '100%',
    padding: 14,
  },
  ticketFrame: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  brandText: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 12,
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  receiptKindText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: -8,
    marginBottom: 12,
  },
  qrPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  dateRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dateValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    includeFontPadding: false,
  },
  ticketDivider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: 10,
  },
  purchaseDateSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  purchaseDateText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  purchaseTimeColumn: {
    alignItems: 'flex-end',
  },
  locationSection: {
    width: '100%',
    marginBottom: 12,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  locationTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 2,
    includeFontPadding: false,
  },
  locationSubtitle: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 14,
    fontWeight: '500',
  },
  bottomRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bottomCol: {
    flex: 1,
    paddingRight: 8,
  },
  bottomColRight: {
    width: '40%',
    alignItems: 'flex-end',
  },
  primaryBottomText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
    includeFontPadding: false,
  },
  secondaryBottomText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    includeFontPadding: false,
  },
  performingText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'right',
    includeFontPadding: false,
  },
  brandFooter: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  orderActions: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.card,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  actionButtonText: {
    fontSize: 13,
    color: Colors.dark.text,
    marginLeft: 6,
    fontWeight: '600',
  },
  generatedAtRow: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  generatedAtText: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 16,
    color: Colors.dark.subtext,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 16,
    color: Colors.dark.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTicketIcon: {
    fontSize: 12,
    letterSpacing: 3,
    color: Colors.dark.subtext,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.dark.subtext,
    textAlign: 'center',
    lineHeight: 22,
  },
});
