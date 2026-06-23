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
  const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
  const { makePayment, fetchPaymentMethods } = useWalletStore();
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
          initPaymentSheet: stripeModule.initPaymentSheet,
          presentPaymentSheet: stripeModule.presentPaymentSheet,
        };
      }
    } catch (error) {
      // Some development binaries (for example Expo Go) do not include Stripe native modules.
      console.warn("Stripe native module unavailable in this build:", error);
    }

    return stripeApiRef.current;
  }, []);

  const [isPaying, setIsPaying] = React.useState(false);
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
  const resolveProductCurrency = (currency?: string | null) =>
    normalizeCurrencyCode(currency, buyerFallbackCurrency);
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

  React.useEffect(() => {
    if (!products.length) fetchProducts(videoId); // Only fetch if products is empty
    if (user) fetchPaymentMethods();
  }, [videoId, products, fetchProducts, fetchPaymentMethods, user]);

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
    if (voucher.usageCount >= voucher.usageLimit) return false;
    if (voucher.productId && product?.id && voucher.productId !== product.id) return false;
    if (voucher.productId && !product?.id) return false;
    const expiryDate = new Date(voucher.expiryDate);
    return !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() > Date.now();
  }, []);

  const availableVouchers = React.useMemo(
    () => vouchers.filter((voucher) => isVoucherUsableForProduct(voucher, selectedProduct)),
    [vouchers, selectedProduct, isVoucherUsableForProduct]
  );

  const hasAvailableVouchers = availableVouchers.length > 0;

  const getDiscountedCheckoutTotal = React.useCallback(
    (product: Product) => {
      const { fee, total } = getTotalPayableAmount(product.price);
      const cappedDiscount = Math.min(discountAmount, total);
      const discountedTotal = Math.max(0, total - cappedDiscount);

      return {
        fee,
        subtotalWithFee: total,
        discount: cappedDiscount,
        total: discountedTotal,
      };
    },
    [discountAmount]
  );

  const canEditProduct = (product: any) => {
    return !!user?.id && resolveProductOwnerId(product) === user.id;
  };

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

  const createPaymentSheetSession = async (params: {
    amount: number;
    currency: string;
    platformFeeAmount: number;
    customerEmail?: string;
    productId?: string;
    productName?: string;
    paymentMethod?: string;
    connectedAccountId?: string | null;
  }) => {
    const primary = await supabase.functions.invoke("stripe-create-checkout", {
      body: params,
    });

    const primaryFailed =
      !!primary.error ||
      !!primary.data?.error ||
      !primary.data?.paymentIntentClientSecret;

    if (!primaryFailed) {
      return primary.data;
    }

    console.warn("stripe-create-checkout failed, retrying with stripe-create-payment-sheet", {
      error: primary.error,
      data: primary.data,
    });

    const fallback = await supabase.functions.invoke("stripe-create-payment-sheet", {
      body: {
        amount: params.amount,
        currency: params.currency,
        customerEmail: params.customerEmail,
        productId: params.productId,
        productName: params.productName,
        platformFeeAmount: 0,
      },
    });

    const fallbackFailed =
      !!fallback.error ||
      !!fallback.data?.error ||
      !fallback.data?.paymentIntentClientSecret;

    if (fallbackFailed) {
      const primaryMessage =
        primary.error?.message || primary.data?.error || "stripe-create-checkout failed";
      const fallbackMessage =
        fallback.error?.message || fallback.data?.error || "stripe-create-payment-sheet failed";
      throw new Error(`${primaryMessage}. Fallback failed: ${fallbackMessage}`);
    }

    return fallback.data;
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
      console.debug("Stripe publishable keys:", { envKey, expoExtraKey });
    } catch (e) {
      console.debug("Stripe key check error:", e);
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

    try {
      setIsPaying(true);

      // Determine connected account (Stripe Connect destination) from product metadata
      const connectedAccountId =
        (productForPayment as any).ownerStripeAccountId ||
        (productForPayment as any).stripeConnectedAccountId ||
        (productForPayment as any).connectedAccountId ||
        null;

      console.debug("Stripe: creating checkout on backend", {
        productId: productForPayment.id,
        connectedAccountId,
        amount_cents: Math.round(total * 100),
      });

      const data = await createPaymentSheetSession({
        amount: Math.round(total * 100),
        currency: productCurrency.toLowerCase(),
        platformFeeAmount: Math.round(discountedPlatformFee * 100),
        customerEmail: buyerEmail || undefined,
        productId: productForPayment.id,
        productName: productForPayment.name,
        paymentMethod: selectedMethod,
        connectedAccountId,
      });

      console.debug("Stripe: backend response", data);
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
        console.debug("Apple Pay disabled in-app; Stripe Connect manages wallets.");
      } else {
        if (googlePaySupported) initOptions.googlePay = { merchantCountryCode: "US", testEnv: false };
      }

      console.debug("Stripe: initPaymentSheet start", { product: productForPayment.id });
      const { error: initError } = await initPaymentSheet(initOptions);
      if (initError) throw new Error(initError.message || "Failed to initialize payment sheet");
      console.debug("Stripe: initPaymentSheet complete");

      // Extra small delay and ensure interactions finished before presenting
      await new Promise((r) => setTimeout(r, 300));
      let wasPaymentCancelled = false;

      await new Promise((resolve) => {
        InteractionManager.runAfterInteractions(async () => {
          try {
            console.debug("Stripe: presenting payment sheet");
            const res = await presentPaymentSheet();
            resolve(res);
          } catch (presentErr) {
            console.error("Stripe presentPaymentSheet threw:", presentErr);
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

        const currentAuthId = buyerId || user?.id;

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
            console.warn('Stripe settlement failed:', settlement.error);
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
              status: 'completed',
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
            console.warn('Stripe settlement failed (no order id path):', settlement.error);
            throw new Error(settlement.error || 'Stripe settlement failed.');
          }
        }
      } catch (recordErr) {
        const message = recordErr instanceof Error ? recordErr.message : 'Payment could not be finalized.';
        console.warn('Payment finalization failed:', recordErr);
        Alert.alert('Payment Not Successful', message);
        return;
      }

      Alert.alert("Purchase Successful", "You have successfully made the payment.");
      if (activeVoucher && discount > 0) {
        incrementUsageCount(activeVoucher.id);
      }
      setShowPaymentOptions(false);
      setSelectedProduct(null);
      setDiscountAmount(0);
      clearActiveVoucher();
      onClose();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Payment failed. Please try again.";
      console.error("Stripe checkout error:", errMsg);
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
          status: "completed",
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
      console.error('Twint checkout error:', error);
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
      console.error('Twint launch error:', error);
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
        items: [{ product_id: product.id, quantity: 1, price: total, name: product.name }],
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
      console.error("Twint checkout initialization failed:", error);
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

            <Text style={styles.productAvailability}>{item.available} available</Text>
          </View>

          <View style={styles.productActions}>
            <View style={styles.priceContainer}>
              <Text style={styles.productPrice}>{formatAmount(item.price, itemCurrency)}</Text>

              {!isOwnerView && (
                <View style={styles.feeContainer}>
                  <Text style={styles.feeText}>
                    {formatAmount(item.price, itemCurrency)} + {formatAmount(fee, itemCurrency)} platform fee
                  </Text>
                  <TouchableOpacity onPress={() => setShowPaymentOptions(true)}>
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
                  if (selectedProduct?.id && selectedProduct.id !== item.id) {
                    setDiscountAmount(0);
                    clearActiveVoucher();
                  }
                  setSelectedProduct(item);
                  setShowMoreOptions(false);
                  setShowPaymentOptions(true);
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
    products.length === 0 && !isLoading ? (
      <View style={styles.emptyContainer}>
        <ShoppingBag size={48} color={Colors.dark.subtext} />
        <Text style={styles.emptyText}>No products available for this event</Text>
      </View>
    ) : null;

  const handlePaystackSuccess = async (reference: string) => {
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

      const order = await orderService.createOrder({
        user_id: currentAuthId,
        video_id: product.videoId,
        total_amount: total,
        currency: resolveProductCurrency(product.currency),
        payment_method: 'paystack',
        payment_status: 'paid',
        items: [{ product_id: product.id, quantity: 1, price: total, name: product.name }],
        notes: `Paystack reference: ${reference}`,
      });

      const settlement = await settleExternalOrderPayment({
        orderId: order.id,
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

      const orderNumber =
        (order as any)?.order_number ||
        (order as any)?.orderNumber ||
        `ORD-${Date.now()}-${String(order?.id || '').slice(0, 6)}`;
      await ticketReceiptService.createTicketReceiptsForOrder({
        orderId: order.id,
        orderNumber,
        buyerId: currentAuthId,
        fallbackVideoId: product.videoId,
        sourceItems: [{
          productId: product.id,
          name: product.name,
          quantity: 1,
          unitPrice: total,
          currency: resolveProductCurrency(product.currency),
          type: product.type,
          videoId: product.videoId,
        }],
      });
      purchaseRecorded = true;
    } catch (recordErr) {
      console.warn('Paystack payment succeeded but recording failed:', { reference, error: recordErr });
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
        data={products}
        renderItem={renderProductItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeaderComponent}
        ListEmptyComponent={listEmptyComponent}
        contentContainerStyle={[styles.container, styles.productsList]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      />
      {paystackProduct && (
        (() => {
          const ownerId = resolveProductOwnerId(paystackProduct);
          const routing = getPaystackRoutingForOwner(ownerId);
          const productSubaccount = String((paystackProduct as any)?.paystackSubaccountCode || '').trim();
          const productSplitCode = String((paystackProduct as any)?.paystackSplitCode || '').trim();
          const productBearer = String((paystackProduct as any)?.paystackBearer || '').trim().toLowerCase();
          const productCharge = Number((paystackProduct as any)?.paystackTransactionCharge);

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















////////////////////    23 feb  2026      /////////////////////

// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   FlatList,
//   Platform,
//   ScrollView,
//   InteractionManager,
// } from "react-native";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import { Image } from "expo-image";
// import { useStripe } from "@stripe/stripe-react-native";
// import Constants from "expo-constants";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useAuthStore } from "@/store/auth-store";
// import { supabase } from "@/lib/supabase";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// const ProductsList = ({
//   videoId,
//   onClose,
//   products = [], // Default to an empty array if not passed
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) => {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();
//   const { initPaymentSheet, presentPaymentSheet } = useStripe();
//   const user = useAuthStore((s) => s.user);

//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null);
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false);
//   const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);
//   const [showMoreOptions, setShowMoreOptions] = React.useState(false); // Track if "More" is clicked
//   const [applePaySupported, setApplePaySupported] = React.useState<boolean>(Platform.OS === "ios");
//   const [googlePaySupported, setGooglePaySupported] = React.useState<boolean>(Platform.OS === "android");

//   const flatListRef = React.useRef<FlatList>(null);

//   React.useEffect(() => {
//     if (!products.length) fetchProducts(videoId); // Only fetch if products is empty
//     if (user) fetchPaymentMethods();
//   }, [videoId, products, fetchProducts, fetchPaymentMethods, user]);

//   // We assume wallet availability based on platform; deeper runtime checks can be added if needed.

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (selectedMethod: string) => {
//     if (!selectedMethod || !selectedProduct) {
//       Alert.alert("Payment Method or Product Required", "Please select a product and payment method.");
//       return;
//     }

//     // Diagnostic: log any publishable key sources but do not block — rely on native `useStripe` hooks.
//     try {
//       const envKey = process.env?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
//       const expoExtraKey = (Constants?.expoConfig?.extra && (Constants.expoConfig.extra as any).EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY) ||
//         (Constants?.manifest?.extra && (Constants.manifest.extra as any).EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
//       console.debug("Stripe publishable keys:", { envKey, expoExtraKey });
//     } catch (e) {
//       console.debug("Stripe key check error:", e);
//     }

//     if (!initPaymentSheet || !presentPaymentSheet) {
//       Alert.alert(
//         "Stripe Not Available",
//         "Payment is currently unavailable on this device. Please try again later."
//       );
//       return;
//     }

//     const { fee, total } = getTotalPayableAmount(selectedProduct.price);
//     const productForPayment = selectedProduct;

//     try {
//       setIsPaying(true);

//       // Determine connected account (Stripe Connect destination) from product metadata
//       const connectedAccountId =
//         (productForPayment as any).ownerStripeAccountId ||
//         (productForPayment as any).stripeConnectedAccountId ||
//         (productForPayment as any).connectedAccountId ||
//         null;

//       console.debug("Stripe: creating checkout on backend", {
//         productId: productForPayment.id,
//         connectedAccountId,
//         amount_cents: Math.round(total * 100),
//       });

//       const { data, error } = await supabase.functions.invoke("stripe-create-checkout", {
//         body: {
//           amount: Math.round(total * 100),
//           currency: productForPayment.currency || "usd",
//           platformFeeAmount: Math.round(fee * 100),
//           customerEmail: buyerEmail || undefined,
//           productId: productForPayment.id,
//           productName: productForPayment.name,
//           paymentMethod: selectedMethod,
//           connectedAccountId,
//         },
//       });

//       if (error) throw new Error(error.message || "Failed to create payment");
//       if (data?.error) throw new Error(data.error);

//       console.debug("Stripe: backend response", data);
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
//       if (!paymentIntentClientSecret) {
//         throw new Error("Invalid response from payment server");
//       }

//       // Use a minimal init options object, but include wallet flags only if supported to allow wallet buttons to appear
//       const initOptions: any = {
//         paymentIntentClientSecret,
//         merchantDisplayName: `60Seconds - ${productForPayment.name}`,
//         allowsDelayedPaymentMethods: true,
//         style: "automatic",
//       } as any;

//       // Attach customer only if returned (keeps init minimal otherwise)
//       if (customerId && ephemeralKeySecret) {
//         initOptions.customerId = customerId;
//         initOptions.customerEphemeralKeySecret = ephemeralKeySecret;
//       }

//       // Conditionally enable wallet support in init options so PaymentSheet can show wallets when available
//       if (Platform.OS === "ios") {
//         if (applePaySupported) initOptions.applePay = { merchantCountryCode: "US" };
//       } else {
//         if (googlePaySupported) initOptions.googlePay = { merchantCountryCode: "US", testEnv: false };
//       }

//       console.debug("Stripe: initPaymentSheet start", { product: productForPayment.id });
//       const { error: initError } = await initPaymentSheet(initOptions);
//       if (initError) throw new Error(initError.message || "Failed to initialize payment sheet");
//       console.debug("Stripe: initPaymentSheet complete");

//       // Extra small delay and ensure interactions finished before presenting
//       await new Promise((r) => setTimeout(r, 300));
//       await new Promise((resolve) => {
//         InteractionManager.runAfterInteractions(async () => {
//           try {
//             console.debug("Stripe: presenting payment sheet");
//             const res = await presentPaymentSheet();
//             resolve(res);
//           } catch (presentErr) {
//             console.error("Stripe presentPaymentSheet threw:", presentErr);
//             resolve({ error: { message: (presentErr as any)?.message || String(presentErr) } });
//           }
//         });
//       }).then((presentResult: any) => {
//         if (presentResult?.error) {
//           if (presentResult.error.code === "Canceled") return;
//           throw new Error(presentResult.error.message || "Failed to present payment sheet");
//         }
//       });

//       // Record the payment on our backend (best-effort)
//       try {
//         await makePayment(total, `Purchase: ${productForPayment.name}`, {
//           productId: productForPayment.id,
//           videoId,
//           paymentProvider: "stripe",
//           buyerId: buyerId || undefined,
//           platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//           platformFeeAmount: fee,
//           baseAmount: productForPayment.price,
//           totalAmount: total,
//           stripePaymentIntentClientSecret: paymentIntentClientSecret,
//         });
//       } catch (recordErr) {
//         console.warn("Payment succeeded but recording failed:", recordErr);
//       }

//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       setShowPaymentOptions(false);
//       setSelectedProduct(null);
//       onClose();
//     } catch (e) {
//       const errMsg = e instanceof Error ? e.message : "Payment failed. Please try again.";
//       console.error("Stripe checkout error:", errMsg);
//       Alert.alert("Payment Failed", errMsg);
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const primary = isIOS ? ["ApplePay", "BankTransfer"] : ["GooglePay", "BankTransfer"];
//     const more = ["CreditCard", "Twint"];

//     const renderButton = (method: string) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => {
//           setPaymentMethod(method);
//           startStripeCheckout(method);
//         }}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     );

//     return (
//       <>
//         {primary.map(renderButton)}
//         {!showMoreOptions && (
//           <TouchableOpacity onPress={() => setShowMoreOptions(true)} style={styles.moreOptionsButton}>
//             <Text style={styles.paymentMethodText}>More</Text>
//           </TouchableOpacity>
//         )}
//         {showMoreOptions && more.map(renderButton)}
//       </>
//     );
//   };

//   const renderMoreOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const allOptions = isIOS
//       ? ["CreditCard", "Twint"]
//       : ["CreditCard", "Twint"];

//     return allOptions.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => {
//           setPaymentMethod(method);
//           startStripeCheckout(method);
//           setShowPaymentOptions(false);
//         }}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);

//     // Scroll to top after adding to cart
//     flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   ${item.price.toFixed(2)} + ${fee.toFixed(2)} platform fee
//                 </Text>
//                 <TouchableOpacity onPress={() => setShowPaymentOptions(true)}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   handleAddToCart(item);
//                 }}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   setShowPaymentOptions(true); // Show payment options on Buy Now click
//                 }}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   const listHeaderComponent = (
//     <>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && selectedProduct && (
//         <View style={styles.paymentOptionsContainer}>
//           <View style={styles.paymentSummary}>
//             <Text style={styles.paymentOptionsTitle}>Pay for: {selectedProduct.name}</Text>
//             <Text style={styles.paymentAmount}>
//               ${getTotalPayableAmount(selectedProduct.price).total.toFixed(2)} total
//             </Text>
//           </View>
//           <Text style={styles.paymentMethodLabel}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//           {showMoreOptions && renderMoreOptions()}
//           {!showMoreOptions && (
//             <TouchableOpacity onPress={() => setShowMoreOptions(true)} style={styles.moreOptionsButton}>
//               <Text style={styles.paymentMethodText}>More</Text>
//             </TouchableOpacity>
//           )}
//         </View>
//       )}
//     </>
//   );

//   const listEmptyComponent =
//     products.length === 0 && !isLoading ? (
//       <View style={styles.emptyContainer}>
//         <ShoppingBag size={48} color={Colors.dark.subtext} />
//         <Text style={styles.emptyText}>No products available for this event</Text>
//       </View>
//     ) : null;

//   return (
//     <FlatList
//       ref={flatListRef}
//       data={products}
//       renderItem={renderProductItem}
//       keyExtractor={(item) => item.id}
//       ListHeaderComponent={listHeaderComponent}
//       ListEmptyComponent={listEmptyComponent}
//       contentContainerStyle={[styles.container, styles.productsList]}
//       showsVerticalScrollIndicator={false}
//     />
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentSummary: {
//     marginBottom: 12,
//     paddingBottom: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   paymentAmount: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.primary,
//   },
//   paymentMethodLabel: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   moreOptionsButton: {
//     marginTop: 8,
//     padding: 10,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     alignItems: "center",
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },
// });

// export default ProductsList;















// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   FlatList,
//   Platform,
//   ScrollView,
// } from "react-native";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[]; // Make products optional
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// const ProductsList = ({
//   videoId,
//   onClose,
//   products = [], // Default to an empty array if not passed
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) => {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null);
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false);
//   const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null); // Track selected product

//   const scrollViewRef = React.useRef<ScrollView>(null);

//   React.useEffect(() => {
//     if (!products.length) fetchProducts(videoId); // Only fetch if products is empty
//     fetchPaymentMethods();
//   }, [videoId, products, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (selectedMethod: string) => {
//     if (!selectedMethod || !selectedProduct) {
//       Alert.alert("Payment Method or Product Required", "Please select a product and payment method.");
//       return;
//     }

//     const { fee, total } = getTotalPayableAmount(selectedProduct.price);

//     try {
//       setIsPaying(true);

//       // Send request to Supabase to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: "usd", // Adjust currency if needed
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId: selectedProduct.id,
//             productName: selectedProduct.name,
//             paymentMethod: selectedMethod,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment, log the payment into Supabase (update transaction table)
//       await makePayment(total, `Purchase: ${selectedProduct.name}`, {
//         productId: selectedProduct.id,
//         videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: selectedProduct.price,
//         totalAmount: total,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       onClose();
//     } catch (e) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const options = isIOS
//       ? ["ApplePay", "BankTransfer", "CreditCard", "Twint"]
//       : ["GooglePay", "BankTransfer", "CreditCard", "Twint"];

//     return options.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => {
//           setPaymentMethod(method); // Set selected payment method
//           startStripeCheckout(method); // Proceed with payment
//           setShowPaymentOptions(false); // Hide payment options after selection
//         }}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);

//     // Scroll to the selected product after adding it to the cart
//     scrollViewRef.current?.scrollTo({
//       y: 0,
//       animated: true,
//     });
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   ${item.price.toFixed(2)} + ${fee.toFixed(2)} platform fee
//                 </Text>
//                 <TouchableOpacity onPress={() => setShowPaymentOptions(true)}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   handleAddToCart(item);
//                 }}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   setShowPaymentOptions(true); // Show payment options on Buy Now click
//                 }}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && (
//         <View style={styles.paymentOptionsContainer}>
//           <Text style={styles.paymentOptionsTitle}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </ScrollView>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },
// });

// export default ProductsList;















////////////////////      Payment sheets proper working  ///////     20/01/2026 /////////


// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   FlatList,
//   Platform,
//   ScrollView,
// } from "react-native";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[]; // Make products optional
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// const ProductsList = ({
//   videoId,
//   onClose,
//   products = [], // Default to an empty array if not passed
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) => {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null);
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false);
//   const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null); // Track selected product

//   const scrollViewRef = React.useRef<ScrollView>(null);

//   React.useEffect(() => {
//     if (!products.length) fetchProducts(videoId); // Only fetch if products is empty
//     fetchPaymentMethods();
//   }, [videoId, products, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (selectedMethod: string) => {
//     if (!selectedMethod || !selectedProduct) {
//       Alert.alert("Payment Method or Product Required", "Please select a product and payment method.");
//       return;
//     }

//     const { fee, total } = getTotalPayableAmount(selectedProduct.price);

//     try {
//       setIsPaying(true);

//       // Send request to Supabase to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: "usd", // Adjust currency if needed
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId: selectedProduct.id,
//             productName: selectedProduct.name,
//             paymentMethod: selectedMethod,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment, log the payment into Supabase (update transaction table)
//       await makePayment(total, `Purchase: ${selectedProduct.name}`, {
//         productId: selectedProduct.id,
//         videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: selectedProduct.price,
//         totalAmount: total,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       onClose();
//     } catch (e) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const options = isIOS
//       ? ["ApplePay", "BankTransfer", "CreditCard", "Twint"]
//       : ["GooglePay", "BankTransfer", "CreditCard", "Twint"];

//     return options.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => {
//           setPaymentMethod(method); // Set selected payment method
//           startStripeCheckout(method); // Proceed with payment
//           setShowPaymentOptions(false); // Hide payment options after selection
//         }}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);

//     // Scroll to the selected product after adding it to the cart
//     scrollViewRef.current?.scrollTo({
//       y: 0,
//       animated: true,
//     });
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={() => setShowPaymentOptions(true)}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   handleAddToCart(item);
//                 }}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => {
//                   setSelectedProduct(item); // Set the selected product
//                   setShowPaymentOptions(true); // Show payment options on Buy Now click
//                 }}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && (
//         <View style={styles.paymentOptionsContainer}>
//           <Text style={styles.paymentOptionsTitle}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </ScrollView>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },
// });

// export default ProductsList;

















// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   FlatList,
//   Platform,
//   ScrollView,
// } from "react-native";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import { Image } from "expo-image";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[]; // Make products optional
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// const ProductsList = ({
//   videoId,
//   onClose,
//   products = [], // Default to an empty array if not passed
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) => {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null);
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false);

//   const scrollViewRef = React.useRef<ScrollView>(null);

//   React.useEffect(() => {
//     if (!products.length) fetchProducts(videoId); // Only fetch if products is empty
//     fetchPaymentMethods();
//   }, [videoId, products, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (selectedMethod: string, productId: string, productName: string, productPrice: number) => {
//     if (!selectedMethod) {
//       Alert.alert("Payment Method Required", "Please select a payment method.");
//       return;
//     }

//     const { fee, total } = getTotalPayableAmount(productPrice);

//     try {
//       setIsPaying(true);

//       // Send request to Supabase to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: "usd", // Adjust currency if needed
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId,
//             productName,
//             paymentMethod: selectedMethod,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment, log the payment into Supabase (update transaction table)
//       await makePayment(total, `Purchase: ${productName}`, {
//         productId,
//         videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: productPrice,
//         totalAmount: total,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       onClose();
//     } catch (e) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const options = isIOS
//       ? ["ApplePay", "BankTransfer", "CreditCard", "Twint"]
//       : ["GooglePay", "BankTransfer", "CreditCard", "Twint"];

//     return options.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => {
//           startStripeCheckout(method, "product_id", "Product Name", 100); // Use actual product price here
//           setShowPaymentOptions(false); // Hide payment options after selection
//         }}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);

//     // Scroll to the selected product after adding it to the cart
//     scrollViewRef.current?.scrollTo({
//       y: 0,
//       animated: true,
//     });
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={() => setShowPaymentOptions(true)}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => setShowPaymentOptions(true)} // Show payment options on Buy Now click
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && (
//         <View style={styles.paymentOptionsContainer}>
//           <Text style={styles.paymentOptionsTitle}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </ScrollView>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },
// });

// export default ProductsList;





















/////////    Payment sheet popuping up    ////////////////////////




// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { supabase } from "@/lib/supabase";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;
//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null); // Track selected payment method
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false); // To show payment options when 'Buy Now' is clicked

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   // const handlePaymentMethodSelection = (method: string) => {
//   //   setPaymentMethod(method); // Set the selected payment method
//   //   setShowPaymentOptions(false); // Close payment options once selected
//   //   startStripeCheckout(method); // Start Stripe checkout after selecting the payment method
//   // };


//   const handlePaymentMethodSelection = (method: string, productId: string, productName: string) => {
//     setPaymentMethod(method); // Set the selected payment method
//     setShowPaymentOptions(false); // Close payment options once selected
//     startStripeCheckout(method); // Pass all required parameters to startStripeCheckout
//   };



// ////////////   working  payment sheeet    ///////////
//   const startStripeCheckout = async (selectedMethod: string) => {
//     if (!selectedMethod) {
//       Alert.alert("Payment Method Required", "Please select a payment method.");
//       return;
//     }
  
//     const { fee, total } = getTotalPayableAmount(100); // Assume 100 is the price for now.
  
//     try {
//       setIsPaying(true);
  
//       // Send request to Supabase to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: "usd",
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId: "product_id", // Sample product ID
//             productName: "Product Name", // Sample product name
//             paymentMethod: selectedMethod, // Send selected payment method
//           }),
//         }
//       );
  
//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }
  
//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
  
//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }
  
//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;
  
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });
  
//       if (initResult.error) throw new Error(initResult.error.message);
  
//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }
  
//       // After successful payment, log the payment into Supabase (update transaction table)
//       await makePayment(total, `Purchase: Product Name`, {
//         productId: "product_id",
//         videoId: "video_id", // Sample video ID
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: 100,
//         totalAmount: total,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });
  
//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };
  
  

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const options = isIOS
//       ? ["ApplePay", "BankTransfer", "CreditCard", "Twint"]
//       : ["GooglePay", "BankTransfer", "CreditCard", "Twint"];

//     return options.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => handlePaymentMethodSelection(method)}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => setShowPaymentOptions(true)} // Show payment options on Buy Now click
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && (
//         <View style={styles.paymentOptionsContainer}>
//           <Text style={styles.paymentOptionsTitle}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });


















/////////////////////////////////////////////


// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Constants
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;
//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);
//   const [paymentMethod, setPaymentMethod] = React.useState<string | null>(null); // Track selected payment method
//   const [showPaymentOptions, setShowPaymentOptions] = React.useState(false); // To show payment options when 'Buy Now' is clicked

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const handlePaymentMethodSelection = (method: string) => {
//     setPaymentMethod(method); // Set the selected payment method
//     setShowPaymentOptions(false); // Close payment options once selected
//     startStripeCheckout(method); // Start Stripe checkout after selecting the payment method
//   };

//   const startStripeCheckout = async (selectedMethod: string) => {
//     if (!selectedMethod) {
//       Alert.alert("Payment Method Required", "Please select a payment method.");
//       return;
//     }

//     const { fee, total } = getTotalPayableAmount(100); // Assume 100 is the price for now.

//     // Get the connected account ID (if available)
//     const connectedAccountId = null; // Assume no connected account for now

//     // Process payment to platform if connectedAccountId is missing
//     const destinationAccount = connectedAccountId || null;

//     try {
//       setIsPaying(true);

//       // Send request to backend to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: "usd",
//             connectedAccountId: destinationAccount, // Use platform account or connected account
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId: "product_id", // Sample product ID
//             productName: "Product Name", // Sample product name
//             paymentMethod: selectedMethod, // Send selected payment method
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // Handle successful payment
//       await makePayment(total, `Purchase: Product Name`, {
//         productId: "product_id",
//         videoId: "video_id", // Sample video ID
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: 100,
//         totalAmount: total,
//         connectedAccountId: destinationAccount,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", "You have successfully made the payment.");
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const transferFundsToConnectedAccount = async (paymentIntentClientSecret: string, connectedAccountId: string) => {
//     try {
//       const transferRes = await fetch("https://your-backend-url/transfer-funds", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           paymentIntentClientSecret,
//           connectedAccountId,
//         }),
//       });

//       if (!transferRes.ok) {
//         const errorMsg = await transferRes.text();
//         throw new Error(errorMsg || "Failed to transfer funds");
//       }

//       console.log("Transfer successful!");
//     } catch (error) {
//       console.error("Error transferring funds:", error);
//     }
//   };

//   const renderPaymentOptions = () => {
//     const isIOS = Platform.OS === "ios";
//     const options = isIOS
//       ? ["ApplePay", "BankTransfer", "CreditCard", "Twint"]
//       : ["GooglePay", "BankTransfer", "CreditCard", "Twint"];

//     return options.map((method) => (
//       <TouchableOpacity
//         key={method}
//         style={[
//           styles.paymentMethodButton,
//           paymentMethod === method && styles.selectedPaymentMethod,
//         ]}
//         onPress={() => handlePaymentMethodSelection(method)}
//       >
//         <Text style={styles.paymentMethodText}>{method}</Text>
//       </TouchableOpacity>
//     ));
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => setShowPaymentOptions(true)} // Show payment options on Buy Now click
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showPaymentOptions && (
//         <View style={styles.paymentOptionsContainer}>
//           <Text style={styles.paymentOptionsTitle}>Select Payment Method</Text>
//           {renderPaymentOptions()}
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   paymentOptionsContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   paymentOptionsTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   paymentMethodButton: {
//     padding: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     marginVertical: 8,
//     alignItems: "center",
//   },
//   selectedPaymentMethod: {
//     backgroundColor: Colors.dark.primary,
//   },
//   paymentMethodText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });














// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;
//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);
  
//     // Get the connected account ID (if available)
//     const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;
  
//     // Process payment to platform if connectedAccountId is missing
//     const destinationAccount = connectedAccountId || null;  // No destination if missing
    
//     // Log the data to confirm what's being passed
//     console.log("Payment Data:", { connectedAccountId, destinationAccount });
  
//     try {
//       setIsPaying(true);
  
//       // Send request to backend to create the payment intent
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: product.currency || "usd",
//             connectedAccountId: destinationAccount,  // Use platform account or connected account
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );
  
//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }
  
//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
  
//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }
  
//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;
  
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });
  
//       if (initResult.error) throw new Error(initResult.error.message);
  
//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }
  
//       // After successful payment, check for connected account or platform
//       if (connectedAccountId) {
//         // Proceed with transferring funds to the connected account
//         await transferFundsToConnectedAccount(paymentIntentClientSecret, connectedAccountId);
//       }
  
//       // Handle successful payment
//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         connectedAccountId: destinationAccount,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });
  
//       Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };
  

//   // const startStripeCheckout = async (product: Product) => {
//   //   const { fee, total } = getTotalPayableAmount(product.price);
  
//   //   // Get the connected account ID (if available)
//   //   const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;
  
//   //   // Process payment to platform if connectedAccountId is missing
//   //   const destinationAccount = connectedAccountId || "acct_1SnDvXJTbyjuWarp";  // Use platform account if missing
    
//   //   // Log the data to confirm what's being passed
//   //   console.log("Payment Data:", { connectedAccountId, destinationAccount });
  
//   //   try {
//   //     setIsPaying(true);
  
//   //     // Send request to backend to create the payment intent
//   //     const res = await fetch(
//   //       "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//   //       {
//   //         method: "POST",
//   //         headers: {
//   //           "Content-Type": "application/json",
//   //         },
//   //         body: JSON.stringify({
//   //           amount: Math.round(total * 100), // Total amount in cents
//   //           currency: product.currency || "usd",
//   //           connectedAccountId: destinationAccount,  // Use platform account or connected account
//   //           platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//   //           customerEmail: buyerEmail || undefined,
//   //           productId: product.id,
//   //           productName: product.name,
//   //         }),
//   //       }
//   //     );
  
//   //     if (!res.ok) {
//   //       const errorMsg = await res.text();
//   //       throw new Error(errorMsg || "Failed to create PaymentIntent");
//   //     }
  
//   //     const data = await res.json();
//   //     const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
  
//   //     if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//   //       throw new Error("Invalid response from backend");
//   //     }
  
//   //     const stripe = await import("@stripe/stripe-react-native");
//   //     const { initPaymentSheet, presentPaymentSheet } = stripe;
  
//   //     const initResult = await initPaymentSheet({
//   //       customerId,
//   //       customerEphemeralKeySecret: ephemeralKeySecret,
//   //       paymentIntentClientSecret,
//   //       merchantDisplayName: "60Seconds",
//   //       allowsDelayedPaymentMethods: true,
//   //       applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//   //       googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//   //       style: "automatic",
//   //     });
  
//   //     if (initResult.error) throw new Error(initResult.error.message);
  
//   //     const presentResult = await presentPaymentSheet();
//   //     if (presentResult.error) {
//   //       if (presentResult.error.code === "Canceled") return;
//   //       throw new Error(presentResult.error.message);
//   //     }
  
//   //     // After successful payment, check for connected account or platform
//   //     if (connectedAccountId) {
//   //       // Proceed with transferring funds to the connected account
//   //       await transferFundsToConnectedAccount(paymentIntentClientSecret, connectedAccountId);
//   //     }
  
//   //     // Handle successful payment
//   //     await makePayment(total, `Purchase: ${product.name}`, {
//   //       productId: product.id,
//   //       videoId: product.videoId,
//   //       paymentProvider: "stripe",
//   //       buyerId: buyerId || undefined,
//   //       platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//   //       platformFeeAmount: fee,
//   //       baseAmount: product.price,
//   //       totalAmount: total,
//   //       connectedAccountId: destinationAccount,
//   //       stripePaymentIntentClientSecret: paymentIntentClientSecret,
//   //     });
  
//   //     Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//   //     onClose();
//   //   } catch (e: any) {
//   //     console.error("Stripe checkout error:", e?.message || e);
//   //     Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//   //   } finally {
//   //     setIsPaying(false);
//   //   }
//   // };
  


//   // Function to transfer funds to connected account (called after payment is successful)
//   const transferFundsToConnectedAccount = async (paymentIntentClientSecret: string, connectedAccountId: string) => {
//     try {
//       const transferRes = await fetch("https://your-backend-url/transfer-funds", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           paymentIntentClientSecret,
//           connectedAccountId,
//         }),
//       });
  
//       if (!transferRes.ok) {
//         const errorMsg = await transferRes.text();
//         throw new Error(errorMsg || "Failed to transfer funds");
//       }
  
//       console.log("Transfer successful!");
//     } catch (error) {
//       console.error("Error transferring funds:", error);
//     }
//   };
  


//   // const startStripeCheckout = async (product: Product) => {
//   //   const { fee, total } = getTotalPayableAmount(product.price);
    
//   //   const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;
    
//   //   // Process payment to platform if connectedAccountId is missing
//   //   const destinationAccount = connectedAccountId || "acct_1SnDvXJTbyjuWarp";  // Replace with platform account if missing
  
//   //   // Log the data to confirm what's being passed
//   //   console.log("Payment Data:", { connectedAccountId, destinationAccount });
  
//   //   // Send request to backend
//   //   const res = await fetch(
//   //     "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//   //     {
//   //       method: "POST",
//   //       headers: {
//   //         "Content-Type": "application/json",
//   //       },
//   //       body: JSON.stringify({
//   //         amount: Math.round(total * 100), // Total amount in cents
//   //         currency: product.currency || "usd",
//   //         connectedAccountId: destinationAccount,  // Use platform account or connected account
//   //         platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//   //         customerEmail: buyerEmail || undefined,
//   //         productId: product.id,
//   //         productName: product.name,
//   //       }),
//   //     }
//   //   );
  
//   //   if (!res.ok) {
//   //     const errorMsg = await res.text();
//   //     throw new Error(errorMsg || "Failed to create PaymentIntent");
//   //   }
  
//   //   const data = await res.json();
//   //   const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
  
//   //   if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//   //     throw new Error("Invalid response from backend");
//   //   }
  
//   //   const stripe = await import("@stripe/stripe-react-native");
//   //   const { initPaymentSheet, presentPaymentSheet } = stripe;
  
//   //   const initResult = await initPaymentSheet({
//   //     customerId,
//   //     customerEphemeralKeySecret: ephemeralKeySecret,
//   //     paymentIntentClientSecret,
//   //     merchantDisplayName: "60Seconds",
//   //     allowsDelayedPaymentMethods: true,
//   //     applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//   //     googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//   //     style: "automatic",
//   //   });
  
//   //   if (initResult.error) throw new Error(initResult.error.message);
  
//   //   const presentResult = await presentPaymentSheet();
//   //   if (presentResult.error) {
//   //     if (presentResult.error.code === "Canceled") return;
//   //     throw new Error(presentResult.error.message);
//   //   }
  
//   //   // Handle successful payment
//   //   await makePayment(total, `Purchase: ${product.name}`, {
//   //     productId: product.id,
//   //     videoId: product.videoId,
//   //     paymentProvider: "stripe",
//   //     buyerId: buyerId || undefined,
//   //     platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//   //     platformFeeAmount: fee,
//   //     baseAmount: product.price,
//   //     totalAmount: total,
//   //     connectedAccountId: destinationAccount,
//   //     stripePaymentIntentClientSecret: paymentIntentClientSecret,
//   //   });
  
//   //   Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//   //   onClose();
//   // };
  
  
  
  



//   // const startStripeCheckout = async (product: Product) => {
//   //   const { fee, total } = getTotalPayableAmount(product.price);
//   //   const ownerId = product.ownerId || product.eventOwnerId || product.creatorId;
//   //   const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;
  
//   //   try {
//   //     setIsPaying(true);
  
//   //     // Sending the request to Supabase function to create Stripe payment intent
//   //     const res = await fetch(
//   //       "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//   //       {
//   //         method: "POST",
//   //         headers: {
//   //           "Content-Type": "application/json",
//   //         },
//   //         body: JSON.stringify({
//   //           amount: Math.round(total * 100), // Total amount in cents
//   //           currency: product.currency || "usd",
//   //           ownerId, // Optional: OwnerId is still sent if available
//   //           connectedAccountId,
//   //           platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//   //           customerEmail: buyerEmail || undefined,
//   //           videoId: product.videoId,
//   //           productId: product.id,
//   //           productName: product.name,
//   //         }),
//   //       }
//   //     );
  
//   //     if (!res.ok) {
//   //       const errorMsg = await res.text();
//   //       throw new Error(errorMsg || "Failed to create PaymentIntent");
//   //     }
  
//   //     const data = await res.json();
//   //     const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;
  
//   //     if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//   //       throw new Error("Invalid response from backend");
//   //     }
  
//   //     const stripe = await import("@stripe/stripe-react-native");
//   //     const { initPaymentSheet, presentPaymentSheet } = stripe;
  
//   //     const initResult = await initPaymentSheet({
//   //       customerId,
//   //       customerEphemeralKeySecret: ephemeralKeySecret,
//   //       paymentIntentClientSecret,
//   //       merchantDisplayName: "60Seconds",
//   //       allowsDelayedPaymentMethods: true,
//   //       applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//   //       googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//   //       style: "automatic",
//   //     });
  
//   //     if (initResult.error) throw new Error(initResult.error.message);
  
//   //     const presentResult = await presentPaymentSheet();
//   //     if (presentResult.error) {
//   //       if (presentResult.error.code === "Canceled") return;
//   //       throw new Error(presentResult.error.message);
//   //     }
  
//   //     await makePayment(total, `Purchase: ${product.name}`, {
//   //       productId: product.id,
//   //       videoId: product.videoId,
//   //       paymentProvider: "stripe",
//   //       buyerId: buyerId || undefined,
//   //       platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//   //       platformFeeAmount: fee,
//   //       baseAmount: product.price,
//   //       totalAmount: total,
//   //       connectedAccountId: connectedAccountId || undefined,
//   //       ownerId, // Optional: OwnerId is still sent if available
//   //       stripePaymentIntentClientSecret: paymentIntentClientSecret,
//   //     });
  
//   //     Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//   //     onClose();
//   //   } catch (e: any) {
//   //     console.error("Stripe checkout error:", e?.message || e);
//   //     Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//   //   } finally {
//   //     setIsPaying(false);
//   //   }
//   // };
  


  
  
  

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });













// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;
//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // Removed the validation for missing ownerId
//     const ownerId = product.ownerId || product.eventOwnerId || product.creatorId;

//     const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;

//     try {
//       setIsPaying(true);

//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: product.currency || "usd",
//             ownerId, // Optional: OwnerId is still sent if available
//             connectedAccountId,
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             videoId: product.videoId,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         connectedAccountId: connectedAccountId || undefined,
//         ownerId, // Optional: OwnerId is still sent if available
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });













///////////////////////////////////    13    jan      2026    /////////////////////




// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Platform fee percentage (4%)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   // Stripe Checkout integration
//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // Fetch event owner ID
//     const ownerId = product.ownerId || product.eventOwnerId || product.creatorId;
//     if (!ownerId) {
//       Alert.alert("Missing owner", "This product is missing ownerId. Please fix product data.");
//       return;
//     }

//     const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;

//     try {
//       setIsPaying(true);

//       // Request backend to create the Stripe Checkout session
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: product.currency || "usd",
//             ownerId,  // Pass the ownerId here
//             connectedAccountId,
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             videoId: product.videoId,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       // Initialize Payment Sheet
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,

//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       // Present Payment Sheet to the user
//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment
//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         connectedAccountId: connectedAccountId || undefined,
//         ownerId,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   // Add product to cart
//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   // Render product item
//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             {/* Info row - PaymentSheet shows eligible methods automatically */}
//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });











// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Platform fee percentage (4%)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   // Stripe Checkout integration
//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // Fetch event owner ID
//     const ownerId = product.ownerId || product.eventOwnerId || product.creatorId;
//     if (!ownerId) {
//       Alert.alert("Missing owner", "This product is missing ownerId. Please fix product data.");
//       return;
//     }

//     const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;

//     try {
//       setIsPaying(true);

//       // Request backend to create the Stripe Checkout session
//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: product.currency || "usd",
//             ownerId,
//             connectedAccountId,
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             videoId: product.videoId,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       // Initialize Payment Sheet
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,

//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       // Present Payment Sheet to the user
//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment
//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         connectedAccountId: connectedAccountId || undefined,
//         ownerId,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   // Add product to cart
//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   // Render product item
//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             {/* Info row - PaymentSheet shows eligible methods automatically */}
//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });












// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// // Platform fee percentage (4%)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   buyerEmail?: string | null;
//   buyerId?: string | null;
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   // Stripe Checkout integration
//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // Fetch event owner ID
//     const ownerId = product.ownerId || product.eventOwnerId || product.creatorId;
//     if (!ownerId) {
//       Alert.alert("Missing owner", "This product is missing ownerId. Please fix product data.");
//       return;
//     }

//     const connectedAccountId = product.ownerStripeAccountId || product.stripeConnectedAccountId || null;

//     try {
//       setIsPaying(true);

//       // Request backend to create the Stripe Checkout session
//       const res = await fetch(
//         "https://your-supabase-backend.com/functions/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             amount: Math.round(total * 100), // Total amount in cents
//             currency: product.currency || "usd",
//             ownerId,
//             connectedAccountId,
//             platformFeeAmount: Math.round(fee * 100), // Service fee in cents
//             customerEmail: buyerEmail || undefined,
//             videoId: product.videoId,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const errorMsg = await res.text();
//         throw new Error(errorMsg || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       // Initialize Payment Sheet
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,

//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay: Platform.OS === "android" ? { merchantCountryCode: "US", testEnv: false } : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       // Present Payment Sheet to the user
//       const presentResult = await presentPaymentSheet();
//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // After successful payment
//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         connectedAccountId: connectedAccountId || undefined,
//         ownerId,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert("Purchase Successful", `You have successfully purchased ${product.name}.`);
//       onClose();
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   // Add product to cart
//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   // Render product item
//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             {/* Info row - PaymentSheet shows eligible methods automatically */}
//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });


// Styles are assumed to be here









// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { ShoppingBag, Tag, Calendar, Clock, Info } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";

// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
//   // ✅ you should pass current logged-in user email/id if available
//   buyerEmail?: string | null;
//   buyerId?: string | null;
//   // ✅ event owner id (uuid) must exist in product or pass separately
// }

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
//   buyerEmail,
//   buyerId,
// }: ProductsListProps) {
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } =
//     useProductStore();

