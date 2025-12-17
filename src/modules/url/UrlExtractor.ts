/**
 * URL Extractor Module
 * Extracts invoice URLs from email bodies and identifies vendors
 */

import { VendorConfig, VENDOR_CONFIGS } from '../../config';

/**
 * Extracted URL information
 */
export interface ExtractedUrl {
  /** Original URL from the email */
  url: string;
  /** Normalized URL (cleaned up) */
  normalizedUrl: string;
  /** Domain of the URL */
  domain: string;
  /** Matched vendor key (if identified) */
  vendorKey?: string;
  /** Matched vendor config (if identified) */
  vendorConfig?: VendorConfig;
  /** Whether this URL is likely an invoice/billing URL */
  isInvoiceUrl: boolean;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * URL extraction result
 */
export interface UrlExtractionResult {
  /** All extracted URLs */
  urls: ExtractedUrl[];
  /** URLs identified as invoice/billing related */
  invoiceUrls: ExtractedUrl[];
  /** URLs matched to known vendors */
  vendorUrls: ExtractedUrl[];
}

/**
 * Keywords that indicate invoice/billing URLs
 */
const INVOICE_URL_KEYWORDS = [
  'invoice',
  'billing',
  'payment',
  'receipt',
  'statement',
  '請求',
  '領収',
  '明細',
  'download',
  'pdf',
];

/**
 * Keywords that indicate non-invoice URLs (to filter out)
 */
const EXCLUDED_URL_KEYWORDS = [
  'unsubscribe',
  'privacy',
  'terms',
  'help',
  'support',
  'faq',
  'feedback',
  'survey',
  'track',
  'social',
  'facebook',
  'twitter',
  'linkedin',
];

/**
 * URL Extractor class
 */
export class UrlExtractor {
  /**
   * Extract all URLs from email body
   */
  extractAllUrls(emailBody: string): string[] {
    // URL regex pattern
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const matches = emailBody.match(urlPattern) || [];

    // Clean up URLs
    return matches
      .map(url => this.cleanUrl(url))
      .filter((url, index, self) => self.indexOf(url) === index); // Dedupe
  }

  /**
   * Extract and analyze URLs from email body
   */
  extract(emailBody: string): UrlExtractionResult {
    const rawUrls = this.extractAllUrls(emailBody);
    const urls: ExtractedUrl[] = [];

    for (const rawUrl of rawUrls) {
      const extractedUrl = this.analyzeUrl(rawUrl);
      urls.push(extractedUrl);
    }

    return {
      urls,
      invoiceUrls: urls.filter(u => u.isInvoiceUrl),
      vendorUrls: urls.filter(u => u.vendorKey !== undefined),
    };
  }

  /**
   * Analyze a single URL
   */
  analyzeUrl(url: string): ExtractedUrl {
    const normalizedUrl = this.cleanUrl(url);
    const domain = this.extractDomain(normalizedUrl);
    const vendorConfig = this.identifyVendor(normalizedUrl, domain);
    const isInvoiceUrl = this.isLikelyInvoiceUrl(normalizedUrl);
    const confidence = this.calculateConfidence(normalizedUrl, vendorConfig, isInvoiceUrl);

    return {
      url,
      normalizedUrl,
      domain,
      vendorKey: vendorConfig?.vendorKey,
      vendorConfig,
      isInvoiceUrl,
      confidence,
    };
  }

  /**
   * Clean up a URL
   */
  private cleanUrl(url: string): string {
    // Remove trailing punctuation that might be captured
    let cleaned = url.replace(/[.,;:!?)]+$/, '');

    // Handle Google redirect URLs
    const googleRedirect = cleaned.match(/google\.com\/url\?.*?[?&]q=([^&]+)/);
    if (googleRedirect) {
      try {
        cleaned = decodeURIComponent(googleRedirect[1]);
      } catch {
        // Keep original if decoding fails
      }
    }

    return cleaned;
  }

  /**
   * Extract domain from URL
   * Note: GAS doesn't have the standard URL class, so we use regex
   */
  private extractDomain(url: string): string {
    // Extract hostname using regex (GAS compatible)
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^/:]+)/i);
    const hostname = match ? match[1] : '';
    return hostname.replace(/^www\./, '');
  }

  /**
   * Identify vendor from URL
   */
  identifyVendor(url: string, domain?: string): VendorConfig | undefined {
    const targetDomain = domain || this.extractDomain(url);

    for (const config of VENDOR_CONFIGS) {
      if (!config.domainPatterns) continue;

      for (const pattern of config.domainPatterns) {
        if (targetDomain.includes(pattern)) {
          return config;
        }
      }

      // Also check URL patterns if defined
      if (config.urlPattern && config.urlPattern.test(url)) {
        return config;
      }
    }

    return undefined;
  }

  /**
   * Check if URL is likely an invoice/billing URL
   */
  private isLikelyInvoiceUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();

    // Check for excluded keywords first
    for (const keyword of EXCLUDED_URL_KEYWORDS) {
      if (lowerUrl.includes(keyword)) {
        return false;
      }
    }

    // Check for invoice keywords
    for (const keyword of INVOICE_URL_KEYWORDS) {
      if (lowerUrl.includes(keyword)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate confidence score for URL
   */
  private calculateConfidence(
    url: string,
    vendorConfig: VendorConfig | undefined,
    isInvoiceUrl: boolean
  ): number {
    let score = 0;

    // Known vendor: high confidence
    if (vendorConfig) {
      score += 0.5;
    }

    // Invoice keywords: medium confidence
    if (isInvoiceUrl) {
      score += 0.3;
    }

    // PDF or download in URL: bonus
    if (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('download')) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * Get the best invoice URL from extraction result
   */
  getBestInvoiceUrl(result: UrlExtractionResult): ExtractedUrl | undefined {
    // Prefer vendor URLs with invoice keywords
    const vendorInvoiceUrls = result.urls.filter(u => u.vendorKey && u.isInvoiceUrl);
    if (vendorInvoiceUrls.length > 0) {
      return vendorInvoiceUrls.sort((a, b) => b.confidence - a.confidence)[0];
    }

    // Fall back to any vendor URL
    if (result.vendorUrls.length > 0) {
      return result.vendorUrls.sort((a, b) => b.confidence - a.confidence)[0];
    }

    // Fall back to any invoice URL
    if (result.invoiceUrls.length > 0) {
      return result.invoiceUrls.sort((a, b) => b.confidence - a.confidence)[0];
    }

    return undefined;
  }
}

// Export singleton instance
export const urlExtractor = new UrlExtractor();
