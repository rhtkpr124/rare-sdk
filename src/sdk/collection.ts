import {
  ContractFunctionExecutionError,
  ContractFunctionZeroDataError,
  type Address,
  type Hash,
  type PublicClient,
  parseEventLogs,
} from 'viem';
import { lazySovereignFactoryAbi } from '../contracts/abis/lazy-sovereign-factory.js';
import { collectionMintAbi } from '../contracts/abis/collection-mint.js';
import { collectionOwnerAbi } from '../contracts/abis/collection-owner.js';
import { collectionStatusAbi } from '../contracts/abis/collection-status.js';
import { rareErc1155Abi } from '../contracts/abis/rare-erc1155.js';
import { requireContractAddress, type SupportedChain } from '../contracts/addresses.js';
import type { RareClientConfig } from './types/client.js';
import type { CollectionNamespace, LazyErc721DeploymentVariant } from './types/collection.js';
import { requireWallet } from './wallet-shell.js';
import {
  buildCollectionMintBatchWrite,
  buildCollectionPrepareLazyMintWrite,
  buildCollectionRoyaltyPercentageWrite,
  buildCreateLazySovereignCollectionWrite,
  planCollectionBaseUri,
  planCollectionContract,
  planCollectionMintBatch,
  planCollectionPrepareLazyMint,
  planCollectionReceiver,
  planCollectionRoyaltyPercentage,
  planCollectionRoyaltyInfo,
  planCollectionToken,
  planCollectionTokenReceiver,
  planCollectionTokenUri,
  planCreateLazySovereignCollection,
  shapeCollectionPrepareMintEvent,
  type LazySovereignCollectionContractType,
} from './collection-core.js';

export type * from './types/collection.js';

function resolveLazyErc721Variant(value: unknown): {
  variant: LazyErc721DeploymentVariant;
  contractType: LazySovereignCollectionContractType;
} {
  const variant = value ?? 'standard';
  if (variant === 'standard') return { variant, contractType: 'lazy' };
  if (variant === 'royalty-guard') return { variant, contractType: 'lazy-royalty-guard' };
  if (variant === 'deadman-royalty-guard') {
    return { variant, contractType: 'lazy-deadman-royalty-guard' };
  }
  throw new Error(
    `Unsupported Lazy ERC-721 deployment variant "${String(variant)}". ` +
      'Supported: standard, royalty-guard, deadman-royalty-guard.',
  );
}

