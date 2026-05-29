import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  MapPin,
  Calendar,
  Clock,
  ShoppingBag,
  User,
  Mail,
  Phone,
  CreditCard,
  Check,
  X,
  Info,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { mockVideos } from '@/mocks/videos';
import { mockProducts } from '@/mocks/products';
import { useAuthStore } from '@/store/auth-store';
import { Product, Video } from '@/types';
import { trpc } from '@/lib/trpc';

const { width } = Dimensions.get('window');

interface CartItem {
  product: Product;
  quantity: number;
}

interface GuestOrderData {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export default function WebEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [event, setEvent] = useState<Video | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isGuest, setIsGuest] = useState(!user);
  const [guestData, setGuestData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const initializePayment = trpc.paystack.initialize.useMutation();

  const generatePDF = trpc.orders.generatePDF.useMutation();
  const sendGuestEmail = trpc.emails.sendGuestOrder.useMutation();

  useEffect(() => {
    if (id) {
      const foundEvent = mockVideos.find((v) => v.id === id);
      setEvent(foundEvent || null);

      // Get products for this event
      const eventProducts = mockProducts.filter((p) => p.videoId === id);
      setProducts(eventProducts);
    }
  }, [id]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existingItem = prev.find((item) => item.product.id === product.id);
      if (existingItem) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  };

  const calculateTax = (subtotal: number) => {
    return subtotal * 0.08; // 8% tax
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const tax = calculateTax(subtotal);
    return subtotal + tax;
  };

  const handleCheckout = () => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Please add items to your cart before checkout.');
      return;
    }
    setShowCheckout(true);
  };

  const processOrder = async () => {
    if (isGuest && (!guestData.name || !guestData.email)) {
      Alert.alert('Missing Information', 'Please fill in your name and email.');
      return;
    }

    setIsProcessing(true);

    try {
      const subtotal = calculateSubtotal();
      const tax = calculateTax(subtotal);
      const total = calculateTotal();

      // Initialize payment
      await initializePayment.mutateAsync({
        email: isGuest ? guestData.email : user!.email!,
        amount: Math.round(total * 100), // Convert to kobo
        metadata: {
          eventId: event!.id,
          eventName: event!.eventName,
          customerName: isGuest ? guestData.name : user!.name,
          customerPhone: isGuest ? guestData.phone : undefined,
          items: cart.map((item) => ({
            productId: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
          })),
          isGuest,
        },
      });

      // For web, we'll simulate payment success
      // In a real app, you'd redirect to Paystack checkout
      if (Platform.OS === 'web') {
        // Simulate payment processing
        setTimeout(async () => {
          try {
            // Generate order number
            const orderNum = `ORD-${Date.now()}`;
            setOrderNumber(orderNum);

            // Generate PDF for the order
            await generatePDF.mutateAsync({
              orderNumber: orderNum,
              customerName: isGuest ? guestData.name : user!.name,
              customerEmail: isGuest ? guestData.email : user!.email!,
              businessName: event!.user.businessName || event!.user.name,
              items: cart.map((item) => ({
                id: item.product.id,
                name: item.product.name,
                description: item.product.description,
                quantity: item.quantity,
                unitPrice: item.product.price,
                totalPrice: item.product.price * item.quantity,
                type: item.product.type,
              })),
              subtotal,
              tax,
              discount: 0,
              total,
              currency: 'NGN',
              orderDate: new Date().toISOString(),
              notes: `QR Code: order:${orderNum}`,
            });

            // If guest user, send email with PDF
            if (isGuest) {
              try {
                await sendGuestEmail.mutateAsync({
                  customerEmail: guestData.email,
                  customerName: guestData.name,
                  orderNumber: orderNum,
                  eventName: event!.eventName,
                  businessName: event!.user.businessName || event!.user.name,
                  items: cart.map((item) => ({
                    name: item.product.name,
                    quantity: item.quantity,
                    price: item.product.price,
                  })),
                  total,
                });
                console.log('Order confirmation email sent to:', guestData.email);
              } catch (emailError) {
                console.error('Failed to send confirmation email:', emailError);
                // Don't fail the order if email fails
              }
            }

            setOrderComplete(true);
            setCart([]);
            setShowCheckout(false);
          } catch (error) {
            console.error('Error processing order:', error);
            Alert.alert('Error', 'Failed to process order. Please try again.');
          } finally {
            setIsProcessing(false);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Payment initialization failed:', error);
      Alert.alert('Error', 'Failed to initialize payment. Please try again.');
      setIsProcessing(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Date TBA';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return 'Time TBA';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Event not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (orderComplete) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successIcon}>
            <Check size={60} color={Colors.dark.primary} />
          </View>
          <Text style={styles.successTitle}>Order Confirmed!</Text>
          <Text style={styles.successSubtitle}>
            Order #{orderNumber}
          </Text>
          <Text style={styles.successMessage}>
            {isGuest
              ? `A confirmation email with your order details and PDF has been sent to ${guestData.email}`
              : 'Your order details are available in your profile.'}
          </Text>
          <TouchableOpacity
            style={styles.backToEventButton}
            onPress={() => {
              setOrderComplete(false);
              setOrderNumber('');
            }}
          >
            <Text style={styles.backToEventButtonText}>Back to Event</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Event Header */}
        <View style={styles.eventHeader}>
          <Image
            source={{ uri: event.thumbnail }}
            style={styles.eventImage}
            contentFit="cover"
          />
          <View style={styles.eventOverlay}>
            <Text style={styles.eventTitle}>{event.eventName}</Text>
            <View style={styles.eventDetails}>
              <View style={styles.eventDetailItem}>
                <Calendar size={16} color={Colors.dark.text} />
                <Text style={styles.eventDetailText}>
                  {formatDate(event.eventDate)}
                </Text>
              </View>
              <View style={styles.eventDetailItem}>
                <Clock size={16} color={Colors.dark.text} />
                <Text style={styles.eventDetailText}>
                  {formatTime(event.eventDate)}
                </Text>
              </View>
              <View style={styles.eventDetailItem}>
                <MapPin size={16} color={Colors.dark.text} />
                <Text style={styles.eventDetailText}>
                  {event.location.name}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Event Description */}
        {event.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About This Event</Text>
            <Text style={styles.eventDescription}>{event.description}</Text>
          </View>
        )}

        {/* Host Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hosted By</Text>
          <View style={styles.hostContainer}>
            <Image
              source={{ uri: event.user.avatar }}
              style={styles.hostAvatar}
              contentFit="cover"
            />
            <View style={styles.hostInfo}>
              <Text style={styles.hostName}>{event.user.name}</Text>
              {event.user.businessName && (
                <Text style={styles.businessName}>{event.user.businessName}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Products Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Items</Text>
          {products.map((product) => {
            const cartItem = cart.find((item) => item.product.id === product.id);
            return (
              <View key={product.id} style={styles.productCard}>
                <Image
                  source={{ uri: product.image }}
                  style={styles.productImage}
                  contentFit="cover"
                />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productDescription}>
                    {product.description}
                  </Text>
                  <Text style={styles.productPrice}>
                    ₦{product.price.toFixed(2)}
                  </Text>
                  <Text style={styles.productAvailable}>
                    {product.available - (product.sold || 0)} available
                  </Text>
                </View>
                <View style={styles.productActions}>
                  {cartItem ? (
                    <View style={styles.quantityControls}>
                      <TouchableOpacity
                        style={styles.quantityButton}
                        onPress={() =>
                          updateQuantity(product.id, cartItem.quantity - 1)
                        }
                      >
                        <Text style={styles.quantityButtonText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.quantityText}>{cartItem.quantity}</Text>
                      <TouchableOpacity
                        style={styles.quantityButton}
                        onPress={() =>
                          updateQuantity(product.id, cartItem.quantity + 1)
                        }
                      >
                        <Text style={styles.quantityButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => addToCart(product)}
                    >
                      <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Cart Summary */}
        {cart.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order Summary</Text>
            {cart.map((item) => (
              <View key={item.product.id} style={styles.cartItem}>
                <Text style={styles.cartItemName}>{item.product.name}</Text>
                <Text style={styles.cartItemQuantity}>x{item.quantity}</Text>
                <Text style={styles.cartItemPrice}>
                  ₦{(item.product.price * item.quantity).toFixed(2)}
                </Text>
              </View>
            ))}
            <View style={styles.cartSummary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal:</Text>
                <Text style={styles.summaryValue}>
                  ₦{calculateSubtotal().toFixed(2)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tax (8%):</Text>
                <Text style={styles.summaryValue}>
                  ₦{calculateTax(calculateSubtotal()).toFixed(2)}
                </Text>
              </View>
              <View style={[styles.summaryRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total:</Text>
                <Text style={styles.totalValue}>
                  ₦{calculateTotal().toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Checkout Button */}
      {cart.length > 0 && (
        <View style={styles.checkoutContainer}>
          <TouchableOpacity style={styles.checkoutButton} onPress={handleCheckout}>
            <ShoppingBag size={20} color={Colors.dark.text} />
            <Text style={styles.checkoutButtonText}>
              Checkout (₦{calculateTotal().toFixed(2)})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Checkout Modal */}
      <Modal
        visible={showCheckout}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Checkout</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowCheckout(false)}
            >
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* User Type Selection */}
            {!user && (
              <View style={styles.userTypeSection}>
                <Text style={styles.sectionTitle}>Continue as:</Text>
                <View style={styles.userTypeButtons}>
                  <TouchableOpacity
                    style={[
                      styles.userTypeButton,
                      isGuest && styles.userTypeButtonActive,
                    ]}
                    onPress={() => setIsGuest(true)}
                  >
                    <Text
                      style={[
                        styles.userTypeButtonText,
                        isGuest && styles.userTypeButtonTextActive,
                      ]}
                    >
                      Guest
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.userTypeButton,
                      !isGuest && styles.userTypeButtonActive,
                    ]}
                    onPress={() => {
                      setIsGuest(false);
                      router.push('/signin');
                    }}
                  >
                    <Text
                      style={[
                        styles.userTypeButtonText,
                        !isGuest && styles.userTypeButtonTextActive,
                      ]}
                    >
                      Sign In
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Guest Information */}
            {isGuest && (
              <View style={styles.guestInfoSection}>
                <Text style={styles.sectionTitle}>Your Information</Text>
                <View style={styles.inputContainer}>
                  <User size={20} color={Colors.dark.subtext} />
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor={Colors.dark.subtext}
                    value={guestData.name}
                    onChangeText={(text) =>
                      setGuestData((prev) => ({ ...prev, name: text }))
                    }
                  />
                </View>
                <View style={styles.inputContainer}>
                  <Mail size={20} color={Colors.dark.subtext} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor={Colors.dark.subtext}
                    value={guestData.email}
                    onChangeText={(text) =>
                      setGuestData((prev) => ({ ...prev, email: text }))
                    }
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.inputContainer}>
                  <Phone size={20} color={Colors.dark.subtext} />
                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number (Optional)"
                    placeholderTextColor={Colors.dark.subtext}
                    value={guestData.phone}
                    onChangeText={(text) =>
                      setGuestData((prev) => ({ ...prev, phone: text }))
                    }
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            )}

            {/* Order Summary */}
            <View style={styles.checkoutSummary}>
              <Text style={styles.sectionTitle}>Order Summary</Text>
              {cart.map((item) => (
                <View key={item.product.id} style={styles.checkoutItem}>
                  <Text style={styles.checkoutItemName}>{item.product.name}</Text>
                  <Text style={styles.checkoutItemDetails}>
                    {item.quantity} x ₦{item.product.price.toFixed(2)}
                  </Text>
                  <Text style={styles.checkoutItemTotal}>
                    ₦{(item.product.price * item.quantity).toFixed(2)}
                  </Text>
                </View>
              ))}
              <View style={styles.checkoutTotals}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal:</Text>
                  <Text style={styles.summaryValue}>
                    ₦{calculateSubtotal().toFixed(2)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Tax (8%):</Text>
                  <Text style={styles.summaryValue}>
                    ₦{calculateTax(calculateSubtotal()).toFixed(2)}
                  </Text>
                </View>
                <View style={[styles.summaryRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Total:</Text>
                  <Text style={styles.totalValue}>
                    ₦{calculateTotal().toFixed(2)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Guest Email Notice */}
            {isGuest && (
              <View style={styles.noticeContainer}>
                <Info size={16} color={Colors.dark.primary} />
                <Text style={styles.noticeText}>
                  Your order confirmation and PDF will be sent to your email address.
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Process Order Button */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[
                styles.processOrderButton,
                isProcessing && styles.processOrderButtonDisabled,
              ]}
              onPress={processOrder}
              disabled={isProcessing}
            >
              <CreditCard size={20} color={Colors.dark.text} />
              <Text style={styles.processOrderButtonText}>
                {isProcessing ? 'Processing...' : 'Pay Now'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  eventHeader: {
    height: 300,
    position: 'relative',
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  eventOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 20,
  },
  eventTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  eventDetails: {
    gap: 8,
  },
  eventDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventDetailText: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  eventDescription: {
    fontSize: 16,
    color: Colors.dark.text,
    lineHeight: 24,
  },
  hostContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hostAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  hostInfo: {
    flex: 1,
  },
  hostName: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  businessName: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginTop: 2,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  productDescription: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  productPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.primary,
    marginBottom: 4,
  },
  productAvailable: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  productActions: {
    justifyContent: 'center',
  },
  addButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonText: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
    minWidth: 24,
    textAlign: 'center',
  },
  cartItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  cartItemName: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark.text,
  },
  cartItemQuantity: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginHorizontal: 12,
  },
  cartItemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  cartSummary: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  summaryValue: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    paddingTop: 8,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  checkoutContainer: {
    padding: 20,
    backgroundColor: Colors.dark.card,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  checkoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  checkoutButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    flex: 1,
  },
  userTypeSection: {
    padding: 20,
  },
  userTypeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  userTypeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.dark.divider,
    alignItems: 'center',
  },
  userTypeButtonActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
  },
  userTypeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  userTypeButtonTextActive: {
    color: Colors.dark.primary,
  },
  guestInfoSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark.text,
  },
  checkoutSummary: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  checkoutItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkoutItemName: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark.text,
  },
  checkoutItemDetails: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginHorizontal: 12,
  },
  checkoutItemTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  checkoutTotals: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  noticeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    borderRadius: 8,
    padding: 16,
    margin: 20,
    gap: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 20,
  },
  modalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  processOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  processOrderButtonDisabled: {
    opacity: 0.6,
  },
  processOrderButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 18,
    color: Colors.dark.primary,
    marginBottom: 16,
  },
  successMessage: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  backToEventButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  backToEventButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: Colors.dark.text,
  },
});