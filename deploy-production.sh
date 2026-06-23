#!/bin/bash

# Production Build & Deploy Script for iOS & Android
# Usage: ./deploy-production.sh [ios|android|both]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/Users/mac/60seconds_new-main"
APP_VERSION="88.0.0"
ANDROID_VERSION_CODE="88"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$PROJECT_DIR/build_${TIMESTAMP}.log"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1" | tee -a "$LOG_FILE"
}

print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    log_info "Checking Node.js..."
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        exit 1
    fi
    log_success "Node.js $(node --version)"
    
    log_info "Checking npm..."
    if ! command -v npm &> /dev/null; then
        log_error "npm not found"
        exit 1
    fi
    log_success "npm $(npm --version)"
    
    log_info "Checking EAS CLI..."
    if ! command -v eas &> /dev/null; then
        log_warning "EAS CLI not found, installing..."
        npm install -g eas-cli
    fi
    log_success "EAS CLI ready"
    
    log_info "Checking git..."
    if ! command -v git &> /dev/null; then
        log_error "git not found"
        exit 1
    fi
    log_success "git $(git --version | awk '{print $3}')"
}

# Verify versions in app.json
verify_versions() {
    print_header "Verifying Version Numbers"
    
    log_info "Reading app.json..."
    EXPO_VERSION=$(jq -r '.expo.version' "$PROJECT_DIR/app.json")
    IOS_VERSION=$(jq -r '.expo.ios.buildNumber' "$PROJECT_DIR/app.json")
    ANDROID_VERSION=$(jq -r '.expo.android.versionCode' "$PROJECT_DIR/app.json")
    ANDROID_NAME=$(jq -r '.expo.android.versionName' "$PROJECT_DIR/app.json")
    
    log_info "Current versions in app.json:"
    log_info "  - Expo Version: $EXPO_VERSION"
    log_info "  - iOS Build Number: $IOS_VERSION"
    log_info "  - Android Version Code: $ANDROID_VERSION"
    log_info "  - Android Version Name: $ANDROID_NAME"
    
    if [[ "$EXPO_VERSION" != "$APP_VERSION" ]]; then
        log_error "Version mismatch! Expected $APP_VERSION, got $EXPO_VERSION"
        exit 1
    fi
    
    if [[ "$IOS_VERSION" != "$ANDROID_VERSION_CODE" ]]; then
        log_error "Version code mismatch between iOS and Android"
        exit 1
    fi
    
    log_success "All versions verified: $APP_VERSION (code: $ANDROID_VERSION_CODE)"
}

# Commit version changes
commit_changes() {
    print_header "Committing Version Changes"
    
    log_info "Current git status..."
    if git -C "$PROJECT_DIR" diff --quiet app.json; then
        log_info "No changes to commit"
        return
    fi
    
    log_info "Staging app.json..."
    git -C "$PROJECT_DIR" add app.json
    
    log_info "Committing..."
    git -C "$PROJECT_DIR" commit -m "chore: bump app version to $APP_VERSION for Supabase payment production deployment"
    
    log_info "Pushing to origin..."
    git -C "$PROJECT_DIR" push origin main
    
    log_success "Changes committed and pushed"
}

# Build iOS
build_ios() {
    print_header "Building iOS"
    
    log_info "Logging in to EAS..."
    eas login --non-interactive || log_warning "Already logged in"
    
    log_info "Starting iOS build..."
    log_info "Command: eas build --platform ios --profile production"
    
    if eas build \
        --platform ios \
        --profile production \
        --message "Production: Supabase payment settlement v$APP_VERSION" \
        --non-interactive; then
        log_success "iOS build submitted successfully"
        log_info "Check build status: https://expo.dev/builds"
    else
        log_error "iOS build failed"
        return 1
    fi
}

# Build Android
build_android() {
    print_header "Building Android"
    
    log_info "Logging in to EAS..."
    eas login --non-interactive || log_warning "Already logged in"
    
    log_info "Starting Android build..."
    log_info "Command: eas build --platform android --profile production"
    
    if eas build \
        --platform android \
        --profile production \
        --message "Production: Supabase payment settlement v$APP_VERSION" \
        --non-interactive; then
        log_success "Android build submitted successfully"
        log_info "Check build status: https://expo.dev/builds"
    else
        log_error "Android build failed"
        return 1
    fi
}

# Build both platforms
build_both() {
    print_header "Building Both Platforms"
    
    log_info "Logging in to EAS..."
    eas login --non-interactive || log_warning "Already logged in"
    
    log_info "Starting builds for iOS and Android..."
    
    if eas build \
        --platform all \
        --profile production \
        --message "Production: Supabase payment settlement v$APP_VERSION" \
        --non-interactive; then
        log_success "Both builds submitted successfully"
        log_info "Check build status: https://expo.dev/builds"
    else
        log_error "Build failed"
        return 1
    fi
}

# Print summary
print_summary() {
    print_header "Deployment Summary"
    
    log_success "Build process completed!"
    log_info ""
    log_info "Next Steps:"
    log_info "1. Monitor builds: https://expo.dev/builds"
    log_info "2. Once builds complete:"
    log_info "   - iOS: Download .ipa and submit to App Store Connect"
    log_info "   - Android: Download .aab and submit to Google Play Console"
    log_info "3. Test on staging (10% rollout) before full production"
    log_info "4. Monitor logs: Supabase Dashboard → Functions → paystack-webhook-settlement"
    log_info ""
    log_info "Build log saved to: $LOG_FILE"
}

# Main script
main() {
    print_header "Production Build & Deploy"
    
    log_info "App Version: $APP_VERSION"
    log_info "Android Version Code: $ANDROID_VERSION_CODE"
    log_info "Start Time: $(date)"
    log_info "Log File: $LOG_FILE"
    
    # Check arguments
    PLATFORM=${1:-both}
    
    if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" && "$PLATFORM" != "both" ]]; then
        log_error "Invalid platform: $PLATFORM"
        echo "Usage: $0 [ios|android|both]"
        exit 1
    fi
    
    # Run steps
    check_prerequisites
    verify_versions
    commit_changes
    
    case "$PLATFORM" in
        ios)
            build_ios
            ;;
        android)
            build_android
            ;;
        both)
            build_both
            ;;
    esac
    
    print_summary
}

# Run main script
main "$@"
