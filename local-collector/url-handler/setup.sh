#!/bin/bash
# Setup script for invoicecollector:// URL handler on macOS
# Creates an AppleScript-based app that delegates to a shell script for better reliability

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_COLLECTOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="InvoiceCollectorHandler"
APP_PATH="$HOME/Applications/$APP_NAME.app"
HANDLER_SCRIPT="$APP_PATH/Contents/Resources/handler.sh"

echo "=== Invoice Collector URL Handler Setup ==="
echo ""
echo "Local collector directory: $LOCAL_COLLECTOR_DIR"
echo ""

# Create ~/Applications if it doesn't exist
mkdir -p "$HOME/Applications"

# Remove old app if exists
rm -rf "$APP_PATH"

# Create the AppleScript app using osacompile
# This minimal app just delegates to the shell script for URL handling
cat > /tmp/invoice_handler.applescript << 'APPLESCRIPT_EOF'
on open location theURL
    set handlerPath to (path to me as text) & "Contents:Resources:handler.sh"
    set handlerPosix to POSIX path of handlerPath

    try
        do shell script "'" & handlerPosix & "' '" & theURL & "'"
    on error errMsg
        display notification errMsg with title "Invoice Collector Error"
    end try
end open location
APPLESCRIPT_EOF

# Compile the AppleScript into an app
osacompile -o "$APP_PATH" /tmp/invoice_handler.applescript
rm /tmp/invoice_handler.applescript

echo "✓ Created AppleScript app: $APP_PATH"

# Create Resources directory if it doesn't exist
mkdir -p "$APP_PATH/Contents/Resources"

# Copy and configure handler.sh
cp "$SCRIPT_DIR/handler.sh" "$HANDLER_SCRIPT"
chmod +x "$HANDLER_SCRIPT"

# Replace the placeholder path with the actual local-collector directory
sed -i '' "s|__LOCAL_COLLECTOR_DIR__|$LOCAL_COLLECTOR_DIR|g" "$HANDLER_SCRIPT"

echo "✓ Installed handler script with path: $LOCAL_COLLECTOR_DIR"

# Add URL scheme to Info.plist
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$APP_PATH/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$APP_PATH/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'Invoice Collector URL'" "$APP_PATH/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$APP_PATH/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string 'invoicecollector'" "$APP_PATH/Contents/Info.plist" 2>/dev/null || true

echo "✓ Added URL scheme to Info.plist"

# Register the app with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"
echo "✓ Registered URL handler with macOS"

# Open the app once to ensure it's registered (then quit)
open -g "$APP_PATH"
sleep 1
osascript -e 'tell application "InvoiceCollectorHandler" to quit' 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The invoicecollector:// URL handler is now installed."
echo "App location: $APP_PATH"
echo ""
echo "Test it by running:"
echo "  open 'invoicecollector://collect?vendor=test&month=2025-01&token=test123'"
echo ""
echo "When you click an invoicecollector:// link in an email,"
echo "it will open Terminal and run the local-collector command."
echo ""
echo "If Terminal automation fails, the command will be copied to clipboard."
echo ""
echo "Debug log: /tmp/invoicecollector.log"
