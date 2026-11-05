// Every firmware the app knows about. Adding one = writing an adapter and listing it here.
import { betaflightAdapter } from './betaflight';
import { inavAdapter } from './inav';
import { emuflightAdapter, kissAdapter } from './planned';
import type { FirmwareAdapter, FirmwareId } from './types';

export const FIRMWARE_ADAPTERS: readonly FirmwareAdapter[] = [betaflightAdapter, inavAdapter, emuflightAdapter, kissAdapter];

export function getAdapter(id: FirmwareId): FirmwareAdapter {
  const adapter = FIRMWARE_ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`Unknown firmware ${id}`);
  return adapter;
}

export const usableAdapters = () => FIRMWARE_ADAPTERS.filter((a) => a.support !== 'planned' && a.compile && a.renderCli);
