import { isAddressEqual, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import { batchListingAbi } from '../contracts/abis/batch-listing.js';
import { ETH_ADDRESS, type SupportedChain } from '../contracts/addresses.js';
import type {
  BatchListingCancelResult,
  BatchListingCreateResult,
  BatchListingNamespace,
  BatchListingProofArtifact,
  BatchListingRootArtifact,
  BatchListingSetAllowListResult,
  BatchListingStatus,
} from './types/batch-listing.js';
import type { RareClientConfig } from './types/client.js';
import type { IntegerInput, TransactionResult, WalletAccount } from './types/common.js';
import { approveNftContractIfNeeded, runWithApprovalSideEffectAlert } from './approvals-shell.js';
import {
  calculateMarketplacePaymentAmountFromSettings,
  preparePaymentAmountForSpender,
  toCurrencyAmount,
} from './payments-shell.js';
import {
  requireInput,
  toUnixTimestamp,
} from './validation-core.js';
import { requireWallet } from './wallet-shell.js';
import { toInteger } from './amounts-core.js';
import {
  generateApiAddressMerkleRoot,
  generateApiNftMerkleRoot,
  isApiNftMerkleProofResolutionError,
  resolveApiAddressMerkleProof,
  resolveApiNftMerkleProof,
  resolveApiNftMerkleProofFromRoots,
} from './merkle-api.js';
import {
  planBatchListingRootRegistration,
  shapeBatchListingStatus,
  shouldResolveBatchListingAllowListProof,
  uniqueAddresses,
  validateBatchListingBuyProofPolicy,
} from './batch-listing-core.js';
import { normalizeBytes32 } from './batch-core.js';
import { resolveCurrencyForSdk } from './currency.js';

export type * from './types/batch-listing.js';

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export function createBatchListingNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  addresses: {
    batchListing: Address;
    marketplaceSettings: Address;
    erc20ApprovalManager: Address;
    erc721ApprovalManager: Address;
    chain: SupportedChain;
    chainId: number;
  },
): BatchListingNamespace {
  return {
    async create(params): Promise<BatchListingCreateResult> {
      if (params.artifact.chainId !== undefined && params.artifact.chainId !== addresses.chainId) {
        throw new Error(
          `Batch token tree artifact chainId ${params.artifact.chainId.toString()} does not match client chainId ${addresses.chainId.toString()}.`,
        );
      }
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined
        ? ETH_ADDRESS
        : resolveCurrencyForSdk(params.currency, addresses.chain).address;
      const artifact = await resolveApiBatchListingRootArtifact(config, {
        root: params.artifact.root,
        currency,
        amount: params.price.toString(),
        splitAddresses: params.splitAddresses ?? [],
        splitRatios: params.splitRatios ?? [],
        tokens: params.artifact.tokens.map((token) => ({
          contract: token.contractAddress,
          tokenId: token.tokenId,
        })),
      });
      const splitConfig = planBatchListingRootRegistration(artifact, accountAddress);

      const uniqueContracts = uniqueAddresses(artifact.tokens.map((token) => token.contract));

      for (const token of artifact.tokens.slice(0, 3)) {
        const owner = (await publicClient.readContract({
          address: token.contract,
          abi: [
            {
              type: 'function',
              name: 'ownerOf',
              inputs: [{ name: 'tokenId', type: 'uint256' }],
              outputs: [{ name: '', type: 'address' }],
              stateMutability: 'view',
            },
          ] as const,
          functionName: 'ownerOf',
          args: [BigInt(token.tokenId)],
        }));
        if (!isAddressEqual(owner, accountAddress)) {
          throw new Error(
            `Token ${token.contract}/${token.tokenId} is owned by ${owner}, not the configured account ${accountAddress}. ` +
              `Re-check the token set before registering this batch listing.`,
          );
        }
      }

      const nftApprovals = await approveNftContracts({
        publicClient,
        walletClient,
        account,
        accountAddress,
        operator: addresses.erc721ApprovalManager,
        nftAddresses: uniqueContracts,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'batch listing create',
        approvals: nftApprovals.map((approval) => ({
          type: 'nft',
          approvalTxHash: approval.txHash,
          target: approval.nftAddress,
          operator: addresses.erc721ApprovalManager,
        })),
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.batchListing,
            abi: batchListingAbi,
            functionName: 'registerSalePriceMerkleRoot',
            args: [
              artifact.root,
              artifact.currency,
              BigInt(artifact.amount),
              splitConfig.splitAddresses,
              splitConfig.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return {
        txHash,
        receipt,
        root: artifact.root,
        approvalTxHashes: nftApprovals.length > 0 ? nftApprovals.map((approval) => approval.txHash) : undefined,
      };
    },

    async cancel(params): Promise<BatchListingCancelResult> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const root = await resolveBatchListingRoot({
        config,
        publicClient,
        batchListingAddress: addresses.batchListing,
        chainId: addresses.chainId,
        creator: accountAddress,
        params,
      });
      const targetTxHash = await walletClient.writeContract({
        address: addresses.batchListing,
        abi: batchListingAbi,
        functionName: 'cancelSalePriceMerkleRoot',
        args: [root],
        account,
        chain: undefined,
      });
      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      return { txHash: targetTxHash, receipt: targetReceipt, root };
    },

    async buy(params): Promise<TransactionResult & { approvalTxHash?: Hash }> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const proofArtifact = await resolveBatchListingBuyProofArtifact({
        publicClient,
        config,
        batchListingAddress: addresses.batchListing,
        chainId: addresses.chainId,
        params,
        accountAddress,
      });

      const price = requireInput(params.price, 'price');
      const currency = resolveCurrencyForSdk(params.currency, addresses.chain).address;
      const amount = await toCurrencyAmount(publicClient, addresses.chain, currency, price, 'price');
      const tokenIdBig = toInteger(proofArtifact.tokenId, 'tokenId');
      const allowListProof = proofArtifact.allowListProof ?? [];

      const payment = await prepareBatchListingPayment({
        publicClient,
        walletClient,
        account,
        accountAddress,
        marketplaceSettings: addresses.marketplaceSettings,
        erc20ApprovalManager: addresses.erc20ApprovalManager,
        currency,
        amount,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'batch listing buy',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: currency,
          spender: addresses.erc20ApprovalManager,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.batchListing,
            abi: batchListingAbi,
            functionName: 'buyWithMerkleProof',
            args: [
              proofArtifact.contract,
              tokenIdBig,
              currency,
              amount,
              params.creator,
              proofArtifact.root,
              proofArtifact.proof,
              allowListProof,
            ],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, approvalTxHash: payment.approvalTxHash };
    },

    async setAllowlist(params): Promise<BatchListingSetAllowListResult> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const root = await resolveBatchListingRoot({
        config,
        publicClient,
        batchListingAddress: addresses.batchListing,
        chainId: addresses.chainId,
        creator: accountAddress,
        params,
      });
      const allowListRoot = await resolveBatchListingAllowListRoot(config, params);
      const endTime = toUnixTimestamp(
        requireInput(params.endTime ?? params.artifact?.allowList?.endTimestamp, 'endTime'),
        'endTime',
      );
      const targetTxHash = await walletClient.writeContract({
        address: addresses.batchListing,
        abi: batchListingAbi,
        functionName: 'setAllowListConfig',
        args: [root, allowListRoot, endTime],
        account,
        chain: undefined,
      });
      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      return { txHash: targetTxHash, receipt: targetReceipt, root, allowListRoot, endTime };
    },

    async status(params): Promise<BatchListingStatus> {
      const resolvedParams = await resolveBatchListingStatusParams({
        config,
        publicClient,
        batchListingAddress: addresses.batchListing,
        chainId: addresses.chainId,
        params,
      });
      const listingConfig = (await publicClient.readContract({
        address: addresses.batchListing,
        abi: batchListingAbi,
        functionName: 'getMerkleSalePriceConfig',
        args: [resolvedParams.creator, resolvedParams.root],
      }));

      const cancellationNonce = (await publicClient.readContract({
        address: addresses.batchListing,
        abi: batchListingAbi,
        functionName: 'getCreatorSalePriceMerkleRootNonce',
        args: [resolvedParams.creator, resolvedParams.root],
      }));

      const allowList = await readAllowListConfig(publicClient, addresses.batchListing, resolvedParams.creator, resolvedParams.root);
      const tokenStatus = await readTokenStatus(publicClient, addresses.batchListing, resolvedParams);

      return shapeBatchListingStatus({
        root: resolvedParams.root,
        creator: resolvedParams.creator,
        listingConfig,
        cancellationNonce,
        allowList,
        tokenStatus,
      });
    },
  };
}

async function resolveBatchListingRoot(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchListingAddress: Address;
  chainId: number;
  creator: Address;
  params: {
    root?: `0x${string}`;
    artifact?: BatchListingRootArtifact;
    contract?: Address;
    tokenId?: IntegerInput;
  };
}): Promise<`0x${string}`> {
  const root = opts.params.root === undefined ? undefined : normalizeBytes32(opts.params.root, 'root');
  const artifactRoot = opts.params.artifact === undefined
    ? undefined
    : normalizeBytes32(opts.params.artifact.root, 'artifact root');

  if (root !== undefined && artifactRoot !== undefined && root !== artifactRoot) {
    throw new Error('root does not match artifact root.');
  }
  if (root !== undefined) {
    return root;
  }
  if (artifactRoot !== undefined) {
    return artifactRoot;
  }
  if (opts.params.contract === undefined || opts.params.tokenId === undefined) {
    throw new Error('Pass an artifact, or pass contract and tokenId so rare-api can resolve the batch listing root. Use root only as an override.');
  }

  const proof = await resolveBatchListingApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchListingAddress: opts.batchListingAddress,
    chainId: opts.chainId,
    creator: opts.creator,
    contractAddress: opts.params.contract,
    tokenId: opts.params.tokenId,
  });
  return proof.root;
}

