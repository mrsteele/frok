import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

// A desktop backend belongs to the app that launched it. Browser development
// leaves this unset; the local API still enforces its origin and request checks.
export function proxy(request: NextRequest) {
  const expected = process.env.FROK_DESKTOP_TOKEN;
  if (expected) {
    const received = request.headers.get('x-frok-desktop-token') || '';
    const a = Buffer.from(received), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse('Open this studio in Frok Desktop.', { status: 403 });
  }
  return NextResponse.next();
}
