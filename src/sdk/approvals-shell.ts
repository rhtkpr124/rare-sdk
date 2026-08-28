import type { Address, Hash } from 'viem';
import type { WalletAccount } from './types/common.js';

type TransactionReceiptClient = {
  waitForTransactionReceipt: (params: { hash: Hash }) => Promise<unknown>;
};

type NftApprovalReadClient = {
  readContract: (params: {
    address: Address;
    abi: typeof approvalAbi;
    functionName: 'isApprovedForAll';
    args: readonly [Address, Address];
  }) => Promise<boolean>;
};

type NftApprovalWriteClient = {
  writeContract: (params: {
    address: Address;
    abi: typeof approvalAbi;
    functionName: 'setApprovalForAll';
    args: readonly [Address, boolean];
    account: Address | WalletAccount;
    chain: undefined;
  }) => Promise<Hash>;
};

export type ApprovalSideEffect = {
  type: 'nft' | 'erc20' | 'minter' | 'erc20-reset';
  approvalTxHash: Hash | undefined;
  target: Address;
  operator?: Address;
  spender?: Address;
  minter?: Address;
}

export class ApprovalSideEffectError extends Error {
  readonly operation: string;
  readonly approvals: ApprovalSideEffect[];

  constructor(params: {
    operation: string;
    approvals: ApprovalSideEffect[];
    cause: unknown;
  }) {
    super(
      `${approvalSummary(params.approvals)} before ${params.operation}, but ${params.operation} did not complete. ` +
        `The approval remains valid; retry the operation or revoke approval if it should not remain active.`,
      { cause: params.cause },
    );
    this.name = 'ApprovalSideEffectError';
    this.operation = params.operation;
    this.approvals = params.approvals;
  }
}

export async function runWithApprovalSideEffectAlert<Result>(params: {
  operation: string;
  approvals: readonly ApprovalSideEffect[];
  run: () => Promise<Result>;
}): Promise<Result> {
  try {
    return await params.run();
  } catch (error) {
    const approvals = params.approvals.filter(hasApprovalTxHash);
    if (approvals.length === 0) {
      throw error;
    }

    throw new ApprovalSideEffectError({
      operation: params.operation,
      approvals,
      cause: error,
    });
  }
}

function hasApprovalTxHash(approval: ApprovalSideEffect): approval is ApprovalSideEffect & { approvalTxHash: Hash } {
  return approval.approvalTxHash !== undefined;
}

function approvalSummary(approvals: ApprovalSideEffect[]): string {
  const [approval] = approvals;
  return approvals.length === 1 && approval !== undefined
    ? `Approval transaction ${approval.approvalTxHash} was mined (${approvalDetails(approval)})`
    : `Approval transactions were mined: ${approvals.map((sideEffect) => `${sideEffect.approvalTxHash} (${approvalDetails(sideEffect)})`).join(', ')}`;
}

function approvalDetails(approval: ApprovalSideEffect): string {
  if (approval.type === 'erc20' || approval.type === 'erc20-reset') {
    return `${approval.type}; token ${approval.target}; spender ${approval.spender ?? 'unknown'}`;
  }
  if (approval.type === 'minter') {
    return `minter; collection ${approval.target}; minter ${approval.minter ?? 'unknown'}`;
  }

  return `nft; contract ${approval.target}; operator ${approval.operator ?? 'unknown'}`;
}

export const approvalAbi = [
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }],
    name: 'isApprovedForAll',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * After a setApprovalForAll tx is mined, some RPCs (notably on fast chains
 * like base-sepolia) can still read the pre-approval state for a short window,
 * causing the next contract call to observe stale approval state. Poll
 * isApprovedForAll until it reflects the requested state, or time out.
 */
export async function waitForApprovalState(
  publicClient: NftApprovalReadClient,
  nftAddress: Address,
  owner: Address,
  operator: Address,
  desiredApproval: boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentApproval = await publicClient.readContract({
      address: nftAddress,
      abi: approvalAbi,
      functionName: 'isApprovedForAll',
      args: [owner, operator],
    });
    if (currentApproval === desiredApproval) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `setApprovalForAll(${desiredApproval}) did not propagate to readable state within ${timeoutMs}ms. ` +
      `The approval tx was mined but the marketplace still sees the old state. Retry the operation.`,
  );
}

export async function waitForApproval(
  publicClient: NftApprovalReadClient,
  nftAddress: Address,
  owner: Address,
  operator: Address,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  return waitForApprovalState(publicClient, nftAddress, owner, operator, true, opts);
}

export class NftApprovalRequiredError extends Error {
  readonly nftAddress: Address;
  readonly operator: Address;

  constructor(params: { nftAddress: Address; operator: Address }) {
    super(`NFT approval is required for contract ${params.nftAddress} and operator ${params.operator}.`);
    this.name = 'NftApprovalRequiredError';
    this.nftAddress = params.nftAddress;
    this.operator = params.operator;
  }
}

export class MinterApprovalRequiredError extends Error {
  readonly collection: Address;
  readonly minter: Address;

  constructor(params: { collection: Address; minter: Address }) {
    super(`Minter approval is required for collection ${params.collection} and minter ${params.minter}.`);
    this.name = 'MinterApprovalRequiredError';
    this.collection = params.collection;
    this.minter = params.minter;
  }
}

export async function approveNftContractIfNeeded(opts: {
  publicClient: NftApprovalReadClient & TransactionReceiptClient;
  walletClient: NftApprovalWriteClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  nftAddress: Address;
  operator: Address;
  autoApprove?: boolean;
}): Promise<Hash | undefined> {
  const isApproved = await opts.publicClient.readContract({
    address: opts.nftAddress,
    abi: approvalAbi,
    functionName: 'isApprovedForAll',
    args: [opts.accountAddress, opts.operator],
  });

  if (isApproved) {
    return undefined;
  }

  if (opts.autoApprove !== true) {
    throw new NftApprovalRequiredError({
      nftAddress: opts.nftAddress,
      operator: opts.operator,
    });
  }

  const approvalTxHash = await opts.walletClient.writeContract({
    address: opts.nftAddress,
    abi: approvalAbi,
    functionName: 'setApprovalForAll',
    args: [opts.operator, true],
    account: opts.account,
    chain: undefined,
  });

  await opts.publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
  await waitForApproval(opts.publicClient, opts.nftAddress, opts.accountAddress, opts.operator);

  return approvalTxHash;
}