async function resolveBatchListingAllowListRoot(
  config: RareClientConfig,
  params: {
    allowListRoot?: `0x${string}`;
    artifact?: BatchListingRootArtifact;
  },
): Promise<`0x${string}`> {
  if (params.allowListRoot !== undefined) {
    return normalizeBytes32(params.allowListRoot, 'allowListRoot');
  }

  const allowList = params.artifact?.allowList;
  if (allowList === undefined) {
    throw new Error('Pass an artifact with allowList addresses, or pass allowListRoot as an override.');
  }
  if (allowList.addresses.length < 2) {
    throw new Error(
      'Allowlist must contain at least two addresses; the batch listing contract rejects empty allowlist proofs',
    );
  }

  return generateApiAddressMerkleRoot(config, {
    addresses: allowList.addresses,
    storageTarget: 'batch-listing',
  });
}

async function resolveApiBatchListingRootArtifact(
  config: RareClientConfig,
  artifact: BatchListingRootArtifact,
): Promise<BatchListingRootArtifact> {
  const [root, allowListRoot] = await Promise.all([
    generateApiNftMerkleRoot(
      config,
      artifact.tokens.map((token) => ({
        contractAddress: token.contract,
        tokenId: token.tokenId,
      })),
    ),
    artifact.allowList === undefined
      ? Promise.resolve(undefined)
      : generateApiAddressMerkleRoot(config, {
          addresses: artifact.allowList.addresses,
          storageTarget: 'batch-listing',
        }),
  ]);

  return {
    ...artifact,
    root,
    ...(artifact.allowList === undefined
      ? {}
      : {
          allowList: {
            ...artifact.allowList,
            root: allowListRoot ?? artifact.allowList.root,
          },
        }),
  };
}

