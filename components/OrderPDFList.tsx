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

export default function OrderPDFList({ userId }: OrderPDFListProps) {
  const [tickets, setTickets] = React.useState<TicketRow[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const getSafePdfFileName = (ticket: TicketRow) => {
    const rawName = `${ticket.order_number || ticket.id}-ticket.pdf`;
    return rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  };

  const getLocalPdfUri = async (ticket: TicketRow) => {
    if (!ticket.pdf_url) {
      throw new Error('PDF_NOT_AVAILABLE');
    }

    const rootDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!rootDir) {
      throw new Error('STORAGE_NOT_AVAILABLE');
    }

    const ticketsDir = `${rootDir}tickets`;
    const localUri = `${ticketsDir}/${getSafePdfFileName(ticket)}`;

    await FileSystem.makeDirectoryAsync(ticketsDir, { intermediates: true });

    const existing = await FileSystem.getInfoAsync(localUri, { size: true });
    if (existing.exists && (existing.size ?? 0) > 0) {
      return localUri;
    }

    const result = await FileSystem.downloadAsync(ticket.pdf_url, localUri);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`PDF_DOWNLOAD_FAILED_${result.status}`);
    }

    return result.uri;
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
    if (!ticket.pdf_url) {
      Alert.alert('PDF Not Available', 'This ticket does not have a PDF yet.');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        const canOpen = await Linking.canOpenURL(ticket.pdf_url);
        if (canOpen) {
          await Linking.openURL(ticket.pdf_url);
          return;
        }
        Alert.alert('Unable to Download', 'Could not open the PDF URL.');
        return;
      }

      await getLocalPdfUri(ticket);
      Alert.alert('Download Complete', 'Ticket PDF downloaded successfully.');
    } catch (e) {
      Alert.alert('Error', 'Could not download the ticket PDF.');
    }
  };

  const handleOpenPdf = async (ticket: TicketRow) => {
    if (!ticket.pdf_url) {
      Alert.alert('PDF Not Available', 'This ticket does not have a PDF yet.');
      return;
    }

    try {
      if (Platform.OS !== 'web') {
        const localUri = await getLocalPdfUri(ticket);
        const canOpenLocal = await Linking.canOpenURL(localUri);
        if (canOpenLocal) {
          await Linking.openURL(localUri);
          return;
        }
      }

      const canOpenRemote = await Linking.canOpenURL(ticket.pdf_url);
      if (canOpenRemote) {
        await Linking.openURL(ticket.pdf_url);
      } else {
        Alert.alert('Unable to Open', 'Could not open this ticket PDF.');
      }
    } catch (e) {
      Alert.alert('Error', 'Could not open the ticket PDF.');
    }
  };

  const handleShareTicket = async (ticket: TicketRow) => {
    try {
      if (!ticket.pdf_url) {
        Alert.alert('PDF Not Available', 'This ticket does not have a PDF yet.');
        return;
      }

      const shareUrl = ticket.pdf_url || '';
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