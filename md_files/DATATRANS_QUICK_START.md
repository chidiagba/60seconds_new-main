# ⚡ Datatrans Payment - Quick Start

## 🎯 **Choose Your Deployment Method**

### **Option 1: Deploy via Dashboard (No CLI)** ⭐ **EASIEST**

**Perfect if you don't want to use command line!**

📖 **Full Guide**: See `DATATRANS_DEPLOY_VIA_DASHBOARD.md`

**Quick Steps:**
1. Go to Supabase Dashboard → Edge Functions
2. Create new function: `datatrans-payment`
3. Copy code from `supabase/functions/datatrans-payment/index.ts`
4. Paste and deploy
5. Set secrets in Dashboard (Settings → Edge Functions → Secrets)

---

### **Option 2: Deploy via CLI**

**Faster if you're comfortable with command line.**

📖 **Full Guide**: See `DATATRANS_COMPLETE_SETUP_GUIDE.md`

**Quick Commands:**
```bash
# Install CLI
npm install -g supabase

# Login and link
supabase login
supabase link --project-ref rvvujgbaswecqohixgog

# Deploy function
supabase functions deploy datatrans-payment

# Set secrets
supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id
supabase secrets set DATATRANS_PASSWORD=your_password
supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com
```

---

## 🔑 **Get Datatrans Credentials**

1. **Go to Datatrans Dashboard**:
   - Sandbox: https://admin.sandbox.datatrans.com/Login.jsp
   - Production: https://admin.datatrans.com/Login.jsp

2. **Get your credentials**:
   - Merchant ID (e.g., `1110020919`)
   - API Password (different from login password!)

3. **Set them as secrets in Supabase** (via Dashboard or CLI)

---

## ✅ **Required Secrets**

Set these 3 secrets in Supabase:

- `DATATRANS_MERCHANT_ID` = Your Datatrans Merchant ID
- `DATATRANS_PASSWORD` = Your Datatrans API Password
- `DATATRANS_BASE_URL` = `https://api.sandbox.datatrans.com` (or production URL)

---

## 🧪 **Test Payment**

**Test Card (Sandbox):**
- Card: `4242424242424242`
- Expiry: `12/2025`
- CVV: `123`
- Name: `Test User`

---

## 📚 **Full Documentation**

- **Dashboard Deployment**: `DATATRANS_DEPLOY_VIA_DASHBOARD.md`
- **Complete Setup Guide**: `DATATRANS_COMPLETE_SETUP_GUIDE.md`
- **Function Code**: `supabase/functions/datatrans-payment/index.ts`

---

## 🆘 **Need Help?**

1. Check function logs in Supabase Dashboard
2. Verify all 3 secrets are set correctly
3. Make sure function name is exactly `datatrans-payment`
4. Check Datatrans credentials are correct

---

**Ready to start?** Choose your method above and follow the guide! 🚀

