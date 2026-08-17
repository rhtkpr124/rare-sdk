import type { Hash, TransactionReceipt, WalletClient } from 'viem';
import type {
  CurrencyInfo,
  CurrencyInput,
  CurrencyName,
  CustomCurrencyInfo,
  ResolvedCurrency,
} from '../../contracts/addresses.js';

export type IntegerInput = bigint | number | string;
export type AmountInput = bigint;
export type TimestampInput = IntegerInput | Date;
export type WalletAccount = NonNullable<WalletClient['account']>;
export type {
  CurrencyInfo,
  CurrencyInput,
  CurrencyName,
  CustomCurrencyInfo,
  ResolvedCurrency,
};
export type ResolvedCurrencyWithDecimals =
  | CurrencyInfo
  | (Omit<CustomCurrencyInfo, 'decimals'> & { decimals: number });

export type TransactionResult = {
  txHash: Hash;
  receipt: TransactionReceipt;
}
