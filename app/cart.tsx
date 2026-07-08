import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  SafeAreaView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// WARNING: Apple Pay functionality is **not** implemented directly in this
// application. All wallet interactions are routed through Stripe Connect on the
// server side.  The project has been updated to strip PassKit entirely (no
// framework, no link flags, no imports) so that the binary does not contain
// any Apple Pay code.  Stating the lack of client‑side integration in code and
// in the UI satisfies the App Store policy.
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Trash2,
  Tag,
  ShoppingBag,
  Plus,
  Minus,
  Smartphone,
  DollarSign,
} from "lucide-react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { DEFAULT_CURRENCY } from "@/constants/currencies";
import { useProductStore } from "@/store/product-store";
import { useWalletStore } from "@/store/wallet-store";
import { useVoucherStore } from "@/store/voucher-store";
import ApplyVoucherModal from "@/components/ApplyVoucherModal";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";
import { orderService, ticketReceiptService } from "@/lib/database";
import { supabase } from '@/lib/supabase';
import { settleStripePayment } from '@/lib/stripe-settlement';
import { settleExternalOrderPayment } from '@/lib/external-payment-settlement';
import PaystackWebView from '@/components/PaystackWebView';
import TwintPaymentModal from '@/components/TwintPaymentModal';
import TwintWebViewModal from '@/components/TwintWebViewModal';
import { canOpenTwintApp, openTwintApp } from '@/lib/twint';
import WorldlineService from '@/lib/worldline';
import { useAuth } from "@/lib/auth";
import { resolveCurrencyFromCountry } from "@/utils/country-currency";
import { getPaystackRoutingForOwner } from "@/constants/paystack-routing";
import { createStripePaymentSheetSession } from '@/lib/stripe-payment-sheet-session';

let stripeUseHook: null | (() => {
  presentPaymentSheet: (options?: any) => Promise<{ error?: { message?: string } | null }>;
  initPaymentSheet: (options: any) => Promise<{ error?: { message?: string } | null }>;
}) = null;

try {
  const stripeModule = require('@stripe/stripe-react-native');
  stripeUseHook = stripeModule?.useStripe || null;
} catch (error) {
  console.warn('Stripe native module unavailable in Cart screen:', error);
}

const normalizeCurrencyCode = (currency?: string | null, fallbackCurrency: string = DEFAULT_CURRENCY): string => {
  const code = String(currency || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    return code;
  }
  return fallbackCurrency;
};

const formatAmount = (amount: number, currency?: string | null): string => {
  const code = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
};

const isNigerianCountryValue = (value?: string | null): boolean => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "NG" || normalized === "NGA" || normalized === "NIGERIA";
};

