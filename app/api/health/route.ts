import { bucket, database } from '@/db/raw';

export const dynamic = 'force-dynamic';

const responseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET() {
  const checks = { d1: false, r2: false };

  try {
    const row = await database().prepare('SELECT 1 AS ok').first<{ ok: number }>();
    checks.d1 = Number(row?.ok || 0) === 1;
  } catch {
    // Do not expose storage identifiers, query details, or exception text.
  }

  try {
    const result = await bucket().list({ limit: 1 });
    checks.r2 = Array.isArray(result.objects);
  } catch {
    // Keep the response intentionally generic; operational detail stays in logs.
  }

  const ok = checks.d1 && checks.r2;
  return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: responseHeaders });
}
