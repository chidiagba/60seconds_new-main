#!/bin/bash

# 🚀 Quick Datatrans Payment Function Deployment Script
# This script helps you deploy the Datatrans payment edge function to Supabase

set -e  # Exit on error

echo "💳 Datatrans Payment Function Deployment"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}❌ Supabase CLI is not installed${NC}"
    echo ""
    echo "Install it with:"
    echo "  npm install -g supabase"
    echo ""
    echo "Or:"
    echo "  brew install supabase/tap/supabase"
    exit 1
fi

echo -e "${GREEN}✅ Supabase CLI found${NC}"
echo ""

# Check if logged in
echo "🔐 Checking Supabase login status..."
if ! supabase projects list &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Supabase${NC}"
    echo ""
    echo "Please login first:"
    echo "  supabase login"
    exit 1
fi

echo -e "${GREEN}✅ Logged in to Supabase${NC}"
echo ""

# Check if project is linked
echo "🔗 Checking project link..."
if [ ! -f ".supabase/config.toml" ]; then
    echo -e "${YELLOW}⚠️  Project not linked${NC}"
    echo ""
    echo "Linking to project..."
    supabase link --project-ref rvvujgbaswecqohixgog
else
    echo -e "${GREEN}✅ Project is linked${NC}"
fi

echo ""

# Deploy the function
echo "🚀 Deploying datatrans-payment function..."
echo ""

if supabase functions deploy datatrans-payment; then
    echo ""
    echo -e "${GREEN}✅ Function deployed successfully!${NC}"
    echo ""
    echo "📋 Next Steps:"
    echo ""
    echo "1. Set Datatrans credentials as secrets:"
    echo "   supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id"
    echo "   supabase secrets set DATATRANS_PASSWORD=your_password"
    echo "   supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com"
    echo ""
    echo "2. Verify secrets are set:"
    echo "   supabase secrets list"
    echo ""
    echo "3. Test the function (see DATATRANS_COMPLETE_SETUP_GUIDE.md)"
    echo ""
    echo "📚 For complete setup instructions, see: DATATRANS_COMPLETE_SETUP_GUIDE.md"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Deployment failed${NC}"
    echo ""
    echo "Common issues:"
    echo "  - Not logged in: run 'supabase login'"
    echo "  - Project not linked: run 'supabase link --project-ref rvvujgbaswecqohixgog'"
    echo "  - Network issues: check your internet connection"
    echo ""
    exit 1
fi

