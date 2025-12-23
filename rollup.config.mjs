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

function cleanupFailedMessages() {
  return globalThis.cleanupFailedMessages();
}

function cleanupProcessedEmails(gmailQuery, serviceName) {
  return globalThis.cleanupProcessedEmails(gmailQuery, serviceName);
}

function setupMonthlyJournalTrigger() {
  return globalThis.setupMonthlyJournalTrigger();
}

function processMonthlyJournals() {
  return globalThis.processMonthlyJournals();
}

// Web App functions
function doGet(e) {
  return globalThis.doGet(e);
}

function include(filename) {
  return globalThis.include(filename);
}

// API wrapper functions for google.script.run
function api_getDraftSummary(yearMonth) {
  return globalThis.api_getDraftSummary(yearMonth);
}

function api_getDraftList(yearMonth, status) {
  return globalThis.api_getDraftList(yearMonth, status);
}

function api_getYearMonthOptions() {
  return globalThis.api_getYearMonthOptions();
}

function api_bulkApprove(draftIdsJson) {
  return globalThis.api_bulkApprove(draftIdsJson);
}

function api_getDraftDetail(draftId) {
  return globalThis.api_getDraftDetail(draftId);
}

function api_getDraftHistory(draftId) {
  return globalThis.api_getDraftHistory(draftId);
}

function api_getDraftSnapshot(draftId, version) {
  return globalThis.api_getDraftSnapshot(draftId, version);
}

function api_updateDraft(draftId, updatesJson, reason) {
  return globalThis.api_updateDraft(draftId, updatesJson, reason);
}

function api_selectSuggestion(draftId, suggestionIndex) {
  return globalThis.api_selectSuggestion(draftId, suggestionIndex);
}

function api_setCustomEntry(draftId, entriesJson, reason) {
  return globalThis.api_setCustomEntry(draftId, entriesJson, reason);
}

function api_approveDraft(draftId, selectedEntryJson, registerToDict, editReason) {
  return globalThis.api_approveDraft(draftId, selectedEntryJson, registerToDict, editReason);
}

function api_getNextPendingDraft(currentDraftId, yearMonth) {
  return globalThis.api_getNextPendingDraft(currentDraftId, yearMonth);
}

function api_getDictionaryHistory(dictId) {
  return globalThis.api_getDictionaryHistory(dictId);
}

function api_getDictionaryList() {
  return globalThis.api_getDictionaryList();
}

function api_getPromptList() {
  return globalThis.api_getPromptList();
}

function api_getPromptDetail(promptId) {
  return globalThis.api_getPromptDetail(promptId);
}

function api_createPrompt(configJson) {
  return globalThis.api_createPrompt(configJson);
}

function api_updatePrompt(promptId, updatesJson) {
  return globalThis.api_updatePrompt(promptId, updatesJson);
}

function api_activatePrompt(promptId) {
  return globalThis.api_activatePrompt(promptId);
}

function api_deactivatePrompt(promptId) {
  return globalThis.api_deactivatePrompt(promptId);
}

function api_deletePrompt(promptId) {
  return globalThis.api_deletePrompt(promptId);
}

function api_testPrompt(promptId, testFileId) {
  return globalThis.api_testPrompt(promptId, testFileId);
}

function api_getPromptVersionHistory(promptType) {
  return globalThis.api_getPromptVersionHistory(promptType);
}

function api_resetToDefaultPrompt(promptType) {
  return globalThis.api_resetToDefaultPrompt(promptType);
}

// Test data functions (development only)
function createTestDraftData() {
  return globalThis.createTestDraftData();
}

function clearTestDraftData() {
  return globalThis.clearTestDraftData();
}

function debugDraftData() {
  return globalThis.debugDraftData();
}

// Vendor invoice functions (Phase 3)
function downloadVendorInvoices(vendorKey, optionsJson) {
  return globalThis.downloadVendorInvoices(vendorKey, optionsJson);
}

function downloadAitemasuInvoices() {
  return globalThis.downloadAitemasuInvoices();
}

function processScheduledVendors() {
  return globalThis.processScheduledVendors();
}

function processVendorManually(vendorKey) {
  return globalThis.processVendorManually(vendorKey);
}

function showVendorSchedule() {
  return globalThis.showVendorSchedule();
}

function setupDailyVendorTrigger() {
  return globalThis.setupDailyVendorTrigger();
}

function setupMonthlyVendorTrigger() {
  return globalThis.setupMonthlyVendorTrigger();
}

// Auth failure handling functions (Phase 3.4)
function checkVendorCookieStatus() {
  return globalThis.checkVendorCookieStatus();
}

function updateVendorCookieMetadata(vendorKey, expirationDays) {
  return globalThis.updateVendorCookieMetadata(vendorKey, expirationDays);
}

function testAuthFailureNotification(vendorKey) {
  return globalThis.testAuthFailureNotification(vendorKey);
}

function testAuthFailureNotification_Aitemasu() {
  return globalThis.testAuthFailureNotification_Aitemasu();
}

function updateCookie_Aitemasu_30days() {
  return globalThis.updateCookie_Aitemasu_30days();
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