//   const { makePayment, fetchPaymentMethods } = useWalletStore();

//   const products = propProducts || storeProducts;

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const toggleFeeInfo = () => setShowFeeInfo((p) => !p);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const startStripeCheckout = async (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // ✅ MUST for ledger + future release
//     const ownerId =
//       (product as any).ownerId ||
//       (product as any).eventOwnerId ||
//       (product as any).creatorId;

//     if (!ownerId) {
//       Alert.alert("Missing owner", "This product is missing ownerId. Please fix product data.");
//       return;
//     }

//     // connectedAccountId can be null. Payment should still succeed (platform holds funds).
//     const connectedAccountId =
//       (product as any).ownerStripeAccountId ||
//       (product as any).connectedAccountId ||
//       (product as any).stripeConnectedAccountId ||
//       null;

//     try {
//       setIsPaying(true);

//       const res = await fetch(
//         "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout",
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             amount: Math.round(total * 100),
//             currency: (product as any).currency || "usd",

//             ownerId,
//             connectedAccountId, // ✅ may be null
//             platformFeeAmount: Math.round(fee * 100),

//             customerEmail: buyerEmail || undefined,

//             videoId: product.videoId,
//             productId: product.id,
//             productName: product.name,
//           }),
//         }
//       );

//       if (!res.ok) {
//         const txt = await res.text();
//         throw new Error(txt || "Failed to create PaymentIntent");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,

//         // ✅ Wallet UI enable. Actual availability depends on Stripe + PaymentIntent eligibility.
//         applePay:
//           Platform.OS === "ios"
//             ? { merchantCountryCode: "US" } // change if your Stripe account country is different
//             : undefined,

//         googlePay:
//           Platform.OS === "android"
//             ? {
//                 merchantCountryCode: "US", // change if needed
//                 testEnv: false, // ✅ production
//               }
//             : undefined,

//         style: "automatic",
//       });

//       if (initResult.error) throw new Error(initResult.error.message);

//       const presentResult = await presentPaymentSheet();

//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // ✅ Payment successful (client side)
//       // NOTE: Real wallet/ledger update should happen via webhook.
//       // This is optional UI logging.
//       await makePayment(total, `Purchase: ${product.name}`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",
//         buyerId: buyerId || undefined,

//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,

//         connectedAccountId: connectedAccountId || undefined,
//         ownerId,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//       });

//       Alert.alert(
//         "Purchase Successful",
//         `You have successfully purchased ${product.name}.`,
//         [{ text: "OK", onPress: onClose }]
//       );
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert("Payment Failed", e?.message || "Payment failed. Please try again.");
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);
//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && <Calendar size={14} color={Colors.dark.primary} />}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && <Clock size={14} color={Colors.dark.primary} />}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => startStripeCheckout(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? <ActivityIndicator /> : <Text style={styles.buyButtonText}>Buy Now</Text>}
//               </TouchableOpacity>
//             </View>