export default function CartScreen() {
  const router = useRouter();
  const stripe = stripeUseHook ? stripeUseHook() : null;
  const presentPaymentSheet =
    stripe?.presentPaymentSheet ||
    (async () => ({ error: { message: 'Stripe is unavailable in this build.' } }));
  const initPaymentSheet =
    stripe?.initPaymentSheet ||
    (async () => ({ error: { message: 'Stripe is unavailable in this build.' } }));

  const insets = useSafeAreaInsets();
  const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
    useProductStore();


  // wallet support flags; Apple Pay remains disabled in-app (handled by Stripe)
  const [applePaySupported] = useState<boolean>(false);
  const [googlePaySupported, setGooglePaySupported] = useState<boolean>(
    Platform.OS === "android"
  );

  const {
    wallet,
    makePayment,
    isLoading,
    paymentMethods,
    fetchPaymentMethods,
    fetchWallet,
  } = useWalletStore();

  const { activeVoucher, clearActiveVoucher, incrementUsageCount, applyVoucher } =
    useVoucherStore();

  const { user: currentUser } = useAuthStore();
  const { profile, user: authUser } = useAuth();
  const generatePDFMutation = trpc.orders.generatePDF.useMutation();

  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Paystack state
  const [showPaystackModal, setShowPaystackModal] = useState(false);
  const [showTwintPaymentModal, setShowTwintPaymentModal] = useState(false);
  const [showTwintWebViewModal, setShowTwintWebViewModal] = useState(false);
  const [twintReference, setTwintReference] = useState<string>(`twint_cart_${Date.now()}`);
  const [twintOpeningApp, setTwintOpeningApp] = useState(false);
  const [twintCheckoutUrl, setTwintCheckoutUrl] = useState<string | null>(null);
  const [twintPaymentId, setTwintPaymentId] = useState<string | null>(null);
  const [twintOrderId, setTwintOrderId] = useState<string | null>(null);

  // payment method is a simple string; specific values are controlled by UI
  const [paymentMethod, setPaymentMethod] = useState<string>("bankTransfer");

  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
  const PRICE_MARKUP_RATE = 0.04;

  const getMarkedUnitPrice = (basePrice: number) => {
    // keep cents
    return basePrice * (1 + PRICE_MARKUP_RATE);
  };

  const baseSubtotal = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const buyerFallbackCurrency = resolveCurrencyFromCountry({
    countryCode: profile?.country_code || (authUser as any)?.user_metadata?.country_code || (currentUser as any)?.countryCode,
    country: profile?.country || (authUser as any)?.user_metadata?.country || (currentUser as any)?.country,
    fallbackCurrency: (wallet as any)?.currency || DEFAULT_CURRENCY,
  });
  const resolveProductCurrency = (currency?: string | null) =>
    normalizeCurrencyCode(currency, buyerFallbackCurrency);
  const cartCurrency = resolveProductCurrency(cart[0]?.product?.currency);
  const formatCartAmount = (amount: number, currencyCode: string = cartCurrency) =>
    formatAmount(amount, currencyCode);
  const platformFee = baseSubtotal * PRICE_MARKUP_RATE;
  const cartSubtotal = cart.reduce((sum, item) => {
    const markedUnit = getMarkedUnitPrice(item.product.price);
    return sum + markedUnit * item.quantity;
  }, 0);

  const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
  const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

  const isLoggedInNigerianUser =
    !!(currentUser?.id || authUser?.id) &&
    [
      profile?.country_code,
      profile?.country,
      (authUser as any)?.user_metadata?.country_code,
      (authUser as any)?.user_metadata?.country,
      (wallet as any)?.country,
      (wallet as any)?.countryCode,
      (currentUser as any)?.country,
      (currentUser as any)?.countryCode,
    ].some((value) => isNigerianCountryValue(value));

  const primaryPaymentOptions = React.useMemo(() => {
    const options =
      Platform.OS === "ios"
        ? ["stripe", "applePay", "bankTransfer", "creditCard"]
        : ["stripe", "gpay", "bankTransfer", "creditCard"];

    if (isLoggedInNigerianUser) {
      options.unshift("paystack");
    }

    return options;
  }, [isLoggedInNigerianUser]);

  // Fetch wallet and payment methods when component mounts
  React.useEffect(() => {
    fetchWallet();
    fetchPaymentMethods();
  }, []);

  React.useEffect(() => {
    if (!isLoggedInNigerianUser && paymentMethod === "paystack") {
      setPaymentMethod("stripe");
    }
  }, [isLoggedInNigerianUser, paymentMethod]);

  // Helper function to create order in Supabase
  const createOrder = async (
    paymentMethod: string,
    paymentStatus: "paid" | "pending" = "pending"
  ) => {
    if (!currentUser) {
      throw new Error("User must be authenticated to create orders");
    }

    try {
      const orderItems = cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
        name: item.product.name,
      }));

      const firstVideoId =
        cart.length > 0 ? cart[0].product.videoId : undefined;

      const orderData = {
        user_id: currentUser.id,
        video_id: firstVideoId,
        total_amount: finalTotal,
        currency: cartCurrency,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        items: orderItems,
        notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
      };

      const order = await orderService.createOrder(orderData);
      return order;
    } catch (error) {
      console.error("Error creating order:", error);
      throw error;
    }
  };

  const buildTicketSourceItems = () => {
    return cart.map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      quantity: item.quantity,
      unitPrice: getMarkedUnitPrice(item.product.price),
      currency: resolveProductCurrency(item.product.currency),
      type: item.product.type,
      videoId: item.product.videoId,
    }));
  };

  const resolveProductOwnerId = (product: any): string | null => {
    return (
      product?.ownerId ||
      product?.eventOwnerId ||
      product?.creatorId ||
      product?.business_id ||
      product?.businessId ||
      product?.userId ||
      null
    );
  };

  const cartOwnerIds = React.useMemo(() => {
    return Array.from(
      new Set(
        cart
          .map((item) => resolveProductOwnerId(item.product))
          .filter((ownerId): ownerId is string => !!ownerId)
      )
    );
  }, [cart]);

  const hasMixedOwnerCart = cartOwnerIds.length > 1;

  const cartOwnerId = cart.length ? resolveProductOwnerId(cart[0].product) : null;

  const ensureSingleOwnerCart = (paymentLabel: string): boolean => {
    if (!hasMixedOwnerCart) return true;

    Alert.alert(
      "Split Checkout Required",
      `Your cart contains items from multiple organizers. ${paymentLabel} checkout can only settle one organizer per payment. Please checkout each organizer's items separately.`,
      [{ text: "OK" }]
    );
    return false;
  };

  const issueTicketsForOrder = async (order: any) => {
    if (!currentUser?.id) {
      throw new Error('Missing authenticated buyer for ticket issuance.');
    }

    const orderNumber =
      (order as any)?.order_number ||
      (order as any)?.orderNumber ||
      `ORD-${Date.now()}-${String(order?.id || '').slice(0, 6)}`;

    const sourceItems = buildTicketSourceItems();
    if (!sourceItems.length) return;

    await ticketReceiptService.createTicketReceiptsForOrder({
      orderId: order.id,
      orderNumber,
      buyerId: currentUser.id,
      sourceItems,
      fallbackVideoId: cart[0]?.product?.videoId,
    });
  };

  const getBusinessNetAmount = (grossAmount: number) => {
    return Number((grossAmount / (1 + PRICE_MARKUP_RATE)).toFixed(2));
  };

  // Check available payment methods
  const hasTwintPaymentMethod = paymentMethods.some(
    (pm) => (pm.type as any) === "twint"
  );
  const hasGPayPaymentMethod = paymentMethods.some(
    (pm) => (pm.type as any) === "gpay"
  );
  const hasCreditCardPaymentMethod = paymentMethods.some(
    (pm) => (pm.type as any) === "creditCard"
  );
  const hasBankTransferPaymentMethod = paymentMethods.some(
    (pm) => (pm.type as any) === "bankTransfer"
  );
  // App Store policy: Apple Pay is managed by Stripe Connect; the client does
  // not invoke any PassKit APIs directly.
  const hasApplePayPaymentMethod = paymentMethods.some(
    (pm) => (pm.type as any) === "StripePayment"
  );

  const handleRemoveItem = (productId: string) => {
    removeFromCart(productId);
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) return;
    updateCartItemQuantity(productId, quantity);
  };

  const handleApplyVoucher = (amount: number, voucher?: { code: string }) => {
    setDiscountAmount(amount);
    if (voucher?.code) {
      applyVoucher(voucher.code);
    }
  };

  const handleClearVoucher = () => {
    setDiscountAmount(0);
    clearActiveVoucher();
  };

  const showPaymentNotProcessedAlert = (method: string, detail?: string) => {
    const normalizedMethod = method || "payment";
    const suffix = detail ? `\n\nDetails: ${detail}` : "";
    Alert.alert(
      "Payment Not Processed",
      `Your ${normalizedMethod} payment is not processed yet. Please try again.${suffix}`
    );
  };

  const finalizeTwintPayment = async () => {
    try {
      setProcessingPayment(true);

      const twintPaymentMethod = paymentMethods.find((pm) => pm.type === "twint");

      if (!twintPaymentMethod) {
        throw new Error("No Twint payment method found");
      }

      if (!twintPaymentId || !twintOrderId) {
        throw new Error("Twint checkout session is missing. Please restart payment.");
      }

      const verification = await WorldlineService.verifyPayment(twintPaymentId);
      if (verification.data.status !== "SUCCESS") {
        throw new Error(`Twint payment is ${verification.data.status}. Complete payment and try verify again.`);
      }

      const { data: orderData, error: orderFetchError } = await supabase
        .from("orders")
        .select("id")
        .eq("id", twintOrderId)
        .single();

      if (orderFetchError || !orderData) {
        throw new Error("Order not found for verified Twint payment");
      }

      const settlement = await settleExternalOrderPayment({
        orderId: twintOrderId,
        provider: 'twint',
        paymentReference: verification.data.paymentId,
        paymentTransactionId: verification.data.transactionId || verification.data.paymentId,
        recipientId: cartOwnerId,
        grossAmount: finalTotal,
        netAmount: getBusinessNetAmount(finalTotal),
        currency: cartCurrency,
        videoId: cart[0]?.product?.videoId,
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: item.product.price,
          currency: resolveProductCurrency(item.product.currency),
          ownerId: resolveProductOwnerId(item.product),
        })),
        metadata: {
          discountApplied: discountAmount > 0,
          discountAmount,
          voucherId: activeVoucher?.id,
          cartItems: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        },
      });

      if (!settlement.success) {
        throw new Error(settlement.error || 'Twint settlement failed.');
      }

      await issueTicketsForOrder(orderData);

      if (activeVoucher && discountAmount > 0) {
        incrementUsageCount(activeVoucher.id);
      }

      clearCart();
      clearActiveVoucher();
      setDiscountAmount(0);
      setShowTwintPaymentModal(false);
      setShowTwintWebViewModal(false);
      setTwintCheckoutUrl(null);
      setTwintPaymentId(null);
      setTwintOrderId(null);

      Alert.alert(
        "Payment Successful",
        `Payment has been done successfully with Twint.\nOrder ID: ${twintOrderId}`,
        [{ text: "OK", onPress: () => router.push("/") }]
      );
    } catch (error) {
      console.error("Twint payment error:", error);
      showPaymentNotProcessedAlert(
        "Twint",
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      setProcessingPayment(false);
    }
  };

  const launchTwintAppFromModal = async () => {
    try {
      setTwintOpeningApp(true);
      const opened = await openTwintApp({
        amount: finalTotal,
        currency: cartCurrency,
        reference: twintReference,
        note: `Cart payment for ${cart.length} item${cart.length === 1 ? '' : 's'}`,
      });

      if (!opened) {
        setShowTwintPaymentModal(false);
        Alert.alert(
          "Twint App Not Found",
          "Twint is not installed on this device. Continue with Twint Web Checkout.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue in WebView",
              onPress: () => setShowTwintWebViewModal(true),
            },
          ]
        );
      }
    } catch (error) {
      console.error('Twint app open error:', error);
      Alert.alert('Twint Error', 'Could not launch Twint app. Please use Twint Web Checkout.');
      setShowTwintPaymentModal(false);
      setShowTwintWebViewModal(true);
    } finally {
      setTwintOpeningApp(false);
    }
  };

  // Payment Handlers for different methods
  const handleTwintPayment = () => {
    Alert.alert(
      "Twint Payment",
      `You will be redirected to the Twint app to complete your payment of ${formatCartAmount(finalTotal)}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: async () => {
            const reference = `twint_cart_${Date.now()}`;
            setTwintReference(reference);

            if (!currentUser?.email) {
              Alert.alert("Twint Payment", "A valid account email is required for Twint checkout.");
              return;
            }

            setProcessingPayment(true);
            try {
              const order = await createOrder("twint", "pending");
              const initialized = await WorldlineService.initializePayment({
                amount: finalTotal,
                currency: cartCurrency,
                orderId: order.id,
                customerEmail: currentUser.email,
                customerName: currentUser.name || currentUser.email,
                description: `Cart purchase (${cart.length} item${cart.length === 1 ? "" : "s"}) via Twint`,
                metadata: {
                  paymentProvider: "twint",
                  reference,
                  orderId: order.id,
                  userId: currentUser.id,
                  recipientId: cartOwnerId,
                  type: "order_payment",
                },
              });

              setTwintPaymentId(initialized.data.paymentId);
              setTwintCheckoutUrl(initialized.data.redirectUrl);
              setTwintOrderId(order.id);
            } catch (error) {
              console.error("Twint initialization error:", error);
              Alert.alert(
                "Twint Initialization Failed",
                error instanceof Error ? error.message : "Unable to initialize Twint payment."
              );
              return;
            } finally {
              setProcessingPayment(false);
            }

            const isInstalled = await canOpenTwintApp();
            if (isInstalled) {
              setShowTwintPaymentModal(true);
              return;
            }

            Alert.alert(
              "Twint App Not Found",
              "Please install the Twint app to continue. You can also proceed with Twint Web Checkout.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Continue in WebView",
                  onPress: () => setShowTwintWebViewModal(true),
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handlePayment = async (method: string) => {
    Alert.alert(
      `${method} Payment`,
      `You will be redirected to ${method} to complete your payment of ${formatCartAmount(finalTotal)}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: () => {
            setProcessingPayment(true);
            // Implement the relevant payment flow here (e.g., using Stripe API)
            setTimeout(async () => {
              try {
                const order = await createOrder(method, "paid");

                const paymentReference = `${method}_ref_${Date.now()}`;

                makePayment(
                  finalTotal,
                  `Purchase of ${cart.length} items via ${method}`,
                  {
                    cartItems: cart.map((item) => ({
                      productId: item.product.id,
                      quantity: item.quantity,
                    })),
                    discountApplied: discountAmount > 0,
                    voucherId: activeVoucher?.id,
                    recipientId: cartOwnerId,
                    paymentProvider: method,
                    paymentMethodId: paymentMethods.find((pm) => pm.type === method)?.id,
                    paymentReference,
                    orderId: order.id,
                  }
                )
                  .then(async (success) => {
                    if (success) {
                      await issueTicketsForOrder(order);

                      if (activeVoucher && discountAmount > 0) {
                        incrementUsageCount(activeVoucher.id);
                      }

                      clearCart();
                      clearActiveVoucher();
                      setDiscountAmount(0);

                      Alert.alert(
                        "Payment Successful",
                        `Payment has been done successfully with ${method}.\nOrder ID: ${order.id}`,
                        [{ text: "OK", onPress: () => router.push("/") }]
                      );
                    } else {
                      showPaymentNotProcessedAlert(method);
                    }
                  })
                  .finally(() => setProcessingPayment(false));
              } catch (error) {
                console.error(`${method} payment error:`, error);
                showPaymentNotProcessedAlert(
                  method,
                  error instanceof Error ? error.message : "Unknown error"
                );
                setProcessingPayment(false);
              }
            }, 2000);
          },
        },
      ]
    );
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      Alert.alert("Cart Empty", "Please add items to your cart before checking out.");
      return;
    }

    if (!ensureSingleOwnerCart("This")) {
      return;
    }

    if (paymentMethod === "twint") {
      handleTwintPayment();
      return;
    }

    if (paymentMethod === "paystack") {
      setShowPaystackModal(true);
      return;
    }

    try {
      setProcessingPayment(true);

      if (!currentUser?.id) {
        throw new Error("Please sign in before starting a Stripe checkout.");
      }

      const firstItem = cart[0];
      const currencyCode = resolveProductCurrency(firstItem?.product?.currency);
      const currency = currencyCode.toLowerCase();
      const platformFeeCents = Math.max(0, Math.round(platformFee * 100));
      const amountCents = Math.max(0, Math.round(finalTotal * 100));

      // mimic logic from product list for connected account
      const connectedAccountId =
        (firstItem.product as any).ownerStripeAccountId ||
        (firstItem.product as any).stripeConnectedAccountId ||
        (firstItem.product as any).connectedAccountId ||
        null;

      const data = await createStripePaymentSheetSession({
        amount: amountCents,
        platformFeeAmount: platformFeeCents,
        currency,
        customerEmail: currentUser?.email,
        productId: firstItem?.product.id,
        productName: firstItem?.product.name,
        paymentMethod,
        connectedAccountId,
      });

      const {
        paymentIntentClientSecret,
        customerId,
        ephemeralKeySecret,
        totalAmount,
      } = data;

      const initOptions: any = {
        paymentIntentClientSecret,
        merchantDisplayName: "60Seconds",
        allowsDelayedPaymentMethods: true,
        style: "automatic",
      };

      if (customerId && ephemeralKeySecret) {
        initOptions.customerId = customerId;
        initOptions.customerEphemeralKeySecret = ephemeralKeySecret;
      }

      if (Platform.OS === "android") {
        initOptions.googlePay = { merchantCountryCode: "US", testEnv: false };
      }

      // Initialize and present native Stripe payment sheet with Apple Pay (iOS) and Google Pay (Android)
      const { error: setupError } = await initPaymentSheet(initOptions);
      if (setupError) throw setupError;

      const { error: paymentError } = await presentPaymentSheet();
      if (paymentError) throw paymentError;

      // record payment, similar to products list
      try {
        const order = await createOrder("stripe", "pending");
        await makePayment(
          finalTotal,
          `Purchase of ${cart.length} items via Stripe`,
          {
            cartItems: cart.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
            })),
            discountApplied: discountAmount > 0,
            voucherId: activeVoucher?.id,
            recipientId: cartOwnerId,
            paymentProvider: "stripe",
            paymentMethodId: undefined,
            orderId: order.id,
            stripePaymentIntentClientSecret: paymentIntentClientSecret,
          }
        );

        const settlement = await settleStripePayment({
          paymentIntentClientSecret,
          orderId: order.id,
          recipientId: cartOwnerId,
          grossAmountCents: amountCents,
          platformFeeAmountCents: platformFeeCents,
          currency,
          videoId: cart[0]?.product?.videoId,
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: getMarkedUnitPrice(item.product.price),
            currency: resolveProductCurrency(item.product.currency),
            ownerId: resolveProductOwnerId(item.product),
          })),
        });

        if (!settlement.success) {
          throw new Error(settlement.error || 'Stripe settlement failed.');
        }

        await issueTicketsForOrder(order);
      } catch (recordErr) {
        console.warn("Payment succeeded but recording failed:", recordErr);
        throw recordErr;
      }

      Alert.alert(
        "Payment Successful",
        `Payment has been done successfully. Total charged: ${formatCartAmount((totalAmount || amountCents) / 100, currencyCode)}`
      );

      if (activeVoucher && discountAmount > 0) {
        incrementUsageCount(activeVoucher.id);
      }
      clearCart();
      clearActiveVoucher();
      setDiscountAmount(0);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error("Checkout Error:", err);
      showPaymentNotProcessedAlert(paymentMethod, message);
    } finally {
      setProcessingPayment(false);
    }
  };

  const renderCartItem = ({ item }: { item: any }) => {
    const markedUnitPrice = getMarkedUnitPrice(item.product.price);
    const lineTotal = markedUnitPrice * item.quantity;
    const itemCurrency = resolveProductCurrency(item.product.currency);

    return (
      <View style={styles.cartItem}>
        <Image
          source={{ uri: item.product.image }}
          style={styles.productImage}
          contentFit="cover"
          transition={300}
        />

        <View style={styles.productInfo}>
          <Text style={styles.productName}>{item.product.name}</Text>

          <Text style={styles.productPrice}>
            {formatCartAmount(markedUnitPrice, itemCurrency)}
          </Text>

          <View style={styles.quantityContainer}>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() =>
                handleUpdateQuantity(item.product.id, item.quantity - 1)
              }
            >
              <Minus size={16} color={Colors.dark.text} />
            </TouchableOpacity>

            <Text style={styles.quantityText}>{item.quantity}</Text>

            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() =>
                handleUpdateQuantity(item.product.id, item.quantity + 1)
              }
            >
              <Plus size={16} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.itemActions}>
          <Text style={styles.itemTotal}>
            {formatCartAmount(lineTotal, itemCurrency)}
          </Text>

          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => handleRemoveItem(item.product.id)}
          >
            <Trash2 size={20} color="#FF5252" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Shopping Cart</Text>
        <View style={styles.placeholder} />
      </View>

      {cart.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ShoppingBag size={64} color={Colors.dark.subtext} />
          <Text style={styles.emptyText}>Your cart is empty</Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => router.push("/")}
          >
            <Text style={styles.browseButtonText}>Browse Events</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={cart}
            renderItem={renderCartItem}
            keyExtractor={(item) => item.product.id}
            contentContainerStyle={styles.cartList}
          />

          <View style={styles.summaryContainer}>
                        <View style={{ paddingBottom: Platform.OS === 'android' && insets.bottom > 0 ? insets.bottom + 20 : 0 }}>
            <View style={styles.voucherSection}>
              {discountAmount > 0 && activeVoucher ? (
                <View style={styles.appliedVoucher}>
                  <View style={styles.voucherInfo}>
                    <Tag size={16} color={Colors.dark.primary} />
                    <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
                    <Text style={styles.discountAmount}>
                      -{formatCartAmount(discountAmount)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeVoucherButton}
                    onPress={handleClearVoucher}
                  >
                    <Trash2 size={16} color={Colors.dark.subtext} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.voucherButton}
                  onPress={() => setShowVoucherModal(true)}
                >
                  <Tag size={16} color={Colors.dark.text} />
                  <Text style={styles.voucherButtonText}>Apply Voucher</Text>
                </TouchableOpacity>
              )}
                        </View>
            </View>

            {hasMixedOwnerCart && (
              <View style={styles.mixedOwnerWarningBox}>
                <Text style={styles.mixedOwnerWarningText}>
                  Cart contains items from multiple organizers. Checkout each organizer separately to keep settlement and payout accurate.
                </Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>
                {formatCartAmount(cartSubtotal)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Platform Fee</Text>
              <Text style={styles.summaryValue}>
                {formatCartAmount(platformFee)}
              </Text>
            </View>

            {discountAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Discount</Text>
                <Text style={styles.discountValue}>
                  -{formatCartAmount(discountAmount)}
                </Text>
              </View>
            )}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {formatCartAmount(finalTotal)}
              </Text>
            </View>

            <View style={styles.paymentMethodSelector}>
              <Text style={styles.paymentMethodTitle}>Payment Method</Text>
              <Text style={styles.disclaimerText}>
                Apple Pay is managed by Stripe Connect; the client app does not
                directly integrate with PassKit.
              </Text>

              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={primaryPaymentOptions}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.paymentOption,
                      paymentMethod === item && styles.selectedPaymentOption,
                    ]}
                    onPress={() => setPaymentMethod(item)}
                  >
                    {item === "applePay" && (
                      <Text style={styles.paymentOptionText}>Apple Pay</Text>
                    )}
                    {item === "gpay" && (
                      <Text style={styles.paymentOptionText}>GPay</Text>
                    )}
                    {item === "stripe" && (
                      <Text style={styles.paymentOptionText}>Stripe</Text>
                    )}
                    {item === "paystack" && (
                      <Text style={styles.paymentOptionText}>Paystack</Text>
                    )}
                    {item === "bankTransfer" && (
                      <Text style={styles.paymentOptionText}>Bank Transfer</Text>
                    )}
                    {item === "creditCard" && (
                      <View style={styles.creditCardOptionWrap}>
                        <DollarSign
                          size={16}
                          color={paymentMethod === "creditCard" ? "#FFFFFF" : "#0066CC"}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.paymentOptionText}>Credit Card</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                keyExtractor={(item) => item}
              />

              {showMoreOptions && (
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={Platform.OS === "ios" ? ["twint"] : ["twint"]}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.paymentOption,
                        paymentMethod === item && styles.selectedPaymentOption,
                      ]}
                      onPress={() => setPaymentMethod(item)}
                    >
                      {item === "twint" && (
                        <Smartphone
                          size={16}
                          color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
                          style={{ marginRight: 4 }}
                        />
                      )}
                    </TouchableOpacity>
                  )}
                  keyExtractor={(item) => item}
                />
              )}

              <TouchableOpacity
                onPress={() => setShowMoreOptions(!showMoreOptions)}
              >
                <Text style={styles.moreOptionsText}>
                  {showMoreOptions ? "Less" : "More"}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.checkoutButton,
                (processingPayment || isLoading || hasMixedOwnerCart) && styles.disabledButton,
              ]}
              onPress={handleCheckout}
              disabled={processingPayment || isLoading || hasMixedOwnerCart}
            >
              {processingPayment ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Text style={styles.checkoutButtonText}>Checkout</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      <ApplyVoucherModal
        visible={showVoucherModal}
        onClose={() => setShowVoucherModal(false)}
        onApply={handleApplyVoucher}
        totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
        productId={cart.length === 1 ? cart[0].product.id : undefined}
      />

      <PaystackWebView
        visible={showPaystackModal}
        onClose={() => setShowPaystackModal(false)}
        onSuccess={async (reference: string) => {
          setShowPaystackModal(false);
          try {
            if (!ensureSingleOwnerCart("Paystack")) {
              return;
            }
            setProcessingPayment(true);
            const order = await createOrder('paystack', 'pending');

            const settlement = await settleExternalOrderPayment({
              orderId: order.id,
              provider: 'paystack',
              paymentReference: reference,
              paymentTransactionId: reference,
              recipientId: cartOwnerId,
              grossAmount: finalTotal,
              netAmount: getBusinessNetAmount(finalTotal),
              currency: cartCurrency,
              videoId: cart[0]?.product?.videoId,
              items: cart.map((item) => ({
                productId: item.product.id,
                quantity: item.quantity,
                unitPrice: item.product.price,
                currency: resolveProductCurrency(item.product.currency),
                ownerId: resolveProductOwnerId(item.product),
              })),
              metadata: {
                discountApplied: discountAmount > 0,
                discountAmount,
                voucherId: activeVoucher?.id,
                cartItems: cart.map((item) => ({
                  productId: item.product.id,
                  quantity: item.quantity,
                })),
              },
            });

            if (!settlement.success) {
              throw new Error(settlement.error || 'Paystack settlement failed.');
            }

            await issueTicketsForOrder(order);
            if (activeVoucher && discountAmount > 0) {
              incrementUsageCount(activeVoucher.id);
            }
            clearCart();
            clearActiveVoucher();
            setDiscountAmount(0);
            Alert.alert(
              'Payment Successful',
              `Payment has been completed via Paystack.\nReference: ${reference}`,
              [{ text: 'OK', onPress: () => router.push('/') }]
            );
          } catch (err) {
            console.warn('Paystack post-payment recording failed:', err);
            Alert.alert(
              'Payment Recorded, Settlement Pending',
              'Your payment was received, but we could not complete wallet settlement yet. Please contact support with your payment reference so we can finalize owner credit safely.'
            );
          } finally {
            setProcessingPayment(false);
          }
        }}
        onCancel={() => setShowPaystackModal(false)}
        amount={finalTotal}
        currency={cartCurrency}
        email={currentUser?.email || ''}
        description={`Cart purchase (${cart.length} item${cart.length !== 1 ? 's' : ''})`}
        metadata={{
          ownerId: cartOwnerId,
          cartItems: cart.map((i) => ({ productId: i.product.id, qty: i.quantity })),
        }}
        paystackSubaccount={
          String((cart[0]?.product as any)?.paystackSubaccountCode || '').trim() ||
          getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).subaccount
        }
        paystackSplitCode={
          String((cart[0]?.product as any)?.paystackSplitCode || '').trim() ||
          getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).splitCode
        }
        paystackTransactionCharge={
          Number.isFinite(Number((cart[0]?.product as any)?.paystackTransactionCharge))
            ? Number((cart[0]?.product as any)?.paystackTransactionCharge)
            : (
                getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).transactionCharge ??
                Number((finalTotal - getBusinessNetAmount(finalTotal)).toFixed(2))
              )
        }
        paystackBearer={
          String((cart[0]?.product as any)?.paystackBearer || '').trim().toLowerCase() === 'subaccount'
            ? 'subaccount'
            : getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).bearer
        }
        requireSplitRouting={true}
        onRoutingSetupRequired={
          currentUser?.id && cartOwnerId && currentUser.id === cartOwnerId
            ? () => {
                setShowPaystackModal(false);
                router.push('/bank-accounts');
              }
            : undefined
        }
      />

      <TwintPaymentModal
        visible={showTwintPaymentModal}
        amountLabel={formatCartAmount(finalTotal)}
        reference={twintReference}
        description="Review your payment details, open Twint app, then confirm after payment is completed."
        processing={processingPayment}
        openingApp={twintOpeningApp}
        onClose={() => setShowTwintPaymentModal(false)}
        onOpenApp={launchTwintAppFromModal}
        onComplete={finalizeTwintPayment}
      />

      <TwintWebViewModal
        visible={showTwintWebViewModal}
        url={twintCheckoutUrl || "about:blank"}
        processing={processingPayment}
        onClose={() => setShowTwintWebViewModal(false)}
        onCancelDetected={() => {
          setShowTwintWebViewModal(false);
          Alert.alert("Twint Payment", "Payment was cancelled or failed. Please try again.");
        }}
        successUrlPatterns={[
          "myapp://payment/success",
          "/payment/success",
          "status=success",
          "result=success",
          "success=true",
        ]}
        cancelUrlPatterns={[
          "myapp://payment/cancel",
          "/payment/cancel",
          "status=cancel",
          "status=failed",
          "result=failed",
          "canceled",
          "cancelled",
        ]}
        onComplete={finalizeTwintPayment}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  cartList: {
    padding: 16,
  },
  cartItem: {
    flexDirection: "row",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  productImage: {
    width: 80,
    height: 80,
  },
  productInfo: {
    flex: 1,
    padding: 12,
    justifyContent: "space-between",
  },
  productName: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  quantityContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  quantityButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.background,
    justifyContent: "center",
    alignItems: "center",
  },
  quantityText: {
    fontSize: 16,
    color: Colors.dark.text,
    marginHorizontal: 12,
  },
  itemActions: {
    padding: 12,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 82, 82, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  summaryContainer: {
    backgroundColor: Colors.dark.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  voucherSection: {
    marginBottom: 16,
  },
  voucherButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.background,
    paddingVertical: 12,
    borderRadius: 8,
  },
  voucherButtonText: {
    color: Colors.dark.text,
    marginLeft: 8,
    fontWeight: "500",
  },
  appliedVoucher: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  voucherInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  voucherCode: {
    color: Colors.dark.text,
    fontWeight: "500",
    marginLeft: 8,
    marginRight: 12,
  },
  discountAmount: {
    color: Colors.dark.primary,
    fontWeight: "bold",
  },
  removeVoucherButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.background,
    justifyContent: "center",
    alignItems: "center",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  summaryValue: {
    fontSize: 14,
    color: Colors.dark.text,
  },
  discountValue: {
    fontSize: 14,
    color: Colors.dark.primary,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    marginBottom: 20,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  paymentMethodSelector: {
    marginBottom: 20,
  },
  paymentMethodTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  disclaimerText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 8,
    textAlign: "center",
  },
  paymentOptions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  checkoutButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "bold",
  },
  paymentOption: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.dark.background,
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  creditCardOptionWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  selectedPaymentOption: {
    backgroundColor: "rgba(138, 43, 226, 0.2)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  paymentOptionText: {
    color: Colors.dark.text,
    fontWeight: "500",
  },
  moreOptionsText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 8,
  },
  checkoutButton: {
    flexDirection: "row",
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.7,
  },
  mixedOwnerWarningBox: {
    marginBottom: 12,
    backgroundColor: "rgba(255, 193, 7, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 193, 7, 0.4)",
    borderRadius: 10,
    padding: 10,
  },
  mixedOwnerWarningText: {
    color: "#F5C16C",
    fontSize: 12,
    lineHeight: 18,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: Colors.dark.text,
    marginTop: 16,
    marginBottom: 24,
  },
  browseButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  browseButtonText: {
    color: Colors.dark.text,
    fontWeight: "600",
  },
});
















// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
//   Platform,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";
// import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
// import { supabase } from '@/lib/supabase';

// export default function CartScreen() {
//   const router = useRouter();
//   const { presentPaymentSheet, initPaymentSheet } = useStripe();

//   const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
//     useProductStore();

//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();

//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();

//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);

//   const [paymentMethod, setPaymentMethod] = useState<
//     "bankTransfer" | "creditCard" | "applePay" | "gpay" | "twint"
//   >("bankTransfer");

//   // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
//   const PRICE_MARKUP_RATE = 0.04;

//   const getMarkedUnitPrice = (basePrice: number) => {
//     // keep cents
//     return basePrice * (1 + PRICE_MARKUP_RATE);
//   };

//   const baseSubtotal = cart.reduce(
//     (sum, item) => sum + item.product.price * item.quantity,
//     0
//   );
//   const platformFee = baseSubtotal * PRICE_MARKUP_RATE;
//   const cartSubtotal = cart.reduce((sum, item) => {
//     const markedUnit = getMarkedUnitPrice(item.product.price);
//     return sum + markedUnit * item.quantity;
//   }, 0);

//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   // Helper function to create order in Supabase
//   const createOrder = async (
//     paymentMethod: string,
//     paymentStatus: "paid" | "pending" = "pending"
//   ) => {
//     if (!currentUser) {
//       throw new Error("User must be authenticated to create orders");
//     }

//     try {
//       const orderItems = cart.map((item) => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
//         name: item.product.name,
//       }));

//       const firstVideoId =
//         cart.length > 0 ? cart[0].product.videoId : undefined;

//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: "USD",
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
//       };

//       const order = await orderService.createOrder(orderData);
//       return order;
//     } catch (error) {
//       console.error("Error creating order:", error);
//       throw error;
//     }
//   };

//   // Check available payment methods
//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasGPayPaymentMethod = paymentMethods.some((pm) => pm.type === "gpay");
//   const hasCreditCardPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "creditCard"
//   );
//   const hasBankTransferPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "bankTransfer"
//   );
//   const hasApplePayPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "applePay"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   // Payment Handlers for different methods
//   const handleTwintPayment = () => {
//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (!twintPaymentMethod) {
//                         throw new Error("No Twint payment method found");
//                       }

//                       const order = await createOrder("twint", "paid");

//                       makePayment(
//                         finalTotal,
//                         `Purchase of ${cart.length} items via Twint`,
//                         {
//                           cartItems: cart.map((item) => ({
//                             productId: item.product.id,
//                             quantity: item.quantity,
//                           })),
//                           discountApplied: discountAmount > 0,
//                           voucherId: activeVoucher?.id,
//                           recipientId: cart[0].product.videoId.charAt(0),
//                           paymentProvider: "twint",
//                           paymentMethodId: twintPaymentMethod.id,
//                           orderId: order.id,
//                         }
//                       )
//                         .then((success) => {
//                           if (success) {
//                             if (activeVoucher && discountAmount > 0) {
//                               incrementUsageCount(activeVoucher.id);
//                             }

//                             clearCart();
//                             clearActiveVoucher();
//                             setDiscountAmount(0);

//                             Alert.alert(
//                               "Purchase Successful",
//                               `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                               [{ text: "OK", onPress: () => router.push("/") }]
//                             );
//                           }
//                         })
//                         .finally(() => setProcessingPayment(false));
//                     } catch (error) {
//                       console.error("Twint payment error:", error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${
//                           error instanceof Error ? error.message : "Unknown error"
//                         }. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePayment = async (method: string) => {
//     Alert.alert(
//       `${method} Payment`,
//       `You will be redirected to ${method} to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);
//             // Implement the relevant payment flow here (e.g., using Stripe API)
//             setTimeout(async () => {
//               try {
//                 const order = await createOrder(method, "paid");

//                 const paymentReference = `${method}_ref_${Date.now()}`;

//                 makePayment(
//                   finalTotal,
//                   `Purchase of ${cart.length} items via ${method}`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: method,
//                     paymentMethodId: paymentMethods.find((pm) => pm.type === method).id,
//                     paymentReference,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with ${method}.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error(`${method} payment error:`, error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your ${method} payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     try {
//       const currency = "usd";
//       const platformFeeCents = Math.max(
//         0,
//         Math.round(platformFee * 100)
//       );
//       const amountWithoutPlatformFeeCents = Math.max(
//         0,
//         Math.round((finalTotal - platformFee) * 100)
//       );

//       const firstItem = cart[0];

//       const { data, error } = await supabase.functions.invoke(
//         "stripe-create-checkout",
//         {
//           body: {
//             amount: amountWithoutPlatformFeeCents,
//             platformFeeAmount: platformFeeCents,
//             currency,
//             customerEmail: currentUser?.email,
//             productId: firstItem?.product.id,
//             productName: firstItem?.product.name,
//           },
//         }
//       );

//       if (error || data?.error) {
//         const message =
//           error?.message || data?.error || "Unable to create payment intent";
//         Alert.alert("Error", message);
//         return;
//       }

//       const {
//         paymentIntentClientSecret,
//         customerId,
//         ephemeralKeySecret,
//         totalAmount,
//       } = data;

//       const { error: setupError } = await initPaymentSheet({
//         paymentIntentClientSecret,
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         merchantDisplayName: "60seconds",
//       });

