import { checkoutPaymentOptions, checkoutPaymentRoute, CheckoutPaymentMethodId } from '@/utils/checkout-payment-methods';
import CheckoutPaymentMethod from '@/components/CheckoutPaymentMethod';
import { checkoutErrorMessage, checkoutErrorCode } from '@/utils/checkout-errors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadCheckoutAttempt} from '@/lib/checkout-attempt';
import {checkoutVoucherRequest,checkoutItemsKey} from '@/utils/checkout-selection';
import { markedPrice } from '@/utils/commerce-rules';
import { logger } from '@/lib/logger';
import { ensureStripeInitialized } from "@/lib/stripe-initialization";
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Trash2,
  Tag,
  ShoppingBag,
  Plus,
  Minus,
} from "lucide-react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { DEFAULT_CURRENCY } from "@/constants/currencies";
import { useProductStore } from "@/store/product-store";
import { useWalletStore } from "@/store/wallet-store";
import { useVoucherStore } from "@/store/voucher-store";
import ApplyVoucherModal from "@/components/ApplyVoucherModal";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from '@/lib/supabase';
import { settleStripePayment } from '@/lib/stripe-settlement';
import PaystackWebView from '@/components/PaystackWebView';
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
  logger.warn('Stripe native module unavailable in Cart screen:', error);
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

