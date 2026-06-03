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
  issued_at: string;
  pdf_url?: string | null;
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

const buildTicketPdfBase64 = (ticket: TicketRow) => {
  const eventDate = ticket.event_start_date || ticket.issued_at;
  const issuedDate = ticket.issued_at ? new Date(ticket.issued_at).toLocaleString() : 'N/A';
  const rows = [
    ['Event', ticket.event_name || '60seconds Event'],
    ['Ticket', ticket.ticket_title || 'Ticket'],
    ['Order number', ticket.order_number || ticket.id],
    ['Seat', ticket.seat_no || '-'],
    ['Location', ticket.location_name || 'Location not specified'],
    ['Event date', eventDate ? new Date(eventDate).toLocaleString() : 'Date TBA'],
    ['Status', ticket.is_active ? 'ACTIVE' : 'EXPIRED'],
    ['Issued', issuedDate],
    ['QR data', ticket.qr_code_data || ticket.order_number || ticket.id],
  ];

  const textLines = [
    { size: 28, x: 54, y: 760, text: '60seconds Ticket' },
    { size: 12, x: 54, y: 736, text: 'Official ticket receipt' },
    ...rows.flatMap((row, index) => {
      const y = 690 - index * 44;
      return [
        { size: 10, x: 54, y, text: row[0].toUpperCase() },
        { size: 16, x: 54, y: y - 20, text: row[1] },
      ];
    }),
    { size: 10, x: 54, y: 84, text: 'Keep this PDF with you. Venue staff may verify the ticket using the QR data above.' },
  ];

  const content = [
    'q',
    '0.039 0.039 0.059 rg',
    '0 0 612 792 re f',
    '0.098 0.098 0.122 rg',
    '36 44 540 704 re f',
    '0.388 0.4 0.945 rg',
    '36 704 540 88 re f',
    '1 1 1 rg',
    ...textLines.map((line) => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${sanitizePdfText(line.text)}) Tj ET`),
    'Q',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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

  const getSafePdfFileName = (ticket: TicketRow) => {
    const rawName = `${ticket.order_number || ticket.id}-ticket.pdf`;
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

    const remotePdfUrl = ticket.pdf_url?.trim();
    if (remotePdfUrl) {
      const result = await FileSystem.downloadAsync(remotePdfUrl, localUri);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`PDF_DOWNLOAD_FAILED_${result.status}`);
      }

      return result.uri;
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
        const remotePdfUrl = ticket.pdf_url?.trim();
        if (!remotePdfUrl) {
          const dataUri = `data:application/pdf;base64,${buildTicketPdfBase64(ticket)}`;
          if (openDataUriInBrowser(dataUri, getSafePdfFileName(ticket), true)) {
            return;
          }
          Alert.alert('Unable to Download', 'Could not create the ticket PDF.');
          return;
        }

        const canOpen = await Linking.canOpenURL(remotePdfUrl);
        if (canOpen) {
          await Linking.openURL(remotePdfUrl);
          return;
        }
        Alert.alert('Unable to Download', 'Could not open the PDF URL.');
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

      const remotePdfUrl = ticket.pdf_url?.trim();
      if (!remotePdfUrl) {
        const dataUri = `data:application/pdf;base64,${buildTicketPdfBase64(ticket)}`;
        if (openDataUriInBrowser(dataUri, getSafePdfFileName(ticket), false)) {
          return;
        }
        Alert.alert('Unable to Open', 'Could not create this ticket PDF.');
        return;
      }

      const canOpenRemote = await Linking.canOpenURL(remotePdfUrl);
      if (canOpenRemote) {
        await Linking.openURL(remotePdfUrl);
      } else {
        Alert.alert('Unable to Open', 'Could not open this ticket PDF.');
      }
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
    const { dateLabel, timeLabel } = formatTicketDate(item.event_start_date || item.issued_at);

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

              <View style={styles.qrPanel}>
                <QRCode
                  value={item.qr_code_data || item.order_number}
                  size={168}
                  backgroundColor="#ffffff"
                  color="#0A1733"
                />
              </View>

              <View style={styles.dateRow}>
                <Text style={styles.dateValue}>{dateLabel}</Text>
                <Text style={styles.dateValue}>{timeLabel}</Text>
              </View>

              <View style={styles.ticketDivider} />

              <View style={styles.locationSection}>
                <Text style={styles.sectionLabel}>LOCATION</Text>
                <Text style={styles.locationTitle}>{item.event_name || '60seconds Event'}</Text>
                <Text style={styles.locationSubtitle}>{item.location_name || 'Location not specified'}</Text>
              </View>

              <View style={styles.bottomRow}>
                <View style={styles.bottomCol}>
                  <Text style={styles.sectionLabel}>TICKET</Text>
                  <Text style={styles.primaryBottomText}>{item.ticket_title}</Text>
                  <Text style={styles.sectionLabel}>ORDER NO.</Text>
                  <Text style={styles.secondaryBottomText}>{item.order_number}</Text>
                  <Text style={styles.sectionLabel}>SEAT</Text>
                  <Text style={styles.secondaryBottomText}>{item.seat_no || '-'}</Text>
                </View>

                <View style={styles.bottomColRight}>
                  <Text style={styles.sectionLabel}>STATUS</Text>
                  <Text style={styles.performingText}>{item.is_active ? 'ACTIVE' : 'EXPIRED'}</Text>
                </View>
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
        <Text style={styles.emptyTitle}>No Tickets Yet</Text>
        <Text style={styles.emptySubtitle}>Purchased ticket receipts will appear here in your profile</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Tickets</Text>
        <Text style={styles.subtitle}>
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} available
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
