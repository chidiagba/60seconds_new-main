import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Platform,ScrollView,Text,TextInput,TouchableOpacity,View} from 'react-native';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {supabase} from '@/lib/supabase';

type GuestOrder={orderNumber:string;state:string;paymentStatus:string;totalAmount:number;currency:string;emailSent:boolean;canDownload:boolean};
export default function GuestOrderLookup(){
 const [code,setCode]=useState(''),[email,setEmail]=useState(''),[order,setOrder]=useState<GuestOrder|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void Linking.getInitialURL().then(value=>{if(!value)return;try{const parsed=new URL(value);const token=new URLSearchParams(parsed.hash.slice(1)).get('code');if(token)setCode(token);}catch{}});},[]);
 async function lookup(download=false){
  setBusy(true);setError('');if(!download)setOrder(null);
  try{
   const {data,error:invokeError}=await supabase.functions.invoke('guest-order-lookup',{body:{trackingCode:code.trim(),email:email.trim(),action:download?'ticket-pdf':'status'}});
   if(invokeError){let message='Unable to look up this order. Check your code and checkout email.';try{const body=await invokeError.context?.json();if(body?.error)message=body.error;}catch{}throw new Error(message);}
   if(data?.error)throw new Error(data.error);
   if(download){
    if(typeof data.pdf!=='string' || !data.filename)throw new Error('Ticket PDF unavailable.');
    if(Platform.OS==='web'){
     const bytes=Uint8Array.from(atob(data.pdf),(char:string)=>char.charCodeAt(0));
     const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }else{
     if(!await Sharing.isAvailableAsync())throw new Error('Sharing is unavailable on this device. Open guest lookup in your browser to download.');
     const path=FileSystem.cacheDirectory+data.filename;await FileSystem.writeAsStringAsync(path,data.pdf,{encoding:FileSystem.EncodingType.Base64});await Sharing.shareAsync(path,{mimeType:'application/pdf',UTI:'com.adobe.pdf'});
    }
   }else setOrder(data);
  }catch(e){setError(e instanceof Error?e.message:'Unable to look up order.');}finally{setBusy(false);}
 }
 const field={color:'#fff',backgroundColor:'#161b2a',padding:16,borderRadius:10,marginTop:8,marginBottom:20};
 const button={backgroundColor:'#635bdb',padding:16,borderRadius:10,marginVertical:10};
 return <ScrollView style={{flex:1,backgroundColor:'#090e1b'}} contentContainerStyle={{padding:24,paddingTop:60,maxWidth:600,width:'100%',alignSelf:'center'}} keyboardShouldPersistTaps="handled">
  <Text style={{color:'#fff',fontSize:28,fontWeight:'700'}}>Find your guest order</Text>
  <Text style={{color:'#ccd3e5',marginVertical:20}}>No account needed. Enter the tracking code from your checkout confirmation or ticket email and the same email address used to pay. You can check the saved payment status and download confirmed tickets again.</Text>
  <Text style={{color:'#fff'}}>Tracking code</Text><TextInput accessibilityLabel="Tracking code" style={field} value={code} onChangeText={value=>{setCode(value);setOrder(null);}} autoCapitalize="none" autoCorrect={false} maxLength={36} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" placeholderTextColor="#8b95ad" />
  <Text style={{color:'#fff'}}>Checkout email</Text><TextInput accessibilityLabel="Checkout email" style={field} value={email} onChangeText={value=>{setEmail(value);setOrder(null);}} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} placeholder="you@example.com" placeholderTextColor="#8b95ad" />
  <TouchableOpacity disabled={busy || !code.trim() || !email.trim()} style={button} onPress={()=>void lookup()}><Text style={{color:'#fff',textAlign:'center'}}>Find order</Text></TouchableOpacity>
  {busy && <ActivityIndicator color="#aaa3ff"/>}{!!error && <Text accessibilityRole="alert" style={{color:'#ffaaaa',marginVertical:12}}>{error}</Text>}
  {order && <View style={{padding:20,borderWidth:1,borderColor:'#46506a',borderRadius:12,marginVertical:20}}>
   <Text style={{color:'#fff',fontWeight:'700'}}>Order {order.orderNumber}</Text><Text style={{color:'#ccd3e5',marginVertical:10}}>Payment: {order.paymentStatus} · Order: {order.state}{'\n'}Total: {Number(order.totalAmount).toFixed(2)} {order.currency}</Text>
   <Text style={{color:'#ccd3e5'}}>{order.canDownload?'Payment confirmed. Your ticket PDF is ready.': 'Tickets become available after the server confirms payment. If you already paid, do not pay again; return here after confirmation or contact support with your tracking code.'}</Text>
   {order.canDownload && <TouchableOpacity disabled={busy} style={button} onPress={()=>void lookup(true)}><Text style={{color:'#fff',textAlign:'center'}}>Download ticket PDF</Text></TouchableOpacity>}
  </View>}
  <Text style={{color:'#8b95ad',marginTop:20}}>Keep your tracking code private. It is for finding your order; the QR code inside your ticket is for admission. This page does not charge, refund or send an email.</Text>
 </ScrollView>;
}