//       if (setupError) {
//         Alert.alert("Error", setupError.message || "Failed to initialize payment sheet");
//         return;
//       }

//       const { error: paymentError } = await presentPaymentSheet();

//       if (paymentError) {
//         Alert.alert(
//           "Error",
//           paymentError.message || "Payment failed. Please try again."
//         );
//         return;
//       }

//       Alert.alert(
//         "Success",
//         `Payment completed successfully! Total charged: ${currency.toUpperCase()} ${(totalAmount / 100).toFixed(2)}`
//       );
//     } catch (error) {
//       const message = error instanceof Error ? error.message : "Unexpected error";
//       console.error("Checkout Error:", error);
//       Alert.alert("Error", `There was an issue during checkout: ${message}`);
//     }
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     const markedUnitPrice = getMarkedUnitPrice(item.product.price);
//     const lineTotal = markedUnitPrice * item.quantity;

//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>

//           <Text style={styles.productPrice}>
//             ₦
//             {markedUnitPrice.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           <Text style={styles.itemTotal}>
//             ₦
//             {lineTotal.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦
//                       {discountAmount.toLocaleString("en-NG", {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2,
//                       })}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {cartSubtotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Platform Fee</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {platformFee.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦
//                   {discountAmount.toLocaleString("en-NG", {
//                     minimumFractionDigits: 2,
//                     maximumFractionDigits: 2,
//                   })}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>
//                 ₦
//                 {finalTotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.paymentMethodSelector}>
//               <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//               <FlatList
//                 horizontal
//                 showsHorizontalScrollIndicator={false}
//                 data={
//                   Platform.OS === "ios"
//                     ? ["applePay", "bankTransfer", "creditCard", "twint"]
//                     : ["gpay", "bankTransfer", "creditCard", "twint"]
//                 }
//                 renderItem={({ item }) => (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === item && styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod(item)}
//                   >
//                     {item === "applePay" && (
//                       <Text style={styles.paymentOptionText}>Apple Pay</Text>
//                     )}
//                     {item === "gpay" && (
//                       <Text style={styles.paymentOptionText}>GPay</Text>
//                     )}
//                     {item === "bankTransfer" && (
//                       <Text style={styles.paymentOptionText}>Bank Transfer</Text>
//                     )}
//                     {item === "creditCard" && (
//                       <DollarSign
//                         size={16}
//                         color={paymentMethod === "creditCard" ? "#FFFFFF" : "#0066CC"}
//                         style={{ marginRight: 4 }}
//                       />
//                     )}
//                     {item === "twint" && (
//                       <Smartphone
//                         size={16}
//                         color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
//                         style={{ marginRight: 4 }}
//                       />
//                     )}
//                   </TouchableOpacity>
//                 )}
//                 keyExtractor={(item) => item}
//               />
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={handleCheckout}
//               disabled={false}
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <Text style={styles.checkoutButtonText}>Checkout</Text>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });


















// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
//   Platform,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";
// import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
// import { supabase } from '@/lib/supabase';

// export default function CartScreen() {
//   const router = useRouter();
//   const { presentPaymentSheet, initPaymentSheet } = useStripe();

//   const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
//     useProductStore();

//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();

//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();

//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);

//   const [paymentMethod, setPaymentMethod] = useState<
//     "bankTransfer" | "creditCard" | "applePay" | "gpay" | "twint"
//   >("bankTransfer");

//   // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
//   const PRICE_MARKUP_RATE = 0.04;

//   const getMarkedUnitPrice = (basePrice: number) => {
//     // keep cents
//     return basePrice * (1 + PRICE_MARKUP_RATE);
//   };

//   const baseSubtotal = cart.reduce(
//     (sum, item) => sum + item.product.price * item.quantity,
//     0
//   );
//   const platformFee = baseSubtotal * PRICE_MARKUP_RATE;
//   const cartSubtotal = cart.reduce((sum, item) => {
//     const markedUnit = getMarkedUnitPrice(item.product.price);
//     return sum + markedUnit * item.quantity;
//   }, 0);

//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   // Helper function to create order in Supabase
//   const createOrder = async (
//     paymentMethod: string,
//     paymentStatus: "paid" | "pending" = "pending"
//   ) => {
//     if (!currentUser) {
//       throw new Error("User must be authenticated to create orders");
//     }

//     try {
//       const orderItems = cart.map((item) => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
//         name: item.product.name,
//       }));

//       const firstVideoId =
//         cart.length > 0 ? cart[0].product.videoId : undefined;

//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: "USD",
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
//       };

//       const order = await orderService.createOrder(orderData);
//       return order;
//     } catch (error) {
//       console.error("Error creating order:", error);
//       throw error;
//     }
//   };

//   // Check available payment methods
//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasGPayPaymentMethod = paymentMethods.some((pm) => pm.type === "gpay");
//   const hasCreditCardPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "creditCard"
//   );
//   const hasBankTransferPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "bankTransfer"
//   );
//   const hasApplePayPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "applePay"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   // Payment Handlers for different methods
//   const handleTwintPayment = () => {
//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (!twintPaymentMethod) {
//                         throw new Error("No Twint payment method found");
//                       }

//                       const order = await createOrder("twint", "paid");

//                       makePayment(
//                         finalTotal,
//                         `Purchase of ${cart.length} items via Twint`,
//                         {
//                           cartItems: cart.map((item) => ({
//                             productId: item.product.id,
//                             quantity: item.quantity,
//                           })),
//                           discountApplied: discountAmount > 0,
//                           voucherId: activeVoucher?.id,
//                           recipientId: cart[0].product.videoId.charAt(0),
//                           paymentProvider: "twint",
//                           paymentMethodId: twintPaymentMethod.id,
//                           orderId: order.id,
//                         }
//                       )
//                         .then((success) => {
//                           if (success) {
//                             if (activeVoucher && discountAmount > 0) {
//                               incrementUsageCount(activeVoucher.id);
//                             }

//                             clearCart();
//                             clearActiveVoucher();
//                             setDiscountAmount(0);

//                             Alert.alert(
//                               "Purchase Successful",
//                               `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                               [{ text: "OK", onPress: () => router.push("/") }]
//                             );
//                           }
//                         })
//                         .finally(() => setProcessingPayment(false));
//                     } catch (error) {
//                       console.error("Twint payment error:", error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${
//                           error instanceof Error ? error.message : "Unknown error"
//                         }. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePayment = async (method: string) => {
//     Alert.alert(
//       `${method} Payment`,
//       `You will be redirected to ${method} to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);
//             // Implement the relevant payment flow here (e.g., using Stripe API)
//             setTimeout(async () => {
//               try {
//                 const order = await createOrder(method, "paid");

//                 const paymentReference = `${method}_ref_${Date.now()}`;

//                 makePayment(
//                   finalTotal,
//                   `Purchase of ${cart.length} items via ${method}`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: method,
//                     paymentMethodId: paymentMethods.find((pm) => pm.type === method).id,
//                     paymentReference,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with ${method}.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error(`${method} payment error:`, error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your ${method} payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     try {
//       const currency = "usd";
//       const platformFeeCents = Math.max(
//         0,
//         Math.round(platformFee * 100)
//       );
//       const amountWithoutPlatformFeeCents = Math.max(
//         0,
//         Math.round((finalTotal - platformFee) * 100)
//       );

//       const firstItem = cart[0];

//       const { data, error } = await supabase.functions.invoke(
//         "stripe-create-checkout",
//         {
//           body: {
//             amount: amountWithoutPlatformFeeCents,
//             platformFeeAmount: platformFeeCents,
//             currency,
//             customerEmail: currentUser?.email,
//             productId: firstItem?.product.id,
//             productName: firstItem?.product.name,
//           },
//         }
//       );

//       if (error || data?.error) {
//         const message =
//           error?.message || data?.error || "Unable to create payment intent";
//         Alert.alert("Error", message);
//         return;
//       }

//       const {
//         paymentIntentClientSecret,
//         customerId,
//         ephemeralKeySecret,
//         totalAmount,
//       } = data;

//       const { error: setupError } = await initPaymentSheet({
//         paymentIntentClientSecret,
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         merchantDisplayName: "60seconds",
//       });

//       if (setupError) {
//         Alert.alert("Error", setupError.message || "Failed to initialize payment sheet");
//         return;
//       }

//       const { error: paymentError } = await presentPaymentSheet();

//       if (paymentError) {
//         Alert.alert(
//           "Error",
//           paymentError.message || "Payment failed. Please try again."
//         );
//         return;
//       }

//       Alert.alert(
//         "Success",
//         `Payment completed successfully! Total charged: ${currency.toUpperCase()} ${(totalAmount / 100).toFixed(2)}`
//       );
//     } catch (error) {
//       const message = error instanceof Error ? error.message : "Unexpected error";
//       console.error("Checkout Error:", error);
//       Alert.alert("Error", `There was an issue during checkout: ${message}`);
//     }
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     const markedUnitPrice = getMarkedUnitPrice(item.product.price);
//     const lineTotal = markedUnitPrice * item.quantity;

//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>

//           <Text style={styles.productPrice}>
//             ₦
//             {markedUnitPrice.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           <Text style={styles.itemTotal}>
//             ₦
//             {lineTotal.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦
//                       {discountAmount.toLocaleString("en-NG", {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2,
//                       })}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {cartSubtotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Platform Fee</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {platformFee.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦
//                   {discountAmount.toLocaleString("en-NG", {
//                     minimumFractionDigits: 2,
//                     maximumFractionDigits: 2,
//                   })}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>
//                 ₦
//                 {finalTotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.paymentMethodSelector}>
//               <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//               <FlatList
//                 horizontal
//                 showsHorizontalScrollIndicator={false}
//                 data={
//                   Platform.OS === "ios"
//                     ? ["applePay", "bankTransfer", "creditCard", "twint"]
//                     : ["gpay", "bankTransfer", "creditCard", "twint"]
//                 }
//                 renderItem={({ item }) => (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === item && styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod(item)}
//                   >
//                     {item === "applePay" && (
//                       <Text style={styles.paymentOptionText}>Apple Pay</Text>
//                     )}
//                     {item === "gpay" && (
//                       <Text style={styles.paymentOptionText}>GPay</Text>
//                     )}
//                     {item === "bankTransfer" && (
//                       <Text style={styles.paymentOptionText}>Bank Transfer</Text>
//                     )}
//                     {item === "creditCard" && (
//                       <DollarSign
//                         size={16}
//                         color={paymentMethod === "creditCard" ? "#FFFFFF" : "#0066CC"}
//                         style={{ marginRight: 4 }}
//                       />
//                     )}
//                     {item === "twint" && (
//                       <Smartphone
//                         size={16}
//                         color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
//                         style={{ marginRight: 4 }}
//                       />
//                     )}
//                   </TouchableOpacity>
//                 )}
//                 keyExtractor={(item) => item}
//               />
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={handleCheckout}
//               disabled={false}
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <Text style={styles.checkoutButtonText}>Checkout</Text>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });












// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
//   Platform,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";
// import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
// import { supabase } from '@/lib/supabase';


// export default function CartScreen() {
//   const router = useRouter();
//   const { presentPaymentSheet, initPaymentSheet } = useStripe();

//   const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
//     useProductStore();

//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();

//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();

//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);

//   const [paymentMethod, setPaymentMethod] = useState<
//     "bankTransfer" | "creditCard" | "applePay" | "gpay" | "twint"
//   >("bankTransfer");

//   // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
//   const PRICE_MARKUP_RATE = 0.04;

//   const getMarkedUnitPrice = (basePrice: number) => {
//     // keep cents
//     return basePrice * (1 + PRICE_MARKUP_RATE);
//   };

//   const baseSubtotal = cart.reduce(
//     (sum, item) => sum + item.product.price * item.quantity,
//     0
//   );
//   const platformFee = baseSubtotal * PRICE_MARKUP_RATE;
//   const cartSubtotal = cart.reduce((sum, item) => {
//     const markedUnit = getMarkedUnitPrice(item.product.price);
//     return sum + markedUnit * item.quantity;
//   }, 0);

//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   // Helper function to create order in Supabase
//   const createOrder = async (
//     paymentMethod: string,
//     paymentStatus: "paid" | "pending" = "pending"
//   ) => {
//     if (!currentUser) {
//       throw new Error("User must be authenticated to create orders");
//     }

//     try {
//       const orderItems = cart.map((item) => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
//         name: item.product.name,
//       }));

//       const firstVideoId =
//         cart.length > 0 ? cart[0].product.videoId : undefined;

//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: "USD",
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
//       };

//       const order = await orderService.createOrder(orderData);
//       return order;
//     } catch (error) {
//       console.error("Error creating order:", error);
//       throw error;
//     }
//   };

//   // Check available payment methods
//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasGPayPaymentMethod = paymentMethods.some((pm) => pm.type === "gpay");
//   const hasCreditCardPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "creditCard"
//   );
//   const hasBankTransferPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "bankTransfer"
//   );
//   const hasApplePayPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "applePay"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   // Payment Handlers for different methods

//   const handleTwintPayment = () => {
//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (!twintPaymentMethod) {
//                         throw new Error("No Twint payment method found");
//                       }

//                       const order = await createOrder("twint", "paid");

//                       makePayment(
//                         finalTotal,
//                         `Purchase of ${cart.length} items via Twint`,
//                         {
//                           cartItems: cart.map((item) => ({
//                             productId: item.product.id,
//                             quantity: item.quantity,
//                           })),
//                           discountApplied: discountAmount > 0,
//                           voucherId: activeVoucher?.id,
//                           recipientId: cart[0].product.videoId.charAt(0),
//                           paymentProvider: "twint",
//                           paymentMethodId: twintPaymentMethod.id,
//                           orderId: order.id,
//                         }
//                       )
//                         .then((success) => {
//                           if (success) {
//                             if (activeVoucher && discountAmount > 0) {
//                               incrementUsageCount(activeVoucher.id);
//                             }

