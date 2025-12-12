import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/main.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'iife',
    name: 'AutoInvoiceCollector',
    banner: '/* Auto Invoice Collector - Google Apps Script */\n',
    extend: true,  // Extend global 'this' instead of creating isolated scope
    globals: {
      'google-apps-script': 'GoogleAppsScript'
    },
    footer: `
// Top-level function declarations required by Google Apps Script
// These delegate to the functions defined in the IIFE above
function main() {
  return globalThis.main();
}

function runManually() {
  return globalThis.runManually();
}

function setupTrigger() {
  return globalThis.setupTrigger();
}
`
  },
  plugins: [
    resolve({
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      sourceMap: false
    })
  ],
  external: []
};