async function resolveBatchListingBuyProofArtifact(opts: {
  publicClient: PublicClient;
  config: RareClientConfig;
  batchListingAddress: Address;
  chainId: number;
  params: Parameters<BatchListingNamespace['buy']>[0];
  accountAddress: Address;
}): Promise<BatchListingProofArtifact> {
  const tokenProof = opts.params.proofArtifact ?? await resolveBatchListingTokenProof(opts);
  const allowList = await readAllowListConfig(
    opts.publicClient,
    opts.batchListingAddress,
    opts.params.creator,
    tokenProof.root,
  );
  const needsBlock =
    allowList !== undefined &&
    (tokenProof.allowListProof === undefined || tokenProof.allowListProof.length === 0);
  const block = !needsBlock
    ? undefined
    : await opts.publicClient.getBlock();
  const nowTimestamp = block === undefined ? undefined : BigInt(block.timestamp);
  const proofValidation = validateBatchListingBuyProofPolicy({
    allowList,
    tokenProof,
    nowTimestamp,
  });
  if (!proofValidation.isValid) {
    throw new Error(proofValidation.errorMessage);
  }

  const shouldResolveAllowListProof = shouldResolveBatchListingAllowListProof({
    allowList,
    tokenProof,
    nowTimestamp,
  });

  if (!shouldResolveAllowListProof) {
    return tokenProof;
  }
  if (allowList === undefined) {
    throw new Error('unreachable: batch listing allowlist proof resolution requires allowlist config');
  }

  const allowListProof = await resolveApiAddressMerkleProof(opts.config, {
    root: allowList.root,
    address: opts.accountAddress,
    storageTarget: 'batch-listing',
  });

  const resolvedTokenProof = {
    ...tokenProof,
    allowListProof: allowListProof.proof,
    allowListAddress: allowListProof.address,
  };
  const resolvedProofValidation = validateBatchListingBuyProofPolicy({
    allowList,
    tokenProof: resolvedTokenProof,
    nowTimestamp,
  });
  if (!resolvedProofValidation.isValid) {
    throw new Error(resolvedProofValidation.errorMessage);
  }

  return resolvedTokenProof;
}

