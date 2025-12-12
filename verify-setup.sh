#!/bin/bash

# Auto Invoice Collector - Setup Verification Script

echo "======================================"
echo "Auto Invoice Collector - Setup Check"
echo "======================================"
echo ""

# Check Node.js
echo "✓ Checking Node.js..."
node --version || echo "✗ Node.js not found"

# Check npm
echo "✓ Checking npm..."
npm --version || echo "✗ npm not found"

# Check clasp
echo "✓ Checking clasp..."
clasp --version || echo "✗ clasp not found"

# Check TypeScript (local)
echo "✓ Checking TypeScript..."
npx tsc --version || echo "✗ TypeScript not found"

# Check dependencies
echo "✓ Checking node_modules..."
if [ -d "node_modules" ]; then
  echo "  Dependencies installed ✓"
else
  echo "  ✗ Dependencies not installed. Run: npm install"
fi

# Check build
echo "✓ Checking build output..."
if [ -f "dist/bundle.js" ]; then
  echo "  Build output exists ✓"
else
  echo "  ✗ Build output not found. Run: npm run build"
fi

# Run build
echo ""
echo "Running build..."
npm run build

# Run tests
echo ""
echo "Running tests..."
npm test

echo ""
echo "======================================"
echo "Setup verification complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Login to clasp: npm run login"
echo "2. Create GAS project: clasp create --title 'Auto Invoice Collector' --type standalone"
echo "3. Push code: npm run push"
echo "4. Configure Script Properties in Apps Script"
echo "5. Set up daily trigger"
echo ""
