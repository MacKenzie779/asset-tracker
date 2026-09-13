import { useEffect, useRef } from 'react';
import { subscribe, type BusEvents } from '../lib/bus';

/** Subscribe to a bus event for the lifetime of the component; the handler may change freely. */
export function useBus<K extends keyof BusEvents>(name: K, handler: (payload: BusEvents[K]) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(name, (p) => ref.current(p)), [name]);
}
