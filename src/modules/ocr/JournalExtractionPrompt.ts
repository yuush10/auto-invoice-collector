/**
 * Journal Extraction Prompt for Gemini API
 * Extracts qualified invoice (適格請求書) fields and journal-relevant information
 */

/**
 * Template variables for prompt customization
 */
export interface PromptTemplateVariables {
  companyName?: string;
  fiscalYearEnd?: string;
  taxMethod?: string;
  accountList?: string;
  taxClassList?: string;
  currentDate?: string;
  dictionaryContext?: string;
}

/**
 * Default extraction prompt for journal-relevant information
 * Extracts all 適格請求書要件 (Qualified Invoice Requirements) fields
 */
export const JOURNAL_EXTRACTION_PROMPT = `あなたは日本の経理・会計の専門家です。以下の請求書/領収書から、適格請求書等保存方式に必要な情報を抽出してください。

【メール情報】
送信元: {{FROM}}
件名: {{SUBJECT}}

{{#if DICTIONARY_CONTEXT}}
【過去の仕訳パターン】
{{DICTIONARY_CONTEXT}}
{{/if}}

【抽出項目】
適格請求書要件に基づき、以下の項目を抽出してください。各項目には confidence (0.0-1.0) を付与してください。

① 適格請求書発行事業者の氏名又は名称 (issuer_name)
② 適格請求書発行事業者の登録番号 (invoice_registration_number) - T + 13桁の形式
③ 取引年月日 (transaction_date) - YYYY-MM-DD形式
④ 取引内容 (item_description) - 商品・サービスの内容
⑤ 軽減税率対象かどうか (is_reduced_tax_rate) - true/false
⑥ 税率ごとの金額 (amount_by_tax_rate) - 8%と10%に分けて
⑦ 適用税率 (applicable_tax_rates) - ["8%", "10%"] など
⑧ 税率ごとの消費税額 (tax_amount_by_rate)
⑨ 書類の交付を受ける事業者名 (recipient_name) - 宛名
⑩ タイムスタンプ (timestamp) - 書類の日付またはOCR処理日時

【追加抽出項目】
- 合計金額 (total_amount) - 税込合計
- 消費税合計 (total_tax_amount)
- サービス名 (service_name) - 会社名ではなく具体的なサービス/商品名
- 発生年月 (event_month) - 実際の利用・取引があった月（YYYY-MM形式）
- 利用期間 (usage_period) - 開始日と終了日（ある場合）
- 支払期限 (due_date) - YYYY-MM-DD形式（ある場合）
- 支払条件 (payment_terms) - 例: "翌月末払い"（ある場合）

【重要な判断基準】
1. 「発生年月」は請求書の発行日ではなく、実際のサービス利用・取引があった期間です
2. 利用期間がある場合は開始月を採用してください
3. 明細に複数の日付がある場合は最も多い月を採用してください
4. 登録番号は「T」で始まる13桁の番号です（例: T1234567890123）
5. 軽減税率(8%)は飲食料品等に適用されます。SaaS等のサービスは通常10%です

【出力形式】
必ず以下のJSON形式で返してください:

\`\`\`json
{
  "doc_type": {
    "value": "invoice または receipt",
    "confidence": 0.95
  },
  "issuer_name": {
    "value": "会社名",
    "confidence": 0.98
  },
  "invoice_registration_number": {
    "value": "T1234567890123 または null",
    "confidence": 0.95
  },
  "transaction_date": {
    "value": "YYYY-MM-DD",
    "confidence": 0.92
  },
  "item_description": {
    "value": "サービス・商品の説明",
    "confidence": 0.88
  },
  "is_reduced_tax_rate": {
    "value": false,
    "confidence": 0.99
  },
  "amount_by_tax_rate": {
    "value": {
      "10%": 10000,
      "8%": 0
    },
    "confidence": 0.94
  },
  "applicable_tax_rates": {
    "value": ["10%"],
    "confidence": 0.96
  },
  "tax_amount_by_rate": {
    "value": {
      "10%": 1000,
      "8%": 0
    },
    "confidence": 0.94
  },
  "recipient_name": {
    "value": "宛名 または null",
    "confidence": 0.90
  },
  "timestamp": {
    "value": "YYYY-MM-DDTHH:mm:ss+09:00",
    "confidence": 1.0
  },
  "total_amount": {
    "value": 11000,
    "confidence": 0.97
  },
  "total_tax_amount": {
    "value": 1000,
    "confidence": 0.95
  },
  "service_name": {
    "value": "具体的なサービス名",
    "confidence": 0.90
  },
  "event_month": {
    "value": "YYYY-MM",
    "confidence": 0.85
  },
  "usage_period": {
    "value": {
      "start": "YYYY-MM-DD",
      "end": "YYYY-MM-DD"
    } または null,
    "confidence": 0.80
  },
  "due_date": {
    "value": "YYYY-MM-DD または null",
    "confidence": 0.85
  },
  "payment_terms": {
    "value": "支払条件 または null",
    "confidence": 0.70
  },
  "notes": "判断根拠や注記"
}
\`\`\``;