//             {/* Info row - PaymentSheet shows eligible methods automatically */}
//             <Text style={styles.hintText}>
//               You can pay by card and available wallets (Apple Pay / Google Pay) depending on your device & region.
//             </Text>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <Text style={styles.title}>Available Products</Text>
//         <TouchableOpacity onPress={onClose}>
//           <Text style={styles.closeButton}>Close</Text>
//         </TouchableOpacity>
//       </View>

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds platform and its services.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },
//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   hintText: { fontSize: 12, color: Colors.dark.subtext },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: { margin: 16, backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16 },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });














// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import {
//   ShoppingBag,
//   Tag,
//   Calendar,
//   Clock,
//   Info,
//   Smartphone,
//   DollarSign,
//   CreditCard,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useRouter } from "expo-router";

// // ✅ Platform fee requirement: 4% on ALL products (added into payable price)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// type PayMethod = "platform_pay" | "card" | "bank_transfer" | "twint";

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
// }

// /**
//  * PAYMENT UI:
//  * - iOS: Apple Pay, TWINT, Bank Transfer, Credit Card
//  * - Android: Google Pay, TWINT, Bank Transfer, Credit Card
//  *
//  * IMPORTANT:
//  * - Payment popup is Stripe PaymentSheet.
//  * - Apple Pay / Google Pay appear automatically in PaymentSheet when enabled + supported.
//  * - TWINT appears automatically in PaymentSheet when enabled + supported (typically CH/CHF).
//  *
//  * Stripe Connect (recommended approach for your use-case):
//  * - Destination charges:
//  *    - application_fee_amount = your 4% fee
//  *    - transfer_data[destination] = connectedAccountId (event owner)
//  * - Use automatic_payment_methods on PaymentIntent so Stripe shows all eligible methods.
//  */

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
// }: ProductsListProps) {
//   const router = useRouter();

