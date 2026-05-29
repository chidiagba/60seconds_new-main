#!/bin/bash

# Complete Worldline Development Setup Script
# This starts everything needed for Worldline payment testing

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Worldline Payment Development Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get local IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
if [ "$LOCAL_IP" = "localhost" ]; then
  echo "❌ Cannot detect local IP. Using localhost (won't work on Android/Emulator)"
else
  echo "✅ Detected local IP: $LOCAL_IP"
fi

echo ""
echo "📋 Setup Checklist:"
echo ""
echo "1️⃣  Setting Worldline environment variables..."
export WORLDLINE_MERCHANT_ID=C025C5B07C8EDDC996CA
export WORLDLINE_API_KEY=F178B575BEDBDE21428F3E5EDBD8098346372F72772B9732A762EF58F88B0D90B2F86B45C5839E4BD5F97FF5528D32642059DA33CD606838441B3C2F7CB231D6
export WORLDLINE_BASE_URL=https://api-sandbox.worldline-solutions.com

echo "   ✅ Merchant ID: ${WORLDLINE_MERCHANT_ID:0:10}..."
echo "   ✅ API Key: ${WORLDLINE_API_KEY:0:10}..."
echo "   ✅ Base URL: $WORLDLINE_BASE_URL"
echo ""

echo "2️⃣  Starting backend server..."
echo "   📡 Server will run on: http://localhost:3001"
if [ "$LOCAL_IP" != "localhost" ]; then
  echo "   📡 Network URL: http://$LOCAL_IP:3001"
fi
echo ""

# Start server in background
cd "$(dirname "$0")"
yarn start-server &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Check if server is running
if curl -s http://localhost:3001/ > /dev/null 2>&1; then
  echo "   ✅ Server is running! (PID: $SERVER_PID)"
else
  echo "   ❌ Server failed to start. Check for errors above."
  exit 1
fi

echo ""
echo "3️⃣  Next Steps:"
echo ""
echo "   📱 In a NEW terminal, run:"
if [ "$LOCAL_IP" != "localhost" ]; then
  echo "      export EXPO_PUBLIC_RORK_API_BASE_URL=http://$LOCAL_IP:3001"
else
  echo "      export EXPO_PUBLIC_RORK_API_BASE_URL=http://localhost:3001"
fi
echo "      yarn start --clear"
echo ""
echo "   🧪 Then test payment in your app:"
echo "      - Select Worldline payment"
echo "      - Tap 'Visa' button (uses test card: 4111111111111111)"
echo "      - Tap 'Pay with Worldline'"
echo ""
echo "   📊 Check Worldline SANDBOX dashboard:"
echo "      https://merchant-portal.preprod.worldline-solutions.com"
echo "      → Transactions → Search by reference"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Server is running! Watch this terminal for payment logs."
echo "   Press Ctrl+C to stop the server."
echo ""

# Keep script running
wait $SERVER_PID



