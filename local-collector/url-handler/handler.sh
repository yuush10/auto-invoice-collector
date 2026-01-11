#!/bin/bash
# URL handler script for invoicecollector:// URLs
# Called by the InvoiceCollectorHandler.app AppleScript

LOG_FILE="/tmp/invoicecollector.log"

# Get the URL from the argument
URL="$1"
echo "$(date): Received URL: $URL" >> "$LOG_FILE"

# Check if URL starts with our scheme
if [[ ! "$URL" =~ ^invoicecollector://collect\? ]]; then
    osascript -e "display notification \"Unknown URL scheme\" with title \"Invoice Collector\""
    echo "$(date): Error - Unknown URL scheme: $URL" >> "$LOG_FILE"
    exit 1
fi

# Extract query string (everything after "invoicecollector://collect?")
QUERY="${URL#invoicecollector://collect?}"
echo "$(date): Query string: $QUERY" >> "$LOG_FILE"

# Parse query parameters
VENDOR=""
MONTH=""
TOKEN=""

IFS='&' read -ra PARAMS <<< "$QUERY"
for param in "${PARAMS[@]}"; do
    key="${param%%=*}"
    value="${param#*=}"
    case "$key" in
        vendor) VENDOR="$value" ;;
        month) MONTH="$value" ;;
        token) TOKEN="$value" ;;
    esac
done

echo "$(date): Parsed - vendor=$VENDOR, month=$MONTH, token=$TOKEN" >> "$LOG_FILE"

# Validate parameters
if [[ -z "$VENDOR" || -z "$MONTH" || -z "$TOKEN" ]]; then
    osascript -e "display notification \"Missing required parameters\" with title \"Invoice Collector\""
    echo "$(date): Error - Missing parameters" >> "$LOG_FILE"
    exit 1
fi

# Build the command - __LOCAL_COLLECTOR_DIR__ is replaced at setup time
CMD="cd __LOCAL_COLLECTOR_DIR__ && npx @auto-invoice/local-collector collect --vendor=$VENDOR --target-month=$MONTH --token=$TOKEN"

echo "$(date): Command: $CMD" >> "$LOG_FILE"

# Try to run in Terminal
if osascript -e "tell application \"Terminal\"
    activate
    do script \"$CMD\"
end tell" 2>> "$LOG_FILE"; then
    echo "$(date): Successfully opened Terminal" >> "$LOG_FILE"
else
    # Fallback: copy to clipboard and notify
    echo "$CMD" | pbcopy
    osascript -e "display notification \"Command copied to clipboard. Paste in Terminal.\" with title \"Invoice Collector\""
    echo "$(date): Fallback - copied command to clipboard" >> "$LOG_FILE"
fi
