#!/bin/bash
# Setup script for invoicecollector:// URL handler on macOS
# Creates an AppleScript-based app that handles the custom URL scheme

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_COLLECTOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="InvoiceCollectorHandler"
APP_PATH="$HOME/Applications/$APP_NAME.app"

echo "=== Invoice Collector URL Handler Setup ==="
echo ""

# Create ~/Applications if it doesn't exist
mkdir -p "$HOME/Applications"

# Remove old app if exists
rm -rf "$APP_PATH"

# Create the AppleScript app using osacompile
# This creates a proper app that handles URL open events
cat > /tmp/invoice_handler.applescript << APPLESCRIPT_EOF
on open location theURL
    -- Log the URL for debugging
    do shell script "echo 'Received URL: " & theURL & "' >> /tmp/invoicecollector.log"

    -- Parse URL: invoicecollector://collect?vendor=X&month=Y&token=Z
    if theURL starts with "invoicecollector://collect?" then
        set queryString to text 28 thru -1 of theURL -- Remove "invoicecollector://collect?" (27 chars)

        set vendorValue to ""
        set monthValue to ""
        set tokenValue to ""

        -- Parse query parameters
        set AppleScript's text item delimiters to "&"
        set params to text items of queryString
        set AppleScript's text item delimiters to ""

        repeat with param in params
            set AppleScript's text item delimiters to "="
            set paramParts to text items of param
            set AppleScript's text item delimiters to ""

            if (count of paramParts) = 2 then
                set paramName to item 1 of paramParts
                set paramValue to item 2 of paramParts

                if paramName = "vendor" then
                    set vendorValue to paramValue
                else if paramName = "month" then
                    set monthValue to paramValue
                else if paramName = "token" then
                    set tokenValue to paramValue
                end if
            end if
        end repeat

        -- Validate we have all parameters
        if vendorValue is not "" and monthValue is not "" and tokenValue is not "" then
            -- Build the command (cd to local-collector directory first)
            set theCommand to "cd $LOCAL_COLLECTOR_DIR && npx @auto-invoice/local-collector collect --vendor=" & vendorValue & " --target-month=" & monthValue & " --token=" & tokenValue

            -- Open Terminal and run the command
            tell application "Terminal"
                activate
                do script theCommand
            end tell
        else
            display alert "Invalid URL" message "Missing required parameters in URL."
        end if
    else
        display alert "Unknown URL" message "URL scheme not recognized: " & theURL
    end if
end open location
APPLESCRIPT_EOF

# Compile the AppleScript into an app
osacompile -o "$APP_PATH" /tmp/invoice_handler.applescript
rm /tmp/invoice_handler.applescript

echo "✓ Created AppleScript app: $APP_PATH"

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
echo "Debug log: /tmp/invoicecollector.log"
