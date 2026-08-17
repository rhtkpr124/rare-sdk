import {
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  erc20Abi,
  isAddressEqual,
  maxUint256,
} from 'viem';
import { auctionAbi } from '../contracts/abis/auction.js';
import { ETH_ADDRESS, listCurrencies, type SupportedChain } from '../contracts/addresses.js';
import type { AmountInput, WalletAccount } from './types/common.js';

type TransactionReceiptClient = {
  waitForTransactionReceipt: (params: { hash: Hash }) => Promise<TransactionReceipt>;
};

type PaymentAllowanceReadClient = {
  readContract: (params: {
    address: Address;
    abi: typeof erc20Abi;
    functionName: 'allowance';
    args: readonly [Address, Address];
  }) => Promise<bigint>;
};

type PaymentApprovalWriteClient = {
  writeContract: (params: {
    address: Address;
    abi: typeof erc20Abi;
    functionName: 'approve';
    args: readonly [Address, bigint];
    account: Address | WalletAccount;
    chain: undefined;
  }) => Promise<Hash>;
};

export const marketplaceSettingsAbi = [
  {
    inputs: [{ name: '_amount', type: 'uint256' }],
    name: 'calculateMarketplaceFee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getMarketplaceFeePercentage',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export async function getTokenDecimals(publicClient: PublicClient, token: Address): Promise<number> {
  if (isAddressEqual(token, ETH_ADDRESS)) {
    return 18;
  }

  const decimals = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'decimals',
  });

  return Number(decimals);
}

export function getKnownCurrencyDecimals(currency: Address, chain: SupportedChain): number | null {
  return listCurrencies(chain).find((entry) => isAddressEqual(entry.address, currency))?.decimals ?? null;
}

export async function resolveCurrencyDecimals(
  publicClient: Pick<PublicClient, 'readContract'>,
  chain: SupportedChain,
  currency: Address,
): Promise<number> {
  const known = getKnownCurrencyDecimals(currency, chain);
  if (known !== null) return known;

  const decimals = await publicClient.readContract({
    address: currency,
    abi: erc20Abi,
    functionName: 'decimals',
  });

  return Number(decimals);
}

export async function toCurrencyAmount(
  _publicClient: Pick<PublicClient, 'readContract'>,
  _chain: SupportedChain,
  _currency: Address,
  value: AmountInput,
  _field: string,
): Promise<bigint> {
  return value;
}

export async function toTokenAmount(
  _publicClient: PublicClient,
  _token: Address,
  value: AmountInput,
  _field: string,
): Promise<bigint> {
  return value;
}

export async function ensureTokenAllowance(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address | WalletAccount,
  owner: Address,
  token: Address,
  spender: Address,
  amount: bigint,
  autoApprove = false,
): Promise<Hash | undefined> {
  if (isAddressEqual(token, ETH_ADDRESS) || amount === 0n) {
    return undefined;
  }

  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  });

  if (allowance >= amount) {
    return undefined;
  }

  if (!autoApprove) {
    throw new PaymentApprovalRequiredError({ requiredAmount: amount, spenderAddress: spender });
  }

  const approveTx = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    account,
    chain: undefined,
  });

  await confirmErc20Approval(publicClient, {
    approvalTxHash: approveTx,
    currency: token,
    accountAddress: owner,
    spenderAddress: spender,
    requiredAmount: amount,
  });
  return approveTx;
}

export class PaymentApprovalRequiredError extends Error {
  readonly requiredAmount: bigint;
  readonly spenderAddress: Address;

  constructor(params: { requiredAmount: bigint; spenderAddress: Address }) {
    super(
      `ERC20 allowance is below the required payment of ${params.requiredAmount.toString()} raw units for spender ${params.spenderAddress}.`,
    );
    this.name = 'PaymentApprovalRequiredError';
    this.requiredAmount = params.requiredAmount;
    this.spenderAddress = params.spenderAddress;
  }
}

/**
 * Handles ETH fee calculation or ERC20 allowance approval before a payment transaction.
 * Returns the `value` to attach to the transaction (non-zero only for ETH payments).
 */
export async function preparePayment(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  auctionAddress: Address;
  currency: Address;
  amount: bigint;
}): Promise<bigint> {
  return (await preparePaymentForSpender({
    publicClient: opts.publicClient,
    walletClient: opts.walletClient,
    account: opts.account,
    accountAddress: opts.accountAddress,
    marketplaceSettingsSource: opts.auctionAddress,
    spenderAddress: opts.auctionAddress,
    currency: opts.currency,
    amount: opts.amount,
  })).value;
}

