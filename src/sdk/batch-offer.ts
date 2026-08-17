import {
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { batchOfferAbi } from '../contracts/abis/batch-offer.js';
import { tokenAbi } from '../contracts/abis/token.js';
import { ETH_ADDRESS, chainIds, requireContractAddress, type SupportedChain } from '../contracts/addresses.js';
import { approveNftContractIfNeeded, runWithApprovalSideEffectAlert } from './approvals-shell.js';
import { preparePaymentForSpender } from './payments-shell.js';
import { requireInput } from './validation-core.js';
import { requireWallet } from './wallet-shell.js';
import type { RareClientConfig } from './types/client.js';
import type { BatchOfferNamespace } from './types/batch-offer.js';
import {
  planBatchOfferAccept,
  planBatchOfferCreate,
  planBatchOfferCreateLocalInputs,
  planBatchOfferRoot,
  shapeBatchOfferRead,
  shapeBatchOfferStatus,
} from './batch-offer-core.js';
import { parseBatchTokenListArtifact } from './batch-core.js';
import {
  generateApiNftMerkleRoot,
  isApiNftMerkleProofResolutionError,
  resolveApiNftMerkleProof,
  resolveApiNftMerkleProofFromRoots,
} from './merkle-api.js';
import { resolveCurrencyForSdk } from './currency.js';

export type * from './types/batch-offer.js';

const BATCH_OFFER_EVENT_LOOKBACK_BLOCKS = 10_000n;

export function createBatchOfferNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
): BatchOfferNamespace {
  return {
    async create(params): ReturnType<BatchOfferNamespace['create']> {
      planBatchOfferCreateLocalInputs({ ...params, currency: undefined }, currentUnixTimestamp());
      if (params.artifact !== undefined) {
        parseBatchTokenListArtifact(JSON.stringify(params.artifact));
      }
      const batchOfferCreator = requireContractAddress(chain, 'batchOfferCreator');
      const marketplaceSettingsSource = requireContractAddress(chain, 'auction');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const block = await publicClient.getBlock();
      const resolvedParams = await resolveBatchOfferCreateParams(config, params);
      const currency = resolvedParams.currency === undefined
        ? ETH_ADDRESS
        : resolveCurrencyForSdk(resolvedParams.currency, chain).address;
      const price = requireInput(resolvedParams.price, 'price');
      const amount = price;
      const plan = planBatchOfferCreate({ ...resolvedParams, price: amount, currency }, block.timestamp);
      const payment = await preparePaymentForSpender({
        publicClient,
        walletClient,
        account,
        accountAddress,
        marketplaceSettingsSource,
        spenderAddress: batchOfferCreator,
        currency: plan.currency,
        amount: plan.amount,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt, created } = await runWithApprovalSideEffectAlert({
        operation: 'batch offer create',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: batchOfferCreator,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: batchOfferCreator,
            abi: batchOfferAbi,
            functionName: 'createBatchOffer',
            args: [plan.root, plan.amount, plan.currency, plan.expiry],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          const logs = parseEventLogs({
            abi: batchOfferAbi,
            logs: targetReceipt.logs,
            eventName: 'BatchOfferCreated',
          });
          const [createdLog] = logs;

          if (!createdLog) {
            throw new Error('Batch offer create transaction succeeded but BatchOfferCreated was not found in logs.');
          }

          return { txHash: targetTxHash, receipt: targetReceipt, created: createdLog };
        },
      });

      return {
        txHash,
        receipt,
        batchOfferCreator,
        creator: created.args.creator,
        root: created.args.rootHash,
        amount: created.args.amount,
        currency: created.args.currency,
        expiry: created.args.expiry,
        requiredPayment: payment.requiredAmount,
        approvalTxHash: payment.approvalTxHash,
      };
    },

    async revoke(params): ReturnType<BatchOfferNamespace['revoke']> {
      const batchOfferCreator = requireContractAddress(chain, 'batchOfferCreator');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const resolvedParams = await resolveBatchOfferRevokeParams({
        config,
        publicClient,
        batchOfferCreator,
        chainId: chainIds[chain],
        accountAddress,
        params,
      });
      const plan = planBatchOfferRoot(resolvedParams);

      const targetTxHash = await walletClient.writeContract({
        address: batchOfferCreator,
        abi: batchOfferAbi,
        functionName: 'revokeBatchOffer',
        args: [plan.root],
        account,
        chain: undefined,
      });
      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      const logs = parseEventLogs({
        abi: batchOfferAbi,
        logs: targetReceipt.logs,
        eventName: 'BatchOfferRevoked',
      });
      const [revoked] = logs;

      if (!revoked) {
        throw new Error('Batch offer revoke transaction succeeded but BatchOfferRevoked was not found in logs.');
      }

      return {
        txHash: targetTxHash,
        receipt: targetReceipt,
        batchOfferCreator,
        creator: revoked.args.creator,
        root: revoked.args.rootHash,
        amount: revoked.args.amount,
        currency: revoked.args.currency,
      };
    },

    async accept(params): ReturnType<BatchOfferNamespace['accept']> {
      const batchOfferCreator = requireContractAddress(chain, 'batchOfferCreator');
      const { walletClient, account, accountAddress } = requireWallet(config);
      const resolvedParams = await resolveBatchOfferAcceptParams({
        config,
        publicClient,
        batchOfferCreator,
        chainId: chainIds[chain],
        params,
      });
      const plan = planBatchOfferAccept(resolvedParams, accountAddress);
      const owner = await publicClient.readContract({
        address: plan.contract,
        abi: tokenAbi,
        functionName: 'ownerOf',
        args: [plan.tokenId],
      });

      if (!isAddressEqual(owner, accountAddress)) {
        throw new Error(`Connected wallet ${accountAddress} does not own token ${plan.contract} #${plan.tokenId.toString()}.`);
      }

      const approvalTxHash = await approveNftContractIfNeeded({
          publicClient,
          walletClient,
          account,
          accountAddress,
          nftAddress: plan.contract,
          operator: batchOfferCreator,
          autoApprove: plan.autoApprove,
        });

      const { txHash, receipt, accepted } = await runWithApprovalSideEffectAlert({
        operation: 'batch offer accept',
        approvals: [{
          type: 'nft',
          approvalTxHash,
          target: plan.contract,
          operator: batchOfferCreator,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: batchOfferCreator,
            abi: batchOfferAbi,
            functionName: 'acceptBatchOffer',
            args: [
              plan.creator,
              plan.proof,
              plan.root,
              plan.contract,
              plan.tokenId,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          const logs = parseEventLogs({
            abi: batchOfferAbi,
            logs: targetReceipt.logs,
            eventName: 'BatchOfferAccepted',
          });
          const [acceptedLog] = logs;

          if (!acceptedLog) {
            throw new Error('Batch offer accept transaction succeeded but BatchOfferAccepted was not found in logs.');
          }

          return { txHash: targetTxHash, receipt: targetReceipt, accepted: acceptedLog };
        },
      });

      return {
        txHash,
        receipt,
        batchOfferCreator,
        seller: accepted.args.seller,
        buyer: accepted.args.buyer,
        creator: plan.creator,
        contract: accepted.args.contractAddress,
        tokenId: accepted.args.tokenId,
        root: accepted.args.rootHash,
        currency: accepted.args.currency,
        amount: accepted.args.amount,
        approvalTxHash,
      };
    },

    async status(params): ReturnType<BatchOfferNamespace['status']> {
      const batchOfferCreator = requireContractAddress(chain, 'batchOfferCreator');
      const plan = planBatchOfferRoot(params);
      const [offer, block] = await Promise.all([
        publicClient.readContract({
          address: batchOfferCreator,
          abi: batchOfferAbi,
          functionName: 'getBatchOffer',
          args: [params.creator, plan.root],
        }),
        publicClient.getBlock(),
      ]);

      return shapeBatchOfferStatus(shapeBatchOfferRead(offer), {
        creator: params.creator,
        root: plan.root,
      }, block.timestamp);
    },
  };
}

function currentUnixTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

async function resolveBatchOfferCreateParams(
  config: RareClientConfig,
  params: Parameters<BatchOfferNamespace['create']>[0],
): Promise<Parameters<BatchOfferNamespace['create']>[0]> {
  if (params.root !== undefined) {
    return params;
  }

  const root = await generateApiNftMerkleRoot(config, params.artifact.tokens);
  return {
    ...params,
    root,
    artifact: undefined,
  };
}

async function resolveBatchOfferRevokeParams(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchOfferCreator: Address;
  chainId: number;
  accountAddress: Address;
  params: Parameters<BatchOfferNamespace['revoke']>[0];
}): Promise<{ root: `0x${string}` }> {
  const { params } = opts;
  if (params.root !== undefined || params.artifact !== undefined) {
    return {
      root: planBatchOfferRoot(params).root,
    };
  }

  if ('contract' in params && 'tokenId' in params) {
    const proof = await resolveBatchOfferApiProof({
      config: opts.config,
      publicClient: opts.publicClient,
      batchOfferCreator: opts.batchOfferCreator,
      chainId: opts.chainId,
      contractAddress: params.contract,
      tokenId: params.tokenId,
      creator: opts.accountAddress,
    });
    return { root: proof.root };
  }

  throw new Error(
    'Pass a batch token artifact, pass root as an override, or pass contract and tokenId to resolve the active batch offer root through rare-api.',
  );
}

async function resolveBatchOfferAcceptParams(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchOfferCreator: Address;
  chainId: number;
  params: Parameters<BatchOfferNamespace['accept']>[0];
}): Promise<Parameters<BatchOfferNamespace['accept']>[0]> {
  const { params } = opts;
  if (
    params.proofArtifact !== undefined ||
    (params.root !== undefined && params.proof !== undefined)
  ) {
    return params;
  }

  const proof = await resolveBatchOfferApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchOfferCreator: opts.batchOfferCreator,
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

async function resolveBatchOfferApiProof(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchOfferCreator: Address;
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
      context: 'batch-offer',
      creator: opts.creator,
    });
  } catch (error) {
    if (opts.root !== undefined || !isApiNftMerkleProofResolutionError(error)) {
      throw error;
    }
  }

  const roots = await readRecentActiveBatchOfferRoots(opts.publicClient, opts.batchOfferCreator, opts.creator);
  return resolveApiNftMerkleProofFromRoots(opts.config, {
    chainId: opts.chainId,
    contractAddress: opts.contractAddress,
    tokenId: opts.tokenId,
    roots,
    context: 'batch-offer',
    creator: opts.creator,
  });
}

