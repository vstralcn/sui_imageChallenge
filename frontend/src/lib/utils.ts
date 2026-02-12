import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import axios from "axios"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const MIST_PER_SUI = 1_000_000_000n;

export const formatMistToSui = (mist: string | number | bigint) => {
  const mistValue = typeof mist === 'bigint' ? mist : BigInt(mist);
  const whole = mistValue / MIST_PER_SUI;
  const fractional = (mistValue % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '');
  return fractional.length > 0 ? `${whole.toString()}.${fractional}` : whole.toString();
};

export const parseStakeInputToMist = (raw: string): bigint | null => {
  const normalized = raw.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, fractionPart = ''] = normalized.split('.');
  const paddedFraction = (fractionPart + '000000000').slice(0, 9);
  const mist = BigInt(wholePart) * MIST_PER_SUI + BigInt(paddedFraction);
  if (mist <= 0n) {
    return null;
  }
  return mist;
};

export const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
export const shortId = (id: string) => `${id.slice(0, 8)}...${id.slice(-4)}`;

export const getErrorText = (err: unknown, fallback: string) => {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (typeof err.message === 'string' && err.message.length > 0) return err.message;
  }
  if (err instanceof Error && err.message.length > 0) return err.message;
  return fallback;
};

export const isTxSuccess = (txBlock: any) => {
  const rawStatus = typeof txBlock?.effects?.status === 'string'
    ? txBlock.effects.status
    : txBlock?.effects?.status?.status;
  return typeof rawStatus === 'string' && rawStatus.toLowerCase() === 'success';
};

export const getTxFailureReason = (txBlock: any) => {
  const rawStatus = txBlock?.effects?.status;
  if (typeof rawStatus === 'string') return rawStatus;
  if (rawStatus && typeof rawStatus === 'object') {
    if (rawStatus.error) return rawStatus.error;
    if (rawStatus.status) return rawStatus.status;
  }
  return 'unknown failure';
};
