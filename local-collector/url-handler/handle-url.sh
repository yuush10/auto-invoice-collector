#!/bin/bash
# Handler script for invoicecollector:// URLs
# Called by the macOS app when a URL is clicked

URL="$1"

# Parse URL: invoicecollector://collect?vendor=X&month=Y&token=Z&url=DEPLOYMENT_URL
if [[ "$URL" =~ ^invoicecollector://collect\? ]]; then
    QUERY="${URL#*\?}"

    # Extract parameters
    VENDOR=$(echo "$QUERY" | grep -oE 'vendor=[^&]+' | cut -d= -f2)
    MONTH=$(echo "$QUERY" | grep -oE 'month=[^&]+' | cut -d= -f2)
    TOKEN=$(echo "$QUERY" | grep -oE 'token=[^&]+' | cut -d= -f2)
    # Extract and URL-decode the GAS Web App URL
    GAS_URL_ENCODED=$(echo "$QUERY" | grep -oE 'url=[^&]+' | cut -d= -f2-)
    if [[ -n "$GAS_URL_ENCODED" ]]; then
        GAS_URL=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote('$GAS_URL_ENCODED'))")
    fi

    if [[ -n "$VENDOR" && -n "$MONTH" && -n "$TOKEN" ]]; then
        # Build command with required parameters
        CMD="npx @auto-invoice/local-collector collect --vendor=$VENDOR --target-month=$MONTH --token=$TOKEN"

        # Add --url if GAS Web App URL is provided
        if [[ -n "$GAS_URL" ]]; then
            CMD="$CMD --url=$GAS_URL"
        fi

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
