# Invoice Collector URL Handler

macOS URL handler for one-click invoice collection from notification emails.

## Setup (One-time)

```bash
cd local-collector/url-handler
./setup.sh
```

This will:
1. Create a handler script at `./handle-url.sh`
2. Install an app at `~/Applications/InvoiceCollectorHandler.app`
3. Register the `invoicecollector://` URL scheme with macOS

## How It Works

When you receive a notification email with a link like:
```
invoicecollector://collect?vendor=canva&month=2025-12&token=ABC123
```

Clicking the link will:
1. Open Terminal
2. Run: `npx @auto-invoice/local-collector collect --vendor=canva --target-month=2025-12 --token=ABC123`

## Testing

Test the URL handler with:
```bash
open 'invoicecollector://collect?vendor=test&month=2025-01&token=test123'
```

## Uninstall

```bash
rm -rf ~/Applications/InvoiceCollectorHandler.app
rm ./handle-url.sh
```

## Troubleshooting

### URL not opening the app?
- Run `./setup.sh` again to re-register
- Check System Preferences → Security & Privacy → Privacy → Automation

### Terminal not opening?
- Grant Terminal automation permission in System Preferences

### Command not found?
- Ensure `npx` is in your PATH
- Install the local-collector: `npm install -g @auto-invoice/local-collector`
