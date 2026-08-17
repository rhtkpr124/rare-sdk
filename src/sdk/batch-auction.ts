import {
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem';
import { batchAuctionHouseAbi } from '../contracts/abis/batch-auctionhouse.js';
import { ETH_ADDRESS, chainIds, requireContractAddress, type SupportedChain } from '../contracts/addresses.js';
import { approveNftContractIfNeeded, runWithApprovalSideEffectAlert } from './approvals-shell.js';
import { preparePaymentAmountForSpender } from './payments-shell.js';
import { requireInput } from './validation-core.js';
import { requireWallet } from './wallet-shell.js';
import type { RareClientConfig } from './types/client.js';
import type { WalletAccount } from './types/common.js';
import type { BatchAuctionNamespace } from './types/batch-auction.js';
import {
  planBatchAuctionBid,
  planBatchAuctionCreate,
  planBatchAuctionCreateLocalInputs,
  planBatchAuctionRoot,
  planBatchAuctionStatus,
  shapeBatchAuctionCurrentBidRead,
  shapeBatchAuctionDetailsRead,
  shapeBatchAuctionMerkleConfigRead,
  shapeBatchAuctionStatus,
  type BatchAuctionReadDetails,
  type BatchAuctionRootContext,
} from './batch-auction-core.js';
import { parseBatchTokenListArtifact } from './batch-core.js';
import {
  generateApiNftMerkleRoot,
  isApiNftMerkleProofResolutionError,
  resolveApiNftMerkleProof,
  resolveApiNftMerkleProofFromRoots,
} from './merkle-api.js';
import { resolveCurrencyForSdk } from './currency.js';

export type * from './types/batch-auction.js';

export function createBatchAuctionNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
): BatchAuctionNamespace {
  return {
    async create(params): ReturnType<BatchAuctionNamespace['create']> {
      planBatchAuctionCreateLocalInputs({ ...params, currency: undefined }, currentUnixTimestamp());
      if (params.artifact !== undefined) {
        parseBatchTokenListArtifact(JSON.stringify(params.artifact));
      }
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const resolvedParams = await resolveBatchAuctionCreateParams(config, params);
      const currency = resolvedParams.currency === undefined
        ? ETH_ADDRESS
        : resolveCurrencyForSdk(resolvedParams.currency, chain).address;
      const price = requireInput(resolvedParams.price, 'price');
      const reserveAmount = price;
      const plan = planBatchAuctionCreate(
        { ...resolvedParams, price: reserveAmount, currency },
        accountAddress,
        currentUnixTimestamp(),
      );
      const erc721ApprovalManager = plan.approvalContracts.length === 0
        ? undefined
        : requireContractAddress(chain, 'erc721ApprovalManager');
      const nftApprovals = await approveNftContracts({
        publicClient,
        account,
        accountAddress,
        walletClient,
        operator: erc721ApprovalManager,
        nftAddresses: plan.approvalContracts,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt, registered } = await runWithApprovalSideEffectAlert({
        operation: 'batch auction create',
        approvals: nftApprovals.map((approval) => ({
          type: 'nft',
          approvalTxHash: approval.txHash,
          target: approval.nftAddress,
          operator: erc721ApprovalManager,
        })),
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: batchAuctionHouse,
            abi: batchAuctionHouseAbi,
            functionName: 'registerAuctionMerkleRoot',
            args: [
              plan.root,
              plan.currency,
              plan.reserveAmount,
              plan.duration,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          const logs = parseEventLogs({
            abi: batchAuctionHouseAbi,
            logs: targetReceipt.logs,
            eventName: 'AuctionMerkleRootRegistered',
          });
          const [registeredLog] = logs;

          if (!registeredLog) {
            throw new Error('Batch auction create transaction succeeded but AuctionMerkleRootRegistered was not found in logs.');
          }

          return { txHash: targetTxHash, receipt: targetReceipt, registered: registeredLog };
        },
      });

      return {
        txHash,
        receipt,
        batchAuctionHouse,
        creator: registered.args.creator,
        root: registered.args.merkleRoot,
        currency: registered.args.currencyAddress,
        reserveAmount: registered.args.startingAmount,
        duration: registered.args.duration,
        nonce: registered.args.nonce,
        approvalTxHashes: nftApprovals.map((approval) => approval.txHash),
      };
    },

    async cancel(params): ReturnType<BatchAuctionNamespace['cancel']> {
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const resolvedParams = await resolveBatchAuctionCancelParams(
        publicClient,
        batchAuctionHouse,
        accountAddress,
        params,
      );
      const plan = planBatchAuctionRoot(resolvedParams);

      const targetTxHash = await walletClient.writeContract({
        address: batchAuctionHouse,
        abi: batchAuctionHouseAbi,
        functionName: 'cancelAuctionMerkleRoot',
        args: [plan.root],
        account,
        chain: undefined,
      });
      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      const logs = parseEventLogs({
        abi: batchAuctionHouseAbi,
        logs: targetReceipt.logs,
        eventName: 'AuctionMerkleRootCancelled',
      });
      const [cancelled] = logs;

      if (!cancelled) {
        throw new Error('Batch auction cancel transaction succeeded but AuctionMerkleRootCancelled was not found in logs.');
      }

      return {
        txHash: targetTxHash,
        receipt: targetReceipt,
        batchAuctionHouse,
        creator: cancelled.args.creator,
        root: cancelled.args.merkleRoot,
      };
    },

    async roots(params): ReturnType<BatchAuctionNamespace['roots']> {
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const creator = params?.creator ?? requireWallet(config).accountAddress;
      return [...await publicClient.readContract({
        address: batchAuctionHouse,
        abi: batchAuctionHouseAbi,
        functionName: 'getUserAuctionMerkleRoots',
        args: [creator],
      })];
    },

    async bid(params): ReturnType<BatchAuctionNamespace['bid']> {
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const resolvedParams = await resolveBatchAuctionBidParams({
        config,
        publicClient,
        batchAuctionHouse,
        chainId: chainIds[chain],
        params,
      });
      const currency = resolvedParams.currency === undefined
        ? ETH_ADDRESS
        : resolveCurrencyForSdk(resolvedParams.currency, chain).address;
      const price = requireInput(resolvedParams.price, 'price');
      const amount = price;
      const plan = planBatchAuctionBid({ ...resolvedParams, currency, price: amount });
      const erc20ApprovalManager = isAddressEqual(plan.currency, ETH_ADDRESS)
        ? batchAuctionHouse
        : requireContractAddress(chain, 'erc20ApprovalManager');
      const payment = await preparePaymentAmountForSpender({
        publicClient,
        walletClient,
        account,
        accountAddress,
        spenderAddress: erc20ApprovalManager,
        currency: plan.currency,
        requiredAmount: plan.requiredPayment,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt, bid } = await runWithApprovalSideEffectAlert({
        operation: 'batch auction bid',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: erc20ApprovalManager,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: batchAuctionHouse,
            abi: batchAuctionHouseAbi,
            functionName: 'bidWithAuctionMerkleProof',
            args: [
              plan.currency,
              plan.contract,
              plan.tokenId,
              plan.creator,
              plan.root,
              plan.amount,
              plan.proof,
            ],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          const logs = parseEventLogs({
            abi: batchAuctionHouseAbi,
            logs: targetReceipt.logs,
            eventName: 'AuctionMerkleBid',
          });
          const [bidLog] = logs;

          if (!bidLog) {
            throw new Error('Batch auction bid transaction succeeded but AuctionMerkleBid was not found in logs.');
          }

          return { txHash: targetTxHash, receipt: targetReceipt, bid: bidLog };
        },
      });

      return {
        txHash,
        receipt,
        batchAuctionHouse,
        bidder: bid.args.bidder,
        creator: bid.args.creator,
        contract: bid.args.contractAddress,
        tokenId: bid.args.tokenId,
        root: bid.args.merkleRoot,
        currency: bid.args.currencyAddress,
        amount: bid.args.amount,
        nonce: bid.args.nonce,
        requiredPayment: payment.requiredAmount,
        approvalTxHash: payment.approvalTxHash,
      };
    },

    async settle(params): ReturnType<BatchAuctionNamespace['settle']> {
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const { walletClient, account } = requireWallet(config);
      const plan = planBatchAuctionStatus(params);

      const targetTxHash = await walletClient.writeContract({
        address: batchAuctionHouse,
        abi: batchAuctionHouseAbi,
        functionName: 'settleAuction',
        args: [plan.contract, plan.tokenId],
        account,
        chain: undefined,
      });
      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      const logs = parseEventLogs({
        abi: batchAuctionHouseAbi,
        logs: targetReceipt.logs,
        eventName: 'AuctionSettled',
      });
      const [settled] = logs;

      if (!settled) {
        throw new Error('Batch auction settle transaction succeeded but AuctionSettled was not found in logs.');
      }

      return {
        txHash: targetTxHash,
        receipt: targetReceipt,
        batchAuctionHouse,
        seller: settled.args.seller,
        bidder: settled.args.bidder,
        contract: settled.args.contractAddress,
        tokenId: settled.args.tokenId,
        currency: settled.args.currencyAddress,
        amount: settled.args.amount,
        marketplaceFee: settled.args.marketplaceFee,
      };
    },

    async status(params): ReturnType<BatchAuctionNamespace['status']> {
      const batchAuctionHouse = requireContractAddress(chain, 'batchAuctionHouse');
      const resolvedParams = await resolveBatchAuctionStatusParams({
        config,
        publicClient,
        batchAuctionHouse,
        chainId: chainIds[chain],
        params,
      });
      const plan = planBatchAuctionStatus(resolvedParams);
      const [details, currentBid, block] = await Promise.all([
        publicClient.readContract({
          address: batchAuctionHouse,
          abi: batchAuctionHouseAbi,
          functionName: 'getAuctionDetails',
          args: [plan.contract, plan.tokenId],
        }),
        publicClient.readContract({
          address: batchAuctionHouse,
          abi: batchAuctionHouseAbi,
          functionName: 'getCurrentBid',
          args: [plan.contract, plan.tokenId],
        }),
        publicClient.getBlock(),
      ]);
      const shapedDetails = shapeBatchAuctionDetailsRead(details);
      const eventContext = await resolveEventContext({
        publicClient,
        batchAuctionHouse,
        planRoot: plan.root,
        planCreator: plan.creator,
        details: shapedDetails,
        contract: plan.contract,
        tokenId: plan.tokenId,
      });
      const rootContext = await resolveRootContext({
        publicClient,
        batchAuctionHouse,
        creator: eventContext.creator,
        root: eventContext.root,
        contract: plan.contract,
        tokenId: plan.tokenId,
      });

      return shapeBatchAuctionStatus(
        shapedDetails,
        shapeBatchAuctionCurrentBidRead(currentBid),
        rootContext,
        block.timestamp,
      );
    },
  };
}

function currentUnixTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

async function resolveBatchAuctionCreateParams(
  config: RareClientConfig,
  params: Parameters<BatchAuctionNamespace['create']>[0],
): Promise<Parameters<BatchAuctionNamespace['create']>[0]> {
  if (params.root !== undefined) {
    return params;
  }

  const root = await generateApiNftMerkleRoot(config, params.artifact.tokens);
  return {
    ...params,
    root,
    artifact: {
      ...params.artifact,
      root,
    },
  };
}

async function resolveBatchAuctionCancelParams(
  publicClient: PublicClient,
  batchAuctionHouse: Address,
  accountAddress: Address,
  params: Parameters<BatchAuctionNamespace['cancel']>[0],
): Promise<Parameters<BatchAuctionNamespace['cancel']>[0]> {
  if (params.root !== undefined || params.artifact !== undefined) {
    return params;
  }

  const roots = await publicClient.readContract({
    address: batchAuctionHouse,
    abi: batchAuctionHouseAbi,
    functionName: 'getUserAuctionMerkleRoots',
    args: [accountAddress],
  });

  if (roots.length === 0) {
    throw new Error(`No active batch auction roots found for ${accountAddress}. Pass root or artifact to cancel a specific root.`);
  }
  if (roots.length > 1) {
    throw new Error(
      `Multiple active batch auction roots found for ${accountAddress}. Pass one of these roots: ${roots.join(', ')}`,
    );
  }

  return { root: roots[0] };
}

async function resolveBatchAuctionBidParams(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchAuctionHouse: Address;
  chainId: number;
  params: Parameters<BatchAuctionNamespace['bid']>[0];
}): Promise<Parameters<BatchAuctionNamespace['bid']>[0]> {
  const { params } = opts;
  if (
    params.proofArtifact !== undefined ||
    (params.root !== undefined && params.proof !== undefined)
  ) {
    return params;
  }

  const proof = await resolveBatchAuctionApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchAuctionHouse: opts.batchAuctionHouse,
    chainId: opts.chainId,
    contractAddress: params.contract,
    tokenId: params.tokenId,
    root: params.root,
    creator: params.creator,
  });

  return {
    ...params,
    root: proof.root,
    proof: proof.proof,
  };
}

