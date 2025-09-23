import crypto from 'crypto';

export interface HMACAuthConfig {
  appKey: string;
  secret: string;
}

export function generateHMACHeaders(
  config: HMACAuthConfig,
  method: string,
  path: string,
  body?: string
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Create the signature base string
  const signatureBase = [
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    body || ''
  ].join('\n');
  
  // Generate HMAC signature
  const hmac = crypto.createHmac('sha256', config.secret);
  hmac.update(signatureBase);
  const signature = hmac.digest('base64');
  
  return {
    'X-App-Key': config.appKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-HMAC-SHA256': signature,
    'Content-Type': 'application/json'
  };
}