/**
 * Default journal suggestion prompt
 * Generates journal entry suggestions based on extracted data
 */
export const JOURNAL_SUGGESTION_PROMPT = `あなたは日本の経理・会計の専門家です。以下の請求書データから仕訳候補を生成してください。

【抽出データ】
{{EXTRACTED_DATA}}

{{#if DICTIONARY_CONTEXT}}
【過去の仕訳パターン】
以下は同じ取引先・サービスの過去の仕訳パターンです。参考にしてください。
{{DICTIONARY_CONTEXT}}
{{/if}}

{{#if ACCOUNT_LIST}}
【使用可能な勘定科目】
{{ACCOUNT_LIST}}
{{/if}}

{{#if TAX_CLASS_LIST}}
【税区分マスタ】
{{TAX_CLASS_LIST}}
{{/if}}

【仕訳生成ルール】
1. 最大3つの仕訳候補を生成してください
2. 各候補には信頼度 (confidence: 0.0-1.0) と理由 (reasoning) を付けてください
3. 前払費用の可能性がある場合は、2パターンの仕訳を生成してください
   - パターン1: 直接費用計上
   - パターン2: 前払費用経由
4. 適格請求書の場合は税区分を適切に設定してください
5. 借方・貸方の金額は必ず一致させてください

【勘定科目の選択基準】
- SaaS/クラウドサービス → 通信費 or 支払手数料
- ソフトウェア利用料 → 支払手数料 or ソフトウェア
- 広告宣伝 → 広告宣伝費
- ストレージ/インフラ → 通信費 or 賃借料
- 外注・開発 → 外注費 or 支払手数料

【出力形式】
\`\`\`json
{
  "suggestions": [
    {
      "suggestion_id": "1",
      "confidence": 0.95,
      "reasoning": "SaaSサービスの月額利用料のため通信費として計上",
      "entries": [
        {
          "entry_no": 1,
          "transaction_date": "YYYY-MM-DD",
          "debit": {
            "account_name": "通信費",
            "sub_account_name": null,
            "department_name": null,
            "tax_class": "課税仕入10%",
            "amount": 10000,
            "tax_amount": 1000
          },
          "credit": {
            "account_name": "未払金",
            "sub_account_name": null,
            "amount": 11000
          },
          "description": "Slack Pro利用料 2024年1月分",
          "memo": null
        }
      ]
    }
  ]
}
\`\`\``;

/**
 * Replace template variables in prompt
 */
export function replaceTemplateVariables(
  prompt: string,
  variables: Record<string, string | undefined>
): string {
  let result = prompt;

  // Replace simple variables {{VAR}}
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  }

  // Handle conditional blocks {{#if VAR}}...{{/if}}
  const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(conditionalRegex, (_match, varName, content) => {
    const value = variables[varName];
    return value ? content : '';
  });

  return result;
}

/**
 * Build extraction prompt with context
 */
export function buildExtractionPrompt(
  emailFrom: string,
  emailSubject: string,
  dictionaryContext?: string
): string {
  return replaceTemplateVariables(JOURNAL_EXTRACTION_PROMPT, {
    FROM: emailFrom,
    SUBJECT: emailSubject,
    DICTIONARY_CONTEXT: dictionaryContext
  });
}

/**
 * Build suggestion prompt with extracted data
 */
export function buildSuggestionPrompt(
  extractedDataJson: string,
  dictionaryContext?: string,
  accountList?: string,
  taxClassList?: string
): string {
  return replaceTemplateVariables(JOURNAL_SUGGESTION_PROMPT, {
    EXTRACTED_DATA: extractedDataJson,
    DICTIONARY_CONTEXT: dictionaryContext,
    ACCOUNT_LIST: accountList,
    TAX_CLASS_LIST: taxClassList
  });
}