async function resolveBatchAuctionStatusParams(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchAuctionHouse: Address;
  chainId: number;
  params: Parameters<BatchAuctionNamespace['status']>[0];
}): Promise<Parameters<BatchAuctionNamespace['status']>[0]> {
  const { params } = opts;
  if (params.root !== undefined || params.creator === undefined) {
    return params;
  }

  const proof = await resolveBatchAuctionApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchAuctionHouse: opts.batchAuctionHouse,
    chainId: opts.chainId,
    contractAddress: params.contract,
    tokenId: params.tokenId,
    root: params.root,
    creator: params.creator,
  });

  return {
    ...params,
    root: proof.root,
    proof: params.proof ?? params.proofArtifact?.proof ?? proof.proof,
  };
}

async function resolveBatchAuctionApiProof(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchAuctionHouse: Address;
  chainId: number;
  contractAddress: Address;
  tokenId: string | number | bigint;
  root?: Hex;
  creator: Address;
}): Promise<Awaited<ReturnType<typeof resolveApiNftMerkleProof>>> {
  try {
    return await resolveApiNftMerkleProof(opts.config, {
      chainId: opts.chainId,
      contractAddress: opts.contractAddress,
      tokenId: opts.tokenId,
      root: opts.root,
      context: 'batch-auction',
      creator: opts.creator,
    });
  } catch (error) {
    if (opts.root !== undefined || !isApiNftMerkleProofResolutionError(error)) {
      throw error;
    }
  }

  const roots = await readActiveBatchAuctionRoots(opts.publicClient, opts.batchAuctionHouse, opts.creator);
  return resolveApiNftMerkleProofFromRoots(opts.config, {
    chainId: opts.chainId,
    contractAddress: opts.contractAddress,
    tokenId: opts.tokenId,
    roots,
    context: 'batch-auction',
    creator: opts.creator,
  });
}

