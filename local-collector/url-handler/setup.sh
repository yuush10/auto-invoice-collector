#!/bin/bash
# Setup script for invoicecollector:// URL handler on macOS
# This creates an app that handles the custom URL scheme

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="InvoiceCollectorHandler"
APP_PATH="$HOME/Applications/$APP_NAME.app"
HANDLER_SCRIPT="$SCRIPT_DIR/handle-url.sh"

echo "=== Invoice Collector URL Handler Setup ==="
echo ""

# Create handler script
cat > "$HANDLER_SCRIPT" << 'HANDLER_EOF'
#!/bin/bash
# Handler script for invoicecollector:// URLs
# Called by the macOS app when a URL is clicked

URL="$1"

# Parse URL: invoicecollector://collect?vendor=X&month=Y&token=Z
if [[ "$URL" =~ ^invoicecollector://collect\? ]]; then
    QUERY="${URL#*\?}"

    # Extract parameters
    VENDOR=$(echo "$QUERY" | grep -oE 'vendor=[^&]+' | cut -d= -f2)
    MONTH=$(echo "$QUERY" | grep -oE 'month=[^&]+' | cut -d= -f2)
    TOKEN=$(echo "$QUERY" | grep -oE 'token=[^&]+' | cut -d= -f2)

    if [[ -n "$VENDOR" && -n "$MONTH" && -n "$TOKEN" ]]; then
        # Build and run the command
        CMD="npx @auto-invoice/local-collector collect --vendor=$VENDOR --target-month=$MONTH --token=$TOKEN"

        # Open Terminal and run the command
        osascript -e "tell application \"Terminal\"
            activate
            do script \"cd $HOME && $CMD\"
        end tell"
    else
        osascript -e 'display alert "Invalid URL" message "Could not parse invoice collector URL parameters."'
    fi
else
    osascript -e 'display alert "Unknown URL" message "URL scheme not recognized: '"$URL"'"'
fi
HANDLER_EOF

chmod +x "$HANDLER_SCRIPT"
echo "✓ Created handler script: $HANDLER_SCRIPT"

# Create ~/Applications if it doesn't exist
mkdir -p "$HOME/Applications"

# Create the app bundle structure
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# Create Info.plist with URL scheme registration
cat > "$APP_PATH/Contents/Info.plist" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.autoinvoice.urlhandler</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>Invoice Collector URL Handler</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>Invoice Collector URL</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>invoicecollector</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST_EOF

echo "✓ Created Info.plist with URL scheme registration"

# Create the launcher script
cat > "$APP_PATH/Contents/MacOS/launcher" << LAUNCHER_EOF
#!/bin/bash
# Launcher for Invoice Collector URL Handler
exec "$HANDLER_SCRIPT" "\$@"
LAUNCHER_EOF

chmod +x "$APP_PATH/Contents/MacOS/launcher"
echo "✓ Created launcher executable"

# Register the app with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"
echo "✓ Registered URL handler with macOS"

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