export function createCollectionNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  baseCollection: Pick<CollectionNamespace, 'get'>,
  collectionDeploy: Pick<CollectionNamespace['deploy'], 'erc721' | 'erc1155' | 'lazyBatchMint'>,
  erc1155: CollectionNamespace['erc1155'],
  collectionMint: CollectionNamespace['mint'],
): CollectionNamespace {
  return {
    ...baseCollection,
    erc1155,
    mint: collectionMint,

    async status(params): ReturnType<CollectionNamespace['status']> {
      const plan = planCollectionContract(params);
      const tokenPlan = params.tokenId === undefined
        ? undefined
        : planCollectionToken({ contract: plan.contract, tokenId: params.tokenId });
      const royaltyPlan = params.tokenId === undefined
        ? undefined
        : planCollectionRoyaltyInfo({ contract: plan.contract, tokenId: params.tokenId, price: params.price });

      const [
        name,
        symbol,
        owner,
        totalSupply,
        maxTokens,
        disabled,
        tokenUrisLocked,
        batchCount,
        defaultRoyalty,
        mintConfig,
        interfaces,
        tokenOwner,
        tokenUri,
        tokenCreator,
        tokenRoyalty,
      ] = await Promise.all([
        readOptionalStatusString(publicClient, plan.contract, 'name'),
        readOptionalStatusString(publicClient, plan.contract, 'symbol'),
        readOptionalStatusAddress(publicClient, plan.contract, 'owner'),
        readOptionalStatusBigint(publicClient, plan.contract, 'totalSupply'),
        readOptionalStatusBigint(publicClient, plan.contract, 'maxTokens'),
        readOptionalStatusBoolean(publicClient, plan.contract, 'disabled'),
        readOptionalStatusBoolean(publicClient, plan.contract, 'areTokenURIsLocked'),
        readOptionalStatusBigint(publicClient, plan.contract, 'getBatchCount'),
        readBestEffortDefaultRoyalty(publicClient, plan.contract),
        readOptionalMintConfig(publicClient, plan.contract),
        readSupportedInterfaces(publicClient, plan.contract),
        tokenPlan === undefined
          ? Promise.resolve(undefined)
          : readOptionalTokenOwner(publicClient, plan.contract, tokenPlan.tokenId),
        tokenPlan === undefined
          ? Promise.resolve(undefined)
          : readOptionalTokenUri(publicClient, plan.contract, tokenPlan.tokenId),
        tokenPlan === undefined
          ? Promise.resolve(undefined)
          : readOptionalTokenCreator(publicClient, plan.contract, tokenPlan.tokenId),
        royaltyPlan === undefined
          ? Promise.resolve(undefined)
          : readOptionalRoyaltyInfo(publicClient, plan.contract, royaltyPlan.tokenId, royaltyPlan.salePrice),
      ]);

      return {
        contract: plan.contract,
        ...(name === undefined ? {} : { name }),
        ...(symbol === undefined ? {} : { symbol }),
        ...(owner === undefined ? {} : { owner }),
        ...(totalSupply === undefined ? {} : { totalSupply }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(disabled === undefined ? {} : { disabled }),
        ...(tokenUrisLocked === undefined ? {} : { tokenUrisLocked }),
        ...(batchCount === undefined ? {} : { batchCount }),
        ...defaultRoyalty,
        ...(mintConfig === undefined
          ? {}
          : {
            mintConfig: {
              tokenCount: mintConfig.numberOfTokens,
              baseUri: mintConfig.baseURI,
              lockedMetadata: mintConfig.lockedMetadata,
            },
          }),
        ...(interfaces === undefined ? {} : { interfaces }),
        ...(tokenPlan === undefined
          ? {}
          : {
            token: {
              tokenId: tokenPlan.tokenId,
              ...(tokenOwner === undefined ? {} : { owner: tokenOwner }),
              ...(tokenUri === undefined ? {} : { tokenUri }),
              ...(tokenCreator === undefined ? {} : { creator: tokenCreator }),
              ...(tokenRoyalty === undefined
                ? {}
                : {
                  royalty: {
                    salePrice: tokenRoyalty.salePrice,
                    receiver: tokenRoyalty.receiver,
                    amount: tokenRoyalty.amount,
                  },
                }),
            },
          }),
      };
    },

    deploy: {
      ...collectionDeploy,

      async lazyErc721(params): ReturnType<CollectionNamespace['deploy']['lazyErc721']> {
        const { variant, contractType } = resolveLazyErc721Variant(params.variant);
        const plan = planCreateLazySovereignCollection({
          name: params.name,
          symbol: params.symbol,
          maxTokens: params.maxTokens,
          contractType,
        });
        const factoryAddress = requireContractAddress(chain, 'lazySovereignFactory');
        const { walletClient, account } = requireWallet(config);
        const encodedContractType = await publicClient.readContract({
          address: factoryAddress,
          abi: lazySovereignFactoryAbi,
          functionName: plan.contractTypeReadName,
        });
        const write = buildCreateLazySovereignCollectionWrite(plan, encodedContractType);
        const txHash = await walletClient.writeContract({
          address: factoryAddress,
          abi: lazySovereignFactoryAbi,
          functionName: write.functionName,
          args: write.args,
          account,
          chain: undefined,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const logs = parseEventLogs({
          abi: lazySovereignFactoryAbi,
          logs: receipt.logs,
          eventName: 'SovereignNFTContractCreated',
        });
        const [createdLog] = logs;

        if (!createdLog) {
          throw new Error('Lazy ERC-721 collection transaction succeeded but SovereignNFTContractCreated was not found in logs.');
        }

        return {
          txHash,
          receipt,
          contract: createdLog.args.contractAddress,
          factory: factoryAddress,
          variant,
          nextStep: 'Prepare lazy mint metadata, approve RareMinter, then Configure release sale and mint settings.',
        };
      },
    },

    async mintBatch(params): ReturnType<CollectionNamespace['mintBatch']> {
      const plan = planCollectionMintBatch(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeCollectionBatchMint({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({
        abi: collectionMintAbi,
        logs: receipt.logs,
        eventName: 'ConsecutiveTransfer',
      });
      const [mintLog] = logs;

      if (!mintLog) {
        throw new Error('Batch mint transaction succeeded but ConsecutiveTransfer was not found in logs.');
      }

      return {
        txHash,
        receipt,
        contract: plan.contract,
        baseUri: plan.baseUri,
        tokenCount: plan.tokenCount,
        fromTokenId: mintLog.args.fromTokenId,
        toTokenId: mintLog.args.toTokenId,
        owner: mintLog.args.toAddress,
      };
    },

    async prepareLazyMint(params): ReturnType<CollectionNamespace['prepareLazyMint']> {
      const plan = planCollectionPrepareLazyMint(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeCollectionPrepareLazyMint({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({
        abi: collectionMintAbi,
        logs: receipt.logs,
        eventName: 'PrepareMint',
      });
      const [prepareLog] = logs;

      if (!prepareLog) {
        throw new Error('Lazy prepare mint transaction succeeded but PrepareMint was not found in logs.');
      }

      const prepared = shapeCollectionPrepareMintEvent(prepareLog.args);
      if (plan.minter === undefined) {
        return {
          txHash,
          receipt,
          contract: plan.contract,
          ...prepared,
        };
      }

      return {
        txHash,
        receipt,
        contract: plan.contract,
        ...prepared,
        minter: plan.minter,
      };
    },

    async getTokenCreator(params): ReturnType<CollectionNamespace['getTokenCreator']> {
      const plan = planCollectionToken(params);
      const creator = await readTokenCreator(publicClient, plan.contract, plan.tokenId);
      return {
        contract: plan.contract,
        tokenId: plan.tokenId,
        creator,
      };
    },

    royalty: {
      async status(params): ReturnType<CollectionNamespace['royalty']['status']> {
        const plan = planCollectionRoyaltyInfo(params);
        const [receiver, royaltyAmount] = await readRoyaltyInfo(
          publicClient,
          plan.contract,
          plan.tokenId,
          plan.salePrice,
        );
        const defaultRoyalty = await readDefaultRoyalty(publicClient, plan.contract);

        return {
          contract: plan.contract,
          tokenId: plan.tokenId,
          salePrice: plan.salePrice,
          receiver,
          royaltyAmount,
          ...defaultRoyalty,
        };
      },

    },

    async setDefaultRoyaltyReceiver(params): ReturnType<CollectionNamespace['setDefaultRoyaltyReceiver']> {
      const plan = planCollectionReceiver(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeSetDefaultRoyaltyReceiver({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        txHash,
        receipt,
        contract: plan.contract,
        receiver: plan.receiver,
      };
    },

    async setDefaultRoyaltyPercentage(params): ReturnType<CollectionNamespace['setDefaultRoyaltyPercentage']> {
      const plan = planCollectionRoyaltyPercentage(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeSetDefaultRoyaltyPercentage({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        txHash,
        receipt,
        contract: plan.contract,
        percentage: plan.percentage,
      };
    },

    async setTokenRoyaltyReceiver(params): ReturnType<CollectionNamespace['setTokenRoyaltyReceiver']> {
      const plan = planCollectionTokenReceiver(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeSetTokenRoyaltyReceiver({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: plan.tokenId,
        receiver: plan.receiver,
      };
    },

    metadata: {
      async status(params): ReturnType<CollectionNamespace['metadata']['status']> {
        const plan = planCollectionContract(params);
        const mintConfig = await readOptionalMintConfig(publicClient, plan.contract);
        return {
          contract: plan.contract,
          ...(mintConfig === undefined
            ? {}
            : {
              tokenCount: mintConfig.numberOfTokens,
              baseUri: mintConfig.baseURI,
              lockedMetadata: mintConfig.lockedMetadata,
            }),
        };
      },
    },

    async updateBaseUri(params): ReturnType<CollectionNamespace['updateBaseUri']> {
      const plan = planCollectionBaseUri(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeUpdateBaseUri({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({
        abi: collectionOwnerAbi,
        logs: receipt.logs,
        eventName: 'MetadataUpdated',
      });
      const [metadataLog] = logs;

      return {
        txHash,
        receipt,
        contract: plan.contract,
        baseUri: metadataLog?.args.baseURI ?? plan.baseUri,
      };
    },

    async updateTokenUri(params): ReturnType<CollectionNamespace['updateTokenUri']> {
      const plan = planCollectionTokenUri(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeUpdateTokenUri({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({
        abi: collectionOwnerAbi,
        logs: receipt.logs,
        eventName: 'TokenURIUpdated',
      });
      const [metadataLog] = logs;

      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: metadataLog?.args.tokenId ?? plan.tokenId,
        tokenUri: metadataLog?.args.metadataUri ?? plan.tokenUri,
      };
    },

    async lockBaseUri(params): ReturnType<CollectionNamespace['lockBaseUri']> {
      const plan = planCollectionContract(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await writeLockBaseUri({
        publicClient,
        walletClient,
        account,
        plan,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({
        abi: collectionOwnerAbi,
        logs: receipt.logs,
        eventName: 'MetadataLocked',
      });
      const [metadataLog] = logs;

      return {
        txHash,
        receipt,
        contract: plan.contract,
        baseUri: metadataLog?.args.baseURI ?? '',
      };
    },
  };
}

async function writeCollectionBatchMint(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionMintBatch>;
  },
): Promise<Hash> {
  const write = buildCollectionMintBatchWrite(opts.plan);
  await opts.publicClient.simulateContract({
    address: opts.plan.contract,
    abi: collectionMintAbi,
    functionName: write.functionName,
    args: write.args,
    account: opts.account,
  });

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionMintAbi,
    functionName: write.functionName,
    args: write.args,
    account: opts.account,
    chain: undefined,
  });
}

async function writeCollectionPrepareLazyMint(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionPrepareLazyMint>;
  },
): Promise<Hash> {
  const write = buildCollectionPrepareLazyMintWrite(opts.plan);
  await opts.publicClient.simulateContract({
    address: opts.plan.contract,
    abi: collectionMintAbi,
    functionName: write.functionName,
    args: write.args,
    account: opts.account,
  });

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionMintAbi,
    functionName: write.functionName,
    args: write.args,
    account: opts.account,
    chain: undefined,
  });
}

async function readTokenCreator(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
): Promise<Address> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'tokenCreator',
      args: [tokenId],
    });
  } catch (error) {
    throw contractSupportError('tokenCreator', contract, error);
  }
}

async function readOptionalTokenCreator(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'tokenCreator',
      args: [tokenId],
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readRoyaltyInfo(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
  salePrice: bigint,
): Promise<readonly [Address, bigint]> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'royaltyInfo',
      args: [tokenId, salePrice],
    });
  } catch (error) {
    throw contractSupportError('royaltyInfo', contract, error);
  }
}

async function readOptionalRoyaltyInfo(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
  salePrice: bigint,
): Promise<{ salePrice: bigint; receiver: Address; amount: bigint } | undefined> {
  try {
    const [receiver, amount] = await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'royaltyInfo',
      args: [tokenId, salePrice],
    });

    return { salePrice, receiver, amount };
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readDefaultRoyalty(
  publicClient: PublicClient,
  contract: Address,
): Promise<{ defaultReceiver?: Address; defaultPercentage?: bigint }> {
  const defaultReceiver = await readOptionalDefaultRoyaltyReceiver(publicClient, contract);
  const defaultPercentage = await readOptionalDefaultRoyaltyPercentage(publicClient, contract);

  return {
    ...(defaultReceiver === undefined ? {} : { defaultReceiver }),
    ...(defaultPercentage === undefined ? {} : { defaultPercentage }),
  };
}

async function readBestEffortDefaultRoyalty(
  publicClient: PublicClient,
  contract: Address,
): Promise<{ defaultReceiver?: Address; defaultPercentage?: bigint }> {
  const [defaultReceiver, defaultPercentage] = await Promise.all([
    readBestEffortDefaultRoyaltyReceiver(publicClient, contract),
    readBestEffortDefaultRoyaltyPercentage(publicClient, contract),
  ]);

  return {
    ...(defaultReceiver === undefined ? {} : { defaultReceiver }),
    ...(defaultPercentage === undefined ? {} : { defaultPercentage }),
  };
}

async function readOptionalDefaultRoyaltyReceiver(
  publicClient: PublicClient,
  contract: Address,
): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'getDefaultRoyaltyReceiver',
    });
  } catch (error) {
    if (isUnsupportedOptionalRead(error)) {
      return undefined;
    }

    throw contractSupportError('getDefaultRoyaltyReceiver', contract, error);
  }
}

function isUnsupportedOptionalRead(error: unknown): boolean {
  return (
    error instanceof ContractFunctionExecutionError &&
    error.cause instanceof ContractFunctionZeroDataError
  );
}

function isBestEffortReadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error instanceof ContractFunctionExecutionError ||
    error instanceof ContractFunctionZeroDataError
  ) {
    return true;
  }

  return isBestEffortReadError(error.cause);
}

async function readBestEffortDefaultRoyaltyReceiver(
  publicClient: PublicClient,
  contract: Address,
): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'getDefaultRoyaltyReceiver',
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalDefaultRoyaltyPercentage(
  publicClient: PublicClient,
  contract: Address,
): Promise<bigint | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'getDefaultRoyaltyPercentage',
    });
  } catch (error) {
    if (isUnsupportedOptionalRead(error)) {
      return undefined;
    }

    throw contractSupportError('getDefaultRoyaltyPercentage', contract, error);
  }
}