async function readActiveBatchAuctionRoots(
  publicClient: PublicClient,
  batchAuctionHouse: Address,
  creator: Address,
): Promise<Hex[]> {
  return [...await publicClient.readContract({
    address: batchAuctionHouse,
    abi: batchAuctionHouseAbi,
    functionName: 'getUserAuctionMerkleRoots',
    args: [creator],
  })];
}

async function approveNftContracts(opts: {
  publicClient: PublicClient;
  walletClient: RareClientConfig['walletClient'];
  account: Address | WalletAccount;
  accountAddress: Address;
  operator: Address | undefined;
  nftAddresses: readonly Address[];
  autoApprove?: boolean;
}): Promise<Array<{ nftAddress: Address; txHash: Hash }>> {
  if (opts.walletClient === undefined) {
    throw new Error('walletClient is required for write operations.');
  }
  if (opts.nftAddresses.length > 0 && opts.operator === undefined) {
    throw new Error('RARE Protocol erc721ApprovalManager contract is required for batch auction NFT approvals.');
  }
  if (opts.operator === undefined) {
    return [];
  }
  const { walletClient, operator } = opts;

  return opts.nftAddresses.reduce<Promise<Array<{ nftAddress: Address; txHash: Hash }>>>(async (previous, nftAddress) => {
    const approvals = await previous;
    const txHash = await approveNftContract({
      publicClient: opts.publicClient,
      walletClient,
      account: opts.account,
      accountAddress: opts.accountAddress,
      operator,
      nftAddress,
      autoApprove: opts.autoApprove,
    });
    return txHash === undefined ? approvals : [...approvals, { nftAddress, txHash }];
  }, Promise.resolve([]));
}

