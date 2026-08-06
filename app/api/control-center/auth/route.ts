import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CONTROL_CENTER_COOKIE,
  createControlCenterSession,
  verifyControlCenterAccessKey
} from '../../../../src/security/controlCenterAuth';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({ access_key: z.string().min(1).max(200) });

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}

export async function POST(request: NextRequest) {
  try {
    const input = loginSchema.parse(await request.json());
    if (!verifyControlCenterAccessKey(input.access_key)) {
      return response({ error: 'Access key is incorrect.' }, 401);
    }

    const session = createControlCenterSession();
    const result = response({ ok: true });
    result.cookies.set(CONTROL_CENTER_COOKIE, session.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      expires: session.expires
    });
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: 'Enter a valid access key.' }, 400);
    const message = error instanceof Error ? error.message : 'Unable to unlock the control center.';
    return response({ error: message }, 500);
  }
}

export async function DELETE() {
  const result = response({ ok: true });
  result.cookies.set(CONTROL_CENTER_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: new Date(0)
  });
  return result;
}