async function readBestEffortDefaultRoyaltyPercentage(
  publicClient: PublicClient,
  contract: Address,
): Promise<bigint | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'getDefaultRoyaltyPercentage',
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readMintConfig(
  publicClient: PublicClient,
  contract: Address,
): Promise<{ numberOfTokens: bigint; baseURI: string; lockedMetadata: boolean }> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionOwnerAbi,
      functionName: 'getMintConfig',
    });
  } catch (error) {
    throw contractSupportError('getMintConfig', contract, error);
  }
}

async function readOptionalMintConfig(
  publicClient: PublicClient,
  contract: Address,
): Promise<{ numberOfTokens: bigint; baseURI: string; lockedMetadata: boolean } | undefined> {
  try {
    return await readMintConfig(publicClient, contract);
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalStatusString(
  publicClient: PublicClient,
  contract: Address,
  functionName: 'name' | 'symbol',
): Promise<string | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName,
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalStatusAddress(
  publicClient: PublicClient,
  contract: Address,
  functionName: 'owner',
): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName,
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalStatusBigint(
  publicClient: PublicClient,
  contract: Address,
  functionName: 'totalSupply' | 'maxTokens' | 'getBatchCount',
): Promise<bigint | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName,
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalStatusBoolean(
  publicClient: PublicClient,
  contract: Address,
  functionName: 'disabled' | 'areTokenURIsLocked',
): Promise<boolean | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName,
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalTokenOwner(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName: 'ownerOf',
      args: [tokenId],
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalTokenUri(
  publicClient: PublicClient,
  contract: Address,
  tokenId: bigint,
): Promise<string | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName: 'tokenURI',
      args: [tokenId],
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalSupportsInterface(
  publicClient: PublicClient,
  contract: Address,
  interfaceId: `0x${string}`,
): Promise<boolean | undefined> {
  try {
    return await publicClient.readContract({
      address: contract,
      abi: collectionStatusAbi,
      functionName: 'supportsInterface',
      args: [interfaceId],
    });
  } catch (error) {
    if (isBestEffortReadError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readSupportedInterfaces(
  publicClient: PublicClient,
  contract: Address,
): Promise<NonNullable<Awaited<ReturnType<CollectionNamespace['status']>>['interfaces']> | undefined> {
  const [erc165, erc721, erc721Metadata, erc2981] = await Promise.all([
    readOptionalSupportsInterface(publicClient, contract, '0x01ffc9a7'),
    readOptionalSupportsInterface(publicClient, contract, '0x80ac58cd'),
    readOptionalSupportsInterface(publicClient, contract, '0x5b5e139f'),
    readOptionalSupportsInterface(publicClient, contract, '0x2a55205a'),
  ]);

  if (
    erc165 === undefined &&
    erc721 === undefined &&
    erc721Metadata === undefined &&
    erc2981 === undefined
  ) {
    return undefined;
  }

  return {
    ...(erc165 === undefined ? {} : { erc165 }),
    ...(erc721 === undefined ? {} : { erc721 }),
    ...(erc721Metadata === undefined ? {} : { erc721Metadata }),
    ...(erc2981 === undefined ? {} : { erc2981 }),
  };
}

async function writeSetDefaultRoyaltyReceiver(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionReceiver>;
  },
): Promise<Hash> {
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'setDefaultRoyaltyReceiver',
      args: [opts.plan.receiver],
      account: opts.account,
    });
  } catch (error) {
    throw contractSupportError('setDefaultRoyaltyReceiver', opts.plan.contract, error);
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionOwnerAbi,
    functionName: 'setDefaultRoyaltyReceiver',
    args: [opts.plan.receiver],
    account: opts.account,
    chain: undefined,
  });
}

async function writeSetDefaultRoyaltyPercentage(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionRoyaltyPercentage>;
  },
): Promise<Hash> {
  const write = buildCollectionRoyaltyPercentageWrite(opts.plan);
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: write.functionName,
      args: write.args,
      account: opts.account,
    });
  } catch (error) {
    throw contractSupportError(write.functionName, opts.plan.contract, error);
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionOwnerAbi,
    functionName: write.functionName,
    args: write.args,
    account: opts.account,
    chain: undefined,
  });
}

