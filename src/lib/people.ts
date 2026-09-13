// Helpers for "person" accounts: someone you settle up with.
// balance > 0  they owe you        balance < 0  you owe them
import type { Account } from '../types';

export type PersonBalanceState = 'owes_you' | 'you_owe' | 'settled';

const EPS = 0.005; // half a cent

export function personBalanceState(balance: number): PersonBalanceState {
  if (balance > EPS) return 'owes_you';
  if (balance < -EPS) return 'you_owe';
  return 'settled';
}

export function isPerson(a: Pick<Account, 'type'> | null | undefined): boolean {
  return a?.type === 'person';
}

/** Sum of what people owe you (positive person balances). */
export function owedToYou(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type === 'person' && a.balance > EPS)
    .reduce((s, a) => s + a.balance, 0);
}

/** Sum of what you owe people, as a positive number. */
export function youOwe(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type === 'person' && a.balance < -EPS)
    .reduce((s, a) => s - a.balance, 0);
}

/** Net worth: the plain sum of every balance. */
export function totalValue(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + (Number.isFinite(a.balance) ? a.balance : 0), 0);
}