export async function preparePaymentForSpender(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  marketplaceSettingsSource: Address;
  spenderAddress: Address;
  currency: Address;
  amount: bigint;
  autoApprove?: boolean;
}): Promise<{
  value: bigint;
  requiredAmount: bigint;
  approvalTxHash?: Hash;
}> {
  const requiredAmount = await calculateMarketplacePaymentAmount(
    opts.publicClient,
    opts.marketplaceSettingsSource,
    opts.amount,
  );

  return preparePaymentAmountForSpender({
    publicClient: opts.publicClient,
    walletClient: opts.walletClient,
    account: opts.account,
    accountAddress: opts.accountAddress,
    spenderAddress: opts.spenderAddress,
    currency: opts.currency,
    requiredAmount,
    autoApprove: opts.autoApprove,
  });
}

export async function preparePaymentAmountForSpender(opts: {
  publicClient: PaymentAllowanceReadClient & TransactionReceiptClient;
  walletClient: PaymentApprovalWriteClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  spenderAddress: Address;
  currency: Address;
  requiredAmount: bigint;
  autoApprove?: boolean;
}): Promise<{
  value: bigint;
  requiredAmount: bigint;
  approvalTxHash?: Hash;
}> {
  const {
    publicClient,
    walletClient,
    account,
    accountAddress,
    spenderAddress,
    currency,
    requiredAmount,
  } = opts;
  const isEth = isAddressEqual(currency, ETH_ADDRESS);
  const autoApprove = opts.autoApprove ?? false;

  if (requiredAmount === 0n) {
    return {
      value: 0n,
      requiredAmount,
    };
  }

  if (isEth) {
    return {
      value: requiredAmount,
      requiredAmount,
    };
  }

  const allowance = await readAllowance(publicClient, currency, accountAddress, spenderAddress);
  if (allowance >= requiredAmount) {
    return {
      value: 0n,
      requiredAmount,
    };
  }

  if (!autoApprove) {
    throw new PaymentApprovalRequiredError({ requiredAmount, spenderAddress });
  }

  const approvalTxHash = await walletClient.writeContract({
    address: currency,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spenderAddress, maxUint256],
    account,
    chain: undefined,
  });
  await confirmErc20Approval(publicClient, {
    approvalTxHash,
    currency,
    accountAddress,
    spenderAddress,
    requiredAmount,
  });

  return {
    value: 0n,
    requiredAmount,
    approvalTxHash,
  };
}

export async function calculateMarketplacePaymentAmount(
  publicClient: PublicClient,
  marketplaceSettingsSource: Address,
  amount: bigint,
): Promise<bigint> {
  if (amount === 0n) {
    return 0n;
  }

  const settingsAddress = await publicClient.readContract({
    address: marketplaceSettingsSource,
    abi: auctionAbi,
    functionName: 'marketplaceSettings',
  });
  return calculateMarketplacePaymentAmountFromSettings(publicClient, settingsAddress, amount);
}

export async function calculateMarketplacePaymentAmountFromSettings(
  publicClient: PublicClient,
  marketplaceSettings: Address,
  amount: bigint,
): Promise<bigint> {
  if (amount === 0n) {
    return 0n;
  }

  const fee = await publicClient.readContract({
    address: marketplaceSettings,
    abi: marketplaceSettingsAbi,
    functionName: 'calculateMarketplaceFee',
    args: [amount],
  });

  return amount + fee;
}

async function readAllowance(
  publicClient: PaymentAllowanceReadClient,
  currency: Address,
  accountAddress: Address,
  spenderAddress: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: currency,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [accountAddress, spenderAddress],
  });
}

async function confirmErc20Approval(
  publicClient: PaymentAllowanceReadClient & TransactionReceiptClient,
  params: {
    approvalTxHash: Hash;
    currency: Address;
    accountAddress: Address;
    spenderAddress: Address;
    requiredAmount: bigint;
  },
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: params.approvalTxHash });
  if (receipt.status !== 'success') {
    throw new Error(`ERC20 approval transaction ${params.approvalTxHash} did not succeed.`);
  }

  await waitForErc20Allowance(publicClient, params);
}

async function waitForErc20Allowance(
  publicClient: PaymentAllowanceReadClient,
  params: {
    approvalTxHash: Hash;
    currency: Address;
    accountAddress: Address;
    spenderAddress: Address;
    requiredAmount: bigint;
    timeoutMs?: number;
    intervalMs?: number;
  },
): Promise<void> {
  const timeoutMs = params.timeoutMs ?? 15_000;
  const intervalMs = params.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const allowance = await readAllowance(
      publicClient,
      params.currency,
      params.accountAddress,
      params.spenderAddress,
    );
    if (allowance >= params.requiredAmount) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `ERC20 approval transaction ${params.approvalTxHash} was mined but allowance for spender ${params.spenderAddress} ` +
      `did not reach ${params.requiredAmount.toString()} raw units within ${timeoutMs}ms. Retry the operation.`,
  );
}