export default function CartScreen() {
  const router = useRouter();
  const stripe = stripeUseHook ? stripeUseHook() : null;
  const presentPaymentSheet =
    stripe?.presentPaymentSheet ||
    (async () => ({ error: { message: 'Stripe is unavailable in this build.' } }));
  const initPaymentSheet = async (options: any) => {
    if (!stripe?.initPaymentSheet) return { error: { message: 'Stripe is unavailable in this build.' } };
    await ensureStripeInitialized();
    return stripe.initPaymentSheet(options);
  };

  const insets = useSafeAreaInsets();
  const { cart, removeFromCart, updateCartItemQuantity, clearCart } =
    useProductStore();


  const { wallet, fetchWallet, fetchTransactions } = useWalletStore();

  const { activeVoucher, clearActiveVoucher } =
    useVoucherStore();

  const { user: currentUser } = useAuthStore();
  const { profile, user: authUser } = useAuth();

  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const checkoutQuote = useVoucherStore(state=>state.checkoutQuote);
  const checkoutRequestKey = useRef<string | null>(null);
  const checkoutStorageKey = useRef<string | null>(null);
  const checkoutInFlight=useRef(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Paystack state
  const [showPaystackModal, setShowPaystackModal] = useState(false);
  const [paystackOrderId, setPaystackOrderId] = useState<string | null>(null);

  // ✅ 4% markup applied to every product price (instead of separate Platform Fee)
  const PRICE_MARKUP_RATE = 0.04;

  const getMarkedUnitPrice = (basePrice: number) => {
    // keep cents
    return markedPrice(basePrice, cartCurrency);
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
  const cartSubtotal = cart.reduce((sum, item) => {
    const markedUnit = getMarkedUnitPrice(item.product.price);
    return sum + markedUnit * item.quantity;
  }, 0);

  useEffect(() => {
    const saved=useVoucherStore.getState().checkoutQuote;
    const same=saved && checkoutItemsKey(cart.map(item=>({productId:item.product.id,quantity:item.quantity})))===checkoutItemsKey((saved.items||[]).map((item:any)=>({productId:item.product_id,quantity:Number(item.quantity)})));
    if(!same)useVoucherStore.getState().setCheckoutQuote(null);
    setDiscountAmount(same?Number(saved.discount_amount):0);
    checkoutRequestKey.current=null;
  }, [cartSubtotal, cart.map(item => `${item.product.id}:${item.quantity}`).join('|')]);

  const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount);
  const appliedQuote = checkoutQuote && (!checkoutQuote.voucher_id || checkoutQuote.voucher_id === activeVoucher?.id) ? checkoutQuote : null;
  const finalTotal = appliedQuote ? Number(appliedQuote.total_amount) : discountedSubtotal;

  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethodId | null>(null);
  const paymentOptions = checkoutPaymentOptions(cartCurrency);
  const selectedMethod = paymentOptions.find(option => option.id === paymentMethod) || paymentOptions[0];
  const paymentRoute = checkoutPaymentRoute(selectedMethod.id, cartCurrency);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

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

  const getBusinessNetAmount = (grossAmount: number) => {
    return Number((grossAmount / (1 + PRICE_MARKUP_RATE)).toFixed(2));
  };

  const refreshWalletAfterPurchase = async () => {
    await fetchWallet();
    await fetchTransactions({ silent: true });
  };

  const handleRemoveItem = (productId: string) => {
    removeFromCart(productId);
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) return;
    updateCartItemQuantity(productId, quantity);
  };

  const handleApplyVoucher = (amount: number, voucher?: any, quote?: any) => {
    if(!voucher||!quote)throw new Error('Validate this voucher before applying it');
    useVoucherStore.getState().applyValidatedVoucher(voucher,quote,cart.map(item=>({productId:item.product.id,quantity:item.quantity})));
    setDiscountAmount(amount);
    checkoutRequestKey.current=null;
  };

  const handleClearVoucher = () => {
    setDiscountAmount(0);
    clearActiveVoucher();
  };

  const finishCheckout = async (orderId:string) => {
    await refreshWalletAfterPurchase();
    await useVoucherStore.getState().checkoutCompleted(cartOwnerId || undefined);
    if(checkoutStorageKey.current)await AsyncStorage.removeItem(checkoutStorageKey.current);
    checkoutStorageKey.current=null;
    clearCart(); clearActiveVoucher(); setDiscountAmount(0); checkoutRequestKey.current=null;
    Alert.alert('Purchase completed','Your tickets and purchase receipts are ready.');
    router.push({pathname:'/order/[id]',params:{id:orderId}});
  };

  const handleCheckout = async () => {
    if(checkoutInFlight.current || processingPayment || !cart.length || !ensureSingleOwnerCart('This'))return;
    checkoutInFlight.current=true;setProcessingPayment(true);
    try {
      const items=cart.map(item=>({productId:item.product.id,quantity:item.quantity}));
      let selectedVoucher=activeVoucher;
      const attempt=await loadCheckoutAttempt(AsyncStorage,String(authUser?.id||currentUser?.id||''),items,()=>`${Date.now()}-${Math.random().toString(36).slice(2)}`);
      checkoutRequestKey.current=attempt.requestKey;checkoutStorageKey.current=attempt.storageKey;
      let quote:any=null;
      const {data:hold,error:holdError}=await supabase.rpc('get_checkout_attempt',{p_request_key:attempt.requestKey});
      if(holdError)throw holdError;
      if(hold?.state==='fulfilled'){await finishCheckout(hold.order_id);return;}
      if(hold?.state==='released'){
        await AsyncStorage.removeItem(attempt.storageKey);checkoutRequestKey.current=null;
        throw new Error('The previous payment was cancelled. Tap Checkout to start a new attempt.');
      }
      if(hold?.state==='reserved'){
        const {data:heldOrder,error:heldOrderError}=await supabase.from('orders').select('payment_provider').eq('id',hold.order_id).single();
        if(heldOrderError)throw heldOrderError;
        if(heldOrder.payment_provider!==paymentRoute.provider)throw new Error('A payment is already pending with another provider. Check its payment status in Orders before changing methods.');
        quote=hold.quote;
        if(selectedVoucher&&selectedVoucher.id!==quote.voucher_id)throw new Error('An existing checkout uses different voucher terms. Check its payment status in Orders before changing it.');
        useVoucherStore.getState().resumeCheckoutQuote(quote,items);
        selectedVoucher=useVoucherStore.getState().activeVoucher;
      }
      const voucherCode=selectedVoucher?.code || null;
      if(!quote){
        const result=await supabase.rpc('quote_order_checkout',{requested_items:items,voucher_code:voucherCode});
        if(result.error)throw result.error;
        quote=result.data;
      }
      if(Math.abs(Number(quote.total_amount)-finalTotal)>0.001 || quote.currency!==cartCurrency){
        useVoucherStore.getState().setCheckoutQuote(quote);setDiscountAmount(Number(quote.discount_amount));
        Alert.alert('Checkout updated','The server verified the current prices and voucher. Review the updated total and tap Checkout again.');return;
      }
      const appliedVoucher=checkoutVoucherRequest(selectedVoucher,quote);
      const requestKey=checkoutRequestKey.current || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      checkoutRequestKey.current=requestKey;
      if(Number(quote.total_amount)===0){
        const {data:order,error}=await supabase.rpc('create_order_checkout',{requested_items:items,voucher_code:voucherCode,request_key:requestKey,provider:paymentRoute.provider});
        if(error)throw error;
        if(order.payment_status!=='paid')throw new Error('The order was not fulfilled');
        await finishCheckout(order.id);return;
      }
      if(paymentRoute.provider==='paystack'){setShowPaystackModal(true);return;}
      const session=await createStripePaymentSheetSession({items,voucherCode:appliedVoucher.voucherCode||undefined,voucherId:appliedVoucher.voucherId||undefined,requestKey,paymentMethod:'card',amount:0,platformFeeAmount:0,currency:quote.currency.toLowerCase()});
      if(session.completed && session.order){await finishCheckout(session.order.id);return;}
      if(!session.orderId || !session.paymentIntentClientSecret)throw new Error('Payment initialization failed');
      const initialized=await initPaymentSheet({paymentIntentClientSecret:session.paymentIntentClientSecret,merchantDisplayName:'60Seconds',customerId:session.customerId,customerEphemeralKeySecret:session.ephemeralKeySecret,allowsDelayedPaymentMethods:true});
      if(initialized.error)throw initialized.error;
      const payment=await presentPaymentSheet();
      if(payment.error){
        const {data:reconciled}=await supabase.functions.invoke('checkout-reconcile',{body:{orderId:session.orderId,action:'cancel'}});
        if(reconciled?.success){await finishCheckout(session.orderId);return;}
        if(reconciled?.cancelled){checkoutRequestKey.current=null;if(checkoutStorageKey.current)await AsyncStorage.removeItem(checkoutStorageKey.current);}
        throw payment.error;
      }
      const settlement=await settleStripePayment({orderId:session.orderId,paymentIntentClientSecret:session.paymentIntentClientSecret});
      if(!settlement.success)throw new Error(settlement.error||'Payment is awaiting verified fulfillment');
      await finishCheckout(session.orderId);
    }catch(error:unknown){
      logger.warn('Checkout failed', { code: checkoutErrorCode(error) });
      Alert.alert('Checkout unavailable',checkoutErrorMessage(error));
    }
    finally{checkoutInFlight.current=false;setProcessingPayment(false);}
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
          <FlatList
            data={cart}
            renderItem={renderCartItem}
            keyExtractor={(item) => item.product.id}
            contentContainerStyle={styles.cartList}
            ListFooterComponent={
          <View style={[styles.summaryContainer, { paddingBottom: insets.bottom + 24 }]}>
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

            {hasMixedOwnerCart && (
              <View style={styles.mixedOwnerWarningBox}>
                <Text style={styles.mixedOwnerWarningText}>
                  Cart contains items from multiple organizers. Checkout each organizer separately to keep settlement and payout accurate.
                </Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Original price</Text>
              <Text style={styles.summaryValue}>
                {formatCartAmount(appliedQuote ? Number(appliedQuote.original_subtotal) : baseSubtotal)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service markup (4%)</Text>
              <Text style={styles.summaryValue}>
                {formatCartAmount(appliedQuote ? Number(appliedQuote.markup_amount) : cartSubtotal - baseSubtotal)}
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

            <CheckoutPaymentMethod options={paymentOptions} selected={selectedMethod.id} onSelect={setPaymentMethod} disabled={processingPayment || showPaystackModal} total={finalTotal} />

            <TouchableOpacity
              style={[
                styles.checkoutButton,
                (processingPayment || hasMixedOwnerCart) && styles.disabledButton,
              ]}
              onPress={handleCheckout}
              disabled={processingPayment || hasMixedOwnerCart}
            >
              {processingPayment ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Text style={styles.checkoutButtonText}>Checkout</Text>
              )}
            </TouchableOpacity>
          </View>
            }
          />
      )}

      <ApplyVoucherModal
        visible={showVoucherModal}
        onClose={() => setShowVoucherModal(false)}
        onApply={handleApplyVoucher}
        items={cart.map(item=>({productId:item.product.id,quantity:item.quantity}))}
        totalAmount={cartSubtotal} // ✅ voucher applies on marked subtotal
        businessId={cartOwnerId || undefined}
        productId={cart.length === 1 ? cart[0].product.id : undefined}
      />

      <PaystackWebView
        initialChannel={paymentRoute.channel || 'all'}
        visible={showPaystackModal}
        onClose={() => {
          setShowPaystackModal(false);
          setPaystackOrderId(null);
        }}
        onSuccess={async (_reference: string, verifiedOrderId?: string) => {
          setShowPaystackModal(false);setProcessingPayment(true);
          try {
            const id=verifiedOrderId||paystackOrderId;
            if(!id)throw new Error('Missing checkout order');
            const {data,error}=await supabase.functions.invoke('checkout-reconcile',{body:{orderId:id}});
            if(error||!data?.success)throw new Error(data?.error||'Payment verification is still pending');
            await finishCheckout(id);
          }catch(error:unknown){
            logger.warn('Checkout reconciliation failed', { code: checkoutErrorCode(error) });
            Alert.alert('Payment verification pending','Open your order to check its payment status before trying again.');
          }
          finally{setProcessingPayment(false);}
        }}
        onCancel={() => {
          setShowPaystackModal(false);
          setPaystackOrderId(null);
        }}
        amount={finalTotal}
        currency={cartCurrency}
        email={authUser?.email || currentUser?.email || ''}
        description={`Cart purchase (${cart.length} item${cart.length !== 1 ? 's' : ''})`}
        metadata={{
          ownerId: cartOwnerId,
          recipientId: cartOwnerId,
          userId: currentUser?.id,
          orderId: paystackOrderId,
          paymentType: 'order_payment',
          grossAmount: finalTotal,
          netAmount: getBusinessNetAmount(finalTotal),
          platformFeeAmount: Number((finalTotal - getBusinessNetAmount(finalTotal)).toFixed(2)),
          currency: cartCurrency,
          cartItems: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
          voucherId: activeVoucher?.id,
          voucherCode: activeVoucher?.code,
          checkoutRequestKey: checkoutRequestKey.current,
          videoId: cart[0]?.product?.videoId,
        }}
        paystackSubaccount={
          String(
            (cart[0]?.product as any)?.paystackSubaccountCode ||
            (cart[0]?.product as any)?.paystack_subaccount_code ||
            (cart[0]?.product as any)?.subaccount ||
            ''
          ).trim() ||
          getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).subaccount
        }
        paystackSplitCode={
          String(
            (cart[0]?.product as any)?.paystackSplitCode ||
            (cart[0]?.product as any)?.paystack_split_code ||
            (cart[0]?.product as any)?.split_code ||
            ''
          ).trim() ||
          getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).splitCode
        }
        paystackTransactionCharge={
          Number.isFinite(
            Number(
              (cart[0]?.product as any)?.paystackTransactionCharge ||
              (cart[0]?.product as any)?.paystack_transaction_charge ||
              (cart[0]?.product as any)?.transaction_charge
            )
          )
            ? Number(
                (cart[0]?.product as any)?.paystackTransactionCharge ||
                (cart[0]?.product as any)?.paystack_transaction_charge ||
                (cart[0]?.product as any)?.transaction_charge
              )
            : (
                getPaystackRoutingForOwner(resolveProductOwnerId(cart[0]?.product)).transactionCharge ??
                Number((finalTotal - getBusinessNetAmount(finalTotal)).toFixed(2))
              )
        }
        paystackBearer={
          String(
            (cart[0]?.product as any)?.paystackBearer ||
            (cart[0]?.product as any)?.paystack_bearer ||
            (cart[0]?.product as any)?.bearer ||
            ''
          ).trim().toLowerCase() === 'subaccount'
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
  checkoutButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "bold",
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