//                             clearCart();
//                             clearActiveVoucher();
//                             setDiscountAmount(0);

//                             Alert.alert(
//                               "Purchase Successful",
//                               `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                               [{ text: "OK", onPress: () => router.push("/") }]
//                             );
//                           }
//                         })
//                         .finally(() => setProcessingPayment(false));
//                     } catch (error) {
//                       console.error("Twint payment error:", error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${
//                           error instanceof Error ? error.message : "Unknown error"
//                         }. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePayment = async (method: string) => {
//     Alert.alert(
//       `${method} Payment`,
//       `You will be redirected to ${method} to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);
//             // Implement the relevant payment flow here (e.g., using Stripe API)
//             setTimeout(async () => {
//               try {
//                 const order = await createOrder(method, "paid");

//                 const paymentReference = `${method}_ref_${Date.now()}`;

//                 makePayment(
//                   finalTotal,
//                   `Purchase of ${cart.length} items via ${method}`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: method,
//                     paymentMethodId: paymentMethods.find((pm) => pm.type === method).id,
//                     paymentReference,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with ${method}.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error(`${method} payment error:`, error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your ${method} payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     try {
//       const currency = "usd";
//       const platformFeeCents = Math.max(
//         0,
//         Math.round(platformFee * 100)
//       );
//       const amountWithoutPlatformFeeCents = Math.max(
//         0,
//         Math.round((finalTotal - platformFee) * 100)
//       );

//       const firstItem = cart[0];

//       const { data, error } = await supabase.functions.invoke(
//         "stripe-create-checkout",
//         {
//           body: {
//             amount: amountWithoutPlatformFeeCents,
//             platformFeeAmount: platformFeeCents,
//             currency,
//             customerEmail: currentUser?.email,
//             productId: firstItem?.product.id,
//             productName: firstItem?.product.name,
//           },
//         }
//       );

//       if (error || data?.error) {
//         const message =
//           error?.message || data?.error || "Unable to create payment intent";
//         Alert.alert("Error", message);
//         return;
//       }

//       const {
//         paymentIntentClientSecret,
//         customerId,
//         ephemeralKeySecret,
//         totalAmount,
//       } = data;

//       const { error: setupError } = await initPaymentSheet({
//         paymentIntentClientSecret,
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         merchantDisplayName: "60seconds",
//       });

//       if (setupError) {
//         Alert.alert("Error", setupError.message || "Failed to initialize payment sheet");
//         return;
//       }

//       const { error: paymentError } = await presentPaymentSheet();

//       if (paymentError) {
//         Alert.alert(
//           "Error",
//           paymentError.message || "Payment failed. Please try again."
//         );
//         return;
//       }

//       Alert.alert(
//         "Success",
//         `Payment completed successfully! Total charged: ${currency.toUpperCase()} ${(totalAmount / 100).toFixed(2)}`
//       );
//     } catch (error) {
//       const message = error instanceof Error ? error.message : "Unexpected error";
//       console.error("Checkout Error:", error);
//       Alert.alert("Error", `There was an issue during checkout: ${message}`);
//     }
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     const markedUnitPrice = getMarkedUnitPrice(item.product.price);
//     const lineTotal = markedUnitPrice * item.quantity;

//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>

//           <Text style={styles.productPrice}>
//             ₦
//             {markedUnitPrice.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           <Text style={styles.itemTotal}>
//             ₦
//             {lineTotal.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦
//                       {discountAmount.toLocaleString("en-NG", {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2,
//                       })}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {cartSubtotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Platform Fee</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {platformFee.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦
//                   {discountAmount.toLocaleString("en-NG", {
//                     minimumFractionDigits: 2,
//                     maximumFractionDigits: 2,
//                   })}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>
//                 ₦
//                 {finalTotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.paymentMethodSelector}>
//               <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//               <View style={styles.paymentOptions}>
//                 <TouchableOpacity
//                   style={[
//                     styles.paymentOption,
//                     paymentMethod === "bankTransfer" &&
//                       styles.selectedPaymentOption,
//                   ]}
//                   onPress={() => setPaymentMethod("bankTransfer")}
//                 >
//                   <Text
//                     style={[
//                       styles.paymentOptionText,
//                       paymentMethod === "bankTransfer" &&
//                         styles.selectedPaymentOptionText,
//                     ]}
//                   >
//                     Bank Transfer
//                   </Text>
//                 </TouchableOpacity>

//                 <TouchableOpacity
//                   style={[
//                     styles.paymentOption,
//                     paymentMethod === "creditCard" &&
//                       styles.selectedPaymentOption,
//                   ]}
//                   onPress={() => setPaymentMethod("creditCard")}
//                 >
//                   <DollarSign
//                     size={16}
//                     color={paymentMethod === "creditCard" ? "#FFFFFF" : "#0066CC"}
//                     style={{ marginRight: 4 }}
//                   />
//                   <Text
//                     style={[
//                       styles.paymentOptionText,
//                       paymentMethod === "creditCard" &&
//                         styles.selectedPaymentOptionText,
//                     ]}
//                   >
//                     Credit Card
//                   </Text>
//                 </TouchableOpacity>

//                 {Platform.OS === "ios" && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "applePay" &&
//                         styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("applePay")}
//                   >
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "applePay" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       Apple Pay
//                     </Text>
//                   </TouchableOpacity>
//                 )}

//                 {Platform.OS === "android" && hasGPayPaymentMethod && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "gpay" &&
//                         styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("gpay")}
//                   >
//                     <DollarSign
//                       size={16}
//                       color={paymentMethod === "gpay" ? "#FFFFFF" : "#FF008C"}
//                       style={{ marginRight: 4 }}
//                     />
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "gpay" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       GPay
//                     </Text>
//                   </TouchableOpacity>
//                 )}

//                 {hasTwintPaymentMethod && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "twint" && styles.selectedTwintOption,
//                     ]}
//                     onPress={() => setPaymentMethod("twint")}
//                   >
//                     <Smartphone
//                       size={16}
//                       color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
//                       style={{ marginRight: 4 }}
//                     />
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "twint" &&
//                           styles.selectedTwintOptionText,
//                       ]}
//                     >
//                       Twint
//                     </Text>
//                   </TouchableOpacity>
//                 )}
//               </View>
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 paymentMethod === "twint" && styles.twintCheckoutButton,
//                 paymentMethod === "gpay" && styles.gpayCheckoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={handleCheckout}
//               disabled={false}
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <>
//                   <Text style={styles.checkoutButtonText}>
//                     {paymentMethod === "twint"
//                       ? "Pay with Twint"
//                       : paymentMethod === "gpay"
//                       ? "Pay with GPay"
//                       : paymentMethod === "applePay"
//                       ? "Pay with Apple Pay"
//                       : paymentMethod === "creditCard"
//                       ? "Pay with Credit Card"
//                       : "Checkout"}
//                   </Text>
//                 </>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });














///////////       payment sheet properlu showing    ///        20/01.2026    /////////





// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
//   Platform,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";
// import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
// import { supabase } from '@/lib/supabase';


// export default function CartScreen() {
//   const router = useRouter();
//   const { presentPaymentSheet, initPaymentSheet } = useStripe();

//   const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
//     useProductStore();

//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();

//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();

//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);

//   const [paymentMethod, setPaymentMethod] = useState<
//     "bankTransfer" | "creditCard" | "applePay" | "gpay" | "twint"
//   >("bankTransfer");

//   // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
//   const PRICE_MARKUP_RATE = 0.04;

//   const getMarkedUnitPrice = (basePrice: number) => {
//     // keep cents
//     return basePrice * (1 + PRICE_MARKUP_RATE);
//   };

//   const baseSubtotal = cart.reduce(
//     (sum, item) => sum + item.product.price * item.quantity,
//     0
//   );
//   const platformFee = baseSubtotal * PRICE_MARKUP_RATE;
//   const cartSubtotal = cart.reduce((sum, item) => {
//     const markedUnit = getMarkedUnitPrice(item.product.price);
//     return sum + markedUnit * item.quantity;
//   }, 0);

//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   // Helper function to create order in Supabase
//   const createOrder = async (
//     paymentMethod: string,
//     paymentStatus: "paid" | "pending" = "pending"
//   ) => {
//     if (!currentUser) {
//       throw new Error("User must be authenticated to create orders");
//     }

//     try {
//       const orderItems = cart.map((item) => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
//         name: item.product.name,
//       }));

//       const firstVideoId =
//         cart.length > 0 ? cart[0].product.videoId : undefined;

//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: "USD",
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
//       };

//       const order = await orderService.createOrder(orderData);
//       return order;
//     } catch (error) {
//       console.error("Error creating order:", error);
//       throw error;
//     }
//   };

//   // Check available payment methods
//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasGPayPaymentMethod = paymentMethods.some((pm) => pm.type === "gpay");
//   const hasCreditCardPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "creditCard"
//   );
//   const hasBankTransferPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "bankTransfer"
//   );
//   const hasApplePayPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "applePay"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   // Payment Handlers for different methods

//   const handleTwintPayment = () => {
//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (!twintPaymentMethod) {
//                         throw new Error("No Twint payment method found");
//                       }

//                       const order = await createOrder("twint", "paid");

//                       makePayment(
//                         finalTotal,
//                         `Purchase of ${cart.length} items via Twint`,
//                         {
//                           cartItems: cart.map((item) => ({
//                             productId: item.product.id,
//                             quantity: item.quantity,
//                           })),
//                           discountApplied: discountAmount > 0,
//                           voucherId: activeVoucher?.id,
//                           recipientId: cart[0].product.videoId.charAt(0),
//                           paymentProvider: "twint",
//                           paymentMethodId: twintPaymentMethod.id,
//                           orderId: order.id,
//                         }
//                       )
//                         .then((success) => {
//                           if (success) {
//                             if (activeVoucher && discountAmount > 0) {
//                               incrementUsageCount(activeVoucher.id);
//                             }

//                             clearCart();
//                             clearActiveVoucher();
//                             setDiscountAmount(0);

//                             Alert.alert(
//                               "Purchase Successful",
//                               `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                               [{ text: "OK", onPress: () => router.push("/") }]
//                             );
//                           }
//                         })
//                         .finally(() => setProcessingPayment(false));
//                     } catch (error) {
//                       console.error("Twint payment error:", error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${
//                           error instanceof Error ? error.message : "Unknown error"
//                         }. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePayment = async (method: string) => {
//     Alert.alert(
//       `${method} Payment`,
//       `You will be redirected to ${method} to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);
//             // Implement the relevant payment flow here (e.g., using Stripe API)
//             setTimeout(async () => {
//               try {
//                 const order = await createOrder(method, "paid");

//                 const paymentReference = `${method}_ref_${Date.now()}`;

//                 makePayment(
//                   finalTotal,
//                   `Purchase of ${cart.length} items via ${method}`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: method,
//                     paymentMethodId: paymentMethods.find((pm) => pm.type === method).id,
//                     paymentReference,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with ${method}.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error(`${method} payment error:`, error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your ${method} payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     try {
//       const currency = "usd";
//       const platformFeeCents = Math.max(
//         0,
//         Math.round(platformFee * 100)
//       );
//       const amountWithoutPlatformFeeCents = Math.max(
//         0,
//         Math.round((finalTotal - platformFee) * 100)
//       );

//       const firstItem = cart[0];

//       const { data, error } = await supabase.functions.invoke(
//         "stripe-create-checkout",
//         {
//           body: {
//             amount: amountWithoutPlatformFeeCents,
//             platformFeeAmount: platformFeeCents,
//             currency,
//             customerEmail: currentUser?.email,
//             productId: firstItem?.product.id,
//             productName: firstItem?.product.name,
//           },
//         }
//       );

//       if (error || data?.error) {
//         const message =
//           error?.message || data?.error || "Unable to create payment intent";
//         Alert.alert("Error", message);
//         return;
//       }

//       const {
//         paymentIntentClientSecret,
//         customerId,
//         ephemeralKeySecret,
//         totalAmount,
//       } = data;

//       const { error: setupError } = await initPaymentSheet({
//         paymentIntentClientSecret,
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         merchantDisplayName: "60seconds",
//       });

//       if (setupError) {
//         Alert.alert("Error", setupError.message || "Failed to initialize payment sheet");
//         return;
//       }

//       const { error: paymentError } = await presentPaymentSheet();

//       if (paymentError) {
//         Alert.alert(
//           "Error",
//           paymentError.message || "Payment failed. Please try again."
//         );
//         return;
//       }

//       Alert.alert(
//         "Success",
//         `Payment completed successfully! Total charged: ${currency.toUpperCase()} ${(totalAmount / 100).toFixed(2)}`
//       );
//     } catch (error) {
//       const message = error instanceof Error ? error.message : "Unexpected error";
//       console.error("Checkout Error:", error);
//       Alert.alert("Error", `There was an issue during checkout: ${message}`);
//     }
//   };
  
  
  


//   const renderCartItem = ({ item }: { item: any }) => {
//     const markedUnitPrice = getMarkedUnitPrice(item.product.price);
//     const lineTotal = markedUnitPrice * item.quantity;

//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>