async function approveNftContract(opts: {
  publicClient: PublicClient;
  walletClient: NonNullable<RareClientConfig['walletClient']>;
  account: Address | WalletAccount;
  accountAddress: Address;
  operator: Address;
  nftAddress: Address;
  autoApprove?: boolean;
}): Promise<Hash | undefined> {
  return approveNftContractIfNeeded(opts);
}

async function resolveEventContext(opts: {
  publicClient: PublicClient;
  batchAuctionHouse: Address;
  planRoot: Hex | undefined;
  planCreator: Address | undefined;
  details: BatchAuctionReadDetails;
  contract: Address;
  tokenId: bigint;
}): Promise<{ creator?: Address; root?: Hex }> {
  if (opts.planRoot !== undefined && opts.planCreator !== undefined) {
    return {
      creator: opts.planCreator,
      root: opts.planRoot,
    };
  }
  if (opts.details.creationBlock === 0n) {
    return {
      ...(opts.planCreator === undefined ? {} : { creator: opts.planCreator }),
      ...(opts.planRoot === undefined ? {} : { root: opts.planRoot }),
    };
  }

  const events = await opts.publicClient.getContractEvents({
    address: opts.batchAuctionHouse,
    abi: batchAuctionHouseAbi,
    eventName: 'AuctionMerkleBid',
    args: {
      contractAddress: opts.contract,
      tokenId: opts.tokenId,
    },
    fromBlock: opts.details.creationBlock,
    toBlock: opts.details.creationBlock,
    strict: true,
  });
  const [event] = events;

  return {
    creator: opts.planCreator ?? event?.args.creator,
    root: opts.planRoot ?? event?.args.merkleRoot,
  };
}

