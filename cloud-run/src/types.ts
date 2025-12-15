export interface ConvertRequest {
  html: string;
  options?: {
    format?: 'A4' | 'Letter';
    margin?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
    printBackground?: boolean;
  };
  metadata?: {
    messageId?: string;
    serviceName?: string;
  };
}

export interface ConvertResponse {
  success: true;
  pdf: string; // Base64 encoded
  metadata: {
    pageCount: number;
    fileSize: number;
    processingTime: number;
  };
}

export interface ErrorResponse {
  success: false;
  error: {
    code: 'INVALID_HTML' | 'RENDERING_FAILED' | 'TIMEOUT' | 'UNAUTHORIZED' | 'INTERNAL_ERROR';
    message: string;
  };
}