//           <Text style={styles.productPrice}>
//             ₦
//             {markedUnitPrice.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           <Text style={styles.itemTotal}>
//             ₦
//             {lineTotal.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦
//                       {discountAmount.toLocaleString("en-NG", {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2,
//                       })}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {cartSubtotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦
//                   {discountAmount.toLocaleString("en-NG", {
//                     minimumFractionDigits: 2,
//                     maximumFractionDigits: 2,
//                   })}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>
//                 ₦
//                 {finalTotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             <View style={styles.paymentMethodSelector}>
//               <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//               <View style={styles.paymentOptions}>
//                 <TouchableOpacity
//                   style={[
//                     styles.paymentOption,
//                     paymentMethod === "bankTransfer" &&
//                       styles.selectedPaymentOption,
//                   ]}
//                   onPress={() => setPaymentMethod("bankTransfer")}
//                 >
//                   <Text
//                     style={[
//                       styles.paymentOptionText,
//                       paymentMethod === "bankTransfer" &&
//                         styles.selectedPaymentOptionText,
//                     ]}
//                   >
//                     Bank Transfer
//                   </Text>
//                 </TouchableOpacity>

//                 <TouchableOpacity
//                   style={[
//                     styles.paymentOption,
//                     paymentMethod === "creditCard" &&
//                       styles.selectedPaymentOption,
//                   ]}
//                   onPress={() => setPaymentMethod("creditCard")}
//                 >
//                   <DollarSign
//                     size={16}
//                     color={paymentMethod === "creditCard" ? "#FFFFFF" : "#0066CC"}
//                     style={{ marginRight: 4 }}
//                   />
//                   <Text
//                     style={[
//                       styles.paymentOptionText,
//                       paymentMethod === "creditCard" &&
//                         styles.selectedPaymentOptionText,
//                     ]}
//                   >
//                     Credit Card
//                   </Text>
//                 </TouchableOpacity>

//                 {Platform.OS === "ios" && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "applePay" &&
//                         styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("applePay")}
//                   >
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "applePay" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       Apple Pay
//                     </Text>
//                   </TouchableOpacity>
//                 )}

//                 {Platform.OS === "android" && hasGPayPaymentMethod && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "gpay" &&
//                         styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("gpay")}
//                   >
//                     <DollarSign
//                       size={16}
//                       color={paymentMethod === "gpay" ? "#FFFFFF" : "#FF008C"}
//                       style={{ marginRight: 4 }}
//                     />
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "gpay" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       GPay
//                     </Text>
//                   </TouchableOpacity>
//                 )}

//                 {hasTwintPaymentMethod && (
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "twint" && styles.selectedTwintOption,
//                     ]}
//                     onPress={() => setPaymentMethod("twint")}
//                   >
//                     <Smartphone
//                       size={16}
//                       color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
//                       style={{ marginRight: 4 }}
//                     />
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "twint" &&
//                           styles.selectedTwintOptionText,
//                       ]}
//                     >
//                       Twint
//                     </Text>
//                   </TouchableOpacity>
//                 )}
//               </View>
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 paymentMethod === "twint" && styles.twintCheckoutButton,
//                 paymentMethod === "gpay" && styles.gpayCheckoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={handleCheckout}
//               disabled={false}
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <>
//                   <Text style={styles.checkoutButtonText}>
//                     {paymentMethod === "twint"
//                       ? "Pay with Twint"
//                       : paymentMethod === "gpay"
//                       ? "Pay with GPay"
//                       : paymentMethod === "applePay"
//                       ? "Pay with Apple Pay"
//                       : paymentMethod === "creditCard"
//                       ? "Pay with Credit Card"
//                       : "Checkout"}
//                   </Text>
//                 </>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });
















//////////     before     13   jan    2026   //////////////////



// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";

// export default function CartScreen() {
//   const router = useRouter();

//   const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
//     useProductStore();

//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();

//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();

//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);

//   const [paymentMethod, setPaymentMethod] = useState<
//     "wallet" | "twint" | "paystack" | "worldline"
//   >("wallet");

//   // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
//   const PRICE_MARKUP_RATE = 0.04;

//   const getMarkedUnitPrice = (basePrice: number) => {
//     // keep cents
//     return basePrice * (1 + PRICE_MARKUP_RATE);
//   };

//   const cartSubtotal = cart.reduce((sum, item) => {
//     const markedUnit = getMarkedUnitPrice(item.product.price);
//     return sum + markedUnit * item.quantity;
//   }, 0);

//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal; // ✅ no separate platform fee anymore

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   // Helper function to create order in Supabase
//   const createOrder = async (
//     paymentMethod: string,
//     paymentStatus: "paid" | "pending" = "pending"
//   ) => {
//     if (!currentUser) {
//       throw new Error("User must be authenticated to create orders");
//     }

//     try {
//       // Prepare order items from cart (store base + marked price if you want)
//       const orderItems = cart.map((item) => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: getMarkedUnitPrice(item.product.price), // ✅ save marked price
//         name: item.product.name,
//       }));

//       const firstVideoId =
//         cart.length > 0 ? cart[0].product.videoId : undefined;

//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: "USD",
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined,
//       };

//       const order = await orderService.createOrder(orderData);
//       return order;
//     } catch (error) {
//       console.error("Error creating order:", error);
//       throw error;
//     }
//   };

//   // Check payment methods
//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasPaystackPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "paystack"
//   );
//   const hasWorldlinePaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "worldline"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   const handleTwintPayment = () => {
//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (!twintPaymentMethod) {
//                         throw new Error("No Twint payment method found");
//                       }

//                       const order = await createOrder("twint", "paid");

//                       makePayment(
//                         finalTotal, // ✅ pay total (already includes 4% on each item)
//                         `Purchase of ${cart.length} items via Twint`,
//                         {
//                           cartItems: cart.map((item) => ({
//                             productId: item.product.id,
//                             quantity: item.quantity,
//                           })),
//                           discountApplied: discountAmount > 0,
//                           voucherId: activeVoucher?.id,
//                           recipientId: cart[0].product.videoId.charAt(0),
//                           paymentProvider: "twint",
//                           paymentMethodId: twintPaymentMethod.id,
//                           orderId: order.id,
//                         }
//                       )
//                         .then((success) => {
//                           if (success) {
//                             if (activeVoucher && discountAmount > 0) {
//                               incrementUsageCount(activeVoucher.id);
//                             }

//                             clearCart();
//                             clearActiveVoucher();
//                             setDiscountAmount(0);