async function resolveBatchListingTokenProof(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchListingAddress: Address;
  chainId: number;
  params: Parameters<BatchListingNamespace['buy']>[0];
}): Promise<BatchListingProofArtifact> {
  if (opts.params.contract === undefined || opts.params.tokenId === undefined) {
    throw new Error('Pass contract and tokenId so rare-api can resolve the batch listing proof, or pass a proofArtifact override.');
  }

  const proof = await resolveBatchListingApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchListingAddress: opts.batchListingAddress,
    chainId: opts.chainId,
    creator: opts.params.creator,
    contractAddress: opts.params.contract,
    tokenId: opts.params.tokenId,
    root: opts.params.root,
  });

  return {
    root: proof.root,
    contract: proof.contract,
    tokenId: proof.tokenId,
    proof: proof.proof,
  };
}

type ResolvedBatchListingStatusParams =
  Parameters<BatchListingNamespace['status']>[0] & {
    root: `0x${string}`;
  };

async function resolveBatchListingStatusParams(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchListingAddress: Address;
  chainId: number;
  params: Parameters<BatchListingNamespace['status']>[0];
}): Promise<ResolvedBatchListingStatusParams> {
  const { root } = opts.params;
  if (root !== undefined) {
    return { ...opts.params, root };
  }
  if (opts.params.contract === undefined || opts.params.tokenId === undefined) {
    throw new Error('Pass contract and tokenId so rare-api can resolve the batch listing root, or pass root as an override.');
  }

  const proof = await resolveBatchListingApiProof({
    config: opts.config,
    publicClient: opts.publicClient,
    batchListingAddress: opts.batchListingAddress,
    chainId: opts.chainId,
    creator: opts.params.creator,
    contractAddress: opts.params.contract,
    tokenId: opts.params.tokenId,
  });

  return {
    ...opts.params,
    root: proof.root,
    proof: opts.params.proof ?? proof.proof,
  };
}

async function resolveBatchListingApiProof(opts: {
  config: RareClientConfig;
  publicClient: PublicClient;
  batchListingAddress: Address;
  chainId: number;
  creator: Address;
  contractAddress: Address;
  tokenId: IntegerInput;
  root?: `0x${string}`;
}): Promise<BatchListingProofArtifact> {
  try {
    const proof = await resolveApiNftMerkleProof(opts.config, {
      chainId: opts.chainId,
      contractAddress: opts.contractAddress,
      tokenId: opts.tokenId,
      root: opts.root,
      context: 'batch-listing',
      creator: opts.creator,
    });
    return {
      root: proof.root,
      contract: proof.contractAddress,
      tokenId: proof.tokenId,
      proof: proof.proof,
    };
  } catch (error) {
    if (opts.root !== undefined || !isApiNftMerkleProofResolutionError(error)) {
      throw error;
    }
  }

  const roots = await readActiveBatchListingRoots(opts.publicClient, opts.batchListingAddress, opts.creator);
  const proof = await resolveApiNftMerkleProofFromRoots(opts.config, {
    chainId: opts.chainId,
    contractAddress: opts.contractAddress,
    tokenId: opts.tokenId,
    roots,
    context: 'batch-listing',
    creator: opts.creator,
  });
  return {
    root: proof.root,
    contract: proof.contractAddress,
    tokenId: proof.tokenId,
    proof: proof.proof,
  };
}

