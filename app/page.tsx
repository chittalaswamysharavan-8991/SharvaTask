import { ControlCenter } from './control-center';
import { getControlCenterState } from '../src/domain/controlCenterService';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const initialState = await getControlCenterState();
  return <ControlCenter initialState={initialState} />;
}