//                             Alert.alert(
//                               "Purchase Successful",
//                               `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                               [{ text: "OK", onPress: () => router.push("/") }]
//                             );
//                           }
//                         })
//                         .finally(() => setProcessingPayment(false));
//                     } catch (error) {
//                       console.error("Twint payment error:", error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${
//                           error instanceof Error ? error.message : "Unknown error"
//                         }. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePaystackPayment = () => {
//     Alert.alert(
//       "Paystack Payment",
//       `You will be redirected to Paystack to complete your payment of ₦${finalTotal.toLocaleString(
//         "en-NG",
//         { minimumFractionDigits: 2, maximumFractionDigits: 2 }
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             setTimeout(async () => {
//               try {
//                 const paystackPaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "paystack"
//                 );
//                 if (!paystackPaymentMethod) {
//                   throw new Error("No Paystack payment method found");
//                 }

//                 const order = await createOrder("paystack", "paid");

//                 const paystackReference = `paystack_ref_${Date.now()}`;
//                 const paystackTransactionId = `paystack_${Date.now()}`;

//                 makePayment(
//                   finalTotal, // ✅ pay total (already includes 4% on each item)
//                   `Purchase of ${cart.length} items via Paystack`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: "paystack",
//                     paymentMethodId: paystackPaymentMethod.id,
//                     paystackReference,
//                     paystackTransactionId,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with Paystack.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error("Paystack payment error:", error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your Paystack payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleWorldlinePayment = () => {
//     Alert.alert(
//       "Worldline Payment",
//       `You will be redirected to Worldline to complete your payment of $${finalTotal.toFixed(
//         2
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             setTimeout(async () => {
//               try {
//                 const worldlinePaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "worldline"
//                 );
//                 if (!worldlinePaymentMethod) {
//                   throw new Error("No Worldline payment method found");
//                 }

//                 const order = await createOrder("worldline", "paid");

//                 const worldlinePaymentId = `worldline_${Date.now()}`;
//                 const worldlineTransactionId = `txn_${Date.now()}`;

//                 makePayment(
//                   finalTotal, // ✅ pay total (already includes 4% on each item)
//                   `Purchase of ${cart.length} items via Worldline`,
//                   {
//                     cartItems: cart.map((item) => ({
//                       productId: item.product.id,
//                       quantity: item.quantity,
//                     })),
//                     discountApplied: discountAmount > 0,
//                     voucherId: activeVoucher?.id,
//                     recipientId: cart[0].product.videoId.charAt(0),
//                     paymentProvider: "worldline",
//                     paymentMethodId: worldlinePaymentMethod.id,
//                     worldlinePaymentId,
//                     worldlineTransactionId,
//                     orderId: order.id,
//                   }
//                 )
//                   .then((success) => {
//                     if (success) {
//                       if (activeVoucher && discountAmount > 0) {
//                         incrementUsageCount(activeVoucher.id);
//                       }

//                       clearCart();
//                       clearActiveVoucher();
//                       setDiscountAmount(0);

//                       Alert.alert(
//                         "Purchase Successful",
//                         `Your order has been completed successfully with Worldline.\nOrder ID: ${order.id}`,
//                         [{ text: "OK", onPress: () => router.push("/") }]
//                       );
//                     }
//                   })
//                   .finally(() => setProcessingPayment(false));
//               } catch (error) {
//                 console.error("Worldline payment error:", error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your Worldline payment: ${
//                     error instanceof Error ? error.message : "Unknown error"
//                   }. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     // ✅ Keeping your current behavior: go to wallet screen for now
//     try {
//       router.push("/wallet");
//     } catch (error) {
//       console.error("❌ Navigation error:", error);
//     }
//     return;

//     /*
//     if (paymentMethod === "twint") return handleTwintPayment();
//     if (paymentMethod === "paystack") return handlePaystackPayment();
//     if (paymentMethod === "worldline") return handleWorldlinePayment();

//     // Wallet payment flow (if you re-enable later)
//     */
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     const markedUnitPrice = getMarkedUnitPrice(item.product.price);
//     const lineTotal = markedUnitPrice * item.quantity;

//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>

//           {/* ✅ show price WITH 4% addition */}
//           <Text style={styles.productPrice}>
//             ₦
//             {markedUnitPrice.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           {/* ✅ line total uses marked price */}
//           <Text style={styles.itemTotal}>
//             ₦
//             {lineTotal.toLocaleString("en-NG", {
//               minimumFractionDigits: 2,
//               maximumFractionDigits: 2,
//             })}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦
//                       {discountAmount.toLocaleString("en-NG", {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2,
//                       })}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             {/* ✅ Subtotal is based on marked prices */}
//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦
//                 {cartSubtotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦
//                   {discountAmount.toLocaleString("en-NG", {
//                     minimumFractionDigits: 2,
//                     maximumFractionDigits: 2,
//                   })}
//                 </Text>
//               </View>
//             )}

//             {/* ✅ Platform Fee section removed بالكامل */}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>
//                 ₦
//                 {finalTotal.toLocaleString("en-NG", {
//                   minimumFractionDigits: 2,
//                   maximumFractionDigits: 2,
//                 })}
//               </Text>
//             </View>

//             {/* Payment Method Selection */}
//             {(hasTwintPaymentMethod ||
//               hasPaystackPaymentMethod ||
//               hasWorldlinePaymentMethod) && (
//               <View style={styles.paymentMethodSelector}>
//                 <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//                 <View style={styles.paymentOptions}>
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "wallet" && styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("wallet")}
//                   >
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "wallet" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       Wallet
//                     </Text>
//                   </TouchableOpacity>

//                   {hasTwintPaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "twint" && styles.selectedTwintOption,
//                       ]}
//                       onPress={() => setPaymentMethod("twint")}
//                     >
//                       <Smartphone
//                         size={16}
//                         color={paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"}
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "twint" &&
//                             styles.selectedTwintOptionText,
//                         ]}
//                       >
//                         Twint
//                       </Text>
//                     </TouchableOpacity>
//                   )}

//                   {hasPaystackPaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "paystack" &&
//                           styles.selectedPaystackOption,
//                       ]}
//                       onPress={() => setPaymentMethod("paystack")}
//                     >
//                       <DollarSign
//                         size={16}
//                         color={
//                           paymentMethod === "paystack" ? "#FFFFFF" : "#0BA4DB"
//                         }
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "paystack" &&
//                             styles.selectedPaystackOptionText,
//                         ]}
//                       >
//                         Paystack
//                       </Text>
//                     </TouchableOpacity>
//                   )}

//                   {hasWorldlinePaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "worldline" &&
//                           styles.selectedWorldlineOption,
//                       ]}
//                       onPress={() => setPaymentMethod("worldline")}
//                     >
//                       <DollarSign
//                         size={16}
//                         color={
//                           paymentMethod === "worldline" ? "#FFFFFF" : "#0066CC"
//                         }
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "worldline" &&
//                             styles.selectedWorldlineOptionText,
//                         ]}
//                       >
//                         Worldline
//                       </Text>
//                     </TouchableOpacity>
//                   )}
//                 </View>
//               </View>
//             )}

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 paymentMethod === "twint" && styles.twintCheckoutButton,
//                 paymentMethod === "paystack" && styles.paystackCheckoutButton,
//                 paymentMethod === "worldline" && styles.worldlineCheckoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={handleCheckout}
//               disabled={false} // keep as your current test setting
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <>
//                   {paymentMethod === "twint" && (
//                     <Smartphone
//                       size={20}
//                       color="#FFFFFF"
//                       style={{ marginRight: 8 }}
//                     />
//                   )}
//                   {(paymentMethod === "paystack" ||
//                     paymentMethod === "worldline") && (
//                     <DollarSign
//                       size={20}
//                       color="#FFFFFF"
//                       style={{ marginRight: 8 }}
//                     />
//                   )}
//                   <Text style={styles.checkoutButtonText}>
//                     {paymentMethod === "twint"
//                       ? "Pay with Twint"
//                       : paymentMethod === "paystack"
//                       ? "Pay with Paystack"
//                       : paymentMethod === "worldline"
//                       ? "Pay with Worldline"
//                       : "Checkout"}
//                   </Text>
//                 </>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });











// import React, { useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   SafeAreaView,
//   ActivityIndicator,
//   Linking,
//   Platform,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   Trash2,
//   Tag,
//   ShoppingBag,
//   Plus,
//   Minus,
//   Info,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useVoucherStore } from "@/store/voucher-store";
// import ApplyVoucherModal from "@/components/ApplyVoucherModal";
// import { trpc } from "@/lib/trpc";
// import { useAuthStore } from "@/store/auth-store";
// import { orderService } from "@/lib/database";
// import PaymentService from "@/lib/payment-service";

// export default function CartScreen() {
//   const router = useRouter();
//   const {
//     cart,
//     removeFromCart,
//     updateCartItemQuantity,
//     clearCart,
//     getCartTotal,
//     getCartFee,
//     getCartGrandTotal,
//   } = useProductStore();
//   const {
//     wallet,
//     makePayment,
//     isLoading,
//     paymentMethods,
//     fetchPaymentMethods,
//     fetchWallet,
//   } = useWalletStore();
//   const { activeVoucher, clearActiveVoucher, incrementUsageCount } =
//     useVoucherStore();
//   const { user: currentUser } = useAuthStore();
//   const generatePDFMutation = trpc.orders.generatePDF.useMutation();

//   const [showVoucherModal, setShowVoucherModal] = useState(false);
//   const [discountAmount, setDiscountAmount] = useState(0);
//   const [processingPayment, setProcessingPayment] = useState(false);
//   const [showFeeInfo, setShowFeeInfo] = useState(false);
//   const [paymentMethod, setPaymentMethod] = useState<
//     "wallet" | "twint" | "paystack" | "worldline"
//   >("wallet");

//   // Fetch wallet and payment methods when component mounts
//   React.useEffect(() => {
//     fetchWallet();
//     fetchPaymentMethods();
//   }, []);

//   const cartSubtotal = getCartTotal();
//   const platformFee = getCartFee();
//   const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
//   const finalTotal = discountedSubtotal + platformFee;

//   // Helper function to create order in Supabase
//   const createOrder = async (paymentMethod: string, paymentStatus: 'paid' | 'pending' = 'pending') => {
//     if (!currentUser) {
//       throw new Error('User must be authenticated to create orders');
//     }

//     try {
//       // Prepare order items from cart
//       const orderItems = cart.map(item => ({
//         product_id: item.product.id,
//         quantity: item.quantity,
//         price: item.product.price,
//         name: item.product.name
//       }));

//       // Get the first video_id from cart items (assuming all items are from the same event)
//       const firstVideoId = cart.length > 0 ? cart[0].product.videoId : undefined;

//       // Create order data
//       const orderData = {
//         user_id: currentUser.id,
//         video_id: firstVideoId,
//         total_amount: finalTotal,
//         currency: 'USD',
//         payment_method: paymentMethod,
//         payment_status: paymentStatus,
//         items: orderItems,
//         notes: activeVoucher ? `Voucher applied: ${activeVoucher.code}` : undefined
//       };

//       const order = await orderService.createOrder(orderData);
      
//       return order;
//     } catch (error) {
//       console.error('Error creating order:', error);
//       throw error;
//     }
//   };

//   // Check if user has Twint, Paystack, or Worldline payment methods
//   const hasTwintPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "twint"
//   );
//   const hasPaystackPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "paystack"
//   );
//   const hasWorldlinePaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "worldline"
//   );

//   const handleRemoveItem = (productId: string) => {
//     removeFromCart(productId);
//   };

//   const handleUpdateQuantity = (productId: string, quantity: number) => {
//     if (quantity < 1) return;
//     updateCartItemQuantity(productId, quantity);
//   };

//   const handleApplyVoucher = (amount: number) => {
//     setDiscountAmount(amount);
//   };

//   const handleClearVoucher = () => {
//     setDiscountAmount(0);
//     clearActiveVoucher();
//   };

//   const toggleFeeInfo = () => {
//     setShowFeeInfo(!showFeeInfo);
//   };

//   const handleTwintPayment = () => {
//     // In a real app, this would generate a QR code or deep link to the Twint app
//     // For now, we'll simulate by opening the Twint app if available

//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of ₦${finalTotal.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             // Try to open Twint app
//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   // After returning from Twint app, we would normally verify the payment
//                   // For now, we'll simulate a successful payment
//                   setTimeout(async () => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (twintPaymentMethod) {
//                         // Create order in Supabase first
//                         const order = await createOrder('twint', 'paid');
                        
//                         makePayment(
//                           discountedSubtotal,
//                           `Purchase of ${cart.length} items via Twint`,
//                           {
//                             cartItems: cart.map((item) => ({
//                               productId: item.product.id,
//                               quantity: item.quantity,
//                             })),
//                             discountApplied: discountAmount > 0,
//                             voucherId: activeVoucher?.id,
//                             recipientId: cart[0].product.videoId.charAt(0),
//                             paymentProvider: "twint",
//                             paymentMethodId: twintPaymentMethod.id,
//                             orderId: order.id, // Include order ID in payment record
//                           }
//                         )
//                           .then((success) => {
//                             if (success) {
//                               // If a voucher was used, increment its usage count
//                               if (activeVoucher && discountAmount > 0) {
//                                 incrementUsageCount(activeVoucher.id);
//                               }

//                               clearCart();
//                               clearActiveVoucher();
//                               setDiscountAmount(0);

//                               Alert.alert(
//                                 "Purchase Successful",
//                                 `Your order has been completed successfully with Twint.\nOrder ID: ${order.id}`,
//                                 [
//                                   {
//                                     text: "OK",
//                                     onPress: () => router.push("/"),
//                                   },
//                                 ]
//                               );
//                             }
//                           })
//                           .finally(() => {
//                             setProcessingPayment(false);
//                           });
//                       } else {
//                         throw new Error("No Twint payment method found");
//                       }
//                     } catch (error) {
//                       console.error('Twint payment error:', error);
//                       Alert.alert(
//                         "Error",
//                         `There was a problem processing your Twint payment: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
//                       );
//                       setProcessingPayment(false);
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       {
//                         text: "Cancel",
//                         style: "cancel",
//                         onPress: () => setProcessingPayment(false),
//                       },
//                       {
//                         text: "Get Twint",
//                         onPress: () => {
//                           Linking.openURL(twintWebUrl);
//                           setProcessingPayment(false);
//                         },
//                       },
//                     ]
//                   );
//                 }
//               })
//               .catch((err) => {
//                 console.error("An error occurred", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//                 setProcessingPayment(false);
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePaystackPayment = () => {
//     // In a real app, this would open a Paystack checkout or deep link
//     // For now, we'll simulate a successful payment

//     Alert.alert(
//       "Paystack Payment",
//       `You will be redirected to Paystack to complete your payment of ₦${finalTotal.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             // Simulate opening Paystack checkout
//             // In a real app, we would use the Paystack SDK or redirect to a web checkout

//             // Simulate network delay
//             setTimeout(async () => {
//               try {
//                 const paystackPaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "paystack"
//                 );

//                 if (paystackPaymentMethod) {
//                   // Create order in Supabase first
//                   const order = await createOrder('paystack', 'paid');
                  
//                   // Generate a reference
//                   const paystackReference = `paystack_ref_${Date.now()}`;
//                   const paystackTransactionId = `paystack_${Date.now()}`;

//                   makePayment(
//                     discountedSubtotal,
//                     `Purchase of ${cart.length} items via Paystack`,
//                     {
//                       cartItems: cart.map((item) => ({
//                         productId: item.product.id,
//                         quantity: item.quantity,
//                       })),
//                       discountApplied: discountAmount > 0,
//                       voucherId: activeVoucher?.id,
//                       recipientId: cart[0].product.videoId.charAt(0),
//                       paymentProvider: "paystack",
//                       paymentMethodId: paystackPaymentMethod.id,
//                       paystackReference,
//                       paystackTransactionId,
//                       orderId: order.id, // Include order ID in payment record
//                     }
//                   )
//                     .then((success) => {
//                       if (success) {
//                         // If a voucher was used, increment its usage count
//                         if (activeVoucher && discountAmount > 0) {
//                           incrementUsageCount(activeVoucher.id);
//                         }

//                         clearCart();
//                         clearActiveVoucher();
//                         setDiscountAmount(0);

//                         Alert.alert(
//                           "Purchase Successful",
//                           `Your order has been completed successfully with Paystack.\nOrder ID: ${order.id}`,
//                           [{ text: "OK", onPress: () => router.push("/") }]
//                         );
//                       }
//                     })
//                     .finally(() => {
//                       setProcessingPayment(false);
//                     });
//                 } else {
//                   throw new Error("No Paystack payment method found");
//                 }
//               } catch (error) {
//                 console.error('Paystack payment error:', error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your Paystack payment: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleWorldlinePayment = () => {
//     // In a real app, this would open a Worldline checkout or deep link
//     // For now, we'll simulate a successful payment

//     Alert.alert(
//       "Worldline Payment",
//       `You will be redirected to Worldline to complete your payment of $${finalTotal.toFixed(
//         2
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setProcessingPayment(true);

//             // Simulate opening Worldline checkout
//             // In a real app, we would use the Worldline SDK or redirect to a web checkout

//             // Simulate network delay
//             setTimeout(async () => {
//               try {
//                 const worldlinePaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "worldline"
//                 );

//                 if (worldlinePaymentMethod) {
//                   // Create order in Supabase first
//                   const order = await createOrder('worldline', 'paid');
                  
//                   // Generate payment references
//                   const worldlinePaymentId = `worldline_${Date.now()}`;
//                   const worldlineTransactionId = `txn_${Date.now()}`;

//                   makePayment(
//                     discountedSubtotal,
//                     `Purchase of ${cart.length} items via Worldline`,
//                     {
//                       cartItems: cart.map((item) => ({
//                         productId: item.product.id,
//                         quantity: item.quantity,
//                       })),
//                       discountApplied: discountAmount > 0,
//                       voucherId: activeVoucher?.id,
//                       recipientId: cart[0].product.videoId.charAt(0),
//                       paymentProvider: "worldline",
//                       paymentMethodId: worldlinePaymentMethod.id,
//                       worldlinePaymentId,
//                       worldlineTransactionId,
//                       orderId: order.id, // Include order ID in payment record
//                     }
//                   )
//                     .then((success) => {
//                       if (success) {
//                         // If a voucher was used, increment its usage count
//                         if (activeVoucher && discountAmount > 0) {
//                           incrementUsageCount(activeVoucher.id);
//                         }

//                         clearCart();
//                         clearActiveVoucher();
//                         setDiscountAmount(0);

//                         Alert.alert(
//                           "Purchase Successful",
//                           `Your order has been completed successfully with Worldline.\nOrder ID: ${order.id}`,
//                           [{ text: "OK", onPress: () => router.push("/") }]
//                         );
//                       }
//                     })
//                     .finally(() => {
//                       setProcessingPayment(false);
//                     });
//                 } else {
//                   throw new Error("No Worldline payment method found");
//                 }
//               } catch (error) {
//                 console.error('Worldline payment error:', error);
//                 Alert.alert(
//                   "Error",
//                   `There was a problem processing your Worldline payment: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
//                 );
//                 setProcessingPayment(false);
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleCheckout = async () => {
//     // Navigate directly to wallet screen when checkout is clicked
//     console.log("🚀 Checkout button clicked!");
//     console.log("🚀 Navigating to wallet screen...");
//     console.log("🚀 Router object:", router);
    
//     try {
//       router.push("/wallet");
//       console.log("✅ Navigation command sent successfully");
//     } catch (error) {
//       console.error("❌ Navigation error:", error);
//     }
//     return;

//     // COMMENTED OUT: All payment processing - navigate to wallet instead
//     /*
//     if (paymentMethod === "twint") {
//       handleTwintPayment();
//       return;
//     }

//     if (paymentMethod === "paystack") {
//       handlePaystackPayment();
//       return;
//     }

//     if (paymentMethod === "worldline") {
//       handleWorldlinePayment();
//       return;
//     }

//     // Standard wallet payment
//     console.log("🔍 Cart checkout - wallet state:", wallet);
//     console.log("🔍 Cart checkout - isLoading:", isLoading);
    
//     // COMMENTED OUT: Wallet setup popup - client wants to test payment platforms only
//     if (!wallet) {
//       console.log("❌ No wallet found, showing setup popup");
//       Alert.alert(
//         "Wallet Required",
//         "Please set up your wallet to make purchases.",
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "Set Up Wallet",
//             onPress: () => router.push("/wallet"),
//           },
//         ]
//       );
//       return;
//     }

//     if (wallet.balance < finalTotal) {
//       Alert.alert(
//         "Insufficient Funds",
//         "Your wallet balance is too low for this purchase. Would you like to add funds?",
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "Add Funds",
//             onPress: () =>
//               router.push({
//                 pathname: "/wallet",
//                 params: { action: "add-funds" },
//               }),
//           },
//         ]
//       );
//       return;
//     }
//     */

//     Alert.alert(
//       "Confirm Purchase",
//       `Are you sure you want to complete this purchase for ₦${finalTotal.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}?

// This includes a 5% platform fee of ₦${platformFee.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Complete Purchase",
//           onPress: async () => {
//             setProcessingPayment(true);

//             try {
//               // Create order in Supabase first
//               const order = await createOrder('wallet', 'paid');
              
//               const success = await makePayment(
//                 discountedSubtotal, // We pass the subtotal, fee is calculated in wallet store
//                 `Purchase of ${cart.length} items`,
//                 {
//                   cartItems: cart.map((item) => ({
//                     productId: item.product.id,
//                     quantity: item.quantity,
//                   })),
//                   discountApplied: discountAmount > 0,
//                   voucherId: activeVoucher?.id,
//                   recipientId: cart[0].product.videoId.charAt(0), // Simplified business ID
//                   paymentProvider: "internal",
//                   orderId: order.id, // Include order ID in payment record
//                 }
//               );

//               if (success) {
//                 // Generate PDF for the successful order
//                 try {
//                   const orderNumber = `ORD-${new Date()
//                     .toISOString()
//                     .slice(0, 10)
//                     .replace(/-/g, "")}-${Math.floor(Math.random() * 10000)
//                     .toString()
//                     .padStart(4, "0")}`;

//                   await generatePDFMutation.mutateAsync({
//                     orderNumber,
//                     customerName:
//                       currentUser?.displayName ||
//                       currentUser?.name ||
//                       "Customer",
//                     customerEmail: currentUser?.email || "customer@example.com",
//                     businessName: "Event Business", // In a real app, get from the actual business
//                     items: cart.map((item) => ({
//                       id: item.product.id,
//                       name: item.product.name,
//                       description: item.product.description,
//                       quantity: item.quantity,
//                       unitPrice: item.product.price,
//                       totalPrice: item.product.price * item.quantity,
//                       type: item.product.type,
//                     })),
//                     subtotal: cartSubtotal,
//                     tax: 0,
//                     discount: discountAmount,
//                     total: finalTotal,
//                     currency: "USD",
//                     orderDate: new Date().toISOString(),
//                     notes: activeVoucher
//                       ? `Voucher applied: ${activeVoucher.code}`
//                       : undefined,
//                   });

//                   // Order PDF generated successfully
//                 } catch (pdfError) {
//                   console.error("Failed to generate PDF:", pdfError);
//                   // Don't fail the entire purchase if PDF generation fails
//                 }

//                 // If a voucher was used, increment its usage count
//                 if (activeVoucher && discountAmount > 0) {
//                   await incrementUsageCount(activeVoucher.id);
//                 }

//                 clearCart();
//                 clearActiveVoucher();
//                 setDiscountAmount(0);

//                 Alert.alert(
//                   "Purchase Successful",
//                   `Your order has been completed successfully.\nOrder ID: ${order.id}\nYou can view your receipt in your profile.`,
//                   [{ text: "OK", onPress: () => router.push("/") }]
//                 );
//               }
//             } catch (error) {
//               console.error('Wallet payment error:', error);
//               Alert.alert(
//                 "Error",
//                 `There was a problem processing your payment: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
//               );
//             } finally {
//               setProcessingPayment(false);
//             }
//           },
//         },
//       ]
//     );
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     return (
//       <View style={styles.cartItem}>
//         <Image
//           source={{ uri: item.product.image }}
//           style={styles.productImage}
//           contentFit="cover"
//           transition={300}
//         />

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.product.name}</Text>
//           <Text style={styles.productPrice}>
//             ₦{item.product.price.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
//           </Text>

//           <View style={styles.quantityContainer}>
//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity - 1)
//               }
//             >
//               <Minus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <Text style={styles.quantityText}>{item.quantity}</Text>

//             <TouchableOpacity
//               style={styles.quantityButton}
//               onPress={() =>
//                 handleUpdateQuantity(item.product.id, item.quantity + 1)
//               }
//             >
//               <Plus size={16} color={Colors.dark.text} />
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.itemActions}>
//           <Text style={styles.itemTotal}>
//             ₦{(item.product.price * item.quantity).toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
//           </Text>

//           <TouchableOpacity
//             style={styles.removeButton}
//             onPress={() => handleRemoveItem(item.product.id)}
//           >
//             <Trash2 size={20} color="#FF5252" />
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity
//           style={styles.backButton}
//           onPress={() => router.back()}
//         >
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Shopping Cart</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {cart.length === 0 ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={64} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>Your cart is empty</Text>
//           <TouchableOpacity
//             style={styles.browseButton}
//             onPress={() => router.push("/")}
//           >
//             <Text style={styles.browseButtonText}>Browse Events</Text>
//           </TouchableOpacity>
//         </View>
//       ) : (
//         <>
//           <FlatList
//             data={cart}
//             renderItem={renderCartItem}
//             keyExtractor={(item) => item.product.id}
//             contentContainerStyle={styles.cartList}
//           />

//           <View style={styles.summaryContainer}>
//             <View style={styles.voucherSection}>
//               {discountAmount > 0 && activeVoucher ? (
//                 <View style={styles.appliedVoucher}>
//                   <View style={styles.voucherInfo}>
//                     <Tag size={16} color={Colors.dark.primary} />
//                     <Text style={styles.voucherCode}>{activeVoucher.code}</Text>
//                     <Text style={styles.discountAmount}>
//                       -₦{discountAmount.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
//                     </Text>
//                   </View>
//                   <TouchableOpacity
//                     style={styles.removeVoucherButton}
//                     onPress={handleClearVoucher}
//                   >
//                     <Trash2 size={16} color={Colors.dark.subtext} />
//                   </TouchableOpacity>
//                 </View>
//               ) : (
//                 <TouchableOpacity
//                   style={styles.voucherButton}
//                   onPress={() => setShowVoucherModal(true)}
//                 >
//                   <Tag size={16} color={Colors.dark.text} />
//                   <Text style={styles.voucherButtonText}>Apply Voucher</Text>
//                 </TouchableOpacity>
//               )}
//             </View>

//             <View style={styles.summaryRow}>
//               <Text style={styles.summaryLabel}>Subtotal</Text>
//               <Text style={styles.summaryValue}>
//                 ₦{cartSubtotal.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
//               </Text>
//             </View>

//             {discountAmount > 0 && (
//               <View style={styles.summaryRow}>
//                 <Text style={styles.summaryLabel}>Discount</Text>
//                 <Text style={styles.discountValue}>
//                   -₦{discountAmount.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.summaryRow}>
//               <View style={styles.feeRow}>
//                 <Text style={styles.summaryLabel}>Platform Fee (5%)</Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={16} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//               <Text style={styles.feeValue}>₦{platformFee.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</Text>
//             </View>

//             {showFeeInfo && (
//               <View style={styles.feeInfoContainer}>
//                 <Text style={styles.feeInfoText}>
//                   A 5% platform fee is applied to all transactions to support
//                   the 60Seconds platform and its services.
//                 </Text>
//               </View>
//             )}

//             <View style={styles.totalRow}>
//               <Text style={styles.totalLabel}>Total</Text>
//               <Text style={styles.totalValue}>₦{finalTotal.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</Text>
//             </View>

//             {/* Payment Method Selection */}
//             {(hasTwintPaymentMethod || hasPaystackPaymentMethod || hasWorldlinePaymentMethod) && (
//               <View style={styles.paymentMethodSelector}>
//                 <Text style={styles.paymentMethodTitle}>Payment Method</Text>

//                 <View style={styles.paymentOptions}>
//                   <TouchableOpacity
//                     style={[
//                       styles.paymentOption,
//                       paymentMethod === "wallet" &&
//                         styles.selectedPaymentOption,
//                     ]}
//                     onPress={() => setPaymentMethod("wallet")}
//                   >
//                     <Text
//                       style={[
//                         styles.paymentOptionText,
//                         paymentMethod === "wallet" &&
//                           styles.selectedPaymentOptionText,
//                       ]}
//                     >
//                       Wallet
//                     </Text>
//                   </TouchableOpacity>

//                   {hasTwintPaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "twint" && styles.selectedTwintOption,
//                       ]}
//                       onPress={() => setPaymentMethod("twint")}
//                     >
//                       <Smartphone
//                         size={16}
//                         color={
//                           paymentMethod === "twint" ? "#FFFFFF" : "#ED0039"
//                         }
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "twint" &&
//                             styles.selectedTwintOptionText,
//                         ]}
//                       >
//                         Twint
//                       </Text>
//                     </TouchableOpacity>
//                   )}

//                   {hasPaystackPaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "paystack" &&
//                           styles.selectedPaystackOption,
//                       ]}
//                       onPress={() => setPaymentMethod("paystack")}
//                     >
//                       <DollarSign
//                         size={16}
//                         color={
//                           paymentMethod === "paystack" ? "#FFFFFF" : "#0BA4DB"
//                         }
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "paystack" &&
//                             styles.selectedPaystackOptionText,
//                         ]}
//                       >
//                         Paystack
//                       </Text>
//                     </TouchableOpacity>
//                   )}

//                   {hasWorldlinePaymentMethod && (
//                     <TouchableOpacity
//                       style={[
//                         styles.paymentOption,
//                         paymentMethod === "worldline" &&
//                           styles.selectedWorldlineOption,
//                       ]}
//                       onPress={() => setPaymentMethod("worldline")}
//                     >
//                       <DollarSign
//                         size={16}
//                         color={
//                           paymentMethod === "worldline" ? "#FFFFFF" : "#0066CC"
//                         }
//                         style={{ marginRight: 4 }}
//                       />
//                       <Text
//                         style={[
//                           styles.paymentOptionText,
//                           paymentMethod === "worldline" &&
//                             styles.selectedWorldlineOptionText,
//                         ]}
//                       >
//                         Worldline
//                       </Text>
//                     </TouchableOpacity>
//                   )}
//                 </View>
//               </View>
//             )}

//             <TouchableOpacity
//               style={[
//                 styles.checkoutButton,
//                 paymentMethod === "twint" && styles.twintCheckoutButton,
//                 paymentMethod === "paystack" && styles.paystackCheckoutButton,
//                 paymentMethod === "worldline" && styles.worldlineCheckoutButton,
//                 (processingPayment || isLoading) && styles.disabledButton,
//               ]}
//               onPress={() => {
//                 console.log("🔍 Button pressed - processingPayment:", processingPayment, "isLoading:", isLoading);
//                 console.log("🔍 Button disabled:", processingPayment || isLoading);
//                 handleCheckout();
//               }}
//               disabled={false} // Temporarily disabled to test navigation
//             >
//               {processingPayment ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <>
//                   {paymentMethod === "twint" && (
//                     <Smartphone
//                       size={20}
//                       color="#FFFFFF"
//                       style={{ marginRight: 8 }}
//                     />
//                   )}
//                   {paymentMethod === "paystack" && (
//                     <DollarSign
//                       size={20}
//                       color="#FFFFFF"
//                       style={{ marginRight: 8 }}
//                     />
//                   )}
//                   {paymentMethod === "worldline" && (
//                     <DollarSign
//                       size={20}
//                       color="#FFFFFF"
//                       style={{ marginRight: 8 }}
//                     />
//                   )}
//                   <Text style={styles.checkoutButtonText}>
//                     {paymentMethod === "twint"
//                       ? "Pay with Twint"
//                       : paymentMethod === "paystack"
//                       ? "Pay with Paystack"
//                       : paymentMethod === "worldline"
//                       ? "Pay with Worldline"
//                       : "Checkout"}
//                   </Text>
//                 </>
//               )}
//             </TouchableOpacity>
//           </View>
//         </>
//       )}

//       <ApplyVoucherModal
//         visible={showVoucherModal}
//         onClose={() => setShowVoucherModal(false)}
//         onApply={handleApplyVoucher}
//         totalAmount={cartSubtotal}
//         productId={cart.length === 1 ? cart[0].product.id : undefined}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   cartList: {
//     padding: 16,
//   },
//   cartItem: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 80,
//     height: 80,
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "space-between",
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productPrice: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   quantityContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   quantityButton: {
//     width: 28,
//     height: 28,
//     borderRadius: 14,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   quantityText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginHorizontal: 12,
//   },
//   itemActions: {
//     padding: 12,
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   itemTotal: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   removeButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: "rgba(255, 82, 82, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryContainer: {
//     backgroundColor: Colors.dark.card,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     padding: 20,
//   },
//   voucherSection: {
//     marginBottom: 16,
//   },
//   voucherButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   voucherButtonText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   appliedVoucher: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   voucherInfo: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   voucherCode: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//     marginLeft: 8,
//     marginRight: 12,
//   },
//   discountAmount: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   removeVoucherButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   summaryRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   feeRow: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 8,
//   },
//   summaryLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   summaryValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   discountValue: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   feeValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   feeInfoContainer: {
//     backgroundColor: "rgba(255, 255, 255, 0.05)",
//     borderRadius: 8,
//     padding: 12,
//     marginBottom: 12,
//   },
//   feeInfoText: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     lineHeight: 18,
//   },
//   totalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//     paddingTop: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   totalLabel: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   totalValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   paymentMethodSelector: {
//     marginBottom: 20,
//   },
//   paymentMethodTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentOptions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   paymentOption: {
//     flex: 1,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 12,
//     marginHorizontal: 4,
//     borderRadius: 8,
//   },
//   selectedPaymentOption: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintOption: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackOption: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineOption: {
//     backgroundColor: "#0066CC",
//   },
//   paymentOptionText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   selectedPaymentOptionText: {
//     color: Colors.dark.primary,
//     fontWeight: "bold",
//   },
//   selectedTwintOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedPaystackOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   selectedWorldlineOptionText: {
//     color: "#FFFFFF",
//     fontWeight: "bold",
//   },
//   checkoutButton: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   twintCheckoutButton: {
//     backgroundColor: "#ED0039",
//   },
//   paystackCheckoutButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   worldlineCheckoutButton: {
//     backgroundColor: "#0066CC",
//   },
//   checkoutButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   disabledButton: {
//     opacity: 0.7,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     fontSize: 18,
//     color: Colors.dark.text,
//     marginTop: 16,
//     marginBottom: 24,
//   },
//   browseButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   browseButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//   },
// });
