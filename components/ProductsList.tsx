import { logger } from '@/lib/logger';
import { ensureStripeInitialized } from "@/lib/stripe-initialization";
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  InteractionManager,
} from "react-native";

// NOTE: Apple Pay is managed entirely by Stripe Connect on the backend. The
// application does **not** directly integrate with PassKit or any Apple Pay
// APIs.  We have removed the PassKit framework entirely from the iOS project
// (see Podfile post_install patch) so there is no linkage or binary references
// whatsoever. This comment (and the UI disclaimer shown when payment options
// are displayed) satisfies the App Store policy requirement.
import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
import { Image } from "expo-image";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { DEFAULT_CURRENCY } from "@/constants/currencies";
import { Product } from "@/types";
import { useProductStore } from "@/store/product-store";
import { useWalletStore } from "@/store/wallet-store";
import { useVoucherStore } from "@/store/voucher-store";
import { useAuthStore } from "@/store/auth-store";
import { useAuth } from "@/lib/auth";
import { orderService, ticketReceiptService } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { settleStripePayment } from "@/lib/stripe-settlement";
import { settleExternalOrderPayment } from "@/lib/external-payment-settlement";
import PaystackWebView from "@/components/PaystackWebView";
import TwintPaymentModal from "@/components/TwintPaymentModal";
import TwintWebViewModal from "@/components/TwintWebViewModal";
import ApplyVoucherModal from "@/components/ApplyVoucherModal";
import { canOpenTwintApp, openTwintApp } from "@/lib/twint";
import WorldlineService from "@/lib/worldline";
import { resolveCurrencyFromCountry } from "@/utils/country-currency";
import { getPaystackRoutingForOwner } from "@/constants/paystack-routing";
import { createStripePaymentSheetSession } from "@/lib/stripe-payment-sheet-session";

// Constants
const PLATFORM_FEE_PERCENTAGE = 0.04;

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

type StripePaymentSheetApi = {
  initPaymentSheet?: (options: any) => Promise<any>;
  presentPaymentSheet?: () => Promise<any>;
};

interface ProductsListProps {
  videoId: string;
  onClose: () => void;
  products?: Product[];
  buyerEmail?: string | null;
  buyerId?: string | null;
}

