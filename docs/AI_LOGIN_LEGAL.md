# AI Login Automation: Legal and ToS Considerations

This document outlines the legal and terms of service considerations for implementing AI-driven login automation for vendor portals, specifically IBJ.

## Overview

The AI login automation feature uses Claude AI with browser-use to perform human-like login operations, including potential reCAPTCHA solving. This document assesses the legal implications and provides risk mitigation strategies.

## IBJ Terms of Service Analysis

Based on IBJ's Terms of Service (https://www.ibjapan.com/mem/static/kiyaku/):

### Relevant Provisions

| Article | Content | Risk Level |
|---------|---------|------------|
| 5(4) | Prohibits access "through methods other than currently available public interfaces, including scraping" | HIGH |
| 5(5) | Explicitly prohibits "automated means (information gathering bots, robots, spiders, scrapers, etc.)" | HIGH |
| 10(1) | Service suspension may occur for term violations | MEDIUM |

### Assessment

The IBJ Terms of Service explicitly prohibit:
1. **Automated access** - Using bots or automated tools
2. **Non-standard interfaces** - Accessing via methods other than normal browser usage
3. **Scraping** - Automated data collection

**Conclusion**: Automated login via AI agent technically violates IBJ's ToS.

## Google reCAPTCHA Enterprise Terms

Google's reCAPTCHA Enterprise Terms of Service:

### Key Points

1. **Purpose**: reCAPTCHA is designed to distinguish humans from bots
2. **Circumvention**: Automated solving may be considered circumvention
3. **Third-party services**: Using CAPTCHA-solving services typically violates Google's ToS
4. **IP Rights**: Google may view circumvention as infringement of intellectual property

### Assessment

Using AI to solve reCAPTCHA challenges exists in a gray area:
- AI vision-based solving differs from traditional CAPTCHA farms
- The user is still the authorized account holder
- No third-party human solvers are involved

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| IBJ account suspension | Low-Medium | High | Manual fallback, limited use |
| Legal action from IBJ | Very Low | High | Personal use only, no commercial redistribution |
| Google service restriction | Low | Medium | AI solving less detectable than farms |

## Risk Mitigation Strategies

### 1. Personal Use Disclaimer

This automation is intended for:
- Personal account access only
- Retrieving invoices for the authorized account holder
- Non-commercial, private use

### 2. Manual Fallback

The system always maintains:
- Automatic fallback to manual mode on AI failure
- User can disable AI login via environment variable
- Full functionality without AI feature

### 3. Rate Limiting

Implementation includes:
- No high-frequency login attempts
- Natural delays between actions
- Human-like interaction patterns

### 4. Transparency

- User is informed of automation status
- Logs are maintained for accountability
- Screenshots captured for debugging

## Alternative Approaches Considered

### 1. Contact IBJ for Official API

**Recommendation**: Before deploying this feature, consider contacting IBJ to request:
- Official API access for invoice retrieval
- Alternative authentication methods
- Written permission for automated access

**Template Request**:
```
Subject: API Access Request for Invoice Automation

Dear IBJ Support,

We are developing an internal tool to automate invoice collection
for accounting purposes. Would it be possible to:

1. Access invoices via an official API?
2. Obtain permission for automated invoice downloads?
3. Use alternative authentication (API key, OAuth)?

This would help us maintain compliance with your Terms of Service.

Thank you for your consideration.
```

### 2. Cookie-Based Session (Not Viable)

IBJ does not support persistent sessions - each login requires fresh authentication with OTP.

### 3. Browser Extension

A browser extension could assist with login while keeping the user in control, but this doesn't solve the reCAPTCHA Enterprise challenge.

## Legal Disclaimer

**THIS IS NOT LEGAL ADVICE.**

This document is for informational purposes only and does not constitute legal advice. Users should:
1. Consult with legal counsel for specific situations
2. Review the most current Terms of Service
3. Accept responsibility for their use of automation tools
4. Understand that ToS violations may result in account termination

## Implementation Decision

Given the analysis above, the AI login feature is implemented with:

1. **Disabled by default** (`ENABLE_AI_LOGIN=false`)
2. **Manual fallback always available**
3. **Clear documentation of risks**
4. **User must explicitly opt-in**

Users who enable this feature do so at their own risk and should:
- Understand the ToS implications
- Accept responsibility for potential consequences
- Consider contacting IBJ for official alternatives

## References

- IBJ Terms of Service: https://www.ibjapan.com/mem/static/kiyaku/
- Google Cloud Terms: https://cloud.google.com/terms/service-terms
- reCAPTCHA Terms: https://www.google.com/recaptcha/terms