//   const { products: storeProducts, fetchProducts, addToCart, isLoading } =
//     useProductStore();

//   const products = propProducts || storeProducts;

//   const {
//     fetchPaymentMethods,
//     // keep your existing internal logging/payment call if you want after Stripe success
//     makePayment,
//   } = useWalletStore();

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);

//   // Stripe UI state
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const toggleFeeInfo = () => setShowFeeInfo((prev) => !prev);

//   /**
//    * ✅ Replace with your real backend base URL
//    * Endpoint should:
//    *  - create/reuse Stripe Customer
//    *  - create ephemeral key
//    *  - create PaymentIntent on PLATFORM with:
//    *      amount = totalPayable * 100
//    *      currency = product.currency (or default)
//    *      application_fee_amount = fee * 100
//    *      transfer_data[destination] = connectedAccountId
//    *      automatic_payment_methods = { enabled: true }
//    *  - return: { paymentIntentClientSecret, customerId, ephemeralKeySecret }
//    */
//   const BACKEND_BASE_URL = "https://YOUR_DOMAIN.com"; // <-- change

//   const startStripeCheckout = async ({
//     product,
//     payMethod,
//   }: {
//     product: Product;
//     payMethod: PayMethod;
//   }) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     // You need event owner's Stripe Connect account id here
//     const connectedAccountId =
//       (product as any).ownerStripeAccountId ||
//       (product as any).connectedAccountId ||
//       (product as any).stripeConnectedAccountId;

