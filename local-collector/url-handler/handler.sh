#!/bin/bash
# URL handler script for invoicecollector:// URLs
# Called by the InvoiceCollectorHandler.app AppleScript

LOG_FILE="/tmp/invoicecollector.log"
COMMAND_FILE="/tmp/invoicecollector_run.command"

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
# Use node to run the local script directly (not npx, since package isn't published)
CMD="cd __LOCAL_COLLECTOR_DIR__ && node ./bin/collect.js collect --vendor=$VENDOR --target-month=$MONTH --token=$TOKEN"

echo "$(date): Command: $CMD" >> "$LOG_FILE"

# Create a .command file and open it with Terminal
# This bypasses Automation permission requirements
cat > "$COMMAND_FILE" << EOF
#!/bin/bash
$CMD
# Keep terminal open to see output
echo ""
echo "Press any key to close this window..."
read -n 1
EOF

chmod +x "$COMMAND_FILE"
open "$COMMAND_FILE"

echo "$(date): Opened .command file in Terminal" >> "$LOG_FILE"