async function readRecentActiveBatchOfferRoots(
  publicClient: PublicClient,
  batchOfferCreator: Address,
  creator: Address,
): Promise<Hex[]> {
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > BATCH_OFFER_EVENT_LOOKBACK_BLOCKS
    ? latestBlock - BATCH_OFFER_EVENT_LOOKBACK_BLOCKS
    : 0n;
  const [events, block] = await Promise.all([
    publicClient.getContractEvents({
      address: batchOfferCreator,
      abi: batchOfferAbi,
      eventName: 'BatchOfferCreated',
      args: { creator },
      fromBlock,
      toBlock: 'latest',
      strict: true,
    }),
    publicClient.getBlock(),
  ]);
  const roots = [...new Set(events.map((event) => event.args.rootHash))].reverse();
  return filterFillableBatchOfferRoots(publicClient, batchOfferCreator, creator, block.timestamp, roots);
}

async function filterFillableBatchOfferRoots(
  publicClient: PublicClient,
  batchOfferCreator: Address,
  creator: Address,
  nowTimestamp: bigint,
  roots: readonly Hex[],
  index = 0,
): Promise<Hex[]> {
  const root = roots[index];
  if (root === undefined) {
    return [];
  }

  const offer = shapeBatchOfferRead(await publicClient.readContract({
    address: batchOfferCreator,
    abi: batchOfferAbi,
    functionName: 'getBatchOffer',
    args: [creator, root],
  }));
  const status = shapeBatchOfferStatus(offer, { creator, root }, nowTimestamp);
  const remainingRoots = await filterFillableBatchOfferRoots(
    publicClient,
    batchOfferCreator,
    creator,
    nowTimestamp,
    roots,
    index + 1,
  );

  return status.fillable ? [root, ...remainingRoots] : remainingRoots;
}