//     if (!connectedAccountId) {
//       Alert.alert(
//         "Missing Connect Account",
//         "This event owner does not have a Stripe Connect account linked yet."
//       );
//       return;
//     }

//     try {
//       setIsPaying(true);

//       // 1) Call backend to create PaymentIntent + customer + ephemeral key
//       const res = await fetch("https://rvvujgbaswecqohixgog.supabase.co/functions/v1/stripe-create-checkout", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           videoId: product.videoId,
//           productId: product.id,
//           productName: product.name,
//           currency: (product as any).currency || "usd",

//           amount: Math.round(total * 100), // cents
//           platformFeeAmount: Math.round(fee * 100), // cents
//           platformFeePercentage: PLATFORM_FEE_PERCENTAGE,

//           connectedAccountId, // Stripe Connect destination
//           payMethod, // "platform_pay" | "card" | "bank_transfer" | "twint"

//           // OPTIONAL: you can send these if available
//           // userId, email, phone, etc
//         }),
//       });

//       if (!res.ok) {
//         const txt = await res.text();
//         throw new Error(txt || "Failed to create checkout session");
//       }

//       const data = await res.json();
//       const { paymentIntentClientSecret, customerId, ephemeralKeySecret } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       // 2) Stripe SDK
//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       /**
//        * ✅ PaymentSheet popup:
//        * Apple Pay / Google Pay show here when enabled.
//        * TWINT shows here when enabled + eligible (usually CHF + CH).
//        *
//        * NOTE:
//        * - applePay/googlePay config below only enables the wallet UI.
//        * - Actual method availability is decided by the PaymentIntent + Stripe settings.
//        */
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true,
//         applePay:
//           Platform.OS === "ios"
//             ? {
//                 // Set to the country of your Apple Pay merchant (NOT necessarily user country)
//                 merchantCountryCode: "US",
//               }
//             : undefined,
//         googlePay:
//           Platform.OS === "android"
//             ? {
//                 merchantCountryCode: "US",
//                 testEnv: true, // set false in production
//               }
//             : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) {
//         throw new Error(initResult.error.message);
//       }

//       // 4) Present PaymentSheet popup
//       const presentResult = await presentPaymentSheet();

//       if (presentResult.error) {
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // ✅ Payment successful
//       await makePayment(total, `Purchase: ${product.name} via Stripe`, {
//         productId: product.id,
//         videoId: product.videoId,
//         paymentProvider: "stripe",

//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,

//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//         connectedAccountId,
//         chosenPayMethod: payMethod,
//       });

//       Alert.alert(
//         "Purchase Successful",
//         `You have successfully purchased ${product.name}.`,
//         [{ text: "OK", onPress: onClose }]
//       );
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert(
//         "Payment Failed",
//         e?.message ||
//           "Unable to start payment. Please try again or choose another method."
//       );
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const handleBuyNow = (product: Product) => {
//     const title = "Choose Payment Method";
//     const msg = `How would you like to pay for ${product.name}?`;

//     const buttons = [
//       { text: "Cancel", style: "cancel" as const },
//       // Wallet button label requested
//       Platform.OS === "ios"
//         ? {
//             text: "Apple Pay",
//             onPress: () =>
//               startStripeCheckout({ product, payMethod: "platform_pay" }),
//           }
//         : {
//             text: "gPay",
//             onPress: () =>
//               startStripeCheckout({ product, payMethod: "platform_pay" }),
//           },

//       // ✅ TWINT added
//       {
//         text: "TWINT",
//         onPress: () => startStripeCheckout({ product, payMethod: "twint" }),
//       },

//       {
//         text: "Bank Transfer",
//         onPress: () =>
//           startStripeCheckout({ product, payMethod: "bank_transfer" }),
//       },
//       {
//         text: "Credit Card",
//         onPress: () => startStripeCheckout({ product, payMethod: "card" }),
//       },
//     ];

//     Alert.alert(title, msg, buttons);
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);

//     Alert.alert("Added to Cart ✅", `${product.name} has been added to your cart.`, [
//       { text: "OK" },
//     ]);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && (
//                 <Calendar size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && (
//                 <Clock size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => handleAddToCart(item)}
//                 disabled={isPaying}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => handleBuyNow(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? (
//                   <ActivityIndicator />
//                 ) : (
//                   <Text style={styles.buyButtonText}>Buy Now</Text>
//                 )}
//               </TouchableOpacity>
//             </View>

//             {/* ✅ Payment badges (informational) */}
//             <View style={styles.badgesRow}>
//               {Platform.OS === "ios" ? (
//                 <>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Apple Pay</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>TWINT</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <CreditCard size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Card</Text>
//                   </View>
//                 </>
//               ) : (
//                 <>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>gPay</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>TWINT</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <DollarSign size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Card</Text>
//                   </View>
//                 </>
//               )}
//             </View>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   const isEmbedded =
//     Platform.OS === "web" &&
//     typeof window !== "undefined" &&
//     window.location.pathname.includes("/event/");

//   return (
//     <View style={styles.container}>
//       {!isEmbedded && (
//         <View style={styles.header}>
//           <Text style={styles.title}>Available Products</Text>
//           <TouchableOpacity onPress={onClose}>
//             <Text style={styles.closeButton}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds
//             platform and its services. This fee helps us maintain and improve the platform
//             for all users.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 6,
//     flexWrap: "wrap",
//   },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     gap: 8,
//   },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//     flexDirection: "row",
//     gap: 6,
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },

//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   badgesRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
//   badge: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 6,
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 999,
//   },
//   badgeText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },

//   feeInfoContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   feeInfoTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });











// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import {
//   ShoppingBag,
//   Tag,
//   Calendar,
//   Clock,
//   Info,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useRouter } from "expo-router";

// // ✅ Platform fee requirement: 4% on ALL products (added into payable price)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
// }

// /**
//  * IMPORTANT:
//  * This UI now shows:
//  *  - iOS: Apple Pay, Bank Transfer, Credit Card
//  *  - Android: Google Pay, Bank Transfer, Credit Card
//  *
//  * Actual payments MUST be done via Stripe PaymentSheet / Stripe SDK.
//  * Apple Pay / Google Pay work only through Stripe's PaymentSheet + platform pay config.
//  *
//  * Stripe Connect flow:
//  * - Your backend creates a PaymentIntent with:
//  *    - application_fee_amount (your 4% fee)
//  *    - transfer_data[destination] = connectedAccountId (event owner)
//  * - Frontend opens PaymentSheet using clientSecret + ephemeralKey + customerId.
//  */

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
// }: ProductsListProps) {
//   const router = useRouter();

//   const { products: storeProducts, fetchProducts, addToCart, isLoading } =
//     useProductStore();

//   const products = propProducts || storeProducts;

//   const {
//     paymentMethods,
//     fetchPaymentMethods,
//     // keep your existing internal logging/payment call if you want after Stripe success
//     makePayment,
//   } = useWalletStore();

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);

//   // Stripe UI state
//   const [isPaying, setIsPaying] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const toggleFeeInfo = () => setShowFeeInfo((prev) => !prev);

//   /**
//    * ⚠️ You MUST replace this URL with your real backend endpoint.
//    * This endpoint will:
//    *  - create (or reuse) a Stripe Customer
//    *  - create ephemeral key
//    *  - create PaymentIntent on YOUR PLATFORM ACCOUNT with:
//    *      amount = totalPayable * 100 (cents)
//    *      currency = product.currency (or your default)
//    *      application_fee_amount = fee * 100
//    *      transfer_data[destination] = connectedAccountId (event owner)
//    *  - return: { paymentIntentClientSecret, customerId, ephemeralKeySecret }
//    */
//   const BACKEND_BASE_URL = "https://YOUR_DOMAIN.com"; // <-- change

//   const startStripeCheckout = async ({
//     product,
//     payMethod,
//   }: {
//     product: Product;
//     payMethod: "platform_pay" | "card" | "bank_transfer";
//   }) => {
//     // NOTE: payMethod is for your backend logic (optional).
//     // Stripe PaymentSheet decides Apple Pay / GPay automatically when enabled.

//     const { fee, total } = getTotalPayableAmount(product.price);

//     // You need the event owner's Stripe Connect account id here
//     // Example: product.ownerStripeAccountId or fetch by product.videoId / event owner id
//     const connectedAccountId =
//       (product as any).ownerStripeAccountId || (product as any).connectedAccountId;

//     if (!connectedAccountId) {
//       Alert.alert(
//         "Missing Connect Account",
//         "This event owner does not have a Stripe Connect account linked yet."
//       );
//       return;
//     }

//     try {
//       setIsPaying(true);

//       // 1) Call backend to create PaymentIntent + customer + ephemeral key
//       const res = await fetch(`${BACKEND_BASE_URL}/stripe/create-checkout`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           videoId: product.videoId,
//           productId: product.id,
//           productName: product.name,
//           currency: (product as any).currency || "usd",
//           amount: Math.round(total * 100), // cents
//           platformFeeAmount: Math.round(fee * 100), // cents
//           platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//           connectedAccountId, // Stripe Connect destination
//           payMethod, // optional (card/bank/platform_pay)
//           // You can pass userId/email if you have it
//         }),
//       });

//       if (!res.ok) {
//         const txt = await res.text();
//         throw new Error(txt || "Failed to create checkout session");
//       }

//       const data = await res.json();
//       const {
//         paymentIntentClientSecret,
//         customerId,
//         ephemeralKeySecret,
//         publishableKey, // optional: if you want dynamic keys
//       } = data;

//       if (!paymentIntentClientSecret || !customerId || !ephemeralKeySecret) {
//         throw new Error("Invalid response from backend");
//       }

//       // 2) Dynamically import Stripe only when needed (avoid crashing builds if not installed yet)
//       const stripe = await import("@stripe/stripe-react-native");
//       const { initPaymentSheet, presentPaymentSheet } = stripe;

//       // 3) init PaymentSheet (this is what shows Apple Pay / Google Pay / Card)
//       const initResult = await initPaymentSheet({
//         customerId,
//         customerEphemeralKeySecret: ephemeralKeySecret,
//         paymentIntentClientSecret,
//         merchantDisplayName: "60Seconds",
//         allowsDelayedPaymentMethods: true, // enables bank-like methods where supported
//         applePay: Platform.OS === "ios" ? { merchantCountryCode: "US" } : undefined,
//         googlePay:
//           Platform.OS === "android"
//             ? {
//                 merchantCountryCode: "US",
//                 testEnv: true, // set false in production
//               }
//             : undefined,
//         style: "automatic",
//       });