async function resolveRootContext(opts: {
  publicClient: PublicClient;
  batchAuctionHouse: Address;
  creator: Address | undefined;
  root: Hex | undefined;
  contract: Address;
  tokenId: bigint;
}): Promise<BatchAuctionRootContext | undefined> {
  if (opts.creator === undefined || opts.root === undefined) {
    return undefined;
  }

  const [config, rootNonce, tokenNonce] = await Promise.all([
    opts.publicClient.readContract({
      address: opts.batchAuctionHouse,
      abi: batchAuctionHouseAbi,
      functionName: 'getMerkleAuctionConfig',
      args: [opts.creator, opts.root],
    }),
    opts.publicClient.readContract({
      address: opts.batchAuctionHouse,
      abi: batchAuctionHouseAbi,
      functionName: 'getCreatorAuctionMerkleRootNonce',
      args: [opts.creator, opts.root],
    }),
    opts.publicClient.readContract({
      address: opts.batchAuctionHouse,
      abi: batchAuctionHouseAbi,
      functionName: 'getTokenAuctionNonce',
      args: [opts.creator, opts.root, opts.contract, opts.tokenId],
    }),
  ]);

  return {
    creator: opts.creator,
    root: opts.root,
    config: shapeBatchAuctionMerkleConfigRead(config),
    rootNonce,
    tokenNonce,
  };
}
