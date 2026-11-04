import React from 'react';
import { ActivityIndicator, AppState, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Package, QrCode, Search } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/colors';
import { orderService } from '@/lib/database';
import { useAuthStore } from '@/store/auth-store';
import { supabase } from '@/lib/supabase';

type Filter = 'all' | 'open' | 'completed' | 'cancelled';
type OrderRow = Record<string, any>;
const money = (amount: unknown, currency = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount || 0)); } catch { return `${currency} ${Number(amount || 0).toFixed(2)}`; } };
const statusColor = (status: string) => status === 'completed' ? '#22C55E' : ['cancelled','failed'].includes(status) ? '#EF4444' : '#F59E0B';
const getItems = (order: OrderRow) => order.receipts?.length ? order.receipts : Array.isArray(order.items) ? order.items : [];
const itemType = (item: any) => {
  const raw = String(item.receipt_kind || item.ticket_type || item.type || 'product').toLowerCase();
  if (raw.includes('reservation') || raw.includes('table')) return 'Table reservation';
  if (raw.includes('ticket')) return 'Ticket';
  return 'Product';
};

export default function OrdersScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isBusiness = Boolean(user?.isBusinessAccount);
  const [orders, setOrders] = React.useState<OrderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const load = React.useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError('');
    try { setOrders(((isBusiness ? await orderService.getBusinessOrders(user.id) : await orderService.getUserOrders(user.id)) || []) as OrderRow[]); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load orders.'); }
    finally { setLoading(false); }
  }, [isBusiness, user?.id]);
  React.useEffect(() => { void load(); }, [load]);
  useFocusEffect(React.useCallback(() => { void load(); }, [load]));
  React.useEffect(() => {
    if (!user?.id) return;
    const filter = isBusiness ? `business_id=eq.${user.id}` : `user_id=eq.${user.id}`;
    const channel = supabase.channel(`order-management-${user.id}-${isBusiness ? 'business' : 'buyer'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_receipts' }, () => void load())
      .subscribe();
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => { appState.remove(); void supabase.removeChannel(channel); };
  }, [isBusiness, load, user?.id]);
  const visible = orders.filter((order) => {
    const normalizedStatus = String(order.status).toLowerCase();
    if (filter === 'open' && !['pending','open','partially_completed','confirmed','processing'].includes(normalizedStatus)) return false;
    if (!['all','open'].includes(filter) && normalizedStatus !== filter) return false;
    const haystack = [order.order_number, order.id, order.buyer?.full_name, order.buyer?.username, ...getItems(order).flatMap((item: any) => [item.name, item.productName, item.ticket_title, item.event_name])].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const summary = { total: orders.length, open: orders.filter((o) => ['pending','open','partially_completed','confirmed','processing'].includes(String(o.status))).length, completed: orders.filter((o) => o.status === 'completed').length, sales: orders.filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total_amount || 0), 0) };
  const goBack = () => router.canGoBack() ? router.back() : router.replace(isBusiness ? '/(tabsbusiness)/profile' : '/(tabs)/profile');
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={goBack} style={styles.iconButton}><ArrowLeft color={Colors.dark.text} size={23} /></TouchableOpacity><View style={styles.headerCopy}><Text style={styles.title}>{isBusiness ? 'Orders' : 'My Purchases'}</Text><Text style={styles.subtitle}>{isBusiness ? 'Manage customer orders' : 'Receipts, tickets and order history'}</Text></View>{isBusiness ? <TouchableOpacity onPress={() => router.push({ pathname: '/scan-qr', params: { mode: 'redeem' } })} style={styles.iconButton}><QrCode color={Colors.dark.primaryLight} size={23} /></TouchableOpacity> : <View style={styles.iconButton} />}</View>
    {isBusiness && !loading && !error && <View style={styles.summary}><View><Text style={styles.summaryValue}>{summary.total}</Text><Text style={styles.summaryLabel}>Total</Text></View><View><Text style={[styles.summaryValue,{color:'#F59E0B'}]}>{summary.open}</Text><Text style={styles.summaryLabel}>Open</Text></View><View><Text style={[styles.summaryValue,{color:'#22C55E'}]}>{summary.completed}</Text><Text style={styles.summaryLabel}>Done</Text></View><View><Text style={styles.summaryValue}>{money(summary.sales,orders[0]?.currency||'USD')}</Text><Text style={styles.summaryLabel}>Sales</Text></View></View>}
    <View style={styles.searchBox}><Search color={Colors.dark.caption} size={18}/><TextInput value={query} onChangeText={setQuery} placeholder="Order, customer, product or event" placeholderTextColor={Colors.dark.caption} style={styles.searchInput} autoCorrect={false}/></View>
    <View style={styles.filters}>{(['all','open','completed','cancelled'] as Filter[]).map((value)=><TouchableOpacity key={value} onPress={()=>setFilter(value)} style={[styles.filter,filter===value&&styles.filterActive]}><Text style={[styles.filterText,filter===value&&styles.filterTextActive]}>{value==='all'?'All':value[0].toUpperCase()+value.slice(1)}</Text></TouchableOpacity>)}</View>
    {loading ? <View style={styles.center}><ActivityIndicator color={Colors.dark.primary} size="large"/><Text style={styles.muted}>Loading orders…</Text></View> : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={load} style={styles.primaryButton}><Text style={styles.primaryText}>Try again</Text></TouchableOpacity></View> : <FlatList data={visible} keyExtractor={(item)=>item.id} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.dark.primary}/>} contentContainerStyle={visible.length?styles.list:styles.emptyList} ListEmptyComponent={<View style={styles.center}><Package color={Colors.dark.inactive} size={58}/><Text style={styles.emptyTitle}>No {filter==='all'?'':filter} orders</Text><Text style={styles.muted}>{isBusiness?'Paid customer orders will appear here.':'Your successful purchases will appear here.'}</Text></View>} renderItem={({item})=>{
      const items=getItems(item), first=items[0]||{}, count=items.reduce((n:number,v:any)=>n+Math.max(1,Number(v.quantity||1)),0), name=first.ticket_title||first.name||first.productName||'Purchase';
      const displayStatus = item.payment_status === 'failed' ? 'failed' : String(item.status || 'pending').toLowerCase();
      return <TouchableOpacity style={styles.card} onPress={()=>router.push({pathname:'/order/[id]',params:{id:item.id,role:isBusiness?'business':'buyer'}})}><View style={styles.cardTop}><View style={styles.flex}><Text style={styles.orderNo}>{item.order_number||`#${String(item.id).slice(-8).toUpperCase()}`}</Text><Text style={styles.date}>{new Date(item.created_at||item.order_date).toLocaleString()}</Text></View><View style={[styles.badge,{backgroundColor:`${statusColor(displayStatus)}22`}]}><Text style={[styles.badgeText,{color:statusColor(displayStatus)}]}>{displayStatus==='failed'?'INCOMPLETE':displayStatus.replace(/_/g, ' ').toUpperCase()}</Text></View></View>{isBusiness&&<Text style={styles.customer}>Customer: {item.buyer?.full_name||item.buyer?.username||'Private customer'}</Text>}<Text style={styles.kind}>{itemType(first)}</Text><Text style={styles.itemName}>{name}{count>1?` · ${count} items`:''}</Text>{!!first.event_name&&<Text style={styles.muted}>{first.event_name}</Text>}<View style={styles.cardBottom}><Text style={styles.amount}>{money(item.total_amount||items.reduce((n:number,r:any)=>n+Number(r.total_price||0),0),item.currency||first.currency)}</Text><Text style={styles.view}>View details ›</Text></View></TouchableOpacity>;
    }}/>} {/* Orders list */}
  </SafeAreaView>;
}
const styles=StyleSheet.create({container:{flex:1,backgroundColor:Colors.dark.background},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:1,borderBottomColor:Colors.dark.divider},iconButton:{width:42,height:42,alignItems:'center',justifyContent:'center'},headerCopy:{flex:1,alignItems:'center'},title:{fontSize:20,fontWeight:'800',color:Colors.dark.text},subtitle:{fontSize:12,color:Colors.dark.subtext,marginTop:2},summary:{margin:16,marginBottom:8,padding:16,borderRadius:16,backgroundColor:Colors.dark.card,flexDirection:'row',justifyContent:'space-between'},summaryValue:{color:Colors.dark.text,fontWeight:'800',fontSize:16,maxWidth:120},summaryLabel:{color:Colors.dark.caption,fontSize:11,marginTop:4},searchBox:{marginHorizontal:16,marginTop:10,height:46,paddingHorizontal:14,borderRadius:13,backgroundColor:Colors.dark.card,flexDirection:'row',alignItems:'center',gap:9},searchInput:{flex:1,color:Colors.dark.text,fontSize:14},filters:{flexDirection:'row',paddingHorizontal:16,paddingVertical:12,gap:8},filter:{paddingVertical:8,paddingHorizontal:13,borderRadius:18,backgroundColor:Colors.dark.card},filterActive:{backgroundColor:Colors.dark.primary},filterText:{fontSize:12,fontWeight:'700',color:Colors.dark.subtext},filterTextActive:{color:'#fff'},list:{padding:16,paddingTop:2,paddingBottom:32},emptyList:{flexGrow:1},card:{backgroundColor:Colors.dark.card,borderRadius:16,padding:16,marginBottom:12,borderWidth:1,borderColor:Colors.dark.divider},cardTop:{flexDirection:'row',alignItems:'flex-start'},flex:{flex:1},orderNo:{color:Colors.dark.text,fontSize:16,fontWeight:'800'},date:{color:Colors.dark.caption,fontSize:11,marginTop:4},badge:{paddingHorizontal:9,paddingVertical:5,borderRadius:12},badgeText:{fontSize:10,fontWeight:'800'},customer:{color:Colors.dark.primaryLight,fontSize:13,fontWeight:'600',marginTop:13},kind:{color:Colors.dark.primaryLight,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.5,marginTop:12},itemName:{color:Colors.dark.text,fontSize:15,fontWeight:'700',marginTop:4},cardBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:15},amount:{color:Colors.dark.text,fontSize:17,fontWeight:'800'},view:{color:Colors.dark.primaryLight,fontSize:12,fontWeight:'700'},center:{flex:1,alignItems:'center',justifyContent:'center',padding:32},muted:{color:Colors.dark.subtext,fontSize:13,marginTop:7},emptyTitle:{color:Colors.dark.text,fontSize:19,fontWeight:'800',marginTop:15},error:{color:Colors.dark.error,textAlign:'center',marginBottom:16},primaryButton:{backgroundColor:Colors.dark.primary,paddingHorizontal:20,paddingVertical:11,borderRadius:12},primaryText:{color:'#fff',fontWeight:'800'}});