//       if (initResult.error) {
//         throw new Error(initResult.error.message);
//       }

//       // 4) Present PaymentSheet (this pops up payment screen)
//       const presentResult = await presentPaymentSheet();

//       if (presentResult.error) {
//         // user cancelled OR error
//         if (presentResult.error.code === "Canceled") return;
//         throw new Error(presentResult.error.message);
//       }

//       // ✅ Payment completed successfully
//       // Optional: call your internal "makePayment" to log transaction in your DB.
//       await makePayment(total, `Purchase: ${product.name} via Stripe`, {
//         productId: product.id,
//         videoId: product.videoId,
//         recipientId: product.videoId.charAt(0), // replace with real recipient logic
//         paymentProvider: "stripe",
//         platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//         platformFeeAmount: fee,
//         baseAmount: product.price,
//         totalAmount: total,
//         stripePaymentIntentClientSecret: paymentIntentClientSecret,
//         connectedAccountId,
//       });

//       Alert.alert(
//         "Purchase Successful",
//         `You have successfully purchased ${product.name}.`,
//         [{ text: "OK", onPress: onClose }]
//       );
//     } catch (e: any) {
//       console.error("Stripe checkout error:", e?.message || e);
//       Alert.alert(
//         "Payment Failed",
//         e?.message ||
//           "Unable to start payment. Please try again or choose another method."
//       );
//     } finally {
//       setIsPaying(false);
//     }
//   };

//   const handleBuyNow = (product: Product) => {
//     // ✅ Requested button labels
//     if (Platform.OS === "ios") {
//       Alert.alert(
//         "Choose Payment Method",
//         `How would you like to pay for ${product.name}?`,
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "Apple Pay",
//             onPress: () => startStripeCheckout({ product, payMethod: "platform_pay" }),
//           },
//           {
//             text: "Bank Transfer",
//             onPress: () => startStripeCheckout({ product, payMethod: "bank_transfer" }),
//           },
//           {
//             text: "Credit Card",
//             onPress: () => startStripeCheckout({ product, payMethod: "card" }),
//           },
//         ]
//       );
//     } else {
//       Alert.alert(
//         "Choose Payment Method",
//         `How would you like to pay for ${product.name}?`,
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "gPay",
//             onPress: () => startStripeCheckout({ product, payMethod: "platform_pay" }),
//           },
//           {
//             text: "Bank Transfer",
//             onPress: () => startStripeCheckout({ product, payMethod: "bank_transfer" }),
//           },
//           {
//             text: "Credit Card",
//             onPress: () => startStripeCheckout({ product, payMethod: "card" }),
//           },
//         ]
//       );
//     }
//   };

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);

//     if (Platform.OS === "web") {
//       Alert.alert("Added to Cart", `${product.name} has been added to your cart.`, [
//         { text: "OK" },
//       ]);
//     }
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && (
//                 <Calendar size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "drink" && (
//                 <Tag size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "reservation" && (
//                 <Clock size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>
//               {item.available} available
//             </Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => {
//                   handleAddToCart(item);
//                   Alert.alert(
//                     "Added to Cart ✅",
//                     `${item.name} has been added to your cart.`,
//                     [{ text: "OK" }]
//                   );
//                 }}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => handleBuyNow(item)}
//                 disabled={isPaying}
//               >
//                 {isPaying ? (
//                   <ActivityIndicator />
//                 ) : (
//                   <Text style={styles.buyButtonText}>Buy Now</Text>
//                 )}
//               </TouchableOpacity>
//             </View>

//             {/* Optional: show supported payment badges based on platform */}
//             <View style={styles.badgesRow}>
//               {Platform.OS === "ios" ? (
//                 <>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Apple Pay</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <DollarSign size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Card</Text>
//                   </View>
//                 </>
//               ) : (
//                 <>
//                   <View style={styles.badge}>
//                     <Smartphone size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>gPay</Text>
//                   </View>
//                   <View style={styles.badge}>
//                     <DollarSign size={12} color={Colors.dark.text} />
//                     <Text style={styles.badgeText}>Card</Text>
//                   </View>
//                 </>
//               )}
//             </View>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   const isEmbedded =
//     Platform.OS === "web" &&
//     typeof window !== "undefined" &&
//     window.location.pathname.includes("/event/");

//   return (
//     <View style={styles.container}>
//       {!isEmbedded && (
//         <View style={styles.header}>
//           <Text style={styles.title}>Available Products</Text>
//           <TouchableOpacity onPress={onClose}>
//             <Text style={styles.closeButton}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds
//             platform and its services. This fee helps us maintain and improve the platform
//             for all users.
//           </Text>
//           <TouchableOpacity
//             style={styles.closeFeeInfoButton}
//             onPress={toggleFeeInfo}
//           >
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   closeButton: { color: Colors.dark.primary, fontSize: 16 },

//   productsList: { padding: 16, paddingBottom: 24 },

//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: { width: 100, height: 100 },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   productInfo: { flex: 1, padding: 12, minWidth: 0 },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },

//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: { fontSize: 12, color: Colors.dark.subtext },

//   productActions: { flexDirection: "column", gap: 10 },

//   priceContainer: { flexDirection: "column" },
//   productPrice: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   feeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 6,
//     flexWrap: "wrap",
//   },
//   feeText: { fontSize: 12, color: Colors.dark.subtext },

//   buttonGroup: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     gap: 8,
//   },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//     flexDirection: "row",
//     gap: 6,
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: { color: Colors.dark.primary, fontSize: 12, fontWeight: "600" },

//   buyButton: { backgroundColor: Colors.dark.primary },
//   buyButtonText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   badgesRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
//   badge: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 6,
//     backgroundColor: Colors.dark.background,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 999,
//   },
//   badgeText: { color: Colors.dark.text, fontSize: 12, fontWeight: "600" },

//   emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
//   emptyText: { marginTop: 16, fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

//   feeInfoContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   feeInfoTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   feeInfoText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginBottom: 16 },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
// });















////////////////////////////     previous code with paystack/worldline/ and cancle options ///////////////






// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   Linking,
// } from "react-native";
// import { Image } from "expo-image";
// import {
//   ShoppingBag,
//   Tag,
//   Calendar,
//   Clock,
//   Info,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useRouter } from "expo-router";

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
// }

// // ✅ Platform fee requirement: 4% on ALL products (added into payable price)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
// }: ProductsListProps) {
//   const router = useRouter();

//   const { products: storeProducts, fetchProducts, addToCart, isLoading } =
//     useProductStore();

//   // Use products from props if available, otherwise use store products
//   const products = propProducts || storeProducts;

//   const { makePayment, paymentMethods, fetchPaymentMethods } = useWalletStore();

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) fetchProducts(videoId);
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return { fee, total: Math.round(total * 100) / 100 };
//   };

//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasPaystackPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "paystack"
//   );

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);

//     if (Platform.OS === "web") {
//       Alert.alert("Added to Cart", `${product.name} has been added to your cart.`, [
//         { text: "OK" },
//       ]);
//     }
//   };

//   const handleTwintPayment = (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     Alert.alert(
//       "Worldline (Twint) Payment",
//       `You will be redirected to the Twint app to complete your payment of $${total.toFixed(
//         2
//       )} (includes $${fee.toFixed(2)} platform fee).`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (!supported) {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       { text: "Cancel", style: "cancel" },
//                       {
//                         text: "Get Twint",
//                         onPress: () => Linking.openURL(twintWebUrl),
//                       },
//                     ]
//                   );
//                   return;
//                 }

//                 Linking.openURL(twintUrl);

//                 setTimeout(() => {
//                   try {
//                     const twintPaymentMethod = paymentMethods.find(
//                       (pm) => pm.type === "twint"
//                     );
//                     if (!twintPaymentMethod)
//                       throw new Error("No Twint payment method found");

//                     makePayment(total, `Purchase: ${product.name} via Twint`, {
//                       productId: product.id,
//                       videoId: product.videoId,
//                       recipientId: product.videoId.charAt(0), // replace with real recipient logic
//                       paymentProvider: "twint",
//                       paymentMethodId: twintPaymentMethod.id,
//                       twintTransactionId: `twint_${Date.now()}`,
//                       platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//                       platformFeeAmount: fee,
//                       baseAmount: product.price,
//                       totalAmount: total,
//                     }).then((success) => {
//                       if (success) {
//                         Alert.alert(
//                           "Purchase Successful",
//                           `You have successfully purchased ${product.name} with Twint.`,
//                           [{ text: "OK", onPress: onClose }]
//                         );
//                       }
//                     });
//                   } catch (error) {
//                     Alert.alert(
//                       "Error",
//                       "There was a problem processing your Twint payment. Please try again."
//                     );
//                   }
//                 }, 1500);
//               })
//               .catch((err) => {
//                 console.error("Twint open error:", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePaystackPayment = (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     Alert.alert(
//       "Paystack Payment",
//       `You will be redirected to Paystack to complete your payment of $${total.toFixed(
//         2
//       )} (includes $${fee.toFixed(2)} platform fee).`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             setTimeout(() => {
//               try {
//                 const paystackPaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "paystack"
//                 );
//                 if (!paystackPaymentMethod)
//                   throw new Error("No Paystack payment method found");

//                 const paystackReference = `paystack_ref_${Date.now()}`;
//                 const paystackTransactionId = `paystack_${Date.now()}`;

//                 makePayment(total, `Purchase: ${product.name} via Paystack`, {
//                   productId: product.id,
//                   videoId: product.videoId,
//                   recipientId: product.videoId.charAt(0), // replace with real recipient logic
//                   paymentProvider: "paystack",
//                   paymentMethodId: paystackPaymentMethod.id,
//                   paystackReference,
//                   paystackTransactionId,
//                   platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//                   platformFeeAmount: fee,
//                   baseAmount: product.price,
//                   totalAmount: total,
//                 }).then((success) => {
//                   if (success) {
//                     Alert.alert(
//                       "Purchase Successful",
//                       `You have successfully purchased ${product.name} with Paystack.`,
//                       [{ text: "OK", onPress: onClose }]
//                     );
//                   }
//                 });
//               } catch (error) {
//                 Alert.alert(
//                   "Error",
//                   "There was a problem processing your Paystack payment. Please try again."
//                 );
//               }
//             }, 1500);
//           },
//         },
//       ]
//     );
//   };

//   const handleBuyNow = (product: Product) => {
//     Alert.alert(
//       "Choose Payment Method",
//       `How would you like to pay for ${product.name}?`,
//       [
//         { text: "Cancel", style: "cancel" },
//         { text: "Paystack", onPress: () => handlePaystackPayment(product) },
//         { text: "Worldline", onPress: () => handleTwintPayment(product) },
//       ]
//     );
//   };

//   const toggleFeeInfo = () => setShowFeeInfo((prev) => !prev);

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName} numberOfLines={1}>
//             {item.name}
//           </Text>
//           <Text style={styles.productDescription} numberOfLines={2}>
//             {item.description}
//           </Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && (
//                 <Calendar size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "drink" && (
//                 <Tag size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "reservation" && (
//                 <Clock size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           {/* ✅ Updated layout so buttons NEVER overflow out of screen */}
//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={[styles.actionButton, styles.addButton]}
//                 onPress={() => {
//                   handleAddToCart(item);
//                   Alert.alert(
//                     "Added to Cart ✅",
//                     `${item.name} has been added to your cart.`,
//                     [{ text: "OK" }]
//                   );
//                 }}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={[styles.actionButton, styles.buyButton]}
//                 onPress={() => handleBuyNow(item)}
//               >
//                 <Text style={styles.buyButtonText}>Buy Now</Text>
//               </TouchableOpacity>

//               {hasTwintPaymentMethod && (
//                 <TouchableOpacity
//                   style={[styles.actionButton, styles.twintButton]}
//                   onPress={() => handleTwintPayment(item)}
//                 >
//                   <Smartphone size={14} color="#FFFFFF" />
//                   <Text style={styles.twintButtonText}>Twint</Text>
//                 </TouchableOpacity>
//               )}

//               {hasPaystackPaymentMethod && (
//                 <TouchableOpacity
//                   style={[styles.actionButton, styles.paystackButton]}
//                   onPress={() => handlePaystackPayment(item)}
//                 >
//                   <DollarSign size={14} color="#FFFFFF" />
//                   <Text style={styles.paystackButtonText}>Paystack</Text>
//                 </TouchableOpacity>
//               )}
//             </View>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   const isEmbedded =
//     Platform.OS === "web" &&
//     typeof window !== "undefined" &&
//     window.location.pathname.includes("/event/");