const ProductsList = ({
  videoId,
  onClose,
  products = [], // Default to an empty array if not passed
  buyerEmail,
  buyerId,
}: ProductsListProps) => {
  const { addToCart, isLoading } = useProductStore();
  const { makePayment } = useWalletStore();
  const {
    vouchers,
    activeVoucher,
    fetchVouchers,
    clearActiveVoucher,
    incrementUsageCount,
    applyVoucher,
  } = useVoucherStore();
  const user = useAuthStore((s) => s.user);
  const { profile, user: authUser } = useAuth();
  const router = useRouter();
  const stripeApiRef = React.useRef<StripePaymentSheetApi>({});

  const getStripeApi = React.useCallback((): StripePaymentSheetApi => {
    if (stripeApiRef.current.initPaymentSheet && stripeApiRef.current.presentPaymentSheet) {
      return stripeApiRef.current;
    }

    try {
      const stripeModule = require("@stripe/stripe-react-native");
      if (
        typeof stripeModule?.initPaymentSheet === "function" &&
        typeof stripeModule?.presentPaymentSheet === "function"
      ) {
        stripeApiRef.current = {
          initPaymentSheet: async (options: any) => {
            await ensureStripeInitialized();
            return stripeModule.initPaymentSheet(options);
          },
          presentPaymentSheet: stripeModule.presentPaymentSheet,
        };
      }
    } catch (error) {
      // Some development binaries (for example Expo Go) do not include Stripe native modules.
      logger.warn("Stripe native module unavailable in this build:", error);
    }

    return stripeApiRef.current;
  }, []);

  const [isPaying, setIsPaying] = React.useState(false);
  const [displayProducts, setDisplayProducts] = React.useState<Product[]>(products);
  const [liveProducts, setLiveProducts] = React.useState<Product[]>([]);
  const [receiptSoldByProduct, setReceiptSoldByProduct] = React.useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = React.useState(false);
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);
  const [showVoucherModal, setShowVoucherModal] = React.useState(false);
  const [discountAmount, setDiscountAmount] = React.useState(0);
  const [showMoreOptions, setShowMoreOptions] = React.useState(false); // Track if "More" is clicked
  // Apple Pay is deliberately disabled in the UI; the Stripe PaymentSheet will
  // itself expose wallet buttons when appropriate, but we do not configure
  // applePay here so that PassKit is not referenced.
  const [applePaySupported] = React.useState<boolean>(false);
  const [googlePaySupported, setGooglePaySupported] = React.useState<boolean>(Platform.OS === "android");

  // Paystack payment state
  const [showPaystackModal, setShowPaystackModal] = React.useState(false);
  const [paystackProduct, setPaystackProduct] = React.useState<Product | null>(null);
  // Keep a ref in sync so that async callbacks always see the LATEST value,
  // even if the component has re-rendered or the user navigated away.
  const paystackProductRef = React.useRef<Product | null>(null);
  const paystackCancelledRef = React.useRef(false);
  const [showTwintPaymentModal, setShowTwintPaymentModal] = React.useState(false);
  const [showTwintWebViewModal, setShowTwintWebViewModal] = React.useState(false);
  const [twintProduct, setTwintProduct] = React.useState<Product | null>(null);
  const [twintReference, setTwintReference] = React.useState<string>(`twint_product_${Date.now()}`);
  const [twintOpeningApp, setTwintOpeningApp] = React.useState(false);
  const [twintCheckoutUrl, setTwintCheckoutUrl] = React.useState<string | null>(null);
  const [twintPaymentId, setTwintPaymentId] = React.useState<string | null>(null);
  const [twintOrderId, setTwintOrderId] = React.useState<string | null>(null);

  const { wallet } = useWalletStore();
  const buyerFallbackCurrency = resolveCurrencyFromCountry({
    countryCode: (profile as any)?.country_code || (authUser as any)?.user_metadata?.country_code || (user as any)?.countryCode,
    country: (profile as any)?.country || (authUser as any)?.user_metadata?.country || (user as any)?.country,
    fallbackCurrency: (wallet as any)?.currency || DEFAULT_CURRENCY,
  });
  const resolveProductCurrency = React.useCallback(
    (currency?: string | null) => normalizeCurrencyCode(currency, buyerFallbackCurrency),
    [buyerFallbackCurrency]
  );

  const mapRowToProduct = React.useCallback(
    (row: any): Product => ({
      id: String(row.id),
      videoId,
      name: row.name || "Unnamed Item",
      description: row.description || "",
      price: Number(row.price || 0),
      image: row.image_url || "",
      type: row.type,
      available: Number(row.available_quantity || 0),
      sold: Number(row.sold_quantity || 0),
      createdAt: row.created_at || new Date().toISOString(),
      ownerId: row.business_id || undefined,
      currency: resolveProductCurrency(row.currency),
    }),
    [videoId, resolveProductCurrency]
  );
  const isLoggedInNigerianUser =
    !!(user?.id || authUser?.id || buyerId) &&
    [
      (profile as any)?.country_code,
      (profile as any)?.country,
      (authUser as any)?.user_metadata?.country_code,
      (authUser as any)?.user_metadata?.country,
      (wallet as any)?.country,
      (wallet as any)?.countryCode,
      (user as any)?.country,
      (user as any)?.countryCode,
    ].some((value) => isNigerianCountryValue(value));

  const flatListRef = React.useRef<FlatList>(null);

  const hydrateLiveProducts = React.useCallback(async () => {
      try {
        const { data: eventRows, error: eventError } = await supabase
          .from("events")
          .select("id")
          .eq("video_id", videoId);

        if (eventError) {
          throw eventError;
        }

        const eventIds = (eventRows || []).map((row) => row.id).filter(Boolean);
        if (!eventIds.length) {
          setLiveProducts([]);
          return;
        }

        const { data: productRows, error: productsError } = await supabase
          .from("products")
          .select("*")
          .in("event_id", eventIds)
          .eq("is_active", true)
          .order("created_at", { ascending: true });

        if (productsError) {
          throw productsError;
        }

        const productIds = (productRows || []).map((row) => String(row.id)).filter(Boolean);
        if (productIds.length) {
          const { data: receiptRows, error: receiptError } = await supabase
            .from('ticket_receipts')
            .select('product_id,quantity')
            .in('product_id', productIds);

          if (!receiptError) {
            const receiptCounts: Record<string, number> = {};
            for (const receipt of receiptRows || []) {
              const productId = String(receipt.product_id || '');
              if (!productId) continue;
              receiptCounts[productId] = (receiptCounts[productId] || 0) + Math.max(1, Number(receipt.quantity || 1));
            }
            setReceiptSoldByProduct(receiptCounts);
          }
        }

        setLiveProducts((productRows || []).map(mapRowToProduct));

      } catch (error) {
        logger.warn("ProductsList: failed to hydrate live products:", error);
      }
  }, [videoId, mapRowToProduct]);

  React.useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleHydration = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void hydrateLiveProducts(), 150);
    };

    void hydrateLiveProducts();

    // Keep buyer and organizer inventory in sync while either product sheet is open.
    // Settlement updates products and inserts receipts, so listen for both events.
    const inventoryChannel = supabase
      .channel(`product-inventory-${videoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, scheduleHydration)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_receipts' }, scheduleHydration)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(inventoryChannel);
    };
  }, [videoId, hydrateLiveProducts]);

  React.useEffect(() => {
    const merged = new Map<string, Product>();

    // Keep prop products first for instant UI, then overwrite with live DB rows when available.
    for (const item of products) {
      if (!item?.id) continue;
      merged.set(String(item.id), item);
    }

    for (const item of liveProducts) {
      if (!item?.id) continue;
      merged.set(String(item.id), item);
    }

    setDisplayProducts(Array.from(merged.values()));
  }, [products, liveProducts]);

  React.useEffect(() => {
    if (!showPaymentOptions || !selectedProduct) return;
    const businessId = resolveProductOwnerId(selectedProduct);
    if (!businessId) return;
    fetchVouchers(businessId);
  }, [showPaymentOptions, selectedProduct, fetchVouchers]);

  // We assume wallet availability based on platform; deeper runtime checks can be added if needed.

  const calculatePlatformFee = (amount: number) => {
    const fee = amount * PLATFORM_FEE_PERCENTAGE;
    return Math.round(fee * 100) / 100;
  };

  const getTotalPayableAmount = (price: number) => {
    const fee = calculatePlatformFee(price);
    const total = price + fee;
    return { fee, total: Math.round(total * 100) / 100 };
  };

  const getBusinessNetAmount = (grossAmount: number) => {
    return Number((grossAmount / (1 + PLATFORM_FEE_PERCENTAGE)).toFixed(2));
  };

  const resolveProductOwnerId = (product: any): string | null => {
    return (
      product?.ownerId ||
      product?.eventOwnerId ||
      product?.creatorId ||
      product?.business_id ||
      product?.businessId ||
      null
    );
  };

  const getDiscountedPlatformFee = (grossAmount: number) => {
    return Number((grossAmount - getBusinessNetAmount(grossAmount)).toFixed(2));
  };

  const isVoucherUsableForProduct = React.useCallback((voucher: any, product?: Product | null) => {
    if (!voucher || !voucher.isActive) return false;
    if (voucher.usageLimit != null && voucher.usageCount >= voucher.usageLimit) return false;
    if (product && resolveProductOwnerId(product) !== voucher.businessId) return false;
    if (voucher.productId && product?.id && voucher.productId !== product.id) return false;
    if (voucher.productId && !product?.id) return false;
    const expiryDate = new Date(voucher.expiryDate);
    return !voucher.expiryDate || (!Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() > Date.now());
  }, []);

  const availableVouchers = React.useMemo(
    () => vouchers.filter((voucher) => isVoucherUsableForProduct(voucher, selectedProduct)),
    [vouchers, selectedProduct, isVoucherUsableForProduct]
  );

  const hasAvailableVouchers = availableVouchers.length > 0;

  const getDiscountedCheckoutTotal = React.useCallback(
    (product: Product) => {
      const { fee, total } = getTotalPayableAmount(product.price);
      const cappedDiscount = activeVoucher && isVoucherUsableForProduct(activeVoucher, product) ? Math.min(discountAmount, total) : 0;
      const discountedTotal = Math.max(0, total - cappedDiscount);

      return {
        fee,
        subtotalWithFee: total,
        discount: cappedDiscount,
        total: discountedTotal,
      };
    },
    [discountAmount, activeVoucher, isVoucherUsableForProduct]
  );

  const canEditProduct = (product: any) => {
    return !!user?.id && resolveProductOwnerId(product) === user.id;
  };

  const decrementDisplayedAvailability = React.useCallback((productId: string) => {
    const normalizedId = String(productId || '').trim();
    if (!normalizedId) return;

    setDisplayProducts((prev) =>
      prev.map((product) =>
        product.id === normalizedId
          ? { ...product, available: Math.max(0, Number(product.available || 0) - 1) }
          : product
      )
    );
  }, []);

  const handleEditProduct = (product: Product) => {
    if (!product.videoId) {
      Alert.alert("Edit unavailable", "This product is missing the linked event reference.");
      return;
    }

    router.push({
      pathname: "/upload",
      params: { editVideoId: String(product.videoId) },
    });
  };

  const startStripeCheckout = async (selectedMethod: string) => {
    if (!selectedMethod || !selectedProduct) {
      Alert.alert("Payment Method or Product Required", "Please select a product and payment method.");
      return;
    }

    // Diagnostic: log any publishable key sources but do not block — rely on native `useStripe` hooks.
    try {
      const envKey = process.env?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      const expoExtraKey = (Constants?.expoConfig?.extra && (Constants.expoConfig.extra as any).EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY) ||
        (Constants?.manifest?.extra && (Constants.manifest.extra as any).EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
      logger.debug("Stripe publishable keys:", { envKey, expoExtraKey });
    } catch (e) {
      logger.debug("Stripe key check error:", e);
    }

    const { initPaymentSheet, presentPaymentSheet } = getStripeApi();

    if (!initPaymentSheet || !presentPaymentSheet) {
      Alert.alert(
        "Stripe Not Available",
        "Payment is currently unavailable on this device. Please try again later."
      );
      return;
    }

    const productForPayment = selectedProduct;
    const { subtotalWithFee, total, discount } = getDiscountedCheckoutTotal(productForPayment);
    const discountedPlatformFee = getDiscountedPlatformFee(total);
    const productCurrency = resolveProductCurrency(productForPayment.currency);
    const currentAuthId = buyerId || user?.id || authUser?.id;

    try {
      setIsPaying(true);

      if (!currentAuthId) {
        throw new Error("Please sign in before starting a Stripe checkout.");
      }

      // Determine connected account (Stripe Connect destination) from product metadata
      const connectedAccountId =
        (productForPayment as any).ownerStripeAccountId ||
        (productForPayment as any).stripeConnectedAccountId ||
        (productForPayment as any).connectedAccountId ||
        null;

      logger.debug("Stripe: creating checkout on backend", {
        productId: productForPayment.id,
        connectedAccountId,
        amount_cents: Math.round(total * 100),
      });

      const data = await createStripePaymentSheetSession({
        amount: Math.round(total * 100),
        currency: productCurrency.toLowerCase(),
        platformFeeAmount: Math.round(discountedPlatformFee * 100),
        customerEmail: buyerEmail || undefined,
        productId: productForPayment.id,
        productName: productForPayment.name,
        paymentMethod: selectedMethod,
        connectedAccountId,
      });

      logger.debug("Stripe: backend response", data);
      const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
      if (!paymentIntentClientSecret) {
        throw new Error("Invalid response from payment server");
      }

      // Use a minimal init options object, but include wallet flags only if supported to allow wallet buttons to appear
      const initOptions: any = {
        paymentIntentClientSecret,
        merchantDisplayName: `60Seconds - ${productForPayment.name}`,
        allowsDelayedPaymentMethods: true,
        style: "automatic",
      } as any;

      // Attach customer only if returned (keeps init minimal otherwise)
      if (customerId && ephemeralKeySecret) {
        initOptions.customerId = customerId;
        initOptions.customerEphemeralKeySecret = ephemeralKeySecret;
      }

      // Conditionally enable wallet support in init options so PaymentSheet can show wallets when available
      if (Platform.OS === "ios") {
        // Apple Pay support is not configured in the app; Stripe Connect handles
        // wallet flows on the backend. We purposely omit any applePay option here
        // so that PassKit does not need to be linked.
        logger.debug("Apple Pay disabled in-app; Stripe Connect manages wallets.");
      } else {
        if (googlePaySupported) initOptions.googlePay = { merchantCountryCode: "US", testEnv: false };
      }

      logger.debug("Stripe: initPaymentSheet start", { product: productForPayment.id });
      const { error: initError } = await initPaymentSheet(initOptions);
      if (initError) throw new Error(initError.message || "Failed to initialize payment sheet");
      logger.debug("Stripe: initPaymentSheet complete");

      // Extra small delay and ensure interactions finished before presenting
      await new Promise((r) => setTimeout(r, 300));
      let wasPaymentCancelled = false;

      await new Promise((resolve) => {
        InteractionManager.runAfterInteractions(async () => {
          try {
            logger.debug("Stripe: presenting payment sheet");
            const res = await presentPaymentSheet();
            resolve(res);
          } catch (presentErr) {
            logger.error("Stripe presentPaymentSheet threw:", presentErr);
            resolve({ error: { message: (presentErr as any)?.message || String(presentErr) } });
          }
        });
      }).then((presentResult: any) => {
        if (presentResult?.error) {
          const errorCode = String(presentResult.error.code || "").toLowerCase();
          if (errorCode === "canceled" || errorCode === "cancelled") {
            wasPaymentCancelled = true;
            return;
          }
          throw new Error(presentResult.error.message || "Failed to present payment sheet");
        }
      });

      if (wasPaymentCancelled) {
        return;
      }

      // Record the payment on our backend (best-effort)
      try {
        const ownerId =
          (productForPayment as any).ownerId ||
          (productForPayment as any).eventOwnerId ||
          (productForPayment as any).creatorId ||
          null;

        await makePayment(total, `Purchase: ${productForPayment.name}`, {
          productId: productForPayment.id,
          videoId,
          paymentProvider: "stripe",
          buyerId: buyerId || undefined,
          recipientId: ownerId,
          platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
          platformFeeAmount: discountedPlatformFee,
          baseAmount: productForPayment.price,
          amountBeforeDiscount: subtotalWithFee,
          discountAmount: discount,
          voucherId: activeVoucher?.id,
          totalAmount: total,
          stripePaymentIntentClientSecret: paymentIntentClientSecret,
        });

        if (currentAuthId) {
          const order = await orderService.createOrder({
            user_id: currentAuthId,
            video_id: productForPayment.videoId,
            total_amount: total,
            currency: productCurrency,
            payment_method: selectedMethod,
            payment_status: 'pending',
            items: [
              {
                product_id: productForPayment.id,
                quantity: 1,
                price: total,
                name: productForPayment.name,
                type: productForPayment.type,
                description: productForPayment.description,
              },
            ],
            notes: activeVoucher ? `Generated from direct product checkout. Voucher applied: ${activeVoucher.code}` : 'Generated from direct product checkout',
          });

          const settlement = await settleStripePayment({
            paymentIntentClientSecret,
            orderId: order.id,
            recipientId: ownerId,
            grossAmountCents: Math.round(total * 100),
            platformFeeAmountCents: Math.round(discountedPlatformFee * 100),
            currency: productCurrency,
            videoId: productForPayment.videoId,
            items: [
              {
                productId: productForPayment.id,
                quantity: 1,
                unitPrice: total,
                currency: productCurrency,
                ownerId,
              },
            ],
          });

          if (!settlement.success) {
            logger.warn('Stripe settlement failed:', settlement.error);
            await supabase
              .from('orders')
              .update({
                payment_status: 'failed',
                status: 'cancelled',
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id);
            throw new Error(settlement.error || 'Stripe settlement failed. Ticket was not created.');
          }

          const { error: paidUpdateError } = await supabase
            .from('orders')
            .update({
              payment_status: 'paid',
              status: 'open',
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);

          if (paidUpdateError) {
            throw new Error(`Payment succeeded but order status update failed: ${paidUpdateError.message}`);
          }

          const orderNumber =
            (order as any)?.order_number ||
            (order as any)?.orderNumber ||
            `ORD-${Date.now()}-${String(order?.id || '').slice(0, 6)}`;

          await ticketReceiptService.createTicketReceiptsForOrder({
            orderId: order.id,
            orderNumber,
            buyerId: currentAuthId,
            fallbackVideoId: productForPayment.videoId,
            sourceItems: [
              {
                productId: productForPayment.id,
                name: productForPayment.name,
                quantity: 1,
                unitPrice: total,
                currency: productCurrency,
                type: productForPayment.type,
                videoId: productForPayment.videoId,
              },
            ],
          });
        } else {
          const settlement = await settleStripePayment({
            paymentIntentClientSecret,
            recipientId: ownerId,
            grossAmountCents: Math.round(total * 100),
            platformFeeAmountCents: Math.round(discountedPlatformFee * 100),
            currency: productCurrency,
            videoId: productForPayment.videoId,
            items: [
              {
                productId: productForPayment.id,
                quantity: 1,
                unitPrice: total,
                currency: productCurrency,
                ownerId,
              },
            ],
          });

          if (!settlement.success) {
            logger.warn('Stripe settlement failed (no order id path):', settlement.error);
            throw new Error(settlement.error || 'Stripe settlement failed.');
          }
        }
      } catch (recordErr) {
        const message = recordErr instanceof Error ? recordErr.message : 'Payment could not be finalized.';
        logger.warn('Payment finalization failed:', recordErr);
        Alert.alert('Payment Not Successful', message);
        return;
      }

      Alert.alert("Purchase Successful", "You have successfully made the payment.");
      if (activeVoucher && discount > 0) {
        incrementUsageCount(activeVoucher.id);
      }
      decrementDisplayedAvailability(productForPayment.id);
      setShowPaymentOptions(false);
      setSelectedProduct(null);
      setDiscountAmount(0);
      clearActiveVoucher();
      onClose();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Payment failed. Please try again.";
      logger.error("Stripe checkout error:", errMsg);
      Alert.alert("Payment Failed", errMsg);
    } finally {
      setIsPaying(false);
    }
  };

  const completeTwintPayment = async () => {
    if (!twintProduct) {
      Alert.alert("Twint Payment", "No product selected for Twint checkout.");
      return;
    }

    if (!twintPaymentId || !twintOrderId) {
      Alert.alert("Twint Payment", "Missing Twint checkout session. Please restart payment.");
      return;
    }

    const { total, discount, subtotalWithFee } = getDiscountedCheckoutTotal(twintProduct);
    const ownerId = resolveProductOwnerId(twintProduct);
    const currentAuthId = buyerId || user?.id;

    try {
      setIsPaying(true);

      if (!currentAuthId) {
        throw new Error('Please sign in before completing a Twint purchase.');
      }

      const verification = await WorldlineService.verifyPayment(twintPaymentId);
      if (verification.data.status !== "SUCCESS") {
        throw new Error(`Twint payment is ${verification.data.status}. Complete payment first and verify again.`);
      }

      const { error: orderUpdateError } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          payment_method: "twint",
          status: "open",
          updated_at: new Date().toISOString(),
          notes: `Twint payment verified: ${verification.data.paymentId}`,
        })
        .eq("id", twintOrderId);

      if (orderUpdateError) {
        throw new Error(`Failed to update Twint order: ${orderUpdateError.message}`);
      }

      const settlement = await settleExternalOrderPayment({
        orderId: twintOrderId,
        provider: 'twint',
        paymentReference: verification.data.paymentId,
        paymentTransactionId: verification.data.transactionId || verification.data.paymentId,
        recipientId: ownerId,
        grossAmount: total,
        netAmount: getBusinessNetAmount(total),
        currency: resolveProductCurrency(twintProduct.currency),
        videoId: twintProduct.videoId,
        items: [
          {
            productId: twintProduct.id,
            quantity: 1,
            unitPrice: twintProduct.price,
            currency: resolveProductCurrency(twintProduct.currency),
            ownerId,
          },
        ],
        metadata: {
          productId: twintProduct.id,
          baseAmount: twintProduct.price,
          amountBeforeDiscount: subtotalWithFee,
          discountAmount: discount,
          voucherId: activeVoucher?.id,
          totalAmount: total,
        },
      });

      if (!settlement.success) {
        throw new Error(settlement.error || 'Twint settlement failed.');
      }

      const { data: order, error: orderFetchError } = await supabase
        .from("orders")
        .select("id, order_number")
        .eq("id", twintOrderId)
        .single();

      if (orderFetchError || !order) {
        throw new Error("Verified payment order is missing");
      }

      const orderNumber =
        (order as any)?.order_number ||
        (order as any)?.orderNumber ||
        `ORD-${Date.now()}-${String(order?.id || '').slice(0, 6)}`;

      await ticketReceiptService.createTicketReceiptsForOrder({
        orderId: order.id,
        orderNumber,
        buyerId: currentAuthId,
        fallbackVideoId: twintProduct.videoId,
        sourceItems: [
          {
            productId: twintProduct.id,
            name: twintProduct.name,
            quantity: 1,
            unitPrice: total,
            currency: resolveProductCurrency(twintProduct.currency),
            type: twintProduct.type,
            videoId: twintProduct.videoId,
          },
        ],
      });

      Alert.alert("Purchase Successful", "Twint payment completed successfully.");
      if (activeVoucher && discount > 0) {
        incrementUsageCount(activeVoucher.id);
      }
      decrementDisplayedAvailability(twintProduct.id);
      setShowTwintPaymentModal(false);
      setShowTwintWebViewModal(false);
      setTwintProduct(null);
      setSelectedProduct(null);
      setShowPaymentOptions(false);
      setDiscountAmount(0);
      clearActiveVoucher();
      setTwintCheckoutUrl(null);
      setTwintPaymentId(null);
      setTwintOrderId(null);
      onClose();
    } catch (error) {
      logger.error('Twint checkout error:', error);
      Alert.alert('Payment Failed', error instanceof Error ? error.message : 'Twint payment failed.');
    } finally {
      setIsPaying(false);
    }
  };

  const handleOpenTwintApp = async () => {
    if (!twintProduct) return;

    try {
      setTwintOpeningApp(true);
      const opened = await openTwintApp({
        amount: getTotalPayableAmount(twintProduct.price).total,
        currency: resolveProductCurrency(twintProduct.currency),
        reference: twintReference,
        note: `Payment for ${twintProduct.name}`,
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
      logger.error('Twint launch error:', error);
      Alert.alert('Twint Error', 'Could not launch Twint app. Opening Twint Web Checkout instead.');
      setShowTwintPaymentModal(false);
      setShowTwintWebViewModal(true);
    } finally {
      setTwintOpeningApp(false);
    }
  };

  const startTwintCheckout = async (product: Product) => {
    const reference = `twint_product_${Date.now()}`;
    setTwintReference(reference);
    setTwintProduct(product);

    const currentAuthId = buyerId || user?.id;
    const effectiveEmail = buyerEmail || user?.email;
    if (!currentAuthId || !effectiveEmail) {
      Alert.alert("Twint Payment", "Please sign in with a valid email before using Twint.");
      return;
    }

    const { total, discount, subtotalWithFee } = getDiscountedCheckoutTotal(product);
    const currency = resolveProductCurrency(product.currency);

    setIsPaying(true);
    try {
      const order = await orderService.createOrder({
        user_id: currentAuthId,
        video_id: product.videoId,
        total_amount: total,
        currency,
        payment_method: "twint",
        payment_status: "pending",
        items: [{ product_id: product.id, quantity: 1, price: total, name: product.name, type: product.type, description: product.description }],
        notes: activeVoucher
          ? `Twint reference: ${reference}. Voucher applied: ${activeVoucher.code}`
          : `Twint reference: ${reference}`,
      });

      const ownerId = resolveProductOwnerId(product);
      const initialized = await WorldlineService.initializePayment({
        amount: total,
        currency,
        orderId: order.id,
        customerEmail: effectiveEmail,
        customerName: user?.name || effectiveEmail,
        description: `Product purchase via Twint: ${product.name}`,
        metadata: {
          paymentProvider: "twint",
          reference,
          orderId: order.id,
          userId: currentAuthId,
          recipientId: ownerId,
          productId: product.id,
          type: "order_payment",
          amountBeforeDiscount: subtotalWithFee,
          discountAmount: discount,
          voucherId: activeVoucher?.id,
        },
      });

      setTwintPaymentId(initialized.data.paymentId);
      setTwintCheckoutUrl(initialized.data.redirectUrl);
      setTwintOrderId(order.id);
    } catch (error) {
      logger.error("Twint checkout initialization failed:", error);
      Alert.alert(
        "Twint Initialization Failed",
        error instanceof Error ? error.message : "Could not initialize Twint checkout."
      );
      return;
    } finally {
      setIsPaying(false);
    }

    Alert.alert(
      'Twint Payment',
      `You will be redirected to Twint to complete your payment of ${formatAmount(total, currency)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            const isInstalled = await canOpenTwintApp();
            if (isInstalled) {
              setShowTwintPaymentModal(true);
              return;
            }

            Alert.alert(
              'Twint App Not Found',
              'Please install the Twint app to continue. You can also proceed with Twint Web Checkout.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Continue in WebView',
                  onPress: () => setShowTwintWebViewModal(true),
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleApplyVoucher = (amount: number, voucher?: any, quote?: any) => {
    if(!selectedProduct||!voucher||!quote)throw new Error('Validate the selected product voucher first');
    useVoucherStore.getState().applyValidatedVoucher(voucher,quote,[{productId:selectedProduct.id,quantity:1}]);
    setDiscountAmount(amount);
  };

  const handleClearVoucher = () => {
    setDiscountAmount(0);
    clearActiveVoucher();
  };

  const renderPaymentOptions = () => {
    const isIOS = Platform.OS === "ios";
    const primary = isIOS ? ["StripePayment", "BankTransfer"] : ["GooglePay", "BankTransfer"];
    if (isLoggedInNigerianUser) {
      primary.unshift("Paystack");
    }
    const more = ["CreditCard", "Twint"];

    const renderButton = (method: string) => (
      <TouchableOpacity
        key={method}
        style={[
          styles.paymentMethodButton,
          paymentMethod === method && styles.selectedPaymentMethod,
        ]}
        onPress={() => {
          setPaymentMethod(method);
          if (method === "Paystack") {
            if (selectedProduct) {
              paystackCancelledRef.current = false;
              paystackProductRef.current = selectedProduct;
              setPaystackProduct(selectedProduct);
              setShowPaystackModal(true);
              setShowPaymentOptions(false);
            }
            return;
          }
          if (method === "Twint") {
            if (selectedProduct) {
              startTwintCheckout(selectedProduct);
            }
            return;
          }
          startStripeCheckout(method);
        }}
      >
        <Text style={styles.paymentMethodText}>{method}</Text>
      </TouchableOpacity>
    );

    return (
      <>
        {showPaymentOptions && (
          <Text style={styles.noticeText}>
            Apple&nbsp;Pay is **managed by Stripe Connect**; the app has no direct
            Apple&nbsp;Pay/PassKit integration.
          </Text>
        )}
        {hasAvailableVouchers && (
          <TouchableOpacity
            style={styles.voucherMethodButton}
            onPress={() => setShowVoucherModal(true)}
          >
            <Tag size={16} color={Colors.dark.text} style={{ marginRight: 6 }} />
            <Text style={styles.paymentMethodText}>
              {activeVoucher && discountAmount > 0 ? `Voucher: ${activeVoucher.code}` : "Use Voucher"}
            </Text>
          </TouchableOpacity>
        )}
        {primary.map(renderButton)}
        {!showMoreOptions && (
          <TouchableOpacity onPress={() => setShowMoreOptions(true)} style={styles.moreOptionsButton}>
            <Text style={styles.paymentMethodText}>More</Text>
          </TouchableOpacity>
        )}
        {showMoreOptions && more.map(renderButton)}
      </>
    );
  };

  const handleAddToCart = (product: Product) => {
    addToCart(product, 1);
    Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
      { text: "OK" },
    ]);

    // Scroll to top after adding to cart
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const renderProductItem = ({ item }: { item: Product }) => {
    const { fee, total } = getTotalPayableAmount(item.price);
    const itemCurrency = resolveProductCurrency(item.currency);
    const isOwnerView = canEditProduct(item);
    const databaseAvailable = Math.max(0, Number(item.available || 0));
    const databaseSold = Math.max(0, Number(item.sold || 0));
    const receiptSold = Math.max(0, Number(receiptSoldByProduct[item.id] || 0));
    const soldQuantity = Math.max(databaseSold, receiptSold);
    const missingInventoryDecrements = Math.max(0, receiptSold - databaseSold);
    const availableQuantity = Math.max(0, databaseAvailable - missingInventoryDecrements);
    const totalQuantity = availableQuantity + soldQuantity;

    return (
      <View style={styles.productCard}>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={styles.productImage}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={styles.productImagePlaceholder}>
            <ShoppingBag size={24} color={Colors.dark.subtext} />
          </View>
        )}

        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.productDescription} numberOfLines={2}>
            {item.description}
          </Text>

          <View style={styles.productMeta}>
            <View style={styles.productType}>
              {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
              {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
              {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
              {item.type === "merchandise" && (
                <ShoppingBag size={14} color={Colors.dark.primary} />
              )}
              <Text style={styles.productTypeText}>
                {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
              </Text>
            </View>

            <Text style={styles.productAvailability}>{availableQuantity} available</Text>
          </View>

          {isOwnerView && (
            <View style={styles.inventorySummary}>
              <View style={styles.inventoryMetric}>
                <Text style={styles.inventoryValue}>{totalQuantity}</Text>
                <Text style={styles.inventoryLabel}>Total</Text>
              </View>
              <View style={styles.inventoryMetric}>
                <Text style={styles.inventoryValue}>{soldQuantity}</Text>
                <Text style={styles.inventoryLabel}>Sold</Text>
              </View>
              <View style={styles.inventoryMetric}>
                <Text style={[styles.inventoryValue, styles.availableInventoryValue]}>{availableQuantity}</Text>
                <Text style={styles.inventoryLabel}>Available</Text>
              </View>
            </View>
          )}

          <View style={styles.productActions}>
            <View style={styles.priceContainer}>
              <Text style={styles.productPrice}>{formatAmount(item.price, itemCurrency)}</Text>

              {!isOwnerView && (
                <View style={styles.feeContainer}>
                  <Text style={styles.feeText}>
                    {formatAmount(item.price, itemCurrency)} + {formatAmount(fee, itemCurrency)} platform fee
                  </Text>
                  <TouchableOpacity onPress={() => Alert.alert('Service markup', 'A 4% service markup is included in the checkout price before any voucher discount.')} >
                    <Info size={12} color={Colors.dark.subtext} />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.actionButton, styles.addButton]}
                onPress={() => {
                  setSelectedProduct(item); // Set the selected product
                  handleAddToCart(item);
                }}
                disabled={isPaying}
              >
                <Text style={styles.addButtonText}>Add to Cart</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.buyButton]}
                onPress={() => {
                  addToCart(item,1);
                  onClose();
                  router.push('/cart');
                }}
                disabled={isPaying}
              >
                {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
              </TouchableOpacity>
            </View>

            {canEditProduct(item) && (
              <TouchableOpacity
                style={styles.ownerEditButton}
                onPress={() => handleEditProduct(item)}
                disabled={isPaying}
              >
                <Text style={styles.ownerEditButtonText}>Edit Product</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.hintText}>
              You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const listHeaderComponent = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Available Products</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeButton}>Close</Text>
        </TouchableOpacity>
      </View>

      {/* make it super obvious to reviewers where Apple Pay lives */}
      {Platform.OS === 'ios' && applePaySupported && (
        <Text style={[styles.hintText, { marginHorizontal: 16, marginTop: 4 }]}>Apple Pay is available on this screen – tap a product and choose "StripePayment" to invoke the wallet.</Text>
      )}

      {showPaymentOptions && selectedProduct && (
        <View style={styles.paymentOptionsContainer}>
          {(() => {
            const checkout = getDiscountedCheckoutTotal(selectedProduct);
            const productCurrency = resolveProductCurrency(selectedProduct.currency);
            return (
              <>
          <View style={styles.paymentSummary}>
            <Text style={styles.paymentOptionsTitle}>Pay for: {selectedProduct.name}</Text>
            <Text style={styles.paymentAmount}>
              {formatAmount(checkout.total, productCurrency)} total
            </Text>
            {checkout.discount > 0 && activeVoucher && (
              <Text style={styles.discountCaption}>
                {activeVoucher.code}: -{formatAmount(checkout.discount, productCurrency)}
              </Text>
            )}
          </View>
          <Text style={styles.paymentMethodLabel}>Select Payment Method</Text>
          {!hasAvailableVouchers && (
            <Text style={styles.noVoucherText}>No active vouchers available for this product.</Text>
          )}
          {renderPaymentOptions()}
              </>
            );
          })()}
        </View>
      )}
    </>
  );

  const listEmptyComponent =
    displayProducts.length === 0 && !isLoading ? (
      <View style={styles.emptyContainer}>
        <ShoppingBag size={48} color={Colors.dark.subtext} />
        <Text style={styles.emptyText}>No products available for this event</Text>
      </View>
    ) : null;

  const handlePaystackSuccess = async (reference: string, orderId?: string) => {
    // If the user cancelled or navigated away before verification finished, ignore.
    if (paystackCancelledRef.current) return;

    setShowPaystackModal(false);
    // Read from the ref so we always get the latest product even from stale closures.
    const product = paystackProductRef.current;
    if (!product) return;
    const { total, discount, subtotalWithFee } = getDiscountedCheckoutTotal(product);
    const currentAuthId = buyerId || user?.id;
    let purchaseRecorded = false;

    try {
      setIsPaying(true);
      const ownerId = resolveProductOwnerId(product);
      if (!currentAuthId) {
        throw new Error('Please sign in before completing a Paystack purchase.');
      }

      if (!orderId) throw new Error('Missing server-created Paystack order.');

      const settlement = await settleExternalOrderPayment({
        orderId,
        provider: 'paystack',
        paymentReference: reference,
        paymentTransactionId: reference,
        recipientId: ownerId,
        grossAmount: total,
        netAmount: getBusinessNetAmount(total),
        currency: resolveProductCurrency(product.currency),
        videoId: product.videoId,
        items: [
          {
            productId: product.id,
            quantity: 1,
            unitPrice: product.price,
            currency: resolveProductCurrency(product.currency),
            ownerId,
          },
        ],
        metadata: {
          productId: product.id,
          baseAmount: product.price,
          amountBeforeDiscount: subtotalWithFee,
          discountAmount: discount,
          voucherId: activeVoucher?.id,
          totalAmount: total,
        },
      });

      if (!settlement.success) {
        throw new Error(settlement.error || 'Paystack settlement failed.');
      }

      purchaseRecorded = true;
    } catch (recordErr) {
      logger.warn('Paystack payment succeeded but recording failed:', { reference, error: recordErr });
    } finally {
      setIsPaying(false);
    }

    // Only continue if we haven't been cancelled in the meantime.
    if (paystackCancelledRef.current) return;

    if (!purchaseRecorded) {
      Alert.alert(
        'Payment Recorded, Settlement Pending',
        `Your Paystack payment was received, but organizer settlement could not be completed yet. Please contact support with reference: ${reference}`
      );
      return;
    }

    Alert.alert('Purchase Successful', 'Your Paystack payment was completed successfully.');
    if (activeVoucher && discount > 0) {
      incrementUsageCount(activeVoucher.id);
    }
    decrementDisplayedAvailability(product.id);
    paystackProductRef.current = null;
    setPaystackProduct(null);
    setDiscountAmount(0);
    clearActiveVoucher();
    onClose();
  };

  return (
    <>
      <FlatList
        ref={flatListRef}
        data={displayProducts}
        renderItem={renderProductItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeaderComponent}
        ListEmptyComponent={listEmptyComponent}
        style={styles.list}
        contentContainerStyle={styles.productsList}
        showsVerticalScrollIndicator={false}
        scrollEnabled={true}
        nestedScrollEnabled={true}
      />
      {paystackProduct && (
        (() => {
          const ownerId = resolveProductOwnerId(paystackProduct);
          const canCurrentUserFixRouting = Boolean(user?.id && ownerId && user.id === ownerId);
          const routing = getPaystackRoutingForOwner(ownerId);
          const productSubaccount = String(
            (paystackProduct as any)?.paystackSubaccountCode ||
            (paystackProduct as any)?.paystack_subaccount_code ||
            (paystackProduct as any)?.subaccount ||
            ''
          ).trim();
          const productSplitCode = String(
            (paystackProduct as any)?.paystackSplitCode ||
            (paystackProduct as any)?.paystack_split_code ||
            (paystackProduct as any)?.split_code ||
            ''
          ).trim();
          const productBearer = String(
            (paystackProduct as any)?.paystackBearer ||
            (paystackProduct as any)?.paystack_bearer ||
            (paystackProduct as any)?.bearer ||
            ''
          ).trim().toLowerCase();
          const productCharge = Number(
            (paystackProduct as any)?.paystackTransactionCharge ||
            (paystackProduct as any)?.paystack_transaction_charge ||
            (paystackProduct as any)?.transaction_charge
          );

          return (
        <PaystackWebView
          visible={showPaystackModal}
          onClose={() => {
            paystackCancelledRef.current = true;
            paystackProductRef.current = null;
            setShowPaystackModal(false);
            setPaystackProduct(null);
          }}
          onSuccess={handlePaystackSuccess}
          onCancel={() => {
            paystackCancelledRef.current = true;
            paystackProductRef.current = null;
            setShowPaystackModal(false);
            setPaystackProduct(null);
          }}
          amount={getDiscountedCheckoutTotal(paystackProduct).total}
          email={buyerEmail || user?.email || ''}
          description={`Purchase: ${paystackProduct.name}`}
          metadata={{
            productId: paystackProduct.id,
            ownerId,
            videoId,
            voucherId: activeVoucher?.id,
            discountAmount,
          }}
          paystackSubaccount={productSubaccount || routing.subaccount}
          paystackSplitCode={productSplitCode || routing.splitCode}
          paystackTransactionCharge={
            Number.isFinite(productCharge)
              ? productCharge
              : (
                  routing.transactionCharge ??
                  getDiscountedPlatformFee(getDiscountedCheckoutTotal(paystackProduct).total)
                )
          }
          paystackBearer={
            productBearer === 'subaccount'
              ? 'subaccount'
              : routing.bearer
          }
          requireSplitRouting={true}
          onRoutingSetupRequired={
            canCurrentUserFixRouting
              ? () => {
                  paystackCancelledRef.current = true;
                  paystackProductRef.current = null;
                  setShowPaystackModal(false);
                  setPaystackProduct(null);
                  router.push('/bank-accounts');
                }
              : undefined
          }
        />
          );
        })()
      )}

      {twintProduct && (
        <TwintPaymentModal
          visible={showTwintPaymentModal}
          amountLabel={formatAmount(
            getDiscountedCheckoutTotal(twintProduct).total,
            resolveProductCurrency(twintProduct.currency)
          )}
          reference={twintReference}
          description={`Pay for ${twintProduct.name} with Twint app, then confirm after successful payment.`}
          processing={isPaying}
          openingApp={twintOpeningApp}
          onClose={() => setShowTwintPaymentModal(false)}
          onOpenApp={handleOpenTwintApp}
          onComplete={completeTwintPayment}
        />
      )}

      {twintProduct && (
        <TwintWebViewModal
          visible={showTwintWebViewModal}
          url={twintCheckoutUrl || "about:blank"}
          processing={isPaying}
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
          onComplete={completeTwintPayment}
        />
      )}

      {selectedProduct && (
        <ApplyVoucherModal
          visible={showVoucherModal}
          onClose={() => setShowVoucherModal(false)}
          onApply={handleApplyVoucher}
          totalAmount={getTotalPayableAmount(selectedProduct.price).total}
          productId={selectedProduct.id}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  list: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
  closeButton: { color: Colors.dark.primary, fontSize: 16 },

  productsList: { padding: 16, paddingBottom: 24 },

  paymentOptionsContainer: {
    margin: 16,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
  },
  paymentSummary: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  inventorySummary: {
    flexDirection: 'row',
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  inventoryMetric: {
    flex: 1,
    alignItems: 'center',
  },
  inventoryValue: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
  },
  availableInventoryValue: {
    color: Colors.dark.success,
  },
  inventoryLabel: {
    color: Colors.dark.subtext,
    fontSize: 11,
    marginTop: 2,
  },
  paymentOptionsTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  paymentAmount: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.primary,
  },
  discountCaption: {
    fontSize: 12,
    color: "#4CAF50",
    marginTop: 6,
    fontWeight: "600",
  },
  noticeText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 8,
    textAlign: "center",
  },
  paymentMethodLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  paymentMethodButton: {
    padding: 12,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    marginVertical: 8,
    alignItems: "center",
  },
  selectedPaymentMethod: {
    backgroundColor: Colors.dark.primary,
  },
  paymentMethodText: {
    fontSize: 14,
    color: Colors.dark.text,
  },
  voucherMethodButton: {
    padding: 12,
    backgroundColor: "rgba(76, 175, 80, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(76, 175, 80, 0.4)",
    borderRadius: 8,
    marginVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  noVoucherText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },

  moreOptionsButton: {
    marginTop: 8,
    padding: 10,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    alignItems: "center",
  },

  productCard: {
    flexDirection: "row",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  productImage: { width: 100, height: 100 },
  productImagePlaceholder: {
    width: 100,
    height: 100,
    backgroundColor: Colors.dark.background,
    justifyContent: "center",
    alignItems: "center",
  },

  productInfo: { flex: 1, padding: 12, minWidth: 0 },
  productName: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  productDescription: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },

  productMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  productTypeText: {
    fontSize: 12,
    color: Colors.dark.primary,
    marginLeft: 4,
  },
  productAvailability: { fontSize: 12, color: Colors.dark.subtext },

  productActions: { flexDirection: "column", gap: 10 },

  priceContainer: { flexDirection: "column" },
  productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
  feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  feeText: { fontSize: 12, color: Colors.dark.subtext },

  buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  actionButton: {
    width: "48%",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  addButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
  buyButton: { backgroundColor: Colors.dark.primary },
  buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },
  ownerEditButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    backgroundColor: "rgba(138, 43, 226, 0.08)",
    alignItems: "center",
  },
  ownerEditButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },

  hintText: { fontSize: 12, color: Colors.dark.subtext },

  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },
});

export default ProductsList;
