import { NextResponse } from 'next/server';

/**
 * Liveness and readiness health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'qti-scoring-system',
  });
}
