#!/usr/bin/env node

const EXPECTED_NAMESPACE = 'ios/v1.0.0';

function normalizeNamespace(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

const configured = normalizeNamespace(
  process.env.NEXT_PUBLIC_API_NAMESPACE || process.env.RN_API_NAMESPACE || '',
);

if (configured !== EXPECTED_NAMESPACE) {
  console.error(
    `[rn:ios] invalid NEXT_PUBLIC_API_NAMESPACE: expected "${EXPECTED_NAMESPACE}", received "${configured || '(empty)'}"`,
  );
  process.exit(1);
}

console.log(`[rn:ios] NEXT_PUBLIC_API_NAMESPACE validated: ${configured}`);
