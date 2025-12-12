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
    globals: {
      'google-apps-script': 'GoogleAppsScript'
    }
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