async function readActiveBatchListingRoots(
  publicClient: PublicClient,
  batchListingAddress: Address,
  creator: Address,
): Promise<`0x${string}`[]> {
  return [...await publicClient.readContract({
    address: batchListingAddress,
    abi: batchListingAbi,
    functionName: 'getUserSalePriceMerkleRoots',
    args: [creator],
  })];
}

function isHash(value: Hash | undefined): value is Hash {
  return value !== undefined;
}

async function approveNftContracts(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  operator: Address;
  nftAddresses: readonly Address[];
  autoApprove?: boolean;
}): Promise<Array<{ nftAddress: Address; txHash: Hash }>> {
  return opts.nftAddresses.reduce<Promise<Array<{ nftAddress: Address; txHash: Hash }>>>(async (previous, nftAddress) => {
    const approvals = await previous;
    const txHash = await approveNftContractIfNeeded({
      publicClient: opts.publicClient,
      walletClient: opts.walletClient,
      account: opts.account,
      accountAddress: opts.accountAddress,
      nftAddress,
      operator: opts.operator,
      autoApprove: opts.autoApprove,
    });

    return isHash(txHash) ? [...approvals, { nftAddress, txHash }] : approvals;
  }, Promise.resolve([]));
}

async function prepareBatchListingPayment(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  marketplaceSettings: Address;
  erc20ApprovalManager: Address;
  currency: Address;
  amount: bigint;
  autoApprove?: boolean;
}): Promise<{ value: bigint; requiredAmount: bigint; approvalTxHash?: Hash }> {
  const requiredAmount = await calculateMarketplacePaymentAmountFromSettings(
    opts.publicClient,
    opts.marketplaceSettings,
    opts.amount,
  );

  return preparePaymentAmountForSpender({
    publicClient: opts.publicClient,
    walletClient: opts.walletClient,
    account: opts.account,
    accountAddress: opts.accountAddress,
    spenderAddress: opts.erc20ApprovalManager,
    currency: opts.currency,
    requiredAmount,
    autoApprove: opts.autoApprove,
  });
}

async function readAllowListConfig(
  publicClient: PublicClient,
  batchListingAddress: Address,
  creator: Address,
  root: `0x${string}`,
): Promise<{ root: `0x${string}`; endTimestamp: bigint } | undefined> {
  const allowList = await publicClient.readContract({
    address: batchListingAddress,
    abi: batchListingAbi,
    functionName: 'getAllowListConfig',
    args: [creator, root],
  });
  return allowList.root === ZERO_BYTES32
    ? undefined
    : { root: allowList.root, endTimestamp: allowList.endTimestamp };
}

async function readTokenStatus(
  publicClient: PublicClient,
  batchListingAddress: Address,
  params: ResolvedBatchListingStatusParams,
): Promise<Pick<BatchListingStatus, 'tokenInRoot' | 'tokenNonce'>> {
  if (params.contract === undefined || params.tokenId === undefined || params.proof === undefined) {
    return {};
  }

  const tokenId = toInteger(params.tokenId, 'tokenId');
  const [tokenInRoot, tokenNonce] = await Promise.all([
    publicClient.readContract({
      address: batchListingAddress,
      abi: batchListingAbi,
      functionName: 'isTokenInRoot',
      args: [params.root, params.contract, tokenId, params.proof],
    }),
    publicClient.readContract({
      address: batchListingAddress,
      abi: batchListingAbi,
      functionName: 'getTokenSalePriceNonce',
      args: [params.creator, params.root, params.contract, tokenId],
    }),
  ]);

  return { tokenInRoot, tokenNonce };
}
