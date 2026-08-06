import { cookies } from 'next/headers';
import { ControlCenter } from './control-center';
import { ControlCenterGate } from './control-center-gate';
import { getControlCenterState } from '../src/domain/controlCenterService';
import {
  CONTROL_CENTER_COOKIE,
  verifyControlCenterSession
} from '../src/security/controlCenterAuth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cookieStore = await cookies();
  let authorized = false;
  try {
    authorized = verifyControlCenterSession(cookieStore.get(CONTROL_CENTER_COOKIE)?.value);
  } catch {
    authorized = false;
  }

  if (!authorized) return <ControlCenterGate />;
  const initialState = await getControlCenterState();
  return <ControlCenter initialState={initialState} />;
}