async function writeSetTokenRoyaltyReceiver(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionTokenReceiver>;
  },
): Promise<Hash> {
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'setRoyaltyReceiverForToken',
      args: [opts.plan.receiver, opts.plan.tokenId],
      account: opts.account,
    });
    return opts.walletClient.writeContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'setRoyaltyReceiverForToken',
      args: [opts.plan.receiver, opts.plan.tokenId],
      account: opts.account,
      chain: undefined,
    });
  } catch (error) {
    try {
      await opts.publicClient.simulateContract({
        address: opts.plan.contract,
        abi: rareErc1155Abi,
        functionName: 'setRoyaltyReceiverForToken',
        args: [opts.plan.tokenId, opts.plan.receiver],
        account: opts.account,
      });
    } catch (erc1155Error) {
      throw contractSupportError('setRoyaltyReceiverForToken', opts.plan.contract, new AggregateError([error, erc1155Error]));
    }
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: rareErc1155Abi,
    functionName: 'setRoyaltyReceiverForToken',
    args: [opts.plan.tokenId, opts.plan.receiver],
    account: opts.account,
    chain: undefined,
  });
}

async function writeUpdateBaseUri(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionBaseUri>;
  },
): Promise<Hash> {
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'updateBaseURI',
      args: [opts.plan.baseUri],
      account: opts.account,
    });
  } catch (error) {
    throw contractSupportError('updateBaseURI', opts.plan.contract, error);
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionOwnerAbi,
    functionName: 'updateBaseURI',
    args: [opts.plan.baseUri],
    account: opts.account,
    chain: undefined,
  });
}