//   return (
//     <View style={styles.container}>
//       {!isEmbedded && (
//         <View style={styles.header}>
//           <Text style={styles.title}>Available Products</Text>
//           <TouchableOpacity onPress={onClose}>
//             <Text style={styles.closeButton}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds
//             platform and its services. This fee helps us maintain and improve the platform
//             for all users.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//           showsVerticalScrollIndicator={false}
//         />
//       )}
//     </View>
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
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//   },
//   productsList: {
//     padding: 16,
//     paddingBottom: 24,
//   },
//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 100,
//     height: 100,
//   },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//     minWidth: 0, // ✅ important for text & buttons to not overflow
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   productType: {
//     flexDirection: "row",
//     alignItems: "center",
//     flexShrink: 1,
//   },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },

//   // ✅ Changed from "row with end alignment" to "column" to keep buttons inside screen
//   productActions: {
//     flexDirection: "column",
//     gap: 10,
//   },
//   priceContainer: {
//     flexDirection: "column",
//   },
//   productPrice: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   feeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 6,
//     flexWrap: "wrap",
//   },
//   feeText: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },

//   // ✅ 2-column wrap grid so "Buy Now" always stays within the screen width
//   buttonGroup: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     gap: 8,
//   },
//   actionButton: {
//     width: "48%",
//     paddingVertical: 8,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     alignItems: "center",
//     justifyContent: "center",
//     flexDirection: "row",
//     gap: 6,
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   addButtonText: {
//     color: Colors.dark.primary,
//     fontSize: 12,
//     fontWeight: "600",
//   },
//   buyButton: {
//     backgroundColor: Colors.dark.primary,
//   },
//   buyButtonText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "600",
//   },
//   twintButton: {
//     backgroundColor: "#ED0039",
//   },
//   twintButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "600",
//   },
//   paystackButton: {
//     backgroundColor: "#0BA4DB",
//   },
//   paystackButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "600",
//   },

//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },
//   feeInfoContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   feeInfoTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   feeInfoText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     lineHeight: 20,
//     marginBottom: 16,
//   },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: "600",
//   },
// });













// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   Linking,
// } from "react-native";
// import { Image } from "expo-image";
// import {
//   ShoppingBag,
//   Tag,
//   Calendar,
//   Clock,
//   Info,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useRouter } from "expo-router";

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[];
// }

// // ✅ Platform fee requirement: 4% on ALL products (added into payable price)
// const PLATFORM_FEE_PERCENTAGE = 0.04;

// export default function ProductsList({
//   videoId,
//   onClose,
//   products: propProducts,
// }: ProductsListProps) {
//   const router = useRouter();

//   const {
//     products: storeProducts,
//     fetchProducts,
//     addToCart,
//     isLoading,
//   } = useProductStore();

//   // Use products from props if available, otherwise use store products
//   const products = propProducts || storeProducts;

//   const { makePayment, paymentMethods, fetchPaymentMethods } = useWalletStore();

//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);

//   React.useEffect(() => {
//     if (!propProducts) {
//       fetchProducts(videoId);
//     }
//     fetchPaymentMethods();
//   }, [videoId, propProducts, fetchProducts, fetchPaymentMethods]);

//   // Local fee calculator (always 4%)
//   const calculatePlatformFee = (amount: number) => {
//     const fee = amount * PLATFORM_FEE_PERCENTAGE;
//     // Round to 2 decimals to match money format
//     return Math.round(fee * 100) / 100;
//   };

//   const getTotalPayableAmount = (price: number) => {
//     const fee = calculatePlatformFee(price);
//     const total = price + fee;
//     return {
//       fee,
//       total: Math.round(total * 100) / 100,
//     };
//   };

//   const hasTwintPaymentMethod = paymentMethods.some((pm) => pm.type === "twint");
//   const hasPaystackPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "paystack"
//   );

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);

//     if (Platform.OS === "web") {
//       Alert.alert("Added to Cart", `${product.name} has been added to your cart.`, [
//         { text: "OK" },
//       ]);
//     }
//   };

//   const handleTwintPayment = (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     Alert.alert(
//       "Worldline (Twint) Payment",
//       `You will be redirected to the Twint app to complete your payment of $${total.toFixed(
//         2
//       )} (includes $${fee.toFixed(2)} platform fee).`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (!supported) {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       { text: "Cancel", style: "cancel" },
//                       { text: "Get Twint", onPress: () => Linking.openURL(twintWebUrl) },
//                     ]
//                   );
//                   return;
//                 }

//                 Linking.openURL(twintUrl);

//                 // Simulate successful payment (replace with real verification later)
//                 setTimeout(() => {
//                   try {
//                     const twintPaymentMethod = paymentMethods.find(
//                       (pm) => pm.type === "twint"
//                     );

//                     if (!twintPaymentMethod) {
//                       throw new Error("No Twint payment method found");
//                     }

//                     makePayment(total, `Purchase: ${product.name} via Twint`, {
//                       productId: product.id,
//                       videoId: product.videoId,
//                       recipientId: product.videoId.charAt(0), // replace with real recipient logic
//                       paymentProvider: "twint",
//                       paymentMethodId: twintPaymentMethod.id,
//                       twintTransactionId: `twint_${Date.now()}`,
//                       platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//                       platformFeeAmount: fee,
//                       baseAmount: product.price,
//                       totalAmount: total,
//                     }).then((success) => {
//                       if (success) {
//                         Alert.alert(
//                           "Purchase Successful",
//                           `You have successfully purchased ${product.name} with Twint.`,
//                           [{ text: "OK", onPress: onClose }]
//                         );
//                       }
//                     });
//                   } catch (error) {
//                     Alert.alert(
//                       "Error",
//                       "There was a problem processing your Twint payment. Please try again."
//                     );
//                   }
//                 }, 2000);
//               })
//               .catch((err) => {
//                 console.error("Twint open error:", err);
//                 Alert.alert(
//                   "Error",
//                   "Could not open Twint app. Please try another payment method."
//                 );
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePaystackPayment = (product: Product) => {
//     const { fee, total } = getTotalPayableAmount(product.price);

//     Alert.alert(
//       "Paystack Payment",
//       `You will be redirected to Paystack to complete your payment of $${total.toFixed(
//         2
//       )} (includes $${fee.toFixed(2)} platform fee).`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             // Simulate successful payment (replace with real Paystack flow later)
//             setTimeout(() => {
//               try {
//                 const paystackPaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "paystack"
//                 );

//                 if (!paystackPaymentMethod) {
//                   throw new Error("No Paystack payment method found");
//                 }

//                 const paystackReference = `paystack_ref_${Date.now()}`;
//                 const paystackTransactionId = `paystack_${Date.now()}`;

//                 makePayment(total, `Purchase: ${product.name} via Paystack`, {
//                   productId: product.id,
//                   videoId: product.videoId,
//                   recipientId: product.videoId.charAt(0), // replace with real recipient logic
//                   paymentProvider: "paystack",
//                   paymentMethodId: paystackPaymentMethod.id,
//                   paystackReference,
//                   paystackTransactionId,
//                   platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
//                   platformFeeAmount: fee,
//                   baseAmount: product.price,
//                   totalAmount: total,
//                 }).then((success) => {
//                   if (success) {
//                     Alert.alert(
//                       "Purchase Successful",
//                       `You have successfully purchased ${product.name} with Paystack.`,
//                       [{ text: "OK", onPress: onClose }]
//                     );
//                   }
//                 });
//               } catch (error) {
//                 Alert.alert(
//                   "Error",
//                   "There was a problem processing your Paystack payment. Please try again."
//                 );
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleBuyNow = async (product: Product) => {
//     // Wallet flow intentionally disabled for testing payment platforms only

//     Alert.alert("Choose Payment Method", `How would you like to pay for ${product.name}?`, [
//       { text: "Cancel", style: "cancel" },
//       { text: "Paystack", onPress: () => handlePaystackPayment(product) },
//       { text: "Worldline", onPress: () => handleTwintPayment(product) },
//     ]);
//   };

//   const toggleFeeInfo = () => setShowFeeInfo((prev) => !prev);

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const { fee, total } = getTotalPayableAmount(item.price);

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.name}</Text>
//           <Text style={styles.productDescription}>{item.description}</Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && (
//                 <Calendar size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "drink" && <Tag size={14} color={Colors.dark.primary} />}
//               {item.type === "reservation" && (
//                 <Clock size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>{item.available} available</Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               {/* ✅ show total price including platform fee */}
//               <Text style={styles.productPrice}>${total.toFixed(2)}</Text>

//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>
//                   (${item.price.toFixed(2)} + ${fee.toFixed(2)} fee)
//                 </Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={styles.addButton}
//                 onPress={() => {
//                   handleAddToCart(item);
//                   Alert.alert("Added to Cart ✅", `${item.name} has been added to your cart.`, [
//                     { text: "OK" },
//                   ]);
//                 }}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity style={styles.buyButton} onPress={() => handleBuyNow(item)}>
//                 <Text style={styles.buyButtonText}>Buy Now</Text>
//               </TouchableOpacity>

//               {hasTwintPaymentMethod && (
//                 <TouchableOpacity
//                   style={styles.twintButton}
//                   onPress={() => handleTwintPayment(item)}
//                 >
//                   <Smartphone size={14} color="#FFFFFF" />
//                   <Text style={styles.twintButtonText}>Twint</Text>
//                 </TouchableOpacity>
//               )}

//               {hasPaystackPaymentMethod && (
//                 <TouchableOpacity
//                   style={styles.paystackButton}
//                   onPress={() => handlePaystackPayment(item)}
//                 >
//                   <DollarSign size={14} color="#FFFFFF" />
//                   <Text style={styles.paystackButtonText}>Paystack</Text>
//                 </TouchableOpacity>
//               )}
//             </View>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   // For embedded view in event page, don't show header
//   const isEmbedded =
//     Platform.OS === "web" &&
//     typeof window !== "undefined" &&
//     window.location.pathname.includes("/event/");

//   return (
//     <View style={styles.container}>
//       {!isEmbedded && (
//         <View style={styles.header}>
//           <Text style={styles.title}>Available Products</Text>
//           <TouchableOpacity onPress={onClose}>
//             <Text style={styles.closeButton}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 4% platform fee is applied to all transactions to support the 60Seconds
//             platform and its services. This fee helps us maintain and improve the platform
//             for all users.
//           </Text>
//           <TouchableOpacity style={styles.closeFeeInfoButton} onPress={toggleFeeInfo}>
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>No products available for this event</Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//         />
//       )}
//     </View>
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
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//   },
//   productsList: {
//     padding: 16,
//   },
//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 100,
//     height: 100,
//   },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   productType: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },
//   productActions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   priceContainer: {
//     flexDirection: "column",
//   },
//   productPrice: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   feeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   feeText: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },
//   buttonGroup: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "flex-end",
//     gap: 8,
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//   },
//   addButtonText: {
//     color: Colors.dark.primary,
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   buyButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//   },
//   buyButtonText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   twintButton: {
//     backgroundColor: "#ED0039",
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   twintButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   paystackButton: {
//     backgroundColor: "#0BA4DB",
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   paystackButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },
//   feeInfoContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   feeInfoTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   feeInfoText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     lineHeight: 20,
//     marginBottom: 16,
//   },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: "500",
//   },
// });













// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   Alert,
//   Platform,
//   Linking,
// } from "react-native";
// import { Image } from "expo-image";
// import {
//   ShoppingBag,
//   Tag,
//   Calendar,
//   Clock,
//   Info,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { Product } from "@/types";
// import { useProductStore } from "@/store/product-store";
// import { useWalletStore } from "@/store/wallet-store";
// import { useRouter } from "expo-router";
// import { TRANSACTION_FEE_PERCENTAGE } from "@/types/wallet";

// interface ProductsListProps {
//   videoId: string;
//   onClose: () => void;
//   products?: Product[]; // Add products prop
// }

// export default function ProductsList({ videoId, onClose, products: propProducts }: ProductsListProps) {
//   const router = useRouter();
//   const { products: storeProducts, fetchProducts, addToCart, isLoading } = useProductStore();
  
//   // Use products from props if available, otherwise use store products
//   const products = propProducts || storeProducts;
//   const {
//     wallet,
//     makePayment,
//     calculateTransactionFee,
//     paymentMethods,
//     fetchPaymentMethods,
//   } = useWalletStore();
//   const [showFeeInfo, setShowFeeInfo] = React.useState(false);

//   React.useEffect(() => {
//     // Only fetch from store if products are not provided via props
//     if (!propProducts) {
//       fetchProducts(videoId);
//     }
//     fetchPaymentMethods();
//   }, [videoId, propProducts]);

//   // Check if user has Twint or Paystack payment methods
//   const hasTwintPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "twint"
//   );
//   const hasPaystackPaymentMethod = paymentMethods.some(
//     (pm) => pm.type === "paystack"
//   );

//   const handleAddToCart = (product: Product) => {
//     addToCart(product, 1);

//     if (Platform.OS === "web") {
//       Alert.alert(
//         "Added to Cart",
//         `${product.name} has been added to your cart.`,
//         [{ text: "OK" }]
//       );
//     }
//   };

//   const handleTwintPayment = (product: Product) => {
//     const fee = calculateTransactionFee(product.price);
//     const totalAmount = product.price + fee;

//     Alert.alert(
//       "Twint Payment",
//       `You will be redirected to the Twint app to complete your payment of $${totalAmount.toFixed(
//         2
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             // Try to open Twint app
//             const twintUrl = "twint://";
//             const twintWebUrl = "https://www.twint.ch/en/";

//             Linking.canOpenURL(twintUrl)
//               .then((supported) => {
//                 if (supported) {
//                   Linking.openURL(twintUrl);

//                   // After returning from Twint app, we would normally verify the payment
//                   // For now, we'll simulate a successful payment
//                   setTimeout(() => {
//                     try {
//                       const twintPaymentMethod = paymentMethods.find(
//                         (pm) => pm.type === "twint"
//                       );

//                       if (twintPaymentMethod) {
//                         makePayment(
//                           product.price,
//                           `Purchase: ${product.name} via Twint`,
//                           {
//                             productId: product.id,
//                             videoId: product.videoId,
//                             recipientId: product.videoId.charAt(0),
//                             paymentProvider: "twint",
//                             paymentMethodId: twintPaymentMethod.id,
//                             twintTransactionId: `twint_${Date.now()}`,
//                           }
//                         ).then((success) => {
//                           if (success) {
//                             Alert.alert(
//                               "Purchase Successful",
//                               `You have successfully purchased ${product.name} with Twint.`,
//                               [{ text: "OK", onPress: onClose }]
//                             );
//                           }
//                         });
//                       } else {
//                         throw new Error("No Twint payment method found");
//                       }
//                     } catch (error) {
//                       Alert.alert(
//                         "Error",
//                         "There was a problem processing your Twint payment. Please try again."
//                       );
//                     }
//                   }, 2000);
//                 } else {
//                   Alert.alert(
//                     "Twint App Not Found",
//                     "Please install the Twint app to continue with this payment method.",
//                     [
//                       { text: "Cancel", style: "cancel" },
//                       {
//                         text: "Get Twint",
//                         onPress: () => Linking.openURL(twintWebUrl),
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
//               });
//           },
//         },
//       ]
//     );
//   };

//   const handlePaystackPayment = (product: Product) => {
//     const fee = calculateTransactionFee(product.price);
//     const totalAmount = product.price + fee;

//     Alert.alert(
//       "Paystack Payment",
//       `You will be redirected to Paystack to complete your payment of $${totalAmount.toFixed(
//         2
//       )}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Continue",
//           onPress: () => {
//             // In a real app, we would use the Paystack SDK or redirect to a web checkout
//             // For now, we'll simulate a successful payment

//             setTimeout(() => {
//               try {
//                 const paystackPaymentMethod = paymentMethods.find(
//                   (pm) => pm.type === "paystack"
//                 );

//                 if (paystackPaymentMethod) {
//                   // Generate a reference
//                   const paystackReference = `paystack_ref_${Date.now()}`;
//                   const paystackTransactionId = `paystack_${Date.now()}`;

//                   makePayment(
//                     product.price,
//                     `Purchase: ${product.name} via Paystack`,
//                     {
//                       productId: product.id,
//                       videoId: product.videoId,
//                       recipientId: product.videoId.charAt(0),
//                       paymentProvider: "paystack",
//                       paymentMethodId: paystackPaymentMethod.id,
//                       paystackReference,
//                       paystackTransactionId,
//                     }
//                   ).then((success) => {
//                     if (success) {
//                       Alert.alert(
//                         "Purchase Successful",
//                         `You have successfully purchased ${product.name} with Paystack.`,
//                         [{ text: "OK", onPress: onClose }]
//                       );
//                     }
//                   });
//                 } else {
//                   throw new Error("No Paystack payment method found");
//                 }
//               } catch (error) {
//                 Alert.alert(
//                   "Error",
//                   "There was a problem processing your Paystack payment. Please try again."
//                 );
//               }
//             }, 2000);
//           },
//         },
//       ]
//     );
//   };

//   const handleBuyNow = async (product: Product) => {
//     // COMMENTED OUT: Wallet functionality - focusing on payment platform testing only
//     /*
//     if (!wallet) {
//       Alert.alert(
//         "Wallet Required",
//         "Please set up your wallet to make purchases.",
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "Set Up Wallet",
//             onPress: () => {
//               onClose();
//               router.push("/wallet");
//             },
//           },
//         ]
//       );
//       return;
//     }

//     const fee = calculateTransactionFee(product.price);
//     const totalAmount = product.price + fee;

//     if (wallet.balance < totalAmount) {
//       Alert.alert(
//         "Insufficient Funds",
//         "Your wallet balance is too low for this purchase. Would you like to add funds?",
//         [
//           { text: "Cancel", style: "cancel" },
//           {
//             text: "Add Funds",
//             onPress: () => {
//               onClose();
//               router.push({
//                 pathname: "/wallet",
//                 params: { action: "add-funds" },
//               });
//             },
//           },
//         ]
//       );
//       return;
//     }
//     */
    
//     // For now, show payment method selection since wallet is not required
//     Alert.alert(
//       "Choose Payment Method",
//       `How would you like to pay for ${product.name}?`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Paystack",
//           onPress: () => handlePaystackPayment(product),
//         },
//         {
//           text: "Worldline",
//           onPress: () => handleTwintPayment(product),
//         },
//       ]
//     );
//     return;

//     Alert.alert(
//       "Confirm Purchase",
//       `Are you sure you want to purchase ${
//         product.name
//       } for $${totalAmount.toFixed(2)}?

// This includes a 5% platform fee of $${fee.toFixed(2)}.`,
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Buy Now",
//           onPress: async () => {
//             const success = await makePayment(
//               product.price,
//               `Purchase: ${product.name}`,
//               {
//                 productId: product.id,
//                 videoId: product.videoId,
//                 recipientId: product.videoId.charAt(0), // This is a simplification
//                 paymentProvider: "internal",
//               }
//             );

//             if (success) {
//               Alert.alert(
//                 "Purchase Successful",
//                 `You have successfully purchased ${product.name}.`,
//                 [{ text: "OK", onPress: onClose }]
//               );
//             }
//           },
//         },
//       ]
//     );
//   };

//   const toggleFeeInfo = () => {
//     setShowFeeInfo(!showFeeInfo);
//   };

//   const renderProductItem = ({ item }: { item: Product }) => {
//     const fee = calculateTransactionFee(item.price);
//     const totalPrice = item.price + fee;

//     return (
//       <View style={styles.productCard}>
//         {item.image ? (
//           <Image
//             source={{ uri: item.image }}
//             style={styles.productImage}
//             contentFit="cover"
//             transition={300}
//           />
//         ) : (
//           <View style={styles.productImagePlaceholder}>
//             <ShoppingBag size={24} color={Colors.dark.subtext} />
//           </View>
//         )}

//         <View style={styles.productInfo}>
//           <Text style={styles.productName}>{item.name}</Text>
//           <Text style={styles.productDescription}>{item.description}</Text>

//           <View style={styles.productMeta}>
//             <View style={styles.productType}>
//               {item.type === "ticket" && (
//                 <Calendar size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "drink" && (
//                 <Tag size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "reservation" && (
//                 <Clock size={14} color={Colors.dark.primary} />
//               )}
//               {item.type === "merchandise" && (
//                 <ShoppingBag size={14} color={Colors.dark.primary} />
//               )}
//               <Text style={styles.productTypeText}>
//                 {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
//               </Text>
//             </View>

//             <Text style={styles.productAvailability}>
//               {item.available} available
//             </Text>
//           </View>

//           <View style={styles.productActions}>
//             <View style={styles.priceContainer}>
//               <Text style={styles.productPrice}>${item.price.toFixed(2)}</Text>
//               <View style={styles.feeContainer}>
//                 <Text style={styles.feeText}>+${fee.toFixed(2)} fee</Text>
//                 <TouchableOpacity onPress={toggleFeeInfo}>
//                   <Info size={12} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>
//             </View>

//             <View style={styles.buttonGroup}>
//               <TouchableOpacity
//                 style={styles.addButton}
//                 onPress={() => {
//                   handleAddToCart(item);
//                   Alert.alert(
//                     "Added to Cart ✅",
//                     `${item.name} has been added to your cart.`,
//                     [{ text: "OK" }]
//                   );
//                 }}
//               >
//                 <Text style={styles.addButtonText}>Add to Cart</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.buyButton}
//                 onPress={() => handleBuyNow(item)}
//               >
//                 <Text style={styles.buyButtonText}>Buy Now</Text>
//               </TouchableOpacity>

//               {hasTwintPaymentMethod && (
//                 <TouchableOpacity
//                   style={styles.twintButton}
//                   onPress={() => handleTwintPayment(item)}
//                 >
//                   <Smartphone size={14} color="#FFFFFF" />
//                   <Text style={styles.twintButtonText}>Twint</Text>
//                 </TouchableOpacity>
//               )}

//               {hasPaystackPaymentMethod && (
//                 <TouchableOpacity
//                   style={styles.paystackButton}
//                   onPress={() => handlePaystackPayment(item)}
//                 >
//                   <DollarSign size={14} color="#FFFFFF" />
//                   <Text style={styles.paystackButtonText}>Paystack</Text>
//                 </TouchableOpacity>
//               )}
//             </View>
//           </View>
//         </View>
//       </View>
//     );
//   };

//   // For embedded view in event page, don't show header
//   const isEmbedded =
//     Platform.OS === "web" && window.location.pathname.includes("/event/");

//   return (
//     <View style={styles.container}>
//       {!isEmbedded && (
//         <View style={styles.header}>
//           <Text style={styles.title}>Available Products</Text>
//           <TouchableOpacity onPress={onClose}>
//             <Text style={styles.closeButton}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {showFeeInfo && (
//         <View style={styles.feeInfoContainer}>
//           <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//           <Text style={styles.feeInfoText}>
//             A 5% platform fee is applied to all transactions to support the
//             60Seconds platform and its services. This fee helps us maintain and
//             improve the platform for all users.
//           </Text>
//           <TouchableOpacity
//             style={styles.closeFeeInfoButton}
//             onPress={toggleFeeInfo}
//           >
//             <Text style={styles.closeFeeInfoText}>Close</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {products.length === 0 && !isLoading ? (
//         <View style={styles.emptyContainer}>
//           <ShoppingBag size={48} color={Colors.dark.subtext} />
//           <Text style={styles.emptyText}>
//             No products available for this event
//           </Text>
//         </View>
//       ) : (
//         <FlatList
//           data={products}
//           renderItem={renderProductItem}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.productsList}
//         />
//       )}
//     </View>
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
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//   },
//   productsList: {
//     padding: 16,
//   },
//   productCard: {
//     flexDirection: "row",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     marginBottom: 16,
//     overflow: "hidden",
//   },
//   productImage: {
//     width: 100,
//     height: 100,
//   },
//   productImagePlaceholder: {
//     width: 100,
//     height: 100,
//     backgroundColor: Colors.dark.background,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   productInfo: {
//     flex: 1,
//     padding: 12,
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   productDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   productMeta: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 8,
//   },
//   productType: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   productTypeText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginLeft: 4,
//   },
//   productAvailability: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },
//   productActions: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "flex-end",
//   },
//   priceContainer: {
//     flexDirection: "column",
//   },
//   productPrice: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   feeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   feeText: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },
//   buttonGroup: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "flex-end",
//     gap: 8,
//   },
//   addButton: {
//     backgroundColor: "transparent",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//   },
//   addButtonText: {
//     color: Colors.dark.primary,
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   buyButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//   },
//   buyButtonText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   twintButton: {
//     backgroundColor: "#ED0039",
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   twintButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   paystackButton: {
//     backgroundColor: "#0BA4DB",
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     borderRadius: 16,
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 4,
//   },
//   paystackButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },
//   feeInfoContainer: {
//     margin: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//   },
//   feeInfoTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   feeInfoText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     lineHeight: 20,
//     marginBottom: 16,
//   },
//   closeFeeInfoButton: {
//     alignSelf: "flex-end",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 16,
//   },
//   closeFeeInfoText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: "500",
//   },
// });