async function writeUpdateTokenUri(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionTokenUri>;
  },
): Promise<Hash> {
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'updateTokenURI',
      args: [opts.plan.tokenId, opts.plan.tokenUri],
      account: opts.account,
    });
  } catch (error) {
    throw contractSupportError('updateTokenURI', opts.plan.contract, error);
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionOwnerAbi,
    functionName: 'updateTokenURI',
    args: [opts.plan.tokenId, opts.plan.tokenUri],
    account: opts.account,
    chain: undefined,
  });
}

async function writeLockBaseUri(
  opts: {
    publicClient: PublicClient;
    walletClient: NonNullable<RareClientConfig['walletClient']>;
    account: ReturnType<typeof requireWallet>['account'];
    plan: ReturnType<typeof planCollectionContract>;
  },
): Promise<Hash> {
  try {
    await opts.publicClient.simulateContract({
      address: opts.plan.contract,
      abi: collectionOwnerAbi,
      functionName: 'lockBaseURI',
      account: opts.account,
    });
  } catch (error) {
    throw contractSupportError('lockBaseURI', opts.plan.contract, error);
  }

  return opts.walletClient.writeContract({
    address: opts.plan.contract,
    abi: collectionOwnerAbi,
    functionName: 'lockBaseURI',
    account: opts.account,
    chain: undefined,
  });
}

function contractSupportError(operation: string, contract: Address, cause: unknown): Error {
  return new Error(
    `Collection ${contract} does not support ${operation}, or the ${operation} preflight failed.`,
    { cause },
  );
}
